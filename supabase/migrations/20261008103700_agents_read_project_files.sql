-- Agents read the files of a project (8 October decision 21; 11 October decisions 2 to 4;
-- CLAUDE.md rules 5, 7, 9 and 12; docs/SONRA.md P6-a to P6-r).
--
-- Until now no agent run and not the worker's role saw a project file (the project files
-- migration, 20261008103100). From here on an agent run reads the RECORDS of the project files of
-- its own project; the bytes are read by the worker's narrow file module, only for a record this
-- policy showed to the run (rule 9).
--
-- A run is shown a project file only when all of this holds:
--   - it is an agent run (app.agent_code is set) of the context company;
--   - the file is in the project of the run's context: a run without a project is shown none,
--     and a run in a project is shown nothing of any other;
--   - agents may work in that project now (rule 12): office.row_visible asks the projects
--     policy, which shows a project to a run only while its AI permission is open and, if it
--     has a customer, the customer's contract allows AI. The moment a permission is closed the
--     records are hidden, like every other row of the project;
--   - the run goes as an insider who may read the project (the founder or a member), as for
--     every project row;
--   - the agent's current card version names the tool read_project_file. A run of any other
--     agent (the coordinator, an agent whose card lacks the tool) is shown no file, whatever
--     its runner does. The row policy cannot know which version a run was opened with (the
--     context carries no run), so it reads the agent's current version: a sync that takes the
--     tool off a card hides the files from that agent's open runs at once.
-- Nothing else changes: a run adds no project file, deletes none and changes none (no policy of
-- the worker's role allows it, and office.check_project_file refuses an agent's insert); a
-- person reads through the API's policies as before.
--
-- When the malware scanner of the server exists (11 October decision 4; KALAN-ISLER 0.7), a file
-- it refused must be hidden here: this policy is the one place an agent's reading is opened.
--
-- No new error code.

/*
 * Does the card of the context's agent name the tool that reads project files. Reads the two
 * global tables (no company data); runs with the caller's rights. False without an agent in the
 * context and for an agent without a card version.
 */
create function office.run_reads_project_files() returns boolean
  language sql stable set search_path = ''
  as $$
    select exists (
      select 1
      from office.agent_definitions d
      join office.card_versions v on v.id = d.current_version_id
      where d.code = office.ctx_agent_code()
        and v.content -> 'card' -> 'tools' ? 'read_project_file'
    )
  $$;
revoke execute on function office.run_reads_project_files() from public;
grant execute on function office.run_reads_project_files() to office_app;

create policy project_file_run_reads on office.files for select to office_app
  using (
    kind = 'project_file'
    and office.ctx_agent_code() is not null
    and project_id = office.ctx_project_id()
    and office.row_visible(company_id, project_id)
    and office.run_reads_project_files()
  );
