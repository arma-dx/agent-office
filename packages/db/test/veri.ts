import type pg from 'pg';

// Test verisinin sabit kimlikleri (geçerli v4 biçiminde).
function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

export const K = {
  arma: id(1),
  pillika: id(2),
  kurucuAlani: id(3),
  // Kurucunun üyesi olmadığı, başka bir kurucunun yönettiği şirket (hesap yönetimi testleri için).
  baska: id(4),

  kurucu: id(11),
  calisanA: id(12),
  calisanP: id(13),
  disKisiA: id(14),
  yetkiliA: id(15),
  disKisiP: id(16),
  // baska şirketin kurucusu ve hem Arma DX'te hem baska şirkette çalışan kişi.
  yabanciKurucu: id(17),
  ortakCalisan: id(18),
  // Hiçbir şirkete üye olmayan (ayrılmış) kişi.
  eskiCalisan: id(19),

  musteriA: id(21),
  musteriAIzinsiz: id(22),
  musteriP: id(23),

  projeA: id(31),
  projeAIzinsiz: id(32),
  projeAMusteriIzinsiz: id(33),
  projeP: id(34),

  gorevA: id(51),
  gorevAProje: id(52),
  gorevAIzinsizProje: id(53),
  gorevAPaylasilan: id(54),
  gorevP: id(55),
  gorevPProje: id(56),
  gorevKurucuAlani: id(57),

  kartKor: id(61),
  kartHaf: id(62),
  kartPist: id(63),

  calismaA: id(71),
  calismaAProje: id(72),
  calismaP: id(73),

  notA: id(81),
  notAProje: id(82),
  notATdk: id(83),
  notAPaylasilan: id(84),
  notP: id(85),
  notPProje: id(86),

  onayA: id(91),
  onayAProje: id(92),
  onayP: id(93),
  onayAOnayli: id(94),
  onayPOnayli: id(95),
} as const;

export const ARAC = {
  okuma: 'gorev_oku',
  icYazma: 'not_guncelle',
  disEtki: 'eposta_gonder',
} as const;

function baglam(
  sirket: string,
  kullanici: string,
  ajan: string | null = null,
  proje: string | null = null,
): string {
  return `select
    set_config('app.sirket_id', '${sirket}', true),
    set_config('app.kullanici_id', '${kullanici}', true),
    set_config('app.ajan_kod', '${ajan ?? ''}', true),
    set_config('app.proje_id', '${proje ?? ''}', true);`;
}

/**
 * İki şirketin (ve Kurucu alanının) her tabloda en az bir satırı olacak biçimde test verisi.
 * Yetkili rolle yüklenir; tetikleyiciler bağlam istediği için bağlam adım adım kurulur.
 */
export async function veriYukle(istemci: pg.Client): Promise<void> {
  const sql = `
    insert into ofis.sirketler (id, kod, ad, tur) values
      ('${K.arma}', 'armadx', 'Arma DX', 'sirket'),
      ('${K.pillika}', 'pillika', 'Pillika', 'sirket'),
      ('${K.kurucuAlani}', 'kurucu_alani', 'Kurucu', 'ozel_alan'),
      ('${K.baska}', 'baska', 'Başka Şirket', 'sirket');

    insert into ofis.kullanicilar (id, ad) values
      ('${K.kurucu}', 'Kurucu'),
      ('${K.calisanA}', 'Çalışan A'),
      ('${K.calisanP}', 'Çalışan P'),
      ('${K.disKisiA}', 'Mali Müşavir'),
      ('${K.yetkiliA}', 'Yetkili Çalışan A'),
      ('${K.disKisiP}', 'Avukat'),
      ('${K.yabanciKurucu}', 'Başka Kurucu'),
      ('${K.ortakCalisan}', 'Ortak Çalışan'),
      ('${K.eskiCalisan}', 'Eski Çalışan');

    -- Kurucunun iki hesabı var; ikisiyle de aynı kullanıcı olarak girer.
    insert into ofis.kullanici_epostalari (eposta, kullanici_id) values
      ('kurucu@arma.test', '${K.kurucu}'),
      ('kurucu@pillika.test', '${K.kurucu}'),
      ('calisan.a@ornek.test', '${K.calisanA}'),
      ('calisan.p@ornek.test', '${K.calisanP}'),
      ('musavir@ornek.test', '${K.disKisiA}'),
      ('yetkili.a@ornek.test', '${K.yetkiliA}'),
      ('avukat@ornek.test', '${K.disKisiP}'),
      ('kurucu@baska.test', '${K.yabanciKurucu}'),
      ('ortak@ornek.test', '${K.ortakCalisan}'),
      ('eski@ornek.test', '${K.eskiCalisan}');

    insert into ofis.uyelikler (sirket_id, kullanici_id, rol, onay_yetkisi) values
      ('${K.arma}', '${K.kurucu}', 'kurucu', true),
      ('${K.pillika}', '${K.kurucu}', 'kurucu', true),
      ('${K.kurucuAlani}', '${K.kurucu}', 'kurucu', true),
      ('${K.arma}', '${K.calisanA}', 'calisan', false),
      ('${K.arma}', '${K.yetkiliA}', 'calisan', true),
      ('${K.arma}', '${K.disKisiA}', 'dis_kisi', false),
      ('${K.pillika}', '${K.calisanP}', 'calisan', false),
      ('${K.pillika}', '${K.disKisiP}', 'dis_kisi', false),
      ('${K.baska}', '${K.yabanciKurucu}', 'kurucu', true),
      ('${K.baska}', '${K.ortakCalisan}', 'calisan', false),
      ('${K.arma}', '${K.ortakCalisan}', 'calisan', false);

    insert into ofis.birimler (kod, ad, sirket_kod, pilotta_acik) values
      ('KOR', 'Koordinasyon Katmanı', null, true),
      ('HAF', 'Kurumsal Hafıza', null, true),
      ('A-KES', 'Keşif ve Dönüşüm Danışmanlığı', 'armadx', true),
      ('P-IST', 'İstasyon Verisi ve Şarj Operasyonları', 'pillika', true);

    insert into ofis.ajan_tanimlari (kod, ad, birim_kod, sirket_kodlari) values
      ('KOR-1', 'Ofis Koordinatörü', 'KOR', '{armadx,pillika}'),
      ('HAF-1', 'Bilgi Düzenleme', 'HAF', '{armadx,pillika}'),
      ('P-IST-1', 'İstasyon Veri Toplama', 'P-IST', '{pillika}');

    insert into ofis.kart_surumleri (id, ajan_kod, git_commit, icerik, yetki_seviyesi, model) values
      ('${K.kartKor}', 'KOR-1', 'abc1234', '{}', 'Y2', 'test-model'),
      ('${K.kartHaf}', 'HAF-1', 'abc1234', '{}', 'Y1', 'test-model'),
      ('${K.kartPist}', 'P-IST-1', 'abc1234', '{}', 'Y2', 'test-model');
    update ofis.ajan_tanimlari set guncel_surum_id = '${K.kartKor}' where kod = 'KOR-1';

    insert into ofis.araclar (ad, sinif, aciklama) values
      ('${ARAC.okuma}', 'okuma', 'Görev okur'),
      ('${ARAC.icYazma}', 'ic_yazma', 'Notu değiştirir'),
      ('${ARAC.disEtki}', 'dis_etki', 'E-posta gönderir');

    insert into ofis.sirket_ajanlari (sirket_id, ajan_kod, durum) values
      ('${K.arma}', 'KOR-1', 'acik'),
      ('${K.pillika}', 'KOR-1', 'acik'),
      ('${K.arma}', 'HAF-1', 'durduruldu'),
      ('${K.pillika}', 'P-IST-1', 'acik');

    -- AI iznini yalnızca kurucu açar; müşteriler kurucu bağlamında eklenir.
    ${baglam(K.arma, K.kurucu)}
    insert into ofis.musteriler (id, sirket_id, ad, ai_izni) values
      ('${K.musteriA}', '${K.arma}', 'İzinli Müşteri', true),
      ('${K.musteriAIzinsiz}', '${K.arma}', 'İzinsiz Müşteri', false);
    ${baglam(K.pillika, K.kurucu)}
    insert into ofis.musteriler (id, sirket_id, ad, ai_izni) values
      ('${K.musteriP}', '${K.pillika}', 'Pillika Müşterisi', true);

    insert into ofis.firsatlar (sirket_id, musteri_id, ad) values
      ('${K.arma}', '${K.musteriA}', 'Fırsat A'),
      ('${K.arma}', '${K.musteriAIzinsiz}', 'Fırsat İzinsiz'),
      ('${K.pillika}', '${K.musteriP}', 'Fırsat P');

    insert into ofis.projeler (id, sirket_id, musteri_id, ad, ai_izni) values
      ('${K.projeA}', '${K.arma}', '${K.musteriA}', 'Proje A', true),
      ('${K.projeAIzinsiz}', '${K.arma}', null, 'İzinsiz Proje', false),
      ('${K.projeAMusteriIzinsiz}', '${K.arma}', '${K.musteriAIzinsiz}', 'Müşterisi İzinsiz Proje', true),
      ('${K.projeP}', '${K.pillika}', '${K.musteriP}', 'Proje P', true);

    insert into ofis.proje_uyeleri (sirket_id, proje_id, kullanici_id) values
      ('${K.arma}', '${K.projeA}', '${K.calisanA}'),
      ('${K.arma}', '${K.projeAIzinsiz}', '${K.calisanA}'),
      ('${K.pillika}', '${K.projeP}', '${K.calisanP}');

    insert into ofis.is_turleri (sirket_id, kod, ad, eski_sure_dakika) values
      ('${K.arma}', 'teklif', 'Teklif hazırlama', 240),
      ('${K.pillika}', 'gonderi', 'Sosyal medya gönderisi', 60);

    insert into ofis.gorevler (id, sirket_id, proje_id, baslik, birim_kod) values
      ('${K.gorevA}', '${K.arma}', null, 'Genel görev A', 'KOR'),
      ('${K.gorevAProje}', '${K.arma}', '${K.projeA}', 'Proje görevi A', 'A-KES'),
      ('${K.gorevAIzinsizProje}', '${K.arma}', '${K.projeAIzinsiz}', 'İzinsiz proje görevi', 'A-KES'),
      ('${K.gorevAPaylasilan}', '${K.arma}', null, 'Müşavire açık görev', 'KOR'),
      ('${K.gorevP}', '${K.pillika}', null, 'Genel görev P', 'KOR'),
      ('${K.gorevPProje}', '${K.pillika}', '${K.projeP}', 'Proje görevi P', 'P-IST'),
      ('${K.gorevKurucuAlani}', '${K.kurucuAlani}', null, 'Kurucu alanı görevi', 'KOR');

    insert into ofis.erisim_paylasimlari (sirket_id, kullanici_id, kayit_turu, kayit_id) values
      ('${K.arma}', '${K.disKisiA}', 'gorev', '${K.gorevAPaylasilan}'),
      ('${K.arma}', '${K.disKisiA}', 'not', '${K.notAPaylasilan}'),
      ('${K.pillika}', '${K.disKisiP}', 'gorev', '${K.gorevP}');

    ${baglam(K.arma, K.kurucu)}
    insert into ofis.gorev_yorumlari (sirket_id, gorev_id, metin) values
      ('${K.arma}', '${K.gorevA}', 'Genel yorum'),
      ('${K.arma}', '${K.gorevAProje}', 'Proje yorumu'),
      ('${K.arma}', '${K.gorevAPaylasilan}', 'Müşavire açık yorum');
    insert into ofis.notlar (id, sirket_id, proje_id, baslik, govde, durum, tek_dogru_kaynak) values
      ('${K.notA}', '${K.arma}', null, 'Genel Not', 'Bkz. [[Tek Doğru Kaynak]] ve [[Proje Notu|proje]].', 'etkin', false),
      ('${K.notAProje}', '${K.arma}', '${K.projeA}', 'Proje Notu', 'Proje içeriği', 'etkin', false),
      ('${K.notATdk}', '${K.arma}', null, 'Tek Doğru Kaynak', 'Kaynak listesi', 'etkin', true),
      ('${K.notAPaylasilan}', '${K.arma}', null, 'Müşavir Notu', 'Beyanname takvimi', 'etkin', false);
    insert into ofis.bildirimler (sirket_id, alici_kullanici_id, sablon, kayit_turu, kayit_id) values
      ('${K.arma}', '${K.calisanA}', 'gorev_atandi', 'gorev', '${K.gorevA}');
    insert into ofis.istasyon_adaylari (sirket_id, kaynak) values ('${K.arma}', 'deneme-kaynak');
    insert into ofis.entegrasyonlar (sirket_id, tur, hesap, token_sifreli)
      values ('${K.arma}', 'google', 'arma-hesap', '\\x00');
    insert into ofis.iz_kaydi (sirket_id, olay, kayit_turu, kayit_id)
      values ('${K.arma}', 'gorev_acildi', 'gorev', '${K.gorevA}');

    ${baglam(K.pillika, K.kurucu)}
    insert into ofis.gorev_yorumlari (sirket_id, gorev_id, metin) values
      ('${K.pillika}', '${K.gorevP}', 'Pillika yorumu');
    insert into ofis.notlar (id, sirket_id, proje_id, baslik, govde, durum) values
      ('${K.notP}', '${K.pillika}', null, 'Pillika Notu', 'Bkz. [[Pillika Proje Notu]]', 'etkin'),
      ('${K.notPProje}', '${K.pillika}', '${K.projeP}', 'Pillika Proje Notu', 'İçerik', 'etkin');
    insert into ofis.bildirimler (sirket_id, alici_kullanici_id, sablon) values
      ('${K.pillika}', '${K.calisanP}', 'gunluk_ozet');
    insert into ofis.istasyon_adaylari (sirket_id, kaynak, kapali) values ('${K.pillika}', 'acik-veri', false);
    insert into ofis.entegrasyonlar (sirket_id, tur, hesap, token_sifreli)
      values ('${K.pillika}', 'google', 'pillika-hesap', '\\x00');
    insert into ofis.iz_kaydi (sirket_id, olay) values ('${K.pillika}', 'giris');

    insert into ofis.belgeler (sirket_id, drive_dosya_id, ad, kaynak_not_id) values
      ('${K.arma}', 'drive_dosya_arma_1', 'Sözleşme', '${K.notA}'),
      ('${K.pillika}', 'drive_dosya_pillika_1', 'Kaynak listesi', '${K.notP}');

    ${baglam(K.arma, K.kurucu, 'KOR-1')}
    insert into ofis.calismalar (id, sirket_id, gorev_id, ajan_kod, kart_surum_id, tetik, model)
      values ('${K.calismaA}', '${K.arma}', '${K.gorevA}', 'KOR-1', '${K.kartKor}', 'talep', 'test-model');
    insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum)
      values ('${K.arma}', '${K.calismaA}', 1, '${ARAC.okuma}', 'tamam');
    insert into ofis.dosyalar (sirket_id, calisma_id, ad, mime_turu, boyut_bayt, depolama_yolu)
      values ('${K.arma}', '${K.calismaA}', 'rapor.pdf', 'application/pdf', 10, '${K.arma}/rapor.pdf');
    insert into ofis.onaylar (id, sirket_id, calisma_id, gorev_id, ajan_kod, baslik, icerik,
        dayanak_turu, dayanak_id, dayanak_surumu)
      values ('${K.onayA}', '${K.arma}', '${K.calismaA}', '${K.gorevA}', 'KOR-1', 'Not değişikliği',
        '{}', 'not', '${K.notA}', 1);
    insert into ofis.onaylar (id, sirket_id, calisma_id, ajan_kod, baslik, icerik, arac_ad)
      values ('${K.onayAOnayli}', '${K.arma}', '${K.calismaA}', 'KOR-1', 'E-posta', '{}', '${ARAC.disEtki}');

    ${baglam(K.arma, K.kurucu, 'KOR-1', K.projeA)}
    insert into ofis.calismalar (id, sirket_id, gorev_id, ajan_kod, kart_surum_id, tetik, model)
      values ('${K.calismaAProje}', '${K.arma}', '${K.gorevAProje}', 'KOR-1', '${K.kartKor}', 'talep', 'test-model');
    insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum)
      values ('${K.arma}', '${K.calismaAProje}', 1, '${ARAC.okuma}', 'tamam');
    insert into ofis.onaylar (id, sirket_id, calisma_id, gorev_id, ajan_kod, baslik, icerik)
      values ('${K.onayAProje}', '${K.arma}', '${K.calismaAProje}', '${K.gorevAProje}', 'KOR-1',
        'Proje çıktısı', '{}');

    ${baglam(K.pillika, K.kurucu, 'KOR-1')}
    insert into ofis.calismalar (id, sirket_id, gorev_id, ajan_kod, kart_surum_id, tetik, model)
      values ('${K.calismaP}', '${K.pillika}', '${K.gorevP}', 'KOR-1', '${K.kartKor}', 'talep', 'test-model');
    insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum)
      values ('${K.pillika}', '${K.calismaP}', 1, '${ARAC.okuma}', 'tamam');
    insert into ofis.dosyalar (sirket_id, calisma_id, ad, mime_turu, boyut_bayt, depolama_yolu)
      values ('${K.pillika}', '${K.calismaP}', 'gorsel.png', 'image/png', 10, '${K.pillika}/gorsel.png');
    insert into ofis.onaylar (id, sirket_id, calisma_id, ajan_kod, baslik, icerik)
      values ('${K.onayP}', '${K.pillika}', '${K.calismaP}', 'KOR-1', 'Pillika çıktısı', '{}');
    insert into ofis.onaylar (id, sirket_id, calisma_id, ajan_kod, baslik, icerik)
      values ('${K.onayPOnayli}', '${K.pillika}', '${K.calismaP}', 'KOR-1', 'Pillika onaylı', '{}');

    ${baglam(K.arma, K.kurucu)}
    update ofis.onaylar set durum = 'onaylandi' where id = '${K.onayAOnayli}';
    insert into ofis.kritik_hatalar (sirket_id, onay_id, ajan_kod, gerekce, isaretleyen_kullanici_id)
      values ('${K.arma}', '${K.onayAOnayli}', 'KOR-1', 'Yanlış alıcı', '${K.kurucu}');

    ${baglam(K.pillika, K.kurucu)}
    update ofis.onaylar set durum = 'onaylandi' where id = '${K.onayPOnayli}';
    insert into ofis.kritik_hatalar (sirket_id, onay_id, ajan_kod, gerekce, isaretleyen_kullanici_id)
      values ('${K.pillika}', '${K.onayPOnayli}', 'KOR-1', 'Yanlış fiyat', '${K.kurucu}');
  `;
  await istemci.query(sql);
}
