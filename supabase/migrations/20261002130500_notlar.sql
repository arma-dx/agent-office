-- Kurumsal hafıza: notlar, sürümleri, bağlantıları; Drive'dan gelen belgeler ve üretilen dosyalar
-- (kural 4; 2 Ekim kararları 7, 8, 9).
--
-- Not Obsidian gibi çalışır: klasör yolu, başlık, YAML özellikler, markdown gövde, `[[Not adı]]`
-- bağlantıları. Sürümler ve bağlantılar not kaydedilirken tetikleyiciyle yazılır; uygulama bu iki
-- tabloyu yalnızca okur.

create table ofis.notlar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  klasor text not null default '' check (klasor !~ '(^/|/$|//|(^|/)\.\.?(/|$))'),
  -- Obsidian bağlantı adında [ ] | # ^ kullanılamaz.
  baslik text not null check (length(trim(baslik)) > 0 and baslik !~ '[][|#^]'),
  ozellikler jsonb not null default '{}' check (jsonb_typeof(ozellikler) = 'object'),
  govde text not null default '',
  -- Karar 7. Y1 ajanın notu taslak açılır, onaydan sonra paylaşılır.
  durum text not null default 'taslak' check (durum in ('taslak', 'etkin', 'eskimis', 'arsiv')),
  -- Karar 7: işareti yalnızca kurucu koyar ve kaldırır. İşaretli notu değiştirmek dışa etkilidir
  -- (kural 4): ajan bağlamında reddedilir, değişiklik onaydan sonra kurucu bağlamında uygulanır.
  tek_dogru_kaynak boolean not null default false,
  -- Karar 8: dış içerikten türeyen not.
  kaynak_turu text not null default 'ic' check (kaynak_turu in ('ic', 'dis')),
  surum integer not null default 1,
  olusturan_kullanici_id uuid references ofis.kullanicilar (id),
  olusturan_ajan_kod text references ofis.ajan_tanimlari (kod),
  guncelleyen_kullanici_id uuid references ofis.kullanicilar (id),
  guncelleyen_ajan_kod text references ofis.ajan_tanimlari (kod),
  olusturma timestamptz not null default now(),
  guncelleme timestamptz not null default now(),
  arama tsvector generated always as (
    setweight(to_tsvector('turkish'::regconfig, baslik), 'A')
    || setweight(to_tsvector('turkish'::regconfig, govde), 'B')
  ) stored,
  unique (id, sirket_id),
  -- Proje içinde benzersiz; başka projenin notu ekleme denemesiyle yoklanamaz.
  unique nulls not distinct (sirket_id, proje_id, klasor, baslik),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id)
);
create index notlar_arama on ofis.notlar using gin (arama);
create index notlar_baslik on ofis.notlar (sirket_id, lower(baslik));

create function ofis.not_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  ajan text := ofis.baglam_ajan();
  kisi uuid := case when ofis.baglam_ajan() is null then ofis.baglam_kullanici() end;
begin
  if tg_op = 'DELETE' then
    if ajan is not null then
      raise exception 'Notu ajan silemez; silme onaya gönderilir' using errcode = 'insufficient_privilege';
    end if;
    if old.tek_dogru_kaynak and not ofis.kurucu_mu() then
      raise exception 'Tek doğru kaynak notunu yalnızca kurucu siler' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if (tg_op = 'INSERT' and new.tek_dogru_kaynak)
     or (tg_op = 'UPDATE' and new.tek_dogru_kaynak is distinct from old.tek_dogru_kaynak) then
    if ajan is not null or not ofis.kurucu_mu() then
      raise exception 'Tek doğru kaynak işaretini yalnızca kurucu koyar ve kaldırır'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.olusturan_ajan_kod := ajan;
    new.olusturan_kullanici_id := kisi;
    new.olusturma := pg_catalog.now();
    new.surum := 1;
  else
    if ajan is not null then
      if old.tek_dogru_kaynak then
        raise exception 'Tek doğru kaynak notunu ajan değiştiremez; değişiklik onaya gönderilir'
          using errcode = 'insufficient_privilege';
      end if;
      if new.durum = 'arsiv' and old.durum <> 'arsiv' then
        raise exception 'Notu ajan arşivleyemez; arşivleme onaya gönderilir'
          using errcode = 'insufficient_privilege';
      end if;
      if old.kaynak_turu = 'dis' and new.kaynak_turu = 'ic' then
        raise exception 'Dış kaynaklı notu ajan iç olarak işaretleyemez'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    if (pg_catalog.to_jsonb(new) - array['surum', 'guncelleme', 'guncelleyen_kullanici_id',
          'guncelleyen_ajan_kod', 'arama'])
       is not distinct from (pg_catalog.to_jsonb(old) - array['surum', 'guncelleme',
          'guncelleyen_kullanici_id', 'guncelleyen_ajan_kod', 'arama']) then
      new.surum := old.surum;
      new.guncelleme := old.guncelleme;
      new.guncelleyen_ajan_kod := old.guncelleyen_ajan_kod;
      new.guncelleyen_kullanici_id := old.guncelleyen_kullanici_id;
      return new;
    end if;
    new.surum := old.surum + 1;
  end if;
  new.guncelleyen_ajan_kod := ajan;
  new.guncelleyen_kullanici_id := kisi;
  new.guncelleme := pg_catalog.now();
  return new;
end
$$;
create trigger not_denetimi before insert or update or delete on ofis.notlar
  for each row execute function ofis.not_denetimi();
create trigger degismez before update on ofis.notlar
  for each row execute function ofis.degismez_alanlar(
    'sirket_id', 'proje_id', 'olusturma', 'olusturan_kullanici_id', 'olusturan_ajan_kod'
  );

-- Her sürümün tam hâli. Not silinince sürümleri de silinir (kişisel veri silme talebi, N36).
create table ofis.not_surumleri (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  not_id uuid not null,
  surum integer not null,
  proje_id uuid,
  klasor text not null,
  baslik text not null,
  ozellikler jsonb not null,
  govde text not null,
  durum text not null,
  tek_dogru_kaynak boolean not null,
  kaynak_turu text not null,
  yazan_kullanici_id uuid references ofis.kullanicilar (id),
  yazan_ajan_kod text references ofis.ajan_tanimlari (kod),
  olusturma timestamptz not null default now(),
  unique (not_id, surum),
  foreign key (not_id, sirket_id) references ofis.notlar (id, sirket_id) on delete cascade
);

-- Gövdedeki ve özelliklerdeki `[[Hedef]]`, `[[Hedef#Başlık]]`, `[[Hedef|Görünen]]` bağlantıları.
-- Hedef adla tutulur (Obsidian'daki gibi); geri bağlantı başlıkla eşleştirilerek bulunur.
create table ofis.not_baglantilari (
  sirket_id uuid not null references ofis.sirketler (id),
  kaynak_not_id uuid not null,
  hedef_ad text not null check (length(hedef_ad) between 1 and 500),
  primary key (kaynak_not_id, hedef_ad),
  foreign key (kaynak_not_id, sirket_id) references ofis.notlar (id, sirket_id) on delete cascade
);
create index not_baglantilari_hedef on ofis.not_baglantilari (sirket_id, lower(hedef_ad));

grant insert on ofis.not_surumleri to ofis_tetikleyici;
grant select, insert, delete on ofis.not_baglantilari to ofis_tetikleyici;

-- Sürüm ve bağlantı yazımı. Tetikleyici işlevi doğrudan çağrılamaz; uygulama bu tablolara yazamaz.
create function ofis.not_kaydedildi() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' and new.surum = old.surum then
    return null;
  end if;
  insert into ofis.not_surumleri (
    sirket_id, not_id, surum, proje_id, klasor, baslik, ozellikler, govde, durum,
    tek_dogru_kaynak, kaynak_turu, yazan_kullanici_id, yazan_ajan_kod
  ) values (
    new.sirket_id, new.id, new.surum, new.proje_id, new.klasor, new.baslik, new.ozellikler,
    new.govde, new.durum, new.tek_dogru_kaynak, new.kaynak_turu, new.guncelleyen_kullanici_id,
    new.guncelleyen_ajan_kod
  );
  if tg_op = 'INSERT' or new.govde is distinct from old.govde
     or new.ozellikler is distinct from old.ozellikler then
    delete from ofis.not_baglantilari where kaynak_not_id = new.id;
    insert into ofis.not_baglantilari (sirket_id, kaynak_not_id, hedef_ad)
      select distinct new.sirket_id, new.id, pg_catalog.left(pg_catalog.btrim(m[1]), 500)
      from pg_catalog.regexp_matches(
        new.govde || ' ' || new.ozellikler::text,
        '\[\[([^][|#^]+)(#[^][|]*)?(\|[^][]*)?\]\]',
        'g'
      ) as m
      where pg_catalog.btrim(m[1]) <> '';
  end if;
  return null;
end
$$;
alter function ofis.not_kaydedildi() owner to ofis_tetikleyici;
create trigger not_kaydedildi after insert or update on ofis.notlar
  for each row execute function ofis.not_kaydedildi();

create policy tetikleyici_yazar on ofis.not_surumleri for insert to ofis_tetikleyici
  with check (true);
create policy tetikleyici_yazar on ofis.not_baglantilari for all to ofis_tetikleyici
  using (true) with check (true);

-- Drive'dan gelen kaynak dosyalar; her biri bir kaynak notuna bağlı, proje kapsamı nottan gelir.
create table ofis.belgeler (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  drive_dosya_id text not null check (drive_dosya_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  ad text not null,
  mime_turu text,
  drive_degisme timestamptz,
  kaynak_not_id uuid not null,
  olusturma timestamptz not null default now(),
  guncelleme timestamptz not null default now(),
  unique (sirket_id, drive_dosya_id),
  foreign key (kaynak_not_id, sirket_id) references ofis.notlar (id, sirket_id),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id)
);
create trigger proje_nottan before insert on ofis.belgeler
  for each row execute function ofis.proje_kapsami('notlar', 'kaynak_not_id', 'turet');
create trigger guncelleme before update on ofis.belgeler
  for each row execute function ofis.guncelleme_zamani();
create trigger degismez before update on ofis.belgeler
  for each row execute function ofis.degismez_alanlar(
    'sirket_id', 'proje_id', 'drive_dosya_id', 'kaynak_not_id'
  );

-- Karar 9: ajanların ürettiği PDF ve görseller. Dosyanın kendisi depoda, yolu şirket kimliğiyle başlar;
-- depoya erişim bu kaydın satır kuralından geçtikten sonra verilir (kural 9).
create table ofis.dosyalar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  gorev_id uuid,
  calisma_id uuid,
  ad text not null check (length(trim(ad)) > 0),
  mime_turu text not null,
  boyut_bayt bigint not null check (boyut_bayt >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  depolama_yolu text not null unique,
  olusturan_kullanici_id uuid references ofis.kullanicilar (id),
  olusturan_ajan_kod text references ofis.ajan_tanimlari (kod),
  olusturma timestamptz not null default now(),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (gorev_id, sirket_id) references ofis.gorevler (id, sirket_id),
  foreign key (calisma_id, sirket_id) references ofis.calismalar (id, sirket_id),
  constraint depolama_yolu_sirketin check (
    depolama_yolu like sirket_id::text || '/%' and depolama_yolu !~ '(^|/)\.\.?(/|$)'
  )
);

create function ofis.olusturan_baglamdan() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.olusturan_ajan_kod := ofis.baglam_ajan();
  new.olusturan_kullanici_id := case when new.olusturan_ajan_kod is null then ofis.baglam_kullanici() end;
  new.olusturma := pg_catalog.now();
  return new;
end
$$;
create trigger olusturan before insert on ofis.dosyalar
  for each row execute function ofis.olusturan_baglamdan();
create trigger proje_1_calismadan before insert on ofis.dosyalar
  for each row execute function ofis.proje_kapsami('calismalar', 'calisma_id', 'turet');
create trigger proje_2_gorevden before insert on ofis.dosyalar
  for each row execute function ofis.proje_kapsami('gorevler', 'gorev_id', 'denetle');

alter table ofis.notlar enable row level security;
alter table ofis.notlar force row level security;
alter table ofis.not_surumleri enable row level security;
alter table ofis.not_surumleri force row level security;
alter table ofis.not_baglantilari enable row level security;
alter table ofis.not_baglantilari force row level security;
alter table ofis.belgeler enable row level security;
alter table ofis.belgeler force row level security;
alter table ofis.dosyalar enable row level security;
alter table ofis.dosyalar force row level security;

grant select, insert, delete, update (
  klasor, baslik, ozellikler, govde, durum, tek_dogru_kaynak, kaynak_turu
) on ofis.notlar to ofis_uygulama;
grant select on ofis.not_surumleri, ofis.not_baglantilari to ofis_uygulama;
grant select, insert, update, delete on ofis.belgeler to ofis_uygulama;
-- Üretilen dosya kaydı değiştirilmez; silme kişisel veri talebi için açık.
grant select, insert, delete on ofis.dosyalar to ofis_uygulama;

create policy sirket_ayrimi on ofis.notlar for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id))
  with check (ofis.satir_gorunur(sirket_id, proje_id));
-- Dış kişi kendisine açılan notu görür (değiştiremez).
create policy dis_kisi_gorur on ofis.notlar for select to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.dis_kisi_mi() and ofis.bana_acik_mi('not', id));

-- Sürümler ve bağlantılar notun görünürlüğünü izler.
create policy not_gorunurse on ofis.not_surumleri for select to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and exists (select 1 from ofis.notlar n where n.id = not_id));
create policy not_gorunurse on ofis.not_baglantilari for select to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and exists (select 1 from ofis.notlar n where n.id = kaynak_not_id)
  );

create policy sirket_ayrimi on ofis.belgeler for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id))
  with check (ofis.satir_gorunur(sirket_id, proje_id));

create policy sirket_ayrimi on ofis.dosyalar for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id))
  with check (ofis.satir_gorunur(sirket_id, proje_id));
