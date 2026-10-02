import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ajanAdimi, baglamliIslem, baglamSemasi } from '../src/baglam.ts';
import { K } from './veri.ts';
import { veritabaniYok } from './yardimci.ts';
import { inject } from 'vitest';

describe('bağlam şeması', () => {
  it('geçersiz değeri ve bilinmeyen alanı reddeder', () => {
    expect(baglamSemasi.safeParse({ sirketId: 'pillika' }).success).toBe(false);
    expect(baglamSemasi.safeParse({ ajanKod: 'kor-1' }).success).toBe(false);
    expect(baglamSemasi.safeParse({ eposta: 'eposta-degil' }).success).toBe(false);
    expect(baglamSemasi.safeParse({ sirketKodu: 'pillika' }).success).toBe(false);
    expect(baglamSemasi.parse({})).toEqual({
      sirketId: null,
      kullaniciId: null,
      projeId: null,
      eposta: null,
      ajanKod: null,
    });
  });
});

describe.skipIf(veritabaniYok)('baglamliIslem', () => {
  // Tek bağlantılı havuz: bağlamın bağlantıda kalmadığını aynı bağlantı üzerinde görmek için.
  const havuz = new pg.Pool({ connectionString: inject('veritabani')?.uygulama, max: 1 });
  afterAll(() => havuz.end());

  async function gorevSayisi(): Promise<number> {
    const { rows } = await havuz.query<{ n: number }>(
      'select count(*)::int as n from ofis.gorevler',
    );
    return rows[0]?.n ?? -1;
  }

  it('bağlamı yalnızca transaction boyunca kurar', async () => {
    const icerde = await baglamliIslem(
      havuz,
      { sirketId: K.pillika, kullaniciId: K.kurucu },
      async (istemci) => {
        const { rows } = await istemci.query<{ n: number }>(
          'select count(*)::int as n from ofis.gorevler',
        );
        return rows[0]?.n;
      },
    );
    expect(icerde).toBe(2);
    expect(await gorevSayisi()).toBe(0);
    const { rows } = await havuz.query<{ s: string | null }>(
      "select current_setting('app.sirket_id', true) as s",
    );
    expect(rows[0]?.s ?? '').toBe('');
  });

  it('hata olursa yazılanı geri alır ve hatayı iletir', async () => {
    await expect(
      baglamliIslem(havuz, { sirketId: K.arma, kullaniciId: K.kurucu }, async (istemci) => {
        await istemci.query(
          `insert into ofis.gorevler (sirket_id, baslik) values ($1, 'Geri alınacak')`,
          [K.arma],
        );
        throw new Error('iş hatası');
      }),
    ).rejects.toThrow('iş hatası');
    const sayi = await baglamliIslem(
      havuz,
      { sirketId: K.arma, kullaniciId: K.kurucu },
      async (istemci) => {
        const { rows } = await istemci.query<{ n: number }>(
          `select count(*)::int as n from ofis.gorevler where baslik = 'Geri alınacak'`,
        );
        return rows[0]?.n;
      },
    );
    expect(sayi).toBe(0);
  });

  it('iş veritabanı hatasını yutsa da geri alınan transaction başarı sayılmaz', async () => {
    await expect(
      baglamliIslem(havuz, { sirketId: K.arma, kullaniciId: K.kurucu }, async (istemci) => {
        await istemci.query(
          `insert into ofis.gorevler (sirket_id, baslik) values ($1, 'Kaybolan')`,
          [K.arma],
        );
        await istemci.query('select 1 / 0').catch(() => undefined);
        return 'tamam';
      }),
    ).rejects.toThrow('geri alındı');
  });

  it('ajan adımı ajan kodunu, şirketi ve kimliği zorunlu tutar', async () => {
    await expect(
      ajanAdimi(havuz, { sirketId: K.arma, kullaniciId: K.kurucu } as never, () =>
        Promise.resolve(0),
      ),
    ).rejects.toThrow();
    const proje = await ajanAdimi(
      havuz,
      { sirketId: K.arma, kullaniciId: K.kurucu, ajanKod: 'KOR-1' },
      async (istemci) => {
        const { rows } = await istemci.query<{ n: number }>(
          'select count(*)::int as n from ofis.projeler',
        );
        return rows[0]?.n;
      },
    );
    expect(proje).toBe(0);
  });
});
