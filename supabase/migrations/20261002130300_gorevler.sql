-- Görev kaydı, yorumlar, dış kişiye açılan kayıtlar ve iş türleri (modül M2'nin verisi;
-- 2 Ekim kararları 6, 8, 11; ölçütler: tamamlanan iş, kaçan son tarih, yönlendirme doğruluğu,
-- kazanılan insan saati).

-- Kazanılan saatin ölçümü için işlerin bugünkü (ajansız) süresi.
create table ofis.is_turleri (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  kod text not null check (kod ~ '^[a-z][a-z0-9_]*$'),
  ad text not null,
  eski_sure_dakika integer check (eski_sure_dakika > 0),
  olcum_notu text,
  unique (sirket_id, kod),
  unique (id, sirket_id)
);

create table ofis.gorevler (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  -- Üst görev (teknik alan). Alt görevin sonuçlanma kuralı açık (M31).
  ust_gorev_id uuid,
  birim_kod text references ofis.birimler (kod),
  -- Yönlendirme doğruluğu ölçütü: KOR-1'in ilk verdiği birim ve sonradan düzeltilip düzeltilmediği.
  ilk_birim_kod text references ofis.birimler (kod),
  yonlendirme_duzeltildi boolean not null default false,
  baslik text not null check (length(trim(baslik)) > 0),
  aciklama text,
  talep_eden_kullanici_id uuid references ofis.kullanicilar (id),
  -- Atanan kişi şirketin üyesidir; üyeliği kalkarsa atama boşalır.
  atanan_kullanici_id uuid,
  atanan_ajan_kod text references ofis.ajan_tanimlari (kod),
  durum text not null default 'acik'
    check (durum in ('acik', 'suruyor', 'onay_bekliyor', 'yanit_bekliyor', 'tamamlandi', 'iptal')),
  oncelik smallint not null default 3 check (oncelik between 1 and 4),
  son_tarih timestamptz,
  -- Dış içerikten (e-posta, belge, web) türeyen görev: dis. Bir insan ajana atarsa ic olur.
  kaynak_turu text not null default 'ic' check (kaynak_turu in ('ic', 'dis')),
  is_turu_id uuid,
  -- Onayların dayandığı sürüm (X1-7): durum dışındaki her değişiklikte artar.
  surum integer not null default 1,
  olusturma timestamptz not null default now(),
  guncelleme timestamptz not null default now(),
  tamamlanma timestamptz,
  unique (id, sirket_id),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (ust_gorev_id, sirket_id) references ofis.gorevler (id, sirket_id),
  foreign key (is_turu_id, sirket_id) references ofis.is_turleri (id, sirket_id),
  foreign key (sirket_id, atanan_kullanici_id) references ofis.uyelikler (sirket_id, kullanici_id)
    on delete set null (atanan_kullanici_id),
  constraint tek_atanan check (atanan_kullanici_id is null or atanan_ajan_kod is null),
  -- 2 Ekim karar 8: dış kaynaklı görev bir ajana doğrudan atanamaz.
  constraint dis_kaynak_ajana_atanmaz check (kaynak_turu = 'ic' or atanan_ajan_kod is null)
);
create index gorevler_sirket_durum on ofis.gorevler (sirket_id, durum);
create index gorevler_proje on ofis.gorevler (proje_id) where proje_id is not null;

create function ofis.gorev_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  ajan text := ofis.baglam_ajan();
begin
  -- Karar 8: dış kaynaklı görevi bir insan ajana atarsa görev iç sayılır. Ajan bunu yapamaz:
  -- ajan bağlamında dış kaynaklı görev ajana atanamaz (kısıt) ve iç olarak işaretlenemez.
  if new.kaynak_turu = 'dis' and new.atanan_ajan_kod is not null and ajan is null then
    new.kaynak_turu := 'ic';
  end if;
  if tg_op = 'UPDATE' then
    if ajan is not null and old.kaynak_turu = 'dis' and new.kaynak_turu = 'ic' then
      raise exception 'Dış kaynaklı görevi ajan iç olarak işaretleyemez' using errcode = 'insufficient_privilege';
    end if;
    if (pg_catalog.to_jsonb(new) - array['durum', 'guncelleme', 'tamamlanma', 'surum'])
       is distinct from (pg_catalog.to_jsonb(old) - array['durum', 'guncelleme', 'tamamlanma', 'surum']) then
      new.surum := old.surum + 1;
    else
      new.surum := old.surum;
    end if;
  else
    new.surum := 1;
  end if;
  new.guncelleme := pg_catalog.now();
  if new.durum = 'tamamlandi' and (tg_op = 'INSERT' or old.durum is distinct from 'tamamlandi') then
    new.tamamlanma := pg_catalog.now();
  elsif new.durum <> 'tamamlandi' then
    new.tamamlanma := null;
  end if;
  return new;
end
$$;
create trigger gorev_denetimi before insert or update on ofis.gorevler
  for each row execute function ofis.gorev_denetimi();
-- Proje kapsamı değişmez: yorumlar, çalışmalar ve onaylar kapsamı görevden açılışta alır.
create trigger degismez before update on ofis.gorevler
  for each row execute function ofis.degismez_alanlar('sirket_id', 'proje_id', 'olusturma');

create table ofis.gorev_yorumlari (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  -- Görevin projesinden gelir.
  proje_id uuid,
  gorev_id uuid not null,
  yazan_kullanici_id uuid references ofis.kullanicilar (id),
  yazan_ajan_kod text references ofis.ajan_tanimlari (kod),
  metin text not null check (length(trim(metin)) > 0),
  olusturma timestamptz not null default now(),
  foreign key (gorev_id, sirket_id) references ofis.gorevler (id, sirket_id) on delete cascade,
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  constraint tek_yazar check ((yazan_kullanici_id is null) <> (yazan_ajan_kod is null))
);
create index gorev_yorumlari_gorev on ofis.gorev_yorumlari (gorev_id);

-- Yazan bağlamdan gelir: ajan çalışmasında ajan, değilse kişi.
create function ofis.yorum_yazani() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.yazan_ajan_kod := ofis.baglam_ajan();
  new.yazan_kullanici_id := case when new.yazan_ajan_kod is null then ofis.baglam_kullanici() end;
  new.olusturma := pg_catalog.now();
  return new;
end
$$;
create trigger proje_kapsami before insert on ofis.gorev_yorumlari
  for each row execute function ofis.proje_kapsami('gorevler', 'gorev_id', 'turet');
create trigger yorum_yazani before insert on ofis.gorev_yorumlari
  for each row execute function ofis.yorum_yazani();

-- Dış kişiye (mali müşavir, avukat) açılan görev ve notlar. Yalnızca kurucu açar.
create table ofis.erisim_paylasimlari (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  kullanici_id uuid not null,
  kayit_turu text not null check (kayit_turu in ('gorev', 'not')),
  kayit_id uuid not null,
  olusturma timestamptz not null default now(),
  unique (kullanici_id, kayit_turu, kayit_id),
  foreign key (sirket_id, kullanici_id) references ofis.uyelikler (sirket_id, kullanici_id)
    on delete cascade
);

grant select on ofis.erisim_paylasimlari to ofis_yetki_okuyucu;

-- Dış kişi bu kayda erişebilir mi (kendisine açılmış mı).
create function ofis.bana_acik_mi(p_tur text, p_kayit uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from ofis.erisim_paylasimlari ep
      where ep.kullanici_id = ofis.baglam_kullanici()
        and ep.sirket_id = ofis.baglam_sirket()
        and ep.kayit_turu = p_tur
        and ep.kayit_id = p_kayit
    )
  $$;
alter function ofis.bana_acik_mi(text, uuid) owner to ofis_yetki_okuyucu;
grant execute on function ofis.bana_acik_mi(text, uuid) to ofis_uygulama;

-- Bağlamdaki kişi dış kişi mi (ajan çalışması değil).
create function ofis.dis_kisi_mi() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(ofis.rolum() = 'dis_kisi', false) and ofis.baglam_ajan() is null $$;
grant execute on function ofis.dis_kisi_mi() to ofis_uygulama;

alter table ofis.is_turleri enable row level security;
alter table ofis.is_turleri force row level security;
alter table ofis.gorevler enable row level security;
alter table ofis.gorevler force row level security;
alter table ofis.gorev_yorumlari enable row level security;
alter table ofis.gorev_yorumlari force row level security;
alter table ofis.erisim_paylasimlari enable row level security;
alter table ofis.erisim_paylasimlari force row level security;

grant select, insert, update, delete on ofis.is_turleri, ofis.erisim_paylasimlari to ofis_uygulama;
-- Görev silinmez, iptal edilir; yorumlar değiştirilmez ve silinmez.
grant select, insert, update on ofis.gorevler to ofis_uygulama;
grant select, insert on ofis.gorev_yorumlari to ofis_uygulama;

create policy sirket_ayrimi on ofis.is_turleri for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, null))
  with check (ofis.satir_gorunur(sirket_id, null));

create policy sirket_ayrimi on ofis.gorevler for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id))
  with check (ofis.satir_gorunur(sirket_id, proje_id));
-- Dış kişi yalnızca kurucunun kendisine açtığı görevi görür (değiştiremez). Atama tek başına
-- görevi açmaz: dış kişiye açmak dışa etkilidir ve yalnızca kurucu yapar (erisim_paylasimlari).
create policy dis_kisi_gorur on ofis.gorevler for select to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.dis_kisi_mi() and ofis.bana_acik_mi('gorev', id));

create policy sirket_ayrimi on ofis.gorev_yorumlari for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id))
  with check (ofis.satir_gorunur(sirket_id, proje_id));
-- Dış kişi kendisine açık görevin yorumlarını görür ve kendi adına yorum ekler.
create policy dis_kisi_gorur on ofis.gorev_yorumlari for select to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and ofis.dis_kisi_mi()
    and exists (select 1 from ofis.gorevler g where g.id = gorev_id)
  );
create policy dis_kisi_yazar on ofis.gorev_yorumlari for insert to ofis_uygulama
  with check (
    sirket_id = ofis.baglam_sirket()
    and ofis.dis_kisi_mi()
    and yazan_kullanici_id = ofis.baglam_kullanici()
    and exists (select 1 from ofis.gorevler g where g.id = gorev_id)
  );

-- Paylaşımı kurucu yönetir; dış kişi kendi paylaşımlarını görür.
create policy kurucu_yonetir on ofis.erisim_paylasimlari for all to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null)
  with check (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);
create policy kendi_paylasimi on ofis.erisim_paylasimlari for select to ofis_uygulama
  using (kullanici_id = ofis.baglam_kullanici() and sirket_id = ofis.baglam_sirket());
create policy okuyucu on ofis.erisim_paylasimlari for select to ofis_yetki_okuyucu using (true);
