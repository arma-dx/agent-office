-- Every change of a project, of its members and of a customer leaves a row in audit_log (rule 5;
-- docs/SONRA.md P-l; 2 October decision 13: an event name and ids, never the old or the new text).
--
-- Written by triggers, for the reason the task audit gives: the API is not the only writer (the
-- permission functions, a removed company membership that takes the project memberships with it,
-- a role change). The functions run with the caller's rights; who and when come from the context
-- (set_audit_fields). A write without a person in the context is logged without an actor.
--
--   project_created, project_name_changed, project_description_changed,
--   project_customer_changed, project_status_<status>, project_color_changed,
--   project_icon_changed, project_target_date_changed, project_changed (any other column),
--   project_ai_permission_opened, project_ai_permission_closed
--                                  project_id and record: the project (record_type project)
--   project_member_added, project_member_removed
--                                  project_id: the project; record: the person (record_type user)
--   customer_created, customer_name_changed, customer_changed (any other column),
--   customer_ai_permission_opened, customer_ai_permission_closed,
--   customer_automated_processing_opened, customer_automated_processing_closed
--                                  record: the customer (record_type customer)
--
-- The permission events are written only where a permission changes: by the permission functions
-- (as office_trigger) or by an administrator. No request and no agent run can write a row that
-- says a permission was opened.

create function office.audit_project_change() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  events text[] := '{}';
  e text;
  -- The columns with an event of their own, and the one the database derives.
  known constant text[] := array[
    'name', 'description', 'customer_id', 'status', 'closed', 'color', 'icon', 'target_date',
    'ai_allowed'
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
revoke execute on function office.audit_project_change() from public;
-- Named to fire before creator_becomes_member: "created" is logged before "member added".
create trigger audit_project_change after insert or update on office.projects
  for each row execute function office.audit_project_change();

-- The record is the person; the project is in project_id.
create function office.audit_project_member() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (new.company_id, new.project_id, 'project_member_added', 'user', new.user_id);
  else
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (old.company_id, old.project_id, 'project_member_removed', 'user', old.user_id);
  end if;
  return null;
end
$$;
revoke execute on function office.audit_project_member() from public;
create trigger audit_project_member after insert or delete on office.project_members
  for each row execute function office.audit_project_member();

create function office.audit_customer_change() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  events text[] := '{}';
  e text;
  known constant text[] := array['name', 'ai_allowed', 'automated_processing_allowed'];
begin
  if tg_op = 'INSERT' then
    events := array['customer_created'];
    if new.ai_allowed then
      events := events || 'customer_ai_permission_opened'::text;
    end if;
    if new.automated_processing_allowed then
      events := events || 'customer_automated_processing_opened'::text;
    end if;
  else
    if new.name is distinct from old.name then
      events := events || 'customer_name_changed'::text;
    end if;
    if new.ai_allowed is distinct from old.ai_allowed then
      events := events || case
        when new.ai_allowed then 'customer_ai_permission_opened'
        else 'customer_ai_permission_closed'
      end;
    end if;
    if new.automated_processing_allowed is distinct from old.automated_processing_allowed then
      events := events || case
        when new.automated_processing_allowed then 'customer_automated_processing_opened'
        else 'customer_automated_processing_closed'
      end;
    end if;
    if (pg_catalog.to_jsonb(new) - known) is distinct from (pg_catalog.to_jsonb(old) - known) then
      events := events || 'customer_changed'::text;
    end if;
  end if;
  foreach e in array events loop
    insert into office.audit_log (company_id, event, record_type, record_id)
      values (new.company_id, e, 'customer', new.id);
  end loop;
  return null;
end
$$;
revoke execute on function office.audit_customer_change() from public;
create trigger audit_customer_change after insert or update on office.customers
  for each row execute function office.audit_customer_change();

-- The bookkeeping and the permission functions run as office_trigger; their audit rows are
-- written by that role. It already holds the column grant on audit_log (task_routings migration).
create policy project_records on office.audit_log for insert to office_trigger
  with check (
    event ~ '^(project|customer)_'
    and (office.ctx_company_id() is null or company_id = office.ctx_company_id())
  );
-- The permission events belong to the permission changes alone (as passkeys_reset belongs to the
-- reset): the application role, that is every request of the API and every agent run of the
-- worker, cannot write a row that says a permission was opened or closed.
create policy reserved_permission_events on office.audit_log as restrictive for insert
  to office_app
  with check (
    event !~ '^(project_ai_permission|customer_ai_permission|customer_automated_processing)_'
  );
