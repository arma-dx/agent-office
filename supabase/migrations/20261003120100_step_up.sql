-- The database requires a passkey re-verification for important approvals and for membership
-- changes (KALAN-ISLER 0.3 and 0.5; CLAUDE.md rules 4, 9; 3 October decision 7).
--
-- Important approval: one that involves money or prices (involves_money, decided by the runner's
-- code for every approval it opens: the column has no default, so an approval opened without the
-- decision is refused), one whose tool has an external effect, or one that changes a source of
-- truth note: its basis is such a note, or its tool changes an existing note and the approval names
-- no note as its basis (the target is unknown, so it counts as important). Approving it needs a
-- re-verification of the deciding person for this approval and company, recorded in the same
-- transaction (record_step_up, purpose approve); the approval uses it up. Rejecting it or asking for
-- changes needs none.
--
-- Membership change: changing a member's role or approval right, or removing the membership, needs
-- a re-verification of the person making the change for that member and company, recorded in the
-- same transaction (purpose membership_change); the change uses it up. Activating or deactivating
-- an account (users.active) counts as a membership change of that account in the context company:
-- it ends or brings back every membership of the account. Creating an invitation (which becomes a
-- membership, with its role and approval right, at the first sign-in) and renewing one need a
-- re-verification for that invitation (purpose invitation; the API gives a new invitation its id,
-- so the re-verification can name it). A change made without a person in the context (migrations,
-- the seed, the login function) needs none.
--
-- A missing re-verification raises 28000 (invalid_authorization_specification), so the API can tell
-- it apart from other refusals and ask for the passkey.

-- Approvals -----------------------------------------------------------------------------------

-- Decided by the runner's code (from the card and the tool, never from the model's arguments) for
-- every approval it opens: there is no default, so an approval opened without the decision is
-- refused (not_null_violation) instead of silently counting as not involving money. Like the other
-- content columns it never changes afterwards (it is not in the application's update grant, and
-- the check below holds for the privileged role too). Rows that existed before this migration
-- count as involving money.
alter table office.approvals add column involves_money boolean not null default true;
alter table office.approvals alter column involves_money drop default;

-- The importance check reads the tool's kind and the basis note's flag as the reader role, so the
-- answer does not depend on what the deciding person can see.
grant select (name, kind) on office.tools to office_auth_reader;
grant select (company_id, is_source_of_truth) on office.notes to office_auth_reader;

/*
 * The importance rule, with the caller's own rights: the approval check calls it as the reader
 * role (through approval_is_important), which sees every note; the API's question
 * (approval_needs_step_up) runs it with the person's rights, so it reveals nothing the person
 * cannot read.
 *   - money or prices (involves_money);
 *   - a tool with an external effect;
 *   - a basis note that is a source of truth;
 *   - a tool that changes an existing note (update_note, link_notes, import_document: their
 *     approval rule in agents/tools.yaml is about a source of truth note) without a note as the
 *     basis: the target is unknown, so it counts as important.
 */
create function office.approval_importance(
  p_company_id uuid,
  p_involves_money boolean,
  p_tool_name text,
  p_basis_type text,
  p_basis_id uuid
) returns boolean
  language sql stable set search_path = ''
  as $$
    select coalesce(p_involves_money, true)
      or exists (
        select 1 from office.tools t where t.name = p_tool_name and t.kind = 'external_effect'
      )
      or (
        p_basis_type is not distinct from 'note'
        and exists (
          select 1 from office.notes n
          where n.id = p_basis_id and n.company_id = p_company_id and n.is_source_of_truth
        )
      )
      or (
        coalesce(p_tool_name in ('update_note', 'link_notes', 'import_document'), false)
        and (p_basis_type is distinct from 'note' or p_basis_id is null)
      )
  $$;

/*
 * The approval check's answer, read as the reader role. Only inside a trigger (the approval check):
 * called directly, its arguments would let the caller ask about any company's notes.
 */
create function office.approval_is_important(
  p_company_id uuid,
  p_involves_money boolean,
  p_tool_name text,
  p_basis_type text,
  p_basis_id uuid
) returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'Only the approval check asks this; use approval_needs_step_up'
      using errcode = 'insufficient_privilege';
  end if;
  return office.approval_importance(
    p_company_id, p_involves_money, p_tool_name, p_basis_type, p_basis_id
  );
end
$$;
alter function office.approval_is_important(uuid, boolean, text, text, uuid)
  owner to office_auth_reader;

/*
 * For the API, before it opens a ceremony: does approving this approval of the context company
 * need a passkey re-verification? Reads the approval and its basis with the person's rights; null
 * when the approval is not visible in the context company. A basis note the person cannot see
 * counts as important (the approval check decides with every note visible; a needless ceremony is
 * better than a refusal after the decision).
 */
create function office.approval_needs_step_up(p_approval_id uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select office.approval_importance(
        a.company_id, a.involves_money, a.tool_name, a.basis_type, a.basis_id
      )
      or (
        a.basis_type is not distinct from 'note'
        and not exists (select 1 from office.notes n where n.id = a.basis_id)
      )
    from office.approvals a
    where a.id = p_approval_id and a.company_id = office.ctx_company_id()
  $$;

/*
 * Uses up an unused re-verification of the context person for this purpose, company and subject,
 * recorded in the current transaction. Returns false when there is none (or in an agent run).
 * Called only from the approval, membership, invitation and account checks (inside a trigger); the
 * API reaches it only through them.
 */
create function office.consume_step_up(p_purpose text, p_company_id uuid, p_subject_id uuid)
  returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_id uuid;
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'A re-verification is used up only by the checks of the changes it confirms'
      using errcode = 'insufficient_privilege';
  end if;
  if office.ctx_user_id() is null or office.ctx_agent_code() is not null then
    return false;
  end if;
  select s.id into v_id
  from office.step_ups s
  where s.user_id = office.ctx_user_id()
    and s.purpose = p_purpose
    and s.company_id = p_company_id
    and s.subject_id = p_subject_id
    and s.consumed_at is null
    and s.verified_at = pg_catalog.now()
    and s.verified_xact = pg_catalog.pg_current_xact_id()
  limit 1
  for update;
  if v_id is null then
    return false;
  end if;
  update office.step_ups s set consumed_at = pg_catalog.now() where s.id = v_id;
  return true;
end
$$;
alter function office.consume_step_up(text, uuid, uuid) owner to office_identity;

revoke execute on function
  office.approval_importance(uuid, boolean, text, text, uuid),
  office.approval_is_important(uuid, boolean, text, text, uuid),
  office.approval_needs_step_up(uuid),
  office.consume_step_up(text, uuid, uuid)
  from public;
-- Only the API decides approvals and changes memberships; a worker that reached these checks would
-- be refused by the missing privilege. The approval check runs with the caller's rights, so the API
-- needs the privilege on approval_is_important, which refuses a direct call. The API asks
-- approval_needs_step_up before it opens the ceremony. The reader role runs the rule for
-- approval_is_important.
grant execute on function
  office.approval_importance(uuid, boolean, text, text, uuid),
  office.approval_is_important(uuid, boolean, text, text, uuid),
  office.approval_needs_step_up(uuid),
  office.consume_step_up(text, uuid, uuid)
  to office_api_private;
grant execute on function office.approval_importance(uuid, boolean, text, text, uuid)
  to office_auth_reader;

-- The approval check, unchanged except for the money flag staying fixed and the re-verification an
-- important approval needs (after every other check, so their errors come first).
create or replace function office.check_approval() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
  prev office.approvals;
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
      new.attempt := prev.attempt + 1;
    end if;
    return new;
  end if;

  -- Invalidation: only the trigger role writes it, when the basis changes.
  if new.invalidated_at is distinct from old.invalidated_at
     and current_user <> 'office_trigger' then
    raise exception 'An approval cannot be invalidated manually'
      using errcode = 'insufficient_privilege';
  end if;

  if new.involves_money is distinct from old.involves_money then
    raise exception 'Whether an approval involves money is fixed when it is opened'
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
    if agent is null and not office.can_approve() then
      raise exception 'The approval summary is changed by an agent or by a person who can approve'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.status = 'pending' and new.status <> 'pending' then
    if agent is not null or not office.can_approve() then
      raise exception 'Only a person who can approve makes the approval decision'
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
      -- 3 October decision 7: an important approval is approved only after a passkey
      -- re-verification for it in this transaction.
      if office.approval_is_important(
        old.company_id, old.involves_money, old.tool_name, old.basis_type, old.basis_id
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
    new.sent_by_user_id := office.ctx_user_id();
    new.sent_at := pg_catalog.now();
  end if;
  return new;
end
$$;

-- Memberships ---------------------------------------------------------------------------------

/*
 * Changing a member's role or approval right, or removing the membership, needs a re-verification
 * of the context person for that member and company in this transaction. Runs after the founder
 * guards (trigger names sort after them), so their errors come first. An update that changes
 * neither column needs none; neither does a change without a person in the context.
 */
create function office.require_membership_step_up() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE'
     and new.role is not distinct from old.role
     and new.can_approve is not distinct from old.can_approve then
    return new;
  end if;
  -- Migrations and the seed run without a person in the context.
  if office.ctx_user_id() is not null then
    if not office.consume_step_up('membership_change', old.company_id, old.user_id) then
      raise exception
        'Changing a role, the approval right or a membership needs a passkey re-verification'
        using errcode = 'invalid_authorization_specification';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
revoke execute on function office.require_membership_step_up() from public;
create trigger require_step_up before update of role, can_approve or delete on office.memberships
  for each row execute function office.require_membership_step_up();

-- Accounts --------------------------------------------------------------------------------------

/*
 * Activating or deactivating an account changes every membership of the account at once, so it
 * needs the membership_change re-verification of the context person for that account in the context
 * company (the founder manages an account only in a company the account belongs to, and only when
 * they are its founder in every company of the account). Runs after the account guards (trigger
 * names sort after them), so their errors come first. The login function reopens an account
 * without a person in the context and needs none.
 */
create function office.require_account_step_up() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if office.ctx_user_id() is not null
     and not office.consume_step_up('membership_change', office.ctx_company_id(), old.id) then
    raise exception 'Activating or deactivating an account needs a passkey re-verification'
      using errcode = 'invalid_authorization_specification';
  end if;
  return new;
end
$$;
revoke execute on function office.require_account_step_up() from public;
create trigger require_step_up before update of active on office.users
  for each row when (old.active is distinct from new.active)
  execute function office.require_account_step_up();

-- Invitations -----------------------------------------------------------------------------------

/*
 * Creating an invitation grants a membership, with its role and approval right, at the first
 * sign-in of the address; renewing one brings an expired grant back. Both need the invitation
 * re-verification of the context person for that invitation and company in this transaction. The
 * API gives a new invitation its id, so the re-verification names it before it exists. An AFTER
 * trigger: the invitation check, the constraints and the row policy refuse a wrong invitation
 * first, so the re-verification is asked only for one that is otherwise valid.
 */
create function office.require_invitation_step_up() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' and new.expires_at is not distinct from old.expires_at then
    return null;
  end if;
  if office.ctx_user_id() is not null
     and not office.consume_step_up('invitation', new.company_id, new.id) then
    raise exception 'Creating or renewing an invitation needs a passkey re-verification'
      using errcode = 'invalid_authorization_specification';
  end if;
  return null;
end
$$;
revoke execute on function office.require_invitation_step_up() from public;
create trigger require_step_up after insert or update of expires_at on office.invitations
  for each row execute function office.require_invitation_step_up();

-- The API gives a new invitation its id (the re-verification names it).
grant insert (id) on office.invitations to office_api_private;
