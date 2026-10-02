-- Ajan çalışmaları ve araç çağrıları (kural 5, 9, 12; 2 Ekim karar 13).
--
-- Çalışmayı worker ajan bağlamında açar ve adım adım günceller; kişiler yalnızca okur. Görünürlük
-- bağlı olduğu görevden ya da projeden gelir. Ham içerik (model girdisi ve çıktısı, araç girdisi ve
-- sonucu) 90 gün sonra silinir, özet kalır (avukat başka süre söyleyene kadar).

create table ofis.calismalar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  gorev_id uuid,
  ajan_kod text not null references ofis.ajan_tanimlari (kod),
  kart_surum_id uuid not null,
  -- Çalışmanın kimliği: talep eden kişi ya da zamanlanmış işte ajanın sorumlusu.
  kullanici_id uuid not null references ofis.kullanicilar (id),
  tetik text not null check (tetik in ('talep', 'zamanlanmis', 'olay', 'devir')),
  model text not null check (length(model) > 0),
  durum text not null default 'suruyor'
    check (durum in ('suruyor', 'tamamlandi', 'hata', 'sinira_takildi', 'durduruldu')),
  -- Kural 5: iç iş ya da proje etiketi; proje alanından türetilir.
  etiket text not null generated always as (
    case when proje_id is null then 'ic_is' else 'proje' end
  ) stored,
  girdi_token integer not null default 0 check (girdi_token >= 0),
  cikti_token integer not null default 0 check (cikti_token >= 0),
  onbellek_yazma_token integer not null default 0 check (onbellek_yazma_token >= 0),
  onbellek_okuma_token integer not null default 0 check (onbellek_okuma_token >= 0),
  -- ABD doları; model, araç ve altyapı payı.
  maliyet numeric(12, 6) not null default 0 check (maliyet >= 0),
  arac_cagrisi_sayisi integer not null default 0 check (arac_cagrisi_sayisi >= 0),
  baslama timestamptz not null default now(),
  bitis timestamptz check (bitis >= baslama),
  sure_ms bigint generated always as (
    (extract(epoch from (bitis - baslama)) * 1000)::bigint
  ) stored,
  hata_kodu text check (hata_kodu ~ '^[a-z][a-z0-9_]*$'),
  ozet text,
  -- Ham içerik (karar 13).
  girdi jsonb,
  cikti jsonb,
  ham_saklama_sonu timestamptz not null default now() + interval '90 days',
  ham_silindi timestamptz,
  unique (id, sirket_id),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (gorev_id, sirket_id) references ofis.gorevler (id, sirket_id),
  foreign key (kart_surum_id, ajan_kod) references ofis.kart_surumleri (id, ajan_kod)
);
create index calismalar_sirket_baslama on ofis.calismalar (sirket_id, baslama desc);
create index calismalar_gorev on ofis.calismalar (gorev_id) where gorev_id is not null;
create index calismalar_ham on ofis.calismalar (ham_saklama_sonu) where ham_silindi is null;

-- Çalışma açılırken: kimlik ve ajan bağlamdan gelir, proje bağlamı çalışmanın projesidir ve ajan bu
-- şirkette açık olmalıdır (durdurulan ajan yeni iş almaz). AI izni olmayan projede çalışma açılamaz:
-- izinsiz proje ajan bağlamında görünmediği için satır kuralı reddeder (kural 12).
create function ofis.calisma_acilisi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if ofis.baglam_ajan() is null or new.ajan_kod is distinct from ofis.baglam_ajan() then
    raise exception 'Çalışma yalnızca kendi ajan bağlamında açılır' using errcode = 'insufficient_privilege';
  end if;
  new.kullanici_id := ofis.baglam_kullanici();
  new.proje_id := ofis.baglam_proje();
  new.baslama := pg_catalog.now();
  new.ham_saklama_sonu := pg_catalog.now() + interval '90 days';
  new.ham_silindi := null;
  if not exists (
    select 1 from ofis.sirket_ajanlari sa
    where sa.sirket_id = new.sirket_id and sa.ajan_kod = new.ajan_kod and sa.durum = 'acik'
  ) then
    raise exception 'Ajan % bu şirkette açık değil', new.ajan_kod using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger calisma_acilisi before insert on ofis.calismalar
  for each row execute function ofis.calisma_acilisi();
create trigger proje_gorevden before insert on ofis.calismalar
  for each row execute function ofis.proje_kapsami('gorevler', 'gorev_id', 'denetle');
create trigger degismez before update on ofis.calismalar
  for each row execute function ofis.degismez_alanlar(
    'sirket_id', 'proje_id', 'gorev_id', 'ajan_kod', 'kart_surum_id', 'kullanici_id', 'tetik',
    'baslama', 'ham_saklama_sonu'
  );

create table ofis.arac_cagrilari (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  -- Çalışmanın projesinden gelir.
  proje_id uuid,
  calisma_id uuid not null,
  sira integer not null check (sira > 0),
  arac_ad text not null references ofis.araclar (ad),
  -- basladi: çağrı yürütülmeden önce açılır; dış etkili çağrı onaysız açılamaz (onaylar göçü).
  durum text not null default 'basladi'
    check (durum in ('basladi', 'tamam', 'hata', 'onaya_gonderildi', 'engellendi')),
  -- Onaya düşen ya da onayla yürütülen çağrının onay kaydı (yabancı anahtar onaylar göçünde).
  onay_id uuid,
  hata_kodu text check (hata_kodu ~ '^[a-z][a-z0-9_]*$'),
  baslama timestamptz not null default now(),
  bitis timestamptz check (bitis >= baslama),
  sure_ms bigint generated always as (
    (extract(epoch from (bitis - baslama)) * 1000)::bigint
  ) stored,
  -- Ham içerik (karar 13).
  girdi jsonb,
  sonuc jsonb,
  ham_saklama_sonu timestamptz not null default now() + interval '90 days',
  ham_silindi timestamptz,
  unique (calisma_id, sira),
  foreign key (calisma_id, sirket_id) references ofis.calismalar (id, sirket_id),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id)
);
create index arac_cagrilari_ham on ofis.arac_cagrilari (ham_saklama_sonu) where ham_silindi is null;

create function ofis.arac_cagrisi_acilisi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.baslama := pg_catalog.now();
  new.ham_saklama_sonu := pg_catalog.now() + interval '90 days';
  new.ham_silindi := null;
  return new;
end
$$;
create trigger arac_cagrisi_acilisi before insert on ofis.arac_cagrilari
  for each row execute function ofis.arac_cagrisi_acilisi();

-- Durum yalnızca ileri gider: onaya_gonderildi -> basladi ya da engellendi; basladi -> tamam ya da
-- hata. Biten çağrı yeniden başlatılamaz; yeniden deneme yeni bir çağrıdır.
create function ofis.arac_cagrisi_durumu() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.durum is distinct from old.durum and not (
    (old.durum = 'onaya_gonderildi' and new.durum in ('basladi', 'engellendi'))
    or (old.durum = 'basladi' and new.durum in ('tamam', 'hata'))
  ) then
    raise exception 'Araç çağrısı % durumundan % durumuna geçemez', old.durum, new.durum
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger arac_cagrisi_durumu before update on ofis.arac_cagrilari
  for each row execute function ofis.arac_cagrisi_durumu();
create trigger proje_calismadan before insert on ofis.arac_cagrilari
  for each row execute function ofis.proje_kapsami('calismalar', 'calisma_id', 'turet');
create trigger degismez before update on ofis.arac_cagrilari
  for each row execute function ofis.degismez_alanlar(
    'sirket_id', 'proje_id', 'calisma_id', 'sira', 'arac_ad', 'baslama', 'ham_saklama_sonu'
  );

alter table ofis.calismalar enable row level security;
alter table ofis.calismalar force row level security;
alter table ofis.arac_cagrilari enable row level security;
alter table ofis.arac_cagrilari force row level security;

-- Çalışma kayıtları silinmez.
grant select, insert, update on ofis.calismalar, ofis.arac_cagrilari to ofis_uygulama;

-- Görünürlük satır kuralından; yazma yalnızca çalışmanın kendi ajan bağlamında.
create policy gorunur on ofis.calismalar for select to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id));
create policy ajan_yazar on ofis.calismalar for insert to ofis_uygulama
  with check (ofis.satir_gorunur(sirket_id, proje_id) and ajan_kod = ofis.baglam_ajan());
create policy ajan_gunceller on ofis.calismalar for update to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id) and ajan_kod = ofis.baglam_ajan());

create policy gorunur on ofis.arac_cagrilari for select to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id));
create policy ajan_yazar on ofis.arac_cagrilari for insert to ofis_uygulama
  with check (
    ofis.satir_gorunur(sirket_id, proje_id)
    and exists (
      select 1 from ofis.calismalar c where c.id = calisma_id and c.ajan_kod = ofis.baglam_ajan()
    )
  );
create policy ajan_gunceller on ofis.arac_cagrilari for update to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and exists (
      select 1 from ofis.calismalar c where c.id = calisma_id and c.ajan_kod = ofis.baglam_ajan()
    )
  );

-- Ham içerik temizliği (karar 13). Worker günde bir çağırır; bağlam gerekmez. Yalnızca süresi
-- dolmuş satırların ham alanlarını boşaltır.
grant select (id, ham_saklama_sonu, ham_silindi), update (girdi, cikti, ham_silindi)
  on ofis.calismalar to ofis_tetikleyici;
grant select (id, ham_saklama_sonu, ham_silindi), update (girdi, sonuc, ham_silindi)
  on ofis.arac_cagrilari to ofis_tetikleyici;
-- Güncellenen satırın yeni hâli okuma kuralından da geçmeli; bu yüzden okuma ayrı ve geniştir
-- (rolün okuyabildiği sütunlar yalnızca yukarıdakiler).
create policy tetikleyici_okur on ofis.calismalar for select to ofis_tetikleyici using (true);
create policy ham_temizligi on ofis.calismalar for update to ofis_tetikleyici
  using (ham_saklama_sonu <= now() and ham_silindi is null) with check (true);
create policy tetikleyici_okur on ofis.arac_cagrilari for select to ofis_tetikleyici using (true);
create policy ham_temizligi on ofis.arac_cagrilari for update to ofis_tetikleyici
  using (ham_saklama_sonu <= now() and ham_silindi is null) with check (true);

create function ofis.ham_icerik_temizle() returns integer
  language plpgsql security definer set search_path = ''
  as $$
declare
  calisma_sayisi integer;
  cagri_sayisi integer;
begin
  update ofis.calismalar set girdi = null, cikti = null, ham_silindi = pg_catalog.now()
    where ham_saklama_sonu <= pg_catalog.now() and ham_silindi is null;
  get diagnostics calisma_sayisi = row_count;
  update ofis.arac_cagrilari set girdi = null, sonuc = null, ham_silindi = pg_catalog.now()
    where ham_saklama_sonu <= pg_catalog.now() and ham_silindi is null;
  get diagnostics cagri_sayisi = row_count;
  return calisma_sayisi + cagri_sayisi;
end
$$;
alter function ofis.ham_icerik_temizle() owner to ofis_tetikleyici;
revoke execute on function ofis.ham_icerik_temizle() from public;
grant execute on function ofis.ham_icerik_temizle() to ofis_uygulama;
