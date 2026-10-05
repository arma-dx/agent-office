# Paperclip iş ekranları (02 numaralı rapor)

> Ara rapor. 3 Ekim 2026'da, Agent Office deposu okunmadan önce İngilizce yazıldı; depoya konurken Türkçeye çevrildi. Asıl belge `docs/paperclip-incelemesi.md` dosyasıdır; ikisi çelişirse o geçerlidir. Okuma notu ve bilinen düzeltmeler: [`00-okuma-notu.md`](00-okuma-notu.md).

Depo: `/home/claude/paperclip`, commit `dd868ed`. Aşağıdaki bütün yollar bu köke göredir. İnceleme salt okunurdu: hiçbir şey kurulmadı, derlenmedi, çalıştırılmadı ya da değiştirilmedi. Kaynak gösterimi `path:line` biçimindedir ve her zaman tam yolu verir. Bir davranış bir bayrağa bağlıysa bayrağın adı ve varsayılan değeri yazıldı.

Amaç: günlük iş ekranlarını (Genel bakış, Gelen kutusu, görev listesi, yeni görev penceresi, görev sayfası, çalışma görünümleri, arama, zaman çizelgesi, Denetim, çıktılar, Cases ve Pipelines) başka bir React uygulamasında (Agent Office) yeniden kurmaya yetecek ayrıntıda anlatmak.

## 0. Okuma kılavuzu

- Kodda görevin adı `Issue`; arayüz her zaman "Task" der (konum bilgisi etiketi `ui/src/pages/Issues.tsx:140`, kenar çubuğu satırı `ui/src/components/Sidebar.tsx:197`). Yollar `/issues` olarak kalır; `/tasks` buraya yönlendirilir (`ui/src/App.tsx:303-304`).
- Ajan çalışmasının koddaki adı `HeartbeatRun` (`packages/shared/src/types/heartbeat.ts:156`).
- Yönetim kurulu yollarının hepsi `/:companyPrefix/...` altındadır; şirket kodu taşımayan yollar yönlendirilir (`ui/src/App.tsx:774-783`).
- Arayüz React + Vite ve TanStack Query ile yazılmıştır; HTTP istemcisi `/api` taban yolunu kullanır ve çerezleri gönderir (`ui/src/api/client.ts:5`, `ui/src/api/client.ts:54-55`).
- Bu raporun sınırları bölüm 17'de sayılmıştır.

## 1. Kabuklar ve bayraklar

Paperclip'te iki arayüz kabuğu ve iki ayrı görev sayfası arayüzü vardır. Hangisinin çizileceğini kurulum düzeyindeki deneysel ayarlar belirler.

| Bayrak | Varsayılan | Bu ekranlarda neyi açar | Kanıt |
|---|---|---|---|
| `enableStreamlinedUi` | true | Yeni kabuk: sade Gelen kutusu, görev listesi satırları (`presentation="task"`), Denetim ekranı. Hata durumunda açık kalır: eski kabuğu yalnızca açıkça verilen `false` değeri getirir | `packages/shared/src/validators/instance.ts:48`; `ui/src/hooks/useStreamlinedUiEnabled.ts:13`, `ui/src/hooks/useStreamlinedUiEnabled.ts:22-26`; `ui/src/pages/Inbox.tsx:792-795`; `ui/src/components/IssuesList.tsx:696-699` |
| `enableClassicTaskInterface` | false | Bölümleri alt alta dizen eski görev sayfasına dönüş seçeneği (Chat / Activity / Related work sekmeleri). Varsayılan, sohbet biçimindeki görev sayfasıdır. Hata durumunda kapalı kalır ve sohbet biçimi gösterilir | `packages/shared/src/validators/instance.ts:61`; `ui/src/hooks/useClassicTaskInterfaceEnabled.ts:18-27`; `ui/src/pages/IssueDetail.tsx:942-959` |
| `enableDecisions` | false | Kenar çubuğundaki "Decisions" satırı ve `/decisions` yolundaki kararlar masası | `packages/shared/src/validators/instance.ts:70`; `ui/src/components/Sidebar.tsx:100`, `ui/src/components/Sidebar.tsx:179-187` |
| `enableStatusCards` | false | Kenar çubuğundaki "Status" satırı (beta) ve `/status` yolu | `packages/shared/src/validators/instance.ts:69`; `ui/src/components/Sidebar.tsx:94`, `ui/src/components/Sidebar.tsx:188`; `ui/src/App.tsx:326-333` |
| `enableCases` | false | "Cases" menü satırı, `/cases` yolu, görev özelliklerindeki Cases paneli | `packages/shared/src/validators/instance.ts:58`; `ui/src/components/Sidebar.tsx:108`, `ui/src/components/Sidebar.tsx:206`; `ui/src/App.tsx:318-325` |
| `enablePipelines` | false | "Pipelines" menü satırı ile `/pipelines`, `/review-queue` ve `/learnings` yolları | `packages/shared/src/validators/instance.ts:57`; `ui/src/components/Sidebar.tsx:93`, `ui/src/components/Sidebar.tsx:209`; `ui/src/App.tsx:337-368` |
| `enableIsolatedWorkspaces` | false | Çalışma alanı sütunu, çalışma alanı filtresi ve gruplaması, özelliklerdeki çalışma alanı bölümü | `packages/shared/src/validators/instance.ts:45`; `ui/src/pages/Inbox.tsx:871`, `ui/src/pages/Inbox.tsx:2603`; `ui/src/components/IssuesList.tsx:778`, `ui/src/components/IssuesList.tsx:1883` |
| `enableExternalObjects` | false | "External object status" filtre bloğu | `packages/shared/src/validators/instance.ts:64`; `ui/src/pages/Inbox.tsx:872`; `ui/src/components/IssueFiltersPopover.tsx:514-545` |
| `enableExperimentalFileViewer` | false | Görevin yan panelindeki dosya sekmeleri ve dosya görüntüleyici | `packages/shared/src/validators/instance.ts:63`; `ui/src/pages/IssueDetail.tsx:3515-3521` |
| `enableIssuePlanDecompositions` | false | Kabul edilmiş plan ayrıştırması bloğu | `packages/shared/src/validators/instance.ts:62`; `ui/src/pages/IssueDetail.tsx:3515-3521` |
| `enableGoalsSidebarLink` | false | "Goals" menü satırı | `packages/shared/src/validators/instance.ts:71`; `ui/src/components/Sidebar.tsx:96`, `ui/src/components/Sidebar.tsx:212` |
| `SHOW_TASK_PRIORITY_UI` (derleme zamanı sabiti, ayar değil) | false | Öncelikle ilgili bütün kontrolleri, sütunları, grafikleri, sıralama ve gruplama seçeneklerini gizler. Veri modeli ve API önceliği tutmayı sürdürür | `ui/src/lib/ui-flags.ts:1-22` |

İnceleme talimatında `enableTaskChatRedesign` adı geçiyor. Bu bayrak artık kodda yok. Yerini, tersine çalışan ve eski arayüze dönmeyi sağlayan `enableClassicTaskInterface` aldı (`releases/v2026.824.0.md:11`; eski adı yalnızca `DESIGN.md:102` içinde, eskiden kalma bir satırda geçiyor). CSS yorumu da aynısını söyler: sohbet biçimi "default view; classic legacy view sits behind enableClassicTaskInterface" diye tanımlanır (`ui/src/index.css:898-900`).

Pratikte anlamı: aşağıda "streamlined" (sade) ve "chat shell" (sohbet kabuğu) diye anlatılan her şey, varsayılan bir kurulumun gösterdiği arayüzdür.

## 2. Arayüzün gördüğü görev modeli

Kaynak: `packages/shared/src/constants.ts` ve `packages/shared/src/types/issue.ts`.

### 2.1 Durum

Enum, tanımlandığı sırayla: `backlog, todo, in_progress, in_review, done, blocked, cancelled` (`packages/shared/src/constants.ts:189-197`).

Bütün durumları tek bileşen çizer: `StatusGlyph` bileşenini saran `StatusIcon` (`ui/src/components/StatusIcon.tsx:69-80`). Her durumun kendi şekli vardır, böylece renk tek işaret olmaz (`ui/src/components/StatusGlyph.tsx:15-34`). Boyutlar sabittir: sm 14px, md 16px, lg 20px (`ui/src/components/StatusGlyph.tsx:39`).

| Durum | Varsayılan etiket | lucide simgesi | Renk adı | Durum etiketinin (chip) temel rengi | Simge rengi açık / karanlık | Rozet sınıfları |
|---|---|---|---|---|---|---|
| backlog | Backlog | `CircleDashed` | gri | `#a8aeb2` | `#52585d` / `#9a958a` | `bg-muted text-muted-foreground` |
| todo | Todo | `Circle` | sarı | `#f59e0b` | `#cc7a00` / `#fbbf24` | `bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300` |
| in_progress | In Progress | özel çizilmiş açık daire, döner | mavi | `#2563eb` | blue-600 / blue-400 | `bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300` |
| in_review | In Review | `CircleDot` | mor | `#7c3aed` | `#7c3aed` / `#9474f0` | `bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300` |
| done | Done | `CircleCheck` | yeşil | `#22c55e` | `#16a34a` / `#34d06f` | `bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300` |
| blocked | Blocked | `CircleMinus` | kırmızı | `#dc2626` | iki temada da `#dc2626` | `bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300` |
| cancelled | Cancelled | `Ban` | gri | `#a8aeb2` | `#52585d` / `#9a958a` | `bg-muted text-muted-foreground` |

Kanıt: simge eşlemesi `ui/src/components/StatusGlyph.tsx:58-68`; dönen simgenin tanımı `ui/src/components/StatusGlyph.tsx:53-55` ve `motion-safe:animate-spin` sınıfı `ui/src/components/StatusGlyph.tsx:92`; renk adları `ui/src/lib/status-colors.ts:221-229`; durum etiketi renkleri `ui/src/index.css:214-220`; simge renkleri `ui/src/index.css:232-239` (açık tema) ve `ui/src/index.css:447-452` (karanlık tema); rozet sınıfları `ui/src/lib/status-colors.ts:114-120`; etiket metninin türetilmesi (alt çizgiler boşluğa çevrilir, sözcüklerin baş harfi büyütülür) `ui/src/components/StatusIcon.tsx:10-12`.

Bunu kopyalarken önemli olan ayrıntılar:

- Sürüyor durumundaki dönen simge çalışma etkinliğini değil, iş akışındaki durumu gösterir. Koddaki yoruma göre simge "remains between runs until the task status changes; live indicators and run details report whether an agent is currently executing" (görev durumu değişene kadar çalışmalar arasında da kalır; ajanın o an çalışıp çalışmadığını canlı göstergeler ve çalışma ayrıntıları bildirir) (`ui/src/components/StatusGlyph.tsx:25-27`). Çalışan ajanı ayrı bir mavi "Live" rozeti gösterir (bölüm 5.6).
- Türetilmiş iki gösterim durumu vardır. `externalConversationState === "waiting"` olan `in_review` görevi "idle" olarak (düz daire) çizilir (`ui/src/components/StatusIcon.tsx:83`). Engelleyenleri üzerinde çalışılan engellenmiş görev (`blockerAttention.state === "covered"`), engellenmiş şekliyle ama mavi çizilir ve `in_queue` diye adlandırılır (`ui/src/components/StatusIcon.tsx:84-86`; `ui/src/index.css:239`).
- Engellenmiş görevin erişilebilirlik etiketi tam bir cümledir, örneğin "Blocked · waiting on active sub-task PAP-12" ya da "Blocked · 2 blockers need attention" (`ui/src/components/StatusIcon.tsx:27-67`).
- `onChange` verilirse simge bir durum seçicisi olur: yedi durumun hepsini sıralayan `w-40 p-1` ölçülerinde bir açılır menü; her satır 20px simgeli, ghost türünde bir düğmedir (`ui/src/components/StatusIcon.tsx:133-154`). Seçicideki sıra: backlog, todo, in_progress, in_review, done, cancelled, blocked (`ui/src/components/StatusIcon.tsx:8`).
- Üç ayrı sıra kullanılıyor: yukarıdaki enum sırası; listede sıralama ve gruplama sırası `in_progress, todo, backlog, in_review, blocked, done, cancelled` (`ui/src/lib/issue-filters.ts:79`); pano sütunlarının sırası `backlog, todo, in_progress, in_review, blocked, done, cancelled` (`ui/src/components/KanbanBoard.tsx:41-49`).
- Durum etiketleri tek bir CSS kuralı kullanır: bileşeni kullanan taraf `--sc` değişkenine durum rengini verir; `.status-chip` de dolgu, yazı ve kenarlık rengini açık ve karanlık tema için `color-mix` ile türetir (`ui/src/index.css:2404-2421`).
- Grafikler aynı renkleri kullanır; amaç "badge, row, chart, and log agree" (rozet, satır, grafik ve kayıt birbirini tutsun) (`ui/src/components/ActivityCharts.tsx:221-237`).

"Inbox mine" bunların bir alt kümesini kullanır: `backlog, todo, in_progress, in_review, blocked, done` (cancelled dışarıda bırakılmış) (`packages/shared/src/constants.ts:200-208`).

### 2.2 Öncelik

Enum `critical, high, medium, low` (`packages/shared/src/constants.ts:210`); renkleri kırmızı, turuncu, sarı, mavi (`ui/src/lib/status-colors.ts:306-311`). `SHOW_TASK_PRIORITY_UI = false` yüzünden her yerde gizlidir (`ui/src/lib/ui-flags.ts:22`): sıralama seçeneği (`ui/src/components/IssuesList.tsx:1897-1906`), gruplama seçeneği (`ui/src/components/IssuesList.tsx:1944-1954`), filtre bloğu (`ui/src/components/IssueFiltersPopover.tsx:340-357`), pano kartındaki simge (`ui/src/components/KanbanBoard.tsx:366-367`), Genel bakış grafiği (`ui/src/pages/Dashboard.tsx:460-465`), yeni görev penceresindeki etiket (`ui/src/components/NewIssueDialog.tsx:2150-2188`). Yeni görevler yine de `priority: priority || "medium"` gönderir (`ui/src/components/NewIssueDialog.tsx:1081`).

### 2.3 Kimlik

Her şirketin bir `issuePrefix` (varsayılan `PAP`, tekil) ve bir `issueCounter` alanı vardır (`packages/db/src/schema/companies.ts:13-14`, `packages/db/src/schema/companies.ts:35`). Görevde `issueNumber` ve `identifier` bulunur (`packages/shared/src/types/issue.ts:812-813`). Sunucu kimliği `${company.issuePrefix}-${issueNumber}` biçiminde kurar (`server/src/services/issues.ts:10124`). Arayüz `issue.identifier ?? issue.id.slice(0, 8)` değerini eş aralıklı yazıyla gösterir ve URL'lerde `identifier ?? id` kullanır (`ui/src/components/IssueRow.tsx:154-155`). Sorgu `^[A-Z]+-\d+$` kalıbına uyarsa arama doğrudan göreve yönlendirir (`ui/src/pages/Search.tsx:400-416`).

### 2.4 Atanan, oluşturan, adına çalışılan kişi

- Tek atanan vardır, ajan ya da kullanıcı: `assigneeAgentId`, `assigneeUserId` (`packages/shared/src/types/issue.ts:803-804`).
- Oluşturan: `createdByAgentId`, `createdByUserId`; buna ek olarak `responsibleUserId` (`packages/shared/src/types/issue.ts:809-811`). Listelerde `deriveOriginatingActor` ile hesaplanan bir "Kicked off by" (işi başlatan) sütunu görünür (`ui/src/components/IssueColumns.tsx:313-315`, `ui/src/components/IssueColumns.tsx:360-403`).
- Listede kullanılan sözcük "Responsible" (`ui/src/components/IssueColumns.tsx:31`); pencere ve özellik paneli "Assignee" der (`ui/src/components/NewIssueDialog.tsx:1512`; `ui/src/components/issue-properties/IssueProperties.tsx:2359`).
- Filtre değerleri: `__unassigned`, `__me` ya da bir ajan kimliği (`ui/src/lib/issue-filters.ts:226-235`).
- Atananın modeli görev başına değiştirilebilir: `assigneeAdapterOverrides` (`packages/shared/src/types/issue.ts:822`).

### 2.5 Etiketler

`IssueLabel { id, companyId, name, color }` (`packages/shared/src/types/issue.ts:82-89`); görevler `labelIds` ve `labels` alanlarını taşır (`packages/shared/src/types/issue.ts:838-839`). Uç noktalar: `GET/POST /companies/:id/labels`, `DELETE /labels/:id` (`ui/src/api/issues.ts:223-227`). Listedeki "Tags" sütunu en çok iki etiket ve "+N" gösterir; her etiket kendi renginden türetilen bir tonla boyanır (`ui/src/components/IssueColumns.tsx:36`, `ui/src/components/IssueColumns.tsx:431-455`).

### 2.6 Hiyerarşi ve engelleme

- Üst görev ve alt görevler: `parentId`, `ancestors`, `requestDepth` (`packages/shared/src/types/issue.ts:794-795`, `packages/shared/src/types/issue.ts:820`). Ağaçlar düz listelerden istemcide kurulur (`buildIssueTree`, kullanıldığı yer `ui/src/components/IssuesList.tsx:2061-2063`). Bir alt ağacın tamamı `descendantOf` filtresiyle yüklenir (`ui/src/api/issues.ts:99`; `ui/src/pages/IssueDetail.tsx:3356-3376`).
- Tek bir ilişki türü vardır: `blocks` (`packages/shared/src/constants.ts:426`). Görevler `blockedBy` ve `blocks` alanlarını `IssueRelationIssueSummary { id, identifier, title, status, priority, assigneeAgentId, assigneeUserId, terminalBlockers? }` dizileri olarak taşır (`packages/shared/src/types/issue.ts:212-223`, `packages/shared/src/types/issue.ts:840-841`).
- Sunucu ayrıca bir özet gönderir: `blockerAttention { state, reason, unresolvedBlockerCount, coveredBlockerCount, stalledBlockerCount, attentionBlockerCount, terminalBlocker, ... }` (`packages/shared/src/types/issue.ts:409-427`); Gelen kutusunun Engellenenler (Blocked) sekmesi için de `blockedInboxAttention { state, reason, severity, stoppedSinceAt, owner, action, leafIssue, recoveryIssue, approvalId, interactionId }` gelir (`packages/shared/src/types/issue.ts:513-531`).
- Atanmış bir engelleyen beklemede (backlog) duruyorsa satırda sarı bir "Blocked by parked work" (bekletilen iş yüzünden engellendi) rozeti görünür (`ui/src/components/IssueRow.tsx:206-215`).

### 2.7 Proje, hedef, çalışma alanı

`projectId`, `goalId`, `projectWorkspaceId`, `executionWorkspaceId` (`packages/shared/src/types/issue.ts:791-793`, `packages/shared/src/types/issue.ts:830`). Çalışma alanı arayüzü yalnızca `enableIsolatedWorkspaces` açıkken görünür (bölüm 1).

### 2.8 Köken

`originKind`, `originId`, `originRunId` (`packages/shared/src/types/issue.ts:814-816`). Hazır türler: `manual, routine_execution, stale_active_run_evaluation, harness_liveness_escalation, issue_productivity_review, stranded_issue_recovery, task_watchdog, task_watchdog_product_bug, onboarding_first_task, chat_channel`; bunlara `plugin:<name>` eklenir (`packages/shared/src/constants.ts:356-370`). Arayüzde: listeler rutin çalışmalarını "Hide routine runs" seçeneğiyle gizleyebilir (`ui/src/components/IssueFiltersPopover.tsx:556-564`; `ui/src/lib/issue-filters.ts:221-223`); görev sayfasının üst bölümünde `/routines/:originId` adresine giden mor bir "Routine" etiketi görünür (`ui/src/pages/IssueDetail.tsx:7103-7112`).

### 2.9 Çalışma modu

`standard, ask, planning, skill_test` (`packages/shared/src/constants.ts:214`). Arayüzdeki etiketler: "Auto mode" (Hammer simgesi), "Plan mode" (ClipboardList, sarı), "Ask mode" (MessageCircleQuestion, gök mavisi) (`ui/src/lib/work-mode-meta.ts:44-68`). Modlar arasında geçiş sırası: standard, planning, ask (`ui/src/lib/work-mode-meta.ts:75-79`).

### 2.10 Gizli, arşivlenmiş, okunmuş

| Kavram | Alan | Kullanıcı nasıl ayarlar | Uç nokta |
|---|---|---|---|
| Gizli görev | `hiddenAt` (`packages/shared/src/types/issue.ts:836`) | More menüsündeki "Hide this task" ile; ardından "This task is hidden" şeridi görünür (`ui/src/pages/IssueDetail.tsx:7421`, `ui/src/pages/IssueDetail.tsx:7576`) | `PATCH /issues/:id` (`ui/src/api/issues.ts:264-271`) |
| Gelen kutumdan arşivlenmiş (kullanıcıya özel) | `archivedAt`, `archivedByActorType`, `archivedByAgentId`, `archivedByRunId` (`packages/shared/src/types/issue.ts:870-873`) | Arşivle düğmesi, kaydırma, `a` ya da `y` tuşu | `POST` / `DELETE /issues/:id/inbox-archive` (`ui/src/api/issues.ts:251-259`) |
| Okundu bilgisi (kullanıcıya özel) | `isUnreadForMe`, `myLastTouchAt`, `lastExternalCommentAt`, `lastActivityAt` (`packages/shared/src/types/issue.ts:866-869`) | Görev açılınca okundu sayılır; nokta düğmesi; `r` ve `U` tuşları | `POST` / `DELETE /issues/:id/read` (`ui/src/api/issues.ts:247-250`) |

Kullanıcı izin verirse ajanlar da o kullanıcının Gelen kutusundan arşivleyebilir: kural modları `open`, `allowlist`, `disabled`; uç nokta `GET/PUT /companies/:id/users/me/inbox-agent-policy` (`packages/shared/src/types/inbox-agent-policy.ts:1-13`; `ui/src/api/inbox-agent-policy.ts:4-14`).

### 2.11 Yürütme kuralı (inceleme ve onay aşamaları)

Bir görev `executionPolicy { mode: "normal" | "auto", commentRequired, stages[], monitor?, maxReviewRounds? }` taşıyabilir; her aşama `{ id, type: "review" | "approval", approvalsNeeded: 1, participants[] }` biçimindedir, katılımcı da bir ajan ya da kullanıcıdır (`packages/shared/src/types/issue.ts:644-686`; `packages/shared/src/constants.ts:518`, `packages/shared/src/constants.ts:521`). İlerleme `executionState { status: idle | pending | changes_requested | completed, currentStageId, currentStageType, currentParticipant, returnAssignee, reviewRequest, lastDecisionOutcome, changesRequestedCount }` içinde tutulur (`packages/shared/src/types/issue.ts:709-723`; `packages/shared/src/constants.ts:540`). Bir kararın sonucu `approved` ya da `changes_requested` olur (`packages/shared/src/types/issue.ts:725-738`; `packages/shared/src/constants.ts:559`). Kimin inceleyebileceğini `reviewPolicy` söyler: `anyone, not_creator, human_only` (`packages/shared/src/constants.ts:212`).

### 2.12 Akış etkileşimleri (sorular ve onay istekleri)

Türler: `suggest_tasks, ask_user_questions, request_confirmation, request_checkbox_confirmation, request_item_verdicts, connection_intent` (`packages/shared/src/constants.ts:259-266`). Durumlar: `pending, accepted, rejected, answered, cancelled, expired, failed` (`packages/shared/src/constants.ts:331-339`). Ortak alanlar: `id, issueId, kind, title, summary, status, sourceRunId, sourceCommentId, addresseeAgentId, addresseeUserId, continuationPolicy (none | wake_assignee | wake_assignee_on_accept), acceptanceBlocker?, resolver policy fields, createdAt, resolvedAt` (`packages/shared/src/types/issue.ts:1503-1534`; `packages/shared/src/constants.ts:342-346`). İçerikler bölüm 7.9'da sayılmıştır.

### 2.13 Çalışmalar

Durumlar: `queued, scheduled_retry, running, succeeded, interrupted, failed, cancelled, timed_out` (`packages/shared/src/constants.ts:919-928`). Uyandırma kaynakları: `timer, assignment, on_demand, automation` (`packages/shared/src/constants.ts:896-901`). Çalışma bittikten sonra yapılan ilerleme değerlendirmesi (liveness): `completed, advanced, plan_only, empty_response, blocked, failed, needs_followup` (`packages/shared/src/constants.ts:931-939`). Çalışma kaydında şunlar bulunur: durum, ajan, zaman damgaları, `error`, `errorCode`, `exitCode`, `usageJson`, `resultJson`, kayıt dosyasının referansı ve boyutu, stdout ve stderr alıntıları, yeniden deneme bağlantısı, liveness alanları, `contextSnapshot`; süren çalışmalarda ayrıca `currentStatusMessage`, `currentToolName`, `lastAssistantSnippet` (`packages/shared/src/types/heartbeat.ts:156-240`).

### 2.14 Onaylar (görevlerden ayrı)

`Approval { id, companyId, type, requestedByAgentId, requestedByUserId, status, payload, decisionNote, decidedByUserId, decidedAt }` (`packages/shared/src/types/approval.ts:3-16`). Türler: `hire_agent, approve_ceo_strategy, budget_override_required, request_board_approval` (`packages/shared/src/constants.ts:689-694`). Durumlar: `pending, revision_requested, approved, rejected, cancelled` (`packages/shared/src/constants.ts:697-703`). Onaylar görevlere `GET/POST /issues/:id/approvals` ve `GET /approvals/:id/issues` üzerinden bağlanır (`ui/src/api/issues.ts:594-598`; `ui/src/api/approvals.ts:23`).

## 3. Genel bakış (Dashboard)

Yol `/dashboard` (`ui/src/App.tsx:152`), dosya `ui/src/pages/Dashboard.tsx`.

### 3.1 Veri

| Sorgu | Uç nokta | Yenileme | Kanıt |
|---|---|---|---|
| Özet | `GET /companies/:id/dashboard`, `DashboardSummary` döndürür | sekmeler arasında paylaşılır, canlı olaylarla geçersiz kılınır | `ui/src/pages/Dashboard.tsx:161-173`; `ui/src/api/dashboard.ts:5` |
| Son etkinlikler | `GET /companies/:id/activity?limit=10` | aynı | `ui/src/pages/Dashboard.tsx:42`, `ui/src/pages/Dashboard.tsx:175-187` |
| Görevler | `GET /companies/:id/issues` (tam liste; "Recent Tasks" ve durum grafiği için kullanılır) | geçersiz kılınınca | `ui/src/pages/Dashboard.tsx:189-193` |
| Ajanlar, projeler, kullanıcı dizini | liste uç noktaları | geçersiz kılınınca | `ui/src/pages/Dashboard.tsx:86-90`, `ui/src/pages/Dashboard.tsx:195-205` |
| Süren ve son çalışmalar | `GET /companies/:id/live-runs?minCount=4&distinctTasks=true` | yalnızca lider sekmede | `ui/src/components/ActiveAgentsPanel.tsx:17-18`, `ui/src/components/ActiveAgentsPanel.tsx:65-82` |

`DashboardSummary` küçüktür: `agents { active, running, paused, error }`, `tasks { open, inProgress, blocked, done }`, `costs { monthSpendCents, monthBudgetCents, monthUtilizationPercent }`, `pendingApprovals`, `budgets { activeIncidents, pendingApprovals, pausedAgents, pausedProjects }`, `runActivity[]` (14 gün için `{ date, succeeded, failed, recovered, other, total, failedByErrorCode }`) (`packages/shared/src/types/dashboard.ts:1-54`).

### 3.2 Yerleşim, yukarıdan aşağıya

Kök öğe `space-y-6` sınıfını taşır (`ui/src/pages/Dashboard.tsx:324`).

1. Uyarı şeritleri, yalnızca gerektiğinde: içe aktarılan ajanlar duraklatılmış, "Resume all" düğmesiyle (`ui/src/pages/Dashboard.tsx:327-344`); bütün ajanlar duraklatılmış (`ui/src/pages/Dashboard.tsx:345-358`); "You have no agents." metni, "Create one here" bağlantısıyla (`ui/src/pages/Dashboard.tsx:360-375`).
2. "Agents" paneli (`ActiveAgentsPanel`, `ui/src/pages/Dashboard.tsx:377`). `grid grid-cols-1 items-start gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4` içinde en çok dört kart (`ui/src/components/ActiveAgentsPanel.tsx:142`). Liste tekilleştirilir: bir görev bir kez görünür, süren çalışma öne alınır (`ui/src/components/ActiveAgentsPanel.tsx:85-97`). Alttaki bağlantı `/dashboard/live` adresine gider; metni "N more active/recent runs" ya da "View all runs" olur (`ui/src/components/ActiveAgentsPanel.tsx:158-166`).
3. Kırmızı bütçe olayı şeridi, "Open budgets" bağlantısıyla (`ui/src/pages/Dashboard.tsx:381-398`).
4. `grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2` içinde dört ölçüm kartı (`ui/src/pages/Dashboard.tsx:400-452`):

| Etiket | Değer | Alt satır | Bağlantı |
|---|---|---|---|
| Agents Enabled | active + running + paused + error toplamı | "N running, N paused, N errors" | `/agents` |
| Tasks In Progress | `tasks.inProgress` | "N open, N blocked" | `/issues` |
| Month Spend | biçimlendirilmiş sent tutarı | "N% of $X budget" ya da "Unlimited budget" | `/costs` |
| Pending Approvals | onaylar + bütçe onayları | "Awaiting board review" | `/approvals` |

   Ölçüm kartının kenarlığı ve gölgesi yoktur: `h-full px-4 py-4 sm:px-5 sm:py-5 rounded-lg transition-colors hover:bg-accent/50 cursor-pointer`; değer `text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums`, etiket `text-xs sm:text-sm font-medium text-muted-foreground mt-1`, sağ üstteki simge `h-4 w-4 text-muted-foreground/50` (`ui/src/components/MetricCard.tsx:17-33`).
5. Grafikler, geniş ekranda üçü yan yana (`ui/src/pages/Dashboard.tsx:456-472`): "Run Activity", "Tasks by Status", "Success Rate"; her birinin alt başlığı "Last 14 days". Grafik kütüphanesi kullanılmamış, grafikler flex div'lerden elle kurulmuş: `flex items-end gap-(--sz-3px) h-20` içinde 14 sütun, `flex` ağırlıklarıyla üst üste dizilen dilimler, 1., 7. ve 14. günde tarih etiketi, noktalı bir lejant (`ui/src/components/ActivityCharts.tsx:45-70`, `ui/src/components/ActivityCharts.tsx:139-165`). Çalışma dilimleri: succeeded (yeşil), recovered (sarı, yalnızca varsa), failed (kırmızı), other (gri) (`ui/src/components/ActivityCharts.tsx:22-27`, `ui/src/components/ActivityCharts.tsx:132-137`); ipucu başarısızlıkları hata koduna göre sayar (`ui/src/components/ActivityCharts.tsx:30-41`). Başarı oranı çubukları %80 ve üstünde yeşil, %50 ve üstünde sarı, altında kırmızıdır (`ui/src/components/ActivityCharts.tsx:313`). Grafik kartı: `border border-border rounded-lg p-4 space-y-3` (`ui/src/components/ActivityCharts.tsx:72-82`).
6. Widget'lar için eklenti yuvası (`ui/src/pages/Dashboard.tsx:474-480`).
7. İki sütun, `grid md:grid-cols-2 gap-4` (`ui/src/pages/Dashboard.tsx:482`): "Recent Activity" (10 satır, `ActivityRow`) ve "Recent Tasks" (en son güncellenen 10 görev: durum simgesi, başlık, atanan, kimlik, göreli zaman) (`ui/src/pages/Dashboard.tsx:484-554`). İki liste de `.dashboard-list-row` sınıfını (en az yükseklik 12 boşluk birimi, iç boşluk 3'e 4 birim) (`ui/src/index.css:1247-1251`) ve sütun şablonu bir CSS değişkeni olan bir container-query ızgarasını paylaşır (`ui/src/index.css:209-213`; `ui/src/pages/Dashboard.tsx:522`; `ui/src/components/ActivityRow.tsx:58`).

### 3.3 Süren çalışmaların gösterimi

Ajan çalışma kartı (`AgentRunCard`) şunları gösterir: çalışmaya bağlantı veren ajan simgesi ve adı; durum simgesi, başlık ve kimlik içeren kutulu bir görev bağlantısı (ya da "Scheduled heartbeat" / "No linked task"); bir de "Started 2m ago" / "Finished ..." / "Queued ..." bilgisi (`ui/src/components/ActiveAgentsPanel.tsx:171-248`). Süren çalışmanın kartı maviye boyanır: `border-(--dashboard-run-border) bg-(--dashboard-run-background)`; vurgu rengi dolgu için %4, kenarlık için %25 oranında karıştırılır (`ui/src/components/ActiveAgentsPanel.tsx:202-204`; `ui/src/index.css:206-208`).

Genel bakış kartları döküm göstermez. `showTranscripts` varsayılan olarak false gelir; `Dashboard` da `DashboardLive` da bu değeri vermez (`ui/src/components/ActiveAgentsPanel.tsx:61`, `ui/src/components/ActiveAgentsPanel.tsx:123-130`; `ui/src/pages/Dashboard.tsx:377`; `ui/src/pages/DashboardLive.tsx:50-59`). Döküm, karta tıklanıp çalışma sayfasına gidilince görülür.

`/dashboard/live` ("Live agent runs") aynı paneldir; sınırı 50'dir ve başlığı "Active / recent" olur (`ui/src/pages/DashboardLive.tsx:9`, `ui/src/pages/DashboardLive.tsx:42-59`).

Kenar çubuğundaki "Dashboard" satırı, aynı live-runs sorgusundan gelen yanıp sönen mavi bir nokta ve "N live" yazısı gösterir (`ui/src/components/Sidebar.tsx:88`, `ui/src/components/Sidebar.tsx:168`; `ui/src/components/SidebarNavItem.tsx:184-197`).

### 3.4 Ekran durumları ve hareket

- Şirket yoksa: "Welcome to Paperclip. Set up your first organization and agent to get started." metni ve "Get Started" düğmesiyle `EmptyState` (`ui/src/pages/Dashboard.tsx:295-309`). `EmptyState` ortalanmış bir sütundur (`py-16`); soluk bir kare içinde simge, bir mesaj ve isteğe bağlı bir düğme içerir (`ui/src/components/EmptyState.tsx:27-50`).
- Yüklenirken: `PageSkeleton variant="dashboard"`, gerçek yerleşimin biçimindeki bloklar (`ui/src/components/PageSkeleton.tsx:16-39`).
- Hiç ajanı olmayan şirkette ilk kurulum bir kez kendiliğinden açılır (`ui/src/pages/Dashboard.tsx:135-155`).
- Yeni etkinlik satırları animasyonla girer. İlk yüklemede görülen kimlikler akılda tutulur; sonradan gelen satırlara 980 ms boyunca `activity-row-enter` sınıfı verilir (`ui/src/pages/Dashboard.tsx:225-260`, `ui/src/pages/Dashboard.tsx:498`). Animasyon satırı kısa bir bulanıklıkla 14px aşağı kaydırır ve soldaki vurgu çizgisini bir an parlatır; hareketi azaltma tercihi açıkken devre dışıdır (`ui/src/index.css:1254-1292`).
- Bayraklar: "Tasks by Priority" grafiğini `SHOW_TASK_PRIORITY_UI` gizler (`ui/src/pages/Dashboard.tsx:460-465`). Durum kartları (`/status`), `enableStatusCards` bayrağına bağlı ayrı bir sayfadır.

## 4. Gelen kutusu ve ilgi bekleyen işlerin ekranları

### 4.1 Yollar ve sekmeler

`/inbox`, en son kullanılan sekmeye yönlendirir; bu sekme localStorage'da `paperclip:inbox:last-tab` anahtarında saklanır (`ui/src/App.tsx:426`, `ui/src/App.tsx:456-458`; `ui/src/lib/inbox.ts:24`, `ui/src/lib/inbox.ts:678-701`). Sekmeler ayrı yollardır: `/inbox/mine`, `/inbox/recent`, `/inbox/unread`, `/inbox/blocked`, `/inbox/all` (`ui/src/App.tsx:427-431`); etiketleri "Mine", "Recent", "Unread", "Blocked", "All" (`ui/src/pages/Inbox.tsx:2402-2412`). Telefonda sekme çubuğu tarayıcının kendi `<select>` öğesine dönüşür (`ui/src/components/PageTabBar.tsx:21-39`).

`Inbox()`, `enableStreamlinedUi` değerine göre `StreamlinedInbox` ya da `LegacyInbox` bileşenini seçer (`ui/src/pages/Inbox.tsx:792-795`). Bu bölümün kalanı sade olanı anlatır.

### 4.2 Sekmelerin içeriği

Dört kayıt türü tek listede birleştirilir: `issue`, `approval`, `failed_run`, `join_request`; her birinin sıralamada kullanılan bir zaman damgası vardır (`ui/src/lib/inbox.ts:59-79`, `ui/src/lib/inbox.ts:817-862`).

| Sekme | Görevler | Onaylar | Başarısız çalışmalar | Katılma istekleri | Arşivlenebilir mi |
|---|---|---|---|---|---|
| Benim (Mine) | İşlem yaptığım ve arşivlemediğim görevler | bekleyenler ya da düzeltme istenenler, ayrıca benim istediklerim ya da karar verdiklerim; listeden kaldırılanlar hariç | her ajanın son başarısız çalışması, yalnızca benim görebildiklerim | bekleyenler; listeden kaldırılanlar hariç | evet |
| Son (Recent) | İşlem yaptığım görevler (sorguda arşiv filtresi yok) | tümü | her ajanın son başarısız çalışması | bekleyenler | hayır |
| Okunmamış (Unread) | `isUnreadForMe` işaretli, işlem yaptığım görevler | yalnızca işlem bekleyenler | her ajanın son başarısız çalışması | bekleyenler | hayır |
| Tümü (All) | İşlem yaptığım görevler, kategori filtresiyle daraltılır | tümü, onay filtresiyle daraltılır | evet | evet | hayır |
| Engellenenler (Blocked) | ayrı görünüm, bölüm 4.11 | | | | hayır |

Kanıt: sekmeden görev listesine eşleme `ui/src/pages/Inbox.tsx:1199-1206`; sekmeye göre onaylar `ui/src/lib/inbox.ts:777-809`; başarısız çalışmalar `ui/src/lib/inbox.ts:732-745` ve `ui/src/pages/Inbox.tsx:1302-1331` (listeden kaldırılan başarısız çalışmalar her sekmeden çıkarılır, `ui/src/pages/Inbox.tsx:1302-1308`); katılma istekleri `ui/src/pages/Inbox.tsx:1333-1341`; `canArchiveFromTab = isMineInboxTab(tab)` `ui/src/pages/Inbox.tsx:839` (yardımcı işlev `ui/src/lib/inbox.ts:703-705`); uyarılar yalnızca Tümü sekmesinde (`ui/src/lib/inbox.ts:707-709`).

"Touched" (işlem yapılmış) sunucu tarafında tanımlı bir kavramdır: istemci `touchedByUserId=me` ister. İki görev listesi de istemcide, en son etkinlik gören 100 görevle sınırlanır (`ui/src/lib/inbox.ts:19`, `ui/src/lib/inbox.ts:769-771`; `ui/src/pages/Inbox.tsx:1071-1078`). Her ajanın yalnızca son çalışmasına bakılır ve bu çalışma ancak başarısız olduysa ya da zaman aşımına uğradıysa gösterilir; yani sonraki başarılı bir çalışma satırı kaldırır (`ui/src/lib/inbox.ts:20`, `ui/src/lib/inbox.ts:732-745`).

### 4.3 Veri ve uç noktalar

| Veri | İstek | Not | Kanıt |
|---|---|---|---|
| Benim sekmesinin görevleri | `GET /companies/:id/issues?view=compact&touchedByUserId=me&inboxArchivedByUserId=me&status=backlog,todo,in_progress,in_review,blocked,done&includeRoutineExecutions=true&includeLiveDescendantSummary=true&limit=500` | staleTime 30 saniye, odaklanınca yeniden çekilmez | `ui/src/pages/Inbox.tsx:193-194`, `ui/src/pages/Inbox.tsx:966-984` |
| İşlem yapılmış görevler | aynısı, `inboxArchivedByUserId` olmadan | | `ui/src/pages/Inbox.tsx:993-1010` |
| Bütün görevlerin kırpılmış hâli (üst görevleri bulmak için) | `GET ...issues?view=compact&includeRoutineExecutions=true&includeLiveDescendantSummary=true&limit=500` | | `ui/src/pages/Inbox.tsx:946-964` |
| Onaylar | `GET /companies/:id/approvals` | | `ui/src/pages/Inbox.tsx:903-911`; `ui/src/api/approvals.ts:5-8` |
| Katılma istekleri | `GET /companies/:id/join-requests?status=pending_approval`; 401/403 yanıtı boş liste sayılır | | `ui/src/pages/Inbox.tsx:913-930`; `ui/src/api/access.ts:309-315` |
| Çalışmalar (başarısızları bulmak için) | `GET /companies/:id/heartbeat-runs?limit=200&summary=true` | | `ui/src/pages/Inbox.tsx:192`, `ui/src/pages/Inbox.tsx:1020-1026` |
| Süren çalışmalar | `GET /companies/:id/live-runs` | olaylarla güncellenir, aralıklı yoklama yok | `ui/src/pages/Inbox.tsx:1027-1043` |
| Genel bakış özeti (uyarılar için) | `GET /companies/:id/dashboard` | | `ui/src/pages/Inbox.tsx:932-944` |
| Listeden kaldırma kayıtları | `GET /companies/:id/inbox-dismissals` | | `ui/src/hooks/useInboxBadge.ts:57-67` |
| Aramaya ek sonuçlar | `GET ...issues?view=compact&q=<text>&limit=25` | yalnızca arama yapılırken | `ui/src/pages/Inbox.tsx:1082-1098` |
| Ajanlar, projeler, etiketler, kullanıcı dizini, oturum | liste uç noktaları | | `ui/src/pages/Inbox.tsx:850-870`, `ui/src/pages/Inbox.tsx:1044-1048` |

`CompactIssue` kırpılmış bir görevdir: temel alanlar ile etiketler, `blockedBy`, attention özetleri, `liveDescendantCount`, okundu ve arşiv alanları, `activeRecoveryAction`, `successfulRunHandoff` (`packages/shared/src/types/issue.ts:878-933`).

### 4.4 Araç çubuğu

`CollectionToolbar` yalnızca görünümden sorumlu bir çerçeve bileşenidir; yuvaları `context`, `search`, `controls`, `actions`, `feedback`; yerleşimi `flex flex-col gap-2`, içinde de `flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center` (`ui/src/components/CollectionToolbar.tsx:19-74`). Gelen kutusunda:

- context: sekme çubuğu;
- search: `h-8` yüksekliğinde bir giriş alanı; yer tutucu metni "Search inbox…", geniş ekranda genişliği 220px; `data-page-search-target` ile işaretlidir, böylece her yerde çalışan `/` tuşu ona odaklanır (`ui/src/pages/Inbox.tsx:2414-2443`; `ui/src/hooks/useKeyboardShortcuts.ts:99-106`). Enter odağı bırakır; Escape, alan boşsa odağı bırakır (`ui/src/lib/keyboardShortcuts.ts:63-83`);
- controls, hepsi `h-8 w-8` ölçüsünde çerçeveli simge düğmesi: iç içe gösterme düğmesi (yalnızca geniş ekranda), filtreler, gruplama, sütunlar ve okunmamış görev varsa "Mark all as read" (`ui/src/pages/Inbox.tsx:2542-2675`). Açık olan aç/kapa düğmesi `bg-accent` alır.

Gruplama seçenekleri: None, Type, Responsible, Project; bayrak açıksa Workspace de eklenir (`ui/src/pages/Inbox.tsx:2596-2619`). Seçilen gruplama `paperclip:inbox:group-by` anahtarında saklanır (`ui/src/lib/inbox.ts:27`, `ui/src/lib/inbox.ts:397-412`).

Sütun seçici: "Desktop task rows" başlıklı, 300px'lik bir açılır menü; her seçeneğin tek satırlık bir açıklaması vardır; bir "Date group separators" aç/kapa düğmesi; "Reset defaults" (status, id, updated) (`ui/src/components/IssueColumns.tsx:108-179`). Seçilebilen sütunlar: status, id, assignee, kickedOffBy, project, workspace, parent, labels, updated; varsayılanlar status, id, updated (`ui/src/lib/inbox.ts:41-53`).

Filtreler: ortak `IssueFiltersPopover` (bölüm 5.3). Tümü sekmesinde fazladan bir blok gelir: Category (All categories, My recent tasks, Join requests, Approvals, Failed runs, Alerts) ve Approval status (All approval statuses, Needs action, Resolved) (`ui/src/components/IssueFiltersPopover.tsx:67-80`, `ui/src/components/IssueFiltersPopover.tsx:235-295`; `ui/src/pages/Inbox.tsx:2569-2582`).

İki filtre için araç çubuğunun altında bir bilgi satırı çıkar; örneğin "Active statuses" filtresinde, bunların bir ajan çalışsın ya da çalışmasın açık görevler olduğunu söyleyen bir not görünür (`ui/src/pages/Inbox.tsx:2391-2395`, `ui/src/pages/Inbox.tsx:2678-2682`).

### 4.5 Satır tasarımı

Görev satırları `IssueRow` bileşenini `presentation="task"` ile kullanır (`ui/src/pages/Inbox.tsx:2790-2793`).

```
[unread dot] [tree guides] [chevron|spacer] [status icon] [title ........] [recovery chip]   [Live badge] [extra columns] [Archive] [PAP-123] [2h ago]
```

Kök öğenin sınıfları (`ui/src/components/IssueRow.tsx:224-231`):

```
group relative flex min-w-0 items-start gap-2 rounded-lg py-2.5 pr-2 text-sm no-underline text-inherit sm:items-center sm:py-2
pl-4                      (rows that take part in unread)
[&_button]:relative [&_button]:z-10
hover:bg-accent/50        (selected: bg-accent/50)
```

- Satırın tamamı, mutlak konumlu bir bağlantı (`absolute inset-0 rounded-lg`) sayesinde tıklanabilir; bağlantının ekran okuyucu etiketi "Open PAP-12: title" biçimindedir; içteki düğmeler `z-10` ile onun üstünde durur (`ui/src/components/IssueRow.tsx:233-245`, `ui/src/components/IssueRow.tsx:227`). Böylece her satırda tek bir Tab durağı olur ve satırın içindeki kontroller de çalışır.
- Başlık: `min-w-0 line-clamp-2 text-sm sm:truncate sm:line-clamp-none`; okunmamışsa `font-semibold` (`ui/src/components/IssueRow.tsx:299-308`).
- Kimlik sütunu `w-20 shrink-0 text-right font-mono text-xs text-muted-foreground`; zaman sütunu `w-24 shrink-0 truncate text-right text-xs text-muted-foreground` (`ui/src/components/IssueRow.tsx:335-344`). Sabit genişlikler, tablo kullanılmadan sütunları hizalı tutar.
- Okunmamış noktası: en solda, 16px'lik tıklama alanının içinde 8px'lik bir `bg-blue-600 dark:bg-blue-400` nokta; tıklanınca görev okundu sayılır; nokta `transition-opacity duration-300` ile solarak kaybolur (`ui/src/components/IssueRow.tsx:161-191`, `ui/src/components/IssueRow.tsx:247-254`).
- Arşivle düğmesi: simgeli, ghost türünde "Archive" metin düğmesi; `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` (`ui/src/components/IssueRow.tsx:83-118`, `ui/src/components/IssueRow.tsx:334`).
- Üzerine gelince renk geçişi bilerek yoktur: "hover/selection must snap instantly" (vurgu ve seçim anında değişmeli); yumuşak geçiş, fare hızlı hareket ettiğinde arkada iz bırakır (`ui/src/components/IssueRow.tsx:354-356`).
- Ağaç kılavuz çizgileri: her üst düzey için bir `w-4` yuva ve satırlar boyunca süren 1px'lik dikey çizgi; çizgi, alt görevin kendi açma okunun çevresinde kesilir (`ui/src/components/IssueRow.tsx:256-284`).
- "Live" rozeti: `bg-blue-500/10` zeminli ghost rozet; içinde yanıp sönen 8px'lik mavi bir nokta ve "Live" sözcüğü bulunur (yazı telefonda gizlenir). Kendisi çalışmayan ama alt görevlerinde süren çalışma olan üst görev, çerçeveli bir "N live below" rozeti gösterir (`ui/src/components/IssueColumns.tsx:218-263`).
- Kapalı duran üst görevler başlıktan sonra "(N sub-tasks)" gösterir (`ui/src/pages/Inbox.tsx:2865-2869`).
- Görevin açık bir kurtarma eylemi varsa başlıktan sonra bir kurtarma etiketi gelir (çerçeveli rozet, 10px yazı, simge ve etiket metni) (`ui/src/components/IssueRow.tsx:200-205`, `ui/src/components/IssueRow.tsx:506-539`; `ui/src/index.css:2508`).
- Telefonda: zaman bilgisi başlığın yanına geçer (`mobileTitleMeta`), sondaki sütunlar gizlenir (`ui/src/components/IssueRow.tsx:310-314`, `ui/src/components/IssueRow.tsx:324-327`).

Görev olmayan satırlar tek bir biçimi paylaşır: `group py-2.5 pl-4 pr-2 sm:py-2`, renkli zeminli bir simge kutusu, `text-sm font-medium` başlık ve `text-xs text-muted-foreground` bilgi satırı; eylemler geniş ekranda sağda, telefonda satırın altında durur.

| Tür | Simge kutusu | Başlık | Bilgi satırı | Eylemler | Kanıt |
|---|---|---|---|---|---|
| Onay | `bg-muted` üzerinde tür simgesi | "Hire Agent: Designer" biçiminde etiket | durum, "requested by X", "updated 3h ago" | "Approve" (`bg-green-700 text-white`), "Reject" (destructive türünde); bütçe aşımı onaylarında gizlidir | `ui/src/pages/Inbox.tsx:500-637`; etiket `ui/src/components/ApprovalPayload.tsx:31-38` |
| Başarısız çalışma | `bg-red-500/20` üzerinde `XCircle` | görev kimliği ve başlığı ya da "Failed run" ile ajan adı | durum rozeti, ajan, hatanın ilk satırı, zaman | "Retry" (çerçeveli) ve listeden kaldırma X'i | `ui/src/pages/Inbox.tsx:349-498`, hata metni `ui/src/pages/Inbox.tsx:286-288` |
| Katılma isteği | `bg-muted` üzerinde `UserPlus` | isteyenin adı ve e-postası ya da "Agent join request: name" | "requested 2h ago from IP ...", adaptör | "Approve", "Reject" | `ui/src/pages/Inbox.tsx:639-755`, `ui/src/pages/Inbox.tsx:312-338` |

Gelen kutusundan onaylayınca `/approvals/:id?resolved=approved` adresine gidilir (`ui/src/pages/Inbox.tsx:1738-1748`). Yeniden dene düğmesi `agentsApi.retryFailedRun` çağırır ve yeni çalışmaya gider (`ui/src/pages/Inbox.tsx:1791-1825`).

### 4.6 Gruplama, iç içe gösterim, tarih ayırıcıları

- Gruplama: yok, türe göre (Tasks, Approvals, Failed runs, Join requests), atanana, projeye ya da çalışma alanına göre. Göreve dayalı gruplamalarda görev olmayan türler kendi gruplarını oluşturur. Gruplar en yeni kayıtlarına göre sıralanır (`ui/src/lib/inbox.ts:864-997`).
- Grup başlığı: `flex items-center py-1.5 pl-1 pr-3`, `w-4` kutu içinde ok, etiket `text-sm font-semibold uppercase tracking-wide`, sonda isteğe bağlı bir kontrol (`ui/src/components/IssueGroupHeader.tsx:23-50`). Gelen kutusu gruplarında küçük bir "+" bulunur; yeni görev penceresini o grubun değeri (proje, atanan ya da çalışma alanı) dolu olarak açar (`ui/src/pages/Inbox.tsx:2973-2993`; `ui/src/lib/inbox.ts:1019-1076`).
- İç içe gösterim: açıkken (varsayılan, yalnızca geniş ekranda) üst görevi aynı listede olan alt görev onun altında çizilir; üst görev de alt ağacındaki en yeni etkinliğe göre sıralanır, yani alt görevinde yeni etkinlik olan eski bir üst görev yukarı çıkar (`ui/src/lib/inbox.ts:657-676`, `ui/src/lib/inbox.ts:1078-1155`). Kapatılan üst görevler ve gruplar localStorage'da şirket başına saklanır (`ui/src/lib/inbox.ts:29-30`, `ui/src/lib/inbox.ts:251-309`).
- Tarih ayırıcıları: gruplama yokken satırların arasına "Today", "Yesterday", "Earlier" etiketli çizgiler eklenir; yerel takvim kullanılır. Yalnızca eski kayıtlardan oluşan liste "Earlier" ile başlamaz (`ui/src/lib/task-date-groups.ts:1-37`; `ui/src/pages/Inbox.tsx:3014-3045`). Ayırıcının biçimi: iki yanda ince birer çizgi ve 10px'lik büyük harfli etiket (`ui/src/pages/Inbox.tsx:3029-3044`).

### 4.7 Sıralama ve sıranın sabitlenmesi

Varsayılan sırada en yeni etkinlik en üsttedir; görevin zamanı `lastActivityAt`, yoksa `lastExternalCommentAt`, o da yoksa `updatedAt` değeridir (`ui/src/lib/inbox.ts:753-767`).

Kullanıcı listeyle çalışırken satırlar yer değiştirmez. Yeni hesaplanan sıra yalnızca "attention boundaries" (dikkat sınırları) denen anlarda uygulanır (`ui/src/pages/Inbox.tsx:1523-1593`):

- sayfa açılırken ve sekme, filtre, arama, gruplama ya da iç içe gösterim değişince (`ui/src/hooks/useInboxSortAttention.ts:86-97`);
- 150 saniye hiçbir işlem yapılmayınca; boşta kalındıkça yinelenir (`ui/src/hooks/useInboxSortAttention.ts:3`, `ui/src/hooks/useInboxSortAttention.ts:59-75`);
- tarayıcı sekmesi 30 saniye ya da daha uzun süre gizli kaldıktan sonra yeniden görünür olunca (`ui/src/hooks/useInboxSortAttention.ts:4`, `ui/src/hooks/useInboxSortAttention.ts:107-120`).

Bu anların arasında önceki sıra korunur, yeni kayıtlar hesaplanan yerlerine eklenir (`ui/src/lib/inboxOrderPin.ts:75-116`). Her fare ya da parmak basışı, tekerlek hareketi, tuş vuruşu ya da arşivleme boşta kalma sayacını sıfırlar (`ui/src/pages/Inbox.tsx:2739-2740`, `ui/src/pages/Inbox.tsx:2175-2176`, `ui/src/pages/Inbox.tsx:1871-1872`).

### 4.8 Okundu, arşivleme, listeden kaldırma, geri alma

| Eylem | Neye uygulanır | Ne olur | Kanıt |
|---|---|---|---|
| Okundu işaretleme | görev | `POST /issues/:id/read`; nokta 300 ms içinde solar, sonra önbellekler geçersiz kılınır | `ui/src/pages/Inbox.tsx:1949-1966` |
| Okunmadı işaretleme | görev | `DELETE /issues/:id/read` | `ui/src/pages/Inbox.tsx:1993-1998` |
| Tümünü okundu işaretleme | görünümdeki bütün okunmamış görevler | sayıyı da gösteren "Mark all as read?" onay penceresi, ardından görev başına bir istek | `ui/src/pages/Inbox.tsx:1968-1991`, `ui/src/pages/Inbox.tsx:2637-2672` |
| Arşivleme | görev (yalnızca Benim sekmesinde) | sunucu beklenmeden ekrana yansır: Gelen kutusu sorguları iptal edilir, önbelleklerin kopyası alınır, satır bütün Gelen kutusu önbelleklerinden çıkarılır, `POST /issues/:id/inbox-archive` gönderilir; hata olursa yalnızca o satır eski yerine döner | `ui/src/pages/Inbox.tsx:1868-1916`; `ui/src/lib/inboxArchiveCache.ts:178-228` |
| Arşivi geri alma | son arşivlenen görev | `u` tuşu; `DELETE /issues/:id/inbox-archive` | `ui/src/pages/Inbox.tsx:1918-1947`, `ui/src/pages/Inbox.tsx:2153-2169` |
| Onay, başarısız çalışma ve katılma isteği için okundu / okunmadı | görev olmayan kayıtlar | yalnızca tarayıcıda, localStorage anahtarı `paperclip:inbox:read-items` | `ui/src/lib/inbox.ts:23`, `ui/src/lib/inbox.ts:347-362`; `ui/src/hooks/useInboxBadge.ts:147-178` |
| Onay, başarısız çalışma ve katılma isteğini listeden kaldırma | görev olmayan kayıtlar | sunucuda, kullanıcıya özel: `POST /companies/:id/inbox-dismissals { itemKey }`; anahtarlar `approval:<id>`, `run:<id>`, `join:<id>`; kayıt sunucu beklenmeden eklenir, hata olursa geri alınır. Kaldırma anından sonra etkinlik gören kayıt listeye geri döner | `ui/src/api/inboxDismissals.ts:4-16`; `ui/src/hooks/useInboxBadge.ts:57-145`; `ui/src/lib/inbox.ts:337-345`, `ui/src/lib/inbox.ts:1185-1190` |
| Erteleme | ilgi bekleyen kayıtlar | aynı uç nokta, `kind: "snooze", snoozedUntil` ile | `ui/src/api/inboxDismissals.ts:8-13` |
| Uyarıları kapatma | bütçe ve ajan hatası uyarıları | localStorage anahtarı `paperclip:inbox:dismissed` | `ui/src/lib/inbox.ts:22`, `ui/src/lib/inbox.ts:311-329` |

Yerel bir koruma, arşivlenen görevi bütün Gelen kutusu önbelleklerinin dışında tutar; sunucu henüz güncellenmeden arka plandaki bir yeniden çekme görevi geri getirse bile görev listeye dönmez. Koruma, sunucunun doğrulamasından sonra 5 saniye, toplamda en çok 30 saniye sürer (`ui/src/lib/inboxArchiveCache.ts:8-9`, `ui/src/lib/inboxArchiveCache.ts:61-105`). Aynı süzme, başka sekmelerden gelen veriye de uygulanır (`ui/src/hooks/useSharedPolling.ts:66-79`).

Arşivleme animasyonu: satıra `-translate-x-4 scale-(--s-0_98) opacity-0 transition-all duration-200 ease-out` verilir (`ui/src/pages/Inbox.tsx:2798-2802`).

Gelen kutusundan açılan görev bir kez okundu işaretlenir (`ui/src/pages/IssueDetail.tsx:4106-4124`, `ui/src/pages/IssueDetail.tsx:5672-5677`). Görev Gelen kutusundan Enter ile açıldıysa görev sayfası "quick archive" (hızlı arşivleme) kısayolunu etkinleştirir: orada `y` tuşuna basmak görevi arşivler ve Gelen kutusuna döndürür (`ui/src/pages/Inbox.tsx:2293`; `ui/src/lib/keyboardShortcuts.ts:127-152`; `ui/src/pages/IssueDetail.tsx:5872-5898`).

### 4.9 Klavye ve dokunma

Tarayıcı penceresi düzeyinde tek bir dinleyici vardır; giriş alanlarının içindeyken, değiştirici tuş basılıyken ya da bir pencere açıkken tuşları yok sayar (`ui/src/pages/Inbox.tsx:2131-2146`).

| Tuş | Eylem | Kapsam |
|---|---|---|
| `j` / ArrowDown, `k` / ArrowUp | seçimi taşır | bütün sekmeler |
| ArrowLeft / ArrowRight | seçili grubu ya da üst görevi kapatır / açar | bütün sekmeler |
| Enter | görevi, onayı ya da başarısız çalışmayı açar | bütün sekmeler |
| `a` ya da `y` | arşivler | yalnızca Benim sekmesi |
| `r` | okundu işaretler | yalnızca Benim sekmesi |
| `U` (shift) | okunmadı işaretler | yalnızca Benim sekmesi |
| `u` | son arşivlemeyi geri alır | yalnızca Benim sekmesi |

Kanıt: `ui/src/pages/Inbox.tsx:2196-2316`; kısayol listesinin metni `ui/src/components/KeyboardShortcutsCheatsheet.tsx:16-32`. Kısayol listesi `?` ile açılır (`ui/src/hooks/useKeyboardShortcuts.ts:108-113`).

Fare ile klavye tek bir hedefi çakışmadan paylaşır: basılan tuş, klavyeyle yapılan son gezinmeden sonra imleç oynatıldıysa imlecin altındaki satıra, oynatılmadıysa klavyeyle seçili satıra uygulanır. İmlecin altındaki satır bir ref içinde izlenir; bu yüzden fareyi listenin üzerinde gezdirmek yeniden çizime yol açmaz, fare devraldığı anda da klavyenin seçim vurgusu kaldırılır (`ui/src/pages/Inbox.tsx:1833-1861`, `ui/src/pages/Inbox.tsx:2187-2194`).

Dokunma: `SwipeToArchive`, arşivlenebilen satırları sarar. Sola kaydırma, opaklığı sürüklemeyi izleyen yeşil bir "Archive" katmanını ortaya çıkarır; kaydırma satır genişliğinin %32'sinde kesinleşir, en çok %88'e kadar gider, ardından satır yüksekliği 200 ms içinde kapanır ve 140 ms sonra arşivleme çağrılır. Dikey hareket kaydırmayı iptal eder; kaydırmanın hemen ardından gelen tıklama 350 ms boyunca yok sayılır (`ui/src/components/SwipeToArchive.tsx:13-15`, `ui/src/components/SwipeToArchive.tsx:118-163`, `ui/src/components/SwipeToArchive.tsx:64-70`, `ui/src/components/SwipeToArchive.tsx:173-220`).

### 4.10 Gelen kutusunda arama

Yazılan metin listeyi yerelde başlığa, kimliğe ve açıklamaya göre süzer (o bayrak açıksa çalışma alanı adına göre de) (`ui/src/lib/inbox.ts:434-459`). Onaylar etiket ve türe, başarısız çalışmalar ajan adına, hataya ve bağlı göreve, katılma istekleri ajan adına ve yeteneklere göre eşleşir (`ui/src/pages/Inbox.tsx:1354-1394`). Benim sekmesinde, etiketli ayırıcıların altına iki bölüm daha eklenir: "Archived" (eşleşen ama artık Benim sekmesinde olmayan, işlem yapılmış görevler) ve "Other results" (sunucudan gelen ve henüz gösterilmemiş en çok 25 eşleşme) (`ui/src/pages/Inbox.tsx:1406-1453`, `ui/src/pages/Inbox.tsx:2935-2949`; `ui/src/lib/inbox.ts:461-533`). Bu bölümlerdeki satırlar arşivlenemez (`ui/src/pages/Inbox.tsx:3174`).

### 4.11 Engellenenler (Blocked) sekmesi

Ayrı bir sorgu kullanır: `GET /companies/:id/issues?attention=blocked&includeBlockedInboxAttention=true&includeBlockedBy=true&includeLiveDescendantSummary=true&limit=200` (`ui/src/components/BlockedInboxView.tsx:49`, `ui/src/components/BlockedInboxView.tsx:72-88`). Her satır bir görev ile sunucunun hesapladığı `blockedInboxAttention` değerinden oluşur.

- Her satırda bir neden etiketi. On iki neden altı gruba bağlanır: Needs decision, Blocked chain stalled, Needs attention, Recovery required, External wait, Owner paused (`ui/src/lib/blockedInbox.ts:16-62`).
- Satırdaki ekler: neden etiketi, sahibin kimliği (ajan ya da kullanıcı) ve zaman sütununda "stopped 3h" gibi bir süre (`ui/src/components/BlockedInboxView.tsx:324-349`, `ui/src/components/BlockedInboxView.tsx:393-404`; `ui/src/lib/blockedInbox.ts:251-275`).
- Araç çubuğu: filtreler, gruplama (Blocker type, None), sütunlar, sıralama (Most urgent, Most recent, Longest stopped) (`ui/src/pages/Inbox.tsx:2446-2541`; `ui/src/lib/blockedInbox.ts:112-121`). "Most urgent" önce önem derecesine, sonra işin ne kadar süredir durduğuna göre sıralar (`ui/src/lib/blockedInbox.ts:89-99`).
- Ekran durumları: ikişer satırlık üç gruptan oluşan yükleme iskeleti (`ui/src/components/BlockedInboxView.tsx:123-148`); diğer sekmelerin çalışmayı sürdürdüğünü söyleyen, "Try again" düğmeli sarı bir hata kartı (`ui/src/components/BlockedInboxView.tsx:150-180`); yeşil onay işaretli boş ekran kartı, "No work is stopped." (duran iş yok) (`ui/src/components/BlockedInboxView.tsx:182-199`); "No stopped items match your search." (aramayla eşleşen duran iş yok) (`ui/src/components/BlockedInboxView.tsx:201-212`).

### 4.12 Uyarılar bölümü (Tümü sekmesi)

Listenin altında, en çok iki satırlı, kenarlıklı bir "Alerts" bloğu bulunur: "N agents have errors" (yalnızca başarısız çalışma satırı gösterilmiyorsa) ve "Budget at N% utilization this month" (bütçe varsa ve kullanım %80 ya da üstündeyse). Her satır ilgili sayfaya bağlanır ve yalnızca üzerine gelince görünen bir kapatma X'i taşır (`ui/src/pages/Inbox.tsx:3264-3320`; eşikler `ui/src/lib/inbox.ts:1298-1309`).

### 4.13 Kenar çubuğu rozeti ve telefon menüsü

Gelen kutusu rozeti istemcide hesaplanır: işlem bekleyen onaylar + bekleyen katılma istekleri + benim görebildiğim başarısız çalışmalar + okunmamış görevlerim. Uyarılar sayılmaz: "The inbox badge reflects personal/actionable work, not company-wide health alerts" (rozet kişisel ve işlem bekleyen işi gösterir, şirket genelindeki sağlık uyarılarını değil) (`ui/src/lib/inbox.ts:1265-1320`, yorum `ui/src/lib/inbox.ts:1312`). Sayfayla aynı sorguları kullandığı için ikisi birbirini tutar (`ui/src/hooks/useInboxBadge.ts:180-275`). Başarısız çalışma varsa rozet kırmızıya döner ve simgeye kırmızı bir nokta eklenir (`ui/src/components/Sidebar.tsx:169-177`; `ui/src/components/SidebarNavItem.tsx:140-146`, `ui/src/components/SidebarNavItem.tsx:198-211`). Ayrıca `{ inbox, approvals, failedRuns, joinRequests }` döndüren bir sunucu uç noktası da vardır: `GET /companies/:id/sidebar-badges` (`ui/src/api/sidebarBadges.ts:5`; `packages/shared/src/types/sidebar-badges.ts:1-6`).

Telefondaki alt menüde beş göz vardır: Home, Tasks, New Task (eylem), Agents ve en çok "99+" gösteren rozetiyle Inbox (`ui/src/components/MobileBottomNav.tsx:44-59`, `ui/src/components/MobileBottomNav.tsx:111-115`). Menü `fixed bottom-0` ve `h-16 grid-cols-5` sınıflarını taşır, `translate-y-full` ile kayarak gizlenir (`ui/src/components/MobileBottomNav.tsx:62-69`).

### 4.14 Boş ekran, yükleme, canlı güncelleme

- Yükleme: bütün sorgular yüklenene kadar ve görünür hiçbir şey yokken `PageSkeleton variant="inbox"` (`ui/src/pages/Inbox.tsx:2711-2713`; `ui/src/components/PageSkeleton.tsx:75-97`).
- Boş ekran metinleri sekmeye göre: "Inbox zero." (Benim), "No new inbox items." (Okunmamış), "No recent inbox items." (Son), "No inbox items match these filters." (Tümü), "No inbox items match your search." (`ui/src/pages/Inbox.tsx:2715-2730`).
- Canlı güncelleme: listeler, şirket WebSocket'inin tetiklediği önbellek geçersiz kılma yoluyla yenilenir (bölüm 14). Görev listeleri için aralıklı yoklama yoktur; `staleTime` 30 saniyedir ve odaklanınca yeniden çekme kapalıdır (`ui/src/pages/Inbox.tsx:962-963`). Sonuçlar tarayıcı sekmeleri arasında `useSharedPollingQuery` ile paylaşılır (`ui/src/hooks/useSharedPolling.ts:81-152`).

### 4.15 Kararlar masası (Decisions, `enableDecisions` bayrağı, varsayılan kapalı)

Yol `/decisions` (`ui/src/App.tsx:424`), sayfa `ui/src/pages/WhatNeedsMe.tsx`. Sunucunun sıraladığı ikinci bir gelen kutusudur; satırları yerinde karara bağlanabilir.

- Veri akışı: `GET /companies/:id/attention?includeDismissed=true&all=true[&activitySince&activityUntil]` (`ui/src/pages/WhatNeedsMe.tsx:147-168`; `ui/src/api/attention.ts:10-23`). Bir kayıtta `sourceKind`, `subject { kind, id, title, identifier, status, href }`, `whyNow`, `decisionVerbs[]`, `inlineResolvable`, `severity`, `rank`, `activityAt`, `relatedIssue`, `project`, `decideBy`, `dismissal` ve tipli bir `detail` bulunur (`packages/shared/src/types/attention.ts:221-261`).
- Kaynak türleri: approval, decision, issue_thread_interaction, join_request, recovery_action, blocker_attention, review, failed_run, budget_alert, agent_error_alert (`packages/shared/src/types/attention.ts:8-21`); etiketleri "Approval", "Decision", "Decision requested", "Join request", "Recovery", "Blocked dependency", "Review", "Failed run", "Budget", "Agent error" (`ui/src/lib/attention.ts:50-63`).
- Yalnızca iki görsel tür vardır: "blocking" satırları engellendi simgesini (kırmızı), "review" satırları incelemede simgesini (mor) ödünç alır. Koddaki yorum, kuyruk ile görev listesi tek bir dili paylaşsın diye beş paralel renk takımının kaldırıldığını anlatır (`ui/src/lib/attention.ts:85-142`).
- Yerleşim: `max-w-3xl space-y-4`, "Decisions" başlığı, araç çubuğu (filtreler, gruplama, sıralama), kuyruk şeridi, tarih etiketleri (All, Today, Yesterday, Last 7 days, This month) (`ui/src/pages/WhatNeedsMe.tsx:519-547`; `ui/src/lib/attention.ts:442-450`). Varsayılan raflar: "Decide now" (yalnızca karar tarihi gelmiş bir kayıt varsa), "New today", "Earlier" (`ui/src/lib/attention.ts:340-378`).
- Satır: `rounded-xl border border-border bg-card px-4 pt-3 pb-4` sınıflı bir kart; bir bilgi şeridi (simge + tür etiketi, görev kimliği, karar tarihi, göreli zaman, Snooze ve Dismiss içeren taşma menüsü), bir başlık ve solda "See more", sağda karar düğmeleri olan bir alt bölüm içerir (`ui/src/components/AttentionQueueRow.tsx:236-330`, `ui/src/components/AttentionQueueRow.tsx:178-233`). Düğmeler container query'ler sayesinde dar kapsayıcıda `h-9`, geniş kapsayıcıda `h-6` olur (`ui/src/components/AttentionQueueRow.tsx:58-62`). Hazır erteleme seçenekleri: 1 saat, 4 saat, yarın sabah, gelecek hafta (`ui/src/components/AttentionQueueRow.tsx:72-78`).
- Yok sayma sunucu beklenmeden ekrana yansır ve 8 saniyelik bir "Undo" bildirimi çıkar (`ui/src/pages/WhatNeedsMe.tsx:426-443`). Yok sayılan, ertelenen, eskiyen (30 günden uzun süredir hareketsiz), karara bağlanan ve süresi dolan kayıtlar masanın altındaki kapalı "curtains" (perdeler) içinde durur (`ui/src/pages/WhatNeedsMe.tsx:633-758`; `ui/src/lib/attention.ts:390`).
- Tuşlar: `j`/`k` ya da ok tuşları gezdirir, Enter açar ya da kapatır, `x` yok sayar (`ui/src/lib/keyboardShortcuts.ts:89-125`). Seçim halkası yalnızca klavyeyle seçimde çizilir (`ui/src/pages/WhatNeedsMe.tsx:92-99`).
- Satırlar parça parça çizilir: önce 50, kaydırırken sona 480px kala 100 satır daha (`ui/src/pages/WhatNeedsMe.tsx:54-63`).
- Boş ekran: kesikli kenarlıklı, yeşil onay işaretli bir kart, "You're all caught up" (bekleyen bir şey yok) (`ui/src/pages/WhatNeedsMe.tsx:816-829`).
- Kenar çubuğu rozeti: bugün gelen ya da karar tarihi gelmiş kayıtları sayar, 60 saniyede bir yeniden çekilir (`ui/src/components/Sidebar.tsx:101-107`; `packages/shared/src/types/attention.ts:266-273`).

### 4.16 Onay sayfaları (her zaman açık)

Liste: `/approvals/pending` ve `/approvals/all` (`ui/src/App.tsx:384-386`). Tek sorgu vardır, `GET /companies/:id/approvals`; istemcide süzülür; "pending" kapsamına `revision_requested` de girer; en yeni en üsttedir; Bekleyen (Pending) sekmesinde sarı bir sayı etiketi durur (`ui/src/pages/Approvals.tsx:33-37`, `ui/src/pages/Approvals.tsx:68-101`).

Kart (`ui/src/components/ApprovalCard.tsx:56-153`):

```
(icon circle)  [TYPE BADGE]  Requested by <agent>                     [status pill]
               Subject (payload title / name / summary)
               Approval request created 2h ago
---------------------------------------------------------------
payload renderer (per type)
[Decision note. ...]
---------------------------------------------------------------
[Approve] [Reject]                                        View details
```

- Kart `border-border/70 p-4`; tür rozeti büyük harfli, 11px; konu `text-base font-semibold`; durum etiketinde küçük bir simge vardır (bekleyen için saat, onay işareti, çarpı).
- "Approve" düğmesi `bg-green-700 hover:bg-green-600 text-white`, "Reject" düğmesi destructive türündedir; ikisi de `size="sm"`; istek sürerken etiket "Approving..." / "Rejecting..." olur (`ui/src/components/ApprovalCard.tsx:112-134`). Bütçe aşımı onaylarında burada düğme çıkmaz (`ui/src/components/ApprovalCard.tsx:50-53`).
- `request_board_approval` içeriği: etiketli bloklar hâlinde Title, Summary (markdown), sarı kutuda "Recommended action", "On approval", madde madde Risks, eş aralıklı yazılı kutuda "Proposed comment" (`ui/src/components/ApprovalPayload.tsx:173-239`). İşe alma onayı ad, rol, unvan, yetenekler, adaptör ve skill'leri gösterir (`ui/src/components/ApprovalPayload.tsx:84-111`). Bütçe onayı kapsamı, dönemi, ölçütü, sınırı ve gözlenen değeri gösterir (`ui/src/components/ApprovalPayload.tsx:132-150`).
- Boş ekran: soluk bir kalkan simgesi ve "No pending approvals." ya da "No approvals yet." (`ui/src/pages/Approvals.tsx:107-114`). Yükleme: `PageSkeleton variant="approvals"`.

Ayrıntı sayfası `/approvals/:approvalId` (`ui/src/pages/ApprovalDetail.tsx`): `max-w-3xl`; başlık kartında etiket, kimlik, durum rozeti, isteyen, içerik, ham JSON'u gösteren "See full request" aç/kapa düğmesi, "Linked Tasks" listesi ve şu düğmeler bulunur: Approve, Reject, "Request revision" (yalnızca bekleyen onayda), "Mark resubmitted" (yalnızca düzeltme istenmişse) (`ui/src/pages/ApprovalDetail.tsx:202-325`). Uç noktalar: isteğe bağlı `decisionNote` ile `POST /approvals/:id/approve | reject | request-revision | resubmit`; yorumlar `/approvals/:id/comments` altındadır (`ui/src/api/approvals.ts:12-22`). Onaydan sonra yeşil bir "Approval confirmed" şeridi tek bir sonraki adımla görünür: "Review linked task", "Open hired agent" ya da "Back to approvals" (`ui/src/pages/ApprovalDetail.tsx:153-172`, `ui/src/pages/ApprovalDetail.tsx:176-201`). Sayfa, bir metin alanı ve "Post comment" düğmesi olan yorum kartıyla biter (`ui/src/pages/ApprovalDetail.tsx:327-366`).

### 4.17 Katılma isteği kuyruğu

`/inbox/requests` (`ui/src/App.tsx:432`): iki seçim kutusu (durum, istek türü) ile Approve ve Reject düğmeli kartlardan oluşan sade bir sayfa; başarılı olunca bildirim çıkar; boş ekran metni "No join requests match the current filters." (`ui/src/pages/JoinRequestQueue.tsx:19-20`, `ui/src/pages/JoinRequestQueue.tsx:41-57`, `ui/src/pages/JoinRequestQueue.tsx:89-124`). Gelen kutusu listesindeki satırlar da aynı mutation'ları kullanır (`ui/src/pages/JoinRequestQueue.tsx:84-86`).

## 5. Görev listesi

Yol `/issues` (`ui/src/App.tsx:303`), sayfa `ui/src/pages/Issues.tsx`, liste bileşeni `ui/src/components/IssuesList.tsx` (sade kabuğa ait kısım 701. satırdan başlar). `MyIssues.tsx` dosyası vardır ama bir yola bağlı değildir (`ui/src/App.tsx` içinde import edilmiyor).

### 5.1 Veri yükleme

- `GET /companies/:id/issues?view=compact&includeRoutineExecutions=true&limit=100&offset=N&sortField=updated&sortDir=desc` üzerinde sonsuz sorgu; URL'den isteğe bağlı `participantAgentId` ve `workspaceId` alınır (`ui/src/pages/Issues.tsx:21`, `ui/src/pages/Issues.tsx:145-178`). Sayfalar kimliğe göre tekilleştirilerek birleştirilir; böylece sayfalar arasında yer değiştiren bir görev iki kez gösterilmez (`ui/src/pages/Issues.tsx:39-52`). Yeni anahtar yüklenirken `placeholderData` önceki listeyi ekranda tutar (`ui/src/pages/Issues.tsx:177`).
- Arama metni `?q=` içinde durur ve `history.replaceState` ile yazılır (sayfa geçişi olmaz) (`ui/src/pages/Issues.tsx:54-66`, `ui/src/pages/Issues.tsx:89-97`).
- Süren çalışmalar ortak `live-runs` sorgusundan gelir; `liveIssueIds`, sırada bekleyen ya da süren bir çalışması olan görevlerin kümesidir; bitmiş ya da iptal edilmiş görevler buna girmez (`ui/src/pages/Issues.tsx:111-127`, `ui/src/pages/Issues.tsx:181`; `ui/src/lib/liveIssueIds.ts:4-19`, `ui/src/lib/liveIssueIds.ts:61-71`).
- Güncellemeler: `PATCH /issues/:id`, ardından liste geçersiz kılınır (`ui/src/pages/Issues.tsx:192-198`).

### 5.2 Araç çubuğu

Soldan sağa (`ui/src/components/IssuesList.tsx:1726-1973`):

1. Çerçeveli "New Task" düğmesi (telefonda yalnızca simge) (`ui/src/components/IssuesList.tsx:1729-1734`).
2. Arama alanı; yer tutucu metni "Search tasks...", `sm:w-64 md:w-80`; 250 ms geciktirilir ve `startTransition` içinde uygulanır (`ui/src/components/IssuesList.tsx:100`, `ui/src/components/IssuesList.tsx:515-575`).
3. Görünüm seçici: iki düğmeli bölmeli kontrol (liste, pano); her düğme `h-8 w-8`, seçili olan `bg-accent` (`ui/src/components/IssuesList.tsx:1747-1766`).
4. Yalnızca listede: iç içe gösterme düğmesi (`ui/src/components/IssuesList.tsx:1768-1779`).
5. Yalnızca panoda: sıkışık kartlar, soğuk (cold) sütunları kapatma, sütun başına kart sayısı (10, 25, 50), sıfırlama (`ui/src/components/IssuesList.tsx:1781-1856`).
6. Sütun seçici (`ui/src/components/IssuesList.tsx:1858-1868`).
7. Filtreler (`ui/src/components/IssuesList.tsx:1870-1885`).
8. Yalnızca listede: sıralama açılır menüsü (`ui/src/components/IssuesList.tsx:1888-1932`) ve gruplama açılır menüsü (`ui/src/components/IssuesList.tsx:1935-1970`).

### 5.3 Filtreler

Filtre durumu (`ui/src/lib/issue-filters.ts:15-53`): `statuses[], priorities[], assignees[], creators[], labels[], projects[], workspaces[], liveOnly, externalObjectStatuses[], hideRoutineExecutions`. Bütün filtreleme istemcide, yüklenmiş satırlar üzerinde yapılır (`ui/src/lib/issue-filters.ts:209-268`). Etkin filtre sayısı değerleri değil, filtre gruplarını sayar (`ui/src/lib/issue-filters.ts:270-286`).

Açılır menünün yerleşimi (`ui/src/components/IssueFiltersPopover.tsx:215-568`): "Clear" düğmeli "Filters" başlığı; etiket biçiminde "Quick filters": All, Active (todo, in_progress, in_review, blocked), Backlog, Done (done, cancelled) (`ui/src/lib/issue-filters.ts:82-87`); ardından geniş ekranda üç sütun:

- Status (onay kutusu + durum simgesi + etiket), Priority (gizli);
- Responsible ("No responsible", "Me", ajanlar), Creator (arama kutusu, seçilen oluşturanlar kaldırılabilir etiketler olarak), Project;
- Labels (renk noktası), Workspace (bayrağa bağlı), External object status (bayrağa bağlı), Visibility ("Live runs only", "Hide routine runs").

Altıdan fazla seçeneği olan listelere bir arama alanı eklenir (`ui/src/components/IssueFiltersPopover.tsx:82`, `ui/src/components/IssueFiltersPopover.tsx:363-365`). Filtre etkinken simge düğmesi maviye döner ve küçük bir sayı balonu gösterir (`ui/src/components/IssueFiltersPopover.tsx:199-203`).

### 5.4 Sıralama, gruplama, iç içe gösterim

- Sıralama alanları: Workflow, Status, Title, Created, Updated (Priority gizli). Etkin alana tıklamak yönü çevirir; yeni seçilen alan artan sırayla başlar; yönü bir ok gösterir (`ui/src/components/IssuesList.tsx:1898-1928`). Varsayılan Updated, azalan sıradır (`ui/src/components/IssuesList.tsx:175-188`). Sıralama istemcide yapılır (`ui/src/components/IssuesList.tsx:279-303`). "Workflow", görevleri bir engelleyen engellediği görevin hemen önüne gelecek biçimde dizer; eşitlikte oluşturma zamanına bakılır (`ui/src/lib/workflow-sort.ts:9-19`, kullanıldığı yer `ui/src/components/IssuesList.tsx:280-283`).
- Gruplama: Status, Responsible, Project, Workspace, Parent Task, None (`ui/src/components/IssuesList.tsx:1945-1953`); grupların kurulması `ui/src/components/IssuesList.tsx:1265-1356`. Her grup başlığında bir "+" vardır; yeni görev penceresini o grubun değeri (durum, atanan, proje, çalışma alanı ya da üst görev) dolu olarak açar (`ui/src/components/IssuesList.tsx:1621-1671`, `ui/src/components/IssuesList.tsx:2044-2055`).
- İç içe gösterim varsayılan olarak açıktır: alt görevler, ağaç kılavuz çizgileriyle üst görevlerin altında çizilir; kapalı duran üst görev, alt ağacındaki bütün görevleri sayan "(N sub-tasks)" yazısını gösterir (`ui/src/components/IssuesList.tsx:2061-2073`, `ui/src/components/IssuesList.tsx:2181-2185`).
- Tarih ayırıcıları (Today, Yesterday, Earlier) yalnızca oluşturma ya da güncelleme zamanına göre en yeni en üstte sıralamalarda çıkar (`ui/src/components/IssuesList.tsx:305-312`, `ui/src/components/IssuesList.tsx:2430-2453`).

### 5.5 Saklanan görünüm durumu

`IssueViewState` = filtre durumu ve ek olarak `sortField, sortDir, groupBy, viewMode ("list" | "board"), nestingEnabled, showDateGroupSeparators, collapsedGroups[], collapsedParents[], boardCardDensity, boardColdLaneMode, boardColumnPageSize` (`ui/src/components/IssuesList.tsx:156-188`).

localStorage'da `paperclip:task-collection:v1:<companyId>:<collectionKey>` anahtarı altında, `{ version, companyId, collectionKey, viewState, viewStateSource, columns }` biçiminde bir zarf olarak saklanır (`ui/src/lib/task-collection-preferences.ts:5-12`, `ui/src/lib/task-collection-preferences.ts:45-50`). Görev listesi sayfası `viewStateKey="paperclip:issues-view"` kullanır (`ui/src/pages/Issues.tsx:220`); aynı bileşen alt görev listelerinde başka bir anahtarla yeniden kullanılır (`ui/src/pages/IssueDetail.tsx:4510-4553`). Her okuma alan alan normalleştirilir; böylece eski ya da bozuk değerler varsayılana döner (`ui/src/components/IssuesList.tsx:204-230`). Durum tarayıcıya özeldir; sunucuda kayıtlı görünüm yoktur. Artık var olmayan kapalı üst görevler kayıttan ayıklanır (`ui/src/components/IssuesList.tsx:859-869`). `assignee` ve `workspace` URL parametreleri sayfaya girişte filtreleri ezer (`ui/src/pages/Issues.tsx:224-225`).

### 5.6 Satırlar

Gelen kutusundakiyle aynı `IssueRow` kullanılır (bölüm 4.5), okunmamış noktası olmadan. Farklar:

- Durum simgesi bir seçicidir: tıklanınca durum açılır menüsünü açar ve `{ status }` içeriğini `PATCH` ile gönderir (`ui/src/components/IssuesList.tsx:2230-2237`).
- Responsible sütunu satır içi bir seçicidir: `w-56` genişliğinde bir açılır menü; içinde arama alanı, "No responsible", "Me" ve ardından ajanlar bulunur (`ui/src/components/IssuesList.tsx:2322-2421`).
- Başlıktan sonraki rozetler: "Paused", özel bir rozet, "Needs next step" (`ui/src/components/IssuesList.tsx:2186-2211`).
- Her satırın sarmalayıcısında `contentVisibility: "auto"` ve `containIntrinsicSize: "44px"` vardır; böylece ekran dışındaki satırlar için yerleşim hesabı yapılmaz (`ui/src/components/IssuesList.tsx:2158-2163`).
- Workflow sıralaması seçiliyken ve gruplama yokken liste bir kontrol listesine dönüşür: adım numaraları ("1.", "2.1"), `bg-primary/5` ile vurgulanan ilk yapılabilir görev, soluk yazılan bitmiş başlıklar ve engelleyene kaydıran "blocked by PAP-12 · step 3" etiketi (`ui/src/components/IssuesList.tsx:1200-1239`, `ui/src/components/IssuesList.tsx:2099-2150`; `ui/src/components/IssueRow.tsx:229`).

### 5.7 Pano

dnd-kit ile yazılmış `KanbanBoard` (`ui/src/components/KanbanBoard.tsx`):

- Sabit sırada yedi sütun; her biri 260px genişliğindedir ve yatay kayan bir `flex gap-3 overflow-x-auto pb-4` içinde durur (`ui/src/components/KanbanBoard.tsx:41-49`, `ui/src/components/KanbanBoard.tsx:217`, `ui/src/components/KanbanBoard.tsx:465`).
- Sütun başlığı: durum simgesi, büyük harfli etiket, sayı. Gövde durum rengiyle hafifçe boyanır; üzerine kart sürüklenince renk koyulaşır (`ui/src/components/KanbanBoard.tsx:64-128`, `ui/src/components/KanbanBoard.tsx:216-233`).
- Kart: `p-2.5` (sıkışık görünümde `p-2`), eş aralıklı yazıyla kimlik, isteğe bağlı "Next step" rozeti, canlı nokta, "N live below", iki satırlık başlık, atananın kimliği. Sürüklerken `shadow-lg ring-1 ring-primary/20` sınıflı bir kopya görünür; asıl kart %30 opaklığa iner (`ui/src/components/KanbanBoard.tsx:308-381`).
- Sürüklemenin başlaması için 5px hareket gerekir; bu yüzden tıklama yine görevi açar (`ui/src/components/KanbanBoard.tsx:405-407`). Kartı bir sütuna ya da başka sütundaki bir kartın üzerine bırakmak `{ status }` gönderir (`ui/src/components/KanbanBoard.tsx:436-452`, `ui/src/components/KanbanBoard.tsx:138-143`).
- Her sütun 10 kart ve kesikli kenarlıklı bir "Show N more" düğmesi gösterir; sayfa boyutu 10, 25 ya da 50 olabilir (`ui/src/components/KanbanBoard.tsx:33-38`, `ui/src/components/KanbanBoard.tsx:251-264`).
- Soğuk (cold) sütunlar (backlog, done, cancelled) dikey etiketli 52px'lik şeritlere kapanabilir; 100 kartın üstünde bu özellik ve sıkışık kartlar kendiliğinden açılır (`ui/src/components/KanbanBoard.tsx:33`, `ui/src/components/KanbanBoard.tsx:39`, `ui/src/components/KanbanBoard.tsx:194-214`; `ui/src/components/IssuesList.tsx:1248-1259`).
- Pano verisi: her durum için bir sorgu, her birinin sınırı 200; bir sütun sınıra ulaşınca bir not görünür (`ui/src/components/IssuesList.tsx:102`, `ui/src/components/IssuesList.tsx:890-915`, `ui/src/components/IssuesList.tsx:1982-1986`).

### 5.8 Klavye

`j`/`k`/ok tuşları gezdirir, ArrowLeft/ArrowRight bir grubu ya da üst görevi kapatır ya da açar, Enter açar. İmlecin altındaki satırla ilgili kural Gelen kutusundakiyle aynıdır (`ui/src/components/IssuesList.tsx:1432-1530`). Enter, sayfaya gitmeden önce görevi ve ilk yorum sayfasını önceden yükler: "so keyboard-driven opens paint from cache instantly" (klavyeyle açılan kayıt önbellekten anında çizilsin diye) (`ui/src/components/IssuesList.tsx:1516-1521`). Her yerde geçerli tuşlar: `c` yeni görev, `/` sayfa aramasına odaklanma, `[` kenar çubuğu, `]` panel, `?` kısayol listesi, `g i` Gelen kutusu (`ui/src/hooks/useKeyboardShortcuts.ts:99-131`, `ui/src/hooks/useKeyboardShortcuts.ts:57-77`).

### 5.9 Büyük listelerin çizimi

Sanal liste kütüphanesi kullanılmaz. Liste ilk 100 satırı çizer ve kaydırma konumu sona 320px yaklaşınca 150 satır daha ekler; çizilecek satır kalmayınca sunucudan sonraki sayfayı ister (`ui/src/components/IssuesList.tsx:118-120`, `ui/src/components/IssuesList.tsx:1540-1619`). Alttaki satırda "Rendering 100 of 240 tasks", "Loading more tasks..." ya da "Scroll to load more tasks" yazar (`ui/src/components/IssuesList.tsx:2484-2493`).

### 5.10 Toplu işlemler

Yoktur. Listede satır onay kutusu, çoklu seçim ve toplu işlem çubuğu bulunmaz: `ui/src/components/IssuesList.tsx`, `ui/src/pages/Issues.tsx` ve `ui/src/components/IssueRow.tsx` dosyalarında "bulk", "selectedIds", "selectAll" ve "Checkbox" araması sonuç vermez. Birden çok kayda uygulanan tek eylem Gelen kutusundaki "Mark all as read" eylemidir (bölüm 4.8). Ağacın tamamına uygulanan eylemler (bir alt ağacı duraklatma, iptal etme, geri yükleme) görev sayfasındadır (bölüm 7.16).

### 5.11 Liste içinde arama

Arama kutusunda metin varken liste bir sunucu sorgusuna geçer: `GET ...issues?view=compact&q=<text>&limit=200`; sınıra ulaşılınca "Showing up to 200 matches. Refine the search to narrow further." yazısını gösterir (`ui/src/components/IssuesList.tsx:101`, `ui/src/components/IssuesList.tsx:871-889`, `ui/src/components/IssuesList.tsx:1977-1981`). Gömülü listeler (alt görevler) ise yalnızca yüklenmiş satırlarda arama yapabilir (`ui/src/components/IssuesList.tsx:358-365`, `ui/src/components/IssuesList.tsx:1145-1150`).

### 5.12 Boş ekran, yükleme, canlı güncelleme

- Yükleme: `PageSkeleton variant="issues-list"` (araç çubuğu yer tutucuları ve 44px'lik sekiz çubuk) (`ui/src/components/IssuesList.tsx:1975`; `ui/src/components/PageSkeleton.tsx:138-161`).
- Boş ekran: "No tasks match the current filters or search." metni ve "Create Task" düğmesi (`ui/src/components/IssuesList.tsx:1987-1994`).
- Hata: tek satırlık kırmızı bir metin (`ui/src/components/IssuesList.tsx:1976`).
- Canlı güncelleme: "Live" rozeti, olaylarla güncellenen live-runs önbelleğini izler; liste satırları geçersiz kılma yoluyla yenilenir (bölüm 14).

## 6. Yeni görev penceresi

Dosya `ui/src/components/NewIssueDialog.tsx`. Kenar çubuğundaki "New Task" düğmesi, `c` tuşu, gruplardaki "+" düğmeleri ve "Add subtask" ile açılır (`ui/src/components/Sidebar.tsx:139-161`; `ui/src/hooks/useKeyboardShortcuts.ts:115-119`).

### 6.1 Yerleşim

Bir Radix penceresidir: `sm:max-w-lg` (genişletilince `sm:max-w-2xl`), varsayılan kapatma düğmesi yok, `p-0`, üç sabit şerit ve kayan bir gövde (`ui/src/components/NewIssueDialog.tsx:1376-1385`). Telefonda görünür ekran alanına göre boyutlanır, böylece klavye pencereyi örtmez (`ui/src/components/NewIssueDialog.tsx:91-158`).

```
[PAP] > New task                                         [expand] [x]     header bar
Task title (optional)                                                     text-lg font-semibold
For [Assignee] in [Project] [...]                                         inline sentence
(Reviewer row) (Approver row) (Watchdog row)                              optional
Add description...                                                        markdown editor
(staged Documents / Attachments)
------------------------------------------------------------------------
[Todo] [Upload] [Auto mode] [...]                                         chips bar
(notes: parked backlog, paused assignee, low-trust agent)
------------------------------------------------------------------------
Discard Draft                                   (error) [Create Task]     footer
```

- Üst şerit: şirket kodu etiketi (tıklanınca şirket değiştirilir), "New task" ya da "New sub-task", genişletme ve kapatma düğmeleri (`ui/src/components/NewIssueDialog.tsx:1419-1475`).
- Başlık: kendiliğinden büyüyen bir metin alanı. Enter açıklamaya geçirir. Tab ilk eksik alana geçirir: önce atanan, sonra proje, sonra açıklama (`ui/src/components/NewIssueDialog.tsx:401-437`).
- "For [Assignee] in [Project]": aramalı iki satır içi seçici; son seçilenler en üstte gelir, ayrıca "No assignee" / "No project" seçenekleri vardır (`ui/src/components/NewIssueDialog.tsx:1503-1612`). Durum Backlog iken atanan seçilirse durum Todo olur (`ui/src/components/NewIssueDialog.tsx:1520-1530`).
- Yanındaki "..." düğmesi Reviewer, Approver ya da Watchdog satırı ekler (`ui/src/components/NewIssueDialog.tsx:1614-1676`). İnceleyen ve onaylayan, her biri için bir aşama içeren bir yürütme kuralına dönüşür (`ui/src/components/NewIssueDialog.tsx:1071-1074`).
- Açıklama: @ ile söz etme ve görsel yükleme destekleyen ortak `MarkdownEditor`; yer tutucu metni "Add description...", en az yükseklik 120px (genişletilince 220px) (`ui/src/components/NewIssueDialog.tsx:442-478`).
- Dosyalar: "Upload" etiketiyle ya da açıklamanın üzerine sürükleyip bırakarak eklenir. Metin ve Markdown dosyaları görev belgesi olur (anahtar dosya adından üretilir ve rozet olarak gösterilir); geri kalan her şey dosya eki olur; ikisi de boyut bilgisi ve kaldırma düğmesiyle listelenir (`ui/src/components/NewIssueDialog.tsx:183-198`, `ui/src/components/NewIssueDialog.tsx:236-244`, `ui/src/components/NewIssueDialog.tsx:1115-1140`, `ui/src/components/NewIssueDialog.tsx:2038-2109`).
- Etiket çubuğu: durum (açıklamalı açılır menü: Backlog "Parked - assignee will not be woken" (bekletilir, atanan uyandırılmaz), Todo "Executable - assignee will be woken" (çalıştırılabilir, atanan uyandırılır), In Progress, In Review, Done) (`ui/src/components/NewIssueDialog.tsx:292-311`, `ui/src/components/NewIssueDialog.tsx:2116-2148`); Upload; çalışma modu (Auto, Plan, Ask) (`ui/src/components/NewIssueDialog.tsx:2214-2255`); henüz bir işleyicisi olmayan "Start date" ve "Due date" satırlarını içeren "..." (`ui/src/components/NewIssueDialog.tsx:2297-2304`). Görev etiketleri (labels) için bir düğme yalnızca yorum satırına alınmış kod olarak duruyor (`ui/src/components/NewIssueDialog.tsx:2190-2194`).
- Alt şeridin üstündeki notlar: atanan seçilmiş ama durum Backlog ise sarı bir not (`ui/src/components/NewIssueDialog.tsx:2309-2319`); atanan duraklatılmışsa uyarı (`ui/src/components/NewIssueDialog.tsx:2321-2328`); düşük güven düzeyli ajan notu (`ui/src/components/NewIssueDialog.tsx:2330-2340`).
- Alt şerit: solda "Discard Draft" (ghost), sağda hata metni ve birincil düğme. Düğmede "Create Task" / "Create Sub-Task", istek sürerken de dönen simgeyle "Creating..." yazar; sabit bir en az genişliği vardır, böylece zıplamaz (`ui/src/components/NewIssueDialog.tsx:2343-2372`).

### 6.2 Davranış

- Görev için başlık ya da açıklamadan biri yeterlidir, ikisi birden gerekmez: başlığın yer tutucusunda "optional" yazar ve gönderme yalnızca ikisi de boşken engellenir (`ui/src/components/NewIssueDialog.tsx:403`, `ui/src/components/NewIssueDialog.tsx:1038-1041`).
- Kısayollar: Cmd/Ctrl+Enter görevi oluşturur; Cmd/Ctrl+. çalışma modları arasında geçer (`ui/src/components/NewIssueDialog.tsx:366-369`, `ui/src/components/NewIssueDialog.tsx:1103-1113`). iOS, Cmd+. tuşunu Escape'e eşler; bu yüzden Cmd+Escape pencereyi kapatmaz, aynı biçimde ele alınır (`ui/src/components/NewIssueDialog.tsx:371-373`, `ui/src/components/NewIssueDialog.tsx:1387-1396`).
- Taslak: son değişiklikten 800 ms sonra, yalnızca metin varsa localStorage'daki `paperclip:issue-draft` anahtarına kaydedilir (`ui/src/components/NewIssueDialog.tsx:88-89`, `ui/src/components/NewIssueDialog.tsx:218-234`, `ui/src/components/NewIssueDialog.tsx:701-709`). Taslak şunları saklar: başlık, açıklama, durum, öncelik, atanan, inceleyen, onaylayan, gözcü, proje, çalışma alanı, model değişiklikleri ve çalışma modu (`ui/src/components/NewIssueDialog.tsx:160-181`). Pencere açılırken taslak yalnızca üst görev verilmemişse ve hazır bir başlık ya da açıklama yoksa geri yüklenir (`ui/src/components/NewIssueDialog.tsx:816-830`, `ui/src/components/NewIssueDialog.tsx:841-842`, `ui/src/components/NewIssueDialog.tsx:868-869`). Görev oluşturulunca ve "Discard Draft" seçilince silinir (`ui/src/components/NewIssueDialog.tsx:684`, `ui/src/components/NewIssueDialog.tsx:1032-1036`).
- Oluşturma isteği sürerken pencere Escape ile ya da dışına tıklanarak kapatılamaz (`ui/src/components/NewIssueDialog.tsx:1372-1374`, `ui/src/components/NewIssueDialog.tsx:1397-1405`).
- Oluşturma: `POST /companies/:id/issues`, içeriği `{ title?, description?, status, priority, workMode, assigneeAgentId | assigneeUserId, parentId?, goalId?, projectId?, projectWorkspaceId?, assigneeAdapterOverrides?, executionWorkspace*?, executionPolicy?, watchdog? }` (`ui/src/components/NewIssueDialog.tsx:1075-1100`). Ardından bekleyen dosyalar tek tek gönderilir (`PUT /issues/:id/documents/:key` ya da dosya eki yükleme). Yüklenemeyen dosyalar görevi başarısız kılmaz: "Open" eylemi olan bir "Created PAP-12 with upload warnings" uyarı bildirimi gösterilir (`ui/src/components/NewIssueDialog.tsx:635-688`).
- Başarıdan sonra: listeler ve kenar çubuğu rozetleri geçersiz kılınır, taslak silinir, pencere kapanır (`ui/src/components/NewIssueDialog.tsx:664-687`).
- Bayraklar: öncelik etiketini `SHOW_TASK_PRIORITY_UI` gizler (`ui/src/components/NewIssueDialog.tsx:2150-2188`); yürütme çalışma alanı seçim kutusu yalnızca çalışma alanı yalıtımı kontrolleri görünürken çıkar (`ui/src/components/NewIssueDialog.tsx:1878-1905`).

## 7. Görev sayfası

Yol `/issues/:issueId` (`ui/src/App.tsx:313`). `IssueDetail` yalnızca `TaskDetailSurface` bileşenini sarar; bu bileşen kodda "One controller and surface for both task URLs and agent conversations" (hem görev adresleri hem ajan sohbetleri için tek denetleyici ve tek ekran) diye tanımlanır (`ui/src/pages/IssueDetail.tsx:2969-2974`). Dosya 8.469 satırdır ve tamamı okundu.

### 7.1 İki arayüz

`useTaskDetailInterfaceMode`, `taskChatShellEnabled = !classicTaskInterfaceEnabled` ve `streamlinedTaskDetailEnabled = streamlinedUiEnabled && taskChatShellEnabled` değerlerini hesaplar (`ui/src/pages/IssueDetail.tsx:942-959`).

| | Sohbet kabuğu (varsayılan) | Klasik (`enableClassicTaskInterface`) |
|---|---|---|
| Akış bileşeni | `TaskChatThread` | `IssueChatThread` (`ui/src/pages/IssueDetail.tsx:1444-1446`) |
| Sayfa biçimi | akış ortayı doldurur; üst bölüm akışla birlikte kayar; yazma kutusu sabittir; sekmeli yan panel | `max-w-3xl space-y-6` ile alt alta dizilmiş bölümler; 320px'lik sabit "Properties" kenar çubuğu (`ui/src/pages/IssueDetail.tsx:7535-7551`; `ui/src/components/PropertiesPanel.tsx:26-45`) |
| Ortadaki sekmeler | yok; `resolvedDetailTab` her zaman "chat" (`ui/src/pages/IssueDetail.tsx:3035-3038`) | Chat, Activity, Related work ve eklenti sekmeleri (`ui/src/pages/IssueDetail.tsx:7824-7847`) |
| Açıklama | akışın ilk balonu (`ui/src/pages/IssueDetail.tsx:7893-7927`) | bölümlerin üstünde satır içi düzenleyici (`ui/src/pages/IssueDetail.tsx:7452-7475`) |
| Alt görevler, belgeler, çıktılar, dosya ekleri | yan panel sekmeleri | sayfada alt alta dizilmiş bölümler (`ui/src/pages/IssueDetail.tsx:7602-7805`) |
| Maliyet özeti, çalışma defteri, bağlı onay kartları, kurtarma kartı | çizilmez | Activity sekmesi ve akış (`ui/src/pages/IssueDetail.tsx:2628-2967`; `ui/src/components/IssueChatThread.tsx:6644`) |

Son satır, yeniden kurarken önemlidir. Varsayılan arayüzde görev sayfasında "Cost Summary" kutusu, çalışma defteri ve bağlı onayların listesi yoktur. `issuesApi.listApprovals`, `IssueRunLedger` ve görev düzeyindeki `getCostSummary` çağrısı yalnızca `IssueDetailActivityTab` içinde kullanılır (`ui/src/pages/IssueDetail.tsx:2643-2689`, `ui/src/pages/IssueDetail.tsx:2772-2963`); sohbet kabuğu açıkken bu sekmeye ulaşılamaz (`ui/src/pages/IssueDetail.tsx:3038`, `ui/src/pages/IssueDetail.tsx:7871`). Onların işini aşağıda anlatılan tur özetleri, işaretler, notlar ve yan panel sekmeleri üstlenir. Özellik kataloğu tersini de söyler: yalnızca sohbet arayüzünde bulunan özellikler (etkinliğin katlanması, akış içi plan ve soru kartları, üç modlu yazma kutusu) klasik görünümde yoktur (`packages/shared/src/feature-catalog.ts:163-170`).

Aksi belirtilmedikçe bu bölümün kalanı sohbet kabuğunu anlatır.

### 7.2 Yerleşim

```
+---------------------------------------------------------------+-------------------------+
| breadcrumb bar (Tasks > status glyph + title)      [panel]    |  side panel (resizable) |
+---------------------------------------------------------------+  [Properties][Tasks]... |
| scroll viewport (the only scrolling surface on desktop)       |  [+]                    |
|   max-w 60rem column, centred                                 |                         |
|   - header: status, title, identifier                         |  tab content            |
|   - meta row: Live, project, byline, ... more menu            |                         |
|   - banners (monitor, hidden, blocker notice)                 |                         |
|   - description bubble                                        |                         |
|   - messages, turns, markers, receipts                        |                         |
|   - live tail (running turn)                                  |                         |
|                                        (scroll-to-latest pill)|                         |
+---------------------------------------------------------------+                         |
| sticky dock, same 60rem column:                               |                         |
|   status island / queued messages tray / composer             |                         |
+---------------------------------------------------------------+-------------------------+
```

- Sayfa sarmalayıcısı: geniş ekranda `flex h-full min-h-0 w-full flex-col gap-3`; böylece "the outer page never scrolls" (dış sayfa hiç kaymaz) ve kayan tek alan akışın görünür alanı olur; telefonda `flex w-full flex-col gap-6` ve olağan belge kaydırması (`ui/src/pages/IssueDetail.tsx:7535-7551`).
- Akış gövdesi: `paperclip-mobile-thread mx-auto flex w-full max-w-(--tc-shell-max-w) flex-col px-1 py-3 md:px-4 md:py-4` (`ui/src/components/task-chat/TaskChatThreadView.tsx:426-433`). `--tc-shell-max-w` değeri `60rem`; sayfa sarmalayıcısını, akışı ve yazma kutusunu tek bir değişken sınırlar, "so they widen in lockstep" (birlikte genişlesinler diye) (`ui/src/index.css:375-377`).
- Üst bölüm kayan alanın içindedir ve mesajlarla birlikte yukarı kayıp gider; bu, yazma kutusunu tarayıcı penceresinin altına yakın tutar (`ui/src/components/task-chat/TaskChatThreadView.tsx:434-441`; `ui/src/index.css:368-373`).
- Yazma kutusu bölmesi (dock): `sticky`, alta sabitlenmiş, aynı en büyük genişlikte (`ui/src/components/task-chat/TaskChatComposerDock.tsx:11-28`).
- Yan panel: soldaki tutamaçla yeniden boyutlandırılır; varsayılan genişlik görev sayfasında 434px (başka yerlerde 322px), en az 260px; kenar çubuğu ile yaklaşık 420px'lik orta sütun için 656px kalacak noktadan öteye büyüyemez; tutamaca çift tıklamak genişliği sıfırlar; panel tam boyuta getirilebilir (içerik 840px ile sınırlanır); genişlik localStorage'da hatırlanır (`ui/src/components/PropertiesPanel.tsx:81-104`, `ui/src/components/PropertiesPanel.tsx:171`, `ui/src/components/PropertiesPanel.tsx:231-335`). `]` tuşu paneli açıp kapatır (`ui/src/hooks/useKeyboardShortcuts.ts:127-131`).
- Telefonda: panel, ekran yüksekliğinin %85'ini kaplayan, alttan açılan bir sayfaya dönüşür (`ui/src/pages/IssueDetail.tsx:8253-8397`); görev Gelen kutusundan açıldıysa telefondaki araç çubuğu geri, arşivle ve daha fazla düğmelerini sunar (`ui/src/pages/IssueDetail.tsx:1091-1182`, `ui/src/pages/IssueDetail.tsx:6223-6292`).

### 7.3 Üst bölüm

Başlık satırı (`ui/src/pages/IssueDetail.tsx:7040-7061`):

- Durum kontrolü: `onChange` verilmiş `StatusIcon size="lg"`; yani başlığın solundaki büyük simge durum seçicisidir (`ui/src/pages/IssueDetail.tsx:7023-7030`).
- Başlık: `min-w-0 text-xl font-semibold leading-normal text-balance` sınıflı `InlineEditor as="h2"`; tıklanınca düzenlenir, `PATCH /issues/:id { title }` ile kaydedilir (`ui/src/pages/IssueDetail.tsx:7047-7052`).
- Kimlik: `font-mono text-sm text-muted-foreground`; geniş ekranda başlığın hemen ardında, telefonda bilgi satırında durur (`ui/src/pages/IssueDetail.tsx:7053-7058`, `ui/src/pages/IssueDetail.tsx:7072-7076`).

Bilgi satırı (`flex min-w-0 flex-wrap items-center gap-2`, geniş ekranda `gap-x-6 pl-7`) (`ui/src/pages/IssueDetail.tsx:7063-7068`), sırasıyla:

| Öğe | Ne zaman | Görünüm | Kanıt |
|---|---|---|---|
| "Live" rozeti | görevin süren çalışması varsa | yanıp sönen 6px'lik mavi noktalı, çerçeveli rozet; sınıfları `bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400` | `ui/src/pages/IssueDetail.tsx:7090-7101`; `ui/src/lib/status-colors.ts:190` |
| "Routine" etiketi | görev bir rutin çalışmasından doğmuşsa | rutine bağlantı veren mor etiket | `ui/src/pages/IssueDetail.tsx:7103-7112` |
| "Watchdog" rozeti | üretilmiş bir gözcü göreviyse | gök mavisi çerçeveli rozet | `ui/src/pages/IssueDetail.tsx:7114-7123` |
| "Blocked by parked work" | bir engelleyen atanmış ama beklemede (backlog) ise | bayrak simgeli sarı rozet | `ui/src/pages/IssueDetail.tsx:7150-7160` |
| Proje | her zaman | nötr renkli kutu + ad ya da soluk "No project" | `ui/src/pages/IssueDetail.tsx:7169-7189` |
| Atıf satırı (byline) | her zaman | kimin oluşturduğu ve kimin için oluşturulduğu | `ui/src/pages/IssueDetail.tsx:7191-7196`, `ui/src/pages/IssueDetail.tsx:760-842` |

Üst bölümde çalışma modu etiketi bilerek yoktur: "mode is a per-request choice made in the composer ... a header chip would misread as a task-global setting" (mod, yazma kutusunda istek başına yapılan bir seçimdir; üst bölümdeki bir etiket görevin geneline ait bir ayar gibi anlaşılırdı) (`ui/src/pages/IssueDetail.tsx:7125-7128`).

More menüsü (`w-52 p-1` açılır menü): "Add subtask", "Copy as markdown", "Archive from inbox", duraklatma ve iptal satırları (bölüm 7.16), "Hide this task" (`ui/src/pages/IssueDetail.tsx:7307-7424`). "Copy as markdown", `# PAP-12: title` satırını ve açıklamayı kopyalar (`ui/src/pages/IssueDetail.tsx:6196-6221`).

Konum bilgisi: geri bağlantısı varsayılan olarak "Tasks" (`/issues`) ya da kullanıcının geldiği listedir (liste, etiketini ve URL'sini yönlendirici durumu üzerinden aktarır); geçerli öğe durum simgesini taşır (`ui/src/pages/IssueDetail.tsx:3347-3354`, `ui/src/pages/IssueDetail.tsx:5518-5551`; `ui/src/pages/Inbox.tsx:840-848`).

### 7.4 Veri ve uç noktalar

| Veri | İstek | Yenileme | Kanıt |
|---|---|---|---|
| Görev | `GET /issues/:id` (id ya da görev kimliği). Liste satırı yer tutucu olarak bir anlık kopya aktarır; böylece üst bölüm hemen çizilir | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:3101-3116`; `ui/src/components/IssueRow.tsx:193`, `ui/src/components/IssueRow.tsx:233-241` |
| Yorumlar | sonsuz sorgu, `GET /issues/:id/comments?order=desc&limit=50&after=<cursor>` | geçersiz kılma; en çok 3 sayfa kendiliğinden yüklenir, sonra "Load earlier comments" düğmesi çıkar | `ui/src/pages/IssueDetail.tsx:3165-3192`, `ui/src/pages/IssueDetail.tsx:439`, `ui/src/pages/IssueDetail.tsx:2382-2396`; `ui/src/lib/optimistic-issue-comments.ts:10`; `ui/src/api/issues.ts:356-372` |
| Etkileşimler | `GET /issues/:id/interactions` | biri hâlâ hazırlanıyorsa 20 saniyede bir | `ui/src/pages/IssueDetail.tsx:3245-3260` |
| Dosya ekleri | `GET /issues/:id/attachments` | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:3262-3274` |
| Çıktılar | `GET /issues/:id/work-products[?refreshPullRequests=true]` | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:3276-3308` |
| Görevin süren çalışmaları | `GET /issues/:id/live-runs` | sayfada 3 saniyede bir, sohbet sekmesinin içinde 1 saniyede bir | `ui/src/pages/IssueDetail.tsx:3310-3321`, `ui/src/pages/IssueDetail.tsx:1468-1475`; `ui/src/api/heartbeats.ts:229-230` |
| Etkin çalışma (active run) | `GET /issues/:id/active-run` | yalnızca bilinen bir süren çalışma yokken yoklanır | `ui/src/pages/IssueDetail.tsx:3323-3337`, `ui/src/pages/IssueDetail.tsx:1478-1493` |
| Sıradaki mesajlar | `GET /issues/:id/queued-comments` | koşullu aralıkla | `ui/src/pages/IssueDetail.tsx:1519-1529` |
| Göreve bağlı çalışmalar | `GET /issues/:id/runs` | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:1570-1577`; `ui/src/api/activity.ts:80` |
| Alt ağaçtaki bütün görevler | `GET /companies/:id/issues?descendantOf=<id>&includeBlockedBy=true` isteğinin bütün sayfaları (sayfa başına 500, id'ye göre keyset sayfalama) | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:3356-3376`; `ui/src/api/issues.ts:163-174` |
| Bu görevden oluşturulan görevler | `...issues?createdFromIssueId=<id>` | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:3377-3387` |
| Söz etme (mention) havuzu | en son güncellenen 100 görev, 60 saniye sonra bayat sayılır | | `ui/src/pages/IssueDetail.tsx:3446-3461` |
| Duraklatma durumu | `GET /issues/:id/tree-control/state`, bekletme (hold) listesi | geçersiz kılma | `ui/src/pages/IssueDetail.tsx:3544-3596`; `ui/src/api/issues.ts:303-336` |
| Yalnızca klasik Activity sekmesi | `GET /issues/:id/activity`, `/runs`, `/approvals`, `/cost-summary` | | `ui/src/pages/IssueDetail.tsx:2643-2689` |

Derin bağlantılar: `#comment-<id>` bir mesaja kaydırır (çapalar `id="comment-<id>"` olarak çizilir) (`ui/src/pages/IssueDetail.tsx:3218-3226`; `ui/src/components/task-chat/TaskChatThreadView.tsx:370`); `#document-<key>` bir belge sekmesi açar; `#work-product-...` ve `#attachment-...` ilgili öğeye kaydırır ve onu 3 saniye boyunca halkayla vurgular (`ui/src/pages/IssueDetail.tsx:5999-6069`, `ui/src/pages/IssueDetail.tsx:6126-6160`).

### 7.5 Akış modeli

Akış düz bir yorum listesi değildir. Birkaç kaynaktan tipli öğeler hâlinde bir araya getirilir (`ui/src/components/task-chat/task-chat-model.ts:572-587`): `brief` (açıklama), `message`, `turn`, `activity_phase`, `tool`, `thinking`, `status`, `marker`, `interaction`, `plan_document`, `protocol` (kaynaklar, dosya değişiklikleri, çalışma sonuçları), `usage`; bunlara tarayıcı oturumları ile oluşturulan projeler ya da skill'ler için kartlar eklenir.

Birleştirme adımları (`ui/src/components/TaskChatThread.tsx`):

1. Zamana göre dizilmiş bir omurga: yorumlar, etkileşimler, plan dışındaki belgeler, çıktılar ve ajan dosya ekleri (kaynak satırları olarak), plan belgesi ve oluşturma kartları; önce zaman damgasına, sonra sıraya, sonra id'ye göre sıralanır (`ui/src/components/TaskChatThread.tsx:1176-1407`, sıralama `ui/src/components/TaskChatThread.tsx:1383-1385`).
2. Biten her çalışma bir "turn" (tur) olur. Tur, çalışmanın ürettiği yoruma bağlanır; yanıt bırakmayan çalışmalar başlangıç zamanına göre yerleştirilir (`ui/src/components/TaskChatThread.tsx:1476-2142`; `ui/src/components/task-chat/transcript-adapter.ts:1879-1905`).
3. Aynı ajanın art arda gelen turları tek satırda birleştirilir; kendi ajanının yanıtını izleyen tur da o balona iliştirilir (`ui/src/components/task-chat/transcript-adapter.ts:1934-2043`).
4. Hâlâ süren tur ayrı olarak, "tail" (akışın sonu) diye çizilir; böylece içerik akarken yerleşmiş geçmiş yeniden kurulmaz (`ui/src/components/task-chat/TaskChatThreadView.tsx:332-425`).

Çizim kuralları:

- Boşluk komşu öğelere göre değişir: sistem benzeri iki öğe yan yanaysa `mt-2`; bir sistem öğesinin ya da turun yanında `mt-3`; etkileşimlerde `mt-4`; geri kalan her şeyde `mt-6` (`ui/src/components/task-chat/TaskChatThreadView.tsx:277-290`).
- İnsan mesajı: sağa yaslı balon, `max-w-(--pct-85) rounded-2xl rounded-br-sm bg-(--liveness-blue) px-3.5 text-white`. Ajan mesajı: balon yok, metin sayfanın üzerinde, `w-full bg-transparent px-1 text-foreground`; 24px'lik simge ve ad satırının altında durur (`ui/src/components/task-chat/TaskChatBubble.tsx:77-95`, `ui/src/components/task-chat/TaskChatBubble.tsx:241-246`). İkisi de `py-2 text-sm`.
- Zaman bilgisi her zaman görünür; 11px, soluk, "2:34 PM" biçiminde (`ui/src/components/task-chat/TaskChatBubble.tsx:415-422`; `ui/src/components/task-chat/task-chat-adapter.ts:50-55`).
- Gönderilmekte olan mesajda "Sending…" yazar; süren çalışmayı bekleyen mesajda "Queued" yazısı ve bir "Interrupt" bağlantısı görünür (`ui/src/components/task-chat/TaskChatBubble.tsx:378-382`; `ui/src/components/TaskChatThread.tsx:2641-2661`).
- Mesajdaki görseller: dört sütunlu bir ızgara, sığmayanlar için "+N"; diğer dosyalar "Files · N" başlığı altında etiketler olarak gösterilir (`ui/src/components/task-chat/TaskChatBubble.tsx:264-352`).
- Sistem yorumları (yazar türü `system` ya da sunum türü `system_notice`) tek satırlık notlardır: ton simgesi, başlık, kısa ayrıntı, göreli zaman, ok; açılınca markdown gövdesi ve üst veri satırları görünür (`ui/src/components/task-chat/task-chat-adapter.ts:31-47`; `ui/src/components/task-chat/TaskChatSystemNotice.tsx:91-171`).
- İşaretler, etiketli ince ayırıcı çizgilerdir: "Run failed", "Run cancelled", "Run interrupted", "Run timed out", "Usage limit reached", "Approval required", "Waiting to resume", "Stopped", "Couldn't start" (`ui/src/components/TaskChatThread.tsx:1553`, `ui/src/components/TaskChatThread.tsx:1637-1648`, `ui/src/components/TaskChatThread.tsx:1741`). Hata işaretleri kesikli, destructive renkli bir çizgi kullanır ve "View run" ile "Try again" bağlantılarını sunabilir (`ui/src/components/task-chat/TaskChatMarker.tsx:43-178`).
- Hiç yanıt bırakmadan biten çalışma da iz bırakır: "Run completed" ve "The runner returned no user-facing response." (çalıştırıcı kullanıcıya dönük bir yanıt döndürmedi) (`ui/src/components/TaskChatThread.tsx:1816-1817`, `ui/src/components/TaskChatThread.tsx:1848-1849`).
- Açıklama ilk balondur; 240px'te katlanır, boşsa soluk bir "Add a description..." yazısı görünür (`ui/src/components/task-chat/TaskChatDescriptionBubble.tsx:92-136`).
- Engelleyenler en üstte listelenir ("Blocked by", "Root blocker"); yazışmada dört ya da daha fazla öğe olunca en altta yinelenir ("Still blocked by"); ayrıca bir "Waiting on live work" listesi vardır (`ui/src/components/task-chat/TaskChatBlockerLinks.tsx:186-266`; `ui/src/components/TaskChatThread.tsx:247-257`).

Ekran durumları: yüklenirken balon biçiminde yükleme iskeleti (`ui/src/components/TaskChatThread.tsx:2924-2938`); boşken "No messages yet." (`ui/src/components/TaskChatThread.tsx:513`, `ui/src/components/TaskChatThread.tsx:2965-2967`); bir yan sorgu hata verince "Retry" düğmesiyle "Some task history could not be loaded." (`ui/src/components/TaskChatThread.tsx:2913-2923`).

Kaydırma (`ui/src/components/task-chat/TaskMessageScroller.tsx`): görünüm, alta 48px'ten yakınsa sabitlenmiş sayılır (`ui/src/components/task-chat/TaskMessageScroller.tsx:9`, `ui/src/components/task-chat/TaskMessageScroller.tsx:92`). Sabitlenmişse yeni içerik hemen izlenir. Sabitlenmemişse konum korunur ve yuvarlak bir "Scroll to latest" düğmesi belirir; tıklanınca görünüm yumuşakça aşağı kayar, herhangi bir tekerlek ya da dokunma hareketi bu kaymayı iptal eder (`ui/src/components/task-chat/TaskMessageScroller.tsx:146-218`, `ui/src/components/task-chat/TaskMessageScroller.tsx:283-301`). Eski mesajlar yüklenirken görünen çapa yerinde kalır (`ui/src/components/task-chat/TaskMessageScroller.tsx:127-144`).

### 7.6 Ajan çalışmasının gösterimi

Ayrıntı basamak basamak açılır, en azdan en çoğa:

| Basamak | Kullanıcının gördüğü | Kanıt |
|---|---|---|
| 0 | Ajanın yanıtı, düz metin olarak | `ui/src/components/task-chat/TaskChatBubble.tsx:241-246` |
| 1 | Yanıtın altında tek bir soluk satır: zaman, onay işareti simgesi ve "Worked" (ya da bir X ve "Stopped"). Üzerine gelince ya da açıkken "38s · 3 tools · +34 −3 · 12.3k tokens" gibi ölçümleri de gösterir | `ui/src/components/task-chat/TaskChatTurn.tsx:30-51`, `ui/src/components/task-chat/TaskChatTurn.tsx:183-237`; `ui/src/components/task-chat/transcript-adapter.ts:1791-1832` |
| 2 | Satıra tıklanınca tur aşamalara açılır (CSS grid satırları 380 ms içinde 0fr değerinden 1fr değerine geçer). Her aşama, ajanın kendi kısa notu ile "Read files, ran commands, and more" gibi tek satırlık bir özetten oluşur | `ui/src/components/task-chat/TaskChatTurn.tsx:157-163`, `ui/src/components/task-chat/TaskChatTurn.tsx:270-282`; `ui/src/index.css:302`, `ui/src/index.css:1000-1008`; `ui/src/components/task-chat/TaskChatRunnerActivityGroup.tsx:307-405`; `ui/src/components/task-chat/completed-activity-summary.ts:11-26`, `ui/src/components/task-chat/completed-activity-summary.ts:120-131` |
| 3 | Bir özete tıklanınca: "N activities" ve `[icon] [verb] [target in mono] ... [status icon]` biçiminde sıralı bir satır listesi, örneğin "Read a file", "Ran a command" | `ui/src/components/task-chat/TaskChatRunnerActivityGroup.tsx:381-399`; `ui/src/components/task-chat/TaskChatToolCard.tsx:38-103`; `ui/src/components/task-chat/tool-taxonomy.ts:155-230` |
| 4 | Bir satıra tıklanınca: hedef, `<pre>` içinde çıktı, fark sayıları, izin sonucu | `ui/src/components/task-chat/TaskChatRunnerActivityGroup.tsx:210-240`; `ui/src/components/task-chat/TaskChatToolCard.tsx:104-134` |
| 5 | "View run", tam dökümü, ham kaydı ve olayları içeren çalışma sayfasını açar (bölüm 8) | `ui/src/components/task-chat/TaskChatMarker.tsx:43-129` |

Ayrıntılar:

- Araç adları, ailelerden oluşan bir sınıflandırma (terminal, read, edit, search, web, plan, question, agent, mcp, ...) üzerinden düz fiillere çevrilir. Başarısız çağrı "<verb> · failed", yarıda kesilen çağrı "<verb> · stopped" diye yazılır (`ui/src/components/task-chat/tool-taxonomy.ts:29-43`, `ui/src/components/task-chat/tool-taxonomy.ts:363-421`).
- Özet hiçbir zaman başarı ileri sürmez: "Describe observed activities, never infer success from a finished group" (gözlenen etkinlikleri anlat, biten bir gruptan başarı sonucu çıkarma) (`ui/src/components/task-chat/completed-activity-summary.ts:28`). Başarısız bir okuma "Checked files", başarısız bir düzenleme "Worked on files" olur (`ui/src/components/task-chat/completed-activity-summary.ts:101-110`).
- Geçmiş bileşeni ancak ilk açıldığında mount edilir (`ui/src/components/task-chat/TaskChatTurn.tsx:157-163`).

Çalışma sürerken:

- Akışın sonunda bir durum satırı: yanıp sönen 8px'lik nokta, parıldayan bir etiket, geçen süre, isteğe bağlı ayrıntı ve bağlam kullanımı (`ui/src/components/task-chat/TaskChatStatusPill.tsx:318-363`). Paperclip'in kendi çalıştırıcısında başlık önce "Working for 12s", sonra "Worked for ..." ya da "Stopped after ..." olur (`ui/src/components/task-chat/TaskChatRunnerTurn.tsx:64-108`); başka bir şey bilinmiyorsa parıldayan bir "Thinking" yazısı görünür (`ui/src/components/task-chat/TaskChatRunnerTurn.tsx:110-115`).
- O anki etkinlik, yerinde değişen tek bir kayan satırdır (`RollingActivity`); yanında sayı durur; hareketi azaltma tercihi kaymayı kapatır (`ui/src/components/task-chat/TaskChatRunnerActivityGroup.tsx:159-208`, `ui/src/components/task-chat/TaskChatRunnerActivityGroup.tsx:369-377`).
- Ajanın ara notları okunabilsin diye en az 4 saniye ekranda tutulur (`ui/src/index.css:305`; `ui/src/components/task-chat/TaskChatStatusPill.tsx:147-250`).
- Paperclip'in kendi çalıştırıcısı dışındaki adaptörlerde daha yalın bir etiket kullanılır: "Working for <time>" ve "ran N commands, called M tools"; çıktı gelmeden önce "Waiting to start..." ya da "Waiting for transcript..." yazar (`ui/src/components/task-chat/TaskChatLiveRunPill.tsx:18-35`, `ui/src/components/task-chat/TaskChatLiveRunPill.tsx:60-94`; `ui/src/components/TaskChatThread.tsx:3062-3070`).
- Yazma kutusunun üstünde küçük, yuvarlak köşeli bir "island" (ada) "Step 2 / 5" ve "N files changed +a −d" bilgisini gösterir; üzerine gelince ya da tıklanınca kontrol listesi açılır (`ui/src/components/task-chat/TaskChatTurnStatusIsland.tsx:121-279`).
- Çalışma bitince akışın sonundaki canlı satır, yanıt yorumu gelene kadar en çok 15 saniye ekranda tutulur; böylece akışta "çalışıyor" ile yanıt arasında hiç boşluk görünmez (`ui/src/components/TaskChatThread.tsx:245`, `ui/src/components/TaskChatThread.tsx:991-1012`, `ui/src/components/TaskChatThread.tsx:2147-2192`).
- Olay akışı koparsa: "Live runner activity is temporarily unavailable. Retrying…" (canlı çalıştırıcı etkinliği geçici olarak alınamıyor, yeniden deneniyor) (`ui/src/components/task-chat/TaskChatRunnerTurn.tsx:227-235`).

Dökümün kaynakları: Paperclip'in kendi çalıştırıcısının olayları ya da adaptörün `TranscriptEntry` öğelerine ayrıştırdığı kayıt parçaları (assistant, thinking, tool_call, tool_result, token ve maliyet içeren result, stderr, system, diff, ...) (`ui/src/components/TaskChatThread.tsx:914-978`; `packages/adapter-utils/src/types.ts:647-664`). Kayıt yoklaması: 2 saniyede bir, okuma başına 256 KB, gerçek zamanlı bağlantı açıkken yedek olarak 30 saniyede bir, çalışma başına 2 MB saklanır (`ui/src/components/transcript/useLiveRunTranscripts.ts:26-47`).

### 7.7 Yazma kutusu

Kutu: `rounded-(--radius-task-composer) border border-border bg-card p-(--sz-18px) shadow-(--shadow-task-composer)`, köşe yarıçapı 16px (`ui/src/components/task-chat/TaskChatComposer.tsx:1183-1189`; `ui/src/index.css:333`).

```
[ rich text input, min 48px, max 28dvh                                  ]
[ attachment chips                                                       ]
[+] [mode chip]                               [assignee / model] (send)
```

- Giriş alanı: ortak `MarkdownEditor`, kenarlıksız, `text-sm` (telefonda 16px) (`ui/src/components/task-chat/TaskChatComposer.tsx:1269-1297`).
- `@` ile söz etme: ajanlar, projeler, kullanıcılar, görevler. `/` ile komutlar: şirket skill'leri, rutinler ve düzenleyiciye özel eylemler (görevde `/goal`, ajan sohbetinde `/new`) (`ui/src/components/MarkdownEditor.tsx:65-78`, `ui/src/components/MarkdownEditor.tsx:281-282`, `ui/src/components/MarkdownEditor.tsx:354-380`; `ui/src/context/EditorAutocompleteContext.tsx:9-80`; `ui/src/components/task-chat/TaskChatComposer.tsx:1280-1284`).
- Yer tutucu metin moda göre değişir ve ajanın adını içerir: mesaj, plan ya da soru (`ui/src/components/task-chat/TaskChatComposer.tsx:283-297`).
- "+" menüsü: "Files and images", "Goal" (hedefi izlemeyi sürdür), "Plan mode" (harekete geçmeden önce planla), "Ask mode" (değişiklik yapmadan yanıtla) (`ui/src/components/task-chat/ComposerAddMenu.tsx:44-51`). Seçilen mod kaldırılabilir bir etiket olarak görünür; Cmd/Ctrl+. ve Shift+Tab modlar arasında geçer; bu tuşlar sarmalayıcıda yakalandığı için odak düzenleyicideyken de çalışır (`ui/src/components/task-chat/TaskChatComposer.tsx:1190-1205`).
- Yazma kutusunun içinde atanan ve model seçici bulunur: bir mesaj aynı adımda görevi başkasına da atayabilir. Bu yol `PATCH /issues/:id` isteğini `{ comment, commentClientRequestId, attachmentIds, assigneeAgentId, assigneeUserId, assigneeAdapterOverrides, status, interrupt }` içeriğiyle kullanır (`ui/src/pages/IssueDetail.tsx:5003-5203`).
- Gönder düğmesi: `size-8 rounded-full bg-foreground text-background`, yukarı ok simgesi, title metni "Send (⌘+Enter)". Çalışma sürerken ve kutu boşken aynı düğme Durdur düğmesi olur (kare simge, title metni "Stop response") (`ui/src/components/task-chat/TaskChatComposer.tsx:812-817`, `ui/src/components/task-chat/TaskChatComposer.tsx:1486-1546`).

Gönderme (`ui/src/components/task-chat/TaskChatComposer.tsx:831-1041`; `ui/src/pages/IssueDetail.tsx:4631-4802`):

1. Kutu hemen boşalır ve mesaj ağ beklenmeden akışta çizilir. Kesilebilecek bir çalışma varsa istemcideki durumu "queued", yoksa "pending" olur.
2. `POST /issues/:id/comments { body, clientRequestId, reopen?, interrupt?, attachmentIds? }` (`ui/src/api/issues.ts:516-533`). Atananı ajan olan bitmiş, iptal edilmiş ya da engellenmiş bir göreve yazmak, görevi yeniden açmak anlamına gelir (`ui/src/components/task-chat/TaskChatComposer.tsx:319-328`).
3. Hata olursa metin ve dosya ekleri kutuya geri döner.
4. İsteğin sonucu bilinmiyorsa (gönderdikten sonra ağ koptuysa) yazma kutusu tahmin yürütmez. Kaydı doğrulayamadığını söyleyen bir uyarı ile "Review conversation" ve "Discard draft and start new" düğmelerini gösterir; kullanıcı karar verene kadar salt okunur kalır (`ui/src/components/task-chat/TaskChatComposer.tsx:1208-1245`); sayfa da bir "Comment save unconfirmed" bildirimi gösterir (`ui/src/pages/IssueDetail.tsx:4776`).

Dosya ekleri: yapıştırılan ya da bırakılan görseller metnin içine yüklenir; diğer dosyalar etiket olur; bir yükleme sürerken ya da biri başarısız olduktan sonra gönderme engellenir (düğmenin title metinleri "Waiting for upload to finish", "Remove the failed attachment to send") (`ui/src/components/task-chat/TaskChatComposer.tsx:645-746`, `ui/src/components/task-chat/TaskChatComposer.tsx:786-799`, `ui/src/components/task-chat/TaskChatComposer.tsx:1310-1369`, `ui/src/components/task-chat/TaskChatComposer.tsx:1508-1512`). Dosya bağlantıları mesaj gövdesinin sonuna markdown bağlantısı olarak eklenir (`ui/src/components/task-chat/TaskChatComposer.tsx:915-922`). Görevin üzerine bırakılan Markdown dosyaları ise görev belgesi olarak içe aktarılır (`ui/src/pages/IssueDetail.tsx:5402-5431`).

Taslak: localStorage'da `paperclip:issue-comment-draft:<issueId>` anahtarında saklanır; yazma durduktan 800 ms sonra, ayrıca bileşen kaldırılırken ve `beforeunload` olayında yazılır (`ui/src/pages/IssueDetail.tsx:8021`; `ui/src/lib/composer-draft.ts:12`; `ui/src/components/task-chat/TaskChatComposer.tsx:574-604`).

Durdurma ile duraklatma farklı şeylerdir. Durdurma o anki çalışmayı iptal eder (`POST /heartbeat-runs/:runId/cancel`) ve yazma kutusunu yerinde bırakır (`ui/src/pages/IssueDetail.tsx:4403-4412`; `ui/src/api/heartbeats.ts:205-206`). Ek seçenekler olan "Stop and cancel" ve "Stop and done" görev durumunu da değiştirir (`ui/src/pages/IssueDetail.tsx:4413-4471`, `ui/src/pages/IssueDetail.tsx:6404-6442`). Duraklatma bir görev ya da alt ağaç eylemidir (bölüm 7.16); görev duraklatılmışken yazma kutusunun yerini sarı bir blok alır: "Task is paused.", "Resume this task to send a message.", "Your draft is saved." ve "Resume task" düğmesi (`ui/src/components/task-chat/TaskChatPausedTakeover.tsx:28-72`). Bu kurallar `DESIGN.md` içinde de yazılıdır (bağlama göre geri bildirim bölümü).

### 7.8 Sıradaki mesajlar

Çalışma sürerken yazılan mesajlar sunucudaki bir kuyrukta bekler. `GET /issues/:id/queued-comments` şunu döndürür: `{ queueId, state: deferred | queued, targetRunId, revision, protocol: paperclip_runner_v1 | legacy, steeringDisposition, entries[{ comment, position, canEdit, canDiscard }] }` (`packages/shared/src/types/issue.ts:980-1019`).

Arayüz: yazma kutusunun üst kenarına bitişik bir tepsi, `mx-3 -mb-px rounded-t-xl rounded-b-none border border-b-0 bg-card shadow-sm` (`ui/src/components/task-chat/TaskChatQueuedMessages.tsx:379-384`). Her satır 44px'tir: sürükleme tutamacı, metin, "Steer" (eski protokolde "Interrupt"), silme düğmesi ve "Edit message" içeren bir menü (`ui/src/components/task-chat/TaskChatQueuedMessages.tsx:117-222`).

| Eylem | İstek | Kanıt |
|---|---|---|
| Yeniden sıralama (sürükleyerek) | `PUT /issues/:id/queued-comments/order { orderedCommentIds, queueId, revision }` | `ui/src/api/issues.ts:384-391` |
| Süren tura iletme (steer) | `POST /issues/:id/queued-comments/:commentId/steer { queueId, targetRunId, revision }` | `ui/src/api/issues.ts:405-413` |
| Çalışmayı kesip hemen gönderme | `POST /issues/:id/queued-comments/interrupt { queueId, targetRunId, revision }` | `ui/src/api/issues.ts:392-395` |
| Düzenleme | `PATCH /issues/:id/queued-comments/:commentId { body, queueId, revision }` | `ui/src/api/issues.ts:375-383` |
| Silme | `DELETE /issues/:id/queued-comments/:commentId` | `ui/src/api/issues.ts:414-422` |

Her değişiklik isteği `revision` değerini geri gönderir; böylece eski veriyle kalmış bir tarayıcı daha yeni bir kuyruğun üzerine yazamaz (`packages/shared/src/types/issue.ts:1001-1006`). Çakışma olursa arayüz sunucudaki sırayı geri yükler ve bunu söyler (`ui/src/components/task-chat/TaskChatQueuedMessages.tsx:264-303`); çok geç gelen bir silme isteği düz bir mesajla reddedilir (`ui/src/components/task-chat/TaskChatQueuedMessages.tsx:305-375`). Düzenleme, metni yazma kutusuna yükler; kutuda "Editing queued message" yazısı, "Cancel" ve bir kaydetme eylemi görünür (`ui/src/components/task-chat/TaskChatComposer.tsx:1391-1396`, `ui/src/components/task-chat/TaskChatComposer.tsx:1476-1502`). Sıradaki bir mesajı iptal etmek, metnini yazma kutusuna geri koyar ve bir bildirim gösterir (`ui/src/pages/IssueDetail.tsx:5217-5248`).

### 7.9 Sorular ve onay istekleri

Ajan bir girdiye ihtiyaç duyduğunda bir akış etkileşimi oluşturur (bölüm 2.12). Bekleyen etkileşimler geçmişin ortasında durmaz. Yazma kutusunun alanını devralırlar: `rounded-xl border border-border bg-card p-(--sz-18px) shadow-sm` sınıflı bir kart; üzerinde bir sayı ("N pending"), kapatma X'i ve "Skip" bulunur (`ui/src/components/task-chat/TaskChatComposer.tsx:1120-1182`; `ui/src/components/TaskChatThread.tsx:2430-2554`). Kullanıcı kartı kapatırsa olağan yazma kutusu geri gelir ve yanında küçük bir "N pending input(s)" düğmesi kalır (`ui/src/components/task-chat/TaskChatComposer.tsx:1246-1261`; `ui/src/components/TaskChatThread.tsx:3189-3197`). Geçmişte bekleyen bir etkileşim en fazla tek satırdır ("Unanswered question", "Review request"); plan onayları ayrıca planın ön izlemesini gösterir (`ui/src/components/task-chat/TaskChatInteractionCard.tsx:48-115`). Yanıtlandıktan sonra etkileşim tek satırlık bir kayda dönüşür; bu kayıt "View original request and resolution" ile açılır (`ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:367-650`). [Düzeltme (asıl belge 6.5 ve 15.3): kart yazma kutusunun yerini almaz; hemen üstünde durur ve yazma kutusu kartın altında kullanılabilir kalır (`ui/src/components/task-chat/TaskChatComposer.tsx:1114-1186`, `DESIGN.md:73-76`). Kod bu karta "takeover" adını verir; ad yanıltıcıdır.]

| Tür | İçerik (ana alanlar) | Kart | Yanıtlama |
|---|---|---|---|
| `ask_user_questions` | `title, submitLabel, questions[{ id, prompt, helpText, selectionMode, required, options[] }]`, isteğe bağlı olarak daha zengin `questionSet` (`packages/shared/src/types/issue.ts:1152-1231`) | Her sayfada bir soru, "1 of N" yazısı ve oklar; seçenekler radyo düğmeli ya da onay kutulu satırlardır, önerilen seçenek "Recommended" etiketi taşır; "Other" bir metin kutusu açar; doğrulamalı metin soruları; 8 seçeneğin üstünde süzme alanı; 1-9 rakam tuşları seçenek seçer; isteğe bağlı sorular için "Skip"; "Next", sonunda "Submit answers" (`ui/src/components/task-chat/QuestionForm.tsx:115-188`, `ui/src/components/task-chat/QuestionForm.tsx:451-483`, `ui/src/components/task-chat/QuestionForm.tsx:498-516`, `ui/src/components/task-chat/QuestionForm.tsx:589-608`, `ui/src/components/task-chat/QuestionForm.tsx:669-706`) | `POST /issues/:id/interactions/:iid/respond { answers[{ questionId, optionIds, otherText }], summaryMarkdown? }` (`ui/src/api/issues.ts:459-470`) |
| `request_confirmation` | `prompt, acceptLabel, rejectLabel, rejectRequiresReason, detailsMarkdown, target, toolAction?, secretProposal?` (`packages/shared/src/types/issue.ts:1383-1398`) | İstek metni, isteğe bağlı ayrıntılar, "Reject" (ghost) ve "Approve" (birincil). Reddetme, "Back" düğmeli bir "What should change?" gerekçe alanı açabilir (`ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:857-1056`) | `.../accept { rememberAction? }` ya da `.../reject { reason? }` (`ui/src/api/issues.ts:431-448`) |
| `request_checkbox_confirmation` | `prompt, options[], defaultSelectedOptionIds, minSelected, maxSelected` (`packages/shared/src/types/issue.ts:1400-1422`) | En az ve en çok seçim sayısını belirten bir notla onay kutusu listesi, "Decline" ve "Confirm selection" (`ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:1059-1295`) | `.../accept { selectedOptionIds }` |
| `suggest_tasks` | `tasks[{ clientKey, parentClientKey, title, description, assigneeAgentId, projectId, ... }]` (`packages/shared/src/types/issue.ts:1111-1132`) | "Select the tasks to create.", onay kutulu bir ağaç, "N of M selected", "Create selected", "Revise", "Send back" (`ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:1349-1551`) | `.../accept { selectedClientKeys }` |
| `request_item_verdicts` | `prompt, items[{ id, label, description, previewMarkdown, href }], verdicts, requireReasonOn` (`packages/shared/src/types/issue.ts:1424-1446`) | Kalemler tek tek gösterilir; her kalem için onay ya da ret, gerekiyorsa gerekçe, "Apply N" (`ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:1559-1875`) | `POST .../verdicts { verdicts[{ id, verdict: approve \| reject \| defer, reason }] }` (`ui/src/api/issues.ts:471-483`) |
| `connection_intent` | servis adı ve logosu, isteyen ajan, aşama (`packages/shared/src/types/issue.ts:1352-1371`) | "Connect service" kartı | yönetim kurulu uç noktaları |

Diğer uç noktalar: `.../cancel`, `.../skip` (`ui/src/api/issues.ts:449-458`).

Araç eylemi onayı, `request_confirmation` türünün özel bir hâlidir ve Paperclip'te dışa etkili eylemler için Onay Masası'na en yakın şeydir. İçeriğe bir `toolAction` bloğu eklenir: `toolName, toolDisplayName, appDisplayName, risk: read | write | destructive, previewMarkdown, argumentsSummaryJson, argumentsHash, expiresAt, rememberActionScope?` (`packages/shared/src/types/issue.ts:1278-1299`). Kart şunları gösterir: kalın yazıyla araç adı, "<risk> risk" (destructive için kırmızı), "Expires <date>", markdown olarak ön izleme ve JSON ile özet değerini içeren, "Arguments and audit hash" adlı kapalı bir `<details>` öğesi (`ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:883-919`). Onaylamak çalıştırmak demektir: sonuç durumları `approved, executing, executed, failed, expired` olur, "never a bare accepted" (hiçbir zaman yalnızca accepted değil) (`packages/shared/src/types/issue.ts:1312-1326`). [Düzeltme (asıl belge 6.5 ve 15.3): görev sayfasında araç eylemi onayı bu karta düşmez. `ui/src/components/task-chat/TaskChatInteractionCard.tsx:66-84` araç eylemlerini `IssueThreadInteractionCard` bileşenine yollar. İnsanın gördüğü kartta uygulamanın logosu, ön izleme metni, "Decline" ve "Approve & run" düğmeleri, kural kaydedilebiliyorsa "Always allow" seçeneği vardır (`ui/src/components/IssueThreadInteractionCard.tsx:1690-1766`). Burada anlatılan risk etiketi, bitiş tarihi ve "Arguments and audit hash" bölümü o kartta yoktur.]

Kopyalamaya değer ayrıntılar:

- Seçenek işaretlemek hiçbir zaman sonraki soruya geçirmez: "Moving on stays an explicit act ... so a misclick never costs the reader the page they were still reading" (ilerlemek açık bir eylem olarak kalır; yanlış bir tıklama okuyana hâlâ okuduğu sayfayı kaybettirmez) (`ui/src/components/task-chat/QuestionForm.tsx:354-356`).
- Gönderirken zorunlu bir yanıt eksikse form o soruya atlar ve "Question 2 needs an answer before you can send." der (`ui/src/components/task-chat/QuestionForm.tsx:383-392`).
- Başarısız bir gönderimin hatası bir sonraki gönderime kadar görünür kalır; yalnızca "eksik yanıt" mesajı, soru yanıtlanınca silinir (`ui/src/components/task-chat/QuestionForm.tsx:33-41`, `ui/src/components/task-chat/QuestionForm.tsx:358-361`).
- Yarım kalan yanıtlar ve ret gerekçeleri etkileşim başına taslak olarak saklanır (`ui/src/components/task-chat/QuestionForm.tsx:246-298`; `ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:820-836`).
- Sunucu bir onay için çalışma alanını hâlâ hazırlıyorsa "Approve" devre dışı kalır ve bir not gösterilir (`acceptanceBlocker`; `packages/shared/src/types/issue.ts:1519-1520`; `ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:818`, `ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:992`, `ui/src/components/task-chat/TaskChatCompactInteractionCard.tsx:1044`).

### 7.10 Görevdeki onaylar ve inceleme aşamaları

- Göreve bağlı onay kayıtları (bölüm 2.14), Approve ve Reject düğmeli `ApprovalCard` olarak yalnızca klasik Activity sekmesinde çizilir (`ui/src/pages/IssueDetail.tsx:2936-2959`, mutation `ui/src/pages/IssueDetail.tsx:4578-4629`). Sohbet kabuğunda kullanıcı onlara Gelen kutusu satırından, Onaylar sayfasından ya da akıştaki bir "Approval required" işaretinden ulaşır (`ui/src/components/TaskChatThread.tsx:1639`).
- İnceleme ve onay aşamaları: özellik panelinde "Execution" altında "Reviewers" ve "Approvers" olarak ayarlanır (ajan ve kullanıcılardan çoklu seçim). Bunları değiştirmek yeni bir `executionPolicy` yazar (`ui/src/components/issue-properties/IssueProperties.tsx:996-1014`, `ui/src/components/issue-properties/IssueProperties.tsx:2607-2643`; `ui/src/lib/issue-execution-policy.ts:79-90`). Küçük bir "Run review now" ya da "Run approval now" etiketi durumu `in_review` yapar (`ui/src/components/issue-properties/IssueProperties.tsx:1044-1055`). Geçerli aşama metin olarak gösterilir: "Review pending with X" ya da "Approval requested changes by X" (`ui/src/components/issue-properties/IssueProperties.tsx:1056-1069`, `ui/src/components/issue-properties/IssueProperties.tsx:2644-2649`).
- Görev sayfasında bir insanın bir aşamayı onaylaması ya da reddetmesi için düğme bulamadım. Aşama kararı için tek arayüz `StalledReviewActions` bileşenidir (Approve, Request changes, Send back; `POST /issues/:id/stalled-review-decision`) ve yalnızca kararlar masası satırında kullanılır (`ui/src/components/StalledReviewActions.tsx:37-62`; `ui/src/components/AttentionQueueRow.tsx:809`; `ui/src/api/issues.ts:272-276`). Belge yorumu, bileşenin görev sayfasındaki bir inceleme paneliyle paylaşıldığını söyler; ama `ui/src` içinde yapılan arama bu commit'te başka bir kullanım bulmuyor. Yani varsayılan bayraklarla inceleyen insan, durumu değiştirerek ya da yanıt yazarak işlem yapar.

### 7.11 Yan panel ve özellikler

Sekmeler (`ui/src/components/task-side-panel/TaskSidePanel.tsx:122-133`): Properties, Subtasks, Artifacts, Browser, Files ve çalışma alanı dosyaları (`enableExperimentalFileViewer` bayrağı), açık her görev belgesi için bir sekme (planın simgesi ampuldür), dosya ekleri. "+" düğmesi "Open", "Task documents" ("Revision N" bilgisiyle) ve "Recent workspace files" bölümlerinden oluşan bir başlatıcı açar (`ui/src/components/task-side-panel/TaskSidePanel.tsx:544-600`). Açık sekmeler ve etkin sekme hesap, şirket ve görev başına saklanır (`ui/src/components/task-side-panel/TaskSidePanel.tsx:265-309`); her sekme kaydırma konumunu hatırlar (`ui/src/components/task-side-panel/TaskSidePanel.tsx:460-484`). Plan sekmesi, plan ilk kez ortaya çıktığında bir kereliğine kendiliğinden açılır (`ui/src/components/task-side-panel/TaskSidePanel.tsx:375-381`); Artifacts sekmesi ilk çıktı geldiğinde arka planda eklenir (`ui/src/components/task-side-panel/TaskSidePanel.tsx:425-432`; `ui/src/pages/IssueDetail.tsx:3751-3768`). Plan modundaki görevlerde panel, bir plan oluşana kadar kapalı kalır (`ui/src/pages/IssueDetail.tsx:3692-3725`).

Özellikler (`ui/src/components/issue-properties/IssueProperties.tsx:2328-2989`):

| Bölüm | Satırlar |
|---|---|
| Work | Status (simge + etiket, seçici), Priority (gizli), Assignee, Model (yalnızca model değişikliği varsa), Project, Labels |
| Relationships | Parent, Blocked by (aramayla eklenir), Blocking, Subtasks, Referenced |
| Execution | Approvals (salt okunur inceleme kuralı), Reviewers, Approvers, geçerli aşama, Scheduled retry ("Retry now"), Monitor (tarih, notlar, servis, "Schedule", "Check now"), Watchdog ("Set watchdog") |
| Workspace (`enableIsolatedWorkspaces` bayrağı) | Execution mode, Workspace, Service, Branch, Folder |
| About | Originating, Started, Completed, Created, Updated, Archived ("Unarchive" düğmesiyle), Depth |

Temel bileşenler (`ui/src/components/issue-properties/primitives.tsx`): satır `flex w-full min-w-0 gap-3 py-1` sınıflarını taşır, sabit etiket sütunu `text-xs text-muted-foreground shrink-0 w-24 truncate` olur (`ui/src/components/issue-properties/primitives.tsx:49-77`); sade kabukta bölüm başlıkları 10px, büyük harfli ve eş aralıklıdır (`ui/src/components/issue-properties/primitives.tsx:20-37`). Seçiciler geniş ekranda açılır menü, telefonda satır içinde açılıp kapanan bölümlerdir (`ui/src/components/issue-properties/property-picker.tsx:82-105`; telefondaki alt sayfa `inline` değerini verir, `ui/src/pages/IssueDetail.tsx:8352-8362`).

Atanan seçici: arama, "No assignee", "Assign to me", "Assign to requester", ardından "Agents" ve "Board users" (`ui/src/components/issue-properties/IssueProperties.tsx:1710-1851`). Çalışma sürerken yapılan yeniden atama hemen uygulanmaz; çalışmanın kesileceğini belirterek doğrulama ister (`ui/src/components/issue-properties/IssueProperties.tsx:976-995`, `ui/src/components/issue-properties/IssueProperties.tsx:1801-1822`).

Bütün düzenlemeler, sunucu beklenmeden ekrana yansıyan tek bir mutation üzerinden geçer: önce önbellek güncellenir, hata olursa geri alınır ve "Task update failed" bildirimi çıkar (`ui/src/pages/IssueDetail.tsx:4126-4207`).

### 7.12 Alt görevler ve ilişkiler

- Tasks sekmesi: "Ancestors" ve "Subtasks" grupları, ardından bu görevden oluşturulan görevler, projeye göre gruplanmış olarak (`ui/src/components/task-detail/TaskDetailTasksPanel.tsx:64-98`).
- Subtasks bloğu: "N of M complete" yazılı bir ilerleme çubuğu, ardından "Root blocker", ardından vurgulanmış tek bir "Next action" (ya da "Blocked subtask"), ardından "Other subtasks" ve bir "Add subtask" düğmesi (`ui/src/components/task-detail/TaskDetailRelationsPanel.tsx:114-204`). "Referenced" ve "Mentioned in", söz etme yoluyla bağlanan görevleri listeler (`ui/src/components/task-detail/TaskDetailRelationsPanel.tsx:206-241`).
- "Add subtask", yeni görev penceresini alt görev modunda ve varsayılanları üst görevden alarak açar (`ui/src/pages/IssueDetail.tsx:7336`; `ui/src/components/NewIssueDialog.tsx:1453`, `ui/src/components/NewIssueDialog.tsx:1861-1876`).
- Daha kapsamlı alt görev listesi (klasik arayüz ve sade olmayan sohbet kabuğu) olağan `IssuesList` bileşenidir; kendi saklanan görünümü vardır, varsayılan sıralaması Workflow'dur ve bir ilerleme şeridi taşır: "3/7 done · 1 in progress · 1 blocked · tokens · runtime", durumlara göre bölmeli bir çubuk ve bir "Next up" ya da "Waiting on blockers" kutusu (sohbet kabuğunda `ui/src/pages/IssueDetail.tsx:4510-4553`, klasik arayüzde `ui/src/pages/IssueDetail.tsx:7609-7630`; `ui/src/components/IssuesList.tsx:577-691`).
- Duraklatma altındaki alt görevler soluk ve "Paused" rozetiyle çizilir (`ui/src/pages/IssueDetail.tsx:6811-6835`; `ui/src/components/IssuesList.tsx:2186-2195`).

### 7.13 Belgeler, plan, pasaj yorumları

- Bir görev birden çok markdown belgesi tutabilir; her belgenin bir `key` değeri, isteğe bağlı başlığı, sürümleri ve bir kilidi vardır (`packages/shared/src/types/issue.ts:98-137`). Uç noktalar: listeleme, getirme, `PUT /issues/:id/documents/:key { title, format, body, baseRevisionId }`, kilitleme, kilidi açma, sürümler, geri yükleme, silme (`ui/src/api/issues.ts:538-573`).
- Plan, anahtarı `plan` olan belgedir. Akışta "Plan · rev N" kartı olarak görünür; kartta başlık ve üç satırlık ön izleme bulunur ve kart Plan sekmesine bağlanır; plan yazılırken "Writing plan" yazar (`ui/src/components/task-chat/TaskChatPlanPreviewCard.tsx:78-166`). Planın onayı tam olarak tek bir yerde verilir: akıştaki onay kartında (`ui/src/components/issue-properties/IssuePropertiesPlansTab.tsx:76-79`).
- Belge kartının özellikleri (`ui/src/components/IssueDocumentsSection.tsx`): sürüm menüsü, kilit düğmesi, kopyalama, "Edit document", "Download document", "View diff" ve "Delete document" içeren bir menü (`ui/src/components/IssueDocumentsSection.tsx:1034-1141`); yazma durduktan 900 ms sonra otomatik kayıt, "Autosaving...", "Saved", "Could not save" yazılarıyla (`ui/src/components/IssueDocumentsSection.tsx:86`, `ui/src/components/IssueDocumentsSection.tsx:1328-1356`); eski bir sürüme bakılırken "Return to latest" ve "Restore this revision" düğmeli bir şerit (geri yükleme yeni bir sürüm oluşturur, geçmişe yalnızca ekleme yapılır) (`ui/src/components/IssueDocumentsSection.tsx:1164-1200`); "Review remote", "Keep my draft", "Reload remote" ve "Overwrite remote" düğmeli bir "Out of date" çakışma şeridi (`ui/src/components/IssueDocumentsSection.tsx:1201-1261`).
- Pasaj yorumları: belgenin pasajlarına bağlanan yorum dizileri. `GET /issues/:id/documents/:key/annotations?status=all&includeComments=true`, dizi oluşturmak için `POST`, `POST .../:threadId/comments`, `PATCH .../:threadId { status }` (`ui/src/api/document-annotations.ts`, 96 satır). Arayüz: bir "N comments" etiketi, geniş ekranda 360px'lik kenar boşluğunda yorum dizileri, seçili metne yorum yazmak için Cmd/Ctrl+Shift+M, bir yorum dizisine giden derin bağlantılar; taslakta kaydedilmemiş değişiklik varken, çakışma varken ya da eski bir sürüm gösterilirken yeni yorum devre dışıdır ve nedeni söylenir (`ui/src/components/IssueDocumentAnnotations.tsx:105-140`, `ui/src/components/IssueDocumentAnnotations.tsx:201-238`, `ui/src/components/IssueDocumentAnnotations.tsx:392-441`).

### 7.14 Çıktılar, dosya ekleri, galeri

- Çıktılar (work products): `type` (preview_url, runtime_service, pull_request, branch, commit, artifact, document), `status` (active, ready_for_review, approved, changes_requested, merged, closed, failed, archived, draft), `reviewState`, `title`, `url`, `summary`, `createdByRunId` (`packages/shared/src/types/work-product.ts:1-56`).
- Artifacts sekmesi: satırlar onları üreten çalışmaya göre gruplanır, ajan adı ve zamanla birlikte (`ui/src/components/issue-properties/IssuePropertiesArtifactsTab.tsx:477-551`). Markdown çıktılar, pasajlarına yorum yazılabilen bir inceleme belgesi olarak açılır (`ui/src/components/issue-properties/IssuePropertiesArtifactsTab.tsx:82-275`). Boş ekran metni: "No artifacts yet. Work products, documents, and agent-produced files will appear here." (`ui/src/components/issue-properties/IssuePropertiesArtifactsTab.tsx:518-529`); yükleme hatasında "Retry" düğmesi (`ui/src/components/issue-properties/IssuePropertiesArtifactsTab.tsx:498-511`).
- Çıktılar akışta da, üretildikleri anda kaynak satırı olarak görünür (`ui/src/components/TaskChatThread.tsx:1176-1407`).
- Dosya ekleri: `GET /issues/:id/attachments`; yükleme, isteğe bağlı `issueCommentId` ile multipart `POST /companies/:cid/issues/:id/attachments` isteğidir; `DELETE /attachments/:id` (`ui/src/api/issues.ts:574-593`). Her dosya eki, onu yükleyen çalışmayı kaydeder (`packages/shared/src/types/issue.ts:1596-1617`).
- Tek bir görsel galerisi penceresi hem dosya eklerini hem görsel çıktıları kapsar (`ui/src/pages/IssueDetail.tsx:5679-5766`, `ui/src/pages/IssueDetail.tsx:7748-7753`).

### 7.15 Etkinlik ve maliyet (yalnızca klasik arayüz)

- "Cost Summary" kutusu: her çalışmanın `usageJson` ve `resultJson` alanlarından tarayıcıda hesaplanan "This task $0.0000 · Tokens N (in X, out Y, cached Z) · Runtime ... (N runs)" satırı ve `GET /issues/:id/cost-summary` yanıtından gelen "Including sub-tasks ..." satırı (`ui/src/pages/IssueDetail.tsx:2693-2751`, `ui/src/pages/IssueDetail.tsx:2772-2842`). `IssueCostSummary` = `{ issueId, issueCount, includeDescendants, costCents, inputTokens, cachedInputTokens, outputTokens, runCount, runtimeMs }`; süren çalışmaların değerleri canlı olarak artar (`packages/shared/src/types/cost.ts:33-46`).
- "Run ledger" (çalışma defteri): her çalışma için bir blok; çalışma kimliği bağlantısı, ajan, durum, bir liveness etiketi, geçen süre, son yararlı eylem, "Stop", "Inspect run" ve "Next action: ..." içerir; en çok 20 blok gösterilir (`ui/src/components/IssueRunLedger.tsx:666-689`, `ui/src/components/IssueRunLedger.tsx:836`, `ui/src/components/IssueRunLedger.tsx:861-1021`). Liveness metinleri bir tablodan gelir (`ui/src/components/IssueRunLedger.tsx:93-148`). Sessiz kalan bir çalışma, "Continue monitoring", "Snooze 1h" ve "Mark false positive" seçenekli bir uyarı çıkarır (`ui/src/components/IssueRunLedger.tsx:728-826`).
- Etkinlik olayları: aktör, fiil, kayıt, göreli zaman; alan değişikliklerinin tek satırlık kayıtlarıyla birlikte (`ui/src/pages/IssueDetail.tsx:2848-2929`).
- Sohbet kabuğunda maliyete dair tek işaretler, bir turun ölçümlerindeki token sayısı (bölüm 7.6) ile alt görev şeridindeki token ve çalışma süresi bilgisidir (`ui/src/components/IssuesList.tsx:598-640`).

### 7.16 Alt ağacı duraklatma, sürdürme, iptal etme

- Menü satırları: "Pause work" ya da "Pause subtree", "Resume work" ya da "Resume subtree", "Cancel subtree...", "Restore subtree..." (`ui/src/components/TaskTreeControls.tsx:42-69`). Bunları yalnızca yönetim kurulu erişimi olan kullanıcılar görür (`ui/src/pages/IssueDetail.tsx:3478-3496`).
- Hiçbir şey yapılmadan önce bir pencere etkinin ön izlemesini gösterir: `POST /issues/:id/tree-control/preview`. Sayıları söyler ("N tasks will be cancelled."), "Wake affected agents (N)" seçeneğini sunar ve güvenli düğme olarak "Keep tasks" kullanır (`ui/src/components/TaskTreeControls.tsx:105-185`; `ui/src/pages/IssueDetail.tsx:8216-8250`).
- Duraklatma bir bekletme (hold) kaydı oluşturur: `POST /issues/:id/tree-holds { mode: "pause", reason, releasePolicy: { strategy: "manual", note }, metadata }`; sürdürme bu kaydı kaldırır: `POST /issues/:id/tree-holds/:holdId/release` (`ui/src/pages/IssueDetail.tsx:4278-4402`; `ui/src/api/issues.ts:293-341`). Duraklatma, tamamlandığını bildirmeden önce süren çalışmaların durmasını bekler.
- Duraklatılmışken: yazma kutusunun yerini alan sarı blok (bölüm 7.7) ve bir duraklatma notu (`ui/src/components/TaskTreeControls.tsx:189-226`).

### 7.17 Kurtarma, izleme, gözcü

- Kurtarma eylemi: bir görevin bir çalışmadan sonra takılıp kaldığına dair sunucu kaydı. Türlerin etiketleri "Missing Disposition", "Wait Without A Target", "Stranded Task", "Workspace Validation", "Configuration Validation", "Active Watchdog", "Task Needs Next Step"; her birinin düz dille yazılmış bir başlığı vardır (`ui/src/components/IssueRecoveryActionCard.tsx:133-158`). Kartın her biri ayrı renkte beş durumu vardır: needed (sarı), in progress (gök mavisi), observing (nötr), escalated (kırmızı), resolved (yeşil) (`ui/src/components/IssueRecoveryActionCard.tsx:164-223`). "Resolve…" menüsü "Try again", "Mark task done", "Send for review" seçeneklerini, yönetim kurulu kullanıcılarına ayrıca iki "False positive" seçeneğini sunar (`ui/src/components/IssueRecoveryActionCard.tsx:948-984`); `POST /issues/:id/recovery-actions/resolve { actionId, outcome, sourceIssueStatus, resolutionNote }` (`ui/src/api/issues.ts:279-292`). Kartın alt satırında "The card stays open until an explicit decision is recorded." (açık bir karar kaydedilene kadar kart açık kalır) yazar (`ui/src/components/IssueRecoveryActionCard.tsx:1498-1500`).
- Bu kart klasik akışta ve çalışma sayfasında çizilir (`ui/src/components/IssueChatThread.tsx:6644`; `ui/src/components/RunWorkspaceRecoverySurface.tsx:272`). Sohbet kabuğunda kullanıcı akışın üstünde kısa bir not görür: "Recovery needed.", yanında "Inspect run" ve "Continue" ya da "Retry" (`ui/src/components/ExecutionBlockerNotice.tsx:34-58`; `ui/src/pages/IssueDetail.tsx:7866-7870`); liste satırlarında da bir kurtarma etiketi görünür (bölüm 4.5).
- İzleme (monitor): bekleyen bir görevin zamanlanmış olarak yeniden kontrol edilmesi. Üst bölümün altında "Waiting for workspace" gibi bir başlık ya da sürdürme zamanı taşıyan bir şerit ve "Check now" düğmesi bulunur (`POST /issues/:id/monitor/check-now`); yazma kutusunun üstündeki bir şerit, yanıt yazmanın ajanı zamanlanmış kontrolden önce uyandıracağını söyler (`ui/src/components/IssueMonitorBanner.tsx:64-155`, `ui/src/components/IssueMonitorBanner.tsx:194-225`; `ui/src/api/issues.ts:342-343`).
- Zamanlanmış yeniden deneme: "Retry now", `POST /issues/:id/scheduled-retry/retry-now` çağırır (`ui/src/components/issue-properties/IssueProperties.tsx:1529`; `ui/src/api/issues.ts:344-348`).
- Gözcü: görev ağacını izlemesi için atanan bir ajan; talimatları serbest metindir; `GET/PUT/DELETE /issues/:id/watchdog` (`ui/src/api/issues.ts:241-246`; `packages/shared/src/types/issue.ts:742-757`).

### 7.18 Görev sayfasında klavye

| Tuş | Eylem | Kanıt |
|---|---|---|
| `y` | arşivler ve Gelen kutusuna döner (görev Gelen kutusundan açıldıysa) | `ui/src/pages/IssueDetail.tsx:5872-5898` |
| `g`, ardından `i` / `c` / `f` | Gelen kutusu / yazma kutusuna odaklanma / dosya görüntüleyici; tuş dizisi 1,2 saniye boyunca etkin kalır | `ui/src/pages/IssueDetail.tsx:5900-5991`; `ui/src/lib/keyboardShortcuts.ts:181-213` |
| `]` | yan paneli açar ya da kapatır | `ui/src/hooks/useKeyboardShortcuts.ts:127-131` |
| Cmd/Ctrl+Enter | gönderir | `ui/src/components/task-chat/TaskChatComposer.tsx:1513` |
| Cmd/Ctrl+. ya da Shift+Tab | Auto, Plan, Ask modları arasında geçer | `ui/src/components/task-chat/TaskChatComposer.tsx:1190-1205` |
| 1 ile 9 arası | sorudaki bir seçeneği seçer | `ui/src/components/task-chat/QuestionForm.tsx:498-516` |

Görev sayfasından arşivleme sunucu beklenmeden ekrana yansır, Gelen kutusuna döner ve "Undo" düğmeli bir "Task archived from inbox" bildirimi gösterir (`ui/src/pages/IssueDetail.tsx:5448-5516`).

### 7.19 Yükleme, boş ekran, canlı güncelleme

- İlk çizim liste satırının anlık kopyasını kullanır; bu yüzden başlık ve durum beklemeden görünür; satırın üzerine gelmek ve Enter, görevi ve ilk yorum sayfasını önceden yükler (`ui/src/pages/IssueDetail.tsx:3101-3119`; `ui/src/components/IssuesList.tsx:1516-1521`).
- Yükleme iskeletleri iki arayüzde de son yerleşimin biçimindedir (`ui/src/pages/IssueDetail.tsx:844-940`, `ui/src/pages/IssueDetail.tsx:961-1077`).
- Görev her ziyarette bir kez okundu işaretlenir (`ui/src/pages/IssueDetail.tsx:5672-5677`); URL, asıl görev kimliğini içerecek biçimde yeniden yazılır (`ui/src/pages/IssueDetail.tsx:5630-5670`).
- Canlı güncelleme: bkz. bölüm 14. Bu sayfada şirket soketi çalışma durumunu yerinde günceller ve yorumları, etkileşimleri, belgeleri ve çıktıları geçersiz kılar; görev ekrandayken bu görevle ilgili bildirimler gösterilmez.

## 8. Çalışma görünümleri

Tek bir çalışma dört yerden incelenebilir.

| Yer | Ne gösterir | Kanıt |
|---|---|---|
| Görev akışı | katlanmış tur, etkinlik aşamaları, araç satırları (bölüm 7.6) | |
| Çalışma sayfası `/agents/:agentId/runs/:runId` | tam ayrıntı (aşağıda) | `ui/src/App.tsx:288`; `ui/src/pages/AgentDetail.tsx:3367-3970` |
| Denetim > Çalışmalar (Runs) | en son 200 çalışmanın listesi | `ui/src/pages/audit/AuditRuns.tsx:23`, `ui/src/pages/audit/AuditRuns.tsx:129-312` |
| Gelen kutusu ve Genel bakış | çalışma sayfasına bağlanan başarısız çalışma satırları ve ajan çalışma kartları | bölüm 3.3 ve 4.5 |

### 8.1 Çalışma sayfası

Ajan sayfasında bir "Runs" sekmesi vardır: geniş ekranda ayrıntının yanında `w-72` genişliğinde, yerinde sabit kalan bir liste; telefonda "Back to runs" bağlantısıyla ya liste ya ayrıntı; boş ekran metni "No runs yet." (`ui/src/pages/AgentDetail.tsx:3269-3349`). Liste öğesi durum simgesini, kimliğin ilk 8 karakterini, bir kaynak rozetini (timer, assignment, on_demand), göreli zamanı, 60 karakterlik bir özeti, token sayısını ve maliyeti gösterir (`ui/src/pages/AgentDetail.tsx:3218-3267`).

Çalışma ayrıntısı (`ui/src/pages/AgentDetail.tsx:3367-3970`), yukarıdan aşağıya:

1. Özet kartı: durum rozeti ve duruma göre eylem düğmeleri. Süren ya da sıradaki çalışma için "Cancel" (`ui/src/pages/AgentDetail.tsx:3591-3601`); süreç kaybolduysa "Resume" (`ui/src/pages/AgentDetail.tsx:3602-3613`); başarısız olan ya da zaman aşımına uğrayan çalışma için "Retry" (`ui/src/pages/AgentDetail.tsx:3614-3625`); "Inspect run" (`ui/src/pages/AgentDetail.tsx:3626-3634`); "Re-run with provider trace" (`ui/src/pages/AgentDetail.tsx:3639-3650`).
2. Adaptör, sağlayıcı ve model satırı (`ui/src/pages/AgentDetail.tsx:3653-3672`); "On behalf of" (adına çalışılan) kullanıcı (`ui/src/pages/AgentDetail.tsx:3673-3683`); başlangıç ve bitiş zamanı ile süre (`ui/src/pages/AgentDetail.tsx:3717-3734`); hata metni ve kodu (`ui/src/pages/AgentDetail.tsx:3736-3741`); çıkış kodu (`ui/src/pages/AgentDetail.tsx:3795-3800`); yeniden deneme durumu kutusu (`ui/src/pages/AgentDetail.tsx:3801-3824`).
3. Ölçüm ızgarası: Input, Output, Cached, Cost (`ui/src/pages/AgentDetail.tsx:3828-3847`).
4. Oturum satırı; çalışmanın işlem yaptığı görevler için oturumu temizleme eylemiyle birlikte (`ui/src/pages/AgentDetail.tsx:3851-3906`).
5. "Tasks Touched (N)" listesi (`ui/src/pages/AgentDetail.tsx:3910-3929`); verisi `GET /heartbeat-runs/:runId/issues` isteğinden gelir (`ui/src/api/activity.ts:81`).
6. stderr ve stdout alıntıları (`ui/src/pages/AgentDetail.tsx:3932-3945`).
7. `LogViewer` (aşağıda).
8. `RunnerInspector`: "Runner Inspector" başlıklı, Overview, Pipeline ve Exact trace görünümleri olan, kenardan açılan bir panel (`ui/src/pages/AgentDetail.tsx:3957-3967`; `ui/src/components/RunnerInspector.tsx:61`, `ui/src/components/RunnerInspector.tsx:91-93`, `ui/src/components/RunnerInspector.tsx:1028`; bu dosyanın yalnızca ana hatları okundu).

### 8.2 Kayıt görüntüleyici ve döküm

- Veri: `GET /heartbeat-runs/:runId/events?afterSeq=&limit=200` ve `{ content, nextOffset }` döndüren `GET /heartbeat-runs/:runId/log?offset=&limitBytes=256000` (`ui/src/api/heartbeats.ts:136-151`; `ui/src/pages/AgentDetail.tsx:4055-4058`, `ui/src/pages/AgentDetail.tsx:4160-4215`).
- Canlı güncelleme: aynı şirket WebSocket'i; `heartbeat.run.log`, `heartbeat.run.progress`, `heartbeat.run.event` olaylarını okur; bağlantı koparsa 1,5 saniye sonra yeniden bağlanır; soket kapalıyken 2 saniyede bir yoklama yapar (`ui/src/pages/AgentDetail.tsx:4217-4401`).
- Başlıkta "Transcript (N)" yazısı, bir `nice | raw` seçici, "Jump to live" ve bir "Live" göstergesi bulunur (`ui/src/pages/AgentDetail.tsx:4470-4517`). Görüntüleyici kutusu: `max-h-(--sz-38rem) overflow-y-auto rounded-2xl border border-border/70 bg-background/40 p-3 sm:p-4` (`ui/src/pages/AgentDetail.tsx:4518-4552`). Büyük kayıtlar parça parça yüklenir; "Load more log" düğmesi ve "Showing the first N KB of M KB" yazısı görünür (`ui/src/pages/AgentDetail.tsx:4527-4545`).
- Altında: "Failure details" (`ui/src/pages/AgentDetail.tsx:4554-4588`) ve eş aralıklı yazılı bir liste olarak "Events (N)" (`ui/src/pages/AgentDetail.tsx:4590-4620`). Ekran durumları: "Loading run logs..." ve "No log events." (`ui/src/pages/AgentDetail.tsx:4440-4446`).

`RunTranscriptView` (`ui/src/components/transcript/RunTranscriptView.tsx`) döküm kayıtlarını bloklara çevirir (`ui/src/components/transcript/RunTranscriptView.tsx:46-165`): mesaj ("Streaming" işaretiyle), düşünme (italik, soluk), araç kartı (ad, Running / Errored / Completed, özet, açılabilen Input ve Result) (`ui/src/components/transcript/RunTranscriptView.tsx:903-1134`), komut grubu ("Executing command", "Executed N commands") (`ui/src/components/transcript/RunTranscriptView.tsx:1141-1279`), araç grubu ("Using X", "Used X (N calls)") (`ui/src/components/transcript/RunTranscriptView.tsx:1281-1431`), stderr ve system grupları, fark (diff) grubu. Araç kararları "Needs approval" ve "Denied" rozetlerini gösterir (`ui/src/components/transcript/RunTranscriptView.tsx:403-420`, `ui/src/components/transcript/RunTranscriptView.tsx:975-1026`). İki mod (`nice`, `raw`) ve iki yoğunluk (`comfortable`, `compact`) vardır (`ui/src/components/transcript/RunTranscriptView.tsx:24-25`). Ham mod 300 satırın üstünde sanallaştırılır (`ui/src/components/transcript/RunTranscriptView.tsx:27-30`, `ui/src/components/transcript/RunTranscriptView.tsx:1764-1845`).

### 8.3 Denetim > Çalışmalar (Runs)

Agent ve Status filtreleri `agentId` ve `runStatus` URL parametrelerinde tutulur (`ui/src/pages/audit/AuditRuns.tsx:130-188`). Sorgu `GET /companies/:id/heartbeat-runs?limit=200&summary=true`; 15 saniyede bir yeniden çekilir (`ui/src/pages/audit/AuditRuns.tsx:138-146`). Satır: ajan adı, 8 karakterlik çalışma kimliği, durum rozeti, özet satırı (sonuç özeti, yoksa hata, o da yoksa "<source> run"), kaynak, süre, göreli zaman; satırın tamamı çalışma sayfasına bağlanır (`ui/src/pages/audit/AuditRuns.tsx:270-306`). Boş ekran: "No runs yet." ya da "No runs match these filters."; alt satırda "Showing the 200 most recent runs." yazar (`ui/src/pages/audit/AuditRuns.tsx:264-268`, `ui/src/pages/audit/AuditRuns.tsx:309`).

### 8.4 Döküm UX laboratuvarı

`ui/src/pages/RunTranscriptUxLab.tsx`, örnek verileri `RunTranscriptView` ile üç tanıtım ekranında çizer ("Run Detail", "Issue Widget", "Dashboard Card") (`ui/src/pages/RunTranscriptUxLab.tsx:17-45`, `ui/src/pages/RunTranscriptUxLab.tsx:57-92`). Uygulamada bir yola bağlı değildir; yalnızca Storybook tarafından import edilir (`ui/storybook/stories/ux-labs.stories.tsx`). Aynı biçimde `ui/src/components/LiveRunWidget.tsx` (Stop ve "Open run" düğmeli bir "Live Runs" kartı) yalnızca bir Storybook hikâyesinde import edilir (`ui/storybook/stories/data-viz-misc.stories.tsx:30`); `ui/src` içinde ondan yalnızca bir örnek veri dosyası ve bir CSS yorumu söz eder. Yalnızca geliştirme ortamında açık olan yol `dev/task-chat-lab` yoludur (`ui/src/App.tsx:420-423`).

## 9. Arama

Yol `/search` (`ui/src/App.tsx:305`), sayfa `ui/src/pages/Search.tsx` (922 satır, tamamı okundu).

- İstek: `GET /companies/:id/search?q=&scope=&limit=&offset=&status=&priority=&assigneeAgentId=&assigneeUserId=&projectId=&labelId=&updatedWithin=&updatedAfter=&sort=` (`ui/src/api/search.ts:24-45`). Yanıtta sonuçlar, `countsByType`, `filterOptionCounts` ve `zeroResults` bulunur (`packages/shared/src/types/search.ts:99-111`).
- Kapsamlar, sayı etiketli sekmeler olarak gösterilir: All, Tasks, Comments, Documents, Artifacts, Agents, Projects (`ui/src/pages/Search.tsx:60-68`, `ui/src/pages/Search.tsx:452-494`).
- Giriş 250 ms geciktirilir (`ui/src/pages/Search.tsx:57`); sorgu ve filtreler yazarken `replaceState`, sorgu kesinleşince `pushState` ile URL'ye yansıtılır (`ui/src/pages/Search.tsx:97-122`, `ui/src/pages/Search.tsx:231-301`). `/` tuşu giriş alanına odaklanır (`ui/src/pages/Search.tsx:434-445`); başlıkta bir ⌘K ipucu görünür.
- Kutuya yazılan sorgu işleçleri: `status:`, `assignee:`, `project:`, `label:`, `priority:`, `updated:`, `is:` (`ui/src/lib/search-query-parser.ts:26`). Tanınan işleçler etiket olarak görünür; bir ipucu satırı "status:todo, assignee:me, or updated:>7d" önerir (`ui/src/pages/Search.tsx:547-626`).
- `PAP-12` gibi tam eşleşen bir kimlik yazılırsa doğrudan göreve yönlendirilir (`ui/src/pages/Search.tsx:400-416`).
- Görev için sonuç satırı: durum simgesi, eş aralıklı yazıyla kimlik, eşleşmesi vurgulanmış başlık, her biri kaynağıyla (Comment, Doc, Artifact, Description) etiketlenmiş en çok iki alıntı satırı, atanan, göreli zaman ve varsa 88px'lik bir ön izleme görseli (`ui/src/components/search/SearchResultRow.tsx:162-233`).
- Ekran durumları: başlangıçta "Type to search organization memory." yazısı, son aramalar ve ipuçları (`ui/src/pages/Search.tsx:762-808`); yükleme iskeleti satırları (`ui/src/pages/Search.tsx:832-854`); yeniden deneme düğmeli hata (`ui/src/pages/Search.tsx:810-830`); üç çıkış yolu sunan boş ekran: "Search all scopes", "Create task from this query", "Open Tasks filter view" (`ui/src/pages/Search.tsx:856-891`); sonuç başlığı "N of M results · sorted by ... · K filters active" (`ui/src/pages/Search.tsx:895-921`).
- Telefonda: filtreler, canlı sonuç sayısı gösteren ayrı bir sayfada (sheet) açılır (`ui/src/pages/Search.tsx:633-708`).

## 10. Zaman çizelgesi

`ui/src/pages/Timeline.tsx` (543 satır, tamamı okundu). Sade kabukta `/timeline`, Denetim ekranının bir bölümü olan `/activity/timeline` yoluna yönlendirilir (`ui/src/App.tsx:154-157`, `ui/src/App.tsx:394`; `ui/src/pages/audit/AuditHub.tsx:126-127`).

- Çalışmaları zamana göre gösteren Gantt benzeri bir grafik; verisi `GET /companies/:id/timeline?from=&to=&projectId=&limit=&offset=` isteğinden gelir, 500'lük sayfalar hâlinde yüklenir ve birleştirilir (`ui/src/pages/Timeline.tsx:37`, `ui/src/pages/Timeline.tsx:52-104`; `ui/src/api/workTimeline.ts:30-33`).
- Kontroller: hazır aralıklar Today, 7 days, 30 days ve özel tarihler (`ui/src/pages/Timeline.tsx:113-136`, `ui/src/pages/Timeline.tsx:398-436`); yakınlaştırma (`ui/src/pages/Timeline.tsx:438-474`); isteğe bağlı `?projectId=` kapsamı (`ui/src/pages/Timeline.tsx:312-315`).
- Özet sayılar: Runs, Agents, Run time, Tokens used (`ui/src/pages/Timeline.tsx:273-305`). Lejant: Delegated, Automation, Cancelled, Now (`ui/src/pages/Timeline.tsx:247-271`).
- Boş ekran: "No activity in this window." (`ui/src/pages/Timeline.tsx:503-513`). Alt satırda çalışma sayısı ve zaman aralığı yazar (`ui/src/pages/Timeline.tsx:530-536`).

## 11. Denetim ve etkinlik

Yol `/activity` (`ui/src/App.tsx:388`). Sade kabukta bu yol `AuditHub` bileşenini çizer (`ui/src/pages/audit/CompanyActivity.tsx:67`).

- Denetim ekranı: "Audit" başlığı (`text-3xl font-semibold tracking-tight`), tek cümlelik bir açıklama ve Activity, Runs, Costs, Budgets, Timeline sekmeleri; yolları `/activity`, `/activity/runs`, `/activity/costs`, `/activity/budgets`, `/activity/timeline` (`ui/src/pages/audit/AuditHub.tsx:84-130`; `ui/src/App.tsx:391-394`).
- Etkinlik akışı (`ui/src/pages/audit/AuditFeed.tsx`, 727 satır, tamamı okundu): `GET /companies/:id/audit/agent-actions`, filtreleri `actorScope, agentId, responsibleUserId, runId, entityType, entityId, action, from, to, actorType, cursor, limit`; yanıtı `{ items, nextCursor, accessTier }` (`ui/src/api/audit.ts:1-90`). Sayfa boyutu 50'dir, devamı "Load more" ile yüklenir (`ui/src/pages/audit/AuditFeed.tsx:29`, `ui/src/pages/audit/AuditFeed.tsx:709-720`).
- Satır: "aktör fiil kayıt" biçiminde bir cümle, isteğe bağlı yorum alıntısı, bir "on behalf of X" etiketi, "View run", eş aralıklı yazıyla ham eylem kimliği ve göreli zaman (`ui/src/pages/audit/AuditFeed.tsx:192-259`). Fiiller bir tablodan gelir; örneğin `issue.created` için "created", `issue.comment_added` için "commented on", `approval.created` için "requested approval" (`ui/src/lib/activity-format.ts:25-123`).
- İki erişim düzeyi vardır. "basic" düzeyinde bilgiler gizlenmiş gelir; "full" düzeyi adına çalışılan kişiyi ve kaydın hangi çalışmaya ait olduğunu ekler ve `audit:view_agent_actions` iznini gerektirir; izin yoksa hata yerine açıklayıcı bir kart gösterilir (`ui/src/pages/audit/AuditFeed.tsx:262-280`, `ui/src/pages/audit/AuditFeed.tsx:376-448`).
- Filtreler: Agent, Responsible user, Action (alana göre: issue, agent, heartbeat, approval, project, goal, tool, cost, company), Entity, From, To, "Clear filters", "Export CSV" (`ui/src/pages/audit/AuditFeed.tsx:33-57`, `ui/src/pages/audit/AuditFeed.tsx:539-648`). Mod ve eylem alanı URL'de durur (`ui/src/pages/audit/AuditHub.tsx:50-78`).
- Ekran durumları: "Loading…", "Try again" düğmeli hata, "Nothing here yet", "No actions match these filters" (`ui/src/pages/audit/AuditFeed.tsx:650-693`). Alt satır, kayıtların sistemce yazıldığını, düzenlenemediğini ve hassas değerlerin hiçbir zaman saklanmadığını söyler (`ui/src/pages/audit/AuditFeed.tsx:722-724`).
- Genel bakış ekranındaki "Recent Activity" daha yalın olan `GET /companies/:id/activity` isteğini ve `ActivityRow` bileşenini kullanır (bölüm 3.2).

## 12. Çıktılar (Artifacts)

Yol `/artifacts` (`ui/src/App.tsx:383`), sayfa `ui/src/pages/Artifacts.tsx` (376 satır, tamamı okundu). Ajanların ürettiklerinin şirket genelindeki galerisidir.

- İstek: `GET /companies/:id/artifacts?kind=&projectId=&q=&groupBy=&groupIssueId=&limit=30&cursor=`; `{ artifacts, groups?, selectedGroup?, nextCursor }` döndürür (`ui/src/api/artifacts.ts`, 85 satır; `ui/src/pages/Artifacts.tsx:29-30`).
- Tür filtresi: All, Images, Videos, Documents, Text, Files (`ui/src/pages/Artifacts.tsx:32-39`). Gruplama: None, Task (varsayılan), Parent task (`ui/src/pages/Artifacts.tsx:41-52`). Arama 250 ms geciktirilir. Durum `kind`, `q`, `groupBy`, `groupIssueId` URL parametrelerinde tutulur (`ui/src/pages/Artifacts.tsx:69-72`).
- Yerleşim: `grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3` (`ui/src/pages/Artifacts.tsx:354`); kartların sabit bir `aspect-video` ön izleme çerçevesi vardır, böylece medya yüklenirken ızgara zıplamaz (`ui/src/components/artifacts/ArtifactCard.tsx:16-22`). Gruplanmış görünüm her görev için bir "stack" (yığın) gösterir; yığın açılınca öğeleri ve "All stacks" geri bağlantısı görünür (`ui/src/pages/Artifacts.tsx:327-344`).
- IntersectionObserver ile sonsuz kaydırma, pay 320px (`ui/src/pages/Artifacts.tsx:171-205`). Yükleme iskeleti `PageSkeleton variant="list"` (`ui/src/pages/Artifacts.tsx:348-349`); boş ekran mesajları filtreye göre değişir (`ui/src/pages/Artifacts.tsx:236-246`).

## 13. Cases ve Pipelines (ikisi de bayrağa bağlı, varsayılan kapalı)

- Case (`enableCases` bayrağı): "Durable work products that tasks create and iterate on" (görevlerin oluşturduğu ve üzerinde yinelediği kalıcı çıktılar) (`packages/shared/src/feature-catalog.ts:140-147`). Bir case'in kendi kimliği, türü, anahtarı, alanları, üst case'i, etiketleri, belgeleri ve dosya ekleri vardır (`ui/src/api/cases.ts:25-48`, `ui/src/api/cases.ts:121-127`). Durumlar: draft, in_progress, in_review, approved, done, cancelled (`ui/src/api/cases.ts:9-17`). İnsanlar yalnızca durumu ve etiketleri değiştirebilir; geri kalan her şeyi ajanlar yazar (`ui/src/api/cases.ts:5-6`). Case'ler görevlere origin, work, reference rolleriyle bağlanır (`ui/src/api/cases.ts:22`); bir görev kendi case'lerini `GET /issues/:id/cases` üzerinden listeler ve özellik paneli bunları gösterir (`ui/src/components/issue-properties/IssueProperties.tsx:2985-2987`).
- Cases listesi: türe, projeye, duruma göre gruplama ya da gruplamasız; sütunlar; sıralama; ağaç görünümü; varsayılan filtre bitmiş case'leri gizler; görünüm durumu localStorage'da `paperclip:cases:<companyId>:view` anahtarında durur (`ui/src/pages/Cases.tsx:26-89`). Case ayrıntısı: kimlik, başlık, durum seçici ve tür rozeti içeren üst bölüm; sekmeler Overview (görevlerdekiyle aynı belge bileşeni üzerinden belgeler, açıklama, dosya ekleri), Properties, Activity (`ui/src/pages/CaseDetail.tsx:616-718`).
- Pipeline (`enablePipelines` bayrağı): case'lerin içinden geçtiği aşamalardan oluşan bir pano. Aşama türleri: Working, Review ("Someone has to approve before items leave", yani öğeler çıkmadan önce birinin onaylaması gerekir), Done, Cancelled (`ui/src/pages/PipelineSettings.tsx:215-248`). Bir aşamanın otomasyonu olabilir: atanan ajanı, başlık şablonu ve talimatları olan bir rutin; bir öğe aşamaya girince görev oluşturur (`packages/shared/src/types/pipeline.ts:28-41`). Panodaki kart rozetleri: "Working", "Needs attention", "This changed", "N live downstream", "Built from N items" (`ui/src/pages/Pipelines.tsx:1211-1289`). Öğenin liveness değeri terminal, live, waiting, blocked, attention değerlerinden biridir; nedenleri `linked_issue_active` ya da `review_waiting` gibidir (`packages/shared/src/types/pipeline.ts:43-60`). Bununla birlikte bir inceleme kuyruğu ve bir learnings sayfası gelir (`ui/src/App.tsx:337-345`).
- Aşama ayarlarının bölümleri: Automation, Advanced, Secrets, Activity, History (`ui/src/pages/PipelineSettings.tsx:165-184`).
- Görevlerle ilişkisi: görev, ajan işinin ve yazışmanın birimi olmayı sürdürür; case, birkaç görevin katkıda bulunduğu kalıcı sonuçtur; pipeline, case'ler üzerinde işleyen ve aşama başına görev açan bir iş akışıdır. `Cases.tsx`, `Pipelines.tsx` ve `PipelineSettings.tsx` dosyalarının yalnızca baş kısımları okundu (bölüm 17).

## 14. Canlı güncelleme (bütün ekranlarda ortak)

Seçili şirket başına tek bir WebSocket vardır: `/api/companies/:companyId/events/ws` (`ui/src/context/LiveUpdatesProvider.tsx:1980-1982`). Olay türleri: `heartbeat.run.queued`, `heartbeat.run.status`, `heartbeat.run.progress`, `heartbeat.run.event`, `heartbeat.run.log`, `agent.status`, `activity.logged` ve birkaç eklenti ve hedef olayı (`packages/shared/src/constants.ts:942-955`).

- Çalışmanın yaşam döngüsü olayları önbellekleri doğrudan günceller (şirketin süren çalışmaları, görevin süren çalışmaları); böylece "Live" rozetleri yeniden çekme olmadan değişir; kayıt olayları bu düzeyde yok sayılır ve çalışma görüntüleyicileri tarafından okunur (`ui/src/context/LiveUpdatesProvider.tsx:1652-1790`).
- Geçersiz kılmayı `activity.logged` yürütür: etkinlik, Genel bakış, kenar çubuğu rozetleri, görev listeleri ve etkilenen görevin ayrıntısı, yorumları, dosya ekleri, çıktıları, belgeleri, pasaj yorumları ve etkileşimleri (`ui/src/context/LiveUpdatesProvider.tsx:1251-1434`). Değişiklik kullanıcının kendi yorumuysa ya da görev ekrandaysa, sunucu beklenmeden ekrana yansıyan güncellemenin zaten yaptığı işi yinelememek için bunun yerine etkin olmayan sorgular yeniden çekilir (`ui/src/context/LiveUpdatesProvider.tsx:1346-1352`).
- Geçersiz kılmalar toplu olarak uygulanır (`ui/src/context/LiveUpdatesProvider.tsx:1900-1911`).
- Yeniden bağlanma, `min(15000, 1000 * 2^min(attempt-1, 4))` ms'lik artan beklemeyle yapılır (`ui/src/context/LiveUpdatesProvider.tsx:1965-1976`). Bağlantı kopukken etkin sorgular 15 saniyede bir yenilenir (`ui/src/context/LiveUpdatesProvider.tsx:59`, `ui/src/context/LiveUpdatesProvider.tsx:1962`). Bağlanınca ve tarayıcı sekmesi yeniden görünür olunca bütün etkin sorgular geçersiz kılınır (`ui/src/context/LiveUpdatesProvider.tsx:1931-1935`, `ui/src/context/LiveUpdatesProvider.tsx:2000-2002`). Sekme gizliyken gelen mesajlar yok sayılır (`ui/src/context/LiveUpdatesProvider.tsx:2007`).
- Bildirimler bilerek seyrek tutulmuştur: yalnızca görev oluşturulunca, güncellenince ya da yorum yazılınca, ajan hatalarında ve başarısız olan, zaman aşımına uğrayan ya da iptal edilen çalışmalarda çıkar (`ui/src/context/LiveUpdatesProvider.tsx:845-878`); kullanıcının kendi eylemleri için hiç çıkmaz (`ui/src/context/LiveUpdatesProvider.tsx:942-949`); o an ekranda olan görev için çıkmaz; kategori başına 10 saniyede en çok 3 bildirim gösterilir (`ui/src/context/LiveUpdatesProvider.tsx:54-55`, `ui/src/context/LiveUpdatesProvider.tsx:1629-1631`); yeniden bağlanmadan sonraki 2 saniye boyunca gösterilmez (`ui/src/context/LiveUpdatesProvider.tsx:56`, `ui/src/context/LiveUpdatesProvider.tsx:1998`).
- Yoklama, sekmenin görünürlüğünü hesaba katar: gizli sekmeler yoklamayı durdurur, yeniden açılan sekmeler küçük bir rastgele gecikme ekler; böylece sekmelerle dolu bir tarayıcı penceresi sunucuya aynı anda yüklenmez (`ui/src/lib/polling.ts:4-17`, `ui/src/lib/polling.ts:96-114`). Sık kullanılan sorgular sekmeler arasında paylaşılır: lider sekme veriyi çeker ve sonuçları diğerlerine yayınlar (`ui/src/hooks/useSharedPolling.ts:12-32`, `ui/src/hooks/useSharedPolling.ts:81-152`).

## 15. Ekranların kullanımını rahat kılan mekanizmalar

Her madde mekanizmayı ve nerede uygulandığını belirtir.

1. Her yerde tek durum dili. Her duruma ayrı bir şekil ve renk veren tek bir simge bileşeni listelerde, panolarda, üst bölümlerde, seçicilerde, filtrelerde, aramada ve Genel bakış ekranında kullanılır (`ui/src/components/StatusIcon.tsx:69-80`). Grafikler ve karar kuyruğu kendi renklerini eklemek yerine aynı renkleri ve şekilleri ödünç alır (`ui/src/components/ActivityCharts.tsx:221-237`; `ui/src/lib/attention.ts:85-110`). Kullanıcı bunu bir kez öğrenir.

2. Satırın tamamı tıklama hedefidir ve içindeki kontroller yine de çalışır. Satırlar içeriğin altında görünmez, tam boy bir bağlantı kullanır ve düğmeleri onun üstüne çıkarır (`ui/src/components/IssueRow.tsx:227`, `ui/src/components/IssueRow.tsx:233-245`). Durum ve atanan, görev açılmadan yerinde değiştirilebilir (`ui/src/components/IssuesList.tsx:2230-2237`, `ui/src/components/IssuesList.tsx:2322-2421`).

3. Üzerine gelme ve seçim vurgusu anında değişir. Satır vurgularında renk geçişi bilerek yoktur, çünkü yumuşak geçiş imleç hızlı hareket ettiğinde arkada iz bırakır (`ui/src/components/IssueRow.tsx:354-356`).

4. Klavye ile fare çakışmaz. Basılan tuş, son tuş basışından sonra imleç oynatıldıysa imlecin altındaki satıra, oynatılmadıysa klavyeyle seçili satıra uygulanır; imlecin altındaki satır bir ref içinde tutulduğu için listeyi hiçbir zaman yeniden çizdirmez; fare devralınca klavyenin seçim vurgusu kaybolur (`ui/src/pages/Inbox.tsx:1833-1861`, `ui/src/pages/Inbox.tsx:2187-2194`; `ui/src/components/IssuesList.tsx:735-759`).

5. Gelen kutusu, kullanıcı çalışırken yer değiştirmez. Yeni sıralama yalnızca sayfa açılırken, görünüm değişince, 150 saniye boşta kalınca ya da tarayıcı sekmesi 30 saniye gizli kaldıktan sonra uygulanır; arada satırlar yerini korur, yeni satırlar da yerlerine eklenir (`ui/src/pages/Inbox.tsx:1523-1593`; `ui/src/hooks/useInboxSortAttention.ts:3-4`, `ui/src/hooks/useInboxSortAttention.ts:59-75`; `ui/src/lib/inboxOrderPin.ts:75-116`).

6. Eylemler beklemeden gerçekleşir ve geri alınabilir. Arşivleme satırı hemen kaldırır, hata olursa tam o satırı eski yerine geri koyar ve `u` tuşuyla ya da bir "Undo" bildirimiyle geri alınabilir (`ui/src/pages/Inbox.tsx:1868-1947`; `ui/src/lib/inboxArchiveCache.ts:164-228`; `ui/src/pages/IssueDetail.tsx:5448-5516`). Yerel bir koruma, arka plandaki bir yeniden çekmenin satırı geri getirmesini 5 saniye boyunca engeller (`ui/src/lib/inboxArchiveCache.ts:8-9`).

7. Görev beklemeden açılır. Satır, verisini görev sayfasına yer tutucu olarak aktarır; satırın üzerine gelmek ya da Enter'a basmak da görevi ve ilk yorum sayfasını önceden yükler (`ui/src/components/IssueRow.tsx:193`, `ui/src/components/IssueRow.tsx:233-241`; `ui/src/components/IssuesList.tsx:1516-1521`; `ui/src/pages/IssueDetail.tsx:3101-3119`).

8. Yükleme ve boş ekranlar gerçek ekranın biçimini ve dilini taşır. Yükleme iskeletleri her yerleşimi yansıtır (`ui/src/components/PageSkeleton.tsx:16-179`). Boş ekran metinleri ekrana özeldir ("Inbox zero.", "No work is stopped.") ve varsa bir sonraki adımı sunar (görev oluştur, aramayı genişlet) (`ui/src/pages/Inbox.tsx:2715-2730`; `ui/src/components/BlockedInboxView.tsx:182-199`; `ui/src/components/IssuesList.tsx:1987-1994`; `ui/src/pages/Search.tsx:856-891`). Hata veren bir alt sorgu yalnızca bir bölümü etkiler ve geri kalanın çalıştığı söylenir (`ui/src/components/BlockedInboxView.tsx:150-180`; `ui/src/components/TaskChatThread.tsx:2913-2923`).

9. Ajanın işi önce özetlenir, ayrıntı istenince gösterilir. Önce yanıt, sonra "Worked", sonra aşamalar, sonra satırlar, sonra çıktı, sonra çalışma sayfası (bölüm 7.6). Sayılar, üzerine gelinene kadar göze batmaz (`ui/src/components/task-chat/TaskChatTurn.tsx:215-228`). Geçmiş, açılana kadar mount bile edilmez (`ui/src/components/task-chat/TaskChatTurn.tsx:157-163`).

10. Metinler dürüsttür. Özetler gözleneni anlatır ve hiçbir zaman başarı ileri sürmez (`ui/src/components/task-chat/completed-activity-summary.ts:28`, `ui/src/components/task-chat/completed-activity-summary.ts:101-110`). Yanıt bırakmayan çalışma bunu söyler (`ui/src/components/TaskChatThread.tsx:1816-1817`). Uygulama bir mesajın kaydedilip kaydedilmediğini bilmiyorsa bunu söyler ve kullanıcıdan kontrol etmesini ister (`ui/src/components/task-chat/TaskChatComposer.tsx:1208-1245`). Kaçırılan bir yeniden denemede "Next try 5m ago" değil, "Retry missed" yazar (`ui/src/components/IssueRecoveryActionCard.tsx:1230-1240`).

11. Canlı çıktı zıplamaz. Görünüm yeni içeriği yalnızca kullanıcı alta 48px'ten yakınsa izler; değilse konumu korur ve bir düğme gösterir (`ui/src/components/task-chat/TaskMessageScroller.tsx:9`, `ui/src/components/task-chat/TaskMessageScroller.tsx:146-178`). Akışın sonundaki canlı satır son yanıt gelene kadar tutulur; böylece çalışma ile yanıt arasında boş bir an olmaz (`ui/src/components/TaskChatThread.tsx:245`, `ui/src/components/TaskChatThread.tsx:2147-2192`).

12. Sorular kullanıcının yazacağı yerde belirir. Bekleyen istek geçmişin içinde kaybolmak yerine yazma kutusunun yerini alır; kapatılabilir ve geride bir hatırlatma bırakır; seçenek işaretlemek hiçbir zaman kendiliğinden ilerletmez (`ui/src/components/task-chat/TaskChatComposer.tsx:1120-1182`, `ui/src/components/task-chat/TaskChatComposer.tsx:1246-1261`; `ui/src/components/task-chat/QuestionForm.tsx:354-356`). [Düzeltme: kart yazma kutusunun yerini almaz, hemen üstünde durur; bkz. bölüm 7.9'daki not.]

13. Yazılan hiçbir şey kaybolmaz. Yeni görev penceresi, yazma kutusu (bileşen kaldırılırken ve sayfa kapanmadan önce de kaydedilir), soru yanıtları ve ret gerekçeleri için taslak tutulur; iptal edilen sıradaki mesaj yazma kutusuna geri döner; duraklatılmış durumda "Your draft is saved." yazar (`ui/src/components/NewIssueDialog.tsx:88-89`, `ui/src/components/NewIssueDialog.tsx:701-709`; `ui/src/components/task-chat/TaskChatComposer.tsx:574-604`; `ui/src/components/task-chat/QuestionForm.tsx:246-298`; `ui/src/pages/IssueDetail.tsx:5217-5248`; `ui/src/components/task-chat/TaskChatPausedTakeover.tsx:54`).

14. Durdurma, duraklatma ve iptal ayrıdır ve adları açıktır. Durdurma o anki yanıtı sonlandırır; duraklatma, yazma kutusunun yerini alan kendi bloğu olan bir görev ya da alt ağaç durumudur; alt ağaç eylemleri sayıları içeren bir ön izleme ve güvenli bir varsayılan düğme gösterir (`ui/src/pages/IssueDetail.tsx:4403-4412`; `ui/src/components/TaskTreeControls.tsx:105-185`; `DESIGN.md:58-66`).

15. Varsayılan olarak sessiz. Bildirimler birkaç olay türüyle sınırlıdır, kullanıcının kendi eylemleri ve ekrandaki görev için hiç gösterilmez, sıklıkları da sınırlanır (`ui/src/context/LiveUpdatesProvider.tsx:54-56`, `ui/src/context/LiveUpdatesProvider.tsx:845-878`, `ui/src/context/LiveUpdatesProvider.tsx:942-949`). Yazılı kural: "Do not show a toast for task or run state already visible on the current screen" (o an ekranda zaten görünen görev ya da çalışma durumu için bildirim gösterme) (`DESIGN.md:58`).

16. Hareketin bir işi ve tek bir kaynağı vardır. Görev akışındaki her animasyon bir `--motion-*` değişkenini okur; hareketi azaltma tercihi süreleri sıfıra indirir ama okuma süresi için yapılan bekletmeleri korur (`ui/src/index.css:272-276`, `ui/src/index.css:871-894`, `ui/src/index.css:898-905`). Genel bakış ekranı yalnızca ilk yüklemeden sonra gelen yeni satırları canlandırır (`ui/src/pages/Dashboard.tsx:225-260`).

17. Yoğun ama hizalı. Sabit genişlikte kimlik ve zaman sütunları, eş aralıklı yazılı kimlikler, sayılar için `tabular-nums`, yardımcı bilgi için 10px ve 11px yazı değişkenleri ve uzun listeleri bölen Today / Yesterday / Earlier çizgileri (`ui/src/components/IssueRow.tsx:335-344`; `ui/src/components/MetricCard.tsx:21`; `ui/src/index.css:2508-2509`; `ui/src/lib/task-date-groups.ts:26-37`).

18. Büyük listeler sanal liste olmadan da akıcı kalır. Satırlarda `content-visibility: auto`, ilk seferde 100 satır ve sona yaklaşınca 150 satır daha, memoize edilmiş satırlar (`ui/src/components/IssuesList.tsx:118-120`, `ui/src/components/IssuesList.tsx:2158-2163`; `ui/src/components/AttentionQueueRow.tsx:102-108`, `ui/src/components/AttentionQueueRow.tsx:239-242`).

19. Oluşturma bağlamı taşır. Gruptaki "+" o grubun değerini dolu getirir; ajan atamak Backlog durumunu Todo yapar ve bir not, Backlog'un görevi neden bekleteceğini açıklar (`ui/src/components/IssuesList.tsx:1621-1671`; `ui/src/components/NewIssueDialog.tsx:1520-1530`, `ui/src/components/NewIssueDialog.tsx:2309-2319`).

20. Görünümler hatırlanır ve paylaşılabilir. Liste görünüm durumu şirket ve liste başına saklanır, okunurken doğrulanır (`ui/src/lib/task-collection-preferences.ts:45-50`, `ui/src/lib/task-collection-preferences.ts:95-141`); sekmeler, arama, Denetim filtreleri ve çıktı filtreleri URL'de durur (`ui/src/App.tsx:427-431`; `ui/src/pages/Issues.tsx:89-97`; `ui/src/pages/audit/AuditRuns.tsx:166-176`; `ui/src/pages/Artifacts.tsx:69-72`).

21. Telefon kullanımı küçültülmüş değil, ayrıca tasarlanmıştır. Eşikleri belli kaydırarak arşivleme, rozetli beş gözlü alt menü, seçim kutusuna dönüşen sekme çubuğu, alttan açılan sayfa olarak özellikler, görünür ekran alanına göre boyutlanan yeni görev penceresi, dar kapsayıcılarda 36px'e büyüyen eylem düğmeleri (`ui/src/components/SwipeToArchive.tsx:13-15`; `ui/src/components/MobileBottomNav.tsx:44-69`; `ui/src/components/PageTabBar.tsx:21-39`; `ui/src/pages/IssueDetail.tsx:8253-8397`; `ui/src/components/NewIssueDialog.tsx:91-158`; `ui/src/components/AttentionQueueRow.tsx:58-62`).

## 16. Agent Office için yeniden kurma notları

Bu bölüm, üç temel ekranı yeniden kurmak için gereken en az şeyi sayar. Uç nokta yolları Paperclip'e aittir; her satır için eşdeğer bir Fastify yolu yeterlidir. Agent Office hakkındaki ifadeler Paperclip kodundan değil, Agent Office'in kendi proje kurallarından gelir.

### 16.1 Ortak yapı taşları

| Yapı taşı | Amaç | Paperclip'teki kaynak |
|---|---|---|
| `StatusGlyph` + `StatusIcon` | her durum için bir simge, 14/16/20px, isteğe bağlı seçici açılır menüsü | `ui/src/components/StatusGlyph.tsx`, `ui/src/components/StatusIcon.tsx` |
| `IssueRow` (görev sunumu) | üstüne bağlantı bindirilmiş satır; baştaki kontrol, durum, başlık, yardımcı bilgi, eylemler, kimlik ve zaman için yuvalar | `ui/src/components/IssueRow.tsx:217-348` |
| `IssueGroupHeader` | açılıp kapanan grup başlığı | `ui/src/components/IssueGroupHeader.tsx` |
| `CollectionToolbar` | yuvalara dayalı araç çubuğu çerçevesi | `ui/src/components/CollectionToolbar.tsx` |
| `PageTabBar` | çizgi biçiminde sekmeler, telefonda seçim kutusu | `ui/src/components/PageTabBar.tsx` |
| `EmptyState`, `PageSkeleton` | boş ekran ve yükleme durumları | `ui/src/components/EmptyState.tsx`, `ui/src/components/PageSkeleton.tsx` |
| görünüm durumu deposu | şirket ve liste başına sürüm numaralı localStorage zarfı | `ui/src/lib/task-collection-preferences.ts` |
| klavye yardımcıları | giriş alanlarında ve bir pencere açıkken tuşları yok sayar | `ui/src/lib/keyboardShortcuts.ts:1-33` |
| canlı güncelleme | sorguları geçersiz kılan tek bir şirket soketi, yedek olarak yoklama | `ui/src/context/LiveUpdatesProvider.tsx` |

### 16.2 Gelen kutusu

Görev başına en az satır verisi: `id, identifier, title, status, parentId, assigneeAgentId, assigneeUserId, projectId, labels, updatedAt, lastActivityAt, isUnreadForMe, archivedAt` (`CompactIssue` tipinin bir alt kümesi, `packages/shared/src/types/issue.ts:878-933`). İsteğe bağlı: `blockerAttention`, `liveDescendantCount`.

| Gereksinim | Paperclip'teki uç nokta |
|---|---|
| Açık işlerim | `GET /companies/:id/issues?view=compact&touchedByUserId=me&inboxArchivedByUserId=me&status=...&limit=500` |
| Okundu bilgisi | `POST` / `DELETE /issues/:id/read` |
| Arşivleme ve geri alma | `POST` / `DELETE /issues/:id/inbox-archive` |
| Onaylar | `GET /companies/:id/approvals`, `POST /approvals/:id/approve \| reject \| request-revision` |
| Başarısız çalışmalar | `GET /companies/:id/heartbeat-runs?limit=200&summary=true` (istemci her ajanın en son çalışmasını tutar); yeniden deneme bir ajan uyandırmasıdır: `POST .../wakeup { source: "on_demand", triggerDetail: "manual", reason: "retry_failed_run", failedRunId }` (`ui/src/api/agents.ts:272-284`) |
| Görev olmayan kayıtları listeden kaldırma | `GET/POST /companies/:id/inbox-dismissals`, `DELETE .../:itemKey` |
| Canlı rozeti | `GET /companies/:id/live-runs` ve çalışma olayları |
| Rozet sayısı | aynı sorgulardan hesaplanır (`ui/src/lib/inbox.ts:1265-1320`) |

Taşınacak istemci mantığı: kayıt birleşim tipi ve birleştirerek sıralama (`ui/src/lib/inbox.ts:59-79`, `ui/src/lib/inbox.ts:817-862`); iç içe gösterim (`ui/src/lib/inbox.ts:1087-1155`); gruplama (`ui/src/lib/inbox.ts:958-997`); klavyeyle gezilen girdiler (`ui/src/lib/inbox.ts:1192-1241`); sıranın sabitlenmesi (`ui/src/lib/inboxOrderPin.ts`, `ui/src/hooks/useInboxSortAttention.ts`); sunucu beklenmeden ekrana yansıyan arşivleme (`ui/src/lib/inboxArchiveCache.ts`); kaydırma hareketi (`ui/src/components/SwipeToArchive.tsx`).

Agent Office ile eşleme: "Onaylar" adındaki Onay Masası, buradaki onay satırları ile Onaylar sayfasındaki kartın (bölüm 4.16) karşılığıdır. Paperclip'in onay durumları `pending, revision_requested, approved, rejected`, Agent Office'in `pending, changes_requested, approved, rejected` durumlarıyla örtüşür. Kart düzeni (tür, isteyen, konu, "Recommended action", "On approval" ve "Risks" içerik blokları, ardından Onayla / Reddet / Düzeltme iste düğmeleri ve onaydan sonra tek ve açık bir sonraki adım) olduğu gibi yeniden kullanılabilir. Tek tek dışa etkili eylemlerin onayı için araç eylemi onay kartı daha iyi bir örnektir: araç adı, risk, son geçerlilik zamanı, ön izleme ve açılıp kapanan bir bölümün ardında "Arguments and audit hash" (bölüm 7.9).

### 16.3 Görev listesi

| Gereksinim | Uç nokta |
|---|---|
| Satırlar | `GET /companies/:id/issues?view=compact&limit=100&offset=N&sortField=updated&sortDir=desc` |
| Arama | aynısı, `q=` ve `limit=200` ile |
| Pano sütunları | aynısı, sütun başına `status=<one>` ve `limit=200` ile |
| Satır içi düzenlemeler | `PATCH /issues/:id { status }` ya da `{ assigneeAgentId, assigneeUserId }` |
| Başvuru listeleri | ajanlar, projeler, etiketler, kullanıcı dizini |
| Canlı rozeti | şirketin süren çalışmaları |

Taşınacak istemci mantığı: filtre durumu ve `applyIssueFilters` (`ui/src/lib/issue-filters.ts:15-53`, `ui/src/lib/issue-filters.ts:209-268`); görünüm durumunun biçimi (`ui/src/components/IssuesList.tsx:156-188`); sıralama (`ui/src/components/IssuesList.tsx:279-303`); grupların kurulması (`ui/src/components/IssuesList.tsx:1265-1356`); ağacın kurulması; parça parça çizim (`ui/src/components/IssuesList.tsx:1540-1619`); dnd-kit ile pano (`ui/src/components/KanbanBoard.tsx`). Filtreleme, sıralama ve gruplamanın tamamı istemcide, yüklenmiş satırlar üzerinde yapılır; sunucuya yalnızca arama ve sayfalama gider.

Agent Office için durum eşleme önerisi (`open, in_progress, awaiting_approval, awaiting_reply, done, cancelled`): `open`, `todo` şeklini alır (düz daire); `in_progress` dönen açık daireyi; `awaiting_approval`, `in_review` durumunun içi noktalı dairesini; `awaiting_reply`, Paperclip'in `in_review` + dış bekleme için zaten düz, boşta bir daire olarak çizdiği "waiting" çeşidini (`ui/src/components/StatusIcon.tsx:83`); `done` onay işaretli daireyi; `cancelled` yasak işaretini alır. Agent Office'te `backlog` ve `blocked` olmadığı için kesikli daire ile eksi işaretli daire boşta kalır.

### 16.4 Görev sayfası

Sohbet biçimindeki sayfanın ilk sürümü için en az gerekenler:

| Gereksinim | Uç nokta | Not |
|---|---|---|
| Görev | `GET /issues/:id`, `PATCH /issues/:id` | sunucu beklenmeden ekrana yansıyan güncelleme, hata olursa geri alınır |
| Mesajlar | `GET /issues/:id/comments?order=desc&limit=50&after=`, `POST /issues/:id/comments { body, clientRequestId }` | `clientRequestId`, istemcinin ekrana önceden yansıttığı mesajı sunucudan gelenle eşleştirmesini ve yinelenenleri yakalamasını sağlar |
| Görevin çalışmaları | `GET /issues/:id/runs` (durum, ajan, zamanlar, kullanım, hata, liveness, `nextAction`) | `ui/src/api/activity.ts:6-55` |
| Süren çalışma | `GET /issues/:id/live-runs` ya da soketteki çalışma olayları | |
| Çalışma dökümü | `GET /heartbeat-runs/:id/events`, `GET /heartbeat-runs/:id/log` | Agent Office, Claude API'yi doğrudan çağırdığı için yapılandırılmış adımları (metin, düşünme, araç çağrısı, araç sonucu, kullanım) saklayabilir ve kayıt ayrıştırmayı atlayabilir; `packages/adapter-utils/src/types.ts:647-664` içindeki kayıt türleri hazır bir listedir |
| Durdurma | `POST /heartbeat-runs/:id/cancel` | |
| Sorular ve onay istekleri | `GET /issues/:id/interactions`, `POST .../accept \| reject \| respond` | içerik biçimleri bölüm 7.9'da |
| Alt görevler | `GET ...issues?descendantOf=<id>` | |
| Belgeler | `GET/PUT /issues/:id/documents/:key`, sürümler | Agent Office'teki notlara ve taslaklara karşılık gelir |
| Dosya ekleri | listeleme, multipart yükleme, silme | |

Sonraya bırakılabilecekler: süren tura iletilebilen sıradaki mesajlar (bölüm 7.8), alt ağaç duraklatma kayıtları (7.16), belgelerde pasaj yorumları (7.13), kurtarma eylemleri (7.17).

Bileşenlerin yapım sırası: sabitleme kuralı olan akış kaydırıcısı; mesaj balonu; katlanabilen, yerleşmiş tur satırı; etkinlik aşaması ve araç satırı; işaretler ve sistem notları; taslak tutan ve mesajı sunucu beklenmeden gösteren yazma kutusu; yazma kutusunun yerini alan etkileşim kartları; Özellikler, Alt görevler, Belgeler ve Çıktılar sekmeli yan panel.

Korunacak durum kuralları (kullanım hissinin çoğunu bunlar taşır):

- akış öğeleri saklanmaz, türetilir: yorumlar + çalışmalar + etkileşimler + çıktılar zamana göre sıralanır, çalışmalar ürettikleri yanıta bağlanır (bölüm 7.5);
- bekleyen istek yazma kutusunun yerini alır ya da üstünde durur; yanıtlanan istek tek satırlık bir kayda dönüşür (7.9); [Düzeltme: kart yazma kutusunun yerini almaz, hemen üstünde durur; bkz. bölüm 7.9'daki not.]
- çalışma sürerken gönderilen mesaj kuyruğa girer, "Queued" diye gösterilir; süren tura iletilebilir, düzenlenebilir ya da silinebilir (7.8);
- durdurma, duraklatma değildir (7.7).

Agent Office kavramlarıyla eşleme: `awaiting_reply`, `ask_user_questions` türünde bir etkileşimin beklediği durumdur; `awaiting_approval`, araç eylemi içeren bir `request_confirmation` isteğinin beklediği durumdur. Agent Office'te dışa etkili her eylem Onay Masası'nda beklemek zorunda olduğu için, aynı bekleyen kayıt tek bir kayda dayanarak iki yerde görünmelidir: Onay Masası'nda bir satır olarak (Gelen kutusu kalıbı) ve görevde yazma kutusunun yerini alan kart olarak (akış kalıbı). Paperclip, `issue_thread_interaction` kayıtları için kararlar masasının veri akışı ile görev akışı arasında tam olarak bu ayrımı yapar (`packages/shared/src/types/attention.ts:8-21`; `ui/src/components/AttentionInteractionResolver.tsx`, ilk geçişte okundu). [Düzeltme: kart yazma kutusunun yerini almaz, hemen üstünde durur; bkz. bölüm 7.9'daki not.]

### 16.5 Agent Office'in tasarım kurallarıyla çatışan Paperclip kalıpları

Agent Office'in proje kuralları şunları ister: ayrım gölgeyle değil ince çizgiyle yapılır, başlıklarda yalnızca ilk harf büyük yazılır, büyük harfli üst etiket kullanılmaz, noktayla ayrılmış bilgi dizileri kullanılmaz, emoji kullanılmaz ve arayüz metinleri Türkçedir. Paperclip'in bazı ayrıntılarının uyarlanması gerekir:

| Paperclip kalıbı | Kanıt | Uyarlama |
|---|---|---|
| Büyük harfli ve harf aralığı açılmış bölüm ve grup etiketleri | `ui/src/components/IssueGroupHeader.tsx:38`; `ui/src/pages/Dashboard.tsx:486`; `ui/src/components/issue-properties/primitives.tsx:20-37` | yalnızca ilk harf büyük, aynı kalınlık |
| "·" ile ayrılmış bilgi satırları | `ui/src/components/task-chat/TaskChatTurn.tsx:30-44`; `ui/src/pages/Dashboard.tsx:390` | ayrı alanlar ya da sütunlar |
| Yazma kutusunda, sıradaki mesajlar tepsisinde ve kartlarda gölge | `ui/src/components/task-chat/TaskChatComposer.tsx:1186`; `ui/src/components/task-chat/TaskChatQueuedMessages.tsx:379-384` | yalnızca 1px kenarlık |
| Canlı göstergenin rengi olarak mavi, inceleme için mor | `ui/src/lib/status-colors.ts:190`, `ui/src/lib/status-colors.ts:221-229` | Agent Office değişkenleri (`--brand`, `--awaiting-approval`) |
| Ajan çalışırken dönüşümlü olarak gösterilen şakacı durum sözcükleri | `ui/src/components/task-chat/status-whimsy.ts:16-67` | yalnızca düz fiiller |
| "Worked for 38s" gibi İngilizce metinler ve etiketler | `ui/src/components/task-chat/TaskChatTurn.tsx:103-108` | kısa Türkçe karşılıklar |

Yapı (satırın kuruluşu, araç çubuğu yuvaları, akışın birleştirilmesi, yazma kutusunun yerini alan kartlar, sunucu beklenmeden ekrana yansıyan akışlar) değişmeden taşınır; yalnızca görünüş ve metinler farklıdır.

## 17. Bu incelemenin sınırları

- Tamamı okunanlar: görev sayfasının denetleyicisi (`ui/src/pages/IssueDetail.tsx`), sohbet akışı ve çizim katmanı (`ui/src/components/TaskChatThread.tsx`, `ui/src/components/task-chat/` içindeki dosyaların çoğu), yan panel ve özelliklerin temel bileşenleri, `Inbox.tsx`, `lib/inbox.ts`, `IssuesList.tsx`, `KanbanBoard.tsx`, `IssueFiltersPopover.tsx`, `Dashboard.tsx`, `Search.tsx`, `Timeline.tsx`, Denetim sayfaları, `Artifacts.tsx`, `Approvals.tsx`, `ApprovalDetail.tsx`, `WhatNeedsMe.tsx` ve kaynak gösterilen ortak tipler ile sabitler.
- Yalnızca kısmen ya da aramayla okunanlar: `ui/src/components/IssueChatThread.tsx` (klasik akış, 6.797 satır), `ui/src/pages/LegacyInbox.tsx` ve `ui/src/components/LegacyIssuesList.tsx` (eski kabuk, okunmadı), `ui/src/components/IssueThreadInteractionCard.tsx`, `ui/src/components/task-chat/TaskChatProtocolCard.tsx`, `ui/src/components/RunnerInspector.tsx`, `ui/src/components/MarkdownEditor.tsx`, `ui/src/components/issue-properties/IssueProperties.tsx` dosyasının 1900-2300 ve 3019-3246 satırları, `ui/src/pages/Cases.tsx`, `ui/src/pages/CaseDetail.tsx`, `ui/src/pages/Pipelines.tsx`, `ui/src/pages/PipelineSettings.tsx`. Bu dosyalarla ilgili ifadeler kaynak gösterilen satırlarla sınırlıdır. Kararlar masasının sayfa ve satır dışındaki bileşenleri (raf, kuyruk şeridi, tarih etiketleri, ayıklama şeridi, yanıtlayıcılar, kuyruk sayfası) ile durum kartları sayfaları bir kez okundu ve yalnızca kısaca anlatıldı.
- Sunucu davranışı incelenmedi. Uç noktalar ve içerikler, arayüz istemcisinin gönderdiği (`ui/src/api/*.ts`) ve ortak tiplerin tanımladığı biçimde verildi. Kimlik biçimi için tek bir sunucu satırı kaynak gösterildi.
- Hiçbir şey çalıştırılmadı; bu yüzden görsel sonuçlar (özel `--sz-*` değişkenlerinin tam piksel boyutları, gerçek animasyon süreleri) gözlenmedi, kaynak koddan alındı.
- Kaynak gösterimleri yazıldıktan sonra bir betikle denetlendi: gösterilen her dosya var ve her satır aralığı dosyanın içinde kalıyor (yaklaşık 180 dosyada yaklaşık 1.200 satır gösterimi). Ardından gösterilen her aralığın ilk satırları, onu kaynak gösteren cümleyle karşılaştırıldı ve bulunan uyuşmazlıklar düzeltildi. Bir aralık yine de desteklediği ifadeden birkaç satır daha geniş ya da daha dar olabilir.
