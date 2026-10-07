-- The trace of the flow records (rule 5; 2 October decision 13: names and ids only).
--
-- A routing already leaves request_routed / request_rerouted and a close leaves request_cancelled /
-- request_stopped (office.route_request, office.correct_routing, office.close_request). This
-- migration adds the rest, by trigger and not by the API, for the reason the task audit trigger
-- gives: the API is not the only writer (an agent opens an approval, the flow opens and closes the
-- requester's approval, a removed membership removes an appointment).
-- The function runs with the caller's rights: who and when come from the context.
--
--   approval_opened | _approved | _changes_requested | _rejected | _closed | _summary_changed
--                                                                           record: approval
--   requester_approval_opened | _approved | _changes_requested | _closed   record: requester_approval
--   approver_appointed | approver_changed | approver_removed                record: approver
--
-- An approval decision is the act the whole approval desk exists for; it is traced for every
-- approval, not only for the results of requests.

create function office.audit_flow_record() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  e text;
  r record;
  v_type text;
  v_project uuid;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_table_name = 'approvals' then
    v_type := 'approval';
    v_project := r.project_id;
    if tg_op = 'INSERT' then
      e := 'approval_opened';
    elsif new.status is distinct from old.status then
      -- One of three fixed codes (check constraint), not free text.
      e := 'approval_' || new.status;
    elsif new.invalidated_at is not null and old.invalidated_at is null then
      e := 'approval_closed';
    elsif new.summary is distinct from old.summary
       or new.risk_note is distinct from old.risk_note
       or new.priority is distinct from old.priority then
      e := 'approval_summary_changed';
    end if;
  elsif tg_table_name = 'requester_approvals' then
    v_type := 'requester_approval';
    v_project := r.project_id;
    if tg_op = 'INSERT' then
      e := 'requester_approval_opened';
    elsif new.status is distinct from old.status then
      e := 'requester_approval_' || new.status;
    elsif new.invalidated_at is not null and old.invalidated_at is null then
      e := 'requester_approval_closed';
    end if;
  elsif tg_table_name = 'approvers' then
    v_type := 'approver';
    e := case tg_op
      when 'INSERT' then 'approver_appointed'
      when 'UPDATE' then 'approver_changed'
      else 'approver_removed'
    end;
  end if;
  if e is not null then
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (r.company_id, v_project, e, v_type, r.id);
  end if;
  return null;
end
$$;
create trigger audit_flow_record after insert or update on office.requester_approvals
  for each row execute function office.audit_flow_record();
create trigger audit_flow_record after insert or update or delete on office.approvers
  for each row execute function office.audit_flow_record();
create trigger audit_flow_record after insert or update on office.approvals
  for each row execute function office.audit_flow_record();
