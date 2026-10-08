-- The fields of the Projects section, step 1 (8 October decisions 16 and 17; docs/SONRA.md P-c,
-- P-h).
--
-- A project gets a description, one of five statuses, a colour and an icon from fixed sets, a
-- target date and the person who opened it. The two old statuses give way to the five of decision
-- 17: backlog, planned, in_progress, completed, cancelled ("beklemede, planlandı, sürüyor,
-- tamamlandı, iptal"). "completed" and "cancelled" close a project (P-c); the generated column
-- `closed` is the one place that says so. A project is never deleted (P-h): it is closed and can
-- be set back to an open status.
--
-- Existing rows: "closed" becomes "completed", "open" becomes "in_progress" (an open project was
-- one that was under way). No statement anywhere read the old values. New rows start "planned".
--
-- A customer's name is kept trimmed and is unique inside its company, whatever the letter case: a
-- project dialog adds customers by name, and two rows for one customer would carry two different
-- contract permissions.

alter table office.projects drop constraint projects_status_check;
update office.projects set status = case status when 'closed' then 'completed' else 'in_progress' end;
alter table office.projects alter column status set default 'planned';
alter table office.projects add constraint projects_status_check
  check (status in ('backlog', 'planned', 'in_progress', 'completed', 'cancelled'));
-- P-c: the two closing statuses, in one place. Stored, so that a later step can index it.
alter table office.projects
  add column closed boolean generated always as (status in ('completed', 'cancelled')) stored;

alter table office.projects
  add column description text,
  add column color text not null default 'gray',
  add column icon text not null default 'folder',
  add column target_date date,
  -- Null for a row written without a person in the context (the seed, an administrator).
  add column created_by_user_id uuid references office.users (id),
  add constraint projects_name_shape
    check (name = btrim(name) and char_length(name) between 1 and 120),
  add constraint projects_description_shape
    check (description is null or char_length(description) between 1 and 5000),
  add constraint projects_color_check
    check (color in ('gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink')),
  add constraint projects_icon_check
    check (icon in (
      'folder', 'briefcase', 'code', 'globe', 'megaphone', 'wrench', 'chart', 'document', 'pin',
      'bolt', 'people', 'box'
    ));

alter table office.customers
  add constraint customers_name_shape
    check (name = btrim(name) and char_length(name) between 1 and 120);
create unique index customers_company_name on office.customers (company_id, lower(name));
