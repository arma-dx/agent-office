-- Company-specific agent rows, customers, opportunities, projects and the visibility functions
-- (rules 2, 9, 12; 1 October second round decision 1; 2 October decision 2).
--
-- Links inside a company (project, customer, task...) reference the `(id, company_id)` pair, so a
-- record of one company cannot be linked to a record of the other company.

create table office.company_agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  agent_code text not null references office.agent_definitions (code),
  -- The stop button lives on this row; "stop everywhere" disables the rows of every company.
  status text not null default 'disabled' check (status in ('disabled', 'enabled', 'stopped')),
  -- Drive folders, priority senders, Figma working file (allow lists are enforced in code).
  settings jsonb not null default '{}',
  monthly_budget numeric(12, 2),
  updated_at timestamptz not null default now(),
  unique (company_id, agent_code)
);
create trigger set_updated_at before update on office.company_agents
  for each row execute function office.set_updated_at();
create trigger immutable_columns before update on office.company_agents
  for each row execute function office.prevent_column_changes('company_id', 'agent_code');

-- An agent can be opened only in a company named in its card's `companies` field.
create function office.check_company_agent() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if not exists (
    select 1 from office.agent_definitions a, office.companies s
    where a.code = new.agent_code and s.id = new.company_id and s.code = any (a.company_codes)
  ) then
    raise exception 'Agent % is not defined for this company', new.agent_code
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger check_company_agent before insert on office.company_agents
  for each row execute function office.check_company_agent();

create table office.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  name text not null,
  contacts jsonb not null default '[]',
  -- Rule 12: AI permission is also kept at customer level. Off by default (the default is an open
  -- question in R8).
  ai_allowed boolean not null default false,
  -- 2 October decision 4: does the contract allow automated processing done by code.
  automated_processing_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);

create table office.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  customer_id uuid not null,
  name text not null,
  stage text not null default 'new',
  value numeric(14, 2),
  next_step text,
  proposal_outcome text check (proposal_outcome in ('submitted', 'won', 'lost')),
  created_at timestamptz not null default now(),
  foreign key (customer_id, company_id) references office.customers (id, company_id)
);

create table office.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  customer_id uuid,
  name text not null,
  budget numeric(14, 2),
  milestones jsonb not null default '[]',
  -- Rule 12: AI permission at project level. Off by default (R8).
  ai_allowed boolean not null default false,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (customer_id, company_id) references office.customers (id, company_id)
);

-- A project member must also be a member of the company; when a person leaves the company their
-- project memberships are deleted too.
create table office.project_members (
  company_id uuid not null references office.companies (id),
  project_id uuid not null,
  user_id uuid not null,
  primary key (project_id, user_id),
  foreign key (project_id, company_id) references office.projects (id, company_id)
    on delete cascade,
  foreign key (company_id, user_id) references office.memberships (company_id, user_id)
    on delete cascade
);

grant select on office.project_members to office_auth_reader;

-- Is the context user a member of this project (as the reader role; the row policy does not call
-- itself).
create function office.is_project_member(p_project uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from office.project_members pu
      where pu.project_id = p_project and pu.user_id = office.ctx_user_id()
    )
  $$;
alter function office.is_project_member(uuid) owner to office_auth_reader;
grant execute on function office.is_project_member(uuid) to office_app;

/*
 * The core of visibility. A row is visible only when:
 * - the row belongs to the context company and the context user is a member of that company;
 * - on a person's request: without project scope, everyone inside the company (founder, employee);
 *   with project scope, only the founder and the project members. An external person sees nothing
 *   here; records shared with them come through the table's own policy.
 * - in an agent run (app.agent_code set): without project context, only rows without project scope;
 *   with project context, rows without project scope and only the rows of its own project. This
 *   holds even when the identity is the founder. The project itself is visible to an agent only if
 *   it has AI permission (projects policy), so the rows of a project without permission are not
 *   visible either. The run also inherits the limits of its identity: the identity must be an
 *   insider, and for a project row the founder or a project member.
 */
create function office.row_visible(p_company uuid, p_project uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select p_company = office.ctx_company_id()
      and office.my_role() is not null
      and case
        when office.ctx_agent_code() is not null then
          office.is_insider()
          and (
            p_project is null
            or (
              p_project = office.ctx_project_id()
              and exists (select 1 from office.projects pr where pr.id = p_project)
            )
          )
        else
          office.is_insider()
          and (p_project is null or office.is_founder() or office.is_project_member(p_project))
      end
  $$;
grant execute on function office.row_visible(uuid, uuid) to office_app;

alter table office.company_agents enable row level security;
alter table office.company_agents force row level security;
alter table office.customers enable row level security;
alter table office.customers force row level security;
alter table office.opportunities enable row level security;
alter table office.opportunities force row level security;
alter table office.projects enable row level security;
alter table office.projects force row level security;
alter table office.project_members enable row level security;
alter table office.project_members force row level security;

grant select, insert, update, delete
  on office.company_agents, office.customers, office.opportunities, office.projects,
    office.project_members
  to office_app;

-- Insiders and agents see the company-specific agent rows; only the founder changes them.
create policy visible on office.company_agents for select to office_app
  using (office.row_visible(company_id, null));
create policy founder_manages on office.company_agents for all to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );

-- AI permission and automated processing permission are turned on or off only by the founder (like
-- the project AI permission; who marks the permission is an open question in R8, until then the
-- founder).
create function office.check_customer_permissions() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if (tg_op = 'INSERT' and (new.ai_allowed or new.automated_processing_allowed))
     or (tg_op = 'UPDATE' and (
           new.ai_allowed is distinct from old.ai_allowed
           or new.automated_processing_allowed is distinct from old.automated_processing_allowed
         )) then
    if office.ctx_agent_code() is not null or not office.is_founder() then
      raise exception 'Only the founder changes the customer''s AI permission'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;
create trigger check_customer_permissions before insert or update on office.customers
  for each row execute function office.check_customer_permissions();

-- Customer: a customer without AI permission is closed to agent runs (2 October decision 2).
create policy tenant_isolation on office.customers for all to office_app
  using (
    office.row_visible(company_id, null) and (office.ctx_agent_code() is null or ai_allowed)
  )
  with check (
    office.row_visible(company_id, null) and (office.ctx_agent_code() is null or ai_allowed)
  );

-- Opportunity: if its customer is not visible (customer without permission), the agent does not see
-- the opportunity either.
create policy tenant_isolation on office.opportunities for all to office_app
  using (
    office.row_visible(company_id, null)
    and exists (select 1 from office.customers m where m.id = customer_id)
  )
  with check (
    office.row_visible(company_id, null)
    and exists (select 1 from office.customers m where m.id = customer_id)
  );

-- The project record is project scoped: the founder and the members see it. An agent sees only its
-- own project, and only if the project and its customer (if any) have AI permission.
create policy visible on office.projects for select to office_app
  using (
    company_id = office.ctx_company_id()
    and office.my_role() is not null
    and case
      when office.ctx_agent_code() is not null then
        id = office.ctx_project_id()
        and ai_allowed
        and (office.is_founder() or (office.is_insider() and office.is_project_member(id)))
        and (
          customer_id is null
          or exists (select 1 from office.customers m where m.id = customer_id)
        )
      else
        office.is_founder() or (office.is_insider() and office.is_project_member(id))
    end
  );
-- Only the founder opens, changes and deletes a project (delete only looks at the USING condition).
create policy founder_manages on office.projects for all to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );

-- Project members: a person sees their own membership, the founder and project members see the
-- project's members; only the founder changes them.
create policy visible on office.project_members for select to office_app
  using (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and (
      user_id = office.ctx_user_id()
      or office.is_founder()
      or office.is_project_member(project_id)
    )
  );
create policy founder_manages on office.project_members for all to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );
create policy reader on office.project_members for select to office_auth_reader using (true);
