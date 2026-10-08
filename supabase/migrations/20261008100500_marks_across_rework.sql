-- The money and "goes outside" marks of a result hold across every attempt of a step
-- (5 October decision 2: the mark that asks for the passkey cannot be lowered by the model).
--
-- The rule "a new attempt cannot take back that the work involves money or goes outside" was
-- asked only of an attempt that names its predecessor (previous_approval_id), which is the path of
-- the approver's change request. When the requester says "istediğim bu değil" after an approved
-- result, the same agent reworks the same step and its new result starts a new chain (the earlier
-- one was approved, not sent back): the rule did not run, and a result approved with the passkey
-- could be followed by one that states neither mark and is approved without it.
--
-- From here on the result of a request's step is compared with the latest earlier result of that
-- same step, however the work came back. A step a person routed again is a new step and starts
-- fresh, as before. On the safe side: more passkey, never less. Extending the sentence of
-- docs/SONRA.md ("düzeltme sonrası yeni deneme ... beyanını düşüremez") to the requester's rework
-- is a derived reading that waits for the founder's approval.
--
-- The agent reads its own earlier results of the step (office.approval_released), so the function
-- still runs with the caller's rights.

-- office.check_approval as of the migration "person acts through the API", with the comparison
-- added in the branch of a request (marked "whichever way the work came back").
create or replace function office.check_approval() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
  prev office.approvals;
  v_kind text;
  v_task_status text;
  v_step uuid;
  v_earlier_money boolean;
  v_earlier_external boolean;
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
      -- The marks of the step's result hold whichever way the work came back: after the approver's
      -- change request (the chain above), and after the requester's, where the new result starts a
      -- new chain. Compared with the latest earlier result of this step.
      if new.routing_id is not null then
        select o.involves_money, o.goes_external into v_earlier_money, v_earlier_external
          from office.approvals o
          where o.routing_id = new.routing_id
          order by o.created_at desc, o.id desc
          limit 1;
        if (coalesce(v_earlier_money, false) and not new.involves_money)
           or (coalesce(v_earlier_external, false) and not new.goes_external) then
          raise exception
            'A new attempt cannot take back that the work involves money or goes outside'
            using errcode = 'check_violation';
        end if;
      end if;
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
  -- A person acts through the API: the worker's role, which is not in the API-only group, decides
  -- nothing whatever person its context names.
  -- Written so that a missing value can never read as "may": the result is true or false.
  v_may_decide := agent is null
    and pg_catalog.pg_has_role(current_user, 'office_api_private', 'member')
    and (
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
    -- By a person, through the API.
    if agent is not null or not office.is_insider()
       or not pg_catalog.pg_has_role(current_user, 'office_api_private', 'member') then
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
