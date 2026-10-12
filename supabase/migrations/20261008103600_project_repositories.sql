-- The repository of a project (8 October decisions 17 and 19; 12 October decisions 15 and 17;
-- docs/SONRA.md P-l, P-p, P-s; CLAUDE.md rules 2, 9 and 12).
--
-- Decision 19: whoever opens a project can pick one of the repositories of the company's
-- connected GitHub organisation. 12 October decision 17: afterwards the owner, the managers and
-- the founder change it. From here on:
--   - office.project_repositories holds one row per project that has a repository: GitHub's
--     numeric id of the repository (the record), the name it had when it was linked (shown while
--     GitHub cannot be asked) and the connection it came through. The connection is the same
--     company's: a foreign key on the pair, so a project of one company never hangs on the
--     GitHub connection of the other;
--   - a row is read like the project itself: by the founder and the project's members; an agent
--     run reads it only in its project's context;
--   - a row is written through the API's role only, by the founder, the owner and the managers
--     of the project. It is linked and unlinked, never rewritten: a change is an unlink and a link;
--   - linking needs the company's connection to be open, and rule 12: the project has no
--     customer, or its customer allows AI, or its customer allows automated processing by code
--     (office.project_code_processing_allowed). Unlinking needs neither;
--   - linking and unlinking are written to the audit log with the repository's number.
-- Whether the repository is one the company's installation reaches is the API's check: only
-- GitHub knows it. A write without a person in the context (migrations, the seed, an
-- administrator) is left alone, as for the AI permission.
--
-- Error codes: 42501 not the founder, the owner or a manager, or an agent run; 23514 the
-- connection is not the company's open GitHub connection; 55000 the customer of the project
-- allows neither AI nor automated processing; 23505 the project has a repository already; 23503
-- a project or a connection of another company.

-- The repository of a project (8 October decision 19: one of the repositories of the connected
-- organisation). GitHub's numeric id is the record; full_name is what it was called when it was
-- linked, shown while GitHub cannot be asked. One repository per project (primary key).
create table office.project_repositories (
  company_id uuid not null references office.companies (id),
  project_id uuid primary key,
  integration_id uuid not null,
  repository_id bigint not null check (repository_id > 0),
  full_name text not null
    check (full_name ~ '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$'),
  linked_by_user_id uuid references office.users (id),
  linked_at timestamptz not null default now(),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  -- The connection is the same company's: a project of one company never hangs on the GitHub
  -- connection of the other (rule 2).
  foreign key (integration_id, company_id) references office.integrations (id, company_id)
);
create index project_repositories_integration on office.project_repositories (integration_id);

alter table office.project_repositories enable row level security;
alter table office.project_repositories force row level security;

-- Read like the project itself: the founder and the members; an agent run only in its project.
grant select on office.project_repositories to office_app;
create policy visible on office.project_repositories for select to office_app
  using (office.row_visible(company_id, project_id));

-- Written through the API's role only: linked and unlinked, never rewritten (12 October decision
-- 17: the owner, the managers and the founder).
grant insert (company_id, project_id, integration_id, repository_id, full_name), delete
  on office.project_repositories to office_api_private;
create policy governors_link on office.project_repositories for insert to office_api_private
  with check (
    company_id = office.ctx_company_id() and office.ctx_agent_code() is null
    and (
      office.is_founder()
      or (office.is_insider() and office.project_role(project_id) in ('owner', 'manager'))
    )
  );
create policy governors_unlink on office.project_repositories for delete to office_api_private
  using (
    company_id = office.ctx_company_id() and office.ctx_agent_code() is null
    and (
      office.is_founder()
      or (office.is_insider() and office.project_role(project_id) in ('owner', 'manager'))
    )
  );

/*
 * May code-only work touch this project's repository (rule 12; docs/SONRA.md P-s): the project of
 * the context company has no customer, or its customer allows AI, or its customer allows
 * automated processing by code. False for a project of another company and for a caller who is
 * neither the founder nor a member of the project. Runs as office_trigger, which reads the two
 * permission columns.
 */
create function office.project_code_processing_allowed(p_project uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
  select coalesce((
    select p.customer_id is null or coalesce(c.ai_allowed or c.automated_processing_allowed, false)
    from office.projects p
    left join office.customers c on c.id = p.customer_id and c.company_id = p.company_id
    where p.id = p_project and p.company_id = office.ctx_company_id()
      and (office.is_founder() or office.is_project_member(p.id))
  ), false)
$$;
alter function office.project_code_processing_allowed(uuid) owner to office_trigger;
revoke execute on function office.project_code_processing_allowed(uuid) from public;
grant execute on function office.project_code_processing_allowed(uuid) to office_app;

create function office.check_project_repository() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  -- Migrations, the seed, an administrator.
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null then
    raise exception 'An agent run does not link a repository'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from office.integrations i
    where i.id = new.integration_id and i.company_id = new.company_id
      and i.provider = 'github' and i.status = 'enabled'
  ) then
    raise exception 'The repository comes through the company''s open GitHub connection'
      using errcode = 'check_violation';
  end if;
  if not office.project_code_processing_allowed(new.project_id) then
    raise exception 'The customer of this project allows neither AI nor automated processing'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  new.linked_by_user_id := office.ctx_user_id();
  new.linked_at := pg_catalog.now();
  return new;
end
$$;
revoke execute on function office.check_project_repository() from public;
create trigger check_project_repository before insert on office.project_repositories
  for each row execute function office.check_project_repository();

create function office.audit_project_repository() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    insert into office.audit_log
        (company_id, project_id, event, record_type, record_id, external_ref)
      values (new.company_id, new.project_id, 'project_repository_linked', 'project',
              new.project_id, 'github:repository:' || new.repository_id);
  else
    insert into office.audit_log
        (company_id, project_id, event, record_type, record_id, external_ref)
      values (old.company_id, old.project_id, 'project_repository_unlinked', 'project',
              old.project_id, 'github:repository:' || old.repository_id);
  end if;
  return null;
end
$$;
revoke execute on function office.audit_project_repository() from public;
create trigger audit_project_repository after insert or delete on office.project_repositories
  for each row execute function office.audit_project_repository();
