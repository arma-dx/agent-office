-- Institutional memory: notes, their versions and links; documents from Drive and generated files
-- (rule 4; 2 October decisions 7, 8, 9; 3 October decision 1).
--
-- A note works like Obsidian: folder path, title, YAML properties, markdown body, `[[Note title]]`
-- links. Versions and links are written by a trigger when the note is saved; the application only
-- reads these two tables.

create table office.notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  folder text not null default '' check (folder !~ '(^/|/$|//|(^|/)\.\.?(/|$))'),
  -- An Obsidian link title cannot contain [ ] | # ^.
  title text not null check (length(trim(title)) > 0 and title !~ '[][|#^]'),
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  body text not null default '',
  -- Decision 7. A Y1 agent's note opens as a draft and is shared after approval.
  status text not null default 'draft'
    check (status in ('draft', 'active', 'outdated', 'archived')),
  -- Decision 7: only the founder sets and clears the flag. Changing a flagged note is an external
  -- effect (rule 4): it is rejected in an agent context and the change is applied in the founder's
  -- context after approval.
  is_source_of_truth boolean not null default false,
  -- Decision 8: a note derived from external content.
  source_kind text not null default 'internal' check (source_kind in ('internal', 'external')),
  version integer not null default 1,
  created_by_user_id uuid references office.users (id),
  created_by_agent_code text references office.agent_definitions (code),
  updated_by_user_id uuid references office.users (id),
  updated_by_agent_code text references office.agent_definitions (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('turkish'::regconfig, title), 'A')
    || setweight(to_tsvector('turkish'::regconfig, body), 'B')
  ) stored,
  unique (id, company_id),
  -- Unique within a project; another project's note cannot be probed by trying to insert.
  unique nulls not distinct (company_id, project_id, folder, title),
  foreign key (project_id, company_id) references office.projects (id, company_id)
);
create index notes_search_vector on office.notes using gin (search_vector);
create index notes_title on office.notes (company_id, lower(title));

create function office.check_note() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
  person uuid := case when office.ctx_agent_code() is null then office.ctx_user_id() end;
begin
  if tg_op = 'DELETE' then
    if agent is not null then
      raise exception 'An agent cannot delete a note; deletion goes to approval'
        using errcode = 'insufficient_privilege';
    end if;
    if old.is_source_of_truth and not office.is_founder() then
      raise exception 'Only the founder deletes a source of truth note'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if (tg_op = 'INSERT' and new.is_source_of_truth)
     or (tg_op = 'UPDATE' and new.is_source_of_truth is distinct from old.is_source_of_truth) then
    if agent is not null or not office.is_founder() then
      raise exception 'Only the founder sets and clears the source of truth flag'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by_agent_code := agent;
    -- An agent's note also keeps the run's identity (on whose behalf it was written).
    new.created_by_user_id := office.ctx_user_id();
    new.created_at := pg_catalog.now();
    new.version := 1;
  else
    if agent is not null then
      if old.is_source_of_truth then
        raise exception 'An agent cannot change a source of truth note; the change goes to approval'
          using errcode = 'insufficient_privilege';
      end if;
      if new.status = 'archived' and old.status <> 'archived' then
        raise exception 'An agent cannot archive a note; archiving goes to approval'
          using errcode = 'insufficient_privilege';
      end if;
      if old.source_kind = 'external' and new.source_kind = 'internal' then
        raise exception 'An agent cannot mark an externally sourced note as internal'
          using errcode = 'insufficient_privilege';
      end if;
      -- A draft note is shared after approval; the person who approves takes it out of draft
      -- (3 October, decision 1).
      if old.status = 'draft' and new.status <> 'draft' then
        raise exception 'An agent cannot share a draft note; the note is shared after approval'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    if (pg_catalog.to_jsonb(new) - array['version', 'updated_at', 'updated_by_user_id',
          'updated_by_agent_code', 'search_vector'])
       is not distinct from (pg_catalog.to_jsonb(old) - array['version', 'updated_at',
          'updated_by_user_id', 'updated_by_agent_code', 'search_vector']) then
      new.version := old.version;
      new.updated_at := old.updated_at;
      new.updated_by_agent_code := old.updated_by_agent_code;
      new.updated_by_user_id := old.updated_by_user_id;
      return new;
    end if;
    new.version := old.version + 1;
  end if;
  new.updated_by_agent_code := agent;
  new.updated_by_user_id := person;
  new.updated_at := pg_catalog.now();
  return new;
end
$$;
create trigger check_note before insert or update or delete on office.notes
  for each row execute function office.check_note();
create trigger immutable_columns before update on office.notes
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'created_at', 'created_by_user_id', 'created_by_agent_code'
  );

-- The full state of every version. When a note is deleted its versions are deleted too (personal
-- data deletion request, N36).
create table office.note_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  note_id uuid not null,
  version integer not null,
  project_id uuid,
  folder text not null,
  title text not null,
  properties jsonb not null,
  body text not null,
  status text not null,
  is_source_of_truth boolean not null,
  source_kind text not null,
  author_user_id uuid references office.users (id),
  author_agent_code text references office.agent_definitions (code),
  created_at timestamptz not null default now(),
  unique (note_id, version),
  foreign key (note_id, company_id) references office.notes (id, company_id) on delete cascade
);

-- The `[[Target]]`, `[[Target#Heading]]`, `[[Target|Shown]]` links in the body and properties. The
-- target is kept by title (as in Obsidian); a backlink is found by matching the title.
create table office.note_links (
  company_id uuid not null references office.companies (id),
  source_note_id uuid not null,
  target_title text not null check (length(target_title) between 1 and 500),
  primary key (source_note_id, target_title),
  foreign key (source_note_id, company_id) references office.notes (id, company_id)
    on delete cascade
);
create index note_links_target_title on office.note_links (company_id, lower(target_title));

grant insert on office.note_versions to office_trigger;
grant select, insert, delete on office.note_links to office_trigger;

-- Writing versions and links. The trigger function cannot be called directly; the application
-- cannot write to these tables.
create function office.record_note_version() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    return null;
  end if;
  insert into office.note_versions (
    company_id, note_id, version, project_id, folder, title, properties, body, status,
    is_source_of_truth, source_kind, author_user_id, author_agent_code
  ) values (
    new.company_id, new.id, new.version, new.project_id, new.folder, new.title, new.properties,
    new.body, new.status, new.is_source_of_truth, new.source_kind, new.updated_by_user_id,
    new.updated_by_agent_code
  );
  if tg_op = 'INSERT' or new.body is distinct from old.body
     or new.properties is distinct from old.properties then
    delete from office.note_links where source_note_id = new.id;
    insert into office.note_links (company_id, source_note_id, target_title)
      select distinct new.company_id, new.id, pg_catalog.left(pg_catalog.btrim(m[1]), 500)
      from pg_catalog.regexp_matches(
        new.body || ' ' || new.properties::text,
        '\[\[([^][|#^]+)(#[^][|]*)?(\|[^][]*)?\]\]',
        'g'
      ) as m
      where pg_catalog.btrim(m[1]) <> '';
  end if;
  return null;
end
$$;
alter function office.record_note_version() owner to office_trigger;
create trigger record_note_version after insert or update on office.notes
  for each row execute function office.record_note_version();

create policy trigger_writes on office.note_versions for insert to office_trigger
  with check (true);
create policy trigger_writes on office.note_links for all to office_trigger
  using (true) with check (true);

-- Source files from Drive; each is linked to a source note, and the project scope comes from the
-- note.
create table office.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  name text not null,
  mime_type text,
  drive_modified_at timestamptz,
  source_note_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, drive_file_id),
  foreign key (source_note_id, company_id) references office.notes (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id)
);
create trigger project_from_note before insert on office.documents
  for each row execute function office.inherit_project_scope('notes', 'source_note_id', 'derive');
create trigger set_updated_at before update on office.documents
  for each row execute function office.set_updated_at();
create trigger immutable_columns before update on office.documents
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'drive_file_id', 'source_note_id'
  );

-- Decision 9: PDFs and images produced by agents. The file itself is in storage and its path starts
-- with the company id; access to storage is granted only after passing this record's row policy
-- (rule 9).
create table office.files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  task_id uuid,
  run_id uuid,
  name text not null check (length(trim(name)) > 0),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  created_by_user_id uuid references office.users (id),
  created_by_agent_code text references office.agent_definitions (code),
  created_at timestamptz not null default now(),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (task_id, company_id) references office.tasks (id, company_id),
  foreign key (run_id, company_id) references office.runs (id, company_id),
  constraint storage_path_in_company check (
    storage_path like company_id::text || '/%' and storage_path !~ '(^|/)\.\.?(/|$)'
  )
);

create function office.set_creator() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.created_by_agent_code := office.ctx_agent_code();
  new.created_by_user_id := case
    when new.created_by_agent_code is null then office.ctx_user_id()
  end;
  new.created_at := pg_catalog.now();
  return new;
end
$$;
create trigger set_creator before insert on office.files
  for each row execute function office.set_creator();
create trigger project_1_from_run before insert on office.files
  for each row execute function office.inherit_project_scope('runs', 'run_id', 'derive');
create trigger project_2_from_task before insert on office.files
  for each row execute function office.inherit_project_scope('tasks', 'task_id', 'check');

/*
 * An agent's draft note is visible until approval only to those who can approve (3 October,
 * decision 1).
 *
 * The note an agent writes opens as a draft and is shared after approval (PLAN, Authority levels).
 * Until approval:
 * - among people, only the founder and employees given the right to approve see it (even if it was
 *   shared with an external person);
 * - among agent runs, only the agent that wrote the note sees it, and only if the run's identity
 *   can approve or the note was written on behalf of that identity (the run cannot exceed its
 *   identity's limits);
 * - the project scope applies as well.
 * A draft note written by a person is not covered by this rule. The note's versions and links
 * follow the note's visibility; a document linked to a draft source note and an approval record
 * based on a draft note (it carries the draft's text) are visible to the same people.
 */
create function office.draft_visible(p_status text, p_creator_agent text, p_creator_user uuid)
  returns boolean
  language sql stable set search_path = ''
  as $$
    select p_status <> 'draft'
      or p_creator_agent is null
      or case
        when office.ctx_agent_code() is not null then
          p_creator_agent = office.ctx_agent_code()
          and (office.can_approve() or p_creator_user = office.ctx_user_id())
        else office.can_approve()
      end
  $$;
grant execute on function office.draft_visible(text, text, uuid) to office_app, office_auth_reader;

alter table office.notes enable row level security;
alter table office.notes force row level security;
alter table office.note_versions enable row level security;
alter table office.note_versions force row level security;
alter table office.note_links enable row level security;
alter table office.note_links force row level security;
alter table office.documents enable row level security;
alter table office.documents force row level security;
alter table office.files enable row level security;
alter table office.files force row level security;

grant select, insert, delete, update (
  folder, title, properties, body, status, is_source_of_truth, source_kind
) on office.notes to office_app;
grant select on office.note_versions, office.note_links to office_app;
grant select, insert, update, delete on office.documents to office_app;
-- A generated file record is not changed; deletion is allowed for personal data requests.
grant select, insert, delete on office.files to office_app;

create policy tenant_isolation on office.notes for all to office_app
  using (
    office.row_visible(company_id, project_id)
    and office.draft_visible(status, created_by_agent_code, created_by_user_id)
  )
  with check (
    office.row_visible(company_id, project_id)
    and office.draft_visible(status, created_by_agent_code, created_by_user_id)
  );
-- An external person sees a note shared with them (cannot change it).
create policy external_reads on office.notes for select to office_app
  using (
    company_id = office.ctx_company_id()
    and office.is_external()
    and office.is_shared_with_me('note', id)
    and office.draft_visible(status, created_by_agent_code, created_by_user_id)
  );

-- Versions and links follow the note's visibility.
create policy note_visible on office.note_versions for select to office_app
  using (
    company_id = office.ctx_company_id()
    and exists (select 1 from office.notes n where n.id = note_id)
  );
create policy note_visible on office.note_links for select to office_app
  using (
    company_id = office.ctx_company_id()
    and exists (select 1 from office.notes n where n.id = source_note_id)
  );

-- A document follows the visibility of its source note.
create policy tenant_isolation on office.documents for all to office_app
  using (
    office.row_visible(company_id, project_id)
    and exists (select 1 from office.notes n where n.id = source_note_id)
  )
  with check (
    office.row_visible(company_id, project_id)
    and exists (select 1 from office.notes n where n.id = source_note_id)
  );

create policy tenant_isolation on office.files for all to office_app
  using (office.row_visible(company_id, project_id))
  with check (office.row_visible(company_id, project_id));
