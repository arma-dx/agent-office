import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// Login, sessions, invitations and login events (KALAN-ISLER 0.3; CLAUDE.md rules 3, 9;
// 3 October decisions 6 and 9-11). inTransaction runs with the API's privileges (office_app and
// office_api_private), inWorkerTransaction with the worker's (office_app only).

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const otherFounder: ContextInput = { companyId: ids.otherCompany, userId: ids.otherFounder };
const korA: ContextInput = { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' };

const API_FUNCTIONS = [
  'office.open_session(bytea, text, timestamptz)',
  'office.verify_session(bytea, integer, boolean)',
  'office.close_session(bytea)',
  'office.close_all_sessions()',
  'office.set_last_company(bytea, uuid)',
  'office.complete_login(text, text)',
  'office.record_login_event(text, text, uuid, uuid)',
];
// Internal steps and trigger functions: nobody outside the database calls them.
const INTERNAL_FUNCTIONS = [
  'office.expire_session(uuid, text, text)',
  'office.close_account_sessions()',
  'office.cancel_pending_invitations()',
  'office.is_active_founder(uuid, uuid)',
];

const FOUNDER_EMAIL = 'founder@arma.test';
const FOUNDER_SUB = 'google-sub-founder';
const MEMBERSHIP = 'where company_id = $1 and user_id = $2';

interface LoginResult {
  result: string;
  user_id: string | null;
}

interface Session {
  id: string;
  key: Buffer;
}

interface VerifiedSession {
  session_id: string;
  user_id: string;
  last_company_id: string | null;
}

/** The SHA-256 of a session key: 32 bytes (the raw key never reaches the database). */
function keyHash(): Buffer {
  return randomBytes(32);
}

/** A call of the function with NULL arguments: enough to see whether the role may execute it. */
function nullCall(signature: string): string {
  const [, name = '', args = ''] = /^(.*)\((.*)\)$/.exec(signature) ?? [];
  const values = args
    .split(', ')
    .filter(Boolean)
    .map((type) => `null::${type}`);
  return `select ${name}(${values.join(', ')})`;
}

async function completeLogin(
  tx: Tx,
  email: string,
  sub: string,
  name = 'Test Person',
): Promise<LoginResult> {
  await tx.setContext({ email });
  const [row] = await tx.rows<LoginResult>('select * from office.complete_login($1, $2)', [
    sub,
    name,
  ]);
  if (!row) {
    throw new Error('complete_login returned no row');
  }
  return row;
}

/**
 * The founder's invitation, confirmed with a passkey re-verification for it in the same transaction
 * (3 October decision 7); the API gives a new invitation its id.
 */
async function invite(
  tx: Tx,
  context: ContextInput,
  email: string,
  role: string,
  canApprove = false,
): Promise<string> {
  const id = randomUUID();
  await stepUp(tx, context, 'invitation', id);
  const [row] = await tx.rows<{ id: string }>(
    `insert into office.invitations (id, company_id, email, role, can_approve)
     values ($1, $2, $3, $4, $5) returning id`,
    [id, context.companyId, email, role, canApprove],
  );
  if (!row) {
    throw new Error('Invitation could not be created');
  }
  return row.id;
}

/**
 * Activates or deactivates an account, confirmed with the passkey re-verification it needs (a
 * membership change of the account in the context company). Returns the number of rows changed.
 */
async function setActive(
  tx: Tx,
  context: ContextInput,
  userId: string,
  active: boolean,
): Promise<number> {
  await stepUp(tx, context, 'membership_change', userId);
  return tx.exec('update office.users set active = $2 where id = $1', [userId, active]);
}

/** An expired invitation can only be prepared by the privileged role with the trigger off. */
async function insertExpiredInvitation(tx: Tx, email: string): Promise<string> {
  await tx.exec('alter table office.invitations disable trigger check_invitation');
  const [row] = await tx.rows<{ id: string }>(
    `insert into office.invitations
       (company_id, email, role, invited_by_user_id, created_at, expires_at)
     values ($1, $2, 'employee', $3, now() - interval '10 days', now() - interval '3 days')
     returning id`,
    [ids.arma, email, ids.founder],
  );
  await tx.exec('alter table office.invitations enable trigger check_invitation');
  if (!row) {
    throw new Error('Invitation could not be created');
  }
  return row.id;
}

/** Opens a session in the current login context (complete_login must have returned ok). */
async function openSession(tx: Tx, sub: string, hours = 8): Promise<Session> {
  const key = keyHash();
  const [row] = await tx.rows<{ id: string }>(
    'select office.open_session($1, $2, now() + make_interval(hours => $3::int)) as id',
    [key, sub, hours],
  );
  if (!row) {
    throw new Error('Session could not be opened');
  }
  return { id: row.id, key };
}

async function loginAndOpen(tx: Tx, email: string, sub: string): Promise<Session> {
  expect((await completeLogin(tx, email, sub)).result).toBe('ok');
  return openSession(tx, sub);
}

async function verify(tx: Tx, key: Buffer, idleSeconds = 1800): Promise<VerifiedSession[]> {
  return tx.rows<VerifiedSession>('select * from office.verify_session($1, $2)', [
    key,
    idleSeconds,
  ]);
}

/** How a session ended and the reason its login event gives (privileged transaction only). */
async function sessionEnd(tx: Tx, sessionId: string): Promise<Record<string, unknown>[]> {
  return tx.rows(
    `select s.close_reason, e.reason from office.sessions s
     left join office.login_events e on e.session_id = s.id and e.event = 'session_expired'
     where s.id = $1`,
    [sessionId],
  );
}

describe.skipIf(noDatabase)('identity privileges', () => {
  afterAll(closePools);

  it('only the API runs the login, session and event functions; the worker cannot', async () => {
    const rows = await adminQuery<{ fn: string; api: boolean; worker: boolean; app: boolean }>(
      `select f as fn,
              has_function_privilege('office_api', f, 'execute') as api,
              has_function_privilege('office_worker', f, 'execute') as worker,
              has_function_privilege('office_app', f, 'execute') as app
       from unnest($1::text[]) f`,
      [[...API_FUNCTIONS, 'office.company_kind(uuid)']],
    );
    expect(rows).toEqual(
      [...API_FUNCTIONS, 'office.company_kind(uuid)'].map((fn) => ({
        fn,
        api: true,
        worker: false,
        app: false,
      })),
    );
    // The internal steps are not callable from outside at all.
    const internal = await adminQuery<{ fn: string; api: boolean; worker: boolean }>(
      `select f as fn,
              has_function_privilege('office_api', f, 'execute') as api,
              has_function_privilege('office_worker', f, 'execute') as worker
       from unnest($1::text[]) f`,
      [INTERNAL_FUNCTIONS],
    );
    expect(internal).toEqual(INTERNAL_FUNCTIONS.map((fn) => ({ fn, api: false, worker: false })));
  });

  it('the worker has no privilege on invitations, sessions and login events', async () => {
    const rows = await adminQuery<{ name: string; worker: boolean; api_reads: boolean }>(
      `select t as name,
              has_any_column_privilege('office_worker', 'office.' || t, 'select')
                or has_any_column_privilege('office_worker', 'office.' || t, 'insert')
                or has_any_column_privilege('office_worker', 'office.' || t, 'update') as worker,
              has_any_column_privilege('office_api', 'office.' || t, 'select') as api_reads
       from unnest(array['invitations', 'sessions', 'login_events']) t order by 1`,
    );
    expect(rows).toEqual([
      { name: 'invitations', worker: false, api_reads: true },
      { name: 'login_events', worker: false, api_reads: false },
      { name: 'sessions', worker: false, api_reads: true },
    ]);
    const [keyHashColumn] = await adminQuery<{ readable: boolean }>(
      `select has_column_privilege('office_api', 'office.sessions', 'key_hash', 'select')
         as readable`,
    );
    expect(keyHashColumn?.readable).toBe(false);
  });

  it('a role with only the worker privileges cannot reach invitations, sessions, login events or the API functions', async () => {
    await inWorkerTransaction(async (tx) => {
      const [role] = await tx.rows(
        `select pg_has_role(current_user, 'office_app', 'member') as app,
                pg_has_role(current_user, 'office_api_private', 'member') as api`,
      );
      expect(role).toEqual({ app: true, api: false });
      for (const context of [korA, founderA, {}]) {
        await tx.setContext(context);
        for (const table of ['invitations', 'sessions', 'login_events']) {
          expect((await tx.expectError(`select 1 from office.${table}`)).code, table).toBe('42501');
        }
      }
      await tx.setContext(korA);
      expect(
        (
          await tx.expectError(
            `insert into office.invitations (company_id, email, role)
             values ($1, 'someone@example.test', 'external')`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
      for (const fn of [...API_FUNCTIONS, 'office.company_kind(uuid)']) {
        expect((await tx.expectError(nullCall(fn))).code, fn).toBe('42501');
      }
    });
  });

  it('the new roles cannot log in or bypass row security; only the API is in the private group', async () => {
    const roles = await adminQuery<{ name: string; restricted: boolean }>(
      `select rolname as name,
              not (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole) as restricted
       from pg_roles where rolname in ('office_identity', 'office_api_private') order by 1`,
    );
    expect(roles).toEqual([
      { name: 'office_api_private', restricted: true },
      { name: 'office_identity', restricted: true },
    ]);
    const [members] = await adminQuery<{ api: boolean; worker: boolean }>(
      `select pg_has_role('office_api', 'office_api_private', 'member') as api,
              pg_has_role('office_worker', 'office_api_private', 'member') as worker`,
    );
    expect(members).toEqual({ api: true, worker: false });
  });

  it('the owner of the login functions reaches only the login address and no company data', async () => {
    await inAdminTransaction(async (tx) => {
      await tx.setContext({ email: 'employee.p@example.test' });
      await tx.exec('set local role office_identity');
      expect(await tx.rows('select email from office.user_emails')).toEqual([
        { email: 'employee.p@example.test' },
      ]);
      expect(await tx.count('invitations')).toBe(0);
      // A membership needs a valid invitation of the login address.
      expect(
        (
          await tx.expectError(
            `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'employee')`,
            [ids.arma, ids.employeeP],
          )
        ).code,
      ).toBe('42501');
      for (const sql of [
        'select 1 from office.tasks',
        'select 1 from office.audit_log',
        'select name from office.users',
        `update office.users set name = 'x'`,
        'delete from office.memberships',
        `update office.memberships set role = 'founder'`,
      ]) {
        expect((await tx.expectError(sql)).code, sql).toBe('42501');
      }
      // It only reopens a deactivated account that belongs to no company; it never deactivates.
      expect(await tx.exec('update office.users set active = false')).toBe(0);
    });
  });
});

describe.skipIf(noDatabase)('memberships and accounts', () => {
  afterAll(closePools);

  it('the application cannot add a member and changes only the role and the approval right', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(
            `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'employee')`,
            [ids.arma, ids.employeeP],
          )
        ).code,
      ).toBe('42501');
      for (const sql of [
        'update office.memberships set company_id = $2 where user_id = $1',
        'update office.memberships set user_id = $2 where user_id = $1',
      ]) {
        expect((await tx.expectError(sql, [ids.employeeA, ids.pillika])).code, sql).toBe('42501');
      }
      // A membership change needs the founder's passkey re-verification (3 October decision 7).
      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      expect(
        await tx.exec(`update office.memberships set can_approve = true ${MEMBERSHIP}`, [
          ids.arma,
          ids.employeeA,
        ]),
      ).toBe(1);
    });
    // company_id and user_id never change, for the privileged role either.
    await inAdminTransaction(async (tx) => {
      expect(
        (
          await tx.expectError(
            'update office.memberships set company_id = $2 where company_id = $3 and user_id = $1',
            [ids.employeeA, ids.pillika, ids.arma],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('a company keeps at least one active founder and the founder space keeps its founder', async () => {
    await inTransaction(async (tx) => {
      const demote = `update office.memberships set role = 'employee' ${MEMBERSHIP}`;
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(`delete from office.memberships ${MEMBERSHIP}`, [
            ids.arma,
            ids.founder,
          ])
        ).code,
      ).toBe('23514');
      expect((await tx.expectError(demote, [ids.arma, ids.founder])).code).toBe('23514');

      // A second founder who is deactivated does not count.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      expect(
        await tx.exec(`update office.memberships set role = 'founder' ${MEMBERSHIP}`, [
          ids.arma,
          ids.approverA,
        ]),
      ).toBe(1);
      expect(await setActive(tx, founderA, ids.approverA, false)).toBe(1);
      expect((await tx.expectError(demote, [ids.arma, ids.founder])).code).toBe('23514');

      // With an active second founder the first one can step down; the second is then the last.
      expect(await setActive(tx, founderA, ids.approverA, true)).toBe(1);
      await stepUp(tx, founderA, 'membership_change', ids.founder);
      expect(await tx.exec(demote, [ids.arma, ids.founder])).toBe(1);
      await tx.setContext(approverA);
      expect((await tx.expectError(demote, [ids.arma, ids.approverA])).code).toBe('23514');

      await tx.setContext({ companyId: ids.founderSpace, userId: ids.founder });
      expect(
        (
          await tx.expectError(`delete from office.memberships ${MEMBERSHIP}`, [
            ids.founderSpace,
            ids.founder,
          ])
        ).code,
      ).toBe('23514');
    });
  });

  it('nobody deactivates their own account, and the last active founder is never deactivated', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError('update office.users set active = false where id = $1', [
            ids.founder,
          ])
        ).code,
      ).toBe('42501');
      expect(await tx.rows('select office.my_role() as role')).toEqual([{ role: 'founder' }]);
      // Another founder of the same company can be deactivated while the founder stays active.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.exec(`update office.memberships set role = 'founder' ${MEMBERSHIP}`, [
        ids.arma,
        ids.approverA,
      ]);
      expect(await setActive(tx, founderA, ids.approverA, false)).toBe(1);
    });
    // The context of a second founder who was deactivated in the meantime (two founders
    // deactivating each other; here the privileged role): the other company would be left without
    // an active founder.
    await inAdminTransaction(async (tx) => {
      await tx.exec(
        `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'founder')`,
        [ids.otherCompany, ids.formerEmployee],
      );
      expect(await setActive(tx, otherFounder, ids.formerEmployee, false)).toBe(1);
      await tx.setContext({ companyId: ids.otherCompany, userId: ids.formerEmployee });
      expect(
        (
          await tx.expectError('update office.users set active = false where id = $1', [
            ids.otherFounder,
          ])
        ).code,
      ).toBe('23514');
    });
  });

  it('a deactivated account has no role: it sees no company data and cannot approve', async () => {
    await inTransaction(async (tx) => {
      const roleSql = 'select office.my_role() as role, office.can_approve() as approve';
      await tx.setContext(approverA);
      expect(await tx.rows(roleSql)).toEqual([{ role: 'employee', approve: true }]);
      expect(await tx.count('tasks')).toBeGreaterThan(0);

      expect(await setActive(tx, founderA, ids.approverA, false)).toBe(1);

      await tx.setContext(approverA);
      expect(await tx.rows(roleSql)).toEqual([{ role: null, approve: false }]);
      for (const table of ['tasks', 'notes', 'task_comments', 'approvals', 'customers', 'runs']) {
        expect(await tx.count(table), table).toBe(0);
      }
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
          ids.approvalA,
        ]),
      ).toBe(0);
    });
  });
});

describe.skipIf(noDatabase)('invitations', () => {
  afterAll(closePools);

  it('the founder invites an employee or an external person for 7 days; who and when come from the context', async () => {
    await inTransaction(async (tx) => {
      const id = await invite(tx, founderA, 'new.person@example.test', 'employee', true);
      const [row] = await tx.rows(
        `select invited_by_user_id, created_at = now() as created_now,
                expires_at - created_at = interval '7 days' as seven_days, accepted_at,
                cancelled_at, renewed_at
         from office.invitations where id = $1`,
        [id],
      );
      expect(row).toEqual({
        invited_by_user_id: ids.founder,
        created_now: true,
        seven_days: true,
        accepted_at: null,
        cancelled_at: null,
        renewed_at: null,
      });
      // The inviter, the dates and the outcome cannot be given by the caller.
      for (const [column, value] of [
        ['invited_by_user_id', `'${ids.employeeA}'`],
        ['created_at', `now() - interval '1 day'`],
        ['expires_at', `now() + interval '30 days'`],
        ['accepted_at', 'now()'],
        ['cancelled_at', 'now()'],
      ]) {
        expect(
          (
            await tx.expectError(
              `insert into office.invitations (company_id, email, role, ${String(column)})
               values ($1, 'other@example.test', 'external', ${String(value)})`,
              [ids.arma],
            )
          ).code,
          column,
        ).toBe('42501');
      }
    });
  });

  it('only employees and external persons are invited, and only an employee gets the approval right', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const sql = `insert into office.invitations (company_id, email, role, can_approve)
                   values ($1, $2, $3, $4)`;
      expect((await tx.expectError(sql, [ids.arma, 'f@example.test', 'founder', false])).code).toBe(
        '23514',
      );
      expect((await tx.expectError(sql, [ids.arma, 'x@example.test', 'external', true])).code).toBe(
        '23514',
      );
      expect(
        (await tx.expectError(sql, [ids.arma, 'Upper@example.test', 'external', false])).code,
      ).toBe('23514');
      // One pending invitation per address and company (refused before any re-verification is
      // asked for).
      await invite(tx, founderA, 'twice@example.test', 'external');
      expect(
        (await tx.expectError(sql, [ids.arma, 'twice@example.test', 'employee', false])).code,
      ).toBe('23505');
    });
  });

  it("an employee, an agent and another company's founder cannot invite; nobody invites into the founder space", async () => {
    await inTransaction(async (tx) => {
      const sql = `insert into office.invitations (company_id, email, role)
                   values ($1, 'someone@example.test', 'external')`;
      for (const context of [employeeA, approverA, korA]) {
        await tx.setContext(context);
        expect((await tx.expectError(sql, [ids.arma])).code).toBe('42501');
      }
      // The founder of another company, from their own company's context and from Arma DX's: the
      // row policy refuses it (not a misleading founder space error).
      for (const context of [otherFounder, { companyId: ids.arma, userId: ids.otherFounder }]) {
        await tx.setContext(context);
        const error = await tx.expectError(sql, [ids.arma]);
        expect(error.code).toBe('42501');
        expect(error.message).not.toMatch(/founder space/);
      }
      // The context company decides: the founder of both companies cannot invite into Pillika from
      // Arma DX's context.
      await tx.setContext(founderA);
      expect((await tx.expectError(sql, [ids.pillika])).code).toBe('42501');
      // A company that does not exist.
      expect((await tx.expectError(sql, ['00000000-0000-4000-8000-000000000999'])).code).toBe(
        '23503',
      );
      // The founder is the founder of the founder space too; it still takes no invitation.
      await tx.setContext({ companyId: ids.founderSpace, userId: ids.founder });
      expect((await tx.expectError(sql, [ids.founderSpace])).code).toBe('23514');
    });
  });

  it("only the company's founder reads its invitations", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await tx.rows('select id from office.invitations')).toEqual([{ id: ids.invitationA }]);
      await tx.setContext(founderP);
      expect(await tx.rows('select id from office.invitations')).toEqual([{ id: ids.invitationP }]);
      for (const context of [employeeA, approverA, korA, { email: 'invitee.a@example.test' }]) {
        await tx.setContext(context);
        expect(await tx.count('invitations')).toBe(0);
      }
    });
  });

  it('the founder renews within 30 days of creation or cancels; a closed invitation never changes', async () => {
    await inTransaction(async (tx) => {
      const id = await invite(tx, founderA, 'renew@example.test', 'external');
      await stepUp(tx, founderA, 'invitation', id);
      expect(
        await tx.exec(
          `update office.invitations set expires_at = created_at + interval '20 days' where id = $1`,
          [id],
        ),
      ).toBe(1);
      const [renewed] = await tx.rows(
        'select renewed_at = now() as renewed from office.invitations where id = $1',
        [id],
      );
      expect(renewed).toEqual({ renewed: true });
      expect(
        (
          await tx.expectError(
            `update office.invitations set expires_at = created_at + interval '31 days' where id = $1`,
            [id],
          )
        ).code,
      ).toBe('23514');
      for (const sql of [
        `update office.invitations set email = 'other@example.test' where id = $1`,
        `update office.invitations set role = 'employee' where id = $1`,
        'update office.invitations set accepted_at = now() where id = $1',
        'delete from office.invitations where id = $1',
      ]) {
        expect((await tx.expectError(sql, [id])).code, sql).toBe('42501');
      }
      expect(
        await tx.exec('update office.invitations set cancelled_at = now() where id = $1', [id]),
      ).toBe(1);
      for (const sql of [
        'update office.invitations set cancelled_at = null where id = $1',
        `update office.invitations set expires_at = now() + interval '1 day' where id = $1`,
      ]) {
        expect((await tx.expectError(sql, [id])).code, sql).toBe('23514');
      }
      // A cancelled invitation makes room for a new one to the same address.
      await invite(tx, founderA, 'renew@example.test', 'employee');
    });
    // Only the login function accepts an invitation; the privileged role cannot either, and the
    // founder space never takes one.
    await inAdminTransaction(async (tx) => {
      expect(
        (
          await tx.expectError(
            'update office.invitations set accepted_at = now(), accepted_by_user_id = $2 where id = $1',
            [ids.invitationA, ids.employeeA],
          )
        ).code,
      ).toBe('42501');
      await tx.setContext({ companyId: ids.founderSpace, userId: ids.founder });
      expect(
        (
          await tx.expectError(
            `insert into office.invitations (company_id, email, role)
             values ($1, 'someone@example.test', 'external')`,
            [ids.founderSpace],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('an expired invitation stays pending: a new one to the address waits until it is renewed or cancelled', async () => {
    await inAdminTransaction(async (tx) => {
      const expired = await insertExpiredInvitation(tx, 'late@example.test');
      await tx.setContext(founderA);
      const sql = `insert into office.invitations (company_id, email, role)
                   values ($1, 'late@example.test', 'external')`;
      expect((await tx.expectError(sql, [ids.arma])).code).toBe('23505');
      await stepUp(tx, founderA, 'invitation', expired);
      await tx.exec(
        `update office.invitations set expires_at = now() + interval '1 day' where id = $1`,
        [expired],
      );
      expect((await tx.expectError(sql, [ids.arma])).code).toBe('23505');
      await tx.exec('update office.invitations set cancelled_at = now() where id = $1', [expired]);
      await invite(tx, founderA, 'late@example.test', 'external');
    });
  });
});

describe.skipIf(noDatabase)('completing a login', () => {
  afterAll(closePools);

  it('an address without a valid invitation or a membership is not allowed in', async () => {
    await inTransaction(async (tx) => {
      expect(await completeLogin(tx, 'nobody@example.test', 'google-sub-nobody')).toEqual({
        result: 'not_allowed',
        user_id: null,
      });
      // No account was created.
      expect(await tx.count('user_emails')).toBe(0);
      // A known address whose account is a member of no company.
      expect(await completeLogin(tx, 'former@example.test', 'google-sub-former')).toEqual({
        result: 'not_allowed',
        user_id: ids.formerEmployee,
      });
    });
  });

  it('a seeded address is bound to the Google account at the first login; another Google account is refused', async () => {
    await inTransaction(async (tx) => {
      expect(await completeLogin(tx, FOUNDER_EMAIL, FOUNDER_SUB)).toEqual({
        result: 'ok',
        user_id: ids.founder,
      });
      expect(await tx.rows('select google_sub from office.user_emails')).toEqual([
        { google_sub: FOUNDER_SUB },
      ]);
      expect((await completeLogin(tx, FOUNDER_EMAIL, FOUNDER_SUB)).result).toBe('ok');
      expect(await completeLogin(tx, FOUNDER_EMAIL, 'google-sub-other')).toEqual({
        result: 'account_mismatch',
        user_id: ids.founder,
      });
      // The same Google account logs in with another address of the same person (a renamed
      // Workspace address keeps its Google account), never with another person's address.
      expect(await completeLogin(tx, 'founder@pillika.test', FOUNDER_SUB)).toEqual({
        result: 'ok',
        user_id: ids.founder,
      });
      expect(await completeLogin(tx, 'employee.a@example.test', FOUNDER_SUB)).toEqual({
        result: 'account_mismatch',
        user_id: ids.employeeA,
      });
      expect(await tx.rows('select google_sub from office.user_emails')).toEqual([
        { google_sub: null },
      ]);
      // Letter case of the verified address does not matter.
      expect((await completeLogin(tx, 'FOUNDER@Arma.TEST', FOUNDER_SUB)).result).toBe('ok');
    });
    // The rule holds below the login function too, for the privileged role.
    await inAdminTransaction(async (tx) => {
      await tx.exec('update office.user_emails set google_sub = $1 where email = $2', [
        FOUNDER_SUB,
        FOUNDER_EMAIL,
      ]);
      expect(
        (
          await tx.expectError('update office.user_emails set google_sub = $1 where email = $2', [
            FOUNDER_SUB,
            'employee.a@example.test',
          ])
        ).code,
      ).toBe('23505');
    });
  });

  it('a deactivated account is refused; an invitation does not reopen an account that still has a membership', async () => {
    await inTransaction(async (tx) => {
      // A pending invitation made before the deactivation is cancelled with it.
      const before = await invite(tx, founderP, 'employee.a@example.test', 'external');
      await setActive(tx, founderA, ids.employeeA, false);
      await tx.setContext(founderP);
      expect(
        await tx.rows(
          'select cancelled_at is not null as cancelled from office.invitations where id = $1',
          [before],
        ),
      ).toEqual([{ cancelled: true }]);

      const after = await invite(tx, founderP, 'employee.a@example.test', 'external');
      expect(await completeLogin(tx, 'employee.a@example.test', 'google-sub-a')).toEqual({
        result: 'inactive',
        user_id: ids.employeeA,
      });
      await tx.setContext(founderP);
      expect(
        await tx.rows('select accepted_at, cancelled_at from office.invitations where id = $1', [
          after,
        ]),
      ).toEqual([{ accepted_at: null, cancelled_at: null }]);
      expect(await tx.count('memberships', 'user_id = $1', [ids.employeeA])).toBe(0);
    });
  });

  it('a deactivated person who left every company comes back only with a new invitation', async () => {
    await inTransaction(async (tx) => {
      await invite(tx, founderA, 'ali@example.test', 'employee');
      const first = await completeLogin(tx, 'ali@example.test', 'google-sub-ali', 'Ali');
      expect(first.result).toBe('ok');
      const ali = first.user_id;
      if (ali === null) {
        throw new Error('The login created no account');
      }

      expect(await setActive(tx, founderA, ali, false)).toBe(1);
      await stepUp(tx, founderA, 'membership_change', ali);
      expect(await tx.exec(`delete from office.memberships ${MEMBERSHIP}`, [ids.arma, ali])).toBe(
        1,
      );
      // Nobody can manage the account any more; the old, accepted invitation does not count.
      expect(await tx.exec('update office.users set active = true where id = $1', [ali])).toBe(0);
      expect(await completeLogin(tx, 'ali@example.test', 'google-sub-ali')).toEqual({
        result: 'inactive',
        user_id: ali,
      });

      const again = await invite(tx, founderA, 'ali@example.test', 'external');
      expect(await completeLogin(tx, 'ali@example.test', 'google-sub-ali')).toEqual({
        result: 'ok',
        user_id: ali,
      });
      await tx.setContext({ companyId: ids.arma, userId: ali });
      expect(await tx.rows('select role, invitation_id from office.memberships')).toEqual([
        { role: 'external', invitation_id: again },
      ]);
      expect(await tx.rows('select active from office.users')).toEqual([{ active: true }]);
    });
  });

  it('a first-time invited person gets an account and a membership; the invitation is used once', async () => {
    await inTransaction(async (tx) => {
      const invitation = await invite(tx, founderA, 'new.person@example.test', 'employee', true);
      const first = await completeLogin(tx, 'New.Person@Example.TEST', 'google-sub-new', 'Ayşe');
      expect(first.result).toBe('ok');
      const userId = first.user_id;
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);

      await tx.setContext({ companyId: ids.arma, userId });
      expect(
        await tx.rows('select role, can_approve, invitation_id from office.memberships'),
      ).toEqual([{ role: 'employee', can_approve: true, invitation_id: invitation }]);
      expect(await tx.rows('select name from office.users')).toEqual([{ name: 'Ayşe' }]);

      await tx.setContext(founderA);
      expect(
        await tx.rows(
          `select accepted_by_user_id, accepted_at = now() as accepted_now
           from office.invitations where id = $1`,
          [invitation],
        ),
      ).toEqual([{ accepted_by_user_id: userId, accepted_now: true }]);

      // The second login finds the account and adds nothing.
      expect(await completeLogin(tx, 'new.person@example.test', 'google-sub-new')).toEqual({
        result: 'ok',
        user_id: userId,
      });
      await tx.setContext({ companyId: ids.arma, userId });
      expect(await tx.count('memberships')).toBe(1);
      await tx.setContext(founderA);
      expect(await tx.count('invitations', 'accepted_at is not null')).toBe(1);
    });
  });

  it('a Google account bound to another person does not create a second account', async () => {
    await inTransaction(async (tx) => {
      expect((await completeLogin(tx, FOUNDER_EMAIL, FOUNDER_SUB)).result).toBe('ok');
      await invite(tx, founderA, 'second@example.test', 'external');
      expect(await completeLogin(tx, 'second@example.test', FOUNDER_SUB)).toEqual({
        result: 'account_mismatch',
        user_id: null,
      });
      expect(await tx.count('user_emails')).toBe(0);
      await tx.setContext(founderA);
      expect(await tx.count('invitations', 'accepted_at is not null')).toBe(0);
    });
  });

  it('a cancelled or expired invitation is not accepted; a renewed one is', async () => {
    await inTransaction(async (tx) => {
      const id = await invite(tx, founderA, 'cancelled@example.test', 'external');
      await tx.exec('update office.invitations set cancelled_at = now() where id = $1', [id]);
      expect((await completeLogin(tx, 'cancelled@example.test', 'google-sub-c')).result).toBe(
        'not_allowed',
      );
    });
    await inAdminTransaction(async (tx) => {
      const id = await insertExpiredInvitation(tx, 'expired@example.test');
      expect(await completeLogin(tx, 'expired@example.test', 'google-sub-e')).toEqual({
        result: 'not_allowed',
        user_id: null,
      });
      expect(
        await tx.rows('select accepted_at from office.invitations where id = $1', [id]),
      ).toEqual([{ accepted_at: null }]);

      await stepUp(tx, founderA, 'invitation', id);
      await tx.exec(
        `update office.invitations set expires_at = now() + interval '7 days' where id = $1`,
        [id],
      );
      expect((await completeLogin(tx, 'expired@example.test', 'google-sub-e')).result).toBe('ok');
    });
  });

  it('an invitation is accepted only while its inviter is an active founder of the company', async () => {
    for (const end of ['demoted', 'deactivated']) {
      await inTransaction(async (tx) => {
        await stepUp(tx, founderA, 'membership_change', ids.approverA);
        await tx.exec(`update office.memberships set role = 'founder' ${MEMBERSHIP}`, [
          ids.arma,
          ids.approverA,
        ]);
        const id = await invite(tx, approverA, 'friend@example.test', 'employee', true);
        await tx.setContext(founderA);
        if (end === 'demoted') {
          await stepUp(tx, founderA, 'membership_change', ids.approverA);
          await tx.exec(`update office.memberships set role = 'employee' ${MEMBERSHIP}`, [
            ids.arma,
            ids.approverA,
          ]);
        } else {
          await setActive(tx, founderA, ids.approverA, false);
        }
        expect(await completeLogin(tx, 'friend@example.test', 'google-sub-friend'), end).toEqual({
          result: 'not_allowed',
          user_id: null,
        });
        expect(await tx.count('user_emails'), end).toBe(0);
        // The remaining founder still sees it pending and can cancel it.
        await tx.setContext(founderA);
        expect(
          await tx.rows('select accepted_at, cancelled_at from office.invitations where id = $1', [
            id,
          ]),
          end,
        ).toEqual([{ accepted_at: null, cancelled_at: null }]);
      });
    }
  });

  it('an invitation never changes an existing role and stays pending; removing the member cancels it', async () => {
    await inTransaction(async (tx) => {
      // The accountant is an external person at Arma DX; an employee invitation does not upgrade.
      const upgrade = await invite(tx, founderA, 'accountant@example.test', 'employee', true);
      expect(await completeLogin(tx, 'accountant@example.test', 'google-sub-acc')).toEqual({
        result: 'ok',
        user_id: ids.externalA,
      });
      await tx.setContext({ companyId: ids.arma, userId: ids.externalA });
      expect(
        await tx.rows('select role, can_approve, invitation_id from office.memberships'),
      ).toEqual([{ role: 'external', can_approve: false, invitation_id: null }]);
      // Not shown as accepted: the founder does not take it for an upgrade.
      await tx.setContext(founderA);
      const state =
        'select accepted_at, cancelled_at is not null as cancelled from office.invitations where id = $1';
      expect(await tx.rows(state, [upgrade])).toEqual([{ accepted_at: null, cancelled: false }]);

      // Removing the member cancels it, so it never brings the person back with the higher role.
      await stepUp(tx, founderA, 'membership_change', ids.externalA);
      expect(
        await tx.exec(`delete from office.memberships ${MEMBERSHIP}`, [ids.arma, ids.externalA]),
      ).toBe(1);
      expect(await tx.rows(state, [upgrade])).toEqual([{ accepted_at: null, cancelled: true }]);
      expect(await completeLogin(tx, 'accountant@example.test', 'google-sub-acc')).toEqual({
        result: 'not_allowed',
        user_id: ids.externalA,
      });
    });
  });

  it('an existing account joins another company by invitation', async () => {
    await inTransaction(async (tx) => {
      const join = await invite(tx, founderP, 'employee.a@example.test', 'external');
      expect(await completeLogin(tx, 'employee.a@example.test', 'google-sub-a')).toEqual({
        result: 'ok',
        user_id: ids.employeeA,
      });
      await tx.setContext({ companyId: ids.pillika, userId: ids.employeeA });
      expect(
        await tx.rows(
          'select company_id, role, invitation_id from office.memberships order by company_id',
        ),
      ).toEqual([
        { company_id: ids.arma, role: 'employee', invitation_id: null },
        { company_id: ids.pillika, role: 'external', invitation_id: join },
      ]);
    });
  });

  it('runs only in a login context, needs a valid Google account id and leaves the context as it was', async () => {
    await inTransaction(async (tx) => {
      const call = 'select * from office.complete_login($1, $2)';
      for (const context of [
        {},
        { email: FOUNDER_EMAIL, userId: ids.founder },
        { email: FOUNDER_EMAIL, companyId: ids.arma },
        { email: FOUNDER_EMAIL, agentCode: 'KOR-1' },
      ] satisfies ContextInput[]) {
        await tx.setContext(context);
        expect((await tx.expectError(call, [FOUNDER_SUB, 'x'])).code).toBe('42501');
      }
      await tx.setContext({ email: FOUNDER_EMAIL });
      for (const sub of ['', 'with space', 'ğ-non-ascii', null, 'x'.repeat(256)]) {
        expect((await tx.expectError(call, [sub, 'x'])).code, String(sub)).toBe('22023');
      }

      const settings = `select current_setting('app.company_id', true) as company,
        current_setting('app.user_id', true) as user_id, current_setting('app.project_id', true)
        as project, current_setting('app.email', true) as email,
        current_setting('app.agent_code', true) as agent`;
      const before = await tx.rows(settings);
      await tx.rows(call, [FOUNDER_SUB, 'x']);
      expect(await tx.rows(settings)).toEqual(before);
    });
  });
});

describe.skipIf(noDatabase)('sessions', () => {
  afterAll(closePools);

  it('a session is opened only for the Google account bound to the address, an active account and a member', async () => {
    await inTransaction(async (tx) => {
      const open = 'select office.open_session($1, $2, now() + make_interval(hours => $3::int))';
      // The address has not completed a Google login yet.
      await tx.setContext({ email: 'employee.p@example.test' });
      expect((await tx.expectError(open, [keyHash(), 'google-sub-p', 8])).code).toBe('42501');
      // A member of no company.
      expect((await completeLogin(tx, 'former@example.test', 'google-sub-former')).result).toBe(
        'not_allowed',
      );
      expect((await tx.expectError(open, [keyHash(), 'google-sub-former', 8])).code).toBe('42501');

      expect((await completeLogin(tx, FOUNDER_EMAIL, FOUNDER_SUB)).result).toBe('ok');
      // At most 10 hours, in the future, a 32-byte hash.
      expect((await tx.expectError(open, [keyHash(), FOUNDER_SUB, 11])).code).toBe('22023');
      expect((await tx.expectError(open, [keyHash(), FOUNDER_SUB, -1])).code).toBe('22023');
      expect((await tx.expectError(open, [randomBytes(16), FOUNDER_SUB, 8])).code).toBe('22023');
      // Another Google account refused by complete_login gets no session with the address.
      expect((await completeLogin(tx, FOUNDER_EMAIL, 'google-sub-attacker')).result).toBe(
        'account_mismatch',
      );
      for (const sub of ['google-sub-attacker', null]) {
        expect((await tx.expectError(open, [keyHash(), sub, 8])).code, String(sub)).toBe('42501');
      }
      const session = await openSession(tx, FOUNDER_SUB, 10);
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
      // Only in a login context: not with a person, a company or an agent run in the context.
      for (const context of [
        { email: FOUNDER_EMAIL, agentCode: 'KOR-1' },
        { email: FOUNDER_EMAIL, userId: ids.founder },
        { email: FOUNDER_EMAIL, companyId: ids.arma },
      ] satisfies ContextInput[]) {
        await tx.setContext(context);
        expect((await tx.expectError(open, [keyHash(), FOUNDER_SUB, 8])).code).toBe('42501');
      }

      // A deactivated account.
      expect((await completeLogin(tx, 'employee.a@example.test', 'google-sub-a')).result).toBe(
        'ok',
      );
      await setActive(tx, founderA, ids.employeeA, false);
      await tx.setContext({ email: 'employee.a@example.test' });
      expect((await tx.expectError(open, [keyHash(), 'google-sub-a', 8])).code).toBe('42501');
    });
  });

  it('verify finds the session, remembers the company picked last and logout closes it', async () => {
    await inTransaction(async (tx) => {
      const session = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      await tx.setContext({});
      expect(await verify(tx, session.key)).toEqual([
        { session_id: session.id, user_id: ids.founder, last_company_id: null },
      ]);
      expect(await verify(tx, keyHash())).toEqual([]);
      expect(await verify(tx, randomBytes(5))).toEqual([]);
      for (const idle of [59, 1801]) {
        expect(
          (await tx.expectError('select * from office.verify_session($1, $2)', [session.key, idle]))
            .code,
        ).toBe('22023');
      }

      await tx.rows('select office.set_last_company($1, $2)', [session.key, ids.pillika]);
      expect((await verify(tx, session.key))[0]?.last_company_id).toBe(ids.pillika);
      expect(
        (
          await tx.expectError('select office.set_last_company($1, $2)', [
            session.key,
            ids.otherCompany,
          ])
        ).code,
      ).toBe('42501');

      expect(await tx.rows('select office.close_session($1) as id', [session.key])).toEqual([
        { id: session.id },
      ]);
      expect(await verify(tx, session.key)).toEqual([]);
      expect(await tx.rows('select office.close_session($1) as id', [session.key])).toEqual([
        { id: null },
      ]);
      expect(
        (await tx.expectError('select office.set_last_company($1, $2)', [session.key, ids.arma]))
          .code,
      ).toBe('42501');
    });
  });

  it("logging out everywhere closes every open session of the person and nobody else's", async () => {
    await inTransaction(async (tx) => {
      const first = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      const second = await openSession(tx, FOUNDER_SUB);
      const other = await loginAndOpen(tx, 'employee.p@example.test', 'google-sub-p');

      for (const context of [{}, korA]) {
        await tx.setContext(context);
        expect((await tx.expectError('select office.close_all_sessions()')).code).toBe('42501');
      }
      await tx.setContext(founderA);
      expect(await tx.rows('select office.close_all_sessions() as n')).toEqual([{ n: 2 }]);
      expect(await verify(tx, first.key)).toEqual([]);
      expect(await verify(tx, second.key)).toEqual([]);
      expect(await verify(tx, other.key)).toHaveLength(1);
    });
  });

  it('a person lists only their own open sessions and never sees the key hash', async () => {
    await inTransaction(async (tx) => {
      const mine = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      const theirs = await loginAndOpen(tx, 'employee.p@example.test', 'google-sub-p');

      await tx.setContext(founderP);
      expect(await tx.rows('select id from office.sessions')).toEqual([{ id: mine.id }]);
      expect((await tx.expectError('select key_hash from office.sessions')).code).toBe('42501');
      await tx.setContext({ companyId: ids.pillika, userId: ids.employeeP });
      expect(await tx.rows('select id from office.sessions')).toEqual([{ id: theirs.id }]);
      await tx.setContext({ companyId: ids.pillika, userId: ids.founder, agentCode: 'KOR-1' });
      expect(await tx.count('sessions')).toBe(0);
      // The application cannot write sessions directly.
      await tx.setContext(founderP);
      for (const sql of [
        `update office.sessions set absolute_expires_at = now() + interval '1 day'`,
        'delete from office.sessions',
        `insert into office.sessions (key_hash, user_id, absolute_expires_at)
         values ($1, $2, now() + interval '1 hour')`,
      ]) {
        const values = sql.startsWith('insert') ? [keyHash(), ids.founder] : [];
        expect((await tx.expectError(sql, values)).code, sql).toBe('42501');
      }
      await tx.rows('select office.close_session($1)', [mine.key]);
      expect(await tx.count('sessions')).toBe(0);
    });
  });

  it('verify honours the idle limit and the absolute expiry and closes an expired session', async () => {
    // The clock cannot move inside a transaction, so the privileged role backdates the rows.
    await inAdminTransaction(async (tx) => {
      const session = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      const backdate = (interval: string) =>
        tx.exec(`update office.sessions set last_seen_at = now() - $2::interval where id = $1`, [
          session.id,
          interval,
        ]);
      const lastSeen = async () =>
        (
          await tx.rows<{ fresh: boolean }>(
            'select last_seen_at = now() as fresh from office.sessions where id = $1',
            [session.id],
          )
        )[0]?.fresh;

      await backdate('30 seconds');
      expect(await verify(tx, session.key)).toHaveLength(1);
      expect(await lastSeen()).toBe(false);
      await backdate('10 minutes');
      expect(await verify(tx, session.key, 1800)).toHaveLength(1);
      expect(await lastSeen()).toBe(true);
      await backdate('10 minutes');
      expect(await verify(tx, session.key, 300)).toEqual([]);
      expect(await sessionEnd(tx, session.id)).toEqual([
        { close_reason: 'expired', reason: 'idle_timeout' },
      ]);
      // A closed session never comes back.
      expect(await verify(tx, session.key, 1800)).toEqual([]);
      expect(
        (
          await tx.expectError('update office.sessions set closed_at = null where id = $1', [
            session.id,
          ])
        ).code,
      ).toBe('23514');

      const old = keyHash();
      const [oldRow] = await tx.rows<{ id: string }>(
        `insert into office.sessions
           (key_hash, user_id, created_at, last_seen_at, absolute_expires_at)
         values ($1, $2, now() - interval '11 hours', now() - interval '1 minute',
                 now() - interval '1 hour')
         returning id`,
        [old, ids.founder],
      );
      expect(await verify(tx, old)).toEqual([]);
      expect(await sessionEnd(tx, oldRow?.id ?? '')).toEqual([
        { close_reason: 'expired', reason: 'absolute_timeout' },
      ]);
      // No session lives longer than 10 hours, for the privileged role either.
      expect(
        (
          await tx.expectError(
            `insert into office.sessions (key_hash, user_id, absolute_expires_at)
             values ($1, $2, now() + interval '11 hours')`,
            [keyHash(), ids.founder],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('the 30 minute idle limit counts from the last request: never earlier, at most a minute later', async () => {
    await inAdminTransaction(async (tx) => {
      const session = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      const idleFor = async (seconds: number) => {
        await tx.exec(
          'update office.sessions set last_seen_at = now() - make_interval(secs => $2) where id = $1',
          [session.id, seconds],
        );
        return verify(tx, session.key, 1800);
      };
      // last_seen_at is written at most once a minute: a request may have come up to 59 seconds
      // after it, so the session is still open 30 minutes and 59 seconds after it.
      for (const seconds of [29 * 60, 30 * 60, 30 * 60 + 59]) {
        expect(await idleFor(seconds), String(seconds)).toHaveLength(1);
      }
      expect(await idleFor(31 * 60)).toEqual([]);
      expect(await sessionEnd(tx, session.id)).toEqual([
        { close_reason: 'expired', reason: 'idle_timeout' },
      ]);
    });
  });

  it('a check that is not activity applies the same limits but never extends the idle time', async () => {
    await inAdminTransaction(async (tx) => {
      const session = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      const check = (activity: boolean | null) =>
        tx.rows<VerifiedSession>('select * from office.verify_session($1, 1800, $2)', [
          session.key,
          activity,
        ]);
      const backdate = (seconds: number) =>
        tx.exec(
          'update office.sessions set last_seen_at = now() - make_interval(secs => $2) where id = $1',
          [session.id, seconds],
        );
      // now() does not move inside a transaction, so an untouched row is exactly as old as set.
      const idleSeconds = async () =>
        (
          await tx.rows<{ idle: number }>(
            `select extract(epoch from now() - last_seen_at)::int as idle
             from office.sessions where id = $1`,
            [session.id],
          )
        )[0]?.idle;

      // The periodic refresh of a list: valid up to the limit, and last_seen_at is not written.
      for (const seconds of [5 * 60, 20 * 60, 30 * 60 + 59]) {
        await backdate(seconds);
        expect(await check(false), String(seconds)).toEqual([
          { session_id: session.id, user_id: ids.founder, last_company_id: null },
        ]);
        expect(await idleSeconds(), String(seconds)).toBe(seconds);
      }
      // The same session checked for something the person did is refreshed.
      expect(await check(true)).toHaveLength(1);
      expect(await idleSeconds()).toBe(0);
      // Past the limit a background check closes the session like any other request.
      await backdate(31 * 60);
      expect(await check(false)).toEqual([]);
      expect(await sessionEnd(tx, session.id)).toEqual([
        { close_reason: 'expired', reason: 'idle_timeout' },
      ]);
      expect(await check(true)).toEqual([]);

      // The absolute limit too.
      const old = keyHash();
      const [oldRow] = await tx.rows<{ id: string }>(
        `insert into office.sessions
           (key_hash, user_id, created_at, last_seen_at, absolute_expires_at)
         values ($1, $2, now() - interval '11 hours', now() - interval '1 minute',
                 now() - interval '1 hour')
         returning id`,
        [old, ids.founder],
      );
      expect(await tx.rows('select * from office.verify_session($1, 1800, false)', [old])).toEqual(
        [],
      );
      expect(await sessionEnd(tx, oldRow?.id ?? '')).toEqual([
        { close_reason: 'expired', reason: 'absolute_timeout' },
      ]);
      // Whether the request counts must be said: null is refused, not read as "yes" or "no".
      expect(
        (await tx.expectError('select * from office.verify_session($1, 1800, null)', [session.key]))
          .code,
      ).toBe('22023');
    });
  });

  it('my sessions and the default company skip a session that is already dead', async () => {
    await inAdminTransaction(async (tx) => {
      const live = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      const idle = await openSession(tx, FOUNDER_SUB);
      await tx.exec(
        `update office.sessions set last_seen_at = now() - interval '32 minutes' where id = $1`,
        [idle.id],
      );
      const old = keyHash();
      await tx.exec(
        `insert into office.sessions
           (key_hash, user_id, created_at, last_seen_at, absolute_expires_at)
         values ($1, $2, now() - interval '11 hours', now() - interval '1 minute',
                 now() - interval '1 hour')`,
        [old, ids.founder],
      );
      // From here on with the API's login role. On Supabase the migration role is not a
      // superuser, so it first grants itself the role inside this rolled-back transaction.
      await tx.exec('grant office_api to current_user');
      await tx.exec('set local role office_api');
      await tx.setContext(founderP);
      expect(await tx.rows('select id from office.sessions')).toEqual([{ id: live.id }]);
      for (const key of [idle.key, old]) {
        expect(
          (await tx.expectError('select office.set_last_company($1, $2)', [key, ids.arma])).code,
        ).toBe('42501');
      }
      await tx.rows('select office.set_last_company($1, $2)', [live.key, ids.arma]);
    });
  });

  it('deactivating an account closes its sessions at once; reactivating it does not reopen them', async () => {
    await inAdminTransaction(async (tx) => {
      const session = await loginAndOpen(tx, 'employee.a@example.test', 'google-sub-a');
      await setActive(tx, founderA, ids.employeeA, false);
      // Closed before any request arrives with the key.
      expect(await sessionEnd(tx, session.id)).toEqual([
        { close_reason: 'account_closed', reason: 'account_inactive' },
      ]);
      await setActive(tx, founderA, ids.employeeA, true);
      expect(await verify(tx, session.key)).toEqual([]);
    });
  });

  it('removing the last membership of an account closes its sessions', async () => {
    await inAdminTransaction(async (tx) => {
      // The shared employee is also a member of the other company.
      const shared = await loginAndOpen(tx, 'shared@example.test', 'google-sub-shared');
      const single = await loginAndOpen(tx, 'employee.p@example.test', 'google-sub-p');
      await stepUp(tx, founderA, 'membership_change', ids.sharedEmployee);
      await tx.exec(`delete from office.memberships ${MEMBERSHIP}`, [ids.arma, ids.sharedEmployee]);
      await stepUp(tx, founderP, 'membership_change', ids.employeeP);
      await tx.exec(`delete from office.memberships ${MEMBERSHIP}`, [ids.pillika, ids.employeeP]);
      expect(await verify(tx, shared.key)).toHaveLength(1);
      expect(await sessionEnd(tx, single.id)).toEqual([
        { close_reason: 'account_closed', reason: 'no_membership' },
      ]);
    });
  });
});

describe.skipIf(noDatabase)('login events', () => {
  afterAll(closePools);

  it('the application only records events through the function and cannot read them', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect((await tx.expectError('select count(*) from office.login_events')).code).toBe('42501');
      expect(
        (
          await tx.expectError(
            `insert into office.login_events (event, reason) values ('rejected', 'not_allowed')`,
          )
        ).code,
      ).toBe('42501');

      const record = 'select office.record_login_event($1, $2, $3, $4)';
      await tx.setContext({});
      await tx.rows(record, ['rejected', 'not_allowed', null, null]);
      await tx.rows(record, ['rejected', 'mfa_missing', null, null]);
      const session = await loginAndOpen(tx, FOUNDER_EMAIL, FOUNDER_SUB);
      await tx.rows(record, ['login', null, ids.founder, session.id]);
      await tx.rows(record, ['logout', null, ids.founder, session.id]);
      await tx.rows(record, ['logout_all', null, ids.founder, null]);

      const invalid: [unknown[], string][] = [
        [['hacked', null, null, null], '23514'],
        [['rejected', null, null, null], '23514'],
        [['rejected', 'Has Spaces', null, null], '23514'],
        [['rejected', 'founder@arma.test', null, null], '23514'],
        // Only codes from the fixed list: an address or an IP written as a code is refused too.
        [['rejected', 'founder_arma_test', null, null], '23514'],
        [['rejected', 'ip_10_0_0_1', null, null], '23514'],
        // A rejected login has no session.
        [['rejected', 'not_allowed', ids.founder, session.id], '23514'],
        [['login', null, ids.founder, null], '22023'],
        [['logout_all', null, null, null], '22023'],
        [['logout', null, ids.employeeA, session.id], '22023'],
      ];
      for (const [values, code] of invalid) {
        expect((await tx.expectError(record, values)).code, JSON.stringify(values)).toBe(code);
      }
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' });
      expect((await tx.expectError(record, ['rejected', 'not_allowed', null, null])).code).toBe(
        '42501',
      );
    });
  });

  it('events are append only; deleting an account keeps its events without the link', async () => {
    await inAdminTransaction(async (tx) => {
      const record = 'select office.record_login_event($1, $2, $3, $4)';
      await tx.rows(record, ['rejected', 'not_allowed', ids.formerEmployee, null]);
      const [row] = await tx.rows<{ id: string }>(
        'select max(id)::text as id from office.login_events',
      );
      for (const sql of [
        `update office.login_events set reason = 'inactive'`,
        `update office.login_events set occurred_at = now() - interval '1 day'`,
        'delete from office.login_events',
        'truncate office.login_events',
      ]) {
        expect((await tx.expectError(sql)).code, sql).toBe('42501');
      }
      await tx.exec('delete from office.users where id = $1', [ids.formerEmployee]);
      expect(
        await tx.rows('select event, reason, user_id from office.login_events where id = $1', [
          row?.id,
        ]),
      ).toEqual([{ event: 'rejected', reason: 'not_allowed', user_id: null }]);
    });
  });
});
