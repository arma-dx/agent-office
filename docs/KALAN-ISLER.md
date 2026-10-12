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

6 Ekim 2026: yeni kabuk kuruldu (0.3a) ve Ofis görünümünün ilk sürümü yapıldı (0.3b); sıradaki iş Görev kaydı ve pano (0.4). Ofis görünümünde açık kalan maddeler, yanlarında yazan işleri bekliyor.

7 Ekim 2026: kurucu görev akışını düzeltti (`docs/kararlar/2026-10-07.md`, karar 1-12). 0.4 için hazırlanan elle iş takibi planı uygulanmaz. İki ayrı iş türü var: ajanların yürüttüğü **Talepler** ve insanların birbirine verdiği **Görevler**. Sıra değişti (karar 8): sıradaki iş talep akışının ince dilimidir (0.4); akışın ince bir hâli uçtan uca çalıştırılır ve ekranlar onunla birlikte kurulur. Eski 0.4'ün elle yürüyen kısmı Görevler'e (0.4b) taşındı.

8 Ekim 2026: kurucu dilimin altı sorusunu yanıtladı (`docs/kararlar/2026-10-08.md`, karar 1-6): ajanlar herkesin talebi için çalışır; birimde açık ajan yoksa talep nedeniyle talep sahibine geri çevrilir ve kapanır; talep sahibi sonucu kabul etmezse iş aynı ajana bir kez döner; iki onay ayrı alınır; talep metnine kişisel veri ve müşteri bilgisi yazılabilir; dilimden sonra önce talep akışının kalanı (0.4a), sonra Görevler (0.4b) yapılır.

8 Ekim 2026 (devam): talep akışının ince dilimi kuruldu (0.4) ve bağımsız incelemeden geçirildi; doğrulanan bulgular düzeltildi. Açık kalan iki madde API anahtarını bekliyor: anahtar ve gerçek modelle ilk deneme çağrısı. Sıradaki iş talep akışının kalanı (0.4a); ön planı kurucunun onayını bekliyor.

8 Ekim 2026 (öğleden sonra): kurucu 0.4a ön planının sorularını yanıtladı (`docs/kararlar/2026-10-08.md`, karar 7-13). 0.4a beş adıma bölündü; ilk adım Bugün listesi ve bildirimler. Projeler ayrı ve ayrıntılı bir bölüm olarak eklendi (0.4c; karar 11); kapsamı için ön plan hazırlanıyor. Talep formuna ek 0.4a'dan çıkarıldı (karar 12).

8 Ekim 2026 (devam): kurucu ilk gerçek talebi gönderdi; akış uçtan uca çalıştı. Koordinasyon merkezi koşullu bir cümleyi eksik bilgi sayıp yönlendirmedi; yönlendirme talimatı düzeltildi ve gerçek modelle sınandı. Kurucu Projeler ön planının dokuz sorusunu yanıtladı (karar 14-22); 0.4c yedi adıma bölündü.

8 Ekim 2026 (akşam): Bugün listesi ve bildirimler (0.4a adım 1) ile en küçük Projeler (0.4c adım 1) kuruldu. Kurucu, ajanların kod yazması (karar 23-30) ve haber toplama ajanı (karar 35-43) için ön planları yanıtladı. Kurucunun ikinci gerçek talebinde koordinasyon merkezi yine düz metinle durdu; artık her durumda aracıyla yanıt veriyor. Test projesine bütün göçler gönderildi. Sırada: ofiste canlı durumlar, son tarih ve yorum, talep formunda proje alanı.

8 Ekim 2026 (akşam): Projeler'in ilk adımı kuruldu (0.4c adım 1): menüde "Projeler", proje listesi, "Yeni proje" penceresi, proje sayfası, üyeler, yapay zekâ izni ve müşterinin sözleşme izinleri. Adım tasarlanırken türetilen seçimler `docs/SONRA.md` içinde P1-a ila P1-z olarak duruyor; hepsi kurucu onayı bekliyor. Dört yeni göç yerel veritabanına henüz uygulanmadı (son uygulanan `20261008101500`); uygulanana kadar yerelde Projeler ekranı sunucu hatası verir. Sıradaki adım talep formunda proje alanı (adım 2).

8 Ekim 2026 (gece): 0.4a adım 2 yapıldı: ofiste masalar Boşta, Çalışıyor, Onay bekliyor ve Hata durumlarını gösteriyor, seçili ajanın panelinde açık taleplerinin sayıları var, kurucu bir ajanı "Her yerde durdur" ile açık olduğu her şirkette durdurabiliyor. Adım tasarlanırken türetilen seçimler `docs/SONRA.md` içinde Z-a ila Z-s olarak duruyor; hepsi kurucu onayı bekliyor. Çizim tarayıcıda görülmeden yazıldı; kurucunun ofise bir kez bakması gerekir (Z-l). Sıradaki adım: son tarih ve yorum (adım 3).

9 Ekim 2026: 0.4a adım 3'ün son tarih ve yorum kısmı yapıldı: talep formunda isteğe bağlı son tarih var, talep sayfası ve Talepler listesi günü geçince "Son tarihi geçti" yazıyor; talep sayfasında "Yorumlar" bölümü var, yorumu talep sahibi, birimin onaylayıcısı ve kurucu yazıyor, ajanlar yorumu görmüyor. Adım tasarlanırken türetilen seçimler `docs/SONRA.md` içinde D-a ila D-k olarak duruyor; hepsi kurucu onayı bekliyor. Ekranlar tarayıcıda görülmeden yazıldı; kurucunun talep formuna ve talep sayfasına bir kez bakması gerekir (D-k). Yeni göç (`20261008102000_request_comments_for_people.sql`) yerel veritabanına uygulanana kadar yerelde talep sayfası sunucu hatası verir. Adımın proje alanı Projeler'i (0.4c adım 2) bekliyor.

11 Ekim 2026: Projeler'in ikinci adımı kuruldu (0.4c adım 2); 0.4a adım 3'ün proje alanı da bununla tamamlandı. Talep formunda isteğe bağlı proje alanı var; proje sayfasında "Talepler" ve "Ayarlar" sekmeleri var; proje içindeki talepte ajanlar o projenin içinde çalışıyor ve kural 12 kodla denetleniyor (8 Ekim, karar 45-49). İzin kapanınca süren çalışma durur, talep kurucunun "Sizden beklenenler" listesine düşer ve bekleyen sonuç onaylanamaz. İzin ya da ajan yeniden açılınca bekleyen talepler kendiliğinden başlar; onay penceresi kaç talebin başlayacağını önceden söyler. Talep sahibi talebini göremez olursa ajan kurucunun adına çalışır ve sonucu kurucu onaylar. Adım tasarlanırken ve yapılırken türetilen seçimler `docs/SONRA.md` içinde P2-a ila P2-af olarak duruyor; sonunda karar numarası yazmayanların hepsi kurucu onayı bekliyor. Ekranlar tarayıcıda görülmeden yazıldı; kurucunun talep formuna, bir proje sayfasına ve bir açma penceresine bir kez bakması gerekir (P2-ad). Beş yeni göç (`20261008102200` ila `20261008102600`) yerel veritabanına uygulanana ve ardından `pnpm db:sync-definitions` çalıştırılana kadar yerelde talep listeleri sunucu hatası verir, çalıştırıcı iş alamaz. Adım incelendi; bulunan sekiz eksik giderildi (izin kapatılıp hemen açılınca aynı işin iki kez yürümesi, ajan durdurulup hemen açılınca talebin bir kişide kalması, dört arayüz metni ve düzeni, iki belge cümlesi, eksik bir test; SONRA P2-ac ve P2-ad). Sıradaki adım proje sayfasının öteki bölümleri (adım 3).

12 Ekim 2026: Projeler'in üçüncü adımının ilk parçası kuruldu (0.4c adım 3): bütçe ve kilometre taşları. Proje sayfasında "Kilometre taşları" sekmesi var: ad, isteğe bağlı gün ve tamamlandı işareti; projenin her üyesi ve kurucu ekler, değiştirir ve siler. Bütçe özellikler panelinde bir satırdır ve kendi penceresi vardır: tutar ve para birimi (TL, dolar ya da avro); bütçeyi projenin sahibi, yöneticileri ve kurucu görür ve değiştirir (12 Ekim, karar 2), düz üyenin sayfasında bütçe hiç görünmez. Türetilen seçimler `docs/SONRA.md` içinde P3-a ila P3-f; P3-a ve P3-b karara bağlandı, ötekiler kurucu onayı bekliyor. Ekranlar tarayıcıda görülmeden yazıldı; kurucunun bir proje sayfasına bir kez bakması gerekir. Yeni göç (`20261008102700_project_budget_and_milestones.sql`) yerel veritabanına uygulanana kadar yerelde proje listesi ve proje sayfası sunucu hatası verir.

12 Ekim 2026 (devam): adım 3'ün ikinci parçası kuruldu: ajan çalışmaları ve maliyeti. Proje sayfasında "Çalışmalar" sekmesi var: projeyi görebilen herkes o projenin en yeni 200 ajan çalışmasını görür (talep, ajan, başlangıç, süre, sonuç); token sayılarını, çalışma başına maliyeti ve toplamı yalnızca kurucu görür. Listede ajanın yazdığı hiçbir metin yoktur; liste yarım dakikada bir kendiliğinden yenilenir. Türetilen seçimler `docs/SONRA.md` içinde P3-h ila P3-j; hepsi kurucu onayı bekliyor. Yeni göç (`20261008102800_project_runs_index.sql`) yalnızca bir dizin ekler.

12 Ekim 2026 (devam): adım 3'ün üçüncü parçası kuruldu: onaylar. Proje sayfasında "Onaylar" sekmesi var: o projenin taleplerinde birim onayına sunulan sonuçlar, "Karar bekleyenler" ve "Karar verilenler ve kapananlar" diye iki grupta listelenir. Satır talebin sayfasını açar; karar sekmede verilmez ve listede ajanın yazdığı hiçbir metin yoktur. Onay hakkı olmayan üye yalnızca onaylanmış sonuçları görür ve sekme bunu söyler. Türetilen seçimler `docs/SONRA.md` içinde P3-k ve P3-l; ikisi de kurucu onayı bekliyor. Bu parça için göç yok.

12 Ekim 2026 (devam): adım 3'ün son parçası kuruldu: projeye yapay zekâ harcama sınırı (8 Ekim karar 17). Sınırı yalnızca kurucu, proje sayfasının "Çalışmalar" sekmesinden belirler; orada harcananı, sınırı ve kalanı görür. Sınır dolar olarak yazılır ve projenin bütün ömrü için geçerlidir (12 Ekim, karar 1). Dolunca o projede yeni çalışma başlamaz, süren çalışma bir sonraki adımında biter, açık talepler "harcama sınırı doldu" diye kurucunun "Sizden beklenenler" listesine düşer ve o projede yeni talep açılamaz; onay bekleyen sonuç yine onaylanabilir ve reddedilebilir. İlk kez sınır koymak ve sınırı düşürmek passkey istemez; yükseltmek ve kaldırmak passkey ister ve sınırın beklettiği işleri kendiliğinden yeniden başlatır, pencere kaç talebin başlayacağını önceden söyler (11 Ekim, karar 1). Üyeler yalnızca sınırın dolduğunu öğrenir; hiçbir tutar görmez. Türetilen seçimler `docs/SONRA.md` içinde P3-m ila P3-ab; P3-o ve P3-s karara bağlandı, ötekiler kurucu onayı bekliyor. Adım 3'ün dört parçası böylece tamamlandı; projenin notları Notlar işini (1.3) bekliyor. Ekranlar tarayıcıda görülmeden yazıldı; kurucunun bir proje sayfasının beş sekmesine, bütçe penceresine ve sınır penceresine bir kez bakması gerekir (P3-ab). Dört yeni göç (`20261008102700` ila `20261008103000`) yerel veritabanına uygulanana kadar yerelde proje listesi, proje sayfası ve talep listeleri sunucu hatası verir. Sıradaki adım proje dosyaları (adım 4).

12 Ekim 2026 (devam): Projeler'in dördüncü adımı kuruldu (0.4c adım 4): proje dosyaları (8 Ekim, karar 11 ve 20). Proje sayfasında "Talepler"den hemen sonra "Dosyalar" sekmesi var: projenin üyeleri ve kurucu dosyaları görür, ekler ve indirir; dosyayı ekleyen kişi, projenin sahibi, yöneticileri ve kurucu siler (11 Ekim, karar 2). On iki uzantı eklenebilir (PDF, DOCX, XLSX, CSV, PPTX, PNG, JPG, JPEG, GIF, WEBP, TXT, MD), dosya başına 25 MB; tür dosyanın adına ve içeriğine birlikte bakılarak belirlenir. Dosya panelde gösterilmez, her zaman indirilir. Tarayıcı dosyayı API'ye gönderir ve API'den alır (kural 1): önce küçük bir istekle yükleme izni alınır, sonra dosya bu izinle gönderilir. Sunucuda beş uç ve dosya deposuna ulaşan tek modül var (`apps/api/src/files`); depo test ve canlı ortamda Supabase Storage, yerelde bir klasör (`FILE_STORAGE_DIR`), testlerde bellektir. Ekleme penceresi iki cümleyi söyler: avukatın görüşü gelene kadar kişisel veri içeren dosya eklenmez (karar 21); yapay zekâ izni açık projede ajanlar bu dosyaları okuyacak (11 Ekim, karar 3). Ajanların okuması kurulmadı (adım 6): bugün hiçbir ajan ve çalıştırıcı bir dosya kaydını göremez. Dosyalar şimdilik taranmadan eklenir; tarayıcı sunucu kurulunca kurulur (11 Ekim, karar 4; 0.7). Türetilen seçimler `docs/SONRA.md` içinde P4-a ila P4-w; P4-b, P4-m, P4-t ve P4-u karara bağlandı, ötekiler kurucu onayı bekliyor. Supabase'e giden üç çağrı gerçek hizmetle denenmedi; kova kurulunca `pnpm files:check` bir kez çalıştırılır. Ekranlar tarayıcıda görülmeden yazıldı; kurucunun "Dosyalar" sekmesine bir kez bakması gerekir (P4-i, P4-w). Yeni göç (`20261008103100_project_files.sql`) yerel veritabanına uygulanana kadar yerelde "Dosyalar" sekmesi sunucu hatası verir; yerelde dosya eklemek için `.env` dosyasında `FILE_STORAGE_DIR` bir klasörü göstermelidir (boşsa sekme deponun kurulu olmadığını yazar). Sıradaki adım GitHub bağlantısı (adım 5).

12 Ekim 2026 (devam): 0.4a adım 4 kuruldu: ajan, iş onsuz yapılamayacak bir bilgi eksikse talep sahibine sorar; talep "Yanıt bekliyor" olur, soru Bugün'de ve talep sayfasında görünür, yanıt gelince aynı ajan kendiliğinden yeniden çalışır. Soru Onaylar'a düşmez. Bir ajan bir talepte bir kez, koordinasyon merkezi şimdilik en çok iki kez sorar (12 Ekim, karar 3 ve 4). Adım tasarlanırken ve yapılırken türetilen seçimler `docs/SONRA.md` içinde S-a ila S-z olarak duruyor; "teknik not" yazanlar dışında hepsi kurucu onayı bekliyor. Ekranlar tarayıcıda görülmeden yazıldı; kurucunun bir soru kartına bir kez bakması gerekir (S-l, S-x). İki yeni göç yerel veritabanına uygulanana kadar (`supabase migration up`) yerelde talep listeleri sunucu hatası verir ve çalıştırıcı ajan işlerini başlatamaz. Ajanların soru sorması bir veritabanında `pnpm db:sync-definitions` çalıştırılınca açılır; bu komut gerçek modelle ölçüm (yaklaşık 30 talep metni) eşikleri tuttuktan sonra çalıştırılır, o zamana kadar ajanlar soru sormaz (S-u). Gerçek modelle denetim ve ölçüm henüz yapılmadı; kalan işler sırasıyla 0.4a adım 4'ün altında yazıyor. Sıradaki adım haber ajanı STR-6 (adım 5'in ilk parçası).

12 Ekim 2026 (ölçüm): 0.4a adım 4 gerçek modelle ölçüldü ve yerel veritabanında açıldı. İşi yapan ajan (SOS-2) eksik bilgide soruyor, bilgi tamken sormuyor; sorular kısa ve numaralı. Koordinasyon merkezinin soru sorması kapalı tutuluyor: talimatı iki kez daraltıldıktan sonra da birimi belli taleplerde sordu; açılıp açılmayacağı kurucuya soruldu (SONRA S-p). Ölçüm ayrıca kanal yazmayan başsağlığı, kınama ve kutlama taleplerinin ajanı olmayan Kurumsal İletişim'e gittiğini gösterdi; yönlendirme talimatı düzeltildi (SONRA S-aa, S-ab). Sıradaki iş haber ajanı (0.4a adım 5'in ilk parçası).

12 Ekim 2026 (devam): Projeler'in beşinci adımı kuruldu (0.4c adım 5): GitHub bağlantısı (8 Ekim, karar 19 ve 22; 12 Ekim, karar 12-17). Arma DX ve Pillika ayrı GitHub kuruluşları olarak, her biri kendi uygulamasıyla ve kendi anahtarıyla bağlanır; panel bir şirketin anahtarını öteki şirket için hiç kullanmaz. Hesap menüsünde kurucu için "Bağlantılar" sayfası var: sayfa o şirketin uygulamasının durumunu söyler (ayarlı değil, kurulmamış, bağlanamaz, kurulu, bağlı), kurucu passkey ile bağlar ve onayla bağlantıyı keser. Bağlı şirkette "Yeni proje" penceresinde isteğe bağlı "GitHub deposu" alanı çıkar; depoyu sonradan projenin sahibi, yöneticileri ve kurucu, proje sayfasının "GitHub" sekmesinden bağlar, değiştirir ve kaldırır. "GitHub" sekmesi ("Dosyalar"dan hemen sonra) projenin her üyesine bağlı deponun son 20 kod değişikliğini, açık değişiklik isteklerini ve açık iş kayıtlarını, yazanların GitHub kullanıcı adlarıyla gösterir; sayfa açıkken beş dakikada bir kendiliğinden yenilenir. Bağlantı yalnızca okur; GitHub'dan bildirim gelmez; tarayıcı GitHub'a hiç bağlanmaz, yalnızca kişinin tıkladığı bağlantı oraya gider. Hiçbir şey veritabanına, iz kaydına (yalnızca numaralar) ya da modele yazılmaz. Müşterisi yapay zekâya da kodla otomatik işlemeye de izin vermeyen projeye depo bağlanmaz ve sekmesi okumaz (kural 12). Hepsi sahte bir GitHub ile kuruldu ve sınandı: gerçek GitHub'la ilk deneme, kurucu iki uygulamayı oluşturup kurduktan sonra yapılır; adımları `docs/github-kurulum.md` içinde, sırası aşağıda 0.4c adım 5'te. Türetilen seçimler `docs/SONRA.md` içinde P5-a ila P5-ai; hepsi kurucu onayı bekliyor. Ekranlar tarayıcıda görülmeden yazıldı. İki yeni göç (`20261008103500`, `20261008103600`) yerel veritabanına uygulanana kadar (`supabase migration up`) yerelde proje listesi ve proje sayfası sunucu hatası verir. Sıradaki adım: ajanların proje dosyalarını okuması (0.4c adım 6).

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

- [ ] Supabase hesabı ve iki proje: test ve canlı (test projesi açıldı; 8 Ekim akşamı 48 göçün hepsi orada. Canlı proje ve Pro plan, proje sürüm 1'e geçtiğinde: 8 Ekim, karar 33; adımlar `docs/supabase-kurulum.md` içinde)
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
- [ ] Kenar çubuğunun başında şirket menüsü; kurucu için holding görünümü ve Kurucu özel alanı (şirket menüsü ve Kurucu alanı hazır; menü 0.3a'da kenar çubuğuna taşındı; holding görünümü kalıyor)
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
- [x] Kenar çubuğunun daraltılması: üst çubuktaki düğmeyle gizleme ve gösterme, seçim tarayıcıda hatırlanır; dar simge şeridi ve sürükleyerek boyutlandırma yok (6 Ekim, karar 1)
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

6 Ekim: plan kurucuya sunuldu ve altı soru yanıtlandı (`docs/kararlar/2026-10-06.md`, karar 3-8); ilk sürüm yapıldı. İlk sürüm birimleri, ajanları ve şirketin her ajan için düğmesini (Kapalı, Etkin, Durduruldu) gösterir; uydurma hiçbir sayı göstermez. İşaretlenmemiş maddelerin her biri yanında yazan işi bekliyor. Bu işten açık kalan sorular: `docs/SONRA.md`, U26-U37.

Sunucu:

- [x] Birimler ve ajanlar için okuma ucu (şirket bağlamıyla; `units`, `agent_definitions`, `company_agents`): `GET /api/office`. Kurucu ve çalışanlar görür, dış kişiler görmez (6 Ekim, karar 6)
- [x] Kart senkronizasyonunun öne alınması gerekip gerekmediği (1.2): küçük bir parçası öne alındı (6 Ekim, karar 8). `pnpm db:sync-definitions` kartlardan yalnızca birim ve ajan tanımlarını (`units`, `agent_definitions`) yazar; kart sürümü yazmaz, bu yüzden hiçbir ajan çalışamaz. Komut bugün yalnızca yerel veritabanına yazar; test ve canlı ortam için yayın hattının adımı olur (0.7). Kart senkronizasyonunun kalanı 1.2'de

Arayüz:

- [x] İzometrik iki boyutlu çizim: birimler oda, ajanlar masalarında
- [ ] Birim kartı: birim adı, ajan sayısı, görev sayıları (birim adı, kodu ve ajan sayısı yapıldı. Görev sayıları Görev kaydını (0.4) bekliyor ve kartta değil, seçili birimin özellik panelinde gösterilecek; hangi sayılar: Karar: U27, U28)
- [ ] Ajan durumu: çalışıyor, onay bekliyor, boşta, hata (ilk sürüm şirketin düğmesini gösterir: Kapalı, Etkin, Durduruldu; 6 Ekim, karar 5. Canlı durumlar çalışma kaydını (0.6), çalıştırıcıyı (1.1) ve Onay Masası'nı (0.5) bekliyor; nasıl türetileceği Karar: U26)
- [ ] Ortada Kurumsal Hafıza: not sayısı (Kurumsal Hafıza odası ortada duruyor; 6 Ekim, karar 4. Not sayısı Not sistemini (1.3) bekliyor)
- [x] Yakınlaştırma, kaydırma ve sığdırma (tekerlek, düğmeler ve tuşlarla yakınlaştırma; sürükleme ve ok tuşlarıyla kaydırma. Dokunmatik yüzeydeki davranış ve ekranda kaydırma düğmesi: Karar: U34)
- [ ] Ajana tıklayınca ajan sayfası (tıklanan ajan seçilir; adı, birimi ve durumu özellik panelinde görünür. Ajan sayfası 1.2 ile gelince panelden oraya bağlanır)
- [x] Klavye ile erişim ve azaltılmış hareket tercihi (ilk sürümde hiçbir şey kendiliğinden hareket etmez)
- [x] Karanlık tema (kabuğun karanlık değişkenleriyle; karanlık temanın kendisi kurucu onayı bekliyor: 5 Ekim, karar 6'dan türetildi)

Testler:

- [x] Şirket ayrımı: öteki şirketin ajanı ve sayıları görünmez (birimler, ajanlar ve ajan düğmeleri için yazıldı, Kurucu alanı dahil; sayılar bağlandıkça onların testi eklenir)
- [x] Yerleşim hesabı

### 0.4 Talep akışının ince dilimi (M2, M3, M4 ve M5'in ilk parçaları)

7 Ekim, karar 1-8 ve 10-12; 8 Ekim, karar 1-5. Bir kişi panelde talebini yazar; koordinasyon merkezi (KOR-1) bir birime ve o birimin ajanına yönlendirir; ajan (ilk denemede SOS-2, karar 11) Claude API ile bir kez çalışır ve sonucunu birimin onaylayıcısına sunar; onaydan sonra talep sahibinin onayı alınır; talep tamamlanır. Durumları veritabanı yazar, kimse elle değiştirmez. Arayüz 0.3a'daki kabukta, Paperclip'in kalıplarıyla kurulur (5 Ekim, karar 7). Açık sorular ve sormadan yapılan varsayımlar `docs/SONRA.md` içinde, "Görev akışı (7 Ekim)" başlığında.

Veri ve kurallar:

- [x] `tasks` tablosunda iki tür: `request` (talep) ve `task` (görev); talep açıldıktan sonra elle değişmez
- [x] Yönlendirme kaydı (birim, ajan, onaylayıcı, gerekçe); düzeltilebilir (PLAN M8)
- [x] Birim ve ajan onaylayıcısı tablosu; kimse atanmamışsa kurucu (karar 5)
- [x] Talep sahibinin onayı: ayrı kayıt, her işin sonunda (karar 6); onaylayıcı ile talep sahibi aynı kişi olsa da ayrı alınır (8 Ekim, karar 4)
- [x] Talep sahibi sonucu kabul etmezse işin aynı ajana bir kez dönmesi; ikincide kurucuya düşmesi (8 Ekim, karar 3)
- [x] Yönlendirilen birimde açık ajan yoksa talebin nedeniyle talep sahibine geri çevrilip kapanması (8 Ekim, karar 2)
- [x] Durumun kayıtları izlemesi: yönlendirme, çalışma, onay, talep sahibinin onayı, iptal ve durdurma
- [x] Talebin, yönlendirmenin ve onay kararlarının `audit_log`'a yazılması
- [x] Her yeni tablo ve yol için şirket ayrımı testi (kısıtlı rollerle)
- [x] Bir kişinin işlemlerinin (talep açma, onay, iptal, yönlendirmeyi düzeltme) yalnızca API rolüyle yapılabilmesi

Sunucu:

- [x] Talep açma, listeleme ve ayrıntı uçları; koordinatörün işinin aynı işlemde kuyruğa konması (yalnızca kimlikler, kural 10)
- [x] Onay kararı ucu (onayla, düzeltme iste, reddet); önemli onayda passkey
- [x] Talep sahibinin onayı ucu
- [x] Talebi iptal etme ve işi durdurma; yönlendirmeyi düzeltme (karar 7)
- [x] Ajanı şirket için açma ve durdurma (durdurma düğmesi)
- [x] Arka plandaki yenileme isteğinin oturumun hareketsizlik süresini uzatmaması (inceleme 13.4; kural 3)

Çalıştırıcı (1.1'in ilk parçası) ve Claude bağlantısı (0.6):

- [x] Kartların ve skill'lerin `card_versions` tablosuna, araç kataloğunun `tools` tablosuna senkronizasyonu
- [x] KOR-1 ve SOS-2 için ilk skill'ler (yalnızca yöntem; kurucunun belgeleri gelince genişler)
- [x] KOR-1 ve SOS-2'nin şirketteki herkesin talebi için çalışması (8 Ekim, karar 1)
- [x] Çalıştırıcı: bağlam, her adım kendi kısa işleminde, `runs` ve `audit_log` adım adım
- [x] İki araç: `route_task` (KOR-1) ve `submit_for_approval` (SOS-2); araç kapısı (Y1 kuralı)
- [x] İstem: talimat ve veri ayrı; talep metni işaretli veri bloğunda (kural 7)
- [x] Araç çağrısı ve süre sınırı; durdurma düğmesi; AI izni denetimi (kural 12)
- [x] Claude istemcisi tek dosyada; model adı ve fiyatı yapılandırmadan; maliyet kaydı
- [x] (Senden) Anthropic API anahtarı ve geliştirme için düşük harcama sınırı (karar 12; anahtar ve sınır 8 Ekim'de hazır)
- [x] Gerçek modelle tek deneme çağrısı (8 Ekim: kurucunun makinesinde `smoke:claude` iki modelle de geçti; maliyet hesabı fiyat tablosuyla tuttu)

Arayüz:

- [x] Kenar çubuğunda "Yeni talep" düğmesi ve "Talepler" satırı; "Görevler" ayrı satır (karar 9 ve 10)
- [x] Talep formu: tek alan, ne istendiği; kişisel veri ve müşteri bilgisi için uyarı yok (8 Ekim, karar 5)
- [x] Talepler listesi: aşama ve sıranın kimde olduğu
- [x] Talep sayfası: aşama, onay kartı, talep sahibinin onayı, sonuç, yolculuk
- [x] Onaylar ekranı ve kenar çubuğunda bekleyen sayısı
- [x] Ofis görünümünde ajanı açma ve durdurma
- [x] Listelerin ve talep sayfasının belirli aralıklarla yenilenmesi (5 Ekim, karar 11; kurucu onayı bekliyor)

Testler:

- [x] Akış uçtan uca: talep, yönlendirme, ajan, onay, talep sahibinin onayı, tamamlandı (sahte modelle)
- [x] Talebin ve onaylanmamış ajan metninin yetkisi olmayana görünmemesi
- [x] Talimat gibi yazılmış talep metninin kuralları ve araçları değiştirememesi

### 0.4a Talep akışının kalanı

Dilimde bilerek olmayanlar. Dilimden hemen sonra yapılır (8 Ekim, karar 6). Sıra ve içerik kurucunun 8 Ekim yanıtlarıyla belirlendi (karar 7-13); sormadan yapılan varsayımlar `docs/SONRA.md` içinde W-a ila W-m; adım 3'te türetilenler D-a ila D-k; adım 4'te türetilenler S-a ila S-z.

Adım 1: Bugün listesi ve bildirimler (karar 7 ve 8)

- [x] Bugün ekranında "Sizden beklenenler" listesi: birim onayı bekleyen sonuçlar, talep sahibinin onayını bekleyen sonuçlar, insana düşen talepler
- [x] Kenar çubuğunda Bugün satırında bekleyen iş sayısı
- [x] Bildirim: kişinin talebi kendisi bir şey yapmadan kapandığında (geri çevrildi, reddedildi, durduruldu); sabit cümleyle, yalnızca panelde
- [x] Listenin ve bildirimlerin yarım dakikada bir yenilenmesi (oturumun hareketsizlik süresini uzatmadan)
- [x] Passkey sıfırlama bildiriminin kişiye gösterilmesi (5 Ekim, karar 3)

Adım 2: Ofiste canlı durumlar ve "Her yerde durdur" (karar 9 ve 10)

- [x] Masada ajanın durumu: Boşta, Çalışıyor, Onay bekliyor, Hata
- [x] Ajan panelinde sayılar
- [x] "Her yerde durdur": ajan açık olduğu her şirkette durur; şirket şirket sonuç
- [x] Yeniden açılan ajanı bekleyen işler kendiliğinden başlar (8 Ekim karar 49; 0.4c adım 2 ile; SONRA Y-j, P2-v)

Adım 3: Son tarih ve yorum (karar 13); proje alanı Projeler ile (0.4c adım 2) yapıldı

- [x] Talep formunda son tarih (yalnızca bilgi)
- [x] Talebe yorum yazma: talep sahibi, birimin onaylayıcısı ve kurucu; ajan görmez
- [x] Talep formunda proje alanı; çalışmanın proje bağlamı; kural 12 denetiminin kodla yapılması (0.4c adım 2 ile)

Adım 4: Ajanın soru sorması (12 Ekim, karar 3 ve 4)

- [x] Ajanın talep sahibine soru sorması ve "Yanıt bekliyor" durumu (7 Ekim, karar 7): işi yapan ajan bir talepte bir kez sorar; koordinasyon merkezi şimdilik en çok iki kez (karar 4; sayı kurucu onayı bekliyor, SONRA S-a); koordinasyon merkezinin sorması 12 Ekim ölçümünden sonra kapalı tutuluyor (SONRA S-p)
- [x] Soru kartı ve yanıt: talep sayfasında; yalnızca talep sahibi yanıtlar, talebi göremiyorsa yerine kurucu
- [x] Yanıt gelince aynı ajanın kendiliğinden yeniden çalışması; soru ve yanıtın ajana veri olarak verilmesi
- [x] Bugün'de "Sizden beklenenler" listesinde yanıt bekleyen soru
- [x] Ajan durdurulmuşken, izin kapalıyken ya da harcama sınırı dolmuşken gelen yanıtın kaydedilmesi; engel kalkınca işin kendiliğinden başlaması

Kod yazıldı; ajanlar hiçbir veritabanında henüz soru sormuyor. Kalanlar yukarıdan aşağıya, bu sırayla yapılır. Sıra değişmez: ölçüm senkronizasyondan önce gelir, çünkü bir veritabanında soru sormayı açan şey senkronizasyondur (SONRA S-u).

- [x] Yerelde `supabase migration up`: iki yeni göç (`20261008103300_request_questions.sql`, `20261008103400_answer_calls_for_work.sql`). O zamana kadar yerelde talep listeleri sunucu hatası verir ve çalıştırıcı hiçbir ajan işini başlatamaz (12 Ekim: uygulandı)
- [x] (Senden) Ölçüm için `.env` dosyasında API anahtarı; ölçümün tahmini maliyeti iki üç dolar (12 Ekim: anahtar vardı; ölçümün tamamı yaklaşık 1,2 dolar tuttu)
- [x] Gerçek modelle ilk denetim: `pnpm --filter @agent-office/worker smoke:claude`. Koordinasyon merkezinin modeli iki araç arasında zorlanmayı kabul ediyor mu (çıktıda `forced choice among tools: ok`). Kabul etmezse koordinasyon merkezine soru aracı verilmez (tek satırlık değişiklik ve testi), SOS-2'ninki kalır, karar 4 yürürlüğe girmez ve kurucuya bildirilir (SONRA S-p) (12 Ekim: kabul ediyor)
- [x] Gerçek modelle ölçüm: `pnpm --filter @agent-office/worker probe:questions`, ardından karşılaştırma için `probe:questions --no-ask` (koordinasyon merkezi soru aracı olmadan). Yaklaşık 30 uydurma talep metniyle ajanların ne zaman sorduğu ve koordinasyon merkezinin nereye yönlendirdiği sayılır; sorulan her soru okunur. Eşik tutmazsa yalnızca talimat metinleri daraltılır: en çok iki tur, her tur ayrı commit, turlar arasında senkronizasyon yok. İki turdan sonra da tutmazsa kurucuya sayılarla bildirilir. Yanıttaki talimata uyan tek bir çalışma olursa adım yayına alınmaz. Son turun sayıları bu satıra yazılır **12 Ekim sonucu:** SOS-2 eşikleri tuttu (sorması gereken 9 çalışmanın 9'unda sordu, sormaması gereken 21 çalışmanın 1'inde sordu; sorular kısa ve numaralı, taslak ya da ad taşıyan yok). Koordinasyon merkezi iki turdan sonra da tutmadı (konusu yazmayan gönderi talebinde 5/5, "araştır, sonra yaz" talebinde 2/5 gereksiz soru); soru sorması kapalı tutuluyor (`COORDINATOR_ASKS`), karar 4 şu an yürürlükte değil ve kurucuya soruldu (SONRA S-p). Kapalıyken 36 çalışmanın 36'sı beklenen yere gitti. İlk turda kanal yazmayan kurumsal açıklama ve kutlama talepleri Kurumsal İletişim'e gidiyordu; yönlendirme talimatı düzeltildi (SONRA S-aa, S-ab)
- [x] Eşikler tutunca `pnpm db:sync-definitions`: ajanların soru sorması o veritabanında bu komutla açılır (12 Ekim: yerel veritabanında çalıştırıldı; SOS-2 soruyor, koordinasyon merkezinin sorması kapalı)
- [ ] (Senden) Panelde iki gerçek talep: sorulan, yanıtlanan ve sonucu sunulan bir soru; yönlendirme düzeltilince kapanan bir soru (giriş kurucunun hesabıyla yapıldığı için panelde denemeyi kurucu yapar)
- [ ] (Senden) Soru kartına tarayıcıda bir kez bakma: kartın sayfadaki yeri, cümleleri, Bugün satırı (SONRA S-l, S-x)
- [ ] (Senden) Koordinasyon merkezinin soru sorması açılsın mı (SONRA S-p); açılırsa kaç kez sorsun: bir mi, iki mi (SONRA S-a). Ölçümün sayılarına göre: koordinasyon merkezi sorması gereken yerde neredeyse hiç sormuyorsa ya da SOS-2 sormak yerine eksiği belirtip yazıyorsa soru sormak kolaylaştırılsın mı
- [ ] (Senden) Öteki S maddeleri, `docs/SONRA.md` gözden geçirilirken (8 Ekim, karar 34): önce S-b, S-d, S-e, S-i ve S-j; sonra S-o ile S-h, S-v ve S-w
- [x] `CLAUDE.md` içinde bu adımla eskiyen ya da eksik kalan cümlelerin güncellenmesi ("İnsana sor", araç kataloğu, talepte elle yapılabilenler, Y1 kapısı, komutlar) (12 Ekim)

Adım 5: Birden çok ajanın sırayla çalışması (ilk gerçek çalışmalardan sonra; soruları kurucuya o zaman sorulur)

- [ ] Birden çok ajanın sırayla çalışması (7 Ekim, karar 1)
- [x] Haber ve bilgi toplama ajanı için ön plan ve kart taslağı (8 Ekim, karar 35; `docs/taslaklar/haber-ajani-on-plan.md`, `docs/taslaklar/STR-6-kart-taslagi.yaml`)
- [ ] Haber ve Bilgi Toplama Ajanı STR-6 (8 Ekim, karar 36-42; bu adımla birlikte kurulur):
  - [ ] (Senden) İzinli kaynak listesi: haber ajansları ve resmî kurum siteleri (karar 38)
  - [ ] Strateji ve Yönetim biriminin pilotta açılması; `agents/STR-6.yaml` kartı ve `sourced-research` skill'i
  - [ ] Arama: model sağlayıcısının hazır arama aracı, yalnızca izinli kaynaklarla; arama sözcüğü, adres, başlık ve alıntının çalışma kaydına yazılması; arama ücretinin maliyete eklenmesi (karar 39)
  - [ ] Kaynakları gösteren onay kartı: her bilginin kaynağı, sayfanın tarihi, bakılan saat, bulunamayanlar; özetin önce birimin onaylayıcısına gelmesi (karar 40)
  - [ ] Kişi adının aratılmaması ve özete yazılmaması (karar 41); sayfadaki talimat gibi yazılmış metnin ajanı yönlendirememesi (kural 7), testleriyle

Bu işten çıkarılanlar:

- Talep formunda ek: ayrı bir iş olarak sonra yapılır (8 Ekim, karar 12; Karar: M13)
- Talep formunda yarım kalan metnin saklanması: ilk dilimde yapıldı (yalnızca sekmede durur; U13 ile birlikte kurucu onayı bekliyor)

### 0.4c Projeler

8 Ekim, karar 11 ve 14-22. Projeler "İş" grubunda ayrı bir bölümdür (karar 14). Çalışanlar da proje açar ve üye ekler; yapay zekâ iznini yalnızca kurucu, passkey ile açar (karar 15 ve 22). Türetilen yorumlar ve varsayımlar `docs/SONRA.md` içinde P-a ila P-u. Adım 1 tasarlanırken ve yapılırken türetilenler aynı dosyada P1-a ila P1-z. Projede sahip, yönetici ve üye ayrımı 8 Ekim karar 44 ile geldi; ondan türetilenler P1b-a ila P1b-m. Adım 2 (8 Ekim, karar 45-49) tasarlanırken ve yapılırken türetilenler P2-a ila P2-af. Adım 3 (karar 17; 11 Ekim karar 1; 12 Ekim karar 1 ve 2) tasarlanırken ve yapılırken türetilenler P3-a ila P3-ab. Adım 4 (karar 20 ve 21; 11 Ekim karar 2-4) tasarlanırken ve yapılırken türetilenler P4-a ila P4-w. Adım 5 (karar 19 ve 22; 12 Ekim karar 12-17) tasarlanırken ve yapılırken türetilenler P5-a ila P5-ai.

Adım 1: en küçük Projeler

- [x] Kenar çubuğunda "Projeler" satırı ve proje listesi (kurucu hepsini, çalışan üyesi olduğu projeleri görür; açık projeler üstte, kapalılar altta; dış kişiye ve Kurucu alanında sunulmaz, SONRA P1-i)
- [x] Yeni proje: ad, açıklama, müşteri (var olanı seçme ya da adıyla ekleme; karar 16), üyeler (ayrıca durum, renk, simge ve hedef tarih; kurucunun eklediği yeni müşteride sözleşme izinleri, yapay zekâ izni passkey ile; projenin kendi izni pencerede yok, SONRA P1-d)
- [x] Proje sayfası: ad, durum (beş durum), renk ve simge, hedef tarih, özellik paneli (karar 17) (açıklama ve "Projeyi düzenle" penceresi dahil; sekme yok, SONRA P1-u; panel 1280 pikselden itibaren kendiliğinden açık, SONRA P1-p)
- [x] Üye ekleme ve çıkarma (passkey istemez; çalışan kendini çıkaramaz, SONRA P1-g; dış kişi yapılan üyenin proje üyelikleri kalkar ve Kullanıcılar ekranı bunu söyler, SONRA P1-h)
- [x] Yapay zekâ izni: yalnızca kurucu, passkey ile; müşterinin sözleşme izinleri (izni kapatmak passkey istemez; müşterinin yapay zekâ iznini açmak passkey ister; SONRA P1-b, P1-c; izin açıkken projenin müşterisi değişmez, SONRA P1-t; passkey onayı kurucunun gördüğü müşteriye bağlı, SONRA P1-y)
- [x] Projeyi kapatma ve geri açma (durum alanıyla: Tamamlandı ve İptal kapatır; proje silinmez; kapalı projede yeni talep açılmaması adım 2'de, SONRA P1-j)
- [x] Şirket ayrımı ve görünürlük testleri (kısıtlı rollerle) (veritabanı, API ve panel testleri; iz kaydı olayları dahil, SONRA P1-n)
- [x] Dört yeni göçün (`20261008101600` ila `20261008101900`) yerel veritabanına ve test ortamına uygulanması (8 Ekim akşamı: yerelde uygulandı; test projesine 30 göç gönderildi, 48 göçün hepsi orada)
- [x] Projede sahip, yönetici ve üye ayrımı (8 Ekim karar 44): üyeyi yalnızca sahip, yöneticiler ve kurucu ekler ve çıkarır; yönetici yalnızca üyeleri çıkarır; sahip çıkarılamaz, sahiplik devredilir (türetilen okumalar SONRA P1b-a ila P1b-m, kurucu onayı bekliyor)
- [ ] Yeni göçün (`20261008102100_project_owner_and_managers.sql`) yerel veritabanına ve test ortamına uygulanması (uygulanana kadar proje listesi ve proje sayfası sunucu hatası verir)

Adım 2: talep formunda proje alanı

- [x] Talep formunda proje alanı; proje sayfasında o projenin talepleri (kapalı proje sunulmaz; ajanların çalışamadığı proje nedeniyle birlikte seçilemez görünür, SONRA P2-a; proje sayfasında Talepler ve Ayarlar sekmeleri, SONRA P2-j)
- [x] Çalışmanın proje bağlamı; kural 12 denetiminin kodla yapılması; izin kapanırsa talebin insana düşmesi (çalıştırıcı projeyi talepten okur; izin kapanınca süren çalışma durur, talep kurucuya düşer, bekleyen sonuç onaylanamaz, kararlar 46 ve 47; izin ya da ajan yeniden açılınca bekleyen işler kendiliğinden başlar, karar 49, SONRA P2-v ila P2-y; talep sahibi talebi göremez olursa ajan kurucunun adına çalışır, karar 45, SONRA P2-q ila P2-u)
- [ ] Beş yeni göçün (`20261008102200` ila `20261008102600`) yerel veritabanına ve test ortamına uygulanması; ardından yerelde `pnpm db:sync-definitions` (KOR-1 ve SOS-2 kartlarına `project_context` eklendi; çalıştırılmadan proje içindeki talep "ajan kartı çalışmaya açık değil" der)

Adım 3: proje sayfasının öteki bölümleri (karar 17; her biri ayrı küçük adım)

- [x] Bütçe ve kilometre taşları (bütçeyi sahip, yöneticiler ve kurucu görür ve değiştirir, 12 Ekim karar 2; para birimi her seferinde seçilir, SONRA P3-c; yapay zekâ maliyeti bütçeden düşülmez, SONRA P3-d; kilometre taşlarını her üye tutar, SONRA P3-e, P3-f)
- [x] Ajan çalışmaları ve maliyeti ("Çalışmalar" sekmesi: en yeni 200 çalışma; token ve maliyeti yalnızca kurucu görür; listede ajan metni yok, SONRA P3-h ila P3-j)
- [x] Onaylar ("Onaylar" sekmesi: karar burada verilmez, satır talebi açar; bekleyen ve onaylanmayan sonucu yalnızca onay verebilen görür, SONRA P3-k, P3-l; göç yok)
- [ ] Projenin notları (Notlar işiyle birlikte) (adım 3'te kurulmadı: Notlar işi (1.3) bekleniyor; proje sayfasında not sekmesi yok)
- [x] Projeye yapay zekâ harcama sınırı: aşılınca o projede ajanlar durur (sınır dolar olarak ve projenin bütün ömrü için, 12 Ekim karar 1; dolunca yeni çalışma başlamaz, süren çalışma bir sonraki adımında biter, talepler kurucuya düşer ve o projede yeni talep açılamaz; yükseltmek ve kaldırmak passkey ister ve bekleyen işleri kendiliğinden yeniden başlatır, 11 Ekim karar 1; SONRA P3-m ila P3-ab)
- [ ] `20261008102700_project_budget_and_milestones.sql` göçünün yerel veritabanına ve test ortamına uygulanması
- [ ] `20261008102800_project_runs_index.sql` göçünün yerel veritabanına ve test ortamına uygulanması
- [ ] `20261008102900_project_ai_spending_limit.sql` göçünün yerel veritabanına ve test ortamına uygulanması
- [ ] `20261008103000_spending_limit_restarts_work.sql` göçünün yerel veritabanına ve test ortamına uygulanması

Adım 4: proje dosyaları (karar 20)

- [ ] (Senden) Supabase'te dosya deposu (test ve canlı ortam için): `office-files` adlı özel kova ve bir gizli anahtar; adımları `docs/supabase-kurulum.md` bölüm 8. Yerelde ve testlerde gerekmez; test ortamı dosya sunmadan önce gerekir. Kurulunca `pnpm files:check` bir kez çalıştırılır (Supabase'e giden üç çağrı gerçek hizmetle henüz denenmedi)
- [x] Dosya modülü: yükleme, liste, indirme, silme; tür ve 25 MB sınırı; görünürlük proje üyeliğiyle (proje sayfasında "Dosyalar" sekmesi; on iki uzantı, tür ada ve içeriğe bakılarak belirlenir, SONRA P4-a; ekleyen kişi, projenin sahibi, yöneticileri ve kurucu siler, 11 Ekim karar 2; projede en çok 200 dosya ve 1 GB, SONRA P4-d; dosya önce yükleme izni alınarak gönderilir, SONRA P4-k; ekleme ve silme iz kaydında; pencere kişisel veri cümlesini ve ajanların okuyacağını söyler, karar 21 ve 11 Ekim karar 3; ajanlar henüz okumaz, adım 6)
- [ ] `20261008103100_project_files.sql` göçünün yerel veritabanına ve test ortamına uygulanması (uygulanana kadar "Dosyalar" sekmesi sunucu hatası verir); yerelde dosya eklemek için `.env` içinde `FILE_STORAGE_DIR`
- [ ] (Senden) "Dosyalar" sekmesine tarayıcıda bir kez bakmak: bir dosya eklemek, indirmek, silmek; 25 MB'lık ve biraz daha büyük bir dosya; çubuk ilerlerken "Yüklemeyi durdur" (yüklemeyi durdurur); "Kaydediliyor" yazarken aynı düğme basılamaz, dosya eklenir ve listeden silinir (SONRA P4-i, P4-w)

Adım 5: GitHub bağlantısı (karar 19 ve 22; 12 Ekim, karar 12-17)

Kod kuruldu ve sahte bir GitHub ile sınandı. Gerçek bağlantı için kurucunun yapacakları sırayla aşağıda; ayrıntıları `docs/github-kurulum.md`.

- [ ] (Senden) 1. İki kuruluşun GitHub'daki adı (adres çubuğunda `github.com/` sonrasında yazan ad, harfi harfine; gizli değil) ve iki kuruluşta da "owner" olduğunun doğrulanması (uygulamayı kuruluşa yalnızca owner kurabilir)
- [ ] (Senden) 2. Her kuruluşta bir GitHub uygulaması oluşturmak (önce Arma DX, sonra Pillika; yerel ortam için): yalnızca o kuruluşa kurulabilir, dört okuma izni (Metadata, Contents, Pull requests, Issues), webhook ve OAuth kapalı; alan alan `docs/github-kurulum.md` bölüm 3
- [ ] (Senden) 3. Her uygulamanın anahtarını (`.pem`) indirmek ve Client ID değerini not almak (bölüm 4). Anahtar sohbete ve depoya girmez
- [ ] (Senden) 4. Her uygulamayı kendi kuruluşuna "All repositories" ile kurmak (bölüm 5). Bir müşterinin deposu panelde hiç görünmeyecekse "Only select repositories" seçilip o depo dışarıda bırakılır
- [ ] (Senden) 5. Sekiz değeri kendi bilgisayarındaki `.env` dosyasına yazmak (`GITHUB_APP_1_*` Arma DX, `GITHUB_APP_2_*` Pillika; bölüm 6) ve `pnpm dev`'i yeniden başlatmak
- [ ] `20261008103500_github_connection.sql` ve `20261008103600_project_repositories.sql` göçlerinin yerel veritabanına ve test ortamına uygulanması (uygulanana kadar proje listesi ve proje sayfası sunucu hatası verir)
- [ ] (Senden) 6. Panelde bağlamak: önce Arma DX seçiliyken hesap menüsünden Ayarlar, Bağlantılar, "GitHub'ı bağla", passkey; sonra Pillika seçiliyken aynısı (bölüm 7)
- [ ] (Senden) 7. Ekranlara tarayıcıda bir kez bakmak: Bağlantılar sayfası; "Yeni proje" penceresinde "GitHub deposu" alanı; bir projenin "GitHub" sekmesi, "Depoyu değiştir" ve "Depoyu kaldır" (ekranlar tarayıcıda görülmeden yazıldı; SONRA P5-h, P5-ab ila P5-ai)
- [ ] Gerçek GitHub ile ilk deneme (kurucunun 1-6. adımlarından sonra): kuruluşa sonradan eklenen deponun listeye kendiliğinden girip girmediği, boş depoda "Son kod değişiklikleri" listesinin ne yazdığı, GitHub'ın yerel adresleri kabul edip etmediği ve dönüşte `state` değerini verip vermediği; sonuçlar `docs/github-kurulum.md` bölüm 11'e yazılır (SONRA P5-t ve "Doğrulanmadı" maddeleri)
- [ ] (Senden) 8. Test sunucusu kurulduğunda (0.7) 2-6. adımların o ortam için bir kez daha yapılması: adlarda "test", adreslerde `https://office-test.armadx.com`; anahtar orada `.env` dosyasına değil sunucunun gizli ayarlarına girilir (SONRA P5-k: her ortam için ayrı uygulama çifti, kurucu onayı bekliyor)
- [x] Veritabanı: şirketin GitHub bağlantısı (`integrations` tablosunda şirket başına tek satır; anahtar ya da token saklanmaz; bir kuruluş ve bir kurulum tek şirkete bağlanır; bağlamak passkey ister ve yalnızca veritabanı işleviyle yazılır) ve projenin deposu (`project_repositories`: proje başına tek depo, yalnızca kendi şirketinin bağlantısından; kural 12 denetimi); şirket ayrımı testleri kısıtlı rollerle
- [x] API'de GitHub modülü (`apps/api/src/github`): şirket başına ayrı uygulama, anahtar ve önbellek; yalnızca okur (yazan yöntemi yok); ortamda iki yuva (`GITHUB_APP_1_*`, `GITHUB_APP_2_*`); uygulama beklenen kuruluşa ait değilse, yazma izni taşıyorsa ya da durdurulmuşsa bağlanılmaz (SONRA P5-p, P5-q, P5-r, P5-aa)
- [x] Kurum ayarlarından GitHub'ı şirkete bir kez bağlama (passkey ile): hesap menüsünde kurucu için "Bağlantılar" sayfası; kurulmamışsa GitHub'ın kurulum sayfasına bağlantı ve dönüş sayfası (`/github/setup`; dönüş hiçbir şeyi değiştirmez); bağlantıyı kesmek onay sorar, passkey istemez (SONRA P5-c, P5-z, P5-ab ila P5-ad)
- [x] Projede o kurumun depolarından birini seçme: "Yeni proje" penceresinde isteğe bağlı "GitHub deposu" alanı (şirket bağlıyken; her deponun yalnızca adı, SONRA P5-u, P5-w); sonradan sahip, yöneticiler ve kurucu "GitHub" sekmesinden bağlar, değiştirir ve kaldırır (12 Ekim, karar 17; passkey istemez, SONRA P5-l)
- [x] Proje sayfasında "GitHub" sekmesi: son 20 kod değişikliği, açık değişiklik istekleri, açık iş kayıtları; yazanların GitHub kullanıcı adları (12 Ekim, karar 16); beş dakikada bir yenilenir; müşteri izni kapalıysa okumaz (kural 12; SONRA P5-b, P5-n, P5-v, P5-ae ila P5-ak)
- [x] İz kaydı: bağlama, bağlantıyı kesme, projeye depo ekleme ve çıkarma (yalnızca numaralar; ad yazılmaz)
- [ ] (Karar: P5-aj) "GitHub" sekmesindeki kullanıcı adları ve başlıklar kişisel veridir; saklanmaz ve modele gitmez, ama yurt dışındaki sunucudan geçer. CLAUDE.md'nin "kişisel veri içeren kaynaklar bağlanmaz" cümlesine GitHub için istisna yazılması ve avukata giden sorunun (X1-3) GitHub'ı kapsaması kurucunun onayını bekliyor; CLAUDE.md'ye GitHub paragrafı da o zaman eklenir

Adım 6: ajanların proje dosyalarını okuması (karar 21)

- [ ] İzin açık projede ajanın dosyaları okuması; dosya içeriğinin veri olarak verilmesi (kural 7)

Adım 7: ajanların kod yazıp değişiklik isteği açması (karar 18 ve 23-30)

Ön planı kurucu onayladı (8 Ekim, karar 23-30). Adım 1 ila 6'dan sonra yapılır (karar 30). Varsayımlar `docs/SONRA.md` içinde K-a ila K-o; Ponytail skill planı aynı dosyada PT-a ila PT-g.

- [x] Ön plan: kodun çalıştırılacağı ortam, GitHub'a yazma yetkisi, onayın kapsamı, güvenlik
- [ ] (Senden) Ajana açılacak depoların listesi; o depolarda ana dalın GitHub'da kilitlenmesi (karar 25); müşteri depoları için "sözleşme kaynak kodunu kapsıyor, depoda kişisel veri ve şifre yok" işareti (karar 26)
- [ ] Yazılım Geliştirme biriminin açılması; YAZ-3 Kodlama Ajanı ve YAZ-4 Kod İnceleme Ajanı kartları ve skill'leri (karar 27)
- [ ] Depoyu okuyan araçlar; depo içeriğinin veri olarak verilmesi (kural 7)
- [ ] Onay Masası'nda fark kartı: dosya dosya eski ve yeni satırlar, test sonucu, risk notu, harcama, hedef depo ve dal
- [ ] "Onaylananı onaydan sonra uygula" altyapısı: onaylanan farkın birebir aynısını sistemin yeni bir dala yazması ve değişiklik isteğini açması (karar 24)
- [ ] GitHub uygulamasına iki yazma hakkının eklenmesi (kod ve değişiklik isteği); kısa ömürlü, yalnızca o depo için anahtar
- [ ] (Karar: P5-i) Yazma izni verilmeden önce uygulama anahtarının nerede duracağı: adım 5 her uygulamanın anahtarını API'nin ortamına koydu ("GitHub" sekmesini API sunar); K-b yazma anahtarının yalnızca worker ortamında durmasını ister. Seçenekler SONRA P5-i'de
- [ ] Ajanın yapamayacakları: birleştirme, yayın, ana dal, ayarlar ve şifreler için araç yok; ana dalı kilitli olmayan depo ajana kapalı (karar 25)
- [ ] Değişiklik başına süre ve harcama tavanı: 30 dakika ve 5 dolar ile başlar (karar 28)
- [ ] Yol 2 (yayın ortamından sonra): şirketin AWS hesabında şifresiz, interneti kapalı ayrı makine; testlerin orada çalıştırılması (karar 23 ve 29)
- [ ] Testler: onaydan önce GitHub'a hiçbir şey yazılmaması; onaylanan ile yazılanın aynı olması; depo içindeki talimat gibi yazılmış metnin araçları ve kuralları değiştirememesi

### 0.4b Görevler: ekip içi görevler (M2)

7 Ekim, karar 9: şirketin iş takibinde Jira yerine paneldeki görev bölümü kullanılabilir; insanlara da görev atanır. Taleplerden ayrı tutulur: iki ayrı tür gibi görünürler. Talep akışının kalanından (0.4a) sonra yapılır (8 Ekim, karar 6). Arayüz Paperclip'in kalıplarıyla kurulur (5 Ekim, karar 7; `docs/paperclip-incelemesi.md` 13.3).

Sunucu:

- [ ] Görev oluşturma, listeleme, ayrıntı, güncelleme uçları
- [ ] Yorum ekleme ve listeleme
- [ ] Durum geçiş kuralları: kim hangi geçişi yapar (Karar: M16)
- [ ] Atama: insana; atama değişikliği kuralı (Karar: M17)
- [ ] Öncelik, son tarih, proje ve birim alanları

Arayüz:

- [ ] Görev formu
- [ ] Liste görünümü; şirket, birim ve durum filtresi
- [ ] Liste satırında durum simgesi ve sabit genişlikte zaman sütunu
- [ ] Listede gruplama
- [ ] Satır içinde durum ve atanan değiştirme (izin verilen geçişler Karar: M16)
- [ ] Tarayıcıda saklanan görünüm (Karar: U13)
- [ ] Pano görünümü: duruma göre sütunlar, sürükleyip bırakma
- [ ] Görev ayrıntısı: durum, atanan, yorumlar, yazma kutusu, özellik paneli
- [ ] Boş ekran metinleri

Testler:

- [ ] Durum geçiş kuralları
- [ ] Görünürlük: proje kapsamı ve dış kişi
- [ ] Filtreler
- [ ] Bir görevin talep uçlarından, bir talebin görev uçlarından okunamaması

### 0.5 Onay Masası (M3)

Not (8 Ekim): ince dilim (0.4) bu bölümün bir kısmını talepler için kurdu: karar uçları, gerekçe zorunluluğu ve neden listesi, kararı kimin verebildiği, passkey, kararın talebin durumuna yansıması, dayandığı kayıt değişince onayın kapanması, kararların iz kaydı, Onaylar ekranının ilk hâli ve kenar çubuğundaki sayı. Aşağıdaki maddeler işaretlenmedi; bölüme başlanırken tek tek gözden geçirilir.

Arayüz Paperclip'in kalıplarıyla kurulur (5 Ekim, karar 7; `docs/paperclip-incelemesi.md` 13.3). Kapsam: 5 Ekim, karar 11; kurucu onayı bekliyor.

Sunucu:

- [ ] Onay kaydı oluşturma ve kuyruk listeleme uçları
- [ ] Karar uçları: onayla, düzeltme iste, reddet
- [ ] Düzeltme ve rette gerekçe zorunluluğu; neden listesi (Karar: M25)
- [ ] Kararı birimin onaylayıcısının ve kurucunun verebilmesi; kimse atanmamışken yalnızca kurucunun (7 Ekim, karar 5)
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
- [ ] Atanmamış kişi karar veremez; kimse atanmamışken kurucu dışındaki rol karar veremez
- [ ] Gerekçesiz ret ve düzeltme reddedilir

### 0.6 Claude bağlantısı, çalışma kaydı ve maliyet (M4)

Not (8 Ekim): ince dilim (0.4) bu bölümün bir kısmını kurdu: tek dosyada Claude istemcisi, modelin karttan ve fiyatın `agents/models.yaml` dosyasından okunması, çalışma kaydı (model, kart sürümü, token, maliyet, süre), hata ve yeniden deneme davranışı, deneme çağrısı betiği. Gerçek çağrı API anahtarını bekliyor. Aşağıdaki maddeler işaretlenmedi; bölüme başlanırken tek tek gözden geçirilir.

- [ ] Anthropic API anahtarı (Senden: hesap ve anahtar); geliştirmede de API anahtarı, düşük harcama sınırıyla (7 Ekim, karar 12)
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
- [ ] Caddy erişim logu `/github/setup` adresinin sorgusunu yazmaz (GitHub'dan dönüşte tek kullanımlık değer ve kurulum numarası taşır; SONRA P5-ac ve P5 bloğundaki ertelenen teknik madde)
- [ ] Cloudflare DNS kayıtları: `office.armadx.com`, `office-test.armadx.com`, `hooks.armadx.com` (Senden: DNS erişimi)
- [ ] Cloudflare koruma ayarları
- [ ] Gizli anahtar kasası ve ortam değişkenleri; `.env.example` güncel
- [ ] Yayın hattı: `development` dalı test ortamına (office-test.armadx.com), `main` dalı canlı ortama (office.armadx.com)
- [ ] Göç dosyalarının yayında yetkili rolle çalışması
- [ ] Tanım senkronizasyonu yayın hattında: göçlerden sonra, api ve worker başlamadan önce. `pnpm db:sync-definitions` bugün yalnızca yerel veritabanına yazar; bu adım olmadan test ve canlı ortamda Ofis görünümü "Burada henüz ajan yok" diye açılır (0.3b). Uzak veritabanına yazan çalıştırmanın koşulları:
  - Dosyalar depoya girmiş olanlardır. Kartın `companies` alanı, ajanın hangi şirkette açılabileceğini ve kimin ofisinde görüneceğini belirler; PR'dan geçmemiş bir kart değişikliği ortak veritabanına ulaşmamalı. Yayın hattının kendi kopyası bunu sağlar. Elle çalıştırma, `agents/` altında commit edilmemiş değişiklik varsa ya da `HEAD`, `origin/development` (test) ya da `origin/main` (canlı) içinde değilse reddeder (dal ve ortam eşlemesi CLAUDE.md'den; bu işte teyit edilir)
  - `HEAD` commit kimliği raporun ilk satırıdır; 1.2'deki tam senkronizasyonla `card_versions.git_commit` da bu değeri taşır
  - Ortam adıyla verilir: `--target test` ya da `--target production`. Verilmezse uzak adres reddedilir; önceki oturumdan kalmış bir adrese yanlışlıkla yazılmaz
  - Şifre adresin parçası olmaz: yayın hattının gizli anahtar kasasından gelir ve bağlantıya ayrı alan olarak verilir
  - Uzak adreste TLS ve Supabase'in sertifika yetkilisine karşı sertifika doğrulaması zorunludur; sertifika yoksa betik bağlanmadan durur (`node-postgres` söylenmedikçe TLS kullanmaz). Bağlantı ayrıntısı: `docs/supabase-kurulum.md`, bölüm 5
  - Yetkili adres ve şifre yalnızca göç ve senkronizasyon adımına verilir; api ve worker kaplarına verilmez (kural 9). `packages/shared/src/env.ts` içindeki ortak ortam şeması bu değerleri görürse api ve worker açılmayı reddedecek biçimde genişletilir
  - Kartı depodan çıkmış bir ajan yayını durdurur; böyle bir karta ne olacağı kararlaştırılana kadar (Karar: U31)
- [ ] Sağlık kontrolü ve yeniden başlatma
- [ ] Log toplama ve hata bildirimi
- [ ] Veritabanı yedeği ve bir kez geri yükleme denemesi
- [ ] Proje dosyalarının yedeği: dosya deposunun her gece Frankfurt'ta şifreli kopyası (12 Ekim, karar 23); Supabase'in veritabanı yedeği dosyaların kendisini içermez. Geri yükleme denemesine dosyalar da eklenir (SONRA P4-t)
- [ ] Zararlı yazılım tarayıcısı: sunucu kurulunca sunucuya kurulur (11 Ekim, karar 4; aynı makinede, 12 Ekim karar 19); proje dosyası depoya yazılmadan taranır. O zamana kadar dosyalar taranmadan eklenir (SONRA P4-m)
- [ ] Dosya deposu için sunucu ayarları: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` gizli ayarlarda; `pnpm files:check`; API'nin veritabanı rolünde işlem içinde bekleme süresi (`idle_in_transaction_session_timeout`) 0 ya da 30 saniyeden uzun (`docs/supabase-kurulum.md` bölüm 8); sunucu boyutlandırılırken API'nin dosya baytları için en kötü anda yaklaşık 400 MB belleğe ihtiyacı olduğu hesaba katılır (SONRA P4-k)
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
- [ ] "İnsana sor" yolu: soru ve eskalasyonun sorumluya ya da talep sahibine gitmesi (talepte talep sahibine soru 0.4a adım 4 ile kuruldu; ajanın sorumlusuna soru ve eskalasyon kaldı, SONRA S-m)
- [ ] "İnsana sor" için soru kartı; seçenekli soru kaydı (Karar: U9) (soru kartı talep sayfasında 0.4a adım 4 ile kuruldu; seçenekli soru kaldı, SONRA S-g)
- [ ] Yanıt gelince ajanın yeniden başlaması (taleplerde 0.4a adım 4 ile kuruldu; X1-6 kapandı)
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

Ofis görünümünden (0.3b) gelen iki bağımlılık:

- `company_agents` satırlarını açan ekran, M40 yanıtlanmadan yayına alınmaz. Tam senkronizasyon `card_versions` yazana kadar veritabanı taslak kartı onaylı karttan ayıramaz (kartın `status` alanı hiçbir yerde saklanmıyor) ve bir ajanın şirkette açılıp açılamayacağına yalnızca kartın şirket listesine bakılarak karar verilir.
- Ofis görünümünün canlı durumları (boşta, çalışıyor, onay bekliyor, hata) 0.4a adım 2 ile bağlandı: durumlar ayrı bir uçtan değil, `GET /api/office` yanıtının içinde gelir ve yarım dakikada bir yenilenir (`docs/SONRA.md`, Z-o). Ajanlar ekranı bir ajanı açtığında masası kendiliğinden "Boşta" görünür.

- [ ] Kart senkronizasyonu: depodaki YAML'ın git commit kimliğiyle `card_versions`'a yazılması (birim ve ajan tanımlarını, yani `units` ve `agent_definitions` satırlarını `pnpm db:sync-definitions` şimdiden yazıyor: 0.3b; 6 Ekim, karar 8. Kalanlar: `card_versions` ve kartın tam içeriği, yetki seviyesi ve model, geçerli sürüm işareti, `agents/tools.yaml`'dan araç kataloğu, tam kart şeması ve "status: draft"ın anlamı (Karar: M40), depodan çıkan karta ne olacağı (Karar: U31), `supabase/seed.sql` içindeki birim listesinin kaldırılması)
- [ ] Her çalışmanın hangi kart sürümüyle koştuğunu kaydetmesi
- [ ] `company_agents` satırlarının açılması ve ayar ekranı (Karar: M40)
- [ ] Ajanlar ekranı: birimlere göre ajanlar, durum, yetki seviyesi
- [ ] Şirket başına durdurma düğmesi ve "her yerde durdur" (Karar: U32) Ofis görünümünde ikisi de var (0.3b ve 0.4a adım 2; 8 Ekim, karar 9); Ajanlar ekranına taşınması kaldı.
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
- [ ] Soru ve onay kartlarının yazma kutusunun üstünde durması (5 Ekim, karar 10; kurucu onayı bekliyor; soru kartı Karar: U9) (talep sayfasında soru kartı sayfanın üstünde, onay kartlarının yerinde durur; 0.4a adım 4, SONRA S-l)
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
- [ ] Projeye Drive klasörü ve GitHub deposu bağlama (Karar: M10, M47) (GitHub deposu bağlama 0.4c adım 5 ile kuruldu; Drive klasörü açık)
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

- [x] GitHub bağlantısı: şirketin kuruluşundaki bütün depoları gören, yalnızca okuyan uygulama (12 Ekim, karar 15; 0.4c adım 5 ile kuruldu; gerçek GitHub ile ilk deneme kurucunun uygulamaları kurmasını bekliyor)
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
