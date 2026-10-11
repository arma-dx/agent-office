-- A request inside a project (8 October decisions 11 and 17; docs/SONRA.md P-h, P-m, P1-j;
-- CLAUDE.md rule 12).
--
-- The request form gets a project field. Everything that decides who may open a request in a
-- project and who reads it afterwards exists already and is not changed here:
--   - the row policy of office.tasks (office.row_visible): a row with a project is written and read
--     by the founder and the members of that project only;
--   - tasks.project_id never changes after the insert (trigger immutable_columns), and nothing of a
--     request is changed by hand (office.check_task);
--   - office.check_task refuses a request in a project where agents may not work (the project's AI
--     permission and, if it has a customer, the customer's), read with the person's own rights.
-- One rule is added to that check: a closed project (status completed or cancelled, the generated
-- column projects.closed) takes no new request. The requests it already has stay as they are.
-- The project page lists the requests of its project; the existing index tasks_project
-- (project_id) serves that list, so no index is added.
--
-- Error codes are unchanged: 23514 for a project that takes no request (no AI permission, closed,
-- or not visible to the person), 42501 for a caller who is no person or not the API.

-- office.check_task as of the task kind migration (20261007100300), with the project block
-- rewritten: the closed project is refused, the rest reads as before.
create or replace function office.check_task() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
  v_closed boolean;
  v_allows_ai boolean;
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
    if new.project_id is not null then
      -- The project and its customer are read with the person's own rights: a project the person
      -- cannot see gives no row and is refused like one without permission.
      select p.closed,
             p.ai_allowed and (p.customer_id is null or exists (
               select 1 from office.customers c where c.id = p.customer_id and c.ai_allowed
             ))
        into v_closed, v_allows_ai
        from office.projects p where p.id = new.project_id;
      -- Rule 12: no agent runs in a project without AI permission, so a request there could never
      -- be carried out.
      if v_allows_ai is not true then
        raise exception 'Agents do not work in this project (AI permission)'
          using errcode = 'check_violation';
      end if;
      -- docs/SONRA.md P-h: a closed project takes no new request.
      if v_closed then
        raise exception 'A closed project takes no new request' using errcode = 'check_violation';
      end if;
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
