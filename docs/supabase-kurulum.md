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
4. API anahtarlarını hiçbir yere kopyalamayın. Eski `anon` ve `service_role` anahtarları kapatılabilir.
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

Bu sorgu uygulamanın kendi rolleriyle (`office_api`, `office_worker`) çalışmaz; yalnızca göçleri çalıştıran rol çağırabilir. Yerel Supabase'de `postgres` rolüyle denendi; test projesinde henüz denenmedi.
