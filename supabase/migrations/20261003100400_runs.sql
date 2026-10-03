-- Agent runs and tool calls (rules 5, 9, 12; 2 October decision 13).
--
-- The worker opens a run in the agent context and updates it step by step; people only read it.
-- Visibility comes from the task or project it belongs to. Raw content (model input and output,
-- tool input and result) is deleted after 90 days, the summary stays (until the lawyer names
-- another period).

create table office.runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  task_id uuid,
  agent_code text not null references office.agent_definitions (code),
  card_version_id uuid not null,
  -- The run's identity: the requesting person, or the agent's owner for a scheduled job.
  user_id uuid not null references office.users (id),
  trigger_type text not null check (trigger_type in ('request', 'scheduled', 'event', 'handoff')),
  model text not null check (length(model) > 0),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'limit_reached', 'stopped')),
  -- Rule 5: internal work or project label; derived from the project column.
  label text not null generated always as (
    case when project_id is null then 'internal' else 'project' end
  ) stored,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  -- US dollars; model, tool and infrastructure share.
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  tool_call_count integer not null default 0 check (tool_call_count >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz check (finished_at >= started_at),
  duration_ms bigint generated always as (
    (extract(epoch from (finished_at - started_at)) * 1000)::bigint
  ) stored,
  error_code text check (error_code ~ '^[a-z][a-z0-9_]*$'),
  summary text,
  -- Raw content (decision 13).
  input jsonb,
  output jsonb,
  raw_retain_until timestamptz not null default now() + interval '90 days',
  raw_deleted_at timestamptz,
  unique (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (task_id, company_id) references office.tasks (id, company_id),
  foreign key (card_version_id, agent_code) references office.card_versions (id, agent_code)
);
create index runs_company_started_at on office.runs (company_id, started_at desc);
create index runs_task on office.runs (task_id) where task_id is not null;
create index runs_raw_retain_until on office.runs (raw_retain_until) where raw_deleted_at is null;

-- When a run is opened: the identity and the agent come from the context, the project context is
-- the run's project and the agent must be enabled in this company (a stopped agent takes no new
-- work). A run cannot be opened in a project without AI permission: such a project is not visible
-- in the agent context, so the row policy rejects it (rule 12).
create function office.check_run_start() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if office.ctx_agent_code() is null or new.agent_code is distinct from office.ctx_agent_code() then
    raise exception 'A run is opened only in its own agent context'
      using errcode = 'insufficient_privilege';
  end if;
  new.user_id := office.ctx_user_id();
  new.project_id := office.ctx_project_id();
  new.started_at := pg_catalog.now();
  new.raw_retain_until := pg_catalog.now() + interval '90 days';
  new.raw_deleted_at := null;
  if not exists (
    select 1 from office.company_agents sa
    where sa.company_id = new.company_id and sa.agent_code = new.agent_code
      and sa.status = 'enabled'
  ) then
    raise exception 'Agent % is not enabled in this company', new.agent_code
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger check_run_start before insert on office.runs
  for each row execute function office.check_run_start();
create trigger project_from_task before insert on office.runs
  for each row execute function office.inherit_project_scope('tasks', 'task_id', 'check');
create trigger immutable_columns before update on office.runs
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'task_id', 'agent_code', 'card_version_id', 'user_id',
    'trigger_type', 'started_at', 'raw_retain_until'
  );

create table office.tool_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- Comes from the run's project.
  project_id uuid,
  run_id uuid not null,
  seq integer not null check (seq > 0),
  tool_name text not null references office.tools (name),
  -- started: opened before the call is executed; an external effect call cannot be opened without
  -- approval (approvals migration).
  status text not null default 'started'
    check (status in ('started', 'succeeded', 'failed', 'sent_for_approval', 'blocked')),
  -- The approval record of a call that went to approval or is executed with approval (foreign key
  -- in the approvals migration).
  approval_id uuid,
  error_code text check (error_code ~ '^[a-z][a-z0-9_]*$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz check (finished_at >= started_at),
  duration_ms bigint generated always as (
    (extract(epoch from (finished_at - started_at)) * 1000)::bigint
  ) stored,
  -- Raw content (decision 13).
  input jsonb,
  result jsonb,
  raw_retain_until timestamptz not null default now() + interval '90 days',
  raw_deleted_at timestamptz,
  unique (run_id, seq),
  foreign key (run_id, company_id) references office.runs (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id)
);
create index tool_calls_raw_retain_until on office.tool_calls (raw_retain_until)
  where raw_deleted_at is null;

create function office.set_tool_call_defaults() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.started_at := pg_catalog.now();
  new.raw_retain_until := pg_catalog.now() + interval '90 days';
  new.raw_deleted_at := null;
  return new;
end
$$;
create trigger set_tool_call_defaults before insert on office.tool_calls
  for each row execute function office.set_tool_call_defaults();

-- The status only moves forward: sent_for_approval -> started or blocked; started -> succeeded or
-- failed. A finished call cannot be restarted; a retry is a new call.
create function office.check_tool_call_status() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'sent_for_approval' and new.status in ('started', 'blocked'))
    or (old.status = 'started' and new.status in ('succeeded', 'failed'))
  ) then
    raise exception 'Tool call cannot move from status % to status %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger check_tool_call_status before update on office.tool_calls
  for each row execute function office.check_tool_call_status();
create trigger project_from_run before insert on office.tool_calls
  for each row execute function office.inherit_project_scope('runs', 'run_id', 'derive');
create trigger immutable_columns before update on office.tool_calls
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'run_id', 'seq', 'tool_name', 'started_at', 'raw_retain_until'
  );

alter table office.runs enable row level security;
alter table office.runs force row level security;
alter table office.tool_calls enable row level security;
alter table office.tool_calls force row level security;

-- Run records are not deleted.
grant select, insert, update on office.runs, office.tool_calls to office_app;

-- Visibility comes from the row policy; writing only in the run's own agent context.
create policy visible on office.runs for select to office_app
  using (office.row_visible(company_id, project_id));
create policy agent_inserts on office.runs for insert to office_app
  with check (office.row_visible(company_id, project_id) and agent_code = office.ctx_agent_code());
create policy agent_updates on office.runs for update to office_app
  using (office.row_visible(company_id, project_id) and agent_code = office.ctx_agent_code());

create policy visible on office.tool_calls for select to office_app
  using (office.row_visible(company_id, project_id));
create policy agent_inserts on office.tool_calls for insert to office_app
  with check (
    office.row_visible(company_id, project_id)
    and exists (
      select 1 from office.runs c where c.id = run_id and c.agent_code = office.ctx_agent_code()
    )
  );
create policy agent_updates on office.tool_calls for update to office_app
  using (
    office.row_visible(company_id, project_id)
    and exists (
      select 1 from office.runs c where c.id = run_id and c.agent_code = office.ctx_agent_code()
    )
  );

-- Raw content purge (decision 13). The worker calls it once a day; no context is needed. It only
-- clears the raw columns of expired rows.
grant select (id, raw_retain_until, raw_deleted_at), update (input, output, raw_deleted_at)
  on office.runs to office_trigger;
grant select (id, raw_retain_until, raw_deleted_at), update (input, result, raw_deleted_at)
  on office.tool_calls to office_trigger;
-- The new version of an updated row must also pass the read policy; that is why reading is separate
-- and broad (the role can only read the columns above).
create policy trigger_reads on office.runs for select to office_trigger using (true);
create policy raw_purge on office.runs for update to office_trigger
  using (raw_retain_until <= now() and raw_deleted_at is null) with check (true);
create policy trigger_reads on office.tool_calls for select to office_trigger using (true);
create policy raw_purge on office.tool_calls for update to office_trigger
  using (raw_retain_until <= now() and raw_deleted_at is null) with check (true);

create function office.purge_raw_content() returns integer
  language plpgsql security definer set search_path = ''
  as $$
declare
  run_count integer;
  call_count integer;
begin
  update office.runs set input = null, output = null, raw_deleted_at = pg_catalog.now()
    where raw_retain_until <= pg_catalog.now() and raw_deleted_at is null;
  get diagnostics run_count = row_count;
  update office.tool_calls set input = null, result = null, raw_deleted_at = pg_catalog.now()
    where raw_retain_until <= pg_catalog.now() and raw_deleted_at is null;
  get diagnostics call_count = row_count;
  return run_count + call_count;
end
$$;
alter function office.purge_raw_content() owner to office_trigger;
revoke execute on function office.purge_raw_content() from public;
grant execute on function office.purge_raw_content() to office_app;
