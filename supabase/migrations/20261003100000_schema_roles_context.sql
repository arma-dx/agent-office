-- Schema, roles and context functions (KALAN-ISLER 0.2; CLAUDE.md rules 1, 2, 9).
--
-- Tables live in the `office` schema. Supabase's internet-facing data API (PostgREST) only exposes
-- the schemas listed in its configuration; `office` is not listed, and the anon and authenticated
-- roles get no privileges at all. The browser never connects to the database (rule 1).
--
-- Roles:
--   office_app           Privileges of the API and the worker. NOLOGIN; the per-environment
--                        login role (e.g. office_api) is made a member of it and its password
--                        lives in the vault. No BYPASSRLS (rule 9).
--   office_auth_reader   Only reads the membership tables. Owns the SECURITY DEFINER functions that
--                        answer "what is my role, am I a member of this project" so that row
--                        policies do not call themselves and recurse. No BYPASSRLS; the privileged
--                        role is never used on the request path.
--   office_trigger       Owns the triggers that do bookkeeping: writing note versions and links,
--                        invalidating approvals whose basis changed, purging expired raw content.
--                        It has narrow privileges on only the columns these jobs need; no
--                        BYPASSRLS.
--   office_queue         Owner of the pg-boss schema (rule 10). office_app is a member of this
--                        role; it has no privileges on the `office` schema.
--
-- Nobody can log in as these roles. They have CREATE on the schema so they can own functions
-- (on Supabase the migration role is not a superuser; transferring ownership requires this).
--
-- The context is set with SET LOCAL on every request and on every step of an agent run:
--   app.company_id, app.user_id, app.project_id, app.email (login), app.agent_code (agent run).
-- When a value is missing the function returns NULL and the policies show no rows.

create schema if not exists office;
revoke all on schema office from public;

do $$
begin
  if not exists (select from pg_roles where rolname = 'office_app') then
    create role office_app nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'office_auth_reader') then
    create role office_auth_reader nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'office_trigger') then
    create role office_trigger nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'office_queue') then
    create role office_queue nologin nobypassrls;
  end if;
  -- Supabase's built-in roles never access this schema.
  if exists (select from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema office from anon';
  end if;
  if exists (select from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema office from authenticated';
  end if;
end
$$;

-- The role running the migrations becomes a member of these roles so it can hand object ownership
-- to them.
grant office_auth_reader, office_trigger, office_queue to current_user;

grant usage on schema office to office_app;
grant usage, create on schema office to office_auth_reader, office_trigger;

-- Context readers. An invalid value (e.g. a malformed uuid) raises an error; an empty value counts
-- as NULL.
create function office.ctx_company_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.company_id', true), '')::uuid $$;

create function office.ctx_user_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid $$;

create function office.ctx_project_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.project_id', true), '')::uuid $$;

create function office.ctx_email() returns text
  language sql stable set search_path = ''
  as $$ select pg_catalog.lower(nullif(pg_catalog.current_setting('app.email', true), '')) $$;

create function office.ctx_agent_code() returns text
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.agent_code', true), '') $$;

-- Trigger that stamps the update time.
create function office.set_updated_at() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

grant execute on function
  office.ctx_company_id(), office.ctx_user_id(), office.ctx_project_id(), office.ctx_email(),
  office.ctx_agent_code()
  to office_app, office_auth_reader, office_trigger;

-- Immutable columns: the columns named in the trigger arguments cannot change on update.
create function office.prevent_column_changes() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if (pg_catalog.to_jsonb(new) -> col) is distinct from (pg_catalog.to_jsonb(old) -> col) then
      raise exception '%.% cannot be changed', tg_table_name, col using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;

/*
 * The project scope comes from the linked record (PLAN: a run record's visibility comes from the
 * task or project it belongs to). Arguments: parent table, link column, mode.
 *   derive: project_id is set to the parent record's project_id.
 *   check:  raises an error if project_id differs from the parent record's.
 * The parent record must be visible to the caller (row policies apply here too); if it is not, an
 * error is raised. Does nothing when the link column is empty.
 */
create function office.inherit_project_scope() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  parent_id uuid := (pg_catalog.to_jsonb(new) ->> tg_argv[1])::uuid;
  parent_project uuid;
  parent_found boolean;
begin
  if parent_id is null then
    return new;
  end if;
  execute pg_catalog.format('select true, project_id from office.%I where id = $1', tg_argv[0])
    into parent_found, parent_project using parent_id;
  if parent_found is null then
    raise exception '%.% linked record not found', tg_table_name, tg_argv[1]
      using errcode = 'foreign_key_violation';
  end if;
  if tg_argv[2] = 'derive' then
    new.project_id := parent_project;
  elsif new.project_id is distinct from parent_project then
    raise exception '%.project_id must match the linked record''s project', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
