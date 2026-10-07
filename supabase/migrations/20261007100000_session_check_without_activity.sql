-- A request the panel sends on a timer (the periodic refresh of a list) must not keep an
-- unattended session alive: the 30 minute idle limit counts what the person does, not what an open
-- tab does (rule 3; 3 October decision 6; 5 October decision 11). The API cannot check a session in
-- any other way than through verify_session (it cannot read a session by its key), so the choice
-- "this request is not activity" has to be an argument of that function.
--
-- With p_touch false every check and every closing stays as it was; only the refresh of
-- last_seen_at is skipped. A session that is past a limit is therefore closed by a background
-- request exactly as by any other, and the panel is sent to the login screen.
--
-- The function gets a third argument, so the old one is dropped first: "create or replace" with one
-- more argument would add a second function, and a call with two arguments would then be
-- ambiguous. Owner and grants are set again below.

drop function office.verify_session(bytea, integer);

create function office.verify_session(
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
    update office.sessions s set last_seen_at = pg_catalog.now()
      where s.id = v_session.id
        and s.closed_at is null
        and s.last_seen_at < pg_catalog.now() - interval '60 seconds';
  end if;
  return query select v_session.id, v_session.user_id, v_session.last_company_id;
end
$$;

alter function office.verify_session(bytea, integer, boolean) owner to office_identity;
revoke execute on function office.verify_session(bytea, integer, boolean) from public;
grant execute on function office.verify_session(bytea, integer, boolean) to office_api_private;
