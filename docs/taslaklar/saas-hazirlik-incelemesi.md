# Agent Office başka firmalara açılırsa: sistem neye hazır, neye değil

12 Ekim 2026. Bu bir salt okunur incelemedir; depoda hiçbir şey değiştirilmedi. Ürün konusunda verilmiş bir karar yok; rapor yalnızca bugünkü sistemin neye ihtiyaç duyacağını söyler. Maddelerin sonundaki kodlar ekteki kanıt satırlarını gösterir.

## Kısa yanıt

Temel doğru kurulmuş: her şirketin verisi ayrı tutuluyor, şirket her istekte ve her ajan çalışmasında yeniden kuruluyor, kurucu rolü şirket başına veriliyor ve herkes tek adresten girip şirketini sonra seçiyor; bunlar kaç firma olursa olsun aynı çalışır. Ama "kolayca" bugünkü haliyle doğru değil. Üçüncü bir firmayı bugün panelden kimse açamaz; firma kendi ajanını, kendi GitHub bağlantısını ve kendi ayarını geliştirici olmadan kuramaz, çünkü pilot bilerek iki şirkete ve tek kurucuya göre daraltıldı (şirket adları kart dosyalarında, anahtarlar sunucunun ayarlarında, şirketi açan şey başlangıç verisi). Eksiklerin çoğu sonra da aynı bedelle yapılır; yalnızca altı konu şimdi ucuz, sonra pahalı ve bunların dördü bir kural ya da tasarıma eklenecek birkaç cümle, ikisi birkaç günlük iş.

## Şimdi yapılırsa ucuz, sonra pahalı olanlar

### 1. GitHub bağlantısı

Bugün her kuruluş için elle bir GitHub uygulaması oluşturuluyor, anahtarı sunucunun ayarlarına yazılıyor ve sunucuda yalnızca iki yer var (Arma DX ve Pillika). Üçüncü bir firma için kod değişikliği, yeni bir sürüm ve sunucunun yeniden başlaması gerekir; firma bunu kendi panelinden yapamaz. Sorduğun şey tam olarak bu ve yanıtı: bugünkü haliyle hayır.

Olması gereken, firmanın kendi Ayarlar sayfasından kendi kuruluşunu bağlaması. Bunun iki yolu var; ikisi de soru 2'de. Bağlantının geri kalanı (şirket başına tek kayıt, passkey ile bağlama, proje deposu, GitHub sekmesi) olduğu gibi kalır ve veri taşımak iki yolda da gerekmez.

Şimdi değiştirmek birkaç günlük iş (tek ortak uygulama seçilirse haftalar). Sonra değiştirmek aynı iş, üstüne şunlar: elle oluşturulmuş uygulamalar çöpe gider (üç ortamda altıya kadar), her şirket bir kez yeniden bağlanır, kurulum belgesi yeniden yazılır ve ajanların kod yazması (adım 7) bu yapının üstüne kurulmuşsa o da yeniden yapılır. Dürüst olmak gerekirse artış haftalar değil günler; incelemeyi yapanlardan biri aynı konuyu "bekleyebilir" diye değerlendirdi. Asıl son tarih şu: test sunucusunun uygulamaları elle oluşturulmadan ve adım 7 başlamadan önce. Henüz elle hiçbir uygulama oluşturulmadı. (BAG-2, BAG-12, EYI-02, F3)

### 2. Bir firmaya ait gizli anahtar ve ayar nerede durur

Bugün bunun yazılı bir kuralı yok. GitHub anahtarı sunucunun ayarlarında duruyor; kod ajanının ön planı yazma anahtarını yine oraya koyuyor; Drive bağlantısında nerede duracağı hiçbir yerde yazmıyor.

Kural şu olur: bir firmaya ait gizli anahtar ya da ayar sunucunun ayarlarına, AWS'deki kasaya ya da depodaki bir dosyaya girmez; firmanın kendi kaydında durur ve firma onu panelden yazar. Bizim kendi anahtarlarımız (veritabanı şifreleri, model anahtarı) sunucuda kalır; kural onlara dokunmaz.

Kuralı koymak bedava. Koymazsan sıradaki her bağlantı iki şirkete göre kurulur ve sonra tek tek sökülür. Bilmen gereken bir eksik: saklanan gizli bilgiyi şifreleyen parça bugün hiç yok; ilk ihtiyaçta yapılacak (orta büyüklükte bir iş). (EYI-02, BAG-1, SONRA U-a)

### 3. Haber ajanının kaynak listesi

Tasarım her şirketin izinli kaynak listesini depodaki bir dosyada tutuyor; listeyi geliştirici değiştiriyor ve panel "panelden değiştirilemez" diyor. Tasarımın kendisi bunun 1 Ekim karar 4'ten ("şirkete özel ayarlar veritabanında durur") ayrıldığını söylüyor ve sana soruyor.

Olması gereken: liste yalnızca şirketin kendi kaydında durur, o şirketin kurucusu küçük bir formdan değiştirir ve her değişiklik kişinin adıyla iz kaydına girer.

Kazanç mütevazı: dosya yolu kurulup sonra sökülürse yaklaşık bir günlük iş çöpe gider, form ise dosyadan daha fazla iş ister (birkaç gün). Şimdi sormamın nedeni, bunun tasarımdan kurulacak sıradaki iş olması ve kurulumun senin yanıtını beklemesi. Bir not: `docs/taslaklar/haber-ajani-on-plan.md` listeyi şirketin ajan ayarına koyuyor, `docs/SONRA.md` U-c ise "depodaki dosya" diyor; ikisi birbirini tutmuyor. (BAG-11, F5, R4)

### 4. Depoda yalnızca yöntem durur

Bugün depo temiz: skill dosyalarında yalnızca yöntem var. Ama iki skill dosyasının başında, senin gerçek taleplerinin ve onaylanmış gönderilerinin ileride bu dosyalara ekleneceği yazıyor.

Bu dosyalar her firmanın ajanına verilen ortak metindir. Arma DX'in ya da Pillika'nın örneği oraya girerse başka firmanın ajanına da gider, sürüm geçmişinde kalır ve gerçek modelle ölçülerek ayarlanmış metinlerin yeniden yazılıp yeniden ölçülmesi gerekir.

Kural bedava: kartlar, skill'ler ve ortak kurallar yalnızca yöntemi tutar; bir firmaya ait örnek, şablon, marka sesi ve liste o firmanın kaydında durur. Marka sesi skill'i bunu zaten böyle söylüyor. Örnekleri ajana veren parça ilk örnek geldiğinde yapılır, bugün değil. (R3, F5)

### 5. Koordinatörün iki şirketi kapsayan talebi

Henüz kurulmamış tasarımda koordinatöre (KOR-1) talep sahibinin üyesi olduğu şirketler veriliyor ve koordinatör "öteki şirketler için kurucuya öneri" bırakıyor. Tek kurucunun iki şirketinde bu zararsız.

Birbirinden bağımsız firmalarda ise A firmasındaki bir çalışma, kişinin B firmasına da üye olduğunu öğrenir ve kaydeder; çalışma ve iz kayıtları sonradan silinemediği için bu geri alınamaz ve o adım yeniden kurulur.

Şimdi düzeltmek iş listesinde ve kartta birer cümle: çalışma yalnızca kendi şirketini görür; öteki şirket için öneri kişiye, çalışmanın dışında ve yalnızca o kişinin üyesi olduğu şirketler için sunulur. (kimlik K9)

### 6. Kod yazan ajanın tasarımı

Tasarım henüz yazılmadı. Ön plan GitHub'a yazma anahtarını sunucunun ayarlarına koyuyor ve şirketi düz yazıyla sayıyor ("ajan önce yalnızca Arma DX'te açılır").

Tasarıma şimdi girecek üç cümle yeter: yazma yetkisi şirketin kendi bağlantı kaydından alınır; "bu depo ajana açık" işareti projenin depo kaydında durur; "önce yalnızca Arma DX" kartta bir şirket adı değil, şirketin ajan düğmesidir.

Yoksa sunucuda şirket adı taşıyan ikinci bir anahtar takımı oluşur ve sonra ikisi birden sökülür. Bu madde soru 2'nin yanıtıyla birlikte kararlaştırılmalı. (ajan K2, BAG-12)

## Bekleyebilecekler

Bunların hiçbirinde bugün kurulan bir şey sonradan pahalanmıyor. "İlk dış firmadan önce" yazanlar, başka bir firma sisteme girmeden bitmiş olmalı; ötekiler ürünün ne olacağına bağlı.

### Yeni bir firmayı açmak ve yönetmek

- Şirketi ve ilk yöneticisini açmak: bugün yalnızca başlangıç verisiyle ya da elle yazılan veritabanı komutuyla olur; davet yalnızca çalışan ve dış kişi taşır, yani yeni firmanın ilk yöneticisini kimse davet edemez. Kurulumu yapanın çalıştırdığı denetlenmiş bir komut küçük iş, paneldeki bir sayfa orta. İlk dış firmadan önce. (kimlik K3, F11, EYI-07)
- Ajanların yeni şirkete açılması: her kart hangi şirketlerde açılabileceğini şirket koduyla sayıyor. Üçüncü firma boş bir ofis görür ve koordinatörü bile açamaz. Kartın "her şirket" diyebilmesi küçük ile orta arası bir iş; ilk dış firmadan önce, doğal zamanı 1.2 adımı. (kimlik K1, F1, R1)
- Kurulumun sahibi ile firmanın yöneticisi ayrı roller değil: bir firmanın üstündeki her iş (kurucunun kaybolan passkey'i, iki firmaya üye bir kişinin hesabı, kişisel veri silme) veritabanı şifresini tutan kişiye, yani sana düşüyor ve kimin yaptığı kaydedilmiyor. Dört beş denetlenmiş ve kayıt bırakan işlem orta iş; ayrı bir yönetim paneli istenirse büyük. (kimlik K5, EYI-13)
- Kurucu rolünü vermek ve devretmek: panelden yapılamıyor; firma ikinci bir yönetici ekleyemez, ayrılanın yerine yenisini koyamaz. Orta. (kimlik K4)
- Davetin kabulü: davet, kişinin bir sonraki girişinde kendiliğinden üyeliğe dönüyor. Bağımsız firmalarda bir firma, başka firmanın çalışanını davet ederek o firmanın kurucusunun o hesap üzerindeki yetkisini (hesabı kapatma, passkey sıfırlama) düşürür. Orta; ilk dış firmadan önce. (kimlik K10)
- Kurucu alanı ve metinler: Kurucu alanı tek satır ve kimin olduğu yazmıyor; panelin açıklaması iki şirketin adını taşıyor; ortak kartlarda onaylayıcı yerine "kurucu" yazıyor. Küçük işler; kart metinleri orta, çünkü her değişiklik yeni kart sürümü ve yeniden ölçüm demek. (kimlik K8, R10, kimlik K13, F8)

### Ajanların firmaya göre ayarı

- Birimler: birim listesi herkes için tek ve Arma DX raporundaki düzeni taşıyor. Yeni firma 18 ortak birimle çalışabilir, ama birim gizleyemez, adını değiştiremez, yenisini ekleyemez. Firmanın kullandığı birimlerin listesi orta; firmanın kendi birimleri büyük ve ürünün ne olacağına bağlı. (kimlik K2, F2, R2)
- Ajan ayarları ve onaylayıcı ekranı: firma ajanı yalnızca açıp kapatabiliyor; ayar ekranı ve onaylayıcı atama ekranı yok, altyapısı hazır. Orta; 1.2 adımında zaten planlı. (F9, R5)
- Firmanın kendi kartını yazması: bugün kartlar yalnızca depodan gelir. Yalnızca ürün firmalara kendi ajanını yazdıracaksa gerekir; büyük. (F13)
- Dil ve saat: her şey Türkçe ve saat İstanbul. Türkiye'de Türkçe çalışan firma için yapılacak bir şey yok; başka dil büyük, saat dilimi küçük. (F15, F12)

### Para ve paylaşılan kaynaklar

- Şirket başına harcama tavanı: tavan bugün yalnızca proje başına; proje dışındaki talebin hiç tavanı yok ve herkes tek model anahtarından harcıyor. Şirket tavanı küçük ile orta arası; ilk dış firma ajan çalıştırmadan önce şart, çünkü harcanan senin paran. (F14, BAG-9, R6, EYI-11)
- Kim öder: tek model hesabı var; bir firma sınırı doldurursa herkesin işi durur. Firma kendi anahtarını mı getirir, sen mi ödeyip faturalarsın, bu bir fiyat kararı. Orta. Kullanım şirket başına zaten kaydediliyor; firmaya gösteren özet ekranı orta. (R7, EYI-16)
- İş kuyruğu: tek kuyruk, ilk gelen ilk çalışır, aynı anda en çok 8 iş (varsayılan 2). Bir firmanın yoğunluğu ötekileri bekletir; bu veri güvenliği değil, bekleme süresi konusu. Küçük ile orta arası. (R8, EYI-11)
- Dosya alanı: şirket başına toplam sınır yok. Küçük. (BAG-10)

### Giriş ve bağlantılar

- İki adımlı doğrulama: şirket alan adları sunucunun ayarında duruyor ve yalnızca senin iki Workspace'in için güvenilir sayılıyor. Başka firmanın çalışanı "dış kişi" yolundan girer; bu yol Google'ın gönderdiği iki adım bilgisine dayanıyor ve henüz gerçek hesaplarla denenmedi. Önce o deneme (zaten listede); gerisi küçük. (kimlik K6, F7, BAG-6, EYI-05)
- Yalnızca Google: Google Workspace ya da Gmail kullanmayan firma kendi adresleriyle giremez. İkinci bir giriş yolu orta ile büyük arası; ürünün kime satılacağına bağlı. (kimlik K7, BAG-7, EYI-06)
- Drive, Gmail ve Takvim bağlantısı: henüz kurulmadı. Kurulurken şirket başına kurulmalı: bağlantı bilgisi firmanın kaydında, bağlayan kişi o firmanın yöneticisi. Şimdi 1.4 adımına bir not küçük, kurulumun kendisi orta. (F4, BAG-8, BAG-1)
- GitHub'ın kalanları: firma bağladığı kuruluşu panelden değiştiremiyor (küçük); github.com dışındaki GitHub adresleri desteklenmiyor (orta, isteyen olursa). Tek ortak uygulama seçilirse, kurulumun gerçekten o firmaya ait olduğunu kanıtlayan bir parça da gerekir (orta). (BAG-4, BAG-5, BAG-3)
- Panelin adresi: passkey'ler adrese bağlı. Herkes office.armadx.com'da kalacaksa yapılacak bir şey yok; ürün kendi adını alacaksa bu, dış firmalar passkey kaydetmeden önce seçilmeli. (EYI-03)

### Firma ayrılırken, hukuk ve işletme

- Firmanın ayrılması: firma verisini alamıyor, sildiremiyor, kapatılamıyor bile; iz kaydı ve çalışma kayıtları silinmeyecek biçimde kurulu. Neyin verilip neyin saklanacağı avukatın kararı. Büyük; başka bir firmayla ilk sözleşmeden önce. (kimlik K12, EYI-08, BAG-10)
- Hukuki belgeler: başka firmalar için veri işleyen olursun; veri işleme sözleşmesi, alt işleyenlerin listesi, yurt dışına aktarımın dayanağı, aydınlatma metni ve ihlal usulü gerekir. Büyük ve avukat işi. Şimdi bedava olan tek şey, avukata giden soruya "bunu başka firmalar için barındırırsak" cümlesini eklemek. (EYI-14)
- Her firmanın verisine kim ulaşabilir: yazılı bir liste ve yetkili erişimin kaydı yok; AWS hesabında başka kimin yetkisi olduğu bilinmiyor. Test sunucusu olduğu yerde kalabilir; canlı ortam kurulmadan önce kısa ve bilinen bir liste gerekir. Küçük ile orta arası. (EYI-12, EYI-01)
- Yedek ve loglar: bütün kurulum için tek. Bir firmanın verisini yedekten ayırmak elle mümkün; yazılı usul küçük. (EYI-10)
- Ürünle ilgisi olmayan bir pilot borcu: 90 günlük ham içerik silme işi hiç çalıştırılmıyor ve iş listesinde yok. Küçük; ilk kayıtların süresi 5 Ocak 2027 dolaylarında dolar. (EYI-09)
- Verinin yeri: her şey Frankfurt'ta, model ABD'de. Verinin Türkiye'de kalmasını şart koşan bir kurum ortak kurulumdan hizmet alamaz; ayrı kurulum büyük ve ürünün ne olacağına bağlı. Kod ajanının ikinci yolu tasarlanırken "her çalışmaya ayrı kutu, hiçbir şey ortak değil" cümlesi yeter. (EYI-15, ajan K3)

## Bugünkü kurallarla çelişenler

Bunlar hata değil; pilot için senin verdiğin kararlar. Ürün olursa hangisinin değişeceğine sen karar verirsin.

- Kural 8 (`CLAUDE.md`; `docs/PLAN.md` "Ağ ve erişim kuralları"): panel ileride yalnızca ofis ağından ve VPN ile açılacak. Bütün firmalar tek adresi kullanacaksa ikisi birlikte olmaz. Aynı soru pilot için de açık (`docs/SONRA.md` M54) ve kural için henüz hiçbir şey kurulmadı. (kimlik K11, EYI-04)
- 12 Ekim karar 12 ve SONRA P5-p (`docs/kararlar/2026-10-12.md`, `docs/SONRA.md`): her kuruluşa ayrı, özel bir GitHub uygulaması. Tek ortak uygulamaya geçmek bu seçimi geri alır; firmaya kendi özel uygulamasını kurdurmak seçimin gerekçesini (kuruluş başına tek anahtar) korur. (BAG-2, F3)
- Kural 2 (`CLAUDE.md`): ortak tablolar şirket verisi tutmaz. Bugün tek bir şirkete ait birimler ve o şirkete özel kartın metni bu tablolarda duruyor; ayrımı yalnızca API yapıyor. (kimlik K2)
- Kartların ve skill'lerin asıl kaynağı depodur, değişiklik depoda yapılır (`CLAUDE.md` "Ajanlar, skill'ler ve notlar"; 1 Ekim karar 4): firma kendi kartını yazacaksa çelişir, hazır kataloğu kullanacaksa çelişmez. (F13)
- 1 Ekim ikinci tur karar 5 (`docs/kararlar/2026-10-01.md`) ve `docs/PLAN.md` satır 86 ("Kurucu: bütün şirketleri görür"): ikisi de tek kişinin her şirketin kurucusu olduğunu varsayar. Kod rolü zaten şirket başına veriyor. (kimlik K9)
- Kural 3 ve 3 Ekim karar 8 (`CLAUDE.md`, `docs/kararlar/2026-10-03.md`): giriş Google hesabıyla; şirket hesaplarında iki adım Workspace yönetici ayarıyla zorlanır. İkinci cümle senin o Workspace'in yöneticisi olmana dayanıyor; başka firmanın ayarını buradan kimse denetleyemez. Google kullanmayan firma için bu bir çelişki değil, kime hizmet verilebileceğinin sınırı. (kimlik K6, kimlik K7)
- 3 Ekim karar 9 ve 5 Ekim karar 3: yalnızca çalışan ve dış kişi davet edilir; kurucunun kaybolan passkey'i veritabanı yönetimiyle sıfırlanır. Bağımsız firmalarda ilk yöneticiyi içeri alacak ve kurtaracak bir yol gerekir. (kimlik K3, kimlik K5)
- 12 Ekim karar 20, 25 ve 26: şirketin var olan AWS hesabı; AWS'ye ve sunucuya yalnızca kurucu girer; canlı veritabanının en güçlü şifresi yalnızca kurucuda. İki şirketin sahibi için yerinde; başka firmaların verisi geldiğinde "veriye kim ulaşabilir" sorusunun yanıtı bunlar olur. (EYI-01, EYI-12)
- 7 Ekim karar 12 ve 8 Ekim karar 32: model çağrıları tek anahtarla ve tek harcama sınırıyla. Dış firma olunca herkes aynı hesaptan harcar. (R7)
- 8 Ekim karar 5, 21 ve 26, 12 Ekim karar 16 ve `CLAUDE.md`'deki "avukatın görüşü gelene kadar" kuralı: bunları verinin sahibi olarak sen verdin. Başka bir firmanın verisi için aynı seçimleri o firma yapar. (EYI-14)
- 2 Ekim karar 14 ve `docs/PLAN.md` satır 17: veritabanı ve sunucu Frankfurt'ta; dış müşterilere kurulum kapsam dışı. Verinin Türkiye'de kalmasını isteyen kurumla çelişir. (EYI-15)
- "Pilotta arayüz yalnızca Türkçe" (`CLAUDE.md`): Türkçe çalışmayan firmayla çelişir. (F15)

## Zaten uyanlar

- Her şirketin verisi veritabanı düzeyinde ayrı; API ve çalıştırıcı kısıtlı rolle bağlanıyor ve şirketi her istekte ve her adımda yeniden kuruyor.
- Tek adres ve tek oturum bütün firmalar için çalışır: oturum kişiye aittir, şirket girişten sonra seçilir, bir kişi istediği kadar şirkete üye olabilir.
- Kurucu rolü şirket başına bir üyeliktir; hiçbir kural bir kişiyi her şeyin kurucusu saymıyor. Bir şirkette birden çok kurucu veritabanında zaten destekleniyor.
- Çalışan kodda hiçbir şirket adı yok; şirket bir kayıttır.
- Üye listesi, davetler, onaylayıcı ataması, ajanı açıp kapatma, yapay zekâ izni ve GitHub'ı bağlama, hepsi tek şirkete ve o şirketin kurucusuna bağlı.
- GitHub bağlantısının kaydı şirket başına ve içinde gizli bilgi yok; bir kuruluş iki şirkete bağlanamıyor; bağlamak passkey istiyor. İki yeni yolda da bunlar kalır.
- Her ajan çalışması şirketini, modelini, kart sürümünü ve maliyetini kaydediyor; şirket başına kullanım değişiklik yapmadan toplanabilir.
- Modele yalnızca o şirketin adı, talep ve o şirketin birimleri gidiyor; başka firmanın verisi bir isteme giremez.
- Dosyalar şirketin kimliğiyle başlayan yolda duruyor; tek depo kaç firma olursa olsun yeter.
- İş kuyruğunda ve loglarda yalnızca kimlikler var; içerik yok.
- Proje başına harcama tavanı ve yapay zekâ izni şirket başına çalışıyor; şirket tavanı için hazır bir örnek.
- Dış kişi rolü birkaç firmaya hizmet veren kişiye (muhasebeci, avukat) uyuyor: tek hesap, firma başına ayrı üyelik.

## Senden beklenen kararlar

### 1. Ürün olabilmek bundan sonra her tasarımın gözetmesi gereken bir ilke olsun mu?

- a) Evet. Sonuç: bundan sonra kurulan her şey buna göre tasarlanır (firmanın ayarı ve anahtarı kendi kaydında durur, bağlantıyı firma panelden kurar, depoya firmaya özel içerik girmez). "Bekleyebilecekler" öne çekilmez; yalnızca yeni işler doğru biçimde kurulur.
- b) Hayır, pilot iki şirket için sürsün. Sonuç: yukarıdaki altı konu iki şirkete göre kurulur ve ürün kararı verildiğinde yeniden yapılır.
- c) Henüz bilmiyorum, ama kapı kapanmasın. Sonuç: yalnızca bedava olan kurallar (madde 2, 4 ve 5) şimdi konur; GitHub ve kaynak listesi bugünkü tasarımla kalır.
- Önerim: a. Kuralların kendisi bedava ve sıradaki üç tasarımı (haber ajanı, Drive bağlantısı, kod ajanı) belirliyor.

### 2. GitHub bağlantısı

- a) Bugünkü gibi kalsın: her kuruluşa elle bir özel uygulama, anahtarı sunucuda. Sonuç: iki şirket için çalışır; her yeni firma için geliştirici gerekir; ürün olursa elle oluşturulan uygulamalar ve adım 7 yeniden yapılır.
- b) Her firma kendi özel uygulamasını kendi Ayarlar sayfasından kursun; anahtarı o firmanın kaydında şifreli dursun. Sonuç: birkaç günlük iş ve şifreli saklama parçası şimdi yapılır; kuruluş başına tek anahtar kalır (bir anahtar sızarsa tek kuruluş açılır); 12 Ekim karar 12'nin gerekçesi korunur; yazılan kodun büyük bölümü kalır.
- c) Herkesin kurabildiği tek bir uygulama. Sonuç: firma için en kolayı (tek tık); ama tek anahtar onu kuran bütün firmaların kodunu açar, uygulamayı tanımadığın kişiler de kurabilir, kurulumun kime ait olduğunu kanıtlayan yeni bir parça gerekir, iş haftalar sürer ve karar 12 geri alınır.
- Önerim: b. Firmanın kendi işini kendi yapmasını sağlıyor ve bugünkü güvenlik seçimini bozmuyor. İki not: GitHub'ın bu akışla ilgili bilgileri incelemede GitHub'ın kendi sayfalarından okundu ama yeniden denetlenmedi; ilk yerel deneme bunu gösterir. Yanıtın gelene kadar test sunucusunun uygulamaları elle oluşturulmasın ve adım 7 başlamasın.

### 3. Ekranı henüz olmayan bir firma ayarı nerede dursun (haber ajanının kaynak listesi)?

- a) Depodaki dosyada, tasarımdaki gibi. Sonuç: en hızlısı; listeyi geliştirici değiştirir, değişiklik kişi adıyla kayda girmez; ürün olursa yaklaşık bir günlük iş sökülür; 1 Ekim karar 4'ten ayrılır.
- b) Yalnızca veritabanında, şirketin kurucusunun kullandığı küçük bir formla. Sonuç: birkaç gün daha fazla iş; her firma kendi listesini kendi değiştirir, her değişiklik kişi adıyla kayda girer, hiçbir firmanın listesi depoda durmaz.
- Önerim: b. Kazanç büyük değil, ama soru 1'e "evet" dersen tutarlı olan bu ve aynı form ileride öteki ajan ayarlarına da temel olur.

### 4. Örnekler, şablonlar ve marka sesi nerede dursun?

- a) Kural konsun: depo yalnızca yöntemi tutar; bir firmaya ait örnek, şablon, marka sesi ve liste o firmanın kaydında durur. Sonuç: `CLAUDE.md`'ye bir satır, iki skill dosyasının başındaki cümle düzeltilir; örneklerin ajana verilmesi ilk örnek geldiğinde kurulur.
- b) Bugünkü gibi: örnekler skill dosyalarına eklenir. Sonuç: şimdi daha az iş; başka firma geldiğinde bu metinler ayıklanır ve yeniden ölçülür, eski sürümlerde kalır.
- Önerim: a.

### 5. İki şirketi kapsayan talepte koordinatör ne görsün?

- a) Çalışma yalnızca kendi şirketini görür; öteki şirket için öneri kişiye, çalışmanın dışında ve yalnızca o kişinin üyesi olduğu şirketler için sunulur. Sonuç: iş listesinde ve kartta birer cümle değişir; senin iki şirketin için davranış aynı kalır.
- b) Yazıldığı gibi kalsın: koordinatöre talep sahibinin üyesi olduğu şirketler verilir. Sonuç: bağımsız firmalarda bir firmanın kaydına kişinin öteki firması yazılır ve silinemez.
- Önerim: a.

### 6. Kural 8 (panel yalnızca ofis ağından ve VPN ile)

- a) Kural yeniden yazılsın: panel internete açık kalır; giriş, iki adımlı doğrulama ve passkey ile korunur (bugünkü durum). Sonuç: SONRA M54 de kapanır.
- b) Firma başına izinli adres listesi. Sonuç: birkaç günlük iş; yalnızca bir firma isterse gerekir.
- c) Şimdi karar verme; ürün kararına kadar ofis ağı kilidi kurulmasın. Sonuç: hiçbir iş çıkmaz, hiçbir yol kapanmaz.
- Önerim: c. Bütün firmaların office.armadx.com'u kullanacağından eminsen tutarlı yanıt a olur.

## Appendix: Evidence

One line per checked finding. Paths are relative to the repository root; migrations are under `supabase/migrations/`. "Scratch design" means a design file outside the repository that is not built. Facts read on outside pages by the first readers (GitHub app manifest flow, GET /user/installations, Google restricted-scope assessment, the `amr` claim) were not re-checked in this review; they are marked "outside fact not re-checked". The list of findings that could not be checked was empty.

Identity and roles (kimlik-ve-roller)

- kimlik-ve-roller/K1: agents/*.yaml:4; packages/shared/src/cards.ts:39,107; 20261003100200_agents_customers_projects.sql:25-40; 20261007100400_approvers.sql:64-68; packages/db/src/definitions.ts:288-314
- kimlik-ve-roller/K2: 20261003100100_global_and_identity.sql:52; supabase/seed.sql:36-54; agents/units.yaml:63-135
- kimlik-ve-roller/K3: supabase/seed.sql:9-13,52-80; 20261003100100_global_and_identity.sql:187; 20261003110200_invitations.sql:20,23,225
- kimlik-ve-roller/K4: apps/api/src/routes/members.ts:19-23,94-96; 20261003110000_identity_hardening.sql:116-147
- kimlik-ve-roller/K5: 20261005100000_outgoing_reset_grants.sql:640-700; apps/api/src/routes/members.ts:70-75; apps/web/src/components/security-settings.tsx:393; apps/api/src/routes/agents.ts:67; docs/kararlar/2026-10-12.md decision 26
- kimlik-ve-roller/K6: apps/api/src/env.ts:126-128; apps/api/src/auth/claims.ts:59-76; docs/google-kurulum.md:22; docs/SONRA.md G1
- kimlik-ve-roller/K7: apps/api/src/auth/claims.ts:67; 20261003110000_identity_hardening.sql:217
- kimlik-ve-roller/K8: supabase/seed.sql:12; agents/KOR-4.yaml:4; apps/api/src/env.ts:81; 20261003100100_global_and_identity.sql:59-65,97-112
- kimlik-ve-roller/K9: agents/KOR-1.yaml:24,30; docs/KALAN-ISLER.md:210,213,705,716,867; docs/PLAN.md:86
- kimlik-ve-roller/K10: 20261003110200_invitations.sql:353-377; 20261003100100_global_and_identity.sql:150-170; 20261005100000_outgoing_reset_grants.sql:478-491
- kimlik-ve-roller/K11: CLAUDE.md rule 8; docs/kararlar/2026-10-12.md last section; docs/SONRA.md M54; docs/PLAN.md:43
- kimlik-ve-roller/K12: 20261003100800_audit_log.sql:41-55; 31 foreign keys to office.companies without cascade; 20261003100300_tasks.sql:29,114
- kimlik-ve-roller/K13: apps/web/index.html:7; apps/web/public/manifest.webmanifest:4; apps/web/src/lib/users.ts:126; docs/PLAN.md:86

Settings in the repository and on the server (depodaki-ve-sunucudaki-ayarlar)

- depodaki-ve-sunucudaki-ayarlar/F1-card-company-list: agents/*.yaml:4; 20261003100100_global_and_identity.sql:24; 20261003100200_agents_customers_projects.sql:25-40; packages/db/src/office.ts:29; packages/db/src/requests.ts:1067; 20261007100400_approvers.sql:67; packages/db/src/definitions.ts:295-333
- depodaki-ve-sunucudaki-ayarlar/F2-unit-list-global: agents/units.yaml; supabase/seed.sql:17-55; 20261003100100_global_and_identity.sql:10-17; packages/db/src/definitions.ts:214-232; apps/worker/src/runner/run.ts:777-797
- depodaki-ve-sunucudaki-ayarlar/F3-github-app-in-env: apps/api/src/env.ts:94,150-157,359-376; .env.example:67-95; apps/api/src/github/index.ts:26-42; apps/web/src/lib/github/labels.ts:33-35; docs/github-kurulum.md:8-13; docs/SONRA.md:671,758
- depodaki-ve-sunucudaki-ayarlar/F4-google-connection-client: CLAUDE.md:95,98; docs/KALAN-ISLER.md:814-817; 20261003100700_stations_integrations.sql:38-58 (not built)
- depodaki-ve-sunucudaki-ayarlar/F5-company-knowledge-in-repo: CLAUDE.md:80; docs/KALAN-ISLER.md:960,963; docs/SONRA.md:58,78,759; docs/taslaklar/haber-ajani-on-plan.md:129; skills/brand-voice/SKILL.md:8
- depodaki-ve-sunucudaki-ayarlar/F7-company-email-domains: .env.example:38-40; apps/api/src/env.ts:128,247-252; apps/api/src/auth/claims.ts:59-77; docs/KALAN-ISLER.md:198
- depodaki-ve-sunucudaki-ayarlar/F8-texts-written-for-two-firms: agents/KOR-3.yaml:11,45; agents/A-TEK-2.yaml:12,45; agents/SOS-2.yaml:44; agents/TAS-6.yaml:42; agents/HAF-1.yaml:50; agents/A-KES-2.yaml:36; agents/P-IST-1.yaml:21; agents/tools.yaml:128
- depodaki-ve-sunucudaki-ayarlar/F9-no-per-company-agent-settings: 20261003100200_agents_customers_projects.sql:12-15; packages/db/src/requests.ts:1087-1092; docs/KALAN-ISLER.md:769; docs/SONRA.md:180,182
- depodaki-ve-sunucudaki-ayarlar/F11-opening-a-company: supabase/seed.sql:9-13,59-81; 20261003110200_invitations.sql:20; 20261003100100_global_and_identity.sql:187
- depodaki-ve-sunucudaki-ayarlar/F12-office-time-zone: packages/shared/src/tasks.ts:29; packages/db/src/requests.ts:22-24; apps/worker/src/runner/run.ts:946
- depodaki-ve-sunucudaki-ayarlar/F13-firm-authored-cards: CLAUDE.md:81; 20261003100100_global_and_identity.sql:28-40; packages/db/scripts/sync-definitions.ts:66-83
- depodaki-ve-sunucudaki-ayarlar/F14-one-model-key-no-company-cap: apps/worker/src/worker.ts:200-204; .env.example:104-108; 20261008102900_project_ai_spending_limit.sql; 20261003100200_agents_customers_projects.sql:15
- depodaki-ve-sunucudaki-ayarlar/F15-turkish-only: CLAUDE.md:88; agents/common-rules.md:56; apps/web/src/lib/dates.ts:12-30; apps/worker/src/runner/prompt.ts

Connections (baglantilar)

- baglantilar/BAG-1: apps/api/src/env.ts:94,150-157; apps/worker/src/env.ts:17; 20261003100700_stations_integrations.sql:37-47,81; 20261008103500_github_connection.sql:204,259; docs/KALAN-ISLER.md section 1.4
- baglantilar/BAG-2: docs/github-kurulum.md sections 3-6; apps/api/src/github/index.ts:26-41; apps/api/src/github/service.ts:26; apps/api/src/github/company.ts:253; apps/web/src/lib/github/labels.ts:35,62,74; docs/KALAN-ISLER.md:483-492; docs/SONRA.md U-b (GitHub app manifest flow: outside fact not re-checked; "90% kept" is an estimate)
- baglantilar/BAG-3: apps/web/src/lib/github/install.ts:8-19; apps/web/src/routes/_authed/github.setup.tsx:8-13; 20261008103500_github_connection.sql:184-187 (GitHub setup URL, /user/installations and the organisation-owner check: outside facts not re-checked)
- baglantilar/BAG-4: 20261008103500_github_connection.sql:342-348; apps/api/src/routes/github.ts otherOrganization(); docs/github-kurulum.md sections 9-10
- baglantilar/BAG-5: apps/api/src/github/http.ts:33; packages/shared/src/github.ts:19
- baglantilar/BAG-6: .env.example:40; apps/api/src/env.ts:126-128; apps/api/src/auth/claims.ts:59-76; docs/KALAN-ISLER.md:198; docs/google-kurulum.md:22
- baglantilar/BAG-7: CLAUDE.md rule 3; apps/api/src/auth/claims.ts:67; 20261003110000_identity_hardening.sql:217; 20261003110200_invitations.sql:249; apps/api/src/auth/provider.ts
- baglantilar/BAG-8: CLAUDE.md "Google Workspace ve dış servisler"; docs/KALAN-ISLER.md:814-815 (not built; Google restricted-scope assessment: outside fact not re-checked)
- baglantilar/BAG-9: apps/worker/src/env.ts:17; apps/worker/src/worker.ts:201-204; 20261008102900_project_ai_spending_limit.sql; 20261003100200_agents_customers_projects.sql:15; apps/worker/src/runner/run.ts:319; 20261003100400_runs.sql:25-30
- baglantilar/BAG-10: apps/api/src/env.ts:141-146; apps/api/src/files/storage.ts:13-23,47-50; 20261008103100_project_files.sql:43,113
- baglantilar/BAG-11: scratch design soru-ve-cok-ajan/parca-2/TASARIM.md sections 0.5, 4.2, 5.2, H-c, C8, question 8 (not built; no agents/sources.yaml, no agents/STR-6.yaml); docs/kararlar/2026-10-01.md decision 4; docs/SONRA.md U-c
- baglantilar/BAG-12: docs/KALAN-ISLER.md:492,515-516; docs/SONRA.md P5-i, P5-k; docs/kararlar/2026-10-12.md decisions 12, 13, 15

Access, release and operation (erisim-yayin-ve-isletme)

- erisim-yayin-ve-isletme/EYI-01: docs/kararlar/2026-10-12.md decisions 20, 25; scratch deployment design TASARIM.md section 8 (Y-a, N8) and 2.6 (not built)
- erisim-yayin-ve-isletme/EYI-02: apps/api/src/env.ts:94,150-157; 20261003100700_stations_integrations.sql:37-47; docs/github-kurulum.md; docs/SONRA.md U-a, U-b; scratch deployment design 2.6
- erisim-yayin-ve-isletme/EYI-03: apps/api/src/env.ts:213-221,292-299,334-338; .env.example:16-19
- erisim-yayin-ve-isletme/EYI-04: CLAUDE.md rule 8; docs/PLAN.md:41-49; apps/api/src/security.ts:42-46; docs/SONRA.md M54
- erisim-yayin-ve-isletme/EYI-05: apps/api/src/env.ts:128; apps/api/src/auth/claims.ts:59-76; docs/google-kurulum.md:18,22-23; docs/SONRA.md G1
- erisim-yayin-ve-isletme/EYI-06: CLAUDE.md rule 3; apps/api/src/auth/claims.ts:12,66-69; 20261003110000_identity_hardening.sql:217
- erisim-yayin-ve-isletme/EYI-07: supabase/seed.sql:8-13; docs/kararlar/2026-10-03.md decision 9; 20261003100200_agents_customers_projects.sql:24-35; docs/KALAN-ISLER.md:126
- erisim-yayin-ve-isletme/EYI-08: 20261003100800_audit_log.sql:43-55; 20261003110300_login_events.sql:41-59; 20261003100100_global_and_identity.sql:59-65; docs/SONRA.md:164 (N36)
- erisim-yayin-ve-isletme/EYI-09: docs/kararlar/2026-10-02.md decision 13; 20261003100400_runs.sql:42,68,195-228; packages/db/test/rules.test.ts:852 (only caller)
- erisim-yayin-ve-isletme/EYI-10: scratch deployment design 2.11, 2.12; docs/kararlar/2026-10-12.md decisions 23, 24; apps/worker/src/worker.ts:187-189
- erisim-yayin-ve-isletme/EYI-11: packages/db/src/queue.ts:58; apps/worker/src/worker.ts:152-155; apps/worker/src/env.ts:17,21-24; apps/api/src/files/store.ts:122-128; 20261008103100_project_files.sql:109-115; apps/api/src/security.ts:69-77
- erisim-yayin-ve-isletme/EYI-12: CLAUDE.md rule 9; 20261003100800_audit_log.sql:31-41; docs/kararlar/2026-10-12.md decision 25; scratch deployment design 2.6, 2.7, Y-k
- erisim-yayin-ve-isletme/EYI-13: 20261005100000_outgoing_reset_grants.sql:466-492,582; 20261003120100_step_up.sql:366-392
- erisim-yayin-ve-isletme/EYI-14: docs/SONRA.md X1-3, X2-2, N31; docs/kararlar/2026-10-08.md decisions 5, 21, 26; docs/kararlar/2026-10-12.md decision 16; apps/web/src/lib/projects/files.ts:229
- erisim-yayin-ve-isletme/EYI-15: docs/kararlar/2026-10-02.md decision 14; docs/PLAN.md:17; docs/SONRA.md R16 (138), N31 (112)
- erisim-yayin-ve-isletme/EYI-16: 20261003100400_runs.sql:30; packages/shared/src/models.ts:58; packages/db/src/projects.ts:345-408

Agent runs and waiting designs (ajan-calisma-ve-bekleyen-tasarimlar)

- ajan-calisma-ve-bekleyen-tasarimlar/R1: agents/*.yaml:4; 20261003100100_global_and_identity.sql:20-27; 20261003100200_agents_customers_projects.sql:24-41; packages/db/src/definitions.ts:242-249,311,329; packages/db/src/office.ts:29; packages/db/src/requests.ts:1067
- ajan-calisma-ve-bekleyen-tasarimlar/R2: agents/units.yaml:62-136; 20261003100100_global_and_identity.sql:11-18; apps/worker/src/runner/run.ts:787-799
- ajan-calisma-ve-bekleyen-tasarimlar/R3: skills/routing/SKILL.md:8,24,36; skills/social-content/SKILL.md:8; skills/brand-voice/SKILL.md:8; apps/worker/src/runner/prompt.ts:98-126; 20261003100100_global_and_identity.sql:49-52; agents/KOR-1.yaml:30
- ajan-calisma-ve-bekleyen-tasarimlar/R4: scratch design parca-2/TASARIM.md sections 0.5, 1.4, 3.2, 4.2, H-c, C8 (not built)
- ajan-calisma-ve-bekleyen-tasarimlar/R5: 20261003100200_agents_customers_projects.sql:7-17; apps/api/src/routes/agents.ts; packages/db/src/requests.ts:1050-1115; packages/db/src/office.ts:16; 20261007100400_approvers.sql
- ajan-calisma-ve-bekleyen-tasarimlar/R6: 20261008102900_project_ai_spending_limit.sql:1-40; apps/worker/src/runner/run.ts:522,824
- ajan-calisma-ve-bekleyen-tasarimlar/R7: apps/worker/src/env.ts:19; apps/worker/src/worker.ts:203-207; apps/worker/src/model/anthropic.ts:47-58; docs/kararlar/2026-10-07.md decision 12; docs/kararlar/2026-10-08.md decision 32
- ajan-calisma-ve-bekleyen-tasarimlar/R8: packages/db/src/queue.ts:58,129-136; apps/worker/src/worker.ts:152-160; apps/worker/src/env.ts:21-24
- ajan-calisma-ve-bekleyen-tasarimlar/R10: agents/KOR-4.yaml:4; supabase/seed.sql:12; apps/api/src/env.ts:81; agents/tools.yaml:34; agents/KOR-1.yaml:30; 20261003100100_global_and_identity.sql:58-64,98-112
- ajan-calisma-ve-bekleyen-tasarimlar/K2: scratch pre-plan kod-ajani-on-plan.md section 5; apps/api/src/env.ts:94,150-157; 20261008103500_github_connection.sql; 20261008103600_project_repositories.sql:33-46; docs/SONRA.md P5-i (design not written)
- ajan-calisma-ve-bekleyen-tasarimlar/K3: docs/kararlar/2026-10-08.md decisions 23, 29; scratch pre-plan kod-ajani-on-plan.md sections 2, 5 (not built)
