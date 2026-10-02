-- Yerel geliştirme ve test ortamının başlangıç verisi (supabase db reset göçlerden sonra yükler).
-- Canlı ortama yüklenmez.

-- Şirketler kayıtla açılır, koda gömülmez (KALAN-ISLER 0.2, ürünleşme ön koşulu).
insert into ofis.sirketler (kod, ad, tur) values
  ('armadx', 'Arma DX', 'sirket'),
  ('pillika', 'Pillika', 'sirket'),
  ('kurucu_alani', 'Kurucu', 'ozel_alan');

-- Birimler: agents/birimler.yaml ile aynı liste. Kart senkronizasyonu (KALAN-ISLER 1.2) gelince
-- birimler oradan yazılır ve bu blok kaldırılır.
insert into ofis.birimler (kod, ad, sirket_kod, pilotta_acik) values
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
  ('P-BUY', 'Büyüme ve Pazar Geliştirme', 'pillika', false);

-- Kurucunun kullanıcı ve üyelik kayıtları, giriş e-postası belli olunca eklenir.
