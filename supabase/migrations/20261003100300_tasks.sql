-- Task records, comments, records shared with external people and work types (data of module M2;
-- 2 October decisions 6, 8, 11; metrics: completed work, missed due dates, routing accuracy, human
-- hours saved).

-- Today's (agent-free) duration of the work, for measuring the hours saved.
create table office.work_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  baseline_minutes integer check (baseline_minutes > 0),
  measurement_note text,
  unique (company_id, code),
  unique (id, company_id)
);

create table office.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  -- Parent task (technical field). How a subtask resolves is an open question (M31).
  parent_task_id uuid,
  unit_code text references office.units (code),
  -- Routing accuracy metric: the unit KOR-1 assigned first and whether it was corrected later.
  initial_unit_code text references office.units (code),
  routing_corrected boolean not null default false,
  title text not null check (length(trim(title)) > 0),
  description text,
  requester_user_id uuid references office.users (id),
  -- The assignee is a member of the company; if the membership is removed the assignment is
  -- cleared.
  assignee_user_id uuid,
  assignee_agent_code text references office.agent_definitions (code),
  status text not null default 'open'
    check (status in (
      'open', 'in_progress', 'awaiting_approval', 'awaiting_reply', 'done', 'cancelled'
    )),
  priority smallint not null default 3 check (priority between 1 and 4),
  due_at timestamptz,
  -- A task derived from external content (email, document, web): external. If a person assigns it
  -- to an agent it becomes internal.
  source_kind text not null default 'internal' check (source_kind in ('internal', 'external')),
  work_type_id uuid,
  -- The version approvals are based on (X1-7): incremented on every change other than status.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (parent_task_id, company_id) references office.tasks (id, company_id),
  foreign key (work_type_id, company_id) references office.work_types (id, company_id),
  foreign key (company_id, assignee_user_id) references office.memberships (company_id, user_id)
    on delete set null (assignee_user_id),
  constraint single_assignee check (assignee_user_id is null or assignee_agent_code is null),
  -- 2 October decision 8: a task from an external source cannot be assigned directly to an agent.
  constraint external_not_assigned_to_agent
    check (source_kind = 'internal' or assignee_agent_code is null)
);
create index tasks_company_status on office.tasks (company_id, status);
create index tasks_project on office.tasks (project_id) where project_id is not null;

create function office.check_task() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
begin
  -- Decision 8: if a person assigns an externally sourced task to an agent, the task counts as
  -- internal. An agent cannot do this: in an agent context an externally sourced task cannot be
  -- assigned to an agent (constraint) and cannot be marked internal.
  if new.source_kind = 'external' and new.assignee_agent_code is not null and agent is null then
    new.source_kind := 'internal';
  end if;
  if tg_op = 'UPDATE' then
    if agent is not null and old.source_kind = 'external' and new.source_kind = 'internal' then
      raise exception 'An agent cannot mark an externally sourced task as internal'
        using errcode = 'insufficient_privilege';
    end if;
    if (pg_catalog.to_jsonb(new) - array['status', 'updated_at', 'completed_at', 'version'])
       is distinct from
       (pg_catalog.to_jsonb(old) - array['status', 'updated_at', 'completed_at', 'version']) then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  else
    new.version := 1;
  end if;
  new.updated_at := pg_catalog.now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := pg_catalog.now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end
$$;
create trigger check_task before insert or update on office.tasks
  for each row execute function office.check_task();
-- The project scope does not change: comments, runs and approvals take the scope from the task when
-- they are opened.
create trigger immutable_columns before update on office.tasks
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'created_at'
  );

create table office.task_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- Comes from the task's project.
  project_id uuid,
  task_id uuid not null,
  author_user_id uuid references office.users (id),
  author_agent_code text references office.agent_definitions (code),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  foreign key (task_id, company_id) references office.tasks (id, company_id) on delete cascade,
  foreign key (project_id, company_id) references office.projects (id, company_id),
  constraint single_author check ((author_user_id is null) <> (author_agent_code is null))
);
create index task_comments_task on office.task_comments (task_id);

-- The author comes from the context: the agent in an agent run, otherwise the person.
create function office.set_comment_author() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.author_agent_code := office.ctx_agent_code();
  new.author_user_id := case when new.author_agent_code is null then office.ctx_user_id() end;
  new.created_at := pg_catalog.now();
  return new;
end
$$;
create trigger inherit_project before insert on office.task_comments
  for each row execute function office.inherit_project_scope('tasks', 'task_id', 'derive');
create trigger set_comment_author before insert on office.task_comments
  for each row execute function office.set_comment_author();

-- Tasks and notes shared with an external person (accountant, lawyer). Only the founder shares.
create table office.access_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  user_id uuid not null,
  record_type text not null check (record_type in ('task', 'note')),
  record_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, record_type, record_id),
  foreign key (company_id, user_id) references office.memberships (company_id, user_id)
    on delete cascade
);

grant select on office.access_grants to office_auth_reader;

-- Can the external person access this record (has it been shared with them).
create function office.is_shared_with_me(p_type text, p_record uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from office.access_grants ep
      where ep.user_id = office.ctx_user_id()
        and ep.company_id = office.ctx_company_id()
        and ep.record_type = p_type
        and ep.record_id = p_record
    )
  $$;
alter function office.is_shared_with_me(text, uuid) owner to office_auth_reader;
grant execute on function office.is_shared_with_me(text, uuid) to office_app;

-- Is the context person an external person (not an agent run).
create function office.is_external() returns boolean
  language sql stable set search_path = ''
  as $$
    select coalesce(office.my_role() = 'external', false) and office.ctx_agent_code() is null
  $$;
grant execute on function office.is_external() to office_app;

alter table office.work_types enable row level security;
alter table office.work_types force row level security;
alter table office.tasks enable row level security;
alter table office.tasks force row level security;
alter table office.task_comments enable row level security;
alter table office.task_comments force row level security;
alter table office.access_grants enable row level security;
alter table office.access_grants force row level security;

grant select, insert, update, delete on office.work_types, office.access_grants to office_app;
-- A task is not deleted, it is cancelled; comments are neither changed nor deleted.
grant select, insert, update on office.tasks to office_app;
grant select, insert on office.task_comments to office_app;

create policy tenant_isolation on office.work_types for all to office_app
  using (office.row_visible(company_id, null))
  with check (office.row_visible(company_id, null));

create policy tenant_isolation on office.tasks for all to office_app
  using (office.row_visible(company_id, project_id))
  with check (office.row_visible(company_id, project_id));
-- An external person sees only the tasks the founder shared with them (cannot change them).
-- Assignment alone does not share the task: sharing with an external person is an external effect
-- and only the founder does it (access_grants).
create policy external_reads on office.tasks for select to office_app
  using (
    company_id = office.ctx_company_id()
    and office.is_external()
    and office.is_shared_with_me('task', id)
  );

create policy tenant_isolation on office.task_comments for all to office_app
  using (office.row_visible(company_id, project_id))
  with check (office.row_visible(company_id, project_id));
-- An external person sees the comments of a task shared with them and adds comments in their own
-- name.
create policy external_reads on office.task_comments for select to office_app
  using (
    company_id = office.ctx_company_id()
    and office.is_external()
    and exists (select 1 from office.tasks g where g.id = task_id)
  );
create policy external_writes on office.task_comments for insert to office_app
  with check (
    company_id = office.ctx_company_id()
    and office.is_external()
    and author_user_id = office.ctx_user_id()
    and exists (select 1 from office.tasks g where g.id = task_id)
  );

-- The founder manages sharing; an external person sees their own grants.
create policy founder_manages on office.access_grants for all to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );
create policy own_grants on office.access_grants for select to office_app
  using (user_id = office.ctx_user_id() and company_id = office.ctx_company_id());
create policy reader on office.access_grants for select to office_auth_reader using (true);
