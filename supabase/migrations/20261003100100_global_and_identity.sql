-- Global configuration tables and identity tables (rules 2, 3, 9).
--
-- Global tables (units, agent_definitions, card_versions, tools) hold no company data and carry no
-- company_id; they are synced from the files in the repository by the privileged role, and the
-- application role only reads them. No company name is hard-coded: a new company is opened only by
-- inserting a record.

-- Global tables -----------------------------------------------------------------------------------

create table office.units (
  code text primary key check (code ~ '^[A-Z]{1,3}(-[A-Z]{2,4})?$'),
  name text not null,
  description text,
  -- null: a unit shared by both companies; set: that company's short code (companies.code).
  company_code text,
  pilot_enabled boolean not null default false
);

create table office.agent_definitions (
  code text primary key check (code ~ '^[A-Z]{1,3}(-[A-Z]{2,4})?-[0-9]+$'),
  name text not null,
  unit_code text not null references office.units (code),
  -- The card's companies field: a company_agents row can be opened only for these companies.
  company_codes text[] not null default '{}',
  current_version_id uuid
);

create table office.card_versions (
  id uuid primary key default gen_random_uuid(),
  agent_code text not null references office.agent_definitions (code),
  git_commit text not null check (git_commit ~ '^[0-9a-f]{7,40}$'),
  content jsonb not null,
  authority_level text not null check (authority_level in ('Y0', 'Y1', 'Y2', 'Y3')),
  model text not null,
  created_at timestamptz not null default now(),
  unique (agent_code, git_commit),
  -- A run record names the card version together with the agent code (another agent's version
  -- cannot be written).
  unique (id, agent_code)
);

alter table office.agent_definitions
  add foreign key (current_version_id) references office.card_versions (id);

create table office.tools (
  name text primary key check (name ~ '^[a-z][a-z_]*$'),
  kind text not null check (kind in ('read', 'draft', 'internal_write', 'external_effect')),
  description text not null,
  approval_rule text
);

grant select on office.units, office.agent_definitions, office.card_versions, office.tools
  to office_app;

-- Companies and identity --------------------------------------------------------------------------

-- companies is the tenant itself; it carries no company_id. kind: company or private_space (the
-- founder's space).
create table office.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  kind text not null check (kind in ('company', 'private_space')),
  created_at timestamptz not null default now()
);

-- A person can be a member of several companies, so users carries no company_id.
create table office.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A person can have several Google accounts (like the founder's Arma DX and Pillika addresses); all
-- of them link to the same user. Login succeeds if the verified email has a record here (rule 3).
-- This is an identity table and carries no company_id.
create table office.user_emails (
  email text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid not null references office.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index user_emails_user on office.user_emails (user_id);

create table office.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  user_id uuid not null references office.users (id),
  role text not null check (role in ('founder', 'employee', 'external')),
  -- Opened when the founder grants an employee the right to approve (PLAN, Roles).
  can_approve boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

-- Only the founder can be a member of the founder's space (private_space).
create function office.check_membership() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.role <> 'founder'
     and exists (
       select 1 from office.companies s where s.id = new.company_id and s.kind = 'private_space'
     ) then
    raise exception 'Only the founder can be a member of the founder space'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger check_membership before insert or update on office.memberships
  for each row execute function office.check_membership();

-- The reader role reads memberships to answer membership questions without hitting row policies.
grant select on office.memberships to office_auth_reader;

-- The role of the context user in the context company; NULL if not a member.
create function office.my_role() returns text
  language sql stable security definer set search_path = ''
  as $$
    select u.role from office.memberships u
    where u.company_id = office.ctx_company_id() and u.user_id = office.ctx_user_id()
  $$;
alter function office.my_role() owner to office_auth_reader;

-- Is the context user a founder or an employee in the context company (not an external person).
create function office.is_insider() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(office.my_role() in ('founder', 'employee'), false) $$;

create function office.is_founder() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(office.my_role() = 'founder', false) $$;

grant execute on function office.my_role(), office.is_insider(), office.is_founder() to office_app;

-- Can the context person approve (the founder, or an employee who was given the right).
create function office.can_approve() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce((
      select u.role = 'founder' or (u.role = 'employee' and u.can_approve)
      from office.memberships u
      where u.company_id = office.ctx_company_id() and u.user_id = office.ctx_user_id()
    ), false)
  $$;
alter function office.can_approve() owner to office_auth_reader;
grant execute on function office.can_approve() to office_app;

-- Can the context person manage this account: the account is a member of the context company and
-- the context person is the founder in every company the account is a member of. Nobody can manage
-- an account that is not a member of any company; this way a company's founder cannot change an
-- account that has access to another company or that has no owner.
create function office.can_manage_account(p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select office.ctx_agent_code() is null
      and office.ctx_user_id() is not null
      and exists (
        select 1 from office.memberships u
        where u.user_id = p_user and u.company_id = office.ctx_company_id()
      )
      and not exists (
        select 1 from office.memberships u
        where u.user_id = p_user
          and not exists (
            select 1 from office.memberships k
            where k.company_id = u.company_id and k.user_id = office.ctx_user_id()
              and k.role = 'founder'
          )
      )
  $$;
alter function office.can_manage_account(uuid) owner to office_auth_reader;
grant execute on function office.can_manage_account(uuid) to office_app;

-- Row policies ------------------------------------------------------------------------------------

alter table office.companies enable row level security;
alter table office.companies force row level security;
alter table office.users enable row level security;
alter table office.users force row level security;
alter table office.user_emails enable row level security;
alter table office.user_emails force row level security;
alter table office.memberships enable row level security;
alter table office.memberships force row level security;

grant select on office.companies to office_app;
-- Opening an account and linking an email are part of the invitation and login work
-- (KALAN-ISLER 0.3): there they are done by a narrow function after the owner of the address is
-- verified with Google. Until then the application cannot create identity records or write emails;
-- only the seed data writes these records.
grant select, update (name, active) on office.users to office_app;
grant select on office.user_emails to office_app;
grant select, insert, update, delete on office.memberships to office_app;

-- The reader role's own policy: it reads memberships unconditionally (it only has SELECT).
create policy reader on office.memberships for select to office_auth_reader using (true);

-- Rule 9: a user sees only their own record, their own memberships (in every company; for the
-- company picker) and the companies they are a member of. An agent run sees only the identity's
-- membership in the context company. Only that company's founder sees and manages the company's
-- member list; screens that need a team list (such as task assignment) will get a narrow function
-- later.
create policy visible on office.memberships for select to office_app
  using (
    user_id = office.ctx_user_id()
    and (office.ctx_agent_code() is null or company_id = office.ctx_company_id())
  );
-- Only that company's founder adds, changes and removes memberships; an agent run cannot change
-- them.
create policy founder_manages on office.memberships for all to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );

-- A user sees the companies they are a member of (company picker); an agent run sees only its own
-- company.
create policy visible on office.companies for select to office_app
  using (
    (office.ctx_agent_code() is null or id = office.ctx_company_id())
    and exists (
      select 1 from office.memberships u
      where u.company_id = companies.id and u.user_id = office.ctx_user_id()
    )
  );

-- Email records: the email verified at login itself; the person's own addresses; the founder also
-- sees the addresses of their company's members. An agent run sees no emails (personal data).
create policy visible on office.user_emails for select to office_app
  using (
    office.ctx_agent_code() is null
    and (
      email = office.ctx_email()
      or user_id = office.ctx_user_id()
      or (
        office.is_founder()
        and exists (
          select 1 from office.memberships u
          where u.user_id = user_emails.user_id
            and u.company_id = office.ctx_company_id()
        )
      )
    )
  );
-- User record: the user themselves and the owner of the email verified at login; the founder also
-- sees their company's members.
create policy visible on office.users for select to office_app
  using (
    id = office.ctx_user_id()
    or exists (
      select 1 from office.user_emails e
      where e.user_id = users.id and e.email = office.ctx_email()
    )
    or (
      office.is_founder()
      and office.ctx_agent_code() is null
      and exists (
        select 1 from office.memberships u
        where u.user_id = users.id and u.company_id = office.ctx_company_id()
      )
    )
  );
-- A person updates their own name; the founder updates the name of an account they can manage and
-- activates or deactivates it (the active column). A bulk update without WHERE also reaches only
-- these rows.
create policy updates on office.users for update to office_app
  using (
    office.ctx_agent_code() is null
    and (
      id = office.ctx_user_id()
      or (office.is_founder() and office.can_manage_account(id))
    )
  );

create function office.check_user_update() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.active is distinct from old.active and not office.can_manage_account(new.id) then
    raise exception 'Only the founder activates or deactivates an account'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger check_user_update before update on office.users
  for each row execute function office.check_user_update();
