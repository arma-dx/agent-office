import { afterAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/env.ts';
import { gizliAlanMi } from '../src/log.ts';
import { buildServer } from '../src/server.ts';

function logYakala() {
  const satirlar: string[] = [];
  const app = buildServer({ logStream: { write: (satir) => satirlar.push(satir) } });
  return { app, metin: () => satirlar.join('') };
}

describe('GET /api/health', () => {
  const app = buildServer({ logger: false });
  afterAll(() => app.close());

  it('ok döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'api' });
  });
});

describe('log gizleme', () => {
  it('her derinlikteki gizli alanları yazmaz, diğer alanları korur', async () => {
    const { app, metin } = logYakala();
    app.log.info({ token: 'SECRET-1', password: 'SECRET-2', apiKey: 'SECRET-3' }, 'ust duzey');
    app.log.info({
      headers: { Authorization: 'SECRET-4', cookie: 'SECRET-5', apikey: 'SECRET-6' },
      body: { access_token: 'SECRET-7', refresh_token: 'SECRET-8', client_secret: 'SECRET-9' },
      env: { ANTHROPIC_API_KEY: 'SECRET-10', DATABASE_URL: 'SECRET-11' },
      a: { b: { c: { password: 'SECRET-12' } } },
      liste: [{ id_token: 'SECRET-13' }],
      kullanim: { input_tokens: 42, output_tokens: 7 },
    });
    await app.close();
    const log = metin();
    expect(log).not.toContain('SECRET');
    expect(log).toContain('[REDACTED]');
    expect(log).toContain('"input_tokens":42');
    expect(log).toContain('ust duzey');
  });

  it('istek adresindeki sorgu dizesini yazmaz', async () => {
    const { app, metin } = logYakala();
    const yok = await app.inject({ method: 'GET', url: '/api/yok?code=SECRET-code&state=x' });
    await app.inject({ method: 'GET', url: '/api/health?token=SECRET-token' });
    await app.close();
    expect(yok.statusCode).toBe(404);
    expect(metin()).toContain('/api/yok');
    expect(metin()).not.toContain('SECRET');
  });

  it('gizli alan adlarını tanır, sayaçları tanımaz', () => {
    for (const ad of ['x-api-key', 'SUPABASE_SECRET_KEY', 'clientSecret', 'set-cookie']) {
      expect(gizliAlanMi(ad)).toBe(true);
    }
    for (const ad of ['input_tokens', 'maxTokens', 'monkey', 'reqId', 'msg']) {
      expect(gizliAlanMi(ad)).toBe(false);
    }
  });
});

describe('loadApiEnv', () => {
  it('yerelde yalnızca 127.0.0.1 dinler', () => {
    expect(loadApiEnv({ PORT: '8080' })).toMatchObject({ HOST: '127.0.0.1', PORT: 8080 });
  });

  it('boş HOST değerini reddeder', () => {
    expect(() => loadApiEnv({ HOST: ' ' })).toThrow(/HOST/);
  });
});
