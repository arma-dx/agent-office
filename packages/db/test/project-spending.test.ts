import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { FOUNDER_PASSKEY, ids } from './fixtures.ts';
import {
  adminQuery,
  asRole,
  auditMark,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  openTransaction,
  removeRequests,
  untilBlocked,
  type Tx,
} from './helpers.ts';
import { createChallenge, openTestSession, stepUp } from './step-up.ts';

// The AI spending limit of a project (8 October decision 17; docs/SONRA.md P3-m to P3-z). A
// project can carry a limit in US dollars; what counts is the recorded cost of every run of the
// project; it is reached when that sum is equal to or above it. Only the founder sets it, through
// the database's own function; raising it and taking it away ask for a passkey. No run row is
// written in a project at its limit, and no opening starts work there (decision 49 is not
// widened for any other opening). Raising the limit or taking it away starts the held work again
// (11 October decision 1): the limit route asks the database for that restart, and a limit
// changed without the panel starts nothing.
//
// Every rule here is the database's own. The cases that compare moments or need two connections
// commit their steps; they remove their requests again and put the limit, the recorded cost of
// the fixtures' own run in project A and the switches back.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
// A plain member of projectA.
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
// An employee of Arma DX who is a member of no project (and holds the approval right).
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };

const P = ids.projectA;

/** The context of a run on a request of the employee. */
function agentRun(agentCode: string, projectId: string | null = null): ContextInput {
  return { companyId: ids.arma, userId: ids.employeeA, agentCode, projectId };
}

const SET = 'select office.set_project_ai_spending_limit($1, $2::numeric) as changed';
const REACHED = 'select office.project_spending_limit_reached($1) as reached';
const OPEN = `insert into office.tasks (company_id, project_id, kind, title, description)
  values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted') returning id`;
// The run names no project: its project comes from the context (office.check_run_start).
const RUN = `insert into office.runs
    (company_id, task_id, agent_code, card_version_id, trigger_type, model)
  values (office.ctx_company_id(), $1, $2, $3, 'request', 'test-model') returning id`;
const RULE = 'Only the founder changes the AI spending limit of a project';
const AT_THE_LIMIT = 'No run is opened in a project whose AI spending limit is reached';

async function setLimit(tx: Tx, limit: string | null, project: string = P): Promise<boolean> {
  const [row] = await tx.rows<{ changed: boolean }>(SET, [project, limit]);
  if (!row) {
    throw new Error('set_project_ai_spending_limit returned no row');
  }
  return row.changed;
}

/** The limit as it is committed, read by the privileged role. */
async function limitOf(project: string = P): Promise<string | null> {
  const [row] = await adminQuery<{ limit_usd: string | null }>(
    'select ai_spend_limit_usd::text as limit_usd from office.projects where id = $1',
    [project],
  );
  return row?.limit_usd ?? null;
}

/** The limit inside the open transaction, read by the privileged role it runs as. */
async function limitIn(tx: Tx, project: string = P): Promise<string | null> {
  const [row] = await tx.rows<{ limit_usd: string | null }>(
    'select ai_spend_limit_usd::text as limit_usd from office.projects where id = $1',
    [project],
  );
  return row?.limit_usd ?? null;
}

async function reached(tx: Tx, project: string | null = P): Promise<boolean | null> {
  const [row] = await tx.rows<{ reached: boolean | null }>(REACHED, [project]);
  if (!row) {
    throw new Error('project_spending_limit_reached returned no row');
  }
  return row.reached;
}

async function used(tx: Tx, stepUpId: string): Promise<boolean | undefined> {
  const [row] = await tx.rows<{ used: boolean }>(
    'select consumed_at is not null as used from office.step_ups where id = $1',
    [stepUpId],
  );
  return row?.used;
}

async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'app');
  await tx.setContext(context);
}

async function asWorker(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'worker');
  await tx.setContext(context);
}

/** The privileged role without a person in the context, as an administrator writes. */
async function asAdministrator(tx: Tx): Promise<void> {
  await asRole(tx, null);
  await tx.setContext({});
}

/** An administrator writes the limit and what the fixtures' own run of project A has cost. */
async function projectAt(tx: Tx, limit: string | null, spent: string): Promise<void> {
  await asAdministrator(tx);
  await tx.exec('update office.runs set cost_usd = $2::numeric where id = $1', [
    ids.runAProject,
    spent,
  ]);
  await tx.exec('update office.projects set ai_spend_limit_usd = $2::numeric where id = $1', [
    P,
    limit,
  ]);
}

describe.skipIf(noDatabase)('who sets the AI spending limit of a project', () => {
  afterAll(closePools);

  it('limit: only the founder sets it, only through the function, only through the API', async () => {
    await inTransaction(async (tx) => {
      // A member, an employee who is none, an external person, nobody.
      for (const context of [employeeA, approverA, externalA, {}, { companyId: ids.arma }]) {
        await tx.setContext(context);
        const refused = await tx.expectError(SET, [P, '5']);
        expect(refused.code, JSON.stringify(context)).toBe('42501');
        expect(refused.message).toBe(RULE);
      }
      // An agent run in the founder's name, with and without the project in its context.
      for (const context of [
        { ...founderA, agentCode: 'KOR-1' },
        { ...founderA, agentCode: 'KOR-1', projectId: P },
      ]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET, [P, '5'])).code).toBe('42501');
      }
      // The founder of the other company: for that context there is no such project.
      for (const context of [founderP, { ...founderP, projectId: P }]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET, [P, '5'])).code).toBe('P0002');
      }
      await tx.setContext(founderA);
      expect((await tx.expectError(SET, [randomUUID(), '5'])).code).toBe('P0002');
      expect((await tx.expectError(SET, [ids.projectP, '5'])).code).toBe('P0002');
      // The column is in no application role's grant: not by a statement, for the founder either.
      for (const sql of [
        'update office.projects set ai_spend_limit_usd = 5 where id = $1',
        'update office.projects set ai_spend_limit_usd = null where id = $1',
        `update office.projects set name = 'Renamed', ai_spend_limit_usd = 5 where id = $1`,
      ]) {
        expect((await tx.expectError(sql, [P])).code, sql).toBe('42501');
      }
      expect(
        (
          await tx.expectError(
            `insert into office.projects (company_id, name, ai_spend_limit_usd)
             values ($1, 'With a limit', 5)`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
      // The founder, through the function.
      expect(await setLimit(tx, '5')).toBe(true);
      // A project the founder is no member of, and one whose AI permission is closed.
      expect(await setLimit(tx, '7.5', ids.projectANoAi)).toBe(true);
    });
    // The worker's role holds neither the function nor the column, in anybody's name.
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1', projectId: P }]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET, [P, '5'])).code).toBe('42501');
        expect(
          (
            await tx.expectError(
              'update office.projects set ai_spend_limit_usd = 5 where id = $1',
              [P],
            )
          ).code,
        ).toBe('42501');
      }
    });
    expect(await limitOf()).toBeNull();
    // The privileged role with a person in the context is held to the same rule; without one it
    // writes as an administrator does.
    await inAdminTransaction(async (tx) => {
      const direct = 'update office.projects set ai_spend_limit_usd = $2::numeric where id = $1';
      for (const context of [
        employeeA,
        founderP,
        { ...founderA, agentCode: 'KOR-1', projectId: P },
      ]) {
        await tx.setContext(context);
        const refused = await tx.expectError(direct, [P, '5']);
        expect(refused.code, JSON.stringify(context)).toBe('42501');
        expect(refused.message).toBe(RULE);
      }
      await tx.setContext(founderA);
      expect(await tx.exec(direct, [P, '5'])).toBe(1);
      // A raise by the privileged role in the founder's name needs the passkey too.
      expect((await tx.expectError(direct, [P, '6'])).code).toBe('28000');
      expect((await tx.expectError(direct, [P, null])).code).toBe('28000');
      await tx.setContext({});
      expect(await tx.exec(direct, [P, '6'])).toBe(1);
      expect(await tx.exec(direct, [P, null])).toBe(1);
    });
  });

  it('limit: a first limit and a lower one need no passkey; a raise and a removal need one for exactly this project and purpose, and use it up', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      // A first limit, the same value again, and a lower one: nothing is asked for.
      expect(await setLimit(tx, '5.00')).toBe(true);
      expect(await setLimit(tx, '5')).toBe(false);
      expect(await setLimit(tx, '2.00')).toBe(true);
      expect(await limitIn(tx)).toBe('2.00');
      // A raise and a removal without a passkey.
      for (const next of ['10.00', '2.01', null]) {
        const refused = await tx.expectError(SET, [P, next]);
        expect(refused.code, String(next)).toBe('28000');
        expect(refused.message).toBe(
          'Raising or removing the AI spending limit of a project needs a passkey re-verification',
        );
      }
      // A passkey for something else opens nothing: the AI permission of this project, the limit
      // of another project, a membership change that names the same id.
      const wrong = [
        await stepUp(tx, founderA, 'project_ai_permission', P),
        await stepUp(tx, founderA, 'project_ai_spending_limit', ids.projectANoAi),
        await stepUp(tx, founderA, 'membership_change', P),
      ];
      // The same project id, confirmed in the other company.
      const elsewhere = await stepUp(tx, founderP, 'project_ai_spending_limit', P);
      await tx.setContext(founderA);
      expect((await tx.expectError(SET, [P, '10.00'])).code).toBe('28000');
      expect((await tx.expectError(SET, [P, null])).code).toBe('28000');
      expect(await limitIn(tx)).toBe('2.00');

      // With its own re-verification the raise is stored, and the re-verification is used up.
      const right = await stepUp(tx, founderA, 'project_ai_spending_limit', P);
      expect(await setLimit(tx, '10.00')).toBe(true);
      expect(await limitIn(tx)).toBe('10.00');
      expect(await used(tx, right)).toBe(true);
      for (const id of wrong) {
        expect(await used(tx, id)).toBe(false);
      }
      await tx.setContext(founderP);
      expect(await used(tx, elsewhere)).toBe(false);
      await tx.setContext(founderA);
      // Used once: the next raise needs a new one.
      expect((await tx.expectError(SET, [P, '20.00'])).code).toBe('28000');
      expect(await limitIn(tx)).toBe('10.00');

      // What only stops agents earlier uses nothing up: a lower limit, and the same value.
      const kept = await stepUp(tx, founderA, 'project_ai_spending_limit', P);
      expect(await setLimit(tx, '9.99')).toBe(true);
      expect(await setLimit(tx, '9.99')).toBe(false);
      expect(await used(tx, kept)).toBe(false);
      // The removal takes it.
      expect(await setLimit(tx, null)).toBe(true);
      expect(await limitIn(tx)).toBeNull();
      expect(await used(tx, kept)).toBe(true);
      // No limit to remove: nothing changes; and a first limit again needs no passkey.
      expect(await setLimit(tx, null)).toBe(false);
      expect(await setLimit(tx, '0.01')).toBe(true);
      expect(await limitIn(tx)).toBe('0.01');
    });
  });

  it('limit: zero, a negative number, three decimals and a million are refused', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const limit of [
        '0',
        '0.00',
        '-1',
        '1.234',
        '0.001',
        '1000000',
        '999999.991',
        // numeric takes all three; no sum is ever at or above the first.
        'NaN',
        'Infinity',
        '-Infinity',
      ]) {
        const refused = await tx.expectError(SET, [P, limit]);
        expect(refused.code, limit).toBe('22023');
        expect(refused.message).toBe(
          'A limit is above zero, at most 999999.99 and has at most two decimals',
        );
      }
      expect((await tx.expectError(SET, [null, '5'])).code).toBe('22023');
      // The two ends of the range.
      expect(await setLimit(tx, '0.01')).toBe(true);
      expect(await setLimit(tx, '999999.99', ids.projectANoAi)).toBe(true);
    });
    // The column's own check, for an administrator who writes it by hand.
    await inAdminTransaction(async (tx) => {
      await tx.setContext({});
      const direct = 'update office.projects set ai_spend_limit_usd = $2::numeric where id = $1';
      for (const limit of ['NaN', '0', '-1']) {
        expect((await tx.expectError(direct, [P, limit])).code, limit).toBe('23514');
      }
      // More than the column holds.
      expect((await tx.expectError(direct, [P, '1000000'])).code).toBe('22003');
      expect(await tx.exec(direct, [P, '999999.99'])).toBe(1);
    });
  });

  it('limit: the trace says set, lowered, raised, removed, and no request can write such an event', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      const [from] = await tx.rows<{ id: string }>(
        'select coalesce(max(id), 0)::text as id from office.audit_log',
      );
      await setLimit(tx, '5.00');
      await setLimit(tx, '5.00');
      await setLimit(tx, '2.50');
      await stepUp(tx, founderA, 'project_ai_spending_limit', P);
      await setLimit(tx, '7.25');
      await stepUp(tx, founderA, 'project_ai_spending_limit', P);
      await setLimit(tx, null);
      const rows = await tx.rows<{ event: string; row: string }>(
        // Without the row's own id and time: their digits can spell an amount by chance.
        `select event, (to_jsonb(a) - 'id' - 'created_at')::text as row from office.audit_log a
         where id > $1 and event ~ '^project_' order by id`,
        [from?.id],
      );
      expect(rows.map((row) => row.event)).toEqual([
        'project_ai_spending_limit_set',
        'project_ai_spending_limit_lowered',
        'project_ai_spending_limit_raised',
        'project_ai_spending_limit_removed',
      ]);
      expect(
        await tx.rows(
          `select distinct user_id, agent_code, record_type, record_id, project_id, run_id
           from office.audit_log where id > $1 and event ~ '^project_ai_spending_limit_'`,
          [from?.id],
        ),
      ).toEqual([
        {
          user_id: ids.founder,
          agent_code: null,
          record_type: 'project',
          record_id: P,
          project_id: P,
          run_id: null,
        },
      ]);
      // An event name and ids, never an amount.
      for (const { row } of rows) {
        for (const amount of ['5.00', '2.50', '7.25']) {
          expect(row).not.toContain(amount);
        }
      }
      // No request of the API writes that a limit was changed, in the founder's name either.
      const byHand = `insert into office.audit_log (company_id, project_id, event, record_type,
          record_id)
        values ($1, $2, $3, 'project', $2)`;
      for (const event of [
        'project_ai_spending_limit_set',
        'project_ai_spending_limit_raised',
        'project_ai_spending_limit_lowered',
        'project_ai_spending_limit_removed',
        'project_ai_spending_limit_anything',
      ]) {
        expect((await tx.expectError(byHand, [ids.arma, P, event])).code, event).toBe('42501');
      }
      // ... and no agent run does.
      await asWorker(tx, agentRun('KOR-1', P));
      expect(
        (await tx.expectError(byHand, [ids.arma, P, 'project_ai_spending_limit_raised'])).code,
      ).toBe('42501');
      // A project an administrator writes with a limit says so when it is opened.
      await asAdministrator(tx);
      const seeded = randomUUID();
      await tx.exec(
        `insert into office.projects (id, company_id, name, ai_spend_limit_usd)
         values ($1, $2, 'Seeded', 3)`,
        [seeded, ids.arma],
      );
      expect(
        await tx.rows(
          `select event, user_id from office.audit_log where record_id = $1 order by id`,
          [seeded],
        ),
      ).toEqual([
        { event: 'project_created', user_id: null },
        { event: 'project_ai_spending_limit_set', user_id: null },
      ]);
      // A change that leaves the limit alone writes no limit event and no catch-all.
      await asPerson(tx, founderA);
      const [again] = await tx.rows<{ id: string }>(
        'select coalesce(max(id), 0)::text as id from office.audit_log',
      );
      await tx.exec(`update office.projects set name = 'Renamed' where id = $1`, [P]);
      expect(
        await tx.rows('select event from office.audit_log where id > $1 order by id', [again?.id]),
      ).toEqual([{ event: 'project_name_changed' }]);
    });
  });

  it('re-verification: the purpose of a limit change names a company and the project', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const record = async (company: string | null, subject: string | null) => {
        const hash = Buffer.alloc(32, 7);
        const challenge = await createChallenge(tx, session, 'step_up', hash);
        return [
          session.key,
          challenge,
          FOUNDER_PASSKEY,
          0,
          'project_ai_spending_limit',
          company,
          subject,
          hash,
        ];
      };
      const RECORD = 'select office.record_step_up($1, $2, $3, $4, $5, $6, $7, $8) as id';
      expect((await tx.expectError(RECORD, await record(null, P))).code).toBe('22023');
      expect((await tx.expectError(RECORD, await record(ids.arma, null))).code).toBe('22023');
      // Only in the context of that company.
      expect((await tx.expectError(RECORD, await record(ids.pillika, P))).code).toBe('42501');
      const [row] = await tx.rows<{ id: string }>(RECORD, await record(ids.arma, P));
      expect(
        await tx.rows(
          'select purpose, company_id, subject_id, consumed_at from office.step_ups where id = $1',
          [row?.id],
        ),
      ).toEqual([
        {
          purpose: 'project_ai_spending_limit',
          company_id: ids.arma,
          subject_id: P,
          consumed_at: null,
        },
      ]);
    });
    // The table's own checks, for a row an administrator writes: the purpose is known, and it
    // comes with a company.
    await inAdminTransaction(async (tx) => {
      await tx.setContext({});
      const insert = (purpose: string, company: string | null) =>
        tx.expectError(
          `insert into office.step_ups (user_id, session_id, passkey_id, purpose, company_id,
             subject_id, context_hash)
           values ($1, $2, $3, $4, $5, $6, decode(repeat('ab', 32), 'hex'))`,
          [ids.founder, ids.founderSession, FOUNDER_PASSKEY, purpose, company, P],
        );
      expect((await insert('project_ai_spending_limit', null)).code).toBe('23514');
      expect((await insert('project_spending_limit', ids.arma)).code).toBe('23514');
    });
  });

  it('a re-verification of an earlier transaction opens nothing, and nobody uses one up by hand', async () => {
    await inAdminTransaction(async (tx) => {
      await tx.setContext({});
      await tx.exec('update office.projects set ai_spend_limit_usd = 5 where id = $1', [P]);
      const record = (verifiedAgo: string, xact: string | null) =>
        tx.exec(
          `insert into office.step_ups (user_id, session_id, passkey_id, purpose, company_id,
             subject_id, context_hash, verified_at, verified_xact)
           values ($1, $2, $3, 'project_ai_spending_limit', $4, $5, decode(repeat('ab', 32), 'hex'),
             now() - $6::interval, coalesce($7::xid8, pg_current_xact_id()))`,
          [ids.founder, ids.founderSession, FOUNDER_PASSKEY, ids.arma, P, verifiedAgo, xact],
        );
      await tx.setContext(founderA);
      // Recorded a minute ago, and recorded by another transaction: neither opens anything.
      await record('1 minute', null);
      expect((await tx.expectError(SET, [P, '10'])).code).toBe('28000');
      await record('0', '1');
      expect((await tx.expectError(SET, [P, '10'])).code).toBe('28000');
      expect((await tx.expectError(SET, [P, null])).code).toBe('28000');
      expect(await limitIn(tx)).toBe('5.00');
      // Recorded in this transaction: it does.
      await record('0', null);
      expect(await setLimit(tx, '10')).toBe(true);
    });
    // Only the check of the change itself uses a re-verification up.
    const byHand = `select office.consume_step_up('project_ai_spending_limit', $1, $2)`;
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await stepUp(tx, founderA, 'project_ai_spending_limit', P);
      expect((await tx.expectError(byHand, [ids.arma, P])).code).toBe('42501');
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext({ ...founderA, agentCode: 'KOR-1', projectId: P });
      expect((await tx.expectError(byHand, [ids.arma, P])).code).toBe('42501');
    });
  });
});

describe.skipIf(noDatabase)('when the AI spending limit of a project is reached', () => {
  afterAll(closePools);

  it('reached: at or above the limit, for the founder, a member and an agent run; no value for a non-member, an external person and the other company', async () => {
    await inAdminTransaction(async (tx) => {
      const answered: [ContextInput, 'app' | 'worker'][] = [
        [founderA, 'app'],
        [employeeA, 'app'],
        // The runner asks in the run's context; before the gate named a person it has none.
        [agentRun('KOR-1', P), 'worker'],
        [agentRun('KOR-1'), 'worker'],
        [{ companyId: ids.arma, agentCode: 'KOR-1' }, 'worker'],
        // The API's role in an agent context is answered like the worker's.
        [agentRun('HAF-1', P), 'app'],
      ];
      const unanswered: [ContextInput, 'app' | 'worker'][] = [
        [approverA, 'app'],
        [{ companyId: ids.arma, userId: ids.sharedEmployee }, 'app'],
        [externalA, 'app'],
        [founderP, 'app'],
        [employeeP, 'app'],
        [{ ...founderP, projectId: P }, 'app'],
        // An agent run of the other company, with this project named in its context.
        [
          { companyId: ids.pillika, userId: ids.founder, agentCode: 'KOR-1', projectId: P },
          'worker',
        ],
        // Rule 9: nothing without a context.
        [{}, 'app'],
        [{ companyId: ids.arma }, 'app'],
        [{ userId: ids.founder }, 'app'],
        [{ projectId: P }, 'worker'],
      ];
      // The project's runs have cost 1.25 so far.
      const cases: [string | null, boolean][] = [
        [null, false],
        ['1.26', false],
        ['1.25', true],
        ['0.50', true],
      ];
      for (const [limit, expected] of cases) {
        await projectAt(tx, limit, '1.25');
        for (const [context, role] of answered) {
          await asRole(tx, role);
          await tx.setContext(context);
          expect(await reached(tx), `${String(limit)} ${JSON.stringify(context)}`).toBe(expected);
        }
        for (const [context, role] of unanswered) {
          await asRole(tx, role);
          await tx.setContext(context);
          expect(await reached(tx), `${String(limit)} ${JSON.stringify(context)}`).toBeNull();
        }
      }
      // A yes or a no, never an amount: nobody but the functions themselves reads the sum.
      for (const [context, role] of answered) {
        await asRole(tx, role);
        await tx.setContext(context);
        expect(
          (await tx.expectError('select office.project_ai_spending($1)', [P])).code,
          JSON.stringify(context),
        ).toBe('42501');
      }
      // No project: no value. Another project of the company without a limit: no.
      await asPerson(tx, founderA);
      expect(await reached(tx, null)).toBeNull();
      expect(await reached(tx, randomUUID())).toBeNull();
      expect(await reached(tx, ids.projectP)).toBeNull();
      expect(await reached(tx, ids.projectANoAi)).toBe(false);
    });
  });

  it('reached: every run of the project counts, whatever its status; a run without a project and a run of another project do not', async () => {
    await inAdminTransaction(async (tx) => {
      // A second project of Arma DX where agents may work, with the employee as a member.
      await asAdministrator(tx);
      const other = randomUUID();
      await tx.exec(
        `insert into office.projects (id, company_id, name, ai_allowed) values ($1, $2, 'Other', true)`,
        [other, ids.arma],
      );
      await tx.exec(
        'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)',
        [ids.arma, other, ids.employeeA],
      );
      /** A run of KOR-1 on a new request of the employee, with that cost and that end. */
      const runWith = async (project: string | null, cost: string, status: string | null) => {
        await asPerson(tx, employeeA);
        const [task] = await tx.rows<{ id: string }>(OPEN, [project]);
        await asWorker(tx, agentRun('KOR-1', project));
        const [run] = await tx.rows<{ id: string }>(RUN, [task?.id, 'KOR-1', ids.cardKor]);
        await tx.exec('update office.runs set cost_usd = $2::numeric where id = $1', [
          run?.id,
          cost,
        ]);
        if (status !== null) {
          await tx.exec(
            `update office.runs set status = $2, finished_at = now(),
               error_code = case when $2 = 'completed' then null else 'some_code' end
             where id = $1`,
            [run?.id, status],
          );
        }
        return run?.id ?? '';
      };
      // In the project: one run of every status, 0.75 in all (the fixtures' own run cost nothing).
      await runWith(P, '0.30', 'completed');
      await runWith(P, '0.20', 'failed');
      await runWith(P, '0.10', 'stopped');
      await runWith(P, '0.05', 'limit_reached');
      const open = await runWith(P, '0.10', null);
      // Not in the project: far above any limit tried below.
      await runWith(null, '50', 'completed');
      await runWith(other, '70', 'completed');

      const reachedAt = async (limit: string): Promise<boolean | null> => {
        await asAdministrator(tx);
        await tx.exec('update office.projects set ai_spend_limit_usd = $2::numeric where id = $1', [
          P,
          limit,
        ]);
        await asPerson(tx, founderA);
        return reached(tx);
      };
      expect(await reachedAt('0.76')).toBe(false);
      expect(await reachedAt('0.75')).toBe(true);
      expect(await reachedAt('0.74')).toBe(true);
      // The open run pays for one more call: the sum moves with it.
      expect(await reachedAt('0.80')).toBe(false);
      await asWorker(tx, agentRun('KOR-1', P));
      await tx.exec('update office.runs set cost_usd = cost_usd + 0.05 where id = $1', [open]);
      await asPerson(tx, founderA);
      expect(await reached(tx)).toBe(true);
      // The other project has no limit, whatever it spent; with one it answers for itself.
      expect(await reached(tx, other)).toBe(false);
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_spend_limit_usd = 70 where id = $1', [other]);
      await asPerson(tx, founderA);
      expect(await reached(tx, other)).toBe(true);
    });
  });

  it('a run row is not opened in a project at its limit, by any writer', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, employeeA);
      const [inside] = await tx.rows<{ id: string }>(OPEN, [P]);
      const [outside] = await tx.rows<{ id: string }>(OPEN, [null]);
      const openRun = [inside?.id, 'KOR-1', ids.cardKor];
      const runsInside = () => tx.count('runs', 'task_id = $1', [inside?.id]);

      // Under the limit a run is opened.
      await projectAt(tx, '1.26', '1.25');
      await asWorker(tx, agentRun('KOR-1', P));
      expect(await tx.rows(RUN, openRun)).toHaveLength(1);
      // At the limit, and above it: refused, for the worker's role in the run's own context.
      // The statement names no project: the run's project is the context's.
      for (const limit of ['1.25', '0.50']) {
        await projectAt(tx, limit, '1.25');
        await asWorker(tx, agentRun('KOR-1', P));
        const refused = await tx.expectError(RUN, openRun);
        expect(refused.code, limit).toBe('54000');
        expect(refused.message).toBe(AT_THE_LIMIT);
        // The API's role in an agent context, and the privileged role, are refused the same way.
        await asRole(tx, 'app');
        expect((await tx.expectError(RUN, openRun)).code).toBe('54000');
        await asRole(tx, null);
        expect((await tx.expectError(RUN, openRun)).code).toBe('54000');
      }
      await asRole(tx, null);
      expect(await runsInside()).toBe(1);
      // A request without a project is not held by another project's limit.
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.rows(RUN, [outside?.id, 'KOR-1', ids.cardKor])).toHaveLength(1);
      // A run that is open is not closed by the limit: the runner ends it before its next call.
      await asRole(tx, null);
      expect(
        await tx.rows('select status from office.runs where task_id = $1', [inside?.id]),
      ).toEqual([{ status: 'running' }]);
      // No limit again: a run is opened.
      await projectAt(tx, null, '1.25');
      await asWorker(tx, agentRun('KOR-1', P));
      expect(await tx.rows(RUN, openRun)).toHaveLength(1);
    });
  });
});

// The cases below commit their steps.
describe.skipIf(noDatabase)('the AI spending limit across transactions', () => {
  const tasks: string[] = [];
  let mark = '0';

  type Agent = 'KOR-1' | 'HAF-1';
  const HAF_STEP = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Belongs to memory' }]);
  const TRACE = `insert into office.audit_log (company_id, project_id, event, record_type, record_id)
    values (office.ctx_company_id(), office.ctx_project_id(), 'run_refused', 'task', $1)`;
  const SWITCH = `update office.company_agents set status = $2
    where company_id = office.ctx_company_id() and agent_code = $1`;
  const RESTART = `select task_id from office.restart_waiting_work($1, $2, null) order by task_id`;
  const COUNT = 'select office.count_waiting_work($1, $2, null) as waiting';

  beforeAll(async () => {
    mark = await auditMark();
  });

  afterEach(async () => {
    // The limit, the recorded cost of the fixtures' own run and the switches as the fixtures
    // have them; then the requests of the case with everything written for them.
    await adminQuery('update office.projects set ai_spend_limit_usd = null where id = $1', [P]);
    await adminQuery('update office.runs set cost_usd = 0 where id = $1', [ids.runAProject]);
    await adminQuery(
      `update office.company_agents set status = case agent_code when 'HAF-1' then 'stopped'
         else 'enabled' end
       where company_id = $1 and agent_code in ('KOR-1', 'HAF-1')`,
      [ids.arma],
    );
    await removeRequests(tasks, mark);
    tasks.length = 0;
  });

  afterAll(closePools);

  /** One committed transaction of a restricted role. */
  async function committed<T>(
    role: 'app' | 'worker',
    context: ContextInput,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const open = await openTransaction(role, context);
    try {
      const result = await work(open.tx);
      await open.commit();
      return result;
    } finally {
      await open.rollback();
    }
  }

  /** An administrator writes the limit, as the seed would (a person's raise asks for a passkey). */
  const limitByHand = (limit: string | null) =>
    adminQuery('update office.projects set ai_spend_limit_usd = $2::numeric where id = $1', [
      P,
      limit,
    ]);
  /** What the fixtures' own run of project A has cost. */
  const spentByHand = (cost: string) =>
    adminQuery('update office.runs set cost_usd = $2::numeric where id = $1', [
      ids.runAProject,
      cost,
    ]);

  const setSwitch = (agent: Agent, status: 'enabled' | 'stopped'): Promise<number> =>
    committed('app', founderA, (tx) => tx.exec(SWITCH, [agent, status]));

  /** A request of the employee, in a project or without one. */
  async function open(project: string | null): Promise<string> {
    const id = await committed('app', employeeA, async (tx) => {
      const [row] = await tx.rows<{ id: string }>(OPEN, [project]);
      return row?.id ?? '';
    });
    tasks.push(id);
    return id;
  }

  /** A request the coordinator routed to HAF-1 from its own run. */
  async function routed(project: string | null): Promise<string> {
    const task = await open(project);
    await committed('worker', agentRun('KOR-1', project), async (tx) => {
      const [run] = await tx.rows<{ id: string }>(RUN, [task, 'KOR-1', ids.cardKor]);
      await tx.rows('select office.route_request($1, $2::jsonb, $3)', [task, HAF_STEP, run?.id]);
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [run?.id],
      );
    });
    return task;
  }

  /** The runner refused the job of HAF-1 and left its trace. */
  const refused = (task: string, project: string | null): Promise<number> =>
    committed('worker', agentRun('HAF-1', project), (tx) => tx.exec(TRACE, [task]));

  const restart = (agent: Agent | null, project: string | null): Promise<string[]> =>
    committed('app', founderA, async (tx) =>
      (await tx.rows<{ task_id: string }>(RESTART, [agent, project])).map((row) => row.task_id),
    );

  const waiting = (agent: Agent | null, project: string | null): Promise<number> =>
    committed('app', founderA, async (tx) => {
      const [row] = await tx.rows<{ waiting: number }>(COUNT, [agent, project]);
      return row?.waiting ?? -1;
    });

  /** How many requests of the project a new limit (null: none) would start, as the founder asks. */
  const held = (
    limit: string | null,
    as: ContextInput = founderA,
    project: string = P,
  ): Promise<number> =>
    committed('app', as, async (tx) => {
      const [row] = await tx.rows<{ waiting: number }>(
        'select office.count_work_held_by_spending_limit($1, $2::numeric) as waiting',
        [project, limit],
      );
      return row?.waiting ?? -1;
    });

  const restartTraces = (task: string) =>
    adminQuery(
      `select 1 from office.audit_log
       where record_type = 'task' and record_id = $1 and event = 'run_restarted'`,
      [task],
    );

  /**
   * Two requests routed to HAF-1, one inside project A and one without a project, both refused
   * while HAF-1 was stopped; then project A reaches its limit.
   */
  async function heldByTheLimit(): Promise<{ inside: string; outside: string }> {
    await setSwitch('HAF-1', 'enabled');
    const inside = await routed(P);
    const outside = await routed(null);
    await setSwitch('HAF-1', 'stopped');
    await refused(inside, P);
    await refused(outside, null);
    await spentByHand('1.25');
    await limitByHand('0.50');
    return { inside, outside };
  }

  it('waiting work: an opening starts nothing in a project at its limit, and counts nothing there', async () => {
    const { inside, outside } = await heldByTheLimit();
    // The confirmation of the opening counts what the opening will start: one, not two.
    expect(await waiting('HAF-1', null)).toBe(1);
    await setSwitch('HAF-1', 'enabled');
    expect(await restart('HAF-1', null)).toEqual([outside]);
    // The project's request is not started, and while the limit holds no opening counts it or
    // starts it: not the agent's, not the project's own AI permission.
    expect(await waiting('HAF-1', null)).toBe(0);
    expect(await waiting(null, P)).toBe(0);
    await setSwitch('HAF-1', 'stopped');
    await setSwitch('HAF-1', 'enabled');
    expect(await restart('HAF-1', null)).toEqual([]);
    expect(await restart(null, P)).toEqual([]);
    expect(await restartTraces(inside)).toEqual([]);
    expect(await restartTraces(outside)).toHaveLength(1);
    // Exactly at the limit holds too.
    await limitByHand('1.25');
    expect(await waiting('HAF-1', null)).toBe(0);
    expect(await restart('HAF-1', null)).toEqual([]);
  });

  it('waiting work: a limit raised by hand starts nothing by itself; the restart the limit route asks for starts what the limit held, and the count says so beforehand', async () => {
    const { inside, outside } = await heldByTheLimit();
    // HAF-1 is still stopped: a raise would start nothing of it, and the count says so.
    expect(await held('500.00')).toBe(0);
    await setSwitch('HAF-1', 'enabled');
    expect(await restart('HAF-1', null)).toEqual([outside]);
    // What the confirmation of a raise is told, before anything changes: the project has spent
    // 1.25, so a new limit at or under that starts nothing, and one above it (or none) starts
    // the one request the limit holds.
    expect(await held('1.25')).toBe(0);
    expect(await held('0.75')).toBe(0);
    expect(await held('1.26')).toBe(1);
    expect(await held('500.00')).toBe(1);
    expect(await held(null)).toBe(1);
    // The count reads only: nothing was started by asking.
    expect(await restartTraces(inside)).toEqual([]);
    expect(await limitOf()).toBe('0.50');

    // The limit is raised without the panel (an administrator): the change itself calls nothing.
    await limitByHand('500.00');
    expect(await restartTraces(inside)).toEqual([]);
    expect(
      await adminQuery('select status from office.runs where task_id = $1 and agent_code = $2', [
        inside,
        'HAF-1',
      ]),
    ).toEqual([]);
    // The restart the limit route asks for after a raise (11 October decision 1): the project's
    // waiting work, once.
    expect(await restart(null, P)).toEqual([inside]);
    expect(await restartTraces(inside)).toHaveLength(1);
    expect(await restart(null, P)).toEqual([]);
    expect(await waiting('HAF-1', null)).toBe(0);
    expect(await held(null)).toBe(0);
  });

  it('waiting work: a run the limit stopped starts again when the limit is raised; a run that ended for another reason does not', async () => {
    await setSwitch('HAF-1', 'enabled');
    const stoppedByLimit = await routed(P);
    const failed = await routed(P);
    const startHaf = (task: string) =>
      committed('worker', agentRun('HAF-1', P), async (tx) => {
        const [run] = await tx.rows<{ id: string }>(RUN, [task, 'HAF-1', ids.cardHaf]);
        return run?.id ?? '';
      });
    const endHaf = (run: string, status: string, code: string) =>
      committed('worker', agentRun('HAF-1', P), (tx) =>
        tx.exec(
          `update office.runs set status = $2, finished_at = now(), error_code = $3 where id = $1`,
          [run, status, code],
        ),
      );
    const first = await startHaf(stoppedByLimit);
    const second = await startHaf(failed);
    // The project reaches its limit while both runs are open; the runner ends the first before
    // its next model call, the second fails by itself.
    await spentByHand('1.25');
    await limitByHand('0.50');
    await endHaf(first, 'stopped', 'spending_limit_reached');
    await endHaf(second, 'failed', 'runner_error');
    // While the limit holds nothing counts for any opening, and nothing starts.
    expect(await waiting('HAF-1', null)).toBe(0);
    expect(await waiting(null, P)).toBe(0);
    expect(await restart(null, P)).toEqual([]);
    // The raise would start exactly the run the limit stopped.
    expect(await held('500.00')).toBe(1);
    await limitByHand('500.00');
    expect(await restart(null, P)).toEqual([stoppedByLimit]);
    expect(await restartTraces(stoppedByLimit)).toHaveLength(1);
    expect(await restartTraces(failed)).toEqual([]);
    expect(await restart(null, P)).toEqual([]);
  });

  it('waiting work: when the limit was raised without the panel, a later opening of the agent starts what the limit held', async () => {
    const { inside, outside } = await heldByTheLimit();
    await setSwitch('HAF-1', 'enabled');
    expect(await restart('HAF-1', null)).toEqual([outside]);
    await limitByHand(null);
    // Decision 49 for a missed start: the count of a later opening names it, and it starts it.
    expect(await waiting('HAF-1', null)).toBe(1);
    await setSwitch('HAF-1', 'stopped');
    await setSwitch('HAF-1', 'enabled');
    expect(await restart('HAF-1', null)).toEqual([inside]);
    expect(await restartTraces(inside)).toHaveLength(1);
    // Started once: nothing waits any more.
    expect(await waiting('HAF-1', null)).toBe(0);
    expect(await restart('HAF-1', null)).toEqual([]);
  });

  it('the count before a raise is the founder’s, through the API only, and knows nothing of another company', async () => {
    await heldByTheLimit();
    await setSwitch('HAF-1', 'enabled');
    const HELD = 'select office.count_work_held_by_spending_limit($1, $2::numeric) as waiting';
    const refusedFor = async (role: 'app' | 'worker', context: ContextInput) => {
      const open = await openTransaction(role, context);
      try {
        return (await open.tx.expectError(HELD, [P, '500'])).code;
      } finally {
        await open.rollback();
      }
    };
    // A member, an employee who is none, an external person, nobody; an agent run in the
    // founder's name.
    for (const context of [employeeA, approverA, externalA, {}, { companyId: ids.arma }]) {
      expect(await refusedFor('app', context), JSON.stringify(context)).toBe('42501');
    }
    expect(await refusedFor('app', { ...founderA, agentCode: 'KOR-1', projectId: P })).toBe(
      '42501',
    );
    // The worker's role does not hold the function, in anybody's name.
    expect(await refusedFor('worker', founderA)).toBe('42501');
    // The founder of the other company: no such project there, so nothing waits.
    expect(await held('500.00', founderP)).toBe(0);
    expect(await held('500.00', founderA, ids.projectP)).toBe(0);
    expect(await held('500.00', founderA, ids.projectANoAi)).toBe(0);
    const open = await openTransaction('app', founderA);
    try {
      expect((await open.tx.expectError(HELD, [null, '500'])).code).toBe('22023');
      // A limit that is no number counts nothing.
      expect(await open.tx.rows(HELD, [P, 'NaN'])).toEqual([{ waiting: 0 }]);
    } finally {
      await open.rollback();
    }
    // In the founder's own company and project: the one request the limit holds.
    expect(await held('500.00')).toBe(1);
  });

  it('the gate and a change of the limit wait for each other', async () => {
    const task = await open(P);
    await spentByHand('1.25');
    await limitByHand('500.00');
    // The runner asks the gate at the start of a run; its lock on the project row is held until
    // the run row is committed.
    const opening = await openTransaction('worker', { companyId: ids.arma, agentCode: 'KOR-1' });
    const lowering = await openTransaction('app', founderA);
    try {
      expect(
        await opening.tx.rows('select ai_allowed from office.request_run_gate($1)', [task]),
      ).toEqual([{ ai_allowed: true }]);
      // Lowering the limit below what was spent waits for the opening.
      const lowered = lowering.tx.rows<{ changed: boolean }>(SET, [P, '0.10']);
      await untilBlocked(lowering.pid);
      // The opening still reads "not reached", and opens its run under the old limit.
      expect(await reached(opening.tx)).toBe(false);
      await opening.tx.setContext(agentRun('KOR-1', P));
      expect(await opening.tx.rows(RUN, [task, 'KOR-1', ids.cardKor])).toHaveLength(1);
      await opening.commit();
      expect(await lowered).toEqual([{ changed: true }]);
      await lowering.commit();
    } finally {
      await opening.rollback();
      await lowering.rollback();
    }
    expect(await limitOf()).toBe('0.10');

    // The other way round: while a change of the limit is not committed, the gate waits, and
    // then reads the limit as it was left.
    await limitByHand(null);
    const change = await openTransaction('app', founderA);
    const next = await openTransaction('worker', { companyId: ids.arma, agentCode: 'KOR-1' });
    try {
      expect(await setLimit(change.tx, '0.10')).toBe(true);
      const gate = next.tx.rows('select ai_allowed from office.request_run_gate($1)', [task]);
      await untilBlocked(next.pid);
      await change.commit();
      expect(await gate).toEqual([{ ai_allowed: true }]);
      expect(await reached(next.tx)).toBe(true);
    } finally {
      await change.rollback();
      await next.rollback();
    }
  });

  it('the run check reads the cost another run committed after this transaction asked', async () => {
    const task = await open(P);
    await limitByHand('1.00');
    // A run of the project that is open and has cost nothing yet.
    const paying = await committed('worker', agentRun('KOR-1', P), async (tx) => {
      const [run] = await tx.rows<{ id: string }>(RUN, [task, 'KOR-1', ids.cardKor]);
      return run?.id ?? '';
    });
    const opening = await openTransaction('worker', agentRun('KOR-1', P));
    try {
      // The runner's question: not reached.
      expect(await reached(opening.tx)).toBe(false);
      // The other run's model call is answered and its cost committed: the limit is reached.
      await committed('worker', agentRun('KOR-1', P), (tx) =>
        tx.exec('update office.runs set cost_usd = 1.00 where id = $1', [paying]),
      );
      // The insert reads what is committed at that moment, not what the question saw.
      const refusedRun = await opening.tx.expectError(RUN, [task, 'KOR-1', ids.cardKor]);
      expect(refusedRun.code).toBe('54000');
      expect(refusedRun.message).toBe(AT_THE_LIMIT);
    } finally {
      await opening.rollback();
    }
    expect(await adminQuery('select id from office.runs where task_id = $1', [task])).toEqual([
      { id: paying },
    ]);
  });
});
