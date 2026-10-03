-- Station candidate records (P-IST-1's sandbox, rule 4) and company integrations.

create table office.station_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- The source's name or address and the record id at the source.
  source text not null check (length(trim(source)) > 0),
  source_record_id text,
  name text,
  address text,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  operator text,
  connector_types text[] not null default '{}',
  power_kw numeric(7, 2) check (power_kw > 0),
  access text,
  -- The date of the data at the source.
  data_date date,
  is_closed boolean not null default false,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  -- The id of the matching station record in the Pillika application.
  matched_record text,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (run_id, company_id) references office.runs (id, company_id)
);
create index station_candidates_matched_record
  on office.station_candidates (company_id, matched_record)
  where matched_record is not null;
create trigger set_updated_at before update on office.station_candidates
  for each row execute function office.set_updated_at();
create trigger immutable_columns before update on office.station_candidates
  for each row execute function office.prevent_column_changes('company_id', 'created_at');

-- Integration settings and grants, per company. The token is encrypted at application level; the
-- decryption key exists only in the worker environment, only the encrypted form is stored here.
create table office.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]*$'),
  -- The account that set up the integration (e.g. a Google account); an account name, not a person.
  account text,
  scopes text[] not null default '{}',
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  encrypted_token bytea,
  status text not null default 'disabled' check (status in ('disabled', 'enabled', 'error')),
  connected_by_user_id uuid references office.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (company_id, provider, account)
);
create trigger set_updated_at before update on office.integrations
  for each row execute function office.set_updated_at();
create trigger immutable_columns before update on office.integrations
  for each row execute function office.prevent_column_changes(
    'company_id', 'provider', 'created_at'
  );

alter table office.station_candidates enable row level security;
alter table office.station_candidates force row level security;
alter table office.integrations enable row level security;
alter table office.integrations force row level security;

grant select, insert, update, delete on office.station_candidates, office.integrations
  to office_app;

create policy tenant_isolation on office.station_candidates for all to office_app
  using (office.row_visible(company_id, null))
  with check (office.row_visible(company_id, null));

-- The founder manages integrations; an agent run (worker) reads its own company's integration.
create policy founder_manages on office.integrations for all to office_app
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );
create policy agent_reads on office.integrations for select to office_app
  using (office.row_visible(company_id, null) and office.ctx_agent_code() is not null);
