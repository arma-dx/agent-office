# Agent Office Geliştirme Planı

Kaynak: `docs/agent-office-tasarım-raporu.md` (Agentik Ofis Tasarım Raporu, 29 Eylül 2026). Raporun Notion'daki "Geliştirme Planı" sekmesinin karşılığı bu dosya, "Görev Kartları" sekmesinin karşılığı `agents/` klasörüdür; rapordaki diyagramlar md dosyasına aktarılmadı. Rapor neyin ve neden yapılacağını, bu plan nasıl ve ne zaman yapılacağını anlatır. Kurucu kararları `docs/kararlar/` altında; 1 Ekim kararları raporu pilot için daraltır ve bu daraltmalar aşağıda "pilotta" diye belirtilir; 5 Ekim karar 8 de raporun "telefon dahil her cihazdan" onay önlemini pilot için daraltır (web paneli telefona uyumlu yapılmaz). Rapor değişirse bu dosya da güncellenir.

## Hedef

| Tarih | Hedef | Ajanlar |
| --- | --- | --- |
| 10 Ekim | Panel çekirdeği ve ilk 8 ajan | KOR-1, KOR-2, KOR-3, HAF-1, HAF-2, A-TEK-2, A-PRJ-2, SOS-2 |
| 31 Ekim | Pilotun 14 ajanı tamam | KOR-4, KOR-5, A-KES-2, P-IST-1, TAS-3, TAS-6 eklenir |
| Kasım sonu | 4 haftalık ölçüm, Pilot hedefte kapısı | Yetki yükseltmeleri ve Aşama 2 kararı |

7 Ekim kararı 8 iş sırasını değiştirdi: önce talep akışının ince bir hâli uçtan uca çalıştırılır (talep, yönlendirme, tek bir birim ajanı, onay, sonuç). Yukarıdaki tarihler ve aşağıdaki sprint tarihleri bu değişiklikten önce yazıldı; Dilimden sonra önce talep akışının kalanı, sonra Görevler yapılır (8 Ekim, karar 6). 10 Ekim açılışının yeni tarihi kurucunun kararını bekliyor (`docs/SONRA.md`, T12).

Pilot üç şeyi kanıtlamak için seçildi: koordinasyon omurgasının çalıştığını, kurumsal hafızanın doğru yanıt verdiğini ve iki şirkette de ölçülebilir zaman kazancı sağlandığını.

Kapsam dışı: dış müşterilere kurulum (Ürünleşme), WhatsApp ve Uyumsoft entegrasyonları, pilot dışındaki ajanlar, kurum içi model (yalnızca bir müşteri şart koşarsa), Jira gibi dış görev araçları (yalnızca bir müşteri projesi gerektirirse).

## Teknik kararlar

| Konu | Karar |
| --- | --- |
| Dil ve ön yüz | TypeScript; ön yüz React + Vite, TanStack Router ve TanStack Query, shadcn/ui (Radix) ve Tailwind, react-hook-form ve zod; arka yüz Node.js + Fastify |
| Arayüz | Yalnızca dizüstü bilgisayar ekranı için tasarlanan web uygulaması; telefon düzeni yok, telefon için ileride ayrı bir mobil uygulama yapılacak (5 Ekim, karar 8). Arayüzün yapısı ve kullanım kalıpları Paperclip'ten uyarlanır (5 Ekim, karar 5; `docs/paperclip-incelemesi.md`) |
| Barındırma | AWS'de tek sunucu, Docker Compose: Caddy (HTTPS ve yönlendirme), panel dosyaları, API ve çalıştırıcı; iş kuyruğu PostgreSQL üzerinde (pg-boss); Cloudflare önde DNS ve koruma |
| Alan adları | office.armadx.com (panel ve /api, iki şirket için tek giriş), office-test.armadx.com (test), hooks.armadx.com (dış bildirimler) |
| Veritabanı | Supabase PostgreSQL; veritabanına yalnızca sunucu tarafı (API ve worker) bağlanır, tarayıcı hiçbir zaman; API ve worker `BYPASSRLS` yetkisi olmayan kısıtlı bir rolle bağlanır, her API isteği tek bir transaction'dır ve `SET LOCAL` ile `app.company_id`, `app.user_id`, `app.project_id` ve girişte doğrulanmış `app.email` bağlamını kurar; ajan çalışmasında bağlama `app.agent_code` eklenir, her veritabanı adımı kendi kısa transaction'ında yürür ve bağlamı her adımda yeniden kurar; RLS ile şirket ve proje ayrımı; dosyalar Supabase depolamasında |
| Kimlik | Google ile davetli giriş (giriş istemcisi: External; `openid`, `email`, `profile`), API üzerinden sunucu tarafında; yalnızca geçerli daveti ya da üyeliği olan, Google'ın doğruladığı adres girer; iki adımlı doğrulama zorunlu (şirket hesaplarında Workspace ayarıyla; dış kişilerde `amr` iki adımlı doğrulama göstermiyorsa giriş reddedilir); oturum 30 dakika hareketsizlikte, en geç 10 saatte kapanır; önemli onaylarda yeniden doğrulama panelde passkey ile. Ajanların Workspace erişimi ayrı bağlantı istemcisiyle (Internal; `gmail.readonly`, `calendar.readonly`, `drive.readonly`), bağlantıyı kuran kişinin kimliğiyle |
| Model | Claude API, araç kullanımı ile ajan döngüsü; model adı görev kartından; rutin işte hızlı, zor işte güçlü model; tekrar eden talimatlarda istem önbelleği. Model katmanı değiştirilebilir tasarlanır, kartlar modelden bağımsız yazılır |
| Dil | Ana dil Türkçe; ajan çıktıları İngilizce ve Arapça da istenebilir. Pilotta arayüz yalnızca Türkçe |
| Maliyet | Model kullanımı ilk günden iş başına ölçülür; iç işler ve projeler ayrı izlenir, proje işlerinin maliyeti o projenin bütçesine yazılır. Gündelik iç işlerde ayrı üst sınır yok; ajan bazında bütçe uyarısı var |
| Skill'ler | `skills/` altında SKILL.md klasörleri; çalıştırıcı okuyup çağrıya ekler, API'ye yüklenmez |
| Not sistemi | Kurumsal hafıza Obsidian gibi markdown notlar: YAML özellikler, `[[bağlantı]]`, geri bağlantılar, etiketler; kaynak veritabanı |
| Arama | PostgreSQL tam metin arama; gerekirse pgvector |
| Entegrasyonlar | Pilotta Google Workspace (Gmail, Takvim, Drive, Meet kayıtları) ve GitHub; Ekim sonunda Figma. Rapordaki ilke: her dış sistem için bir bağlayıcı, ajana yalnızca kartındaki bağlayıcılar açılır. Pilotta bu, `agents/tools.yaml` kataloğu ve kart izinleriyle karşılanır |
| PDF | HTML şablondan PDF |
| Gizli anahtarlar | Barındırma sağlayıcısının kasası; ajana anahtar verilmez |
| Kod ve yayın | GitHub, otomatik test ve yayın hattı; test ve canlı ortam ayrı. Yalnızca iki dal: `development` test ortamına (office-test.armadx.com), `main` canlı ortama (office.armadx.com) yayınlanır; başka dal açılmaz |

## Ağ ve erişim kuralları

Pilotta panel internete açık; ileride yalnızca ofis ağından, dışarıdan VPN ile açılacak (Cloudflare Access ya da AWS özel ağı). Bu geçiş için:

1. Tarayıcı veritabanına bağlanmaz; bütün istekler API'den geçer, Supabase anahtarları yalnızca sunucuda.
2. Panel ve API tek alan adı altında (office.armadx.com).
3. Dışarıdan gelen çağrılar imza doğrulamalı ayrı bir uç noktadan (hooks.armadx.com) girer.
4. Telefon bildirimleri hassas bilgi taşımaz.
5. Ajanların dış servis çağrıları sunucudan çıkar.

## Veri modeli

Şirket verisi tutan her tabloda `company_id` zorunlu ve RLS açık; kart tanımı ve araç kataloğu gibi global yapılandırma tabloları hariç (uygulama rolü bunları yalnızca okur). `tasks`, `runs`, `approvals`, `notes`, `documents` ve `audit_log` tablolarında boş bırakılabilir `project_id` var; doluysa satırı yalnızca proje üyeleri ve kurucu görür. Ajan çalışmasında görünürlük ayrıca daraltılır: proje bağlamı olmayan ajan çalışması hiçbir projenin proje kapsamlı satırını görmez, proje bağlamı olan çalışma yalnızca kendi projesinin satırlarını görür; çalışmanın kimliği kurucu olsa bile. Çalışma kayıtlarının görünürlüğü bağlı olduğu görevden ya da projeden gelir.

| Tablo | İçerik |
| --- | --- |
| companies | Kiracılar ve özel alanlar. `kind`: `company` (Arma DX, Pillika) ya da `private_space` (yalnızca kurucunun üye olduğu Kurucu alanı, `founder_space`) |
| users, memberships | Kişi, üyesi olduğu şirketler, rol; giriş yalnızca geçerli daveti ya da üyeliği olan, Google'ın doğruladığı adresle; kullanıcı yalnızca kendi kaydını, üyeliklerini ve üyesi olduğu şirketleri görür |
| agent_definitions, card_versions | Global, `company_id` yok. Görev kartı: amaç, talimat, skill'ler, araç izinleri, yetki seviyesi, onay noktaları, model, sınırlar, sürüm geçmişi; depodaki YAML'dan her yayında git commit kimliğiyle senkronize edilir |
| company_agents | Şirkete özel ajan satırı: `company_id`, `agent_code`, durum (durdurma düğmesi), ayarlar (Drive klasörleri, öncelikli göndericiler, Figma çalışma dosyası, bütçe) |
| tasks | Talep, şirket, proje, atanan (insan ya da ajan), durum, öncelik, son tarih, yorumlar |
| runs | Ajan çalışması: girdi, çıktı, araç çağrıları, model, kart sürümü, token, maliyet, süre, iç iş ya da proje etiketi |
| approvals | Onay bekleyen çıktı, özet, risk notu, fark, durum, gerekçe, onaylayan, zaman; para içerip içermediği ve onaydan sonra dışarı gönderilip gönderilmeyeceği (5 Ekim, karar 2) |
| audit_log | Değiştirilemeyen olay kaydı: kim, ne yaptı, hangi veriye baktı, ne zaman |
| notes, note_versions | Markdown not: klasör yolu, başlık, YAML özellikler, gövde, sürüm, arama dizini, taslak durumu (Y1 ajanın notu onaydan sonra paylaşılır); kararlar ve tutanaklar da not türü |
| note_links | Notlardaki `[[...]]` bağlantıları; geri bağlantılar ve grafik görünümü buradan |
| documents | Drive'dan gelen kaynak dosyalar; her biri bir kaynak notuna bağlı |
| station_candidates | Pillika için toplanan istasyon verisi: kaynak, konum, operatör, soket tipleri, güç, erişim, tarih, doğrulama durumu, eşleşen kayıt |
| customers, opportunities | Basit müşteri listesi: kurum, kişi, fırsat, aşama, değer, sonraki adım; müşteri düzeyinde AI izni (izni olmayan müşteriye bağlı bütün kayıtlar ajan çalışmalarına kapalı) ve sözleşmenin kodla otomatik işlemeye izin verip vermediği; müşteri adı şirket içinde tekildir; sözleşme izinlerini yalnızca kurucu işaretler, AI iznini passkey ile açar (bu üçü kurucu onayı bekliyor, `docs/SONRA.md` P1-f, P-b, P1-c) |
| projects | Proje: ad, açıklama, müşteri (isteğe bağlı), beş durum, renk ve simge, hedef tarih, açan kişi, bütçe (tutar ve para birimi: TRY, USD, EUR; sahip, yöneticiler ve kurucu görür ve değiştirir, 12 Ekim karar 2; para birimi seçimi kurucu onayı bekliyor, `docs/SONRA.md` P3-c), kilometre taşları (ad, isteğe bağlı gün, tamamlandı; en çok 50), AI izni (müşteri sözleşmesi AI kullanımına izin vermiyorsa o projede ajan çalışmaz); izni yalnızca kurucu, passkey ile açar (8 Ekim, karar 15 ve 22). İzin kapalı başlar; izin açıkken projenin müşterisi değişmez; proje silinmez, kapatılır (bu üçü kurucu onayı bekliyor, `docs/SONRA.md` W-i, P1-t, P-h) |
| project_members | Projenin üyeleri (o şirketin kurucusu ve çalışanları); projeyi açan kişi üyesidir (ikisi de kurucu onayı bekliyor, `docs/SONRA.md` P-j, P-a); proje kapsamlı satırları yalnızca üyeler ve kurucu görür. Her üyeliğin bir rolü vardır: sahip, yönetici ya da üye. Üyeyi sahip ve yöneticiler çıkarır, bir üye başka bir üyeyi çıkaramaz (8 Ekim, karar 44). Sahibin projeyi açan kişi olması, üye eklemeyi de yalnızca sahip, yöneticiler ve kurucunun yapması, yöneticinin yalnızca üyeleri çıkarması, sahibin çıkarılamaması ve sahipliğin devredilmesi kurucu onayı bekliyor (`docs/SONRA.md` P1b-a ila P1b-m) |
| integrations | Bağlantı ayarları ve yetkileri, şirket bazında; Google bağlantı token'ları şifreli, yalnızca worker kullanır |

## Durumlar ve roller

Onaylandı. Arayüzde Türkçe adlar, veritabanında parantez içindeki değerler kullanılır.

- Görev durumu: Açık (`open`), Sürüyor (`in_progress`), Onay bekliyor (`awaiting_approval`), Yanıt bekliyor (`awaiting_reply`, 2 Ekim), Tamamlandı (`done`), İptal (`cancelled`)
- Onay durumu: Bekliyor (`pending`), Onaylandı (`approved`), Düzeltme istendi (`changes_requested`), Reddedildi (`rejected`)
- Proje durumu: Beklemede (`backlog`), Planlandı (`planned`), Sürüyor (`in_progress`), Tamamlandı (`completed`), İptal (`cancelled`); Tamamlandı ve İptal projeyi kapatır (8 Ekim, karar 17; kapatma kuralı kurucu onayı bekliyor, `docs/SONRA.md` P-c)

| Rol | Yetki |
| --- | --- |
| Kurucu (`founder`) | Bütün şirketleri görür, bütün onayları verir, kullanıcı ve ajan ayarlarını yönetir; iki şirketi birlikte yalnızca holding görünümünde (salt okunur) görür; Kurucu özel alanının tek üyesidir |
| Çalışan (`employee`) | Üyesi olduğu şirketin görev ve notlarıyla çalışır; proje kapsamlı kayıtları yalnızca üyesi olduğu projelerde görür; proje açar ve üye ekler (8 Ekim, karar 15); başka bir üyeyi yalnızca sahibi ya da yöneticisi olduğu projede çıkarır (8 Ekim, karar 44); üye eklemesi de sahibi ya da yöneticisi olduğu projeyle sınırlıdır, yönetici olarak yalnızca üyeleri çıkarır (kurucu onayı bekliyor, `docs/SONRA.md` P-a, P1b-d, P1b-f); onay yetkisi kurucu verirse açılır |
| Dış kişi (`external`) | Mali müşavir ve avukat gibi; kendi Google hesabıyla davetle girer; yalnızca kendisine açılan görev ve notları görür |

## Yetki seviyeleri

Rapordaki dört seviye. Ajanların çoğu Y1 ile başlar; "Y1, hedef Y2" yazan ajan Y1 ile başlar, hedefi Y2'dir.

| Seviye | Ad | Ajan ne yapar | İnsan ne yapar |
| --- | --- | --- | --- |
| Y0 | Danışman | Analiz eder, öneri ve rapor üretir; hiçbir sistemde değişiklik yapmaz | Öneriyi okur, kararı verir |
| Y1 | Taslakçı | Taslak ve çıktı hazırlar; onay gelmeden dışarı göndermez, sisteme yazmaz | Onay Masası'nda onaylar, düzeltir ya da reddeder |
| Y2 | Denetimli uygulayıcı | Tanımlı sınırlar içinde kendisi uygular (iç kayıt açma, iç bildirim gibi); sınır dışını onaya gönderir | Sınırları belirler, sonradan örnekleyerek denetler |
| Y3 | Otonom | Rutin işi kendisi yürütür, yalnızca istisnaları bildirir; yalnızca okuma ve izleme işlerinde kullanılır | İstisna bildirimlerini ele alır |

- Yükseltme: ajan en az 50 işte ilk seferde yüzde 95 onay oranına ulaşır ve son 30 günde kritik hata yapmazsa bir üst seviyeye önerilir; kararı birim sorumlusu, başlangıçta kurucu verir. Kritik hata ajanı hemen bir seviye düşürür ve vaka incelenir. Eşikler pilotta gerçek veriyle ayarlanır.
- Hiçbir koşulda ajana bırakılmayan işler (ajan bu işlerde en fazla Y1): para transferi, imza ve taahhüt, resmî kurumlara başvuru ve beyan, kişisel verinin silinmesi ya da üçüncü kişiye aktarılması.
- Pilotta Y1 kapısı kodla uygulanır (1 Ekim ikinci tur, karar 4): Y1 ajan yalnızca korumalı alana (taslaklar) ve kendi görevinin durumuna yazar; paylaşılan kayda yazması (bildirim, paylaşılan not, başka bir görevi güncelleme) onaya düşer; görev açma öneri olarak gelir. Ajanın soruları ve eskalasyonları "insana sor" yoluyla ajanın sorumlusuna (kartta `owner`) ya da talep sahibine gider, onaya düşmez (2 Ekim, karar 1). Y2 ve Y3 kapıları karar bekliyor (`docs/SONRA.md`, M19).
- Her ajanın bir insan sorumlusu var; sorumlu ajanı her an durdurabilir ya da işi devralabilir. Pilotta bütün ajanların sorumlusu kurucudadır. Onay, işi yapan birimin onaylayıcısındadır: şimdilik bütün birimlerin onaylayıcısı kurucudur; ileride birime, ayrıca tek bir ajana başka bir kişi atanabilir, talep sahibinin onayı da her işin sonunda alınır (7 Ekim, karar 5 ve 6); talep sahibi talebi okuyamıyorsa onayı kurucu verir (8 Ekim karar 45'ten türetilmiş yorum; kurucu onayı bekliyor, SONRA P2-t).

## Ekranlar

Günlük iş listeler, pano ve Onay Masası üzerinden yürür. Aşağıdaki ekran listesi kalır; ekranlar Paperclip'in arayüz yapısıyla (kenar çubuğu, üst çubuk, özellik paneli) ve kullanım kalıplarıyla kurulur (5 Ekim, karar 5). Yerleşim `docs/paperclip-incelemesi.md` 13.2'den gelir:

- Solda kenar çubuğu durur. Başında şirket menüsü var: Arma DX, Pillika; kurucu için ayrıca holding görünümü (iki şirketin API'de salt okunur birleştirmesi) ve Kurucu özel alanı.
- Üst satırlar: Yeni talep, Bugün, Onaylar. Bugün ve Onaylar satırında bekleyenlerin sayısı görünür.
- "İş" grubu: Görevler, Notlar, Projeler, Müşteriler. (Projeler: 8 Ekim, karar 11 ve 14.)
- "Ofis" grubu: Ofis görünümü, Ajanlar, İz kaydı, Ölçümler (Ofis görünümünün yeri: 5 Ekim, karar 12).
- Hesap menüsü: Ayarlar, tema, çıkış.
- Üst çubuk bulunulan yeri gösterir.
- Ayrıntı sayfalarında (Görev ayrıntısı, not, Görev kartı) özellik paneli vardır.

Bir satır, ekranı yapıldığında menüye eklenir. Panel telefona uyumlu yapılmaz, telefon düzeni yoktur; telefon alt menüsü kabuk işinde kaldırılır (5 Ekim, karar 8). Tasarım dili CLAUDE.md içinde.

| Ekran | Ne gösterir | Sprint |
| --- | --- | --- |
| Giriş | Google ile giriş | 0 |
| Bugün | İlk bölüm "bana düşenler" listesi: bekleyen onaylar, yanıt bekleyen sorular, görev önerileri, sınıra takılan ya da başarısız çalışmalar, bildirimler (5 Ekim, karar 10; Bugün'ün bu bölümünü kurucu 8 Ekim karar 7 ile onayladı). Ardından bugünkü görevler, ajanların son işleri, uyarılar | 2 |
| Onay Masası | Önceliğe göre kuyruk; özet, risk notu, değişiklik farkı; onay, düzeltme, ret; önemli onaylarda yeniden doğrulama; günde bir ya da iki toplu onay turu (paketleme KOR-3 ile Sprint 1, özet bildirimi M9 ile Sprint 2). Onay kaydı tektir: aynı onay kartı Görev ayrıntısında ve Bugün'de de görünür, karar hangi ekrandan verilirse verilsin tek bir uç noktadan geçer (5 Ekim, karar 10; kurucu onayı bekliyor) | 0 |
| Görevler | Pano ve liste; şirket, birim, ajan ve durum filtresi | 0 |
| Görev ayrıntısı | Sohbet biçimli akış: talep, yorumlar, ajanın çalışma özeti ve açılan adımları (araç çağrıları), çıktılar, soru ve onay kartları (5 Ekim, karar 11; kurucu onayı bekliyor). Özellik paneli: durum, atanan, birim, maliyet. İşi ajandan devralma; KOR-1'in yönlendirmesini düzeltme | 1 |
| Ajanlar | Birimlere göre ajanlar, durumları, yetki seviyeleri, şirket başına durdurma düğmesi ve "her yerde durdur" | 1 |
| Görev kartı | Kart ve skill'ler salt okunur (değişiklik depoda PR ile), sürüm geçmişi, test sonuçları | 1 |
| Notlar | Klasör ağacı, editör, geri bağlantılar, etiketler, arama; HAF-2'ye soru (proje sayfasından o projede; genel ekranda proje seçilerek) | 1 |
| Projeler | Proje listesi; yeni proje (ad, açıklama, müşteri, üyeler); proje sayfası: Talepler ve Ayarlar sekmeleri (0.4c adım 2), Kilometre taşları sekmesi ve özellikler panelinde bütçe (0.4c adım 3), beş durum, renk ve simge, hedef tarih, üyeler (üyelerde sahip, yönetici, üye; 8 Ekim, karar 44), yapay zekâ izni, talepler, dosyalar, GitHub, bütçe ve kilometre taşları, notlar, ajan çalışmaları ve maliyeti, onaylar, yapay zekâ harcama sınırı (8 Ekim, karar 11 ve 14-22). Adımları KALAN-ISLER 0.4c içinde | 0 ve sonrası |
| Müşteriler | Müşteri ve fırsat listesi | 2 |
| İz kaydı | Kim, ne yaptı, ne zaman; filtreler | 2 |
| Ayarlar | Kullanıcılar ve roller, şirketler, entegrasyonlar (Drive bağlantısı ve klasör izin listesi Sprint 1, Gmail ve Takvim Sprint 3) | 0, 1 ve 3 |
| Ölçümler | Ofis düzeyindeki ölçütler (aşağıdaki Ölçütler bölümü) | 4 |
| Not grafiği | Notlar arası bağlantıların grafiği | 4 |
| Ofis görünümü | Birimleri ve ajanları gösteren izometrik ofis haritası: birimler oda, ajanlar masalarında; çalışıyor, onay bekliyor, boşta ve hata durumları. İlk sürüm o şirkette ajanı olan birimleri, kartı olan ajanları, ortada Kurumsal Hafıza odasını ve ajanın o şirketteki durumunu (Kapalı, Boşta, Çalışıyor, Onay bekliyor, Hata, Durduruldu) gösterir, seçili ajanın panelinde açık taleplerinin sayıları durur (6 Ekim, karar 3-8; canlı durumlar ve sayılar 0.4a adım 2 ile: 8 Ekim, karar 10; "Etkin" yerine "Boşta" ve türetilen öbür seçimler kurucu onayı bekliyor, `docs/SONRA.md` W-d, W-e, Z-a ila Z-s); birim sayıları ve ajan sayfasına geçiş ilgili işlerle gelir | 0: kabuktan hemen sonra, Görevler'den önce (5 Ekim, karar 14; KALAN-ISLER 0.3b) |

## Modüller

| Kod | Modül | İçerik | Sprint |
| --- | --- | --- | --- |
| M1 | Kimlik ve kiracı | Google ile davetli giriş, şirket seçimi, roller, RLS ve proje kapsamı, Kurucu özel alanı; iki adımlı doğrulama (önce `amr` denemesi), passkey kaydı | 0 |
| M2 | Görev kaydı | Talep, atama, durum, son tarih; pano ve liste; talep formunda isteğe bağlı proje alanı (0.4c adım 2) | 0 |
| M3 | Onay Masası | Kuyruk, özet, fark, onay, ret, düzeltme, gerekçe | 0 |
| M4 | İz kaydı ve maliyet | Çalışma ve onay kaydı; token ve maliyet; iç iş ve proje ayrımı | 0 |
| M5 | Ajan çalıştırıcı | Kart ve skill yükleme, Claude ile araç döngüsü, kuyruk, zamanlayıcı, olay tetikleyici, yeniden deneme, zaman aşımı, durdurma; Y1 kapısı, "insana sor" yolu; `project_context` (proje başına zamanlanmış çalışma) ve proje özetlerinin kodla birleştirilmesi; talep çalışmasında `if_available` kuruldu (0.4c adım 2), `required` ve `per_project` kurulmadı (SONRA P2-g). Talep çalışması talep sahibinin adına koşar; talep sahibi talebi okuyamıyorsa kurucunun adına (8 Ekim, karar 45); kimliği veritabanı belirler. Yeniden açılan ajanı ve yeniden açılan izni bekleyen işler kendiliğinden başlar (8 Ekim, karar 49) | 1 |
| M6 | Görev kartı yönetimi | Kart görüntüleme, sürüm geçmişi, test setini çalıştırma; düzenleme depoda PR ile. | 1 |
| M7 | Not sistemi | Markdown editörü, `[[` ile not önerisi, geri bağlantılar, etiket ve özellik filtresi, arama, kaynak gösterme; Drive'dan içeri aktarma | 1 |
| M8 | Ofis Koordinatörü | Talebi sınıflandırır, şirketi ve birimi belirler, alt görevlere böler; yönlendirme kararları kayıtlı ve düzeltilebilir; koordinatör devre dışıyken birimlere doğrudan erişim yolu (yedek yol) | 1 |
| M9 | Bildirimler | Günlük onay özeti, tarayıcı ve e-posta bildirimi | 2 |
| M10 | Müşteri ve fırsat listesi | Basit CRM | 2 |
| M11 | PDF ve şablonlar | Teklif ve rapor şablonları | 2 |
| M12 | Google Workspace bağlantısı | Bağlantı istemcisi, salt okunur kapsamlar, şifreli token; Drive (Sprint 1); Gmail, Takvim, Meet kayıtları (Sprint 3) | 1 ve 3 |
| M13 | Ölçüm panosu | Ölçütler bölümündeki dokuz ölçüt; iç işler ve projeler ayrı | 4 |
| M14 | Not sistemi ek özellikleri | Grafik görünümü, günlük notlar, şablonlar, Obsidian uyumlu dışa aktarma, MCP sunucusu | 4 |
| M15 | Ofis görünümü | İzometrik ofis haritası: birimler oda, ajanlar masalarında, durumlar renk ve hareketle | 0: kabuktan hemen sonra, Görevler'den önce (5 Ekim, karar 14; KALAN-ISLER 0.3b) |

## Pilot ajanları

Rapordaki pilot seti. "Ne yapar" sütunu raporun tanımıdır; görev kartları pilotta bazı işlerde daha dar (açık olanlar `docs/SONRA.md` içinde). KOR-2 ve HAF-2'nin "hedef Y3" bilgisi kartlardan gelir; raporda ikisi de yalnızca Y2. Yetki seviyeleri yukarıda; bütün ajanların insan sorumlusu pilotta kurucu.

| Kod | Ajan | Ne yapar | Yetki | Sprint |
| --- | --- | --- | --- | --- |
| KOR-1 | Ofis Koordinatörü | Talebi alır, şirketini ve birimini belirler, alt görevlere böler, ajanlara dağıtır, sonucu döner; pilotta iki şirketi kapsayan talebi açıldığı şirkette yürütür, diğer şirket için kurucuya görev önerisi bırakır | Y2 | 1 |
| KOR-2 | Görev Takip | Görev kaydını tutar; son tarihleri, bekleyen onayları ve tıkanan işleri izler, hatırlatır, geciken işi sorumlusuna bildirir | Y2, hedef Y3 | 1 |
| KOR-3 | Onay Masası | Onay kuyruğunu özet, risk notu ve farkla sunar, önceliklendirir, günlük onay turunu hazırlar | Y2 | 1 |
| HAF-1 | Bilgi Tabanı | Dokümanları nota aktarır, etiketler ve bağlar; eskimiş, çelişen ve kopuk notları işaretler; tek doğru kaynak sayfalarını güncel tutar; kararları karar notu olarak bağlar | Y2 | 1 |
| HAF-2 | Kurumsal Arama | Soruları notlardan kaynak göstererek yanıtlar; yetkisiz bilgiyi göstermez; bilgi yoksa uydurmaz, eksiği Bilgi Tabanı Ajanına iletir | Y2, hedef Y3 | 1 |
| A-TEK-2 | Teklif | İş kırılımı, ücret kartına göre fiyat, PDF teklif ve zaman çizelgesi; fiyat onayı kurucuda | Y1 | 2 |
| A-PRJ-2 | Proje Takip | Görev kaydı, GitHub ve toplantılardan haftalık durum raporu, risk listesi ve bütçe gerçekleşme karşılaştırması; müşteriye giden rapor onaydan geçer | Y2 iç, Y1 müşteri | 2 |
| SOS-2 | Sosyal İçerik Yazım | Verilen kaynak bilgiden seçenekli gönderi metinleri ve video senaryoları | Y1 | 2 |
| KOR-4 | Yönetici Asistanı | Gmail ve Takvim üzerinden e-posta önceliklendirme, toplantı brifingi, günlük ve haftalık özet, verilen sözler ve bekleyen yanıtların takibi; pilotta yalnızca kurucu için ve Kurucu özel alanında çalışır | Y1, hedef Y2 | 3 |
| KOR-5 | Toplantı | Toplantı öncesi gündem ve dokümanlardan brifing; izin varsa Meet kaydının dökümünden tutanak, kararlar ve aksiyonlar; aksiyonları görev kaydına, tutanağı ilgili notlara bağlı not olarak işler | Y2 iç, Y1 dış paylaşım | 3 |
| A-KES-2 | Süreç Analizi | Görüşme kayıtlarından süreç haritası ve sorun listesi | Y1 | 3 |
| P-IST-1 | İstasyon Veri Toplama | CPO entegrasyonlarından, kamuya açık listelerden, işletmeci sitelerinden ve açık veriden istasyon verisini toplar, tek biçime çevirir, tekrarları birleştirir | Y2 | 4 |
| TAS-3 | UI/UX Tasarım | Arma DX müşteri projeleri ve Pillika uygulaması için akışlar, tel kafes ve ekran tasarımları; erişilebilirlik kontrolü ve geliştirici teslim dokümanı; ilk iş Pillika uygulamasının yeniden tasarımı | Y1 | 4 |
| TAS-6 | Sosyal Medya Görsel | Marka şablonlarından kanal ölçülerinde gönderi, kaydırmalı gönderi, hikâye ve video kapakları; farklı kanal ve dil sürümleri | Y1 | 4 |

## Skill yapısı

| Dosya | İçerik |
| --- | --- |
| `skills/proposal/SKILL.md` | Ne zaman kullanılacağı ve adım adım çalışma talimatı |
| `skills/proposal/templates/` | Çıktı şablonları |
| `skills/proposal/examples/` | Onaylanmış iyi çıktı örnekleri |
| `skills/proposal/tests/` | 10-20 örnek girdi ve kabul ölçütleri |
| `agents/A-TEK-2.yaml` | Görev kartı: skill'ler, araçlar, yetki seviyesi, onay noktaları, model, sınırlar |

Skill içeriği kurucunun verdiği gerçek dokümanlardan yazılır; bilgi uydurulmaz.

## Sprintler

### Sprint 0 · 30 Eylül-3 Ekim

- [ ] Monorepo iskeleti, test ve canlı ortam, otomatik test ve yayın hattı
- [ ] Veri modeli ve RLS; iki şirketin verisinin birbirine görünmediğini doğrulayan test; tarayıcı veritabanına bağlanmaz
- [ ] Google ile giriş, roller ve şirket seçimi (M1)
- [ ] Arayüz kabuğunun Paperclip yapısıyla yeniden kurulması (5 Ekim, karar 5-7; KALAN-ISLER 0.3a)
- [ ] Ofis görünümü (M15): kabuktan hemen sonra, Görevler'den önce (5 Ekim, karar 9 ve 14; KALAN-ISLER 0.3b); önce Kasım işiydi
- [ ] Görev kaydı ve pano (M2)
- [ ] Onay Masası (M3)
- [ ] Claude API bağlantısı, çalışma kaydı, iz kaydı ve maliyet ölçümü (M4)
- [ ] Pilot işlerin bugünkü sürelerini ölç: teklif, proje raporu, sosyal medya gönderisi

### Sprint 1 · 4-6 Ekim

- [ ] Ajan çalıştırıcı: kart ve skill yükleme, araç çağrıları, kuyruk, yeniden deneme, durdurma (M5)
- [ ] Görev kartı görüntüleme, sürüm geçmişi ve kart senkronizasyonu (M6)
- [ ] Not sistemi: editör, not bağlantıları, geri bağlantılar, arama; Drive'dan içeri aktarma (M7, M12)
- [ ] Bilgi tabanının ilk yüklemesi: şirket profilleri, ürün bilgileri, ücret kartı ve teklif kuralları, şablonlar
- [ ] KOR-1, KOR-2, KOR-3, HAF-1, HAF-2 için görev kartı, skill ve test seti; devreye alma (M8)

### Sprint 2 · 7-10 Ekim

- [ ] Teklif Ajanı (A-TEK-2) ve PDF teklif (M11)
- [ ] Proje Takip Ajanı (A-PRJ-2)
- [ ] Sosyal İçerik Yazım Ajanı (SOS-2)
- [ ] Müşteri ve fırsat listesi (M10)
- [ ] Günlük onay özeti ve bildirimler (M9)
- [ ] Pilot açılış kontrolleri; 10 Ekim'de pilot 8 ajanla açılır

### Sprint 3 · 11-20 Ekim

Bu sprintteki bağlantılar kişisel veri içerir; avukatın görüşü gelmeden bağlanmaz (1 Ekim ikinci tur, karar 7).

- [ ] Gmail ve Takvim bağlantısı; Yönetici Asistanı (KOR-4)
- [ ] Meet kayıtlarının dökümü; Toplantı Ajanı (KOR-5)
- [ ] Süreç Analizi Ajanı (A-KES-2)

### Sprint 4 · 21-31 Ekim

- [ ] İstasyon Veri Toplama Ajanı (P-IST-1)
- [ ] Figma bağlantısı; UI/UX Tasarım Ajanı (TAS-3)
- [ ] Sosyal Medya Görsel Ajanı (TAS-6)
- [ ] Ölçüm panosu (M13)
- [ ] Not sistemi ek özellikleri (M14)

### Kasım

- [ ] En az dört hafta boyunca Ölçütler bölümündeki ölçütleri topla
- [ ] Pilot hedefte kapısını değerlendir
- [ ] Her ajan için yetki yükseltme ya da düzeltme kararı (Yetki seviyeleri bölümündeki kurala göre)
- [ ] Aşama 2'nin sırasını belirle

## Kapılar

Bir aşamanın kapısı geçilmeden sonrakine başlanmaz. Pilotu ilgilendiren iki kapı:

| Kapı | Geçiş ölçütü |
| --- | --- |
| Altyapı hazır | Kiracı ayrımı veritabanında zorunlu; kimlik, yetki ve iz kaydı çalışıyor; bilgi tabanının ilk yüklemesi tamam; pilot işlerin bugünkü süreleri ölçüldü |
| Pilot hedefte | Pilot ajanlarda ilk seferde onay oranı ve zaman kazancı hedefte; son 30 günde kritik hata yok; ekip ofisi düzenli kullanıyor |

Sonraki kapılar (Çekirdek oturdu, Ürün canlıda) raporda.

## Ölçütler

Ofis düzeyinde izlenir; ajan düzeyindeki ölçütler görev kartlarında.

| Ölçüt | Tanım | Hangi karara girer |
| --- | --- | --- |
| Tamamlanan iş | Ajanların haftada bitirdiği iş, birim ve şirket bazında | Birimlerin yük dağılımı |
| İlk seferde onay oranı | Düzeltmesiz onaylanan işlerin payı | Yetki yükseltme |
| Onay bekleme süresi | İşin Onay Masası'nda beklediği süre | Onay turlarının sıklığı, onay yetkisinin devri |
| Düzeltme nedenleri | En sık düzeltme ve ret gerekçeleri | Görev kartı iyileştirmesi |
| Kazanılan insan saati | İş başına eski süre ile yeni süre farkı | Yatırımın geri dönüşü |
| Yanıt ve teslim süresi | Talepten sonuca geçen süre | Hizmet kalitesi |
| İş başına maliyet | Model, araç ve altyapı maliyeti bölü iş sayısı; iç işler ve projeler ayrı | Model seçimi, proje bütçesi |
| Kritik hata sayısı | Dışarıya yanlış çıkan ya da zarar doğuran iş | Yetki düşürme, süreç düzeltme |
| Kullanım oranı | Ofisi haftada en az bir kez kullanan çalışanların payı | Benimseme ve eğitim ihtiyacı |

Kazanılan zamanın ölçülebilmesi için pilottan önce seçilen işlerin bugünkü süreleri kaydedilir.

## Pilot açılış kontrolleri

- [ ] İki şirketin verisi birbirine görünmüyor; testle doğrulandı
- [ ] API ve worker `BYPASSRLS` yetkisi olmayan rolle bağlanıyor; yetkili rol istek ve çalışma yolunda kullanılmıyor
- [ ] Dışarı giden her iş onaydan geçiyor; onaysız çıkış yolu yok
- [ ] Her ajan çalışmasının kaydı ve maliyeti panelde görünüyor
- [ ] Her ajanın durdurma düğmesi çalışıyor
- [ ] Gizli anahtarlar kasada; Supabase anahtarları tarayıcıya hiç gitmiyor
- [ ] Yedek alınıyor ve geri yükleme bir kez denendi
- [ ] Her pilot ajanın görev kartı ve test seti hazır
- [ ] KVKK ve kişisel verinin yurt dışına aktarımı avukatla gözden geçirildi
- [ ] Avukatın görüşü gelene kadar kişisel veri içeren hiçbir kaynak bağlı değil: Gmail, Takvim, Meet dökümleri, müşteri görüşme kayıtları, kişisel veri içeren Drive klasörleri

## Testler

| Test | Ne kontrol eder | Ne zaman |
| --- | --- | --- |
| Ajan test seti | Çıktının kabul ölçütlerini karşılaması | Görev kartı her değiştiğinde |
| Şirket ayrımı | Bir şirketin kullanıcısının ve ajanının diğer şirketin verisini görememesi; kısıtlı rolle: bağlam Pillika iken Arma DX satırı okunamaz, bağlam yokken hiçbir satır okunamaz, proje kapsamlı satır proje dışından okunamaz; proje bağlamı olmayan ajan çalışması proje kapsamlı satır okuyamaz, kimliği kurucu olsa bile; kullanıcı yalnızca kendi üyeliklerini görür | Her yayında |
| Onay akışı | Dışa etkili hiçbir işin onaysız çıkamaması | Her yayında |
| İstem enjeksiyonu | E-posta ve dokümana gizlenmiş talimatların uygulanmaması | Haftalık ve her yeni bağlantıda |
| Maliyet | Çalışma başına maliyetin beklenen aralıkta kalması | Haftalık |
| Yasak işler | Para, imza, resmî başvuru ve kişisel veri silme ya da aktarma işlerinde hiçbir ajanın Y1'in üstüne çıkamaması | Her yayında |
| AI izni | AI izni olmayan projede hiçbir ajanın çalışamaması; izni olmayan müşteriye bağlı kayıtların ajan çalışmasına kapalı olması; bu müşteride yalnızca model çağırmayan sistem işlerinin sürmesi; talep açılırken, her çalışmanın başında, izin kapanınca süren çalışmada ve onayda (0.4c adım 2) | Her yayında |
| Yetki kapısı | Y1 ajanın `internal_write` çağrısının onaya düşmesi; "insana sor" yolunun onaya düşmemesi | Her yayında |
