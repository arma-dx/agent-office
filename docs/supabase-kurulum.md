# Supabase kurulumu

Bu adımları kurucu kendi tarayıcısında ve kendi terminalinde yapar. Veritabanı şifresi ve erişim anahtarı sohbete, dosyaya ya da depoya yazılmaz. Kaynak: 3 Ekim Supabase araştırması (resmî belgeler ve Supabase CLI 2.119 kaynak kodu).

## 1. Proje açma

Önce test projesi açılır. Canlı proje pilot açılışından önce açılır (plan kararı aşağıda).

| Alan | Değer |
| --- | --- |
| Project name | `agent-office-test` (canlı için `agent-office`) |
| Database password | "Generate a password"; yalnızca parola yöneticisine kaydedilir, hiçbir `.env` dosyasına yazılmaz |
| Region | Central EU (Frankfurt) |
| Enable Data API | Kapalı. Panel Supabase'e doğrudan bağlanmaz (kural 1); gerekirse sonradan Integrations > Data API'den açılır |
| Automatically expose new tables | Kapalı |
| Enable automatic RLS | Kapalı. Yalnızca `public` şemasına bakar; bizim tablolarımızda RLS'i göçler açıyor ve testler denetliyor |
| Postgres Type | Postgres (varsayılan). OrioleDB deneme sürümü, sonradan kaldırılamaz |

Plan: Ücretsiz planda yedek yok ve proje bir hafta kullanılmazsa duraklatılır. Test projesi için bu yeterli. Canlı proje için Pro gerekir (7 günlük günlük yedek, yeni projeye geri yükleme); maliyet kararı kurucunundur.

## 2. Açtıktan sonra ayarlar

1. Settings > Infrastructure: Postgres sürümü 17.6.1.152 ya da üstü olmalı (beklenen 17.11). Daha eskiyse göç göndermeden önce haber verin.
2. Hesapta iki adımlı doğrulama (Account > Security > MFA) açık olsun.
3. Authentication: "Allow new users to sign up" ve anonim giriş kapalı. Supabase Auth kullanılmıyor; giriş API'de Google ile yapılıyor.
4. API anahtarlarını hiçbir yere kopyalamayın; tek istisna dosya deposu için açılan gizli anahtardır (bölüm 8), o da yalnızca sunucunun gizli ayarlarına yazılır. Eski `anon` ve `service_role` anahtarları kapatılabilir.
5. Harcama sınırı (spend cap) açık kalsın.
6. SSL zorunluluğu (Enforce SSL) ve ağ kısıtlaması (yalnızca sunucunun IP adresi) sunucu kurulurken açılır. Şimdi açılırsa bilgisayardan göç gönderilemez.

## 3. Göçleri gönderme

Terminalde, proje klasöründe:

1. Supabase'de Account > Access Tokens: yalnızca bu projeye erişen, 7 gün süreli bir erişim anahtarı oluşturun. İzinler: proje ayarları ve API anahtarları için okuma, veritabanı için okuma ve yazma. Anahtarı kopyalayın.
2. Girişte anahtarı panodan verin (komut geçmişine düşmez), sonra panoyu temizleyin:

   ```bash
   pbpaste | supabase login
   ```

   ```bash
   pbcopy </dev/null
   ```

3. Projeyi bağlayın (proje kimliği panelin adres çubuğundaki 20 harflik kod; gizli değildir):

   ```bash
   supabase link --project-ref PROJE_KIMLIGI
   ```

4. Veritabanı şifresini yalnızca bu terminal oturumu için, ekranda görünmeden alın:

   ```bash
   read -s SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD
   ```

5. Önce neyin gideceğine bakın, sonra gönderin. İlk gönderimde başlangıç verisi (şirketler, birimler, kurucu) bir kez yüklenir:

   ```bash
   supabase db push --dry-run
   ```

   ```bash
   supabase db push --include-seed
   ```

6. Bitirince şifreyi oturumdan silin ve çıkış yapın; erişim anahtarını panelden silin:

   ```bash
   unset SUPABASE_DB_PASSWORD && supabase logout
   ```

Bundan sonraki göçler `supabase db push` ile gider (`--include-seed` olmadan). Uygulanmış bir göç dosyası değiştirilmez; değişiklik yeni bir göçle gelir.

Tek seferlik istisna (3 Ekim, karar 4): adlar İngilizceye geçerken göçler baştan yazıldı. Test projesi, kurucunun onayıyla `supabase db reset --linked` ile sıfırlanır (göçler ve başlangıç verisi yeniden kurulur), ardından eski `ofis_*` rolleri silinir. Canlı proje henüz açılmadığı için orada böyle bir adım yok.

## 4. Uygulama rollerine parola (sunucu kurulurken)

Göçler `office_api` ve `office_worker` giriş rollerini parolasız açar. Sunucu kurulurken parolalar parola yöneticisinde üretilir ve psql'de `postgres` olarak bağlanıp `\password office_api` ve `\password office_worker` ile verilir. Parolalar yalnızca sunucunun gizli ayarlarında durur. Studio'nun SQL ekranında parola verilmez, çünkü açık metin loglara düşer.

## 5. Bağlantı (sunucu kurulurken)

- Doğrudan bağlantı yalnızca IPv6. Sunucudan Supavisor oturum kipiyle (session mode, port 5432) bağlanılır; kullanıcı adı `office_api.PROJE_KIMLIGI` biçimindedir. IPv4 eki (aylık yaklaşık 4 dolar) alınırsa doğrudan bağlantı kullanılabilir.
- SSL sertifika doğrulamalı kullanılır (Supabase'in CA sertifikası).
- Ağ kısıtlaması yalnızca sunucunun IP adresine izin verir.

## 6. Yedek ve geri yükleme denemesi (pilot açılışından önce, Pro)

Pilot açılış kontrollerindeki "geri yükleme bir kez denendi" maddesi için: göçler gönderilir, ilk günlük yedek beklenir, yedek yeni bir projeye geri yüklenir, giriş rollerine yeniden parola verilir, şirket ayrımı testleri geri yüklenen projede çalıştırılır, sonra o proje silinir.

## 7. Kurucunun passkey'ini sıfırlama

Bir çalışanın ya da dış kişinin kaybolan passkey'ini kurucu panelden sıfırlar (Ayarlar, Kullanıcılar, "Passkey'leri sıfırla"). Kurucunun kendi passkey'i kaybolursa sıfırlama veritabanından yapılır (5 Ekim, karar 3):

1. Kayıp cihazda Google oturumu açık kalmış olabilir. Önce Google hesabından o cihazın oturumunu kapatın ya da Google parolasını değiştirin; sıfırlamadan sonra ilk passkey'i Google ile giren ilk kişi ekler.
2. Supabase panelinde ilgili projenin SQL Editor ekranını açın (sorgular `postgres` rolüyle çalışır) ve kurucunun giriş adreslerinden biriyle şu sorguyu çalıştırın:

   ```sql
   select * from office.admin_reset_passkeys('adres@armadx.com');
   ```

3. Sorgu kaç passkey'in kaldırıldığını ve kaç oturumun kapandığını döndürür. Hesabın bütün passkey'leri kaldırılır, açık oturumları kapanır ve her şirketin iz kaydına bir satır yazılır.
4. Kurucu Google ile yeniden girer ve 10 dakika içinde Ayarlar, Güvenlik sayfasından yeni passkey ekler. İki ayrı cihazda passkey kaydı önerilir.

Bu sorgu uygulamanın kendi rolleriyle (`office_api`, `office_worker`) çalışmaz; yalnızca göçleri çalıştıran rol çağırabilir. Yerel Supabase'de ve test projesinde `postgres` rolüyle denendi (test projesinde 6 Ekim'de, geri alınan bir işlem içinde).

## 8. Dosya deposu (proje dosyaları)

Projelere eklenen dosyalar Supabase Storage'da durur (6 Ekim, karar 9; 8 Ekim, karar 20). Panel Supabase'e bağlanmaz: dosya API'ye gönderilir ve API'den indirilir. Yerelde ve testlerde bu adımlar gerekmez: yerelde `.env` dosyasındaki `FILE_STORAGE_DIR` bir klasörü gösterir, testler dosyayı bellekte tutar.

1. Önce Integrations > Data API'nin hâlâ kapalı olduğuna bakın (bölüm 1). Gizli anahtar, Data API açıksa veritabanına satır kurallarını aşarak ulaşabilir; kapalıyken işe yaradığı yer dosya deposudur.
2. Storage > New bucket: adı `office-files`. "Public bucket" kapalı. "Restrict file size" 25 MB. "Restrict MIME types" boş kalır (türe API karar verir). Bu adımda kova için kural (policy) yazılmaz: kuralsız kovayı yalnızca gizli anahtar okur ve yazar. Tek kural, çalıştırıcının yalnızca okuyan rolü için bölüm 9'da eklenir.
3. Settings > API Keys > Secret keys: `office-files` adıyla yeni bir gizli anahtar. Anahtar yalnızca sunucunun gizli ayarlarına `SUPABASE_SECRET_KEY` olarak yazılır; sohbete, dosyaya ya da depoya yazılmaz.
4. Sunucunun ayarlarına üç değer birlikte girer: `SUPABASE_URL` (`https://PROJE_KIMLIGI.supabase.co`), `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` (`office-files`). Test ve canlı ortamda `FILE_STORAGE_DIR` boş kalır.
5. Sunucu kurulurken, giriş rollerine parola verildikten sonra (bölüm 4), veritabanına API'nin rolüyle (`office_api`) bağlanıp şuna bakın; yanıt `0` ya da 30 saniyeden uzun olmalı. Dosya eklenirken ve silinirken API, depo yanıt verene kadar (en çok 30 saniye) veritabanı işlemini açık tutar:

   ```sql
   show idle_in_transaction_session_timeout;
   ```

6. Depoyu deneyin: `pnpm files:check`. Dört "ok" satırı çıkmalı (yazma, okuma, değiştirme, silme). Komut anahtarı, adresi ve içeriği yazmaz. Başka bir şey çıkarsa çıktıyı olduğu gibi iletin: Supabase'e giden üç çağrı gerçek hizmetle henüz denenmedi.
7. Supabase'in veritabanı yedeği kovadaki dosyaları içermez; dosyalar her gece ayrıca yedeklenir (12 Ekim, karar 23; sunucu kurulurken, `docs/KALAN-ISLER.md` 0.7).

Sunucu kurulmadan önce, anahtarı dosyaya yazmadan bilgisayardan denemek için (terminalde, proje klasöründe; ilk komut anahtarı ekranda göstermeden alır):

```bash
read -s SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY
```

```bash
SUPABASE_URL=https://PROJE_KIMLIGI.supabase.co SUPABASE_STORAGE_BUCKET=office-files FILE_STORAGE_DIR= pnpm files:check
```

```bash
unset SUPABASE_SECRET_KEY
```

## 9. Çalıştırıcının dosya okuma belirteci (ajanların proje dosyalarını okuması)

Yapay zekâ izni açık projede ajanlar proje dosyalarını okur (8 Ekim, karar 21). Dosyayı ajan için çalıştırıcı okur; çalıştırıcı dosya deposuna gizli anahtarla değil, yalnızca `office-files` kovasını okuyabilen bir belirteçle ulaşır. Her ortam için (test, sonra canlı) bir kez yapılır; bölüm 8'deki kova kurulduktan sonra. Yerelde gerekmez: çalıştırıcı yerelde `FILE_STORAGE_DIR` klasörünü okur. Belirteç ortam başınadır, firma başına değil: tek kova bütün firmaların dosyalarını tutar ve hangi dosyanın okunacağına veritabanındaki satır kuralı karar verir.

1. Supabase panelinde SQL Editor'da şunu çalıştırın:

   ```sql
   create role office_file_reader nologin noinherit;
   grant office_file_reader to authenticator;
   grant usage on schema storage to office_file_reader;
   grant select on storage.objects, storage.buckets to office_file_reader;
   create policy "office_file_reader reads office-files"
     on storage.objects for select to office_file_reader
     using (bucket_id = 'office-files');
   create policy "office_file_reader sees the bucket"
     on storage.buckets for select to office_file_reader
     using (id = 'office-files');
   ```

2. Settings, API Keys bölümünden "publishable key" değerini (`sb_publishable_...`) alın; gizli değildir.
3. Settings, JWT Keys bölümünden JWT gizli değerini kopyalayın. Kendi bilgisayarınızda, proje klasöründe `pnpm files:mint-read-token` çalıştırın; gizli değeri sorulduğunda yapıştırın (yazdığınız ekranda görünmez). Komut belirteci ve biteceği günü yazar; gizli değeri hiçbir yere kaydetmez. Gizli değer sohbete, depoya ve `.env` dosyasına girmez.
4. İki değeri çalıştırıcının gizli ayarlarına yazın: `SUPABASE_PUBLISHABLE_KEY` ve `SUPABASE_STORAGE_READ_TOKEN`; `SUPABASE_URL` ve `SUPABASE_STORAGE_BUCKET` API'ninkiyle aynıdır. Çalıştırıcının ortamında `SUPABASE_SECRET_KEY` bulunmaz: çalıştırıcı canlıda bu değerle başlamayı reddeder. API ile çalıştırıcının gizli ayarları bu yüzden ayrı tutulur.
5. Belirteci deneyin: `pnpm files:check`. Komut önce bölüm 8'deki dört satırı yazar, sonra dört satır daha: `ok  read token reads`, `ok  read token cannot write`, `ok  read token cannot delete`, `ok  read token reads one bucket` (belirteç API'nin yazdığı nesneyi okuyor, onu değiştiremiyor ve yenisini oluşturamıyor, silemiyor, başka adlı bir kovayı okuyamıyor). Deneme nesneyi API'nin anahtarıyla yazıp belirteçle okuduğu için iki tarafın değerlerini birlikte ister; bu yüzden çalıştırıcının ortamında değil, bilgisayardan çalıştırılır (aşağıda). Satırlardan biri `FAIL` yazarsa çalıştırıcı bu belirteçle başlatılmaz; çıktıyı olduğu gibi iletin. `skip  read token (not set)` yazarsa iki değer komuta ulaşmamıştır.
6. Belirteç 400 gün geçerlidir. Çalıştırıcı başlarken kaç gün kaldığını kaydına yazar (`file_reader_configured`, `token_days_left`); süresi dolunca çalıştırıcı `file_read_token_expired` yazar ve ajanlar dosya okuyamaz, 3. ve 4. adım yinelenir. Belirteç erken iptal edilmek istenirse 1. adımdaki iki kural silinir; belirteç o anda hiçbir şey okuyamaz.

Belirteci bilgisayardan denemek için (terminalde, proje klasöründe; ilk iki komut değeri ekranda göstermeden alır):

```bash
read -s SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY
```

```bash
read -s SUPABASE_STORAGE_READ_TOKEN && export SUPABASE_STORAGE_READ_TOKEN
```

```bash
SUPABASE_URL=https://PROJE_KIMLIGI.supabase.co SUPABASE_STORAGE_BUCKET=office-files SUPABASE_PUBLISHABLE_KEY=YAYINLANABILIR_ANAHTAR FILE_STORAGE_DIR= pnpm files:check
```

```bash
unset SUPABASE_SECRET_KEY SUPABASE_STORAGE_READ_TOKEN
```

Doğrulanmayanlar (gerçek projede ilk kez burada denenir; sonuç `docs/SONRA.md` P6-i'ye yazılır):

- Bu yol Supabase'in belgesindeki "custom roles" yoludur. Supabase'in sayfası yeni role `anon` rolünü de verir; burada rol yalnızca gerekeni alır (şemayı kullanma, iki tabloyu okuma). 5. adım okumada takılırsa `grant anon to office_file_reader;` eklenir ve 5. adım yeniden çalıştırılır; "read token cannot write" ve "read token cannot delete" satırları yine geçmelidir.
- Yeni anahtar düzenindeki bir Supabase projesinde eski JWT gizli değeri olmayabilir. O zaman önce şu denenir: belirteç, Supabase'e bizim eklediğimiz bir imza anahtarıyla imzalanır. O da yürümezse çalıştırıcıya ayrı bir gizli anahtar verilmesi kurucuya sorulur; sormadan kurulmaz (P6-i).
- "read token reads one bucket" satırı var olmayan bir kova adını dener; hiçbir belirteç onu okuyamaz. Gerçek kanıt için projede ikinci bir kova gerekir (P6-s).
