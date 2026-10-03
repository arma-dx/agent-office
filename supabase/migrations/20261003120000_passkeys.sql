-- Passkeys and passkey re-verification (KALAN-ISLER 0.3; CLAUDE.md rules 3, 9; 3 October decision
-- 7).
--
-- Approvals that involve money, that leave the company or that change a source of truth note, and
-- membership or role changes need a re-verification with a passkey (the step_up migration enforces
-- this on approvals, memberships, invitations and account activation). Google cannot force a new sign-in, so the panel re-verifies
-- with WebAuthn. The API runs the WebAuthn ceremonies and verifies signatures; the database keeps
-- the passkeys, the single-use challenges and a record of every successful re-verification
-- (step_ups), and decides when a challenge may be opened.
--
-- Tables:
--   passkeys            Identity table (a person can be a member of several companies): no
--                       company_id. The primary key is the credential id the browser reports
--                       (base64url); ref is a uuid handle a re-verification names when it revokes a
--                       passkey. A passkey is revoked, never deleted; a revoked one never changes.
--   passkey_challenges  Identity table. One challenge per ceremony, bound to the session that
--                       opened it, valid for at most 5 minutes, used once, closed after 5 failed
--                       attempts. A new challenge for the same purpose and context hash in the
--                       same session closes the older open one (a dialog opened again).
--   step_ups            A successful re-verification. Rows for an approval, a membership change or
--                       an invitation carry the company (rule 2); rows that add or revoke a
--                       passkey carry none.
--                       A row counts only in the transaction that recorded it (verified_at and
--                       verified_xact), and only once (consumed_at).
--
-- Rules:
--   - The first passkey is registered only within 10 minutes of a Google sign-in, while the person
--     has no active passkey. Every further passkey needs a re-verification with an existing one
--     (purpose passkey_add, within the last 5 minutes, same session). Revoking a passkey needs a
--     re-verification in the same transaction (purpose passkey_revoke, naming that passkey).
--   - A lost passkey stays active until it is revoked, and only its owner can revoke it, with
--     another active passkey. A person whose every passkey is lost (still active) therefore cannot
--     take the first passkey path again; there is no recovery path yet (a founder decision).
--   - At most 10 active passkeys per person; the signature counter never goes down.
--   - Every function needs a live session given by its key hash (the SHA-256 the API keeps in
--     place of the cookie): open, before its absolute expiry, idle for at most 31 minutes (the
--     limit verify_session applies), of an active account, and the person in the context must be
--     the session's person. No function runs in an agent run.
--
-- Error codes the API maps to Turkish messages:
--   28000 (invalid_authorization_specification)  a re-verification is missing, or the challenge,
--                                                 the passkey, the context hash or the signature
--                                                 counter does not check out
--   42501 (insufficient_privilege)                no live session of the context person, an agent
--                                                 run, or not a member of the company
--   22023 (invalid_parameter_value)               malformed input
--   54000 (program_limit_exceeded)                10 active passkeys, or 10 open challenges
--   P0002 (no_data_found)                         no such active passkey to revoke
--
-- The failure path: when the API cannot verify an assertion it calls
-- consume_passkey_challenge(..., false) and COMMITS before answering 4xx, so the failed attempt is
-- counted and the 5-attempt limit holds. record_step_up and register_passkey raise on any mismatch;
-- the API then records the failure in a savepoint or a new transaction the same way.
--
-- Privileges: the tables have no direct grants to office_app or office_worker. office_identity owns
-- the functions and reaches only the context person's rows; office_api_private (the API, never the
-- worker) runs the functions and reads its own passkeys and re-verifications.

-- WebAuthn user handle ------------------------------------------------------------------------

-- The user.id given to the authenticator: 16 random bytes, never personal data, the same for every
-- passkey of the person. Created on first use by ensure_webauthn_handle and never changed after.
alter table office.users
  add column webauthn_handle bytea unique check (octet_length(webauthn_handle) = 16);

create function office.keep_webauthn_handle() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  raise exception 'The WebAuthn user handle cannot change once set'
    using errcode = 'check_violation';
end
$$;
create trigger keep_webauthn_handle before update of webauthn_handle on office.users
  for each row
  when (
    old.webauthn_handle is not null and new.webauthn_handle is distinct from old.webauthn_handle
  )
  execute function office.keep_webauthn_handle();

-- office_identity sets the handle only on the context person's own record, and only once.
grant select (webauthn_handle), update (webauthn_handle) on office.users to office_identity;
create policy identity_sets_handle on office.users for update to office_identity
  using (id = office.ctx_user_id() and webauthn_handle is null)
  with check (id = office.ctx_user_id() and webauthn_handle is not null);

-- Passkeys ------------------------------------------------------------------------------------

create table office.passkeys (
  -- The credential id as the browser reports it (base64url of at most 1023 bytes).
  id text primary key check (id ~ '^[A-Za-z0-9_-]+$' and char_length(id) between 16 and 1366),
  ref uuid not null unique default gen_random_uuid(),
  user_id uuid not null references office.users (id) on delete cascade,
  -- COSE public key.
  public_key bytea not null check (octet_length(public_key) between 16 and 4096),
  counter bigint not null default 0 check (counter between 0 and 4294967295),
  transports text[] not null default '{}' check (
    cardinality(transports) <= 7
    and transports <@ array['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']
  ),
  device_type text not null check (device_type in ('singleDevice', 'multiDevice')),
  backed_up boolean not null,
  -- The person's own label, shown in the passkey list.
  name text not null check (
    char_length(name) between 1 and 60
    and btrim(name) <> ''
    and name !~ '[\u0001-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]'
  ),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  -- A credential that cannot be backed up is never reported as backed up.
  constraint backup_needs_multi_device check (not (backed_up and device_type = 'singleDevice'))
);
create index passkeys_user_active on office.passkeys (user_id) where revoked_at is null;

create trigger immutable_columns before update on office.passkeys
  for each row execute function office.prevent_column_changes(
    'id', 'ref', 'user_id', 'public_key', 'transports', 'device_type', 'created_at'
  );

-- A revoked passkey never changes (it is not brought back), and the signature counter never goes
-- down. Holds for the privileged role too.
create function office.guard_passkey() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.revoked_at is not null then
    raise exception 'A revoked passkey cannot change' using errcode = 'check_violation';
  end if;
  if new.counter < old.counter then
    raise exception 'The signature counter of a passkey never goes down'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger guard_passkey before update on office.passkeys
  for each row execute function office.guard_passkey();

-- Re-verifications ----------------------------------------------------------------------------

create table office.step_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references office.users (id) on delete cascade,
  session_id uuid not null references office.sessions (id) on delete cascade,
  -- The passkey that signed the assertion.
  passkey_id text not null references office.passkeys (id) on delete cascade,
  purpose text not null check (
    purpose in ('approve', 'membership_change', 'invitation', 'passkey_add', 'passkey_revoke')
  ),
  -- Set for approve, membership_change and invitation (company data, rule 2); empty for passkey
  -- changes.
  company_id uuid references office.companies (id),
  -- approve: the approval; membership_change: the member whose membership or account changes;
  -- invitation: the invitation (created or renewed); passkey_revoke: the passkey's ref;
  -- passkey_add: empty.
  subject_id uuid,
  -- The SHA-256 of what was shown to the person (the API computes it); it is part of the challenge.
  context_hash bytea not null check (octet_length(context_hash) = 32),
  verified_at timestamptz not null default now(),
  -- The transaction that recorded it; checks that need "this transaction" compare it too.
  verified_xact xid8 not null default pg_current_xact_id(),
  consumed_at timestamptz,
  constraint company_with_company_purpose check (
    (company_id is not null) = (purpose in ('approve', 'membership_change', 'invitation'))
  ),
  constraint subject_with_purpose check ((subject_id is null) = (purpose = 'passkey_add'))
);
create index step_ups_open on office.step_ups (user_id, purpose, subject_id)
  where consumed_at is null;
create index step_ups_session on office.step_ups (session_id);
create index step_ups_passkey on office.step_ups (passkey_id);

create trigger immutable_columns before update on office.step_ups
  for each row execute function office.prevent_column_changes(
    'id', 'user_id', 'session_id', 'passkey_id', 'purpose', 'company_id', 'subject_id',
    'context_hash', 'verified_at', 'verified_xact'
  );

-- A used re-verification never changes (it cannot be used again).
create function office.keep_step_up_used() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  raise exception 'A used re-verification cannot change' using errcode = 'check_violation';
end
$$;
create trigger keep_step_up_used before update on office.step_ups
  for each row when (old.consumed_at is not null)
  execute function office.keep_step_up_used();

-- Challenges ----------------------------------------------------------------------------------

create table office.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references office.users (id) on delete cascade,
  session_id uuid not null references office.sessions (id) on delete cascade,
  purpose text not null check (purpose in ('register', 'step_up')),
  challenge bytea not null check (octet_length(challenge) between 32 and 128),
  -- Required for a re-verification: the step-up must be recorded with the same hash.
  context_hash bytea check (octet_length(context_hash) = 32),
  -- The passkey_add re-verification a registration was opened with; empty for the first passkey.
  step_up_id uuid references office.step_ups (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  constraint step_up_has_context check (purpose <> 'step_up' or context_hash is not null),
  constraint step_up_only_for_register check (step_up_id is null or purpose = 'register'),
  constraint lifetime check (
    expires_at > created_at and expires_at <= created_at + interval '5 minutes'
  ),
  constraint exhausted_is_consumed check (failed_attempts < 5 or consumed_at is not null)
);
create index passkey_challenges_session_open on office.passkey_challenges (session_id)
  where consumed_at is null;
create index passkey_challenges_user_expiry on office.passkey_challenges (user_id, expires_at);

create trigger immutable_columns before update on office.passkey_challenges
  for each row execute function office.prevent_column_changes(
    'id', 'user_id', 'session_id', 'purpose', 'challenge', 'context_hash', 'step_up_id',
    'created_at', 'expires_at'
  );

-- A used challenge never changes; the failed attempt count only goes up.
create function office.guard_passkey_challenge() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.consumed_at is not null then
    raise exception 'A used challenge cannot change' using errcode = 'check_violation';
  end if;
  if new.failed_attempts < old.failed_attempts then
    raise exception 'The failed attempt count of a challenge never goes down'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger guard_passkey_challenge before update on office.passkey_challenges
  for each row execute function office.guard_passkey_challenge();

-- Row security and privileges -------------------------------------------------------------------

alter table office.passkeys enable row level security;
alter table office.passkeys force row level security;
alter table office.step_ups enable row level security;
alter table office.step_ups force row level security;
alter table office.passkey_challenges enable row level security;
alter table office.passkey_challenges force row level security;

-- office_identity: only the rows of the person in the context (the functions require that person
-- to be the session's person). A credential id is unique across all people all the same (primary
-- key).
grant select,
  insert (id, ref, user_id, public_key, counter, transports, device_type, backed_up, name),
  update (counter, last_used_at, revoked_at)
  on office.passkeys to office_identity;
create policy identity_own on office.passkeys for all to office_identity
  using (user_id = office.ctx_user_id())
  with check (user_id = office.ctx_user_id());

grant select,
  insert (id, user_id, session_id, passkey_id, purpose, company_id, subject_id, context_hash),
  update (consumed_at)
  on office.step_ups to office_identity;
create policy identity_reads on office.step_ups for select to office_identity
  using (user_id = office.ctx_user_id());
create policy identity_records on office.step_ups for insert to office_identity
  with check (user_id = office.ctx_user_id());
create policy identity_consumes on office.step_ups for update to office_identity
  using (user_id = office.ctx_user_id() and consumed_at is null)
  with check (user_id = office.ctx_user_id());

grant select,
  insert (id, user_id, session_id, purpose, challenge, context_hash, step_up_id, expires_at),
  update (consumed_at, failed_attempts),
  delete
  on office.passkey_challenges to office_identity;
create policy identity_own on office.passkey_challenges for all to office_identity
  using (user_id = office.ctx_user_id())
  with check (user_id = office.ctx_user_id());

-- The API lists the person's own active passkeys (for the settings page and for the
-- allowCredentials and excludeCredentials lists); never the public key.
grant select (
  id, ref, user_id, name, transports, device_type, backed_up, created_at, last_used_at, revoked_at
) on office.passkeys to office_api_private;
create policy own_passkeys on office.passkeys for select to office_api_private
  using (
    user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
    and revoked_at is null
  );

-- The API reads the person's own re-verifications; one that belongs to a company only in that
-- company's context.
grant select (
  id, user_id, session_id, passkey_id, purpose, company_id, subject_id, verified_at, consumed_at
) on office.step_ups to office_api_private;
create policy own_step_ups on office.step_ups for select to office_api_private
  using (
    user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
    and (company_id is null or company_id = office.ctx_company_id())
  );

-- Functions -------------------------------------------------------------------------------------

/*
 * The live session of the key hash: open, before its absolute expiry, idle for at most 31 minutes
 * (the most verify_session allows), of an active account; the context person must be the session's
 * person. Raises otherwise, and in an agent run. Internal: only the functions below call it.
 */
create function office.live_session(p_key_hash bytea) returns office.sessions
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions;
begin
  if office.ctx_agent_code() is not null then
    raise exception 'An agent run has no session' using errcode = 'insufficient_privilege';
  end if;
  select s.* into v_session
  from office.sessions s
  join office.users u on u.id = s.user_id and u.active
  where s.key_hash = p_key_hash
    and s.closed_at is null
    and s.absolute_expires_at > pg_catalog.now()
    and s.last_seen_at > pg_catalog.now() - interval '31 minutes';
  if v_session.id is null then
    raise exception 'No live session for this key' using errcode = 'insufficient_privilege';
  end if;
  if v_session.user_id is distinct from office.ctx_user_id() then
    raise exception 'The session belongs to another person'
      using errcode = 'insufficient_privilege';
  end if;
  return v_session;
end
$$;

-- The person's active passkeys are counted and registered one transaction at a time.
create function office.lock_passkeys(p_user_id uuid) returns void
  language sql set search_path = ''
  as $$
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('office.passkeys:' || p_user_id::text, 0)
    )
  $$;

-- The session person's WebAuthn user handle; created (16 random bytes) on first use.
create function office.ensure_webauthn_handle(p_key_hash bytea) returns bytea
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_handle bytea;
  v_first bytea;
  v_second bytea;
begin
  select u.webauthn_handle into v_handle from office.users u where u.id = v_session.user_id;
  if v_handle is not null then
    return v_handle;
  end if;
  -- gen_random_uuid() draws from the strong random source; bytes 7 and 9 of a version 4 uuid
  -- carry the fixed version and variant bits, the other 14 are random.
  v_first := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_second := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_handle := pg_catalog.substr(v_first, 1, 6) || pg_catalog.substr(v_first, 8, 1)
    || pg_catalog.substr(v_first, 10, 7) || pg_catalog.substr(v_second, 1, 2);
  update office.users u set webauthn_handle = v_handle
    where u.id = v_session.user_id and u.webauthn_handle is null;
  if not found then
    -- Another request set it in the meantime.
    select u.webauthn_handle into v_handle from office.users u where u.id = v_session.user_id;
  end if;
  return v_handle;
end
$$;

/*
 * Opens a challenge for a WebAuthn ceremony of the session and returns its id. The challenge bytes
 * come from the API (32-128 bytes; for a re-verification the API puts the context hash in them).
 *   register  The first passkey: the person has no active passkey and the session was opened
 *             less than 10 minutes ago (a fresh Google sign-in). A further passkey: an unused
 *             passkey_add re-verification of this session from the last 5 minutes, which this
 *             uses up.
 *   step_up   A re-verification: the person has an active passkey; the context hash is required.
 * An open challenge of the session with the same purpose and context hash is closed first: a dialog
 * that is opened again (or refreshes its challenge) replaces its own challenge instead of piling
 * up. At most 10 open challenges per session. Challenges that expired more than a day ago are
 * removed.
 */
create function office.create_passkey_challenge(
  p_key_hash bytea,
  p_purpose text,
  p_challenge bytea,
  p_context_hash bytea
) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_id uuid := pg_catalog.gen_random_uuid();
  v_has_passkey boolean;
  v_step_up uuid;
begin
  if p_purpose is null or p_purpose not in ('register', 'step_up') then
    raise exception 'The purpose must be register or step_up'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_challenge is null or pg_catalog.octet_length(p_challenge) not between 32 and 128 then
    raise exception 'The challenge must be 32 to 128 bytes'
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_context_hash is not null and pg_catalog.octet_length(p_context_hash) <> 32)
     or (p_purpose = 'step_up' and p_context_hash is null) then
    raise exception 'The context hash must be 32 bytes and is required for a re-verification'
      using errcode = 'invalid_parameter_value';
  end if;

  perform office.lock_passkeys(v_session.user_id);
  v_has_passkey := exists (
    select 1 from office.passkeys p where p.user_id = v_session.user_id and p.revoked_at is null
  );
  if p_purpose = 'step_up' then
    if not v_has_passkey then
      raise exception 'A re-verification needs a registered passkey'
        using errcode = 'invalid_authorization_specification';
    end if;
  elsif v_has_passkey then
    select s.id into v_step_up
    from office.step_ups s
    where s.session_id = v_session.id
      and s.user_id = v_session.user_id
      and s.purpose = 'passkey_add'
      and s.consumed_at is null
      and s.verified_at > pg_catalog.now() - interval '5 minutes'
    order by s.verified_at desc
    limit 1
    for update;
    if v_step_up is null then
      raise exception 'Adding another passkey needs a re-verification with an existing passkey'
        using errcode = 'invalid_authorization_specification';
    end if;
    update office.step_ups s set consumed_at = pg_catalog.now() where s.id = v_step_up;
  elsif v_session.created_at <= pg_catalog.now() - interval '10 minutes' then
    raise exception 'The first passkey is registered only within 10 minutes of a Google sign-in'
      using errcode = 'invalid_authorization_specification';
  end if;

  update office.passkey_challenges c set consumed_at = pg_catalog.now()
    where c.session_id = v_session.id
      and c.user_id = v_session.user_id
      and c.purpose = p_purpose
      and c.context_hash is not distinct from p_context_hash
      and c.consumed_at is null;
  if (
    select pg_catalog.count(*) from office.passkey_challenges c
    where c.session_id = v_session.id
      and c.consumed_at is null
      and c.expires_at > pg_catalog.now()
  ) >= 10 then
    raise exception 'Too many open challenges for this session'
      using errcode = 'program_limit_exceeded';
  end if;
  delete from office.passkey_challenges c
    where c.user_id = v_session.user_id and c.expires_at < pg_catalog.now() - interval '1 day';
  insert into office.passkey_challenges
      (id, user_id, session_id, purpose, challenge, context_hash, step_up_id, expires_at)
    values (
      v_id, v_session.user_id, v_session.id, p_purpose, p_challenge, p_context_hash, v_step_up,
      pg_catalog.now() + interval '5 minutes'
    );
  return v_id;
end
$$;

-- An open challenge of the session (not used, not expired, fewer than 5 failed attempts); no row
-- otherwise.
create function office.get_passkey_challenge(p_key_hash bytea, p_challenge_id uuid)
  returns table (purpose text, challenge bytea, context_hash bytea, expires_at timestamptz)
  language plpgsql security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_session office.sessions := office.live_session(p_key_hash);
begin
  return query
    select c.purpose, c.challenge, c.context_hash, c.expires_at
    from office.passkey_challenges c
    where c.id = p_challenge_id
      and c.session_id = v_session.id
      and c.user_id = v_session.user_id
      and c.consumed_at is null
      and c.expires_at > pg_catalog.now()
      and c.failed_attempts < 5;
end
$$;

/*
 * Records the outcome of a ceremony the API checked itself. Success uses the challenge up; a
 * failure counts an attempt, and the fifth failure uses it up. Never raises for an unknown or used
 * challenge: returns false, so the API can commit the failure before answering. Returns true when
 * an open challenge of the session was updated.
 */
create function office.consume_passkey_challenge(
  p_key_hash bytea,
  p_challenge_id uuid,
  p_success boolean
) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
begin
  if p_success is null then
    raise exception 'The outcome must be given' using errcode = 'invalid_parameter_value';
  end if;
  if p_success then
    update office.passkey_challenges c set consumed_at = pg_catalog.now()
      where c.id = p_challenge_id
        and c.session_id = v_session.id
        and c.user_id = v_session.user_id
        and c.consumed_at is null
        and c.expires_at > pg_catalog.now();
  else
    update office.passkey_challenges c
      set failed_attempts = c.failed_attempts + 1,
          consumed_at = case when c.failed_attempts + 1 >= 5 then pg_catalog.now() end
      where c.id = p_challenge_id
        and c.session_id = v_session.id
        and c.user_id = v_session.user_id
        and c.consumed_at is null;
  end if;
  return found;
end
$$;

/*
 * Stores the passkey of a registration the API verified, using up the session's open register
 * challenge. A registration opened for the first passkey fails if the person has an active passkey
 * by now (two challenges cannot give two "first" passkeys). At most 10 active passkeys per person;
 * a credential id is stored once (unique_violation). Returns the passkey's ref.
 */
create function office.register_passkey(
  p_key_hash bytea,
  p_challenge_id uuid,
  p_credential_id text,
  p_public_key bytea,
  p_counter bigint,
  p_transports text[],
  p_device_type text,
  p_backed_up boolean,
  p_name text
) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_challenge office.passkey_challenges;
  v_name text := pg_catalog.btrim(p_name);
  v_ref uuid := pg_catalog.gen_random_uuid();
begin
  if p_credential_id is null or p_credential_id !~ '^[A-Za-z0-9_-]+$'
     or pg_catalog.char_length(p_credential_id) not between 16 and 1366 then
    raise exception 'The credential id must be base64url' using errcode = 'invalid_parameter_value';
  end if;
  if p_public_key is null or pg_catalog.octet_length(p_public_key) not between 16 and 4096 then
    raise exception 'The public key must be 16 to 4096 bytes'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_counter is null or p_counter not between 0 and 4294967295 then
    raise exception 'The signature counter is out of range'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_transports is null
     or pg_catalog.cardinality(p_transports) > 7
     or not (
       p_transports <@ array['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']
     ) then
    raise exception 'Unknown transport' using errcode = 'invalid_parameter_value';
  end if;
  if p_device_type is null or p_device_type not in ('singleDevice', 'multiDevice')
     or p_backed_up is null or (p_backed_up and p_device_type = 'singleDevice') then
    raise exception 'Invalid device type or backup state' using errcode = 'invalid_parameter_value';
  end if;
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 60
     or v_name ~ '[\u0001-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]' then
    raise exception 'The name must be 1 to 60 printable characters'
      using errcode = 'invalid_parameter_value';
  end if;

  perform office.lock_passkeys(v_session.user_id);
  select c.* into v_challenge
  from office.passkey_challenges c
  where c.id = p_challenge_id
    and c.session_id = v_session.id
    and c.user_id = v_session.user_id
    and c.purpose = 'register'
    and c.consumed_at is null
    and c.expires_at > pg_catalog.now()
    and c.failed_attempts < 5
  for update;
  if v_challenge.id is null then
    raise exception 'No open registration challenge of this session'
      using errcode = 'invalid_authorization_specification';
  end if;
  if v_challenge.step_up_id is null and exists (
    select 1 from office.passkeys p where p.user_id = v_session.user_id and p.revoked_at is null
  ) then
    raise exception 'Adding another passkey needs a re-verification with an existing passkey'
      using errcode = 'invalid_authorization_specification';
  end if;
  if (
    select pg_catalog.count(*) from office.passkeys p
    where p.user_id = v_session.user_id and p.revoked_at is null
  ) >= 10 then
    raise exception 'A person can have at most 10 active passkeys'
      using errcode = 'program_limit_exceeded';
  end if;

  update office.passkey_challenges c set consumed_at = pg_catalog.now()
    where c.id = v_challenge.id;
  insert into office.passkeys
      (id, ref, user_id, public_key, counter, transports, device_type, backed_up, name)
    values (
      p_credential_id, v_ref, v_session.user_id, p_public_key, p_counter, p_transports,
      p_device_type, p_backed_up, v_name
    );
  return v_ref;
end
$$;

-- What the API needs to verify an assertion: only for an active passkey of the session's person.
create function office.get_passkey_for_assertion(p_key_hash bytea, p_credential_id text)
  returns table (public_key bytea, counter bigint, transports text[])
  language plpgsql security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_session office.sessions := office.live_session(p_key_hash);
begin
  return query
    select p.public_key, p.counter, p.transports
    from office.passkeys p
    where p.id = p_credential_id
      and p.user_id = v_session.user_id
      and p.revoked_at is null;
end
$$;

/*
 * Records a re-verification after the API verified the assertion (signature, origin, user
 * verification, user handle). Uses up the session's open step_up challenge, whose context hash must
 * equal p_context_hash; the passkey must be an active passkey of the person. The signature counter
 * follows WebAuthn: when the stored or the new counter is non-zero, the new one must be greater
 * (otherwise the authenticator may be cloned); passkeys that always report 0 stay at 0.
 *   approve, membership_change, invitation
 *                               company: the context company, where the person is a member;
 *                               subject: the approval, the member whose membership or account
 *                               changes, or the invitation created or renewed
 *   passkey_add                 no company, no subject
 *   passkey_revoke              no company; subject: the ref of an active passkey of the person
 * Returns the re-verification's id.
 */
create function office.record_step_up(
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
  if p_purpose in ('approve', 'membership_change', 'invitation') then
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

/*
 * Revokes an active passkey of the session's person. Needs a passkey_revoke re-verification of this
 * session naming the passkey, recorded in this same transaction; it is used up. The last passkey
 * can be revoked too: a new first passkey then needs a fresh Google sign-in.
 */
create function office.revoke_passkey(p_key_hash bytea, p_passkey_id text) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_passkey office.passkeys;
  v_step_up uuid;
begin
  perform office.lock_passkeys(v_session.user_id);
  select p.* into v_passkey
  from office.passkeys p
  where p.id = p_passkey_id and p.user_id = v_session.user_id and p.revoked_at is null
  for update;
  if v_passkey.id is null then
    raise exception 'No such active passkey' using errcode = 'no_data_found';
  end if;
  select s.id into v_step_up
  from office.step_ups s
  where s.user_id = v_session.user_id
    and s.session_id = v_session.id
    and s.purpose = 'passkey_revoke'
    and s.subject_id = v_passkey.ref
    and s.consumed_at is null
    and s.verified_at = pg_catalog.now()
    and s.verified_xact = pg_catalog.pg_current_xact_id()
  limit 1
  for update;
  if v_step_up is null then
    raise exception 'Revoking a passkey needs a re-verification in the same transaction'
      using errcode = 'invalid_authorization_specification';
  end if;
  update office.step_ups s set consumed_at = pg_catalog.now() where s.id = v_step_up;
  update office.passkeys p set revoked_at = pg_catalog.now() where p.id = v_passkey.id;
end
$$;

alter function office.live_session(bytea) owner to office_identity;
alter function office.lock_passkeys(uuid) owner to office_identity;
alter function office.ensure_webauthn_handle(bytea) owner to office_identity;
alter function office.create_passkey_challenge(bytea, text, bytea, bytea) owner to office_identity;
alter function office.get_passkey_challenge(bytea, uuid) owner to office_identity;
alter function office.consume_passkey_challenge(bytea, uuid, boolean) owner to office_identity;
alter function office.register_passkey(
  bytea, uuid, text, bytea, bigint, text[], text, boolean, text
) owner to office_identity;
alter function office.get_passkey_for_assertion(bytea, text) owner to office_identity;
alter function office.record_step_up(bytea, uuid, text, bigint, text, uuid, uuid, bytea)
  owner to office_identity;
alter function office.revoke_passkey(bytea, text) owner to office_identity;

revoke execute on function
  office.keep_webauthn_handle(), office.guard_passkey(), office.keep_step_up_used(),
  office.guard_passkey_challenge(), office.live_session(bytea), office.lock_passkeys(uuid),
  office.ensure_webauthn_handle(bytea), office.create_passkey_challenge(bytea, text, bytea, bytea),
  office.get_passkey_challenge(bytea, uuid), office.consume_passkey_challenge(bytea, uuid, boolean),
  office.register_passkey(bytea, uuid, text, bytea, bigint, text[], text, boolean, text),
  office.get_passkey_for_assertion(bytea, text),
  office.record_step_up(bytea, uuid, text, bigint, text, uuid, uuid, bytea),
  office.revoke_passkey(bytea, text)
  from public;
grant execute on function
  office.ensure_webauthn_handle(bytea), office.create_passkey_challenge(bytea, text, bytea, bytea),
  office.get_passkey_challenge(bytea, uuid), office.consume_passkey_challenge(bytea, uuid, boolean),
  office.register_passkey(bytea, uuid, text, bytea, bigint, text[], text, boolean, text),
  office.get_passkey_for_assertion(bytea, text),
  office.record_step_up(bytea, uuid, text, bigint, text, uuid, uuid, bytea),
  office.revoke_passkey(bytea, text)
  to office_api_private;
