import { apiErrorSchema, sessionResponseSchema } from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionKey } from '../src/session.ts';
import { accounts, ids } from './fixtures.ts';
import {
  COMPANY_COOKIE,
  SAME_ORIGIN,
  SESSION_COOKIE,
  adminQuery,
  claimsOf,
  closeAdminPool,
  cookieValue,
  countLoginEvents,
  createTestServer,
  noDatabase,
  sessionOf,
  signIn,
  type TestServer,
} from './helpers.ts';

// Sessions: 30 minutes idle, 10 hours at most (3 October decision 6); logout and "everywhere".

describe.skipIf(noDatabase)('sessions', () => {
  let server: TestServer;

  beforeAll(() => {
    server = createTestServer();
  });
  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  function getSession(session?: string) {
    return server.app.inject({
      method: 'GET',
      url: '/api/session',
      ...(session === undefined ? {} : { cookies: { [SESSION_COOKIE]: session } }),
    });
  }

  async function sessionRow(session: string) {
    const [row] = await adminQuery<{ id: string; closed: boolean; close_reason: string | null }>(
      `select id, closed_at is not null as closed, close_reason
       from office.sessions where key_hash = $1`,
      [hashSessionKey(session)],
    );
    if (!row) throw new Error('No session row for the key');
    return row;
  }

  it('answers 401 without a session cookie or with a malformed one', async () => {
    for (const session of [undefined, 'not-a-session-key', 'A'.repeat(43)]) {
      const res = await getSession(session);
      expect(res.statusCode).toBe(401);
      expect(apiErrorSchema.parse(res.json()).error.code).toBe('unauthenticated');
    }
  });

  it('returns the person and their memberships', async () => {
    const session = await sessionOf(server, accounts.founder);
    const res = await getSession(session);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = sessionResponseSchema.parse(res.json());
    expect(body.user).toEqual({ id: ids.founder, name: 'Kurucu' });
    expect(body.lastCompanyId).toBeNull();
    expect(body.memberships.map((m) => [m.code, m.role, m.kind])).toEqual([
      ['armadx', 'founder', 'company'],
      ['pillika', 'founder', 'company'],
      ['founder_space', 'founder', 'private_space'],
    ]);
  });

  it('shows an employee only their own membership', async () => {
    const session = await sessionOf(server, accounts.employee, { amr: undefined });
    const body = sessionResponseSchema.parse((await getSession(session)).json());
    expect(body.memberships).toEqual([
      {
        companyId: ids.arma,
        code: 'armadx',
        name: 'Arma DX',
        kind: 'company',
        role: 'employee',
        canApprove: false,
      },
    ]);
  });

  it('remembers the selected company, only one the person is a member of', async () => {
    const session = await sessionOf(server, accounts.founder);
    const put = (companyId: string, headers: Record<string, string> = SAME_ORIGIN) =>
      server.app.inject({
        method: 'PUT',
        url: '/api/session/company',
        cookies: { [SESSION_COOKIE]: session },
        headers,
        payload: { companyId },
      });
    expect((await put(ids.pillika)).statusCode).toBe(204);
    expect(sessionResponseSchema.parse((await getSession(session)).json()).lastCompanyId).toBe(
      ids.pillika,
    );
    const foreign = await put(ids.otherCompany);
    expect(foreign.statusCode).toBe(403);
    expect(apiErrorSchema.parse(foreign.json()).error.code).toBe('forbidden');
    const invalid = await server.app.inject({
      method: 'PUT',
      url: '/api/session/company',
      cookies: { [SESSION_COOKIE]: session },
      headers: SAME_ORIGIN,
      payload: { companyId: 'armadx' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalid.json()).error.code).toBe('invalid_request');
  });

  it('opens the remembered company again at the next sign-in on the same browser', async () => {
    const first = await sessionOf(server, accounts.founder);
    const put = await server.app.inject({
      method: 'PUT',
      url: '/api/session/company',
      cookies: { [SESSION_COOKIE]: first },
      headers: SAME_ORIGIN,
      payload: { companyId: ids.pillika },
    });
    expect(put.statusCode).toBe(204);
    const company = put.cookies.find((c) => c.name === COMPANY_COOKIE);
    expect(company).toMatchObject({
      value: ids.pillika,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
    expect(company).not.toHaveProperty('domain');

    // The first session ends (here by logout; idle expiry is the same), then a new sign-in.
    await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: first },
      headers: SAME_ORIGIN,
    });
    const next = await signIn(server, claimsOf(accounts.founder), undefined, {
      [COMPANY_COOKIE]: ids.pillika,
    });
    expect(next.callback.headers.location).toBe('/');
    expect(next.session).toBeDefined();
    const body = sessionResponseSchema.parse((await getSession(next.session)).json());
    expect(body.lastCompanyId).toBe(ids.pillika);
  });

  it('drops a remembered company the person is not a member of, and clears its cookie', async () => {
    for (const remembered of [ids.otherCompany, ids.pillika]) {
      // The employee is a member of Arma DX only; Pillika may be another person's choice here.
      const res = await signIn(server, claimsOf(accounts.employee, { amr: undefined }), undefined, {
        [COMPANY_COOKIE]: remembered,
      });
      expect(res.callback.headers.location).toBe('/');
      const body = sessionResponseSchema.parse((await getSession(res.session)).json());
      expect(body.lastCompanyId).toBeNull();
      expect(res.callback.cookies.some((c) => c.name === COMPANY_COOKIE)).toBe(true);
      expect(cookieValue(res.callback, COMPANY_COOKIE)).toBeUndefined();
    }
    // A value that is not a company id is ignored and cleared too.
    const junk = await signIn(server, claimsOf(accounts.founder), undefined, {
      [COMPANY_COOKIE]: 'armadx',
    });
    expect(junk.session).toBeDefined();
    expect(
      sessionResponseSchema.parse((await getSession(junk.session)).json()).lastCompanyId,
    ).toBeNull();
    expect(junk.callback.cookies.some((c) => c.name === COMPANY_COOKIE)).toBe(true);
    expect(cookieValue(junk.callback, COMPANY_COOKIE)).toBeUndefined();
  });

  it('closes a session idle for more than 30 minutes and answers 401', async () => {
    const session = await sessionOf(server, accounts.founder);
    const { id } = await sessionRow(session);
    await adminQuery(
      `update office.sessions set last_seen_at = now() - interval '40 minutes' where id = $1`,
      [id],
    );
    const res = await getSession(session);
    expect(res.statusCode).toBe(401);
    // The dead cookie is cleared.
    expect(res.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(true);
    expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
    // verify_session closed it, and the transaction was committed.
    expect(await sessionRow(session)).toMatchObject({ closed: true, close_reason: 'expired' });
    expect(
      await countLoginEvents(
        `event = 'session_expired' and reason = 'idle_timeout' and session_id = $1`,
        [id],
      ),
    ).toBe(1);
  });

  it('logs out: closes the session, clears the cookie, records the logout', async () => {
    const session = await sessionOf(server, accounts.founder);
    const { id } = await sessionRow(session);
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: session },
      headers: SAME_ORIGIN,
    });
    expect(res.statusCode).toBe(204);
    expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({
      path: '/',
      secure: true,
      httpOnly: true,
    });
    expect(await sessionRow(session)).toMatchObject({ closed: true, close_reason: 'logout' });
    expect(await countLoginEvents(`event = 'logout' and session_id = $1`, [id])).toBe(1);
    expect((await getSession(session)).statusCode).toBe(401);
    // Logging out again, or without a session, is not an error.
    const again = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: session },
      headers: SAME_ORIGIN,
    });
    expect(again.statusCode).toBe(204);
  });

  it('logs out everywhere: every session of the person closes', async () => {
    const first = await sessionOf(server, accounts.traveller);
    const second = await sessionOf(server, accounts.traveller);
    const other = await sessionOf(server, accounts.founder);
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout-all',
      cookies: { [SESSION_COOKIE]: first },
      headers: SAME_ORIGIN,
    });
    expect(res.statusCode).toBe(204);
    expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
    for (const session of [first, second]) {
      expect(await sessionRow(session)).toMatchObject({ closed: true, close_reason: 'logout_all' });
      expect((await getSession(session)).statusCode).toBe(401);
    }
    expect((await getSession(other)).statusCode).toBe(200);
    expect(await countLoginEvents(`event = 'logout_all' and user_id = $1`, [ids.traveller])).toBe(
      1,
    );
    // Without a live session there is nobody to log out everywhere.
    const dead = await server.app.inject({
      method: 'POST',
      url: '/api/auth/logout-all',
      cookies: { [SESSION_COOKIE]: first },
      headers: SAME_ORIGIN,
    });
    expect(dead.statusCode).toBe(401);
  });
});
