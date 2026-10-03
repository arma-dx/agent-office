import {
  COMPANY_HEADER,
  apiErrorSchema,
  invitationListSchema,
  invitationSchema,
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

// Invitations: founder only, employee or external, 7 days, renewable up to 30 days (3 October
// decision 9).

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(noDatabase)('invitations', () => {
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
    method: 'GET' | 'POST',
    url: string,
    options: { session?: string; company?: string | null; payload?: object } = {},
  ) {
    const company = options.company === undefined ? ids.arma : options.company;
    return server.app.inject({
      method,
      url,
      cookies: { [SESSION_COOKIE]: options.session ?? founder },
      headers: { ...SAME_ORIGIN, ...(company === null ? {} : { [COMPANY_HEADER]: company }) },
      ...(options.payload ? { payload: options.payload } : {}),
    });
  }

  function errorCode(res: { json: () => unknown }): string {
    return apiErrorSchema.parse(res.json()).error.code;
  }

  it('needs the company header of a company the person belongs to', async () => {
    for (const company of [null, 'not-a-uuid', ids.otherCompany]) {
      const res = await request('GET', '/api/invitations', { company });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('forbidden');
    }
  });

  it('is founder only', async () => {
    const employee = await sessionOf(server, accounts.employee, { amr: undefined });
    for (const [method, url] of [
      ['GET', '/api/invitations'],
      ['POST', '/api/invitations'],
      ['POST', `/api/invitations/${ids.invitation}/renew`],
      ['POST', `/api/invitations/${ids.invitation}/cancel`],
    ] as const) {
      const res = await request(method, url, {
        session: employee,
        payload: method === 'POST' ? { email: 'a@example.test', role: 'external' } : undefined,
      });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('founder_only');
    }
  });

  it('lists the company invitations with their status', async () => {
    const res = await request('GET', '/api/invitations');
    expect(res.statusCode).toBe(200);
    const { invitations } = invitationListSchema.parse(res.json());
    expect(invitations.map((i) => i.id)).toContain(ids.invitation);
    // Pillika's founder view does not show Arma DX invitations.
    const pillika = invitationListSchema.parse(
      (await request('GET', '/api/invitations', { company: ids.pillika })).json(),
    );
    expect(pillika.invitations.map((i) => i.id)).not.toContain(ids.invitation);
  });

  it('creates, refuses a second pending one, renews and cancels', async () => {
    const created = await request('POST', '/api/invitations', {
      payload: { email: 'New.Person@Example.test', role: 'employee', canApprove: true },
    });
    expect(created.statusCode).toBe(201);
    const invitation = invitationSchema.parse(created.json());
    expect(invitation).toMatchObject({
      email: 'new.person@example.test',
      role: 'employee',
      canApprove: true,
      status: 'pending',
    });
    const validity = Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt);
    expect(validity).toBe(7 * DAY_MS);

    const duplicate = await request('POST', '/api/invitations', {
      payload: { email: 'new.person@example.test', role: 'external' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(errorCode(duplicate)).toBe('invitation_exists');

    const renewed = await request('POST', `/api/invitations/${invitation.id}/renew`);
    expect(renewed.statusCode).toBe(200);
    const renewal = invitationSchema.parse(renewed.json());
    expect(Date.parse(renewal.expiresAt)).toBeGreaterThanOrEqual(Date.parse(invitation.expiresAt));

    const cancelled = await request('POST', `/api/invitations/${invitation.id}/cancel`);
    expect(cancelled.statusCode).toBe(204);
    expect((await request('POST', `/api/invitations/${invitation.id}/cancel`)).statusCode).toBe(
      204,
    );
    const closed = await request('POST', `/api/invitations/${invitation.id}/renew`);
    expect(closed.statusCode).toBe(409);
    expect(errorCode(closed)).toBe('invitation_closed');

    const list = invitationListSchema.parse((await request('GET', '/api/invitations')).json());
    expect(list.invitations.find((i) => i.id === invitation.id)?.status).toBe('cancelled');
    // After cancelling, the address can be invited again.
    const again = await request('POST', '/api/invitations', {
      payload: { email: 'new.person@example.test', role: 'external' },
    });
    expect(again.statusCode).toBe(201);
  });

  it('renews an old invitation only up to 30 days after it was created', async () => {
    // Invitations created 25 and 31 days ago, both expired: prepared with the trigger off, which
    // would stamp the current time.
    await adminExec(`
      begin;
      alter table office.invitations disable trigger check_invitation;
      insert into office.invitations
        (company_id, email, role, invited_by_user_id, created_at, expires_at)
      values
        ('${ids.arma}', 'old.invite@example.test', 'external', '${ids.founder}',
         now() - interval '25 days', now() - interval '18 days'),
        ('${ids.arma}', 'older.invite@example.test', 'external', '${ids.founder}',
         now() - interval '31 days', now() - interval '24 days');
      alter table office.invitations enable trigger check_invitation;
      commit;
    `);
    const rows = await adminQuery<{ id: string; email: string }>(
      `select id, email from office.invitations where email like 'old%.invite@example.test'`,
    );
    const old = rows.find((r) => r.email === 'old.invite@example.test');
    const older = rows.find((r) => r.email === 'older.invite@example.test');

    const renewed = await request('POST', `/api/invitations/${old?.id ?? ''}/renew`);
    expect(renewed.statusCode).toBe(200);
    const invitation = invitationSchema.parse(renewed.json());
    expect(invitation.status).toBe('pending');
    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)).toBe(30 * DAY_MS);

    const limit = await request('POST', `/api/invitations/${older?.id ?? ''}/renew`);
    expect(limit.statusCode).toBe(409);
    expect(errorCode(limit)).toBe('invitation_limit');
  });

  it('keeps an expired invitation open until it is cancelled, then invites the address again', async () => {
    await adminExec(`
      begin;
      alter table office.invitations disable trigger check_invitation;
      insert into office.invitations
        (company_id, email, role, invited_by_user_id, created_at, expires_at)
      values
        ('${ids.arma}', 'expired.invite@example.test', 'external', '${ids.founder}',
         now() - interval '40 days', now() - interval '10 days');
      alter table office.invitations enable trigger check_invitation;
      commit;
    `);
    const [expired] = await adminQuery<{ id: string }>(
      `select id from office.invitations where email = 'expired.invite@example.test'`,
    );
    const id = expired?.id ?? '';
    const list = invitationListSchema.parse((await request('GET', '/api/invitations')).json());
    expect(list.invitations.find((i) => i.id === id)?.status).toBe('expired');

    // Past 30 days it cannot be renewed, and the address cannot be invited while it is open.
    const renew = await request('POST', `/api/invitations/${id}/renew`);
    expect(renew.statusCode).toBe(409);
    expect(errorCode(renew)).toBe('invitation_limit');
    const blocked = await request('POST', '/api/invitations', {
      payload: { email: 'expired.invite@example.test', role: 'external' },
    });
    expect(blocked.statusCode).toBe(409);
    const body = apiErrorSchema.parse(blocked.json());
    expect(body.error.code).toBe('invitation_exists');
    // The message covers the expired case and names both ways out.
    expect(body.error.message).toMatch(/süresi dolmuş/);
    expect(body.error.message).toMatch(/iptal/);

    expect((await request('POST', `/api/invitations/${id}/cancel`)).statusCode).toBe(204);
    const again = await request('POST', '/api/invitations', {
      payload: { email: 'expired.invite@example.test', role: 'external' },
    });
    expect(again.statusCode).toBe(201);
  });

  it('validates the request and refuses the approval right for an external person', async () => {
    for (const payload of [
      { email: 'not-an-address', role: 'employee' },
      { email: 'x@example.test', role: 'founder' },
      { email: 'x@example.test', role: 'employee', extra: true },
    ]) {
      const res = await request('POST', '/api/invitations', { payload });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    const external = await request('POST', '/api/invitations', {
      payload: { email: 'x@example.test', role: 'external', canApprove: true },
    });
    expect(external.statusCode).toBe(400);
    expect(errorCode(external)).toBe('approval_only_employee');
    const space = await request('POST', '/api/invitations', {
      company: ids.founderSpace,
      payload: { email: 'x@example.test', role: 'employee' },
    });
    expect(space.statusCode).toBe(400);
    expect(errorCode(space)).toBe('private_space');
  });

  it('answers 404 for an unknown invitation or one of another company', async () => {
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-999999999999']) {
      const res = await request('POST', `/api/invitations/${id}/renew`);
      expect(res.statusCode).toBe(404);
    }
    const foreign = await request('POST', `/api/invitations/${ids.invitation}/cancel`, {
      company: ids.pillika,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
