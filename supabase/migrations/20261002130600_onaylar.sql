-- Onay Masası verisi, kritik hata kaydı ve bildirim kaydı (kural 4; 2 Ekim kararları 10, 12;
-- M46 için yalnızca kayıt tablosu, kimin hatırlatacağı açık).
--
-- Onayı ajan açar (onaya_gonder), karar kişi verir: kurucu ya da kurucunun onay yetkisi verdiği
-- çalışan; ajan bağlamında karar verilemez. Dış etkili araç çağrısı onaylı bir onay kaydı olmadan
-- açılamaz.

-- Bağlamdaki kişinin onay yetkisi var mı (kurucu ya da yetki verilmiş çalışan).
create function ofis.onay_yetkili_mi() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce((
      select u.rol = 'kurucu' or (u.rol = 'calisan' and u.onay_yetkisi)
      from ofis.uyelikler u
      where u.sirket_id = ofis.baglam_sirket() and u.kullanici_id = ofis.baglam_kullanici()
    ), false)
  $$;
alter function ofis.onay_yetkili_mi() owner to ofis_yetki_okuyucu;
grant execute on function ofis.onay_yetkili_mi() to ofis_uygulama;

-- Onayın dayandığı kaydın bugünkü sürümü (çağıranın görebildiği kayıtlardan; görünmüyorsa NULL).
create function ofis.dayanak_surumu(p_tur text, p_id uuid) returns integer
  language sql stable set search_path = ''
  as $$
    select case p_tur
      when 'gorev' then (select g.surum from ofis.gorevler g where g.id = p_id)
      when 'not' then (select n.surum from ofis.notlar n where n.id = p_id)
    end
  $$;
grant execute on function ofis.dayanak_surumu(text, uuid) to ofis_uygulama;

create table ofis.onaylar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  -- Çalışmanın projesinden gelir.
  proje_id uuid,
  gorev_id uuid,
  calisma_id uuid not null,
  ajan_kod text not null references ofis.ajan_tanimlari (kod),
  -- Onayı gerektiren araç (ör. eposta_gonder, not_guncelle).
  arac_ad text references ofis.araclar (ad),
  baslik text not null check (length(trim(baslik)) > 0),
  ozet text,
  risk_notu text,
  fark text,
  -- Onaylanacak çıktının ya da eylemin tam hâli; onaydan sonra bu içerik uygulanır.
  icerik jsonb not null,
  kaynaklar jsonb not null default '[]' check (jsonb_typeof(kaynaklar) = 'array'),
  -- Seçenekli çıktı (M24): [{ "kod": "...", ... }]; karar verirken biri seçilir.
  secenekler jsonb check (secenekler is null or jsonb_typeof(secenekler) = 'array'),
  oncelik smallint not null default 3 check (oncelik between 1 and 4),
  ajan_gerekcesi text,
  -- X1-7: dayandığı kayıt ve sürümü. Kayıt değişirse onay kapanır (gecersiz_zamani).
  dayanak_turu text check (dayanak_turu in ('gorev', 'not')),
  dayanak_id uuid,
  dayanak_surumu integer check (dayanak_surumu > 0),
  -- M23: düzeltmeden sonra gelen onay öncekine bağlanır; deneme 1 ilk seferdir.
  onceki_onay_id uuid unique,
  deneme smallint not null default 1 check (deneme between 1 and 2),
  durum text not null default 'bekliyor'
    check (durum in ('bekliyor', 'onaylandi', 'duzeltme_istendi', 'reddedildi')),
  karar_veren_kullanici_id uuid references ofis.kullanicilar (id),
  karar_zamani timestamptz,
  karar_gerekcesi text,
  ret_nedeni text
    check (ret_nedeni in ('bilgi_hatali', 'eksik', 'dil_ve_ton', 'fiyat', 'kapsam_disi', 'diger')),
  secilen_secenek text,
  gecersiz_zamani timestamptz,
  -- M22: "dışarı gönderildi" durum değil, ayrı alan.
  gonderildi_kullanici_id uuid references ofis.kullanicilar (id),
  gonderildi_zamani timestamptz,
  olusturma timestamptz not null default now(),
  unique (id, sirket_id),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (gorev_id, sirket_id) references ofis.gorevler (id, sirket_id),
  foreign key (calisma_id, sirket_id) references ofis.calismalar (id, sirket_id),
  foreign key (onceki_onay_id, sirket_id) references ofis.onaylar (id, sirket_id),
  constraint dayanak_tam check (
    (dayanak_turu is null) = (dayanak_id is null) and (dayanak_id is null) = (dayanak_surumu is null)
  ),
  constraint karar_tam check (
    (durum = 'bekliyor') = (karar_zamani is null)
    and (karar_zamani is null) = (karar_veren_kullanici_id is null)
    and (durum <> 'bekliyor' or karar_gerekcesi is null)
  ),
  -- Karar 10: ret ve düzeltme nedeni sabit listeden seçilir.
  constraint ret_nedeni_gerekli check ((durum in ('reddedildi', 'duzeltme_istendi')) = (ret_nedeni is not null)),
  constraint secenek_onayda check (secilen_secenek is null or durum = 'onaylandi'),
  constraint gonderildi_onayliysa check (
    (gonderildi_zamani is null) = (gonderildi_kullanici_id is null)
    and (gonderildi_zamani is null or durum = 'onaylandi')
  )
);
-- Karar 10: aynı kayıt için tek bekleyen onay.
create unique index onaylar_tek_bekleyen on ofis.onaylar (dayanak_turu, dayanak_id)
  where durum = 'bekliyor' and gecersiz_zamani is null and dayanak_id is not null;
create index onaylar_bekleyen on ofis.onaylar (sirket_id, olusturma)
  where durum = 'bekliyor' and gecersiz_zamani is null;

create function ofis.onay_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  ajan text := ofis.baglam_ajan();
  onceki ofis.onaylar;
begin
  if tg_op = 'INSERT' then
    if ajan is null or new.ajan_kod is distinct from ajan then
      raise exception 'Onayı yalnızca ajan kendi çalışmasından açar' using errcode = 'insufficient_privilege';
    end if;
    if not exists (
      select 1 from ofis.calismalar c where c.id = new.calisma_id and c.ajan_kod = new.ajan_kod
    ) then
      raise exception 'Onayın çalışması bu ajanın değil' using errcode = 'check_violation';
    end if;
    new.durum := 'bekliyor';
    new.karar_veren_kullanici_id := null;
    new.karar_zamani := null;
    new.karar_gerekcesi := null;
    new.ret_nedeni := null;
    new.secilen_secenek := null;
    new.gecersiz_zamani := null;
    new.gonderildi_kullanici_id := null;
    new.gonderildi_zamani := null;
    new.olusturma := pg_catalog.now();
    if new.secenekler is not null and exists (
      select 1 from pg_catalog.jsonb_array_elements(new.secenekler) e
      where pg_catalog.jsonb_typeof(e -> 'kod') is distinct from 'string'
    ) then
      raise exception 'Her seçeneğin metin bir kodu olmalı' using errcode = 'check_violation';
    end if;
    if new.dayanak_id is not null
       and ofis.dayanak_surumu(new.dayanak_turu, new.dayanak_id) is distinct from new.dayanak_surumu then
      raise exception 'Dayanak kaydın sürümü güncel değil' using errcode = 'check_violation';
    end if;
    -- M23: düzeltme istenen iş aynı ajana döner; ikinci düzeltmeden sonra iş insana düşer.
    if new.onceki_onay_id is null then
      new.deneme := 1;
    else
      select * into onceki from ofis.onaylar o where o.id = new.onceki_onay_id;
      if onceki.id is null or onceki.durum <> 'duzeltme_istendi' or onceki.ajan_kod <> new.ajan_kod
         or onceki.gorev_id is distinct from new.gorev_id
         or onceki.dayanak_turu is distinct from new.dayanak_turu
         or onceki.dayanak_id is distinct from new.dayanak_id then
        raise exception 'Önceki onay bu işin düzeltme istenen onayı değil' using errcode = 'check_violation';
      end if;
      if onceki.deneme >= 2 then
        raise exception 'İkinci düzeltmeden sonra iş insana düşer' using errcode = 'check_violation';
      end if;
      new.deneme := onceki.deneme + 1;
    end if;
    return new;
  end if;

  -- Kapatma: yalnızca dayanak değişince tetikleyici rolü yazar.
  if new.gecersiz_zamani is distinct from old.gecersiz_zamani
     and current_user <> 'ofis_tetikleyici' then
    raise exception 'Onay elle kapatılamaz' using errcode = 'insufficient_privilege';
  end if;

  if old.durum <> 'bekliyor' then
    if new.durum is distinct from old.durum
       or new.karar_gerekcesi is distinct from old.karar_gerekcesi
       or new.ret_nedeni is distinct from old.ret_nedeni
       or new.secilen_secenek is distinct from old.secilen_secenek
       or new.ozet is distinct from old.ozet
       or new.risk_notu is distinct from old.risk_notu
       or new.oncelik is distinct from old.oncelik then
      raise exception 'Karar verilmiş onay değiştirilemez' using errcode = 'check_violation';
    end if;
  elsif new.ozet is distinct from old.ozet
     or new.risk_notu is distinct from old.risk_notu
     or new.oncelik is distinct from old.oncelik then
    if ajan is null and not ofis.onay_yetkili_mi() then
      raise exception 'Onay özetini ajan ya da onay yetkisi olan kişi değiştirir'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if old.durum = 'bekliyor' and new.durum <> 'bekliyor' then
    if ajan is not null or not ofis.onay_yetkili_mi() then
      raise exception 'Onay kararını yalnızca onay yetkisi olan kişi verir'
        using errcode = 'insufficient_privilege';
    end if;
    new.karar_veren_kullanici_id := ofis.baglam_kullanici();
    new.karar_zamani := pg_catalog.now();
    if new.durum = 'onaylandi' then
      if old.gecersiz_zamani is not null
         or (old.dayanak_id is not null
             and ofis.dayanak_surumu(old.dayanak_turu, old.dayanak_id) is distinct from old.dayanak_surumu) then
        raise exception 'Onayın dayandığı kayıt değişti; onay kapandı' using errcode = 'check_violation';
      end if;
      if old.secenekler is not null and not (
        old.secenekler @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kod', new.secilen_secenek))
      ) then
        raise exception 'Seçenekli onayda geçerli bir seçenek seçilmeli' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.gonderildi_zamani is distinct from old.gonderildi_zamani
     or new.gonderildi_kullanici_id is distinct from old.gonderildi_kullanici_id then
    if old.gonderildi_zamani is not null then
      raise exception 'Gönderildi işareti değiştirilemez' using errcode = 'check_violation';
    end if;
    if ajan is not null or not ofis.sirket_ici_mi() then
      raise exception 'Gönderildi işaretini kişi koyar' using errcode = 'insufficient_privilege';
    end if;
    new.gonderildi_kullanici_id := ofis.baglam_kullanici();
    new.gonderildi_zamani := pg_catalog.now();
  end if;
  return new;
end
$$;
create trigger onay_denetimi before insert or update on ofis.onaylar
  for each row execute function ofis.onay_denetimi();
create trigger proje_1_calismadan before insert on ofis.onaylar
  for each row execute function ofis.proje_kapsami('calismalar', 'calisma_id', 'turet');
create trigger proje_2_gorevden before insert on ofis.onaylar
  for each row execute function ofis.proje_kapsami('gorevler', 'gorev_id', 'denetle');

-- Dayanak değişince ya da silinince bekleyen onay kapanır (X1-7).
grant select (id, sirket_id, dayanak_turu, dayanak_id, dayanak_surumu, durum, gecersiz_zamani),
  update (gecersiz_zamani)
  on ofis.onaylar to ofis_tetikleyici;
-- Güncellenen satırın yeni hâli okuma kuralından da geçmeli; bu yüzden okuma ayrı ve geniştir.
create policy tetikleyici_okur on ofis.onaylar for select to ofis_tetikleyici using (true);
create policy dayanak_kapatma on ofis.onaylar for update to ofis_tetikleyici
  using (durum = 'bekliyor' and gecersiz_zamani is null) with check (true);

create function ofis.dayanak_degisti() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  kayit_id uuid;
  kayit_sirket uuid;
  yeni_surum integer;
begin
  if tg_op = 'DELETE' then
    kayit_id := old.id;
    kayit_sirket := old.sirket_id;
    yeni_surum := 2147483647;
  else
    if new.surum = old.surum then
      return null;
    end if;
    kayit_id := new.id;
    kayit_sirket := new.sirket_id;
    yeni_surum := new.surum;
  end if;
  update ofis.onaylar o set gecersiz_zamani = pg_catalog.now()
    where o.dayanak_turu = tg_argv[0] and o.dayanak_id = kayit_id and o.sirket_id = kayit_sirket
      and o.dayanak_surumu < yeni_surum and o.durum = 'bekliyor' and o.gecersiz_zamani is null;
  return null;
end
$$;
alter function ofis.dayanak_degisti() owner to ofis_tetikleyici;
create trigger onaylari_kapat after update or delete on ofis.gorevler
  for each row execute function ofis.dayanak_degisti('gorev');
create trigger onaylari_kapat after update or delete on ofis.notlar
  for each row execute function ofis.dayanak_degisti('not');

-- Kural 4: dış etkili araç çağrısı yalnızca bu ajana, bu araç için verilmiş, kapanmamış ve dayanağı
-- değişmemiş onaylı bir onayla açılır. Bir onay tek bir çağrı kaydına bağlanır (yeniden deneme yeni
-- onay ister).
alter table ofis.arac_cagrilari
  add foreign key (onay_id, sirket_id) references ofis.onaylar (id, sirket_id);
create unique index arac_cagrilari_onay_tek_kullanim on ofis.arac_cagrilari (onay_id);

create function ofis.dis_etki_kapisi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' and old.onay_id is not null and new.onay_id is distinct from old.onay_id then
    raise exception 'Araç çağrısının onayı değiştirilemez' using errcode = 'check_violation';
  end if;
  -- Kapı yürütmeye geçişte denetlenir; yürütme sırasında kapanan onay kaydın bitirilmesini engellemez.
  if new.durum in ('basladi', 'tamam')
     and (tg_op = 'INSERT' or old.durum not in ('basladi', 'tamam'))
     and exists (select 1 from ofis.araclar a where a.ad = new.arac_ad and a.sinif = 'dis_etki')
     and not exists (
       select 1 from ofis.onaylar o, ofis.calismalar c
       where o.id = new.onay_id and o.durum = 'onaylandi' and o.gecersiz_zamani is null
         and o.arac_ad = new.arac_ad
         and c.id = new.calisma_id and c.ajan_kod = o.ajan_kod
         and (o.dayanak_id is null
              or ofis.dayanak_surumu(o.dayanak_turu, o.dayanak_id) = o.dayanak_surumu)
     ) then
    raise exception 'Dış etkili araç çağrısı onaysız yürütülemez (kural 4)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger dis_etki_kapisi before insert or update on ofis.arac_cagrilari
  for each row execute function ofis.dis_etki_kapisi();

-- Karar 12: kurucu onaylanmış bir işi gerekçeyle kritik hata işaretler; inceleme görevi açılır.
-- Seviyenin nerede düşeceği açık (N12).
create table ofis.kritik_hatalar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  onay_id uuid not null unique,
  ajan_kod text not null references ofis.ajan_tanimlari (kod),
  gerekce text not null check (length(trim(gerekce)) > 0),
  isaretleyen_kullanici_id uuid not null references ofis.kullanicilar (id),
  inceleme_gorev_id uuid,
  olusturma timestamptz not null default now(),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (onay_id, sirket_id) references ofis.onaylar (id, sirket_id),
  foreign key (inceleme_gorev_id, sirket_id) references ofis.gorevler (id, sirket_id)
);

create function ofis.kritik_hata_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  onay ofis.onaylar;
begin
  if ofis.baglam_ajan() is not null or not ofis.kurucu_mu() then
    raise exception 'Kritik hatayı yalnızca kurucu işaretler' using errcode = 'insufficient_privilege';
  end if;
  select * into onay from ofis.onaylar o where o.id = new.onay_id;
  if onay.id is null or onay.durum <> 'onaylandi' then
    raise exception 'Kritik hata yalnızca onaylanmış işe konur' using errcode = 'check_violation';
  end if;
  new.ajan_kod := onay.ajan_kod;
  new.proje_id := onay.proje_id;
  new.isaretleyen_kullanici_id := ofis.baglam_kullanici();
  new.olusturma := pg_catalog.now();
  return new;
end
$$;
create trigger kritik_hata_denetimi before insert on ofis.kritik_hatalar
  for each row execute function ofis.kritik_hata_denetimi();

-- Bildirim kaydı (M46): kime, hangi şablonla, hangi kayıt için, hangi kanaldan. Serbest metin yok;
-- telefon bildirimi hassas bilgi taşımaz (M53 açık).
create table ofis.bildirimler (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid,
  alici_kullanici_id uuid not null,
  sablon text not null check (sablon ~ '^[a-z][a-z0-9_]*$'),
  kayit_turu text check (kayit_turu ~ '^[a-z][a-z0-9_]*$'),
  kayit_id uuid,
  kanal text not null default 'panel' check (kanal in ('panel', 'push', 'eposta')),
  gonderen_ajan_kod text references ofis.ajan_tanimlari (kod),
  gonderen_kullanici_id uuid references ofis.kullanicilar (id),
  olusturma timestamptz not null default now(),
  okunma timestamptz,
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id),
  foreign key (sirket_id, alici_kullanici_id) references ofis.uyelikler (sirket_id, kullanici_id)
    on delete cascade,
  constraint kayit_tam check ((kayit_turu is null) = (kayit_id is null))
);
create index bildirimler_alici on ofis.bildirimler (alici_kullanici_id, olusturma desc);

create function ofis.bildirim_gondereni() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.gonderen_ajan_kod := ofis.baglam_ajan();
  new.gonderen_kullanici_id := case when new.gonderen_ajan_kod is null then ofis.baglam_kullanici() end;
  new.olusturma := pg_catalog.now();
  new.okunma := null;
  return new;
end
$$;
create trigger bildirim_gondereni before insert on ofis.bildirimler
  for each row execute function ofis.bildirim_gondereni();

alter table ofis.onaylar enable row level security;
alter table ofis.onaylar force row level security;
alter table ofis.kritik_hatalar enable row level security;
alter table ofis.kritik_hatalar force row level security;
alter table ofis.bildirimler enable row level security;
alter table ofis.bildirimler force row level security;

-- Onay kaydı silinmez; içerik sütunları açıldıktan sonra değiştirilemez (yalnızca aşağıdaki sütunlar).
grant select, insert, update (
  ozet, risk_notu, oncelik, durum, karar_gerekcesi, ret_nedeni, secilen_secenek,
  gonderildi_kullanici_id, gonderildi_zamani
) on ofis.onaylar to ofis_uygulama;
grant select, insert, update (inceleme_gorev_id) on ofis.kritik_hatalar to ofis_uygulama;
grant select, insert, update (okunma) on ofis.bildirimler to ofis_uygulama;

create policy gorunur on ofis.onaylar for select to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id));
create policy ajan_acar on ofis.onaylar for insert to ofis_uygulama
  with check (ofis.satir_gorunur(sirket_id, proje_id) and ajan_kod = ofis.baglam_ajan());
create policy guncelleme on ofis.onaylar for update to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and (ofis.baglam_ajan() is not null or ofis.sirket_ici_mi())
  );

create policy gorunur on ofis.kritik_hatalar for select to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id));
create policy kurucu_yazar on ofis.kritik_hatalar for insert to ofis_uygulama
  with check (ofis.satir_gorunur(sirket_id, proje_id) and ofis.kurucu_mu() and ofis.baglam_ajan() is null);
create policy kurucu_gunceller on ofis.kritik_hatalar for update to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, proje_id) and ofis.kurucu_mu() and ofis.baglam_ajan() is null);

-- Alıcı kendi bildirimlerini görür ve okundu işaretler; ajanlar ve kurucu şirketin bildirim
-- kaydını görür (tekrar bildirim göndermemek için).
create policy alici_gorur on ofis.bildirimler for select to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and alici_kullanici_id = ofis.baglam_kullanici()
    and ofis.baglam_ajan() is null
    and ofis.rolum() is not null
  );
create policy kayit_gorunur on ofis.bildirimler for select to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and (ofis.baglam_ajan() is not null or ofis.kurucu_mu())
  );
create policy yazar on ofis.bildirimler for insert to ofis_uygulama
  with check (ofis.satir_gorunur(sirket_id, proje_id));
create policy alici_okur on ofis.bildirimler for update to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and alici_kullanici_id = ofis.baglam_kullanici()
    and ofis.baglam_ajan() is null
  );
