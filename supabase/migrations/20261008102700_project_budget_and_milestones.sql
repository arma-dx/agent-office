-- The budget and the milestones of a project (8 October decision 17; docs/SONRA.md P-t, P1-o,
-- P3-a to P3-f; CLAUDE.md rules 2 and 9).
--
-- The two columns exist since the first data model (projects.budget, projects.milestones) and were
-- in nobody's grant: "their step gives them their own path". This is that step.
--
--   budget      the money of the project (docs/SONRA.md P-t), never the cost of AI: an amount and
--               its currency, both or neither. Changed by the owner of the project, its managers
--               and the founder of the company (decision 44 names who governs a project; a plain
--               member does not change its money). The trigger below holds the rule for every
--               role; the row policy "member_edits" alone would let every member write it.
--   milestones  a list of at most 50 entries, each { id, name, date, done }: a name, an optional
--               day and whether it is reached. Changed by whoever changes the other fields of a
--               project (the row policy "member_edits": its members and the founder). The check
--               below holds the shape for every writer.
-- Who READS a project does not change. The budget is not hidden by the database from a member who
-- reads the row; the API gives the amount only to those who may change it (as for a customer's
-- fields, docs/SONRA.md P1-e).
--
-- Error codes: 42501 a budget change by anybody but the owner, a manager or the founder; 23514 a
-- budget without a currency (or the other way round), an amount that is not a number above zero,
-- a milestone list of another shape.

alter table office.projects
  add column budget_currency text
    constraint projects_budget_currency_check check (budget_currency in ('TRY', 'USD', 'EUR')),
  -- numeric takes 'NaN', and 'NaN' > 0 is true: it is named, so that a budget is a number.
  add constraint projects_budget_shape
    check (
      (budget is null) = (budget_currency is null)
      and (budget is null or (budget > 0 and budget <> 'NaN'::numeric))
    );

/*
 * Is this the list of milestones a project may hold: an array of at most 50 objects, each with
 * exactly the keys id (a lower-case uuid, unique in the list), name (trimmed, 1 to 120
 * characters), date (null or a real day, YYYY-MM-DD) and done (true or false). Never raises: what
 * is not a list of that shape is "no".
 */
create function office.milestones_valid(p_milestones jsonb) returns boolean
  language plpgsql immutable set search_path = ''
  as $$
declare
  v_item jsonb;
  v_seen text[] := '{}';
  v_id text;
  v_name text;
  v_date text;
begin
  if p_milestones is null or pg_catalog.jsonb_typeof(p_milestones) <> 'array'
     or pg_catalog.jsonb_array_length(p_milestones) > 50 then
    return false;
  end if;
  for v_item in select e.value from pg_catalog.jsonb_array_elements(p_milestones) e loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_item)) <> 4
       or not (v_item ?& array['id', 'name', 'date', 'done'])
       or pg_catalog.jsonb_typeof(v_item -> 'id') <> 'string'
       or pg_catalog.jsonb_typeof(v_item -> 'name') <> 'string'
       or pg_catalog.jsonb_typeof(v_item -> 'date') not in ('string', 'null')
       or pg_catalog.jsonb_typeof(v_item -> 'done') <> 'boolean' then
      return false;
    end if;
    v_id := v_item ->> 'id';
    v_name := v_item ->> 'name';
    v_date := v_item ->> 'date';
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_id = any (v_seen)
       or v_name <> pg_catalog.btrim(v_name)
       or pg_catalog.char_length(v_name) not between 1 and 120 then
      return false;
    end if;
    v_seen := v_seen || v_id;
    if v_date is not null then
      if v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_date like '0000-%' then
        return false;
      end if;
      begin
        perform pg_catalog.make_date(
          pg_catalog.substr(v_date, 1, 4)::integer,
          pg_catalog.substr(v_date, 6, 2)::integer,
          pg_catalog.substr(v_date, 9, 2)::integer
        );
      exception when others then
        return false;
      end;
    end if;
  end loop;
  return true;
end
$$;
revoke execute on function office.milestones_valid(jsonb) from public;
grant execute on function office.milestones_valid(jsonb) to office_app, office_trigger;

alter table office.projects
  add constraint projects_milestones_shape check (office.milestones_valid(milestones));

-- Their own path: the API's role writes the three columns; who may is decided by the row policy
-- "member_edits" (every column) and, for the budget, by the trigger below.
grant update (budget, budget_currency, milestones) on office.projects to office_api_private;

/*
 * Whoever changes the budget of a project while a person is in the context: that person is the
 * founder of the project's company, or the owner or a manager of the project; never an agent run.
 * Holds for every role, the privileged one too. A change without a person in the context
 * (migrations, the seed, an administrator) is left alone. Runs with the caller's rights.
 */
create function office.guard_project_budget() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.budget is not distinct from old.budget
     and new.budget_currency is not distinct from old.budget_currency then
    return new;
  end if;
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null
     or old.company_id is distinct from office.ctx_company_id()
     or not (
       office.is_founder()
       or (
         office.is_insider()
         and coalesce(office.project_role(old.id) in ('owner', 'manager'), false)
       )
     ) then
    raise exception 'Only the owner, a manager or the founder changes the budget of a project'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
revoke execute on function office.guard_project_budget() from public;
-- On every update, not only on one that names the column (as guard_ai_permission).
create trigger guard_budget before update on office.projects
  for each row execute function office.guard_project_budget();

-- office.audit_project_change as of the project audit migration (20261008101900), with two
-- events and three known columns added:
--   project_budget_changed, project_milestones_changed
--                                  project_id and record: the project (record_type project)
-- Ids and an event name, never the amount or a milestone's name (2 October decision 13).
create or replace function office.audit_project_change() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  events text[] := '{}';
  e text;
  -- The columns with an event of their own, and the one the database derives.
  known constant text[] := array[
    'name', 'description', 'customer_id', 'status', 'closed', 'color', 'icon', 'target_date',
    'ai_allowed', 'budget', 'budget_currency', 'milestones'
  ];
begin
  if tg_op = 'INSERT' then
    events := array['project_created'];
    if new.status <> 'planned' then
      -- One of five fixed codes (check constraint), not free text.
      events := events || ('project_status_' || new.status);
    end if;
    if new.ai_allowed then
      events := events || 'project_ai_permission_opened'::text;
    end if;
    if new.budget is not null then
      events := events || 'project_budget_changed'::text;
    end if;
    if new.milestones <> '[]'::jsonb then
      events := events || 'project_milestones_changed'::text;
    end if;
  else
    if new.name is distinct from old.name then
      events := events || 'project_name_changed'::text;
    end if;
    if new.description is distinct from old.description then
      events := events || 'project_description_changed'::text;
    end if;
    if new.customer_id is distinct from old.customer_id then
      events := events || 'project_customer_changed'::text;
    end if;
    if new.status is distinct from old.status then
      events := events || ('project_status_' || new.status);
    end if;
    if new.color is distinct from old.color then
      events := events || 'project_color_changed'::text;
    end if;
    if new.icon is distinct from old.icon then
      events := events || 'project_icon_changed'::text;
    end if;
    if new.target_date is distinct from old.target_date then
      events := events || 'project_target_date_changed'::text;
    end if;
    if new.ai_allowed is distinct from old.ai_allowed then
      events := events || case
        when new.ai_allowed then 'project_ai_permission_opened'
        else 'project_ai_permission_closed'
      end;
    end if;
    if new.budget is distinct from old.budget
       or new.budget_currency is distinct from old.budget_currency then
      events := events || 'project_budget_changed'::text;
    end if;
    if new.milestones is distinct from old.milestones then
      events := events || 'project_milestones_changed'::text;
    end if;
    if (pg_catalog.to_jsonb(new) - known) is distinct from (pg_catalog.to_jsonb(old) - known) then
      events := events || 'project_changed'::text;
    end if;
  end if;
  foreach e in array events loop
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (new.company_id, new.id, e, 'project', new.id);
  end loop;
  return null;
end
$$;
