-- In whose name a run on a request goes (8 October decision 45; docs/SONRA.md T15, P2-k;
-- CLAUDE.md rule 9).
--
-- Until now a run on a request went in the name of its requester and of nobody else, and the
-- name came from the job on the queue: the worker put it into its context, and the database
-- wrote whatever person the context held into runs.user_id. Two things followed. A requester who
-- was taken out of the project, made an external person, removed from the company or
-- deactivated could no longer read their own request, so no run could start in their name and
-- the request hung. And nothing in the database stopped the worker's role from opening a run on
-- anybody's request with the founder as the person.
--
-- The founder's answer (decision 45): the request goes on, and the agent works in the founder's
-- name. From here on the database says in whose name a run on a request goes:
--   - the requester, as long as that person may still read the request: an active founder or
--     employee of the request's company and, for a request inside a project, the founder or a
--     member of that project;
--   - otherwise the founder of the company (with several founders: the active one whose
--     membership is the oldest).
-- office.request_run_identity answers it; the insert of a run on a request refuses every other
-- person (office.check_run_request). The request itself is not touched: tasks.requester_user_id
-- never changes, and every record keeps saying who asked.
--
-- The requester's approval at the end follows the same rule: while the requester cannot read the
-- request, the founder gives it in their place, and the record says who decided
-- (requester_approvals.decided_by_user_id).
--
-- No policy of a company table is widened for reading. The functions that read memberships run
-- as the reader role and are not callable by the application; the one the application calls
-- answers with a person's id, for a request of the context company, to an agent run (which sets
-- its own context, rule 9) and to a person who may read that request.
--
-- Error codes: 42501 a run on a request in another name than the resolved one; 42501 the
-- requester's approval by anybody but the requester or, in the requester's place, the founder.

/*
 * May this person read a request of this company (and, if given, of this project) now: an active
 * founder or employee of the company; for a project also the founder or a member of it. The rule
 * of office.row_visible for a person, asked about somebody who is not the caller. Runs as the
 * reader role; called only by the flow's functions.
 */
create function office.person_reads_request(p_company uuid, p_project uuid, p_user uuid)
  returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from office.memberships m
      join office.users u on u.id = m.user_id and u.active
      where m.company_id = p_company and m.user_id = p_user
        and m.role in ('founder', 'employee')
        and (
          p_project is null
          or m.role = 'founder'
          or exists (
            select 1 from office.project_members pm
            where pm.project_id = p_project and pm.user_id = p_user
          )
        )
    )
  $$;
alter function office.person_reads_request(uuid, uuid, uuid) owner to office_auth_reader;
revoke execute on function office.person_reads_request(uuid, uuid, uuid) from public;
grant execute on function office.person_reads_request(uuid, uuid, uuid) to office_trigger;

/*
 * The founder in whose name the company's work goes when its requester cannot carry it: the
 * active founder whose membership is the oldest. A company always has one (the founder guards).
 * Runs as the reader role; called only by the flow's functions.
 */
create function office.acting_founder(p_company uuid) returns uuid
  language sql stable security definer set search_path = ''
  as $$
    select m.user_id from office.memberships m
    join office.users u on u.id = m.user_id and u.active
    where m.company_id = p_company and m.role = 'founder'
    order by m.created_at, m.id
    limit 1
  $$;
alter function office.acting_founder(uuid) owner to office_auth_reader;
revoke execute on function office.acting_founder(uuid) from public;
grant execute on function office.acting_founder(uuid) to office_trigger;

-- The flow reads when a request was opened (the moment its first work was called for).
grant select (created_at) on office.tasks to office_trigger;

/*
 * In whose name a run on this request goes now (decision 45): the requester while they may read
 * the request, otherwise the founder of the company. Null for anything that is not a request of
 * the context company. Answers an agent run (the runner asks before it sets a person) and a
 * person who may read the request (the page says when the founder stands in); nobody else.
 */
create function office.request_run_identity(p_task uuid) returns uuid
  language sql stable security definer set search_path = ''
  as $$
    select case
        when office.person_reads_request(t.company_id, t.project_id, t.requester_user_id)
          then t.requester_user_id
        else office.acting_founder(t.company_id)
      end
    from office.tasks t
    where t.id = p_task
      and t.kind = 'request'
      and t.company_id = office.ctx_company_id()
      and (
        office.ctx_agent_code() is not null
        or (
          office.is_insider()
          and (
            t.project_id is null or office.is_founder() or office.is_project_member(t.project_id)
          )
        )
      )
  $$;
alter function office.request_run_identity(uuid) owner to office_trigger;
revoke execute on function office.request_run_identity(uuid) from public;
grant execute on function office.request_run_identity(uuid) to office_app;

/*
 * office.check_run_request as of the run step migration (20261008100200), with one rule added
 * (marked "decision 45"): a run on a request is opened in the name the database resolves, never
 * in a name the caller chose. The trigger fires before office.check_run_start writes the context
 * person into runs.user_id, so the context person is what is compared.
 */
create or replace function office.check_run_request() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_status text;
  v_as uuid;
begin
  -- Written here and nowhere else: never the caller's value.
  new.routing_id := null;
  if new.task_id is null then
    return new;
  end if;
  select t.status into v_status from office.tasks t
    where t.id = new.task_id and t.kind = 'request';
  if v_status is null then
    return new;
  end if;
  if v_status in ('done', 'cancelled') then
    raise exception 'The request is closed' using errcode = 'check_violation';
  end if;
  -- Decision 45: the requester while they may read the request, otherwise the founder.
  -- No resolved name (a request of another company than the context's) is a
  -- refusal too, also for a context without a person: null is not "the same name".
  v_as := office.request_run_identity(new.task_id);
  if v_as is null or office.ctx_user_id() is distinct from v_as then
    raise exception 'A run on a request goes in the name the database resolves for it'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from office.task_routings r where r.task_id = new.task_id) then
    select r.id into new.routing_id
      from office.task_routings r
      where r.task_id = new.task_id and r.status = 'active' and r.agent_code = new.agent_code;
    if new.routing_id is null then
      raise exception 'The request is not routed to this agent' using errcode = 'check_violation';
    end if;
  elsif new.agent_code <> office.coordinator_agent_code() then
    raise exception 'Only the coordinator runs on a request that is not routed yet'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- The requester's approval, given in the requester's place -----------------------------------------

-- Who gave the answer: the requester, or the founder in their place. Null while it waits, and
-- for an answer given before this column existed (then: the requester).
alter table office.requester_approvals
  add column decided_by_user_id uuid references office.users (id);

/*
 * office.check_requester_approval as of the requester approvals migration (20261007100700), with
 * decision 45 (marked): the founder gives the requester's approval while the requester cannot
 * read the request; who decided is written by the database.
 */
create or replace function office.check_requester_approval() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    if current_user <> 'office_trigger' then
      raise exception 'The requester''s approval is opened by the flow of the request'
        using errcode = 'insufficient_privilege';
    end if;
    new.decided_by_user_id := null;
    return new;
  end if;
  -- Written below and nowhere else: never the caller's value.
  new.decided_by_user_id := old.decided_by_user_id;
  if new.invalidated_at is distinct from old.invalidated_at then
    if current_user <> 'office_trigger' then
      raise exception 'The requester''s approval is closed by the flow of the request'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'A decided approval cannot be changed' using errcode = 'check_violation';
  end if;
  if new.status <> 'pending' then
    if old.invalidated_at is not null then
      raise exception 'The request changed; this approval is closed'
        using errcode = 'check_violation';
    end if;
    -- Decision 45: the requester; or the founder, while the requester cannot read the request.
    if office.ctx_agent_code() is not null
       or not office.is_insider()
       or not (
         office.ctx_user_id() is not distinct from old.requester_user_id
         or (
           office.is_founder()
           and office.request_run_identity(old.task_id) is distinct from old.requester_user_id
         )
       ) then
      raise exception 'Only the requester gives the requester''s approval, or the founder in the place of a requester who cannot read the request'
        using errcode = 'insufficient_privilege';
    end if;
    new.decided_at := pg_catalog.now();
    new.decided_by_user_id := office.ctx_user_id();
  elsif new.decision_reason is distinct from old.decision_reason
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'A reason is written together with the decision'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- Beside "requester_decides": the founder's row, only while the requester cannot read the request.
create policy founder_decides_for_requester on office.requester_approvals for update
  to office_api_private
  using (
    office.row_visible(company_id, project_id)
    and office.ctx_agent_code() is null
    and office.is_founder()
    and office.request_run_identity(task_id) is distinct from requester_user_id
  );
