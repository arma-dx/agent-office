import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const ajanKodu = z.string().regex(/^[A-Z]{1,3}(-[A-Z]{2,4})?-[0-9]+$/);

/**
 * Satır kurallarının okuduğu bağlam (CLAUDE.md kural 9). Boş bırakılan değer veritabanında boş
 * yazılır; kurallar boş değeri "yok" sayar ve o değere bağlı hiçbir satırı göstermez.
 */
export const baglamSemasi = z.strictObject({
  sirketId: z.uuid().nullable().default(null),
  kullaniciId: z.uuid().nullable().default(null),
  projeId: z.uuid().nullable().default(null),
  // Girişte Google'ın doğruladığı e-posta; yalnızca giriş akışında kullanılır.
  eposta: z.email().nullable().default(null),
  ajanKod: ajanKodu.nullable().default(null),
});

export type BaglamGirdisi = z.input<typeof baglamSemasi>;
export type Baglam = z.output<typeof baglamSemasi>;

/** Ajan çalışmasının bağlamı: şirket, kimlik ve ajan kodu zorunlu; proje varsa çalışmanın projesi. */
export const ajanBaglamiSemasi = z.strictObject({
  sirketId: z.uuid(),
  kullaniciId: z.uuid(),
  projeId: z.uuid().nullable().default(null),
  ajanKod: ajanKodu,
});

export type AjanBaglami = z.input<typeof ajanBaglamiSemasi>;

// set_config(..., true) SET LOCAL ile aynıdır: değer transaction bitince silinir. Değerler parametre
// olarak gider, sorgu metnine girmez.
const BAGLAM_SQL = `select
  pg_catalog.set_config('app.sirket_id', $1, true),
  pg_catalog.set_config('app.kullanici_id', $2, true),
  pg_catalog.set_config('app.proje_id', $3, true),
  pg_catalog.set_config('app.eposta', $4, true),
  pg_catalog.set_config('app.ajan_kod', $5, true)`;

/** Açık bir transaction içinde bağlamı kurar (ya da değiştirir). */
export async function baglamKur(istemci: PoolClient, girdi: BaglamGirdisi): Promise<void> {
  const baglam = baglamSemasi.parse(girdi);
  await istemci.query(BAGLAM_SQL, [
    baglam.sirketId ?? '',
    baglam.kullaniciId ?? '',
    baglam.projeId ?? '',
    baglam.eposta ?? '',
    baglam.ajanKod ?? '',
  ]);
}

/**
 * İşi tek bir transaction içinde, verilen bağlamla yürütür. API isteği başına bir kez, ajan
 * çalışmasında her adım için ayrı ayrı çağrılır. Hata olursa geri alır ve hatayı yeniden fırlatır.
 * Bağlam transaction'a özel olduğu için havuza dönen bağlantıda kalmaz.
 */
export async function baglamliIslem<T>(
  havuz: Pool,
  girdi: BaglamGirdisi,
  is: (istemci: PoolClient) => Promise<T>,
): Promise<T> {
  const baglam = baglamSemasi.parse(girdi);
  const istemci = await havuz.connect();
  let bozukBaglanti: Error | undefined;
  try {
    await istemci.query('begin');
    try {
      await baglamKur(istemci, baglam);
      const sonuc = await is(istemci);
      // İş bir veritabanı hatasını kendisi yakalayıp dönerse transaction bozulmuştur; PostgreSQL
      // COMMIT'i hata vermeden ROLLBACK olarak yanıtlar. Yazılanlar kaybolmuşken başarı dönülmez.
      const bitis = await istemci.query('commit');
      if (bitis.command === 'ROLLBACK') {
        throw new Error('Transaction hata nedeniyle geri alındı; iş başarılı sayılmaz');
      }
      return sonuc;
    } catch (hata) {
      try {
        await istemci.query('rollback');
      } catch (geriAlmaHatasi) {
        // Geri alınamayan bağlantı havuza dönmez.
        bozukBaglanti = geriAlmaHatasi instanceof Error ? geriAlmaHatasi : new Error('rollback');
      }
      throw hata;
    }
  } finally {
    istemci.release(bozukBaglanti);
  }
}

/**
 * Ajan çalışmasının bir adımı (araç çağrısı, kayıt): kendi kısa transaction'ında, bağlamı yeniden
 * kurarak yürür. Çalışmanın bağlamı çalışma boyunca aynı kalır.
 */
export async function ajanAdimi<T>(
  havuz: Pool,
  girdi: AjanBaglami,
  is: (istemci: PoolClient) => Promise<T>,
): Promise<T> {
  const baglam = ajanBaglamiSemasi.parse(girdi);
  return baglamliIslem(havuz, { ...baglam, eposta: null }, is);
}
