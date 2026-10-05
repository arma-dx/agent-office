# Paperclip: veri modeli, API uç noktaları, temel servisler

> Ara rapor. 3 Ekim 2026'da, Agent Office deposu okunmadan önce İngilizce yazıldı; depoya konurken Türkçeye çevrildi. Asıl belge `docs/paperclip-incelemesi.md` dosyasıdır; ikisi çelişirse o geçerlidir. Okuma notu ve bilinen düzeltmeler: [`00-okuma-notu.md`](00-okuma-notu.md).

Paperclip incelemesinin 04 numaralı raporu. Kapsam: Paperclip'in ajan çalıştırma dışında kalan çekirdeği (şema, enum değerleri, REST uç noktaları, temel servisler, kiracı yalıtımı, kimlik doğrulama, canlı olaylar, gizli anahtarlar, depolama) ve Agent Office gibi bir `company_id` + RLS modeliyle karşılaştırma.

## 0. Yöntem ve sınırlar

- Kaynak: `/home/claude/paperclip`, commit dd868ed. Aşağıdaki bütün yollar bu köke göredir. Kaynak gösterimi `path:line` biçimindedir.
- Çalışma salt okunurdu. Hiçbir şey kurulmadı, derlenmedi, test edilmedi ya da başlatılmadı. Ağ kullanılmadı. `/home/claude/pc-run` açılmadı.
- Sayılar (tablo, yol, göç, etkinlik eylemi), kaynak klasörleri üzerinde çalıştırılan salt okunur betiklerden gelir. Yol listesi, `router.<method>(` tanımlarının regex ile çıkarılmasıyla elde edildi: 62 yol dosyasında 891 tanım. Alışılmadık bir değişken adıyla tanımlanmış bir yol bu sayıya girmemiş olabilir.
- Uç noktaların amaç satırları, işleyicisini okuduğum yerlerde işleyiciden (satır numarası verildi), diğerlerinde `server/src/routes/openapi.ts` içinde o yol için kayıtlı özet metninden gelir.
- Bölüm 11'deki Agent Office bilgileri yalnızca görev talimatından ve konteynere aktarılan `CLAUDE.md` dosyasından gelir. Agent Office deposunun kendisi bu konteynerde yoktu.
- Çalıştırmanın iç işleyişi (heartbeat çalıştırıcısı, adaptörler, çalışma alanları, Paperclip'in kendi çalıştırıcısı) başka bir raporun konusudur. Burada yalnızca veri modelinin ya da temel bir servisin onlara dokunduğu yerlerde geçerler.
- Bayraklar: `instance_settings.experimental` ayarına bağlı olan her şey, varsayılan değeriyle birlikte "deneysel" diye işaretlendi.

## 1. Temel bulgular

1. Kiracı yalıtımı veritabanında değil, uygulama kodunda sağlanır. 226 tablonun 195'inde NOT NULL bir `company_id` var; ama 293 göçün hiçbirinde ve Drizzle şemasında RLS, politika, kısıtlı rol ya da şirket başına şema yok (bölüm 7).
2. İş birimi görevdir: tek atanan (ajan ya da kullanıcı, ikisi birden olamaz), tek bir koşullu UPDATE ile atomik üstlenme, otomatik uyandırmalı `blocks` ilişkileri, üst ve alt görev ağaçları, şirkete özel `PREFIX-N` kimliği (bölüm 2.3, 4.1, 6.1).
3. Belgede yazılı görev durum geçiş tablosunu servis uygulamaz. `assertTransition` yalnızca bilinmeyen durum adlarını reddeder (`server/src/services/issues.ts:304-309`). Asıl kapılar atanan, engelleyenler, üstlenme ve inceleme aşamalarıyla ilgili değişmez koşullar ile "engellenmiş görev neyi beklediğini göstermeli" kuralıdır (bölüm 4.1).
4. İnsan denetimi üç mekanizmayla işler: onaylar (4 tür, 5 durum), görev içi etkileşimler (yanıtlama kuralı olan 6 tür) ve bütçeler (kurallar, olaylar, otomatik duraklatma ve çalışma iptaliyle kesin durdurma) (bölüm 4, 6.2, 6.3).
5. Her değişiklik `activity_log` tablosuna aktör, ajan, çalışma ve belirlenen "adına çalışılan kişi" ile birlikte yazılır. Yaklaşık 487 farklı eylem adı var (bölüm 6.4).
6. Rutinler zamanlamaları, webhook'ları ve API çağrılarını göreve çevirir; çakışma ve kaçırılan tetiklenmeler için kuralları vardır (bölüm 6.6).
7. İnsanların girişi better-auth üzerinden e-posta ve parolayla yapılır. `server/src/auth/better-auth.ts` içinde MFA, passkey, sosyal hesapla giriş ya da SSO yapılandırılmamış (bölüm 8).
8. Ayrı bir kuyruk yok. Uyandırmalar ve çalışmalar, süreç içi bir zamanlayıcının yürüttüğü veritabanı satırlarıdır (`doc/SPEC-implementation.md:115-123`, `server/src/index.ts:1640-1829`).
9. Birkaç kalıcı silme yolu iz kaydı satırlarını da siler (şirket silme, ajan silme); şirket silme, o şirketin görüntüleyici olmayan her üyesine açıktır (bölüm 7.5).

## 2. Veritabanı katmanı

### 2.1 Genel yapı

| Konu | Bilgi | Kanıt |
|---|---|---|
| ORM | PostgreSQL üzerinde Drizzle ORM | `packages/db/src/schema/*.ts` |
| Şema dosyaları | 143 dosya (`index.ts` dâhil), 226 `pgTable` tanımı, yaklaşık 10.000 satır | `packages/db/src/schema/` üzerinde betikle sayım |
| Göçler | 0000 ile 0294 arasında numaralanmış 293 `.sql` dosyası (0126 ve 0130 yok), yaklaşık 11.400 SQL satırı, 293 kayıtlı göç günlüğü | `packages/db/src/migrations/`, `packages/db/src/migrations/meta/_journal.json` |
| Anlık görüntüler | Yalnızca 0290 ile 0294 arasındaki anlık görüntüler tutulur | `doc/DATABASE.md:227` |
| Uzantılar | `pg_trgm` ve `fuzzystrmatch` | `packages/db/src/migrations/0051_young_korg.sql:1`, `packages/db/src/migrations/0080_company_search_fuzzystrmatch.sql:1` |
| Tetikleyiciler | `paperclip_issue_status_version_trigger`, durum değişince `issues.status_version` değerini artırır; 0173 ve 0277 numaralı göçlerde iki tetikleyici daha var | `packages/db/src/migrations/0227_modern_pandemic.sql:146-158` |
| Çalıştırma biçimleri | `~/.paperclip/instances/default/db/` altında gömülü Postgres (varsayılan), Docker ile Postgres 17, Supabase gibi barındırılan Postgres | `doc/DATABASE.md:5-20`, `:46-73`, `:75-145` |
| Anahtarlar | `defaultRandom()` ile üretilen `uuid` birincil anahtarlar. İnsan kullanıcı kimlikleri `text` tipindedir (better-auth kimlikleri) | `packages/db/src/schema/issues.ts:29`, `:52` |
| Enum değerleri | Varsayılan değeri olan `text` sütunlarında saklanır. Değerler Postgres enum tiplerinde değil, `packages/shared/src/constants.ts` dosyasında ve zod doğrulayıcılarında durur | `packages/db/src/schema/issues.ts:44`, `:49` |
| CHECK kısıtları | Seyrek. Örnekler: görevlerde sohbet kimliği, Gelen kutusu arşivinde aktör türü, Gelen kutusu kuralının modu, gizli anahtar kapsamının biçimi, pasaj yorumunun sahibi | `issues.ts:96-104`, `issue_inbox_archives.ts:31-34`, `user_inbox_agent_policies.ts:25-28`, `company_secrets.ts:54-65`, `document_annotation_threads.ts:84-87` |

### 2.2 company_id kapsamı

226 tablonun tamamı üzerinde çalıştırılan betiğin sonucu:

| Sınıf | Sayı | Tablolar |
|---|---|---|
| `company_id` NOT NULL | 195 | temel iş tablolarının tümü |
| `company_id` boş olabilir | 6 | `company_transfer_runs`, `invites`, `plugin_entities`, `plugin_job_runs`, `plugin_logs`, `plugin_webhook_deliveries` |
| `company_id` yok | 25 | `user`, `session`, `account`, `verification`, `board_api_keys`, `cli_auth_challenges`, `companies`, `company_secret_versions`, `instance_settings`, `instance_user_roles`, `environments`, `environment_custom_image_templates`, `environment_custom_image_setup_sessions`, `pipeline_stages`, `pipeline_transitions`, `plugins`, `plugin_state`, `plugin_jobs`, `plugin_database_namespaces`, `plugin_migrations`, `decision_effect_executions`, `status_card_updates`, `user_sidebar_preferences`, `announcement_publications`, `announcement_dismissals` |

Birbirine bağlı satırların aynı şirketten olması her yerde aynı yolla sağlanmıyor:

- Eski temel tablolar tek sütunlu yabancı anahtar kullanır, örneğin `issues.project_id -> projects.id` (`packages/db/src/schema/issues.ts:37`). Veritabanı, bir satırın başka bir şirketin projesini göstermesini engellemez. Bunu servisler denetler; örneğin "Manager must belong to same company" (yönetici aynı şirketten olmalı) hatası (`server/src/services/agents.ts:454-461`).
- Yeni alt sistemler `company_id` içeren bileşik yabancı anahtar kullanır. 15 şema dosyasında 70 `foreignKey(` tanımı var ve 70'inin hepsinde yabancı sütunlar arasında `companyId` var (sohbet kanalları, GitHub, Teams aktarımları, e-posta, Paperclip'in kendi çalıştırıcısı, karar kuyrukları, yapay zekâ bağlantı varsayılanları, araç erişimi, ajan talimat sürümleri). Örnek: `packages/db/src/schema/agent_instruction_revisions.ts:115`. Bunları destekleyen tekil kısıtlar `agents_company_id_uq` (`agents.ts:45`), `issues_company_id_uq` (`issues.ts:105`) ve `issue_comments_company_id_uq`.

### 2.3 Temel tablolar

Tipler Drizzle dosyalarında yazıldığı gibi verildi. `ts`, `timestamp with time zone` demektir. Aşağıdaki her tabloda ayrıca `defaultNow()` varsayılanlı `created_at` (ve çoğunlukla `updated_at`) bulunur.

#### companies (`packages/db/src/schema/companies.ts:4-37`)

| Sütun | Tip ve varsayılan | Not |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | |
| `description` | text | |
| `status` | text, varsayılan `active` | `active, paused, archived` |
| `pause_reason`, `paused_at` | text, ts | |
| `issue_prefix` | text, varsayılan `PAP` | tekil dizin `companies_issue_prefix_idx` (`:35`) |
| `issue_counter` | integer, varsayılan 0 | `issue_number` değerinin kaynağı |
| `budget_monthly_cents`, `spent_monthly_cents` | integer, varsayılan 0 | şirket bütçe kuralının kopyası |
| `default_responsible_user_id` | text | etkinliğin kime bağlanacağı belirlenemezse kullanılan yedek değer |
| `require_board_approval_for_new_agents` | boolean, varsayılan false | işe alımları `pending_approval` durumuna çevirir |
| `interaction_resolver_governance` | jsonb, varsayılan `{}` | etkileşim yanıtlama kuralı için tür başına varsayılan ve üst sınır |
| `feedback_data_sharing_*` | boolean, ts, text, text | rıza takibi |

#### agents (`packages/db/src/schema/agents.ts:16-50`)

| Sütun | Tip ve varsayılan | Not |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null fk companies | bir ajan tam olarak bir şirkete aittir |
| `name` | text not null | kısa ad şirket içinde tekil olmalıdır (servis denetimi) |
| `role` | text, varsayılan `general` | 12 rol, bkz. bölüm 3 |
| `title`, `icon`, `appearance` | text, text, jsonb | |
| `status` | text, varsayılan `idle` | 7 durum |
| `reports_to` | uuid, kendine fk | organizasyon ağacı |
| `capabilities` | text | serbest metin |
| `adapter_type` | text, varsayılan `process` | |
| `adapter_config`, `runtime_config` | jsonb, varsayılan `{}` | |
| `default_environment_id` | uuid fk environments, set null | |
| `budget_monthly_cents`, `spent_monthly_cents` | integer, varsayılan 0 | |
| `pause_reason`, `paused_at`, `error_reason` | text, ts, text | |
| `permissions` | jsonb, varsayılan `{}` | `canCreateAgents` değerini ve güven ön ayarını tutar |
| `last_heartbeat_at` | ts | |
| `metadata` | jsonb | |

Dizinler: tekil `(company_id, id)`; `(company_id, status)`; `(company_id, reports_to)`; `(company_id, default_environment_id)` (`:45-48`).

#### issues (`packages/db/src/schema/issues.ts:26-205`)

| Grup | Sütunlar | Not |
|---|---|---|
| Kimlik | `id` uuid pk; `company_id` uuid not null; `issue_number` integer; `identifier` text | tekil `issues_identifier_idx` (`:136`) |
| İçerik | `title` text not null; `title_needs_generation` boolean, varsayılan false; `description` text | başlık, kimlik ve açıklama üzerinde trigram GIN dizinleri (`:137-139`) |
| Yapı | `project_id` fk projects; `project_workspace_id` fk set null; `goal_id` fk goals; `parent_id` kendine fk | |
| Durum | `status` text, varsayılan `backlog`; `status_version` bigint, varsayılan 0; `last_status_decision_id` uuid; `priority` text, varsayılan `medium`; `work_mode` text, varsayılan `standard`; `harness_kind` text; `review_policy` text | durum değerleri için CHECK yok |
| Sahiplik | `assignee_agent_id` fk agents; `assignee_user_id` text; `created_by_agent_id`; `created_by_user_id`; `responsible_user_id` | tek atanan kuralı bir kısıtta değil, serviste durur |
| Kilitler | `checkout_run_id` fk heartbeat_runs set null; `execution_run_id` fk set null; `execution_agent_name_key`; `execution_locked_at` | |
| Köken | `origin_kind` text, varsayılan `manual`; `origin_id`; `origin_run_id`; `origin_identity_context_id`; `continuation_identity_context_id`; `origin_fingerprint` text, varsayılan `default`; `request_depth` integer, varsayılan 0 | |
| Kural | `execution_policy` jsonb; `execution_state` jsonb; `assignee_adapter_overrides` jsonb; `billing_code` text | inceleme ve onay aşamaları `execution_policy` içinde durur |
| İzleme | `monitor_next_check_at`, `monitor_wake_requested_at`, `monitor_last_triggered_at`, `monitor_attempt_count` varsayılan 0, `monitor_notes`, `monitor_scheduled_by` | |
| Çalışma alanı | `execution_workspace_id` fk set null; `execution_workspace_preference`; `execution_workspace_settings` jsonb | |
| Güven ve engelleme | `source_trust` jsonb; `unblock_descriptor` jsonb; `blocked_transition_at`; `blocked_owner_notified_at` | |
| Sohbet | `conversation_agent_id`, `conversation_user_id`, `conversation_state` (`active`, `waiting`), `conversation_session_generation` varsayılan 0, `conversation_boundary_comment_id` | deneysel ajan sohbeti görevlerin üzerine kuruludur; CHECK `:96-104` satırlarında |
| Zaman damgaları | `started_at`, `completed_at`, `cancelled_at`, `hidden_at`, `created_at`, `updated_at` | |

Dizinler ve tekil kısıtlar: `(company_id, status)`, `(company_id, assignee_agent_id, status)`, `(company_id, assignee_user_id, status)`, adına çalışılan kişi, üst görev, proje, köken, çalışma alanları, izleme zamanı, güncellenme, oluşturulma, öncelik (`:106-135`). Kısmi tekil dizinler şunların her biri için tek bir açık görev olmasını güvenceye alır: rutin çalıştırma parmak izi (`:140-148`), canlılık olayı, hareketsiz kalmış çalışmanın değerlendirilmesi, görev gözcüsü, ortada kalmış görevin kurtarılması (`:149-196`); ayrıca şirket başına tek bir ilk kurulum görevi (`:201-203`).

Görünür görevler `hidden_at IS NULL AND harness_kind IS NULL` koşulunu sağlayanlardır (`server/src/services/issue-visibility.ts:5-16`).

#### Göreve bağlı tablolar

| Tablo | Sütunlar (önemlileri) | Kısıtlar | Dosya |
|---|---|---|---|
| `issue_comments` | `issue_id` fk cascade; `author_agent_id`; `author_user_id` text; `on_behalf_of_user_id` fk user; `author_type` (`user, agent, system`); `created_by_run_id`; `derived_author_*`; `client_request_id`; `conversation_session_generation`; `body` text not null; `presentation` jsonb; `metadata` jsonb; mantıksal silme `deleted_at`, `deleted_by_*`; `source_trust` jsonb | tekil `(issue_id, author_user_id, client_request_id)`; tekil `(company_id, id)`; gövde üzerinde trigram GIN | `issue_comments.ts:15-65` |
| `issue_relations` | `issue_id` (engelleyen), `related_issue_id` (engellenen), `type` yalnızca `blocks`, `created_by_*` | tekil ilişki `(company_id, issue_id, related_issue_id, type)` | `issue_relations.ts:6-30` |
| `labels` | `name`, `color` | tekil `(company_id, name)` | `labels.ts:4-18` |
| `issue_labels` | `issue_id`, `label_id`, `company_id` | pk `(issue_id, label_id)` | `issue_labels.ts:6-20` |
| `documents` | `title`; `format` varsayılan `markdown`; `latest_body` not null; `latest_revision_id`; `latest_revision_number` varsayılan 1; `created_by_*`, `updated_by_*`; `locked_at`, `locked_by_*`; `source_trust` | başlık ve gövde üzerinde trigram GIN | `documents.ts:6-33` |
| `document_revisions` | `document_id` fk cascade; `revision_number`; `title`; `format`; `body`; `change_summary`; `created_by_agent_id`, `created_by_user_id`, `created_by_run_id` | tekil `(document_id, revision_number)` | `document_revisions.ts:7-34` |
| `issue_documents` | `issue_id`, `document_id`, `key` | tekil `(company_id, issue_id, key)`; tekil `document_id` | `issue_documents.ts:6-30` |
| `issue_work_products` | `project_id`, `issue_id`, `execution_workspace_id`, `runtime_service_id`, `type`, `provider`, `external_id`, `title`, `url`, `status`, `review_state` varsayılan `none`, `is_primary` varsayılan false, `health_status` varsayılan `unknown`, `summary`, `metadata`, `source_trust`, `created_by_run_id` | görev ve tür, çalışma alanı, sağlayıcı ve dış kimlik üzerinde dizinler | `issue_work_products.ts:18-66` |
| `assets` | `provider`, `object_key`, `content_type`, `byte_size` bigint, `sha256`, `original_filename`, `created_by_*` | tekil `(company_id, object_key)` | `assets.ts:5-26` |
| `issue_attachments` | `issue_id`, `asset_id`, `issue_comment_id`, `originating_run_id` | tekil `asset_id` | `issue_attachments.ts:8-30` |
| `issue_read_states` | `issue_id`, `user_id` text, `last_read_at` | tekil `(company_id, issue_id, user_id)` | `issue_read_states.ts:5-25` |
| `issue_inbox_archives` | `issue_id`, `user_id`, `archived_by_actor_type` varsayılan `user`, `archived_by_agent_id`, `archived_by_run_id`, `archived_at` | tekil `(company_id, issue_id, user_id)` | `issue_inbox_archives.ts:8-36` |
| `inbox_dismissals` | `user_id`, `item_key`, `kind` (`dismiss`, `snooze`), `dismissed_at`, `snoozed_until` | tekil `(company_id, user_id, item_key)` | `inbox_dismissals.ts:4-26` |
| `user_inbox_agent_policies` | `user_id`, `mode` (`open`, `allowlist`, `disabled`), `allowed_agent_ids` jsonb | tekil `(company_id, user_id)` | `user_inbox_agent_policies.ts:5-30` |
| `issue_thread_interactions` | `issue_id`; `kind`; `status` varsayılan `pending`; `continuation_policy` varsayılan `wake_assignee`; `requested_resolver_policy` ve `effective_resolver_policy` varsayılan `anyone`; `resolver_policy_provenance` varsayılan `inherited`; `effective_resolver_policy_source` varsayılan `requested`; `idempotency_key`; `origin_comment_ids` jsonb; `source_comment_id`; `source_run_id`; `title`; `summary`; `created_by_*`; `addressee_agent_id`, `addressee_user_id`; `resolved_by_*`; `payload` jsonb not null; `result` jsonb; `resolved_at` | anahtarın boş olmadığı satırlarda kısmi tekil `(company_id, issue_id, idempotency_key)` | `issue_thread_interactions.ts:16-80` |

#### Hedefler ve projeler

| Tablo | Sütunlar | Kısıtlar | Dosya |
|---|---|---|---|
| `goals` | `title`, `description`, `level` varsayılan `task`, `status` varsayılan `planned`, `parent_id` kendine fk, `owner_agent_id` | dizin `(company_id)` | `goals.ts:12-29` |
| `projects` | `goal_id` (eski tek hedef alanı), `name`, `description`, `status` varsayılan `backlog`, `lead_agent_id`, `target_date` date, `color`, `icon`, `env` jsonb, `pause_reason`, `paused_at`, `execution_workspace_policy` jsonb, `archived_at` | dizin `(company_id)` | `projects.ts:7-31` |
| `project_goals` | `project_id`, `goal_id`, `company_id` | pk `(project_id, goal_id)` | `project_goals.ts:6-21` |
| `project_memberships` | `project_id`, `user_id` text, `state` varsayılan `joined`, `starred_at` | tekil `(company_id, user_id, project_id)` | `project_memberships.ts:5-31` |
| `agent_memberships` | ajanlar için aynı yapı | şirket, kullanıcı ve ajan başına tekil | `agent_memberships.ts:5-31` |
| `document_memberships` | `document_id`, `user_id`, `starred_at` | tekil `(company_id, user_id, document_id)` | `document_memberships.ts:5-28` |

`project_memberships` ve `agent_memberships` yalnızca kenar çubuğunu belirler. Satır yoksa katılmış sayılır. Erişimi kısıtlamazlar (`doc/DATABASE.md:242-251`).

#### Onaylar

| Tablo | Sütunlar | Kısıtlar | Dosya |
|---|---|---|---|
| `approvals` | `type` text; `requested_by_agent_id`; `requested_by_user_id`; `status` varsayılan `pending`; `payload` jsonb not null; `decision_note`; `decided_by_user_id`; `decided_at` | dizin `(company_id, status, type)` | `approvals.ts:5-28` |
| `approval_comments` | `approval_id`, `author_agent_id`, `author_user_id`, `body` | | `approval_comments.ts:6-26` |
| `issue_approvals` | `issue_id`, `approval_id`, `linked_by_agent_id`, `linked_by_user_id` | pk `(issue_id, approval_id)` | `issue_approvals.ts:7-23` |

#### Etkinlik, maliyet, bütçe

| Tablo | Sütunlar | Kısıtlar | Dosya |
|---|---|---|---|
| `activity_log` | `actor_type` varsayılan `system`; `actor_id` text; `action` text; `entity_type` text; `entity_id` text; `agent_id` fk; `run_id` fk heartbeat_runs; `responsible_user_id` text; `details` jsonb; `created_at` | dizinler `(company_id, created_at)`, `(company_id, agent_id, created_at)`, `(company_id, responsible_user_id, created_at)`, `run_id`, `(entity_type, entity_id)` | `activity_log.ts:6-37` |
| `cost_events` | `agent_id` not null; `issue_id`; `project_id`; `goal_id`; `heartbeat_run_id`; `billing_code`; `provider`; `biller` varsayılan `unknown`; `billing_type` varsayılan `unknown`; `cost_status` varsayılan `reported`; `model`; `input_tokens`, `cached_input_tokens`, `output_tokens` integer, varsayılan 0; `cost_cents` integer; `occurred_at` | şirket ve zaman, ajan, sağlayıcı, faturalayan ve çalışma üzerinde dizinler | `cost_events.ts:9-54` |
| `finance_events` | `event_kind`; `direction` varsayılan `debit`; `biller`; `provider`; `execution_adapter_type`; `pricing_tier`; `region`; `model`; `quantity`; `unit`; `amount_cents`; `currency` varsayılan `USD`; `estimated` varsayılan false; `external_invoice_id`; `metadata_json`; `cost_event_id`; ajan, görev, proje, hedef ve çalışma bağlantıları | şirket ve zaman, faturalayan, tür ve yön üzerinde dizinler | `finance_events.ts:10-67` |
| `budget_policies` | `scope_type`; `scope_id` uuid; `metric` varsayılan `billed_cents`; `window_kind`; `amount` integer, varsayılan 0; `warn_percent` varsayılan 80; `hard_stop_enabled` varsayılan true; `notify_enabled` varsayılan true; `is_active` varsayılan true; `created_by_user_id`, `updated_by_user_id` | tekil `(company_id, scope_type, scope_id, metric, window_kind)` | `budget_policies.ts:4-43` |
| `budget_incidents` | `policy_id`; `scope_type`, `scope_id`; `metric`; `window_kind`; `window_start`, `window_end`; `threshold_type`; `amount_limit`; `amount_observed`; `status` varsayılan `open`; `approval_id`; `resolved_at` | durumu `dismissed` olmayan satırlarda kısmi tekil `(policy_id, window_start, threshold_type)` | `budget_incidents.ts:7-42` |

#### Çalışmalar ve uyandırmalar (yalnızca özet, ayrıntısı çalıştırma raporunda)

| Tablo | Amaç | Dosya |
|---|---|---|
| `heartbeat_runs` | Her ajan çalışması için bir satır: `invocation_source` varsayılan `on_demand`, `trigger_detail`, `status` varsayılan `queued`, `responsible_user_id`, başlangıç ve bitiş zamanları, `error`, `error_code`, `exit_code`, `usage_json`, `result_json`, oturum kimlikleri, çalışma kaydının referansı ve özet değeri, yeniden deneme zinciri (`retry_of_run_id`), canlılık alanları, `context_snapshot` jsonb | `heartbeat_runs.ts:20-166` |
| `heartbeat_run_events` | Çalışma başına sıralı olay akışı (`seq` çalışma içinde tekil, `event_type`, `stream`, `level`, `message`, `payload`) | `heartbeat_run_events.ts:18-50` |
| `agent_wakeup_requests` | Kalıcı uyandırma kuyruğu: `source`, `trigger_detail`, `reason`, `payload`, `status` varsayılan `queued`, `coalesced_count`, isteyen, `idempotency_key`, `run_id` | `agent_wakeup_requests.ts:15-92` |
| `agent_runtime_state` | Ajan başına oturum kimliği, durum JSON'u, token toplamları, `total_cost_cents`, son hata | `agent_runtime_state.ts:5-27` |
| `agent_task_sessions` | Ajan, adaptör ve görev anahtarı başına oturum | `agent_task_sessions.ts:16-57` |
| `agent_api_keys` | `agent_id`, `company_id`, `name`, `key_hash`, `responsible_user_id`, `scope_config` jsonb, `last_used_at`, `revoked_at` | `agent_api_keys.ts:6-24` |
| `agent_config_revisions` | `source` varsayılan `patch`, `rolled_back_from_revision_id`, `changed_keys`, `before_config`, `after_config` | `agent_config_revisions.ts:5-28` |

#### Rutinler (`packages/db/src/schema/routines.ts`)

| Tablo | Sütunlar | Satırlar |
|---|---|---|
| `routines` | `project_id`, `folder_id`, `goal_id`, `parent_issue_id`, `title`, `description`, `assignee_agent_id`, `priority` varsayılan `medium`, `status` varsayılan `active`, `concurrency_policy` varsayılan `coalesce_if_active`, `catch_up_policy` varsayılan `skip_missed`, `activity_gate_policy` varsayılan `always`, `activity_gate_scope` varsayılan `company`, `origin_kind` varsayılan `manual`, `origin_id`, `variables` jsonb, `env` jsonb, `latest_revision_id`, `latest_revision_number` varsayılan 1, `responsible_user_id`, `last_triggered_at`, `last_enqueued_at` | `:23-65` |
| `routine_revisions` | `revision_number` (rutin içinde tekil), `title`, `description`, `snapshot` jsonb, `change_summary`, `restored_from_revision_id`, oluşturan alanları | `:67-104` |
| `routine_triggers` | `kind`, `label`, `enabled` varsayılan true, `setup_pending`, `archived`, `last_webhook_delivery`, `cron_expression`, `timezone`, `next_run_at`, `last_fired_at`, `public_id` (tekil), `secret_id` fk company_secrets, `signing_mode`, `replay_window_sec`, `last_rotated_at`, `last_result` | `:106-142` |
| `routine_runs` | `trigger_id`, `source`, `status` varsayılan `received`, `triggered_at`, `routine_revision_id`, `responsible_user_id`, `idempotency_key`, `trigger_payload`, `dispatch_fingerprint`, `linked_issue_id`, `coalesced_into_run_id`, `failure_reason`, `completed_at` | `:144-179` |
| `routine_webhook_test_receipts` | `trigger_id`, `delivery_key_hash`, tetikleyici başına tekil | `:182-190` |

#### Erişim ve kimlik doğrulama

| Tablo | Sütunlar | Kısıtlar | Dosya |
|---|---|---|---|
| `user`, `session`, `account`, `verification` | better-auth tabloları | | `auth.ts:3-68` |
| `company_memberships` | `principal_type` (`user`, `agent`), `principal_id` text, `status` varsayılan `active`, `membership_role` | tekil `(company_id, principal_type, principal_id)` | `company_memberships.ts:4-29` |
| `instance_user_roles` | `user_id`, `role` varsayılan `instance_admin` | tekil `(user_id, role)` | `instance_user_roles.ts:3-16` |
| `principal_permission_grants` | `principal_type`, `principal_id`, `permission_key`, `scope` jsonb, `granted_by_user_id` | tekil `(company_id, principal_type, principal_id, permission_key)` | `principal_permission_grants.ts:4-29` |
| `invites` | `company_id` boş olabilir, `invite_type` varsayılan `company_join`, `token_hash` tekil, `allowed_join_types` varsayılan `both`, `defaults_payload`, `expires_at`, `invited_by_user_id`, `revoked_at`, `accepted_at` | | `invites.ts:4-29` |
| `join_requests` | `invite_id` tekil, `request_type`, `status` varsayılan `pending_approval`, `request_ip`, `requesting_user_id`, `request_email_snapshot`, `agent_name`, `adapter_type`, `capabilities`, `agent_defaults_payload`, `claim_secret_hash`, `claim_secret_expires_at`, `claim_secret_consumed_at`, `created_agent_id`, onay ve ret alanları | kullanıcı ve e-posta başına tek bir bekleyen insan isteği için kısmi tekil dizinler | `join_requests.ts:7-48` |
| `board_api_keys` | `user_id` fk user cascade, `name`, `key_hash` tekil, `last_used_at`, `revoked_at`, `expires_at` | | `board_api_keys.ts:4-20` |
| `cli_auth_challenges` | `secret_hash`, `command`, `client_name`, `requested_access` varsayılan `board`, `requested_company_id`, `pending_key_hash`, `pending_key_name`, `approved_by_user_id`, `board_api_key_id`, `approved_at`, `cancelled_at`, `expires_at` | | `cli_auth_challenges.ts:6-30` |

#### Gizli anahtarlar ve ayarlar

| Tablo | Sütunlar | Kısıtlar | Dosya |
|---|---|---|---|
| `company_secrets` | `scope` varsayılan `company`; `owner_user_id`; `user_secret_definition_id`; `key`; `name`; `provider` varsayılan `local_encrypted`; `status` varsayılan `active`; `managed_mode` varsayılan `paperclip_managed`; `external_ref`; `provider_config_id`; `provider_metadata`; `latest_version` varsayılan 1; `description`; `last_resolved_at`; `last_rotated_at`; `deleted_at` | şirket kapsamında ad ve anahtar üzerinde kısmi tekil dizinler; kapsam biçimi için CHECK | `company_secrets.ts:8-67` |
| `company_secret_versions` | `secret_id` fk cascade; `version`; `material` jsonb; `value_sha256`; `provider_version_ref`; `status` varsayılan `current`; `fingerprint_sha256`; `rotation_job_id`; `revoked_at` | tekil `(secret_id, version)` | `company_secret_versions.ts:5-28` |
| `company_secret_bindings` | `secret_id`; `target_type`; `target_id` text; `config_path`; `version_selector` varsayılan `latest`; `required` varsayılan true; `label`; `projection_class` varsayılan `unclassified`; `projection_allowlist_key` | tekil `(company_id, target_type, target_id, config_path)` | `company_secret_bindings.ts:5-33` |
| `company_secret_provider_configs` | şirket başına sağlayıcı kasası yapılandırması | | `company_secret_provider_configs.ts:6-33` |
| `company_secret_proposals` | ajanın gizli anahtar ya da bağlama önerileri, `kind`, `status`, `value_ciphertext`, `justification`, `interaction_id`, `expires_at` | | `company_secret_proposals.ts:10-73` |
| `secret_access_events` | `secret_id`; `secret_scope`; `version`; `provider`; `responsible_user_id`; kimlik bilgisinin sahibi ve öznesi; `actor_type`; `actor_id`; `consumer_type`; `consumer_id`; `config_path`; `issue_id`; `heartbeat_run_id`; `plugin_id`; `outcome`; `error_code` | şirket, gizli anahtar, kullanan taraf ve çalışma üzerinde dizinler | `secret_access_events.ts:9-50` |
| `user_secret_definitions`, `user_secret_declarations` | her üyenin kendisi için doldurduğu, kullanıcıya özel gizli anahtar yuvaları | | `user_secret_definitions.ts:7-37`, `user_secret_declarations.ts:6-40` |
| `instance_settings` | `singleton_key` varsayılan `default` (tekil), `default_environment_id`, `general` jsonb, `experimental` jsonb | | `instance_settings.ts:4-18` |

### 2.4 Alanlara göre kalan tablolar

Tek satırlık amaçlar her tablonun sütunlarından (hepsi okundu) ve belirtilen yerlerde belgelerden çıkarıldı.

| Alan | Tablolar | Amaç |
|---|---|---|
| Görev yardımcı tabloları | `issue_watchdogs` | bir görev ağacı için ayarlanan gözcü ajan; son gözlenen ve son incelenen durumun parmak izleriyle birlikte |
| | `issue_plan_decompositions` | kabul edilen bir plan sürümünün alt görevlere tam bir kez çevrildiğini gösteren kayıt (deneysel bayrak `enableIssuePlanDecompositions`, varsayılan false) |
| | `issue_recovery_actions` | takılı kalmış bir görev için açıkça tanımlanmış kurtarma kaydı: tür, sahip, kanıt, denemeler, sonuç |
| | `issue_reference_mentions` | başlık, açıklama, yorum ya da belgeden çıkarılan, görevden göreve göndermeler |
| | `issue_create_idempotency_keys` | tekrar önleme anahtarından oluşturulan göreve eşleme, 7 gün saklanır (`server/src/services/issues.ts:236-238`) |
| | `issue_question_response_deliveries` | kullanıcının yanıtının süren ajan turuna geri iletilmesinin takibi |
| | `issue_tree_holds`, `issue_tree_hold_members` | bütün bir alt görev ağacına uygulanan duraklatma, iptal ya da geri yükleme; üyelerin anlık görüntüsüyle birlikte |
| | `issue_execution_decisions` | inceleme ve onay aşamalarındaki onay ya da düzeltme isteme kararları |
| | `external_objects`, `external_object_mentions` | görevlerde söz edilen dış öğeler (örneğin pull request'ler) ve önbelleğe alınmış durumları (deneysel `enableExternalObjects`, varsayılan false) |
| | `feedback_votes`, `feedback_exports` | çıktılara verilen olumlu ya da olumsuz oy ve rızaya bağlı, isteğe bağlı dışa aktarım |
| | `decision_training_examples` | eğitim amaçlı dışa aktarım için bir görevin ve kararın belirli bir andaki anlık görüntüsü (`doc/DATABASE.md:253-261`) |
| Belgelerde pasaj yorumları | `document_annotation_threads`, `document_annotation_comments`, `document_annotation_anchor_snapshots` | bir belge sürümündeki metin aralığına bağlanan yorum dizileri ve bağlandıkları yerin yeniden eşleme geçmişi |
| Skill'ler | `company_skills`, `company_skill_versions`, yıldızlar, yorumlar, test girdileri, test çalışması şablonları, test çalışmaları (`company_skills.ts`), `company_skill_policies`, `company_skill_sources` | sürümleri, testleri, kuralı ve GitHub kaynakları olan şirket skill kitaplığı |
| Decisions (deneysel `enableDecisions`, varsayılan false) | `decision_bundles`, `decisions`, `decision_target_issues`, `decision_effect_executions` | seçenekleri, girdileri, imzalı tanımı ve etkileri olan yapılandırılmış karar istekleri |
| | `decision_queues`, `decision_queue_items`, `decision_triage`, `decision_triage_events`, `decision_retention`, `decision_archive_notification_outbox` | `(source_kind, source_id)` anahtarlı kuyruklar, erteleme ve saklama yan tabloları (`doc/DATABASE.md:263-271`) |
| Özetler ve kartlar (deneysel, varsayılan false) | `status_cards`, `status_card_updates` | sorgulara derlenen ve bir ajanın yenilediği, kayıtlı "interest prompt" (ilgi alanı istemi) kartları |
| | `summary_slots` | kapsam (proje, çalışma alanı) başına üretilen tek bir özet belgesi |
| Organizasyon | `folders` | skill ve rutin gibi öğe türleri için klasörler |
| | `company_logos`, `company_onboarding_seeds`, `company_user_sidebar_preferences`, `user_sidebar_preferences` | marka bilgileri, ilk kurulum başlangıç verisi, kenar çubuğu sıralaması |
| | `company_transfer_runs` | parçalı dışa ya da içe aktarma işinin durumu |
| | `announcement_publications`, `announcement_dismissals` | kurulum duyuruları ve kullanıcı başına yok sayma kaydı |
| Ajan profilleri | `agent_instruction_revisions` (sürümler, güncel sürüm işaretçileri, çalışma kopyaları), `managed_agent_profiles`, `remote_agent_profiles`, `built_in_managed_resources`, `agent_session_goal_actions` | sürümlenen talimat dosyaları, barındırılan ajan profilleri, ürünle birlikte gelen yerleşik ajanlar |
| Cases ve Pipelines (deneysel `enableCases`, `enablePipelines`, varsayılan false) | `cases`, `case_issue_links`, `case_events`, `case_documents`, `case_labels`, `case_attachments` | görevleri, belgeleri ve dosya eklerini gruplayan case kayıtları |
| | `pipelines`, `pipeline_stages`, `pipeline_transitions`, `pipeline_cases`, `pipeline_case_issue_links`, `pipeline_case_blockers`, `pipeline_documents`, `pipeline_case_documents`, `pipeline_automation_executions`, `pipeline_case_events` | aşamalı pipeline'lar; case'ler aşamalar arasında ilerler ve rutin tetikleyebilir |
| Çalıştırma ve çalışma alanları | `execution_workspaces`, `execution_workspace_runtime_leases`, `project_workspaces`, `workspace_operations`, `workspace_runtime_services`, `environments`, `environment_leases`, `environment_custom_image_templates`, `environment_custom_image_setup_sessions`, `adapter_auth_sessions` | ajanların çalıştığı yerler: depolar, worktree'ler, sandbox'lar, kiralamalar, çalışma zamanı servisleri |
| Paperclip'in kendi çalıştırıcısı | `completion_contracts`, `native_run_results`, `native_run_finalizations`, `work_assessments`, `status_decisions`, `status_decision_effects`, `run_identity_contexts`, `provider_trace_records`, `runner_api_response_reservations`, `heartbeat_run_watchdog_decisions` | bu çalıştırıcının durum belirleme ve sonuç kayıtları (`doc/DATABASE.md:273-322`) |
| Sohbet kanalları (deneysel `enableChatConnectors`, varsayılan false) | `chat_endpoints`, `chat_endpoint_resources`, `chat_external_principals`, `chat_identity_links`, `chat_conversations`, `chat_deliveries`, `chat_publications`, `chat_message_links`, `chat_actions`, `chat_agent_routes`, `chat_endpoint_leases`, `chat_sdk_state`, `chat_task_handoffs`, `chat_completion_deliveries`, `chat_discord_command_owners`, `chat_github_configurations`, `chat_github_registrations`, `chat_github_reviews`, `chat_teams_file_transfers` | Slack, Discord, Teams, GitHub ve benzeri bağlayıcılar: gelen iletimler, giden yayınlar, kimlik bağlantıları |
| E-posta | `email_endpoints`, `email_messages`, `email_sends` | gelen kutusu uç noktaları, saklanan iletiler ve gönderim kayıtları |
| Araç erişimi | `tool_applications`, `tool_connections`, `connection_grants`, `connection_grant_members`, `connection_grant_delegations`, `tool_connection_installs`, `tool_oauth_states`, `tool_catalog_entries`, `tool_profiles`, `tool_profile_entries`, `tool_profile_bindings`, `tool_mcp_gateways`, `tool_mcp_gateway_tokens`, `tool_policies`, `tool_runtime_slots`, `tool_stdio_command_templates`, `tool_gateway_sessions`, `tool_gateway_rate_limit_counters`, `tool_invocations`, `tool_action_requests`, `tool_call_events`, `connection_token_issuances`, `tool_rate_limit_counters`, `tool_runtime_metric_counters`, `tool_access_audit_events`, `tool_action_deliveries`, `connection_event_deliveries`, `connection_intent_deliveries`, `ai_connection_defaults`, `ai_provider_defaults`, `browser_use_settings`, `browser_use_sessions`, `browser_use_runs`, `browser_use_browsers` | dış araç ve MCP geçidi: bağlantılar, izinler, katalog, profiller, kurallar, çağrılar, onay istekleri, denetim |
| Eklentiler | `plugins`, `plugin_config`, `plugin_company_settings`, `plugin_managed_resources`, `plugin_state`, `plugin_entities`, `plugin_database_namespaces`, `plugin_migrations`, `plugin_jobs`, `plugin_job_runs`, `plugin_webhook_deliveries`, `plugin_logs` | eklenti kayıt defteri, şirket başına ayarlar, eklentiye ait durum ve işler |
| Test araçları | `smoke_runs`, `smoke_run_steps` | Smoke Lab çalışmaları (deneysel `enableSmokeLab`, varsayılan false; `server/src/services/smoke-lab.ts:485`) |

### 2.5 TASKS.md ile gerçek şemanın karşılaştırması

`doc/TASKS.md` kendini hedef model olarak tanımlar (`doc/TASKS.md:3-5`): "some of this is already implemented, some is aspirational" (bir kısmı uygulanmış, bir kısmı hedef). Şemayla karşılaştırma:

| TASKS.md'deki kavram | Şemadaki durum | Kanıt |
|---|---|---|
| Anahtarı ve takım başına görev numarası olan takımlar (`:116-136`, `:333-344`) | `teams` tablosu yok. Ön ek (şirket kodu) ve sayaç şirket başına tutulur | `companies.ts:13-14`; `packages/db/src/schema` içinde `pgTable("teams"` yok |
| Takım başına, kategorili iş akışı durumları (`:59-95`) | `workflow_states` tablosu yok. Durum, 7 değerli sabit bir metindir | `issues.ts:44`, `packages/shared/src/constants.ts:189-197` |
| 0 ile 4 arasında sayısal öncelik (`:99-112`) | Metin: `critical, high, medium, low`; varsayılan `medium` | `issues.ts:49`, `constants.ts:210` |
| Görevlerde `estimate`, `dueDate`, `sortOrder`, `archivedAt`, `milestoneId`, `teamId` (`:39-55`) | Yok. Arşiv sütunu yerine `hidden_at` var | `issues.ts:26-93` |
| Kilometre taşları (`:166-179`), girişimler (`:314-329`) | Böyle tablolar yok. Hedef rolünü seviyeli `goals` tablosu üstlenir | `goals.ts:12-29` |
| Etiket kapsamları ve grupları (`:183-207`) | Düz, şirket düzeyinde etiketler | `labels.ts:4-18` |
| İlişki türleri `related, blocks, blocked_by, duplicate` (`:220-246`) | Yalnızca `blocks` | `issue_relations.ts`, `constants.ts:426` |
| Tek atanan (`:250-260`) | Uygulanmış; ajan ya da kullanıcı olacak biçimde genişletilmiş | `server/src/services/issues.ts:9777-9779` |
| Alt görevler (`:264-281`) | `parent_id` ile uygulanmış. Okunan satırlarda alt görevlerin otomatik kapatılması bulunmadı | `issues.ts:40` |
| `parentId` ve `resolvedAt` alanlı yorum dizileri (`:299-310`) | Düz yorumlar. Dizili yorum yalnızca belgelerdeki pasaj yorumlarında var | `issue_comments.ts:15-65` |

## 3. Enum değerleri ve sabitler

Aksi belirtilmedikçe hepsi `packages/shared/src/constants.ts` dosyasından.

| Ad | Değerler | Satır |
|---|---|---|
| Şirket durumu | `active, paused, archived` | `:1` |
| Kurulum modu | `local_trusted, authenticated` | `:4` |
| Kurulumun dışa açıklığı | `private, public` | `:7` |
| Ağ bağlama modu | `loopback, lan, tailnet, custom` | `:10` |
| Ajan durumu | `active, paused, idle, running, error, pending_approval, terminated` | `:16-24` |
| Ajan adaptör türleri | `process, http, claude_local, codex_local, paperclip_runner, cursor_cloud, gemini_local, grok_local, hermes_gateway, hermes_local, kimi_local, opencode_local, pi_local, cursor, openclaw_gateway` | `:27-43` |
| Ajan rolleri | `ceo, cto, cmo, cfo, security, engineer, designer, pm, qa, devops, researcher, general` | `:46-59` |
| Ajan başına varsayılan en çok eş zamanlı çalışma | 20 | `:77` |
| Görev durumu | `backlog, todo, in_progress, in_review, done, blocked, cancelled` | `:189-197` |
| Gelen kutusu "mine" (benim) durumları | `cancelled` dışındakilerin tümü | `:200-207` |
| Görev önceliği | `critical, high, medium, low` | `:210` |
| Görev inceleme kuralı | `anyone, not_creator, human_only` | `:212` |
| Görev çalışma modu | `standard, ask, planning, skill_test` | `:214` |
| En büyük istek derinliği | 1024 | `:218` |
| Yorum yazarı türü | `user, agent, system` | `:232` |
| Etkileşim türü | `suggest_tasks, ask_user_questions, request_confirmation, request_checkbox_confirmation, request_item_verdicts, connection_intent` | `:259-266` |
| Etkileşim yanıtlama kuralı | `anyone, not_creator, human_only` (eski takma adlar `board_or_agents`, `board_only`) | `:269-280` |
| Yanıtlama kuralının kökeni | `explicit, inherited, legacy_inherited_restriction` | `:296-300` |
| Geçerli kuralın kaynağı | `requested, company_cap, governed_action` | `:304-308` |
| Etkileşim durumu | `pending, accepted, rejected, answered, cancelled, expired, failed` | `:331-339` |
| Etkileşim devam kuralı | `none, wake_assignee, wake_assignee_on_accept` | `:342-346` |
| Görev köken türü | `manual, routine_execution, stale_active_run_evaluation, harness_liveness_escalation, issue_productivity_review, stranded_issue_recovery, task_watchdog, task_watchdog_product_bug, onboarding_first_task, chat_channel`, ayrıca `plugin:*` | `:356-371` |
| Kurtarma eylemi türü | `missing_disposition, deliberate_wait_without_target, stranded_assigned_issue, workspace_validation, configuration_validation, active_run_watchdog, issue_graph_liveness` | `:377-385` |
| Kurtarma eylemi durumu | `active, escalated, resolved, cancelled` | `:390-395` |
| Görev ilişki türü | `blocks` | `:426` |
| Ağaç kontrol modu | `pause, resume, cancel, restore` | `:429` |
| Pasaj yorumu dizisinin durumu | `open, resolved` | `:455` |
| Pasaj yorumunun bağlandığı yerin durumu | `active, stale, orphaned` | `:458` |
| Yürütme aşaması türü | `review, approval` | `:521` |
| Yürütme durumu | `idle, pending, changes_requested, completed` | `:540` |
| Aşama kararının sonucu | `approved, changes_requested` | `:559` |
| Hedef seviyesi | `company, team, agent, task` | `:562` |
| Hedef durumu | `planned, active, achieved, cancelled` | `:565` |
| Proje durumu | `backlog, planned, in_progress, completed, cancelled` | `:568-574` |
| Rutin durumu | `active, paused, archived` | `:633` |
| Rutin çakışma kuralı | `coalesce_if_active, always_enqueue, skip_if_active` | `:636` |
| Rutin kaçırılanlar kuralı | `skip_missed, enqueue_missed_with_cap` | `:639` |
| Rutin etkinlik kapısı | kural `always, require_external_activity`; kapsam `company, project` | `:642`, `:645` |
| Rutin tetikleyici türü | `schedule, webhook, api` | `:648` |
| Tetikleyici imzalama modu | `bearer, app_webhook, hmac_sha256, github_hmac, fireflies_hmac, none` | `:651` |
| Rutin değişken tipi | `text, textarea, number, boolean, select, date` | `:654` |
| Rutin çalışması durumu | `received, coalesced, skipped, issue_created, completed, failed` | `:657-664` |
| Rutin çalışması kaynağı | `schedule, manual, api, webhook` | `:667` |
| Duraklatma nedeni | `manual, budget, system, company_archived, import` | `:673` |
| Onay türü | `hire_agent, approve_ceo_strategy, budget_override_required, request_board_approval` | `:689-694` |
| Onay durumu | `pending, revision_requested, approved, rejected, cancelled` | `:697-703` |
| Gizli anahtar sağlayıcısı | `local_encrypted, aws_secrets_manager, gcp_secret_manager, vault` | `:706-711` |
| Gizli anahtar durumu | `active, disabled, archived, deleted` | `:732` |
| Gizli anahtar kapsamı | `company, user` | `:735` |
| Gizli anahtar yönetim modu | `paperclip_managed, external_reference` | `:738` |
| Gizli anahtar sürümünün durumu | `current, previous, disabled, destroyed, failed` | `:741-747` |
| Gizli anahtar bağlama hedefi türü | `agent, project, environment, routine, plugin, issue, run, tool_connection, system` | `:750-760` |
| Gizli anahtar erişim sonucu | `success, failure, missing, inactive, not_allowed, optional_omitted, provider_error` | `:763-771` |
| Depolama sağlayıcısı | `local_disk, s3` | `:823` |
| Faturalama türü | `metered_api, subscription_included, subscription_overage, credits, fixed, unknown` | `:826-833` |
| Maliyet durumu | `reported, unpriced` | `:836` |
| Finans olayı türü | `inference_charge` ile `manual_adjustment` arasında 14 tür | `:839-854` |
| Finans yönü | `debit, credit` | `:857` |
| Bütçe kapsam türü | `company, agent, project` | `:875` |
| Bütçe ölçütü | `billed_cents` | `:878` |
| Bütçe dönemi türü | `calendar_month_utc, lifetime` | `:881` |
| Bütçe eşik türü | `soft, hard` | `:884` |
| Bütçe olayı durumu | `open, resolved, dismissed` | `:887` |
| Olay çözüm eylemi | `keep_paused, raise_budget_and_resume` | `:890-893` |
| Çalışmanın çağrı kaynağı | `timer, assignment, on_demand, automation` | `:896-901` |
| Uyandırma tetikleyici ayrıntısı | `manual, ping, callback, system` | `:904` |
| Uyandırma isteği durumu | `queued, deferred_issue_execution, claimed, coalesced, skipped, completed, failed, cancelled` | `:907-916` |
| Çalışma durumu | `queued, scheduled_retry, running, succeeded, interrupted, failed, cancelled, timed_out` | `:919-928` |
| Çalışma canlılık durumu | `completed, advanced, plan_only, empty_response, blocked, failed, needs_followup` | `:931-939` |
| Canlı olay türü | `heartbeat.run.queued, heartbeat.run.status, heartbeat.run.progress, heartbeat.run.event, heartbeat.run.log, agent.session.goal.changed, agent.status, activity.logged, external_object.updated, plugin.ui.updated, plugin.worker.crashed, plugin.worker.restarted` | `:942-955` |
| Kimlik sahibi türü | `user, agent` | `:958` |
| Üyelik durumu | `pending, active, suspended, archived` | `:961` |
| Şirket üyelik rolü | `owner, admin, operator, viewer, member` (insanlar ilk dördünü kullanır) | `:964-978` |
| Kurulum rolü | `instance_admin` | `:988` |
| Davet türü | `company_join, bootstrap_ceo` | `:991` |
| Davetle katılma türü | `human, agent, both` | `:994` |
| Katılma isteği durumu | `pending_approval, approved, rejected` | `:1000` |
| İzin anahtarı | `agents:create, agents:configure, agents:suggest-changes, skills:create, skills:suggest-changes, environments:manage, tools:admin, tools:manage_connections, tools:manage_profiles, tools:view_audit, audit:view_agent_actions, tools:use, tools:manage_runtime, inbox:manage, users:invite, users:manage_permissions, tasks:assign, tasks:assign_scope, tasks:manage_active_checkouts, pipelines:write, joins:approve` | `:1003-1025` |
| Araç kuralı türü | `allow, block, require_approval, trust_rule, rate_limit` | `:1141-1147` |
| Araç kuralı kararı | `allow, deny, require_approval, rate_limited, defer_runtime` | `:1150` |
| Araç eylemi isteği durumu | `pending, approved, executing, rejected, expired, cancelled, executed, failed` | `:1177-1185` |
| Çıktı türü | `preview_url, runtime_service, pull_request, branch, commit, artifact, document` | `packages/shared/src/validators/work-product.ts:9-36` |
| Çıktı durumu | `active, ready_for_review, approved, changes_requested, merged, closed, failed, archived, draft` | aynı |
| Çıktı inceleme durumu | `none, needs_board_review, approved, changes_requested` | aynı |
| İlgi bekleyenlerin kaynak türü | `approval, decision, issue_thread_interaction, join_request, recovery_action, productivity_review (legacy), blocker_attention, review, failed_run, budget_alert, agent_error_alert` | `packages/shared/src/types/attention.ts:8-21` |
| Arama kapsamı | `all, issues, comments, documents, artifacts, agents, projects` | `packages/shared/src/types/search.ts:3` |
| Arama sıralaması | `relevance, updated, created, priority` | `packages/shared/src/types/search.ts:6` |

Uyandırma nedenleri `agent_wakeup_requests.reason` alanında serbest metin olarak tutulur. Yollarda ve servislerde görülenler: `issue_assigned`, `issue_status_changed`, `issue_commented`, `issue_reopened_via_comment`, `issue_checked_out`, `issue_blockers_resolved`, `issue_children_completed`, `interaction_pending`, `approval_approved`, `issue_tree_restored`, `issue_tree_resumed`, `issue_unblock_requested`, `issue_recovery_action_restored`, `retry_failed_run`, `heartbeat_timer`, `issue_monitor_recovery`, `secret_proposal_resolved`, `email_received`, `task_watchdog_stopped_subtree`, `status_card_update_assigned`, `status_card_compile_assigned`, `summary_slot_generation_requested`, `skill_test_run_created`, `goal_control`, `execution_review_requested`, `execution_approval_requested`, `execution_changes_requested`. Kaynaklar: `server/src/routes` ve `server/src/services` içindeki uyandırma çağrılarında sabit olarak yazılmış `reason:` değerleri (grep), adına çalışılan kişi taşıyan nedenlerin kümesi (`server/src/services/heartbeat.ts:1258-1273`) ve engelleyen uyandırması sabiti (`server/src/services/issue-dependency-wakeups.ts:6`). Tanılama uç noktası ayrıca `issue_execution_deferred`, `issue_dependencies_blocked`, `issue_tree_hold_active`, `missing_issue_comment`, `process_lost_retry`, `run_liveness_continuation`, `heartbeat.disabled` gibi atlama nedenlerini de bilir (`server/src/routes/issues.ts:1406-1421`).

Deneysel bayraklar (`packages/shared/src/types/instance.ts:42-149`) ve `server/src/services/instance-settings.ts:269-305` satırlarındaki varsayılanları: varsayılan olarak açık olanlar `enableNativeRunner`, `enableStreamlinedLeftNavigation`, `enableStreamlinedUi`, `enableApps`, `enableMcpAggregators`, `enableWorkspaceBranchReconcileForward`, `enableWorkspaceDirtyQuarantineRepair`. Varsayılan olarak kapalı olanlar: `enableEnvironments`, `enableIsolatedWorkspaces`, `enableChatConnectors`, `enableMemoryConnectors`, `enablePipelines`, `enableCases`, `enableAgentChat`, `enableConferenceRoomChat`, `enableIssuePlanDecompositions`, `enableExternalObjects`, `enableSmokeLab`, `enableBuiltInAgents`, `enableBetaSkills`, `enableSummaries`, `enableStatusCards`, `enableDecisions`, `enableGoalsSidebarLink` ve geri kalanlar. Sunucu tarafında kapısı olanlar: sohbet bağlayıcıları (`server/src/routes/chat-channels.ts:101`), Cases (`server/src/routes/cases.ts:68`), durum kartları (`server/src/routes/status-cards.ts:29`), özetler (`server/src/routes/summary-slots.ts:35`), yerleşik ajanlar (`server/src/routes/built-in-agents.ts:80`), ajan sohbeti (`server/src/routes/issues.ts:17269`) ve dış nesneler (`server/src/routes/issues.ts:3716`). `server/src` üzerinde yapılan grep, ayar servisi dışında `enableDecisions` ya da `enablePipelines` için sunucu tarafında bir denetim bulmadı; bu ikisi yalnızca arayüz kapısı gibi görünüyor.

## 4. Durum makineleri ve kurallar

### 4.1 Görev

Belgede yazılı geçişler (`doc/SPEC-implementation.md:514-523`):

- `backlog -> todo, cancelled`
- `todo -> in_progress, blocked, cancelled`
- `in_progress -> in_review, blocked, done, cancelled`
- `in_review -> in_progress, done, cancelled`
- `blocked -> todo, in_progress, cancelled`

Kodun uyguladığı kurallar:

| Kural | Kanıt |
|---|---|
| Bilinen her durumdan bilinen her duruma geçilebilir. `assertTransition` yalnızca bilinmeyen adları reddeder | `server/src/services/issues.ts:304-309` |
| `in_progress` durumuna girilince `started_at`, `done` durumunda `completed_at`, `cancelled` durumunda `cancelled_at` yazılır | `server/src/services/issues.ts:311-327` |
| Yalnızca tek bir atanan olabilir (ajan ya da kullanıcı) | `server/src/services/issues.ts:9777-9779`, `:10734-10736` |
| `in_progress` durumu atanan ister | `server/src/services/issues.ts:9788-9794`, `:10737-10743` |
| Çözülmemiş engelleyen varken `in_progress` reddedilir (422) | `server/src/services/issues.ts:10744-10775` |
| Engelleyen yalnızca `done` olduğunda çözülmüş sayılır. İptal edilen engelleyen çözülmemiş kalır | `server/src/services/issues.ts:2650-2656`, `doc/execution-semantics.md:245` |
| `blocked` durumuna girmek için çözülmemiş bir engelleyen, bekleyen bir etkileşim, göreve bağlı bekleyen bir onay ya da bir `unblockDescriptor` gerekir; yoksa 422 döner | `server/src/routes/issues.ts:13305-13366` |
| Bir ajan, engeli kaldıracak taraf olarak yalnızca kendisini gösterebilir | `server/src/routes/issues.ts:13251-13284` |
| `in_progress` durumundan çıkmak ya da atananı değiştirmek üstlenme ve yürütme kilitlerini temizler | `server/src/services/issues.ts:10884-10900` |
| Sahiplik değişince `status_version` artar ve görev için kullanıcının istediği uyandırmalar iptal edilir | `server/src/services/issues.ts:10956-10968` |
| Görev kapanınca bekleyen etkileşimler süresi dolmuş sayılır ve özet yuvaları kesinleştirilir | `server/src/services/issues.ts:11037-11103` |
| Bir insan görevi Bitti olarak işaretlediğinde görev o kullanıcının Gelen kutusunda arşivlenir | `server/src/services/issues.ts:11228-11262` |
| Engelleme döngüsü olamaz, görev kendini engelleyemez, ilişki yalnızca aynı şirket içinde kurulur | `server/src/services/issues.ts:7347-7388`, `:7390-7446` |
| İnceleme ve onay aşamaları: `execution_policy` içinde bekleyen aşama varken atanan `done` ya da `in_review` isterse görev zorunlu olarak `in_review` durumuna alınır ve aşamanın bir katılımcısına devredilir. Onaylamak için yorum ve `done` gerekir; düzeltme istemek için yorum gerekir ve görev önceki atanana döner. Aşamayı yalnızca etkin inceleyen ya da onaylayan ilerletebilir | `server/src/services/issue-execution-policy.ts:614-624`, `:787-789`, `:851-861`, `:944`, `:966-1044` |
| Görevdeki inceleme kuralı: `human_only` kararı yalnızca bir kullanıcının vermesine izin verir; `not_creator`, görevi `in_review` durumuna taşıyan aktörün karar vermesini yasaklar | `server/src/services/issue-review-policy.ts:100-147` |

Üstlenme (`server/src/services/issues.ts:11375-11629`, yol `server/src/routes/issues.ts:15038-15190`):

- Tek bir koşullu UPDATE `assignee_agent_id` alanını yazar, `assignee_user_id` alanını temizler, `checkout_run_id`, `execution_run_id`, `status = 'in_progress'` ve `started_at` değerlerini yazar. Bunu yalnızca şu koşullar birlikte sağlanırsa yapar: görev beklenen bir durumdadır; atanmamıştır ya da aynı ajana ve çalışmaya aittir; yürütme kilidi boştur ya da aynı çalışmanın elindedir (`:11441-11479`).
- Ağaç duraklatması etkinken (`:11392-11415`), çözülmemiş engelleyen varken (`:11420-11439`) ve yol düzeyinde, proje duraklatılmışken (`server/src/routes/issues.ts:15051-15062`) reddedilir.
- Bitmiş çalışmaları gösteren eskimiş kilitler önce temizlenir ve devralınabilir (`:11417-11418`, `:11500-11604`).
- Aynı çalışmadan gelen yinelenen çağrılar görevi döndürür (`:11606-11620`). Geri kalan her durumda 409 "Issue checkout conflict" döner (`:11622-11628`).
- Bir ajan yalnızca kendi adına üstlenebilir ve çalışma kimliğini göndermek zorundadır (`server/src/routes/issues.ts:15064-15086`).

Bırakma (`server/src/services/issues.ts:11784-11850`): önce satır kilidi alınır; yalnızca atanan ajan bırakabilir (`:11800-11806`); bırakma yalnızca görevi üstlenen çalışmadan yapılabilir, o çalışma bitmişse ya da yoksa bu koşul aranmaz (`:11807-11826`); `in_progress` durumu `todo` olur, diğer durumlar değişmez (`:11831-11832`); görev zaten `done` ya da `cancelled` değilse atanan ajan temizlenir (`:11830`, `:11837`); bütün kilit sütunları temizlenir (`:11838-11841`). Yönetim kurulu için zorla bırakma da vardır (`:11852-11898`, yol `server/src/routes/issues.ts:15231-15277`).

### 4.2 Ajan

| Geçiş | Kural | Kanıt |
|---|---|---|
| oluşturma | `idle`; şirket yeni ajanlar için yönetim kurulu onayı istiyorsa `pending_approval` | `server/src/routes/agents.ts:4633-4634` |
| `pending_approval -> idle` | yalnızca onayla (`activatePendingApproval`). Yapılandırma onaya kadar dondurulur | `server/src/services/agents.ts:710-727`, `:1095-1100` |
| duraklatma | sonlandırılmamış her ajan duraklatılabilir; `pause_reason` (`manual`, `budget`, `system`) yazılır ve süren çalışmalar yol düzeyinde iptal edilir | `server/src/services/agents.ts:951-969`, `server/src/routes/agents.ts:5630-5654` |
| sürdürme | `idle` durumuna döner; `terminated` ya da `pending_approval` durumundan yapılamaz, raporlama zinciri geçersizse reddedilir | `server/src/services/agents.ts:971-992`, `server/src/routes/agents.ts:5656-5689` |
| hatayı temizleme | yalnızca `error` durumundan `idle` durumuna | `server/src/services/agents.ts:994-1022` |
| sonlandırma | geri alınamaz; bütün API anahtarlarını geçersiz kılar, ajanın kendi çalışmalarını ve ona bağlı olup raporlama zinciri geçersiz kalan ajanların çalışmalarını iptal eder | `server/src/services/agents.ts:1024-1045`, `:707-709`, `server/src/routes/agents.ts:5777-5845` |
| bütçe duraklatması | bütçedeki kesin durdurma, ajanı `budget` nedeniyle `paused` durumuna alır | `server/src/services/budgets.ts:214-250` |
| şirket arşivleme | bütün etkin ajanlar `company_archived` nedeniyle duraklatılır, şirket yeniden etkinleştirilince `idle` durumuna döner | `server/src/services/companies.ts:76-115`, `:392-408` |
| silme | kalıcı silme; yerleşik ajanlar için yasak | `server/src/services/agents.ts:1047-1093` |

Organizasyon ağacı: `reports_to` aynı şirketten olmalı ve döngü oluşturmamalıdır (`server/src/services/agents.ts:454-473`).

### 4.3 Onay

- `pending -> approved | rejected | revision_requested | cancelled`
- Yeniden gönderimle `revision_requested -> pending`, ya da doğrudan `approved | rejected`
- Kanıt: karar verilebilen durumlar `pending, revision_requested` (`server/src/services/approvals.ts:16`), tekrarlanınca aynı sonucu veren koşullu güncelleme (`:45-87`), iptal (`:128-142`), düzeltme isteme yalnızca `pending` durumundan (`:234-253`), yeniden gönderim yalnızca `revision_requested` durumundan (`:255-275`).
- Yan etki yalnızca `hire_agent` türünde vardır: onay, bekleyen ajanı etkinleştirir ya da oluşturur, aylık bütçe kuralını ekler ya da günceller ve işe alma kancasını çağırır (`:144-213`); ret, bekleyen ajanı sonlandırır (`:215-232`).
- `budget_override_required` onaylarını bütçe servisi oluşturur (`server/src/services/budgets.ts:385`). Bütçe olayı çözülünce bağlı onay onaylandı ya da reddedildi durumuna alınır (`server/src/services/budgets.ts:866-958`). Böyle bir onay genel onay yolundan onaylanırsa durumu değişir ve isteyen ajan uyandırılır (`server/src/routes/approvals.ts:286-400`); servis türe özgü yan etkiyi yalnızca `hire_agent` için ekler (`server/src/services/approvals.ts:154`, `:223`).
- `request_board_approval` onaylarını araç geçidi, yüksek riskli araçlar için oluşturur (`server/src/services/tool-gateway.ts:2453-2489`).
- `approve_ceo_strategy` için sunucu tarafında ayrı bir işleyici yok. Adının geçtiği diğer tek yer olarak `server/src/services/native-runtime/runner-api-reference.ts:655` bulundu.

### 4.4 Diğer yaşam döngüleri

| Kayıt | Yaşam döngüsü | Kanıt |
|---|---|---|
| Görev içi etkileşim | `pending -> accepted, rejected, answered, cancelled, expired, failed`. Bekleyen etkileşimler; görev kapanınca, daha yeni bir istek yerlerini alınca ya da bir kullanıcı yorumu yerlerini alınca süresi dolmuş sayılır | `packages/shared/src/constants.ts:331-339`, `server/src/services/issue-thread-interactions.ts:4311`, `:4726` |
| Rutin çalışması | `received -> issue_created -> completed or failed`; ya da `coalesced`; ya da `skipped`; ya da `failed` | `server/src/services/routines.ts:1850-2014`, `:3296-3378` |
| Bütçe olayı | `open -> resolved` (bütçeyi yükselt ve sürdür) ya da `dismissed` (duraklatılmış bırak) | `server/src/services/budgets.ts:866-958` |
| Katılma isteği | `pending_approval -> approved or rejected` | `server/src/routes/access.ts:4199-4395` |
| Şirket | `active`, `paused`, `archived`. Arşivleme ajanları duraklatır, sıradaki ve süren çalışmalarla bekleyen uyandırmaları iptal eder. Kalıcı silme vardır | `server/src/services/companies.ts:76-140`, `:496-587` |
| Gizli anahtar önerisi | `pending -> approved, rejected, withdrawn, expired` | `packages/db/src/schema/company_secret_proposals.ts:10-73` |
| Belge | `baseRevisionId` ile iyimser eş zamanlılık denetimi; kilitleme ve kilidi açma; sürümü geri yükleme | `server/src/services/documents.ts:350-397` |

## 5. API uç noktaları

Katman sırası (`server/src/app.ts`): JSON ayrıştırıcıları, `/api` üzerinde sıkıştırma, HTTP log bileşeni, özel ana makine adı koruması, aktör ara katmanı, `/api/auth/*` üzerinde better-auth işleyicisi, ardından `boardMutationGuard()` ile bütün yol modüllerini taşıyan ve `/api` altına bağlanan tek bir API yönlendiricisi (`:522-579`, `:641-962`). Bilinmeyen `/api` yolları 404 döndürür (`:963-965`). Şirket yolları `/api/companies` (`:657`), bulut yolları `/api/cloud` (`:656`), kimlik doğrulama profil yolları `/api/auth` (`:575`) altına bağlanır.

Büyüklük (dosya başına yol tanımı sayısı): issues 94, agents 83, tool-access 81, company-skills 54, pipelines 51, access 42, chat-channels 39, secrets 38, plugins 30, companies 24, environments 21, cases 20, costs 20, tool-gateway 19, routines 18, smoke-lab 15, projects 14, email 14, decision-queues 12, status-cards 12, instance-settings 11, approvals 10, adapters 10, ai-connections 10, execution-workspaces 10 ve daha küçük dosyalar. Toplam 891.

Belgeleme uç noktaları:

- `GET /api/openapi.json`, zod şemalarından "Paperclip API" başlıklı bir OpenAPI 3.0.0 belgesi üretir (`server/src/routes/openapi.ts:11541-11563`). Beş güvenlik şeması tanımlar: yönetim kurulu oturum çerezi `paperclip_session`, yönetim kurulu API anahtarı için bearer, ajan için bearer (API anahtarı ya da çalışma JWT'si), çalışma zamanı araçları için bearer, göreve bağlı ajan JWT'si (`:1690-1727`); ayrıca her işlemi `x-paperclip-authorization` ile etiketler (`:1747-1758`). Herkese açık işlemleri (`:1299-1320`) ve yalnızca yönetim kuruluna açık ön ekleri (`:1322-1328`) listeler. Dosya üzerinde çalıştırılan bir regex 769 yöntem, yol ve özet üçlüsü bulur.
- `GET /llms/agent-configuration.txt`, `GET /llms/agent-icons.txt`, `GET /llms/agent-configuration/:adapterType.txt`, başka ajanları yapılandıran ajanlar için düz metin döndürür. Hem kökte hem `/api` altında bağlıdırlar (`server/src/app.ts:579`, `:658`); yönetim kurulu ya da `canCreateAgents` izni olan ajanlar okuyabilir (`server/src/routes/llms.ts:13-31`, `:33`, `:69`, `:84`).

Aşağıdaki bütün yollar `/api` altındadır. "Satır" sütunu, adı verilen yol dosyasındaki tanım satırını gösterir.

### 5.1 Şirketler (`server/src/routes/companies.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/companies` | Şirketleri listeler. Kurulum yöneticileri hepsini görür; diğerleri üyesi olduklarını görür; `?scope=accessible` listeyi erişilebilenlerle sınırlar | `:377-397` |
| GET | `/companies/stats` | Şirket başına ajan ve görev sayıları, aynı filtrelemeyle | `:399-411` |
| GET | `/companies/:companyId` | Tek bir şirketi getirir (yönetim kurulu ya da o şirketin bir ajanı) | `:483-496` |
| POST | `/companies` | Şirket oluşturur. Yalnızca kurulum yöneticisi ya da yerel örtük kullanıcı; bulutta yönetilen kurulumlarda reddedilir; oluşturan `owner` olur; bütçe verilmişse bütçe kuralı oluşturulur | `:1193-1240` |
| PATCH | `/companies/:companyId` | Şirketi günceller. Yönetim kurulu ya da şirketin CEO ajanı (yalnızca marka alanları) | `:1242-1317`, `:361-375` |
| PATCH | `/companies/:companyId/branding` | Marka bilgilerini günceller | `:1319-1342` |
| POST | `/companies/:companyId/archive` | Arşivler; etkisi bağlı kayıtlara da uygulanır | `:1344-1354` |
| DELETE | `/companies/:companyId` | Kalıcı silme | `:1356-1366` |
| GET | `/companies/:companyId/artifacts` | Şirket genelindeki çıktıları listeler (belgeler ve görev çıktıları) | `:420` |
| GET | `/companies/:companyId/timeline` | İş zaman çizelgesi; görev başına `issue:read` kararına göre filtrelenir | `:429-481` |
| GET | `/companies/:companyId/feedback-traces` | Geri bildirim izleri (yönetim kurulu) | `:498` |
| POST | `/companies/:companyId/export`, `/exports/preview`, `/exports` | Dışa aktarma paketi | `:526`, `:1121`, `:1130` |
| POST | `/companies/import/preview`, `/:companyId/imports/preview`, `/:companyId/imports/apply` | İçe aktarma ön izlemesi ve uygulaması | `:576`, `:1139`, `:1156` |
| GET, PUT, POST | içe aktarma için aktarım yolları (parça yükleme, durum, ön izleme, uygulama), `GET /companies/import/jobs/:jobId` | Parçalı içe aktarma | `:584`, `:844-1041` |

### 5.2 Ajanlar (`server/src/routes/agents.ts`, temel alt küme)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/companies/:companyId/agents` | Ajanları listeler | `:4049` |
| GET | `/companies/:companyId/org`, `/org.svg`, `/org.png` | Organizasyon şeması verisi ve görseli | `:4132-4152` |
| GET | `/companies/:companyId/agent-configurations` | Maskelenmiş ajan yapılandırmaları | `:4164` |
| GET | `/agents/me` | Geçerli ajan (kapsamı sınırlı anahtarlar ve düşük güvenli ajanlar için kısaltılmış görünüm) | `:4171-4206` |
| GET | `/agents/me/inbox-lite` | Ajanın iş listesi: ona atanmış, `todo, in_progress, blocked` durumundaki görevler; bağımlılıkların hazır olup olmadığı bilgisiyle | `:4208-4255` |
| GET | `/agents/me/inbox/mine` | Belirli bir kullanıcının Gelen kutusu, ajanın gördüğü hâliyle | `:4257-4273` |
| GET | `/agents/:id`, `/agents/:id/configuration` | Ajan ayrıntısı ve yapılandırması | `:4275`, `:4302` |
| GET, POST | `/agents/:id/config-revisions`, `/:revisionId`, `/:revisionId/rollback` | Yapılandırma geçmişi ve geri alma | `:4313-4342` |
| GET, POST | `/agents/:id/runtime-state`, `/task-sessions`, `/runtime-state/reset-session` | Oturum durumu | `:4414-4441` |
| POST | `/companies/:companyId/agent-hires` | İşe alma: ajanı `idle` ya da `pending_approval` olarak oluşturur ve bir `hire_agent` onayı açar; çalışma başına tekrara karşı korumalıdır | `:4475-4793` |
| POST | `/companies/:companyId/agents` | Doğrudan oluşturma. Onay gerekiyorsa 409 döndürür | `:4795-4963` |
| PATCH | `/agents/:id`, `/agents/:id/permissions`, `/agents/:id/instructions-path` | Ajanı, izinleri ve talimat yolunu günceller | `:5420`, `:4965`, `:5024` |
| GET, PATCH, PUT, DELETE, POST | `/agents/:id/instructions-bundle...` | Talimat dosyaları; geçmiş, fark ve geri yükleme ile | `:5106-5353` |
| POST | `/agents/:id/pause`, `/resume`, `/clear-error`, `/approve`, `/terminate` | Yaşam döngüsü eylemleri | `:5630-5845` |
| DELETE | `/agents/:id` | Kalıcı silme (yönetim kurulu) | `:5847` |
| GET, POST, DELETE | `/agents/:id/keys`, `/agents/:id/keys/:keyId` | Ajan API anahtarları (yönetim kurulu). Token yalnızca oluşturulurken bir kez döndürülür | `:5871-5911` |
| POST | `/agents/:id/wakeup`, `/agents/:id/heartbeat/invoke` | Elle uyandırma ve çağırma | `:6204`, `:6211` |
| GET | `/companies/:companyId/heartbeat-runs`, `/live-runs`; `/heartbeat-runs/:runId`, `/events`, `/log` | Çalışma listesi ve ayrıntısı | `:6850-7496` |
| POST | `/heartbeat-runs/:runId/cancel` | Bir çalışmayı iptal eder | `:7020` |
| GET | `/issues/:issueId/live-runs`, `/execution`, `/active-run` | Bir görevin çalışma durumu | `:7542-7613` |
| PATCH | `/agents/:agentId/budgets` | Ajan bütçesi (yönetim kurulu) | `server/src/routes/costs.ts:364-401` |

### 5.3 Görevler (`server/src/routes/issues.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/companies/:companyId/issues` | Filtreli liste (bölüm 6.1) | `:7862` |
| GET | `/companies/:companyId/issues/count` | Filtreli sayım | `:8244` |
| POST | `/companies/:companyId/issues` | Oluşturur. Atama iznini denetler, `issue.created` kaydını yazar, atananı uyandırır | `:11597` |
| GET, PATCH, DELETE | `/issues/:id` | Getirir (uuid ya da kimlikle), günceller, siler | `:8825`, `:12803`, `:14992` |
| PUT | `/issues/:id/title` | Başlığı yazar | `:12784` |
| POST | `/issues/:id/children` | Alt görevler oluşturur | `:12073` |
| POST | `/issues/:id/checkout`, `/release`, `/admin/force-release` | Üstlenme, bırakma, yönetim kurulu için zorla bırakma | `:15038`, `:15192`, `:15231` |
| GET, POST, DELETE | `/issues/:id/comments`, `/comments/:commentId` | Yorumları listeler, yorum ekler, tek yorumu getirir, yorumu siler | `:15279`, `:17300`, `:16917`, `:16938` |
| GET, PATCH, PUT, POST, DELETE | `/issues/:id/queued-comments...` | Çalışma sürerken sıraya giren yorumlar: düzenleme, yeniden sıralama, araya girme, yönlendirme, atma | `:15354-15789` |
| GET, POST | `/issues/:id/interactions` | Görev içi etkileşimleri listeler ve oluşturur | `:15826`, `:15841` |
| POST | `/issues/:id/interactions/:interactionId/accept`, `/reject`, `/respond`, `/verdicts`, `/withdraw`, `/skip`, `/cancel`, `/resolve-from-comment` | Bir etkileşimi sonuçlandırır | `:16007-16813` |
| GET, PUT, DELETE | `/issues/:id/documents`, `/documents/:key` | Görev belgelerini listeler, getirir, ekler ya da günceller, siler | `:9781-10602` |
| POST | `/issues/:id/documents/:key/lock`, `/unlock`, `/revisions/:revisionId/restore` | Kilitleme ve geri yükleme | `:10309-10449` |
| GET | `/issues/:id/documents/:key/revisions` | Sürüm listesi | `:10420` |
| GET, POST, PATCH | `/issues/:id/documents/:key/annotations...` | Pasaj yorumu dizileri ve yorumları | `:9843-10081` |
| GET, POST | `/issues/:id/work-products` | Çıktıları listeler ve oluşturur | `:9661`, `:10709` |
| PATCH, DELETE | `/work-products/:id` | Bir çıktıyı günceller ve siler | `:11134`, `:11232` |
| GET, POST, DELETE | `/issues/:id/approvals`, `/approvals/:approvalId` | Onayları bağlar ve bağı kaldırır | `:11502-11562` |
| POST, DELETE | `/issues/:id/read` | Okundu ve okunmadı olarak işaretler | `:11276`, `:11315` |
| POST, DELETE | `/issues/:id/inbox-archive` | Kişisel Gelen kutusunda arşivler ve arşivden çıkarır | `:11417`, `:11463` |
| GET, POST, DELETE | `/issues/:id/attachments`, `/companies/:companyId/issues/:issueId/attachments`, `/attachments/:attachmentId`, `/attachments/:attachmentId/content` | Dosya ekleri | `:18450-18719` |
| GET, POST, DELETE | `/companies/:companyId/labels`, `/labels/:labelId` | Etiketler | `:8353-8384` |
| GET | `/issues/:id/heartbeat-context` | Görevdeki bir ajan çalışması için bağlam paketi | `:8497` |
| GET | `/issues/:id/diagnostics/blockers`, `/wakes`, `/subtree` | Tanılama | `:8676-8770` |
| GET, PUT, DELETE | `/issues/:id/watchdog` | Görev gözcüsü | `:8929-9006` |
| GET, POST | `/issues/:id/recovery-actions...` | Kurtarma eylemleri | `:9055-9088` |
| POST | `/issues/:id/monitor/check-now`, `/scheduled-retry/retry-now`, `/stalled-review-decision` | İşletim kontrolleri | `:12583-12650` |
| GET, POST | `/issues/:id/feedback-votes`, `/feedback-traces` | Geri bildirim | `:17161-18338` |
| GET | `/companies/:companyId/search`, `/search/extract` | Şirket içi arama, hız sınırlı | `:7814`, `:7771` |
| GET | `/companies/:companyId/chats` | Geçerli kullanıcının ajan sohbetleri (deneysel ajan sohbeti) | `:17265` |
| POST, GET | `/issues/:id/tree-control/preview`, `/tree-holds`, `/tree-holds/:holdId`, `/tree-holds/:holdId/release`, `/tree-control/state` | Alt ağacı duraklatma, iptal etme, geri yükleme | `server/src/routes/issue-tree-control.ts:65-378` |
| GET | `/issues/:id/activity`, `/issues/:id/runs` | Bir görevin etkinliği ve çalışmaları | `server/src/routes/activity.ts:341`, `:350` |
| GET | `/issues/:id/cost-summary` | Görevin alt ağacının maliyeti | `server/src/routes/costs.ts:182` |

### 5.4 Onaylar (`server/src/routes/approvals.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/companies/:companyId/approvals` | Liste; isteğe bağlı durum filtresi | `:205-212` |
| GET | `/approvals/:id` | Getirir | `:214-220` |
| POST | `/companies/:companyId/approvals` | Oluşturur. Şirkete erişimi ve `company_scope:read` kararı olan her aktör; işe alma içerikleri gizli anahtarlar açısından normalleştirilir; `approval.created` kaydını yazar | `:222-275` |
| GET | `/approvals/:id/issues` | Bağlı görevler | `:277` |
| POST | `/approvals/:id/approve` | Yalnızca yönetim kurulu. `approval.approved` kaydını yazar, isteyen ajanı `approval_approved` nedeniyle uyandırır | `:286-400` |
| POST | `/approvals/:id/reject` | Yalnızca yönetim kurulu. İsteyen uyandırılmaz | `:402-435` |
| POST | `/approvals/:id/request-revision` | Yalnızca yönetim kurulu | `:437-462` |
| POST | `/approvals/:id/resubmit` | İsteyen ajan ya da yönetim kurulu | `:464-497` |
| GET, POST | `/approvals/:id/comments` | Yorumlar | `:499-530` |

### 5.5 Maliyetler ve bütçeler (`server/src/routes/costs.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| POST | `/companies/:companyId/cost-events` | Maliyet olayı kaydeder. Bir ajan yalnızca kendi maliyetini bildirebilir. `cost.reported` kaydını yazar | `:114-141` |
| POST | `/companies/:companyId/finance-events` | Finans olayı kaydeder (yönetim kurulu) | `:143-171` |
| GET | `/companies/:companyId/costs/summary` | Bir dönemin toplamları | `:173` |
| GET | `/companies/:companyId/costs/by-agent`, `/by-agent-model`, `/by-provider`, `/by-biller`, `/by-project` | Kırılımlar | `:192-219`, `:321` |
| GET | `/companies/:companyId/costs/finance-summary`, `/finance-by-biller`, `/finance-by-kind`, `/finance-events` | Finans görünümleri | `:228-255` |
| GET | `/companies/:companyId/costs/window-spend` | 5 saat, 24 saat ve 7 günlük kayan pencerelerde harcama | `:265` |
| GET | `/companies/:companyId/costs/quota-windows` | Adaptörlerden sorulan sağlayıcı kota pencereleri (yönetim kurulu) | `:273-286` |
| GET | `/companies/:companyId/budgets/overview` | Durumlarıyla birlikte kurallar, açık olaylar, duraklatılanların sayıları | `:288-294` |
| POST | `/companies/:companyId/budgets/policies` | Kuralı ekler ya da günceller (yönetim kurulu) | `:296-306` |
| POST | `/companies/:companyId/budget-incidents/:incidentId/resolve` | Olayı çözer (yönetim kurulu) | `:308-319` |
| PATCH | `/companies/:companyId/budgets` | Şirketin aylık bütçesi | `:330-362` |

### 5.6 Genel bakış, etkinlik, ilgi bekleyenler, Gelen kutusu

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/companies/:companyId/dashboard` | Özet: ajanlar, görevler, maliyetler, bekleyen onaylar, bütçeler, 14 günlük çalışma etkinliği | `server/src/routes/dashboard.ts:27-32` |
| GET | `/companies/:companyId/recovery-observability` | Haftalara yayılan kurtarma raporu | `server/src/routes/dashboard.ts:34-47` |
| GET | `/companies/:companyId/activity` | `agentId`, `entityType`, `entityId`, `limit` parametreli etkinlik akışı | `server/src/routes/activity.ts:222-236` |
| GET | `/companies/:companyId/audit/agent-actions`, `/audit/agent-actions.csv` | Ajan eylemleri denetimi; tam görünüm `audit:view_agent_actions` ister; CSV dışa aktarımının kendisi de `audit.exported` olarak kaydedilir | `server/src/routes/activity.ts:238-327` |
| POST | `/companies/:companyId/activity` | Etkinlik kaydı oluşturur (yönetim kurulu); ayrıntılar temizlenir | `server/src/routes/activity.ts:329-339` |
| GET | `/heartbeat-runs/:runId/issues` | Bir çalışmanın işlem yaptığı görevler | `server/src/routes/activity.ts:359-374` |
| GET | `/companies/:companyId/attention` | Karar odaklı ilgi bekleyenler akışı (yönetim kurulu kullanıcısı) | `server/src/routes/attention.ts:18-25` |
| GET | `/companies/:companyId/sidebar-badges` | Rozet sayıları | `server/src/routes/sidebar-badges.ts:31-89` |
| GET, POST, DELETE | `/companies/:companyId/inbox-dismissals`, `/inbox-dismissals/:itemKey` | Bir Gelen kutusu kaydını yok sayar ya da erteler | `server/src/routes/inbox-dismissals.ts:52-98` |
| GET, PUT | `/companies/:companyId/users/me/inbox-agent-policy`, `/users/:userId/inbox-agent-policy` | Hangi ajanların bir kullanıcının Gelen kutusuna kayıt düşürebileceği | `server/src/routes/inbox-agent-policy.ts:68-92` |
| GET, PUT | `/companies/:companyId/resource-memberships/me...` | Kenar çubuğunda projelere ve ajanlara katılma ya da ayrılma, belgelere yıldız koyma | `server/src/routes/resource-memberships.ts:60-133` |
| GET, PUT | `/sidebar-preferences/me`, `/companies/:companyId/sidebar-preferences/me` | Kenar çubuğu sırası | `server/src/routes/sidebar-preferences.ts:21-41` |

### 5.7 Hedefler, projeler, rutinler

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET, POST | `/companies/:companyId/goals` | Hedefleri listeler ve oluşturur | `server/src/routes/goals.ts:14`, `:28` |
| GET, PATCH, DELETE | `/goals/:id` | Getirir, günceller, siler | `server/src/routes/goals.ts:21`, `:50`, `:75` |
| GET, POST | `/companies/:companyId/projects` | Listeler (arşivlenenler yol düzeyinde varsayılan olarak dışarıda bırakılır) ve oluşturur | `server/src/routes/projects.ts:209`, `:233` |
| GET, PATCH, DELETE | `/projects/:id` | Getirir, günceller, siler | `server/src/routes/projects.ts:217`, `:324`, `:775` |
| GET, POST, PATCH, DELETE | `/projects/:id/workspaces`, `/workspaces/:workspaceId` | Proje çalışma alanları | `server/src/routes/projects.ts:380-746` |
| PUT | `/projects/:id/repositories` | Seçili GitHub depoları listesini yenisiyle değiştirir | `server/src/routes/projects.ts:194` |
| GET, POST | `/companies/:companyId/routines` | Listeler ve oluşturur. Yönetim kurulu için `tasks:assign` gerekir; bir ajan yalnızca kendisine atanmış rutinleri yönetebilir | `server/src/routes/routines.ts:149`, `:157`, `:89-106` |
| GET, PATCH | `/routines/:id` | Getirir ve günceller | `server/src/routes/routines.ts:194`, `:363` |
| GET, POST | `/routines/:id/revisions`, `/revisions/:revisionId/restore` | Sürüm geçmişi | `server/src/routes/routines.ts:200`, `:421` |
| GET | `/routines/:id/runs` | Çalışma geçmişi | `server/src/routes/routines.ts:456` |
| POST, PATCH, DELETE | `/routines/:id/triggers`, `/routine-triggers/:id`, `/routine-triggers/:id/rotate-secret` | Tetikleyiciler | `server/src/routes/routines.ts:464-585` |
| POST | `/routines/:id/run` | Elle çalıştırma, 202 döndürür | `server/src/routes/routines.ts:629-654` |
| POST | `/routine-triggers/public/:publicId/fire` | Herkese açık webhook girişi. Yalnızca JSON. Kimlik doğrulama imzalama moduna göre yapılır | `server/src/routes/routines.ts:656-674` |

### 5.8 Erişim ve kimlik doğrulama (`server/src/routes/access.ts`, `server/src/routes/auth.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/auth/get-session`, `/auth/profile`; PATCH `/auth/profile` | Oturum ve profil | `server/src/routes/auth.ts:41-71` |
| ALL | `/auth/*` | better-auth işleyicisi (giriş, kayıt, çıkış) | `server/src/app.ts:577` |
| GET, POST | `/board-claim/:token`, `/board-claim/:token/claim` | Yerel güvenilir moddaki bir kurulumun, giriş yapmış bir kullanıcı tarafından tek seferlik sahiplenilmesi | `:2694`, `:2705` |
| POST | `/bootstrap/claim` | Kurulum yöneticiliğinin ilk kez sahiplenilmesi | `:2742` |
| POST, GET | `/cli-auth/challenges`, `/:id`, `/:id/approve`, `/:id/cancel`; `/cli-auth/me`; `/cli-auth/revoke-current` | Tarayıcıdan onayla CLI girişi | `:2767-2990` |
| GET, POST, DELETE | `/board-api-keys`, `/board-api-keys/:keyId` | Adlandırılmış yönetim kurulu API anahtarları | `:2901-2954` |
| POST, GET | `/companies/:companyId/invites` | Davet oluşturur (`users:invite` gerekir) ve davetleri listeler | `:3320`, `:4177` |
| GET | `/invites/:token`, `/logo`, `/onboarding`, `/onboarding.txt`, `/skills/index`, `/skills/:skillName`, `/test-resolution` | Herkese açık davet karşılama sayfası ve ajan için ilk kurulum metni | `:3431-3600` |
| POST | `/invites/:token/accept` | Kabul: bir katılma isteği oluşturur ya da var olanı yeniden döndürür | `:3643` |
| POST | `/invites/:inviteId/revoke` | Geçersiz kılar | `:4136` |
| GET, POST | `/companies/:companyId/join-requests`, `/:requestId/approve`, `/:requestId/reject` | `joins:approve` gerekir | `:4185-4349` |
| POST | `/join-requests/:requestId/claim-api-key` | İlk ajan API anahtarının, sahiplenme gizli anahtarıyla tek seferlik alınması | `:4397` |
| GET, PATCH, POST | `/companies/:companyId/members`, `/members/:memberId`, `/role-and-grants`, `/archive`, `/permissions`; `/user-directory` | Üye yönetimi, `users:manage_permissions` gerekir | `:4481-4622` |
| GET, POST, PUT | `/admin/users`, `/admin/users/:userId/promote-instance-admin`, `/demote-instance-admin`, `/company-access` | Kurulum yöneticisi araçları | `:4658-4749` |

### 5.9 Gizli anahtarlar (`server/src/routes/secrets.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET | `/companies/:companyId/secrets` | Gizli anahtarları listeler (yönetim kurulu, yalnızca üst veri) | `:594` |
| GET | `/companies/:companyId/secrets/catalog` | Ajanlar için kimlik, ad, anahtar ve durum | `:585` |
| POST | `/companies/:companyId/secrets` | Oluşturur | `:887` |
| POST | `/secrets/:id/rotate`; PATCH, DELETE `/secrets/:id` | Yeniler, günceller, siler | `:992`, `:1032`, `:1106` |
| GET | `/secrets/:id/usage`, `/secrets/:id/access-events` | Bağlamalar ve erişim kaydı | `:1076`, `:1091` |
| POST | `/companies/:companyId/secrets/remote-import/preview`, `/remote-import` | Dış sağlayıcıdan referansları içe aktarır | `:921`, `:956` |
| GET, POST, PATCH, DELETE | `/companies/:companyId/secret-providers`, `/secret-providers/health`, `/secret-provider-configs...` | Sağlayıcı listesi, sağlık durumu, şirket başına sağlayıcı yapılandırmaları | `:361-553` |
| GET, POST, PATCH, DELETE | `/companies/:companyId/user-secret-definitions...` | Kullanıcıya özel gizli anahtar yuvaları (şirket yöneticisi) | `:602-720` |
| GET, POST, PATCH, DELETE | `/companies/:companyId/me/user-secrets...` | Kullanıcının kendi değerleri | `:727-859` |
| GET, POST | `/agents/me/secrets`, `/agents/me/secrets/:key/value` | Çalışmaya bağlı kimlikle gelen ajan, kendisine bağlanmış gizli anahtarları listeler ve getirir | `:314`, `:336` |
| POST, GET, DELETE | `/agents/me/secret-proposals...` | Ajan bir gizli anahtar ya da bağlama önerir | `:194-234` |
| GET, POST | `/companies/:companyId/secret-proposals`, `/:id/approve`, `/:id/reject` | Önerilerin yönetim kurulunca incelenmesi | `:240-284` |

### 5.10 Kurulum ayarları (`server/src/routes/instance-settings.ts`)

| Yöntem | Yol | Amaç | Satır |
|---|---|---|---|
| GET, PATCH | `/instance/settings` | Ayar satırının tamamı. Herhangi bir şirketin üyesi okuyabilir, kurulum yöneticisi yazabilir | `:126`, `:131`, `:85-93` |
| GET, PATCH | `/instance/settings/general` | Genel ayarlar | `:188`, `:195` |
| GET, PATCH | `/instance/settings/experimental` | Özellik bayrakları | `:250`, `:258` |
| GET, POST, DELETE | `/instance/task-drain` | Süren çalışmalar bitene kadar yeni çalışma kabul edilmez | `:298-360` |
| GET, POST | `/instance/lifecycle`, `/instance/lifecycle/unarchive-primary` | Bulutta yönetilen yaşam döngüsü | `:419`, `:447` |
| POST | `/instance/database-backups` | Yedekleme başlatır | `server/src/routes/instance-database-backups.ts:25` |
| GET | `/health` | Arayüz için sağlık durumu ve özellik bayrakları | `server/src/routes/health.ts:232` |

Ayar değişiklikleri her şirketin etkinlik kaydına yazılır (`server/src/routes/instance-settings.ts:163-183`).

### 5.11 Diğer yol grupları (bu raporun çekirdeği dışında)

`adapters` (10), `ai-connections` (10), `announcements` (4), `assets` (3), `board-chat` (1), `browser-use` (9), `built-in-agents` (8), `cases` (20), `chat-channels` (39), `company-skills` (54), `company-skill-policy` (4), `connection-intents` (9), `decisions` (9), `decision-queues` (12), `decision-training` (7), `email` (14), `environments` (21), `execution-workspaces` (10), `file-resources` (4), `folders` (7), `managed-agent-profiles` (2), `remote-agent-profiles` (2), `onboarding-seed` (1), `pipelines` (51), `plugins` (30), `plugin-ui-static` (1), `project-tools` (1), `slack-tools` (7), `smoke-lab` (15), `status-cards` (12), `summary-slots` (4), `teams-catalog` (6), `tool-access` (81), `tool-gateway` (19), `user-profiles` (1).

## 6. Temel servisler

### 6.1 Görevler (`server/src/services/issues.ts`, 13.417 satır)

Oluşturma (`:9739-10238`):

- Başlık yoksa açıklamanın ilk 120 karakterinden türetilir ve sonradan üretilmek üzere işaretlenir (`:9761-9768`).
- Tekrar önleme anahtarları, işlem düzeyinde bir danışma kilidiyle (transaction advisory lock) birlikte kullanılır; 7 gün saklanır (`:9808-9858`).
- İsteğe bağlı tekilleştirme: son 48 saatte oluşturulmuş açık görevler arasında normalleştirilmiş başlığa göre yapılır (`:9859-9881`).
- Numara verme: `issue_counter = greatest(issue_counter, max(issue_number)) + 1`, kimlik `<prefix>-<number>` (`:10102-10124`).
- Adına çalışılan kişinin belirlenmesi (`:10125-10139`), hedef için yedek değer (`:10148-10153`), etiketler, engelleyenler, gözcü ve ilk `plan` belgesi (`:10194-10227`).
- Çalışma alanı ayarları üst görevden ve projeden devralınır (`:9909-9974`).

Listeleme (`:7852-8200`): filtreler `status` (virgülle ayrılmış liste), `assigneeAgentId`, `participantAgentId`, `assigneeUserId`, `touchedByUserId`, `inboxArchivedByUserId`, `unreadForUserId`, `projectId`, `workspaceId`, `executionWorkspaceId`, `parentId`, `descendantOf` (özyinelemeli CTE), `createdFromIssueId`, `originKind`, `originKindPrefix`, `originId`, `labelId`, `hasPlanDocument`, `updatedSince`, `excludeRoutineExecutions`, `q` (arama), `attention=blocked`, `sortField`, `sortDir`, `limit`, `offset`, `afterId`. Varsayılan sınır 500, en çok 1000 (`:211-212`). Her satıra etiketler, süren çalışma, son etkinlik ve engelleyen ile inceleme için ilgi bekleme bilgisi eklenir.

Alt görevler (`:9224-9376`): yardımcı çağrı başına en çok 25 alt görev (`:223`); istek derinliği en az üst görevin derinliğinin bir fazlasıdır (`:9322-9327`); `blockParentUntilDone`, üst göreve bir engelleyen ilişkisi ekler (`:9343-9370`).

Yorumlar (`addComment`, `:12140` ve sonrası): çalışmanın yazdığı yorumlarla kullanıcı yorumlarını sıraya sokmak için görev satırı kilitlenir (`:12165-12193`); kurulum ayarı açıksa kullanıcı adları maskelenir (`:12200-12207`); kullanıcının gönderdiği `clientRequestId` yazmayı tekrara karşı korur ve çakışan yeniden kullanım 409 döndürür (`:12208-12215`); yazar türü aktöre göre varsayılan olarak ajan, kullanıcı ya da sistem olur (`:12228-12232`); geçersiz çalışma kimlikleri hata vermek yerine atılır (`:12247-12294`).

Okundu bilgisi ve Gelen kutusu:

- "Kullanıcının işlem yaptığı" görev şu demektir: görevi o kullanıcı oluşturmuştur, görev ona atanmıştır, kullanıcı görevde yorum yazmıştır ya da etkinlik kaydında görev üzerinde bir işlemi vardır (`:2828-2857`).
- "Okunmamış" görev, kullanıcının işlem yaptığı ve başka birinin, kullanıcının son işleminden (kendi son yorumu, son okuma, oluşturma ve atama zamanlarının en geç olanı) daha yeni bir yorumu bulunan görevdir (`:2907-2918`, `:2966-2985`).
- `markRead`, `issue_read_states` tablosuna satır ekler ya da var olanı günceller; `markUnread` satırı siler (`:8292-8335`).
- `archiveInbox`, `issue_inbox_archives` tablosuna satır ekler ya da var olanı günceller. Arşivlenen görev, arşiv zamanından sonra yeni bir etkileşim, `in_review`, `blocked` ya da `done` durumuna geçiş ya da yeni bir yorum olursa geri gelir (`:7804-7845`, `:2987-3027`).
- İçe aktarılan görevler, içe aktaran kullanıcı için arşivlenir; böylece içe aktarma Gelen kutusunu doldurmaz (`:8339-8371`).

Görev değişikliklerinin tetiklediği uyandırmalar (yol `PATCH /issues/:id`, `server/src/routes/issues.ts:14625-14973`):

| Olay | Uyandırma nedeni | Kanıt |
|---|---|---|
| Atananın değişmesi (durum backlog ya da kapalı değilse) | `issue_assigned` | `:14627-14667` |
| Durumun backlog'dan çıkması, `blocked -> todo` geçişi, yeniden açılma | `issue_status_changed` | `:14669-14700` |
| Başka birinin yorumu ya da yorumla yeniden açılma | `issue_commented`, `issue_reopened_via_comment` | `:14702-14778` |
| Görevin bitmesi ve ona bağlı görevlerin hazır hâle gelmesi | `issue_blockers_resolved` | `:14780-14795` |
| Bütün alt görevlerin kapanması | üst görevin atananına `issue_children_completed` | `:14895-14927` |
| Üstlenme | `issue_checked_out` | `:15161-15186` |

Uyandırma çağrıları yazmadan sonra yapılır ve sonuçları beklenmez (`:14929-14972`). Görev `backlog` durumundayken atanan uyandırılmaz (`server/src/services/issue-assignment-wakeup.ts:43`). Ajanın kendi yorumu onu uyandırmaz (`server/src/services/issue-comment-wakeup.ts:1-28`). @ ile söz etmek ajanları uyandırmaz: "Mentions only annotate comments" (`server/src/services/heartbeat.ts:26883-26885`, `doc/SPEC-implementation.md:663-666`). Engelleyen uyandırması duruma göre tetiklenir (level-triggered); tekrar önleme anahtarı bağımlı görevin kimliğinden ve çözülen engelleyenler kümesinden kurulur (`server/src/services/issue-dependency-wakeups.ts:68-76`).

### 6.2 Onaylar

- Servis: `server/src/services/approvals.ts` (bölüm 4.3). Görevlere bağlama: `server/src/services/issue-approvals.ts:29-41`, `:107-172`; aynı şirket denetimiyle.
- İşe alma akışı: `POST /companies/:companyId/agent-hires`, ajanı ve içeriğinde `agentId` taşıyan bir `hire_agent` onayını oluşturur (`server/src/routes/agents.ts:4681-4730`). Adaptör kancası `onHireApproved` onaydan sonra çalışır ve `hire_hook.succeeded`, `hire_hook.failed` ya da `hire_hook.error` kaydını yazar (`server/src/services/hire-hook.ts`).
- Onay gerektiren araç eylemleri (olağan durumda onaylar tablosunun dışında): araç geçidi, incelenen argümanlarla bir `tool_action_requests` satırı saklar, görevde yanıtlama kuralı `human_only` olan bir `request_confirmation` etkileşimi oluşturur ve yüksek riskli araçlar için ayrıca göreve bağlı resmî bir `request_board_approval` onayı açar. Çalıştırma, saklanan argümanları bir kez kullanır (`server/src/services/tool-gateway.ts:2453-2529`).

### 6.3 Bütçeler, maliyetler, finans

Maliyet kaydı (`server/src/services/costs.ts:56-104`): ajanın şirkete ait olduğunu doğrular, olayı ekler, ajanın ve şirketin aylık harcamasını yeniden hesaplar, ardından `budgets.evaluateCostEvent` işlevini çağırır.

Bütçe değerlendirmesi (`server/src/services/budgets.ts`):

- Gözlenen harcama, kapsam ve dönem için `cost_events.cost_cents` değerlerinin toplamıdır (`:143-166`). Dönemler: UTC'ye göre takvim ayı ya da ömür boyu (`:48-64`). Varsayılan dönem projeler için `lifetime`, diğerleri için `calendar_month_utc` olur (`:519`).
- Uyarı eşiği `ceil(amount * warn_percent / 100)` değeridir: kural, dönem ve eşik başına tek bir olay açılır. Kesin eşik `observed >= amount` koşuludur: olaya ek olarak bir `budget_override_required` onayı açılır, ardından kapsam duraklatılır ve işleri iptal edilir (`:350-415`, `:649-716`).
- Duraklatma hedefleri: ajanda `budget` nedeniyle `paused` durumu; projede `paused_at`; şirkette `paused` durumu (`:214-250`). Kapsamdaki süren çalışmaların ve bekleyen uyandırmaların iptali: `server/src/services/heartbeat.ts:29919-29950`.
- `getInvocationBlock`, bir çalışma kabul edilmeden önce şirket, ajan ve proje bütçe durumunu denetler (`:718-864`).
- Çözüm: `raise_budget_and_resume`, gözlenen harcamanın üzerinde yeni bir tutar ister, kapsamın çalışmasını sürdürür ve onayı onaylandı olarak işaretler; `keep_paused` olayı yok sayılmış olarak kapatır ve onayı reddeder (`:866-958`).
- Bir kural eklenince ya da güncellenince tutar `companies.budget_monthly_cents` ya da `agents.budget_monthly_cents` alanına da yazılır (`:571-589`).

Raporlar (`server/src/services/costs.ts`): özet (`:106-138`), özyinelemeli CTE ile görev alt ağacı özeti (`:140-279`), ajana göre (`:281-316`), sağlayıcıya göre (`:318-348`), faturalayana göre (`:350-379`), 5 saat, 24 saat ve 7 günlük kayan pencereler (`:386-429`), ajan ve modele göre (`:431-471`), projeye göre (`:473-521`). Finans olayları, ücretler ve alacaklar için ayrı bir defterdir (`server/src/services/finance.ts`). Kota pencereleri adaptörlerden 20 saniyelik zaman aşımıyla sorulur (`server/src/services/quota-windows.ts`).

### 6.4 Etkinlik kaydı

- Girdi: `companyId`, `actorType` (`agent`, `user`, `system`, `plugin`), `actorId`, `action`, `entityType`, `entityId`, isteğe bağlı `agentId`, `runId`, `details` (`server/src/services/activity-log.ts:54-67`).
- Adına çalışılan kişi şu sırayla belirlenir: açıkça verilen değer, kullanıcı aktör, çalışma, görev, ajan API anahtarı, şirket varsayılanı (`:93-149`).
- `persistActivity` ayrıntıları maskeler, satırı ekler, `activity.logged` canlı olayını ve bir eklenti olayını yayımlar (`:160-215`, `:151-158`).
- Okuma: varsayılan sınır 100, en çok 500 (`server/src/services/activity.ts:32-38`). Gizli görevlerin etkinliği elenir (`:340-376`). Bir görevin çalışmaları ve bir çalışmanın görevleri bu kayıttan türetilir (`:391-623`).
- Eylem adları: `server/src` üzerinde çalıştırılan bir regex, kodda sabit olarak yazılmış 487 farklı ad bulur. En büyük gruplar: `issue.*` 107, `company.*` 40, `agent.*` 23, `tool_connection.*` 16, `routine.*` 15, `environment.*` 15, `secret.*` 13, `approval.*` 10. Çekirdekten örnekler: `issue.created`, `issue.updated`, `issue.checked_out`, `issue.released`, `issue.admin_force_release`, `issue.comment_added`, `issue.document_upserted`, `issue.thread_interaction_created`, `issue.thread_interaction_accepted`, `issue.approval_linked`, `issue.read_marked`, `issue.inbox_archived`, `issue.work_product_created`, `approval.created`, `approval.approved`, `approval.rejected`, `approval.revision_requested`, `approval.resubmitted`, `approval.comment_added`, `agent.created`, `agent.hire_created`, `agent.paused`, `agent.resumed`, `agent.terminated`, `agent.key_created`, `agent.key_revoked`, `agent.config_rolled_back`, `budget.policy_upserted`, `budget.soft_threshold_crossed`, `budget.hard_threshold_crossed`, `budget.incident_resolved`, `cost.reported`, `company.created`, `company.archived`, `company.reactivated`, `goal.created`, `project.created`, `routine.created`, `routine.run_triggered`, `routine.run_skipped`, `secret.created`, `secret.rotated`, `secret.value.read`, `invite.created`, `join.requested`, `join.approved`, `join.rejected`. `resource_membership.<kind>` gibi dinamik adlar bu sayıya dâhil değildir (`server/src/routes/resource-memberships.ts:41`).
- Etkinlik kaydı değiştirilemez bir kayıt değildir: şirket silme ve ajan silme, satırları da siler (`server/src/services/companies.ts:553`, `server/src/services/agents.ts:1074-1079`).

### 6.5 Genel bakış, ilgi bekleyenler, rozetler

Genel bakış (`server/src/services/dashboard.ts:30-214`): duruma göre ajan sayıları, `idle` olanlar etkin sayılarak (`:59-70`); görev sayıları `open`, `inProgress`, `blocked`, `done` (`:72-84`); bekleyen onaylar (`:53-57`); ayın harcaması ve şirket bütçesine göre kullanım oranı (`:90-102`, `:185-188`); 14 günlük çalışma etkinliği, yeniden denemeyle kurtarılanlar başarısızlardan ayrı tutulur ve başarısızlar `error_code` değerine göre gruplanır (`:103-183`); bütçe özeti (`:189-211`).

İlgi bekleyenler akışı (`server/src/services/attention.ts`): yönetim kurulu kullanıcısı için tek bir liste; şunlardan kurulur: bekleyen onaylar (`:1124-1162`), bekleyen etkileşimler (`:1255`), açık kararlar (`:1313`), bekleyen katılma istekleri (`:1377`), sahibi insan olan kurtarma eylemleri (`:1440`), ilgi bekleyen engelleyenler (`:1502`, `:1555`), incelemeler (`:1649-1652`), sınırlı yeniden deneme hakkı tükenmiş başarısız çalışmalar (`:1740`), bütçe uyarıları (kesin eşik ya da yüzde 85 ve üzerindeki uyarı eşiği) (`:1794`) ve ajan hataları (`:1848`). Yinelenenleri ayıklar, yok sayma kayıtlarını ve kuyrukları uygular, `activity` ya da `decide` değerine göre sıralar, imleçle sayfalar; varsayılan 50, en çok 100 (`:111-112`, `:1865-1977`).

Kenar çubuğu rozetleri (`server/src/services/sidebar-badges.ts:25-89`): `inbox = actionable approvals (pending or revision_requested) + failed runs (latest run per non-terminated agent is failed or timed_out and visible to the user) + join requests + unread touched issues`. Yok sayma kayıtlarının anahtarları `approval:<id>`, `run:<id>`, `join:<id>` biçimindedir. Yol, katılma isteklerini yalnızca aktörün `joins:approve` izni varsa sayar (`server/src/routes/sidebar-badges.ts:34-63`).

### 6.6 Rutinler

- Cron: 5 alanlı ayrıştırıcı; ayın günü ve haftanın günü alanlarının ikisi de eşleşmelidir (`server/src/services/cron.ts:253-319`, `:280`). Saat dilimleri `nextCronTickInTimeZone` içinde ele alınır (`server/src/services/routines.ts:268`).
- Zamanlayıcı turu (`server/src/services/routines.ts:3175-3294`): etkin rutinlerin açık ve arşivlenmemiş tetikleyicilerinden `next_run_at <= now` olanları seçer (`:3182-3201`); her birini `next_run_at` üzerinde koşullu bir UPDATE ile kendine ayırır (`:3232-3248`); kaçırılanlar kuralı `enqueue_missed_with_cap` ise en çok 25 kaçırılmış tetiklenmeyi sıraya alır ve saatten sık çalışan cron ifadelerinde geriye dönük doldurma yapmaz (`:88`, `:3218-3230`); proje duraklatılmışsa çalışma atlanmış olarak kaydedilir (`:3250-3259`). Tur, sunucu sürecinin içinde çalışır (`server/src/index.ts:1686-1695`).
- Dağıtım (`:1712-2048`): atanan bir ajan ister (`:1733-1736`); değişkenleri yerine koyar (`:1757-1767`); rutin satırını kilitler (`:1791-1793`); tekrar önleme anahtarını dikkate alır (`:1803-1826`); rutin çalışmasını `received` olarak ekler (`:1850-1865`); rutine ait hâlâ açık bir görev varsa ve kural `always_enqueue` değilse çalışma `skipped` ya da `coalesced` olur (`:1875-1904`); yoksa `status: todo`, `originKind: routine_execution`, rutin kimliğini taşıyan `originId` ve çalışma kimliğini taşıyan `originRunId` ile bir görev oluşturur (`:1907-1929`), atananı uyandırır (`:1974-1982`) ve çalışmayı `issue_created` olarak işaretler (`:1983-1995`).
- Rutin çalışması, görevi kapanınca kapanır: `done -> completed`, `blocked` ya da `cancelled -> failed` (`:3296-3378`).
- Etkinlik kapısı `require_external_activity`, son çalışmadan beri kapsamda hiçbir şey olmadıysa çalışmaları engeller ve `skipped` olarak kaydeder (`:1286-1502`).
- Herkese açık webhook'lar: imzalama modları bearer, tekrar koruma penceresi (varsayılan 300 saniye) olan HMAC SHA-256, GitHub HMAC, Fireflies HMAC, uygulama webhook'u, imzasız (`:2907-3099`, `:3001`).
- Rutin başına en çok 100 sürüm (`:89`).

### 6.7 Hedefler ve projeler

- Hedefler için düz CRUD işlemleri, üst hedef bağlantısı ve varsayılan şirket hedefini bulma işlevi vardır (`server/src/services/goals.ts:7-43`). Hedefi olmayan görevler proje hedefine ya da varsayılan şirket hedefine düşer (`server/src/services/issue-goal-fallback.ts`).
- Projeler: addan türetilen, şirket içinde tekil kısa ad (`server/src/services/projects.ts:581-585`); `project_goals` üzerinden proje başına birden çok hedef, ilk hedef eski `goal_id` alanına da yazılır (`:592-602`, `:893-911`); hedef kimlikleri şirkete ait olmalıdır (`:576`, `:874-876`); arşivleme `archived_at` ile yapılır, yol varsayılan olarak yalnızca etkin olanları döndürür (`:623-637`); kalıcı silme (`:948-957`); çalışma alanları ve depolar (`:814-858`, `:959` ve sonrası).
- Projeler duraklatılabilir (`pause_reason`, `paused_at`); bu, üstlenmeyi ve rutin dağıtımını engeller (`server/src/routes/issues.ts:15051-15062`, `server/src/services/routines.ts:3250-3259`).

### 6.8 Arama

- `GET /companies/:companyId/search`, şirkete erişim ve bir `company_scope:read` kararı ister; aktör başına hız sınırı uygulanır (`server/src/routes/issues.ts:7814-7860`).
- Eşleştirme sözcük temellidir: trigram dizinli başlık, kimlik, açıklama, yorum gövdeleri ve belge gövdeleri üzerinde ILIKE; kısa terimlerde sözcük başı eşleştirmesi, başlıktaki yazım hataları için de yedek olarak Levenshtein kullanılır (`server/src/services/task-search.ts:41-47`, `:84-196`, `:113-128`). Puanlar 8000'den 1000'e inen, birbiriyle kesişmeyen bantlardadır (`:59-78`).
- Embedding yok, kök bulma yok, eş anlamlı sözcük servisi yok (`doc/SEARCH.md:69-70`).
- Tek bir sorgu, sonuç sayfasını ve tür sayılarıyla birlikte durum, öncelik, atanan, proje ve etiket için kırılım sayılarını döndürür (`server/src/services/company-search.ts:593-692`). Sonuç alıntıları en çok 240 karakterdir (`:44`).
- Kapsamlar `all, issues, comments, documents, artifacts, agents, projects`; sıralamalar `relevance, updated, created, priority` (`packages/shared/src/types/search.ts:3-6`).

### 6.9 Belgeler, pasaj yorumları, çıktılar

- Görev belgeleri görev başına bir anahtarla tutulur (`plan` görevle birlikte oluşturulur, `server/src/services/issues.ts:10194-10227`; sistem anahtarları `continuation-summary` ve `pipeline-case-body`, `packages/shared/src/constants.ts:438-444`). Ekleme ya da güncelleme için `baseRevisionId` son sürüme eşit olmalıdır, yoksa 409 döner (`server/src/services/documents.ts:350-359`). Her güncelleme yeni bir sürüm ekler ve `latest_*` alanlarını günceller (`:361-397`). Kilitli belge düzenlemeyi reddeder ya da türetilmiş bir anahtara yönlendirir (`:252-348`).
- Pasaj yorumları: bir yorum dizisi güncel sürümde seçilen metne bağlanır; bağlandığı yer güncel gövdeyle doğrulanmalıdır (`server/src/services/document-annotations.ts:411-496`). Yeni bir sürüm kaydedilince açık diziler yeniden eşlenir ve bir anlık görüntü satırı sonucu `active`, `stale` ya da `orphaned` durumu ve bir güven değeriyle kaydeder (`:957-1030`). Her yorum dizisi şunlardan tam olarak birine aittir: görev, rutin ya da case (`packages/db/src/schema/document_annotation_threads.ts:84-87`).
- Çıktı, bir görevin ürettiği, türü belli bir kayıttır (ön izleme adresi, pull request, dal, commit, artifact, belge); durumu ve inceleme durumu vardır (`server/src/services/work-products.ts:194-390`).

### 6.10 Şirket taşınabilirliği

- Bir şirket, kökünde `COMPANY.md` bulunan ve `.paperclip.yaml`, `AGENTS.md`, `PROJECT.md`, `TASK.md`, `SKILL.md` içeren bir dosya paketi olarak dışa ve içe aktarılır (`server/src/services/company-portability.ts:305-306`, `:3138-3158`).
- Varsayılanlar: yalnızca şirket ve ajanlar dâhil edilir (`:186-192`); çakışma stratejisi `rename` (`:194`); paket şema sürümü 7 (`:200`). `agent_safe` içe aktarma modunda `process` ve `http` adaptör türleri reddedilir (`:207`, `:3641`); varsayılan mod `board_full` olur (`:211-212`).
- Hedefler `new_company` (yalnızca kurulum yöneticisi) ya da `existing_company`; çakışma stratejileri `rename, skip, replace`; kaynaklar satır içi ya da GitHub (`packages/shared/src/types/company-portability.ts`, `server/src/routes/companies.ts:350-359`).

## 7. Şirketler arası yalıtım

### 7.1 Model

- Beyan edilen tasarım (`doc/SPEC-implementation.md:36`): "Single-tenant deployment, multi-company data model" (tek kiracılı kurulum, çok şirketli veri modeli).
- Bütün göçlerde ve şemada `ROW LEVEL SECURITY`, `CREATE POLICY`, `pgPolicy`, `enableRLS`, `BYPASSRLS`, `current_setting`, `set_config`, `SET LOCAL`, `CREATE SCHEMA`, `CREATE ROLE`, `GRANT` için yapılan grep işlevsel hiçbir şey bulmadı (0232 numaralı göçte tek bir yorum var). Bir şey için ayrı şema kullanmanın tek örneği, eklentiye ait tablolar için açılan eklenti veritabanı ad alanıdır (`packages/shared/src/constants.ts:1424`).
- Sunucu, Drizzle istemcisini tek bir bağlantı adresinden kurar (`packages/db/src/client.ts:270-272`); dolayısıyla her istek aynı veritabanı rolüyle çalışır. Yalıtım, her sorgunun şirket koşulu taşımasına ve her yolun erişim denetimi çağırmasına bağlıdır.

### 7.2 Yol korumaları (`server/src/routes/authz.ts`)

| Koruma | Davranış | Satır |
|---|---|---|
| `assertCompanyAccess` | Ajan: `companyId` değeri yoldaki şirkete eşit olmalıdır, değilse 403 "Agent key cannot access another company" döner. Adına çalışılan kişisi olan ajan: o kullanıcı etkin üye olmalıdır ve bir `viewer` yazamaz. Yönetim kurulu (yerel örtük kullanıcı dışında): şirket `companyIds` içinde olmalıdır; güvenli olmayan yöntemlerde üyelik etkin olmalı ve `viewer` olmamalıdır, kurulum yöneticisi bunun dışındadır | `:75-121` |
| `hasCompanyAccess` | Hata fırlatmayan biçimi. Giriş yapmış kurulum yöneticileri, üyesi olmadıkları şirketlere toptan erişim almaz | `:153-162` |
| `getAccessibleResource` | Kimlikle arama, kaydın var olup olmadığı dışarıdan anlaşılmasın diye "yok" ve "başka şirkete ait" durumları için aynı 404 yanıtını döndürür | `:182-195` |
| `assertBoard`, `assertInstanceAdmin`, `assertBoardOrgAccess` | Aktör türü ve rol denetimleri | `:32-73` |

### 7.3 Ajan kimlik bilgilerinin bağlanması

- Ajan API anahtarları SHA-256 özet değeri olarak saklanır; satırda şirket kimliği de bulunur (`packages/db/src/schema/agent_api_keys.ts:6-24`). Token `pcp_<48 hex>` biçimindedir (`server/src/services/agents.ts:63-65`).
- Ara katman anahtarı bulur, ajanı yükler, `agent.companyId === key.companyId` koşulunu denetler ve sonlandırılmış ya da onay bekleyen ajanları reddeder (`server/src/middleware/auth.ts:347-352`, `:459-470`). Adına çalışılan kişisi olmayan anahtar `RESPONSIBLE_USER_UNAVAILABLE` ile reddedilir (`:472-485`).
- Çalışma JWT'leri `company_id` taşır ve ajan satırıyla karşılaştırılarak doğrulanır (`server/src/middleware/auth.ts:367-370`). İmzalama anahtarı kurulum ve şirket başına türetilir: `HMAC(master, "jwt:<instanceId>:<companyId>")` (`server/src/agent-auth-jwt.ts:90-92`).
- Yetkilendirme servisinde, şirketinin dışında işlem yapan ajan ilk adımda reddedilir (`server/src/services/authorization.ts:1901-1907`).

### 7.4 Şirket sınırını aşan yerler

| Yer | Davranış | Kanıt |
|---|---|---|
| `GET /api/companies` | Kurulum yöneticileri, üye olmasalar da şirket dizininin tamamını alır | `server/src/routes/companies.ts:384-394` |
| `GET /api/companies/stats` | Kurulum yöneticileri için bütün şirketlerin ajan ve görev sayıları | `server/src/routes/companies.ts:399-411` |
| Canlı olay WebSocket'i | Oturum kullanıcısı, kurulum yöneticisiyse ya da etkin üyeyse abone olabilir. Bu, REST tarafındaki davranıştan farklıdır; orada kurulum yöneticilerinden de üyelik istenir | `server/src/realtime/live-events-ws.ts:194-195`, karşılaştırma için `server/src/routes/authz.ts:153-162` |
| Kurulum ayarları | Bütün kurulum için tek satır; değişiklikler her şirketin etkinlik kaydına yazılır | `server/src/routes/instance-settings.ts:163-183` |
| Yönetim kurulunu sahiplenme | Bir kurulum yerel güvenilir moddan kimlik doğrulamalı moda geçtiğinde, sahiplenen kullanıcı kurulum yöneticisi ve var olan bütün şirketlerin etkin `owner` üyesi olur | `server/src/board-claim.ts:86-161`, `doc/DEPLOYMENT-MODES.md:157-168` |
| Ortamlar, eklentiler | `company_id` içermeyen tablolar kurulum genelindedir | bölüm 2.2 |
| Depolama | Nesne anahtarları `<companyId>/` ile başlar; okuma, üst bilgi sorgulama (head) ve silme işlemleri ön eki doğrular | `server/src/storage/service.ts:47-55`, `:61-71` |
| Canlı olay dağıtıcısı | Şirket kimliğine göre anahtarlanan süreç içi dağıtıcı | `server/src/services/live-events.ts` |

### 7.5 Yıkıcı yollara ilişkin gözlemler

- `DELETE /api/companies/:companyId` yalnızca `assertCompanyAccess` ve `assertBoard` denetimlerini yapar (`server/src/routes/companies.ts:1356-1366`). `assertCompanyAccess` denetimini rolü `viewer` olmayan her etkin üye geçer. Yapılandırma bayrağı `companyDeletionEnabled` (yalnızca `local_trusted` modunda varsayılan olarak açık, `server/src/config.ts:250-254`) arayüz için sağlık yanıtına konur (`server/src/routes/health.ts:424`); silme işleyicisinde ise kullanılmaz.
- `remove`, şirketin etkinlik kaydını, çalışmalarını, görevlerini, yorumlarını, onaylarını, gizli anahtarlarını ve üyeliklerini tek bir veritabanı işleminde siler (`server/src/services/companies.ts:538-587`).
- Ajanı kalıcı silmek, o ajanın etkinlik satırlarını, çalışmalarını ve yorumlarını da siler (`server/src/services/agents.ts:1059-1092`). Yıkıcı olmayan yol sonlandırmadır.

## 8. Kimlik doğrulama ve erişim modeli

### 8.1 Kurulum modları

| Mod | Davranış | Kanıt |
|---|---|---|
| `local_trusted` | Giriş yok. Her istek, kurulum yöneticisi haklarına sahip örtük yönetim kurulu kullanıcısı `local-board` olarak işlenir | `server/src/middleware/auth.ts:230-240`, `doc/DEPLOYMENT-MODES.md:48-52` |
| `authenticated` + `private` | Giriş zorunlu, ana makine izin listesi koruması | `server/src/middleware/private-hostname-guard.ts:56-96`, `server/src/app.ts:268-277` |
| `authenticated` + `public` | Giriş zorunlu, internete açık | `doc/DEPLOYMENT-MODES.md:48-52` |
| `authenticated` modunun iki dışa açıklık türü de | Kimlik doğrulama hız sınırı varsayılan olarak açık, sıkı gizli anahtar modu varsayılan olarak açık | `server/src/auth/better-auth.ts:67-77`, `server/src/config.ts:170-174` |

### 8.2 Aktörler

`req.actor` nesnesinin tipi `board`, `agent` ya da `none`; kaynağı ise `local_implicit`, `session`, `board_key`, `agent_key`, `agent_jwt`, `cloud_tenant`, `cloud_control` ya da `none` olur (`server/src/types/express.d.ts:8-34`).

| Kimlik bilgisi | Ayrıntı | Kanıt |
|---|---|---|
| Tarayıcı oturumu | Drizzle adaptörüyle better-auth; e-posta ve parola açık, `requireEmailVerification: false`; kayıt `PAPERCLIP_AUTH_DISABLE_SIGN_UP` ile kapatılabilir. İki adımlı doğrulama, passkey, sosyal hesapla giriş ya da SSO eklentisi yapılandırılmamış. Çerez ön eki `paperclip-<instanceId>` | `server/src/auth/better-auth.ts:260-282`, `:52-58`, `server/src/config.ts:219-223` |
| CSRF | Oturumla gelen yönetim kurulu aktörleri, güvenli olmayan yöntemlerde güvenilir bir Origin ya da Referer başlığı taşımalıdır. API anahtarları ve yerel örtük kullanıcı bu denetimin dışındadır | `server/src/middleware/board-mutation-guard.ts:76-108` |
| Yönetim kurulu API anahtarı | `pcp_board_<48 hex>`; SHA-256 özet değeri saklanır, varsayılan ömrü 30 gündür, kullanıcıya özeldir | `server/src/services/board-auth.ts:14`, `:21-33` |
| CLI girişi | Doğrulama isteğini (challenge) CLI oluşturur, tarayıcıda onaylanır; ömrü 10 dakikadır ve sonunda bir yönetim kurulu API anahtarı verir | `server/src/services/board-auth.ts:15`, `:367-421` |
| Ajan API anahtarı | `pcp_<48 hex>`; özet değeri saklanır, isteğe bağlı kapsam (`standard`, görev köprüsü, skill testi), adına çalışılan bir kişiye bağlıdır | `server/src/services/agents.ts:1232-1270` |
| Ajan çalışma JWT'si | HS256; claim alanları `sub, company_id, adapter_type, run_id, responsible_user_id, key_scope, iat, exp, iss, aud, instance_id, jti`; varsayılan ömrü 48 saat, yayımlayan (issuer) `paperclip`, hedef (audience) `paperclip-api`. İptal edilmiş bir çalışmadan gelen yazmalar reddedilir | `server/src/agent-auth-jwt.ts:10-25`, `:51-53`, `server/src/middleware/auth.ts:354-446` |
| Bulut kiracı başlıkları | Yönetilen bir ön katmandan gelen güvenilir başlıklar; bir sunucu token'ıyla korunur | `server/src/middleware/auth.ts:561-739` |

### 8.3 Roller ve izinler

- Kurulum rolü: `instance_user_roles` tablosunda `instance_admin`. İlk yöneticilik tablo kilidi altında sahiplenilir (`server/src/first-admin-claim.ts:19-55`).
- İnsanlar için şirket üyelik rolleri: `owner`, `admin`, `operator`, `viewer`. `member` ajanların üyelik rolüdür ve insanlar için `operator` rolüne eşlenir (`server/src/services/company-member-roles.ts:11-19`, `server/src/services/principal-access-compatibility.ts:80-111`).
- Rollerin varsayılan izinleri (`server/src/services/company-member-roles.ts:21-62`):

| Rol | Varsayılan izin anahtarları |
|---|---|
| owner | `agents:create, agents:configure, skills:create, environments:manage, users:invite, users:manage_permissions, tasks:assign, joins:approve, tools:manage_connections, tools:manage_runtime, tools:use, tools:admin` |
| admin | `users:manage_permissions` dışında aynısı |
| operator | `tasks:assign` |
| viewer | yok; yol korumasında salt okunur |

- Açıkça verilen izinler, isteğe bağlı bir JSON kapsamıyla `principal_permission_grants` tablosunda durur (`server/src/services/access.ts:905-1050`).
- Son etkin owner çıkarılamaz ve rolü düşürülemez (`server/src/services/access.ts:516-537`, `:582-612`). Bir üye arşivlenince açık görevleri başkasına atanır ya da sıfırlanır (`:645-738`).
- Merkezî karar işlevi (`server/src/services/authorization.ts:1463-2353`): yerel örtük yönetim kurulu kullanıcısına izin verilir (`:1687-1693`); kurulum yöneticisine izin verilir (`:1700-1710`); yönetim kurulunun görevlere yorum yazması ve görevleri değiştirmesi için görüntüleyici olmayan etkin bir üyelik gerekir (`:1793-1827`); ajanlar okuma için, aynı şirket içinde standart görünürlük anlamına gelen "standard same-company agent visibility" kuralından yararlanır (`:2148-2163`); ajanlar, varsayılan olarak açık kuralı gereği görünür görevlere yorum yazabilir ve onları değiştirebilir (`:2219-2249`); ajan için `tasks:assign` (`:2188-2217`); `ceo` rolü ya da `canCreateAgents` için eski oluşturma hakları (`:183-189`, `:2313-2319`); CEO rolü ya da raporlama zincirinde görevin atananının yöneticisi olan ajan için `tasks:manage_active_checkouts` (`:2325-2344`).
- Adına çalışılan kişiyle kesişim: bir ajan eylemi, ajanın adına çalıştığı insanın izinlerine göre de denetlenir. `PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE` ile bir gölge mod vardır (`server/src/services/authorization.ts:2355-2452`, `:504-508`).
- Spec belgesindeki ajan izin tablosu (`doc/SPEC-implementation.md:592-605`) ve çalışma başına başka görevlere en çok 20 yazma sınırı (`:656`).

### 8.4 Davetler ve katılma istekleri

- Davet token'ları `pcp_invite_<32 random bytes base64url>` biçimindedir, özet değeri olarak saklanır ve 72 saat geçerlidir (`server/src/routes/access.ts:114-135`). Davet oluşturmak için `users:invite` gerekir (`:3320-3325`). Bir davet `human`, `agent` ya da `both` türüne izin verir ve insan rolünü taşır; varsayılan `operator` (`:3069-3096`).
- İnsanın kabulü: giriş yapmış bir kullanıcı gerekir; katılma isteği satırı aynı çağrıda yazılır ve davetteki üyelik ve izinlerle onaylanır (`:3725-3742`, `:4097-4104`, `:3127-3202`). Yani bir insanın katılması için davet bağlantısı yeterlidir.
- Ajanın kabulü: `pending_approval` durumunda bir katılma isteği oluşturur ve 7 gün geçerli, tek kullanımlık bir sahiplenme gizli anahtarı `pcp_claim_...` döndürür (`:3860-3867`, `:4107-4125`). `joins:approve` izni olan bir üye onaylar; ajan `idle` durumunda, CEO'ya bağlı, `member` üyelik rolü ve varsayılan izinlerle oluşturulur (`:4199-4346`). Ajan sonra ilk API anahtarını bu gizli anahtarla bir kez alır (`:4397-4479`).
- `bootstrap_ceo` davetleri kurulumun ilk yöneticisini atar (`:3667-3713`).

### 8.5 Şirket içinde görünürlük

- Varsayılan olarak şirket genelindedir. Spec belgesi, bayrakların proje ya da görev gizliliği anlamına gelmediğini söyler ("do not imply project/issue privacy") ve özel iş nesnelerini ücretli bir pakete bırakır (`doc/SPEC-implementation.md:40`, `:605`, `:692`, `:698-703`).
- `project_memberships` ve `agent_memberships` yalnızca kenar çubuğu tercihidir (`doc/DATABASE.md:242-251`).
- Topluluk sürümündeki kodda görünürlüğü daraltan tek mekanizma, ajanlar için sınırlamadır: `low_trust_review` ön ayarı bir ajanı bir projeyle, bir kök görevin alt ağacıyla ya da listelenen görev kimlikleriyle sınırlar. Belge buna "Containment, Not Privacy" (sınırlama, gizlilik değil) adını verir (`doc/LOW-TRUST-PRESETS.md:1-40`, `server/src/services/authorization.ts:980-1134`). Kapsamı sınırlı anahtar türleri (görev köprüsü, skill testi) tek bir anahtarı daraltır (`server/src/services/authorization.ts:1192-1308`).
- Etkileşimler kimin yanıtlayabileceğini sınırlayabilir: `anyone`, `not_creator`, `human_only`; şirket düzeyinde bir üst sınır vardır ve etkileşim bir araç eylemi ya da gizli anahtar önerisi taşıyorsa `human_only` zorunlu olur (`server/src/services/issue-thread-interactions.ts:403-444`).

## 9. Canlı olaylar

- Dağıtıcı: şirket kimliğine göre anahtarlanan süreç içi bir `EventEmitter`; genel bir `*` kanalı ve bütün şirketleri kapsayan bir iç kanalı vardır (`server/src/services/live-events.ts:7-66`). Olay kimlikleri sürece özgü bir sayaçtan gelir (`:11`, `:18-20`). `server/src` üzerinde yapılan grep ne bir Redis istemcisi ne de Postgres LISTEN ya da NOTIFY buluyor; dolayısıyla ikinci bir sunucu süreci olayları görmez.
- Taşıma: `/api/companies/:companyId/events/ws` adresinde WebSocket (`server/src/realtime/live-events-ws.ts:92-101`). Token `Authorization: Bearer` başlığından ya da `?token=` parametresinden alınır (`:135-137`).
- Bağlantı yükseltilirken yetkilendirme: yerel güvenilir modda token'sız istek yönetim kurulu sayılır (`:140-147`); bulut aktörü güvenilir başlıklarla tanınır (`:156-166`); oturum kullanıcısı, kurulum yöneticisiyse ya da etkin üyeyse kabul edilir (`:172-202`); bunların dışında, şirketi yoldaki şirkete eşit olan bir ajan API anahtarı gerekir (`:204-225`). Çalışma JWT'leri bu yolda kabul edilmez.
- 30 saniyede bir ping (`:245-254`).
- Olay türleri bölüm 3'te listelendi. Arayüz güncellemelerinin çoğu `activity.logged` olayından ve `heartbeat.run.*` ailesinden gelir.

## 10. Gizli anahtarlar, depolama, maskeleme

### 10.1 Gizli anahtar sağlayıcıları

| Sağlayıcı | Davranış | Kanıt |
|---|---|---|
| `local_encrypted` (varsayılan) | 12 baytlık IV ile AES-256-GCM. Şifreli veri `company_secret_versions.material` alanında `{scheme: "local_encrypted_v1", iv, tag, ciphertext}` biçiminde saklanır. Kurulum için 32 baytlık tek bir ana anahtar vardır | `server/src/secrets/local-encrypted-provider.ts:14-19`, `:195-206`, `server/src/secrets/configured-provider.ts:3-8` |
| Ana anahtarın kaynağı | `PAPERCLIP_SECRETS_MASTER_KEY` (base64, hex ya da ham 32 karakter); yoksa `PAPERCLIP_SECRETS_MASTER_KEY_FILE` ile verilen ya da `~/.paperclip/instances/default/secrets/master.key` yolundaki anahtar dosyası. Bu dosya ilk kullanımda 0600 moduyla üretilir | `server/src/secrets/local-encrypted-provider.ts:21-25`, `:48-81`, `doc/DATABASE.md:388-445` |
| `aws_secrets_manager` | Gerçek bir modül. Yönetilen gizli anahtarın adı `<prefix>/<deploymentId>/<companyId>/<secretKey>` biçimindedir. Ortam değişkenlerinden bölge, dağıtım kimliği ve bir KMS anahtar kimliği ister. Silme, 7 ile 30 gün arasında bir kurtarma penceresi kullanır | `server/src/secrets/aws-secrets-manager-provider.ts:326-353`, `:376-455` |
| `gcp_secret_manager`, `vault` | Yer tutucu modüller. Dış referansları üst veri olarak kabul eder ama değerleri çözümleyemez | `server/src/secrets/external-stub-providers.ts:5-77`, `server/src/secrets/provider-registry.ts:11-16` |

Veritabanı yedekleri ana anahtarı ve yüklenen dosyaları içermez (`doc/DATABASE.md:376-386`). Yerel sağlayıcının sağlık denetimi de aynı şeyi söyler (`server/src/secrets/local-encrypted-provider.ts:109-193`).

### 10.2 Gizli anahtar kullanımı

- Bir gizli anahtara yapılandırmada `{type: "secret_ref", secretId, version}` ya da `{type: "user_secret_ref", key}` ile başvurulur. Düz değerler `{type: "plain", value}` biçimindedir (`server/src/services/secrets.ts:777-800`).
- Sıkı mod, adı hassas görünen ortam değişkeni anahtarlarında düz değerleri reddeder ve maskeleme yer tutucusunun kaydedilmesine izin vermez (`server/src/services/secrets.ts:99-100`, `:1883-1930`). Kimlik doğrulamalı modda varsayılan olarak açıktır (`server/src/config.ts:170-174`).
- Çözümleme sırasında şirket, kapsam, gizli anahtarın durumu, kullanan taraf ve yapılandırma yolu için bağlama ve sürüm durumu denetlenir; ardından sağlayıcı çağrılır ve hem başarıda hem başarısızlıkta bir `secret_access_events` satırı yazılır (`server/src/services/secrets.ts:1132-1170`, `:1353-1455`).
- Bir ajan yalnızca kendisine bağlanmış gizli anahtarları, yalnızca çalışmaya bağlı kimlik doğrulamayla listeleyebilir ve getirebilir. Yanıt `Cache-Control: no-store` taşır ve değer o çalışmada maskelenmek üzere kaydedilir (`server/src/routes/secrets.ts:129-142`, `:314-359`).
- Ajanlar doğrudan gizli anahtar oluşturamaz. Yönetim kurulu kullanıcısının onayladığı öneriler gönderirler (`server/src/routes/secrets.ts:194-312`).
- Şirket düzeyindeki yazmalar şirkete yönetim kurulu erişimi ister; kullanıcı gizli anahtar tanımları `owner` ya da `admin` ister (`server/src/routes/secrets.ts:68-84`).

### 10.3 Depolama

- Depolama arayüzü `putObject`, `getObject`, `headObject`, `deleteObject` işlevlerinden oluşur (`server/src/storage/types.ts:39-45`). Sağlayıcılar: yerel disk ve S3 uyumlu depolama (`server/src/storage/provider-registry.ts:6-18`). Varsayılan yerel disktir (`server/src/config.ts:141-146`).
- Nesne anahtarı: `<companyId>/<namespace>/<YYYY>/<MM>/<DD>/<uuid>-<name><ext>` (`server/src/storage/service.ts:61-71`). Şirket ön ekinin dışına erişim reddedilir (`:47-55`).
- Yerel disk önce geçici bir dosyaya yazar, sonra dosyayı yeniden adlandırır; dizin dışına çıkma (path traversal) denetimleri vardır (`server/src/storage/local-disk-provider.ts:6-28`, `:44-54`).
- S3, 16 MiB üzerinde çok parçalı yükleme kullanır; özel uç nokta, ön ek ve yol biçimini (path style) destekler (`server/src/storage/s3-provider.ts:74-98`).
- Yükleme sınırı: varsayılan olarak 10 MiB, ortam değişkeni `PAPERCLIP_ATTACHMENT_MAX_BYTES` (`server/src/attachment-types.ts:164-165`). İzin verilen içerik türleri varsayılan bir listedir; `PAPERCLIP_ALLOWED_ATTACHMENT_TYPES` ortam değişkeni bu listenin yerine geçebilir (`:1-49`). SVG logolar temizlenir (`server/src/routes/assets.ts:26-88`).
- Üst veri (`sha256`, boyut, içerik türü, dosya adı) `assets` tablosunda saklanır.

### 10.4 Maskeleme katmanları

| Katman | Ne yapar | Kanıt |
|---|---|---|
| Olay ve yapılandırma içerikleri | Gizli anahtara benzeyen anahtarlar `***REDACTED***` ile değiştirilir; JWT biçimli metinler değiştirilir; `--token X` gibi CLI bayraklarında değer silinir; ajan ortam değişkeni değerleri, gizli anahtar referansı olmadıkça her zaman maskelenir | `server/src/redaction.ts:4-6`, `:381`, `:837-851`, `:881-939`, `:963-990` |
| Serbest metin | Metnin içindeki Authorization başlıkları, bearer token'ları ve JSON gizli anahtar alanları maskelenir | `server/src/redaction.ts:992-1003` |
| HTTP hata logları | İstek gövdesi, parametreler ve sorgu taranır; hassas anahtarlar `[REDACTED]` olur; adresin sorgu ve parça (fragment) bölümleri atılır | `server/src/middleware/redact-sensitive.ts:14-157` |
| HTTP log bileşeni | Çıkarılan başlık yolları: authorization, cookie, set-cookie, API anahtarı ve bulut başlıkları | `server/src/middleware/http-log-redaction.ts:1-29` |
| Çalışma çıktısı | Çalışma sırasında getirilen gizli anahtar değerleri, çalışmanın bağlam anlık görüntüsünde şifreli tutulur ve çalışma ile görev yanıtlarında değiştirilir | `server/src/services/run-secret-redaction.ts:9-11`, `:37-57`, `:95-145` |
| Kullanıcı adları | Kurulum ayarı `censorUsernameInLogs` açıksa işletim sistemi kullanıcı adı ve ev dizini loglarda ve yorum gövdelerinde maskelenir | `server/src/log-redaction.ts:43-130`, `server/src/services/issues.ts:12200-12207` |
| Etkinlik ayrıntıları | Eklenmeden önce maskelenir | `server/src/services/activity-log.ts:160-215` |

## 11. Paperclip modeli ile company_id + RLS modelinin karşılaştırması

Agent Office tarafı görev talimatından ve `CLAUDE.md` dosyasından alındı (Fastify API ve Claude API'yi çağıran worker; şirket verisi tutan her tabloda `company_id` ve RLS bulunan Supabase Postgres; her işlemde `SET LOCAL app.company_id`, `app.user_id`, `app.project_id` kullanan kısıtlı bir rol; pg-boss; `tasks`, `runs`, `approvals`, `notes`, `documents`, `audit_log`, `projects`, `project_members`, `company_agents`, `agent_definitions`, `card_versions` tabloları).

### 11.1 Yan yana karşılaştırma

| Konu | Paperclip (kanıt) | Agent Office (talimat) |
|---|---|---|
| Kiracı yalıtımı | Uygulama düzeyinde sorgu koşulları ve yol korumaları. RLS yok (bölüm 7.1) | Her şirket tablosunda RLS, BYPASSRLS yetkisi olmayan kısıtlı rol, `SET LOCAL` ile bağlam |
| Aynı şirket içi göndermeler | Temel tablolarda servis denetimleri, bileşik yabancı anahtarlar yalnızca yeni tablolarda (bölüm 2.2) | RLS politikaları bağlamı okur; bağlam yoksa hiçbir satır dönmez |
| Şirket içinde görünürlük | Şirket geneli. Proje ve görev gizliliği ertelenmiş (bölüm 8.5) | `project_id` taşıyan satırları yalnızca proje üyeleri ve kurucu görür; ajan çalışmaları kendi projesiyle sınırlanır |
| İki şirket bir arada | Kurulum yöneticisi için şirket dizini ve sayılar; bir kullanıcı birden çok şirkete üye olabilir | Yalnızca kurucunun salt okunur holding görünümü |
| Ajanlar ve şirketler | Bir ajan satırı tek bir şirkete aittir (`agents.company_id` NOT NULL). Yeniden kullanım dışa ve içe aktarmayla olur | Ortak `agent_definitions` ve `card_versions`; şirkete özel, durdurma düğmesi olan `company_agents` |
| Ajan tanımının kaynağı | Yapılandırma sürümleri ve talimat sürümleri olan veritabanı satırları | Depodaki dosyalar; git commit kimliğiyle `card_versions` tablosuna eşitlenir |
| İş birimi | 7 durumlu `issues`; üstlenme kilitleri, engelleyenler, üst ve alt görev | `open, in_progress, awaiting_approval, awaiting_reply, done, cancelled` durumlu `tasks` |
| İnsan kapısı | Onaylar (4 tür), yanıtlama kuralı olan etkileşimler, araç kuralı `require_approval` (bölüm 6.2) | Dışa etkili her eylem kod gereği Onay Masası'na düşer; Y1 iç yazmalar da öyle |
| Özerklik seviyeleri | İzin anahtarları, `permissions` JSON'u, güven ön ayarları `standard` ve `low_trust_review` | Kart başına Y0 ile Y3 arası yetki seviyesi ve araç sınıfları `read, draft, internal_write, external_effect` |
| Kuyruk | Yok. `agent_wakeup_requests` ve `heartbeat_runs` satırları, süreç içi zamanlayıcı | pg-boss; işlere yalnızca kimlik konur |
| Çalışma kaydı | `heartbeat_runs`, ayrıca `cost_events` (sağlayıcı, faturalayan, model, token, sent) ve adına çalışılan kişiyi taşıyan `activity_log` | `runs` ve `audit_log`; model, kart sürümü, token, maliyet ve süre ile |
| İnsan girişi | better-auth ile e-posta ve parola, MFA yapılandırılmamış (bölüm 8.2) | Google ile davetli giriş, zorunlu iki adımlı doğrulama, önemli onaylarda passkey ile yeniden doğrulama |
| Bilgi tabanı | Görevlere, rutinlere ve case'lere bağlı belgeler; görevler arası göndermeler. Not ya da wiki tablosu yok | `[[links]]` bağlantılı Markdown notlar ve `note_links` |
| Canlı olaylar | Süreç içi dağıtıcıdan şirket başına WebSocket | talimatta belirtilmemiş |

### 11.2 Paperclip'te olup talimatın Agent Office için saymadıkları

1. İş kaydında atomik üstlenme ve yürütme kilitleri; eskimiş kilitlerin kurtarılmasıyla birlikte (bölüm 4.1).
2. Döngü denetimli engelleyen ilişkileri ve son engelleyen bitince otomatik uyandırma; bütün alt görevler kapanınca üst görevin uyandırılması (bölüm 4.1, 6.1).
3. Şirket başına, insanın okuyabileceği kimlikler (`PREFIX-N`) ve görevler arası göndermeler.
4. Yapılandırılmış görev içi etkileşimler: görev önerisi, soru, onay isteği, işaretli onay, kalem kalem karar; her birinde tekrar önleme anahtarı, yanıtlama kuralı, muhatap ve devam kuralı vardır (bölüm 2.3, `issue_thread_interactions`).
5. Görev başına inceleme ve onay aşamaları; kararlar `issue_execution_decisions` tablosunda saklanır (bölüm 4.1).
6. Sürümleri, iyimser eş zamanlılık denetimi, kilitleri ve metne bağlı pasaj yorumu dizileri olan belgeler (bölüm 6.9).
7. İnceleme durumu olan, türü belli çıktılar (bölüm 6.9).
8. Başlı başına bir veri türü olarak bütçeler: şirket, ajan ya da proje başına kurallar, uyarı eşiği ve kesin eşik, olaylar, otomatik duraklatma ve çalışma iptali, onay yoluyla aşım izni (bölüm 6.3).
9. Ajan, model, sağlayıcı, faturalayan ve projeye göre maliyet analizi, kayan pencereler ve ayrıca bir finans defteri (bölüm 6.3).
10. Kullanıcıya özel yok sayma ve erteleme, okundu bilgisi, Gelen kutusu arşivi ve rozet sayıları olan birleşik bir ilgi bekleyenler akışı (bölüm 6.1, 6.5).
11. Zamanlama, webhook ve API tetikleyicileri, çakışma ve kaçırılanlar kuralları, etkinlik kapısı, sürümleri ve imzalı herkese açık webhook'ları olan rutinler (bölüm 6.6).
12. Organizasyon ağacı (`reports_to`), onaylı işe alma akışı, kapsamı ve adına çalışılan kişisi olan ajan API anahtarları, geri alınabilen yapılandırma sürümleri (bölüm 4.2, 5.2).
13. Her ajan eyleminin etkinlik kaydında sorumlu bir insana bağlanması ve kendisi de kaydedilen CSV denetim dışa aktarımı (bölüm 6.4).
14. Sürümleri, kullanan taraf ve yapılandırma yolu başına bağlamaları, erişim olayları, sağlayıcı soyutlaması ve ajan önerileri olan gizli anahtar yönetimi (bölüm 10).
15. Görevlerde, yorumlarda, belgelerde ve çıktılarda kaynak güveni üst verisi; düşük güvenli çıktı için karantina ve yükseltme yolu (`packages/db/src/schema/issues.ts:83`, `server/src/routes/issues.ts:10961`).
16. Görevler, yorumlar ve belgeler üzerinde kırılımlı, sözcük temelli arama (bölüm 6.8).
17. Şirketin dosya paketi olarak dışa ve içe aktarılması (bölüm 6.10).
18. Projelere ve görevlere bağlı hedef hiyerarşisi (bölüm 6.7).
19. WebSocket üzerinden canlı olaylar (bölüm 9).

### 11.3 Agent Office'te olup Paperclip'te olmayanlar

Her satırda, o özelliğin Paperclip'te bulunmadığını gösteren kanıt yazılıdır.

1. Veritabanının uyguladığı kiracı yalıtımı. Paperclip'te RLS, politika ya da kısıtlı rol yok (bölüm 7.1).
2. Satır düzeyinde proje görünürlüğü. Paperclip bütün işi şirket genelinde görünür tutar ve üyelikleri yalnızca kenar çubuğu için kullanır (bölüm 8.5).
3. Dışa etkili eylemlerin hepsini kapsayan bir onay kapısı. Paperclip'te araç çağrılarının onayı araç kurallarına (`allow, block, require_approval, trust_rule, rate_limit`, `packages/shared/src/constants.ts:1141-1147`) ve aracın risk sınıfına bağlıdır; temel onay türleri yalnızca işe alma, CEO stratejisi, bütçe aşımı ve yönetim kurulu onayı isteklerini kapsar (bölüm 4.3).
4. Sabit bir model olarak araç sınıfları ve yetki seviyeleri. Paperclip'te izin anahtarları ve güven ön ayarları var, Y0 ile Y3 arası bir ölçek yok (bölüm 8.3).
5. Para transferi, imza, resmî kurumlara başvuru ve kişisel verinin silinmesi için koda gömülü yasaklar. Bu rapor için okunan dosyalarda eşdeğer bir kural bulunmadı.
6. Şirketler arasında ortak kullanılan, şirket başına aç/kapa düğmesi olan ajan tanımları. Paperclip'te ajanlar şirkete özeldir (`packages/db/src/schema/agents.ts:20`).
7. Bir git commit'ine sabitlenen ve her çalışmada kaydedilen kart sürümleri. Paperclip'te `agent_config_revisions` ve talimat sürümleri var; `heartbeat_runs` tablosunda bir sürümü sabitleyen ayrı bir sütun yok (sütun listesi `packages/db/src/schema/heartbeat_runs.ts:20-166`; `context_snapshot` içeriği denetlenmedi).
8. Müşteri ve proje başına, yapay zekânın kullanılıp kullanılamayacağına ilişkin izin. Paperclip'in 226 tablosu arasında `customers` tablosu yok; en yakın denetimler proje duraklatma ve bütçelerdir.
9. Güçlü insan kimlik doğrulaması: Google kimliği, zorunlu iki adımlı doğrulama, passkey ile yeniden doğrulama, oturum için hareketsizlik ve mutlak süre sınırları. Paperclip yapılandırmasında yalnızca e-posta ve parola görünüyor (bölüm 8.2).
10. Wiki bağlantıları ve geri bağlantıları olan bir not bilgi tabanı. Paperclip'te not, wiki ya da hafıza tablosu yok (`packages/db/src/schema` üzerinde grep).
11. Bir şirket türü olarak, yalnızca kurucuya açık özel alan. Paperclip'te `companies` tablosunda `kind` sütunu yok (`packages/db/src/schema/companies.ts:4-37`).
12. Kalıcı bir dış kuyruk. Paperclip zamanlama ve canlı olay dağıtıcısı için tek bir sunucu sürecine dayanır (`doc/SPEC-implementation.md:115-123`, bölüm 9).
13. Yalnızca ekleme yapılan bir iz kaydı beklentisi. Paperclip, şirket ve ajan kalıcı olarak silinirken etkinlik satırlarını da siler (bölüm 6.4).

### 11.4 Uyarlama için eşleme

Bunlar öneridir, Paperclip'e ilişkin bulgu değildir. Her satır, kopyalanacak Paperclip yapısını ve RLS modeline nasıl oturduğunu belirtir.

| Alınacak kavram | Paperclip'teki kaynak | Agent Office'e uyumu |
|---|---|---|
| Görev kimliği | `companies.issue_prefix`, `issue_counter`, `issues.identifier` | `companies` tablosuna şirket kodu ve sayaç, `tasks` tablosuna `task_number` ve `identifier` eklenir. Numara, isteğin veritabanı işlemi içinde verilir |
| Üstlenme kilidi | `issues.checkout_run_id`, `execution_run_id`, koşullu UPDATE | `tasks` tablosuna `checkout_run_id` eklenir; worker, kısıtlı rolle çalıştırdığı tek bir koşullu UPDATE ile görevi üstlenir |
| Engelleyenler | Tekil ilişkili ve döngü denetimli `issue_relations` | `tasks` ile aynı RLS kurallarını taşıyan yeni tablo `task_relations(company_id, project_id, blocker_task_id, blocked_task_id)` |
| Alt görevler | `issues.parent_id`, `request_depth` | `tasks.parent_id`, bir derinlik sınırıyla |
| Durum eşlemesi | `backlog, todo, in_progress, in_review, blocked, done, cancelled` | Agent Office'in altı durumu korunur. `awaiting_approval`, `in_review` ile bekleyen bir onayı karşılar; `awaiting_reply`, bekleyen sorusu olan `blocked` durumunu karşılar. Paperclip'in "engellenmiş görev neyi beklediğini göstermeli" kuralına benzer bir `blocked_reason` ya da engelleyen ilişkisi kuralı eklenir |
| İnsana sorulan sorular | `idempotency_key`, `payload`, `result`, `continuation_policy` alanlı `issue_thread_interactions` (`ask_user_questions`, `request_confirmation`) | Onay Masası'na düşmemesi gereken "İnsana sor" yoluna uyar. Tür, durum, muhatap, içerik ve sonuç alanları olan tek bir `task_interactions` tablosu |
| Onay düzeltmeleri | Onay durumu `revision_requested` ve `resubmit`, ayrıca `approval_comments` | Agent Office'te `changes_requested` zaten var. Yorumlar ve yeniden gönderme geçişi eklenir |
| Araç eylemi onayı | Argümanların kanonik özet değerini ve imzalı argümanları taşıyan, bir kez çalıştırılan `tool_action_requests` | İncelenen argümanlar olduğu gibi onay satırıyla birlikte saklanır; böylece worker onaylanan şeyi çalıştırır |
| Bütçeler | `budget_policies`, `budget_incidents`, kesin durdurma | Talimatta `company_agents` içinde bir bütçe ayarı var. Şirket, ajan ve proje başına kurallar ile olaylar, uyarı ve durdurma geçmişi kazandırır |
| Maliyet olayları | Çalışmalardan ayrı `cost_events`; sağlayıcı, faturalayan, model ve token sayılarıyla | Maliyet `runs` üzerinde tutulur ya da tek bir çalışma birden çok model çağrısı yapıyorsa bir alt tablo eklenir |
| İlgi bekleyenler ve Gelen kutusu | `issue_read_states`, `issue_inbox_archives`, `inbox_dismissals`, ilgi bekleyenler akışının kurulması | `app.user_id` üzerinde RLS olan, kullanıcıya özel tablolar. Akış API'de onaylardan, etkileşimlerden, başarısız çalışmalardan ve bütçe olaylarından kurulabilir |
| Rutinler | `routines`, `routine_triggers`, `routine_runs` ve kural enum değerleri | Zamanlanmış kart çalışmalarına karşılık gelir. Tetiklemeyi pg-boss yapabilir; `routine_runs`, `linked_task_id` alanıyla geçmiş olarak tutulur |
| Etkinlik eylemleri | `entity_type`, `entity_id`, `<entity>.<verb>` biçiminde adlandırılan `action`, `responsible_user_id` | Adlandırma `audit_log` tablosuna uygulanır; tabloya yalnızca ekleme yapılır |
| Belge sürümleri | `documents`, `document_revisions`, `baseRevisionId` denetimi | "Düzeltme iste" turlarından geçen taslaklar için yararlıdır |
| Gizli anahtarlar | sürümler, bağlamalar, erişim olayları | Token'lar için düşünülen "dar dosya modülü" fikrine uyar: şifreli veri saklanır, her çözümleme kaydedilir |
| Canlı güncelleme | şirkete göre anahtarlanan WebSocket | İki süreç (API ve worker) olduğu için süreç içi dağıtıcı yerine Postgres LISTEN ya da bir pg-boss olayı gerekir |

Olduğu gibi kopyalanmaması gereken noktalar: geçiş tablosu olmayan serbest durum geçişleri (bölüm 4.1), iz kaydı satırlarını silen kalıcı silmeler (bölüm 6.4), owner denetimi olmadan şirket silme (bölüm 7.5), kurulum yöneticisinin üyesi olmadığı şirketlerin olay akışına erişmesi (bölüm 7.4), işleyicisi olmayan onay türleri (`approve_ceo_strategy`, bölüm 4.3).

## 12. Doğrulanmayanlar

- 891 yolun bir kısmında işleyici gövdesi okunmadı. Bölüm 5'teki tablolar okunanları satır aralıklarıyla gösterir; diğer amaçlar OpenAPI özetlerinden gelir.
- `server/src/services/company-portability.ts`, `server/src/services/attention.ts`, `server/src/services/projects.ts` ve `server/src/services/issue-thread-interactions.ts` kısmen okundu (genel yapı ve kaynak gösterilen aralıklar).
- Oturum süresiyle ilgili better-auth ayarları denetlenmedi.
- Araç geçidi kural varsayılanları, eklentilerin iç yapısı, sohbet bağlayıcıları, Pipelines ve Cases için yalnızca envanter çıkarıldı.
- Diğer canlı olay dosyaları (`runner-prp-ws.ts`, `runner-prp-outbound.ts`, `environment-custom-image-terminal-ws.ts`) okunmadı.
- Arayüz bu raporun kapsamında değildi.
