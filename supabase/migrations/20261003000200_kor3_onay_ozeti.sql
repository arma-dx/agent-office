-- KOR-3 dayanağı ajan taslağı olan onay kayıtlarını da görür (3 Ekim, karar 3).
--
-- KOR-3 bekleyen onayları özetleyip kurucuya sunar. 3 Ekim karar 1'e göre ajan taslağına dayanan onay
-- kaydı (taslağın metnini taşır) ajanlardan yalnızca taslağı yazan ajana açıktı; kurucu KOR-3'ün bu
-- onayları da özetlemesini istedi. İstisna dardır: yalnızca onay kaydı (taslak notun kendisi değil),
-- yalnızca KOR-3, yalnızca çalışmanın kimliği onay yetkiliyken (KOR-3'ün zamanlanmış çalışması
-- sorumlusu olan kurucu adına koşar). Özet yalnızca kurucuya gider; bunu çalıştırıcı uygular.

create or replace function ofis.dayanak_notu_gorunur(p_not uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(
      (select ofis.taslak_gorunur(n.durum, n.olusturan_ajan_kod, n.olusturan_kullanici_id)
       from ofis.notlar n where n.id = p_not),
      true
    )
    or (ofis.baglam_ajan() = 'KOR-3' and ofis.onay_yetkili_mi())
  $$;
