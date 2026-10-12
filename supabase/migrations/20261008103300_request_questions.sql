-- An agent asks the requester a question (7 October decision 7; 12 October decisions 3 and 4;
-- 1 October second round decision 4: "Ajanın soruları insana sor yoluyla gelir ve onaya düşmez";
-- CLAUDE.md "İnsana sor", rules 4, 5, 7, 9, 10; docs/SONRA.md W-j, W-k, W-l, X1-6).
--
-- Until now an agent that lacked a piece of information either wrote with what it had or ended
-- without a result, and the work fell to the approver while the requester learned nothing. From
-- here on the agent whose turn it is (the coordinator before a routing, the agent of the active
-- step after it) may stop its run with ONE question to the requester:
--   - the question is a record of its own, office.task_questions. It is not a row of approvals
--     (rule 4: an approval is the gate of an output or an act; a question releases nothing and
--     is shown to the requester without anybody's approval) and not a comment (8 October
--     decision 13: comments are people's text for people, no agent writes or reads one);
--   - the request becomes "Yanıt bekliyor" (tasks.status awaiting_reply, which exists since the
--     tasks migration and was written by nothing);
--   - only the requester answers; while the requester cannot read the request the founder
--     answers in their place (8 October decision 45, derived). An answer is never changed;
--   - the answer puts the request back in progress, and the API puts the job of the same agent
--     on the queue in the same transaction (ids only, rule 10);
--   - a new routing, a cancel, a stop and a rejection close an open question
--     (office.flow_close_pending, which all four already call).
--
-- How often an agent may ask is held here and not in a prompt (12 October decisions 3 and 4):
-- office.question_limit says 1 for every agent and 2 for the coordinator, counted per request
-- and agent over every question that agent ever asked on it, whatever became of the question.
-- The coordinator's number is not decided by the founder yet (docs/SONRA.md): it is the one
-- number in the one function.
--
-- Who reads a question and its answer (docs/SONRA.md W-k): the requester, the founder and the
-- approver of the request, as people through the API. Everybody else who reads the request
-- learns from its status that it waits for an answer and nothing more (the migration after this
-- one adds a yes or no and a time to office.request_flow_facts, never text). An agent run reads
-- nothing of the table by itself: the worker's role has no privilege on it. A run is given the
-- answered questions of the one request it is running on by office.run_questions, and asks
-- through office.ask_question; nothing else of the table is reachable from an agent run.
--
-- Nobody writes the table but the functions below (owner office_trigger). No application role
-- has insert, update or delete on it.
--
-- Work that waits (8 October decision 49; 11 October decision 1): an answer calls for the work
-- again. The migration after this one makes office.flow_waiting_work count the moment of the
-- answer as a moment the work was called for, so an answer that found its agent stopped, the AI
-- permission closed or the AI spending limit reached is started by the existing restart when
-- the block lifts.
--
-- Audit (2 October decision 13: names and ids only): request_question_asked (with the run),
-- request_question_answered, request_question_closed; record_type task_question. The three
-- events are the flow's alone.
--
-- Error codes. office.ask_question: 42501 not an agent's own running run in the resolved name
-- and in the project context of the request; P0002 no such request; 23514 the request cannot
-- take a question now (closed, waits for a decision or an answer, it is not this agent's turn,
-- or agents may not work in its project now: rule 12); 54000 the agent has used its questions
-- on this request; 22023 the text is empty or too long. office.answer_question: 42501
-- an agent run, or a person who is neither the requester nor the founder standing in; P0002 no
-- such question for this person; 23514 the question is not open or the request is closed; 22023
-- the text is empty or too long.

-- The table -----------------------------------------------------------------------------------

create table office.task_questions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  -- Comes from the task's project.
  project_id uuid,
  task_id uuid not null,
  -- The step whose agent asked; null: the coordinator asked before the request was routed.
  routing_id uuid,
  agent_code text not null references office.agent_definitions (code),
  -- The run that ended with this question.
  run_id uuid not null,
  -- Whom the question is for: the requester of the request, read from the request.
  requester_user_id uuid not null references office.users (id),
  question text not null check (length(btrim(question)) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer text check (answer is null or length(btrim(answer)) between 1 and 10000),
  -- The requester, or the founder in the requester's place.
  answered_by_user_id uuid references office.users (id),
  answered_at timestamptz,
  -- Closed without an answer: the request was routed again, cancelled, stopped or rejected.
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  -- One run ends with at most one question.
  unique (run_id),
  foreign key (task_id, company_id) references office.tasks (id, company_id),
  foreign key (project_id, company_id) references office.projects (id, company_id),
  foreign key (routing_id, company_id) references office.task_routings (id, company_id),
  foreign key (run_id, company_id) references office.runs (id, company_id),
  constraint answer_complete check (
    (status = 'answered') = (answer is not null)
    and (status = 'answered') = (answered_by_user_id is not null)
    and (status = 'answered') = (answered_at is not null)
    and (status = 'closed') = (closed_at is not null)
  )
);
-- One question of a request is open at a time.
create unique index task_questions_single_open on office.task_questions (task_id)
  where status = 'open';
create index task_questions_task on office.task_questions (task_id, created_at);

create trigger immutable_columns before update on office.task_questions
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'task_id', 'routing_id', 'agent_code', 'run_id',
    'requester_user_id', 'question', 'created_at'
  );

-- An answered or closed question never changes again (holds for every role).
create function office.keep_question_settled() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if old.status <> 'open' then
    raise exception 'A question that was answered or closed cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger keep_question_settled before update on office.task_questions
  for each row execute function office.keep_question_settled();

alter table office.task_questions enable row level security;
alter table office.task_questions force row level security;

/*
 * May the context person read the questions of this request and their answers: its requester,
 * the founder, or its approver (docs/SONRA.md W-k). The same three people who may comment on it
 * (office.may_comment_on_request: the approver is the person appointed for the active step or,
 * when none is active, for the step that was active last, while holding the approval right).
 * A function of its own, so that one rule can change without the other. Runs with the caller's
 * rights: a request the caller cannot read answers false; never true in an agent run.
 */
create function office.may_read_request_questions(p_task uuid) returns boolean
  language sql stable set search_path = ''
  as $$ select office.may_comment_on_request(p_task) $$;
revoke execute on function office.may_read_request_questions(uuid) from public;
grant execute on function office.may_read_request_questions(uuid) to office_app;

-- People read through the API's role only. The worker's role has no privilege on the table,
-- whatever context it sets: a question and its answer reach an agent run only through
-- office.run_questions.
grant select on office.task_questions to office_api_private;
create policy people_read on office.task_questions for select to office_api_private
  using (
    office.row_visible(company_id, project_id)
    and office.may_read_request_questions(task_id)
  );

grant select, insert, update (status, answer, answered_by_user_id, answered_at, closed_at)
  on office.task_questions to office_trigger;
create policy flow_all on office.task_questions for all to office_trigger
  using (true) with check (true);

-- The three events are written by the functions below and by nothing else.
create policy reserved_question_events on office.audit_log as restrictive for insert to office_app
  with check (
    event not in (
      'request_question_asked', 'request_question_answered', 'request_question_closed'
    )
  );

-- The asking tool is the runner's own (CLAUDE.md "İnsana sor"): its name can never be a row of
-- the catalog, so no card can list it and no tool call row can carry it. The card schema refuses
-- the name too (packages/shared: RUNNER_PATH_TOOLS); this is the line behind it.
alter table office.tools add constraint runner_path_names check (name <> 'ask_requester');

-- The limits ----------------------------------------------------------------------------------

/*
 * How many questions an agent may ask on one request (12 October decisions 3 and 4): one; the
 * coordinator two. The coordinator's number awaits the founder (docs/SONRA.md): it changes here
 * and nowhere else. Counted over every question the agent asked on the request, also one that
 * was closed without an answer and one of an earlier step.
 */
create function office.question_limit(p_agent text) returns integer
  language sql immutable set search_path = ''
  as $$ select case when p_agent = office.coordinator_agent_code() then 2 else 1 end $$;
alter function office.question_limit(text) owner to office_trigger;
revoke execute on function office.question_limit(text) from public;

/*
 * How many questions the context agent may still ask on this request: what the runner reads when
 * it opens a run, to decide whether the model is offered the asking tool at all. 0 for anything
 * that is not a request of the context company, outside an agent run, for a caller whose
 * person is not the one the database resolves for the request (8 October decision 45), and for
 * a context that does not carry the project of the request (the project visibility rule: a run
 * without a project context reaches nothing of a project, a run with one only its own).
 * office.ask_question holds the same limit again when a question is written.
 */
create function office.questions_left(p_task uuid) returns integer
  language sql stable security definer set search_path = ''
  as $$
    select coalesce((
      select greatest(
        office.question_limit(office.ctx_agent_code()) - (
          select count(*) from office.task_questions q
          where q.task_id = t.id and q.agent_code = office.ctx_agent_code()
        ),
        0
      )::integer
      from office.tasks t
      where t.id = p_task
        and t.kind = 'request'
        and t.company_id = office.ctx_company_id()
        and office.ctx_agent_code() is not null
        -- The project context of the run is the request's own (no project: none).
        and t.project_id is not distinct from office.ctx_project_id()
        and office.request_run_identity(t.id) = office.ctx_user_id()
    ), 0)
  $$;
alter function office.questions_left(uuid) owner to office_trigger;
revoke execute on function office.questions_left(uuid) from public;
grant execute on function office.questions_left(uuid) to office_app;

-- Asking ---------------------------------------------------------------------------------------

/*
 * The agent's question, from its own running run (the runner's "insana sor" path; it never
 * reaches the approval desk). Writes one row for the requester of the request, puts the request
 * to "Yanıt bekliyor" and leaves the audit row. The caller (the runner) ends its run in the same
 * transaction. Nothing of the row is the caller's to choose but the text: the addressee, the
 * step, the agent and the project are read from the request and the run.
 * Who may: the agent whose turn it is, from its own running run on this request, in the name the
 * database resolves for the request and in the project context of the request: the coordinator
 * while nobody has routed the request, the agent of the active step from the run that was opened
 * for that step. Not while agents may not work in the request's project (rule 12).
 */
create function office.ask_question(p_task uuid, p_run uuid, p_question text) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_company uuid;
  v_project uuid;
  v_status text;
  v_requester uuid;
  v_agent text := office.ctx_agent_code();
  v_user uuid := office.ctx_user_id();
  v_run_step uuid;
  v_step uuid;
  v_text text := pg_catalog.btrim(coalesce(p_question, ''));
  v_id uuid;
begin
  if v_agent is null or p_run is null then
    raise exception 'An agent asks from its own run' using errcode = 'insufficient_privilege';
  end if;
  -- The request first, as every act on a request does.
  select t.company_id, t.project_id, t.status, t.requester_user_id
    into v_company, v_project, v_status, v_requester
    from office.tasks t
    where t.id = p_task and t.company_id = office.ctx_company_id() and t.kind = 'request'
    for update;
  if v_company is null or office.my_role() is null then
    raise exception 'No such request' using errcode = 'no_data_found';
  end if;
  -- A run works in the project context of its request and in no other (none for a request
  -- without a project): a context that does not carry it is not this request's run.
  if v_project is distinct from office.ctx_project_id() then
    raise exception 'A question is asked in the project context of the request'
      using errcode = 'insufficient_privilege';
  end if;
  -- The caller's own running run on this request, in the name the database resolves for it.
  select r.routing_id into v_run_step
    from office.runs r
    where r.id = p_run and r.company_id = v_company and r.task_id = p_task
      and r.agent_code = v_agent and r.user_id = v_user and r.status = 'running';
  if not found or office.request_run_identity(p_task) is distinct from v_user then
    raise exception 'A question is asked from the agent''s own running run on the request'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('open', 'in_progress') then
    raise exception 'The request takes no question now' using errcode = 'check_violation';
  end if;
  -- Rule 12, behind the runner's own check: no question is stored for a project where agents
  -- may not work now. The share lock of office.project_allows_ai makes a permission that is
  -- being closed in this instant wait for this transaction, or this question wait for it.
  if not office.project_allows_ai(v_project) then
    raise exception 'Agents do not work in this project now' using errcode = 'check_violation';
  end if;
  -- Whose turn it is.
  if exists (select 1 from office.task_routings r where r.task_id = p_task) then
    select r.id into v_step
      from office.task_routings r
      where r.task_id = p_task and r.status = 'active' and r.agent_code = v_agent;
    if v_step is null or v_run_step is distinct from v_step then
      raise exception 'The request is not routed to this run' using errcode = 'check_violation';
    end if;
  elsif v_agent <> office.coordinator_agent_code() or v_run_step is not null then
    raise exception 'Only the coordinator asks before a request is routed'
      using errcode = 'check_violation';
  end if;
  if (
    select count(*) from office.task_questions q
    where q.task_id = p_task and q.agent_code = v_agent
  ) >= office.question_limit(v_agent) then
    raise exception 'This agent has asked as often as it may on this request'
      using errcode = 'program_limit_exceeded';
  end if;
  if pg_catalog.length(v_text) not between 1 and 2000 then
    raise exception 'A question has 1 to 2000 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into office.task_questions
      (company_id, project_id, task_id, routing_id, agent_code, run_id, requester_user_id,
       question)
    values (v_company, v_project, p_task, v_step, v_agent, p_run, v_requester, v_text)
    returning id into v_id;
  perform office.flow_set_status(p_task, 'awaiting_reply');
  insert into office.audit_log (company_id, project_id, event, record_type, record_id, run_id)
    values (v_company, v_project, 'request_question_asked', 'task_question', v_id, p_run);
  return v_id;
end
$$;
alter function office.ask_question(uuid, uuid, text) owner to office_trigger;
revoke execute on function office.ask_question(uuid, uuid, text) from public;
grant execute on function office.ask_question(uuid, uuid, text) to office_app;

/*
 * What a run is given of the questions of its request: the answered ones, each with the code of
 * the agent that asked, oldest first. Answers only a context whose company, agent, person and
 * project are those of the named run, and only while that run is running: the runner names its
 * own run (the id is the runner's, never a model's input), so a run is given the questions of
 * the one request it is working on. An open or a closed question has no answer and is not given.
 */
create function office.run_questions(p_run uuid)
  returns table (
    id uuid, agent_code text, question text, answer text, asked_at timestamptz,
    answered_at timestamptz, answered_in_place boolean
  )
  language sql stable security definer set search_path = ''
  as $$
    select q.id, q.agent_code, q.question, q.answer, q.created_at, q.answered_at,
           q.answered_by_user_id is distinct from q.requester_user_id
    from office.runs r
    join office.task_questions q on q.task_id = r.task_id and q.company_id = r.company_id
    where r.id = p_run
      and r.company_id = office.ctx_company_id()
      and office.ctx_agent_code() is not null
      and r.agent_code = office.ctx_agent_code()
      and r.user_id = office.ctx_user_id()
      -- The run's project is the context's (none for a request without a project).
      and r.project_id is not distinct from office.ctx_project_id()
      and r.status = 'running'
      and q.status = 'answered'
    order by q.created_at, q.id
  $$;
alter function office.run_questions(uuid) owner to office_trigger;
revoke execute on function office.run_questions(uuid) from public;
grant execute on function office.run_questions(uuid) to office_app;

-- No run opens on a request while a question of it is open: the work waits for the answer. The
-- runner asks first and answers such a job as one with nothing to do; this is the line behind it.
create function office.hold_run_while_question_open() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if new.task_id is not null and exists (
    select 1 from office.task_questions q where q.task_id = new.task_id and q.status = 'open'
  ) then
    raise exception 'The request waits for an answer' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
alter function office.hold_run_while_question_open() owner to office_trigger;
revoke execute on function office.hold_run_while_question_open() from public;
create trigger question_holds before insert on office.runs
  for each row execute function office.hold_run_while_question_open();

-- Answering ------------------------------------------------------------------------------------

/*
 * The answer to an open question (7 October decision 7: the requester answers the agent's
 * question). Only through the API, never in an agent run. Who may: the requester; or the
 * founder, while the requester cannot read the request (8 October decision 45, derived). The
 * answer is stored once and never changed; the request is in progress again. Returns what the
 * API puts on the queue in this same transaction: the request, the agent that asked (the same
 * agent runs again) and the requester as the job's person, with whether that agent is open in
 * the company now (a stopped agent takes no job: the API leaves the trace run_not_started
 * instead, which the restart reads when the agent is opened again).
 */
create function office.answer_question(p_question uuid, p_answer text)
  returns table (task_id uuid, agent_code text, requester_user_id uuid, agent_enabled boolean)
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_task uuid;
  v_company uuid;
  v_project uuid;
  v_task_status text;
  v_status text;
  v_agent text;
  v_requester uuid;
  v_user uuid := office.ctx_user_id();
  v_text text := pg_catalog.btrim(coalesce(p_answer, ''));
begin
  if office.ctx_agent_code() is not null or v_user is null then
    raise exception 'A person answers a question' using errcode = 'insufficient_privilege';
  end if;
  select q.task_id into v_task from office.task_questions q
    where q.id = p_question and q.company_id = office.ctx_company_id();
  -- The request first (the lock every act of a person takes), for a person who may read it.
  select t.company_id, t.project_id, t.status
    into v_company, v_project, v_task_status
    from office.tasks t
    where t.id = v_task and t.company_id = office.ctx_company_id() and t.kind = 'request'
      and office.is_insider()
      and (
        t.project_id is null or office.is_founder() or office.is_project_member(t.project_id)
      )
    for update;
  if v_company is null then
    raise exception 'No such question' using errcode = 'no_data_found';
  end if;
  select q.status, q.agent_code, q.requester_user_id
    into v_status, v_agent, v_requester
    from office.task_questions q where q.id = p_question for update;
  if not (
    v_user = v_requester
    or (
      office.is_founder()
      and office.request_run_identity(v_task) is distinct from v_requester
    )
  ) then
    raise exception 'Only the requester answers, or the founder in the place of a requester who cannot read the request'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'open' or v_task_status in ('done', 'cancelled') then
    raise exception 'The question is not open' using errcode = 'check_violation';
  end if;
  if pg_catalog.length(v_text) not between 1 and 10000 then
    raise exception 'An answer has 1 to 10000 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  -- The transaction's own time: a trace the API writes in this transaction (run_not_started)
  -- carries the same moment, and the restart counts a trace from the moment of the call on.
  update office.task_questions q
    set status = 'answered', answer = v_text, answered_by_user_id = v_user,
        answered_at = pg_catalog.now()
    where q.id = p_question;
  perform office.flow_set_status(v_task, 'in_progress');
  insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    values (v_company, v_project, 'request_question_answered', 'task_question', p_question);
  task_id := v_task;
  agent_code := v_agent;
  requester_user_id := v_requester;
  -- The agent's switch is read behind the lock every restart of the company takes exclusively
  -- (office.restart_waiting_work), as the runner reads it before it writes a refusal: an agent
  -- that is opened in this instant is either read as open here (its restart has committed), or
  -- its restart waits for this transaction and finds the trace the API writes for a stopped agent.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('office.restart:' || v_company::text, 0)
  );
  agent_enabled := exists (
    select 1 from office.company_agents ca
    where ca.company_id = v_company and ca.agent_code = v_agent and ca.status = 'enabled'
  );
  return next;
end
$$;
alter function office.answer_question(uuid, text) owner to office_trigger;
revoke execute on function office.answer_question(uuid, text) from public;
grant execute on function office.answer_question(uuid, text) to office_api_private;

-- Closing --------------------------------------------------------------------------------------

-- office.flow_close_pending as of the requester approvals migration (20261007100700), with the
-- open question closed too. Its callers are unchanged: a new routing (the coordinator's or a
-- person's), a cancel, a stop and a rejection. "create or replace" keeps the owner and the
-- privileges (nobody but functions of the same owner).
create or replace function office.flow_close_pending(p_task uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  update office.approvals a set invalidated_at = pg_catalog.now()
    where a.task_id = p_task and a.status = 'pending' and a.invalidated_at is null;
  update office.requester_approvals q set invalidated_at = pg_catalog.now()
    where q.task_id = p_task and q.status = 'pending' and q.invalidated_at is null;
  -- A question nobody answered: the request went on without it.
  with closed as (
    update office.task_questions q set status = 'closed', closed_at = pg_catalog.now()
      where q.task_id = p_task and q.status = 'open'
      returning q.id, q.company_id, q.project_id
  )
  insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    select c.company_id, c.project_id, 'request_question_closed', 'task_question', c.id
    from closed c;
end
$$;
