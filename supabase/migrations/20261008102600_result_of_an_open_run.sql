-- A result is taken only from a run that is still open (8 October decision 49).
--
-- The flow took an approval from any run of the step that is active, whatever the run's own
-- status. A run the database had closed could therefore still submit: an AI permission that is
-- closed and opened again while a model call is in flight leaves the run stopped
-- (ai_permission_closed) and visible again, the step unchanged and the agent open, and the
-- opening has already called for the same work again. The result of such a run waited on the
-- desk in the name of a run recorded as stopped, and the job of the restart was then dropped as
-- a duplicate; or both runs worked on the one step. The promise of the AI permission migration
-- (20261008102400: "a model call that is in flight comes back to a closed run and is dropped")
-- was kept by the runner alone.
--
-- The runner now reads its run's status after every model call. This is the database's side of
-- the same rule, for the instant between that read and the write: the approval of a request is
-- refused (check_violation) unless its run is still running. office.route_request has had the
-- same condition since the routing migration.
--
-- office.flow_on_approval as of the closing notifications migration (20261008101300), with that
-- one condition added to the INSERT branch. Same owner (office_trigger) and privileges as before.

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
    -- Only from a run that is still open: a run that was closed while its model call was in
    -- flight (a closed AI permission, a stop, a hand-over) submits nothing, also when the step
    -- is still the active one. The runner writes the approval before it ends its run, in one
    -- transaction, so its own result always comes from an open run.
    if not exists (
      select 1 from office.task_routings r
      join office.runs c on c.id = new.run_id and c.routing_id = r.id and c.status = 'running'
      where r.task_id = new.task_id and r.status = 'active' and r.agent_code = new.agent_code
    ) then
      raise exception 'The run is closed, or the request was routed again while it was open'
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
