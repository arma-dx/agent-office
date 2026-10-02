-- Değiştirilemeyen olay kaydı (kural 5; 2 Ekim karar 13).
--
-- Yalnızca kimlikler yazılır: kim (kişi ya da ajan), hangi çalışma, hangi olay, hangi araç, hangi
-- kayıt ve dış sistemdeki kaynak kimliği. Serbest metin ve özet yazılmaz; ham içerik ve özet
-- `calismalar` tablosunda saklama süresine tabidir. Satır güncellenemez ve silinemez.

create table ofis.iz_kaydi (
  id bigint generated always as identity primary key,
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  zaman timestamptz not null default now(),
  kullanici_id uuid references ofis.kullanicilar (id),
  ajan_kod text references ofis.ajan_tanimlari (kod),
  calisma_id uuid,
  olay text not null check (olay ~ '^[a-z][a-z0-9_]{1,62}$'),
  arac_ad text references ofis.araclar (ad),
  kayit_turu text check (kayit_turu ~ '^[a-z][a-z0-9_]{1,62}$'),
  kayit_id uuid,
  -- Gmail ileti kimliği, Drive dosya kimliği, kaynak adresi gibi; boşluk ve serbest metin almaz.
  dis_kimlik text check (dis_kimlik ~ '^[A-Za-z0-9_.:/-]{1,255}$'),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (calisma_id, sirket_id) references ofis.calismalar (id, sirket_id),
  constraint kayit_tam check ((kayit_turu is null) = (kayit_id is null))
);
create index iz_kaydi_sirket_zaman on ofis.iz_kaydi (sirket_id, zaman desc);
create index iz_kaydi_calisma on ofis.iz_kaydi (calisma_id) where calisma_id is not null;

-- Kim ve ne zaman bağlamdan gelir; çağıran değiştiremez.
create function ofis.iz_kaydi_yazimi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.zaman := pg_catalog.now();
  new.kullanici_id := ofis.baglam_kullanici();
  new.ajan_kod := ofis.baglam_ajan();
  return new;
end
$$;
create trigger iz_kaydi_yazimi before insert on ofis.iz_kaydi
  for each row execute function ofis.iz_kaydi_yazimi();

-- Güncelleme, silme ve boşaltma veritabanı düzeyinde reddedilir (yetkili rol için de).
create function ofis.iz_kaydi_degismez() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  raise exception 'iz_kaydi değiştirilemez ve silinemez' using errcode = 'insufficient_privilege';
end
$$;
create trigger degismez before update or delete on ofis.iz_kaydi
  for each row execute function ofis.iz_kaydi_degismez();
create trigger bosaltilamaz before truncate on ofis.iz_kaydi
  for each statement execute function ofis.iz_kaydi_degismez();

alter table ofis.iz_kaydi enable row level security;
alter table ofis.iz_kaydi force row level security;

grant select, insert on ofis.iz_kaydi to ofis_uygulama;

-- Şirketin her üyesinin isteği ve her ajan çalışması kendi şirketine yazar; kaydı kurucu okur.
create policy yazar on ofis.iz_kaydi for insert to ofis_uygulama
  with check (sirket_id = ofis.baglam_sirket() and ofis.rolum() is not null);
create policy kurucu_okur on ofis.iz_kaydi for select to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);
