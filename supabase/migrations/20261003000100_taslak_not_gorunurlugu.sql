-- Ajanın taslak notu onaya kadar yalnızca onay yetkililerine görünür (3 Ekim, karar 1).
--
-- Ajanın yazdığı not taslak açılır ve onaydan sonra paylaşılır (PLAN, Yetki seviyeleri). Onaya kadar:
-- - kişilerden yalnızca kurucu ve onay yetkisi verilen çalışanlar görür (dış kişiye açılmış olsa da);
-- - ajan çalışmalarından yalnızca notu yazan ajan görür, o da çalışmanın kimliği onay yetkiliyse ya
--   da not o kimlik adına yazıldıysa (çalışma kimliğinin sınırını aşamaz);
-- - proje kapsamı ayrıca geçerlidir.
-- Kişinin yazdığı taslak not bu kurala girmez. Notun sürümleri ve bağlantıları notun görünürlüğünü
-- izler; taslak kaynak notuna bağlı belge ve dayanağı taslak not olan onay kaydı (içinde taslağın
-- metni durur) da aynı kişilere görünür.

create function ofis.taslak_gorunur(p_durum text, p_olusturan_ajan text, p_olusturan_kullanici uuid)
  returns boolean
  language sql stable set search_path = ''
  as $$
    select p_durum <> 'taslak'
      or p_olusturan_ajan is null
      or case
        when ofis.baglam_ajan() is not null then
          p_olusturan_ajan = ofis.baglam_ajan()
          and (ofis.onay_yetkili_mi() or p_olusturan_kullanici = ofis.baglam_kullanici())
        else ofis.onay_yetkili_mi()
      end
  $$;
grant execute on function ofis.taslak_gorunur(text, text, uuid) to ofis_uygulama, ofis_yetki_okuyucu;

drop policy sirket_ayrimi on ofis.notlar;
create policy sirket_ayrimi on ofis.notlar for all to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and ofis.taslak_gorunur(durum, olusturan_ajan_kod, olusturan_kullanici_id)
  )
  with check (
    ofis.satir_gorunur(sirket_id, proje_id)
    and ofis.taslak_gorunur(durum, olusturan_ajan_kod, olusturan_kullanici_id)
  );

drop policy dis_kisi_gorur on ofis.notlar;
create policy dis_kisi_gorur on ofis.notlar for select to ofis_uygulama
  using (
    sirket_id = ofis.baglam_sirket()
    and ofis.dis_kisi_mi()
    and ofis.bana_acik_mi('not', id)
    and ofis.taslak_gorunur(durum, olusturan_ajan_kod, olusturan_kullanici_id)
  );

drop policy sirket_ayrimi on ofis.belgeler;
create policy sirket_ayrimi on ofis.belgeler for all to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and exists (select 1 from ofis.notlar n where n.id = kaynak_not_id)
  )
  with check (
    ofis.satir_gorunur(sirket_id, proje_id)
    and exists (select 1 from ofis.notlar n where n.id = kaynak_not_id)
  );

-- Onay kaydının dayandığı not taslaksa onay da yalnızca taslağı görebilenlere görünür. Not silinmişse
-- onay görünür kalır; bu yüzden not, satır kuralına takılmadan okuyucu rolle okunur.
grant select (id, durum, olusturan_ajan_kod, olusturan_kullanici_id) on ofis.notlar
  to ofis_yetki_okuyucu;
create policy okuyucu on ofis.notlar for select to ofis_yetki_okuyucu using (true);

create function ofis.dayanak_notu_gorunur(p_not uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(
      (select ofis.taslak_gorunur(n.durum, n.olusturan_ajan_kod, n.olusturan_kullanici_id)
       from ofis.notlar n where n.id = p_not),
      true
    )
  $$;
alter function ofis.dayanak_notu_gorunur(uuid) owner to ofis_yetki_okuyucu;
grant execute on function ofis.dayanak_notu_gorunur(uuid) to ofis_uygulama;

drop policy gorunur on ofis.onaylar;
create policy gorunur on ofis.onaylar for select to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and (dayanak_turu is distinct from 'not' or ofis.dayanak_notu_gorunur(dayanak_id))
  );
drop policy guncelleme on ofis.onaylar;
create policy guncelleme on ofis.onaylar for update to ofis_uygulama
  using (
    ofis.satir_gorunur(sirket_id, proje_id)
    and (ofis.baglam_ajan() is not null or ofis.sirket_ici_mi())
    and (dayanak_turu is distinct from 'not' or ofis.dayanak_notu_gorunur(dayanak_id))
  );
