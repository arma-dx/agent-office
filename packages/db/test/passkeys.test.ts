import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { listNotifications } from '../src/notifications.ts';
import { FOUNDER_PASSKEY, ids, TOOL } from './fixtures.ts';
import {
  adminQuery,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import {
  createChallenge,
  openTestSession,
  recordStepUp,
  registerPasskey,
  stepUp,
  type TestSession,
} from './step-up.ts';

// Passkeys and passkey re-verification (KALAN-ISLER 0.3; CLAUDE.md rules 2, 3, 9; 3 October
// decision 7; 5 October decisions 2, 3 and 4). inTransaction runs with the API's privileges
// (office_app and office_api_private), inWorkerTransaction with the worker's (office_app only).
// The database never checks a WebAuthn signature; the API does, and calls these functions with
// what it verified.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const otherFounder: ContextInput = { companyId: ids.otherCompany, userId: ids.otherFounder };
const korA: ContextInput = { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' };

// A re-verification is missing or does not check out.
const REAUTH = '28000';
const DENIED = '42501';
const INVALID = '22023';

const API_FUNCTIONS = [
  'office.ensure_webauthn_handle(bytea)',
  'office.create_passkey_challenge(bytea, text, bytea, bytea)',
  'office.get_passkey_challenge(bytea, uuid)',
  'office.consume_passkey_challenge(bytea, uuid, boolean)',
  'office.register_passkey(bytea, uuid, text, bytea, bigint, text[], text, boolean, text)',
  'office.get_passkey_for_assertion(bytea, text)',
  'office.record_step_up(bytea, uuid, text, bigint, text, uuid, uuid, bytea)',
  'office.revoke_passkey(bytea, text)',
  'office.reset_passkeys(bytea, uuid)',
  'office.can_reset_passkeys(uuid)',
  'office.approval_importance(uuid, boolean, boolean, text, text, uuid)',
  'office.approval_is_important(uuid, boolean, boolean, text, text, uuid)',
  'office.approval_needs_step_up(uuid)',
  'office.consume_step_up(text, uuid, uuid)',
];
// Internal steps and trigger functions: nobody outside the database calls them.
const INTERNAL_FUNCTIONS = [
  'office.live_session(bytea)',
  'office.lock_passkeys(uuid)',
  'office.require_membership_step_up()',
  'office.require_account_step_up()',
  'office.require_invitation_step_up()',
  'office.require_access_grant_step_up()',
  'office.guard_passkey()',
  'office.guard_passkey_challenge()',
  'office.keep_step_up_used()',
  'office.keep_webauthn_handle()',
];

// The migration of 5 October decisions 2, 3 and 4.
const OUTGOING_MIGRATION = new URL(
  '../../../supabase/migrations/20261005100000_outgoing_reset_grants.sql',
  import.meta.url,
);

const MEMBERSHIP = 'where company_id = $1 and user_id = $2';
const APPROVE = `update office.approvals set status = 'approved' where id = $1`;
const REQUEST_CHANGES = `update office.approvals
                         set status = 'changes_requested', rejection_reason = 'incomplete'
                         where id = $1`;
const MARK_SENT = 'update office.approvals set sent_at = now() where id = $1';
const ADMIN_RESET = 'select * from office.admin_reset_passkeys($1)';
const RESET = 'select office.reset_passkeys($1, $2) as revoked';
const GRANT = `insert into office.access_grants (company_id, user_id, record_type, record_id)
               values ($1, $2, $3, $4)`;

/** A call of the function with NULL arguments: enough to see whether the role may execute it. */
function nullCall(signature: string): string {
  const [, name = '', args = ''] = /^(.*)\((.*)\)$/.exec(signature) ?? [];
  const values = args
    .split(', ')
    .filter(Boolean)
    .map((type) => `null::${type}`);
  return `select ${name}(${values.join(', ')})`;
}

function hash(): Buffer {
  return randomBytes(32);
}

async function errorCode(tx: Tx, sql: string, values: unknown[] = []): Promise<string | undefined> {
  return (await tx.expectError(sql, values)).code;
}

/** Records a re-verification with a challenge the test opened itself. */
async function recordWith(
  tx: Tx,
  session: TestSession,
  challenge: string,
  credentialId: string,
  contextHash: Buffer,
  counter = 0,
): Promise<string> {
  const [row] = await tx.rows<{ id: string }>(
    `select office.record_step_up($1, $2, $3, $4, 'passkey_add', null, null, $5) as id`,
    [session.key, challenge, credentialId, counter, contextHash],
  );
  if (!row) {
    throw new Error('record_step_up returned no row');
  }
  return row.id;
}

function recordSql(purpose = 'passkey_add'): string {
  return `select office.record_step_up($1, $2, $3, $4, '${purpose}', $5, $6, $7)`;
}

async function openApproval(tx: Tx, fields: Record<string, unknown> = {}): Promise<string> {
  const all: Record<string, unknown> = {
    company_id: ids.arma,
    run_id: ids.runA,
    agent_code: 'KOR-1',
    title: 'Test',
    payload: {},
    involves_money: false,
    goes_external: false,
    ...fields,
  };
  const names = Object.keys(all);
  await tx.setContext(korA);
  const [row] = await tx.rows<{ id: string }>(
    `insert into office.approvals (${names.join(', ')})
     values (${names.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
    Object.values(all),
  );
  if (!row) {
    throw new Error('Approval could not be opened');
  }
  return row.id;
}

/** Inserts a re-verification as the privileged role, e.g. one from an earlier transaction. */
async function insertStepUp(
  tx: Tx,
  fields: {
    userId: string;
    sessionId: string;
    passkeyId: string;
    purpose: string;
    companyId: string | null;
    subjectId: string | null;
    verifiedAt?: string;
    verifiedXact?: string;
  },
): Promise<void> {
  await tx.exec(
    `insert into office.step_ups (user_id, session_id, passkey_id, purpose, company_id, subject_id,
       context_hash, verified_at, verified_xact)
     values ($1, $2, $3, $4, $5, $6, $7, now() - $8::interval,
       coalesce($9::xid8, pg_current_xact_id()))`,
    [
      fields.userId,
      fields.sessionId,
      fields.passkeyId,
      fields.purpose,
      fields.companyId,
      fields.subjectId,
      hash(),
      fields.verifiedAt ?? '0',
      fields.verifiedXact ?? null,
    ],
  );
}

describe.skipIf(noDatabase)('passkey privileges', () => {
  afterAll(closePools);

  it('only the API runs the passkey functions; the worker and the application role cannot', async () => {
    const rows = await adminQuery<{ fn: string; api: boolean; worker: boolean; app: boolean }>(
      `select f as fn,
              has_function_privilege('office_api', f, 'execute') as api,
              has_function_privilege('office_worker', f, 'execute') as worker,
              has_function_privilege('office_app', f, 'execute') as app
       from unnest($1::text[]) f`,
      [API_FUNCTIONS],
    );
    expect(rows).toEqual(API_FUNCTIONS.map((fn) => ({ fn, api: true, worker: false, app: false })));
    const internal = await adminQuery<{ fn: string; api: boolean; worker: boolean }>(
      `select f as fn,
              has_function_privilege('office_api', f, 'execute') as api,
              has_function_privilege('office_worker', f, 'execute') as worker
       from unnest($1::text[]) f`,
      [INTERNAL_FUNCTIONS],
    );
    expect(internal).toEqual(INTERNAL_FUNCTIONS.map((fn) => ({ fn, api: false, worker: false })));
    // The administrator's reset is granted to no role at all.
    expect(
      await adminQuery(
        `select r as role, has_function_privilege(r, 'office.admin_reset_passkeys(text)', 'execute')
           as runs
         from unnest(array['office_api', 'office_worker', 'office_app', 'office_api_private',
           'office_identity', 'office_auth_reader', 'office_trigger']) r
         where has_function_privilege(r, 'office.admin_reset_passkeys(text)', 'execute')`,
      ),
    ).toEqual([]);

    await inWorkerTransaction(async (tx) => {
      for (const context of [korA, founderA, {}]) {
        await tx.setContext(context);
        for (const fn of API_FUNCTIONS) {
          expect(await errorCode(tx, nullCall(fn)), fn).toBe(DENIED);
        }
        expect(await errorCode(tx, ADMIN_RESET, ['founder@arma.test'])).toBe(DENIED);
      }
    });
    await inTransaction(async (tx) => {
      for (const context of [founderA, {}]) {
        await tx.setContext(context);
        expect(await errorCode(tx, ADMIN_RESET, ['founder@arma.test'])).toBe(DENIED);
      }
    });
  });

  it('the reset event of the audit log and the reset notification are written by the reset alone, never by a request or an agent run', async () => {
    const audit = `insert into office.audit_log (company_id, event, record_type, record_id)
                   values ($1, $2, 'user', $3)`;
    const notify = `insert into office.notifications
                      (company_id, recipient_user_id, template, record_type, record_id)
                    values ($1, $3, $2, 'user', $3)`;
    const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
    await inTransaction(async (tx) => {
      for (const context of [founderA, approverA, employeeA, externalA]) {
        await tx.setContext(context);
        expect(
          await errorCode(tx, audit, [ids.arma, 'passkeys_reset', ids.employeeA]),
          JSON.stringify(context),
        ).toBe(DENIED);
        expect(
          await errorCode(tx, notify, [ids.arma, 'passkeys_reset', ids.employeeA]),
          JSON.stringify(context),
        ).toBe(DENIED);
        // Every other event is written as before.
        expect(await tx.exec(audit, [ids.arma, 'member_changed', ids.employeeA])).toBe(1);
      }
      // So is every other notification (an external person sends none).
      for (const context of [founderA, approverA, employeeA]) {
        await tx.setContext(context);
        expect(await tx.exec(notify, [ids.arma, 'task_assigned', ids.employeeA])).toBe(1);
      }
    });
    // The worker neither: not in an agent run, and not with a founder's context and no agent, whose
    // row would look like the founder's own reset.
    await inWorkerTransaction(async (tx) => {
      for (const context of [korA, founderA]) {
        await tx.setContext(context);
        expect(
          await errorCode(tx, audit, [ids.arma, 'passkeys_reset', ids.employeeA]),
          JSON.stringify(context),
        ).toBe(DENIED);
        expect(
          await errorCode(tx, notify, [ids.arma, 'passkeys_reset', ids.employeeA]),
          JSON.stringify(context),
        ).toBe(DENIED);
        expect(await tx.exec(audit, [ids.arma, 'tool_call', ids.employeeA])).toBe(1);
        expect(await tx.exec(notify, [ids.arma, 'approval_pending', ids.employeeA])).toBe(1);
      }
    });
  });

  it('the worker reaches none of the passkey tables; the API reads passkeys without the public key', async () => {
    const rows = await adminQuery<{
      name: string;
      worker: boolean;
      api_reads: boolean;
      api_writes: boolean;
    }>(
      `select t as name,
              has_any_column_privilege('office_worker', 'office.' || t, 'select')
                or has_any_column_privilege('office_worker', 'office.' || t, 'insert')
                or has_any_column_privilege('office_worker', 'office.' || t, 'update') as worker,
              has_any_column_privilege('office_api', 'office.' || t, 'select') as api_reads,
              has_any_column_privilege('office_api', 'office.' || t, 'insert')
                or has_any_column_privilege('office_api', 'office.' || t, 'update')
                or has_table_privilege('office_api', 'office.' || t, 'delete') as api_writes
       from unnest(array['passkey_challenges', 'passkeys', 'step_ups']) t order by 1`,
    );
    expect(rows).toEqual([
      { name: 'passkey_challenges', worker: false, api_reads: false, api_writes: false },
      { name: 'passkeys', worker: false, api_reads: true, api_writes: false },
      { name: 'step_ups', worker: false, api_reads: true, api_writes: false },
    ]);
    const columns = await adminQuery<{ name: string; readable: boolean }>(
      `select c as name, has_column_privilege('office_api', t, c, 'select') as readable
       from (values ('office.passkeys', 'public_key'), ('office.passkeys', 'counter'),
                    ('office.step_ups', 'context_hash'), ('office.users', 'webauthn_handle')) v(t, c)
       order by 1`,
    );
    expect(columns).toEqual([
      { name: 'context_hash', readable: false },
      { name: 'counter', readable: false },
      { name: 'public_key', readable: false },
      // A random handle, sent to the browser in every ceremony; not personal data.
      { name: 'webauthn_handle', readable: true },
    ]);
  });

  it('the owner of the passkey functions reaches only the context person and no company data', async () => {
    await inAdminTransaction(async (tx) => {
      await tx.setContext(approverA);
      await tx.exec('set local role office_identity');
      expect(await tx.count('passkeys')).toBe(0);
      expect(await tx.count('step_ups')).toBe(0);
      for (const sql of ['select 1 from office.approvals', 'select 1 from office.notes']) {
        expect(await errorCode(tx, sql), sql).toBe(DENIED);
      }
      // It cannot set another person's user handle.
      expect(
        await tx.exec('update office.users set webauthn_handle = $2 where id = $1', [
          ids.founder,
          randomBytes(16),
        ]),
      ).toBe(0);
      await tx.setContext(founderA);
      expect(await tx.rows('select id from office.passkeys')).toEqual([{ id: FOUNDER_PASSKEY }]);
    });
  });

  it('for a reset the owner only revokes the passkeys of a person the context founder may reset, and writes only that audit row and that notification', async () => {
    await inAdminTransaction(async (tx) => {
      const passkeyOf = async (userId: string, n: number): Promise<string> => {
        const id = `fixture-passkey-reset-${String(n)}`;
        await tx.exec(
          `insert into office.passkeys (id, user_id, public_key, device_type, backed_up, name)
           values ($1, $2, decode(repeat('03', 77), 'hex'), 'multiDevice', true, 'Phone')`,
          [id, userId],
        );
        return id;
      };
      const approver = await passkeyOf(ids.approverA, 1);
      const shared = await passkeyOf(ids.sharedEmployee, 2);
      const pillika = await passkeyOf(ids.employeeP, 3);
      // An open challenge of the approver and one of the shared employee.
      const challengeOf = async (userId: string): Promise<string> => {
        const [row] = await tx.rows<{ id: string }>(
          `with s as (
             insert into office.sessions (key_hash, user_id, absolute_expires_at)
             values ($2, $1, now() + interval '8 hours') returning id
           )
           insert into office.passkey_challenges
             (user_id, session_id, purpose, challenge, context_hash, expires_at)
           select $1, s.id, 'step_up', $3, $4, now() + interval '5 minutes' from s
           returning id`,
          [userId, randomBytes(32), randomBytes(48), hash()],
        );
        return row?.id ?? '';
      };
      const approverChallenge = await challengeOf(ids.approverA);
      const sharedChallenge = await challengeOf(ids.sharedEmployee);
      // A person the founder may reset from either of their two companies.
      await tx.exec(
        `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'employee')`,
        [ids.pillika, ids.employeeA],
      );
      await tx.exec('set local role office_identity');
      const visible = async () =>
        (await tx.rows<{ id: string }>('select id from office.passkeys order by id')).map(
          (row) => row.id,
        );
      const revoke = 'update office.passkeys set revoked_at = now() where id = $1';
      const close = 'update office.passkey_challenges set consumed_at = now() where id = $1';
      const audit = `insert into office.audit_log (company_id, event, record_type, record_id)
                     values ($1, $2, 'user', $3)`;
      // company, recipient, template, record
      const notify = `insert into office.notifications
                        (company_id, recipient_user_id, template, record_type, record_id)
                      values ($1, $2, $3, 'user', $4)`;

      // An employee, an agent run, a founder of another company and a request without a person
      // reach nothing of the person.
      for (const context of [employeeA, korA, otherFounder, {}]) {
        await tx.setContext(context);
        expect(await visible(), JSON.stringify(context)).not.toContain(approver);
        expect(await tx.exec(revoke, [approver]), JSON.stringify(context)).toBe(0);
        expect(await tx.count('passkey_challenges'), JSON.stringify(context)).toBe(0);
        expect(await tx.exec(close, [approverChallenge]), JSON.stringify(context)).toBe(0);
        expect(
          await errorCode(tx, audit, [ids.arma, 'passkeys_reset', ids.approverA]),
          JSON.stringify(context),
        ).toBe(DENIED);
        expect(
          await errorCode(tx, notify, [ids.arma, ids.approverA, 'passkeys_reset', ids.approverA]),
          JSON.stringify(context),
        ).toBe(DENIED);
      }
      // The founder of Arma DX: the member they may reset, not the person who also works at
      // another company, and nobody of Pillika from the Arma DX context.
      await tx.setContext(founderA);
      expect(await visible()).toEqual([FOUNDER_PASSKEY, approver]);
      expect(await tx.exec(revoke, [shared])).toBe(0);
      expect(await tx.exec(revoke, [pillika])).toBe(0);
      // Only revoking: nothing else of the passkey changes.
      expect(
        await errorCode(tx, 'update office.passkeys set counter = 7 where id = $1', [approver]),
      ).toBe(DENIED);
      expect(
        await errorCode(tx, 'update office.passkeys set name = $2 where id = $1', [approver, 'x']),
      ).toBe(DENIED);
      // The same for the person's open challenges: it closes them and does nothing else.
      expect(await tx.rows('select id from office.passkey_challenges')).toEqual([
        { id: approverChallenge },
      ]);
      expect(await tx.exec(close, [sharedChallenge])).toBe(0);
      expect(
        await errorCode(
          tx,
          'update office.passkey_challenges set failed_attempts = 1 where id = $1',
          [approverChallenge],
        ),
      ).toBe(DENIED);
      expect(
        await tx.exec('delete from office.passkey_challenges where id = $1', [approverChallenge]),
      ).toBe(0);
      expect(await tx.exec(close, [approverChallenge])).toBe(1);
      // Only the reset row, only in the context company and only for such a person.
      for (const [company, event, user] of [
        [ids.arma, 'login', ids.approverA],
        [ids.pillika, 'passkeys_reset', ids.approverA],
        [ids.pillika, 'passkeys_reset', ids.employeeA],
        [ids.arma, 'passkeys_reset', ids.sharedEmployee],
        [ids.arma, 'passkeys_reset', ids.founder],
      ] as const) {
        expect(await errorCode(tx, audit, [company, event, user]), `${event} ${user}`).toBe(DENIED);
      }
      expect(await errorCode(tx, 'select 1 from office.audit_log')).toBe(DENIED);
      expect(await tx.exec(audit, [ids.arma, 'passkeys_reset', ids.approverA])).toBe(1);
      // Only the reset's notification, only in the context company, only to such a person and only
      // about themselves.
      for (const [company, recipient, template, record] of [
        [ids.arma, ids.approverA, 'task_assigned', ids.approverA],
        [ids.pillika, ids.employeeA, 'passkeys_reset', ids.employeeA],
        [ids.pillika, ids.employeeP, 'passkeys_reset', ids.employeeP],
        [ids.arma, ids.sharedEmployee, 'passkeys_reset', ids.sharedEmployee],
        [ids.arma, ids.founder, 'passkeys_reset', ids.founder],
        [ids.arma, ids.approverA, 'passkeys_reset', ids.employeeA],
      ] as const) {
        expect(
          await errorCode(tx, notify, [company, recipient, template, record]),
          `${template} ${recipient}`,
        ).toBe(DENIED);
      }
      expect(await errorCode(tx, 'select 1 from office.notifications')).toBe(DENIED);
      expect(
        await tx.exec(notify, [ids.arma, ids.approverA, 'passkeys_reset', ids.approverA]),
      ).toBe(1);
      expect(await tx.exec(revoke, [approver])).toBe(1);
      // In the Pillika context the Pillika member is reached, the Arma DX member is not.
      await tx.setContext(founderP);
      expect(await visible()).toEqual([FOUNDER_PASSKEY, pillika]);
    });
  });
});

describe.skipIf(noDatabase)('passkey sessions', () => {
  afterAll(closePools);

  it('every function needs a live session of the context person and refuses an agent run', async () => {
    await inAdminTransaction(async (tx) => {
      const live = await openTestSession(tx, ids.founder);
      const closed = await openTestSession(tx, ids.founder);
      const idle = await openTestSession(tx, ids.founder);
      const foreign = await openTestSession(tx, ids.approverA);
      await tx.setContext({});
      await tx.rows('select office.close_session($1)', [closed.key]);
      await tx.exec(
        `update office.sessions set last_seen_at = now() - interval '32 minutes' where id = $1`,
        [idle.id],
      );
      const expired = randomBytes(32);
      await tx.exec(
        `insert into office.sessions (key_hash, user_id, created_at, last_seen_at,
           absolute_expires_at)
         values ($1, $2, now() - interval '11 hours', now() - interval '1 minute',
           now() - interval '1 hour')`,
        [expired, ids.founder],
      );
      // A deactivated account's session is dead too (deactivating closes it; this one is left
      // open on purpose).
      const inactive = await openTestSession(tx, ids.employeeA);
      await tx.setContext(founderA);
      await tx.exec('alter table office.users disable trigger close_account_sessions');
      await tx.exec('alter table office.users disable trigger require_step_up');
      await tx.exec('update office.users set active = false where id = $1', [ids.employeeA]);
      await tx.exec('alter table office.users enable trigger require_step_up');
      await tx.exec('alter table office.users enable trigger close_account_sessions');

      // From here on with the API's login role.
      await tx.exec('grant office_api to current_user');
      await tx.exec('set local role office_api');
      const calls: [string, (key: Buffer) => unknown[]][] = [
        ['select office.ensure_webauthn_handle($1)', (key) => [key]],
        [
          `select office.create_passkey_challenge($1, 'step_up', $2, $3)`,
          (key) => [key, randomBytes(48), hash()],
        ],
        ['select * from office.get_passkey_challenge($1, $2)', (key) => [key, ids.taskA]],
        ['select office.consume_passkey_challenge($1, $2, false)', (key) => [key, ids.taskA]],
        [
          `select office.register_passkey($1, $2, $3, $4, 0, '{}', 'multiDevice', true, 'x')`,
          (key) => [key, ids.taskA, randomBytes(32).toString('base64url'), randomBytes(77)],
        ],
        ['select * from office.get_passkey_for_assertion($1, $2)', (key) => [key, FOUNDER_PASSKEY]],
        [
          `select office.record_step_up($1, $2, $3, 0, 'passkey_add', null, null, $4)`,
          (key) => [key, ids.taskA, FOUNDER_PASSKEY, hash()],
        ],
        ['select office.revoke_passkey($1, $2)', (key) => [key, FOUNDER_PASSKEY]],
        [RESET, (key) => [key, ids.approverA]],
      ];
      const deadKeys: [string, Buffer][] = [
        ['closed', closed.key],
        ['idle', idle.key],
        ['expired', expired],
        ['unknown', randomBytes(32)],
        ['short', randomBytes(5)],
        ["another person's", foreign.key],
      ];
      for (const [sql, args] of calls) {
        await tx.setContext(founderA);
        for (const [name, key] of deadKeys) {
          expect(await errorCode(tx, sql, args(key)), `${sql} (${name})`).toBe(DENIED);
        }
        // The live session, but in an agent run, without a person, or for another person.
        for (const context of [korA, {}, approverA]) {
          await tx.setContext(context);
          expect(await errorCode(tx, sql, args(live.key)), sql).toBe(DENIED);
        }
        await tx.setContext(employeeA);
        expect(await errorCode(tx, sql, args(inactive.key)), `${sql} (inactive)`).toBe(DENIED);
      }
      // The live session of the context person works.
      await tx.setContext(founderA);
      expect(
        await tx.rows('select * from office.get_passkey_for_assertion($1, $2)', [
          live.key,
          FOUNDER_PASSKEY,
        ]),
      ).toHaveLength(1);
    });
  });

  it('the WebAuthn user handle is 16 random bytes, made once per person and never changed', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const handle = async (s: TestSession) =>
        (
          await tx.rows<{ handle: Buffer }>('select office.ensure_webauthn_handle($1) as handle', [
            s.key,
          ])
        )[0]?.handle;
      const first = await handle(session);
      expect(first).toHaveLength(16);
      expect(await handle(session)).toEqual(first);
      expect(
        await tx.rows('select webauthn_handle from office.users where id = $1', [ids.founder]),
      ).toEqual([{ webauthn_handle: first }]);

      const other = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const second = await handle(other);
      expect(second).toHaveLength(16);
      expect(second).not.toEqual(first);
      // The application cannot write it.
      expect(
        await errorCode(tx, 'update office.users set webauthn_handle = $2 where id = $1', [
          ids.approverA,
          randomBytes(16),
        ]),
      ).toBe(DENIED);
    });
    // Once set it never changes, for the privileged role either.
    await inAdminTransaction(async (tx) => {
      await tx.exec('update office.users set webauthn_handle = $2 where id = $1', [
        ids.founder,
        randomBytes(16),
      ]);
      expect(
        await errorCode(tx, 'update office.users set webauthn_handle = $2 where id = $1', [
          ids.founder,
          randomBytes(16),
        ]),
      ).toBe('23514');
      expect(
        await errorCode(tx, 'update office.users set webauthn_handle = $2 where id = $1', [
          ids.employeeA,
          randomBytes(15),
        ]),
      ).toBe('23514');
    });
  });
});

describe.skipIf(noDatabase)('registering passkeys', () => {
  afterAll(closePools);

  it('the first passkey is registered only within 10 minutes of a sign-in, while the person has none', async () => {
    await inAdminTransaction(async (tx) => {
      const insertSession = async (minutesAgo: number): Promise<TestSession> => {
        const key = randomBytes(32);
        const [row] = await tx.rows<{ id: string }>(
          `insert into office.sessions (key_hash, user_id, created_at, last_seen_at,
             absolute_expires_at)
           values ($1, $2, now() - make_interval(mins => $3), now(),
             now() - make_interval(mins => $3) + interval '8 hours')
           returning id`,
          [key, ids.employeeA, minutesAgo],
        );
        return { id: row?.id ?? '', key };
      };
      const old = await insertSession(11);
      const recent = await insertSession(9);
      await tx.setContext(employeeA);
      expect(
        await errorCode(tx, `select office.create_passkey_challenge($1, 'register', $2, null)`, [
          old.key,
          randomBytes(32),
        ]),
      ).toBe(REAUTH);
      const passkey = await registerPasskey(tx, recent);
      expect(passkey.ref).toMatch(/^[0-9a-f-]{36}$/);
      // Now that a passkey exists, the fresh session alone is not enough.
      expect(
        await errorCode(tx, `select office.create_passkey_challenge($1, 'register', $2, null)`, [
          recent.key,
          randomBytes(32),
        ]),
      ).toBe(REAUTH);
    });

    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      // Two challenges opened while the person had no passkey (for two names, so neither replaces
      // the other) do not give two "first" passkeys.
      const one = await createChallenge(tx, session, 'register', hash());
      const two = await createChallenge(tx, session, 'register', hash());
      await registerPasskey(tx, session, one);
      expect(
        await errorCode(
          tx,
          `select office.register_passkey($1, $2, $3, $4, 0, '{}', 'multiDevice', true, 'x')`,
          [session.key, two, randomBytes(32).toString('base64url'), randomBytes(77)],
        ),
      ).toBe(REAUTH);
      expect(await tx.count('passkeys')).toBe(1);
      // A re-verification challenge cannot register a passkey.
      const stepUpChallenge = await createChallenge(tx, session, 'step_up');
      expect(
        await errorCode(
          tx,
          `select office.register_passkey($1, $2, $3, $4, 0, '{}', 'multiDevice', true, 'x')`,
          [session.key, stepUpChallenge, randomBytes(32).toString('base64url'), randomBytes(77)],
        ),
      ).toBe(REAUTH);
    });
  });

  it('a further passkey needs a passkey_add re-verification of the same session from the last 5 minutes, used once', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      const other = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const first = await registerPasskey(tx, session);
      const register = `select office.create_passkey_challenge($1, 'register', $2, null)`;
      expect(await errorCode(tx, register, [session.key, randomBytes(32)])).toBe(REAUTH);

      const added = await recordStepUp(tx, session, null, {
        purpose: 'passkey_add',
        subjectId: null,
        credentialId: first.credentialId,
      });
      // Another session of the same person cannot use it.
      expect(await errorCode(tx, register, [other.key, randomBytes(32)])).toBe(REAUTH);
      const challenge = await createChallenge(tx, session, 'register');
      expect(
        await tx.rows('select consumed_at is not null as used from office.step_ups where id = $1', [
          added,
        ]),
      ).toEqual([{ used: true }]);
      await registerPasskey(tx, session, challenge, 'Laptop');
      expect(await errorCode(tx, register, [session.key, randomBytes(32)])).toBe(REAUTH);
      expect(await tx.rows('select name from office.passkeys order by name')).toEqual([
        { name: 'Laptop' },
        { name: 'Test passkey' },
      ]);
    });

    // A re-verification older than 5 minutes does not count.
    await inAdminTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const passkey = await registerPasskey(tx, session);
      const register = `select office.create_passkey_challenge($1, 'register', $2, null)`;
      const base = {
        userId: ids.approverA,
        sessionId: session.id,
        passkeyId: passkey.credentialId,
        purpose: 'passkey_add',
        companyId: null,
        subjectId: null,
      };
      await insertStepUp(tx, { ...base, verifiedAt: '6 minutes' });
      expect(await errorCode(tx, register, [session.key, randomBytes(32)])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedAt: '4 minutes' });
      expect(await tx.rows(register, [session.key, randomBytes(32)])).toHaveLength(1);
    });
  });

  it('passkey details are checked; a credential is stored once; at most 10 active passkeys', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const challenge = await createChallenge(tx, session, 'register');
      const register = `select office.register_passkey($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
      const valid = {
        credentialId: randomBytes(32).toString('base64url'),
        publicKey: randomBytes(77),
        counter: 0,
        transports: ['internal', 'hybrid'],
        deviceType: 'multiDevice',
        backedUp: true,
        name: '  Telefon  ',
      };
      const args = (fields: Partial<typeof valid>) => {
        const all = { ...valid, ...fields };
        return [
          session.key,
          challenge,
          all.credentialId,
          all.publicKey,
          all.counter,
          all.transports,
          all.deviceType,
          all.backedUp,
          all.name,
        ];
      };
      const invalid: Partial<typeof valid>[] = [
        { name: '' },
        { name: '   ' },
        { name: 'x'.repeat(61) },
        { name: 'line\nbreak' },
        { name: 'right\u202eto left' },
        { credentialId: 'short' },
        { credentialId: 'has spaces in the identifier' },
        { credentialId: 'x'.repeat(1367) },
        { publicKey: randomBytes(8) },
        { counter: -1 },
        { counter: 4_294_967_296 },
        { transports: ['usb', 'carrier-pigeon'] },
        { deviceType: 'phone' },
        { deviceType: 'singleDevice', backedUp: true },
      ];
      for (const fields of invalid) {
        expect(await errorCode(tx, register, args(fields)), JSON.stringify(fields)).toBe(INVALID);
      }
      expect(
        await errorCode(
          tx,
          `select office.register_passkey($1, $2, $3, $4, 0, array[null]::text[], 'multiDevice',
             true, 'x')`,
          [session.key, challenge, valid.credentialId, valid.publicKey],
        ),
      ).toBe(INVALID);
      // The challenge is still open after the refusals; the name is trimmed.
      await tx.rows(register, args({}));
      expect(await tx.rows('select name, transports from office.passkeys')).toEqual([
        { name: 'Telefon', transports: ['internal', 'hybrid'] },
      ]);

      // The same credential id cannot be registered again.
      await recordStepUp(tx, session, null, {
        purpose: 'passkey_add',
        subjectId: null,
        credentialId: valid.credentialId,
      });
      const again = await createChallenge(tx, session, 'register');
      expect(
        await errorCode(tx, register, [
          session.key,
          again,
          valid.credentialId,
          valid.publicKey,
          0,
          [],
          'singleDevice',
          false,
          'Again',
        ]),
      ).toBe('23505');
    });

    await inAdminTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const first = await registerPasskey(tx, session);
      await tx.exec(
        `insert into office.passkeys (id, user_id, public_key, device_type, backed_up, name)
         select 'fixture-passkey-limit-' || n, $1, decode(repeat('02', 77), 'hex'), 'multiDevice',
           true, 'Key ' || n
         from generate_series(1, 9) n`,
        [ids.approverA],
      );
      await recordStepUp(tx, session, null, {
        purpose: 'passkey_add',
        subjectId: null,
        credentialId: first.credentialId,
      });
      const challenge = await createChallenge(tx, session, 'register');
      expect(
        await errorCode(
          tx,
          `select office.register_passkey($1, $2, $3, $4, 0, '{}', 'multiDevice', true, 'x')`,
          [session.key, challenge, randomBytes(32).toString('base64url'), randomBytes(77)],
        ),
      ).toBe('54000');
    });
  });
});

describe.skipIf(noDatabase)('passkey challenges and re-verification', () => {
  afterAll(closePools);

  it('a challenge belongs to its session and is used once; 5 failed attempts close it', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      const other = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const get = 'select * from office.get_passkey_challenge($1, $2)';
      const consume = 'select office.consume_passkey_challenge($1, $2, $3) as ok';

      const contextHash = hash();
      const challenge = await createChallenge(tx, session, 'step_up', contextHash);
      const [open] = await tx.rows<{ purpose: string; challenge: Buffer; context_hash: Buffer }>(
        get,
        [session.key, challenge],
      );
      expect(open?.purpose).toBe('step_up');
      expect(open?.challenge).toHaveLength(48);
      expect(open?.context_hash).toEqual(contextHash);
      expect(await tx.rows(get, [other.key, challenge])).toEqual([]);
      expect(
        await errorCode(tx, recordSql(), [
          other.key,
          challenge,
          FOUNDER_PASSKEY,
          0,
          null,
          null,
          contextHash,
        ]),
      ).toBe(REAUTH);

      await recordWith(tx, session, challenge, FOUNDER_PASSKEY, contextHash);
      expect(await tx.rows(get, [session.key, challenge])).toEqual([]);
      expect(
        await errorCode(tx, recordSql(), [
          session.key,
          challenge,
          FOUNDER_PASSKEY,
          0,
          null,
          null,
          contextHash,
        ]),
      ).toBe(REAUTH);
      expect(await tx.rows(consume, [session.key, challenge, true])).toEqual([{ ok: false }]);

      // Failed attempts are counted; the fifth closes the challenge.
      const failing = await createChallenge(tx, session, 'step_up', contextHash);
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect(await tx.rows(consume, [session.key, failing, false])).toEqual([{ ok: true }]);
      }
      expect(await tx.rows(get, [session.key, failing])).toHaveLength(1);
      expect(await tx.rows(consume, [session.key, failing, false])).toEqual([{ ok: true }]);
      expect(await tx.rows(get, [session.key, failing])).toEqual([]);
      expect(await tx.rows(consume, [session.key, failing, false])).toEqual([{ ok: false }]);
      expect(
        await errorCode(tx, recordSql(), [
          session.key,
          failing,
          FOUNDER_PASSKEY,
          0,
          null,
          null,
          contextHash,
        ]),
      ).toBe(REAUTH);

      // A successful ceremony the API checked itself uses the challenge up.
      const done = await createChallenge(tx, session, 'step_up');
      expect(await tx.rows(consume, [session.key, done, true])).toEqual([{ ok: true }]);
      expect(await tx.rows(get, [session.key, done])).toEqual([]);
      expect(await errorCode(tx, consume, [session.key, done, null])).toBe(INVALID);

      // At most 10 open challenges per session.
      const fresh = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      for (let n = 0; n < 10; n++) {
        await createChallenge(tx, fresh, 'step_up');
      }
      expect(
        await errorCode(tx, `select office.create_passkey_challenge($1, 'step_up', $2, $3)`, [
          fresh.key,
          randomBytes(48),
          hash(),
        ]),
      ).toBe('54000');

      // Malformed challenges.
      for (const [purpose, bytes, contextHashArg] of [
        ['login', randomBytes(32), hash()],
        ['step_up', randomBytes(31), hash()],
        ['step_up', randomBytes(129), hash()],
        ['step_up', randomBytes(32), null],
        ['step_up', randomBytes(32), randomBytes(31)],
      ] as const) {
        expect(
          await errorCode(tx, 'select office.create_passkey_challenge($1, $2, $3, $4)', [
            session.key,
            purpose,
            bytes,
            contextHashArg,
          ]),
          `${purpose} ${String(bytes.length)}`,
        ).toBe(INVALID);
      }
      // A person without a passkey cannot open a re-verification.
      const approverSession = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      expect(
        await errorCode(tx, `select office.create_passkey_challenge($1, 'step_up', $2, $3)`, [
          approverSession.key,
          randomBytes(48),
          hash(),
        ]),
      ).toBe(REAUTH);
    });
  });

  it('a dialog opened again replaces its own open challenge, so they do not pile up', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      const other = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const get = 'select purpose from office.get_passkey_challenge($1, $2)';
      const sameDialog = hash();
      const first = await createChallenge(tx, session, 'step_up', sameDialog);
      const otherDialog = await createChallenge(tx, session, 'step_up', hash());
      const otherSession = await createChallenge(tx, other, 'step_up', sameDialog);
      // The same purpose and context hash in the same session: the older one closes.
      const second = await createChallenge(tx, session, 'step_up', sameDialog);
      expect(await tx.rows(get, [session.key, first])).toEqual([]);
      expect(
        await errorCode(tx, recordSql(), [
          session.key,
          first,
          FOUNDER_PASSKEY,
          0,
          null,
          null,
          sameDialog,
        ]),
      ).toBe(REAUTH);
      // Another dialog, or the same one in another session, keeps its challenge.
      expect(await tx.rows(get, [session.key, second])).toEqual([{ purpose: 'step_up' }]);
      expect(await tx.rows(get, [session.key, otherDialog])).toEqual([{ purpose: 'step_up' }]);
      expect(await tx.rows(get, [other.key, otherSession])).toEqual([{ purpose: 'step_up' }]);
      // A registration for the same name too (a person without a passkey yet).
      const newcomer = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const name = hash();
      const register = await createChallenge(tx, newcomer, 'register', name);
      const renamed = await createChallenge(tx, newcomer, 'register', hash());
      await createChallenge(tx, newcomer, 'register', name);
      expect(await tx.rows(get, [newcomer.key, register])).toEqual([]);
      expect(await tx.rows(get, [newcomer.key, renamed])).toEqual([{ purpose: 'register' }]);

      // Opening and closing the same dialog many times never reaches the limit of 10: only the
      // newest challenge stays open.
      const fresh = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const opened: string[] = [];
      for (let n = 0; n < 15; n++) {
        opened.push(await createChallenge(tx, fresh, 'step_up', sameDialog));
      }
      const open: string[] = [];
      for (const id of opened) {
        if ((await tx.rows(get, [fresh.key, id])).length > 0) open.push(id);
      }
      expect(open).toEqual([opened.at(-1)]);
    });
  });

  it('a challenge expires after 5 minutes and a used challenge never changes', async () => {
    await inAdminTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const contextHash = hash();
      const [expired] = await tx.rows<{ id: string }>(
        `insert into office.passkey_challenges (user_id, session_id, purpose, challenge,
           context_hash, created_at, expires_at)
         values ($1, $2, 'step_up', $3, $4, now() - interval '6 minutes',
           now() - interval '1 minute')
         returning id`,
        [ids.founder, session.id, randomBytes(48), contextHash],
      );
      expect(
        await tx.rows('select * from office.get_passkey_challenge($1, $2)', [
          session.key,
          expired?.id,
        ]),
      ).toEqual([]);
      expect(
        await errorCode(tx, recordSql(), [
          session.key,
          expired?.id,
          FOUNDER_PASSKEY,
          0,
          null,
          null,
          contextHash,
        ]),
      ).toBe(REAUTH);
      // No challenge lives longer than 5 minutes, for the privileged role either.
      expect(
        await errorCode(
          tx,
          `insert into office.passkey_challenges (user_id, session_id, purpose, challenge,
             context_hash, expires_at)
           values ($1, $2, 'step_up', $3, $4, now() + interval '6 minutes')`,
          [ids.founder, session.id, randomBytes(48), contextHash],
        ),
      ).toBe('23514');

      const used = await createChallenge(tx, session, 'step_up', contextHash);
      await recordWith(tx, session, used, FOUNDER_PASSKEY, contextHash);
      for (const sql of [
        'update office.passkey_challenges set consumed_at = null where id = $1',
        'update office.passkey_challenges set failed_attempts = 1 where id = $1',
        `update office.passkey_challenges set expires_at = now() + interval '1 minute'
         where id = $1`,
      ]) {
        expect(await errorCode(tx, sql, [used]), sql).toBe('23514');
      }
    });
  });

  it('a re-verification must name the context hash it was signed for and an active passkey of the person', async () => {
    await inTransaction(async (tx) => {
      const approverSession = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const approverPasskey = await registerPasskey(tx, approverSession);

      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const contextHash = hash();
      const challenge = await createChallenge(tx, session, 'step_up', contextHash);
      const values = (credential: string, contextHashArg: Buffer) => [
        session.key,
        challenge,
        credential,
        0,
        null,
        null,
        contextHashArg,
      ];
      expect(await errorCode(tx, recordSql(), values(FOUNDER_PASSKEY, hash()))).toBe(REAUTH);
      expect(
        await errorCode(tx, recordSql(), values(approverPasskey.credentialId, contextHash)),
      ).toBe(REAUTH);
      expect(
        await errorCode(
          tx,
          recordSql(),
          values(randomBytes(32).toString('base64url'), contextHash),
        ),
      ).toBe(REAUTH);
      // Another person's passkey is not handed out for an assertion either.
      expect(
        await tx.rows('select * from office.get_passkey_for_assertion($1, $2)', [
          session.key,
          approverPasskey.credentialId,
        ]),
      ).toEqual([]);
      await recordWith(tx, session, challenge, FOUNDER_PASSKEY, contextHash);
      expect(
        await tx.rows(
          `select last_used_at = now() as used_now from office.passkeys where id = $1`,
          [FOUNDER_PASSKEY],
        ),
      ).toEqual([{ used_now: true }]);
    });
  });

  it('the purpose decides the company and the subject a re-verification names', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      // The shape is checked before the challenge is used, so one challenge serves every attempt.
      const contextHash = hash();
      const challenge = await createChallenge(tx, session, 'step_up', contextHash);
      const attempt = async (purpose: string, companyId: string | null, subjectId: string | null) =>
        errorCode(tx, recordSql(purpose), [
          session.key,
          challenge,
          FOUNDER_PASSKEY,
          0,
          companyId,
          subjectId,
          contextHash,
        ]);
      expect(await attempt('approve', null, ids.approvalA)).toBe(INVALID);
      expect(await attempt('approve', ids.arma, null)).toBe(INVALID);
      expect(await attempt('membership_change', null, ids.employeeA)).toBe(INVALID);
      expect(await attempt('invitation', null, ids.invitationA)).toBe(INVALID);
      expect(await attempt('invitation', ids.arma, null)).toBe(INVALID);
      expect(await attempt('passkey_add', ids.arma, null)).toBe(INVALID);
      expect(await attempt('passkey_add', null, ids.employeeA)).toBe(INVALID);
      expect(await attempt('passkey_revoke', null, null)).toBe(INVALID);
      expect(await attempt('passkey_revoke', null, ids.employeeA)).toBe(INVALID);
      expect(await attempt('passkey_reset', null, ids.employeeA)).toBe(INVALID);
      expect(await attempt('passkey_reset', ids.arma, null)).toBe(INVALID);
      expect(await attempt('access_grant', null, ids.externalA)).toBe(INVALID);
      expect(await attempt('access_grant', ids.arma, null)).toBe(INVALID);
      expect(await attempt('login', null, null)).toBe(INVALID);
      // Only for the context company, and only where the person is a member.
      expect(await attempt('approve', ids.pillika, ids.approvalP)).toBe(DENIED);
      expect(await attempt('invitation', ids.pillika, ids.invitationP)).toBe(DENIED);
      expect(await attempt('passkey_reset', ids.pillika, ids.employeeP)).toBe(DENIED);
      expect(await attempt('access_grant', ids.pillika, ids.externalP)).toBe(DENIED);
      await tx.setContext({ companyId: ids.otherCompany, userId: ids.founder });
      expect(await attempt('membership_change', ids.otherCompany, ids.otherFounder)).toBe(DENIED);
    });
  });

  it('the signature counter must increase once it is used; a counter of 0 stays valid at 0', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const { credentialId } = await registerPasskey(tx, session);
      const use = async (counter: number) => {
        const contextHash = hash();
        const challenge = await createChallenge(tx, session, 'step_up', contextHash);
        return recordWith(tx, session, challenge, credentialId, contextHash, counter);
      };
      const refused = async (counter: number) => {
        const contextHash = hash();
        const challenge = await createChallenge(tx, session, 'step_up', contextHash);
        return errorCode(tx, recordSql(), [
          session.key,
          challenge,
          credentialId,
          counter,
          null,
          null,
          contextHash,
        ]);
      };
      await use(0);
      await use(0);
      await use(5);
      for (const counter of [5, 4, 0]) {
        expect(await refused(counter), String(counter)).toBe(REAUTH);
      }
      expect(await refused(-1)).toBe(INVALID);
      await use(6);
      expect(
        await tx.rows<{ counter: string }>(
          'select counter from office.get_passkey_for_assertion($1, $2)',
          [session.key, credentialId],
        ),
      ).toEqual([{ counter: '6' }]);
    });
    // The counter never goes down, for the privileged role either.
    await inAdminTransaction(async (tx) => {
      await tx.exec('update office.passkeys set counter = 3 where id = $1', [FOUNDER_PASSKEY]);
      expect(
        await errorCode(tx, 'update office.passkeys set counter = 2 where id = $1', [
          FOUNDER_PASSKEY,
        ]),
      ).toBe('23514');
    });
  });
});

describe.skipIf(noDatabase)('revoking passkeys', () => {
  afterAll(closePools);

  it('revoking a passkey needs a re-verification for that passkey in the same transaction', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const first = await registerPasskey(tx, session, undefined, 'Phone');
      await recordStepUp(tx, session, null, {
        purpose: 'passkey_add',
        subjectId: null,
        credentialId: first.credentialId,
      });
      const second = await registerPasskey(
        tx,
        session,
        await createChallenge(tx, session, 'register'),
        'Laptop',
      );
      const revoke = 'select office.revoke_passkey($1, $2)';
      const reverify = (purpose: 'passkey_add' | 'passkey_revoke', subjectId: string | null) =>
        recordStepUp(tx, session, null, {
          purpose,
          subjectId,
          credentialId: second.credentialId,
        });

      expect(await errorCode(tx, revoke, [session.key, first.credentialId])).toBe(REAUTH);
      await reverify('passkey_revoke', second.ref);
      expect(await errorCode(tx, revoke, [session.key, first.credentialId])).toBe(REAUTH);
      await reverify('passkey_add', null);
      expect(await errorCode(tx, revoke, [session.key, first.credentialId])).toBe(REAUTH);

      await reverify('passkey_revoke', first.ref);
      await tx.rows(revoke, [session.key, first.credentialId]);
      expect(await tx.rows('select name from office.passkeys')).toEqual([{ name: 'Laptop' }]);
      expect(
        await tx.rows('select * from office.get_passkey_for_assertion($1, $2)', [
          session.key,
          first.credentialId,
        ]),
      ).toEqual([]);
      // A revoked passkey re-verifies nothing and cannot be revoked again.
      const contextHash = hash();
      const challenge = await createChallenge(tx, session, 'step_up', contextHash);
      expect(
        await errorCode(tx, recordSql(), [
          session.key,
          challenge,
          first.credentialId,
          0,
          null,
          null,
          contextHash,
        ]),
      ).toBe(REAUTH);
      expect(await errorCode(tx, revoke, [session.key, first.credentialId])).toBe('P0002');
      // Another person's passkey is not found.
      expect(await errorCode(tx, revoke, [session.key, FOUNDER_PASSKEY])).toBe('P0002');
      // The earlier re-verification for the second passkey is still unused in this transaction:
      // it revokes the second one, once. The last passkey can go too.
      await tx.rows(revoke, [session.key, second.credentialId]);
      expect(await tx.count('passkeys')).toBe(0);
      expect(
        await tx.count('step_ups', 'consumed_at is null and purpose = $1', ['passkey_revoke']),
      ).toBe(0);
    });
  });

  it('a revoke re-verification from an earlier transaction does not count; a revoked passkey never changes', async () => {
    await inAdminTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const passkey = await registerPasskey(tx, session);
      const base = {
        userId: ids.approverA,
        sessionId: session.id,
        passkeyId: passkey.credentialId,
        purpose: 'passkey_revoke',
        companyId: null,
        subjectId: passkey.ref,
      };
      const revoke = 'select office.revoke_passkey($1, $2)';
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, revoke, [session.key, passkey.credentialId])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, revoke, [session.key, passkey.credentialId])).toBe(REAUTH);
      await insertStepUp(tx, base);
      await tx.rows(revoke, [session.key, passkey.credentialId]);
      for (const sql of [
        'update office.passkeys set revoked_at = null where id = $1',
        'update office.passkeys set last_used_at = now() where id = $1',
      ]) {
        expect(await errorCode(tx, sql, [passkey.credentialId]), sql).toBe('23514');
      }
      // A used re-verification never changes either.
      expect(
        await errorCode(
          tx,
          'update office.step_ups set consumed_at = null where consumed_at is not null',
        ),
      ).toBe('23514');
    });
  });
});

describe.skipIf(noDatabase)('important approvals', () => {
  afterAll(closePools);

  it('an approval that involves money, goes outside, has an external effect or changes a source of truth note is important', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      // company, involves money, goes outside, tool, basis type, basis id
      const rule = 'select office.approval_importance($1, $2, $3, $4, $5, $6) as important';
      const cases: [unknown[], boolean][] = [
        [[ids.arma, false, false, null, null, null], false],
        [[ids.arma, true, false, null, null, null], true],
        // Work a person sends outside by hand after the approval (5 October decision 2).
        [[ids.arma, false, true, null, null, null], true],
        [[ids.arma, false, true, TOOL.read, 'task', ids.taskA], true],
        // A statement that is missing counts as yes.
        [[ids.arma, null, false, null, null, null], true],
        [[ids.arma, false, null, null, null, null], true],
        [[ids.arma, false, false, TOOL.externalEffect, null, null], true],
        [[ids.arma, false, false, TOOL.read, null, null], false],
        [[ids.arma, false, false, null, 'note', ids.noteASourceOfTruth], true],
        [[ids.arma, false, false, null, 'note', ids.noteA], false],
        [[ids.arma, false, false, null, 'task', ids.taskA], false],
        // A tool that changes a note: important when its note is a source of truth, and when the
        // approval names no note (the target is unknown).
        [[ids.arma, false, false, TOOL.internalWrite, 'note', ids.noteA], false],
        [[ids.arma, false, false, TOOL.internalWrite, 'note', ids.noteASourceOfTruth], true],
        [[ids.arma, false, false, TOOL.internalWrite, null, null], true],
        [[ids.arma, false, false, TOOL.internalWrite, 'task', ids.taskA], true],
        [[ids.arma, false, false, 'link_notes', null, null], true],
        [[ids.arma, false, false, 'import_document', null, null], true],
        // The note must belong to the approval's company.
        [[ids.pillika, false, false, null, 'note', ids.noteASourceOfTruth], false],
      ];
      for (const [values, expected] of cases) {
        expect(await tx.rows(rule, values), JSON.stringify(values)).toEqual([
          { important: expected },
        ]);
      }

      // The API asks about an approval of the context company, with the person's rights.
      const needs = 'select office.approval_needs_step_up($1) as needs';
      const external = await openApproval(tx, { tool_name: TOOL.externalEffect });
      const money = await openApproval(tx, { involves_money: true });
      const outgoing = await openApproval(tx, { goes_external: true });
      const truth = await openApproval(tx, {
        basis_type: 'note',
        basis_id: ids.noteASourceOfTruth,
        basis_version: 1,
      });
      const unknownTarget = await openApproval(tx, { tool_name: TOOL.internalWrite });
      const plain = await openApproval(tx, {
        basis_type: 'task',
        basis_id: ids.taskA,
        basis_version: 1,
      });
      const withoutBasis = await openApproval(tx, { tool_name: TOOL.read });
      await tx.setContext(founderA);
      for (const [id, expected] of [
        [external, true],
        [money, true],
        [outgoing, true],
        [truth, true],
        [unknownTarget, true],
        [plain, false],
        [withoutBasis, false],
        [ids.approvalA, false],
      ] as const) {
        expect(await tx.rows(needs, [id]), id).toEqual([{ needs: expected }]);
      }
      // Another company's approval, or no company: no answer.
      for (const context of [founderP, { userId: ids.founder }, {}]) {
        await tx.setContext(context);
        expect(await tx.rows(needs, [external]), JSON.stringify(context)).toEqual([
          { needs: null },
        ]);
      }
    });
  });

  it('the importance check reveals nothing about notes the caller cannot see', async () => {
    await inTransaction(async (tx) => {
      // The approval check's own function answers only inside the check: called directly, its
      // arguments would ask about any company's notes.
      for (const context of [{}, founderP, founderA]) {
        await tx.setContext(context);
        expect(
          await errorCode(
            tx,
            'select office.approval_is_important($1, false, false, null, $2, $3)',
            [ids.arma, 'note', ids.noteASourceOfTruth],
          ),
          JSON.stringify(context),
        ).toBe(DENIED);
      }
      // The rule itself runs with the caller's rights: a note the caller cannot read is never a
      // source of truth to them.
      const rule = `select office.approval_importance($1, false, false, null, 'note', $2)
                      as important`;
      for (const context of [{}, founderP, { companyId: ids.arma, userId: ids.employeeP }]) {
        await tx.setContext(context);
        expect(
          await tx.rows(rule, [ids.arma, ids.noteASourceOfTruth]),
          JSON.stringify(context),
        ).toEqual([{ important: false }]);
      }
      await tx.setContext(founderA);
      expect(await tx.rows(rule, [ids.arma, ids.noteASourceOfTruth])).toEqual([
        { important: true },
      ]);
    });
  });

  it('an approval is opened only with the money decision and the outgoing statement made', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      // Neither, only the outgoing statement, only the money decision: all refused.
      for (const [columns, values] of [
        ['', ''],
        [', goes_external', ', false'],
        [', involves_money', ', false'],
        [', involves_money, goes_external', ', true, null'],
      ] as const) {
        const refused = await tx.expectError(
          `insert into office.approvals (company_id, run_id, agent_code, title, payload${columns})
           values ($1, $2, 'KOR-1', 'Teklif', '{"price": 480000}'${values})`,
          [ids.arma, ids.runA],
        );
        expect(refused.code, columns).toBe('23502');
      }
      // The agent that opens the approval said nothing about the work going outside.
      expect(
        (
          await tx.expectError(
            `insert into office.approvals (company_id, run_id, agent_code, title, payload,
               involves_money)
             values ($1, $2, 'KOR-1', 'Sosyal medya', '{}', false)`,
            [ids.arma, ids.runA],
          )
        ).message,
      ).toMatch(/goes_external/);
      const [row] = await tx.rows<{ involves_money: boolean; goes_external: boolean }>(
        `insert into office.approvals (company_id, run_id, agent_code, title, payload,
           involves_money, goes_external)
         values ($1, $2, 'KOR-1', 'Teklif', '{"price": 480000}', true, true)
         returning involves_money, goes_external`,
        [ids.arma, ids.runA],
      );
      expect(row).toEqual({ involves_money: true, goes_external: true });
    });
  });

  it('work that goes outside is approved only with a re-verification; rejecting it needs none; the statement never changes', async () => {
    await inTransaction(async (tx) => {
      // A social media post a person publishes by hand after the approval: no tool, no money.
      const post = await openApproval(tx, { title: 'Sosyal medya', goes_external: true });
      const report = await openApproval(tx, { title: 'Rapor', goes_external: true });
      const minutes = await openApproval(tx, { title: 'Tutanak', goes_external: true });
      const internal = await openApproval(tx, { title: 'İç not' });

      await tx.setContext(founderA);
      expect(await errorCode(tx, APPROVE, [post])).toBe(REAUTH);
      // Rejecting and asking for changes need no re-verification.
      expect(
        await tx.exec(
          `update office.approvals set status = 'rejected', rejection_reason = 'language_and_tone'
           where id = $1`,
          [report],
        ),
      ).toBe(1);
      expect(
        await tx.exec(
          `update office.approvals set status = 'changes_requested', rejection_reason = 'incomplete'
           where id = $1`,
          [minutes],
        ),
      ).toBe(1);
      // Work that stays inside needs none.
      expect(await tx.exec(APPROVE, [internal])).toBe(1);

      // A re-verification for another approval does not count; its own does, once.
      await stepUp(tx, founderA, 'approve', internal);
      expect(await errorCode(tx, APPROVE, [post])).toBe(REAUTH);
      const own = await stepUp(tx, founderA, 'approve', post);
      expect(await tx.exec(APPROVE, [post])).toBe(1);
      expect(
        await tx.rows('select consumed_at = now() as used from office.step_ups where id = $1', [
          own,
        ]),
      ).toEqual([{ used: true }]);

      // The statement is fixed when the approval is opened: neither a person nor the agent that
      // opened it changes it.
      const pending = await openApproval(tx, { goes_external: true });
      const change = 'update office.approvals set goes_external = false where id = $1';
      expect(await errorCode(tx, change, [pending])).toBe(DENIED);
      await tx.setContext(founderA);
      expect(await errorCode(tx, change, [pending])).toBe(DENIED);
      expect(await errorCode(tx, APPROVE, [pending])).toBe(REAUTH);
    });
    // For the privileged role too, in both directions.
    await inAdminTransaction(async (tx) => {
      const outgoing = await openApproval(tx, { goes_external: true });
      expect(
        await errorCode(tx, 'update office.approvals set goes_external = false where id = $1', [
          outgoing,
        ]),
      ).toBe('23514');
      expect(
        await errorCode(tx, 'update office.approvals set goes_external = true where id = $1', [
          ids.approvalA,
        ]),
      ).toBe('23514');
      // An update that leaves it as it is passes.
      expect(
        await tx.exec('update office.approvals set goes_external = goes_external where id = $1', [
          outgoing,
        ]),
      ).toBe(1);
    });
  });

  it('only work that goes outside is marked as sent', async () => {
    await inTransaction(async (tx) => {
      const internal = await openApproval(tx, { title: 'İç not' });
      const outgoing = await openApproval(tx, { title: 'Rapor', goes_external: true });
      await tx.setContext(founderA);
      // Stated as staying inside, so approved without a passkey.
      expect(await tx.exec(APPROVE, [internal])).toBe(1);
      await stepUp(tx, founderA, 'approve', outgoing);
      expect(await tx.exec(APPROVE, [outgoing])).toBe(1);

      // Nobody records work that was approved as staying inside as sent outside.
      for (const context of [employeeA, approverA, founderA]) {
        await tx.setContext(context);
        const refused = await tx.expectError(MARK_SENT, [internal]);
        expect(refused.code, JSON.stringify(context)).toBe('23514');
        expect(refused.message).toMatch(/staying inside the company/);
      }
      // Work that was stated as going outside, and the work of an external effect tool (important
      // whatever was stated), is marked as sent by a person.
      await tx.setContext(employeeA);
      expect(await tx.exec(MARK_SENT, [outgoing])).toBe(1);
      expect(await tx.exec(MARK_SENT, [ids.approvalAApproved])).toBe(1);
      const mark = (id: string) =>
        tx.rows(
          `select goes_external, sent_at = now() as sent_now, sent_by_user_id
           from office.approvals where id = $1`,
          [id],
        );
      expect(await mark(internal)).toEqual([
        { goes_external: false, sent_now: null, sent_by_user_id: null },
      ]);
      expect(await mark(outgoing)).toEqual([
        { goes_external: true, sent_now: true, sent_by_user_id: ids.employeeA },
      ]);
      expect(await mark(ids.approvalAApproved)).toEqual([
        { goes_external: false, sent_now: true, sent_by_user_id: ids.employeeA },
      ]);
    });
  });

  it('a new attempt after a change request does not take back that the work involves money or goes outside', async () => {
    await inTransaction(async (tx) => {
      const retry = `insert into office.approvals (company_id, run_id, agent_code, title, payload,
                       previous_approval_id, involves_money, goes_external)
                     values ($1, $2, 'KOR-1', 'İkinci deneme', '{}', $3, $4, $5)
                     returning id, attempt`;
      /** An approval the founder sent back for changes; the context is the agent's again. */
      const sentBack = async (fields: Record<string, unknown>): Promise<string> => {
        const id = await openApproval(tx, fields);
        await tx.setContext(founderA);
        expect(await tx.exec(REQUEST_CHANGES, [id])).toBe(1);
        await tx.setContext(korA);
        return id;
      };
      const outgoing = await sentBack({ goes_external: true });
      const priced = await sentBack({ involves_money: true });
      const both = await sentBack({ involves_money: true, goes_external: true });
      const plain = await sentBack({});

      // previous attempt, involves money, goes outside: each states less than the attempt before.
      for (const [previous, money, external] of [
        [outgoing, false, false],
        [outgoing, true, false],
        [priced, false, false],
        [priced, false, true],
        [both, true, false],
        [both, false, true],
      ] as const) {
        const refused = await tx.expectError(retry, [
          ids.arma,
          ids.runA,
          previous,
          money,
          external,
        ]);
        expect(refused.code, `${previous} ${String(money)} ${String(external)}`).toBe('23514');
        expect(refused.message).toMatch(/cannot take back/);
      }

      // Stating the same, or more, is accepted; the new attempt needs the passkey like the first.
      const second: string[] = [];
      for (const [previous, money, external] of [
        [outgoing, false, true],
        [priced, true, false],
        [both, true, true],
        [plain, true, true],
      ] as const) {
        const [row] = await tx.rows<{ id: string; attempt: number }>(retry, [
          ids.arma,
          ids.runA,
          previous,
          money,
          external,
        ]);
        expect(row?.attempt, previous).toBe(2);
        second.push(row?.id ?? '');
      }
      await tx.setContext(founderA);
      for (const id of second) {
        expect(await errorCode(tx, APPROVE, [id]), id).toBe(REAUTH);
      }
    });
  });

  it('approvals opened before the outgoing statement existed count as going outside', async () => {
    // The two statements of the migration that add the column, run again on the table as it was
    // before (with the fixtures' approvals in it).
    const migration = await readFile(OUTGOING_MIGRATION, 'utf8');
    const statements =
      migration.match(
        /^alter table office\.approvals (?:add|alter) column goes_external[^;]*;$/gm,
      ) ?? [];
    expect(statements).toHaveLength(2);
    await inAdminTransaction(async (tx) => {
      expect(await tx.count('approvals', 'not goes_external')).toBeGreaterThanOrEqual(5);
      await tx.exec('alter table office.approvals drop column goes_external');
      for (const statement of statements) {
        await tx.exec(statement);
      }
      expect(await tx.rows('select distinct goes_external from office.approvals')).toEqual([
        { goes_external: true },
      ]);
      // A pending one is approved only with a passkey now: nothing was stated for it.
      await tx.setContext(founderA);
      expect(
        await tx.rows('select office.approval_needs_step_up($1) as needs', [ids.approvalA]),
      ).toEqual([{ needs: true }]);
      expect(await errorCode(tx, APPROVE, [ids.approvalA])).toBe(REAUTH);
      // The column keeps no default: a new approval still has to state it.
      await tx.setContext(korA);
      expect(
        await errorCode(
          tx,
          `insert into office.approvals (company_id, run_id, agent_code, title, payload,
             involves_money)
           values ($1, $2, 'KOR-1', 'Rapor', '{}', false)`,
          [ids.arma, ids.runA],
        ),
      ).toBe('23502');
    });
  });

  it('an important approval is approved only with a re-verification for it in the same transaction; rejecting needs none', async () => {
    await inTransaction(async (tx) => {
      const external = await openApproval(tx, { tool_name: TOOL.externalEffect });
      const money = await openApproval(tx, { involves_money: true });
      const truth = await openApproval(tx, {
        tool_name: TOOL.internalWrite,
        basis_type: 'note',
        basis_id: ids.noteASourceOfTruth,
        basis_version: 1,
      });
      const plain = await openApproval(tx);
      const rejected = await openApproval(tx, { tool_name: TOOL.externalEffect });
      const changes = await openApproval(tx, { involves_money: true });

      await tx.setContext(founderA);
      for (const id of [external, money, truth]) {
        expect(await errorCode(tx, APPROVE, [id]), id).toBe(REAUTH);
      }
      // Rejecting and asking for changes need no re-verification.
      expect(
        await tx.exec(
          `update office.approvals set status = 'rejected', rejection_reason = 'pricing'
           where id = $1`,
          [rejected],
        ),
      ).toBe(1);
      expect(
        await tx.exec(
          `update office.approvals set status = 'changes_requested', rejection_reason = 'incomplete'
           where id = $1`,
          [changes],
        ),
      ).toBe(1);
      // A plain approval needs none.
      expect(await tx.exec(APPROVE, [plain])).toBe(1);

      // A re-verification for another approval, in another company or by another person does not
      // count.
      await stepUp(tx, founderA, 'approve', plain);
      expect(await errorCode(tx, APPROVE, [truth])).toBe(REAUTH);
      await stepUp(tx, founderP, 'approve', truth);
      await tx.setContext(founderA);
      expect(await errorCode(tx, APPROVE, [truth])).toBe(REAUTH);
      await stepUp(tx, approverA, 'approve', truth);
      await tx.setContext(founderA);
      expect(await errorCode(tx, APPROVE, [truth])).toBe(REAUTH);

      const own = await stepUp(tx, founderA, 'approve', truth);
      expect(await tx.exec(APPROVE, [truth])).toBe(1);
      expect(
        await tx.rows('select consumed_at = now() as used from office.step_ups where id = $1', [
          own,
        ]),
      ).toEqual([{ used: true }]);

      // An employee who can approve needs it too, and each re-verification is used once.
      await stepUp(tx, approverA, 'approve', money);
      expect(await tx.exec(APPROVE, [money])).toBe(1);
      expect(
        await tx.rows('select decided_by_user_id from office.approvals where id = $1', [money]),
      ).toEqual([{ decided_by_user_id: ids.approverA }]);
      await tx.setContext(founderA);
      await stepUp(tx, founderA, 'approve', external);
      expect(await tx.exec(APPROVE, [external])).toBe(1);

      // The money flag is fixed when the approval is opened.
      const pending = await openApproval(tx);
      await tx.setContext(founderA);
      expect(
        await errorCode(tx, 'update office.approvals set involves_money = true where id = $1', [
          pending,
        ]),
      ).toBe(DENIED);
      // The check that uses re-verifications up cannot be called directly.
      expect(
        await errorCode(tx, 'select office.consume_step_up($1, $2, $3)', [
          'approve',
          ids.arma,
          pending,
        ]),
      ).toBe(DENIED);
    });
  });

  it('a re-verification from an earlier transaction does not approve; the money flag never changes', async () => {
    await inAdminTransaction(async (tx) => {
      const approval = await openApproval(tx, { tool_name: TOOL.externalEffect });
      const base = {
        userId: ids.founder,
        sessionId: ids.founderSession,
        passkeyId: FOUNDER_PASSKEY,
        purpose: 'approve',
        companyId: ids.arma,
        subjectId: approval,
      };
      await tx.setContext(founderA);
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, APPROVE, [approval])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, APPROVE, [approval])).toBe(REAUTH);
      await insertStepUp(tx, base);
      expect(await tx.exec(APPROVE, [approval])).toBe(1);

      expect(
        await errorCode(tx, 'update office.approvals set involves_money = true where id = $1', [
          ids.approvalA,
        ]),
      ).toBe('23514');
    });
  });
});

describe.skipIf(noDatabase)('membership changes', () => {
  afterAll(closePools);

  it('a role change, an approval right change and a removal need a re-verification for that member and company', async () => {
    await inTransaction(async (tx) => {
      const grant = `update office.memberships set can_approve = true ${MEMBERSHIP}`;
      const demote = `update office.memberships set role = 'external' ${MEMBERSHIP}`;
      const remove = `delete from office.memberships ${MEMBERSHIP}`;
      const employee = [ids.arma, ids.employeeA];
      await tx.setContext(founderA);
      expect(await errorCode(tx, grant, employee)).toBe(REAUTH);
      expect(await errorCode(tx, demote, employee)).toBe(REAUTH);
      expect(await errorCode(tx, remove, [ids.arma, ids.externalA])).toBe(REAUTH);
      // An update that changes neither column needs none.
      expect(
        await tx.exec(`update office.memberships set role = role ${MEMBERSHIP}`, employee),
      ).toBe(1);

      // Another member, another company or an approval does not count.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      expect(await errorCode(tx, grant, employee)).toBe(REAUTH);
      await stepUp(tx, founderP, 'membership_change', ids.employeeA);
      await tx.setContext(founderA);
      expect(await errorCode(tx, grant, employee)).toBe(REAUTH);
      await stepUp(tx, founderA, 'approve', ids.employeeA);
      expect(await errorCode(tx, grant, employee)).toBe(REAUTH);

      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      expect(await tx.exec(grant, employee)).toBe(1);
      // Used once: the next change needs another.
      expect(await errorCode(tx, demote, employee)).toBe(REAUTH);
      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      expect(await tx.exec(demote, employee)).toBe(1);

      await stepUp(tx, founderA, 'membership_change', ids.externalA);
      expect(await tx.exec(remove, [ids.arma, ids.externalA])).toBe(1);
    });
  });

  it('a re-verification from an earlier transaction does not count; the seed and migrations need none', async () => {
    await inAdminTransaction(async (tx) => {
      const grant = `update office.memberships set can_approve = true ${MEMBERSHIP}`;
      const base = {
        userId: ids.founder,
        sessionId: ids.founderSession,
        passkeyId: FOUNDER_PASSKEY,
        purpose: 'membership_change',
        companyId: ids.arma,
        subjectId: ids.employeeA,
      };
      await tx.setContext(founderA);
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, grant, [ids.arma, ids.employeeA])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, grant, [ids.arma, ids.employeeA])).toBe(REAUTH);
      // An agent run cannot use a re-verification even if one exists.
      await insertStepUp(tx, base);
      await tx.setContext(korA);
      expect(await errorCode(tx, grant, [ids.arma, ids.employeeA])).toBe(REAUTH);

      // Without a person in the context (the seed, migrations) no re-verification is needed.
      await tx.setContext({});
      expect(await tx.exec(grant, [ids.arma, ids.employeeA])).toBe(1);
      expect(
        await tx.exec(`delete from office.memberships ${MEMBERSHIP}`, [ids.arma, ids.externalA]),
      ).toBe(1);
    });
  });
});

describe.skipIf(noDatabase)('invitations and accounts', () => {
  afterAll(closePools);

  const INVITE = `insert into office.invitations (id, company_id, email, role, can_approve)
                  values ($1, $2, $3, 'employee', $4)`;
  // A renewal sets a new expiry (within 30 days of creation).
  const RENEW = `update office.invitations set expires_at = now() + make_interval(days => $2)
                 where id = $1`;

  it('an invitation, which grants a membership and the approval right, needs a re-verification for it', async () => {
    await inTransaction(async (tx) => {
      // A stolen founder session alone cannot invite someone with the approval right.
      const attacker = randomUUID();
      await tx.setContext(founderA);
      expect(await errorCode(tx, INVITE, [attacker, ids.arma, 'x@evil.test', true])).toBe(REAUTH);
      expect(await tx.count('invitations', 'id = $1', [attacker])).toBe(0);

      // Another invitation, another company, another purpose or another person does not count.
      const id = randomUUID();
      await stepUp(tx, founderA, 'invitation', randomUUID());
      expect(await errorCode(tx, INVITE, [id, ids.arma, 'new@example.test', true])).toBe(REAUTH);
      await stepUp(tx, founderP, 'invitation', id);
      await tx.setContext(founderA);
      expect(await errorCode(tx, INVITE, [id, ids.arma, 'new@example.test', true])).toBe(REAUTH);
      await stepUp(tx, founderA, 'membership_change', id);
      expect(await errorCode(tx, INVITE, [id, ids.arma, 'new@example.test', true])).toBe(REAUTH);
      await stepUp(tx, approverA, 'invitation', id);
      await tx.setContext(founderA);
      expect(await errorCode(tx, INVITE, [id, ids.arma, 'new@example.test', true])).toBe(REAUTH);

      const own = await stepUp(tx, founderA, 'invitation', id);
      expect(await tx.exec(INVITE, [id, ids.arma, 'new@example.test', true])).toBe(1);
      expect(
        await tx.rows('select consumed_at = now() as used from office.step_ups where id = $1', [
          own,
        ]),
      ).toEqual([{ used: true }]);

      // Renewing brings an expired grant back: it needs its own re-verification; cancelling needs
      // none.
      expect(await errorCode(tx, RENEW, [id, 8])).toBe(REAUTH);
      await stepUp(tx, founderA, 'invitation', id);
      expect(await tx.exec(RENEW, [id, 8])).toBe(1);
      expect(await errorCode(tx, RENEW, [id, 9])).toBe(REAUTH);
      // An update that leaves the expiry as it is needs none.
      expect(
        await tx.exec('update office.invitations set expires_at = expires_at where id = $1', [id]),
      ).toBe(1);
      expect(
        await tx.exec('update office.invitations set cancelled_at = now() where id = $1', [id]),
      ).toBe(1);

      // A wrong invitation is refused for what is wrong with it, before any re-verification.
      expect(
        await errorCode(
          tx,
          `insert into office.invitations (id, company_id, email, role, can_approve)
           values ($1, $2, 'x@example.test', 'external', true)`,
          [randomUUID(), ids.arma],
        ),
      ).toBe('23514');
      await tx.setContext(employeeA);
      expect(await errorCode(tx, INVITE, [randomUUID(), ids.arma, 'y@example.test', false])).toBe(
        DENIED,
      );
    });
  });

  it('an invitation re-verification from an earlier transaction does not count; the seed needs none', async () => {
    await inAdminTransaction(async (tx) => {
      const id = randomUUID();
      const base = {
        userId: ids.founder,
        sessionId: ids.founderSession,
        passkeyId: FOUNDER_PASSKEY,
        purpose: 'invitation',
        companyId: ids.arma,
        subjectId: id,
      };
      await tx.setContext(founderA);
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, INVITE, [id, ids.arma, 'late@example.test', false])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, INVITE, [id, ids.arma, 'late@example.test', false])).toBe(REAUTH);
      await insertStepUp(tx, base);
      expect(await tx.exec(INVITE, [id, ids.arma, 'late@example.test', false])).toBe(1);
      // The fixtures' invitations used the founder's re-verifications.
      expect(
        await tx.rows(
          'select id, consumed_at is not null as used from office.step_ups where id = any($1) order by id',
          [[ids.stepUpInvitationA, ids.stepUpInvitationP]],
        ),
      ).toEqual([
        { id: ids.stepUpInvitationA, used: true },
        { id: ids.stepUpInvitationP, used: true },
      ]);
    });
  });

  it('activating or deactivating an account needs a re-verification for that account', async () => {
    await inTransaction(async (tx) => {
      const deactivate = 'update office.users set active = false where id = $1';
      const reactivate = 'update office.users set active = true where id = $1';
      await tx.setContext(founderA);
      expect(await errorCode(tx, deactivate, [ids.approverA])).toBe(REAUTH);

      // Another account, another company or another purpose does not count.
      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      expect(await errorCode(tx, deactivate, [ids.approverA])).toBe(REAUTH);
      await stepUp(tx, founderP, 'membership_change', ids.approverA);
      await tx.setContext(founderA);
      expect(await errorCode(tx, deactivate, [ids.approverA])).toBe(REAUTH);
      await stepUp(tx, founderA, 'approve', ids.approverA);
      expect(await errorCode(tx, deactivate, [ids.approverA])).toBe(REAUTH);

      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      expect(await tx.exec(deactivate, [ids.approverA])).toBe(1);
      // Reactivating brings the approval right back: it needs its own.
      expect(await errorCode(tx, reactivate, [ids.approverA])).toBe(REAUTH);
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      expect(await tx.exec(reactivate, [ids.approverA])).toBe(1);
      await tx.setContext(approverA);
      expect(await tx.rows('select office.can_approve() as approve')).toEqual([{ approve: true }]);

      // A change of the name needs none.
      await tx.setContext(founderA);
      expect(
        await tx.exec(`update office.users set name = 'Yeni Ad' where id = $1`, [ids.approverA]),
      ).toBe(1);
      // The guards still answer first.
      expect(await errorCode(tx, deactivate, [ids.founder])).toBe(DENIED);
    });
  });

  it('an account re-verification from an earlier transaction does not count; without a person none is needed', async () => {
    await inAdminTransaction(async (tx) => {
      const deactivate = 'update office.users set active = false where id = $1';
      const base = {
        userId: ids.founder,
        sessionId: ids.founderSession,
        passkeyId: FOUNDER_PASSKEY,
        purpose: 'membership_change',
        companyId: ids.arma,
        subjectId: ids.employeeA,
      };
      await tx.setContext(founderA);
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, deactivate, [ids.employeeA])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, deactivate, [ids.employeeA])).toBe(REAUTH);
      await insertStepUp(tx, base);
      expect(await tx.exec(deactivate, [ids.employeeA])).toBe(1);
    });
  });
});

describe.skipIf(noDatabase)('resetting passkeys', () => {
  afterAll(closePools);

  const CAN_RESET = 'select office.can_reset_passkeys($1) as can';

  it('only an active founder resets the passkeys of another person whose every company they run, with a re-verification for that person', async () => {
    await inTransaction(async (tx) => {
      // The approver signed in and has a passkey.
      const approverSession = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      await registerPasskey(tx, approverSession);
      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);

      // The question the API asks before it opens the ceremony.
      for (const [userId, expected] of [
        [ids.approverA, true],
        [ids.employeeA, true],
        [ids.externalA, true],
        // Not their own.
        [ids.founder, false],
        // Also works at a company the founder does not run; a member of no company; a member of
        // another company only.
        [ids.sharedEmployee, false],
        [ids.formerEmployee, false],
        [ids.employeeP, false],
        [ids.otherFounder, false],
        [null, false],
      ] as const) {
        expect(await tx.rows(CAN_RESET, [userId]), String(userId)).toEqual([{ can: expected }]);
      }
      for (const context of [approverA, employeeA, korA, { userId: ids.founder }, {}]) {
        await tx.setContext(context);
        expect(await tx.rows(CAN_RESET, [ids.employeeA]), JSON.stringify(context)).toEqual([
          { can: false },
        ]);
      }

      // A stolen founder session alone resets nothing.
      await tx.setContext(founderA);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(REAUTH);
      expect(await errorCode(tx, RESET, [session.key, null])).toBe(INVALID);

      // Never their own, a person who also belongs to a company they do not run, or a person
      // outside the context company: refused even with a re-verification that names the person,
      // by the function's own rule (before it reaches the row policies).
      const OWN = /their own passkeys/;
      const NOT_THEIRS = /every company they run/;
      for (const [userId, reason] of [
        [ids.founder, OWN],
        [ids.sharedEmployee, NOT_THEIRS],
        [ids.formerEmployee, NOT_THEIRS],
        [ids.employeeP, NOT_THEIRS],
        [ids.otherFounder, NOT_THEIRS],
      ] as const) {
        await stepUp(tx, founderA, 'passkey_reset', userId, session);
        const refused = await tx.expectError(RESET, [session.key, userId]);
        expect(refused.code, userId).toBe(DENIED);
        expect(refused.message, userId).toMatch(reason);
      }

      // A re-verification for another person, in another company, for another purpose or of
      // another session of the founder does not count.
      await stepUp(tx, founderA, 'passkey_reset', ids.employeeA, session);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(REAUTH);
      await stepUp(tx, founderP, 'passkey_reset', ids.approverA, session);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(DENIED);
      await tx.setContext(founderA);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(REAUTH);
      await stepUp(tx, founderA, 'membership_change', ids.approverA, session);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(REAUTH);
      await stepUp(tx, founderA, 'passkey_reset', ids.approverA);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(REAUTH);

      // An employee, even one who can approve and re-verified with their own passkey, resets
      // nobody; neither does an agent run with the founder's identity.
      await stepUp(tx, approverA, 'passkey_reset', ids.employeeA, approverSession);
      const byEmployee = await tx.expectError(RESET, [approverSession.key, ids.employeeA]);
      expect(byEmployee.code).toBe(DENIED);
      expect(byEmployee.message).toMatch(NOT_THEIRS);
      await stepUp(tx, founderA, 'passkey_reset', ids.approverA, session);
      await tx.setContext(korA);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(DENIED);

      // The founder, with the re-verification of this session for this person: once.
      await tx.setContext(founderA);
      expect(await tx.rows(RESET, [session.key, ids.approverA])).toEqual([{ revoked: 1 }]);
      expect(
        await tx.count(
          'step_ups',
          `purpose = 'passkey_reset' and subject_id = $1 and session_id = $2 and consumed_at = now()`,
          [ids.approverA, session.id],
        ),
      ).toBe(1);
      expect(await errorCode(tx, RESET, [session.key, ids.approverA])).toBe(REAUTH);
      // The person's session is closed and their passkey is gone.
      await tx.setContext(approverA);
      expect(await tx.count('passkeys')).toBe(0);
      expect(
        await errorCode(tx, 'select * from office.get_passkey_for_assertion($1, $2)', [
          approverSession.key,
          FOUNDER_PASSKEY,
        ]),
      ).toBe(DENIED);
      // The founder's own passkey and session are untouched.
      await tx.setContext(founderA);
      expect(await tx.rows('select id from office.passkeys')).toEqual([{ id: FOUNDER_PASSKEY }]);
      expect(await tx.rows('select id from office.sessions where id = $1', [session.id])).toEqual([
        { id: session.id },
      ]);
    });

    // The worker cannot call it at all.
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, korA]) {
        await tx.setContext(context);
        expect(await errorCode(tx, RESET, [randomBytes(32), ids.approverA])).toBe(DENIED);
        expect(await errorCode(tx, CAN_RESET, [ids.approverA])).toBe(DENIED);
      }
    });
  });

  it('a reset revokes every passkey, closes the sessions, is written to the audit log, and a new sign-in registers a first passkey again', async () => {
    await inAdminTransaction(async (tx) => {
      // The person also works at Pillika, which the same founder runs.
      await tx.exec(
        `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'employee')`,
        [ids.pillika, ids.employeeA],
      );
      // The person: two passkeys, two open sessions and one they closed themselves.
      const phone = await openTestSession(tx, ids.employeeA);
      await tx.setContext(employeeA);
      const first = await registerPasskey(tx, phone, undefined, 'Phone');
      await recordStepUp(tx, phone, null, {
        purpose: 'passkey_add',
        subjectId: null,
        credentialId: first.credentialId,
      });
      await registerPasskey(tx, phone, await createChallenge(tx, phone, 'register'), 'Laptop');
      const laptop = await openTestSession(tx, ids.employeeA);
      const loggedOut = await openTestSession(tx, ids.employeeA);
      // A ceremony the person has under way on the laptop.
      await tx.setContext(employeeA);
      const underWay = await createChallenge(tx, laptop, 'step_up');
      await tx.setContext({});
      await tx.rows('select office.close_session($1)', [loggedOut.key]);

      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const foundersOwn = await createChallenge(tx, session, 'step_up');
      // A re-verification from an earlier transaction does not count.
      const base = {
        userId: ids.founder,
        sessionId: session.id,
        passkeyId: FOUNDER_PASSKEY,
        purpose: 'passkey_reset',
        companyId: ids.arma,
        subjectId: ids.employeeA,
      };
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, RESET, [session.key, ids.employeeA])).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, RESET, [session.key, ids.employeeA])).toBe(REAUTH);
      expect(
        await tx.count('passkeys', 'user_id = $1 and revoked_at is null', [ids.employeeA]),
      ).toBe(2);

      await stepUp(tx, founderA, 'passkey_reset', ids.employeeA, session);
      expect(await tx.rows(RESET, [session.key, ids.employeeA])).toEqual([{ revoked: 2 }]);

      // Every passkey of the person is revoked; nobody else's.
      expect(
        await tx.rows(
          `select name, revoked_at = now() as revoked_now from office.passkeys
           where user_id = $1 order by name`,
          [ids.employeeA],
        ),
      ).toEqual([
        { name: 'Laptop', revoked_now: true },
        { name: 'Phone', revoked_now: true },
      ]);
      expect(await tx.count('passkeys', 'revoked_at is null')).toBe(1);
      expect(await tx.count('passkeys', 'id = $1 and revoked_at is null', [FOUNDER_PASSKEY])).toBe(
        1,
      );
      // The person's open challenge is closed, so nothing under way finishes after the reset; the
      // founder's own stays open.
      expect(
        await tx.rows(
          `select id, consumed_at = now() as closed_now from office.passkey_challenges
           where id = any($1) order by user_id`,
          [[underWay, foundersOwn]],
        ),
      ).toEqual([
        { id: foundersOwn, closed_now: null },
        { id: underWay, closed_now: true },
      ]);

      // The open sessions are closed with the new reason and each has its login event; the session
      // the person closed keeps its own reason; the founder's session stays open.
      const ended = (id: string) =>
        tx.rows(
          `select s.close_reason, s.closed_at = now() as closed_now, e.event, e.reason, e.user_id
           from office.sessions s left join office.login_events e on e.session_id = s.id
           where s.id = $1`,
          [id],
        );
      const reset = {
        close_reason: 'passkeys_reset',
        closed_now: true,
        event: 'session_expired',
        reason: 'passkeys_reset',
        user_id: ids.employeeA,
      };
      expect(await ended(phone.id)).toEqual([reset]);
      expect(await ended(laptop.id)).toEqual([reset]);
      expect(await ended(loggedOut.id)).toEqual([
        { close_reason: 'logout', closed_now: true, event: null, reason: null, user_id: null },
      ]);
      expect(await ended(session.id)).toEqual([
        { close_reason: null, closed_now: null, event: null, reason: null, user_id: null },
      ]);
      await tx.setContext({});
      expect(await tx.rows('select * from office.verify_session($1, 1800)', [phone.key])).toEqual(
        [],
      );
      expect(
        await tx.rows('select * from office.verify_session($1, 1800)', [session.key]),
      ).toHaveLength(1);

      // One audit row, by the founder, naming the person: in the company the founder acted in,
      // although the reset reaches the person's Pillika sessions too (where the row of a person of
      // several companies belongs is not decided; this is the behaviour until it is).
      expect(
        await tx.rows(
          `select company_id, user_id, agent_code, run_id, record_type, record_id,
                  occurred_at = now() as now
           from office.audit_log where event = 'passkeys_reset'`,
        ),
      ).toEqual([
        {
          company_id: ids.arma,
          user_id: ids.founder,
          agent_code: null,
          run_id: null,
          record_type: 'user',
          record_id: ids.employeeA,
          now: true,
        },
      ]);

      // The person is told: one notification in that company, sent by the founder, naming the
      // event and the person, without free text. The person reads it after the next sign-in.
      expect(
        await tx.rows(
          `select company_id, project_id, recipient_user_id, record_type, record_id, channel,
                  sender_user_id, sender_agent_code, read_at, created_at = now() as now
           from office.notifications where template = 'passkeys_reset'`,
        ),
      ).toEqual([
        {
          company_id: ids.arma,
          project_id: null,
          recipient_user_id: ids.employeeA,
          record_type: 'user',
          record_id: ids.employeeA,
          channel: 'panel',
          sender_user_id: ids.founder,
          sender_agent_code: null,
          read_at: null,
          now: true,
        },
      ]);
      // The Bugün screen lists it for the person alone, unread and about no request; the founder
      // who reset reads the company's log and still does not get it as their own.
      await tx.setContext(employeeA);
      expect(await listNotifications(tx.client, { keepDays: 30, limit: 10 })).toEqual([
        {
          id: expect.any(String) as unknown,
          template: 'passkeys_reset',
          created_at: expect.any(Date) as unknown,
          read: false,
          request_id: null,
          request_title: null,
          unit_code: null,
          unit_name: null,
        },
      ]);
      await tx.setContext(founderA);
      expect(await tx.count('notifications', `template = 'passkeys_reset'`)).toBe(1);
      expect(await listNotifications(tx.client, { keepDays: 30, limit: 10 })).toEqual([]);

      // The old sessions register nothing; after a new Google sign-in the person registers a
      // first passkey again and re-verifies with it. The revoked ones never come back.
      await tx.setContext(employeeA);
      const register = `select office.create_passkey_challenge($1, 'register', $2, null)`;
      for (const old of [phone, laptop]) {
        expect(await errorCode(tx, register, [old.key, randomBytes(32)])).toBe(DENIED);
      }
      const fresh = await openTestSession(tx, ids.employeeA);
      await tx.setContext(employeeA);
      const again = await registerPasskey(tx, fresh, undefined, 'New phone');
      expect(
        await tx.rows(
          'select name from office.passkeys where user_id = $1 and revoked_at is null',
          [ids.employeeA],
        ),
      ).toEqual([{ name: 'New phone' }]);
      await recordStepUp(tx, fresh, null, {
        purpose: 'passkey_add',
        subjectId: null,
        credentialId: again.credentialId,
      });
      const contextHash = hash();
      const challenge = await createChallenge(tx, fresh, 'step_up', contextHash);
      expect(
        await errorCode(tx, recordSql(), [
          fresh.key,
          challenge,
          first.credentialId,
          0,
          null,
          null,
          contextHash,
        ]),
      ).toBe(REAUTH);
      expect(
        await errorCode(tx, 'update office.passkeys set revoked_at = null where id = $1', [
          first.credentialId,
        ]),
      ).toBe('23514');
    });
  });

  it('a person without a passkey is reset too; a deactivated founder resets nobody', async () => {
    await inAdminTransaction(async (tx) => {
      // The external person signed in but never registered a passkey.
      const waiting = await openTestSession(tx, ids.externalA);
      const session = await openTestSession(tx, ids.founder);
      await stepUp(tx, founderA, 'passkey_reset', ids.externalA, session);
      expect(await tx.rows(RESET, [session.key, ids.externalA])).toEqual([{ revoked: 0 }]);
      expect(
        await tx.rows('select close_reason from office.sessions where id = $1', [waiting.id]),
      ).toEqual([{ close_reason: 'passkeys_reset' }]);
      expect(
        await tx.count('audit_log', `event = 'passkeys_reset' and record_id = $1`, [ids.externalA]),
      ).toBe(1);

      // A second founder of Arma DX resets its members, but not the founder who also runs
      // companies the second one does not; once deactivated, nobody.
      await tx.setContext({});
      await tx.exec(`update office.memberships set role = 'founder' ${MEMBERSHIP}`, [
        ids.arma,
        ids.employeeA,
      ]);
      await tx.setContext(employeeA);
      expect(await tx.rows(CAN_RESET, [ids.approverA])).toEqual([{ can: true }]);
      expect(await tx.rows(CAN_RESET, [ids.founder])).toEqual([{ can: false }]);

      // A founder's passkeys are never reset by another founder, not even by one who runs every
      // company of theirs: the database administrator resets them.
      const secondFounder = await openTestSession(tx, ids.employeeA);
      await tx.setContext(employeeA);
      await registerPasskey(tx, secondFounder);
      await tx.setContext(founderA);
      expect(await tx.rows(CAN_RESET, [ids.employeeA])).toEqual([{ can: false }]);
      await stepUp(tx, founderA, 'passkey_reset', ids.employeeA, session);
      const refused = await tx.expectError(RESET, [session.key, ids.employeeA]);
      expect(refused.code).toBe(DENIED);
      expect(refused.message).toMatch(/every company they run/);
      expect(
        await tx.count('passkeys', 'user_id = $1 and revoked_at is null', [ids.employeeA]),
      ).toBe(1);
      expect(await tx.count('sessions', 'id = $1 and closed_at is null', [secondFounder.id])).toBe(
        1,
      );
      // A founder of another company who is only an employee here is not reset either.
      await tx.setContext({});
      await tx.exec(`update office.memberships set role = 'employee' ${MEMBERSHIP}`, [
        ids.arma,
        ids.employeeA,
      ]);
      await tx.exec(
        `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'founder')`,
        [ids.pillika, ids.employeeA],
      );
      await tx.setContext(founderA);
      expect(await tx.rows(CAN_RESET, [ids.employeeA])).toEqual([{ can: false }]);
      await tx.setContext({});
      await tx.exec(`delete from office.memberships ${MEMBERSHIP}`, [ids.pillika, ids.employeeA]);
      await tx.exec(`update office.memberships set role = 'founder' ${MEMBERSHIP}`, [
        ids.arma,
        ids.employeeA,
      ]);

      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      await tx.exec('update office.users set active = false where id = $1', [ids.employeeA]);
      await tx.setContext(employeeA);
      expect(await tx.rows(CAN_RESET, [ids.approverA])).toEqual([{ can: false }]);
    });
  });
});

describe.skipIf(noDatabase)("the database administrator's passkey reset", () => {
  afterAll(closePools);

  it("resets a founder's passkeys by hand, as a role that owns the tables and bypasses row security", async () => {
    await inAdminTransaction(async (tx) => {
      // The founder: the fixtures' passkey, two open sessions and a ceremony under way.
      const phone = await openTestSession(tx, ids.founder);
      const laptop = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const underWay = await createChallenge(tx, laptop, 'step_up');
      // A member keeps their passkey and session.
      const member = await openTestSession(tx, ids.approverA);
      await tx.setContext(approverA);
      const memberPasskey = await registerPasskey(tx, member);

      // Never inside a request or an agent run, even as the privileged role.
      for (const context of [founderA, korA, { userId: ids.founder }]) {
        await tx.setContext(context);
        const refused = await tx.expectError(ADMIN_RESET, ['founder@arma.test']);
        expect(refused.code, JSON.stringify(context)).toBe(DENIED);
        expect(refused.message).toMatch(/outside a request/);
      }
      await tx.setContext({});
      const unknown = await tx.expectError(ADMIN_RESET, ['nobody@example.test']);
      expect(unknown.code).toBe('P0002');
      // The address is not repeated in the message.
      expect(unknown.message).not.toMatch(/nobody@/);

      // The administrator on Supabase is the role that ran the migrations: not a superuser, owner of
      // the tables, bypasses row security. A superuser (the local test server) plays that role
      // through one created here and rolled back with the transaction; a server like Supabase runs
      // the reset as its own administrator, since nobody can grant that role there.
      const [server] = await tx.rows<{ superuser: boolean }>(
        'select rolsuper as superuser from pg_catalog.pg_roles where rolname = current_user',
      );
      const superuser = server?.superuser === true;
      if (superuser) {
        const suffix = randomBytes(6).toString('hex');
        const createRole = async (name: string, bypass: 'bypassrls' | 'nobypassrls') => {
          const [row] = await tx.rows<{ sql: string }>(
            `select format('create role %I nosuperuser %s in role %I', $1::text, $2::text,
               current_user::text) as sql`,
            [name, bypass],
          );
          await tx.exec(row?.sql ?? '');
        };
        const administrator = `admin_reset_${suffix}`;
        const withoutBypass = `admin_reset_rls_${suffix}`;
        await createRole(administrator, 'bypassrls');
        await createRole(withoutBypass, 'nobypassrls');

        // Without the right to bypass row security nothing would be found: it says so instead.
        await tx.exec(`set local role ${withoutBypass}`);
        const blind = await tx.expectError(ADMIN_RESET, ['founder@arma.test']);
        expect(blind.code).toBe(DENIED);
        expect(blind.message).toMatch(/bypasses row security/);
        await tx.exec(`set local role ${administrator}`);
      }

      // By any of the account's sign-in addresses, whatever its case.
      expect(await tx.rows(ADMIN_RESET, ['  Founder@Pillika.test '])).toEqual([
        { passkeys_revoked: 1, sessions_closed: 2 },
      ]);
      if (superuser) await tx.exec('reset role');

      expect(await tx.count('passkeys', 'user_id = $1 and revoked_at is null', [ids.founder])).toBe(
        0,
      );
      expect(
        await tx.rows(
          'select consumed_at = now() as closed_now from office.passkey_challenges where id = $1',
          [underWay],
        ),
      ).toEqual([{ closed_now: true }]);
      expect(
        await tx.rows(
          `select s.close_reason, e.event, e.reason
           from office.sessions s left join office.login_events e on e.session_id = s.id
           where s.id = any($1) order by s.id`,
          [[phone.id, laptop.id]],
        ),
      ).toEqual(
        [phone, laptop].map(() => ({
          close_reason: 'passkeys_reset',
          event: 'session_expired',
          reason: 'passkeys_reset',
        })),
      );
      // One audit row in every company of the account, without an actor.
      expect(
        await tx.rows(
          `select company_id, user_id, agent_code, record_type, record_id
           from office.audit_log where event = 'passkeys_reset' order by company_id`,
        ),
      ).toEqual(
        [ids.arma, ids.pillika, ids.founderSpace].map((company) => ({
          company_id: company,
          user_id: null,
          agent_code: null,
          record_type: 'user',
          record_id: ids.founder,
        })),
      );
      // Nobody else is touched.
      expect(
        await tx.count('passkeys', 'id = $1 and revoked_at is null', [memberPasskey.credentialId]),
      ).toBe(1);
      expect(await tx.count('sessions', 'id = $1 and closed_at is null', [member.id])).toBe(1);

      // A second run finds nothing left to revoke or close.
      expect(await tx.rows(ADMIN_RESET, ['founder@arma.test'])).toEqual([
        { passkeys_revoked: 0, sessions_closed: 0 },
      ]);

      // The old sessions are dead; after a new Google sign-in the founder registers a first passkey
      // again and re-verifies with it.
      await tx.setContext(founderA);
      expect(
        await errorCode(tx, `select office.create_passkey_challenge($1, 'register', $2, null)`, [
          phone.key,
          randomBytes(32),
        ]),
      ).toBe(DENIED);
      const fresh = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const again = await registerPasskey(tx, fresh, undefined, 'New phone');
      await recordStepUp(tx, fresh, ids.arma, {
        purpose: 'membership_change',
        subjectId: ids.employeeA,
        credentialId: again.credentialId,
      });
    });
  });
});

describe.skipIf(noDatabase)('access grants', () => {
  afterAll(closePools);

  const task = [ids.arma, ids.externalA, 'task', ids.taskA];
  const note = [ids.arma, ids.externalA, 'note', ids.noteA];
  const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };

  it('opening a task or a note to a person needs a re-verification for that person and company; taking it back needs none', async () => {
    await inTransaction(async (tx) => {
      // A stolen founder session alone opens nothing to an external person.
      await tx.setContext(founderA);
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      expect(await errorCode(tx, GRANT, note)).toBe(REAUTH);
      expect(await tx.count('access_grants', 'record_id = any($1)', [[ids.taskA, ids.noteA]])).toBe(
        0,
      );

      // Another grantee, another company, another purpose or another person does not count.
      await stepUp(tx, founderA, 'access_grant', ids.employeeA);
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      await stepUp(tx, founderP, 'access_grant', ids.externalA);
      await tx.setContext(founderA);
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      await stepUp(tx, founderA, 'membership_change', ids.externalA);
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      await stepUp(tx, approverA, 'access_grant', ids.externalA);
      await tx.setContext(founderA);
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);

      const own = await stepUp(tx, founderA, 'access_grant', ids.externalA);
      expect(await tx.exec(GRANT, task)).toBe(1);
      expect(
        await tx.rows('select consumed_at = now() as used from office.step_ups where id = $1', [
          own,
        ]),
      ).toEqual([{ used: true }]);
      // Used once: the note needs its own.
      expect(await errorCode(tx, GRANT, note)).toBe(REAUTH);
      await stepUp(tx, founderA, 'access_grant', ids.externalA);
      expect(await tx.exec(GRANT, note)).toBe(1);
      await tx.setContext(externalA);
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(1);
      expect(await tx.count('notes', 'id = $1', [ids.noteA])).toBe(1);

      // A grant is never rewritten: that would open another record, or open this one to another
      // person, without a re-verification.
      await tx.setContext(founderA);
      for (const [column, value] of [
        ['record_id', ids.noteASourceOfTruth],
        ['user_id', ids.employeeA],
        ['record_type', 'task'],
      ]) {
        expect(
          await errorCode(
            tx,
            `update office.access_grants set ${String(column)} = $2 where record_id = $1`,
            [ids.noteA, value],
          ),
          column,
        ).toBe('23514');
      }

      // Taking a grant back needs no re-verification.
      expect(
        await tx.exec('delete from office.access_grants where user_id = $1 and record_id = $2', [
          ids.externalA,
          ids.taskA,
        ]),
      ).toBe(1);
      await tx.setContext(externalA);
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(0);

      // Project membership changes need none either (5 October decision 4).
      await tx.setContext(founderA);
      expect(
        await tx.exec(
          'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)',
          [ids.arma, ids.projectA, ids.approverA],
        ),
      ).toBe(1);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
          ids.projectA,
          ids.approverA,
        ]),
      ).toBe(1);
    });
  });

  it('only the founder grants access, even when another person re-verified for it', async () => {
    await inTransaction(async (tx) => {
      for (const context of [approverA, employeeA, externalA]) {
        await stepUp(tx, context, 'access_grant', ids.externalA);
        expect(await errorCode(tx, GRANT, task), JSON.stringify(context)).toBe(DENIED);
      }
      await tx.setContext(founderA);
      expect(await tx.count('access_grants', 'record_id = $1', [ids.taskA])).toBe(0);
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(korA);
      expect(await errorCode(tx, GRANT, task)).toBe(DENIED);
    });
  });

  it('an access grant re-verification from an earlier transaction does not count; an insert without a person needs none', async () => {
    await inAdminTransaction(async (tx) => {
      const base = {
        userId: ids.founder,
        sessionId: ids.founderSession,
        passkeyId: FOUNDER_PASSKEY,
        purpose: 'access_grant',
        companyId: ids.arma,
        subjectId: ids.externalA,
      };
      await tx.setContext(founderA);
      await insertStepUp(tx, { ...base, verifiedAt: '1 minute' });
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      await insertStepUp(tx, { ...base, verifiedXact: '1' });
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      // An agent run cannot use a re-verification even if one exists.
      await insertStepUp(tx, base);
      await tx.setContext(korA);
      expect(await errorCode(tx, GRANT, task)).toBe(REAUTH);
      await tx.setContext(founderA);
      expect(await tx.exec(GRANT, task)).toBe(1);

      // Without a person in the context (the seed, an administrator) no re-verification is needed;
      // the fixtures' grants were written this way.
      await tx.setContext({});
      expect(await tx.exec(GRANT, note)).toBe(1);
      expect(await tx.count('step_ups', `purpose = 'access_grant' and consumed_at is null`)).toBe(
        2,
      );
    });
  });
});

describe.skipIf(noDatabase)('passkey visibility', () => {
  afterAll(closePools);

  it("a person sees only their own passkeys and re-verifications, and a company's only in its context", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await tx.rows('select id from office.passkeys')).toEqual([{ id: FOUNDER_PASSKEY }]);
      expect(await errorCode(tx, 'select public_key from office.passkeys')).toBe(DENIED);
      expect(await tx.rows('select id from office.step_ups order by id')).toEqual([
        { id: ids.stepUpA },
        { id: ids.stepUpInvitationA },
      ]);
      await tx.setContext(founderP);
      expect(await tx.rows('select id from office.step_ups order by id')).toEqual([
        { id: ids.stepUpP },
        { id: ids.stepUpInvitationP },
      ]);
      await tx.setContext({ companyId: ids.founderSpace, userId: ids.founder });
      expect(await tx.count('step_ups')).toBe(0);

      // A re-verification for a passkey change belongs to no company: the person sees it in every
      // context.
      const added = await stepUp(tx, founderA, 'passkey_add', null);
      for (const context of [founderA, founderP]) {
        await tx.setContext(context);
        expect(await tx.count('step_ups', 'id = $1', [added])).toBe(1);
      }

      for (const context of [approverA, employeeA, korA, { userId: ids.approverA }, {}]) {
        await tx.setContext(context);
        expect(await tx.count('passkeys'), JSON.stringify(context)).toBe(0);
        expect(await tx.count('step_ups'), JSON.stringify(context)).toBe(0);
      }
      // Another person's new passkey and re-verification stay theirs.
      await stepUp(tx, approverA, 'approve', ids.approvalA);
      await tx.setContext(founderA);
      expect(await tx.count('passkeys')).toBe(1);
      expect(await tx.count('step_ups', 'user_id <> $1', [ids.founder])).toBe(0);
      await tx.setContext(approverA);
      expect(await tx.count('passkeys')).toBe(1);
      expect(await tx.count('step_ups')).toBe(1);
      await tx.setContext({ companyId: ids.pillika, userId: ids.approverA });
      expect(await tx.count('step_ups')).toBe(0);
    });
    await inWorkerTransaction(async (tx) => {
      for (const context of [korA, founderA]) {
        await tx.setContext(context);
        for (const table of ['passkeys', 'passkey_challenges', 'step_ups']) {
          expect(await errorCode(tx, `select 1 from office.${table}`), table).toBe(DENIED);
        }
      }
    });
  });
});
