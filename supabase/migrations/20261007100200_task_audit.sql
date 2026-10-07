-- Every change of a task and every new comment leaves a row in audit_log (rule 5; KALAN-ISLER 0.4:
-- "Her değişikliğin audit_log'a yazılması"). Only an event name and ids (2 October decision 13):
-- the event name says what changed, never the old or the new text.
--
-- Written by triggers and not by the API, because the API is not the only writer of a task: the
-- worker gets the same table rights and writes tasks from 1.1 (create_task, update_task), and
-- removing a membership clears a task's assignee through a foreign key action that no API code
-- sees. A trigger is the one place no path can skip; "no change without a trace" is kept where
-- "version", "completed_at" and the invalidation of approvals are already kept.
--
-- The functions run with the caller's rights: the insert goes through audit_log's own policy (a
-- member of the context company), and who and when come from the context (set_audit_fields), so a
-- writer cannot name another actor. A write without a person in the context (the seed, an
-- administrator) is logged without an actor.
--
-- What a row cannot say: to whom a task was assigned. audit_log has one record id; the current
-- assignee is on the task. A second subject is a decision for the audit screen (2.7).
--
-- "Every change" is kept by construction: each column of tasks either has an event of its own
-- below or is one the database maintains (version, updated_at, completed_at); a change in any
-- other column, one a later migration adds, is logged as task_changed until it gets its own name.
-- A task that is opened already assigned, past "open" or from an outside source says so at
-- creation, so that the log never depends on a later update to show it.

create function office.audit_task_change() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  events text[] := '{}';
  e text;
  -- The columns with an event of their own, and the three the database maintains.
  known constant text[] := array[
    'status', 'assignee_user_id', 'assignee_agent_code', 'title', 'description', 'priority',
    'due_at', 'unit_code', 'source_kind', 'requester_user_id', 'parent_task_id', 'work_type_id',
    'initial_unit_code', 'routing_corrected', 'version', 'updated_at', 'completed_at'
  ];
begin
  if tg_op = 'INSERT' then
    events := array['task_created'];
    if new.assignee_user_id is not null then
      events := events || 'task_assigned_user'::text;
    elsif new.assignee_agent_code is not null then
      events := events || 'task_assigned_agent'::text;
    end if;
    if new.status <> 'open' then
      events := events || ('task_status_' || new.status);
    end if;
    if new.source_kind = 'external' then
      events := events || 'task_source_external'::text;
    end if;
  else
    if new.status is distinct from old.status then
      -- The new status is one of the six fixed codes (check constraint), not free text.
      events := events || ('task_status_' || new.status);
    end if;
    if new.assignee_user_id is distinct from old.assignee_user_id
       or new.assignee_agent_code is distinct from old.assignee_agent_code then
      events := events || case
        when new.assignee_user_id is not null then 'task_assigned_user'
        when new.assignee_agent_code is not null then 'task_assigned_agent'
        else 'task_unassigned'
      end;
    end if;
    if new.title is distinct from old.title then
      events := events || 'task_title_changed'::text;
    end if;
    if new.description is distinct from old.description then
      events := events || 'task_description_changed'::text;
    end if;
    if new.priority is distinct from old.priority then
      events := events || 'task_priority_changed'::text;
    end if;
    if new.due_at is distinct from old.due_at then
      events := events || 'task_due_changed'::text;
    end if;
    if new.unit_code is distinct from old.unit_code then
      events := events || 'task_unit_changed'::text;
    end if;
    if new.source_kind is distinct from old.source_kind then
      -- One of two fixed codes (check constraint). task_source_internal is the trace of 2 October
      -- decision 8: a person gave a task that came from outside content to an agent.
      events := events || ('task_source_' || new.source_kind);
    end if;
    if new.requester_user_id is distinct from old.requester_user_id then
      events := events || 'task_requester_changed'::text;
    end if;
    if new.parent_task_id is distinct from old.parent_task_id then
      events := events || 'task_parent_changed'::text;
    end if;
    if new.work_type_id is distinct from old.work_type_id then
      events := events || 'task_work_type_changed'::text;
    end if;
    if new.initial_unit_code is distinct from old.initial_unit_code
       or new.routing_corrected is distinct from old.routing_corrected then
      events := events || 'task_routing_changed'::text;
    end if;
    if (pg_catalog.to_jsonb(new) - known) is distinct from (pg_catalog.to_jsonb(old) - known) then
      events := events || 'task_changed'::text;
    end if;
  end if;
  foreach e in array events loop
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (new.company_id, new.project_id, e, 'task', new.id);
  end loop;
  return null;
end
$$;
create trigger audit_task_change after insert or update on office.tasks
  for each row execute function office.audit_task_change();

-- The record is the task the comment belongs to: a comment is not opened on its own.
create function office.audit_task_comment() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    values (new.company_id, new.project_id, 'task_comment_added', 'task', new.task_id);
  return null;
end
$$;
create trigger audit_task_comment after insert on office.task_comments
  for each row execute function office.audit_task_comment();
