// Kural 6: gizli değerler loglara girmez.
// Adı gizli bir alanı andıran her değer, düz nesnelerde her derinlikte maskelenir (formatters.log).
// Fastify istek nesnesi düz nesne değildir; onun başlıkları pino redact yollarıyla maskelenir.
// Hata nesnelerine gizli değer eklenmez, ortam ve yapılandırma nesneleri bütün olarak loglanmaz.

export const MASKE = '[REDACTED]';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers.apikey',
  'res.headers["set-cookie"]',
];

// Tam ad eşleşmesi ya da "_token", "-key", "_secret", "_password" ile biten adlar.
// "input_tokens" gibi sayaçlar eşleşmez; maliyet kaydı için gerekirler.
const GIZLI_ALAN =
  /^(pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|set-cookie|credentials?|database_url|dsn|connection_?string)$|[-_](secret|token|key|password)$/i;
// Deve yazımı: apiKey, accessToken, clientSecret.
const GIZLI_ALAN_DEVE = /[a-z0-9](Secret|Token|Key|Password)$/;
const EN_FAZLA_DERINLIK = 8;

export function gizliAlanMi(ad: string): boolean {
  return GIZLI_ALAN.test(ad) || GIZLI_ALAN_DEVE.test(ad);
}

function duzNesneMi(deger: unknown): deger is Record<string, unknown> {
  if (deger === null || typeof deger !== 'object') return false;
  const ata: unknown = Object.getPrototypeOf(deger);
  return ata === Object.prototype || ata === null;
}

function gizleDeger(deger: unknown, derinlik: number): unknown {
  if (derinlik > EN_FAZLA_DERINLIK) return deger;
  if (Array.isArray(deger)) return deger.map((oge: unknown) => gizleDeger(oge, derinlik + 1));
  if (!duzNesneMi(deger)) return deger;
  const sonuc: Record<string, unknown> = {};
  for (const [ad, alt] of Object.entries(deger)) {
    sonuc[ad] = gizliAlanMi(ad) ? MASKE : gizleDeger(alt, derinlik + 1);
  }
  return sonuc;
}

export function gizle(nesne: Record<string, unknown>): Record<string, unknown> {
  return gizleDeger(nesne, 0) as Record<string, unknown>;
}

// Sorgu dizesi (ör. OAuth dönüşündeki code) loga yazılmaz.
export function sorgusuzYol(url: string): string {
  const soru = url.indexOf('?');
  return soru === -1 ? url : url.slice(0, soru);
}
