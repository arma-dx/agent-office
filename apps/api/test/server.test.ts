import { afterAll, describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/env.ts';
import { buildServer } from '../src/server.ts';

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
  it('başlık ve gövdedeki gizli değerleri yazmaz', async () => {
    const lines: string[] = [];
    const app = buildServer({ logStream: { write: (line) => lines.push(line) } });
    app.log.info({
      headers: { authorization: 'SECRET-a', cookie: 'SECRET-c', 'x-api-key': 'SECRET-k' },
      body: { token: 'SECRET-t', password: 'SECRET-p' },
    });
    await app.close();
    expect(lines.join('')).toContain('[REDACTED]');
    expect(lines.join('')).not.toContain('SECRET');
  });
});

describe('loadApiEnv', () => {
  it('yerelde yalnızca 127.0.0.1 dinler', () => {
    expect(loadApiEnv({ PORT: '8080' })).toMatchObject({ HOST: '127.0.0.1', PORT: 8080 });
  });
});
