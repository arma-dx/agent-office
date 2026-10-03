-- Login events (KALAN-ISLER 0.3; CLAUDE.md rule 5; 3 October decision 10).
--
-- Logins, logouts, "log out everywhere", rejected logins and expired sessions. audit_log cannot
-- hold them: a rejected login belongs to no company and has no account. This table carries no
-- company_id (like the identity tables) and, by the founder's decision, never an email address, an
-- IP address or free text: only the event, the time, the account and session ids when known, and a
-- reason code from a fixed list (a new code comes with a new migration). Append only. Written only
-- through record_login_event (the API) and by the session functions and triggers when they close a
-- session that can no longer be used. No application role reads it yet; the screen that shows it
-- adds a narrow read path.

create table office.login_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event text not null check (
    event in ('login', 'logout', 'logout_all', 'rejected', 'session_expired')
  ),
  -- Deleting an account keeps its events without the link to it.
  user_id uuid references office.users (id) on delete set null,
  session_id uuid,
  -- A fixed list, so that no email address, IP address or other text can be stored here.
  reason text check (
    reason in (
      -- complete_login results
      'not_allowed', 'account_mismatch', 'inactive',
      -- ID token checks in the API (rule 3; 3 October decisions 8 and 11)
      'email_unverified', 'mfa_missing',
      -- sessions closed by the database
      'idle_timeout', 'absolute_timeout', 'account_inactive', 'no_membership'
    )
  ),
  -- A rejected login says why and has no session.
  constraint rejected_has_reason check (
    event <> 'rejected' or (reason is not null and session_id is null)
  )
);
create index login_events_occurred_at on office.login_events (occurred_at desc);
create index login_events_user on office.login_events (user_id, occurred_at desc)
  where user_id is not null;

-- Update, delete and truncate are rejected (for the privileged role too). The single exception is
-- the foreign key clearing user_id when an account is deleted; nothing else may change with it.
create function office.reject_login_event_change() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' then
    if old.user_id is not null and new.user_id is null
       and (pg_catalog.to_jsonb(new) - 'user_id') = (pg_catalog.to_jsonb(old) - 'user_id') then
      return new;
    end if;
  end if;
  raise exception 'login_events cannot be changed or deleted'
    using errcode = 'insufficient_privilege';
end
$$;
create trigger append_only before update or delete on office.login_events
  for each row execute function office.reject_login_event_change();
create trigger no_truncate before truncate on office.login_events
  for each statement execute function office.reject_login_event_change();

alter table office.login_events enable row level security;
alter table office.login_events force row level security;

grant insert (event, user_id, session_id, reason) on office.login_events to office_identity;
create policy identity_records on office.login_events for insert to office_identity
  with check (true);

/*
 * Records a login event. The API calls it for login, logout, logout_all and rejected; the session
 * functions and triggers call it for session_expired. login, logout and session_expired need the
 * account and the session, logout_all the account; a session must belong to the account given
 * with it. The event and the reason code are checked by the table.
 */
create function office.record_login_event(
  p_event text,
  p_reason text,
  p_user_id uuid,
  p_session_id uuid
) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_agent_code() is not null then
    raise exception 'An agent run does not record login events'
      using errcode = 'insufficient_privilege';
  end if;
  if (p_event in ('login', 'logout', 'session_expired')
      and (p_user_id is null or p_session_id is null))
     or (p_event = 'logout_all' and p_user_id is null) then
    raise exception 'Event % needs the account and the session it belongs to', p_event
      using errcode = 'invalid_parameter_value';
  end if;
  if p_session_id is not null and not exists (
    select 1 from office.sessions s where s.id = p_session_id and s.user_id = p_user_id
  ) then
    raise exception 'The session does not belong to the account'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into office.login_events (event, user_id, session_id, reason)
    values (p_event, p_user_id, p_session_id, p_reason);
end
$$;
alter function office.record_login_event(text, text, uuid, uuid) owner to office_identity;
revoke execute on function office.record_login_event(text, text, uuid, uuid) from public;
grant execute on function office.record_login_event(text, text, uuid, uuid)
  to office_api_private;

-- The session functions and triggers now record why a session they close has ended (idle_timeout,
-- absolute_timeout, account_inactive, no_membership). Same signature, owner and privileges as
-- before.
create or replace function office.expire_session(
  p_session_id uuid,
  p_close_reason text,
  p_event_reason text
) returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_user uuid;
begin
  update office.sessions s set closed_at = pg_catalog.now(), close_reason = p_close_reason
    where s.id = p_session_id and s.closed_at is null
    returning s.user_id into v_user;
  if found then
    perform office.record_login_event('session_expired', p_event_reason, v_user, p_session_id);
  end if;
end
$$;
