# Paperclip özellik envanteri ve ürün anlatısı

> Ara rapor. 3 Ekim 2026'da, Agent Office deposu okunmadan önce İngilizce yazıldı; depoya konurken Türkçeye çevrildi. Asıl belge `docs/paperclip-incelemesi.md` dosyasıdır; ikisi çelişirse o geçerlidir. Okuma notu ve bilinen düzeltmeler: [`00-okuma-notu.md`](00-okuma-notu.md).

07 numaralı analist dosyası. Kaynak: `/home/claude/paperclip`, commit `dd868ed125cd709506dd9b29fca640a44d580501` (2026-10-03, "fix(runner): share native completion tool guidance (#14961)"). İnceleme salt okunurdu. Bu rapordaki bütün yollar, `/` ile başlamadıkça depo köküne göredir.

## Kapsam ve yöntem

Okunanlar:

- Ürünü tanımlayan belgeler: `README.md`, `doc/README-draft.md`, `doc/GOAL.md`, `doc/PRODUCT.md`, `doc/SPEC.md`, `doc/SPEC-implementation.md` (seçilmiş bölümler), `ROADMAP.md`, `CONTRIBUTING.md`, `DESIGN.md`, `doc/spec/ui.md`, `doc/design/*` (karar defteri, arayüzü değiştirme, önceki örnekler, bilinen yinelemeler, ajan oturumları).
- Belge sitesi: `docs/docs.json`, `docs/start/*`, `docs/guides/**`, `docs/companies/companies-spec.md`, `docs/agents-runtime.md`, `docs/built-in-agents.md`, `docs/feedback-voting.md`, `docs/pipelines-tutorial.md`, ayrıca `docs/adapters`, `docs/deploy`, `docs/api`, `docs/cli` altındaki genel bakış sayfaları.
- Sürümler: `releases/` içindeki bütün dosyalar (v0.2.7'den v2026.1001.0'a kadar) ve `releases/beta/v2026.1002.0-beta.0.md`; `announcements/` ve `doc/ANNOUNCEMENTS.md`; `doc/CHANNELS.md`.
- Konu belgeleri: `doc/TASKS.md`, `doc/SEARCH.md`, `doc/AGENT-ARTIFACTS.md`, `doc/CLIPHUB.md`, `doc/memory-landscape.md`, `doc/TASK-WATCHDOG.md`, `doc/composer-stop.md`, `doc/connection-intents.md`, `doc/agent-personas.md`, `doc/agent-files.md`, `doc/runner-created-skills.md`, `doc/LOW-TRUST-PRESETS.md`, `doc/RELEASE-NOTES-mcp-access-governance.md`, `doc/CLI.md` (başlıklar ve seçilmiş bölümler), `doc/connections/*` (README, GLOSSARY, TASK-REVIEWS, AGENTMAIL, GMAIL, GOOGLE-WORKSPACE, CHAT-CONNECTOR-UX, FIRST-30-MATRIX, MEMORY, AI-CONNECTIONS giriş bölümü; diğer dosyaların yalnızca başlıkları), `doc/plugins/*` (göz gezdirildi).
- Kataloglar: `packages/plugins/*`, `packages/teams-catalog/generated/catalog.json`, `packages/skills-catalog/generated/catalog.json`, `skills/`.
- Planlar: `doc/plans/` klasörünün tam başlık listesi; bölüm 3.3'te adı geçen arayüz, sohbet, bütçe, token ve Kanban planları baştan sona okundu.
- Bayraklar: `packages/shared/src/feature-catalog.ts` ve `server/src/services/instance-settings.ts` içindeki varsayılanlar. Bu iki kaynak dosya yalnızca bayrakların tam adlarını ve varsayılan değerlerini almak için okundu, çünkü belgelerde çok az bayrağın adı geçiyor.
- Görseller: `screenshots/`, `doc/screenshots/`, `doc/assets/`, `docs/pr-screenshots/`, `docs/assets/`, `design/`, `doc/pr/`, `announcements/`, `ui/storybook/prototypes/` klasörlerinden yaklaşık 50 görsele bakıldı. Uzun Storybook görüntüleri okunabilir parçalara bölünerek incelendi; bu parçalar geçici bir çalışma klasöründeydi ve depoya konmadı.

Durum nasıl belirlendi:

- **Yayında**: kararlı bir sürüm notunda adı geçiyor ya da belgelerde varsayılan olarak açık olduğu yazıyor.
- **Deneysel (bayrak)**: Kurulum ayarları > Deneysel (Instance Settings > Experimental) sayfasındaki bir aç/kapa düğmesine bağlı. Bayrağın adı ve varsayılan değeri `packages/shared/src/feature-catalog.ts` dosyasından alındı.
- **Beta notları**: yalnızca `releases/beta/v2026.1002.0-beta.0.md` dosyasında geçiyor. Dosyanın başlığı "Paperclip v2026.1005.0, Released: 2026-10-05"; bu tarih depo commit'inden iki gün sonra olduğu için dosya bir sonraki kararlı sürümü anlatıyor ve henüz yayımlanmamış sayıldı.
- **Planlandı**: yalnızca `ROADMAP.md`, `doc/SPEC.md`, `doc/TASKS.md`, `doc/CLIPHUB.md` dosyalarında ya da bir plan belgesinde geçiyor.
- **Kaldırıldı**: bir kez yayımlandı, sonra bir sürüm notuyla çıkarıldı.

Sınırlar:

- Depo sığ klonlandığı için bütün dosyaların git tarihi aynı. Ekran görüntülerinin ne zamana ait olduğu PR ve görev numaralarından ve görsellerin içinde görünen tarihlerden çıkarıldı.
- `docs/images/` klasöründe yalnızca iki logo SVG dosyası var. `docs/pr-screenshots/pr-6384/sidebar-desktop.png` dosyası ile `doc/assets/pap-2189/` içindeki dört dosyanın tamamı ürün arayüzü değil, Storybook hata sayfası.
- Eski belgeler ve API "issue" der; güncel arayüz metinleri "task" der. Eski belgeler "company" der; arayüz metinleri v2026.831.0 sürümünden beri "organization" der. İki çiftte de aynı nesneler kastedilir.
- Tamamı okunmayanlar: `doc/execution-semantics.md`, `doc/MCP-ACCESS-GOVERNANCE.md`, `doc/connections/CONNECTOR-PLAYBOOK.md`, `doc/design/TOKEN-AUDIT.md`, `doc/design/COMPONENT-INVENTORY.md` ve tek bir sağlayıcıyı anlatan bağlantı belgelerinin çoğu. Motor ve kaynak kod diğer analistlerin kapsamındadır.

## 1. Ürün tanımı ve tasarım hedefleri

### 1.1 Yazarların ifadesiyle tanım

Paperclip kendini "the app people use to manage AI agents for work" (insanların iş için yapay zekâ ajanlarını yönetmekte kullandığı uygulama) ve "open-source orchestration for teams of AI agents" (yapay zekâ ajanı ekipleri için açık kaynaklı orkestrasyon) diye tanımlar (`README.md`). Belge sitesi ona "the control plane for autonomous AI companies" (otonom yapay zekâ şirketlerinin kontrol düzlemi) der (`docs/docs.json`, `docs/start/what-is-paperclip.md`); hedef belgesi ise "the backbone of the autonomous economy" (otonom ekonominin omurgası) der (`doc/GOAL.md`). Bir kurulum birden çok şirket barındırır; her şirketin çalışan olarak yapay zekâ ajanları, bir organizasyon yapısı, hedefleri, bütçeleri ve görev yönetimi vardır (`docs/start/what-is-paperclip.md`). İnsan operatöre "the board" (yönetim kurulu) denir: yönetim kurulu hedef koyar, ajan işe alır ve duraklatır, önemli kararları onaylar, maliyeti izler (`doc/SPEC.md`, `docs/start/core-concepts.md`). Ajanlar adaptörler aracılığıyla Paperclip'in dışında çalışır ve sonucu geri bildirir; belgelerdeki ifade şudur: "The control plane doesn't run agents. It orchestrates them." (kontrol düzlemi ajanları çalıştırmaz, yönlendirir) (`docs/start/what-is-paperclip.md`). README ürünün görünüşünü şöyle özetler: "It looks like a task manager. Under the hood: org charts, budgets, governance, goal alignment, and agent coordination." (görev yöneticisine benzer; altında organizasyon şemaları, bütçeler, yönetişim, hedef uyumu ve ajan koordinasyonu vardır). Tanıtım cümlesi de şudur: "Manage business goals, not pull requests." (pull request'leri değil, iş hedeflerini yönet) (`README.md`). Belirtilen temel ilke, operatörün şirketin tamamını bir bakışta anlayabilmesidir: kim ne yapıyor, ne kadara mal oluyor, işe yarıyor mu (`doc/GOAL.md`, `docs/start/what-is-paperclip.md`). Proje MIT lisanslıdır ve Paperclip Labs, Inc. tarafından yayımlanır (`README.md`).

README ürünü üç adımla (hedefi tanımla, ekibi işe al, onayla ve çalıştır) ve dört temel direkle (ajan tabanlı görev yöneticisi, ajanlar için organizasyon şeması, ajan çalışanların eğitimi, ajan tabanlı işletim sistemi) anlatır (`README.md`, görsel `doc/assets/four-pillars-dark.png`).

### 1.2 Paperclip'in olmadığını söylediği şeyler

`README.md` dosyasının "What Paperclip is not" bölümünden:

- Yalnızca bir sohbet botu değildir.
- Ajan çerçevesi (framework) değildir. Ajanların nasıl kurulacağını söylemez.
- Yalnızca bir iş akışı kurma aracı değildir; yine de rutinleri ve deneysel Pipelines özelliği vardır.
- İstem yöneticisi değildir.
- Tek bir ajanla sınırlı değildir.
- Yalnızca kod incelemesi için değildir.

### 1.3 Dokuz tasarım hedefi

`doc/PRODUCT.md` dosyasından:

1. İlk başarıya beş dakikadan kısa sürede ulaşmak.
2. Yönetim kurulu düzeyindeki soyutlama her zaman önce gelir. Operatörün soruları şunlardır: şirket ne yapıyor, kim yapıyor, neden önemli, kaça mal oldu, neyi onaylamam gerekiyor.
3. Konuşma, iş nesnelerine bağlı kalır.
4. Ayrıntının basamak basamak açılması: önce özet, sonra kontrol listesi, adımlar ve çıktılar, en son ham kayıtlar.
5. Önce çıktı.
6. Kayıtları öne çıkarmadan çalışmanın görünür olması.
7. Önce yerel, buluta hazır.
8. Güvenli özerklik. Belgedeki ifade: "Auto mode is allowed; hidden token burn is not." (otomatik moda izin var, gizli token harcamasına yok).
9. Çekirdek yalın, çevresi zengin.

### 1.4 Yapılacaklar ve yapılmayacaklar

`doc/PRODUCT.md` dosyasından.

Yapılacaklar:

- Yönetim kurulu ve şirket düzeyinde kalmak.
- İlk beş dakikanın iyi geçmesini sağlamak.
- Ekran sohbet gibi görünse bile işi görevlere, yorumlara, projelere ve hedeflere bağlı tutmak.
- Ajansı, şirket içi ekibi ve girişimi aynı soyutlama olarak ele almak.
- Çıktıları temel öğe saymak: dosyalar, belgeler, raporlar, ön izlemeler, bağlantılar, ekran görüntüleri.
- Mühendislik iş akışlarına bağlanmak.
- Uç durumlar için eklenti kullanmak.

Yapılmayacaklar:

- Çekirdeğe genel amaçlı bir sohbet uygulaması koymak.
- Jira'nın ya da GitHub'ın yerini almaya çalışmak.
- İşe kurumsal düzeyde RBAC kurarak başlamak.
- Ajan gizlilik bayraklarını proje ya da görev gizliliği saymak.
- Ham bash kayıtlarını ve dökümleri öne koymak. "Default view should be human-readable intent/progress, with raw detail beneath." (varsayılan görünüm, insanın okuyabileceği niyet ve ilerleme olmalı; ham ayrıntı altında durmalı).
- Sağlayıcı ve API anahtarı ayarlarıyla uğraşmayı kullanıcıya dayatmak.

### 1.5 Arayüz tasarım ilkeleri

`DESIGN.md` (v0.3), arayüz kararları için tek kaynak olarak gösterilen belgedir. Ürünün yaklaşımı: "The user is an operator scanning state and making decisions. Every screen should answer, in order: *what is happening, does it need me, what do I do about it.*" (kullanıcı, duruma göz gezdirip karar veren bir operatördür; her ekran sırasıyla şunları yanıtlamalıdır: ne oluyor, bana ihtiyaç var mı, ne yapmalıyım). Yoğunluk göz gezdirmeye hizmet eder; belgedeki ifadeyle "density comes from information, never from chrome" (yoğunluk bilgiden gelir, hiçbir zaman arayüz süsünden değil).

`DESIGN.md` içindeki sekiz ilke:

1. Her şey tek bir biçimde söylenir. Tek Button, tek Card, tek Badge, tek Table, tek EmptyState; çeşitler prop olarak verilir.
2. Görsel değerlerin tek kaynağı tasarım değişkenleridir (token). Bileşenlerde hex renk kodu, ham px değeri ya da keyfî Tailwind değeri kullanılmaz. Tek değişken dosyası `ui/src/index.css` dosyasıdır.
3. Boşluklar da değişkenlerden gelir.
4. Hiyerarşi süsle değil yapıyla kurulur. "Every border, divider, and background fill must justify itself; when in doubt, remove it." (her kenarlığın, ayırıcının ve dolgunun bir gerekçesi olmalıdır; emin değilsen kaldır).
5. Durum sistematiktir. Çalışıyor, duraklatıldı, engellendi, onay bekliyor ve bütçe aşıldı durumları tek bir durum değişkeni takımına bağlanır; bu takım rozette, satırda, grafikte ve kayıtta aynı biçimde kullanılır.
6. Makinenin ürettiği değerler belli olur. Kimlikler, maliyetler, token sayıları, zaman damgaları ve kayıtlar eş aralıklı yazı değişkenini ve ortak biçimlendiricileri kullanır.
7. Sözcükler sistemin parçasıdır. Her kavramın tek adı vardır; esas alınan sözcük "task" sözcüğüdür. Düğme yaptığı işi söyler ("Approve hire," yazılır, "Submit" yazılmaz). Hata ne olduğunu ve ne yapılacağını söyler. Boş ekran ilk adımı söyler.
8. Arayüz, ajanların da değiştirebileceği biçimde tasarlanır. Doğru bir değişiklik "edit tokens + run checks" (değişkenleri düzenle, denetimleri çalıştır) olmalıdır.

`DESIGN.md` içindeki diğer kurallar:

- Form ve sihirbaz alt satırları: ikincil eylem (Kaydet ve çık, İptal, Geri) solda, birincil eylem sağda durur; ikisi aynı satırdadır.
- O an ekranda zaten görünen görev ya da çalışma durumu için bildirim çıkmaz. Yerel bir eylemin sonucu yerinde gösterilir; hatalar satır içinde kalır ve kullanıcı oradan işlem yapabilir.
- Beklenen iptal hata sayılmaz; nötr griyle gösterilir.
- Duraklatılmış görevde yazma kutusunun yerini sarı bir blok alır: "Task is paused." (görev duraklatıldı), "Resume this task to send a message." (mesaj göndermek için görevi sürdürün), eylem düğmesi "Resume task" (görevi sürdür). Blok kapatılamaz ve taslakları korur.
- Kaynak işi hâlâ eşitlenen bir onay isteği "Preparing approval…" (onay hazırlanıyor) yazar ve sunucu hazır olana kadar kabul düğmesini devre dışı bırakır.
- Bekleyen sorular ve onay istekleri, yazma kutusunun hemen üstünde ayrı bir kartta görünür. Kart kapatılınca geriye, kartı yeniden açan bir bekleyen istek göstergesi kalır.
- Hareket değerleri de değişkendir; `prefers-reduced-motion` süreleri sıfıra indirir.

### 1.6 Spesifikasyondaki yönetişim ilkeleri

`doc/SPEC.md` ve `doc/SPEC-implementation.md` dosyalarından:

- Ajanlar arasında ve ajanlarla yönetim kurulu arasında "Tasks are the communication channel" (iletişim kanalı görevlerdir).
- Çökme sonrası kurtarma: "Paperclip reports problems, it doesn't silently fix them." (Paperclip sorunları bildirir, sessizce düzeltmez).
- Zorunlu kullanıcı deneyimi davranışı: arka planda sessiz hata olmaz; her başarısız çalışma arayüzde görünür (`doc/SPEC-implementation.md` §14).
- Bütçenin üç kademesi vardır: görünürlük, yumuşak uyarılar, kesin tavan (`doc/SPEC.md`).
- Şirket skill kuralı: "skill permissions are opt-in restrictions, not opt-in capabilities" (skill izinleri istenirse eklenen kısıtlamalardır, istenirse açılan yetenekler değildir) (`doc/PRODUCT.md`).
- Yürütme kuralının tasarım ilkesi: "Runtime-enforced, not prompt-dependent" (çalışma zamanında zorunlu kılınır, isteme bağlı değildir) (`docs/guides/execution-policy.md`).
- Eklentiler şu yetkilere hiçbir zaman sahip olamaz: onay kararı verme, bütçe sınırını geçersiz kılma, kimlik doğrulamayı atlama, üstlenme kilidini geçersiz kılma, veritabanına doğrudan erişim (`doc/plugins/PLUGIN_SPEC.md`).

## 2. Özellik envanteri

Sütunlarla ilgili notlar: "İlk yayımlandığı sürüm" sütunu, sürümü yalnızca bir sürüm notu söylüyorsa verir; "belirtilmemiş", özelliğin adının hiçbir sürüm notunda geçmediği anlamına gelir. Sürüm tarihleri bölüm 3'tedir. Depodaki en yeni kararlı sürüm v2026.1001.0'dır (2026-10-01).

### 2.1 Şirket ve organizasyon

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Tek kurulumda birden çok şirket | Tek bir kurulum, verileri ayrı duran birkaç şirket barındırır. Şirketler arasında şirket menüsüyle ve kenar çubuğundaki dar şirket çubuğuyla geçilir. | Yayında | v0.2.7 öncesi; belirtilmemiş | `README.md`, `docs/start/what-is-paperclip.md`, `docs/pr-screenshots/pr-5291/after-navigation-layout.png` |
| İlk kurulum sihirbazı | Boş bir kurulumdan çalışan bir ajana götürür: ajana ad verilir, bir model bağlanır ve "chief of staff" (kurmay başkanı) ile sohbet olarak açılan ilk görev başlatılır. | Yayında; birkaç kez elden geçirildi | İyileştirilmiş sihirbaz v0.3.1; yenileme v2026.626.0; misyon adımının kaldırılması v2026.831.0; chief of staff sohbeti v2026.916.0 | `docs/guides/board-operator/creating-a-company.md`, `releases/v2026.831.0.md`, `releases/v2026.916.0.md` |
| Plan önerisi olarak ilk görev | İlk istekte chief of staff, tek kartlık onay yerine kısa bir plan belgesi ve işaretli onay kartı yazar. | Deneysel (`enableFirstTaskPlanProposal`, varsayılan kapalı) | Belirtilmemiş | `docs/guides/board-operator/editing-first-task-texts.md`, `packages/shared/src/feature-catalog.ts` |
| Şirket logosu | Her şirket için logo yüklenir ve gösterilir. | Yayında | v2026.318.0 | `releases/v2026.318.0.md`, `docs/api/companies.md` |
| Şirketi arşivleme ve arşivden çıkarma | Şirket arşivlenir; arşivlenmiş şirketlerde ajanlar artık uyandırılmaz; arşivlenmiş bir şirketin adresi açılınca tek tıkla Arşivden çıkar (Unarchive) seçeneği sunulur. | Yayında | Arşivleme: belirtilmemiş; uyandırmanın durması v2026.609.0; arşivden çıkarma sayfası v2026.824.0 | `docs/api/companies.md`, `releases/v2026.609.0.md`, `releases/v2026.824.0.md` |
| Organizasyon şeması | Ajanların kime bağlı olduğunu katı bir ağaç olarak gösterir; kartlarda rol ve yetenekler yazar. | Yayında | Kartlarda yetenekler v2026.403.0; telefonda organizasyon şeması v2026.427.0 | `docs/guides/board-operator/org-structure.md`, `releases/v2026.403.0.md`, `releases/v2026.427.0.md` |
| Emir komuta zincirinde görev devretme | CEO ajanı hedefleri görevlere böler ve kendisine bağlı ajanlara devreder; üst kademeye taşınan işler ağaçta yukarı doğru gider. | Yayında | Görev devretme kılavuzu v2026.403.0 | `docs/guides/board-operator/delegation.md`, `docs/start/core-concepts.md` |
| İş zaman çizelgesi (Work Timeline) | Şirket sayfası; her ajanın ne zaman çalıştığını, devirlerin nerede olduğunu ve işlerin nerede çakıştığını Gantt benzeri kompakt bir görünümle gösterir. | Yayında | v2026.707.0 | `releases/v2026.707.0.md` |
| Birleşik ayarlar | Şirket ve kurulum ayarları tek bir menüyü paylaşır; davetler Üyeler (Members) sayfasının bir sekmesidir; ayrı Heartbeats sayfası kaldırılmıştır. | Yayında | v2026.831.0 | `releases/v2026.831.0.md` |
| "Organization" sözcüğü | Arayüz metinleri "company" yerine "organization" der. | Yayında | v2026.831.0 | `releases/v2026.831.0.md` |
| Uygulama içi duyurular | Bir JSON akışından beslenen, isteğe bağlı tek bir duyuru kartı; uygulama açıldıktan birkaç saniye sonra gösterilir, kullanıcı kapatınca bütün şirketlerde kapanmış olur. | Yayında, varsayılan olarak açık; `PAPERCLIP_ANNOUNCEMENTS_ENABLED=false` ile kapatılır | v2026.916.0 | `doc/ANNOUNCEMENTS.md`, `releases/v2026.916.0.md` |
| Kendi kendine örgütlenme, otomatik kurumsal öğrenme | Ajanlar organizasyonu kendileri yeniden biçimlendirir ve görevler arasında kendi başlarına öğrenir. | Planlandı | yok | `ROADMAP.md` |

### 2.2 Ajanlar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Ajan listesi ve durumlar | Ajanları durumlarıyla listeler: etkin, boşta, çalışıyor, hata, duraklatıldı, sonlandırıldı. | Yayında | Belirtilmemiş | `docs/guides/board-operator/managing-agents.md` |
| Ajan oluşturma sihirbazı | Bir seçim penceresi ve bir yapılandırma akışı; sonradan sadeleştirildi ve ilk kurulumla aynı model bağlantısı kontrollerini kullanır oldu. | Yayında | v0.3.0; sadeleştirme v2026.916.0 | `releases/v0.3.0.md`, `releases/v2026.916.0.md` |
| Ajan ayrıntı sekmeleri | Tek bir ajanın yapılandırması, çalışmaları, skill'leri, talimatları ve denetimi. | Yayında | Çalışmalar sekmesi ve yapılandırma sekmeleri v0.3.1; ajana özel denetim sekmesi v2026.817.0 | `releases/v0.3.1.md`, `releases/v2026.817.0.md`, `docs/pr-screenshots/pap-2944/` |
| Duraklatma, sürdürme, sonlandırma | Ajanın iş almasını durdurur, yeniden iş almasını sağlar ya da ajanı kalıcı olarak emekliye ayırır. | Yayında | Kenar çubuğundan duraklatma ve sürdürme v2026.428.0 | `docs/guides/board-operator/managing-agents.md`, `releases/v2026.428.0.md` |
| Ortamı sına (Test Environment) düğmesi | Ajan çalışmadan önce adaptör yapılandırmasının çalıştığını denetler. | Yayında | Belirtilmemiş | `docs/guides/board-operator/managing-agents.md` |
| Hatayı temizleme eylemi | Ajanın hata durumunu temizlemenin denetim kaydına geçen bir yolu. | Yayında | v2026.609.0 | `releases/v2026.609.0.md` |
| Yapılandırma sürümleri ve geri alma | Ajan yapılandırmasındaki değişiklikler sürümlenir ve geri alınabilir. | Yayında | Belirtilmemiş | `docs/api/agents.md`, `README.md` ("governance with rollback") |
| Talimat düzenleyicisi | Ajanın talimat dosyasını bir düz yazı düzenleyicisinde düzenler. | Yayında | Düz yazı düzenleyicisi v2026.720.0 | `releases/v2026.720.0.md` |
| Kalıcı ajan dosyaları | Her ajan görevler arasında tek bir dizini (talimat dosyası, notlar, bellek) korur; düzenleyici aynı dizini okur. Yeni kayıtlar artık sürüm geçmişi oluşturmaz. | Beta notları | v2026.1005.0 notları | `doc/agent-files.md`, `doc/agent-instruction-revisions.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Ajan karakterleri | Her ajanın üretilmiş bir yüzü vardır (17 renk takımından birini kullanan yuvarlak hatlı bir karakter); listelerde, kenar çubuğunda, organizasyon şemasında, görevlerde ve yorumlarda görünür; ajan sayfasının başlığında hareketli bir karakter durur. | Yayında | v2026.1001.0 | `doc/agent-personas.md`, `releases/v2026.1001.0.md` |
| Uyandırmalar (Heartbeats) | Ajanlar zamanlayıcıyla, atamayla, istek üzerine ya da otomasyonla uyanır, sınırlı tek bir tur çalışır ve sonucu bildirir. | Yayında | v0.2.7 öncesi | `docs/agents-runtime.md`, `docs/guides/agent-developer/heartbeat-protocol.md` |
| Canlı çalışma çıktısı ve dökümler | Çalışma sayfalarında çıktı canlı akar; dökümler markdown'ı biçimlendirir, komut çıktısını katlar ve olay etiketlerini insanın okuyacağı biçimde yazar. | Yayında | v0.3.0 ve v0.3.1 | `releases/v0.3.0.md`, `releases/v0.3.1.md` |
| Başarısız çalışmaları yeniden deneme | Başarısız olan ve zaman aşımına uğrayan çalışmalarda Yeniden dene (Retry) düğmesi. | Yayında | v0.3.0 | `releases/v0.3.0.md` |
| Çalışmanın canlılığı ve devam çalışmaları | Her çalışma bir canlılık durumu ve bir sonraki eylem ipucu kaydeder; böylece yarıda kalan iş sürdürülebilir. Bir gözcü sessiz çalışmaları ortaya çıkarır. | Yayında | v2026.427.0 | `releases/v2026.427.0.md`, `docs/guides/agent-developer/heartbeat-protocol.md` |
| Kurtarma eylemleri | Takılan ya da sonuca bağlanmamış iş, kaynak görevde sahibi, kanıtı ve sonucu olan bir kurtarma eylemi oluşturur. | Yayında | v2026.513.0 | `releases/v2026.513.0.md` |
| Kendini onaran çalışmalar | Operatöre iş düşmeden önce yeniden başlatma sonrası kurtarma, kotayı gözeten yeniden denemeler ve hata nedenine göre yönlendirme. | Yayında | v2026.720.0 | `releases/v2026.720.0.md` |
| Sessiz çalışma tespiti yalnızca uyarı verir | Çıktı gelmemesi çalışma özetlerinde şüpheli ya da kritik olarak görünür, ama artık kendiliğinden görev açmaz ya da devralma başlatmaz. | Yayında | v2026.831.0 | `releases/v2026.831.0.md` |
| Kendi ajanını getir (adaptörler) | Belgeler yerleşik adaptörleri şöyle sayar: `claude_local`, `codex_local`, `gemini_local`, `kimi_local`, `opencode_local`, `cursor`, `pi_local`, `hermes_local`, `hermes_gateway`, `openclaw_gateway`, `process`, `http`; sürüm notları bunlara `grok_local`, `cursor_cloud` ve `acpx_local` adaptörlerini ekler. Dış adaptörler paket olarak kurulur. | Yayında | Adaptörler v0.3.0 ile v2026.831.0 arasında eklendi; dış adaptör eklentileri v2026.414.0 | `docs/adapters/overview.md`, `releases/v2026.414.0.md`, `releases/v2026.512.0.md`, `releases/v2026.517.0.md` |
| Paperclip'in kendi çalıştırıcısı (Native Paperclip Runner) | Codex, Claude (ACPX) ve OpenCode ajanları için Paperclip'in kendi yürütme motoru. | Deneysel (`enableNativeRunner`, kendi sunucusuna kurulan sürümde varsayılan açık, bulutta kapalı) | Altyapı hazırlığı v2026.831.0; tam motor v2026.916.0 | `releases/v2026.916.0.md`, `packages/shared/src/feature-catalog.ts` |
| Yerleşik ajanlar | Paperclip'in yönettiği ajanlar (ilk örnekler: `briefs`, `learning` ve Summarizer); listede rozetleri ve kurulum kontrolleri vardır; bu ajanlar kurulurken işe alma onayı atlanır. | Deneysel (`enableBuiltInAgents`, varsayılan kapalı) | Summarizer v2026.720.0 | `docs/built-in-agents.md`, `packages/shared/src/feature-catalog.ts` |
| Hazır güven düzeyleri | `standard` ajanlar şirket genelinde birlikte çalışır; `low_trust_review` ajanlar adı verilen bir proje ya da görev kapsamıyla sınırlıdır ve ajan ya da skill yapılandırmasını düzenleyemez. | Yayında | Düşük güvenli ajanların sınırlanması v2026.609.0 | `doc/LOW-TRUST-PRESETS.md`, `releases/v2026.609.0.md` |
| Kapsamla sınırlı ajan izinleri | Atama ve görev değişiklikleri, ajan başına verilen yetkilerle çalışan bir yetkilendirme servisinden geçer. | Yayında | v2026.525.0 | `releases/v2026.525.0.md` |
| Ajanların ajan işe alması | Bir ajan kendisine bağlı yeni bir ajan isteyebilir; istek yönetim kurulu onayına bağlanabilir. Standart güven düzeyindeki yeni ajanlar varsayılan olarak işe alım yapabilir. | Yayında | Onayın varsayılan olarak isteğe bağlı olması v2026.428.0; varsayılan olarak işe alma v2026.916.0 | `docs/guides/board-operator/approvals.md`, `releases/v2026.428.0.md`, `releases/v2026.916.0.md` |
| Mesaj başına model ve efor | Görev yazma kutusunda, seçili ajana göre değişen, mesaj başına model ve efor seçici vardır. | Beta notları | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| Yıldızlı ve gizli ajanlar | Ajanlar yıldızlanarak kenar çubuğundaki bir bölüme alınır; erişim kaldırılmadan kişinin kendi kenar çubuğundan gizlenebilir. | Yayında | Gizleme v2026.529.0; yıldızlama v2026.707.0 | `releases/v2026.529.0.md`, `releases/v2026.707.0.md` |
| Adına çalışılan kişi | Her çalışma, ondan sorumlu olan insana bağlanır; etkinlik kayıtları bu kullanıcıyı taşır. | Yayında | Çalışmanın kişiye bağlanması v2026.707.0; etkinlik kayıtları v2026.720.0 | `releases/v2026.707.0.md`, `releases/v2026.720.0.md` |
| Ajan değerlendirmeleri (evals) | Çalıştırıcı davranışı ve ürün iş akışları için değerlendirme takımları. | Katkıda bulunanlar için araç olarak yayında | İlk hâli v2026.325.0 | `doc/evals.md`, `ROADMAP.md` |
| MAXIMIZER MODE, masaüstü uygulaması | Yol haritasında adı geçen, kapsamı anlatılmamış kalemler. | Planlandı | yok | `ROADMAP.md` |

### 2.3 Görevler ve akışlar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Görev modeli | Görevin başlığı, açıklaması, durumu, atananı, üst görevi ve projesi vardır. Durumlar: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/managing-tasks.md` |
| Atomik üstlenme, tek atanan | Süren bir görevi yalnızca tek bir ajan tutabilir; ikinci üstlenme isteği çakışma hatası alır. | Yayında | v0.2.7 öncesi | `docs/api/issues.md`, `README.md` |
| Görev listesi | Filtreli (durum, atanan, oluşturan, proje, etiketler, çalışma alanı, yalnızca süren çalışması olanlar, rutin çalışmalarını gizle) gruplanmış liste; sütun ayarları, sıralama, sonsuz kaydırma ve tarih ayırıcıları vardır. | Yayında | Proje filtresi v2026.325.0; sonsuz kaydırma v2026.428.0; tarih ayırıcıları v2026.817.0 | `docs/pr-screenshots/pr-6384/inbox-rows-desktop.png`, `releases/v2026.428.0.md`, `releases/v2026.817.0.md` |
| Büyük ölçekte Kanban panosu | Kompakt kartları, kapalı gelen hareketsiz sütunları, sütun başına gösterme sınırı ve saklanan yoğunluk ayarı olan pano görünümü. | Yayında | v2026.517.0 | `releases/v2026.517.0.md`, `doc/plans/2026-05-05-scaled-kanban-board-design.md` |
| Yeni görev penceresi | Tek pencere: "For [agent] in [project]" ([ajan] için, [proje] içinde) satırı, durum ve dosya eki etiketleri, inceleyenler, onaylayanlar ve isteğe bağlı bir gözcü; "Discard Draft" (taslağı at) solda, "Create" sağda. | Yayında | Belirtilmemiş | `docs/pr-screenshots/pap-2837/`, `docs/guides/execution-policy.md`, `doc/TASK-WATCHDOG.md` |
| Yalnızca istemle görev | Görev yalnızca bir istemle başlatılır; adını atanan ajan koyar. | Beta notları | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md`, `doc/SPEC.md` |
| Sohbet biçiminde görev akışı | Görev sayfası bir konuşmadır: önce akış, altta yazma kutusu, kısa özetlere katlanmış araç etkinliği; özellikler, plan ve çıktılar başlıktaki sekmelerdedir. | Yayında, varsayılan | Sohbet akışı v2026.414.0; sohbet biçimindeki görünüm deneysel olarak v2026.817.0; varsayılan v2026.824.0 | `releases/v2026.414.0.md`, `releases/v2026.817.0.md`, `releases/v2026.824.0.md` |
| Klasik görev arayüzü | Satır içi açıklama düzenleyicisi, düz yorum akışı ve sabit özellik paneli olan eski sayfayı geri getirir. | Tercih (`enableClassicTaskInterface`, varsayılan kapalı) | v2026.824.0 | `releases/v2026.824.0.md`, `packages/shared/src/feature-catalog.ts` |
| Sürekli güncellenen etkinlik özetleri | Çalıştırıcı etkinliği grup başına özetlere indirgenir; canlı ve kayıtlı görünümler aynı özetleri kullanır. | Yayında | v2026.916.0 | `releases/v2026.916.0.md` |
| Yapılandırılmış akış etkileşimleri | Ajanlar serbest metin yerine kart gönderir: görev önerileri, soru formları, onay istekleri (kabul ya da gerekçesi zorunlu ret), işaretli onaylar, kalem kalem kararlar. | Yayında | Görev önerileri, sorular, onay istekleri v2026.427.0; işaretli onay v2026.609.0; kalem kalem karar: belirtilmemiş | `docs/api/issues.md`, `releases/v2026.427.0.md`, `releases/v2026.609.0.md` |
| Çalışma sürerken yanıtların sıraya girmesi | Ajan çalışırken bir soruyu ya da onayı yanıtlamak artık geri çevrilmez; yanıt o çalışma için sıraya alınır. | Yayında | v2026.1001.0 | `releases/v2026.1001.0.md` |
| Çalışma modları | Görev `standard` ("Auto mode"), `planning` ya da `ask` modunda çalışır. Planlama modu önce bir plan üretir; soru modu, tam bir yürütme akışı olmadan bir soruyu yanıtlar. | Yayında | Planlama v2026.512.0; soru v2026.626.0; "Auto mode" etiketi v2026.831.0 | `releases/v2026.512.0.md`, `releases/v2026.626.0.md`, `releases/v2026.831.0.md` |
| Plan onayı | Ajan bir plan belgesi yazar ve o sürümü hedefleyen bir onay isteği gönderir; iş yalnızca kabulden sonra sürer. | Yayında | Etkileşimlerle birlikte, v2026.427.0 | `docs/guides/agent-developer/task-workflow.md`, `docs/api/issues.md` |
| Planın görevlere bölünme geçmişi | Kabul edilen planın görevlere nasıl bölündüğünü gösterir. | Deneysel (`enableIssuePlanDecompositions`, varsayılan kapalı) | Belirtilmemiş | `packages/shared/src/feature-catalog.ts`, `screenshots/PR-8000-settings-experimental-flag-on.png` |
| Kontrol listesi olarak alt görevler | Sıralı alt görevler, bağımlılıkları gözeten bir ilerleme kontrol listesi olarak gösterilir; ilerleme çubuğu vardır, sonrakine ve öncekine geçilebilir. | Yayında | Satır içi alt görevler v2026.414.0; kontrol listesi v2026.427.0; sıralı gezinme v2026.513.0 | `releases/v2026.427.0.md`, `releases/v2026.513.0.md` |
| Otomatik uyandırmalı engelleyenler | Görev, kendisini engelleyen görevleri listeler; bütün engelleyenler bitince atanan uyandırılır. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| Alt ağacı duraklatma, iptal etme, geri yükleme | Bir görevi ve bütün alt görevlerini bekletir, iptal eder ya da geri yükler. | Yayında | v2026.427.0 | `releases/v2026.427.0.md` |
| Yazma kutusunda Durdur | Bir çalışma sürerken boş yazma kutusu Durdur (Stop) düğmesini gösterir; Durdur, işi "Pause work" ile aynı biçimde duraklatır. | Yayında | v2026.916.0 | `doc/composer-stop.md`, `releases/v2026.916.0.md` |
| Yorumla araya girme ve sıradaki mesajlar | Çalışma sırasında gönderilen mesaj sıraya girer; operatör araya girebilir ya da mesajı iptal edebilir. | Yayında | v2026.403.0; kesilebilen sıradaki çalışmalar v2026.720.0 | `releases/v2026.403.0.md`, `screenshots/PAP-10535-live-run-menu-after.png` |
| Görev referansları ve geri bağlantılar | `PAP-123` gibi anmalar, geri bağlantısı olan kalıcı bağlantılara dönüşür. | Yayında | v2026.427.0 | `releases/v2026.427.0.md` |
| Görev izleyicileri | Görev, atananı doğru zamanda uyandıran zamanlanmış bir denetim taşıyabilir ("Monitor scheduled … Check now"). | Yayında | v2026.512.0; bütün görev ekranlarında görünür v2026.720.0 | `releases/v2026.512.0.md`, `docs/pr-screenshots/pap-2945/monitor-surfaces.png` |
| Görev gözcüsü | Durmuş bir görev ağacını doğrulamak ve durma bir hataysa ağacı yeniden başlatmak için atanan ajan. Görev başına isteğe bağlı açılır. | Yayında | v2026.626.0 | `doc/TASK-WATCHDOG.md`, `releases/v2026.626.0.md` |
| Zamanlanmış yeniden deneme ve Şimdi yeniden dene (Retry now) | Başarısız çalışmada "Automatic retry in 15m" (otomatik yeniden denemeye kalan süre) yazısı ve "Retry now" eylemi görünür. | Yayında | v2026.512.0 | `releases/v2026.512.0.md`, `docs/assets/pr-5426/scheduled-retry-story-desktop.png` |
| Akıştaki sistem notları | Bir çalışmanın neden duraklatıldığını, üst kademeye taşındığını ya da kapandığını akışta açıklar; sonradan daha az göze batar hâle getirildi ve sade dille yazıldı. | Yayında | v2026.512.0; daha az göze batan hâli v2026.817.0 | `releases/v2026.512.0.md`, `releases/v2026.817.0.md` |
| Görev başına model değiştirme | Atananın modeli görev başına değiştirilebilir. | Yayında | v2026.512.0 | `releases/v2026.512.0.md`, `releases/v2026.720.0.md` |
| Dosya ekleri | Satır içi görseller, her türden dosya, görsel galerisi, satır içinde oynatılan video; metin ve markdown ekleri görev sekmelerinde açılır. | Yayında; görev sekmeleri beta notlarında | Görseller v2026.325.0; dosyalar ve galeri v2026.414.0; video v2026.609.0 | `releases/v2026.414.0.md`, `releases/v2026.609.0.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Markdown ek özellikleri | Mermaid diyagramları, yoruma kalıcı bağlantı, yorumu markdown olarak kopyalama. | Yayında | v0.3.0 | `releases/v0.3.0.md` |
| Bağlam olarak @ ile anma | Bir ajandan @ ile söz etmek atanan için bağlam ekler, çalışma başlatmaz. | Beta notları (uyumluluğu bozan değişiklik) | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| Yazma kutusu taslaklarının saklanması | Sayfadan çıkılınca taslaklar kaybolmaz. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Uzun akışlarda akıcılık | Akış satırları sanallaştırılarak çizilir. | Yayında | v2026.428.0 | `releases/v2026.428.0.md` |
| Öncelik | Öncelik veri modelinde, API'de ve aramada vardır; arayüzdeki kontrolleri gizlidir. | Arayüzde gizli | v2026.817.0 sürümünde gizlendi | `releases/v2026.817.0.md` |
| Dış nesne referansları | Görevlerdeki dış adresleri algılar; pull request'lerin ve iş takip kayıtlarının (ticket) çözümlenen durumunu gösterir. | Deneysel (`enableExternalObjects`, varsayılan kapalı) | v2026.626.0 | `releases/v2026.626.0.md`, `packages/shared/src/feature-catalog.ts` |
| Sadeleştirilmiş İngilizce etkileşimler | Ajanlara soruları ve onay isteklerini Simplified Technical English ile yazmalarını söyler. | Deneysel (`enableSimplifiedEnglishInteractions`, varsayılan kapalı) | v2026.817.0 | `releases/v2026.817.0.md` |
| İnisiyatifler, kilometre taşları, ekipler, tahminler | Bir kısmının henüz hedef olduğu belirtilen daha zengin bir iş hiyerarşisi. | Planlandı ya da kısmen var | yok | `doc/TASKS.md` |

### 2.4 Gelen kutusu, ilgi bekleyenler ve kararlar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Okundu bilgili Gelen kutusu | Kullanıcıya özel okundu bilgisi, okunmamış noktası, katılma isteklerini ve onayları sayan rozet, uyarıları öne alan sıralama. | Yayında | v0.3.0 | `releases/v0.3.0.md` |
| Benim (Mine) sekmesi ve e-posta tarzı tuşlar | "Mine" sekmesi; `j`/`k` ile gezinme, `a`/`y` ile arşivleme, `o` ile açma; kaydırarak arşivleme; "Mark all as read" (tümünü okundu işaretle); arama; "Today" ayırıcısı. | Yayında | v2026.403.0 | `releases/v2026.403.0.md` |
| Satır içi katılma istekleri | Katılma istekleri Gelen kutusu ekranında onayların ve iş kalemlerinin yanında görünür. | Yayında | v2026.325.0 | `releases/v2026.325.0.md` |
| İç içe gösterim ve gruplama | Üst görevler alt görevlerini altında toplar; çalışma alanına, atanana ya da projeye göre gruplanır ve her grupta token ve çalışma süresi toplamı görünür. | Yayında | İç içe gösterim ve çalışma alanına göre gruplama v2026.414.0; atanana ve projeye göre gruplama v2026.512.0 | `releases/v2026.414.0.md`, `releases/v2026.512.0.md` |
| "Other results" bölümlü arama | Gelen kutusu araması, geçerli filtrenin dışında kalan eşleşmeleri de gösterir. | Yayında | v2026.415.0 | `releases/v2026.415.0.md` |
| Engellenenler sekmesi | Engellenmiş işler için bir sekme; neden etiketleri, filtreler ve aciliyete göre sıralama vardır. | Yayında | v2026.513.0 | `releases/v2026.513.0.md` |
| Alt görevlerin canlı durumu | Üst görev satırı, alt görevlerinin o an ne yaptığını gösterir. | Yayında | v2026.707.0 | `releases/v2026.707.0.md` |
| Her şeyi arşivleme, geri alma | Gelen kutusundaki her kalem arşivlenebilir; arşivlemenin geri alma bildirimi vardır. | Yayında | Geri alma kısayolu v2026.414.0; bildirim v2026.824.0; bütün kalemler v2026.831.0 | `releases/v2026.824.0.md`, `releases/v2026.831.0.md` |
| Ajanların Gelen kutusunu toplaması | Ajanlar, yönetişime bağlı bir kural çerçevesinde kullanıcının Gelen kutusundaki kalemleri arşivleyebilir. | Yayında | v2026.720.0 | `releases/v2026.720.0.md`, `doc/SPEC-implementation.md` §9.11 |
| Dikkat kuyruğu | Operatörü bekleyen her şeyin tek akışı; şimdi karar verilmesi gerekenlere göre sıralanır. | Yayında | v2026.720.0; sıralı akış v2026.817.0 | `releases/v2026.720.0.md`, `releases/v2026.817.0.md` |
| Decisions (kararlar) iş akışı | Ajanlar bir eylemi yapmak yerine türü belirli seçeneklerle önerir; kararı bir insan, yönetişime bağlı ve denetim kaydı tutulan bir ekranda verir. Hedefin eskidiğini algılama ve seçilen etkinin denetim kaydıyla yürütülmesi de buna dâhildir. | Yayında | Ekran v2026.720.0; önerme ve karar verme v2026.817.0 | `releases/v2026.817.0.md`, `doc/SPEC-implementation.md` §7.16 |
| Kenar çubuğunda Decisions satırı | Ana kenar çubuğundaki "Decisions" satırı; ilgi bekleyenlerin ana sayfası olarak anlatılır. | Tercih (`enableDecisions`, bu commit'te varsayılan kapalı) | Belirtilmemiş | `packages/shared/src/feature-catalog.ts`, `ui/src/components/Sidebar.tsx` |
| Karar kuyrukları, ayıklama, saklama | Kalıcı adlandırılmış kuyruklar, kalem başına ayıklama (triage) durumu (son karar tarihi, erteleme), 30 günlük eşiği olan bir eskiyenler rafı, Keep (sakla) bayrağı, geri alınabilir arşiv ve yalnızca saklanmayan kalemleri arşivleyen 90 günlük bir süpürücü. | Yayında | v2026.817.0 | `releases/v2026.817.0.md`, `doc/SPEC-implementation.md` §7.16 |
| Karar kartları | Yalnızca iki kart türü: engelleyen (kırmızı) ve inceleme (mor); eylem düğmelerinin sırası çerçeveli, yıkıcı, onaylayan; "See more" ve "See less". | Yayında olan tasarım kararı | 2026-07-29 tarihinde kararlaştırıldı | `doc/design/DECISION-SHEET.md` |
| Genel bakış | Ajan durumu, görev dağılımı, uzun süredir hareket görmeyen görevler, bütçeye karşı aylık harcama, bekleyen onaylar, çalışma etkinliği grafikleri, son etkinlik, canlı güncelleme. | Yayında | Grafikler v2026.427.0; kompakt kartlar v2026.916.0 | `docs/guides/board-operator/dashboard.md`, `releases/v2026.427.0.md`, `screenshots/PR-8000-home-flag-on.png` |
| Durum kartları | Kalıcı özetlerin durduğu ortak bir pano. Her kart tek cümleyle kurulur; bir Summarizer ajanı bu cümleyi kayıtlı aramalara çevirir; her model çağrısından önce SQL ile değişiklik denetimi yapılır; yenileme elle, belirli aralıkla ya da değişikliğe tepki olarak yapılır; her kartın günlük token tavanı vardır. | Deneysel (`enableStatusCards`, varsayılan kapalı) | v2026.817.0 | `docs/guides/board-operator/status-cards.md`, `releases/v2026.817.0.md` |
| Decision Training | Karar anlık görüntülerinden oluşan bir kitaplık ve inceleme aracı. | kararlar masasından kaldırıldı | v2026.720.0 sürümünde eklendi (deneysel); v2026.824.0 sürümünde kaldırıldı | `releases/v2026.720.0.md`, `releases/v2026.824.0.md` |
| Verimlilik incelemesi | Art arda yorumsuz kalan çalışmalar, uzun çalışmalar ve boşa dönen döngüler için otomatik inceleme görevleri. | Kaldırıldı | v2026.428.0 sürümünde eklendi; v2026.916.0 sürümünde kullanımdan kaldırıldı | `releases/v2026.428.0.md`, `releases/v2026.916.0.md` |

### 2.5 Onaylar ve yönetişim

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Onay kuyruğu | Ajanlar onay isteği gönderir; yönetim kurulu onaylar, reddeder ya da düzeltme ister. Belgelenmiş türler: `hire_agent` ve `approve_ceo_strategy`. Akış: önce bekliyor, sonra onaylandı, reddedildi ya da düzeltme istendi ve yeniden gönderildi. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/approvals.md` |
| Göreve bağlı yönetim kurulu onayları | Bir göreve bağlanan genel onaylar; görev sayfasının yan panelinde kart olarak gösterilir. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| Menü satırı olmayan onaylar | İlk arayüz spesifikasyonunda onayların üst düzey bir menü satırı yoktur; Gelen kutusu ve Genel bakış ekranlarında ve kayıtların üzerinde satır içi olarak ortaya çıkarlar. | Tasarım beyanı (taslak spesifikasyon, 2026-02-17) | yok | `doc/spec/ui.md` |
| Yürütme kuralı | Görev, yürüten işini bitirdikten sonra bir inceleme aşaması ve bir onay aşaması gerektirebilir. İnceleyenler ve onaylayanlar ajan ya da kullanıcıdır; işi ilk yürüten bunların dışında tutulur; "changes requested" (değişiklik istendi) kararı görevi geri gönderir. Her karar saklanır. | Yayında | v2026.414.0 | `docs/guides/execution-policy.md`, `releases/v2026.414.0.md` |
| Yorum zorunluluğu | Her ajan çalışması görevine bir yorum yazmak zorundadır. Her zaman açıktır. | Yayında | Yürütme kuralıyla birlikte | `docs/guides/execution-policy.md` |
| İnceleme yönetişimi | İnceleme kararları işlem (transaction) içinde verilir ve düzey düşürerek bir kuralı aşamaz; inceleme turlarının üst sınırı vardır ve turları tükenen inceleme adına çalışılan kişiye taşınır; onayı kısıtlayan şey inceleme kuralıysa arayüz bunu rozetle gösterir. | Yayında | v2026.817.0 ve v2026.824.0 | `releases/v2026.817.0.md`, `releases/v2026.824.0.md` |
| Etkileşim yanıtlama kuralı | Her akış etkileşimi kimin yanıtlayabileceğini söyler: `anyone`, `not_creator` ya da `human_only`. Şirket yönetişimi bunu daraltabilir ama hiçbir zaman genişletemez. Araç eylemi onayları her zaman `human_only` değerindedir. | Yayında | v2026.824.0 (varsayılan `anyone`) | `docs/api/issues.md`, `releases/v2026.824.0.md` |
| Araç eylemi onayı ("Ask first") | Bir ajanın bağlı bir uygulamaya yaptığı çağrı "Ask first" (önce sor) kuralına bağlıysa durur ve bir insanı bekler. Onay beklerken sağlayıcıya hiçbir çağrı yapılmaz. | Yayında | Deneysel v2026.720.0; Apps deneysel olmaktan çıktı v2026.916.0 | `doc/connections/TASK-REVIEWS.md`, `releases/v2026.916.0.md` |
| Yönetim kurulunun müdahale yetkileri | Yönetim kurulu her ajanı duraklatabilir ya da sürdürebilir, bir ajanı sonlandırabilir, her görevi başkasına atayabilir, bütçe sınırlarını geçersiz kılabilir ve doğrudan ajan oluşturabilir. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/approvals.md` |
| Etkinlik kaydı | Her değişiklik aktör, eylem, kayıt, ayrıntılar ve zamanla kaydedilir; ajana, kayıt türüne ve zaman aralığına göre filtrelenir. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/activity-log.md` |
| Tek Etkinlik sayfası | Etkinlik ve Denetim tek sayfada birleşti: tam geçmiş, filtreler, kapsam aç/kapa düğmesi (bütün aktörler ya da yalnızca ajan eylemleri) ve ajana özel denetim sekmesi. Denetim izni olmayan üyelerde ayrıcalıklı kontroller gizlenir. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| İnsan onaylı gizli anahtar önerileri | İş sırasında bir kimlik bilgisiyle karşılaşan ajan onu etkisiz bir öneri olarak teslim eder; yetkili bir insan onaylayana kadar hiçbir şey geçerli bir gizli anahtara dönüşmez. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Belge kilitleri | Yönetim kurulunun yönettiği kilit, onaylanmış belgenin anlık görüntüsünü korur; ajanın yazdıkları türetilmiş bir belgeye gider. | Yayında | v2026.517.0 | `releases/v2026.517.0.md` |
| Ajanlar arası yönetişim | Etkileşimler belirli bir ajana yöneltilebilir; döngü oluşturan görev devirleri reddedilir; duraklatılmış ajana atama reddedilir. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Şirket skill kuralı | Skill kullanımı varsayılan olarak serbesttir ve sıkılaştırmak için kontroller vardır; skill oluşturma, düzenleme ve silme `skills:create` iznini gerektirir. | Yayında | İzin v2026.626.0; kural arayüzü v2026.720.0 | `releases/v2026.626.0.md`, `releases/v2026.720.0.md`, `doc/PRODUCT.md` |
| İşe alma onayı varsayılan olarak kapalı | Yeni ya da içe aktarılmış şirketlerde, operatör açmadıkça yeni ajanlar için yönetim kurulu onayı gerekmez. | Yayında | v2026.428.0 | `releases/v2026.428.0.md` |
| Standart güven düzeyindeki ajanların şirket genelinde yazması | Standart güven düzeyindeki ajanlar, şirkette görünen her göreve yorum yazabilir, görevi güncelleyebilir ve altına alt görev açabilir. | Yayında (uyumluluğu bozan değişiklik) | v2026.817.0 | `releases/v2026.817.0.md` |
| Çalıştırma düzeneklerinde tam otomatik varsayılanlar | Çalıştırma düzenekleri (harness), kısıtlayıcı bir mod ayarlanmadıkça sağlayıcı araçları ve bağlı araçlar için varsayılan olarak hepsini onaylar; Paperclip'in kendi onay kararları yine geçerlidir. | Yayında (uyumluluğu bozan değişiklik) | v2026.1001.0 | `releases/v2026.1001.0.md` |
| Düşünme metninin yorumlara girmemesi | Ajanın akıl yürütme metni otomatik görev yorumlarının dışında tutulur. | Yayında | v2026.831.0 | `releases/v2026.831.0.md` |
| Kurumsal RBAC | Daha zengin kural yönetimi, ayrı bir "Paperclip EE" için anılır; çekirdek, işe kurumsal RBAC ile başlamaktan kaçınır. | Çekirdekte yok | yok | `doc/PRODUCT.md`, `doc/SPEC-implementation.md` |

### 2.6 Maliyetler ve bütçeler

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Maliyet olayları | Her çalışma sağlayıcıyı, modeli, giriş token'larını, çıkış token'larını ve sent cinsinden maliyeti bildirir. Toplamlar ajan başına ve UTC takvim ayı başına tutulur. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/costs-and-budgets.md` |
| Şirket ve ajan bütçeleri | Şirket için ve her ajan için aylık bütçe. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/costs-and-budgets.md` |
| Yüzde 80'de uyarı, yüzde 100'de durdurma | Yüzde 80'de ajan kritik işe odaklanması için uyarılır; yüzde 100'de kendiliğinden duraklatılır ve bütçe yükseltilene ya da ay bitene kadar bir daha uyandırılmaz. | Yayında | v0.2.7 öncesi | `docs/guides/board-operator/costs-and-budgets.md`, `doc/SPEC-implementation.md` §13 |
| Proje bütçesi | Proje başına isteğe bağlı üçüncü bir bütçe katmanı; README şirket, ajan ve proje bütçelerini eşik uyarılarıyla birlikte sayar. | İsteğe bağlı katman olarak yayında | Belirtilmemiş | `doc/SPEC-implementation.md` §13, `README.md` |
| Yenilenen maliyet ve bütçeleme | Maliyet takibi ve bütçe ekranları elden geçirildi. | Yayında | v2026.318.0 | `releases/v2026.318.0.md`, `ROADMAP.md` ("Better Budgeting") |
| Maliyet kırılımları | Ajana, ajan ve modele, sağlayıcıya, faturalayana ve projeye göre harcama; dönem harcaması ve kota dönemleri; görev başına maliyet. | Yayında (CLI ve API) | Görev başına maliyet özeti v2026.512.0 | `doc/CLI.md` (maliyet komutları), `docs/api/costs.md`, `releases/v2026.512.0.md` |
| Bütçe kuralları ve olayları | Bütçe özeti, kural ekleme ya da güncelleme ve olay çözme için CLI komutları vardır. Plan; yumuşak uyarı ile kesin durdurma ayrımını, `budget_override_required` onayını ve üç çözüm yolunu anlatır: yükselt ve sürdür, bir kez sürdür, duraklatılmış bırak. | CLI yayında; davranış tanımı bir plandan | Belirtilmemiş | `doc/CLI.md`, `doc/plans/2026-03-14-budget-policies-and-enforcement.md` |
| Finans olayları | Tek bir model çağrısı olmayan ücretler (bakiye yüklemeleri, platform ücretleri) için bir defter. | CLI yayında; tasarım bir plandan | Belirtilmemiş | `doc/CLI.md`, `doc/plans/2026-03-14-billing-ledger-and-reporting.md` |
| Çalışma öncesi bütçe tavanı | Tek bir uyandırmanın harcayabileceği tutar için kesin bir tavan; çalışma başlamadan önce denetlenir. | Yayında | v2026.626.0 | `releases/v2026.626.0.md` |
| Önbelleğe göre düzeltilmiş çalışma maliyeti | Adaptörler, istem önbelleği indirimlerinden sonra faturalanan maliyeti bildirir. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Gelen kutusu gruplarında token ve çalışma süresi toplamları | Gelen kutusundaki her grup toplam token'ı ve toplam çalışma süresini gösterir. | Yayında | v2026.512.0 | `releases/v2026.512.0.md` |
| Daha az gereksiz uyandırma | Gereksiz yeniden uyandırmalar kısılır ve yürütme sözleşmesi her yeni çalışmada bir kez eklenir; böylece yinelenen token harcaması azalır. | Yayında | v2026.720.0 (token iyileştirmesi v2026.318.0 sürümünden beri) | `releases/v2026.720.0.md`, `releases/v2026.318.0.md` |
| Bütçe ve kota çubukları | Çubukların dolgusu sorun yokken yeşil, uyarıda sarı, aşıldığında kırmızıdır; üzerinde "$ used / $ cap" yazar. | Yayında olan arayüz öğesi | Belirtilmemiş | `docs/pr-screenshots/pr-5291/after-status-language.png`, `doc/design/DECISION-SHEET.md` |
| Maliyeti kişiye bağlayan kullanıcı profili | Kullanıcının etkinliğini ve maliyetini gösteren bir profil sayfası. | Yayında | v2026.427.0 | `releases/v2026.427.0.md` |
| Ucuz model profilleri | Kurtarma ve önemi düşük işler için ikinci, daha ucuz bir model. | Kaldırıldı | v2026.512.0 sürümünde eklendi; v2026.817.0 sürümünde varsayılan olarak kapatıldı; v2026.916.0 sürümünde kaldırıldı | `releases/v2026.512.0.md`, `releases/v2026.916.0.md` |
| Akıllı model yönlendirme | Hafif orkestrasyon için ucuz bir model, asıl iş için ana model. | Planlandı (2026-04-06 tarihinde önerildi) | yok | `doc/plans/2026-04-06-smart-model-routing.md` |

### 2.7 Hedefler ve projeler

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Hedefler | Hedeflerin bir düzeyi (şirket, ekip, ajan) ve bir durumu (planlandı, etkin, ulaşıldı, iptal) vardır ve bir ağaç oluştururlar; görevler bir hedefe kadar izlenebilir. | Yayında | v0.2.7 öncesi | `docs/api/goals-and-projects.md`, `docs/guides/board-operator/managing-tasks.md` |
| Kenar çubuğunda Hedefler bağlantısı | Ana kenar çubuğundaki Hedefler (Goals) satırı varsayılan olarak gizlidir; gerekçe: "while the goals surface is being evaluated" (hedefler ekranı değerlendirilirken). | Tercih (`enableGoalsSidebarLink`, varsayılan kapalı) | Belirtilmemiş | `packages/shared/src/feature-catalog.ts` |
| Projeler | Görevleri bir teslimata doğru gruplar; durum etiketi, hedef bağlantıları, açıklama, arşiv. | Yayında | v0.2.7 öncesi | `docs/api/goals-and-projects.md`, `docs/pr-screenshots/pr-5291/after-projects-workspaces.png` |
| Proje ortam değişkenleri | Projede tanımlanan değişkenler o projenin çalışmalarına aktarılır. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| Yıldızlı ve gizli projeler | Projeler yıldızlanarak kenar çubuğundaki bir bölüme alınır; kişi projeleri kendi kenar çubuğundan gizleyebilir. | Yayında | Gizleme v2026.529.0; yıldızlama v2026.707.0 | `releases/v2026.529.0.md`, `releases/v2026.707.0.md` |
| Duraklatılmış projede rutinlerin durması | Proje duraklatılmışken zamanlanmış rutin tetiklenmeleri bastırılır. | Yayında | v2026.609.0 | `releases/v2026.609.0.md` |
| Arşivlenmiş projelerin varsayılan olarak gizlenmesi | Arşivlenmiş projeler varsayılan proje listesine alınmaz. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Proje özet yuvaları | Proje ve çalışma alanı sayfalarında Summarizer'ın yazdığı durum metni; yenileme ve sürüm geçmişi vardır. | Deneysel (`enableSummaries`, varsayılan kapalı) | v2026.720.0 | `releases/v2026.720.0.md`, `packages/shared/src/feature-catalog.ts` |
| Proje ve yürütme çalışma alanları | Proje başına kod kopyaları (checkout) ve görev başına, çalışma zamanı servisleri olan yalıtılmış worktree'ler. | Deneysel (`enableIsolatedWorkspaces`, varsayılan kapalı) | v2026.318.0 | `releases/v2026.318.0.md`, `docs/guides/board-operator/execution-workspaces-and-runtime-services.md` |

### 2.8 Rutinler ve otomasyon

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Rutinler | Zamanlamayla, webhook ile, API'den ya da elle çalışma başlatan yinelenen görev tanımı. Yaşam döngüsü: etkin, duraklatılmış, arşivlenmiş. | Yayında | v2026.325.0 | `releases/v2026.325.0.md`, `docs/api/routines.md` |
| Çakışma kuralı | Bir çalışma sürerken yenisi tetiklenirse ne olacağı: `coalesce_if_active` (varsayılan), `skip_if_active` ya da `always_enqueue`. | Yayında | Rutinlerle birlikte | `docs/api/routines.md` |
| Telafi kuralı | Kaçırılan çalışmalara ne olacağı: `skip_missed` (varsayılan) ya da `enqueue_missed_with_cap`. | Yayında | Rutinlerle birlikte | `docs/api/routines.md` |
| Değişkenler | Rutinler değişken, başlık değişkeni, çalışma anında verilen değer ve tarih değişkeni alır; düzenleyicide satır içi yardım vardır. | Yayında | Değişkenler v2026.403.0; başlık değişkenleri v2026.414.0; yardım v2026.428.0; tarih değişkenleri v2026.626.0 | `releases/v2026.403.0.md`, `releases/v2026.414.0.md`, `releases/v2026.626.0.md` |
| Geri yüklemeli sürüm geçmişi | History (geçmiş) sekmesi olan, yalnızca ekleme yapılan bir kayıt; eski bir tanım ön izlenebilir, farkı görülebilir ve geri yüklenebilir. | Yayında | v2026.512.0 | `releases/v2026.512.0.md` |
| Rutin gizli anahtarları ve ortam değişkenleri | Rutin kendi ortamını ve gizli anahtar referanslarını taşır; öncelik sırası ajan, sonra proje, sonra rutindir. | Yayında | v2026.525.0 | `releases/v2026.525.0.md` |
| Rutin ayrıntı sayfası | İkinci kenar çubuğu olan, yeniden tasarlanmış ayrıntı sayfası. | Yayında | v2026.618.0 | `releases/v2026.618.0.md` |
| Etkinlik kapılı rutinler | Zamanlanmış çalışma yakın zamandaki etkinliğe bağlanabilir; böylece rutin yalnızca gerçek iş varken tetiklenir. | Yayında | v2026.720.0; düzenleyici ve API v2026.817.0 | `releases/v2026.720.0.md`, `releases/v2026.817.0.md` |
| Rutin listesinde klasörler | Rutin listesi klasör adına göre gruplanır. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Güvenli webhook'lu tetikleyici sihirbazı | Zamanlama ve webhook tetikleyicileri için bir sihirbaz; tek seferlik kimlik bilgileri, deneme gönderiminin teslim kaydı, geri alınabilir kaldırma ve webhook adresine dışarıdan erişilemeyebileceği durumda uyarı içerir. | Yayında | v2026.1001.0 | `releases/v2026.1001.0.md` |
| Webhook imzalama | İmzalama modları: bearer, `hmac_sha256`, `github_hmac`, none (imzasız). | Yayında | `github_hmac` ve none v2026.414.0 | `docs/api/routines.md`, `releases/v2026.414.0.md` |
| Rutini çalıştırma penceresi ve filtre | Elle çalıştırma penceresi; rutin çalışmaları görev listelerinde görünür ve "Hide routine runs" (rutin çalışmalarını gizle) filtresi vardır. | Yayında | v2026.415.0 | `releases/v2026.415.0.md` |
| Telafi çalışmalarının birleştirilmesi | Bir saatten kısa aralıklı telafi çalışmaları birleştirilir; böylece birikmiş işler topluca tetiklenmez. | Yayında | v2026.720.0 | `releases/v2026.720.0.md` |
| İş kuyrukları | Yol haritasında adı geçen kalem. | Planlandı | yok | `ROADMAP.md` |

### 2.9 Skill'ler

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Şirket skill kitaplığı | Şirket kapsamında bir skill kitaplığı (talimatları içeren bir `SKILL.md` ve isteğe bağlı dosyalar); ajanlarla eşitlenir. | Yayında | v2026.325.0 | `releases/v2026.325.0.md`, `docs/guides/agent-developer/writing-a-skill.md` |
| Skill kataloğu ve CLI | Uygulamayla gelen bir katalogdan skill kurma, sıfırlama, denetleme, dışa aktarma ve atama. | Yayında | v2026.529.0 | `releases/v2026.529.0.md`, `doc/CLI.md` |
| Skill mağazası (Skills Store) | Skill'lere göz atmak ve kurmak için uygulama içi mağaza; kurulum sayılarını gösterir. | Yayında | v2026.618.0 | `releases/v2026.618.0.md`, `docs/guides/agent-developer/skills-store.md` |
| Skill Studio | Üç bölmeli skill düzenleyicisi; sandbox içinde deneme çalışmaları, iç içe klasörler ve "My Skills" görünümü vardır. | Yayında | v2026.720.0 | `releases/v2026.720.0.md` |
| Sürümler, sapma ve sıfırlama | Skill'lerin sürümleri vardır; mağaza güncellemeleri ve sapmayı gösterir, skill'i sıfırlayabilir; çatallamada ön denetimler çalışır. | Yayında | Kalem bazında belirtilmemiş | `docs/guides/agent-developer/skills-store.md`, `ROADMAP.md` ("Skill Version History & Restore") |
| Güven düzeyleri | Skill `markdown_only`, `assets` ya da `scripts_executables` düzeyindedir. | Yayında | Belirtilmemiş | `docs/guides/agent-developer/skills-store.md` |
| Paylaşım kapsamı | Skill özel, şirkete açık ya da herkese açık bağlantılı olabilir. | Yayında | Belirtilmemiş | `docs/guides/agent-developer/skills-store.md` |
| Skill kitaplığının ajanlara ulaşması | Her çalışma, şirketin skill'lerinin bir listesini (manifest) taşır; skill kurulurken "Enable for agents" (ajanlar için etkinleştir) adımı sunulur; yeni CEO ajanları beş temel skill alır. | Yayında | v2026.831.0 | `releases/v2026.831.0.md` |
| Otomatik etkinleştirme ve eğik çizgiyle tamamlama | Adı anılan skill o çalışma için etkinleştirilir; skill adları düzenleyicide otomatik tamamlanır. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| Skill kategorileri | Skill kategorileri ayarlardan düzenlenir. | Yayında | v2026.626.0 | `releases/v2026.626.0.md` |
| İşten üretilen skill'ler | Bir çalıştırıcı aracı, görevden öğrenilenleri şirket skill'i olarak kaydeder; akışta, skill'i bir görev sekmesinde açan "Skill created" kartı görünür. | Yayında | v2026.1001.0 | `doc/runner-created-skills.md`, `releases/v2026.1001.0.md` |
| GitHub kaynaklarından skill'ler | Sources (kaynaklar) sekmesi bir depodan skill klasörlerini içe aktarır ve istek üzerine yeniler; ajanlar çalışma sırasında GitHub'dan hiçbir şey çekmez. | Beta notları | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| Birlikte gelen katalog | 17 katalog skill'i. Paketle gelenler: doc-maintenance, issue-triage, reflection-coach, status-card-query, summarize-status, task-planning, paperclip-capsules, wireframe, qa-acceptance, github-pr-workflow. İsteğe bağlı olanlar: agent-browser, release-announcement, simplified-english, ramp, design-critique, last30days, prepare-mcp-integration. | Yayında | Çeşitli | `packages/skills-catalog/generated/catalog.json` |
| Çalışma zamanı skill'leri | Depo kökünde gelen skill'ler: agentmail, paperclip, paperclip-board, paperclip-converting-plans-to-tasks, paperclip-create-agent, para-memory-files, slack. | Yayında | Çeşitli | `skills/` |
| Beta skill'ler | Ajanlar temel Paperclip skill'inin beta sürümlerine sabitlenebilir. | Tercih (`enableBetaSkills`, varsayılan kapalı) | Belirtilmemiş | `packages/shared/src/feature-catalog.ts` |

### 2.10 Araçlar, uygulamalar ve bağlantılar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Uygulamalar, Bağlantılar, İnceleme (Apps, Connections, Review) | Ürünün üç kapısı: uygulamalara göz atma, bağlantıları yönetme, bekleyen eylemleri inceleme. Protokol terimleri (MCP, gateway, manifest) Developer (geliştirici) alanının arkasında kalır. Kenar çubuğundaki etiket "Connectors" sözcüğüdür. | Yayında | Deneysel v2026.720.0; deneysel olmaktan çıktı v2026.916.0 | `doc/connections/README.md`, `doc/connections/GLOSSARY.md`, `ui/src/components/Sidebar.tsx` |
| Eylem başına kurallar | Bağlantının her eylemi üç sonuçtan birini alır. README bunları "Allowed, Ask first, or Off" (serbest, önce sor, kapalı) diye yazar; sözlük ise allow, ask-first ya da block der. Kurallar yukarıdan aşağıya denetlenir ve sonucu ilk eşleşen kural belirler. | Yayında | Apps ile birlikte | `README.md`, `doc/connections/GLOSSARY.md`, `doc/screenshots/garden-mcp-split-stack/policies.png` |
| Görevdeki inceleme kartı | Görev akışı her inceleme için tek bir kayıt tutar. "Approve & run" (onayla ve çalıştır) saklanan, imzalı argümanları bir kez çalıştırır; "Decline" (reddet) hiçbir şey çalıştırmaz. Aynı karar, kalemi merkezî inceleme (Review) sırasından da kaldırır. | Yayında | v2026.916.0 (görevden incelenir) | `doc/connections/TASK-REVIEWS.md`, `releases/v2026.916.0.md` |
| Her zaman izin ver (Always allow) | İki parçalı bir düğme, onayı aynı ajan, bağlantı ve eylem için bir kural olarak kaydeder; kural, isteğin geldiği projeyle sınırlıdır. Araç tanımı değişirse yeniden inceleme gerekir. | Yayında | Görev incelemeleriyle birlikte | `doc/connections/TASK-REVIEWS.md` |
| İnceleme açıkken ajanın görevi bitirememesi | Bağlı bir eylem beklerken, onaylanmışken ya da yürütülürken görevin tamamlanması reddedilir. Ajana diğer işleri bitirmesi ve sırayı bırakması söylenir. | Yayında | Görev incelemeleriyle birlikte | `doc/connections/TASK-REVIEWS.md` |
| Güvenilmeyen olarak işaretlenen araç sonuçları | Sağlayıcı çıktısı ajana ayrı bir `untrustedToolResults` alanında gider; açık bir sınırla ayrılmış ayrı bir veri bloğu olarak yazılır. | Yayında | Görev incelemeleriyle birlikte | `doc/connections/TASK-REVIEWS.md` |
| Risk sınıfları ve karantina | Her araç okuma, yazma ya da yıkıcı olarak sınıflandırılır. Bilinmeyen araçlar reddedilir; yeni yazma araçları ve yıkıcı araçlar incelenene kadar karantinada tutulur. | Yayında | v2026.720.0 (araç geçidi) | `doc/RELEASE-NOTES-mcp-access-governance.md` |
| Erişim profilleri | Şirkete, projeye, ajana, rutine ya da göreve bağlanan, adlandırılmış eylem izin listeleri. Sihirbazdaki hazır seçenekler: Salt okunur, Gündelik iş, Tam erişim, Sıfırdan başla. | Yayında | v2026.720.0 | `doc/connections/GLOSSARY.md`, `doc/screenshots/garden-mcp-split-stack/` |
| Araç çağrısı denetimi | Her çağrının karar, eşleşen kural, gerekçe, gecikme ve sonuç bilgisiyle tutulduğu, yalnızca ekleme yapılan bir kayıt. | Yayında | v2026.720.0 | `doc/RELEASE-NOTES-mcp-access-governance.md` |
| Bağlantı sağlığı | "Healthy" (sağlıklı) ve "Needs attention" (ilgi gerekiyor) etiketleri ve Yeniden bağlan (Reconnect) düğmeleri olan bir bağlantılar tablosu. | Yayında | Apps ile birlikte | `doc/screenshots/garden-mcp-split-stack/` |
| Görevden bağlantı isteği | Bir uygulamaya ihtiyaç duyan ajan, akışta adına çalışılan kişiye sorar; kullanıcı uygulamayı bir pencerede bağlar ve ajan işine devam eder. İsteği yalnızca karttaki "Not now" (şimdi değil) reddeder. | Yayında | v2026.916.0 | `doc/connection-intents.md`, `releases/v2026.916.0.md` |
| Bağlantı olarak yapay zekâ hesapları | Model sağlayıcı girişleri (abonelikler, API anahtarları, ortak hesaplar) yetkileri (grant) olan, yönetilen bağlantılardır; ajanlar adına çalışılan kişinin hesabını ya da izin verilen ortak bir hesabı kullanır. | Yayında | v2026.916.0 | `releases/v2026.916.0.md`, `doc/connections/AI-CONNECTIONS.md` |
| Bağlayıcı kataloğu | Sürüm notlarında adı geçen bağlayıcılar: Notion (v2026.817.0); Composio, Gmail, PostHog, Postman, Shopify, Google Workspace (v2026.916.0); Railway, You.com (v2026.1001.0); Fireflies, Browser Use Cloud (beta notları). | Yayında; son ikisi beta notlarında | Listelendiği gibi | `releases/v2026.817.0.md`, `releases/v2026.916.0.md`, `releases/v2026.1001.0.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Dokuz uygulama olarak Google Workspace | Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat, People ve Workspace Search ayrı bağlantılardır. Gmail yalnızca `gmail.readonly` ve `gmail.compose` izinlerini ister. Google OAuth doğrulaması beklendiği için dokuz kart geçici olarak gizlidir. | Yayında; Bağlantılar sayfasında gizli | v2026.916.0; beta notlarında gizlendi | `doc/connections/GOOGLE-WORKSPACE.md`, `doc/connections/GMAIL.md` |
| Tek ekranlı bağlayıcı kurulumu | Kurulum, varsayılanları söyleyen tek bir ekrandır; geri kalanı "Change" (değiştir) bağlantısının ve Permissions (izinler) sekmesinin arkasındadır. | Beta notları | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| MCP toplayıcıları | Bağlantı kaynağı olarak Zapier, Arcade, Composio Connect ve Executor. | Yayında; bu commit'te her zaman açık | Bayrağa bağlı v2026.1001.0; beta notlarında varsayılan olarak açık | `releases/v2026.1001.0.md`, `packages/shared/src/feature-catalog.ts` |
| Bağımsız MCP sunucusu | `@paperclipai/mcp-server`, Paperclip API'sini MCP araçları olarak sunar. | Yayında (BETA etiketli) | v2026.414.0 | `releases/v2026.416.0.md` |
| Geçitler (Gateways) | Seçilen bağlantıları dış istemcilere açan, adlandırılmış gelen MCP uç noktaları. | Yayında, Developer alanında | v2026.720.0 | `doc/connections/GLOSSARY.md` |
| Bellek bağlayıcıları | Bellek sağlayıcısı olarak Mem0, Zep, Supermemory, Cognee ve Honcho. | Deneysel (`enableMemoryConnectors`, varsayılan kapalı) | Beta notları | `doc/connections/MEMORY.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Smoke Lab | Entegrasyon yollarını yerel test verilerine karşı sınamak için bir sekme. | Bayrak (`enableSmokeLab`, varsayılan kapalı) | v2026.720.0 | `packages/shared/src/feature-catalog.ts` |
| Yönetişime bağlı API araçları | `search_api` ve `call_api` çalıştırıcı araçları. | Beta notları (varsayılan olarak açık) | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| GitHub kimlikleri | GitHub erişimi tek bir ortak token yerine kişi başına kimliklerle sağlanır. | Yayında | v2026.916.0 | `releases/v2026.916.0.md` |
| Kendi iş takip sistemini getir | Görev arka ucu olarak Asana, Linear ya da Jira. | Planlandı | yok | `ROADMAP.md` |

Not: `ui/public/brands/apps/` klasöründe yaklaşık 80 servisin marka görselleri var. Marka görseli, çalışan bir bağlayıcının kanıtı değildir; bu yüzden yukarıda yalnızca sürüm notlarında adı geçen bağlayıcılar listelendi.

### 2.11 Gizli anahtarlar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Şirket gizli anahtarları | Bir gizli anahtar envanteri; ajan, proje ve rutin ortamları değerleri tutmak yerine gizli anahtarlara referans verir. | Yayında | Belirtilmemiş | `docs/deploy/secrets.md`, `docs/api/secrets.md` |
| Kayıtlarda maskeleme | Gizli anahtarlar çalışma kayıtlarında ve HTTP hata kaydı satırlarında maskelenir. | Yayında | Çalışma kayıtları v0.3.0; HTTP hataları v2026.618.0 | `releases/v0.3.0.md`, `releases/v2026.618.0.md` |
| Sağlayıcı kasaları | Dış bir kasa bağlanır; AWS Secrets Manager'dan ön izleme ve kaydetme adımlarıyla içe aktarma; AWS kasa keşfi. | Yayında | v2026.512.0; keşif v2026.525.0 | `releases/v2026.512.0.md`, `releases/v2026.525.0.md` |
| Gizli anahtar bağlama seçicisi | Bütün yapılandırma formlarında gizli anahtar referansları için tek bir seçici. | Yayında | v2026.525.0 | `releases/v2026.525.0.md` |
| Ortam değişkeni düzenleyicisi | Ortam değişkenleri için her yerde aynı düzenleyici; satırlar düz ya da gizli olabilir, hassas değerler için uyarı verir. | Yayında | v2026.707.0 | `releases/v2026.707.0.md` |
| Kullanıcıya özel gizli anahtarlar | Bir gizli anahtar her insan kullanıcı için ayrı bir değer tutabilir; çalışma, adına çalışılan kişinin bir değeri olup olmadığını denetler. | Yayında | v2026.707.0 | `releases/v2026.707.0.md` |
| Ajan başına gizli anahtar erişimi | Gizli anahtar penceresinde erişim ajan başına verilir; ajanlar izin verilen gizli anahtarları, çalışmaya bağlı bir API üzerinden istek anında alır. | Yayında | Pencere v2026.720.0; çalışmaya bağlı erişim v2026.722.0 | `releases/v2026.720.0.md`, `releases/v2026.722.0.md` |
| Klasör olarak gizli anahtarlar | Adında eğik çizgi olan gizli anahtarlar iç içe klasörler olarak gezilir. | Yayında | v2026.722.0 | `releases/v2026.722.0.md` |
| Ajanlar için gizli anahtar kataloğu | Salt okunur bir uç nokta, değerleri vermeden gizli anahtar adlarını kimliklerle eşler. | Yayında | v2026.824.0 | `releases/v2026.824.0.md` |
| Ajan API'lerinde açık metin kimlik bilgisi olmaması | Ajan yanıtlarında ortam değerleri maskelenir. | Yayında | v2026.916.0 | `releases/v2026.916.0.md` |

### 2.12 Eklentiler

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Eklenti çerçevesi ve SDK | Eklentiler, yetenekleri bildirilmiş ayrı worker süreçleri olarak çalışır; sayfa, ayrıntı sekmesi, Genel bakış bileşeni, kenar çubuğu satırı ve ayar sayfası ekleyebilir. | Yayında | v2026.318.0 | `releases/v2026.318.0.md`, `doc/plugins/PLUGIN_SPEC.md` |
| Eklenti yöneticisi | Kurulum ayarları, kurulu ve paketle gelen eklentileri listeler. | Yayında | Paketle gelen eklentilerin listelenmesi v2026.529.0 | `releases/v2026.529.0.md` |
| Eklentilere açılan daha geniş yüzey | Eklentiler kapsamı sınırlı veritabanı ad alanları, yönetilen ajanlar ve rutinler, kapsamı sınırlı API'ler ve ortak arayüz parçaları alır. | Yayında | v2026.512.0 | `releases/v2026.512.0.md` |
| Yerel eklenti geliştirme | `paperclipai plugin init`, geliştirme izleyicisi olan bir eklenti iskeleti oluşturur. | Yayında | v2026.513.0 | `releases/v2026.513.0.md` |
| LLM Wiki eklentisi | Yerel dosyalara dayanan bir wiki; kaynak alma, gezinme, sorgulama ve yönetilen bir "Wiki Maintainer" ajanı vardır. | Alfa eklenti olarak yayında | v2026.512.0 | `packages/plugins/plugin-llm-wiki/README.md`, `releases/v2026.512.0.md` |
| Çalışma alanı fark eklentisi | Yürütme çalışma alanlarında, yan yana ve birleşik fark görünümü olan bir Changes (değişiklikler) sekmesi. | Yayında | v2026.525.0 | `releases/v2026.525.0.md` |
| Sandbox sağlayıcı eklentileri | E2B, Cloudflare, Daytona, Modal, Kubernetes, Novita, CreateOS, exe.dev. | Eklenti olarak yayında; Environments arayüzü deneysel (`enableEnvironments`, varsayılan kapalı) | E2B v2026.427.0; Modal v2026.525.0; Kubernetes ve Novita v2026.618.0; CreateOS v2026.1001.0 | `packages/plugins/`, `releases/v2026.427.0.md`, `releases/v2026.618.0.md` |
| Örnek eklentiler | Hello world bileşeni, dosya tarayıcı sekmesi, kitchen sink demosu, iki smoke örneği. | Örnek olarak yayında | Kitchen sink v2026.318.0 | `packages/plugins/` |
| Eklenti güveniyle ilgili uyarı | Eklenti arayüzü, aynı kaynaktan (same-origin) çalışan güvenilir kod sayılır. | Belgelenmiş sınır | yok | `doc/plugins/PLUGIN_SPEC.md` |

`packages/plugins/` altındaki paketler, her biri tek satırda (açıklamalar her paketin `package.json` dosyasından):

- `@paperclipai/plugin-sdk` (`sdk/`): eklentiler için kararlı ve dışa açık API; worker tarafı bağlamını ve arayüz köprüsü hook'larını içerir.
- `@paperclipai/create-paperclip-plugin`: yeni eklenti için iskelet oluşturucu.
- `@paperclipai/plugin-llm-wiki`: yerel dosyalara dayanan LLM Wiki; kaynak alma, wiki'de gezinme, sorgulama, lint ve bakım iş akışları için.
- `@paperclipai/plugin-workspace-diff`: yürütme çalışma alanındaki Changes sekmesi.
- `@paperclipai/plugin-fake-sandbox`: testler için deterministik sahte sandbox sağlayıcısı.
- `examples/plugin-hello-world-example`: Genel bakış ekranına bir Hello World bileşeni ekleyen referans eklenti.
- `examples/plugin-file-browser-example`: proje kenar çubuğunda Files bağlantısı ve dosya tarayıcısı olan bir proje ayrıntı sekmesi.
- `examples/plugin-kitchen-sink-example`: eklenti yüzeyinin tamamını tek pakette gösterir.
- `examples/plugin-authoring-smoke-example` ve `examples/plugin-orchestration-smoke-example`: eklenti yazma akışı ve orkestrasyon API'leri için smoke eklentileri.
- `sandbox-providers/`: `cloudflare`, `createos`, `daytona`, `e2b`, `exe-dev`, `kubernetes`, `modal`, `novita`; her biri Paperclip ortamları için bir sandbox sağlayıcı eklentisidir.

### 2.13 Sohbet ve dış kanallar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Ajan sohbeti (Agent Chat) | Her kişinin her ajanla tek bir kalıcı konuşması vardır. Konuşmanın altında gerçek bir görev vardır, bu yüzden olağan yönetişim geçerlidir; iş görevlere devredilebilir ve tamamlanınca sonuç sohbete geri döner. `/new` sağlayıcı bağlamını sıfırlar. | Deneysel (`enableAgentChat`, varsayılan kapalı) | v2026.916.0; kendi kenar çubuğu ve açılış sayfası beta notlarında | `doc/PRODUCT.md`, `doc/plans/2026-09-10-agent-chat.md`, `releases/v2026.916.0.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Sohbet geçmişinde yanıtlanmamış sorular | Bekleyen soru, sohbet geçmişinde kompakt bir "Unanswered question" (yanıtlanmamış soru) satırı olarak kalır ve sonradan yanıtlanabilir. | Deneysel, ajan sohbetiyle birlikte | Beta notları | `DESIGN.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Conference Room Chat | Bütün ajan ekibiyle tek bir ekip sohbeti ve canlı bir "Agent Feed". | Bayrak var (`enableConferenceRoomChat`, varsayılan kapalı); açma kontrolü ayar sayfasının kaynak kodunda gizlenmiş; hiçbir sürüm notunda adı geçmiyor | Bu adla yayımlanmadı | `packages/shared/src/feature-catalog.ts`, `ui/src/pages/InstanceExperimentalSettings.tsx`, `screenshots/PR-8000-conference-room-flag-on.png` |
| Sohbet bağlayıcıları | Bir Slack, Discord, Telegram, Microsoft Teams ya da GitHub botu tek bir ajana bağlanır. Kabul edilen her dış konuşma; kuyruğu, soruları, ilerlemesi, dosyaları ve teslim kayıtları olan tek bir göreve dönüşür. | Deneysel (`enableChatConnectors`, varsayılan kapalı) | v2026.916.0 | `docs/guides/board-operator/experimental-features.md`, `releases/v2026.916.0.md` |
| Varsayılan olarak şirket içinde | "Send to channel" (kanala gönder) seçilmedikçe yönetim kurulu yorumları şirket içinde kalır. Ham akıl yürütme, kayıtlar ve kimlik bilgileri hiçbir zaman gönderilmez. | Deneysel, sohbet bağlayıcılarıyla birlikte | v2026.916.0 | `releases/v2026.916.0.md`, `doc/plans/chat-adapters/2026-09-04-chat-adapters-ui-surfaces-v8.md` |
| Altı adımda Slack kurulumu | Numaralı kurulum; üretilen bir oluşturma bağlantısı, kimlik bilgisi doğrulama, canlı bağlantı durumu ve bir deneme mesajı içerir; şirket bir Slack bağlantısına iletişim yönergesi ekleyebilir. | Deneysel, sohbet bağlayıcılarıyla birlikte | v2026.1001.0 | `releases/v2026.1001.0.md`, `doc/connections/CHAT-CONNECTOR-UX.md` |
| İki yönlü Slack | Yönetim kurulu tarafında yazılan yanıtlar bağlı Slack ileti dizisine ulaşır. | Beta notları | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| Photon üzerinden iMessage | iMessage konuşmaları göreve dönüşür; görev sahipliği ve onay yetkisi Paperclip'te kalır. | Deneysel | v2026.916.0 | `releases/v2026.916.0.md`, `doc/connections/IMESSAGE-PHOTON.md` |
| AgentMail | Ajan kendi e-posta adresini alır. Sağlayıcıdaki her ileti dizisi tek bir göreve dönüşür. Gönderme açık bir ajan eylemidir; görev içi yorumlar hiçbir zaman e-posta olarak dışarı çıkamaz. Sağlayıcı anahtarı sunucudaki kasada kalır. | Yayında. Sürüm notu deneysel demişti; bağlantı belgesi deneysel bir ayar gerekmediğini söylüyor | v2026.916.0 | `doc/connections/AGENTMAIL.md`, `releases/v2026.916.0.md` |
| Sohbet bağlayıcısı yönetim sekmeleri | Her bağlayıcının Ayarlar, Erişim, Konuşmalar ve Etkinlik sekmeleri vardır. | Deneysel, sohbet bağlayıcılarıyla birlikte | v2026.916.0 | `doc/connections/CHAT-CONNECTOR-UX.md` |
| CLI'den istem devri | `agent prompt` ve `board prompt`, komut satırından bir ajan için görev oluşturur. "It does not create a chat session." (sohbet oturumu oluşturmaz). | Yayında | Belirtilmemiş | `doc/CLI.md` |

### 2.14 Çıktılar ve belgeler

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Görev belgeleri | Belgeler görevin üzerinde durur (örneğin plan); satır içi düzenleme, doğrudan bağlantı, kopyalama ve indirme vardır. | Yayında | v2026.318.0 | `releases/v2026.318.0.md`, `docs/api/issues.md` |
| Sürümler, geri yükleme, fark | Her kayıt bir sürümdür; eski sürümler geri yüklenebilir; yan yana fark görüntüleyici sürümleri karşılaştırır. | Yayında | Sürümler v2026.403.0; fark v2026.414.0 | `releases/v2026.403.0.md`, `releases/v2026.414.0.md` |
| Satır içi notlar | Belge sürümündeki bir pasaja bağlanan yorum dizileri; sonradan kenar boşluğuna yerleştirildi; notlar ajana inceleme bağlamı olarak ulaşır. | Yayında | v2026.529.0; kenar boşluğu v2026.824.0 | `releases/v2026.529.0.md`, `releases/v2026.824.0.md` |
| Belgeye yıldız | Kişi bir belgeyi kendisi için yıldızlayabilir. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Tam görünüm için doğrudan bağlantı | `viewer=full`, belgeyi tam boy açar; dış bildirimlerden gelen bağlantılar içindir. | Yayında | v2026.916.0 | `releases/v2026.916.0.md` |
| Şirket Çıktılar (Artifacts) sayfası | Görevlerdeki ve çalışmalardaki bütün çıktıları dizinleyen tek sayfa; görev yığınına göre gruplanır, yükleme ve video küçük resimleri vardır. | Yayında | v2026.609.0 | `releases/v2026.609.0.md` |
| Çıktı kartları ve Çıktılar sekmesi | Çıktılar zengin kartlar olarak görünür; her görevin, çalışma çıktılarının envanterini içeren bir Çıktılar sekmesi vardır. Daha zengin ön izlemeler ile görsel ve video galerisi beta notlarındadır. | Yayında; galeri beta notlarında | v2026.916.0 | `releases/v2026.916.0.md`, `doc/AGENT-ARTIFACTS.md`, `releases/beta/v2026.1002.0-beta.0.md` |
| Teslimat kaydı | Ajanlar bir teslimatı kaydeder ve teslimat çıktı olarak görünür; metin ekleri biçimlendirilmiş (Rendered) ya da ham (Raw) olarak ön izlenir. | Yayında | Belirtilmemiş | `doc/AGENT-ARTIFACTS.md` |
| Çalışma alanı dosya görüntüleyicisi | Çalışma alanındaki dosyalara görevden göz atılır, dosyalar ön izlenir ve indirilir. | Deneysel (`enableExperimentalFileViewer`, varsayılan kapalı) | Görüntüleyici v2026.618.0; indirme v2026.626.0 | `releases/v2026.618.0.md`, `releases/v2026.626.0.md`, `packages/shared/src/feature-catalog.ts` |
| Geri bildirim oylaması | Ajan yorumlarına ve belge sürümlerine "Helpful" (yararlı) ve "Needs work" (üzerinde çalışılmalı) oyları; isteğe bağlı gerekçe ve oyu yerelde tutma ya da paylaşma konusunda izin seçimi vardır. | Yayında | v2026.403.0 | `docs/feedback-voting.md`, `releases/v2026.403.0.md` |
| Sayfa yayımlama skill'i | Ajanlar statik sayfaları ve dosya klasörlerini onaylı bir sunucuya yayımlar. | Yayında | v2026.626.0 | `releases/v2026.626.0.md` |
| Kalıcı çalışma kayıtları | Çalışma kayıtları nesne depolamaya yansıtılır. | Yayında | v2026.720.0 | `releases/v2026.720.0.md` |
| Bilgi tabanı | Bilgi tabanı, çekirdek için bilerek hedeflenmeyen bir şeydir. Bellek tarafındaki çalışma kısmen var: LLM Wiki eklentisi ve deneysel bellek bağlayıcıları. | Çekirdekte yok | yok | `doc/SPEC.md`, `ROADMAP.md`, `doc/memory-landscape.md` |

### 2.15 Arama

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Görev arama | Başlıklarda, kimliklerde, açıklamalarda ve yorumlarda tam metin arama. | Yayında | v2026.414.0 (trigram dizini) | `releases/v2026.414.0.md` |
| Şirket arama sayfası | Görevlerde, belgelerde, ajanlarda, projelerde, yorumlarda ve etkinlikte tek arama; vurgulu alıntılar ve son aramalar gösterilir. | Yayında | v2026.512.0 | `releases/v2026.512.0.md`, `ROADMAP.md` |
| Filtreler, sıralama, işleçler | Aramanın filtreleri, sıralama seçenekleri ve sorgu işleçleri vardır; komut paleti aynı aramayı kullanır. | Yayında | v2026.720.0 | `releases/v2026.720.0.md` |
| İlgi düzeyi kademeleri | Tam arama ve hızlı arama, açıkça tanımlanmış aynı ilgi düzeyi kademelerini ve özenli yazım hatası düzeltmesini paylaşır; bunlar puanlanmış bir test kümesiyle denetlenir. | Yayında | v2026.916.0 | `doc/SEARCH.md`, `releases/v2026.916.0.md` |
| Komut paleti | Cmd-K bir palet açar; eşleşen projeler görevlerin üstünde sıralanır. | Yayında | Aramaya devretme v2026.512.0; yazarken proje önerme v2026.707.0 | `releases/v2026.512.0.md`, `releases/v2026.707.0.md` |
| Klavye kısayolları | `?` kısayol listesini açar; `g i` Gelen kutusu ekranına, `g c` yazma kutusuna götürür; `/`, `c`, `[`, `]` her yerde çalışır. Beta notlarında kısayollar her zaman açıktır. | Yayında | Kısayol listesi v2026.414.0 | `releases/v2026.414.0.md`, `docs/pr-screenshots/pr-5291/after-navigation-layout.png`, `releases/beta/v2026.1002.0-beta.0.md` |
| Seçicilerin içinde arama | Üst görev seçicisi aramayı sunucuda yapar. | Yayında | v2026.824.0 | `releases/v2026.824.0.md` |

### 2.16 Cases, Pipelines ve özetler

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Cases | Görevlerin zaman içinde oluşturup geliştirdiği bir şey (örneğin bir sürüm ya da bir sosyal medya ileti dizisi) için belgeye dayanan kalıcı bir kayıt. Bir Cases sekmesi ekler (kenar çubuğunda "beta" rozetiyle). | Deneysel (`enableCases`, varsayılan kapalı) | v2026.720.0 | `releases/v2026.720.0.md`, `packages/shared/src/feature-catalog.ts`, `ui/src/components/Sidebar.tsx` |
| Pipelines | Bir pipeline, case'lerin içinden geçtiği aşamaları tanımlar (açık, üzerinde çalışılıyor, inceleme, bitti, iptal). Ajanlar aşama geçişini gerekçe ve güven düzeyiyle önerir; bir insan kabul eder. İnceleme aşamalarında onaylanır, değişiklik istenir ya da gerekçeyle reddedilir. | Deneysel (`enablePipelines`, varsayılan kapalı) | Altyapı v2026.626.0, "not a user-facing surface yet" (henüz kullanıcıya dönük bir ekran değil) | `docs/pipelines-tutorial.md`, `releases/v2026.626.0.md` |
| Aşama otomasyonu | Bir case bir aşamaya girdiğinde bir rutin çalışabilir; üretilen görevler başlık şablonlarını kullanır. | Deneysel, Pipelines ile birlikte | Başlık şablonları v2026.707.0 | `docs/pipelines-tutorial.md`, `releases/v2026.707.0.md` |
| Özet yuvaları ve Summarizer | Yerleşik bir Summarizer ajanı, proje ve çalışma alanı sayfalarındaki sabit yuvalara güncel durumu anlatan kısa özetler yazar. | Deneysel (`enableSummaries`, varsayılan kapalı) | v2026.720.0 | `releases/v2026.720.0.md`, `doc/SPEC-implementation.md` §10.11 |
| Durum kartları | Bkz. bölüm 2.4. | Deneysel (`enableStatusCards`, varsayılan kapalı) | v2026.817.0 | `docs/guides/board-operator/status-cards.md` |

### 2.17 İçe aktarma, dışa aktarma ve şablonlar

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Şirketi dışa aktarma | Dosya seçicisi ve "Not included in this export" (bu dışa aktarıma dâhil olmayanlar) paneli olan bir dışa aktarma (Export) sayfası. | Yayında | v2026.325.0 | `docs/guides/board-operator/importing-and-exporting.md`, `releases/v2026.325.0.md` |
| Şirketi içe aktarma | Ön izleme, çakışma çözümü (yeniden adlandır, atla, değiştir) ve "Start imported agents and routines paused" (içe aktarılan ajanları ve rutinleri duraklatılmış başlat) onay kutusu olan bir içe aktarma (Import) sayfası. | Yayında | v2026.325.0 | `docs/guides/board-operator/importing-and-exporting.md` |
| Eksiksiz paketler | Paketler etiketleri, engelleyenleri, belgeleri, çıktıları, izleyicileri ve dosya eklerini taşır; herhangi bir satır yazılmadan önce özet değeriyle (hash) doğrulanır. İçe aktarmalar arka plan işi olarak çalışır; yükleme sınırı 1 GB. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| Kaldığı yerden süren içe aktarma | Yüklemeler parçalar hâlinde gider; bağlantı kopunca ya da yeniden başlatmadan sonra kaldığı yerden sürer. | Yayında | v2026.824.0 | `releases/v2026.824.0.md` |
| İçe aktarma sonrası ekran | İçe aktarılan ajanlar, Sürdür (Resume) düğmesiyle birlikte bir duraklatma nedeni taşır; Genel bakış ekranında "Resume all" (tümünü sürdür) şeridi görünür. | Yayında | v2026.831.0 | `releases/v2026.831.0.md` |
| Agent Companies biçimi | Bütün bir şirket için dosya biçimi: `COMPANY.md`, `TEAM.md`, `AGENTS.md`, `PROJECT.md`, `TASK.md`, `SKILL.md` ve `.paperclip.yaml`. | Yayında (spesifikasyon v1-draft olarak işaretli) | İçe ve dışa aktarmayla birlikte | `docs/companies/companies-spec.md` |
| Ekip kataloğu | Dört hazır ekip: Core Exec Team (CEO, CTO, QA), Product Design, Product Engineering, Content Machine. `paperclipai teams install` ile kurulur. | Yayında | Belirtilmemiş | `packages/teams-catalog/generated/catalog.json`, `doc/CLI.md` |
| İşe alma şablonları | Ajan oluşturmak için role özel talimat dosyaları. | Yayında | v2026.427.0 | `releases/v2026.427.0.md` |
| Veritabanı yedekleri | İstek üzerine ve zamanlanmış, sıkıştırılmış yedekler; günlük, haftalık ve aylık saklama süreleri ve Kurulum ayarları sayfasında kontrolleri vardır. | Yayında | CLI v0.3.0; saklama ve arayüz v2026.414.0 | `releases/v0.3.0.md`, `releases/v2026.414.0.md` |
| ClipHub | Şirket şablonları için herkese açık bir kayıt defteri. | Planlandı | yok | `doc/CLIPHUB.md`, `doc/SPEC-implementation.md` |
| Cloud Sync | Kurulumlar arasında sunucudan sunucuya eşitleme. | Kaldırıldı | v2026.525.0 sürümünde eklendi; v2026.817.0 sürümünde kaldırıldı | `releases/v2026.525.0.md`, `releases/v2026.817.0.md` |

### 2.18 Çok kullanıcılı erişim

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| İnsan kullanıcılar ve üyelikler | Gerçek insan hesapları, şirket üyelikleri ve şirket kapsamında erişim. | Yayında | v2026.414.0; v2026.427.0 sürümünde ortak kontrol düzlemi olarak yeniden anlatıldı | `releases/v2026.414.0.md`, `releases/v2026.427.0.md` |
| Roller | İnsan üye rolleri şunlardır: Owner (sahip), Admin (yönetici), Operator (operatör) ve Viewer (görüntüleyici). | Yayında | Çok kullanıcılı erişimle birlikte | `packages/shared/src/constants.ts` |
| Davetler ve katılma istekleri | Davet bağlantıları, katılma isteği onayı, üye rolü yönetimi, davet geçmişi. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| Her yerde insan kimlikleri | Etkinlikte, görev tablolarında, seçicilerde ve anma menülerinde kişilerin adları ve avatarları. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| İlk yönetici hesabını sahiplenme | Yeni açılmış özel bir kurulumda ilk ziyaretçi yönetici hesabını bir kez sahiplenebilir. | Yayında | v2026.529.0 | `releases/v2026.529.0.md` |
| Kaydolmayı kapatma | Yeni kaydı kilitleyen bir ayar. | Yayında | v0.3.0 | `releases/v0.3.0.md` |
| Kiracı yalıtımı | Her şirketin kendi imzalama anahtarları vardır; buluttaki kiracılar şirket kapsamındadır. | Yayında | v2026.618.0 | `releases/v2026.618.0.md` |
| Kişisel ve ortak yapay zekâ hesapları | Aynı ajan bir kişinin aboneliğiyle de başka bir kişinin API anahtarıyla da çalışabilir; hangisinin kullanılacağı adına çalışılan kişiye göre belirlenir. | Yayında | v2026.916.0 | `releases/v2026.916.0.md`, `ROADMAP.md` |
| Hesap menüsü | Geri bildirim (Feedback) satırı olan hesap menüsü; Davet (Invite) kısayolu beta notlarındadır. | Yayında | Geri bildirim satırı v2026.618.0 | `releases/v2026.618.0.md`, `releases/beta/v2026.1002.0-beta.0.md` |

### 2.19 Kurulum ve yönetim

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Kurulum modları | Yerel makinedeki tek operatör için `local_trusted`; ortak kullanım için `authenticated` (özel ya da herkese açık). | Yayında | Belirtilmemiş | `docs/deploy/deployment-modes.md`, `doc/DEPLOYMENT-MODES.md` |
| Hızlı başlangıç | `npx paperclipai onboard --yes`, gömülü veritabanıyla `http://localhost:3100` adresinde yerel bir kurulum başlatır. | Yayında | Belirtilmemiş | `docs/start/quickstart.md` |
| Veritabanı ve depolama seçenekleri | Gömülü Postgres, Docker üzerinde Postgres ya da barındırılan Postgres; yerel disk ya da S3 depolama. | Yayında | Belirtilmemiş | `docs/deploy/database.md`, `docs/deploy/storage.md` |
| Docker imajı | İmaj, ajan CLI'leriyle birlikte gelir; `:latest` kararlı sürüm demektir. | Yayında | `:latest` etiketinin kararlı sürüm olması v2026.817.0 | `docs/deploy/docker.md`, `releases/v2026.817.0.md` |
| Sürüm kanalları | canary, nightly, beta, stable; bir kararlı sürüm önce en az üç gün beta olarak bekletilmelidir. | Yayında | v2026.817.0 | `doc/CHANNELS.md`, `releases/v2026.817.0.md` |
| Tailscale üzerinden özel erişim | Özel bir kuruluma tailnet üzerinden ulaşmak için kılavuz. | Yayında | Belirtilmemiş | `docs/deploy/tailscale-private-access.md` |
| Deneysel ayarlar sayfası | Kurulum ayarları > Deneysel (Instance Settings > Experimental) sayfası, seçenekleri başlığı, açıklaması ve aç/kapa düğmesi olan kartlar hâlinde, alfabetik sırayla listeler. | Yayında | Belirtilmemiş | `docs/guides/board-operator/experimental-features.md`, `screenshots/PR-8000-settings-experimental-flag-on.png` |
| Barındırılan kullanıcılar için ayarları gizleme | `PAPERCLIP_HIDDEN_SETTINGS` ayar sayfalarını, tek tek bayrakları ve sekmeleri gizler; `PAPERCLIP_SETTING_DEFAULTS` varsayılanları belirler. | Yayında | v2026.831.0 | `releases/v2026.831.0.md`, `docs/deploy/environment-variables.md` |
| Telemetri | Anonim telemetri, varsayılan olarak açık; `PAPERCLIP_TELEMETRY_DISABLED=1` ya da `DO_NOT_TRACK=1` ile kapatılır. | Yayında | v2026.403.0 | `README.md`, `releases/v2026.403.0.md` |
| Gözlemlenebilirlik | İsteğe bağlı OpenTelemetry ve isteğe bağlı Sentry. | Yayında | OpenTelemetry v2026.618.0; Sentry v2026.831.0 | `releases/v2026.618.0.md`, `releases/v2026.831.0.md` |
| Tema | Açık ve karanlık tema; ilk ziyarette sistem ayarı izlenir; giriş sayfasında tema değiştirme düğmesi vardır. | Yayında | v2026.618.0 | `releases/v2026.618.0.md` |
| Çok dillilik altyapısı | Bir i18next temeli ve yerel ayar doğrulaması, "for future translated surfaces" (ileride çevrilecek ekranlar için). Sürüm notlarının hiçbir yerinde çevrilmiş bir arayüz anlatılmıyor. | Yalnızca altyapı | v2026.517.0 | `releases/v2026.517.0.md` |
| Sürüm etiketi | Kenar çubuğu çalışan sürümü gösterir; yayımlanmamış derlemeler kaynak commit'lerini gösterir. | Yayında | v2026.318.0; commit'in gösterilmesi v2026.720.0 | `releases/v2026.318.0.md`, `releases/v2026.720.0.md` |
| Yönetim kurulu arayüzünün toparlanması | Sunucu yeniden başlarken arayüz bir bağlantı mesajı gösterir ve yeniden dener. | Beta notları | v2026.1005.0 notları | `releases/beta/v2026.1002.0-beta.0.md` |
| Bulut kurulumu | İlk kurulum ve bağlantı belgelerinde barındırılan bir "Paperclip Cloud" sürümünden söz edilir. | Kısmen var | yok | `ROADMAP.md`, `releases/v2026.824.0.md` |

### 2.20 CLI

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Kurulum komutları | `run`, `onboard`, `doctor`, `configure`, `env`, `allowed-hostname`. | Yayında | Belirtilmemiş | `docs/cli/setup-commands.md` |
| Kontrol düzlemi komutları | Görev, şirket, ajan, onay, etkinlik, Genel bakış ve uyandırma (heartbeat) komutları; bağlam profilleri hedef kurulumu ve şirketi saklar. | Yayında | Belirtilmemiş | `docs/cli/control-plane-commands.md`, `doc/CLI.md` |
| CLI'den yönetim kurulu girişi | Tarayıcı üzerinden giriş; böylece yönetim kurulu kullanıcılarının API anahtarı kopyalaması gerekmez. | Yayında | v2026.325.0 | `releases/v2026.325.0.md` |
| Şirketi içe ve dışa aktarma | `company import` ve `company export`. | Yayında | v2026.325.0 | `releases/v2026.325.0.md` |
| Skill'ler, ekipler, gizli anahtarlar, rutinler, eklentiler | Her biri için komut grupları. | Yayında | Skill CLI'si v2026.529.0 | `doc/CLI.md` |
| Maliyet, finans ve bütçe | `cost summary`, `cost by-agent`, `cost by-provider`, `cost by-project`, `cost issue`, `budget overview`, `budget incident:resolve` ve başkaları. | Yayında | Belirtilmemiş | `doc/CLI.md` |
| Yönetilen kurulum ve güncellemeler | Kendini güncelleyen bir servis olarak kurulur; güncelleme öncesi yedek ve geri alma vardır; `service`, `uninstall`, `doctor`. | Yayında | v2026.817.0 | `releases/v2026.817.0.md` |
| `channels` | Her sürüm kanalını ve kurulumun hangisini izlediğini gösterir. | Yayında | v2026.824.0 | `releases/v2026.824.0.md` |
| `test-drive` | Ürünü denemek için kendi veri dizini olan yalıtılmış bir kurulum başlatır. | Yayında | v2026.916.0 | `releases/v2026.916.0.md` |
| `db:backup` | Veritabanının anlık yedeğini alır. | Yayında | v0.3.0 | `releases/v0.3.0.md` |
| `feedback report` ve `feedback export` | Toplanan geri bildirim oylarını okur. | Yayında | Belirtilmemiş | `docs/feedback-voting.md` |
| `connections search` ve `connections request` | Bağlantı bulma ve isteme ajan araçlarının CLI karşılığı. | Yayında | Bağlantı istekleriyle birlikte | `doc/connection-intents.md` |

### 2.21 Telefon

| Özellik | Operatöre ne sağlar | Durum | İlk yayımlandığı sürüm | Kaynak |
| --- | --- | --- | --- | --- |
| Kurulabilir PWA | Arayüz, önce ağa bakan (network-first) bir service worker ile PWA (progressive web app) olarak kurulur. | Yayında | v0.3.0 | `releases/v0.3.0.md` |
| Telefon yerleşimi | Görevler, Gelen kutusu ve Genel bakış ekranlarında ortak görev satırları; sonradan pencereler, ayarlar menüsü ve boşluklar elden geçirildi. | Yayında | v0.3.0; devamı v2026.525.0 | `releases/v0.3.0.md`, `releases/v2026.525.0.md` |
| Alt menü | Telefonda altta beş öğe: Ana sayfa, Görevler, Oluştur, Ajanlar, Gelen kutusu (Home, Issues, Create, Agents, Inbox). | Yayında (Mayıs 2026 tarihli bir Storybook görüntüsünde görüldü) | Belirtilmemiş | `docs/pr-screenshots/pr-5291/after-navigation-layout.png`, `doc/assets/pap-3368/` |
| Kaydırarak arşivleme | Gelen kutusu satırı kaydırılarak arşivlenir. | Yayında | v2026.403.0 | `releases/v2026.403.0.md` |
| Telefonda üst çubuk | Gelen kutusundaki görev görünümleri için Gmail'den esinlenen bir üst çubuk. | Yayında | v2026.414.0 | `releases/v2026.414.0.md` |
| Telefonda organizasyon şeması | Telefonda organizasyon şemasında gezinme. | Yayında | v2026.427.0 | `releases/v2026.427.0.md` |
| Telefonda görev sohbeti | Sohbet biçimindeki görev görünümünün telefon yerleşimi vardır; sonradan kayıt seçicileri alttan açılan sayfa olarak açılır, görev ağaçları da tam genişliği kullanır oldu. | Yayında | v2026.817.0; alttan açılan sayfalar v2026.916.0 | `releases/v2026.817.0.md`, `releases/v2026.916.0.md` |
| Telefonda karar satırları | Karar satırları telefonda okunabilir. | Yayında | v2026.720.0 | `releases/v2026.720.0.md` |

### 2.22 Bu commit'teki deneysel bayraklar

Kaynak: `packages/shared/src/feature-catalog.ts` (başlıklar ve açıklamalar) ve `server/src/services/instance-settings.ts` (kendi sunucusuna kurulan sürümdeki varsayılanlar). Yalnızca operatöre dönük bayraklar listelendi; çalışma alanı, sandbox ve geliştirici bayrakları sonda toplandı.

| Bayrak | Başlık | Kendi sunucunda varsayılan | Neyi açar |
| --- | --- | --- | --- |
| `enableStreamlinedUi` | Streamlined UI | açık | Sade kabuk, ortak görev koleksiyonları, odaklı görev ayrıntısı ve sadeleştirilmiş kenar çubuğu |
| `enableStreamlinedLeftNavigation` | Streamlined Left Navigation | açık | Sade ana kenar çubuğu yerleşimi |
| `enableClassicTaskInterface` | Classic Task Interface | kapalı | Sohbet görünümünden önceki görev sayfasını geri getirir |
| `enableDecisions` | Decisions | kapalı | Ana kenar çubuğundaki Decisions satırı |
| `enableGoalsSidebarLink` | Goals Sidebar Link | kapalı | Ana kenar çubuğundaki Hedefler (Goals) satırı |
| `enableAgentChat` | Agent Chat | kapalı | Altında görev olan kalıcı konuşmalar |
| `enableConferenceRoomChat` | Conference Room Chat | kapalı | Ekip sohbeti, canlı etkinlik akışı ve yeniden tasarlanmış ilk kurulum |
| `enableChatConnectors` | Chat connectors | kapalı | Sohbet bağlayıcısı kurulumu ve yönetim kurulu ekranları |
| `enableMemoryConnectors` | Memory connectors | kapalı | Mem0, Zep, Supermemory, Cognee ve Honcho kurulumu |
| `enableStatusCards` | Status Cards | kapalı | Ortak durum kartı panosu ve güncelleme motoru |
| `enableSummaries` | Summaries | kapalı | Proje ve çalışma alanı sayfalarındaki Summarizer yuvaları |
| `enableCases` | Cases | kapalı | Cases sekmesi ve ajanlar için case API'si |
| `enablePipelines` | Pipelines | kapalı | Pipeline tanımları ve pipeline'a dayalı case ekranları |
| `enableBuiltInAgents` | Built-in Agents | kapalı | Liste rozetleri, Built-in agents sekmesi ve kurulum kontrolleri |
| `enableIssuePlanDecompositions` | Task Plan Decomposition | kapalı | Görev sayfalarında kabul edilen planın görevlere bölünme geçmişi |
| `enableExternalObjects` | External Objects | kapalı | Görevlerdeki dış adresler için çözümlenen durum |
| `enableExperimentalFileViewer` | Experimental File Viewer | kapalı | Görevden çalışma alanı dosyalarına göz atma |
| `enableSimplifiedEnglishInteractions` | Simplified English Interactions | kapalı | Ajan etkileşimlerinde Simplified Technical English |
| `enableFirstTaskPlanProposal` | First task: propose with a plan document | kapalı | İlk görevde plan belgesi ve işaretli onay kartı |
| `enableBetaSkills` | Beta skills | kapalı | Temel skill'in beta sürümlerine sabitleme |
| `enableSmokeLab` | Smoke Lab | kapalı | Entegrasyon testi sekmesi ve Genel bakış kartı |
| `enableEnvironments` | Environments | kapalı | Ortam yönetimi ve atama kontrolleri |
| `enableNativeRunner` | Paperclip Runner | açık | Öyle yapılandırılan ajanlar için Paperclip'in kendi çalıştırıcısı |
| `enableApps`, `enableMcpAggregators` | Uyumluluk anahtarları | her zaman açık | Apps ve MCP toplayıcıları her zaman etkindir; saklanan değerler yok sayılır |

Katalogdaki diğer bayraklar kod çalışma alanları, sandbox'lar ve geliştirici araçlarıyla ilgilidir: `enableIsolatedWorkspaces`, `enableIsolatedWorkspacesByDefault`, `enableManagedSandboxOnly`, `enableWorkspaceBranchReconcileForward`, `enableWorkspaceDirtyQuarantineRepair`, `enableSandboxDuplexBridge`, `enableRunnerPreviewIngress`, `enableWorktreeRunExecution`, `enableOwnerInstanceAdmin`, `enableServerInfoDebugView`, `enablePaperclipDeveloperMode`, `autoRestartDevServerWhenIdle`.

## 3. Sürüm zaman çizelgesi

### 3.1 Sürümler

Her satırın kaynağı: `releases/` içindeki ilgili dosya. Sürümler 2026-03-18 tarihinde anlamsal numaralardan tarihe dayalı numaralara (yıl.aygün.yama) geçti.

| Sürüm | Tarih | Öne çıkan özellikler |
| --- | --- | --- |
| v0.2.7 | 2026-03-04 | İlk kurulumda dayanıklılık; Docker ile ilk kurulum akışı. |
| v0.3.0 | 2026-03-09 | Cursor, OpenCode ve Pi adaptörleri; OpenClaw geçidi; kullanıcıya özel okundu bilgili Gelen kutusu; PWA; ajan oluşturma sihirbazı; canlı çalışma çıktısı; başarısız çalışmaları yeniden deneme; mermaid diyagramları; `db:backup`; telefon yerleşiminde iyileştirmeler. |
| v0.3.1 | 2026-03-12 | Gemini CLI adaptörü; çalışma dökümünde iyileştirmeler; Gelen kutusu düzeltmeleri; iyileştirilmiş ilk kurulum sihirbazı; ajan çalışmaları sekmesi; proje ve ajan yapılandırma sekmeleri. |
| v2026.318.0 | 2026-03-18 | Eklenti çerçevesi ve SDK; yenilenen maliyet ve bütçeleme; görev belgeleri ve dosya ekleri; Hermes adaptörü; yürütme çalışma alanları (deneysel); şirket logoları. |
| v2026.325.0 | 2026-03-25 | Şirketi içe ve dışa aktarma; şirket skill kitaplığı; rutinler ve yinelenen görevler; Gelen kutusu ekranında katılma istekleri; değerlendirme (eval) çerçevesinin ilk hâli; CLI'den yönetim kurulu girişi. |
| v2026.403.0 | 2026-04-03 | Gelen kutusu yenilendi (Benim sekmesi, e-posta tarzı tuşlar, kaydırarak arşivleme); geri bildirim oyları; geri yüklemeli belge sürümleri; telemetri; yorumla araya girme ve sıradaki yorumlar. |
| v2026.414.0 | 2026-04-14 | Çok kullanıcılı erişim ve davetler; her yerde insan kimlikleri; sohbet biçiminde görev akışı; dış adaptör eklentileri; yürütme kuralları; engelleyen bağımlılıkları; bağımsız MCP sunucusu; görev arama; klavye kısayol listesi; belge fark görüntüleyici; saklama süreli yedekler. Bir güvenlik düzeltmesi içerir (GHSA-68qg-g8mg-6pr7). |
| v2026.415.0 | 2026-04-15 | Performans; Gelen kutusu aramasında "Other results"; özellik panelinde iyileştirmeler. |
| v2026.416.0 | 2026-04-16 | v2026.414.0 ile aynı öne çıkanlar; MCP sunucusu BETA etiketli. |
| v2026.427.0 | 2026-04-27 | Davetli, kimlik doğrulamalı ortak kontrol düzlemi; yapılandırılmış akış etkileşimleri; çalışmanın canlılığı ve devam çalışmaları; kontrol listesi olarak alt görevler; alt ağacı duraklatma, iptal etme ve geri yükleme; görev referansları ve geri bağlantılar; takılabilir sandbox sağlayıcılarıyla BETA Environments; Genel bakış ekranında çalışma grafikleri; herkese açık yol haritası. |
| v2026.428.0 | 2026-04-28 | Kenar çubuğundan ajan duraklatma ve sürdürme; sanallaştırılmış uzun akışlar; verimlilik incelemesi (sonradan kullanımdan kaldırıldı); işe alma onayının isteğe bağlı olması; görev listesinde sonsuz kaydırma. |
| v2026.512.0 | 2026-05-12 | Planlama modu; şirket genelinde tam arama; rutin sürüm geçmişi; başarılı çalışma sonrası devir ve sistem notları; eklentilere açılan daha geniş yüzey; LLM Wiki eklentisi; gizli anahtar sağlayıcı kasaları; Cursor cloud ve ACPX adaptörleri; görev izleyicileri; görev başına maliyet özetleri; zamanlanmış yeniden deneme. |
| v2026.513.0 | 2026-05-13 | Kaynak görevde kurtarma eylemleri; Gelen kutusu ekranında Engellenenler görünümü; yerel eklenti geliştirme akışı. |
| v2026.517.0 | 2026-05-17 | Grok Build çalışma zamanı; belge kilitleri; büyük ölçekte Kanban; çok dillilik altyapısı. |
| v2026.525.0 | 2026-05-25 | Modal sandbox eklentisi; çalışma alanı fark görüntüleyici; rutinlerin gizli anahtar taşıması; Cloud Upstream eşitlemesi (sonradan kaldırıldı); kapsamla sınırlı ajan izinleri; telefon iyileştirmeleri. |
| v2026.529.0 | 2026-05-29 | Belgelerde satır içi notlar; skill CLI'si ve kataloğu; projeleri ve ajanları kenar çubuğundan gizleme; ilk yönetici hesabını sahiplenme akışı. |
| v2026.609.0 | 2026-06-09 | Şirket Çıktılar sayfası; kapatılabilen kenar çubuğu; video ekleri; işaretli onaylar; bilgi mimarisinin yenilenmesi (deneysel); PR kalite kapıları. |
| v2026.618.0 | 2026-06-18 | Skill mağazası (Skills Store); Kubernetes ve Novita sandbox'ları; şirket başına kiracı yalıtımı; çalışma alanı dosya görüntüleyicisi; rutin ayrıntı sayfasının yeniden tasarımı; varsayılan olarak sistem teması; OpenTelemetry. |
| v2026.626.0 | 2026-06-26 | Yerleşik Hermes; görev gözcüleri; soru (Ask) çalışma modu; yenilenen ilk kurulum; görev durum simgeleri ve renkleri; varsayılan olarak sade kenar çubuğu; çalışma öncesi bütçe tavanları. |
| v2026.707.0 | 2026-07-07 | Kullanıcıya özel gizli anahtarlar; iş zaman çizelgesi (Work Timeline); SSH terminalli özel sandbox imajları; yeni ortam değişkeni düzenleyicisi; yıldızlı kaynaklar; arayüzle birlikte gelen web yazı tipleri. |
| v2026.720.0 | 2026-07-20 | Skill Studio; ilgi bekleyenler kuyruğu ve Decisions ekranı; daha iyi arama; kendini onaran çalışmalar; tasarım sisteminin birleştirilmesi; etkinlik kapılı rutinler. Deneysel: MCP araç geçidi ve Apps, Summarizer ve özet yuvaları, Decision Training, Cases. |
| v2026.722.0 | 2026-07-22 | Çalışmaya bağlı ajan gizli anahtar erişimi; Windows'ta yerel ajanlar; Connections v3 temeli (deneysel). |
| v2026.817.0 | 2026-08-17 | Sürüm kanalları; önerme ve karar verme akışı olarak Decisions; eksiksiz içe ve dışa aktarma; yönetilen CLI kurulumu; tek Etkinlik sayfası; gizli anahtar önerileri. Deneysel: sohbet biçiminde görev görünümü, Apps ve Connections (Notion), durum kartları, Simplified English. |
| v2026.824.0 | 2026-08-24 | Sohbet biçimindeki görevler varsayılan oldu; Tailscale üzerinden HTTPS ön izlemeleri; Paperclip'in içinden Claude ve Codex'e giriş; kaldığı yerden süren içe aktarma; yanıtlama kuralında varsayılan `anyone`; Decision Training kaldırıldı. |
| v2026.831.0 | 2026-08-31 | Skill kitaplığının ajanlara ulaşması; Kimi adaptörü; operatörlerin ayarları gizleyebilmesi; daha kısa ilk kurulum; birleşik ayarlar ve "organization" sözcüğü; "Auto mode" etiketi; Node 24.11 zorunlu. |
| v2026.831.1 | 2026-09-02 | İlk kurulum düzeltmesi. |
| v2026.916.0 | 2026-09-16 | Connections içinde yapay zekâ kimlik bilgileri; AgentMail; sohbet bağlayıcıları (deneysel); ajan sohbeti (deneysel); GitHub kimlikleri; uygulama içi duyurular; chief of staff ile ilk kurulum; Apps deneysel olmaktan çıktı; Paperclip'in kendi çalıştırıcısı kendi sunucusuna kurulan sürümde varsayılan olarak açık; yenilenen görev ekranı. |
| v2026.916.1 | 2026-09-21 | Yazma kutusu düzeltmesi. |
| v2026.1001.0 | 2026-10-01 | Ajan karakterleri; GitHub PR inceleme botu; çalışma sürerken onayların ve yanıtların sıraya girmesi; baştan yapılan Slack kurulumu; Railway ve You.com bağlayıcıları; rutin tetikleyici sihirbazı; görevden öğrenilenlerden üretilen skill'ler; çalıştırma ortamları varsayılan olarak tam otomatik. |
| v2026.1005.0 (dosya `releases/beta/v2026.1002.0-beta.0.md`) | Başlığında 2026-10-05 yazıyor, depo commit'inden sonra | Paperclip'in kendi çalıştırıcısında Grok; kalıcı ajan dosyaları; GitHub kaynaklarından skill'ler; canlı tarayıcı sekmeleriyle Browser Use Cloud; tek ekranlı bağlayıcı kurulumu; iki yönlü Slack; ajan sohbeti kenar çubuğu ve açılış sayfası; mesaj başına model ve efor seçici; yalnızca istemle görev; @ ile anma artık çalışma başlatmıyor; klavye kısayolları her zaman açık. |

### 3.2 Yayımlanıp sonra kaldırılan özellikler

Bu liste neyin alınacağına karar verirken önemlidir: bu fikirler denendi ve geri çekildi.

| Özellik | Eklendi | Kaldırıldı | Verilen gerekçe | Kaynak |
| --- | --- | --- | --- | --- |
| Otomatik verimlilik incelemeleri | v2026.428.0 | v2026.916.0 | "infrastructure failures could satisfy its rules and manufacture work" (altyapı hataları kurallarını karşılayıp yapay iş üretebiliyordu) | `releases/v2026.916.0.md` |
| Ucuz model profilleri | v2026.512.0 | v2026.916.0 | Olağan iş ve kurtarma işi için tek bir model seçme yolu | `releases/v2026.916.0.md` |
| Kurulumlar arası Cloud Sync | v2026.525.0 | v2026.817.0 | Veri taşımanın tek yolu içe ve dışa aktarmadır | `releases/v2026.817.0.md` |
| Decision Training ekranları | v2026.720.0 | v2026.824.0 | Belirtilmemiş | `releases/v2026.824.0.md` |
| Şirket marka rengi ve şirket başına dosya eki sınırı | Dosya eki sınırı v2026.428.0 | v2026.831.0 | Belirtilmemiş | `releases/v2026.831.0.md` |
| Sessiz çalışmalarda otomatik eylem | v2026.427.0 (gözcü) | v2026.831.0 | Kurtarma artık işi kendiliğinden başkasına atamak yerine yönetim kuruluna ait bir eyleme yönlendiriyor | `releases/v2026.831.0.md` |
| Ajanları uyandıran @ ile anma | Belirtilmemiş | v2026.1005.0 notları | İşi yalnızca atama ve inceleme istekleri başlatır | `releases/beta/v2026.1002.0-beta.0.md` |
| Klavye kısayollarını açma/kapama ayarları | Belirtilmemiş | v2026.1005.0 notları | Kısayollar her zaman açık | `releases/beta/v2026.1002.0-beta.0.md` |
| Arayüzdeki görev önceliği kontrolleri | Belirtilmemiş | v2026.817.0 sürümünde gizlendi | Belirtilmemiş; veri modeli, API ve arama önceliği koruyor | `releases/v2026.817.0.md` |
| Kurulum düzeyindeki Heartbeats sayfası | v0.3.1 | v2026.831.0 | Ayarlar birleştirildi | `releases/v2026.831.0.md` |
| Eski Composio aracısı (broker) | v2026.916.0 | v2026.1001.0 | Yerini MCP toplayıcıları aldı | `releases/v2026.1001.0.md` |

### 3.3 Plan belgeleri

`doc/plans/` klasöründe 76 kayıt var. Tarihleriyle başlıklar (dosya adının ön eki tarihtir):

- 2026-02-16 Module System; 2026-02-18 Agent Authentication (iki dosya); 2026-02-19 Agent Management Follow-up; 2026-02-19 CEO Agent Creation and Hiring Governance; 2026-02-20 Issue Run Orchestration; 2026-02-20 Storage System; 2026-02-21 Humans and Permissions (iki dosya); 2026-02-23 Cursor Cloud Adapter; 2026-02-23 Deployment/Auth Mode Consolidation.
- 2026-03-10 Workspace Strategy and Git Worktrees; 2026-03-11 Agent Chat UI and Issue-Backed Conversations (okundu); 2026-03-13 Token Optimization Plan (okundu); 2026-03-13 Agent Evals Framework; 2026-03-13 Company Import / Export V2; 2026-03-13 Feature specs (okundu); 2026-03-13 Paperclip Skill Tightening; 2026-03-13 Kitchen Sink Plugin; 2026-03-13 Workspace Product Model, Work Product, and PR Flow; 2026-03-14 Adapter Skill Sync Rollout; 2026-03-14 Billing Ledger and Reporting (girişi okundu); 2026-03-14 Budget Policies and Enforcement (okundu); 2026-03-14 Skills UI Product Plan; 2026-03-17 Docker Release Browser E2E; 2026-03-17 Memory Service; 2026-03-17 Release Automation and Versioning.
- 2026-04-06 Smart Model Routing (girişi okundu); 2026-04-06 Sub-issue Creation On Issue Detail; 2026-04-07 Issue Detail Speed And Optimistic Inventory; 2026-04-07 Pi Hook Survey; 2026-04-08 Agent Browser Process Cleanup; 2026-04-08 Agent OS Follow-up; 2026-04-08 Agent OS Technical Report; 2026-04-12 VS Code Task Interoperability; 2026-04-24 External Object Reference Backfill; 2026-04-26 Plugin Secret Refs.
- 2026-05-05 Scaled Kanban Board Design (okundu) ve Implementation Plan; 2026-05-06 LLM Wiki Asset Security Gate; 2026-05-23 CLI API Parity PRD; 2026-05-26 Skills CLI And Catalog Contract.
- 2026-06-03 Low-Trust Review Contract; 2026-06-05 ADR: Agent Access MVP and MCP Runtime Slots.
- 2026-08-26 Self-Serve MCP Connections Program.
- 2026-09-07 Runner API production readiness; 2026-09-08 Reliable execution and continuation; 2026-09-09 Experimental chat channel landing plan; 2026-09-09 Codex integration acceptance; 2026-09-09 Codex recurring notices; 2026-09-10 Persistent agent chat, backed by tasks (okundu); 2026-09-10 AI Connections Storybook review; 2026-09-11 iMessage Photon channel; 2026-09-12 Fresh Runner first-time-user acceptance; 2026-09-13 Railway runtime; 2026-09-14 Recent Tasks sync; 2026-09-19 GitHub chat connector with PR reviews; 2026-09-20 GitHub review live acceptance; 2026-09-21 Four independent MCP connectors; 2026-09-21 Task context ownership contract (okundu); 2026-09-22 Continuation accounting baseline; 2026-09-22 Explicit work-mode authority; 2026-09-22 Legacy continuation authority; 2026-09-22 Slack tools for Slack-origin tasks; 2026-09-23 Continuation accounting fixes; 2026-09-28 Return completed work to its originating chat (okundu); 2026-09-28 Cursor, Copilot and Pi through rich ACP; 2026-09-29 Browser Use Cloud connector.
- 2026-10-02 Hiring template prompt comparison; 2026-10-02 Stock harness, with Paperclip: working checklist.
- `doc/plans/chat-adapters/`: 2026-09-03 mimari, araştırma notları ve arayüz ekranı spesifikasyonu; 2026-09-04 arayüz ekranları v6, v7, v8 (v8 okundu), asgari kurulum, kurulum denetimi, platform ekranları, tarayıcı çalıştırma kılavuzu; 2026-09-05 ile 2026-09-09 arasında GitHub, Slack, Teams, Telegram ve Discord için canlı yeterlilik sonuçları ve ara kontrol noktaları.

`doc/plans/` içindeki hiçbir plan özel olarak Decisions, durum kartları, özet yuvaları ya da Cases özelliklerini konu almıyor. Bunlar sürüm notlarında, `docs/guides/board-operator/status-cards.md`, `doc/SPEC-implementation.md` (§7.16, §10.11), `doc/design/DECISION-SHEET.md` ve `docs/pipelines-tutorial.md` dosyalarında belgelenmiş.

Planlardan, ürünü hâlâ biçimlendiren noktalar:

- "Board command surface, not generic chat" (genel amaçlı sohbet değil, yönetim kurulunun komut ekranı) ve önce insanın okuyabileceği özetler (`doc/plans/2026-03-13-features.md`).
- Sohbetin altında görev vardır: konuşma ikinci bir sohbet deposunda değil, görev olarak saklanır (`doc/plans/2026-03-11-agent-chat-ui-and-issue-backed-conversations.md`, `doc/plans/2026-09-10-agent-chat.md`).
- Bütçe ve kota ayrı kavramlardır; önce faturalanan sent gelir (`doc/plans/2026-03-14-budget-policies-and-enforcement.md`).
- Token tasarrufu yolları: oturumu yeniden kullanma, başlangıç isteminden ayrı kısa bir uyandırma istemi, yalnızca farkı veren bağlam API'leri, oturum sıkıştırma, skill izin listeleri (`doc/plans/2026-03-13-TOKEN-OPTIMIZATION-PLAN.md`).

## 4. Arayüzün görsel tarifi

### 4.1 Kanıt

Depoya eklenmiş yaklaşık 110 raster (piksel tabanlı) görsel var. Yaklaşık 50 tanesine bakıldı. Bunlar özenle seçilmiş bir galeri değil, PR kanıtları ve Storybook görüntüleridir; Mart ile Eylül 2026 arasına yayılırlar. En yeni tam sayfa ürün görüntüsü `doc/assets/execution-recovery/fixture-completed.png` dosyasıdır; özellik panelinde "Sep 9, 2026" tarihi görünür. Kenar çubuğundaki güncel etiketler `ui/src/components/Sidebar.tsx` dosyasıyla karşılaştırılarak doğrulandı. Aşağıdaki kesin değişken değerleri `ui/src/index.css` dosyasından alındı.

| Görsel | Yaklaşık tarih | Ne gösteriyor |
| --- | --- | --- |
| `doc/assets/execution-recovery/fixture-completed.png`, `quiet-task-list.png`, `quiet-retry.png` | Eylül 2026 | Güncel açık tema: kenar çubuğu, sohbet biçiminde görev sayfası, özellik paneli, sakin görev satırları |
| `design/pap-14557-monitor-visibility/screenshots/*` ve `index.html` | Eylül 2026 sonu | Karanlık temada akışın alt kısmı, yazma kutusu, Monitor satırı; izleyici görünürlüğü için bir tasarım önerisi |
| `doc/screenshots/garden-mcp-split-stack/*` (6 dosya) | Temmuz ile Ağustos 2026 arası | Açık temada Apps alanı: bağlantılar, kurallar, geçit ayrıntısı, profil sihirbazı |
| `screenshots/PAP-10535-live-run-menu-*.png` | 2026 yazı | Storybook: süren çalışmalı sohbet akışı, menüler, sıradaki mesajlar, yazma kutusu durumları (karanlık) |
| `screenshots/PR-8000-*.png` (7 dosya) | Haziran 2026 | Karanlık tema: Genel bakış, görev ayrıntısı, Conference Room, deneysel ayarlar |
| `screenshots/PR-7938-*.png`, `screenshots/PAP-9841-workspace-diff.png` | Haziran ile Temmuz 2026 arası | Ajan yapılandırma formu; çalışma alanı fark sekmesi |
| `docs/pr-screenshots/pr-6384/inbox-rows-desktop.png` | Mayıs 2026 sonu | Uzun Storybook sayfası: görev listesi, filtreler, belgeler, çalışma defteri |
| `docs/pr-screenshots/pr-5291/after-*.png` (4 dosya) | Mayıs 2026 | Storybook: gezinme ve yerleşim, durum dili, görev yönetimi, projeler |
| `docs/pr-screenshots/pap-2837/*`, `pap-2944/*`, `pap-2945/*`, `pr-5356/*`, `pr-5428/*`, `docs/assets/pr-5426/*` | Mayıs 2026 | Yeni görev penceresi, ajanın Skills sekmesi, izleyici kartı, sistem notları, beklemedeki görev notları, zamanlanmış yeniden deneme kartı |
| `doc/assets/pap-3368/*` | Mayıs 2026 | Planlama modunda görev sayfası, geniş ekran ve telefon |
| `doc/screenshots/pr-6381/*`, `doc/pr/5429/*` | Mayıs 2026 | Gizli anahtar envanteri, sağlayıcı kasaları, bağlama seçicisi, ortam değişkeni düzenleyicisi |
| `docs/pr-screenshots/pr-4616/*` | Nisan 2026 | Eski Genel bakış ekranı ve kenar çubuğundaki ajan eylem menüsü |
| `doc/assets/header.png`, `banner.jpg`, `four-pillars-*.png`, `announcements/examples/staging/assets/*.png`, `ui/storybook/prototypes/slack-avatar/ceo-cliptoon.png` | Karışık | Pazarlama görselleri, duyuru ana görseli, ajan karakter çizimleri |

### 4.2 Genel izlenim

Ürün, ortasında sohbet akışı olan yoğun ve sakin bir görev takip aracına benziyor. Neredeyse tek renklidir. Yüzeyler beyaz ya da siyaha yakındır, kenarlıklar ince ve düşük kontrastlıdır; renk neredeyse yalnızca durumu gösterir: süren iş mavi, bekleyen ya da duraklatılmış iş sarı, inceleme mor, biten iş yeşil, engellenmiş ya da başarısız iş kırmızıdır. Birincil düğmeler marka renginde değildir: açık temada düz siyah, karanlık temada beyaza yakındır. İş ekranlarında renk geçişi ve cam efekti yoktur, gölge de neredeyse hiç yoktur; görülen tek yumuşak gölge görev yazma kutusu kartının altındadır. Hiyerarşiyi metin taşır: adlar ve başlıklar kalın, ikincil satırlar gri, bölüm etiketleri küçük ve büyük harflidir; kimlikler, çalışma kimlikleri ve zaman damgaları eş aralıklı yazılır.

Bu, `DESIGN.md` içinde belirtilen yaklaşımla uyuşur: operatör duruma göz gezdirir ve karar verir; "density comes from information, never from chrome" (yoğunluk bilgiden gelir, hiçbir zaman arayüz süsünden değil).

### 4.3 Uygulama kabuğu

`doc/assets/execution-recovery/fixture-completed.png` (1440 px genişlik, açık tema) ve `screenshots/PR-8000-home-flag-on.png` (1440 px genişlik, karanlık tema) görsellerinde görülenler:

- **Kenar çubuğu**, yaklaşık 240 px genişliğinde ve tam yükseklikte. Açık temada beyaz içerik alanından biraz daha koyu bir gridir, belirgin bir ayırıcı yoktur. Karanlık temada sağ kenarında çok ince bir çizgi vardır.
- İçerik alanındaki **başlık satırı**: "TASKS › [status glyph] task title … EXE-1" gibi bir konum bilgisi ve sağda panel açma/kapama simgesi. İlk öğe büyük harfli ve harf aralıklıdır; görev kimliği gri ve eş aralıklıya benzer bir yazıyla görünür.
- **Ana sütun**: görev sayfasında akış sütunu yaklaşık 720 px genişliğindedir ve kenar çubuğunun hemen ardından başlar.
- **Sağ panel**, Eylül görüntüsünde yaklaşık 430 px genişliğinde; başlığı "Properties", sağ üstünde üç simge var (ekle, genişlet, kapat). Panel kapatılabilir; o zaman akış tam genişliği kullanır.
- **Kapalı kenar çubuğu**: ayarlar ve Apps sayfalarında ana kenar çubuğu yalnızca simgelerden oluşan yaklaşık 64 px'lik dar bir çubuğa iner; yaklaşık 240 px'lik ikinci bir kenar çubuğu da o bölümün kendi menüsünü gösterir (`doc/screenshots/garden-mcp-split-stack/policies.png`, `screenshots/PR-8000-settings-experimental-flag-on.png`). Sürüm notları bunu "collapsible sidebar rail and takeover panes" (kapatılabilen kenar çubuğu ve onun yerini alan paneller) diye anlatır; çubuk, üzerine gelince ve odaklanınca geçici olarak açılır (`releases/v2026.609.0.md`).
- **Şirket çubuğu**: Mayıs 2026 tarihli bir Storybook görüntüsünde en solda dar bir şerit görünür; şeritte her şirket için köşeleri yuvarlatılmış kare bir avatar, bir seçim çubuğu, süren iş için mavi nokta, okunmamış kalemler için kırmızı nokta ve kesikli çizgili bir "+" kutusu vardır (`docs/pr-screenshots/pr-5291/after-navigation-layout.png`).
- **Geliştirme şeridi**: birkaç görüntüde en üstte "WORKTREE • name" yazan çizgili, renkli bir çubuk var. Bu yalnızca geliştirme ortamına ait bir işarettir, ürün arayüzünün parçası değildir.

Şubat 2026 tarihli arayüz spesifikasyonu ilk ölçüleri belirlemişti: 240 px'lik, 48 px'e kadar daralan kenar çubuğu, bir konum bilgisi çubuğu ve bağlama göre değişen 320 px'lik özellik paneli (`doc/spec/ui.md`). Haziran ayındaki karanlık tema görüntülerinde özellik paneli yaklaşık 320 px genişliğinde; Eylül görüntüsünde daha geniş.

### 4.4 Kenar çubuğunun içeriği

Güncel varsayılan kenar çubuğu, `ui/src/components/Sidebar.tsx` dosyasına ve Eylül görüntüsüne göre:

- Üstte: şirket avatarı, şirket adı, şirket değiştirme okları.
- Etiketsiz grup: Yeni görev (New Task), Ara (Search), Genel bakış (Dashboard, süren çalışma sayısıyla), Gelen kutusu (Inbox, okunmamış rozetiyle). İsteğe bağlı satırlar yalnızca bayrakları açıkken görünür: Chat, Decisions, Status ("beta" metin rozetiyle), Conference Room.
- **WORK** (iş): Görevler (Tasks), Projeler (Projects), Rutinler (Routines), Çıktılar (Artifacts). İsteğe bağlı: Cases ("beta" rozetiyle), Pipelines, Hedefler (Goals), Çalışma alanları (Workspaces).
- **ORG** (organizasyon): Ajanlar (Agents), Skill'ler (Skills), Bağlayıcılar (Connectors), Denetim (Audit).
- **RECENT TASKS** (son görevler): son görevlerin kısaltılmış başlıkları.
- Altta: kullanıcının baş harfleri ve adı ("BO Board") ile küçük bir simge düğmesi.

Bölüm etiketleri çok küçük, büyük harfli, harf aralıklı ve gri yazılır. Seçili satırın arkasında açık gri, köşeleri yuvarlatılmış bir bant (açık tema) ya da koyu gri bir bant (karanlık tema) vardır. Her satırda 16 px'lik çizgisel bir simge ve bir ad bulunur; sayılar sağda küçük, yuvarlak bir etiket içinde durur.

Eski görüntüler bu yerleşime nasıl gelindiğini gösterir. Nisan 2026: Org, Skills, Costs, Activity, Settings satırlarını içeren COMPANY grubu ve ajan satırının üzerine gelince açılan, "Edit agent" ve "Pause agent" seçenekli menü (`docs/pr-screenshots/pr-4616/sidebar-agent-actions.png`). Haziran 2026: Tasks, Routines, Goals, Artifacts, Workspaces, Projects satırlarıyla WORK; CEO, CTO, CMO ve diğerlerini listeleyen, "See all agents" bağlantılı bir AGENTS grubu; Org ve Skills satırlarıyla COMPANY (`screenshots/PR-8000-home-flag-on.png`). Eski yerleşim kaynak kodda ikinci bir dal olarak hâlâ duruyor ve bir "Organization" grubu içeriyor: Org, Connectors, Timeline, Costs, Activity, Settings. Sade yerleşim v2026.626.0 sürümünde varsayılan oldu (`releases/v2026.626.0.md`). Yıldızlı projeler, ajanlar ve görevler kenar çubuğunda kendi bölümlerini alır (`releases/v2026.707.0.md`).

### 4.5 Renk ve tema

`ui/src/index.css` dosyasındaki değişken değerleri:

| Rol | Açık | Karanlık |
| --- | --- | --- |
| Zemin | `oklch(1 0 0)` (beyaz) | `oklch(0.205 0 0)` (siyaha yakın) |
| Ön plan metni | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| Birincil (düğmeler) | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` |
| İkincil, soluk ve vurgu yüzeyleri | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| Soluk metin | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| Kenarlık | `oklch(0.922 0 0)` | yüzde 10 beyaz |
| Kenar çubuğu | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| Yıkıcı | `oklch(0.577 0.245 27.325)` | `oklch(0.637 0.237 25.331)` |
| Temel köşe yuvarlaklığı | `0.5rem` | aynı |

Bütün nötr renklerin kroması sıfırdır, yani temel palet saf gridir. Durum renkleri iki temada da aynıdır:

| Durum | Değer |
| --- | --- |
| Görev beklemede, iptal; ajan boşta | `#a8aeb2` gri |
| Görev yapılacak; ajan duraklatıldı | `#f59e0b` sarı |
| Görev sürüyor; ajan çalışıyor | `#2563eb` mavi |
| Görev incelemede | `#7c3aed` mor |
| Görev bitti | `#22c55e` yeşil |
| Görev engellendi; ajan hatada | `#dc2626` kırmızı |

Notlar:

- Değişken dosyasındaki yorum bu düzeni şöyle adlandırır: "gray inert, blue liveness, amber queued, violet review, green done, red blocked" (gri etkisiz, mavi canlı, sarı sırada, mor inceleme, yeşil bitti, kırmızı engellendi).
- Durum simgeleri, her simgenin en az 3:1 kontrastı olması için gereken yerde daha koyu tonlar kullanır (örneğin yapılacak simgesi `#cc7a00`, bitti simgesi `#16a34a`).
- Tasarım karar defterinde "Liveness is always blue" (canlılık her zaman mavidir) kararı yazılıdır: çalışıyor etiketleri 2026-07-06 tarihinde camgöbeğinden durum mavisine geçti (`doc/design/DECISION-SHEET.md`). Bu tarihten önceki görüntülerde camgöbeği çerçeveli "RUNNING" etiketleri ve camgöbeği bir "Retry scheduled" kartı, daha da eski bir eşlemede ise yapılacak için mavi, sürüyor için sarı görülür (`docs/pr-screenshots/pr-5291/after-status-language.png`).
- Bütçe ve kota çubukları durum renklerini yeniden kullanır: sorun yokken yeşil, uyarıda sarı, aşıldığında kırmızı. Aç/kapa düğmesi açıkken yeşildir (`doc/design/DECISION-SHEET.md`; `doc/screenshots/garden-mcp-split-stack/policies.png` görselinde görülür).
- İlk ziyarette sistem teması izlenir; tema bir düğmeyle değiştirilir (`releases/v2026.618.0.md`). Şubat tarihli arayüz spesifikasyonu karanlık temayı varsayılan yapmış ve "neutral grays, not pure black" (saf siyah değil, nötr griler) demişti (`doc/spec/ui.md`).
- Belge sitesi birincil renk olarak `#2563EB` kullanır (`docs/docs.json`).
- Marka görselleri uygulama paletinden ayrıdır: duyuru ana görseli, silik bir ızgarası ve ince, iç içe halkaları olan soluk adaçayı grisi bir paneldir; üzerinde kalın, koyu yeşil-gri bir sans yazı tipiyle "paperclip" sözcüğü ve "Ideas become work." (fikirler işe dönüşür) satırı vardır (`announcements/examples/staging/assets/`). Ajan karakterleri, dikey iki renkli geçişi, iki nokta gözü ve küçük bir gülümsemesi olan yuvarlak hatlı, şapka biçimli karakterlerdir (`ui/storybook/prototypes/slack-avatar/ceo-cliptoon.png`, `doc/agent-personas.md`).

### 4.6 Tipografi

- Sans: arayüzle birlikte gelen Inter değişken yazı tipi (`ui/src/index.css` içinde `--font-sans: "InterVariable", "Inter", system fallbacks`; `releases/v2026.707.0.md` içinde "Bundled UI webfonts"). Eş aralıklı: sistemin eş aralıklı yazı tipi yığını.
- `doc/design/CHANGING-THE-UI.md` ve karar defterindeki yazı boyutu basamakları: 10 px (`--text-nano`), 11 px (`--text-micro`), 12 px, 13 px (`--text-compact`), 14 px. Harf aralığı değişkenleri: etiketler (0.08em), üst etiketler (0.14em) ve büyük harfli yazılar (0.2em).
- Şubat tarihli arayüz spesifikasyonu: gövde 13 px ve 1,5 satır yüksekliği; etiketler 11 px, büyük harfli ve harf aralıklı; başlıklar 14 ile 18 px arası, yarı kalın ve hiçbir zaman tamamı büyük harfli değil (`doc/spec/ui.md`).
- Ekran görüntülerinin gösterdiği: gövde ve satır metni 13 ile 14 px arasında; Apps sayfalarında sayfa başlıkları 22 ile 24 px arasında ve kalın ("Connections", "Developer tools"); Genel bakış ekranındaki sayılar 30 px civarında ve kalın; bölüm etiketleri 10 ile 11 px arasında, büyük harfli ve gri (WORK, ORG, EXECUTION, ABOUT); Haziran görüntüsünde Genel bakış sayfasının başlığı da büyük harfli ve harf aralıklı. Yani Şubat spesifikasyonu başlıkların hiçbir zaman tamamen büyük harfle yazılmayacağını söylediği hâlde küçük etiketler ve bazı sayfa başlıkları büyük harfli.
- Makine değerleri ("PAP-41" ve "EXE-1" gibi görev kimlikleri, "2e7eeaa0" gibi çalışma kimlikleri, maliyetler, zaman damgaları), `DESIGN.md` içindeki 6. ilkenin gerektirdiği gibi eş aralıklı ya da eşit genişlikte rakamlıdır.

### 4.7 Yoğunluk ve boşluk

- Satırlar kompakttır. Eylül görüntüsünde kenar çubuğu satırları arasında yaklaşık 33 px, özellik paneli satırları arasında 30 ile 35 px vardır; satırlarda gri bir etiket sütunu ve bir değer sütunu bulunur.
- Listelerde her görev tek satırdır ve sütun sırası sabittir: durum simgesi, kimlik, canlı etiketi, başlık, atanan, proje, etiketler, göreli zaman (`docs/pr-screenshots/pr-6384/inbox-rows-desktop.png`).
- Kartların 1 px kenarlığı ve küçük bir köşe yuvarlaklığı vardır. Köşe yuvarlaklığı basamakları 0,5 rem değerine dayanır ve bu değerin 0,6; 0,8; 1,0; 1,4; 1,8; 2,2 ve 2,6 katıdır; kartlar büyük basamağı, giriş alanları ve düğmeler orta basamağı kullanır (`doc/design/DECISION-SHEET.md`). Haziran ayındaki karanlık tema görüntülerinde Genel bakış kartları köşeli görünür; açık temalı Apps görüntülerinde kartların ve tabloların köşeleri belirgin biçimde yuvarlaktır.
- Boşluk satırların içinde değil, akışın çevresinde ve gruplar arasında kullanılır.
- Gelen kutusu ve görev listeleri, üzerine gelince beliren aynı bandı ve aynı klavye davranışını paylaşır: `j`/`k` ve ok tuşları satırlar ve grup başlıkları arasında gezinir, Sol ve Sağ ok grubu kapatıp açar, Enter satırı açar (`doc/design/DECISION-SHEET.md`, 2026-07-09 tarihli karar).

### 4.8 Durum dili

`docs/pr-screenshots/pr-5291/after-status-language.png`, `releases/v2026.626.0.md` ve `doc/design/DECISION-SHEET.md` dosyalarına göre:

- Her görev durumunun tek bir simgesi ve tek bir rengi vardır; satırlarda, etiketlerde, konum bilgisinde ve özellik panelinde aynı biçimde kullanılır. Simgeler Lucide simgeleridir (`releases/v2026.720.0.md`) ve görev satırları 16 px boyutunu kullanır; 20 px boyutu denendi ve geri çekildi (`doc/design/DECISION-SHEET.md`).
- Ajan durum etiketleri: çalışıyor mavi, boşta gri, duraklatıldı sarı, etkin yeşil, hata kırmızı.
- Mayıs görüntüsünde engellenmiş görevlerin dikkat çekmek için üç çeşidi vardır: düz kırmızı bir halka, engelleyenle zaten ilgilenen etkin bir iş varsa içinde nokta olan bir halka ve takılmış bir inceleme için ortası noktalı sarı bir halka. Değişken dosyası sonradan, engelleyenle ilgilenildiğini gösteren durumun yerine "in queue" (sırada) durumunu koydu; bu durum engellenmiş şekliyle ama sürüyor mavisiyle çizilir (`ui/src/index.css`).
- Mavi bir "Live" etiketi, ajanı çalışan satırları işaretler.
- Sarı, insanın beklendiği durumları işaretler: planlama modunda "Planning" etiketi ve yazma kutusunun sarı kenarlığı, duraklatılmış görevde yazma kutusunun yerini alan blok, "QUEUED", "Interrupt" ve "Cancel" etiketli sıradaki mesaj balonu ve engelleyen etiketleri olan engellenme notları.
- Karar kartlarının yalnızca iki türü vardır: engelleyen (kırmızı, eksi işaretli daire simgesi) ve inceleme (mor, içi noktalı daire simgesi). Önem düzeyi rozet değil, filtredir.

### 4.9 Ekranlar ve bileşenler

**Genel bakış** (`screenshots/PR-8000-home-flag-on.png`, karanlık, Haziran 2026). Sayfa başlığı büyük harfli. Kenarlıklı dört ajan kartından oluşan bir sıra: durum noktası, baş harfli avatar, ajan adı, açma simgesi, "Finished 2d ago", o anki görevin adını veren kenarlıklı bir iç kutu, ardından "ClaudeCoder run [2e7eeaa0] succeeded 1d ago" gibi bir çalışma satırı; durum metni yeşil, çalışma kimliği eş aralıklı bir etiket içinde. Altında, büyük sayıları ve iki metin satırı olan kenarlıksız dört ölçüm kutusu: "23 / Agents Enabled / 0 running, 21 paused, 0 errors"; "0 / Tasks In Progress / 12 open, 4 blocked"; "$0.00 / Month Spend / Unlimited budget"; "0 / Pending Approvals / Awaiting board review" (etkin ajanlar, süren görevler, aylık harcama, bekleyen onaylar). Onların altında dört küçük grafik kartı (çalışma etkinliği, önceliğe göre görevler, duruma göre görevler, başarı oranı); her birinde "Last 14 days" yazar; ince, üst üste yığılmış çubuklar ve noktalı açıklamalar vardır. Sonra iki liste gelir: son etkinlikler ve son görevler. v2026.916.0 notları, Genel bakış kartlarının ve Live-runs kartlarının bu görüntüden sonra daha kompakt hâle getirildiğini söyler. [Not: bu ekran görüntüsü eski bir sürümdendir. Güncel arayüzde ajan simgeleri sunucuda üretilen karakter çizimleridir (01 ve 03 numaralı raporlar; asıl belge 5.2).]

**Görev listesi** (`docs/pr-screenshots/pr-6384/inbox-rows-desktop.png`, `doc/assets/execution-recovery/quiet-task-list.png`). Büyük harfli grup başlıkları (IN PROGRESS, TODO, IN REVIEW, BLOCKED, DONE); arama, filtreler, sütun ayarları, sıralama ve görünüm düğmeleri olan bir araç çubuğu. Filtre açılır menüsünde hızlı filtreler (Tümü, Etkin, Beklemede, Bitti) ve şu bölümler vardır: durum, öncelik, atanan, oluşturan, proje, etiketler, çalışma alanı ve görünürlük ("Live runs only", "Hide routine runs"). Eylül ayındaki "quiet" görüntülerinde çok yalın, açık renkli satırlar görülür: simge, eş aralıklı kimlik, başlık.

**Görev sayfası, sohbet biçimi** (`doc/assets/execution-recovery/fixture-completed.png`, açık, Eylül 2026). Akışta ajanlar için mesaj balonu yoktur. Her ajan turu baş harfli bir etiketle, kalın yazılmış ajan adıyla ve gri bir süreyle başlar ("Worked for 3s", "Stopped for 5s"). Araç etkinliği, somun anahtarı simgeli tek satırlık gri satırlara katlanır ("Used 2 tools", "Used a tool"). Anlatım satırları ve son yanıt düz siyah metindir. Her yanıtın altında solda küçük gri bir zaman damgası, sağda üç simge bulunur (kopyala, beğen, beğenme). Başarısız çalışma, çarpı işaretli daire simgesi olan tek bir kırmızı satırdır: "Run failed · just now"; ayrıntılar için bir ok vardır. Bağlantılar altı çizilidir ve dış bağlantı simgesi taşır. Sistem kartları kenarlıklı ve yuvarlak köşelidir: bağlantı kartının yeşil onay işaretli bir başlık satırı ("Connect … for the company · Accepted") ile kalın bir sonuç satırı ve gri bir açıklama içeren bir gövde satırı vardır. [Not: bu ekran görüntüsü eski bir sürümdendir. Güncel arayüzde ajan simgeleri sunucuda üretilen karakter çizimleridir (01 ve 03 numaralı raporlar; asıl belge 5.2).]

**Storybook'tan akış ayrıntıları** (`screenshots/PAP-10535-live-run-menu-after.png`, karanlık). İnsan mesajları sağa yaslıdır; yuvarlak köşeli koyu gri balonların içinde, baş harfli bir avatarla görünür. Süren bir tur, dönen bir simgesi olan "RUNNING" etiketini ve açılıp kapanan "Working for … · called 1 tool" satırlarını gösterir. Mesaj menüsünde şunlar vardır: Mesajı kopyala (Copy message); Çalışmayı durdur (Stop run) ve Durdur ve iptal et (Stop and cancel), ikisi de kırmızı; Durdur ve bitti say (Stop and done), yeşil; Çalışmayı görüntüle (View run). Sistem olayları, büyük harfli çok küçük bir etiketi olan sağa yaslı satırlardır ("ASSIGNEE Unassigned → CodexCoder"). Sonuca bağlanmamış çalışma notu, "DETAILS" düğmesi olan sarı kenarlıklı bir şerittir. Boş sohbet kesikli çizgili bir kutudur.

**Yazma kutusu** (Eylül görüntüsü). Yumuşak gölgeli, yuvarlak köşeli büyük bir kart. Yer tutucu metin "Message Executor, describe what you want done…" (ürün metninde uzun tire kullanılıyor). Alt satır: bir "+" düğmesi, yanında ok olan gri bir "Auto mode" etiketi, sağda bir ajan seçici ve beyaz oklu, yuvarlak siyah bir gönder düğmesi. Mod etiketi, bayrak kataloğunun "the three-mode composer" (üç modlu yazma kutusu) dediği şeyin parçasıdır (`packages/shared/src/feature-catalog.ts`); modlar Auto, Planning ve Ask modlarıdır ve etiketler v2026.831.0 sürümünden beri tam adlarını taşır (`releases/v2026.831.0.md`). Planlama modunda yazma kutusunun sarı bir kenarlığı ve bir "Planning" etiketi vardır (`doc/assets/pap-3368/desktop-planning-detail.png`). Bir çalışma sürerken ve yazma kutusu boşken gönder düğmesi Durdur düğmesine dönüşür (`doc/composer-stop.md`). Bekleyen sorular ve onay istekleri, yazma kutusunun hemen üstünde ayrı bir kartta durur (`DESIGN.md`).

**Özellik paneli** (Eylül görüntüsü). Çok küçük, büyük harfli etiketleri olan dört grup: WORK (durum, atanan, proje, etiketler), RELATIONSHIPS (üst görev, engelleyenler, engelledikleri, alt görevler), EXECUTION (inceleyenler, onaylayanlar, izleyici, gözcü), ABOUT (kaynak, başlama, tamamlanma, oluşturulma, güncellenme). Her satırda etiket solda, değer sağdadır; boş değerlerde "None" yazar ve seçiciyi açan bir ok bulunur. Haziran görüntüsünde öncelik, ilişkili görevler, çalışma alanı ve dal satırlarını içeren eski düz liste ile "3/3 done" yazısı, yeşil bir ilerleme çubuğu ve "All sub-tasks done" yazısı olan bir alt görev bloğu görülür.

**Görev başlığı sekmeleri.** Mayıs ayındaki planlama görüntüsünde Sohbet (Chat), Etkinlik (Activity) ve İlişkili işler (Related work) sekmeleri görülür. Sohbet biçimine geçilirken özellikler, plan ve çıktılar başlıktaki sekmelere taşındı (`releases/v2026.817.0.md`); sohbet kenar çubuğu da görevin bütün belgelerini ve çıktılarını listeler (`releases/v2026.824.0.md`).

**Görevdeki belgeler** (`docs/pr-screenshots/pr-6384/inbox-rows-desktop.png`). Belge kartlarında bir anahtar etiketi ("PLAN"), "rev 3" yazısı, güncellenme zamanı, biçimlendirilmiş markdown ve "+ New document" düğmesi bulunur.

**Çalışma defteri** (aynı görüntü). Etiketli çalışma satırları (çalışıyor, başarılı, ilerledi, yalnızca plan), geçen süre, "Last useful action" yazısı ve bir "Next action:" kutusu; RUN, STATUS, DURATION, COST sütunlu bir tablo.

**İzleyici ve yeniden deneme kartları** (`docs/pr-screenshots/pap-2945/monitor-surfaces.png`, `docs/assets/pr-5426/scheduled-retry-story-desktop.png`). "Check now" düğmeli, kenarlıklı bir "Monitor scheduled …" kartı; "Retry now" düğmeli, kenarlıklı bir "Retry scheduled / Automatic retry in 15m" kartı. Özellik panelinde Monitor satırı bir saat simgesi, bir sonraki zamanı ve "Attempt 1" yazısını gösterir (`design/pap-14557-monitor-visibility/screenshots/current-properties-monitor.png`).

**Bağlantılar (Connections)** (`doc/screenshots/garden-mcp-split-stack/apps-list.png`, açık). Başlık "Connections", alt başlık "The tools you've connected, and whether they're working." (bağladığınız araçlar ve çalışıp çalışmadıkları), sağ üstte düz siyah bir "Connect an app" düğmesi. Filtre etiketleri "All (4)" ve "Needs attention (2)". Soluk kırmızı bir uyarı şeridi: "2 apps need attention" yazısı, uygulama adları ve bir "Fix" bağlantısı. Küçük, büyük harfli başlıkları (APP, STATUS, ACTIONS, LAST USED) olan kenarlıklı bir tablo: kare marka simgesi, kalın yazılmış uygulama adı, gri bir neden satırı (anahtar çalışmayı bıraktı, düzeltmek için yeniden bağlanın), bir durum etiketi ("Healthy" yeşil tonlu, "Needs attention" sarı tonlu), "10 on", "1d ago" ve bir satır düğmesi: çerçeveli "Open" ya da düz siyah "Reconnect". İlgi bekleyen satırların zemini soluk sarıdır. Alttaki bir satır varsayılanı açıklar: "Who can use it" ayarı değiştirilmedikçe bağlı uygulamalar bütün ajanlara açıktır.

**Kurallar (Rules)** (`doc/screenshots/garden-mcp-split-stack/policies.png`, açık). İkinci kenar çubuğunda iki grup vardır: APPS (göz at, bağlantılar, inceleme) ve "Advanced setup for developers. Most teams never open this." (geliştiriciler için ileri düzey kurulum; çoğu ekip burayı hiç açmaz) açıklamalı DEVELOPER (geçitler, profiller, kurallar, sağlık, etkinlik, Smoke Lab). Sayfada "Rules are checked top to bottom" (kurallar yukarıdan aşağıya denetlenir) yazar ve sonucu ilk eşleşen kural belirler. Her kural bir cümledir: "When **any agent** uses **Execute Zapier Write Action** → **Ask first**"; altında gri bir alt satır, bir sonuç etiketi "Ask first", son 24 saat için "0 times" sayacı, yeşil bir aç/kapa düğmesi ve bir menü bulunur. Satırlarda sürükleme tutamağı vardır. Düğmeler: çerçeveli "Test a rule" ve dolu "New rule". Alttaki "Remembered approvals" bloğu kaydedilmiş "Always allow" kararlarını listeler; boş ekran metni "No remembered approvals yet."

**Erişim profili sihirbazı** (`doc/screenshots/garden-mcp-split-stack/profile-wizard.png`). Hazır seçenek kutuları olan üç adımlı bir sihirbaz: Salt okunur, Gündelik iş, Tam erişim, Sıfırdan başla, Var olan bir profili kopyala.

**Ayarlar, Deneysel** (`screenshots/PR-8000-settings-experimental-flag-on.png`, karanlık). Simge çubuğu ve iki gruplu bir ayarlar kenar çubuğu: COMPANY SETTINGS ve INSTANCE SETTINGS. Sayfa, kenarlıklı kartların dikey bir listesidir; her kartta bir başlık, tek paragraflık bir açıklama ve sağda bir aç/kapa düğmesi bulunur.

**Gizli anahtarlar** (`doc/pr/5429/*`, `doc/screenshots/pr-6381/*`). Bir envanter tablosu, bir sağlayıcı kasaları sekmesi, durumları olan bir bağlama seçicisi ve satırları düz (Plain) ya da gizli (Secret) olan bir ortam değişkeni düzenleyicisi.

**Ajan yapılandırması** (`screenshots/PR-7938-agent-config-forced-kubernetes.png`). Başlıklı bölümleri olan, tek sütunlu uzun bir form: Yürütme, Adaptör, İzinler ve yapılandırma (model, düşünme eforu, talimat dosyası, aç/kapa düğmeleri, ortam değişkeni satırları), Çalışma kuralı (zamanlı uyandırma aralığı).

**Yeni görev penceresi** (`docs/pr-screenshots/pap-2837/newissue-primary-desktop.png`). Cümle biçiminde bir üst satır ("For [agent] in [project]"), bir başlık alanı, bir açıklama alanı, durum, öncelik ve yükleme için küçük etiketler; alt satırda solda "Discard Draft", sağda "Create Issue".

**Ajanın Skills sekmesi** (`docs/pr-screenshots/pap-2944/*`). Onay kutulu bir skill listesi ve ayrı bir "Required by Paperclip" (Paperclip'in gerektirdikleri) grubu; açık ve karanlık temada, boş ve yüklenme durumlarıyla.

**Komut paleti ve kısayollar** (`docs/pr-screenshots/pr-5291/after-navigation-layout.png`). Ortalanmış bir palet ve bir kısayol listesi penceresi; pencere Gelen kutusu tuşlarını (`j`, `k`, ok tuşları, Enter, `a`, `y`, `r`, `U`), görev tuşlarını (`y`, `g i`, `g c`) ve her yerde çalışan tuşları (`/`, `c`, `[`, `]`, `?`) listeler.

**Conference Room** (`screenshots/PR-8000-conference-room-flag-on.png`, Haziran 2026). CEO ajanıyla bir sohbet: ajan yanıtları kenarlıklı kartlarda, kullanıcı mesajları dolu mavi balonlarda, yazma kutusunda "Ask anything about your company…" yazısı ve sağda "Agent Feed" başlıklı, "Live activity from your agents" (ajanlarınızdan canlı etkinlik) alt başlıklı bir sütun. Güçlü bir mavi dolgunun görüldüğü tek ekran budur. Bayrak varsayılan olarak kapalıdır ve aç/kapa düğmesi gizlidir.

**Telefon** (`docs/pr-screenshots/pr-5291/after-navigation-layout.png`, `doc/assets/pap-3368/mobile-planning-detail.png`). Beş öğeli bir alt menü (Ana sayfa, Görevler, Oluştur, Ajanlar, Gelen kutusu), tek sütunlu bir görev sayfası ve tam genişlikte bir yazma kutusu.

**Boş ekranlar ve hata durumları.** Boş ekran, tek bir soluk satır ya da yalın bir çizgi çizimdir ve tek bir eylem düğmesi içerir (`doc/spec/ui.md`; `docs/pr-screenshots/pr-5291/after-status-language.png` görselinde görülür). Yüklenirken yükleme iskeletleri kullanılır; hatalar satır içinde gösterilir (`doc/spec/ui.md`).

### 4.10 Hareket ve geri bildirim

- İlk hareket değişkenleri: giriş 160 ms, çıkış 110 ms, ease-out eğrisi `cubic-bezier(0.16, 1, 0.3, 1)` (`doc/design/DECISION-SHEET.md`). `prefers-reduced-motion` açıkken bütün süreler sıfıra iner (`DESIGN.md`).
- Etkileşimli kartlar üzerine gelince sakin bir tepki verir: kenarlık koyulaşır, küçük bir gölge belirir ve bir odak halkası görünür (`doc/design/DECISION-SHEET.md`).
- Karar defteri, shadcn'in hazır `animate-in` sınıflarının bu depoda hiçbir şey yapmadığını, bu yüzden hareketin kendi değişkenleri üzerine kurulması gerektiğini not eder.
- Sayfa yüklenirken hareketli bir ataş simgesi gösterilir (`releases/v2026.817.0.md`). İlk kurulumda, gri hâlde uyuyan ve inceleme adımında renklenerek uyanan hareketli bir karakter vardır (`releases/v2026.1001.0.md`).
- Canlı durum sayfaya bir WebSocket üzerinden ulaşır; bağlantı koptuğunda ekranda görünen sorgular 15 saniyede bir yoklama yapar (`releases/v2026.1001.0.md`).
- Sunucu beklenmeden ekrana yansıyan güncelleme: yorumlar, sunucu onaylarken hemen görünür (`releases/v2026.403.0.md`).

### 4.11 Belgelerdeki açık tasarım beyanları

- Şubat spesifikasyonundaki tasarım felsefesi: yoğun ama göz gezdirilebilir, önce klavye, pencere açmak yerine bağlam içinde, varsayılan karanlık tema, "Text is the primary visual element" (birincil görsel öğe metindir) (`doc/spec/ui.md`).
- O spesifikasyonda onayların üst düzey bir menü satırı yoktur; Gelen kutusu ve Genel bakış ekranlarında ve kayıtların üzerinde satır içi olarak ortaya çıkarlar (`doc/spec/ui.md`).
- Arayüz işi için üç katman: değişkenler, bileşenler, ekran görüntüleri. İnceleme ortamı Storybook'tur; 255 hikâyenin (story) açık ve karanlık temada görüntüsü alınır, toplam 510 görsel (`doc/design/CHANGING-THE-UI.md`).
- Arayüz değişikliği isterken geçerli iş akışı kuralı: "Describe outcomes, not implementations" (uygulamayı değil, sonucu tarif et) (`doc/design/CHANGING-THE-UI.md`).
- Bağlantılarla ilgili ürün metinleri app, connect, connection, allowed, ask-first ve review sözcüklerini kullanır; MCP, stdio, gateway, plugin ve manifest sözcükleri Developer ekranlarında kalır (`doc/connections/GLOSSARY.md`).
- Sohbet bağlayıcısı kurulumundaki kurallar: sabit numaralı adımlar, tek bir alt satır, önce ön koşullar, her kimlik bilgisi alanının yanında o bilgiyle ilgili yönerge; bekleyen sarı, bağlanmış yeşil gösterilir (`doc/connections/CHAT-CONNECTOR-UX.md`).
- README taslak notlarında "It's high taste, and feels good to use" (zevkli bir üründür ve kullanması keyiflidir) ifadesi geçer (`doc/README-draft.md`).

### 4.12 Görsel kanıtın sınırları

- Depodaki hiçbir ekran görüntüsü kararlar masasını, Gelen kutusu sayfasının bütününü, Çıktılar sayfasını, Maliyet sayfasını, Skill mağazasını, Skill Studio'yu, ajan sohbetini, durum kartlarını, iş zaman çizelgesini ya da listelerdeki ajan karakteri avatarlarını göstermiyor. Bu rapordaki tarifleri yalnızca sürüm notlarına ve belgelere dayanır.
- Eylül ayındaki açık tema görüntüleri ile Haziran ayındaki karanlık tema görüntüleri yeniden tasarımın farklı aşamalarına aittir; bu yüzden özellik paneli genişliği ve kenar çubuğu grupları gibi ayrıntılar ikisi arasında farklıdır.
- Storybook görüntüleri bileşenleri tek başlarına ve örnek veriyle gösterir.

## 5. Sözlük

Her terim için tek cümle ve kaynağı.

### 5.1 İnsanlar, organizasyon ve ajanlar

| Terim | Anlamı | Kaynak |
| --- | --- | --- |
| Board (yönetim kurulu) | Bir şirketi yöneten insan operatör (ya da operatörler): hedefleri ve bütçeleri belirler, önemli kararları onaylar; her ajanı duraklatabilir, sürdürebilir ya da sonlandırabilir ve her görevi başkasına atayabilir. | `doc/SPEC.md`, `docs/start/core-concepts.md` |
| Company / organization (şirket) | Bir hedefin, ajanların, bir organizasyon yapısının, bütçelerin ve bir görev hiyerarşisinin sahibi olan en üst düzey birim; bir kurulum birden çok şirket barındırır ve arayüz metinleri v2026.831.0 sürümünden beri "organization" der. | `docs/start/core-concepts.md`, `releases/v2026.831.0.md` |
| CEO | Şirketin en üstteki ajanı ve işi asıl dağıtan ajan: yönetim kurulu onayı için bir strateji yazar, hedefleri görevlere böler, görevleri atar ve ajan işe alır. | `docs/start/core-concepts.md` |
| Chief of staff (özel kalem müdürü) | İlk kurulumdaki ilk ajanın karakteri; ilk görevi sohbet olarak açar ve kullanıcının yanıtını bekler. | `releases/v2026.916.0.md`, `docs/guides/board-operator/editing-first-task-texts.md` |
| Agent (ajan) | Adaptörü, rolü, yöneticisi, yetenek satırı, aylık bütçesi ve durumu olan bir yapay zekâ çalışanı. | `docs/start/core-concepts.md` |
| Adapter (adaptör) | Ajanın nasıl çalışacağını tanımlayan köprü: yerel bir CLI, bir komut kabuğu süreci, bir HTTP uç noktası ya da bir geçit. | `docs/adapters/overview.md`, `docs/agents-runtime.md` |
| Heartbeat | Ajanın uyandığı, atamalarına baktığı, bir görevi üstlendiği, çalıştığı ve sonucu bildirdiği kısa bir yürütme penceresi; ajanlar sürekli çalışmaz. | `docs/start/core-concepts.md`, `docs/agents-runtime.md` |
| Wake (uyandırma) | Bir heartbeat'i başlatan tetikleyici: `timer`, `assignment`, `on_demand` ya da `automation`; çalışma sırasında gelen uyandırmalar birleştirilir. | `docs/agents-runtime.md` |
| Run (çalışma) | Ajanın kayda geçen tek bir yürütmesi; durumu (sırada, çalışıyor, başarılı, başarısız, zaman aşımı, iptal), token kullanımı, kayıtları ve maliyeti vardır. | `docs/agents-runtime.md` |
| Run liveness (çalışmanın canlılığı) | Çalışmanın ne elde ettiğini söyleyen etiket: `completed`, `advanced`, `plan_only`, `empty_response`, `blocked`, `failed` ya da `needs_followup`. | `docs/guides/agent-developer/heartbeat-protocol.md` |
| Responsible user (adına çalışılan kişi) | Çalışmanın adına hareket ettiği insan; çalışmanın hangi kişisel hesapları ve gizli anahtarları kullanabileceğini belirler ve etkinlik kaydında görünür. | `releases/v2026.707.0.md`, `releases/v2026.916.0.md` |
| Trust preset (hazır güven düzeyi) | Ajanın sınırlanma düzeyi: `standard` (şirket genelinde birlikte çalışma) ya da `low_trust_review` (adı verilen bir kapsamla sınırlı; düşmanca girdi okuyabilecek işler için). | `doc/LOW-TRUST-PRESETS.md` |
| Built-in agent (yerleşik ajan) | Paperclip'in kendisinin hazırlayıp yönettiği ajan; örneğin Summarizer. | `docs/built-in-agents.md` |
| Persona (ajan karakteri) | Ajanın kalıcı görsel kimliği: 17 renk takımından birini kullanan tek bir karakter. | `doc/agent-personas.md` |

### 5.2 İş

| Terim | Anlamı | Kaynak |
| --- | --- | --- |
| Issue / task (görev) | İş birimi; başlığı, açıklaması, durumu, tek bir atananı, üst görevi ve projesi vardır. Arayüz metinlerinde kullanılması zorunlu sözcük "task" sözcüğüdür; "issue" API'de ve eski belgelerde yaşamaya devam eder. | `docs/start/core-concepts.md`, `DESIGN.md` |
| Checkout (üstlenme) | Görevi tek bir ajan için `in_progress` durumuna geçiren atomik üstlenme; ikinci üstlenmek isteyen `409 Conflict` alır. | `docs/start/core-concepts.md`, `docs/api/issues.md` |
| Sub-task (alt görev) | Bir görevin altındaki görev; sıralı alt görevler üst görevde ilerleme kontrol listesi olarak gösterilir. | `releases/v2026.427.0.md` |
| Blocker (engelleyen) | Bir görevin başka bir görevi beklediğini söyleyen ilişki; bütün engelleyenler bitince bekleyen görevin atananı uyandırılır. | `releases/v2026.414.0.md` |
| Work mode (çalışma modu) | Görevin nasıl çalıştığı: standart ("Auto mode"), planlama ya da soru; başlıkta plan istenmesi modu değiştirmez. | `releases/v2026.512.0.md`, `releases/v2026.626.0.md`, `doc/SPEC.md` |
| Goal (hedef) | Şirket, ekip ya da ajan düzeyinde, durumu olan bir niyet beyanı; görevler ona kadar izlenebilir. | `docs/api/goals-and-projects.md` |
| Project (proje) | Bir teslimata yönelik görev grubu. | `docs/guides/board-operator/managing-tasks.md` |
| Routine (rutin) | Tetikleyicileri (zamanlama, webhook, API), bir çakışma kuralı ve bir telafi kuralı olan yinelenen görev tanımı. | `docs/api/routines.md` |
| Monitor (izleyici) | Görev üzerinde, atananı doğru zamanda uyandıran zamanlanmış bir denetim. | `releases/v2026.512.0.md` |
| Watchdog (task watchdog; görev gözcüsü) | Durmuş bir görev ağacını doğrulamak ve durma bir hataysa çalışan bir yolu yeniden kurmak için atanan ajan. | `doc/TASK-WATCHDOG.md` |
| Recovery action (kurtarma eylemi) | Takılan ya da sonuca bağlanmamış iş için görev üzerinde tutulan, sahibi, kanıtı ve sonucu olan başlı başına bir kayıt. | `releases/v2026.513.0.md` |
| Document (belge) | Görev üzerindeki, anahtarı ve sürümleri olan markdown belgesi; örneğin plan. | `docs/api/issues.md` |
| Work product (çıktı) | Ajanın bir göreve kaydettiği teslimat; böylece kart olarak ve Çıktılar görünümlerinde görünür. | `doc/AGENT-ARTIFACTS.md` |
| Artifact (çıktı) | Ajanların ürettiği dosya, medya öğesi ya da belge; şirketin Çıktılar sayfası bunların hepsini dizinler. | `releases/v2026.609.0.md` |
| Case | Görevlerin zaman içinde oluşturup geliştirdiği, belgeye dayanan kalıcı bir kayıt (deneysel). | `releases/v2026.720.0.md`, `packages/shared/src/feature-catalog.ts` |
| Pipeline | Case'lerin içinden geçtiği aşamaların tanımı; insanın kabul ettiği öneriler ve inceleme kararları içerir (deneysel). | `docs/pipelines-tutorial.md` |
| Execution workspace (yürütme çalışma alanı) | Proje kodunun tek bir görev için yalıtılmış kopyası (deneysel, kodlama işleri için). | `releases/v2026.318.0.md` |
| Environment (ortam) | Çalışmanın yürütüldüğü yer: yerel, SSH üzerinden uzak ya da bir sağlayıcı eklentisinden gelen sandbox. | `releases/v2026.427.0.md` |

### 5.3 Dikkat gerektirenler ve yönetişim

| Terim | Anlamı | Kaynak |
| --- | --- | --- |
| Inbox (Gelen kutusu) | Değişen ya da ilgi bekleyen kalemlerin kullanıcıya özel listesi; okundu bilgisi ve arşivi vardır. | `releases/v0.3.0.md`, `releases/v2026.403.0.md` |
| Attention feed (ilgi bekleyenler akışı) | Şu anda insan kararı gerektiren her şeyin sıralı listesi. | `releases/v2026.817.0.md` |
| Approval (onay) | Ajanın gönderdiği, yönetim kurulunun onayladığı, reddettiği ya da düzeltme için geri gönderdiği istek; belgelenmiş türleri `hire_agent` ve `approve_ceo_strategy`. | `docs/guides/board-operator/approvals.md` |
| Interaction (etkileşim) | Görev akışındaki yapılandırılmış kart; ajan bu kartla bir insandan görev seçmesini, soru yanıtlamasını ya da bir öneriyi onaylamasını ister. | `docs/api/issues.md` |
| Resolver policy (yanıtlama kuralı) | Bir etkileşimi kimin yanıtlayabileceğini söyleyen kural: `anyone`, `not_creator` ya da `human_only`. | `docs/api/issues.md` |
| Decision (karar) | Ajanın eyleme geçmek yerine açtığı, türü belirli seçenekleri olan öneri; bir insan bir seçeneği seçer, seçilen etki yürütülür ve denetim kaydına geçer. | `releases/v2026.817.0.md` |
| Decisions desk (kararlar masası) | Kararların ayıklandığı, eskidiği, saklandığı ya da arşivlendiği sayfa. | `releases/v2026.817.0.md`, `doc/SPEC-implementation.md` §7.16 |
| Execution policy (yürütme kuralı) | Görev üzerindeki isteğe bağlı bir nesne; yürüten işini bitirdikten sonra geçilmesi gereken inceleme ve onay aşamalarını tanımlar; çalışma zamanı bunu zorunlu kılar. | `docs/guides/execution-policy.md` |
| Review stage / approval stage (inceleme aşaması / onay aşaması) | Yürütme kuralındaki bir aşama; inceleyen değişiklik isteyebilir, onaylayan son onayı verir. | `docs/guides/execution-policy.md` |
| Activity log (etkinlik kaydı) | Her değişikliğin aktör, eylem, kayıt, ayrıntılar ve zamanla tutulduğu denetim izi. | `docs/guides/board-operator/activity-log.md` |
| Cost event (maliyet olayı) | Sağlayıcı, model, token ve sent bilgisiyle bildirilen tek bir harcama birimi. | `docs/guides/board-operator/costs-and-budgets.md` |
| Budget (bütçe) | Şirket, ajan ya da proje için aylık harcama sınırı; yüzde 80'de yumuşak uyarı, yüzde 100'de kesin durdurma vardır. | `doc/SPEC-implementation.md` §13 |
| Status card (durum kartı) | Tek cümleyle tanımlanan ve yalnızca izlediği arama sonucu değiştiğinde yenilenen deneysel, kalıcı bir özet. | `docs/guides/board-operator/status-cards.md` |
| Summary slot (özet yuvası) | Proje ya da çalışma alanı sayfasında, Summarizer ajanının güncel bir özet yazdığı deneysel, sabit bir yer. | `releases/v2026.720.0.md`, `packages/shared/src/feature-catalog.ts` |

### 5.4 Skill'ler, bağlantılar ve uzantılar

| Terim | Anlamı | Kaynak |
| --- | --- | --- |
| Skill | Ajanın izlediği talimat paketi (bir `SKILL.md`, isteğe bağlı olarak dosyalarla birlikte); skill bağlantıları kullanabilir ama kendi token'ını tutmamalıdır. | `docs/guides/agent-developer/writing-a-skill.md`, `doc/connections/GLOSSARY.md` |
| App (uygulama) | Dış ya da birinci taraf bir sistem için katalog kaydı: üst veri, desteklenen aktarım yolları, kimlik doğrulama modları ve bir eylem kataloğu. | `doc/connections/GLOSSARY.md` |
| Connection (bağlantı) | Bir uygulamanın tek bir şirket için yapılandırılmış, kimlik bilgisi verilmiş örneği; durumu ve sağlık bilgisi vardır. | `doc/connections/GLOSSARY.md` |
| Action / tool (eylem / araç) | Bağlantının çağrılabilen tek bir yeteneği; risk sınıfı vardır ve yeni ya da değişmiş olduğunda karantinaya alınır. | `doc/connections/GLOSSARY.md` |
| Rule (kural) | Bir eylem için allow (izin ver), ask-first (önce sor) ya da block (engelle) kararı; ask-first olanlar inceleme (Review) sırasına düşer. | `doc/connections/GLOSSARY.md` |
| Review (inceleme) | Bir insanın ask-first eylemini onayladığı ya da reddettiği sıra ve görev içindeki kart. | `doc/connections/TASK-REVIEWS.md` |
| Remembered permission (hatırlanan izin) | Aynı ajan, bağlantı ve eylem için kaydedilmiş bir "Always allow" kararı; isteğin geldiği projeyle sınırlıdır. | `doc/connections/TASK-REVIEWS.md` |
| Profile (profil) | Şirket, proje, ajan, rutin ya da görev gibi bir kapsama bağlanan, özenle seçilmiş eylem izin listesi. | `doc/connections/GLOSSARY.md` |
| Grant (yetki) | Tek bir bağlantı öznesi ve sağlayıcı kiracısı için, kimlik bilgisi taşıyan yetkilendirme. | `doc/connections/GLOSSARY.md` |
| Gateway (geçit) | Seçilen bağlantıları kapsamı sınırlı bir token ile dış istemcilere açan, adlandırılmış gelen MCP uç noktası. | `doc/connections/GLOSSARY.md` |
| Broker (aracı) | Saklanan bir kimlik bilgisini ve bir yetkiyi kısa ömürlü, daraltılmış bir token'a çeviren çalışma zamanı servisi. | `doc/connections/GLOSSARY.md` |
| Connection intent (bağlantı isteği) | Ajanın görev akışında açtığı ve adına çalışılan kişiden bir servisi bağlamasını isteyen istek. | `doc/connection-intents.md` |
| Secret (gizli anahtar) | Şirketin gizli anahtar deposundaki adlandırılmış kimlik bilgisi; yapılandırmalar değeri tutmak yerine ona referans verir. | `docs/deploy/secrets.md` |
| Plugin (eklenti) | Worker'ları, arayüzü ve göçleri olan kod uzantı paketi; "Packaging, not governance." (paketleme, yönetişim değil). | `doc/connections/GLOSSARY.md`, `doc/plugins/PLUGIN_SPEC.md` |
| Agent Companies paketi | Bütün bir şirket için dosya biçimi (`COMPANY.md`, `TEAM.md`, `AGENTS.md`, `PROJECT.md`, `TASK.md`, `SKILL.md`). | `docs/companies/companies-spec.md` |
| Release channel (sürüm kanalı) | Şunlardan biri: canary, nightly, beta ya da stable. | `doc/CHANNELS.md` |
| Experimental feature (deneysel özellik) | Uyumluluk güvencesi olmayan, isteğe bağlı açılan özellik; Kurulum ayarları > Deneysel (Instance Settings > Experimental) sayfasından etkinleştirilir. | `docs/guides/board-operator/experimental-features.md` |
| Deployment mode (kurulum modu) | Tek bir yerel operatör için `local_trusted` ya da ortak kullanım için `authenticated` (özel ya da herkese açık). | `docs/deploy/deployment-modes.md` |

Belgelerde bilinmesi gereken bir tutarsızlık: `docs/start/core-concepts.md` hâlâ @ ile anmayı bir uyandırma tetikleyicisi olarak sayıyor ve işe alımları yönetim kurulunun onaylaması gerektiğini söylüyor; oysa sürüm notlarına göre işe alma onayı v2026.428.0 sürümünden beri isteğe bağlı, v2026.1005.0 notlarında da @ ile anma artık çalışma başlatmıyor.

## 6. Agent Office için önemi

Dayanak: yalnızca bu görevle birlikte verilen Agent Office tanımı. Agent Office, iki küçük şirket için şirket içi bir web panelidir. Çalışanlar iş ister ve sonuçları onaylar. Birimler hâlinde düzenlenmiş yapay zekâ ajanları dokümantasyon, planlama, araştırma, taslak yazma, e-posta özetleri ve güvenlik taramaları yapar. Dışa etkili her eylem insan onayı gerektirir. Ajanlar API bütçesini boşa harcamamalıdır. Arayüz Türkçedir.

Sıralama, bu tanımdaki üç şeye göre yapıldı: dışa etkiden önce insan onayı, bütçe güvenliği ve teknik olmayan çalışanların izleyebileceği bir arayüz.

### 6.1 En çok alınmaya değer yirmi özellik

| Sıra | Özellik | Neden uyuyor | Bu raporda nerede |
| --- | --- | --- | --- |
| 1 | Eylem başına kurallar ve "Ask first" incelemesi | "Dışa etkili her eylem insan onayı gerektirir" kuralına en yakın karşılıktır. Saklanan argümanlar onay verilince tam olarak bir kez çalışır, inceleme beklerken hiçbir şey çalışmaz ve ajan bu arada görevi kapatamaz. | 2.5, 2.10, 4.9 |
| 2 | Erken uyarılı kesin bütçe durdurması | Yüzde 100'de sunucu tarafında durdurma, yüzde 80'de uyarı ve her uyandırmadan önce denetlenen bir harcama tavanı, isteme güvenmeden "ajanlar API bütçesini boşa harcamamalıdır" kuralına hizmet eder. | 2.6 |
| 3 | Dikkat gerektirenlerin tek adresi olarak Gelen kutusu | Çalışanların, kendilerini bekleyen işlerin tek bir listesine ihtiyacı var: onaylar, sorular, başarısız çalışmalar ve biten işler; okundu bilgisi, "Mine" sekmesi ve geri alınabilen arşivle birlikte. | 2.4 |
| 4 | Yapılandırılmış akış etkileşimleri | Sorular, ret gerekçesi zorunlu onay istekleri, işaretli seçimler ve görev önerileri serbest metinle yazışmanın yerini alır; `human_only` kuralı da ajanların insanlar adına yanıt vermesini engeller. | 2.3, 2.5 |
| 5 | Araç etkinliği katlanmış, sohbet biçiminde görev akışı | Teknik olmayan çalışanlar ajanın ne yaptığını izleyebilir: önce kısa bir anlatım ve sonuç, tek satıra katlanmış araç çağrıları, bir tık ötede ham ayrıntı. | 2.3, 4.9 |
| 6 | İnceleme ve onay aşamalı yürütme kuralı | "Sonuçları çalışanlar onaylar" kuralı, görevin çalışma zamanınca zorunlu kılınan bir özelliğine dönüşür; değişiklik isteme döngüsü ve saklanan kararlar vardır. | 2.5 |
| 7 | İşin görüntülendiği yerde maliyet | Çalışma ve görev başına maliyet, ajan, proje ve model başına toplamlar ve aylık harcama kutusu, bütçe kullanımını sınıra gelinmeden görünür kılar. | 2.6, 4.9 |
| 8 | Zamanlanmış işler için token tasarrufu kuralları | Uyandırmaların birleştirilmesi, çakışma kuralı, etkinlik kapısı ve her model çağrısından önce veritabanında değişiklik denetimi, hiçbir şey değişmediğinde yinelenen işlerin token harcamasını önler. | 2.4, 2.8 |
| 9 | Rutinler | E-posta özetleri ve güvenlik taramaları yinelenen işlerdir; rutinler zamanlama, değişkenler, telafi kuralı, sürüm geçmişi ve projeyle birlikte işleyen duraklatma ekler. | 2.8 |
| 10 | Plan onaylı çalışma modları | Planlama modu yürütmeden önce planı onaylatır; soru (Ask) modu tam bir çalışma olmadan bir soruyu yanıtlar. Bu, planlama ve araştırma birimlerine uyar ve bütçeden tasarruf sağlar. | 2.3 |
| 11 | Sürümleri, notları ve kilitleri olan görev belgeleri | Dokümantasyon ve taslak yazma temel çıktılardır; çalışanlar tek bir pasaja yorum yazar, sürümleri karşılaştırır, eski bir sürümü geri yükler ve onaylanan sürümü kilitler. | 2.14, 2.5 |
| 12 | Çıktılar sayfası ve çıktı kartları | Çalışanların onayladığı şey sonuçlardır; bu yüzden çıktılar, akışı okumadan bulunabilen başlı başına nesneler olmalıdır. | 2.14 |
| 13 | Kararlar masası ve ilgi bekleyenler akışı | Ajanlar eyleme geçmek yerine seçenek önerir ve bir insan birini seçer; bu, onayı önde tutan bir ofise uyar. Dikkat: Paperclip'te kenar çubuğu satırı varsayılan olarak kapalıdır ve bir parçası kaldırılmıştır; yani biçimi hâlâ değişiyor. | 2.4, 3.2 |
| 14 | Genel bakış | O anki görevi ve son çalışmayı gösteren ajan kartları, dört sayı kutusu (ajanlar, süren görevler, aylık harcama, bekleyen onaylar) ve küçük grafikler, iki küçük şirkete durumu bir bakışta verir. | 2.4, 4.9 |
| 15 | Adına çalışılan kişiyi gösteren tek Etkinlik sayfası | Kimin istediğini, kimin onayladığını ve hangi ajanın işlem yaptığını gösterir; bütün aktörler ile ajan eylemleri arasında geçiş düğmesi ve ajan başına denetim sekmesi vardır. | 2.5, 2.2 |
| 16 | Durumu dürüstçe gösteren durdurma ve duraklatma kontrolleri | Şunlar küçük bir ekibin bir ajanı anında durdurmasını ve hiçbir hatayı kaçırmamasını sağlar: yazma kutusundaki Durdur, alt ağacı duraklatma, kenar çubuğundan ajan duraklatma, yazma kutusunun yerini alan sarı "paused" bloğu ve "Retry now" düğmeli, görünür başarısız çalışmalar. | 2.2, 2.3, 1.5 |
| 17 | Tasarım kuralları ve tek durum dili | Yalnızca değişken kullanma, tek durum renk takımı, eş aralıklı makine değerleri, yaptığı işi söyleyen düğmeler, ne yapılacağını söyleyen hatalar ve görünen durum için bildirim çıkarmama; bunları kural olarak almak ucuzdur ve Türkçe bir arayüzü tutarlı tutar. | 1.5, 4.5, 4.8 |
| 18 | Engelleyenli alt görev kontrol listesi | Birimler arasında çok adımlı iş izlenebilir kalır; üst görev ilerlemeyi gösterir ve bekleyen görev, engelleyenleri bitince uyanır. | 2.3 |
| 19 | Ajan çıktılarına geri bildirim oyları | Gerekçeli "Helpful" ve "Needs work" oyları, taslaklar ve özetler için ucuz bir kalite döngüsüdür. | 2.14 |
| 20 | Rolleri ve davetleri olan şirket çubuğu | İki şirket olduğunda, her şirket için canlı noktası ve okunmamış noktası gösteren bir çubuk ile basit roller (Owner, Admin, Operator, Viewer) iki şirketi ayrı ama bir tık uzaklıkta tutar. | 2.1, 2.18, 4.3 |

### 6.2 Yeniden bakmaya değenler

- Şirket araması, Cmd-K paleti ve Gelen kutusu ile görev listelerinin ortak kullandığı klavye kısayolları (2.15).
- Durum kartları: değişiklik algılaması ve günlük token tavanı olan, tek cümleyle tanımlanan kalıcı özetler. Paperclip'te deneysel (2.4).
- Ajan listesi ve ayrıntı sekmeleri (çalışmalar, talimatlar, skill'ler, denetim) ve ajanları çabuk tanımak için ajan karakterleri (2.2).
- Birimler ağaç olarak gösterilecekse organizasyon şeması (2.1).
- Sürümleri olan skill kitaplığı ve biten bir görevden öğrenilenleri yeniden kullanılabilir bir skill'e çeviren "Skill created" kartı (2.9).
- Sağlık etiketleri ve yeniden bağlan düğmesi olan bağlantılar tablosu ve ajan bir bağlantıya ihtiyaç duyduğunda akışın içinde açılan istek (2.10, 4.9).
- Uzun süre bekleyen işler için görev izleyicileri ve görev gözcüsü (2.3).
- İleride yapılacak e-posta gönderimi için kalıp olarak AgentMail kural takımı: her e-posta ileti dizisi tek bir görevdir, gönderme açık bir eylemdir, görev içi yorumlar hiçbir zaman e-posta olarak dışarı çıkamaz (2.13).
- Araç sonuçlarının ajana, sınırı belli ayrı bir blok içinde güvenilmeyen veri olarak verilmesi (2.10).
- Deneysel bayraklar için ayar sayfası kalıbı: her bayrak için başlığı, açıklaması ve aç/kapa düğmesi olan bir kart (2.19).
- Telefonda alt menü ve kurulabilir PWA (2.21).
- Kenar çubuğunda yıldızlı öğeler ve "Recent tasks" listesi (4.4).

### 6.3 Uymayan özellikler

Kodlama odaklı olanlar:

- Git worktree'leri, yürütme çalışma alanları, çalışma alanı fark görüntüleyici, çalışma zamanı servisleri ve ön izleme adresleri, Tailscale üzerinden HTTPS ön izlemeleri.
- GitHub PR inceleme botu, PR bakımı, GitHub kimlikleri, pull request'ler için dış nesne durumu.
- Sandbox sağlayıcıları ve ortamlar (E2B, Daytona, Modal, Cloudflare, Kubernetes, Novita, CreateOS, exe.dev), SSH terminalli özel sandbox imajları, görev kapsamında verilen ağ çıkış yetkileri.
- Komut satırı kodlama adaptörleri (Claude Code, Codex, Cursor, Gemini, OpenCode, Pi, Hermes, Grok, Kimi, OpenClaw), Paperclip'in kendi çalıştırıcısı ve ACP.
- Canlı tarayıcı sekmeleriyle Browser Use Cloud.

Özerklik odaklı olanlar:

- CEO strateji onayı, ajanların ajan işe alması, emir komuta zincirinde görev devretme, kendi kendine örgütlenme ve planlanan "MAXIMIZER MODE".
- Çalıştırma ortamlarında tam otomatik varsayılanlar, standart güven düzeyindeki ajanlar için varsayılan olarak açık yazma izni ve yanıtlama kuralında varsayılan `anyone` değeri. Bu varsayılanlar "dışa etkili her eylem insan onayı gerektirir" kuralının tam tersi yöndedir.
- Salt okunur eylemlerle sınırlanmadığı sürece, dışa etkili eylemler için "Always allow".

Platform ve dağıtım:

- Şirketi içe ve dışa aktarma, Agent Companies dosya biçimi, ekip kataloğu ve planlanan ClipHub kayıt defteri.
- Eklenti sistemi ve SDK, gelen MCP geçitleri, MCP toplayıcıları, Smoke Lab.
- Sürüm kanalları, yönetilen kurulum CLI'si, `test-drive`, bulut kiracılığı, üreticinin telemetrisi ve üreticinin duyuru akışı.
- Dış sohbet bağlayıcıları (Slack, Discord, Telegram, Teams, iMessage), ajan sohbeti ve Conference Room. Ürün belgesinin kendisi, çekirdeğe genel amaçlı bir sohbet uygulaması konmamasını söyler.
- Bellek bağlayıcıları ve LLM Wiki eklentisi.
- Cases ve Pipelines, en azından deneysel oldukları sürece.

### 6.4 Alırken dikkat edilecekler

- **Varsayılanlar özerklik yönünde değişti.** Paperclip 2026 içinde işe alma onayını isteğe bağlı yaptı (v2026.428.0), standart güven düzeyindeki ajanların şirkette görünen her göreve yazmasına izin verdi (v2026.817.0), etkileşim yanıtlama kuralının varsayılanını `anyone` yaptı (v2026.824.0) ve çalıştırma ortamlarını varsayılan olarak tam otomatiğe aldı (v2026.1001.0). Mekanizmalar yararlıdır; varsayılanlar ise onayı önde tutan bir ofisin isteyeceği şey değildir.
- **Dışa etkili eylem onayının yeri.** Paperclip'in Onaylar (Approvals) sayfası işe alma ve CEO stratejisi türleri için kurulmuştur. Tek bir dışa etkili eylemin onayı ise bağlantıların inceleme (Review) akışında ve akış etkileşimlerinde durur. Onaylar sayfası değil, bunlar örnek alınmalıdır.
- **Onayın geçerlilik süresi.** Araç eylemi onayının süresi varsayılan olarak bir saat sonra dolar (`doc/connections/TASK-REVIEWS.md`). Günün ilerleyen saatlerinde onay veren çalışanlar için farklı bir süre kuralı gerekir.
- **Çevrilmiş arayüz yok.** Paperclip'te yalnızca i18n altyapısı var (v2026.517.0). Türkçe metinler sıfırdan yazılmalıdır; yeniden kullanılabilecek kısım `DESIGN.md` içindeki 7. ilkede yer alan metin kurallarıdır.
- **Gmail izin kapsamı.** Paperclip'in Gmail bağlantısı `gmail.readonly` ve `gmail.compose` izinlerini ister ve taslakları Gmail'de oluşturur (`doc/connections/GMAIL.md`). Taslakları kendi içinde tutan bir panele yalnızca okuma izni yeter.
- **Deneysel, kararsız demektir.** Belgeler deneysel özelliklerin uyumluluk güvencesi olmadığını ve kaldırılabileceğini söyler (`docs/guides/board-operator/experimental-features.md`). Durum kartları, özet yuvaları, Cases, Pipelines, ajan sohbeti ve sohbet bağlayıcıları bu gruptadır.
- **Geri çekilen fikirler.** Otomatik verimlilik incelemeleri, ucuz model profilleri, sessiz çalışmalarda otomatik devralma ve ajanları uyandıran @ ile anma yayımlandı, sonra kaldırıldı (bölüm 3.2). İlki için belirtilen gerekçe, altyapı hatalarının kuralları tetikleyip iş üretebilmesidir.
- **Korunmaya değer iki benzerlik.** Paperclip, girişi kaynak bağlantılarından ayırır ve bunları kapsamları farklı iki düzlem olarak ele alır (`doc/connections/README.md`); sağlayıcı çıktısını da açık bir sınırla ayrılmış güvenilmeyen veri olarak işler (`doc/connections/TASK-REVIEWS.md`).
