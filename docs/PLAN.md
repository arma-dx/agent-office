# Agent Office Geliştirme Planı

Kaynak: "Agentik Ofis Tasarım Raporu" dokümanının Geliştirme Planı sekmesi. Doküman değişirse bu dosya da güncellenir.

## Hedef

| Tarih | Hedef | Ajanlar |
| --- | --- | --- |
| 10 Ekim | Panel çekirdeği ve ilk 8 ajan | KOR-1, KOR-2, KOR-3, HAF-1, HAF-2, A-TEK-2, A-PRJ-2, SOS-2 |
| 31 Ekim | Pilotun 14 ajanı tamam | KOR-4, KOR-5, A-KES-2, P-IST-1, TAS-3, TAS-6 eklenir |
| Kasım sonu | 4 haftalık ölçüm, Pilot hedefte kapısı | Yetki yükseltmeleri ve Aşama 2 kararı |

Kapsam dışı: dış müşterilere kurulum, WhatsApp ve Uyumsoft entegrasyonları, pilot dışındaki ajanlar.

## Teknik kararlar

| Konu | Karar |
| --- | --- |
| Dil ve ön yüz | TypeScript; ön yüz React + Vite, TanStack Router ve TanStack Query, shadcn/ui (Radix) ve Tailwind, react-hook-form ve zod; arka yüz Node.js + Fastify |
| Arayüz | Telefona uyumlu web uygulaması (PWA); onaylar telefondan verilir |
| Barındırma | AWS'de tek sunucu, Docker Compose: Caddy (HTTPS ve yönlendirme), panel dosyaları, API ve çalıştırıcı; iş kuyruğu PostgreSQL üzerinde (pg-boss); Cloudflare önde DNS ve koruma |
| Alan adları | office.armadx.com (panel ve /api, iki şirket için tek giriş), office-test.armadx.com (test), hooks.armadx.com (dış bildirimler) |
| Veritabanı | Supabase PostgreSQL; yalnızca API sunucusu bağlanır; RLS ile şirket ayrımı; dosyalar Supabase depolamasında |
| Kimlik | Google Workspace ile giriş, API üzerinden sunucu tarafında; iki adımlı doğrulama zorunlu |
| Model | Claude API, araç kullanımı ile ajan döngüsü; model adı görev kartından; tekrar eden talimatlarda istem önbelleği |
| Skill'ler | `skills/` altında SKILL.md klasörleri; çalıştırıcı okuyup çağrıya ekler, API'ye yüklenmez |
| Not sistemi | Kurumsal hafıza Obsidian gibi markdown notlar: YAML özellikler, `[[bağlantı]]`, geri bağlantılar, etiketler; kaynak veritabanı |
| Arama | PostgreSQL tam metin arama; gerekirse pgvector |
| Entegrasyonlar | Pilotta Google Workspace (Gmail, Takvim, Drive, Meet kayıtları) ve GitHub; Ekim sonunda Figma |
| PDF | HTML şablondan PDF |
| Gizli anahtarlar | Barındırma sağlayıcısının kasası; ajana anahtar verilmez |
| Kod ve yayın | GitHub, otomatik test ve yayın hattı; test ve canlı ortam ayrı |

## Ağ ve erişim kuralları

Pilotta panel internete açık; ileride yalnızca ofis ağından, dışarıdan VPN ile açılacak (Cloudflare Access ya da AWS özel ağı). Bu geçiş için:

1. Tarayıcı veritabanına bağlanmaz; bütün istekler API'den geçer, Supabase anahtarları yalnızca sunucuda.
2. Panel ve API tek alan adı altında (office.armadx.com).
3. Dışarıdan gelen çağrılar imza doğrulamalı ayrı bir uç noktadan (hooks.armadx.com) girer.
4. Telefon bildirimleri hassas bilgi taşımaz.
5. Ajanların dış servis çağrıları sunucudan çıkar.

## Veri modeli

Her tabloda `sirket_id` zorunlu, RLS açık.

| Tablo | İçerik |
| --- | --- |
| sirketler | Kiracılar: Arma DX, Pillika |
| kullanicilar, uyelikler | Kişi, üyesi olduğu şirketler, rol |
| ajanlar, kart_surumleri | Görev kartı: amaç, talimat, skill'ler, araç izinleri, yetki seviyesi, onay noktaları, model, sınırlar, sürüm geçmişi |
| gorevler | Talep, şirket, proje, atanan (insan ya da ajan), durum, öncelik, son tarih, yorumlar |
| calismalar | Ajan çalışması: girdi, çıktı, araç çağrıları, model, token, maliyet, süre, iç iş ya da proje etiketi |
| onaylar | Onay bekleyen çıktı, özet, risk notu, fark, durum, gerekçe, onaylayan, zaman |
| iz_kaydi | Değiştirilemeyen olay kaydı: kim, ne yaptı, hangi veriye baktı, ne zaman |
| notlar, not_surumleri | Markdown not: klasör yolu, başlık, YAML özellikler, gövde, sürüm, arama dizini; kararlar ve tutanaklar da not türü |
| not_baglantilari | Notlardaki `[[...]]` bağlantıları; geri bağlantılar ve grafik görünümü buradan |
| belgeler | Drive'dan gelen kaynak dosyalar; her biri bir kaynak notuna bağlı |
| istasyon_adaylari | Pillika için toplanan istasyon verisi: kaynak, konum, operatör, soket tipleri, güç, doğrulama durumu, eşleşen kayıt |
| musteriler, firsatlar | Basit müşteri listesi: kurum, kişi, fırsat, aşama, değer, sonraki adım |
| projeler | Proje, müşteri, bütçe, kilometre taşları |
| entegrasyonlar | Bağlantı ayarları ve yetkileri, şirket bazında |

## Durumlar ve roller

Onaylandı. Arayüzde Türkçe adlar, veritabanında parantez içindeki değerler kullanılır.

- Görev durumu: Açık (`acik`), Sürüyor (`suruyor`), Onay bekliyor (`onay_bekliyor`), Tamamlandı (`tamamlandi`), İptal (`iptal`)
- Onay durumu: Bekliyor (`bekliyor`), Onaylandı (`onaylandi`), Düzeltme istendi (`duzeltme_istendi`), Reddedildi (`reddedildi`)

| Rol | Yetki |
| --- | --- |
| Kurucu (`kurucu`) | Bütün şirketleri görür, bütün onayları verir, kullanıcı ve ajan ayarlarını yönetir |
| Çalışan (`calisan`) | Üyesi olduğu şirketin görev ve notlarıyla çalışır; onay yetkisi kurucu verirse açılır |
| Dış kişi (`dis_kisi`) | Mali müşavir ve avukat gibi; yalnızca kendisine açılan görev ve notları görür |

## Ekranlar

Günlük iş listeler, pano ve Onay Masası üzerinden yürür. Üst çubukta şirket seçici var: Arma DX, Pillika ve kurucu için holding görünümü. Telefonda alt menü: Bugün, Onaylar, Görevler, Notlar, Ofis. Tasarım dili CLAUDE.md içinde.

| Ekran | Ne gösterir | Sprint |
| --- | --- | --- |
| Giriş | Google ile giriş | 0 |
| Bugün | Bekleyen onaylar, bugünkü görevler, ajanların son işleri, uyarılar | 2 |
| Onay Masası | Önceliğe göre kuyruk; özet, risk notu, değişiklik farkı; onay, düzeltme, ret | 0 |
| Görevler | Pano ve liste; şirket, birim, ajan ve durum filtresi | 0 |
| Görev ayrıntısı | Talep, ajanın adımları ve araç çağrıları, çıktılar, yorumlar, maliyet | 1 |
| Ajanlar | Birimlere göre ajanlar, durumları, yetki seviyeleri, durdurma düğmesi | 1 |
| Görev kartı | Kart ve skill'ler, sürüm geçmişi, test sonuçları | 1 |
| Notlar | Klasör ağacı, editör, geri bağlantılar, etiketler, arama | 1 |
| Müşteriler | Müşteri ve fırsat listesi | 2 |
| İz kaydı | Kim, ne yaptı, ne zaman; filtreler | 2 |
| Ayarlar | Kullanıcılar ve roller, şirketler, entegrasyonlar | 0 ve 3 |
| Ölçümler | Maliyet, onay oranı, onay bekleme süresi, kazanılan saat | 4 |
| Not grafiği | Notlar arası bağlantıların grafiği | 4 |
| Ofis görünümü | İzometrik ofis haritası: birimler oda, ajanlar masalarında; çalışıyor, onay bekliyor, boşta ve hata durumları | Kasım |

## Modüller

| Kod | Modül | İçerik | Sprint |
| --- | --- | --- | --- |
| M1 | Kimlik ve kiracı | Google ile giriş, şirket seçimi, roller, RLS | 0 |
| M2 | Görev kaydı | Talep, atama, durum, son tarih; pano ve liste | 0 |
| M3 | Onay Masası | Kuyruk, özet, fark, onay, ret, düzeltme, gerekçe; telefonda tek dokunuş | 0 |
| M4 | İz kaydı ve maliyet | Çalışma ve onay kaydı; token ve maliyet; iç iş ve proje ayrımı | 0 |
| M5 | Ajan çalıştırıcı | Kart ve skill yükleme, Claude ile araç döngüsü, kuyruk, zamanlayıcı, olay tetikleyici, yeniden deneme, zaman aşımı, durdurma | 1 |
| M6 | Görev kartı yönetimi | Kart düzenleme, sürümleme, test setini çalıştırma ve karşılaştırma | 1 |
| M7 | Not sistemi | Markdown editörü, `[[` ile not önerisi, geri bağlantılar, etiket ve özellik filtresi, arama, kaynak gösterme; Drive'dan içeri aktarma | 1 |
| M8 | Ofis Koordinatörü | Talebi sınıflandırır, şirketi ve birimi belirler, alt görevlere böler | 1 |
| M9 | Bildirimler | Günlük onay özeti, tarayıcı ve e-posta bildirimi | 2 |
| M10 | Müşteri ve fırsat listesi | Basit CRM | 2 |
| M11 | PDF ve şablonlar | Teklif ve rapor şablonları | 2 |
| M12 | Google Workspace bağlantısı | Drive (Sprint 1); Gmail, Takvim, Meet kayıtları (Sprint 3) | 1 ve 3 |
| M13 | Ölçüm panosu | Onay oranı, onay bekleme süresi, maliyet, kazanılan saat | 4 |
| M14 | Not sistemi ek özellikleri | Grafik görünümü, günlük notlar, şablonlar, Obsidian uyumlu dışa aktarma, MCP sunucusu | 4 |
| M15 | Ofis görünümü | İzometrik ofis haritası: birimler oda, ajanlar masalarında, durumlar renk ve hareketle | Kasım |

## Pilot ajanları

Yetki: Y1 taslak hazırlar, onaysız dışarı çıkmaz; Y2 tanımlı sınır içinde kendisi uygular, sınır dışını onaya gönderir.

| Kod | Ajan | Ne yapar | Yetki | Sprint |
| --- | --- | --- | --- | --- |
| KOR-1 | Ofis Koordinatörü | Talebi alır, şirketini ve birimini belirler, alt görevlere böler, ajanlara dağıtır, sonucu döner | Y2 | 1 |
| KOR-2 | Görev Takip | Görev kaydını tutar, son tarih ve tıkanan işleri izler, hatırlatır | Y2 | 1 |
| KOR-3 | Onay Masası | Onay kuyruğunu özet, risk notu ve farkla sunar, önceliklendirir, günlük onay turunu hazırlar | Y2 | 1 |
| HAF-1 | Bilgi Tabanı | Dokümanları nota aktarır, etiketler ve bağlar; eskimiş ve kopuk notları işaretler; kararları karar notu olarak bağlar | Y2 | 1 |
| HAF-2 | Kurumsal Arama | Soruları notlardan kaynak göstererek yanıtlar; yetkisiz bilgiyi göstermez; bilgi yoksa uydurmaz | Y2 | 1 |
| A-TEK-2 | Teklif | İş kırılımı, ücret kartına göre fiyat, PDF teklif ve zaman çizelgesi; fiyat onayı kurucuda | Y1 | 2 |
| A-PRJ-2 | Proje Takip | Görev kaydı, GitHub ve toplantılardan haftalık durum raporu; müşteriye giden rapor onaydan geçer | Y2 iç, Y1 müşteri | 2 |
| SOS-2 | Sosyal İçerik Yazım | Verilen kaynak bilgiden seçenekli gönderi metinleri ve video senaryoları | Y1 | 2 |
| KOR-4 | Yönetici Asistanı | Gmail ve Takvim üzerinden e-posta önceliklendirme, toplantı brifingi, günlük özet | Y1 | 3 |
| KOR-5 | Toplantı | Meet kaydını yazıya döker; aksiyonları görev kaydına, tutanağı ilgili notlara bağlı not olarak işler | Y2 | 3 |
| A-KES-2 | Süreç Analizi | Görüşme kayıtlarından süreç haritası ve sorun listesi | Y1 | 3 |
| P-IST-1 | İstasyon Veri Toplama | Kaynaklardan istasyon verisini toplar, tek biçime çevirir, tekrarları birleştirir | Y2 | 4 |
| TAS-3 | UI/UX Tasarım | Ekran akışları ve tasarımlar; ilk iş Pillika uygulamasının yeniden tasarımı | Y1 | 4 |
| TAS-6 | Sosyal Medya Görsel | Şablonlardan kanal ölçülerinde gönderi görselleri | Y1 | 4 |

## Skill yapısı

| Dosya | İçerik |
| --- | --- |
| `skills/teklif/SKILL.md` | Ne zaman kullanılacağı ve adım adım çalışma talimatı |
| `skills/teklif/sablonlar/` | Çıktı şablonları |
| `skills/teklif/ornekler/` | Onaylanmış iyi çıktı örnekleri |
| `skills/teklif/testler/` | 10-20 örnek girdi ve kabul ölçütleri |
| `agents/A-TEK-2.yaml` | Görev kartı: skill'ler, araçlar, yetki seviyesi, onay noktaları, model, sınırlar |

Skill içeriği kurucunun verdiği gerçek dokümanlardan yazılır; bilgi uydurulmaz.

## Sprintler

### Sprint 0 · 30 Eylül-3 Ekim

- [ ] Monorepo iskeleti, test ve canlı ortam, otomatik test ve yayın hattı
- [ ] Veri modeli ve RLS; iki şirketin verisinin birbirine görünmediğini doğrulayan test; tarayıcı veritabanına bağlanmaz
- [ ] Google ile giriş, roller ve şirket seçimi (M1)
- [ ] Görev kaydı ve pano (M2)
- [ ] Onay Masası; telefon görünümü (M3)
- [ ] Claude API bağlantısı, çalışma kaydı, iz kaydı ve maliyet ölçümü (M4)
- [ ] Pilot işlerin bugünkü sürelerini ölç: teklif, proje raporu, sosyal medya gönderisi

### Sprint 1 · 4-6 Ekim

- [ ] Ajan çalıştırıcı: kart ve skill yükleme, araç çağrıları, kuyruk, yeniden deneme, durdurma (M5)
- [ ] Görev kartı editörü ve sürümleme (M6)
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

- [ ] Dört hafta boyunca ölçütleri topla: ilk seferde onay oranı, onay bekleme süresi, kazanılan saat, iş başına maliyet
- [ ] Her ajan için yetki yükseltme ya da düzeltme kararı
- [ ] Aşama 2'nin sırasını belirle
- [ ] Ofis görünümü (M15)

## Pilot açılış kontrolleri

- [ ] İki şirketin verisi birbirine görünmüyor; testle doğrulandı
- [ ] Onay telefondan tek dokunuşla veriliyor
- [ ] Dışarı giden her iş onaydan geçiyor; onaysız çıkış yolu yok
- [ ] Her ajan çalışmasının kaydı ve maliyeti panelde görünüyor
- [ ] Her ajanın durdurma düğmesi çalışıyor
- [ ] Gizli anahtarlar kasada; Supabase anahtarları tarayıcıya hiç gitmiyor
- [ ] Yedek alınıyor ve geri yükleme bir kez denendi
- [ ] Her pilot ajanın görev kartı ve test seti hazır

## Testler

| Test | Ne kontrol eder | Ne zaman |
| --- | --- | --- |
| Ajan test seti | Çıktının kabul ölçütlerini karşılaması | Görev kartı her değiştiğinde |
| Şirket ayrımı | Bir şirketin kullanıcısının ve ajanının diğer şirketin verisini görememesi | Her yayında |
| Onay akışı | Dışa etkili hiçbir işin onaysız çıkamaması | Her yayında |
| İstem enjeksiyonu | E-posta ve dokümana gizlenmiş talimatların uygulanmaması | Haftalık ve her yeni bağlantıda |
| Maliyet | Çalışma başına maliyetin beklenen aralıkta kalması | Haftalık |
