# Ara raporlar: okuma notu

Bu klasördeki yedi dosya, `docs/paperclip-incelemesi.md` belgesinin dayandığı ara raporlardır. Paperclip'in kaynak kodu okunurken yazıldılar; her tespitin yanında dosya yolu ve satır numarası vardır. Asıl belge bunların özeti ve Agent Office için öneridir. Geliştirme sırasında bir ekranın ya da bir kalıbın ayrıntısı gerektiğinde buraya bakılır.

## Raporlar

| Dosya | Konu |
|---|---|
| [`01-arayuz-iskeleti-ve-tasarim-dili.md`](01-arayuz-iskeleti-ve-tasarim-dili.md) | Yönlendirme, kabuk, kenar çubuğu, tasarım değişkenleri, temel bileşenler |
| [`02-is-ekranlari.md`](02-is-ekranlari.md) | Genel bakış, Gelen kutusu, görev listesi, görev sayfası, çalışma kayıtları, arama |
| [`03-organizasyon-ve-yonetisim-ekranlari.md`](03-organizasyon-ve-yonetisim-ekranlari.md) | Ajanlar, organizasyon şeması, onaylar, maliyet ve bütçe, rutinler, skill'ler, bağlayıcılar, ayarlar |
| [`04-veri-modeli-ve-servisler.md`](04-veri-modeli-ve-servisler.md) | Şema, API, durum kuralları, şirket yalıtımı, giriş |
| [`05-ajan-calistirma.md`](05-ajan-calistirma.md) | Uyandırma motoru, adaptörler, insan onayı mekanizmaları, maliyet |
| [`06-telemetri-lisans-guvenlik.md`](06-telemetri-lisans-guvenlik.md) | Veri paylaşımı, lisans, güvenlik ve yayın |
| [`07-ozellik-dokumu.md`](07-ozellik-dokumu.md) | Özellik dökümü ve sürüm geçmişi |

## Kaynak gösterimi

- İncelenen sürüm: github.com/paperclipai/paperclip, commit `dd868ed` (3 Ekim 2026).
- Kaynaklar `dosya/yolu:satır` biçimindedir ve dosyanın o commit'teki hâlini gösterir.
- `/home/claude/paperclip`, deponun inceleme sırasında indirildiği yerel klasördür; Agent Office deposunda böyle bir klasör yoktur.
- Paperclip sık değiştiği için satır numaraları sonraki sürümlerde kayar. Kod alınacaksa aynı commit kullanılmalıdır (asıl belge, 13.7).

## Çeviri

Raporlar 3 Ekim 2026'da İngilizce yazıldı. `docs/` belgeleri Türkçe olduğu için 5 Ekim 2026'da Türkçeye çevrildi. Şunlar özgün hâliyle bırakıldı:

- kod parçaları, dosya yolları, tanımlayıcılar, CSS sınıfları ve API yolları;
- Paperclip'in arayüzünden, kod açıklamalarından ve belgelerinden alınan tırnak içindeki İngilizce metinler (gerektiğinde ayraç içinde Türkçe karşılığı verildi);
- kod blokları ve şemalar.

Çeviri satır satır yapıldı; başlık numaraları, tablolar ve kaynak gösterimleri İngilizce asıllarıyla aynıdır. Terimler asıl belgedeki karşılıklarla yazıldı: görev, çalışma, kenar çubuğu, yazma kutusu, özellik paneli, onay kartı gibi.

## Bilinen düzeltmeler

Asıl belge yazılırken Paperclip hakkındaki tespitler kaynak kodla yeniden karşılaştırıldı. Aşağıdaki üç nokta asıl belgede doğru hâliyle yer alır; raporlarda ilgili yere köşeli ayraç içinde not olarak işlendi.

| Konu | Raporda | Doğrusu |
|---|---|---|
| Soru ve onay kartının yeri | `02-is-ekranlari.md`, bölüm 7.9, 15 ve 16: bekleyen istek "yazma kutusunun yerini alır" | Kart yazma kutusunun hemen üstünde durur; yazma kutusu kullanılabilir kalır (asıl belge, 6.5) |
| Araç eylemi onay kartının içeriği | `02-is-ekranlari.md`, bölüm 7.9: araç adı, risk etiketi, bitiş tarihi, argümanlar ve özet değeri | Görev sayfasındaki kartta uygulamanın logosu, ön izleme, "Decline", "Approve & run" ve varsa "Always allow" bulunur (asıl belge, 6.5) |
| Ajan simgeleri | `07-ozellik-dokumu.md`, bölüm 4: eski ekran görüntülerinin anlatımında baş harfli simgeler | Güncel arayüzde ajan simgeleri sunucuda üretilen karakter çizimleridir (asıl belge, 5.2) |

Ayrıca `03-organizasyon-ve-yonetisim-ekranlari.md` dosyasında iki küçük kayma düzeltildi: yanlış yazılmış bir bölüm numarası ve organizasyon şeması yerleşiminin satır sayısı.

## Agent Office notları

Raporlar yazılırken Agent Office deposu okunmamıştı; yalnızca `CLAUDE.md` dosyası biliniyordu. Bu yüzden raporların Agent Office ile karşılaştırma ve uyarlama bölümleri eksiktir ve yer yer eskidir: PLAN'daki ekran listesini, veri modelini, kurucu kararlarını ve `docs/SONRA.md` içindeki soruları hesaba katmazlar. Agent Office için geçerli olan, asıl belgenin 11 ile 14 arasındaki bölümleridir. Bir rapor ile asıl belge çelişirse asıl belge geçerlidir.

## Sınırlar

- Raporlar kod okumaya dayanır. Yalnızca asıl belgede "çalışan kurulumda görüldü" denen noktalar ayrıca denenmiştir.
- Depo çok büyük olduğu için her dosya satır satır okunmadı; her rapor kendi sınırlarını ayrıca yazar.
- Çevirinin yapısı (satırlar, tablolar, kod parçaları, sayılar) bütün dosyalarda, dili örnekleme yoluyla denetlendi.
