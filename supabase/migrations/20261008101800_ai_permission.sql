-- The AI permission of a project and the contract permissions of a customer (8 October decisions
-- 15, 16 and 22; docs/SONRA.md P-b, W-i; CLAUDE.md rules 3, 9 and 12).
--
-- Rule 12 is enforced as before: the project policy, the customer policy, office.check_task and
-- the runner read projects.ai_allowed and customers.ai_allowed. This migration only decides who
-- sets these values and how:
--   - projects.ai_allowed, customers.ai_allowed and customers.automated_processing_allowed are in
--     no application role's column grants. They change through office.set_project_ai_permission
--     and office.set_customer_permissions, which only the API's role may call;
--   - a trigger on each table asks, whenever a person is in the context, for the founder of that
--     company, and never accepts an agent run; turning an AI permission ON also uses up a passkey
--     re-verification of the founder for exactly that project (purpose project_ai_permission) or
--     that customer (purpose customer_ai_permission), recorded in the same transaction (decision
--     22). Turning a permission off needs none: it only stops agents. The automated processing
--     permission needs none either way;
--   - the founder opens a project's AI permission for the customer the project had when they
--     confirmed with the passkey: the function is told that customer and refuses when the project
--     has another one by now;
--   - while a project's AI permission is open its customer does not change: rule 12 reads which
--     customer a project has, and members may now change it;
--   - an employee adds a customer by name, with both permissions closed (P-b); a customer is
--     added in a company, never in the founder space;
--   - a write without a person in the context (migrations, the seed, an administrator) is left
--     alone, as for memberships and invitations. (Until now the customer check refused it.)
-- The application no longer updates or deletes a customer row: the Müşteriler screen and the
-- update_customer tool bring their own grants when they are built.
--
-- Error codes: 28000 a re-verification is missing, 42501 not allowed, P0002 no such record,
-- 55000 the project has another customer than the one the opening was confirmed for, 23514 a rule
-- of the record.

-- Re-verification purposes ------------------------------------------------------------------------

-- Two new purposes, both for a company (rule 2):
--   project_ai_permission    subject: the project whose AI permission is opened
--   customer_ai_permission   subject: the customer whose AI permission is opened
alter table office.step_ups drop constraint step_ups_purpose_check;
alter table office.step_ups add constraint step_ups_purpose_check check (
  purpose in (
    'approve', 'membership_change', 'invitation', 'passkey_add', 'passkey_revoke', 'passkey_reset',
    'access_grant', 'project_ai_permission', 'customer_ai_permission'
  )
);
alter table office.step_ups drop constraint company_with_company_purpose;
alter table office.step_ups add constraint company_with_company_purpose check (
  (company_id is not null) = (
    purpose in (
      'approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant',
      'project_ai_permission', 'customer_ai_permission'
    )
  )
);

/*
 * Records a re-verification after the API verified the assertion (signature, origin, user
 * verification, user handle). Unchanged except for the two new purposes; same signature, owner and
 * privileges as before.
 *   approve, membership_change, invitation, passkey_reset, access_grant, project_ai_permission,
 *   customer_ai_permission
 *                               company: the context company, where the person is a member;
 *                               subject: the approval, the member whose membership or account
 *                               changes, the invitation created or renewed, the person whose
 *                               passkeys are reset, the person a task or a note is opened to, the
 *                               project or the customer whose AI permission is opened
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
    'approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant',
    'project_ai_permission', 'customer_ai_permission'
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

-- The two functions below run as office_trigger, and so do the checks their updates fire: the
-- check that uses a re-verification up needs the privilege. consume_step_up still answers only
-- inside a trigger and only for the context person.
grant execute on function office.consume_step_up(text, uuid, uuid) to office_trigger;

-- The AI permission of a project ------------------------------------------------------------------

/*
 * Whoever changes ai_allowed of a project while a person is in the context: that person is the
 * founder of the project's company, never an agent run, and turning the permission on uses up
 * their project_ai_permission re-verification for this project in this transaction. Holds for
 * every role, the privileged one too. A change without a person in the context (migrations, the
 * seed, an administrator) needs none. Runs with the caller's rights.
 */
create function office.guard_project_ai_permission() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.ai_allowed is not distinct from old.ai_allowed then
    return new;
  end if;
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null
     or old.company_id is distinct from office.ctx_company_id()
     or not office.is_founder() then
    raise exception 'Only the founder changes the AI permission of a project'
      using errcode = 'insufficient_privilege';
  end if;
  if new.ai_allowed
     and not office.consume_step_up('project_ai_permission', old.company_id, old.id) then
    raise exception 'Opening the AI permission of a project needs a passkey re-verification'
      using errcode = 'invalid_authorization_specification';
  end if;
  return new;
end
$$;
revoke execute on function office.guard_project_ai_permission() from public;
-- On every update, not only on one that names the column: a value that a trigger changed on the
-- way is held to the same rule.
create trigger guard_ai_permission before update on office.projects
  for each row execute function office.guard_project_ai_permission();

/*
 * Rule 12 reads which customer a project has. The founder opened the project's AI permission,
 * with a passkey, for the customer it had then. While that permission is open the customer does
 * not change, for anybody: the founder closes the permission, the customer changes, the founder
 * opens it again. Without this a member could take a customer whose contract forbids AI off the
 * project and so let agents work there. A write without a person in the context (migrations, the
 * seed, an administrator) is left alone. Runs with the caller's rights; reads only the row.
 */
create function office.keep_customer_while_ai_open() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.customer_id is not distinct from old.customer_id or not old.ai_allowed then
    return new;
  end if;
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  raise exception 'The customer of a project does not change while its AI permission is open'
    using errcode = 'check_violation';
end
$$;
revoke execute on function office.keep_customer_while_ai_open() from public;
create trigger keep_customer_while_ai_open before update of customer_id on office.projects
  for each row execute function office.keep_customer_while_ai_open();

grant select (id, company_id, customer_id, ai_allowed), update (ai_allowed)
  on office.projects to office_trigger;
create policy permission_reads on office.projects for select to office_trigger using (true);
create policy permission_changes on office.projects for update to office_trigger
  using (true) with check (true);

/*
 * The founder opens or closes the AI permission of a project of the context company (decision 15).
 * Opening needs a project_ai_permission re-verification of the founder for this project, recorded
 * in this same transaction; the check above uses it up (decision 22). Closing needs none.
 *
 * Rule 12 reads which customer a project has, so the founder opens the permission for a project
 * WITH its customer: p_customer is the customer the project had when the founder confirmed (null:
 * none), which the API takes from the request the passkey signed. If the project has another
 * customer by now (a member changed it between the confirmation and this call) the opening is
 * refused with 55000 and nothing is used up: the founder looks at the project again. The row is
 * locked first, so a customer change that runs at the same time either is seen here or waits and
 * then meets keep_customer_while_ai_open. p_customer is not read when the permission is closed.
 *
 * Returns whether the value changed; asking for the value the project already has changes nothing
 * and uses nothing up. Only the API calls it: the worker's role has no privilege.
 */
create function office.set_project_ai_permission(
  p_project uuid, p_allowed boolean, p_customer uuid
) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_current boolean;
  v_customer uuid;
begin
  if p_project is null or p_allowed is null then
    raise exception 'The project and the new value must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder changes the AI permission of a project'
      using errcode = 'insufficient_privilege';
  end if;
  select p.ai_allowed, p.customer_id into v_current, v_customer
    from office.projects p
    where p.id = p_project and p.company_id = office.ctx_company_id()
    for update;
  if v_current is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if v_current = p_allowed then
    return false;
  end if;
  if p_allowed and v_customer is distinct from p_customer then
    raise exception 'The project has another customer than the one the opening was confirmed for'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  update office.projects p set ai_allowed = p_allowed where p.id = p_project;
  return true;
end
$$;
alter function office.set_project_ai_permission(uuid, boolean, uuid) owner to office_trigger;
revoke execute on function office.set_project_ai_permission(uuid, boolean, uuid) from public;
grant execute on function office.set_project_ai_permission(uuid, boolean, uuid)
  to office_api_private;

-- Customers ---------------------------------------------------------------------------------------

revoke insert, update, delete on office.customers from office_app;
-- P-b: a founder or an employee adds a customer by name (the row policy "tenant_isolation"
-- decides who); the permissions are not in the grant, so they start closed. The API gives the
-- row its id, so that a re-verification can name a customer that is being added.
grant insert (id, company_id, name) on office.customers to office_api_private;

grant select (id, company_id, ai_allowed, automated_processing_allowed),
  update (ai_allowed, automated_processing_allowed)
  on office.customers to office_trigger;
create policy permission_reads on office.customers for select to office_trigger using (true);
create policy permission_changes on office.customers for update to office_trigger
  using (true) with check (true);

/*
 * The customer check, with the passkey. Whoever sets or changes a contract permission of a
 * customer while a person is in the context: that person is the founder of the customer's
 * company, never an agent run; turning the AI permission on (also on a new row) uses up their
 * customer_ai_permission re-verification for this customer in this transaction. A person adds a
 * customer in a company, never in the founder space (no project is opened there either). A write
 * without a person in the context is left alone. Same name and trigger as before; runs with the
 * caller's rights.
 */
create or replace function office.check_customer_permissions() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_changes boolean;
  v_opens_ai boolean;
begin
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Asked only on an insert, which only the API's role and an administrator can make: the
    -- permission function's update, running as office_trigger, never reaches company_kind.
    if office.company_kind(new.company_id) is distinct from 'company' then
      raise exception 'A customer is added in a company, not in the founder space'
        using errcode = 'check_violation';
    end if;
    v_changes := new.ai_allowed or new.automated_processing_allowed;
    v_opens_ai := new.ai_allowed;
  else
    v_changes := new.ai_allowed is distinct from old.ai_allowed
      or new.automated_processing_allowed is distinct from old.automated_processing_allowed;
    v_opens_ai := new.ai_allowed and not old.ai_allowed;
  end if;
  if not v_changes then
    return new;
  end if;
  if office.ctx_agent_code() is not null
     or new.company_id is distinct from office.ctx_company_id()
     or not office.is_founder() then
    raise exception 'Only the founder changes the contract permissions of a customer'
      using errcode = 'insufficient_privilege';
  end if;
  if v_opens_ai
     and not office.consume_step_up('customer_ai_permission', new.company_id, new.id) then
    raise exception 'Opening the AI permission of a customer needs a passkey re-verification'
      using errcode = 'invalid_authorization_specification';
  end if;
  return new;
end
$$;
-- The function is older than the habit of this file: it was still executable by everybody.
revoke execute on function office.check_customer_permissions() from public;

/*
 * The founder sets the contract permissions of a customer of the context company (decision 16;
 * P-b). A null argument leaves that permission as it is. Opening the AI permission needs a
 * customer_ai_permission re-verification of the founder for this customer, recorded in this same
 * transaction; the check above uses it up. Only the API calls it.
 */
create function office.set_customer_permissions(
  p_customer uuid, p_ai_allowed boolean, p_automated_processing_allowed boolean
) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_found uuid;
begin
  if p_customer is null then
    raise exception 'The customer must be given' using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder changes the contract permissions of a customer'
      using errcode = 'insufficient_privilege';
  end if;
  select c.id into v_found
    from office.customers c
    where c.id = p_customer and c.company_id = office.ctx_company_id()
    for update;
  if v_found is null then
    raise exception 'No such customer' using errcode = 'no_data_found';
  end if;
  update office.customers c set
      ai_allowed = coalesce(p_ai_allowed, c.ai_allowed),
      automated_processing_allowed =
        coalesce(p_automated_processing_allowed, c.automated_processing_allowed)
    where c.id = p_customer;
end
$$;
alter function office.set_customer_permissions(uuid, boolean, boolean) owner to office_trigger;
revoke execute on function office.set_customer_permissions(uuid, boolean, boolean) from public;
grant execute on function office.set_customer_permissions(uuid, boolean, boolean)
  to office_api_private;
