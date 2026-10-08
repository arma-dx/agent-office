import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import {
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// The Projects section, step 1 (8 October decisions 14 to 22; docs/SONRA.md P-a to P-j, W-i): the
// fields of a project, who opens and changes one, who its members are, and who sets the AI
// permission of a project and the contract permissions of a customer. Every rule here is the
// database's own; the API and the panel only ask.

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
// A member of projectA and of projectANoAi.
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
// An employee of Arma DX who is a member of no project.
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
const founderSpace: ContextInput = { companyId: ids.founderSpace, userId: ids.founder };

const ADD_MEMBER =
  'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)';
const REMOVE_MEMBER = 'delete from office.project_members where project_id = $1 and user_id = $2';

async function memberIds(tx: Tx, projectId: string): Promise<string[]> {
  const rows = await tx.rows<{ user_id: string }>(
    'select user_id from office.project_members where project_id = $1 order by user_id',
    [projectId],
  );
  return rows.map((row) => row.user_id);
}

/** A project written by the privileged role without a person in the context; returns its id. */
async function adminProject(tx: Tx, fields: Record<string, unknown> = {}): Promise<string> {
  const all: Record<string, unknown> = {
    id: randomUUID(),
    company_id: ids.arma,
    name: 'Scratch project',
    ...fields,
  };
  const names = Object.keys(all);
  await tx.exec(
    `insert into office.projects (${names.join(', ')})
     values (${names.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
    Object.values(all),
  );
  return String(all.id);
}

describe.skipIf(noDatabase)('project fields', () => {
  afterAll(closePools);

  it('projects: the five statuses; completed and cancelled close a project', async () => {
    await inAdminTransaction(async (tx) => {
      const expected: [string, boolean][] = [
        ['backlog', false],
        ['planned', false],
        ['in_progress', false],
        ['completed', true],
        ['cancelled', true],
      ];
      for (const [status, closed] of expected) {
        const id = await adminProject(tx, { status });
        expect(
          await tx.rows('select status, closed from office.projects where id = $1', [id]),
        ).toEqual([{ status, closed }]);
      }
      // The two values the table held before.
      for (const status of ['open', 'closed']) {
        expect(
          (
            await tx.expectError(
              `insert into office.projects (company_id, name, status) values ($1, 'x', $2)`,
              [ids.arma, status],
            )
          ).code,
        ).toBe('23514');
      }
      // Derived, never written.
      const id = await adminProject(tx);
      expect(
        (await tx.expectError('update office.projects set closed = true where id = $1', [id])).code,
      ).toBe('428C9');
    });
  });

  it("projects: the migration's own statement turns open into in_progress and closed into completed", async () => {
    const sql = await readFile(new URL('20261008101600_project_fields.sql', MIGRATIONS), 'utf8');
    const start = sql.indexOf('update office.projects set status =');
    expect(start).toBeGreaterThan(-1);
    const statement = sql.slice(start, sql.indexOf(';', start) + 1);
    // One statement, and it names the table once.
    expect(statement.split('office.projects')).toHaveLength(2);
    await inAdminTransaction(async (tx) => {
      await tx.exec('create temp table legacy_projects (status text) on commit drop');
      await tx.exec(`insert into legacy_projects (status) values ('open'), ('closed')`);
      expect(await tx.exec(statement.replace('office.projects', 'legacy_projects'))).toBe(2);
      expect(await tx.rows('select status from legacy_projects order by status')).toEqual([
        { status: 'completed' },
        { status: 'in_progress' },
      ]);
    });
  });

  it('projects: a new row starts planned, gray, with the folder icon, without a target date or an opener', async () => {
    await inAdminTransaction(async (tx) => {
      const id = await adminProject(tx);
      expect(
        await tx.rows(
          `select status, closed, color, icon, target_date, description, created_by_user_id,
                  ai_allowed
           from office.projects where id = $1`,
          [id],
        ),
      ).toEqual([
        {
          status: 'planned',
          closed: false,
          color: 'gray',
          icon: 'folder',
          target_date: null,
          description: null,
          created_by_user_id: null,
          ai_allowed: false,
        },
      ]);
    });
  });

  it('projects: the name, the description, the colour and the icon are checked', async () => {
    await inAdminTransaction(async (tx) => {
      const refused: Record<string, unknown>[] = [
        { name: 'Trailing space ' },
        { name: ' Leading space' },
        { name: 'x'.repeat(121) },
        { name: '' },
        { description: '' },
        { description: 'x'.repeat(5001) },
        { color: 'grey' },
        { icon: 'rocket' },
      ];
      for (const fields of refused) {
        const all = { company_id: ids.arma, name: 'Checked', ...fields };
        const names = Object.keys(all);
        expect(
          (
            await tx.expectError(
              `insert into office.projects (${names.join(', ')})
               values (${names.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
              Object.values(all),
            )
          ).code,
          JSON.stringify(Object.keys(fields)),
        ).toBe('23514');
      }
      // The limits themselves are accepted.
      await adminProject(tx, {
        name: 'x'.repeat(120),
        description: 'x'.repeat(5000),
        color: 'pink',
        icon: 'box',
      });
    });
  });

  it('customers: a name is trimmed, at most 120 characters and unique in its company whatever the case', async () => {
    await inAdminTransaction(async (tx) => {
      const insert = `insert into office.customers (company_id, name) values ($1, $2)`;
      expect((await tx.expectError(insert, [ids.arma, 'Beta '])).code).toBe('23514');
      expect((await tx.expectError(insert, [ids.arma, 'x'.repeat(121)])).code).toBe('23514');
      expect((await tx.expectError(insert, [ids.arma, ''])).code).toBe('23514');
      expect(await tx.exec(insert, [ids.arma, 'Beta'])).toBe(1);
      expect((await tx.expectError(insert, [ids.arma, 'BETA'])).code).toBe('23505');
      expect((await tx.expectError(insert, [ids.arma, 'beta'])).code).toBe('23505');
      // Another company may have a customer of the same name.
      expect(await tx.exec(insert, [ids.pillika, 'Beta'])).toBe(1);
      expect(await tx.exec(insert, [ids.arma, 'x'.repeat(120)])).toBe(1);
    });
  });
});

describe.skipIf(noDatabase)('who opens and changes a project', () => {
  afterAll(closePools);

  it('projects: an employee opens a project and is its opener and its only member', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(approverA);
      const id = randomUUID();
      expect(
        await tx.exec(
          `insert into office.projects (id, company_id, name) values ($1, $2, 'Opened by an employee')`,
          [id, ids.arma],
        ),
      ).toBe(1);
      // The opener reads the project: the member row was written in the same statement.
      expect(
        await tx.rows(
          `select status, ai_allowed, created_by_user_id, created_at = now() as stamped
           from office.projects where id = $1`,
          [id],
        ),
      ).toEqual([
        { status: 'planned', ai_allowed: false, created_by_user_id: ids.approverA, stamped: true },
      ]);
      expect(await memberIds(tx, id)).toEqual([ids.approverA]);
      // Who, when and the AI permission are not the opener's to write.
      for (const [column, value] of [
        ['created_by_user_id', ids.employeeA],
        ['created_at', '2020-01-01T00:00:00Z'],
        ['ai_allowed', true],
        ['budget', 10],
        ['milestones', '[]'],
      ] as const) {
        expect(
          (
            await tx.expectError(
              `insert into office.projects (company_id, name, ${column}) values ($1, 'x', $2)`,
              [ids.arma, value],
            )
          ).code,
          column,
        ).toBe('42501');
      }
    });
  });

  it('projects: a colleague who is not a member reads no row of it', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(approverA);
      expect(await tx.count('projects')).toBe(0);
      expect(await tx.count('project_members', 'project_id = $1', [ids.projectA])).toBe(0);
      expect(
        await tx.exec(`update office.projects set name = 'Taken over' where id = $1`, [
          ids.projectA,
        ]),
      ).toBe(0);
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).code).toBe(
        '42501',
      );
      // A project the colleague opens is theirs; the others stay hidden.
      await tx.exec(`insert into office.projects (company_id, name) values ($1, 'Own')`, [
        ids.arma,
      ]);
      expect(await tx.count('projects')).toBe(1);
    });
  });

  it('projects: the founder reads and changes every project of the company without being a member', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await tx.count('project_members', 'user_id = $1', [ids.founder])).toBe(0);
      expect(await tx.count('projects')).toBe(3);
      expect(
        await tx.exec(
          `update office.projects set name = 'Renamed by the founder', status = 'completed'
           where id = $1`,
          [ids.projectANoAi],
        ),
      ).toBe(1);
      expect(
        await tx.rows('select name, closed from office.projects where id = $1', [ids.projectANoAi]),
      ).toEqual([{ name: 'Renamed by the founder', closed: true }]);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectANoAi, ids.approverA])).toBe(1);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectANoAi, ids.employeeA])).toBe(1);
    });
  });

  it('projects: a member changes name, description, customer, status, colour, icon and target date, and nothing else', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(
        await tx.exec(
          `update office.projects set name = 'New name', description = 'What it is for',
             customer_id = $2, status = 'in_progress', color = 'teal', icon = 'code',
             target_date = '2026-12-31'
           where id = $1`,
          [ids.projectANoAi, ids.customerA],
        ),
      ).toBe(1);
      expect(
        await tx.rows(
          `select name, description, customer_id, status, color, icon, target_date::text as day
           from office.projects where id = $1`,
          [ids.projectANoAi],
        ),
      ).toEqual([
        {
          name: 'New name',
          description: 'What it is for',
          customer_id: ids.customerA,
          status: 'in_progress',
          color: 'teal',
          icon: 'code',
          day: '2026-12-31',
        },
      ]);
      for (const assignment of [
        'budget = 10',
        `milestones = '[]'`,
        'ai_allowed = true',
        `company_id = '${ids.pillika}'`,
        `id = '${randomUUID()}'`,
        `created_by_user_id = '${ids.employeeA}'`,
        'created_at = now()',
      ]) {
        expect(
          (
            await tx.expectError(`update office.projects set ${assignment} where id = $1`, [
              ids.projectANoAi,
            ])
          ).code,
          assignment,
        ).toBe('42501');
      }
    });
  });

  it('projects: nobody deletes a project', async () => {
    await inTransaction(async (tx) => {
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect(
          (await tx.expectError('delete from office.projects where id = $1', [ids.projectANoAi]))
            .code,
        ).toBe('42501');
      }
    });
  });

  it("projects: an external person opens none, and the worker's role writes nothing", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(externalA);
      expect(
        (
          await tx.expectError(
            `insert into office.projects (company_id, name) values ($1, 'By an external person')`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
      expect(await tx.count('projects')).toBe(0);
    });
    await inWorkerTransaction(async (tx) => {
      const asWorker: ContextInput[] = [
        founderA,
        { ...founderA, agentCode: 'KOR-1' },
        { ...founderA, agentCode: 'KOR-1', projectId: ids.projectA },
      ];
      for (const context of asWorker) {
        await tx.setContext(context);
        const refused: [string, unknown[]][] = [
          [
            `insert into office.projects (company_id, name) values ($1, 'By the worker')`,
            [ids.arma],
          ],
          [`update office.projects set name = 'By the worker' where id = $1`, [ids.projectA]],
          [ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]],
          [REMOVE_MEMBER, [ids.projectA, ids.employeeA]],
          ['delete from office.projects where id = $1', [ids.projectA]],
        ];
        for (const [sql, values] of refused) {
          expect((await tx.expectError(sql, values)).code, sql).toBe('42501');
        }
      }
    });
  });

  it('projects: none is opened in the founder space', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderSpace);
      expect(
        (
          await tx.expectError(
            `insert into office.projects (company_id, name) values ($1, 'Private')`,
            [ids.founderSpace],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it("projects: a person's project starts without AI permission, for the privileged role too", async () => {
    await inAdminTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(
            `insert into office.projects (company_id, name, ai_allowed) values ($1, 'Open', true)`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
      // Without a person in the context the privileged role writes as an administrator would,
      // and nobody becomes a member.
      await tx.setContext({});
      const id = await adminProject(tx, { ai_allowed: true });
      expect(await memberIds(tx, id)).toEqual([]);
    });
  });
});

describe.skipIf(noDatabase)('project members', () => {
  afterAll(closePools);

  it('project members: a member adds a founder or an employee of the company and removes another member', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).toBe(1);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      expect(await memberIds(tx, ids.projectA)).toEqual([
        ids.founder,
        ids.employeeA,
        ids.approverA,
      ]);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.approverA])).toBe(1);
      expect(await memberIds(tx, ids.projectA)).toEqual([ids.founder, ids.employeeA]);
      // A membership is added and removed, never rewritten.
      expect(
        (
          await tx.expectError(
            'update office.project_members set user_id = $2 where project_id = $1',
            [ids.projectA, ids.approverA],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it('project members: an external person is refused and a person outside the company too', async () => {
    await inTransaction(async (tx) => {
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect(
          (await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA])).code,
        ).toBe('23514');
        expect(
          (await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.employeeP])).code,
        ).toBe('23503');
      }
    });
  });

  it('project members: a deactivated account is not added, by a member, the founder or the privileged role', async () => {
    await inTransaction(async (tx) => {
      // The founder deactivates the account (a membership change: needs the passkey step).
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.exec('update office.users set active = false where id = $1', [ids.approverA]);
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect(
          (await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).code,
        ).toBe('23514');
      }
    });
    // The privileged role without a person in the context is held to the same rule.
    await inAdminTransaction(async (tx) => {
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.exec('update office.users set active = false where id = $1', [ids.approverA]);
      await tx.setContext({});
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).code).toBe(
        '23514',
      );
    });
  });

  it('project members: an employee does not remove themselves; the founder may', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA])).toBe(0);
      expect(await memberIds(tx, ids.projectA)).toEqual([ids.employeeA]);
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.founder])).toBe(1);
      expect(await tx.count('projects', 'id = $1', [ids.projectA])).toBe(1);
      // The founder removes the last member too; the project stays, seen by the founder alone.
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA])).toBe(1);
      expect(await tx.count('projects', 'id = $1', [ids.projectA])).toBe(1);
      await tx.setContext(employeeA);
      expect(await tx.count('projects', 'id = $1', [ids.projectA])).toBe(0);
    });
  });

  it('project members: a member who becomes external loses the project memberships of that company only', async () => {
    await inAdminTransaction(async (tx) => {
      const elsewhere = await adminProject(tx, { company_id: ids.otherCompany });
      await tx.exec(ADD_MEMBER, [ids.otherCompany, elsewhere, ids.sharedEmployee]);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectANoAi, ids.sharedEmployee]);
      expect(
        await tx.exec(
          `update office.memberships set role = 'external' where company_id = $1 and user_id = $2`,
          [ids.arma, ids.sharedEmployee],
        ),
      ).toBe(1);
      expect(
        await tx.rows(
          'select company_id, project_id from office.project_members where user_id = $1',
          [ids.sharedEmployee],
        ),
      ).toEqual([{ company_id: ids.otherCompany, project_id: elsewhere }]);
      // Becoming an employee again brings no membership back.
      await tx.exec(
        `update office.memberships set role = 'employee' where company_id = $1 and user_id = $2`,
        [ids.arma, ids.sharedEmployee],
      );
      expect(await tx.count('project_members', 'user_id = $1', [ids.sharedEmployee])).toBe(1);
      // The other members of the projects are untouched.
      expect(await memberIds(tx, ids.projectA)).toEqual([ids.employeeA]);
    });
  });

  it('project members: who may not add a member to a project is refused the same way whoever they name', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(approverA);
      // An external person of the own company: the refusal does not say so.
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA])).code).toBe(
        '42501',
      );
      // A row that names another company, its project and one of its external people.
      expect(
        (await tx.expectError(ADD_MEMBER, [ids.pillika, ids.projectP, ids.externalP])).code,
      ).toBe('42501');
      expect(
        (await tx.expectError(ADD_MEMBER, [ids.pillika, ids.projectP, ids.employeeP])).code,
      ).toBe('42501');
      // Somebody who is a member already: not "0 rows", which would tell.
      expect(
        (
          await tx.expectError(`${ADD_MEMBER} on conflict (project_id, user_id) do nothing`, [
            ids.arma,
            ids.projectA,
            ids.employeeA,
          ])
        ).code,
      ).toBe('42501');
      // A member, who may add, is told why.
      await tx.setContext(employeeA);
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA])).code).toBe(
        '23514',
      );
    });
  });
});

describe.skipIf(noDatabase)('projects between companies', () => {
  afterAll(closePools);

  it("projects: with a Pillika context nothing of Arma DX's projects, members and customers is read or changed", async () => {
    await inTransaction(async (tx) => {
      for (const context of [founderP, employeeP]) {
        await tx.setContext(context);
        for (const table of ['projects', 'project_members', 'customers']) {
          expect(await tx.count(table, 'company_id = $1', [ids.arma]), table).toBe(0);
        }
        expect(
          await tx.exec(`update office.projects set name = 'Taken' where id = $1`, [ids.projectA]),
        ).toBe(0);
        expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA])).toBe(0);
        const refused: [string, unknown[]][] = [
          [`insert into office.projects (company_id, name) values ($1, 'In Arma DX')`, [ids.arma]],
          [ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]],
          [ADD_MEMBER, [ids.arma, ids.projectA, context.userId]],
          [`insert into office.customers (company_id, name) values ($1, 'In Arma DX')`, [ids.arma]],
        ];
        for (const [sql, values] of refused) {
          expect((await tx.expectError(sql, values)).code, sql).toBe('42501');
        }
        // A project of the own company cannot take a customer of the other one.
        expect(
          (
            await tx.expectError('update office.projects set customer_id = $2 where id = $1', [
              ids.projectP,
              ids.customerA,
            ])
          ).code,
        ).toBe('23503');
      }
      // Nothing changed for Arma DX.
      await tx.setContext(founderA);
      expect(await tx.count('projects')).toBe(3);
      expect(await memberIds(tx, ids.projectA)).toEqual([ids.employeeA]);
    });
  });

  it('projects: without a context nothing is read and nothing is written', async () => {
    await inTransaction(async (tx) => {
      const nobody: ContextInput[] = [{}, { userId: ids.founder }, { companyId: ids.arma }];
      for (const context of nobody) {
        await tx.setContext(context);
        for (const table of ['projects', 'project_members', 'customers']) {
          expect(await tx.count(table), table).toBe(0);
        }
        expect(
          await tx.exec(`update office.projects set name = 'Taken' where id = $1`, [ids.projectA]),
        ).toBe(0);
        expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA])).toBe(0);
        const refused: [string, unknown[]][] = [
          [`insert into office.projects (company_id, name) values ($1, 'Nobody')`, [ids.arma]],
          [ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]],
        ];
        for (const [sql, values] of refused) {
          expect((await tx.expectError(sql, values)).code, sql).toBe('42501');
        }
      }
    });
  });
});
