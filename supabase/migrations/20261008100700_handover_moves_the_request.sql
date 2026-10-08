-- The hand-over of an approved result to the requester counts as a movement of the request
-- (7 October decision 4: the result goes back to the requester).
--
-- tasks.updated_at is what the request list is ordered and dated by ("the newest movement first";
-- the panel sorts what waits for the reader by it). It moves when a column of the request changes.
-- When the approver approves the work of the last step, the request already is "awaiting_approval"
-- and stays so: nothing was written, and the request that had just reached its requester was dated
-- and ordered by the moment the agent submitted, hours earlier.
--
-- From here on the flow touches the request at that moment: an update that changes no value. The
-- task check stamps updated_at; the version stays (no column of the request changed) and the task
-- audit trigger writes nothing (the trace of this moment is requester_approval_opened).

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
  -- The status did not change, so nothing was written: the request is touched, so that its
  -- updated_at is the moment it passed to its requester.
  update office.tasks t set status = t.status where t.id = p_task;
end
$$;
alter function office.flow_request_result_approved(uuid, uuid) owner to office_trigger;
revoke execute on function office.flow_request_result_approved(uuid, uuid) from public;
