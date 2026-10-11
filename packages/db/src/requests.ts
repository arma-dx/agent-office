import { OFFICE_TIME_ZONE } from '@agent-office/shared';
import type { Queryable } from './queryable.ts';

/**
 * Statements of flow (A): a request that agents carry out. Every statement runs with the caller's
 * restricted role inside the caller's transaction and context; what a person sees is decided by
 * the row policies, never by a condition here. Every statement that reads tasks carries
 * `kind = 'request'`: a task between people is never answered by these, whatever id is asked for.
 *
 * Nothing here sets a status or an approver. The status follows the records of the flow inside
 * the database (supabase/migrations: task_kind to requester_approvals); the unit and the agent are
 * written by the coordinator's routing or by a person's correction of it, both through the
 * database's own functions.
 */

/**
 * A due day is a day of the office. The column holds an instant: the last second of that day in
 * the office's time zone; it is read back as that day. The zone is a constant of the code, never
 * input.
 */
export const dueDaySql = (column: string): string =>
  `(${column} at time zone '${OFFICE_TIME_ZONE}')::date::text`;
const dueAtSql = (parameter: string): string =>
  `((${parameter}::date + time '23:59:59') at time zone '${OFFICE_TIME_ZONE}')`;

// May the calling person decide the work of this request: the founder, or the appointed approver
// of the step that is active now (the rule of office.check_approval and office.correct_routing,
// asked as a question). What an agent wrote before its work is approved is given to nobody else.
const mayDecide = (task: string): string => `(
  office.ctx_agent_code() is null
  and (
    office.is_founder()
    or (
      office.can_approve()
      and exists (
        select 1 from office.task_routings x
        where x.task_id = ${task} and x.status = 'active'
          and x.approver_user_id = office.ctx_user_id()
      )
    )
  )
)`;

// May agents work in the project of a request now (rule 12), asked with the reader's own rights:
// whoever reads a request inside a project reads that project, and every founder and employee
// reads the customers of the company. True for a request without a project. The database's own
// answer for a run is office.request_run_gate; this one is for what a person is shown and offered.
const agentsMayWork = (project: string): string => `(
  ${project} is null or exists (
    select 1 from office.projects p
    where p.id = ${project} and p.ai_allowed
      and (p.customer_id is null or exists (
        select 1 from office.customers c where c.id = p.customer_id and c.ai_allowed
      ))
  )
)`;

export interface RequestRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  // The due day (YYYY-MM-DD, office time); null when the requester gave none.
  due_date: string | null;
  requester_user_id: string;
  project_id: string | null;
  // Null when the request has no project.
  project_name: string | null;
  agents_may_work: boolean;
  // May the requester still read the request (decision 45); the database's own answer.
  requester_reads: boolean;
  // The latest time waiting work of this request was called for again (decision 49).
  restarted_at: Date | null;
  closed_by_user_id: string | null;
  close_reason: string | null;
  closed_after_delivery: boolean;
  // Returned to its requester: its last routing named a unit where no open agent could take it.
  returned_no_agent: boolean;
  rejected_by_user_id: string | null;
  rejected_reason: string | null;
  rejected_note: string | null;
  // May the reader decide the work of this request (founder, or approver of the active step).
  reader_may_decide: boolean;
  unit_code: string | null;
  unit_name: string | null;
  coordinator_name: string | null;
  coordinator_enabled: boolean;
  // Does the reader hold the approval right in this company.
  reader_can_approve: boolean;
  routed: boolean;
  step_agent_code: string | null;
  step_agent_name: string | null;
  step_agent_enabled: boolean | null;
  step_approver_user_id: string | null;
  step_created_at: Date | null;
  pending_acceptance: boolean;
  pending_result: boolean;
  last_result_status: string | null;
  last_result_attempt: number | null;
  last_change_request_at: Date | null;
  // The latest time a run was called for and not started, for the agent whose turn it is (a change
  // request that found the agent stopped, a job the runner refused at its gate).
  not_started_at: Date | null;
  run_agent_code: string | null;
  run_status: string | null;
  run_error_code: string | null;
  run_started_at: Date | null;
  // The time limit stored with that run when it opened (minutes); null when it carries none.
  run_limit_minutes: number | null;
}

// One row per request with everything the stage is derived from. The facts about approvals the
// reader may not read come from office.request_flow_facts (a status and a time, never content).
// `chosen` picks the requests first (one by id, or the page of the list with its order and limit):
// the flow facts, the active step and the latest run are then read for those rows only, not for
// every request the company ever had.
const requestSql = (chosen: string): string => `
  select t.id, t.title, t.description, t.status, t.created_at, t.updated_at,
         t.requester_user_id, t.closed_by_user_id, t.close_reason,
         t.project_id,
         (select p.name from office.projects p where p.id = t.project_id) as project_name,
         ${agentsMayWork('t.project_id')} as agents_may_work,
         coalesce(office.request_run_identity(t.id) = t.requester_user_id, true) as requester_reads,
         ${dueDaySql('t.due_at')} as due_date,
         t.unit_code, u.name as unit_name,
         (select d.name from office.agent_definitions d where d.code = $1) as coordinator_name,
         office.can_approve() as reader_can_approve,
         ${mayDecide('t.id')} as reader_may_decide,
         -- The coordinator can take a request: its switch is on and its card has a version.
         coalesce((
           select ca.status = 'enabled' and d.current_version_id is not null
           from office.company_agents ca
           join office.agent_definitions d on d.code = ca.agent_code
           where ca.company_id = t.company_id and ca.agent_code = $1
         ), false) as coordinator_enabled,
         -- Closed while the approved result waited for its requester, and not routed again since.
         (
           t.status = 'cancelled' and exists (
             select 1 from office.requester_approvals q
             where q.task_id = t.id and q.status = 'pending' and q.invalidated_at is not null
               and q.round = (
                 select max(q2.round) from office.requester_approvals q2 where q2.task_id = t.id
               )
               and not exists (
                 select 1 from office.task_routings r
                 where r.task_id = t.id and r.created_at > q.created_at
               )
           )
         ) as closed_after_delivery,
         -- Returned to its requester (8 October decision 2): the steps of its last routing are
         -- returned steps. The step is the record; the requester may read it like every step.
         (
           t.status = 'cancelled' and exists (
             select 1 from office.task_routings r
             where r.task_id = t.id and r.status = 'returned'
               and r.round = (
                 select max(r2.round) from office.task_routings r2 where r2.task_id = t.id
               )
           )
         ) as returned_no_agent,
         f.rejected_by_user_id, f.rejected_reason, f.rejected_note,
         exists (select 1 from office.task_routings r where r.task_id = t.id) as routed,
         -- The active step; it always has an agent (the table refuses an active step without one).
         s.agent_code as step_agent_code,
         sa.name as step_agent_name,
         (
           select ca.status = 'enabled' from office.company_agents ca
           where ca.company_id = t.company_id and ca.agent_code = s.agent_code
         ) as step_agent_enabled,
         s.approver_user_id as step_approver_user_id,
         s.created_at as step_created_at,
         exists (
           select 1 from office.requester_approvals q
           where q.task_id = t.id and q.status = 'pending' and q.invalidated_at is null
         ) as pending_acceptance,
         coalesce(f.pending_result, false) as pending_result,
         f.last_result_status, f.last_result_attempt, f.last_change_request_at,
         f.not_started_at, f.restarted_at,
         lr.agent_code as run_agent_code, lr.status as run_status,
         lr.error_code as run_error_code, lr.started_at as run_started_at,
         lr.limit_minutes as run_limit_minutes
  from (
    select x.id, x.company_id, x.title, x.description, x.status, x.created_at, x.updated_at,
           x.requester_user_id, x.closed_by_user_id, x.close_reason, x.unit_code, x.project_id,
           x.due_at
    from office.tasks x
    where x.kind = 'request' and x.company_id = office.ctx_company_id()
      ${chosen}
  ) t
  left join office.units u on u.code = t.unit_code
  left join office.task_routings s on s.task_id = t.id and s.status = 'active'
  left join office.agent_definitions sa on sa.code = s.agent_code
  left join office.request_flow_facts(array[t.id]) f on true
  left join lateral (
    select r.agent_code, r.status, r.error_code, r.started_at,
           case
             when jsonb_typeof(r.input -> 'limits' -> 'duration_minutes') = 'number'
             then (r.input -> 'limits' ->> 'duration_minutes')::float8
           end as limit_minutes
    from office.runs r where r.task_id = t.id
    order by r.started_at desc, r.id desc
    limit 1
  ) lr on true`;

/**
 * The requests the person can see, the newest movement first; `mine` keeps only their own. The
 * order and the limit are applied to the requests themselves, and an index serves each variant of
 * that pick: tasks_requests_by_movement the full list, tasks_requests_of_requester the person's
 * own. The joins keep no order, so the page is ordered again. `projectId` keeps the requests of
 * one project (the project page; served by the index tasks_project); a project the person cannot
 * read gives no row, because its requests give none.
 */
export async function listRequests(
  client: Queryable,
  options: { coordinator: string; mine: boolean; limit: number; projectId?: string | null },
): Promise<RequestRow[]> {
  const { rows } = await client.query<RequestRow>(
    `${requestSql(`and ($2::boolean is false or x.requester_user_id = office.ctx_user_id())
      and ($4::uuid is null or x.project_id = $4)
      order by x.updated_at desc, x.id
      limit $3`)}
     order by t.updated_at desc, t.id`,
    [options.coordinator, options.mine, options.limit, options.projectId ?? null],
  );
  return rows;
}

/** One request, or null when it does not exist, is hidden from the person or is not a request. */
export async function readRequest(
  client: Queryable,
  coordinator: string,
  requestId: string,
): Promise<RequestRow | null> {
  const { rows } = await client.query<RequestRow>(requestSql('and x.id = $2'), [
    coordinator,
    requestId,
  ]);
  return rows[0] ?? null;
}

/**
 * The open requests that may expect something of the calling person, the one that has not moved
 * for longest first: their own (the result may wait for their acceptance), every open request for
 * the founder, and for a person with the approval right those whose active step names them as the
 * approver. The stage decides afterwards which of them really wait for the person
 * (apps/api: expectedKind); this pick only leaves out what never can. What the person may read is
 * decided by the row policy, as everywhere. Served by the index tasks_requests_open.
 */
export async function listExpectedRequests(
  client: Queryable,
  options: { coordinator: string; limit: number },
): Promise<RequestRow[]> {
  const { rows } = await client.query<RequestRow>(
    `${requestSql(`and x.status not in ('done', 'cancelled')
      and office.ctx_agent_code() is null
      and (
        x.requester_user_id = office.ctx_user_id()
        or office.is_founder()
        or (
          office.can_approve()
          and exists (
            select 1 from office.task_routings s
            where s.task_id = x.id and s.status = 'active'
              and s.approver_user_id = office.ctx_user_id()
          )
        )
      )
      order by x.updated_at, x.id
      limit $2`)}
     order by t.updated_at, t.id`,
    [options.coordinator, options.limit],
  );
  return rows;
}

/**
 * Every open request of the context company the calling person may read, the one that has not
 * moved for longest first: what the live states of the office view are counted from (8 October
 * decision 10). The same row as the request page and the Bugün list read, so the stage derived
 * from it is the same. Which requests a person reads is decided by the row policy (a request
 * inside a project is read by its members and the founder), never by a condition here. An agent
 * run is answered with nothing. Served by the index tasks_requests_open.
 */
export async function listOpenRequests(
  client: Queryable,
  options: { coordinator: string; limit: number },
): Promise<RequestRow[]> {
  const { rows } = await client.query<RequestRow>(
    `${requestSql(`and x.status not in ('done', 'cancelled')
      and office.ctx_agent_code() is null
      order by x.updated_at, x.id
      limit $2`)}
     order by t.updated_at, t.id`,
    [options.coordinator, options.limit],
  );
  return rows;
}

/** Did this person already open a request with this id (a repeated send). */
export async function ownRequestExists(client: Queryable, requestId: string): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from office.tasks t
     where t.id = $1 and t.kind = 'request' and t.requester_user_id = office.ctx_user_id()
       and t.company_id = office.ctx_company_id()`,
    [requestId],
  );
  return rows.length > 0;
}

/**
 * Opens a request. The database takes the requester from the context and writes the status, the
 * unit and the agent itself (check_task); the title is derived by the caller from the text.
 * The due day is stored when the request is opened and never afterwards: the database refuses
 * every later change of a request.
 */
export async function insertRequest(
  client: Queryable,
  request: { id: string; title: string; text: string; dueDate: string | null },
): Promise<void> {
  await client.query(
    `insert into office.tasks (id, company_id, kind, title, description, due_at)
     values ($1, office.ctx_company_id(), 'request', $2, $3, ${dueAtSql('$4')})`,
    [request.id, request.title, request.text, request.dueDate],
  );
}

/**
 * Cancels (the requester) or stops (the approver of the active step, the founder) a request. The
 * database decides which it is and refuses everybody else.
 */
export async function closeRequest(
  client: Queryable,
  requestId: string,
  reason: string | null,
): Promise<void> {
  await client.query('select office.close_request($1, $2)', [requestId, reason]);
}

/**
 * A person corrects the routing (the founder, or the approver of the active step; the database
 * decides and appoints the approver of the new step). A person always names an agent; the
 * database refuses a step without one. The note is the person's own.
 */
export async function correctRouting(
  client: Queryable,
  requestId: string,
  step: { unitCode: string; agentCode: string; note: string | null },
): Promise<void> {
  await client.query('select office.correct_routing($1, $2::jsonb)', [
    requestId,
    JSON.stringify([{ unit: step.unitCode, agent: step.agentCode, reason: step.note }]),
  ]);
}

export interface RoutingOptionRow {
  unit_code: string;
  unit_name: string;
  agent_code: string | null;
  agent_name: string | null;
}

/**
 * Where a request can be routed in the context company: every unit of the company except the
 * coordinator's own, with the agents that are open here and have a card version to run with.
 */
export async function listRoutingOptions(
  client: Queryable,
  coordinator: string,
): Promise<RoutingOptionRow[]> {
  const { rows } = await client.query<RoutingOptionRow>(
    `select u.code as unit_code, u.name as unit_name, a.code as agent_code, a.name as agent_name
     from office.companies c
     join office.units u on (u.company_code is null or u.company_code = c.code)
     left join (
       office.agent_definitions a
       join office.company_agents ca on ca.agent_code = a.code and ca.status = 'enabled'
     ) on a.unit_code = u.code and ca.company_id = c.id and a.current_version_id is not null
     where c.id = office.ctx_company_id()
       and u.code is distinct from (
         select d.unit_code from office.agent_definitions d where d.code = $1
       )
     order by (u.company_code is not null), u.code collate "C", a.code collate "C"`,
    [coordinator],
  );
  return rows;
}

export interface IntakeRow {
  company_kind: string;
  // The coordinator's switch in the context company; null: no row.
  switch: string | null;
  has_version: boolean;
  // The status written on the coordinator's card version (draft, trial, active).
  card_status: string | null;
}

/** What decides whether a request can be sent in the context company now. */
export async function readIntake(
  client: Queryable,
  coordinator: string,
): Promise<IntakeRow | null> {
  const { rows } = await client.query<IntakeRow>(
    `select c.kind as company_kind,
            (
              select ca.status from office.company_agents ca
              where ca.company_id = c.id and ca.agent_code = $1
            ) as switch,
            coalesce(d.current_version_id is not null, false) as has_version,
            v.content -> 'card' ->> 'status' as card_status
     from office.companies c
     left join office.agent_definitions d on d.code = $1
     left join office.card_versions v on v.id = d.current_version_id
     where c.id = office.ctx_company_id()`,
    [coordinator],
  );
  return rows[0] ?? null;
}

// The journey --------------------------------------------------------------------------------------

export interface RoutingRow {
  id: string;
  created_at: Date;
  round: number;
  unit_code: string;
  unit_name: string;
  agent_code: string | null;
  agent_name: string | null;
  approver_user_id: string | null;
  routed_by_user_id: string | null;
  reason: string | null;
}

/**
 * The steps of the routing. A person's note is read by everybody who reads the request; the
 * coordinator's reason is a model's text nobody approved, so only those who may decide the work
 * read it.
 */
export async function listRoutings(client: Queryable, requestId: string): Promise<RoutingRow[]> {
  const { rows } = await client.query<RoutingRow>(
    `select r.id, r.created_at, r.round, r.unit_code, u.name as unit_name, r.agent_code,
            a.name as agent_name, r.approver_user_id, r.routed_by_user_id,
            case when r.routed_by_user_id is not null or ${mayDecide('r.task_id')}
              then r.reason end as reason
     from office.task_routings r
     join office.units u on u.code = r.unit_code
     left join office.agent_definitions a on a.code = r.agent_code
     where r.task_id = $1
     order by r.round, r.seq`,
    [requestId],
  );
  return rows;
}

export interface RunRow {
  id: string;
  agent_code: string;
  agent_name: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: string | null;
  error_code: string | null;
  summary: string | null;
  agent_text: string | null;
}

/**
 * The runs on a request. The summary is a sentence made by code. What the agent wrote when it
 * ended without its tool, and the coordinator's reason when it routed nothing (runs.output, raw
 * content under the retention period), is given only to those who may decide the work: it is a
 * model's text nobody approved.
 */
export async function listRuns(client: Queryable, requestId: string): Promise<RunRow[]> {
  const { rows } = await client.query<RunRow>(
    `select r.id, r.agent_code, a.name as agent_name, r.status, r.started_at, r.finished_at,
            r.duration_ms, r.error_code, r.summary,
            case when ${mayDecide('r.task_id')} then r.output ->> 'final_text' end as agent_text
     from office.runs r
     join office.agent_definitions a on a.code = r.agent_code
     where r.task_id = $1
     order by r.started_at, r.id`,
    [requestId],
  );
  return rows;
}

export interface StepRow {
  run_id: string;
  tool_name: string;
  status: string;
}

/** The tool calls of the runs, by name and status only: never their input or their result. */
export async function listSteps(client: Queryable, runIds: string[]): Promise<StepRow[]> {
  if (runIds.length === 0) {
    return [];
  }
  const { rows } = await client.query<StepRow>(
    `select c.run_id, c.tool_name, c.status from office.tool_calls c
     where c.run_id = any ($1::uuid[])
     order by c.run_id, c.seq`,
    [runIds],
  );
  return rows;
}

// Comments -----------------------------------------------------------------------------------------

export interface RequestCommentRow {
  id: string;
  author_user_id: string;
  body: string;
  created_at: Date;
}

/**
 * The newest `limit` comments of a request, the newest first (the caller turns them round). Who
 * reads them is decided by the row policies: whoever reads the request, as a person through the
 * API's role; an agent run and the worker's role are shown none. A comment of a request is
 * always a person's (the database refuses an agent's); the condition on the author keeps the
 * answer's shape true whatever a row holds.
 */
export async function listRequestComments(
  client: Queryable,
  requestId: string,
  limit: number,
): Promise<RequestCommentRow[]> {
  const { rows } = await client.query<RequestCommentRow>(
    `select k.id, k.author_user_id, k.body, k.created_at
     from office.task_comments k
     join office.tasks t on t.id = k.task_id and t.kind = 'request'
     where k.task_id = $1 and k.company_id = office.ctx_company_id()
       and k.author_user_id is not null
     order by k.created_at desc, k.id desc
     limit $2`,
    [requestId, limit],
  );
  return rows;
}

/**
 * Adds a comment in the name of the context person (the database sets the author and the time,
 * copies the request's project and decides who may write). False when a row with this id exists
 * already. SQLSTATE 42501: not the requester, the approver of the request or the founder, or not
 * a person's act through the API; 23503: the person cannot read the request.
 */
export async function insertRequestComment(
  client: Queryable,
  comment: { id: string; requestId: string; body: string },
): Promise<boolean> {
  const { rows } = await client.query(
    `insert into office.task_comments (id, company_id, task_id, body)
     values ($1, office.ctx_company_id(), $2, $3)
     on conflict (id) do nothing
     returning id`,
    [comment.id, comment.requestId, comment.body],
  );
  return rows.length > 0;
}

/** Is the comment with this id the context person's own comment on this request (a repeated send). */
export async function ownRequestCommentExists(
  client: Queryable,
  commentId: string,
  requestId: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from office.task_comments k
     where k.id = $1 and k.task_id = $2 and k.company_id = office.ctx_company_id()
       and k.author_user_id = office.ctx_user_id()`,
    [commentId, requestId],
  );
  return rows.length > 0;
}

/** May the context person write a comment on this request (the database's own rule, asked). */
export async function mayCommentOnRequest(client: Queryable, requestId: string): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    'select office.may_comment_on_request($1) as may',
    [requestId],
  );
  return rows[0]?.may === true;
}

export interface ResultApprovalRow {
  id: string;
  task_id: string;
  request_title: string;
  requester_user_id: string;
  project_id: string | null;
  // Null when the request has no project.
  project_name: string | null;
  agents_may_work: boolean;
  agent_code: string;
  agent_name: string;
  attempt: number;
  status: string;
  created_at: Date;
  decided_at: Date | null;
  decided_by_user_id: string | null;
  rejection_reason: string | null;
  decision_reason: string | null;
  invalidated_at: Date | null;
  title: string;
  summary: string | null;
  agent_rationale: string | null;
  risk_note: string | null;
  payload: unknown;
  selected_option: string | null;
  involves_money: boolean;
  goes_external: boolean;
  needs_step_up: boolean;
  may_decide: boolean;
}

// The result approvals of requests (routing_id set). The row policy decides which of them the
// person reads: every approved one; a pending, sent back or rejected one only with the approval
// right (office.approval_released).
const RESULT_APPROVAL_FROM = `
  from office.approvals a
  join office.tasks t on t.id = a.task_id and t.kind = 'request'
  join office.agent_definitions d on d.code = a.agent_code
  where a.routing_id is not null and a.company_id = office.ctx_company_id()`;

// The database's own decision rule for the result of a request, asked as a question: the founder,
// or the appointed person; with nobody appointed only the founder (7 October decision 5).
const MAY_DECIDE_RESULT = `(
  office.ctx_agent_code() is null
  and (
    office.is_founder()
    or (office.can_approve() and a.approver_user_id = office.ctx_user_id())
  )
) is true`;

// A result that waits for a decision. The list of the approval desk and the count of the sidebar
// are built from these same texts.
const RESULT_WAITS = `a.status = 'pending' and a.invalidated_at is null`;

const RESULT_APPROVAL_SQL = `
  select a.id, a.task_id, t.title as request_title, t.requester_user_id,
         t.project_id,
         (select p.name from office.projects p where p.id = t.project_id) as project_name,
         ${agentsMayWork('t.project_id')} as agents_may_work,
         a.agent_code,
         d.name as agent_name, a.attempt, a.status, a.created_at, a.decided_at,
         a.decided_by_user_id, a.rejection_reason, a.decision_reason, a.invalidated_at,
         a.title, a.summary, a.agent_rationale, a.risk_note, a.payload, a.selected_option,
         a.involves_money, a.goes_external,
         office.approval_needs_step_up(a.id) as needs_step_up,
         ${MAY_DECIDE_RESULT} as may_decide
  ${RESULT_APPROVAL_FROM}`;

export async function listResultApprovals(
  client: Queryable,
  requestId: string,
): Promise<ResultApprovalRow[]> {
  const { rows } = await client.query<ResultApprovalRow>(
    `${RESULT_APPROVAL_SQL} and a.task_id = $1 order by a.created_at, a.id`,
    [requestId],
  );
  return rows;
}

/** The results that wait for a decision of this person, the one that has waited longest first. */
export async function listPendingApprovals(client: Queryable): Promise<ResultApprovalRow[]> {
  const { rows } = await client.query<ResultApprovalRow>(
    `select * from (${RESULT_APPROVAL_SQL} and ${RESULT_WAITS}) w
     where w.may_decide
     order by w.created_at, w.id`,
  );
  return rows;
}

/**
 * Takes the lock of a request for the rest of the transaction, as a close and a correction of the
 * routing do first. A decision and the requester's answer call it before they touch an approval,
 * so that every act of a person locks the request first and two of them wait for each other
 * instead of meeting in a deadlock. Locks nothing when the person cannot read the request.
 */
export async function lockRequest(client: Queryable, requestId: string): Promise<void> {
  await client.query('select office.lock_request($1)', [requestId]);
}

/** One result approval, locked for a decision; null when the person cannot read it. */
export async function lockResultApproval(
  client: Queryable,
  approvalId: string,
): Promise<ResultApprovalRow | null> {
  // The request first (see lockRequest), then the approval: the row policy lets the person update
  // it only if they may read it, and a second decision waits here for the first.
  const found = await client.query<{ task_id: string }>(
    `select a.task_id from office.approvals a
     where a.id = $1 and a.routing_id is not null and a.task_id is not null`,
    [approvalId],
  );
  const taskId = found.rows[0]?.task_id;
  if (taskId === undefined) {
    return null;
  }
  await lockRequest(client, taskId);
  const locked = await client.query(
    'select 1 from office.approvals a where a.id = $1 for update of a',
    [approvalId],
  );
  if (locked.rows.length === 0) {
    return null;
  }
  const { rows } = await client.query<ResultApprovalRow>(`${RESULT_APPROVAL_SQL} and a.id = $1`, [
    approvalId,
  ]);
  return rows[0] ?? null;
}

export type ApprovalDecisionChange =
  | { decision: 'approved'; selectedOption: string | null }
  | { decision: 'changes_requested' | 'rejected'; reason: string; note: string | null };

/** Writes the decision; the database checks who decides, the option and the passkey. */
export async function decideApproval(
  client: Queryable,
  approvalId: string,
  change: ApprovalDecisionChange,
): Promise<void> {
  if (change.decision === 'approved') {
    await client.query(
      `update office.approvals set status = 'approved', selected_option = $2 where id = $1`,
      [approvalId, change.selectedOption],
    );
    return;
  }
  await client.query(
    `update office.approvals set status = $2, rejection_reason = $3, decision_reason = $4
     where id = $1`,
    [approvalId, change.decision, change.reason, change.note],
  );
}

export interface AcceptanceRow {
  id: string;
  task_id: string;
  request_title: string;
  requester_user_id: string;
  round: number;
  status: string;
  created_at: Date;
  decided_at: Date | null;
  invalidated_at: Date | null;
  rejection_reason: string | null;
  decision_reason: string | null;
  approval_id: string;
  // Who answered: the requester, or the founder in the requester's place (decision 45). Null
  // while it waits, and for an answer given before the column existed (then: the requester).
  decided_by_user_id: string | null;
  // The approval waits and the calling person is the founder standing in for a requester who
  // cannot read the request.
  reader_stands_in: boolean;
  // May agents work in the project of the request now (rule 12).
  agents_may_work: boolean;
  // The requester has not asked for changes on this request before: the next "not what I asked
  // for" goes back to the agent (the rule of office.flow_on_requester_approval, as a question).
  returns_to_agent: boolean;
}

const ACCEPTANCE_FROM = `
  from office.requester_approvals q
  join office.tasks t on t.id = q.task_id and t.kind = 'request'
  where q.company_id = office.ctx_company_id()`;

// An approved result that waits for the answer of the calling person: its requester, or the
// founder while the requester cannot read the request (decision 45; the database's own rule).
const ACCEPTANCE_WAITS_FOR_READER = `q.status = 'pending' and q.invalidated_at is null
  and (
    q.requester_user_id = office.ctx_user_id()
    or (
      office.is_founder()
      and office.request_run_identity(q.task_id) is distinct from q.requester_user_id
    )
  )`;

const ACCEPTANCE_SQL = `
  select q.id, q.task_id, t.title as request_title, q.requester_user_id, q.round, q.status,
         q.created_at, q.decided_at, q.invalidated_at, q.rejection_reason, q.decision_reason,
         q.approval_id,
         q.decided_by_user_id,
         (
           q.status = 'pending' and q.invalidated_at is null
           and q.requester_user_id is distinct from office.ctx_user_id()
           and office.is_founder()
           and office.request_run_identity(q.task_id) is distinct from q.requester_user_id
         ) as reader_stands_in,
         ${agentsMayWork('t.project_id')} as agents_may_work,
         not exists (
           select 1 from office.requester_approvals p
           where p.task_id = q.task_id and p.status = 'changes_requested'
         ) as returns_to_agent
  ${ACCEPTANCE_FROM}`;

export async function listAcceptances(
  client: Queryable,
  requestId: string,
): Promise<AcceptanceRow[]> {
  const { rows } = await client.query<AcceptanceRow>(
    `${ACCEPTANCE_SQL} and q.task_id = $1 order by q.round`,
    [requestId],
  );
  return rows;
}

/**
 * The approved results that wait for the acceptance of this person: of their own requests, and
 * for the founder those of requesters who can no longer read their request (decision 45).
 */
export async function listPendingAcceptances(client: Queryable): Promise<AcceptanceRow[]> {
  const { rows } = await client.query<AcceptanceRow>(
    `${ACCEPTANCE_SQL} and ${ACCEPTANCE_WAITS_FOR_READER}
     order by q.created_at, q.id`,
  );
  return rows;
}

/** The approved result approvals with these ids (what a requester is asked to accept). */
export async function readResultApprovals(
  client: Queryable,
  approvalIds: string[],
): Promise<ResultApprovalRow[]> {
  if (approvalIds.length === 0) {
    return [];
  }
  const { rows } = await client.query<ResultApprovalRow>(
    `${RESULT_APPROVAL_SQL} and a.id = any ($1::uuid[]) and a.status = 'approved'`,
    [approvalIds],
  );
  return rows;
}

export interface PendingDecisionCounts {
  // Results that wait for a decision of this person.
  approvals: number;
  // Approved results that wait for this person's acceptance: its requester, or the founder in
  // the requester's place.
  acceptances: number;
}

/**
 * How many cards the approval desk has for the calling person: the count of listPendingApprovals
 * and of the pending acceptances whose approved result the desk shows (listPendingAcceptances with
 * readResultApprovals), by the same rule texts. Every one of them is counted: no limit, no order
 * and no row is loaded, so the number does not depend on how many open requests the company has.
 * The number says what waits for a person: an agent run is answered with nothing, also when it
 * goes in the name of a requester whose acceptance waits.
 */
export async function countPendingDecisions(client: Queryable): Promise<PendingDecisionCounts> {
  const { rows } = await client.query<PendingDecisionCounts>(
    `select
       (
         select count(*) ${RESULT_APPROVAL_FROM} and ${RESULT_WAITS} and ${MAY_DECIDE_RESULT}
       )::int as approvals,
       (
         select count(*) ${ACCEPTANCE_FROM} and ${ACCEPTANCE_WAITS_FOR_READER}
           and office.ctx_agent_code() is null
           and exists (
             select 1 ${RESULT_APPROVAL_FROM} and a.id = q.approval_id and a.status = 'approved'
           )
       )::int as acceptances`,
  );
  return rows[0] ?? { approvals: 0, acceptances: 0 };
}

/**
 * The requester's answer to the approved result, given by the requester or, while the requester
 * cannot read the request, by the founder in their place (decision 45). Returns false when no
 * approval of this request waits for this person: two row policies let the requester update it,
 * and the founder only while the requester cannot.
 */
export async function decideAcceptance(
  client: Queryable,
  requestId: string,
  change:
    | { decision: 'approved' }
    | { decision: 'changes_requested'; reason: string | null; note: string },
): Promise<boolean> {
  const result =
    change.decision === 'approved'
      ? await client.query(
          `update office.requester_approvals set status = 'approved'
           where task_id = $1 and status = 'pending' and invalidated_at is null`,
          [requestId],
        )
      : await client.query(
          `update office.requester_approvals
           set status = 'changes_requested', rejection_reason = $2, decision_reason = $3
           where task_id = $1 and status = 'pending' and invalidated_at is null`,
          [requestId, change.reason, change.note],
        );
  return (result.rowCount ?? 0) > 0;
}

/**
 * The agent a new run is called for after a change request: the agent of the step that is active
 * now, and whether it is enabled in this company. Null when no step is active (after the second
 * change request nothing starts by itself). A stopped agent takes no new work: the caller sends
 * no job for it and leaves the trace that the run was not started (run_not_started).
 */
export async function agentToRunAgain(
  client: Queryable,
  requestId: string,
): Promise<{ agentCode: string; requesterUserId: string; enabled: boolean } | null> {
  const { rows } = await client.query<{
    agent_code: string;
    requester_user_id: string;
    enabled: boolean;
  }>(
    `select s.agent_code, t.requester_user_id,
            exists (
              select 1 from office.company_agents ca
              where ca.company_id = s.company_id and ca.agent_code = s.agent_code
                and ca.status = 'enabled'
            ) as enabled
     from office.task_routings s
     join office.tasks t on t.id = s.task_id and t.kind = 'request'
     where s.task_id = $1 and s.status = 'active' and t.status = 'in_progress'`,
    [requestId],
  );
  const row = rows[0];
  return row
    ? { agentCode: row.agent_code, requesterUserId: row.requester_user_id, enabled: row.enabled }
    : null;
}

/** The names of people on the records the person read (members of the context company only). */
export async function peopleNames(
  client: Queryable,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const { rows } = await client.query<{ user_id: string; name: string }>(
    'select user_id, name from office.people_names($1::uuid[])',
    [unique],
  );
  return new Map(rows.map((row) => [row.user_id, row.name]));
}

// The agent's switch -------------------------------------------------------------------------------

/**
 * Opens or stops an agent for the context company (the company_agents row). Only the founder's
 * context passes the row policy; the database checks that the card names the company. Returns the
 * row; 'unknown' when the agent does not exist; 'not_ready' when it is to be opened but its
 * card has no version to run with (the definitions were not synchronised, or its skills are not
 * written): such an agent could be given a request and would never start.
 */
export async function setAgentSwitch(
  client: Queryable,
  agentCode: string,
  status: 'enabled' | 'stopped',
): Promise<{ id: string } | 'unknown' | 'not_ready'> {
  const known = await client.query<{ ready: boolean; named: boolean }>(
    `select d.current_version_id is not null as ready,
            exists (
              select 1 from office.companies c
              where c.id = office.ctx_company_id() and c.code = any (d.company_codes)
            ) as named
     from office.agent_definitions d where d.code = $1`,
    [agentCode],
  );
  const definition = known.rows[0];
  if (!definition) {
    return 'unknown';
  }
  // An agent the card does not give to this company is refused by the database below.
  if (status === 'enabled' && definition.named && !definition.ready) {
    return 'not_ready';
  }
  const { rows } = await client.query<{ id: string }>(
    `insert into office.company_agents (company_id, agent_code, status)
     values (office.ctx_company_id(), $1, $2)
     on conflict (company_id, agent_code) do update set status = excluded.status
     returning id`,
    [agentCode, status],
  );
  const row = rows[0];
  return row ? { id: row.id } : 'unknown';
}

/**
 * Stops an agent for the context company only if it is open there ("Her yerde durdur", 8 October
 * decision 9): the switch of an agent that is closed, stopped or was never opened is not touched
 * and no row is made. Returns the row that was changed, or null when nothing was. Only the
 * founder's context passes the row policy; for anybody else no row is changed.
 */
export async function stopAgentIfOpen(
  client: Queryable,
  agentCode: string,
): Promise<{ id: string } | null> {
  const { rows } = await client.query<{ id: string }>(
    `update office.company_agents set status = 'stopped'
     where company_id = office.ctx_company_id() and agent_code = $1 and status = 'enabled'
     returning id`,
    [agentCode],
  );
  return rows[0] ?? null;
}

export interface AgentSwitchRow {
  name: string;
  // The agent's card has a version to run with.
  ready: boolean;
  // company_agents.status in the context company; null when the company has no row for the agent.
  status: string | null;
}

/** An agent's name, whether its card can run, and the context company's switch for it. */
export async function readAgentSwitch(
  client: Queryable,
  agentCode: string,
): Promise<AgentSwitchRow | null> {
  const { rows } = await client.query<AgentSwitchRow>(
    `select d.name,
            d.current_version_id is not null as ready,
            (
              select ca.status from office.company_agents ca
              where ca.company_id = office.ctx_company_id() and ca.agent_code = d.code
            ) as status
     from office.agent_definitions d where d.code = $1`,
    [agentCode],
  );
  return rows[0] ?? null;
}

export async function writeAudit(
  client: Queryable,
  event: string,
  recordType: string,
  recordId: string,
): Promise<void> {
  await client.query(
    `insert into office.audit_log (company_id, event, record_type, record_id)
     values (office.ctx_company_id(), $1, $2, $3)`,
    [event, recordType, recordId],
  );
}
