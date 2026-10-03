import { COMPANY_HEADER, apiErrorSchema } from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMITS } from '../src/security.ts';
import { accounts, ids } from './fixtures.ts';
import {
  LOGIN_COOKIE,
  PANEL_ORIGIN,
  SAME_ORIGIN,
  SESSION_COOKIE,
  closeAdminPool,
  cookieValue,
  createTestServer,
  noDatabase,
  sessionOf,
  testConfig,
  type TestServer,
} from './helpers.ts';

// Request forgery protection, JSON-only bodies and rate limits.

function errorCode(res: { json: () => unknown }): string {
  return apiErrorSchema.parse(res.json()).error.code;
}

describe.skipIf(noDatabase)('request forgery protection', () => {
  let server: TestServer;
  let founder: string;

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
  });
  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  function invite(headers: Record<string, string>, payload: string | object) {
    return server.app.inject({
      method: 'POST',
      url: '/api/invitations',
      cookies: { [SESSION_COOKIE]: founder },
      headers: { [COMPANY_HEADER]: ids.arma, ...headers },
      payload,
    });
  }

  it('refuses a state-changing request from another site', async () => {
    const payload = { email: 'csrf@example.test', role: 'external' };
    const forged: Record<string, string>[] = [
      {},
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site', origin: PANEL_ORIGIN },
      { 'sec-fetch-site': 'same-site', origin: PANEL_ORIGIN },
      { 'sec-fetch-site': 'none' },
    ];
    for (const headers of forged) {
      const res = await invite(headers, payload);
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('cross_site_request');
    }
    for (const [method, url] of [
      ['PUT', '/api/session/company'],
      ['PATCH', `/api/members/${ids.employee}`],
      ['DELETE', `/api/members/${ids.employee}`],
    ] as const) {
      const res = await server.app.inject({
        method,
        url,
        cookies: { [SESSION_COOKIE]: founder },
        headers: { [COMPANY_HEADER]: ids.arma, origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(403);
    }
    const logout = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: founder },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(logout.statusCode).toBe(403);
    // The session survived the forged logout.
    const session = await server.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: founder },
    });
    expect(session.statusCode).toBe(200);
  });

  it('accepts the panel: Sec-Fetch-Site same-origin, or the panel origin without it', async () => {
    const first = await invite(SAME_ORIGIN, { email: 'csrf.one@example.test', role: 'external' });
    expect(first.statusCode).toBe(201);
    const second = await invite(
      { origin: PANEL_ORIGIN },
      { email: 'csrf.two@example.test', role: 'external' },
    );
    expect(second.statusCode).toBe(201);
  });

  it('accepts JSON bodies only', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await invite(
        { ...SAME_ORIGIN, 'content-type': contentType },
        'email=plain@example.test&role=external',
      );
      expect(res.statusCode).toBe(415);
      expect(errorCode(res)).toBe('unsupported_media_type');
    }
    const broken = await invite(
      { ...SAME_ORIGIN, 'content-type': 'application/json' },
      '{"email":',
    );
    expect(broken.statusCode).toBe(400);
    expect(errorCode(broken)).toBe('invalid_request');
  });
});

const GOOGLE = /^https:\/\/accounts\.google\.test\//;
const UNAVAILABLE = '/login?status=unavailable';

describe.skipIf(noDatabase)('rate limits', () => {
  let server: TestServer;

  beforeAll(() => {
    server = createTestServer({ rateLimits: DEFAULT_RATE_LIMITS });
  });
  afterAll(() => server.close());

  function start(remoteAddress: string, headers: Record<string, string> = {}) {
    return server.app.inject({ method: 'GET', url: '/api/auth/google', remoteAddress, headers });
  }

  it('limits sign-in starts per address and then sends the browser to the login page', async () => {
    const address = '198.51.100.1';
    for (let i = 0; i < DEFAULT_RATE_LIMITS.signIn; i += 1) {
      const res = await start(address);
      expect(res.statusCode).toBe(302);
      expect(String(res.headers.location)).toMatch(GOOGLE);
    }
    // A page, not a JSON error: the browser lands on the login screen, which says to try later.
    const limited = await start(address);
    expect(limited.statusCode).toBe(302);
    expect(limited.headers.location).toBe(UNAVAILABLE);
    expect(cookieValue(limited, LOGIN_COOKIE)).toBeUndefined();
    // Another address has its own counter; the other routes have theirs.
    expect(String((await start('203.0.113.7')).headers.location)).toMatch(GOOGLE);
    const session = await server.app.inject({
      method: 'GET',
      url: '/api/session',
      remoteAddress: address,
    });
    expect(session.statusCode).toBe(401);
    // The health check is never limited.
    const health = await server.app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: address,
    });
    expect(health.statusCode).toBe(200);
  });

  it('limits the callback on its own counter, clears the login cookie and redirects', async () => {
    const address = '198.51.100.2';
    const callback = () =>
      server.app.inject({
        method: 'GET',
        url: '/api/auth/google/callback?code=x&state=y',
        remoteAddress: address,
      });
    for (let i = 0; i < DEFAULT_RATE_LIMITS.callback; i += 1) {
      expect((await callback()).headers.location).toBe('/login?status=denied');
    }
    const limited = await callback();
    expect(limited.statusCode).toBe(302);
    expect(limited.headers.location).toBe(UNAVAILABLE);
    expect(limited.headers['content-type']).toBeUndefined();
    // The one-time login cookie is cleared here as on every callback.
    expect(limited.cookies.some((c) => c.name === LOGIN_COOKIE)).toBe(true);
    expect(cookieValue(limited, LOGIN_COOKIE)).toBeUndefined();
    // Starting a sign-in is counted apart.
    expect(String((await start(address)).headers.location)).toMatch(GOOGLE);
  });

  it('does not count logouts against the sign-in limits', async () => {
    const address = '198.51.100.3';
    const logouts = DEFAULT_RATE_LIMITS.signIn + DEFAULT_RATE_LIMITS.callback + 5;
    for (let i = 0; i < logouts; i += 1) {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        remoteAddress: address,
        headers: SAME_ORIGIN,
      });
      expect(res.statusCode).toBe(204);
    }
    expect(String((await start(address)).headers.location)).toMatch(GOOGLE);
  });

  it('answers the other routes with a 429 error body', async () => {
    const limited = createTestServer({
      rateLimits: { ...DEFAULT_RATE_LIMITS, other: 2 },
    });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const res = await limited.app.inject({ method: 'GET', url: '/api/session' });
        statuses.push(res.statusCode);
        if (res.statusCode === 429) {
          expect(errorCode(res)).toBe('rate_limited');
          expect(res.headers['retry-after']).toBeDefined();
        }
      }
      expect(statuses).toEqual([401, 401, 429]);
    } finally {
      await limited.close();
    }
  });

  it('ignores X-Forwarded-For from an untrusted peer', async () => {
    const address = '198.51.100.4';
    for (let i = 0; i < DEFAULT_RATE_LIMITS.signIn; i += 1) {
      await start(address);
    }
    const res = await start(address, { 'x-forwarded-for': '198.51.100.9' });
    expect(res.headers.location).toBe(UNAVAILABLE);
  });
});

// Production: browser, Cloudflare (edge address in 173.245.48.0/20), Caddy (172.18.0.5), API.
// Caddy trusts Cloudflare and passes "client, edge" in X-Forwarded-For.
describe.skipIf(noDatabase)('rate limits behind Cloudflare and Caddy', () => {
  const CADDY = '172.18.0.5';
  const EDGE = '173.245.48.10';

  async function startsFromClients(trustProxy: string): Promise<string[]> {
    const server = createTestServer({
      config: testConfig({ TRUST_PROXY: trustProxy }),
      rateLimits: DEFAULT_RATE_LIMITS,
    });
    try {
      const locations: string[] = [];
      // One sign-in from each of more people than the per-address limit.
      for (let i = 0; i <= DEFAULT_RATE_LIMITS.signIn; i += 1) {
        const res = await server.app.inject({
          method: 'GET',
          url: '/api/auth/google',
          remoteAddress: CADDY,
          headers: { 'x-forwarded-for': `198.51.100.${String(i + 10)}, ${EDGE}` },
        });
        locations.push(String(res.headers.location));
      }
      return locations;
    } finally {
      await server.close();
    }
  }

  it('counts each person apart when both proxies are trusted', async () => {
    const locations = await startsFromClients('172.18.0.0/16, 173.245.48.0/20');
    expect(locations.every((location) => GOOGLE.test(location))).toBe(true);
  });

  it('counts everyone behind one Cloudflare address together when only Caddy is trusted', async () => {
    const locations = await startsFromClients('172.18.0.0/16');
    expect(locations.at(-1)).toBe(UNAVAILABLE);
  });
});
