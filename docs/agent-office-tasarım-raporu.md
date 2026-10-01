# Agentik Ofis Tasarım Raporu

Sep 29, 2026 · @Ömer Kadıoğlu

Arma DX ve Pillika için birim ve ajan yapısı

## Özet

Agentik ofis, Arma DX ve Pillika'daki işleri 37 birimde toplanan 173 ajan rolüyle karşılıyor. Kurulum 14 ajanlık bir pilotla başlıyor.

18 birim iki şirkette ortak tasarımla ama ayrı veriyle çalışıyor (finans, hukuk, tasarım, sosyal medya, yazılım geliştirme gibi). 8 birim Arma DX'in danışmanlık ve proje işine, 11 birim Pillika'nın ürünlerine özel. Her ajanın bir insan sorumlusu, bir yetki seviyesi ve bir devreye alma aşaması var.

| Grup | Birim | Ajan | Aşama 1 Pilot | Aşama 2 Çekirdek | Aşama 3 Uzmanlaşma | Aşama 4 Genişleme |
| --- | --- | --- | --- | --- | --- | --- |
| Ortak birimler | 18 | 100 | 10 | 32 | 47 | 11 |
| Arma DX | 8 | 32 | 3 | 6 | 15 | 8 |
| Pillika | 11 | 41 | 1 | 5 | 24 | 11 |
| Toplam | 37 | 173 | 14 | 43 | 86 | 30 |

173 sayısı bir rol kataloğu, 173 ayrı yazılım değil. Uygulamada her birim, rollerini yetenek olarak yükleyen az sayıda ajanla çalışabilir; ayrıntısı Platform Mimarisi bölümünde. Aynı katalog ileride Arma DX'in başka firmalara kuracağı ofislerin de temeli olacak.

Pilot üç şeyi kanıtlamak için seçildi: koordinasyon omurgasının çalıştığını, kurumsal hafızanın doğru yanıt verdiğini ve iki şirkette de ölçülebilir zaman kazancı sağlandığını. Arma DX tarafında süreç analizi, teklif ve proje takibi, Pillika tarafında istasyon verisi yer alıyor; arayüz tasarımı ile sosyal medya içeriği ve görselleri iki şirkete birlikte hizmet veriyor.

Ofis, kurucunun geliştirip işleteceği Agent Office web paneli üzerinde, Claude modelleriyle ve bulutta çalışacak; başlangıçta bütün onaylar kurucuda. Geliştirme adımları ve sprint takvimi: Geliştirme Planı

## Kapsam ve Varsayımlar

Ofis iki ayrı şirketin iç kullanımı için tasarlandı: Arma Grup Teknoloji A.Ş. (Arma DX) ve Pillika Enerji ve Teknoloji A.Ş. Altyapı ortak, veri ayrı. Arma DX'in başka firmalara ofis kurması sonraki bir aşama.

İki şirketin çalışanları ofisle aynı kapıdan konuşur. Her talep hangi şirkete aitse o şirketin verisi, bilgi tabanı ve ajanlarıyla yürür. Müşterilere teslim edilen yazılımlar ofisin parçası değil; ofis, Arma DX'in bu işleri daha hızlı ve düzenli yapmasına yardım eder.

Her şirkette kurucu dahil yaklaşık üç kişi var. Ofisi kurucu geliştirip işletecek ve başlangıçta bütün onayları kendisi verecek; onay yetkisi zamanla ekibe devredilecek. Bu yüzden onaylar günde bir ya da iki toplu turda ve telefon dahil her cihazdan verilir, düşük riskli işler ölçülen başarıya göre daha hızlı Y2'ye geçer.

Muhasebe dış destekle sürecek, sosyal medya ofise geçecek. Hukukta gerektiğinde çağrılan bir avukatla çalışılacak; ajanların hazırladığı sözleşme ve KVKK metinleri imzadan önce ona gider.

Aşağıdaki tabloda doğrulanan bilgiler ve kalan varsayımlar birlikte duruyor; Durum sütunu güncel hâli gösterir.

| Bilgi ya da varsayım | Durum | Etkisi |
| --- | --- | --- |
| Her şirkette kurucu dahil yaklaşık üç kişi var | Doğrulandı | Birim sorumluları çoğunlukla aynı kişiler; işin asıl yükünü ajanlar taşır |
| Ofisi kurucu geliştirip işletecek; başlangıçta bütün onaylar kurucuda, yetki zamanla ekibe devredilecek | Doğrulandı | Onay Masası tek kişiye göre kurulur: toplu onay turları, önceliklendirme, telefondan onay |
| Muhasebe dış destekle sürecek; hukukta gerektiğinde çağrılan bir avukatla çalışılacak; sosyal medya ofise geçecek | Doğrulandı | Finans ajanları mali müşavirle çalışır, sosyal medya pilotta başlar, hukuki metinler imzadan önce avukata gider |
| Ekip ofisle Agent Office web paneli üzerinden çalışacak; panel her cihazdan erişilebilir olacak | Doğrulandı | Arayüz katmanı ve onay akışı |
| Görev takibi ve basit müşteri listesi web panelin içinde kurulacak; Jira gibi araçlara yalnızca bir müşteri projesi gerektirirse bağlanılacak | Doğrulandı | Pilotta ayrı araç alınmaz; müşteri listesi zamanla kendi CRM'inize dönüşür |
| Ajanlar Claude modelleriyle çalışacak; ana dil Türkçe, İngilizce ve Arapça seçenek | Doğrulandı | Model katmanı, yerelleştirme ve maliyet |
| Gündelik sabit iç işler (e-posta takibi, çağrı merkezi desteği gibi) için ayrı bir üst sınır yok, mevcut hesap limitleri içinde çalışılır, ileride ek kredi düşünülür; proje işlerinin maliyeti o projenin bütçesine bağlı | Doğrulandı | Harcama iç işler ve projeler olarak ayrı izlenir; panel Claude'u API ile kullandığı için fatura claude.ai aboneliğinden ayrıdır |
| Pillika'nın bütün ürünleri geliştirme aşamasında; uygulama arayüz tasarımından başlayarak yeniden geliştirilecek, ADS sonraki aşamada | Doğrulandı | Pillika ajanlarının aşamaları; arayüz tasarımı pilotta |
| Pillika Barrier'ın donanımını Kutech geliştirip üretecek; dış dünyaya açılan işlemcinin yazılımı, kurulum, entegrasyon ve pazarlama Pillika'da; bütün proje dosyaları ve haklar Kutech'ten Pillika'ya devredilecek | Doğrulandı | Donanım ve Tedarik Zinciri birimlerinin kapsamı |
| Kullanılan yazılımlar netleşti; süreç bazındaki liste Açık Sorular bölümünde | Doğrulandı | Entegrasyon sırası |
| Barındırma projeye göre AWS ya da Cloudflare Workers; veritabanı Supabase ya da sunucuda kurulu veritabanı; alan adları İHS'de, DNS Cloudflare'de | Doğrulandı | Ofis altyapısı da bu seçeneklerden biriyle kurulur |
| Ofisin verisi bulutta, şirket bazında ayrılmış veritabanında tutulacak | Doğrulandı | Panel dünyanın her yerinden, her cihazdan erişilebilir olur; kişisel verinin yurt dışı aktarımı avukatla netleştirilir |
| Kamu kurumu gibi bazı müşteriler verilerinin Türkiye dışına çıkmamasını şart koşabilir | Varsayım | Bu müşterilerin işlerinde Türkiye'de ya da müşterinin sunucusunda çalışan model gerekir |

## Tasarım İlkeleri

Ofisin davranışını on bir ilke belirliyor. En önemlisi: dışarıya giden ya da geri alınamayan her iş, başlangıçta insan onayından geçer.

| İlke | Ne anlama geliyor |
| --- | --- |
| Her ajanın insan sorumlusu var | Ajan işi yürütür, sonucun hesabını insan verir. Sorumlu kişi ajanı her an durdurabilir ya da işi devralabilir. |
| Dışarıya giden her şey onaydan geçer | Müşteriye giden e-posta, fiyat, sözleşme, ödeme, canlı ortama yayın ve kamuya açık paylaşım başlangıçta insan onayı ister. |
| Dar görev, net sınır | Her ajanın tek bir işi, tanımlı girdisi ve çıktısı var. Her şeyi yapan ajan kurulmaz, çünkü test etmesi ve güvenmesi zor. |
| Şirket verisi ayrı | Arma DX ve Pillika'nın verisi, bilgi tabanı ve kayıtları birbirine karışmaz. İki şirketi birlikte gören tek yer, yetkili yöneticilerin özet görünümü. |
| Müşteri verisi daha da ayrı | Arma DX'te her müşteri projesinin verisi kendi alanında durur. Bir müşterinin bilgisi başka bir müşterinin işinde kullanılmaz. |
| Her adım kayıtlı | Kim istedi, hangi veriye bakıldı, ne üretildi, kim onayladı; hepsi iz kaydında tutulur. |
| Kaynak gösteren yanıt | Ajan bilgiyi kurumsal hafızadan kaynağıyla verir. Bilmediğini uydurmaz; eksiği sorar ya da işaretler. |
| Yetki kazanılır | Ajan düşük yetkiyle başlar. Hata oranı ölçüldükçe yetkisi artar. |
| Maliyet görünür | Her ajanın model kullanımı ve maliyeti izlenir. Rutin işte hızlı ve ucuz model, zor işte güçlü model kullanılır. |
| Tek dil, tek standart | Ajan çıktıları yazım kurallarına, marka diline ve doküman şablonlarına uyar. Farklı ajanların ürettiği dokümanlar birbiriyle tutarlı olur. |
| Kodla değil ayarla tanımlanır | Her ajan bir görev kartıyla tanımlanır: talimat, araç izni, yetki seviyesi, onay noktaları. Bu yapı ofisi başka firmalara kurmayı da mümkün kılar. |

## Yetki Seviyeleri

Her ajan dört yetki seviyesinden birinde çalışır. Ajanların çoğu Y1 ile başlar ve ölçülen başarıya göre bir üst seviyeye geçer.

| Seviye | Ad | Ajan ne yapar | İnsan ne yapar | Örnek ajanlar |
| --- | --- | --- | --- | --- |
| Y0 | Danışman | Analiz eder, öneri ve rapor üretir. Hiçbir sistemde değişiklik yapmaz. | Öneriyi okur, kararı verir. | Nakit ve Bütçe, Şartname Analiz |
| Y1 | Taslakçı | Taslak ve çıktı hazırlar. Onay gelmeden dışarı göndermez, sisteme yazmaz. | Onay Masası'nda onaylar, düzeltir ya da reddeder. | Sözleşme, Teklif |
| Y2 | Denetimli uygulayıcı | Tanımlı sınırlar içinde kendisi uygular: iç kayıt açma, iç bildirim, sınırın altındaki iade gibi. Sınır dışındaki işi onaya gönderir. | Sınırları belirler, işleri örnekleyerek sonradan denetler. | Görev Takip, Canlı Destek |
| Y3 | Otonom | Rutin işi tamamen kendisi yürütür, yalnızca istisnaları bildirir. Sadece okuma ve izleme işlerinde kullanılır. | İstisna bildirimlerini ele alır. | Rapor ve Pano, İhale Tarama |

Tablolarda "Y1 → Y2" yazan ajan Y1 ile başlar, hedefi Y2'dir.

Önerilen yükseltme kuralı: ajan en az 50 işte ilk seferde yüzde 95 onay oranına ulaşır ve son 30 günde kritik hata yapmazsa bir üst seviyeye önerilir; kararı birim sorumlusu, başlangıçta kurucu verir. Kritik bir hata ajanı hemen bir seviye düşürür ve vaka incelenir. Eşikler pilotta gerçek veriyle ayarlanacak.

Bazı işler hiçbir koşulda ajana bırakılmaz ve bu işlerde ajan en fazla Y1 olur: para transferi, imza ve taahhüt, resmi kurumlara yapılan başvuru ve beyanlar, kişisel verinin silinmesi ya da üçüncü kişiye aktarılması.

## Ofis Yapısı

Ofis dört katmandan oluşur: ekip, koordinasyon katmanı, üç grupta toplanan birimler ve kurumsal hafıza.

&#91;embedded content: ofis yapısı · 4 katman, 37 birim\]

Birim kodu, ajan kodunun önekidir: A-KES-2, Keşif ve Dönüşüm Danışmanlığı biriminin ikinci ajanı. Ofis Yönetimi ve Denetim birimi diğer ajanların kalitesini ve maliyetini izler.

### Birim Taraması

Birim listesi, bir teknoloji grubunda olması gereken işlevler tek tek taranarak çıkarıldı. Aşağıdaki tablo ayrı birim olarak değerlendirilen adayları ve kararları gösteriyor; Karar sütunundan değiştirilebilir.

| Birim adayı | Karar | Gerekçe |
| --- | --- | --- |
| Tasarım ve Kreatif Stüdyo (TAS) | Eklendi | Marka, arayüz, prototip, sosyal medya görseli, video ve baskı tasarımı iki şirkette de sürekli iş; tek birimde toplanınca tasarım dili tutarlı kalır. |
| Sosyal Medya (SOS) | Eklendi | Strateji, içerik, yayın, topluluk ve itibar takibi günlük bir iş yükü; bugün dışarıdan alınan sosyal medya hizmeti bu birime geçecek. |
| Kurumsal İletişim (KIL) | Eklendi | Basın, kriz iletişimi ve yönetici görünürlüğü reklamdan farklı bir iş; Pillika'da hizmet kesintisi gibi durumlar için hazır mesaj gerekir. |
| Altyapı ve Bulut Operasyonları (ALT) | Eklendi | Pillika kesintisiz çalışan canlı bir hizmet olacak, Arma DX de müşteri sistemlerini barındırabilir; canlı işletim geliştirmeden ayrı bir sorumluluk. |
| Donanım ve Gömülü Sistemler (DON) | Eklendi | Donanım geliştirme ve üretim Kutech'te; Pillika'da dış dünyaya açılan işlemcinin yazılımı, geliştirme takibi, sertifikasyon ve üretici ilişkisi kalıyor. |
| Tedarik Zinciri ve Lojistik (TED) | Eklendi | Kutech'ten teslim alınan bariyerlerin stok, sevkiyat, garanti ve ileride ihracat işleri doğuyor. |
| Ürün ve Çözüm Kataloğu, Arma DX (A-KAT) | Eklendi | Projelerde geliştirilen modülleri başka müşterilere uyarlamak teslim süresini kısaltır, kârlılığı artırır; agentik ofisin ürünleşmesi de burada yönetilir. |
| Ar-Ge ve İnovasyon | Açılmadı | Şirketler teknokent ya da Ar-Ge merkezi kapsamında değil; teknoloji takibi Strateji'de, teşvikler Teşvik ve Hibe Ajanında, geliştirme işleri AI Çözümleri ve Donanım birimlerinde. |
| Kalite Güvence ve Test | Açılmadı | Test Ajanı yazılım biriminde kalıyor; ekip ve proje sayısı büyüdüğünde ayrı birim olur. |
| Holding Yönetim Ofisi | Açılmadı | Yönetici Asistanı, Holding Rapor Ajanı ve Grup İçi İşlemler Ajanı bu işi karşılıyor. |
| Pillika Operasyon Merkezi | Açılmadı | Canlı izleme işleri Şarj Oturumu İzleme, Canlı Destek, Olay Müdahale ve Cihaz İzleme ajanlarında; hepsi aynı olay akışını paylaşıyor. |
| Kurumsal ve Filo Müşterileri, Pillika | Açılmadı | Filo şirketlerine şarj hesabı sunmak ilerleyen dönemde gündeme gelebilir; o zaman ayrı bir satış birimi açılır. |

Taramada mevcut birimlere 11 rol eklendi: Çeviri (HAF-4), Fiyatlandırma (STR-5), Grup İçi İşlemler (FIN-7), Risk ve Kurumsal Sigorta (FIN-8), Dava ve İcra Takip (HUK-8), Tüketici Hukuku (HUK-9), İSG (IK-6), Dış Kaynak ve Serbest Çalışan (SAI-4), Entegrasyon Mühendisliği (YAZ-8), İçerik Moderasyon (P-IST-5), Bayi ve Distribütör (P-BAR-6). Görsel tasarım, sosyal medya, basın, arayüz tasarımı, prototip, yayın, olay müdahalesi ve donanım geliştirme rolleri yeni birimlerine taşındı.

## Ortak Birimler

Ortak birimler iki şirkette aynı görev kartlarıyla ama ayrı veri ve ayrı insan sorumlularıyla çalışır. 18 birimde 100 rol var ve her şirket ihtiyaç duyduğu rolleri açar. İki şirketi birlikte görebilen roller yalnızca Ofis Koordinatörü, Yönetici Asistanı, Holding Rapor Ajanı ve Grup İçi İşlemler Ajanı; bunu da sadece yetki verilen kişiler için yapar.

Ekipler küçük olduğu için birim paragraflarındaki sorumlu unvanları kişi değil rol adıdır. Birçok birimin sorumlusu aynı kişi olabilir.

### Koordinasyon Katmanı (KOR)

Koordinasyon katmanı ofisin tek giriş noktası: talepleri Agent Office web panelinden alır, doğru birime dağıtır ve işi sonuna kadar takip eder. Sorumlusu kurucu; bağlandığı yerler web paneli, panelin içindeki görev kaydı, e-posta ve takvim. Başarısı; talebin ilk seferde doğru birime gitme oranı, onay bekleme süresi ve kaçan son tarih sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| KOR-1 | Ofis Koordinatörü | Ekipten gelen her talebi tek noktadan alır. Hangi şirkete ve hangi birime ait olduğunu belirler, çok adımlı işleri alt görevlere böler, ilgili ajanlara dağıtır, sonuçları birleştirip talep sahibine döner. | Y2 | 1 |
| KOR-2 | Görev Takip Ajanı | Web panelin içindeki görev kaydında insanlara ve ajanlara atanan bütün işleri tutar. Son tarihleri, bekleyen onayları ve tıkanan işleri izler; hatırlatma gönderir, geciken işi sorumlusuna bildirir. | Y2 | 1 |
| KOR-3 | Onay Masası Ajanı | Onay bekleyen bütün işleri tek kuyrukta toplar, her birini kısa özet, risk notu ve değişiklik farkıyla sunar; önceliğe göre sıralar ve günlük toplu onay turları için paketler. Onay telefondan da tek dokunuşla verilir; onay, ret ve düzeltme gerekçeleri ajanların iyileştirilmesinde kullanılır. | Y2 | 1 |
| KOR-4 | Yönetici Asistanı Ajanı | Gmail ve Google Takvim üzerinden yöneticilerin takvimini, e-posta önceliklendirmesini ve takip listesini yönetir. Toplantı öncesi brifing, günlük ve haftalık özet hazırlar; verilen sözleri ve bekleyen yanıtları izler. | Y1 → Y2 | 1 |
| KOR-5 | Toplantı Ajanı | Toplantı öncesi gündem ve ilgili dokümanlardan brifing hazırlar. İzin varsa Google Meet kaydını yazıya döker; tutanak, kararlar ve aksiyon maddelerini çıkarıp görev kaydına işler, tutanağı ilgili müşteri ve proje notlarına bağlı bir not olarak kaydeder. | Y2 | 1 |

### Ofis Yönetimi ve Denetim (OFY)

Bu birim ajanların kendisini yönetir: çıktı kalitesini, maliyeti ve iyileştirmeyi. Sorumlusu ofisi işleten kurucu; bağlandığı yerler iz kaydı, Onay Masası kayıtları ve model kullanım verisi. Başarısı; ilk seferde onay oranının artışı, iş başına maliyet ve tekrarlanan hata sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| OFY-1 | Kalite Denetim Ajanı | Ajan çıktılarından düzenli örnek alır; doğruluk, kaynak gösterme, yazım, marka dili ve kurallara uyum açısından puanlar. Kalite düşüşlerini ve tekrar eden hata türlerini erken yakalayıp raporlar. | Y0 | 2 |
| OFY-2 | Maliyet ve Kullanım Ajanı | Her ajanın model kullanımını, iş sayısını ve maliyetini izler; harcamayı iç işler ve projeler olarak ayırır, proje maliyetini ilgili projenin bütçesine yazar. Bütçe aşımında uyarır; daha ucuz model, önbellek ya da iş birleştirme gibi tasarruf fırsatları önerir. | Y3 | 2 |
| OFY-3 | İyileştirme ve Sürüm Ajanı | Ret gerekçelerinden, kalite puanlarından ve kullanıcı geri bildirimlerinden görev kartları için iyileştirme önerir. Yeni sürümü yayına almadan önce test senaryolarıyla dener ve eski sürümle karşılaştırır. | Y1 | 2 |

### Kurumsal Hafıza (HAF)

Kurumsal hafıza, panelin içinde Obsidian gibi çalışan ve birbirine bağlı markdown notlardan oluşur; ajanlar ve insanlar aynı notları okur ve yazar, bu birim zayıf kalırsa diğer bütün ajanlar da zayıf kalır. Sorumlusu her şirketten bir bilgi sahibi; bağlandığı yerler paneldeki not sistemi, Google Drive ve e-posta ekleri. Başarısı; yanıtların kaynak gösterme oranı, yanıtsız kalan soruların kapanma süresi ve eskimiş ya da hiçbir yere bağlı olmayan not sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| HAF-1 | Bilgi Tabanı Ajanı | Şirket dokümanlarını not sistemine aktarır, notları etiketler ve birbirine bağlar; eskimiş, çelişen ya da hiçbir yere bağlı olmayan notları işaretler. Şirket profili, ürün bilgileri, fiyat listeleri ve politikalar için tek doğru kaynak sayfalarını güncel tutar. Toplantı ve yazışmalardaki kararları karar notu olarak ilgili proje ve müşteri notlarına bağlar. | Y2 | 1 |
| HAF-2 | Kurumsal Arama Ajanı | Çalışanların ve diğer ajanların sorularını kaynak göstererek yanıtlar; kişinin erişim yetkisi olmayan bilgiyi göstermez. Yanıt yoksa uydurmaz, eksiği Bilgi Tabanı Ajanına iletir. | Y2 | 1 |
| HAF-3 | Doküman Standartları Ajanı | Dokümanların şablon, adlandırma, sürüm, marka ve yazım kurallarına uygunluğunu denetler. Aynı bilginin farklı dokümanlarda farklı yazıldığı yerleri bulup düzeltme önerir. | Y1 | 3 |
| HAF-4 | Çeviri Ajanı | Sözleşme, teklif, sunum ve dokümanları şirket terim sözlüğüne bağlı kalarak İngilizce ve Arapçaya çevirir; yabancı dilde gelen dokümanları Türkçeye aktarır. Hukuki metinlerin çevirisi insan kontrolünden geçer. | Y1 | 3 |

### Strateji ve Yönetim (STR)

Strateji birimi yönetimin karar vermesi için gereken dış bilgiyi ve hedef takibini sağlar. Sorumlusu genel müdür; bağlandığı yerler haber ve sektör kaynakları, hedef takip tablosu ve destek programı duyuruları. Başarısı; zamanında yakalanan fırsat ve risk sayısı ile kazanılan destek tutarıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| STR-1 | Pazar ve Rakip İstihbaratı Ajanı | Rakipleri, sektör haberlerini, yeni oyuncuları, teknoloji eğilimlerini ve fiyat hareketlerini izler. Arma DX için dijital dönüşüm ve AI pazarını, Pillika için şarj ve mobilite pazarını takip eder; haftalık bülten ve önemli gelişmelerde anlık not üretir. | Y0 | 3 |
| STR-2 | Hedef ve OKR Takip Ajanı | Şirket ve birim hedeflerini, ölçütlerini ve sorumlularını kayıtta tutar. İlerlemeyi kaynak sistemlerden toplar, sapan hedefleri çeyrek sonunu beklemeden raporlar. | Y2 | 3 |
| STR-3 | Yatırımcı İlişkileri Ajanı | Yatırımcı sunumunu, dönemsel yatırımcı bültenini ve veri odası dokümanlarını hazırlar, yatırımcı sorularına yanıt taslağı yazar. Görüşme ve süreç takibini yapar. | Y1 | 4 |
| STR-4 | Teşvik ve Hibe Ajanı | TÜBİTAK, KOSGEB, kalkınma ajansı, teknokent, ihracat destekleri ve AB programlarındaki çağrıları tarar, şirket projeleriyle eşleştirir. Başvuru taslağı hazırlar; kabul edilen projelerin raporlama ve harcama yükümlülüklerini takip eder. | Y1 | 3 |
| STR-5 | Fiyatlandırma Ajanı | Arma DX'in ücret kartını ve bakım fiyatlarını, Pillika'nın komisyon, API paketi, reklam ve bariyer fiyatlarını maliyet, rakip ve kullanım verisiyle düzenli gözden geçirir. Fiyat değişikliği senaryolarını ve etkilerini hazırlar; karar yönetimde kalır. | Y0 | 3 |

### Finans ve Muhasebe (FIN)

Finans birimi faturadan nakit tahminine kadar para akışının kaydını ve takibini yürütür; para hareketi hiçbir zaman ajana bırakılmaz. Muhasebe mali müşavirde kaldığı için ajanlar onun ihtiyaç duyduğu belge ve veri paketlerini hazırlar; bağlandığı yerler Uyumsoft (ön muhasebe ve e-Fatura), banka hesap dökümleri ve mali müşavirle paylaşılan klasörler. Başarısı; fatura kesim süresi, gecikmiş alacak oranı, mutabakat farkı ve ay sonu kapanış süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| FIN-1 | Fatura Ajanı | Sözleşme, hakediş ve kullanım verisinden kesilecek faturaları hazırlar: Arma DX'te proje ve bakım bedelleri, Pillika'da API aboneliği, reklam ve bariyer satışı. e-Fatura ve e-Arşiv kurallarını ve döviz bazlı sözleşmelerde kur farkını kontrol eder, onaydan sonra entegratör üzerinden keser. Gelen faturaları sipariş ve sözleşmeyle eşleştirir. | Y1 | 2 |
| FIN-2 | Tahsilat ve Cari Ajanı | Alacakları vade bazında izler, kademeli hatırlatma yazıları hazırlar, cari hesap mutabakatlarını yürütür. Ödeme alışkanlığı bozulan müşterileri işaretler. | Y1 → Y2 | 2 |
| FIN-3 | Ödeme ve Gider Ajanı | Tedarikçi faturalarını ve çalışan masraf belgelerini (fotoğraftan okuma dahil) toplar, kategorize eder, bütçe ve politika kontrolünden geçirir. Ödeme listesini onaya sunar; para transferi yapmaz. | Y1 | 2 |
| FIN-4 | Banka Mutabakat Ajanı | Banka hareketlerini her gün muhasebe kayıtlarıyla eşleştirir. Eşleşmeyen kalemleri açıklamasıyla listeler, tahsilat ve ödeme kayıtlarını günceller. | Y2 | 2 |
| FIN-5 | Nakit ve Bütçe Ajanı | 13 haftalık nakit akışı tahmini yapar, bütçe ile gerçekleşeni karşılaştırır, sapmaları gerekçesiyle açıklar. Nakit sıkışması riskini önceden bildirir. | Y0 | 3 |
| FIN-6 | Vergi Takvimi Ajanı | KDV, muhtasar, geçici vergi, e-Defter ve SGK sürelerini takip eder. Mali müşavir için veri ve belge paketlerini hazırlar, eksikleri önceden bildirir; beyanname vermez. | Y1 | 2 |
| FIN-7 | Grup İçi İşlemler Ajanı | Şirketler arası hizmetleri ve ortak giderleri (ofis ajanlarının maliyeti dahil) paylaştırır, grup içi fatura taslaklarını hazırlar. Transfer fiyatlandırması dokümantasyonu için veri paketini mali müşavire aktarır. | Y1 | 3 |
| FIN-8 | Risk ve Kurumsal Sigorta Ajanı | Şirketlerin kendi sigortalarını (mesleki sorumluluk, ürün sorumluluk, siber, işyeri, araç) ve yenileme tarihlerini takip eder. Yeni iş ve ürünlerde teminat ihtiyacını çıkarır, hasar dosyalarını izler. | Y1 | 3 |

### Hukuk ve Uyum (HUK)

Hukuk birimi sözleşme, kişisel veri ve mevzuat işlerini hazırlar ve takip eder; hukuki metinler imzadan önce bir avukatın kontrolünden geçer. Sorumlusu kurucu, gerektiğinde çağrılan bir avukatla birlikte; bağlandığı yerler sözleşme arşivi, VERBİS kayıtları, Resmî Gazete ve düzenleyici kurum duyuruları. Başarısı; sözleşme inceleme süresi, kaçırılan yasal ya da sözleşmesel süre sayısı ve KVKK başvurularının yasal sürede kapanma oranıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| HUK-1 | Sözleşme Ajanı | Şablonlardan sözleşme taslağı hazırlar: gizlilik, hizmet, bakım ve SLA, bayilik, API kullanım şartları, reklam sözleşmesi. Karşı taraftan gelen sözleşmeyi şirketin standart pozisyonlarına göre inceler; sorumluluk sınırı, fikri mülkiyet, cezai şart ve fesih gibi riskli maddeleri işaretleyip değişiklik önerir. İleride online imza platformuna geçildiğinde imza akışını da takip eder. | Y1 | 2 |
| HUK-2 | Sözleşme Takip Ajanı | İmzalı sözleşmelerdeki yükümlülükleri, yenileme ve fesih bildirim tarihlerini, SLA taahhütlerini ve teminatları takvime döker. Süre yaklaşınca ilgili kişileri uyarır. | Y2 | 2 |
| HUK-3 | KVKK Ajanı | Kişisel veri envanterini ve VERBİS kayıtlarını güncel tutar, aydınlatma ve açık rıza metinlerini hazırlar. İlgili kişi başvurularını yasal sürede kapanacak şekilde takip eder, veri ihlalinde bildirim adımlarını yürütür. Pillika'da kullanıcı, konum ve ödeme verisi nedeniyle kritik. | Y1 | 2 |
| HUK-4 | Mevzuat Takip Ajanı | Resmî Gazete ile EPDK, KVKK, Kamu İhale Kurumu, ödeme hizmetleri ve sigortacılık düzenlemelerini izler. Her değişikliğin hangi şirketi ve hangi süreci etkilediğini kısa notla bildirir. | Y3 | 3 |
| HUK-5 | Fikri Mülkiyet Ajanı | Marka tescil ve izleme işlerini, yazılım lisans uyumunu ve sözleşmelerdeki fikri mülkiyet maddelerini takip eder. Bariyer patentinin ve bütün proje haklarının Kutech'ten Pillika'ya devrini izler; Arma DX'in bir müşteri için geliştirdiği bileşenin başka yerde kullanılıp kullanılamayacağını sözleşmeye göre değerlendirir. | Y0 | 3 |
| HUK-6 | Şirket Sekreterya Ajanı | Yönetim kurulu ve genel kurul kararlarının, ticaret sicil işlemlerinin, imza sirkülerinin, vekaletnamelerin ve KEP yazışmalarının kaydını ve takvimini tutar. | Y1 | 4 |
| HUK-7 | Uyum ve Sertifikasyon Ajanı | ISO 27001 ve ISO 9001 gibi belgeler için politikaları, kontrol kanıtlarını ve iç denetim takvimini yönetir, bulguların kapanışını izler. Kamu ihalelerinde istenen belgelerin geçerliliğini takip eder. | Y1 | 3 |
| HUK-8 | Dava ve İcra Takip Ajanı | Avukatla birlikte dava, arabuluculuk ve icra dosyalarının sürelerini, duruşma tarihlerini ve belgelerini takip eder. Vadesi uzun süre geçmiş alacaklar için icra öncesi dosyayı hazırlar. | Y1 | 4 |
| HUK-9 | Tüketici Hukuku Ajanı | Pillika'nın kullanım koşullarını, mesafeli sözleşme ve ön bilgilendirme metinlerini ve iade koşullarını güncel tutar. Tüketici şikâyetlerinde ve Tüketici Hakem Heyeti başvurularında yanıt taslağı hazırlar. | Y1 | 3 |

### İnsan Kaynakları (IK)

İnsan kaynakları birimi işe alımdan ayrılışa kadar çalışan süreçlerinin yazışma ve takip yükünü alır; işe alım ve değerlendirme kararları insanda kalır. Sorumlusu İK sorumlusu ya da bu işi yürüten yönetici; bağlandığı yerler ilan siteleri, bordro sağlayıcısı, SGK bildirim takvimi ve çalışan el kitabı. Başarısı; pozisyon doldurma süresi, oryantasyon tamamlanma oranı ve çalışan sorularının yanıt süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| IK-1 | İşe Alım Ajanı | İş tanımı ve ilan metni hazırlar, başvuruları insanların belirlediği kriterlere göre ön değerlendirir; nihai kararı insan verir. Mülakat planı, soru setleri ve değerlendirme formları çıkarır, adaylarla iletişimi ve süreç takibini yürütür. | Y1 | 3 |
| IK-2 | Oryantasyon Ajanı | Yeni çalışan için başlangıç öncesi listeyi (hesaplar, ekipman, SGK işe giriş), ilk hafta planını ve şirketi tanıtan bilgi paketini hazırlar. Ayrılışta hesap kapatma ve zimmet iadesini takip eder. | Y2 | 3 |
| IK-3 | Personel İşlemleri Ajanı | İzin, puantaj ve bordro girdilerini, özlük dosyası eksiklerini ve zimmetleri takip eder. Bordro için mali müşavire veri paketi hazırlar. | Y1 | 3 |
| IK-4 | Performans ve Gelişim Ajanı | Kişisel hedef takibini, değerlendirme dönemlerini, birebir görüşme hazırlıklarını ve eğitim planlarını destekler. | Y0 | 4 |
| IK-5 | Çalışan Destek Ajanı | Çalışanların izin, masraf, yan hak ve şirket politikaları hakkındaki sorularını el kitabından kaynak göstererek yanıtlar, talepleri ilgili akışa yönlendirir. Şirket içi duyuruları hazırlar. | Y2 | 3 |
| IK-6 | İSG Ajanı | İş sağlığı ve güvenliği risk değerlendirmesini, zorunlu eğitimleri, sağlık muayenesi takvimini ve kaza ile ramak kala kayıtlarını takip eder. Saha kurulumları için İSG kontrol listesini sağlar. | Y1 | 3 |

### Bilgi Teknolojileri ve Güvenlik (BT)

BT birimi çalışanların ve ajanların erişimlerini, cihazları ve güvenlik izlemeyi yönetir. Sorumlusu BT ya da güvenlik sorumlusu; bağlandığı yerler Google Workspace yönetimi, AWS ve Cloudflare hesapları, e-posta güvenliği ve yedekleme. Başarısı; erişim taleplerinin karşılanma süresi, gözden geçirilmemiş yetki sayısı ve güvenlik olaylarına ilk müdahale süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| BT-1 | BT Destek Ajanı | Hesap açma, yetki talebi, şifre sıfırlama yönlendirmesi, yazılım kurulumu ve cihaz sorunlarında ilk desteği verir. Çözemediğini kaydıyla birlikte BT sorumlusuna aktarır. | Y2 | 3 |
| BT-2 | Erişim Yönetimi Ajanı | İşe giriş, rol değişikliği ve ayrılışlarda erişim değişikliklerini hazırlar, dönemsel yetki gözden geçirmelerini yürütür. Ajanların araç ve veri izinlerini de aynı disiplinle yönetir. | Y1 | 2 |
| BT-3 | Güvenlik İzleme Ajanı | Bulut, alan adı, e-posta ve cihaz güvenlik uyarılarını izler; oltalama bildirimlerini inceler, kullanılan yazılımlardaki açık duyurularını takip eder. Olay anında ilk müdahale kontrol listesini başlatır. | Y0 → Y2 | 3 |
| BT-4 | Varlık ve Lisans Ajanı | Donanım envanterini, yazılım aboneliklerini ve kullanıcı sayılarını, alan adı ve sertifika yenilemelerini takip eder. Kullanılmayan lisansları ve tasarruf fırsatlarını raporlar. | Y2 | 4 |
| BT-5 | Yedekleme ve Süreklilik Ajanı | Yedeklerin alındığını ve geri dönülebilir olduğunu düzenli kontrol eder. İş sürekliliği planını güncel tutar, tatbikat takvimini yürütür. | Y2 | 4 |

### Pazarlama (PAZ)

Pazarlama birimi iki şirketin kampanya, içerik, web ve reklam işlerini yürütür; sosyal medya, tasarım ve kurumsal iletişim kendi birimlerinde. Sorumlusu pazarlama kararlarını veren kişi; bağlandığı yerler web siteleri, reklam panelleri ve paneldeki müşteri listesi. Başarısı; kampanya takvimine uyum, içerik başına üretim süresi, web trafiği ve dönüşüm ile reklamla edinilen müşteri başına maliyetle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| PAZ-1 | Kampanya ve İçerik Planlama Ajanı | Kanallar arası kampanya takvimini, temaları ve içerik planını hazırlar; lansman, etkinlik ve sektör gündemiyle eşleştirir. Sosyal medya planı bu takvimden beslenir. | Y1 | 2 |
| PAZ-2 | Metin Yazım Ajanı | Blog, bülten, web sitesi ve vaka çalışması metinlerini yalnızca verilen kaynak bilgiye dayanarak yazar. Birden fazla seçenek sunar, marka dilini ve yazım kurallarını uygular. | Y1 | 2 |
| PAZ-3 | SEO ve Web Ajanı | Anahtar kelime ve içerik boşluğu analizi, sayfa içi SEO denetimi, site sağlığı ve hız kontrolü yapar. Web sitelerinde eskimiş içeriği işaretler. | Y1 | 3 |
| PAZ-4 | Performans Pazarlama Ajanı | Arama, sosyal ağ ve uygulama mağazası reklamlarını planlar, bütçe harcama hızını izler, kreatif testlerini ve sonuç raporlarını hazırlar. Bütçe değişiklikleri onaya tabidir. | Y1 | 3 |
| PAZ-5 | Marka Uyum Ajanı | Dışarı çıkan bütün materyalleri marka dili, görsel kimlik, yazım ve kanıtsız iddia açısından yayın öncesi denetler. Sorunları düzeltme önerisiyle döner. | Y0 | 3 |

### Tasarım ve Kreatif Stüdyo (TAS)

Tasarım ve Kreatif Stüdyo iki şirketin bütün görsel işlerini tek elden üretir: marka, arayüz ve prototip, sosyal medya görselleri, video, sunum ve baskı. Sorumlusu tasarım ve marka kararlarını veren kişi; çalıştığı araçlar Figma, Claude Design, Adobe Photoshop, Illustrator ve Premiere Pro, tasarım sistemi kütüphanesi ve görsel arşiv. Başarısı; briften ilk taslağa geçen süre, revizyon turu sayısı, marka kurallarına uyum ve tasarımla canlı ekran arasındaki fark sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| TAS-1 | Kreatif Brif Ajanı | Sosyal medya, kampanya, sunum ve arayüz taleplerini standart brife çevirir: amaç, hedef kitle, mesaj, format, ölçü, teslim tarihi ve kaynak dosyalar. İşi ilgili tasarım ajanına yönlendirir, revizyon turlarını ve onayları takip eder. | Y1 → Y2 | 2 |
| TAS-2 | Marka ve Tasarım Sistemi Ajanı | Arma DX ve Pillika'nın logo, renk, tipografi, bileşen ve şablon kütüphanesini Figma'da tek kaynak olarak yönetir. Tasarım değişkenlerini koda aktarır; yeni işlerin sisteme ve erişilebilirlik kurallarına uygunluğunu denetler. | Y1 | 2 |
| TAS-3 | UI/UX Tasarım Ajanı | Arma DX müşteri projeleri ve Pillika uygulaması için kullanıcı akışları, tel kafes ve ekran tasarımları hazırlar; ilk işi Pillika uygulamasının yeniden tasarımı. Erişilebilirlik kontrolü yapar, geliştiriciler için tasarım teslim dokümanı çıkarır. | Y1 | 1 |
| TAS-4 | Prototip Ajanı | Teklif öncesinde müşteriye gösterilecek ve kullanıcı testinde kullanılacak tıklanabilir prototipleri hazırlar. Geri bildirimleri kapsam dokümanına ve tasarım görevlerine işler. | Y1 | 2 |
| TAS-5 | Kullanıcı Araştırması Ajanı | Kullanıcı görüşmesi ve kullanılabilirlik testi planlarını hazırlar, kayıtları özetler, bulguları önem sırasıyla raporlar. İlk kapsamı Pillika'nın yeniden tasarımı için sürücülerle yapılacak görüşmeler. | Y0 | 2 |
| TAS-6 | Sosyal Medya Görsel Ajanı | Gönderi, kaydırmalı gönderi, hikâye ve video kapaklarını marka şablonlarından kanal ölçülerine göre üretir. Aynı içeriğin farklı kanal ve dil sürümlerini çıkarır. | Y1 | 1 |
| TAS-7 | Video ve Hareketli Grafik Ajanı | Kısa videolar için senaryo, sahne taslağı ve kurgu planı hazırlar; ürün tanıtım videolarını, uygulama demolarını ve animasyon işlerini yürütür. Altyazı ve farklı ölçü sürümlerini çıkarır. | Y1 | 3 |
| TAS-8 | Sunum ve Doküman Tasarım Ajanı | Teklif, keşif raporu, yol haritası sunumu, kurum tanıtımı ve yatırımcı sunumu gibi dokümanların görsel düzenini hazırlar. Şablon kütüphanesini güncel tutar. | Y1 | 2 |
| TAS-9 | Ürün ve Baskı Tasarım Ajanı | Pillika Barrier'ın CPO markasına özel giydirmesini, ürün render ve montaj görsellerini, fuar standı, broşür ve etiket tasarımlarını hazırlar. Baskı dosyalarını renk profili ve taşma payı açısından kontrol eder. | Y1 | 3 |

### Sosyal Medya (SOS)

Sosyal medya birimi iki şirketin hesaplarını strateji, içerik, yayın, topluluk ve raporlama olarak uçtan uca yönetir. Bugün dışarıdan alınan sosyal medya hizmeti bu birime geçecek; sorumlusu sosyal medya kararlarını veren kişi, bağlandığı yerler Meta Business Suite ve LinkedIn sayfaları. Başarısı; yayın planına uyum, etkileşim oranı, yorum ve mesajlara yanıt süresi, takipçi artışı ve sosyal medyadan gelen ziyaret ve başvurularla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| SOS-1 | Sosyal Medya Strateji Ajanı | Her marka ve kanal için hedef kitle, içerik başlıkları, ton ve yayın sıklığını belirleyen aylık planı hazırlar. Arma DX'te LinkedIn gibi kurumsal kanallar, Pillika'da sürücülerin olduğu kanallar öncelikli. | Y1 | 2 |
| SOS-2 | Sosyal İçerik Yazım Ajanı | Gönderi metinlerini, video senaryolarını, kaydırmalı gönderi kurgularını ve etiket setlerini yalnızca verilen kaynak bilgiye dayanarak hazırlar. Her içerik için seçenekler sunar. | Y1 | 1 |
| SOS-3 | Yayın ve Takvim Ajanı | Onaylanan içerikleri kanal ve saat bazında zamanlar; yayın öncesi bağlantı, etiket, görsel ölçüsü ve yazım kontrolü yapar. Yayınlanan içeriklerin arşivini tutar. | Y1 → Y2 | 2 |
| SOS-4 | Topluluk Yönetimi Ajanı | Yorum ve özel mesajlara yanıt taslağı hazırlar; destek taleplerini Kullanıcı Destek birimine, iş fırsatlarını müşteri listesine yönlendirir. Spam ve hakaret içeren mesajları ayıklar. | Y1 → Y2 | 2 |
| SOS-5 | Sosyal Dinleme ve İtibar Ajanı | Marka anılmalarını, rakipleri ve sektör gündemini; Şikayetvar, Ekşi Sözlük, forumlar ve mağaza yorumlarını izler. Olumsuz eğilimi ve kriz sinyalini erken yakalayıp Kurumsal İletişim birimine aktarır. | Y3 | 3 |
| SOS-6 | Influencer İş Birlikleri Ajanı | Pillika için elektrikli araç içerik üreticilerini, Arma DX için sektörde sözü dinlenen kişileri bulur ve değerlendirir. İş birliği teklifini, brifi ve yayın takibini hazırlar; reklam içeriklerinde açıklama etiketinin kullanıldığını kontrol eder. | Y1 | 3 |
| SOS-7 | Sosyal Medya Analitik Ajanı | Hesap ve içerik performansını (erişim, etkileşim, tıklama, dönüşüm) izler, içerik türlerini karşılaştırır. Aylık raporu ve bir sonraki ayın plan önerilerini hazırlar. | Y3 | 2 |

Ücretli reklamlar Pazarlama birimindeki Performans Pazarlama Ajanında kalır; görseller Tasarım ve Kreatif Stüdyo'dan gelir.

### Kurumsal İletişim (KIL)

Kurumsal iletişim birimi şirketlerin basındaki, kriz anındaki ve yöneticileri üzerinden kamuoyundaki sesini yönetir. Sorumlusu kurucu; bağlandığı yerler medya listesi, haber takibi, kriz senaryoları ve etkinlik takvimi. Başarısı; çıkan haberlerin sayısı ve niteliği, kriz anında ilk açıklamanın süresi ve etkinliklerden gelen görüşme sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| KIL-1 | Basın İlişkileri Ajanı | Basın bülteni, medya listesi ve röportaj hazırlık notu hazırlar, çıkan haberleri takip eder. Açıklamalar yalnızca yönetimin onayladığı bilgiye dayanır. | Y1 | 3 |
| KIL-2 | Kriz İletişimi Ajanı | Olası krizler için hazır mesaj setleri ve onay zinciri tutar: Pillika'da hizmet kesintisi ya da veri ihlali, bariyer kaynaklı kaza, Arma DX'te proje sorunu gibi. Kriz anında açıklama taslaklarını hazırlar, kanallar arası tutarlılığı izler. | Y1 | 3 |
| KIL-3 | Yönetici Görünürlüğü Ajanı | Kurucu ve yöneticiler için LinkedIn yazıları, konuşma metinleri ve panel başvuruları hazırlar. Yalnızca yöneticinin kendi görüşlerine ve verdiği bilgiye dayanır. | Y1 | 3 |
| KIL-4 | Etkinlik ve Fuar Ajanı | Fuar ve etkinlik takvimini tutar, katılım kararı için maliyet ve fayda notu hazırlar. Stand ve materyal hazırlığını Tasarım ve Kreatif Stüdyo ile yürütür, etkinlik sonrası takip listesini çıkarır. | Y1 | 4 |

### Satın Alma ve İdari İşler (SAI)

Bu birim satın alma, seyahat ve ofis işlerinin talep, karşılaştırma ve takip yükünü alır; satın alma kararı ve ödeme insanda kalır. Sorumlusu idari işler ya da satın alma sorumlusu; bağlandığı yerler tedarikçi listesi, satın alma talepleri ve hesaba bağlı havayolu ile konaklama bağlantıları. Başarısı; talepten siparişe geçen süre, alınan karşılaştırmalı teklif sayısı ve politika dışı harcama oranıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| SAI-1 | Satın Alma Ajanı | Satın alma taleplerini toplar, tedarikçi araştırır, karşılaştırmalı teklif ister ve tablolaştırır, sipariş taslağını onaya sunar. Tedarikçi performansını ve sözleşmelerini izler. Başlıca kapsamı yazılım, bulut ve donanım alımları. | Y1 | 3 |
| SAI-2 | Seyahat Ajanı | İş seyahatlerinde uçuş ve otel seçeneklerini seyahat politikasına göre bulur, onaydan sonra rezervasyonu tamamlar ve masraf kaydını açar. | Y1 | 4 |
| SAI-3 | İdari İşler Ajanı | Ofis ihtiyaçlarını, kargo ve kuryeyi, ziyaretçileri, abonelikleri ve bina işlerini takip eder; tekrar eden idari talepleri kayda alır. | Y2 | 4 |
| SAI-4 | Dış Kaynak ve Serbest Çalışan Ajanı | Dışarıdan destek alınan firmaların ve serbest çalışanların listesini, gizlilik ve fikri mülkiyet devri sözleşmelerini, iş emirlerini, teslim ve ödeme takibini yönetir. Mali müşavir, avukat ve Kutech gibi dış ortaklarla ajanlar arasındaki iş akışını düzenler. | Y1 | 2 |

### Veri ve Raporlama (VER)

Veri birimi sorulara veriyle yanıt verir, düzenli raporları üretir ve iki şirketin yönetim özetini hazırlar; bütün ajanları okuma yetkisiyle çalışır. Sorumlusu veri ya da raporlama sorumlusu; bağlandığı yerler uygulama veritabanlarının okuma kopyaları, muhasebe ve CRM verisi ve rapor araçları. Başarısı; raporların zamanında teslim oranı, veri sorularının yanıt süresi ve yakalanan veri hatası sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| VER-1 | Veri Analizi Ajanı | Doğal dilde sorulan veri sorularını yetkili kaynaklarda sorguya çevirir. Sonucu açıklamasıyla ve kullandığı sorguyla birlikte sunar. | Y0 | 3 |
| VER-2 | Rapor ve Pano Ajanı | Birimlerin düzenli raporlarını ve panolarını üretip zamanında dağıtır. Olağan dışı değişimlerde uyarı verir. | Y3 | 3 |
| VER-3 | Veri Kalitesi Ajanı | Veri akışlarında eksik, tekrar eden, biçimi bozuk ya da geç gelen kayıtları tespit eder, kaynağını bulup ilgili ekibe bildirir. | Y2 | 4 |
| VER-4 | Holding Rapor Ajanı | Arma DX ve Pillika'nın bütün birimlerden gelen göstergelerini aylık detaylı bir yönetim raporunda, haftalık özette ve anında uyarılarda birleştirir. Şirketlerin ham verisine değil, yalnızca onaylı özet göstergelere erişir. | Y3 | 2 |

Holding raporu iki şirketi yan yana ve holding toplamıyla gösterir. Her ayın ilk iş günü detaylı rapor, her pazartesi bir sayfalık özet çıkar; kritik bir sapmada uyarı beklemeden gelir.

| Bölüm | Göstergeler | Kaynak ajanlar |
| --- | --- | --- |
| Finans | Gelir ve gider, brüt kâr ve marj, bütçe ile gerçekleşen arasındaki sapma, nakit durumu ve 13 haftalık nakit tahmini, vadesi geçmiş alacaklar | Fatura, Tahsilat ve Cari, Banka Mutabakat, Nakit ve Bütçe |
| Satış ve iş geliştirme | Açık fırsatlar ve toplam değeri, aşamalara göre dağılım, verilen, kazanılan ve kaybedilen teklifler, teklif kazanma oranı, yeni müşteriler; Pillika'da CPO, API ve bariyer görüşmeleri | CRM ve Fırsat, Teklif, CPO İş Geliştirme, API Satış ve Kurulum, Bariyer Satış |
| Projeler | Aktif projelerin durumu, kilometre taşlarına uyum, bütçe sapması, değişiklik talepleri, bakım sözleşmeleri ve SLA uyumu | Proje Takip, Değişiklik Yönetimi, SLA ve Bakım |
| Ürün | Pillika'da geliştirme yol haritasının ilerlemesi ve sürümler; canlıdan sonra kullanıcı ve aktif kullanıcı sayısı, şarj oturumu ve başarısız oturum oranı, entegre CPO ve istasyon sayısı, kurulu bariyer sayısı | Ürün Yol Haritası, Ürün Analitiği, Şarj Oturumu İzleme, CPO Entegrasyon, Cihaz İzleme ve Servis |
| Pazarlama ve sosyal medya | Takipçi, erişim ve etkileşim, web trafiği, kampanya harcaması ve getirisi | Sosyal Medya Analitik, Performans Pazarlama, SEO ve Web |
| Müşteri ve destek | Açık talepler, ilk yanıt ve çözüm süreleri, memnuniyet, müşteri sağlık skorları | Destek Talep, Müşteri Sağlığı, Canlı Destek |
| Ofis ve ekip | Ajanların tamamladığı iş, kazanılan saat, onay bekleyen işler, ilk seferde onay oranı, ofis maliyeti (iç işler ve projeler ayrı) | Görev Takip, Onay Masası, Kalite Denetim, Maliyet ve Kullanım |
| Hukuk ve uyum | Yaklaşan sözleşme yenilemeleri ve yasal süreler, KVKK başvuruları, önemli mevzuat değişiklikleri, Kutech'ten devralınacak dosya ve hakların durumu | Sözleşme Takip, KVKK, Mevzuat Takip, Fikri Mülkiyet |
| Hedefler | Şirket ve birim hedeflerinde ilerleme, sapan hedefler | Hedef ve OKR Takip |
| Kararlar ve riskler | Yönetimin karar vermesi gereken konular, kritik riskler, gecikmeler | Yönetici Asistanı, Hedef ve OKR Takip |

### Yazılım Geliştirme (YAZ)

Yazılım geliştirme birimi iki şirketin de en büyük iş yükünü taşır: Arma DX'te müşteri projelerini, Pillika'da uygulama, arka uç ve API portalını. Sorumlusu teknik lider; bağlandığı yerler GitHub depoları, paneldeki görev kaydı ve Postman. Başarısı; iş başına teslim süresi, incelemeden geri dönen değişiklik oranı, test kapsamı ve canlıdaki hata sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| YAZ-1 | Gereksinim Analizi Ajanı | Toplantı notlarından, müşteri taleplerinden ve keşif çıktılarından kullanıcı hikayeleri, kabul kriterleri ve uç durumlar çıkarır. İş listesini düzenli ve önceliklendirilmiş tutar. | Y1 | 2 |
| YAZ-2 | Mimari Ajanı | Teknoloji seçimi, veri modeli, API tasarımı ve entegrasyon yaklaşımları için karşılaştırmalı değerlendirme ve mimari karar kayıtları hazırlar. Teknik borcu tespit edip önceliklendirir. | Y0 | 3 |
| YAZ-3 | Kodlama Ajanı | Kapsamı net tanımlanmış işleri ayrı dalda geliştirir, testleriyle birlikte değişiklik isteği (PR) açar. Ana dala kendisi birleştirmez. | Y1 | 2 |
| YAZ-4 | Kod İnceleme Ajanı | Açılan her değişiklik isteğini doğruluk, güvenlik, performans ve kod standartları açısından inceleyip yorum bırakır. Birleştirme kararı insanda kalır. | Y2 | 2 |
| YAZ-5 | Test Ajanı | Birim, entegrasyon ve uçtan uca testler yazar, test planı çıkarır, regresyon testlerini çalıştırır. Hataları yeniden üretme adımlarıyla kaydeder. | Y2 | 2 |
| YAZ-6 | Teknik Dokümantasyon Ajanı | API dokümanlarını, kurulum ve çalıştırma kılavuzlarını ve mimari dokümanları kodla eş zamanlı tutar. Değişiklik isteklerinde doküman güncellemesi gerekip gerekmediğini kontrol eder. | Y2 | 3 |
| YAZ-7 | Uygulama Güvenliği Ajanı | Bağımlılıklardaki güvenlik açıklarını, koda gömülü gizli anahtarları ve açık kaynak lisans uyumunu tarar. Bulguları önem sırasıyla raporlar. | Y2 | 3 |
| YAZ-8 | Entegrasyon Mühendisliği Ajanı | Kurumsal sistemler arasındaki entegrasyonlarda (muhasebe, ERP ve kamu servisleri gibi) veri eşlemesini, hata yönetimini ve izlemeyi tasarlar. Entegrasyon testlerini yazar ve çalıştırır. | Y1 | 2 |

Arma DX'te bu ajanlar yalnızca Arma DX'in yönettiği depolarda çalışır; müşteri ortamına erişim müşterinin yazılı izniyle ve proje bazında açılır. Arayüz tasarımı Tasarım ve Kreatif Stüdyo'da, canlı sistemlerin işletimi Altyapı ve Bulut Operasyonları biriminde, bariyer yazılımı Donanım ve Gömülü Sistemler biriminde.

### Altyapı ve Bulut Operasyonları (ALT)

Bu birim canlı sistemlerin ayakta, hızlı ve maliyet kontrolünde kalmasını sağlar: Pillika'nın uygulaması ve entegrasyonları ile Arma DX'in barındırdığı müşteri sistemleri. Sorumlusu teknik lider; bağlandığı yerler AWS ve Cloudflare hesapları, İHS alan adı paneli, izleme ve alarm araçları, CI/CD hatları ve yedekleme. Başarısı; erişilebilirlik oranı, olay çözüm süresi, başarısız yayın oranı ve bulut maliyetinin bütçeye uyumuyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| ALT-1 | Yayın ve DevOps Ajanı | CI/CD hatlarını, yayın kontrol listelerini, sürüm notlarını ve geri alma planlarını yönetir. Test ortamına kendisi, canlı ortama onayla yayın yapar. | Y1 → Y2 | 3 |
| ALT-2 | Olay Müdahale Ajanı | Canlı sistem uyarılarını izler, önem derecesini belirler, çalıştırma kılavuzuna göre ilk adımları uygular. Durum güncellemelerini ve olay sonrası raporu hazırlar. | Y1 → Y2 | 3 |
| ALT-3 | İzleme ve Gözlemlenebilirlik Ajanı | Erişilebilirlik, gecikme ve hata oranı panolarını ve alarm eşiklerini yönetir; gereksiz alarmları azaltır. Pillika'da CPO entegrasyonlarını ve uygulamayı, Arma DX'te barındırılan müşteri sistemlerini kapsar. | Y2 | 3 |
| ALT-4 | Bulut Maliyet Ajanı | Bulut ve servis maliyetlerini proje ve müşteri bazında ayırır, boşta kalan kaynakları ve gereksiz ortamları bulur. Müşteri faturasına yansıyacak barındırma maliyetini hesaplar. | Y0 | 3 |
| ALT-5 | Ortam ve Yapılandırma Ajanı | Geliştirme, test ve canlı ortamlarının; alan adı, DNS ve sertifika ayarlarının ve altyapı kodunun düzenini izler. Ortamlar arasındaki farkları raporlar, değişiklik taleplerini hazırlar. | Y1 | 3 |
| ALT-6 | Müşteri Barındırma Ajanı | Arma DX'in barındırdığı ya da müşteri sunucusuna kurduğu sistemlerde yedek, güncelleme ve kapasite işlerini yürütür. Aylık teknik hizmet raporunu SLA ve Bakım Ajanına aktarır. | Y2 | 3 |

### Donanım ve Gömülü Sistemler (DON)

Donanım birimi Pillika Barrier'ın donanım tarafını Kutech ile birlikte yürütür: donanım geliştirme, sensör işlemcisinin yazılımı ve üretim Kutech'te; dış dünyaya açılan işlemcinin yazılımı, geliştirme takibi, sertifikasyon ve üretici ilişkisi Pillika'da. Sorumlusu donanım ürün sorumlusu; bağlandığı yerler Kutech ile paylaşılan tasarım ve test dokümanları, gömülü yazılım deposu ve cihaz izleme verisi. Başarısı; geliştirme kilometre taşlarına uyum, sahadaki arıza oranı ve sertifikasyonun ilk başvuruda tamamlanmasıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| DON-1 | Donanım Geliştirme Takip Ajanı | Kutech'in yürüttüğü geliştirme işinin kilometre taşlarını, tasarım revizyonlarını, test sonuçlarını ve açık konularını takip eder. Toplantı ve yazışmalardan iki tarafın aksiyon listesini çıkarır. | Y1 | 2 |
| DON-2 | Gömülü Yazılım Ajanı | Dış dünyaya açılan işlemcinin yazılımını (bağlantı, uzaktan güncelleme, CPO ve Pillika uygulamasıyla haberleşme) geliştirir ve inceler. Sensör işlemcisiyle haberleşme protokolünü Kutech ile birlikte güncel tutar; donanım üzerindeki testler insan gözetiminde kalır. | Y1 | 2 |
| DON-3 | Test ve Sertifikasyon Ajanı | CE başta olmak üzere uygunluk dosyalarını ve test raporlarını takip eder. Ürünü kendi markasıyla piyasaya sunan taraf olarak Pillika'nın yükümlülüklerini kontrol listesine döker. | Y1 | 3 |
| DON-4 | Üretici İlişkileri ve Kalite Ajanı | Kutech ile üretim siparişlerini, teslim sürelerini, kalite kontrol kayıtlarını ve sözleşme yükümlülüklerini takip eder. Sözleşme gereği Kutech'ten devralınacak bütün proje dosyalarının (tasarım, ürün ağacı, sensör işlemcisi yazılımı, test talimatları) ve hakların eksiksiz teslimini izler. | Y1 | 3 |

### Tedarik Zinciri ve Lojistik (TED)

Tedarik zinciri birimi Kutech'ten teslim alınan bariyerlerin stok, sevkiyat ve garanti işlerini ve ileride ihracat belgelerini yürütür; satın alma kararı Satın Alma Ajanında kalır. Sorumlusu operasyon sorumlusu; bağlandığı yerler stok kayıtları, Kutech ve kargo firmalarıyla yazışmalar. Başarısı; stok yüzünden geciken kurulum sayısı, teslim süresi ve garanti vakalarının kapanma süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| TED-1 | Stok ve Depo Ajanı | Kutech'ten teslim alınan bariyerlerin ve yedek parçaların stoklarını, seri numaralarını ve depo hareketlerini izler. Kritik seviyede sipariş önerisi hazırlar. | Y2 | 3 |
| TED-2 | İhracat ve Gümrük Ajanı | Orta Doğu başta olmak üzere ihracatta hedef ülkenin belge şartlarını, proforma ve gümrük belgelerini hazırlar; gümrük müşaviriyle yazışmaları yürütür. | Y1 | 4 |
| TED-3 | Sevkiyat Ajanı | Kargo ve nakliye planını, sahaya sevkiyatı ve teslim takibini yürütür; sevkiyatı kurulum takvimiyle eşleştirir. | Y1 → Y2 | 3 |
| TED-4 | Garanti ve İade Ajanı | Arızalı ürün iadelerini, garanti kapsamı kontrolünü, onarım ya da değişim sürecini Kutech ile birlikte yönetir. | Y1 | 3 |

## Arma DX Birimleri

Arma DX'in sekiz birimi şirketin iş modelini adım adım izler: önce müşterinin bütün ihtiyaçları çıkarılır, sonra sorunları çözen ya da kârlılığı artıran projeler kurulur ve teslim edilir. 32 rolün merkezinde Keşif ve Dönüşüm Danışmanlığı birimi var; Arma DX'i sıradan yazılım işinden ayıran iş burada yapılır. Projelerde geliştirilen modüller Ürün ve Çözüm Kataloğu biriminde tekrar kullanılabilir ürünlere dönüşür.

### Satış ve İş Geliştirme (A-SAT)

Satış birimi doğru kurumu bulur, ilk teması hazırlar ve fırsatları paneldeki müşteri listesinde canlı tutar. Sorumlusu satış ya da iş geliştirme yöneticisi; bağlandığı yerler paneldeki müşteri ve fırsat listesi, e-posta, LinkedIn ve referans kütüphanesi. Başarısı; nitelikli fırsat sayısı, ilk temastan keşif toplantısına geçiş oranı ve fırsatların kapanma süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-SAT-1 | Hedef Müşteri Araştırma Ajanı | Yönetimin belirlediği sektörlerde (otomotiv bayileri ve kamu kurumları gibi) aday kurumları bulur. Büyüklük, kullandığı sistemler, dijitalleşme sinyalleri ve karar vericilerle kurum profili çıkarır, ideal müşteri tanımına göre puanlar. | Y0 | 2 |
| A-SAT-2 | Satış İletişim Ajanı | Kuruma ve kişiye özel ilk temas e-postaları, LinkedIn mesajları ve takip dizileri hazırlar. Gönderim insan onayıyla yapılır. | Y1 | 3 |
| A-SAT-3 | CRM ve Fırsat Ajanı | Görüşme ve yazışmalardan paneldeki müşteri ve fırsat kayıtlarını günceller, fırsat aşamalarını izler. Uzun süredir hareketsiz fırsatları ve tarihi geçen adımları uyarır, satış tahmini hazırlar. | Y2 | 2 |
| A-SAT-4 | Satış Materyali Ajanı | Müşteriye özel tanıtım sunumu, tek sayfalık özet ve müşteri izniyle vaka çalışması hazırlar. Teslim edilen projelerden referans kütüphanesi oluşturur. | Y1 | 3 |

### Keşif ve Dönüşüm Danışmanlığı (A-KES)

Keşif birimi müşterinin bütün ihtiyaçlarını ve sorunlarını sistemli şekilde çıkarır ve bunları önceliklendirilmiş bir proje yol haritasına çevirir. Sorumlusu kıdemli danışman ya da çözüm mimarı; bağlandığı yerler görüşme kayıtları ve notları, müşteriden alınan dokümanlar ve o müşteriye ayrılmış bilgi alanı. Başarısı; keşiften yol haritasına geçen süre, müşterinin onayladığı bulgu oranı ve yol haritasındaki projelerin teklife dönüşme oranıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-KES-1 | Keşif Planlama Ajanı | Yeni müşteri için keşif planı hazırlar: görüşülecek birimler ve kişiler, birim bazında soru setleri, istenecek doküman ve ekran görüntüleri, görüşme takvimi. | Y1 | 2 |
| A-KES-2 | Süreç Analizi Ajanı | Görüşme kayıtlarından ve notlarından mevcut süreç haritalarını çıkarır. Elle yapılan adımları, tekrarlanan veri girişini, bekleme noktalarını ve kaçan gelir fırsatlarını işaretler. | Y1 | 1 |
| A-KES-3 | Sistem Envanteri Ajanı | Müşterinin kullandığı yazılımları, zorunlu sistemleri, entegrasyon imkânlarını (web servis, dışa aktarım, erişim kısıtları) ve veri akışlarını tek envanterde toplar. Elle tutulan Excel dosyalarını da sistem olarak kaydeder. | Y1 | 2 |
| A-KES-4 | Değer ve Önceliklendirme Ajanı | Tespit edilen her sorun için zaman ve maliyet kazancını, gelir etkisini, uygulama zorluğunu ve bağımlılıkları tahmin eder. Projeleri gerekçeli bir öncelik sırasına dizer. | Y1 | 2 |
| A-KES-5 | Dönüşüm Yol Haritası Ajanı | Önceliklendirilmiş projeleri bağımlılıkları, aşamaları ve ortak platform kararlarıyla birlikte çok yıllık bir yol haritasına çevirir. Müşteri yönetimine sunulacak sunumu hazırlar. | Y1 | 3 |

### Çözüm ve Teklif (A-TEK)

Bu birim yol haritasındaki bir projeyi mimarisi, fiyatı ve kapsamı hazır bir teklife dönüştürür; prototip Tasarım ve Kreatif Stüdyo'dan gelir. Sorumlusu çözüm mimarı, fiyat onayı yönetimde; bağlandığı yerler teklif ve sözleşme şablonları ile ücret kartı. Başarısı; talepten teklife geçen süre, teklif kazanma oranı ve teslimde ortaya çıkan kapsam sapmasıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-TEK-1 | Çözüm Mimarisi Ajanı | Çözümün modüllerini, entegrasyonlarını, barındırma modelini (kurum içi ya da bulut) ve AI bileşenlerini tasarlar. Alternatifleri maliyet ve risk açısından karşılaştırır. | Y1 | 3 |
| A-TEK-2 | Teklif Ajanı | Fizibilite, iş kırılımı, ücret kartına göre fiyat, markalı teklif dokümanı (PDF) ve zaman çizelgesi hazırlar. Şirketin teklif kurallarını uygular; fiyat onayı yönetimde kalır. | Y1 | 1 |
| A-TEK-3 | Kapsam Dokümanı Ajanı | Teknik şartnameyi, kapsam dışı maddeleri, kabul kriterlerini, varsayımları ve müşteri sorumluluklarını içeren kapsam dokümanını hazırlar. Sözleşmeye ek olarak Sözleşme Ajanına aktarır. | Y1 | 3 |

### Kamu İhaleleri (A-IHA)

Kamu ihaleleri birimi uygun ihaleleri kaçırmamayı ve dosya hazırlığında eksik belge riskini azaltmayı hedefler. Sorumlusu ihale sorumlusu, hukuk birimiyle birlikte; bağlandığı yerler EKAP, ilan platformları ve şirket belge arşivi. Başarısı; kaçırılan uygun ihale sayısı, belge eksikliği nedeniyle elenme sayısı ve dosya hazırlık süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-IHA-1 | İhale Tarama Ajanı | EKAP ve ilan platformlarındaki yazılım, dijital dönüşüm ve AI ihalelerini her gün tarar. Kapsam, idare, son tarih ve yeterlilik şartlarıyla uygunluk listesi çıkarır. | Y3 | 3 |
| A-IHA-2 | Şartname Analiz Ajanı | İdari ve teknik şartnameleri okur; yeterlilik kriterlerini (iş deneyimi, ciro, personel, belgeler), teknik gereksinimleri, cezai şartları ve riskleri çıkarır. Katılım önerisini gerekçesiyle sunar. | Y0 | 3 |
| A-IHA-3 | İhale Dosyası Ajanı | Gerekli belge listesini, teknik teklif metinlerini ve şartnameye uyum tablosunu hazırlar; teminat ve süre takvimini izler. Teklifi e-imzayla sunmak insanın işidir. | Y1 | 4 |

### Proje Teslimat (A-PRJ)

Proje teslimat birimi imzalanan işi plana, plandaki işi zamanında teslime dönüştürür. Sorumlusu proje yöneticisi; bağlandığı yerler paneldeki görev kaydı, GitHub depoları, toplantı kayıtları ve sözleşmedeki kilometre taşları. Başarısı; kilometre taşlarına uyum, bütçe sapması ve kabul aşamasında bulunan hata sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-PRJ-1 | Proje Planlama Ajanı | Sözleşme sonrası ayrıntılı iş planını, kilometre taşlarını, sprintleri, kaynak atamasını ve bağımlılıkları hazırlar. | Y1 | 3 |
| A-PRJ-2 | Proje Takip Ajanı | Paneldeki görev kaydından, GitHub deposundan ve toplantılardan ilerlemeyi toplar. İç ekip ve müşteri için haftalık durum raporu, risk listesi ve bütçe gerçekleşme karşılaştırması hazırlar; müşteriye giden rapor onaydan geçer. | Y2 iç, Y1 müşteri | 1 |
| A-PRJ-3 | Değişiklik Yönetimi Ajanı | Kapsam değişikliği taleplerini kaydeder, süre ve maliyet etkisini hesaplar. Ek iş teklifini onaya ve müşteriye hazırlar. | Y1 | 3 |
| A-PRJ-4 | Kabul ve Teslim Ajanı | Kullanıcı kabul testi senaryolarını, kabul tutanaklarını, kullanım kılavuzlarını, eğitim materyallerini ve teslim dokümanlarını hazırlar. | Y1 | 3 |
| A-PRJ-5 | Kaynak Planlama Ajanı | Ekip doluluğunu projeler arasında izler, önümüzdeki haftalar için kapasite tahmini yapar. Darboğazları ve işe alım ihtiyacını erken gösterir. | Y0 | 4 |

### AI Çözümleri (A-AI)

AI Çözümleri birimi Arma DX'in müşteriye özel ve güvenli AI ortamı sözünü teknik olarak karşılar. Sorumlusu AI lideri; bağlandığı yerler anonimleştirilmiş müşteri veri örnekleri, model sağlayıcıları, kurum içi model altyapısı ve değerlendirme setleri. Başarısı; canlıya geçen kullanım senaryosu sayısı, model doğruluğu ve güvenlik denetiminde çıkan bulgu sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-AI-1 | AI Fırsat Ajanı | Keşif çıktılarında AI ile çözülebilecek işleri bulur: doküman okuma, sınıflandırma, tahmin, kurum içi asistan gibi. Veri hazırlığına ve beklenen faydaya göre fizibilite notu yazar. | Y0 | 3 |
| A-AI-2 | Veri Hazırlık Ajanı | Müşteri verisinin kalitesini, erişim yolunu ve hassasiyetini değerlendirir. Anonimleştirme ve veri hazırlama adımlarını tasarlar. | Y1 | 4 |
| A-AI-3 | Model Değerlendirme Ajanı | Her kullanım senaryosu için test setleri oluşturur, bulut ve kurum içi model seçeneklerini doğruluk, maliyet ve hız açısından karşılaştırır. Model seçim raporu hazırlar. | Y1 | 4 |
| A-AI-4 | AI Güvenlik ve Yönetişim Ajanı | Kurulan AI çözümlerini veri yerleşimi, erişim, kayıt tutma ve istem enjeksiyonuna dayanıklılık açısından denetler. Müşteri için AI kullanım politikası taslağı hazırlar. | Y1 | 4 |

Agentik ofisin başka firmalara kurulmasında teknik güvence bu birimden, ürün yönetimi Ürün ve Çözüm Kataloğu biriminden gelir.

### Müşteri Başarısı ve Destek (A-MUS)

Bu birim teslim edilen sistemlerin desteğini, bakım sözleşmelerini ve müşteriyle uzun vadeli ilişkiyi yürütür. Sorumlusu müşteri başarı yöneticisi; bağlandığı yerler destek kanalları (e-posta, portal, WhatsApp), bakım sözleşmeleri ve proje bilgi alanları. Başarısı; SLA'ya uyum, ilk yanıt ve çözüm süresi, bakım yenileme oranı ve mevcut müşterilerden gelen yeni proje tutarıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-MUS-1 | Destek Talep Ajanı | Müşteri taleplerini hata, istek ya da soru olarak sınıflar, SLA önceliğini belirler, ilgili geliştiriciye yönlendirir. Yanıt taslağı hazırlar; güven kazandıkça basit sorulara kendisi yanıt verir. | Y1 → Y2 | 2 |
| A-MUS-2 | SLA ve Bakım Ajanı | SLA sürelerini, bakım sözleşmesi saat bakiyelerini ve periyodik bakım işlerini takip eder, aylık hizmet raporlarını hazırlar. Araştırılan yıllık peşin faturalama ve Yİ-ÜFE ile TÜFE'ye bağlı fiyat güncelleme modeli uygulanırsa yenileme hesabını bu ajan yapar. | Y2 | 3 |
| A-MUS-3 | Müşteri Sağlığı Ajanı | Kullanım, talep yoğunluğu ve memnuniyet sinyallerinden müşteri sağlık skoru çıkarır. Yol haritasındaki sıradaki projeler ve yenileme dönemleri için genişleme fırsatlarını ve dönemsel değerlendirme toplantısı hazırlığını sunar. | Y0 | 3 |
| A-MUS-4 | Son Kullanıcı Eğitim Ajanı | Teslim edilen sistemler için kullanım kılavuzu, kısa eğitim içerikleri ve sık sorulan sorular hazırlar. Müşterinin son kullanıcılarından gelen soruları ilgili projenin bilgi alanından yanıtlar. | Y2 | 4 |

### Ürün ve Çözüm Kataloğu (A-KAT)

Bu birim projelerde geliştirilen modüllerin başka müşterilere uyarlanabilir ürünlere dönüşmesini sağlar; tekrar kullanılan her modül teslim süresini ve maliyeti düşürür. Sözleşmeler çoğunlukla tekrar kullanıma izin veriyor; yalnızca o müşteriye özel geliştirilen işler katalog dışında tutulur. Sorumlusu kurucu ya da çözüm mimarı; başarısı katalogdan kullanılan modül sayısı, tekrar kullanımın kısalttığı teslim süresi ve ürün gelirinin toplam gelire oranıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| A-KAT-1 | Yeniden Kullanım Ajanı | Tamamlanan projelerde başka müşterilere uyarlanabilecek modülleri tespit eder: raporlama panelleri, entegrasyon bileşenleri, onay akışları gibi. Kullanım hakkının sözleşmeye göre kontrolünü hukuk birimine iletir. | Y0 | 3 |
| A-KAT-2 | Çözüm Kataloğu Ajanı | Tekrar kullanılabilir modüllerin kataloğunu, özelliklerini, fiyat mantığını ve demo ortamlarını güncel tutar. Keşif ve teklif ajanlarına hazır çözüm önerir. | Y1 | 3 |
| A-KAT-3 | Sektör Paketi Ajanı | Aynı sektörde tekrar eden ihtiyaçlardan paket ürün önerisi ve yol haritası çıkarır; lisans ve abonelik modeli seçeneklerini hazırlar. | Y0 | 4 |
| A-KAT-4 | Agentik Ofis Ürün Ajanı | Agentik ofisin dış firmalara kurulacak sürümünün kataloğunu, sektör şablonlarını ve kurulum adımlarını yönetir. Ürünleşme bölümündeki adımların sahibidir. | Y1 | 4 |

## Pillika Birimleri

Pillika'nın on bir birimi dört ürünün çevresinde kurulu: mobil uygulama, API portalı, Pillika ADS ve Pillika Barrier. Ürünlerin hepsi geliştirme aşamasında ve uygulama arayüz tasarımından başlayarak yeniden geliştiriliyor; bu yüzden pilotta Pillika'dan yalnızca istasyon verisi ve tasarım işi var. Barrier ajanlarının çoğu üçüncü aşamada, ADS ajanları dördüncü aşamada devreye giriyor.

### Ürün Yönetimi (P-URN)

Ürün birimi mobil uygulamanın yönüne veriyle ve kullanıcının sesiyle karar verilmesini sağlar. Sorumlusu ürün yöneticisi; bağlandığı yerler Firebase analitiği, mağaza yorumları, destek kayıtları, App Store Connect ve Google Play Console. Başarısı; kayıttan ilk şarja dönüşüm, 30 günlük elde tutma, mağaza puanı ve sürüm sıklığıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-URN-1 | Ürün Yol Haritası Ajanı | Özellik fikirlerini, kullanıcı taleplerini ve iş hedeflerini birlikte değerlendirip önceliklendirir. Uygulamanın yeniden geliştirilmesi için ürün gereksinim dokümanlarını (PRD) ve sürüm planını hazırlar. | Y1 | 2 |
| P-URN-2 | Geri Bildirim Analizi Ajanı | Mağaza yorumlarını, destek taleplerini, uygulama içi geri bildirimleri ve sosyal medya anılmalarını toplar; konu, sıklık ve duygu bazında gruplar. En çok istenen özellikleri ve en çok şikâyet edilen sorunları haftalık raporlar. | Y2 | 3 |
| P-URN-3 | Ürün Analitiği Ajanı | Kayıttan araç eklemeye, ilk şarja ve tekrar kullanıma kadar dönüşüm hunisini, elde tutmayı ve özellik kullanımını analiz eder. A/B testlerini tasarlar ve sonuçlandırır. | Y0 | 3 |
| P-URN-4 | Mağaza ve ASO Ajanı | App Store ve Google Play metinlerini, anahtar kelimeleri, sürüm notlarını ve yorum yanıtlarını hazırlar, çok dilli yerelleştirmeyi yapar. Mağaza görselleri Tasarım ve Kreatif Stüdyo'dan gelir. | Y1 | 3 |
| P-URN-5 | Uygulama Yerelleştirme Ajanı | Uygulama içi metinleri, bildirimleri ve e-postaları hedef dillere uyarlar, terim sözlüğünü tutarlı tutar. Orta Doğu için Arapçada sağdan sola arayüz sorunlarını işaretler. | Y1 | 4 |

### CPO İlişkileri ve Entegrasyon (P-CPO)

Bu birim şarj ağı işletmecileriyle (CPO) iş birliğini ve teknik entegrasyonu yürütür; tek uygulamadan şarj başlatma vaadi buna dayanıyor. Sorumlusu iş ortaklıkları yöneticisi ve entegrasyon mühendisi; bağlandığı yerler CPO listesi ve görüşme kayıtları, CPO bağlantıları, entegrasyon izleme ve tarife verisi. Başarısı; entegre CPO sayısı ve kapsadıkları istasyon payı, entegrasyon süresi ve entegrasyon hata oranıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-CPO-1 | CPO İş Geliştirme Ajanı | Türkiye'deki ve hedef pazarlardaki şarj ağı işletmecilerini istasyon sayısı, bölge ve teknik olgunlukla haritalar. Şarj başlatma entegrasyonu, bariyer ve reklam için ayrı iş birliği önerileri hazırlar, görüşme sürecini takip eder. | Y1 | 2 |
| P-CPO-2 | CPO Entegrasyon Ajanı | Yeni entegrasyonlarda teknik gereksinimleri çıkarır: OCPI uyumlu CPO'larda konum, oturum, şarj kaydı, tarife ve uzaktan komut modülleri; OCPI desteklemeyenlerde Pillika'nın geliştirdiği özel entegrasyon. Test planını ve kabul listesini yürütür, canlı entegrasyonların hata oranını ve gecikmesini izler. | Y1 → Y2 | 3 |
| P-CPO-3 | Tarife Takip Ajanı | Her işletmecinin AC ve DC fiyatlarını, bekleme ücretlerini ve kampanyalarını takip eder, değişikliklerin uygulamaya doğru yansıdığını kontrol eder. Fiyat karşılaştırma raporu hazırlar. | Y2 | 3 |
| P-CPO-4 | CPO Hesap Yönetimi Ajanı | Entegre işletmecilere Pillika üzerinden gelen oturum ve gelir raporlarını hazırlar. Açık sorunları, sözleşme yükümlülüklerini ve ilişki sağlığını izler. | Y1 | 4 |

### İstasyon Verisi ve Şarj Operasyonları (P-IST)

Bu birim haritadaki her istasyonun doğru, güncel ve güvenilir olmasını sağlar; kullanıcının güveni en çok burada kazanılır ya da kaybedilir. Sorumlusu veri operasyonları sorumlusu; bağlandığı yerler CPO veri akışları, açık veri kaynakları, kullanıcı bildirimleri ve izin verilen bariyer verisi. Başarısı; hatalı istasyon bilgisi oranı, bildirimlerin doğrulanma süresi ve başlatılamayan şarj oranıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-IST-1 | İstasyon Veri Toplama Ajanı | CPO entegrasyonlarından, kamuya açık listelerden, işletmeci web sitelerinden ve açık veri kaynaklarından istasyon bilgisini toplar. Adres, koordinat, soket tipi ve gücü tek formata çevirir, tekrar eden kayıtları birleştirir. | Y2 | 1 |
| P-IST-2 | Durum Doğrulama Ajanı | Tutarsız durumları yakalar: günlerdir müsait görünüp hiç oturum almayan soket, hatalı koordinat gibi. Kullanıcı bildirimleri ve izin verilen bariyer verisiyle çapraz kontrol yapar, her istasyon bilgisine güven puanı verir. | Y2 | 2 |
| P-IST-3 | Topluluk Bildirim Ajanı | Kullanıcıların arıza, işgal ve hatalı bilgi bildirimlerini işler ve doğrular. İstasyon bilgisini günceller, gerekirse işletmeciye bildirir, bildirimi yapan kullanıcıya dönüş yapar. | Y2 | 3 |
| P-IST-4 | Şarj Oturumu İzleme Ajanı | Pillika üzerinden başlatılan oturumları canlı izler. Başlamayan, takılan ya da beklenmedik biten oturumları yakalayıp destek akışını ve gerekirse iade sürecini başlatır. | Y2 | 3 |
| P-IST-5 | İçerik Moderasyon Ajanı | Kullanıcıların istasyon yorumlarını, fotoğraflarını ve bildirimlerini plaka ve yüz gibi kişisel veri, hakaret ve yanıltıcı içerik açısından denetler. Uygunsuz içeriği yayından kaldırır ya da bulanıklaştırır; sınırda kalanları insana sorar. | Y2 | 3 |

### Araç Verisi, Görsel ve Rota (P-ARC)

Bu birim iki temel veri ürününü doğru tutar: araç veritabanını ve rota planlamayı. Kullanıcı kayıtta aracını seçtiği için buradaki her hata rota, şarj süresi ve maliyet tahminine yansır. Sorumlusu veri ürünleri sorumlusu; başarısı kapsanan model oranı, yeni modelin veritabanına girme süresi ve varış şarj seviyesi tahminindeki sapmayla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-ARC-1 | Araç Veritabanı Ajanı | Yeni elektrikli modelleri ve versiyonları takip eder. Batarya kapasitesi, AC ve DC şarj gücü, soket tipi, tüketim ve model yılı gibi verileri üretici kaynaklarından toplayıp doğrular, değişiklik kaydı tutar. | Y1 | 2 |
| P-ARC-2 | Şarj Eğrisi ve Tüketim Ajanı | Gerçek oturum ve yolculuk verisinden modellerin şarj eğrilerini ve tüketim profillerini çıkarır, üretici verisiyle karşılaştırır. Rota motoruna daha doğru parametre önerir. | Y1 | 4 |
| P-ARC-3 | Görsel Stüdyo Ajanı | Görseli eksik modelleri takip eder; açı, renk ve adlandırma standartlarını uygular. Görsellerin kalite kontrolünü ve API'de yayınlanmasını yönetir. | Y1 | 3 |
| P-ARC-4 | Rota Doğrulama Ajanı | Rota motorunu farklı araç, yolcu sayısı, klima kullanımı, hava ve eğim senaryolarıyla düzenli test eder. Tahmin edilen ile gerçekleşen varış şarj seviyesini karşılaştırıp sapmayı raporlar. | Y2 | 3 |

### API Portalı (P-API)

API portalı birimi araç, görsel, rota ve istasyon verilerini dışarıya ürün olarak satar ve bu müşterilerin başarılı olmasını sağlar. Sorumlusu API ürün sorumlusu; bağlandığı yerler portal, dokümantasyon, Postman koleksiyonları, kullanım ölçümü ve faturalama. Başarısı; aktif API müşterisi sayısı, denemeden ücretli pakete geçiş oranı, ilk başarılı isteğe kadar geçen süre ve aylık kullanım geliriyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-API-1 | Geliştirici Destek Ajanı | API müşterilerinin teknik sorularını dokümantasyon ve hata kayıtlarından yararlanarak yanıtlar. Örnek kod ve istek koleksiyonları hazırlar, dokümanı ve sürüm notlarını güncel tutar. | Y2 | 3 |
| P-API-2 | API Satış ve Kurulum Ajanı | Filo şirketleri, sigortacılar, bayiler, navigasyon uygulamaları ve üreticiler gibi potansiyel müşterileri bulur, ihtiyaca göre paket önerir. Deneme ortamı ve anahtar kurulumunu yürütür, kullanım artışını takip eder. | Y1 | 3 |
| P-API-3 | Kullanım ve Faturalama Ajanı | Müşteri bazında kullanımı ölçer, paket limitlerini ve aşımları izler. Aylık kullanım bazlı fatura verisini Fatura Ajanına aktarır, olağan dışı kullanımda uyarır. | Y2 | 3 |

### Pillika ADS (P-ADS)

Pillika ADS birimi uygulama içi reklam alanlarını CPO'lara, araç üreticilerine ve aksesuar firmalarına satar ve kampanyaları yürütür. Sorumlusu reklam satış sorumlusu; bağlandığı yerler reklam sunucusu, kampanya paneli, toplu kitle segmentleri ve İYS. Başarısı; reklam geliri, reklam alanı doluluğu, reklamveren yenileme oranı ve kullanıcı şikâyeti sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-ADS-1 | Reklam Satış Ajanı | CPO'lar, araç üreticileri ve aksesuar firmaları başta olmak üzere reklamverenleri hedefler. Araç modeli, bölge ve kullanım alışkanlığına göre toplu kitle verisiyle medya kiti ve teklif hazırlar. | Y1 | 4 |
| P-ADS-2 | Kampanya Operasyon Ajanı | Kampanyaları hedefleme, kreatif ve takvimle kurar. Kreatifleri reklam politikası, yanıltıcı iddia ve marka güvenliği açısından kontrol eder, yayın hızını izler. | Y1 | 4 |
| P-ADS-3 | Reklam Raporlama Ajanı | Reklamverenlere gösterim, tıklama ve dönüşüm raporlarını hazırlar. Kampanya sonu değerlendirmesini ve fatura verisini çıkarır. | Y3 | 4 |

Hedefleme yalnızca toplu segmentlerle ve geçerli izinlerle yapılır; tek bir kullanıcının verisi reklamverene hiçbir koşulda açılmaz.

### Pillika Barrier (P-BAR)

Pillika Barrier birimi akıllı bariyerin satışını, siparişini, kurulumunu, sahadaki bakımını ve CPO uygulamalarıyla entegrasyonunu yürütür; donanım geliştirme ve üretim Kutech'te, Pillika tarafındaki takibi Donanım ve Gömülü Sistemler biriminde. Sorumlusu donanım ürün sorumlusu ve saha operasyon sorumlusu; bağlandığı yerler cihaz izleme platformu, sipariş kayıtları, saha ekibi takvimi ve CPO entegrasyon ortamı. Başarısı; kurulu bariyer sayısı, cihazların çevrimiçi kalma oranı, arıza giderme süresi ve CPO'nun istasyonlarında azalan işgal süresiyle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-BAR-1 | Bariyer Satış Ajanı | Uygulama canlıya çıkana kadar CPO'ların doluluk ve işgal şikâyetlerinden, sonra uygulamadaki işgal bildirimlerinden hareketle hedef CPO'ları belirler. İşgal kaynaklı gelir kaybını bariyer maliyetiyle karşılaştıran geri dönüş hesabı ve teklif hazırlar. | Y1 | 2 |
| P-BAR-2 | Sipariş ve Konfigürasyon Ajanı | Adet, CPO markasına özel giydirme onayı, saha koşulları ve entegrasyon tipiyle sipariş kaydını açar. Kutech'e üretim siparişini hazırlar, teslim tarihini takip eder. | Y1 | 3 |
| P-BAR-3 | Kurulum ve Saha Ajanı | Saha keşif listesini (zemin, elektrik, iletişim), gerekli izinleri, kurulum takvimini, ekip rotasını ve İSG kontrollerini yönetir. Fotoğraflı kurulum raporunu hazırlar. | Y1 | 3 |
| P-BAR-4 | Cihaz İzleme ve Servis Ajanı | Sahadaki bariyerlerin çevrimiçi durumunu, motor ve sensör hatalarını izler. Arıza kaydı açar, uzaktan tanı adımlarını uygular, yedek parça ve teknisyen yönlendirmesini planlar. | Y2 | 3 |
| P-BAR-5 | Bariyer Entegrasyon Ajanı | CPO'ların kendi uygulamalarına bariyer entegrasyonu yaparken ihtiyaç duyduğu doküman, test ortamı ve teknik desteği sağlar. Pillika uygulamasının anlaşmalı istasyonlarda bariyer açabilmesini de takip eder. | Y2 | 3 |
| P-BAR-6 | Bayi ve Distribütör Ajanı | Yurt içi ve Orta Doğu'daki bayi ve distribütör adaylarını değerlendirir; başvuruları, sözleşme koşullarını, fiyat listelerini ve satış hedeflerini takip eder. | Y1 | 4 |

### Kullanıcı Destek (P-DES)

Kullanıcı destek birimi istasyonda sorun yaşayan sürücüye dakikalar içinde yardım eder; şarjı başlamayan sürücü için geç gelen yanıt, hiç gelmeyen yanıt kadar kötü. Sorumlusu destek sorumlusu; bağlandığı yerler uygulama içi sohbet, WhatsApp, oturum durumu, CPO uzaktan komutları ve ödeme kayıtları. Başarısı; ilk yanıt süresi, ilk temasta çözüm oranı, iade süresi ve memnuniyet puanıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-DES-1 | Canlı Destek Ajanı | Uygulama içi sohbet ve WhatsApp üzerinden sürücülere 7/24 ilk desteği verir: şarjın başlamaması, ödeme, hesap ve istasyon soruları. Oturum durumunu kontrol eder, tanımlı sınırlar içinde yeniden başlatma ya da durdurma komutu gönderir, çözemediğini insana aktarır. | Y2 | 3 |
| P-DES-2 | İade ve Uyuşmazlık Ajanı | Başarısız oturum, çift çekim ve hatalı ücret şikâyetlerini inceler, kanıtlarıyla iade kararı hazırlar. İade tek tıkla insan onayından geçer; onaylanan iadeyi ödeme sağlayıcısında başlatır ve CPO ile mutabakatı açar. | Y1 | 3 |
| P-DES-3 | Yardım Merkezi Ajanı | Tekrar eden destek konularından yardım makaleleri ve sık sorulan sorular üretip güncel tutar. Çözülemeyen kök nedenleri ürün ekibine iletir. | Y2 | 3 |

### Ödeme ve Mutabakat (P-ODE)

Bu birim kullanıcı ödemelerinin sorunsuz akmasını ve her CPO ile hesabın kuruşu kuruşuna tutmasını sağlar. Sorumlusu finans kararlarını veren kişi; bağlandığı yerler iyzico, PayTR ve Rubikpara panelleri, oturum ve şarj kayıtları ve Uyumsoft. Başarısı; başarısız ödeme oranı, mutabakat farkı, ay kapanış süresi ve dolandırıcılık kaybıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-ODE-1 | Ödeme İşlemleri Ajanı | Kart saklama, ön provizyon ve tahsilat akışlarını izler. Başarısız ödemeleri, olağan dışı işlem örüntülerini ve dolandırıcılık sinyallerini tespit edip ilgili akışı başlatır. | Y2 | 3 |
| P-ODE-2 | CPO Mutabakat Ajanı | CPO'lardan gelen şarj kayıtlarını Pillika'nın kendi kayıtları ve kullanıcı tahsilatlarıyla eşleştirir. Her CPO'ya ödenecek tutarı, komisyonu ve farkları hesaplar, aylık mutabakat ve fatura taslaklarını hazırlar. | Y1 | 3 |

CPO'lar adına kullanıcıdan tahsilat yapmak ödeme hizmetleri mevzuatına (6493 sayılı Kanun) takılabilir. Anlaşmalı ödeme kuruluşlarının pazaryeri çözümleri bu şartı karşılayabilir; yapı hukuk birimiyle netleştirilmeli.

### Araç Hizmetleri (P-HIZ)

Araç hizmetleri birimi sigorta ve kasko teklifi, MTV ve trafik cezası ödemesi gibi uygulama içi hizmetlerin iş ortaklarıyla sorunsuz çalışmasını sağlar. Sorumlusu iş ortaklıkları yöneticisi; bağlandığı yerler anlaşmalı acente ve sigorta şirketi entegrasyonları, ödeme ortakları ve hizmet kataloğu. Başarısı; tekliften poliçeye dönüşüm, işlem başarı oranı ve hizmet başına gelirle ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-HIZ-1 | Sigorta ve Kasko Ajanı | Anlaşmalı acente ve sigorta şirketi entegrasyonları üzerinden teklif akışının sağlığını izler, teklif ve dönüşüm oranlarını raporlar. İzin veren kullanıcılara poliçe yenileme hatırlatmalarını planlar. | Y2 | 4 |
| P-HIZ-2 | Araç Ödemeleri ve Ortaklar Ajanı | MTV ve trafik cezası ödeme entegrasyonlarının çalışmasını izler, başarısız işlemleri takip eder. Hizmet ortaklarının komisyon ve performans kayıtlarını tutar. | Y2 | 4 |

Sigorta teklifi için lisanslı bir acenteyle ortaklık gerekiyor.

### Büyüme ve Pazar Geliştirme (P-BUY)

Büyüme birimi yeni kullanıcı kazanır, kullanıcıları aktif tutar ve Pillika'yı Orta Doğu'ya taşıyacak pazar bilgisini hazırlar. Sorumlusu büyüme sorumlusu; bağlandığı yerler reklam panelleri, Firebase bildirimleri, e-posta, İYS, topluluk kanalları ve ürün analitiği. Başarısı; kullanıcı edinme maliyeti, aktif kullanıcı sayısı, 30 günlük elde tutma ve hedef pazarlarda kazanılan ortak sayısıyla ölçülür.

| Kod | Ajan | Görev ve temel işler | Yetki | Aşama |
| --- | --- | --- | --- | --- |
| P-BUY-1 | Kullanıcı Kazanım Ajanı | Mağaza reklamları, dijital kampanyalar, elektrikli araç toplulukları, bayilerle iş birlikleri ve davet programı gibi kanalların maliyetini ve verimini izler. Yeni kazanım deneyleri önerir. | Y1 | 3 |
| P-BUY-2 | Yaşam Döngüsü İletişim Ajanı | Araç ekleme ve ilk şarj gibi alışma adımları için bildirim ve e-posta akışları tasarlar. Yeniden kazanma ve kişiselleştirilmiş bildirimleri (rotadaki yeni istasyon, fiyat değişikliği gibi) planlar, ticari iletilerde İYS iznini kontrol eder. | Y1 | 3 |
| P-BUY-3 | Topluluk Ajanı | Elektrikli araç topluluklarını ve forumlarını izler, soruları ve şikâyetleri ilgili birime aktarır. Gönüllü elçi programını ve topluluk içeriklerini yürütür. | Y1 | 4 |
| P-BUY-4 | Uluslararası Pazar Ajanı | Orta Doğu başta olmak üzere hedef ülkelerde elektrikli araç yaygınlığını, CPO yapısını, mevzuatı, ödeme alışkanlıklarını ve yerel ortak adaylarını inceler. Ülke bazında pazar giriş notu hazırlar. | Y0 | 4 |

## Birimler Arası Akışlar

Ajanlar işi birbirine devrederek çalışır; bir ajanın çıktısı, bir sonrakinin girdisi olur. Aşağıdaki üç akış ofiste en sık tekrarlanacak işleri uçtan uca gösteriyor.

### Arma DX Müşteri Akışı

&#91;embedded content: Arma DX müşteri akışı · 5 aşama, 4 insan kararı\]

Dört noktada karar insanda: keşif onayı, yol haritası onayı, fiyat ve imza, kabul tutanağı. Bakım aşamasında Müşteri Sağlığı Ajanı yol haritasındaki sıradaki projeyi yeniden teklife taşır.

### Pillika Şarj Destek Akışı

&#91;embedded content: Pillika şarj destek akışı · 1 karar, 1 insan onayı\]

Sürücü sorunu bildirmeden ajan yazabilir, çünkü Şarj Oturumu İzleme Ajanı başlamayan oturumu anında yakalar. Para çıkışı gerektiren tek adım insan onayından geçer.

### Pillika Bariyer Döngüsü

&#91;embedded content: Pillika bariyer döngüsü · 6 adım, 1 insan kararı\]

Bariyer satışının hedef listesi Pillika'nın kendi verisinden çıkar; kurulan her bariyer de CPO izin verirse haritaya doluluk verisi ekler. Fiyat onayı ve CPO imzası insanda kalır.

Aylık kapanış ve yeni CPO entegrasyonu gibi diğer akışlar da aynı mantıkla birimler arasında ilerler; adımları görev kartlarına işlenecek.

## Ajan Kartı

Her ajan, çalışmaya başlamadan önce doldurulan bir görev kartıyla tanımlanır. Kart hem ajanın çalışma talimatı hem de insanların denetim belgesidir. Kataloğun geri kalanı onaylandıkça her rol için bu kart doldurulacak.

Pilot ajanlarının kartları ve araç kataloğu: Görev Kartları

### Kart Alanları

| Alan | Ne yazılır |
| --- | --- |
| Kod ve ad | Katalogdaki kod ve rol adı |
| Birim ve şirket | Bağlı olduğu birim; hangi şirkette açık olduğu |
| Amaç | Tek cümlelik görev tanımı ve iyi bir işin tarifi |
| Tetikleyiciler | İşin nasıl başladığı: insan talebi, zamanlanmış görev, sistem olayı ya da başka ajandan devir |
| Girdiler | Hangi veriyi, hangi kaynaktan, hangi biçimde aldığı |
| Çıktılar | Ne ürettiği, hangi şablonla ve kime teslim ettiği |
| Araçlar ve izinler | Hangi sisteme hangi yetkiyle (okuma, taslak, yazma) eriştiği; ajana özel servis hesabı |
| Bilgi kaynakları | Kurumsal hafızada okuyabildiği alanlar: şirket, müşteri, proje |
| Yetki seviyesi | Başlangıç ve hedef seviye, yükseltme koşulu |
| Onay noktaları | Hangi adımda kimin onayı gerektiği |
| Eskalasyon | Belirsizlik, hata ya da sınır aşımında işi kime ve nasıl aktardığı |
| Yasaklar | Hiçbir koşulda yapmayacağı işler |
| Ölçütler | Kalite, hız ve maliyet göstergeleri |
| İnsan sorumlu | Kartı onaylayan ve sonuçlardan sorumlu kişi |
| Sürüm | Kart sürümü, değişiklik tarihi ve değişikliği yapan |

### Örnek: Süreç Analizi Ajanı (A-KES-2)

| Alan | Değer |
| --- | --- |
| Birim ve şirket | Keşif ve Dönüşüm Danışmanlığı; yalnızca Arma DX |
| Amaç | Müşteri görüşmelerinden mevcut süreçleri çıkarmak ve iyileştirme fırsatlarını kanıtıyla işaretlemek. İyi çıktı, müşterinin kendi işini tanıdığı süreç haritasıdır. |
| Tetikleyiciler | Görüşme kaydının ya da notlarının müşteri proje alanına yüklenmesi; danışmanın talebi |
| Girdiler | Görüşme kaydı ve dökümü, danışman notları, müşteriden alınan form, rapor ve ekran görüntüleri, Sistem Envanteri Ajanının çıktısı |
| Çıktılar | Birim bazında süreç haritası (adım, rol, sistem, süre), sorun listesi (elle yapılan adım, tekrar eden veri girişi, bekleme, kaçan fırsat), müşteriye doğrulatılacak sorular |
| Araçlar ve izinler | Yalnızca ilgili müşteri proje alanında okuma ve taslak yazma. E-posta gönderemez, müşteri sistemlerine erişemez. |
| Bilgi kaynakları | O müşterinin proje alanı; Arma DX'in keşif yöntemi ve sektör şablonları. Diğer müşterilerin alanları kapalı. |
| Yetki seviyesi | Y1. Müşteriye giden her çıktı danışmandan geçtiği için yükseltme öngörülmüyor. |
| Onay noktaları | Süreç haritası ve sorun listesi müşteriyle paylaşılmadan önce sorumlu danışman onaylar. |
| Eskalasyon | Çelişen ifade ya da eksik adım bulursa tahmin yürütmez, soruyu danışmanın listesine ekler. |
| Yasaklar | Görüşmede adı geçen kişiler hakkında performans yorumu yapmaz; müşteri verisini proje alanı dışına taşımaz. |
| Ölçütler | Danışmanın düzeltme oranı, görüşme başına danışman saati, müşterinin onayladığı bulgu oranı |
| İnsan sorumlu | Projenin kıdemli danışmanı |
| Sürüm | 1.0, pilot başlangıcı |

### Örnek: Canlı Destek Ajanı (P-DES-1)

| Alan | Değer |
| --- | --- |
| Birim ve şirket | Kullanıcı Destek; yalnızca Pillika |
| Amaç | İstasyonda sorun yaşayan sürücünün sorununu ilk temasta çözmek; çözemiyorsa bekletmeden doğru kişiye aktarmak |
| Tetikleyiciler | Uygulama içi sohbet ya da WhatsApp mesajı; Şarj Oturumu İzleme Ajanından gelen "oturum başlamadı" olayı (bu durumda kullanıcıya ilk yazan ajan olur) |
| Girdiler | Kullanıcı mesajı, kayıtlı araç ve hesap bilgisi, oturum durumu, istasyonun güncel durumu ve güven puanı, ödeme kaydı |
| Çıktılar | Kullanıcıya yanıt; gerekiyorsa yeniden başlatma ya da durdurma komutu; kapanış notu; iade gerekiyorsa İade ve Uyuşmazlık Ajanına devir |
| Araçlar ve izinler | Oturum durumunu ve hesabı okuma; CPO'ya tanımlı uzaktan komutları oturum başına sınırlı sayıda gönderme. Ödeme ve iade yetkisi yok. |
| Bilgi kaynakları | Yardım merkezi, istasyon ve CPO bilgileri, bilinen arızalar listesi |
| Yetki seviyesi | Y2: tanımlı sınırlar içinde kendisi uygular |
| Onay noktaları | Sınır dışındaki her işlem (iade, hesap kapatma, kural dışı istek) insana gider. |
| Eskalasyon | Kullanıcı istediğinde ya da aynı sorunda ikinci deneme de başarısız olduğunda insana aktarır. Yangın, yaralanma ya da sıkışan kablo gibi güvenlik riskinde önce kullanıcıyı 112'ye yönlendirir, sonra insana aktarır. |
| Yasaklar | Kesin olmayan bilgiyi kesinmiş gibi söylemez, CPO adına taahhütte bulunmaz, kart bilgisi gibi hassas veriyi sohbette istemez. |
| Ölçütler | İlk yanıt süresi, ilk temasta çözüm oranı, insana aktarım oranı, memnuniyet puanı |
| İnsan sorumlu | Destek sorumlusu |
| Sürüm | 1.0 |

## Platform Mimarisi

Platform altı katmandan oluşur ve her katman şirket bazında ayrılır. 173 rol ayrı ayrı kurulmaz; birim ajanları rolleri yetenek olarak yükler.

&#91;embedded content: platform katmanları · 6 katman, güvenlik ve kiracı ayrımı hepsini keser\]

İş yukarıdan aşağı akar: talep arayüzden gelir, koordinasyon onu doğru ajana verir, ajan araç, hafıza ve model katmanını kullanır. Güvenlik kuralları ve kiracı ayrımı bütün katmanlarda geçerli. Hafıza katmanı, panelin içinde Obsidian gibi çalışan ve birbirine bağlı markdown notlardan oluşur.

| Karar | Öneri | Gerekçe |
| --- | --- | --- |
| Arayüz | Agent Office web paneli; her cihazdan erişilir, onaylar telefondan da verilir | Ekip ofisle tek yerden çalışır; kurucu onayları beklemeden verebilir |
| Kimlik | Google Workspace hesabıyla giriş ve zorunlu iki adımlı doğrulama; rol ve şirket bazlı yetki | Ekip zaten Google Workspace kullanıyor; ayrı şifre yönetimi gerekmez |
| Görev takibi | Panelin içinde, ajanların görev kaydıyla aynı yerde; Jira gibi bir araca yalnızca bir müşteri projesi gerektirirse bağlanılır | Ajanlar zaten bir görev kaydına ihtiyaç duyuyor; insan ve ajan işleri tek listede kalır, ayrı araç ve entegrasyon maliyeti doğmaz |
| Müşteri ve fırsat takibi | Pilotta panelin içinde basit bir müşteri ve fırsat listesi; zamanla kendi CRM'inize dönüşür | CRM ihtiyacı iş akışınıza göre büyür; ileride ürün olarak da sunulabilir |
| Rol ve ajan ilişkisi | Her birimde bir ya da birkaç ajan; roller görev kartı ve yetenek olarak yüklenir | Bakım yükü birim sayısıyla sınırlı kalır; yeni rol eklemek ayar işidir |
| Model | Claude modelleri; zor işe güçlü, rutin işe hızlı model. Kurum içi model yalnızca bir müşteri şart koşarsa | Maliyet düşer; hassas müşteri verisi için ayrı yol açık kalır |
| Veri ve barındırma | Veri bulutta, şirket bazında ayrılmış veritabanında; barındırma AWS ya da Cloudflare Workers, veritabanı Supabase ya da yönetilen bir PostgreSQL | Her cihazdan erişim şartı karşılanır; satır düzeyi güvenlik kiracı ayrımını veritabanında zorunlu kılar |
| Entegrasyon | Her dış sistem için bir MCP bağlayıcısı; ajana yalnızca kartındaki bağlayıcılar açılır | Yetki tek yerden yönetilir; yeni sistem eklemek ajanları değiştirmez |
| Ölçüm | Model kullanımı ve maliyet ilk günden iş başına ölçülür; iç işler ve projeler ayrı izlenir | Proje maliyeti o projenin bütçesine yazılır, iç işler hesap limitleri içinde izlenir |
| Yedek yol | Koordinatör devre dışıyken birimlere doğrudan erişim | Tek hata noktası riski azalır |

Ofis büyüdükçe üç konuya yeniden bakılmalı: tek koordinatörün yükü, bilgi tabanındaki arama kalitesi ve kullanımla büyüyen model maliyeti.

## Güvenlik ve Uyum

Riskin büyük kısmı iki yerden doğar: ajanların dışarıdan gelen içeriği okuması ve gereğinden geniş yetkiyle çalışması. Bu yüzden en küçük yetki, insan onayı ve iz kaydı her ajanda birlikte uygulanır.

| Konu | Risk | Önlem |
| --- | --- | --- |
| Kişisel veri (KVKK) | Kullanıcı, çalışan ve müşteri verisinin modele gönderilmesi; yurt dışındaki model sağlayıcısına aktarım | Veri envanteri; gereksiz kişisel veriyi modele göndermeden maskeleme; yurt dışına aktarım için KVKK'nın öngördüğü bir yolun (standart sözleşme gibi) avukatla kurulması; hassas işlerde kurum içi model |
| Müşteri gizliliği | Arma DX'te bir müşterinin bilgisinin başka bir müşterinin işinde kullanılması, gizlilik sözleşmesinin ihlali | Proje bazında ayrı bilgi alanı ve erişim; ajan yalnızca atandığı projeyi görür; müşteri sözleşmesi AI kullanımına izin vermiyorsa o projede ajan çalışmaz |
| İstem enjeksiyonu | E-postada, CPO veri akışında, ihale dokümanında, web sayfasında ya da kullanıcı mesajında gizlenmiş talimatın ajanı yanlış işe yönlendirmesi | Dışarıdan gelen her içerik talimat değil veri olarak işlenir; bu içeriği okuyan ajanların yazma yetkisi dar tutulur; dışa etkisi olan her adım onaydan geçer |
| Aşırı yetki | Geniş yetkili bir ajanın hatası ya da ele geçirilmesi | Her ajana ayrı servis hesabı, en küçük yetki, dönemsel yetki gözden geçirmesi (BT-2) |
| Panelin internete açık olması | Çalınan bir hesapla ofisin ajanlarına ve verisine erişilmesi | Google hesabıyla giriş ve zorunlu iki adımlı doğrulama, kısa oturum süresi, önemli onaylarda yeniden doğrulama, Cloudflare ile saldırı koruması |
| Para ve taahhüt | Hatalı ödeme, iade, fiyat ya da sözleşme taahhüdü | Bu işlerde ajan en fazla Y1; ödeme ve iade tek tıkla da olsa insan onayıyla yapılır |
| Gizli anahtarlar | API anahtarlarının ve şifrelerin sızması | Anahtarlar kasada tutulur, ajana doğrudan verilmez; kod ve kayıtlarda gizli anahtar taraması (YAZ-7) |
| Uydurma bilgi | Ajanın kaynaksız ya da yanlış bilgi vermesi | Kaynak gösterme zorunluluğu; bilgi yoksa bilmediğini söyleme; Kalite Denetim Ajanının düzenli örneklemesi |
| Hesap verebilirlik | Bir hatanın nereden çıktığının bulunamaması | Her talep, kullanılan veri, çıktı ve onay iz kaydında; saklama süresini hukuk birimi belirler |
| Sektör mevzuatı | Ödeme hizmetleri (6493), sigorta aracılığı, İYS, EPDK düzenlemeleri, kamu ihale kuralları | Mevzuat Takip Ajanı; yeni bir ürün ya da akış canlıya çıkmadan önce hukuk kontrol listesi |

Bu bölüm hukuki görüş yerine geçmez. KVKK ve ödeme konuları kurulumdan önce avukat tarafından gözden geçirilmeli.

## Geçiş Planı

Ofis bir hazırlık adımı ve dört aşamayla kurulur; bir aşamanın kapısı geçilmeden sonrakine başlanmaz. Pilotun takvimi aşağıda; sonraki aşamaların tarihleri pilot sonuçlarına göre belirlenecek.

&#91;embedded content: geçiş planı · hazırlık, 4 aşama, 4 kapı ve ayrı ürünleşme hattı\]

Pilot seti 14 ajandan oluşur: KOR-1 ile KOR-5 arası, HAF-1, HAF-2, A-KES-2, A-TEK-2, A-PRJ-2, P-IST-1, TAS-3, TAS-6 ve SOS-2. Aşama 0 ajan içermez; web panelini, güvenlik ve veri temelini kurar.

| Kapı | Geçiş ölçütü |
| --- | --- |
| Altyapı hazır | Kiracı ayrımı veritabanında zorunlu; kimlik, yetki ve iz kaydı çalışıyor; bilgi tabanının ilk yüklemesi tamam; pilot işlerin bugünkü süreleri ölçüldü |
| Pilot hedefte | Pilot ajanlarda ilk seferde onay oranı ve zaman kazancı hedefte; son 30 günde kritik hata yok; ekip ofisi düzenli kullanıyor |
| Çekirdek oturdu | Çekirdek birimler günlük işte kullanılıyor; iş başına maliyet bütçe içinde; Kalite Denetim Ajanı düzenli rapor veriyor |
| Ürün canlıda | Genişleme ajanlarının bağlı olduğu ürün ya da iş (ADS, ihale, AI projesi) canlıda; hukuk kontrol listesi tamam |

Pilot, 10 Ekim hedefine göre iki adımda kurulur: 10 Ekim'de panel çekirdeği ve 8 ajanla açılır, kalan 6 ajan Ekim sonuna kadar eklenir. Kapı ölçütleri için pilotun en az 4 hafta ölçülerek çalışması gerekir.

| Tarih | Yapılacak |
| --- | --- |
| 30 Eylül-3 Ekim | Aşama 0 çekirdeği: web panel iskeleti, giriş ve yetki, şirket bazında veri ayrımı, iz kaydı, görev kaydı ve Onay Masası |
| 4-6 Ekim | Bilgi tabanının ilk yüklemesi; Ofis Koordinatörü, Görev Takip, Onay Masası, Bilgi Tabanı ve Kurumsal Arama ajanları |
| 7-10 Ekim | İlk iş ajanları: Teklif, Proje Takip ve Sosyal İçerik Yazım; pilot 8 ajanla açılır |
| 11-31 Ekim | Kalan 6 pilot ajanı: Yönetici Asistanı, Toplantı, Süreç Analizi, İstasyon Veri Toplama, UI/UX Tasarım, Sosyal Medya Görsel |
| Kasım | Pilot en az 4 hafta ölçülerek çalışır; Pilot hedefte kapısı değerlendirilir |

## Ölçütler

Ofisin değeri dört soruyla ölçülür: ne kadar iş yaptı, ne kadar doğru yaptı, ne kadar zaman kazandırdı, kaça mal oldu. Ajan düzeyindeki ölçütler görev kartlarında; aşağıdakiler ofis düzeyinde izlenir.

| Ölçüt | Tanım | Kaynak | Hangi karara girer |
| --- | --- | --- | --- |
| Tamamlanan iş | Ajanların haftada bitirdiği iş sayısı, birim ve şirket bazında | Görev Takip Ajanı | Birimlerin yük dağılımı |
| İlk seferde onay oranı | Onay Masası'nda düzeltmesiz onaylanan işlerin payı | Onay Masası kayıtları | Yetki yükseltme |
| Onay bekleme süresi | Bir işin Onay Masası'nda onay beklediği süre | Onay Masası kayıtları | Onay turlarının sıklığı ve onay yetkisinin devri |
| Düzeltme nedenleri | En sık düzeltme ve ret gerekçeleri | Onay Masası kayıtları | Görev kartı iyileştirmesi |
| Kazanılan insan saati | İş başına eski süre ile yeni süre arasındaki fark | Görev Takip Ajanı ve pilot öncesi ölçüm | Yatırımın geri dönüşü |
| Yanıt ve teslim süresi | Talepten sonuca geçen süre | Görev Takip Ajanı | Hizmet kalitesi |
| İş başına maliyet | Model, araç ve altyapı maliyetinin iş sayısına bölümü; iç işler ve projeler ayrı | Maliyet ve Kullanım Ajanı | Model seçimi ve proje bütçesi |
| Kritik hata sayısı | Dışarıya yanlış çıkan ya da zarar doğuran iş sayısı | İz kaydı ve Kalite Denetim Ajanı | Yetki düşürme, süreç düzeltme |
| Kullanım oranı | Ofisi haftada en az bir kez kullanan çalışanların payı | Koordinatör kayıtları | Benimseme ve eğitim ihtiyacı |

Kazanılan zamanın ölçülebilmesi için pilottan önce seçilen işlerin bugünkü süreleri kaydedilmeli. Bu yapılmazsa ofisin değeri tahmine kalır.

## Riskler

En büyük risk teknik değil: çok sayıda ajanı aynı anda açıp hiçbirini iyi yönetememek. Aşağıdaki önlemlerin çoğu geçiş planına ve görev kartlarına zaten işlendi.

| Risk | Neden önemli | Önlem |
| --- | --- | --- |
| Çok ajanı birden açmak | Bakım yükü büyür, hangi ajanın neden hata yaptığı anlaşılmaz. | Aşamalı geçiş; bir aşamanın kapısı geçilmeden sonrakine başlanmaz; roller birim ajanlarında yetenek olarak toplanır. |
| Onay yükünün tek kişide toplanması | Başlangıçta bütün onaylar kurucuda; kuyruk birikirse ajanlar bekler ve ofis yavaşlar. | Günde bir ya da iki toplu onay turu, Onay Masası'nda önceliklendirme, telefondan onay, düşük riskli işlerde ölçülen başarıya göre daha hızlı Y2 ve onay yetkisinin zamanla ekibe devri. |
| Zayıf kurumsal hafıza | Ajanlar eksik ya da eski bilgiyle çalışır, ekibin güveni kaybolur. | Pilottan önce bilgi tabanının ilk yüklemesi, tek doğru kaynak sayfaları, pilotta Bilgi Tabanı Ajanı. |
| Belirsiz sorumluluk | "Ajan yaptı" denip kimse sahiplenmez; ekip ajan çıktısını kontrolsüz kabul etmeye başlar. | Her ajanın adıyla bir insan sorumlusu, Onay Masası'nda onaylayanın kaydı, düzenli kalite örneklemesi. |
| Koordinatörün tek hata noktası olması | Koordinatör çökerse ya da yanlış yönlendirirse bütün ofis durur. | Birimlere doğrudan erişim yolu açık kalır; yönlendirme kararları kayıtlı ve düzeltilebilir. |
| Güvenlik olayı | İstem enjeksiyonu ya da sızan anahtarla yetkisiz işlem yapılır. | Güvenlik ve Uyum bölümündeki önlemler, olay müdahale kılavuzu. |
| Maliyetin kontrolden çıkması | Yoğun kullanımda model maliyeti beklenenin üstüne çıkar. | Ajan bazında bütçe ve uyarı, rutin işte hızlı model, Maliyet ve Kullanım Ajanı. |
| Mevzuata aykırı akış | Ödeme, sigorta aracılığı ya da KVKK kurallarına aykırı bir akış canlıya çıkar. | Canlı öncesi hukuk kontrol listesi, Mevzuat Takip Ajanı. |
| Avukat kontrolü olmadan hukuki metin | Hukuk desteği azaltılırsa ajanların hazırladığı sözleşme ve KVKK metinleri kontrolsüz imzaya gidebilir. | Gerektiğinde çağrılan bir avukat, kritik sözleşmelerde imza öncesi kontrol, Sözleşme Ajanının riskli maddeleri işaretlemesi. |
| Ekibin benimsememesi | Ekip ofisi kullanmaz ve işler eski yoldan yürür; ya da ajanlara fazla güvenir. | Pilotta gönüllü öncü kullanıcılar, ilk işlerin zaman kazancının görünür kılınması, kısa eğitimler. |
| Dış ortaklarla kopukluk | Muhasebe mali müşavirde, bariyer donanımı Kutech'te; ajanların hazırladığı iş dış tarafa ulaşmayabilir ya da geri dönüşü kaybolabilir. | Dış Kaynak ve Serbest Çalışan Ajanı, ortak teslim şablonları, her dış işin görev kaydında izlenmesi. |
| Tek üreticiye bağımlılık | Bariyerin donanımı ve üretimi tek firmada; anlaşmazlıkta üretim durabilir. | Sözleşmeye göre bütün proje dosyaları ve haklar Pillika'ya devredilecek; devrin takibi, dosyaların eksiksiz teslim alınması ve alternatif üretici seçeneğinin hazır tutulması. |
| Müşteri güveni | Arma DX müşterisi verisinin AI ile işlenmesinden rahatsız olur. | Sözleşmelerde AI kullanım maddesi, proje bazında izin, gerektiğinde kurum içi model. |
| Tek model sağlayıcısına bağımlılık | Yalnızca Claude'a bağlı kalmak fiyat ve süreklilik riski yaratır. | Model katmanı değiştirilebilir tasarlanır; görev kartları modelden bağımsız yazılır. |

## Ürünleşme

Ofis baştan çok kiracılı ve ayarla tanımlanan bir yapıda kurulursa, Arma DX aynı altyapıyı başka firmalara kod değişikliği yapmadan kurabilir. Bu yol, ofis iç kullanımda kendini kanıtladıktan sonra açılmalı.

| Adım | Ne yapılır | Ön koşul |
| --- | --- | --- |
| İç kanıt | Pilot ve çekirdek aşamanın ölçütleri tutturulur. | Aşama 2 kapısının geçilmesi |
| Sektör şablonu | Katalogdan sektöre özel birim ve rol seti çıkarılır; örneğin otomotiv, lojistik ya da perakende için. | Görev kartlarının şirketten ve modelden bağımsız yazılmış olması |
| Kiracı açılışı | Yeni firma için ayrı veri alanı, kimlik ve erişim, bilgi tabanı yüklemesi ve entegrasyonlar kurulur. | Kiracı ayrımının veritabanı düzeyinde zorunlu tutulması |
| Keşifle kurulum | Kurulum Arma DX'in keşif yöntemiyle başlar; hangi rollerin açılacağı müşterinin süreçlerine göre seçilir. | Keşif birimi ajanlarının çalışır durumda olması |
| Güvence paketi | Veri işleme sözleşmesi, SLA, güvenlik belgeleri ve gerekiyorsa kurum içi model sunulur. | Uyum ve Sertifikasyon Ajanı, AI Güvenlik ve Yönetişim Ajanı |
| İlk dış pilot | Süreçleri zaten keşfedilmiş bir müşteriyle sınırlı kapsamlı pilot yapılır. | Müşterinin onayı ve sözleşme |

Fiyat modeli şimdilik açık. Kurulum bedeli ile kullanıma bağlı aylık ücretin birleşimi, Arma DX'in bugünkü proje ve bakım modeline en yakın seçenek.

## Açık Sorular

Bütün sorular yanıtlandı; pilot sırasında çıkan yeni sorular buraya eklenecek.

### Kullanılan Yazılımlar

Her satırda bugün kullanıldığı varsayılan yazılım yazıyor. Durum sütunundan varsayımın doğru olup olmadığı seçilir; farklıysa doğru araç Doğrusu sütununa yazılır.

| Süreç | Varsayım | Durum | Doğrusu |
| --- | --- | --- | --- |
| E-posta ve takvim | Google Workspace (Gmail, Google Takvim) | Doğru |  |
| Dosya ve doküman saklama | Google Drive | Doğru |  |
| Ekip içi yazışma | WhatsApp | Doğru |  |
| Online toplantı | Google Meet | Doğru |  |
| Görev ve proje takibi | Ayrı araç yok; yazışma ve Excel ile takip | Kısmen | Task yönetimi için bir program kullanmayı düşünüyoruz ama emin değiliz jira vsde kullanabiliriz ama onun yerine Agent Office web platformu üzerine bir task managmentta yapabailiriz diye düşündük. Ama bu zor olacaksa yada mantıksız olacaksa Jira gibi bir program kullanabiliriz. |
| Müşteri ve fırsat takibi (CRM) | Ayrı araç yok; Excel ya da Google E-Tablolar | Kısmen | Evet CRM için bir program kullanmıyoruz. İlerleye süreçte firmalarımız için kendi ihtiyaçlarımız doğrultusunda CRM üretip kendimiz için onu kullanmayı düşünebiliriz. |
| Teklif hazırlama | Word ya da Google Dokümanlar, PDF olarak gönderim | Doğru |  |
| Sözleşme hazırlama ve imza | Word, ıslak imza | Doğru | İlerleyen süreçte imza süreçlerini güvenilir bir online imza platformuna taşıyabiliriz. |
| Ön muhasebe ve fatura kesme | Paraşüt gibi bir ön muhasebe programı | Doğru | Uyumsoftu kullanıyoruz. |
| e-Fatura ve e-Arşiv | Ön muhasebe programının entegratörü | Doğru |  |
| Muhasebe kayıtları ve beyannameler | Mali müşavirin kendi programı | Doğru |  |
| Banka işlemleri | İnternet bankacılığı; muhasebeyle bağlantı yok | Doğru |  |
| Bordro ve SGK bildirimleri | Mali müşavir | Doğru |  |
| Kod deposu | GitHub | Doğru |  |
| Barındırma ve sunucu | Cloudflare | Kısmen | Cloudflarei biz daha çok dns yönelndirmede kullanuyoruz. Bunun dışında IHS yi domain satın alma için kullanıyoruz. barındırmayıda projeye göre değişiyor bazen AWS den sunucu kiralıyoruz basit bir şey ise cloudflare workerda olaibliyor değişiyor tamamen profesyonelliğe bağlı. |
| Veritabanı | Supabase | Kısmen | Veritabanı olarak supabasede olabilir başka çözümlerde olabilir. Direkt suncuda db suncusu olarakta konfig edilebilir. |
| Tasarım | Figma | Doğru | Figma, Claude Design, Adobe Photoshop, Adobe Illustrator, Adobe Premier Pro,\
\
Bu programları çeşitli amaçlar için kullanıyoruz. Bazıları kreatif işlerde bazıları video editlemede bazıları UI/UX te. |
| API geliştirme ve test | Postman | Doğru |  |
| Mobil uygulama analitiği ve hata takibi | Firebase (Analytics, Crashlytics) | Doğru |  |
| Anlık bildirim | Firebase Cloud Messaging | Doğru |  |
| Uygulama içi ödeme | iyzico | Doğru | iyzico, paytr ve rubikpara firmaları ile anlaşmalarımız var müşterininde anlaşma sağladığı yerlerde müşteri talebi doğrultusunda farklı altyapılarıda kullanabiliyoruz.&#32; |
| Harita | Google Maps Platform | Doğru |  |
| Uygulama mağazaları | App Store Connect ve Google Play Console | Doğru |  |
| Kullanıcı destek kanalı | WhatsApp Business | Doğru |  |
| Sosyal medya yönetimi | Dış ajans; Meta Business Suite | Doğru |  |
| Web siteleri | Cloudflare Pages üzerinde özel geliştirilmiş siteler | Doğru |  |
| E-posta pazarlama | Kullanılmıyor | Doğru |  |
| Şifre ve erişim yönetimi | Ayrı araç yok; Google hesabıyla giriş | Doğru |  |
| CPO bağlantıları | OCPI ile doğrudan bağlantı | Kısmen | OCPI uyumlu olmayan firmalar için kendimiz bir ayrı entegrasyon geliştiriyoruz.&#32; |
| Kamu ihaleleri | EKAP, e-imza ile | Doğru |  |
