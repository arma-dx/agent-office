-- Files a person adds to a project (8 October decisions 11, 20 and 21; 11 October decision 2;
-- docs/SONRA.md P-g, P-k, P-l, P4-a to P4-v; CLAUDE.md rules 1, 2 and 9).
--
-- office.files was opened for what agents produce (2 October decision 9): the file itself is in
-- storage, and storage is reached only after this record's row policy let the caller read the
-- record (rule 9). A file a person adds to a project is the same kind of record, so it is a row
-- of the same table; from here on a row says which of the two it is:
--   agent_output   as before: a file written in or for an agent run. Nothing writes one yet.
--   project_file   a file a person added to a project through the API.
--
-- A project file:
--   - is read by the founder and by the project's members and added by them (P-k). It is deleted
--     by the person who added it, by the owner and the managers of the project, and by the founder
--     (11 October decision 2, which widened P-k). Only through the API's role: the worker's role
--     and every agent run see no project file and write none (reading by agents is a later step,
--     decision 21);
--   - is never an external person's to read (P-k); nothing shares it;
--   - is not changed after it was added (no update grant exists on the table): no versions (P-k);
--   - has one of eleven fixed types and at most 25 MB (decision 20); a project holds at most 200
--     files and 1 GB of them (P4-d);
--   - lies in storage under a key the DATABASE writes: <company>/projects/<project>/<file id>.
--     The name a person gave the file is only a column; no part of it is in the key;
--   - leaves a row in audit_log when it is added and when it is deleted (P-l): the event and ids,
--     never the name (2 October decision 13).
--
-- Error codes: 42501 not allowed (also a row the policy refuses); 23514 a rule of the record;
-- 54000 a limit of the project, with the constraint name project_files_count_limit or
-- project_files_size_limit; 23505 the id is taken.

alter table office.files
  add column kind text not null default 'agent_output'
    constraint files_kind_check check (kind in ('agent_output', 'project_file'));

alter table office.files
  add constraint files_project_file_shape check (
    kind <> 'project_file'
    or (
      project_id is not null
      and task_id is null
      and run_id is null
      and created_by_agent_code is null
      and sha256 is not null
      and size_bytes between 1 and 26214400
      and mime_type in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv', 'text/plain', 'text/markdown',
        'image/png', 'image/jpeg', 'image/gif', 'image/webp'
      )
      and name = btrim(name)
      and char_length(name) between 1 and 200
      and name !~ '[[:cntrl:]/\\]'
      and storage_path = company_id::text || '/projects/' || project_id::text || '/' || id::text
    )
  );

-- The keys under <company>/projects/ belong to project files alone. An agent output never lies
-- there: a run, or a person through the old policy, cannot name the key of a project file that
-- exists, will exist or left bytes behind (an agent output's key is free text under the company).
alter table office.files
  add constraint files_agent_output_key check (
    kind <> 'agent_output' or storage_path not like company_id::text || '/projects/%'
  );

-- The list of a project's files, newest first.
create index files_project_files on office.files (project_id, created_at desc, id)
  where kind = 'project_file';

/*
 * A project file added by a person: the storage key is written here, from the row's own company,
 * project and id, whatever the insert named; and the project's two limits are held. Runs with the
 * caller's rights, before the row policy looks at the row: a caller the policy then refuses has
 * learned nothing (they count no row they cannot read). One upload at a time per project (an
 * advisory lock until the transaction ends), so two uploads cannot both pass the limits.
 * A row written without a person in the context (an administrator) is left as it is; the shape
 * check still holds.
 */
create function office.check_project_file() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_count integer;
  v_bytes bigint;
begin
  if new.kind <> 'project_file' then
    return new;
  end if;
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null or office.ctx_user_id() is null then
    raise exception 'A project file is added by a person' using errcode = 'insufficient_privilege';
  end if;
  if new.project_id is null or new.id is null or new.size_bytes is null then
    raise exception 'A project file names its project and its size'
      using errcode = 'check_violation';
  end if;
  new.storage_path :=
    new.company_id::text || '/projects/' || new.project_id::text || '/' || new.id::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('office.project_files:' || new.project_id::text, 0)
  );
  select pg_catalog.count(*), coalesce(pg_catalog.sum(f.size_bytes), 0)
    into v_count, v_bytes
    from office.files f
    where f.project_id = new.project_id and f.kind = 'project_file';
  if v_count >= 200 then
    raise exception 'A project holds at most 200 files'
      using errcode = 'program_limit_exceeded', constraint = 'project_files_count_limit';
  end if;
  if v_bytes + new.size_bytes > 1073741824 then
    raise exception 'The files of a project take at most 1 GB'
      using errcode = 'program_limit_exceeded', constraint = 'project_files_size_limit';
  end if;
  return new;
end
$$;
revoke execute on function office.check_project_file() from public;
create trigger check_project_file before insert on office.files
  for each row execute function office.check_project_file();

-- Who reads and writes --------------------------------------------------------------------------

-- The policy of the table as of the notes migration (20261003100500), now for agent outputs
-- only: the worker's role and an agent run keep what they had and get nothing of a project file.
drop policy tenant_isolation on office.files;
create policy tenant_isolation on office.files for all to office_app
  using (kind = 'agent_output' and office.row_visible(company_id, project_id))
  with check (kind = 'agent_output' and office.row_visible(company_id, project_id));

-- P-k: the founder and the members of the project read its files. office.row_visible holds the
-- company, the insider and the membership; an agent run is refused before it is asked.
create policy project_file_reads on office.files for select to office_api_private
  using (
    kind = 'project_file'
    and office.ctx_agent_code() is null
    and office.row_visible(company_id, project_id)
  );
-- ... and add one, in their own name.
create policy project_file_adds on office.files for insert to office_api_private
  with check (
    kind = 'project_file'
    and office.ctx_agent_code() is null
    and office.row_visible(company_id, project_id)
    and created_by_user_id = office.ctx_user_id()
  );
-- 11 October decision 2: the person who added the file, the owner and the managers of the
-- project (each while they still read the project), or the founder.
create policy project_file_deletes on office.files for delete to office_api_private
  using (
    kind = 'project_file'
    and office.ctx_agent_code() is null
    and office.row_visible(company_id, project_id)
    and (
      office.is_founder()
      or created_by_user_id = office.ctx_user_id()
      or coalesce(office.project_role(project_id) in ('owner', 'manager'), false)
    )
  );

-- The trace -------------------------------------------------------------------------------------

--   project_file_added, project_file_deleted
--                                  project_id: the project; record: the file (record_type file)
-- Written by a trigger with the caller's rights, like the project events: who and when come from
-- the context.
create function office.audit_project_file() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'project_file' then
      insert into office.audit_log (company_id, project_id, event, record_type, record_id)
        values (new.company_id, new.project_id, 'project_file_added', 'file', new.id);
    end if;
  elsif old.kind = 'project_file' then
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (old.company_id, old.project_id, 'project_file_deleted', 'file', old.id);
  end if;
  return null;
end
$$;
revoke execute on function office.audit_project_file() from public;
create trigger audit_project_file after insert or delete on office.files
  for each row execute function office.audit_project_file();
