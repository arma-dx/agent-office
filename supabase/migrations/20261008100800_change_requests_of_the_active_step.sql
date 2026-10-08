-- "Changes were asked for" is a fact of the active step, also for the requester's change requests.
--
-- office.request_flow_facts says when changes were last asked for; the request page turns that into
-- "Ajan düzeltiyor" instead of "Ajan çalışıyor". The approver's change requests were counted for
-- the active step only, the requester's for the whole request. After the requester had said
-- "istediğim bu değil" twice and a person had routed the request again, the new step was labelled
-- as a correction although its agent starts fresh (the runner gives it no earlier output).
--
-- From here on a requester's change request counts only when the result it answered belongs to
-- the active step. The first "istediğim bu değil" makes the same step active again, so that case
-- reads as before.
--
-- Nothing else of the function changes.

create or replace function office.request_flow_facts(p_tasks uuid[])
  returns table (
    task_id uuid,
    pending_result boolean,
    last_result_status text,
    last_result_attempt smallint,
    last_change_request_at timestamptz,
    rejected_by_user_id uuid,
    rejected_reason text,
    rejected_note text
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
      rj.decision_reason
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
