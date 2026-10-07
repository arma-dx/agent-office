-- What a reader of a request may know about its approvals without reading them
-- (7 October decision 4; 3 October decision 1).
--
-- The result of a request is released to the requester when the unit's approver approves it: until
-- then the approval row, with the agent's output in it, is read only by people who hold the
-- approval right (office.approval_released). The request page still has to say where the request
-- is to everybody who may read it: "Birim onayında", "Ajan düzeltiyor", "İnsana düştü: ikinci
-- düzeltme". Those sentences need three facts about the approvals of the active step, and nothing
-- of their content:
--   - does a result wait for the approver;
--   - how the last result of the active step was decided, and which attempt it was;
--   - when changes were last asked for (by the approver or by the requester).
-- and, for a request that was closed by a rejection, what the requester must be told (7 October
-- decision 4: the result goes back to the requester, also when the answer is no):
--   - who rejected the result, with which reason from the fixed list, and that person's own note.
-- This function returns exactly those, for the requests the calling person can see (the same row
-- rule as the task itself), and never a title, a summary, a payload or anything an agent wrote.
-- Only the API calls it; an agent run gets nothing.

grant select (decided_at, attempt, decided_by_user_id, rejection_reason, decision_reason)
  on office.approvals to office_trigger;
grant execute on function office.is_project_member(uuid) to office_trigger;

create function office.request_flow_facts(p_tasks uuid[])
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
          select q.decided_at from office.requester_approvals q
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
