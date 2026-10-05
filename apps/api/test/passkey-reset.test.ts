import { randomUUID } from 'node:crypto';
import {
  COMPANY_HEADER,
  apiErrorSchema,
  passkeyListSchema,
  type StepUp,
  type StepUpOptionsRequest,
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
import {
  addPasskey,
  challengeState,
  errorCode,
  freshPasskey,
  send,
  signStepUp,
  stepUpOptions,
} from './passkey-helpers.ts';

// A founder resets every passkey of a person who lost theirs (5 October decision 3): with a
// passkey re-verification naming that person, never their own or another founder's, and only for a
// person whose every company they run. The person's sessions close, the reset is written to the
// audit log and the person gets a notification. The re-verification purposes of 5 October
// decisions 3 and 4 are checked here too.

interface PersonState {
  activePasskeys: number;
  openSessions: number;
  notifications: number;
  auditRows: number;
}

describe.skipIf(noDatabase)('passkey reset by a founder', () => {
  let server: TestServer;
  let founder: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  const resetteeKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  // Two sessions of the person whose passkeys are reset (a laptop and a phone).
  let laptop: string;
  let phone: string;

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
    laptop = await sessionOf(server, accounts.resettee);
    phone = await sessionOf(server, accounts.resettee);
    await freshPasskey(server, laptop, resetteeKey, ids.resettee, 'Kaybolan telefon');
  });
  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  function reset(
    userId: string,
    options: { session?: string; company?: string; payload?: object } = {},
  ) {
    return send(
      server,
      options.session ?? founder,
      'POST',
      `/api/members/${userId}/passkeys/reset`,
      {
        company: options.company ?? ids.arma,
        ...(options.payload ? { payload: options.payload } : {}),
      },
    );
  }

  /** The founder's passkey confirms the reset of the person's passkeys in the company. */
  function confirm(userId: string, company: string = ids.arma): Promise<StepUp> {
    return signStepUp(server, founder, founderKey, {
      purpose: 'passkey_reset',
      companyId: company,
      subjectId: userId,
    });
  }

  async function stateOf(userId: string): Promise<PersonState> {
    const [row] = await adminQuery<{
      active_passkeys: number;
      open_sessions: number;
      notifications: number;
      audit_rows: number;
    }>(
      `select
         (select count(*)::int from office.passkeys
          where user_id = $1 and revoked_at is null) as active_passkeys,
         (select count(*)::int from office.sessions
          where user_id = $1 and closed_at is null) as open_sessions,
         (select count(*)::int from office.notifications
          where recipient_user_id = $1 and template = 'passkeys_reset') as notifications,
         (select count(*)::int from office.audit_log
          where event = 'passkeys_reset' and record_id = $1) as audit_rows`,
      [userId],
    );
    if (!row) {
      throw new Error('The state query returned no row');
    }
    return {
      activePasskeys: row.active_passkeys,
      openSessions: row.open_sessions,
      notifications: row.notifications,
      auditRows: row.audit_rows,
    };
  }

  function sessionStatus(session: string): Promise<number> {
    return server.app
      .inject({ method: 'GET', url: '/api/session', cookies: { [SESSION_COOKIE]: session } })
      .then((res) => res.statusCode);
  }

  it('opens a re-verification for a reset or an access grant only with what it confirms', async () => {
    const reset = { purpose: 'passkey_reset', companyId: ids.arma, subjectId: ids.resettee };
    const grant = { purpose: 'access_grant', companyId: ids.arma, subjectId: ids.external };
    const note = { recordType: 'note', recordId: randomUUID() };
    for (const payload of [
      // A reset names the company and the person, and nothing else.
      { purpose: 'passkey_reset' },
      { purpose: 'passkey_reset', companyId: ids.arma },
      { purpose: 'passkey_reset', subjectId: ids.resettee },
      { ...reset, details: { reason: 'lost' } },
      // An access grant names the company, the person and the record that is opened.
      grant,
      { purpose: 'access_grant', subjectId: ids.external, details: note },
      { purpose: 'access_grant', companyId: ids.arma, details: note },
      { ...grant, details: { recordType: 'project', recordId: note.recordId } },
      { ...grant, details: { recordType: 'note', recordId: 'not-a-uuid' } },
      { ...grant, details: { ...note, extra: true } },
    ]) {
      const res = await send(server, founder, 'POST', '/api/step-up/options', { payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    const requests: StepUpOptionsRequest[] = [
      { purpose: 'passkey_reset', companyId: ids.arma, subjectId: ids.resettee },
      {
        purpose: 'access_grant',
        companyId: ids.arma,
        subjectId: ids.external,
        details: { recordType: 'task', recordId: note.recordId },
      },
      { purpose: 'access_grant', companyId: ids.arma, subjectId: ids.external, details: note },
    ];
    for (const request of requests) {
      const { options } = await stepUpOptions(server, founder, request);
      expect(options.userVerification).toBe('required');
      // 16 random bytes followed by the hash of what the re-verification confirms.
      expect(Buffer.from(options.challenge, 'base64url')).toHaveLength(48);
    }
  });

  it('is for the founder of the selected company', async () => {
    const before = await stateOf(ids.resettee);
    const signedOut = await server.app.inject({
      method: 'POST',
      url: `/api/members/${ids.resettee}/passkeys/reset`,
      headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma },
    });
    expect(signedOut.statusCode).toBe(401);
    expect(errorCode(signedOut)).toBe('unauthenticated');

    const employee = await sessionOf(server, accounts.employee, { amr: undefined });
    const stepUp = await confirm(ids.resettee);
    for (const payload of [undefined, { stepUp }]) {
      const res = await reset(ids.resettee, { session: employee, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('founder_only');
    }
    // The person themselves cannot do it either.
    const own = await reset(ids.resettee, { session: laptop });
    expect(own.statusCode).toBe(403);
    expect(errorCode(own)).toBe('founder_only');

    // A founder of another company: not for Arma DX, and the person is no member of theirs.
    const otherFounder = await sessionOf(server, accounts.otherFounder);
    const foreign = await reset(ids.resettee, { session: otherFounder });
    expect(foreign.statusCode).toBe(403);
    expect(errorCode(foreign)).toBe('forbidden');
    const notTheirs = await reset(ids.resettee, {
      session: otherFounder,
      company: ids.otherCompany,
    });
    expect(notTheirs.statusCode).toBe(404);

    // The founder's re-verification was neither counted nor used up by another person's request.
    expect(await challengeState(stepUp.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(await stateOf(ids.resettee)).toEqual(before);
  });

  it("refuses the founder's own passkeys before the passkey is asked for", async () => {
    const before = await stateOf(ids.founder);
    const bare = await reset(ids.founder);
    expect(bare.statusCode).toBe(409);
    expect(errorCode(bare)).toBe('passkey_reset_self');
    // The message names the page where a person manages their own passkeys.
    expect(apiErrorSchema.parse(bare.json()).error.message).toMatch(/Güvenlik sayfasını/);

    const stepUp = await confirm(ids.founder);
    for (const company of [ids.arma, ids.founderSpace]) {
      const res = await reset(ids.founder, { company, payload: { stepUp } });
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('passkey_reset_self');
    }
    expect(await challengeState(stepUp.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(await stateOf(ids.founder)).toEqual(before);
    expect(before.activePasskeys).toBe(1);
  });

  it('refuses another founder before the passkey is asked for', async () => {
    // A second founder of Arma DX and of no other company, only for this test: the first founder
    // runs every company of theirs, and still does not reset their passkeys.
    const second = '00000000-0000-4000-8000-000000000024';
    await adminExec(`
      insert into office.users (id, name) values ('${second}', 'İkinci Kurucu');
      insert into office.user_emails (email, user_id)
        values ('second.founder@armadx.test', '${second}');
      insert into office.memberships (company_id, user_id, role, can_approve)
        values ('${ids.arma}', '${second}', 'founder', true);
    `);
    try {
      const theirs = await sessionOf(server, {
        email: 'second.founder@armadx.test',
        sub: 'sub-second-founder',
        hd: 'armadx.test',
      });
      await addPasskey(server, theirs, new SoftwareAuthenticator(PANEL_ORIGIN), 'Kurucu dizüstü');
      const before = await stateOf(second);
      expect(before).toMatchObject({ activePasskeys: 1, openSessions: 1 });

      const bare = await reset(second);
      expect(bare.statusCode).toBe(409);
      expect(errorCode(bare)).toBe('passkey_reset_not_allowed');
      // The membership routes protect a founder the same way.
      const remove = await send(server, founder, 'DELETE', `/api/members/${second}`, {
        company: ids.arma,
      });
      expect(remove.statusCode).toBe(409);
      expect(errorCode(remove)).toBe('founder_membership');

      // Not with the first founder's passkey either; the re-verification is not looked at.
      const stepUp = await confirm(second);
      const res = await reset(second, { payload: { stepUp } });
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('passkey_reset_not_allowed');
      expect(await challengeState(stepUp.challengeId)).toEqual({
        failed_attempts: 0,
        consumed: false,
      });
      expect(await stateOf(second)).toEqual(before);
      expect(await sessionStatus(theirs)).toBe(200);
    } finally {
      await adminExec(`
        delete from office.memberships where user_id = '${second}';
        delete from office.user_emails where user_id = '${second}';
        delete from office.users where id = '${second}';
      `);
    }
  });

  it('refuses a member of a company the founder does not run only after the passkey, and gives no reason', async () => {
    const before = await stateOf(ids.shared);
    // Without the founder's passkey the answer is the one every member gets: a stolen founder
    // session cannot find out who is also a member of another company (rule 9).
    const bare = await reset(ids.shared);
    expect(bare.statusCode).toBe(403);
    expect(errorCode(bare)).toBe('step_up_required');
    const ordinary = await reset(ids.resettee);
    expect(ordinary.statusCode).toBe(bare.statusCode);
    expect(ordinary.json()).toEqual(bare.json());
    // A re-verification that does not check out is answered like for every member too.
    const forOther = await confirm(ids.resettee);
    const wrong = await reset(ids.shared, { payload: { stepUp: forOther } });
    expect(wrong.statusCode).toBe(403);
    expect(errorCode(wrong)).toBe('step_up_failed');

    // With the founder's passkey: refused, and the message says nothing about other companies.
    const stepUp = await confirm(ids.shared);
    const res = await reset(ids.shared, { payload: { stepUp } });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('passkey_reset_not_allowed');
    const message = apiErrorSchema.parse(res.json()).error.message;
    expect(message).toBe(
      "Bu kişinin passkey'leri panelden sıfırlanamaz. Sıfırlama için veritabanı yöneticisine başvurun.",
    );
    expect(message).not.toMatch(/şirket|üye/i);
    // The refusal rolled the re-verification back: it is neither used up nor counted as failed.
    expect(await challengeState(stepUp.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(
      await adminQuery(
        `select 1 from office.step_ups where purpose = 'passkey_reset' and subject_id = $1`,
        [ids.shared],
      ),
    ).toEqual([]);
    expect(await stateOf(ids.shared)).toEqual(before);

    // A person who is no member of the selected company at all, and ids that are none.
    for (const userId of [ids.otherFounder, randomUUID(), 'not-a-uuid']) {
      expect((await reset(userId)).statusCode, userId).toBe(404);
    }
    // The person is a member of Arma DX only: not found from Pillika.
    expect((await reset(ids.resettee, { company: ids.pillika })).statusCode).toBe(404);
  });

  it('resets only with a passkey re-verification and validates the request', async () => {
    const before = await stateOf(ids.resettee);
    expect(before).toMatchObject({ activePasskeys: 1, notifications: 0, auditRows: 0 });
    expect(before.openSessions).toBeGreaterThanOrEqual(2);
    for (const payload of [undefined, {}]) {
      const res = await reset(ids.resettee, payload ? { payload } : {});
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('step_up_required');
    }
    for (const payload of [{ stepUp: 'yes' }, { userId: ids.resettee }, { stepUp: {} }]) {
      const res = await reset(ids.resettee, { payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    expect(await stateOf(ids.resettee)).toEqual(before);
  });

  it('accepts a re-verification only for this person, this company and a reset', async () => {
    const before = await stateOf(ids.resettee);
    // Each re-verification is signed right before it is sent.
    const cases: (() => Promise<StepUp>)[] = [
      // For another person.
      () => confirm(ids.changer),
      // For the same person in another company of the founder.
      () => confirm(ids.resettee, ids.pillika),
      // For another change of the same person.
      () =>
        signStepUp(server, founder, founderKey, {
          purpose: 'membership_change',
          companyId: ids.arma,
          subjectId: ids.resettee,
          details: { action: 'remove' },
        }),
      // For opening a record to the same person.
      () =>
        signStepUp(server, founder, founderKey, {
          purpose: 'access_grant',
          companyId: ids.arma,
          subjectId: ids.resettee,
          details: { recordType: 'note', recordId: randomUUID() },
        }),
    ];
    for (const [index, sign] of cases.entries()) {
      const stepUp = await sign();
      const res = await reset(ids.resettee, { payload: { stepUp } });
      expect(res.statusCode, String(index)).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
      // The failed attempt is kept, although the request failed.
      expect(await challengeState(stepUp.challengeId)).toEqual({
        failed_attempts: 1,
        consumed: false,
      });
    }
    // Signed by the person's own passkey instead of the founder's.
    const foreign = await stepUpOptions(server, founder, {
      purpose: 'passkey_reset',
      companyId: ids.arma,
      subjectId: ids.resettee,
    });
    const byOther = await reset(ids.resettee, {
      payload: {
        stepUp: { challengeId: foreign.challengeId, response: resetteeKey.get(foreign.options) },
      },
    });
    expect(byOther.statusCode).toBe(403);
    expect(errorCode(byOther)).toBe('step_up_failed');
    expect(await stateOf(ids.resettee)).toEqual(before);
  });

  it('resets the passkeys, closes the sessions, writes the audit row and notifies the person', async () => {
    expect(await sessionStatus(laptop)).toBe(200);
    expect(await sessionStatus(phone)).toBe(200);
    const stepUp = await confirm(ids.resettee);
    const res = await reset(ids.resettee, { payload: { stepUp } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    expect(await stateOf(ids.resettee)).toEqual({
      activePasskeys: 0,
      openSessions: 0,
      notifications: 1,
      auditRows: 1,
    });
    // Every device of the person is signed out; the reason is recorded.
    expect(await sessionStatus(laptop)).toBe(401);
    expect(await sessionStatus(phone)).toBe(401);
    expect(
      await adminQuery(
        `select distinct close_reason from office.sessions
         where user_id = $1 and closed_at >= now() - interval '1 minute'`,
        [ids.resettee],
      ),
    ).toEqual([{ close_reason: 'passkeys_reset' }]);

    // The notification of the person: a template and the record, no free text; sent by the founder.
    expect(
      await adminQuery(
        `select company_id, project_id, recipient_user_id, template, record_type, record_id,
                channel, sender_user_id, sender_agent_code, read_at
         from office.notifications where recipient_user_id = $1`,
        [ids.resettee],
      ),
    ).toEqual([
      {
        company_id: ids.arma,
        project_id: null,
        recipient_user_id: ids.resettee,
        template: 'passkeys_reset',
        record_type: 'user',
        record_id: ids.resettee,
        channel: 'panel',
        sender_user_id: ids.founder,
        sender_agent_code: null,
        read_at: null,
      },
    ]);
    expect(
      await adminQuery(
        `select company_id, user_id, agent_code, record_type, record_id
         from office.audit_log where event = 'passkeys_reset' and record_id = $1`,
        [ids.resettee],
      ),
    ).toEqual([
      {
        company_id: ids.arma,
        user_id: ids.founder,
        agent_code: null,
        record_type: 'user',
        record_id: ids.resettee,
      },
    ]);
    // The re-verification names the reset and the person, and is used up.
    expect(
      await adminQuery(
        `select purpose, company_id, subject_id, consumed_at is not null as consumed
         from office.step_ups where user_id = $1
         order by verified_at desc limit 1`,
        [ids.founder],
      ),
    ).toEqual([
      { purpose: 'passkey_reset', company_id: ids.arma, subject_id: ids.resettee, consumed: true },
    ]);
    expect(await challengeState(stepUp.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: true,
    });

    // Replayed, the re-verification is refused and nothing is written twice.
    const replay = await reset(ids.resettee, { payload: { stepUp } });
    expect(replay.statusCode).toBe(403);
    expect(errorCode(replay)).toBe('step_up_failed');
    expect(await stateOf(ids.resettee)).toMatchObject({ notifications: 1, auditRows: 1 });

    // The founder stays signed in and keeps their own passkey.
    expect(await sessionStatus(founder)).toBe(200);
    expect(await stateOf(ids.founder)).toMatchObject({ activePasskeys: 1 });
  });

  it('lets the person add a first passkey again after a new Google sign-in', async () => {
    const session = await sessionOf(server, accounts.resettee);
    const list = await send(server, session, 'GET', '/api/passkeys');
    expect(passkeyListSchema.parse(list.json()).passkeys).toEqual([]);
    // The lost passkey no longer opens a re-verification.
    const none = await send(server, session, 'POST', '/api/step-up/options', {
      payload: { purpose: 'passkey_add' },
    });
    expect(none.statusCode).toBe(409);
    expect(errorCode(none)).toBe('no_passkey');

    const replacement = await addPasskey(
      server,
      session,
      new SoftwareAuthenticator(PANEL_ORIGIN),
      'Yeni telefon',
    );
    const after = await send(server, session, 'GET', '/api/passkeys');
    expect(passkeyListSchema.parse(after.json()).passkeys).toEqual([replacement]);
  });

  it('resets a person without a passkey too: their sessions close and they are notified', async () => {
    await adminQuery(
      'update office.passkeys set revoked_at = now() where user_id = $1 and revoked_at is null',
      [ids.resettee],
    );
    const session = await sessionOf(server, accounts.resettee);
    const before = await stateOf(ids.resettee);
    expect(before.activePasskeys).toBe(0);
    const res = await reset(ids.resettee, { payload: { stepUp: await confirm(ids.resettee) } });
    expect(res.statusCode).toBe(204);
    expect(await sessionStatus(session)).toBe(401);
    expect(await stateOf(ids.resettee)).toEqual({
      activePasskeys: 0,
      openSessions: 0,
      notifications: before.notifications + 1,
      auditRows: before.auditRows + 1,
    });
  });
});
