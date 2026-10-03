-- Seed data. Locally, `supabase db reset` loads it into the empty database after the migrations;
-- in the test and production projects it is loaded once, into the empty database, during setup.
-- Company and unit rows skip what already exists; the founder block does nothing if the database
-- has any user. Changes after setup (a new address, a new member) are not carried by this file;
-- they are made from the panel or with a reviewed one-off command.

-- Companies are opened by inserting a record, not hard-coded (KALAN-ISLER 0.2, a prerequisite for
-- productisation).
insert into office.companies (code, name, kind) values
  ('armadx', 'Arma DX', 'company'),
  ('pillika', 'Pillika', 'company'),
  ('founder_space', 'Kurucu', 'private_space')
on conflict (code) do nothing;

-- Units: the same list as agents/units.yaml. When card sync (KALAN-ISLER 1.2) arrives, the units
-- are written from there and this block is removed.
insert into office.units (code, name, company_code, pilot_enabled) values
  ('KOR', 'Koordinasyon Katmanı', null, true),
  ('OFY', 'Ofis Yönetimi ve Denetim', null, false),
  ('HAF', 'Kurumsal Hafıza', null, true),
  ('STR', 'Strateji ve Yönetim', null, false),
  ('FIN', 'Finans ve Muhasebe', null, false),
  ('HUK', 'Hukuk ve Uyum', null, false),
  ('IK', 'İnsan Kaynakları', null, false),
  ('BT', 'Bilgi Teknolojileri ve Güvenlik', null, false),
  ('PAZ', 'Pazarlama', null, false),
  ('TAS', 'Tasarım ve Kreatif Stüdyo', null, true),
  ('SOS', 'Sosyal Medya', null, true),
  ('KIL', 'Kurumsal İletişim', null, false),
  ('SAI', 'Satın Alma ve İdari İşler', null, false),
  ('VER', 'Veri ve Raporlama', null, false),
  ('YAZ', 'Yazılım Geliştirme', null, false),
  ('ALT', 'Altyapı ve Bulut Operasyonları', null, false),
  ('DON', 'Donanım ve Gömülü Sistemler', null, false),
  ('TED', 'Tedarik Zinciri ve Lojistik', null, false),
  ('A-SAT', 'Satış ve İş Geliştirme', 'armadx', false),
  ('A-KES', 'Keşif ve Dönüşüm Danışmanlığı', 'armadx', true),
  ('A-TEK', 'Çözüm ve Teklif', 'armadx', true),
  ('A-IHA', 'Kamu İhaleleri', 'armadx', false),
  ('A-PRJ', 'Proje Teslimat', 'armadx', true),
  ('A-AI', 'AI Çözümleri', 'armadx', false),
  ('A-MUS', 'Müşteri Başarısı ve Destek', 'armadx', false),
  ('A-KAT', 'Ürün ve Çözüm Kataloğu', 'armadx', false),
  ('P-URN', 'Ürün Yönetimi', 'pillika', false),
  ('P-CPO', 'CPO İlişkileri ve Entegrasyon', 'pillika', false),
  ('P-IST', 'İstasyon Verisi ve Şarj Operasyonları', 'pillika', true),
  ('P-ARC', 'Araç Verisi, Görsel ve Rota', 'pillika', false),
  ('P-API', 'API Portalı', 'pillika', false),
  ('P-ADS', 'Pillika ADS', 'pillika', false),
  ('P-BAR', 'Pillika Barrier', 'pillika', false),
  ('P-DES', 'Kullanıcı Destek', 'pillika', false),
  ('P-ODE', 'Ödeme ve Mutabakat', 'pillika', false),
  ('P-HIZ', 'Araç Hizmetleri', 'pillika', false),
  ('P-BUY', 'Büyüme ve Pazar Geliştirme', 'pillika', false)
on conflict (code) do nothing;

-- Founder: a single user with several Google accounts (2 October, decision 15). Founder and able to
-- approve in all three companies. Created only when there are no users at all.
do $$
declare
  founder uuid;
begin
  if exists (select 1 from office.users) then
    raise notice 'User records exist; founder block skipped';
    return;
  end if;
  insert into office.users (name) values ('Ömer Kadıoğlu') returning id into founder;
  insert into office.user_emails (email, user_id) values
    ('omer@armadx.com', founder),
    ('omer.kadioglu@armadx.com', founder),
    ('omer@pillika.com', founder),
    ('omer.kadioglu@pillika.com', founder);
  insert into office.memberships (company_id, user_id, role, can_approve)
    select s.id, founder, 'founder', true
    from office.companies s
    where s.code in ('armadx', 'pillika', 'founder_space');
  if (select count(*) from office.memberships where user_id = founder) <> 3 then
    raise exception 'The founder could not be made a member of all three companies';
  end if;
end
$$;
