-- Work that waits starts again by itself (8 October decision 49; docs/SONRA.md Y-j, P2-e).
--
-- Until now nothing started when the founder opened a stopped agent again, or opened the AI
-- permission of a project again: every request that had been waiting stayed with a person, who
-- gave it to an agent anew ("Yönlendirmeyi düzelt"). The founder's answer: the waiting work starts
-- again by itself, for a reopened permission and for a reopened agent alike.
--
-- Which work waits. An open request whose turn is an agent's (the agent of its active step; the
-- coordinator while nobody has routed it), with nothing waiting for a decision and not after the
-- second change request, WAITS TO START when that agent has no open run of that step and, since
-- the work was last called for (the routing of the step, the last change request, the opening of
-- the request, or an earlier restart), either
--   (a) the agent's latest run on it was stopped by a switch: error code agent_stopped (the
--       agent's stop switch) or ai_permission_closed (an AI permission was closed); or
--   (b) the agent has no run on it and a start was missed: a trace run_refused (the runner
--       refused the job) or run_not_started (a change request found the agent stopped).
-- A run that ended by itself (failed, hit its limit, ended without a result, was stopped because
-- the request changed) is not waiting work: a person decides what happens to it. A request whose
-- job is still on the queue (no run, no trace) is not restarted either: its job is there.
--
-- Waiting work STARTS when it can: its agent is open in the company and has a card version, and
-- agents may work in its project (rule 12). office.restart_waiting_work picks exactly that work,
-- for one agent, one project or the projects of one customer; writes the trace run_restarted on
-- each request (from that moment the request reads as called for again); and returns the ids the
-- API puts on the queue in the same transaction (ids only, rule 10). A second call finds nothing:
-- the trace moved the moment of the call, and calls for one company wait for each other.
--
-- The same trace is written when a run is handed over (decision 45): a run that is open when its
-- person stops being the one the database resolves (the requester was taken out of the project,
-- left the company, became an external person or was deactivated) is hidden from its own
-- context. office.hand_run_over closes exactly such a run (stopped, identity_changed), adds the
-- usage of the model call that was answered meanwhile, and writes the trace; the runner puts the
-- same job on the queue in the same transaction, and the new run opens in the founder's name.
--
-- The confirmation of an opening says how many requests it will start before the founder
-- confirms (an opening starts paid runs): office.count_waiting_work counts by the same rule, with
-- the one switch read as open, and writes nothing.
--
-- Error codes: 42501 not the founder, an agent run, or (hand_run_over) no agent run; 22023 not
-- exactly one of the three arguments, or a usage that is missing or negative.

-- The trace is the restart's alone: no request of the API and no agent run can write that work
-- was called for again (as the permission events belong to the permission changes).
create policy reserved_restart_event on office.audit_log as restrictive for insert to office_app
  with check (event <> 'run_restarted');
create policy restart_records on office.audit_log for insert to office_trigger
  with check (
    event = 'run_restarted'
    and record_type = 'task'
    and (office.ctx_company_id() is null or company_id = office.ctx_company_id())
  );
create policy flow_reads_restarts on office.audit_log for select to office_trigger
  using (record_type = 'task' and event = 'run_restarted');
create index audit_log_restarts on office.audit_log (record_id)
  where record_type = 'task' and event = 'run_restarted';

-- The flow reads when a run started and how it ended.
grant select (started_at, error_code) on office.runs to office_trigger;
-- ... and the order in which traces were written (their id, see below).
grant select (id) on office.audit_log to office_trigger;

-- The result gets a column, so the function is created again (as of the migration "work that did
-- not start", 20261008100900, with restarted_at added).
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
    restarted_at timestamptz
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

/*
 * The open requests of a company that wait to start and can start now (the header says which),
 * for the flow's own functions. One row per request: the agent whose turn it is.
 *   p_company     the company
 *   p_agent       only work of this agent (null: any)
 *   p_projects    only requests inside one of these projects (null: any, also without a project)
 *   p_as_if_open  null: what can start NOW (the restart). 'agent', 'project' or 'customer': what
 *                 WOULD start if that one switch were open (the count shown before an opening):
 *                 the agent's stop switch, the projects' own AI permission, or their customer's.
 *                 Every other condition is asked as it is now.
 * Not callable by the application.
 */
create function office.flow_waiting_work(
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
          select r.status = 'stopped' and r.error_code in ('agent_stopped', 'ai_permission_closed')
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
  $$;
alter function office.flow_waiting_work(uuid, text, uuid[], text) owner to office_trigger;
revoke execute on function office.flow_waiting_work(uuid, text, uuid[], text) from public;

/*
 * The founder opened an agent or an AI permission again (decision 49): the work that waited for
 * it is called for again. Exactly one argument is given:
 *   p_agent     the agent that was opened in the context company;
 *   p_project   the project whose AI permission was opened;
 *   p_customer  the customer whose AI permission was opened (its projects).
 * Writes the trace run_restarted on every request it picks and returns them; the API puts one job
 * per row on the queue in this same transaction: the request, the agent, and the requester as the
 * job's person (in whose name the run goes is resolved when the run opens). Only the founder,
 * only through the API. Calls for one company wait for each other, so no request is picked twice.
 */
create function office.restart_waiting_work(p_agent text, p_project uuid, p_customer uuid)
  returns table (task_id uuid, agent_code text, requester_user_id uuid)
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid := office.ctx_company_id();
  v_projects uuid[];
  v_row record;
begin
  if pg_catalog.num_nonnulls(p_agent, p_project, p_customer) <> 1 then
    raise exception 'Exactly one of the agent, the project and the customer must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder starts waiting work again'
      using errcode = 'insufficient_privilege';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('office.restart:' || v_company::text, 0)
  );
  if p_project is not null then
    v_projects := array[p_project];
  elsif p_customer is not null then
    v_projects := coalesce(
      (
        select pg_catalog.array_agg(p.id) from office.projects p
        where p.company_id = v_company and p.customer_id = p_customer
      ),
      '{}'::uuid[]
    );
  end if;
  for v_row in
    select w.task_id, w.project_id, w.agent_code, w.requester_user_id
    from office.flow_waiting_work(v_company, p_agent, v_projects) w
    order by w.task_id
  loop
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (v_company, v_row.project_id, 'run_restarted', 'task', v_row.task_id);
    task_id := v_row.task_id;
    agent_code := v_row.agent_code;
    requester_user_id := v_row.requester_user_id;
    return next;
  end loop;
end
$$;
alter function office.restart_waiting_work(text, uuid, uuid) owner to office_trigger;
revoke execute on function office.restart_waiting_work(text, uuid, uuid) from public;
grant execute on function office.restart_waiting_work(text, uuid, uuid) to office_api_private;

/*
 * How many waiting requests would start if the founder opened this agent, this project's AI
 * permission or this customer's AI permission now (decision 49): the number the confirmation of
 * the opening shows BEFORE the founder confirms. Exactly one argument, as
 * office.restart_waiting_work; the same rule (office.flow_waiting_work), with that one switch
 * read as open. Reads only: no lock, no trace. Only the founder, only through the API.
 */
create function office.count_waiting_work(p_agent text, p_project uuid, p_customer uuid)
  returns integer
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_company uuid := office.ctx_company_id();
  v_projects uuid[];
begin
  if pg_catalog.num_nonnulls(p_agent, p_project, p_customer) <> 1 then
    raise exception 'Exactly one of the agent, the project and the customer must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder is told how much work waits'
      using errcode = 'insufficient_privilege';
  end if;
  if p_project is not null then
    v_projects := array[p_project];
  elsif p_customer is not null then
    v_projects := coalesce(
      (
        select pg_catalog.array_agg(p.id) from office.projects p
        where p.company_id = v_company and p.customer_id = p_customer
      ),
      '{}'::uuid[]
    );
  end if;
  return (
    select pg_catalog.count(*)::integer
    from office.flow_waiting_work(
      v_company, p_agent, v_projects,
      case
        when p_agent is not null then 'agent'
        when p_project is not null then 'project'
        else 'customer'
      end
    )
  );
end
$$;
alter function office.count_waiting_work(text, uuid, uuid) owner to office_trigger;
revoke execute on function office.count_waiting_work(text, uuid, uuid) from public;
grant execute on function office.count_waiting_work(text, uuid, uuid) to office_api_private;

/*
 * A run whose person is no longer the one the database resolves for its request (decision 45).
 * The run is hidden from its own context from that moment, so the runner can neither write to it
 * nor close it. This closes exactly such a run, for the run's own context (the company, the agent
 * and the person a run row is written with): status stopped, error code identity_changed, the
 * tokens and the cost of the model call that was answered meanwhile added (rule 5), one audit row
 * for the stop and the trace run_restarted on the request. Returns whether a run was closed:
 * false for a run that is not open, that belongs to somebody else, that is not on a request, or
 * whose person is still the resolved one. The runner puts the same job on the queue in the same
 * transaction; the new run opens in the name the database resolves now.
 */
create function office.hand_run_over(
  p_run uuid, p_input integer, p_output integer, p_cache_write integer, p_cache_read integer,
  p_cost numeric
) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid;
  v_project uuid;
  v_task uuid;
begin
  if office.ctx_agent_code() is null then
    raise exception 'A run is handed over by that run'
      using errcode = 'insufficient_privilege';
  end if;
  if p_run is null or p_input is null or p_output is null or p_cache_write is null
     or p_cache_read is null or p_cost is null
     or p_input < 0 or p_output < 0 or p_cache_write < 0 or p_cache_read < 0 or p_cost < 0 then
    raise exception 'The usage must be given and cannot be negative'
      using errcode = 'invalid_parameter_value';
  end if;
  update office.runs r set
      status = 'stopped', finished_at = pg_catalog.now(), error_code = 'identity_changed',
      input_tokens = r.input_tokens + p_input,
      output_tokens = r.output_tokens + p_output,
      cache_write_tokens = r.cache_write_tokens + p_cache_write,
      cache_read_tokens = r.cache_read_tokens + p_cache_read,
      cost_usd = r.cost_usd + p_cost
    where r.id = p_run
      and r.company_id = office.ctx_company_id()
      and r.agent_code = office.ctx_agent_code()
      and r.user_id = office.ctx_user_id()
      and r.status = 'running'
      and r.task_id is not null
      -- Null (not a request) is not "another person": nothing is closed then.
      and office.request_run_identity(r.task_id) <> r.user_id
    returning r.company_id, r.project_id, r.task_id into v_company, v_project, v_task;
  if v_task is null then
    return false;
  end if;
  insert into office.audit_log (company_id, project_id, event, record_type, record_id, run_id)
    values (v_company, v_project, 'run_stopped', 'task', v_task, p_run);
  insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    values (v_company, v_project, 'run_restarted', 'task', v_task);
  return true;
end
$$;
alter function office.hand_run_over(uuid, integer, integer, integer, integer, numeric)
  owner to office_trigger;
revoke execute on function
  office.hand_run_over(uuid, integer, integer, integer, integer, numeric) from public;
grant execute on function
  office.hand_run_over(uuid, integer, integer, integer, integer, numeric) to office_app;
