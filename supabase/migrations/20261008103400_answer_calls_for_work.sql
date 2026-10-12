-- An answer calls for the work again (12 October decisions 3 and 4; 8 October decision 49;
-- 11 October decision 1). The second half of the question migration: what the pages and the
-- restart read of a question.
--
--   office.request_flow_facts   two more columns for everybody who reads a request: whether a
--                               question waits for its answer (a yes or no, never text) and the
--                               time of the latest answer to whoever has the turn. The stage of
--                               a request is derived from them (packages/shared: deriveStage).
--   office.flow_waiting_work    the moment of that answer is a moment the work was called for,
--                               so an answer that found its agent stopped, the AI permission
--                               closed or the AI spending limit reached is started by the
--                               existing restart when the block lifts; a request with an open
--                               question is never waiting work.
-- Nothing else of the two functions changes; each is taken from its newest definition.


-- The result gets two columns, so the function is created again (as of the migration "work
-- starts again", 20261008102500, with open_question and answered_at added).
drop function office.request_flow_facts(uuid[]);
create function office.request_flow_facts(p_tasks uuid[])
  returns table (
    task_id uuid,
    pending_result boolean,
    last_result_status text,
    last_result_attempt smallint,
    last_change_request_at timestamptz,
    rejected_by_user_id uuid,
    rejected_reason text,
    rejected_note text,
    not_started_at timestamptz,
    restarted_at timestamptz,
    open_question boolean,
    answered_at timestamptz
  )
  language sql stable security definer set search_path = ''
  as $$
    select t.id,
      exists (
        select 1 from office.approvals a
        where a.task_id = t.id and a.routing_id is not null
          and a.status = 'pending' and a.invalidated_at is null
      ),
      lr.status,
      lr.attempt,
      (
        select max(d.at) from (
          select a.decided_at as at from office.approvals a
            where a.task_id = t.id and a.routing_id = s.id and a.status = 'changes_requested'
          union all
          -- The requester's, on a result of the active step.
          select q.decided_at from office.requester_approvals q
            join office.approvals qa on qa.id = q.approval_id and qa.routing_id = s.id
            where q.task_id = t.id and q.status = 'changes_requested'
        ) d
      ),
      rj.decided_by_user_id,
      rj.rejection_reason,
      rj.decision_reason,
      -- The latest time a run was called for and not started, for the agent whose turn it is.
      -- A missed start that a restart was written AFTER (a later row of the trace) is answered
      -- by that restart and is not counted: occurred_at is the start of the writing transaction,
      -- so the clock alone can put a restart before the trace it answers.
      (
        select max(l.occurred_at) from office.audit_log l
        where l.record_type = 'task' and l.record_id = t.id
          and l.event in ('run_refused', 'run_not_started')
          and l.company_id = t.company_id
          and not exists (
            select 1 from office.audit_log x
            where x.record_type = 'task' and x.record_id = t.id
              and x.event = 'run_restarted' and x.company_id = t.company_id
              and x.id > l.id
          )
          and (
            -- Written by the API in a person's name: about the step that was active then.
            l.event = 'run_not_started'
            or l.agent_code = case
              when s.id is not null then s.agent_code
              when not exists (select 1 from office.task_routings r where r.task_id = t.id)
                then office.coordinator_agent_code()
            end
          )
      ),
      -- The latest time waiting work of this request was called for again (decision 49).
      (
        select max(l.occurred_at) from office.audit_log l
        where l.record_type = 'task' and l.record_id = t.id
          and l.event = 'run_restarted'
          and l.company_id = t.company_id
      ),
      -- A question waits for its answer: a yes or no for everybody who reads the request; the
      -- text is read from the table by those who may.
      exists (
        select 1 from office.task_questions k where k.task_id = t.id and k.status = 'open'
      ),
      -- The latest answer to a question of whoever has the turn now (the agent of the active
      -- step, or the coordinator while the request is not routed): the answer calls for the
      -- work again.
      (
        select max(k.answered_at) from office.task_questions k
        where k.task_id = t.id and k.status = 'answered'
          and k.routing_id is not distinct from s.id
          and (
            s.id is not null
            or not exists (select 1 from office.task_routings r where r.task_id = t.id)
          )
      )
    from office.tasks t
    left join office.task_routings s on s.task_id = t.id and s.status = 'active'
    left join lateral (
      select a.status, a.attempt from office.approvals a
      where a.task_id = t.id and a.routing_id = s.id
        and a.status <> 'pending' and a.invalidated_at is null
      order by a.decided_at desc
      limit 1
    ) lr on true
    -- The rejection that closed the request: the decider's name, class and words, never the output.
    left join lateral (
      select a.decided_by_user_id, a.rejection_reason, a.decision_reason from office.approvals a
      where a.task_id = t.id and a.routing_id is not null and a.status = 'rejected'
        and t.status = 'cancelled'
      order by a.decided_at desc
      limit 1
    ) rj on true
    where t.id = any (p_tasks)
      and t.kind = 'request'
      and t.company_id = office.ctx_company_id()
      -- The row rule of a task for a person (office.row_visible), written out: the function runs
      -- with the flow's rights, which do not reach the tables that rule reads for an agent run.
      and office.ctx_agent_code() is null
      and office.is_insider()
      and (
        t.project_id is null or office.is_founder() or office.is_project_member(t.project_id)
      )
  $$;
alter function office.request_flow_facts(uuid[]) owner to office_trigger;
revoke execute on function office.request_flow_facts(uuid[]) from public;
grant execute on function office.request_flow_facts(uuid[]) to office_api_private;

-- office.flow_waiting_work as of the migration "spending limit restarts work"
-- (20261008103000), with two additions (marked "question"): the moment of the latest answer is
-- a moment the work was called for, and a request with an open question waits for a person, not
-- for a switch. "create or replace" keeps the owner (office_trigger) and the privileges (nobody
-- but functions of the same owner).
/*
 * The open requests of a company that wait to start and can start now, for the flow's own
 * functions. One row per request: the agent whose turn it is. Work waits when its latest run
 * since it was called for was stopped by a switch (the agent's stop switch, a closed AI
 * permission, a reached AI spending limit), or when it has no run since and a start was missed.
 * The work is called for by the routing of its step, a change request, a restart and the answer
 * to a question of its agent.
 *   p_company     the company
 *   p_agent       only work of this agent (null: any)
 *   p_projects    only requests inside one of these projects (null: any, also without a project)
 *   p_as_if_open  null: what can start NOW (the restart). 'agent', 'project', 'customer' or
 *                 'spending_limit': what WOULD start if that one thing no longer held the work
 *                 (the count shown before the founder confirms): the agent's stop switch, the
 *                 projects' own AI permission, their customer's, or the projects' AI spending
 *                 limit. Every other condition is asked as it is now.
 * Work inside a project whose AI spending limit is reached cannot start, whatever is opened
 * (8 October decision 17); it starts when the limit is raised or removed (11 October decision 1).
 * Not callable by the application.
 */
create or replace function office.flow_waiting_work(
  p_company uuid, p_agent text, p_projects uuid[], p_as_if_open text default null
)
  returns table (task_id uuid, project_id uuid, agent_code text, requester_user_id uuid)
  language sql stable security definer set search_path = ''
  as $$
    with turn as (
      select t.id, t.company_id, t.project_id, t.requester_user_id, s.id as step_id,
        case
          when s.id is not null then s.agent_code
          when not exists (select 1 from office.task_routings r where r.task_id = t.id)
            then office.coordinator_agent_code()
        end as agent_code,
        -- The moment the work was last called for.
        greatest(
          coalesce(s.created_at, t.created_at),
          (
            select max(a.decided_at) from office.approvals a
            where a.task_id = t.id and a.routing_id = s.id and a.status = 'changes_requested'
          ),
          (
            select max(q.decided_at) from office.requester_approvals q
            join office.approvals qa on qa.id = q.approval_id and qa.routing_id = s.id
            where q.task_id = t.id and q.status = 'changes_requested'
          ),
          (
            select max(l.occurred_at) from office.audit_log l
            where l.record_type = 'task' and l.record_id = t.id
              and l.event = 'run_restarted' and l.company_id = t.company_id
          ),
          -- question: the answer to a question of whoever has the turn (null routing: the
          -- coordinator's question, counted only while the request is not routed).
          (
            select max(k.answered_at) from office.task_questions k
            where k.task_id = t.id and k.status = 'answered'
              and k.routing_id is not distinct from s.id
              and (
                s.id is not null
                or not exists (select 1 from office.task_routings r where r.task_id = t.id)
              )
          )
        ) as called_at,
        -- The row of the latest restart in the trace (0: none). A missed start counts only
        -- when it was written after it: the clock of a trace is the start of its transaction,
        -- and an opening that began before a refusal was written would otherwise be picked a
        -- second time for the same refusal.
        coalesce((
          select max(l.id) from office.audit_log l
          where l.record_type = 'task' and l.record_id = t.id
            and l.event = 'run_restarted' and l.company_id = t.company_id
        ), 0) as restart_row
      from office.tasks t
      left join office.task_routings s on s.task_id = t.id and s.status = 'active'
      where t.company_id = p_company
        and t.kind = 'request'
        and t.status not in ('done', 'cancelled')
        and (p_projects is null or t.project_id = any (p_projects))
    )
    select w.id, w.project_id, w.agent_code, w.requester_user_id
    from turn w
    where w.agent_code is not null
      and (p_agent is null or w.agent_code = p_agent)
      -- Nothing waits for a decision.
      and not exists (
        select 1 from office.approvals a
        where a.task_id = w.id and a.routing_id is not null
          and a.status = 'pending' and a.invalidated_at is null
      )
      and not exists (
        select 1 from office.requester_approvals q
        where q.task_id = w.id and q.status = 'pending' and q.invalidated_at is null
      )
      -- question: nothing waits for an answer.
      and not exists (
        select 1 from office.task_questions k where k.task_id = w.id and k.status = 'open'
      )
      -- Not after the second change request (2 October decision 10): that work is a person's.
      and not exists (
        select 1 from (
          select a.status, a.attempt from office.approvals a
          where a.task_id = w.id and a.routing_id = w.step_id
            and a.status <> 'pending' and a.invalidated_at is null
          order by a.decided_at desc
          limit 1
        ) lr
        where lr.status = 'changes_requested' and lr.attempt >= 2
      )
      -- The agent has no open run of this step.
      and not exists (
        select 1 from office.runs r
        where r.task_id = w.id and r.agent_code = w.agent_code and r.status = 'running'
          and r.routing_id is not distinct from w.step_id
      )
      -- (a) its latest run since the call was stopped by a switch, or (b) it has none since the
      -- call and a start was missed.
      and case
        when exists (
          select 1 from office.runs r
          where r.task_id = w.id and r.agent_code = w.agent_code and r.started_at >= w.called_at
        ) then (
          select r.status = 'stopped' and r.error_code in (
            'agent_stopped', 'ai_permission_closed', 'spending_limit_reached'
          )
          from office.runs r
          where r.task_id = w.id and r.agent_code = w.agent_code and r.started_at >= w.called_at
          order by r.started_at desc, r.id desc
          limit 1
        )
        else exists (
          select 1 from office.audit_log l
          where l.record_type = 'task' and l.record_id = w.id and l.company_id = w.company_id
            and l.occurred_at >= w.called_at
            and l.id > w.restart_row
            and (
              l.event = 'run_not_started'
              or (l.event = 'run_refused' and l.agent_code = w.agent_code)
            )
        )
      end
      -- It can start: the agent has a card version to run with ...
      and exists (
        select 1 from office.agent_definitions d
        where d.code = w.agent_code and d.current_version_id is not null
      )
      -- ... is open here (or is the switch the count is asked for) ...
      and (
        p_as_if_open is not distinct from 'agent'
        or exists (
          select 1 from office.company_agents ca
          where ca.company_id = w.company_id and ca.agent_code = w.agent_code
            and ca.status = 'enabled'
        )
      )
      -- ... and agents may work in its project (rule 12; or would, with the one switch open).
      and (
        w.project_id is null or exists (
          select 1 from office.projects p
          where p.id = w.project_id
            and (p.ai_allowed or p_as_if_open is not distinct from 'project')
            and (
              p.customer_id is null
              or p_as_if_open is not distinct from 'customer'
              or exists (
                select 1 from office.customers c where c.id = p.customer_id and c.ai_allowed
              )
            )
        )
      )
      -- ... and the AI spending limit of its project is not reached (decision 17; or is the one
      -- thing the count is asked for): no opening starts work the runner would refuse at once.
      and (
        w.project_id is null
        or p_as_if_open is not distinct from 'spending_limit'
        or not exists (
          select 1 from office.projects p
          where p.id = w.project_id
            and p.ai_spend_limit_usd is not null
            and office.project_ai_spending(p.id) >= p.ai_spend_limit_usd
        )
      )
  $$;
