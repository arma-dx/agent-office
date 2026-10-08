-- A request whose work was called for and could not be started stays with a person (8 October
-- decision 2 as read in docs/SONRA.md Y-f: after the routing a stopped agent does not return the
-- request, it falls to a person).
--
-- Two paths call for a run and leave none, not even a failed one:
--   - the approver or the requester asks for changes while the step's agent is stopped: the API
--     puts nothing on the queue;
--   - a job is refused at the runner's gate before a run row exists (the agent was stopped, its
--     card has no version, the job is stale).
-- While the agent stayed stopped the request page said so. Once the agent was opened again nothing
-- told the two cases apart from a run that is about to start: the page said the agent had the
-- turn, for ever, with no job behind it. Opening an agent starts nothing by itself (the panel says
-- so); the person routes the request again.
--
-- From here on the missing start is a fact the page can read. Both paths leave a trace row in
-- audit_log on the request (names and ids only, as always):
--   run_not_started   written by the API when a change request found the step's agent stopped;
--   run_refused       written by the runner when it refused a job at its gate (it already did).
-- office.request_flow_facts returns the time of the latest such row for the agent whose turn it
-- is: the agent of the active step, or the coordinator while the request is not routed. The
-- server compares it with the moment the work was last called for; a routing made afterwards is
-- later than the trace, so the request reads as started again.
--
-- audit_log is read by the founder alone. The flow's function reads these two events and no other,
-- and gives back a time, to the readers it already answers (those who may read the request).

grant select (company_id, event, record_type, record_id, agent_code, occurred_at)
  on office.audit_log to office_trigger;
create policy flow_reads_missing_starts on office.audit_log for select to office_trigger
  using (record_type = 'task' and event in ('run_refused', 'run_not_started'));
-- The list reads this fact for every request it shows.
create index audit_log_missing_starts on office.audit_log (record_id)
  where record_type = 'task' and event in ('run_refused', 'run_not_started');

-- The result gets a column, so the function is created again (as of the migration "change
-- requests of the active step", with not_started_at added).
drop function office.request_flow_facts(uuid[]);
create function office.request_flow_facts(p_tasks uuid[])
  returns table (
    task_id uuid,
    pending_result boolean,
    last_result_status text,
    last_result_attempt smallint,
    last_change_request_at timestamptz,
    rejected_by_user_id uuid,
    rejected_reason text,
    rejected_note text,
    not_started_at timestamptz
  )
  language sql stable security definer set search_path = ''
  as $$
    select t.id,
      exists (
        select 1 from office.approvals a
        where a.task_id = t.id and a.routing_id is not null
          and a.status = 'pending' and a.invalidated_at is null
      ),
      lr.status,
      lr.attempt,
      (
        select max(d.at) from (
          select a.decided_at as at from office.approvals a
            where a.task_id = t.id and a.routing_id = s.id and a.status = 'changes_requested'
          union all
          -- The requester's, on a result of the active step.
          select q.decided_at from office.requester_approvals q
            join office.approvals qa on qa.id = q.approval_id and qa.routing_id = s.id
            where q.task_id = t.id and q.status = 'changes_requested'
        ) d
      ),
      rj.decided_by_user_id,
      rj.rejection_reason,
      rj.decision_reason,
      -- The latest time a run was called for and not started, for the agent whose turn it is.
      (
        select max(l.occurred_at) from office.audit_log l
        where l.record_type = 'task' and l.record_id = t.id
          and l.event in ('run_refused', 'run_not_started')
          and l.company_id = t.company_id
          and (
            -- Written by the API in a person's name: about the step that was active then.
            l.event = 'run_not_started'
            or l.agent_code = case
              when s.id is not null then s.agent_code
              when not exists (select 1 from office.task_routings r where r.task_id = t.id)
                then office.coordinator_agent_code()
            end
          )
      )
    from office.tasks t
    left join office.task_routings s on s.task_id = t.id and s.status = 'active'
    left join lateral (
      select a.status, a.attempt from office.approvals a
      where a.task_id = t.id and a.routing_id = s.id
        and a.status <> 'pending' and a.invalidated_at is null
      order by a.decided_at desc
      limit 1
    ) lr on true
    -- The rejection that closed the request: the decider's name, class and words, never the output.
    left join lateral (
      select a.decided_by_user_id, a.rejection_reason, a.decision_reason from office.approvals a
      where a.task_id = t.id and a.routing_id is not null and a.status = 'rejected'
        and t.status = 'cancelled'
      order by a.decided_at desc
      limit 1
    ) rj on true
    where t.id = any (p_tasks)
      and t.kind = 'request'
      and t.company_id = office.ctx_company_id()
      -- The row rule of a task for a person (office.row_visible), written out: the function runs
      -- with the flow's rights, which do not reach the tables that rule reads for an agent run.
      and office.ctx_agent_code() is null
      and office.is_insider()
      and (
        t.project_id is null or office.is_founder() or office.is_project_member(t.project_id)
      )
  $$;
alter function office.request_flow_facts(uuid[]) owner to office_trigger;
revoke execute on function office.request_flow_facts(uuid[]) from public;
grant execute on function office.request_flow_facts(uuid[]) to office_api_private;
