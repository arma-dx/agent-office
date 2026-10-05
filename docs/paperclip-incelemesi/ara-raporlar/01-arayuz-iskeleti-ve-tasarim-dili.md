# Paperclip arayüz kabuğu, gezinme ve tasarım sistemi

> Ara rapor. 3 Ekim 2026'da, Agent Office deposu okunmadan önce İngilizce yazıldı; depoya konurken Türkçeye çevrildi. Asıl belge `docs/paperclip-incelemesi.md` dosyasıdır; ikisi çelişirse o geçerlidir. Okuma notu ve bilinen düzeltmeler: [`00-okuma-notu.md`](00-okuma-notu.md).

Paperclip incelemesinin 01 numaralı raporu. Kaynak ağacı: `/home/claude/paperclip`, commit `dd868ed`. Aşağıdaki bütün yollar bu dizine göredir; kaynak gösterimi `path:line` biçimindedir. İnceleme salt okunurdu: hiçbir şey kurulmadı, derlenmedi, çalıştırılmadı ya da değiştirilmedi; ağ da kullanılmadı.

Dil notu: rapor İngilizce yazıldı; depoya konurken Türkçeye çevrildi. Bölüm 13 benim değerlendirmemdir; diğer bütün bölümler yalnızca kaynak gösterilen dosyalarda ne varsa onu aktarır.

## 1. Özet

1. Arayüz React 19 + Vite 8 + Tailwind CSS 4 + shadcn/ui "new-york" (tek paketli `radix-ui` üzerinde) ile kuruludur; yanında bildirimsel modda çalışan `react-router-dom` 7 ve TanStack Query 5 vardır (`ui/package.json:54-71`, `pnpm-lock.yaml:1157-1210`). `ui/` içinde form kütüphanesi, zod, grafik kütüphanesi ve animasyon eklentisi yoktur (bölüm 12).
2. İki kabuk vardır. Varsayılan, "streamlined" (sade) kabuktur (`ui/src/hooks/useStreamlinedUiEnabled.ts:13`); 23 `*.production.tsx` dosyası, `enableStreamlinedUi` ayarını false yapan kurulumlar için eski kabuğu ayakta tutar (`ui/src/App.tsx:837`).
3. Sade kabuğun geniş ekran çerçevesi şöyledir: solda, üstünde şirket menüsü ve altında hesap menüsü bulunan, genişliği ayarlanabilen kenar çubuğu (varsayılan 240 px, 208 ile 420 arası); 60 px'lik konum bilgisi çubuğu; kayan bir `main`; sağda isteğe bağlı, genişliği ayarlanabilen özellik paneli (varsayılan 322 px). Bazı yollar 240 px'lik ikinci bir kenar çubuğu ekler; ayarlar ise ana kenar çubuğunun yerini alır (bölüm 4).
4. Kenar çubuğunun kapalı hâli olan simge çubuğu kaldırılmıştır. `SidebarContext`, `collapsed = false` ve `peeking = false` değerlerini sabit olarak yazar (`ui/src/context/SidebarContext.tsx:56-63`); bu yüzden `Layout.tsx`, `SidebarShell.tsx` ve `SidebarNavItem.tsx` içindeki simge çubuğu ve üzerine gelince geçici açılma kodunun tamamı bu commit'te ölü koddur.
5. Yönetim kurulu yollarının hepsi `/:companyPrefix` altında durur (şirketin, görev kimliklerinde kullanılan büyük harfli kodu). Bağlantılar şirket kodu olmadan yazılır; kodu, yönlendiricinin etrafındaki ince bir sarmalayıcı ekler (`ui/src/lib/router.tsx:15-28`, `ui/src/lib/company-routes.ts:79-90`).
6. Değişken katmanı tek bir CSS dosyasıdır: `ui/src/index.css` (3324 satır); buna `ui/src/motion-tokens.css` (29 satır) eklenir. Anlamsal renkler saf gri tonlu OKLCH değerleridir; renk yalnızca durum renkleriyle (çalışıyor mavi, sırada sarı, incelemede mor, bitti yeşil, engellendi kırmızı) ve ajan renk geçişleriyle girer. Kart ve zemin rengi iki temada da aynıdır; bu yüzden yüzeyler dolguyla değil kenarlıkla ayrılır.
7. `scripts/check-token-gates.mjs` betiği, `ui/src/components/**` ve `ui/src/pages/**` içinde hex renk, köşeli ayraçla yazılmış keyfi Tailwind değeri ya da ham yazı boyutu bulursa derlemeyi hatayla bitirir. `bg-red-500` gibi hazır Tailwind renk sınıfları, bilinen ama denetlenmeyen bir borçtur (yaklaşık 3.115 yer, `doc/design/TOKEN-AUDIT.md:14`).
8. shadcn'in giriş ve çıkış animasyon sınıfları (`animate-in`, `zoom-in-95`, `fade-in-0`, `slide-in-from-*`) etkisizdir, çünkü animasyon eklentisi kurulu değildir (`ui/src/index.css:1200-1205`, `doc/design/DECISION-SHEET.md:196`). Pencereler, menüler, açılır menüler ve ipuçları animasyonsuz açılır.
9. Canlı güncelleme, seçili şirket başına tek bir WebSocket kullanır: `/api/companies/{id}/events/ws`. Olaylar, 300 ms'lik bir toplayıcı üzerinden React Query önbelleklerini yerinde günceller ya da geçersiz kılar ve kurallarla sınırlanan bildirimleri tetikler; soket koptuğunda 15 s'lik yoklamaya geçilir (bölüm 9).
10. i18n yalnızca iskelet düzeyindedir. Kırk dil dosyasının her birinde üç metin vardır ve `t()` işlevini yalnızca `App.tsx` çağırır; arayüzdeki diğer bütün metinler koda gömülü İngilizcedir (bölüm 10).

## 2. Kapsam ve uyarılar

Kapsananlar: yönlendirme, sağlayıcılar, uygulama kabuğu ve içine yerleştirilen her şey, tasarım değişkenleri, `ui/` temel bileşenleri, birden çok ekranda kullanılan ortak bileşenler, tasarım kuralı belgeleri, tarayıcıdaki veri katmanı ve canlı güncelleme, i18n, klavye kısayolları, bağımlılıklar ve Storybook.

Kapsam dışı: tek tek sayfaların iç yapısı (diğer raporlarda), sunucu, eklenti sisteminin kabuğa bağlandığı yerler dışında kalan kısmı.

Kodu okurken dikkat edilecek noktalar:

| Konu | Tespit | Kanıt |
|---|---|---|
| İki kabuk | Kurulum ayarına göre `Layout` (sade) ya da `Layout.production` seçilir | `ui/src/App.tsx:6-7, 837` |
| Varsayılan kabuk | Sade kabuk; değer yoksa, yüklenirken ve okuma hatasında da açık sayılır | `ui/src/hooks/useStreamlinedUiEnabled.ts:13, 22-26` |
| Kaldırılan simge çubuğu | `collapsed`, `peeking` sabitleri false değerindedir; ayarlayıcı işlevler hiçbir şey yapmaz | `ui/src/context/SidebarContext.tsx:56-63` |
| Simge çubuğunun saklama anahtarı | `paperclip.sidebar.collapsed` yalnızca testlerde geçer | `ui/src/context/SidebarContext.test.tsx:41` |
| Kullanılmayan bileşenler | `CompanySwitcher.tsx` ve `SidebarAgentChats.tsx` dosyaları var ama hiçbir yer bunları içe aktarmıyor | `ui/src` üzerinde yapılan grep, bunları içe aktaran bir dosya bulmadı |
| Etkisiz animasyon sınıfları | `tw-animate-css` / `tailwindcss-animate` kurulu değil | `ui/src/index.css:2921`, `ui/package.json:31-92` |
| Derleme zamanı bayrağı | Görev önceliği arayüzü gizlidir: `SHOW_TASK_PRIORITY_UI = false` | `ui/src/lib/ui-flags.ts:22` |

## 3. Yol tablosu

### 3.1 Yönlendirici ve sürüm

- Kütüphane: `react-router-dom`; bildirilen sürüm `^7.18.4`, çözümlenen sürüm 7.18.4 (`ui/package.json:71`, `pnpm-lock.yaml:1208-1210`).
- Mod: `BrowserRouter` içinde bildirimsel `<Routes>` / `<Route>` (`ui/src/main.tsx:69`, `ui/src/App.tsx:751-842`). Bu dosyalarda veri yönlendiricisi (data router), loader ya da action kullanılmaz.
- Uygulama kodunun tamamı yönlendirmeyi `@/lib/router` üzerinden içe aktarır. Bu modül `react-router-dom` paketini yeniden dışa aktarır (`ui/src/lib/router.tsx:58`); `Link`, `NavLink`, `Navigate` ve `useNavigate` için ise yollara şirket kodunu ekleyen kendi sürümlerini verir (`ui/src/lib/router.tsx:67-125`).
- `Link` bileşeninin bir ek davranışı vardır: hedef bir görev yoluysa, üzerine gelince açılan ön izleme bileşeni `IssueLinkQuicklook` çizilir (`ui/src/lib/router.tsx:78-93`).

### 3.2 Sağlayıcıların iç içe sırası

Kaynak `ui/src/main.tsx:63-96`; en dıştakinden başlayarak:

1. `StrictMode`
2. `AppErrorBoundary` (bağımlılığı olmayan, son çare hata sınırı; `ui/src/components/AppErrorBoundary.tsx:19-57`)
3. `QueryClientProvider` (içinde kardeş öğe olarak `SentryGate` de bulunur; `ui/src/main.tsx:67`)
4. `ThemeProvider`
5. `BrowserRouter`
6. `CompanyProvider`
7. `EditorAutocompleteProvider`
8. `ToastProvider`
9. `LiveUpdatesProvider`
10. `TooltipProvider`
11. `CompanyAwareBreadcrumbProvider` (şirket adını `BreadcrumbProvider` bileşenine iletir; `ui/src/main.tsx:55-58`)
12. `SidebarProvider`
13. `PanelProvider`
14. `PluginLauncherProvider`
15. `DialogProvider`
16. `App`

`main.tsx` ayrıca `@mdxeditor/editor/style.css` ve `./index.css` dosyalarını içe aktarır (`ui/src/main.tsx:24-25`), sayfa yüklenince bir service worker güncelleyicisi başlatır (`38-40`) ve `QueryClient` nesnesini `staleTime: 30_000`, `gcTime: 5 * 60_000`, `refetchOnWindowFocus: true` ayarlarıyla oluşturur (`42-53`).

### 3.3 Üst düzey yollar

Kaynak: `ui/src/App.tsx:751-842`.

| Yol | Öğe | Kapı | Satırlar |
|---|---|---|---|
| `oauth-handoff` | `PaperclipCloudOAuthHandoffPage` | yok | 752 |
| `auth` | `AuthPage` | yok | 753 |
| `board-claim/:token` | `BoardClaimPage` | yok | 754 |
| `cli-auth/:id` | `CliAuthPage` | yok | 755 |
| `invite/:token` | `InviteLandingPage` | yok | 756 |
| `chat-identity/confirm` | `ChatIdentityConfirm` | `CloudAccessGate allowMembershipRequest` | 757-761 |
| `tests/perf/long-thread` | `IssueChatLongThreadPerf` | yok | 762 |
| `ux-lab/bootstrap-setup`, `ux-lab/responsible-user-denial`, `ux-lab/cross-issue-collaboration` | UX lab sayfaları | yok | 763-765 |
| kök yol `/` | `CompanyRootRedirect`, `/{PREFIX}/dashboard` adresine yönlendirir | `CloudAccessGate` | 767-768, 628-650 |
| `onboarding` | `OnboardingRoutePage` | `CloudAccessGate` | 769 |
| `instance`, `instance/settings`, `instance/settings/*` | `LegacySettingsRedirect` | `CloudAccessGate` | 770-772 |
| Şirket kodu taşımayan yönetim kurulu yolları (`issues`, `agents`, `projects`, `routines`, `skills/*`, `decisions`, `artifacts`, `u/:userSlug` ve diğerleri) | `UnprefixedBoardRedirect` | `CloudAccessGate` | 773-830 |
| `execution-workspaces/:workspaceId` ve beş alt yol | `UnprefixedExecutionWorkspaceRedirect` | `CloudAccessGate` | 831-836 |
| `:companyPrefix` | `Layout` ya da `ProductionLayout`; alt yollar `boardRoutes()` işlevinden gelir | `CloudAccessGate` | 837-839 |
| `*` | `NotFoundPage scope="global"` | `CloudAccessGate` | 840 |

`<OnboardingWizardVariant />`, `<Routes>` öğesinin yanında çizilir (`ui/src/App.tsx:843`). Deneysel ayarlar sorgusu gelene kadar, kapıya bağlı dallar kapının yerine `PaperclipLoading` çizer (`757, 767`).

### 3.4 Yönetim kurulu yolları

Bütün yollar `/:companyPrefix` köküne göredir. Kaynak: `ui/src/App.tsx:148-441` içindeki `boardRoutes()`. "S" işareti, sade kabukta ve eski kabukta farklı olan öğeleri gösterir.

| Yol | Öğe | Not | Satırlar |
|---|---|---|---|
| (kök yol) | `dashboard` adresine yönlendirme | | 151 |
| `dashboard` | `Dashboard` | | 152 |
| `dashboard/live` | `DashboardLive` | | 153 |
| `timeline` | S: `/activity/timeline` adresine yönlendirme; eski kabukta `Timeline` | | 154-157 |
| `onboarding` | `OnboardingRoutePage` | | 158 |
| `companies` | `Companies` | | 159 |
| `company/settings` | `CompanySettings` | | 160 |
| `company/settings/environments`, `company/settings/cloud-upstream` | yönlendirmeler | | 161-162 |
| `company/settings/members`, `company/settings/access` | `CompanyAccess`, `CompanyAccessLegacyRoute` | `HiddenSettingsPageGate company.members` | 163-166 |
| `company/settings/invites` | `members?tab=invites` adresine yönlendirme | `HiddenSettingsPageGate company.invites` | 169-174 |
| `company/export/*` | tembel yüklenen `CompanyExport` | `HiddenSettingsPageGate company.export` | 175-184 |
| `company/import` | `CompanyImport` | `CloudManagedPageGate`, `HiddenSettingsPageGate company.import` | 185-189 |
| `company/settings/secrets` | `Secrets` | `HiddenSettingsPageGate company.secrets` | 190-192 |
| `company/settings/tools(/:tab)`, `tools(/:tab)` | `/apps` altına giden eski yönlendirmeler | | 193-196, 544-550 |
| `apps` | `Browse` | kenar çubuğundaki adı "Connectors" | 197 |
| `apps/byo`, `apps/vercel-connect`, `apps/connect` | `AppsConnect` çeşitleri | | 200-205 |
| `apps/chat/connect`, `apps/chat/:endpointId(/:tab)` | `ChatEndpointSetup`, `ChatEndpointDetail` | `ChatConnectorsExperimentalGate` (bayrak `enableChatConnectors`) | 206-214 |
| `apps/review` | `AppsReview` | | 217 |
| `apps/gateways`, `apps/gateways/:gatewayId(/:tab)` | `GatewaysList`, `GatewayDetail` | | 220-222 |
| `apps/advanced...` | `AdvancedToolsRoute`, `ProfileWizardRoute`, `ProfileDetailRoute` | | 223-230 |
| `apps/app/:applicationId(/:tab)` | `AppNotConnected` | | 231-232 |
| `apps/:connectionId(/:tab)` | önce `permissions` adresine yönlendirme, sonra `AppDetail` | | 233-234 |
| `company/settings/instance/profile` | `ProfileSettings` | kapı `instance.profile` | 236-238 |
| `company/settings/instance/environments` (+ `new`, `:environmentId/edit`) | `CompanyEnvironments` | kapı `instance.environments` | 241-245 |
| `company/settings/instance/access` | `InstanceAccess` | kapı `instance.access` | 246-248 |
| `company/settings/instance/experimental` | `InstanceExperimentalSettings` | kapı `instance.experimental` | 249-251 |
| `company/settings/instance/plugins(/:pluginId)` | `PluginManager`, `PluginSettings` | kapı `instance.plugins` | 252-255 |
| `company/settings/instance/adapters` | `AdapterManager` | kapı `instance.adapters` | 256-258 |
| `company/settings/:settingsRoutePath/*` | `CompanySettingsPluginPage` | eklenti sayfaları | 259 |
| `skills/sources(/:sourceId)` | `SkillSources` | | 260-261 |
| `skills/studio`, `skills/studio/new`, `skills/studio/:skillId` | `SkillStudio` | | 262-264 |
| `skills/*` | S `CompanySkills`; eski kabukta tembel yüklenen eşi | | 266-269 |
| `settings`, `settings/*` | `LegacySettingsRedirect` | | 270-271 |
| `plugins/:pluginId` | `PluginPage` | | 272 |
| `org` | S: `/agents/all` adresine yönlendirme; eski kabukta `OrgChart` | | 273-276 |
| `agents` | `/agents/all` adresine yönlendirme | | 277 |
| `agents/all`, `active`, `paused`, `error`, `builtin` | `Agents` | sekmeler `AGENT_FILTER_TABS` sabitinden gelir, `ui/src/pages/Agents.tsx:52` | 278-284 |
| `agents/new` | `NewAgent` | | 285 |
| `agents/:agentId`, `/:tab`, `/runs/:runId` | `AgentDetail` | | 286-288 |
| `projects` | `Projects` | | 289 |
| `projects/:projectId` (+ `overview`, `issues`, `issues/:filter`, `workspaces`, `configuration`, `budget`) | `ProjectDetail` | | 290-299 |
| `projects/:projectId/workspaces/:workspaceId` | `ProjectWorkspaceDetail` | `IsolatedWorkspacesRouteGate` (bayrak `enableIsolatedWorkspaces`) | 294-296 |
| `workspaces` | `Workspaces` | aynı kapı | 300-302 |
| `issues` | `Issues` | kenar çubuğundaki adı "Tasks" | 303 |
| `tasks`, `issues/all`, `active`, `backlog`, `done`, `recent` | `/issues` adresine yönlendirme | | 304, 306-310 |
| `search` | `Search` | | 305 |
| `chats`, `chats/:agentRef` | `AgentChats`, `AgentChat` | `AgentChat`, `enableAgentChat` bayrağını kendisi denetler (`ui/src/pages/AgentChat.tsx:18`) | 311-312 |
| `issues/:issueId` | `IssueDetail` | | 313 |
| `routines`, `routines/:routineId(/:section)` | S `Routines`, `RoutineDetail`; eski kabuktaki eşleri | | 317, 369-370 |
| `cases`, `cases/:caseIdentifier` | `Cases`, `CaseDetail` | `CasesExperimentalGate` (bayrak `enableCases`) | 318-325 |
| `status`, `status/:cardId` | `StatusCards` | `StatusCardsExperimentalGate` (bayrak `enableStatusCards`) | 326-333 |
| `review-queue`, `learnings`, `pipelines...` | Pipelines sayfaları | `PipelinesExperimentalGate` (bayrak `enablePipelines`) | 337-368 |
| `execution-workspaces/:workspaceId` (+ 5 alt yol) | `ExecutionWorkspaceDetail` | `IsolatedWorkspacesRouteGate`, `ExecutionWorkspaceCompanyGate` | 371-380 |
| `goals`, `goals/:goalId` | `Goals`, `GoalDetail` | kenar çubuğu bağlantısı `enableGoalsSidebarLink` bayrağına bağlı; yolun kendisinde kapı yok | 381-382 |
| `artifacts` | `Artifacts` | | 383 |
| `approvals` | `/approvals/pending` adresine yönlendirme | | 384 |
| `approvals/pending`, `approvals/all` | `Approvals` | | 385-386 |
| `approvals/:approvalId` | `ApprovalDetail` | | 387 |
| `activity` | S `CompanyActivity`; eski kabuktaki eşi | kenar çubuğundaki adı "Audit" | 388 |
| `activity/runs`, `costs`, `budgets`, `timeline` | yalnızca S: `AuditHub section=...` | | 391-394 |
| `audit`, `audit/*`, `runs`, `costs`, `budgets` | S: `/activity...` altına yönlendiren `AuditCompatibilityRedirect` | | 395-403 |
| `costs`, `audit` | yalnızca eski kabuk: `Costs`, yönlendirme | | 407-408 |
| `board-chat` (ve `artifacts` yolunun ikinci bir tanımı) | `BoardChat` | `ConferenceRoomChatGate` (bayrak `enableConferenceRoomChat`) | 416-419 |
| `decisions`, `decisions/queues/:key` | `WhatNeedsMe`, `DecisionQueuePage` | menü satırı `enableDecisions` bayrağına bağlı; yol kapısı yok ve `WhatNeedsMe.tsx` içinde bayrağa hiç başvurulmuyor | 424-425 |
| `inbox` | `InboxRootRedirect`, son kullanılan sekmeye yönlendirir | anahtar `paperclip:inbox:last-tab`, `ui/src/lib/inbox.ts:24` | 426, 456-458 |
| `inbox/mine`, `recent`, `unread`, `blocked`, `all` | `Inbox` | | 427-431 |
| `inbox/requests` | `JoinRequestQueue` | | 432 |
| `u/:userSlug` | `UserProfile` | | 434 |
| `design-guide` | `DesignGuide` | yaşayan stil kılavuzu sayfası | 435 |
| `:pluginRoutePath/*` | `PluginPage` | eklenti sayfaları için yakalayıcı yol | 437 |
| `*` | `NotFoundPage scope="board"` | | 438 |

Yalnızca geliştirme ortamında bulunan iki yol vardır: `tests/perf/long-thread` ve `dev/task-chat-lab` (`ui/src/App.tsx:314-316, 421-423`).

### 3.5 Şirket kodunun işleyişi

- Kod, şirketin `issuePrefix` değeridir ve büyük harfe çevrilir (`ui/src/lib/company-routes.ts:38-40`).
- `applyCompanyPrefix(path, prefix)`; göreli yollara, genel yollara ve zaten kod taşıyan yollara dokunmaz, diğer durumlarda `/{PREFIX}{pathname}{search}{hash}` döndürür (`ui/src/lib/company-routes.ts:79-90`).
- "Global" (genel) kökler şunlardır: `auth`, `invite`, `board-claim`, `cli-auth`, `docs`, `instance` (`ui/src/lib/company-routes.ts:36`). Yolun ilk parçası genel bir kök değilse ve `BOARD_ROUTE_ROOTS` içinde sayılan yönetim kurulu köklerinden biri de değilse (32 girdi, `artifacts` iki kez yazılmış) şirket kodu sayılır (`1-34, 69-77`).
- Etkin kod önce yol parametresinden, o yoksa yolun kendisinden, o da yoksa seçili şirketten alınır (`ui/src/lib/router.tsx:30-43`).
- Kod taşımayan doğrudan bağlantılar seçili şirkete, o yoksa ilk şirkete yönlendirilir (`ui/src/App.tsx:673-700`).
- `Layout`, adres ile seçili şirketi eşitler: bilinmeyen bir kod "Organization not found" sayfasını gösterir (`ui/src/components/Layout.tsx:151-152, 767-771`); harf büyüklüğü yanlış yazılmış kod doğru yazımıyla değiştirilir (`297-301`); sayfa doğrudan arşivlenmiş bir şirketin adresiyle açılırsa bir bildirim gösterilir ve etkin bir şirkete geçilir (`307-322`); diğer durumlarda şirketi yol seçer (`324-332`).
- Seçili şirketin kimliği `localStorage` içinde `paperclip.selectedCompanyId` anahtarıyla saklanır (`ui/src/context/CompanyContext.tsx:48`). Her şirket için son ziyaret edilen yol `paperclip.companyPaths` anahtarıyla saklanır; seçim, yol eşitlemesi dışındaki bir nedenle değiştiğinde bu yol geri yüklenir (`ui/src/hooks/useCompanyPageMemory.ts:11, 52-58, 61-78`).

### 3.6 Kapılar ve bayraklar

| Kapı | Koşul | Engellenince sonuç | Kanıt |
|---|---|---|---|
| `CloudAccessGate` | sağlık, oturum ve yönetim kurulu erişimi sorguları | hata sayfası, yükleme işareti, bulut girişi, başlangıç kurulumu sayfası, `/auth?next=...` adresine yönlendirme ya da "No organization access" | `ui/src/components/CloudAccessGate.tsx:156-211` |
| `HiddenSettingsPageGate pageKey` | `health.hiddenSettings` anahtarı içeriyorsa | `/company/settings` adresine yönlendirme | `ui/src/components/HiddenSettingsPageGate.tsx:15`, `ui/src/hooks/useHiddenSettings.ts:24` |
| `CloudManagedPageGate` | `health.cloud` varsa | `/company/settings` adresine yönlendirme | `ui/src/components/CloudManagedPageGate.tsx:15` |
| `PipelinesExperimentalGate` | `enablePipelines !== true` | `/dashboard` adresine yönlendirme | `ui/src/components/PipelinesExperimentalGate.tsx:14` |
| `CasesExperimentalGate` | `enableCases !== true` | `/dashboard` adresine yönlendirme | `ui/src/components/CasesExperimentalGate.tsx:18` |
| `StatusCardsExperimentalGate` | `enableStatusCards !== true` | `/dashboard` adresine yönlendirme | `ui/src/components/StatusCardsExperimentalGate.tsx:14` |
| `IsolatedWorkspacesRouteGate` | `enableIsolatedWorkspaces !== true` | `/dashboard` adresine yönlendirme | `ui/src/components/IsolatedWorkspacesRouteGate.tsx:26` |
| `ConferenceRoomChatGate` | `enableConferenceRoomChat !== true` | `/dashboard` adresine yönlendirme | `ui/src/components/ConferenceRoomChatGate.tsx:16`, `ui/src/hooks/useConferenceRoomChatEnabled.ts:44` |
| `ChatConnectorsExperimentalGate` | `enableChatConnectors !== true` | `/apps` adresine yönlendirme (varsayılan e-posta uç noktası hariç) | `ui/src/components/ChatConnectorsExperimentalGate.tsx:34`, `ui/src/hooks/useChatConnectorsEnabled.ts:28` |

`CloudAccessGate`, sunucu başlarken ya da sunucuya ulaşılamazken sağlık durumunu 5 s'de bir, başlangıç kurulumu sırasında 2 s'de bir yoklar (`ui/src/components/CloudAccessGate.tsx:18, 72-85`). Bağlantı hatalarında önbellekteki erişim bilgisini korur; böylece düzenleyiciler ekrandan kaldırılmaz (`128-131`). Yeniden bağlanırken uygulamanın üstünde "Connection interrupted. Reconnecting automatically" şeridini gösterir (`213-222`).

Deneysel bayrakların hepsi `InstanceExperimentalSettings` tipinden gelir (`packages/shared/src/types/instance.ts:42-92`) ve `["instance", "experimental-settings"]` sorgu anahtarıyla okunur (`ui/src/lib/queryKeys.ts:623`).

## 4. Uygulama kabuğu

### 4.1 Çerçeve

`Layout({ sidebarSections })`, `:companyPrefix` yolunun öğesidir (`ui/src/components/Layout.tsx:82`). Geniş ekran yapısı (`618-795`):

```
div  "bg-background text-foreground pt-(--sz-safe-top)" + "flex h-dvh flex-col overflow-clip"
  a  skip link "Skip to Main Content"
  WorktreeBanner
  DevRestartBanner
  div  "min-h-0 flex-1" + "flex overflow-clip"
    SidebarShell (resizable)
      div "flex flex-1 min-h-0"  ->  Sidebar, or SecondarySidebar when it replaces the primary one
      SidebarAccountMenu
    div  "flex min-w-0 flex-col" + "h-full flex-1"
      div  ->  StandaloneBrowserControls, BreadcrumbBar          (hidden on task detail and chat)
      div  "flex flex-1 min-h-0"
        SecondarySidebar "w-60 shrink-0 bg-background"           (second rail, some routes)
        BreadcrumbBar taskDetailLayout                           (task detail and chat only)
        main#main-content "flex-1 p-4 outline-none md:p-6" + "overflow-auto [scrollbar-gutter:stable]"
          RouteErrorBoundary > Outlet
        PropertiesPanel
  MobileBottomNav (mobile only)
  CommandPalette, NewIssueDialog, NewProjectDialog, NewGoalDialog, NewAgentDialog,
  KeyboardShortcutsCheatsheet, ToastViewport, AnnouncementWell, PluginAppShellOverlays
```

Başlıca sınıf dizgileri (birebir):

| Öğe | Sınıflar | Satırlar |
|---|---|---|
| Kök | `bg-background text-foreground pt-(--sz-safe-top)`; telefonda `min-h-dvh overflow-x-clip`; geniş ekranda `flex h-dvh flex-col overflow-clip` | 620-628 |
| Atlama bağlantısı | `sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-(--z-200) focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg ...` | 630-635 |
| Satır | `min-h-0 flex-1`; geniş ekranda `flex overflow-clip`; telefonda `w-full` | 638 |
| Telefonda karartma katmanı | `fixed inset-0 z-40 bg-black/50` | 639-646 |
| Telefon çekmecesi | `fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden pt-(--sz-safe-top) transition-transform duration-100 ease-out` + `translate-x-0` ya da `-translate-x-full`; iç kap `w-60 shrink-0 overflow-hidden` | 649-668 |
| İçerik sütunu | `flex min-w-0 flex-col`; geniş ekranda `h-full flex-1`; telefonda `w-full` | 700 |
| Telefon üst çubuğu sarmalayıcısı | `sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85` | 704 |
| Ana içerik | `flex-1 p-4 outline-none md:p-6`; geniş ekranda `overflow-auto [scrollbar-gutter:stable]`; telefonda `overflow-visible pb-(--sz-calc-14)` | 731-766 |

Geniş ekranda `document.body.style.overflow` değeri `clip` yapılır (`551-559`) ve belgenin kaydırma konumu sıfıra sabitlenir; böylece `scrollIntoView` kabuğu kaydıramaz (`561-570`). Telefonda belgenin kendisi kayar.

### 4.2 Ölçüler

| Bölge | Değer | Kanıt |
|---|---|---|
| Telefon kırılma noktası | 768 px'in altındaki genişlik | `ui/src/context/SidebarContext.tsx:37-41` |
| Ana kenar çubuğu genişliği | varsayılan 240, en az 208, en çok 420, klavye adımı 16 px | `ui/src/components/SidebarShell.tsx:15-18` |
| Kenar çubuğu genişliğinin saklandığı yer | `localStorage["paperclip.sidebar.width"]` | `ui/src/components/SidebarShell.tsx:97, 32-54` |
| Kenar çubuğu boyutlandırma tutamağı | `right: -4` konumunda 8 px genişliğinde tıklama alanı, `role="separator"`; üzerine gelince, odakta ve sürüklerken 2 px'lik `bg-ring` çizgisi | `ui/src/components/SidebarShell.tsx:219-247` |
| Kenar çubuğunun açılıp kapanması | anında, genişlik geçişi yok | `ui/src/components/SidebarShell.tsx:87-89, 202-203` |
| Telefon çekmecesi ve ikinci kenar çubuğu | `w-60` (240 px) | `ui/src/components/Layout.tsx:656, 720` |
| Kenar çubuğu başlığının ve konum bilgisi çubuğunun yüksekliği | `h-(--sz-60px)`, 60 px | `ui/src/components/Sidebar.tsx:133`, `ui/src/components/BreadcrumbBar.tsx:93`, `ui/src/index.css:2579` |
| Ana içeriğin iç boşluğu | 16 px, `md` kırılma noktasından itibaren 24 px | `ui/src/components/Layout.tsx:750` |
| Özellik paneli | varsayılan 322 px, görev ayrıntısında 434 px, en az 260 px; geri kalana 656 px bırakır; büyütülmüş içerik en çok 840 px olur | `ui/src/components/PropertiesPanel.tsx:83-89, 97-103` |
| Özellik paneli (klasik görev arayüzü) | sabit 320 px | `ui/src/components/PropertiesPanel.tsx:26-45` |
| Telefon alt menüsü | beş gözlü `h-16` ızgara ve alttaki güvenli alan | `ui/src/components/MobileBottomNav.tsx:64, 69` |
| Bildirim alanı | `fixed bottom-3 left-3`, `max-w-sm` | `ui/src/components/ToastViewport.tsx:104` |
| Şirket ve profil açılır menüleri | 248 px genişlik | `ui/src/index.css:337, 345` |
| Komut paleti | pencere `sm:max-w-lg`, liste en çok 300 px yüksekliğinde, giriş alanı 48 px | `ui/src/components/ui/dialog.tsx:62`, `ui/src/components/ui/command.tsx:56, 103` |

Kabuğun kullandığı katman sırası: telefonda yapışkan üst çubuk `z-20`, kenar çubuğu boyutlandırma tutamağı `z-20`, alt menü `z-30`, telefondaki karartma katmanı ve duyuru kutusu `z-40`, telefon çekmecesi ve bütün Radix üst katmanları `z-50`, bildirimler `--z-120`, atlama bağlantısı `--z-200` (`ui/src/index.css:2864-2870` ve yukarıda verilen sınıf dizgileri).

### 4.3 Ana kenar çubuğu

`Sidebar({ children })`, `ui/src/components/Sidebar.tsx:53-283` aralığındadır. Kap: `w-full h-full min-h-0 flex flex-col` sınıflarını ve `primary-sidebar-surface` yüzey sınıfını taşıyan bir `aside` (`120-127`). Kayan kap `nav` öğesidir: `flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-auto-hide px-3 py-2 pointer-coarse:gap-3` (`ui/src/components/primary-sidebar-styles.ts:7`). Üstündeki şirket başlığı ve altındaki hesap menüsü kaymaz.

Satırlar, tam sırasıyla (sade kabuk):

| # | Etiket | lucide simgesi | Hedef | Ne zaman görünür | Rozet ya da gösterge |
|---|---|---|---|---|---|
| 0 | (şirket menüsü) | `ChevronsUpDown` + şirketin desen simgesi | açılır menü | her zaman | yok (`Sidebar.tsx:133-135`) |
| 1 | Yeni görev | `SquarePen` | yeni görev penceresini açar | her zaman | yok (`140-162`) |
| 2 | Ara | `Search` | `/search` | her zaman | yok (`167`) |
| 3 | Genel bakış | `LayoutDashboard` | `/dashboard` | her zaman | `liveCount` = süren çalışma sayısı; yanıp sönen mavi bir nokta ve "N live" yazısıyla gösterilir (`168`) |
| 4 | Gelen kutusu | `Inbox` | `/inbox` | her zaman | sayı rozeti `inboxBadge.inbox`; `failedRuns > 0` olduğunda rozet kırmızıya döner ve simgenin üzerinde kırmızı bir uyarı noktası çıkar (`169-177`) |
| 5 | Sohbet | `MessageCircle` | `/chats` | bayrak `enableAgentChat` | yok (`178`) |
| 6 | Decisions | `ListChecks` | `/decisions` | bayrak `enableDecisions` | ilgi bekleyenler akışından gelen sayı rozeti, 60 s'de bir yeniden çekilir (`100-107, 179-187`) |
| 7 | Durum | `LayoutGrid` | `/status` | bayrak `enableStatusCards` | "beta" metin rozeti (`188-190`) |
| 8 | Conference Room | `MessagesSquare` | `/board-chat` | bayrak `enableConferenceRoomChat` | yok (`191-193`) |
| | "Work" bölümü (açılıp kapanabilir) | | | | (`196`) |
| 9 | Görevler | `CircleCheck` | `/issues` | her zaman | yok (`197`) |
| 10 | Projeler | `FolderOpen` | `/projects` | yalnızca sade kabukta | ardından yıldızlı projeler girintili satırlar olarak gelir (`198-203`) |
| 11 | Rutinler | `Repeat` | `/routines` | her zaman | yok (`204`) |
| 12 | Çıktılar | `Package` | `/artifacts` | her zaman | yok (`205`) |
| 13 | Cases | `Layers` | `/cases` | bayrak `enableCases` | "beta" metin rozeti (`206-208`) |
| 14 | Pipelines | `GitBranch` | `/pipelines` | bayrak `enablePipelines` | yok (`209-211`) |
| 15 | Hedefler | `Target` | `/goals` | bayrak `enableGoalsSidebarLink`; ayarlar yüklenirken satırın yerini boş bir `h-8` yer tutucu tutar | yok (`212-220`) |
| 16 | Çalışma alanları | `GitBranch` | `/workspaces` | bayrak `enableIsolatedWorkspaces` | yok (`221-223`) |
| | eklenti `sidebar` yuvaları | | | eklentiler | (`224-236`) |
| | "Org" bölümü (açılıp kapanabilir, yalnızca sade kabukta) | | | | (`239-249`) |
| 17 | Ajanlar | `Users` | `/agents` | her zaman | yok (`244`) |
| 18 | Skill'ler | `Boxes` | `/skills` | her zaman | yok (`245`) |
| 19 | Bağlayıcılar | `Unplug` | `/apps` | her zaman | yok (`246`) |
| 20 | Denetim | `History` | `/activity` | her zaman | yok (`247`) |
| | `children` (barındıran bileşenin verdiği ek bölümler) | | | | (`251`) |
| | "Recent Tasks" bölümü | | `/issues/{id}` | en az bir kayıt varsa | her görev için canlı nokta, satır sonunda "Idle" yazısı (`253-254`) |
| | eklenti `sidebarPanel` yuvaları | | | eklentiler | (`273-279`) |

Notlar:

- Kenar çubuğunda Onaylar ve Ayarlar satırı yoktur. Ayarlara hesap menüsünden ulaşılır (`ui/src/components/SidebarAccountMenu.tsx:232-237`). Onaylar yol olarak vardır (`ui/src/App.tsx:384-387`) ve bekleyen onaylar Gelen kutusu rozetindeki sayıya katılır (`ui/src/lib/inbox.ts:1284-1289, 1313`).
- Bölümlerin açık mı kapalı mı olduğu sıradan React state'inde tutulur; bölümler varsayılan olarak açıktır ve bu bilgi saklanmaz (`ui/src/components/Sidebar.tsx:56-59`).
- Eski kabuktaki farklar: yüzey `border-r border-border bg-background` sınıflarını taşır (`125`); "Org" bölümü ile "Recent Tasks" yerine `SidebarProjects`, `SidebarAgents` ve bir "Organization" bölümü gelir. Bu bölümde Organizasyon (`Network`), Bağlayıcılar, Zaman çizelgesi (`GanttChartSquare`), Maliyet (`DollarSign`), Etkinlik ve Ayarlar satırları bulunur (`256-270`).

Rozetlerin veri kaynakları:

| Gösterge | Kaynak | Yenileme |
|---|---|---|
| Genel bakış satırındaki "N live", son görevlerdeki canlı noktalar | `queryKeys.liveRuns` anahtarı altında `heartbeatsApi.liveRunsForCompany(companyId)` | aralık yok; canlı olaylarla güncel tutulur; veriyi yalnızca sekmeler arası lider sekme çeker (`ui/src/components/Sidebar.tsx:69-91`) |
| Gelen kutusu rozeti | tarayıcıda hesaplanır: karar bekleyen onaylar + bekleyen katılma istekleri + her ajanın en son başarısız çalışması + benim işlem yaptığım okunmamış görevler | `ui/src/hooks/useInboxBadge.ts:180-275`, `ui/src/lib/inbox.ts:1265-1320` |
| Decisions rozeti | `attentionApi.list(companyId)` | 60 s'de bir (`ui/src/components/Sidebar.tsx:101-107`) |
| Ayarlardaki "Members" rozeti | `GET /companies/{id}/sidebar-badges` yanıtındaki `joinRequests` alanı | 15 s'de bir (`ui/src/components/CompanySettingsSidebar.tsx:57-74, 119`, `ui/src/api/sidebarBadges.ts:5`) |

### 4.4 Menü satırı

`SidebarNavItem` (`ui/src/components/SidebarNavItem.tsx:33-231`).

Prop'lar: `to`, `label`, `icon?: LucideIcon`, `iconNode?`, `end?`, `className?`, `labelClassName?`, `badge?: number`, `badgeTone?: "default" | "danger" | "warning"`, `badgeLabel?`, `textBadge?`, `textBadgeTone?: "default" | "amber"`, `alert?`, `liveCount?`, `active?`, `trailing?`, `trailingLabel?`, `liveAccessory?` (`33-68`).

```tsx
// ui/src/components/SidebarNavItem.tsx:129-132
"flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium transition-colors",
(active ?? isActive)
  ? "bg-sidebar-accent text-sidebar-accent-foreground"
  : "text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
```

- Simge: `h-4 w-4`; `relative shrink-0` ile sarılır (`137-139`).
- Uyarı noktası: `absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500`; çevresinde kenar çubuğu renginde 2 px'lik bir halka vardır (`140-146`, `ui/src/index.css:2729`).
- Metin rozeti: `Badge variant="ghost"`; `ml-auto px-1.5 text-(length:--text-nano) leading-none` sınıflarıyla, `bg-muted text-muted-foreground` ya da sarı renkte (`172-183`).
- Canlı gösterge: `animate-pulse` haleli, 2x2 boyutunda bir `bg-blue-600 dark:bg-blue-400` nokta ve `text-(length:--text-micro) font-medium text-blue-600 dark:text-blue-400` sınıflarıyla yazılan `{liveCount} live` metni (`184-197`).
- Sayı rozeti: `Badge variant="ghost"` `ml-auto px-1.5 leading-none`; varsayılan tonda `bg-primary text-primary-foreground`, tehlike tonunda `bg-red-600/90 text-red-50`, uyarı tonunda `bg-amber-500/90 text-amber-50` (`198-211`).
- Bağlantı `state={SIDEBAR_SCROLL_RESET_STATE}` değerini iletir; böylece kenar çubuğundan gezinince ana içeriğin kaydırma konumu sıfırlanır (`119`, `ui/src/lib/navigation-scroll.ts:3-20`). Bağlantı telefonda çekmeceyi de kapatır (`122`).
- Etkin durum için `NavLink` bileşeninin işlev biçimindeki `className` özelliği kullanılır (`123`). Koddaki yoruma göre Radix `asChild`, işlev biçimindeki `className` değerini düşürür; ipuçlarının bir `div` öğesini sarmasının nedeni budur (`217-229`).

### 4.5 Bölüm

`SidebarSection` (`ui/src/components/SidebarSection.tsx:186-241`). Prop'lar: `label`, `children`, `collapsible?: { open, onOpenChange }`, `menu?` (eylemler ve bir radyo grubu içeren açılır menü), `headerAction?: { ariaLabel, icon, onClick }` (`40-64`).

- Etiket: `text-(length:--text-nano) font-medium uppercase tracking-widest font-mono text-muted-foreground/60` (`77`). Yani 10 px, eş aralıklı ve büyük harfli.
- Başlık sarmalayıcısı: `group/sidebar-section px-3 py-1.5 pointer-coarse:py-1`; iç kap `relative flex min-h-6 min-w-0 items-center gap-1` (`155-156`).
- Ok işareti: `absolute -left-4` konumunda `ChevronRight` `h-3 w-3`; açıkken 90 derece döner; geniş ekranda yalnızca üzerine gelince ya da odaktayken, telefonda her zaman görünür (`78-86, 157-168`).
- İçerik: `flex flex-col gap-0.5 mt-0.5` (`196`); bölüm açılıp kapanabiliyorsa Radix `Collapsible` ile sarılır (`221-232`).

### 4.6 Şirket menüsü

`SidebarCompanyMenu` (`ui/src/components/SidebarCompanyMenu.tsx:147-412`); bir eklenti yerine geçebilsin diye `PluginOrganizationSwitcher` ile sarılmıştır (`147-153`).

- Tetikleyici: ghost çeşidinde `Button`, `h-9 min-w-0 flex-1 justify-start gap-2 px-4 text-left hover:bg-sidebar-accent ...`; içeriği bir `CompanyPatternIcon` (`size-5 rounded-md`), `text-sm font-bold` ile yazılan ve sığmazsa kısaltılan şirket adı ve `ChevronsUpDown` `size-3.5` (`52, 258-292`).
- Menü: `DropdownMenuContent align="start" sideOffset={8}`; sınıfları `ml-2 w-(--organization-popover-width) max-w-(--sz-calc-24) overflow-hidden rounded-xl border-border bg-popover p-0 shadow-(--shadow-profile-popover)` (`294-298`).
- Başlık satırı: "Organizations" yazısı ve "Edit" / "Done" arasında değişen bir düğme (`299-314`).
- Liste: `max-h-96` yüksekliğini aşınca kayar; her satır 44 px yüksekliğindedir; satırda 30 px'lik simge, ad, 10 px'lik soluk yazıyla şirket kodu ve seçili şirkette bir onay işareti bulunur (`55-56, 91-144, 315-335`, `ui/src/index.css:347-352`). Arşivlenmiş şirketler listeye alınmaz (`175-178`).
- Düzenleme modu: satırlar dnd-kit ile sürüklenebilir olur; fare için etkinleşme mesafesi 8 px, dokunma için gecikme 180 ms'dir (`167-174, 240-253`). Sıra, kullanıcı başına sunucuda saklanır: `GET` ve `PUT /sidebar-preferences/me` (`ui/src/hooks/useCompanyOrder.ts:43-99`, `ui/src/api/sidebarPreferences.ts:5-7`).
- Alt kısımdaki eylemler: "Create organization" (yönetilen bulutta gizli), "Invite people to {name}" (operatör üyeleri ya da davetleri gizlediyse gizli), "Sign out" (oturum varsa) (`360-408`).
- Liste boşken ve yüklenemediğinde ayrı metinler gösterilir: "No organizations" ve "Try again" düğmesiyle birlikte "Couldn't load organizations" (`336-358`).
- Bir şirket yolundayken başka bir şirket seçilince `/{PREFIX}/dashboard` adresine gidilir (`214-228`).

### 4.7 Hesap menüsü

`SidebarAccountMenu({ deploymentMode, open, onOpenChange, forceExpanded })` (`ui/src/components/SidebarAccountMenu.tsx:116-296`).

- Şerit: `bg-border/50 px-3 py-2 dark:bg-muted` (`172`).
- Tetikleyici: görsel ya da baş harfler içeren `Avatar size="sm"` ve görünen ad; satırın sınıfları menü satırınınkilerle aynıdır (`176-189`). Ad yoksa "Board" yazılır (`156`).
- Açılır menü: `side="top" align="start" sideOffset={10}`, `min-h-(--profile-popover-min-height) w-(--profile-popover-width) ... rounded-xl ... shadow-(--shadow-profile-popover)` (`191-196`). Ölçüler: genişlik 248 px, en az yükseklik 304 px, başlık 76 px, satırlar 38 px (`ui/src/index.css:337-343`).
- Başlık: 36 px'lik avatar, ad, e-posta (ya da "Signed in" / "Local workspace board"), isteğe bağlı olarak staging commit bağlantısı; başlığın tamamı profil sayfasına giden bir bağlantıdır (`198-229`).
- Eylemler, sırasıyla: Ayarlar (`/company/settings`), Davet (koşullu), Belgeler (dış bağlantı), tema değiştirme satırı, Çıkış (yalnızca `authenticated` kurulum modunda), `SidebarServerInfo` (bayrak `enableServerInfoDebugView`, `ui/src/components/SidebarServerInfo.tsx:85`) (`231-274`).
- Açılır menünün dışında: bulutta çalışmayan kurulumlarda `Flag` simgeli bir "Share feedback" bağlantısı (`277-292`).

### 4.8 Son görevler ve yıldızlı projeler

Son görevler (`ui/src/components/SidebarRecentTasks.tsx`):

- Şirket ve kullanıcı başına en çok beş kayıt tutulur; kayıtlar `localStorage` içinde `paperclip.recentTasks.v2:{companyId}:{userId or __local_board__}` anahtarıyla saklanır (`ui/src/lib/recent-tasks.ts:3-5, 26-29, 75-85`).
- Kayıt yoksa bölüm çizilmez (`118`).
- Her satır, görev başlığını taşıyan ve `/issues/{id}` adresine giden bir `SidebarNavItem` bileşenidir; görevin süren bir çalışması varsa `liveCount` 1 olur (`255-263`).
- Üzerine gelince beliren "more" (daha fazla) düğmesi (dokunmatik ekranda hep görünür) Yeniden adlandır, Arşivle ve Duraklat/Yeniden başlat seçeneklerinin bulunduğu bir menü açar (`264-306`); Yeniden adlandır seçeneği küçük bir pencere açar (`312-349`). Sonuçlar bildirimle duyurulur (`148, 168, 206, 234`).
- Bu düğme, `.sidebar-action-row`, `.sidebar-action-link`, `.sidebar-action-menu` yardımcı sınıflarıyla satırın sonunda yavaşça belirir (`ui/src/index.css:1054-1085`).

Yıldızlı projeler (`ui/src/components/SidebarStarredProjects.tsx`): Projeler satırının hemen altında, ada göre sıralı çizilir; her satır `/projects/{ref}/issues` adresine giden, `pl-6` girintili ve `ProjectTile size="xs"` taşıyan bir `NavLink` bileşenidir (`59-70, 116-137`). Üyelikler yüklenene kadar ya da yıldızlı proje yoksa hiçbir şey çizilmez (`99-104`). Geniş ekranda üzerine gelince göze batmayan bir yıldızı kaldırma düğmesi görünür; dokunmatik ekranda "Remove from starred" ve "Leave project" seçeneklerini içeren bir menü çıkar (`152-212`).

Eski kenar çubuğu listeleri (yalnızca eski kabukta): `SidebarProjects`, Üst (Top) / Alfabetik / Son sıralamalarını ve sürükleyerek yeniden sıralamayı destekler; sıra sunucuda `/companies/{id}/sidebar-preferences/me` adresinde saklanır (`ui/src/components/SidebarProjects.tsx:52-54, 236`, `ui/src/hooks/useProjectOrder.ts:35, 49`). `SidebarAgents` son kullanılan üç ajanı gösterir ve süren çalışması olan ajanları 120 s listede tutar (`ui/src/components/SidebarAgents.tsx:66-72`); sıra ve sıralama modu `localStorage` içinde durur (`ui/src/lib/agent-order.ts:5-6`).

### 4.9 Bağlama özel kenar çubukları

`classifyShellRoute`, yolu bir yüzeyle eşler: `settings` (`company/settings`, `company/export`, `company/import`), `apps` (`apps`, `tools`), `agent` (ajan ayrıntısı; liste sekmeleri ve `new` hariç), `routine` (rutin ayrıntısı), `skills` (`ui/src/lib/shell-navigation.ts:25-57`).

| Yüzey | Bileşen | Sade kabuktaki yeri | İçerik |
|---|---|---|---|
| settings | `CompanySettingsSidebar` | aynı kabuğun içinde ana kenar çubuğunun yerini alır (`Layout.tsx:179-180, 227, 681-685`) | "Back to app" satırı, ardından Genel, Profil, Üyeler (rozetli), eklenti sayfaları, Gizli anahtarlar, Ortamlar, Erişim, Dışa aktarma, İçe aktarma, Deneysel, Eklentiler (+ iç içe eklenti bağlantıları), Adaptörler (`ui/src/components/CompanySettingsSidebar.tsx:95-201`) |
| agent | `AgentContextualSidebar` | ikinci kenar çubuğu | bölümler: Ajan (Genel bakış, Talimatlar, Skill'ler), Çalışma ortamı (Adaptör / Çalışma ortamı, Gizli anahtarlar, Araçlar, Kanallar), Yönetişim (İzinler / Güven, API anahtarları, Sürümler), Denetim (Etkinlik, Çalışmalar, Maliyet, Bütçe) (`ui/src/pages/agent-detail-navigation.ts:18-47`, `ui/src/components/AgentContextualSidebar.tsx:43-48`) |
| routine | `RoutineContextualSidebar` | ikinci kenar çubuğu | Genel bakış, Tetikleyiciler, Değişkenler, Teslim, Gizli anahtarlar, ardından "Operate" başlığı altında Çalışmalar, Etkinlik (`ui/src/components/RoutineContextualSidebar.tsx:38-44, 103-117`) |
| skills | `SkillsContextualSidebar` | ikinci kenar çubuğu | Yüklü, Keşfet, Kaynaklar, ardından "Author" başlığı altında Skill'lerim (`ui/src/components/SkillsContextualSidebar.tsx:38-77`) |
| apps | `AppsSidebar` (ya da `AppDetailSidebar`) | ikinci kenar çubuğu | Göz at, İnceleme (uyarı rozetli), isteğe bağlı "Developer" bölümü (`ui/src/components/AppsSidebar.tsx:40-77`) |
| chat | `AgentConversationsSidebar` | ikinci kenar çubuğu, bayrak `enableAgentChat` | ajan konuşmaları listesi (`ui/src/components/Layout.tsx:125, 211`) |
| plugin | bir eklenti yuvasını saran `ContextualSidebarFrame` | ana kenar çubuğunun yerini alır | eklenti içeriği (`ui/src/components/Layout.tsx:189-201`) |

Hangi yolların ana kenar çubuğunu koruyacağına `ui/src/components/Layout.tsx:219-228` içinde karar verilir. Telefonda çekmece, varsa bağlama özel kenar çubuğunu, yoksa ana kenar çubuğunu gösterir (`657-661`).

Ortak stil: `ContextualSidebarFrame`, `flex h-full min-h-0 w-full flex-col bg-muted` sınıflarını taşıyan bir `aside` öğesidir; isteğe bağlı bir başlığı vardır (şirket adını gösteren geri düğmesi, ardından simge ve kalın başlık) (`ui/src/components/ContextualSidebarFrame.tsx:43-69`). Geri düğmesi kullanıcının geldiği sayfaya döner; bu sayfa `sessionStorage` içinde `paperclip.contextualSidebar.origin:{PREFIX}:{surface}` anahtarıyla hatırlanır (`ui/src/lib/shell-navigation.ts:15, 59-106`, `ui/src/components/Layout.tsx:254-270`). İkinci kenar çubukları yüzeyi `border-r border-border bg-background` ile değiştirir. Bölüm etiketleri `px-2 pb-1 text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground` sınıflarını kullanır; bölümler `mt-4 border-t border-border pt-3` ile ayrılır (`ui/src/components/contextual-sidebar-styles.ts:7-15`).

### 4.10 Konum bilgisi çubuğu

State `BreadcrumbContext` içinde durur: `breadcrumbs`, `breadcrumbToolbar`, `breadcrumbPanelControl`, `mobileToolbar` ve bunların ayarlayıcı işlevleri (`ui/src/context/BreadcrumbContext.tsx:27-36`). Bir konum bilgisi öğesi `{ label, href?, onClick?, identifier?, leading?, leadingKey?, trailing?, trailingKey? }` biçimindedir (`3-25`).

Sayfalar konum bilgisi öğelerini bir effect içinde ayarlar:

```tsx
// ui/src/pages/GoalDetail.tsx:119-124
useEffect(() => {
  setBreadcrumbs([
    { label: "Goals", href: "/goals" },
    { label: goal?.title ?? goalId ?? "Goal" }
  ]);
}, [setBreadcrumbs, goal, goalId]);
```

Sağlayıcı ayrıca `document.title` değerini de ayarlar: öğe etiketleri ters sırayla, ardından şirket adı, ardından "Paperclip"; hepsi " • " ile birleştirilir (`ui/src/context/BreadcrumbContext.tsx:68-75, 100-102`).

Çizim (`ui/src/components/BreadcrumbBar.tsx:55-242`):

| Durum | Görünen | Satırlar |
|---|---|---|
| Telefon ve sayfa `mobileToolbar` ayarlamış | 60 px'lik çubukta yalnızca araç çubuğu, `px-2` | 83-89 |
| Öğe yok | yalnızca sağdaki araç çubuğunu taşıyan 60 px'lik çubuk | 91-97 |
| Tek öğe | `text-sm font-semibold uppercase tracking-wider truncate` sınıflı `h1` | 193-215 |
| Birden çok öğe | shadcn breadcrumb bileşeni, `flex-nowrap`, `ChevronRight` ayırıcılar; ilk öğenin bağlantısı `font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground` sınıflarını taşır; son öğe sığmazsa kısaltılır | 128-189, 218-241 |
| Telefonda görev ayrıntısı | menü düğmesi, ardından bir `h1` içinde etiket ve kimlik | 111-126 |

Çubuğun sınıfları: `h-(--sz-60px) shrink-0 flex items-center border-b border-border px-4 md:px-6`. Telefonda ghost çeşidinde bir `Menu` düğmesi (`h-5 w-5` simge) çekmeceyi açar (`99-109`). Öğenin `identifier` değeri `font-mono text-(length:--text-micro) text-muted-foreground` sınıflarıyla çizilir (`24-31`). Sağ taraf (`GlobalToolbar`), geniş ekranda sayfanın araç çubuğunu ve eklenti araç çubuğu yuvalarını gösterir (`33-53, 76-81`). Görev ayrıntısı düzeninde bir `PanelRightClose` / `PanelRightOpen` düğmesi özellik panelini açıp kapatır (`228-239`).

### 4.11 Özellik paneli

Context (`ui/src/context/PanelContext.tsx:6-23`): `panelContent`, `panelContentMode` (`"padded" | "prose" | "full-bleed"`), `panelVisible`, `openPanel(content, { contentMode? })`, `closePanel()`, `setPanelVisible`, `togglePanelVisible` ve tek seferlik bir büyütme isteği. Görünürlük `localStorage["paperclip:panel-visible"]` içinde saklanır; varsayılan görünürdür (`4, 27-42`).

Ayrıntı sayfaları paneli bir effect içinde açar, sayfa kaldırılırken kapatır:

```tsx
// ui/src/pages/GoalDetail.tsx:126-136
useEffect(() => {
  if (goal) {
    openPanel(<GoalProperties goal={goal} onUpdate={(data) => updateGoal.mutate(data)} />);
  }
  return () => closePanel();
}, [goal]);
```

`PropertiesPanel` (`ui/src/components/PropertiesPanel.tsx`):

- İçerik verilmemişse hiçbir şey döndürmez (`24`). Yalnızca geniş ekranda vardır: `hidden md:flex` (`29, 353`).
- Klasik çeşit (bayrak `enableClassicTaskInterface`): `border-l border-border bg-card` sınıflı bir `aside`, sabit 320 px; kapatma `X` düğmesi olan "Properties" başlığı; içerik `p-4` iç boşluklu bir `ScrollArea` içindedir; genişlik ve opaklık 200 ms süren bir animasyonla değişir (`26-45`).
- Varsayılan çeşit: sol kenarlıktaki tutamak sürüklenerek boyutlandırılır (`377-399`), çift tıklama genişliği varsayılana döndürür (`266-269`), genişlikler `taskChatRedesign.propertiesPaneWidth` ve `taskChatRedesign.taskDetailPropertiesPaneWidth` anahtarlarıyla saklanır (`81-82`). Büyütme, paneli `position: fixed` bir katmana çevirir; bu katman `.tc-pane-glide` geçişiyle (320 ms) içerik satırının sol kenarına kayar, yerinde kalan bir yer tutucu da yerleşimin yeniden akmasını önler (`271-349`, `ui/src/index.css:311, 1034`).
- Gövde bir `SidePanelFrame` bileşenidir; sayfaların portal aracılığıyla doldurduğu iki DOM yuvası vardır: `properties-pane-header-slot` ve `properties-pane-footer-slot` (`73, 79, 404-439`).

`ui/src/components/side-panel/`, alana özgü hiçbir şey içermeyen küçük bir bileşen takımıdır: `SidePanelFrame` (sunum `docked | sheet | embedded`, içerik modu `padded | prose | full-bleed`, başlık, alt kısım, sondaki denetimler), `SidePanelTabs`, `SidePanelTab`, `SidePanelLauncher`, `SidePanelWindowControls`, `useSidePanelTabs` (`ui/src/components/side-panel/index.ts:1-20`, `ui/src/components/side-panel/types.ts:3-51`, `ui/src/components/side-panel/SidePanelFrame.tsx:9-98`). README dosyası, bu bileşenlerin görev verisi, API, yönlendirme, bayrak ya da kalıcı saklama içe aktarmadığını söyler (`ui/src/components/side-panel/README.md:3`).

### 4.12 Komut paleti

`CommandPalette` (`ui/src/components/CommandPalette.tsx:91-451`); `CommandDialog` aracılığıyla `cmdk` üzerine kuruludur.

- `document` üzerindeki bir keydown dinleyicisi sayesinde Cmd+K ya da Ctrl+K ile açılır (`108-118`). Kenar çubuğunda arama düğmesi yoktur; aramaya `/` tuşu ya da Ara satırı götürür (`ui/src/components/Sidebar.tsx:163-167`).
- Yer tutucu metin: "Search tasks, agents, projects..." (`226`).
- Veri yalnızca palet açıkken çekilir: ajanlar, projeler, etiketler, oturum; bunlara ek olarak görev listesi ya da 10 sonuçla sınırlı bir sunucu araması (`124-172`).
- Gruplar, sırasıyla: metin yazılınca "Search all for ..." satırını içeren "Search" (`254-272`); arama işleci etiketlerini içeren "Quick filters" (`276-288`); öne çıkarılan "Projects" eşleşmeleri, tarayıcıda sıralanır, en çok 5 (`59, 196-212, 292-314`); "Actions": Yeni görev oluştur (kısayol ipucu "C"), Bu görevde dosya aç (görev ayrıntısında ve `enableExperimentalFileViewer` bayrağı açıksa), Yeni ajan oluştur, Yeni proje oluştur (`316-352`); "Pages": Genel bakış, Gelen kutusu, Görevler, Projeler, Hedefler, Ajanlar, Maliyet, Etkinlik (`356-389`); "Tasks" (10, projeler öne çıkarılmışsa 6) (`391-418`); "Agents" (10) (`420-433`); "Projects" (10, yalnızca hiçbir şey yazılmamışken) (`435-447`).
- Cmd ya da Ctrl ile birlikte Enter tam arama sayfasını açar; eşleşme yoksa tek başına Enter da aynısını yapar (`229-239`).
- "Pages" listesi kenar çubuğuyla uyumlu değildir: hâlâ "Costs" (`/costs`) ve "Activity" satırlarını sunar; kenar çubuğu ise bu alana "Audit" der (`381-388`, `ui/src/components/Sidebar.tsx:247`).

### 4.13 Oluşturma giriş noktaları

Pencereler `Layout` içine bir kez yerleştirilir (`ui/src/components/Layout.tsx:785-788`) ve `DialogContext` üzerinden açılır. Burada state ve eylemler iki ayrı context'te tutulur; böylece yalnızca eylemleri kullanan bileşenler yeniden çizilmez (`ui/src/context/DialogContext.tsx:73-74, 187-193`). API: `openNewIssue(defaults?)`, `openNewProject()`, `openNewGoal(defaults?)`, `openNewAgent()`, `openOnboarding(options?)` ve bunların kapatma işlevleri (`32-56`). Yeni görev için verilebilen varsayılanlar: `status`, `projectId`, `goalId`, `parentId`, `assigneeAgentId`, `assigneeUserId`, `title`, `description` (`4-21`).

Bulunan yeni görev giriş noktaları: kenar çubuğundaki "New Task" satırı (`ui/src/components/Sidebar.tsx:140-162`), `c` tuşu (`ui/src/hooks/useKeyboardShortcuts.ts:115-119`), palet eylemi (`ui/src/components/CommandPalette.tsx:317-326`), telefon alt menüsünün ortadaki düğmesi (`ui/src/components/MobileBottomNav.tsx:48`), görev listelerindeki grup başlıkları (`ui/src/components/IssuesList.tsx`), atananı dolu getiren ajan eylem düğmeleri (`ui/src/components/AgentActionButtons.tsx`), başlığı dolu getiren arama sayfası (`ui/src/pages/Search.tsx`), görev ayrıntısında ve Gelen kutusu ekranında alt görev oluşturma.

Yeni ajan giriş noktaları: palet eylemi (`ui/src/components/CommandPalette.tsx:339-347`) ve `agents/new` yolu (`ui/src/App.tsx:285`).

### 4.14 Telefon

- Kenar çubuğu ekran dışında duran bir çekmecedir ve varsayılan olarak kapalıdır (`ui/src/context/SidebarContext.tsx:40-41`). Konum bilgisi çubuğundaki menü düğmesiyle ya da sağa kaydırmayla açılır; kaydırma sol kenarın 30 px içinde başlamalı, en az 50 px ilerlemeli ve dikeyde en çok 75 px sapmalıdır. Sola kaydırmayla, karartma katmanına dokunmayla ya da herhangi bir menü satırına tıklamayla kapanır (`ui/src/components/Layout.tsx:473-516, 639-646`).
- `MobileBottomNav({ visible })`: `fixed bottom-0 left-0 right-0 z-30 bg-border/50 ... dark:bg-muted md:hidden pb-(--sz-safe-bottom)`; `transition-transform duration-200 ease-out` ile kayar (`ui/src/components/MobileBottomNav.tsx:62-66`). Öğeler: Ana sayfa (`House`, `/dashboard`), Görevler (`CircleCheck`, `/issues`), Yeni görev (`SquarePen`, eylem), Ajanlar (`Users`, `/agents/all`), Gelen kutusu (`Inbox`, `/inbox`, rozet en çok "99+" gösterir) (`44-59, 111-115`). Etiketler 10 px'tir; etkin öğe `text-foreground` rengindedir ve simgesinin çizgisi daha kalındır (`100-110`).
- Alt menü, 8 px'ten fazla aşağı kaydırılınca gizlenir; yukarı kaydırılınca ya da sayfanın tepesine 24 px kala geri gelir (`ui/src/components/Layout.tsx:518-549`).
- Pencereler telefonda üste yaslanır, `md` kırılma noktasından itibaren ortalanır (`ui/src/components/ui/dialog.tsx:62`). Sayfa sekme çubukları tarayıcının kendi `select` öğesine dönüşür (`ui/src/components/PageTabBar.tsx:21-39`).
- Dokunma hedefleri: `@media (pointer: coarse)` altında düğmeler, giriş alanları, seçim listeleri ve metin alanları `min-height: 44px` alır; `data-slot` ve `data-size` ile bunun dışında bırakılanlar vardır (`ui/src/index.css:594-624`).
- Telefona kurulmuş ve tarayıcı çerçevesi olmadan çalışan PWA'da Yenile, Paylaş ve Tarayıcıda aç düğmelerini taşıyan küçük bir çubuk çıkar (`ui/src/components/StandaloneBrowserControls.tsx:87-101`). Manifest dosyasının kendisi `"display": "browser"` bildirir (`ui/public/site.webmanifest`).

### 4.15 Tema

- İki tema vardır: `light` ve `dark`; `html` öğesindeki `dark` sınıfıyla değiştirilir (`ui/src/context/ThemeContext.tsx:11, 39-49`; `@custom-variant dark (&:is(.dark *))` tanımı `ui/src/index.css:21` satırındadır).
- `index.html`, `class="dark"` ile ve satır içi bir betikle gelir; betik `localStorage["paperclip.theme"]` değerini okur, değer yoksa işletim sistemi tercihine, depolama hata verirse karanlık temaya döner (`ui/index.html:2, 19-43`).
- Kullanıcı hiç seçim yapmadıysa tema işletim sistemindeki değişiklikleri izler ve saklanmaz; kullanıcı temayı kendisi değiştirince saklanır (`ui/src/context/ThemeContext.tsx:53-89`).
- `theme-color` meta değeri `#18181b` ya da `#ffffff` olarak güncellenir (`20-21, 45-48`).
- `ThemeToggle` bileşeninin üç çeşidi vardır: `icon`, `menu-action`, `compact-menu-action`; simgeleri `Sun` ve `Moon`; etiketleri "Switch to light mode" / "Switch to dark mode" (`ui/src/components/ThemeToggle.tsx:7, 37-101`). Kabukta yalnızca hesap menüsünde yer alır (`ui/src/components/SidebarAccountMenu.tsx:254`).

### 4.16 Bildirimler

Özel yazılmış bir sistemdir, kütüphane kullanılmaz.

- API: `pushToast({ id?, dedupeKey?, title, body?, tone?, ttlMs?, action? })` kimliği döndürür, bildirim yinelenen sayılıp elenirse `null` döndürür; `dismissToast(id)`; `clearToasts()` (`ui/src/context/ToastContext.tsx:22-46, 106-151`). Tonlar: `info`, `success`, `warn`, `error` (`12`). `action` değeri `{ label, href }` ya da `{ label, onClick }` biçimindedir (`14-20`).
- Varsayılanlar: tona göre TTL 4000 / 3500 / 8000 / 10000 ms, 1500..15000 aralığına sıkıştırılır; en çok 5 bildirim; 3500 ms içinde gelen aynı bildirimler atılır (`52-62, 67-71, 111-124`).
- Bildirim alanı: sol altta `aside aria-live="polite"`, `z-(--z-120)`, `max-w-sm`; liste `flex-col-reverse gap-2` düzenindedir (`ui/src/components/ToastViewport.tsx:100-116`).
- Bildirim: `rounded-sm border shadow-lg backdrop-blur-xl`; `translate-y-3 opacity-0` durumundan 200 ms'de girer; ton sınıfları hazır Tailwind renk sınıflarından gelir (örneğin info için `border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/25 dark:bg-sky-950/60 dark:text-sky-100`); bir ton noktası, `text-sm font-semibold` başlık, `text-xs opacity-70` gövde, altı çizili eylem ve kapatma `X` düğmesi vardır (`12-24, 40-91`).
- State ve eylemler ayrı context'lerdedir (`ui/src/context/ToastContext.tsx:64-65, 169-173`).

### 4.17 Şeritler, duyurular ve hatalar

| Öğe | Davranış | Kanıt |
|---|---|---|
| `WorktreeBanner` | geliştirme worktree'si şeridi; büyük harfli, 11 px, rengi worktree'ye göre değişir | `ui/src/components/WorktreeBanner.tsx:14-40` |
| `DevRestartBanner` | geliştirme sunucusu değişiklik bildirdiğinde çıkan sarı "Restart Required" şeridi | `ui/src/components/DevRestartBanner.tsx:43, 68-80` |
| Yeniden bağlanma şeridi | uygulamanın üstünde "Connection interrupted. Reconnecting automatically" | `ui/src/components/CloudAccessGate.tsx:215-219` |
| `AnnouncementWell` | sol altta 22rem genişliğinde tek bir duyuru kartı; herhangi bir pencere açıkken ya da herhangi bir bildirim görünürken gizlenir; yalnızca sade kabukta | `ui/src/components/AnnouncementWell.tsx:11-23, 41-46`, `ui/src/index.css:3120-3140` |
| `RouteErrorBoundary` | `Outlet` öğesini sarar; hata mesajıyla birlikte "This page hit an error" yazısını, "Go back" ve "Reload page" düğmelerini gösterir; yol değişince sıfırlanır | `ui/src/components/RouteErrorBoundary.tsx:28-62` |
| `AppErrorBoundary` | bütün sağlayıcıların üstündedir; yeniden yükleme düğmesiyle "Paperclip hit an error" | `ui/src/components/AppErrorBoundary.tsx:31-57` |
| Açılış kurtarması | `#root` dışında duran statik HTML; betik ya da stil dosyası yüklenemezse ya da 30 s geçince gösterilir | `ui/index.html:49-108` |
| `NotFoundPage` | kapsamlar `board`, `invalid_company_prefix`, `global`; istenen yolu ve iki düğmeyi gösterir | `ui/src/pages/NotFound.tsx:16-66` |

### 4.18 Dosya görüntüleyici

Deneyseldir (bayrak `enableExperimentalFileViewer`). `FileViewerProvider` ve `FileViewerSheet` kabuğa değil, yalnızca görev ayrıntısına yerleştirilir (`ui/src/pages/IssueDetail.tsx:3521, 7533, 8455`). Palet eylemi, tarayıcı penceresinde `paperclip:open-file-viewer` olayını yayımlar (`ui/src/components/CommandPalette.tsx:327-338`); `g f` tuş dizisi de aynı eyleme bağlıdır (`ui/src/lib/keyboardShortcuts.ts:210`).

### 4.19 Kaydırma ve odak

- Kaydırmanın sıfırlanması: gezinme, ana içeriğin kaydırma konumunu yalnızca şu koşulların hepsi sağlanınca sıfırlar: yol değişmiştir; gezinme, geçmişte geri ya da ileri gitme (history pop) değildir; hedef görev listesidir ya da görev değişmiştir ya da bağlantı kenar çubuğunun sıfırlama state'ini taşımıştır (`ui/src/lib/navigation-scroll.ts:7-20`).
- Geri ve ileri gidişlerde ana içeriğin kaydırma konumu, `location.key` kullanılarak her geçmiş kaydı için ayrı ayrı geri yüklenir (`ui/src/lib/navigation-scroll.ts:22-37`, `ui/src/components/Layout.tsx:578-616`).
- Her yol değişiminden sonra odak `main#main-content` öğesine taşınır (`preventScroll` ile); odak zaten bu öğenin içindeyse taşınmaz (`ui/src/lib/main-content-focus.ts:1-21`, `ui/src/components/Layout.tsx:572-576`).

### 4.20 Kabuğun kullandığı tarayıcı depolama anahtarları

| Anahtar | Depolama | Amaç | Kanıt |
|---|---|---|---|
| `paperclip.theme` | yerel | kullanıcının seçtiği tema | `ui/src/context/ThemeContext.tsx:19` |
| `paperclip.selectedCompanyId` | yerel | seçili şirket | `ui/src/context/CompanyContext.tsx:48` |
| `paperclip.companyPaths` | yerel | şirket başına son yol | `ui/src/hooks/useCompanyPageMemory.ts:11` |
| `paperclip.sidebar.width` | yerel | kenar çubuğu genişliği | `ui/src/components/SidebarShell.tsx:97` |
| `paperclip:panel-visible` | yerel | özellik panelinin görünürlüğü | `ui/src/context/PanelContext.tsx:4` |
| `taskChatRedesign.propertiesPaneWidth`, `taskChatRedesign.taskDetailPropertiesPaneWidth` | yerel | özellik paneli genişlikleri | `ui/src/components/PropertiesPanel.tsx:81-82` |
| `paperclip.recentTasks.v2:{company}:{user}` | yerel | son görevler | `ui/src/lib/recent-tasks.ts:5, 26-29` |
| `paperclip:inbox:last-tab` | yerel | Gelen kutusu ekranında son kullanılan sekme | `ui/src/lib/inbox.ts:24` |
| `paperclip.contextualSidebar.origin:{PREFIX}:{surface}` | oturum | bağlama özel kenar çubuklarında geri düğmesinin hedefi | `ui/src/lib/shell-navigation.ts:15, 59-61` |
| `paperclip:shared-poll:{company}:leader` | yerel | sekmeler arası yoklama liderinin süreli kilidi | `ui/src/lib/cross-tab-poll.ts:465-476` |

Sunucuda saklanan tercihler: şirket sırası ve proje sırası (`ui/src/api/sidebarPreferences.ts:5-11`).

## 5. Tasarım değişkenleri

### 5.1 Yapılandırma

- Tailwind CSS 4, yapılandırması CSS içinde (CSS-first): `@import "tailwindcss"`, `@plugin "@tailwindcss/typography"`, yapılandırma dosyası yok (`ui/src/index.css:1-3`, `ui/components.json:7`). Vite eklentisi `@tailwindcss/vite` (`ui/vite.config.ts:18`).
- `@theme inline`; shadcn renk adlarını, iki yazı tipi yığınını ve köşe yuvarlaklığı basamaklarını CSS değişkenlerine bağlar (`ui/src/index.css:43-91`). Çalışma anında ayarlanabilen değişkenler bilerek düz `:root` bloklarında tanımlanmıştır, çünkü `@theme inline` değerleri derleme anında sabit olarak gömer (`DESIGN.md:19`, `ui/src/index.css:266-276`).
- Tailwind 4'ün değişken söz dizimi her yerde kullanılır: `text-(length:--text-compact)`, `h-(--sz-60px)`, `shadow-(--shadow-profile-popover)`, `z-(--z-120)`, `bg-(--status-task-done)`.
- `ui/components.json`: `"style": "new-york"`, `"rsc": false`, `"tsx": true`, tailwind `"config": ""`, `"css": "src/index.css"`, `"baseColor": "neutral"`, `"cssVariables": true`, `"prefix": ""`, takma adlar `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`, `"iconLibrary": "lucide"` (`ui/components.json:1-21`).
- `DESIGN.md` üç katman sayar: anlamsal (shadcn takımı), marka (ajan renk geçişleri ve durum renkleri), alan (eşleşme etiketleri, belge yorumu vurguları, hareket, tipografi) (`DESIGN.md:21-25`).

### 5.2 Anlamsal renkler

Açık tema değerleri `ui/src/index.css:103-138, 365` satırlarında, karanlık tema değerleri `394-431` satırlarındadır.

| Değişken | Açık | Karanlık |
|---|---|---|
| `--background` | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| `--card-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--popover` | `oklch(1 0 0)` | `oklch(0.205 0 0)` |
| `--popover-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--secondary` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` |
| `--accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.637 0.237 25.331)` |
| `--destructive-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |
| `--chart-1` ile `--chart-5` arası | `oklch(0.87 / 0.556 / 0.439 / 0.371 / 0.269, 0 0)` | aynı |
| `--sidebar` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-primary` | `oklch(0.205 0 0)` | `oklch(0.488 0.243 264.376)` |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-accent` | `oklch(0.88 0 0)` | `oklch(0.32 0 0)` |
| `--sidebar-accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--sidebar-ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |
| `--scrollbar-thumb` | `oklch(0.7 0 0)` | `oklch(0.4 0 0)` |
| `--scrollbar-thumb-hover` | `oklch(0.6 0 0)` | `oklch(0.5 0 0)` |
| `--bubble-agent` | `oklch(0.97 0 0)` | `oklch(0.185 0 0)` |

Değerlerden çıkan gözlemler:

- `--destructive` ile karanlık temadaki `--sidebar-primary` dışında bütün anlamsal renklerin kroması sıfırdır. Marka rengi yoktur; `--primary` açık temada siyaha, karanlık temada beyaza yakındır.
- `--card`, iki temada da `--background` ile aynıdır (`103, 105, 394, 399`). Bu yüzden kartlar yalnızca kenarlıklarıyla görünür. Karar defterinde, kart kenarlıklarının bu nedenle korunduğu yazılıdır (`doc/design/DECISION-SHEET.md:111`).
- Sade kabuğun kenar çubuğu dolgu olarak `--sidebar` değişkenini kullanmaz. Yüzey sınıfı şudur:

```css
/* ui/src/index.css:1047-1053 */
.primary-sidebar-surface {
  --sidebar-action-rest-surface: color-mix(in srgb, var(--border) 50%, var(--background));
  background-color: var(--sidebar-action-rest-surface);
}
.dark .primary-sidebar-surface {
  --sidebar-action-rest-surface: var(--muted);
}
```

  Etkin satırlar ve üzerine gelinen satırlar `--sidebar-accent` kullanır. Hesap şeridi ve telefon alt menüsü aynı tonu, `bg-border/50 dark:bg-muted` sınıflarını kullanır (`ui/src/components/SidebarAccountMenu.tsx:172`, `ui/src/components/MobileBottomNav.tsx:64`).
- Temel katman: her öğe `border-border outline-ring/50` alır; `body` için `antialiased bg-background text-foreground`, `overflow: hidden` ve %100 yükseklik geçerlidir; `h1` ile `h3` arası başlıklar `text-wrap: balance` kullanır; etkileşimli öğeler `touch-action: manipulation` kullanır (`ui/src/index.css:533-561`).

### 5.3 Durum değişkenleri

Temel renkler, iki temada da aynıdır (`ui/src/index.css:201-204, 214-220`):

| Değişken | Değer | Anlam |
|---|---|---|
| `--status-agent-idle` | `#a8aeb2` | gri, hareketsiz |
| `--status-agent-running` | `#2563eb` | mavi, canlı |
| `--status-agent-paused` | `#f59e0b` | sarı |
| `--status-agent-error` | `#dc2626` | kırmızı |
| `--status-task-backlog` | `#a8aeb2` | gri |
| `--status-task-todo` | `#f59e0b` | sarı, sırada |
| `--status-task-in_progress` | `#2563eb` | mavi, canlı |
| `--status-task-in_review` | `#7c3aed` | mor |
| `--status-task-done` | `#22c55e` | yeşil |
| `--status-task-blocked` | `#dc2626` | kırmızı |
| `--status-task-cancelled` | `#a8aeb2` | gri |

Simge tonları; metnin yanında tek başına duran simge için ayarlanmıştır (`ui/src/index.css:232-239, 447-452`):

| Değişken | Açık | Karanlık | Simge (`ui/src/components/StatusGlyph.tsx:58-68`) |
|---|---|---|---|
| `--status-task-icon-backlog` | `#52585d` | `#9a958a` | `CircleDashed` |
| `--status-task-icon-todo` | `#cc7a00` | `#fbbf24` | `Circle` |
| `--status-task-icon-in_progress` | `var(--color-blue-600)` | `var(--color-blue-400)` | açık daire; `motion-safe` altında döner |
| `--status-task-icon-in_review` | `#7c3aed` | `#9474f0` | `CircleDot` |
| `--status-task-icon-done` | `#16a34a` | `#34d06f` | `CircleCheck` |
| `--status-task-icon-blocked` | `#dc2626` | `#dc2626` | `CircleMinus` |
| `--status-task-icon-cancelled` | `#52585d` | `#9a958a` | `Ban` |
| `--status-task-icon-in_queue` | in_progress ile aynı | in_progress ile aynı | `CircleMinus` (engellenmiş ama süren bir işle karşılanıyor) |

Durum simgesi boyutları 14, 16 ve 20 px'tir (`ui/src/components/StatusGlyph.tsx:39`).

Etiket tarifi: bileşen yerel `--sc` değişkenine tek bir temel renk verir; sınıflar iki tema için dolgu, yazı ve kenarlık rengini bundan türetir:

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

```tsx
// ui/src/components/StatusBadge.tsx:15-17, 90-96
function scStyle(cssVar: string): CSSProperties {
  return { "--sc": `var(${cssVar})` } as CSSProperties;
}
<span className={cn("status-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-normal leading-none whitespace-nowrap shrink-0", status === "cancelled" && "line-through")} style={scStyle(cssVar)}>
```

`ui/src/lib/status-colors.ts` içinde durumla ilgili kod yolları:

| Dışa aktarılan | Kullanım | Satırlar |
|---|---|---|
| `taskStatusVar`, `agentStatusVar`, `taskStatusIconVar` | durumu CSS değişkenine çevirir; `.status-chip` ve `StatusGlyph` için | 244-284 |
| `statusBadge` | çalışmalar, hedefler, onaylar ve diğerleri için genel rozet; `bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300` gibi hazır Tailwind renk sınıfı çiftleriyle yazılmıştır | 69-136 |
| `brandChipBadge` | kenarlıklı altı etiket tarifi (gri, mavi, sarı, yeşil, mor, kırmızı); köşeli ayraç içinde hex değerli sınıflarla yazılmıştır | 54-63 |
| `brandBanner` | satır içi şerit tonları: info, warning, danger | 208-219 |
| `agentStatusDot` | küçük noktalar; çalışan ajan için `bg-blue-400 animate-pulse` | 290-298 |
| `agentStatusMotion` | çalışırken `hb-pulse`, hatada `hb-blink` | 171-174 |
| `liveBlueBadge` | "Live" etiketi: `bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400` | 190 |
| `priorityColor` | kritik kırmızı, yüksek turuncu, orta sarı, düşük mavi | 306-311 |
| `externalObjectStatus*` | bağlı dış nesnelerin durumu | 335-395 |

`statusBadge` içindeki onayla ilgili anahtarlar: `pending` sarı (yellow), `pending_approval` ve `revision_requested` sarı (amber), `approved` yeşil, `rejected` kırmızı (`97, 102-105`).

`brandChipBadge` içindeki köşeli ayraçlı hex sınıfları `ui/src/lib/` altında durur; değişken denetimi bu klasörü taramaz (`scripts/check-token-gates.mjs:7-9, 80`). Koddaki yorumlara göre hex değerleri bu nedenle bilerek orada tutulmaktadır (`ui/src/lib/status-colors.ts:178-183`).

### 5.4 Ajan kimlik renkleri

İki duraklı on renk geçişi vardır; hex değerleri sabittir ve iki temada da aynıdır. `AgentCapsule` bunları `linear-gradient(to bottom, var(--agent-Na), var(--agent-Nb))` biçiminde kullanır (`ui/src/index.css:160-183`, `ui/src/components/AgentCapsule.tsx:103`):

| N | a (üst) | b (alt) |
|---|---|---|
| 1 | `#f7cfdc` | `#1f7a3a` |
| 2 | `#c9a9e8` | `#ee79a1` |
| 3 | `#28164b` | `#7a1530` |
| 4 | `#f3e6c4` | `#e3a21a` |
| 5 | `#1f4dd6` | `#3aa35c` |
| 6 | `#e94b27` | `#5a1122` |
| 7 | `#7eb6e3` | `#ee79a1` |
| 8 | `#9ce8a7` | `#bd7ff0` |
| 9 | `#f3b49e` | `#1f4ed4` |
| 10 | `#f2d95f` | `#4fbcba` |

İkinci bir palet olan `--agent-cap-v1-{name}-a/b` (`bubblegum-sky`, `arctic-blue`, `muted-dream` gibi adlandırılmış 19 çift) karakter avatarlarının renklerini verir (`ui/src/index.css:3147-3185`). Ajan avatarları sunucunun ürettiği PNG görselleridir: `/api/agent-avatars/{characterVersion}/{paletteId}/{pose}.png?size=&scale=` (`packages/shared/src/agent-appearance.ts:39`, `ui/src/components/AgentAvatar.tsx:22-33`).

### 5.5 Diğer renk değişkenleri

| Aile | Değerler | Satırlar |
|---|---|---|
| Grafik ve öncelik hex değerleri | `--hex-ef4444` kritik, `--hex-f97316` yüksek, `--hex-eab308` orta, `--hex-6b7280` düşük, `--hex-10b981` başarılı, `--hex-737373` diğer | `ui/src/index.css:2450-2455` |
| Organizasyon şeması noktaları | `--hex-22d3ee`, `--hex-4ade80`, `--hex-facc15`, `--hex-f87171`, `--hex-a3a3a3` | `2445-2449` |
| Proje yedek renkleri | `--project-none #64748b`, `--project-seed #6366f1` | `2456-2457` |
| Canlılık | `--liveness-blue #2563eb` | `2458` |
| Klasör renkleri | çivit mavisi `#6366f1`, mor `#8b5cf6`, zümrüt yeşili `#10b981`, camgöbeği `#06b6d4`, sarı `#f59e0b`, arduvaz grisi `#64748b` | `241-246` |
| Arama eşleşme etiketleri | `--chip-match-{title,comment,document,identifier}-{bg,fg,border}` | `139-150, 432-443` |
| Yazma kutusu modu etiketleri | `--tc-mode-agent`, `--tc-mode-plan`, `--tc-mode-ask #3b82f6` | `358-360` |
| Genel bakış ekranındaki süren çalışma kartı | `--dashboard-run-accent oklch(62.3% 0.214 259.815)` ve %4 / %25 karışımları | `206-208` |

Grafikler, satır içi `backgroundColor` verilen flex `div` çubuklarından elle kurulmuştur (`ui/src/components/ActivityCharts.tsx:149-156, 203-209`). Grafik kütüphanesi kurulu değildir.

### 5.6 Köşe yuvarlaklığı

Tek bir ayar vardır: `--radius: 0.5rem` (`ui/src/index.css:102`); diğer basamaklar bunun çarpılmasıyla elde edilir (`83-90`):

| Sınıf | Formül | Piksel | Tipik kullanım |
|---|---|---|---|
| `rounded-sm` | x 0,6 | 4,8 | menü öğeleri, bildirimler |
| `rounded-md` | x 0,8 | 6,4 | düğmeler, giriş alanları, seçim listeleri, ipuçları |
| `rounded-lg` | x 1,0 | 8 | kartlar, pencereler, kenar çubuğu satırları |
| `rounded-xl` | x 1,4 | 11,2 | hesap, şirket ve son görev menüleri, karar kartları |
| `rounded-2xl` | x 1,8 | 14,4 | |
| `rounded-3xl` | x 2,2 | 17,6 | |
| `rounded-4xl` | x 2,6 | 20,8 | |
| `rounded-full` | | | rozetler, etiketler, avatarlar, noktalar |

Karar defterine yazılan kural: kaplar `lg` kullanır, denetimler bir basamak daha dar olan `md` basamağında kalır (`doc/design/DECISION-SHEET.md:87-89`). Geride kalan sabit yuvarlaklık değerleri `--rad-2`, `--rad-3`, `--rad-4`, `--rad-14`, `--rad-24`, `--rad-28`, `--rad-32` olarak durur (`ui/src/index.css:2703-2709`); `--rad-3`, düğmelerin ve giriş alanlarının kullandığı 3 px'lik odak halkası genişliğidir.

### 5.7 Tipografi

Yazı tipleri (`ui/src/index.css:5-19, 44-45, 87`):

- Tırnaksız (sans): `"InterVariable", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Inter v4.1, SIL Open Font License 1.1 kapsamında, değişken yazı tipi biçiminde iki WOFF2 dosyası olarak uygulamanın kendi sunucusundan sunulur (`ui/public/fonts/NOTICE.md`).
- Eş aralıklı (mono): `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`.
- `--font-heading`, tırnaksız yığınla aynıdır.

Boyut basamakları (`ui/src/index.css:2489-2521`, `doc/design/CHANGING-THE-UI.md:47`):

| Basamak | Boyut | Kabukta göründüğü yerler |
|---|---|---|
| `--text-nano` | 10 px | kenar çubuğu bölüm etiketleri, alt menü etiketleri, metin rozetleri, şirket kodu |
| `--text-micro` | 11 px | konum bilgisi öğelerindeki kimlikler, "N live", bağlama özel kenar çubuklarının bölüm etiketleri, profil ek bilgisi |
| `text-xs` | 12 px | rozetler, ipuçları, bildirim gövdesi, tablo hücreleri |
| `--text-compact` | 13 px | kenar çubuğu satırları, açılır menü satırları |
| `text-sm` | 14 px | gövde metni, düğmeler, konum bilgisi, menü öğeleri |
| `text-base md:text-sm` | telefonda 16 px, `md` kırılma noktasından itibaren 14 px | giriş alanları, metin alanları, seçim listesi tetikleyicileri, komut giriş alanı |
| `--text-onboarding-title` | 45 px | ilk kurulum sorusu |

Harf aralığı: `--tracking-label 0.08em`, `--tracking-eyebrow 0.14em`, `--tracking-caps 0.2em` (`2519-2521`).

Tasarım kılavuzu sayfasında gösterilen tarifler (`ui/src/pages/DesignGuide.tsx:673-695`):

| Rol | Sınıflar |
|---|---|
| Sayfa başlığı | `text-xl font-bold` |
| Bölüm başlığı | `text-lg font-semibold` |
| Bölüm ara başlığı | `text-sm font-semibold text-muted-foreground uppercase tracking-wide` |
| Kart başlığı | `text-sm font-medium` (alternatif `text-sm font-semibold`) |
| Gövde | `text-sm` |
| Soluk açıklama | `text-sm text-muted-foreground` |
| Küçük etiket | `text-xs text-muted-foreground` |
| Eş aralıklı kimlik | `text-sm font-mono text-muted-foreground` |
| Büyük sayı | `text-2xl font-bold` |
| Kayıt ya da kod | `font-mono text-xs` |

Markdown metni (`.paperclip-markdown`): 15 px (`0.9375rem`), satır yüksekliği 1,6 (`ui/src/index.css:2052-2056`); başlıklarda kalınlık 600, harf aralığı `-0.01em`, satır yüksekliği 1,3, boyutlar `1.5rem`, `1.25rem`, `1.05rem`, `0.95rem` (`2142-2168`); blok boşlukları `0.7rem` (`2098-2101`); kod bloklarında `border`, `--radius-lg` ve `--muted` dolgu (`1948-1958`); satır içi kod %60 accent karışımı üzerindedir (`2036-2041`); bağlantılar metin rengini %24 oranında `#0969da` ile karıştırır ve altı çizilidir (`2179-2184`).

### 5.8 Gölgeler

| Gölge | Kullanıldığı yer | Kanıt |
|---|---|---|
| yok | `Card` (yalnızca kenarlık) | `ui/src/components/ui/card.tsx:21` |
| `shadow-xs` | outline çeşidindeki düğme, giriş alanı, metin alanı, seçim listesi tetikleyicisi, onay kutusu | `button.tsx:17`, `input.tsx:11`, `textarea.tsx:10`, `select.tsx:38`, `checkbox.tsx:17` |
| `shadow-sm` | varsayılan çeşitte etkin sekme, aç/kapa düğmesinin topuzu | `tabs.tsx:65`, `toggle-switch.tsx:58` |
| `shadow-md` | açılır menüler (popover, dropdown), seçim listesi içeriği, etkileşimli kartın üzerine gelince | `popover.tsx:31`, `dropdown-menu.tsx:45`, `select.tsx:63`, `card.tsx:23` |
| `shadow-lg` | pencere, kenardan açılan panel, iç menü, bildirim | `dialog.tsx:62`, `sheet.tsx:63`, `dropdown-menu.tsx:233`, `ToastViewport.tsx:43` |
| `--shadow-profile-popover: 0 18px 45px oklch(0 0 0 / 18%)` | hesap, şirket ve son görev menüleri | `ui/src/index.css:344` |
| `--shadow-sidebar-icon-badge: 0 0 0 2px var(--muted)` | simgelerin üzerindeki rozet noktalarının çevresindeki halka | `ui/src/index.css:2729` |
| `--shadow-task-composer` | görev yazma kutusu | `ui/src/index.css:335-336` |
| `--shadow-extract-*` | tek seferlik, koddan çıkarılmış gölgeler | `ui/src/index.css:2717-2732` |

Gölge ölçeğinin henüz karara bağlanmadığı kaydedilmiştir (`doc/design/DECISION-SHEET.md:89`).

### 5.9 Hareket

Değişkenler:

| Değişken | Değer | Satırlar |
|---|---|---|
| `--motion-ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | `ui/src/motion-tokens.css:4` |
| `--motion-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | `ui/src/motion-tokens.css:5` |
| `--motion-duration-instant` | 80 ms | `ui/src/motion-tokens.css:6` |
| `--motion-duration-fast` | 160 ms | `ui/src/motion-tokens.css:7` |
| `--motion-duration-base` / `slow` / `deliberate` | 240 / 360 / 520 ms | `ui/src/index.css:283-285` |
| `--motion-duration-enter` / `exit` / `swap` | 160 / 110 / 150 ms | `ui/src/index.css:1140-1153` |
| `--motion-ease-out` / `--motion-ease-in` | `cubic-bezier(0.16, 1, 0.3, 1)` / `cubic-bezier(0.4, 0, 1, 1)` | `ui/src/index.css:1142-1143` |
| `--motion-pane-glide` | 320 ms | `ui/src/index.css:311` |
| Görev akışına özel değişkenler (`--motion-bubble-enter`, `--motion-turn-fold` ve benzerleri) | temel değişkenlere başvurur | `ui/src/index.css:288-312` |

Kodda ve belgelerde yazan kurallar:

- Çıkış girişten kısadır; biri solarken diğeri beliren bir çift aynı süreyi ve eğriyi paylaşır (`ui/src/index.css:1131-1153`).
- `prefers-reduced-motion: reduce` altında süre değişkenleri 0 ms yapılır ve her animasyon sınıfı ayrıca devre dışı bırakılır (`ui/src/index.css:874-896, 1096-1117, 1238-1245, 1531-1536, 1601-1614`).
- shadcn animasyon yardımcı sınıfları bu derlemede hiçbir şey yapmaz (`ui/src/index.css:1200-1205`). Yalnızca kendi keyframe tanımı olan yüzeyler hareket eder: görev ön izlemesi (ölçek 0,96'dan 1'e), karar kartının açılıp kapanması, görev akışı, Genel bakış ekranındaki etkinlik satırları (`520ms` giriş ve `920ms` vurgu), ajan kapsülü, heartbeat nabız ve yanıp sönme animasyonları, duyurunun yavaşça belirmesi (`ui/src/index.css:908-940, 1164-1236, 1254-1287, 1513-1599, 3131-3139`).

Düz yardımcı sınıflarla yazılmış kabuk geçişleri: telefon çekmecesi `duration-100 ease-out`, alt menü `duration-200 ease-out`, bildirim `duration-200 ease-out`, özellik panelinin genişliği ve opaklığı `duration-200 ease-in-out`, pencerenin en büyük genişliği `200ms cubic-bezier(0.16, 1, 0.3, 1)` (`ui/src/components/Layout.tsx:651`, `MobileBottomNav.tsx:64`, `ToastViewport.tsx:43`, `PropertiesPanel.tsx:362`, `ui/src/index.css:1120-1122`).

Kullanıcı eylemine yanıt olmayan, kendiliğinden süren hareketler: yanıp sönen mavi canlı nokta (`ui/src/components/SidebarNavItem.tsx:190`), dönen "sürüyor" simgesi (`ui/src/components/StatusGlyph.tsx:92`), ajan kapsüllerindeki `hb-pulse` (1,6 s) ve `hb-blink` (1,2 s) (`ui/src/index.css:1513-1529`).

### 5.10 Kaydırma çubukları

- Karanlık tema: her öğede, tutamağı `oklch(0.4 0 0)` olan 8 px'lik WebKit kaydırma çubukları (`ui/src/index.css:680-696`).
- `.scrollbar-auto-hide`: ince, yeri sabit ayrılmış, üzerine gelinene kadar saydam (`699-715, 805-830`). Kenar çubuğu menüsünde kullanılır.
- `.scrollbar-while-scrolling`: tutamak yalnızca `data-scroll-active="true"` iken görünür (`719-741`). Yan panel gövdelerinde kullanılır.
- `@utility scrollbar-none` ve `@utility scroll-fade-x` (`1477-1492`).
- `main`, kaydırma çubuğunun yerini `[scrollbar-gutter:stable]` ile önceden ayırır; böylece kaydırma çubuğu belirince sayfalar kaymaz (`ui/src/components/Layout.tsx:755-764`).

### 5.11 Koddan çıkarılmış değer aileleri

Bir codemod, bütün keyfi değerleri normalleştirmeden adlandırılmış değişkenlere taşımıştır (`DESIGN.md:31`, `ui/src/index.css:2524-2543`):

| Ön ek | İçerik | Satırlar |
|---|---|---|
| `--sz-*` | `--sz-60px`, `--sz-320px`, `--sz-calc-14`, `--sz-safe-top` gibi ölçüler ve boşluklar | `2545-2702` |
| `--rad-*` | köşe yuvarlaklıkları ve halka genişlikleri | `2703-2709` |
| `--pct-*` | yüzdeler | `2710-2716` |
| `--shadow-extract-*` | kutu gölgeleri | `2717-2732` |
| `--gtc-*`, `--gtr-*` | ızgara şablonları | `2772-2844` |
| `--tp-*` | geçiş özelliği listeleri | `2845-2863` |
| `--z-*` | z-index değerleri 1, 2, 20, 60, 120, 200, 9999 | `2864-2870` |

Bu adlar rolü değil değeri anlatır. `DESIGN.md`, son ölçeğin sonradan bir insanın vereceği bir karar olduğunu söyler (`DESIGN.md:31`).

### 5.12 Değişken denetimi ve izin listesi

`scripts/check-token-gates.mjs`, `ui/src/components/**` ve `ui/src/pages/**` içinde (`scripts/check-token-gates.mjs:79-80, 115-120`) şunları arar:

1. koda gömülü renk değerleri (hex, sabit argümanlı `rgb()`, `hsl()`, `oklch()`);
2. `p-[13px]` gibi değer taşıyan, köşeli ayraçlı keyfi yardımcı sınıflar (`data-[...]` gibi seçici ayraçları hariç);
3. ham yazı boyutları (`text-[11px]`, `fontSize:`);
4. değişken katmanındaki `hsl(var(--token))` sarmalayıcıları (`11-55`).

İzin listesi makinenin okuyabileceği biçimdedir ve koddan çıkarılmış değişkenlerin sonundaki bir yorum bloğunda durur: her girdi bir satırdır, `* allow <repo-relative-path> <separator> <reason>`; ayırıcı olarak bir uzun tire ya da bir veya iki kısa tire kullanılır; yol, alt dizgi olarak eşleşir ve dosyanın tamamını denetimin dışında bırakır (`scripts/check-token-gates.mjs:57-65, 89-104`, `ui/src/index.css:2889-2959`). Şimdiki girdiler şunları kapsar: üçüncü taraf yapılandırması (xterm teması), saklanan renk verisi, canvas dolguları, marka SVG çizimleri, `rounded-[inherit]`, `dialog.tsx` ve `alert-dialog.tsx` içindeki ölü animasyon sınıfları, kırılma noktası çeşitleri, dört UX lab sayfası ve test verileri.

Kök betik: `"check:token-gates": "node scripts/check-token-gates.mjs && node scripts/sync-agent-palette-tokens.mjs --check && node scripts/sync-cliplab-character.mjs --check"` (`package.json:44`). `AGENTS.md:226`, ajanlara arayüz değişikliklerini commit'lemeden önce bu betiği çalıştırmalarını söyler.

Denetlenmeyenler: hazır Tailwind renk sınıfları (`DESIGN.md:30`) ve `ui/src/lib`, `ui/src/context`, `ui/src/plugins` altındaki her şey.

## 6. Temel arayüz bileşenleri

`ui/src/components/ui/` klasöründe 26 bileşen dosyası (ve bir test) vardır. Hepsi `cn()` = `twMerge(clsx(...))` kullanır (`ui/src/lib/utils.ts:6-8`), `data-slot` öznitelikleri taşır ve Radix'i tek paketten içe aktarır; örneğin `import { Dialog as DialogPrimitive } from "radix-ui"`.

| Dosya | Dışa aktarılanlar | Temel | Prop'lar, çeşitler ve başlıca sınıflar |
|---|---|---|---|
| `button.tsx` | `Button`, `buttonVariants` | cva, `Slot.Root` | çeşitler `default`, `cta`, `destructive`, `outline`, `secondary`, `ghost`, `link`; boyutlar `default` h-10, `xs` h-6, `sm` h-9, `lg` h-10, `icon` size-10, `icon-xs` size-6, `icon-sm` size-9, `icon-lg` size-10; temel sınıflar `rounded-md text-sm font-medium`, odak halkası 3 px `ring-ring/50`; `asChild`; `data-variant` ve `data-size` özniteliklerini ayarlar (`7-40, 42-67`) |
| `badge.tsx` | `Badge`, `badgeVariants` | cva | çeşitler `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`; temel sınıflar `rounded-full border border-transparent px-2 py-0.5 text-xs font-medium`; `asChild` (`7-46`) |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` | div | `bg-card text-card-foreground flex flex-col gap-6 rounded-lg border py-6`; `interactive` şu sınıfları ekler: `cursor-pointer transition-colors hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring` (`5-29`) |
| `input.tsx` | `Input` | input | `h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base md:text-sm shadow-xs`, `dark:bg-input/30`; geçersiz durum `aria-invalid` ile belirtilir (`5-19`) |
| `textarea.tsx` | `Textarea` | textarea | `field-sizing-content min-h-16 rounded-md border px-3 py-2 text-base md:text-sm shadow-xs` (`5-16`) |
| `label.tsx` | `Label` | Radix Label | `flex items-center gap-2 text-sm leading-none font-medium select-none` (`6-20`) |
| `checkbox.tsx` | `Checkbox` | Radix Checkbox | `size-4 rounded-(--rad-4) border shadow-xs`; işaretliyken `bg-primary text-primary-foreground` (`9-30`) |
| `select.tsx` | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectLabel`, `SelectSeparator`, `SelectGroup`, `SelectValue`, kaydırma düğmeleri | Radix Select | tetikleyicide `size` `default` h-9 ya da `sm` h-8; içerik `rounded-md border shadow-md`; öğenin onay işareti sağdadır (`25-126`) |
| `toggle-switch.tsx` | `ToggleSwitch` | özel yazılmış `button role="switch"` | `checked`, `onCheckedChange`, `size` `default` (h-5 w-11) ya da `lg` (h-6 w-12); açık durumda `border-(--status-task-done) bg-(--status-task-done)`; bir yorum, açık durum renginin primary değil durum yeşili olduğunu belirtir (`4-66`) |
| `radio-card.tsx` | `RadioCard`, `RadioCardGroup`, `RadioCardOption` | özel yazılmış `button role="radio"` | seçiliyken `border-primary bg-primary/5 ring-1 ring-primary`; grup ok tuşlarını işler ve devre dışı seçenekleri atlar (`27-144`) |
| `dialog.tsx` | `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` | Radix Dialog | karartma katmanı `fixed inset-0 z-50 bg-black/50`; içerik `rounded-lg border p-6 shadow-lg sm:max-w-lg`, telefonda üste yaslı, `md` kırılma noktasından itibaren ortalı; içerikte ve alt kısımda `showCloseButton`; başlık `text-lg leading-none font-semibold` (`32-143`) |
| `alert-dialog.tsx` | `AlertDialogAction` ve `AlertDialogCancel` dâhil `AlertDialog` ailesi | Radix AlertDialog | pencereyle aynı ölçü ve yerleşim; eylem düğmesi `buttonVariants()` kullanır, iptal düğmesi outline çeşidini kullanır (`41-139`) |
| `sheet.tsx` | `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription` | Radix Dialog | `side` değerleri top, right, bottom, left; yandan açılan paneller `w-3/4 sm:max-w-sm`; `showCloseButton` (`47-86`) |
| `popover.tsx` | `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverHeader`, `PopoverTitle`, `PopoverDescription` | Radix Popover | içerik `w-72 rounded-md border p-4 shadow-md`, `align="center"`, `sideOffset=4`, ek prop `disablePortal` (`18-39`) |
| `dropdown-menu.tsx` | onay kutusu, radyo, iç menü ve kısayol dâhil tam menü takımı | Radix DropdownMenu | içerik `min-w-(--sz-8rem) rounded-md border p-1 shadow-md`; öğe `rounded-sm px-2 py-1.5 text-sm`, `variant="destructive"`, `inset` (`34-239`) |
| `tooltip.tsx` | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` | Radix Tooltip | sağlayıcıda `delayDuration = 0`; içerik `bg-foreground text-background rounded-md px-3 py-1.5 text-xs text-balance`, oklu (`8-55`) |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `tabsListVariants` | Radix Tabs | liste çeşitleri `default` (`bg-muted`) ve `line` (saydam; etkin sekmenin altı bir `after` çubuğuyla çizilir); yatay ve dikey (`26-74`) |
| `command.tsx` | `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandSeparator` | cmdk + Dialog | pencere içeriği `overflow-hidden p-0`; öğe `rounded-sm px-2 py-1.5 text-sm`, seçiliyken `bg-accent` (`33-166`) |
| `breadcrumb.tsx` | `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` | nav, ol | liste `text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm sm:gap-2.5`; ayırıcı `ChevronRight` (`7-99`) |
| `avatar.tsx` | `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarBadge`, `AvatarGroup`, `AvatarGroupCount` | Radix Avatar | `size` `xs` 20, `sm` 24, `default` 32, `lg` 40 px; `shape` `circle` ya da `square` (`6-28`) |
| `collapsible.tsx` | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | Radix Collapsible | ince sarmalayıcılar (`5-33`) |
| `scroll-area.tsx` | `ScrollArea`, `ScrollBar` | Radix ScrollArea | kaydırma çubuğu 10 px, tutamak `bg-border rounded-full` (`6-54`) |
| `separator.tsx` | `Separator` | Radix Separator | `bg-border`, 1 px (`8-26`) |
| `skeleton.tsx` | `Skeleton` | div | `bg-accent/75 rounded-md`, animasyon sınıfı yok (`3-11`) |
| `resizable-panels.tsx` | `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` | `react-resizable-panels` | tutamak 8 px'lik bir tıklama alanıdır; içindeki 1 px'lik çizgi üzerine gelince ve sürüklerken `bg-ring` olur (`15-61`) |
| `attachment.tsx` | `Attachment` ve parçaları | `@base-ui/react` yardımcıları | shadcn kayıt defterindeki "base/attachment" öğesinden uyarlanmıştır; durumlar idle, uploading, processing, error, done (`9-49`) |

Klasörde olmayanlar: tablo, form, bildirim, aç/kapa düğmesi (yerini `ToggleSwitch` alır), radyo grubu (yerini `RadioCard` alır), akordeon, ilerleme çubuğu, takvim. Tablolar düz `<table>` işaretlemesiyle yazılmıştır (`ui/src/pages/DesignGuide.tsx:1827-1856`).

Deponun kendi belgelerinde bilinçli olduğu yazılan yerel tercihler: `ToggleSwitch` ve `RadioCard` özel yazılmıştır (`doc/design/DECISION-SHEET.md:36`); `Card` bileşeninin bir durağan, bir etkileşimli modu vardır ve gölgesi yoktur (`91-93`); `StatusBadge`, `Badge` bileşenini sarmaz (`37`); bildirim sistemi şimdilik özel kalır (`38`). Diğer dosyaları çevrimdışı çalışırken özgün shadcn kaynaklarıyla karşılaştıramadım; bu yüzden fark ileri sürmek yerine içeriklerini listeliyorum.

## 7. Ortak bileşenler

Aksi belirtilmedikçe hepsi `ui/src/components/` altındadır.

| Bileşen | Prop'lar | Not |
|---|---|---|
| `StatusBadge` | `status`, `label?` | genel amaçlı etiket `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`; rengi `statusBadge` verir (`StatusBadge.tsx:30-41`) |
| `IssueStatusBadge` | `status`, `externalConversationState?` | durum simgesi ve yalnızca ilk harfi büyük yazılan metin taşıyan `.status-chip`; "cancelled" üstü çizili yazılır (`StatusBadge.tsx:86-101`) |
| `AgentStatusBadge`, `AgentStatusCapsule` | `status` | etiket ve 8x16 px'lik dolu bir kapsül; kapsül çalışırken nabız gibi atar, hatada yanıp söner (`StatusBadge.tsx:48-76`) |
| `StatusGlyph` | `status`, `size?`, `className?`, `title?` | her durum için bir lucide şekli; rengi `--status-task-icon-*` verir (`StatusGlyph.tsx:73-98`) |
| `StatusIcon` | `status`, `onChange?`, `showLabel?`, `size?`, `blockerAttention?` | `onChange` verildiğinde durum seçme açılır menüsüne dönüşen durum simgesi (`StatusIcon.tsx:14-155`) |
| `PriorityIcon` | `priority`, `onChange?`, `showLabel?` | simgeler `AlertTriangle`, `ArrowUp`, `Minus`, `ArrowDown`; `SHOW_TASK_PRIORITY_UI = false` nedeniyle ürünün her yerinde gizlidir (`PriorityIcon.tsx:8-13`, `ui/src/lib/ui-flags.ts:22`) |
| `Identity` | `name`, `avatarUrl?`, `initials?`, `size?`, `shape?` | insanlar için avatar ve sığmazsa kısaltılan ad (`Identity.tsx:7-44`) |
| `AgentIdentity`, `AgentAvatar` | `agent`, `size?`; avatar ayrıca `appearance?`, `pose?`, `muted?`, `label?` | sunucunun ürettiği karakter görseli; görsel yoksa baş harfler (`AgentIdentity.tsx:3-9`, `AgentAvatar.tsx:12-33`) |
| `AgentCapsule` | `state` (`slot`, `configured`, `online`), `gradient?` 1..10, `size?`, `glow?`, `strokeDraw?` | marka motifi; `motion/react` kullanır (`AgentCapsule.tsx:54-185`) |
| `EntityRow` | `leading?`, `identifier?`, `title`, `subtitle?`, `meta?`, `trailing?`, `selected?`, `to?`, `onClick?`, `titlePriority?`, `secondaryRow?` | liste satırı: `flex items-center gap-3 px-4 py-2 text-sm border-b border-border last:border-b-0`; üzerine gelince `bg-accent/50`, seçiliyken `bg-accent/30`; kimlik eş aralıklı ve 12 px (`EntityRow.tsx:5-151`) |
| `IssueRow` | `issue`, `selected`, `leadingControl`, `statusSlot`, `metadata`, `actions`, `unreadState`, `onArchive` dâhil 30'dan fazla yuva | Gelen kutusu ve görev listelerinin kullandığı görev satırı (`IssueRow.tsx:30-70`, 539 satır) |
| `IssueGroupHeader` | `label`, `collapsible?`, `collapsed?`, `onToggle?`, `trailing?` | ok işaretiyle birlikte `text-sm font-semibold uppercase tracking-wide` (`IssueGroupHeader.tsx:5-52`) |
| `EmptyState` | `icon`, `title?`, `message`, `description?`, `action?`, `onAction?`, `hideActionIcon?` | ortalı, `py-16`; `bg-muted/50` karenin içinde 40 px'lik simge, artı simgeli düğme (`EmptyState.tsx:5-51`) |
| `PageSkeleton` | `variant`: `list`, `issues-list`, `detail`, `dashboard`, `approvals`, `costs`, `inbox`, `org-chart` | her sayfanın biçimini taşıyan durağan gri bloklar (`PageSkeleton.tsx:3-180`) |
| `MetricCard` | `icon`, `value`, `label`, `description?`, `to?`, `onClick?` | değer `text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums`, etiket `text-xs sm:text-sm font-medium text-muted-foreground` (`MetricCard.tsx:5-53`) |
| `FilterBar` | `filters`, `onRemove`, `onClear` | secondary çeşidinde kaldırılabilir rozetler ve "Clear all" (`FilterBar.tsx:5-39`) |
| `PageTabBar` | `items`, `value?`, `onValueChange?`, `align?` | geniş ekranda çizgili sekmeler, telefonda tarayıcının kendi seçim listesi (`PageTabBar.tsx:11-50`) |
| `CollectionToolbar` | `context?`, `search?`, `controls?`, `actions?`, `feedback?`, `ariaLabel?` | yalnızca yuvalardan oluşan, `role="toolbar"` taşıyan araç çubuğu iskeleti (`CollectionToolbar.tsx:4-75`) |
| `InlineBanner` | `tone?` (`info`, `warning`, `danger`), `title?`, `icon?`, `actions?`, `compact?` | `role="note"`, `rounded-lg border p-4`; renkleri `brandBanner` verir (`InlineBanner.tsx:14-70`) |
| `QuotaBar` | `label`, `percentUsed`, `leftLabel`, `rightLabel?`, `showDeficitNotch?` | kenarlıklı, köşeli 8 px'lik ray; dolgu %70'e kadar yeşil, %90'a kadar sarı, üstünde kırmızı (`QuotaBar.tsx:14-18, 46-59`) |
| `CopyText` | `text`, `children?`, `copiedLabel?` | tıklayınca kopyalar; 1,5 s boyunca küçük bir "Copied!" balonu çıkar (`CopyText.tsx:5-72`) |
| `InlineEditor` | `value`, `onSave`, `as?`, `multiline?`, `placeholder?`, `mentions?`, `nullable?`, `foldable?` | tıklayınca düzenlenen metin ya da markdown (`InlineEditor.tsx:8-34`) |
| `MarkdownBody` | `children`, `softBreaks?`, `linkIssueReferences?`, `enableWikiLinks?`, `wikiLinkRoot?`, `resolveWikiLinkHref?`, `resolveImageSrc?`, `onImageClick?`, `mediaMode?` | `react-markdown` + `remark-gfm`, gerektiğinde yüklenen Mermaid, kod bloğunda kopyalama ve satır kaydırma eylemleri; kök `paperclip-markdown prose prose-sm min-w-0 max-w-full break-words overflow-hidden` (`MarkdownBody.tsx:4-5, 67-105, 956`) |
| `MarkdownEditor` | `value`, `onChange`, `placeholder?`, `mentions?`, `actionCommands?`, `onSubmit?`, `readOnly?`, `imageUploadHandler?`, `bordered?` | MDXEditor; hata olursa düz metin alanına döner; ref üzerinden `focus`, `insertMarkdown`, `clear` sunar (`MarkdownEditor.tsx:82-133`) |
| `ProjectTile` | `color?`, `icon?`, `size?` (`xs` 16, `sm` 24, `md` 28, `lg` 36 px) | klasör simgeli nötr gri karo; renk verilirse o renge boyanır (`ProjectTile.tsx:17-52`) |
| `StarToggle` | `starred`, `resourceName`, `pending?`, `error?`, `size?`, `onToggle`, `quiet?` | satırlar ve başlıklar için yıldız düğmesi (`StarToggle.tsx:6-38`) |
| `FoldCurtain` | `children`, `collapsedHeight?`, `moreLabel?`, `lessLabel?` | uzun içeriği 420 px'te (küçük ekranlarda 320 px'te) keser; kesilen yerde solma efekti ve açıp kapatma düğmesi vardır (`FoldCurtain.tsx:12-30`) |
| `ActivityRow` | `event`, `agentMap`, `userProfileMap?`, `entityNameMap` | avatar, "kim, ne yaptı, neye" cümlesi, kimlik, göreli zaman (`ActivityRow.tsx:23-117`) |
| `ApprovalCard` | `approval`, `requesterAgent`, `onApprove?`, `onReject?`, `onOpen?`, `detailLink?`, `isPending?`, `pendingAction?` | kenarlıklı kart: tür rozeti, isteyen, konu, durum etiketi, içerik, karar notu; alt kısımda "Approve" (`bg-green-700 hover:bg-green-600 text-white`), "Reject" (destructive çeşidi) ve "View details" (`ApprovalCard.tsx:27-153`) |
| `ActivityCharts` | `RunActivityChart`, `PriorityChart`, `IssueStatusChart`, `SuccessRateChart`, `ChartCard` | elle kurulmuş çubuk grafikler (`ActivityCharts.tsx:72-320`) |

Wiki bağlantıları: `enableWikiLinks` açıkken `MarkdownBody`, `[[target]]` ve `[[target|label]]` yazımlarını bağlantıya çevirebilir; desen `/\[\[([^\]\r\n]+)\]\]/g` biçimindedir, URL şeması ya da üst dizine çıkma içeren hedefler reddedilir ve href'i bir çözümleyici ya da bir kök yol kurar (`ui/src/components/MarkdownBody.tsx:356, 365-402, 429-460, 764-766`). Bu depoda seçeneği veren tek çağıran eklenti köprüsüdür (`ui/src/plugins/bridge-init.ts:141, 699, 706`).

Basit liste sayfalarının kullandığı sayfa kalıbı (`ui/src/pages/Goals.tsx:14-63`): konum bilgisi bir effect içinde ayarlanır; şirket yoksa `EmptyState` çizilir; yüklenirken `PageSkeleton` çizilir; ardından bir `space-y-4` sütunu gelir: satır içi bir hata satırı, liste boşsa oluşturma eylemi olan bir `EmptyState`, değilse outline çeşidinde küçük bir eylem düğmesi ve ardından liste. `ui/src/pages/Approvals.tsx:86-134` buna adrese bağlı `Tabs` + `PageTabBar` ve kartlardan oluşan bir `grid gap-3` ekler.

## 8. Tasarım kuralları

### 8.1 DESIGN.md

Ürün duruşu: operasyonel bir kontrol düzlemi; her ekran "what is happening, does it need me, what do I do about it" (ne oluyor, bana ihtiyaç var mı, ne yapmalıyım) sorularını yanıtlar; yoğunluk süsten değil bilgiden gelir (`DESIGN.md:13`).

Sekiz ilke (`DESIGN.md:29-36`), başlıklarıyla:

1. Her şeyin tek bir söyleniş biçimi vardır. Her iş için tek bileşen; çeşitler prop'tur.
2. Görsel değerlerin tek kaynağı değişkenlerdir. Bileşenlerde hex, ham px ya da keyfi Tailwind değeri olmaz. Hazır renk sınıfları özünde koda gömülü değer sayılır ve giderilmesi planlanmış bir borçtur.
3. Boşluklar değişkenlerden geçer; ölçek sonra gelir. Her kapta tek bir gap değeri vardır; kardeş öğeler hem margin hem gap taşımaz.
4. Hiyerarşi süsle değil yapıyla kurulur. Kenarlık, dolgu ve ayırıcı yerine konum, boyut ve kalınlık yeğlenir.
5. Durum sistematiktir. Tek bir durum değişkeni takımı rozette, satırda, grafikte ve kayıtta aynı biçimde kullanılır.
6. Makine değerleri makine işi görünür. Kimlikler, maliyetler, token sayıları, zaman damgaları ve kayıtlar eş aralıklı yazı değişkenini ve ortak biçimlendiricileri kullanır.
7. Sözcükler sistemin parçasıdır. Her kavramın tek adı vardır (kabul edilen terim "task"); düğme yaptığı işi söyler; hata ne olduğunu ve ne yapılacağını söyler; boş ekran ilk adımı gösterir.
8. Ajanların değiştirebileceği biçimde tasarlanmıştır. Doğru bir değişiklik "edit tokens and run checks" (değişkeni düzenle, denetimleri çalıştır) biçiminde olmalıdır.

Bağlayıcı diğer kurallar:

- Sihirbaz ve form alt kısımları: geri planda tutulan ikincil eylem solda, birincil eylem sağda; ikisi de adımın sahip olduğu tek bir satırda durur (`DESIGN.md:38-44`).
- Bildirimler: o an ekranda zaten görünen durum için bildirim çıkmaz; aynı çalışma sonucu yeniden iletilirse bildirimi yinelenmez; çalışma bittikten beş dakikadan uzun süre sonra iletilen sonuç durumu sessizce yeniler; beklenen iptal hata değil, nötr gri olarak gösterilir (`DESIGN.md:58-64`).
- Bekleyen istekler yazma kutusunun hemen üstünde bir kartta görünür ve yazma kutusu kullanılabilir kalır (`DESIGN.md:73-76`).
- Kuralların uygulanması: görsel anlık görüntüler "zero visual change" (görsel değişiklik yok) iddiasını kanıtlar; mekanik yeniden yazımlar depoya işlenmiş codemod'larla yapılır; denetimler geçmelidir (`DESIGN.md:78-88`).
- Hareket: değişkenler `:root` içinde durur ve iki katmanlıdır; projenin iki standart eğrisi yeniden kullanılır; bileşenlerde koda gömülü süre olmaz; azaltılmış hareket değişken katmanında ele alınır (`DESIGN.md:100-124`).

### 8.2 doc/design

| Dosya | İçerik |
|---|---|
| `CHANGING-THE-UI.md` | üç katman (değişkenler, bileşenler, ekran görüntüleri); üç komut (`pnpm check:token-gates`, `pnpm test:storybook-visual`, `pnpm test:storybook-visual:update`); bir değişkeni değiştirme, shadcn hazır ayarıyla temayı yenileme, bileşen kurma ve anlık görüntü hatalarını ele alma tarifleri (`5-60`) |
| `DECISION-SHEET.md` | durum bilgisiyle tutulan karar defteri. İşe yarar girdiler: etiketli her kenar çubuğu bölümü açılıp kapanabilir, varsayılan açıktır ve yalnızca oturum süresince geçerlidir (`40`); çalışıyor durumunun rengi durum mavisidir, asla camgöbeği değil (`48, 54`); tek aç/kapa düğmesi bileşeni ve tek yeşil (`59`); Gelen kutusu ile görev listeleri arasında liste etkileşimi eşliği (`69-71`); satırlarda durum simgesi boyutu 16 px (`83-85`); köşe yuvarlaklığı basamakları (`87-89`); etkileşimli kart kalıbı (`91-93`); karar kartları iki türe indirilmiştir (engelleyen ve inceleme) ve görev durum simgelerini ödünç alır (`103-107`); eylem sırası: outline, destructive, olumlu eylem; sağa yaslı (`117`); kartın tamamını saran halka yalnızca klavye imlecidir (`131-141`); üç satırlı standart görev ön izleme kartı (`151-161`); ilk hareket değişkenleri ve etkisiz `animate-in` bulgusu (`186-202`) |
| `PRIOR-ART.md` | önceki bir incelemeden kalan aday kurallar: role göre köşe yuvarlaklığı, üç düğme kademesi (birincil `default` / `destructive`, ikincil `secondary` / `outline`, üçüncül `ghost` / `link`), adlandırılmış dokuz yazı stili (`13-16`) |
| `KNOWN-DUPLICATES.md` | bilinçli örtüşmeler: sohbet yazma kutusu ile markdown düzenleyici, durum simgesi sistemleri (`7-9`) |
| `COMPONENT-INVENTORY.md`, `TOKEN-AUDIT.md` | incelemeler; başlıca sayılar `TOKEN-AUDIT.md:9-24` içindedir (145 dosyada 3.115 hazır renk sınıfı kullanımı, 730 keyfi yazı boyutu, 206 hex değeri) |
| `AGENT-SESSIONS.md` | bir insanın, tasarım sistemiyle çalışacak bir yapay zekâ oturumuna işi nasıl anlatması gerektiği |

### 8.3 Tasarım kılavuzu sayfası ve skill

- `/design-guide` yolu `ui/src/pages/DesignGuide.tsx` dosyasını çizer (2511 satır). Bölümleri arasında şunlar vardır: Renkler, Tipografi, Köşe yuvarlaklığı, Düğmeler, Rozetler, Durum sistemi, Ajan kapsülü, Form öğeleri, Seçim listesi, açılır menüler (Dropdown Menu ve Popover), Açılıp kapanan bölüm, Kenardan açılan panel, Kaydırma alanı, Komut, Konum bilgisi, Kartlar, Sekmeler, Kayıt satırları, Filtre çubuğu, Avatarlar, İpuçları, Pencere, Boş ekran, İlerleme çubukları, Kayıt görüntüleyici, Özellik satırı kalıbı, Gezinme kalıpları, Gruplanmış liste, Yorum akışı kalıbı, Maliyet tablosu kalıbı, Yükleme iskeletleri, Ayırıcı (`534-1886`).
- Özellik satırı kalıbı: `flex items-center justify-between py-1.5`, etiket `text-xs text-muted-foreground`, değer sağda (`1672-1697`).
- Maliyet tablosu kalıbı: kenarlıklı `rounded-lg` sarmalayıcı, `text-xs`, başlık `border-b border-border bg-accent/20`, hücreler `px-3 py-2`, sayılar `font-mono` (`1827-1856`).
- `.claude/skills/design-guide/SKILL.md` kısmen eskimiştir (bölüm 14).

## 9. Veri katmanı ve canlı güncelleme

### 9.1 HTTP istemcisi

`ui/src/api/client.ts`:

- Temel yol `/api`; `fetch`, `credentials: "include"` ile çağrılır; gövde `FormData` değilse `Content-Type` JSON olur (`5, 46-58`).
- Hatalarda `ApiError { status, body }` fırlatılır; mesaj yanıtın `error` alanından alınır (`7-17, 59-68`). 204 yanıtı `undefined` döndürür (`74`).
- Aynı anda yapılan özdeş GET çağrıları tek bir isteği paylaşır; paylaşılan istek ancak bütün çağıranlar vazgeçtiğinde iptal edilir (`78-153`).
- Her istek iki ipucu başlığı taşır: `X-Paperclip-Tab-Visible` ve `X-Paperclip-Route` (`33-44`).
- Sunduğu işlevler: `api.get`, `post`, `postForm`, `put`, `putRaw`, `patch`, `delete`, `deleteWithBody` (`177-214`).
- `ui/src/api/` içindeki yaklaşık 60 alan modülü, her kaynak için bir tane olmak üzere bu istemciyi sarar; örneğin `sidebarBadges.ts` ve `sidebarPreferences.ts`.

### 9.2 Sorgu kuralları

- Varsayılanlar: `staleTime` 30 s, `gcTime` 5 dk, tarayıcı penceresi odaklanınca yeniden çekme (`ui/src/main.tsx:42-53`).
- Bütün anahtarlar tek bir üretici nesneden, `queryKeys` nesnesinden gelir (`ui/src/lib/queryKeys.ts`, 734 satır); örneğin `queryKeys.liveRuns(companyId)` = `["live-runs", companyId]` (`711`), `queryKeys.dashboard(companyId)` (`656`), `queryKeys.sidebarBadges(companyId)` (`678`), `queryKeys.health` (`625`).
- Şirket listesi anahtarı kullanıcı kimliğini içerir; böylece hesap değişince başka bir hesabın listesi sunulamaz (`ui/src/lib/queryKeys.ts:20-29`).
- Sayfalar `useQuery` çağrısını `enabled: !!selectedCompanyId` ile yapar ve mutation'ların `onSuccess` işlevinde belirli anahtarları geçersiz kılar (`ui/src/pages/Approvals.tsx:33-55`).

### 9.3 Canlı güncelleme

`LiveUpdatesProvider` (`ui/src/context/LiveUpdatesProvider.tsx`, 2081 satır):

- İletim: aynı köken üzerinde `/api/companies/{companyId}/events/ws` adresine tek bir WebSocket; sayfanın protokolüne göre `ws` ya da `wss` (`1978-1983`, `ui/src/lib/websocket-url.ts:13-20`).
- Bağlanma koşulu: sayfa görünür olmalı, oturum sorgusu başarılı olmalı, bir oturum bulunmalı ya da kurulum modu `local_trusted` olmalı ve bir şirket seçili olmalıdır (`1857-1859, 1883, 1924-1930`).
- Mesaj biçimi: `LiveEvent { id, companyId, type, createdAt, payload }` (`packages/shared/src/types/live.ts:3-9`). Türler: `heartbeat.run.queued`, `heartbeat.run.status`, `heartbeat.run.progress`, `heartbeat.run.event`, `heartbeat.run.log`, `agent.session.goal.changed`, `agent.status`, `activity.logged`, `external_object.updated`, `plugin.ui.updated`, `plugin.worker.crashed`, `plugin.worker.restarted` (`packages/shared/src/constants.ts:942-955`).
- İşleme (`handleLiveEvent`, `1652-1790`):

| Olay | Önbelleğe etkisi | Bildirim |
|---|---|---|
| `heartbeat.run.queued`, `heartbeat.run.status` | şirketin süren çalışma listesini yerinde günceller, heartbeat sorgularını geçersiz kılar, çalışma yeniden kurulamıyorsa bir kez yeniden çeker, ekrandaki görevin çalışma sorgularını yeniler | bastırılmamışsa `failed`, `timed_out`, `cancelled` durumlarında (`878, 1069-1134, 1688-1712`) |
| `heartbeat.run.progress` | ilerleme sorgularını geçersiz kılar | yok (`1714-1718`) |
| `heartbeat.run.log`, `heartbeat.run.event` | yalnızca canlı durum güncellemesi | yok (`1684-1686, 1720-1722`) |
| `agent.status` | ajan listesini, Genel bakış ekranını, organizasyon verisini ve ajan ayrıntısını geçersiz kılar | yalnızca `error` durumunda (`877, 1724-1756`) |
| `activity.logged` | kayda ve eyleme göre hedefli geçersiz kılma | başkasının yaptığı `issue.created`, `issue.updated`, `issue.comment_added` olaylarında ve katılma isteklerinde (`845-849, 913-1038, 1758-1789`) |
| diğer türler | bu işlevde yok | yok |

- Ayrıştırılan her olay ayrıca `useCompanyLiveEvent(handler)` üzerinden abone bileşenlere dağıtılır (`113-125, 2025-2031`).
- Geçersiz kılmaların toplanması: işleyicinin yaptığı `invalidateQueries` çağrıları, aynı filtreleri teke indiren ve 300 ms'lik sürenin sonunda çalışan bir kısıtlayıcıdan (trailing throttle) geçer; doğrudan `setQueryData` yazımları beklemeden geçer (`ui/src/lib/query-invalidation-batcher.ts:28, 40-97, 134-147`). Sekme gizliyken geçersiz kılmalar sorguları yeniden çekmez, yalnızca bayat olarak işaretler (`66-68`).
- Gizli sekmeler: bağlantı effect'i sayfanın görünürlüğüne bağlıdır; sekme gizlenince effect'in temizleme işlevi çalışır ve soketi kapatır, effect'in sonraki çalışması da erkenden döner (`1924-1929, 2056-2074`); sekme gizliyken yine de gelen mesaj yok sayılır (`2007`). Sekme yeniden görünür olunca soket yeniden bağlanır ve bütün etkin sorgular bir kez geçersiz kılınır (`1931-1935`). Olaylar yeniden oynatılmadığı için aynı eşitleme her soket açılışında çalışır (`2000-2002`).
- Yeniden bağlanma: bekleme süresi 1, 2, 4, 8 s, sonra 15 s (`1965-1976`). Bağlantı kopukken etkin sorgular 15 s'de bir geçersiz kılınır (`59, 1957-1963`).
- Bildirimlerin sınırlanması: her kategoride 10 s içinde en çok 3 bildirim çıkar; yeniden bağlandıktan sonraki 2 s içinde hiç bildirim çıkmaz; hatırlanan en çok 2000 çalışma sonucu yinelemeyi önler; 5 dakikadan eski sonuçlar sessiz kalır; o an ekranda olan görevle ilgili olaylar bastırılır (`54-58, 1594-1650, 1667-1670`).

### 9.4 Yoklama

- `resolvePollingInterval`; görünür ve odaktaki sekme için olağan aralığı, odakta değilken isteğe bağlı daha uzun bir aralığı döndürür, sekme gizliyken aralık döndürmez (`ui/src/lib/polling.ts:43-50`).
- `useSharedPollingQuery({ companyId, resourceKey, queryKey, refetchInterval?, leaderOnly? })`, `localStorage` üzerindeki süreli bir kilitle şirket başına görünür tek bir lider sekme seçer ve sonuçları `BroadcastChannel` üzerinden paylaşır; böylece açık birden çok sekme aynı uç noktaları yoklamaz (`ui/src/hooks/useSharedPolling.ts:12-25`, `ui/src/lib/cross-tab-poll.ts:1-29`).
- Kabukta görülen diğer sabit aralıklar: ilgi bekleyenler akışı 60 s (`ui/src/components/Sidebar.tsx:105`), ayarlar kenar çubuğu rozetleri 15 s (`ui/src/components/CompanySettingsSidebar.tsx:73`), sağlık sorgusu yalnızca geliştirme sunucusu algılandığında 2 s (`ui/src/components/Layout.tsx:242-245`).

## 10. i18n

- Kütüphaneler: `i18next` 26.4.2 ve `react-i18next` 17.0.15 (`pnpm-lock.yaml:1175-1177, 1199-1201`).
- Başlatma: kaynaklar bütün `./locales/*.json` dosyalarından gelir; `lng` değeri `"en"` olarak sabittir, yedek dil `"en"`; dil algılayıcı yoktur (`ui/src/i18n/index.ts:6-19`, `ui/src/i18n/locales.ts:5-10`).
- 40 dil dosyası vardır (`tr.json` dâhil). Her biri yalnızca `app.noCompanies.title`, `.description`, `.newCompany` anahtarlarını içerir (`ui/src/i18n/locales/en.json`, `ui/src/i18n/locales/tr.json`).
- `t()` işlevini yalnızca `ui/src/App.tsx` kullanır (`595, 714, 717, 724, 737`); bu anahtarlardan biri olan `app.cloudCreateUnavailable` dil dosyalarında yoktur ve kendi `defaultValue` değerine dayanır.
- Geri kalan her şey, bu raporda alıntılanan bütün etiketler de dâhil, koda gömülü İngilizce JSX'tir. Dil değiştirici yoktur.

## 11. Klavye kısayolları

Genel işleyici: `Layout` içinde bağlanan `useKeyboardShortcuts` (`ui/src/components/Layout.tsx:455-462`). `input`, `textarea`, `select`, contenteditable, `role="textbox"` ve `role="combobox"` öğelerinde basılan tuşları ve bir pencere açıkken basılan tuşları yok sayar (`ui/src/lib/keyboardShortcuts.ts:1-9, 25-33`, `ui/src/hooks/useKeyboardShortcuts.ts:88-97`).

| Tuşlar | Eylem | Kanıt |
|---|---|---|
| Cmd+K ya da Ctrl+K | komut paletini açar (yazı alanlarında da çalışır) | `ui/src/components/CommandPalette.tsx:108-118` |
| `/` | sayfanın kendi arama alanı (`[data-page-search-target='true']`) görünüyorsa ona odaklanır, yoksa paleti açar | `ui/src/hooks/useKeyboardShortcuts.ts:99-106`, `ui/src/lib/keyboardShortcuts.ts:11, 47-61` |
| `?` | kısayol listesini açar | `ui/src/hooks/useKeyboardShortcuts.ts:108-113` |
| `c` | yeni görev | `115-119` |
| `[` | kenar çubuğunu açıp kapatır (geniş ekranda tamamen gizlenir ya da gösterilir) | `121-125`, `ui/src/components/SidebarShell.tsx:116-118` |
| `]` | özellik panelini açıp kapatır | `127-131` |
| `g` sonra `i` | Gelen kutusu ekranına gider; tuş dizisi 1200 ms boyunca bekler | `27-49, 57-77`, `ui/src/lib/keyboardShortcuts.ts:207-208` |
| `g` sonra `c` | yorum yazma kutusuna odaklanır (görev ayrıntısı) | `ui/src/lib/keyboardShortcuts.ts:209` |
| `g` sonra `f` | dosya görüntüleyiciyi açar (görev ayrıntısı, deneysel) | `ui/src/lib/keyboardShortcuts.ts:210` |
| Palet açıkken Cmd+Enter ya da Ctrl+Enter | tam arama sayfasını açar | `ui/src/components/CommandPalette.tsx:230-234` |
| Kenar çubuğu boyutlandırma tutamağında ok tuşları, Home, End | 16 px'lik adımlarla boyutlandırır, en küçük ya da en büyük değere atlar | `ui/src/components/SidebarShell.tsx:176-195` |

Kısayol listesinde yer alan sayfa düzeyindeki kısayollar (`ui/src/components/KeyboardShortcutsCheatsheet.tsx:16-62`): Gelen kutusu ekranında gezinmek için `j` / `k` / ok tuşları, bir grubu kapatıp açmak için sol ve sağ ok, açmak için Enter, arşivlemek için `a` ya da `y`, okundu için `r`, okunmadı için `U`; görev ayrıntısında hızlı arşivleme için `y`; Decisions ekranında `j` / `k`, açıp kapatmak için Enter, yok saymak için `x`. Bunların saf çözümleyici işlevleri `ui/src/lib/keyboardShortcuts.ts:89-179` içindedir.

Kısayol listesi bölümlere ayrılmış bir penceredir; tuşlar `kbd` öğesiyle (`h-6 min-w-6 rounded border border-border bg-muted px-1.5 font-mono text-xs`) çizilir, tuş dizilerinde tuşların arasına "then" yazılır (`64-70, 89-99, 122-131`).

## 12. Bağımlılıklar ve Storybook

### 12.1 Kütüphaneler

Paketler `ui/package.json:31-92` içinde bildirilmiştir; çözümlenen sürümler `pnpm-lock.yaml:1097-1265` içinden alınmıştır. Düz sayılar çözümlenen sürümlerdir; şapka işaretli girdiler, çözümlenen sürümüne bakmadığım paketlerin bildirilen aralığıdır.

| Alan | Paket | Sürüm |
|---|---|---|
| Çatı | `react`, `react-dom` | 19.2.8 |
| Derleme | `vite`, `@vitejs/plugin-react`, `typescript` | 8.2.2, ^6.1.1, 7.0.2 |
| Yönlendirme | `react-router-dom` | 7.18.4 |
| Sunucu durumu | `@tanstack/react-query` | 5.102.8 |
| Stil | `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/typography` | 4.3.3, 4.3.3, 0.5.20 |
| Sınıf yardımcıları | `class-variance-authority`, `clsx`, `tailwind-merge` | 0.7.1, ^2.1.1, 3.6.0 |
| Temel bileşenler | `radix-ui` (tek paket), `@radix-ui/react-slot`, `@base-ui/react` | 1.6.7, ^1.3.3, ^1.7.0 |
| Simgeler | `lucide-react` | 1.48.0 |
| Komut menüsü | `cmdk` | 1.1.1 |
| Sürükleyip bırakma | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | 6.3.1, 10.0.0, ^3.2.2 |
| Markdown gösterimi | `react-markdown`, `remark-gfm`, `mermaid` | 10.1.0, 4.0.1, 11.17.2 |
| Markdown düzenleme | `@mdxeditor/editor`, `lexical`, `@lexical/link`, `yjs` | 4.2.3, 0.48.0, 0.48.0, 13.6.32 |
| Hareket | `motion` | 13.1.1 |
| Paneller | `react-resizable-panels` | 4.12.3 |
| Sohbet arayüzü | `@assistant-ui/react` | 0.15.22 |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit` | ^6.0.0, ^0.11.0 |
| i18n | `i18next`, `react-i18next` | 26.4.2, 17.0.15 |
| Hatalar | `@sentry/browser` (geliştirme bağımlılığı) | 10.71.0 |
| Testler | `vitest` | 4.1.11 |
| Storybook | `storybook`, `@storybook/react-vite`, a11y ve docs eklentileri | 10.6.0, 10.5.10, 10.6.0 |

`ui/src` ve `ui/storybook` içinde hiçbir yerde bulunmayanlar (içe aktarma dizgileri için yapılan grep sonuç vermedi): `zod`, `react-hook-form`, `recharts`, `sonner`, `tailwindcss-animate`, `tw-animate-css`.

Vite yapılandırması: eklentiler `react()`, `tailwindcss()` ve service worker'a derleme kimliği basan bir eklenti; `@` takma adı `./src` klasörünü gösterir; geliştirme portu 5173'tür ve bir API vekili (proxy) vardır; üretim derlemesi `console` ve `debugger` satırlarını çıkarır (`ui/vite.config.ts:18-42`). Service worker yalnızca derleme çıktılarını önbelleğe alır ve statik bir çevrimdışı sayfası sunar (`ui/public/sw.js:1-26`).

### 12.2 Storybook

- Yapılandırma: `ui/storybook/.storybook/main.ts`; story deseni `../stories/**/*.stories.@(ts|tsx|mdx)`, docs ve a11y eklentileri, autodocs açık, Tailwind Vite eklentisi üzerinden gelir (`18-34`).
- Ön izleme, story'leri uygulamadakiyle aynı sağlayıcılarla sarar (yönlendirici, sorgu istemcisi, tema, bildirim, ipucu, konum bilgisi, kenar çubuğu, panel, pencere, şirket) ve `fetch` yerine hazır test verileri koyar (`ui/storybook/.storybook/preview.tsx:9-28, 87-90`).
- `ui/storybook/stories/` altında 157 story dosyası vardır; aralarında `foundations`, `navigation-layout`, `status-language`, `primitives-coverage`, `dialogs-modals`, `forms-editors`, `overview` bulunur.
- Görsel regresyon: her story'nin açık ve karanlık temada Playwright ekran görüntüsü alınır; 255 story için 510 referans görüntü vardır. Görüntüler git dışında saklanır ve `tests/storybook-visual/baseline-manifest.json` dosyasında tanımlanır (`doc/design/CHANGING-THE-UI.md:11`). Kök betikler: `storybook`, `build-storybook`, `test:storybook-visual`, `test:storybook-visual:update` (`package.json:17-18, 64-65`).

## 13. Taşınabilirlik notları

Bu bölüm Agent Office için benim değerlendirmemdir (React + Vite, TanStack Router ve Query, Radix ve Tailwind ile shadcn/ui, react-hook-form ve zod, Fastify API, Türkçe arayüz, tek kurulumda iki şirket, Onay Masası, YAML görev kartları, Obsidian tarzı notlar). Paperclip'e ilişkin tespitlerin kaynağı gösterilmiştir; Agent Office hakkındaki ifadeler onun `CLAUDE.md` dosyasından gelir.

### 13.1 Küçük düzenlemelerle alınabilecekler

| Parça | Kaynak | Neden kolay taşınır |
|---|---|---|
| Değişken yapısı | `ui/src/index.css:43-138, 393-431, 2404-2423, 2488-2522`, `ui/src/motion-tokens.css` | shadcn adlarını taşıyan düz CSS değişkenleri; değerler değiştirilir, `--sc` durum etiketi tarifi, köşe yuvarlaklığı basamakları, yazı boyutu basamakları ve hareket değişkenleri korunur |
| Temel bileşenler | `ui/src/components/ui/*` | standart shadcn biçimi; yalnızca `cn`, Radix, cva ve lucide bağımlılığı var |
| Kenar çubuğu yapı taşları | `SidebarShell.tsx`, `SidebarNavItem.tsx`, `SidebarSection.tsx`, `primary-sidebar-styles.ts`, `contextual-sidebar-styles.ts` | bağımsız; ölü simge çubuğu dalları silinebilir |
| Konum bilgisi sistemi | `BreadcrumbContext.tsx`, `BreadcrumbBar.tsx` | bir context ve bir çubuk; eklenti yuvaları çıkarılır |
| Özellik paneli | `PanelContext.tsx`, `PropertiesPanel.tsx`, `side-panel/*` | yan panel takımının alana özgü hiçbir şey içermediği belgelenmiş |
| Pencere altyapısı | `DialogContext.tsx` | state ile eylemleri ayıran küçücük bir yapı |
| Bildirimler | `ToastContext.tsx`, `ToastViewport.tsx` | yönlendiricinin `Link` bileşeni dışında bağımlılığı yok |
| Tema | `ThemeContext.tsx`, `ThemeToggle.tsx`, `ui/index.html:19-43` içindeki satır içi betik | bağımsız |
| Komut paleti iskeleti | `ui/command.tsx`, `CommandPalette.tsx` dosyasının yapısı | veri sorguları ve sayfa listesi değiştirilir |
| Telefon alt menüsü | `MobileBottomNav.tsx` | beş gözlü ızgara; öğeler değiştirilir |
| Sayfa parçaları | `EmptyState`, `PageSkeleton`, `EntityRow`, `MetricCard`, `FilterBar`, `PageTabBar`, `CollectionToolbar`, `InlineBanner`, `QuotaBar`, `CopyText` | yalnızca sunum |
| Durum sistemi | `lib/status-colors.ts`, `StatusBadge.tsx`, `StatusGlyph.tsx`, `StatusIcon.tsx` | Agent Office'in görev ve onay durumları aynı mekanizmaya eşlenir |
| Wiki bağlantılı markdown gösterimi | `MarkdownBody.tsx` | `[[Not adı]]` ve `[[target\|label]]` yazımlarını bir çözümleyici işleviyle zaten destekliyor; Notlar özelliğine uyar |
| Kısayollar | `useKeyboardShortcuts.ts`, `lib/keyboardShortcuts.ts`, `KeyboardShortcutsCheatsheet.tsx` | saf işlevler ve bir hook |
| HTTP ve canlı güncelleme altyapısı | `api/client.ts`, `lib/query-invalidation-batcher.ts`, `lib/polling.ts`, `lib/page-visibility.ts` | genel amaçlı; çerez oturumlu bir Fastify `/api` yapısına uyar |
| Kaydırma ve odak yardımcıları | `lib/navigation-scroll.ts`, `lib/main-content-focus.ts` | genel amaçlı |
| Değişken denetimi | `scripts/check-token-gates.mjs` | aynı "yalnızca değişken" kuralı için CI denetimi olarak işe yarar |

Lisans konusu başka bir raporda ele alınıyor; bu alan için yalnızca şunu not etmek yeter: `ui/package.json:5` MIT bildirir ve paketle gelen yazı tipi SIL OFL kapsamındadır (`ui/public/fonts/NOTICE.md`).

### 13.2 Uyarlama gerektirenler

| Konu | Paperclip | Agent Office için değişiklik |
|---|---|---|
| Yönlendirici | `@/lib/router` arkasında `react-router-dom` 7; `NavLink` bileşeninin işlev biçimindeki `className` özelliğine (`SidebarNavItem.tsx:123`), bağlantının `state` değerine (`119`), `useNavigationType` ve `location.key` kullanımına (`Layout.tsx:118, 143, 601-603`), `Outlet` ve `Navigate` bileşenlerine dayanır | sarmalayıcı ve bu çağrı yerleri TanStack Router için yeniden yazılır; tek içe aktarma yolu olan `@/lib/router`, değişecek yerleri bulmayı kolaylaştırır |
| Şirket kapsamı | her yönetim kurulu yolunun adresinde şirket kodu bulunur; kodu sarmalayıcı kendiliğinden ekler | Agent Office'te şirket girişten sonra seçilir. İki seçenek arasında karar verilmelidir: adreste şirket başına bir parça (paylaşılabilir bağlantılar, kolayca "iki sekme, iki şirket") ya da oturumda tutulan şirket. Kurucunun holding görünümünün, okuduğum kabuk dosyalarında bir karşılığı yok |
| Formlar | state elle tutulur; `ui/` içinde react-hook-form ya da zod yok | görsel temel bileşenler korunur; formlar Agent Office'in istediği gibi react-hook-form ve zod ile yazılır |
| Dil | koda gömülü İngilizce JSX; i18n kullanılmıyor | bütün metinler Türkçe yeniden yazılmalıdır; çıkarılıp alınacak hazır bir metin kümesi yok |
| Tailwind sürümü | `text-(length:--text-compact)` ve `@theme inline` gibi Tailwind 4 söz dizimi | Tailwind 4 gerekir; Tailwind 3 kullanılırsa bu tür bütün sınıflar yeniden yazılmalıdır |
| Radix içe aktarmaları | tek paketli `radix-ui` | ya `radix-ui` benimsenir ya da içe aktarmalar, hedef projenin kullandığı ayrı paketli biçime çevrilir |
| Ortak tipler | bileşenler tipleri `@paperclipai/shared` paketinden içe aktarır | Agent Office'in `packages/shared` tipleriyle değiştirilir |
| Eklentiler, bulut, bayraklar | `Sidebar`, `BreadcrumbBar`, `Layout` içindeki eklenti yuvası çıkışları; bulut ve gizli ayar kapıları; çok sayıda deneysel bayrak; 23 `.production` eşi | silinir; hiçbiri geçerli değil |
| Canlı güncelleme | `LiveUpdatesProvider.tsx` 2081 satırdır ve Paperclip'in içeriklerine ve sorgu anahtarlarına bağlıdır | dosya değil kalıp alınır (şirket başına tek soket, abonelere dağıtım, toplayıcı, yedek olarak yoklama, bildirim sınırlaması) |
| Gelen kutusu rozeti | tarayıcıda dört sorgudan hesaplanır | Agent Office'in Onay Masası sayısı daha basittir; sunucudan gelen tek bir sayı yeter |
| Ajan avatarları | sunucunun ürettiği PNG karakterler (`/api/agent-avatars/...`) | bir sunucu yolu ve çizimler gerekir; ya da yalnızca baş harfler ve kapsül kullanılır |
| Onaylar | `ApprovalCard` bileşeninde iki eylem vardır, Onayla ve Reddet; onay düğmesi ham bir yeşil sınıf kullanır | Agent Office'te "düzeltme istendi" dâhil dört onay durumu ve passkey ile yeniden kimlik doğrulama vardır; kopyalamak yerine genişletilmelidir. Karar defterindeki eylem sırası kuralı (outline, destructive, olumlu eylem; sağa yaslı) hazır bir kuraldır |
| PWA | manifest `display: "browser"`, yalnızca derleme çıktılarını önbelleğe alan service worker | Agent Office telefona uygun bir PWA istiyor; `standalone` kullanılıp kullanılmayacağına ve neyin önbelleğe alınacağına karar verilmelidir |
| Grafikler | elle kurulmuş çubuklar | basit maliyet çubukları için yeterli; daha zengin her şey için kütüphane gerekir |
| Animasyon | shadcn giriş ve çıkış sınıfları etkisiz | ya böyle bırakılır (Agent Office'in "Hareket yalnızca kullanıcının yaptığı işin sonucunu gösterir" kuralına uyar) ya da bilerek bir animasyon eklentisi kurulur |

### 13.3 Agent Office tasarım kurallarıyla çatışanlar

Bunlar, Paperclip'in görünümünü kopyalamanın Agent Office'in `CLAUDE.md` dosyasındaki bir kuralı çiğneyeceği noktalardır. Karar proje sahibine aittir; ben seçim yapmıyorum.

| Agent Office kuralı | Paperclip'teki uygulama | Kanıt |
|---|---|---|
| Büyük harfli üst etiket yok; başlıklar cümle düzeninde | sayfa başlıkları ve ilk konum bilgisi öğesi büyük harfli ve geniş harf aralıklıdır; kenar çubuğu bölüm etiketleri büyük harfli, eş aralıklı ve 10 px'tir; grup başlıkları ve kılavuz başlıkları büyük harflidir | `BreadcrumbBar.tsx:158, 173, 199, 207`, `SidebarSection.tsx:77`, `contextual-sidebar-styles.ts:12`, `IssueGroupHeader.tsx:38`, `KeyboardShortcutsCheatsheet.tsx:78` |
| Yazı tipi IBM Plex Sans, tek aile | Inter (değişken yazı tipi) ve sistemin eş aralıklı yazı tipi yığını | `ui/src/index.css:44-45` |
| Vurgu rengi `#127A77`, açık zemin `#F6F7F9` ve beyaz yüzey | yalnızca gri tonlar; birincil renk siyaha ya da beyaza yakın; sayfa varsayılan olarak karanlık temayla gelir, kayıtlı tercih yoksa işletim sistemi tercihine döner | `ui/src/index.css:103-138`, `ui/index.html:2, 19-43` |
| Ortadan noktalı meta dizgileri yok | belge başlığı " • " ile birleştirilir; "Blocked · waiting on ..." gibi durum etiketleri; "Press Esc to close · ..." | `BreadcrumbContext.tsx:74`, `StatusIcon.tsx:33-63`, `KeyboardShortcutsCheatsheet.tsx:108`, `doc/design/DECISION-SHEET.md:143-149` |
| Arayüz metinlerinde uzun tire yok | etkinlik satırlarında adı ve başlığı bir uzun tire ayırır; varsayılan bir metinde de uzun tire geçer | `ActivityRow.tsx:79`, `App.tsx:597` |
| Ayrım gölgeyle değil ince çizgi ve boşlukla yapılır; cam efekti yok | açılır menülerde büyük gölge, üst katmanlarda `shadow-md` ve `shadow-lg`, etkileşimli kartlarda üzerine gelince gölge; bildirimler ve telefon üst çubuğu `backdrop-blur` kullanır | `ui/src/index.css:344`, `card.tsx:23`, `ToastViewport.tsx:43`, `Layout.tsx:704` |
| Hareket yalnızca kullanıcının yaptığı işin sonucunu gösterir; süs amaçlı giriş animasyonu yok | yanıp sönen canlı noktalar, dönen "sürüyor" simgesi, nabız gibi atan ve yanıp sönen ajan kapsülleri, Genel bakış ekranında satırların animasyonlu girişi | `SidebarNavItem.tsx:190`, `StatusGlyph.tsx:92`, `ui/src/index.css:1254-1287, 1513-1529` |
| Mor ve mavi geçişli arka plan yok | ajan kapsülü renk geçişleri arasında mor ve mavi çiftler var; bunlar sayfa arka planı değil, küçük kimlik dolgularıdır | `ui/src/index.css:164-183` |
| Süs ikonu yok | her menü satırında simge var; boş ekranlar büyük, soluk bir simge gösterir | `Sidebar.tsx:167-247`, `EmptyState.tsx:29-31` |
| Telefon alt menüsü: Bugün, Onaylar, Görevler, Notlar, Ofis | Ana sayfa, Görevler, Yeni görev, Ajanlar, Gelen kutusu | `MobileBottomNav.tsx:46-56` |
| Hata `#C2412D` ve "Onay bekliyor" `#9A6412` için adlandırılmış değişkenler | durum renkleri mavi, sarı, mor, yeşil, kırmızıdır; bildirim tonları ve pek çok rozet doğrudan hazır Tailwind renk sınıflarını kullanır | `ui/src/index.css:201-220`, `ToastViewport.tsx:12-17`, `status-colors.ts:69-136` |
| Renk kontrastı en az WCAG AA | bölüm etiketleri 10 px boyutunda `text-muted-foreground/60` kullanır; yeniden kullanılmadan önce ölçülmelidir | `SidebarSection.tsx:77` |

Agent Office kurallarıyla zaten uyuşanlar: gölgesiz, kenarlıkla ayrılan kartlar (`card.tsx:21`), öğe türüne göre tutarlı küçük köşe yuvarlaklıkları (bölüm 5.6), bütün denetimlerde görünür klavye odak halkası (`button.tsx:8`), atlama bağlantısı ve gezinmede odak yönetimi (`Layout.tsx:630-635`, `main-content-focus.ts`), azaltılmış hareketin değişken katmanında ele alınması (`ui/src/index.css:874-896`), 44 px'lik dokunma hedefleri (`594-603`), ölçümlerde eşit genişlikte rakamlar (`MetricCard.tsx:21`), kimliklerde eş aralıklı yazı (`EntityRow.tsx:87`), yaptığı işi söyleyen düğmeler ve ilk adımı sunan boş ekranlar (`DESIGN.md:35`, `EmptyState.tsx:43-48`), üst katmanlarda giriş animasyonu olmaması.

### 13.4 Değişkenler için rol eşlemesi

Değerler taşınmasa da yapının taşınabildiğini göstermek için bir öneri:

| Paperclip değişkeni | Rol | Agent Office değişkeni |
|---|---|---|
| `--background`, `--card`, `--popover` | içerik ve kart yüzeyi | `--surface` |
| kenar çubuğu yüzey karışımı, `--muted` | geri planda kalan yüzey | `--canvas` |
| `--foreground` | metin | `--ink` |
| `--muted-foreground` | ikincil metin | `--ink-secondary` |
| `--border` | çizgiler | `--line` |
| `--input` | alan kenarlığı | `--field-border` |
| `--primary`, `--ring` | vurgu ve odak | `--brand` |
| `--destructive`, `--status-task-blocked` | hata | `--error` |
| `--status-task-todo` (sarı) | bekleme | `--awaiting-approval` |

Paperclip içeriği ve kartları aynı renkte tutar, kenar çubuğunu ise hafifçe renklendirir. Agent Office gri bir zemin ve beyaz bir yüzey tanımlar; bu yüzden hangi alanın hangi rengi alacağı, açıkça verilmesi gereken bir yerleşim kararıdır.

## 14. Belge ve kod uyuşmazlıkları

| Belge | Yazan | Kod |
|---|---|---|
| `.claude/skills/design-guide/SKILL.md:70` | `--radius` 0.625rem | 0.5rem (`ui/src/index.css:102`) |
| `.claude/skills/design-guide/SKILL.md:127` | çalışan ajanın noktası camgöbeği | mavi (`ui/src/lib/status-colors.ts:291`) |
| `.claude/skills/design-guide/SKILL.md:273-279` | `CompanySwitcher` içeren `w-60` kenar çubuğu, `w-80` özellik paneli | `SidebarCompanyMenu` içeren, boyutlandırılabilir `SidebarShell`; boyutlandırılabilir panel 322 px; `CompanySwitcher.tsx` kullanılmıyor |
| `doc/design/DECISION-SHEET.md:111` | karanlık temada `--background` 0.145'tir ve `--card` değerinden farklıdır | ikisi de `oklch(0.205 0 0)` (`ui/src/index.css:394, 399`) |
| `DESIGN.md:102` | bayrak `enableTaskChatRedesign` | koddaki bayrak `enableClassicTaskInterface` (`ui/src/hooks/useClassicTaskInterfaceEnabled.ts:41`); eski ad yalnızca `server/src/__tests__/instance-settings-service.test.ts:113-117` içinde kalmış |
| `DESIGN.md:81` | yaklaşık 24 temel bileşen ve yaklaşık 46 story | 26 temel bileşen, 157 story dosyası |
| `ui/src/pages/DesignGuide.tsx:1730-1750` | `rounded-md px-3 text-sm bg-accent` sınıflı kenar çubuğu satırı örneği | gerçek satır `rounded-lg px-2 text-(length:--text-compact) bg-sidebar-accent` kullanır (`SidebarNavItem.tsx:129-132`) |
| `ui/src/components/CommandPalette.tsx:381-388` | "Costs" ve "Activity" sayfaları | kenar çubuğundaki satır `/activity` adresindeki "Audit"; sade kabukta `/costs` yönlendirilir (`App.tsx:402`) |

## 15. Doğrulama notları

- Bu rapor için baştan sona yeniden okunanlar: `App.tsx`, `main.tsx`, `lib/router.tsx`, `lib/company-routes.ts`, `lib/shell-navigation.ts`, `Layout.tsx`, `Sidebar.tsx`, `SidebarShell.tsx`, `SidebarNavItem.tsx`, `SidebarSection.tsx`, `SidebarCompanyMenu.tsx`, `SidebarAccountMenu.tsx`, `SidebarRecentTasks.tsx`, `SidebarStarredProjects.tsx`, bütün bağlama özel kenar çubukları, `BreadcrumbBar.tsx`, `BreadcrumbContext.tsx`, `PanelContext.tsx`, `PropertiesPanel.tsx`, `CommandPalette.tsx`, `MobileBottomNav.tsx`, `ThemeContext.tsx`, `ThemeToggle.tsx`, `ToastContext.tsx`, `ToastViewport.tsx`, `SidebarContext.tsx`, `DialogContext.tsx`, `CloudAccessGate.tsx`, 26 temel bileşenin tamamı, `lib/status-colors.ts`, bölüm 7'deki ortak bileşenler, `api/client.ts`, `lib/query-invalidation-batcher.ts`, klavye dosyaları, i18n dosyaları, `DESIGN.md`, `CHANGING-THE-UI.md`, `DECISION-SHEET.md`, `PRIOR-ART.md`, `KNOWN-DUPLICATES.md`, `motion-tokens.css`, `ui/package.json`, `components.json`, `index.html`, `vite.config.ts`.
- Belirli aralıkları okunanlar: `index.css` (1-1307, 1455-1654, 1930-2204, 2322-2356, 2395-2564, 2690-2969, 3095-3190), `LiveUpdatesProvider.tsx` (1-135, 843-1142, 1590-2081), `DesignGuide.tsx` (286-315, 497-536, 620-724, 1668-1862), `CompanyContext.tsx` (1-120), `MarkdownBody.tsx`, `MarkdownEditor.tsx`, `InlineEditor.tsx`, `IssueRow.tsx` (prop'lar), `useInboxBadge.ts`, `inbox.ts` (rozet işlevi), `polling.ts`, `useSharedPolling.ts`, `cross-tab-poll.ts` (dosya başları).
- Burada adı geçen ama derinlemesine incelenmeyenler: `SidebarProjects.tsx`, `SidebarAgents.tsx` (eski kabuk), `IssueRow.tsx` dosyasının gövdesi, `SearchableSelect.tsx`, `InlineEntitySelector.tsx`, `agent-config-primitives.tsx`, `CompanyPatternIcon.tsx`, `AgentIconPicker.tsx`, `FileViewerSheet.tsx`, eklenti yuvası sistemi, Gelen kutusu ile görev ayrıntısındaki sayfa düzeyi klavye işleyicileri.
- Bölüm 3.6'daki kapı bileşenlerinin satır numaraları `grep -n` ile doğrulandı.
