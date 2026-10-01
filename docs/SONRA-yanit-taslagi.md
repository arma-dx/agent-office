# SONRA.md yanıt taslağı

Tarih: 1 Ekim 2026, tasarım raporuna göre güncellendi. Durum: kurucunun onayını bekliyor, depoya henüz işlenmedi.

Bu dosya `docs/SONRA.md` içindeki açık sorulara önerilen yanıtları içerir. Öneriler `docs/agent-office-tasarım-raporu.md` ile uyumlu tutuldu; raporun açıkça yanıtladığı yerlerde "Rapor:" diye belirtildi. Her maddede önce öneri, gerekiyorsa seçenekler var. "Senden" diye işaretli yerler kurucunun vermesi gereken bilgidir; bunlar olmadan madde kapanmaz. Kurucu onayladıktan sonra Claude Code kararları CLAUDE.md, PLAN.md ve kartlara işler, SONRA.md'den siler.

## Genel ilkeler

Maddelerin çoğu bu beş ilkeden çıkıyor. İlkeler onaylanırsa ayrıntıların büyük kısmı kendiliğinden kapanır.

1. **Kural kodla uygulanır.** Bir kural ajana iki yolla konabilir: talimatına "şunu yapma" yazılarak ya da panelin yazılımının o işe hiç izin vermemesiyle. Talimata model büyük ihtimalle uyar ama garantisi yok; hata yapabilir ya da bir e-postaya gizlenmiş talimatla kandırılabilir. Örnek: KOR-2'nin kartında "görevi iptal etmez" yazıyor. Kodla uygulanırsa KOR-2 iptal etmeye çalışsa bile sistem reddeder, iptal yalnızca insanda çalışır. İlke: kodla denetlenebilen her kural kodla uygulanır; talimat yalnızca kodun ölçemeyeceği işler için kalır ("metin samimi olsun" gibi).
2. **Pilotta bütün onaylar kurucuda.** Onay yetkisini başkasına devretmek Aşama 2 işi.
3. **Dışarı çıkış insan eliyle.** Onaydan sonra gönderme, paylaşma ve yayınlama kişinin kendisi tarafından yapılır ve panelde işaretlenir.
4. **Kaynağı olmayan girdi pilotta karttan çıkar.** Bazı kartlar panelde henüz olmayan bir veriyi kullanıyormuş gibi yazılmış. Örnek: TAS-3'ün kartında "kullanıcı geri bildirimleri ve analitik" girdisi var ama bu veriyi okuyacak bir araç yok. Böyle bir bölüm kartta kalırsa ajan ya onu hiç kullanamaz ya da eksiği tahminle doldurur. İlke: pilotta bu bölümler karttan çıkar ve SONRA.md'ye yazılır; araç ya da veri gelince geri konur. İstisna: raporun açıkça istediği işler (ör. A-PRJ-2'nin bütçe karşılaştırması) çıkarılmaz, eksik veri raporda açıkça belirtilir.
5. **Saat Europe/Istanbul, iş günü Pazartesi-Cuma.**

## Senden gereken bilgiler

Bunlar olmadan ilgili maddeler kapanmaz:

- KVKK ve yurt dışına aktarımı onaylayacak hukuk danışmanı (X1-3, X2-2).
- Marka kitleri, şablonlar ve onaylı görsel arşivi bugün nerede duruyor (M38).
- Pillika'nın mevcut istasyon kayıtları nerede ve nasıl tutuluyor (M52).
- Sprint 1 skill'leri için gerçek dokümanlar (yonlendirme, gorev-takibi, onay-ozeti, not-yazimi, karar-notu, kaynakli-yanit). Sprint 1 4 Ekim'de başlıyor (M43).
- Ajan ve proje bazında uyarı eşikleri (X1-4). Rapora göre iç işlerde durduran bir sınır yok, yalnızca uyarı.
- Görev güncelleme kuralındaki "sahibi" atanan mı, talep sahibi mi (M17).
- Workspace planında Meet transkripti açık mı (M50).
- Pillika Workspace'inde bağlantı istemcisini açabilecek yönetici yetkin var mı (X2-1).
- Oturum süresi ve yeniden doğrulama isteyecek onaylar (R7).
- Mevcut müşteri sözleşmelerinde AI kullanımına dair madde var mı (R8).
- Pilot hedefte kapısının sayısal hedefleri (R11) ve onay turu saatleri (R12).
- Kurumsal Hafıza için iki şirketteki bilgi sahipleri (R15).

## Hukuk ve KVKK

- **M12. Kayıtlarda ne tutulur.** Öneri: `iz_kaydi` değiştirilemediği için oraya hiç ham içerik yazılmaz; yalnızca kaynak kimliği (e-posta ya da dosya kimliği), araç adı ve kısa özet. `calismalar` ham araç sonucunu tutar ve bu içerik belirli bir süre sonra silinir; özet ve kimlikler kalır. Rapor: saklama süresini hukuk belirler. Pilot için başlangıç önerisi 90 gün, avukat onaylayana kadar.
- **M36. Kayıt bildirimi ve izinler.** Öneri: toplantı kaydı yüklenirken "katılımcılara kayıt bildirildi" kutusu zorunlu; işaretlenmeden dosya işlenmez. Fotoğraf ve müşteri referans izni pilotta onay sırasında kurucuda kalır; çıktıda görsel ya da müşteri adı varsa onay kartında kodla hesaplanan bir uyarı çıkar. İzin alanlarının müşteri ve görsel kayıtlarına eklenmesi Aşama 2.
- **M37. Hassas veri içeren belgeler.** Öneri: iki katman. Hassas belgeler izinli klasörlere konmaz (klasör düzeni kuralı). Ayrıca `belge_ice_aktar` kimlik numarası (TCKN doğrulama algoritmasıyla), IBAN (mod 97) ve kart numarası (Luhn) arar; bulursa belgeyi içe aktarmaz, maskeli önizlemeyle onaya düşürür. Maskeleyip kendiliğinden devam etmek önerilmez, maskeleme kaçırabilir.
- **X1-3. Yurt dışına aktarım.** Senden: hukuk danışmanının adı. Teknik öneri: Supabase ve AWS için AB bölgesi (Frankfurt); Claude API ABD'de işler. Anthropic, Supabase ve AWS'nin veri işleme sözleşmeleri indirilip danışmana verilir. A-KES-2 müşteri görüşmelerini işlediği için müşteri sözleşmelerine alt işleyen maddesi eklenmesi önerilir; son söz danışmanın.
- **X2-2. Dayanak hazır olmadan açılış.** Öneri: HAF-1 ve HAF-2 10 Ekim'de açılır, ama izinli klasörlere yalnızca kişisel veri içermeyen şirket belgeleri (profil, ürün bilgisi, ücret kartı, teklif kuralları) konur. KOR-4, KOR-5 ve A-KES-2 standart sözleşmeler imzalanıp Kurum'a bildirim yapılmadan açılmaz. Pilot açılış kontrollerine bu madde eklenir.

## Veri modeli görevi

- **M4. Tek doğru kaynak işareti.** Öneri: `notlar` tablosunda iki ayrı alan: `tek_dogru_kaynak` (evet ya da hayır) ve `durum` (`etkin`, `eskimis`, `arsiv`). İşareti yalnızca kurucu koyar ve kaldırır; bu API ve RLS ile uygulanır. Ajan işaret koyamadığı için `not_yaz` ile açılan not tek doğru kaynak olamaz, yarışan ikinci not sorunu böylece kapanır. HAF-1 aynı konuda çakışma görürse kurucuya bildirir.
- **M8. Şirket kısa kodu.** Onay: `sirketler.kod` alanı, benzersiz.
- **M14. Notun kaynak türü.** Öneri: evet, `kaynak_turu` alanı (`ic`, `dis`). Dış kaynaktan türeyen not, bir kişi düzenlese de `ic` olmaz; yalnızca kurucunun "doğrulandı" işaretiyle `ic` olur. İstemin talimat bölümüne yalnızca tek doğru kaynak notlar ve kurucunun işaretlediği notlar girer; geri kalan her not işaretli veri bölümünde verilir.
- **M31. Üst görev ve alt görevin bitmesi.** Öneri: `gorevler.ust_gorev_id` eklenir. Alt görev sonuçlanmış sayılır: `tamamlandi`, `iptal` ya da onayı reddedildiği için iptal edilmiş. Hepsi sonuçlanınca KOR-1 birleştirir ve talep sahibine neyin yapıldığını, neyin neden yapılmadığını döner. İki şirketi kapsayan talepler pilotta bölünmez: KOR-1 talebi açıldığı şirkette yürütür ve kurucuya "diğer şirkette de açılmalı" önerisi bırakır (RLS'i delmeden, M7 ile aynı yol).
- **M38. Üretilen dosyalar.** Öneri: yeni `dosyalar` tablosu (`sirket_id`, `proje_id`, çalışma, tür, depolama yolu, onay). `belgeler` yalnızca Drive'dan gelen kaynaklar için kalır. Senden: marka kitleri, şablonlar ve görsel arşivi bugün nerede. Öneri: Drive'da şirket başına izinli bir klasörde durur, panel yalnızca okur.
- **M39. Birimler.** Rapor 37 birimin kodunu, adını ve açıklamasını veriyor; liste rapordan alınır. Öneri: global `birimler` tablosu (kod, ad, açıklama, grup: ortak, armadx, pillika), depodaki `agents/birimler.yaml` dosyasından kartlarla birlikte senkronize edilir; `gorevler.birim_kod` eklenir. Ortak birimler iki şirketin ofisinde de görünür. Pilotta yalnızca pilot ajanı olan sekiz birim açılır: KOR, HAF, SOS, TAS, A-KES, A-TEK, A-PRJ, P-IST.

## Giriş görevi (M1)

- **M54. VPN'e geçişte dış kişiler.** Öneri: ileride Cloudflare Access ile ağa değil yalnızca panele kimlik tabanlı erişim. Şimdi yapılacak tek hazırlık: oturum mantığı ağ konumuna bağlı yazılmaz. Ek iş yok.
- **İki adımlı doğrulama.** Google giriş yanıtı iki adımlı doğrulamanın açık olduğunu büyük olasılıkla güvenilir biçimde bildirmiyor; giriş görevinde doğrulanır. Öneri: kuruluş hesaplarında Workspace yöneticisi zorunlu kılar; `dis_kisi` rolündekiler için panelde doğrulayıcı uygulama kodu (TOTP) ek adımı zorunlu. PLAN'daki satır buna göre düzeltilir.

## Onay Masası (M3) ve bildirimler (M9)

- **M1. Taslak düğmeleri.** Öneri: dış alıcıya gidecek taslaklarda (KOR-5 tutanağı ve diğerleri) kopyalama ve "Gmail'de aç" düğmeleri yalnızca onaydan sonra açılır. İstisna KOR-4: taslak kurucunun kendi yanıtı ve göndereni de kurucu olduğu için düğmeler hemen açık. Açma ve kopyalama her durumda `iz_kaydi`'na yazılır.
- **M3 ve M55. Bildirim e-postası ve dış kişi.** Öneri: e-posta bildirimi yalnızca sabit şablon ve panel bağlantısı taşır, içerik taşımaz; bu yüzden onaysız kalabilir. `dis_kisi` rolündeki üyeye de gidebilir, ama yalnızca kendisine atanmış görev için. "Dış kişi" rolle belirlenir, alan adıyla değil. KOR-4'ün "e-posta göndermez" yasağı kurucuya giden bildirimi kapsamaz.
- **M18. A-KES-2 onayı.** Rapor: başlangıçta bütün onaylar kurucuda, yetki zamanla ekibe devredilir. Öneri: pilotta onaylar kurucuda; karttaki "danışman" yorumu ayrı bir alana taşınır (ör. `devir_sonrasi_sorumlu: proje_danismani`). Onay yetkisinin proje bazında devri Aşama 2.
- **M21. KOR-3'ün etkisi.** Öneri: evet. Dış alıcı, fiyat ya da tutar, tek doğru kaynak değişikliği ve dış kaynaklı içerik işaretleri kodla hesaplanır ve onay kartında KOR-3'ün değiştiremeyeceği ayrı bir satırda görünür. Bu işaretlerden biri varsa fark ekranı açık gelir. "Özetle yetinip karar verme oranı" ölçütü çıkarılır; yerine onay bekleme süresi ve düzeltme oranı.
- **M22. Gönderildi işareti.** Öneri: evet, ama onay durumu olarak değil, onay kaydında ayrı alan (gönderen kişi, zaman). İşaretleme `iz_kaydi`'na yazılır. Onay durumları onaylı listede kalır.
- **M23. Düzeltme istendi.** Öneri: aynı görev aynı ajana kendiliğinden geri döner; girdide gerekçe, önceki çıktı ve önceki onay kaydı olur. Yeni onay kaydı `onceki_onay_id` ile öncekine bağlanır; ilk seferde onay oranı buradan hesaplanır. İkinci düzeltmeden sonra iş insana düşer.
- **M24. SOS-2'den TAS-6'ya geçiş.** Öneri: kurucu seçeneği Onay Masası'nda seçer (`secilen_secenek` alanı). Onay TAS-6'yı kendiliğinden başlatmaz; onaylanan içeriğin yanında "Görsel iste" düğmesi olur, dokununca TAS-6 görevi açılır. SOS-2 kartından TAS-6'ya doğrudan devir çıkarılır. TAS-6 Sprint 4'te geldiği için o zamana kadar düğme görünmez.
- **M25. Onay kaydındaki alanlar.** Öneri: ajanın gerekçesi (`ajan_gerekcesi`) ve karar verenin gerekçesi (`karar_gerekcesi`) ayrı alanlar. Özet, risk notu ve önceliği yalnızca KOR-3 yazar. Ret ve düzeltme nedenini kurucu karar anında sabit listeden seçer, isteğe bağlı açıklama ekler: bilgi hatalı, eksik, dil ve ton, fiyat, kapsam dışı, diğer. KOR-3 sınıflandırma yapmaz. Onay noktaları `ajan_listele` özetine eklenmez; gerekiyorsa `onay_kuyrugu_oku` ile gelir.
- **M32. Ajanın insana soru ve uyarı kanalı.** Öneri: tek kanal, çalıştırıcıda "insana sor" sonucu. Ajan soruyu görev yorumu olarak yazar, görev `yanit_bekliyor` durumuna geçer (X1-6), bildirimi M9 gönderir. `bildirim_gonder` yalnızca KOR-2, KOR-3 ve KOR-4 eskalasyonunda kalır. Onay Masası soru kutusu olarak kullanılmaz.
- **M46. Bekleyen onay hatırlatması.** Rapor: bekleyen onayları izleyip hatırlatmak KOR-2'nin, günlük toplu onay turunu paketlemek KOR-3'ün işi. Öneri: KOR-2 hatırlatmayı hazırlar, gönderimi tek kanal M9 yapar; KOR-3 hatırlatma göndermez. Aynı onay için günde en fazla bir hatırlatma (kodla). M9 gelene kadar bildirimler bildirim tablosuna yazılır ve panelde basit bir listede görünür.
- **M53. Bildirim içeriği.** Öneri: sabit şablon, öncelik düzeyi ve panel bağlantısı. Gönderen ve konu yok. Kurucunun Ayarlar'dan düzey seçmesi Aşama 2.
- **X1-7. Dayanağı değişen onay.** Öneri: onay kaydı dayandığı sürümü tutar (not sürümü, görevin son değişme zamanı). Onay anında karşılaştırılır; değişmişse Onayla düğmesi kapanır ve "Yeniden hazırla" çıkar. Aynı kayıt için aynı anda tek bekleyen onay olur; yenisi gelince eskisi `gecersiz` olarak işaretlenir (ayrı alan, onay durumu değil, ölçümlere girmez).

## Ajan çalıştırıcı (M5)

- **M5. Onay koşullarının uygulanması.** Öneri: katalogdaki onay koşulları alan bazlı, makinenin okuyabileceği biçimde yeniden yazılır. Koşula takılan çağrıyı çalıştırıcı onay kaydına çevirir, onaydan sonra aynı çağrıyı kendisi uygular. Kart onay noktalarından kodla ifade edilebilenler katalog koşuluna taşınır, geri kalanı talimat olarak kalır. Y1 bir çalışma çıktı üretip `onaya_gonder` çağırmadan biterse çalıştırıcı çıktıyı kendisi onaya koyar.
- **M7. KOR-1 ve KOR-4'ün başka bağlamı okuması.** Rapor bu iki ajanın yetki verilen kişiler için iki şirketi birlikte görebileceğini söylüyor; 1 Ekim kararı bunu pilot için daralttı. Öneri: pilotta daraltma kalır, istisna yok; öneri ve tek dokunuş yolu. KOR-4 kartından `not_ara`, `not_oku` ve `musteri_oku` çıkarılır ya da yalnızca kurucu alanındaki notları okur. Şirket ve müşteri toplantılarının brifi KOR-5'e geçer (R1). İki şirketi gören ajan Aşama 2'de, holding görünümüyle aynı salt okunur yoldan tasarlanır.
- **M7. KOR-5'in şirketi.** Öneri: şirket, klasörün bağlı olduğu `sirket_ajanlari` satırından gelir. Her şirketin ayrı toplantı klasörü olur; aynı klasör iki şirketin satırında olamaz (kodla denetlenir). Kurucu dökümü ilgili klasöre taşır.
- **M11. Zamanlanmış ve olayla başlayan işlerde kullanıcı.** Öneri: zamanlanmış ve olayla başlayan işler `sirket_ajanlari` satırını açan kişinin (pilotta kurucu) kimliğiyle koşar. Devirle gelen iş zincirin ilk talep sahibinin kimliğiyle koşar, kapsam onun erişimiyle daralır. `not_ara`'daki "soranın erişimi" bu kimliktir. `dis_kisi` pilotta HAF-2'ye soru soramaz.
- **M13. Dış içerik işareti.** Öneri: bütün araç sonuçları istemde işaretli veri bölümüne girer. Ayrıca katalogda araç başına `dis_icerik` alanı tutulur; bu alan M21 işaretlerini ve görevin kaynak türünü (X1-1) besler. KOR-1'e gelen talep ekleri dış içerik sayılır; talep metninin kendisi iç.
- **M16. Ajanın çekebileceği görev durumları.** Öneri: ajan görevi yalnızca `suruyor` ve `yanit_bekliyor` durumuna çekebilir. `onay_bekliyor`'a geçişi `onaya_gonder`, `tamamlandi`'ya geçişi onay kararı yapar; onay gerektirmeyen iç işte çalışma başarıyla bitince çalıştırıcı yapar. `iptal` yalnızca insan. Hepsi kodla.
- **M19. Yetki seviyesi.** Öneri: çalıştırıcıda uygulanan bir kapı. Y1'de her çıktı onaya gider; Y2'de yalnızca katalog koşullarına takılan çağrılar. Çıktı türüne göre ayrı seviye kalır, ama kartta yapısal bir alanla (`yetki.cikti_turleri`); `onaya_gonder` çıktı türünü parametre olarak alır.
- **M27. web_getir izin listesi.** Öneri: tek kaynak `sirket_ajanlari` ayarı; yalnızca kurucu Ayarlar'dan değiştirir. P-IST-1'in "Kaynak listesi notu" kaldırılır ya da yalnızca açıklama notu olur. Onaylanan yeni kaynak, onaydan sonra çalıştırıcı tarafından listeye eklenir (M5 ve M6).
- **M28. Zamanlama.** Öneri: Europe/Istanbul, Pazartesi-Cuma. Resmî tatiller depoda yıllık bir listede. Kaçan çalışma bir kez telafi edilir, ama anlamını yitirenler atlanır (07.30 günlük özeti 10.00'dan sonra çalışmaz). Saatler `sirket_ajanlari` ayarından değiştirilebilir; pilotta varsayılanlar kullanılır. Senden: arife günleri tatil sayılsın mı.
- **M29. Kim hangi ajana iş verebilir.** Öneri: denetim çalıştırıcıda, kartta `talep_rolleri` alanıyla. Taslak matris: kurucu her ajana; `calisan` KOR-1, HAF-1, HAF-2, SOS-2, A-TEK-2, A-PRJ-2 (iç rapor), TAS-3, TAS-6; A-KES-2 yalnızca proje üyeleri; KOR-4 yalnızca kurucu; `dis_kisi` pilotta hiçbir ajana talep açamaz. Matrisi onayla ya da düzelt.
- **M30. Ajanlar arası iş.** Öneri: `gorev_ac` ile bir ajana açılan görev hedefte devir sayılır; devir tetikleyicisi çalıştırıcıda bütün kartlar için varsayılan. KOR-1 kendi açtığı alt görevlerle tetiklenmez. "Bu iş bana ait değil" çalıştırıcıda bir sonuçtur: görev gerekçesiyle KOR-1'e döner, iki kez dönerse insana düşer. HAF-2'nin başka ajana yanıtı görev yorumu olarak döner. Rapor: HAF-2 yanıt bulamazsa eksiği HAF-1'e iletir. HAF-1 kartına devir tetikleyicisi eklenir; HAF-1 bilgiyi izinli Drive klasörlerinde arar, bulursa nota aktarır, bulamazsa kurucuya "bilgi eksik" görevi açar (uydurmaz). A-KES-2'den A-TEK-2'ye geçiş pilotta kurucunun tek dokunuşuyla olur.
- **M33. Sayaçlar.** Öneri: çalıştırıcıda kodla, görev kaydında (`geri_donus_sayisi`, `hatirlatma_sayisi` gibi). Görevin "değişmemesi" ajan yorumlarını kapsamaz; yalnızca insan eylemi ya da durum değişikliği sayacı sıfırlar.
- **M42. model_zor ve yorumdaki kurallar.** Öneri: pilotta tek model, kartın `model` alanı. `model_zor` alanı durur ama kullanılmaz; ölçüm gerektirirse Aşama 2. YAML yorumundaki kurallar alanlara taşınır: A-KES-2 onaylayanı M18 ile kurucu, KOR-4'ün hedef koşulu `yetki.hedef_kosulu` alanına.
- **M44. Toplu zamanlanmış işler.** Öneri: deterministik kısımlar kodda (gecikmiş görev listesi, bağlantısız notlar, istasyon ayrıştırma). Model yalnızca yazı ya da yargı gereken yerde. Toplu işler öğe başına ayrı çalışmaya bölünür (kişi ya da kaynak başına); hata yalıtımı ve maliyet görünürlüğü için. KOR-4 günlük özeti tek çalışma.
- **X1-1. Dış içerikten türeyen görev.** Öneri: bu görevler `kaynak_turu = dis` alır ve bir ajana doğrudan atanamaz; kurucuya ya da talep sahibine atanmamış öneri olarak açılır. Bir insan ajana atarsa iç sayılır. İstem enjeksiyonu testine iki adımlı senaryo eklenir.
- **X1-4. Bütçe ve sınırlar.** Rapor: gündelik iç işlerde ayrı üst sınır yok; proje işlerinin maliyeti o projenin bütçesine yazılır; ajan bazında bütçe ve uyarı. Öneri: iç işlerde `sirket_ajanlari` ayarında aylık uyarı eşiği, aşılınca kurucuya bildirim, iş durmaz. Proje işlerinde maliyet projeye yazılır, proje bütçesinin belirli bir payını geçince uyarı. Kaçak çalışmalara karşı çalışma başına araç çağrısı ve süre sınırı (zaten kartta) yeterli. Maliyet testinin beklenen aralığı ilk iki haftanın ölçümünden belirlenir. Senden: eşik rakamları.
- **X1-5. Yarıda kalan çalışma.** Öneri: yazmalar korunur, geri alınmaz; çalışma "yarıda kaldı" diye işaretlenir, yaptığı yazmalar çalışmaya bağlı görünür. Her yazma aracı çalışma kimliği ve adım numarasından bir tekrar anahtarı taşır; yeniden deneme aynı anahtarla aynı yazmayı ikinci kez yapmaz. Durdurma düğmesi süren çalışmayı bir sonraki araç çağrısından önce keser.
- **X1-6. Yanıt bekleyen görev.** Öneri: görev durumlarına `yanit_bekliyor` eklenir (CLAUDE.md'deki onaylı listeyi değiştirir, onayın gerekiyor). Yanıt yorumu gelince çalıştırıcı aynı ajanı yeniden başlatır. Atamayı değiştirme yolu önerilmez, M17'deki onay kuralına takılır.
- **X2-5. Effort ve reddetme.** Öneri: effort kartta, varsayılan çalıştırıcıda. Model reddederse iş insana düşer, başka modele geçilmez.

## Kartlar ve skill'ler

- **M6. P-IST-1 kaynak listesi ve raporlar.** Öneri: onaylanan kaynağı çalıştırıcı listeye ekler (M27). Raporlar çalışma çıktısı olarak kalır, not olarak yazılmaz.
- **M10. Drive erişimi ve geçmiş teklifler.** Öneri: projeler tablosunda proje başına Drive klasörü; proje bağlamında araçlar yalnızca o klasörleri okur. A-TEK-2'nin geçmiş teklifleri depoya girmez (M15); müşteri bilgisi çıkarılmış örnekler `sirket_id`'li, proje dışı "teklif örneği" türünde notlar olarak tutulur.
- **M12. KOR-5 proje bağlamı.** Öneri: evet, `proje_baglami: varsa`. Döküm bir projenin klasöründeyse o projenin bağlamında koşar.
- **M15. Skill'lerde şirket içeriği.** Öneri: evet. Skill'lerde yalnızca şirketten bağımsız çalışma adımları ve iskelet şablonlar durur. Şirkete ya da müşteriye özgü şablon, örnek ve marka dili `sirket_id`'li notlarda ya da dosyalarda tutulur. Onaylı geçmiş teklifler depoya girmez.
- **M17. Atanan değişikliği.** Öneri: ajandan ajana atama (KOR-1 devirleri) onaysız. Aynı şirketin `calisan` ya da `kurucu` üyesine atama onaysız. `dis_kisi`'ye atama ve son tarih değişikliği onaylı. `gorev_ac` ile atama da aynı kurala girer. Senden: "sahibi" atanan mı.
- **M20. Y3.** Rapor kapattı: Y3 otonom seviye, yalnızca okuma ve izleme işlerinde. KOR-2 ve HAF-2'nin hedefi Y3 olarak kalır. PLAN'a Y0-Y3 tablosu eklendi.
- **M34. Listede olmayan göndericiden acil e-posta.** Öneri: iş saatlerinde (09.00-19.00) saatlik tarama; yeni e-postalar yalnızca gönderen ve konu üzerinden Haiku ile sınıflandırılır. Anlık bildirim pilotta yok (M26 ile aynı gerekçe).
- **M35. Karar notu.** Öneri: toplantı kararlarının karar notunu yalnızca KOR-5 yazar. HAF-1 tutanak notu olayında karar notu yazmaz; yalnızca bağlar ve çelişki kontrolü yapar. Not türleri ve zorunlu YAML özellikleri tek yerde, `packages/shared` içinde bir zod şemasında tanımlanır; skill'ler buna başvurur, not kaydedilirken kodla doğrulanır.
- **M40. Kart durumu.** Öneri: `taslak`, `deneme`, `etkin`. Taslak kart yalnızca test setiyle çalışır; deneme yalnızca kurucunun talebiyle; etkin kart bütün tetikleyicilerle. Kart ya da skill değiştiren PR'da test seti CI'da geçmeden birleştirilmez; model çağrısı pahalı olduğu için yalnızca o kart ya da skill değiştiğinde çalışır.
- **M43. Test setleri.** Öneri: test seti skill'e ait (girdi ve kabul ölçütü). Kart kuralları (araç, yasak, eskalasyon) için karta ait küçük kural testleri `agents/testler/<kod>/` altında; kodla uygulanan kurallar birim testiyle ölçülür. Senden: Sprint 1 skill dokümanları.
- **M49. Bütçe gerçekleşmesi.** Rapor bu karşılaştırmayı A-PRJ-2'nin işi sayıyor ve proje maliyetinin proje bütçesine yazılmasını istiyor; karttan çıkarılmaz. Öneri: pilotta gerçekleşme kaydı olan kalemlerden hesaplanır (ajan maliyeti ve projeye işlenen insan saati); dış gider kaydı yoksa rapor bunu açıkça yazar. Yüzde 15 kuralı kalır ama yalnızca hesaplanabilen kalemlere uygulanır. İnsan saati için görev kaydına isteğe bağlı "harcanan süre" alanı.
- **M56. Aracı olmayan girdiler.** Öneri: ilke 4. SOS-2 kaynak bilgisini talep metninden ve notlardan alır. TAS-6'nın görsel arşivi Sprint 4'te izinli bir Drive klasörü ve `drive_oku` ile gelir. TAS-3'ün analitik girdisi karttan çıkar.
- **X2-4. Talep yolu.** Rapor: KOR-1 tek giriş noktası; koordinatör devre dışıyken birimlere doğrudan erişim açık kalır; yönlendirme kararları kayıtlı ve düzeltilebilir. Öneri: talepler varsayılan olarak KOR-1'den geçer. Talep formunda "birimi kendim seçeyim" seçeneği her zaman var, KOR-1 durdurulmuşsa zorunlu. Notlar ekranında HAF-2 için doğrudan "Sor" kutusu. Görev ayrıntısında yönlendirmeyi düzeltme düğmesi; düzeltmeler "ilk seferde doğru birim" ölçütünü besler (M51).

## Entegrasyonlar

- **M2. Figma'ya yazma.** Öneri: Sprint 4 başında bir günlük deneme. Olmazsa TAS-3 pilotta HTML ya da SVG tel kafes üretir.
- **M26. Drive, Meet ve Takvim olayları.** Öneri: pilotta yoklama (5-10 dakikada bir değişiklik sorgusu). Kural 8 değişmez.
- **M47. GitHub.** Öneri: Sprint 2 başında, yalnızca seçili depoları okuyan bir GitHub uygulaması. Projeler tablosuna `github_depolari` alanı. Bildirim uç noktası pilotta gerekmez; haftalık rapor zaten zamanlanmış. Yetişmezse A-PRJ-2 ilk raporları görev kaydı ve notlardan çıkarır.
- **M50. Kayıtların yazıya dökülmesi.** Öneri: pilotta yalnızca Meet transkripti ve danışmanın yüklediği yazılı döküm; ayrı bir ses-yazı servisi yok (KVKK yükünü de artırır). Klasörler: şirket başına toplantı klasörü ve proje klasörleri. PLAN'daki ifade "Meet dökümünü okur" olarak düzeltilir. Senden: Workspace planında Meet transkripti açık mı.
- **M52. Pillika istasyon kayıtları.** Senden: kayıtlar nerede. Öneri: pilotta eşleştirmeyi insan yapar ya da düzenli bir CSV anlık görüntüsü okunur. "Kapalı" işareti aday tablosunda kalır; canlı veriye yazılmaz (kural 4).
- **X2-1. Pillika Drive'ı.** Öneri: evet, okunur; ikinci bağlantı istemcisi Sprint 1'de Arma DX'inkiyle birlikte kurulur (kod aynı, yalnızca ikinci istemci). Senden: Pillika Workspace'inde yönetici yetkin var mı.
- **X2-3. Klasör paylaşımı.** Öneri: aynı klasör aynı şirkette birden fazla ajanın listesinde olabilir, iki şirketin listesinde olamaz. HAF-1 KOR-5 ve A-KES-2'nin klasörlerini içe aktarmaz; o ajanlar kendi notlarını yazar, aksi halde çift not çıkar. Değişen belge olayı 15 dakika bekleme ve dosya başına tekilleştirmeyle tetiklenir.

## Plan ve sprint

- **M45. Sonraki sprintteki ajanlara dayanan kartlar.** Öneri: sprint sırası değişmez. Aradaki dönemde bu işleri insan yapar; kartlarda o girdiler ve devirler ilgili ajan gelene kadar kapalı tutulur. SOS-2'nin içerik takvimi girdisi, bir kaynağı olana kadar karttan çıkar.
- **M48. Proje kayıtları.** Öneri: Müşteriler ekranında Projeler sekmesi (Sprint 2, M10 ile birlikte); proje üyeleri de orada yönetilir. Ayrı modül açılmaz.
- **M51. Kasım ölçümü.** Rapor ofis düzeyinde dokuz ölçüt tanımlıyor (PLAN, Ölçütler). Öneri: yetki kararı rapordaki yükseltme kuralına dayanır (ilk seferde onay oranı, iş sayısı, kritik hata). Dokuz ölçütün hepsi panelde toplanır; kart ölçütlerinden yalnızca kaydı olanlar. Süre ölçümü üç işte kalır; diğer ajanlar için onay anında isteğe bağlı "bu iş elle kaç dakika sürerdi" alanı.
- **X1-8. Model değişikliği.** Öneri: Kasım ölçümü süresince model değişikliği dondurulur, güvenlik düzeltmeleri hariç. Haiku 4.5 için kaldırma duyurusu gelirse o günün güncel Haiku modeline geçilir, yeni kart sürümü olarak.
- **X2-6. MCP sunucusu ve dışa aktarma.** Öneri: MCP sunucusu pilottan çıkar. Obsidian uyumlu dışa aktarma yalnızca kurucuya açık, kısıtlı rol ve kullanıcı bağlamıyla, her dışa aktarma `iz_kaydi`'na yazılır.

## Tasarım raporu karşılaştırması (R maddeleri)

- **R1. Toplantı brifi.** Öneri: şirket ve müşteri toplantılarının brifini KOR-5 hazırlar (şirket bağlamında, notları görebildiği için). KOR-4 yalnızca kurucunun gününe bakar: takvim özeti ve e-posta tarafı. KOR-5 kartına "toplantıdan önce brif" tetikleyicisi eklenir.
- **R2. KOR-4 kapsamı.** Öneri: haftalık özet karta eklenir (ucuz, günlük özetten türer). Verilen sözlerin ve bekleyen yanıtların takibi de eklenir, ama yalnızca kurucunun gönderdiği e-postalardan ve kurucu alanında kalır. Pilotta yalnızca kurucu için.
- **R3. P-IST-1 ve CPO verisi.** Senden: OCPI bağlantıları bugün çalışıyor mu? Öneri: pilotta CPO verisi kaynak değil; OCPI bağlantıları Pillika uygulamasının yeniden geliştirilmesiyle birlikte gelir. Kart rapordaki hedefi not olarak taşır.
- **R4. HAF-1 ve e-posta ekleri.** Öneri: pilotta yok. Gmail erişimi kurucunun posta kutusu ve kurucu alanıyla sınırlı; ekleri şirket hafızasına taşımak kurucunun "nota aktar" dokunuşuyla olur (Aşama 2).
- **R5. A-KES-2 sorumlusu.** Öneri: pilotta kurucu; yorum ayrı alana taşınır (M18). Sürüm numarası kart ilk kez etkin olduğunda 1.0 olur (M40).
- **R6. Kart alanları.** Öneri: değişiklik tarihi ve yapan git'ten alınır, kartta tekrar yazılmaz. Yükseltme koşulu yalnızca ortak kuraldan farklıysa kartta yazılır (A-TEK-2 ve A-KES-2 gibi kalıcı Y1 olanlar).
- **R7. Oturum ve yeniden doğrulama.** Öneri: oturum 12 saat, 30 dakika hareketsizlikte yeniden giriş. Yeniden doğrulama fiyat ya da tutar içeren, dış alıcılı ve tek doğru kaynak değiştiren onaylarda; telefonda cihazın parmak izi ya da yüz tanımasıyla (passkey), olmazsa Google ile yeniden giriş.
- **R8. AI izni.** Öneri: yeni projede kapalı başlar, kurucu açar; Arma DX'in iç projelerinde ve Pillika'da varsayılan açık. Müşteri sözleşmesi şablonuna AI kullanım maddesi eklenir (avukatla).
- **R9. Ajana bırakılmayan işler.** Öneri: katalogda araç başına `yasak_grup` alanı (para, imza ve taahhüt, resmî başvuru, kişisel veri silme ya da aktarma). Bu gruptaki araç Y1'in üstündeki ajanda da her çağrıda onaya düşer. Pilot kataloğunda bu gruba giren araç şimdilik yok; `eposta_gonder` geldiğinde taahhüt grubuna girer.
- **R10. Kritik hata.** Öneri: kurucu bir onaylanmış işi sonradan "kritik hata" olarak işaretler (iz kaydına olay olarak düşer, gerekçe zorunlu). İşaret ajanı kodla bir seviye düşürür ve ajan için inceleme görevi açar.
- **R11. Kapı hedefleri.** Senden: hedef rakamlar. Öneri başlangıç: ilk seferde onay oranı yüzde 80, pilot işlerinde en az yüzde 30 zaman kazancı, ekibin dörtte üçünün haftada en az bir kez kullanması. 50 iş eşiğine ulaşmayan ajan Kasım'da yükseltilmez, ölçüm sürer.
- **R12. Onay turları.** Öneri: 09.30 ve 16.00; KOR-3 paketleri turdan 30 dakika önce hazırlar.
- **R13. Dil.** Öneri: pilotta İngilizce çıktı yalnızca SOS-2 ve TAS-6'da, talep edilirse. Arapça Aşama 2. Arayüz metinleri ileride çeviriye uygun olacak biçimde tek dosyada toplanır; sağdan sola düzen pilotta yok.
- **R14. MCP bağlayıcıları.** Öneri: pilotta araçlar worker içinde, ama her dış sistemin araçları kendi bağlayıcı modülünde (google, github, figma) toplanır. MCP sunucusu olarak ayırmak ürünleşmede.
- **R15. Hafıza sorumluları.** Senden: kişiler. Öneri: pilotta ikisi de kurucu.
- **R16. Kamu müşterisi.** Senden: pilotta böyle bir proje var mı. Varsa o projede AI izni kapalı (R8).

## Arayüz temeli

- **Vurgu rengi.** Öneri: `#13807D` yerine `#127A77`. Zemin üzerinde 4.81:1, beyaz üzerinde 5.15:1; ton aynı kalır, AA karşılanır.
- **Form alanı kenarlığı.** Öneri: ayrı bir değişken, `#878F9E`. Beyaz üzerinde 3.25:1, zemin üzerinde 3.04:1. Ayırıcı çizgiler `#DDE1E8` olarak kalır.
- **Karanlık tema.** Öneri: değerler hazırlanıp onaya sunulsun; kontrast oranlarıyla birlikte.

Altyapı maddeleri (vitest, TypeScript 7, Node 26, Docker, Dependabot, pnpm) ve arayüz kurulum notları karar gerektirmiyor; oldukları gibi kalır.
