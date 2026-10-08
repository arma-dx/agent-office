-- A result cannot land on a request that is being closed or routed again at that very moment
-- (7 October decision 7: the requester cancels, the approver and the founder stop the work and
-- correct the routing; "what was waiting is closed with it").
--
-- office.check_approval reads the request and its active step without a lock, before the approval
-- row is written. A cancel, a stop or a correction whose transaction was still open at that moment
-- was not seen: the approval was stored, and the transaction that closed the request never saw the
-- approval either. The row then stayed pending on a cancelled request (on the approver's desk, and
-- approvable), or pending on a replaced step, where it blocked every later result of the request
-- through the single pending index.
--
-- The trigger that runs after the insert already takes the request's row lock (flow_set_status),
-- which every close and every routing takes first. From here on it reads the request again behind
-- that lock and refuses the approval when the request is closed, or when the run's step is no
-- longer the active step of this agent (the rule of the run step migration, asked again). Both are
-- check_violation, as in the unlocked check: the runner ends the run as stopped.
--
-- Nothing else of office.flow_on_approval changes.

-- The step a run was opened for, to compare it behind the lock.
grant select (routing_id) on office.runs to office_trigger;

/*
 * An approval opened on a request: the request waits for approval, unless the request was closed
 * or routed again while the approval was written (then the approval is refused). A decision on the
 * RESULT of a step (routing_id set):
 *   approved            the step is done; the next planned step becomes active and the request is
 *                       in progress again; after the last step the request waits for its requester
 *                       (office.flow_request_result_approved opens that approval);
 *   rejected            the request is closed (a marked default, open question).
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
    perform office.flow_set_status(new.task_id, 'cancelled');
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
