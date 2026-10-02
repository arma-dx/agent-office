-- İstasyon aday kayıtları (P-IST-1'in korumalı alanı, kural 4) ve şirket bağlantıları.

create table ofis.istasyon_adaylari (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  -- Kaynağın adı ya da adresi ve kaynaktaki kayıt kimliği.
  kaynak text not null check (length(trim(kaynak)) > 0),
  kaynak_kayit_kimligi text,
  ad text,
  adres text,
  enlem numeric(9, 6) check (enlem between -90 and 90),
  boylam numeric(9, 6) check (boylam between -180 and 180),
  operator text,
  soket_tipleri text[] not null default '{}',
  guc_kw numeric(7, 2) check (guc_kw > 0),
  erisim text,
  -- Verinin kaynaktaki tarihi.
  veri_tarihi date,
  kapali boolean not null default false,
  dogrulama_durumu text not null default 'bekliyor'
    check (dogrulama_durumu in ('bekliyor', 'dogrulandi', 'reddedildi')),
  -- Pillika uygulamasındaki eşleşen istasyon kaydının kimliği.
  eslesen_kayit text,
  calisma_id uuid,
  olusturma timestamptz not null default now(),
  guncelleme timestamptz not null default now(),
  foreign key (calisma_id, sirket_id) references ofis.calismalar (id, sirket_id)
);
create index istasyon_adaylari_eslesen on ofis.istasyon_adaylari (sirket_id, eslesen_kayit)
  where eslesen_kayit is not null;
create trigger guncelleme before update on ofis.istasyon_adaylari
  for each row execute function ofis.guncelleme_zamani();
create trigger degismez before update on ofis.istasyon_adaylari
  for each row execute function ofis.degismez_alanlar('sirket_id', 'olusturma');

-- Bağlantı ayarları ve yetkileri, şirket bazında. Token uygulama düzeyinde şifrelenir; çözme
-- anahtarı yalnızca worker ortamındadır, burada yalnızca şifreli hâli durur.
create table ofis.entegrasyonlar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  tur text not null check (tur ~ '^[a-z][a-z0-9_]*$'),
  -- Bağlantıyı kuran hesap (ör. Google hesabı); kişi değil hesap adı.
  hesap text,
  kapsamlar text[] not null default '{}',
  ayarlar jsonb not null default '{}' check (jsonb_typeof(ayarlar) = 'object'),
  token_sifreli bytea,
  durum text not null default 'kapali' check (durum in ('kapali', 'acik', 'hata')),
  kuran_kullanici_id uuid references ofis.kullanicilar (id),
  olusturma timestamptz not null default now(),
  guncelleme timestamptz not null default now(),
  unique nulls not distinct (sirket_id, tur, hesap)
);
create trigger guncelleme before update on ofis.entegrasyonlar
  for each row execute function ofis.guncelleme_zamani();
create trigger degismez before update on ofis.entegrasyonlar
  for each row execute function ofis.degismez_alanlar('sirket_id', 'tur', 'olusturma');

alter table ofis.istasyon_adaylari enable row level security;
alter table ofis.istasyon_adaylari force row level security;
alter table ofis.entegrasyonlar enable row level security;
alter table ofis.entegrasyonlar force row level security;

grant select, insert, update, delete on ofis.istasyon_adaylari, ofis.entegrasyonlar to ofis_uygulama;

create policy sirket_ayrimi on ofis.istasyon_adaylari for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, null))
  with check (ofis.satir_gorunur(sirket_id, null));

-- Bağlantıyı kurucu yönetir; ajan çalışması (worker) kendi şirketinin bağlantısını okur.
create policy kurucu_yonetir on ofis.entegrasyonlar for all to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null)
  with check (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);
create policy ajan_okur on ofis.entegrasyonlar for select to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, null) and ofis.baglam_ajan() is not null);
