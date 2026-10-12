import type { Queryable } from './queryable.ts';

/**
 * Statements of the Projects section (8 October decisions 14 to 22). Every statement runs with
 * the caller's restricted role inside the caller's transaction and context; what a person sees is
 * decided by the row policies, never by a condition here: the founder reads every project of the
 * context company, an employee the ones they are a member of, nobody else any.
 *
 * Nothing here sets the AI permission of a project or a contract permission of a customer except
 * the two calls of the database's own functions, which ask for the founder and, to open an AI
 * permission, for a passkey re-verification recorded in the same transaction.
 *
 * Step 3 (decision 17): the budget and the milestones. The budget is in the row only for a reader
 * who may change it (the founder, the owner, a manager): the statement leaves the amount out for
 * a plain member, as the API leaves a customer's fields out (docs/SONRA.md P1-e).
 *
 * The runs of a project: whoever reads the project reads its runs (the row policy of runs), and
 * the statements select no text of a run. Tokens and cost are the founder's (docs/SONRA.md P-t):
 * the statements leave them out for everybody else, so no later code can hand them on by mistake.
 *
 * The approvals of a project: read through the row policy of approvals, which is the rule of
 * docs/SONRA.md V-c (a waiting or refused result is a row only for who holds the approval right;
 * an approved one for every reader of the project). The statement adds no condition of its own
 * about who reads, and selects nothing an agent wrote.
 *
 * The AI spending limit: every reader of a project is told whether it is reached (a yes or a no,
 * the database's own answer); the limit and the sum are read by the founder alone.
 */

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  closed: boolean;
  color: string;
  icon: string;
  // YYYY-MM-DD: read as text, a day has no time zone.
  target_date: string | null;
  // Text, never a number; null for a reader who may not see the budget, and when there is none.
  budget: string | null;
  budget_currency: string | null;
  // As stored: [{ id, name, date, done }]; the route parses it with the contract.
  milestones: unknown;
  // Is the AI spending limit of the project reached now (8 October decision 17): the database's
  // own answer, a yes or a no for every reader of the project.
  spending_limit_reached: boolean;
  ai_allowed: boolean;
  customer_id: string | null;
  customer_name: string | null;
  customer_ai_allowed: boolean | null;
  customer_automated_processing_allowed: boolean | null;
  member_count: number;
  created_at: Date;
  created_by_user_id: string | null;
  reader_is_founder: boolean;
  // owner, manager or member; null when the reader is no member of the project (the founder).
  reader_project_role: string | null;
  // The GitHub repository the project was given (12 October decision 17): GitHub's number, read
  // as text, and the name it had when it was linked; both null when it has none.
  repository_id: string | null;
  repository_full_name: string | null;
}

const PROJECT_SQL = `
  select p.id, p.name, p.description, p.status, p.closed, p.color, p.icon,
         p.target_date::text as target_date,
         case when office.is_founder()
                or coalesce(office.project_role(p.id) in ('owner', 'manager'), false)
              then p.budget::text end as budget,
         case when office.is_founder()
                or coalesce(office.project_role(p.id) in ('owner', 'manager'), false)
              then p.budget_currency end as budget_currency,
         p.milestones,
         coalesce(office.project_spending_limit_reached(p.id), false) as spending_limit_reached,
         p.ai_allowed,
         c.id as customer_id, c.name as customer_name, c.ai_allowed as customer_ai_allowed,
         c.automated_processing_allowed as customer_automated_processing_allowed,
         (
           select count(*)::int from office.project_members pm where pm.project_id = p.id
         ) as member_count,
         p.created_at, p.created_by_user_id,
         office.is_founder() as reader_is_founder,
         office.project_role(p.id) as reader_project_role,
         pr.repository_id::text as repository_id, pr.full_name as repository_full_name
  from office.projects p
  left join office.customers c on c.id = p.customer_id
  left join office.project_repositories pr on pr.project_id = p.id
  where p.company_id = office.ctx_company_id()`;

/** The projects of the context company the person may read: open ones first, the newest first. */
export async function listProjects(client: Queryable, limit: number): Promise<ProjectRow[]> {
  const { rows } = await client.query<ProjectRow>(
    `${PROJECT_SQL} order by p.closed, p.created_at desc, p.id limit $1`,
    [limit],
  );
  return rows;
}

/** One project; null when it does not exist or the person may not read it. */
export async function readProject(
  client: Queryable,
  projectId: string,
): Promise<ProjectRow | null> {
  const { rows } = await client.query<ProjectRow>(`${PROJECT_SQL} and p.id = $1`, [projectId]);
  return rows[0] ?? null;
}

/** Did the calling person open this project in the context company (a send that is repeated). */
export async function ownProjectExists(client: Queryable, projectId: string): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from office.projects p
     where p.id = $1 and p.company_id = office.ctx_company_id()
       and p.created_by_user_id = office.ctx_user_id()`,
    [projectId],
  );
  return rows.length > 0;
}

export interface NewProject {
  id: string;
  customerId: string | null;
  name: string;
  description: string | null;
  status: string;
  color: string;
  icon: string;
  // YYYY-MM-DD.
  targetDate: string | null;
}

/**
 * Opens a project in the context company. The database makes the opener its member and its owner
 * in the same statement, writes who and when, and starts it without AI permission. The row is not asked back
 * ("returning"): the read policy looks at the new row before the opener is its member, so an
 * employee's insert would be refused. The caller reads the project afterwards.
 */
export async function insertProject(client: Queryable, project: NewProject): Promise<void> {
  await client.query(
    `insert into office.projects
       (id, company_id, customer_id, name, description, status, color, icon, target_date)
     values ($1, office.ctx_company_id(), $2, $3, $4, $5, $6, $7, $8::date)`,
    [
      project.id,
      project.customerId,
      project.name,
      project.description,
      project.status,
      project.color,
      project.icon,
      project.targetDate,
    ],
  );
}

/** The fields of a project a member may change; a field left out (undefined) is not changed. */
export interface ProjectChanges {
  name?: string | undefined;
  description?: string | null | undefined;
  customerId?: string | null | undefined;
  status?: string | undefined;
  color?: string | undefined;
  icon?: string | undefined;
  targetDate?: string | null | undefined;
}

/**
 * Changes the fields that were sent, in one fixed statement: every field comes with a flag that
 * says whether it was sent, so no SQL text is built from a request. Returns the number of rows (0:
 * the person may not change the project, or it does not exist).
 */
export async function updateProject(
  client: Queryable,
  projectId: string,
  changes: ProjectChanges,
): Promise<number> {
  const result = await client.query(
    `update office.projects p set
       name = case when $2::boolean then $3 else p.name end,
       description = case when $4::boolean then $5 else p.description end,
       customer_id = case when $6::boolean then $7::uuid else p.customer_id end,
       status = case when $8::boolean then $9 else p.status end,
       color = case when $10::boolean then $11 else p.color end,
       icon = case when $12::boolean then $13 else p.icon end,
       target_date = case when $14::boolean then $15::date else p.target_date end
     where p.id = $1 and p.company_id = office.ctx_company_id()`,
    [
      projectId,
      changes.name !== undefined,
      changes.name ?? null,
      changes.description !== undefined,
      changes.description ?? null,
      changes.customerId !== undefined,
      changes.customerId ?? null,
      changes.status !== undefined,
      changes.status ?? null,
      changes.color !== undefined,
      changes.color ?? null,
      changes.icon !== undefined,
      changes.icon ?? null,
      changes.targetDate !== undefined,
      changes.targetDate ?? null,
    ],
  );
  return result.rowCount ?? 0;
}

/**
 * Sets or (null) takes away the budget of a project (8 October decision 17). The database asks for
 * the owner, a manager or the founder (42501 for a plain member) and for an amount with a
 * currency (23514). Returns the number of rows (0: the person may not read the project, or it
 * does not exist).
 */
export async function setProjectBudget(
  client: Queryable,
  projectId: string,
  budget: { amount: string; currency: string } | null,
): Promise<number> {
  const result = await client.query(
    `update office.projects p set budget = $2::numeric, budget_currency = $3
     where p.id = $1 and p.company_id = office.ctx_company_id()`,
    [projectId, budget?.amount ?? null, budget?.currency ?? null],
  );
  return result.rowCount ?? 0;
}

// The three milestone statements build the new list inside ONE update each: two people who change
// two entries at the same moment both keep their change (the second waits for the first and reads
// the list as the first left it). Never read the list, change it here and write it back.
const HAS_MILESTONE = `exists (
     select 1 from jsonb_array_elements(p.milestones) e where e.value ->> 'id' = ($2::uuid)::text)`;

/**
 * Adds a milestone at the end of the list, not reached yet. Returns the number of rows: 0 when the
 * id is in the list already (a repeated send), the list is full (50), or the person may not
 * change the project. The id is stored in lower case, whatever was sent.
 */
export async function addProjectMilestone(
  client: Queryable,
  projectId: string,
  milestone: { id: string; name: string; date: string | null },
): Promise<number> {
  const result = await client.query(
    `update office.projects p
        set milestones = p.milestones || jsonb_build_array(
          jsonb_build_object('id', ($2::uuid)::text, 'name', $3::text, 'date', $4::text, 'done', false))
      where p.id = $1 and p.company_id = office.ctx_company_id()
        and jsonb_array_length(p.milestones) < 50
        and not ${HAS_MILESTONE}`,
    [projectId, milestone.id, milestone.name, milestone.date],
  );
  return result.rowCount ?? 0;
}

/**
 * Changes the fields that were sent of one milestone; every field comes with a flag that says
 * whether it was sent (a day sent as null is cleared). The order of the list stays. Returns the
 * number of rows (0: no such entry, or the person may not change the project).
 */
export async function changeProjectMilestone(
  client: Queryable,
  projectId: string,
  milestoneId: string,
  changes: {
    name?: string | undefined;
    date?: string | null | undefined;
    done?: boolean | undefined;
  },
): Promise<number> {
  const result = await client.query(
    `update office.projects p
        set milestones = (
          select jsonb_agg(
            case when e.value ->> 'id' = ($2::uuid)::text then jsonb_build_object(
              'id', e.value -> 'id',
              'name', case when $3::boolean then to_jsonb($4::text) else e.value -> 'name' end,
              'date', case when $5::boolean then to_jsonb($6::text) else e.value -> 'date' end,
              'done', case when $7::boolean then to_jsonb($8::boolean) else e.value -> 'done' end)
            else e.value end
            order by e.ordinality)
          from jsonb_array_elements(p.milestones) with ordinality e)
      where p.id = $1 and p.company_id = office.ctx_company_id() and ${HAS_MILESTONE}`,
    [
      projectId,
      milestoneId,
      changes.name !== undefined,
      changes.name ?? null,
      changes.date !== undefined,
      changes.date ?? null,
      changes.done !== undefined,
      changes.done ?? null,
    ],
  );
  return result.rowCount ?? 0;
}

/** Takes one milestone off the list; 0 rows when it is not there (or the person may not). */
export async function removeProjectMilestone(
  client: Queryable,
  projectId: string,
  milestoneId: string,
): Promise<number> {
  const result = await client.query(
    `update office.projects p
        set milestones = coalesce((
          select jsonb_agg(e.value order by e.ordinality)
          from jsonb_array_elements(p.milestones) with ordinality e
          where e.value ->> 'id' <> ($2::uuid)::text), '[]'::jsonb)
      where p.id = $1 and p.company_id = office.ctx_company_id() and ${HAS_MILESTONE}`,
    [projectId, milestoneId],
  );
  return result.rowCount ?? 0;
}

export interface ProjectRunRow {
  id: string;
  task_id: string | null;
  task_title: string | null;
  agent_code: string;
  agent_name: string;
  status: string;
  error_code: string | null;
  started_at: Date;
  finished_at: Date | null;
  // bigint: pg gives it as text.
  duration_ms: string | null;
  // The five below are null for a reader who is not the founder (docs/SONRA.md P-t).
  input_tokens: number | null;
  output_tokens: number | null;
  cache_write_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: string | null;
}

/**
 * The newest runs of a project the person may read (the row policy of runs: the founder and the
 * members). No summary, no input and no output of a run is selected: the list carries no text
 * (docs/SONRA.md V-c). Tokens and cost are selected for the founder only.
 */
export async function listProjectRuns(
  client: Queryable,
  projectId: string,
  limit: number,
): Promise<ProjectRunRow[]> {
  const { rows } = await client.query<ProjectRunRow>(
    `select r.id, r.task_id, t.title as task_title, r.agent_code, d.name as agent_name,
            r.status, r.error_code, r.started_at, r.finished_at, r.duration_ms,
            case when office.is_founder() then r.input_tokens end as input_tokens,
            case when office.is_founder() then r.output_tokens end as output_tokens,
            case when office.is_founder() then r.cache_write_tokens end as cache_write_tokens,
            case when office.is_founder() then r.cache_read_tokens end as cache_read_tokens,
            case when office.is_founder() then r.cost_usd::text end as cost_usd
       from office.runs r
       join office.agent_definitions d on d.code = r.agent_code
       left join office.tasks t on t.id = r.task_id and t.kind = 'request'
      where r.project_id = $1 and r.company_id = office.ctx_company_id()
      order by r.started_at desc, r.id desc
      limit $2`,
    [projectId, limit],
  );
  return rows;
}

export interface ProjectRunTotalsRow {
  run_count: number;
  // Text (sums of integers and of numeric); null for a reader who is not the founder.
  cost_usd: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_write_tokens: string | null;
  cache_read_tokens: string | null;
}

/** The count and, for the founder, the sums over ALL runs of the project. */
export async function projectRunTotals(
  client: Queryable,
  projectId: string,
): Promise<ProjectRunTotalsRow> {
  const { rows } = await client.query<ProjectRunTotalsRow>(
    `select count(*)::int as run_count,
            case when office.is_founder() then coalesce(sum(r.cost_usd), 0)::text end as cost_usd,
            case when office.is_founder() then coalesce(sum(r.input_tokens), 0)::text end as input_tokens,
            case when office.is_founder() then coalesce(sum(r.output_tokens), 0)::text end as output_tokens,
            case when office.is_founder() then coalesce(sum(r.cache_write_tokens), 0)::text end as cache_write_tokens,
            case when office.is_founder() then coalesce(sum(r.cache_read_tokens), 0)::text end as cache_read_tokens
       from office.runs r
      where r.project_id = $1 and r.company_id = office.ctx_company_id()`,
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new Error('The totals of a project gave no row');
  return row;
}

/**
 * What the founder reads of a project's AI spending (8 October decision 17): the limit in US
 * dollars (null: none) and what the project's runs have cost so far. Null for anybody else and
 * for no project: the amounts are the founder's (docs/SONRA.md P-t). The founder reads every run
 * of the company through the row policy, so this sum is the one the database's own function
 * compares with the limit.
 */
export async function readProjectAiSpending(
  client: Queryable,
  projectId: string,
): Promise<{ limit_usd: string | null; spent_usd: string } | null> {
  const { rows } = await client.query<{ limit_usd: string | null; spent_usd: string }>(
    `select p.ai_spend_limit_usd::text as limit_usd,
            (select coalesce(sum(r.cost_usd), 0)::text from office.runs r
              where r.project_id = p.id) as spent_usd
       from office.projects p
      where p.id = $1 and p.company_id = office.ctx_company_id() and office.is_founder()
        and office.ctx_agent_code() is null`,
    [projectId],
  );
  return rows[0] ?? null;
}

/**
 * The founder sets, changes or (null) takes away the AI spending limit; the database asks for
 * the founder and, for a raise or a removal, for a passkey re-verification recorded in this
 * transaction. Returns whether the value changed.
 */
export async function setProjectAiSpendingLimit(
  client: Queryable,
  projectId: string,
  limitUsd: string | null,
): Promise<boolean> {
  const { rows } = await client.query<{ changed: boolean }>(
    'select office.set_project_ai_spending_limit($1, $2::numeric) as changed',
    [projectId, limitUsd],
  );
  return rows[0]?.changed === true;
}

export interface ProjectApprovalRow {
  id: string;
  task_id: string;
  task_title: string;
  agent_code: string;
  agent_name: string;
  status: string;
  invalidated_at: Date | null;
  attempt: number;
  created_at: Date;
  decided_at: Date | null;
  decided_by_user_id: string | null;
}

/**
 * The results of the requests of a project, as the row policy of approvals gives them to the
 * reader (docs/SONRA.md V-c): waiting ones first, then the newest. No title, summary, reasoning
 * or payload of an approval is selected: those are an agent's words.
 */
export async function listProjectApprovals(
  client: Queryable,
  projectId: string,
  limit: number,
): Promise<ProjectApprovalRow[]> {
  const { rows } = await client.query<ProjectApprovalRow>(
    `select a.id, a.task_id, t.title as task_title, a.agent_code, d.name as agent_name,
            a.status, a.invalidated_at, a.attempt, a.created_at, a.decided_at,
            a.decided_by_user_id
       from office.approvals a
       join office.tasks t on t.id = a.task_id and t.kind = 'request'
       join office.agent_definitions d on d.code = a.agent_code
      where a.project_id = $1 and a.company_id = office.ctx_company_id()
        and a.routing_id is not null
      order by (a.status = 'pending' and a.invalidated_at is null) desc,
               coalesce(a.decided_at, a.invalidated_at, a.created_at) desc, a.id
      limit $2`,
    [projectId, limit],
  );
  return rows;
}

/** Does the reader hold the approval right in the context company (the founder always does). */
export async function readerSeesUndecided(client: Queryable): Promise<boolean> {
  const { rows } = await client.query<{ sees: boolean | null }>(
    'select office.can_approve() as sees',
  );
  return rows[0]?.sees === true;
}

export interface ProjectMemberRow {
  user_id: string;
  // null: the person is no member of the company any more.
  name: string | null;
  role: string | null;
  active: boolean;
  // The role in the project: owner, manager or member (8 October decision 44).
  project_role: string;
}

/**
 * The members of a project with their role in it. The people come from the narrow team function,
 * so an employee reads the names and company roles of colleagues and nothing else of them.
 */
export async function listProjectMembers(
  client: Queryable,
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const { rows } = await client.query<ProjectMemberRow>(
    `select pm.user_id, pm.role as project_role, cp.name, cp.role,
            coalesce(cp.active, false) as active
     from office.project_members pm
     left join office.company_people() cp on cp.user_id = pm.user_id
     where pm.project_id = $1 and pm.company_id = office.ctx_company_id()
     order by cp.name nulls last, pm.user_id`,
    [projectId],
  );
  return rows;
}

/**
 * Adds a member, always as a plain member; a person who is a member already changes nothing. The
 * database lets the owner, a manager or the founder add (8 October decision 44) and refuses
 * anybody else (42501).
 */
export async function addProjectMember(
  client: Queryable,
  projectId: string,
  userId: string,
): Promise<void> {
  await client.query(
    `insert into office.project_members (company_id, project_id, user_id)
     values (office.ctx_company_id(), $1, $2)
     on conflict (project_id, user_id) do nothing`,
    [projectId, userId],
  );
}

/**
 * Removes a member; returns the number of rows (0: not a member, or not the caller's to remove).
 * The owner and the founder remove managers and members, a manager plain members; the owner is
 * never removed, and nobody but the founder removes themselves.
 */
export async function removeProjectMember(
  client: Queryable,
  projectId: string,
  userId: string,
): Promise<number> {
  const result = await client.query(
    `delete from office.project_members
     where project_id = $1 and user_id = $2 and company_id = office.ctx_company_id()`,
    [projectId, userId],
  );
  return result.rowCount ?? 0;
}

/**
 * Gives a member a role (decision 44). The database decides who may (the owner, the founder) and
 * what a hand-over of the ownership does to the owner until now. Returns whether anything changed.
 */
export async function setProjectMemberRole(
  client: Queryable,
  projectId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const { rows } = await client.query<{ changed: boolean }>(
    'select office.set_project_member_role($1, $2, $3) as changed',
    [projectId, userId, role],
  );
  return rows[0]?.changed === true;
}

/**
 * The founder opens or closes the AI permission of a project. `customerId` is the customer the
 * founder confirmed the opening for (null: none); the database refuses the opening when the
 * project has another one by now. It is not read when the permission is closed. Returns the
 * database's own answer: whether this call changed the value (the route starts the waiting work
 * again only when it opened the permission, 8 October decision 49).
 */
export async function setProjectAiPermission(
  client: Queryable,
  projectId: string,
  allowed: boolean,
  customerId: string | null,
): Promise<boolean> {
  const { rows } = await client.query<{ changed: boolean }>(
    'select office.set_project_ai_permission($1, $2, $3) as changed',
    [projectId, allowed, customerId],
  );
  return rows[0]?.changed === true;
}

export interface MemberCandidateRow {
  user_id: string;
  name: string;
  role: string;
}

/** Who can be made a project member: the active founders and employees of the context company. */
export async function listMemberCandidates(client: Queryable): Promise<MemberCandidateRow[]> {
  const { rows } = await client.query<MemberCandidateRow>(
    `select cp.user_id, cp.name, cp.role
     from office.company_people() cp
     where cp.role in ('founder', 'employee') and cp.active
     order by cp.name, cp.user_id`,
  );
  return rows;
}

export interface CustomerRow {
  id: string;
  name: string;
  ai_allowed: boolean;
  automated_processing_allowed: boolean;
}

const CUSTOMER_SQL = `
  select c.id, c.name, c.ai_allowed, c.automated_processing_allowed
  from office.customers c
  where c.company_id = office.ctx_company_id()`;

/** The customers of the context company, by name. */
export async function listCustomers(client: Queryable): Promise<CustomerRow[]> {
  const { rows } = await client.query<CustomerRow>(`${CUSTOMER_SQL} order by c.name, c.id`);
  return rows;
}

export async function readCustomer(
  client: Queryable,
  customerId: string,
): Promise<CustomerRow | null> {
  const { rows } = await client.query<CustomerRow>(`${CUSTOMER_SQL} and c.id = $1`, [customerId]);
  return rows[0] ?? null;
}

/**
 * Adds a customer by name, with both contract permissions closed. Never with "on conflict": a
 * re-verification names the id of the customer that is being added, so an id that exists must
 * fail (23505) and never be taken over.
 */
export async function insertCustomer(
  client: Queryable,
  customer: { id: string; name: string },
): Promise<void> {
  await client.query(
    'insert into office.customers (id, company_id, name) values ($1, office.ctx_company_id(), $2)',
    [customer.id, customer.name],
  );
}

/** The founder sets contract permissions of a customer; a permission left out stays as it is. */
export async function setCustomerPermissions(
  client: Queryable,
  customerId: string,
  permissions: {
    aiAllowed?: boolean | undefined;
    automatedProcessingAllowed?: boolean | undefined;
  },
): Promise<void> {
  await client.query('select office.set_customer_permissions($1, $2, $3)', [
    customerId,
    permissions.aiAllowed ?? null,
    permissions.automatedProcessingAllowed ?? null,
  ]);
}

/** The kind of the context company ('company' or 'private_space'); null when it is not visible. */
export async function readCompanyKind(client: Queryable): Promise<string | null> {
  const { rows } = await client.query<{ kind: string }>(
    'select c.kind from office.companies c where c.id = office.ctx_company_id()',
  );
  return rows[0]?.kind ?? null;
}
