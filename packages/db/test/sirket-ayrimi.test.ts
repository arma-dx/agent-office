import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BaglamGirdisi } from '../src/baglam.ts';
import { K } from './veri.ts';
import { deneme, havuzlariKapat, veritabaniYok, yonetici, yoneticiDenemesi } from './yardimci.ts';

// Şirket ayrımı ve görünürlük testleri (CLAUDE.md kural 2, 9, 12; PLAN Testler). Hepsi kısıtlı
// uygulama rolüyle koşar; tablo listesi veritabanından okunur, böylece yeni tablo kendiliğinden
// teste girer.

const GLOBAL = ['ajan_tanimlari', 'araclar', 'birimler', 'kart_surumleri'];
// Kimlik tabloları: kişi birden çok şirkete üye olabilir.
const SIRKET_ID_TASIMAYAN = ['kullanici_epostalari', 'kullanicilar', 'sirketler'];

function kisi(sirketId: string, kullaniciId: string, projeId: string | null = null): BaglamGirdisi {
  return { sirketId, kullaniciId, projeId };
}

function ajan(sirketId: string, ajanKod: string, projeId: string | null = null): BaglamGirdisi {
  // Kimlik kurucu: daraltmanın kimlikten bağımsız olduğunu gösterir.
  return { sirketId, kullaniciId: K.kurucu, ajanKod, projeId };
}

describe.skipIf(veritabaniYok)('şirket ayrımı', () => {
  let tablolar: string[] = [];
  let sirketTablolari: string[] = [];

  beforeAll(async () => {
    const satirlar = await yonetici<{ ad: string }>(
      `select table_name as ad from information_schema.tables
       where table_schema = 'ofis' and table_type = 'BASE TABLE' order by 1`,
    );
    tablolar = satirlar.map((s) => s.ad);
    sirketTablolari = tablolar.filter(
      (t) => !GLOBAL.includes(t) && !SIRKET_ID_TASIMAYAN.includes(t),
    );
  });

  afterAll(havuzlariKapat);

  it('şirket verisi tutan her tabloda sirket_id zorunlu, RLS açık ve zorunlu', async () => {
    const eksik = await yonetici<{ ad: string; neden: string }>(
      `select c.relname as ad,
              case when not (c.relrowsecurity and c.relforcerowsecurity) then 'rls'
                   else 'sirket_id' end as neden
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ofis' and c.relkind = 'r'
         and c.relname <> all ($1::text[])
         and (
           not (c.relrowsecurity and c.relforcerowsecurity)
           or (c.relname <> all ($2::text[]) and not exists (
             select 1 from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'sirket_id' and a.attnotnull
           ))
         )`,
      [GLOBAL, SIRKET_ID_TASIMAYAN],
    );
    expect(eksik).toEqual([]);
  });

  it('test verisinde her şirket tablosunda iki şirketin de satırı var', async () => {
    for (const tablo of sirketTablolari) {
      const satir = await yonetici<{ a: number; p: number }>(
        `select count(*) filter (where sirket_id = $1)::int as a,
                count(*) filter (where sirket_id = $2)::int as p
         from ofis.${tablo}`,
        [K.arma, K.pillika],
      );
      expect(satir[0]?.a, `${tablo}: Arma DX satırı yok`).toBeGreaterThan(0);
      expect(satir[0]?.p, `${tablo}: Pillika satırı yok`).toBeGreaterThan(0);
    }
  });

  it('bağlam yokken hiçbir satır okunamaz', async () => {
    await deneme(async (d) => {
      for (const tablo of tablolar.filter((t) => !GLOBAL.includes(t))) {
        expect(await d.say(tablo), tablo).toBe(0);
      }
      await d.baglam({});
      for (const tablo of tablolar.filter((t) => !GLOBAL.includes(t))) {
        expect(await d.say(tablo), tablo).toBe(0);
      }
    });
  });

  it('global tablolar okunur ama değiştirilemez', async () => {
    await deneme(async (d) => {
      for (const tablo of GLOBAL) {
        expect(await d.say(tablo), tablo).toBeGreaterThan(0);
      }
      expect((await d.hata(`insert into ofis.birimler (kod, ad) values ('YEN', 'Yeni')`)).kod).toBe(
        '42501',
      );
      expect((await d.hata(`update ofis.araclar set aciklama = 'x'`)).kod).toBe('42501');
      expect((await d.hata(`delete from ofis.kart_surumleri`)).kod).toBe('42501');
      expect((await d.hata(`update ofis.ajan_tanimlari set ad = 'x'`)).kod).toBe('42501');
    });
  });

  const pillikaBaglamlari: [string, BaglamGirdisi][] = [
    ['kurucu', kisi(K.pillika, K.kurucu)],
    ['çalışan', kisi(K.pillika, K.calisanP)],
    ['ajan', ajan(K.pillika, 'KOR-1')],
    ['projeli ajan', ajan(K.pillika, 'KOR-1', K.projeP)],
    ['dış kişi', kisi(K.pillika, K.disKisiP)],
  ];

  it.each(pillikaBaglamlari)(
    'bağlam Pillika iken (%s) Arma DX satırı okunamaz',
    async (_ad, baglam) => {
      await deneme(async (d) => {
        await d.baglam(baglam);
        for (const tablo of sirketTablolari) {
          // Tek istisna: kişi kendi üyeliklerini bütün şirketlerde görür (şirket seçici).
          const kosul =
            tablo === 'uyelikler' && !baglam.ajanKod
              ? 'sirket_id <> $1 and kullanici_id <> $2'
              : 'sirket_id <> $1 and $2::uuid is not null';
          expect(await d.say(tablo, kosul, [K.pillika, baglam.kullaniciId]), tablo).toBe(0);
        }
        if (baglam.ajanKod) {
          expect(await d.say('sirketler', 'id <> $1', [K.pillika])).toBe(0);
        }
      });
    },
  );

  it('bağlam Pillika iken kurucu ve ajan kendi şirketinin satırlarını görür', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.pillika, K.kurucu));
      for (const tablo of ['gorevler', 'notlar', 'projeler', 'calismalar', 'onaylar', 'iz_kaydi']) {
        expect(await d.say(tablo), tablo).toBeGreaterThan(0);
      }
      await d.baglam(ajan(K.pillika, 'KOR-1'));
      for (const tablo of ['gorevler', 'notlar', 'calismalar', 'onaylar', 'musteriler']) {
        expect(await d.say(tablo), tablo).toBeGreaterThan(0);
      }
    });
  });

  it.each(pillikaBaglamlari)(
    'bağlam Pillika iken (%s) Arma DX satırı değiştirilemez ve silinemez',
    async (_ad, baglam) => {
      await deneme(async (d) => {
        await d.baglam(baglam);
        for (const tablo of sirketTablolari) {
          for (const sql of [
            `update ofis.${tablo} set sirket_id = sirket_id where sirket_id = $1`,
            `delete from ofis.${tablo} where sirket_id = $1`,
          ]) {
            await d.istemci.query('savepoint s');
            try {
              expect(await d.calistir(sql, [K.arma]), `${tablo}: ${sql}`).toBe(0);
              await d.istemci.query('release savepoint s');
            } catch (hata) {
              await d.istemci.query('rollback to savepoint s');
              // Yetkisi hiç olmayan işlem de kabul: satır kuralına gelmeden reddedilir.
              expect((hata as { code?: string }).code, `${tablo}: ${sql}`).toBe('42501');
            }
          }
        }
      });
    },
  );

  it('bağlam Pillika iken Arma DX adına satır yazılamaz', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.pillika, K.kurucu));
      const sorgular = [
        `insert into ofis.gorevler (sirket_id, baslik) values ('${K.arma}', 'x')`,
        `insert into ofis.notlar (sirket_id, baslik) values ('${K.arma}', 'x')`,
        `insert into ofis.musteriler (sirket_id, ad) values ('${K.arma}', 'x')`,
        `insert into ofis.iz_kaydi (sirket_id, olay) values ('${K.arma}', 'deneme')`,
        `insert into ofis.uyelikler (sirket_id, kullanici_id, rol) values ('${K.arma}', '${K.calisanP}', 'calisan')`,
      ];
      for (const sql of sorgular) {
        expect((await d.hata(sql)).kod, sql).toBe('42501');
      }
    });
  });

  it('bir şirketin kaydı öteki şirketin kaydına bağlanamaz', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(
        (
          await d.hata(
            `insert into ofis.gorevler (sirket_id, proje_id, baslik) values ($1, $2, 'x')`,
            [K.arma, K.projeP],
          )
        ).kod,
      ).toBe('23503');
      expect(
        (
          await d.hata(
            `insert into ofis.projeler (sirket_id, musteri_id, ad) values ($1, $2, 'x')`,
            [K.arma, K.musteriP],
          )
        ).kod,
      ).toBe('23503');
      expect(
        (
          await d.hata(
            `insert into ofis.proje_uyeleri (sirket_id, proje_id, kullanici_id) values ($1, $2, $3)`,
            [K.arma, K.projeA, K.calisanP],
          )
        ).kod,
      ).toBe('23503');
    });
  });

  it('proje kapsamlı satır proje dışından okunamaz', async () => {
    await deneme(async (d) => {
      // yetkiliA Arma DX çalışanı, hiçbir projenin üyesi değil.
      await d.baglam(kisi(K.arma, K.yetkiliA));
      expect(await d.say('gorevler', 'id = $1', [K.gorevA])).toBe(1);
      expect(await d.say('gorevler', 'proje_id is not null')).toBe(0);
      expect(await d.say('projeler')).toBe(0);
      expect(await d.say('notlar', 'id = $1', [K.notAProje])).toBe(0);
      expect(await d.say('not_surumleri', 'not_id = $1', [K.notAProje])).toBe(0);
      expect(await d.say('calismalar', 'id = $1', [K.calismaAProje])).toBe(0);
      expect(await d.say('arac_cagrilari', 'calisma_id = $1', [K.calismaAProje])).toBe(0);
      expect(await d.say('onaylar', 'id = $1', [K.onayAProje])).toBe(0);
      expect(await d.say('gorev_yorumlari', 'gorev_id = $1', [K.gorevAProje])).toBe(0);

      // calisanA projeA'nın üyesi.
      await d.baglam(kisi(K.arma, K.calisanA));
      expect(await d.say('gorevler', 'id = $1', [K.gorevAProje])).toBe(1);
      expect(await d.say('projeler', 'id = $1', [K.projeA])).toBe(1);
      expect(await d.say('notlar', 'id = $1', [K.notAProje])).toBe(1);
      expect(await d.say('onaylar', 'id = $1', [K.onayAProje])).toBe(1);
      expect(await d.say('projeler', 'id = $1', [K.projeAMusteriIzinsiz])).toBe(0);

      // Kurucu bütün projeleri görür.
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(await d.say('projeler')).toBe(3);
      expect(await d.say('gorevler', 'proje_id is not null')).toBe(2);
    });
  });

  it('proje bağlamı olmayan ajan çalışması proje satırı okuyamaz, kimliği kurucu olsa bile', async () => {
    await deneme(async (d) => {
      await d.baglam(ajan(K.arma, 'KOR-1'));
      expect(await d.say('gorevler', 'id = $1', [K.gorevA])).toBe(1);
      for (const tablo of ['gorevler', 'notlar', 'calismalar', 'onaylar', 'gorev_yorumlari']) {
        expect(await d.say(tablo, 'proje_id is not null'), tablo).toBe(0);
      }
      expect(await d.say('projeler')).toBe(0);
      expect(await d.say('not_surumleri', 'not_id = $1', [K.notAProje])).toBe(0);
    });
  });

  it('proje bağlamı olan ajan çalışması yalnızca kendi projesinin satırlarını görür', async () => {
    await deneme(async (d) => {
      await d.baglam(ajan(K.arma, 'KOR-1', K.projeA));
      expect(await d.say('projeler')).toBe(1);
      expect(await d.say('gorevler', 'proje_id is not null')).toBe(1);
      expect(await d.say('gorevler', 'id = $1', [K.gorevAProje])).toBe(1);
      expect(await d.say('gorevler', 'id = $1', [K.gorevA])).toBe(1);
      expect(await d.say('gorevler', 'id = $1', [K.gorevAIzinsizProje])).toBe(0);
      expect(await d.say('notlar', 'id = $1', [K.notAProje])).toBe(1);
    });
  });

  it('ajan çalışması kimliğinin sınırını devralır', async () => {
    await deneme(async (d) => {
      // yetkiliA projeA'nın üyesi değil: onun adına koşan çalışma projeA bağlamında da proje satırı görmez.
      await d.baglam({
        sirketId: K.arma,
        kullaniciId: K.yetkiliA,
        ajanKod: 'KOR-1',
        projeId: K.projeA,
      });
      expect(await d.say('projeler')).toBe(0);
      expect(await d.say('gorevler', 'id = $1', [K.gorevAProje])).toBe(0);
      expect(await d.say('gorevler', 'id = $1', [K.gorevA])).toBe(1);
      // calisanA üye: görür.
      await d.baglam({
        sirketId: K.arma,
        kullaniciId: K.calisanA,
        ajanKod: 'KOR-1',
        projeId: K.projeA,
      });
      expect(await d.say('gorevler', 'id = $1', [K.gorevAProje])).toBe(1);
      // Dış kişi kimliğiyle koşan çalışma hiçbir şey görmez.
      await d.baglam({ sirketId: K.arma, kullaniciId: K.disKisiA, ajanKod: 'KOR-1' });
      for (const tablo of [
        'gorevler',
        'notlar',
        'musteriler',
        'entegrasyonlar',
        'sirket_ajanlari',
      ]) {
        expect(await d.say(tablo), tablo).toBe(0);
      }
    });
  });

  it('kaydın proje kapsamı sonradan değiştirilemez', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(
        (await d.hata('update ofis.gorevler set proje_id = $2 where id = $1', [K.gorevA, K.projeA]))
          .kod,
      ).toBe('23514');
      expect(
        (await d.hata('update ofis.notlar set proje_id = $2 where id = $1', [K.notA, K.projeA]))
          .kod,
      ).toBe('42501');
      expect(
        (
          await d.hata('update ofis.belgeler set proje_id = $2 where sirket_id = $1', [
            K.arma,
            K.projeA,
          ])
        ).kod,
      ).toBe('23514');
      expect(
        (
          await d.hata('update ofis.belgeler set kaynak_not_id = $2 where sirket_id = $1', [
            K.arma,
            K.notAProje,
          ])
        ).kod,
      ).toBe('23514');
    });
  });

  it('müşterinin AI iznini yalnızca kurucu açar', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.calisanA));
      expect(
        (
          await d.hata('update ofis.musteriler set ai_izni = true where id = $1', [
            K.musteriAIzinsiz,
          ])
        ).kod,
      ).toBe('42501');
      expect(
        (
          await d.hata('update ofis.musteriler set otomatik_isleme_izni = true where id = $1', [
            K.musteriA,
          ])
        ).kod,
      ).toBe('42501');
      expect(
        (
          await d.hata(
            `insert into ofis.musteriler (sirket_id, ad, ai_izni) values ($1, 'Yeni', true)`,
            [K.arma],
          )
        ).kod,
      ).toBe('42501');
      expect(
        await d.calistir('update ofis.musteriler set ad = $2 where id = $1', [
          K.musteriA,
          'Yeni ad',
        ]),
      ).toBe(1);
      await d.baglam(ajan(K.arma, 'KOR-1'));
      expect(
        (await d.hata('update ofis.musteriler set ai_izni = false where id = $1', [K.musteriA]))
          .kod,
      ).toBe('42501');
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(
        await d.calistir('update ofis.musteriler set ai_izni = true where id = $1', [
          K.musteriAIzinsiz,
        ]),
      ).toBe(1);
    });
  });

  it('AI izni olmayan projenin ve müşterinin kayıtları ajan bağlamına kapalı', async () => {
    await deneme(async (d) => {
      // İzinsiz projenin bağlamıyla bile proje ve satırları görünmez; çalışma açılamaz.
      await d.baglam(ajan(K.arma, 'KOR-1', K.projeAIzinsiz));
      expect(await d.say('projeler')).toBe(0);
      expect(await d.say('gorevler', 'id = $1', [K.gorevAIzinsizProje])).toBe(0);
      expect(
        (
          await d.hata(
            `insert into ofis.calismalar (sirket_id, ajan_kod, kart_surum_id, tetik, model)
             values ($1, 'KOR-1', $2, 'talep', 'test-model')`,
            [K.arma, K.kartKor],
          )
        ).kod,
      ).toBe('42501');

      // Proje izinli ama müşterisi izinsizse de kapalı.
      await d.baglam(ajan(K.arma, 'KOR-1', K.projeAMusteriIzinsiz));
      expect(await d.say('projeler')).toBe(0);

      // İzinsiz müşteri ve fırsatı ajan bağlamında okunamaz; kişi okur.
      await d.baglam(ajan(K.arma, 'KOR-1'));
      expect(await d.say('musteriler', 'id = $1', [K.musteriAIzinsiz])).toBe(0);
      expect(await d.say('musteriler', 'id = $1', [K.musteriA])).toBe(1);
      expect(await d.say('firsatlar', 'musteri_id = $1', [K.musteriAIzinsiz])).toBe(0);
      await d.baglam(kisi(K.arma, K.calisanA));
      expect(await d.say('musteriler', 'id = $1', [K.musteriAIzinsiz])).toBe(1);
      expect(await d.say('firsatlar', 'musteri_id = $1', [K.musteriAIzinsiz])).toBe(1);
    });
  });

  it('kullanıcı yalnızca kendi kaydını, üyeliklerini ve şirketlerini görür', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.calisanA));
      expect(await d.satirlar('select kullanici_id from ofis.uyelikler')).toEqual([
        { kullanici_id: K.calisanA },
      ]);
      expect(await d.satirlar('select id from ofis.kullanicilar')).toEqual([{ id: K.calisanA }]);
      expect(await d.satirlar('select id from ofis.sirketler')).toEqual([{ id: K.arma }]);

      expect(await d.satirlar('select eposta from ofis.kullanici_epostalari')).toEqual([
        { eposta: 'calisan.a@ornek.test' },
      ]);

      // Kurucu kendi şirketinin üyelerini görür, öteki şirketin üyelerini görmez.
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(await d.say('uyelikler', 'sirket_id = $1', [K.arma])).toBe(5);
      expect(await d.say('uyelikler', 'kullanici_id = $1', [K.calisanP])).toBe(0);
      expect(await d.say('kullanicilar', 'id = $1', [K.calisanP])).toBe(0);
      expect(await d.say('kullanici_epostalari', 'kullanici_id = $1', [K.calisanP])).toBe(0);
      expect(await d.say('kullanici_epostalari', 'kullanici_id = $1', [K.calisanA])).toBe(1);
      expect(await d.say('sirketler')).toBe(3);
      // Ortak çalışanın başka şirketteki üyeliği görünmez.
      expect(await d.say('uyelikler', 'kullanici_id = $1', [K.ortakCalisan])).toBe(1);

      // Girişte yalnızca doğrulanmış e-postanın kaydı bulunur; büyük harf fark etmez.
      await d.baglam({ eposta: 'Calisan.A@ornek.test' });
      expect(await d.satirlar('select id from ofis.kullanicilar')).toEqual([{ id: K.calisanA }]);
      expect(await d.say('kullanici_epostalari')).toBe(1);
      expect(await d.say('uyelikler')).toBe(0);
      await d.baglam({ eposta: 'yok@ornek.test' });
      expect(await d.say('kullanicilar')).toBe(0);
    });
  });

  it('bir kişi birden çok e-postayla aynı kullanıcı olarak bulunur', async () => {
    await deneme(async (d) => {
      for (const eposta of ['kurucu@arma.test', 'KURUCU@pillika.test']) {
        await d.baglam({ eposta });
        expect(await d.satirlar('select id from ofis.kullanicilar')).toEqual([{ id: K.kurucu }]);
        // Girişte yalnızca o adres görünür, kişinin öteki adresleri görünmez.
        expect(await d.say('kullanici_epostalari')).toBe(1);
      }
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(await d.say('kullanici_epostalari', 'kullanici_id = $1', [K.kurucu])).toBe(2);
      // Ajan çalışması e-posta görmez.
      await d.baglam(ajan(K.arma, 'KOR-1'));
      expect(await d.say('kullanici_epostalari')).toBe(0);
    });
  });

  it('uygulama kimlik kaydı açamaz ve e-posta yazamaz', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.kurucu));
      expect((await d.hata(`insert into ofis.kullanicilar (ad) values ('Yeni Kişi')`)).kod).toBe(
        '42501',
      );
      expect(
        (
          await d.hata(
            'insert into ofis.kullanici_epostalari (eposta, kullanici_id) values ($1, $2)',
            ['yeni.a@ornek.test', K.calisanA],
          )
        ).kod,
      ).toBe('42501');
      expect((await d.hata('delete from ofis.kullanici_epostalari')).kod).toBe('42501');
      expect(
        (await d.hata(`update ofis.kullanici_epostalari set eposta = 'x@ornek.test'`)).kod,
      ).toBe('42501');
    });
  });

  it('hesabı yalnızca, hesabın erişebildiği her şirkette kurucu olan kişi yönetir', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(
        await d.calistir(`update ofis.kullanicilar set ad = 'Çalışan A2' where id = $1`, [
          K.calisanA,
        ]),
      ).toBe(1);
      expect(
        await d.calistir('update ofis.kullanicilar set aktif = false where id = $1', [K.calisanA]),
      ).toBe(1);
      // Başka şirkete de erişen ve hiçbir şirkete üye olmayan hesap yönetilemez.
      expect(
        await d.calistir('update ofis.kullanicilar set aktif = false where id = $1', [
          K.ortakCalisan,
        ]),
      ).toBe(0);
      expect(
        await d.calistir(`update ofis.kullanicilar set ad = 'x' where id = $1`, [K.eskiCalisan]),
      ).toBe(0);
      // WHERE'siz toplu güncelleme de yalnızca yönetilen hesaplara ve kişinin kendisine ulaşır.
      expect(await d.calistir('update ofis.kullanicilar set ad = ad')).toBe(4);

      await d.baglam(kisi(K.baska, K.yabanciKurucu));
      expect(await d.calistir('update ofis.kullanicilar set aktif = aktif, ad = ad')).toBe(1);
      expect(
        await d.calistir('update ofis.kullanicilar set aktif = false where id <> $1', [
          K.yabanciKurucu,
        ]),
      ).toBe(0);

      // Kişi kendi adını değiştirir, hesabını kapatamaz.
      await d.baglam(kisi(K.arma, K.yetkiliA));
      expect(
        await d.calistir(`update ofis.kullanicilar set ad = 'Yeni Ad' where id = $1`, [K.yetkiliA]),
      ).toBe(1);
      expect(
        (await d.hata('update ofis.kullanicilar set aktif = false where id = $1', [K.yetkiliA]))
          .kod,
      ).toBe('42501');
      expect(
        await d.calistir(`update ofis.kullanicilar set ad = 'x' where id = $1`, [K.calisanA]),
      ).toBe(0);

      // Ajan çalışması yalnızca kimliğin kaydını okur, değiştiremez.
      await d.baglam(ajan(K.arma, 'KOR-1'));
      expect(await d.satirlar('select id from ofis.kullanicilar')).toEqual([{ id: K.kurucu }]);
      expect(await d.calistir(`update ofis.kullanicilar set ad = 'x'`)).toBe(0);
    });
  });

  it('e-posta küçük harfle ve geçerli biçimde tutulur', async () => {
    await yoneticiDenemesi(async (d) => {
      for (const eposta of ['Buyuk@Ornek.test', 'bosluk @ornek.test', 'adsiz', 'iki@@ornek.test']) {
        expect(
          (
            await d.hata(
              'insert into ofis.kullanici_epostalari (eposta, kullanici_id) values ($1, $2)',
              [eposta, K.eskiCalisan],
            )
          ).kod,
          eposta,
        ).toBe('23514');
      }
    });
  });

  it('kullanıcı başkasının üyeliğini değiştiremez; üyeliği yalnızca kurucu yönetir', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.yetkiliA));
      expect(
        await d.calistir(`update ofis.uyelikler set onay_yetkisi = true where kullanici_id = $1`, [
          K.calisanA,
        ]),
      ).toBe(0);
      expect(
        await d.calistir(`update ofis.uyelikler set rol = 'kurucu' where kullanici_id = $1`, [
          K.yetkiliA,
        ]),
      ).toBe(0);
      await d.baglam(ajan(K.arma, 'KOR-1'));
      expect(await d.calistir(`update ofis.uyelikler set onay_yetkisi = true`)).toBe(0);
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(
        await d.calistir(`update ofis.uyelikler set onay_yetkisi = true where kullanici_id = $1`, [
          K.calisanA,
        ]),
      ).toBe(1);
    });
  });

  it('dış kişi yalnızca kendisine açılan görev ve notları görür', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.arma, K.disKisiA));
      expect(await d.satirlar('select id from ofis.gorevler')).toEqual([
        { id: K.gorevAPaylasilan },
      ]);
      expect(await d.satirlar('select id from ofis.notlar')).toEqual([{ id: K.notAPaylasilan }]);
      expect(await d.say('gorev_yorumlari')).toBe(1);
      expect(await d.say('not_surumleri', 'not_id <> $1', [K.notAPaylasilan])).toBe(0);
      for (const tablo of [
        'projeler',
        'musteriler',
        'calismalar',
        'onaylar',
        'belgeler',
        'dosyalar',
        'iz_kaydi',
        'sirket_ajanlari',
      ]) {
        expect(await d.say(tablo), tablo).toBe(0);
      }
      // Açılan göreve yorum yazar, ötekine yazamaz; görevi değiştiremez.
      await d.calistir(
        `insert into ofis.gorev_yorumlari (sirket_id, gorev_id, metin) values ($1, $2, 'Belge eklendi')`,
        [K.arma, K.gorevAPaylasilan],
      );
      expect(
        (
          await d.hata(
            `insert into ofis.gorev_yorumlari (sirket_id, gorev_id, metin) values ($1, $2, 'x')`,
            [K.arma, K.gorevA],
          )
        ).kod,
      ).toBe('23503');
      expect(
        await d.calistir(`update ofis.gorevler set baslik = 'x' where id = $1`, [
          K.gorevAPaylasilan,
        ]),
      ).toBe(0);
      expect(
        await d.calistir(`update ofis.notlar set govde = 'x' where id = $1`, [K.notAPaylasilan]),
      ).toBe(0);
      // Görevi dış kişiye atamak onu dış kişiye açmaz; açmayı kurucu paylaşımla yapar.
      await d.baglam(kisi(K.arma, K.calisanA));
      expect(
        await d.calistir('update ofis.gorevler set atanan_kullanici_id = $2 where id = $1', [
          K.gorevA,
          K.disKisiA,
        ]),
      ).toBe(1);
      await d.baglam(kisi(K.arma, K.disKisiA));
      expect(await d.say('gorevler', 'id = $1', [K.gorevA])).toBe(0);
      // Şirkete üye olmayan kişiye görev atanamaz.
      await d.baglam(kisi(K.arma, K.kurucu));
      expect(
        (
          await d.hata('update ofis.gorevler set atanan_kullanici_id = $2 where id = $1', [
            K.gorevA,
            K.calisanP,
          ])
        ).kod,
      ).toBe('23503');
    });
  });

  it('kurucu alanına yalnızca kurucu üye olur ve erişir', async () => {
    await deneme(async (d) => {
      await d.baglam(kisi(K.kurucuAlani, K.kurucu));
      expect(await d.say('gorevler')).toBe(1);
      expect(
        (
          await d.hata(
            `insert into ofis.uyelikler (sirket_id, kullanici_id, rol) values ($1, $2, 'calisan')`,
            [K.kurucuAlani, K.calisanA],
          )
        ).kod,
      ).toBe('23514');
      await d.baglam(kisi(K.kurucuAlani, K.calisanA));
      expect(await d.say('gorevler')).toBe(0);
      expect(await d.say('sirketler', 'id = $1', [K.kurucuAlani])).toBe(0);
    });
  });

  it('uygulama rolü BYPASSRLS yetkisi olmayan kısıtlı bir roldür', async () => {
    await deneme(async (d) => {
      const [rol] = await d.satirlar<{ superuser: boolean; bypass: boolean; uygulama: boolean }>(
        `select r.rolsuper as superuser, r.rolbypassrls as bypass,
                pg_has_role(current_user, 'ofis_uygulama', 'member') as uygulama
         from pg_roles r where r.rolname = current_user`,
      );
      expect(rol).toEqual({ superuser: false, bypass: false, uygulama: true });
      const yetkili = await d.satirlar(
        `select rolname from pg_roles
         where rolname in ('ofis_uygulama', 'ofis_yetki_okuyucu', 'ofis_tetikleyici', 'ofis_kuyruk')
           and (rolbypassrls or rolsuper or rolcanlogin)`,
      );
      expect(yetkili).toEqual([]);
      // API ve worker'ın giriş rolleri: kısıtlı, uygulama rolünün yetkilerini devralır.
      const girisRolleri = await d.satirlar(
        `select r.rolname as ad, r.rolcanlogin as giris, r.rolsuper or r.rolbypassrls as yetkili,
                r.rolcreaterole or r.rolcreatedb as yonetici,
                pg_has_role(r.rolname, 'ofis_uygulama', 'usage') as devralir
         from pg_roles r where r.rolname in ('ofis_api', 'ofis_worker') order by 1`,
      );
      expect(girisRolleri).toEqual([
        { ad: 'ofis_api', giris: true, yetkili: false, yonetici: false, devralir: true },
        { ad: 'ofis_worker', giris: true, yetkili: false, yonetici: false, devralir: true },
      ]);
    });
  });
});
