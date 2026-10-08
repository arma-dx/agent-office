-- Who approves what is answered to insiders of the context company only (rule 9: a policy reads
-- the context and returns nothing without it; a person sees only their own memberships).
--
-- office.approver_for and office.member_can_approve run with the rights of the identity reader and
-- looked at the context company alone, not at who asks. A context whose company is Arma DX and
-- whose person is a Pillika employee, an external member, a former member or nobody was told the
-- appointed approver's id, and for any id whether that person holds the approval right there,
-- while the same context reads no row of office.approvers and no membership of others. The
-- approvers migration itself says the answer is one "every insider of that company may know".
--
-- From here on both answer only when the context person is a founder or an employee of the
-- context company (office.is_insider). Every real caller is one: the founder who appoints, the
-- person who corrects a routing, and an agent run, whose identity is the requester or the agent's
-- owner. For anybody else approver_for gives no person (so the founder decides, as when nobody is
-- appointed) and member_can_approve says no.

create or replace function office.member_can_approve(p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select office.is_insider() and exists (
      select 1 from office.memberships m
      join office.users u on u.id = m.user_id and u.active
      where m.company_id = office.ctx_company_id() and m.user_id = p_user
        and (m.role = 'founder' or (m.role = 'employee' and m.can_approve))
    )
  $$;
alter function office.member_can_approve(uuid) owner to office_auth_reader;
revoke execute on function office.member_can_approve(uuid) from public;
grant execute on function office.member_can_approve(uuid) to office_app, office_trigger;

/*
 * The person appointed to approve the work of this agent (or, without an agent, of this unit) in
 * the context company: the agent's own approver first, then the unit's. Null when nobody is
 * appointed, when the appointed person no longer holds the approval right, or when the work
 * belongs to a project the person is not a member of (a project row is seen only by the founder
 * and the project's members): then the founder decides.
 * Only about the context company, and only for a caller who is an insider of it; the answer is a
 * person's id, which every insider of that company may know.
 */
create or replace function office.approver_for(
  p_unit text, p_agent text, p_project uuid default null
) returns uuid
  language sql stable security definer set search_path = ''
  as $$
    select a.user_id
    from office.approvers a
    join office.memberships m on m.company_id = a.company_id and m.user_id = a.user_id
    join office.users u on u.id = m.user_id and u.active
    where a.company_id = office.ctx_company_id()
      and office.is_insider()
      and a.unit_code = p_unit
      and (a.agent_code is null or a.agent_code = p_agent)
      and (m.role = 'founder' or (m.role = 'employee' and m.can_approve))
      and (
        p_project is null or m.role = 'founder'
        or exists (
          select 1 from office.project_members pm
          where pm.project_id = p_project and pm.user_id = a.user_id
        )
      )
    order by (a.agent_code is null)
    limit 1
  $$;
alter function office.approver_for(text, text, uuid) owner to office_auth_reader;
revoke execute on function office.approver_for(text, text, uuid) from public;
grant execute on function office.approver_for(text, text, uuid) to office_app, office_trigger;
