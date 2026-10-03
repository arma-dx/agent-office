-- Identity hardening before login (KALAN-ISLER 0.3; CLAUDE.md rules 3, 9; 3 October decisions
-- 9-11).
--
-- New roles:
--   office_identity      Owns the SECURITY DEFINER functions for login, sessions and invitations.
--                        NOLOGIN, no BYPASSRLS. It has only the column grants these functions need
--                        and its own policies (TO office_identity), most of them keyed on the email
--                        Google verified at login (app.email).
--   office_api_private   NOLOGIN group of privileges only the API has: running the login, session
--                        and invitation functions and managing invitations. office_api is a member;
--                        office_worker is not, so an agent run can never reach them.
--
-- Changes to the identity tables:
--   memberships   Created only by accepting an invitation inside the login function (or by the
--                 seed); the application updates only role and can_approve; company_id and user_id
--                 never change; a company keeps at least one active founder and the founder space
--                 keeps its founder.
--   users         A person never deactivates their own account, and the last active founder of a
--                 company is never deactivated.
--   my_role()     NULL for a deactivated account, so the account sees no company data.
--   user_emails   google_sub binds an address to one Google account at the first login; a Google
--                 account belongs to one person (several addresses of the same person may share
--                 it); a person sees only their own addresses (the founder no longer reads members'
--                 addresses).

do $$
begin
  if not exists (select from pg_roles where rolname = 'office_identity') then
    create role office_identity nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'office_api_private') then
    create role office_api_private nologin nobypassrls;
  end if;
end
$$;

-- The role running the migrations hands function ownership to office_identity.
grant office_identity to current_user;
grant office_api_private to office_api;

grant usage, create on schema office to office_identity;
grant usage on schema office to office_api_private;

grant execute on function
  office.ctx_company_id(), office.ctx_user_id(), office.ctx_project_id(), office.ctx_email(),
  office.ctx_agent_code()
  to office_identity;

-- The reader role -----------------------------------------------------------------------------

-- The reader role reads whether an account is active (my_role, founder guards), a company's kind
-- (membership checks) and which person a Google account belongs to. It has only SELECT on these
-- columns.
grant select (id, active) on office.users to office_auth_reader;
create policy reader on office.users for select to office_auth_reader using (true);
grant select (id, kind) on office.companies to office_auth_reader;
create policy reader on office.companies for select to office_auth_reader using (true);

-- A deactivated account has no role anywhere: every policy built on my_role(), is_insider(),
-- is_founder() and row_visible() then shows it no company data.
create or replace function office.my_role() returns text
  language sql stable security definer set search_path = ''
  as $$
    select u.role from office.memberships u
    join office.users k on k.id = u.user_id and k.active
    where u.company_id = office.ctx_company_id() and u.user_id = office.ctx_user_id()
  $$;

-- Same rule for the approval right.
create or replace function office.can_approve() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce((
      select u.role = 'founder' or (u.role = 'employee' and u.can_approve)
      from office.memberships u
      join office.users k on k.id = u.user_id and k.active
      where u.company_id = office.ctx_company_id() and u.user_id = office.ctx_user_id()
    ), false)
  $$;

-- Is the account an active founder of the company. Used by the founder guards and to check that an
-- invitation's inviter still is one when the invitation is accepted.
create function office.is_active_founder(p_company_id uuid, p_user_id uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from office.memberships m
      join office.users u on u.id = m.user_id and u.active
      where m.company_id = p_company_id and m.user_id = p_user_id and m.role = 'founder'
    )
  $$;
alter function office.is_active_founder(uuid, uuid) owner to office_auth_reader;
revoke execute on function office.is_active_founder(uuid, uuid) from public;
grant execute on function office.is_active_founder(uuid, uuid) to office_identity;

-- The founder space check reads the company's kind as the reader role, so the caller's view of
-- companies cannot change its outcome (the login function inserts memberships as office_identity,
-- which cannot read companies).
alter function office.check_membership() security definer;
alter function office.check_membership() owner to office_auth_reader;

-- Memberships ---------------------------------------------------------------------------------

revoke insert, update on office.memberships from office_app;
grant update (role, can_approve) on office.memberships to office_app;

create trigger immutable_columns before update on office.memberships
  for each row execute function office.prevent_column_changes('company_id', 'user_id');

/*
 * A company keeps at least one active founder, and the founder's membership of the founder space
 * (private_space) is never removed. Runs as the reader role so that it counts every founder, not
 * only the rows the caller can see; a deactivated founder does not count. The advisory lock on the
 * company serialises two transactions that each remove or deactivate a different founder.
 */
create function office.guard_founder_membership() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if old.role = 'founder' and (tg_op = 'DELETE' or new.role <> 'founder') then
    if exists (
      select 1 from office.companies c where c.id = old.company_id and c.kind = 'private_space'
    ) then
      raise exception 'The founder membership of the founder space cannot be removed'
        using errcode = 'check_violation';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('office.founders:' || old.company_id::text, 0)
    );
    if not exists (
      select 1 from office.memberships m
      join office.users u on u.id = m.user_id and u.active
      where m.company_id = old.company_id and m.role = 'founder' and m.id <> old.id
    ) then
      raise exception 'A company must keep at least one active founder'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;
alter function office.guard_founder_membership() owner to office_auth_reader;
create trigger guard_founder_membership before update or delete on office.memberships
  for each row execute function office.guard_founder_membership();

-- Accounts ------------------------------------------------------------------------------------

/*
 * Deactivating an account: a person never deactivates their own account (they would lock
 * themselves out), and an account that is the last active founder of a company is never
 * deactivated (the founder space has only its founder, so its founder is never deactivated).
 * Holds for the privileged role too. Takes the same per-company locks as the membership guard.
 */
create function office.guard_account_deactivation() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid;
begin
  if new.id = office.ctx_user_id() then
    raise exception 'A person cannot deactivate their own account'
      using errcode = 'insufficient_privilege';
  end if;
  for v_company in
    select m.company_id from office.memberships m
    where m.user_id = new.id and m.role = 'founder'
    order by m.company_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('office.founders:' || v_company::text, 0)
    );
    if not exists (
      select 1 from office.memberships m
      join office.users u on u.id = m.user_id and u.active
      where m.company_id = v_company and m.role = 'founder' and m.user_id <> new.id
    ) then
      raise exception 'The last active founder of a company cannot be deactivated'
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;
alter function office.guard_account_deactivation() owner to office_auth_reader;
create trigger guard_account_deactivation before update of active on office.users
  for each row when (old.active and not new.active)
  execute function office.guard_account_deactivation();

-- Only the founder activates or deactivates an account (unchanged), with one exception: the login
-- function reopens a deactivated account that belongs to no company when the person accepts a new
-- invitation (its row policy, identity_reopens, allows nothing else).
create or replace function office.check_user_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.active is distinct from old.active then
    if current_user = 'office_identity' and new.active then
      return new;
    end if;
    if not office.can_manage_account(new.id) then
      raise exception 'Only the founder activates or deactivates an account'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;

-- Email records -------------------------------------------------------------------------------

-- The Google account (the ID token's sub) the address is bound to. Written by the login function
-- at the first Google login; after that only the same Google account can log in with the address.
alter table office.user_emails
  add column google_sub text check (google_sub ~ '^[!-~]{1,255}$');
create index user_emails_google_sub on office.user_emails (google_sub)
  where google_sub is not null;
grant select (user_id, google_sub) on office.user_emails to office_auth_reader;
create policy reader on office.user_emails for select to office_auth_reader using (true);

/*
 * A Google account belongs to one person: it may be bound to several addresses of the same account
 * (a renamed Workspace address keeps its Google account), never to addresses of two accounts.
 * Raises unique_violation like a unique index would. Runs as the reader role so that it sees every
 * binding; the advisory lock serialises two logins binding the same Google account.
 */
create function office.check_google_account() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if new.google_sub is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('office.google_sub:' || new.google_sub, 0)
    );
    if exists (
      select 1 from office.user_emails e
      where e.google_sub = new.google_sub and e.user_id <> new.user_id
    ) then
      raise exception 'This Google account is bound to another person'
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end
$$;
alter function office.check_google_account() owner to office_auth_reader;
create trigger one_person_per_google_account
  before insert or update of google_sub, user_id on office.user_emails
  for each row execute function office.check_google_account();

-- A person sees only their own addresses and, during login, the address verified by Google. The
-- founder no longer reads the addresses of the company's members; the address of an invited person
-- is on the invitation.
drop policy visible on office.user_emails;
create policy visible on office.user_emails for select to office_app
  using (
    office.ctx_agent_code() is null
    and (email = office.ctx_email() or user_id = office.ctx_user_id())
  );

-- office_identity on the existing identity tables ----------------------------------------------

-- Session checks read whether the session's account is active; the login function creates an
-- account for a first-time invited person and reopens a deactivated account that belongs to no
-- company when a new invitation is accepted.
grant select (id, active), insert (id, name), update (active) on office.users to office_identity;
create policy identity_reads on office.users for select to office_identity using (true);
create policy identity_creates on office.users for insert to office_identity with check (active);
create policy identity_reopens on office.users for update to office_identity
  using (
    not active
    and not exists (select 1 from office.memberships m where m.user_id = users.id)
  )
  with check (active);

-- Only the address verified at login: read it, bind it to a new account, write its google_sub.
grant select (email, user_id, google_sub), insert (email, user_id, google_sub),
  update (google_sub)
  on office.user_emails to office_identity;
create policy login_reads on office.user_emails for select to office_identity
  using (email = office.ctx_email());
create policy login_binds on office.user_emails for insert to office_identity
  with check (email = office.ctx_email());
create policy login_updates on office.user_emails for update to office_identity
  using (email = office.ctx_email())
  with check (email = office.ctx_email());

-- Membership questions of the login and session functions (is the account a member somewhere, of
-- this company). Only the two key columns.
grant select (company_id, user_id) on office.memberships to office_identity;
create policy identity_reads on office.memberships for select to office_identity using (true);
