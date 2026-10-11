-- The runs of a project, newest first (8 October decision 17; docs/SONRA.md P-t).
--
-- The project page lists the agent runs of its project and adds up their recorded cost. Nothing
-- of who reads a run changes: the row policy of office.runs (office.row_visible) shows a run of a
-- project to the founder and to the members of that project. Tokens and cost are the founder's to
-- read (P-t); the statement that lists the runs leaves them out for everybody else.
--
-- One index: the list and the sum are asked by project. Until now runs were found by company and
-- time or by task.
create index runs_project_started on office.runs (project_id, started_at desc, id desc)
  where project_id is not null;
