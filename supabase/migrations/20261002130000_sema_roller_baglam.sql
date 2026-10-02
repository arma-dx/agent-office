-- Şema, roller ve bağlam işlevleri (KALAN-ISLER 0.2; CLAUDE.md kural 1, 2, 9).
--
-- Tablolar `ofis` şemasında durur. Supabase'in internete açık veri arayüzü (PostgREST) yalnızca
-- yapılandırmada listelenen şemaları açar; `ofis` listelenmez, anon ve authenticated rollerine de
-- hiçbir yetki verilmez. Tarayıcı veritabanına hiç bağlanmaz (kural 1).
--
-- Roller:
--   ofis_uygulama        API ve worker'ın yetkileri. NOLOGIN; ortam başına giriş rolü (ör. ofis_api)
--                        bu role üye yapılır ve parolası kasada durur. BYPASSRLS yok (kural 9).
--   ofis_yetki_okuyucu   Yalnızca üyelik tablolarını okur. Satır kurallarının kendini çağırıp
--                        kilitlenmemesi için "rolüm ne, bu projenin üyesi miyim" sorularını
--                        yanıtlayan SECURITY DEFINER işlevlerin sahibidir. BYPASSRLS yok; yetkili
--                        rol istek yolunda kullanılmaz.
--   ofis_tetikleyici     Kayıt tutma işlerini yapan tetikleyicilerin sahibi: not sürümü ve bağlantısı
--                        yazmak, dayanağı değişen onayı kapatmak, süresi dolan ham içeriği silmek.
--                        Yalnızca bu işler için gereken sütunlara dar yetkisi var; BYPASSRLS yok.
--   ofis_kuyruk          pg-boss şemasının sahibi (kural 10). ofis_uygulama bu role üyedir;
--                        `ofis` şemasına hiçbir yetkisi yoktur.
--
-- Bu rollere kimse giriş yapamaz. İşlev sahibi olabilmeleri için şemada CREATE yetkileri var
-- (Supabase'de göç rolü süper kullanıcı değildir; sahiplik devri bunu ister).
--
-- Bağlam her istekte ve ajan çalışmasının her adımında SET LOCAL ile kurulur:
--   app.sirket_id, app.kullanici_id, app.proje_id, app.eposta (giriş), app.ajan_kod (ajan çalışması).
-- Değer yoksa işlev NULL döner ve kurallar hiçbir satırı göstermez.

create schema if not exists ofis;
revoke all on schema ofis from public;

do $$
begin
  if not exists (select from pg_roles where rolname = 'ofis_uygulama') then
    create role ofis_uygulama nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'ofis_yetki_okuyucu') then
    create role ofis_yetki_okuyucu nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'ofis_tetikleyici') then
    create role ofis_tetikleyici nologin nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'ofis_kuyruk') then
    create role ofis_kuyruk nologin nobypassrls;
  end if;
  -- Supabase'in hazır rolleri bu şemaya hiç erişmez.
  if exists (select from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema ofis from anon';
  end if;
  if exists (select from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema ofis from authenticated';
  end if;
end
$$;

-- Göçleri çalıştıran rol, nesnelerin sahipliğini bu rollere verebilmek için onlara üye olur.
grant ofis_yetki_okuyucu, ofis_tetikleyici, ofis_kuyruk to current_user;

grant usage on schema ofis to ofis_uygulama;
grant usage, create on schema ofis to ofis_yetki_okuyucu, ofis_tetikleyici;

-- Bağlam okuma işlevleri. Geçersiz değer (ör. bozuk uuid) hata verir; boş değer NULL sayılır.
create function ofis.baglam_sirket() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.sirket_id', true), '')::uuid $$;

create function ofis.baglam_kullanici() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.kullanici_id', true), '')::uuid $$;

create function ofis.baglam_proje() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.proje_id', true), '')::uuid $$;

create function ofis.baglam_eposta() returns text
  language sql stable set search_path = ''
  as $$ select pg_catalog.lower(nullif(pg_catalog.current_setting('app.eposta', true), '')) $$;

create function ofis.baglam_ajan() returns text
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('app.ajan_kod', true), '') $$;

-- Güncelleme zamanı tetikleyicisi.
create function ofis.guncelleme_zamani() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.guncelleme := pg_catalog.now();
  return new;
end
$$;

grant execute on function
  ofis.baglam_sirket(), ofis.baglam_kullanici(), ofis.baglam_proje(), ofis.baglam_eposta(),
  ofis.baglam_ajan()
  to ofis_uygulama, ofis_yetki_okuyucu, ofis_tetikleyici;

-- Değişmez alanlar: tetikleyici argümanlarında adı geçen sütunlar güncellemede değişemez.
create function ofis.degismez_alanlar() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  alan text;
begin
  foreach alan in array tg_argv loop
    if (pg_catalog.to_jsonb(new) -> alan) is distinct from (pg_catalog.to_jsonb(old) -> alan) then
      raise exception '%.% alanı değiştirilemez', tg_table_name, alan using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;

/*
 * Proje kapsamı bağlı kayıttan gelir (PLAN: çalışma kayıtlarının görünürlüğü bağlı olduğu görevden
 * ya da projeden gelir). Argümanlar: üst tablo, bağlantı sütunu, kip.
 *   turet:   proje_id üst kaydın proje_id'si yapılır.
 *   denetle: proje_id üst kaydınkinden farklıysa hata verir.
 * Üst kayıt çağıranın görebildiği bir kayıt olmalıdır (satır kuralı burada da geçerli); görünmüyorsa
 * hata verir. Bağlantı sütunu boşsa bir şey yapmaz.
 */
create function ofis.proje_kapsami() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  ust_id uuid := (pg_catalog.to_jsonb(new) ->> tg_argv[1])::uuid;
  ust_proje uuid;
  bulundu boolean;
begin
  if ust_id is null then
    return new;
  end if;
  execute pg_catalog.format('select true, proje_id from ofis.%I where id = $1', tg_argv[0])
    into bulundu, ust_proje using ust_id;
  if bulundu is null then
    raise exception '%.% bağlı kaydı bulunamadı', tg_table_name, tg_argv[1]
      using errcode = 'foreign_key_violation';
  end if;
  if tg_argv[2] = 'turet' then
    new.proje_id := ust_proje;
  elsif new.proje_id is distinct from ust_proje then
    raise exception '%.proje_id bağlı kaydın projesiyle aynı olmalı', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
