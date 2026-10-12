# GitHub bağlantısı kurulumu

Bu adımları kurucu GitHub'da ve kendi bilgisayarında yapar. Gizli olan tek şey uygulamaların anahtar dosyalarıdır (`.pem`): sohbete, depoya ya da loglara yazılmaz; yalnızca sunucunun gizli ayarlarına ve yerelde `.env` dosyasına girer. Kaynak: 8 Ekim kararları 19 ve 22, 12 Ekim kararları 12 ile 17 ve GitHub'ın resmî belgeleri (12 Ekim 2026'da okundu).

Panel bu kurulum bitene kadar da çalışır: Ayarlar, Bağlantılar sayfası "GitHub uygulaması ayarlı değil" der ve projelerde depo alanı görünmez.

## 1. Ne kurulur

- Arma DX ve Pillika GitHub'da iki ayrı kuruluştur ve ikisi de bağlanır (12 Ekim, karar 12). Her kuruluşta **ayrı bir GitHub uygulaması** oluşturulur: GitHub'da yalnızca kendi hesabına kurulabilen bir uygulama başka bir kuruluşa kurulamaz, yani Arma DX'in uygulaması Pillika'ya kurulamaz.
- Her uygulamanın kendi anahtarı vardır. Bir anahtar ele geçerse yalnızca o şirketin kuruluşu açılır; öteki şirketinki açılmaz. Panel bir şirketin anahtarını öteki şirket için hiç kullanmaz.
- Uygulama yalnızca okur: depo bilgisi, kod, değişiklik istekleri ve iş kayıtları (karar 14). Panel bugün kod okumaz; yalnızca son kod değişikliklerinin, açık değişiklik isteklerinin ve açık iş kayıtlarının listesini gösterir. Ama anahtarı ele geçiren biri o kuruluştaki bütün depoların kodunu okuyabilir; anahtar en değerli gizli değerdir.
- Uygulama kuruluştaki bütün depoları görür; her çalışan, kendi şirketinin kuruluşundaki bütün depoların adını görür (karar 15), GitHub'da o depoya yetkisi olmasa da.
- GitHub'dan panele bildirim gelmez, GitHub'da kimsenin kişisel anahtarı istenmez ve panel GitHub'a hiçbir şey yazmaz.
- **Her ortam için ayrı uygulama çifti** kurulur: bugün kurucunun bilgisayarı için iki uygulama; test sunucusu kurulunca iki tane daha; canlı ortamda iki tane daha. Böylece bir ortamın anahtarı ötekinde işe yaramaz. (Bu seçim kurucu onayı bekliyor: `docs/SONRA.md` P5-k.)

## 2. Önce bilinmesi gerekenler

1. İki kuruluşun GitHub'daki adı: adres çubuğunda `github.com/` sonrasında yazan ad, harfi harfine. Gizli değildir.
2. Kurucu iki kuruluşta da "owner" olmalıdır; uygulamayı kuruluşa yalnızca owner kurabilir.

## 3. Her kuruluşta uygulamayı oluşturmak (iki kez: önce Arma DX, sonra Pillika)

GitHub'da sağ üstte profil resmi, "Your organizations", kuruluşun yanındaki "Settings", solda "Developer settings", "GitHub Apps", "New GitHub App". Alanlar:

| Alan | Değer |
| --- | --- |
| GitHub App name | En çok 34 harf ve GitHub'da benzersiz. Örnek: "Arma DX Agent Office yerel", "Pillika Agent Office yerel". Ad alınmışsa başka bir ad yazın |
| Homepage URL | `http://localhost:5173`. GitHub kabul etmezse şirketin web adresi |
| Callback URL | Boş |
| Request user authorization (OAuth) during installation | Kapalı |
| Setup URL | `http://localhost:5173/github/setup`. GitHub kabul etmezse boş bırakın: kurulumdan sonra panele kendiniz dönersiniz, başka bir şey değişmez |
| Redirect on update | Kapalı |
| Webhook, "Active" | Kapalı |
| Repository permissions | Metadata, Contents, Pull requests, Issues; dördü de "Read-only". Başka hiçbir izin yok ("Organization permissions" ve "Account permissions" altında da) |
| Where can this GitHub App be installed? | "Only on this account" |

Test sunucusu için adlarda "test", adreslerde `https://office-test.armadx.com` yazılır; canlı ortam için `https://office.armadx.com`.

## 4. Anahtarı indirmek

1. Uygulamanın ayar sayfasında özel anahtar bölümünde ("Private keys" ya da "Credentials" altında "Key pairs") "Generate a private key" ya da "New key" düğmesine basın. Bilgisayara `.pem` uzantılı bir dosya iner. GitHub anahtarın yalnızca açık yarısını saklar; dosya yeniden indirilemez.
2. Aynı sayfada yazan "Client ID" değerini not alın (gizli değildir).
3. Sayfada anahtarın yanında bir parmak izi (SHA-256) yazar. İndirilen dosyanın doğru dosya olduğundan emin olmak isterseniz şu komutun çıktısını onunla karşılaştırın (komut anahtarı ekrana yazmaz, yalnızca parmak izini yazar):

```bash
openssl rsa -in ~/Downloads/DOSYA.pem -pubout -outform DER | openssl sha256 -binary | openssl base64
```

## 5. Uygulamayı kuruluşa kurmak

Uygulamanın sayfasında "Install App", kuruluşu seçin, **"All repositories"** seçin, "Install".

- Kurulumu panelden de başlatabilirsiniz: değerler `.env` dosyasına girildikten sonra Ayarlar, Bağlantılar sayfasındaki "GitHub'da kur" bağlantısı sizi aynı sayfaya götürür ve kurulumdan sonra o şirketin Bağlantılar sayfasına geri getirir.
- GitHub'dan dönüş hiçbir şeyi değiştirmez; bağlantı ancak 7. adımda, passkey ile yazılır.
- Bir müşterinin deposu panelde hiç görünmesin isterseniz bunu GitHub'da yaparsınız: kurulumda "Only select repositories" seçip o depoyu dışarıda bırakırsınız. Panel bunu kabul eder ve Bağlantılar sayfasında "yalnızca GitHub'da seçilen depoları görüyor" diye yazar. Kuruluşun sahibi bu seçimi GitHub'da sonradan da değiştirebilir (kuruluş ayarlarında uygulamanın "Repository access" bölümü); panel en geç beş dakika içinde yeni duruma uyar ve artık görmediği deponun listesini göstermez.
- Kuruluşa sonradan eklenen bir deponun uygulamaya kendiliğinden açıldığı GitHub'ın kurulum ekranında yazar, ama okuduğumuz belge sayfalarında yazmıyor. İlk kurulumdan sonra boş bir depo açılarak denenecek ve sonucu buraya yazılacak. (Henüz denenmedi.)

## 6. Değerleri yerelde `.env` dosyasına yazmak

`.env` dosyasını kendi düzenleyicinizde açın ve sekiz satırı doldurun (1 numaralı takım Arma DX, 2 numaralı takım Pillika):

- `GITHUB_APP_1_COMPANY=armadx`
- `GITHUB_APP_1_ORGANIZATION=` Arma DX kuruluşunun GitHub'daki adı
- `GITHUB_APP_1_CLIENT_ID=` Arma DX uygulamasının Client ID değeri
- `GITHUB_APP_1_PRIVATE_KEY=` anahtar, tek satır olarak
- `GITHUB_APP_2_COMPANY=pillika` ve Pillika için aynı üç satır

Anahtarı tek satıra çevirip panoya kopyalayan komut (anahtarı ekrana yazmaz):

```bash
base64 -i ~/Downloads/DOSYA.pem | tr -d '\n' | pbcopy
```

Sonra `.env` içinde eşittir işaretinden sonra yapıştırın ve panoyu boşaltın:

```bash
pbcopy < /dev/null
```

Bitince `.pem` dosyalarını parola yöneticisine koyun ve İndirilenler klasöründen silin. Bir takımın dört değeri birlikte doldurulur ya da dördü de boş bırakılır; yalnızca bir şirketin takımı doldurulabilir. `.env` git'e girmez. Değerler değişince API yeniden başlatılır (`pnpm dev`).

Test ve canlı sunucuda anahtar `.env` dosyasına değil, sunucunun gizli ayarlarına girilir; adımları sunucu işinde (KALAN-ISLER 0.7) yazılacak. Anahtarlar yalnızca API'nin ortamında durur; çalıştırıcının (worker) ortamına konmaz.

## 7. Panelde bağlamak

Önce Arma DX seçiliyken hesap menüsünden Ayarlar, Bağlantılar; "GitHub'ı bağla"; passkey. Sonra Pillika seçiliyken aynısı. İki bağlantı birbirinden ayrıdır; birinin passkey onayı ötekinde geçmez.

Bağlandıktan sonra:

- Proje açan herkes "Yeni proje" penceresinde "GitHub deposu" alanını görür ve bir depo seçebilir.
- Projenin sahibi, yöneticileri ve kurucu, proje sayfasının "GitHub" sekmesinden depoyu bağlar, değiştirir ve kaldırır.
- Projenin üyeleri "GitHub" sekmesinde o deponun son kod değişikliklerini, açık değişiklik isteklerini ve açık iş kayıtlarını, yazanların GitHub kullanıcı adlarıyla görür.

## 8. Sayfa bir sorun söylerse

Bir şey yanlışsa Bağlantılar sayfası neyin yanlış olduğunu söyler; `.env` dosyasını kimseye göstermeniz gerekmez.

| Sayfanın söylediği | Anlamı ve yapılacak |
| --- | --- |
| Bu ortamda ... için GitHub uygulaması ayarlı değil | O şirketin dört değeri `.env` dosyasında yok ya da `..._COMPANY` değeri şirketin kısa kodu değil (`armadx`, `pillika`) |
| GitHub uygulaması ... kuruluşuna henüz kurulmamış | 5. adım yapılmamış. Sayfadaki "GitHub'da kur" bağlantısını kullanın |
| Sunucudaki GitHub ayarı ... kuruluşunu bekliyor, ama uygulama ... kuruluşuna ait | İki şirketin değerleri yer değiştirmiş ya da kuruluş adı yanlış yazılmış. Panel başkasına ait uygulamayla bağlanmayı reddeder |
| Uygulama GitHub'da bir kuruluşa değil, bir kişinin hesabına ait | Uygulama kişisel hesapta oluşturulmuş. Kuruluşun içinde yeniden oluşturun (3. adım) |
| Uygulamanın GitHub'daki izinleri beklenenden geniş | Uygulamada yazma izni ya da dört iznin dışında bir izin var. Panel yalnızca dört okuma izniyle bağlanır |
| Uygulama GitHub'da durdurulmuş | Kuruluş ayarlarında uygulama "Suspend" edilmiş. GitHub'da yeniden açın |
| GitHub uygulamasının anahtarı kabul edilmedi | Anahtar yanlış, eksik yapıştırılmış ya da GitHub'da silinmiş. 4. ve 6. adımı yeniden yapın |
| Bu GitHub kuruluşu başka bir şirkete bağlı | Bir kuruluş yalnızca bir şirkete bağlanır. Değerleri denetleyin |
| GitHub bağlantısı çalışmıyor: uygulama GitHub'da kaldırılmış ya da durdurulmuş | Uygulama kaldırılıp yeniden kurulduysa yeni bir kurulum numarası alır: önce "Bağlantıyı kes", sonra "GitHub'ı bağla" (passkey yeniden sorulur). Projelere bağlı depolar silinmez |

## 9. Bağlantıyı kesmek ve uygulamayı kaldırmak

- "Bağlantıyı kes" yalnızca o şirketin bağlantısını keser; onay sorar, passkey istemez. Projelerdeki GitHub sekmeleri boş kalır ve yeni projede depo seçilemez. Projelere bağlı depolar silinmez; aynı kuruluşa yeniden bağlanınca geri gelir.
- Bağlantıyı kesmek uygulamayı GitHub'dan kaldırmaz ve anahtarı geçersiz kılmaz: kesilen şey panelin GitHub'a sormasıdır. Tamamen kaldırmak için GitHub'da kuruluş ayarlarından uygulamayı kaldırın ve anahtarını silin.
- Bir şirket bir kuruluşa bağlandıktan sonra panelden başka bir kuruluşa bağlanamaz (`docs/SONRA.md` P5-d).

## 10. Anahtarı değiştirmek

Anahtarın ele geçtiğinden kuşkulanılırsa ya da düzenli yenileme için:

1. Uygulamanın ayar sayfasında **önce yeni** bir anahtar oluşturun (bir uygulamanın son anahtarı, yenisi olmadan silinemez; bir uygulamada en çok 25 anahtar durabilir).
2. Yeni anahtarı 6. adımdaki gibi yerine koyun ve API'yi yeniden başlatın.
3. Bağlantılar sayfası sorun yazmıyorsa eski anahtarı GitHub'da silin.

Panelde yeniden bağlamak gerekmez: bağlantı kaydı anahtarı tutmaz, yalnızca kurulumun numarasını ve kuruluşun adını tutar.

## 11. Gerçek GitHub ile henüz denenmeyenler

Bu adım, uygulamalar oluşturulmadan önce sahte bir GitHub ile kuruldu ve sınandı. İlk gerçek kurulumdan sonra denenecekler:

- Kuruluşa sonradan eklenen deponun listeye kendiliğinden girip girmediği (5. adım).
- Boş bir depoda "Son kod değişiklikleri" listesinin ne yazdığı (bugün boş depoda "Bu liste okunamadı" yazabilir).
- GitHub'ın `http://localhost:5173` adreslerini Homepage URL ve Setup URL olarak kabul edip etmediği.
- Kurulumdan sonra GitHub'ın tarayıcıyı panele `state` değeriyle döndürüp döndürmediği (döndürmezse panel, oturumdaki şirketin Bağlantılar sayfasını açar).
