-- The refresh of a session's last activity must not wait for another request of the same person.
--
-- verify_session runs first in every request's transaction (rule 9: one request, one
-- transaction). When the session was last seen more than a minute ago it writes last_seen_at, and
-- that row stays locked until the request commits. A request that is slow for a reason of its own
-- (adding or deleting a project file calls the file storage inside its transaction, for up to 30
-- and 10 seconds) therefore held the session row for that long, and every other request of the
-- same person stopped in verify_session on the same update, each holding a connection of the
-- API's pool: one person's slow deletion and nine more of their requests left no connection for
-- anybody (the pool has ten).
--
-- The refresh is now taken only when the row is free: the row is locked with "skip locked", and a
-- check that finds it held by another transaction leaves the write to that transaction, which is
-- writing the same thing. Nothing else changes: the limits are checked exactly as before, on the
-- last committed value, and the function is replaced from its newest definition
-- (20261007100000_session_check_without_activity.sql) with the same signature, owner and grants.
--
-- Closing a session that is past a limit still waits for the row (expire_session): a session is
-- closed once, and a check must not answer "valid" for a session it found expired.

create or replace function office.verify_session(
  p_key_hash bytea,
  p_idle_seconds integer,
  p_touch boolean default true
)
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
  if p_touch is null then
    raise exception 'Whether the request counts as activity must be given'
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

  if p_touch then
    -- Only a row no other transaction holds: a request of the same person that is still open
    -- is writing the same refresh, and this one does not wait for it.
    update office.sessions s set last_seen_at = pg_catalog.now()
      where s.id = (
        select x.id from office.sessions x
        where x.id = v_session.id
          and x.closed_at is null
          and x.last_seen_at < pg_catalog.now() - interval '60 seconds'
        for update skip locked
      );
  end if;
  return query select v_session.id, v_session.user_id, v_session.last_company_id;
end
$$;

alter function office.verify_session(bytea, integer, boolean) owner to office_identity;
revoke execute on function office.verify_session(bytea, integer, boolean) from public;
grant execute on function office.verify_session(bytea, integer, boolean) to office_api_private;
