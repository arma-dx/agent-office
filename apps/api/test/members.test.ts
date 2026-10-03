import {
  COMPANY_HEADER,
  apiErrorSchema,
  memberChangeDetails,
  memberListSchema,
  memberSchema,
  type StepUp,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SoftwareAuthenticator } from './authenticator.ts';
import { accounts, ids } from './fixtures.ts';
import {
  PANEL_ORIGIN,
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
import { challengeState, freshPasskey, signStepUp } from './passkey-helpers.ts';

// Memberships of the selected company: founder only; the founder role is never granted here.
// Changing a role or the approval right and removing a membership need a passkey re-verification
// for exactly that change (3 October decision 7).

type Change = Parameters<typeof memberChangeDetails>[0];

describe.skipIf(noDatabase)('members', () => {
  let server: TestServer;
  let founder: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
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

  /** The founder's passkey confirms a change of the member in the company. */
  function confirm(
    change: Change,
    options: { userId?: string; company?: string; session?: string } = {},
  ): Promise<StepUp> {
    return signStepUp(server, options.session ?? founder, founderKey, {
      purpose: 'membership_change',
      companyId: options.company ?? ids.arma,
      subjectId: options.userId ?? ids.changer,
      details: memberChangeDetails(change),
    });
  }

  /** A confirmed PATCH of the member. */
  async function change(userId: string, update: Exclude<Change, 'remove'>) {
    const stepUp = await confirm(update, { userId });
    return request('PATCH', `/api/members/${userId}`, { payload: { ...update, stepUp } });
  }

  async function membership(userId: string): Promise<Record<string, unknown>[]> {
    return adminQuery(
      'select role, can_approve from office.memberships where company_id = $1 and user_id = $2',
      [ids.arma, userId],
    );
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
    const external = await change(ids.changer, { role: 'external' });
    expect(external.statusCode).toBe(200);
    expect(memberSchema.parse(external.json())).toMatchObject({
      role: 'external',
      canApprove: false,
    });

    // Refused before any re-verification is asked for.
    const refused = await request('PATCH', url, { payload: { canApprove: true } });
    expect(refused.statusCode).toBe(400);
    expect(errorCode(refused)).toBe('approval_only_employee');

    const employee = await change(ids.changer, { role: 'employee', canApprove: true });
    expect(memberSchema.parse(employee.json())).toMatchObject({
      role: 'employee',
      canApprove: true,
    });
    const withdrawn = await change(ids.changer, { canApprove: false });
    expect(memberSchema.parse(withdrawn.json())).toMatchObject({
      role: 'employee',
      canApprove: false,
    });
  });

  it('changes a role, the approval right or a membership only with a passkey re-verification', async () => {
    const before = await membership(ids.changer);
    const url = `/api/members/${ids.changer}`;
    for (const [method, payload] of [
      ['PATCH', { role: 'external' }],
      ['PATCH', { canApprove: true }],
      ['DELETE', undefined],
      ['DELETE', {}],
    ] as const) {
      const res = await request(method, url, { payload });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('step_up_required');
    }
    expect(await membership(ids.changer)).toEqual(before);
  });

  it('accepts a re-verification only for the change it was signed for', async () => {
    const session = await sessionOf(server, accounts.founder);
    const before = await membership(ids.changer);
    const url = `/api/members/${ids.changer}`;
    // Each re-verification is signed right before it is sent: a new challenge for the same change in
    // the same session replaces the older one (a dialog opened again).
    const cases: { stepUp: () => Promise<StepUp>; method: 'PATCH' | 'DELETE'; payload: object }[] =
      [
        // For another member.
        {
          stepUp: () => confirm({ role: 'external' }, { session, userId: ids.traveller }),
          method: 'PATCH',
          payload: { role: 'external' },
        },
        // For another change of the same member.
        {
          stepUp: () => confirm({ role: 'external' }, { session }),
          method: 'PATCH',
          payload: { canApprove: true },
        },
        {
          stepUp: () => confirm({ role: 'external' }, { session }),
          method: 'PATCH',
          payload: { role: 'external', canApprove: false },
        },
        // For the same member in another company.
        {
          stepUp: () => confirm({ role: 'external' }, { session, company: ids.pillika }),
          method: 'PATCH',
          payload: { role: 'external' },
        },
        // To remove the member, sent to change the role, and the other way round.
        {
          stepUp: () => confirm('remove', { session }),
          method: 'PATCH',
          payload: { role: 'external' },
        },
        { stepUp: () => confirm({ role: 'external' }, { session }), method: 'DELETE', payload: {} },
      ];
    for (const { stepUp: sign, method, payload } of cases) {
      const stepUp = await sign();
      const res = await request(method, url, { session, payload: { ...payload, stepUp } });
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
      // The failed attempt is kept, although the request failed.
      expect(await challengeState(stepUp.challengeId)).toEqual({
        failed_attempts: 1,
        consumed: false,
      });
    }
    expect(await membership(ids.changer)).toEqual(before);
  });

  it('uses a re-verification once; the database records who confirmed which change', async () => {
    const url = `/api/members/${ids.changer}`;
    const update = { role: 'employee', canApprove: true } as const;
    const stepUp = await confirm(update);
    const res = await request('PATCH', url, { payload: { ...update, stepUp } });
    expect(res.statusCode).toBe(200);
    const replay = await request('PATCH', url, { payload: { ...update, stepUp } });
    expect(replay.statusCode).toBe(403);
    expect(errorCode(replay)).toBe('step_up_failed');
    expect(
      await adminQuery(
        `select purpose, company_id, subject_id, consumed_at is not null as consumed
         from office.step_ups where user_id = $1
         order by verified_at desc limit 1`,
        [ids.founder],
      ),
    ).toEqual([
      {
        purpose: 'membership_change',
        company_id: ids.arma,
        subject_id: ids.changer,
        consumed: true,
      },
    ]);
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
    const stepUp = await confirm('remove', { userId: ids.leaver });
    const res = await request('DELETE', `/api/members/${ids.leaver}`, { payload: { stepUp } });
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
    expect(
      (await request('DELETE', `/api/members/${ids.leaver}`, { payload: { stepUp } })).statusCode,
    ).toBe(404);
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
