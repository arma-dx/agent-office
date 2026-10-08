# Ad sözlüğü (Türkçe → İngilizce)

3 Ekim 2026 kararıyla (karar 4) veritabanı adları ve değerleri, kod, kod içi açıklamalar, testler ve commit mesajları İngilizcedir. Ekrandaki metinler, `docs/` belgeleri ve kartların içerik metni Türkçe kalır. Bu sözlük eski adları (kararlar, eski belgeler) yeni adlarla eşler; yeni bir ad eklerken buraya da yazılır.

Değişmeyenler: birim ve ajan kodları (`KOR`, `A-KES`, `KOR-1`), yetki seviyeleri (`Y0`-`Y3`), şirket kodları `armadx` ve `pillika` (`kurucu_alani` → `founder_space`), veri olarak tutulan görünen adlar (birim adları, şirket adları).

## Şema ve roller

| Eski | Yeni |
| --- | --- |
| `ofis` | `office` |
| `pgboss` | `pgboss` |
| `ofis_uygulama` | `office_app` |
| `ofis_yetki_okuyucu` | `office_auth_reader` |
| `ofis_tetikleyici` | `office_trigger` |
| `ofis_kuyruk` | `office_queue` |
| `ofis_api` | `office_api` |
| `ofis_worker` | `office_worker` |

## Bağlam değişkenleri

| Eski | Yeni |
| --- | --- |
| `app.sirket_id` | `app.company_id` |
| `app.kullanici_id` | `app.user_id` |
| `app.proje_id` | `app.project_id` |
| `app.eposta` | `app.email` |
| `app.ajan_kod` | `app.agent_code` |

## Tablolar ve alanlar

- `birimler` → `units`: `kod` → `code`, `ad` → `name`, `aciklama` → `description`, `sirket_kod` → `company_code`, `pilotta_acik` → `pilot_enabled`
- `ajan_tanimlari` → `agent_definitions`: `kod` → `code`, `ad` → `name`, `birim_kod` → `unit_code`, `sirket_kodlari` → `company_codes`, `guncel_surum_id` → `current_version_id`
- `kart_surumleri` → `card_versions`: `ajan_kod` → `agent_code`, `icerik` → `content`, `yetki_seviyesi` → `authority_level`, `olusturma` → `created_at`
- `araclar` → `tools`: `ad` → `name`, `sinif` → `kind`, `aciklama` → `description`, `onay` → `approval_rule`
- `sirketler` → `companies`: `kod` → `code`, `ad` → `name`, `tur` → `kind`, `olusturma` → `created_at`
- `kullanicilar` → `users`: `ad` → `name`, `aktif` → `active`, `olusturma` → `created_at`
- `kullanici_epostalari` → `user_emails`: `eposta` → `email`, `kullanici_id` → `user_id`, `olusturma` → `created_at`
- `uyelikler` → `memberships`: `sirket_id` → `company_id`, `kullanici_id` → `user_id`, `rol` → `role`, `onay_yetkisi` → `can_approve`, `olusturma` → `created_at`
- `sirket_ajanlari` → `company_agents`: `sirket_id` → `company_id`, `ajan_kod` → `agent_code`, `durum` → `status`, `ayarlar` → `settings`, `aylik_butce` → `monthly_budget`, `guncelleme` → `updated_at`
- `musteriler` → `customers`: `sirket_id` → `company_id`, `ad` → `name`, `kisiler` → `contacts`, `ai_izni` → `ai_allowed`, `otomatik_isleme_izni` → `automated_processing_allowed`, `olusturma` → `created_at`
- `firsatlar` → `opportunities`: `sirket_id` → `company_id`, `musteri_id` → `customer_id`, `ad` → `name`, `asama` → `stage`, `deger` → `value`, `sonraki_adim` → `next_step`, `teklif_sonucu` → `proposal_outcome`, `olusturma` → `created_at`
- `projeler` → `projects`: `sirket_id` → `company_id`, `musteri_id` → `customer_id`, `ad` → `name`, `butce` → `budget`, `kilometre_taslari` → `milestones`, `ai_izni` → `ai_allowed`, `durum` → `status`, `olusturma` → `created_at`
- `proje_uyeleri` → `project_members`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `kullanici_id` → `user_id`
- `is_turleri` → `work_types`: `sirket_id` → `company_id`, `kod` → `code`, `ad` → `name`, `eski_sure_dakika` → `baseline_minutes`, `olcum_notu` → `measurement_note`
- `gorevler` → `tasks`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `ust_gorev_id` → `parent_task_id`, `birim_kod` → `unit_code`, `ilk_birim_kod` → `initial_unit_code`, `yonlendirme_duzeltildi` → `routing_corrected`, `baslik` → `title`, `aciklama` → `description`, `talep_eden_kullanici_id` → `requester_user_id`, `atanan_kullanici_id` → `assignee_user_id`, `atanan_ajan_kod` → `assignee_agent_code`, `durum` → `status`, `oncelik` → `priority`, `son_tarih` → `due_at`, `kaynak_turu` → `source_kind`, `is_turu_id` → `work_type_id`, `surum` → `version`, `olusturma` → `created_at`, `guncelleme` → `updated_at`, `tamamlanma` → `completed_at`
- `gorev_yorumlari` → `task_comments`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `gorev_id` → `task_id`, `yazan_kullanici_id` → `author_user_id`, `yazan_ajan_kod` → `author_agent_code`, `metin` → `body`, `olusturma` → `created_at`
- `erisim_paylasimlari` → `access_grants`: `sirket_id` → `company_id`, `kullanici_id` → `user_id`, `kayit_turu` → `record_type`, `kayit_id` → `record_id`, `olusturma` → `created_at`
- `calismalar` → `runs`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `gorev_id` → `task_id`, `ajan_kod` → `agent_code`, `kart_surum_id` → `card_version_id`, `kullanici_id` → `user_id`, `tetik` → `trigger_type`, `durum` → `status`, `etiket` → `label`, `girdi_token` → `input_tokens`, `cikti_token` → `output_tokens`, `onbellek_yazma_token` → `cache_write_tokens`, `onbellek_okuma_token` → `cache_read_tokens`, `maliyet` → `cost_usd`, `arac_cagrisi_sayisi` → `tool_call_count`, `baslama` → `started_at`, `bitis` → `finished_at`, `sure_ms` → `duration_ms`, `hata_kodu` → `error_code`, `ozet` → `summary`, `girdi` → `input`, `cikti` → `output`, `ham_saklama_sonu` → `raw_retain_until`, `ham_silindi` → `raw_deleted_at`
- `arac_cagrilari` → `tool_calls`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `calisma_id` → `run_id`, `sira` → `seq`, `arac_ad` → `tool_name`, `durum` → `status`, `onay_id` → `approval_id`, `hata_kodu` → `error_code`, `baslama` → `started_at`, `bitis` → `finished_at`, `sure_ms` → `duration_ms`, `girdi` → `input`, `sonuc` → `result`, `ham_saklama_sonu` → `raw_retain_until`, `ham_silindi` → `raw_deleted_at`
- `notlar` → `notes`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `klasor` → `folder`, `baslik` → `title`, `ozellikler` → `properties`, `govde` → `body`, `durum` → `status`, `tek_dogru_kaynak` → `is_source_of_truth`, `kaynak_turu` → `source_kind`, `surum` → `version`, `olusturan_kullanici_id` → `created_by_user_id`, `olusturan_ajan_kod` → `created_by_agent_code`, `guncelleyen_kullanici_id` → `updated_by_user_id`, `guncelleyen_ajan_kod` → `updated_by_agent_code`, `olusturma` → `created_at`, `guncelleme` → `updated_at`, `arama` → `search_vector`
- `not_surumleri` → `note_versions`: `sirket_id` → `company_id`, `not_id` → `note_id`, `surum` → `version`, `proje_id` → `project_id`, `klasor` → `folder`, `baslik` → `title`, `ozellikler` → `properties`, `govde` → `body`, `durum` → `status`, `tek_dogru_kaynak` → `is_source_of_truth`, `kaynak_turu` → `source_kind`, `yazan_kullanici_id` → `author_user_id`, `yazan_ajan_kod` → `author_agent_code`, `olusturma` → `created_at`
- `not_baglantilari` → `note_links`: `sirket_id` → `company_id`, `kaynak_not_id` → `source_note_id`, `hedef_ad` → `target_title`
- `belgeler` → `documents`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `drive_dosya_id` → `drive_file_id`, `ad` → `name`, `mime_turu` → `mime_type`, `drive_degisme` → `drive_modified_at`, `kaynak_not_id` → `source_note_id`, `olusturma` → `created_at`, `guncelleme` → `updated_at`
- `dosyalar` → `files`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `gorev_id` → `task_id`, `calisma_id` → `run_id`, `ad` → `name`, `mime_turu` → `mime_type`, `boyut_bayt` → `size_bytes`, `depolama_yolu` → `storage_path`, `olusturan_kullanici_id` → `created_by_user_id`, `olusturan_ajan_kod` → `created_by_agent_code`, `olusturma` → `created_at`
- `onaylar` → `approvals`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `gorev_id` → `task_id`, `calisma_id` → `run_id`, `ajan_kod` → `agent_code`, `arac_ad` → `tool_name`, `baslik` → `title`, `ozet` → `summary`, `risk_notu` → `risk_note`, `fark` → `diff`, `icerik` → `payload`, `kaynaklar` → `sources`, `secenekler` → `options`, `oncelik` → `priority`, `ajan_gerekcesi` → `agent_rationale`, `dayanak_turu` → `basis_type`, `dayanak_id` → `basis_id`, `dayanak_surumu` → `basis_version`, `onceki_onay_id` → `previous_approval_id`, `deneme` → `attempt`, `durum` → `status`, `karar_veren_kullanici_id` → `decided_by_user_id`, `karar_zamani` → `decided_at`, `karar_gerekcesi` → `decision_reason`, `ret_nedeni` → `rejection_reason`, `secilen_secenek` → `selected_option`, `gecersiz_zamani` → `invalidated_at`, `gonderildi_kullanici_id` → `sent_by_user_id`, `gonderildi_zamani` → `sent_at`, `olusturma` → `created_at`
- `kritik_hatalar` → `critical_errors`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `onay_id` → `approval_id`, `ajan_kod` → `agent_code`, `gerekce` → `reason`, `isaretleyen_kullanici_id` → `flagged_by_user_id`, `inceleme_gorev_id` → `review_task_id`, `olusturma` → `created_at`
- `bildirimler` → `notifications`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `alici_kullanici_id` → `recipient_user_id`, `sablon` → `template`, `kayit_turu` → `record_type`, `kayit_id` → `record_id`, `kanal` → `channel`, `gonderen_ajan_kod` → `sender_agent_code`, `gonderen_kullanici_id` → `sender_user_id`, `olusturma` → `created_at`, `okunma` → `read_at`
- `istasyon_adaylari` → `station_candidates`: `sirket_id` → `company_id`, `kaynak` → `source`, `kaynak_kayit_kimligi` → `source_record_id`, `ad` → `name`, `adres` → `address`, `enlem` → `latitude`, `boylam` → `longitude`, `soket_tipleri` → `connector_types`, `guc_kw` → `power_kw`, `erisim` → `access`, `veri_tarihi` → `data_date`, `kapali` → `is_closed`, `dogrulama_durumu` → `verification_status`, `eslesen_kayit` → `matched_record`, `calisma_id` → `run_id`, `olusturma` → `created_at`, `guncelleme` → `updated_at`
- `entegrasyonlar` → `integrations`: `sirket_id` → `company_id`, `tur` → `provider`, `hesap` → `account`, `kapsamlar` → `scopes`, `ayarlar` → `settings`, `token_sifreli` → `encrypted_token`, `durum` → `status`, `kuran_kullanici_id` → `connected_by_user_id`, `olusturma` → `created_at`, `guncelleme` → `updated_at`
- `iz_kaydi` → `audit_log`: `sirket_id` → `company_id`, `proje_id` → `project_id`, `zaman` → `occurred_at`, `kullanici_id` → `user_id`, `ajan_kod` → `agent_code`, `calisma_id` → `run_id`, `olay` → `event`, `arac_ad` → `tool_name`, `kayit_turu` → `record_type`, `kayit_id` → `record_id`, `dis_kimlik` → `external_ref`

## Değerler

- companies.kind: `sirket` → `company`, `ozel_alan` → `private_space`
- companies.code: `kurucu_alani` → `founder_space`
- memberships.role: `kurucu` → `founder`, `calisan` → `employee`, `dis_kisi` → `external`
- tools.kind: `okuma` → `read`, `taslak` → `draft`, `ic_yazma` → `internal_write`, `dis_etki` → `external_effect`
- company_agents.status: `kapali` → `disabled`, `acik` → `enabled`, `durduruldu` → `stopped`
- opportunities.stage (default): `yeni` → `new`
- opportunities.proposal_outcome: `verildi` → `submitted`, `kazanildi` → `won`, `kaybedildi` → `lost`
- projects.status: `acik` → `open`, `kapali` → `closed`
- tasks.status: `acik` → `open`, `suruyor` → `in_progress`, `onay_bekliyor` → `awaiting_approval`, `yanit_bekliyor` → `awaiting_reply`, `tamamlandi` → `done`, `iptal` → `cancelled`
- tasks.source_kind / notes.source_kind: `ic` → `internal`, `dis` → `external`
- access_grants.record_type: `gorev` → `task`, `not` → `note`
- runs.trigger_type: `talep` → `request`, `zamanlanmis` → `scheduled`, `olay` → `event`, `devir` → `handoff`
- runs.status: `suruyor` → `running`, `tamamlandi` → `completed`, `hata` → `failed`, `sinira_takildi` → `limit_reached`, `durduruldu` → `stopped`
- runs.label: `ic_is` → `internal`, `proje` → `project`
- tool_calls.status: `basladi` → `started`, `tamam` → `succeeded`, `hata` → `failed`, `onaya_gonderildi` → `sent_for_approval`, `engellendi` → `blocked`
- notes.status: `taslak` → `draft`, `etkin` → `active`, `eskimis` → `outdated`, `arsiv` → `archived`
- approvals.basis_type: `gorev` → `task`, `not` → `note`
- approvals.status: `bekliyor` → `pending`, `onaylandi` → `approved`, `duzeltme_istendi` → `changes_requested`, `reddedildi` → `rejected`
- approvals.rejection_reason: `bilgi_hatali` → `incorrect_information`, `eksik` → `incomplete`, `dil_ve_ton` → `language_and_tone`, `fiyat` → `pricing`, `kapsam_disi` → `out_of_scope`, `diger` → `other`
- notifications.channel: `eposta` → `email`
- station_candidates.verification_status: `bekliyor` → `pending`, `dogrulandi` → `verified`, `reddedildi` → `rejected`
- integrations.status: `kapali` → `disabled`, `acik` → `enabled`, `hata` → `error`
- inherit_project_scope mode argument: `turet` → `derive`, `denetle` → `check`

## İşlevler

| Eski | Yeni |
| --- | --- |
| `baglam_sirket` | `ctx_company_id` |
| `baglam_kullanici` | `ctx_user_id` |
| `baglam_proje` | `ctx_project_id` |
| `baglam_eposta` | `ctx_email` |
| `baglam_ajan` | `ctx_agent_code` |
| `guncelleme_zamani` | `set_updated_at` |
| `degismez_alanlar` | `prevent_column_changes` |
| `proje_kapsami` | `inherit_project_scope` |
| `rolum` | `my_role` |
| `sirket_ici_mi` | `is_insider` |
| `kurucu_mu` | `is_founder` |
| `onay_yetkili_mi` | `can_approve` |
| `hesabi_yonetebilir_mi` | `can_manage_account` |
| `uyelik_denetimi` | `check_membership` |
| `kullanici_denetimi` | `check_user_update` |
| `sirket_ajani_denetimi` | `check_company_agent` |
| `musteri_izin_denetimi` | `check_customer_permissions` |
| `proje_uyesi_mi` | `is_project_member` |
| `satir_gorunur` | `row_visible` |
| `gorev_denetimi` | `check_task` |
| `yorum_yazani` | `set_comment_author` |
| `bana_acik_mi` | `is_shared_with_me` |
| `dis_kisi_mi` | `is_external` |
| `calisma_acilisi` | `check_run_start` |
| `arac_cagrisi_acilisi` | `set_tool_call_defaults` |
| `arac_cagrisi_durumu` | `check_tool_call_status` |
| `ham_icerik_temizle` | `purge_raw_content` |
| `not_denetimi` | `check_note` |
| `not_kaydedildi` | `record_note_version` |
| `olusturan_baglamdan` | `set_creator` |
| `taslak_gorunur` | `draft_visible` |
| `dayanak_surumu` | `basis_version_of` |
| `onay_denetimi` | `check_approval` |
| `dayanak_degisti` | `invalidate_approvals` |
| `dayanak_notu_gorunur` | `basis_note_visible` |
| `dis_etki_kapisi` | `external_effect_gate` |
| `kritik_hata_denetimi` | `check_critical_error` |
| `bildirim_gondereni` | `set_notification_sender` |
| `iz_kaydi_yazimi` | `set_audit_fields` |
| `iz_kaydi_degismez` | `reject_audit_change` |

## Satır kuralları (policy)

| Eski | Yeni |
| --- | --- |
| `gorunur` | `visible` |
| `kurucu_yonetir` | `founder_manages` |
| `okuyucu` | `reader` |
| `sirket_ayrimi` | `tenant_isolation` |
| `dis_kisi_gorur` | `external_reads` |
| `dis_kisi_yazar` | `external_writes` |
| `kendi_paylasimi` | `own_grants` |
| `ajan_yazar` | `agent_inserts` |
| `ajan_gunceller` | `agent_updates` |
| `ajan_acar` | `agent_opens` |
| `ajan_okur` | `agent_reads` |
| `guncelleme` | `updates` |
| `ham_temizligi` | `raw_purge` |
| `tetikleyici_okur` | `trigger_reads` |
| `tetikleyici_yazar` | `trigger_writes` |
| `not_gorunurse` | `note_visible` |
| `dayanak_kapatma` | `basis_invalidation` |
| `kurucu_yazar` | `founder_inserts` |
| `kurucu_gunceller` | `founder_updates` |
| `kurucu_okur` | `founder_reads` |
| `alici_gorur` | `recipient_reads` |
| `kayit_gorunur` | `log_visible` |
| `yazar` | `inserts` |
| `alici_okur` | `recipient_marks_read` |

## Tetikleyiciler

| Eski | Yeni |
| --- | --- |
| `degismez` | `immutable_columns` |
| `guncelleme` | `set_updated_at` |
| `proje_kapsami` | `inherit_project` |
| `proje_gorevden` | `project_from_task` |
| `proje_calismadan` | `project_from_run` |
| `proje_1_calismadan` | `project_1_from_run` |
| `proje_2_gorevden` | `project_2_from_task` |
| `proje_nottan` | `project_from_note` |
| `olusturan` | `set_creator` |
| `onaylari_kapat` | `invalidate_approvals` |
| `bosaltilamaz` | `no_truncate` |

## Kısıtlar

| Eski | Yeni |
| --- | --- |
| `tek_atanan` | `single_assignee` |
| `dis_kaynak_ajana_atanmaz` | `external_not_assigned_to_agent` |
| `tek_yazar` | `single_author` |
| `dayanak_tam` | `basis_complete` |
| `karar_tam` | `decision_complete` |
| `ret_nedeni_gerekli` | `rejection_reason_required` |
| `secenek_onayda` | `option_only_when_approved` |
| `gonderildi_onayliysa` | `sent_only_when_approved` |
| `kayit_tam` | `record_complete` |
| `depolama_yolu_sirketin` | `storage_path_in_company` |

Adı verilmiş dizinler İngilizce tablo ve alan adlarından kurulur (`gorevler_sirket_durum` → `tasks_company_status`). Öteki tetikleyiciler işlevlerinin İngilizce adını alır.

## Kart alanları

| Eski | Yeni |
| --- | --- |
| `kod` | `code` |
| `ad` | `name` |
| `birim` | `unit` |
| `sirketler` | `companies` |
| `surum` | `version` |
| `durum` | `status` |
| `sorumlu` | `owner` |
| `amac` | `purpose` |
| `tetikleyiciler` | `triggers` |
| `tetikleyiciler[].tur` | `type` |
| `tetikleyiciler[].aciklama` | `description` |
| `girdiler` | `inputs` |
| `ciktilar` | `outputs` |
| `skills` | `skills` |
| `araclar` | `tools` |
| `bilgi_kaynaklari` | `knowledge_sources` |
| `yetki` | `authority` |
| `yetki.seviye` | `level` |
| `yetki.hedef` | `target` |
| `yetki.musteri_raporu` | `customer_report` |
| `yetki.dis_paylasim` | `external_sharing` |
| `onay_noktalari` | `approval_points` |
| `eskalasyon` | `escalation` |
| `yasaklar` | `prohibitions` |
| `model` | `model` |
| `model_zor` | `model_hard` |
| `sinirlar` | `limits` |
| `sinirlar.arac_cagrisi` | `tool_calls` |
| `sinirlar.sure_dakika` | `duration_minutes` |
| `olcutler` | `metrics` |
| `proje_baglami` | `project_context` |

## Kart değerleri

- `status`: `taslak` → `draft`
- `owner`: `kurucu` → `founder`
- `triggers[].type`: `talep` → `request`, `zamanlanmis` → `scheduled`, `olay` → `event`, `devir` → `handoff`
- `project_context`: `zorunlu` → `required`, `varsa` → `if_available`, `proje_basina` → `per_project`
- `companies`: `kurucu_alani` → `founder_space`

## Katalog dosyaları

- `agents/araclar.yaml` → `agents/tools.yaml`: üst alan `tools`; her araçta `name`, `kind`, `description`, `approval_rule`
- `agents/birimler.yaml` → `agents/units.yaml`: üst alan `units`; her birimde `code`, `name`, `company`, `pilot_enabled`

## Araçlar

| Eski | Yeni |
| --- | --- |
| `gorev_ara` | `search_tasks` |
| `gorev_oku` | `read_task` |
| `gorev_ac` | `create_task` |
| `gorev_oner` | `suggest_task` |
| `gorev_guncelle` | `update_task` |
| `ajan_listele` | `list_agents` |
| `kullanici_listele` | `list_users` |
| `bildirim_gonder` | `send_notification` |
| `onaya_gonder` | `submit_for_approval` |
| `onay_kuyrugu_oku` | `read_approval_queue` |
| `onay_ozeti_yaz` | `write_approval_summary` |
| `not_ara` | `search_notes` |
| `not_oku` | `read_note` |
| `not_yaz` | `write_note` |
| `not_guncelle` | `update_note` |
| `not_bagla` | `link_notes` |
| `drive_listele` | `list_drive` |
| `drive_oku` | `read_drive_file` |
| `belge_ice_aktar` | `import_document` |
| `musteri_oku` | `read_customer` |
| `musteri_guncelle` | `update_customer` |
| `proje_oku` | `read_project` |
| `maliyet_oku` | `read_costs` |
| `github_oku` | `read_github` |
| `pdf_uret` | `generate_pdf` |
| `eposta_taslak` | `draft_email` |
| `eposta_gonder` | `send_email` |
| `gmail_ara` | `search_gmail` |
| `gmail_oku` | `read_gmail` |
| `takvim_oku` | `read_calendar` |
| `toplanti_dokumu_oku` | `read_meeting_transcript` |
| `web_getir` | `fetch_web` |
| `istasyon_oku` | `read_stations` |
| `istasyon_aday_yaz` | `write_station_candidates` |
| `figma_oku` | `read_figma` |
| `figma_yaz` | `write_figma` |
| `gorsel_uret` | `generate_image` |

## Skill'ler

| Eski | Yeni |
| --- | --- |
| `eposta-onceliklendirme` | `email-prioritization` |
| `toplanti-brifi` | `meeting-brief` |
| `gorev-takibi` | `task-tracking` |
| `istasyon-verisi` | `station-data` |
| `kaynakli-yanit` | `sourced-answer` |
| `not-yazimi` | `note-writing` |
| `karar-notu` | `decision-note` |
| `onay-ozeti` | `approval-summary` |
| `proje-raporu` | `project-report` |
| `sosyal-gorsel` | `social-visual` |
| `sosyal-icerik` | `social-content` |
| `marka-dili` | `brand-voice` |
| `surec-analizi` | `process-analysis` |
| `teklif` | `proposal` |
| `toplanti-tutanagi` | `meeting-minutes` |
| `ui-ux-tasarim` | `ui-ux-design` |
| `tasarim-sistemi` | `design-system` |
| `yonlendirme` | `routing` |

Skill klasörü: `skills/<ad>/SKILL.md` ve yanında `templates/`, `examples/`, `tests/` (eskiden `sablonlar/`, `ornekler/`, `testler/`).

## Arayüz renk değişkenleri

| Eski | Yeni |
| --- | --- |
| `--zemin` | `--canvas` |
| `--yuzey` | `--surface` |
| `--metin` | `--ink` |
| `--ikincil-metin` | `--ink-secondary` |
| `--cizgi` | `--line` |
| `--kenarlik` | `--field-border` |
| `--vurgu` | `--brand` |
| `--vurgu-etkin` | `--brand-active` |
| `--vurgu-uzeri` | `--on-brand` |
| `--hata` | `--error` |
| `--onay-bekliyor` | `--awaiting-approval` |

## Panel adresleri

`/ajanlar` → `/agents`, `/gorevler` → `/tasks`, `/notlar` → `/notes`, `/onaylar` → `/approvals`. Menüdeki etiketler Türkçe kalır.

## 0.3 ile eklenen adlar (karşılığı olan eski Türkçe ad yok)

- Roller: `office_identity` (giriş, oturum ve davet işlevlerinin sahibi), `office_api_private` (yalnızca API'nin üyesi olduğu grup)
- Tablolar: `sessions`, `invitations`, `login_events`; `user_emails.google_sub`, `memberships.invitation_id`
- İşlevler: `complete_login`, `open_session`, `verify_session`, `close_session`, `close_all_sessions`, `set_last_company`, `record_login_event`, `is_active_founder`, `company_kind`

## 7 Ekim ile eklenen adlar (karşılığı olan eski Türkçe ad yok)

- İki iş türü (7 Ekim, karar 9 ve 10): "Talep" (ajanların yürüttüğü iş) → `request`; "Görev" (insanların birbirine verdiği iş) → `task`. Menüde "Talepler" ve "Görevler"; adresler `/requests` ve `/tasks`.
- "Koordinasyon merkezi" → kodda `coordinator` (kart: `KOR-1`); "birimin onaylayıcısı" → `approver`; "talep sahibi" → `requester`; "yönlendirme" → `routing`; "talep sahibinin onayı" → `requester approval`.
- Tablolar ve alanlar: `tasks.kind` (`request`, `task`), `tasks.closed_by_user_id`, `tasks.close_reason`; `approvers` (birimin ya da ajanın onaylayıcısı); `task_routings` (yönlendirme adımları; `status`: `planned`, `active`, `done`, `replaced`, `cancelled`, `returned`; `returned`: birimde işi alabilecek açık ajan yok, talep talep sahibine geri çevrildi, 8 Ekim karar 2; panelde neden kodu `returned_no_agent`); `approvals.approver_user_id`, `approvals.routing_id`; `requester_approvals` (`status`: `pending`, `approved`, `changes_requested`)
- İşlevler: `coordinator_agent_code`, `route_request` (koordinatör), `correct_routing` (kişi), `close_request`, `approver_for`, `member_can_approve`, `approval_released`; akışın iç işlevleri `flow_` ile başlar
- İz kaydı olayları: `request_created`, `request_routed`, `request_rerouted`, `request_returned`, `request_cancelled`, `request_stopped`; `approval_opened`, `approval_approved`, `approval_changes_requested`, `approval_rejected`, `approval_closed`, `approval_summary_changed`; `requester_approval_*`; `approver_appointed`, `approver_changed`, `approver_removed`

## 8 Ekim incelemesinin düzeltmeleriyle eklenen adlar (karşılığı olan eski Türkçe ad yok)

- Alanlar: `runs.routing_id` (çalışmanın açıldığı yönlendirme adımı; veritabanı yazar, sonradan değişmez)
- İşlevler: `lock_request` (bir kişinin işleminde talebin kilidini önce alır; yalnızca API çağırır)
- İz kaydı olayları: `run_not_started` (düzeltme istendiğinde adımın ajanı durdurulmuştu, çalışma başlatılmadı; API yazar), `run_refused` (çalıştırıcı işi çalışma açmadan geri çevirdi). Talep sayfası "çalışma başlamadı" bilgisini bu iki olaydan okur.
- Talep nedeni kodu: `not_started` (çalışma başlamadı; talep insana düşer, ajan yeniden açılsa da iş kendiliğinden başlamaz)
- API hata kodu: `request_changed` (aynı talepte başka bir işlem bunu geçersiz kıldı; sayfa yenilenir)
- API yanıt alanları: `acceptance.returnsToAgent` ("istediğim bu değil" işi ajana geri döndürür mü), ofis yanıtında ajan başına `ready` (kartın çalışacak sürümü var mı)
- Çalıştırıcının iz kaydı olayı: `run_skipped` (iş geldi, yapılacak bir şey yoktu: çalışma zaten sürüyor ya da sonuç bekliyor, ya da talep kapanmış; `run_refused` değildir, talep sayfası bunu "çalışma başlamadı" diye okumaz)
- Çalıştırıcının günlük olayları: `run_skipped`, `run_superseded` (yeni yönlendirmenin işi, eski adımın açık kalan çalışmasını kapattı)
- Çalışma hata kodları: `routing_changed` (çalışmanın adımı yeni bir yönlendirmeyle değişti; koordinatörde: çalışma sürerken talebi bir kişi yönlendirdi), `request_changed` (sonuç kaydedilemedi: talep kapandı, yeniden yönlendirildi ya da başka bir çalışmanın sonucu bekliyor)
- `runs.output` alanı: `model_sends` (sağlayıcıya gönderilen istek sayısı; yanıt alınamayan çağrılar ve istemcinin yeniden denemeleri dahil, `model_calls` yalnızca yanıtları sayar)
- Kart sürümü içeriği (`card_versions.content`): `tools` (kartın kendi araçlarının katalog satırları: tür ve onay kuralı), `model` (kartın modelinin `agents/models.yaml` satırı). Araç kataloğu ya da model tablosu değişince ilgili kartlara yeni sürüm yazılır.
- Ortam: worker `ANTHROPIC_CUSTOM_HEADERS` doluysa açılmaz (SDK bu başlıkları her model isteğine ekler ve kapatılamaz)

## Notlar

- Hata metinleri (veritabanı tetikleyicilerinin `raise exception` metinleri, geliştiriciye dönük iletiler) İngilizcedir. Kullanıcıya gösterilecek Türkçe metni API üretir; API hata metnine göre değil SQLSTATE koduna göre dallanır.
- PostgreSQL aynı olaydaki tetikleyicileri ada göre sırayla çalıştırır. Adlar değiştiği için bazı tablolarda sıra değişti; kabul ya da ret sonucu aynı, yalnızca bir istek birden çok kuralı ihlal ederse dönen hata kodu farklı olabilir.

