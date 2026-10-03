-- Append-only event log (rule 5; 2 October decision 13).
--
-- Only identifiers are written: who (person or agent), which run, which event, which tool, which
-- record and the source id in the external system. No free text or summary is written; raw content
-- and summaries live in the `runs` table under the retention period. A row can be neither updated
-- nor deleted.

create table office.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references office.companies (id),
  project_id uuid,
  occurred_at timestamptz not null default now(),
  user_id uuid references office.users (id),
  agent_code text references office.agent_definitions (code),
  run_id uuid,
  event text not null check (event ~ '^[a-z][a-z0-9_]{1,62}$'),
  tool_name text references office.tools (name),
  record_type text check (record_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  record_id uuid,
  -- A Gmail message id, a Drive file id, a source address and the like; takes no spaces or free
  -- text.
  external_ref text check (external_ref ~ '^[A-Za-z0-9_.:/-]{1,255}$'),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (run_id, company_id) references office.runs (id, company_id),
  constraint record_complete check ((record_type is null) = (record_id is null))
);
create index audit_log_company_occurred_at on office.audit_log (company_id, occurred_at desc);
create index audit_log_run on office.audit_log (run_id) where run_id is not null;

-- Who and when come from the context; the caller cannot change them.
create function office.set_audit_fields() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.occurred_at := pg_catalog.now();
  new.user_id := office.ctx_user_id();
  new.agent_code := office.ctx_agent_code();
  return new;
end
$$;
create trigger set_audit_fields before insert on office.audit_log
  for each row execute function office.set_audit_fields();

-- Update, delete and truncate are rejected at database level (for the privileged role too).
create function office.reject_audit_change() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  raise exception 'audit_log cannot be changed or deleted' using errcode = 'insufficient_privilege';
end
$$;
create trigger immutable_columns before update or delete on office.audit_log
  for each row execute function office.reject_audit_change();
create trigger no_truncate before truncate on office.audit_log
  for each statement execute function office.reject_audit_change();

alter table office.audit_log enable row level security;
alter table office.audit_log force row level security;

grant select, insert on office.audit_log to office_app;

-- Every member's request and every agent run of a company writes to its own company; the founder
-- reads the log.
create policy inserts on office.audit_log for insert to office_app
  with check (company_id = office.ctx_company_id() and office.my_role() is not null);
create policy founder_reads on office.audit_log for select to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );
