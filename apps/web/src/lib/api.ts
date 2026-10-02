import type { z } from 'zod';

/** Panel API'ye yalnızca göreli /api yoluyla gider (CLAUDE.md kural 1; panel ve API tek alan adında). */
export const API_KOKU = '/api';

export class ApiHatasi extends Error {
  readonly durum: number;

  constructor(durum: number, mesaj: string) {
    super(mesaj);
    this.name = 'ApiHatasi';
    this.durum = durum;
  }
}

/** Yeniden denemekle düzelmeyecek hata: istemci hatası (4xx) ya da beklenmeyen yanıt biçimi. */
export function kaliciHataMi(hata: unknown): boolean {
  return hata instanceof ApiHatasi && hata.durum >= 400 && hata.durum < 500;
}

/** Kullanıcıya gösterilecek, ne olduğunu ve ne yapılacağını söyleyen mesaj. İç ayrıntı gösterilmez. */
export function kullaniciMesaji(hata: unknown): string {
  if (hata instanceof ApiHatasi) {
    if (hata.durum === 0) return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.';
    if (hata.durum === 401) return 'Oturumunuz kapanmış. Yeniden giriş yapın.';
    if (hata.durum === 403) return 'Bu işlem için yetkiniz yok.';
    if (hata.durum === 404) return 'Aradığınız kayıt bulunamadı.';
    if (hata.durum === 429) return 'Çok sık istek gönderildi. Biraz bekleyip yeniden deneyin.';
    if (hata.durum >= 500) return 'Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.';
    return 'İstek tamamlanamadı. Bilgileri kontrol edip yeniden deneyin.';
  }
  return 'Beklenmeyen bir sorun oluştu. Sayfayı yenileyip yeniden deneyin.';
}

interface IstekSecenekleri<T> {
  yontem?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  govde?: unknown;
  /** Gövdesiz yanıt (204) bekleyen uçlar için z.undefined() verilir. */
  sema: z.ZodType<T>;
  sinyal?: AbortSignal;
}

/**
 * API'ye istek atar ve yanıtı zod şemasıyla doğrular (bütün girişler zod ile doğrulanır).
 * Oturum çerezi aynı kökenden gider; tarayıcı hiçbir anahtar tutmaz.
 * İptal edilen istek ApiHatasi'na çevrilmez; çağıran AbortError'ı olduğu gibi alır.
 */
export async function apiIstegi<T>(yol: string, secenekler: IstekSecenekleri<T>): Promise<T> {
  if (!yol.startsWith('/')) throw new Error('API yolu / ile başlamalı');
  let yanit: Response;
  try {
    yanit = await fetch(`${API_KOKU}${yol}`, {
      method: secenekler.yontem ?? 'GET',
      credentials: 'same-origin',
      headers: secenekler.govde === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(secenekler.govde === undefined ? {} : { body: JSON.stringify(secenekler.govde) }),
      ...(secenekler.sinyal ? { signal: secenekler.sinyal } : {}),
    });
  } catch (hata) {
    if (secenekler.sinyal?.aborted) throw hata;
    throw new ApiHatasi(0, 'Sunucuya ulaşılamadı');
  }
  if (!yanit.ok) {
    throw new ApiHatasi(yanit.status, `İstek başarısız (${String(yanit.status)})`);
  }
  let veri: unknown = undefined;
  if (yanit.status !== 204) {
    try {
      veri = await yanit.json();
    } catch (hata) {
      if (secenekler.sinyal?.aborted) throw hata;
      throw new ApiHatasi(502, 'Sunucu yanıtı beklenen biçimde değil');
    }
  }
  const sonuc = secenekler.sema.safeParse(veri);
  if (!sonuc.success) throw new ApiHatasi(502, 'Sunucu yanıtı beklenen biçimde değil');
  return sonuc.data;
}
