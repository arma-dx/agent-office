# Google ile giriş kurulumu

Bu adımları kurucu Google Cloud Console'da ve Google Workspace yönetici panelinde yapar. İstemci kimliği ve gizli anahtar sohbete, depoya ya da loglara yazılmaz; yalnızca sunucunun gizli ayarlarına ve yerelde `.env` dosyasına girer. Kaynak: 3 Ekim giriş araştırması (Google'ın resmî belgeleri).

## 1. Proje

1. console.cloud.google.com'a `omer@armadx.com` ile girin. Arma DX kuruluşunun altında iki proje açın: `armadx-agent-office` (canlı) ve `armadx-agent-office-test` (test ve yerel). Proje kimliği sonradan değişmez. Faturalama hesabı bağlamayın; girişte gerekmez.
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
