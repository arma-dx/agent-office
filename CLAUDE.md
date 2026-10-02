# Agent Office

Arma DX ve Pillika için şirket içi agentik ofis web paneli. Ekip panelden iş ister ve onay verir; ajanlar Claude API ile çalışır. Projenin asıl tasarımı `docs/agent-office-tasarım-raporu.md` dosyasında: birimler, ajan rolleri, yetki seviyeleri, tasarım ilkeleri, güvenlik, geçiş planı ve ölçütler. Geliştirme planı, veri modeli, ekranlar, modüller ve sprint görevleri `docs/PLAN.md` dosyasında; plan rapordan türetilir. Her işe başlamadan önce PLAN'daki ilgili bölümü, gerekiyorsa raporun ilgili bölümünü oku.

Rapor neyin ve neden yapılacağını, PLAN ve bu dosya nasıl yapılacağını söyler. Kurucu kararları `docs/kararlar/` altında tarihli dosyalarda; 1 Ekim kararları raporu pilot için daraltır (örneğin her çalışma tek şirket adına koşar, KOR-4 Kurucu özel alanında çalışır). Rapor ile PLAN ya da bu dosya arasında çözülmemiş bir çelişki görürsen kendin seçme, sor ve `docs/SONRA.md` dosyasına yaz.

## Yığın

- TypeScript (strict), pnpm çalışma alanları
- `apps/web`: React + Vite, TanStack Router, TanStack Query, shadcn/ui (Radix) ve Tailwind, formlarda react-hook-form ve zod. Telefona uyumlu (PWA).
- `apps/api`: Node.js + Fastify. Tarayıcının konuştuğu tek sunucu; giriş, yetki ve bütün veri istekleri buradan geçer.
- `apps/worker`: ajan çalıştırıcı. İş kuyruğunu tüketir, Claude API'yi araçlarla çalıştırır.
- `packages/shared`: ortak tipler ve zod şemaları. `packages/db`: veritabanı erişimi.
- Veritabanı: Supabase PostgreSQL, göç dosyaları `supabase/migrations` altında. İş kuyruğu PostgreSQL üzerinde (pg-boss).
- Claude API: `@anthropic-ai/sdk`.
- Testler: Vitest.
- Yayın: AWS'de tek sunucu, Docker Compose ile. Caddy HTTPS'i ve yönlendirmeyi yapar (`/` panelin derlenmiş dosyaları, `/api` Fastify); api ve worker ayrı servisler. Cloudflare önde DNS ve koruma katmanı.

## Alan adları

- `office.armadx.com`: panel ve `/api`, iki şirket için tek giriş; şirket girişten sonra seçilir
- `office-test.armadx.com`: test ortamı
- `hooks.armadx.com`: dışarıdan gelen bildirimler (Gmail, GitHub), imza doğrulamalı

## Değişmez kurallar

1. Tarayıcı veritabanına ve Supabase'e doğrudan bağlanmaz. Veritabanına yalnızca sunucu tarafı (API ve worker) bağlanır; tarayıcı hiçbir zaman. Supabase anahtarları yalnızca `apps/api` ve `apps/worker` ortamında durur.
2. Şirket verisi tutan her tabloda `sirket_id` zorunlu; kart tanımı ve araç kataloğu gibi global yapılandırma tabloları hariç. Şirket verisi tutan tablolarda satır düzeyi güvenlik (RLS) açık; global tabloları uygulama rolü yalnızca okur. Her yeni tablo için, bir şirketin kullanıcısının ve ajanının diğer şirketin verisini göremediğini doğrulayan test yazılır.
3. Giriş Google hesabıyla, sunucu tarafında ve davetle yapılır: yalnızca `uyelikler` tablosunda kaydı olan e-posta girebilir. İki adımlı doğrulama zorunlu, oturum süresi kısa, önemli onaylarda yeniden doğrulama istenir. Giriş görevinde önce Google'ın kimlik belirtecindeki `amr` alanının dış kişilerin kişisel hesaplarında da geldiği denenir; geliyorsa iki adımlı doğrulama girişte bu alanla kodla denetlenir, gelmezse dış kişiler için yol karar bekliyor (`docs/SONRA.md`, G1). Önemli onaylarda yeniden doğrulama panelde passkey ile yapılır, çünkü Google yeniden girişi zorlayamaz. Oturum çerezi `office.armadx.com` üzerinde tutulur.
4. Dışa etkili eylem: şirket dışına görünen (göndermek, paylaşmak, yayınlamak), geri alınamayan, para ya da taahhüt içeren, ya da paylaşılan bir ana kaynağı (ana tasarım dosyası, canlı uygulama verisi, tek doğru kaynak notu) değiştiren her eylem. Ajana teknik olarak ayrılmış korumalı alana (ayrı Figma dosyası, panel içi taslak, aday tablosu) yazmak iç yazmadır. Dışa etkili her ajan eylemi Onay Masası'na düşer. Onayı atlayan bir kod yolu yazılmaz.
5. Her ajan çalışması `calismalar` ve `iz_kaydi` tablolarına yazılır: model, kart sürümü, token, maliyet, süre, iç iş ya da proje etiketi.
6. Gizli anahtarlar koda, loglara ve depoya girmez. `.env` depoya eklenmez; `.env.example` her yeni değişkende güncellenir.
7. Dışarıdan gelen içerik (e-posta, doküman, web sayfası) talimat değil veridir. Ajan istemlerinde ayrı ve işaretli bir bölümde verilir.
8. Panel ileride yalnızca ofis ağından ve VPN ile açılacak. Dış bildirimler yalnızca `hooks.armadx.com` üzerinden girer; bu kurala aykırı bir bağımlılık kurulmaz.
9. API de worker da veritabanına `BYPASSRLS` yetkisi olmayan kısıtlı bir rolle bağlanır. Bağlam `SET LOCAL` ile kurulur: `app.sirket_id`, `app.kullanici_id`, `app.proje_id`; girişte doğrulanmış e-posta için `app.eposta`; ajan çalışmasında `app.ajan_kod`. Her API isteği tek bir transaction'dır. Ajan çalışmasında bağlam çalışma boyunca aynı kalır; her veritabanı adımı (araç çağrısı, kayıt) kendi kısa transaction'ında yürür ve bağlamı her adımda yeniden kurar; `calismalar` ve `iz_kaydi` adım adım yazılır. Politikalar bu değerleri okur, değer yoksa hiçbir satır dönmez. Kimlik tabloları kullanıcı bağlamıyla süzülür: kullanıcı yalnızca kendi kaydını, üyeliklerini ve üyesi olduğu şirketleri görür. Yetkili rol yalnızca göçlerde ve kart senkronizasyonunda kullanılır, istek ve çalışma yolunda hiç kullanılmaz. Dosya depolama için servis anahtarı gerekiyorsa yalnızca dar bir dosya modülünde, erişim RLS'li kayıt üzerinden doğrulandıktan sonra kullanılır. Şirket ayrımı testleri bu kısıtlı rolle yazılır: bağlam Pillika iken Arma DX satırı okunamaz, bağlam yokken hiçbir satır okunamaz.
10. pg-boss tabloları RLS dışında kaldığı için kuyruk işlerine yalnızca kimlik (id) konur, veri konmaz.
11. Şu işler hiçbir koşulda ajana bırakılmaz; bu işlerde ajan en fazla Y1'dir ve kural kodla uygulanır: para transferi, imza ve taahhüt, resmî kurumlara başvuru ve beyan, kişisel verinin silinmesi ya da üçüncü kişiye aktarılması.
12. Müşteri sözleşmesi AI kullanımına izin vermiyorsa o projede hiçbir ajan çalışmaz. İzin `projeler` kaydında ve müşteri düzeyinde `musteriler` kaydında tutulur. İzni olmayan müşteriye bağlı bütün kayıtlar ajan çalışmalarına kapalıdır. Çalıştırıcı her çalışmanın başında da denetler. Modele veri göndermeyen, yalnızca kodla çalışan sistem işleri (son tarih hatırlatması gibi) bu müşteride de sürer: model çağırmaz, bildirim metni sabit şablondan gelir, iz kaydına yazılır. Müşterinin sözleşmesi kodla yapılan otomatik işlemeyi de yasaklıyorsa ya da bu belirsizse (avukat görüşüne kadar) bu işler de durur.

## Şirketler, projeler ve görünürlük

- Her çalışma tek bir şirket adına koşar. Worker çalışmanın başında `sirket_id`'yi (varsa `proje_id`'yi de) bağlam olarak kurar; bütün araçlar bu bağlamla sınırlıdır. İki şirketi kapsayan bir talepte KOR-1 talebi açıldığı şirkette yürütür; diğer şirket için kurucuya tek dokunuşla açılacak bir görev önerisi bırakır (1 Ekim karar 1'in pilot değişikliği).
- İki şirketi birlikte görmek yalnızca kurucunun holding görünümünde, API'nin salt okunur birleştirmesiyle olur.
- Proje kapsamı: `gorevler`, `calismalar`, `onaylar`, `notlar`, `belgeler` ve `iz_kaydi` tablolarında boş bırakılabilir `proje_id`, ayrıca `proje_uyeleri` tablosu. `proje_id` doluysa satırı yalnızca proje üyeleri ve kurucu görür. Ajan çalışmasında görünürlük ayrıca daraltılır: proje bağlamı olmayan ajan çalışması hiçbir projenin proje kapsamlı satırını görmez, proje bağlamı olan çalışma yalnızca kendi projesinin satırlarını görür; çalışmanın kimliği kurucu olsa bile. Kartta `proje_baglami` alanı: `zorunlu` (yalnızca proje bağlamında koşar; A-KES-2), `varsa` (görevin ya da sorunun projesi varsa o bağlamda koşar; HAF-2'de proje sayfası ya da genel ekranda seçilen proje; A-TEK-2, A-PRJ-2, HAF-2), `proje_basina` (zamanlanmış çalışma her proje için ayrı ve proje dışı kayıtlar için bir kez koşar, olay ve talep çalışmaları tetikleyen kaydın projesiyle koşar; KOR-2, KOR-3, HAF-1). Proje çalışmalarının özetlerini (KOR-2 ve KOR-3'ün günlük özetleri, HAF-1'in haftalık raporu) kod birleştirir, model kullanılmaz; kurucuya şirket başına tek özet gider. HAF-2 proje sayfasından sorulan soruyu o projede arar; genel ekranda soruyu soran kişi proje seçebilir.
- Kurucuya özel alan: `sirketler` tablosunda `tur` alanı (`sirket`, `ozel_alan`) ve yalnızca kurucunun üye olduğu "Kurucu" alanı (kısa kodu `kurucu_alani`). KOR-4 bu alanda çalışır; e-posta özetleri ve taslaklar orada kalır. KOR-4 bir e-postadan şirket işi çıkarırsa görevi kendisi açmaz, öneri olarak sunar; kurucu tek dokunuşla ilgili şirkette açar.
- Çalışma kayıtlarının görünürlüğü bağlı olduğu görevden ya da projeden gelir.
- Raporda Ofis Koordinatörü ve Yönetici Asistanı yetki verilen kişiler için iki şirketi birlikte görebilir. Pilotta bu daraltıldı: her çalışma tek şirket adına koşar, iki şirketi birlikte görmek yalnızca kurucunun holding görünümünde.

## Durumlar ve roller

- Görev durumları: `acik`, `suruyor`, `onay_bekliyor`, `tamamlandi`, `iptal`
- Onay durumları: `bekliyor`, `onaylandi`, `duzeltme_istendi`, `reddedildi`
- Roller: `kurucu`, `calisan`, `dis_kisi`; yetkileri `docs/PLAN.md` içinde

## Ajanlar, skill'ler ve notlar

- Yetki seviyeleri raporda ve PLAN'da: Y0 danışman (yalnızca öneri ve rapor), Y1 taslakçı (onaysız dışarı çıkmaz, sisteme yazmaz), Y2 denetimli uygulayıcı (tanımlı sınır içinde kendisi uygular), Y3 otonom (yalnızca okuma ve izleme işlerinde).
- Y1 kapısı kodla uygulanır: Y1 ajan yalnızca korumalı alana (`taslak` sınıfındaki araçlar) ve kendi görevinin durumuna yazar; kendi görevinin durum geçişlerini çalıştırıcı yapar. `ic_yazma` sınıfındaki her çağrısı (bildirim, paylaşılan not, başka bir görevi güncelleme) onaya düşer; Y1'in `not_yaz` çağrısı notu taslak durumunda açar, not onaydan sonra paylaşılır. Görev açma Y1'de öneri olarak gelir (`gorev_oner`). Y2 ve Y3 kapıları ile çıktı türüne göre ayrı seviye karar bekliyor (`docs/SONRA.md`, M19).
- "İnsana sor": her ajan, her seviyede, sorusunu çalıştırıcının bu yoluyla ajanın sorumlusuna (kartta `sorumlu`) ya da talep sahibine iletir; bu yol Onay Masası'na düşmez. Eskalasyonlar ("kurucuya bildirir") da bu yoldan gider. Görevin yanıtı nasıl bekleyeceği modül M5'te netleşir.
- Her ajanın bir insan sorumlusu var (kartta `sorumlu`); sorumlu ajanı durdurabilir ya da işi devralabilir. Pilotta bütün sorumlular ve bütün onaylar kurucuda.
- Her ajan çalışması kendi ajan koduyla (`app.ajan_kod`) kaydedilir ve ajan yalnızca kartındaki araçları kullanır. Raporun "ajana özel servis hesabı" önlemi pilotta kısmen bu yolla karşılanır: ajanlar arasındaki ayrım kimlik bilgisi düzeyinde değil, kod düzeyindedir (kartın araç listesi, izin listeleri). Google tarafında servis hesabı kullanılmaz (aşağıda).
- Görev kartları `agents/<kod>.yaml`, skill'ler `skills/<ad>/SKILL.md` ve yanındaki `sablonlar/`, `ornekler/`, `testler/` klasörlerinde. Çalıştırıcı bunları okur; Claude API'ye skill yüklenmez.
- Kartların ve skill'lerin asıl kaynağı depodaki dosyalardır. Her yayında kartlar `kart_surumleri` tablosuna git commit kimliğiyle senkronize edilir; her çalışma hangi kart sürümüyle koştuğunu kaydeder. Panel kartları salt okunur gösterir (içerik, sürüm geçmişi, test sonuçları); değişiklik depoda PR ile yapılır.
- Ajan tanımı şirketten bağımsız ve ortaktır: `ajan_tanimlari` ve `kart_surumleri` global tablolardır (`sirket_id` yok, şirket verisi içermez, uygulama rolü yalnızca okur). Şirkete özel kısım `sirket_ajanlari` tablosundadır: `sirket_id`, `ajan_kod`, durum ve ayarlar (Drive klasörleri, öncelikli göndericiler, Figma çalışma dosyası, bütçe). Karttaki `sirketler` alanı, `sirket_ajanlari` satırının hangi şirketler için açılabileceğini sınırlar.
- Ajanların çağırabileceği araçlar `agents/araclar.yaml` kataloğunda. Araç sınıfları: `okuma`, `taslak` (ajana ayrılmış korumalı alana yazma), `ic_yazma` (paylaşılan kayda yazma), `dis_etki`. Bir kart yalnızca katalogdaki araçları kullanabilir; `dis_etki` sınıfındaki araçlar her çağrıda, `onay` alanı olan araçlar yazılı durumda, Y1 kartların `ic_yazma` çağrıları Onay Masası'na düşer (Y1'in `not_yaz` çağrısı notu taslak durumunda açar, not onaydan sonra paylaşılır). Çalıştırıcı kartı yüklerken bu kuralı denetler.
- Varsayılan modeller: sınıflandırma ve yönlendirme `claude-haiku-4-5-20251001`, genel işler `claude-sonnet-5-5`, zor işler `claude-opus-5-5`. Model adı koda gömülmez; görev kartı başka model yazıyorsa kart geçerlidir.
- Bir çalışmadaki araç çağrısı sayısı ve süre sınırı karttan okunur (varsayılan 20 çağrı ve 10 dakika). Sınır aşılırsa iş insana düşer.
- Her ajanın her şirket için bir durdurma düğmesi vardır; düğme `sirket_ajanlari` satırındadır. Paneldeki "her yerde durdur" iki şirketin satırını birden kapatır. Durdurulan ajan yeni iş almaz.
- Ajan çıktıları Türkçe; İngilizce ve Arapça çıktı istenebilir. Pilotta arayüz yalnızca Türkçe.
- Kurumsal hafıza Obsidian gibi çalışan markdown notlardır: YAML özellikler, `[[Not adı]]` bağlantıları, geri bağlantılar. Bağlantılar not kaydedilirken `not_baglantilari` tablosuna çıkarılır.

## Google Workspace ve dış servisler

- İki Google istemcisi kullanılır:
  - Giriş istemcisi: kullanıcı türü External, yalnızca `openid`, `email` ve `profile` kapsamları. Giriş davetle yapılır; dış kişiler kendi Google hesaplarıyla bu yoldan girer.
  - Bağlantı istemcisi: verisi okunacak Workspace kuruluşunda, kullanıcı türü Internal. Ajanlar Gmail, Takvim ve Drive'a bağlantıyı kuran kişinin (pilotta kurucu) kimliğiyle ve yalnızca `gmail.readonly`, `calendar.readonly`, `drive.readonly` kapsamlarıyla erişir. Token'lar şifreli saklanır, yalnızca worker kullanır. Drive'da okunabilecek klasörler kodda denetlenen bir izin listesiyle sınırlanır; liste `sirket_ajanlari` ayarlarındadır.
- Avukatın kişisel verinin yurt dışına aktarımı hakkındaki görüşü gelene kadar kişisel veri içeren kaynaklar bağlanmaz: Gmail, Takvim, Meet dökümleri, müşteri görüşme kayıtları ve kişisel veri içeren Drive klasörleri. İzin listesine yalnızca kişisel veri içermeyen şirket belgeleri girer.
- Servis hesabı ve alan genelinde yetki devri pilotta kullanılmaz; kuruluştaki herkesin adına işlem yapabildiği için fazla geniş.
- Arma DX ve Pillika ayrı Workspace kuruluşlarında. Pillika'nın Drive'ı da okunacaksa Pillika kuruluşunda ikinci bir bağlantı istemcisi açılır.
- Ajanlar Gmail'e yazmaz: `gmail.compose` istenmez, e-posta taslakları panelde saklanır; kullanıcı kopyalar ya da "Gmail'de aç" bağlantısıyla kendisi gönderir. Gönderme ileride `eposta_gonder` ile, `gmail.send` kapsamıyla ve her çağrıda onayla gelir.
- `figma_yaz` yalnızca ajana ayrılmış ayrı bir Figma dosyasına yazar; dosya kimliği `sirket_ajanlari` ayarlarındaki izin listesinden okunur, ana tasarım dosyası listede yer almaz. Tasarımı ana dosyaya taşımak insan işidir.

## Arayüz ve tasarım dili

- Ekran listesi `docs/PLAN.md` içinde. Günlük iş listeler, pano ve Onay Masası üzerinden yürür; telefonda alt menü: Bugün, Onaylar, Görevler, Notlar, Ofis.
- shadcn/ui yalnızca davranış ve erişilebilirlik için kullanılır. Varsayılan teması kullanılmaz, aşağıdaki değişkenlerle değiştirilir.
- Pilottaki arayüz geçicidir (2 Ekim kararı): ileride baştan ele alınacak; o zamana kadar aşağıdaki kurallar geçerli.
- Renk değişkenleri: zemin `#F6F7F9`, yüzey `#FFFFFF`, metin `#18202E`, ikincil metin `#5B6475`, çizgi `#DDE1E8`, form kutusu kenarlığı `#858E9E`, vurgu `#127A77` (önceki `#13807D` zemin üzerinde okunabilirlik eşiğinin altındaydı), hata `#C2412D`, onay bekliyor `#9A6412`. Karanlık tema aynı adlarla tanımlanır; değerleri `apps/web/src/index.css` içinde.
- Yazı: IBM Plex Sans, tek aile. Tablolarda rakamlar eşit genişlikte; başlıklar cümle düzeninde.
- Ayrım gölgeyle değil ince çizgi ve boşlukla yapılır. Köşe yuvarlaklığı küçük ve öğenin türüne göre tutarlı.
- Hareket yalnızca kullanıcının yaptığı işin sonucunu gösterir (onaylanan iş kuyruktan kayarak çıkar). Süs amaçlı giriş animasyonu yok; azaltılmış hareket tercihine uyulur.
- Metinler kısa ve somut Türkçe. Düğme ne yapıyorsa onu söyler (Onayla, Düzeltme iste); hata mesajı ne olduğunu ve nasıl düzeleceğini söyler; boş ekran ilk adımı gösterir.
- Kaçınılacaklar: mor ve mavi geçişli arka planlar, cam efekti, aynı gölgeli özdeş kart ızgaraları, büyük harfli üst etiketler, süs ikonları ve emojiler, düğme metinlerine eklenen oklar, ortadan noktalı meta dizgileri.
- Ofis görünümü (modül M15) izometrik iki boyutlu çizilir ve arayüzün tek cesur öğesidir; geri kalan her şey sade kalır.
- Her ekran telefonda çalışır, klavye odağı görünür, renk kontrastı en az WCAG AA.

## Kod ve adlandırma

- Veritabanı tabloları ve alanları `docs/PLAN.md` içindeki Türkçe ASCII adlarla yazılır (`gorevler`, `onaylar`). Genel teknik kod İngilizce olabilir.
- Arayüz metinleri Türkçe ve yazım kurallarına uygun. Uzun tire (—) kullanılmaz.
- Bütün girişler zod ile doğrulanır. Tip kontrolü, ESLint ve Prettier temiz olmadan iş bitmiş sayılmaz.
- Node TypeScript'i derlemeden çalıştırır: göreli içe aktarmalar `.ts` uzantısıyla yazılır; `enum`, parametre özellikleri ve `namespace` kullanılmaz (`erasableSyntaxOnly`).
- Yeni bağımlılık `pnpm-workspace.yaml` kataloğuna tam sürümle eklenir, `package.json` içinde `catalog:` yazılır. 24 saatten yeni sürüm kurulmaz; kurulum betiği isteyen paket yalnızca `allowBuilds` ile onaylanır.

## Komutlar

Gerekenler: Node 24.15 ya da üstü bir 24.x sürümü (`engines`: `^24.15.0`; `.nvmrc` en güncel 24'ü seçer) ve pnpm 12.8.1 (`packageManager`).

- `pnpm install`: bağımlılıkları kurar
- `pnpm dev`: bütün uygulamaları yerelde çalıştırır; panel `http://localhost:5173`, API `http://127.0.0.1:3000` (`.env`'deki `PORT`). Panel `/api/` isteklerini API'ye aktarır. Ortam değişkenleri kökteki `.env` dosyasından okunur (`.env.example`'dan kopyala).
- `pnpm test`: bütün paketlerin testleri (Vitest)
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` (`pnpm format` düzeltir)
- `pnpm smoke`: api modüllerini (dinlemeye başlayan `main.ts` hariç) ve worker'ın giriş dosyasını Node ile doğrudan yükler; tsc ve Vitest'in kaçırdığı içe aktarma hatalarını yakalar
- `pnpm peers check`: paketlerin birbirine uyumunu denetler
- `pnpm --filter @agent-office/web build`: panelin derlenmiş dosyaları
- `supabase start`: yerel veritabanı; `supabase db reset`: göçleri baştan uygular (veri modeli görevinde kurulacak)

## Çalışma şekli

- Her görevde önce kısa bir plan yaz ve onay bekle; onaydan sonra uygula.
- Bir modül testleri geçmeden bitmiş sayılmaz. Küçük commit'ler at.
- Depoda yalnızca iki dal var: `development` (geliştirme, test ortamı) ve `main` (canlı ortam). Başka dal açılmaz; bu kural çok önemli. İş `development` dalında ilerler; `main`'e geçiş `development`'tan PR ile olur.
- İşler `docs/KALAN-ISLER.md` sırasıyla yapılır; biten iş orada işaretlenir. `docs/PLAN.md` sırasının dışına çıkma. Kapsam dışı fikirleri `docs/SONRA.md` dosyasına yaz.
- Bir iş kuralını bilmiyorsan uydurma, sor.
