-- The requester is told when their request closes without their doing anything
-- (8 October decision 8: "Bildirim yalnızca kişinin talebi kendisi bir şey yapmadan kapandığında
-- çıkar: geri çevrildi, reddedildi, durduruldu").
--
-- Until now a request could close behind its requester's back in three ways and nothing told them:
-- the routing returned it (no open agent in the unit), the unit's approver rejected its result, or
-- the founder or the approver stopped the work. From here on each of the three writes one row into
-- office.notifications, in the same transaction as the close, for the requester:
--   request_returned   written by office.flow_route_request
--   request_rejected   written by office.flow_on_approval
--   request_stopped    written by office.close_request
-- A row carries ids and codes only: the company, the request's project, the recipient, the
-- template, record_type 'task' and the request's id. Who caused it comes from the context
-- (set_notification_sender: the coordinator's code for a return, the person for a rejection and a
-- stop). No text: the panel builds the sentence from the template, and reads the request's title
-- and, for a return, the unit from the request itself.
--
-- Nobody is told of their own act (docs/SONRA.md W-b): a cancel by the requester writes nothing,
-- and neither does a rejection by an approver who is the requester. A return is the coordinator's
-- act, also though its run goes in the requester's name.
--
-- The three templates are the flow's alone, like passkeys_reset is the reset's: no request of the
-- API and no agent run can write a row that tells a person their request was closed.
--
-- A notification never breaks the close: its recipient must be a member of the company (foreign
-- key), and a requester who has left the company gets none.
--
-- Nothing else of the three functions changes; each is replaced from its newest definition
-- (flow_route_request: "coordinator routes before a person"; flow_on_approval: "result meets
-- close"; close_request: "task routings").

-- The flow writes these rows and nothing else of the table; it reads none.
grant insert (company_id, project_id, recipient_user_id, template, record_type, record_id)
  on office.notifications to office_trigger;
-- Without a context (an administrator changing a record by hand) the row is written as the flow's
-- audit rows are; the application always has one.
create policy flow_notifies on office.notifications for insert to office_trigger
  with check (
    template in ('request_returned', 'request_rejected', 'request_stopped')
    and record_type = 'task'
    and (office.ctx_company_id() is null or company_id = office.ctx_company_id())
  );

-- Reserved for their writers: the reset's template (as before) and the flow's three.
drop policy reserved_templates on office.notifications;
create policy reserved_templates on office.notifications as restrictive for insert to office_app
  with check (
    template not in ('passkeys_reset', 'request_returned', 'request_rejected', 'request_stopped')
  );

/*
 * Tells the requester of a request that it was closed. Not callable by the application: only the
 * flow functions (same owner) call it, in the transaction that closes the request.
 *   - the recipient is the requester, read from the request, never from an argument;
 *   - a person is not told of their own act: when the context holds a person and no agent, and
 *     that person is the requester, nothing is written. In an agent run the context person is the
 *     one in whose name the run goes (for a request: its requester) and the act is the agent's;
 *   - a requester who is no longer a member of the company gets none: the foreign key to
 *     memberships refuses the row, and the refusal ends here, not in the close.
 */
create function office.flow_notify_requester(p_task uuid, p_template text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid;
  v_project uuid;
  v_requester uuid;
begin
  select t.company_id, t.project_id, t.requester_user_id
    into v_company, v_project, v_requester
    from office.tasks t where t.id = p_task and t.kind = 'request';
  if v_requester is null then
    return;
  end if;
  if office.ctx_agent_code() is null and office.ctx_user_id() = v_requester then
    return;
  end if;
  begin
    insert into office.notifications
        (company_id, project_id, recipient_user_id, template, record_type, record_id)
      values (v_company, v_project, v_requester, p_template, 'task', p_task);
  exception when foreign_key_violation then
    -- Not a member any more: nobody is told, and the request closes all the same.
    null;
  end;
end
$$;
alter function office.flow_notify_requester(uuid, text) owner to office_trigger;
revoke execute on function office.flow_notify_requester(uuid, text) from public;

/*
 * Routes a request, or corrects its routing. The inner function: not callable by the application,
 * reached only through office.route_request and office.correct_routing.
 *   p_steps  [{"unit": "SOS", "agent": "SOS-2", "reason": "..."}, ...] in the order of work;
 *            "agent" may be null in the coordinator's routing only: no open agent of that unit can
 *            take the work, and the request is returned to its requester and closed.
 *   p_run    the caller's own running run on this request (an agent), null for a person.
 * A returned request tells its requester so (office.flow_notify_requester, request_returned).
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
    -- 8 October decision 8: the request closed without its requester doing anything.
    perform office.flow_notify_requester(p_task, 'request_returned');
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

/*
 * An approval opened on a request: the request waits for approval, unless the request was closed
 * or routed again while the approval was written (then the approval is refused). A decision on the
 * RESULT of a step (routing_id set):
 *   approved            the step is done; the next planned step becomes active and the request is
 *                       in progress again; after the last step the request waits for its requester
 *                       (office.flow_request_result_approved opens that approval);
 *   rejected            the request is closed (a marked default, open question) and its requester
 *                       is told (office.flow_notify_requester, request_rejected), unless the
 *                       requester is the one who rejected.
 * Everything else (changes requested on a result; a gated tool call approved or refused; an
 * approval closed without a decision because its basis changed): the request is in progress again
 * once nothing waits and a step is still active.
 */
create or replace function office.flow_on_approval() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_next uuid;
  v_unit text;
  v_agent text;
  v_decided boolean;
  v_closed boolean;
begin
  if new.task_id is null or not exists (
    select 1 from office.tasks t where t.id = new.task_id and t.kind = 'request'
  ) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    -- The status write takes the request's row lock: a cancel, a stop or a correction that was
    -- open while office.check_approval read the request has ended by now, and what it wrote is
    -- read here. A refusal undoes the status write and the approval together.
    if office.flow_set_status(new.task_id, 'awaiting_approval') in ('done', 'cancelled') then
      raise exception 'The request is closed' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from office.task_routings r
      join office.runs c on c.id = new.run_id and c.routing_id = r.id
      where r.task_id = new.task_id and r.status = 'active' and r.agent_code = new.agent_code
    ) then
      raise exception 'The request was routed again while this run was open'
        using errcode = 'check_violation';
    end if;
    return null;
  end if;
  v_decided := old.status = 'pending' and new.status <> 'pending';
  v_closed := new.status = 'pending' and old.invalidated_at is null
    and new.invalidated_at is not null;
  if not (v_decided or v_closed) then
    return null;
  end if;
  -- A decision on an approval that was already closed (its step gave way to a new routing, or its
  -- basis changed) moves nothing: such an approval can still be rejected, and that must not close
  -- a request that has gone on elsewhere.
  if v_decided and old.invalidated_at is not null then
    return null;
  end if;

  if v_decided and new.routing_id is not null and new.status = 'approved' then
    update office.task_routings r set status = 'done'
      where r.id = new.routing_id and r.status = 'active';
    if not found then
      -- The step gave way to a new routing while this approval waited; it was closed with it and
      -- cannot be approved, so this is never reached. Kept as a guard.
      return null;
    end if;
    select r.id, r.unit_code, r.agent_code into v_next, v_unit, v_agent
      from office.task_routings r
      where r.task_id = new.task_id and r.status = 'planned'
      order by r.round desc, r.seq limit 1;
    if v_next is not null then
      update office.task_routings r set status = 'active' where r.id = v_next;
      update office.tasks t set unit_code = v_unit, assignee_agent_code = v_agent
        where t.id = new.task_id;
      perform office.flow_set_status(
        new.task_id, case when v_agent is null then 'open' else 'in_progress' end
      );
    else
      perform office.flow_request_result_approved(new.task_id, new.id);
    end if;
    return null;
  end if;

  if v_decided and new.routing_id is not null and new.status = 'rejected' and exists (
    select 1 from office.task_routings r where r.id = new.routing_id and r.status = 'active'
  ) then
    update office.task_routings r set status = 'cancelled'
      where r.task_id = new.task_id and r.status in ('planned', 'active');
    perform office.flow_close_pending(new.task_id);
    -- Told only when this rejection is what closed the request (8 October decision 8).
    if office.flow_set_status(new.task_id, 'cancelled') not in ('done', 'cancelled') then
      perform office.flow_notify_requester(new.task_id, 'request_rejected');
    end if;
    return null;
  end if;

  if (select t.status from office.tasks t where t.id = new.task_id) = 'awaiting_approval'
     and exists (
       select 1 from office.task_routings r where r.task_id = new.task_id and r.status = 'active'
     )
     and not exists (
       select 1 from office.approvals a
       where a.task_id = new.task_id and a.status = 'pending' and a.invalidated_at is null
     ) then
    perform office.flow_set_status(new.task_id, 'in_progress');
  end if;
  return null;
end
$$;
alter function office.flow_on_approval() owner to office_trigger;
revoke execute on function office.flow_on_approval() from public;

/*
 * Closes a request by hand (7 October decision 7): the requester cancels their own request; the
 * approver of the active step or the founder stops the work. Never in an agent run, and only
 * through the API. What was waiting is closed with it; a run that is still going finds the request
 * closed at its next step (the run and approval checks refuse a closed request). A stop tells the
 * requester (office.flow_notify_requester, request_stopped); a cancel is the requester's own act
 * and tells nobody.
 *
 * The one who stops somebody else's request says why, in a sentence the requester reads; the
 * requester may give a reason for a cancel and need not.
 */
create or replace function office.close_request(p_task uuid, p_reason text default null) returns void
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
  if v_event = 'request_stopped' then
    perform office.flow_notify_requester(p_task, 'request_stopped');
  end if;
end
$$;
alter function office.close_request(uuid, text) owner to office_trigger;
revoke execute on function office.close_request(uuid, text) from public;
grant execute on function office.close_request(uuid, text) to office_api_private;
