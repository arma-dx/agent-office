import { PgBoss } from 'pg-boss';
import { z } from 'zod';

/** pg-boss şeması; göçle kurulur (supabase/migrations/*_kuyruk.sql). */
export const KUYRUK_SEMASI = 'pgboss';

/**
 * Kural 10: kuyruk tabloları satır kuralı dışında olduğu için işe yalnızca kimlik konur. İş verisi
 * düz bir nesnedir; her alanın adı `...Id` ile biter ve değeri bir uuid'dir.
 */
export const isVerisiSemasi = z
  .record(z.string().regex(/^[a-z][a-zA-Z0-9]*Id$/), z.uuid())
  .refine((veri) => Object.keys(veri).length <= 8, 'İş verisinde en fazla 8 kimlik olur');

export type IsVerisi = z.output<typeof isVerisiSemasi>;

const kuyrukAdi = z.string().regex(/^[a-z][a-z0-9_]*$/);

/**
 * Kuyruk istemcisi. Kısıtlı uygulama rolüyle bağlanır; şemayı kurmaz ve değiştirmez (migrate: false),
 * şema sürümü göçle uyuşmazsa başlarken hata verir. pg-boss hata yayar; dinleyici olmazsa süreç
 * çöker, bu yüzden zorunlu. Kuyruklar bölümlenmiş (partition) açılmaz: bölüm tablosu giriş rolüne
 * ait olur ve ileriki pg-boss göçleri ona dokunamaz.
 */
export function kuyrukOlustur(
  baglantiAdresi: string,
  hataDinleyici: (hata: Error) => void,
): PgBoss {
  const kuyruk = new PgBoss({
    connectionString: baglantiAdresi,
    schema: KUYRUK_SEMASI,
    migrate: false,
    application_name: 'agent-office-kuyruk',
  });
  kuyruk.on('error', hataDinleyici);
  return kuyruk;
}

/** İşi kuyruğa koyar; veri yalnızca kimliklerden oluşabilir. */
export async function isGonder(
  kuyruk: Pick<PgBoss, 'send'>,
  ad: string,
  veri: Record<string, string>,
): Promise<string | null> {
  return kuyruk.send(kuyrukAdi.parse(ad), isVerisiSemasi.parse(veri));
}
