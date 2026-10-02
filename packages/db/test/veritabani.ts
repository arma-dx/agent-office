import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Veritabanı testlerinin ortak kurulumu (Vitest globalSetup). TEST_DATABASE_URL yetkili bir rolün
 * adresidir (yerelde ve CI'da geçici PostgreSQL'in postgres kullanıcısı). Kurulum:
 *   1. Adı verilen test veritabanını sıfırdan açar ve bütün göçleri sırayla uygular.
 *   2. ofis_uygulama üyesi, BYPASSRLS'siz bir giriş rolü açar; parolası her koşuda rastgele üretilir.
 *   3. Varsa test verisini yetkili rolle yükler.
 * Testler kısıtlı rolün adresiyle bağlanır. Adres yoksa yerelde veritabanı testleri atlanır; CI'da
 * kurulum hata verir.
 */
export interface TestVeritabani {
  yonetici: string;
  uygulama: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    veritabani: TestVeritabani | null;
  }
}

const GOC_KLASORU = new URL('../../../supabase/migrations/', import.meta.url);
// Kurulumları sıraya sokan danışma kilidi (sabit, rastgele seçilmiş bir sayı).
const KURULUM_KILIDI = 7_402_115_903;

async function gocleriUygula(istemci: pg.Client): Promise<void> {
  const dosyalar = (await readdir(GOC_KLASORU)).filter((ad) => ad.endsWith('.sql')).sort();
  for (const dosya of dosyalar) {
    const sql = await readFile(new URL(dosya, GOC_KLASORU), 'utf8');
    await istemci.query('begin');
    try {
      await istemci.query(sql);
      await istemci.query('commit');
    } catch (hata) {
      await istemci.query('rollback');
      throw new Error(`Göç uygulanamadı: ${dosya}`, { cause: hata });
    }
  }
}

function adresDegistir(adres: string, degisim: (url: URL) => void): string {
  const url = new URL(adres);
  degisim(url);
  return url.toString();
}

export function testVeritabaniKurulumu(
  ad: string,
  veriYukle?: (istemci: pg.Client) => Promise<void>,
): (proje: TestProject) => Promise<() => Promise<void>> {
  if (!/^[a-z_]+$/.test(ad)) {
    throw new Error('Test veritabanı adı yalnızca küçük harf ve alt çizgi içerir');
  }
  const girisRolu = `${ad}_giris`;

  return async function kurulum(proje) {
    const kok = process.env.TEST_DATABASE_URL;
    if (!kok) {
      if (process.env.CI) {
        throw new Error('CI ortamında TEST_DATABASE_URL tanımlı olmalı');
      }
      proje.provide('veritabani', null);
      return async () => {};
    }

    const sunucu = new pg.Client({ connectionString: kok });
    await sunucu.connect();
    const parola = randomBytes(24).toString('hex');
    const yonetici = adresDegistir(kok, (url) => {
      url.pathname = `/${ad}`;
    });
    try {
      // Roller sunucu genelindedir; birden çok test projesi aynı sunucuda göç çalıştırırken ortak
      // rolleri aynı anda açmaya çalışmasın diye kurulum sırayla yapılır.
      await sunucu.query('select pg_advisory_lock($1)', [KURULUM_KILIDI]);
      await sunucu.query(`drop database if exists ${ad} with (force)`);
      await sunucu.query(`drop role if exists ${girisRolu}`);
      await sunucu.query(`create database ${ad}`);

      const istemci = new pg.Client({ connectionString: yonetici });
      await istemci.connect();
      try {
        await gocleriUygula(istemci);
        const { rows } = await istemci.query<{ sql: string }>(
          `select format('create role %I login nobypassrls password %L in role ofis_uygulama', $1::text, $2::text) as sql`,
          [girisRolu, parola],
        );
        await istemci.query(rows[0]?.sql ?? '');
        if (veriYukle) {
          await istemci.query('begin');
          await veriYukle(istemci);
          await istemci.query('commit');
        }
      } finally {
        await istemci.end();
      }
    } finally {
      await sunucu.end();
    }

    proje.provide('veritabani', {
      yonetici,
      uygulama: adresDegistir(yonetici, (url) => {
        url.username = girisRolu;
        url.password = parola;
      }),
    });

    return async () => {
      const kapanis = new pg.Client({ connectionString: kok });
      await kapanis.connect();
      try {
        await kapanis.query(`drop database if exists ${ad} with (force)`);
        await kapanis.query(`drop role if exists ${girisRolu}`);
      } finally {
        await kapanis.end();
      }
    };
  };
}
