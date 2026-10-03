-- Server-side sessions (KALAN-ISLER 0.3; CLAUDE.md rules 3, 9; 3 October decision 6).
--
-- The cookie holds an opaque random key; the API stores only its SHA-256 (32 bytes), so the raw key
-- never reaches the database or the logs. A session closes after 30 minutes without a request and
-- at the latest 10 hours after login. Both limits are enforced here: open_session refuses an
-- absolute expiry more than 10 hours ahead, verify_session refuses an idle limit above 30 minutes.
-- last_seen_at is written at most once a minute, so it can be up to a minute older than the last
-- request; the idle limit counts from the latest moment the last request may have arrived, so a
-- session never closes before the limit (it closes within a minute after it). A session idle for
-- more than 31 minutes (30 minutes plus that minute) is dead whatever limit the API passes.
--
-- Deactivating an account, or removing its last membership, closes its open sessions at once
-- (close_reason account_closed); reactivating the account later does not bring them back.
--
-- sessions is an identity table (a person can be a member of several companies), so it carries no
-- company_id. last_company_id is only the default company for the company picker; it grants
-- nothing. The application roles get no direct privileges: the API reaches the table only through
-- the functions below (owned by office_identity, executable only by office_api_private) and may
-- list the person's own open sessions.

create table office.sessions (
  id uuid primary key default gen_random_uuid(),
  key_hash bytea not null unique check (octet_length(key_hash) = 32),
  user_id uuid not null references office.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  closed_at timestamptz,
  -- account_closed: the account was deactivated or left every company.
  close_reason text check (close_reason in ('logout', 'logout_all', 'account_closed', 'expired')),
  last_company_id uuid references office.companies (id),
  constraint closed_complete check ((closed_at is null) = (close_reason is null)),
  constraint absolute_limit check (
    absolute_expires_at > created_at and absolute_expires_at <= created_at + interval '10 hours'
  )
);
create index sessions_user_open on office.sessions (user_id) where closed_at is null;

create trigger immutable_columns before update on office.sessions
  for each row execute function office.prevent_column_changes(
    'id', 'key_hash', 'user_id', 'created_at', 'absolute_expires_at'
  );

-- A closed session is never reopened or changed (for the privileged role too).
create function office.keep_session_closed() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.closed_at is not null then
    raise exception 'A closed session cannot change' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger keep_session_closed before update on office.sessions
  for each row execute function office.keep_session_closed();

alter table office.sessions enable row level security;
alter table office.sessions force row level security;

-- office_identity: the session functions find a session by its key hash, so they read every row;
-- a session is opened only for the account of the address verified at login.
grant select, insert (id, key_hash, user_id, absolute_expires_at),
  update (last_seen_at, closed_at, close_reason, last_company_id)
  on office.sessions to office_identity;
create policy identity_reads on office.sessions for select to office_identity using (true);
create policy identity_opens on office.sessions for insert to office_identity
  with check (
    exists (
      select 1 from office.user_emails e
      where e.user_id = sessions.user_id and e.email = office.ctx_email()
    )
  );
create policy identity_updates on office.sessions for update to office_identity
  using (true)
  with check (true);

-- A person lists their own live sessions ("my sessions"); never the key hash. A session past its
-- absolute expiry or idle for more than 31 minutes is dead even before a request closes it.
grant select (
  id, user_id, created_at, last_seen_at, absolute_expires_at, closed_at, close_reason,
  last_company_id
) on office.sessions to office_api_private;
create policy own_sessions on office.sessions for select to office_api_private
  using (
    user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
    and closed_at is null
    and absolute_expires_at > now()
    and last_seen_at > now() - interval '31 minutes'
  );

-- Functions -------------------------------------------------------------------------------------

/*
 * Opens a session after complete_login returned ok, in the same login context: the address Google
 * verified (app.email) and no person, company, project or agent. Defence in depth only: the API
 * itself sets app.email after verifying the ID token. Requires the address to be bound to the same
 * Google account (p_google_sub, the ID token's sub), an active account and at least one
 * membership. Returns the session id.
 */
create function office.open_session(
  p_key_hash bytea,
  p_google_sub text,
  p_absolute_expires_at timestamptz
) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_email text := office.ctx_email();
  v_user uuid;
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  if office.ctx_agent_code() is not null or office.ctx_user_id() is not null
     or office.ctx_company_id() is not null or office.ctx_project_id() is not null
     or v_email is null then
    raise exception 'A session is opened only in a login context'
      using errcode = 'insufficient_privilege';
  end if;
  if p_key_hash is null or pg_catalog.octet_length(p_key_hash) <> 32 then
    raise exception 'The session key hash must be 32 bytes'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_absolute_expires_at is null
     or p_absolute_expires_at <= pg_catalog.now()
     or p_absolute_expires_at > pg_catalog.now() + interval '10 hours' then
    raise exception 'The absolute expiry must be in the future and at most 10 hours ahead'
      using errcode = 'invalid_parameter_value';
  end if;
  select e.user_id into v_user
  from office.user_emails e
  join office.users u on u.id = e.user_id
  where e.email = v_email
    and e.google_sub = p_google_sub
    and u.active
    and exists (select 1 from office.memberships m where m.user_id = e.user_id);
  if v_user is null then
    raise exception 'No active account with a membership for this Google account and address'
      using errcode = 'insufficient_privilege';
  end if;
  insert into office.sessions (id, key_hash, user_id, absolute_expires_at)
    values (v_id, p_key_hash, v_user, p_absolute_expires_at);
  return v_id;
end
$$;

-- Closes an open session that is no longer valid. Internal: only the session functions and
-- triggers call it. The login events migration extends it to record the expiry.
create function office.expire_session(
  p_session_id uuid,
  p_close_reason text,
  p_event_reason text
) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  update office.sessions s set closed_at = pg_catalog.now(), close_reason = p_close_reason
    where s.id = p_session_id and s.closed_at is null;
end
$$;

/*
 * Checks the session of a request. Returns one row (session, account, default company) for a valid
 * session and no row otherwise. A session that is past its absolute expiry, idle longer than
 * p_idle_seconds (60-1800) plus the minute last_seen_at may lag, or whose account was deactivated
 * is closed here. last_seen_at is refreshed only when it is more than a minute old, so most
 * requests do not write.
 */
create function office.verify_session(p_key_hash bytea, p_idle_seconds integer)
  returns table (session_id uuid, user_id uuid, last_company_id uuid)
  language plpgsql security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_session record;
  v_active boolean;
begin
  if p_idle_seconds is null or p_idle_seconds < 60 or p_idle_seconds > 1800 then
    raise exception 'The idle limit must be between 60 and 1800 seconds'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null then
    raise exception 'An agent run has no session' using errcode = 'insufficient_privilege';
  end if;
  if p_key_hash is null or pg_catalog.octet_length(p_key_hash) <> 32 then
    return;
  end if;

  select s.id, s.user_id, s.last_seen_at, s.absolute_expires_at, s.closed_at, s.last_company_id
    into v_session
  from office.sessions s
  where s.key_hash = p_key_hash;
  if not found or v_session.closed_at is not null then
    return;
  end if;

  select u.active into v_active from office.users u where u.id = v_session.user_id;
  if not coalesce(v_active, false) then
    perform office.expire_session(v_session.id, 'account_closed', 'account_inactive');
    return;
  end if;
  if v_session.absolute_expires_at <= pg_catalog.now() then
    perform office.expire_session(v_session.id, 'expired', 'absolute_timeout');
    return;
  end if;
  if v_session.last_seen_at
     <= pg_catalog.now() - pg_catalog.make_interval(secs => p_idle_seconds + 60) then
    perform office.expire_session(v_session.id, 'expired', 'idle_timeout');
    return;
  end if;

  update office.sessions s set last_seen_at = pg_catalog.now()
    where s.id = v_session.id
      and s.closed_at is null
      and s.last_seen_at < pg_catalog.now() - interval '60 seconds';
  return query select v_session.id, v_session.user_id, v_session.last_company_id;
end
$$;

-- Logout: closes the session of the key. Returns the closed session's id, or NULL if there was no
-- open session with this key.
create function office.close_session(p_key_hash bytea) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_id uuid;
begin
  if office.ctx_agent_code() is not null then
    raise exception 'An agent run has no session' using errcode = 'insufficient_privilege';
  end if;
  update office.sessions s set closed_at = pg_catalog.now(), close_reason = 'logout'
    where s.key_hash = p_key_hash and s.closed_at is null
    returning s.id into v_id;
  return v_id;
end
$$;

-- "Log out everywhere": closes every open session of the context person. Returns the number closed.
create function office.close_all_sessions() returns integer
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_user uuid := office.ctx_user_id();
  v_count integer;
begin
  if v_user is null or office.ctx_agent_code() is not null then
    raise exception 'Closing all sessions needs a person''s context'
      using errcode = 'insufficient_privilege';
  end if;
  update office.sessions s set closed_at = pg_catalog.now(), close_reason = 'logout_all'
    where s.user_id = v_user and s.closed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Remembers the company picked last as the default for the next request. Only on a live session
-- (open, before its absolute expiry, idle for at most 31 minutes) and only a company the session's
-- account is a member of.
create function office.set_last_company(p_key_hash bytea, p_company_id uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_agent_code() is not null then
    raise exception 'An agent run has no session' using errcode = 'insufficient_privilege';
  end if;
  update office.sessions s set last_company_id = p_company_id
    where s.key_hash = p_key_hash
      and s.closed_at is null
      and s.absolute_expires_at > pg_catalog.now()
      and s.last_seen_at > pg_catalog.now() - interval '31 minutes'
      and exists (
        select 1 from office.memberships m
        where m.user_id = s.user_id and m.company_id = p_company_id
      );
  if not found then
    raise exception 'No live session of a member of this company'
      using errcode = 'insufficient_privilege';
  end if;
end
$$;

/*
 * Closes the open sessions of an account that can no longer be used: at once when the account is
 * deactivated (users), or when its last membership is removed (memberships). Reactivating the
 * account or adding a membership later does not reopen them.
 */
create function office.close_account_sessions() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_user uuid;
  v_reason text;
  v_session uuid;
begin
  if tg_table_name = 'users' then
    v_user := new.id;
    v_reason := 'account_inactive';
  else
    v_user := old.user_id;
    v_reason := 'no_membership';
    if exists (select 1 from office.memberships m where m.user_id = v_user) then
      return null;
    end if;
  end if;
  for v_session in
    select s.id from office.sessions s where s.user_id = v_user and s.closed_at is null
    order by s.id
  loop
    perform office.expire_session(v_session, 'account_closed', v_reason);
  end loop;
  return null;
end
$$;

alter function office.open_session(bytea, text, timestamptz) owner to office_identity;
alter function office.expire_session(uuid, text, text) owner to office_identity;
alter function office.verify_session(bytea, integer) owner to office_identity;
alter function office.close_session(bytea) owner to office_identity;
alter function office.close_all_sessions() owner to office_identity;
alter function office.set_last_company(bytea, uuid) owner to office_identity;
alter function office.close_account_sessions() owner to office_identity;

create trigger close_account_sessions after update of active on office.users
  for each row when (old.active and not new.active)
  execute function office.close_account_sessions();
create trigger close_account_sessions after delete on office.memberships
  for each row execute function office.close_account_sessions();

revoke execute on function
  office.open_session(bytea, text, timestamptz), office.expire_session(uuid, text, text),
  office.verify_session(bytea, integer), office.close_session(bytea), office.close_all_sessions(),
  office.set_last_company(bytea, uuid), office.close_account_sessions()
  from public;
grant execute on function
  office.open_session(bytea, text, timestamptz), office.verify_session(bytea, integer),
  office.close_session(bytea), office.close_all_sessions(), office.set_last_company(bytea, uuid)
  to office_api_private;
