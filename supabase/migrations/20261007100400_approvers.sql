-- The approver of a unit and of a single agent (7 October decisions 3 and 5).
--
-- One row names the person who approves the work of a unit in a company; a row with an agent code
-- names the approver of that one agent and wins over the unit's row. No row: nobody is appointed
-- and the founder decides (decision 5: for now the founder approves for every unit, so the pilot
-- needs no row at all). Only the founder appoints. The appointed person must hold the approval
-- right (founder, or an employee with can_approve, which already needs a passkey to grant); when
-- the right or the membership goes, the appointment stops counting without being rewritten.

create table office.approvers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references office.companies (id),
  unit_code text not null references office.units (code),
  -- null: the unit's approver; set: the approver of this one agent of the unit
  agent_code text references office.agent_definitions (code),
  user_id uuid not null,
  created_by_user_id uuid references office.users (id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (company_id, unit_code, agent_code),
  foreign key (company_id, user_id) references office.memberships (company_id, user_id)
    on delete cascade
);

grant select on office.approvers, office.agent_definitions, office.units to office_auth_reader;
create policy reader on office.approvers for select to office_auth_reader using (true);

-- Does this member of the context company hold the approval right today (active founder, or
-- active employee with can_approve). Only about the context company.
create function office.member_can_approve(p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from office.memberships m
      join office.users u on u.id = m.user_id and u.active
      where m.company_id = office.ctx_company_id() and m.user_id = p_user
        and (m.role = 'founder' or (m.role = 'employee' and m.can_approve))
    )
  $$;
alter function office.member_can_approve(uuid) owner to office_auth_reader;
revoke execute on function office.member_can_approve(uuid) from public;
grant execute on function office.member_can_approve(uuid) to office_app, office_trigger;

create function office.check_approver() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_user_id := office.ctx_user_id();
    new.created_at := pg_catalog.now();
  end if;
  if new.company_id is distinct from office.ctx_company_id() then
    raise exception 'An approver is appointed in the context company'
      using errcode = 'insufficient_privilege';
  end if;
  -- The unit is one this company has: a shared unit or its own.
  if not exists (
    select 1 from office.units u, office.companies c
    where u.code = new.unit_code and c.id = new.company_id
      and (u.company_code is null or u.company_code = c.code)
  ) then
    raise exception 'Unit % does not belong to this company', new.unit_code
      using errcode = 'check_violation';
  end if;
  if new.agent_code is not null and not exists (
    select 1 from office.agent_definitions a, office.companies c
    where a.code = new.agent_code and a.unit_code = new.unit_code
      and c.id = new.company_id and c.code = any (a.company_codes)
  ) then
    raise exception 'Agent % is not an agent of this unit in this company', new.agent_code
      using errcode = 'check_violation';
  end if;
  if not office.member_can_approve(new.user_id) then
    raise exception 'The approver must be a member who holds the approval right'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
alter function office.check_approver() owner to office_auth_reader;
revoke execute on function office.check_approver() from public;
grant select (id, code) on office.companies to office_auth_reader;
create trigger check_approver before insert or update on office.approvers
  for each row execute function office.check_approver();
create trigger immutable_columns before update on office.approvers
  for each row execute function office.prevent_column_changes(
    'company_id', 'unit_code', 'agent_code', 'created_at', 'created_by_user_id'
  );

/*
 * The person appointed to approve the work of this agent (or, without an agent, of this unit) in
 * the context company: the agent's own approver first, then the unit's. Null when nobody is
 * appointed, when the appointed person no longer holds the approval right, or when the work
 * belongs to a project the person is not a member of (a project row is seen only by the founder
 * and the project's members): then the founder decides.
 * Only about the context company; the answer is a person's id, which every insider of that company
 * may know.
 */
create function office.approver_for(p_unit text, p_agent text, p_project uuid default null)
  returns uuid
  language sql stable security definer set search_path = ''
  as $$
    select a.user_id
    from office.approvers a
    join office.memberships m on m.company_id = a.company_id and m.user_id = a.user_id
    join office.users u on u.id = m.user_id and u.active
    where a.company_id = office.ctx_company_id()
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

alter table office.approvers enable row level security;
alter table office.approvers force row level security;
grant select on office.approvers to office_app;
-- Appointing is a person's act and goes through the API: the worker's role, which is not in the
-- API-only group, cannot write here whatever its context says.
grant insert, delete, update (user_id) on office.approvers to office_api_private;

-- Insiders and agent runs of the company see who approves what; only the founder appoints.
create policy visible on office.approvers for select to office_app
  using (office.row_visible(company_id, null));
create policy founder_manages on office.approvers for all to office_api_private
  using (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  )
  with check (
    company_id = office.ctx_company_id() and office.is_founder() and office.ctx_agent_code() is null
  );
