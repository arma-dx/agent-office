import { afterAll, describe, expect, it } from 'vitest';
import { loadApiEnv, serverConfig } from '../src/env.ts';
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

  it('forbids every other page to show an answer in a frame', async () => {
    for (const url of ['/api/health', '/api/unknown']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy'], url).toBe("frame-ancestors 'none'");
      expect(res.headers['x-frame-options'], url).toBe('DENY');
    }
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

const REQUIRED = {
  DATABASE_URL: 'postgresql://office_api@127.0.0.1:54322/postgres',
  PANEL_ORIGIN: 'https://office.example.test',
  COOKIE_SECRET: 'x'.repeat(32),
};

function envError(source: Record<string, string>): string {
  try {
    loadApiEnv(source);
  } catch (error) {
    return String(error);
  }
  throw new Error('expected an invalid environment');
}

describe('loadApiEnv', () => {
  it('listens only on 127.0.0.1 locally', () => {
    expect(loadApiEnv({ ...REQUIRED, PORT: '8080' })).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 8080,
    });
  });

  it('rejects an empty HOST value', () => {
    expect(() => loadApiEnv({ ...REQUIRED, HOST: ' ' })).toThrow(/HOST/);
  });

  it('requires the database, the panel origin and a long cookie secret', () => {
    const message = envError({ COOKIE_SECRET: 'SECRET-short' });
    for (const name of ['DATABASE_URL', 'PANEL_ORIGIN', 'COOKIE_SECRET']) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain('SECRET-short');
    expect(envError({ ...REQUIRED, DATABASE_URL: 'https://db.example.test' })).toContain(
      'DATABASE_URL',
    );
  });

  it('accepts an https origin, or exactly the local panel', () => {
    for (const origin of ['https://office.armadx.com', 'http://localhost:5173']) {
      expect(loadApiEnv({ ...REQUIRED, PANEL_ORIGIN: origin }).PANEL_ORIGIN).toBe(origin);
    }
    for (const origin of [
      'http://office.armadx.com',
      'https://office.armadx.com/',
      'https://office.armadx.com/panel',
      'http://localhost:3000',
    ]) {
      expect(envError({ ...REQUIRED, PANEL_ORIGIN: origin })).toContain('PANEL_ORIGIN');
    }
    expect(
      envError({ ...REQUIRED, NODE_ENV: 'production', PANEL_ORIGIN: 'http://localhost:5173' }),
    ).toContain('PANEL_ORIGIN');
  });

  it('takes the three Google values together, with the callback under the panel origin', () => {
    const google = {
      GOOGLE_CLIENT_ID: 'client-id.apps.example.test',
      GOOGLE_CLIENT_SECRET: 'client-secret-placeholder',
      GOOGLE_REDIRECT_URI: 'https://office.example.test/api/auth/google/callback',
    };
    const config = serverConfig(loadApiEnv({ ...REQUIRED, ...google }));
    expect(config.google).toEqual({
      clientId: google.GOOGLE_CLIENT_ID,
      clientSecret: google.GOOGLE_CLIENT_SECRET,
      redirectUri: google.GOOGLE_REDIRECT_URI,
    });
    // Empty values count as missing: Google sign-in is then not configured.
    const empty = { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' };
    expect(serverConfig(loadApiEnv({ ...REQUIRED, ...empty })).google).toBeNull();
    expect(envError({ ...REQUIRED, GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID })).toContain(
      'GOOGLE_CLIENT_ID',
    );
    // The redirect URI alone (filled in before the client values) leaves it not configured;
    // a client id and secret without it are refused.
    const uriOnly = { GOOGLE_REDIRECT_URI: google.GOOGLE_REDIRECT_URI };
    expect(serverConfig(loadApiEnv({ ...REQUIRED, ...uriOnly })).google).toBeNull();
    expect(envError({ ...REQUIRED, ...google, GOOGLE_REDIRECT_URI: '' })).toContain(
      'GOOGLE_CLIENT_ID',
    );
    for (const uri of [
      'https://evil.example.test/api/auth/google/callback',
      'https://office.example.test.evil.test/api/auth/google/callback',
      'https://office.example.test/api/auth/google/callback?next=/',
      'https://office.example.test/callback',
    ]) {
      expect(envError({ ...REQUIRED, ...google, GOOGLE_REDIRECT_URI: uri })).toContain(
        'GOOGLE_REDIRECT_URI',
      );
    }
  });

  it('requires the amr check in production', () => {
    expect(serverConfig(loadApiEnv(REQUIRED)).requireAmr).toBe(true);
    expect(serverConfig(loadApiEnv({ ...REQUIRED, AUTH_REQUIRE_AMR: 'false' })).requireAmr).toBe(
      false,
    );
    expect(envError({ ...REQUIRED, NODE_ENV: 'production', AUTH_REQUIRE_AMR: 'false' })).toContain(
      'AUTH_REQUIRE_AMR',
    );
  });

  it('requires the trusted proxies in production', () => {
    const production = {
      ...REQUIRED,
      NODE_ENV: 'production',
      PANEL_ORIGIN: 'https://office.example.test',
    };
    expect(envError(production)).toContain('TRUST_PROXY');
    expect(envError({ ...production, TRUST_PROXY: '' })).toContain('TRUST_PROXY');
    const config = serverConfig(
      loadApiEnv({ ...production, TRUST_PROXY: '172.18.0.0/16, 173.245.48.0/20' }),
    );
    expect(config.trustProxy).toEqual(['172.18.0.0/16', '173.245.48.0/20']);
  });

  it('reads the company domains and the trusted proxies as lists', () => {
    const config = serverConfig(
      loadApiEnv({
        ...REQUIRED,
        COMPANY_EMAIL_DOMAINS: ' ArmaDX.com, pillika.com ',
        TRUST_PROXY: '127.0.0.1, 10.0.0.0/8, ::1',
      }),
    );
    expect(config.companyEmailDomains).toEqual(['armadx.com', 'pillika.com']);
    expect(config.trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8', '::1']);
    expect(config.localCookies).toBe(false);
    expect(serverConfig(loadApiEnv(REQUIRED)).trustProxy).toBeNull();
    for (const value of ['true', '*', 'proxy.example.test', ',']) {
      expect(envError({ ...REQUIRED, TRUST_PROXY: value })).toContain('TRUST_PROXY');
    }
    expect(envError({ ...REQUIRED, COMPANY_EMAIL_DOMAINS: 'not a domain' })).toContain(
      'COMPANY_EMAIL_DOMAINS',
    );
  });
});
