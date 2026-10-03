import { afterAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/env.ts';
import { isSecretKey } from '../src/log.ts';
import { buildServer } from '../src/server.ts';

function captureLog() {
  const lines: string[] = [];
  const app = buildServer({ logStream: { write: (line) => lines.push(line) } });
  return { app, text: () => lines.join('') };
}

describe('GET /api/health', () => {
  const app = buildServer({ logger: false });
  afterAll(() => app.close());

  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'api' });
  });
});

describe('log redaction', () => {
  it('omits secret keys at every depth and keeps the other keys', async () => {
    const { app, text } = captureLog();
    app.log.info({ token: 'SECRET-1', password: 'SECRET-2', apiKey: 'SECRET-3' }, 'top level');
    app.log.info({
      headers: { Authorization: 'SECRET-4', cookie: 'SECRET-5', apikey: 'SECRET-6' },
      body: { access_token: 'SECRET-7', refresh_token: 'SECRET-8', client_secret: 'SECRET-9' },
      env: { ANTHROPIC_API_KEY: 'SECRET-10', DATABASE_URL: 'SECRET-11' },
      a: { b: { c: { password: 'SECRET-12' } } },
      list: [{ id_token: 'SECRET-13' }],
      usage: { input_tokens: 42, output_tokens: 7 },
    });
    await app.close();
    const log = text();
    expect(log).not.toContain('SECRET');
    expect(log).toContain('[REDACTED]');
    expect(log).toContain('"input_tokens":42');
    expect(log).toContain('top level');
  });

  it('omits the query string of the request URL', async () => {
    const { app, text } = captureLog();
    const missing = await app.inject({
      method: 'GET',
      url: '/api/missing?code=SECRET-code&state=x',
    });
    await app.inject({ method: 'GET', url: '/api/health?token=SECRET-token' });
    await app.close();
    expect(missing.statusCode).toBe(404);
    expect(text()).toContain('/api/missing');
    expect(text()).not.toContain('SECRET');
  });

  it('recognises secret key names but not counters', () => {
    for (const key of ['x-api-key', 'SUPABASE_SECRET_KEY', 'clientSecret', 'set-cookie']) {
      expect(isSecretKey(key)).toBe(true);
    }
    for (const key of ['input_tokens', 'maxTokens', 'monkey', 'reqId', 'msg']) {
      expect(isSecretKey(key)).toBe(false);
    }
  });
});

describe('loadApiEnv', () => {
  it('listens only on 127.0.0.1 locally', () => {
    expect(loadApiEnv({ PORT: '8080' })).toMatchObject({ HOST: '127.0.0.1', PORT: 8080 });
  });

  it('rejects an empty HOST value', () => {
    expect(() => loadApiEnv({ HOST: ' ' })).toThrow(/HOST/);
  });
});
