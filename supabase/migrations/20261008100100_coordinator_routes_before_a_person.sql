-- The coordinator does not route a request a person has already routed (7 October decision 7: the
-- founder and the approver of the request correct the routing; 8 October decision 2 speaks of the
-- coordinator's first routing only).
--
-- Until now the coordinator could route from any running run of its own on the request. A person
-- is offered "Yönlendirmeyi düzelt" from the moment the request is opened, so a correction could
-- land while the coordinator's model call was still in flight; the coordinator's answer then
-- arrived as round 2, marked the person's step `replaced` and, when it named a unit without an open
-- agent, returned and closed the request the person had just given to an agent.
--
-- From here on the coordinator's routing is refused when the request has a routing this run did not
-- write: a person's correction, or (not reachable today, the run check refuses a second
-- coordinator run on a routed request) another run's routing. The check sits behind the row lock a
-- person's correction also takes, so it holds for two transactions that meet. A second routing
-- from the same run stays possible (a round that names a unit without an agent returns the whole
-- request). The refusal is insufficient_privilege: the runner ends the run as stopped
-- (request_changed) instead of asking the model to choose again.
--
-- Nothing else of office.flow_route_request changes.

/*
 * Routes a request, or corrects its routing. The inner function: not callable by the application,
 * reached only through office.route_request and office.correct_routing.
 *   p_steps  [{"unit": "SOS", "agent": "SOS-2", "reason": "..."}, ...] in the order of work;
 *            "agent" may be null in the coordinator's routing only: no open agent of that unit can
 *            take the work, and the request is returned to its requester and closed.
 *   p_run    the caller's own running run on this request (an agent), null for a person.
 * Who may: the coordinator from its own running run on this request, as long as nobody else has
 * routed it (office.route_request); the founder and the appointed approver of the active step
 * (office.correct_routing, 7 October decision 7). The approver of each step is appointed here
 * from the company's settings, never from an argument (decision 3). Returns the round.
 */
create or replace function office.flow_route_request(p_task uuid, p_steps jsonb, p_run uuid)
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
  v_returned boolean;
  v_returned_unit text;
  v_event text;
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
    -- A routing this run did not write: a person corrected the routing while the run was open.
    -- Read after the row lock above, which a person's correction takes too.
    if exists (
      select 1 from office.task_routings r
      where r.task_id = p_task and r.run_id is distinct from p_run
    ) then
      raise exception 'The request was routed by somebody else while this run was open'
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
  -- A step without an agent: no open agent of that unit can take the work.
  v_returned := exists (
    select 1 from pg_catalog.jsonb_array_elements(p_steps) e where (e ->> 'agent') is null
  );
  if v_returned and v_agent is null then
    -- A person gives the work to an agent that is open, or closes the request with a reason; a
    -- request is not parked at a unit that has nobody to do it. Refused before anything is written.
    raise exception 'A person routes a request to an agent' using errcode = 'check_violation';
  end if;
  select c.code into v_company_code from office.companies c where c.id = v_task.company_id;
  select coalesce(max(r.round), 0) + 1 into v_round
    from office.task_routings r where r.task_id = p_task;
  v_event := case when v_round = 1 then 'request_routed' else 'request_rerouted' end;

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
      -- No step of a returned round is ever worked on: the whole round is the record of the return.
      case when v_returned then 'returned' when v_seq = 1 then 'active' else 'planned' end,
      v_agent, case when v_agent is null then v_user end, p_run,
      nullif(pg_catalog.btrim(v_step ->> 'reason'), '')
    );
    if v_seq = 1 then
      v_first_unit := v_unit;
      v_first_agent := v_step_agent;
    end if;
    if v_step_agent is null and v_returned_unit is null then
      v_returned_unit := v_unit;
    end if;
  end loop;

  -- The task shows the step that is active; a returned request shows the unit that had no agent
  -- for it and no agent. The first unit ever chosen and whether a person had to correct the
  -- routing feed the "first time right" metric.
  update office.tasks t set
      unit_code = case when v_returned then v_returned_unit else v_first_unit end,
      assignee_agent_code = case when v_returned then null else v_first_agent end,
      initial_unit_code = coalesce(t.initial_unit_code, v_first_unit),
      routing_corrected = t.routing_corrected or (v_round > 1 and v_agent is null)
    where t.id = p_task;
  if v_returned then
    -- Routed, then returned: closed by the flow itself, so nobody is the closer and there is no
    -- close reason. The cause is read from the returned step.
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (v_task.company_id, v_task.project_id, v_event, 'task', p_task);
    perform office.flow_set_status(p_task, 'cancelled');
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (v_task.company_id, v_task.project_id, 'request_returned', 'task', p_task);
  else
    perform office.flow_set_status(p_task, 'in_progress');
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (v_task.company_id, v_task.project_id, v_event, 'task', p_task);
  end if;
  return v_round;
end
$$;
alter function office.flow_route_request(uuid, jsonb, uuid) owner to office_trigger;
revoke execute on function office.flow_route_request(uuid, jsonb, uuid) from public;
