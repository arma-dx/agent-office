-- Invitations and completing a Google login (KALAN-ISLER 0.3; CLAUDE.md rule 3; 3 October
-- decisions 9 and 11).
--
-- Login is allowed only for an address Google verified that has a valid invitation or a
-- membership. The founder invites only employees and external persons, and only into a company
-- (never into the founder space). An invitation is valid for 7 days and can be renewed, but never
-- beyond 30 days after it was created; it is valid only while its inviter is an active founder of
-- the company. The invited address is bound to an account at the first Google login with it; that
-- login turns the invitation into a membership. Creating an invitation never sends an email by
-- itself, and nothing at invitation time looks up whether the address already has an account.
--
-- Pending invitations are cancelled when the account's membership of that company is removed and
-- when the account is deactivated, so an old invitation never brings a removed or deactivated
-- person back. A new invitation does: it reopens a deactivated account that belongs to no company.

create table office.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('employee', 'external')),
  -- Only an employee can be given the approval right.
  can_approve boolean not null default false,
  invited_by_user_id uuid not null references office.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  renewed_at timestamptz,
  accepted_at timestamptz,
  accepted_by_user_id uuid references office.users (id),
  cancelled_at timestamptz,
  unique (id, company_id),
  constraint approval_only_employee check (not can_approve or role = 'employee'),
  constraint validity_window check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  ),
  constraint accepted_complete check ((accepted_at is null) = (accepted_by_user_id is null)),
  constraint single_outcome check (accepted_at is null or cancelled_at is null)
);
-- At most one pending invitation per address and company. An expired one stays pending until the
-- founder renews or cancels it.
create unique index invitations_one_pending on office.invitations (company_id, email)
  where accepted_at is null and cancelled_at is null;
create index invitations_pending_email on office.invitations (email)
  where accepted_at is null and cancelled_at is null;

create trigger immutable_columns before update on office.invitations
  for each row execute function office.prevent_column_changes(
    'id', 'company_id', 'email', 'role', 'can_approve', 'invited_by_user_id', 'created_at'
  );

-- A company's kind, read as the reader role: the invitation check gives the right answer even for
-- a company the caller cannot see (the row policy then rejects the row).
create function office.company_kind(p_company_id uuid) returns text
  language sql stable security definer set search_path = ''
  as $$ select c.kind from office.companies c where c.id = p_company_id $$;
alter function office.company_kind(uuid) owner to office_auth_reader;
revoke execute on function office.company_kind(uuid) from public;
grant execute on function office.company_kind(uuid) to office_api_private;

/*
 * Insert: only into a company of kind 'company'; who and when come from the context; the
 * invitation starts open and valid for 7 days.
 * Update: an accepted or cancelled invitation never changes. The founder renews (expires_at, which
 * stamps renewed_at) or cancels (cancelled_at, stamped with the current time). Only the login
 * function (running as office_identity) accepts an invitation, and only one that has not expired.
 */
create function office.check_invitation() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := office.company_kind(new.company_id);
    if v_kind is null then
      raise exception 'The company does not exist' using errcode = 'foreign_key_violation';
    elsif v_kind <> 'company' then
      raise exception 'Invitations are only for companies, not for the founder space'
        using errcode = 'check_violation';
    end if;
    if new.accepted_at is not null or new.accepted_by_user_id is not null
       or new.cancelled_at is not null or new.renewed_at is not null then
      raise exception 'A new invitation is open: not accepted, cancelled or renewed'
        using errcode = 'check_violation';
    end if;
    new.invited_by_user_id := office.ctx_user_id();
    new.created_at := pg_catalog.now();
    new.expires_at := new.created_at + interval '7 days';
    return new;
  end if;

  if old.accepted_at is not null or old.cancelled_at is not null then
    raise exception 'An accepted or cancelled invitation cannot change'
      using errcode = 'check_violation';
  end if;
  if new.accepted_at is distinct from old.accepted_at
     or new.accepted_by_user_id is distinct from old.accepted_by_user_id then
    if current_user <> 'office_identity' then
      raise exception 'Only the login function accepts an invitation'
        using errcode = 'insufficient_privilege';
    end if;
    if old.expires_at <= pg_catalog.now() then
      raise exception 'An expired invitation cannot be accepted' using errcode = 'check_violation';
    end if;
    new.accepted_at := pg_catalog.now();
  end if;
  if new.cancelled_at is not null then
    new.cancelled_at := pg_catalog.now();
  end if;
  if new.expires_at is distinct from old.expires_at then
    if new.expires_at <= pg_catalog.now() then
      raise exception 'A renewed invitation must expire in the future'
        using errcode = 'check_violation';
    end if;
    new.renewed_at := pg_catalog.now();
  else
    new.renewed_at := old.renewed_at;
  end if;
  return new;
end
$$;
create trigger check_invitation before insert or update on office.invitations
  for each row execute function office.check_invitation();

alter table office.invitations enable row level security;
alter table office.invitations force row level security;

-- Only the API manages invitations (the worker has no privilege at all); no DELETE, an invitation
-- is cancelled instead. Who, when and the expiry are filled in by the trigger.
grant select, insert (company_id, email, role, can_approve),
  update (expires_at, renewed_at, cancelled_at)
  on office.invitations to office_api_private;
create policy founder_manages on office.invitations for all to office_api_private
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );

-- The login function reads and accepts only the invitations of the address verified at login.
grant select (
  id, company_id, email, role, can_approve, invited_by_user_id, created_at, expires_at,
  accepted_at, cancelled_at
), update (accepted_at, accepted_by_user_id)
  on office.invitations to office_identity;
create policy login_reads on office.invitations for select to office_identity
  using (email = office.ctx_email());
create policy login_accepts on office.invitations for update to office_identity
  using (email = office.ctx_email())
  with check (email = office.ctx_email());

-- Cancelling the pending invitations of a removed member or a deactivated account (bookkeeping
-- trigger below): the trigger role reads the account's addresses and the pending invitations and
-- writes only cancelled_at.
grant select (user_id, email) on office.user_emails to office_trigger;
create policy trigger_reads on office.user_emails for select to office_trigger using (true);
grant select (id, company_id, email, accepted_at, cancelled_at), update (cancelled_at)
  on office.invitations to office_trigger;
-- (The updated row must stay readable to the trigger role, so the read policy is not limited to
-- pending invitations; the update policy is.)
create policy trigger_reads on office.invitations for select to office_trigger using (true);
create policy trigger_cancels on office.invitations for update to office_trigger
  using (accepted_at is null and cancelled_at is null)
  with check (cancelled_at is not null);

/*
 * Cancels pending invitations that would otherwise outlive a decision to end access: when a
 * membership is removed, the pending invitations of that company for the account's addresses; when
 * an account is deactivated, every pending invitation for its addresses. Expired pending
 * invitations are cancelled too.
 */
create function office.cancel_pending_invitations() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if tg_table_name = 'memberships' then
    update office.invitations i set cancelled_at = pg_catalog.now()
      where i.company_id = old.company_id
        and i.accepted_at is null
        and i.cancelled_at is null
        and i.email in (select e.email from office.user_emails e where e.user_id = old.user_id);
  else
    update office.invitations i set cancelled_at = pg_catalog.now()
      where i.accepted_at is null
        and i.cancelled_at is null
        and i.email in (select e.email from office.user_emails e where e.user_id = new.id);
  end if;
  return null;
end
$$;
alter function office.cancel_pending_invitations() owner to office_trigger;
revoke execute on function office.cancel_pending_invitations() from public;
create trigger cancel_pending_invitations after delete on office.memberships
  for each row execute function office.cancel_pending_invitations();
create trigger cancel_pending_invitations after update of active on office.users
  for each row when (old.active and not new.active)
  execute function office.cancel_pending_invitations();

-- Memberships created by an invitation ---------------------------------------------------------

alter table office.memberships add column invitation_id uuid;
alter table office.memberships
  add constraint memberships_invitation_fkey foreign key (invitation_id, company_id)
  references office.invitations (id, company_id);

-- office_identity inserts a membership only as the copy of a valid invitation of the login address
-- (same company, role and approval right; the inviter still an active founder), for the account
-- bound to that address.
grant insert (company_id, user_id, role, can_approve, invitation_id)
  on office.memberships to office_identity;
create policy login_joins on office.memberships for insert to office_identity
  with check (
    exists (
      select 1
      from office.invitations i
      join office.user_emails e on e.email = i.email
      where i.id = memberships.invitation_id
        and i.company_id = memberships.company_id
        and i.email = office.ctx_email()
        and i.role = memberships.role
        and i.can_approve = memberships.can_approve
        and i.accepted_at is null
        and i.cancelled_at is null
        and i.expires_at > now()
        and office.is_active_founder(i.company_id, i.invited_by_user_id)
        and e.user_id = memberships.user_id
    )
  );

/*
 * Completes a Google login after the API verified the ID token. The address comes only from the
 * context (app.email); p_google_sub is the token's sub, p_name the profile name for a new account.
 * Results (seen only by the API, never by the browser):
 *   ok                the account has at least one membership; user_id is the account
 *   not_allowed       no valid invitation and no membership
 *   account_mismatch  the address is bound to another Google account, or this Google account
 *                     belongs to another person
 *   inactive          the account was deactivated
 * Only ok lets the API open a session (open_session checks the same Google account again).
 * Steps: the address is locked for the transaction; a bound address must belong to the same
 * Google account (an address created by the seed is bound now); valid invitations (not accepted,
 * cancelled or expired, inviter still an active founder) are locked; a first-time invited person
 * gets an account; a deactivated account that belongs to no company is reopened by a valid
 * invitation (deactivation cancels older ones), otherwise it is refused; every valid invitation
 * into a company the account is not a member of becomes a membership and is marked accepted. An
 * invitation into a company the account is already a member of never changes the existing role and
 * stays pending (removing that membership cancels it). No app.* setting is changed.
 */
create function office.complete_login(p_google_sub text, p_name text)
  returns table (result text, user_id uuid)
  language plpgsql security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_email text := office.ctx_email();
  v_user uuid;
  v_sub text;
  v_active boolean;
  v_invited boolean;
  v_reopened boolean;
  v_name text;
  v_invitation record;
begin
  if office.ctx_agent_code() is not null or office.ctx_user_id() is not null
     or office.ctx_company_id() is not null or office.ctx_project_id() is not null
     or v_email is null then
    raise exception 'complete_login runs only in a login context with the verified email'
      using errcode = 'insufficient_privilege';
  end if;
  if p_google_sub is null or p_google_sub !~ '^[!-~]{1,255}$' then
    raise exception 'The Google account id must be non-empty printable ASCII'
      using errcode = 'invalid_parameter_value';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('office.login:' || v_email, 0)
  );

  select e.user_id, e.google_sub into v_user, v_sub
  from office.user_emails e
  where e.email = v_email;

  if v_user is not null then
    if v_sub is null then
      begin
        update office.user_emails e set google_sub = p_google_sub where e.email = v_email;
      exception when unique_violation then
        -- This Google account belongs to another person.
        return query select 'account_mismatch'::text, v_user;
        return;
      end;
    elsif v_sub <> p_google_sub then
      return query select 'account_mismatch'::text, v_user;
      return;
    end if;
    -- Two addresses of the same account may log in at the same time.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('office.account:' || v_user::text, 0)
    );
  end if;

  perform 1
  from office.invitations i
  where i.email = v_email
    and i.accepted_at is null
    and i.cancelled_at is null
    and i.expires_at > pg_catalog.now()
    and office.is_active_founder(i.company_id, i.invited_by_user_id)
  for update;
  v_invited := found;

  if v_user is not null then
    select u.active into v_active from office.users u where u.id = v_user;
    if not coalesce(v_active, false) then
      -- Reopened only if it belongs to no company and has a valid invitation, which is newer than
      -- the deactivation (deactivating cancels pending invitations). The row policy checks the
      -- same.
      v_reopened := false;
      if v_invited
         and not exists (select 1 from office.memberships m where m.user_id = v_user) then
        update office.users u set active = true where u.id = v_user and not u.active;
        v_reopened := found;
      end if;
      if not v_reopened then
        return query select 'inactive'::text, v_user;
        return;
      end if;
    end if;
  else
    if not v_invited then
      return query select 'not_allowed'::text, null::uuid;
      return;
    end if;
    -- The id is generated first: INSERT ... RETURNING would need a read policy on the new row.
    v_user := pg_catalog.gen_random_uuid();
    v_name := pg_catalog.left(
      coalesce(
        nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_name, '[[:cntrl:]]', '', 'g')), ''),
        pg_catalog.split_part(v_email, '@', 1)
      ),
      200
    );
    begin
      insert into office.users (id, name) values (v_user, v_name);
      insert into office.user_emails (email, user_id, google_sub)
        values (v_email, v_user, p_google_sub);
    exception when unique_violation then
      -- This Google account belongs to another person; no account is created.
      return query select 'account_mismatch'::text, null::uuid;
      return;
    end;
  end if;

  if v_invited then
    for v_invitation in
      select i.id, i.company_id, i.role, i.can_approve
      from office.invitations i
      where i.email = v_email
        and i.accepted_at is null
        and i.cancelled_at is null
        and i.expires_at > pg_catalog.now()
        and office.is_active_founder(i.company_id, i.invited_by_user_id)
      order by i.created_at
    loop
      if not exists (
        select 1 from office.memberships m
        where m.company_id = v_invitation.company_id and m.user_id = v_user
      ) then
        insert into office.memberships (company_id, user_id, role, can_approve, invitation_id)
          values (
            v_invitation.company_id, v_user, v_invitation.role, v_invitation.can_approve,
            v_invitation.id
          );
        update office.invitations i
          set accepted_at = pg_catalog.now(), accepted_by_user_id = v_user
          where i.id = v_invitation.id;
      end if;
    end loop;
  end if;

  if exists (select 1 from office.memberships m where m.user_id = v_user) then
    return query select 'ok'::text, v_user;
  else
    return query select 'not_allowed'::text, v_user;
  end if;
end
$$;
alter function office.complete_login(text, text) owner to office_identity;
revoke execute on function office.complete_login(text, text) from public;
grant execute on function office.complete_login(text, text) to office_api_private;
