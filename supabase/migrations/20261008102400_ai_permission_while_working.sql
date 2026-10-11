-- Rule 12 while a request is under way: the run's project context, and what happens when the AI
-- permission is closed (CLAUDE.md rules 9 and 12, "Şirketler, projeler ve görünürlük";
-- docs/SONRA.md W-g, W-i).
--
-- A request inside a project is carried out in the context of that project: the run of the
-- coordinator and the run of the unit's agent set app.project_id, and the row policies then show
-- them the rows of that one project and nothing of any other. Until now no run set it, so a
-- request in a project was hidden from every run.
--
-- The policies answer "may this run see this row". They cannot answer "why not": a project
-- without AI permission hides its request, its runs and itself from every agent run, so the
-- runner could neither tell a person why nothing started nor close a run that was open when the
-- permission was closed. This migration adds the narrow answers, all owned by office_trigger:
--
--   office.project_allows_ai(project)      rule 12 as one question: the project's AI permission
--                                          and, if it has a customer, the customer's. Locks the
--                                          two rows against a change until the caller's
--                                          transaction ends. Not callable by the application.
--   office.request_run_gate(request)       asked by the runner at the start of every run, in a
--                                          context that holds the company and the agent and no
--                                          person yet: in whose name the run goes (the answer of
--                                          office.request_run_identity, 8 October decision 45),
--                                          the project of the request and whether agents may work
--                                          there. The runner then sets the person and the project
--                                          of its context from this answer; a request whose
--                                          project does not allow AI never gets a run row and
--                                          never reaches a model.
--   stop_runs_without_ai_permission        a trigger on projects and on customers: when an AI
--                                          permission is closed, the runs that are open in the
--                                          projects it covers are closed in the same transaction
--                                          (status stopped, error_code ai_permission_closed, one
--                                          audit row each). Nothing else could close them: they
--                                          are hidden from the worker from that moment on.
--   ai_permission_holds_result             a trigger on approvals: an approval that belongs to a
--                                          project is not approved while agents may not work in
--                                          that project. It stays readable and can be rejected.
--   office.add_usage_to_stopped_run(...)   the tokens and the cost of a model call that was
--                                          answered after such a stop are added to the stopped run
--                                          (rule 5: a call that was answered is paid for and is
--                                          written to its run). The run is hidden from the runner
--                                          by then, so the runner cannot write them itself.
--
-- The gate and the stop are ordered by the row locks: the gate holds a share lock on the project
-- and its customer until the run row is committed, and closing a permission updates one of those
-- rows. So either the permission is closed first and the gate says no, or the run is committed
-- first and the trigger closes it.
--
-- office.set_project_ai_permission is created again with a weaker row lock (for no key update
-- instead of for update). The stop makes the close touch run rows after the project row, and a
-- run touches its run row before a row that names the project (an audit row, a tool call: the
-- foreign key takes a key share lock on the project). With "for update" the two orders met in a
-- deadlock and the close failed; "for no key update" does not conflict with a key share lock and
-- still makes the gate and every other change of the project wait.
--
-- No policy of a company table is widened. The worker's role sets its own context (rule 9); what
-- the gate adds is the one thing it may not choose: the person. The gate names that person, and
-- the insert of the run refuses any other (office.check_run_request, the run identity migration).
--
-- Error codes: 55000 an approval is held because its project does not allow AI; 42501 the usage
-- function called outside an agent run; 22023 a usage that is missing or negative.

/*
 * May agents work in this project now (rule 12): its AI permission is open and, if it has a
 * customer, the customer's contract allows AI. True for no project. Takes a share lock on the
 * project row and on its customer's row: a change of either permission waits until the caller's
 * transaction ends, and the caller reads the committed value. Called only by the functions below
 * (same owner).
 */
create function office.project_allows_ai(p_project uuid) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_allowed boolean;
  v_customer uuid;
  v_customer_allowed boolean;
begin
  if p_project is null then
    return true;
  end if;
  select p.ai_allowed, p.customer_id into v_allowed, v_customer
    from office.projects p where p.id = p_project for share;
  if v_allowed is not true then
    return false;
  end if;
  if v_customer is null then
    return true;
  end if;
  select c.ai_allowed into v_customer_allowed
    from office.customers c where c.id = v_customer for share;
  return coalesce(v_customer_allowed, false);
end
$$;
alter function office.project_allows_ai(uuid) owner to office_trigger;
revoke execute on function office.project_allows_ai(uuid) from public;

/*
 * The runner's question at the start of every run on a request (rule 12: "Çalıştırıcı her
 * çalışmanın başında da denetler"; decision 45: the database says in whose name a run goes).
 * Answers in an agent run only (a context with the company and the agent; the person is what is
 * asked for), for a request of the context company; no row for anything else.
 *   run_as       the person the run goes as: the requester while they may read the request,
 *                otherwise the founder of the company; the runner sets it as app.user_id
 *   project_id   the project of the request (null: none); the runner sets it as app.project_id
 *   ai_allowed   may agents work there now (always true without a project)
 * The locks of office.project_allows_ai hold until the caller's transaction ends: the runner asks
 * inside the transaction that inserts the run. The person is not locked: a run opened in a name
 * that stopped being the resolved one in the same instant is refused by office.check_run_request.
 */
create function office.request_run_gate(p_task uuid)
  returns table (run_as uuid, project_id uuid, ai_allowed boolean)
  language sql security definer set search_path = ''
  as $$
    select office.request_run_identity(t.id), t.project_id, office.project_allows_ai(t.project_id)
    from office.tasks t
    where t.id = p_task
      and t.kind = 'request'
      and t.company_id = office.ctx_company_id()
      and office.ctx_agent_code() is not null
  $$;
alter function office.request_run_gate(uuid) owner to office_trigger;
revoke execute on function office.request_run_gate(uuid) from public;
grant execute on function office.request_run_gate(uuid) to office_app;

-- Open runs are closed when the permission is closed ---------------------------------------------

grant select (project_id), update (status, finished_at, error_code) on office.runs
  to office_trigger;
create policy permission_stops on office.runs for update to office_trigger
  using (status = 'running') with check (status = 'stopped');
-- The trace of such a stop is the run's own event, with the run's id (as the runner writes it).
grant insert (run_id) on office.audit_log to office_trigger;
create policy permission_stop_records on office.audit_log for insert to office_trigger
  with check (
    event = 'run_stopped'
    and run_id is not null
    and (office.ctx_company_id() is null or company_id = office.ctx_company_id())
  );

/*
 * An AI permission was closed (a project's, or a customer's for all its projects): every run that
 * is still open in a project it covers is closed here, in the transaction of the change, whoever
 * makes it. From this moment the row policies hide those runs from the worker, so the runner
 * could not close them itself; a model call that is in flight comes back to a closed run and is
 * dropped. The request of such a run stays open and falls to a person (the stage is derived from
 * the project's permission).
 */
create function office.stop_runs_without_ai_permission() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_run record;
begin
  for v_run in
    update office.runs r
      set status = 'stopped', finished_at = pg_catalog.now(), error_code = 'ai_permission_closed'
      where r.status = 'running'
        and r.company_id = new.company_id
        and r.project_id in (
          select p.id from office.projects p
          where p.company_id = new.company_id
            and case tg_table_name
              when 'projects' then p.id = new.id
              else p.customer_id = new.id
            end
        )
      returning r.id, r.project_id, r.task_id
  loop
    insert into office.audit_log (company_id, project_id, event, record_type, record_id, run_id)
      values (
        new.company_id, v_run.project_id, 'run_stopped',
        case when v_run.task_id is not null then 'task' end, v_run.task_id, v_run.id
      );
  end loop;
  return null;
end
$$;
alter function office.stop_runs_without_ai_permission() owner to office_trigger;
revoke execute on function office.stop_runs_without_ai_permission() from public;
-- On every update, not only on one that names the column (as guard_ai_permission).
create trigger stop_runs_without_ai_permission after update on office.projects
  for each row when (old.ai_allowed and not new.ai_allowed)
  execute function office.stop_runs_without_ai_permission();
create trigger stop_runs_without_ai_permission after update on office.customers
  for each row when (old.ai_allowed and not new.ai_allowed)
  execute function office.stop_runs_without_ai_permission();

/*
 * office.set_project_ai_permission as of the AI permission migration (20261008101800),
 * with one change: the project row is locked FOR NO KEY UPDATE instead of FOR UPDATE.
 *
 * Closing a permission now also closes run rows (the trigger above), after the project row is
 * locked. A run writes the other way round: its run row first, then a row that names the project
 * (an audit row, a tool call), whose foreign key takes a key share lock on the project row. FOR
 * UPDATE conflicts with that lock, so a close and the last write of a run could each hold what
 * the other needed: PostgreSQL then ended the close with a deadlock and the permission stayed
 * open. FOR NO KEY UPDATE is the lock the update below takes anyway; it does not conflict with a
 * key share lock, and it still makes the run gate (FOR SHARE), a change of the customer and a
 * second change of the permission wait, which is what the lock is for.
 * Same signature, owner (office_trigger) and privileges (office_api_private) as before.
 */
create or replace function office.set_project_ai_permission(
  p_project uuid, p_allowed boolean, p_customer uuid
) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_current boolean;
  v_customer uuid;
begin
  if p_project is null or p_allowed is null then
    raise exception 'The project and the new value must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or not office.is_founder() then
    raise exception 'Only the founder changes the AI permission of a project'
      using errcode = 'insufficient_privilege';
  end if;
  select p.ai_allowed, p.customer_id into v_current, v_customer
    from office.projects p
    where p.id = p_project and p.company_id = office.ctx_company_id()
    for no key update;
  if v_current is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if v_current = p_allowed then
    return false;
  end if;
  if p_allowed and v_customer is distinct from p_customer then
    raise exception 'The project has another customer than the one the opening was confirmed for'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  update office.projects p set ai_allowed = p_allowed where p.id = p_project;
  return true;
end
$$;

-- The usage of a call that was answered after the stop --------------------------------------------

-- Rule 5: every model call that was answered is written to its run (tokens and cost).
-- A run the trigger above stopped is hidden from the runner from that moment, so the answer of a
-- call that was in flight cannot be paid into the run by the runner's own update. The function
-- below adds exactly those numbers, to exactly such a run, for the run's own context.
grant select (user_id, error_code, input_tokens, output_tokens, cache_write_tokens,
    cache_read_tokens, cost_usd),
  update (input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd)
  on office.runs to office_trigger;
create policy permission_stop_usage on office.runs for update to office_trigger
  using (status = 'stopped' and error_code = 'ai_permission_closed');

/*
 * Adds the tokens and the cost of one answered model call to a run that a permission close
 * stopped. Answers only in an agent run, and only for a run of the context company, the context
 * agent and the context person (the three a run row is written with). Returns whether a run took
 * the numbers: false for a run that is open, that was closed for any other reason, that belongs
 * to somebody else or that does not exist. Nothing else of the run is read or changed.
 */
create function office.add_usage_to_stopped_run(
  p_run uuid, p_input integer, p_output integer, p_cache_write integer, p_cache_read integer,
  p_cost numeric
) returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_rows integer;
begin
  if office.ctx_agent_code() is null then
    raise exception 'The usage of a run is written by that run'
      using errcode = 'insufficient_privilege';
  end if;
  if p_run is null or p_input is null or p_output is null or p_cache_write is null
     or p_cache_read is null or p_cost is null
     or p_input < 0 or p_output < 0 or p_cache_write < 0 or p_cache_read < 0 or p_cost < 0 then
    raise exception 'The usage must be given and cannot be negative'
      using errcode = 'invalid_parameter_value';
  end if;
  update office.runs r set
      input_tokens = r.input_tokens + p_input,
      output_tokens = r.output_tokens + p_output,
      cache_write_tokens = r.cache_write_tokens + p_cache_write,
      cache_read_tokens = r.cache_read_tokens + p_cache_read,
      cost_usd = r.cost_usd + p_cost
    where r.id = p_run
      and r.company_id = office.ctx_company_id()
      and r.agent_code = office.ctx_agent_code()
      and r.user_id = office.ctx_user_id()
      and r.status = 'stopped'
      and r.error_code = 'ai_permission_closed';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$$;
alter function office.add_usage_to_stopped_run(uuid, integer, integer, integer, integer, numeric)
  owner to office_trigger;
revoke execute on function
  office.add_usage_to_stopped_run(uuid, integer, integer, integer, integer, numeric) from public;
grant execute on function
  office.add_usage_to_stopped_run(uuid, integer, integer, integer, integer, numeric) to office_app;

-- An approval is not given while the permission is closed ----------------------------------------

/*
 * Approving releases what an agent produced in a project. While agents may not work in that
 * project (rule 12) nothing of it is approved: the approval stays pending and readable, it can be
 * rejected, the request can be stopped, and it can be approved once the permission is open again.
 * Fires before office.check_approval (triggers fire in the order of their names), so a passkey
 * re-verification is not used up by a refused approval.
 */
create function office.hold_result_without_ai_permission() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if old.status = 'pending' and new.status = 'approved' and old.project_id is not null
     and not office.project_allows_ai(old.project_id) then
    raise exception 'Nothing of a project is approved while agents may not work in it'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end
$$;
alter function office.hold_result_without_ai_permission() owner to office_trigger;
revoke execute on function office.hold_result_without_ai_permission() from public;
create trigger ai_permission_holds_result before update on office.approvals
  for each row execute function office.hold_result_without_ai_permission();
