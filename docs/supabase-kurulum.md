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

1. Supabase'de Account > Access Tokens: yalnızca bu projeye erişen, 7 gün süreli bir erişim anahtarı oluşturun ve kopyalayın.
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

## 4. Uygulama rollerine parola (sunucu kurulurken)

Göçler `ofis_api` ve `ofis_worker` giriş rollerini parolasız açar. Sunucu kurulurken parolalar parola yöneticisinde üretilir ve psql'de `postgres` olarak bağlanıp `\password ofis_api` ve `\password ofis_worker` ile verilir. Parolalar yalnızca sunucunun gizli ayarlarında durur. Studio'nun SQL ekranında parola verilmez, çünkü açık metin loglara düşer.

## 5. Bağlantı (sunucu kurulurken)

- Doğrudan bağlantı yalnızca IPv6. Sunucudan Supavisor oturum kipiyle (session mode, port 5432) bağlanılır; kullanıcı adı `ofis_api.PROJE_KIMLIGI` biçimindedir. IPv4 eki (aylık yaklaşık 4 dolar) alınırsa doğrudan bağlantı kullanılabilir.
- SSL sertifika doğrulamalı kullanılır (Supabase'in CA sertifikası).
- Ağ kısıtlaması yalnızca sunucunun IP adresine izin verir.

## 6. Yedek ve geri yükleme denemesi (pilot açılışından önce, Pro)

Pilot açılış kontrollerindeki "geri yükleme bir kez denendi" maddesi için: göçler gönderilir, ilk günlük yedek beklenir, yedek yeni bir projeye geri yüklenir, giriş rollerine yeniden parola verilir, şirket ayrımı testleri geri yüklenen projede çalıştırılır, sonra o proje silinir.
