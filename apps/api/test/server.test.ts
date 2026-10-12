import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { fileStorageSettings, githubAppConfigs, loadApiEnv, serverConfig } from '../src/env.ts';
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

  it('takes a folder or the three Supabase values as the file storage, never both', () => {
    expect(fileStorageSettings(loadApiEnv(REQUIRED))).toBeNull();
    expect(
      fileStorageSettings(loadApiEnv({ ...REQUIRED, FILE_STORAGE_DIR: '/var/tmp/office-files' })),
    ).toEqual({ kind: 'disk', dir: '/var/tmp/office-files' });
    const supabase = {
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      // Put together here so that no line of the repository holds the shape of a secret key.
      SUPABASE_SECRET_KEY: `sb_secret_${'SECRET-placeholder'.repeat(2)}`,
      SUPABASE_STORAGE_BUCKET: 'office-files',
    };
    expect(fileStorageSettings(loadApiEnv({ ...REQUIRED, ...supabase }))).toEqual({
      kind: 'supabase',
      url: supabase.SUPABASE_URL,
      key: supabase.SUPABASE_SECRET_KEY,
      bucket: 'office-files',
    });
    expect(
      fileStorageSettings(
        loadApiEnv({ ...REQUIRED, ...supabase, NODE_ENV: 'production', TRUST_PROXY: '10.0.0.1' }),
      )?.kind,
    ).toBe('supabase');
    // The config every route gets holds nothing of the storage: not its key, not its address.
    const config = serverConfig(loadApiEnv({ ...REQUIRED, ...supabase }));
    expect(JSON.stringify(config)).not.toContain('SECRET-placeholder');
    expect(JSON.stringify(config)).not.toContain('supabase.co');
    expect(envError({ ...REQUIRED, FILE_STORAGE_DIR: 'files' })).toContain('FILE_STORAGE_DIR');
    expect(envError({ ...REQUIRED, ...supabase, FILE_STORAGE_DIR: '/var/tmp/x' })).toContain(
      'FILE_STORAGE_DIR',
    );
    expect(
      envError({
        ...REQUIRED,
        NODE_ENV: 'production',
        TRUST_PROXY: '10.0.0.1',
        FILE_STORAGE_DIR: '/var/tmp/x',
      }),
    ).toContain('FILE_STORAGE_DIR');
    for (const missing of Object.keys(supabase)) {
      const partial = Object.fromEntries(
        Object.entries({ ...REQUIRED, ...supabase }).filter(([name]) => name !== missing),
      );
      const message = envError(partial);
      expect(message, missing).toContain('SUPABASE_URL');
      expect(message, missing).not.toContain('SECRET-placeholder');
    }
    for (const url of [
      'http://x.supabase.co',
      'https://x.supabase.co/',
      'https://x.supabase.co/storage/v1',
    ]) {
      expect(envError({ ...REQUIRED, ...supabase, SUPABASE_URL: url })).toContain('SUPABASE_URL');
    }
    for (const bucket of ['Office', 'a', 'office files', 'office/files', '../x']) {
      expect(envError({ ...REQUIRED, ...supabase, SUPABASE_STORAGE_BUCKET: bucket })).toContain(
        'SUPABASE_STORAGE_BUCKET',
      );
    }
    expect(envError({ ...REQUIRED, ...supabase, SUPABASE_SECRET_KEY: 'short' })).toContain(
      'SUPABASE_SECRET_KEY',
    );
  });
  describe('the GitHub App of each company', () => {
    // Made here: no line of the repository holds a key.
    const pem = (key: KeyObject): string =>
      Buffer.from(key.export({ type: 'pkcs1', format: 'pem' })).toString('base64');
    const firstKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const secondKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const first = {
      GITHUB_APP_1_COMPANY: 'armadx',
      GITHUB_APP_1_ORGANIZATION: 'Arma-Org',
      GITHUB_APP_1_CLIENT_ID: 'Iv23aaaaaaaaaaaaaaaa',
      GITHUB_APP_1_PRIVATE_KEY: pem(firstKey),
    };
    const second = {
      GITHUB_APP_2_COMPANY: 'pillika',
      GITHUB_APP_2_ORGANIZATION: 'pillika-org',
      GITHUB_APP_2_CLIENT_ID: 'Iv23bbbbbbbbbbbbbbbb',
      GITHUB_APP_2_PRIVATE_KEY: pem(secondKey),
    };
    const spki = (key: KeyObject): string =>
      createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('hex');

    it('no slot, one slot alone and both slots are accepted', () => {
      expect(githubAppConfigs(loadApiEnv(REQUIRED))).toEqual([]);
      const empty = Object.fromEntries(Object.keys({ ...first, ...second }).map((n) => [n, '']));
      expect(githubAppConfigs(loadApiEnv({ ...REQUIRED, ...empty }))).toEqual([]);

      const one = githubAppConfigs(loadApiEnv({ ...REQUIRED, ...second }));
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({
        companyCode: 'pillika',
        organization: 'pillika-org',
        clientId: 'Iv23bbbbbbbbbbbbbbbb',
      });

      const both = githubAppConfigs(loadApiEnv({ ...REQUIRED, ...first, ...second }));
      expect(both.map((app) => [app.companyCode, app.organization, app.clientId])).toEqual([
        ['armadx', 'Arma-Org', 'Iv23aaaaaaaaaaaaaaaa'],
        ['pillika', 'pillika-org', 'Iv23bbbbbbbbbbbbbbbb'],
      ]);
      // Each slot holds its own key, as a key object.
      expect(both.map((app) => spki(app.privateKey))).toEqual([spki(firstKey), spki(secondKey)]);
      expect(both.every((app) => app.privateKey.type === 'private')).toBe(true);
    });

    it('the config every route gets holds nothing of the apps', () => {
      const config = serverConfig(loadApiEnv({ ...REQUIRED, ...first, ...second }));
      const text = JSON.stringify(config);
      for (const value of [...Object.values(first), ...Object.values(second)]) {
        expect(text).not.toContain(value);
      }
      expect(Object.keys(config)).not.toContain('github');
    });

    it('a slot is set whole or not at all', () => {
      for (const slot of [first, second]) {
        const names = Object.keys(slot);
        for (let kept = 1; kept < names.length; kept += 1) {
          for (let start = 0; start < names.length; start += 1) {
            // One, two or three of the four values, starting at each of them.
            const some = names.filter((_, index) => (index - start + 4) % 4 < kept);
            const partial = Object.fromEntries(
              Object.entries(slot).filter(([name]) => some.includes(name)),
            );
            const message = envError({ ...REQUIRED, ...partial });
            expect(message, some.join(',')).toContain(names[0]);
            expect(message, some.join(',')).toContain('are set together');
            expect(message).not.toContain(slot[names[3] as keyof typeof slot]);
          }
        }
      }
      // A whole first slot does not make up for a half second one.
      expect(envError({ ...REQUIRED, ...first, GITHUB_APP_2_COMPANY: 'pillika' })).toContain(
        'GITHUB_APP_2_COMPANY',
      );
    });

    it('a value that is not an RSA private key is refused, and never printed', () => {
      const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
      const notKeys = [
        'not base64 at all!',
        Buffer.from('SECRET-not-a-key').toString('base64'),
        // The PEM text itself, not base64 encoded.
        firstKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
        // A public key, and a key of another kind.
        Buffer.from(createPublicKey(firstKey).export({ type: 'spki', format: 'pem' })).toString(
          'base64',
        ),
        Buffer.from(ec.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
      ];
      for (const value of notKeys) {
        const message = envError({ ...REQUIRED, ...first, GITHUB_APP_1_PRIVATE_KEY: value });
        expect(message).toContain('GITHUB_APP_1_PRIVATE_KEY');
        expect(message).not.toContain(value);
        expect(message).not.toContain('SECRET');
        expect(message).not.toContain('BEGIN');
      }
      // A key in the other format GitHub's tools write (PKCS#8) is the same key.
      const pkcs8 = Buffer.from(firstKey.export({ type: 'pkcs8', format: 'pem' })).toString(
        'base64',
      );
      const [app] = githubAppConfigs(
        loadApiEnv({ ...REQUIRED, ...first, GITHUB_APP_1_PRIVATE_KEY: pkcs8 }),
      );
      expect(app && spki(app.privateKey)).toBe(spki(firstKey));
    });

    it('the company is a company code and never the founder space', () => {
      for (const company of ['founder_space', 'Arma DX', 'ARMADX', '1arma', 'arma-dx']) {
        expect(
          envError({ ...REQUIRED, ...first, GITHUB_APP_1_COMPANY: company }),
          company,
        ).toContain('GITHUB_APP_1_COMPANY');
      }
      for (const organization of ['arma org', 'arma/org', 'a'.repeat(40), 'arma_org']) {
        expect(
          envError({ ...REQUIRED, ...first, GITHUB_APP_1_ORGANIZATION: organization }),
          organization,
        ).toContain('GITHUB_APP_1_ORGANIZATION');
      }
      expect(envError({ ...REQUIRED, ...first, GITHUB_APP_1_CLIENT_ID: 'a client id' })).toContain(
        'GITHUB_APP_1_CLIENT_ID',
      );
    });

    it('the two slots differ in company, organisation, client ID and key', () => {
      const same: [string, Record<string, string>][] = [
        ['COMPANY', { GITHUB_APP_2_COMPANY: 'armadx' }],
        ['ORGANIZATION', { GITHUB_APP_2_ORGANIZATION: 'Arma-Org' }],
        // GitHub does not tell two names apart by their letter case.
        ['ORGANIZATION', { GITHUB_APP_2_ORGANIZATION: 'arma-org' }],
        ['CLIENT_ID', { GITHUB_APP_2_CLIENT_ID: first.GITHUB_APP_1_CLIENT_ID }],
        ['PRIVATE_KEY', { GITHUB_APP_2_PRIVATE_KEY: first.GITHUB_APP_1_PRIVATE_KEY }],
        // The same key written in the other format is still the same key.
        [
          'PRIVATE_KEY',
          {
            GITHUB_APP_2_PRIVATE_KEY: Buffer.from(
              firstKey.export({ type: 'pkcs8', format: 'pem' }),
            ).toString('base64'),
          },
        ],
      ];
      for (const [value, change] of same) {
        const message = envError({ ...REQUIRED, ...first, ...second, ...change });
        expect(message, value).toContain(
          `GITHUB_APP_1_${value} and GITHUB_APP_2_${value} must differ`,
        );
        expect(message, value).not.toContain(first.GITHUB_APP_1_PRIVATE_KEY);
      }
    });
  });
});
