-- Login roles the API and the worker use to connect to the database (rule 9).
--
-- Both are members of office_app (they get their privileges and row policies from it); no
-- BYPASSRLS. The roles have no password, so they cannot connect after the migration. The founder
-- sets the password during setup with psql's \password command; the password lives only in the
-- server's secret settings and never enters migrations, the repository or logs
-- (docs/supabase-kurulum.md).

do $$
begin
  if not exists (select from pg_roles where rolname = 'office_api') then
    create role office_api login nobypassrls in role office_app;
  end if;
  if not exists (select from pg_roles where rolname = 'office_worker') then
    create role office_worker login nobypassrls in role office_app;
  end if;
end
$$;
