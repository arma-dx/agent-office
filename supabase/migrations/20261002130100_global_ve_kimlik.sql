-- Global yapılandırma tabloları ve kimlik tabloları (kural 2, 3, 9).
--
-- Global tablolar (birimler, ajan_tanimlari, kart_surumleri, araclar) şirket verisi tutmaz, sirket_id
-- taşımaz; depodaki dosyalardan yetkili rolle senkronize edilir, uygulama rolü yalnızca okur.
-- Şirket adı koda gömülmez: yeni şirket yalnızca kayıtla açılır.

-- Global tablolar ---------------------------------------------------------------------------------

create table ofis.birimler (
  kod text primary key check (kod ~ '^[A-Z]{1,3}(-[A-Z]{2,4})?$'),
  ad text not null,
  aciklama text,
  -- null: iki şirkette ortak birim; dolu: o şirketin kısa kodu (sirketler.kod).
  sirket_kod text,
  pilotta_acik boolean not null default false
);

create table ofis.ajan_tanimlari (
  kod text primary key check (kod ~ '^[A-Z]{1,3}(-[A-Z]{2,4})?-[0-9]+$'),
  ad text not null,
  birim_kod text not null references ofis.birimler (kod),
  -- Kartın sirketler alanı: sirket_ajanlari satırı yalnızca bu şirketler için açılabilir.
  sirket_kodlari text[] not null default '{}',
  guncel_surum_id uuid
);

create table ofis.kart_surumleri (
  id uuid primary key default gen_random_uuid(),
  ajan_kod text not null references ofis.ajan_tanimlari (kod),
  git_commit text not null check (git_commit ~ '^[0-9a-f]{7,40}$'),
  icerik jsonb not null,
  yetki_seviyesi text not null check (yetki_seviyesi in ('Y0', 'Y1', 'Y2', 'Y3')),
  model text not null,
  olusturma timestamptz not null default now(),
  unique (ajan_kod, git_commit),
  -- Çalışma kaydı kart sürümünü ajan koduyla birlikte gösterir (başka ajanın sürümü yazılamaz).
  unique (id, ajan_kod)
);

alter table ofis.ajan_tanimlari
  add foreign key (guncel_surum_id) references ofis.kart_surumleri (id);

create table ofis.araclar (
  ad text primary key check (ad ~ '^[a-z][a-z_]*$'),
  sinif text not null check (sinif in ('okuma', 'taslak', 'ic_yazma', 'dis_etki')),
  aciklama text not null,
  onay text
);

grant select on ofis.birimler, ofis.ajan_tanimlari, ofis.kart_surumleri, ofis.araclar
  to ofis_uygulama;

-- Şirketler ve kimlik -----------------------------------------------------------------------------

-- sirketler kiracının kendisidir; sirket_id taşımaz. tur: sirket ya da ozel_alan (Kurucu alanı).
create table ofis.sirketler (
  id uuid primary key default gen_random_uuid(),
  kod text not null unique check (kod ~ '^[a-z][a-z0-9_]*$'),
  ad text not null,
  tur text not null check (tur in ('sirket', 'ozel_alan')),
  olusturma timestamptz not null default now()
);

-- Kişi birden çok şirkete üye olabilir; bu yüzden kullanicilar sirket_id taşımaz.
create table ofis.kullanicilar (
  id uuid primary key default gen_random_uuid(),
  ad text not null,
  aktif boolean not null default true,
  olusturma timestamptz not null default now()
);

-- Bir kişinin birden çok Google hesabı olabilir (kurucunun Arma DX ve Pillika adresleri gibi); hepsi
-- aynı kullanıcıya bağlanır. Giriş, doğrulanmış e-postanın burada kaydı varsa yapılır (kural 3).
-- Kimlik tablosudur, sirket_id taşımaz.
create table ofis.kullanici_epostalari (
  eposta text primary key check (eposta = lower(eposta) and eposta ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  kullanici_id uuid not null references ofis.kullanicilar (id) on delete cascade,
  olusturma timestamptz not null default now()
);
create index kullanici_epostalari_kullanici on ofis.kullanici_epostalari (kullanici_id);

create table ofis.uyelikler (
  id uuid primary key default gen_random_uuid(),
  sirket_id uuid not null references ofis.sirketler (id),
  kullanici_id uuid not null references ofis.kullanicilar (id),
  rol text not null check (rol in ('kurucu', 'calisan', 'dis_kisi')),
  -- Çalışana onay yetkisi kurucu verirse açılır (PLAN, Roller).
  onay_yetkisi boolean not null default false,
  olusturma timestamptz not null default now(),
  unique (sirket_id, kullanici_id)
);

-- Kurucu alanına (ozel_alan) yalnızca kurucu üye olabilir.
create function ofis.uyelik_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.rol <> 'kurucu'
     and exists (select 1 from ofis.sirketler s where s.id = new.sirket_id and s.tur = 'ozel_alan') then
    raise exception 'Kurucu alanına yalnızca kurucu üye olabilir' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger uyelik_denetimi before insert or update on ofis.uyelikler
  for each row execute function ofis.uyelik_denetimi();

-- Okuyucu rol, üyelik sorularını satır kuralına takılmadan yanıtlamak için üyelikleri okur.
grant select on ofis.uyelikler to ofis_yetki_okuyucu;

-- Bağlamdaki kullanıcının bağlamdaki şirketteki rolü; üye değilse NULL.
create function ofis.rolum() returns text
  language sql stable security definer set search_path = ''
  as $$
    select u.rol from ofis.uyelikler u
    where u.sirket_id = ofis.baglam_sirket() and u.kullanici_id = ofis.baglam_kullanici()
  $$;
alter function ofis.rolum() owner to ofis_yetki_okuyucu;

-- Bağlamdaki kullanıcı bağlamdaki şirkette kurucu ya da çalışan mı (dış kişi değil).
create function ofis.sirket_ici_mi() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(ofis.rolum() in ('kurucu', 'calisan'), false) $$;

create function ofis.kurucu_mu() returns boolean
  language sql stable set search_path = ''
  as $$ select coalesce(ofis.rolum() = 'kurucu', false) $$;

grant execute on function ofis.rolum(), ofis.sirket_ici_mi(), ofis.kurucu_mu() to ofis_uygulama;

-- Bağlamdaki kişi bu hesabı yönetebilir mi: hesap bağlamdaki şirketin üyesi ve hesabın üyesi olduğu
-- her şirkette bağlamdaki kişi kurucu. Hiçbir şirkete üye olmayan hesabı kimse yönetemez; böylece bir
-- şirketin kurucusu başka bir şirkete erişen ya da sahipsiz kalan bir hesabı değiştiremez.
create function ofis.hesabi_yonetebilir_mi(p_kullanici uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select ofis.baglam_ajan() is null
      and ofis.baglam_kullanici() is not null
      and exists (
        select 1 from ofis.uyelikler u
        where u.kullanici_id = p_kullanici and u.sirket_id = ofis.baglam_sirket()
      )
      and not exists (
        select 1 from ofis.uyelikler u
        where u.kullanici_id = p_kullanici
          and not exists (
            select 1 from ofis.uyelikler k
            where k.sirket_id = u.sirket_id and k.kullanici_id = ofis.baglam_kullanici()
              and k.rol = 'kurucu'
          )
      )
  $$;
alter function ofis.hesabi_yonetebilir_mi(uuid) owner to ofis_yetki_okuyucu;
grant execute on function ofis.hesabi_yonetebilir_mi(uuid) to ofis_uygulama;

-- Satır kuralları -----------------------------------------------------------------------------------

alter table ofis.sirketler enable row level security;
alter table ofis.sirketler force row level security;
alter table ofis.kullanicilar enable row level security;
alter table ofis.kullanicilar force row level security;
alter table ofis.kullanici_epostalari enable row level security;
alter table ofis.kullanici_epostalari force row level security;
alter table ofis.uyelikler enable row level security;
alter table ofis.uyelikler force row level security;

grant select on ofis.sirketler to ofis_uygulama;
-- Hesap açmak ve e-posta bağlamak davet ve giriş işinin parçasıdır (KALAN-ISLER 0.3): orada, adresin
-- sahibi Google ile doğrulandıktan sonra dar bir işlevle yapılır. O güne kadar uygulama kimlik
-- kaydı açamaz ve e-posta yazamaz; bu kayıtları yalnızca başlangıç verisi yazar.
grant select, update (ad, aktif) on ofis.kullanicilar to ofis_uygulama;
grant select on ofis.kullanici_epostalari to ofis_uygulama;
grant select, insert, update, delete on ofis.uyelikler to ofis_uygulama;

-- Okuyucu rolün kendi kuralı: üyelikleri koşulsuz okur (yalnızca SELECT yetkisi var).
create policy okuyucu on ofis.uyelikler for select to ofis_yetki_okuyucu using (true);

-- Kural 9: kullanıcı yalnızca kendi kaydını, kendi üyeliklerini (bütün şirketlerde; şirket seçici
-- için) ve üyesi olduğu şirketleri görür. Ajan çalışması kimliğin yalnızca bağlamdaki şirketteki
-- üyeliğini görür. Şirketin üye listesini yalnızca o şirketin kurucusu görür ve yönetir; ekip listesi
-- gereken ekranlar (görev atama gibi) için ileride dar bir işlev yazılır.
create policy gorunur on ofis.uyelikler for select to ofis_uygulama
  using (
    kullanici_id = ofis.baglam_kullanici()
    and (ofis.baglam_ajan() is null or sirket_id = ofis.baglam_sirket())
  );
-- Üyelikleri yalnızca o şirketin kurucusu ekler, değiştirir, kaldırır; ajan çalışması değiştiremez.
create policy kurucu_yonetir on ofis.uyelikler for all to ofis_uygulama
  using (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null)
  with check (sirket_id = ofis.baglam_sirket() and ofis.kurucu_mu() and ofis.baglam_ajan() is null);

-- Kullanıcı üyesi olduğu şirketleri görür (şirket seçici); ajan çalışması yalnızca kendi şirketini.
create policy gorunur on ofis.sirketler for select to ofis_uygulama
  using (
    (ofis.baglam_ajan() is null or id = ofis.baglam_sirket())
    and exists (
      select 1 from ofis.uyelikler u
      where u.sirket_id = sirketler.id and u.kullanici_id = ofis.baglam_kullanici()
    )
  );

-- E-posta kaydı: girişte doğrulanan e-postanın kendisi; kişinin kendi adresleri; kurucu ayrıca
-- şirketinin üyelerinin adreslerini görür. Ajan çalışması e-posta görmez (kişisel veri).
create policy gorunur on ofis.kullanici_epostalari for select to ofis_uygulama
  using (
    ofis.baglam_ajan() is null
    and (
      eposta = ofis.baglam_eposta()
      or kullanici_id = ofis.baglam_kullanici()
      or (
        ofis.kurucu_mu()
        and exists (
          select 1 from ofis.uyelikler u
          where u.kullanici_id = kullanici_epostalari.kullanici_id
            and u.sirket_id = ofis.baglam_sirket()
        )
      )
    )
  );
-- Kullanıcı kaydı: kendisi ve girişte doğrulanmış e-postanın sahibi; kurucu ayrıca şirketinin
-- üyelerini görür.
create policy gorunur on ofis.kullanicilar for select to ofis_uygulama
  using (
    id = ofis.baglam_kullanici()
    or exists (
      select 1 from ofis.kullanici_epostalari e
      where e.kullanici_id = kullanicilar.id and e.eposta = ofis.baglam_eposta()
    )
    or (
      ofis.kurucu_mu()
      and ofis.baglam_ajan() is null
      and exists (
        select 1 from ofis.uyelikler u
        where u.kullanici_id = kullanicilar.id and u.sirket_id = ofis.baglam_sirket()
      )
    )
  );
-- Kişi kendi adını günceller; kurucu, yönetebildiği hesabın adını günceller ve hesabı açar ya da
-- kapatır (aktif alanı). WHERE'siz toplu güncelleme de yalnızca bu satırlara ulaşır.
create policy guncelleme on ofis.kullanicilar for update to ofis_uygulama
  using (
    ofis.baglam_ajan() is null
    and (
      id = ofis.baglam_kullanici()
      or (ofis.kurucu_mu() and ofis.hesabi_yonetebilir_mi(id))
    )
  );

create function ofis.kullanici_denetimi() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if new.aktif is distinct from old.aktif and not ofis.hesabi_yonetebilir_mi(new.id) then
    raise exception 'Hesabı yalnızca kurucu açar ya da kapatır' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger kullanici_denetimi before update on ofis.kullanicilar
  for each row execute function ofis.kullanici_denetimi();
