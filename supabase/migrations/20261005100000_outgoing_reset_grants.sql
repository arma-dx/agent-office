-- Outgoing work, passkey reset and access grants (KALAN-ISLER 0.3 and 0.5; CLAUDE.md rules 3, 4,
-- 9; 5 October decisions 2, 3 and 4; 3 October decision 7).
--
-- Outgoing work (decision 2): work a person sends outside the company by hand after it is approved
-- (a social media post, a report for a customer, minutes for outside participants, a proposal) is
-- important too, so approving it needs a passkey re-verification. The agent that opens an approval
-- states whether the work goes outside (approvals.goes_external): the column has no default, so an
-- approval opened without the statement is refused, and it never changes afterwards. The statement
-- binds what follows: work stated as staying inside is never marked as sent outside, and a new
-- attempt after a change request never takes back that the work goes outside or involves money.
--
-- Passkey reset (decision 3): a founder resets every passkey of a person with their own passkey
-- re-verification (purpose passkey_reset, naming the person, in the same transaction). The person's
-- open sessions close, the reset is written to the company's audit log and to the person's
-- notifications, and the person registers a first passkey again within 10 minutes of a new Google
-- sign-in (the existing rule: no active passkey). A founder's passkeys (their own or another
-- founder's) are never reset this way; the database administrator resets them by hand
-- (admin_reset_passkeys).
--
-- Access grants (decision 4): opening a task or a note to an external person needs a passkey
-- re-verification of the person granting it (purpose access_grant, naming the grantee, in the same
-- transaction). Removing a grant needs none; project membership changes need none.
--
-- Error codes are the ones the passkey migrations use: 28000 a re-verification is missing, 42501
-- not allowed, 22023 malformed input.

-- Approvals -----------------------------------------------------------------------------------

-- Stated by the agent that opens the approval; rows that existed before this migration count as
-- going outside (nothing was stated for them, and a missing statement counts as yes, as it did for
-- involves_money). Like involves_money it has no default afterwards and is not in the
-- application's update grant; the approval check below refuses a change for the privileged role
-- too.
alter table office.approvals add column goes_external boolean not null default true;
alter table office.approvals alter column goes_external drop default;

-- The importance rule takes the new statement, so its older forms go: a caller that left it out
-- would get a wrong answer.
drop function office.approval_is_important(uuid, boolean, text, text, uuid);
drop function office.approval_importance(uuid, boolean, text, text, uuid);

/*
 * The importance rule, with the caller's own rights: the approval check calls it as the reader
 * role (through approval_is_important), which sees every note; the API's question
 * (approval_needs_step_up) runs it with the person's rights, so it reveals nothing the person
 * cannot read.
 *   - money or prices (involves_money);
 *   - work a person sends outside the company after the approval (goes_external);
 *   - a tool with an external effect;
 *   - a basis note that is a source of truth;
 *   - a tool that changes an existing note (update_note, link_notes, import_document: their
 *     approval rule in agents/tools.yaml is about a source of truth note) without a note as the
 *     basis: the target is unknown, so it counts as important.
 * A statement that is missing counts as yes.
 */
create function office.approval_importance(
  p_company_id uuid,
  p_involves_money boolean,
  p_goes_external boolean,
  p_tool_name text,
  p_basis_type text,
  p_basis_id uuid
) returns boolean
  language sql stable set search_path = ''
  as $$
    select coalesce(p_involves_money, true)
      or coalesce(p_goes_external, true)
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
  p_goes_external boolean,
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
    p_company_id, p_involves_money, p_goes_external, p_tool_name, p_basis_type, p_basis_id
  );
end
$$;
alter function office.approval_is_important(uuid, boolean, boolean, text, text, uuid)
  owner to office_auth_reader;

-- Same question and signature as before; it now counts outgoing work too.
create or replace function office.approval_needs_step_up(p_approval_id uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select office.approval_importance(
        a.company_id, a.involves_money, a.goes_external, a.tool_name, a.basis_type, a.basis_id
      )
      or (
        a.basis_type is not distinct from 'note'
        and not exists (select 1 from office.notes n where n.id = a.basis_id)
      )
    from office.approvals a
    where a.id = p_approval_id and a.company_id = office.ctx_company_id()
  $$;

revoke execute on function
  office.approval_importance(uuid, boolean, boolean, text, text, uuid),
  office.approval_is_important(uuid, boolean, boolean, text, text, uuid)
  from public;
-- As before: only the API decides approvals; the reader role runs the rule for
-- approval_is_important.
grant execute on function
  office.approval_importance(uuid, boolean, boolean, text, text, uuid),
  office.approval_is_important(uuid, boolean, boolean, text, text, uuid)
  to office_api_private;
grant execute on function office.approval_importance(uuid, boolean, boolean, text, text, uuid)
  to office_auth_reader;

-- The approval check. New here: the outgoing statement stays fixed like the money flag and takes
-- part in the importance rule; a new attempt after a change request does not take back what the
-- attempt before it stated; and only work that goes outside is marked as sent.
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
  if new.goes_external is distinct from old.goes_external then
    raise exception 'Whether the approved work goes outside is fixed when the approval is opened'
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

-- Re-verification purposes ----------------------------------------------------------------------

-- Two new purposes, both for a company (rule 2):
--   passkey_reset   subject: the person whose passkeys are reset
--   access_grant    subject: the person a task or a note is opened to
alter table office.step_ups drop constraint step_ups_purpose_check;
alter table office.step_ups add constraint step_ups_purpose_check check (
  purpose in (
    'approve', 'membership_change', 'invitation', 'passkey_add', 'passkey_revoke', 'passkey_reset',
    'access_grant'
  )
);
alter table office.step_ups drop constraint company_with_company_purpose;
alter table office.step_ups add constraint company_with_company_purpose check (
  (company_id is not null) = (
    purpose in ('approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant')
  )
);

/*
 * Records a re-verification after the API verified the assertion (signature, origin, user
 * verification, user handle). Unchanged except for the two new purposes; same signature, owner and
 * privileges as before.
 *   approve, membership_change, invitation, passkey_reset, access_grant
 *                               company: the context company, where the person is a member;
 *                               subject: the approval, the member whose membership or account
 *                               changes, the invitation created or renewed, the person whose
 *                               passkeys are reset, or the person a task or a note is opened to
 *   passkey_add                 no company, no subject
 *   passkey_revoke              no company; subject: the ref of an active passkey of the person
 * Whether the person may make the change is decided where the re-verification is used up (the
 * checks and reset_passkeys), not here. Returns the re-verification's id.
 */
create or replace function office.record_step_up(
  p_key_hash bytea,
  p_challenge_id uuid,
  p_credential_id text,
  p_new_counter bigint,
  p_purpose text,
  p_company_id uuid,
  p_subject_id uuid,
  p_context_hash bytea
) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_challenge office.passkey_challenges;
  v_passkey office.passkeys;
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_context_hash is null or pg_catalog.octet_length(p_context_hash) <> 32 then
    raise exception 'The context hash must be 32 bytes' using errcode = 'invalid_parameter_value';
  end if;
  if p_new_counter is null or p_new_counter not between 0 and 4294967295 then
    raise exception 'The signature counter is out of range'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_purpose in (
    'approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant'
  ) then
    if p_company_id is null or p_subject_id is null then
      raise exception 'A re-verification for % names the company and the subject', p_purpose
        using errcode = 'invalid_parameter_value';
    end if;
    if p_company_id is distinct from office.ctx_company_id() or not exists (
      select 1 from office.memberships m
      where m.company_id = p_company_id and m.user_id = v_session.user_id
    ) then
      raise exception 'A re-verification for a company is recorded only in that company''s context'
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_purpose = 'passkey_add' then
    if p_company_id is not null or p_subject_id is not null then
      raise exception 'A re-verification for adding a passkey names no company and no subject'
        using errcode = 'invalid_parameter_value';
    end if;
  elsif p_purpose = 'passkey_revoke' then
    if p_company_id is not null or p_subject_id is null or not exists (
      select 1 from office.passkeys p
      where p.ref = p_subject_id and p.user_id = v_session.user_id and p.revoked_at is null
    ) then
      raise exception 'A re-verification for revoking names an active passkey of the person'
        using errcode = 'invalid_parameter_value';
    end if;
  else
    raise exception 'Unknown re-verification purpose' using errcode = 'invalid_parameter_value';
  end if;

  select c.* into v_challenge
  from office.passkey_challenges c
  where c.id = p_challenge_id
    and c.session_id = v_session.id
    and c.user_id = v_session.user_id
    and c.purpose = 'step_up'
    and c.consumed_at is null
    and c.expires_at > pg_catalog.now()
    and c.failed_attempts < 5
  for update;
  if v_challenge.id is null then
    raise exception 'No open re-verification challenge of this session'
      using errcode = 'invalid_authorization_specification';
  end if;
  if v_challenge.context_hash is distinct from p_context_hash then
    raise exception 'The re-verification was signed for something else'
      using errcode = 'invalid_authorization_specification';
  end if;

  select p.* into v_passkey
  from office.passkeys p
  where p.id = p_credential_id and p.user_id = v_session.user_id and p.revoked_at is null
  for update;
  if v_passkey.id is null then
    raise exception 'Not an active passkey of this person'
      using errcode = 'invalid_authorization_specification';
  end if;
  if (v_passkey.counter > 0 or p_new_counter > 0) and p_new_counter <= v_passkey.counter then
    raise exception 'The signature counter did not increase; the passkey may be cloned'
      using errcode = 'invalid_authorization_specification';
  end if;

  update office.passkeys p set counter = p_new_counter, last_used_at = pg_catalog.now()
    where p.id = v_passkey.id;
  update office.passkey_challenges c set consumed_at = pg_catalog.now()
    where c.id = v_challenge.id;
  insert into office.step_ups
      (id, user_id, session_id, passkey_id, purpose, company_id, subject_id, context_hash)
    values (
      v_id, v_session.user_id, v_session.id, v_passkey.id, p_purpose, p_company_id, p_subject_id,
      p_context_hash
    );
  return v_id;
end
$$;

-- Passkey reset -----------------------------------------------------------------------------------

-- A session closed by a reset says so, and so does its login event.
alter table office.sessions drop constraint sessions_close_reason_check;
alter table office.sessions add constraint sessions_close_reason_check check (
  close_reason in ('logout', 'logout_all', 'account_closed', 'expired', 'passkeys_reset')
);
alter table office.login_events drop constraint login_events_reason_check;
alter table office.login_events add constraint login_events_reason_check check (
  reason in (
    -- complete_login results
    'not_allowed', 'account_mismatch', 'inactive',
    -- ID token checks in the API (rule 3; 3 October decisions 8 and 11)
    'email_unverified', 'mfa_missing',
    -- sessions closed by the database
    'idle_timeout', 'absolute_timeout', 'account_inactive', 'no_membership', 'passkeys_reset'
  )
);

/*
 * Can the context person reset this person's passkeys: the context person is an active founder of
 * the context company, the other person is someone else and a member of that company, and the
 * context person is the founder in every company the other person is a member of (the rule of
 * can_manage_account: a founder never touches an account that also reaches a company they do not
 * run). The other person is a founder of no company: a founder's passkeys are reset by the
 * database administrator, so a stolen founder session with its passkey cannot sign the other
 * founders out and take their passkeys away (the membership routes protect a founder the same
 * way). Never in an agent run. The answer tells whether the person is a member elsewhere, so the
 * API asks it only after the founder's passkey checked out; reset_passkeys and the policies below
 * apply it.
 */
create function office.can_reset_passkeys(p_user_id uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(
      office.ctx_agent_code() is null
      and p_user_id <> office.ctx_user_id()
      and office.is_active_founder(office.ctx_company_id(), office.ctx_user_id())
      and office.can_manage_account(p_user_id)
      and not exists (
        select 1 from office.memberships m where m.user_id = p_user_id and m.role = 'founder'
      ),
      false
    )
  $$;
alter function office.can_reset_passkeys(uuid) owner to office_auth_reader;

-- office_identity (the owner of reset_passkeys) revokes the active passkeys of a person the
-- context founder may reset: it reads them and sets revoked_at, nothing else. Its own policy
-- (identity_own) still covers only the context person's passkeys.
create policy identity_reset_reads on office.passkeys for select to office_identity
  using (office.can_reset_passkeys(user_id));
create policy identity_resets on office.passkeys for update to office_identity
  using (revoked_at is null and office.can_reset_passkeys(user_id))
  with check (revoked_at is not null and office.can_reset_passkeys(user_id));

-- The same for that person's open challenges: it only closes them.
create policy identity_reset_reads on office.passkey_challenges for select to office_identity
  using (office.can_reset_passkeys(user_id));
create policy identity_reset_closes on office.passkey_challenges for update to office_identity
  using (consumed_at is null and office.can_reset_passkeys(user_id))
  with check (consumed_at is not null and office.can_reset_passkeys(user_id));

-- It writes one kind of audit row: the reset, in the context company. Who and when come from the
-- context (set_audit_fields).
grant insert (company_id, event, record_type, record_id) on office.audit_log to office_identity;
create policy identity_records_reset on office.audit_log for insert to office_identity
  with check (
    company_id = office.ctx_company_id()
    and event = 'passkeys_reset'
    and record_type = 'user'
    and office.can_reset_passkeys(record_id)
  );
-- The event belongs to the reset alone: the application role (every request of the API and every
-- agent run of the worker) cannot write a row that says a reset happened. Only reset_passkeys and
-- the database administrator write it.
create policy reserved_events on office.audit_log as restrictive for insert to office_app
  with check (event <> 'passkeys_reset');

-- And one kind of notification: the reset, to the person themselves, in the context company
-- (decision 3: the person is told). Who sent it comes from the context (set_notification_sender).
-- The template is the reset's alone too, so no request and no agent run can tell a person that
-- their passkeys were reset.
grant insert (company_id, recipient_user_id, template, record_type, record_id)
  on office.notifications to office_identity;
create policy identity_notifies_reset on office.notifications for insert to office_identity
  with check (
    company_id = office.ctx_company_id()
    and template = 'passkeys_reset'
    and record_type = 'user'
    and record_id = recipient_user_id
    and office.can_reset_passkeys(recipient_user_id)
  );
create policy reserved_templates on office.notifications as restrictive for insert to office_app
  with check (template <> 'passkeys_reset');

/*
 * Resets a person's passkeys (5 October decision 3). The caller is the person of the live session
 * and an active founder of the context company; the person is someone else the founder may reset
 * (can_reset_passkeys: never a founder). Needs a passkey_reset re-verification of this session for
 * the context company naming the person, recorded in this same transaction; it is used up.
 *   - closes the person's open challenges, so a registration that was under way (and waited for
 *     this reset on the person's passkey lock) cannot add a passkey after it;
 *   - revokes every active passkey of the person (a revoked passkey never comes back);
 *   - closes the person's open sessions (close reason and login event reason passkeys_reset), so
 *     nothing keeps running on a device that may be lost;
 *   - writes an audit_log row in the context company: event passkeys_reset, record_type user,
 *     record_id the person; the actor comes from the context;
 *   - writes the person's notification in the context company: template passkeys_reset, the same
 *     record, sent by the founder. It is a panel notification: no e-mail is sent, so the founder
 *     also tells the person (the panel says so after the reset).
 * The person then has no active passkey: after a new Google sign-in they register a first passkey
 * within 10 minutes (create_passkey_challenge). Returns the number of passkeys revoked; a person
 * without a passkey is reset too (0), which closes their sessions.
 */
create function office.reset_passkeys(p_key_hash bytea, p_user_id uuid) returns integer
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_company uuid := office.ctx_company_id();
  v_step_up uuid;
  v_closing uuid;
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'The person whose passkeys are reset must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_user_id = v_session.user_id then
    raise exception 'A person does not reset their own passkeys'
      using errcode = 'insufficient_privilege';
  end if;
  if v_company is null or not office.can_reset_passkeys(p_user_id) then
    raise exception
      'Only an active founder resets the passkeys of a member whose every company they run'
      using errcode = 'insufficient_privilege';
  end if;

  perform office.lock_passkeys(p_user_id);
  select s.id into v_step_up
  from office.step_ups s
  where s.user_id = v_session.user_id
    and s.session_id = v_session.id
    and s.purpose = 'passkey_reset'
    and s.company_id = v_company
    and s.subject_id = p_user_id
    and s.consumed_at is null
    and s.verified_at = pg_catalog.now()
    and s.verified_xact = pg_catalog.pg_current_xact_id()
  limit 1
  for update;
  if v_step_up is null then
    raise exception 'Resetting passkeys needs a re-verification in the same transaction'
      using errcode = 'invalid_authorization_specification';
  end if;
  update office.step_ups s set consumed_at = pg_catalog.now() where s.id = v_step_up;

  -- Challenges before passkeys: the order record_step_up locks them in.
  update office.passkey_challenges c set consumed_at = pg_catalog.now()
    where c.user_id = p_user_id and c.consumed_at is null;
  update office.passkeys p set revoked_at = pg_catalog.now()
    where p.user_id = p_user_id and p.revoked_at is null;
  get diagnostics v_count = row_count;

  for v_closing in
    select s.id from office.sessions s where s.user_id = p_user_id and s.closed_at is null
    order by s.id
  loop
    perform office.expire_session(v_closing, 'passkeys_reset', 'passkeys_reset');
  end loop;

  insert into office.audit_log (company_id, event, record_type, record_id)
    values (v_company, 'passkeys_reset', 'user', p_user_id);
  insert into office.notifications
      (company_id, recipient_user_id, template, record_type, record_id)
    values (v_company, p_user_id, 'passkeys_reset', 'user', p_user_id);
  return v_count;
end
$$;
alter function office.reset_passkeys(bytea, uuid) owner to office_identity;

revoke execute on function office.can_reset_passkeys(uuid), office.reset_passkeys(bytea, uuid)
  from public;
grant execute on function office.can_reset_passkeys(uuid)
  to office_identity, office_api_private;
grant execute on function office.reset_passkeys(bytea, uuid) to office_api_private;

/*
 * The database administrator's reset (5 October decision 3: when a founder's passkeys are lost the
 * reset is done by the database administrator), for the account that signs in with the address:
 *   select * from office.admin_reset_passkeys('founder@example.com');
 * It does what reset_passkeys does without a founder's re-verification: closes the account's open
 * challenges, revokes every active passkey, closes the open sessions, and writes a passkeys_reset
 * audit row in every company of the account, without an actor (there is no context company and no
 * person). It writes no notification: the administrator acts together with the person. The person
 * then signs in with Google again and registers a first passkey within 10 minutes. Returns the
 * number of passkeys revoked and of sessions closed.
 *
 * Runs with the caller's own rights and is granted to nobody: only the role that ran the
 * migrations (it owns the tables and is a member of office_identity) or a superuser can call it,
 * and that role must bypass row security. Never on the request path: the API's and the worker's
 * roles cannot execute it, and it refuses a context with a person or an agent.
 */
create function office.admin_reset_passkeys(p_email text)
  returns table (passkeys_revoked integer, sessions_closed integer)
  language plpgsql set search_path = ''
  as $$
declare
  v_user uuid;
  v_session uuid;
begin
  if office.ctx_user_id() is not null or office.ctx_agent_code() is not null then
    raise exception 'The administrator resets passkeys outside a request and outside an agent run'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)
  ) then
    raise exception 'Run this as the database administrator (a role that bypasses row security)'
      using errcode = 'insufficient_privilege';
  end if;
  select e.user_id into v_user
  from office.user_emails e
  where e.email = pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_user is null then
    -- The address is not repeated: error messages reach the logs.
    raise exception 'No account signs in with this address' using errcode = 'no_data_found';
  end if;

  perform office.lock_passkeys(v_user);
  -- Challenges before passkeys: the order record_step_up locks them in.
  update office.passkey_challenges c set consumed_at = pg_catalog.now()
    where c.user_id = v_user and c.consumed_at is null;
  update office.passkeys p set revoked_at = pg_catalog.now()
    where p.user_id = v_user and p.revoked_at is null;
  get diagnostics passkeys_revoked = row_count;

  sessions_closed := 0;
  for v_session in
    select s.id from office.sessions s where s.user_id = v_user and s.closed_at is null
    order by s.id
  loop
    perform office.expire_session(v_session, 'passkeys_reset', 'passkeys_reset');
    sessions_closed := sessions_closed + 1;
  end loop;

  insert into office.audit_log (company_id, event, record_type, record_id)
    select m.company_id, 'passkeys_reset', 'user', v_user
    from office.memberships m
    where m.user_id = v_user;
  return next;
end
$$;
revoke execute on function office.admin_reset_passkeys(text) from public;

-- Access grants -----------------------------------------------------------------------------------

-- A grant is given and taken back, never rewritten: an update that pointed an existing grant at
-- another person or another record would open that record without a re-verification.
create trigger immutable_columns before update on office.access_grants
  for each row execute function office.prevent_column_changes(
    'company_id', 'user_id', 'record_type', 'record_id'
  );

/*
 * Opening a task or a note to a person needs a re-verification of the context person for that
 * person and company in this transaction (purpose access_grant; subject: the grantee); the grant
 * uses it up, so each grant needs its own. Removing a grant needs none. An insert without a person
 * in the context (migrations, the seed, an administrator) needs none.
 */
create function office.require_access_grant_step_up() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if office.ctx_user_id() is not null
     and not office.consume_step_up('access_grant', new.company_id, new.user_id) then
    raise exception 'Opening a task or a note to a person needs a passkey re-verification'
      using errcode = 'invalid_authorization_specification';
  end if;
  return new;
end
$$;
revoke execute on function office.require_access_grant_step_up() from public;
create trigger require_step_up before insert on office.access_grants
  for each row execute function office.require_access_grant_step_up();
