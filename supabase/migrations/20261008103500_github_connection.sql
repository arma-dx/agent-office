-- The GitHub connection of a company (8 October decisions 19 and 22; 12 October decisions 12 to
-- 17; docs/SONRA.md P-e, P-f, P-l, P-n, P-r; CLAUDE.md rules 2, 3, 6 and 9).
--
-- Decision 19: the GitHub organisation of a company is connected once, from the company's
-- settings. Decision 22: connecting asks for a passkey. 12 October decision 12: Arma DX and
-- Pillika connect as two separate GitHub organisations. From here on:
--   - a connection is the row of office.integrations with provider 'github': one per company, and
--     no two companies on one organisation or on one installation;
--   - the row holds no secret: the installation's number, the organisation's name and number, the
--     app's number and the read permissions the installation has. The token column stays empty
--     (the one hour tokens live in the API's memory) and every recorded permission is a read
--     permission (until the coding agents are built the connection only reads);
--   - only the founder connects and disconnects, only through office.connect_github and
--     office.disconnect_github, which only the API's role may call. No request and no agent run
--     writes a GitHub row by a statement of its own;
--   - connecting uses up a passkey re-verification of the founder for exactly that company
--     (purpose github_connection), recorded in the same transaction. Disconnecting asks for none:
--     it only takes access away;
--   - every founder and employee of the company reads the row (whoever opens a project picks a
--     repository); an external person and another company's people do not;
--   - connecting and disconnecting are written to the audit log, with the installation's number.
-- A write without a person in the context (migrations, the seed, an administrator) is left
-- alone, as for the AI permission.
--
-- Error codes: 28000 a re-verification is missing, 42501 not the founder or an agent run, 23514 a
-- row of another shape or the founder space, 55000 the company is connected to another
-- organisation, 23505 the organisation or the installation is the connection of another company,
-- 22023 a fact of the installation is missing.

-- Re-verification purpose -------------------------------------------------------------------------

-- One new purpose, for a company (rule 2):
--   github_connection   subject: the company whose GitHub organisation is connected
alter table office.step_ups drop constraint step_ups_purpose_check;
alter table office.step_ups add constraint step_ups_purpose_check check (
  purpose in (
    'approve', 'membership_change', 'invitation', 'passkey_add', 'passkey_revoke', 'passkey_reset',
    'access_grant', 'project_ai_permission', 'customer_ai_permission',
    'project_ai_spending_limit', 'github_connection'
  )
);
alter table office.step_ups drop constraint company_with_company_purpose;
alter table office.step_ups add constraint company_with_company_purpose check (
  (company_id is not null) = (
    purpose in (
      'approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant',
      'project_ai_permission', 'customer_ai_permission', 'project_ai_spending_limit',
      'github_connection'
    )
  )
);

/*
 * Records a re-verification after the API verified the assertion (signature, origin, user
 * verification, user handle). Unchanged except for the new purpose; same signature, owner and
 * privileges as before.
 *   approve, membership_change, invitation, passkey_reset, access_grant, project_ai_permission,
 *   customer_ai_permission, project_ai_spending_limit, github_connection
 *                               company: the context company, where the person is a member;
 *                               subject: the approval, the member whose membership or account
 *                               changes, the invitation created or renewed, the person whose
 *                               passkeys are reset, the person a task or a note is opened to, the
 *                               project or the customer whose AI permission is opened, the
 *                               project whose AI spending limit is raised or taken away, the
 *                               company whose GitHub organisation is connected
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
    'project_ai_permission', 'customer_ai_permission', 'project_ai_spending_limit',
    'github_connection'
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

-- The row -----------------------------------------------------------------------------------------

-- A project's repository names the connection it came through (the next migration).
alter table office.integrations add constraint integrations_id_company unique (id, company_id);
-- One GitHub connection per company (8 October decision 19: "bir kez").
create unique index integrations_one_github on office.integrations (company_id)
  where provider = 'github';
-- One installation and one GitHub organisation belong to one company only (12 October decision
-- 12: Arma DX and Pillika connect as separate organisations; rule 2).
create unique index integrations_github_installation
  on office.integrations ((settings ->> 'installation_id')) where provider = 'github';
create unique index integrations_github_account
  on office.integrations ((settings ->> 'account_id')) where provider = 'github';

/*
 * Is this what a GitHub connection row may hold. No secret: the token column is empty (the one
 * hour tokens live in the API's memory). Every recorded permission is a read permission: until
 * the coding agents are built the connection only reads (docs/SONRA.md P-e); the step that adds
 * the two write permissions changes this function. Never raises: anything else is "no".
 */
create function office.github_integration_valid(
  p_account text, p_scopes text[], p_settings jsonb, p_token bytea, p_status text
) returns boolean
  language plpgsql immutable set search_path = ''
  as $$
declare
  v_scope text;
  v_key text;
begin
  if p_token is not null or p_status not in ('enabled', 'disabled') then
    return false;
  end if;
  if p_account is null or p_account !~ '^[A-Za-z0-9-]{1,39}$' then
    return false;
  end if;
  if p_scopes is null or pg_catalog.cardinality(p_scopes) > 4 then
    return false;
  end if;
  foreach v_scope in array p_scopes loop
    if v_scope is null
       or v_scope not in (
         'metadata:read', 'contents:read', 'pull_requests:read', 'issues:read'
       ) then
      return false;
    end if;
  end loop;
  if p_settings is null
     or not (p_settings ?& array['installation_id', 'account_id', 'app_id', 'connected_at'])
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_settings)) <> 4
     or pg_catalog.jsonb_typeof(p_settings -> 'connected_at') <> 'string' then
    return false;
  end if;
  foreach v_key in array array['installation_id', 'account_id', 'app_id'] loop
    if pg_catalog.jsonb_typeof(p_settings -> v_key) <> 'number'
       or (p_settings ->> v_key) !~ '^[1-9][0-9]{0,17}$' then
      return false;
    end if;
  end loop;
  return true;
end
$$;
revoke execute on function office.github_integration_valid(text, text[], jsonb, bytea, text)
  from public;
grant execute on function office.github_integration_valid(text, text[], jsonb, bytea, text)
  to office_app, office_trigger;
alter table office.integrations add constraint integrations_github_shape check (
  provider <> 'github'
  or office.github_integration_valid(account, scopes, settings, encrypted_token, status)
);

-- Who writes and who reads a GitHub row ---------------------------------------------------------

-- No request and no agent run writes a GitHub row directly.
create policy github_insert_through_function on office.integrations as restrictive for insert
  to office_app with check (provider <> 'github');
create policy github_update_through_function on office.integrations as restrictive for update
  to office_app using (provider <> 'github') with check (provider <> 'github');
create policy github_delete_never on office.integrations as restrictive for delete
  to office_app using (provider <> 'github');

-- 8 October decision 19 and 12 October decision 15: whoever opens a project picks a repository,
-- so every founder and employee of the company reads whether GitHub is connected and through
-- which installation. Not an external person, not an agent run through this policy (the old
-- policy agent_reads is left as it is), never a row of another company.
create policy insiders_read_github on office.integrations for select to office_api_private
  using (
    provider = 'github' and company_id = office.ctx_company_id()
    and office.is_insider() and office.ctx_agent_code() is null
  );

grant select, insert, update on office.integrations to office_trigger;
create policy github_bookkeeping on office.integrations for all to office_trigger
  using (provider = 'github') with check (provider = 'github');

-- The guard: the passkey (decision 22), for every writer, the privileged role too ----------------

create function office.guard_github_connection() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.provider <> 'github' then
    return new;
  end if;
  -- Migrations, the seed, an administrator.
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null
     or new.company_id is distinct from office.ctx_company_id()
     or not office.is_founder() then
    raise exception 'Only the founder connects or disconnects GitHub'
      using errcode = 'insufficient_privilege';
  end if;
  if office.company_kind(new.company_id) is distinct from 'company' then
    raise exception 'GitHub is connected to a company, not to the founder space'
      using errcode = 'check_violation';
  end if;
  if new.status = 'enabled' and (
       tg_op = 'INSERT'
       or old.status is distinct from 'enabled'
       or (new.settings ->> 'installation_id') is distinct from (old.settings ->> 'installation_id')
     ) then
    if not office.consume_step_up('github_connection', new.company_id, new.company_id) then
      raise exception 'Connecting GitHub needs a passkey re-verification'
        using errcode = 'invalid_authorization_specification';
    end if;
    new.connected_by_user_id := office.ctx_user_id();
  end if;
  return new;
end
$$;
revoke execute on function office.guard_github_connection() from public;
create trigger guard_github_connection before insert or update on office.integrations
  for each row execute function office.guard_github_connection();
-- The functions below run as office_trigger; the guard they fire reads the company's kind.
grant execute on function office.company_kind(uuid) to office_trigger;

-- The two functions ------------------------------------------------------------------------------

/*
 * The founder connects the GitHub organisation of the context company (8 October decisions 19
 * and 22). The API has read the installation at GitHub with the signature of the app that is
 * configured for THIS company and tells its facts; the guard uses up the founder's
 * github_connection re-verification of this transaction. Connected already through the same
 * installation: the name and the permissions are brought up to date and nothing is used up.
 * Connected before to another organisation: 55000, nothing changes (the projects' repositories
 * belong to the old one). An organisation or an installation that is the connection of another
 * company: 23505 from the two indexes (12 October decision 12: separate organisations).
 */
create function office.connect_github(
  p_account text, p_account_id bigint, p_installation_id bigint, p_app_id bigint, p_scopes text[]
) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid := office.ctx_company_id();
  v_row office.integrations;
  v_settings jsonb;
begin
  if office.ctx_agent_code() is not null or v_company is null or not office.is_founder() then
    raise exception 'Only the founder connects GitHub' using errcode = 'insufficient_privilege';
  end if;
  if p_account is null or p_account_id is null or p_installation_id is null
     or p_app_id is null or p_scopes is null then
    raise exception 'The installation must be given whole'
      using errcode = 'invalid_parameter_value';
  end if;
  select i.* into v_row from office.integrations i
    where i.company_id = v_company and i.provider = 'github' for update;
  if v_row.id is not null
     and (v_row.settings ->> 'account_id')::bigint is distinct from p_account_id then
    raise exception 'The company is connected to another GitHub organisation'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_row.id is not null and v_row.status = 'enabled'
     and (v_row.settings ->> 'installation_id')::bigint = p_installation_id then
    update office.integrations i set account = p_account, scopes = p_scopes where i.id = v_row.id;
    return v_row.id;
  end if;
  v_settings := pg_catalog.jsonb_build_object(
    'installation_id', p_installation_id, 'account_id', p_account_id, 'app_id', p_app_id,
    'connected_at', pg_catalog.to_jsonb(pg_catalog.now())
  );
  if v_row.id is null then
    insert into office.integrations (company_id, provider, account, scopes, settings, status)
      values (v_company, 'github', p_account, p_scopes, v_settings, 'enabled')
      returning * into v_row;
  else
    update office.integrations i
      set account = p_account, scopes = p_scopes, settings = v_settings, status = 'enabled'
      where i.id = v_row.id;
  end if;
  return v_row.id;
end
$$;
alter function office.connect_github(text, bigint, bigint, bigint, text[]) owner to office_trigger;
revoke execute on function office.connect_github(text, bigint, bigint, bigint, text[]) from public;
grant execute on function office.connect_github(text, bigint, bigint, bigint, text[])
  to office_api_private;

/*
 * The founder switches the connection of the context company off. No passkey: it only takes
 * access away. The row and the repositories of the projects stay. Answers whether a connection
 * was switched off.
 */
create function office.disconnect_github() returns boolean
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_agent_code() is not null or office.ctx_company_id() is null
     or not office.is_founder() then
    raise exception 'Only the founder disconnects GitHub' using errcode = 'insufficient_privilege';
  end if;
  update office.integrations i set status = 'disabled'
    where i.company_id = office.ctx_company_id() and i.provider = 'github'
      and i.status = 'enabled';
  return found;
end
$$;
alter function office.disconnect_github() owner to office_trigger;
revoke execute on function office.disconnect_github() from public;
grant execute on function office.disconnect_github() to office_api_private;

-- The audit rows ---------------------------------------------------------------------------------

create function office.audit_github_connection() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_event text;
begin
  if new.provider <> 'github' then
    return null;
  end if;
  if new.status = 'enabled' and (
       tg_op = 'INSERT'
       or old.status is distinct from 'enabled'
       or (new.settings ->> 'installation_id') is distinct from (old.settings ->> 'installation_id')
     ) then
    v_event := 'github_connected';
  elsif tg_op = 'UPDATE' and old.status = 'enabled' and new.status = 'disabled' then
    v_event := 'github_disconnected';
  else
    return null;
  end if;
  insert into office.audit_log (company_id, event, record_type, record_id, external_ref)
    values (
      new.company_id, v_event, 'integration', new.id,
      'github:installation:' || (new.settings ->> 'installation_id')
    );
  return null;
end
$$;
revoke execute on function office.audit_github_connection() from public;
create trigger audit_github_connection after insert or update on office.integrations
  for each row execute function office.audit_github_connection();

grant insert (external_ref) on office.audit_log to office_trigger;
create policy github_records on office.audit_log for insert to office_trigger
  with check (
    event ~ '^github_'
    and (office.ctx_company_id() is null or company_id = office.ctx_company_id())
  );
-- No request and no agent run can write a row that says GitHub was connected.
create policy reserved_github_events on office.audit_log as restrictive for insert to office_app
  with check (event !~ '^github_');
