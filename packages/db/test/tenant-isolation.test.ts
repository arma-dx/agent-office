import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { listProjectRuns, projectRunTotals } from '../src/projects.ts';
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

// Tenant isolation and visibility tests (CLAUDE.md rules 2, 9, 12; PLAN Tests). All run with
// restricted roles: a person's context with the API's privileges (inTransaction), an agent run's
// context with the worker's (inWorkerTransaction). The table list is read from the database, so a
// new table enters the tests on its own.

const GLOBAL = ['agent_definitions', 'card_versions', 'tools', 'units'];
// Identity tables: a person can be a member of several companies. Login events belong to no
// company either (a rejected login has no company).
const WITHOUT_COMPANY_ID = [
  'companies',
  'login_events',
  'passkey_challenges',
  'passkeys',
  'sessions',
  'user_emails',
  'users',
];
// Tables whose rows carry company_id when they hold company data and none otherwise (a check
// constraint decides): a re-verification for an approval or a membership change names its company,
// one for a passkey change does not. They take part in every isolation test below.
const OPTIONAL_COMPANY_ID = ['step_ups'];
// Tables no application role can read yet (only written through a function).
const NOT_READABLE = ['login_events', 'passkey_challenges'];
// Tables only the API reaches (office_api_private); the worker has no privilege on them at all.
const API_ONLY = [
  'invitations',
  'login_events',
  'passkey_challenges',
  'passkeys',
  'sessions',
  'step_ups',
  // An agent's question and its answer: people read them through the API; a run is given the
  // answered questions of its own request by office.run_questions.
  'task_questions',
];

function person(companyId: string, userId: string, projectId: string | null = null): ContextInput {
  return { companyId, userId, projectId };
}

function agent(
  companyId: string,
  agentCode: string,
  projectId: string | null = null,
): ContextInput {
  // The identity is the founder: shows that the narrowing does not depend on the identity.
  return { companyId, userId: ids.founder, agentCode, projectId };
}

/** An agent run's context runs with the worker's privileges, a person's with the API's. */
function runAs<T>(context: ContextInput, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return context.agentCode ? inWorkerTransaction(fn) : inTransaction(fn);
}

describe.skipIf(noDatabase)('tenant isolation', () => {
  let tables: string[] = [];
  let companyTables: string[] = [];

  beforeAll(async () => {
    const rows = await adminQuery<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_schema = 'office' and table_type = 'BASE TABLE' order by 1`,
    );
    tables = rows.map((r) => r.name);
    companyTables = tables.filter((t) => !GLOBAL.includes(t) && !WITHOUT_COMPANY_ID.includes(t));
  });

  afterAll(closePools);

  it('every table holding company data has a required company_id and RLS enabled and forced', async () => {
    const missing = await adminQuery<{ name: string; reason: string }>(
      `select c.relname as name,
              case when not (c.relrowsecurity and c.relforcerowsecurity) then 'rls'
                   else 'company_id' end as reason
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'office' and c.relkind = 'r'
         and c.relname <> all ($1::text[])
         and (
           not (c.relrowsecurity and c.relforcerowsecurity)
           or (c.relname <> all ($2::text[]) and not exists (
             select 1 from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
               and (a.attnotnull or c.relname = any ($3::text[]))
           ))
         )`,
      [GLOBAL, WITHOUT_COMPANY_ID, OPTIONAL_COMPANY_ID],
    );
    expect(missing).toEqual([]);
  });

  it('the fixtures have rows of both companies in every company table', async () => {
    for (const table of companyTables) {
      const row = await adminQuery<{ a: number; p: number }>(
        `select count(*) filter (where company_id = $1)::int as a,
                count(*) filter (where company_id = $2)::int as p
         from office.${table}`,
        [ids.arma, ids.pillika],
      );
      expect(row[0]?.a, `${table}: no Arma DX row`).toBeGreaterThan(0);
      expect(row[0]?.p, `${table}: no Pillika row`).toBeGreaterThan(0);
    }
  });

  it('no row can be read without a context', async () => {
    await inTransaction(async (tx) => {
      const readable = tables.filter((t) => !GLOBAL.includes(t) && !NOT_READABLE.includes(t));
      for (const table of readable) {
        expect(await tx.count(table), table).toBe(0);
      }
      await tx.setContext({});
      for (const table of readable) {
        expect(await tx.count(table), table).toBe(0);
      }
      for (const table of NOT_READABLE) {
        expect((await tx.expectError(`select 1 from office.${table}`)).code, table).toBe('42501');
      }
    });
    // The worker's privileges: the API-only tables cannot be read at all.
    await inWorkerTransaction(async (tx) => {
      const readable = tables.filter((t) => !GLOBAL.includes(t) && !API_ONLY.includes(t));
      for (const table of readable) {
        expect(await tx.count(table), table).toBe(0);
      }
      for (const table of API_ONLY) {
        expect((await tx.expectError(`select 1 from office.${table}`)).code, table).toBe('42501');
      }
    });
  });

  it('global tables can be read but not changed', async () => {
    await inTransaction(async (tx) => {
      for (const table of GLOBAL) {
        expect(await tx.count(table), table).toBeGreaterThan(0);
      }
      expect(
        (await tx.expectError(`insert into office.units (code, name) values ('NEW', 'New')`)).code,
      ).toBe('42501');
      expect((await tx.expectError(`update office.tools set description = 'x'`)).code).toBe(
        '42501',
      );
      expect((await tx.expectError(`delete from office.card_versions`)).code).toBe('42501');
      expect((await tx.expectError(`update office.agent_definitions set name = 'x'`)).code).toBe(
        '42501',
      );
    });
  });

  const pillikaContexts: [string, ContextInput][] = [
    ['founder', person(ids.pillika, ids.founder)],
    ['employee', person(ids.pillika, ids.employeeP)],
    ['agent', agent(ids.pillika, 'KOR-1')],
    ['agent with project', agent(ids.pillika, 'KOR-1', ids.projectP)],
    ['external person', person(ids.pillika, ids.externalP)],
  ];

  it.each(pillikaContexts)(
    'with a Pillika context (%s) no Arma DX row can be read',
    async (_name, context) => {
      await runAs(context, async (tx) => {
        await tx.setContext(context);
        for (const table of companyTables) {
          // An agent run (the worker) cannot read the API-only tables at all.
          if (context.agentCode && API_ONLY.includes(table)) {
            expect((await tx.expectError(`select 1 from office.${table}`)).code, table).toBe(
              '42501',
            );
            continue;
          }
          // The only exception: a person sees their own memberships in every company (company
          // picker).
          const condition =
            table === 'memberships' && !context.agentCode
              ? 'company_id <> $1 and user_id <> $2'
              : 'company_id <> $1 and $2::uuid is not null';
          expect(await tx.count(table, condition, [ids.pillika, context.userId]), table).toBe(0);
        }
        if (context.agentCode) {
          expect(await tx.count('companies', 'id <> $1', [ids.pillika])).toBe(0);
        }
      });
    },
  );

  it('with a Pillika context the founder and the agent see their own company rows', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.pillika, ids.founder));
      for (const table of ['tasks', 'notes', 'projects', 'runs', 'approvals', 'audit_log']) {
        expect(await tx.count(table), table).toBeGreaterThan(0);
      }
      await tx.setContext(agent(ids.pillika, 'KOR-1'));
      for (const table of ['tasks', 'notes', 'runs', 'approvals', 'customers']) {
        expect(await tx.count(table), table).toBeGreaterThan(0);
      }
    });
  });

  it.each(pillikaContexts)(
    'with a Pillika context (%s) no Arma DX row can be changed or deleted',
    async (_name, context) => {
      await runAs(context, async (tx) => {
        await tx.setContext(context);
        for (const table of companyTables) {
          for (const sql of [
            `update office.${table} set company_id = company_id where company_id = $1`,
            `delete from office.${table} where company_id = $1`,
          ]) {
            await tx.client.query('savepoint s');
            try {
              expect(await tx.exec(sql, [ids.arma]), `${table}: ${sql}`).toBe(0);
              await tx.client.query('release savepoint s');
            } catch (error) {
              await tx.client.query('rollback to savepoint s');
              // An operation with no privilege at all is accepted too: it is rejected before
              // reaching the row policy.
              expect((error as { code?: string }).code, `${table}: ${sql}`).toBe('42501');
            }
          }
        }
      });
    },
  );

  it('with a Pillika context no row can be written on behalf of Arma DX', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.pillika, ids.founder));
      const queries = [
        `insert into office.tasks (company_id, title) values ('${ids.arma}', 'x')`,
        `insert into office.notes (company_id, title) values ('${ids.arma}', 'x')`,
        `insert into office.customers (company_id, name) values ('${ids.arma}', 'x')`,
        `insert into office.audit_log (company_id, event) values ('${ids.arma}', 'test')`,
        `insert into office.memberships (company_id, user_id, role) values ('${ids.arma}', '${ids.employeeP}', 'employee')`,
      ];
      for (const sql of queries) {
        expect((await tx.expectError(sql)).code, sql).toBe('42501');
      }
    });
  });

  it("a company's record cannot be linked to the other company's record", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.founder));
      expect(
        (
          await tx.expectError(
            `insert into office.tasks (company_id, project_id, title) values ($1, $2, 'x')`,
            [ids.arma, ids.projectP],
          )
        ).code,
      ).toBe('23503');
      expect(
        (
          await tx.expectError(
            `insert into office.projects (company_id, customer_id, name) values ($1, $2, 'x')`,
            [ids.arma, ids.customerP],
          )
        ).code,
      ).toBe('23503');
      expect(
        (
          await tx.expectError(
            `insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)`,
            [ids.arma, ids.projectA, ids.employeeP],
          )
        ).code,
      ).toBe('23503');
    });
  });

  it('a project scoped row cannot be read from outside the project', async () => {
    await inTransaction(async (tx) => {
      // approverA is an Arma DX employee and a member of no project.
      await tx.setContext(person(ids.arma, ids.approverA));
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(1);
      expect(await tx.count('tasks', 'project_id is not null')).toBe(0);
      expect(await tx.count('projects')).toBe(0);
      expect(await tx.count('notes', 'id = $1', [ids.noteAProject])).toBe(0);
      expect(await tx.count('note_versions', 'note_id = $1', [ids.noteAProject])).toBe(0);
      expect(await tx.count('runs', 'id = $1', [ids.runAProject])).toBe(0);
      expect(await tx.count('tool_calls', 'run_id = $1', [ids.runAProject])).toBe(0);
      expect(await tx.count('approvals', 'id = $1', [ids.approvalAProject])).toBe(0);
      expect(await tx.count('task_comments', 'task_id = $1', [ids.taskAProject])).toBe(0);

      // employeeA is a member of projectA.
      await tx.setContext(person(ids.arma, ids.employeeA));
      expect(await tx.count('tasks', 'id = $1', [ids.taskAProject])).toBe(1);
      expect(await tx.count('projects', 'id = $1', [ids.projectA])).toBe(1);
      expect(await tx.count('notes', 'id = $1', [ids.noteAProject])).toBe(1);
      expect(await tx.count('approvals', 'id = $1', [ids.approvalAProject])).toBe(1);
      expect(await tx.count('projects', 'id = $1', [ids.projectACustomerNoAi])).toBe(0);

      // The founder sees every project.
      await tx.setContext(person(ids.arma, ids.founder));
      expect(await tx.count('projects')).toBe(3);
      expect(await tx.count('tasks', 'project_id is not null')).toBe(2);
    });
  });

  it('the runs of a project of Arma DX are not listed in the context of Pillika, and no row without a context', async () => {
    await inTransaction(async (tx) => {
      // The fixtures hold one run in project A; its founder lists it.
      await tx.setContext(person(ids.arma, ids.founder));
      expect((await listProjectRuns(tx.client, ids.projectA, 100)).map((row) => row.id)).toEqual([
        ids.runAProject,
      ]);
      expect((await projectRunTotals(tx.client, ids.projectA)).run_count).toBe(1);
      const others: ContextInput[] = [
        person(ids.pillika, ids.founder),
        person(ids.pillika, ids.employeeP),
        // The project named in the context does not open it either.
        person(ids.pillika, ids.founder, ids.projectA),
        agent(ids.pillika, 'KOR-1'),
        agent(ids.pillika, 'KOR-1', ids.projectA),
        // Rule 9: without a company, without a person, without anything.
        {},
        { userId: ids.founder },
        { companyId: ids.arma },
        { projectId: ids.projectA },
      ];
      for (const context of others) {
        await tx.setContext(context);
        expect(
          await listProjectRuns(tx.client, ids.projectA, 100),
          JSON.stringify(context),
        ).toEqual([]);
        expect(
          (await projectRunTotals(tx.client, ids.projectA)).run_count,
          JSON.stringify(context),
        ).toBe(0);
      }
      // And the other way round: nothing of Pillika's project in the context of Arma DX.
      await tx.setContext(person(ids.arma, ids.founder));
      expect(await listProjectRuns(tx.client, ids.projectP, 100)).toEqual([]);
      expect((await projectRunTotals(tx.client, ids.projectP)).run_count).toBe(0);
    });
    // The worker's role in the context of Pillika reads none of them either.
    await inWorkerTransaction(async (tx) => {
      for (const context of [
        agent(ids.pillika, 'KOR-1'),
        agent(ids.pillika, 'KOR-1', ids.projectA),
      ]) {
        await tx.setContext(context);
        expect(await listProjectRuns(tx.client, ids.projectA, 100)).toEqual([]);
        expect((await projectRunTotals(tx.client, ids.projectA)).run_count).toBe(0);
      }
    });
  });

  it('an agent run without a project context cannot read project rows, even if its identity is the founder', async () => {
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(1);
      for (const table of ['tasks', 'notes', 'runs', 'approvals', 'task_comments']) {
        expect(await tx.count(table, 'project_id is not null'), table).toBe(0);
      }
      expect(await tx.count('projects')).toBe(0);
      expect(await tx.count('note_versions', 'note_id = $1', [ids.noteAProject])).toBe(0);
    });
  });

  it('an agent run with a project context sees only the rows of its own project', async () => {
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agent(ids.arma, 'KOR-1', ids.projectA));
      expect(await tx.count('projects')).toBe(1);
      expect(await tx.count('tasks', 'project_id is not null')).toBe(1);
      expect(await tx.count('tasks', 'id = $1', [ids.taskAProject])).toBe(1);
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(1);
      expect(await tx.count('tasks', 'id = $1', [ids.taskANoAiProject])).toBe(0);
      expect(await tx.count('notes', 'id = $1', [ids.noteAProject])).toBe(1);
    });
  });

  it('an agent run inherits the limits of its identity', async () => {
    await inWorkerTransaction(async (tx) => {
      // approverA is not a member of projectA: a run on their behalf sees no project row even in
      // the projectA context.
      await tx.setContext({
        companyId: ids.arma,
        userId: ids.approverA,
        agentCode: 'KOR-1',
        projectId: ids.projectA,
      });
      expect(await tx.count('projects')).toBe(0);
      expect(await tx.count('tasks', 'id = $1', [ids.taskAProject])).toBe(0);
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(1);
      // employeeA is a member: sees it.
      await tx.setContext({
        companyId: ids.arma,
        userId: ids.employeeA,
        agentCode: 'KOR-1',
        projectId: ids.projectA,
      });
      expect(await tx.count('tasks', 'id = $1', [ids.taskAProject])).toBe(1);
      // A run with an external person's identity sees nothing.
      await tx.setContext({ companyId: ids.arma, userId: ids.externalA, agentCode: 'KOR-1' });
      for (const table of ['tasks', 'notes', 'customers', 'integrations', 'company_agents']) {
        expect(await tx.count(table), table).toBe(0);
      }
    });
  });

  it("a record's project scope cannot be changed later", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.founder));
      expect(
        (
          await tx.expectError('update office.tasks set project_id = $2 where id = $1', [
            ids.taskA,
            ids.projectA,
          ])
        ).code,
      ).toBe('23514');
      expect(
        (
          await tx.expectError('update office.notes set project_id = $2 where id = $1', [
            ids.noteA,
            ids.projectA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(
            'update office.documents set project_id = $2 where company_id = $1',
            [ids.arma, ids.projectA],
          )
        ).code,
      ).toBe('23514');
      expect(
        (
          await tx.expectError(
            'update office.documents set source_note_id = $2 where company_id = $1',
            [ids.arma, ids.noteAProject],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it("only the founder sets a customer's contract permissions, through the function, with a passkey for the AI permission", async () => {
    const set = 'select office.set_customer_permissions($1, $2, $3)';
    const permissions = (tx: Tx, id: string) =>
      tx.rows(
        'select ai_allowed, automated_processing_allowed from office.customers where id = $1',
        [id],
      );
    const used = async (tx: Tx, id: string) =>
      (
        await tx.rows<{ used: boolean }>(
          'select consumed_at is not null as used from office.step_ups where id = $1',
          [id],
        )
      )[0]?.used;
    await inTransaction(async (tx) => {
      // An employee: neither permission, on or off, with or without a passkey of their own.
      await stepUp(
        tx,
        person(ids.arma, ids.employeeA),
        'customer_ai_permission',
        ids.customerANoAi,
      );
      for (const values of [
        [ids.customerANoAi, true, null],
        [ids.customerA, false, null],
        [ids.customerA, null, true],
        [ids.customerA, null, false],
      ]) {
        expect((await tx.expectError(set, values)).code).toBe('42501');
      }
      // An agent run.
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect((await tx.expectError(set, [ids.customerA, false, null])).code).toBe('42501');
      expect((await tx.expectError(set, [ids.customerA, null, true])).code).toBe('42501');

      await tx.setContext(person(ids.arma, ids.founder));
      // Automated processing: on and off without a passkey.
      await tx.exec(set, [ids.customerANoAi, null, true]);
      expect(await permissions(tx, ids.customerANoAi)).toEqual([
        { ai_allowed: false, automated_processing_allowed: true },
      ]);
      await tx.exec(set, [ids.customerANoAi, null, false]);
      expect(await permissions(tx, ids.customerANoAi)).toEqual([
        { ai_allowed: false, automated_processing_allowed: false },
      ]);

      // The AI permission: on only with a passkey for exactly this customer and this purpose.
      // The employee's own re-verification above does not count for the founder.
      expect((await tx.expectError(set, [ids.customerANoAi, true, null])).code).toBe('28000');
      const founder = person(ids.arma, ids.founder);
      const wrong = [
        await stepUp(tx, founder, 'customer_ai_permission', ids.customerA),
        await stepUp(tx, founder, 'project_ai_permission', ids.customerANoAi),
        await stepUp(tx, founder, 'membership_change', ids.customerANoAi),
      ];
      expect((await tx.expectError(set, [ids.customerANoAi, true, null])).code).toBe('28000');
      expect(await permissions(tx, ids.customerANoAi)).toEqual([
        { ai_allowed: false, automated_processing_allowed: false },
      ]);
      const right = await stepUp(tx, founder, 'customer_ai_permission', ids.customerANoAi);
      // A null argument leaves that permission as it is.
      await tx.exec(set, [ids.customerANoAi, true, null]);
      expect(await permissions(tx, ids.customerANoAi)).toEqual([
        { ai_allowed: true, automated_processing_allowed: false },
      ]);
      expect(await used(tx, right)).toBe(true);
      for (const id of wrong) {
        expect(await used(tx, id)).toBe(false);
      }
      // Open already: asking again needs no passkey and changes nothing.
      await tx.exec(set, [ids.customerANoAi, true, true]);
      expect(await permissions(tx, ids.customerANoAi)).toEqual([
        { ai_allowed: true, automated_processing_allowed: true },
      ]);

      // Off without a passkey; on again needs a new one.
      await tx.exec(set, [ids.customerANoAi, false, null]);
      expect(await permissions(tx, ids.customerANoAi)).toEqual([
        { ai_allowed: false, automated_processing_allowed: true },
      ]);
      expect((await tx.expectError(set, [ids.customerANoAi, true, null])).code).toBe('28000');

      expect((await tx.expectError(set, [null, true, null])).code).toBe('22023');
      // The other company's customer does not exist here, for its founder either.
      expect((await tx.expectError(set, [ids.customerP, false, null])).code).toBe('P0002');
    });
  });

  it('a permission on a new customer row needs the founder and a passkey, or no person in the context', async () => {
    const insert = `insert into office.customers (id, company_id, name, ai_allowed,
        automated_processing_allowed) values ($1, $2, $3, $4, $5)`;
    await inAdminTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.employeeA));
      expect(
        (await tx.expectError(insert, [randomUUID(), ids.arma, 'With AI', true, false])).code,
      ).toBe('42501');
      expect(
        (await tx.expectError(insert, [randomUUID(), ids.arma, 'With code', false, true])).code,
      ).toBe('42501');
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect(
        (await tx.expectError(insert, [randomUUID(), ids.arma, 'By a run', true, false])).code,
      ).toBe('42501');
      await tx.setContext(person(ids.pillika, ids.founder));
      expect(
        (await tx.expectError(insert, [randomUUID(), ids.arma, 'Other company', false, true])).code,
      ).toBe('42501');

      const founder = person(ids.arma, ids.founder);
      await tx.setContext(founder);
      const id = randomUUID();
      expect((await tx.expectError(insert, [id, ids.arma, 'With AI', true, false])).code).toBe(
        '28000',
      );
      // Automated processing alone needs the founder, not a passkey.
      expect(await tx.exec(insert, [randomUUID(), ids.arma, 'With code', false, true])).toBe(1);
      // The passkey names the id of the customer that is being added.
      await stepUp(tx, founder, 'customer_ai_permission', id);
      expect(
        (await tx.expectError(insert, [randomUUID(), ids.arma, 'Another id', true, false])).code,
      ).toBe('28000');
      expect(await tx.exec(insert, [id, ids.arma, 'With AI', true, false])).toBe(1);

      // An administrator, without a person in the context.
      await tx.setContext({});
      expect(await tx.exec(insert, [randomUUID(), ids.arma, 'By hand', true, true])).toBe(1);
    });
  });

  it('records of a project and a customer without AI permission are closed to the agent context', async () => {
    await inTransaction(async (tx) => {
      // Even with the context of the project without permission, the project and its rows are not
      // visible; a run cannot be opened.
      await tx.setContext(agent(ids.arma, 'KOR-1', ids.projectANoAi));
      expect(await tx.count('projects')).toBe(0);
      expect(await tx.count('tasks', 'id = $1', [ids.taskANoAiProject])).toBe(0);
      expect(
        (
          await tx.expectError(
            `insert into office.runs (company_id, agent_code, card_version_id, trigger_type, model)
             values ($1, 'KOR-1', $2, 'request', 'test-model')`,
            [ids.arma, ids.cardKor],
          )
        ).code,
      ).toBe('42501');

      // Closed too if the project has permission but its customer does not.
      await tx.setContext(agent(ids.arma, 'KOR-1', ids.projectACustomerNoAi));
      expect(await tx.count('projects')).toBe(0);

      // The customer without permission and its opportunity cannot be read in an agent context; a
      // person reads them.
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect(await tx.count('customers', 'id = $1', [ids.customerANoAi])).toBe(0);
      expect(await tx.count('customers', 'id = $1', [ids.customerA])).toBe(1);
      expect(await tx.count('opportunities', 'customer_id = $1', [ids.customerANoAi])).toBe(0);
      await tx.setContext(person(ids.arma, ids.employeeA));
      expect(await tx.count('customers', 'id = $1', [ids.customerANoAi])).toBe(1);
      expect(await tx.count('opportunities', 'customer_id = $1', [ids.customerANoAi])).toBe(1);
    });
  });

  it('a user sees only their own record, memberships and companies', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.employeeA));
      expect(await tx.rows('select user_id from office.memberships')).toEqual([
        { user_id: ids.employeeA },
      ]);
      expect(await tx.rows('select id from office.users')).toEqual([{ id: ids.employeeA }]);
      expect(await tx.rows('select id from office.companies')).toEqual([{ id: ids.arma }]);

      expect(await tx.rows('select email from office.user_emails')).toEqual([
        { email: 'employee.a@example.test' },
      ]);

      // The founder sees the members of their own company, not the members of the other company.
      // The founder does not read the members' addresses either (only their own).
      await tx.setContext(person(ids.arma, ids.founder));
      expect(await tx.count('memberships', 'company_id = $1', [ids.arma])).toBe(5);
      expect(await tx.count('memberships', 'user_id = $1', [ids.employeeP])).toBe(0);
      expect(await tx.count('users', 'id = $1', [ids.employeeP])).toBe(0);
      expect(await tx.count('user_emails', 'user_id = $1', [ids.employeeP])).toBe(0);
      expect(await tx.count('user_emails', 'user_id = $1', [ids.employeeA])).toBe(0);
      expect(await tx.count('user_emails', 'user_id = $1', [ids.founder])).toBe(2);
      expect(await tx.count('companies')).toBe(3);
      // The shared employee's membership in another company is not visible.
      expect(await tx.count('memberships', 'user_id = $1', [ids.sharedEmployee])).toBe(1);

      // At login only the verified email's record is found; letter case does not matter.
      await tx.setContext({ email: 'Employee.A@example.test' });
      expect(await tx.rows('select id from office.users')).toEqual([{ id: ids.employeeA }]);
      expect(await tx.count('user_emails')).toBe(1);
      expect(await tx.count('memberships')).toBe(0);
      await tx.setContext({ email: 'none@example.test' });
      expect(await tx.count('users')).toBe(0);
    });
  });

  it('a person with several emails is found as the same user', async () => {
    await inTransaction(async (tx) => {
      for (const email of ['founder@arma.test', 'FOUNDER@pillika.test']) {
        await tx.setContext({ email });
        expect(await tx.rows('select id from office.users')).toEqual([{ id: ids.founder }]);
        // At login only that address is visible, not the person's other addresses.
        expect(await tx.count('user_emails')).toBe(1);
      }
      await tx.setContext(person(ids.arma, ids.founder));
      expect(await tx.count('user_emails', 'user_id = $1', [ids.founder])).toBe(2);
      // An agent run sees no email.
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect(await tx.count('user_emails')).toBe(0);
    });
  });

  it('the application cannot create an identity record or write an email', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.founder));
      expect(
        (await tx.expectError(`insert into office.users (name) values ('New Person')`)).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError('insert into office.user_emails (email, user_id) values ($1, $2)', [
            'new.a@example.test',
            ids.employeeA,
          ])
        ).code,
      ).toBe('42501');
      expect((await tx.expectError('delete from office.user_emails')).code).toBe('42501');
      expect(
        (await tx.expectError(`update office.user_emails set email = 'x@example.test'`)).code,
      ).toBe('42501');
    });
  });

  it('an account is managed only by a person who is founder in every company the account can access', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.founder));
      expect(
        await tx.exec(`update office.users set name = 'Çalışan A2' where id = $1`, [ids.employeeA]),
      ).toBe(1);
      // Deactivating needs the founder's passkey re-verification (3 October decision 7).
      await stepUp(tx, person(ids.arma, ids.founder), 'membership_change', ids.employeeA);
      expect(
        await tx.exec('update office.users set active = false where id = $1', [ids.employeeA]),
      ).toBe(1);
      // An account that also accesses another company, and one that is a member of no company,
      // cannot be managed.
      expect(
        await tx.exec('update office.users set active = false where id = $1', [ids.sharedEmployee]),
      ).toBe(0);
      expect(
        await tx.exec(`update office.users set name = 'x' where id = $1`, [ids.formerEmployee]),
      ).toBe(0);
      // A bulk update without WHERE also reaches only the managed accounts and the person
      // themselves.
      expect(await tx.exec('update office.users set name = name')).toBe(4);

      await tx.setContext(person(ids.otherCompany, ids.otherFounder));
      expect(await tx.exec('update office.users set active = active, name = name')).toBe(1);
      expect(
        await tx.exec('update office.users set active = false where id <> $1', [ids.otherFounder]),
      ).toBe(0);

      // A person changes their own name but cannot deactivate their account.
      await tx.setContext(person(ids.arma, ids.approverA));
      expect(
        await tx.exec(`update office.users set name = 'New Name' where id = $1`, [ids.approverA]),
      ).toBe(1);
      expect(
        (
          await tx.expectError('update office.users set active = false where id = $1', [
            ids.approverA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        await tx.exec(`update office.users set name = 'x' where id = $1`, [ids.employeeA]),
      ).toBe(0);

      // An agent run only reads the identity's record and cannot change it.
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect(await tx.rows('select id from office.users')).toEqual([{ id: ids.founder }]);
      expect(await tx.exec(`update office.users set name = 'x'`)).toBe(0);
    });
  });

  it('an email is stored in lowercase and in a valid format', async () => {
    await inAdminTransaction(async (tx) => {
      for (const email of [
        'Upper@Example.test',
        'space @example.test',
        'nodomain',
        'two@@example.test',
      ]) {
        expect(
          (
            await tx.expectError(
              'insert into office.user_emails (email, user_id) values ($1, $2)',
              [email, ids.formerEmployee],
            )
          ).code,
          email,
        ).toBe('23514');
      }
    });
  });

  it("a user cannot change another person's membership; only the founder manages memberships", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.approverA));
      expect(
        await tx.exec(`update office.memberships set can_approve = true where user_id = $1`, [
          ids.employeeA,
        ]),
      ).toBe(0);
      expect(
        await tx.exec(`update office.memberships set role = 'founder' where user_id = $1`, [
          ids.approverA,
        ]),
      ).toBe(0);
      await tx.setContext(agent(ids.arma, 'KOR-1'));
      expect(await tx.exec(`update office.memberships set can_approve = true`)).toBe(0);
      // The founder's change needs a passkey re-verification (3 October decision 7).
      await stepUp(tx, person(ids.arma, ids.founder), 'membership_change', ids.employeeA);
      expect(
        await tx.exec(`update office.memberships set can_approve = true where user_id = $1`, [
          ids.employeeA,
        ]),
      ).toBe(1);
    });
  });

  it('an external person sees only the tasks and notes shared with them', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.arma, ids.externalA));
      expect(await tx.rows('select id from office.tasks')).toEqual([{ id: ids.taskAShared }]);
      expect(await tx.rows('select id from office.notes')).toEqual([{ id: ids.noteAShared }]);
      expect(await tx.count('task_comments')).toBe(1);
      expect(await tx.count('note_versions', 'note_id <> $1', [ids.noteAShared])).toBe(0);
      for (const table of [
        'projects',
        'customers',
        'runs',
        'approvals',
        'documents',
        'files',
        'audit_log',
        'company_agents',
      ]) {
        expect(await tx.count(table), table).toBe(0);
      }
      // Comments on the shared task, cannot comment on another one; cannot change the task.
      await tx.exec(
        `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'Document added')`,
        [ids.arma, ids.taskAShared],
      );
      expect(
        (
          await tx.expectError(
            `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'x')`,
            [ids.arma, ids.taskA],
          )
        ).code,
      ).toBe('23503');
      expect(
        await tx.exec(`update office.tasks set title = 'x' where id = $1`, [ids.taskAShared]),
      ).toBe(0);
      expect(
        await tx.exec(`update office.notes set body = 'x' where id = $1`, [ids.noteAShared]),
      ).toBe(0);
      // Assigning a task to an external person does not share it with them; the founder shares it
      // with an access grant.
      await tx.setContext(person(ids.arma, ids.employeeA));
      expect(
        await tx.exec('update office.tasks set assignee_user_id = $2 where id = $1', [
          ids.taskA,
          ids.externalA,
        ]),
      ).toBe(1);
      await tx.setContext(person(ids.arma, ids.externalA));
      expect(await tx.count('tasks', 'id = $1', [ids.taskA])).toBe(0);
      // A task cannot be assigned to a person who is not a member of the company.
      await tx.setContext(person(ids.arma, ids.founder));
      expect(
        (
          await tx.expectError('update office.tasks set assignee_user_id = $2 where id = $1', [
            ids.taskA,
            ids.employeeP,
          ])
        ).code,
      ).toBe('23503');
    });
  });

  it('only the founder is a member of and has access to the founder space', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(person(ids.founderSpace, ids.founder));
      expect(await tx.count('tasks')).toBe(1);
      // The application cannot add members at all (only an accepted invitation does).
      expect(
        (
          await tx.expectError(
            `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'employee')`,
            [ids.founderSpace, ids.employeeA],
          )
        ).code,
      ).toBe('42501');
      await tx.setContext(person(ids.founderSpace, ids.employeeA));
      expect(await tx.count('tasks')).toBe(0);
      expect(await tx.count('companies', 'id = $1', [ids.founderSpace])).toBe(0);
    });
    // The rule holds for the privileged role too.
    await inAdminTransaction(async (tx) => {
      expect(
        (
          await tx.expectError(
            `insert into office.memberships (company_id, user_id, role) values ($1, $2, 'employee')`,
            [ids.founderSpace, ids.employeeA],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('the application role is a restricted role without BYPASSRLS', async () => {
    await inTransaction(async (tx) => {
      const [role] = await tx.rows<{ superuser: boolean; bypass: boolean; app: boolean }>(
        `select r.rolsuper as superuser, r.rolbypassrls as bypass,
                pg_has_role(current_user, 'office_app', 'member') as app
         from pg_roles r where r.rolname = current_user`,
      );
      expect(role).toEqual({ superuser: false, bypass: false, app: true });
      const privileged = await tx.rows(
        `select rolname from pg_roles
         where rolname in ('office_app', 'office_auth_reader', 'office_trigger', 'office_queue',
                           'office_identity', 'office_api_private')
           and (rolbypassrls or rolsuper or rolcanlogin)`,
      );
      expect(privileged).toEqual([]);
      // Login roles of the API and the worker: restricted, they inherit the application role's
      // privileges.
      const loginRoles = await tx.rows(
        `select r.rolname as name, r.rolcanlogin as login, r.rolsuper or r.rolbypassrls as privileged,
                r.rolcreaterole or r.rolcreatedb as admin,
                pg_has_role(r.rolname, 'office_app', 'usage') as inherits
         from pg_roles r where r.rolname in ('office_api', 'office_worker') order by 1`,
      );
      expect(loginRoles).toEqual([
        { name: 'office_api', login: true, privileged: false, admin: false, inherits: true },
        { name: 'office_worker', login: true, privileged: false, admin: false, inherits: true },
      ]);
    });
  });
});
