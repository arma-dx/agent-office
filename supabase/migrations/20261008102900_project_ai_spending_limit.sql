-- The AI spending limit of a project (8 October decisions 17 and 28; docs/SONRA.md P-t, X1-4,
-- P3-m to P3-z; CLAUDE.md rules 3, 5, 9 and 12).
--
-- Decision 17: a project can carry a limit on what its agents spend; when it is reached the
-- agents stop in that project. From here on:
--   - projects.ai_spend_limit_usd is the limit in US dollars; null means no limit (the default);
--   - what counts toward it is the recorded cost of every run of that project (runs.cost_usd,
--     rule 5), over the whole life of the project;
--   - the limit is REACHED when that sum is equal to or above it. office.
--     project_spending_limit_reached answers it for an agent run and for a reader of the project;
--     the runner asks it at the start of every run on a request and after every model call;
--   - only the founder sets it, through office.set_project_ai_spending_limit, which only the
--     API's role may call; the column is in no application role's grant. Setting a first limit
--     and lowering one need no passkey: they only stop agents earlier. Raising a limit and taking
--     it away let agents spend more: the check uses up a passkey re-verification of the founder
--     for exactly that project (purpose project_ai_spending_limit), recorded in the same
--     transaction;
--   - work that waits (decision 49) is not started by an opening while the limit of its project
--     is reached: office.flow_waiting_work asks for it. Raising the limit starts nothing by
--     itself: a run that met a limit falls to a person (decision 28; docs/SONRA.md P3-s).
-- A write without a person in the context (migrations, the seed, an administrator) is left
-- alone, as for the AI permission.
--
-- Nothing here stops a run that is open: the runner ends it before its next model call. No lock
-- can order "the sum" against a run that is paying for a call at the same moment, so the sum can
-- pass the limit by the cost of the calls that were in flight.
-- No run ROW is written in a project at its limit, whoever writes it: the runner asks
-- first (and tells the person why), and office.check_run_spending_limit stands behind it, as the
-- stop switch stands in office.check_run_start.
--
-- Error codes: 28000 a re-verification is missing, 42501 not the founder or an agent run, P0002
-- no such project, 22023 a limit that is missing where one is needed, not above zero, above
-- 999999.99 or with more than two decimals, 54000 a run row in a project whose limit is reached.

-- 'NaN' is named: numeric takes it, 'NaN' > 0 is true, and no sum is ever at or above it.
alter table office.projects
  add column ai_spend_limit_usd numeric(8, 2)
    constraint projects_ai_spend_limit_check
      check (ai_spend_limit_usd > 0 and ai_spend_limit_usd <> 'NaN'::numeric);

-- Re-verification purpose -------------------------------------------------------------------------

-- One new purpose, for a company (rule 2):
--   project_ai_spending_limit   subject: the project whose limit is raised or taken away
alter table office.step_ups drop constraint step_ups_purpose_check;
alter table office.step_ups add constraint step_ups_purpose_check check (
  purpose in (
    'approve', 'membership_change', 'invitation', 'passkey_add', 'passkey_revoke', 'passkey_reset',
    'access_grant', 'project_ai_permission', 'customer_ai_permission',
    'project_ai_spending_limit'
  )
);
alter table office.step_ups drop constraint company_with_company_purpose;
alter table office.step_ups add constraint company_with_company_purpose check (
  (company_id is not null) = (
    purpose in (
      'approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant',
      'project_ai_permission', 'customer_ai_permission', 'project_ai_spending_limit'
    )
  )
);

/*
 * Records a re-verification after the API verified the assertion (signature, origin, user
 * verification, user handle). Unchanged except for the new purpose; same signature, owner and
 * privileges as before.
 *   approve, membership_change, invitation, passkey_reset, access_grant, project_ai_permission,
 *   customer_ai_permission, project_ai_spending_limit
 *                               company: the context company, where the person is a member;
 *                               subject: the approval, the member whose membership or account
 *                               changes, the invitation created or renewed, the person whose
 *                               passkeys are reset, the person a task or a note is opened to, the
 *                               project or the customer whose AI permission is opened, the
 *                               project whose AI spending limit is raised or taken away
 *   passkey_add                 no company, no subject
 *   passkey_revoke              no company; subject: the ref of an active passkey of the person
 * Whether the person may make the change is decided where the re-verification is used up (the
 * checks and reset_passkeys), not here. Returns the re-verification's id.
 */
create or replace function office.record_step_up(
  p_key_hash bytea,
  p_challenge_id uuid,
  p_credential_id text,
  p_new_counter bigint,
  p_purpose text,
  p_company_id uuid,
  p_subject_id uuid,
  p_context_hash bytea
) returns uuid
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_session office.sessions := office.live_session(p_key_hash);
  v_challenge office.passkey_challenges;
  v_passkey office.passkeys;
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  if p_context_hash is null or pg_catalog.octet_length(p_context_hash) <> 32 then
    raise exception 'The context hash must be 32 bytes' using errcode = 'invalid_parameter_value';
  end if;
  if p_new_counter is null or p_new_counter not between 0 and 4294967295 then
    raise exception 'The signature counter is out of range'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_purpose in (
    'approve', 'membership_change', 'invitation', 'passkey_reset', 'access_grant',
    'project_ai_permission', 'customer_ai_permission', 'project_ai_spending_limit'
  ) then
    if p_company_id is null or p_subject_id is null then
      raise exception 'A re-verification for % names the company and the subject', p_purpose
        using errcode = 'invalid_parameter_value';
    end if;
    if p_company_id is distinct from office.ctx_company_id() or not exists (
      select 1 from office.memberships m
      where m.company_id = p_company_id and m.user_id = v_session.user_id
    ) then
      raise exception 'A re-verification for a company is recorded only in that company''s context'
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_purpose = 'passkey_add' then
    if p_company_id is not null or p_subject_id is not null then
      raise exception 'A re-verification for adding a passkey names no company and no subject'
        using errcode = 'invalid_parameter_value';
    end if;
  elsif p_purpose = 'passkey_revoke' then
    if p_company_id is not null or p_subject_id is null or not exists (
      select 1 from office.passkeys p
      where p.ref = p_subject_id and p.user_id = v_session.user_id and p.revoked_at is null
    ) then
      raise exception 'A re-verification for revoking names an active passkey of the person'
        using errcode = 'invalid_parameter_value';
    end if;
  else
    raise exception 'Unknown re-verification purpose' using errcode = 'invalid_parameter_value';
  end if;

  select c.* into v_challenge
  from office.passkey_challenges c
  where c.id = p_challenge_id
    and c.session_id = v_session.id
    and c.user_id = v_session.user_id
    and c.purpose = 'step_up'
    and c.consumed_at is null
    and c.expires_at > pg_catalog.now()
    and c.failed_attempts < 5
  for update;
  if v_challenge.id is null then
    raise exception 'No open re-verification challenge of this session'
      using errcode = 'invalid_authorization_specification';
  end if;
  if v_challenge.context_hash is distinct from p_context_hash then
    raise exception 'The re-verification was signed for something else'
      using errcode = 'invalid_authorization_specification';
  end if;

  select p.* into v_passkey
  from office.passkeys p
  where p.id = p_credential_id and p.user_id = v_session.user_id and p.revoked_at is null
  for update;
  if v_passkey.id is null then
    raise exception 'Not an active passkey of this person'
      using errcode = 'invalid_authorization_specification';
  end if;
  if (v_passkey.counter > 0 or p_new_counter > 0) and p_new_counter <= v_passkey.counter then
    raise exception 'The signature counter did not increase; the passkey may be cloned'
      using errcode = 'invalid_authorization_specification';
  end if;

  update office.passkeys p set counter = p_new_counter, last_used_at = pg_catalog.now()
    where p.id = v_passkey.id;
  update office.passkey_challenges c set consumed_at = pg_catalog.now()
    where c.id = v_challenge.id;
  insert into office.step_ups
      (id, user_id, session_id, passkey_id, purpose, company_id, subject_id, context_hash)
    values (
      v_id, v_session.user_id, v_session.id, v_passkey.id, p_purpose, p_company_id, p_subject_id,
      p_context_hash
    );
  return v_id;
end
$$;

-- What a project has spent, and whether its limit is reached ---------------------------------------

-- The functions below run as office_trigger: they read the limit and add up the cost of the runs
-- of one project. (The role already reads every run row through the policy "trigger_reads" and
-- every project row through "permission_reads"; these are the columns it may read of them.)
grant select (ai_spend_limit_usd), update (ai_spend_limit_usd) on office.projects
  to office_trigger;
grant select (project_id, cost_usd) on office.runs to office_trigger;

/*
 * The recorded cost of every run of a project, in US dollars (rule 5: every answered model call
 * is written to its run), over the whole life of the project; 0 for a project without a run.
 * Called only by the functions of the same owner.
 */
create function office.project_ai_spending(p_project uuid) returns numeric
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(pg_catalog.sum(r.cost_usd), 0) from office.runs r
    where r.project_id = p_project
  $$;
alter function office.project_ai_spending(uuid) owner to office_trigger;
revoke execute on function office.project_ai_spending(uuid) from public;

/*
 * Is the AI spending limit of this project reached now (decision 17): it has a limit, and the
 * recorded cost of its runs is equal to or above it. False for a project without a limit. No row
 * (null) for no project, for a project of another company than the context's and for a person
 * who may not read the project. Answers an agent run (the runner asks at the start of a run and
 * after every model call) and a reader of the project (the founder, a member): the answer is a
 * yes or a no, never an amount.
 */
create function office.project_spending_limit_reached(p_project uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select p.ai_spend_limit_usd is not null
      and office.project_ai_spending(p.id) >= p.ai_spend_limit_usd
    from office.projects p
    where p.id = p_project
      and p.company_id = office.ctx_company_id()
      and (
        office.ctx_agent_code() is not null
        or (office.is_insider() and (office.is_founder() or office.is_project_member(p.id)))
      )
  $$;
alter function office.project_spending_limit_reached(uuid) owner to office_trigger;
revoke execute on function office.project_spending_limit_reached(uuid) from public;
grant execute on function office.project_spending_limit_reached(uuid) to office_app;

-- No run row at the limit ------------------------------------------------------------------------

/*
 * No run is opened in a project whose AI spending limit is reached (8 October decision 17),
 * whoever writes the row and whatever calls for the run (a request today; a scheduled or an event
 * run of a later step too). The runner asks first and refuses the job with its reason
 * (office.project_spending_limit_reached); this check stands behind it for every writer. It fires
 * after check_run_start (which writes the run's project from the context) and project_from_task:
 * the triggers of one kind fire in the order of their names. Runs as office_trigger: it reads the
 * limit and adds up the cost of the project's runs.
 */
create function office.check_run_spending_limit() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if new.project_id is not null and exists (
    select 1 from office.projects p
    where p.id = new.project_id
      and p.ai_spend_limit_usd is not null
      and office.project_ai_spending(p.id) >= p.ai_spend_limit_usd
  ) then
    raise exception 'No run is opened in a project whose AI spending limit is reached'
      using errcode = 'program_limit_exceeded';
  end if;
  return new;
end
$$;
alter function office.check_run_spending_limit() owner to office_trigger;
revoke execute on function office.check_run_spending_limit() from public;
create trigger spending_limit_holds before insert on office.runs
  for each row execute function office.check_run_spending_limit();

-- Who sets the limit -------------------------------------------------------------------------------

/*
 * Whoever changes the AI spending limit of a project while a person is in the context: that
 * person is the founder of the project's company, never an agent run. Taking a limit away or
 * raising it lets agents spend more, so it uses up the founder's project_ai_spending_limit
 * re-verification for this project in this transaction. A first limit and a lower limit need
 * none: they only stop agents earlier. Holds for every role, the privileged one too. A change
 * without a person in the context (migrations, the seed, an administrator) needs none. Runs with
 * the caller's rights.
 */
create function office.guard_project_ai_spending_limit() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.ai_spend_limit_usd is not distinct from old.ai_spend_limit_usd then
    return new;
  end if;
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null
     or old.company_id is distinct from office.ctx_company_id()
     or not office.is_founder() then
    raise exception 'Only the founder changes the AI spending limit of a project'
      using errcode = 'insufficient_privilege';
  end if;
  if old.ai_spend_limit_usd is not null
     and (new.ai_spend_limit_usd is null or new.ai_spend_limit_usd > old.ai_spend_limit_usd)
     and not office.consume_step_up('project_ai_spending_limit', old.company_id, old.id) then
    raise exception 'Raising or removing the AI spending limit of a project needs a passkey re-verification'
      using errcode = 'invalid_authorization_specification';
  end if;
  return new;
end
$$;
revoke execute on function office.guard_project_ai_spending_limit() from public;
-- On every update, not only on one that names the column (as guard_ai_permission).
create trigger guard_ai_spending_limit before update on office.projects
  for each row execute function office.guard_project_ai_spending_limit();

/*
 * The founder sets, changes or takes away (p_limit null) the AI spending limit of a project of
 * the context company (decision 17). Raising and taking away need a project_ai_spending_limit
 * re-verification of the founder for this project, recorded in this same transaction; the check
 * above uses it up. The row is locked FOR NO KEY UPDATE, the lock the update takes anyway: the
 * run gate (FOR SHARE) and a second change wait, a run's own records do not (see
 * office.set_project_ai_permission). Returns whether the value changed; asking for the value the
 * project already has changes nothing and uses nothing up. Only the API calls it.
 */
create function office.set_project_ai_spending_limit(p_project uuid, p_limit numeric)
  returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_found uuid;
  v_current numeric;
begin
  if p_project is null then
    raise exception 'The project must be given' using errcode = 'invalid_parameter_value';
  end if;
  if p_limit is not null
     and (p_limit <= 0 or p_limit > 999999.99 or p_limit <> pg_catalog.round(p_limit, 2)) then
    raise exception 'A limit is above zero, at most 999999.99 and has at most two decimals'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder changes the AI spending limit of a project'
      using errcode = 'insufficient_privilege';
  end if;
  select p.id, p.ai_spend_limit_usd into v_found, v_current
    from office.projects p
    where p.id = p_project and p.company_id = office.ctx_company_id()
    for no key update;
  if v_found is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if v_current is not distinct from p_limit then
    return false;
  end if;
  update office.projects p set ai_spend_limit_usd = p_limit where p.id = p_project;
  return true;
end
$$;
alter function office.set_project_ai_spending_limit(uuid, numeric) owner to office_trigger;
revoke execute on function office.set_project_ai_spending_limit(uuid, numeric) from public;
grant execute on function office.set_project_ai_spending_limit(uuid, numeric)
  to office_api_private;

-- The trace ----------------------------------------------------------------------------------------

-- The limit events belong to the limit changes alone (as the permission events belong to the
-- permission changes): no request of the API and no agent run can write that a limit was set,
-- raised, lowered or removed.
create policy reserved_spending_limit_events on office.audit_log as restrictive for insert
  to office_app
  with check (event !~ '^project_ai_spending_limit_');

-- office.audit_project_change as of the budget and milestones migration (part A of this step),
-- with four events and one known column added:
--   project_ai_spending_limit_set, project_ai_spending_limit_raised,
--   project_ai_spending_limit_lowered, project_ai_spending_limit_removed
--                                  project_id and record: the project (record_type project)
-- An event name and ids, never the amount.
create or replace function office.audit_project_change() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  events text[] := '{}';
  e text;
  -- The columns with an event of their own, and the one the database derives.
  known constant text[] := array[
    'name', 'description', 'customer_id', 'status', 'closed', 'color', 'icon', 'target_date',
    'ai_allowed', 'budget', 'budget_currency', 'milestones', 'ai_spend_limit_usd'
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
    if new.ai_spend_limit_usd is not null then
      events := events || 'project_ai_spending_limit_set'::text;
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
    if new.ai_spend_limit_usd is distinct from old.ai_spend_limit_usd then
      events := events || case
        when old.ai_spend_limit_usd is null then 'project_ai_spending_limit_set'
        when new.ai_spend_limit_usd is null then 'project_ai_spending_limit_removed'
        when new.ai_spend_limit_usd > old.ai_spend_limit_usd then 'project_ai_spending_limit_raised'
        else 'project_ai_spending_limit_lowered'
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

-- Waiting work and the limit -----------------------------------------------------------------------

-- office.flow_waiting_work as of the migration "work starts again" (step 2 of the Projects
-- section), with one condition added at its end (marked "decision 17"). "create or replace" keeps
-- the owner (office_trigger) and the privileges (nobody but functions of the same owner).
/*
 * The open requests of a company that wait to start and can start now (the header says which),
 * for the flow's own functions. One row per request: the agent whose turn it is.
 *   p_company     the company
 *   p_agent       only work of this agent (null: any)
 *   p_projects    only requests inside one of these projects (null: any, also without a project)
 *   p_as_if_open  null: what can start NOW (the restart). 'agent', 'project' or 'customer': what
 *                 WOULD start if that one switch were open (the count shown before an opening):
 *                 the agent's stop switch, the projects' own AI permission, or their customer's.
 *                 Every other condition is asked as it is now.
 * Work inside a project whose AI spending limit is reached cannot start, whatever is opened
 * (8 October decision 17).
 * Not callable by the application.
 */
create or replace function office.flow_waiting_work(
  p_company uuid, p_agent text, p_projects uuid[], p_as_if_open text default null
)
  returns table (task_id uuid, project_id uuid, agent_code text, requester_user_id uuid)
  language sql stable security definer set search_path = ''
  as $$
    with turn as (
      select t.id, t.company_id, t.project_id, t.requester_user_id, s.id as step_id,
        case
          when s.id is not null then s.agent_code
          when not exists (select 1 from office.task_routings r where r.task_id = t.id)
            then office.coordinator_agent_code()
        end as agent_code,
        -- The moment the work was last called for.
        greatest(
          coalesce(s.created_at, t.created_at),
          (
            select max(a.decided_at) from office.approvals a
            where a.task_id = t.id and a.routing_id = s.id and a.status = 'changes_requested'
          ),
          (
            select max(q.decided_at) from office.requester_approvals q
            join office.approvals qa on qa.id = q.approval_id and qa.routing_id = s.id
            where q.task_id = t.id and q.status = 'changes_requested'
          ),
          (
            select max(l.occurred_at) from office.audit_log l
            where l.record_type = 'task' and l.record_id = t.id
              and l.event = 'run_restarted' and l.company_id = t.company_id
          )
        ) as called_at,
        -- The row of the latest restart in the trace (0: none). A missed start counts only
        -- when it was written after it: the clock of a trace is the start of its transaction,
        -- and an opening that began before a refusal was written would otherwise be picked a
        -- second time for the same refusal.
        coalesce((
          select max(l.id) from office.audit_log l
          where l.record_type = 'task' and l.record_id = t.id
            and l.event = 'run_restarted' and l.company_id = t.company_id
        ), 0) as restart_row
      from office.tasks t
      left join office.task_routings s on s.task_id = t.id and s.status = 'active'
      where t.company_id = p_company
        and t.kind = 'request'
        and t.status not in ('done', 'cancelled')
        and (p_projects is null or t.project_id = any (p_projects))
    )
    select w.id, w.project_id, w.agent_code, w.requester_user_id
    from turn w
    where w.agent_code is not null
      and (p_agent is null or w.agent_code = p_agent)
      -- Nothing waits for a decision.
      and not exists (
        select 1 from office.approvals a
        where a.task_id = w.id and a.routing_id is not null
          and a.status = 'pending' and a.invalidated_at is null
      )
      and not exists (
        select 1 from office.requester_approvals q
        where q.task_id = w.id and q.status = 'pending' and q.invalidated_at is null
      )
      -- Not after the second change request (2 October decision 10): that work is a person's.
      and not exists (
        select 1 from (
          select a.status, a.attempt from office.approvals a
          where a.task_id = w.id and a.routing_id = w.step_id
            and a.status <> 'pending' and a.invalidated_at is null
          order by a.decided_at desc
          limit 1
        ) lr
        where lr.status = 'changes_requested' and lr.attempt >= 2
      )
      -- The agent has no open run of this step.
      and not exists (
        select 1 from office.runs r
        where r.task_id = w.id and r.agent_code = w.agent_code and r.status = 'running'
          and r.routing_id is not distinct from w.step_id
      )
      -- (a) its latest run since the call was stopped by a switch, or (b) it has none since the
      -- call and a start was missed.
      and case
        when exists (
          select 1 from office.runs r
          where r.task_id = w.id and r.agent_code = w.agent_code and r.started_at >= w.called_at
        ) then (
          select r.status = 'stopped' and r.error_code in ('agent_stopped', 'ai_permission_closed')
          from office.runs r
          where r.task_id = w.id and r.agent_code = w.agent_code and r.started_at >= w.called_at
          order by r.started_at desc, r.id desc
          limit 1
        )
        else exists (
          select 1 from office.audit_log l
          where l.record_type = 'task' and l.record_id = w.id and l.company_id = w.company_id
            and l.occurred_at >= w.called_at
            and l.id > w.restart_row
            and (
              l.event = 'run_not_started'
              or (l.event = 'run_refused' and l.agent_code = w.agent_code)
            )
        )
      end
      -- It can start: the agent has a card version to run with ...
      and exists (
        select 1 from office.agent_definitions d
        where d.code = w.agent_code and d.current_version_id is not null
      )
      -- ... is open here (or is the switch the count is asked for) ...
      and (
        p_as_if_open is not distinct from 'agent'
        or exists (
          select 1 from office.company_agents ca
          where ca.company_id = w.company_id and ca.agent_code = w.agent_code
            and ca.status = 'enabled'
        )
      )
      -- ... and agents may work in its project (rule 12; or would, with the one switch open).
      and (
        w.project_id is null or exists (
          select 1 from office.projects p
          where p.id = w.project_id
            and (p.ai_allowed or p_as_if_open is not distinct from 'project')
            and (
              p.customer_id is null
              or p_as_if_open is not distinct from 'customer'
              or exists (
                select 1 from office.customers c where c.id = p.customer_id and c.ai_allowed
              )
            )
        )
      )
      -- ... and the AI spending limit of its project is not reached (decision 17): no opening
      -- starts work the runner would refuse at once.
      and (
        w.project_id is null or not exists (
          select 1 from office.projects p
          where p.id = w.project_id
            and p.ai_spend_limit_usd is not null
            and office.project_ai_spending(p.id) >= p.ai_spend_limit_usd
        )
      )
  $$;
