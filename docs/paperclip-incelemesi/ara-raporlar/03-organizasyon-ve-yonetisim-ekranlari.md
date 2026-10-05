# Paperclip incelemesi 03: organizasyon, ajanlar ve yönetişim ekranları

> Ara rapor. 3 Ekim 2026'da, Agent Office deposu okunmadan önce İngilizce yazıldı; depoya konurken Türkçeye çevrildi. Asıl belge `docs/paperclip-incelemesi.md` dosyasıdır; ikisi çelişirse o geçerlidir. Okuma notu ve bilinen düzeltmeler: [`00-okuma-notu.md`](00-okuma-notu.md).

Kaynak: `/home/claude/paperclip`, commit dd868ed. Aşağıdaki bütün yollar bu köke göredir. Kaynak gösterimi `path:line` biçimindedir ve dosyanın o commit'teki hâlini gösterir. Tek başına duran `:123`, aynı cümlede ya da paragrafta en son adı geçen dosyayı, o yoksa bölüm başlığındaki dosyayı gösterir. Depoda hiçbir şey değiştirilmedi, derlenmedi, kurulmadı ya da çalıştırılmadı. Burada yazılan her şey kaynak koddan okundu; bir dosyaya yalnızca göz attığım ya da bir şeyi doğrulayamadığım yerler bölüm 16'da belirtildi.

Kodun kullandığı ve bu raporda korunan sözcükler:

| Paperclip sözcüğü | Anlamı |
|---|---|
| company / organization | Kiracı. Kod ve API `company` der, arayüz metinleri "organization" der (örneğin `ui/src/pages/Companies.tsx:92`, `:116`). |
| board | Bir şirketin insan operatörleri. Onaylar "board" (yönetim kurulu) kararlarıdır (`server/src/routes/approvals.ts:287`). |
| issue / task | Tek bir iş birimi. Kod `issue`, arayüz "task" (görev) der. |
| heartbeat run | Bir ajanın tek bir çalışması. Çalışmayı başlatan kaynaklar şunlardır: `timer`, `assignment`, `on_demand`, `automation`. |
| adapter | Ajanı çalıştıran çalışma ortamı (Claude Code CLI, Codex CLI, HTTP webhook ve benzeri). |

---

## 1. Bu alandaki ekranların ortak temelleri

### 1.1 Yollar

Yönetim kurulu ekranlarının tümü bir şirket kodunun altında durur: `<Route path=":companyPrefix" element={streamlinedUiEnabled ? <Layout /> : <ProductionLayout />}>` (`ui/src/App.tsx:837`). Bu kod, şirketin görev kimliklerinde kullanılan kısa kodudur (örneğin `/ACME/agents/all`). Benim alanıma giren yollar:

| Yol (`/:companyPrefix` altında) | Sayfa | Kaynak |
|---|---|---|
| `agents/{all,active,paused,error,builtin}` | `Agents` | `ui/src/App.tsx:278-284` |
| `agents/new` | `NewAgent` | `ui/src/App.tsx:285` |
| `agents/:agentId`, `agents/:agentId/:tab`, `agents/:agentId/runs/:runId` | `AgentDetail` | `ui/src/App.tsx:286-288` |
| `org` | sade kabuk: `/agents/all` yoluna yönlendirme; eski kabuk: `OrgChart.production` | `ui/src/App.tsx:273-276` |
| `chats`, `chats/:agentRef` | `AgentChats`, `AgentChat` | `ui/src/App.tsx:311-312` |
| `approvals` (`approvals/pending` yoluna yönlendirir), `approvals/pending`, `approvals/all`, `approvals/:approvalId` | `Approvals`, `ApprovalDetail` | `ui/src/App.tsx:384-387` |
| `activity`, `activity/{runs,costs,budgets,timeline}` | `AuditHub` (sade kabuk). `/costs`, `/budgets` ve `/runs` buraya yönlendirilir; eski kabukta `/costs` yolu `Costs.production` sayfasını çizer | `ui/src/App.tsx:388-410` |
| `goals`, `goals/:goalId` | `Goals`, `GoalDetail` | `ui/src/App.tsx:381-382` |
| `projects...` | `Projects`, `ProjectDetail` | `ui/src/App.tsx:289-299` |
| `routines`, rutin ayrıntı bölümleri | `Routines`, `RoutineDetail` | `ui/src/App.tsx:317`, `:369-370` |
| `workspaces`, `execution-workspaces/:workspaceId/...` | `IsolatedWorkspacesRouteGate` kapısının arkasında | `ui/src/App.tsx:294-302`, `:371-380` |
| `skills/sources`, `skills/studio[/new\|/:skillId]`, `skills/*` | `SkillSources`, `SkillStudio`, `CompanySkills` | `ui/src/App.tsx:260-269` |
| `apps`, `apps/connect`, `apps/byo`, `apps/review`, `apps/gateways`, `apps/advanced/...`, `apps/:connectionId/:tab` | Bağlayıcılar ve araçlar | `ui/src/App.tsx:197-234` |
| `company/settings...` | Ayar sayfaları; her biri `HiddenSettingsPageGate` ile sarılı | `ui/src/App.tsx:163-258` |
| `plugins/:pluginId`, `:pluginRoutePath/*` | `PluginPage` | `ui/src/App.tsx:272`, `:437` |
| `board-chat`, `artifacts` | `ConferenceRoomChatGate` kapısının arkasında | `ui/src/App.tsx:416-419` |
| en üst düzeyde `auth`, `board-claim/:token`, `cli-auth/:id`, `invite/:token`, `onboarding` | giriş ve ilk kurulum | `ui/src/App.tsx:752-769` |

Şirket kodunun önüne eklendiği yol köklerinin listesi `ui/src/lib/company-routes.ts:1-30` içindedir (`dashboard`, `agents`, `approvals`, `costs`, `goals`, ...).

### 1.2 `.production.tsx` ayrımının anlamı

İki arayüz kabuğu vardır. Hangisinin kullanılacağını deneysel `enableStreamlinedUi` bayrağı belirler ve bu bayrak varsayılan olarak açıktır: `return settings?.enableStreamlinedUi !== false;` (`ui/src/hooks/useStreamlinedUiEnabled.ts:13`), şemadaki varsayılan `z.boolean().default(true)` (`packages/shared/src/validators/instance.ts:48`).

- Son eki olmayan dosyalar "streamlined" (güncel, varsayılan) sürümlerdir.
- Adı `*.production.tsx` olan dosyalar eski sürümlerdir. Yalnızca bayrak açıkça `false` olduğunda, gerektikleri anda yüklenirler (`ui/src/App.tsx:119-142`; `:144` satırındaki `ProductionSurface` üzerinden bağlanırlar).
- Uygulamaya gerçekten bağlanan eski sayfa sürümleri: `Agents.production`, `Routines.production`, `RoutineDetail.production`, `CompanySkills.production`, `CompanyActivity.production`, `Costs.production`, `OrgChart.production` (`ui/src/App.tsx:122-142`). Eski kabuğun ayrıca kendi `Layout.production` ve `Sidebar.production` bileşenleri ile bunlara bağlı kenar çubuğu bileşenleri vardır (`ui/src/components/Layout.production.tsx:20-41`).
- `ui/src/pages/AgentDetail.production.tsx` dosyası vardır (4548 satır) ama `App.tsx` onu hiçbir yola bağlamaz. Dosyayı içe aktaran yalnızca testlerdir (`ui/src/pages/AgentDetail.log-visibility.test.tsx:7`, `ui/src/pages/apps/chat/chat-ui-contract.test.ts:18`). `App.tsx` iki kabuk için de `./pages/AgentDetail` dosyasını kullanır. Grafikli eski sekmeli tasarımı gösterdiği için bu dosyayı bölüm 3.10'da anlatıyorum.
- Ayar sayfası bu bayrak için şunu söyler: "Turning this off restores the legacy shell and navigation. Task and page data are unchanged." (kapatılırsa eski kabuk ve gezinme geri gelir, görev ve sayfa verileri değişmez; `ui/src/pages/InstanceExperimentalSettings.tsx:491-501`).

Yeniden kurarken bunun pratik sonucu: son eki olmayan dosyalar ürünün kendisi sayılmalıdır. Eski dosyalar yalnızca aynı veri için ikinci bir başvuru kaynağı olarak işe yarar.

### 1.3 Özellik bayrakları ve operatörün gizlediği ayarlar

Birbirinden bağımsız iki kapı mekanizması vardır.

1. Deneysel bayraklar: `instanceSettingsApi.getExperimental()` ile okunur, deneysel özellikler (Experimental) ayar sayfasından açılıp kapatılır. Varsayılan değerleriyle tam liste bölüm 11.6'dadır.
2. Operatörün gizlediği ayarlar: sağlık denetimi (health) uç noktasından okunur (`ui/src/hooks/useHiddenSettings.ts`). Ayar yolları `HiddenSettingsPageGate pageKey="..."` ile sarılıdır; anahtarlar `company.members`, `company.invites`, `company.export`, `company.import`, `company.secrets`, `instance.profile`, `instance.environments`, `instance.access`, `instance.experimental`, `instance.plugins`, `instance.adapters` gibidir (`ui/src/App.tsx:163-258`). Ayarlar kenar çubuğu aynı satırları gizler (`ui/src/components/CompanySettingsSidebar.tsx:46-48`, `:106-200`); deneysel özellik kartları da kendi anahtarları gizliyse tek tek gizlenir (`ui/src/pages/InstanceExperimentalSettings.tsx:93-95`).

Paperclip Cloud'da bazı bayraklar "managed" (yönetilen) durumundadır: kartta kilit simgeli "Managed by Paperclip Cloud" rozeti görünür ve aç/kapa düğmesi devre dışıdır (`ui/src/pages/InstanceExperimentalSettings.tsx:62-69`, `:107-115`).

### 1.4 Liste ve ayrıntı sayfalarının ortak yapı taşları

| Bileşen | Ne olduğu | Temel sınıflar | Kaynak |
|---|---|---|---|
| `EntityRow` | Ajanlar, projeler ve başka kayıtlar için kullanılan tek liste satırı. Yuvaları: `leading`, `identifier`, `title`, `subtitle`, `meta`, `trailing`, `secondaryRow`. | dış öğe `px-4 py-2 text-sm border-b border-border last:border-b-0 transition-colors`, satır tıklanabilirse `cursor-pointer hover:bg-accent/50` eklenir | `ui/src/components/EntityRow.tsx:43-68` |
| `EmptyState` | Ortalanmış simge kutusu, mesaj, isteğe bağlı başlık, açıklama ve eylem düğmesi. | `flex flex-col items-center justify-center py-16 text-center`, simge kutusu `bg-muted/50 p-4 mb-4` | `ui/src/components/EmptyState.tsx:18-29` |
| `PageTabBar` | Geniş ekranda çizgi biçimli sekmeler, telefonda tarayıcının kendi `<select>` öğesi. | `TabsList variant="line"` | `ui/src/components/PageTabBar.tsx:18-42` |
| `StatusBadge` | Herhangi bir durum metni için genel amaçlı etiket. | `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium` ve `statusBadge` eşlemesinden gelen bir sınıf | `ui/src/components/StatusBadge.tsx:30`, `ui/src/lib/status-colors.ts:69` |
| `AgentStatusBadge` | Ajan durum etiketi. `active` değerini "idle" olarak gösterir. | `status-chip inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium leading-none whitespace-nowrap shrink-0` | `ui/src/components/StatusBadge.tsx:48-53` |
| `AgentStatusCapsule` | Küçük, dikey "heartbeat capsule" (nabız kapsülü). Ajan çalışırken nabız gibi atar, hata durumunda yanıp söner. | `status-fill inline-block h-4 w-2 rounded-(--rad-4) shrink-0` | `ui/src/components/StatusBadge.tsx:66-72` |
| `AgentAvatar` | Sunucuda üretilen PNG karakter çizimi; çizim yoksa baş harfler gösterilir. | 16 ile 512 arası boyutlar | `ui/src/components/AgentAvatar.tsx`, `packages/shared/src/agent-appearance.ts:6` |

Durum renk sistemi, birebir kopyalanmaya en çok değen parçadır. Her durumun CSS değişkeni olarak tek bir temel rengi vardır; iki yardımcı sınıf dolgu, yazı ve kenarlık rengini iki tema için de bu renkten türetir:

```css
/* ui/src/index.css:2411-2423 */
.status-chip {
  background-color: color-mix(in srgb, var(--sc) 15%, white);
  color: color-mix(in srgb, var(--sc) 82%, black);
  border-color: var(--sc);
}
.dark .status-chip {
  background-color: color-mix(in srgb, var(--sc) 22%, transparent);
  color: color-mix(in srgb, var(--sc) 80%, white);
  border-color: color-mix(in srgb, var(--sc) 48%, transparent);
}
.status-fill { background-color: var(--sc); }
```

Ajan renkleri: `--status-agent-idle #a8aeb2`, `--status-agent-running #2563eb`, `--status-agent-paused #f59e0b`, `--status-agent-error #dc2626` (`ui/src/index.css:201-204`). Hareket: çalışırken `hb-pulse` (1,6 saniye, ease-in-out, opaklık ve ölçek), hata durumunda `hb-blink` (1,2 saniye, step-end, kırmızı ile sayfa zemini arasında gidip gelir); `prefers-reduced-motion` açıkken ikisi de kapanır (`ui/src/index.css:1513-1535`, eşleme `ui/src/lib/status-colors.ts:171-174` içinde). Ortak "live" etiketinin sınıfları `bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400` biçimindedir (`ui/src/lib/status-colors.ts:190`). Mavi her yerde "şu anda çalışıyor" demektir.

Ajan görünümü: 17 palet kimliği, karakter sürümü `cap-v1`; avatar `/api/agent-avatars/${characterVersion}/${muted ? "muted-dream" : paletteId}/${pose}.png?size=&scale=` adresinden sunulur (`packages/shared/src/agent-appearance.ts:12-39`). Poz duruma göre seçilir: çalışan ajanda çalışma pozu (working), hatada şaşkın poz (confused), duraklatılmış, sonlandırılmış ya da onay bekleyen ajanda dinlenme pozu (rest), diğer durumlarda boşta pozu (idle) (`packages/shared/src/agent-appearance.ts:41`). Her ajanın ayrıca daha eski bir lucide simgesi vardır; `AgentIconPicker` içinde 41 ad arasından seçilir (`packages/shared/src/constants.ts:94-136`).

Kaynaklarda kullanıcıya özel "üyelik": her kullanıcı bir projeye ya da ajana katılabilir (Join), ondan ayrılabilir (Leave) ve onu yıldızlayabilir. Bu bir erişim denetimi değildir, kişinin kendi listesini düzenli tutmasına yarar. Uç noktalar: `GET /companies/:id/resource-memberships/me`, `PUT .../me/projects/:id`, `PUT .../me/agents/:id`; gönderilen içerik `{state?: "joined"|"left", starred?: boolean}` (`ui/src/api/resourceMemberships.ts:10-17`).

### 1.5 Canlı güncelleme

Seçili şirket başına tek bir WebSocket vardır: `/api/companies/:companyId/events/ws` (`ui/src/pages/AgentDetail.tsx:4292` satırındaki çalışma kaydı görüntüleyicisi bunu doğrudan kullanır; genel sağlayıcı `ui/src/context/LiveUpdatesProvider.tsx` de aynı soketi kullanır). Sağlayıcı bileşenlere veri göndermez. Olayları TanStack Query sorgularını geçersiz kılma çağrılarına çevirir, hız için birkaç önbelleği de doğrudan günceller.

| Olay | İstemcideki etkisi | Kaynak |
|---|---|---|
| `heartbeat.run.queued`, `heartbeat.run.status` | şirketin süren çalışmalar önbelleğini günceller; çalışmalar, ajan listesi, Genel bakış, maliyetler, kenar çubuğu rozetleri, ajan ayrıntısı ve çalışma ayrıntısı sorgularını geçersiz kılar; durum olayında bildirim gösterir | `ui/src/context/LiveUpdatesProvider.tsx:1688-1712`, `:1215-1234` |
| `heartbeat.run.progress` | ekrandaki görevin ilerleme sorgularını geçersiz kılar | `ui/src/context/LiveUpdatesProvider.tsx:1714-1718` |
| `heartbeat.run.log`, `heartbeat.run.event` | genel sağlayıcı bunları yok sayar; açık olan çalışma görüntüleyicisi kendisi işler | `ui/src/context/LiveUpdatesProvider.tsx:1684-1686`, `:1720-1722` |
| `agent.status` | ajan listesi, Genel bakış, organizasyon ağacı ve ajan ayrıntısı sorgularını geçersiz kılar; bildirim gösterir | `ui/src/context/LiveUpdatesProvider.tsx:1724-1756` |
| `entityType` değeri agent olan `activity.logged` | ajan listesi, organizasyon, ajan ayrıntısı, çalışmalar | `ui/src/context/LiveUpdatesProvider.tsx:1436-1450` |
| ... `approval` | onay listesi | `:1479-1484` |
| ... `join_request` | katılma istekleri | `:1486-1491` |
| ... `cost_event` | maliyetler, sağlayıcıya göre kullanım, zaman penceresi harcaması (kota pencereleri bilerek dışarıda bırakılmıştır) | `:1493-1504` |
| ... `routine`, `routine_trigger`, `routine_run` | `["routines"]` altındaki her şey | `:1506-1531` |
| ... `goal`, `project`, `company_skill`, `company` | bunların liste ve ayrıntı anahtarları | `:1452-1477`, `:1589-1591` |

Soketin yetmediği yerde sayfalar yoklama yapar: ajanlar sayfası süren çalışmaları 15 saniyede bir, yalnızca lider sekmede çalışan bir yoklayıcıyla yeniler (`ui/src/pages/Agents.tsx:269-284`); kenar çubuğu rozetleri 15 saniyede bir (`ui/src/components/CompanySettingsSidebar.tsx:73`), bütçeler ve maliyet tabloları 30 saniyede bir, sağlayıcı kota pencereleri 5 dakikada bir (`ui/src/pages/Costs.tsx:220`, `:318-358`), "Ask first" inceleme kuyruğu 20 saniyede bir (`ui/src/pages/apps/ReviewQueueCard.tsx:44`), Denetim ekranındaki çalışmalar 15 saniyede bir (`ui/src/pages/audit/AuditRuns.tsx:144`), rutin ayrıntısı ise bir çalışma sürerken 3 saniyede bir yenilenir (`ui/src/pages/RoutineDetail.tsx:187-194`).

---

## 2. Ajan listesi ve organizasyon şeması

### 2.1 Ajan listesi (`ui/src/pages/Agents.tsx`, 839 satır)

Yerleşim, yukarıdan aşağıya:

1. Araç çubuğu (`:486-526`): durum sekmelerini taşıyan `PageTabBar`; ardından `rounded-md border border-border` sınıflı bir grupta iki düğmeli görünüm seçici (liste / şema), düğmeleri `List` ve `Network` simgeli `Button size="icon-sm"` bileşenleridir; en sonda çerçeveli "New Agent" düğmesi.
2. Toplam sayıyı gösteren bir satır.
3. Liste (`EntityRow` satırlarından oluşan kenarlıklı bir kart) ya da organizasyon şeması.

Sekmeler ve filtreler:

- `AGENT_FILTER_TABS = ["all", "active", "paused", "error", "builtin"]` (`:52`). Her sekmenin kendi adresi vardır (`agents/all`, ...).
- Durumu `terminated` ya da `pending_approval` olan ajanlar hiçbir zaman listelenmez: `HIDDEN_AGENT_STATUSES` (`:88`, `:101` satırında uygulanır).
- "active" sekmesi, durumu `active`, `running` ya da `idle` olan ajanları kapsar (`matchesFilter`, `:90-96`).
- `builtin` sekmesi yalnızca `instanceSettings.experimental.enableBuiltInAgents === true` olduğunda vardır (`:220`).
- Şema görünümünde gizli bir düğüme bağlı ajanlar bir üst düğüme taşınır; böylece ağaç alt ağaçlarını kaybetmez (`filterOrgTree`, `:173-192`).

Görünüm durumu: sade kabukta varsayılan listedir; eski sürümde varsayılan "org" görünümüdür; telefonda her zaman liste gösterilir (`:207-213`).

Satır içeriği (`:353-477`), her ajan için bir `EntityRow`:

| Yuva | İçerik |
|---|---|
| leading | `AgentAvatar size={32}`; `agent.orgChainHealth.status === "invalid_org_chain"` olduğunda yerini sarı bir `AlertTriangle` alır |
| title | ajanın adı, sınıfı `flex-1 @5xl:flex-none @5xl:w-56` (kapsayıcı sorgusuna bağlı kırılma noktası) |
| subtitle | `${roleLabel}${title ? " - " + title : ""}` |
| meta (`AgentMetaColumns`) | `w-44 font-mono text-xs` sınıflarıyla model ve adaptör etiketi, isteğe bağlı ortam sütunu (`enableEnvironments` bayrağı), `w-24` genişliğinde son çalışma zamanı |
| trailing | Sohbet düğmesi (yalnızca `enableAgentChat` açıkken), `LiveRunIndicator`, `w-20` genişliğinde bir hücrede `AgentStatusBadge`, `StarToggle`, `MembershipAction` (Join/Leave) |
| satır sınıfı | `group py-3`; ajan duraklatılmışsa ve sekme "paused" değilse ayrıca `opacity-50` |

`LiveRunIndicator` (`:815-839`) bağlantı işlevi gören bir etikettir: `bg-blue-500/10` zemini, yanıp sönen bir nokta ve "Live" ya da "Live (n)" metni. Yerleşik ajanlara bir yaşam döngüsü etiketi ("Needs setup" / "Pending approval", `ui/src/components/BuiltInAgentBadges.tsx:20-37`) ve "Set up" düğmesi eklenir.

Boş ekran metinleri: "Create your first agent to get started." (`:537`), "No agents match the selected status." (`:552`, `:563`), "No organizational hierarchy defined." (`:569`).

Veri ve uç noktalar:

| Veri | Uç nokta | Not |
|---|---|---|
| ajanlar | `GET /api/companies/:companyId/agents` | Bilinmeyen sorgu parametrelerini reddeder; kısıtlı aktörler için yapılandırmayı gizler (`server/src/routes/agents.ts:4049-4066`) |
| organizasyon ağacı | `GET /api/companies/:companyId/org` | Yalın düğümler `{id, name, role, status, reports}`; yalnızca şema görünümü açıkken çekilir (`server/src/routes/agents.ts:4132`) |
| süren çalışmalar | `heartbeatsApi.liveRunsForCompany`, `useSharedPollingQuery({resourceKey: "live-runs:agents-page", refetchInterval: 15_000, leaderOnly: true})` üzerinden | `ui/src/pages/Agents.tsx:269-284` |
| yerleşik ajanlar | `GET /api/companies/:companyId/built-in-agents` | `enableBuiltInAgents` bayrağı |
| üyelikler | `GET /api/companies/:companyId/resource-memberships/me` | katılma, ayrılma, yıldızlama |

Eski sürümdeki farklar (`ui/src/pages/Agents.production.tsx`, diff ile karşılaştırıldı): sohbet düğmesi yoktur, varsayılan görünüm "org" görünümüdür, `@5xl:` kapsayıcı sorguları yerine `xl:` kırılma noktaları kullanılır, şema görünümü grafik şema yerine girintili bir listedir (`OrgTreeNode`), metinlerde "organization" yerine "company" yazar, görünüm seçici de `GitBranch` simgeli ham düğmelerden oluşur. `OrgTreeNode` (`ui/src/pages/Agents.tsx:588-765`) her derinlik için 24px girinti verir ve alt düğümleri `border-l border-border ml-4` içinde çizer.

`ui/src/pages/Org.tsx` (127 satır) üçüncü ve daha basit, açılıp kapanabilen bir ağaçtır. Onu kullanan bir yol ya da içe aktarma bulamadım.

### 2.2 Organizasyon şeması (`ui/src/pages/OrgChart.tsx`, 673 satır)

Teknik: kartlar DOM öğesidir, bağlantı çizgileri için tek bir SVG vardır; ikisi de aynı kaydırma ve yakınlaştırma dönüşümüyle hareket eder. Canvas ya da grafik kütüphanesi kullanılmamıştır.

Sabitler (`:20-28`): `CARD_W = 200`, `CARD_H = 100`, `GAP_X = 32`, `GAP_Y = 80`, `PADDING = 60`, `MIN_ZOOM = 0.2`, `MAX_ZOOM = 2`, `FIT_PADDING = 40`, `TOUCH_MOVE_THRESHOLD = 6`.

Yerleşim, yukarıdan aşağıya kurulan yalın bir düzenli ağaçtır (tidy tree). Bir alt ağacın genişliği, alt düğümlerinin ve aralarındaki boşlukların toplamı kadardır (hiçbir zaman bir karttan dar olmaz); her üst düğüm kendi alt ağacının üzerinde ortalanır:

```ts
// ui/src/pages/OrgChart.tsx:60-93 (abridged)
function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}
function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  // children start at x + (totalW - childrenW - gaps) / 2, each at y + CARD_H + GAP_Y
  return { ..., x: x + (totalW - CARD_W) / 2, y, children: layoutChildren };
}
```

Birden çok kök varsa `PADDING` değerinden başlanarak yan yana dizilir (`layoutForest`, `:96-113`). Başlangıçtaki yakınlaştırma ve kaydırma değerlerini `fitChartToViewport` hesaplar (`:143-163`).

Etkileşim:

- Fareyle sürüklemek şemayı kaydırır; ama fare düğmesine bir kartın üzerinde basıldıysa kaydırmaz (`target.closest("[data-org-card]")`, `:307`).
- Tekerlek, imlecin olduğu yere doğru 1,1 ya da 0,9 katsayısıyla yakınlaştırır (`:323-342`, `:518` satırında bağlanır).
- Dokunmatik ekran: tek parmak kaydırır, iki parmak yakınlaştırır; sürüklemeden sonra 400 ms boyunca tıklama yok sayılır (`:367-465`).
- `absolute top-3 right-3` konumundaki düğmeler: artı (katsayı 1,2), eksi (katsayı 0,8), sığdır (`:525-566`).

Çizim:

- Görüntü alanı: `w-full flex-1 min-h-0 overflow-hidden relative bg-muted/20 border border-border rounded-lg`, `touchAction: "none"` ile (`:505-523`).
- Çizgiler: mutlak konumlu tek bir `<svg>`, içinde `<g transform="translate(pan) scale(zoom)">`. Her çizgi dirsekli bir yoldur: `M x1 y1 L x1 midY L x2 midY L x2 y2`, `stroke="var(--border)" strokeWidth={1.5}` ile (`:569-595`).
- Kartlar: shadcn `Card` öğeleri; `transform: translate(...) scale(...)` ve `transformOrigin: "0 0"` verilmiş bir katmanın içinde mutlak konumludur (`:598-663`). Kart sınıfı `block absolute py-0 hover:shadow-md hover:border-foreground/20 ... cursor-pointer select-none` diye başlar; karta tıklamak ajanı açar.
- Kart içeriği: `w-9 h-9 rounded-full bg-muted` sınıflı bir tutucu, içinde `AgentAvatar size={16}` ve durum noktası (`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card`); `text-sm font-semibold` ile ad, ardından unvan ya da rol etiketi, eş aralıklı yazıyla adaptör etiketi ve iki satırla sınırlanmış yetenekler.
- Buradaki durum noktası renkleri etiketlerinkinden ayrı bir palettir: running `#22d3ee`, active `#4ade80`, paused ve idle `#facc15`, error `#f87171`, terminated `#a3a3a3` (`:187-195`; değişkenlerle ilgili yorum `ui/src/index.css:2445` satırında).

Bileşen parametreleri (props) `{orgTree?, agents?, embedded?}` (`:199-206`). Gömülü değilken verisini kendisi çeker ve "Import organization" / "Export organization" düğmelerini gösterir (`:485-504`; bulutta ya da gizli ayarlarla gizlenir). Yüklenirken `PageSkeleton variant="org-chart"` kullanılır (`:472`).

### 2.3 Sunucuda üretilen organizasyon şeması görseli (`server/src/routes/org-chart-svg.ts`, 777 satır)

DOM kullanmayan, çıktıyı yalnızca metin olarak üreten bir çizicidir. Uç noktalar: `GET /api/companies/:companyId/org.svg?style=` ve `/org.png?style=`; varsayılan stil "warmth", `Cache-Control: no-cache` (`server/src/routes/agents.ts:4132-4162`).

- Beş stil: `monochrome`, `nebula`, `circuit`, `warmth`, `schematic` (`:17-19`, tema tanımları `:161-316`).
- Rol simgeleri koda gömülü Twemoji çizim yollarıdır; hangisinin kullanılacağını `guessRoleTag` seçer (`:60-157`).
- Yerleşim sabitleri istemcideki şemadan farklıdır: `CARD_H = 96`, `CARD_MIN_W = 150`, `GAP_X = 24`, `GAP_Y = 56`, `PADDING = 48` (`:320-332`). Kart genişliği metin uzunluğundan `text.length * fontSize * 0.58` formülüyle tahmin edilir (`:337-339`).
- Büyük organizasyonlar daraltılır: düğüm sayısı `COLLAPSE_THRESHOLD = 20` değerini aşınca bir düzeyin genişliği `MAX_LEVEL_WIDTH = 8` ile sınırlanır, en çok `MAX_CHILDREN_SHOWN = 6` alt düğüm gösterilir ve kalanların yerine "+N more" kartı konur (`:588-701`).
- Çıktı her zaman 1280x640 boyutundadır; şema küçültülüp ortalanır, üzerine logo filigranı ve isteğe bağlı olarak şirket adı ile istatistik satırı eklenir (`:569-570`, `:703-762`).
- PNG, `sharp` ile 144 yoğunlukta üretilir (`:768-777`).

---

## 3. Ajan ayrıntı sayfası (`ui/src/pages/AgentDetail.tsx`, 4801 satır)

### 3.1 Gezinme modeli

Sade kabuktaki ajan ayrıntı sayfasında sekme çubuğu yoktur. Alt görünümler adresin birer parçasıdır ve gezinme ikinci kenar çubuğundan yapılır (`AgentContextualSidebar`; onu `ui/src/components/Layout.tsx:211-212` bağlar).

| Grup | Satırlar (adres parçası) | Kaynak |
|---|---|---|
| Ajan | Genel bakış (`overview`), Talimatlar (`instructions`), Skill'ler (`skills`) | `ui/src/pages/agent-detail-navigation.ts:23-27` |
| Çalışma ortamı | Çalışma ortamı (Harness / Runtime, `runtime`), Gizli anahtarlar (`secrets`), Araçlar (`tools`), Kanallar (`channels`) | `ui/src/pages/agent-detail-navigation.ts:31-36` |
| Yönetişim | İzinler / Güven (`permissions`), API anahtarları (`api-keys`), Sürümler (`revisions`) | `ui/src/pages/agent-detail-navigation.ts:40-44` |
| Denetim (yalnızca kenar çubuğunda) | Etkinlik, Çalışmalar, Maliyetler, Bütçeler; her biri bu ajana göre filtrelenmiş Denetim ekranına gider | `ui/src/components/AgentContextualSidebar.tsx` |

Eski adres adları yenilerine eşlenir (`prompts` yerine instructions, `configure` ve `configuration` yerine runtime, `trust` yerine permissions, `keys` yerine api-keys, `history` yerine revisions); eski runs, audit, costs ve budget sekmeleri de Denetim ekranına yönlendirilir (`ui/src/pages/agent-detail-navigation.ts`). Çalışma ayrıntısı `/agents/:ref/runs/:runId` adresinde kalır.

Kenar çubuğunun biçimi: nav öğesi `flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-auto-hide px-3 py-2`; gruplar `mt-4 border-t border-border pt-3` ile ayrılır; grup etiketi `px-2 pb-1 text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground` (`ui/src/components/AgentContextualSidebar.tsx`).

### 3.2 Sayfa çerçevesi, şeritler ve başlık

Kök kapsayıcı: `agent-settings-content mx-auto max-w-5xl space-y-8` (`:1176`).

Başlığın üstündeki şeritler, sırasıyla:

1. "You left this agent. It no longer appears in your sidebar." şeridi, yeniden katılma eylemiyle birlikte (`:1177-1210`).
2. "Escalation path is paused" (üst kademeye iletme yolu duraklatılmış) (`:1211-1219`).
3. "Invalid reporting chain" (geçersiz bağlılık zinciri); zincirin yolunu ve onarım önerisini de içerir (`:1220-1240`).

Başlık (`:1242-1314`): `AgentCharacter size={96}` (hareketli karakter), `truncate text-2xl font-semibold tracking-tight` sınıflı `h1`, adaptörün marka simgesini, adaptör etiketini ve unvanı ya da rolü taşıyan bir satır, bir yıldız düğmesi, ardından `AgentActionButtons`. Telefonda, süren bir çalışma varken "Live" etiketi görünür.

Başlığın altında:

- Yerleşik ajanlar: sayfa içi bir şerit, `BuiltInBundlePanel` ve kurulum penceresi (`:1316-1362`).
- Onay bekleyen işe alma: "This agent is pending board approval and cannot be invoked yet." (ajan yönetim kurulu onayı bekliyor, henüz çalıştırılamaz) metni ve "Approve agent" düğmesi (`:1366-1379`).
- `h2.text-xl font-semibold` biçiminde görünüm başlığı (`:1381`), ardından etkin görünüm (`:1384-1492`).
- Çalışma ortamı, talimatlar ve gizli anahtarlar görünümlerinde alta yapışık bir kaydetme çubuğu: "You have unsaved changes." metni, Vazgeç (Discard) ve "Save changes" düğmeleri (`:1494-1500`).

Kaydedilmemiş değişiklik koruması kapsamlıdır: `useBeforeUnload`, bağlantılardaki tıklamaları yakalama aşamasında tutan bir işleyici ve geçmiş kaydını geri yükleyen, yine yakalama aşamasında çalışan bir `popstate` işleyicisi (`:1075-1149`).

### 3.3 Başlıktaki eylemler (`ui/src/components/AgentActionButtons.tsx`, 524 satır)

| Öğe | Davranış | Uç nokta |
|---|---|---|
| "Run now" (`:55`, `:163`) | bir çalışma başlatır ve `/agents/:ref/runs/:runId` adresine gider | `POST /agents/:id/heartbeat/invoke` |
| Duraklat / Sürdür | yerleşik ajanlarda "Pause anyway" düğmeli bir onay penceresi çıkar (`:454`) | `POST /agents/:id/pause`, `/resume` |
| "Clear error" (`:117-120`) | durum `error` olduğunda Duraklat düğmesinin yerine gösterilen, yıkıcı eylem renginde çerçeveli düğme | `POST /agents/:id/clear-error` |
| "Assign Task" (`:162`) | bu ajan önceden seçilmiş olarak yeni görev penceresini açar | yalnızca istemcide |
| "Run with provider trace" (`:424`) | yalnızca yöneticiye açıktır, "Raw tracing on" etiketiyle gösterilir | izleme açıkken invoke çağrısı |
| Ek işlemler menüsü (`w-44 p-1`): "Duplicate Agent" (`:483`), "Copy Agent ID" (`:495`), "Reset Sessions" (`:505`), "Terminate" (`:517`) | Çoğaltma, talimat paketini yükler ve oluşturma uç noktasını çağırır; sunucu 409 "requires board approval" yanıtını verirse işe alma uç noktasına geçer (`:326`) | `POST /companies/:id/agents`, `/agent-hires`, `/agents/:id/terminate` |

Bağlılık zinciri geçersizken iş eylemleri devre dışıdır; Sonlandır (Terminate) eylemi de yerleşik ajanlarda gizlenir (`hideTerminate`, `:202-203`).

### 3.4 Genel bakış görünümü

`LatestRunCard` (`:1553-1694`): başlığı "Live Run" ya da "Latest Run" olur; yanında yanıp sönen mavi bir nokta ve kısa çalışma kimliği durur. Çalışma sürerken kartın kenarlığı `border-blue-500/30` olur. İçinde: durum simgesi, `StatusBadge`, kimliği ve başlığıyla birlikte görev simgesi (ya da çalışmayı başlatan kaynağın rozeti) ve üç satır ile 280 karakterle sınırlı bir özet alıntısı.

`AgentOverview` (`:1698-1840`), iki sütunlu bir kart ızgarası:

| Kart | Alanlar |
|---|---|
| Kimlik | Rol, Unvan, Bağlı olduğu ajan (bağlantı; yoksa "Board"), Doğrudan bağlı ajanlar |
| Çalışma ortamı (Harness / Runtime) | Adaptör, Model, Oturum, Son çalışma; "Configure" bağlantısı |
| Yetenekler | markdown |
| Skill'ler | en çok 8 rozet, sonra "+N more"; "Manage" bağlantısı |

Ardından "Recent Tasks" (6 satır, `/issues?participantAgentId=` adresine bir bağlantı) ve Denetim bağlantılarından oluşan bir ızgara (etkinlik, çalışmalar, maliyetler, bütçeler) gelir. Kullanımdaki sade sayfada grafik yoktur.

### 3.5 Talimatlar görünümü (`PromptsTab`, `:2169-3160`)

Bir ajanın talimatları tek bir metin alanı değil, küçük bir dosya paketidir.

- Açılıp kapanan "Advanced" bölümünde paket ayarları: mod (Managed ya da External), kök yol (Root path), giriş dosyası (Entry file, varsayılan `AGENTS.md`).
- Boyutu ayarlanabilen iki bölmeli bir yerleşim: dosya panelinde (varsayılan 260px, 180 ile 500 arasında sürüklenerek ayarlanır) bir `FileTree`, "+" ile açılan yeni dosya girişi (yer tutucu `TOOLS.md`) ve dosya rozetleri bulunur: "entry", boyut, "virtual file".
- Düzenleyici başlığı: dosya adı, dil, üç parçalı Oku / Düzenle / Ham (Read / Edit / Raw) seçici, kopyalama, Sil. Markdown dosyaları görsel yükleyebilen `MarkdownEditor` ile, diğer dosyalar düz bir metin alanıyla düzenlenir.
- `InstructionHistory`: Geçmiş (History) aç/kapa düğmesi, sayfalanmış sürümler, "Removed" ve "Added" başlıklı bir fark görünümü ve "Restore as new revision" eylemi.
- "Preserved instruction edits" (diskte bulunan adaylar) için bir inceleme süreci.
- Yerel taslak yokken 5 saniyede bir yeniden çekilir.
- Yerel olmayan adaptörlerde "Instructions bundles are only available for local adapters." metni gösterilir.

Kaydetme, iyimser eş zamanlılık denetimi kullanır (`baseRevisionId` / `baseHash`). Uç noktalar `/agents/:id/instructions-bundle` altındadır (file, history, diff, restore, candidates; yol listesi `server/src/routes/agents.ts` içinde).

### 3.6 Skill'ler görünümü (`ui/src/pages/agent-skills/AgentSkillsTab.tsx`, 630 satır)

- Başlık: "N of M enabled", skill'lerin nasıl uygulandığını söyleyen bir etiket (çalışma alanında tutulur / sonraki çalışmada uygulanır / yalnızca izlenir), kaydetme durumu etiketi (kaydediliyor, kaydedilemedi, "Saving soon...", kaydedildi; `:576`), bir arama kutusu ve "Browse skills store" bağlantısı (`:436`, `:625`).
- Bölümler: "Enabled on this agent" (`:486`), "Available from the library" (`:496`) ve açılıp kapanan "Automatic and detected skills (read-only)" (`:521`).
- Otomatik kayıt: bir skill açılıp kapatılınca 250 ms beklenir (`:203`), sonra `agentsApi.syncSkills(agent.id, desiredSkills, "replace", companyId)` çağrılır (`:114-115`); bu çağrı `POST /agents/:id/skills/sync {desiredSkills, mode: "replace"}` isteğidir.
- Eskimiş skill satırlarında bir uyarı ve Kaldır eylemi görünür. Sürüme sabitleme yalnızca `enableBetaSkills` açıkken çıkar (`:94`).
- Kitaplık boşsa: kesikli kenarlıklı bir kart.

### 3.7 Çalışma ortamı, gizli anahtarlar, araçlar, kanallar

Çalışma ortamı görünümü (`ConfigurationTab`, `:1935-2165`) `AgentConfigForm mode="edit" sectionLayout="cards"` bileşenini çizer; bölüm sırası `["identity", "adapter", "configuration", "environment", "environment-variables", "run-policy"]` biçimindedir. Formun kendisi bölüm 4.3'te anlatılıyor.

Gizli anahtarlar görünümü: aynı formun gizli anahtarlar içeriğidir; ortam değişkenleri düzenleyicisi ile "Secret access" bölümünden oluşur (`ui/src/components/AgentConfigForm.tsx:1396-1410`). Yardım metni modeli şöyle açıklar: "Env-var bindings are injected at run start; API-access bindings are fetched on demand via the run-bound agent API and never written to the environment." (ortam değişkeni bağlamaları çalışma başlarken verilir; API erişimi bağlamaları çalışmaya bağlı ajan API'sinden istendikçe alınır ve ortama hiç yazılmaz; `ui/src/components/agent-config-primitives.tsx`, `help.secretAccess`).

Araçlar görünümü (`ui/src/pages/AgentToolsTab.tsx`, 785 satır):

- "Effective access" şeridi: istemin araç listesini daraltabileceğini ama genişletemeyeceğini ("cannot expand it") söyler (`:566-572`).
- GitHub kimliği bölümü (ajana ayrılmış hesap ya da adına çalışılan kişinin hesabı).
- "Installed apps" (`:203-205`): otomatik kaydedilen onay kutuları. Metne göre kurulu uygulamalar her çalışmada araçlarını ajanın bağlamına yükler; yalnızca izin verilmiş uygulamalar bağlam maliyeti eklemez. Her uygulamanın rozeti: "Installed for all", "Installed", "Permitted only", "Not permitted" (`:288`).
- "Allowed tools" tablosu (`:609-613`); sütunları Araç, Yetenek, Risk, Kaynak.
- "Why these tools?" yan paneli (`:662-667`): erişim profilleri, `#order name` biçiminde ve etki etiketiyle gösterilen etkin kurallar, en çok 30 tane "Unavailable tools" etiketi (`:745-748`).

Kanallar görünümü (`:1453`) `AgentChannelsPanel` bileşenini çizer. Menü satırı her zaman listelenir (`ui/src/components/AgentContextualSidebar.tsx:85-108`); `enableChatConnectors` bayrağını panelin kendisi okur (`ui/src/components/chat/AgentChannelsPanel.tsx:27`).

### 3.8 Yönetişim görünümleri

İzinler / Güven (`ConfigurationTab` içinde):

- `TrustPresetSection` (`ui/src/components/TrustPresetSection.tsx`): hazır güven ayarı seçimi (`standard` / `low_trust_review`) ve ajanın sınırlandığı kapsamın türü (Proje / Kök görev / Görev).
- Üç aç/kapa düğmeli bir İzinler kartı: "Can create new agents" (`:2106`), "Can create/import skills", "Can assign tasks" (`:2144`). Sonuncusu CEO'larda ve ajan oluşturabilen ajanlarda açık konumda kilitlidir; yanındaki açıklama `taskAssignSource` değerinden üretilir.

API anahtarları (`KeysTab`, `:4627-4801`): adla anahtar oluşturma; göster, gizle ve kopyala düğmeleri olan, yalnızca bir kez gösterilen token şeridi; etkin ve iptal edilmiş anahtarların listeleri. Uç noktalar: `POST/GET/DELETE /agents/:id/keys`.

Sürümler (`AgentRevisionsTab`, `:1867-1931`): yapılandırma sürümlerinin listesi; her satırda `id`, tarih ve kaynak, "Changed: keys" bilgisi ve `POST /agents/:id/config-revisions/:revisionId/rollback` çağrısını yapan "Restore" düğmesi bulunur.

### 3.9 Çalışma gösterimi

Çalışma listesi ve ayrıntısı hâlâ `AgentDetail.tsx` içindedir; Denetim ekranından ya da bir canlı etiketinden açılır.

`RunListItem` (`:3218-3267`): durum simgesi, kısa kimlik, çalışmayı başlatan kaynağın rozeti (timer mavi, assignment mor, on_demand camgöbeği), özet, token sayıları ve maliyet. `RunsTab` (`:3269-3349`) geniş ekranda ayrıntının yanında duran `w-72` genişliğinde bir listedir; telefonda ya liste ya ayrıntı gösterilir.

`RunDetail` (`:3367-3970`):

- Sıradayken 5 saniyede bir, çalışırken 15 saniyede bir yeniden çekilir.
- Durum rozeti ve eylemler: İptal, Sürdür (`process_lost` için), Yeniden dene, "Inspect run", "Re-run with provider trace".
- Adaptör, sağlayıcı ve model satırı; "On behalf of" (kimin adına); canlı geçen süre sayacıyla zaman bilgisi; hata ve hata kodu; çıkış kodu; yeniden deneme durumu.
- Ölçüm ızgarası: Giriş, Çıkış, Önbellek, Maliyet.
- Açılıp kapanan Oturum bölümü ("clear session for these tasks" eylemiyle), "Tasks Touched", stderr ve stdout alıntıları.

`LogViewer` (`:3974-4623`):

- Olayları yükler (`heartbeatsApi.events`), çalışma kaydını da 256 KB'lık sayfalar hâlinde alır (`heartbeatsApi.log(runId, offset, bytes)`).
- Şirket WebSocket'ini açar (`:4292`) ve `heartbeat.run.log`, `heartbeat.run.progress`, `heartbeat.run.event` olaylarını işler; bağlantı koparsa 1,5 saniye sonra yeniden bağlanır, yedek olarak 2 saniyede bir yoklama yapar; sekme gizliyken durur.
- 32px toleransla en altı kendiliğinden izler; okuyan kişi başka bir yere kaydırmışsa "Jump to live" düğmesini gösterir (`:4504`).
- İki döküm modu vardır: "nice" ve "raw". Ayrıca çalışma alanı işlemleri bölümü, bir çağrı kartı (adaptör, cwd, komut, istem, bağlam, gizlenmiş ortam değişkenleri), bir hata bloğu ve olay listesi bulunur.

### 3.10 Kullanılmayan eski ajan ayrıntı sayfası (yalnızca başvuru için)

`ui/src/pages/AgentDetail.production.tsx` önceki tasarımı gösterir: `PageTabBar` sekmeleri Genel bakış (Dashboard), Talimatlar, Skill'ler, Yapılandırma, Gizli anahtarlar, Araçlar, Kanallar, Çalışmalar, Denetim, Bütçe (`:285-296`, `:1404-1415`); yüzen bir kaydetme çubuğu (`:1433-1480`); `grid grid-cols-2 lg:grid-cols-4 gap-4` ızgarasında "Run Activity", "Tasks by Priority", "Tasks by Status" ve "Success Rate" grafiklerini gösteren bir genel bakış, grafiklerin hepsi "Last 14 days" dönemi için (`:1770-1855`); ayrıca çalışma başına maliyet tablosu (`:1859-1933`). Bütçe sekmesi bir `BudgetPolicyCard variant="plain"` bileşenidir ve `budgetsApi.upsertPolicy({scopeType: "agent", scopeId, amount, windowKind: "calendar_month_utc"})` ile kaydeder (`:1036-1052`).

Grafikler `ui/src/components/ActivityCharts.tsx` dosyasından gelir (328 satır); kullanımdaki Genel bakış sayfası da aynı dosyayı kullanır (`ui/src/pages/Dashboard.tsx:33`). Bunlar grafik kütüphanesi olmadan, DOM öğeleriyle elle kurulmuş çubuk grafiklerdir: `flex items-end gap-(--sz-3px) h-20` içinde 14 gün sütunu, boyutu flex ağırlıklarıyla verilen üst üste dilimler, tarayıcının kendi `title` ipuçları, 0, 6 ve 13. günlerde tarih etiketleri, noktalı bir lejant ve `border border-border rounded-lg p-4 space-y-3` sınıflı bir kart çerçevesi (`ui/src/components/ActivityCharts.tsx:72`, `:121`, `:249`, `:296`). Başarı oranı 0,8'den itibaren yeşil, 0,5'ten itibaren sarı, altında kırmızı olur.

---

## 4. Yeni ajan ve işe alma

### 4.1 Adım 1 ve 2: ad ve adaptör (`ui/src/components/new-agent/AgentBasicsDialog.tsx`, 312 satır)

İki adımlı bir penceredir; önce "1. Name", sonra "2. Adapter" gelir:

- Uykulu, soluk bir karakter çizimi; başlık önce "Meet your next agent", sonra "Choose an adapter" olur (`:181-182`).
- Ad alanı, `h-12 text-base`, yer tutucusu "e.g. Darnold" (`:200`) ve "Invite an external agent" bağlantısı (`:212`).
- Adaptör seçimi, `grid grid-cols-2 gap-3` içinde tek seçimli kartlarla yapılır (`sm` kırılma noktasından itibaren üç sütun olur; tam dört seçenek varsa olmaz, `:229`); her kartta marka simgesi, seçiliyken de bir onay işareti bulunur.
- Paperclip Runner sunuluyorsa bir çalıştırıcı seçimi (`enableNativeRunner` bayrağı, `:130`).
- Alt kısım: solda İptal ya da Geri, sağda önce "Choose adapter", sonra "Configure agent" (`:304`).

Listelenen adaptörler `GET /api/adapters` uç noktasından gelir; yalnızca yüklenmiş, etkin, `process`/`http` olmayan ve "coming soon" işaretli olmayanlar gösterilir. Görüntüleme bilgileri (etiket, açıklama, simge, `recommended`, `comingSoon`, `experimental`) `ui/src/adapters/adapter-display-registry.ts:62-155` içindedir; `recommended` işaretli iki adaptör Claude Code ve Codex'tir.

### 4.2 Adım 3: ajan kurulum sayfası (`ui/src/components/new-agent/NewAgentSetup.tsx`, 1203 satır)

Yol: `/agents/new?name=&adapterType=&runnerProvider=[&createdAgentId=]`. Numaralı bir adım menüsü vardır: Bağlan (Connect; yalnızca Claude, Codex ve Grok için), Yapılandır (Configure), Sonuç (Confirmation).

Yapılandırma formunun alanları: yapay zekâ bağlantısı, model açılır menüsü, düşünme düzeyi, API anahtarı sağlayıcısı ve "Or use an organization secret" seçeneğiyle anahtar alanı (`SecretPicker`), adaptöre özgü alanlar (Hermes adresi, Kimi alanları, Cursor Cloud deposu ve dalı), ortam seçimi ve bir ortam testi çalıştıran `RuntimeTestCard`. Birincil düğme "Finish setup" (`:1190`).

"Finish setup" düğmesinin gönderdiği (`finish()`, `:463-566`): yeni anahtarlar önce gizli anahtar olarak saklanır, sonra

```ts
// ui/src/components/new-agent/NewAgentSetup.tsx:503-521 (shape)
agentsApi.hire(companyId, {
  name, appearance,
  role: existing.length ? "general" : "ceo",   // first agent becomes the CEO
  reportsTo: leader?.id,
  adapterType, adapterConfig, defaultEnvironmentId,
  runtimeConfig: { ...buildNewAgentRuntimeConfig({ heartbeatEnabled: false }), aiConnection? },
  budgetMonthlyCents: 0,
  storedSessionId?, applyStoredClaudeLogin?
})
```

İşe alma başarısız olursa az önce hazırlanan gizli anahtarlar geri alınır. Sonuç adımındaki kartta "Your agent is ready" ya da, "An organization administrator must approve this agent before it can work." açıklamasıyla birlikte, "Agent submitted for approval" yazar; iki düğme vardır: "Edit configuration" ve "Assign {name} a Task" (`:772-822`).

Yeni bir ajanın varsayılan çalışma ortamı yapılandırması (`ui/src/lib/new-agent-runtime-config.ts`): `heartbeat: { enabled: false, intervalSec: 300, wakeOnDemand: true, skipTimerWhenNoActionableWork: true, cooldownSec: 10, maxConcurrentRuns: 20 }` (varsayılanlar `ui/src/components/agent-config-defaults.ts` dosyasından ve `packages/shared/src/constants.ts:77` satırındaki `AGENT_DEFAULT_MAX_CONCURRENT_RUNS = 20` sabitinden gelir).

### 4.3 Ajan yapılandırma formu (`ui/src/components/AgentConfigForm.tsx`, 4085 satır)

Oluşturma ve düzenleme için tek bir bileşen kullanılır. Düzenleme modunda her grup için (`identity`, `adapterType`, `adapterConfig`, `heartbeat`, `debug`, `runtime`) kaydedilmemiş değişiklikleri ayrı bir katmanda izler ve yalnızca değişenleri içeren en küçük yamayı kurar (`ui/src/lib/agent-config-patch.ts`). Her bölüm `data-config-section="..."` taşıyan bir bloktur; `sectionLayout="cards"` verildiğinde bölüm, `border border-border rounded-lg p-4 space-y-3` kutusunun üstünde duran bir `h3.text-sm font-medium mb-3` başlığından oluşur (`ui/src/components/AgentConfigForm.tsx:144`, `:327-342`). Aşağıdaki tablodaki satır numaraları `AgentConfigForm.tsx` dosyasına aittir.

| Bölüm | Alanlar | Kaynak |
|---|---|---|
| Kimlik | Ad, Unvan, "Reports to" (`ReportsToPicker`), isteğe bağlı İstem şablonu | `:1450-1509` |
| Ortam | varsayılan yerine kullanılacak ortam seçimi ya da Kubernetes zorunlu tutulduğunda bir bilgi notu | `:1516-1572` |
| Adaptör | adaptör türü açılır menüsü, yapay zekâ bağlantısı, ortam testi düğmesi ve sonucu, giriş paneli, adaptöre özgü alanlar, model açılır menüsü, düşünme düzeyi | `:1575-1807`, `:4056` |
| Yapılandırma | eski başlangıç istemi, adaptör alanları, Gelişmiş: Komut, Ek argümanlar | `:1811-1923` |
| Ortam değişkenleri | anahtar/değer satırları; her biri düz metin ya da gizli anahtar başvurusu | `:1926-1935` |
| Çalışma kuralları (Run Policy) | aşağıya bkz. | `:1939-2098` |
| Hata ayıklama | "Capture raw provider traces" (yönetici) | `:2121` |

Çalışma kuralları bölümü, Paperclip'in "heartbeat policy" (uyandırma kuralları) ayarlarıdır:

- "Heartbeat on interval" aç/kapa düğmesi ve "Run heartbeat every N sec" alanı (varsayılan 300) (`:1946`, `:1971`).
- Gelişmiş: "Timeout (sec)" (`:1996`), "Interrupt grace period (sec)" (`:2010`), "Wake on demand" (varsayılan açık, `:2027`), "Cooldown (sec)" (`:2036`), "Max concurrent runs" (`:2048`), deneme sayısı (varsayılan 2, üst sınır 10) ve gecikme alanlarıyla birlikte "Continue after max-turn stop" (`:2062`).
- Yardım metinleri `ui/src/components/agent-config-primitives.tsx:28-65` içindedir; örneğin `wakeOnDemand: "Allow this agent to be woken by assignments, API calls, UI actions, or automated systems."`.

Bağlılık ilişkisi: `ReportsToPicker` (`ui/src/components/ReportsToPicker.tsx`, 126 satır) `w-48 p-1` sınıflı bir açılır menüdür; "No manager" seçeneğini ve avatarı, adı ve rol etiketiyle her ajanı listeler. Yöneticinin sonlandırılmış ya da bilinmeyen olduğu durumları da ele alır.

Adaptöre özgü alanlar: her adaptör modülü `ConfigFields` ve `buildAdapterConfig` dışa aktarır (`ui/src/adapters/types.ts:54-58`); modüle hangi ortak bölümü çizdiği bildirilir (`section?: "adapter" | "configuration" | "advanced" | "runPolicy" | "environment"`, `ui/src/adapters/types.ts:19-23`). Örnekler: Claude Code adaptöründe "Agent instructions file", yürütme motoru (Default ACP / Claude CLI / ACP), "Enable Chrome", "Skip permissions" ve varsayılanı 1000 olan "Max turns per run" bulunur (`ui/src/adapters/claude-local/config-fields.tsx:35`, `:99-113`, `:231-283`); HTTP adaptöründe tek bir "Webhook URL" alanı vardır (`ui/src/adapters/http/config-fields.tsx:22`). Bu alanlar komut satırı kodlama ajanlarına ve webhook'lara özgüdür.

Bütçe alanı: ajan tipinde `budgetMonthlyCents` ve `spentMonthlyCents` alanları vardır (`packages/shared/src/types/agent.ts`); yardım metni "Monthly spending limit in cents. 0 means no limit." (`ui/src/components/agent-config-primitives.tsx`). Güncel arayüzde bütçe, bütçe kuralları üzerinden düzenlenir (bölüm 8) ve yeni ajanlar `budgetMonthlyCents: 0` ile oluşturulur.

### 4.4 "hire agent" onay akışı

Sunucuda iki giriş noktası vardır; hangisinin çalışacağını şirket ayarı belirler:

- `POST /api/companies/:companyId/agents` ajanı doğrudan oluşturur; ama `company.requireBoardApprovalForNewAgents` açıksa 409 "Direct agent creation requires board approval. Use POST /api/companies/:companyId/agent-hires to create a pending hire approval." hatasını verir (`server/src/routes/agents.ts:4795-4812`).
- `POST /api/companies/:companyId/agent-hires` her zaman çalışır (`server/src/routes/agents.ts:4475`). `requiresApproval = company.requireBoardApprovalForNewAgents` değerini okur ve ajanı `pending_approval` ya da `idle` durumunda oluşturur (`:4633-4634`). Onay gerekiyorsa ayrıca şu onay kaydını ekler: `{type: "hire_agent", status: "pending", payload: {name, role, title, icon, appearance, reportsTo, capabilities, adapterType, adapterConfig (redacted), runtimeConfig, budgetMonthlyCents, desiredSkills, metadata, agentId, requestedByAgentId, requestedConfigurationSnapshot}}` (`:4695-4730`); kaynak görevleri bağlar, `agent.hire_created` ve `approval.created` olaylarını kaydeder. 201 koduyla `{agent, approval}` döndürür ve çalışma başına idempotenttir.

Aç/kapa düğmesinin adı "Require board approval for new hires", açıklaması "New agent hires stay pending until approved by board." biçimindedir; şirketin Genel ayarlar sayfasında durur (`ui/src/pages/CompanySettings.tsx:347-353`).

Onay beklerken ajan listede gizlidir (bölüm 2.1) ve ayrıntı sayfasında onay bekleme şeridi görünür. Onaylanınca (şeritten, onaylar sayfasından ya da Gelen kutusu ekranından) ajan etkinleşir: `agentsSvc.activatePendingApproval(payloadAgentId, payload)` (`server/src/services/approvals.ts:158`); içerikte sıfırdan büyük bir aylık bütçe varsa ajan için bir bütçe kuralı oluşturulur (`:191`); işe alma reddedilirse ajan sonlandırılır (`:227`).

Dış ajanlar başka bir yoldan gelir: "Invite an external agent", `allowedJoinTypes: "agent"` ile bir davet oluşturur, kopyalanacak bir ilk kurulum istemi gösterir (`/api/invites/:token/onboarding.txt`) ve şu notu düşer: "An organization admin must approve its join request before it can claim an API key." (`ui/src/components/new-agent/ExternalAgentInviteDialog.tsx`, 93 satır). İstek daha sonra katılma isteği kuyruğunda görünür (bölüm 11.3).

---

## 5. Ekip kataloğu ve yerleşik ajanlar

### 5.1 Ekip kataloğunun içeriği (`packages/teams-catalog`)

Bir "team" (ekip), YAML ön bilgi bloğu (frontmatter) taşıyan markdown dosyalarından oluşan bir klasördür: bir `TEAM.md`, `agents/<slug>/AGENTS.md`, `projects/<slug>/PROJECT.md`, `projects/<slug>/tasks/<slug>/TASK.md` ve isteğe bağlı olarak `skills/<slug>/SKILL.md`. Katalogla dört ekip gelir:

| Ekip | Tür / kategori | Ajanlar | Proje ve yinelenen görev | Gerekli skill'ler | `defaultInstall` | Kaynak |
|---|---|---|---|---|---|---|
| Core Exec Team | bundled / company-defaults | CEO (yönetici), CTO, QA | `first-project`, CEO'ya atanmış yinelenen "First Heartbeat Review" görevi | task-planning, issue-triage, github-pr-workflow, qa-acceptance | true | `packages/teams-catalog/catalog/bundled/company-defaults/core-exec-team/TEAM.md:1-28` |
| Product Design | bundled / product | UX tasarımcısı (yönetici) | `product-design`, haftalık tasarım incelemesi | wireframe, design-critique, task-planning | false | `.../bundled/product/product-design/TEAM.md:1-24` |
| Product Engineering | bundled / software-development | CTO (yönetici), kıdemli yazılımcı, QA | `product-engineering`, haftalık mühendislik toplantısı | github-pr-workflow, qa-acceptance, task-planning, doc-maintenance | false | `.../bundled/software-development/product-engineering/TEAM.md:1-28` |
| Content Machine | optional / content | içerik sorumlusu (yönetici) | `content-operations`, haftalık içerik incelemesi; yerel bir `content-calendar` skill'iyle gelir | listelenmemiş | false | `.../optional/content/content-machine/TEAM.md:1-20` |

Dosya biçimi küçüktür. Bir ajan tanımı, ön bilgi bloğu ile tek paragraflık bir rol açıklamasından oluşur:

```markdown
<!-- packages/teams-catalog/catalog/bundled/company-defaults/core-exec-team/agents/qa/AGENTS.md:1-11 -->
---
name: QA
slug: qa
title: QA Engineer
role: qa
reportsTo: cto
skills:
  - qa-acceptance
---

You are the QA Engineer. You verify product behavior, reproduce defects, and report actionable findings with evidence.
```

Görev tanımında `assignee`, `project` ve `recurring: true` bulunur (`.../projects/first-project/tasks/first-heartbeat/TASK.md:1-9`); proje tanımında `owner` vardır (`.../projects/first-project/PROJECT.md:1-8`). Adaptör türü dosyalara bilerek yazılmamıştır; böylece ekip kurulurken sorulabilir (`.../product-design/TEAM.md:44`).

### 5.2 Ekip kataloğu arayüzü (`ui/src/pages/TeamCatalog.tsx`, 2623 satır)

Bu commit'teki durum: sunucu API'si kayıtlıdır (`server/src/app.ts:666`, yollar `server/src/routes/teams-catalog.ts:65-110` içinde) ve `"teams-catalog"` bilinen bir yol köküdür (`ui/src/lib/company-routes.ts:6`); ama `ui/src/App.tsx` içinde bu sayfa için bir yol yoktur. Bu bileşenleri çizen tek yer tasarım kılavuzudur (`ui/src/pages/DesignGuide.tsx:197-206`, `:1905`). Tamamlanmış ama henüz ulaşılamayan bir tasarım olarak görülmelidir.

Yerleşim (`TeamCatalog`, `:2256-2623`): liste ve ayrıntıdan oluşan bir ekran.

- Araç çubuğu: "Teams" başlığı, bir arama alanı (`h-8 w-56 pl-8`), üç açılır filtre (Tür: all/bundled/optional; Kategori; Risk: any/safe/has warnings/blocked) ve "Reset filters". Bütün filtreler adresin sorgu kısmında tutulur (`:2269-2283`, `:2394-2480`).
- Soldaki liste (`lg:w-(--sz-28rem)`); "Bundled · n", "Optional · n", "Installed · n" biçimindeki küçük, büyük harfli başlıklar altında gruplanır (`:2516-2561`). `TeamRow` satırında ad, sarı bir "update available" noktası, dış kaynaklar için bir uyarı üçgeni ve `3a · 1p · 1r · 4s` gibi kısa bir sayı satırı (ajan, proje, rutin, skill) görünür (`:2119-2175`).
- Sağdaki ayrıntı (`TeamDetailPane`, `:671-863`): ad, rozetler (tür, kategori, güven düzeyi, uyumluluk, köken, Kurulu / Güncelleme var), birincil düğme "Install team" ya da "Re-install latest", bir risk şeridi, markdown açıklama, dört sayı kutusu (Ajanlar, Projeler, Rutinler, Gerekli skill'ler), ajan hiyerarşisi ön izlemesi, projeler, gerekli skill'ler, ortam değişkeni girişleri, dış kaynaklar ve sayfa içi dosya görüntüleyicisi olan bir dosya ağacı.
- Dar ekranda bir ekip seçilene kadar yalnızca liste görünür; seçilince listenin yerini ayrıntı alır ve "Back to catalog" bağlantısı çıkar (`:2484-2488`, `:2574-2581`).
- Boş ekran ve hata durumları: "No team catalog configured.", sıfırlama eylemiyle birlikte "No teams match this filter.", Yeniden dene düğmesiyle birlikte "Failed to load team catalog." (`:2496-2513`).

`TeamCard` (`:2185-2236`), "pick a starter team" (başlangıç ekibi seç) ızgarası için düşünülmüş kare bir kutudur: `flex aspect-square w-full flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left`, seçiliyken `ring-2 ring-ring`; içinde simge kutusu, ad, sayılar, üç satırlık açıklama ve etiketler bulunur.

Kurulum sihirbazı (`TeamInstallerDialog`; adımlarını `computeSteps` hesaplar, `:884-893`):

| Adım | Ne zaman gösterilir | İçerik | Kaynak |
|---|---|---|---|
| Hedef yönetici | ekipte kök ajanlar varsa | mavi bir bilgi kutusu, taç simgesi ve "-> ?" ile kök ajanların listesi, aranabilir bir ajan listesi ve "Use this team as a full-organization package (no target manager)" seçeneği | `:1461-1543` |
| Kaynak kuralı | kaynaklardan biri sabitlenmemişse ya da tarayıcıdan kurulamıyorsa | her kaynak için bir satır ve üç aç/kapa düğmesi: dış kaynaklara izin ver, sabitlenmemiş isteğe bağlı kaynaklara izin ver, yerel yoldan gelen kaynaklara izin ver | `:1545-1629` |
| Ön koşul skill'ler | ekip skill gerektiriyorsa | her skill bir rozetle gösterilir: "Bundled in package", "Will install from catalog", "Will import from source", "Blocked" | `:1653-1698` |
| Ön izleme | her zaman | çakışma stratejisi, ad ve adaptör değişiklikleri, ortam değişkeni girişleri, sayılar | `:1763` ve sonrası |

Uç noktalar (`ui/src/api/teamCatalog.ts`): `GET /teams/catalog[?kind=&category=&q=]`, `GET /teams/catalog/:ref`, `GET /teams/catalog/:ref/files?path=`, `GET /companies/:id/teams/catalog/installed`, `POST /companies/:id/teams/catalog/:ref/preview`, `POST /companies/:id/teams/catalog/:ref/install`. Form durumunun biçimi: `TeamInstallFormState` (`ui/src/pages/TeamCatalog.tsx:907-920`).

### 5.3 Yerleşik ajanlar (`enableBuiltInAgents` bayrağı, varsayılan kapalı)

Yerleşik ajanlar, belirli özelliklerin arkasında çalışan ve ürünün kendisinin yönettiği ajanlardır. `server/src/services/built-in-agents.ts:308-460` içinde dört tanesi tanımlıdır:

| Anahtar | Ad | Amaç (`shortPurpose` alanından) | Not |
|---|---|---|---|
| `briefs` | Briefs Agent | "Prepares concise operational briefs for the board and agent company." (yönetim kurulu ve ajan şirketi için kısa operasyon özetleri hazırlar) | paketi yok (`:310-319`) |
| `learning` | Learning Agent | "Maintains reusable company learning from completed work and recurring patterns." (biten işlerden ve yinelenen kalıplardan çıkan, yeniden kullanılabilir şirket bilgisini güncel tutar) | paketi yok (`:321-330`) |
| `reflection-coach` | Reflection Coach | Ajanların son işlerini inceler, talimatlar ve skill'ler için küçük iyileştirmeler önerir, uygulamadan önce onay ister | talimatlarla, bir skill'le ve duraklatılmış haftalık bir rutinle gelir (`0 9 * * 1`); varsayılan durumu duraklatılmıştır; ajan ya da skill oluşturamaz; değişiklik kuralı, farkın gösterilmesini ve görev içinde kabul edilmiş bir etkileşimi şart koşar (`:332-403`) |
| `summarizer` | Summarizer | Proje ve çalışma alanı özet alanlarına kısa durum özetleri yazar | varsayılan adaptörü `claude_local`, modeli `claude-haiku-4-5`; bir skill ve duraklatılmış bir rutinle gelir (`:405-460`) |

Yaşam döngüsü sunucuda türetilir: `not_provisioned -> pending_approval -> needs_setup -> ready <-> paused` (`ui/src/api/builtInAgents.ts:4-18`). `pending_approval` yalnızca şirket yeni ajanlar için yönetim kurulu onayı istiyorsa oluşur. Yönetilen her kaynağın (talimatlar, skill, rutin) bir sapma durumu vardır: `missing | stock_current | stock_update_available | operator_modified` (`:69-74`). İki ayrı eylem bulunur: "reset" (ürünle gelen varsayılana döner) ve "reconcile" (güncellemeleri uygular ama operatörün değişikliklerini korur).

Arayüz parçaları: sarı bir yaşam döngüsü etiketi (`ui/src/components/BuiltInAgentBadges.tsx:20-37`); adaptör türü ve "Monthly budget (optional)" alanlarını içeren "Set up the {name}" kurulum penceresi (`ui/src/components/ConfigureBuiltInAgentModal.tsx:155-206`); Adaptör, Rutin ve Öneri satırlarını ve "Run Reflection Coach once?" gibi onay sorularını içeren "Bundle status" paneli (`ui/src/components/BuiltInBundlePanel.tsx:320-427`). Bir özellik hazır olmayan bir yerleşik ajana ihtiyaç duyduğunda sunucu `built_in_agent_not_configured` koduyla 412 yanıtı verir ve bu yanıt kurulum penceresini açar (`ui/src/api/builtInAgents.ts:124-129`).

Uç noktalar: `GET /companies/:id/built-in-agents`, `POST .../:key/provision`, `/reset`, `/reconcile`, `/routines/:routineKey/{run,enable,disable}` (`ui/src/api/builtInAgents.ts:137-167`).

---

## 6. Ajan sohbeti ve yönetim kurulu sohbeti

### 6.1 Ajan sohbeti (`enableAgentChat` bayrağı, varsayılan kapalı)

Temel tasarım kararı şudur: sohbet ayrı bir veri türü değildir. Sıradan bir görevdir ("issue"); iki ek sütunu (`conversation_agent_id` ve `conversation_user_id`), değeri `active` ya da `waiting` olan bir `conversation_state` alanı ve `(company, agent, user)` üzerinde tekil bir dizini vardır. Böylece her kişinin her ajanla yalnızca bir süren konuşması olur (`packages/db/src/schema/issues.ts:32-34`, `:95-103`). Check kısıtı ayrıca konuşma görevinin o ajana atanmış olmasını ve hiçbir zaman `done` ya da `cancelled` olmamasını zorunlu kılar.

- API: `GET /companies/:id/chats` (kullanıcının kendi konuşmaları), `GET /companies/:id/chats/:agentRef` (görevi ya da null döndürür), `POST /companies/:id/chats/:agentRef` (yoksa oluşturur) (`ui/src/api/agentChats.ts`; sunucu tarafı `server/src/routes/issues.ts:17265-17276`).
- `AgentChat` (`ui/src/pages/AgentChat.tsx`, 101 satır) olağan görev akışını çizer: `<TaskDetailSurface conversation={{ agent, issue, ensureIssue }} />` (`:95-99`). Görev önceden değil, ilk mesaj gönderilirken oluşturulur (`ensureIssue`, `:54-71`).
- `AgentChats` (`ui/src/pages/AgentChats.tsx`, 74 satır) karşılama sayfasıdır. Varsa en son sohbete yönlendirir (`:44-46`). Yoksa ortalanmış bir seçici gösterir: simge, "Who would you like to talk to?", bir yardım satırı, `grid grid-cols-1 gap-2 sm:grid-cols-2` içinde en çok altı ajan düğmesi (her biri `flex items-center gap-3 rounded-lg border border-border p-4`) ve "Browse all agents" (`:52-73`).
- Sohbet yollarındaki ikinci kenar çubuğu: `AgentConversationsSidebar` kullanıcının kendi konuşmalarını listeler, `conversationState === "active"` olduğunda ön izleme olarak "Working..." gösterir ve geçmiş okunabilsin diye sonlandırılmış ajanları da listelemeyi sürdürür (`ui/src/components/AgentConversationsSidebar.tsx:19-47`).
- Ana kenar çubuğuna "Chat" satırı yalnızca bayrak açıkken eklenir (`ui/src/components/Sidebar.tsx:178`); her ajan satırına da bir Sohbet düğmesi gelir (bölüm 2.1).
- Bayrak kapalıyken: "Agent Chat is disabled. Enable it in Experimental settings. Existing history remains available through task links." (`ui/src/pages/AgentChat.tsx:76-82`). Bayrağın açıklaması, kapatmanın "preserves conversations and lets active runs finish, but prevents new messages" (konuşmaları korur, süren çalışmaların bitmesine izin verir ama yeni mesajları engeller) etkisi olduğunu söyler (`ui/src/pages/InstanceExperimentalSettings.tsx:296-306`).
- Son açılan sohbetler her tarayıcıda ayrı hatırlanır (`ui/src/lib/recent-agent-chats.ts`).

### 6.2 "Conference Room" adlı yönetim kurulu sohbeti (`enableConferenceRoomChat` bayrağı, varsayılan kapalı, aç/kapa düğmesi gizli)

`ui/src/pages/BoardChat.tsx` (1009 satır). Yol `ConferenceRoomChatGate` kapısının arkasındadır; bayrak kapalıyken bu kapı Genel bakış ekranına yönlendirir (`ui/src/components/ConferenceRoomChatGate.tsx:13-17`). Bu bayrağın arayüzdeki aç/kapa düğmesi ayar sayfasında kodla kapatılmıştır: `SHOW_CONFERENCE_ROOM_EXPERIMENTAL_SETTING = false` (`ui/src/pages/InstanceExperimentalSettings.tsx:59-60`, `:354-365`).

- Şirketin lider ajanıyla tek bir sohbet; "Board Operations" başlıklı bir görevin yorumları olarak saklanır (`:300`, yorumlar `:308`).
- Gönderme: `{companyId, message, taskId}` içeriğiyle `POST /api/board/chat/stream`; yanıt, `fetch` ve bir okuyucuyla okunan bir server-sent-event akışıdır; `start`, `status`, `chunk`, `error`, `done` olayları işlenir, 130 saniye sonra istek kesilir (`:550-613`; sunucu yolu `server/src/routes/board-chat.ts:97`).
- Yerleşim: bölünmüş bir görünüm; solda sohbet (varsayılan genişlik 2/3, sürüklenebilir ayırıcı, en küçük bölme 280px), sağda canlı etkinlik akışı (`:43-46`, `:99-169`, `:657-671`).
- Mesaj balonları: kullanıcı balonu `bg-blue-600 text-white [border-radius:14px_14px_4px_14px]`, sağa yaslı; ajan balonu `bg-card border border-border [border-radius:14px_14px_14px_4px]`, üstünde avatar ve ad başlığı; dış öğe `min-w-0 max-w-(--pct-85) break-words px-3 py-2 text-sm` (`:53-54`, `:66-68`, `:800-829`).
- Aşamalı bir karşılama: önce yazıyor göstergesi olan bir balon, sonra üretilmiş bir karşılama mesajı, sonra yazma kutusunu dolduran dört öneri etiketi ("Draft an Organization Brief", "Create a hiring plan", "Outline our first 30 days", "Write an intro pitch") (`:728-796`).
- Kullanıcı yukarı kaydırmışken yeni içerik gelirse yüzen bir "jump to latest" etiketi çıkar (`:188-202`).

---

## 7. Onaylar

Paperclip'te "bir insan evet demeli" anlamına gelen üç ayrı mekanizma vardır. Agent Office'e uyarlarken bunlar birbirinden ayrı tutulmalıdır.

| Mekanizma | Nerede saklanır | Nerede karar verilir |
|---|---|---|
| Yönetim kurulu onayları | `approvals` tablosu, dört tür | Onaylar sayfası, onay ayrıntısı, Gelen kutusu satırları, görev ayrıntısı |
| Araçların "Ask first" istekleri | `tool_action_requests` | `/apps/review` kuyruğu (bölüm 10.3) |
| Gizli anahtar önerileri | gizli anahtar önerileri | Gizli anahtarlar sayfası, Öneriler sekmesi (bölüm 10.2) |

Dördüncü, daha hafif bir tür de vardır: görev akışındaki "interactions" (etkileşimler), yani onay istekleri, sorular ve önerilen görevler; kuralları şirket düzeyinde belirlenir (bölüm 11.2). Bunlar görev ekranına aittir.

### 7.1 Türler ve durumlar

Türler (`packages/shared/src/constants.ts:689-695`; etiketler ve simgeler `ui/src/components/ApprovalPayload.tsx:5-9`, `:40` içinde):

| Tür | Etiket | Simge | Kim oluşturur |
|---|---|---|---|
| `hire_agent` | Hire Agent | `UserPlus` | şirket onay istiyorsa işe alma uç noktası (bölüm 4.4) |
| `approve_ceo_strategy` | CEO Strategy | `Lightbulb` | bir ajan, `POST /companies/:id/approvals` ile |
| `budget_override_required` | Budget Override | `ShieldAlert` | kesin durdurma sınırına gelindiğinde bütçe servisi (bölüm 8.3) |
| `request_board_approval` | Board Approval | `ShieldCheck` | bir ajan, genel istek |

Durumlar: `pending`, `revision_requested`, `approved`, `rejected`, `cancelled` (`packages/shared/src/constants.ts:697-704`). "Actionable" (işlem bekleyen), `pending` ya da `revision_requested` demektir (`ui/src/lib/inbox.ts:21`).

Kaydın biçimi (`packages/shared/src/types/approval.ts`): `{id, companyId, type, requestedByAgentId, requestedByUserId, status, payload, decisionNote, decidedByUserId, decidedAt, createdAt, updatedAt}`. Oluşturma isteğinin gövdesi `{type, requestedByAgentId?, payload: Record<string, unknown>, issueIds?: string[]}` biçimindedir (`packages/shared/src/validators/approval.ts`). İçerik (payload) türe göre serbest biçimlidir; aşağıdaki çiziciler bu içeriği yorumlar.

### 7.2 Onaylar sayfası (`ui/src/pages/Approvals.tsx`, 136 satır)

- Adrese bağlı iki sekme: Bekleyen (Pending) ve Tümü (All) (`:90`). Bekleyen sekmesinde `bg-yellow-500/20 text-yellow-500` sınıflı bir sayı rozeti durur (`:94`).
- Bekleyen filtresi: `status === "pending" || status === "revision_requested"` (`:70-75`). En yeni en üstte olacak biçimde sıralanır.
- `ApprovalCard` kartlarından oluşan bir ızgara. Onaylayınca `/approvals/:id?resolved=approved` adresine gidilir (`:46-50`).
- Boş ekran: `ShieldCheck` simgesi ve "No pending approvals." ya da "No approvals yet." metni (`:111`). Yüklenirken: `PageSkeleton variant="approvals"` (`:83`).

### 7.3 Onay kartı (`ui/src/components/ApprovalCard.tsx`)

`Card className="block border-border/70 p-4"` (`:57`).

- Başlık: yuvarlak bir simge kutusu `h-9 w-9 rounded-full border border-border/70 bg-background/80`, küçük, büyük harfli bir tür etiketi, ajanın kimliğiyle birlikte "Requested by" (`:74`), `h3.text-base font-semibold` biçiminde konu, "Approval request created {timeAgo}" (`:84`) ve simgeli bir durum etiketi (yeşil onay işareti, kırmızı çarpı, koyu sarı ya da sarı saat).
- Gövde: `mt-4 border-t border-border/60 pt-4` altında içerik çizicisi; karar verilmişse ardından karar notu kutusu.
- Alt kısım: Onayla (`bg-green-700 hover:bg-green-600 text-white`, `:119`) ve Reddet (`variant="destructive"`, `:126`), ardından çerçevesiz (ghost) bir "View details" bağlantısı (`:142-146`). Onayla ve Reddet düğmeleri `budget_override_required` türünde ve karara bağlanmış onaylarda gizlenir (`:52`).

İçerik çizicileri (`ui/src/components/ApprovalPayload.tsx`):

| Tür | Kartın gösterdiği | Kaynak |
|---|---|---|
| işe alma | Ad, Rol, Unvan, Simge, Yetenekler, bir adaptör etiketi, skill etiketleri | `ApprovalPayload.tsx:84` |
| CEO stratejisi | başlık ve bir `pre` bloğu içinde plan / description / strategy / text alanı ya da ham JSON | `ApprovalPayload.tsx:113` |
| bütçe aşımı | Kapsam, Dönem, Ölçüt, "Limit X · Observed Y", yönlendirme metni | `ApprovalPayload.tsx:132` |
| yönetim kurulu onayı | Başlık, markdown olarak Özet, sarı bir "Recommended action" kutusu, bir "On approval" kutusu, madde işaretli Riskler listesi, `pre` bloğu içinde "Proposed comment" | `ApprovalPayload.tsx:152-230` |

`approvalSubject(payload)` sırayla `title`, `name`, `summary`, `recommendedAction` alanlarına bakar ve ilk bulduğunu seçer (`ui/src/components/ApprovalPayload.tsx:21`); `approvalLabel` ise "Hire Agent: Designer" gibi etiketler kurar (`:30-31`).

### 7.4 Onay ayrıntısı (`ui/src/pages/ApprovalDetail.tsx`, 369 satır)

Kapsayıcı: `space-y-6 max-w-3xl` (`:175`).

- Onaylandıktan sonra yeşil bir "Approval confirmed" şeridi çıkar ve bağlama uygun bir sonraki adımı gösterir: "Review linked task(s)", "Open hired agent" ya da "Back to approvals" (`:160-170`, `:185`).
- Ana kart: tür simgesi, etiket, kimlik, durum rozeti, "Requested by", içerik, ham JSON'u açan "See full request" düğmesi (`:230`), karar notu.
- "Linked Tasks" bölümü ve şu not: "Linked tasks remain open until the requesting agent follows up and closes them." (bağlı görevler, isteyen ajan işi sürdürüp kapatana kadar açık kalır; `:244-260`).
- Duruma göre eylemler: Onayla ve Reddet; yalnızca beklerken "Request revision" (`:297`); düzeltme istenmişken "Mark resubmitted" (`:307`); reddedilmiş bir işe almada "Delete disapproved agent" (`:321`). Bütçe onaylarında düğme yoktur, yalnızca "Resolve this budget stop from the budget controls on /costs" metni görünür (`:287`).
- Yorumlar kartı: her yorumda ajan ya da "Board" (`:341`) ve markdown gövde görünür; altta "Post comment" düğmeli bir metin alanı vardır (`:363`).

### 7.5 Uç noktalar ve sunucu davranışı

| Uç nokta | Gövde | Kaynak |
|---|---|---|
| `GET /companies/:id/approvals[?status=]` | | `ui/src/api/approvals.ts:6` |
| `POST /companies/:id/approvals` | yukarıdaki oluşturma gövdesi | `:10`, `server/src/routes/approvals.ts:222` |
| `GET /approvals/:id` | | `:11` |
| `POST /approvals/:id/approve`, `/reject` | `{decisionNote}` | `:13-15`, `server/src/routes/approvals.ts:286`, `:402` |
| `POST /approvals/:id/request-revision` | `{decisionNote}` | `:17`, `server/src/routes/approvals.ts:437` |
| `POST /approvals/:id/resubmit` | `{payload?}` | `:19`, `server/src/routes/approvals.ts:464` |
| `GET` / `POST /approvals/:id/comments` | `{body}` | `:20-22` |
| `GET /approvals/:id/issues` | | `:23` |
| `GET` / `POST /issues/:id/approvals`, `DELETE /issues/:id/approvals/:approvalId` | bir onayı bir göreve bağlar | `ui/src/api/issues.ts:594-598` |

Sunucunun uyguladığı kurallar:

- Onaylama, reddetme ve düzeltme isteme yalnızca yönetim kuruluna açıktır (`assertBoard`, `server/src/routes/approvals.ts:287`, `:403`, `:441`).
- Yalnızca `pending` ya da `revision_requested` durumundaki onaylar karara bağlanabilir (`server/src/services/approvals.ts:16-17`, `:52`, `:71`). Daha önce verilmiş bir kararın yinelenmesi hiçbir şey yapmaz.
- Onaylanınca: türe özgü etki çalışır (işe alınan ajanın etkinleştirilmesi, bütçe kuralı), bir etkinlik kaydı yazılır ve isteyen ajan `reason: "approval_approved"` gerekçesiyle, onayı ve bağlı görevleri belirten bir içerikle uyandırılır (`server/src/routes/approvals.ts:325-342`). Yani ajan işine kendisi devam eder; onaylamak bağlı görevleri kapatmaz.
- Düzeltme isteme, notla birlikte `pending -> revision_requested` geçişini yapar (`server/src/services/approvals.ts:236-244`); yeniden gönderme, istenirse yeni bir içerikle, onayı yeniden `pending` durumuna alır (`:257-265`).

### 7.6 Bekleyen onayların göründüğü yerler

| Ekran | Ayrıntı | Kaynak |
|---|---|---|
| Kenar çubuğu | "Approvals" satırı yoktur. Onaylar Gelen kutusu rozetindeki sayıya katılır; başarısız çalışma varsa rozet tehlike rengine döner. | `ui/src/components/Sidebar.tsx:167-177` (dosyada "approval" hiç geçmiyor) |
| Gelen kutusu rozetinin hesabı | gelen kutusu = işlem bekleyen onaylar + katılma istekleri + başarısız çalışmalar + bana ait okunmamış görevler | `ui/src/lib/inbox.ts:1265-1320` |
| Gelen kutusu satırları | `ApprovalInboxRow`: okunmamış noktası, simge kutusu, etiket, durum, "requested by", satır içinde Onayla (`h-8 min-w-(--sz-64px) ... bg-green-700`) ve Reddet düğmeleri, arşivleme | `ui/src/pages/Inbox.tsx:500-620` |
| Genel bakış | `/approvals` adresine giden "Pending Approvals" sayı kartı; duraklatılmış ajanları, duraklatılmış projeleri ve bekleyen bütçe onaylarını gösteren bir bütçe şeridi satırı | `ui/src/pages/Dashboard.tsx:442-443`, `:390` |
| Görev ayrıntısı | bağlı onaylar görevin içinde, onayla ve reddet düğmeleriyle birlikte tam birer `ApprovalCard` olarak çizilir | `ui/src/pages/IssueDetail.tsx:2653`, `:2936-2952`, `:4578-4622` |
| Ajan ayrıntısı | "Approve agent" düğmeli, onay bekleyen işe alma şeridi | `ui/src/pages/AgentDetail.tsx:1366-1379` |
| Maliyetler / bütçeler | bütçe olayları "Pending approval" ya da "Escalated" durumunu gösterir | `ui/src/components/BudgetIncidentCard.tsx:23-24` |
| Kenar çubuğu rozet API'si | `GET /companies/:id/sidebar-badges`, `{inbox, approvals, failedRuns, joinRequests}` döndürür | `server/src/routes/sidebar-badges.ts` |
| Canlı güncelleme | bir onayla ilgili `activity.logged` olayı onay listesini geçersiz kılar | `ui/src/context/LiveUpdatesProvider.tsx:1479-1484` |

---

## 8. Maliyetler ve bütçeler

### 8.1 Sayfa yapısı (`ui/src/pages/Costs.tsx`, 1132 satır)

Sade kabukta bu sayfa Denetim ekranının içine gömülüdür: `/activity/costs` yolu `<Costs embedded initialTab="overview" hideBudgetsTab />`, `/activity/budgets` yolu ise `<Costs embedded initialTab="budgets" lockTab />` çizer (`ui/src/pages/audit/AuditHub.tsx:124-130`). Denetim ekranının kendisi "Audit" başlığı, bir paragraf ve Etkinlik, Çalışmalar, Maliyetler, Bütçeler, Zaman çizelgesi sekmelerini taşıyan bir `PageTabBar` bileşeninden oluşur (`ui/src/pages/audit/AuditHub.tsx:84-102`, `ui/src/pages/audit/audit-navigation.ts:3-13`). Her Denetim bağlantısı sorgu dizesinde bir kapsam taşıyabilir (`agentId`, `runId`, `entityType`, `entityId`); "bu ajanın maliyetleri" görünümü, ajana özel bir sayfa olmadan böyle çalışır (`ui/src/pages/audit/audit-navigation.ts:23-62`).

Bileşen parametreleri (props): `{embedded, initialTab, lockTab, hideBudgetsTab}` (`ui/src/pages/Costs.tsx:43-47`, `:161-165`).

- Tarih aralığı: hazır seçenek düğmeleri `mtd` (ay başından bugüne, varsayılan), `7d`, `30d`, `ytd`, `all` ve iki tarih alanıyla `custom` (`ui/src/hooks/useDateRange.ts`).
- Dört sayı kutusu: "Inference spend", "Budget" (açık olay sayısını, kullanım yüzdesini ya da "Open" metnini gösterir), "Finance net", "Finance events" (`:609-644`).
- Sekmeler: Genel bakış (Overview), Bütçeler (Budgets), Sağlayıcılar (Providers), Faturalayanlar (Billers), Finans (Finance) (`:651-655`).

Genel bakış sekmesi (`:659` ve sonrası): en çok iki `BudgetIncidentCard`; harcama tutarını, bir bütçe satırını, bir kullanım kutusunu ve bir kullanım çubuğunu (yüzde 90'ın üstünde kırmızı, 70'in üstünde sarı, diğer durumda yeşil) içeren "Inference ledger" kartı (`:690`); bir finans özeti; sağlayıcı, model, faturalayan ve faturalama türüne göre açılabilen satırları ve pay yüzdesi olan "By agent" (`:749`); "By project" (`:837`); bir finans zaman çizelgesi.

Bütçeler sekmesi (`:864` ve sonrası): dört kutulu bir "Budget control plane" kartı (açık olaylar, bekleyen onaylar, duraklatılmış ajanlar, duraklatılmış projeler) (`:873-898`); açık olaylar ızgarası (`:909`); ardından her kapsam (organizasyon, ajan, proje) için `BudgetPolicyCard` kartlarından oluşan birer bölüm. Boş ekran metni: "No budget policies yet. Set agent and project budgets from their detail pages, or use the existing organization monthly budget control." (`:972`).

Sağlayıcılar sekmesi (`:981`): her sağlayıcı için bir alt sekme; her biri bir `ProviderQuotaCard` (`ui/src/components/ProviderQuotaCard.tsx`, 416 satır). Kartta dönem harcamasını ve bu haftayı orantılı bütçe payına göre gösteren `QuotaBar` çubukları, 5 saatlik, 24 saatlik ve 7 günlük kayan pencereler, abonelik kullanım payı, model başına token ve maliyet payı çubukları ve canlı abonelik kota pencereleri bulunur.

Faturalayanlar (`:1036`) ve Finans (`:1089`) sekmeleri, faturalayan tarafa göre harcamayı ve finans olaylarını (krediler, ücretler) türe ve zamana göre gösterir.

Yenileme: bütçeler ve maliyet tabloları için 30 saniye, sağlayıcı kota pencereleri için 5 dakika (`:220`, `:318-358`).

### 8.2 Bütçe kartları

`BudgetPolicyCard` (`ui/src/components/BudgetPolicyCard.tsx`), `card` ve `plain` çeşitleriyle (`:36-54`):

- Durum etiketi: Duraklatıldı (Paused), Uyarı (Warning), "Hard stop" ya da Sağlıklı (Healthy) (`:181`, `:209`).
- İki blok: Gözlenen harcama (Observed) ve Bütçe (Budget); "Soft alert at {warnPercent}%" satırı (`:71`, `:90`); ilerleme çubuğuyla birlikte Kalan (Remaining) (`:99`); gerektiğinde duraklatma notu.
- Satır içi düzenleyici: "Budget (USD)" alanı (`:138`) ve "Set budget" ya da "Update budget" düğmesi (`:154`).

`BudgetIncidentCard` (`ui/src/components/BudgetIncidentCard.tsx`):

- Başlık "{scope} hard stop" (`:52`), durum rozeti Open / "Pending approval" / Escalated / Resolved / Dismissed (açık, onay bekliyor, üst kademeye iletildi, çözüldü, yok sayıldı; `:23-24`).
- "Spending reached X against a limit of Y." (`:60`) metni ve kapsamın duraklatıldığını söyleyen bir not.
- "New budget (USD)" alanı (`:80`), gözlenen harcamanın 10 dolar fazlası ile eski sınırdan büyük olanıyla dolu gelir; "Raise budget & resume" (`:97`), o anki harcamanın üstünde bir değer ister (`:102`); bir de "Keep paused" düğmesi vardır (`:109`).

### 8.3 Veri modeli ve sunucu kuralları

Enum değerleri (`packages/shared/src/constants.ts:875-894`): kapsam `company | agent | project`; ölçüt `billed_cents`; dönem `calendar_month_utc | lifetime`; eşik `soft | hard`; olay durumu `open | resolved | dismissed`; çözüm eylemi `keep_paused | raise_budget_and_resume`.

Uç noktalar (`ui/src/api/budgets.ts:12-16`, `ui/src/api/costs.ts`):

| Uç nokta | Amaç |
|---|---|
| `GET /companies/:id/budgets/overview` | gözlenen tutarlarıyla kurallar, açık olaylar, duraklatılanların ve bekleyenlerin sayıları |
| `POST /companies/:id/budgets/policies` | ekleme ya da güncelleme (upsert): `{scopeType, scopeId, amount, windowKind, warnPercent?, hardStopEnabled?, notifyEnabled?, isActive?}` |
| `POST /companies/:id/budget-incidents/:incidentId/resolve` | `{action, amount?, decisionNote?}` |
| `GET /companies/:id/costs/{summary,by-agent,by-agent-model,by-project,by-provider,by-biller,finance-summary,finance-by-biller,finance-by-kind,finance-events,window-spend,quota-windows}` | hepsi `from` / `to` alır |

`server/src/services/budgets.ts` içindeki kurallar:

```ts
// server/src/services/budgets.ts:66-75
function budgetStatusFromObserved(observedAmount, amount, warnPercent) {
  if (amount <= 0) return "ok";
  if (observedAmount >= amount) return "hard_stop";
  if (observedAmount >= Math.ceil((amount * warnPercent) / 100)) return "warning";
  return "ok";
}
```

- Gözlenen harcama, kapsamın dönem içindeki `cost_events.cost_cents` değerlerinin toplamıdır (`:143-166`).
- Oluşturma sırasındaki varsayılanlar: `warnPercent 80`, `hardStopEnabled true`; dönem, projelerde varsayılan olarak `lifetime`, diğerlerinde `calendar_month_utc` olur (`:519`, `:561-562`).
- Her maliyet kaydında: uyarı eşiği aşılırsa bir uyarı (soft) olayı açılır; kesin durdurma açıkken sınır aşılırsa bir kesin durdurma (hard) olayı açılır, bir `budget_override_required` onayı oluşturulur (`:385`) ve `pauseAndCancelScopeForBudget` çağrılır (`:252`, `:693-696`); bu çağrı ajanı, projeyi ya da şirketi `budget` duraklatma gerekçesiyle duraklatır ve işlerini iptal eder.
- Her çalışma başlamadan önce `getInvocationBlock(companyId, agentId, {issueId, projectId})` sırasıyla şunları denetler: şirket duraklatılmış mı, şirket kuralı aşılmış mı, ajan bütçe yüzünden duraklatılmış mı, ajan kuralı aşılmış mı, proje kuralı aşılmış mı, proje bütçe yüzünden duraklatılmış mı. Engel varsa "Agent cannot start because its budget hard-stop is still exceeded." gibi okunabilir bir gerekçe taşıyan bir engel kaydı döndürür (`:718-864`).
- Bütçe gözlenen harcamanın üstüne çıkarılınca kapsam sürdürülür ve olayları çözülmüş sayılır (`:591-610`).

---

## 9. Hedefler, projeler, rutinler, çalışma alanları

### 9.1 Hedefler

Model: `{id, companyId, title, description, level, status, parentId, ownerAgentId}` (`packages/shared/src/types/goal.ts`); düzeyler `company | team | agent | task`, durumlar `planned | active | achieved | cancelled` (`packages/shared/src/constants.ts:562-565`). Uç noktalar: `GET/POST /companies/:id/goals`, `GET/PATCH/DELETE /goals/:id` (`ui/src/api/goals.ts:5-10`).

- Liste (`ui/src/pages/Goals.tsx`, 63 satır): kenarlıklı, açılıp kapanabilen bir ağaç (`GoalTree`), her satırda düzey etiketi, başlık ve durum rozeti; "New Goal" düğmesi (`:55`); boş ekranda "No goals yet." metni ve "Add Goal" düğmesi (`:44-45`).
- Ayrıntı (`ui/src/pages/GoalDetail.tsx`, 227 satır): düzey ve durum, yerinde düzenlenebilen başlık ve açıklama, iki sekme ("Sub-Goals (n)" ve "Projects (n)", `:181-186`) ve sağda bir özellik paneli (Durum, Düzey, Sahip, Üst hedef, Oluşturulma, Güncellenme).
- Yeni hedef penceresi: başlık alanı, markdown açıklama, durum, düzey ve üst hedef için özellik etiketleri; Cmd/Ctrl+Enter gönderir (`ui/src/components/NewGoalDialog.tsx`).
- Kenar çubuğu bağlantısı varsayılan olarak kapalıdır ve deneysel bayrakların "Legacy" grubunda durur (`enableGoalsSidebarLink`, `ui/src/components/Sidebar.tsx:96`, `:212-214`; `ui/src/pages/InstanceExperimentalSettings.tsx:706-717`). Yollar yine de çalışır.

### 9.2 Projeler

Liste (`ui/src/pages/Projects.tsx`, 284 satır, tamamı okundu):

- Araç çubuğu: çerçevesiz (ghost) bir "Sort: {field}" açılır menüsü (Ad, Güncellenme, Oluşturulma, Hedef tarih; etkin alana tıklamak yönü çevirir) (`:31-36`, `:132-170`) ve çerçeveli bir "Add Project" düğmesi (`:171-174`).
- İki bölüm: "My Projects" ve "Other Projects"; ayrım, sayfaya bakan kullanıcının üyelik durumuna göre yapılır (`:105-118`, `:190-203`). Her bölüm `divide-y` sınıflı bir `Card` bileşenidir.
- Satır: `ProjectTile` (renk ve simge), ad ve açıklama içeren bir `EntityRow`; sonunda görev sayısı, bütçe, hedef tarih, durum rozeti, Join/Leave ve yıldız bulunur (`:214-273`). Kullanıcının ayrıldığı projeler `text-foreground/55` ile soluk gösterilir (`:221`).
- Boş ekran: "No projects yet." metni ve "Add Project" düğmesi (`:179-186`).

Oluşturma (`ui/src/components/NewProjectDialog.tsx`, 67 satır): yalnızca bir ad ve isteğe bağlı bir kaynak depo listesi; `projectsApi.create(companyId, {name, status: "planned", repositoryIds})` (`:28`).

Ayrıntı (`ui/src/pages/ProjectDetail.tsx`, 928 satır):

- Başlık: proje simgesi seçici (simge ızgarası ve 10 renk örneği), yerinde düzenlenebilen ad, "Paused by budget hard stop" etiketi (`:772`), "Managed by {plugin}" etiketi (`:778`), yıldız.
- "Project summary" özet alanı kartı (`:798`, `enableSummaries` bayrağı).
- Sekmeler (`:840-845`): Görevler, "Plugin operations" (eklentinin yönettiği projelerde), Çalışma alanları (yalnızca `enableIsolatedWorkspaces` açıksa ve çalışma alanı varsa, `:402`), Yapılandırma, Bütçe ve eklentilerin eklediği sekmeler. Son açılan sekme `localStorage` içinde `paperclip:project-tab:<id>` anahtarıyla hatırlanır (`:656`, `:698`).
- Bütçe sekmesi: `BudgetPolicyCard variant="plain"`; `windowKind: "lifetime"` ile kaydedilir (`:606`, `:629`).
- Yapılandırma sekmesi: her alanda otomatik kayıt göstergesi olan `ProjectProperties` (ad, açıklama, durum, hedefler, ortam değişkenleri, yürütme çalışma alanı ayarları) ve arşivleme / arşivden çıkarma.

Durumlar: `backlog | planned | in_progress | completed | cancelled` (`packages/shared/src/constants.ts:568-575`). Proje ayrıca `goalIds`, `leadAgentId`, `targetDate`, `color`, `icon`, `env`, `pauseReason`, `budget` ve `archivedAt` alanlarını taşır (`packages/shared/src/types/project.ts`).

Eşleştirme için önemli: Paperclip projelerinde görünürlüğü kısıtlayan bir üye listesi yoktur. "Üyelik", bölüm 1.4'teki kişisel Join/Leave durumudur.

### 9.3 Rutinler

Rutin, yinelenen bir iş tanımıdır. Her tetiklenme sıradan bir görev oluşturur; sayfanın alt başlığı da bu yüzden "Recurring work definitions that materialize into auditable execution tasks." der (denetlenebilir çalışma görevlerine dönüşen yinelenen iş tanımları; `ui/src/pages/Routines.tsx:810`, `:850`).

Liste (`ui/src/pages/Routines.tsx`, 1482 satır):

- Başlıkta "View all runs" (Denetim ekranındaki çalışmalara gider, `:856`) ve "Create routine" (`:815`, `:861`).
- Sıralama (Güncellenme, Oluşturulma, Son çalışma, Başlık) ve Gruplama (Klasör, Proje, Ajan, Yok) açılır menüleri; seçimler `localStorage` içinde `paperclip:routines-view:<companyId>` anahtarıyla saklanır (`:362-363`). Klasörler için bir yan sütun, etiketler ve toplu taşıma vardır. Ayrıca bir "Built-in routines" bölümü bulunur (`:259`).
- Satır eylemleri: "Run now" (rutinin değişkenleri varsa bir değişken penceresi açar), bir aç/kapa düğmesi (varsayılan bir ajan gerektirir) ve Düzenle, Şimdi çalıştır, Taşı, Duraklat, Arşivle seçeneklerini içeren bir menü.
- Boş ekran: "No active routines. Use Create routine to define the first recurring workflow." (`:1320`).

Oluşturma penceresi (`max-w-3xl`): bir başlık alanı; satır içi seçicilerden kurulan, cümle biçiminde bir satır ("For [Responsible] in [Project] filed in [Folder]"); @ ile söz etmeyi destekleyen markdown talimatlar; açılıp kapanan "Advanced delivery settings" (`:1186`); sonra "Create routine" (`:1246`). Oluşturduktan sonra tetikleyiciler bölümüne gidilir.

Ayrıntı (`ui/src/pages/RoutineDetail.tsx`, 947 satır). İkinci kenar çubuğunda gösterilen bölümler: Genel bakış, Tetikleyiciler, Değişkenler, Gizli anahtarlar, Kurallar (Delivery), Çalışmalar, Etkinlik, Sürüm geçmişi. Başlık: rutinin adı, eklenti rozeti, Geçmiş, "Edit routine" (`:869`), bir Çalıştır düğmesi ve Active / Paused / Draft / Archived etiketli bir otomasyon aç/kapa düğmesi (`:875`). Bir kaydetme çubuğu, her bölümde değişen alanları izler. Kaydetme `baseRevisionId` gönderir (`:366-369`); 409 yanıtında "Routine changed" gösterilir (`:385`).

Rutin kuralları (Delivery policies; `ui/src/components/routine-sections/editable-sections.tsx:36-90`); her biri, sonucunu tek satırla söyleyen tek seçimli kartlar olarak gösterilir:

| Ayar | Seçenekler |
|---|---|
| Çakışma | "Coalesce if active": süren bir çalışma hâlâ işini yaparken sırada tek bir devam çalışması tutulur. "Always enqueue": her tetiklenme sıraya alınır. "Skip if active": çakışan tetiklenmeler atılır. |
| Kaçırılanlar | "Skip missed": duraklatılmışken kaçırılan zaman aralıkları yok sayılır. "Enqueue missed with cap": toparlandıktan sonra kaçırılanlar telafi edilir; saatten sık zamanlamalar tek bir çalışmada birleştirilir. |
| Etkinlik kapısı | "Run on every scheduled tick" ya da "Skip when there's been no activity since the last run"; kapsam organizasyonun tamamı ya da rutinin projesi olabilir. |

Bunların altındaki "Next 5 fires" ön izlemesi, yaklaşan her tetiklenme zamanının yanına kuralın ne yapacağını yazar (`ui/src/components/routine-sections/editable-sections.tsx:559-592`). Değişkenler, talimatlardaki `{{placeholders}}` ifadelerinden kendiliğinden algılanır; türleri `text | textarea | number | boolean | select | date` olabilir (`packages/shared/src/constants.ts:654`). Gizli anahtarlar bölümü bir ortam değişkeni düzenleyicisidir; buradaki değerler, aynı anahtarlarda proje ve ajan ortam değişkenlerinin yerine geçer; `PAPERCLIP_*` adları ayrılmıştır (`ui/src/components/routine-sections/editable-sections.tsx:458`).

Tetikleyiciler (`packages/shared/src/constants.ts:648-651`): türler `schedule | webhook | api`; webhook imzalama modları `bearer | app_webhook | hmac_sha256 | github_hmac | fireflies_hmac | none`.

- Tetikleyici kartlarında cron ifadesinin okunur bir başlığı ve "Receiving events", "Ready · Waiting for an event" ya da "Authentication failed · Check the key in your app" gibi bir durum satırı görünür (`ui/src/components/routine-triggers/RoutineTriggers.tsx:247-251`); eylemler: Düzenle, Kaldır (Geri al seçeneğiyle), Duraklat/Etkinleştir, "Replace key" (`:559`) ve "Check connection" (`:586`, `:637`).
- Tetikleyici sihirbazı üç adımlıdır: "Choose trigger", sonra ya "Set schedule" ve "Review schedule" ya da "Connect your app" ve "Check connection" (`ui/src/components/routine-triggers/TriggerWizard.tsx:179-180`). Yeni bir webhook test modunda başlar; böylece ilk olay, görev oluşturmadan bağlantının çalıştığını kanıtlar (`:525-531`). Webhook gizli anahtarı yalnızca bir kez gösterilir.
- `ScheduleEditor` (`ui/src/components/ScheduleEditor.tsx`, 417 satır): hazır seçenekler her dakika, her saat, her gün, hafta içi, haftalık, aylık, özel (cron) (`:10-16`); saat 12 saatlik biçimdeki etiketlerle, dakika 5 dakikalık adımlarla seçilir; hafta günü düğmeleri ve ayın günü seçimi vardır; özel cron ifadesi doğrulanır ve sonraki üç tetiklenme ön izlenir. `parseCronToPreset` (`:48`) ve `buildCron` (`:103`) iki yönde çeviri yapar.

Uç noktalar (`ui/src/api/routines.ts:42-67`): `GET/POST /companies/:id/routines`, `GET/PATCH /routines/:id`, `GET /routines/:id/revisions`, `POST /routines/:id/revisions/:rev/restore`, `GET /routines/:id/runs?limit=`, `POST /routines/:id/triggers`, `PATCH/DELETE /routine-triggers/:id`, `POST /routine-triggers/:id/rotate-secret`, `POST /routines/:id/run`.

Çalışma geçmişi: sade kabukta Çalışmalar bölümü, `originKind: "routine_execution"` ile filtrelenmiş görev listesidir; Denetim ekranında da rutine göre filtrelenmiş bir çalışma listesi vardır (`ui/src/pages/audit/AuditRuns.tsx:49-127`). Rutin çalışmasının durumları: `received | coalesced | skipped | issue_created | completed | failed` (`packages/shared/src/constants.ts:657-665`).

### 9.4 Çalışma alanları (kısaca)

Bayrak: `enableIsolatedWorkspaces` (varsayılan kapalı). `ui/src/pages/Workspaces.tsx` (178 satır) yürütme çalışma alanlarını projeye göre gruplanmış olarak listeler; bir özet alanı kartı ve "load more" düğmesi vardır. Ayrıntı sayfasının sekmeleri: Görevler, Servisler, Yapılandırma, Çalışma ortamı kayıtları, Rutinler (`ui/src/pages/ExecutionWorkspaceDetail.tsx:86-90`). Bunlar, komut satırı kodlama ajanları için git worktree'leri ve çalışma ortamı servisleridir.

---

## 10. Skill'ler, gizli anahtarlar, bağlantılar ve araçlar, eklentiler

### 10.1 Skill'ler

Üç ekran vardır: mağaza / kitaplık (`ui/src/pages/CompanySkills.tsx`, 5702 satır; eski sürümü `CompanySkills.production.tsx`), kaynaklar sayfası (`ui/src/pages/SkillSources.tsx`, 224 satır) ve Skill Studio (`ui/src/pages/SkillStudio.tsx`, 3614 satır). Ana çizim yollarını okudum, geri kalanın ana hatlarını çıkardım.

Skill, giriş noktası `SKILL.md` olan bir dosya klasörüdür; sürümlenir ve ajanlara eklenebilir.

Mağaza ızgarası (`DiscoveryGrid`, `ui/src/pages/CompanySkills.tsx:1038-1498`):

- İki görünüm: `installed` ve `discover` (`:565`); başlıkları "Installed skills" / "Discover skills" (`:1137-1140`).
- Araç çubuğu: arama, bir "Sort" açılır menüsü (en çok ajan, en çok yıldız, en çok çatal, son güncellenen, alfabetik; `:594-602`), birden fazla kaynak olduğunda görünen bir "Source" açılır menüsü, proje çalışma alanlarını skill bulmak için tarayan bir yenileme simgesi ve birincil "New" menüsü: yeni skill oluştur, skill keşfet, GitHub'dan içe aktar, kaynakları yönet, yoldan ya da adresten içe aktar, projeden skill içe aktar (`:1304-1332`).
- Izgara: `grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]` (`:1475`).
- Eski kabuk solda bir kategori sütunu ve bir klasör sütunu ekler; sade kabuk yalnızca aramaya dayanır (`showBrowseRails`, `:4122`, `:1212-1232`).
- Boş ekran metinleri: üç eylemle birlikte "No installed skills yet. Discover a skill or create one.", "No skills are available to discover yet." ve "Clear filters" düğmesiyle birlikte "No skills match your filters." (`:1427-1467`).

Skill kartı (`SkillCard`, `:815-992`): `group flex h-full min-h-(--sz-11_5rem) flex-col rounded-lg border border-border bg-card p-4 text-left cursor-pointer transition-colors hover:border-foreground/20 hover:shadow-md` (`:863`). İçerik: simge, eş aralıklı yazıyla ad, "by {author} · {version}", yeri her zaman ayrılan iki satırlık açıklama (`:933`), kurulu olmayı etkin olmaktan ayıran bir durum satırı ("Enabled for N agents" / "Not enabled for any agents" / "Available to install", `:946-950`), yıldız ve çatal sayıları ve rozetler (Kurulu, kaynak, en çok iki kategori, kilit simgesiyle Bundled ya da Optional).

Kart modeli kurulu skill'lerle kataloğu birleştirir; aynı skill ikisinde de varsa kurulu olan kullanılır (`buildDiscoveryCards`, `:671-756`).

Skill ayrıntısı (`SkillDetailPage`, `:2861-3700`):

- Başlık: simge, ad, "Installed from {source}" ipucunu taşıyan bir kaynak simgesi, "by {author}", dört satırla sınırlanmış ve "View all" bağlantısı olan bir açıklama, kategori etiketleri; sağda "Open in Studio" ve kurulum sayısını (skill'in ekli olduğu ajanlar), Yıldızla ve Çatalla / "Make a copy" eylemlerini gösteren bitişik bir düğme grubu (`:3300-3412`).
- Sekmeler: Genel bakış, Dosyalar, Sürümler, Ajanlar (`:2576`, `:3418-3431`).
- Sağ sütun: kaynağın kökeni, Taşı eylemiyle klasör konumu, bir etiket düzenleyicisi, ekleme açılır menüsü ve en çok üç ekli ajanı gösteren bir Ajanlar bloğu (`:3447-3489`), Kaynak ve GitHub kaynaklı skill'lerde sabitlenmiş sürümü, "Check for updates" ve "Install update" düğmelerini içeren bir Güncellemeler bloğu (`:3549-3576`). Ayarlar (paylaşım kapsamı ve tehlikeli işlemler bölümü) bir dişli simgesinin arkasındadır ve bir pencerede açılır.
- Bir ajan kullandığı sürece skill kaldırılamaz: "Detach this skill from all agents to enable removal." (`:5239-5243`).

Kaynaklar (`ui/src/pages/SkillSources.tsx`): "Skill sources: Import skills from GitHub and refresh them when you're ready." Bağlı depoların listesi, her deponun kurulu skill'leri ve kaynak başına bir menü (Yenile, Skill seç, Kaynağın bağlantısını kes) (`:44-97`). İçe aktarma penceresi, kullanıcının GitHub bağlantılarından bir depo (ya da herkese açık bir adres) seçtirir, tarama sonuçlarını NDJSON akışıyla ve canlı ilerleme bilgisiyle alır (`ui/src/api/skillSources.ts`, `discoverStream`), skill seçmek için bir ağaç gösterir ve içe aktarır. Taslak, GitHub bağlanma adımlarına gidip dönülürken `sessionStorage` sayesinde korunur (`ui/src/pages/SkillSources.tsx:103-125`).

Skill Studio (`ui/src/pages/SkillStudio.tsx`): bir skill'i denemek için üç bölmeli bir deneme alanıdır; boyutu ayarlanabilen ve boyutları saklanan panellerden kuruludur (`:1064-1090`, `PANE_STORAGE_KEY` `:181` satırında); 900px'ten dar ekranlarda üç sekmeye dönüşür: Skill / Girdi / Çalışmalar (`:183`, `:3599-3601`).

- Solda: skill'in dosyaları ve düzenleyici. Ortada: kayıtlı test girdileri ya da o an yapıştırılan bir metin. Sağda: ajan seçici ve Çalıştır düğmesiyle "Test runs" (`:2508-2535`).
- Çalıştır düğmesi neden devre dışı olduğunu söyler; her seferinde tek bir neden gösterir: "This skill has no files to test", "Pick an agent to run", "Add or paste input text to run", "Save skill edits before running", "A run is already in progress" (`ui/src/lib/skill-studio.ts:126-146`).
- Bir çalışma, seçilen ajan için gerçek bir test görevi oluşturur; çalışma görünümünde durum rozeti, ajan, sabitlenmiş skill sürümü, maliyet, "Output snapshot" (ya da "Draft at failure"), belgeler, dosya ekleri, etkileşimler ve Yeniden çalıştır / İptal / Sil / "Open test task" eylemleri bulunur (`ui/src/pages/SkillStudio.tsx:3121-3264`). Çalışmalar sürerken 2 saniyede bir yoklanır (`:184`, `:2384-2387`).
- Başlıkta sürüm, "Unsaved edits", "Read-only", çatalın kökeni ve "Version history" görünür (`:1150-1193`).

Uç noktalar (`ui/src/api/companySkills.ts:52-254`): `/companies/:id/skills` (listeleme, oluşturma), `.../skills/:skillId` (ayrıntı, güncelleme, silme), `/versions`, `/files`, `/star`, `/fork`, `/comments`, `/update-status`, `/install-update`, `/test-inputs`, `/test-runs`, `/companies/:id/skills/test-run-templates`, `/companies/:id/skills/import`, `/scan-projects` ve genel katalog `/skills/catalog`.

### 10.2 Gizli anahtarlar (`ui/src/pages/Secrets.tsx`, 4846 satır)

Yol: `company/settings/secrets`; `company.secrets` gizli ayarına bağlıdır.

- Anahtar simgeli sayfa başlığı, ardından sekmeler: Gizli anahtarlar, Benim gizli anahtarlarım, Sağlayıcı kasaları, Öneriler (sarı bir sayı rozetiyle) (`:1819-1848`). Son ikisi gizlenebilir.
- En üstte kısa bir "nasıl kullanılır" kutusu: "Use secrets by binding them to runtime environment variables." Kutu, değerin çalışma başlarken sunucuda çözüldüğünü ve o ortam değişkeni olarak verildiğini, aynı anahtarlarda proje ortam değişkenlerinin ajanınkilerin yerine geçtiğini açıklar (`:3269-3287`).
- Araç çubuğu: arama ("Search by name, key, ref"), bir filtre açılır menüsü (durum, sağlayıcı, değeri kimin verdiği), Klasörler / Düz görünüm seçici, "Import from vault", "New folder", "New secret" (`:1852-1922`).
- Liste: kapsayıcı genişliği 40rem'in üstündeyken Gizli anahtar, Durum, "Version / coverage", Güncellenme ve Eylemler sütunlu bir tablo (`:2022-2037`), altındayken üst üste dizilmiş kartlar (`:2127`). Klasörler, adlardaki `/` ayracından türetilir.
- Boş ekran: "No secrets yet. Create a shared organization secret or one that each user supplies." (`:1975-1980`).

İki tür gizli anahtar vardır; tür, oluşturma penceresindeki "Who provides the value?" sorusuyla seçilir (`:2588-2615`):

| Tür | Anlamı | Kaynak |
|---|---|---|
| Organizasyon | tek bir ortak değer. Alt modlar: "Managed value" (Paperclip saklar; yer tutucu "Stored once, never re-displayed") ya da "External reference" (bir sağlayıcı kasasındaki ARN ya da yol) | `:2618-2724` |
| Her kullanıcı | her üye kendi değerini "My secrets" altında girer; "Agents resolve the responsible user's value at runtime." (ajanlar çalışma sırasında adına çalışılan kişinin değerini kullanır). Bir kapsama göstergesi kaç üyenin değer girdiğini gösterir. | `:2725-2746`, `:2105-2113` |

Diğer bilgiler: anahtar addan üretilir ve Düzenle'ye basılmadıkça kilitlidir (`:2748-2789`); sağlayıcılar `local_encrypted`, `aws_secrets_manager`, `gcp_secret_manager`, `vault` (`packages/shared/src/constants.ts:706-711`); durumlar `active | disabled | archived | deleted` (`:732`); satır eylemleri Yenile (Rotate), Devre dışı bırak/Etkinleştir, Arşivle/Arşivden çıkar, Sil (`ui/src/pages/Secrets.tsx:1545-1580`); yenileme "Write new value" ya da "Change reference" biçiminde yapılır (`:3087-3088`). Ayrıntı panelinde Ayrıntılar, Kullanım ve Olaylar sekmeleri ile gizli anahtara hangi ajanların başvurduğunu listeleyen bir "Agent access" bölümü bulunur (`SecretDetailsTab` `:4628`, `SecretUsageTab` `:4697`, `SecretEventsTab` `:4768`, `AgentAccessSection` `:4379`, başlık `:4506` satırında).

Öneriler sekmesi (`ui/src/pages/secrets/ProposalsTab.tsx`): ajanlar yeni bir gizli anahtar ya da bir gizli anahtarın bir ajanın ortam değişkenine bağlanmasını önerebilir; bir insan onaylar ya da reddeder. Değer hiçbir zaman gösterilmez, yalnızca SHA-256 parmak izi ve uzunluğu görünür; her satırda öneren, önerinin çıktığı görev, son geçerlilik zamanı ve ajanın gerekçesi yer alır; gerekçe "framed as an untrusted claim" biçiminde, yani güvenilmeyen bir iddia olarak sunulur (`:124-125`, `:195-198`). Boş ekran: "No pending proposals".

Uç noktalar (`ui/src/api/secrets.ts:151-251`): `/companies/:id/secrets`, `/secrets/:id` (patch, delete), `/secrets/:id/rotate`, `/secrets/:id/usage`, `/secrets/:id/access-events`, `/companies/:id/secret-providers`, `/companies/:id/secret-provider-configs`, `/companies/:id/user-secret-definitions`, `/companies/:id/me/user-secrets`, `/companies/:id/secrets/remote-import` ve öneri uç noktaları.

### 10.3 Bağlantılar ("Connectors") ve araç kuralları

Bu bölüm, Paperclip'in "bir ajan hangi dış eylemleri yapabilir, hangileri için insan gerekir" sorusuna verdiği yanıttır.

Karşılama sayfası `/apps` (`ui/src/pages/apps/Browse.tsx`): bir arama kutusu ("Search connectors...", `:677`) ve `ConnectorCard` kartlarından oluşan bir liste; her kart `overflow-hidden rounded-xl border border-border` sınıflıdır ve logo, ad, açıklama ile Bağlan ya da Ekle düğmesini içerir (`:788-830`). Bağlayıcının altında, bağlı her hesap için bir satır bulunur: durum simgesi, hesap adı, "Connected by", Yeniden bağlan / "Finish setup" ve İzinler ile "Remove connection" seçeneklerini içeren bir menü (`:960-1050`). Son kart "Connect your own tool" seçeneğini sunar (özel MCP sunucusu, `:1098-1117`).

Bağlanma (`ui/src/features/connections/ConnectionSetupFlow.tsx`, 4564 satır; adımlar `gallery | key | success`). Önemli olan adım, kenarlıklı tek bir panelde iki soru sorar (`:4163-4333`):

1. "Which humans can use this credential?" (bu kimlik bilgisini hangi insanlar kullanabilir): tek seçimli kartlar "Just me", "A dedicated account for an agent", "Any human in the organization". Kullanıcının kimlik bilgisi paylaşma izni yoksa sonuncusu, nedeni belirtilerek devre dışı bırakılır (`:4218-4252`).
2. "Which agents can use this connection?" (bu bağlantıyı hangi ajanlar kullanabilir): "Just agents I pick" (ardından çoklu ajan seçimi) ya da "Any agent"; ikincisi, bağlantıyı yapılandıramayan kişiler için nedeni belirtilerek devre dışıdır (`:4281-4332`).

Bunlar şu kimlik bilgisi kurallarına karşılık gelir: `per_user` (kişisel), `per_agent` (ajana ayrılmış) ve shared (organizasyon) (`ui/src/pages/apps/connection-identity.ts:18-28`). GitHub için metinler, ajanın kimin kimliğiyle işlem yaptığını açıkça söyler; örneğin "Agents use it only for runs where you are the responsible person." (`ui/src/features/connections/ConnectionSetupFlow.tsx:4223`).

Uygulama ayrıntısı (`ui/src/pages/apps/AppDetail.tsx`); sekmeleri İzinler (Permissions) ve İnceleme (Review) (`ui/src/pages/apps/app-tabs.ts:3-6`). İzinler paneli (`ui/src/pages/apps/app-detail/PermissionsPanel.tsx`, 576 satır) iki parçadan oluşur:

- "Which agents can use this connection?" (`:125-179`); yukarıdaki iki seçeneğin aynısı.
- "Actions": bir arama kutusu, Tümü / Okuma / Yazma (All / Read / Write) filtre etiketleri, "Set all: ..." seçimi olan gruplar (`:417`) ve her eylem için üç durumlu bir seçici taşıyan birer satır:

```ts
// ui/src/pages/apps/app-detail/PermissionsPanel.tsx:448-450
{ value: "off",     label: "Off",       description: "Agents cannot run this action.",   icon: Ban },
{ value: "ask",     label: "Ask first", description: "A human must approve each call.",  icon: ShieldQuestion },
{ value: "allowed", label: "Allowed",   description: "Runs without approval.",           icon: Check },
```

Seçici, `inline-flex rounded-md border border-border bg-muted/40 p-0.5` sınıflı bir kutudur; içinde bir radiogroup olarak üç simge düğmesi bulunur (`:513`). Her satırda ayrıca bir risk etiketi ve "Test" düğmesi vardır; "Refresh actions" (`:264`) ve yeni keşfedilen eylemler için bir inceleme adımı da bulunur; bu eylemler incelenene kadar karantinada kalır.

Kaydetme, bütün durumu tek çağrıda gönderir: `toolsApi.finishApp(companyId, connectionId, {enabledCatalogEntryIds, askFirstCatalogEntryIds, reviewedCatalogEntryIds?, access: "all_agents" | {agentIds}})`; bu çağrı `POST /companies/:id/tools/apps/:connectionId/finish` isteğidir (`ui/src/pages/apps/AppDetail.tsx:279-281`).

"Ask first" inceleme kuyruğu (`ui/src/pages/apps/ReviewQueueCard.tsx`, sayfa `ui/src/pages/apps/AppsReview.tsx:35-37`, "Actions your agents want to run that need your OK first."):

- Bekleyen `tool_action_requests` kayıtlarını listeler; 20 saniyede bir yenilenir (`:44`).
- Her kartta: eylem etiketi, uygulama, "asked {timeAgo}" (`:183`), yapılacak işin markdown ön izlemesi (`previewMarkdown`, `:172`) ve üç düğme: "Allow once", "Always allow", "Decline" (`:200-208`).
- "Always allow" bir güven kuralı oluşturur; böylece bu bağlantıdaki aynı eylem için bir daha sorulmaz. Kart kapsamı da yazar: "lets this agent use this action with different arguments on this connection, within the current project when present" (bu ajanın bu eylemi bu bağlantıda farklı argümanlarla, varsa o anki proje içinde kullanmasına izin verir; `:196`).
- Uç noktalar: `GET /companies/:id/tools/action-requests?status=pending`, `POST /tool-gateway/action-requests/:id/approve {companyId, rememberAction}`, `.../decline {companyId, reason}`, `POST /companies/:id/tools/action-requests/:id/trust-rule` (`ui/src/api/tools.ts:529-542`).
- İstek kaydında `invocationId`, `issueId`, `approvalId`, argümanların kurallı biçiminden alınan özet değeri (hash) ve özeti, `previewMarkdown`, isteyen ve karara bağlayan kişi ile `expiresAt` bulunur (`packages/shared/src/types/tool-access.ts:1295-1318`).

Gelişmiş alan `/apps/advanced` (yalnızca yöneticiler; `ui/src/pages/tools/AdvancedToolsRoute.tsx:30-54` diğer kullanıcılara dostça bir "Advanced setup is for administrators" kartı gösterir):

| Sekme | İçerik | Kaynak |
|---|---|---|
| Yapılandırma yapıştır (Paste a config) | galeride olmayan bir aracı bağlamak için MCP JSON yapılandırması yapıştırılır | `ui/src/pages/tools/tool-tabs.ts:22-24`, `ui/src/pages/tools/ToolsAccess.tsx:82-131` |
| Geçitler (Gateways) | "Named MCP gateways: Stable endpoints for external clients that use the same profiles, rules, and audit trail as agent tool access." (dış istemciler için, ajanların araç erişimiyle aynı profilleri, kuralları ve iz kaydını kullanan sabit uç noktalar); token'larla birlikte | `ui/src/pages/tools/GatewaysTab.tsx:266-267` |
| Profiller (Profiles) | erişim profilleri, aşağıda | `ui/src/pages/tools/profiles/ProfilesIndex.tsx` |
| Smoke Lab | geliştirici test düzenekleri, `enableSmokeLab` bayrağı | `ui/src/pages/tools/tool-tabs.ts:30-34` |

Erişim profilleri (`ui/src/pages/tools/profiles/`): "Decide which tools your agents can use. Build a profile once, then assign it to the agents that need it." (ajanların hangi araçları kullanabileceği burada belirlenir; profil bir kez kurulur, sonra gereken ajanlara atanır; `ProfilesIndex.tsx:124-125`).

- Liste sayfası: Etkin / Arşivlenmiş seçici, satır menüsü (Düzenle, Çoğalt, Arşivle ya da Geri yükle, Sil) olan bir tablo (Profil, İzin verdikleri, Atandığı yer, Durum, Güncellenme) ve bir ajanın tam olarak hangi araçları kullanabildiğini, her birine hangi profilin izin verdiğini hesaplayıp gösteren "Check an agent's access" paneli (`ProfilesIndex.tsx:122-155`, `:206-302`).
- Boş ekran, beş başlangıç noktası sunan bir şablon seçicidir: salt okunur, günlük iş, tam erişim, sıfırdan başla, var olan bir profili kopyala (`profile-model.ts:370-376`).
- Sihirbaz üç adımlıdır: Ad, Araç seçimi, Atama (`ProfileWizard.tsx:40-43`). "Choose tools" adımı, üç durumlu onay kutuları olan bir uygulama ağacıdır; uygulama düzeyindeki işaret "all tools, including tools the app adds later" (uygulamanın sonradan ekleyecekleri dâhil bütün araçlar) anlamına gelir, tek tek araçlardan kaldırılan işaretler hariç tutma kaydına dönüşür (`profile-model.ts:89-93`, `:149-180`, `WizardToolsStep.tsx:204-212`). Yetenek etiketleri: salt okunur, değişiklik yapar, yıkıcı (`profile-model.ts:33-37`).
- "New tools that appear later": "Stay blocked until someone allows them" (önerilen) ya da "Allowed automatically" (riskli olarak işaretli) (`WizardToolsStep.tsx:258-270`).
- Gelişmiş kurallar: araç adı desenine (örneğin `gmail.send*`), risk düzeyine ya da araç kimliğine göre izin verme ya da engelleme (`WizardToolsStep.tsx:304-321`, `:419`).
- Atama: "Make this the organization default", ajanlar ve isteğe bağlı olarak bütün projeler ya da rutinler. "If an agent has several profiles, it can use anything any of them allows." (bir ajanın birden çok profili varsa herhangi birinin izin verdiği her şeyi kullanabilir; `ProfileWizard.tsx:605-669`).

Sunucu tarafındaki araç kuralı sözcükleri: kural türleri `allow | block | require_approval | trust_rule | rate_limit`; kararlar `allow | deny | require_approval | rate_limited | defer_runtime`; risk düzeyleri `low | medium | high | critical | read | write | destructive` (`packages/shared/src/constants.ts:1071`, `:1141-1151`).

### 10.4 Eklentiler

Eklenti yöneticisi (Plugin Manager; `ui/src/pages/PluginManager.tsx`, 569 satır), yolu `company/settings/instance/plugins`:

- "Plugin Manager" başlığı ve npm paket adı alan "Install Plugin" penceresi (`:196-234`).
- Sarı bir "Plugins are alpha." uyarısı (`:237-247`).
- "Available Plugins" (ürünle gelenler; First-party / Example ve Experimental rozetleri, Kur ya da Etkinleştir / Ayarları aç düğmeleri) (`:249-352`).
- "Installed Plugins": ad, paket ve sürüm, açıklama, durum rozeti, bir güç düğmesi (etkinleştir / devre dışı bırak), onay isteyen bir kaldırma düğmesi, "Configure" ve "View full error" bağlantılı satır içi hata kutusu (`:354-496`). Boş ekran: "No plugins installed" (`:360-369`).

Eklenti ayarları (Plugin Settings; `ui/src/pages/PluginSettings.tsx`, 1233 satır): Yapılandırma ve Durum sekmeleri (`:186-195`). Yapılandırma sekmesi önce Hakkında bölümünü, sonra şunlardan birini gösterir: eklentinin kendi ayar arayüzü yuvası, eklentinin JSON yapılandırma şemasından üretilen bir form ya da Ortamlar sayfasına bir yönlendirme (`:231-284`). Durum sekmesi bir çalışma ortamı özeti (Runtime Dashboard: worker süreci, son iş çalışmaları, son webhook teslimleri), son kayıtlar, sağlık denetimleri, ayrıntılar ve istenen izinlerin listesini gösterir (`:288-577`).

Eklenti arayüzünün bağlanması (`ui/src/plugins/slots.tsx:1-20`): eklenti arayüz modülleri, `/_plugins/:pluginId/ui/:entryFile` adresinden dinamik `import()` ile yüklenen ES modülleridir; her biri manifestte listelenen adlandırılmış React bileşenlerini dışa aktarır ve her biri bir hata sınırıyla (error boundary) sarılır. Yuva türleri (`packages/shared/src/constants.ts:1475-1493`): `page`, `detailTab`, `taskDetailView`, `dashboardWidget`, `sidebar`, `routeSidebar`, `sidebarPanel`, `projectSidebarItem`, `globalToolbarButton`, `appShellOverlay`, `organizationSwitcher`, `toolbarButton`, `contextMenuItem`, `commentAnnotation`, `commentContextMenuItem`, `settingsPage`, `companySettingsPage`.

Eklenti sayfası (Plugin Page; `ui/src/pages/PluginPage.tsx`, 225 satır), bir eklentinin `page` yuvasını `/:companyPrefix/plugins/:pluginId` adresinde ya da eklentinin bildirdiği bir yolda çizer; iki eklenti aynı yolu isterse açık bir çakışma mesajı gösterilir (`:142-152`); sayfa yuvası olmayan eklenti kendi ayarlarına yönlendirilir (`:155-164`).

Eklenti durumları: `installed | ready | disabled | error | upgrade_pending | uninstalled`; bir eklenti `issues.read`, `approvals.read`, `costs.read` gibi adlandırılmış yetenekler bildirir (`packages/shared/src/constants.ts:1288-1350`). Uç noktalar: `/plugins`, `/plugins/examples`, `/plugins/install`, `/plugins/:id/{enable,disable,health,dashboard,upgrade,config,config/test}`, `/plugins/ui-contributions` (`ui/src/api/plugins.ts:217-389`).

---

## 11. Şirket ve kurulum yönetimi

### 11.1 Şirketler ve şirket menüsü

Organizasyonlar sayfası (`ui/src/pages/Companies.tsx`, 327 satır): "New Organization" düğmesi (bulutta gizli), ardından kartlardan oluşan bir `grid gap-4`. Kartta (`interactive`, `p-5`; seçiliyken `border-primary ring-1 ring-primary` eklenir) ad, durum rozeti (etkin yeşil, duraklatılmış sarı, diğerleri soluk), yerinde yeniden adlandırma kalemi, üç nokta menüsü (Yeniden adlandır, arşivlenmişler için Arşivden çıkar, "Delete Organization") ve bir istatistik satırı bulunur: ajanlar, görevler, aylık bütçeye göre harcama (yüzdeyle ya da "Unlimited budget" metniyle), oluşturulma zamanı (`:126-290`). Silme, sayfa içinde şunu sorar: "Delete this organization and all its data? This cannot be undone." (`:293-320`). Uç noktalar: `GET /companies`, `GET /companies/stats`, `PATCH /companies/:id`, `DELETE /companies/:id`, `POST /companies/:id/archive` (`ui/src/api/companies.ts:83-119`).

Şirket menüsü (sade kabuk, `ui/src/components/SidebarCompanyMenu.tsx`, 412 satır): kenar çubuğunun en üstünde, şirket simgesini ve kalın yazılmış adını `ChevronsUpDown` simgesiyle gösteren çerçevesiz (ghost) bir düğme (`:258-292`). Tıklanınca şunları içeren bir açılır menü açılır:

- "Organizations" başlığı ve tutamaçla sürükleyerek sıralamayı açan Düzenle / Bitti (Edit / Done) düğmesi (`:299-335`); sıra kullanıcıya özel saklanır (`useCompanyOrder`);
- arşivlenmemiş her şirket için bir satır: simge, ad, şirket kodu ve o an seçili olanın yanında bir onay işareti (`:92-143`);
- eylemler: "Create organization" (bulutta yok), "Invite people to {company}", "Sign out" (`:360-408`).

Bir şirket seçilince seçim `localStorage` içinde `paperclip.selectedCompanyId` anahtarıyla saklanır (`ui/src/context/CompanyContext.tsx:48`); o anki yol başka bir şirkete aitse seçilen şirketin Genel bakış ekranına gidilir (`ui/src/components/SidebarCompanyMenu.tsx:214-228`). Liste isteği başarısız olursa "No organizations" yerine "Couldn't load organizations" metni ve "Try again" düğmesi gösterilir (`:341-357`).

Logo yoksa şirket simgesi addan üretilir: bir özet değeri (hash), küçük bir sözde rastgele sayı üreteci ve 4x4 Bayer titreme (dither) matrisi kullanan, tohum değerinden üretilen bir desen (`ui/src/components/CompanyPatternIcon.tsx:4-36`). Eski şirket menüsü (`ui/src/components/CompanySwitcher.tsx`) daha basit bir açılır menüdür; her şirket için bir durum noktası ile Ayarlar ve "Manage Organizations" bağlantılarını içerir.

Şirketler arası bir görünüm yoktur. Her yönetim kurulu sayfası tam olarak tek bir seçili şirket üzerinde çalışır.

### 11.2 Şirket ayarları (`ui/src/pages/CompanySettings.tsx`, 418 satır)

Ayarlar kendi kenar çubuğuyla açılır; en üstte "Back to app" durur (`ui/src/components/CompanySettingsSidebar.tsx:91-98`). Satırlar: Genel, Profil, Üyeler (rozet: bekleyen katılma istekleri), eklentilerin eklediği ayar sayfaları, Gizli anahtarlar, Ortamlar, Erişim, Dışa aktarma, İçe aktarma (bulutta yok), Deneysel, Eklentiler (altında kurulu eklentilerin listesiyle), Adaptörler (`:105-200`).

Genel sayfası, küçük, büyük harfli etiketlerle bölümlere ayrılmış tek ve uzun bir formdur:

| Bölüm | İçerik | Kaynak |
|---|---|---|
| Genel | Organizasyon adı, Açıklama | `:223-255` |
| Görünüm | desen simgesi ön izlemesi ve logo yükleme (PNG, JPEG, WEBP, GIF, SVG), "Remove logo" | `:258-316` |
| (kaydetme) | yalnızca ad ya da açıklama değiştiğinde görünen "Save changes" düğmesi | `:319-339` |
| İşe alma | "Require board approval for new hires" | `:342-355` |
| Etkileşim yönetişimi | her etkileşim türü için bir "Default policy" ve bir "Cap" | `:358-369` |
| kurulumun genel ayarları | gömülü (bölüm 11.5) | `:371` |
| Tehlikeli işlemler (Danger Zone) | tarayıcının onay penceresiyle "Archive organization" | `:374-415` |

Etkileşim yönetişimi (`ui/src/components/InteractionGovernancePanel.tsx`, 307 satır), altı tür için üç sütunlu bir ızgaradır (Tür, Varsayılan kural, Üst sınır); türler: görev önerisi, kullanıcıya soru, onay isteği, işaretli onay, kalem kalem karar, bağlantı isteği (`:19-26`, `:263-299`). Varsayılan açıktır ("Anyone"; soruyu soran ajan da dâhil); daraltan iki seçenek "not creator" ve "human only" seçenekleridir (`:45-48`). Her seçenek sonucunu seçim satırının içinde gösterir; örneğin "New cards wait for a person on the board. Agents are turned away." (`:60-70`). Panel metni, araç eylemi onaylarının her zaman yalnızca insana açık kaldığını söyler (`:245-255`).

### 11.3 Üyeler, davetler ve katılma istekleri

Üyeler (`ui/src/pages/CompanyAccess.tsx`, 726 satır), sekmeleri Üyeler ve Davetler (`:295-306`):

- "Pending human joins" bloğu; her istek için onayla / reddet düğmeleri vardır ve onaylama yetkisi olanlara gösterilir (`:316-358`).
- Bir tablo: Ad (avatar ve ad), E-posta, Rol, Durum, Eylem (Düzenle, Çıkar) (`:360-433`).
- Düzenleme penceresi: rol (sahip, yönetici, operatör, görüntüleyici ya da atanmamış) ve durum (etkin, bekliyor, askıya alınmış) (`:436-500`).
- Çıkarma penceresi: kişinin kaç açık görevi olduğunu gösterir ve üyeliği arşivlemeden önce bu görevleri başka bir insana ya da bir ajana atamayı ya da atanmamış bırakmayı önerir (`:502-586`).

Davetler (`ui/src/components/access/InvitesSection.tsx`, 383 satır): rol, dört tek seçimli satırdan seçilir; her satırda bir açıklama ve rolün neler kazandırdığı yazar (`:14-39`). "Create invite" tek kullanımlık bir bağlantı döndürür; bağlantı panoya kopyalanır ve salt okunur bir alanda gösterilir. "Invite history" tablosu (Durum, Kimin için, Davet eden, Oluşturulma, Katılma isteği, İptal et seçeneğiyle Eylem) "View more" ile sayfalanır (`:279-369`).

| Rol | "Gets" metni |
|---|---|
| Görüntüleyici (Viewer) | Yalnızca görüntüleme yetkisi veren organizasyon üyeliği. |
| Operatör (Operator, varsayılan) | Görev atayabilir. |
| Yönetici (Admin) | Ajan oluşturabilir, kullanıcı davet edebilir, görev atayabilir ve katılma isteklerini onaylayabilir. |
| Sahip (Owner) | Yöneticideki her şey, ayrıca üyeleri yönetme. |

Katılma isteği kuyruğu (`ui/src/pages/JoinRequestQueue.tsx`, 195 satır; yolu `inbox/requests`, `ui/src/App.tsx:432`): filtreler Durum (onay bekliyor, onaylandı, reddedildi) ve İstek türü (tümü, insan, ajan); her istek için rozetleri, isteyeni, davet bağlamını, kaynak IP adresini ve Onayla / Reddet düğmelerini gösteren bir kart (`ui/src/pages/JoinRequestQueue.tsx:89-190`).

Uç noktalar (`ui/src/api/access.ts:272-417`): `POST /companies/:id/invites`, `GET /invites/:token`, `POST /invites/:token/accept`, `POST /invites/:id/revoke`, `GET /companies/:id/members`, `PATCH /companies/:id/members/:memberId`, `POST .../members/:memberId/archive`, `GET /companies/:id/join-requests`, `POST .../join-requests/:id/{approve,reject}`.

### 11.4 Kurulum erişimi, profil, kullanıcı profili

Kurulum erişimi (Instance Access; `ui/src/pages/InstanceAccess.tsx`, 267 satır): iki sütunlu bir sayfa. Solda: kullanıcı arama ve kullanıcı listesi (kalkan simgesi kurulum yöneticilerini işaretler; yanında etkin üyelik sayısı yazar). Sağda: seçili kullanıcı, "Promote to instance admin" / "Remove instance admin" düğmeleri, organizasyonların onay kutulu ızgarası ("New access defaults to an active operator membership."), "Save organization access" ve mevcut üyeliklerin listesi (`:130-263`). Uç noktalar: `/admin/users?query=`, `/admin/users/:id/promote-instance-admin`, `/demote-instance-admin`, `/admin/users/:id/company-access` (`ui/src/api/access.ts:402-414`).

Profil ayarları (`ui/src/pages/ProfileSettings.tsx`, 277 satır): avatar yükleme kartı (süs amaçlı, renk geçişli bir zeminle), görünen ad, salt okunur e-posta, "Save profile" ve "Let agents tidy my inbox" ayarı (`ui/src/components/InboxAgentPolicyControl.tsx:125-147`).

Kullanıcı profili (`ui/src/pages/UserProfile.tsx`, 387 satır; yolu `u/:userSlug`, `ui/src/App.tsx:434`): kişiye özel bir etkinlik ve kullanım sayfası. Başlıkta avatar, ad, `@slug`, e-posta, rol ve durum; dört büyük sayı (tüm zamanların token sayısı, tamamlanan, atanmış açık görev, 7 günlük eylem) (`ui/src/pages/UserProfile.tsx:313-318`); her zaman penceresi için bir sütun: dokunulan, tamamlanan, yorumlar, eylemler, token, harcama (`:61-89`); günlük token sayısını tamamlanma işaretiyle gösteren 14 günlük bir çubuk grafik (`:100-156`); son görevler, son etkinlik, "Agent attribution" ve "Provider mix" listeleri (`:327-384`).

### 11.5 Kurulumun genel ayarları (`ui/src/pages/InstanceGeneralSettings.tsx`, 396 satır)

Bölümler; her birini operatör gizleyebilir (`:81-86`): mod rozeti ve üç durum kutusu (kimlik doğrulama hazırlığı, ilk kurulum durumu, ilk kurulum daveti) içeren "Deployment and auth" (`:122-155`); "Censor username in logs" aç/kapa düğmesi (`:157-176`); günlük, haftalık ve aylık saklama için hazır seçenek düğmeleri olan "Backup retention" (`:178-280`); "Always allow" / "Don't allow" seçenekli "AI feedback sharing" (`:282-357`); "Sign out" (`:361-384`).

Metinde anlatılan kurulum modları: `local_trusted` (giriş yoktur, tarayıcı istekleri yerel yönetim kurulu olarak çalışır), girişli özel (authenticated private; LAN / VPN) ve girişli herkese açık (authenticated public) (`:132-138`).

### 11.6 Deneysel bayrakların tamamı

Sayfa: `ui/src/pages/InstanceExperimentalSettings.tsx` (722 satır). Her bayrak için bir `Card` (`block bg-transparent p-5`): başlık, açıklama, isteğe bağlı dipnot ve bir aç/kapa düğmesi. Değişiklik sunucu beklenmeden ekrana yansır, hata olursa geri alınır (`:139-177`). En üstte sarı bir uyarı durur: "Experimental features may break at any time." (`:264-278`). Varsayılanlar `packages/shared/src/validators/instance.ts:41-90` içinden gelir ve `server/src/services/instance-settings.ts:220-309` içinde yeniden uygulanır.

"Experimental features" grubu:

| Bayrak | Başlık | Açıklama (sayfadan) | Varsayılan | Kaynak |
|---|---|---|---|---|
| `enableAgentChat` | Agent Chat | Her ajanla, süren tek bir konuşma içinde konuşulur. Hedefler netleştirilir ve yürütülecek görevler oluşturulur. | kapalı | `:296-306` |
| `enableBetaSkills` | Beta skills | Ajanların Paperclip çekirdek skill'inin beta sürümlerine sabitlenmesine izin verir. | kapalı | `:308-317` |
| `enableBuiltInAgents` | Built-in Agents | Paperclip'in yönettiği yerleşik ajanlarla ilgili ekranları gösterir: listedeki rozetler, yerleşik ajanlar sekmesi ve kurulum denetimleri. | kapalı | `:319-328` |
| `enableCases` | Cases | Görevlerin oluşturduğu ve üzerinde yinelediği kalıcı çıktılar. Cases sekmesini ve ajanlar için case API'sini ekler. | kapalı | `:330-340` |
| `enableChatConnectors` | Chat connectors | Ajanları Slack, GitHub, Discord, Microsoft Teams ve Telegram konuşmalarına bağlar. | kapalı | `:342-352` |
| `enableConferenceRoomChat` | Conference Room Chat | Kullanıcının ve bütün ekibinin birlikte çalıştığı tek bir sohbet ve canlı etkinlik akışı. Kart çizilmez (`SHOW_CONFERENCE_ROOM_EXPERIMENTAL_SETTING = false`). | kapalı | `:60`, `:354-365` |
| `enableDecisions` | Decisions | Ana kenar çubuğunda Decisions satırını gösterir; bu ekran, kullanıcıdan yanıt bekleyen görevleri öne çıkaran ana sayfadır. | kapalı | `:367-376` |
| `enableEnvironments` | Enable Environments | Şirket ayarlarında ortam yönetimini gösterir, projelere ve ajanlara ortam atanmasına izin verir. | kapalı | `:378-387` |
| `enableExternalObjects` | Enable External Objects | Görevlerdeki dış adresleri algılar; pull request, destek kaydı ve benzeri iş nesnelerinin çözümlenmiş durumunu gösterir. | kapalı | `:389-398` |
| `enableIsolatedWorkspaces` | Enable Isolated Workspaces | Proje yapılandırmasında yürütme çalışma alanı denetimlerini gösterir ve yalıtılmış çalışma alanı davranışına izin verir. | kapalı | `:400-409` |
| `enableExperimentalFileViewer` | Experimental File Viewer | Görev ayrıntısında çalışma alanı dosyalarına göz atma ve ön izleme denetimlerini gösterir. | kapalı | `:411-420` |
| `enableFirstTaskPlanProposal` | First task: propose with a plan document | İlk tek görevlik istekte chief of staff rolündeki ajan kısa bir plan belgesi ve işaretli onay kartı yazar. | kapalı | `:422-433` |
| `enableMemoryConnectors` | Memory connectors | Uzun süreli bellek ve bağlam için Mem0, Zep, Supermemory, Cognee ve Honcho bağlanır. | kapalı | `:435-445` |
| `enableNativeRunner` | Paperclip Runner | Yeni Codex ajanlarının Rust ile yazılmış deneysel Paperclip Runner'ı seçmesine izin verir. | açık | `:447-458` |
| `enableSimplifiedEnglishInteractions` | Simplified English Interactions | Ajanlara, kullanıcıya dönük etkileşimleri ASD-STE100 Simplified Technical English ile yazmaları talimatını verir. | kapalı | `:460-471` |
| `enableStatusCards` | Status Cards | Deneysel ortak durum kartı panosunu ve bayrağa bağlı API'sini açar. Açılınca Summaries da açılır. | kapalı | `:473-489` |
| `enableStreamlinedUi` | Streamlined UI | Sadeleştirilmiş ana kenar çubuğunu, Görevler ile Gelen kutusu için ortak gösterimi, odaklı görev ayrıntısı yerleşimini ve bağlama göre gezinmeyi kullanır. | açık | `:491-501` |
| `enableSummaries` | Summaries | Proje ve çalışma alanı sayfalarında Summarizer'ın ürettiği durum alanlarını gösterir. Kapatılınca Status Cards da kapanır. | kapalı | `:503-519` |
| `enableIsolatedWorkspacesByDefault` | Use Isolated Workspaces By Default | Kendi kuralı olmayan projeyi yalıtılmış sayar. Yalnızca yalıtılmış çalışma alanları açıkken gösterilir. | kapalı | `:521-534` |

"Paperclip Developer Mode" grubu ("Internal tools for developing, testing, and debugging Paperclip."):

| Bayrak | Başlık | Varsayılan | Kaynak |
|---|---|---|---|
| `autoRestartDevServerWhenIdle` | Auto-Restart Dev Server When Idle | kapalı | `:548-559` |
| `enableManagedSandboxOnly` | Managed Environment Only (yerel ortamı gizler ve bütün ajanları platformun yönettiği ortamda çalıştırır) | kapalı | `:561-572` |
| `enablePaperclipDeveloperMode` | Paperclip Developer Mode (bakımcı araçları ve gözlemlenebilirlik bağlantıları) | kapalı | `:574-585` |
| `enableWorktreeRunExecution` | Run tasks in this worktree (yalnızca git worktree ön izleme kurulumunda gösterilir; başka bir kurulumdan kopyalandığında kapalı sayılır) | kapalı | `:587-642` |
| `enableServerInfoDebugView` | Server Info Debug View | kapalı | `:644-655` |
| `enableSmokeLab` | Smoke Lab | kapalı | `:657-666` |
| `enableIssuePlanDecompositions` | Task Plan Decomposition | kapalı | `:668-679` |

"Legacy" grubu ("These features are going to be removed."):

| Bayrak | Başlık | Varsayılan | Kaynak |
|---|---|---|---|
| `enableClassicTaskInterface` | Classic Task Interface | kapalı | `:692-704` |
| `enableGoalsSidebarLink` | Goals Sidebar Link | kapalı | `:706-717` |

Şemada olup bu sayfada kartı olmayan bayraklar (`packages/shared/src/validators/instance.ts:47-87`): `enableStreamlinedLeftNavigation` (varsayılan açık), `enableApps` ve `enableMcpAggregators` (kullanımdan kalkmış uyumluluk anahtarları, zorunlu açık), `enablePipelines` (kapalı), `enableWorkspaceBranchReconcileForward` (açık), `enableWorkspaceDirtyQuarantineRepair` (açık), `enableOwnerInstanceAdmin` (kapalı), `enableSandboxDuplexBridge` (kapalı), `enableRunnerPreviewIngress` (kullanımdan kalkmış, kapalı).

### 11.7 Ortamlar, içe / dışa aktarma, adaptörler

Ortamlar (`ui/src/pages/CompanyEnvironments.tsx`, 2632 satır, `enableEnvironments` bayrağı): ajan çalışmalarının yürütüldüğü hedefler. Sürücüler `local | ssh | sandbox | plugin` (`packages/shared/src/constants.ts:577`). Formda Ad, Açıklama ve Sürücü alanları, ardından SSH alanları (sunucu, port, kullanıcı adı, uzak çalışma alanı yolu, özel anahtar, bilinen sunucular, sıkı sunucu anahtarı denetimi) ya da bir eklentinin sağladığı sandbox sağlayıcısı bulunur; ayrıca ortam değişkenleri, bir bağlantı sınaması ve silmenin neleri etkileyeceğini gösterip ajanları başka bir ortama atamayı öneren bir silme penceresi vardır (`ui/src/pages/CompanyEnvironments.tsx:2218-2565`). Claude API'yi doğrudan çağıran bir ürünle ilgisi yoktur.

Dışa aktarma (`ui/src/pages/CompanyExport.tsx`, 1303 satır): dosya ağacı ve ön izlemeden oluşan iki sütunlu bir sayfa. "What to include" onay kutuları: Ajanlar, Projeler, Skill'ler, Rutinler, Görevler, Dosya ekleri (`ui/src/lib/company-export-selection.ts:41-48`); yanında "Task and routine history is opt-in because it can be large." notu durur (görev ve rutin geçmişi büyük olabildiği için isteğe bağlıdır; `ui/src/pages/CompanyExport.tsx:1152-1192`). Bir aslına uygunluk raporu, paketin neleri taşımayacağını listeler (`ui/src/pages/CompanyExport.tsx:1127-1143`). Düğmede "Export N files" yazar. Uç noktalar: `POST /companies/:id/exports/preview`, `POST /companies/:id/exports`, `GET /companies/:id/export/fidelity` (`ui/src/api/companies.ts:124-132`).

İçe aktarma (`ui/src/pages/CompanyImport.tsx`, 2189 satır): kaynak "GitHub repo" (bir `COMPANY.md` dosyasının adresi) ya da "Local zip"; hedef "Create new organization" ya da var olan organizasyon; çakışma stratejisi yeniden adlandır / atla / değiştir (Rename / Skip / Replace); "Preview import" (`:1848-2000`). İçe aktarmadan sonra ajanlar ve rutinler duraklatılmış gelir; bir denetim listesiyle istenenler etkinleştirilir: "Activate imported agents and routines" (`:1746-1795`). Büyük yüklemeler parçalara bölünür ve kaldığı yerden sürdürülebilir; süren bir içe aktarmaya sayfa yenilendikten sonra yeniden bağlanılabilir (`:1817-1836`).

Adaptörler (`ui/src/pages/AdapterManager.tsx`, 690 satır): "External Adapters" (npm'den ya da yerel bir yoldan kurma, yeniden kurma, çalışırken yeniden yükleme, kaldırma; alfa uyarısı `:521` satırında) ve her biri için etkinleştirme / devre dışı bırakma düğmesi olan "Built-in Adapters" (`:404-646`). Uç noktalar: `/adapters`, `/adapters/install`, `/adapters/:type` (patch, delete), `/adapters/:type/{override,reload,reinstall}` (`ui/src/api/adapters.ts:66-89`).

---

## 12. İlk kurulum ve giriş

### 12.1 İlk kurulum sihirbazı (`ui/src/components/OnboardingWizard.tsx`, 3196 satır)

Uygulamanın tamamı için tek yerden, `OnboardingWizardVariant` üzerinden bağlanır (`ui/src/App.tsx:843`). Ekranın tamamını kaplayan bir katmandır (`fixed inset-0 z-50 bg-background`, `ui/src/components/OnboardingWizard.tsx:2392-2403`); ortasında `w-(--sz-560px) max-w-full px-8 py-10 sm:px-10 sm:py-11` sınıflı bir sütun bulunur (`:2443-2445`), kart çerçevesi yoktur. Başka bir dosya adı verilmedikçe bu alt bölümdeki satır numaraları `OnboardingWizard.tsx` dosyasına aittir.

Adımlar. Koddaki adım numaraları 1, 3, 4 ve 5'tir (misyon sorusu olan adım 2 kaldırılmıştır); ilerleme şeridi etiketli dört dilim gösterir (`ui/src/components/onboarding/Stepper.tsx:34-42`):

| Adım | Başlık | Kullanıcı ne yapar | Ne oluşturur | Kaynak |
|---|---|---|---|---|
| 1. Organizasyonun adı | "What is the name of your organization?" | tek alan, yer tutucu "e.g. Northwind Labs" | `POST /companies {name}`; hedef yazılmaz | `:2602-2622`, `:1979-2012` |
| 3. İlk ajanın oluşturulması | "Create your first agent" | tek alan "Agent name", yer tutucu "e.g. Chief of staff"; rol seçici yok | henüz hiçbir şey | `:2630-2659` |
| 4. Model bağlama | "Connect a model", giriş cümlesi "Paperclip works with your subscription or API keys." | bir model kaynağı kutusu seçilir (Claude Code, Codex), sonra abonelikle giriş yapılır ya da bir API anahtarı girilir / seçilir | anahtarı kullanıcı gizli anahtarı olarak saklar, bir ortam testi çalıştırır, sonra ajanı işe alır | `:2662-3056`, `:2018-2248` |
| 5. Gözden geçirme | "Let's get started..." | tek düğme "Get started" | varsayılan bir proje ve ilk görev; ardından o göreve gidilir | `:1696-1772` |

Önemli ayrıntılar:

- Her adımda başlığın üstünde bir karakter çizimi durur. Ajan tanımlanırken gridir ve uyuklar, gözden geçirme adımında "uyanır" (`:2536-2539`).
- İşe alma `agentsApi.hire(companyId, {name, appearance, role, adapterType, adapterConfig, onboardingFirstAgent: true, runtimeConfig})` çağrısıyla yapılır (`:2196-2210`). Bu işaret, sunucunun ajanın talimatlarına bir "chief of staff" kişiliği yerleştirmesini sağlar. Şirket onay istiyorsa sihirbaz işe almayı kendisi onaylar: `approvalsApi.approve(hire.approval.id, "Approved during onboarding first-agent setup.")` (`:2212-2220`).
- Ortam testi başarısız olursa ya da kimlik doğrulamanın eksik olduğunu bildirirse işe alma engellenir (`blocksAgentCreate`, `:173-176`, `:2151-2158`).
- Adımı yinelemek ikinci bir ajan oluşturmaz: aynı adı ve adaptörü taşıyan mevcut ajan kullanılır (`:2175-2191`).
- "Get started" bir proje oluşturur (`buildOnboardingProjectPayload`: durum `in_progress`, varsa şirket hedefine bağlı) ve yeni ajana atanmış, "Paperclip onboarding" başlıklı bir görev açar; görev `onboardingFirstTask: true` ile oluşturulduğu için görev açıklamasını sunucu yazar (`ui/src/lib/onboarding-launch.ts:27-68`, `ui/src/components/OnboardingWizard.tsx:277`). Kullanıcı Genel bakış ekranına değil, o göreve gider (`:1764-1766`).
- Taslak `localStorage` içinde `paperclip-onboarding-state` anahtarıyla tutulur; her depolama çağrısı sarmalandığı için depolamaya izin vermeyen bir tarayıcı sihirbazı bozmaz (`:276-317`).
- Alt kısım: solda Geri, sağda birincil düğme; etiketleri "Continue", "Next", adım 4'te giriş durumuna göre değişen bir etiket ve "Get started" (`:3076-3134`). Cmd/Ctrl+Enter birincil eylemi tetikler ve çift gönderime karşı korunur (`:2299-2333`).
- Giriş noktaları: şirket menüsündeki "Create organization" sihirbazı adım 1'den açar (`ui/src/components/SidebarCompanyMenu.tsx:230-238`); henüz ajanı olmayan mevcut bir şirket adım 3'ten girebilir (`ui/src/components/OnboardingWizard.tsx:2359-2363`).

### 12.2 Giriş (`ui/src/pages/Auth.tsx`, 229 satır)

Bölünmüş bir ekran: solda form (`w-full md:w-1/2`, iç kısım `max-w-md mx-auto my-auto px-8 py-12`), sağda ASCII sanatıyla yapılmış bir animasyon (telefonda gizli), sağ üstte tema düğmesi (`:103-227`). Tek form "Sign in to Paperclip" ile "Create your Paperclip account" arasında geçiş yapar; alanlar Ad (yalnızca kayıtta), E-posta, Parola (kayıtta en az 8 karakter, `:80-83`). Kayıt metni "Email confirmation is not required in v1." der (`:117-121`). Başarılı girişten sonra şirketler önbelleğini sıfırlar (hesap değişmiş olabileceği için) ve `next` adresine gider (`:64-74`). Bulut kurulumunda farklı bir bileşen, `CloudSignIn` çizilir (`:98-100`). Uç noktalar: `/api/auth/sign-in/email`, `/api/auth/sign-up/email` (`:126`).

### 12.3 Davet karşılama sayfası (`ui/src/pages/InviteLanding.tsx`, 867 satır)

Koyu renkli, iki panelli bir sayfa (`min-h-screen bg-zinc-950`, `:555-557`). Solda: şirket logosu, "You've been invited to join Paperclip", "Join {company}" (ilk kurulum davetinde "Set up Paperclip"), dört bilgi kutusu (organizasyon, davet eden, istenen erişim, davetin son geçerlilik zamanı), davet edenin mesajı ve "Signed in as ..." (`:558-615`). Sağda üç durumdan biri görünür:

- ajan daveti: bir onay isteği oluşturan "Submit agent details" formu (ajan adı, adaptör türü, yetenekler) (`:618-665`);
- oturumu olmayan insan: sayfa içinde "Create account" / "I already have an account" formu; ardından davet kendiliğinden devam eder (`:666-815`);
- oturumu olan insan: "Accept organization invite" (ya da kendiliğinden kabul) (`:816-861`).

Ajan formu gönderdikten sonra bir panel, sahiplenme gizli anahtarını (claim secret) ve onay sayfasının bağlantısını gösterir (`AwaitingJoinApprovalPanel`, `:156-207`).

### 12.4 Yönetim kurulu sahipliğini alma ve CLI kimlik doğrulaması

Yönetim kurulu sahipliğini alma (Board claim; `ui/src/pages/BoardClaim.tsx`, 126 satır, `/board-claim/:token?code=`): tek bir kart şu durumlardan geçer: geçersiz adres, yükleniyor, kullanılamıyor, "Sign in required", "Claim Board ownership" ("This will promote your user to instance admin and migrate organization ownership access from local trusted mode.", yani kullanıcı kurulum yöneticisi yapılır ve organizasyon sahipliği erişimi yerel güvenilir moddan taşınır) ve "Board ownership claimed" (`:44-124`). Uç noktalar: `GET /board-claim/:token?code=`, `POST /board-claim/:token/claim` (`ui/src/api/access.ts:381-384`).

CLI kimlik doğrulaması (`ui/src/pages/CliAuth.tsx`, 185 satır, `/cli-auth/:id?token=`): "Approve Paperclip CLI access" kartı komutu, istemciyi, istenen erişimi (yönetim kurulu ya da kurulum yöneticisi) ve istenen organizasyonu listeler; "Approve CLI access" ve İptal düğmeleri vardır. Ayrıca onaylandı, iptal edildi, süresi doldu ve giriş gerekli durumları bulunur (`:74-182`). Uç noktalar: `GET /cli-auth/challenges/:id?token=`, `POST .../approve`, `POST .../cancel` (`ui/src/api/access.ts:390-399`).

---

## 13. Ekranlara göre tablo: boş ekran, uç noktalar, yenileme, bayraklar

API yolları `/api` köküne göredir. "WS", bölüm 1.5'teki geçersiz kılma eşlemesi demektir.

| Ekran | Boş ekran metni | Başlıca uç noktalar | Sayfa yenilenmeden güncellenenler | Bayraklar ve kapılar |
|---|---|---|---|---|
| Ajan listesi | "Create your first agent to get started." | `GET /companies/:id/agents`, `/org`, `/built-in-agents`, süren çalışmalar | WS `agent.status` ve çalışma olayları; süren çalışmaları lider sekme 15 saniyede bir yoklar | `enableBuiltInAgents` (sekme), `enableAgentChat` (sohbet düğmesi), `enableEnvironments` (sütun), `enableStreamlinedUi` (sürüm) |
| Organizasyon şeması | "No organizational hierarchy defined." | `GET /companies/:id/org`, `/org.svg`, `/org.png` | ajan değişikliklerinde WS organizasyon anahtarını geçersiz kılar | sade kabukta Ajanlar sayfasına gömülü |
| Ajan ayrıntısı | boş ekran yerine şeritler | `GET/PATCH /agents/:id`, `/config-revisions`, `/instructions-bundle`, `/skills/sync`, `/keys`, çalışmalar, olaylar ve çalışma kaydı | WS çalışma olayları; çalışma ayrıntısı 5 / 15 saniyede bir; talimatlar 5 saniyede bir | `enableBetaSkills`, `enableChatConnectors`, `enableBuiltInAgents` |
| Yeni ajan | yok | `GET /adapters`, `POST /companies/:id/agent-hires` | yok | `enableNativeRunner` |
| Ekip kataloğu | "No team catalog configured." | `/teams/catalog...`, `/companies/:id/teams/catalog/...` | yok | bu commit'te sayfaya giden yol yok |
| Yerleşik ajanlar | bunun yerine yaşam döngüsü etiketi | `/companies/:id/built-in-agents/...` | deneysel ayarlar değişince yeniden çekilir (`ui/src/pages/InstanceExperimentalSettings.tsx:166`) | `enableBuiltInAgents` |
| Ajan sohbeti | "Who would you like to talk to?"; "Add an agent to start a conversation." | `/companies/:id/chats[/:agentRef]` | görev akışının kendi canlı güncellemeleri; sohbet listesini WS geçersiz kılar (`ui/src/context/LiveUpdatesProvider.tsx:1292-1295`) | `enableAgentChat` |
| Yönetim kurulu sohbeti | "No organization selected" | `POST /board/chat/stream` | yanıtın SSE akışı | `enableConferenceRoomChat` |
| Onaylar | "No pending approvals." / "No approvals yet." | `/companies/:id/approvals`, `/approvals/:id/...` | WS onay etkinliği; Gelen kutusu rozeti | yok |
| Maliyetler ve bütçeler | "No budget policies yet. ..." | `/companies/:id/budgets/...`, `/companies/:id/costs/...` | 30 saniyede bir yoklama, kota pencereleri 5 dakikada bir; WS `cost_event` | sade kabukta Denetim ekranına gömülü |
| Denetim çalışmaları | "No runs yet." / "No runs match these filters." | çalışma listesi (sınır 200) | 15 saniyede bir yoklama | sade kabuk |
| Hedefler | "No goals yet." | `/companies/:id/goals`, `/goals/:id` | WS hedef etkinliği | `enableGoalsSidebarLink` (yalnızca kenar çubuğu bağlantısı) |
| Projeler | "No projects yet." | `/companies/:id/projects`, `/projects/:id`, kaynak üyelikleri | WS proje etkinliği | `enableIsolatedWorkspaces` (sekme), `enableSummaries` (özet kartı) |
| Rutinler | "No active routines. Use Create routine to define the first recurring workflow." | rutin ve tetikleyici uç noktaları | WS rutin etkinliği; bir çalışma sürerken 3 saniyede bir | `enableStreamlinedUi` (sürüm) |
| Skill'ler | "No installed skills yet. Discover a skill or create one." | `/companies/:id/skills...`, `/skills/catalog`, `/companies/:id/skill-sources` | WS `company_skill`; test çalışmaları 2 saniyede bir | `enableBetaSkills`; yan sütunlar yalnızca eski kabukta |
| Gizli anahtarlar | "No secrets yet. Create a shared organization secret or one that each user supplies." | `/companies/:id/secrets...` | bulunamadı | `company.secrets` gizli ayarı |
| Bağlayıcılar | bağlayıcılar her zaman listelenir | `/companies/:id/tools/...`, `/tool-connections/...`, `/tool-gateway/...` | inceleme kuyruğu 20 saniyede bir; WS tek bir durumda bekleyen eylem isteklerini geçersiz kılar (`ui/src/context/LiveUpdatesProvider.tsx:1418-1428`) | `enableChatConnectors`, `enableMemoryConnectors`, `enableSmokeLab` |
| Eklentiler | "No plugins installed" | `/plugins...` | yok | `instance.plugins` gizli ayarı |
| Organizasyonlar | yok (her zaman en azından liste vardır) | `/companies`, `/companies/stats` | WS şirket etkinliği | oluşturma bulutta gizli |
| Üyeler ve davetler | "No user memberships found for this organization yet."; "No invites have been created for this organization yet." | `/companies/:id/members`, `/invites`, `/join-requests` | WS `join_request`; kenar çubuğu rozeti 15 saniyede bir | `company.members` ve `company.invites` gizli ayarları |
| Deneysel ayarlar | yok | `GET/PATCH /instance/settings/experimental` (`ui/src/api/instanceSettings.ts:21-23`) | sunucu beklenmeden yansıyan, hata olursa geri alınan aç/kapa değişikliği | `instance.experimental` gizli ayarı |
| İlk kurulum | yok | `POST /companies`, `/companies/:id/agent-hires`, `/approvals/:id/approve`, projeler, görevler | yok | yok |
| Giriş, davet, sahiplenme, CLI | durum kartları | `/auth/...`, `/invites/:token`, `/board-claim/:token`, `/cli-auth/challenges/:id` | yok | bulut giriş sürümü |

---

## 14. Alınmaya değer kalıplar

Her madde, kalıbı uygulayan kodu gösterir. Maddeler, Agent Office'e en doğrudan yarayanlar başta olacak biçimde sıralanmıştır.

1. **Her durum için tek renk, türetilmiş etiketler.** Her durum tek bir CSS değişkenini (`--sc`) belirler; `.status-chip` ve `.status-fill` açık ve karanlık tema için dolgu, yazı ve kenarlık rengini `color-mix` ile hesaplar (`ui/src/index.css:2411-2423`; bunları `ui/src/components/StatusBadge.tsx:48-72` kullanır). Durum başına tek değişken olması liste satırlarını, etiketleri ve kapsülleri tutarlı tutar. Agent Office aynı formülü kendi değişkenleriyle kullanabilir; ancak kontrastı denetlemesi gerekir, çünkü karışım yüzdeleri Paperclip'in renklerine göre ayarlanmıştır.

2. **Sabit bir "live" gösterimi.** Çalışan ajan için tek bir kapsül animasyonu, hata için tek bir animasyon, "Live (n)" için tek bir mavi etiket; hareketi azaltma ayarı açıkken hepsi kapanır (`ui/src/index.css:1513-1535`, `ui/src/lib/status-colors.ts:171-190`, `ui/src/pages/Agents.tsx:815-839`). Hareket yalnızca bir şeyin çalıştığını göstermek için kullanılır.

3. **Genel bir kayıt ve türe özel çiziciyle onay.** Kayıt `{type, status, payload, decisionNote, ...}` biçimindedir; arayüzde tek bir kart, her tür için bir çizici, konu için sırayla denenen alanlar (`title`, `name`, `summary`, `recommendedAction`) ve "See full request" ile açılan ham görünüm vardır (`ui/src/components/ApprovalPayload.tsx:21-31`, `:84-241`; `ui/src/pages/ApprovalDetail.tsx:230`). "Board Approval" çizicisi, insanın karar verdiği bir kart için iyi bir şablondur: özet, önerilen eylem, onaylanınca ne olacağı, riskler, önerilen metin (`ui/src/components/ApprovalPayload.tsx:173-230`).

4. **Onaylarda düzeltme döngüsü.** Notla birlikte "Request revision", isteyenin (istenirse yeni bir içerikle) yeniden göndermesi ve onayın kendi yorum akışı (`server/src/services/approvals.ts:236-265`, `ui/src/pages/ApprovalDetail.tsx:297-363`). Bu, `changes_requested` durumuyla bire bir örtüşür.

5. **Onaylamak kontrolü isteyene geri verir.** Onay, körü körüne bir yan etki çalıştırmak yerine isteyen ajanı bir gerekçe ve bağlı görev kimlikleriyle uyandırır; arayüz de bunu söyler: "Linked tasks remain open until the requesting agent follows up and closes them." (`server/src/routes/approvals.ts:325-342`, `ui/src/pages/ApprovalDetail.tsx:260`). Karardan sonra kullanıcıya bağlama uygun bir sonraki adım gösterilir (`ui/src/pages/ApprovalDetail.tsx:160-170`).

6. **Bulunulan yerde onay.** Aynı onay için onaylar sayfasından, Gelen kutusu satırından, görevden ve ajan sayfasından karar verilebilir (bölüm 7.6); hepsi tek bir Gelen kutusu rozetinde sayılır (`ui/src/lib/inbox.ts:1265-1320`).

7. **Sonucu yazılı, üç durumlu eylem kuralı.** Kapalı / Önce sor / Serbest (Off / Ask first / Allowed); her birinin tek cümlelik açıklaması vardır, küçük bir üç parçalı seçici olarak gösterilir ve grup düzeyinde "Set all" bulunur (`ui/src/pages/apps/app-detail/PermissionsPanel.tsx:417`, `:448-450`, `:513`). İnceleme kartı, insan karar vermeden önce tam olarak hangi çağrının yapılacağını ön izleme olarak gösterir (`ui/src/pages/apps/ReviewQueueCard.tsx:172-208`).

8. **Geçerli erişimin açıklanması.** "Why these tools?" bir ajanın araç listesinin arkasındaki profilleri ve kuralları listeler; "Check an agent's access" ise bunu istendiği anda hesaplar (`ui/src/pages/AgentToolsTab.tsx:566-572`, `:662-748`; `ui/src/pages/tools/profiles/ProfilesIndex.tsx:141-155`). Şerit şu kuralı söyler: istem erişimi daraltabilir ama hiçbir zaman genişletemez.

9. **Yeni araçlar varsayılan olarak engelli.** Yeni keşfedilen eylemler incelenene kadar karantinada kalır; bir profilin ileride eklenecek araçlar için varsayılanı da "Stay blocked until someone allows them" seçeneğidir (`ui/src/pages/tools/profiles/WizardToolsStep.tsx:258-270`).

10. **Kural, olay ve çalışma öncesi kapı olarak bütçe.** Her kapsam için uyarı yüzdesi ve kesin durdurma (`server/src/services/budgets.ts:66-75`); kesin durdurma kapsamı duraklatır ve tam olarak iki çözümü olan bir olay açar: "Raise budget & resume" ya da "Keep paused" (`ui/src/components/BudgetIncidentCard.tsx:80-109`); her çalışma da başlamadan önce denetlenir ve engel varsa okunabilir bir gerekçe verilir (`server/src/services/budgets.ts:718-864`).

11. **Onay bekleyen kayıtlar listelere girmez.** Onay bekleyen bir işe alma, durumu `pending_approval` olan bir satır olarak kayıtlıdır; ajan listesinde görünmez, şerit ve onay düğmesi kendi sayfasında durur (`server/src/routes/agents.ts:4633-4634`, `ui/src/pages/Agents.tsx:88`, `ui/src/pages/AgentDetail.tsx:1366-1379`).

12. **Kütüphanesiz organizasyon şeması.** 30 satırlık bir düzenli ağaç yerleşimi, DOM kartları ve dirsekli bağlantı çizgileri için tek bir SVG, hepsi tek bir CSS dönüşümünün altında; kaydırma, tekerlekle imlecin olduğu yere yakınlaştırma, iki parmakla yakınlaştırma ve sığdırma vardır (`ui/src/pages/OrgChart.tsx:60-113`, `:323-342`, `:569-663`). Aynı ağaç, paylaşmak için sunucuda SVG ve PNG olarak da üretilir; 20 düğümün üstünde kendiliğinden daraltılır (`server/src/routes/org-chart-svg.ts:588-762`). [Düzeltme: yerleşim hesabı 30 değil, yaklaşık 50 satırdır; bu maddede gösterilen satır aralığı da bunu verir.]

13. **Ayrıntı sayfalarında gruplanmış yan menü ve kapsam taşıyan Denetim bağlantıları.** Ajanın alt görünümleri Ajan / Çalışma ortamı / Yönetişim olarak gruplanır (`ui/src/pages/agent-detail-navigation.ts:23-44`); çalışmalar, maliyetler, bütçeler ve etkinlik her ajan için ayrıca kurulmaz, Denetim ekranında `?agentId=` ile açılır (`ui/src/pages/audit/audit-navigation.ts:23-62`).

14. **Operatörün düzenlediği her şey için geri yüklenebilir sürümler.** Ajan yapılandırması (`ui/src/pages/AgentDetail.tsx:1867-1931`), talimat dosyaları (fark görünümü ve "Restore as new revision"), rutinler (`baseRevisionId` ve 409 "Routine changed", `ui/src/pages/RoutineDetail.tsx:366-385`).

15. **Kaydedilmemiş değişiklik disiplini.** Her alan grubu için kaydedilmemiş değişiklik katmanı, alta yapışık bir kaydetme çubuğu ve sayfadan çıkışta, bağlantı tıklamalarında ve geri gitmede koruma (`ui/src/pages/AgentDetail.tsx:1075-1149`, `:1494-1500`). Bunun yerine otomatik kayıt kullanılan yerlerde bir durum etiketi kaydın sürdüğünü, bittiğini ya da yapılamadığını söyler (`ui/src/pages/agent-skills/AgentSkillsTab.tsx:114-203`, `:576`).

16. **Sonuçlarıyla birlikte gösterilen kurallar.** Rutinlerde çakışma ve kaçırılanlar kuralları, her biri bir cümle taşıyan tek seçimli kartlardır; "Next 5 fires" ön izlemesi de seçimin yaklaşan gerçek zamanlarda ne yapacağını gösterir (`ui/src/components/routine-sections/editable-sections.tsx:36-90`, `:559-592`). Etkileşim yönetişimi, etki cümlesini her seçeneğin içine koyar (`ui/src/components/InteractionGovernancePanel.tsx:55-70`, `:193-212`).

17. **Cron ifadesine iki yönde çevrilen hazır zamanlama seçenekleri.** Yedi hazır seçenek, düz seçim alanları ve sonraki tetiklenmeleri gösteren özel bir cron alanı (`ui/src/components/ScheduleEditor.tsx:10-16`, `:48`, `:103`).

18. **Çalıştığını kendisi kanıtlayan webhook tetikleyicileri.** Yeni bir webhook test modunda başlar; "Check connection", görev oluşturmadan bir olayın gelip gelmediğini ve kimlik doğrulamanın geçip geçmediğini gösterir (`ui/src/components/routine-triggers/TriggerWizard.tsx:525-531`, `ui/src/components/routine-triggers/RoutineTriggers.tsx:247-251`).

19. **Çalışma kaydı görüntüleyicisi.** Kaydın sayfa sayfa yüklenmesi, yeniden bağlanan ve gerektiğinde yoklamaya geçen WebSocket ile canlı izleme, "Jump to live" düğmesiyle en altı kendiliğinden izleme ve ortam değişkenleri gizlenmiş bir çağrı kartı (`ui/src/pages/AgentDetail.tsx:3974-4623`).

20. **Sorguları WebSocket olayları geçersiz kılar.** Tek soket, `entityType` üzerinde tek bir switch, bileşen düzeyinde abonelik yok (`ui/src/context/LiveUpdatesProvider.tsx:1436-1591`, `:1684-1790`). Kalan yoklamayı yalnızca tek bir sekme yapar (`ui/src/pages/Agents.tsx:269-284`).

21. **Devre dışı öğeler nedenini söyler.** Skill Studio'daki Çalıştır düğmesi tam olarak tek bir neden gösterir (`ui/src/lib/skill-studio.ts:126-146`); devre dışı tek seçimli kartlarda nedeni yazan bir ipucu ve bir erişilebilirlik etiketi bulunur (`ui/src/features/connections/ConnectionSetupFlow.tsx:4242-4250`).

22. **İlk adımı başlatan boş ekranlar.** Erişim profilleri beş şablon kartıyla açılır (`ui/src/pages/tools/profiles/ProfilesIndex.tsx:373-399`); sohbet karşılama sayfası seçilebilecek en çok altı ajan gösterir (`ui/src/pages/AgentChats.tsx:52-73`); genel `EmptyState` bileşeni bir eylem düğmesi alır (`ui/src/components/EmptyState.tsx:18-29`).

23. **Arayüzde gizli anahtar özeni.** "Stored once, never re-displayed" (bir kez saklanır, bir daha gösterilmez; `ui/src/pages/Secrets.tsx:2703`); ajanın önerdiği gizli anahtarlarda yalnızca parmak izi ve uzunluk gösterilir, ajanın gerekçesi de güvenilmeyen bir iddia olarak sunulur (`ui/src/pages/secrets/ProposalsTab.tsx:112-125`, `:195-198`).

24. **Çıkarılan kişinin işi yeniden atanır.** Çıkarma penceresi üyenin açık görevlerini sayar ve nereye gideceklerini sorar (`ui/src/pages/CompanyAccess.tsx:502-586`).

25. **İçe aktarılan otomasyon duraklatılmış gelir.** İçe aktarmadan sonra ajanlar ve rutinler onay kutularıyla listelenir; operatör etkinleştirene kadar hiçbir şey çalışmaz (`ui/src/pages/CompanyImport.tsx:1746-1795`).

26. **Filtreler ve sekmeler adreste durur.** Onay sekmeleri birer yoldur (`ui/src/App.tsx:384-387`), ekip kataloğu filtreleri sorgu parametresidir (`ui/src/pages/TeamCatalog.tsx:2269-2283`), Denetim kapsamı da sorgu parametresidir.

27. **Görev olarak sohbet.** Bir ajanla konuşma, tekil bir (company, agent, user) anahtarı olan bir görevdir; böylece geçmiş, çalışmalar, maliyetler ve onaylar görev altyapısını yeniden kullanır (`packages/db/src/schema/issues.ts:95-103`, `ui/src/pages/AgentChat.tsx:95-99`).

28. **Düz dosya olarak ekip şablonları.** Ajanlar, projeler ve yinelenen görevler ön bilgi bloklu markdown dosyalarıdır; bir `manager` alanı ve bir `includes` listesi vardır (`packages/teams-catalog/catalog/bundled/company-defaults/core-exec-team/TEAM.md:1-28`). Görev kartlarını git'te tutmaya yakın bir yaklaşımdır.

29. **İlk kurulum her ekranda tek soru sorar ve idempotenttir.** Her adım güvenle yinelenebilir (`ui/src/components/OnboardingWizard.tsx:1979-1984`, `:2175-2191`); taslak sayfa yenilenince kaybolmaz (`:276-317`).

30. **Dürüst dipnotlu özellik bayrakları.** Her deneysel kart, kapatmanın var olan veriye ne yapacağını söyler (`ui/src/pages/InstanceExperimentalSettings.tsx:299`, `:333`, `:345`, `:494`); operatörler de ayar sayfalarını bütünüyle gizleyebilir (`ui/src/App.tsx:163-258`).

Aşağıdakiler, Agent Office'in yazılı tasarım kurallarıyla çatışan Paperclip alışkanlıklarıdır. Bunlar Paperclip'e ilişkin olgulardır; Paperclip'e mi yoksa Agent Office'in `CLAUDE.md` dosyasındaki kurallara mı uyulacağı ürün sahibinin kararıdır, benim seçtiğim bir şey değildir:

| Paperclip alışkanlığı | Örnek | İlgili Agent Office kuralı |
|---|---|---|
| Küçük, büyük harfli bölüm etiketleri | `text-xs font-medium text-muted-foreground uppercase tracking-wide` (`ui/src/pages/CompanySettings.tsx:224`, `:259`, `:343`) | büyük harfli üst etiket kullanılmaz |
| Orta noktayla ayrılmış bilgi satırları | "by {author} · {version}" (`ui/src/pages/CompanySkills.tsx:882`), `3a · 1p · 1r · 4s` (`ui/src/pages/TeamCatalog.tsx:2170`) | orta noktayla ayrılmış bilgi satırı kullanılmaz |
| Üzerine gelince kartlarda gölge | `hover:shadow-md` (`ui/src/pages/CompanySkills.tsx:863`, organizasyon şeması kartları) | ayrım gölgeyle değil ince çizgi ve boşlukla yapılır |
| Bağlantı ve düğme metinlerinde ok | HTML ok karakteriyle "See All" (`ui/src/pages/AgentDetail.tsx:1799`), okla "Open test task" (`ui/src/pages/SkillStudio.tsx:3252`) | düğme metnine ok eklenmez |
| Renk geçişleri | bütçe olayı kartı `bg-(image:--gradient-extract-4)` (`ui/src/components/BudgetIncidentCard.tsx:46`), profil kartı (`ui/src/pages/ProfileSettings.tsx:161-163`) | renk geçişli zemin kullanılmaz |
| Emojiden türetilmiş rol simgeleri | sunucudaki şemada Twemoji çizim yolları (`server/src/routes/org-chart-svg.ts:60-157`) | emoji ya da süs amaçlı simge kullanılmaz |
| Süs amaçlı ana görsel olarak hareketli karakter | ajan başlığındaki `AgentCharacter` (`ui/src/pages/AgentDetail.tsx:1242-1314`), ilk kurulumdaki ana görsel | hareket yalnızca kullanıcının yaptığı işlemin sonucunu gösterir; tek cesur öğe Ofis görünümüdür |
| Canlılık rengi olarak mavi | `liveBlueBadge` (`ui/src/lib/status-colors.ts:190`) | Agent Office'in vurgu rengi teal tonundaki `--brand`; bir eşleme gerekir |
| İngilizce metin, yıkıcı bir eylem için tarayıcının `confirm()` penceresi | organizasyonu arşivleme (`ui/src/pages/CompanySettings.tsx:393-396`) | Türkçe metin; ne olacağını söyleyen hata ve onay mesajları |

---

## 15. Paperclip kavramlarının Agent Office karşılıkları

Agent Office terimleri kendi `CLAUDE.md` dosyasından alınmıştır (`agents/<code>.yaml` içindeki kartlar, `company_agents`, Onay Masası, Y0 ile Y3 arası yetki seviyeleri, `read` / `draft` / `internal_write` / `external_effect` araç sınıfları, `project_members`, `runs` ve `audit_log`). `CLAUDE.md` içinde bir konuya değinilmiyorsa hücrede tahmin yürütülmemiş, değinilmediği yazılmıştır.

| Paperclip kavramı | En yakın Agent Office kavramı | Tam uymayan noktalar |
|---|---|---|
| Şirket (kiracı, şirket menüsü, `/:prefix` yolları) | `company_id` ve RLS'ye dayanan şirket; şirket girişten sonra seçilir; `kind` değeri `company` ya da `private_space` | Paperclip'te şirketler arası görünüm yoktur (bölüm 11.1); Agent Office'te kurucunun holding görünümü ve yalnızca kurucuya açık bir özel alan vardır. Paperclip seçili şirketi `localStorage` içinde saklar ve adrese şirket kodunu koyar. Paperclip şirketleri arayüzden ve ilk kurulumla oluşturulabilir, arşivlenebilir ve silinebilir; Agent Office'te şirketler sabit bir kümedir. Şirketin bütçe yüzünden `paused` durumuna geçmesinin yazılı bir karşılığı yoktur. |
| Ajan (şirkete özel, arayüzden düzenlenebilen bir satır) | Git'teki bir karttan gelen genel ajan tanımı (`agent_definitions`, `card_versions`) ve şirkete özel bir `company_agents` satırı | Paperclip'in oluşturma / yapılandırma / çoğaltma / sonlandırma akışının tamamı veritabanını arayüzden düzenler. Agent Office kartları salt okunur gösterir ve değişiklikler PR ile yapılır. Uyabilecek kısımlar: ajan listesi, ayrıntı sayfasının yerleşimi, durum etiketleri, duraklatma ve sürdürme (durdurma düğmesi), şirkete özel ayarlar ve bütçe. Talimat dosyası düzenleyicisi yalnızca sürüm geçmişi olan salt okunur bir görüntüleyici olarak uyar. |
| Organizasyon şeması ve bağlılık ilişkisi (`reportsTo`, ajandan ajana, kökte CEO) | Birimler (`agents/units.yaml`) ve her ajan için bir insan `owner` | `CLAUDE.md` içinde Agent Office için ajandan ajana bir bağlılık ilişkisi yoktur. Şema şirket, birimler, ajanlar sırasıyla ve her kartta insan sorumlusuyla kurulur; bu yüzden yerleşim kodu uyar, ama "Reports to", "Direct reports", "Invalid reporting chain" ve "Escalation path is paused" uymaz. Agent Office'te iş üst kademeye "İnsana sor" yoluyla, bir insana iletilir. |
| Rol ve unvan (`ceo ... general` enum değeri, serbest metin unvan) | Ajan kodu (örneğin KOR-1), birim ve Y0 ile Y3 arası yetki seviyesi | Paperclip'te yetki seviyesi kavramı yoktur. En yakın karşılıkları üç izin düğmesi, hazır bir güven ayarı ve araç kurallarıdır (bölüm 3.8). Y seviyesi, Agent Office'in ajan listesi satırında ve kartında temel bir alan olmalıdır; bunun için kopyalanacak bir şey yoktur. |
| Adaptör yapılandırması (komut satırı ajan aracı, giriş, ortam testi, model, motor, çalışma alanı, ortam) | Kartta adı yazan model (varsayılanlar Haiku, Sonnet, Opus) | Neredeyse hiçbiri uymaz: Agent Office'in worker'ı Claude API'yi doğrudan çağırır. Yalnızca "model" ve "thinking effort" türü alanların karşılığı vardır. Adaptörler sayfasının, ortamların, çalışma alanlarının, CLI kimlik doğrulamasının ve ilk kurulumdaki "Connect a model" adımının karşılığı yoktur. |
| Uyandırma kuralları (zamanlı uyandırma, istek üzerine uyandırma, bekleme süresi, en çok eş zamanlı çalışma, zaman aşımı, tur sınırından sonra devam) | Kart tetikleyicileri (zamanlanmış, olay, istek), `project_context` ve karttan okunan çalışma başına sınırlar (varsayılan 20 araç çağrısı, 10 dakika) | Zaman aşımı süre sınırına, "Max turns per run" araç çağrısı sınırına, "Wake on demand" olay ve istek tetikleyicilerine karşılık gelir. Belirli aralıklarla uyandırma ("uyan ve iş ara") bir Paperclip fikridir; Agent Office belirli işleri zamanlar ve eş zamanlılığı kendi kuyruğu (pg-boss) yönetir. Bir sınıra gelindiğinde Agent Office işi bir insana devreder; Paperclip ise otomatik bir devam çalışmasını sıraya alabilir. |
| Onay (4 kaba tür; ajanlar ya da sistem açar; ayrıca araçların "Ask first" istekleri ve gizli anahtar önerileri ayrı durur) | Onay Masası: dışa etkili her eylem ve Y1 kartların `internal_write` çağrıları; kodla zorunlu kılınır | Durum eşlemesi: `pending` için `pending`, `revision_requested` için `changes_requested`, `approved`, `rejected`; Paperclip'teki `cancelled` durumunun listelenmiş bir karşılığı yoktur. Paperclip'te yönetim kurulu onayı istemeye ajan karar verir; Agent Office'te bunu araç sınıfı belirler. Onay Masası'na en yakın Paperclip mekanizması aslında `approvals` tablosu değil, araçların "Ask first" kuyruğudur. "Always allow" (sormayı bitiren bir güven kuralı) `external_effect` araçları için Agent Office'in 4. kuralıyla çelişir. Paperclip'in onay akışında yeniden kimlik doğrulama adımı görmedim; Agent Office önemli onaylarda bunu (passkey) ister. `awaiting_approval` görev durumu, Paperclip'teki "ajanı `approval_approved` ile uyandır" adımının yerini alır. |
| Bütçe kuralı ve bütçe olayı (şirket, ajan ve proje kapsamları; aylık ya da toplam; uyarı yüzdesi; kesin durdurma; otomatik duraklatma; aşım onayı) | `company_agents` ayarlarındaki bütçe; `runs` içinde çalışma başına maliyet | Ajan kapsamındaki kural uyar. Şirket ve proje kapsamları, uyarı olayları ve aşım onayı `CLAUDE.md` içinde anlatılmamıştır. Sağlayıcılar, faturalayanlar, kota pencereleri ve finans olayları tek bir API sağlayıcısı için geçerli değildir. Çalışma öncesi engel ve iki düğmeli olay kartı, durdurma düğmesine iyi uyar. |
| Hedef (şirket, ekip, ajan ve görev düzeyleri olan hiyerarşi) | yazılı bir karşılığı yok | `CLAUDE.md` içinde hedef kavramı yoktur. Yalnızca bu incelemeye dayanarak eklenmemelidir; Paperclip'in kendisi de kenar çubuğu bağlantısını "Legacy" grubuna taşımıştır. |
| Proje (görevleri, depoları, ortam değişkenlerini ve bütçeyi bir arada tutar; kişisel Join / Leave / yıldız) | `project_members` kullanan proje; görev, çalışma, onay, not, belge ve iz kaydı satırlarında boş olabilen `project_id`; müşteri bağlantısı ve yapay zekâ izni | Amaçlar zıttır. Paperclip projeleri kimin neyi göreceğini kısıtlamaz; Agent Office projeleri bir görünürlük sınırı ve bir sözleşme sınırıdır (müşteri sözleşmesi yapay zekâyı yasaklıyorsa hiçbir ajan çalışmaz). Liste yerleşimi uyar ("My projects" yerine "üyesi olduğum projeler" gelir); Join / Leave düğmeleri alınmamalıdır. Depolar, çalışma alanları ve ortam değişkenleri geçerli değildir. |
| Rutin (arayüzde tanımlanan yinelenen iş; zamanlama, webhook ya da API tetikleyicileri, değişkenler, çakışma ve kaçırılanlar kuralları; her çalışma bir görev oluşturur) | Kartlarda tanımlı zamanlanmış çalışmalar (`per_project`), yalnızca kodda duran sistem işleri (örneğin son tarih hatırlatmaları), `hooks.armadx.com` üzerinden gelen, imzası doğrulanan webhook'lar | Zamanlamalar git'teki kartlarda duruyorsa arayüzde bir rutin düzenleyicisi "asıl kaynak depodur" kuralıyla çatışır. Salt okunur kısımlar uyar: zamanlamanın açıklaması, sonraki tetiklenmeler, çalışma geçmişi, bir cümleyle anlatılan çakışma kuralı. Webhook gizli anahtarları ve bunların yenilenmesi, hooks alan adıyla ancak kabaca örtüşür. Kullanıcıların kendi yinelenen görevlerini tanımlayıp tanımlayamayacağı `CLAUDE.md` içinde yanıtlanmamıştır. |
| Skill (kitaplık nesnesi; GitHub'dan ya da bir katalogdan kurulabilir, arayüzde ajanlara tek tek eklenir, sürümlenir, çatallanabilir, Studio'da denenebilir) | Depoda `templates/`, `examples/` ve `tests/` klasörleriyle birlikte duran `skills/<name>/SKILL.md`; çalıştırıcı okur | Kurma, çatallama, yıldızlama, kaynaklar ve ajana özel aç/kapa düğmeleri uymaz. Ayrıntı sayfası (genel bakış, dosyalar, sürümler, kullanan ajanlar) salt okunur bir görünüm olarak uyar. Studio'nun "bu skill'i bir girdiyle çalıştır ve çıktıyı sakla" işlevi, skill'in `tests/` sonuçlarını göstermeye karşılık gelir; Agent Office bunları göstermeyi zaten planlıyor. |
| Gizli anahtar (organizasyona ya da kullanıcıya özel değerler, sağlayıcı kasaları, ortam değişkeni bağlamaları, yenileme, ajan önerileri) | Gizli anahtarlar yalnızca sunucu ortamında durur; Google token'ları şifreli saklanır ve yalnızca worker kullanır | Agent Office için bir gizli anahtar arayüzü anlatılmamıştır. Yalnızca kalıp olarak işe yarar: bir değeri bir daha gösterme, bir kimlik bilgisini hangi ajanların kullandığını göster, ajanın önerdiği kimlik bilgilerini güvenilmeyen say. |
| Bağlantı ve araç kuralları (her bağlantı için: kimler kullanabilir, hangi ajanlar kullanabilir; her eylem için Off / Ask first / Allowed; erişim profilleri; güven kuralları; kişisel, ajana ayrılmış ya da ortak kimlik bilgileri) | Araç sınıflarıyla `agents/tools.yaml`; kart yalnızca katalogdaki araçları kullanabilir; her Workspace için yalnızca okuma kapsamları olan bir Google bağlantı istemcisi ve `company_agents` içinde izinli Drive klasörleri listesi; izinli Figma çalışma dosyaları listesi | Agent Office'te eylemin durumu arayüzden seçilmez, koddan türer: `read` serbesttir, `draft` yalnızca korumalı bir alana yazar, `internal_write` Y1 ajanlarda sorar, `external_effect` her zaman sorar. Bu yüzden üç durumlu seçici salt okunur bir gösterim olarak uyar. Paperclip'in kimlik sorusu ("just me / dedicated agent / anyone") pilotta "bağlantıyı kuran kişi" yanıtına iner. Projelere ya da rutinlere atanan profillerin karşılığı yoktur. |
| Eklenti (npm paketi, arayüz yuvaları, worker, yetenekler) | yok | Atlanır. |
| Üyelik rolleri (owner, admin, operator, viewer) ve bağlantıyla davet; giriş e-posta ve parolayla | `founder`, `employee` ve `external` rolleri; davetle ve iki adımlı doğrulamayla Google girişi | Rol kümeleri ve giriş yöntemi farklıdır. Üyeler tablosu, davet geçmişi ve görevleri yeniden atayarak çıkarma penceresi yerleşim olarak uyar. Kurulum yöneticisi ve yönetim kurulu sahipliğini alma geçerli değildir. |
| Denetim ekranı (Etkinlik, Çalışmalar, Maliyetler, Bütçeler, Zaman çizelgesi; sorgu parametresiyle kapsam) | `runs` ve `audit_log` | İyi uyar. Agent Office her çalışma için modeli, kart sürümünü, token sayılarını, maliyeti, süreyi ve etiketleri kaydeder; bu, çalışma listesini ve maliyet tablolarını karşılar. |
| Ajan sohbeti (her kullanıcı ve ajan çifti için bir görev) | "İnsana sor" yolu ve `awaiting_reply` görev durumu; belirli ajanlar için soru ekranları | Yön farklıdır: Paperclip'te sohbeti insan başlatır; Agent Office'teki yolda ajan kendi sorumlusuna sorar. Saklama fikri (görev olarak konuşma) yine de uyar. |
| Ekip kataloğu ve yerleşik ajanlar | Git'teki kartlar ve birimler | Agent Office'in ajan kümesini tasarım raporu belirlemiştir; bu yüzden katalog ve kurulum aracı gerekmez. Dosya biçimi yalnızca kart düzeni için bir örnektir. |
| Deneysel bayraklar ve operatörün gizlediği ayarlar | yazılı bir karşılığı yok | `CLAUDE.md` içinde bayrak sistemi yoktur. |

---

## 16. Tam doğrulanmayan noktalar

Tamamı okunanlar: `Agents.tsx`, `Org.tsx`, `OrgChart.tsx`, `org-chart-svg.ts`, `AgentDetail.tsx`, `AgentActionButtons.tsx`, `ActivityCharts.tsx`, `AgentSkillsTab.tsx`, `AgentToolsTab.tsx`, `AgentBasicsDialog.tsx`, `NewAgentSetup.tsx`, `ReportsToPicker.tsx`, `Approvals.tsx`, `ApprovalDetail.tsx`, `ApprovalCard.tsx`, `ApprovalPayload.tsx`, `services/approvals.ts`, `Costs.tsx`, `Goals.tsx`, `GoalDetail.tsx`, `Projects.tsx`, `ProjectDetail.tsx`, `Routines.tsx`, `RoutineDetail.tsx`, `ScheduleEditor.tsx`, `editable-sections.tsx`, `RoutineTriggers.tsx`, `Workspaces.tsx`, `PermissionsPanel.tsx`, `SkillSources.tsx`, `PluginManager.tsx`, `PluginPage.tsx`, `Companies.tsx`, `CompanySettings.tsx`, `CompanyAccess.tsx`, `InvitesSection.tsx`, `JoinRequestQueue.tsx`, `InstanceAccess.tsx`, `InstanceGeneralSettings.tsx`, `InstanceExperimentalSettings.tsx`, `ProfileSettings.tsx`, `UserProfile.tsx`, `Auth.tsx`, `BoardClaim.tsx`, `CliAuth.tsx`, `AgentChat.tsx`, `AgentChats.tsx`, `AuditHub.tsx`, `AuditRuns.tsx`, yukarıda adı geçen kenar çubukları ve kaynak gösterilen API istemcileri.

Kısmen okunanlar ya da yalnızca ana hatları çıkarılanlar (bunlarla ilgili ifadeler kaynak gösterilen satırlarla sınırlıdır):

- `ui/src/components/AgentConfigForm.tsx`: bileşen parametreleri ve 1380-2151 satırları; giriş panelleri ve açılır menülerin iç yapısı okunmadı.
- `ui/src/pages/AgentDetail.production.tsx`: ana hatlar ve bölüm 3.10'da gösterilen aralıklar.
- `ui/src/features/connections/ConnectionSetupFlow.tsx`: ana hatlar ve 4095-4334 satırları.
- `ui/src/pages/apps/AppDetail.tsx`, `Browse.tsx`, `IdentitiesSection.tsx`: kaynak gösterilen aralıklar.
- `ui/src/pages/CompanySkills.tsx`, `SkillStudio.tsx`, `Secrets.tsx`: ana çizim yolları ve ana hatlar.
- `ui/src/pages/TeamCatalog.tsx`: liste, ayrıntı ve sihirbazın ilk üç adımı; ön izleme adımının yalnızca ana hatları.
- `ui/src/pages/CompanyEnvironments.tsx`, `CompanyImport.tsx`, `CompanyExport.tsx`, `AdapterManager.tsx`, `PluginSettings.tsx`, `BoardChat.tsx`, `InviteLanding.tsx`, `OnboardingWizard.tsx`: ana hatlar ve kaynak gösterilen aralıklar.
- `server/src/services/budgets.ts`, `server/src/routes/agents.ts`, `server/src/routes/approvals.ts`: kaynak gösterilen aralıklar.

Açık noktalar:

- Eski kabukta kullanıcının ajan alt görünümleri arasında nasıl geçtiği doğrulanmadı. `AgentContextualSidebar` bileşenini yalnızca sade kabuğun `Layout.tsx` dosyası bağlar (`:211-212`); `AgentDetail.tsx` ise `PageTabBar` bileşenini içe aktarır (`:69`) ama çizmez.
- Ekip kataloğu sayfasının `App.tsx` içinde bir yolu yoktur. Başka bir giriş noktası bulamadım, ama eklenti paketlerinde arama yapmadım.
- Decisions sayfasını (`enableDecisions`) ve Cases sayfalarını (`enableCases`) okumadım; ikisi de bana verilen listenin dışındadır.
- Araç kurallarının ve araç geçidinin sunucu tarafında nasıl uygulandığı burada yalnızca istemci açısından ele alındı.
- Okuduğum onay arayüzünde ve onay yollarında yeniden kimlik doğrulama adımı görmedim. Bu, o dosyalarla ilgili bir gözlemdir; başka bir yerde böyle bir adım olmadığının kanıtı değildir.
- Yerleşim kabuğu, kenar çubuğu bileşenlerinin iç yapısı, Gelen kutusu ve görev ayrıntısı yalnızca bu alana değdikleri yerde anlatıldı; bunlar kabuk raporunun ve iş ekranları raporunun konusudur.
- `/home/claude/pc-run` açılmadı.
