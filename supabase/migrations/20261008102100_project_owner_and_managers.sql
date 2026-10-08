-- The owner and the managers of a project (8 October decision 44; docs/SONRA.md P-a, P1-g, P1b-a
-- to P1b-j; CLAUDE.md rules 2 and 9).
--
-- Until now every member of a project added members and removed other members. The founder's
-- rule: a member does not remove a member; the owner and the managers of the project do. From
-- here on a project membership carries one of three roles:
--   owner     the person who opened the project. One per project at most. Adds members, removes
--             managers and members, appoints and dismisses managers, hands the ownership over to
--             another member. Never removed and never demoted: the ownership is handed over
--             first.
--   manager   appointed by the owner or the founder from among the members. Adds members and
--             removes plain members. Removes no manager and not the owner.
--   member    reads and works in the project, changes its fields as before, and neither adds nor
--             removes anybody.
-- The founder of the company does in every project what its owner does, member or not. An
-- employee still does not remove themselves, whatever their role.
--
-- A new membership row is always a plain member; a role is given only by
-- office.set_project_member_role, which only the API's role may call. The row policies hold the
-- rule for adding and removing; nothing here depends on what the API checks first.
--
-- A project can be without an owner: one written without a person (the seed, an administrator),
-- one whose opener was no member any more when this migration ran, and one whose owner left the
-- company or became an external person (that bookkeeping still removes the row: the rule above
-- binds people who act in the project, not a change of the company's own members). The founder
-- then names an owner.
--
-- Who READS a project and who changes its fields does not change (policies "visible" and
-- "member_edits").
--
-- Error codes of office.set_project_member_role: 42501 the caller is neither the owner nor the
-- founder; P0002 no such member (also: a project the caller cannot read); 55000 the owner's own
-- role is asked to change; 22023 a missing argument or an unknown role; 23514 a deactivated
-- account is given a role (the member check).

alter table office.project_members
  add column role text not null default 'member'
    constraint project_members_role_check check (role in ('owner', 'manager', 'member'));

-- The opener of an existing project is its owner, if still a member of it.
update office.project_members pm set role = 'owner'
  from office.projects p
  where p.id = pm.project_id and p.created_by_user_id = pm.user_id;

create unique index project_members_one_owner on office.project_members (project_id)
  where role = 'owner';

/*
 * The role of the context person in a project: owner, manager, member; null when they are no
 * member of it. Read as the reader role, like office.is_project_member, so that a row policy of
 * project_members can ask it without calling itself.
 */
create function office.project_role(p_project uuid) returns text
  language sql stable security definer set search_path = ''
  as $$
    select pm.role from office.project_members pm
    where pm.project_id = p_project and pm.user_id = office.ctx_user_id()
  $$;
alter function office.project_role(uuid) owner to office_auth_reader;
revoke execute on function office.project_role(uuid) from public;
grant execute on function office.project_role(uuid) to office_app, office_trigger;

-- Adding and removing ------------------------------------------------------------------------------

drop policy members_add on office.project_members;
drop policy members_remove on office.project_members;
-- The role is not the API's to write: a new row is a plain member (the column default).
revoke insert on office.project_members from office_api_private;
grant insert (company_id, project_id, user_id) on office.project_members to office_api_private;

-- Decision 44, read for adding too: the founder, the owner and the managers add a member.
create policy members_add on office.project_members for insert to office_api_private
  with check (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and role = 'member'
    and (
      office.is_founder()
      or (office.is_insider() and office.project_role(project_id) in ('owner', 'manager'))
    )
  );
-- Decision 44: the owner is never removed; the founder and the owner remove managers and members;
-- a manager removes plain members; nobody but the founder removes themselves.
create policy members_remove on office.project_members for delete to office_api_private
  using (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and role <> 'owner'
    and (
      office.is_founder()
      or (
        office.is_insider()
        and user_id <> office.ctx_user_id()
        and (
          office.project_role(project_id) = 'owner'
          or (office.project_role(project_id) = 'manager' and role = 'member')
        )
      )
    )
  );

-- The opener is the owner --------------------------------------------------------------------------

-- office.creator_becomes_member as of the project write paths migration (20261008101700), with
-- the role written: who opens a project is its owner.
create or replace function office.creator_becomes_member() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_user_id() is not null and office.ctx_agent_code() is null
     and new.company_id = office.ctx_company_id() then
    insert into office.project_members (company_id, project_id, user_id, role)
      values (new.company_id, new.id, office.ctx_user_id(), 'owner')
      on conflict (project_id, user_id) do nothing;
  end if;
  return null;
end
$$;

-- Roles ---------------------------------------------------------------------------------------------

-- office.check_project_member as of the project write paths migration (20261008101700), with the
-- sentence for a role: the same check now also runs when a member is made a manager or the owner.
create or replace function office.check_project_member() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_role text;
  v_active boolean;
begin
  select m.role, u.active into v_role, v_active
    from office.memberships m
    join office.users u on u.id = m.user_id
    where m.company_id = new.company_id and m.user_id = new.user_id;
  if v_role = 'external' then
    raise exception 'Only a founder or an employee of the company is a project member'
      using errcode = 'check_violation';
  end if;
  if v_active is false then
    if tg_op = 'UPDATE' then
      raise exception 'A deactivated account is given no role in a project'
        using errcode = 'check_violation';
    end if;
    raise exception 'A deactivated account is not added to a project'
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
-- A demotion to a plain member is not asked: a deactivated manager can always be dismissed.
create trigger check_project_member_role after update of role on office.project_members
  for each row when (new.role is distinct from old.role and new.role <> 'member')
  execute function office.check_project_member();

grant update (role) on office.project_members to office_trigger;

/*
 * Gives a member of a project of the context company a role (decision 44). Only the owner of the
 * project and the founder of the company call it with effect; only the API's role may call it.
 *   'manager'  a plain member is appointed;
 *   'member'   a manager is dismissed;
 *   'owner'    the ownership is handed over: the member becomes the owner and the owner until
 *              now, if there is one, becomes a plain member, in this one statement's transaction.
 * The owner's own role is never changed directly (55000): the ownership is handed over. The
 * member rows of the project are locked first, in one order, so two changes wait for each other.
 * Returns whether anything changed; asking for the role the member already has changes nothing.
 */
create function office.set_project_member_role(p_project uuid, p_user uuid, p_role text)
  returns boolean
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_caller uuid := office.ctx_user_id();
  v_founder boolean := office.is_founder();
  v_caller_role text;
  v_current text;
begin
  if p_project is null or p_user is null or p_role is null
     or p_role not in ('owner', 'manager', 'member') then
    raise exception 'The project, the person and one of the three roles must be given'
      using errcode = 'invalid_parameter_value';
  end if;
  if office.ctx_agent_code() is not null or v_caller is null or not office.is_insider() then
    raise exception 'Only the owner of a project or the founder changes roles in it'
      using errcode = 'insufficient_privilege';
  end if;
  perform 1 from office.project_members pm
    where pm.project_id = p_project and pm.company_id = office.ctx_company_id()
    order by pm.user_id
    for update;
  select pm.role into v_caller_role from office.project_members pm
    where pm.project_id = p_project and pm.company_id = office.ctx_company_id()
      and pm.user_id = v_caller;
  if not v_founder and v_caller_role is null then
    -- Not a reader of the project: for them it does not exist.
    raise exception 'No such project member' using errcode = 'no_data_found';
  end if;
  if not v_founder and v_caller_role <> 'owner' then
    raise exception 'Only the owner of a project or the founder changes roles in it'
      using errcode = 'insufficient_privilege';
  end if;
  select pm.role into v_current from office.project_members pm
    where pm.project_id = p_project and pm.company_id = office.ctx_company_id()
      and pm.user_id = p_user;
  if v_current is null then
    raise exception 'No such project member' using errcode = 'no_data_found';
  end if;
  if v_current = p_role then
    return false;
  end if;
  if v_current = 'owner' then
    raise exception 'The owner keeps the role until the ownership is handed over to another member'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if p_role = 'owner' then
    update office.project_members pm set role = 'member'
      where pm.project_id = p_project and pm.role = 'owner';
  end if;
  update office.project_members pm set role = p_role
    where pm.project_id = p_project and pm.user_id = p_user;
  return true;
end
$$;
alter function office.set_project_member_role(uuid, uuid, text) owner to office_trigger;
revoke execute on function office.set_project_member_role(uuid, uuid, text) from public;
grant execute on function office.set_project_member_role(uuid, uuid, text) to office_api_private;

-- The trace ----------------------------------------------------------------------------------------

-- office.audit_project_member as of the project audit migration (20261008101900), with the role:
--   project_member_role_owner, project_member_role_manager, project_member_role_member
--                                  project_id: the project; record: the person (record_type user)
-- written when a role is given (also the owner's at the opening of a project; a plain member's
-- first role is the membership itself and leaves project_member_added alone).
create or replace function office.audit_project_member() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (new.company_id, new.project_id, 'project_member_added', 'user', new.user_id);
    if new.role <> 'member' then
      -- One of three fixed codes (check constraint), not free text.
      insert into office.audit_log (company_id, project_id, event, record_type, record_id)
        values (
          new.company_id, new.project_id, 'project_member_role_' || new.role, 'user', new.user_id
        );
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into office.audit_log (company_id, project_id, event, record_type, record_id)
        values (
          new.company_id, new.project_id, 'project_member_role_' || new.role, 'user', new.user_id
        );
    end if;
  else
    insert into office.audit_log (company_id, project_id, event, record_type, record_id)
      values (old.company_id, old.project_id, 'project_member_removed', 'user', old.user_id);
  end if;
  return null;
end
$$;
drop trigger audit_project_member on office.project_members;
create trigger audit_project_member after insert or update or delete on office.project_members
  for each row execute function office.audit_project_member();
