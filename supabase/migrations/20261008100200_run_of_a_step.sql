-- A run on a request belongs to the step it was opened for (7 October decision 7: correcting the
-- routing starts the agent's work again, with the person's note).
--
-- Until now a run and a result were tied to a step by the agent's code alone. When a person
-- routed a request again to the agent that already had it, while a run of that agent was still
-- open, the older run passed every check: its result was filed under the new step, whose note it
-- had never read. The same held for a run a dead worker left open.
--
-- From here on:
--   - office.runs.routing_id names the step a run was opened for. The database writes it when the
--     run is opened (the active step of that agent on the request) and never takes it from the
--     caller; it does not change afterwards. Null for a run that belongs to no step: the
--     coordinator's run on a request that is not routed yet, and every run that is not on a
--     request;
--   - an approval on a request is opened only from a run of the step that is active now. A run of a
--     step that gave way to a new routing, also one to the same agent, is refused like the run of
--     an agent the request was taken from (check_violation: the runner ends that run as stopped).
--
-- Runs opened before this migration carry no step (a development or test database; the pilot has
-- not opened): one that is still open cannot submit any more and ends as stopped, and the request
-- is routed again by a person.
--
-- What the runner does with the column (closing the open run of a replaced step, comparing the
-- step after every model call) is its own change.

alter table office.runs add column routing_id uuid;
alter table office.runs
  add foreign key (routing_id, company_id) references office.task_routings (id, company_id);

drop trigger immutable_columns on office.runs;
create trigger immutable_columns before update on office.runs
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'task_id', 'agent_code', 'card_version_id', 'user_id',
    'trigger_type', 'started_at', 'raw_retain_until', 'routing_id'
  );

/*
 * A run opened on a request: an open request is in progress. Checked before the run is written:
 *   - no run is opened on a closed request (after a cancel or a stop the worker cannot start
 *     again);
 *   - before the request is routed only the coordinator runs on it; afterwards only the agent of
 *     the step that is active now. The job on the queue is a hint: an agent the request was never
 *     given to cannot open a run on it, whatever the job says.
 * The run is tied to that active step (routing_id).
 */
create or replace function office.check_run_request() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_status text;
begin
  -- Written here and nowhere else: never the caller's value.
  new.routing_id := null;
  if new.task_id is null then
    return new;
  end if;
  select t.status into v_status from office.tasks t
    where t.id = new.task_id and t.kind = 'request';
  if v_status is null then
    return new;
  end if;
  if v_status in ('done', 'cancelled') then
    raise exception 'The request is closed' using errcode = 'check_violation';
  end if;
  if exists (select 1 from office.task_routings r where r.task_id = new.task_id) then
    select r.id into new.routing_id
      from office.task_routings r
      where r.task_id = new.task_id and r.status = 'active' and r.agent_code = new.agent_code;
    if new.routing_id is null then
      raise exception 'The request is not routed to this agent' using errcode = 'check_violation';
    end if;
  elsif new.agent_code <> office.coordinator_agent_code() then
    raise exception 'Only the coordinator runs on a request that is not routed yet'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
alter function office.check_run_request() owner to office_trigger;
revoke execute on function office.check_run_request() from public;

-- office.check_approval as of the approval approver migration, with one rule added in the branch
-- of a request (marked "from a run that was opened for that step").
create or replace function office.check_approval() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
  prev office.approvals;
  v_kind text;
  v_task_status text;
  v_step uuid;
  v_may_decide boolean;
begin
  if tg_op = 'INSERT' then
    if agent is null or new.agent_code is distinct from agent then
      raise exception 'An approval is opened only by an agent from its own run'
        using errcode = 'insufficient_privilege';
    end if;
    if not exists (
      select 1 from office.runs c where c.id = new.run_id and c.agent_code = new.agent_code
    ) then
      raise exception 'The approval''s run does not belong to this agent'
        using errcode = 'check_violation';
    end if;
    new.status := 'pending';
    new.decided_by_user_id := null;
    new.decided_at := null;
    new.decision_reason := null;
    new.rejection_reason := null;
    new.selected_option := null;
    new.invalidated_at := null;
    new.sent_by_user_id := null;
    new.sent_at := null;
    new.created_at := pg_catalog.now();
    if new.options is not null and exists (
      select 1 from pg_catalog.jsonb_array_elements(new.options) e
      where pg_catalog.jsonb_typeof(e -> 'code') is distinct from 'string'
    ) then
      raise exception 'Every option must have a text code' using errcode = 'check_violation';
    end if;
    if new.basis_id is not null
       and office.basis_version_of(new.basis_type, new.basis_id)
         is distinct from new.basis_version then
      raise exception 'The basis record''s version is not current'
        using errcode = 'check_violation';
    end if;
    -- M23: work sent back for changes returns to the same agent; after the second change request
    -- the work falls to a person.
    if new.previous_approval_id is null then
      new.attempt := 1;
    else
      select * into prev from office.approvals o where o.id = new.previous_approval_id;
      if prev.id is null or prev.status <> 'changes_requested' or prev.agent_code <> new.agent_code
         or prev.task_id is distinct from new.task_id
         or prev.basis_type is distinct from new.basis_type
         or prev.basis_id is distinct from new.basis_id then
        raise exception 'The previous approval is not this work''s approval with changes requested'
          using errcode = 'check_violation';
      end if;
      if prev.attempt >= 2 then
        raise exception 'After the second change request the work falls to a person'
          using errcode = 'check_violation';
      end if;
      -- The same work, sent back for changes: its new attempt cannot become unimportant by
      -- stating less than the attempt before it (the passkey would no longer be asked for).
      if (prev.involves_money and not new.involves_money)
         or (prev.goes_external and not new.goes_external) then
        raise exception
          'A new attempt cannot take back that the work involves money or goes outside'
          using errcode = 'check_violation';
      end if;
      new.attempt := prev.attempt + 1;
    end if;
    -- 7 October decision 3: the approver is appointed, not chosen by the agent.
    if new.task_id is not null then
      select t.kind, t.status into v_kind, v_task_status
        from office.tasks t where t.id = new.task_id;
    end if;
    if v_kind = 'request' then
      if v_task_status in ('done', 'cancelled') then
        raise exception 'The request is closed' using errcode = 'check_violation';
      end if;
      -- Only the agent of the active step submits work on a request: after a correction of the
      -- routing the agent it was taken from cannot submit any more.
      select r.id, r.approver_user_id into v_step, new.approver_user_id
        from office.task_routings r
        where r.task_id = new.task_id and r.status = 'active' and r.agent_code = new.agent_code;
      if v_step is null then
        raise exception 'The request is not routed to this agent' using errcode = 'check_violation';
      end if;
      -- And only from a run that was opened for that step: the run of a step that gave way to a new
      -- routing (also one to the same agent) never read what the new step carries.
      if (select c.routing_id from office.runs c where c.id = new.run_id)
         is distinct from v_step then
        raise exception 'The run was opened for a step that is no longer active'
          using errcode = 'check_violation';
      end if;
      -- The result of the step is what the agent submits; an approval that names another tool is
      -- the approval of that one gated call.
      new.routing_id := case
        when coalesce(new.tool_name, 'submit_for_approval') = 'submit_for_approval' then v_step
      end;
    else
      new.routing_id := null;
      -- The project comes from the run (the project triggers fire after this one).
      new.approver_user_id := office.approver_for(
        (select a.unit_code from office.agent_definitions a where a.code = new.agent_code),
        new.agent_code,
        (select c.project_id from office.runs c where c.id = new.run_id)
      );
    end if;
    return new;
  end if;

  -- Who may decide this approval (and correct what the decider reads): the founder; the appointed
  -- person while they hold the approval right; with nobody appointed, anybody with the right,
  -- except for the result of a request, which then only the founder decides.
  -- Written so that a missing value can never read as "may": the result is true or false.
  v_may_decide := agent is null and (
    office.is_founder()
    or (
      office.can_approve()
      and (
        old.approver_user_id is not distinct from office.ctx_user_id()
        or (old.approver_user_id is null and old.routing_id is null)
      )
    )
  );
  v_may_decide := coalesce(v_may_decide, false);

  -- Invalidation: only the trigger role writes it, when the basis changes or the request is
  -- routed again or closed.
  if new.invalidated_at is distinct from old.invalidated_at
     and current_user <> 'office_trigger' then
    raise exception 'An approval cannot be invalidated manually'
      using errcode = 'insufficient_privilege';
  end if;

  if new.involves_money is distinct from old.involves_money then
    raise exception 'Whether an approval involves money is fixed when it is opened'
      using errcode = 'check_violation';
  end if;
  if new.goes_external is distinct from old.goes_external then
    raise exception 'Whether the approved work goes outside is fixed when the approval is opened'
      using errcode = 'check_violation';
  end if;
  if new.routing_id is distinct from old.routing_id then
    raise exception 'The step an approval belongs to is fixed when it is opened'
      using errcode = 'check_violation';
  end if;
  -- The appointed approver is fixed too; only the removal of that person's membership clears it
  -- (foreign key action), and then the founder decides.
  if new.approver_user_id is distinct from old.approver_user_id
     and new.approver_user_id is not null then
    raise exception 'The approver of an approval is fixed when it is opened'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'pending' then
    if new.status is distinct from old.status
       or new.decision_reason is distinct from old.decision_reason
       or new.rejection_reason is distinct from old.rejection_reason
       or new.selected_option is distinct from old.selected_option
       or new.summary is distinct from old.summary
       or new.risk_note is distinct from old.risk_note
       or new.priority is distinct from old.priority then
      raise exception 'A decided approval cannot be changed' using errcode = 'check_violation';
    end if;
  elsif new.summary is distinct from old.summary
     or new.risk_note is distinct from old.risk_note
     or new.priority is distinct from old.priority then
    -- What the decider reads is changed only by somebody who may decide, or by an agent: for the
    -- result of a request by the approval packaging agent alone (its tool, write_approval_summary),
    -- so that the agent that submitted a result cannot take its own risk note back.
    if agent is not null then
      if old.routing_id is not null and agent <> 'KOR-3' then
        raise exception 'The summary of a request''s result is changed only by the packaging agent'
          using errcode = 'insufficient_privilege';
      end if;
    elsif not v_may_decide then
      raise exception 'The approval summary is changed by an agent or by a person who may decide it'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.status = 'pending' and new.status <> 'pending' then
    if agent is not null or not v_may_decide then
      raise exception 'Only the approver of this work or the founder makes the approval decision'
        using errcode = 'insufficient_privilege';
    end if;
    new.decided_by_user_id := office.ctx_user_id();
    new.decided_at := pg_catalog.now();
    if new.status = 'approved' then
      if old.invalidated_at is not null
         or (old.basis_id is not null
             and office.basis_version_of(old.basis_type, old.basis_id)
               is distinct from old.basis_version) then
        raise exception 'The record the approval is based on changed; the approval is closed'
          using errcode = 'check_violation';
      end if;
      if old.options is not null and not (
        old.options @> pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('code', new.selected_option)
        )
      ) then
        raise exception 'An approval with options needs a valid option selected'
          using errcode = 'check_violation';
      end if;
      -- 3 October decision 7 and 5 October decision 2: an important approval is approved only
      -- after a passkey re-verification for it in this transaction.
      if office.approval_is_important(
        old.company_id, old.involves_money, old.goes_external, old.tool_name, old.basis_type,
        old.basis_id
      ) then
        if not office.consume_step_up('approve', old.company_id, old.id) then
          raise exception 'Approving this approval needs a passkey re-verification'
            using errcode = 'invalid_authorization_specification';
        end if;
      end if;
    end if;
  end if;

  if new.sent_at is distinct from old.sent_at
     or new.sent_by_user_id is distinct from old.sent_by_user_id then
    if old.sent_at is not null then
      raise exception 'The sent mark cannot be changed' using errcode = 'check_violation';
    end if;
    if agent is not null or not office.is_insider() then
      raise exception 'The sent mark is set by a person' using errcode = 'insufficient_privilege';
    end if;
    -- The sent mark records that the work left the company. Work stated as staying inside was
    -- approved without the passkey outgoing work needs, so it is never recorded as sent: it needs
    -- a new approval that states it goes outside. An external effect tool's approval is important
    -- whatever was stated.
    if not (
      old.goes_external
      or exists (
        select 1 from office.tools t where t.name = old.tool_name and t.kind = 'external_effect'
      )
    ) then
      raise exception 'Work stated as staying inside the company cannot be marked as sent'
        using errcode = 'check_violation';
    end if;
    new.sent_by_user_id := office.ctx_user_id();
    new.sent_at := pg_catalog.now();
  end if;
  return new;
end
$$;
