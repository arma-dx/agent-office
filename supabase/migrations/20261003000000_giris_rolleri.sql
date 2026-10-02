-- API ve worker'ın veritabanına bağlandığı giriş rolleri (kural 9).
--
-- İkisi de ofis_uygulama üyesidir (yetkilerini ve satır kurallarını oradan alır); BYPASSRLS yok.
-- Rollerin parolası yoktur, bu yüzden göçten sonra bağlanamazlar. Parolayı kurucu kurulumda
-- psql'in \password komutuyla verir; parola yalnızca sunucunun gizli ayarlarında durur, göçe,
-- depoya ve loglara girmez (docs/supabase-kurulum.md).

do $$
begin
  if not exists (select from pg_roles where rolname = 'ofis_api') then
    create role ofis_api login nobypassrls in role ofis_uygulama;
  end if;
  if not exists (select from pg_roles where rolname = 'ofis_worker') then
    create role ofis_worker login nobypassrls in role ofis_uygulama;
  end if;
end
$$;
