# Paperclip incelemesi ve Agent Office uyarlama önerisi

| | |
|---|---|
| Tarih | 4 Ekim 2026; 5 Ekim'de depodaki son duruma göre güncellendi |
| İncelenen | github.com/paperclipai/paperclip, commit `dd868ed` (3 Ekim 2026), MIT lisanslı |
| Yöntem | Paperclip'in kaynak kodu okundu; Paperclip çalıştırıldı ve Türkçe örnek veriyle ekranları görüldü. Agent Office tarafında depodaki belgeler, kartlar, göç dosyaları ve panel kodu okundu (inceleme 3 Ekim'deki durum üzerinden yapıldı, commit `3a22218`; belge 5 Ekim'deki `32dd0e5` commit'ine göre güncellendi) |
| Durum | Kararlar 5 Ekim'de verildi (`docs/kararlar/2026-10-05.md`, karar 5-16): yaklaşım c, görsel yön c, zamanlama a, telefon uyumu yok (ileride ayrı mobil uygulama), Ofis görünümü kabuktan hemen sonra yapılacak (karar 9 ve 14); 14.5 ve 14.6'da öneriler uygulanıyor (kurucu onayı bekliyor). Belgenin geri kalanı karar öncesi hâliyle bırakıldı |

İçindekiler: 1. Özet, 2. Kapsam ve yöntem, 3. Paperclip'in yapısı, 4. Arayüz iskeleti, 5. Tasarım dili, 6. Ekranlar, 7. Etkileşim kalıpları, 8. Veri modeli ve servisler, 9. Ajan çalıştırma, 10. Veri paylaşımı, lisans ve güvenlik, 11. Agent Office ile karşılaştırma, 12. Çatışmalar, 13. Uyarlama önerisi, 14. Kurucu kararları, 15. Ekler.

## 1. Özet

**Sonuç.** Paperclip'e geçmek ya da onu çatallamak (fork) yerine arayüzünü örnek almak doğru olur. İki proje arka uçta birbirinin neredeyse tersidir: Paperclip'te şirket yalıtımı uygulama kodundadır, girişte e-posta ve parola kullanılır, ajanlar komut satırı kodlama ajanlarıdır, varsayılan ayarlar özerklikten yanadır. Arayüzde ise iki proje aynı işi yapıyor ve Paperclip bu işi çok iyi yapıyor.

**Beğenilen yanın kaynağı.** Paperclip'in kullanım rahatlığı renkten ya da süsten çok, yirmi etkileşim kalıbından geliyor (7. bölüm). En önemlileri:

- Her durumun bir rengi ve bir şekli var; her ekranda aynı.
- Kullanıcı Gelen kutusu ekranında çalışırken satırlar yer değiştirmiyor. Arşivleme hemen gerçekleşiyor ve geri alınabiliyor.
- Ajanın işi önce tek satırlık özet olarak görünüyor; ayrıntı istendikçe açılıyor.
- Ajanın sorusu ve onay isteği, yazma kutusunun hemen üstünde kart olarak çıkıyor.
- Yazılan hiçbir şey kaybolmuyor, bildirimler seyrek, metinler ne olduysa onu söylüyor.

**Asıl bulgu.** Agent Office'te Paperclip'e benzetilecek ekranların çoğu henüz yapılmadı. Şu an çalışan ekranlar Giriş, şirket seçimi, Kullanıcılar ve Güvenlik'tir; Bugün, Onaylar, Görevler, Notlar ve Ajanlar boş ekran olarak duruyor. `docs/KALAN-ISLER.md` içinde sıradaki iki iş bunlardan: görev kaydı ve pano (0.4), Onay Masası (0.5). Ajanlar ve Notlar Sprint 1'de, Bugün ekranı Sprint 2'de. Yani yeniden yapılacak pek bir şey yok; asıl soru, bu ekranların ilk kez hangi yapıyla kurulacağıdır.

**Öneri.** Mimari, değişmez kurallar ve PLAN'daki ekran listesi kalır; yeni ekran eklenmez. Kabuk şimdi değişir: kenar çubuğu, üst çubuk, özellik paneli. Ekranlar, sıraları geldikçe Paperclip'in kalıplarıyla kurulur: Onay Masası, gelen kutusu kalıbıyla; Görev ayrıntısı, sohbet biçiminde ve onay kartı yazma kutusunun üstünde duracak biçimde; Bugün ekranı, "bana düşenler" listesiyle. Veri modeli bunların çoğunu zaten karşılıyor: görev yorumları, çalışma ve araç çağrısı kayıtları, onay kaydındaki saklanan çağrı, özet, risk notu ve fark. İki proje aynı kütüphaneleri kullanıyor (React 19, Tailwind 4, shadcn/ui, tek paketli Radix, lucide); Paperclip'e özgü 43 dosya (kabuk, özellik paneli, durum sistemi, sayfa parçaları, markdown gösterimi ve yardımcılar; yaklaşık 7 bin satır) MIT bildirimi korunarak taşınabilir.

**Bedel.** Kabuk değişimi yeni bir iştir ve sıradaki arayüz işlerinin hacmi büyür. PLAN'a göre pilot 10 Ekim'de açılıyor. Bu tarih, öneriden bağımsız olarak risk altında: Sprint 0'ın süresi 3 Ekim'de doldu, 0.2 ve 0.3'te tamamlanmamış maddeler var, 0.4 ile 0.7 arasındaki dört işe başlanmadı, test ortamı yok, çalıştırıcı ve ajan işlerine başlanmadı. Öneri bu riski büyütür. Tarih kesinse kabuk şimdi, kalıplar açılıştan sonra yapılabilir (14.3); görev numarası, komut paleti ve canlı güncelleme gibi ekler her durumda sonraya bırakılabilir (14.6).

**Alınmayacaklar.** Paperclip'in sunucusu, veri katmanı, girişi, ajan çalıştırma tarafı ve özerkliğe dönük varsayılan ayarları. "Her zaman izin ver" seçeneği ve ajanların soru ile onay kartlarını yanıtlayabilmesi Agent Office'in kurallarıyla çatışır. Görevi doğrudan ajana atama ise karara bağlıdır: tasarım raporu koordinasyon katmanını "tek giriş noktası" sayıyor, KALAN-ISLER 0.4 ise atamayı "insana ya da ajana" diye planlıyor. Talep formunda birimin ya da ajanın doğrudan seçilip seçilemeyeceği (X2-4) ve hangi rolün hangi ajana iş verebileceği (M29) `docs/SONRA.md` içinde karar bekliyor.

**Veri paylaşımı ve lisans.** Paperclip MIT lisanslıdır: değiştirilebilir ve ticari üründe kullanılabilir; tek koşul telif bildiriminin korunmasıdır. Telemetri varsayılan olarak açıktır ve kapatılabilir. Bu incelemeden önce verdiğim ilk yanıttaki birkaç nokta kod okununca değişti; düzeltmeler 10.1'de.

**Bekleyen kararlar.** Altı karar var (14. bölüm): yaklaşım, görsel yön, zamanlama, telefon, Bugün ve Onaylar ekranlarının rolü, kapsam. Hemen gerekenler ilk dördüdür; sıradaki iş olan 0.4 için ayrıca SONRA'daki üç soru (M16, M17, X2-4) yanıtlanmalıdır. Üç görsel yön seçeneğini aynı Agent Office ekranları üzerinde gösteren bir taslak da hazırladım (15.1).

**Telefon çelişkisi.** Depodaki bütün belgeler telefon uyumunu şart koşuyor: tasarım raporu, PLAN, `CLAUDE.md`, KALAN-ISLER. "Onay telefondan tek dokunuşla veriliyor" maddesi pilot açılış kontrollerinden biridir. Önceki konuşmalardan kalan proje notu ise web panelin mobil uyumlu yapılmayacağını kurucu kararı olarak kaydediyor. Depoda böyle bir karar kaydı yok. Hangisinin geçerli sayılacağına ben karar vermedim; soru 14.4'te kurucuya bırakıldı.

**Sınırlar.** Agent Office tarafında `docs/dokuman-incelemesi.md`, `docs/kart-incelemesi.md`, sunucu kodunun ayrıntısı ve on iki görev kartı okunmadı (2.3). `docs/SONRA.md` güncel değil; 2 Ekim kararlarıyla kapanan bazı maddeler hâlâ soru olarak duruyor.

## 2. Kapsam ve yöntem

### 2.1 İncelenenler

Paperclip deposu 3 Ekim 2026 tarihindeki son hâliyle indirildi ve yedi başlık altında okundu:

1. Arayüz iskeleti ve tasarım dili: yönlendirme, kabuk, kenar çubuğu, tasarım değişkenleri, temel bileşenler
2. İş ekranları: Genel bakış, Gelen kutusu, görev listesi, görev sayfası, çalışma kayıtları, arama
3. Organizasyon ve yönetişim ekranları: ajanlar, organizasyon şeması, onaylar, maliyet ve bütçe, rutinler, skill'ler, bağlayıcılar, ayarlar
4. Veri modeli ve servisler: şema, API, durum kuralları, şirket yalıtımı, giriş
5. Ajan çalıştırma: uyandırma motoru, adaptörler, insan onayı mekanizmaları, maliyet
6. Veri paylaşımı, lisans, güvenlik ve yayın
7. Özellik dökümü ve sürüm geçmişi

Her başlık için dosya yolu ve satır numarası veren ayrı bir ara rapor yazıldı (İngilizce yazıldı, depoya konurken Türkçeye çevrildi; toplam yaklaşık 7.400 satır). Bu belge o raporların Türkçe özeti ve onlara dayanan öneridir. Belge yazıldıktan sonra Paperclip hakkındaki tespitler kaynak kodla yeniden karşılaştırıldı ve bulunan hatalar düzeltildi. En önemli tespitler 15.3'te kaynaklarıyla listelendi.

Agent Office tarafında okunanlar: `CLAUDE.md`; `docs/PLAN.md`; `docs/KALAN-ISLER.md`; `docs/kararlar/` altındaki dosyalar (1, 2, 3 ve 5 Ekim); tasarım raporu; `docs/SONRA.md` ve yanıt taslağı; `docs/ad-sozlugu.md` (yalnızca alan adları için); `agents/tools.yaml`; iki görev kartı (A-TEK-2, KOR-3); görev, çalışma, onay ve iz kaydı göçleri; `apps/web` içindeki yerleşim, menü, tema ve ekran dosyaları; `pnpm-workspace.yaml`, `apps/web/package.json`, `tsconfig.base.json` ve `apps/web/tsconfig.app.json`. Depo `development` dalındaydı; inceleme sırasındaki son commit `3a22218` idi ve inceleme sırasında depoda hiçbir dosya değiştirilmedi. Belge, kurucunun onayıyla 5 Ekim'de ekleriyle birlikte `docs/` altına kondu; konmadan önce o günkü iki commit'e (sonuncusu `32dd0e5`) ve 5 Ekim kararlarına göre güncellendi.

### 2.2 Çalıştırma

Kod okumakla yetinilmedi; Paperclip bu inceleme sırasında çalıştırıldı: gömülü PostgreSQL ile, telemetri ve duyuru akışı kapalı olarak. İçine Türkçe örnek veri girildi: "Örnek Ofis" adlı bir şirket, altı ajan (Koordinatör, Araştırma, Dokümantasyon, Tasarım, Güvenlik, Raporlama), üç proje, dokuz görev, bir rutin, bütçe ve onay kayıtları.

Gerçek bir kodlama ajanı bağlanmadı. Onun yerine Paperclip'in `process` adaptörü üzerinden çalışan küçük bir betik, ajan gibi davrandı: görevi üstlendi, plan belgesi yazdı, soru sordu, onay istedi, haftalık rapor bıraktı. Böylece soru kartı, onay kartı, çalışma kaydı ve bütçe uyarısı gerçek akışlarıyla görüldü. Açık temada, karanlık temada ve telefon genişliğinde 56 ekran görüntüsü alındı; en önemlileri bu belgeyle birlikte verildi (15.1).

### 2.3 Sınırlar

- Belgenin ilk taslağı, bilgisayar bağlantısı koptuğu için Agent Office'in yalnızca `CLAUDE.md` dosyasına bakılarak yazılmıştı. Bağlantı geri gelince 2.1'deki dosyalar okundu ve 11 ile 14 arasındaki bölümler baştan yazıldı.
- Agent Office tarafında okunmayanlar: `docs/dokuman-incelemesi.md`, `docs/kart-incelemesi.md`, `apps/api` ve `packages/db` kodunun ayrıntısı, testler ve on iki görev kartı. Kodun ayrıntısına dayanan yerlerde bunu belirttim.
- `docs/SONRA.md` güncel değil: 2 Ekim kararlarıyla kapanan bazı maddeler hâlâ soru olarak duruyor. Yanıt taslağı 2 Ekim'in ilk dört kararını içeriyor; sonraki 2 Ekim kararları ve 3 Ekim kararları işlenmemiş. Bu belgede bir soru için SONRA kodu verildiğinde maddenin karar dosyalarıyla karşılaştırılmış güncel durumu esas alındı.
- PLAN'daki modül kodları (M1 ile M15 arası) ile SONRA'daki madde kodları (M1 ile M56 arası) çakışıyor. Bu belgede modüller "modül M5" biçiminde, SONRA maddeleri yalnızca koduyla yazıldı.
- Depo dışından gelen üç bilgi var; hepsi önceki konuşmalardan kalan proje notuna dayanır: ajanların normal geliştirme için kod yazmayacağı kararı, web panelin mobil uyumlu yapılmayacağı kararı ve bir siber güvenlik birimi kurulacağı kararı. Bunların hiçbiri depodaki karar dosyalarında geçmiyor.
- Paperclip gerçek bir kodlama ajanıyla (Claude Code, Codex) çalıştırılmadı. Ajan çalıştırma bölümü kod okumaya dayanıyor.
- Paperclip'in kendi sunduğu bulut sürümü incelenmedi; yalnızca açık kaynak depoya bakıldı.
- Depo çok büyük olduğu için her dosya satır satır okunmadı. Eklenti sistemi, sandbox (yalıtılmış çalışma ortamı) sağlayıcıları, sohbet bağlayıcıları ve deneysel "cases" ile "pipelines" ekranları yüzeysel geçildi.

## 3. Paperclip'in yapısı

### 3.1 Ürün

Paperclip kendini "iş için yapay zekâ ajanlarını yönetmeye yarayan uygulama" ve "otonom şirketlerin kontrol düzlemi" diye tanımlıyor. Bir kurulum birden çok şirket barındırır. Her şirkette çalışanların yerini ajanlar alır; şirketin ayrıca bir organizasyon şeması, hedefleri, bütçeleri ve görev yönetimi vardır. İnsan tarafına "board" (yönetim kurulu) denir: hedef koyar, ajan işe alır ve durdurur, önemli kararları onaylar, maliyeti izler. README'deki özet cümle şudur: görev yöneticisine benzer; altında organizasyon şeması, bütçe, yönetişim, hedef uyumu ve ajan koordinasyonu vardır.

Paperclip kendini bir kontrol düzlemi olarak anlatır; belgelerindeki ifadeyle ajanları çalıştırmaz, yönlendirir. Uygulamada ayrım bu kadar keskin değildir. Yerel adaptörler komut satırı kodlama ajanlarını (Claude Code, Codex, Cursor, Gemini) sunucunun üzerinde başlatır. Depoda ayrıca deneysel bir çalıştırıcı (native runner) bulunur; kullanıcının kendi sunucusuna kurduğu sürümde bu özellik açık gelir, ama onu yalnızca öyle yapılandırılan ajanlar kullanır. Ajanın kendisi ise her durumda dışarıdan gelen bir kodlama ajanı ya da ajan servisidir.

### 3.2 Mimari

| Parça | İçerik |
|---|---|
| `server/` | Express tabanlı API (yaklaşık 890 uç nokta), uyandırma motoru, araç geçidi |
| `ui/` | React 19, Vite 8, Tailwind 4, shadcn/ui, react-router 7, TanStack Query 5 |
| `packages/db` | Drizzle ile PostgreSQL şeması: 226 tablo, 293 göç dosyası |
| `packages/shared` | Ortak tipler ve sabitler |
| `packages/adapters` | Komut satırı ajanları için adaptörler |
| `cli/` | Kurulum ve yönetim komutları |

Depoda testlerle birlikte yaklaşık 2,3 milyon, testler hariç yaklaşık 1,26 milyon satır TypeScript var. Arayüz kodu testler hariç 350 bin satır civarında.

Ayrı bir iş kuyruğu yoktur. Uyandırma istekleri ve çalışmalar veritabanı satırlarıdır. Bir uyandırma isteği, çalışmasını API sürecinin içinde hemen başlatır. Aynı sürecin içindeki 30 saniyelik bir zamanlayıcı da zamanlı uyandırmaları, rutinleri, yeniden denemeleri ve yarım kalan çalışmaların kurtarılmasını yürütür. Canlı olaylar da aynı sürecin içindeki bir olay dağıtıcısından çıkar; ikinci bir sunucu süreci bu olayları görmez.

### 3.3 Kavramlar

| Paperclip | Anlamı |
|---|---|
| Company (arayüzde "organization") | Kiracı (tenant). Her şirketin, görev kimliklerinde kullanılan kısa bir kodu vardır (RNE-7 gibi) |
| Board | İnsan yöneticiler |
| Agent | Bir şirkete bağlı ajan kaydı: rol, bağlı olduğu yönetici ajan, adaptör ayarı, bütçe |
| Adapter | Ajanı gerçekten çalıştıran köprü |
| Heartbeat run | Ajanın bir kez uyandırılıp çalıştırılması |
| Issue (arayüzde "task") | Görev. Tek atanan, yedi durum, üst ve alt görev, engelleyen ilişkisi |
| Interaction | Görev içinde ajanın insandan istediği yapılandırılmış yanıt. Altı türü var: soru, onay isteği, işaretli onay, kalem kalem karar, görev önerisi, bağlantı isteği |
| Approval | Yönetim kurulu onayı: ajan işe alma, strateji, bütçe aşımı, genel onay isteği |
| Routine | Zamanlamayla, webhook ile, API'den ya da elle tetiklenen yinelenen iş. Rutin kurallarının elemediği her tetiklenme bir görev açar |
| Budget policy, incident | Şirket, ajan ya da proje için harcama sınırı ve eşik aşıldığında açılan olay kaydı |
| Skill | Ajana yüklenen talimat paketi |
| Connector, tool | Dış servis bağlantısı ve o servisin eylemleri. Her eylem için "kapalı, önce sor, serbest" kuralı |

### 3.4 Sürüm temposu

Depodaki ilk sürüm notu 4 Mart 2026 tarihli. O günden 1 Ekim 2026'ya kadar 29 sürüm yayımlanmış, yani aşağı yukarı haftada bir. Kenar çubuğu Haziran 2026'da sadeleşti, görev sayfası Ağustos 2026'da sohbet biçimine geçti. Pek çok özellik deneysel sayılıyor ve bir ayar açılmadıkça görünmüyor: kararlar masası, durum kartları, ajan sohbeti, "cases", "pipelines". Bazı özellikler de yayımlandıktan sonra geri çekildi: otomatik verimlilik incelemeleri, ucuz model profilleri, çıktı üretmeyen çalışmalarda otomatik devralma. Bir sonraki sürümün notlarında, bir ajandan @ ile söz etmenin artık o ajanı uyandırmadığı yazıyor.

Ürün hızla değiştiği için Paperclip'in şimdiki arayüzü kalıcı sayılamaz. Ekranları birebir kopyalamak yerine dayandıkları kalıpları almak bu yüzden daha sağlam bir yoldur.

## 4. Arayüz iskeleti

Paperclip'in iki arayüz kabuğu var. Varsayılanı "streamlined" adını verdikleri yeni kabuk. Eski kabuk bir ayarla açılabiliyor ve kodda 23 ayrı dosyayla sürdürülüyor. Aşağıda anlatılanların tümü varsayılan kabuğa aittir.

### 4.1 Yerleşim

Masaüstünde ekran dört bölgeden oluşur:

| Bölge | Ölçü | İşlev |
|---|---|---|
| Kenar çubuğu | 240 px; 208 ile 420 px arasında sürüklenerek ayarlanır | Şirket menüsü, gezinme, son görevler, hesap menüsü |
| Üst çubuk | 60 px yükseklik | Konum bilgisi ve sayfanın kendi düğmeleri |
| Ana içerik | Kalan alan; 16 px, geniş ekranda 24 px iç boşluk | Sayfa |
| Özellik paneli | 322 px, görev sayfasında 434 px, en az 260 px | Açık kaydın özellikleri, ilişkili görevleri, belgeleri |

Bazı sayfalar (ajan, rutin, skill'ler, bağlayıcılar) kenar çubuğunun yanına 240 px'lik ikinci bir menü ekler. Ayarlar sayfasında ana kenar çubuğunun yerini ayarlar menüsü alır ve en üstünde uygulamaya dönüş satırı bulunur.

Kenar çubuğu `[`, özellik paneli `]` tuşuyla açılıp kapanır. İkisinin de genişliği tarayıcıda saklanır.

### 4.2 Kenar çubuğu

Yukarıdan aşağıya:

1. Şirket menüsü. Şirket adı ve küçük bir desen simgesi. Tıklanınca şirket listesi açılır; her satırda şirketin kısa kodu görünür, seçili olanın yanında onay işareti durur.
2. Yeni görev, Ara, Genel bakış, Gelen kutusu. Genel bakış satırında o an süren çalışma sayısı mavi bir noktayla gösterilir ("3 live"). Gelen kutusu satırında bekleyen iş sayısı rozet olarak durur; başarısız bir çalışma varsa rozet kırmızıya döner.
3. İş (Work) grubu: Görevler, Projeler, Rutinler, Çıktılar.
4. Organizasyon (Org) grubu: Ajanlar, Skill'ler, Bağlayıcılar, Denetim.
5. Son görevler: kullanıcının açtığı, oluşturduğu ya da yorum yazdığı görevlerden en çok beşi; süren çalışması olanlar canlı noktasıyla.
6. En altta hesap menüsü: Ayarlar, tema değiştirme, çıkış.

Kenar çubuğunda "Onaylar" ve "Ayarlar" satırı yok. Bekleyen onaylar Gelen kutusu rozetindeki sayıya katılır; ayarlar hesap menüsünden açılır. Liste de kısa, on iki satır. Deneysel özellikler, ilgili ayar açılmadıkça görünmez.

### 4.3 Üst çubuk

Her sayfa kendi konum bilgisini ve kendi düğmelerini üst çubuğa bildirir; çubuğun kendisinde sayfalara özgü neredeyse hiçbir şey yoktur (yalnızca görev sayfası için ayrı bir düzeni vardır). Tek öğe varsa sayfa başlığı gibi görünür; birden fazlaysa "TASKS > Teklif e-postası taslağı RNE-7" biçiminde bir dizi olur. Tarayıcı sekmesinin başlığı da aynı bilgiden üretilir.

### 4.4 Özellik paneli

Görev ve hedef sayfaları açıldıklarında panele içerik verir, kapanırken geri alır. Panel sürüklenerek genişletilir, çift tıklamayla varsayılan genişliğe döner. Belge okurken içerik alanını kaplayacak biçimde büyütülebilir. Telefonda alttan açılan bir sayfaya dönüşür.

Panelin iskeleti, göreve özgü hiçbir şey içermeyen küçük bir bileşen takımıdır (`ui/src/components/side-panel/`). Bu yüzden başka bir projeye en kolay taşınan parçalardan biridir.

### 4.5 Komut paleti ve kısayollar

`Cmd/Ctrl+K` her yerden komut paletini açar: görev, ajan ve proje arama, sayfalara gitme, yeni görev açma.

| Tuş | İşlev |
|---|---|
| `Cmd/Ctrl+K` | Komut paleti |
| `/` | Sayfanın arama kutusuna odaklanma |
| `c` | Yeni görev |
| `[` ve `]` | Kenar çubuğu ve özellik paneli |
| `g` sonra `i` | Gelen kutusu |
| `?` | Kısayol listesi |
| `j`, `k`, ok tuşları, Enter | Listede gezinme ve açma |
| `a` ya da `y`, `r`, `U`, `u` | Gelen kutusu ekranının Benim (Mine) sekmesinde arşivleme, okundu, okunmadı, arşivi geri alma |

Kısayollar yazı alanlarında ve bir pencere açıkken çalışmaz.

### 4.6 Telefon

768 px'in altında kenar çubuğu soldan açılan çekmeceye dönüşür. Altta beş gözlü bir menü çıkar: Ana sayfa, Görevler, Yeni görev, Ajanlar, Gelen kutusu. Aşağı kaydırınca menü gizlenir, yukarı kaydırınca geri gelir. Sekme çubukları açılır listeye, özellik paneli alttan açılan sayfaya dönüşür. Dokunmatik ekranda düğme ve alan yüksekliği en az 44 px olur. Gelen kutusu ekranında satır sola kaydırılarak arşivlenir.

### 4.7 Canlı güncelleme

Kabuk, seçili şirket için tek bir WebSocket bağlantısı açar; canlı bir çalışmanın dökümü ekrandayken ikinci bir bağlantı daha açılır. Sunucu "çalışma başladı", "çalışma bitti", "kayıt değişti" gibi olaylar yollar; arayüz ilgili sorguları 300 ms'de bir toplu olarak yeniler. Bağlantı koparsa 15 saniyede bir yoklamaya geçer, geri gelince her şeyi bir kez yeniler. Tarayıcı sekmesi arka plandayken bağlantı kapatılır.

Anlık bildirimler bilerek seyrek tutulmuş. Kullanıcının kendi yaptığı iş için, o an ekranda açık olan görev için ve zaten ekranda görünen bir durum için bildirim çıkmaz. Aynı türden bildirim 10 saniyede en çok üç kez gösterilir.

## 5. Tasarım dili

### 5.1 Tek kaynak

Temel görsel değerler tek bir CSS dosyasında değişken olarak durur (`ui/src/index.css`, 3.324 satır; hareket değerleri ayrı küçük bir dosyadadır). Bileşenlerde renk kodu yazmak, değişkene bağlı olmayan piksel değeri ya da yazı boyutu kullanmak yasaktır; bir denetim betiği (`scripts/check-token-gates.mjs`) bunu yakalar. Tasarım kuralları depodaki `DESIGN.md` dosyasında yazılıdır.

Kural henüz tam uygulanmış değil. Tailwind'in hazır renk sınıfları (`bg-green-700` gibi) denetimin dışında kalıyor ve kodda binlerce yerde kullanılıyor; ekip bunu kendi belgesinde teknik borç olarak not etmiş.

### 5.2 Renk

Arayüzün kendi vurgu rengi yoktur. Zemin, metin, çizgi ve birincil düğme gri tonlarındadır: açık temada beyaz zemin ve siyaha yakın düğme, karanlık temada tersi. Kart rengi ile zemin rengi aynıdır; kartı zeminden ayıran yalnızca ince kenarlıktır.

Renk esas olarak durumu göstermek için kullanılır. Bunun dışında renk taşıyan birkaç yer vardır: insan mesajının mavi balonu, yeşil onay ve kırmızı ret düğmeleri, uyarı şeritleri ve ajan karakter çizimleri.

| Görev durumu | Rozet rengi | Simge |
|---|---|---|
| Beklemede (`backlog`) | gri `#a8aeb2` | kesikli daire |
| Yapılacak (`todo`) | sarı `#f59e0b` | boş daire |
| Sürüyor (`in_progress`) | mavi `#2563eb` | dönen açık daire |
| İncelemede (`in_review`) | mor `#7c3aed` | içi noktalı daire |
| Bitti (`done`) | yeşil `#22c55e` | onay işaretli daire |
| Engellendi (`blocked`) | kırmızı `#dc2626` | eksi işaretli daire |
| İptal (`cancelled`) | gri `#a8aeb2` | yasak işareti |

Tablodaki renkler rozetin temel rengidir. Tek başına duran simgeler her tema için ayrıca ayarlanmış tonlar kullanır: açık temada daha koyu (yeşil `#16a34a`, sarı `#cc7a00`), karanlık temada daha açık (yeşil `#34d06f`, sarı `#fbbf24`).

Her durumun kendi şekli olduğu için renk tek işaret değildir. Aynı simge listede, pano görünümünde, görev başlığında, filtrede ve aramada kullanılır; grafikler aynı renkleri kullanır. Kullanıcı simgeleri bir kez öğrenir ve her ekranda tanır. Ajan durumları aynı ailedendir: boşta gri, çalışıyor mavi, duraklatıldı sarı, hata kırmızı. Organizasyon şemasındaki durum noktaları ise ayrı bir renk takımı kullanıyor; tutarsız kalmış bir yer.

Görev ve ajan durum rozetleri tek bir kuralla renklendirilir. Bileşen yalnızca temel rengi verir; dolgu, yazı ve kenarlık rengi açık ve karanlık tema için `color-mix` ile türetilir. Çalışma, onay ve hedef rozetleri ise elle yazılmış ayrı bir renk tablosu kullanır.

Ajanların simgeleri sunucuda üretilen küçük karakter çizimleridir; her ajan 17 renk takımından birini alır. Ajan sayfasının başlığında bu karakterin hareketli hâli durur. Gri arayüzde en çok göze çarpan süs öğesi budur.

### 5.3 Yazı ve yoğunluk

- Yazı tipi Inter'dir. Kimlikler (RNE-7), token sayıları ve çalışma ölçümleri sistemin eş aralıklı yazı tipiyle gösterilir.
- Yazı boyutları küçük, yerleşim yoğundur: gövde 14 px, kenar çubuğu satırı 13 px, tablo ve rozet 12 px, yardımcı bilgi 10 ve 11 px.
- Liste satırı alçaktır (36 ile 44 px arası). Kimlik ve zaman sütunları sabit genişliktedir; tablo kullanılmadığı hâlde sütunlar hizalı durur.
- Bölüm ve grup etiketleri büyük harfle ve aralıklı yazılır. Bu, `CLAUDE.md` içindeki kaçınılacaklar listesiyle ("büyük harfli üst etiketler") çatışır (12.2).

### 5.4 Köşe, gölge, çizgi

- Köşe yuvarlaklıkları tek bir temel değerden (8 px) türetilir: düğme ve alan 6,4 px, kart ve pencere 8 px, hesap ve şirket menüsü 11,2 px, rozet tam yuvarlak.
- Durağan kartta gölge yoktur. Belirgin gölge üstte açılan katmanlarda kullanılır: menü, pencere, bildirim. Çerçeveli düğmelerde, giriş alanlarında ve yazma kutusunda çok hafif bir gölge vardır.
- Ayrım ince çizgi ve boşlukla yapılır. `DESIGN.md` kuralı: her kenarlığın, ayırıcının ve dolgunun bir gerekçesi olmalıdır; gerekçesi belli değilse kaldırılır.

### 5.5 Hareket

- Pencere, menü ve ipucu açılırken animasyon yoktur. Kodda shadcn'in hazır açılış sınıfları duruyor ama eklentisi kurulu olmadığı için çalışmıyor; ekip bunu karar defterine not edip öyle bırakmış.
- Hareket eden başlıca şeyler şunlardır: süren çalışmanın yanıp sönen mavi noktası, "sürüyor" simgesinin dönmesi, arşivlenen satırın kayarak çıkması, görev akışında yeni mesajın belirmesi ve bir çalışmanın açılıp kapanması, Genel bakış ekranında yeni gelen etkinlik satırı, ajan sayfasındaki hareketli karakter çizimi.
- Görev akışındaki süre ve eğri değerleri de değişken olarak tanımlıdır. İşletim sisteminde "hareketi azalt" açıksa bu süreler sıfıra iner.

### 5.6 Yazılı kurallar

`DESIGN.md` içindeki sekiz ilke kısaca:

1. Her iş için tek bileşen. Çeşitler ayrı bileşen değil, seçenektir.
2. Görsel değerlerin tek kaynağı değişkenlerdir.
3. Boşluklar da değişkenden gelir.
4. Hiyerarşi süsle değil yapıyla kurulur: konum, boyut, kalınlık.
5. Durum sistematiktir: rozette, satırda, grafikte ve kayıtta aynı renk takımı.
6. Makinenin ürettiği değerler belli olur: kimlik, maliyet, sayı ve zaman eş aralıklı yazıyla.
7. Sözcükler sistemin parçasıdır: her kavramın tek adı vardır, düğme yaptığı işi söyler, hata ne olduğunu ve ne yapılacağını söyler, boş ekran ilk adımı gösterir.
8. Arayüz ajanların da değiştirebileceği biçimde kurulur: doğru bir değişiklik "değişkeni düzenle, denetimleri çalıştır" olmalıdır.

Dördüncü ve yedinci ilkeler `CLAUDE.md` içindeki tasarım diliyle örtüşür: "Ayrım gölgeyle değil ince çizgi ve boşlukla yapılır", "Düğme ne yapıyorsa onu söyler", "boş ekran ilk adımı gösterir". Altıncı ilke kısmen örtüşür: `CLAUDE.md` tablolarda eşit genişlikte rakam ister ama tek yazı ailesi der; Paperclip makine değerleri için ayrı bir eş aralıklı aile kullanır. İki projenin asıl ayrıştığı yer görünüştür: renk, yazı tipi, büyük harfli etiketler.

## 6. Ekranlar

Her ekran için önce ne gösterdiği, sonra nasıl davrandığı anlatılıyor. Agent Office'e etkisi olan noktalar "Agent Office için" satırında not edildi; bu notlar PLAN'daki ekran listesine ve depodaki veri modeline dayanır. Arayüz İngilizce olduğu için düğme ve sekme adları Türkçe karşılıklarıyla yazıldı; özgün adı gerekli olan yerlerde ayraç içinde verildi.

### 6.1 Genel bakış (Dashboard)

Sayfa, şirkette o an ne olduğunu gösterir. Yukarıdan aşağıya:

1. Uyarı şeritleri, yalnızca gerektiğinde: hiç ajan yok, bütün ajanlar duraklatılmış.
2. Ajan kutuları, en çok dört tane. Her kutuda ajanın adı, üzerinde çalıştığı görev (durum simgesi, başlık, kimlik) ve "2 dakika önce başladı" bilgisi. Süren çalışmanın kutusu hafif maviye boyanır.
3. Açık bir bütçe olayı varsa kırmızı bir şerit. Uyarı eşiği aşıldığında da bu şerit çıkar.
4. Dört sayı: etkin ajan, süren görev, bu ayın harcaması (bütçenin yüzdesiyle), bekleyen onay. Her biri ilgili sayfaya götürür. Bu kutuların kenarlığı ve gölgesi yoktur; büyük bir sayı ve altında küçük bir açıklama.
5. Son 14 günün üç küçük grafiği: çalışma sayısı (başarılı, başarısız), duruma göre görevler, başarı oranı. Grafik kütüphanesi kullanılmamış; çubuklar düz kutulardan elle çizilmiş.
6. İki sütun: son etkinlikler ve son görevler, onar satır.

Agent Office için: PLAN'daki Bugün ekranının karşılığıdır; o ekran bekleyen onayları, bugünkü görevleri, ajanların son işlerini ve uyarıları gösterir. Ajan kutuları ve son etkinlikler doğrudan uyar. Dört sayı ve grafikler ise Sprint 4'teki Ölçümler ekranına (modül M13) daha yakındır. Kurucunun holding görünümünde aynı yerleşim iki şirketin toplamıyla, salt okunur olarak kurulabilir; holding görünümünün ne göstereceği SONRA'da karar bekliyor (N15).

### 6.2 Gelen kutusu (Inbox)

Paperclip'in en çok emek verilmiş ekranı ve Onay Masası için en yakın örnek.

**İçerik.** Dört tür kayıt tek listede birleşir: görev, onay, başarısız çalışma, katılma isteği. Sekmeler: Benim (Mine), Son, Okunmamış, Engellenenler, Tümü. Benim sekmesi, kullanıcının üzerinde işlem yaptığı ve arşivlemediği görevlerle kendisinden karar bekleyen kayıtları gösterir.

**Satır.** Soldan sağa: okunmamış noktası, durum simgesi, başlık, süren çalışma varsa Canlı (Live) rozeti, üzerine gelince beliren Arşivle düğmesi, görev kimliği, zaman. Okunmamış satırın başlığı kalın yazılır. Satırın tamamı tıklanabilir, içindeki düğmeler de ayrıca çalışır. Onay satırında Onayla ve Reddet düğmeleri satırın üzerindedir. Başarısız çalışma satırında hatanın ilk satırı ve Yeniden dene düğmesi bulunur.

**Davranış.**

- Kullanıcı listeyle çalışırken satırlar yer değiştirmez. Yeni sıralama yalnızca şu anlarda uygulanır: sayfa açılırken, sekme ya da filtre değişince, 150 saniye hiçbir işlem yapılmayınca, tarayıcı sekmesi en az 30 saniye arka planda kaldıktan sonra. Arada gelen yeni kayıtlar yerlerine eklenir ama var olan satırlar yer değiştirmez.
- Arşivleme beklemeden gerçekleşir. Satır hemen kayarak çıkar; sunucu hata verirse aynı satır aynı yerine döner. `u` tuşu son arşivlemeyi geri alır.
- Görevlerin okundu bilgisi kullanıcıya özeldir ve sunucuda tutulur; görev açılınca okundu sayılır. Onay, başarısız çalışma ve katılma isteği satırlarının okundu bilgisi yalnızca tarayıcıda durur; bu satırları listeden kaldırma bilgisi ise sunucuda tutulur.
- Klavye ile fare çakışmaz. Basılan tuş, son tuştan sonra fare oynatıldıysa imlecin altındaki satıra, oynatılmadıysa klavyeyle seçili satıra uygulanır.
- Gruplama (tür, atanan, proje), alt görevleri üst görevin altında gösterme, "Bugün, Dün, Daha eski" ayırıcıları ve sütun seçimi vardır.
- Boş ekran metinleri ekrana özeldir: "Inbox zero." (gelen kutusu boş), "No work is stopped." (duran iş yok) gibi.

**Rozet.** Kenar çubuğundaki sayı şunların toplamıdır: karar bekleyen onaylar, bekleyen katılma istekleri, başarısız çalışmalar, okunmamış görevler. Bütçe gibi şirket genelindeki uyarılar sayıya katılmaz; rozet "benden beklenen iş" demektir.

**Kararlar masası.** Varsayılan olarak kapalı, deneysel ikinci bir ekran daha var. Sunucunun önem sırasına dizdiği kartlar, her kartın üzerinde karar düğmeleri, erteleme (1 saat, 4 saat, yarın sabah, gelecek hafta) ve yok sayma. Fikir Onay Masası'na çok yakın, ama Paperclip'te hâlâ deneysel ve bir parçası sonradan geri çekilmiş.

Agent Office için: Onay Masası bu ekranın kalıbıyla kurulabilir. PLAN'da ayrı bir gelen kutusu ekranı yok; soruları, görev önerilerini, sınıra takılan çalışmaları ve bildirimleri, bekleyen onaylarla birlikte gösteren "bana düşenler" listesinin doğal yeri Bugün ekranıdır (14.5). Veri modelinde bildirimlerin okundu bilgisi var; görevler ve onaylar için kullanıcıya özel okundu bilgisi yok (13.4). Sabit sıra için veri modelinde değişiklik gerekmez; arayüz tarafında sağlanır. Bekleyen onaylar arşivlenmez (13.4).

### 6.3 Görev listesi

- Araç çubuğu: Yeni görev, arama, liste ya da pano görünümü, alt görevleri iç içe gösterme, sütun seçimi, filtre, sıralama, gruplama.
- Filtreler: durum, atanan, oluşturan, proje, etiket, "yalnızca süren çalışması olanlar", "rutin çalışmalarını gizle". Hazır hızlı filtreler: Tümü, Etkin, Beklemede, Bitti.
- Satır içinde düzenleme: durum simgesine tıklayınca durum, Atanan sütunu açıksa o sütuna tıklayınca atanan, görev açılmadan değişir. Bu iki değişiklik sunucu yanıt verince ekrana yansır.
- Gruplanmış listede her grup başlığının yanında bir "+" düğmesi vardır. Bu düğme, o grubun değeri (durum, proje, atanan) dolu gelen yeni görev penceresini açar.
- Görünüm ayarları (filtre, sıralama, gruplama, sütunlar) şirket ve liste başına tarayıcıda saklanır. Sunucuda kayıtlı görünüm yoktur.
- Pano görünümü: yedi durum sütunu. Kartlar sürüklenerek durum değiştirir. Her sütunda 10 kart ve "N tane daha göster" düğmesi bulunur.
- Toplu işlem yoktur: satır seçme kutusu, çoklu seçim, toplu durum değiştirme bulunmuyor.
- Görev önceliği alanı veri modelinde var ama arayüzde gizli.
- Filtreleme, sıralama ve gruplama tarayıcıda yapılır; sunucuya yalnızca arama ve sayfalama gider. İlk 100 satır çizilir, kaydırdıkça 150'şer eklenir.

Agent Office için: görev durumları altı tane olduğu için pano altı sütunlu olur. `CLAUDE.md`'ye göre Y1 ajanın kendi görevinin durum geçişlerini çalıştırıcı yapar; sürükleyerek ya da satır içinden durum değiştirme yalnızca insanın yapmasına izin verilen geçişlerde kullanılabilmelidir. Hangi geçişi insanın, hangisini ajanın yapacağı SONRA'da karar bekliyor (M16). PLAN'daki Görevler ekranı da pano ve listeden oluşur; filtreleri şirket, birim, ajan ve durumdur.

### 6.4 Yeni görev penceresi

Tek bir pencere; alanları bir cümle gibi dizilmiş. Başlık, altında "[Atanan] için, [Proje] içinde", açıklama (markdown), en altta durum ve çalışma modu (olağan, önce plan, yalnızca yanıt) seçimi, sağda Görevi oluştur düğmesi.

- Başlık ya da açıklamadan biri yeterlidir.
- Taslak, yazma durduktan 800 ms sonra tarayıcıya kaydedilir. Pencere yanlışlıkla kapanırsa yazılan kaybolmaz. "Taslağı at" sol altta, göze batmayan bir düğmedir.
- Yeni görev "yapılacak" durumunda açılır. "Beklemede" seçilmişse atanan seçilince durum "yapılacak"a geçer. Birine atanmış olup beklemede kalan görev için "bu görev bekletiliyor, ajan uyandırılmayacak" notu çıkar.
- Sürüklenip bırakılan metin dosyaları görev belgesi, diğerleri ek olur.
- `Cmd/Ctrl+Enter` görevi oluşturur.

### 6.5 Görev sayfası

Kullanıcının en çok vakit geçirdiği ve Paperclip'i sıradan görev yöneticilerinden ayıran ekran. Yalnızca ana dosyası 8.469 satırdır; akışla birlikte tamamı en dar sayımla yaklaşık 34 bin satır tutar (13.5).

**Yerleşim.** Ortada sohbet gibi akan bir yazışma, altta sabit yazma kutusu, sağda özellik paneli. Başlık (durum simgesi, görev adı, kimlik) akışın içindedir ve yukarı kayıp gider; yazma kutusu hep yerinde kalır.

**Akış.** Akış veritabanında tek tablo olarak durmaz, ekranda birleştirilir. Yorumlar, ajan çalışmaları, soru ve onay istekleri, belgeler ve çıktılar zamana göre tek sıraya dizilir. Görevin açıklaması ilk mesajdır. İnsan mesajı sağda mavi balondur. Ajan mesajı balonsuz, sayfanın üzerinde düz metindir.

**Ajan çalışmasının gösterimi.** Ajanın ne yaptığı basamak basamak, kullanıcı istedikçe açılır:

| Basamak | Görünen |
|---|---|
| 0 | Ajanın yanıtı, düz metin |
| 1 | Tek soluk satır: "Worked" (çalıştı) ya da süreyle birlikte "Worked for 38s". Eski çalışmalarda "Activity" |
| 2 | Aşamalar: ajanın kendi kısa notu ve "dosya okudu, komut çalıştırdı" gibi tek satırlık özet |
| 3 | Adım listesi: simge, fiil, hedef, sonuç işareti |
| 4 | Adımın girdisi ve çıktısı |
| 5 | Çalışma sayfası: tam döküm, ham kayıt ve olaylar |

Basamakların görünüşü ajanın nasıl çalıştırıldığına göre biraz değişir. Paperclip'in kendi çalıştırıcısıyla çalışan ajanlarda süre satırı başlık olarak durur ve altındaki aşamalar açık gelir; adım listesi her aşamada yine tıklanınca açılır. Diğer ajanlarda satır kapalı gelir ve tıklanınca açılır. Akıştan çalışma sayfasına bağlantı yalnızca hata işaretlerinde çıkar; diğer durumlarda çalışma sayfası ajan sayfasından ya da Denetim ekranından açılır.

Özet satırı yalnızca yapılan işi yazar, başarılı olduğunu ileri sürmez. Başarısız bir okuma "dosyalara baktı", başarısız bir düzenleme "dosyalar üzerinde çalıştı" diye yazılır. Yanıt bırakmadan biten son çalışma da iz bırakır: çalışmanın tamamlandığını ve kullanıcıya dönük yanıt gelmediğini söyleyen bir satır.

Çalışma sürerken akışın sonundaki tek satırda yanıp sönen bir nokta, geçen süre ve o an yapılan iş gösterilir. Kullanıcı en alttaysa ekran yeni içeriği izler. Yukarı kaydırmışsa yeri korunur ve "en sona git" düğmesi belirir. Çalışma bitince canlı satır, yanıt gelene kadar (en çok 15 saniye) ekranda tutulur; "çalışıyor" ile yanıt arasında boşluk görünmez.

**Soru ve onay kartları.** Ajan insandan bir şey istediğinde bu, akışın ortasında kaybolmaz; yazma kutusunun hemen üstüne yerleşen ayrı bir kart olur. Kullanıcı soruyu tam yazacağı yerde görür; yazma kutusu kartın altında kullanılabilir kalır. Kart kapatılırsa yazma kutusunun içinde "1 pending" (1 bekleyen) satırı kalır ve tıklanınca kartı yeniden açar. Yanıtlanınca kart akışta tek satırlık bir kayda dönüşür; tıklanınca asıl istek ve verilen yanıt açılır. Bağlantı isteği bunun dışındadır; kartı akışın içinde kalır.

| Tür | Kart |
|---|---|
| Soru (`ask_user_questions`) | Her sayfada bir soru, seçenekler (önerilen işaretli), "Diğer" için yazı alanı, 1-9 tuşlarıyla seçim |
| Onay isteği (`request_confirmation`) | Metin, ayrıntı, ret ve onay düğmeleri. Reddederken gerekçe zorunlu tutulabilir |
| İşaretli onay (`request_checkbox_confirmation`) | En az ve en çok seçim sayısı olan liste |
| Görev önerisi (`suggest_tasks`) | Ağaç hâlinde önerilen görevler; işaretlenenler oluşturulur |
| Kalem kalem karar (`request_item_verdicts`) | Her kalem için onay ya da ret |
| Bağlantı isteği (`connection_intent`) | Bir servise bağlanma isteği |

Düğme adlarını isteği açan taraf belirler. Denemede onay kartına "Onayla" ve "Düzeltme iste" yazdırıldı ve ret için gerekçe zorunlu tutuldu; kart bunu olduğu gibi gösterdi.

Araç eylemi onayı, onay isteğinin özel bir hâlidir ve Agent Office'in dışa etkili eylem onayına en yakın örnektir. Kartta uygulamanın logosu, yapılacak işin ön izlemesi ve iki düğme bulunur: "Decline" (reddet) ve "Approve & run" (onayla ve çalıştır). İzin verilmişse düğmenin yanındaki açılır menüde "Always allow" (her zaman izin ver) seçeneği de çıkar. Onaylamak çalıştırmak demektir: sunucuda argümanlarıyla saklanan çağrı onay anında bir kez çalıştırılır, ajandan aynı çağrıyı yinelemesi istenmez. İsteğin verisinde risk düzeyi (okuma, yazma, yıkıcı), son geçerlilik zamanı ve argümanların özeti de bulunur; varsayılan kart bunları göstermez, risk yalnızca onay düğmesinin rengini değiştirir.

**Yazma kutusu.** Mesaj gönderilince kutu hemen boşalır, mesaj sunucu beklenmeden akışta görünür. Ajan çalışırken yazılan mesaj kuyruğa girer ve "Queued" (sırada) diye işaretlenir; kullanıcı onu düzenleyebilir, silebilir ya da süren çalışmaya hemen iletebilir. Çalışma sürerken ve kutu boşken Gönder düğmesi Durdur düğmesine dönüşür. Taslak, yazarken kaydedilir. Sunucudan yanıt gelmezse arayüz tahmin yürütmez: kaydedildiğini doğrulayamadığını söyler ve kullanıcıya sorar.

**Durdurma ve duraklatma.** Durdurma o anki çalışmayı keser; yazma kutusu yerinde kalır. Duraklatma ise görevin (istenirse alt görevleriyle birlikte) girdiği bir durumdur. Yazma kutusunun yerini alan tek şey budur: duraklatılmış görevde kutunun yerinde sarı bir blok durur; görevin duraklatıldığını, mesaj göndermek için sürdürülmesi gerektiğini ve taslağın saklandığını söyler.

**Özellik paneli.** Panel Özellikler sekmesiyle açılır. İlişkili görev varsa Görevler, ilk çıktı gelince Çıktılar sekmesi eklenir; açılan her belge de ayrı bir sekme olur. Özellikler: durum, atanan, proje, etiketler; üst görev, engelleyenler, engellenenler; gözden geçirenler ve onaylayanlar; tarih bilgileri. Alt görevlerde "7 alt görevden 3'ü bitti" çubuğu ve tek bir "sıradaki iş" vurgusu vardır.

**Belgeler.** Bir göreve birden çok markdown belgesi bağlanır. Her belgenin sürüm geçmişi, kilidi ve pasaj üzerine yorumu vardır. `plan` anahtarlı belge plandır ve akışta "Plan, sürüm 2" kartıyla görünür. Otomatik kayıt, yazma durduktan 900 ms sonra çalışır. Eski sürüm geri yüklenince yeni bir sürüm oluşur, geçmiş silinmez.

**Eksik kalanlar.** Varsayılan arayüzde görev sayfasında çalışma defteri (görevin çalışmalarını tek tek listeleyen blok) ve göreve bağlanmış yönetim kurulu onaylarının kartları yoktur; bunlar eski "klasik" arayüzde duruyor. Görev düzeyinde maliyet özeti de yoktur; token sayıları ve (adaptör bildirirse) dolar tutarı çalışma başına görünür. İnceleme aşamasında bir insanın "onayla" ya da "düzeltme iste" diyebileceği düğme görev sayfasında bulunmuyor; bu düğmeler yalnızca deneysel kararlar masasında var.

Agent Office için: PLAN'daki Görev ayrıntısı ekranı aynı içeriği istiyor: talep, ajanın adımları ve araç çağrıları, çıktılar, yorumlar, maliyet, işi ajandan devralma, KOR-1'in yönlendirmesini düzeltme. Veri de hazır: görev yorumları, çalışma kaydı (özet, token, maliyet, süre) ve sıralı araç çağrıları (araç, durum, girdi, sonuç). Çalıştırıcı Claude API'yi doğrudan çağırdığı için Paperclip'in komut satırı çıktısını ayrıştırmak için yazdığı katmana gerek kalmaz. `awaiting_approval` durumu, bekleyen bir onay kaydına denk gelir. `awaiting_reply` için yanıt taslağındaki öneri, sorunun görev yorumu olarak yazılmasıdır; yanıtın nasıl bekleneceği karar bekliyor (X1-6); Paperclip'in soru kartı buna seçenekli soruyu ekler (13.4). Maliyet, Paperclip'tekinin tersine Görev ayrıntısında görünür olmalıdır. Onay kartı, onay kaydındaki alanları gösterir: özet, risk notu, fark, kaynaklar, seçenekler.

### 6.6 Çalışma sayfası

Bir çalışma beş yerden izlenir: görev akışındaki özet satırı, ajan sayfasındaki çalışma kaydı, Denetim ekranındaki çalışma listesi, Gelen kutusu satırı ve Genel bakış ekranındaki ajan kutusu. Çalışma sayfasında durum, model, süre, giriş ve çıkış token'ı, maliyet, çalışmanın işlem yaptığı görevler, hata metni ve tam döküm bulunur. Döküm iki biçimde gösterilir: düzenlenmiş ve ham. Duruma göre düğmeler: İptal, Yeniden dene, Sürdür.

### 6.7 Onaylar

Paperclip'te "bir insan evet demeli" anlamına gelen birkaç ayrı mekanizma var. Agent Office için önemli olan dördü aşağıda; uyarlarken bunları karıştırmamak gerekir.

| Mekanizma | Ne için | Nerede karar verilir |
|---|---|---|
| Yönetim kurulu onayları (`approvals` tablosu) | Ajan işe alma, strateji, bütçe aşımı, genel onay isteği | Onaylar sayfası, Gelen kutusu satırı, onay ayrıntı sayfası |
| Araç eylemi onayı ("Ask first") | Bir bağlayıcı eyleminin tek tek çağrıları | Görev akışındaki onay kartı ve bağlayıcıların inceleme (Review) sırası |
| Gizli anahtar önerileri | Ajanın önerdiği kimlik bilgisi | Gizli anahtarlar sayfası ve görev akışındaki kart |
| Görev içi etkileşimler | Soru, onay isteği, görev önerisi | Görev sayfasındaki kart |

Bunların dışında kodlama ajanının çalışırken sorduğu izin soruları, katılma istekleri ve inceleme aşamaları da insan kararı ister.

Onaylar sayfası sade bir kart listesidir: Bekleyen ve Tümü sekmeleri. Kartta tür etiketi, isteyen ajan, konu, durum ve türe göre çizilen içerik bulunur. Genel onay isteğinin içeriği iyi bir şablondur: özet, sarı kutuda "önerilen eylem", "onaylanınca ne olur", riskler, önerilen metin. Altta Onayla ve Reddet.

Ayrıntı sayfasında iki düğme daha vardır: Düzeltme iste ve (düzeltme istenmişse) Yeniden gönderildi. Onayın kendi yorum akışı vardır. Onay verildikten sonra yeşil bir şerit yalnızca bir sonraki adımı gösterir: bağlı görevi incele, işe alınan ajanı aç ya da onaylara dön. İsteğin ham hâli ayrı bir düğmeyle açılır.

Sunucu tarafı: onaylamak, reddetmek ve düzeltme istemek yalnızca insanlara açıktır. Onay verilince, türü ne olursa olsun, isteyen ajan "onaylandı" gerekçesiyle uyandırılır ve işine kendisi devam eder; bağlı görevler kendiliğinden kapanmaz.

Bağlayıcıların inceleme sırasındaki araç eylemi onay kartında üç düğme vardır: bir kez izin ver, her zaman izin ver, reddet. "Her zaman izin ver" o ajan, o bağlantı ve o eylem için kalıcı bir güven kuralı oluşturur; aynı eylem için bir daha onay sorulmaz.

İncelenen onay akışında yeniden kimlik doğrulama adımı görülmedi.

Agent Office için: Onay Masası için örnek alınacak yer Onaylar sayfası değil, araç eylemi onayıdır; "İnsana sor" yolu için örnek de görev içindeki soru kartlarıdır. Onaylar sayfası ajan işe alma ve strateji gibi seyrek ve büyük kararlar için tasarlanmış. "Her zaman izin ver" seçeneği dışa etkili eylemlerde değişmez kural 4 ile çatışır ve alınmamalıdır. Düzeltme isteme döngüsünün Agent Office'te durum olarak karşılığı var (`changes_requested`); yeniden gönderme adımı da karara bağlanmış: düzeltme istenen iş aynı ajana döner, yeni onay öncekine bağlanır, ikinci düzeltmeden sonra iş insana düşer (2 Ekim, karar 10).

### 6.8 Ajanlar ve ajan sayfası

Liste: durum sekmeleri (tümü, etkin, duraklatılmış, hatalı), liste ya da şema görünümü. Satırda ajanın simgesi, adı, rolü, modeli, son çalışma zamanı, canlı rozeti ve durum rozeti bulunur. Duraklatılmış ajanın satırı soluk gösterilir.

Ajan sayfasında sekme çubuğu yoktur; alt sayfalar ikinci kenar çubuğunda gruplanır: Ajan (genel bakış, talimatlar, skill'ler), Çalışma ortamı (adaptör, gizli anahtarlar, araçlar, kanallar), Yönetişim (izinler, API anahtarları, sürümler), Denetim (etkinlik, çalışmalar, maliyet, bütçe). Denetim bağlantıları ayrı sayfa açmaz; ortak Denetim ekranını o ajana göre filtrelenmiş olarak açar.

Başlıktaki düğmeler: Şimdi çalıştır, Duraklat ya da Sürdür, Görev ata. Ajanın genel bakış sayfasında son çalışma kartı, kimlik, model, yetenekler, skill'ler ve son görevler bulunur. Ajan ayarlarındaki değişikliklerin sürüm geçmişi vardır ve kaydedilmemiş değişiklik varken sayfadan çıkış engellenir.

Agent Office için: liste ve sayfa düzeni uyar, düzenleme tarafı uymaz. Agent Office'te kartların asıl kaynağı depodur ve panel, kartları salt okunur gösterir. Uyan kısımlar: ajan listesi, durum rozeti, ajan durdurma düğmesi, şirkete özel ayarlar ve bütçe, kart içeriği, sürüm geçmişi ve test sonuçları (salt okunur), son çalışmalar. PLAN'daki Ajanlar ekranı birimlere göre ajanları, durumlarını, yetki seviyelerini ve durdurma düğmelerini gösterir; Görev kartı ekranı salt okunurdur. Yetki seviyesi (Y0-Y3) Paperclip'te karşılığı olmayan bir alandır ve liste satırında ad ve durumla aynı öncelikte gösterilmelidir. Y2 ve Y3 kapıları ile çıktı türüne göre ayrı seviye henüz karar bekliyor (M19); gösterim o karara göre biçimlenir.

### 6.9 Organizasyon şeması

Ajanları yukarıdan aşağıya ağaç olarak çizer. Kütüphane kullanılmamış: yaklaşık 50 satırlık bir yerleşim hesabı, kartlar için sıradan HTML öğeleri, bağlantı çizgileri için tek bir SVG. Sürükleyerek kaydırma, tekerlekle imlecin olduğu yere yakınlaştırma, iki parmakla yakınlaştırma ve "sığdır" düğmesi vardır. Kartta ajanın simgesi, durum noktası, adı, unvanı ya da rolü, adaptörü ve yeteneklerinden iki satır görünür. Aynı ağaç sunucuda SVG ve PNG olarak da üretilebilir.

Agent Office için: Paperclip'te ağaç "ajan ajana bağlıdır" ilişkisinden çıkar. Tasarım raporunda ajanlar arasında böyle bir ilişki yok: her ajanın bir insan sorumlusu var, işi KOR-1 dağıtıyor. Şema şirket, birim, ajan sırasıyla kurulabilir; PLAN'daki Ajanlar ekranı zaten birimlere göre düzenlenmiş. Şema, izometrik Ofis görünümünün (modül M15) yerine geçmez; onu tamamlar.

### 6.10 Rutinler

Rutin, yinelenen bir iş tanımıdır. Tetikleyiciler: zamanlama, webhook, API; elle de çalıştırılabilir. Rutin kurallarının elemediği her tetiklenme sıradan bir görev açar ve böylece iz kaydı görev üzerinden yürür. Varsayılan kuralda, önceki görev hâlâ açıksa yeni görev açılmaz.

Zamanlama düzenleyicisinde yedi hazır seçenek (her dakika, her saat, her gün, hafta içi, haftalık, aylık, özel) cron ifadesine çevrilir, yazılmış bir cron ifadesi de yeniden bu seçeneklere çevrilir; sonraki tetiklenmelerin ön izlemesi gösterilir. Rutin kurallarında her seçenek sonucunu bir cümleyle söyler:

| Kural | Seçenekler |
|---|---|
| Çakışma | Önceki sürüyorsa birleştir, her seferinde sıraya al, sürüyorsa atla |
| Kaçırılanlar | Kaçırılanı atla, kaçırılanları belirli bir sayıya kadar telafi et |
| Etkinlik kapısı | Her zaman çalış, son çalışmadan beri değişiklik yoksa atla |

Altındaki "sonraki 5 tetiklenme" listesi, seçilen kuralın hangi saatlerde ne yapacağını gösterir.

Agent Office için: zamanlanmış çalışmalar kartlarda tetikleyici olarak yazılı (KOR-3 kartında günlük onay turları gibi) ve kartların asıl kaynağı depodaki dosyalardır; rutini arayüzden düzenlemek bununla çatışır. Salt okunur kısımlar uyar: zamanlamanın düz yazıyla anlatımı, sonraki tetiklenmeler, çalışma geçmişi. "Değişiklik yoksa atla" kuralı gereksiz API harcamasını önlemek için doğrudan işe yarar.

### 6.11 Maliyet ve bütçe

Maliyet, Denetim ekranının bir sekmesidir. Tarih aralığı seçilir (ay başından bugüne, 7 gün, 30 gün, yıl, tümü). Dört sayı kutusu, ardından ajana göre (modele kadar açılabilen) ve projeye göre kırılım tabloları gelir. Kullanım çubuğu yüzde 70'e kadar yeşil, 90'a kadar sarı, üstünde kırmızıdır.

Bütçe üç parçadan oluşur:

1. Kural: şirket, ajan ya da proje için tutar; aylık ya da toplam; uyarı yüzdesi (varsayılan 80); kesin durdurma (varsayılan açık).
2. Olay: eşik aşıldığında açılan kayıt. Kesin sınır aşılınca ajan ya da proje duraklatılır, süren işleri iptal edilir ve bir onay kaydı açılır. Olay kartında iki çıkış vardır: bütçeyi yükselt ve sürdür ya da duraklatılmış bırak.
3. Çalışma öncesi kapı: her çalışma başlamadan önce şirket, ajan ve proje bütçesi yeniden denetlenir. Engel varsa anlaşılır bir gerekçeyle reddedilir.

Denemede bir hata görüldü: uyarı eşiğinde açılan kayıt (26,46 dolar harcama, 30 dolar sınır, ajan duraklatılmamış) ekranda "AGENT HARD STOP" başlığı ve "bu kapsam duraklatıldı" metniyle gösterildi. Kart eşiğin türüne bakmıyor.

Abonelikle çalışan komut satırı ajanlarının çalışmaları sıfır maliyetle kaydedilir, dolayısıyla bütçe kuralları onları sınırlamaz.

Agent Office için: kalıp alınırken uyarı ile durdurma ayrı gösterilmelidir. Agent Office, Claude API'yi doğrudan çağırdığı için gerçek token ve maliyet bilgisine sahiptir; bütçe denetimi bu yüzden Paperclip'tekinden daha güvenilir olur. Bütçe aşılınca ne olacağı SONRA'da karar bekliyor (X1-4); yanıt taslağı yalnızca uyarı verilmesini, işin durmamasını öneriyor (14.7).

### 6.12 Denetim

Tek ekran, beş sekme: Etkinlik, Çalışmalar, Maliyet, Bütçe, Zaman çizelgesi. Her bağlantı adres çubuğunda kapsam taşıyabilir (şu ajan, şu çalışma, şu kayıt); "bu ajanın maliyeti" aynı ekranın o ajana göre filtrelenmiş hâlidir.

Etkinlik satırı bir cümledir: "kim, ne yaptı, neye". Yanında ajanın kimin adına çalıştığı, çalışmaya bağlantı ve zaman bulunur. Filtreler: ajan, adına çalışılan kişi, eylem türü, kayıt, tarih aralığı. CSV olarak dışa aktarılabilir. Sayfanın altındaki not, kayıtların sistemce yazıldığını ve düzenlenemediğini söyler. Zaman çizelgesi, çalışmaları Gantt benzeri bir şeritte gösterir.

Agent Office için: PLAN'daki İz kaydı ekranının (Sprint 2) karşılığıdır; `runs` ve `audit_log` tabloları bu ekranı besler. `audit_log` yalnızca olay adı ve kimlikleri tutar, serbest metin tutmaz (2 Ekim, karar 13); satırdaki cümle olay adından arayüzde kurulur.

### 6.13 Arama

Tek arama kutusu; görev, yorum, belge, çıktı, ajan ve projede arar. Sonuçlar tür sekmelerine ayrılır. Kutunun içine `status:todo`, `assignee:me`, `updated:>7d` gibi filtreler yazılabilir. RNE-12 gibi tam bir kimlik yazılırsa doğrudan göreve gider. Sonuç yoksa üç çıkış önerir: bütün türlerde ara, bu metinden görev oluştur, görev filtrelerini aç.

### 6.14 Bağlayıcılar ve araç kuralları

Bağlantı kurulurken iki şey belirlenir: bu kimlik bilgisini hangi insanlar kullanabilir, bu bağlantıyı hangi ajanlar kullanabilir. İncelenen kodda (henüz yayımlanmamış bir sonraki sürümde) kurulum bunları sormaz; varsayılanı tek cümleyle söyler ("senin adına bağlanır, bütün ajanlara açık" gibi) ve değiştirmek isteyenleri ayar sayfasına yönlendirir. Ardından bağlantının her eylemi için üç durumlu bir seçici gelir:

| Durum | Anlamı |
|---|---|
| Off (kapalı) | Ajanlar bu eylemi çalıştıramaz |
| Ask first (önce sor) | Her çağrıyı bir insan onaylamalı |
| Allowed (serbest) | Onaysız çalışır |

Her satırda risk bilgisi (okuma, yazma, yıkıcı) bulunur. Sonradan eklenen eylemler incelenene kadar kapalı kalır. Bir ajanın hangi araca hangi kurala dayanarak erişebildiğini gösteren bir denetleme ekranı vardır.

Agent Office için: aynı tablo salt okunur bir gösterim olarak uyar. Agent Office'te eylemin durumu arayüzden seçilmez, koddan türer: `CLAUDE.md`'ye göre `external_effect` sınıfındaki araçlar her çağrıda, `approval_rule` alanı olan araçlar yazılı durumda, Y1 kartların `internal_write` çağrıları Onay Masası'na düşer; `draft` sınıfı yalnızca ajana ayrılmış korumalı alana yazar. "Bu ajan neye erişebiliyor ve neden" görünümü kart sayfasına iyi bir ek olur.

### 6.15 Diğer ekranlar

- Çıktılar (Artifacts): ajanların ürettiği dosya, belge ve görsellerin şirket genelindeki galerisi; göreve göre gruplanır.
- Projeler: "Benim projelerim" ve "Diğer projeler". Dikkat: Paperclip'te proje üyeliği yalnızca kenar çubuğu tercihidir, görünürlüğü kısıtlamaz. Agent Office'te proje bir görünürlük ve sözleşme sınırıdır; liste düzeni alınabilir, "katıl ve ayrıl" düğmeleri alınmamalıdır.
- Skill'ler: kitaplık, kaynaklar, deneme alanı. Agent Office'te skill'ler depoda durduğu için yalnızca salt okunur ayrıntı sayfası uyar.
- Ayarlar: deneysel özellikler sayfası iyi bir örnektir. Her özellik bir kart; başlık, açıklama, aç/kapa düğmesi ve kapatmanın var olan veriye ne yapacağını söyleyen dipnot.
- Üyeler: bir kişi çıkarılırken açık görevlerinin kime geçeceği sorulur.

## 7. Etkileşim kalıpları

Ekranların kullanımını rahat kılan şey aşağıdaki etkileşim kalıplarıdır. Hiçbiri Paperclip'in rengine ya da yazı tipine bağlı değildir; çoğu başka bir görsel dille de uygulanabilir. Onaylar için geçerli olmayanlar 13.4'te belirtildi. Asıl alınması gereken şey bu listedir.

1. **Tek durum dili.** Her durumun bir rengi ve bir şekli vardır. Liste, pano, başlık, filtre ve arama aynı simgeyi, grafikler aynı renkleri kullanır.
2. **Tıklanabilir satır.** Satıra tıklamak kaydı açar, ama satırın içindeki düğmeler de çalışır. Durum ve atanan, kayıt açılmadan satır içinden değişir.
3. **Gecikmesiz seçim vurgusu.** Satırın üzerine gelince ya da seçince renk geçiş animasyonu olmaz; fare hızlı gezdirildiğinde arkada iz kalmasın diye bilerek böyle yapılmış.
4. **Klavye ve fare önceliği.** Basılan tuş, son tuştan sonra fare oynatıldıysa imlecin altındaki satıra, oynatılmadıysa klavyeyle seçili satıra uygulanır.
5. **Sabit liste sırası.** Kullanıcı listeyle çalışırken satırlar yer değiştirmez. Sıra yalnızca belirli anlarda yenilenir; arada gelen kayıt sıradaki yerine eklenir.
6. **Beklemeden görünen, geri alınabilen işlem.** Arşivleme, mesaj gönderme ve görev sayfasındaki değişiklikler sunucu beklenmeden ekrana yansır. Hata olursa yalnızca o kayıt eski hâline döner. Arşivleme tek tuşla geri alınabilir.
7. **Beklemeden açılan kayıt.** Liste satırındaki bilgi ayrıntı sayfasına önceden aktarılır; başlık ve durum beklemeden görünür. Satırın üzerine gelince kayıt önceden yüklenir.
8. **Gerçek ekrana benzeyen yükleme ve boş ekran.** Yüklenirken sayfanın biçiminde gri bloklar görünür. Boş ekran o sayfaya özel bir cümle söyler ve varsa ilk adımı düğme olarak sunar. Bir alt sorgu hata verirse yalnızca o bölüm hata gösterir ve geri kalanın çalıştığı söylenir.
9. **Önce özet, istenirse ayrıntı.** Ajanın işi şu sırayla açılır: yanıt, tek satır, aşamalar, adımlar, ham kayıt. Süre, araç ve token sayıları, özet satırının üzerine gelinene kadar görünmez.
10. **Olanı söyleyen metinler.** Özet satırı yalnızca yapılan işi yazar, başarılı olduğunu ileri sürmez. Yanıtsız biten çalışma bunu söyler. Bir mesajın kaydedilip kaydedilmediği bilinmiyorsa arayüz bunu söyler ve kullanıcıya sorar.
11. **Zıplamayan canlı içerik.** Ekran yalnızca kullanıcı en alttaysa yeni içeriği izler. Çalışma biterken canlı satır, yanıt gelene kadar yerinde kalır.
12. **Yazma kutusunun üstündeki soru.** Bekleyen soru ya da onay isteği akışın ortasında kaybolmaz; yazma kutusunun hemen üstünde kart olarak durur. Seçenek işaretlemek kendiliğinden sonraki soruya geçirmez.
13. **Taslakların saklanması.** Yeni görev penceresi, yazma kutusu, soru yanıtları ve ret gerekçesi taslak olarak saklanır.
14. **Durdurma, duraklatma ve iptal ayrımı.** Üçünün adı ve sonucu farklıdır. Alt görevleri de etkileyen işlemler önce kaç kaydın etkileneceğini gösterir ve güvenli seçenek varsayılandır.
15. **Seyrek bildirim.** Bildirim yalnızca birkaç olay türü için çıkar; kullanıcının kendi işi ve ekranda açık olan kayıt için çıkmaz.
16. **Yoğun ama hizalı yerleşim.** Sabit genişlikte numara ve zaman sütunları, eşit genişlikte rakamlar, uzun listelerde "Bugün, Dün, Daha eski" ayırıcıları.
17. **Bağlamla açılan oluşturma penceresi.** Grup başlığındaki "+" o grubun değerini dolu getirir. Ajan sayfasındaki "Görev ata" atananı dolu getirir.
18. **Saklanan ve paylaşılabilen görünüm.** Liste ayarları tarayıcıda saklanır; sekmeler, arama ve Denetim filtreleri adres çubuğunda durur, bağlantı olarak gönderilebilir.
19. **Sonucu yazılı seçenek.** Rutin kuralları ve üç durumlu araç seçicisi her seçeneğin ne yapacağını bir cümleyle söyler. Devre dışı düğme nedenini söyler.
20. **Onaydan sonraki adım.** Karar verildikten sonra bağlama uygun tek bir öneri çıkar: bağlı görevi incele, onaylara dön.

## 8. Veri modeli ve servisler

Arayüzdeki davranışların çoğu veri modelindeki karşılıklarına dayanıyor. Agent Office için önemli olanlar:

| Konu | Paperclip'te durum |
|---|---|
| Şirket yalıtımı | 226 tablonun 195'inde zorunlu `company_id` var. Satır düzeyi güvenlik, politika ya da kısıtlı veritabanı rolü yok. Yalıtım, her sorgunun şirket koşulu taşımasına ve her uç noktanın erişim denetimi çağırmasına bağlı |
| Görev | Tek atanan (ajan ya da insan). Durum geçiş tablosu belgede yazılı ama kod yalnızca bilinmeyen durum adını reddediyor. Asıl kapılar başka: "sürüyor" durumu atanan ister ve çözülmemiş engelleyen varken reddedilir; "engellendi" durumu, görevin neyi beklediğinin kayıtlı olmasını ister (çözülmemiş bir engelleyen, bekleyen bir soru ya da onay) |
| Görevi üstlenme | Tek bir koşullu UPDATE: beklenen durum, atanan ve kilit uygunsa çalışma kimliği yazılır. İkinci bir çalışma aynı görevi alamaz |
| Etkileşimler | `issue_thread_interactions` tablosu: tür, durum, içerik (payload), sonuç, tekrar önleme anahtarı, kimin yanıtlayabileceği, yanıt gelince atanan ajanın uyandırılıp uyandırılmayacağı. Yanıt beklenirken açık bir süreç tutulmaz; bekleme, tabloda bir satır olarak durur |
| Okundu ve arşiv | Görevler için kullanıcıya özel tablolar: `issue_read_states`, `issue_inbox_archives`; diğer kayıtları listeden kaldırmak için `inbox_dismissals` |
| İz kaydı | Her değişiklik `activity_log` tablosuna aktör, ajan, çalışma ve adına çalışılan kişiyle yazılır. Eylem adları `issue.created`, `approval.created` biçimindedir. Ancak şirket ya da ajan silinince bu kayıtlar da silinir |
| Onaylar | Beş durum: bekliyor, düzeltme istendi, onaylandı, reddedildi, iptal. Kendi yan etkisi olan tek tür ajan işe almadır; türü ne olursa olsun onay, isteyen ajanı uyandırır |
| Bütçe | Kural ve olay tabloları. Her maliyet kaydında eşikler yeniden değerlendirilir |
| Giriş | E-posta ve parola. İki adımlı doğrulama, passkey, Google ile giriş ya da SSO yapılandırılmamış. Varsayılan kurulum modunda (`local_trusted`) hiç giriş yoktur |
| Şirket silme | Görüntüleyici olmayan her üye şirketi silebilir |
| Gizli anahtarlar | Varsayılan sağlayıcıda veritabanında AES-256-GCM ile şifreli durur; ana anahtar aynı sunucuda bir dosyada ya da ortam değişkenindedir |
| Canlı olaylar | API sürecinin içindeki bir olay dağıtıcısı. Redis ya da PostgreSQL LISTEN/NOTIFY yok; ikinci bir süreç olayları görmez |

## 9. Ajan çalıştırma

### 9.1 Uyandırma modeli

Paperclip'te ajan sürekli çalışan bir süreç değildir. Bir uyandırma isteği sıraya alınmış bir çalışma oluşturur; sunucu çalışmayı üstlenir ve adaptörü çağırır; adaptör ajanı bir kez çalıştırır ve sonucu döndürür. Uyandırma kaynakları: zamanlayıcı, görev ataması, elle istek, otomasyon. Her uyandırma isteği bir satırdır; reddedilirse nedeni yanına yazılır. "Bu ajan neden çalışmadı" sorusunun yanıtı kayıtlardan okunur.

Yeni ajanlarda zamanlı uyandırma kapalıdır; atama ya da istek olmadan ajan çalışmaz.

### 9.2 Model döngüsü

Paperclip'in, bir model API'sini doğrudan çağıran kendi ajan döngüsü yok. Adaptörler komut satırı kodlama ajanlarını başlatır ya da uzak ajan servislerini çağırır. Kontrollü bir araç listesiyle, dosya sistemi ve komut kabuğu olmadan, yalnızca API çağrısıyla çalışan bir ajan Paperclip'in hazır parçalarıyla kurulamıyor. En yakın iki yol: deneysel çalıştırıcının barındırılan iki sağlayıcısı (Anthropic'in ve AWS'nin ajan servisleri) ya da kullanıcının kendi betiğini bağladığı `http` ve `process` adaptörleri (denemede kullanılan yol).

Agent Office'in çalıştırıcısı tam da bu eksik parçadır: Claude API'yi kendi araç kataloğuyla çağıran, her adımı kendisi denetleyen bir döngü. Paperclip'e geçilirse bu parça kaybedilir.

### 9.3 Varsayılanlar

Paperclip'in mekanizmaları sıkılaştırılabilir, ama varsayılanları özerklikten yanadır:

| Konu | Paperclip varsayılanı | Kaynak |
|---|---|---|
| Kodlama ajanının izin soruları | Atlanır (`dangerouslySkipPermissions: true`) | `ui/src/components/agent-config-defaults.ts` |
| Çalışma başına tur sınırı | Arayüzdeki formda 1.000; alan boş bırakılırsa sınır yok | aynı dosya; `packages/adapters/claude-local/src/server/execute.ts` |
| Ajan başına eş zamanlı çalışma | 20 | `packages/shared/src/constants.ts:77` |
| Yeni ajan oluşturma | Onay gerekmez; şirket ayarı açılırsa gerekir | `packages/db/src/schema/companies.ts`, `releases/v2026.428.0.md` |
| Bağlanan uygulama | Bütün ajanlara açık, "önce sor" kapalı | `packages/shared/src/app-definitions.ts:256-270` |
| Soru ve onay kartını kim yanıtlar | Herkes, ajanlar dâhil (`anyone`). Bağlantı istekleri, araç eylemi onayları ve gizli anahtar önerileri yalnızca insana açıktır | `server/src/services/issue-thread-interactions.ts:382-444` |
| Araç eylemi onayının geçerlilik süresi | 60 dakika | `server/src/services/tool-gateway.ts:2381` |

2026 içinde varsayılanlar dört sürümde özerklik yönünde değişti: ajan işe almada onay isteğe bağlı oldu, standart güven düzeyindeki ajanlar şirkette görünen her göreve yazabilir hâle geldi, kartları herkes yanıtlayabilir oldu, kodlama ajanları tam otomatik modda başlatılır oldu. Aynı dönemde kısıtlayan değişiklikler de oldu: ucuz model profilleri varsayılan olmaktan çıktı, çıktı üretmeyen çalışmalarda otomatik devralma kaldırıldı, sıradaki sürümde bir ajandan @ ile söz etmek artık çalışma başlatmıyor. Yine de mevcut varsayılanlar özerklikten yanadır; Agent Office'in çıkış noktası bunun tersidir.

### 9.4 Çalıştırıcı için fikirler

Bunlar arayüzle değil çalıştırıcıyla ilgili ve bu incelemenin asıl konusu değil; ama Paperclip'in kullanımda edindiği deneyimler olduğu için not edildi. 13. bölümdeki önerinin parçası değiller; çalıştırıcı işine (KALAN-ISLER 1.1) başlanırken gözden geçirilebilir. Bir kısmı Agent Office'in iş listesinde zaten var: aynı yazmanın iki kez yapılmaması (X1-5), onaylanan çağrının onaydan sonra çalıştırılması (M5), sayaçlar (M33).

- Uyandırma defteri: her uyandırma isteği ve reddedilme nedeni bir satır.
- Birleştirme: bir çalışma sürerken aynı göreve gelen üç yorum üç ayrı çalışma değil, tek bir devam çalışması başlatır.
- Olaya bağlı tekrar önleme anahtarı: çift tıklanan onay ya da yinelenen webhook iki çalışma başlatamaz.
- Kapıların iş alınırken yeniden denetlenmesi: durdurma düğmesi, müşterinin yapay zekâ izni ve bütçe yalnızca iş kuyruğa girerken değil, kuyruktan alınırken de denetlenir.
- Sınırlı ve adlandırılmış yeniden deneme: her otomatik yeniden denemenin adı ve küçük bir üst sınırı vardır; sınır dolunca iş insana düşer.
- Günlük çalışma ve maliyet tavanı.
- Çalışma sonu denetimi, kodla: her çalışmanın geçerli tek bir sonuçla bittiği doğrulanır (taslak saklandı, onay bekliyor, soru bekliyor, bitti, başarısız; bunlar görev durumu değil, çalışma sonucudur). Hiçbiri değilse iş ajanın sorumlusuna düşer.
- Model kullanmadan üretilen devam özeti: görev başına kodla güncellenen kısa bir özet, sonraki çalışmanın istemini küçük tutar.
- Onaylanan çağrının saklanması: onaya düşen araç çağrısının argümanları istek anında saklanır ve imzalanır; onayda o saklanan çağrı bir kez çalışır.
- Model kullanmayan hazır mesajlar: karşılama, hatırlatma ve özet metinleri sabit şablondan gelir.

Paperclip'in kurtarma mekanizmalarının çoğu, durumu onarmak için yeni bir model çalışması başlatır. Kodda, bir kurtarmanın bir keresinde 25 oturum sürdüğü ve maliyeti 2,4 katına çıkardığı not edilmiş. Düşük harcama hedefleyen bir ofis için aynı onarımı insana düşürmek daha ucuzdur.

## 10. Veri paylaşımı, lisans ve güvenlik

### 10.1 Veri paylaşımı

| Kanal | Varsayılan | Nereye | Ne gider | Nasıl kapatılır |
|---|---|---|---|---|
| Telemetri | Açık | `telemetry.paperclip.ing/ingest`, yedek olarak bir AWS API Gateway adresi | Olay adları ve sayılar: rastgele kurulum kimliği, ajan kimlikleri (ham), görev kimliklerinin tuzlanmış özet değeri (salted hash), model adı, token sayısı, süre | `PAPERCLIP_TELEMETRY_DISABLED=1` ya da `DO_NOT_TRACK=1`; yapılandırma dosyasında `telemetry.enabled: false` |
| Duyuru akışı | Açık | `pages.paperclip.ing` | Veri gönderilmez; karşı taraf sunucunun IP adresini görür | `PAPERCLIP_ANNOUNCEMENTS_ENABLED=false` |
| Güncelleme denetimi (CLI) | Açık | npm kayıt defteri | Günde en çok bir kez, veri taşımayan bir istek | `PAPERCLIP_UPDATE_CHECK=0` |
| Geri bildirim paylaşımı | Kullanıcı izin verirse | `telemetry.paperclip.ing/feedback-traces` | Oylanan çıktının çalışma kaydı ve ajan oturum dosyaları (istemler, model çıktısı, araç çıktısı), desenle maskelendikten sonra | Ayardan "Don't allow"; kesin engel için adres değiştirilir ya da güvenlik duvarında kapatılır |
| Hata raporlama (Sentry), izleme (OTLP) | Kapalı | Ayarlanan adres | Hata ve izleme verisi | Ayarlanmadıkça çalışmaz |

Dikkat edilecek noktalar:

- Telemetriyi kapatan ortam değişkeninin değeri tam olarak `1` olmalıdır; `true` yazmak kapatmaz. Telemetri ayrıca CI ortamında kendiliğinden kapanır.
- İlk çalıştırmada telemetri için bildirim ya da soru yoktur; kurulum yapılandırmaya `enabled: true` yazar.
- Görev içeriği, istem, dosya yolu ve gizli anahtar telemetriyle gönderilmiyor. İki şey ise açık metin olarak gider: komut satırından GitHub ya da GitHub Enterprise adresiyle şirket içe aktarılırsa depo adresi; skills.sh kataloğundan skill içe aktarılırsa o skill'in herkese açık katalog anahtarı. README özel depo adlarının özet değeri alınarak (hash) gönderildiğini söylüyor; kod, GitHub adresleri için öyle yapmıyor.
- Geri bildirim paylaşımında "Don't allow" tercihi yalnızca arayüzde uygulanıyor. Sunucu, istekte gelen bayrağa güveniyor.
- Tarayıcı arayüzünde telemetri yok; dışarıdan betik ya da yazı tipi yüklenmiyor.
- Ajan olarak çalıştırılan komut satırı araçlarının kendi telemetrisi Paperclip'in denetiminde değil.

**İlk yanıta düzeltmeler.** Bu incelemeden önce, yalnızca README'ye dayanarak verdiğim ilk yanıttaki bazı noktalar kod okununca değişti:

| İlk yanıtta | Kodun gösterdiği |
|---|---|
| Telemetrinin nereye gittiği belgede yazmıyor | Adres kodda açık: `telemetry.paperclip.ing/ingest` ve bir AWS yedek adresi |
| Özel depo adları özet değeri alınarak gönderilir | GitHub ve GitHub Enterprise adresleri açık metin olarak gönderiliyor |
| Ortam değişkeniyle kapatılır | Doğru, ama değer tam olarak `1` olmalı |
| Başka varsayılan dış çağrıdan söz etmedim | Duyuru akışı ve güncelleme denetimi de varsayılan olarak açık |
| Geri bildirim paylaşımından söz etmedim | İzin verilirse çalışma kayıtları gider; tercih yalnızca arayüzde uygulanıyor |

### 10.2 Lisans

Genel bilgidir, hukuki görüş değildir.

- Depo MIT lisanslı. `LICENSE` dosyasındaki telif satırı "Copyright (c) 2025 Paperclip AI". 46 `package.json` dosyasının 40'ı MIT yazıyor, kalan 6'sı lisans alanı olmayan özel paket. Commons Clause, BUSL, AGPL ya da kurumsal sürüm kodu bulunmadı; "Paperclip EE" yalnızca bir bağlantı ve birkaç metin olarak geçiyor.
- MIT; kopyalamaya, değiştirmeye, kapalı kaynaklı ticari bir ürünün içinde kullanmaya ve satmaya izin verir. Tek koşul: kopyalanan kodla birlikte telif ve izin bildiriminin korunması. Agent Office'in kendi kodunu yayımlama zorunluluğu doğmaz.
- MIT'nin kapsamadığı şeyler: Paperclip adı ve logosu (depoda marka kullanım politikası yok; marka hakkı lisanstan bağımsızdır), arayüzdeki üçüncü taraf marka logoları, yazı tipleri (Inter, SIL OFL), npm bağımlılıklarının kendi lisansları.
- Bazı parçaların kendi bildirimi var: ajan karakter çizimleri (cliplab), Hermes adaptörü, Lobe simgeleri ve sunucudaki şema görselinde kullanılan Twemoji çizimleri (CC-BY 4.0). Oradan bir şey alınırsa o bildirim de korunur.
- Fikri, mimariyi ya da arayüz kalıbını kod kopyalamadan yeniden yazmak bildirim gerektirmez. Kod ya da görsel kopyalanırsa gerektirir.

### 10.3 Güvenlik

| Konu | Paperclip | Agent Office (`CLAUDE.md`) |
|---|---|---|
| Şirket yalıtımı | Uygulama kodunda; RLS yok | RLS, kısıtlı rol, her işlemde `SET LOCAL` bağlamı |
| Giriş | E-posta ve parola; iki adımlı doğrulama ve passkey yok; varsayılan kurulum modunda giriş yok | Google ile davetli giriş, zorunlu iki adımlı doğrulama, önemli onayda passkey |
| Ajanın çalışma ortamı | Komut satırı ajanı, sunucunun işletim sistemi kullanıcısıyla ve izin soruları atlanarak çalışır | Ajan yalnızca kartındaki katalog araçlarını kullanır |
| Dışa etkili eylem | Yalnızca araç geçidinden geçen ve "önce sor" işaretli eylemler onaya düşer; "her zaman izin ver" seçeneği var | Dışa etkili her ajan eylemi Onay Masası'na düşer; onayı atlayan kod yolu yazılmaz |
| İz kaydı | Şirket ya da ajan silinince kayıtlar da silinir | Her ajan çalışması `runs` ve `audit_log` tablolarına yazılır |
| Gizli anahtarlar | Veritabanında şifreli; ana anahtar varsayılan olarak aynı sunucuda | Koda, loglara ve depoya girmez; Google token'ları şifreli saklanır, yalnızca worker kullanır |
| Müşteri sözleşmesi | Karşılığı yok | Sözleşmesi yapay zekâ kullanımına izin vermeyen projede ajan çalışmaz |

Paperclip'in iyi yaptığı ve Agent Office'in kurallarıyla örtüşen iki şey: araç sonuçlarını ve dış içeriği ajana "güvenilmeyen veri" olarak işaretleyip vermesi (değişmez kural 7 ile aynı fikir) ve giriş kimliği ile kaynak bağlantısını birbirinden ayrı tutması (Agent Office'teki giriş istemcisi ve bağlantı istemcisi ayrımı).

## 11. Agent Office ile karşılaştırma

Agent Office tarafındaki bilgiler depodaki belgelerden ve koddan alınmıştır (2.1); hangi bilginin hangi dosyadan geldiği 15.4'te listelendi. Depo dışından gelen bilgiler geçtikleri yerde belirtildi.

### 11.1 Genel karşılaştırma

| Konu | Paperclip | Agent Office |
|---|---|---|
| Amaç | Kodlama ajanlarından kurulu "otonom şirket" yönetimi; açık kaynak ürün | İki şirket için şirket içi ajan ofisi; ekip iş ister ve onay verir. Tasarım raporunda 37 birim ve 173 rol var; pilot 14 ajanla sınırlı ve 8 ajanla açılıyor |
| Ajan çalıştırma | Komut satırı kodlama ajanları adaptörle başlatılır | Çalıştırıcı, Claude API'yi kendi araç kataloğuyla çağırır (modül M5; henüz yazılmadı) |
| Ajan tanımı | Veritabanı satırı; arayüzden oluşturulur ve düzenlenir | Depodaki YAML kartı. Panel, kartı salt okunur gösterir; değişiklik PR ile yapılır |
| İşin girişi | Görev doğrudan bir ajana atanır | Talep, Ofis Koordinatörü'ne (KOR-1) gelir; o yönlendirir. Tasarım raporuna göre koordinasyon katmanı "ofisin tek giriş noktası"dır; birime doğrudan iş vermek yedek yoldur |
| Yetki | İzin anahtarları, güven ön ayarları, araç kuralları | Y0-Y3 seviyeleri ve araç sınıfları. Y1 kapısı kodla uygulanır; Y2 ve Y3 kapıları karar bekliyor (`docs/SONRA.md`, M19) |
| İnsan onayı | İsteğe bağlı: ajan isterse ya da eylem "önce sor" işaretliyse | Zorunlu: dışa etkili her ajan eylemi, Y1 kartların `internal_write` çağrıları ve `approval_rule` alanı olan araçlar (kuralda yazılı durumda). Onay kaydı özet, risk notu, fark, kaynaklar ve seçenekler taşır; ret ve düzeltmede sabit listeden bir neden seçmek zorunludur |
| Şirket yalıtımı | Uygulama kodunda | Veritabanında (RLS) |
| Proje | Görevleri gruplar; görünürlüğü kısıtlamaz | Görünürlük ve sözleşme sınırı |
| İki şirket | Ayrı kiracılar; ortak görünüm yok | Kurucunun salt okunur holding görünümü ve Kurucu alanı |
| Kuyruk | Yok; süreç içi zamanlayıcı | pg-boss; işlere yalnızca kimlik konur |
| Kurumsal hafıza | Göreve bağlı belgeler. Çekirdekte not ya da wiki tablosu yok; depoda deneysel bir wiki eklentisi var | Obsidian gibi çalışan notlar, `[[Not adı]]` bağlantıları, geri bağlantılar |
| Giriş | E-posta ve parola | Google, davet, iki adımlı doğrulama, passkey. Kodu yazıldı; Google istemcisi kurulmadığı için gerçek hesapla denenmedi |
| Arayüz dili | İngilizce; çeviri altyapısı kurulu ama dosyalarında yalnızca üçer metin var | Türkçe |
| Arayüzün durumu | Olgun; yedi aydır aşağı yukarı haftalık sürüm | Kabuk, Giriş, şirket seçimi, Kullanıcılar ve Güvenlik yapıldı. Bugün, Onaylar, Görevler, Notlar ve Ajanlar boş ekran. 2 Ekim kararına göre arayüz geçici |
| Kütüphaneler | React 19, Vite 8, Tailwind 4, shadcn/ui, tek paketli Radix, lucide, TanStack Query; react-router; form kütüphanesi yok | React 19, Vite 8, Tailwind 4, shadcn/ui, tek paketli Radix, lucide, TanStack Query; TanStack Router; react-hook-form ve zod |

Tablodan çıkan sonuç: iki proje arka uçta ve yönetişimde birbirinin neredeyse tersidir, arayüzde ise aynı işi yapar. İkisi de "insan iş verir, ajan çalışır, insan izler ve karar verir" sırasını ekrana taşır ve bunu aynı kütüphanelerle yapar. Agent Office'i Paperclip'e benzetmenin yerinde olduğu taraf arayüzdür.

### 11.2 Kavram eşlemesi

| Paperclip | Agent Office | Not |
|---|---|---|
| Company | `companies`: şirket ve Kurucu alanı | Adres şu an da şirket koduyla başlıyor: `/c/<şirket kodu>/...` |
| Board | `founder`, `employee`, `external` rolleri | Rol kümeleri farklı |
| Agent | `agent_definitions` ve `company_agents` | Tanım ortak, şirkete özel satır ayrı |
| Rol ve unvan | Ajan kodu (KOR-1), adı, birimi, yetki seviyesi | Yetki seviyesinin Paperclip'te karşılığı yok |
| Ajanlar arası raporlama | Karşılığı yok | Her ajanın bir insan sorumlusu (`owner`) var; işi KOR-1 dağıtır |
| Issue | `tasks` | Tek atanan (insan ya da ajan), birim, öncelik, son tarih, üst görev. Görev numarası yok (13.4) |
| Yorum | `task_comments` | Yazarı insan ya da ajan; yorum değiştirilemez ve silinemez |
| Heartbeat run | `runs` ve `tool_calls` | Model, kart sürümü, token, maliyet, süre, özet; araç çağrıları sırasıyla, girdi ve sonuçlarıyla |
| Interaction: soru | "İnsana sor" yolu, `awaiting_reply` | Onay Masası'na düşmez (2 Ekim, karar 1). Yanıt taslağındaki öneri: soru, görev yorumu olarak yazılır; yanıt yorumu gelince ajan yeniden başlar. Yanıtın nasıl bekleneceği karar bekliyor (X1-6) |
| Interaction: araç eylemi onayı | `approvals` | Araç adı, saklanan çağrı (`payload`), özet, risk notu, fark, kaynaklar, seçenekler |
| Interaction: görev önerisi | `suggest_task` | Önerinin nerede saklanacağı karar bekliyor (N40) |
| Approval (işe alma, strateji) | Karşılığı yok | Alınmaz |
| Inbox | Bugün ekranı ve bildirim listesi | PLAN'da ayrı bir gelen kutusu ekranı yok |
| Dashboard | Bugün; sayılar için Ölçümler (modül M13, Sprint 4) | |
| Routine | Kartlardaki zamanlanmış tetikleyiciler ve kodla çalışan sistem işleri | Panel, kartları salt okunur gösterir |
| Budget policy ve incident | `company_agents.monthly_budget` | Aşımda ne olacağı karar bekliyor (X1-4) |
| Skill | `skills/<name>/SKILL.md` | Salt okunur gösterim; depoda henüz skill yok |
| Connector, tool ve araç kuralı | `agents/tools.yaml`: araç sınıfı ve `approval_rule` | Eylemin durumu arayüzden seçilmez, koddan türer |
| Activity log, Audit | `audit_log` ve İz kaydı ekranı | Yalnızca olay adı ve kimlikler; serbest metin yok |
| Göreve bağlı belgeler | `notes`, `documents`, üretilen dosyalar | Notlarda sürüm geçmişi zaten var (`note_versions`) |
| Org chart | Ajanlar ekranı (birimlere göre) ve Ofis görünümü (modül M15) | |
| Goal, eklenti, çalışma alanı, ortam | Karşılığı yok | Alınmaz |

### 11.3 Durum eşlemesi

Görev durumları, PLAN'daki arayüz adlarıyla:

| Agent Office | Paperclip'teki en yakın durum | Önerilen simge |
|---|---|---|
| Açık (`open`) | `todo` | boş daire |
| Sürüyor (`in_progress`) | `in_progress` | dönen açık daire |
| Onay bekliyor (`awaiting_approval`) | `in_review` ve bekleyen onay kartı | içi noktalı daire |
| Yanıt bekliyor (`awaiting_reply`) | bekleyen soru kartı; durum olarak `blocked` ile kısmen örtüşür | soru işaretli daire |
| Tamamlandı (`done`) | `done` | onay işaretli daire |
| İptal (`cancelled`) | `cancelled` | yasak işareti |

Paperclip'in `backlog` durumunun Agent Office'te karşılığı yok. Bu belge yeni durum önermiyor. Simge sütunu öneridir; amaç Paperclip'teki "her durumun kendi şekli" kuralını korumaktır. Renkler görsel yön kararına bağlıdır (14.2).

Çalışma durumları da (`running`, `completed`, `failed`, `limit_reached`, `stopped`) aynı durum diliyle gösterilmelidir. `failed` ve `limit_reached` insanın ilgilenmesi gereken durumlardır ve Bugün ekranına düşer (14.5).

Onay durumları:

| Agent Office | Paperclip |
|---|---|
| Bekliyor (`pending`) | `pending` |
| Düzeltme istendi (`changes_requested`) | `revision_requested` |
| Onaylandı (`approved`) | `approved` |
| Reddedildi (`rejected`) | `rejected` |
| Karşılığı yok | `cancelled` |

## 12. Çatışmalar

### 12.1 Kurallar ve kararlar

Paperclip'in aşağıdaki tarafları alınmaz ya da değiştirilerek alınır. İlk altı satır `CLAUDE.md` içindeki numaralı değişmez kurallardır; kalanlar tasarım raporunun ilkeleri, kurucu kararları ve `CLAUDE.md` içindeki diğer kurallardır.

| Agent Office kuralı | Paperclip'teki durum | Sonuç |
|---|---|---|
| Kural 2 ve 9: `company_id`, RLS, kısıtlı rol | RLS yok; yalıtım uygulama kodunda | Paperclip'in sunucu ve veri katmanı alınmaz |
| Kural 3: Google ile davetli giriş, iki adımlı doğrulama, passkey | E-posta ve parola | Giriş katmanı alınmaz |
| Kural 4: "Dışa etkili her ajan eylemi Onay Masası'na düşer. Onayı atlayan bir kod yolu yazılmaz." | "Her zaman izin ver" güven kuralı; bağlanan uygulama varsayılan olarak bütün ajanlara açık; kodlama ajanları izin sorularını atlar | Araç kuralı seçicisi yalnızca salt okunur gösterim olarak alınır; "her zaman izin ver" alınmaz |
| Kural 5 ve PLAN: her ajan çalışması `runs` ve `audit_log` tablolarına yazılır; `audit_log` değiştirilemeyen olay kaydıdır | Şirket ya da ajan silinince iz kayıtları da silinir | Silme yolu alınmaz |
| Kural 11: para transferi, imza ve taahhüt, resmî kurumlara başvuru ve beyan, kişisel verinin silinmesi ya da üçüncü kişiye aktarılması ajana bırakılmaz | Karşılığı yok | Agent Office'in kod kapısı aynen kalır |
| Kural 12: sözleşmesi yapay zekâ kullanımına izin vermeyen müşteri | Karşılığı yok | Agent Office'in denetimi aynen kalır |
| Y1 kapısı ve "İnsana sor" yolu | Soru ve onay kartlarını varsayılan olarak ajanlar da yanıtlayabilir (bağlantı isteği, araç eylemi onayı ve gizli anahtar önerisi kartları hariç); bir ajan, kullanıcının sohbet yanıtını onay olarak kaydedebilir | Kartı yalnızca muhatabı olan insan yanıtlar |
| Koordinasyon katmanı "ofisin tek giriş noktası"dır (tasarım raporu). KALAN-ISLER 0.4 atamayı "insana ya da ajana" diye planlıyor; 2 Ekim karar 8'e göre dış kaynaklı görevi ajana yalnızca insan atayabilir. Talep formunda birimin ya da ajanın doğrudan seçilip seçilemeyeceği (X2-4) ve hangi rolün hangi ajana iş verebileceği (M29) karar bekliyor | Yeni görev penceresinde atanan seçilir; ajan sayfasında "Görev ata" düğmesi vardır | Atanan seçicisi alınabilir; kimin hangi ajanı seçebileceği bu iki karara göre sınırlanır. KALAN-ISLER 0.4'teki talep formu kalır |
| Ret ve düzeltmede sabit listeden bir neden seçmek zorunludur (2 Ekim, karar 10; veritabanı kısıtı). KALAN-ISLER 0.5 "gerekçe zorunluluğu" diyor (M25); serbest metin gerekçe veritabanında zorunlu değil ve yanıt taslağı onu isteğe bağlı sayıyor | Gerekçe isteğe bağlı bir not | Satır içinden yalnızca onay tek dokunuşla verilir; ret ve düzeltme, gerekçe penceresi açar |
| Para ya da fiyat içeren, dışarı giden ve tek doğru kaynak notunu değiştiren onaylar passkey ister (3 Ekim, karar 7). Onaydan sonra elle dışarı gönderilen işlerin onayı da buna dâhildir; onayı açan ajan, işin dışarı gidip gitmeyeceğini belirtir (5 Ekim, karar 2) | Yeniden doğrulama yok | Onay kartına passkey adımı eklenir |
| Ajanın taslak notu ve dayanağı o taslak olan onay kaydı, onaylanana kadar yalnızca kurucuya ve onay yetkisi verilen çalışanlara görünür (3 Ekim, karar 1) | Görevi açabilen herkes akışın tamamını görür | Görev ayrıntısındaki akış bu görünürlük kuralına göre filtrelenir |
| "Kartların ve skill'lerin asıl kaynağı depodaki dosyalardır." | Ajan, skill ve rutin arayüzden düzenlenir | Bu ekranların yalnızca salt okunur hâli alınır |
| `project_id` doluysa satırı yalnızca proje üyeleri ve kurucu görür | Proje üyeliği yalnızca menü tercihidir | Liste düzeni alınır, "katıl ve ayrıl" alınmaz |
| Ajanlar normal geliştirme için kod yazmaz (önceki konuşmalardan kalan kurucu kararı; test araçları, acil hata düzeltme gibi küçük işler hariç) | Ürün, kodlama ajanları üzerine kurulu: çalışma alanları, PR akışı, ön izleme servisleri | Bu özellikler alınmaz |
| Çalışma sınırı karttan okunur; varsayılan 20 araç çağrısı ve 10 dakika (A-TEK-2 kartında 25 çağrı ve 15 dakika). Sınır aşılırsa iş insana düşer | Arayüzdeki formda 1.000 tur, ajan başına 20 eş zamanlı çalışma, yerelde süre sınırı yok | Agent Office'in sınır mantığı kalır |

### 12.2 Tasarım dili

2 Ekim'de kurucu, pilottaki arayüzün geçici olduğunu ve ileride baştan ele alınacağını söyledi; beş seçimi Claude'a bıraktı: vurgu rengi, form kenarlığı, karanlık tema, "Ofis" sekmesi, uygulama simgesi. Yazı tipi, kaçınılacaklar listesi, hareket ve kontrast kuralları bu seçimlerin dışındadır ve `CLAUDE.md`'ye göre arayüz baştan ele alınana kadar geçerlidir. Paperclip'in görünümü aynen alınırsa bu kurallar değişir; hangisinin kalacağı kurucunun kararıdır (14.2; telefon alt menüsü satırı 14.4'e bağlıdır).

| `CLAUDE.md` kuralı | Paperclip'teki uygulama |
|---|---|
| Kaçınılacaklar: "büyük harfli üst etiketler". Kural: "başlıklar cümle düzeninde" | Kenar çubuğu grup etiketleri, tek öğeli sayfa başlığı, liste grup başlıkları ve özellik paneli bölüm başlıkları büyük harfli ve aralıklı |
| "Yazı: IBM Plex Sans, tek aile." | Inter; makine değerleri için ayrı bir eş aralıklı aile |
| Vurgu `#127A77`, zemin `#F6F7F9`, yüzey beyaz. Mevcut arayüzde sayfa zemini gri, kartlar beyaz | Gri tonlar; birincil düğme açık temada siyaha, karanlık temada beyaza yakın; vurgu rengi yok. İçerik beyaz, kenar çubuğu gri |
| Hata `#C2412D` ve "Onay bekliyor" `#9A6412` değişkenleri tanımlı | Durum renkleri mavi, sarı, mor, yeşil, kırmızı; bir kısmı Tailwind'in hazır sınıflarıyla yazılmış |
| "renk kontrastı en az WCAG AA" | Görev ve ajan durum rozetlerinde yazı, temel rengin koyulaştırılmış tonuyla yazılır; dolgu aynı rengin açık tonudur. Açık temada gri, sarı ve yeşil rozetlerde yazı ile dolgu arasındaki oran 2,8 ile 3,0 arasında kalıyor; AA küçük metin için 4,5 ister. Mavi, mor ve kırmızı rozetlerde oran 5'in üstünde. Karanlık temada tersi geçerli: gri, sarı ve yeşil 6'nın üstünde, mavi, mor ve kırmızı 3,8 ile 4,1 arasında. Tek başına duran simgelerde gri, sarı ve yeşil ayrıca koyulaştırılmış; altı rengin hepsi beyaz zeminde arayüz öğesi için istenen 3 oranının üstünde (en düşüğü 3,3). Agent Office'in vurgu, hata ve "Onay bekliyor" renkleri kendi zemininde 4,5'in üstünde |
| Kaçınılacaklar: "ortadan noktalı meta dizgileri" | "38s · 3 tools · 12.3k tokens" gibi satırlar yaygın |
| Arayüz metinlerinde uzun tire kullanılmaz | Etkinlik satırlarında ve yazma kutusunun yer tutucu metninde var |
| "Ayrım gölgeyle değil ince çizgi ve boşlukla yapılır"; kaçınılacaklar: "cam efekti" | Menülerde büyük gölge, yazma kutusunda gölge, bildirimde ve telefon üst çubuğunda bulanıklık |
| Kaçınılacaklar: "aynı gölgeli özdeş kart ızgaraları" | Genel bakış ekranında dört özdeş sayı kutusu (kenarlıksız ve gölgesiz) ve ajan kutuları (ince kenarlıklı, gölgesiz) |
| "Hareket yalnızca kullanıcının yaptığı işin sonucunu gösterir" | Yanıp sönen canlı nokta, dönen "sürüyor" simgesi, Genel bakış ekranında yeni satır animasyonu, hareketli ajan karakter çizimi |
| Kaçınılacaklar: "süs ikonları ve emojiler" | Her menü satırında simge, boş ekranda büyük soluk simge; sunucuda üretilen şema görselinde emoji kökenli rol simgeleri |
| Kaçınılacaklar: "mor ve mavi geçişli arka planlar" | Bütçe olayı kartında renk geçişli zemin; ajan karakter çizimlerinde renk geçişleri |
| Kaçınılacaklar: "düğme metinlerine eklenen oklar" | Bazı bağlantı ve düğmelerde ok var |
| Telefon alt menüsü: Bugün, Onaylar, Görevler, Notlar, Ofis | Ana sayfa, Görevler, Yeni görev, Ajanlar, Gelen kutusu |
| Ofis görünümü "arayüzün tek cesur öğesidir" | Ajan sayfasında ve kurulumda hareketli karakter çizimleri |

Zaten uyuşanlar: gölgesiz ve çizgiyle ayrılan kartlar, küçük ve türe göre tutarlı köşeler, görünür klavye odağı, azaltılmış hareket desteği, eşit genişlikte rakamlar, yaptığı işi söyleyen düğmeler, ilk adımı gösteren boş ekranlar. Menü simgeleri mevcut arayüzde de var: telefon alt menüsünde her satırın simgesi bulunuyor, geniş ekrandaki üst çubukta yalnızca yazı.

İki ayrı not:

- **Canlı göstergeler.** Yanıp sönen nokta ve dönen simge hareket kuralıyla çatışıyor. Öte yandan bir ajan izleme panelinde "şu an çalışıyor" bilgisini taşıyan şey tam da budur. Karar gerekli: ya kurala canlı gösterge için istisna yazılır ya da gösterge hareketsiz tutulur (14.7).
- **Büyük harf ve Türkçe.** Büyük harfli etiket tercih edilirse sayfanın dili Türkçe olarak işaretlenmelidir. Aksi hâlde tarayıcı "i" harfini "I" yapar: "inceleme" sözcüğü "İNCELEME" yerine "INCELEME" olur.

### 12.3 Plan ve kapsam

- **Ekran listesi.** PLAN'daki ekranlar: Giriş, Bugün, Onay Masası, Görevler (pano ve liste), Görev ayrıntısı, Ajanlar, Görev kartı, Notlar, Müşteriler, İz kaydı, Ayarlar, Ölçümler, Not grafiği, Ofis görünümü. Paperclip'in Gelen kutusu, Projeler, Skill'ler ve Bağlayıcılar ekranlarının PLAN'da ayrı karşılığı yok. Bu belgede yeni ekran önerilmiyor; Paperclip'in kalıpları PLAN'daki ekranlara uygulanıyor (13.2, 13.3).
- **Sıra.** `CLAUDE.md`'ye göre işler `docs/KALAN-ISLER.md` sırasıyla yapılır ve PLAN sırasının dışına çıkılmaz. KALAN-ISLER'de arayüz temeli (0.1) tamamlandı. Veri modelinde (0.2) iki madde bekliyor. Girişte (0.3) kod yazıldı ve Google tarafındaki kurulum 5 Ekim'de tamamlandı; `amr` alanının gerçek hesaplarla denenmesi, holding görünümü, onaylarda passkey adımı ve Şirketler ayarı bekliyor. Sıradaki işler görev kaydı ve pano (0.4), Onay Masası (0.5), Claude bağlantısı (0.6) ve ortamlardır (0.7); bunlara başlanmadı. Kurucunun işleri (0.8) ve kapı (0.9) da duruyor. Kabuk değişimine ve kalıplara, karar yazılıp PLAN ve KALAN-ISLER güncellenmeden başlanamaz (13.6).
- **Tarih.** PLAN'a göre Sprint 0, 30 Eylül ile 3 Ekim arasındadır ve pilot 10 Ekim'de sekiz ajanla açılır. 5 Ekim itibarıyla çalıştırıcı ve ajan işlerine (Sprint 1 ve 2) başlanmadı, test ve canlı ortam kurulmadı.
- **2 Ekim kararı.** Karar 5: "Pilottaki arayüz geçicidir; ileride baştan ele alınacak." Kurucunun sözü: "UI/UX şuanlık projede geçici olarak yinede sen en iyi şekilde yap ilerleyen süreçte UI için baştan sonra el atacağız." Bu belgedeki öneri, o baştan ele alma işinin içeriği olmaya adaydır. Ekranların çoğu henüz yapılmadığı için "baştan ele almak" yerine "ilk seferde böyle yapmak" da seçilebilir (14.3).
- **Telefon.** Depodaki bütün belgeler telefon uyumunu şart koşuyor. Tasarım raporu "telefon dahil her cihazdan" onay verilmesini, onay yükünün tek kişide toplanmasına karşı önlem sayıyor. PLAN "Telefona uyumlu web uygulaması (PWA); onaylar telefondan verilir" diyor ve "Onay telefondan tek dokunuşla veriliyor" maddesi pilot açılış kontrollerinden biridir. KALAN-ISLER'de telefon alt menüsü ve PWA manifesti yapılmış; telefondaki pano ve liste ile tek dokunuşla onay ise sıradaki işler arasında. Önceki konuşmalardan kalan proje notu tersini söylüyor ve bunu kurucu kararı olarak kaydediyor: "web panelde mobil uyumlu tasarım yapılmayacak, şimdilik yalnızca web". Nota göre "her cihazdan erişim" kararı değişti; çok ileride yalnızca kurum çalışanlarının indirebileceği bir mobil uygulama yapılacak ve telefondan web adresine girenler uygulamaya yönlendirilecek. Bu karar depoya işlenmemiş: "mobil" sözcüğü dört karar dosyasının hiçbirinde geçmiyor. Hangisinin geçerli sayılacağına ben karar vermedim; soru 14.4'te kurucuya bırakıldı. Not geçerliyse karar dosyasına yazılmalı ve PLAN, `CLAUDE.md`, KALAN-ISLER ile açılış kontrolü güncellenmelidir.
- **Koordinatör.** Paperclip'te insan, görevi doğrudan bir ajana atar. Tasarım raporuna göre Agent Office'te talep KOR-1'den geçer; "kullanım oranı" ve "ilk seferde doğru birim" ölçütleri de koordinatörün kayıtlarından çıkar. Öte yandan KALAN-ISLER 0.4 atamayı "insana ya da ajana" diye planlıyor ve 2 Ekim karar 8, insanın bir görevi ajana atayabildiğini varsayıyor. Panelde açılan işin her zaman KOR-1'den geçip geçmeyeceği SONRA'da karar bekliyor (X2-4); yanıt taslağı varsayılanın KOR-1 olmasını, talep formunda "birimi kendim seçeyim" seçeneğinin bulunmasını öneriyor. Hangi rolün hangi ajana iş verebileceği de karar bekliyor (M29).

## 13. Uyarlama önerisi

### 13.1 Yaklaşım

Üç yol var:

| Yol | Anlamı | Değerlendirme |
|---|---|---|
| A. Paperclip'e geçmek | Agent Office bırakılır, Paperclip kurulup kullanılır | Önerilmez |
| B. Paperclip'i çatallamak | Paperclip kopyalanır, üzerine Agent Office kuralları eklenir | Önerilmez |
| C. Arayüz yapısını ve kalıpları almak | Agent Office'in mimarisi, kuralları ve PLAN'daki ekran listesi kalır; ekranlar Paperclip'in yapısıyla kurulur; MIT lisanslı bağımsız parçalar taşınır | Önerilir |

A ve B'nin önerilmeme nedenleri aynıdır:

- Şirket yalıtımı veritabanında değil. RLS'yi 226 tablo ve yaklaşık 890 uç nokta için sonradan kurmak, Agent Office'i baştan yazmaktan daha büyük bir iştir.
- Giriş e-posta ve parolayla. Google ile giriş, iki adımlı doğrulama ve passkey yok; Agent Office'te bunların kodu yazıldı.
- Paperclip'in kendi model döngüsü yok. Agent Office'in çalıştırıcısı (Claude API, araç kataloğu, yetki seviyeleri, onay kapısı) Paperclip'te karşılığı olmayan parçadır.
- Ürün, kodlama ajanları üzerine kurulu. Önceki konuşmalardan kalan karara göre Agent Office'in ajanları normal geliştirme için kod yazmayacak.
- Varsayılanlar özerklikten yana; 2026 içinde dört sürümde bu yönde değişti (9.3). Aynı dönemde kısıtlayan değişiklikler de oldu.
- Haftalık sürüm temposu, çatalın birkaç haftada asıl depodan kopması demektir. Ondan sonra 2,3 milyon satırlık bir kodun bakımı Agent Office'e kalır.

C yolunda Agent Office'in kurallarla tanımlanan tarafı (yalıtım, onay kapısı, yetki seviyeleri, iz kaydı) yerinde kalır; kullanıcının gördüğü taraf Paperclip'e benzer.

C yolunu kolaylaştıran iki şey var. Birincisi, benzetilecek ekranların çoğu henüz yapılmadı: Bugün, Onaylar, Görevler, Notlar ve Ajanlar boş ekran olarak duruyor; KALAN-ISLER'de sıradaki iki iş Görevler (0.4) ve Onay Masası'dır (0.5). İkincisi, iki proje aynı kütüphaneleri kullanıyor; Paperclip'in bileşenleri yeniden yazılmadan, uyarlanarak taşınabilir (13.5).

C yolunun içinde iki seçim daha var. Bağımsız parçaların kodu taşınır mı, yoksa hepsi yeniden mi yazılır? Yeni kabuk mu kurulur, yoksa kalıplar mevcut kabuğa mı uygulanır? Bunlar 14.1'de ayrı seçenekler olarak yazıldı.

### 13.2 Hedef yerleşim

Aşağıdaki tablo, Paperclip'in iskeleti PLAN'daki ekran listesine uygulandığında ortaya çıkan yerleşimi gösterir. Yeni ekran eklenmez.

| Bölge | İçerik |
|---|---|
| Şirket menüsü | Arma DX, Pillika; kurucu için ayrıca Kurucu alanı ve holding görünümü. Şu an üst çubukta duran şirket seçicisi kenar çubuğunun başına taşınır |
| Üst satırlar | Yeni talep, Ara, Bugün (rozetli), Onaylar (rozetli) |
| İş grubu | Görevler, Notlar, Müşteriler |
| Ofis grubu | Ajanlar (Ofis görünümü Kasım 2026'da eklenir), İz kaydı, Ölçümler |
| Son görevler | Kullanıcının son açtığı görevler |
| Hesap menüsü | Ayarlar (Kullanıcılar, Güvenlik, Şirketler, Entegrasyonlar), tema, çıkış |
| Telefon | Alt menü olduğu gibi kalır: Bugün, Onaylar, Görevler, Notlar, Ofis. Kenar çubuğu çekmeceye dönüşür. Bu satır 14.4'teki karara bağlıdır |

Açıklamalar:

- Bugün ekranı, Paperclip'in Genel bakış ve Gelen kutusu ekranlarının işini birlikte görür. PLAN'a göre bekleyen onayları, bugünkü görevleri, ajanların son işlerini ve uyarıları gösterir; ilk sekmesi "bana düşenler" listesi olabilir (14.5). Onaylar, Onay Masası'dır.
- Görev kartı ekranı Ajanlar'ın, Not grafiği Notlar'ın altında açılır. Projelerin yeri SONRA'da karar bekliyor (M48); yanıt taslağı ve KALAN-ISLER 2.1, Müşteriler altında bir Projeler sekmesi öngörüyor.
- Menü sırası mevcut menüden gelir (Bugün, Onaylar, Görevler, Notlar, Ofis); Müşteriler, İz kaydı ve Ölçümler kendi sprintlerinde eklenir.
- Menüdeki "Ara" satırı komut paletini açar; komut paleti ekler arasındadır (14.6). Alınmazsa bu satır menüye konmaz.
- Adres yapısı değişmez: sayfa adresleri şu an da şirket koduyla başlıyor (`/c/<şirket kodu>/...`), Paperclip'teki gibi.
- Özellik paneli; Görev ayrıntısı, not ve Görev kartı sayfalarında kullanılır.
- Görev kartı, skill ve araç kataloğu salt okunurdur; değişiklik depoda PR ile yapılır. Ajan durdurma düğmesi ise arayüzden kullanılır; "her yerde durdur" düğmesi ajan sayfasının başlığında durabilir. Şirkete özel ajan ayarlarının hangi ekrandan değiştirileceği SONRA'da karar bekliyor (N26).
- Holding görünümünün ne göstereceği SONRA'da karar bekliyor (N15). Önerim: holding görünümü iki şirketin bekleyen onaylarını salt okunur listeler ve kullanıcıyı ilgili şirkete yönlendirir. Şirket menüsündeki satırlar, o şirkette bekleyen iş varsa bunu bir noktayla gösterebilir. Bu nokta başka şirketin verisinden hesaplandığı için yalnızca kurucuya ve holding birleştirmesi üzerinden gösterilmelidir; iki şirketin verisi yalnızca holding görünümünde yan yana gelir.
- Komut paleti ve kısayollar PLAN'da yok; yeni özelliklerdir (14.6).

Bu yerleşimin üç görsel yöndeki hâli görsel yön taslağında çizildi (15.1).

### 13.3 Kalıpların işlere dağılımı

Paperclip'ten alınacak şeyler ayrı iş kalemleri olarak değil, KALAN-ISLER'deki işlerin içinde yapılır. KALAN-ISLER'e kesin olarak eklenen tek yeni madde kabuk değişimidir; seçenekli soru kaydı X1-6 kararına bağlıdır. Diğer işlere yeni madde eklenmez, ama işin hacmi büyür: aynı ekran daha zengin bir biçimde kurulur.

| KALAN-ISLER işi | Paperclip'ten alınacak | Yeni madde |
|---|---|---|
| 0.1 Arayüz temeli (yapıldı) | Kabuk: kenar çubuğu, üst çubuk ve konum bilgisi, özellik paneli. Tek durum dili: her durum için bir simge ve bir renk. Yoğun liste satırı | Var: kabuk işi. Yerleşim dosyası ve testi yeniden yazılır; kabuğun içindeki ekranlar (Kullanıcılar, Güvenlik ve beş boş ekran) yeni kabuğa alınır. 0.3'teki "Üst çubukta şirket seçici" maddesi de buna göre değişir |
| 0.4 Görev kaydı ve pano | Liste: durum simgesi, gruplama, satır içinde durum ve atanan değiştirme (izin verilen geçişler M16'ya, seçilebilecek ajanlar M29'a bağlıdır), sabit genişlikte zaman sütunu, saklanan görünüm. Numara sütunu görev numarası kararına bağlıdır. Pano görünümü. Talep formunda yarım kalan metnin saklanması | Yok; aynı iş bu biçimde yapılır |
| 0.4 ve 1.6 Görev ayrıntısı | Sohbet biçimli akış: talep, yorumlar, çalışma özeti ve açılan adımlar, yazma kutusu. Özellik paneli: durum, atanan, birim, çalışma bilgisi, maliyet, "İşi devral" | Yok; 0.4'teki temel hâl, akış olarak kurulur, çalışma özeti ve adımlar 1.6'da eklenir |
| 0.5 Onay Masası | Gelen kutusu kalıbı: tek liste, sabit sıra, satır içinde karar. Onay kartı: özet, risk işaretleri, fark, kaynaklar, seçenekler. Aynı kartın Görev ayrıntısında yazma kutusunun üstünde durması. Karardan sonraki adım önerisi | Yok; aynı iş bu biçimde yapılır |
| 1.1 Ajan çalıştırıcı | "İnsana sor" için soru kartı. Çalışma özeti satırı. Ajanı durdurma, çalışmayı kesme ve görevi iptal etme ayrımı | Karara bağlı: seçenekli soru kaydı (X1-6; 13.4) |
| 1.2 Görev kartı yönetimi | Birimlere göre ajan listesi, ajan sayfasında ikinci kenar çubuğu, salt okunur kart. "Bu ajan neye erişebiliyor ve neden" görünümü, 1.8'deki izin görünümünün karşılığıdır | Yok |
| 1.3 Not sistemi | Markdown gösterimi (`[[Not adı]]` desteğiyle), özellik paneli | Yok |
| 1.8 Denetim ve yetki takibi | Ajan bazında maliyet ve bütçe görünümü; uyarı ile durdurma ayrı gösterilir | Yok |
| 1.9 ve 2.6 Bildirimler | Seyrek bildirim kuralı; bildirimlerin Bugün ekranındaki listede yer alması | Yok |
| 2.7 Bugün ve İz kaydı | Bugün: "bana düşenler" listesi, ajan kutuları, son işler. İz kaydı: cümle biçiminde satır, filtrelerin adres çubuğunda durması | Yok |
| Sprint 4, Ölçümler (modül M13) | Dört sayı ve küçük grafikler | Yok |

Bu işlerin içine girmeyen, ayrı karar isteyen ekler (14.6):

| Ek | Not |
|---|---|
| Görev numarası (ADX-12 gibi) | Veri modeline ek (13.4) |
| Görev ve onaylarda okunmamış işareti | Veri modeline ek (13.4) |
| Komut paleti ve kısayollar | Yalnızca arayüz; kısayol tuşları Türkçe klavyeye göre seçilir (13.5) |
| Anlık canlı güncelleme | Çekirdekte listeler belirli aralıklarla yenilenir; anlık güncelleme sonraya kalır (13.4) |

Sonraya bırakılabilecekler; istenirse `docs/SONRA.md` dosyasına yazılır:

| Özellik | Not |
|---|---|
| Organizasyon şeması | Şirket, birim, ajan sırasıyla; Ofis görünümünü (modül M15) tamamlar |
| Zamanlanmış çalışmaların salt okunur sayfası | Zamanlamanın düz yazıyla anlatımı, sonraki tetiklenmeler, geçmiş |
| Pasaj üzerine yorum; üretilen dosyalarda sürüm | "Düzeltme iste" turlarında işe yarar. Notlarda sürüm geçmişi zaten var |
| Çalışma modları: önce plan, yalnızca yanıt | Gereksiz API harcamasını azaltır; çalıştırıcıda değişiklik gerektirir |
| Rutin kuralları: çakışma, kaçırılanlar, değişiklik yoksa atla | Kart şemasında değişiklik gerektirir; zamanlanmış tetikleyici kuralları SONRA'da karar bekliyor (M28) |
| Çıktılar galerisi | |
| Tek kutulu arama ve arama kutusuna yazılan filtreler | |
| Çıktılar için "yararlı, düzeltilmeli" oyu | Oylar yalnızca Agent Office'in veritabanında saklanır; dışarıyla paylaşılmaz |

### 13.4 Veri modeli

Göç dosyalarına göre ekranların gerektirdiği verinin çoğu zaten var ya da planlandı:

| Gereken | Agent Office'teki durumu |
|---|---|
| Görev yorumları | `task_comments` tablosu var (yazarı insan ya da ajan); uç noktaları KALAN-ISLER 0.4'te yazılacak |
| Çalışma özeti ve adımlar | `runs` (özet, token, maliyet, süre, durum) ve `tool_calls` (sıra, araç, durum, girdi, sonuç) tabloları var. Ham içerik 90 gün saklanır (2 Ekim, karar 13) |
| Onayda saklanan çağrı | `approvals.payload` ve `tool_name` alanları var. Onaylanan çağrının onaydan sonra çalıştırılması KALAN-ISLER 0.5'te planlandı; nasıl işleyeceği karar bekliyor (M5) |
| Onay kartının içeriği | `approvals`: başlık, özet, risk notu, fark, kaynaklar, seçenekler, öncelik, ajanın gerekçesi. Özeti ve risk notunu KOR-3 yazar; kodla hesaplanan risk işaretleri KALAN-ISLER 0.5'te planlandı (M21) |
| Düzeltme döngüsü | Karara bağlandı: iş aynı ajana döner, yeni onay öncekine bağlanır, ikinci düzeltmeden sonra iş insana düşer (2 Ekim, karar 10) |
| Bildirimler ve okundu bilgisi | `notifications` tablosu, `read_at` alanıyla |
| İz kaydı | `audit_log`: olay adı ve kimlikler; değiştirilemez |
| Bütçe | `company_agents.monthly_budget`; aşımda ne olacağı karar bekliyor (X1-4) |
| Çalışmayı kesme | KALAN-ISLER 1.1'de planlandı: "Durdurma düğmesi: yeni iş almama ve süren çalışmanın kesilmesi". Süren çalışmanın ne zaman kesileceği karar bekliyor (X1-5) |
| Görev önerisi | `suggest_task` aracı var; önerinin nerede saklanacağı karar bekliyor (N40) |

Veri modelinde bulunmayan, Paperclip'e benzemek için gereken ekler:

| Ek | Neden | Paperclip'teki karşılığı |
|---|---|---|
| Görev numarası: şirket ön eki ve sayaç | Listede, aramada, bağlantıda ve konuşurken kullanılan kolay okunur ad | `companies.issue_prefix`, `issue_counter`, `issues.identifier` |
| Görev ve onaylar için kullanıcıya özel okundu bilgisi | Bugün ve Onaylar listelerinde okunmamış işareti | `issue_read_states` |
| Seçenekli soru: soru metni, seçenekler, muhatap, yanıt | Soru kartı; "İnsana sor" yolunun veri karşılığı | `issue_thread_interactions` |
| Belirli aralıklarla yenileme; sonra canlı güncelleme | Listelerin ve Görev ayrıntısının kendiliğinden yenilenmesi | Şirket başına WebSocket |

Kurallara etkisi:

- **Yeni tablolar.** Her yeni tablo `company_id` taşır, RLS'si açılır ve tablo için şirket ayrımı testi yazılır (kural 2 ve 9). Göreve bağlı her yeni tablo proje kapsamını üst kayıttan devralır. Okundu bilgisi ayrıca kullanıcı bağlamıyla filtrelenir. Sözleşmesi yapay zekâ kullanımına izin vermeyen müşteriye bağlı görevlerde ajanı çalıştıran her yol kapalı kalır (kural 12).
- **Görev numarası.** Ön ek yalnızca ASCII büyük harf içermelidir. Denemede "Örnek Ofis" adından Paperclip "RNE" kodunu üretti, "Ö" harfini attı; Agent Office'te ön ek elle verilmelidir (bu belgede ve görsel yön taslağında örnek olarak ADX kullanıldı). Sayacın nerede duracağı ayrıca tasarlanmalı: `companies` bir kimlik tablosudur ve kısıtlı rolün ona yazıp yazamadığına bakmadım (kural 9). Şirket başına tek sayaç kullanılırsa, proje üyesi olmayan biri numaralardaki boşluklardan gizli bir projede görev açıldığını anlayabilir; bunun kabul edilebilir olup olmadığı 14.7'de kurucuya soruldu.
- **Soru ve onay ayrımı.** PLAN'a göre ajanın soruları ve eskalasyonları "İnsana sor" yoluyla ajanın sorumlusuna ya da talep sahibine gider ve onaya düşmez (2 Ekim, karar 1). "Yanıt bekliyor" durumu 2 Ekim'de eklendi; görevin yanıtı nasıl bekleyeceği ve yanıt gelince ajanın nasıl devam edeceği karar bekliyor (X1-6). Yanıt taslağındaki öneri: soru, görev yorumu olarak yazılır; yanıt yorumu gelince çalıştırıcı aynı ajanı yeniden başlatır. Paperclip'in soru kartı buna iki şey ekler: seçenekli soru ve sorunun yanıtlanana kadar yazma kutusunun üstünde durması. Önerim: yorumun yanında yapılandırılmış bir soru kaydı tutulur; soruyu yalnızca muhatabı olan insan yanıtlar; soru ve onay ayrı kayıtlar olarak kalır ve bir soruya verilen yanıt hiçbir zaman bir araç çağrısı için onay sayılmaz (kural 4). Bu karar, X1-6 ile birlikte verilmelidir.
- **Onay kararı.** Onay hangi ekrandan verilirse verilsin aynı uç noktadan geçer; yetki denetimi, passkey adımı ve dayanak denetimi orada yapılır. Kararı yalnızca onay yetkisi olan kişi verir; bunu veritabanı da denetler. Passkey isteyen onaylar 3 Ekim karar 7'de sayıldı: para ya da fiyat içeren, dışarı giden ve tek doğru kaynak notunu değiştiren onaylar. Pilotta dışarı çıkacak işler taslak olarak onaya gelip insan eliyle gönderiliyor; bu onaylar da passkey ister ve onayı açan ajan, işin dışarı gidip gitmeyeceğini belirtmek zorundadır (5 Ekim, karar 2). Para içeren onayı çalıştırıcı `involves_money` alanıyla işaretler. Onay dayandığı kaydın sürümünü tutar; kayıt değişmişse onay kapanır (2 Ekim, karar 10). Verilen karar değiştirilemez; bunu veritabanı da engelliyor. Önerim: onay, sunucu yanıt vermeden ekrana yansıtılmaz; bekleyen onay arşivlenemez ve ertelenemez. 7. bölümdeki altıncı kalıp bu yüzden onaylar için geçerli değildir.
- **Satır içinde karar.** PLAN "telefonda tek dokunuş" istiyor. Önerim: satır içinden yalnızca onay verilir; o da özet ile risk işaretleri satırda görünüyorsa. Ret ve düzeltmede, nedenin seçilmesi ve gerekçenin yazılması için küçük bir pencere açılır. Seçenekli çıktılarda satırdaki düğme, seçenekleri açar (M24). Tasarım raporu, ekibin ajan çıktısını denetlemeden kabul etmeye başlamasını risk olarak sayıyor. Yanıt taslağı da risk işaretlerinden biri varsa fark ekranının açık gelmesini öneriyor (M21); satır içi onay bu öneriyle birlikte kararlaştırılmalıdır (14.7).
- **Özet ve risk işaretleri.** Özeti ve risk notunu bir ajan (KOR-3) yazar; dış içerikteki bir talimat bu metni etkileyebilir (kural 7). Bu yüzden kodla hesaplanan risk işaretleri (dış alıcı, fiyat, tek doğru kaynak, dış kaynaklı içerik) ve farkın kendisi kartta ajanın metninden ayrı ve değiştirilemez biçimde gösterilmelidir. M21 bunu soruyor; yanıt taslağı kabul ediyor.
- **Saklanan çağrının çalıştırılması.** Onaydan sonra çağrıyı çalıştırıcı, istek anındaki şirket ve proje bağlamıyla ve ajanın kimliğiyle (`app.agent_code`) çalıştırır; `runs` ve `audit_log` kayıtlarını yazar (kural 5); kuyruk işine yalnızca kimlik konur (kural 10). Çağrı çalıştırılmadan önce ajan durdurma düğmesinin durumu ve müşterinin yapay zekâ izni yeniden denetlenir. Saklanan argümanlar ve araç sonuçları gizli anahtar içermemelidir (kural 6). Onay beklenirken çalışmanın açık mı kalacağı, süre sınırının nasıl sayılacağı ve çalışmanın nasıl devam edeceği yeni bir sorudur ve M5 ile birlikte kararlaştırılmalıdır: `runs.status` içinde bekleme durumu yok, `tool_calls.status` içinde `sent_for_approval` var.
- **Akıştaki ajan metni.** `CLAUDE.md`'ye göre Y1 ajanın `internal_write` sınıfındaki her çağrısı onaya düşer; göreve yorum ekleyen `update_task` de bu sınıftadır. "İnsana sor" yolu ise onaya düşmez. Bu yüzden Y1 ajanın akışta görünen metni `update_task` ile yazılmış bir yorum olmamalıdır: çalışma kaydının özeti (`runs.summary`), onay kaydındaki gerekçe ve "İnsana sor" yoluyla yazılan sorular gösterilir. Y2 ajanın yorumu araç kuralına göre onaya düşmez; Y2 kapıları ise karar bekliyor (M19).
- **Akışın görünürlüğü.** Çalışma kaydının görünürlüğü görevden gelir. Ajanın taslak notu ve dayanağı o taslak olan onay yalnızca kurucuya ve onay yetkisi verilen çalışanlara görünür (3 Ekim, karar 1); akış bu kurala göre filtrelenmelidir. Bir görevi ya da notu dış kişiye açmak passkey ister (5 Ekim, karar 4). Dış kişi, kendisiyle paylaşılan görevi ve yorumlarını görür ve kendi adına yorum yazabilir; çalışma ve araç çağrısı kayıtlarını veritabanı düzeyinde göremez. Yani dış kişi akışta yalnızca yorumları görür. Karar bekleyen nokta: bir ajanın, dış kişiyle paylaşılmış bir göreve yazdığı yorum dış kişiye görünür; bu yorumun onaya düşüp düşmeyeceği 14.7'de kurucuya soruldu.
- **Yorum ve çalışma.** Paperclip'te bir ajana atanmış, kapanmamış göreve yazılan insan mesajı o ajanı uyandırır. Agent Office'te her çalışma bir API harcamasıdır ve tetikleyici türleri bellidir: talep, zamanlama, olay, devir. Yanıt taslağına göre yanıt yorumu gelince çalıştırıcı aynı ajanı yeniden başlatır (X1-6). Buna eklediğim iki şart: yorum yalnızca görev "Yanıt bekliyor" durumundayken ve yazan muhatapsa ajanı başlatır; diğer yorumlar çalışma başlatmaz. Yazma kutusu, yazılan yorumun ajanı başlatıp başlatmayacağını belirtmelidir.
- **Dosya ekleri.** Talep formundaki ek KALAN-ISLER'de var (0.4). Yanıt taslağına göre talep ekleri dış içerik sayılır (SONRA'daki M13 maddesi). Yorumlara dosya ekleme bu önerinin kapsamında değildir.
- **Yenileme.** İlk adım belirli aralıklarla yoklamadır: tarayıcı veriyi her zamanki API isteğiyle, yani RLS'den geçerek çeker; kuralları ilgilendiren yeni bir yol açılmaz. Bu adım çekirdeğin parçasıdır (14.6). Arka plandaki yenileme istekleri oturumun 30 dakikalık hareketsizlik süresini uzatmamalıdır. Canlı güncelleme sonra eklenirse: API ve çalıştırıcı ayrı süreçler olduğu için süreçler arası bir yol gerekir (PostgreSQL LISTEN/NOTIFY gibi); olaya yalnızca kimlik konur; dağıtım şirket ve proje üyeliğine göre filtrelenir; uzun süren bağlantı, kural 9'daki "Her API isteği tek bir transaction'dır" düzeninin dışında kaldığı için ayrıca tasarlanır.
- **Tarayıcıda saklananlar.** Önerim: yarım kalan talep ve yorum metinleri kullanıcıya ve şirkete göre ayrı saklanır, kullanıcı oturumu kapattığında silinir. Oturum zaman aşımıyla kapandığında metnin saklanması kullanışlıdır, ama şirket verisinin kapanmış bir oturumdan sonra tarayıcıda kalması demektir. Aynı durum "Son görevler" listesi ve saklanan görünümler için de geçerlidir: görev başlıkları tarayıcıda kalır. Karar gerektirir (14.7).
- **Markdown gösterimi.** Paperclip'in bileşeni dış adreslerdeki resimleri varsayılan olarak yükler; resmi yüklemeyip yalnızca adresini yazan ikinci bir modu da vardır. Ajan çıktısındaki ya da dış içerikteki bir resim adresi, görüntüleyen kişinin tarayıcısının dışarıya istek göndermesine yol açar; bu, onaysız bir veri sızdırma yolu olabilir (kural 4 ve 7). Agent Office'te ajandan, araçtan ve dış kaynaktan gelen içerikte resimler yüklenmemeli, yalnızca bağlantı olarak gösterilmelidir.

### 13.5 Taşınacak kod

İki projenin arayüz kütüphaneleri aynı: React 19, Vite 8, Tailwind 4, shadcn/ui, tek paketli Radix (`radix-ui`), `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, TanStack Query. Agent Office ayrıca shadcn değişken adlarını kendi renk değişkenlerine bağlamış (`apps/web/src/index.css`: `--background`, `--card`, `--primary`, `--muted`, `--border`, `--input`, `--ring`). Paperclip'in bileşenleri bu adları kullandığı için temel renkleri kendiliğinden Agent Office'in değişkenlerinden alır; diğer tasarım değişkenleri ayrıca taşınır (aşağıdaki teknik farklar tablosu).

**Küçük düzeltmeyle taşınabilecekler**

Ölçtüğüm taşınabilir küme 73 dosya ve yaklaşık 10 bin satırdır. Bunun 26 dosyası (2.475 satır) shadcn temel bileşenleridir; 10'u Agent Office'te zaten var (pencere, düğme, rozet, açılır menü, giriş alanı gibi), eksik olan 16'sından gerekenler shadcn'den eklenir. Bildirim ve tema için Agent Office'in kendi çözümü var (`sonner`, `lib/theme.ts`); Paperclip'in bu iş için yazdığı dört dosya gerekmez. Paperclip'e özgü asıl parça, kalan 43 dosyadır (yaklaşık 7 bin satır):

| Parça | Kaynak (`ui/src/` altında) |
|---|---|
| Kenar çubuğu takımı | `components/SidebarShell.tsx`, `components/SidebarNavItem.tsx`, `components/SidebarSection.tsx`, `components/ContextualSidebarFrame.tsx`, `components/primary-sidebar-styles.ts`, `components/contextual-sidebar-styles.ts`, `context/SidebarContext.tsx` |
| Üst çubuk | `context/BreadcrumbContext.tsx`, `components/BreadcrumbBar.tsx` |
| Özellik paneli | `context/PanelContext.tsx`, `components/PropertiesPanel.tsx`, `components/side-panel/` (8 dosya) |
| Pencere altyapısı | `context/DialogContext.tsx` |
| Komut paleti iskeleti | `components/CommandPalette.tsx` yapısı |
| Sayfa parçaları | `components/` altında: `EmptyState`, `PageSkeleton`, `EntityRow`, `MetricCard`, `FilterBar`, `PageTabBar`, `CollectionToolbar`, `InlineBanner`, `QuotaBar`, `CopyText` |
| Durum sistemi | `lib/status-colors.ts`, `components/StatusBadge.tsx`, `components/StatusGlyph.tsx`, `components/StatusIcon.tsx`, `index.css` içindeki durum renkleri kuralı |
| Markdown gösterimi | `components/MarkdownBody.tsx`. `[[Not adı]]` bağlantılarını bir seçenekle destekliyor; Notlar ekranına da yarar. Küme dışındaki 17 modüle bağlı (13'ü Paperclip'e özgü) olduğu için bu listedeki en çok iş isteyen dosyadır |
| Kısayollar | `hooks/useKeyboardShortcuts.ts`, `lib/keyboardShortcuts.ts`, `components/KeyboardShortcutsCheatsheet.tsx` |
| Veri yardımcıları | `api/client.ts`, `lib/query-invalidation-batcher.ts`, `lib/polling.ts`, `lib/navigation-scroll.ts` |

Agent Office'te bunların küçük karşılıkları var (`components/states.tsx`, `components/list-row.tsx`, `lib/api.ts`); taşınan parça ya onların yerini alır ya da onlara eklenir. Buna dosya dosya karar verilir.

73 dosyalık küme Paperclip'in başka 32 modülünü de içe aktarıyor (yaklaşık 7 bin satır). Bu modüllerin 25'i yalnızca birer dosyada kullanılıyor; 20'si yalnızca iki bileşenin bağımlılığı: komut paleti ve markdown gösterimi. Bir kısmı taşınır, bir kısmı Agent Office'teki karşılığıyla değiştirilir (yönlendirici, şirket bağlamı, API istemcileri), bir kısmı silinir (eklenti yuvaları).

Bu parçaların kullandığı paketler:

| Paket | Lisans | Kullanıldığı yer | Agent Office'te |
|---|---|---|---|
| `lucide-react` | ISC | Simgeler | Var |
| `radix-ui` | MIT | Temel bileşenler | Var |
| `class-variance-authority` | Apache-2.0 | Düğme ve rozet çeşitleri | Var |
| `clsx`, `tailwind-merge` | MIT | Sınıf birleştirme | Var |
| `@tanstack/react-query` | MIT | Veri sorguları | Var |
| `cmdk` | MIT | Komut paleti | Yok |
| `react-markdown`, `remark-gfm` | MIT | Markdown gösterimi | Yok |
| `mermaid` | MIT | Markdown içindeki diyagramlar; gerektiğinde yüklenir | Yok; alınmayabilir |
| `@dnd-kit` | MIT | Sürükleyip bırakma; pano görünümü için de gerekir | Yok |
| `react-resizable-panels` | MIT | Boyutlandırılabilir bölmeler | Yok |
| `@base-ui/react` | MIT | Dosya eki bileşeni | Yok; gerekmez |

Renk tarafında üç fark kalıyor:

- **Yüzey dağılımı.** Agent Office'te sayfa zemini gri (`--canvas`), kartlar beyaz (`--surface`); Paperclip'te içerik beyaz, kenar çubuğu gri. Hangi alanın hangi rengi alacağı seçilmelidir (14.7).
- **Seçili satır.** Paperclip'in kenar çubuğu satırı seçili durumda `--sidebar-accent` değişkenini kullanır; Agent Office'te `--sidebar-*` değişkenleri tanımlı değil. Ayrıca `--muted`, `--accent` ve `--secondary` değişkenlerinin üçü de `--canvas` değerinde. Kenar çubuğu `--canvas` olursa seçili satırın ve üzerine gelinen satırın dolgusu görünmez; bunlar için ayrı bir ton tanımlanmalıdır.
- **Durum renkleri.** Agent Office'te yalnızca hata ve "Onay bekliyor" renkleri tanımlı; diğer durumlar için açık ve karanlık tema değerleriyle yeni değişkenler gerekir (14.2).

**Yeniden yazılacaklar**

Aşağıdaki ekranlar Paperclip'te toplam 60 ile 70 bin satır tutuyor. Agent Office'te çok daha küçük sürümleri yazılır; sayılar göreli büyüklük fikri vermek içindir.

| Ekran | Paperclip'teki boyut | Not |
|---|---|---|
| Görev sayfası ve akış | Hangi dosyaların sayıldığına göre 34 ile 45 bin satır arası | En büyük ve en değerli parça. Çoğu, komut satırı ajanlarının çıktısını ayrıştırmaya ve Paperclip'e özgü durumlara ayrılmış. Agent Office'te çalıştırıcı, adımları yapılandırılmış olarak sakladığı için o katmana gerek yok |
| Gelen kutusu | Yaklaşık 6 bin satır | Sıra sabitleme mantığı küçük, ayrı dosyalarda; onlar taşınabilir |
| Görev listesi ve pano görünümü | Yaklaşık 5 bin satır | |
| Ajan listesi, ajan sayfası, şema | Yaklaşık 6 bin satır | Şemanın yerleşim hesabı yaklaşık 50 satır |
| Denetim, maliyet, bütçe | Yaklaşık 3 bin satır | |
| Yeni görev penceresi | Yaklaşık 2 bin satır | Agent Office'teki karşılığı talep formudur |
| Canlı güncelleme | Yaklaşık 2 bin satır | Yalnızca kalıp alınır |
| Genel bakış, Onaylar | Yaklaşık 2 bin satır | |

Uyarlama gerektiren teknik farklar:

| Konu | Paperclip | Agent Office |
|---|---|---|
| Yönlendirici | react-router 7. Yönlendirme çağrılarının çoğu tek bir dosyadan (`lib/router.tsx`) geçiyor; 16 dosya kütüphaneyi doğrudan içe aktarıyor | TanStack Router; dosya tabanlı yollar |
| Formlar | Form kütüphanesi yok; alanların durumu elle tutuluyor | react-hook-form ve zod |
| Dil | İngilizce metinler bileşenlerin içinde | Bütün metinler Türkçe yeniden yazılır |
| İçe aktarma yazımı | Göreli yollar ve `@/` takma adı karışık | `apps/web` içinde `@/` takma adı kullanılıyor; taşınan dosyalar buna çevrilir |
| Tasarım değişkenleri | Bileşenler ölçü, yazı boyutu, köşe, gölge ve geçiş değerlerini de stil dosyalarındaki değişkenlerden alıyor (`--side-panel-*`, `--text-compact`, `--sz-*` gibi) | Taşınacak 43 dosya yaklaşık 60 değişkene başvuruyor; Agent Office'te altısı tanımlı. Eksiklerin yaklaşık yirmisi durum renkleridir; kalanların tanımı da taşınır ya da Agent Office değerleriyle yeniden yazılır |
| Tip kontrolü ayarları | Yalnızca `strict` | `tsconfig.base.json` içinde `strict` yanında `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noImplicitOverride` ve `noImplicitReturns` açık. Taşınan dosyalar bu ayarlarla denetlenir; dizi erişimlerinde ve tip içe aktarmalarında düzeltme gerekir, ne kadar olacağını ölçmedim. Paperclip'in `ui/src` klasöründe `enum` ve `namespace` yok; parametre özelliği test dosyaları dışında iki dosyada var; taşınacak parçalar bunlardan yalnızca `api/response.ts` dosyasına bağlı |
| Ortak tipler | `@paperclipai/shared` | `@agent-office/shared` |
| Kısayol tuşları | `[` ve `]` | Türkçe Q klavyede bu tuşlar AltGr ile yazılır. Windows'ta AltGr, Ctrl ile Alt birlikte basılı sayıldığı için Paperclip'in dinleyicisi bu iki kısayolu yok sayar; Türkçe klavyeye uygun tuşlar seçilmelidir |
| Eklenti yuvaları, bulut sürümüne ve özellik bayraklarına özgü kod | Var | Silinir |

### 13.6 Uygulama sırası

Süre tahmini vermiyorum. Göreli büyüklük için eldeki ölçü Paperclip'teki karşılıkların boyutudur (13.5); Agent Office'te yazılacak sürümler bundan çok daha küçüktür.

**Önce: karar ve plan.** Kod yok.

1. Kurucu kararları (14. bölüm) verilir ve `docs/kararlar/` altına tarihli dosya olarak yazılır.
2. `docs/PLAN.md` güncellenir: "Ekranlar" bölümünün girişi (yerleşim), Bugün ve Görev ayrıntısı satırları. `docs/KALAN-ISLER.md` güncellenir: kabuk işi 0.4'ten önce yeni bir madde olarak eklenir; 13.3'teki bütün satırlar ilgili maddelere işlenir; 0.3'teki şirket seçicisi maddesi yeni yerleşime göre değişir.
3. `CLAUDE.md` içindeki "Arayüz ve tasarım dili" bölümü, verilen görsel yön kararına göre güncellenir.
4. Karar bekleyen sorular ve sonraya bırakılanlar `docs/SONRA.md` dosyasına yazılır.
5. Bu belge ve ekleri depoya konur. Bu adım kurucunun onayıyla 5 Ekim'de yapıldı (15. bölüm); dosyalar commit'lenmedi, ilk dört adımla birlikte commit'lenebilir.

İlk dört adımı tek bir değişiklik olarak hazırlayıp onaya sunabilirim.

**Sonra: KALAN-ISLER sırası.**

1. Kabuk: kenar çubuğu, üst çubuk, özellik paneli, durum dili, liste satırı. Kabuğun içindeki ekranlar (Kullanıcılar, Güvenlik ve beş boş ekran) yeni kabuğa alınır; işlevleri değişmez. Arka uçta değişiklik gerekmez.
2. Görev kaydı ve pano (0.4); Görev ayrıntısının temel hâli, akış olarak.
3. Onay Masası (0.5); onay kartı.
4. Claude bağlantısı (0.6), ortamlar (0.7) ve Sprint 1: çalıştırıcı yazıldıkça çalışma özeti, adımlar ve soru kartı; Görev ayrıntısının tam hâli (1.6).
5. Sprint 2: Bugün ve İz kaydı.

Yöntem `CLAUDE.md`'deki gibidir: her görevde önce kısa bir plan yazılır ve onay beklenir; iş `development` dalında, küçük commit'lerle ilerler; biten iş `docs/KALAN-ISLER.md` içinde işaretlenir. Test ortamı henüz kurulmadı (0.7); kabuk, 0.4 ve 0.5 yerelde denenir, ortam kurulunca `development` oraya yayımlanır. Her yeni tablo için şirket ayrımı testi yazılır. Tip kontrolü, ESLint, Prettier ve testler temiz olmadan iş bitmiş sayılmaz. Başka dal açılamadığı için `development` her commit'te yayımlanabilir durumda olmalıdır: bitmemiş bir ekran, bitene kadar menüye konmaz.

### 13.7 Kod alma kuralları

1. Depoya `THIRD_PARTY_NOTICES.md` eklenir ve içine Paperclip'in `LICENSE` metni olduğu gibi konur. Telif satırı yeniden yazılmaz: "Copyright (c) 2025 Paperclip AI". Depoda shadcn bileşenleri için aynı uygulama var (`apps/web/src/components/ui/LICENSE`).
2. Kod `dd868ed` commit'inden alınır. Taşınan her dosyanın başına kaynak yolu ve commit kimliği yazılır. Paperclip değişmeye devam edecek; sabit bir noktaya bağlanmak karışıklığı önler.
3. Alınmayacaklar: Paperclip adı ve logosu, ajan karakter çizimleri, üçüncü taraf marka logoları.
4. Inter yazı tipi kullanılırsa SIL OFL bildirimi eklenir.
5. Taşınan dosyalarda kod ve açıklamalar İngilizce kalır, arayüz metinleri Türkçe yazılır (3 Ekim, karar 4).
6. Eklenti yuvaları, bulut sürümüne ve özellik bayraklarına özgü kod, eski kabuk dosyaları taşınmaz.
7. Yeni bağımlılık `pnpm-workspace.yaml` kataloğuna tam sürümle eklenir, `package.json` içinde `catalog:` yazılır; 24 saatten yeni sürüm kurulmaz; kurulum betiği isteyen paket yalnızca `allowBuilds` ile onaylanır.
8. Taşınan kod o andan sonra Agent Office'in kodudur: testleri yazılır; tip kontrolünden, ESLint ve Prettier denetimlerinden geçer.

### 13.8 Alınmayacaklar

- Sunucu, veri katmanı ve giriş: uygulama kodundaki şirket yalıtımı, e-posta ve parolayla giriş, şirket silme yolu.
- Ajan çalıştırma tarafı: adaptörler, çalışma alanları, sandbox'lar, deneysel çalıştırıcı, uyandırma motorunun kendisi.
- Özerklik özellikleri: ajanın ajan işe alması; strateji onayı; "her zaman izin ver"; ajanların soru ve onay kartlarını yanıtlaması; ajan, skill ve rutinlerin arayüzden düzenlenmesi.
- Ürünün dağıtımıyla ilgili özellikler: şirketi içe ve dışa aktarma, ekip kataloğu, eklenti sistemi, sürüm kanalları, telemetri, duyurular.
- Sohbet bağlayıcıları (Slack, Discord, Telegram, Teams) ve ajan sohbeti.
- Hedef hiyerarşisi.
- Deneysel ekranlar: "cases", "pipelines", durum kartları, kararlar masası.

İlk üç madde Agent Office'in kurallarından ve mimarisinden doğar. Kalan dört madde benim önerimdir; istenirse `docs/SONRA.md` dosyasına fikir olarak yazılabilir.

Karara bağlı olan: görevi doğrudan ajana atama, yani atanan seçicisi ve "Görev ata" düğmesi. Tasarım raporuna göre talep koordinatörden geçer. Öte yandan KALAN-ISLER 0.4 atamayı "insana ya da ajana" diye planlıyor ve 2 Ekim karar 8, insanın bir görevi ajana atayabildiğini varsayıyor. Talep formunda birimin ya da ajanın doğrudan seçilip seçilemeyeceği X2-4, hangi rolün hangi ajana iş verebileceği M29 kararıyla belirlenecek (12.1, 12.3). M17 ayrı bir sorudur: ajanın yaptığı atama değişikliğinin hangi durumda onaya düşeceğini sorar. Seçici alınırsa bu sınırlar içinde çalışır.

Bir çekince: sandbox sağlayıcıları bu incelemede yüzeysel geçildi. Önceki konuşmalardan kalan karara göre siber güvenlik birimi, taramalarını sandbox ortamında yapacak; Paperclip'in bu kısmı o iş için ayrıca incelenmeye değer olabilir.

### 13.9 Riskler

| Risk | Açıklama | Önlem |
|---|---|---|
| Açılış tarihi | PLAN'a göre pilot 10 Ekim'de açılıyor. Sprint 0'ın süresi 3 Ekim'de doldu; 0.2 ve 0.3'te tamamlanmamış maddeler var, 0.4 ile 0.9 arasındaki işlerin hiçbiri tamamlanmadı, test ortamı yok, çalıştırıcı ve ajan işlerine başlanmadı. Kabuk değişimi ve kalıplar bu takvime iş ekler | 14.3 ve 14.6: kalıplar ve ekler açılıştan sonraya bırakılabilir |
| Görev ayrıntısının büyüklüğü | Paperclip'te en dar sayımla yaklaşık 34 bin satır; aynısını kurmaya çalışmak işi gereksiz büyütür | İlk sürüm dar tutulur: akış, özet satırı ve tek düzeyli ayrıntı, üç kart türü (soru, onay, görev önerisi) |
| İki dal kuralı | Yarım kalan arayüz işi de aynı daldan yayımlanır | `development` her commit'te yayımlanabilir durumda tutulur; bitmemiş ekran menüye konmaz |
| Kopyalanan kodun bakımı | Taşınan yaklaşık 7 bin satır ve bağlı modüller artık Agent Office'in sorumluluğunda | Yalnızca bağımsız parçalar taşınır; gerisi yeniden yazılır |
| Paperclip'in değişmesi | Şimdi beğenilen ekran üç ay sonra farklı olabilir | Sabit commit; kalıplar alınır, ekran kopyalanmaz |
| Kapsamın büyümesi | Paperclip'te 80 kadar sayfa var | 13.3'teki dağılım, 14.6'daki kapsam kararı ve `docs/SONRA.md` |
| Telefon | Paperclip'in telefon için ayrı bir düzeni var (4.6); telefon uyumu şartsa taşınan her kalıbın telefon hâli de yapılır ve iş büyür | 14.4. Telefon işleri KALAN-ISLER'de zaten var (0.4, 0.5, 1.3) |

## 14. Kurucu kararları

Kodda değişiklik yapmadan önce altı kararın verilmesi gerekiyor. Beşinde önerimi yazdım; telefon kararında önerim yok, çünkü orada bir çelişki var ve hangisinin geçerli olduğunu bilmiyorum. Seçim kurucunundur.

Hemen gerekenler ilk dört karardır: yaklaşım (14.1), görsel yön (14.2), zamanlama (14.3) ve telefon (14.4). Kabuk bu dördüne göre kurulur; menüdeki Onaylar satırı 14.5'e, "Ara" satırı 14.6'ya bağlıdır. Sıradaki iş olan 0.4 için KALAN-ISLER ayrıca üç SONRA sorusunun yanıtını istiyor: durum geçişleri (M16), atama değişikliği kuralı (M17) ve talebin KOR-1'den geçmesi (X2-4).

### 14.1 Karar 1: yaklaşım

| Seçenek | Açıklama | Sonucu |
|---|---|---|
| a | Paperclip'e geçilir (13.1, A yolu) | Agent Office bırakılır; değişmez kuralların çoğu (2, 3, 4, 5, 9, 11, 12) Paperclip'te karşılanmıyor: 11 ve 12'nin karşılığı yok, diğerleri daha zayıf ya da isteğe bağlı (12.1) |
| b | Paperclip çatallanır (13.1, B yolu) | Aynı kuralların Paperclip'in üzerine yeniden yazılması gerekir; haftalık sürümler yüzünden çatal asıl depodan kopar |
| c | Arayüz yapısı ve kalıplar alınır; bağımsız parçaların kodu taşınır (13.5) | Mimari, kurallar ve ekran listesi kalır. Depoya MIT bildirimi eklenir; taşınan yaklaşık 7 bin satırın ve bağlı modüllerin bakımı Agent Office'e geçer. **Önerim** |
| d | Arayüz yapısı ve kalıplar alınır; kod taşınmaz, hepsi yeniden yazılır | Mimari, kurallar ve ekran listesi kalır. Kopyalanan kod olmaz; kabuk işi büyür |
| e | Yalnızca kalıplar alınır (7. bölüm); mevcut kabuk kalır (üst çubuk ve alt menü) | En küçük iş; görünüm Paperclip'e az benzer |
| f | Hiçbir şey değişmez; bu belge kaynak olarak saklanır | Ekranlar PLAN'daki hâliyle yapılır; arayüz 2 Ekim kararındaki baştan ele alma işini bekler |

### 14.2 Karar 2: görsel yön

| Seçenek | Açıklama | Sonucu |
|---|---|---|
| a | Paperclip'in görünümü aynen: gri tonlar, Inter, büyük harfli etiketler | `CLAUDE.md` içindeki tasarım dili baştan yazılır; vurgu renginden ve IBM Plex Sans'tan vazgeçilir. Açık temada üç durum rozetinde (gri, sarı, yeşil), karanlık temada diğer üçünde (mavi, mor, kırmızı) yazı kontrastı AA'nın altında kalıyor; tonların düzeltilmesi gerekir (12.2) |
| b | Paperclip'in yapısı, mevcut tasarım dili: aynı yerleşim, yoğunluk ve kalıplar; IBM Plex Sans, `#127A77` vurgu, cümle düzeninde etiketler | Tasarım dili kuralları büyük ölçüde kalır; kabuk ve durum renkleri için ek kural yazılır. Geçici arayüz için seçilen dil kalıcı hâle gelir. **Önerim** |
| c | Karma: Paperclip'in gri zemini ve durum renkleri; mevcut yazı tipi ve vurgu rengi | Renk kuralları yeniden yazılır, yazı tipi kalır. Kontrast sorunu a seçeneğindekiyle aynı |

Önerimin gerekçesi: Paperclip'i beğendiren şey yapısı ve davranışı (7. bölüm); bunlar üç seçenekte de aynı. Bu benim yorumum. Beğenilen şey gri görünümün kendisiyse doğru seçenek a'dır; bu da yerinde bir seçim olur, çünkü arayüz zaten geçici sayılıyor ve tasarım dili baştan ele alınacak. İki nedenle b seçeneğini öneriyorum. Birincisi, onay ağırlıklı bir araçta birincil eylemin renkle ayrışması işe yarıyor: Paperclip'te birincil düğme siyah, Agent Office'te vurgu renginde. İkincisi, tasarım raporu ofisin ileride ürünleşmesini öngörüyor; kendi rengi ve yazı tipi olan bir arayüz Paperclip'in kopyası gibi görünmez. Üç seçeneği aynı ekranlar üzerinde gösteren görsel yön taslağı bu belgeyle birlikte verildi (15.1); karar ona bakılarak verilmelidir.

12.2'deki satırların b seçeneğindeki karşılığı:

| Konu | b seçeneğinde |
|---|---|
| Büyük harfli etiketler | Cümle düzeninde yazılır |
| Yazı tipi | IBM Plex Sans; numara ve sayılar aynı ailenin eşit genişlikteki rakamlarıyla |
| Renk | `--brand` vurgu. Durum renkleri Agent Office değişkenleriyle eşleştirilir (`--awaiting-approval` ve `--error` zaten var); eksik durumlar için yeni değişken tanımlanır ve kontrastı ölçülür. Görsel yön taslağında kullanılan örnek tonlar: "Sürüyor" `#2459B8`, "Yanıt bekliyor" `#6B4FB8`, "Tamamlandı" `#1F7A3E`; `#F6F7F9` zemin üstünde oranları 5,0 ile 6,1 arasında |
| Ortadan noktalı meta dizgileri | Alanlar ayrı öğeler olarak yazılır |
| Uzun tire, düğme metninde ok | Kullanılmaz |
| Gölge ve bulanıklık | Açılan katmanlarda ince kenarlık; bulanıklık yok |
| Özdeş kutu ızgaraları | Bugün ekranındaki ajan kutuları ve Ölçümler'deki sayı kutuları gölgesiz ve ince kenarlıklı çizilir. Kaçınılacaklar listesindeki madde yalnızca gölgeli kartlardan söz ediyor; özdeş kutu ızgarasının kendisi de istenmiyorsa ajan kutuları liste satırına çevrilir |
| Ajan karakter çizimleri, renk geçişleri | Alınmaz; ajan kodu rozet olarak gösterilir. Tasarım raporunda roller birim ajanlarına yetenek olarak yükleniyor; her role bir karakter vermek, asıl çalışanın birim ajanı olduğunu gizler |
| Yeni satır animasyonu | Alınmaz |
| Canlı gösterge | 14.7'deki ilk soru |
| Menü ve boş ekran simgeleri | 14.7'deki ikinci soru |
| Telefon alt menüsü | Mevcut beş başlık kalır (14.4) |

### 14.3 Karar 3: zamanlama

10 Ekim tarihi bu karardan bağımsız olarak risk altında: Sprint 0'ın süresi 3 Ekim'de doldu, 0.2 ve 0.3'te tamamlanmamış maddeler var, 0.4 ile 0.7 arasındaki dört işe başlanmadı, kurucunun işleri (0.8) ve kapı (0.9) duruyor, test ortamı yok, çalıştırıcı ve ajan işlerine başlanmadı. Seçeneklerden a gecikme riskini büyütür, b daha az büyütür, c büyütmez.

| Seçenek | Açıklama | Sonucu |
|---|---|---|
| a | Şimdi: kabuk 0.4'ten önce değişir; Görevler, Onay Masası, Görev ayrıntısı ve Bugün ekranları ilk kez Paperclip'in kalıplarıyla yapılır | Yapılmış kabuk yeniden yazılır; yeni ekranlar bir kez yapılır. Sıradaki arayüz işlerinin hacmi büyür ve açılış daha çok kayar. KALAN-ISLER'e kabuk işi eklenir; 13.3'teki maddeler, 0.3'teki şirket seçicisi maddesi, PLAN'ın "Ekranlar" bölümü ve `CLAUDE.md` güncellenir. **Önerim** |
| b | Kabuk şimdi, kalıplar sonra: kabuk 0.4'ten önce değişir; ekranların içi PLAN'daki sade hâliyle yapılır, kalıplar açılıştan sonra eklenir | Kabuk işi kadar gecikme ekler. Görevler, Onay Masası ve Görev ayrıntısı açılıştan sonra bir kez daha elden geçer. KALAN-ISLER'e kabuk işi ve açılış sonrası kalıp işleri eklenir |
| c | Açılıştan sonra: pilot ekranları mevcut kabukla ve PLAN'daki hâliyle yapılır; Paperclip'e benzetme pilot açıldıktan sonra tek seferde yapılır | PLAN değişmez. Pilot ekranlarının arayüzü açılıştan sonra yeniden yapılır; 2 Ekim kararındaki durum budur |

Önerimin gerekçesi: benzetilecek ekranlar henüz yok. Kabuğu değiştirmek şu an çalışır durumdaki iki ekranı ve beş boş ekranı etkiliyor; her yeni ekranla pahalılaşır. Görevler, Onay Masası ve Görev ayrıntısı sade hâliyle yapılıp sonra yeniden kurulursa aynı işin bedeli iki kez ödenir. 2 Ekim kararı ("ileride baştan ele alınacak") bu işin ne zaman yapılacağını söylemiyor; ekranların çoğu henüz yapılmadığı için baştan ele alma ilk yapımla birleştirilebilir.

Karşı görüş: takvim zaten sıkışık ve kurucudan beklenen hesap, belge ve karar işleri var. 10 Ekim tarihi kesinse b seçeneği makuldür; c'yi önermiyorum. Kapsamı daraltmak için 14.6'daki karar kullanılabilir.

### 14.4 Karar 4: telefon

| Seçenek | Açıklama | Sonucu |
|---|---|---|
| a | Yalnızca geniş ekran (proje notundaki kurucu kararı; depoda kaydı yok) | Karar dosyasına yazılır. PLAN'da Arayüz satırı ("Telefona uyumlu web uygulaması (PWA); onaylar telefondan verilir"), "Ekranlar" bölümünün girişi, modül M3 satırı, Sprint 0'daki telefon görünümü maddesi ve açılış kontrolü değişir. `CLAUDE.md` içindeki üç telefon kuralı değişir. KALAN-ISLER'de 0.4, 0.5 ve 1.3'teki telefon maddeleri ile 2.8'deki açılış kontrolü çıkar; 2.6'daki telefon bildirimi, PLAN'daki "Telefon bildirimleri hassas bilgi taşımaz" kuralı ve `send_notification` aracının açıklamasıyla birlikte gözden geçirilir. Yapılmış alt menü ve PWA manifesti kalır ya da kaldırılır |
| b | Telefona uyumlu (tasarım raporu, PLAN, `CLAUDE.md`, KALAN-ISLER) | PLAN değişmez. Paperclip'in telefon düzeni de örnek alınır: kenar çubuğu çekmeceye, özellik paneli alttan açılan sayfaya dönüşür; alt menü mevcut beş başlıkla kalır. Proje notu düzeltilir |
| c | Yalnızca onay için gereken ekranlar telefonda çalışır: Bugün, Onaylar ve Görev ayrıntısı | Depodaki belgeler de proje notu da güncellenir; telefon işi üç ekranla sınırlı kalır |

Burada öneride bulunmuyorum; hangi kararın geçerli olduğunu bilmiyorum (12.3). Seçeneklerin bedeli:

- Seçenek a: sıradaki işlerden telefon düzenleri çıkar ve takvim kısalır. Buna karşılık tasarım raporu, telefondan onayı, onay yükünün tek kişide toplanmasına karşı önlem sayıyor ve "onay bekleme süresi" pilotun ölçütlerinden biri; pilotta bütün onaylar kurucuda. Bu önlemin yerine ne konacağı belirlenmelidir.
- Seçenek b: takvim PLAN'daki gibi kalır. Paperclip'in telefon için ayrı bir düzeni var (4.6); telefon genişliğindeki denemede düzgün çalıştı.
- Seçenek c: ikisinin arasıdır.
- Üçünde de: kural 8'e göre panel ileride yalnızca ofis ağından ve VPN ile açılacak; o zaman telefondan erişim de buna bağlı olur. Bunun ağ kısıtı mı, kimlik tabanlı erişim mi olacağı SONRA'da karar bekliyor (M54).

### 14.5 Karar 5: Bugün ve Onaylar

| Seçenek | Açıklama | Sonucu |
|---|---|---|
| a | Onaylar ayrı ekran olarak kalır. Bugün ekranının ilk sekmesi "bana düşenler" listesi olur: bekleyen onaylar, yanıt bekleyen sorular, görev önerileri, sınıra takılan ya da başarısız çalışmalar, bildirimler. Onay üç yerden verilebilir: Onaylar, Bugün ve Görev ayrıntısı | PLAN'daki ekran listesi değişmez; Bugün'ün içeriği netleşir. **Önerim** |
| b | Paperclip'teki gibi ayrı bir Gelen kutusu ekranı eklenir; Bugün ekranı PLAN'daki özet ekranı olarak kalır | PLAN'a yeni ekran, menüye yeni satır eklenir; telefon alt menüsünün beş başlığı yeniden düşünülür |
| c | Ayrı Onaylar ekranı kalkar; onaylar, Paperclip'in Gelen kutusu ekranındaki gibi tek listenin içinde durur | PLAN, `CLAUDE.md`, telefon alt menüsü ve kural 4'teki "Onay Masası" ifadesi değişir. Tasarım raporunun onay ölçütleri için onaylar yine ayrı kayıt türü olarak kalmalıdır |

Önerimin gerekçesi: Agent Office'te onay, Paperclip'tekinden çok daha merkezî bir iştir. Dışa etkili her ajan eylemi onaydan geçer, tasarım raporu Onay Masası'nı tek kuyruk olarak tanımlar ve üç ölçüt onun kayıtlarından çıkar. Bu yüzden Onaylar ayrı ekran olmalıdır. Öte yandan sorular, görev önerileri ve sınıra takılan çalışmalar için PLAN'da ayrı bir yer yok; Bugün ekranı bunların doğal yeridir. Kayıt tektir, üç yerde görünür; karar tek bir uç noktadan geçer (13.4).

### 14.6 Karar 6: kapsam

Bu karar, 14.1'de c ya da d seçilirse gerekir.

| Seçenek | Açıklama | Sonucu |
|---|---|---|
| a | Çekirdek: kabuk, durum dili, liste satırı, Onay Masası kalıbı ve onay kartı, akış biçimli Görev ayrıntısı, Bugün'de "bana düşenler" listesi | Listeler belirli aralıklarla yenilenir. Görev numarası, okunmamış işareti, komut paleti, kısayollar ve anlık canlı güncelleme açılıştan sonraya kalır ve `docs/SONRA.md` dosyasına yazılır. Seçenekli soru kaydı X1-6 ile birlikte kararlaştırılır. **Önerim** |
| b | Çekirdek ve ekler birlikte | Açılış daha çok kayar; veri modeline ekler gerekir (13.4) |
| c | Yalnızca kabuk ve durum dili | En küçük iş. Ekranların içi PLAN'daki gibi yapılır |

Önerimin gerekçesi: benzerliğin büyük kısmı çekirdekten gelir ve çekirdek, kabuk işi dışında KALAN-ISLER'e yeni madde eklemeden oradaki işlerin biçimini değiştirir. Ekler yararlı ama açılış için şart değil; veri modelini değiştirenler ayrıca karar ister.

### 14.7 Küçük seçimler ve yanıt bekleyen sorular

Aşağıdaki soruların bir kısmı depoda zaten karar bekleyen soru olarak duruyor; ikinci sütun kodunu ve mevcut durumunu verir. Depoda karşılığı olmayanlar "Yeni soru" diye işaretlendi; kabul edilirse `docs/SONRA.md` dosyasına eklenir.

| Soru | Depodaki durumu | Önerim ya da not |
|---|---|---|
| Canlı gösterge (yanıp sönen nokta, dönen simge) hareketli olsun mu? | Yeni soru. `CLAUDE.md`: hareket yalnızca kullanıcının yaptığı işin sonucunu gösterir. PLAN'a göre Ofis görünümü, durumları "renk ve hareketle" gösterir (modül M15) | Olsun; kurala canlı gösterge için istisna yazılsın. Görsel yön taslağında açılıp kapatılabiliyor |
| Geniş ekranda menü satırlarında simge olsun mu? | Yeni soru. Telefon alt menüsünde var, üst çubukta yok | Kenar çubuğunda da olsun; boş ekranlardaki büyük simgeler alınmasın |
| Zemin ve yüzey renkleri nasıl dağıtılır? | Yeni soru. Mevcut arayüzde sayfa zemini `--canvas`, kartlar `--surface` | Kenar çubuğu `--canvas`, içerik `--surface`; görsel yön taslağında b seçeneği böyle çizildi |
| Görev numarası olsun mu; ön ekler ne olsun? | Yeni soru | 13.4. Numaralardaki boşlukların gizli proje görevlerini ele vermesinin kabul edilip edilmeyeceğine de karar verilmeli |
| Görev ve onaylarda okunmamış işareti olsun mu? | Yeni soru. Bildirimlerde var; görev ve onayda yok | Açılıştan sonra (14.6) |
| Komut paleti ve kısayollar olsun mu? | Yeni soru | Açılıştan sonra; tuşlar Türkçe Q ve F klavyeye göre seçilsin |
| Soru nasıl sorulur ve yanıt nasıl beklenir? | X1-6, karar bekliyor. Soru kanalı karara bağlandı: "İnsana sor" yolu (2 Ekim, karar 1). Yanıt taslağı: soru, görev yorumu olarak yazılır; yanıt yorumu ajanı yeniden başlatır | Yorumun yanında seçenekli soru kaydı; kart, yazma kutusunun üstünde durur (13.4) |
| Onay beklenirken çalışma ne olur; süre sınırı nasıl sayılır? | Yeni soru; M5 ile birlikte kararlaştırılmalı | 13.4 |
| Onay satır içinden verilebilir mi? | PLAN: "telefonda tek dokunuş". Yanıt taslağı: risk işareti varsa fark ekranı açık gelir (M21) | 13.4 |
| Onaylar zaman aşımına uğrar mı? | Süreye bağlı kapanma yok; dayanak değişirse onay kapanır. 24 saat bekleyen onay için uyarı planlanıyor (M46, karar bekliyor) | Paperclip'teki 60 dakikalık süre alınmasın |
| Günlük onay turları ekranda nasıl görünür? | KALAN-ISLER 0.5: "Toplu onay turu görünümü". Tur saatleri karar bekliyor (R12) | Onaylar ekranında o turda onaylanacak işler sırayla gösterilir; Paperclip'te karşılığı yok, ayrıca tasarlanmalı |
| İki şirketin bekleyen onayları kurucuya nerede gösterilir? | N15, karar bekliyor | 13.2 |
| Göreve yazılan insan yorumu ajanı çalıştırır mı? | X1-6, karar bekliyor. Yanıt taslağı: yanıt yorumu gelince çalıştırıcı aynı ajanı yeniden başlatır | 13.4: yalnızca yanıt beklenirken ve yazan muhatapsa |
| Talep her zaman KOR-1'den mi geçer; kim hangi ajana iş verebilir? | X2-4 ve M29, karar bekliyor. Yanıt taslağı: varsayılan KOR-1; formda "birimi kendim seçeyim" seçeneği; rol ve ajan eşlemesi için taslak bir liste | Yanıt taslağına uygun kalsın; Paperclip'in atanan seçicisi bu sınırlar içinde alınabilir |
| Bir ajanın, dış kişiyle paylaşılmış göreve yazdığı yorum onaya düşer mi? | Yeni soru. Dış kişi paylaşılan görevin yorumlarını görür; çalışma ve araç çağrısı kayıtlarını göremez. Görevi dış kişiye açmak passkey ister (5 Ekim, karar 4) | Önerim yok; kurucu karar vermeli. Dış kişiyle paylaşım dışa etkili sayılıyor |
| Dış kişinin yorumu ajan için talimat mı, veri mi? | Yeni soru. Yanıt taslağı: dış kişi pilotta hiçbir ajana talep açamaz (M29) | Veri sayılsın |
| Süren bir çalışmayı kim, nereden keser? | X1-5, karar bekliyor. Yanıt taslağı: ajan durdurma düğmesi çalışmayı sonraki araç çağrısından önce keser | Görev ayrıntısında ayrı bir "Çalışmayı kes" düğmesi gerekip gerekmediği kararlaştırılmalı |
| Tarayıcıda saklanan metinler ve görev başlıkları oturum kapanınca silinsin mi? | Yeni soru | 13.4 |
| Arapça çıktı ekranda nasıl gösterilir? | R13, karar bekliyor. Yanıt taslağı: Arapça Aşama 2'de; arayüz metinleri tek dosyada toplanır; sağdan sola düzen pilotta yok | Arayüz soldan sağa kalır; çıktı metninin yönü içeriğe göre belirlenir |
| Bütçe aşılınca ne olur? | X1-4, karar bekliyor. Yanıt taslağı: yalnızca uyarı, iş durmaz | Ekranda uyarı ile durdurma ayrı gösterilsin (6.11) |
| Şirkete özel ajan ayarları hangi ekrandan değişir? | N26, karar bekliyor | Ajan sayfasında şirket başına bir bölüm |
| `employee` rolü Ajanlar ve Ölçümler ekranlarını ve maliyet bilgisini görür mü? | Yeni soru. PLAN: çalışan, üyesi olduğu şirketin görev ve notlarıyla çalışır; onay yetkisi kurucu verirse açılır; dış kişi yalnızca kendisine açılan görev ve notları görür. Veritabanında iz kaydını yalnızca kurucu okur. Çalışanın bu ekranları görüp görmeyeceği yazılı değil | Önerim yok; kurucu karar vermeli |

## 15. Ekler

### 15.1 Ekran görüntüleri ve taslak

Ekran görüntüleri bu inceleme sırasında çalıştırılan Paperclip'ten, Türkçe örnek veriyle alındı. Dosyalar `docs/paperclip-incelemesi/ekran-goruntuleri/` klasöründedir:

| Dosya | İçerik |
|---|---|
| [`01-genel-bakis.png`](paperclip-incelemesi/ekran-goruntuleri/01-genel-bakis.png) | Genel bakış: ajan kutuları, dört sayı, grafikler |
| [`02-gelen-kutusu.png`](paperclip-incelemesi/ekran-goruntuleri/02-gelen-kutusu.png) | Gelen kutusu, Benim sekmesi |
| [`03-gorev-listesi.png`](paperclip-incelemesi/ekran-goruntuleri/03-gorev-listesi.png) | Görev listesi |
| [`04-pano-gorunumu.png`](paperclip-incelemesi/ekran-goruntuleri/04-pano-gorunumu.png) | Görev listesinin pano görünümü |
| [`05-gorev-soru-karti.png`](paperclip-incelemesi/ekran-goruntuleri/05-gorev-soru-karti.png) | Görev sayfası: soru kartı ve plan belgesi |
| [`06-gorev-onay-karti.png`](paperclip-incelemesi/ekran-goruntuleri/06-gorev-onay-karti.png) | Görev sayfası: onay kartı ve özellik paneli |
| [`07-calisma-sayfasi.png`](paperclip-incelemesi/ekran-goruntuleri/07-calisma-sayfasi.png) | Çalışma sayfası |
| [`08-onaylar.png`](paperclip-incelemesi/ekran-goruntuleri/08-onaylar.png) | Onaylar sayfası |
| [`09-maliyet.png`](paperclip-incelemesi/ekran-goruntuleri/09-maliyet.png) | Denetim, Maliyet sekmesi |
| [`10-butce.png`](paperclip-incelemesi/ekran-goruntuleri/10-butce.png) | Denetim, Bütçe sekmesi (yanlış gösterilen uyarı kaydıyla) |
| [`11-ajan-sayfasi.png`](paperclip-incelemesi/ekran-goruntuleri/11-ajan-sayfasi.png) | Ajan sayfası ve ikinci kenar çubuğu |
| [`12-organizasyon-semasi.png`](paperclip-incelemesi/ekran-goruntuleri/12-organizasyon-semasi.png) | Organizasyon şeması |
| [`13-rutin.png`](paperclip-incelemesi/ekran-goruntuleri/13-rutin.png) | Rutin ayrıntısı |
| [`14-karanlik-tema-gorev.png`](paperclip-incelemesi/ekran-goruntuleri/14-karanlik-tema-gorev.png) | Görev sayfası, karanlık tema |
| [`15-telefon-gelen-kutusu.png`](paperclip-incelemesi/ekran-goruntuleri/15-telefon-gelen-kutusu.png) | Gelen kutusu, telefon genişliği |

Görsel yön taslağı [`gorsel-yon-taslagi.html`](paperclip-incelemesi/gorsel-yon-taslagi.html) dosyasıdır ve `docs/paperclip-incelemesi/` klasöründe durur. 14.2'deki üç görsel yönü aynı Agent Office ekranları üzerinde gösterir; tarayıcıda açılır. Üstteki düğmelerle seçenek değiştirilir; menü simgeleri ve hareketli canlı gösterge açılıp kapatılabilir. Çizilen ekranlar: Bugün, Onaylar, Görevler ve Görev ayrıntısı. Ekran, ajan ve araç adları ile kurallar depodaki belgelerden alındı; görevler, sayılar ve metinler örnek veridir. Taslak, Paperclip'in kodunu, logosunu ya da çizimlerini içermez; IBM Plex Sans ve Inter yazı tipleri (SIL OFL) ile Lucide simgeleri (ISC) dosyaya gömülüdür. Yalnızca açık tema ve geniş ekran çizildi. Taslak bir karar yardımcısıdır, uygulama kodu değildir; içindeki adlar Türkçedir.

### 15.2 Ara raporlar

Yedi ara rapor `docs/paperclip-incelemesi/ara-raporlar/` klasöründedir; toplam yaklaşık 7.400 satırdır. Dosya yolu ve satır numarası verirler; geliştirme sırasında ayrıntı gerektiğinde bunlara bakılır. Raporlar İngilizce yazılmıştı; `docs/` belgeleri Türkçe olduğu için depoya konurken Türkçeye çevrildi. Kod, dosya yolları ve Paperclip'in arayüzünden alınan İngilizce metinler özgün hâliyle bırakıldı.

| Rapor | Konu |
|---|---|
| [`01-arayuz-iskeleti-ve-tasarim-dili.md`](paperclip-incelemesi/ara-raporlar/01-arayuz-iskeleti-ve-tasarim-dili.md) | Yönlendirme, kabuk, kenar çubuğu, tasarım değişkenleri, temel bileşenler |
| [`02-is-ekranlari.md`](paperclip-incelemesi/ara-raporlar/02-is-ekranlari.md) | Genel bakış, Gelen kutusu, görev listesi, görev sayfası, çalışma kayıtları, arama |
| [`03-organizasyon-ve-yonetisim-ekranlari.md`](paperclip-incelemesi/ara-raporlar/03-organizasyon-ve-yonetisim-ekranlari.md) | Ajanlar, organizasyon şeması, onaylar, maliyet ve bütçe, rutinler, skill'ler, bağlayıcılar, ayarlar |
| [`04-veri-modeli-ve-servisler.md`](paperclip-incelemesi/ara-raporlar/04-veri-modeli-ve-servisler.md) | Şema, API, durum kuralları, şirket yalıtımı, giriş |
| [`05-ajan-calistirma.md`](paperclip-incelemesi/ara-raporlar/05-ajan-calistirma.md) | Uyandırma motoru, adaptörler, insan onayı mekanizmaları, maliyet |
| [`06-telemetri-lisans-guvenlik.md`](paperclip-incelemesi/ara-raporlar/06-telemetri-lisans-guvenlik.md) | Veri paylaşımı, lisans, güvenlik ve yayın |
| [`07-ozellik-dokumu.md`](paperclip-incelemesi/ara-raporlar/07-ozellik-dokumu.md) | Özellik dökümü ve sürüm geçmişi |

Ara raporlar bu belgeden önce ve Agent Office'in yalnızca `CLAUDE.md` dosyası okunmuşken yazıldı; Agent Office'e ilişkin notları eskidir. Paperclip hakkında bu belgede düzeltilen üç nokta (soru kartının yeri, araç eylemi onay kartının içeriği, ajan simgeleri) raporlarda ilgili yere not olarak işlendi ve [`00-okuma-notu.md`](paperclip-incelemesi/ara-raporlar/00-okuma-notu.md) dosyasında listelendi. Çelişki olursa bu belge geçerlidir.

### 15.3 Paperclip doğrulama listesi

Aşağıdakiler ara raporlarla yetinilmeden, kaynak kodda ya da çalışan kurulumda tek tek denetlendi.

| Tespit | Kaynak |
|---|---|
| RLS, politika ya da kısıtlı rol yok | `packages/db/src` içinde arama; 226 tablo, 293 göç |
| Giriş yalnızca e-posta ve parolayla | `server/src/auth/better-auth.ts:273-277` |
| Telemetri adresleri | `packages/shared/src/telemetry/client.ts:14-17` |
| Telemetriyi kapatan ortam değişkeninin değeri tam olarak `1` olmalı | `packages/shared/src/telemetry/config.ts:71-85` |
| GitHub adresi açık metin olarak gönderilir | `cli/src/commands/client/company.ts:1867-1869` |
| Geri bildirim tercihi sunucuda denetlenmiyor | `server/src/routes/issues.ts:18365`, `server/src/services/feedback.ts:1943` |
| Lisans metni ve telif satırı | `LICENSE` |
| Soru ve onay kartlarını varsayılan olarak ajanlar da yanıtlar; bağlantı isteği, araç eylemi onayı ve gizli anahtar önerisi yalnızca insana açık | `server/src/services/issue-thread-interactions.ts:382-444` |
| Soru ve onay kartı, yazma kutusunun üstünde durur; kutu kullanılabilir kalır | `ui/src/components/task-chat/TaskChatComposer.tsx:1114-1186`, `DESIGN.md:73-76`; çalışan kurulumda görüldü |
| Araç eylemi onay kartı: logo, ön izleme, "Decline", "Approve & run", "Always allow" | `ui/src/components/IssueThreadInteractionCard.tsx:1690-1766` |
| Bağlanan uygulama bütün ajanlara açık | `packages/shared/src/app-definitions.ts:256-270` |
| İzin soruları atlanır; formda 1.000 tur | `ui/src/components/agent-config-defaults.ts` |
| Ajan başına 20 eş zamanlı çalışma | `packages/shared/src/constants.ts:77` |
| Araç eylemi onayı 60 dakikada geçerliliğini yitirir | `server/src/services/tool-gateway.ts:2381` |
| Şirket silme yalnızca üyeliği denetler | `server/src/routes/companies.ts:1356-1366` |
| Canlı olaylar süreç içi | `server/src/services/live-events.ts` |
| Kenar çubuğu ölçüleri | `ui/src/components/SidebarShell.tsx:15-18` |
| Durum renkleri | `ui/src/index.css:201-220` |
| Gelen kutusu sıra sabitleme süreleri | `ui/src/hooks/useInboxSortAttention.ts` |
| Çeviri dosyalarında yalnızca üçer metin var | `ui/src/i18n/locales/` (40 dosya) |
| Görev önceliği arayüzde gizli | `ui/src/lib/ui-flags.ts:22` |
| Ajan simgeleri sunucuda üretilen karakter çizimleri | `ui/src/components/AgentAvatar.tsx` |
| Markdown bileşeni dış adreslerdeki resimleri varsayılan olarak yükler | `ui/src/components/MarkdownBody.tsx:733` |
| `[` ve `]` kısayolları Ctrl basılıyken yok sayılır | `ui/src/hooks/useKeyboardShortcuts.ts:121-131` |
| Uyarı kaydı "hard stop" diye gösteriliyor | `ui/src/components/BudgetIncidentCard.tsx:52`; çalışan kurulumda görüldü |
| Şirket kodu Türkçe harfi atıyor | `server/src/services/issue-prefix.ts:29-32`; çalışan kurulumda görüldü: "Örnek Ofis" için "RNE" |
| Varsayılanların özerklik yönünde değişmesi | `releases/v2026.428.0.md`, `v2026.817.0.md`, `v2026.824.0.md`, `v2026.1001.0.md` |
| Taşınabilir parçaların boyutu ve bağımlılıkları | 73 dosya, 10.231 satır; bunun 26 dosyası ve 2.475 satırı `components/ui/`. İçe aktarılan 32 ek modül (6.958 satır). Paket lisansları kurulu paketlerden okundu |
| Kenar çubuğu satırının seçili durumdaki rengi | `ui/src/components/SidebarNavItem.tsx:131-132` (`bg-sidebar-accent`) |
| Tip kontrolü ayarları; `enum`, `namespace` ve parametre özelliği kullanımı | `ui/tsconfig.json`; `ui/src` içinde test dosyaları dışında arama (`api/response.ts:3`, `components/AgentConfigForm.tsx:2346`) |
| Taşınacak 43 dosyanın başvurduğu tasarım değişkenleri | 43 dosyada `--` ile başlayan adların sayımı; `apps/web/src/index.css` içindeki tanımlarla karşılaştırma |
| Göreve yazılan yorumun ajanı uyandırma koşulu | `server/src/services/issue-comment-wakeup.ts` |
| Durum rozetlerinde yazı ile dolgu arasındaki kontrast | `ui/src/index.css:2411-2420` içindeki iki kuraldan (açık ve karanlık tema) WCAG formülüyle hesaplandı |

### 15.4 Agent Office kaynakları

11 ile 14 arasındaki bölümlerde Agent Office hakkında söylenenlerin dayandığı dosyalar:

| Bilgi | Kaynak |
|---|---|
| Değişmez kurallar, yetki kapısı, araç sınıfları, tasarım dili, çalışma yöntemi | `CLAUDE.md` |
| Ekran listesi, modüller, sprintler, açılış tarihi, pilot ajanları ve yetki seviyeleri, roller, "İnsana sor" yolu | `docs/PLAN.md` |
| Yapılan ve sıradaki işler | `docs/KALAN-ISLER.md` |
| Arayüzün geçici olduğu | `docs/kararlar/2026-10-02.md`, karar 5 |
| Onay kaydının alanları, düzeltme döngüsü ve kararı kimin verebileceği | `docs/kararlar/2026-10-02.md`, karar 10; `supabase/migrations/20261003100600_approvals.sql` |
| Kayıt saklama: iz kaydında yalnızca kimlikler, ham içerik 90 gün | `docs/kararlar/2026-10-02.md`, karar 13 |
| Dış kaynaklı görevin ajana yalnızca insan eliyle atanabilmesi | `docs/kararlar/2026-10-02.md`, karar 8; `supabase/migrations/20261003100300_tasks.sql` |
| Taslak notun görünürlüğü | `docs/kararlar/2026-10-03.md`, karar 1 |
| Kodun ve arayüz metinlerinin dili | `docs/kararlar/2026-10-03.md`, karar 4 |
| Passkey isteyen onaylar ve dış kişiye kayıt açma | `docs/kararlar/2026-10-03.md`, karar 7; `docs/kararlar/2026-10-05.md`, karar 2 ve 4 |
| Görev, yorum, çalışma, araç çağrısı, bildirim ve iz kaydı tabloları; dış kişinin görebildikleri | `supabase/migrations/` altındaki `tasks`, `runs`, `approvals` ve `audit_log` göçleri |
| Mevcut kabuk, menü ve ekranlar | `apps/web/src/components/layout.tsx`, `lib/menu.ts`, `routes/` |
| Renk değişkenleri, karanlık tema ve shadcn eşlemesi | `apps/web/src/index.css` |
| Alan adları (`monthly_budget`, `note_versions`) | `docs/ad-sozlugu.md` |
| Kütüphane sürümleri ve tip kontrolü ayarları | `pnpm-workspace.yaml`, `apps/web/package.json`, `tsconfig.base.json`, `apps/web/tsconfig.app.json` |
| Araç sınıfları ve onay kuralları | `agents/tools.yaml` |
| Görev kartının alanları | `agents/A-TEK-2.yaml`, `agents/KOR-3.yaml` |
| Karar bekleyen sorular ve yanıt taslakları: M5, M13, M16, M17, M19, M21, M24, M25, M28, M29, M33, M46, M48, M54, N15, N26, N40, R12, R13, X1-4, X1-5, X1-6, X2-4 | `docs/SONRA.md`, `docs/SONRA-yanit-taslagi.md` |
| Koordinasyon katmanının tek giriş noktası olması, telefondan onay, ölçütler, ürünleşme | `docs/agent-office-tasarım-raporu.md` |
| Depo dışı: ajanların normal geliştirme için kod yazmayacağı, web panelin mobil uyumlu yapılmayacağı ve siber güvenlik birimi kurulacağı | Önceki konuşmalardan kalan proje notu; karar dosyalarında karşılığı yok |
