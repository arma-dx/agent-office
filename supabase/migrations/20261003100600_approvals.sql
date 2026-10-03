-- Approval Desk data, critical error log and notification log (rule 4; 2 October decisions 10, 12;
-- 3 October decisions 1, 3; for M46 only the log table, who sends reminders is an open question).
--
-- An agent opens an approval (submit_for_approval) and a person decides: the founder or an employee
-- the founder gave the right to approve; no decision can be made in an agent context. An external
-- effect tool call cannot be opened without an approved approval record.

-- The current version of the record an approval is based on (among the records the caller can see;
-- NULL if not visible).
create function office.basis_version_of(p_type text, p_id uuid) returns integer
  language sql stable set search_path = ''
  as $$
    select case p_type
      when 'task' then (select g.version from office.tasks g where g.id = p_id)
      when 'note' then (select n.version from office.notes n where n.id = p_id)
    end
  $$;
grant execute on function office.basis_version_of(text, uuid) to office_app;

create table office.approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- Comes from the run's project.
  project_id uuid,
  task_id uuid,
  run_id uuid not null,
  agent_code text not null references office.agent_definitions (code),
  -- The tool that requires approval (e.g. send_email, update_note).
  tool_name text references office.tools (name),
  title text not null check (length(trim(title)) > 0),
  summary text,
  risk_note text,
  diff text,
  -- The full output or action to approve; after approval this content is applied.
  payload jsonb not null,
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  -- Output with options (M24): [{ "code": "...", ... }]; one is selected when deciding.
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  priority smallint not null default 3 check (priority between 1 and 4),
  agent_rationale text,
  -- X1-7: the record it is based on and its version. If the record changes the approval is closed
  -- (invalidated_at).
  basis_type text check (basis_type in ('task', 'note')),
  basis_id uuid,
  basis_version integer check (basis_version > 0),
  -- M23: the approval that follows a change request links to the previous one; attempt 1 is the
  -- first time.
  previous_approval_id uuid unique,
  attempt smallint not null default 1 check (attempt between 1 and 2),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested', 'rejected')),
  decided_by_user_id uuid references office.users (id),
  decided_at timestamptz,
  decision_reason text,
  rejection_reason text check (rejection_reason in (
    'incorrect_information', 'incomplete', 'language_and_tone', 'pricing', 'out_of_scope', 'other'
  )),
  selected_option text,
  invalidated_at timestamptz,
  -- M22: "sent out" is not a status but a separate field.
  sent_by_user_id uuid references office.users (id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (task_id, company_id) references office.tasks (id, company_id),
  foreign key (run_id, company_id) references office.runs (id, company_id),
  foreign key (previous_approval_id, company_id) references office.approvals (id, company_id),
  constraint basis_complete check (
    (basis_type is null) = (basis_id is null) and (basis_id is null) = (basis_version is null)
  ),
  constraint decision_complete check (
    (status = 'pending') = (decided_at is null)
    and (decided_at is null) = (decided_by_user_id is null)
    and (status <> 'pending' or decision_reason is null)
  ),
  -- Decision 10: the reason for a rejection or a change request is chosen from a fixed list.
  constraint rejection_reason_required
    check ((status in ('rejected', 'changes_requested')) = (rejection_reason is not null)),
  constraint option_only_when_approved check (selected_option is null or status = 'approved'),
  constraint sent_only_when_approved check (
    (sent_at is null) = (sent_by_user_id is null)
    and (sent_at is null or status = 'approved')
  )
);
-- Decision 10: a single pending approval for the same record.
create unique index approvals_single_pending on office.approvals (basis_type, basis_id)
  where status = 'pending' and invalidated_at is null and basis_id is not null;
create index approvals_pending on office.approvals (company_id, created_at)
  where status = 'pending' and invalidated_at is null;

create function office.check_approval() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  agent text := office.ctx_agent_code();
  prev office.approvals;
begin
  if tg_op = 'INSERT' then
    if agent is null or new.agent_code is distinct from agent then
      raise exception 'An approval is opened only by an agent from its own run'
        using errcode = 'insufficient_privilege';
    end if;
    if not exists (
      select 1 from office.runs c where c.id = new.run_id and c.agent_code = new.agent_code
    ) then
      raise exception 'The approval''s run does not belong to this agent'
        using errcode = 'check_violation';
    end if;
    new.status := 'pending';
    new.decided_by_user_id := null;
    new.decided_at := null;
    new.decision_reason := null;
    new.rejection_reason := null;
    new.selected_option := null;
    new.invalidated_at := null;
    new.sent_by_user_id := null;
    new.sent_at := null;
    new.created_at := pg_catalog.now();
    if new.options is not null and exists (
      select 1 from pg_catalog.jsonb_array_elements(new.options) e
      where pg_catalog.jsonb_typeof(e -> 'code') is distinct from 'string'
    ) then
      raise exception 'Every option must have a text code' using errcode = 'check_violation';
    end if;
    if new.basis_id is not null
       and office.basis_version_of(new.basis_type, new.basis_id)
         is distinct from new.basis_version then
      raise exception 'The basis record''s version is not current'
        using errcode = 'check_violation';
    end if;
    -- M23: work sent back for changes returns to the same agent; after the second change request
    -- the work falls to a person.
    if new.previous_approval_id is null then
      new.attempt := 1;
    else
      select * into prev from office.approvals o where o.id = new.previous_approval_id;
      if prev.id is null or prev.status <> 'changes_requested' or prev.agent_code <> new.agent_code
         or prev.task_id is distinct from new.task_id
         or prev.basis_type is distinct from new.basis_type
         or prev.basis_id is distinct from new.basis_id then
        raise exception 'The previous approval is not this work''s approval with changes requested'
          using errcode = 'check_violation';
      end if;
      if prev.attempt >= 2 then
        raise exception 'After the second change request the work falls to a person'
          using errcode = 'check_violation';
      end if;
      new.attempt := prev.attempt + 1;
    end if;
    return new;
  end if;

  -- Invalidation: only the trigger role writes it, when the basis changes.
  if new.invalidated_at is distinct from old.invalidated_at
     and current_user <> 'office_trigger' then
    raise exception 'An approval cannot be invalidated manually'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status <> 'pending' then
    if new.status is distinct from old.status
       or new.decision_reason is distinct from old.decision_reason
       or new.rejection_reason is distinct from old.rejection_reason
       or new.selected_option is distinct from old.selected_option
       or new.summary is distinct from old.summary
       or new.risk_note is distinct from old.risk_note
       or new.priority is distinct from old.priority then
      raise exception 'A decided approval cannot be changed' using errcode = 'check_violation';
    end if;
  elsif new.summary is distinct from old.summary
     or new.risk_note is distinct from old.risk_note
     or new.priority is distinct from old.priority then
    if agent is null and not office.can_approve() then
      raise exception 'The approval summary is changed by an agent or by a person who can approve'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.status = 'pending' and new.status <> 'pending' then
    if agent is not null or not office.can_approve() then
      raise exception 'Only a person who can approve makes the approval decision'
        using errcode = 'insufficient_privilege';
    end if;
    new.decided_by_user_id := office.ctx_user_id();
    new.decided_at := pg_catalog.now();
    if new.status = 'approved' then
      if old.invalidated_at is not null
         or (old.basis_id is not null
             and office.basis_version_of(old.basis_type, old.basis_id)
               is distinct from old.basis_version) then
        raise exception 'The record the approval is based on changed; the approval is closed'
          using errcode = 'check_violation';
      end if;
      if old.options is not null and not (
        old.options @> pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('code', new.selected_option)
        )
      ) then
        raise exception 'An approval with options needs a valid option selected'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.sent_at is distinct from old.sent_at
     or new.sent_by_user_id is distinct from old.sent_by_user_id then
    if old.sent_at is not null then
      raise exception 'The sent mark cannot be changed' using errcode = 'check_violation';
    end if;
    if agent is not null or not office.is_insider() then
      raise exception 'The sent mark is set by a person' using errcode = 'insufficient_privilege';
    end if;
    new.sent_by_user_id := office.ctx_user_id();
    new.sent_at := pg_catalog.now();
  end if;
  return new;
end
$$;
create trigger check_approval before insert or update on office.approvals
  for each row execute function office.check_approval();
create trigger project_1_from_run before insert on office.approvals
  for each row execute function office.inherit_project_scope('runs', 'run_id', 'derive');
create trigger project_2_from_task before insert on office.approvals
  for each row execute function office.inherit_project_scope('tasks', 'task_id', 'check');

-- When the basis changes or is deleted, the pending approval is closed (X1-7).
grant select (id, company_id, basis_type, basis_id, basis_version, status, invalidated_at),
  update (invalidated_at)
  on office.approvals to office_trigger;
-- The new version of an updated row must also pass the read policy; that is why reading is separate
-- and broad.
create policy trigger_reads on office.approvals for select to office_trigger using (true);
create policy basis_invalidation on office.approvals for update to office_trigger
  using (status = 'pending' and invalidated_at is null) with check (true);

create function office.invalidate_approvals() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  rec_id uuid;
  rec_company uuid;
  new_version integer;
begin
  if tg_op = 'DELETE' then
    rec_id := old.id;
    rec_company := old.company_id;
    new_version := 2147483647;
  else
    if new.version = old.version then
      return null;
    end if;
    rec_id := new.id;
    rec_company := new.company_id;
    new_version := new.version;
  end if;
  update office.approvals o set invalidated_at = pg_catalog.now()
    where o.basis_type = tg_argv[0] and o.basis_id = rec_id and o.company_id = rec_company
      and o.basis_version < new_version and o.status = 'pending' and o.invalidated_at is null;
  return null;
end
$$;
alter function office.invalidate_approvals() owner to office_trigger;
create trigger invalidate_approvals after update or delete on office.tasks
  for each row execute function office.invalidate_approvals('task');
create trigger invalidate_approvals after update or delete on office.notes
  for each row execute function office.invalidate_approvals('note');

-- Rule 4: an external effect tool call is opened only with an approved approval given to this
-- agent, for this tool, not closed and whose basis has not changed. An approval links to a single
-- call record (a retry needs a new approval).
alter table office.tool_calls
  add foreign key (approval_id, company_id) references office.approvals (id, company_id);
create unique index tool_calls_approval_single_use on office.tool_calls (approval_id);

create function office.external_effect_gate() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' and old.approval_id is not null
     and new.approval_id is distinct from old.approval_id then
    raise exception 'A tool call''s approval cannot be changed' using errcode = 'check_violation';
  end if;
  -- The gate is checked on the move to execution; an approval closed during execution does not
  -- prevent the record from being finished.
  if new.status in ('started', 'succeeded')
     and (tg_op = 'INSERT' or old.status not in ('started', 'succeeded'))
     and exists (
       select 1 from office.tools a where a.name = new.tool_name and a.kind = 'external_effect'
     )
     and not exists (
       select 1 from office.approvals o, office.runs c
       where o.id = new.approval_id and o.status = 'approved' and o.invalidated_at is null
         and o.tool_name = new.tool_name
         and c.id = new.run_id and c.agent_code = o.agent_code
         and (o.basis_id is null
              or office.basis_version_of(o.basis_type, o.basis_id) = o.basis_version)
     ) then
    raise exception 'An external effect tool call cannot be executed without approval (rule 4)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger external_effect_gate before insert or update on office.tool_calls
  for each row execute function office.external_effect_gate();

-- Decision 12: the founder flags an approved piece of work as a critical error with a reason; a
-- review task is opened. Where the authority level drops is an open question (N12).
create table office.critical_errors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  approval_id uuid not null unique,
  agent_code text not null references office.agent_definitions (code),
  reason text not null check (length(trim(reason)) > 0),
  flagged_by_user_id uuid not null references office.users (id),
  review_task_id uuid,
  created_at timestamptz not null default now(),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (approval_id, company_id) references office.approvals (id, company_id),
  foreign key (review_task_id, company_id) references office.tasks (id, company_id)
);

create function office.check_critical_error() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  approval office.approvals;
begin
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder flags a critical error'
      using errcode = 'insufficient_privilege';
  end if;
  select * into approval from office.approvals o where o.id = new.approval_id;
  if approval.id is null or approval.status <> 'approved' then
    raise exception 'A critical error can only be set on approved work'
      using errcode = 'check_violation';
  end if;
  new.agent_code := approval.agent_code;
  new.project_id := approval.project_id;
  new.flagged_by_user_id := office.ctx_user_id();
  new.created_at := pg_catalog.now();
  return new;
end
$$;
create trigger check_critical_error before insert on office.critical_errors
  for each row execute function office.check_critical_error();

-- Notification log (M46): to whom, with which template, for which record, over which channel. No
-- free text; a phone notification carries no sensitive information (M53 open).
create table office.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  project_id uuid,
  recipient_user_id uuid not null,
  template text not null check (template ~ '^[a-z][a-z0-9_]*$'),
  record_type text check (record_type ~ '^[a-z][a-z0-9_]*$'),
  record_id uuid,
  channel text not null default 'panel' check (channel in ('panel', 'push', 'email')),
  sender_agent_code text references office.agent_definitions (code),
  sender_user_id uuid references office.users (id),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (company_id, recipient_user_id) references office.memberships (company_id, user_id)
    on delete cascade,
  constraint record_complete check ((record_type is null) = (record_id is null))
);
create index notifications_recipient on office.notifications (recipient_user_id, created_at desc);

create function office.set_notification_sender() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.sender_agent_code := office.ctx_agent_code();
  new.sender_user_id := case when new.sender_agent_code is null then office.ctx_user_id() end;
  new.created_at := pg_catalog.now();
  new.read_at := null;
  return new;
end
$$;
create trigger set_notification_sender before insert on office.notifications
  for each row execute function office.set_notification_sender();

alter table office.approvals enable row level security;
alter table office.approvals force row level security;
alter table office.critical_errors enable row level security;
alter table office.critical_errors force row level security;
alter table office.notifications enable row level security;
alter table office.notifications force row level security;

-- An approval record is not deleted; once opened its content columns cannot change (only the
-- columns below).
grant select, insert, update (
  summary, risk_note, priority, status, decision_reason, rejection_reason, selected_option,
  sent_by_user_id, sent_at
) on office.approvals to office_app;
grant select, insert, update (review_task_id) on office.critical_errors to office_app;
grant select, insert, update (read_at) on office.notifications to office_app;

-- If the note an approval record is based on is a draft, the approval is visible only to those who
-- can see the draft (3 October, decision 1). If the note was deleted the approval stays visible;
-- that is why the note is read with the reader role, without hitting the row policy.
grant select (id, status, created_by_agent_code, created_by_user_id) on office.notes
  to office_auth_reader;
create policy reader on office.notes for select to office_auth_reader using (true);

/*
 * KOR-3 also sees approval records whose basis is an agent draft (3 October, decision 3).
 *
 * KOR-3 summarises pending approvals for the founder. Under 3 October decision 1, an approval
 * record based on an agent draft (it carries the draft's text) was open among agents only to the
 * agent that wrote the draft; the founder asked for KOR-3 to summarise these approvals too. The
 * exception is narrow: only the approval record (not the draft note itself), only KOR-3, and only
 * while the run's identity can approve (KOR-3's scheduled run runs on behalf of the founder, its
 * owner). The summary goes only to the founder; the runner enforces that.
 */
create function office.basis_note_visible(p_note uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(
      (select office.draft_visible(n.status, n.created_by_agent_code, n.created_by_user_id)
       from office.notes n where n.id = p_note),
      true
    )
    or (office.ctx_agent_code() = 'KOR-3' and office.can_approve())
  $$;
alter function office.basis_note_visible(uuid) owner to office_auth_reader;
grant execute on function office.basis_note_visible(uuid) to office_app;

create policy visible on office.approvals for select to office_app
  using (
    office.row_visible(company_id, project_id)
    and (basis_type is distinct from 'note' or office.basis_note_visible(basis_id))
  );
create policy agent_opens on office.approvals for insert to office_app
  with check (office.row_visible(company_id, project_id) and agent_code = office.ctx_agent_code());
create policy updates on office.approvals for update to office_app
  using (
    office.row_visible(company_id, project_id)
    and (office.ctx_agent_code() is not null or office.is_insider())
    and (basis_type is distinct from 'note' or office.basis_note_visible(basis_id))
  );

create policy visible on office.critical_errors for select to office_app
  using (office.row_visible(company_id, project_id));
create policy founder_inserts on office.critical_errors for insert to office_app
  with check (
    office.row_visible(company_id, project_id)
    and office.is_founder()
    and office.ctx_agent_code() is null
  );
create policy founder_updates on office.critical_errors for update to office_app
  using (
    office.row_visible(company_id, project_id)
    and office.is_founder()
    and office.ctx_agent_code() is null
  );

-- The recipient sees their own notifications and marks them read; agents and the founder see the
-- company's notification log (so as not to send a notification twice).
create policy recipient_reads on office.notifications for select to office_app
  using (
    company_id = office.ctx_company_id()
    and recipient_user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
    and office.my_role() is not null
  );
create policy log_visible on office.notifications for select to office_app
  using (
    office.row_visible(company_id, project_id)
    and (office.ctx_agent_code() is not null or office.is_founder())
  );
create policy inserts on office.notifications for insert to office_app
  with check (office.row_visible(company_id, project_id));
create policy recipient_marks_read on office.notifications for update to office_app
  using (
    company_id = office.ctx_company_id()
    and recipient_user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
  );
