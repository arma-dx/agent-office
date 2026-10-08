-- Who opens and changes a project and its members (8 October decision 15; docs/SONRA.md P-a,
-- P-h, P-i, P-j; CLAUDE.md rules 2 and 9, "Şirketler, projeler ve görünürlük").
--
-- Until now only the founder wrote office.projects and office.project_members, and the worker's
-- role held the same table rights as the API's. From here on:
--   - a founder or an employee of a company opens a project there, through the API's role only;
--     whoever opens it becomes its member in the same statement (P-a);
--   - the founder and the members of a project change its name, description, customer, status,
--     colour, icon and target date, and add and remove its members (P-a); an employee does not
--     remove themselves (the founder may);
--   - only a founder or an employee of the company is a project member (P-j), and a member whose
--     role becomes "external" stops being one; a deactivated account is not added to a project;
--   - nobody deletes a project (P-h) and nobody rewrites a membership row;
--   - budget and milestones are in nobody's grant: their step gives them their own path;
--   - ai_allowed is in nobody's grant: the next migration gives it its own path.
-- Who READS a project does not change: the founder and the members (policy "visible").
-- A project is opened in a company, never in the founder space: only the founder is a member
-- there, so membership could decide nothing.
--
-- Error codes: 42501 not allowed (also a row the policy refuses), 23514 a rule of the record,
-- 23503 a person who is not a member of the company.

-- Projects ----------------------------------------------------------------------------------------

drop policy founder_manages on office.projects;
revoke insert, update, delete on office.projects from office_app;
-- The API gives a new project its id, so that a repeated send opens no second project.
grant insert (id, company_id, customer_id, name, description, status, color, icon, target_date)
  on office.projects to office_api_private;
grant update (customer_id, name, description, status, color, icon, target_date)
  on office.projects to office_api_private;

-- Decision 15: a founder or an employee opens a project in the context company.
create policy insider_opens on office.projects for insert to office_api_private
  with check (
    company_id = office.ctx_company_id() and office.is_insider() and office.ctx_agent_code() is null
  );
-- P-a: the founder and the members change it. The row must also be visible (policy "visible").
create policy member_edits on office.projects for update to office_api_private
  using (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and (office.is_founder() or (office.is_insider() and office.is_project_member(id)))
  )
  with check (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and (office.is_founder() or (office.is_insider() and office.is_project_member(id)))
  );

/*
 * A project opened by a person: who and when come from the context, the company is a real company,
 * and the AI permission starts closed (docs/SONRA.md W-i; the founder opens it afterwards, with a
 * passkey). Runs with the caller's rights. A row written without a person in the context
 * (migrations, the seed, an administrator) is left as it is.
 */
create function office.check_project() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if office.ctx_user_id() is null and office.ctx_agent_code() is null then
    return new;
  end if;
  if office.ctx_agent_code() is not null or office.ctx_user_id() is null then
    raise exception 'A project is opened by a person' using errcode = 'insufficient_privilege';
  end if;
  if office.company_kind(new.company_id) is distinct from 'company' then
    raise exception 'A project is opened in a company, not in the founder space'
      using errcode = 'check_violation';
  end if;
  if new.ai_allowed then
    raise exception 'A project is opened without AI permission; the founder opens it afterwards'
      using errcode = 'insufficient_privilege';
  end if;
  new.created_by_user_id := office.ctx_user_id();
  new.created_at := pg_catalog.now();
  return new;
end
$$;
revoke execute on function office.check_project() from public;
create trigger check_project before insert on office.projects
  for each row execute function office.check_project();
create trigger immutable_columns before update on office.projects
  for each row execute function office.prevent_column_changes(
    'id', 'company_id', 'created_by_user_id', 'created_at'
  );

-- Project members ---------------------------------------------------------------------------------

drop policy founder_manages on office.project_members;
revoke insert, update, delete on office.project_members from office_app;
-- A membership is added and removed, never rewritten. No passkey (5 October decision 4).
grant insert, delete on office.project_members to office_api_private;

create policy members_add on office.project_members for insert to office_api_private
  with check (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and (office.is_founder() or (office.is_insider() and office.is_project_member(project_id)))
  );
-- An employee removes other members, not themselves: nobody loses sight of a project by a slip.
create policy members_remove on office.project_members for delete to office_api_private
  using (
    company_id = office.ctx_company_id()
    and office.ctx_agent_code() is null
    and (
      office.is_founder()
      or (
        office.is_insider()
        and office.is_project_member(project_id)
        and user_id <> office.ctx_user_id()
      )
    )
  );

/*
 * P-j: a project member is a founder or an employee of the project's company, with an account that
 * is not deactivated (a deactivated person cannot sign in; if the account were opened again they
 * would find themselves a member). The role and the account are read as the reader role, so the
 * answer does not depend on which memberships the caller sees. A person who is not a member of the
 * company at all is left to the foreign key (23503).
 * An AFTER trigger, so that the row policy answers first (42501): only somebody who may add a
 * member to this project learns from the refusal that a person is external or deactivated. Before
 * the insert it would answer anybody who holds the insert privilege, about any company the row
 * names. Holds for every writer, the privileged role too.
 */
create function office.check_project_member() returns trigger
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
    raise exception 'A deactivated account is not added to a project'
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
alter function office.check_project_member() owner to office_auth_reader;
revoke execute on function office.check_project_member() from public;
create trigger check_project_member after insert on office.project_members
  for each row execute function office.check_project_member();
create trigger immutable_columns before update on office.project_members
  for each row execute function office.prevent_column_changes(
    'company_id', 'project_id', 'user_id'
  );

-- The bookkeeping below runs as office_trigger: it adds the opener of a project as its member and
-- removes the project memberships of a person who became external. Nothing else of the table is
-- its to write.
grant select, insert, delete on office.project_members to office_trigger;
create policy project_bookkeeping on office.project_members for all to office_trigger
  using (true) with check (true);

/*
 * P-a: who opens a project becomes its member, in the same statement and so in the same
 * transaction. Only for a person's own insert in the context company; a row written without a
 * person in the context gets no member.
 */
create function office.creator_becomes_member() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if office.ctx_user_id() is not null and office.ctx_agent_code() is null
     and new.company_id = office.ctx_company_id() then
    insert into office.project_members (company_id, project_id, user_id)
      values (new.company_id, new.id, office.ctx_user_id())
      on conflict (project_id, user_id) do nothing;
  end if;
  return null;
end
$$;
alter function office.creator_becomes_member() owner to office_trigger;
revoke execute on function office.creator_becomes_member() from public;
create trigger creator_becomes_member after insert on office.projects
  for each row execute function office.creator_becomes_member();

/*
 * P-j kept true after the fact: when a member of the company becomes an external person, their
 * project memberships in that company go. (Removing the company membership already removes them:
 * the foreign key cascades.)
 */
create function office.external_leaves_projects() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  delete from office.project_members pm
    where pm.company_id = new.company_id and pm.user_id = new.user_id;
  return null;
end
$$;
alter function office.external_leaves_projects() owner to office_trigger;
revoke execute on function office.external_leaves_projects() from public;
create trigger external_leaves_projects after update of role on office.memberships
  for each row when (new.role = 'external' and old.role is distinct from 'external')
  execute function office.external_leaves_projects();
