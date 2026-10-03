import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
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
// decision 7). inTransaction runs with the API's privileges (office_app and office_api_private),
// inWorkerTransaction with the worker's (office_app only). The database never checks a WebAuthn
// signature; the API does, and calls these functions with what it verified.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
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
  'office.approval_importance(uuid, boolean, text, text, uuid)',
  'office.approval_is_important(uuid, boolean, text, text, uuid)',
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
  'office.guard_passkey()',
  'office.guard_passkey_challenge()',
  'office.keep_step_up_used()',
  'office.keep_webauthn_handle()',
];

const MEMBERSHIP = 'where company_id = $1 and user_id = $2';
const APPROVE = `update office.approvals set status = 'approved' where id = $1`;

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

    await inWorkerTransaction(async (tx) => {
      for (const context of [korA, founderA, {}]) {
        await tx.setContext(context);
        for (const fn of API_FUNCTIONS) {
          expect(await errorCode(tx, nullCall(fn)), fn).toBe(DENIED);
        }
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
      expect(await attempt('login', null, null)).toBe(INVALID);
      // Only for the context company, and only where the person is a member.
      expect(await attempt('approve', ids.pillika, ids.approvalP)).toBe(DENIED);
      expect(await attempt('invitation', ids.pillika, ids.invitationP)).toBe(DENIED);
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

  it('an approval that involves money, has an external effect or changes a source of truth note is important', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const rule = 'select office.approval_importance($1, $2, $3, $4, $5) as important';
      const cases: [unknown[], boolean][] = [
        [[ids.arma, false, null, null, null], false],
        [[ids.arma, true, null, null, null], true],
        [[ids.arma, false, TOOL.externalEffect, null, null], true],
        [[ids.arma, false, TOOL.read, null, null], false],
        [[ids.arma, false, null, 'note', ids.noteASourceOfTruth], true],
        [[ids.arma, false, null, 'note', ids.noteA], false],
        [[ids.arma, false, null, 'task', ids.taskA], false],
        // A tool that changes a note: important when its note is a source of truth, and when the
        // approval names no note (the target is unknown).
        [[ids.arma, false, TOOL.internalWrite, 'note', ids.noteA], false],
        [[ids.arma, false, TOOL.internalWrite, 'note', ids.noteASourceOfTruth], true],
        [[ids.arma, false, TOOL.internalWrite, null, null], true],
        [[ids.arma, false, TOOL.internalWrite, 'task', ids.taskA], true],
        [[ids.arma, false, 'link_notes', null, null], true],
        [[ids.arma, false, 'import_document', null, null], true],
        // The note must belong to the approval's company.
        [[ids.pillika, false, null, 'note', ids.noteASourceOfTruth], false],
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
          await errorCode(tx, 'select office.approval_is_important($1, false, null, $2, $3)', [
            ids.arma,
            'note',
            ids.noteASourceOfTruth,
          ]),
          JSON.stringify(context),
        ).toBe(DENIED);
      }
      // The rule itself runs with the caller's rights: a note the caller cannot read is never a
      // source of truth to them.
      const rule = `select office.approval_importance($1, false, null, 'note', $2) as important`;
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

  it('an approval is opened only with the money decision made', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(korA);
      expect(
        await errorCode(
          tx,
          `insert into office.approvals (company_id, run_id, agent_code, title, payload)
           values ($1, $2, 'KOR-1', 'Teklif', '{"price": 480000}')`,
          [ids.arma, ids.runA],
        ),
      ).toBe('23502');
      const [row] = await tx.rows<{ involves_money: boolean }>(
        `insert into office.approvals (company_id, run_id, agent_code, title, payload,
           involves_money)
         values ($1, $2, 'KOR-1', 'Teklif', '{"price": 480000}', true)
         returning involves_money`,
        [ids.arma, ids.runA],
      );
      expect(row).toEqual({ involves_money: true });
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
