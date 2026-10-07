-- The routing decision as a record that can be corrected, and closing a request by hand
-- (7 October decisions 1, 3 and 7; PLAN M8: "yönlendirme kararları kayıtlı ve düzeltilebilir").
--
-- One row is one step: the unit, the agent of that unit and the person appointed to approve its
-- work. A routing is the rows of one round, in the order of seq: several agents work in turn, one
-- step at a time. Round 1 is the coordinator's first decision; a correction (by the coordinator
-- after a "not mine" return, by the step's approver or by the founder) is a new round that
-- replaces the steps still open. Rows are never rewritten or deleted: only their status moves.
-- The reason is free text and lives here, because audit_log holds names and ids only
-- (2 October decision 13).
--
-- Written only by office.route_request (the coordinator), office.correct_routing (a person) and
-- the flow functions; the application reads.

create table office.task_routings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- Comes from the task's project.
  project_id uuid,
  task_id uuid not null,
  round smallint not null check (round >= 1),
  seq smallint not null check (seq between 1 and 8),
  unit_code text not null references office.units (code),
  -- null: no agent of the unit can take the work; the step waits for the unit's approver (T8).
  agent_code text references office.agent_definitions (code),
  -- The person appointed to approve this step's work when it was routed; null: nobody is
  -- appointed, the founder decides.
  approver_user_id uuid,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'done', 'replaced', 'cancelled')),
  -- Who routed: an agent from its own run, or a person.
  routed_by_agent_code text references office.agent_definitions (code),
  routed_by_user_id uuid references office.users (id),
  run_id uuid,
  reason text check (reason is null or length(reason) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (task_id, round, seq),
  unique (id, company_id),
  foreign key (task_id, company_id) references office.tasks (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (run_id, company_id) references office.runs (id, company_id),
  foreign key (company_id, approver_user_id) references office.memberships (company_id, user_id)
    on delete set null (approver_user_id),
  constraint routed_by_someone check (routed_by_agent_code is not null or routed_by_user_id is not null),
  constraint agent_run check ((routed_by_agent_code is null) = (run_id is null))
);
-- One step of a request is active at a time.
create unique index task_routings_single_active on office.task_routings (task_id)
  where status = 'active';
create index task_routings_approver on office.task_routings (company_id, approver_user_id)
  where status = 'active';

alter table office.task_routings enable row level security;
alter table office.task_routings force row level security;
grant select on office.task_routings to office_app;
-- Whoever sees the request sees where it was routed and who approves it.
create policy visible on office.task_routings for select to office_app
  using (office.row_visible(company_id, project_id));

grant select, insert, update (status) on office.task_routings to office_trigger;
create policy flow_all on office.task_routings for all to office_trigger
  using (true) with check (true);
grant select on office.units, office.agent_definitions to office_trigger;
grant select (id, code) on office.companies to office_trigger;
create policy flow_reads on office.companies for select to office_trigger using (true);
grant select (company_id, agent_code, status) on office.company_agents to office_trigger;
create policy flow_reads on office.company_agents for select to office_trigger using (true);
grant select (id, company_id, task_id, agent_code, status) on office.runs to office_trigger;
grant select (task_id) on office.approvals to office_trigger;
-- The flow writes its own audit rows (names and ids only): who and when come from the context.
-- "task_" is there for the task audit trigger, which runs with the caller's rights: when the flow
-- moves a request, that trigger writes as office_trigger.
grant insert (company_id, project_id, event, record_type, record_id) on office.audit_log
  to office_trigger;
-- Without a context (the seed, an administrator changing a record an approval is based on) the row
-- is written without an actor, as the task audit trigger does; the application always has one.
create policy flow_records on office.audit_log for insert to office_trigger
  with check (
    event ~ '^(task|request|approval|requester_approval)_'
    and (office.ctx_company_id() is null or company_id = office.ctx_company_id())
  );

-- Closes what is still waiting on a request when it is routed again or closed: pending approvals
-- (the output answers a routing that no longer holds). The requester approvals migration replaces
-- it to close the requester's pending approval too.
create function office.flow_close_pending(p_task uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  update office.approvals a set invalidated_at = pg_catalog.now()
    where a.task_id = p_task and a.status = 'pending' and a.invalidated_at is null;
end
$$;
alter function office.flow_close_pending(uuid) owner to office_trigger;
revoke execute on function office.flow_close_pending(uuid) from public;

/*
 * The agent every new request goes to first, and the only agent that routes (7 October decision
 * 1: the coordination centre decides which unit a request concerns). One place in the database;
 * COORDINATOR_AGENT_CODE in packages/shared says the same and a test holds the two together.
 */
create function office.coordinator_agent_code() returns text
  language sql immutable set search_path = ''
  as $$ select 'KOR-1'::text $$;
grant execute on function office.coordinator_agent_code() to office_app, office_trigger;

/*
 * Routes a request, or corrects its routing. The inner function: not callable by the application,
 * reached only through the two functions after it.
 *   p_steps  [{"unit": "SOS", "agent": "SOS-2", "reason": "..."}, ...] in the order of work;
 *            "agent" may be null (no agent can take it: the step waits for the unit's approver).
 *   p_run    the caller's own running run on this request (an agent), null for a person.
 * Who may: the coordinator from its own running run on this request (office.route_request); the
 * founder and the appointed approver of the active step (office.correct_routing, 7 October
 * decision 7). The approver of each step is appointed here from the company's settings, never
 * from an argument (decision 3). Returns the round.
 */
create function office.flow_route_request(p_task uuid, p_steps jsonb, p_run uuid)
  returns smallint
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_task office.tasks;
  v_company_code text;
  v_agent text := office.ctx_agent_code();
  v_user uuid := office.ctx_user_id();
  v_round smallint;
  v_step jsonb;
  v_seq smallint := 0;
  v_unit text;
  v_step_agent text;
  v_first_unit text;
  v_first_agent text;
begin
  select t.id, t.company_id, t.project_id, t.kind, t.status, t.initial_unit_code,
         t.routing_corrected
    into v_task.id, v_task.company_id, v_task.project_id, v_task.kind, v_task.status,
         v_task.initial_unit_code, v_task.routing_corrected
    from office.tasks t
    where t.id = p_task and t.company_id = office.ctx_company_id() and t.kind = 'request'
    for update;
  if v_task.id is null or office.my_role() is null then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if v_task.status in ('done', 'cancelled') then
    raise exception 'A closed request is not routed' using errcode = 'check_violation';
  end if;

  if v_agent is not null then
    -- Only the coordinator routes: a unit agent that reached this function (a forged job, a tool
    -- it was never given) cannot hand a request to itself or to anybody else.
    if v_agent <> office.coordinator_agent_code() or not exists (
      select 1 from office.runs r
      where r.id = p_run and r.company_id = v_task.company_id and r.task_id = p_task
        and r.agent_code = v_agent and r.status = 'running'
    ) then
      raise exception 'Only the coordinator routes a request, from its own running run on it'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not (
      office.is_founder()
      or (office.can_approve() and exists (
        select 1 from office.task_routings r
        where r.task_id = p_task and r.status = 'active' and r.approver_user_id = v_user
      ))
    ) then
      raise exception 'Only the approver of the request or the founder corrects its routing'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_steps is null or pg_catalog.jsonb_typeof(p_steps) <> 'array'
     or pg_catalog.jsonb_array_length(p_steps) not between 1 and 8 then
    raise exception 'A routing has one to eight steps' using errcode = 'invalid_parameter_value';
  end if;
  select c.code into v_company_code from office.companies c where c.id = v_task.company_id;
  select coalesce(max(r.round), 0) + 1 into v_round
    from office.task_routings r where r.task_id = p_task;

  -- The steps still open give way; what was done stays done.
  update office.task_routings r set status = 'replaced'
    where r.task_id = p_task and r.status in ('planned', 'active');
  perform office.flow_close_pending(p_task);

  for v_step in select * from pg_catalog.jsonb_array_elements(p_steps) loop
    v_seq := v_seq + 1;
    v_unit := v_step ->> 'unit';
    v_step_agent := v_step ->> 'agent';
    if not exists (
      select 1 from office.units u
      where u.code = v_unit and (u.company_code is null or u.company_code = v_company_code)
    ) then
      raise exception 'Unit % does not belong to this company', coalesce(v_unit, '(none)')
        using errcode = 'check_violation';
    end if;
    -- "Durdurulan ajan yeni iş almaz": a step names only an agent of that unit that is enabled in
    -- this company and has a card version to run with (an agent whose card was never synchronised
    -- could take the request and never start).
    if v_step_agent is not null and not exists (
      select 1 from office.agent_definitions a
      join office.company_agents ca
        on ca.agent_code = a.code and ca.company_id = v_task.company_id and ca.status = 'enabled'
      where a.code = v_step_agent and a.unit_code = v_unit and a.current_version_id is not null
    ) then
      raise exception 'Agent % is not an enabled agent of unit % in this company',
        v_step_agent, v_unit using errcode = 'check_violation';
    end if;
    insert into office.task_routings (
      company_id, project_id, task_id, round, seq, unit_code, agent_code, approver_user_id,
      status, routed_by_agent_code, routed_by_user_id, run_id, reason
    ) values (
      v_task.company_id, v_task.project_id, p_task, v_round, v_seq, v_unit, v_step_agent,
      office.approver_for(v_unit, v_step_agent, v_task.project_id),
      case when v_seq = 1 then 'active' else 'planned' end,
      v_agent, case when v_agent is null then v_user end, p_run,
      nullif(pg_catalog.btrim(v_step ->> 'reason'), '')
    );
    if v_seq = 1 then
      v_first_unit := v_unit;
      v_first_agent := v_step_agent;
    end if;
  end loop;

  -- The task shows the step that is active. The first unit ever chosen and whether a person had
  -- to correct the routing feed the "first time right" metric.
  update office.tasks t set
      unit_code = v_first_unit,
      assignee_agent_code = v_first_agent,
      initial_unit_code = coalesce(t.initial_unit_code, v_first_unit),
      routing_corrected = t.routing_corrected or (v_round > 1 and v_agent is null)
    where t.id = p_task;
  perform office.flow_set_status(
    p_task, case when v_first_agent is null then 'open' else 'in_progress' end
  );
  insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    values (
      v_task.company_id, v_task.project_id,
      case when v_round = 1 then 'request_routed' else 'request_rerouted' end, 'task', p_task
    );
  return v_round;
end
$$;
alter function office.flow_route_request(uuid, jsonb, uuid) owner to office_trigger;
revoke execute on function office.flow_route_request(uuid, jsonb, uuid) from public;

-- The coordinator's routing, from its run. Callable by the application (the worker), and only in
-- an agent context.
create function office.route_request(p_task uuid, p_steps jsonb, p_run uuid) returns smallint
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_agent_code() is null or p_run is null then
    raise exception 'An agent routes a request from its own run'
      using errcode = 'insufficient_privilege';
  end if;
  return office.flow_route_request(p_task, p_steps, p_run);
end
$$;
alter function office.route_request(uuid, jsonb, uuid) owner to office_trigger;
revoke execute on function office.route_request(uuid, jsonb, uuid) from public;
grant execute on function office.route_request(uuid, jsonb, uuid) to office_app;

-- A person corrects the routing (7 October decision 7). Callable by the API only: the worker's
-- role lacks the privilege, so a person's id in a job can never stand in for that person here.
create function office.correct_routing(p_task uuid, p_steps jsonb) returns smallint
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_agent_code() is not null then
    raise exception 'A person corrects the routing' using errcode = 'insufficient_privilege';
  end if;
  return office.flow_route_request(p_task, p_steps, null);
end
$$;
alter function office.correct_routing(uuid, jsonb) owner to office_trigger;
revoke execute on function office.correct_routing(uuid, jsonb) from public;
grant execute on function office.correct_routing(uuid, jsonb) to office_api_private;

/*
 * Closes a request by hand (7 October decision 7): the requester cancels their own request; the
 * approver of the active step or the founder stops the work. Never in an agent run, and only
 * through the API. What was waiting is closed with it; a run that is still going finds the request
 * closed at its next step (the run and approval checks refuse a closed request).
 *
 * The one who stops somebody else's request says why, in a sentence the requester reads; the
 * requester may give a reason for a cancel and need not.
 */
create function office.close_request(p_task uuid, p_reason text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid;
  v_project uuid;
  v_status text;
  v_requester uuid;
  v_user uuid := office.ctx_user_id();
  v_event text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  select t.company_id, t.project_id, t.status, t.requester_user_id
    into v_company, v_project, v_status, v_requester
    from office.tasks t
    where t.id = p_task and t.company_id = office.ctx_company_id() and t.kind = 'request'
    for update;
  if v_company is null or office.my_role() is null or office.ctx_agent_code() is not null then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  if v_status in ('done', 'cancelled') then
    raise exception 'The request is already closed' using errcode = 'check_violation';
  end if;
  if v_user = v_requester then
    v_event := 'request_cancelled';
  elsif office.is_founder() or (office.can_approve() and exists (
      select 1 from office.task_routings r
      where r.task_id = p_task and r.status = 'active' and r.approver_user_id = v_user
    )) then
    v_event := 'request_stopped';
    if v_reason is null then
      raise exception 'Stopping a request needs a reason the requester can read'
        using errcode = 'invalid_parameter_value';
    end if;
  else
    raise exception 'Only the requester, the approver of the request or the founder closes it'
      using errcode = 'insufficient_privilege';
  end if;
  if pg_catalog.length(v_reason) > 500 then
    raise exception 'The reason is at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  update office.task_routings r set status = 'cancelled'
    where r.task_id = p_task and r.status in ('planned', 'active');
  perform office.flow_close_pending(p_task);
  perform office.flow_set_status(p_task, 'cancelled', v_user, v_reason);
  insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    values (v_company, v_project, v_event, 'task', p_task);
end
$$;
alter function office.close_request(uuid, text) owner to office_trigger;
revoke execute on function office.close_request(uuid, text) from public;
grant execute on function office.close_request(uuid, text) to office_api_private;
