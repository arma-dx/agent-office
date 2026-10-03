import {
  COMPANY_HEADER,
  apiErrorSchema,
  memberListSchema,
  memberSchema,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts, ids } from './fixtures.ts';
import {
  SAME_ORIGIN,
  SESSION_COOKIE,
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';

// Memberships of the selected company: founder only; the founder role is never granted here.

describe.skipIf(noDatabase)('members', () => {
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

  function request(
    method: 'GET' | 'PATCH' | 'DELETE',
    url: string,
    options: { session?: string; company?: string; payload?: object } = {},
  ) {
    return server.app.inject({
      method,
      url,
      cookies: { [SESSION_COOKIE]: options.session ?? founder },
      headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: options.company ?? ids.arma },
      ...(options.payload ? { payload: options.payload } : {}),
    });
  }

  function errorCode(res: { json: () => unknown }): string {
    return apiErrorSchema.parse(res.json()).error.code;
  }

  it('lists the members of the selected company with name, role and status', async () => {
    const res = await request('GET', '/api/members');
    expect(res.statusCode).toBe(200);
    const { members } = memberListSchema.parse(res.json());
    expect(members.find((m) => m.userId === ids.founder)).toEqual({
      userId: ids.founder,
      name: 'Kurucu',
      role: 'founder',
      canApprove: true,
      active: true,
    });
    expect(members.find((m) => m.userId === ids.changer)).toMatchObject({
      role: 'employee',
      canApprove: true,
    });
    expect(members.some((m) => m.userId === ids.otherFounder)).toBe(false);
  });

  it('is founder only', async () => {
    const employee = await sessionOf(server, accounts.employee, { amr: undefined });
    for (const [method, url] of [
      ['GET', '/api/members'],
      ['PATCH', `/api/members/${ids.leaver}`],
      ['DELETE', `/api/members/${ids.leaver}`],
    ] as const) {
      const res = await request(method, url, {
        session: employee,
        payload: method === 'PATCH' ? { canApprove: true } : undefined,
      });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('founder_only');
    }
  });

  it('changes the role and the approval right; only an employee keeps the approval right', async () => {
    const url = `/api/members/${ids.changer}`;
    const external = await request('PATCH', url, { payload: { role: 'external' } });
    expect(external.statusCode).toBe(200);
    expect(memberSchema.parse(external.json())).toMatchObject({
      role: 'external',
      canApprove: false,
    });

    const refused = await request('PATCH', url, { payload: { canApprove: true } });
    expect(refused.statusCode).toBe(400);
    expect(errorCode(refused)).toBe('approval_only_employee');

    const employee = await request('PATCH', url, {
      payload: { role: 'employee', canApprove: true },
    });
    expect(memberSchema.parse(employee.json())).toMatchObject({
      role: 'employee',
      canApprove: true,
    });
    const withdrawn = await request('PATCH', url, { payload: { canApprove: false } });
    expect(memberSchema.parse(withdrawn.json())).toMatchObject({
      role: 'employee',
      canApprove: false,
    });
  });

  it('never grants the founder role and validates the request', async () => {
    for (const payload of [{ role: 'founder' }, {}, { canApprove: 'yes' }]) {
      const res = await request('PATCH', `/api/members/${ids.changer}`, { payload });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    const founderRight = await request('PATCH', `/api/members/${ids.founder}`, {
      payload: { canApprove: false },
    });
    expect(founderRight.statusCode).toBe(409);
    expect(errorCode(founderRight)).toBe('founder_membership');
  });

  it('never changes or removes a founder membership, the own one included', async () => {
    for (const company of [ids.arma, ids.founderSpace]) {
      for (const payload of [{ role: 'employee' }, { role: 'external' }, { canApprove: false }]) {
        const res = await request('PATCH', `/api/members/${ids.founder}`, { company, payload });
        expect(res.statusCode).toBe(409);
        expect(errorCode(res)).toBe('founder_membership');
      }
      const remove = await request('DELETE', `/api/members/${ids.founder}`, { company });
      expect(remove.statusCode).toBe(409);
      expect(errorCode(remove)).toBe('founder_membership');
    }
  });

  it('does not let one founder demote or remove another founder', async () => {
    // A second founder of Arma DX, only for this test.
    const second = '00000000-0000-4000-8000-000000000019';
    await adminExec(`
      insert into office.users (id, name) values ('${second}', 'İkinci Kurucu');
      insert into office.memberships (company_id, user_id, role, can_approve)
        values ('${ids.arma}', '${second}', 'founder', true);
    `);
    try {
      for (const payload of [{ role: 'external' }, { role: 'employee' }, { canApprove: false }]) {
        const res = await request('PATCH', `/api/members/${second}`, { payload });
        expect(res.statusCode).toBe(409);
        expect(errorCode(res)).toBe('founder_membership');
      }
      const remove = await request('DELETE', `/api/members/${second}`);
      expect(remove.statusCode).toBe(409);
      expect(errorCode(remove)).toBe('founder_membership');
      expect(
        await adminQuery('select role, can_approve from office.memberships where user_id = $1', [
          second,
        ]),
      ).toEqual([{ role: 'founder', can_approve: true }]);
    } finally {
      await adminExec(`
        delete from office.memberships where user_id = '${second}';
        delete from office.users where id = '${second}';
      `);
    }
  });

  it('removes a membership; the person can no longer sign in and their sessions close', async () => {
    const leaver = await sessionOf(server, accounts.leaver, { amr: undefined });
    const res = await request('DELETE', `/api/members/${ids.leaver}`);
    expect(res.statusCode).toBe(204);
    const session = await server.app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [SESSION_COOKIE]: leaver },
    });
    expect(session.statusCode).toBe(401);
    const memberships = await adminQuery('select 1 from office.memberships where user_id = $1', [
      ids.leaver,
    ]);
    expect(memberships).toEqual([]);
    expect((await request('DELETE', `/api/members/${ids.leaver}`)).statusCode).toBe(404);
  });

  it('answers 404 for a person who is not a member of the company', async () => {
    for (const userId of [ids.otherFounder, 'not-a-uuid']) {
      const res = await request('PATCH', `/api/members/${userId}`, {
        payload: { canApprove: false },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});
