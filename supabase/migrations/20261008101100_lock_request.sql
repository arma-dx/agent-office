-- One order of locks for everything a person does to a request.
--
-- A close and a correction of the routing lock the request first and then reach its steps and its
-- approvals (office.close_request, office.flow_route_request). A decision of the approver and the
-- requester's answer came the other way: the API locked the approval row, and the flow triggers
-- then reached the steps and the request. A decision and a close at the same moment could each
-- hold what the other needed; PostgreSQL broke the deadlock after a second and one of the two
-- people got an error.
--
-- The application's role cannot lock a request (nothing of a request is its to update). This
-- function does it for a person who may read the request: the API calls it at the start of a
-- decision and of the requester's answer, before it touches the approval. Then every person's act
-- takes the request's lock first. Locks nothing for anybody else, for an agent run or outside the
-- context company; returns nothing either way.

create function office.lock_request(p_task uuid) returns void
  language plpgsql security definer set search_path = ''
  as $$
begin
  perform 1 from office.tasks t
    where t.id = p_task
      and t.kind = 'request'
      and t.company_id = office.ctx_company_id()
      -- The row rule of a task for a person (office.row_visible), written out as in
      -- office.request_flow_facts.
      and office.ctx_agent_code() is null
      and office.is_insider()
      and (
        t.project_id is null or office.is_founder() or office.is_project_member(t.project_id)
      )
    for update;
end
$$;
alter function office.lock_request(uuid) owner to office_trigger;
revoke execute on function office.lock_request(uuid) from public;
grant execute on function office.lock_request(uuid) to office_api_private;
