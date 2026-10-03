import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts, ids } from './fixtures.ts';
import {
  LOGIN_COOKIE,
  SESSION_COOKIE,
  adminQuery,
  claimsOf,
  closeAdminPool,
  cookieValue,
  countLoginEvents,
  createTestServer,
  noDatabase,
  signIn,
  testConfig,
  type TestServer,
} from './helpers.ts';

// Google sign-in through the fake provider (CLAUDE.md rule 3; 3 October decisions 8-11).

const DENIED = '/login?status=denied';
const UNAVAILABLE = '/login?status=unavailable';

describe.skipIf(noDatabase)('Google sign-in', () => {
  let server: TestServer;

  beforeAll(() => {
    server = createTestServer();
  });
  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  async function rejectedCount(reason: string): Promise<number> {
    return countLoginEvents(`event = 'rejected' and reason = $1`, [reason]);
  }

  it('starts with a redirect to Google and a signed, short-lived login cookie', async () => {
    const start = await server.app.inject({ method: 'GET', url: '/api/auth/google' });
    expect(start.statusCode).toBe(302);
    expect(String(start.headers.location)).toMatch(/^https:\/\/accounts\.google\.test\//);
    const cookie = start.cookies.find((c) => c.name === LOGIN_COOKIE);
    expect(cookie).toMatchObject({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 600,
    });
    expect(cookie).not.toHaveProperty('domain');
    // Signed: the value carries a signature after the payload.
    expect(cookie?.value).toMatch(/\.[A-Za-z0-9+/]+$/);
  });

  it('signs the founder in: binds the Google account, sets the session cookie, records the login', async () => {
    const before = await countLoginEvents(`event = 'login' and user_id = $1`, [ids.founder]);
    const { callback, session } = await signIn(server, claimsOf(accounts.founder));
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/');
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = callback.cookies.find((c) => c.name === SESSION_COOKIE && c.value !== '');
    expect(cookie).toMatchObject({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 36_000,
    });
    expect(cookie).not.toHaveProperty('domain');
    // The login cookie is used once.
    expect(cookieValue(callback, LOGIN_COOKIE)).toBeUndefined();
    expect(callback.cookies.some((c) => c.name === LOGIN_COOKIE)).toBe(true);

    const [binding] = await adminQuery<{ google_sub: string }>(
      'select google_sub from office.user_emails where email = $1',
      [accounts.founder.email],
    );
    expect(binding?.google_sub).toBe(accounts.founder.sub);
    expect(await countLoginEvents(`event = 'login' and user_id = $1`, [ids.founder])).toBe(
      before + 1,
    );
    const [open] = await adminQuery<{ n: number; limit_ok: boolean }>(
      `select count(*)::int as n,
              bool_and(absolute_expires_at <= created_at + interval '10 hours') as limit_ok
       from office.sessions where user_id = $1 and closed_at is null`,
      [ids.founder],
    );
    expect(open?.n).toBeGreaterThan(0);
    expect(open?.limit_ok).toBe(true);
  });

  it('lets an invited person in on the first login and turns the invitation into a membership', async () => {
    const { callback, session } = await signIn(server, claimsOf(accounts.invitee));
    expect(callback.headers.location).toBe('/');
    expect(session).toBeDefined();
    const rows = await adminQuery<{ role: string; can_approve: boolean; accepted: boolean }>(
      `select m.role, m.can_approve, i.accepted_at is not null as accepted
       from office.user_emails e
       join office.memberships m on m.user_id = e.user_id and m.company_id = $2
       join office.invitations i on i.id = m.invitation_id
       where e.email = $1`,
      [accounts.invitee.email, ids.arma],
    );
    expect(rows).toEqual([{ role: 'employee', can_approve: false, accepted: true }]);
  });

  it('rejects an address without an invitation or a membership: same redirect, no session', async () => {
    const before = await rejectedCount('not_allowed');
    const { callback, session } = await signIn(server, claimsOf(accounts.stranger));
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(DENIED);
    expect(session).toBeUndefined();
    expect(await rejectedCount('not_allowed')).toBe(before + 1);
    const accounts_ = await adminQuery('select 1 from office.user_emails where email = $1', [
      accounts.stranger.email,
    ]);
    expect(accounts_).toEqual([]);
  });

  it('rejects an address Google has not verified', async () => {
    const before = await rejectedCount('email_unverified');
    const { callback, session } = await signIn(
      server,
      claimsOf(accounts.employee, { email_verified: false }),
    );
    expect(callback.headers.location).toBe(DENIED);
    expect(session).toBeUndefined();
    expect(await rejectedCount('email_unverified')).toBe(before + 1);
  });

  it('accepts a company address only from its own Workspace (hd)', async () => {
    const before = await rejectedCount('not_allowed');
    for (const hd of [undefined, 'other.test']) {
      const { callback, session } = await signIn(
        server,
        claimsOf(accounts.employee, { hd, amr: undefined }),
      );
      expect(callback.headers.location).toBe(DENIED);
      expect(session).toBeUndefined();
    }
    expect(await rejectedCount('not_allowed')).toBe(before + 2);
    // From its Workspace it needs no amr: Workspace enforces two-step verification.
    const { session } = await signIn(server, claimsOf(accounts.employee, { amr: undefined }));
    expect(session).toBeDefined();
  });

  it('rejects an external account without a second factor in amr', async () => {
    const before = await rejectedCount('mfa_missing');
    for (const account of [accounts.external, accounts.lawyer]) {
      for (const amr of [undefined, ['pwd']]) {
        const { callback, session } = await signIn(server, claimsOf(account, { amr }));
        expect(callback.headers.location).toBe(DENIED);
        expect(session).toBeUndefined();
      }
    }
    expect(await rejectedCount('mfa_missing')).toBe(before + 4);
    for (const account of [accounts.external, accounts.lawyer]) {
      const { session } = await signIn(server, claimsOf(account, { amr: ['pwd', 'mfa'] }));
      expect(session).toBeDefined();
    }
  });

  it('rejects an address Google is not authoritative for (no hd, not Gmail)', async () => {
    const before = await rejectedCount('not_allowed');
    const { callback } = await signIn(
      server,
      claimsOf({ email: 'someone@mail.example', sub: 'sub-someone' }),
    );
    expect(callback.headers.location).toBe(DENIED);
    expect(await rejectedCount('not_allowed')).toBe(before + 1);
  });

  it('rejects another Google account for a bound address', async () => {
    const before = await rejectedCount('account_mismatch');
    const { callback, session } = await signIn(
      server,
      claimsOf(accounts.founder, { sub: 'sub-somebody-else' }),
    );
    expect(callback.headers.location).toBe(DENIED);
    expect(session).toBeUndefined();
    expect(await rejectedCount('account_mismatch')).toBe(before + 1);
  });

  it('rejects a callback whose state differs from the login cookie, before calling Google', async () => {
    const start = await server.app.inject({ method: 'GET', url: '/api/auth/google' });
    const loginCookie = cookieValue(start, LOGIN_COOKIE) ?? '';
    const code = server.google.issue(claimsOf(accounts.founder));
    const calls = server.google.callbacks;
    const callback = await server.app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=${code}&state=forged-state`,
      cookies: { [LOGIN_COOKIE]: loginCookie },
    });
    expect(callback.headers.location).toBe(DENIED);
    expect(cookieValue(callback, SESSION_COOKIE)).toBeUndefined();
    expect(server.google.callbacks).toBe(calls);
  });

  it('rejects a callback without the login cookie or with a tampered one', async () => {
    const start = await server.app.inject({ method: 'GET', url: '/api/auth/google' });
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
    const loginCookie = cookieValue(start, LOGIN_COOKIE) ?? '';
    const code = server.google.issue(claimsOf(accounts.founder));
    const calls = server.google.callbacks;
    const variants: Record<string, string>[] = [{}, { [LOGIN_COOKIE]: `x${loginCookie}` }];
    for (const cookies of variants) {
      const callback = await server.app.inject({
        method: 'GET',
        url: `/api/auth/google/callback?code=${code}&state=${state}`,
        cookies,
      });
      expect(callback.headers.location).toBe(DENIED);
      expect(cookieValue(callback, SESSION_COOKIE)).toBeUndefined();
    }
    expect(server.google.callbacks).toBe(calls);
  });

  it('rejects an ID token whose nonce is not the one sent', async () => {
    const { callback, session } = await signIn(
      server,
      claimsOf(accounts.founder, { nonce: 'another-nonce' }),
    );
    expect(callback.headers.location).toBe(DENIED);
    expect(session).toBeUndefined();
  });

  it('sends the person back with "unavailable" when Google fails, "denied" when it refuses', async () => {
    server.google.failure = 'unavailable';
    try {
      const failed = await signIn(server, claimsOf(accounts.founder));
      expect(failed.callback.headers.location).toBe(UNAVAILABLE);
      server.google.failure = 'rejected';
      const refused = await signIn(server, claimsOf(accounts.founder));
      expect(refused.callback.headers.location).toBe(DENIED);
    } finally {
      server.google.failure = null;
    }
  });

  it('keeps addresses, keys, codes and state out of the logs', async () => {
    const lines: string[] = [];
    const logged = createTestServer({ logStream: { write: (line) => lines.push(line) } });
    try {
      const signedIn = await signIn(logged, claimsOf(accounts.founder));
      const rejected = await signIn(logged, claimsOf(accounts.stranger));
      const log = lines.join('');
      expect(log).toContain('/api/auth/google/callback');
      const state = new URL(String(signedIn.start.headers.location)).searchParams.get('state');
      for (const secret of [
        accounts.founder.email,
        accounts.stranger.email,
        signedIn.session ?? 'missing',
        state ?? 'missing',
        cookieValue(rejected.start, LOGIN_COOKIE) ?? 'missing',
        'code-',
      ]) {
        expect(log).not.toContain(secret);
      }
    } finally {
      await logged.close();
    }
  });
});

describe.skipIf(noDatabase)('Google sign-in not configured', () => {
  let server: TestServer;

  beforeAll(() => {
    server = createTestServer({ provider: null });
  });
  afterAll(() => server.close());

  it('sends the person to the login page with "unavailable"', async () => {
    for (const url of ['/api/auth/google', '/api/auth/google/callback?code=x&state=y']) {
      const res = await server.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(UNAVAILABLE);
    }
  });
});

describe.skipIf(noDatabase)('local cookies (http://localhost:5173)', () => {
  let server: TestServer;

  beforeAll(() => {
    server = createTestServer({ config: testConfig({ PANEL_ORIGIN: 'http://localhost:5173' }) });
  });
  afterAll(() => server.close());

  it('uses plain cookie names without Secure', async () => {
    const { start, callback, session } = await signIn(server, claimsOf(accounts.founder), {
      login: 'login',
      session: 'session',
    });
    expect(start.cookies.find((c) => c.name === 'login')).not.toHaveProperty('secure');
    const cookie = callback.cookies.find((c) => c.name === 'session' && c.value !== '');
    expect(session).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie).not.toHaveProperty('secure');
  });
});
