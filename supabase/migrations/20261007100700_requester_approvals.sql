-- The requester's approval at the end of every request (7 October decisions 4 and 6).
--
-- When the work of the last step is approved by its approver, the result is released to the
-- requester and one row is opened here: the requester approves the result (the request is done)
-- or asks for changes in their own words (the request goes back to the agent of the last step).
-- The fixed list of reasons of 2 October decision 10 belongs to the approver's record; here a class
-- may be stored but is not asked for: the requester says what is missing in a sentence.
-- It is a record of its own, not a row of `approvals`:
--   - an `approvals` row is the gate of an agent's output or action (rule 4): opened by an agent
--     from its run, decided by a person who holds the approval right, possibly with a passkey, and
--     read by the external effect gate. The requester is any insider and approves nothing outward;
--   - so no reader of `approvals.status = 'approved'` ever has to tell the two apart, and the
--     first time approval rate is not mixed with the requester's answers.
-- It needs no passkey (a marked default: the passkey of an important approval was already given
-- by the approver who released the result).
--
-- Opened and closed only by the flow (office_trigger); decided only by the requester.

create table office.requester_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- Comes from the task's project.
  project_id uuid,
  task_id uuid not null,
  -- 1: the first time the result is put before the requester.
  round smallint not null check (round >= 1),
  -- The approval that released the result the requester is asked about.
  approval_id uuid not null,
  requester_user_id uuid not null references office.users (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested')),
  rejection_reason text check (rejection_reason in (
    'incorrect_information', 'incomplete', 'language_and_tone', 'pricing', 'out_of_scope', 'other'
  )),
  decision_reason text,
  decided_at timestamptz,
  -- Closed without a decision: the request was routed again or closed.
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, round),
  foreign key (task_id, company_id) references office.tasks (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (approval_id, company_id) references office.approvals (id, company_id),
  constraint decision_complete check (
    (status = 'pending') = (decided_at is null)
    and (status <> 'pending' or decision_reason is null)
  ),
  -- The requester's own words are what the next attempt has to go on; the class is optional.
  constraint words_required check (
    status <> 'changes_requested' or length(btrim(coalesce(decision_reason, ''))) > 0
  ),
  constraint reason_only_with_changes
    check (rejection_reason is null or status = 'changes_requested')
);
create unique index requester_approvals_single_pending on office.requester_approvals (task_id)
  where status = 'pending' and invalidated_at is null;
create index requester_approvals_pending
  on office.requester_approvals (company_id, requester_user_id)
  where status = 'pending' and invalidated_at is null;

create function office.check_requester_approval() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    if current_user <> 'office_trigger' then
      raise exception 'The requester''s approval is opened by the flow of the request'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
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
    if office.ctx_agent_code() is not null
       or office.ctx_user_id() is distinct from old.requester_user_id
       or not office.is_insider() then
      raise exception 'Only the requester gives the requester''s approval'
        using errcode = 'insufficient_privilege';
    end if;
    new.decided_at := pg_catalog.now();
  elsif new.decision_reason is distinct from old.decision_reason
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'A reason is written together with the decision'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger check_requester_approval before insert or update on office.requester_approvals
  for each row execute function office.check_requester_approval();

alter table office.requester_approvals enable row level security;
alter table office.requester_approvals force row level security;
grant select on office.requester_approvals to office_app;
-- The requester answers through the API: the worker's role, which runs in the requester's name,
-- lacks the privilege and can never give the requester's approval itself.
grant update (status, rejection_reason, decision_reason)
  on office.requester_approvals to office_api_private;
-- Whoever sees the request sees that it waits for its requester and what the requester answered.
create policy visible on office.requester_approvals for select to office_app
  using (office.row_visible(company_id, project_id));
create policy requester_decides on office.requester_approvals for update to office_api_private
  using (
    office.row_visible(company_id, project_id)
    and requester_user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
  );

grant select, insert, update (invalidated_at) on office.requester_approvals to office_trigger;
create policy flow_all on office.requester_approvals for all to office_trigger
  using (true) with check (true);

-- The last step's work is approved: the request waits for its requester.
create or replace function office.flow_request_result_approved(p_task uuid, p_approval uuid)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid;
  v_project uuid;
  v_requester uuid;
begin
  select t.company_id, t.project_id, t.requester_user_id
    into v_company, v_project, v_requester
    from office.tasks t where t.id = p_task;
  insert into office.requester_approvals
      (company_id, project_id, task_id, round, approval_id, requester_user_id)
    values (
      v_company, v_project, p_task,
      (select coalesce(max(q.round), 0) + 1 from office.requester_approvals q
       where q.task_id = p_task),
      p_approval, v_requester
    );
  -- The request keeps waiting for approval: now the requester's.
  perform office.flow_set_status(p_task, 'awaiting_approval');
end
$$;

-- A new routing or a close also closes the requester's pending approval.
create or replace function office.flow_close_pending(p_task uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  update office.approvals a set invalidated_at = pg_catalog.now()
    where a.task_id = p_task and a.status = 'pending' and a.invalidated_at is null;
  update office.requester_approvals q set invalidated_at = pg_catalog.now()
    where q.task_id = p_task and q.status = 'pending' and q.invalidated_at is null;
end
$$;

/*
 * The requester's decision:
 *   approved            the request is done;
 *   changes requested   the first time: the last step is active again and the request is in
 *                       progress; the same agent takes the requester's words and its earlier
 *                       output (the API puts its run on the queue), and its new result passes the
 *                       unit's approver again before it comes back here. The second time nothing
 *                       starts by itself: the request stays in progress with no step active and
 *                       falls to a person, who routes it again or stops it. So the agent reworks
 *                       ONCE at the requester's wish (T10; a marked default).
 */
create function office.flow_on_requester_approval() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_step uuid;
begin
  if new.status = 'approved' and old.status = 'pending' then
    perform office.flow_set_status(new.task_id, 'done');
  elsif new.status = 'changes_requested' and old.status = 'pending' then
    if (select count(*) from office.requester_approvals q
        where q.task_id = new.task_id and q.status = 'changes_requested') < 2 then
      select r.id into v_step from office.task_routings r
        where r.task_id = new.task_id and r.status = 'done' and r.agent_code is not null
        order by r.round desc, r.seq desc limit 1;
      update office.task_routings r set status = 'active' where r.id = v_step;
    end if;
    perform office.flow_set_status(new.task_id, 'in_progress');
  end if;
  return null;
end
$$;
alter function office.flow_on_requester_approval() owner to office_trigger;
revoke execute on function office.flow_on_requester_approval() from public;
create trigger flow_on_requester_approval after update on office.requester_approvals
  for each row execute function office.flow_on_requester_approval();
