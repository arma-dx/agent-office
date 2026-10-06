# Kalan işler: Sprint 0, 1 ve 2

Tarih: 2 Ekim 2026. Kaynak: `docs/agent-office-tasarım-raporu.md`, `docs/PLAN.md`, `docs/kararlar/`, `docs/SONRA.md` ve deponun bugünkü durumu. Tasarım raporundan gelen ve PLAN'da ayrı madde olarak geçmeyen işler **(Rapor)** diye işaretlendi. Bu liste PLAN'daki sprint maddelerini yapılacak tek tek işlere böler; PLAN'ın yerine geçmez.

İşaretler:

- **(Senden)**: kurucunun yapması ya da vermesi gereken şey.
- **(Karar: kod)**: `docs/SONRA.md` içinde aynı kodla duran açık soru; karar verilmeden o iş tamamlanamaz.
- **(Rapor)**: tasarım raporunun istediği, PLAN'ın sprint maddelerinde açıkça yazmayan iş.

## Bugünkü durum

Tamamlananlar:

- [x] Depo, dal ve PR düzeni; üç PR birleşti
- [x] İki dal düzeni: `development` (geliştirme, test ortamı) ve `main` (canlı); eski dallar silindi, Dependabot kaldırıldı (kendi dallarını açıyordu)
- [x] Monorepo iskeleti: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/db`
- [x] Otomatik kontroller: biçim, lint, tip, test, panel derlemesi, gizli anahtar taraması
- [x] Panel kodunun sunucu koduna ve anahtarlara erişememesi (kural 1 koruması)
- [x] Loglarda gizli bilgilerin maskelenmesi
- [x] Tasarım raporu, kararlar ve kartların birbirine uyumu
- [x] Arayüz temeli (0.1, geçici arayüz): yönlendirici, API istemcisi, tema, ana yerleşim, ortak bileşenler, boş ekranlar

Henüz olmayanlar: veritabanı (göç dosyası yok), giriş, işlevli ekran (yalnızca boş ekranlar var), hiçbir ajan, hiçbir skill, test ve canlı ortam.

5 Ekim 2026: karar 5-9 arayüz işlerini değiştirdi (`docs/kararlar/2026-10-05.md`); karar 10 ve 11 de işlendi, ikisi kurucu onayı bekliyor. Arayüz kabuğu işi eklendi (0.3a; planı kurucu onayladı, karar 12), telefon maddeleri kaldırıldı, Ofis görünümü işi 0.3b olarak eklendi (karar 14: kabuktan hemen sonra, Görevler'den önce). Ofis görünümünden sonra işler bu dosyadaki sırayla sürer (karar 15).

6 Ekim 2026: yeni kabuk kuruldu (0.3a); sıradaki iş Ofis görünümü (0.3b).

## Sprint 0

### 0.1 Arayüz temeli

Giriş ekranından önce. Arayüz geçici (2 Ekim); ileride baştan ele alınacak.

- [x] TanStack Router kurulumu ve sayfa yapısı
- [x] TanStack Query kurulumu ve API istemcisi (bütün istekler `/api` üzerinden)
- [x] Tailwind 4 kurulumu
- [x] shadcn/ui kurulumu; varsayılan temanın kaldırılması
- [x] CLAUDE.md'deki renk değişkenlerinin shadcn değişken adlarına eşlenmesi
- [x] Vurgu renginin kontrast düzeltmesi: `#127A77` (geçici arayüz, 2 Ekim)
- [x] Form alanları için ayrı kenarlık rengi: `#858E9E`
- [x] Karanlık tema renk değerleri (geçici; sistem tercihini izler)
- [x] IBM Plex Sans yazı tipinin kendi sunucumuzdan verilmesi; tablolarda eşit genişlikli rakamlar
- [x] react-hook-form ve zod ile ortak form düzeni
- [x] Ana yerleşim: üst çubuk, şirket seçici (geçici örnek liste), içerik alanı
- [x] Telefonda alt menü: Bugün, Onaylar, Görevler, Notlar, Ofis (Ofis, Kasım'a kadar Ajanlar ekranını açar) (5 Ekim karar 8 ile kalktı; 0.3a'da kaldırıldı)
- [x] Ortak bileşenler: düğme, form alanı, tablo, liste satırı, boş ekran, hata mesajı, yükleniyor durumu
- [x] Klavye odağının görünür olması; azaltılmış hareket tercihine uyum
- [x] Elle yazılmış PWA manifesti ve uygulama simgeleri (geçici simge) (telefon uyumu 5 Ekim karar 8 ile kalktı; manifestin akıbeti Karar: U18)
- [x] Hata sınırı ve "sayfa bulunamadı" ekranı

### 0.2 Veri modeli ve şirket ayrımı

Sürüyor. Göçler `supabase/migrations`, testler `packages/db/test` (kısıtlı rolle; yeni tablo şirket ayrımı testine kendiliğinden girer).

Altyapı:

- [ ] Supabase hesabı ve iki proje: test ve canlı (test projesi açıldı; canlı için Pro plan kararı bekleniyor; adımlar `docs/supabase-kurulum.md`)
- [x] Veri bölgesinin seçimi: AB, Frankfurt (2 Ekim, karar 14)
- [x] Yerel veritabanı: `supabase start` ve `supabase db reset` çalışır durumda (göçler ve testler yerel Supabase'de, süper kullanıcı olmayan `postgres` rolüyle geçiyor)
- [x] Yetkili göç rolü ile kısıtlı uygulama rolünün ayrılması; uygulama rolünde `BYPASSRLS` yok
- [x] `packages/db` içinde bağlam kuran yardımcı: `app.company_id`, `app.user_id`, `app.project_id`, `app.email`, `app.agent_code`
- [x] API isteği başına tek transaction; ajan çalışmasında adım başına kısa transaction (`withContext`, `agentStep`; API 0.3'te bağlandı, oturum doğrulama ve bağlam aynı transaction'da)
- [x] pg-boss kurulumu, ayrı şemada; işlere yalnızca kimlik konması
- [x] Veritabanı ve kod adlarının İngilizceye geçirilmesi (3 Ekim, karar 4; `docs/ad-sozlugu.md`)
- [x] Test projesinin sıfırlanıp İngilizce göçlerle yeniden kurulması ve eski `ofis_*` rollerinin silinmesi (3 Ekim, kurucunun onayıyla; 11 göç ve başlangıç verisi, denetimde hata yok)

Tablolar:

- [x] `companies`: `kind` (`company`, `private_space`) ve kısa kod (Karar: M8, teknik)
- [x] `users`
- [x] `user_emails`: bir kişinin birden çok Google hesabı (2 Ekim, karar 15)
- [x] `memberships`: kullanıcı, şirket, rol
- [x] `agent_definitions` ve `card_versions` (global, salt okunur)
- [x] `company_agents`: durum, ayarlar (Drive klasörleri, öncelikli göndericiler, Figma dosyası, bütçe)
- [x] `customers`: AI izni ve kodla otomatik işleme izni alanlarıyla
- [x] `opportunities`
- [x] `projects`: müşteri, bütçe, kilometre taşları, AI izni
- [x] `project_members`
- [x] `tasks` ve görev yorumları
- [x] `runs` ve araç çağrıları
- [x] `approvals`
- [x] `audit_log`: güncelleme ve silmeyi veritabanı düzeyinde engelleyen kural
- [x] `notes`, `note_versions`, `note_links`
- [x] `documents`
- [x] `station_candidates`
- [x] `integrations`: şifreli token alanı
- [x] Bildirim kaydı tablosu (Karar: M46) (kimin hatırlatacağı M46'da açık; tablo yalnızca kaydı tutar)
- [x] (Rapor) Şirket adlarının koda gömülmemesi: yeni bir şirket kod değişmeden, kayıt ve ayarla açılabilmeli (Ürünleşme ön koşulu)
- [x] (Rapor) Kartların şirketten ve modelden bağımsız yazıldığının denetimi (3 Ekim, karar 5; açık sorular `docs/SONRA.md`, Kart denetimi)

Ölçüt verisi (Rapor: ölçüm ilk günden başlar; pano Sprint 4'te gelse de veri pilot açılışından itibaren kaydedilmeli):

- [x] Tamamlanan iş: görevin birimi, şirketi ve tamamlanma zamanı
- [x] İlk seferde onay oranı: onayın düzeltmesiz verilip verilmediği, ajan başına
- [x] Onay bekleme süresi: onaya düşme ve karar zamanları
- [x] Düzeltme nedenleri: ret ve düzeltme gerekçelerinin sınıfı
- [x] Kazanılan insan saati: işin eski süresi ile yeni süresi
- [x] Yanıt ve teslim süresi: talep ve sonuç zamanları
- [x] İş başına maliyet: model, araç ve altyapı; iç iş ve proje ayrı
- [x] Kritik hata sayısı: işaretlenen olaylar
- [x] Kullanım oranı: kullanıcının haftalık etkinliği
- [x] Yönlendirme doğruluğu: KOR-1'in ilk seferde doğru birime verdiği taleplerin payı
- [x] Kaçan son tarih sayısı

Karar bekleyen alan ve tablolar (2 Ekim kararlarıyla kapandı, `docs/kararlar/2026-10-02.md` 6-13):

- [x] Birimler: tablo mu, kartlardan türetme mi; `tasks` tablosunda birim alanı (Karar: M39)
- [x] Üst görev alanı (`parent_task_id`, teknik)
- [ ] Alt görevin sonuçlanma kuralı (Karar: M31; açık)
- [x] Notlarda tek doğru kaynak işareti ve not durumu (Karar: M4)
- [x] Notlarda ve görevlerde kaynak türü: iç, dış (Karar: M14, X1-1)
- [x] Üretilen dosyalar için tablo (Karar: M38)
- [x] Onay kaydının ek alanları: öncelik, kaynaklar, iki ayrı gerekçe, ret nedeni, seçilen seçenek, dayandığı sürüm, önceki onay, gönderildi işareti (Karar: M25, M24, X1-7, M23, M22)
- [x] Görev durumlarına `awaiting_reply` eklenmesi (Karar: X1-6)
- [x] Kritik hata kaydı (Karar: R10)
- [x] Çalışma kaydında ham içeriğin saklama süresi (Karar: M12)

Güvenlik politikaları (RLS):

- [x] Şirket ayrımı: bağlamdaki şirketin dışındaki satır görünmez
- [x] Bağlam yokken hiçbir satır dönmez
- [x] Proje kapsamı: `project_id` doluysa yalnızca proje üyeleri ve kurucu
- [x] Ajan çalışması daraltması: proje bağlamı yoksa proje satırı yok; varsa yalnızca kendi projesi
- [x] AI izni olmayan müşteriye ve projeye bağlı kayıtların ajan bağlamına kapalı olması
- [x] Kullanıcının yalnızca kendi kaydını, üyeliklerini ve şirketlerini görmesi
- [x] Dış kişinin yalnızca kendisine açılan görev ve notları görmesi
- [x] Kurucu özel alanına yalnızca kurucunun erişmesi
- [x] Global tabloların uygulama rolü için salt okunur olması

Başlangıç verisi:

- [x] Arma DX, Pillika ve Kurucu alanı kayıtları (`supabase/seed.sql`; birimler `agents/units.yaml`)
- [x] Kurucunun kullanıcı ve üyelik kayıtları (`supabase/seed.sql`; dört adres, 2 Ekim karar 15)

Testler (kısıtlı rolle):

- [x] Bağlam Pillika iken Arma DX satırı okunamaz
- [x] Bağlam yokken hiçbir satır okunamaz
- [x] Proje kapsamlı satır proje dışından okunamaz
- [x] Proje bağlamı olmayan ajan çalışması proje satırı okuyamaz, kimliği kurucu olsa bile
- [x] Kullanıcı başkasının üyeliğini göremez
- [x] AI izni olmayan müşterinin kaydı ajan bağlamında okunamaz
- [x] `audit_log` satırı değiştirilemez ve silinemez
- [x] Her yeni tablo için şirket ayrımı testi

### 0.3 Google ile giriş (M1)

Google tarafı:

- [x] Google Cloud projesi (5 Ekim: `arma-dx-agent-office` ve `arma-dx-agent-office-test`)
- [x] Giriş istemcisi: kullanıcı türü External; kapsamlar `openid`, `email`, `profile`
- [x] İzin ekranının ayarlanması (şimdilik Testing durumunda; pilot öncesi yayın ve doğrulama `docs/google-kurulum.md` 3. bölüm)
- [x] Yönlendirme adresleri: yerel, test ve canlı

Sunucu tarafı:

- [x] Giriş akışının API'de yürümesi (tarayıcıda değil); durum değeri ve tek kullanımlık değer denetimi (gerçek Google istemcisiyle deneme kurulumdan sonra)
- [x] Kimlik belirtecinin doğrulanması
- [x] Yalnızca geçerli daveti ya da üyeliği olan, Google'ın doğruladığı adresin kabulü; diğerlerinin anlaşılır ve genel bir mesajla reddi
- [ ] `amr` alanının denenmesi: kuruluş hesabında ve dış kişinin kişisel hesabında
- [x] İki adımlı doğrulamanın girişte kodla denetlenmesi; alan gelmezse izlenecek yol (Karar: G1) (3 Ekim karar 8; `amr` gerçek hesaplarla denenince gözden geçirilecek)
- [x] Oturum çerezi: `office.armadx.com` üzerinde, yalnızca sunucunun okuyabildiği, güvenli
- [x] Oturum süresi ve hareketsizlik süresi (Karar: R7) (30 dakika, 10 saat)
- [x] Çıkış ve bütün oturumları kapatma
- [x] İstek sahteciliğine karşı koruma
- [x] Giriş denemelerinde hız sınırı
- [x] Giriş, çıkış ve reddedilen denemelerin kaydı: şirketten bağımsız `login_events` tablosunda, e-posta ve IP olmadan (3 Ekim, karar 10)

Roller ve şirket:

- [x] Girişten sonra şirket seçimi; tek üyeliği olanın doğrudan geçmesi
- [ ] Kenar çubuğunun başında şirket menüsü; kurucu için holding görünümü ve Kurucu özel alanı (şirket seçici ve Kurucu alanı hazır; menü 0.3a'da kenar çubuğuna taşınır; holding görünümü kalıyor)
- [x] Şirket seçicideki geçici örnek listenin (`apps/web/src/placeholder-data.ts`) kaldırılması; liste kullanıcının üyeliklerinden gelir
- [x] Her API ucunda rol denetimi: `founder`, `employee`, `external` (bugünkü uçlarda; yeni uçlar aynı yardımcıyı kullanır)
- [ ] Holding görünümü için API'de salt okunur birleştirme

Passkey:

- [x] Passkey kaydı (telefonun parmak izi ya da yüz tanıması) (Ayarlar, Güvenlik; ilk passkey Google girişinden sonraki 10 dakika içinde)
- [ ] Önemli onaylarda yeniden doğrulama; hangi onayların önemli sayılacağı (Karar: R7) (3 Ekim karar 7; veritabanı ve API hazır, üye ve davet işlemlerinde çalışıyor; onay kararı ekranı Onay Masası ile bağlanacak)
- [x] Passkey yoksa izlenecek yol (passkey'i olmayan önemli işlemi yapamaz ve Güvenlik sayfasına yönlendirilir; kaybolan passkey'i kurucu Ayarlar, Kullanıcılar'dan sıfırlar, kurucununkini veritabanı yöneticisi sıfırlar: 5 Ekim karar 3, `docs/supabase-kurulum.md` 7. bölüm)
- [x] Dışarı giden işlerin onayında passkey: onayı açan işin dışarı gidip gitmeyeceğini belirtir (5 Ekim karar 2; veritabanında, onay ekranı Onay Masası ile bağlanacak)
- [ ] Dış kişiye görev ya da not açmada passkey (5 Ekim karar 4; veritabanı ve doğrulama amacı hazır, düğmesi görev ve not paylaşımı yapılırken gelir)

Ekranlar:

- [x] Giriş ekranı
- [x] Ayarlar, Kullanıcılar: davet etme, rol verme, üyeliği kaldırma (passkey adımı passkey işiyle eklenecek)
- [ ] Ayarlar, Şirketler

Testler:

- [x] Davetsiz e-posta giremez
- [x] Çalışan öteki şirketi seçemez
- [x] Dış kişi yalnızca kendisine açılanı görür
- [x] Süresi dolan oturum reddedilir

### 0.3a Arayüz kabuğu: Paperclip yapısı

5 Ekim, karar 5, 6 ve 7; kabuk planını kurucu onayladı (karar 12). Durum dili ve liste satırı karar 11'in kapsamındadır (kurucu onayı bekliyor). Kabuk Görevler ekranından (0.4) önce kurulur; arka uçta değişiklik yok. Kaynak: `docs/paperclip-incelemesi.md` 13.2, 13.5, 13.7.

Hazırlık:

- [x] (Senden) Paperclip deposunun sabit commit'ten (`dd868ed`) yerelde okunması için indirme izni (5 Ekim, karar 13; depo dışında geçici klasöre indirildi)
- [x] `THIRD_PARTY_NOTICES.md` dosyası ve içinde Paperclip'in `LICENSE` metni, olduğu gibi
- [x] Taşınan her dosyanın başına kaynak yolu ve commit kimliği
- [x] Gereken yeni bağımlılıkların `pnpm-workspace.yaml` kataloğuna eklenmesi (yalnızca kabuğun ihtiyacı kadar) (yeni bağımlılık gerekmedi; katalog değişmedi)

Tasarım değişkenleri:

- [x] Karar 6'ya göre renk değerleri: içerik alanı beyaz, kenar çubuğu açık gri, nötr metin ve çizgi tonları, vurgu `#127A77`
- [x] Durum renkleri (her durumda üç ton: simge, rozet zemini, metin)
- [x] Karanlık tema (aynı yönle yeniden tanımlandı; 5 Ekim, karar 6'dan türetildi, kurucu onayı bekliyor)
- [x] Kontrast ölçümü; AA'yı tutmayan tonların koyulaştırılması (5 Ekim, karar 12) (eşikleri `apps/web/src/tokens.test.ts` denetler)
- [x] Kenar çubuğunda seçili ve üzerine gelinen satır tonu
- [x] `CLAUDE.md`'deki renk değerlerinin kesinleşen değerlerle güncellenmesi

Durum dili:

- [x] Görev, onay ve çalışma durumları için tek simge ve tek renk (çalışma durumlarının adları ve onay renkleri öneri; Karar: U22)
- [x] Durum rozeti ve durum simgesi bileşenleri (canlı gösterge hareketsiz yapıldı; hareketli olup olmayacağı Karar: U1)

Kabuk:

- [x] Kenar çubuğu: şirket menüsü; üst satırlar (Bugün, Onaylar); "İş" grubu (Görevler, Notlar); "Ofis" grubu (Ajanlar); hesap menüsü (Ayarlar, tema, çıkış). "Yeni talep" satırı talep formuyla (0.4), "Ofis görünümü" satırı o ekranla (0.3b) menüye girer
- [x] Üst çubuk ve konum bilgisi
- [x] Özellik paneli altyapısı
- [ ] Kenar çubuğunun daraltılması (yapılmadı; düğmeyle gizleme kurucunun yanıtını bekliyor, Karar: U21)
- [x] Menü simgeleri (simgeli yapıldı; Karar: U2)
- [x] Telefon alt menüsünün kaldırılması (5 Ekim, karar 8)
- [x] 1280 piksel ve üstü için tasarım (5 Ekim, karar 12); 1024 piksele kadar kullanılabilirlik (karar 8'den türetildi, kurucu onayı bekliyor)

Sayfa parçaları:

- [x] Yoğun liste satırı
- [x] Boş ekran
- [x] Sayfanın biçiminde yükleme iskeleti
- [x] Sekme çubuğu
- [x] Satır içi uyarı şeridi

Mevcut ekranların taşınması (işlevleri değişmez):

- [x] Giriş ve şirket seçimi: kabuk dışı, yalnızca renkler
- [x] Ayarlar, Kullanıcılar
- [x] Ayarlar, Güvenlik
- [x] Beş boş ekran: Bugün, Onaylar, Görevler, Notlar, Ajanlar

Testler:

- [x] Yerleşim ve gezinme
- [x] Klavye odağı
- [x] Kontrast denetimi
- [x] Mevcut ekran testlerinin yeni kabukta geçmesi

### 0.3b Ofis görünümü (M15)

5 Ekim, karar 9 ve 14: Ofis görünümü kabuktan (0.3a) hemen sonra, Görevler ekranından (0.4) önce yapılır; birimleri ve ajanları gösterir ve kenar çubuğunda "Ofis" grubunda durur (karar 12). İlk sürümde birimler ve ajanlar görünür; görev sayıları ve canlı durumlar (çalışıyor, onay bekliyor) ilgili işler bittikçe bağlanır. Örnek görsel: `docs/kararlar/ekler/2026-10-05-ofis-gorunumu-ornegi.webp`; görünüm bu örnekten yola çıkar ve Agent Office'in tasarım diline uyarlanır. Ayrıntılı plan işe başlanırken kurucuya sunulur; açık sorular Karar: U19.

Sunucu:

- [ ] Birimler ve ajanlar için okuma ucu (şirket bağlamıyla; `units`, `agent_definitions`, `company_agents`)
- [ ] Kart senkronizasyonunun öne alınması gerekip gerekmediği (1.2)

Arayüz:

- [ ] İzometrik iki boyutlu çizim: birimler oda, ajanlar masalarında
- [ ] Birim kartı: birim adı, ajan sayısı, görev sayıları (veri geldikçe; hangi birimlerin ve hangi sayıların gösterileceği Karar: U19)
- [ ] Ajan durumu: çalışıyor, onay bekliyor, boşta, hata (çalıştırıcı ve Onay Masası geldikçe bağlanır)
- [ ] Ortada Kurumsal Hafıza: not sayısı (örnek görselden; gösterilip gösterilmeyeceği Karar: U19; Not sistemi geldikçe)
- [ ] Yakınlaştırma, kaydırma ve sığdırma
- [ ] Ajana tıklayınca ajan sayfası
- [ ] Klavye ile erişim ve azaltılmış hareket tercihi
- [ ] Karanlık tema

Testler:

- [ ] Şirket ayrımı: öteki şirketin ajanı ve sayıları görünmez
- [ ] Yerleşim hesabı

### 0.4 Görev kaydı ve pano (M2)

Arayüz 0.3a'daki kabukta, Paperclip'in kalıplarıyla kurulur (5 Ekim, karar 7; `docs/paperclip-incelemesi.md` 13.3). Kapsam: 5 Ekim, karar 11; kurucu onayı bekliyor.

Sunucu:

- [ ] Görev oluşturma, listeleme, ayrıntı, güncelleme uçları
- [ ] Yorum ekleme ve listeleme
- [ ] Durum geçiş kuralları: insan hangi geçişi yapar, ajan hangisini (Karar: M16)
- [ ] Atama: insana ya da ajana; atama değişikliği kuralı (Karar: M17)
- [ ] Öncelik, son tarih, proje ve birim alanları
- [ ] Her değişikliğin `audit_log`'a yazılması
- [ ] Arka plandaki yenileme isteğinin oturumun hareketsizlik süresini uzatmaması (inceleme 13.4, öneri; kural 3)

Arayüz:

- [ ] Talep formu: metin, ek, şirket, son tarih; birimi kendin seçme seçeneği (Karar: X2-4)
- [ ] Talep formunda yarım kalan metnin saklanması (Karar: U13)
- [ ] Liste görünümü; şirket, birim, ajan ve durum filtresi
- [ ] Liste satırında durum simgesi ve sabit genişlikte zaman sütunu
- [ ] Listede gruplama
- [ ] Satır içinde durum ve atanan değiştirme (izin verilen geçişler Karar: M16; seçilebilecek ajanlar Karar: M29)
- [ ] Tarayıcıda saklanan görünüm (Karar: U13)
- [ ] Listelerin belirli aralıklarla yenilenmesi (5 Ekim, karar 11; kurucu onayı bekliyor)
- [ ] Pano görünümü: duruma göre sütunlar, sürükleyip bırakma
- [ ] Görev ayrıntısının temel hali, sohbet biçimli akış olarak: talep, durum, atanan, yorumlar, yazma kutusu, özellik paneli (5 Ekim, karar 11; kurucu onayı bekliyor)
- [ ] Boş ekran metinleri

Testler:

- [ ] Durum geçiş kuralları
- [ ] Görünürlük: proje kapsamı ve dış kişi
- [ ] Filtreler
- [ ] Arka plandaki yenileme isteği oturumun hareketsizlik süresini uzatmaz

### 0.5 Onay Masası (M3)

Arayüz Paperclip'in kalıplarıyla kurulur (5 Ekim, karar 7; `docs/paperclip-incelemesi.md` 13.3). Kapsam: 5 Ekim, karar 11; kurucu onayı bekliyor.

Sunucu:

- [ ] Onay kaydı oluşturma ve kuyruk listeleme uçları
- [ ] Karar uçları: onayla, düzeltme iste, reddet
- [ ] Düzeltme ve rette gerekçe zorunluluğu; neden listesi (Karar: M25)
- [ ] Yalnızca kurucunun karar verebilmesi
- [ ] Önemli onaylarda passkey doğrulaması
- [ ] Kararın bağlı görevin durumuna yansıması (Karar: M16)
- [ ] Onaylanan çağrının onaydan sonra uygulanması için altyapı (Karar: M5)
- [ ] Kodla hesaplanan risk işaretleri: dış alıcı, fiyat, tek doğru kaynak, dış kaynaklı içerik (Karar: M21)
- [ ] Dayandığı kayıt değişmişse onayın kapanması (Karar: X1-7)
- [ ] Her kararın `audit_log`'a yazılması: onaylayan ve zaman

Arayüz:

- [ ] Kuyruk: önceliğe göre sıralı
- [ ] Sabit liste sırası: kullanıcı listeyle çalışırken satırlar yer değiştirmez
- [ ] Onay kartı: özet, risk notu, değişiklik farkı, kaynaklar
- [ ] Onay kartında kodla hesaplanan risk işaretlerinin ve farkın ajanın metninden ayrı gösterilmesi (Karar: M21)
- [ ] Fark görünümü: metin ve alan bazında
- [ ] Onayla, Düzeltme iste, Reddet düğmeleri
- [ ] Satır içinden onay; ret ve düzeltmede gerekçe penceresi (Karar: U8, M21)
- [ ] Onaylanan işin kuyruktan kayarak çıkması
- [ ] Aynı onay kartının Görev ayrıntısında yazma kutusunun üstünde durması (5 Ekim, karar 10; kurucu onayı bekliyor)
- [ ] Karardan sonraki adım önerisi
- [ ] Bekleyen onayın arşivlenememesi ve ertelenememesi; onayın sunucu yanıt vermeden ekrana yansıtılmaması (inceleme 13.4, uygulama önerisi)
- [ ] Boş kuyruk ekranı
- [ ] Kenar çubuğundaki Onaylar satırında bekleyen onay sayısı (PLAN, Ekranlar)
- [ ] (Rapor) Toplu onay turu görünümü: paketlenen işleri sırayla, tek akışta onaylama
- [ ] (Rapor) Onaylayanın kaydının her işte görünmesi: "ajan yaptı" denip sahipsiz kalmaması için

Testler:

- [ ] Onay akışı: dışa etkili hiçbir iş onaysız çıkamaz
- [ ] Kurucu dışındaki rol karar veremez
- [ ] Gerekçesiz ret ve düzeltme reddedilir

### 0.6 Claude bağlantısı, çalışma kaydı ve maliyet (M4)

- [ ] Anthropic API anahtarı (Senden: hesap ve anahtar)
- [ ] Anahtarın kasada durması; yalnızca worker ortamında
- [ ] Claude istemcisi: model adı koda gömülmez, karttan okunur
- [ ] (Rapor) Model katmanının değiştirilebilir tasarlanması: sağlayıcıya özgü kodun tek yerde durması
- [ ] (Rapor) Rutin işte hızlı, zor işte güçlü model: kartlardaki model seçimlerinin gözden geçirilmesi
- [ ] (Senden) API hesabı ve harcama limiti; API faturası claude.ai aboneliğinden ayrı
- [ ] Tek bir deneme çağrısı ve yanıtın kaydı
- [ ] Çalışma kaydı: girdi, çıktı, model, kart sürümü, token, süre
- [ ] Maliyet hesabı: model fiyatlarının yapılandırmada tutulması
- [ ] İç iş ve proje etiketi; proje maliyetinin projeye yazılması
- [ ] İstem önbelleğinin açılması ve önbellek tokenlarının ayrı sayılması
- [ ] Hata, hız sınırı ve yeniden deneme davranışı
- [ ] `audit_log` yazma yardımcıları: kim, ne yaptı, hangi veriye baktı, ne zaman
- [ ] Çalışma kaydına ne kadar içerik yazılacağı (Karar: M12)
- [ ] Testler: maliyet hesabı, kayıt bütünlüğü

### 0.7 Test ve canlı ortam, yayın hattı

- [ ] AWS hesabı ve sunucu (Senden: hesap erişimi)
- [ ] Docker imajları: api ve worker (tek dosyada paketleme), panel dosyaları
- [ ] Docker Compose: Caddy, api, worker
- [ ] Caddy: HTTPS, `/` panel, `/api` sunucu
- [ ] Cloudflare DNS kayıtları: `office.armadx.com`, `office-test.armadx.com`, `hooks.armadx.com` (Senden: DNS erişimi)
- [ ] Cloudflare koruma ayarları
- [ ] Gizli anahtar kasası ve ortam değişkenleri; `.env.example` güncel
- [ ] Yayın hattı: `development` dalı test ortamına (office-test.armadx.com), `main` dalı canlı ortama (office.armadx.com)
- [ ] Göç dosyalarının yayında yetkili rolle çalışması
- [ ] Sağlık kontrolü ve yeniden başlatma
- [ ] Log toplama ve hata bildirimi
- [ ] Veritabanı yedeği ve bir kez geri yükleme denemesi
- [ ] Güvenlik başlıkları ve API hız sınırı
- [ ] Node 26 sürümüne geçiş (LTS olduğunda)

### 0.8 Kurucunun işleri

- [ ] (Senden) Pilot işlerin bugünkü sürelerinin ölçümü: teklif, proje raporu, sosyal medya gönderisi
- [ ] (Senden) Avukata KVKK ve yurt dışı aktarım sorusu
- [ ] (Senden) `docs/SONRA-yanit-taslagi.md` onayı; en az veri modeline dokunan maddeler
- [ ] (Senden) Hesap erişimleri: Supabase, AWS, Google Cloud, Cloudflare, Anthropic
- [ ] (Senden, Rapor) Kişisel veri envanteri: panelin hangi kişisel veriyi tuttuğu ve modele neyin gittiği (avukatla)
- [ ] (Senden, Rapor) Mevcut müşteri sözleşmelerinin AI kullanımı açısından gözden geçirilmesi; sözleşme şablonuna AI kullanım maddesi (avukatla)
- [ ] (Senden, Rapor) İz kaydının saklama süresi (avukatla)
- [ ] (Senden, Rapor) Kurumsal Hafıza için her şirketten bir bilgi sahibi (Karar: R15)

### 0.9 Kapı: Altyapı hazır

- [ ] Kiracı ayrımı veritabanında zorunlu
- [ ] Kimlik, yetki ve iz kaydı çalışıyor
- [ ] Bilgi tabanının ilk yüklemesi tamam (Sprint 1'de)
- [ ] Pilot işlerin bugünkü süreleri ölçüldü

## Sprint 1

### 1.1 Ajan çalıştırıcı (M5)

Kart ve skill yükleme:

- [ ] Görev kartı için şema ve doğrulama
- [ ] Katalogda olmayan aracı kullanan kartın reddi
- [ ] Kartın `companies` alanına göre açılabileceği şirketlerin sınırlanması
- [ ] Kart durumunun anlamı: taslak, deneme, etkin (Karar: M40)
- [ ] Skill klasörünün okunması: SKILL.md, şablonlar, örnekler
- [ ] YAML yorumlarındaki kuralların alanlara taşınması (Karar: M42)

İstemin kurulması:

- [ ] Talimat bölümü: kart ve skill
- [ ] İşaretli veri bölümü: dış içerik ve araç sonuçları (kural 7)
- [ ] Hangi notların talimat sayılacağı (Karar: M14)
- [ ] Hangi aracın dış içerik döndürdüğünün katalogda işaretlenmesi (Karar: M13)
- [ ] Tekrar eden bölümlerde istem önbelleği
- [ ] (Rapor) Kaynak gösterme kuralı: ajan bilgiyi kurumsal hafızadan kaynağıyla verir, bilmediğini uydurmaz; bütün ajanların isteminde ortak
- [ ] (Rapor) Ortak yazım ve marka dili kuralları: bütün skill'lerin başvurduğu tek dosya; farklı ajanların çıktıları birbiriyle tutarlı olmalı
- [ ] (Senden) Yazım kuralları, marka dili ve doküman şablonları
- [ ] (Rapor) Çıktı dili: Türkçe; İngilizce ve Arapça istenebilmesi (Karar: R13)

Araç döngüsü:

- [ ] Claude ile araç çağrısı döngüsü
- [ ] Araç sınıfları: okuma, iç yazma, dışa etkili
- [ ] Onay koşullarının makinenin okuyacağı biçimde yazılması (Karar: M5)
- [ ] Koşula takılan çağrının onay kaydına çevrilmesi ve onaydan sonra uygulanması
- [ ] Onay beklenirken çalışmanın durumu ve süre sınırı (Karar: M5, U7)
- [ ] Araç çağrısı sayısı ve süre sınırı; aşımda işin insana düşmesi
- [ ] Çalışma özeti satırı: yalnızca yapılan işi yazar (inceleme 13.3; 5 Ekim, karar 5)
- [ ] Modelin reddetmesi durumunda işin insana düşmesi (Karar: X2-5)
- [ ] (Rapor) Araçların dış sistem başına bağlayıcı modüllerinde toplanması; ajana yalnızca kartındaki bağlayıcıların açılması (Karar: R14)
- [ ] (Rapor) Dış içerik okuyan ajanların yazma yetkisinin dar tutulduğunun kart kart denetimi
- [ ] (Rapor) Gereksiz kişisel verinin modele gitmeden maskelenmesi (Karar: M37)

Bağlam ve görünürlük:

- [ ] Çalışmanın başında şirket, kullanıcı, proje ve ajan bağlamının kurulması
- [ ] Zamanlanmış ve olayla başlayan işte kullanıcının kim olacağı (Karar: M11)
- [ ] Proje başına ayrı çalışma: KOR-2, KOR-3, HAF-1, HAF-2
- [ ] Proje özetlerinin kodla birleştirilmesi; şirket başına tek özet
- [ ] AI izni denetimi: her çalışmanın başında (kural 12)
- [ ] Kodla çalışan sistem işlerinin ajan çalışmasından ayrılması; otomatik işleme izni denetimi

Yetki kapıları:

- [ ] Y1 kapısı: yalnızca taslaklara ve kendi görevinin durumuna yazma
- [ ] Y1 ajanın paylaşılan kayda yazmasının onaya düşmesi
- [ ] Görev açmanın öneri olarak gelmesi
- [ ] "İnsana sor" yolu: soru ve eskalasyonun sorumluya ya da talep sahibine gitmesi
- [ ] "İnsana sor" için soru kartı; seçenekli soru kaydı (Karar: X1-6, U9)
- [ ] Yanıt gelince ajanın yeniden başlaması (Karar: X1-6)
- [ ] Y2 ve Y3 kapıları (Karar: M19)
- [ ] Ajana bırakılmayan işler kuralı: katalogda işaret ve kodla denetim (kural 11; Karar: R9)

Tetikleyiciler ve kuyruk:

- [ ] Talep tetikleyicisi
- [ ] Zamanlanmış tetikleyici: saat dilimi, iş günü, tatil, kaçan çalışma (Karar: M28)
- [ ] Olay tetikleyicisi
- [ ] Devir tetikleyicisi ve ajanlar arası iş kuralı (Karar: M30)
- [ ] Kuyruk işleyicisi; aynı anda çalışan iş sayısı
- [ ] Toplu işlerin öğe başına bölünmesi (Karar: M44)

Dayanıklılık:

- [ ] Yeniden deneme ve aynı yazmanın iki kez yapılmaması (Karar: X1-5)
- [ ] Yarıda kalan çalışmanın işaretlenmesi
- [ ] Durdurma düğmesi: yeni iş almama ve süren çalışmanın kesilmesi
- [ ] Ajanı durdurma, çalışmayı kesme ve görevi iptal etme ayrımı (Karar: X1-5, U15)
- [ ] Çalışmalar arası sayaçlar: geri dönüş, hatırlatma, yanıtsız soru (Karar: M33)
- [ ] Bütçe uyarısı (Karar: X1-4)

Sprint 1 araçları:

- [ ] `search_tasks`, `read_task`
- [ ] `create_task`, `suggest_task`, `update_task`
- [ ] `list_agents`, `list_users`
- [ ] `send_notification`
- [ ] `submit_for_approval`, `read_approval_queue`, `write_approval_summary`
- [ ] `search_notes`, `read_note`, `write_note`, `update_note`, `link_notes`
- [ ] `list_drive`, `read_drive_file`, `import_document`

Testler:

- [ ] Yetki kapısı: Y1 ajanın iç yazması onaya düşer; "insana sor" onaya düşmez
- [ ] AI izni: izinsiz projede ve müşteride ajan çalışmaz
- [ ] Yasak işler: hiçbir ajan Y1'in üstüne çıkamaz
- [ ] İstem enjeksiyonu: belgeye gizlenmiş talimat uygulanmaz
- [ ] Ajanın öteki şirketin verisini görememesi
- [ ] Sınır aşımında işin insana düşmesi
- [ ] Durdurulan ajanın iş almaması

### 1.2 Görev kartı yönetimi (M6)

- [ ] Kart senkronizasyonu: depodaki YAML'ın git commit kimliğiyle `card_versions`'a yazılması
- [ ] Her çalışmanın hangi kart sürümüyle koştuğunu kaydetmesi
- [ ] `company_agents` satırlarının açılması ve ayar ekranı
- [ ] Ajanlar ekranı: birimlere göre ajanlar, durum, yetki seviyesi
- [ ] Şirket başına durdurma düğmesi ve "her yerde durdur"
- [ ] Görev kartı ekranı: kart ve skill salt okunur, sürüm geçmişi
- [ ] Ajan sayfasında ikinci kenar çubuğu; kart salt okunur (inceleme 13.3; 5 Ekim, karar 5)
- [ ] "Bu ajan neye erişebiliyor ve neden" görünümü (1.8'deki izin görünümüyle birlikte; inceleme 13.3; 5 Ekim, karar 5)
- [ ] Test setini çalıştırma ve sonuçların gösterilmesi
- [ ] Kart ya da skill değişen PR'da test setinin otomatik çalışması (Karar: M40, M43)

### 1.3 Not sistemi (M7)

Sunucu:

- [ ] Not oluşturma, okuma, güncelleme, arşivleme uçları
- [ ] Klasör yolu ve klasör ağacı
- [ ] YAML özelliklerin ayrıştırılması ve doğrulanması
- [ ] Not türleri ve zorunlu özellikler için tek şema (Karar: M35)
- [ ] `[[Not adı]]` bağlantılarının kaydederken `note_links`'e çıkarılması
- [ ] Geri bağlantılar; görülemeyen notun başlığının dönmemesi
- [ ] Sürüm geçmişi
- [ ] Taslak durumu: Y1 ajanın notu onaydan sonra paylaşılır
- [ ] Tek doğru kaynak işareti; yalnızca kurucu koyar (Karar: M4)
- [ ] Türkçe tam metin arama; etiket ve özellik filtresi
- [ ] Proje kapsamı ve görünürlük

Arayüz:

- [ ] Klasör ağacı
- [ ] Markdown editörü ve önizleme
- [ ] Markdown gösterimi (`[[Not adı]]` desteğiyle) ve özellik paneli (inceleme 13.3; 5 Ekim, karar 5)
- [ ] Ajandan, araçtan ve dış kaynaktan gelen içerikte resimlerin yüklenmemesi, yalnızca bağlantı olarak gösterilmesi (Karar: U20)
- [ ] `[[` yazınca not önerisi
- [ ] Geri bağlantılar paneli
- [ ] Etiketler ve arama
- [ ] Kaynak gösterme: notun hangi belgeden geldiği
- [ ] HAF-2'ye soru kutusu: proje sayfasında o projede, genel ekranda proje seçerek

Testler:

- [ ] Bağlantı çıkarma ve geri bağlantı
- [ ] Görünürlük: proje, şirket, dış kişi
- [ ] Arama sonuçlarının erişime göre süzülmesi

### 1.4 Drive bağlantısı (M12)

- [ ] Arma DX Workspace'inde bağlantı istemcisi: Internal, `drive.readonly`
- [ ] Pillika Workspace'inde ikinci bağlantı istemcisi (Karar: X2-1; Senden: yönetici yetkisi)
- [ ] Ayarlar, Entegrasyonlar: Drive'ı bağlama akışı
- [ ] Token'ın şifreli saklanması; yalnızca worker kullanır
- [ ] Klasör izin listesi ekranı; listenin kodla denetlenmesi
- [ ] Aynı klasörün iki şirkette olamaması (Karar: X2-3)
- [ ] Değişen belgelerin yoklamayla alınması (Karar: M26)
- [ ] `documents` kaydı ve kaynak notuna bağlanması
- [ ] Belge türleri: Google Dokümanlar, PDF, Word; markdown'a çevirme
- [ ] Hassas veri taraması: kimlik numarası, IBAN, kart numarası (Karar: M37)
- [ ] Kişisel veri içeren klasörlerin bağlanmaması (1 Ekim, karar 7)
- [ ] (Senden) İzin verilecek Drive klasörleri

### 1.5 Bilgi tabanının ilk yüklemesi

- [ ] (Senden) Şirket profilleri: Arma DX ve Pillika
- [ ] (Senden) Ürün ve hizmet bilgileri
- [ ] (Senden) Ücret kartı ve teklif kuralları
- [ ] (Senden) Şablonlar ve marka dili
- [ ] (Senden, Rapor) Fiyat listeleri ve şirket politikaları
- [ ] Not klasör düzeninin belirlenmesi
- [ ] Belgelerin içe aktarılması ve kontrolü
- [ ] Tek doğru kaynak notlarının işaretlenmesi
- [ ] İki şirketin notlarının ayrı durduğunun doğrulanması

### 1.6 Görev ayrıntısı ekranının tam hali

- [ ] Ajanın adımları ve araç çağrıları
- [ ] Sohbet biçimli akış: çalışma özeti satırı ve açılan adımlar (5 Ekim, karar 11; kurucu onayı bekliyor)
- [ ] Soru ve onay kartlarının yazma kutusunun üstünde durması (5 Ekim, karar 10; kurucu onayı bekliyor; soru kartı Karar: U9, X1-6)
- [ ] Çıktılar ve bağlı onaylar
- [ ] Çalışmanın maliyeti ve süresi
- [ ] İşi ajandan devralma düğmesi
- [ ] KOR-1'in yönlendirmesini düzeltme düğmesi; düzeltmenin kaydı

### 1.7 Beş ajan

Her ajan için ortak adımlar:

- [ ] Kartın açık kararlara göre son hali
- [ ] (Senden) Skill için gerçek dokümanlar
- [ ] Skill'in yazılması: SKILL.md, şablonlar
- [ ] Test seti: 10-20 örnek girdi ve kabul ölçütü
- [ ] Kart kuralları için testler: araç, yasak, eskalasyon (Karar: M43)
- [ ] İki şirkette `company_agents` satırı
- [ ] Deneme çalışmaları ve düzeltme
- [ ] Etkin duruma alma

KOR-1, Ofis Koordinatörü (M8):

- [ ] `routing` skill'i
- [ ] Talebin şirket, birim ve önceliğe göre sınıflandırılması
- [ ] Alt görevlere bölme ve atama
- [ ] İki şirketi kapsayan talepte öteki şirket için öneri bırakma
- [ ] Kimin hangi ajana iş verebileceği (Karar: M29)
- [ ] Alt görevler bitince sonucu birleştirme (Karar: M31)
- [ ] "Bu iş bana ait değil" dönüşlerinin işlenmesi
- [ ] Koordinatör kapalıyken birime doğrudan iş verme yolu
- [ ] (Rapor) Yönlendirme düzeltmelerinin ve kullanımın kaydı: "ilk seferde doğru birim" ve "kullanım oranı" ölçütleri için

KOR-2, Görev Takip:

- [ ] `task-tracking` skill'i
- [ ] Zamanlanmış çalışma; proje başına ayrı
- [ ] Geciken ve tıkanan işlerin kodla listelenmesi
- [ ] Kişiye özel hatırlatmalar
- [ ] Bekleyen onay hatırlatması (Karar: M46)
- [ ] Şirket başına günlük gecikme özeti
- [ ] Dış kişiye hatırlatma kuralı (Karar: M55, M3)
- [ ] Görevi kapatamama ve iptal edememe (kodla)
- [ ] (Rapor) İnsanlara ve ajanlara atanan bütün işlerin tek kayıtta tutulması
- [ ] (Rapor) Dış kişilere (mali müşavir, avukat) açılan işlerin görev kaydında izlenmesi
- [ ] (Rapor) Tamamlanan iş, kaçan son tarih ve teslim süresi verisinin üretilmesi

KOR-3, Onay Masası:

- [ ] `approval-summary` skill'i
- [ ] Yeni onayda tetiklenme; sıklık sınırı
- [ ] Özet, risk notu ve öncelik yazma
- [ ] Günlük onay turunun paketlenmesi; tur saatleri (Karar: R12)
- [ ] Kararı değiştirememe (kodla)
- [ ] (Rapor) Onay, ret ve düzeltme gerekçelerinin ajan iyileştirmesinde kullanılacak biçimde özetlenmesi

HAF-1, Bilgi Tabanı:

- [ ] `note-writing` ve `decision-note` skill'leri
- [ ] Yeni ya da değişen belgede içe aktarma
- [ ] Etiketleme ve bağlama
- [ ] Haftalık bakım: eskimiş, çelişen ve bağlantısız notlar
- [ ] Çelişkide karar vermeme, kurucuya iletme
- [ ] HAF-2'den gelen "bilgi eksik" devrinin işlenmesi (Karar: M30)
- [ ] Bir şirketin belgesini ötekinin notuna bağlamama (kodla)
- [ ] (Rapor) Tek doğru kaynak sayfalarının güncel tutulması: şirket profili, ürün bilgileri, fiyat listeleri, politikalar
- [ ] (Rapor) Kararların karar notu olarak ilgili proje ve müşteri notlarına bağlanması
- [ ] (Rapor) Eskimiş ve bağlantısız not sayısının kaydı (birim ölçütü)

HAF-2, Kurumsal Arama:

- [ ] `sourced-answer` skill'i
- [ ] Her iddianın yanında not bağlantısı
- [ ] Soranın erişimine göre süzme
- [ ] Proje seçimine göre arama
- [ ] Bilgi yoksa bunu söyleme ve eksiği HAF-1'e iletme
- [ ] Yanıtsız soru sayacı
- [ ] (Rapor) Kaynak gösterme oranının ve yanıtsız soruların kapanma süresinin kaydı (birim ölçütleri)
- [ ] (Rapor) Diğer ajanların sorularını da yanıtlaması

### 1.8 Denetim ve yetki takibi

Rapora göre Ofis Yönetimi ve Denetim birimi (kalite, maliyet, iyileştirme) pilotta yok; bu işler pilotta kurucuda kalır ve panelin bunu desteklemesi gerekir.

- [ ] (Rapor) Y2 ajanların işlerinin sonradan örneklenmesi için liste: son çalışmalar, çıktı ve kullanılan veri
- [ ] (Rapor) Bir işi "kritik hata" olarak işaretleme; gerekçe zorunlu (Karar: R10)
- [ ] (Rapor) Kritik hatada ajanın bir seviye düşmesi ve inceleme görevi açılması
- [ ] (Rapor) Ajan başına iş sayısı ve ilk seferde onay oranı: yükseltme kuralının verisi (50 iş, yüzde 95)
- [ ] (Rapor) Yükseltme önerisinin kurucuya gelmesi; karar kurucuda
- [ ] (Rapor) Ajan izinlerinin gözden geçirilmesi için görünüm: hangi ajan hangi araca ve hangi klasöre erişiyor
- [ ] (Rapor) Ajan bazında maliyet ve bütçe uyarısı görünümü
- [ ] Bütçe görünümünde uyarı ile durdurmanın ayrı gösterilmesi (inceleme 13.3; Karar: X1-4)
- [ ] (Senden, Rapor) Düzenli kalite örneklemesi: her hafta her ajandan birkaç işin elle kontrolü
- [ ] (Senden, Rapor) Ret ve düzeltme nedenlerinden görev kartı düzeltmeleri

### 1.9 Bildirimlerin geçici hali

- [ ] Bildirimlerin tabloya yazılması
- [ ] Panelde basit bildirim listesi
- [ ] Bildirim modülü gelene kadar e-posta ve telefon bildirimi yok (Karar: M46)

## Sprint 2

### 2.1 Müşteri ve fırsat listesi (M10)

- [ ] Müşteri listesi ve ayrıntı ekranı: kurum, kişiler
- [ ] Müşteri kaydında AI izni ve otomatik işleme izni
- [ ] AI izninin varsayılanı ve kimin işaretleyeceği (Karar: R8)
- [ ] Fırsatlar: aşama, değer, sonraki adım
- [ ] (Rapor) Teklif sonucu: verildi, kazanıldı, kaybedildi; teklif kazanma oranı buradan
- [ ] Projeler sekmesi: proje, bütçe, kilometre taşları (Karar: M48)
- [ ] Proje üyelerinin yönetimi
- [ ] Projeye Drive klasörü ve GitHub deposu bağlama (Karar: M10, M47)
- [ ] `read_customer` ve proje okuma araçları
- [ ] Testler: görünürlük ve AI izni

### 2.2 PDF ve şablonlar (M11)

- [ ] HTML şablondan PDF üretimi
- [ ] Teklif şablonu: iki şirketin marka öğeleriyle
- [ ] Rapor şablonu
- [ ] (Senden) Marka kitleri ve mevcut teklif örnekleri
- [ ] Şirkete özgü şablonların nerede tutulacağı (Karar: M15, M38)
- [ ] `generate_pdf` aracı
- [ ] Üretilen dosyanın kaydı ve erişimin kayıt üzerinden doğrulanması
- [ ] Panelde önizleme ve indirme

### 2.3 Teklif Ajanı (A-TEK-2)

- [ ] `proposal` skill'i: ücret kartı ve teklif kurallarından
- [ ] (Rapor) Fizibilite değerlendirmesi
- [ ] İş kırılımı
- [ ] Ücret kartına göre fiyat
- [ ] Zaman çizelgesi
- [ ] PDF teklif
- [ ] Fiyatın her zaman kurucu onayına düşmesi (kalıcı Y1)
- [ ] Müşteri projesine bağlı işte proje bağlamı
- [ ] Geçmiş tekliflerin örnek olarak kullanımı (Karar: M10, M15)
- [ ] Kapsam eksikse soru sorma
- [ ] (Rapor) Markalı teklif dokümanı: marka dili ve doküman şablonuna uyum
- [ ] (Rapor) Talepten teklife geçen sürenin kaydı (birim ölçütü)
- [ ] Test seti ve maliyet ölçümü

### 2.4 Proje Takip Ajanı (A-PRJ-2)

- [ ] GitHub bağlantısı: yalnızca seçili depoları okuyan uygulama (Karar: M47)
- [ ] `read_github` aracı
- [ ] Haftalık durum raporu; proje başına ayrı çalışma
- [ ] İç rapor: durum, tamamlananlar, gelecek hafta, riskler, bütçe
- [ ] (Rapor) Risk listesi
- [ ] (Rapor) Sözleşmedeki kilometre taşlarının proje kaydına girilmesi ve uyumun izlenmesi
- [ ] Müşteri raporunun onaya düşmesi
- [ ] Bütçe gerçekleşmesinin hangi veriden hesaplanacağı (Karar: M49)
- [ ] Durum kırmızıya dönünce uyarı
- [ ] Toplantı notları girdisi: KOR-5 gelene kadar (Karar: M45)
- [ ] Skill, test seti, deneme

### 2.5 Sosyal İçerik Yazım Ajanı (SOS-2)

- [ ] (Senden) Marka dili ve onaylı içerik örnekleri
- [ ] (Senden, Rapor) Sosyal medya işinin dış ajanstan devralınması: mevcut içerikler, takvim ve hesap bilgileri
- [ ] (Rapor) Şirket ve kanal ayrımı: Arma DX'te LinkedIn gibi kurumsal kanallar, Pillika'da sürücülerin olduğu kanallar
- [ ] Skill: gönderi metni, video senaryosu, kaydırmalı gönderi, etiket seti
- [ ] Yalnızca verilen kaynak bilgiye dayanma
- [ ] Kaynak bilginin nereden geleceği (Karar: M56)
- [ ] Seçenekli çıktı ve seçeneğin Onay Masası'nda seçilmesi (Karar: M24)
- [ ] Görsel için TAS-6'ya geçiş: TAS-6 gelene kadar kapalı (Karar: M45)
- [ ] İngilizce çıktı (Karar: R13)
- [ ] Test seti, deneme

### 2.6 Bildirimler (M9)

- [ ] Panel içi bildirimler
- [ ] Tarayıcı bildirimi: yalnızca bildirim işleyen küçük service worker (telefon bildirimi 5 Ekim karar 8 sonrası Karar: U17)
- [ ] Seyrek bildirim kuralı: kullanıcının kendi işi ve ekranda açık olan kayıt için bildirim çıkmaz (inceleme 13.3; 5 Ekim, karar 5)
- [ ] E-posta bildirimi: gönderim servisi ve alan adı kayıtları
- [ ] Bildirim içeriği: sabit şablon ve panel bağlantısı (Karar: M53)
- [ ] Günlük onay özeti
- [ ] 24 saat bekleyen onay uyarısı
- [ ] Aynı onay için tek hatırlatma (Karar: M46)
- [ ] Dış kişiye bildirim kuralı (Karar: M3, M55)
- [ ] Bildirim tercihleri

### 2.7 Ekranlar ve akışlar

- [ ] Bugün ekranı: "bana düşenler" listesi (bekleyen onaylar, yanıt bekleyen sorular, görev önerileri, sınıra takılan ya da başarısız çalışmalar, bildirimler), bugünkü görevler, ajanların son işleri, uyarılar (5 Ekim, karar 10; kurucu onayı bekliyor)
- [ ] Kenar çubuğundaki Bugün satırında bekleyenlerin sayısı (PLAN, Ekranlar; "bana düşenler" listesi 5 Ekim, karar 10; kurucu onayı bekliyor)
- [ ] İz kaydı ekranı ve filtreleri; cümle biçiminde satır, filtreler adres çubuğunda (inceleme 13.3; 5 Ekim, karar 5)
- [ ] "Düzeltme istendi" sonrası işin ajana geri dönmesi (Karar: M23)
- [ ] Onaylanan işin dışarı gönderildiğinin işaretlenmesi (Karar: M22)
- [ ] Taslak düğmelerinin onaya göre açılması (Karar: M1)

### 2.8 Pilot açılış kontrolleri

- [ ] İki şirketin verisi birbirine görünmüyor; testle doğrulandı
- [ ] API ve worker kısıtlı rolle bağlanıyor
- [ ] Dışarı giden her iş onaydan geçiyor
- [ ] Her ajan çalışmasının kaydı ve maliyeti panelde görünüyor
- [ ] Her ajanın durdurma düğmesi çalışıyor
- [ ] Gizli anahtarlar kasada; Supabase anahtarları tarayıcıya gitmiyor
- [ ] Yedek alınıyor ve geri yükleme denendi
- [ ] Her pilot ajanın görev kartı ve test seti hazır
- [ ] (Senden) KVKK ve yurt dışı aktarım avukatla gözden geçirildi
- [ ] Kişisel veri içeren hiçbir kaynak bağlı değil
- [ ] İstem enjeksiyonu testi geçti
- [ ] Maliyet testi geçti
- [ ] (Rapor) Olay müdahale kılavuzu: anahtar sızarsa ya da bir ajan yanlış iş yaparsa atılacak adımlar (durdur, anahtarı değiştir, iz kaydını incele)
- [ ] (Rapor) Dokuz ölçütün verisi kaydediliyor

### 2.9 Açılış

- [ ] (Senden) Ekip üyelerinin davet edilmesi ve rollerinin verilmesi
- [ ] (Senden) Ekibe kısa tanıtım: talep açma, onay, notlar
- [ ] (Senden, Rapor) Gönüllü öncü kullanıcıların belirlenmesi
- [ ] (Rapor) İlk işlerin zaman kazancının ekibe görünür kılınması
- [ ] Sekiz ajanın canlı ortamda etkinleştirilmesi
- [ ] İlk günlerde çalışma kayıtlarının ve maliyetin yakından izlenmesi
- [ ] Ölçütlerin kaydının başladığının doğrulanması
