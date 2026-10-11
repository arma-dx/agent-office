-- Raising or removing the AI spending limit of a project starts the held work again (11 October
-- decision 1; 8 October decisions 17 and 49; docs/SONRA.md P3-s; CLAUDE.md rules 9 and 12).
--
-- The limit migration (20261008102900) took the conservative reading: work a reached limit
-- stopped fell to a person and stayed there. The founder decided otherwise: when the limit of a
-- project is raised or removed, the waiting work of that project starts again by itself, as it
-- does when an AI permission or a stopped agent is opened again (decision 49), and the
-- confirmation says beforehand how many requests will start. From here on:
--   - a run the limit stopped (status stopped, error code spending_limit_reached) is waiting
--     work, like a run a switch stopped; a job the limit refused was a missed start already;
--   - the limit route calls office.restart_waiting_work for the project after a raise or a
--     removal (that function picks what can start NOW: nothing while the new limit is still
--     reached) and puts one job per request on the queue in the same transaction;
--   - office.count_work_held_by_spending_limit tells the founder, before the passkey, how many
--     requests the new value would start.
-- A limit changed without the panel (an administrator, the seed) starts nothing, as an AI
-- permission opened by hand starts nothing (docs/SONRA.md P2-x). While a limit is reached
-- nothing changes: no run row, no restart, no count for any other opening.
--
-- Error codes of the count: 42501 not the founder, or an agent run; 22023 no project.

-- office.flow_waiting_work as of the AI spending limit migration (20261008102900), with a run
-- the limit stopped counted as stopped by a switch and with one more value of its fourth
-- parameter. "create or replace" keeps the owner (office_trigger) and the privileges (nobody but
-- functions of the same owner).
/*
 * The open requests of a company that wait to start and can start now, for the flow's own
 * functions. One row per request: the agent whose turn it is. Work waits when its latest run
 * since it was called for was stopped by a switch (the agent's stop switch, a closed AI
 * permission, a reached AI spending limit), or when it has no run since and a start was missed.
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

/*
 * How many waiting requests of this project would start if the founder set its AI spending
 * limit to p_limit now (null: no limit): the number the confirmation of a raise or a removal
 * shows BEFORE the founder confirms (11 October decision 1). The rule of the restart
 * (office.flow_waiting_work), with the limit read as not reached; 0 when the new limit would
 * still be reached by what the project has spent, and for a project of another company. Reads
 * only: no lock, no trace. Only the founder, only through the API.
 */
create function office.count_work_held_by_spending_limit(p_project uuid, p_limit numeric)
  returns integer
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_company uuid := office.ctx_company_id();
begin
  if p_project is null then
    raise exception 'The project must be given' using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder is told how much work waits'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from office.projects p where p.id = p_project and p.company_id = v_company
  ) then
    return 0;
  end if;
  -- 'NaN' is no limit the founder can set (the limit function refuses it): it counts 0.
  if p_limit is not null
     and (p_limit = 'NaN'::numeric or office.project_ai_spending(p_project) >= p_limit) then
    return 0;
  end if;
  return (
    select pg_catalog.count(*)::integer
    from office.flow_waiting_work(v_company, null, array[p_project], 'spending_limit')
  );
end
$$;
alter function office.count_work_held_by_spending_limit(uuid, numeric) owner to office_trigger;
revoke execute on function office.count_work_held_by_spending_limit(uuid, numeric) from public;
grant execute on function office.count_work_held_by_spending_limit(uuid, numeric)
  to office_api_private;
