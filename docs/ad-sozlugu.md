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
- Talep nedeni kodu: `run_interrupted` (çalışma yarıda kesildi: talep çalışma sürerken değişti, çalışma `routing_changed` ya da `request_changed` ile durdu; `agent_stopped` yalnızca durdurma düğmesidir)
- Kuyruk: `DEAD_LETTER_RETRY` (kayıp çalışmaları kapatan kuyruğun yeniden deneme ayarı); günlük olayı `dead_letter_failed`; kuyruğa giden hata kodu `dead_letter_error`
- API hata kodu: `request_changed` (aynı talepte başka bir işlem bunu geçersiz kıldı; sayfa yenilenir)
- API yanıt alanları: `acceptance.returnsToAgent` ("istediğim bu değil" işi ajana geri döndürür mü), ofis yanıtında ajan başına `ready` (kartın çalışacak sürümü var mı)
- Çalıştırıcının iz kaydı olayı: `run_skipped` (iş geldi, yapılacak bir şey yoktu: çalışma zaten sürüyor ya da sonuç bekliyor, ya da talep kapanmış; `run_refused` değildir, talep sayfası bunu "çalışma başlamadı" diye okumaz)
- Çalıştırıcının günlük olayları: `run_skipped`, `run_superseded` (yeni yönlendirmenin işi, eski adımın açık kalan çalışmasını kapattı)
- Worker'ın günlük olayı: `run_watched` (kuyruğun ölü iş kutusuna düşen işin açık kalan çalışması henüz kendi süre sınırının içinde; kapatılmadı, sınır dolunca yeniden bakılmak üzere aynı kutuya hatırlatma işi kondu)
- Çalışma hata kodları: `routing_changed` (çalışmanın adımı yeni bir yönlendirmeyle değişti; koordinatörde: çalışma sürerken talebi bir kişi yönlendirdi), `request_changed` (sonuç kaydedilemedi: talep kapandı, yeniden yönlendirildi ya da başka bir çalışmanın sonucu bekliyor)
- `runs.output` alanı: `model_sends` (sağlayıcıya gönderilen istek sayısı; yanıt alınamayan çağrılar ve istemcinin yeniden denemeleri dahil, `model_calls` yalnızca yanıtları sayar)
- Kart sürümü içeriği (`card_versions.content`): `tools` (kartın kendi araçlarının katalog satırları: tür ve onay kuralı), `model` (kartın modelinin `agents/models.yaml` satırı). Araç kataloğu ya da model tablosu değişince ilgili kartlara yeni sürüm yazılır.
- Worker'ın açılış günlüğü: `card_version_invalid` (ajanın geçerli kart sürümü bu sürümün beklediği alanları taşımıyor, örneğin 8 Ekim'den önce yazılmış ve `tools` ile `model` yok; çalıştırıcı o ajanın her işini `card_invalid` diye geri çevirir, talep "çalışma başlamadı" diye insana düşer. Çözüm: kart senkronizasyonunu yeniden çalıştırmak, yerelde `pnpm db:sync-definitions`)
- Ortam: worker `ANTHROPIC_CUSTOM_HEADERS` doluysa açılmaz (SDK bu başlıkları her model isteğine ekler ve kapatılamaz)

## 0.4a adım 1 ile eklenen adlar: Bugün listesi ve bildirimler (karşılığı olan eski Türkçe ad yok)

- "Bugün" → `today`; "Sizden beklenenler" → `expected`; "Bildirimler" → `notifications`; "okundu" → `read`
- Bildirim şablonları (`notifications.template`): `request_returned` (talep geri çevrildi), `request_rejected` (sonuç reddedildi, talep kapandı), `request_stopped` (iş durduruldu). Üçünü yalnızca talep akışı yazar; `passkeys_reset` gibi ayrılmıştır. Satırda `record_type` `task`, `record_id` talebin kimliğidir; metin yoktur.
- İşlev: `flow_notify_requester` (talep sahibine kapanış bildirimini yazar; akışın iç işlevi, uygulama çağıramaz)
- Politikalar: `flow_notifies` (akışın bildirim yazması), `reserved_templates` (dört şablon ayrılmış), `recipient_marks_read` (okundu işaretini yalnızca API rolü yazar)
- Dizin: `tasks_requests_open` (açık talepler, son hareket sırasıyla)
- Uç noktalar: `GET /api/today`, `GET /api/today/counts`, `POST /api/notifications/read`
- API yanıt alanları: `expected`, `expectedTruncated`, `notifications`, `notificationsTruncated`; bildirimde `template`, `read`, `request`, `unit`; sayılarda `today` (Bugün satırı), `approvals` (Onaylar satırı)
- Sabitler: `TODAY_REQUEST_LIMIT` (200), `NOTIFICATION_LIST_LIMIT` (100), `NOTIFICATION_KEEP_DAYS` (30)
- Kodda beklenen iş türleri: `approval` (karar verilecek sonuç), `acceptance` (talep sahibinin onaylayacağı sonuç), `fallen` (insana düşen talep)
- Panel: sorgu anahtarları `today` (Bugün yanıtı) ve `sidebar-counts` (kenar çubuğundaki iki sayı); klasörler `lib/today` ve `components/today`; `SidebarNavItem` özelliği `countNoun` (sayının neyi saydığı: "bekleyen iş"); `stableOrder` (yenilemede satırların yerinde kalması)
- Ekran okuyucu bölge adları: Bugün'deki liste "Bildirimler"; ekranın köşesinde beliren kısa iletilerin kutusu "Anlık bildirimler" (önceki adı "Bildirimler" idi)

## 0.4c adım 1 ile eklenen adlar: Projeler (karşılığı olan eski Türkçe ad yok)

- "Proje" → `project`; "müşteri" → `customer`; "proje üyesi" → `project member`; "yapay zekâ izni" → `ai_allowed` (API'de `aiAllowed`); "kodla otomatik işleme izni" → `automated_processing_allowed` (API'de `automatedProcessingAllowed`); "ajanlar çalışabilir" → `agentsMayWork` (projenin izni ile müşterisinin izni birlikte; kural 12)
- `projects`: `description` (açıklama), `color` (renk), `icon` (simge), `target_date` (hedef tarih), `created_by_user_id` (açan kişi), `closed` (kapalı; `status` alanından türetilir).
- `projects.status` değerleri: `backlog` (beklemede), `planned` (planlandı), `in_progress` (sürüyor), `completed` (tamamlandı), `cancelled` (iptal). Eski `open` ve `closed` değerleri kalktı: eski kayıtlarda `open` → `in_progress`, `closed` → `completed`.
- Renkler: `gray`, `red`, `orange`, `green`, `teal`, `blue`, `purple`, `pink`. Simgeler: `folder`, `briefcase`, `code`, `globe`, `megaphone`, `wrench`, `chart`, `document`, `pin`, `bolt`, `people`, `box`.
- İşlevler: `set_project_ai_permission` (projenin yapay zekâ iznini kurucu değiştirir; üçüncü değişkeni kurucunun onayladığı müşteridir), `set_customer_permissions` (müşterinin sözleşme izinlerini kurucu değiştirir), `check_project`, `creator_becomes_member` (projeyi açan üyesi olur), `check_project_member` (yalnızca hesabı etkin kurucu ve çalışan üye olur), `external_leaves_projects` (dış kişi yapılan üyenin proje üyelikleri kalkar), `guard_project_ai_permission`, `keep_customer_while_ai_open` (yapay zekâ izni açıkken projenin müşterisi değişmez), `audit_project_change`, `audit_project_member`, `audit_customer_change`. `check_customer_permissions` aynı adla yenilendi (passkey ister; Kurucu alanında müşteri eklenmez).
- Satır kuralları: `insider_opens`, `member_edits` (`projects`); `members_add`, `members_remove`, `project_bookkeeping` (`project_members`); `permission_reads`, `permission_changes` (`projects`, `customers`); `project_records`, `reserved_permission_events` (`audit_log`). `projects` ve `project_members` üzerindeki `founder_manages` kalktı.
- Tetikleyiciler: `check_project`, `creator_becomes_member`, `guard_ai_permission`, `keep_customer_while_ai_open`, `audit_project_change`, `immutable_columns` (`projects`); `check_project_member`, `audit_project_member`, `immutable_columns` (`project_members`); `audit_customer_change` (`customers`); `external_leaves_projects` (`memberships`)
- Kısıtlar: `projects_name_shape`, `projects_description_shape`, `projects_color_check`, `projects_icon_check`, `customers_name_shape`, `customers_company_name` (müşteri adı şirket içinde tekildir; karşılaştırma `lower(name)` ile yapılır).
- Yeniden doğrulama amaçları: `project_ai_permission` (konusu proje; ayrıntısı `action: open` ve `customerId`), `customer_ai_permission` (konusu müşteri; ayrıntısı `create` ya da `update`).
- İz kaydı olayları: `project_created`, `project_name_changed`, `project_description_changed`, `project_customer_changed`, `project_status_<durum>`, `project_color_changed`, `project_icon_changed`, `project_target_date_changed`, `project_changed`, `project_ai_permission_opened`, `project_ai_permission_closed`, `project_member_added`, `project_member_removed`, `customer_created`, `customer_name_changed`, `customer_changed`, `customer_ai_permission_opened`, `customer_ai_permission_closed`, `customer_automated_processing_opened`, `customer_automated_processing_closed`. İzin olaylarını yalnızca izin değişikliğinin kendisi yazabilir.
- Uç noktalar: `GET /api/projects`, `POST /api/projects`, `GET /api/projects/member-candidates`, `GET /api/projects/:projectId`, `PATCH /api/projects/:projectId`, `PUT` ve `DELETE /api/projects/:projectId/members/:userId`, `PUT /api/projects/:projectId/ai-permission`, `GET /api/customers`, `PATCH /api/customers/:customerId/permissions`
- API hata kodları: `customer_exists`, `customer_not_found`, `member_not_allowed`, `own_project_membership`, `project_customer_locked` (yapay zekâ izni açıkken müşteri değiştirilemez), `project_changed` (projenin müşterisi kurucunun passkey ile onayladığından farklı; sayfa yeniden okunur).
- Veritabanı hata kodu: `55000` (`set_project_ai_permission`: projenin müşterisi onaylanandan farklı; API `project_changed` der)
- API yanıt alanları: projede `closed`, `targetDate`, `aiAllowed`, `agentsMayWork`, `customer`, `memberCount`, `createdBy`, `members`, `actions` (`edit`, `manageMembers`, `setAiPermission`, `setCustomerPermissions`; `manageMembers` karar 44 ile kalktı, yerine `addMembers` geldi, aşağıda); müşteri seçeneğinde `aiAllowed` ve `automatedProcessingAllowed` (çalışana `null` gider)
- Sabitler: `PROJECT_NAME_MAX` (120), `CUSTOMER_NAME_MAX` (120), `PROJECT_DESCRIPTION_MAX` (5000), `PROJECT_MEMBER_MAX` (50), `PROJECT_LIST_LIMIT` (500); `DEFAULT_PROJECT_STATUS` (`planned`), `DEFAULT_PROJECT_COLOR` (`gray`), `DEFAULT_PROJECT_ICON` (`folder`)
- Arayüz renk değişkenleri: `--project-gray`, `--project-red`, `--project-orange`, `--project-green`, `--project-teal`, `--project-blue`, `--project-purple`, `--project-pink` (proje simgesinin zemini; üstündeki simge `--surface` rengindedir). Sınıfları `bg-project-<renk>`.
- Panel adresleri: `/c/$company/projects` (liste), `/c/$company/projects/$projectId` (proje sayfası). Menüdeki etiket "Projeler".
- Panel: sorgu anahtarları `projects` (liste), `project` (proje sayfası), `customers` (seçilecek müşteriler), `project-member-candidates` (üye yapılabilecek kişiler); klasörler `lib/projects` ve `components/projects`; bileşenler `ProjectTile` (proje simgesi), `ProjectFields` (iki pencerenin ortak alanları), `NewProjectDialog`, `EditProjectDialog`, `ProjectMembers`, `ProjectProperties`.
- Durum dili: `PROJECT_STATUS` (beş proje durumunun sözü, simgesi ve rengi; `lib/status.ts`), durum türü `project`.
- Menü: `MenuSpace` (`any`: her yerde, `company`: yalnızca şirkette; Kurucu alanında sunulmaz), menü satırlarında `space` alanı.
- Kodda izin değişikliği türleri: `project_on`, `project_off`, `customer_ai_on`, `customer_ai_off`, `automated_on`, `automated_off`; müşteri seçiminde `new` ("Yeni müşteri ekle") ve boş değer ("Müşteri yok").

Projede sahip, yönetici ve üye ayrımıyla (8 Ekim karar 44) eklenen adlar:

- "Projenin sahibi" → `owner`; "projenin yöneticisi" → `manager`; "üye" (sahip ya da yönetici olmayan) → `member`; "sahipliği devretmek" → bir üyeye `owner` rolünü vermek.
- `project_members.role`: üyenin projedeki rolü; değerleri `owner` (sahip; projeyi açan kişi, projede en çok bir tane), `manager` (yönetici), `member` (üye; yeni eklenen herkes böyle başlar). Kısıtı `project_members_role_check`.
- `project_members_one_owner`: bir projede en çok bir sahip olmasını sağlayan tekil dizin.
- `office.project_role(proje)`: bağlamdaki kişinin o projedeki rolünü verir; üye değilse boş döner.
- `office.set_project_member_role(proje, kişi, rol)`: bir üyeye rol verir; yalnızca projenin sahibi ve kurucu için çalışır, yalnızca API rolü çağırabilir. `manager` yönetici atar, `member` yöneticilikten alır, `owner` sahipliği devreder (o ana kadarki sahip üye olur). Rol sütununu başka hiçbir yol yazamaz.
- Veritabanı hata kodları (`set_project_member_role`): `42501` (çağıran sahip ya da kurucu değil), `P0002` (böyle bir üye yok ya da proje görünmüyor), `55000` (sahibin kendi rolü doğrudan değiştirilemez), `22023` (eksik değişken ya da bilinmeyen rol), `23514` (devre dışı hesaba rol verilemez).
- Tetikleyici: `check_project_member_role` (`project_members`; bir üye yönetici ya da sahip yapılırken hesabın etkin olduğunu denetler). `audit_project_member` artık rol değişikliğinde de çalışır. `creator_becomes_member` projeyi açanı sahip olarak yazar.
- Satır kuralları `members_add` ve `members_remove` yeniden yazıldı: üyeyi sahip, yöneticiler ve kurucu ekler; yöneticiyi ve üyeyi sahip ve kurucu, yalnızca üyeyi yönetici çıkarır; sahip çıkarılamaz.
- İz kaydı olayları: `project_member_role_owner` (kişi sahip oldu), `project_member_role_manager` (kişi yönetici yapıldı), `project_member_role_member` (kişi yöneticilikten alındı ya da sahipliği devretti). Kaydın konusu kişidir, proje `project_id` alanındadır.
- Uç nokta: `PUT /api/projects/:projectId/members/:userId/role` (sahip ya da kurucu bir üyeye rol verir; gövdesi `role`).
- API hata kodları: `project_members_not_allowed` (üye eklemeyi ve çıkarmayı yalnızca sahip, yöneticiler ve kurucu yapar), `project_manager_protected` (yöneticiyi yalnızca sahip ya da kurucu çıkarır), `project_owner_fixed` (sahip çıkarılamaz ve rolü doğrudan değiştirilemez), `project_roles_not_allowed` (rolleri yalnızca sahip ya da kurucu verir), `project_members_changed` (üyeler az önce değişti; sayfa yeniden okunur). Panel, bir üye işlemi bu beş koddan biriyle, `member_not_allowed` ya da `not_found` ile reddedilince projeyi yeniden okur: sayfa, API'nin az önce reddettiği düğmeleri göstermeyi sürdürmez.
- API yanıt alanları: üyede `projectRole` (projedeki rolü), `removable` (okuyan kişi bu üyeyi çıkarabilir), `roleChanges` (okuyan kişinin bu üyeye verebileceği roller); `actions` içinde `addMembers` (okuyan kişi üye ekleyebilir). `actions.manageMembers` kalktı.
- Kodda: `projectMemberRoleSchema` ve `ProjectMemberRole` (üç rol), `ProjectActor` (üyeler üzerinde işlem yapan kişi), `mayAddProjectMembers`, `memberRemoval` (yanıtları `ok`, `self`, `not_allowed`, `owner`, `manager_protected`), `memberRoleChanges`, `setProjectMemberRoleSchema` (`packages/shared`); `setProjectMemberRole`, satır alanları `reader_project_role` ve `project_role` (`packages/db`).
- Panelde (`apps/web/src/lib/projects/labels.ts`): rol adları "Sahip", "Yönetici", "Üye" → `PROJECT_ROLE`; üye satırındaki "Rolü değiştir" menüsünün işlemleri → `ROLE_ACT`: "Yönetici yap" (`manager` rolünü verir), "Yöneticilikten al" (`member` rolünü verir), "Sahipliği devret" (`owner` rolünü verir; önce onay sorar). İsteği `setProjectMemberRole` gönderir (`apps/web/src/lib/projects/query.ts`).

## 0.4a adım 2 ile eklenen adlar: ofiste canlı durumlar ve "Her yerde durdur" (karşılığı olan eski Türkçe ad yok)

- Masa durumları (kodda `OfficeAgentState`): `closed` (Kapalı), `idle` (Boşta), `running` (Çalışıyor), `awaiting_approval` (Onay bekliyor), `error` (Hata), `stopped` (Durduruldu). Ofiste "Etkin" sözü kalktı; `company_agents.status` değerleri değişmedi (`enabled` açık ajandır).
- Açık bir talebin masadaki türü (`AgentWorkKind`): `running` (sıra ajanda), `awaiting_approval` (sonucu birim onayında), `failed` (çalışma yüzünden insana düştü). "Hata" sayılan nedenler `AGENT_FAILURE_CAUSES`: `run_failed`, `limit_reached`, `no_submission`.
- İşlevler: `agentWorkOf` (talebin hangi masada, hangi türde durduğu), `officeAgentState` (masanın durumu), `workOfRequest`, `officeWork` ve `officeLive` (API'de sayım ve sınırda kesme), `listOpenRequests` (okuyanın görebildiği açık talepler), `stopAgentIfOpen` (ajanı yalnızca açıksa durdurur), `readAgentSwitch` (ajanın adı, kartının hazır olup olmadığı, şirketteki düğmesi).
- API yanıt alanları (`GET /api/office`): `work` (ajan başına `agentCode`, `running`, `awaitingApproval`, `failed`; her biri `count` ve tek talep sayılıyorsa `requestId`), `workTruncated` (sayım sınırı aşıldı).
- API istek alanı (`PUT /api/agents/:agentCode/switch`): `onlyIfOpen` ("Her yerde durdur": yalnızca açık ajan durur; kapalı, durdurulmuş ya da hiç açılmamış ajana dokunulmaz, iz kaydı yazılmaz).
- API yanıt alanı (`onlyIfOpen` ile gönderilen durdurmanın yanıtı, `agentStopIfOpenResponseSchema`): `changed` (ajanı bu istek durdurduysa `true`; zaten durdurulmuş, kapalı ya da hiç açılmamışsa `false`). Koşulsuz düğmenin yanıtı değişmedi.
- Sabit: `OFFICE_REQUEST_LIMIT` (200).
- Panel: `AgentWork`, `NO_WORK`, `WORK_ROWS`, `isOpen` (`lib/office/model.ts`); `officeKey`, `fetchOffice`, `agentSwitchQueryOptions` (sorgu anahtarı `agent-switch`; yanıtı şirketteki düğme ya da ofiste böyle bir ajan yoksa `absent`), `stopAgentIfOpen` (koşullu durdurma isteği) (`lib/office/query.ts`); `officeDialogOpen`, `useOfficeDialog` (`lib/office/hold.ts`); bileşenler `AgentWorkList` ("Açık talepleri") ve `StopEverywhere` ("Her yerde durdur"). "Her yerde durdur" penceresinde bir yerin sonucu: `stopped` (durduruldu), `already_stopped` (zaten durdurulmuş), `not_open` (açık değildi), `failed` (durdurulamadı).
- Stil sınıfları: `office-screen-dot` (ekranda nokta: onay bekliyor), `office-screen-cross` (ekranda çarpı: hata).

## 0.4a adım 3 ile eklenen adlar: son tarih ve yorum (karşılığı olan eski Türkçe ad yok)

- "Son tarih" → API ve panelde `dueDate` (gün, `YYYY-MM-DD`); veritabanında var olan `tasks.due_at` (o günün İstanbul saatiyle son saniyesi); ifade satırında `due_date`. "Son tarihi geçti" → `overdue` (yalnızca açık talepte doğru). "Gecikti" (`delayed`) başka bir şeydir: çalışmanın beklenenden uzun sürmesi.
- "Yorum" → `comment`; talep yanıtında `comments` (`items`, `truncated`, `mayWrite`); yorumda `id`, `author`, `body`, `createdAt`
- İşlev: `may_comment_on_request` (bağlamdaki kişi bu talebe yorum yazabilir mi: talep sahibi, kurucu ya da talebin onaylayıcısı)
- Tetikleyici: `check_task_comment` (talep yorumunu yalnızca API rolüyle, bu üç kişiden biri yazar; ajan çalışması ve worker rolü yazamaz)
- Politika: `request_comments_for_people` (talep yorumunu ajan çalışması ve worker rolü okuyamaz; dış kişi okuyamaz)
- İz kaydı olayı (var olan): `task_comment_added`, talep yorumunda da yazılır; kayıt taleptir, metin yazılmaz
- Uç nokta: `POST /api/requests/:requestId/comments`; `POST /api/requests` gövdesinde isteğe bağlı `dueDate`
- API hata kodları: `comment_not_allowed` (yorumu yalnızca talep sahibi, onaylayıcı ve kurucu yazar), `due_date_past` (son tarih bugünden önce)
- Şemalar: `requestDueDateSchema`, `requestCommentBodySchema`, `requestCommentSchema`, `createRequestCommentSchema`
- Sabitler: `REQUEST_COMMENT_MAX` (10.000), `REQUEST_COMMENT_LIMIT` (200)
- Paylaşılan işlev: `officeDay` (bir anın ofis saat dilimindeki günü); veritabanı ifadeleri `dueDaySql`, `dueAtSql`
- Veritabanı ifadeleri (yorum): `listRequestComments`, `insertRequestComment`, `ownRequestCommentExists`, `mayCommentOnRequest`; API'de `toComments`
- Çalıştırıcı: `run_facts` bloğunda `dueDate` (talebin son tarihi, veri olarak)
- Panel: `components/requests/request-comments.tsx` (`RequestComments`: talep sayfasında "Yorumlar" bölümü); taslak anahtarı `comment.<talep kimliği>`; talep taslağında `dueDate`; `dueText` (son tarihin cümlesi); `addRequestComment` (yorum gönderme isteği); test yardımcıları `comment`, `withComments`

## 0.4c adım 2 ile eklenen adlar: proje içinde talep (karşılığı olan eski Türkçe ad yok)

Proje içinde talep ve kural 12 (8 Ekim karar 11, 17, 46, 47, 48):

- İşlevler: `office.project_allows_ai(proje)` (o projede ajanlar şu an çalışabilir mi: projenin ve varsa müşterisinin yapay zekâ izni açık mı; proje yoksa her zaman evet), `office.request_run_gate(talep)` (çalıştırıcının her çalışmanın başında sorduğu soru; yanıtı `run_as`, `project_id`, `ai_allowed`), `office.stop_runs_without_ai_permission` (izin kapanınca o projedeki açık çalışmaları kapatan tetikleyici işlevi), `office.hold_result_without_ai_permission` (izin kapalıyken projeye ait sonucun onaylanmasını reddeden tetikleyici işlevi), `office.add_usage_to_stopped_run` (izin kapanınca durdurulmuş çalışmaya, o sırada yanıtlanan model çağrısının token ve maliyetini ekler; başka hiçbir şeyi değiştirmez).
- `office.check_task` kapalı projede (Tamamlandı ya da İptal) yeni talebi de reddeder (`23514`); açık talepler sürer.
- Kapı yanıtının alanları: `run_as` (çalışmanın adına koşacağı kişi), `project_id` (talebin projesi), `ai_allowed` (o projede ajanlar çalışabilir mi).
- Tetikleyiciler: `stop_runs_without_ai_permission` (`projects` ve `customers`; izin kapandığı işlemin içinde çalışmaları durdurur), `ai_permission_holds_result` (`approvals`; izin kapalıyken projeye ait sonucun onayı `55000` ile reddedilir, ret serbesttir; düzeltme isteğini ve yönlendirme düzeltmesini API reddeder).
- Satır kuralları (yalnızca tetikleyicilerin sahibi `office_trigger` için): `permission_stops` (izin kapanınca çalışmayı kapatma), `permission_stop_records` (bu kapatmanın iz kaydı), `permission_stop_usage` (durdurulmuş çalışmaya kullanım ekleme).
- Çalışma hata kodu: `ai_permission_closed` (çalışmayı izin kapanması durdurdu; durum `stopped`).
- Çalıştırıcı sonucu: `ai_not_allowed` (izin kapalı; çalışma açılmaz, model çağrılmaz, iz kaydına `run_refused` düşer). Günlük olayı: `run_usage_unrecorded` (yanıtlanan çağrının sayıları hiçbir çalışma kaydına yazılamadı; yalnızca sayılar, metin yok).
- Talebin insana düşme nedenleri: `ai_permission_closed` ("yapay zekâ izni kapalı"; izin açılana kadar hiçbir şey çalışmaz), `ai_permission_interrupted` ("izin kapanınca durdu"; izin yeniden açık ama iş yeniden başlamadı).
- API hata kodları: `project_not_available` (proje yok ya da kişiye açık değil), `project_closed` (kapalı projede talep açılamaz), `project_ai_not_allowed` (projenin ya da müşterisinin izni kapalı; cümle hangisi olduğunu söyler), `ai_permission_closed` (izin kapalıyken sonuç onaylanamaz, düzeltme istenemez, yönlendirme düzeltilemez), `permission_busy` (izin değişikliği başka bir işlemle çakıştı; hiçbir şey değişmedi).
- API alanları: `POST /api/requests` gövdesinde isteğe bağlı `projectId`; talep yanıtlarında `project` (`id`, `name`) ve `agentsMayWork` (o talebin projesinde ajanlar şu an çalışabilir mi; onay kartında ve talep sahibi onayı kartında da var). Sorgu: `GET /api/requests?project=<kimlik>` (tek projenin talepleri; kişinin okuyamadığı projede boş liste).
- Veritabanı ifade satırlarında: `project_name`, `agents_may_work`. API'de `projectDoor` (talep açılmadan önce projeye bakar, neden açılamadığını söyler).
- Kart alanı `project_context`, çalıştırıcıda: `if_available` kuruldu (talebin projesi varsa o bağlamda, yoksa projesiz koşar; KOR-1 ve SOS-2); alanı olmayan kart yalnızca projesiz talepte koşar; `required` ve `per_project` henüz kurulmadı, böyle kart çalışmaz (`card_not_runnable`).
- Çalıştırıcı: `run_facts` bloğunda `project` (talebin projesinin adı, veri olarak); iz kayıtlarında `project_id` çalışmanın bağlamındaki projedir.

Çalışmanın kimin adına koştuğu (8 Ekim karar 45):

- İşlevler: `office.person_reads_request(şirket, proje, kişi)` (kişi o talebi hâlâ okuyabilir mi), `office.acting_founder(şirket)` (yerine geçecek kurucu: üyeliği en eski olan etkin kurucu), `office.request_run_identity(talep)` (çalışmanın adına koşacağı kişi: talebi okuyabildiği sürece talep sahibi, okuyamıyorsa kurucu), `office.hand_run_over` (kişisi artık bu olmayan açık çalışmayı kapatır; çalıştırıcı aynı işi yeniden kuyruğa koyar).
- `office.check_run_request`: talep üzerindeki çalışma yalnızca veritabanının söylediği kişi adına açılır; başka ad `42501` ile reddedilir.
- Sütun: `requester_approvals.decided_by_user_id` (talep sahibi onayını kimin verdiği: talep sahibi ya da onun yerine kurucu). Satır kuralı: `founder_decides_for_requester` (talep sahibi talebi okuyamıyorken onayını kurucu verir).
- Çalışma hata kodu: `identity_changed` (çalışma sürerken kişisi değişti; çalışma durduruldu ve iş yeniden çağrıldı).
- API alanları: `requesterReads` (talep sahibi talebi hâlâ okuyabiliyor mu), `acceptance.inPlaceOfRequester` (okuyan kişi onayı talep sahibinin yerine veriyor), onay masasında `forRequester` (kimin yerine), yolculukta `decidedBy` (talep sahibi dışında biri yanıtladıysa kim). Veritabanı ifade satırlarında: `requester_reads`, `reader_stands_in`, `decided_by_user_id`.
- İş kuyruğundaki `userId` talebi isteyen kişidir (talep sahibi); çalışmanın kimin adına koşacağını söylemez.

Bekleyen işlerin kendiliğinden başlaması (8 Ekim karar 49):

- İşlevler: `office.flow_waiting_work` (bir ajanı ya da izni bekleyen işleri seçen kural; dördüncü değişkeni `p_as_if_open`, sayım için o düğmeyi açık sayar: `agent`, `project`, `customer`), `office.restart_waiting_work(ajan, proje, müşteri)` (tam biri verilir; seçtiği her talebe `run_restarted` izini yazar ve kimlikleri döner; yalnızca kurucu, yalnızca API rolü), `office.count_waiting_work(ajan, proje, müşteri)` (o düğme açılırsa kaç talebin başlayacağı; hiçbir şey yazmaz).
- İz kaydı olayı: `run_restarted` (talebin işi yeniden çağrıldı). Satır kuralları: `reserved_restart_event` (bu olayı API isteği ve ajan çalışması yazamaz), `restart_records` (yeniden başlatmanın kendi kaydı), `flow_reads_restarts` (akış bu kayıtları okur). Dizin: `audit_log_restarts`.
- `office.request_flow_facts` yanıtında `restarted_at` (işin en son yeniden çağrıldığı an); aşama hesabında `awaitedSince` bunu da kapsar.
- Veritabanı ifadeleri: `restartWaitingWork`, `countWaitingWork` (kapsam türü `OpeningScope`: `agentCode`, `projectId` ya da `customerId`; satır türü `WorkToRestart`); `setAgentSwitch` yanıtında `opened` (düğmeyi bu çağrı açtı); `setProjectAiPermission` değerin değişip değişmediğini döner.
- API: `apps/api/src/restart.ts` içinde `startWaitingWork` (seçilen her talep için bir iş kuyruğa konur; açma, izler ve işler aynı işlemde saklanır). Uç nokta `GET /api/waiting-work?agent=<kod> | ?project=<kimlik> | ?customer=<kimlik>` (yalnızca kurucu; yanıtı `waiting`).
- Şemalar: `agentOpenResponseSchema`, `projectAiPermissionAnswerSchema`, `customerPermissionsAnswerSchema` (üçünde de `restarted`: bu isteğin yeniden başlattığı talep sayısı), `waitingWorkQuerySchema`, `waitingWorkResponseSchema`.
- Çalıştırıcı: `recordSwitchRefusal` (durdurulmuş ajan ya da kapalı izin yüzünden reddedilen işin izini, açma işlemini bekleyerek yazar; o sırada düğme açıldıysa iz yazmaz, işi kendisi başlatır).
- Panelde (`apps/web/src/lib/requests/labels.ts`): `OpeningKind` (`agent`, `project`, `customer`), `waitingWorkSentence` (açma onayında bekleyen taleplerin cümlesi: sayılıyor, yok, sayı, sayılamadı), `WAITING_WORK_IF_ANY` (sayı okunmadan söylenen cümle).
- Panel (0.4c adım 2): proje sayfasının adresinde `?tab=` (`settings`: "Ayarlar"; yazılmazsa "Talepler"). Bileşenler: `RequestGroups` (Talepler ekranının ve proje sayfasının ortak talep listesi; `showProject`: satır projenin adını gösterir, `dense`: dar sütun satırı, `headingLevel`), `ProjectRequests` (proje sayfasının "Talepler" sekmesi). `projectOptions` (talep formunun "Proje" alanında sunulanlar). Formu açanlar: `open` ve `openFor` (`useOpenRequestDialogFor`: form proje seçili açılır). `waitingWorkQueryOptions` ve `waitingState` (açma penceresinin okuduğu bekleyen talep sayısı: `counting`, sayı, `unknown`). `confirmBlocked` (passkey penceresinin onay düğmesi sayı gelene kadar bekler).

## 0.4c adım 3 ile eklenen adlar: proje sayfasının öteki bölümleri (karşılığı olan eski Türkçe ad yok)

Bütçe ve kilometre taşları (8 Ekim karar 17):

- "Bütçe" → `budget` (projenin parası; yapay zekâ maliyeti değildir); "para birimi" → `currency`; "kilometre taşı" → `milestone`; "tamamlandı" (kilometre taşında) → `done`.
- Sütun: `projects.budget_currency` (bütçenin para birimi; değerleri `TRY`, `USD`, `EUR`). `projects.budget` (tutar) ve `projects.milestones` (kilometre taşlarının listesi) ilk veri modelinden beri vardı; yazma yolları bu adımda açıldı.
- Kısıtlar: `projects_budget_currency_check` (üç para biriminden biri), `projects_budget_shape` (tutar ve para birimi ya birlikte vardır ya birlikte yoktur; tutar sıfırdan büyük bir sayıdır), `projects_milestones_shape` (liste `office.milestones_valid` biçimindedir).
- İşlevler: `office.milestones_valid(liste)` (liste bir projenin tutabileceği kilometre taşı listesi mi: en çok 50 kayıt; her kayıtta yalnızca `id`, `name`, `date`, `done`; hiçbir zaman hata vermez, yalnızca evet ya da hayır der), `office.guard_project_budget` (bütçeyi yalnızca projenin sahibi, yöneticileri ve kurucu değiştirir; ajan çalışması değiştiremez; bağlamda kişi yokken karışmaz). `office.audit_project_change` iki olayla yenilendi.
- Tetikleyici: `guard_budget` (`projects`; her güncellemede çalışır).
- Kilometre taşı kaydının alanları: `id` (küçük harfli kimlik; paneli seçer), `name` (ad; 1 ile 120 karakter arası), `date` (gün, `YYYY-MM-DD`, ya da boş), `done` (tamamlandı mı).
- İz kaydı olayları: `project_budget_changed` (bütçe kondu, değişti ya da kaldırıldı), `project_milestones_changed` (kilometre taşı eklendi, değişti ya da silindi). İkisinde de kaydın konusu projedir; tutar, para birimi ve kilometre taşının adı yazılmaz.
- Veritabanı hata kodları: `42501` (bütçeyi sahip, yönetici ya da kurucu olmayan biri değiştirdi), `23514` (para birimi olmayan tutar, tutarı olmayan para birimi, sıfır ya da sayı olmayan tutar, biçimi bozuk kilometre taşı listesi).
- Uç noktalar: `PUT /api/projects/:projectId/budget` (sahip, yönetici ya da kurucu bütçeyi koyar ya da kaldırır; gövdesi `budget`: `amount` ve `currency`, ya da `null`), `POST /api/projects/:projectId/milestones` (üye ya da kurucu kilometre taşı ekler; gövdesi `id`, `name`, isteğe bağlı `date`), `PATCH /api/projects/:projectId/milestones/:milestoneId` (adını, gününü ya da tamamlandı işaretini değiştirir), `DELETE /api/projects/:projectId/milestones/:milestoneId` (siler). Dördü de projenin tamamını yanıtlar.
- API hata kodları: `project_budget_not_allowed` (bütçeyi yalnızca sahip, yöneticiler ve kurucu değiştirir), `milestone_limit` (bir projede en çok 50 kilometre taşı olur), `milestone_not_found` (kilometre taşı az önce silindi; sayfa yeniden okunur).
- API yanıt alanları (proje): `budget` (`visible`: okuyan kişi bütçeyi görebilir mi; görebiliyorsa `value`: `amount` ve `currency`, ya da bütçe yoksa `null`; göremiyorsa yanıtta tutar hiç yoktur), `milestones` (eklendikleri sırayla), `actions.setBudget` (okuyan kişi bütçeyi değiştirebilir).
- Şemalar: `budgetCurrencySchema`, `budgetAmountSchema` (tutar metin olarak gider: en çok on iki basamak, en çok iki ondalık), `projectBudgetSchema`, `setProjectBudgetSchema`, `milestoneNameSchema`, `milestoneSchema`, `createMilestoneSchema`, `updateMilestoneSchema`. Sabitler: `BUDGET_CURRENCIES`, `MILESTONE_NAME_MAX` (120), `MILESTONE_MAX` (50). İşlev: `sortedMilestones` (sayfanın gösterdiği sıra: güne göre, günü olmayanlar sonda).
- Veritabanı ifadeleri: `setProjectBudget`, `addProjectMilestone`, `changeProjectMilestone`, `removeProjectMilestone` (üçü de listeyi tek bir güncellemenin içinde kurar; aynı anda iki kişinin değişikliği birbirini silmez). İfade satırında `budget`, `budget_currency` (bütçeyi göremeyen okur için boş gelir), `milestones`.
- Panel: proje sayfasında `?tab=milestones` ("Kilometre taşları" sekmesi); bütçe özellikler panelinde "Bütçe" satırıdır. Panel işlevleri: `setProjectBudget`, `addMilestone`, `updateMilestone`, `removeMilestone` (istekler), `formatMoney` (tutar, para birimi işaretiyle), `parseAmountInput` (kişinin Türkçe yazdığı tutarı API'nin aldığı metne çevirir; virgül ondalık işaretidir), `amountInputText` (kayıtlı tutarı pencerede yazıldığı gibi gösterir). Form şemaları: `milestoneFormSchema`, `budgetFormSchema`.

Ajan çalışmaları ve maliyeti (8 Ekim karar 17):

- "Projenin çalışmaları" → `runs` (o projedeki ajan çalışmaları); "kullanım" → `usage` (bir çalışmanın ya da bütün çalışmaların token sayıları ve maliyeti; yalnızca kurucuya gider).
- Dizin: `runs_project_started` (`runs`; projeye göre, en yeni çalışma önce; liste ve toplam bu dizinden okunur).
- Uç nokta: `GET /api/projects/:projectId/runs` (projeyi görebilen herkes için projenin en yeni 200 çalışması ve bütün çalışmaların toplamı; token ve maliyet yalnızca kurucuya gider; çalışmanın özeti, girdisi ve çıktısı hiç gitmez).
- API yanıt alanları: `runs` (her çalışmada `id`, `request`: talebin kimliği ve başlığı ya da talebe bağlı değilse `null`, `agent`, `status`, `errorCode`, `startedAt`, `finishedAt`, `durationMs`, `usage`), `truncated` (liste 200'de kesildi), `totals` (`runCount`: bütün çalışmaların sayısı; `usage`: toplam, kurucu değilse `null`), `serverTime`. `usage` içinde `inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens`, `costUsd` (ABD doları, metin olarak).
- Şemalar: `usdSchema` (ABD doları tutarı, metin; en çok altı ondalık), `runUsageSchema`, `projectRunSchema`, `projectRunsSchema` (`packages/shared/src/project-sections.ts`). Sabit: `PROJECT_RUN_LIST_LIMIT` (200).
- Veritabanı ifadeleri: `listProjectRuns` (satır türü `ProjectRunRow`; kurucu olmayan okur için beş kullanım sütunu boş gelir), `projectRunTotals` (satır türü `ProjectRunTotalsRow`; `run_count` herkese, toplamlar yalnızca kurucuya).
- Panel adresi: proje sayfasında `?tab=runs` ("Çalışmalar" sekmesi). Panel işlevleri: `fetchProjectRuns` ve `projectRunsQueryOptions` (istek; anahtarı `projectRunsKey`), `runResultReason` (durum sözünün ardından yazılan sabit neden; kod hiçbir zaman gösterilmez), `runDurationText` (süre; süren çalışma için "Sürüyor"), `formatCount` (token sayısı).

Projenin onayları (8 Ekim karar 17):

- "Projenin onayları" → `approvals` (o projenin taleplerinde birim onayına sunulan sonuçlar; karar bu listede verilmez).
- Uç nokta: `GET /api/projects/:projectId/approvals` (bekleyen sonuçlar önce, sonra karar verilenler, en yenisi üstte; en çok 200). Göç yok: liste `approvals` tablosunun var olan satır kuralıyla okunur; bekleyen, düzeltme istenen ve reddedilen sonucu yalnızca onay hakkı olan görür.
- API yanıt alanları: `approvals` (her sonuçta `id`, `request`: talebin kimliği ve başlığı, `agent`, `status`, `attempt`, `createdAt`, `decidedAt`, `decidedBy`), `truncated`, `seesUndecided` (okuyan kişinin onay hakkı var: bekleyen ve onaylanmayan sonuçları da görür). Sonucun başlığı, özeti, gerekçesi, risk notu ve içeriği hiç gitmez; karar verenin notu da gitmez.
- Sonuç durumu (bu listede): `pending` (onay bekliyor), `approved`, `changes_requested`, `rejected`, `closed` (beklerken talep değişti; karar verilmeden kapandı).
- Şemalar: `projectApprovalSchema`, `projectApprovalsSchema` (`packages/shared/src/project-sections.ts`). Sabit: `PROJECT_APPROVAL_LIST_LIMIT` (200).
- Veritabanı ifadeleri: `listProjectApprovals` (satır türü `ProjectApprovalRow`), `readerSeesUndecided` (okuyan kişinin şirkette onay hakkı var mı; `office.can_approve`).
- Panel: proje sayfasında `?tab=approvals` ("Onaylar" sekmesi). Panel işlevleri: `fetchProjectApprovals` ve `projectApprovalsQueryOptions` (istek; anahtarı `projectApprovalsKey`), `approvalLine` (bir sonucun tek cümlesi: ajan koduyla, karar veren kişinin adıyla; ajanın yazdığı metin yok).

Projeye yapay zekâ harcama sınırı (8 Ekim karar 17):

- "Yapay zekâ harcama sınırı" → `ai_spend_limit_usd` (API'de `limitUsd`; ABD doları, 0,01 ile 999.999,99 arası; boşsa sınır yok); "harcanan" → `spentUsd` (o projenin bütün ajan çalışmalarının kayıtlı maliyeti); "sınır doldu" → `spendingLimitReached` (harcanan, sınıra eşit ya da üstünde).
- Sütun: `projects.ai_spend_limit_usd`; kısıtı `projects_ai_spend_limit_check` (sıfırdan büyük bir sayı). Sütun hiçbir uygulama rolünün yazma yetkisinde değildir.
- İşlevler: `office.project_ai_spending(proje)` (projenin çalışmalarının kayıtlı maliyet toplamı; yalnızca veritabanının kendi işlevleri çağırır), `office.project_spending_limit_reached(proje)` (sınır şu an doldu mu; ajan çalışmasına ve projeyi okuyabilen kişiye evet ya da hayır der, başkasına hiçbir şey demez; tutar söylemez), `office.set_project_ai_spending_limit(proje, sınır)` (sınırı kurucu koyar, değiştirir ya da boş vererek kaldırır; yalnızca API rolü çağırabilir; değer değiştiyse `true` döner), `office.guard_project_ai_spending_limit` (sınırı yalnızca kurucu değiştirir; yükseltmek ve kaldırmak o proje için alınmış passkey onayını harcar; ilk kez sınır koymak ve düşürmek passkey istemez), `office.check_run_spending_limit` (sınırı dolmuş projede çalışma kaydı açılmasını reddeder; kim yazarsa yazsın). `office.record_step_up`, `office.audit_project_change` ve `office.flow_waiting_work` yenilendi: son işlev, sınırı dolmuş projedeki işi hiçbir açmada başlatmaz ve saymaz.
- Tetikleyiciler: `guard_ai_spending_limit` (`projects`; her güncellemede), `spending_limit_holds` (`runs`; çalışma kaydı eklenmeden önce, `check_run_start` ve `project_from_task` tetikleyicilerinden sonra).
- Satır kuralı: `reserved_spending_limit_events` (`audit_log`; sınır olaylarını API isteği ve ajan çalışması yazamaz).
- Yeniden doğrulama amacı: `project_ai_spending_limit` (konusu proje; ayrıntısı `action: set_limit` ve `limitUsd`: iki ondalıklı yeni sınır, ya da kaldırılıyorsa `null`).
- İz kaydı olayları: `project_ai_spending_limit_set` (ilk kez sınır kondu), `project_ai_spending_limit_raised` (yükseltildi), `project_ai_spending_limit_lowered` (düşürüldü), `project_ai_spending_limit_removed` (kaldırıldı). Kaydın konusu projedir; tutar yazılmaz.
- Veritabanı hata kodları: `28000` (yükseltme ya da kaldırma için passkey onayı yok), `42501` (kurucu değil, ya da ajan çalışması), `P0002` (bağlamdaki şirkette böyle bir proje yok), `22023` (sıfır ya da eksi, 999.999,99'dan büyük ya da ikiden çok ondalıklı sınır), `54000` (sınırı dolmuş projede çalışma kaydı).
- Çalışma hata kodu: `spending_limit_reached` (çalışma sürerken sınır doldu; ücreti ödenmiş yanıt kullanıldı ve bir sonraki model çağrısından önce durduruldu; durum `stopped`).
- Çalıştırıcı sonucu: `spending_limit_reached` (iş başlarken sınır doluydu; çalışma açılmaz, model çağrılmaz, iz kaydına `run_refused` düşer). Çalıştırıcı sınırı her çalışmanın başında, çalışma kaydını yazmadan hemen önce, her model çağrısından sonra ve bir sonraki model çağrısından hemen önce yeniden sorar (aynı projenin başka bir çalışması o arada sınırı doldurduysa ya da sınır düşürüldüyse çalışma bir yanıt daha ödemeden durur); yanıt alamazsa sınırı dolmuş sayar.
- Talebin insana düşme nedenleri: `spending_limit_reached` ("harcama sınırı doldu"; sıra kurucudadır, sınır yükseltilene kadar o projede hiçbir şey çalışmaz), `spending_limit_interrupted` ("sınır dolunca durdu"; sınır artık dolu değil ama durdurulan iş kendiliğinden başlamadı).
- Uç nokta: `PUT /api/projects/:projectId/ai-spending-limit` (yalnızca kurucu; gövdesi `limitUsd` ya da kaldırmak için `null`, yükseltme ve kaldırmada `stepUp`). Yükseltme ve kaldırma, sınırın beklettiği işleri yeniden başlatır (aşağıda).
- API hata kodları: `project_spending_limit_reached` (sınırı dolmuş projede yeni talep açılamaz), `spending_limit_reached` (sınır doluyken düzeltme istenemez ve yönlendirme düzeltilemez; onaylamak, reddetmek, sonucu kabul etmek ve işi durdurmak serbesttir).
- API alanları: proje yanıtlarında `spendingLimitReached` (projeyi okuyan herkese, evet ya da hayır), proje sayfasında `aiSpending` (`limitUsd` ve `spentUsd`; kurucu değilse `null`) ve `actions.setAiSpendingLimit`; talep yanıtında, onay kartında ve talep sahibi onayı kartında `spendingLimitReached`. Sınır doluyken `actions.reroute` kapalıdır.
- Şemalar: `usdLimitSchema`, `projectAiSpendingLimitSchema`, `projectAiSpendingLimitDetailsSchema`. İşlevler: `normalizeUsdLimit` ("50" ile "50.00" aynı sınırdır), `projectAiSpendingLimitDetails`, `loosensSpendingLimit` (değişiklik sınırı gevşetiyor mu: yükseltme ya da kaldırma), `spendingState` (kurucunun sayfasındaki durum: `no_limit`, `ok`, `near`, `reached`). Sabit: `SPENDING_WARN_SHARE` (0,8: harcama sınırın yüzde 80'ine ulaşınca `near`).
- Veritabanı ifadeleri: `readProjectAiSpending` (sınır ve harcanan; yalnızca kurucuya), `setProjectAiSpendingLimit`; ifade satırlarında `spending_limit_reached` (proje, talep, onay ve talep sahibi onayı satırları). API'de `projectSpendingLimitReached`, `spendingLimitReached`, `limitBusy` (hata üreticileri).
- Panel: kurucunun harcama kutusu proje sayfasının "Çalışmalar" sekmesinin başındadır (`SpendingLimit`; "Harcanan", "Sınır", "Kalan"). Panel işlevleri: `setProjectAiSpendingLimit` (istek), `limitFormSchema` ve `limitOf` (kişinin yazdığı sınır), `remainingUsd` (kalan; sıfırın altına inmez), `limitAlreadyReached` (yazılan sınır harcananın üstünde değil), `limitWaitingWorkSentence` (yükseltme ve kaldırma penceresinin kaç talebin başlayacağını söyleyen cümlesi). Sabit metinler: `LIMIT_REACHED` (proje sayfasının üstündeki uyarı), `NO_REQUEST_AT_LIMIT` ("Talepler" sekmesi), `LIMIT_FOR_OTHERS` (talep sayfası, kurucu olmayan okur), `CHANGES_HELD_BY_LIMIT` ve `CHANGES_HELD_BY_LIMIT_FOR_REQUESTER` (onay kartı ve talep sahibinin kartı). Talep formunun proje seçeneğinde `held`: `permission` (ajanlar çalışamaz), `limit` (harcama sınırı doldu) ya da boş.

Sınır yükseltilince bekleyen işlerin başlaması (11 Ekim karar 1):

- Sınır yükseltildiğinde ya da kaldırıldığında o projede sınırın beklettiği işler kendiliğinden yeniden başlar: çalışması sınır dolunca durdurulmuş olanlar ve işi sınır doluyken reddedilmiş olanlar. Sınır panel dışından (veritabanında elle) değiştirilirse hiçbir iş başlamaz.
- İşlevler: `office.count_work_held_by_spending_limit(proje, sınır)` (sınır bu değere çekilirse, boşsa kaldırılırsa, kaç talebin başlayacağı; yeni sınır harcananın altında ya da ona eşitse 0; hiçbir şey yazmaz; yalnızca kurucu, yalnızca API rolü). `office.flow_waiting_work` yenilendi: sınır dolunca durdurulan çalışma (`spending_limit_reached`) artık bekleyen iş sayılır; dördüncü değişkeni `spending_limit` değerini de alır (sayım için sınırı dolmamış sayar). İşleri başlatan, var olan `office.restart_waiting_work` işlevidir (kapsamı o proje).
- Uç nokta: `GET /api/waiting-work?spendingLimit=<proje kimliği>[&limitUsd=<tutar>]` (yalnızca kurucu; `limitUsd` iki ondalıkla yazılır, yazılmazsa sınırın kaldırılması sorulur; yanıtı `waiting`).
- API yanıt alanı: `PUT /api/projects/:projectId/ai-spending-limit` yanıtında `restarted` (bu isteğin yeniden başlattığı talep sayısı; ilk kez sınır koymada, düşürmede ve sınır hâlâ doluyken 0). Şema: `projectAiSpendingLimitAnswerSchema`.
- Veritabanı ifadesi: `countWorkHeldBySpendingLimit`. Yeniden başlatma `restartWaitingWork` ile, kapsam `projectId` verilerek yapılır.
- Çalıştırıcı: sınır yüzünden reddedilen işin izi ve sınır dolunca durdurulan çalışmanın kaydı, yeniden başlatmanın aldığı kilidin arkasında, sınır bir kez daha okunduktan sonra yazılır; o sırada sınır yükseltildiyse iz yazılmaz ve iş sürer (durdurulan ajan ve kapalı izin için kurulan kuralın aynısı, `recordSwitchRefusal`).
- Talebin insana düşme nedeni `spending_limit_interrupted` artık yalnızca şunu söyler: sınır dolu değil ama durdurulan iş yeniden başlamadı (o sırada ajan durdurulmuştu ya da sınır panel dışından değiştirildi).

## 0.4c adım 4 ile eklenen adlar: proje dosyaları (karşılığı olan eski Türkçe ad yok)

- "Proje dosyası" → `project_file`; "ajan çıktısı" → `agent_output`: `files.kind` alanının iki değeri (kısıtı `files_kind_check`). Var olan satırlar `agent_output` sayıldı. Göç dosyası: `20261008103100_project_files.sql`.
- `files_project_file_shape`: proje dosyasının kurallarını tutan kısıt (projesi olur, görevi ve çalışması olmaz, ajan eklemez, SHA-256 dolu, boyut 1 ile 26214400 bayt arası, tür on bir türden biri, ad kırpılmış ve en çok 200 karakter, depodaki anahtar satırın kendi kimliklerinden).
- `files_agent_output_key`: ajan çıktısının depodaki anahtarı `<şirket kimliği>/projects/` altında olamaz; o alan yalnızca proje dosyalarınındır.
- `files_project_files`: bir projenin dosyalarını yeniden eskiye sıralayan dizin.
- Depodaki anahtar (`files.storage_path`): `<şirket kimliği>/projects/<proje kimliği>/<dosya kimliği>`; veritabanı yazar.
- Tetikleyiciler: `check_project_file` (anahtarı yazar, projenin iki sınırını tutar), `audit_project_file` (ekleme ve silmeyi iz kaydına yazar).
- Satır kuralları: `project_file_reads`, `project_file_adds`, `project_file_deletes` (yalnızca API rolü); `tenant_isolation` (`files`) artık yalnızca `agent_output` satırları içindir. Okuma ve ekleme proje üyeleri ile kurucunundur; silmeyi dosyayı ekleyen kişi, projenin sahibi ve yöneticileri ve kurucu yapar (11 Ekim, karar 2).
- Veritabanı hata kodu: `54000`, kısıt adı `project_files_count_limit` (200 dosya) ya da `project_files_size_limit` (1 GB).
- İz kaydı olayları: `project_file_added`, `project_file_deleted`; kaydın konusu dosyadır (`record_type` `file`), proje `project_id` alanındadır.
- Veritabanı ifadeleri (`packages/db`): `listProjectFiles`, `readProjectFile`, `insertProjectFile`, `deleteProjectFile`; satır tipi `ProjectFileRow` (içinde `deletable`: okuyan kişi silebilir).
- Uç noktalar: `GET /api/projects/:projectId/files`, `POST /api/projects/:projectId/files/:fileId/ticket` (yükleme izni; gövde `{ sizeBytes }`, yanıt `ticket` ve `expiresAt`), `PUT /api/projects/:projectId/files/:fileId` (gövde dosyanın kendisi), `GET /api/projects/:projectId/files/:fileId/content`, `DELETE /api/projects/:projectId/files/:fileId`.
- İstek başlıkları: `x-file-name` (`FILE_NAME_HEADER`; dosya adı, yüzde kodlamasıyla), `x-upload-ticket` (`UPLOAD_TICKET_HEADER`; yükleme izni, `UPLOAD_TICKET_SECONDS` = 60 saniye geçerli); gövde türü `application/octet-stream` (`FILE_UPLOAD_CONTENT_TYPE`).
- "Yükleme izni" (kodda upload ticket): dosyanın baytları gönderilmeden önce alınan, oturuma, şirkete, projeye, dosya kimliğine ve boyuta bağlı imzalı kısa ömürlü değer; kendi başına yetki vermez. İmza anahtarı `COOKIE_SECRET` değerinden türetilir.
- API hata kodları: `file_too_large`, `file_empty`, `file_name_invalid`, `file_type_not_allowed`, `file_content_mismatch` (içerik uzantıya uymuyor), `file_limit_reached` (200 dosya), `file_space_full` (1 GB), `file_delete_not_allowed` (ekleyen, sahip, yönetici ya da kurucu değil), `file_content_missing` (kaydı var, depoda içeriği yok), `file_storage_unavailable` (ortamda depo kurulu değil), `file_storage_failed`, `uploads_busy`, `downloads_busy`, `upload_ticket_invalid` (yükleme izni yok, başka bir yükleme için ya da süresi dolmuş).
- API yanıt alanları: dosyada `kind`, `sizeBytes`, `createdAt`, `createdBy`, `deletable` (okuyan kişi silebilir); listede `files`, `storageAvailable`. Şemalar: `projectFileSchema`, `projectFileListSchema`, `uploadTicketRequestSchema`, `uploadTicketSchema`, `projectFileNameSchema`, `projectFileKindSchema`.
- Dosya türleri (kodda `ProjectFileKind`): `document` (Belge), `spreadsheet` (Tablo), `presentation` (Sunum), `pdf` (PDF), `image` (Resim), `text` (Metin).
- Sabitler: `PROJECT_FILE_MAX_BYTES` (26214400), `PROJECT_FILE_NAME_MAX` (200), `PROJECT_FILE_LIMIT` (200), `PROJECT_FILES_MAX_BYTES` (1073741824), `PROJECT_FILE_TYPES`, `PROJECT_FILE_ACCEPT`, `UPLOAD_BUFFER_BYTES` ve `DOWNLOAD_BUFFER_BYTES` (API; 104857600), `STORAGE_CALLS_IN_TRANSACTIONS` (API; 3).
- Kodda: `FileStorage` (depo arayüzü: `put`, `get`, `remove`), `FileStorageError`, `assertStorageKey`, `MemoryFileStorage`, `DiskFileStorage`, `SupabaseFileStorage`, `createFileStorage`, `ProjectFileStore` (rotaların depoya tek yolu: `add`, `find`, `content`, `remove`), `ByteBudget`, `uploadDeadlineMs`, `UploadTickets` (`issue`, `verify`), `contentMatches`, `zipEntryNames`, `attachmentDisposition` (`apps/api/src/files`); `fileStorageSettings` (`apps/api/src/env.ts`; depo ayarlarını yalnızca `main.ts` ve deneme betiği okur); `fileExtension`, `projectFileTypeOf`, `projectFileKindOf`, `projectFileProblem` ve yanıtları `name`, `type`, `empty`, `too_large` (`packages/shared`). ESLint kuralı `agent-office/api-file-storage`: `files/storage.ts` dosyasını yalnızca `apps/api/src/files` ve `main.ts` içe aktarır.
- Ortam değişkenleri: `FILE_STORAGE_DIR`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`. Komut: `pnpm files:check` (`apps/api/scripts/check-file-storage.ts`).
- Panel adresi: `/c/$company/projects/$projectId?tab=files`. Sekmenin etiketi "Dosyalar".

## Notlar

- Hata metinleri (veritabanı tetikleyicilerinin `raise exception` metinleri, geliştiriciye dönük iletiler) İngilizcedir. Kullanıcıya gösterilecek Türkçe metni API üretir; API hata metnine göre değil SQLSTATE koduna göre dallanır.
- PostgreSQL aynı olaydaki tetikleyicileri ada göre sırayla çalıştırır. Adlar değiştiği için bazı tablolarda sıra değişti; kabul ya da ret sonucu aynı, yalnızca bir istek birden çok kuralı ihlal ederse dönen hata kodu farklı olabilir.

