-- Şirkete özel ajan satırları, müşteriler, fırsatlar, projeler ve görünürlük işlevleri
-- (kural 2, 9, 12; 1 Ekim ikinci tur karar 1; 2 Ekim karar 2).
--
-- Şirket içi bağlantılar (proje, müşteri, görev...) `(id, sirket_id)` çiftine bağlanır; böylece bir
-- şirketin kaydı öteki şirketin kaydına bağlanamaz.

create table ofis.sirket_ajanlari (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  ajan_kod text not null references ofis.ajan_tanimlari (kod),
  -- Durdurma düğmesi bu satırdadır; "her yerde durdur" bütün şirketlerin satırını kapatır.
  durum text not null default 'kapali' check (durum in ('kapali', 'acik', 'durduruldu')),
  -- Drive klasörleri, öncelikli göndericiler, Figma çalışma dosyası (izin listeleri kodla denetlenir).
  ayarlar jsonb not null default '{}',
  aylik_butce numeric(12, 2),
  guncelleme timestamptz not null default now(),
  unique (sirket_id, ajan_kod)
);
create trigger guncelleme before update on ofis.sirket_ajanlari
  for each row execute function ofis.guncelleme_zamani();
create trigger degismez before update on ofis.sirket_ajanlari
  for each row execute function ofis.degismez_alanlar('sirket_id', 'ajan_kod');

-- Ajan yalnızca kartının `sirketler` alanında adı geçen şirkette açılabilir.
create function ofis.sirket_ajani_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if not exists (
    select 1 from ofis.ajan_tanimlari a, ofis.sirketler s
    where a.kod = new.ajan_kod and s.id = new.sirket_id and s.kod = any (a.sirket_kodlari)
  ) then
    raise exception 'Ajan % bu şirket için tanımlı değil', new.ajan_kod using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger sirket_ajani_denetimi before insert on ofis.sirket_ajanlari
  for each row execute function ofis.sirket_ajani_denetimi();

create table ofis.musteriler (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  ad text not null,
  kisiler jsonb not null default '[]',
  -- Kural 12: AI izni müşteri düzeyinde de tutulur. Varsayılan kapalı (varsayılanın kararı R8'de açık).
  ai_izni boolean not null default false,
  -- 2 Ekim karar 4: sözleşme kodla yapılan otomatik işlemeye izin veriyor mu.
  otomatik_isleme_izni boolean not null default false,
  olusturma timestamptz not null default now(),
  unique (id, sirket_id)
);

create table ofis.firsatlar (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  musteri_id uuid not null,
  ad text not null,
  asama text not null default 'yeni',
  deger numeric(14, 2),
  sonraki_adim text,
  teklif_sonucu text check (teklif_sonucu in ('verildi', 'kazanildi', 'kaybedildi')),
  olusturma timestamptz not null default now(),
  foreign key (musteri_id, sirket_id) references ofis.musteriler (id, sirket_id)
);

create table ofis.projeler (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  musteri_id uuid,
  ad text not null,
  butce numeric(14, 2),
  kilometre_taslari jsonb not null default '[]',
  -- Kural 12: proje düzeyinde AI izni. Varsayılan kapalı (R8).
  ai_izni boolean not null default false,
  durum text not null default 'acik' check (durum in ('acik', 'kapali')),
  olusturma timestamptz not null default now(),
  unique (id, sirket_id),
  foreign key (musteri_id, sirket_id) references ofis.musteriler (id, sirket_id)
);

-- Proje üyesi şirketin de üyesi olmalı; şirketten çıkan kişinin proje üyelikleri de silinir.
create table ofis.proje_uyeleri (
  sirket_id uuid not null references ofis.sirketler (id),
  proje_id uuid not null,
  kullanici_id uuid not null,
  primary key (proje_id, kullanici_id),
  foreign key (proje_id, sirket_id) references ofis.projeler (id, sirket_id) on delete cascade,
  foreign key (sirket_id, kullanici_id) references ofis.uyelikler (sirket_id, kullanici_id)
    on delete cascade
);

grant select on ofis.proje_uyeleri to ofis_yetki_okuyucu;

-- Bağlamdaki kullanıcı bu projenin üyesi mi (okuyucu rolle; satır kuralı kendini çağırmaz).
create function ofis.proje_uyesi_mi(p_proje uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from ofis.proje_uyeleri pu
      where pu.proje_id = p_proje and pu.kullanici_id = ofis.baglam_kullanici()
    )
  $$;
alter function ofis.proje_uyesi_mi(uuid) owner to ofis_yetki_okuyucu;
grant execute on function ofis.proje_uyesi_mi(uuid) to ofis_uygulama;

/*
 * Görünürlüğün çekirdeği. Bir satır yalnızca şu durumda görünür:
 * - satır bağlamdaki şirkete ait ve bağlamdaki kullanıcı o şirketin üyesi;
 * - kişi isteğinde: proje kapsamı yoksa şirket içi herkes (kurucu, çalışan); proje kapsamlıysa
 *   yalnızca kurucu ve proje üyeleri. Dış kişi burada hiçbir şey görmez; kendisine açılan kayıtlar
 *   ilgili tablonun kendi kuralıyla gelir.
 * - ajan çalışmasında (app.ajan_kod dolu): proje bağlamı yoksa yalnızca proje kapsamı olmayan
 *   satırlar; varsa proje kapsamı olmayan satırlar ve yalnızca kendi projesinin satırları.
 *   Kimlik kurucu olsa bile böyledir. Projenin kendisi ajan için ancak AI izni varsa görünür
 *   (projeler kuralı), bu yüzden izinsiz projenin satırları da görünmez. Çalışma kimliğinin
 *   sınırını da devralır: kimlik şirket içi biri olmalı, proje satırı için kurucu ya da proje üyesi.
 */
create function ofis.satir_gorunur(p_sirket uuid, p_proje uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select p_sirket = ofis.baglam_sirket()
      and ofis.rolum() is not null
      and case
        when ofis.baglam_ajan() is not null then
          ofis.sirket_ici_mi()
          and (
            p_proje is null
            or (
              p_proje = ofis.baglam_proje()
              and exists (select 1 from ofis.projeler pr where pr.id = p_proje)
            )
          )
        else
          ofis.sirket_ici_mi() and (p_proje is null or ofis.kurucu_mu() or ofis.proje_uyesi_mi(p_proje))
      end
  $$;
grant execute on function ofis.satir_gorunur(uuid, uuid) to ofis_uygulama;

alter table ofis.sirket_ajanlari enable row level security;
alter table ofis.sirket_ajanlari force row level security;
alter table ofis.musteriler enable row level security;
alter table ofis.musteriler force row level security;
alter table ofis.firsatlar enable row level security;
alter table ofis.firsatlar force row level security;
alter table ofis.projeler enable row level security;
alter table ofis.projeler force row level security;
alter table ofis.proje_uyeleri enable row level security;
alter table ofis.proje_uyeleri force row level security;

grant select, insert, update, delete
  on ofis.sirket_ajanlari, ofis.musteriler, ofis.firsatlar, ofis.projeler, ofis.proje_uyeleri
  to ofis_uygulama;

-- Şirkete özel ajan satırlarını şirket içi kişiler ve ajanlar görür; yalnızca kurucu değiştirir.
create policy gorunur on ofis.sirket_ajanlari for select to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, null));
create policy kurucu_yonetir on ofis.sirket_ajanlari for all to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null)
  with check (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);

-- AI izni ve otomatik işleme izni yalnızca kurucu tarafından açılır ya da kapatılır (proje AI izni
-- gibi; izni kimin işaretleyeceği R8'de açık, o güne kadar kurucu).
create function ofis.musteri_izin_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if (tg_op = 'INSERT' and (new.ai_izni or new.otomatik_isleme_izni))
     or (tg_op = 'UPDATE' and (new.ai_izni is distinct from old.ai_izni
                               or new.otomatik_isleme_izni is distinct from old.otomatik_isleme_izni)) then
    if ofis.baglam_ajan() is not null or not ofis.kurucu_mu() then
      raise exception 'Müşterinin AI iznini yalnızca kurucu değiştirir' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;
create trigger musteri_izin_denetimi before insert or update on ofis.musteriler
  for each row execute function ofis.musteri_izin_denetimi();

-- Müşteri: AI izni olmayan müşteri ajan çalışmalarına kapalıdır (2 Ekim karar 2).
create policy sirket_ayrimi on ofis.musteriler for all to ofis_uygulama
  using (ofis.satir_gorunur(sirket_id, null) and (ofis.baglam_ajan() is null or ai_izni))
  with check (ofis.satir_gorunur(sirket_id, null) and (ofis.baglam_ajan() is null or ai_izni));

-- Fırsat: müşterisi görünmüyorsa (izinsiz müşteri) ajan da fırsatı görmez.
create policy sirket_ayrimi on ofis.firsatlar for all to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, null)
    and exists (select 1 from ofis.musteriler m where m.id = musteri_id)
  )
  with check (
    ofis.satir_gorunur(sirket_id, null)
    and exists (select 1 from ofis.musteriler m where m.id = musteri_id)
  );

-- Proje kaydı proje kapsamlıdır: kurucu ve üyeler görür. Ajan yalnızca kendi projesini görür ve
-- yalnızca proje ve (varsa) müşterisi AI iznine sahipse.
create policy gorunur on ofis.projeler for select to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and ofis.rolum() is not null
    and case
      when ofis.baglam_ajan() is not null then
        id = ofis.baglam_proje()
        and ai_izni
        and (ofis.kurucu_mu() or (ofis.sirket_ici_mi() and ofis.proje_uyesi_mi(id)))
        and (musteri_id is null or exists (select 1 from ofis.musteriler m where m.id = musteri_id))
      else
        ofis.kurucu_mu() or (ofis.sirket_ici_mi() and ofis.proje_uyesi_mi(id))
    end
  );
-- Projeyi yalnızca kurucu açar, değiştirir ve siler (silme yalnızca USING koşuluna bakar).
create policy kurucu_yonetir on ofis.projeler for all to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null)
  with check (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);

-- Proje üyeleri: kişi kendi üyeliğini, kurucu ve proje üyeleri projenin üyelerini görür;
-- yalnızca kurucu değiştirir.
create policy gorunur on ofis.proje_uyeleri for select to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and ofis.baglam_ajan() is null
    and (kullanici_id = ofis.baglam_kullanici() or ofis.kurucu_mu() or ofis.proje_uyesi_mi(proje_id))
  );
create policy kurucu_yonetir on ofis.proje_uyeleri for all to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null)
  with check (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);
create policy okuyucu on ofis.proje_uyeleri for select to ofis_yetki_okuyucu using (true);
