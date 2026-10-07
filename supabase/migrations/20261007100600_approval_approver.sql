-- The approver of an approval, and the request's status following its approvals and runs
-- (7 October decisions 2, 3, 4 and 5; 2 October decision 10 stays as it is).
--
-- Every approval names the person appointed to decide it (approver_user_id), fixed when the
-- approval is opened and never taken from the agent's arguments: for the work of a request it is
-- the approver of the request's active step, otherwise the approver of the agent that opened it.
-- Who decides:
--   - the founder, always (PLAN, roles: the founder gives every approval);
--   - the appointed person, while they hold the approval right;
--   - when nobody is appointed: for the result of a request only the founder (7 October decision
--     5: for now the founder is the approver of every unit; KALAN-ISLER 0.5: "yalnızca kurucunun
--     karar verebilmesi"); for every other approval anyone who holds the approval right, as
--     before this migration.
-- So "only the founder or a member with can_approve decides" still holds, and an appointment
-- narrows it to one person plus the founder. Whoever may decide may also correct the summary, the
-- risk note and the priority of a pending approval; nobody else may (the decider reads them).
--
-- The result of a request reaches the requester when it is approved (decision 4): until then the
-- approval of a request's work is visible only to those who hold the approval right and to the
-- agent that opened it (the rule of 3 October decision 1 for an agent's draft note). A marked
-- default, kept in one function (approval_released).

alter table office.approvals add column approver_user_id uuid;
alter table office.approvals
  add foreign key (company_id, approver_user_id) references office.memberships (company_id, user_id)
    on delete set null (approver_user_id);
create index approvals_approver on office.approvals (company_id, approver_user_id)
  where status = 'pending' and invalidated_at is null;

-- The step of a request whose RESULT this approval carries (what the agent submits with
-- submit_for_approval). Null for everything else: work that is not a request, and the approval of
-- a gated tool call made during the step (a Y1 agent's write_note, an external effect tool), which
-- lets that one call go on and does not end the step.
alter table office.approvals add column routing_id uuid;
alter table office.approvals
  add foreign key (routing_id, company_id) references office.task_routings (id, company_id);
create unique index approvals_single_pending_result on office.approvals (routing_id)
  where status = 'pending' and invalidated_at is null;

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

/*
 * Is the content of this approval open to the reader beyond those who decide it? Everything that
 * is not the work of a request, and every approved approval, is. The pending, sent back or
 * rejected work of a request is read only by people who hold the approval right, by the agent
 * that opened it, and by KOR-3 running for such a person (3 October decision 3).
 */
create function office.approval_released(p_status text, p_task uuid, p_agent text) returns boolean
  language sql stable set search_path = ''
  as $$
    select p_status = 'approved'
      or p_task is null
      or not exists (select 1 from office.tasks t where t.id = p_task and t.kind = 'request')
      or case
        when office.ctx_agent_code() is not null then
          p_agent = office.ctx_agent_code()
          or (office.ctx_agent_code() = 'KOR-3' and office.can_approve())
        else office.can_approve()
      end
  $$;
grant execute on function office.approval_released(text, uuid, text) to office_app;

drop policy visible on office.approvals;
create policy visible on office.approvals for select to office_app
  using (
    office.row_visible(company_id, project_id)
    and (basis_type is distinct from 'note' or office.basis_note_visible(basis_id))
    and office.approval_released(status, task_id, agent_code)
  );
drop policy updates on office.approvals;
create policy updates on office.approvals for update to office_app
  using (
    office.row_visible(company_id, project_id)
    and (office.ctx_agent_code() is not null or office.is_insider())
    and (basis_type is distinct from 'note' or office.basis_note_visible(basis_id))
    and office.approval_released(status, task_id, agent_code)
  );

-- The status of a request follows its records -------------------------------------------------------

grant select (id, company_id, task_id, agent_code, status, invalidated_at, routing_id) on office.approvals
  to office_trigger;

/*
 * An approval opened on a request: the request waits for approval. A decision on the RESULT of a
 * step (routing_id set):
 *   approved            the step is done; the next planned step becomes active and the request is
 *                       in progress again; after the last step the request waits for its requester
 *                       (the next migration replaces flow_request_result_approved to open that
 *                       approval);
 *   rejected            the request is closed (a marked default, open question).
 * Everything else (changes requested on a result; a gated tool call approved or refused; an
 * approval closed without a decision because its basis changed): the request is in progress again
 * once nothing waits and a step is still active.
 */
create function office.flow_on_approval() returns trigger
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
    perform office.flow_set_status(new.task_id, 'awaiting_approval');
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

-- The last step's work is approved. Here the request is done; the next migration replaces the
-- function: the request then waits for its requester.
create function office.flow_request_result_approved(p_task uuid, p_approval uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform office.flow_set_status(p_task, 'done');
end
$$;
alter function office.flow_request_result_approved(uuid, uuid) owner to office_trigger;
revoke execute on function office.flow_request_result_approved(uuid, uuid) from public;

alter function office.flow_on_approval() owner to office_trigger;
revoke execute on function office.flow_on_approval() from public;
create trigger flow_on_approval after insert or update on office.approvals
  for each row execute function office.flow_on_approval();

/*
 * A run opened on a request: an open request is in progress. Checked before the run is written:
 *   - no run is opened on a closed request (after a cancel or a stop the worker cannot start
 *     again);
 *   - before the request is routed only the coordinator runs on it; afterwards only the agent of
 *     the step that is active now. The job on the queue is a hint: an agent the request was never
 *     given to cannot open a run on it, whatever the job says.
 */
create function office.check_run_request() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_status text;
begin
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
    if not exists (
      select 1 from office.task_routings r
      where r.task_id = new.task_id and r.status = 'active' and r.agent_code = new.agent_code
    ) then
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
create trigger check_run_request before insert on office.runs
  for each row execute function office.check_run_request();

create function office.flow_on_run() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if new.task_id is not null and exists (
    select 1 from office.tasks t
    where t.id = new.task_id and t.kind = 'request' and t.status = 'open'
  ) then
    perform office.flow_set_status(new.task_id, 'in_progress');
  end if;
  return null;
end
$$;
alter function office.flow_on_run() owner to office_trigger;
revoke execute on function office.flow_on_run() from public;
create trigger flow_on_run after insert on office.runs
  for each row execute function office.flow_on_run();
