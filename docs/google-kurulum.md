# Google ile giriş kurulumu

Bu adımları kurucu Google Cloud Console'da ve Google Workspace yönetici panelinde yapar. İstemci kimliği ve gizli anahtar sohbete, depoya ya da loglara yazılmaz; yalnızca sunucunun gizli ayarlarına ve yerelde `.env` dosyasına girer. Kaynak: 3 Ekim giriş araştırması (Google'ın resmî belgeleri).

## 1. Proje

1. console.cloud.google.com'a `omer@armadx.com` ile girin. Arma DX kuruluşunun altında iki proje açın: `arma-dx-agent-office` (canlı) ve `arma-dx-agent-office-test` (test ve yerel). (5 Ekim: kurucu iki projeyi bu kimliklerle açtı.) Proje kimliği sonradan değişmez. Faturalama hesabı bağlamayın; girişte gerekmez.
2. IAM: projelerin sahibi siz olun; ileride ikinci bir Arma DX yöneticisi eklenmesi önerilir. Geliştiriciye yalnızca OAuth ayarlarını düzenleme yetkisi verilir.

## 2. Giriş ekranı ve istemci (iki projede de)

1. Google Auth Platform > Get started: uygulama adı "Agent Office" (adında "Google" geçmez), destek e-postası, kitle **External**, iletişim e-postası.
2. Data Access: yalnızca `openid`, `userinfo.email`, `userinfo.profile`.
3. Clients > Create client > **Web application**. JavaScript kaynağı eklenmez. Yönlendirme adresleri:
   - Canlı projede: `https://office.armadx.com/api/auth/google/callback`
   - Test projesinde: `https://office-test.armadx.com/api/auth/google/callback` ve `http://localhost:5173/api/auth/google/callback`
4. İstemci kimliğini ve gizli anahtarı hemen parola yöneticisine kaydedin; gizli anahtar yalnızca bir kez gösterilir.
5. Audience: şimdilik **Testing** durumunda kalsın ve test kullanıcısı olarak kendi dört adresinizi ekleyin. Geliştirme ve deneme için bu yeterli.

## 3. Pilot açılışından önce

1. Marka doğrulaması: Google'ın iki adımlı doğrulama bilgisini (`amr`) göndermesi için uygulamanın yayında (In production) ve doğrulanmış olması gerekir. Bunun için armadx.com üzerinde herkese açık bir tanıtım sayfası, gizlilik politikası ve kullanım şartları sayfası ve Search Console'da armadx.com doğrulaması gerekir.
2. Doğrulama tamamlanınca Settings > Advanced Settings altında "Authentication strength claims" ve "Session age claims" açılır.
3. Workspace yönetici panelinde, Arma DX ve Pillika'nın ikisinde de:
   - Security > Authentication > 2-step verification: zorunlu yapın ve "Allow user to trust the device" seçeneğini kapatın.
   - Security > Access and data control > API controls: "Sign in with Google" için temel bilgi erişimine izin verin ya da iki istemci kimliğini güvenilir olarak ekleyin.
4. Altı ay kullanılmayan istemciyi Google siler (30 gün önce uyarır); test istemcisinde buna dikkat edin.

## 4. Şifreler ve dosyalar nereye konur

- İndirilen istemci JSON dosyası projeye konmaz. Parola yöneticisinde saklanır ya da silinir; içindeki iki değer aşağıdaki gibi kullanılır.
- Yerel deneme: test projesinin (`arma-dx-agent-office-test`) istemci kimliği ve gizli anahtarı, proje klasöründeki `.env` dosyasında `GOOGLE_CLIENT_ID=` ve `GOOGLE_CLIENT_SECRET=` satırlarına yapıştırılır. `.env` git'e girmez (`.gitignore`).
- Test ve canlı sunucu: değerler sunucu kurulurken sunucunun gizli ayarlarına girilir (0.7); depoya ve sohbete yazılmaz.
- Supabase veritabanı şifresi hiçbir dosyaya konmaz; yalnızca parola yöneticisinde durur.

## 5. Yerelde deneme

`.env` hazırsa (yerel değerler ve iki Google değeri), proje klasöründe sırayla:

```bash
supabase start
```

```bash
pnpm db:local-role
```

```bash
pnpm dev
```

Sonra tarayıcıda `http://localhost:5173` açılır ve "Google ile giriş yap" ile test kullanıcısı olarak eklenen bir adresle girilir. Deneme bitince `supabase stop` ile yerel veritabanı kapatılır. `pnpm db:local-role`, `supabase db reset` sonrasında yeniden çalıştırılır (sıfırlama yerel rol şifresini siler).

