import { afterAll, describe, expect, it } from 'vitest';
import type { BaglamGirdisi } from '../src/baglam.ts';
import { ARAC, K } from './veri.ts';
import {
  deneme,
  havuzlariKapat,
  veritabaniYok,
  yoneticiDenemesi,
  type Deneme,
} from './yardimci.ts';

// Veritabanının kendisinin uyguladığı iş kuralları: onay, not, çalışma, görev, iz kaydı.
// Kurallar CLAUDE.md kural 4, 5, 9 ve 2 Ekim kararları 7-13'ten.

const kurucuA: BaglamGirdisi = { sirketId: K.arma, kullaniciId: K.kurucu };
const calisanA: BaglamGirdisi = { sirketId: K.arma, kullaniciId: K.calisanA };
const yetkiliA: BaglamGirdisi = { sirketId: K.arma, kullaniciId: K.yetkiliA };
const korA: BaglamGirdisi = { sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'KOR-1' };

async function onayAc(d: Deneme, alanlar: Record<string, unknown> = {}): Promise<string> {
  const tum: Record<string, unknown> = {
    sirket_id: K.arma,
    calisma_id: K.calismaA,
    ajan_kod: 'KOR-1',
    baslik: 'Deneme',
    icerik: {},
    ...alanlar,
  };
  const adlar = Object.keys(tum);
  const [satir] = await d.satirlar<{ id: string }>(
    `insert into ofis.onaylar (${adlar.join(', ')})
     values (${adlar.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
    Object.values(tum),
  );
  if (!satir) {
    throw new Error('Onay açılamadı');
  }
  return satir.id;
}

describe.skipIf(veritabaniYok)('onay kuralları', () => {
  afterAll(havuzlariKapat);

  it('onayı yalnızca ajan açar; kişi açamaz', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      expect(
        (
          await d.hata(
            `insert into ofis.onaylar (sirket_id, calisma_id, ajan_kod, baslik, icerik) values ($1, $2, 'KOR-1', 'x', '{}')`,
            [K.arma, K.calismaA],
          )
        ).kod,
      ).toBe('42501');
    });
  });

  it('ajan karar veremez; onay yetkisi olmayan çalışan karar veremez; yetkili çalışan verir', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      expect(
        (await d.hata(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [K.onayA])).kod,
      ).toBe('42501');
      await d.baglam(calisanA);
      expect(
        (await d.hata(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [K.onayA])).kod,
      ).toBe('42501');
      await d.baglam(yetkiliA);
      expect(
        await d.calistir(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [K.onayA]),
      ).toBe(1);
      const [onay] = await d.satirlar(
        'select karar_veren_kullanici_id, karar_zamani is not null as zaman from ofis.onaylar where id = $1',
        [K.onayA],
      );
      expect(onay).toEqual({ karar_veren_kullanici_id: K.yetkiliA, zaman: true });
    });
  });

  it('ret ve düzeltme nedeni sabit listeden zorunlu; karar verilen onay değişmez', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      expect(
        (await d.hata(`update ofis.onaylar set durum = 'reddedildi' where id = $1`, [K.onayA])).kod,
      ).toBe('23514');
      expect(
        (
          await d.hata(
            `update ofis.onaylar set durum = 'reddedildi', ret_nedeni = 'begenmedim' where id = $1`,
            [K.onayA],
          )
        ).kod,
      ).toBe('23514');
      await d.calistir(
        `update ofis.onaylar set durum = 'reddedildi', ret_nedeni = 'fiyat', karar_gerekcesi = 'Fiyat yüksek' where id = $1`,
        [K.onayA],
      );
      expect(
        (
          await d.hata(
            `update ofis.onaylar set durum = 'onaylandi', ret_nedeni = null where id = $1`,
            [K.onayA],
          )
        ).kod,
      ).toBe('23514');
      expect(
        (await d.hata(`update ofis.onaylar set karar_gerekcesi = 'başka' where id = $1`, [K.onayA]))
          .kod,
      ).toBe('23514');
    });
  });

  it('onayın içeriği açıldıktan sonra değiştirilemez ve onay elle kapatılamaz', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      expect(
        (await d.hata(`update ofis.onaylar set icerik = '{"x":1}' where id = $1`, [K.onayA])).kod,
      ).toBe('42501');
      expect(
        (await d.hata(`update ofis.onaylar set gecersiz_zamani = now() where id = $1`, [K.onayA]))
          .kod,
      ).toBe('42501');
      expect((await d.hata(`delete from ofis.onaylar where id = $1`, [K.onayA])).kod).toBe('42501');
    });
  });

  it('aynı kayıt için tek bekleyen onay olur', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const sonuc = await d.hata(
        `insert into ofis.onaylar (sirket_id, calisma_id, ajan_kod, baslik, icerik, dayanak_turu, dayanak_id, dayanak_surumu)
         values ($1, $2, 'KOR-1', 'İkinci', '{}', 'not', $3, 1)`,
        [K.arma, K.calismaA, K.notA],
      );
      expect(sonuc.kod).toBe('23505');
    });
  });

  it('dayandığı kayıt değişince bekleyen onay kapanır ve onaylanamaz; yeni sürüme yeni onay açılır', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.notlar set govde = 'Yeni içerik' where id = $1`, [K.notA]);
      const [onay] = await d.satirlar<{ kapali: boolean }>(
        'select gecersiz_zamani is not null as kapali from ofis.onaylar where id = $1',
        [K.onayA],
      );
      expect(onay?.kapali).toBe(true);
      expect(
        (await d.hata(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [K.onayA]))
          .ileti,
      ).toMatch(/değişti/);

      await d.baglam(korA);
      expect(
        (
          await d.hata(
            `insert into ofis.onaylar (sirket_id, calisma_id, ajan_kod, baslik, icerik, dayanak_turu, dayanak_id, dayanak_surumu) values ($1, $2, 'KOR-1', 'x', '{}', 'not', $3, 1)`,
            [K.arma, K.calismaA, K.notA],
          )
        ).ileti,
      ).toMatch(/güncel değil/);
      await onayAc(d, { dayanak_turu: 'not', dayanak_id: K.notA, dayanak_surumu: 2 });
    });
  });

  it('görevin durumu değişince onay kapanmaz, içeriği değişince kapanır', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const id = await onayAc(d, {
        gorev_id: K.gorevA,
        dayanak_turu: 'gorev',
        dayanak_id: K.gorevA,
        dayanak_surumu: 1,
      });
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.gorevler set durum = 'onay_bekliyor' where id = $1`, [
        K.gorevA,
      ]);
      expect(await d.say('onaylar', 'id = $1 and gecersiz_zamani is null', [id])).toBe(1);
      await d.calistir(`update ofis.gorevler set son_tarih = now() where id = $1`, [K.gorevA]);
      expect(await d.say('onaylar', 'id = $1 and gecersiz_zamani is not null', [id])).toBe(1);
    });
  });

  it('düzeltme istenen iş aynı ajana döner; ikinci düzeltmeden sonra iş insana düşer', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const ilk = await onayAc(d, { gorev_id: K.gorevA });
      await d.baglam(kurucuA);
      await d.calistir(
        `update ofis.onaylar set durum = 'duzeltme_istendi', ret_nedeni = 'eksik' where id = $1`,
        [ilk],
      );

      await d.baglam(korA);
      const ikinci = await onayAc(d, { gorev_id: K.gorevA, onceki_onay_id: ilk });
      expect(await d.satirlar('select deneme from ofis.onaylar where id = $1', [ikinci])).toEqual([
        { deneme: 2 },
      ]);
      // Bekleyen onay "önceki" olamaz.
      expect(
        (
          await d.hata(
            `insert into ofis.onaylar (sirket_id, calisma_id, ajan_kod, baslik, icerik, gorev_id, onceki_onay_id) values ($1, $2, 'KOR-1', 'x', '{}', $3, $4)`,
            [K.arma, K.calismaA, K.gorevA, ikinci],
          )
        ).kod,
      ).toBe('23514');

      await d.baglam(kurucuA);
      await d.calistir(
        `update ofis.onaylar set durum = 'duzeltme_istendi', ret_nedeni = 'dil_ve_ton' where id = $1`,
        [ikinci],
      );
      await d.baglam(korA);
      const ucuncu = await d.hata(
        `insert into ofis.onaylar (sirket_id, calisma_id, ajan_kod, baslik, icerik, gorev_id, onceki_onay_id) values ($1, $2, 'KOR-1', 'x', '{}', $3, $4)`,
        [K.arma, K.calismaA, K.gorevA, ikinci],
      );
      expect(ucuncu.ileti).toMatch(/insana düşer/);
    });
  });

  it('seçenekli onayda geçerli bir seçenek seçilir', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const id = await onayAc(d, { secenekler: JSON.stringify([{ kod: 'a' }, { kod: 'b' }]) });
      await d.baglam(kurucuA);
      expect(
        (await d.hata(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [id])).kod,
      ).toBe('23514');
      expect(
        (
          await d.hata(
            `update ofis.onaylar set durum = 'onaylandi', secilen_secenek = 'c' where id = $1`,
            [id],
          )
        ).kod,
      ).toBe('23514');
      expect(
        await d.calistir(
          `update ofis.onaylar set durum = 'onaylandi', secilen_secenek = 'b' where id = $1`,
          [id],
        ),
      ).toBe(1);
    });
  });

  it('gönderildi işaretini kişi, yalnızca onaylanmış işe bir kez koyar', async () => {
    await deneme(async (d) => {
      await d.baglam(calisanA);
      expect(
        (await d.hata(`update ofis.onaylar set gonderildi_zamani = now() where id = $1`, [K.onayA]))
          .kod,
      ).toBe('23514');
      await d.baglam(korA);
      expect(
        (
          await d.hata(`update ofis.onaylar set gonderildi_zamani = now() where id = $1`, [
            K.onayAOnayli,
          ])
        ).kod,
      ).toBe('42501');
      await d.baglam(calisanA);
      expect(
        await d.calistir(`update ofis.onaylar set gonderildi_zamani = now() where id = $1`, [
          K.onayAOnayli,
        ]),
      ).toBe(1);
      expect(
        await d.satirlar('select gonderildi_kullanici_id from ofis.onaylar where id = $1', [
          K.onayAOnayli,
        ]),
      ).toEqual([{ gonderildi_kullanici_id: K.calisanA }]);
      expect(
        (
          await d.hata(
            `update ofis.onaylar set gonderildi_zamani = now() + interval '1 hour' where id = $1`,
            [K.onayAOnayli],
          )
        ).kod,
      ).toBe('23514');
    });
  });

  it('dış etkili araç çağrısı onaylı onay olmadan açılamaz; onay bir kez kullanılır', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const ac = (sira: number, onay: string | null, durum = 'basladi') =>
        d.hata(
          `insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum, onay_id) values ($1, $2, $3, $4, $5, $6)`,
          [K.arma, K.calismaA, sira, ARAC.disEtki, durum, onay],
        );
      expect((await ac(10, null)).kod).toBe('42501');
      expect((await ac(11, K.onayA)).kod).toBe('42501');
      expect((await ac(12, null, 'tamam')).kod).toBe('42501');
      // Onaya gönderilen çağrı kaydı onaysız açılır.
      await d.calistir(
        `insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum, onay_id) values ($1, $2, 13, $3, 'onaya_gonderildi', $4)`,
        [K.arma, K.calismaA, ARAC.disEtki, K.onayAOnayli],
      );
      expect(
        await d.calistir(
          `update ofis.arac_cagrilari set durum = 'basladi' where calisma_id = $1 and sira = 13`,
          [K.calismaA],
        ),
      ).toBe(1);
      expect((await ac(14, K.onayAOnayli)).kod).toBe('23505');
    });
  });

  it('onay başka ajanın çağrısında kullanılamaz; biten çağrı yeniden başlatılamaz', async () => {
    await deneme(async (d) => {
      // HAF-1'i aç ve kendi çalışmasında KOR-1'in onayını kullanmayı dene.
      await d.baglam(kurucuA);
      await d.calistir(
        `update ofis.sirket_ajanlari set durum = 'acik' where sirket_id = $1 and ajan_kod = 'HAF-1'`,
        [K.arma],
      );
      await d.baglam({ sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'HAF-1' });
      const [calisma] = await d.satirlar<{ id: string }>(
        `insert into ofis.calismalar (sirket_id, ajan_kod, kart_surum_id, tetik, model) values ($1, 'HAF-1', $2, 'talep', 'test-model') returning id`,
        [K.arma, K.kartHaf],
      );
      expect(
        (
          await d.hata(
            `insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum, onay_id) values ($1, $2, 1, $3, 'basladi', $4)`,
            [K.arma, calisma?.id, ARAC.disEtki, K.onayAOnayli],
          )
        ).kod,
      ).toBe('42501');

      // KOR-1 onayı bir kez kullanır; hata sonrası aynı kayıt yeniden başlatılamaz.
      await d.baglam(korA);
      await d.calistir(
        `insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum, onay_id) values ($1, $2, 20, $3, 'basladi', $4)`,
        [K.arma, K.calismaA, ARAC.disEtki, K.onayAOnayli],
      );
      await d.calistir(
        `update ofis.arac_cagrilari set durum = 'hata' where calisma_id = $1 and sira = 20`,
        [K.calismaA],
      );
      expect(
        (
          await d.hata(
            `update ofis.arac_cagrilari set durum = 'basladi' where calisma_id = $1 and sira = 20`,
            [K.calismaA],
          )
        ).kod,
      ).toBe('23514');
      expect(
        (
          await d.hata(
            `update ofis.arac_cagrilari set durum = 'basladi' where calisma_id = $1 and sira = 1`,
            [K.calismaA],
          )
        ).kod,
      ).toBe('23514');
    });
  });

  it('onaydan sonra dayanağı değişen iş yürütülemez', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const id = await onayAc(d, {
        arac_ad: ARAC.disEtki,
        dayanak_turu: 'gorev',
        dayanak_id: K.gorevA,
        dayanak_surumu: 1,
      });
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [id]);
      await d.calistir(`update ofis.gorevler set aciklama = 'Değişti' where id = $1`, [K.gorevA]);
      await d.baglam(korA);
      expect(
        (
          await d.hata(
            `insert into ofis.arac_cagrilari (sirket_id, calisma_id, sira, arac_ad, durum, onay_id) values ($1, $2, 30, $3, 'basladi', $4)`,
            [K.arma, K.calismaA, ARAC.disEtki, id],
          )
        ).kod,
      ).toBe('42501');
    });
  });

  it('kritik hatayı yalnızca kurucu, onaylanmış işe gerekçeyle koyar', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const id = await onayAc(d);
      await d.baglam(kurucuA);
      const koy = (onay: string) =>
        d.hata(
          `insert into ofis.kritik_hatalar (sirket_id, onay_id, ajan_kod, gerekce, isaretleyen_kullanici_id) values ($1, $2, 'KOR-1', 'Yanlış', $3)`,
          [K.arma, onay, K.kurucu],
        );
      expect((await koy(id)).kod).toBe('23514');
      await d.calistir(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [id]);
      await d.baglam(yetkiliA);
      expect((await koy(id)).kod).toBe('42501');
      await d.baglam(kurucuA);
      await d.calistir(
        `insert into ofis.kritik_hatalar (sirket_id, onay_id, ajan_kod, gerekce, isaretleyen_kullanici_id) values ($1, $2, 'HAF-1', 'Yanlış', $3)`,
        [K.arma, id, K.calisanA],
      );
      // Ajan ve işaretleyen kayıttan ve bağlamdan gelir.
      expect(
        await d.satirlar(
          'select ajan_kod, isaretleyen_kullanici_id from ofis.kritik_hatalar where onay_id = $1',
          [id],
        ),
      ).toEqual([{ ajan_kod: 'KOR-1', isaretleyen_kullanici_id: K.kurucu }]);
    });
  });
});

describe.skipIf(veritabaniYok)('not kuralları', () => {
  afterAll(havuzlariKapat);

  it('ajanın taslak notunu onaya kadar yalnızca onay yetkilileri ve yazan ajan görür', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      const [taslak] = await d.satirlar<{ id: string; durum: string }>(
        `insert into ofis.notlar (sirket_id, baslik, govde) values ($1, 'Ajan Taslağı', 'Özet [[Genel Not]]') returning id, durum`,
        [K.arma],
      );
      expect(taslak?.durum).toBe('taslak');
      const id = taslak?.id;
      await d.calistir(
        `insert into ofis.belgeler (sirket_id, drive_dosya_id, ad, kaynak_not_id) values ($1, 'drive_taslak_belge', 'Taslak kaynak', $2)`,
        [K.arma, id],
      );
      // Taslağın onay kaydı taslağın metnini taşır.
      const onay = await onayAc(d, {
        baslik: 'Taslak not',
        icerik: { govde: 'Özet' },
        dayanak_turu: 'not',
        dayanak_id: id,
        dayanak_surumu: 1,
      });
      const gorur = async () => ({
        not: await d.say('notlar', 'id = $1', [id]),
        surum: await d.say('not_surumleri', 'not_id = $1', [id]),
        baglanti: await d.say('not_baglantilari', 'kaynak_not_id = $1', [id]),
        belge: await d.say('belgeler', 'kaynak_not_id = $1', [id]),
        onay: await d.say('onaylar', 'id = $1', [onay]),
      });
      const hepsi = { not: 1, surum: 1, baglanti: 1, belge: 1, onay: 1 };
      const hicbiri = { not: 0, surum: 0, baglanti: 0, belge: 0, onay: 0 };
      expect(await gorur()).toEqual(hepsi);

      // Ajan taslağı kendisi paylaşamaz.
      expect((await d.hata(`update ofis.notlar set durum = 'etkin' where id = $1`, [id])).kod).toBe(
        '42501',
      );

      // Onay yetkisi olmayan çalışan ve başka ajan göremez, değiştiremez.
      await d.baglam(calisanA);
      expect(await gorur()).toEqual(hicbiri);
      expect(await d.calistir(`update ofis.notlar set govde = 'x' where id = $1`, [id])).toBe(0);
      await d.baglam({ sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'HAF-1' });
      expect(await gorur()).toEqual(hicbiri);

      // Dış kişiye açılmış olsa da onaya kadar göremez.
      await d.baglam(kurucuA);
      await d.calistir(
        `insert into ofis.erisim_paylasimlari (sirket_id, kullanici_id, kayit_turu, kayit_id) values ($1, $2, 'not', $3)`,
        [K.arma, K.disKisiA, id],
      );
      await d.baglam({ sirketId: K.arma, kullaniciId: K.disKisiA });
      expect(await d.say('notlar', 'id = $1', [id])).toBe(0);

      // KOR-3 onay kuyruğunu özetler: onay kaydını görür, taslak notun kendisini görmez; adına
      // koştuğu kişi onay yetkili değilse onayı da görmez (3 Ekim, karar 3).
      await d.baglam({ sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'KOR-3' });
      expect(await gorur()).toEqual({ ...hicbiri, onay: 1 });
      await d.baglam({ sirketId: K.arma, kullaniciId: K.calisanA, ajanKod: 'KOR-3' });
      expect(await gorur()).toEqual(hicbiri);

      // Onay yetkilileri görür.
      await d.baglam(yetkiliA);
      expect(await gorur()).toEqual(hepsi);
      await d.baglam(kurucuA);
      expect(await gorur()).toEqual(hepsi);

      // Onaylanıp etkinleşince şirkette herkes görür.
      await d.calistir(`update ofis.onaylar set durum = 'onaylandi' where id = $1`, [onay]);
      await d.calistir(`update ofis.notlar set durum = 'etkin' where id = $1`, [id]);
      await d.baglam(calisanA);
      expect(await d.say('notlar', 'id = $1', [id])).toBe(1);
      expect(await d.say('onaylar', 'id = $1', [onay])).toBe(1);
      await d.baglam({ sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'HAF-1' });
      expect(await d.say('notlar', 'id = $1', [id])).toBe(1);
      await d.baglam({ sirketId: K.arma, kullaniciId: K.disKisiA });
      expect(await d.say('notlar', 'id = $1', [id])).toBe(1);
    });
  });

  it('ajan çalışması taslağı adına koştuğu kişinin sınırıyla görür', async () => {
    await deneme(async (d) => {
      // Kurucu adına yazılan taslak.
      await d.baglam(korA);
      const [kurucuTaslagi] = await d.satirlar<{ id: string }>(
        `insert into ofis.notlar (sirket_id, baslik) values ($1, 'Kurucu adına taslak') returning id`,
        [K.arma],
      );
      // Onay yetkisi olmayan çalışan adına koşan çalışma kendi taslağını açar ve görür, kurucu
      // adına yazılmış taslağı görmez.
      const calisanAdina = { sirketId: K.arma, kullaniciId: K.calisanA, ajanKod: 'KOR-1' };
      await d.baglam(calisanAdina);
      const [calisanTaslagi] = await d.satirlar<{ id: string; olusturan_kullanici_id: string }>(
        `insert into ofis.notlar (sirket_id, baslik) values ($1, 'Çalışan adına taslak') returning id, olusturan_kullanici_id`,
        [K.arma],
      );
      expect(calisanTaslagi?.olusturan_kullanici_id).toBe(K.calisanA);
      expect(await d.say('notlar', 'id = $1', [calisanTaslagi?.id])).toBe(1);
      expect(await d.say('notlar', 'id = $1', [kurucuTaslagi?.id])).toBe(0);
      // Onay yetkilisi adına koşan çalışma ikisini de görür; çalışan panelde ikisini de görmez.
      await d.baglam({ sirketId: K.arma, kullaniciId: K.yetkiliA, ajanKod: 'KOR-1' });
      expect(await d.say('notlar', 'id = any($1)', [[kurucuTaslagi?.id, calisanTaslagi?.id]])).toBe(
        2,
      );
      await d.baglam(calisanA);
      expect(await d.say('notlar', 'id = any($1)', [[kurucuTaslagi?.id, calisanTaslagi?.id]])).toBe(
        0,
      );
    });
  });

  it('kişinin taslak notu şirket içinde görünür kalır', async () => {
    await deneme(async (d) => {
      await d.baglam(calisanA);
      await d.calistir(
        `insert into ofis.notlar (sirket_id, baslik) values ($1, 'Çalışan Taslağı')`,
        [K.arma],
      );
      await d.baglam(yetkiliA);
      expect(await d.say('notlar', `baslik = 'Çalışan Taslağı' and durum = 'taslak'`)).toBe(1);
    });
  });

  it('tek doğru kaynak işaretini yalnızca kurucu koyar ve kaldırır', async () => {
    await deneme(async (d) => {
      await d.baglam(calisanA);
      expect(
        (await d.hata(`update ofis.notlar set tek_dogru_kaynak = true where id = $1`, [K.notA]))
          .kod,
      ).toBe('42501');
      expect(
        (
          await d.hata(
            `insert into ofis.notlar (sirket_id, baslik, tek_dogru_kaynak) values ($1, 'x', true)`,
            [K.arma],
          )
        ).kod,
      ).toBe('42501');
      await d.baglam(korA);
      expect(
        (await d.hata(`update ofis.notlar set tek_dogru_kaynak = false where id = $1`, [K.notATdk]))
          .kod,
      ).toBe('42501');
      await d.baglam(kurucuA);
      expect(
        await d.calistir(`update ofis.notlar set tek_dogru_kaynak = true where id = $1`, [K.notA]),
      ).toBe(1);
    });
  });

  it('ajan tek doğru kaynak notunu değiştiremez, notu arşivleyemez ve silemez', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      expect(
        (await d.hata(`update ofis.notlar set govde = 'x' where id = $1`, [K.notATdk])).kod,
      ).toBe('42501');
      expect(
        (await d.hata(`update ofis.notlar set durum = 'arsiv' where id = $1`, [K.notA])).kod,
      ).toBe('42501');
      expect((await d.hata(`delete from ofis.notlar where id = $1`, [K.notA])).kod).toBe('42501');
      expect(
        await d.calistir(`update ofis.notlar set govde = 'Ajan güncelledi' where id = $1`, [
          K.notA,
        ]),
      ).toBe(1);
      expect(
        await d.satirlar(
          'select guncelleyen_ajan_kod, guncelleyen_kullanici_id from ofis.notlar where id = $1',
          [K.notA],
        ),
      ).toEqual([{ guncelleyen_ajan_kod: 'KOR-1', guncelleyen_kullanici_id: null }]);
    });
  });

  it('dış kaynaklı not ve görevi ajan iç olarak işaretleyemez', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.notlar set kaynak_turu = 'dis' where id = $1`, [K.notA]);
      await d.calistir(`update ofis.gorevler set kaynak_turu = 'dis' where id = $1`, [K.gorevA]);
      await d.baglam(korA);
      expect(
        (await d.hata(`update ofis.notlar set kaynak_turu = 'ic' where id = $1`, [K.notA])).kod,
      ).toBe('42501');
      expect(
        (await d.hata(`update ofis.gorevler set kaynak_turu = 'ic' where id = $1`, [K.gorevA])).kod,
      ).toBe('42501');
    });
  });

  it('her değişiklik sürüm yazar; uygulama sürüm tablosuna yazamaz', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.notlar set govde = 'İkinci' where id = $1`, [K.notA]);
      await d.calistir(`update ofis.notlar set durum = 'etkin' where id = $1`, [K.notA]);
      expect(
        await d.satirlar(
          'select surum, govde from ofis.not_surumleri where not_id = $1 order by surum',
          [K.notA],
        ),
      ).toEqual([
        { surum: 1, govde: 'Bkz. [[Tek Doğru Kaynak]] ve [[Proje Notu|proje]].' },
        { surum: 2, govde: 'İkinci' },
      ]);
      expect(
        (
          await d.hata(
            `insert into ofis.not_surumleri (sirket_id, not_id, surum, klasor, baslik, ozellikler, govde, durum, tek_dogru_kaynak, kaynak_turu) values ($1, $2, 9, '', 'x', '{}', '', 'etkin', false, 'ic')`,
            [K.arma, K.notA],
          )
        ).kod,
      ).toBe('42501');
      expect((await d.hata(`delete from ofis.not_baglantilari`)).kod).toBe('42501');
    });
  });

  it('bağlantılar not kaydedilirken çıkarılır; geri bağlantı görünürlüğü izler', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      const hedefler = async () =>
        (
          await d.satirlar<{ hedef_ad: string }>(
            'select hedef_ad from ofis.not_baglantilari where kaynak_not_id = $1 order by hedef_ad collate "C"',
            [K.notA],
          )
        ).map((s) => s.hedef_ad);
      expect(await hedefler()).toEqual(['Proje Notu', 'Tek Doğru Kaynak']);
      await d.calistir(
        `update ofis.notlar set govde = '[[Yeni Not#Bölüm]] [[ Yeni Not ]] [[Başka|takma]]', ozellikler = '{"ilgili": "[[Özellikteki Not]]"}' where id = $1`,
        [K.notA],
      );
      expect(await hedefler()).toEqual(['Başka', 'Yeni Not', 'Özellikteki Not']);

      // Proje notundan çıkan bağlantı proje dışından görünmez.
      await d.calistir(`update ofis.notlar set govde = '[[Genel Not]]' where id = $1`, [
        K.notAProje,
      ]);
      expect(await d.say('not_baglantilari', 'kaynak_not_id = $1', [K.notAProje])).toBe(1);
      await d.baglam(yetkiliA);
      expect(await d.say('not_baglantilari', 'kaynak_not_id = $1', [K.notAProje])).toBe(0);
    });
  });

  it('notlarda Türkçe tam metin arama çalışır', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      const bul = async (sorgu: string) =>
        (
          await d.satirlar<{ id: string }>(
            `select id from ofis.notlar where arama @@ websearch_to_tsquery('turkish', $1) order by 1`,
            [sorgu],
          )
        ).map((s) => s.id);
      expect(await bul('kaynakları')).toContain(K.notATdk);
      expect(await bul('takvimi')).toEqual([K.notAPaylasilan]);
    });
  });
});

describe.skipIf(veritabaniYok)('çalışma, görev ve ajan kuralları', () => {
  afterAll(havuzlariKapat);

  const calismaAc = `insert into ofis.calismalar (sirket_id, ajan_kod, kart_surum_id, tetik, model, kullanici_id)
    values ($1, $2, $3, 'talep', 'test-model', $4) returning kullanici_id, etiket`;

  it('çalışmayı yalnızca kendi ajan bağlamı açar; kimlik bağlamdan gelir', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      expect((await d.hata(calismaAc, [K.arma, 'KOR-1', K.kartKor, K.kurucu])).kod).toBe('42501');
      await d.baglam(korA);
      expect((await d.hata(calismaAc, [K.arma, 'HAF-1', K.kartHaf, K.kurucu])).kod).toBe('42501');
      expect((await d.hata(calismaAc, [K.arma, 'KOR-1', K.kartHaf, K.kurucu])).kod).toBe('23503');
      expect(await d.satirlar(calismaAc, [K.arma, 'KOR-1', K.kartKor, K.calisanA])).toEqual([
        { kullanici_id: K.kurucu, etiket: 'ic_is' },
      ]);
    });
  });

  it('durdurulan ajan yeni iş almaz; ajan kartında olmayan şirkette açılamaz', async () => {
    await deneme(async (d) => {
      await d.baglam({ sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'HAF-1' });
      expect((await d.hata(calismaAc, [K.arma, 'HAF-1', K.kartHaf, K.kurucu])).ileti).toMatch(
        /açık değil/,
      );
      await d.baglam(kurucuA);
      expect(
        (
          await d.hata(
            `insert into ofis.sirket_ajanlari (sirket_id, ajan_kod) values ($1, 'P-IST-1')`,
            [K.arma],
          )
        ).kod,
      ).toBe('23514');
      // Ajanı yalnızca kurucu açar ya da durdurur.
      await d.baglam(calisanA);
      expect(
        await d.calistir(`update ofis.sirket_ajanlari set durum = 'acik' where ajan_kod = 'HAF-1'`),
      ).toBe(0);
      await d.baglam(kurucuA);
      expect(
        await d.calistir(
          `update ofis.sirket_ajanlari set durum = 'durduruldu' where ajan_kod = 'KOR-1'`,
        ),
      ).toBe(1);
      await d.baglam(korA);
      expect((await d.hata(calismaAc, [K.arma, 'KOR-1', K.kartKor, K.kurucu])).ileti).toMatch(
        /açık değil/,
      );
    });
  });

  it('ajan başka ajanın çalışmasını değiştiremez; kişi çalışma kaydını değiştiremez', async () => {
    await deneme(async (d) => {
      await d.baglam({ sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'HAF-1' });
      expect(
        await d.calistir(`update ofis.calismalar set durum = 'hata' where id = $1`, [K.calismaA]),
      ).toBe(0);
      await d.baglam(kurucuA);
      expect(
        await d.calistir(`update ofis.calismalar set durum = 'hata' where id = $1`, [K.calismaA]),
      ).toBe(0);
      expect((await d.hata(`delete from ofis.calismalar where id = $1`, [K.calismaA])).kod).toBe(
        '42501',
      );
      await d.baglam(korA);
      expect(
        await d.calistir(
          `update ofis.calismalar set durum = 'tamamlandi', bitis = baslama + interval '2 seconds', girdi_token = 10 where id = $1`,
          [K.calismaA],
        ),
      ).toBe(1);
      expect(
        await d.satirlar('select sure_ms from ofis.calismalar where id = $1', [K.calismaA]),
      ).toEqual([{ sure_ms: '2000' }]);
      expect(
        (
          await d.hata(`update ofis.calismalar set kullanici_id = $2 where id = $1`, [
            K.calismaA,
            K.calisanA,
          ])
        ).kod,
      ).toBe('23514');
    });
  });

  it('ham içerik süresi dolunca silinir, özet kalır', async () => {
    await yoneticiDenemesi(async (d) => {
      // Saklama süresini geçmişe çekmek için değişmez alan tetikleyicisi bu transaction'da kapatılır.
      await d.calistir(`alter table ofis.calismalar disable trigger degismez`);
      await d.calistir(`alter table ofis.arac_cagrilari disable trigger degismez`);
      await d.calistir(
        `update ofis.calismalar set girdi = '{"istem": "ham"}', ozet = 'Özet', ham_saklama_sonu = now() - interval '1 day' where id = $1`,
        [K.calismaA],
      );
      await d.calistir(
        `update ofis.arac_cagrilari set sonuc = '{"ham": true}', ham_saklama_sonu = now() - interval '1 day' where calisma_id = $1`,
        [K.calismaA],
      );
      await d.calistir(`alter table ofis.calismalar enable trigger degismez`);
      await d.calistir(`alter table ofis.arac_cagrilari enable trigger degismez`);
      expect(await d.satirlar('select ofis.ham_icerik_temizle() as n')).toEqual([{ n: 2 }]);
      expect(
        await d.satirlar(
          'select girdi, ozet, ham_silindi is not null as silindi from ofis.calismalar where id = $1',
          [K.calismaA],
        ),
      ).toEqual([{ girdi: null, ozet: 'Özet', silindi: true }]);
      expect(await d.say('arac_cagrilari', 'calisma_id = $1 and sonuc is null', [K.calismaA])).toBe(
        1,
      );
    });
    // Uygulama rolü temizliği çağırabilir; süresi dolmayan satıra dokunulmaz.
    await deneme(async (d) => {
      expect(await d.satirlar('select ofis.ham_icerik_temizle() as n')).toEqual([{ n: 0 }]);
    });
  });

  it('dış kaynaklı görev ajana atanamaz; insan atarsa iç olur', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.gorevler set kaynak_turu = 'dis' where id = $1`, [K.gorevA]);
      await d.baglam(korA);
      expect(
        (
          await d.hata(`update ofis.gorevler set atanan_ajan_kod = 'KOR-1' where id = $1`, [
            K.gorevA,
          ])
        ).kod,
      ).toBe('23514');
      await d.baglam(kurucuA);
      await d.calistir(`update ofis.gorevler set atanan_ajan_kod = 'KOR-1' where id = $1`, [
        K.gorevA,
      ]);
      expect(
        await d.satirlar('select kaynak_turu from ofis.gorevler where id = $1', [K.gorevA]),
      ).toEqual([{ kaynak_turu: 'ic' }]);
    });
  });

  it('görev silinmez; tamamlanma zamanı ve sürüm tetikleyiciyle tutulur', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      expect((await d.hata(`delete from ofis.gorevler where id = $1`, [K.gorevA])).kod).toBe(
        '42501',
      );
      await d.calistir(`update ofis.gorevler set durum = 'tamamlandi', surum = 50 where id = $1`, [
        K.gorevA,
      ]);
      expect(
        await d.satirlar(
          'select surum, tamamlanma is not null as bitti from ofis.gorevler where id = $1',
          [K.gorevA],
        ),
      ).toEqual([{ surum: 1, bitti: true }]);
      await d.calistir(
        `update ofis.gorevler set durum = 'suruyor', baslik = 'Yeni başlık' where id = $1`,
        [K.gorevA],
      );
      expect(
        await d.satirlar('select surum, tamamlanma from ofis.gorevler where id = $1', [K.gorevA]),
      ).toEqual([{ surum: 2, tamamlanma: null }]);
    });
  });

  it('yorumun yazarı bağlamdan gelir; yorum değiştirilemez', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      await d.calistir(
        `insert into ofis.gorev_yorumlari (sirket_id, gorev_id, metin, yazan_kullanici_id) values ($1, $2, 'Ajan sorusu', $3)`,
        [K.arma, K.gorevA, K.calisanA],
      );
      expect(
        await d.satirlar(
          `select yazan_ajan_kod, yazan_kullanici_id from ofis.gorev_yorumlari where metin = 'Ajan sorusu'`,
        ),
      ).toEqual([{ yazan_ajan_kod: 'KOR-1', yazan_kullanici_id: null }]);
      expect((await d.hata(`update ofis.gorev_yorumlari set metin = 'x'`)).kod).toBe('42501');
    });
  });

  it('bildirimi alıcı görür ve okur; başkası göremez', async () => {
    await deneme(async (d) => {
      await d.baglam(calisanA);
      expect(await d.say('bildirimler')).toBe(1);
      expect(await d.calistir(`update ofis.bildirimler set okunma = now()`)).toBe(1);
      await d.baglam(yetkiliA);
      expect(await d.say('bildirimler')).toBe(0);
      await d.baglam(korA);
      expect(await d.say('bildirimler')).toBe(1);
      await d.calistir(
        `insert into ofis.bildirimler (sirket_id, alici_kullanici_id, sablon) values ($1, $2, 'onay_bekliyor')`,
        [K.arma, K.kurucu],
      );
      expect(
        await d.satirlar(
          `select gonderen_ajan_kod from ofis.bildirimler where sablon = 'onay_bekliyor'`,
        ),
      ).toEqual([{ gonderen_ajan_kod: 'KOR-1' }]);
      // Şirkete üye olmayan kişiye bildirim yazılamaz.
      expect(
        (
          await d.hata(
            `insert into ofis.bildirimler (sirket_id, alici_kullanici_id, sablon) values ($1, $2, 'x')`,
            [K.arma, K.calisanP],
          )
        ).kod,
      ).toBe('23503');
    });
  });

  it('üretilen dosyanın yolu şirket kimliğiyle başlar', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      const ekle = (yol: string) =>
        d.hata(
          `insert into ofis.dosyalar (sirket_id, ad, mime_turu, boyut_bayt, depolama_yolu) values ($1, 'x', 'text/plain', 1, $2)`,
          [K.arma, yol],
        );
      expect((await ekle(`${K.pillika}/x.txt`)).kod).toBe('23514');
      expect((await ekle(`${K.arma}/../${K.pillika}/x.txt`)).kod).toBe('23514');
    });
  });
});

describe.skipIf(veritabaniYok)('iz kaydı', () => {
  afterAll(havuzlariKapat);

  it('iz_kaydi satırı değiştirilemez ve silinemez (uygulama rolü)', async () => {
    await deneme(async (d) => {
      await d.baglam(kurucuA);
      expect((await d.hata(`update ofis.iz_kaydi set olay = 'degisti'`)).kod).toBe('42501');
      expect((await d.hata(`delete from ofis.iz_kaydi`)).kod).toBe('42501');
      expect((await d.hata(`truncate ofis.iz_kaydi`)).kod).toBe('42501');
    });
  });

  it('iz_kaydi satırı yetkili rolle de değiştirilemez ve silinemez', async () => {
    await yoneticiDenemesi(async (d) => {
      expect((await d.hata(`update ofis.iz_kaydi set olay = 'degisti'`)).ileti).toMatch(
        /değiştirilemez/,
      );
      expect((await d.hata(`delete from ofis.iz_kaydi`)).ileti).toMatch(/değiştirilemez/);
      expect((await d.hata(`truncate ofis.iz_kaydi cascade`)).ileti).toMatch(/değiştirilemez/);
    });
  });

  it('kim ve ne zaman bağlamdan gelir; serbest metin yazılamaz; kaydı kurucu okur', async () => {
    await deneme(async (d) => {
      await d.baglam(korA);
      await d.calistir(
        `insert into ofis.iz_kaydi (sirket_id, olay, arac_ad, calisma_id, kullanici_id, dis_kimlik) values ($1, 'arac_cagrisi', $2, $3, $4, 'msg-18c2f3a9')`,
        [K.arma, ARAC.okuma, K.calismaA, K.calisanA],
      );
      expect(
        (
          await d.hata(
            `insert into ofis.iz_kaydi (sirket_id, olay, dis_kimlik) values ($1, 'arac_cagrisi', 'Ahmet Bey teklifi beğenmedi')`,
            [K.arma],
          )
        ).kod,
      ).toBe('23514');
      expect(await d.say('iz_kaydi')).toBe(0);
      await d.baglam(calisanA);
      expect(await d.say('iz_kaydi')).toBe(0);
      await d.baglam(kurucuA);
      expect(
        await d.satirlar(
          `select kullanici_id, ajan_kod from ofis.iz_kaydi where olay = 'arac_cagrisi'`,
        ),
      ).toEqual([{ kullanici_id: K.kurucu, ajan_kod: 'KOR-1' }]);
    });
  });
});
