-- The narrow team list the identity migration promised ("screens that need a team list, such as
-- task assignment, will get a narrow function later"; docs/SONRA.md, "Ekip listesi").
--
-- Rule 9 lets a person read only their own user row and memberships, so an employee cannot name
-- the requester of a task, its assignee or the author of a comment, and has nobody to pick as an
-- assignee. No row policy can open exactly "the name of a colleague and nothing else" (a policy
-- opens whole rows of users and memberships: the approval right, the active flag of other
-- companies' people), so the API alone cannot do this; two functions that return names do.
-- Neither returns an address, a session, a passkey or anything of another company.
--
-- Both run as office_auth_reader, the role that already reads memberships for the row policies; it
-- gets the name column of users for them. Only the API calls them (office_api_private): an agent
-- run gets nothing, and the worker has no privilege at all (what agents may learn about people is
-- the runner's decision).

grant select (name) on office.users to office_auth_reader;

-- The people of the context company, for its founder and employees: the assignee picker and the
-- names on the tasks of the company. Nothing for an external person, for a person who is not a
-- member, for a deactivated person, without a company in the context or in an agent run.
create function office.company_people()
  returns table (user_id uuid, name text, role text, active boolean)
  language sql stable security definer set search_path = ''
  as $$
    select m.user_id, u.name, m.role, u.active
    from office.memberships m
    join office.users u on u.id = m.user_id
    where m.company_id = office.ctx_company_id()
      and office.ctx_agent_code() is null
      and office.is_insider()
  $$;
alter function office.company_people() owner to office_auth_reader;
revoke execute on function office.company_people() from public;
grant execute on function office.company_people() to office_api_private;

-- The names of the given people, for any member of the context company, an external person too:
-- the people on a task that is open to them (requester, assignee, comment authors). Only people who
-- are members of that company today are named; the API passes the ids it read from rows the person
-- can see. A person who left the company gets no row (whether a former member may still be named
-- is a privacy question, docs/SONRA.md N36).
create function office.people_names(p_user_ids uuid[])
  returns table (user_id uuid, name text)
  language sql stable security definer set search_path = ''
  as $$
    select m.user_id, u.name
    from office.memberships m
    join office.users u on u.id = m.user_id
    where m.company_id = office.ctx_company_id()
      and m.user_id = any (p_user_ids)
      and office.ctx_agent_code() is null
      and office.my_role() is not null
  $$;
alter function office.people_names(uuid[]) owner to office_auth_reader;
revoke execute on function office.people_names(uuid[]) from public;
grant execute on function office.people_names(uuid[]) to office_api_private;
