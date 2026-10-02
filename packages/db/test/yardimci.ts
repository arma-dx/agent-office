import pg from 'pg';
import { inject } from 'vitest';
import { baglamKur, type BaglamGirdisi } from '../src/baglam.ts';

const veritabani = inject('veritabani');

/** Veritabanı adresi yoksa (yerelde) veritabanı testleri atlanır. */
export const veritabaniYok = veritabani === null;

function adres(tur: 'uygulama' | 'yonetici'): string {
  if (!veritabani) {
    throw new Error('Test veritabanı yok');
  }
  return veritabani[tur];
}

let uygulamaHavuzu: pg.Pool | undefined;

/** Kısıtlı uygulama rolünün havuzu (ofis_uygulama üyesi, BYPASSRLS yok). */
export function uygulama(): pg.Pool {
  uygulamaHavuzu ??= new pg.Pool({ connectionString: adres('uygulama'), max: 4 });
  return uygulamaHavuzu;
}

export async function havuzlariKapat(): Promise<void> {
  await uygulamaHavuzu?.end();
  uygulamaHavuzu = undefined;
}

export interface Hata {
  kod: string | undefined;
  ileti: string;
}

/** Kısıtlı rolle açılan, sonunda geri alınan transaction. */
export class Deneme {
  readonly istemci: pg.PoolClient;
  #sayac = 0;

  constructor(istemci: pg.PoolClient) {
    this.istemci = istemci;
  }

  async baglam(girdi: BaglamGirdisi): Promise<void> {
    await baglamKur(this.istemci, girdi);
  }

  async satirlar<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    degerler: unknown[] = [],
  ): Promise<T[]> {
    return (await this.istemci.query<T>(sql, degerler)).rows;
  }

  async calistir(sql: string, degerler: unknown[] = []): Promise<number> {
    return (await this.istemci.query(sql, degerler)).rowCount ?? 0;
  }

  async say(tablo: string, kosul = 'true', degerler: unknown[] = []): Promise<number> {
    const satir = await this.satirlar<{ n: number }>(
      `select count(*)::int as n from ofis.${tablo} where ${kosul}`,
      degerler,
    );
    return satir[0]?.n ?? 0;
  }

  /** Sorgunun hata vermesini bekler; transaction'ı bozmadan hata kodunu döndürür. */
  async hata(sql: string, degerler: unknown[] = []): Promise<Hata> {
    const nokta = `n${String(++this.#sayac)}`;
    await this.istemci.query(`savepoint ${nokta}`);
    try {
      await this.istemci.query(sql, degerler);
    } catch (hata) {
      await this.istemci.query(`rollback to savepoint ${nokta}`);
      const pgHata = hata as { code?: string; message?: string };
      return { kod: pgHata.code, ileti: pgHata.message ?? '' };
    }
    await this.istemci.query(`release savepoint ${nokta}`);
    throw new Error(`Hata bekleniyordu ama sorgu başarılı oldu: ${sql}`);
  }
}

/** İşi kısıtlı rolle, sonunda geri alınan tek bir transaction içinde yürütür. */
export async function deneme<T>(is: (d: Deneme) => Promise<T>): Promise<T> {
  const istemci = await uygulama().connect();
  try {
    await istemci.query('begin');
    return await is(new Deneme(istemci));
  } finally {
    await geriAlVeBirak(istemci);
  }
}

// Geri alma başarısızsa bağlantı havuza dönmez ve asıl hata gizlenmez.
async function geriAlVeBirak(istemci: pg.PoolClient): Promise<void> {
  try {
    await istemci.query('rollback');
    istemci.release();
  } catch (hata) {
    istemci.release(hata instanceof Error ? hata : new Error('rollback'));
  }
}

/** Yetkili rolle tek seferlik sorgu (yalnızca beklenen durumu doğrulamak için). */
export async function yonetici<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  degerler: unknown[] = [],
): Promise<T[]> {
  const istemci = new pg.Client({ connectionString: adres('yonetici') });
  await istemci.connect();
  try {
    return (await istemci.query<T>(sql, degerler)).rows;
  } finally {
    await istemci.end();
  }
}

/** Yetkili rolle, sonunda geri alınan transaction (tetikleyicilerin yetkili role de uygulandığını görmek için). */
export async function yoneticiDenemesi<T>(is: (d: Deneme) => Promise<T>): Promise<T> {
  const havuz = new pg.Pool({ connectionString: adres('yonetici'), max: 1 });
  const istemci = await havuz.connect();
  try {
    await istemci.query('begin');
    return await is(new Deneme(istemci));
  } finally {
    await geriAlVeBirak(istemci);
    await havuz.end();
  }
}
