-- Two kinds of task (7 October decisions 1, 2, 7, 9 and 10).
--
--   request  A request that agents carry out (flow A, "talep"). A person writes it and chooses
--            neither a unit nor an agent. After it is opened, nothing of it changes by hand: the
--            unit, the agent and the status are written only by the flow functions (owned by
--            office_trigger), which are driven by the records of the flow (routing, run, approval,
--            the requester's approval, question, cancel).
--   task     A task between people (flow B, "görev"): assigned and moved by hand, as today.
--
-- The kind never changes. The default is "task": a row opened without a kind starts no agent.
-- In the panel the two are "Talepler" and "Görevler" (7 October decision 10, for now).

alter table office.tasks add column kind text not null default 'task'
  check (kind in ('request', 'task'));
-- Who closed a request by hand (the requester's cancel, or the stop of the approver or the
-- founder) and that person's own words about why; audit_log says who and when but only the founder
-- reads it, and the requester must be able to read why their request was closed (7 October
-- decision 4: the result goes back to the requester, also when the answer is no).
alter table office.tasks add column closed_by_user_id uuid references office.users (id);
alter table office.tasks add column close_reason text
  check (close_reason is null or length(close_reason) between 1 and 500);

alter table office.tasks
  -- A request is carried out by agents; it is never assigned to a person and has no parent yet
  -- (several agents in turn are steps of the routing, not sub-tasks).
  add constraint request_shape check (
    kind <> 'request'
    or (requester_user_id is not null and assignee_user_id is null and source_kind = 'internal')
  ),
  add constraint closed_by_only_when_cancelled check (
    (closed_by_user_id is null and close_reason is null)
    or (kind = 'request' and status = 'cancelled')
  );
create index tasks_requests on office.tasks (company_id, status, created_at desc)
  where kind = 'request';

-- The flow functions run as office_trigger: they read the columns below and write the columns of
-- the flow. The check below refuses every other writer of a request.
grant select (
  id, company_id, project_id, kind, status, requester_user_id, unit_code, assignee_agent_code,
  initial_unit_code, routing_corrected, version
) on office.tasks to office_trigger;
grant update (
  status, unit_code, assignee_agent_code, initial_unit_code, routing_corrected, closed_by_user_id,
  close_reason
) on office.tasks to office_trigger;
create policy flow_reads on office.tasks for select to office_trigger using (true);
create policy flow_updates on office.tasks for update to office_trigger
  using (kind = 'request') with check (kind = 'request');
-- The flow functions ask who the caller is (they never trust an argument for it).
grant execute on function office.my_role(), office.is_founder(), office.is_insider(),
  office.can_approve()
  to office_trigger;

create or replace function office.check_task() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
begin
  if tg_op = 'INSERT' and new.kind = 'request' then
    -- A request is opened by a person. An agent's wish for new work is a suggestion a person opens
    -- (suggest_task); agent to agent hand-over is undecided (M30).
    if agent is not null or office.ctx_user_id() is null then
      raise exception 'A request is opened by a person' using errcode = 'insufficient_privilege';
    end if;
    -- A person acts through the API. The worker's role carries no person's session: with a person
    -- alone in its context it opens nothing (the API-only group is the line, as for an approval
    -- decision and a membership change).
    if not pg_catalog.pg_has_role(current_user, 'office_api_private', 'member') then
      raise exception 'A request is opened through the API'
        using errcode = 'insufficient_privilege';
    end if;
    -- Rule 12: no agent runs in a project without AI permission, so a request there could never
    -- be carried out. The project and its customer are read with the person's own rights.
    if new.project_id is not null and not exists (
      select 1 from office.projects p
      where p.id = new.project_id and p.ai_allowed
        and (p.customer_id is null or exists (
          select 1 from office.customers c where c.id = p.customer_id and c.ai_allowed
        ))
    ) then
      raise exception 'Agents do not work in this project (AI permission)'
        using errcode = 'check_violation';
    end if;
    new.requester_user_id := office.ctx_user_id();
    new.status := 'open';
    new.unit_code := null;
    new.initial_unit_code := null;
    new.routing_corrected := false;
    new.assignee_user_id := null;
    new.assignee_agent_code := null;
    new.parent_task_id := null;
    new.source_kind := 'internal';
    new.closed_by_user_id := null;
    new.close_reason := null;
    new.created_at := pg_catalog.now();
  elsif tg_op = 'UPDATE' and old.kind = 'request' and current_user <> 'office_trigger' then
    -- 7 October decisions 2 and 7: nobody sets the status of a request by hand, and nothing else
    -- of it is changed by hand. Holds for the privileged role too.
    raise exception 'A request changes only through its flow'
      using errcode = 'insufficient_privilege';
  end if;

  -- Decision 8: if a person assigns an externally sourced task to an agent, the task counts as
  -- internal. An agent cannot do this: in an agent context an externally sourced task cannot be
  -- assigned to an agent (constraint) and cannot be marked internal.
  if new.source_kind = 'external' and new.assignee_agent_code is not null and agent is null then
    new.source_kind := 'internal';
  end if;
  if tg_op = 'UPDATE' then
    if agent is not null and old.source_kind = 'external' and new.source_kind = 'internal' then
      raise exception 'An agent cannot mark an externally sourced task as internal'
        using errcode = 'insufficient_privilege';
    end if;
    if (pg_catalog.to_jsonb(new) - array['status', 'updated_at', 'completed_at', 'version',
          'closed_by_user_id', 'close_reason'])
       is distinct from
       (pg_catalog.to_jsonb(old) - array['status', 'updated_at', 'completed_at', 'version',
          'closed_by_user_id', 'close_reason']) then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  else
    new.version := 1;
  end if;
  new.updated_at := pg_catalog.now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := pg_catalog.now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end
$$;

-- The kind and the requester of a request never change.
drop trigger immutable_columns on office.tasks;
create trigger immutable_columns before update on office.tasks
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'created_at', 'kind'
  );

/*
 * The one place that writes the status of a request. Not callable by the application: only the
 * flow functions (same owner) call it. Returns the status before the change.
 */
create function office.flow_set_status(
  p_task uuid, p_status text, p_closed_by uuid default null, p_reason text default null
) returns text
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_old text;
begin
  select t.status into v_old from office.tasks t
    where t.id = p_task and t.kind = 'request' for update;
  if v_old is null then
    raise exception 'Not a request' using errcode = 'no_data_found';
  end if;
  if v_old in ('done', 'cancelled') then
    -- A closed request stays closed.
    return v_old;
  end if;
  if v_old is distinct from p_status then
    update office.tasks t
      set status = p_status, closed_by_user_id = p_closed_by, close_reason = p_reason
      where t.id = p_task;
  end if;
  return v_old;
end
$$;
alter function office.flow_set_status(uuid, text, uuid, text) owner to office_trigger;
revoke execute on function office.flow_set_status(uuid, text, uuid, text) from public;

-- The task audit trigger names the new columns: the kind never changes, and who closed a request
-- is traced by request_cancelled / request_stopped (written by office.close_request) next to
-- task_status_cancelled. Without this the close would also be logged as task_changed.
create or replace function office.audit_task_change() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  events text[] := '{}';
  e text;
  -- The columns with an event of their own, and the ones the database maintains.
  known constant text[] := array[
    'status', 'assignee_user_id', 'assignee_agent_code', 'title', 'description', 'priority',
    'due_at', 'unit_code', 'source_kind', 'requester_user_id', 'parent_task_id', 'work_type_id',
    'initial_unit_code', 'routing_corrected', 'version', 'updated_at', 'completed_at',
    'kind', 'closed_by_user_id', 'close_reason'
  ];
begin
  if tg_op = 'INSERT' then
    events := array[case when new.kind = 'request' then 'request_created' else 'task_created' end];
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
