import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PROJECT_COLORS, PROJECT_ICONS, PROJECT_STATUSES } from '@agent-office/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { FOUNDER_PASSKEY, ids } from './fixtures.ts';
import {
  adminQuery,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { createChallenge, openTestSession, stepUp } from './step-up.ts';

// The Projects section, step 1 (8 October decisions 14 to 22; docs/SONRA.md P-a to P-j, W-i): the
// fields of a project, who opens and changes one, who its members are, and who sets the AI
// permission of a project and the contract permissions of a customer. And part 1b (8 October
// decision 44): the owner, the managers and the plain members of a project, who adds, removes and
// gives roles. Every rule here is the database's own; the API and the panel only ask.

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
// A plain member of projectA and of projectANoAi (neither has an owner in the fixtures).
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
// An employee of Arma DX who is a member of no project.
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
const founderSpace: ContextInput = { companyId: ids.founderSpace, userId: ids.founder };
// A third employee of Arma DX (also works at the other company); a member of no project.
const sharedA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };

const ADD_MEMBER =
  'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)';
const REMOVE_MEMBER = 'delete from office.project_members where project_id = $1 and user_id = $2';

const SET_ROLE = 'select office.set_project_member_role($1, $2, $3) as changed';

const SET_AI = 'select office.set_project_ai_permission($1, $2, $3) as changed';
const SET_CUSTOMER = 'select office.set_customer_permissions($1, $2, $3)';

/** Calls the permission function of a project; `customer` is the customer the founder saw. */
async function setAi(
  tx: Tx,
  projectId: string,
  allowed: boolean,
  customer: string | null = null,
): Promise<boolean> {
  const [row] = await tx.rows<{ changed: boolean }>(SET_AI, [projectId, allowed, customer]);
  if (!row) {
    throw new Error('set_project_ai_permission returned no row');
  }
  return row.changed;
}

async function aiAllowed(tx: Tx, projectId: string): Promise<boolean | undefined> {
  const [row] = await tx.rows<{ ai_allowed: boolean }>(
    'select ai_allowed from office.projects where id = $1',
    [projectId],
  );
  return row?.ai_allowed;
}

async function used(tx: Tx, stepUpId: string): Promise<boolean | undefined> {
  const [row] = await tx.rows<{ used: boolean }>(
    'select consumed_at is not null as used from office.step_ups where id = $1',
    [stepUpId],
  );
  return row?.used;
}

/** How many projects an agent run of that person reads with the project in its context. */
async function agentReads(tx: Tx, userId: string, projectId: string): Promise<number> {
  await tx.setContext({ companyId: ids.arma, userId, agentCode: 'KOR-1', projectId });
  return tx.count('projects');
}

async function memberIds(tx: Tx, projectId: string): Promise<string[]> {
  const rows = await tx.rows<{ user_id: string }>(
    'select user_id from office.project_members where project_id = $1 order by user_id',
    [projectId],
  );
  return rows.map((row) => row.user_id);
}

/** The role of every member of a project, as the context reads them. */
async function memberRoles(tx: Tx, projectId: string): Promise<Record<string, string>> {
  const rows = await tx.rows<{ user_id: string; role: string }>(
    'select user_id, role from office.project_members where project_id = $1',
    [projectId],
  );
  return Object.fromEntries(rows.map((row) => [row.user_id, row.role]));
}

/** Calls the role function with the context as it is; returns whether anything changed. */
async function setRole(tx: Tx, projectId: string, userId: string, role: string): Promise<boolean> {
  const [row] = await tx.rows<{ changed: boolean }>(SET_ROLE, [projectId, userId, role]);
  if (!row) {
    throw new Error('set_project_member_role returned no row');
  }
  return row.changed;
}

/**
 * Gives a member a role as the founder of Arma DX, through the database's function: the only way
 * a role is given (8 October decision 44). Leaves the founder's context set.
 */
async function giveRole(tx: Tx, projectId: string, userId: string, role: string): Promise<boolean> {
  await tx.setContext(founderA);
  return setRole(tx, projectId, userId, role);
}

/**
 * projectA with one person in each role: employeeA (its member in the fixtures) the owner,
 * approverA a manager, sharedEmployee a plain member. Leaves the founder's context set.
 */
async function projectWithRoles(tx: Tx): Promise<void> {
  await tx.setContext(founderA);
  await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]);
  await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
  await giveRole(tx, ids.projectA, ids.employeeA, 'owner');
  await giveRole(tx, ids.projectA, ids.approverA, 'manager');
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

  it('projects: the database accepts exactly the statuses, colours and icons of the shared contract', async () => {
    await inAdminTransaction(async (tx) => {
      const sets: [string, readonly string[], string[]][] = [
        ['status', PROJECT_STATUSES, ['open', 'closed', 'done']],
        ['color', PROJECT_COLORS, ['grey', 'yellow']],
        ['icon', PROJECT_ICONS, ['rocket', 'star']],
      ];
      for (const [column, accepted, refused] of sets) {
        for (const value of accepted) {
          await adminProject(tx, { [column]: value });
        }
        for (const value of refused) {
          expect(
            (
              await tx.expectError(
                `insert into office.projects (company_id, name, ${column}) values ($1, 'x', $2)`,
                [ids.arma, value],
              )
            ).code,
            `${column} ${value}`,
          ).toBe('23514');
        }
        // And nothing the contract does not know: the check lists the same number of values.
        const [row] = await tx.rows<{ definition: string }>(
          `select pg_catalog.pg_get_constraintdef(c.oid) as definition
           from pg_catalog.pg_constraint c
           where c.conrelid = 'office.projects'::regclass and c.conname = $1`,
          [`projects_${column}_check`],
        );
        expect(row?.definition.match(/'[a-z_]+'/g)?.map((quoted) => quoted.slice(1, -1))).toEqual([
          ...accepted,
        ]);
      }
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

  it('project members: the owner and a manager add a founder or an employee of the company; a plain member adds nobody', async () => {
    await inTransaction(async (tx) => {
      // The fixture's member of projectA is a plain member: decision 44 gives them no say.
      await tx.setContext(employeeA);
      expect(await memberRoles(tx, ids.projectA)).toEqual({ [ids.employeeA]: 'member' });
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).code).toBe(
        '42501',
      );
      expect(await memberIds(tx, ids.projectA)).toEqual([ids.employeeA]);

      // The owner adds; who is added is a plain member.
      await giveRole(tx, ids.projectA, ids.employeeA, 'owner');
      await tx.setContext(employeeA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).toBe(1);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.founder]: 'member',
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'member',
      });

      // A manager adds too.
      await giveRole(tx, ids.projectA, ids.approverA, 'manager');
      await tx.setContext(approverA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee])).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.founder]: 'member',
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'member',
      });

      // A membership is added and removed, never rewritten: not the person, not the role.
      for (const context of [employeeA, approverA, founderA]) {
        await tx.setContext(context);
        expect(
          (
            await tx.expectError(
              'update office.project_members set user_id = $2 where project_id = $1',
              [ids.projectA, ids.approverA],
            )
          ).code,
        ).toBe('42501');
        expect(
          (
            await tx.expectError(
              `update office.project_members set role = 'owner'
               where project_id = $1 and user_id = $2`,
              [ids.projectA, ids.sharedEmployee],
            )
          ).code,
        ).toBe('42501');
      }
    });
  });

  it('project members: a plain member cannot remove or add', async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      const before = await memberRoles(tx, ids.projectA);
      expect(before).toEqual({
        [ids.founder]: 'member',
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'member',
      });

      await tx.setContext(sharedA);
      // Another plain member, a manager, the owner, themselves: no row leaves.
      for (const target of [ids.founder, ids.approverA, ids.employeeA, ids.sharedEmployee]) {
        expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, target]), target).toBe(0);
      }
      // "Everybody of the project" removes nobody either.
      expect(
        await tx.exec('delete from office.project_members where project_id = $1', [ids.projectA]),
      ).toBe(0);
      // Adding is refused whoever is named: a colleague, an external person, a member.
      for (const person of [ids.externalA, ids.formerEmployee]) {
        expect(
          (await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, person])).code,
          person,
        ).toBe('42501');
      }
      expect(
        (
          await tx.expectError(`${ADD_MEMBER} on conflict (project_id, user_id) do nothing`, [
            ids.arma,
            ids.projectA,
            ids.founder,
          ])
        ).code,
      ).toBe('42501');
      expect(await memberRoles(tx, ids.projectA)).toEqual(before);
    });
  });

  it('project members: a manager removes plain members only: not a manager, not the owner, not themselves', async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      await giveRole(tx, ids.projectA, ids.sharedEmployee, 'manager');

      await tx.setContext(approverA);
      // The owner, the other manager and themselves stay.
      for (const target of [ids.employeeA, ids.sharedEmployee, ids.approverA]) {
        expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, target]), target).toBe(0);
      }
      // A plain member leaves.
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.founder])).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'manager',
      });
      // "Everybody of the project" takes the plain members and nobody else.
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1', [ids.projectA]),
      ).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'manager',
      });
    });
  });

  it('project members: the owner removes managers and members and is never removed, by a manager, by the founder or by themselves', async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      // The owner's row stays, whoever asks.
      for (const context of [approverA, founderA, employeeA, sharedA]) {
        await tx.setContext(context);
        expect(
          await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA]),
          String(context.userId),
        ).toBe(0);
      }
      await tx.setContext(founderA);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1 and role = $2', [
          ids.projectA,
          'owner',
        ]),
      ).toBe(0);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'member',
      });

      // The owner removes a manager and a plain member.
      await tx.setContext(employeeA);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.approverA])).toBe(1);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.sharedEmployee])).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({ [ids.employeeA]: 'owner' });

      // The founder removes a manager too, member of the project or not.
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).toBe(1);
      await giveRole(tx, ids.projectA, ids.approverA, 'manager');
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.approverA])).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({ [ids.employeeA]: 'owner' });
    });
  });

  it('project members: an external person is refused and a person outside the company too', async () => {
    await inTransaction(async (tx) => {
      await giveRole(tx, ids.projectA, ids.employeeA, 'owner');
      // The owner and the founder may add, so they are told why these two cannot be added.
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

  it('project members: a deactivated account is not added, by the owner, the founder or the privileged role', async () => {
    await inTransaction(async (tx) => {
      await giveRole(tx, ids.projectA, ids.employeeA, 'owner');
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

  it('project members: an employee does not remove themselves, whatever their role; the founder may unless the founder is the owner', async () => {
    await inTransaction(async (tx) => {
      // A plain member, a manager, the owner: nobody loses sight of a project by a slip.
      for (const role of ['member', 'manager', 'owner']) {
        if (role !== 'member') {
          await giveRole(tx, ids.projectA, ids.employeeA, role);
        }
        await tx.setContext(employeeA);
        expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA]), role).toBe(0);
        expect(await memberRoles(tx, ids.projectA), role).toEqual({ [ids.employeeA]: role });
      }
    });
    await inTransaction(async (tx) => {
      await giveRole(tx, ids.projectA, ids.employeeA, 'manager');
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
    await inTransaction(async (tx) => {
      // The founder who owns the project is its owner like anybody else: handed over first.
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.founder])).toBe(1);
      await giveRole(tx, ids.projectA, ids.founder, 'owner');
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.founder])).toBe(0);
      await giveRole(tx, ids.projectA, ids.employeeA, 'owner');
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.founder])).toBe(1);
      expect(await memberRoles(tx, ids.projectA)).toEqual({ [ids.employeeA]: 'owner' });
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
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee])).toBe(1);
      await giveRole(tx, ids.projectA, ids.employeeA, 'owner');
      // A colleague who is no member of the project, and a plain member of it.
      for (const context of [approverA, sharedA]) {
        await tx.setContext(context);
        // An external person of the own company: the refusal does not say so.
        expect(
          (await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA])).code,
          String(context.userId),
        ).toBe('42501');
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
      }
      // The owner, who may add, is told why; a manager too.
      await tx.setContext(employeeA);
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA])).code).toBe(
        '23514',
      );
      await giveRole(tx, ids.projectA, ids.sharedEmployee, 'manager');
      await tx.setContext(sharedA);
      expect((await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA])).code).toBe(
        '23514',
      );
    });
  });
});

describe.skipIf(noDatabase)('project roles', () => {
  afterAll(closePools);

  it('project roles: the owner and the founder appoint and dismiss a manager; nobody else does', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA])).toBe(1);
      expect(await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee])).toBe(1);
      await giveRole(tx, ids.projectA, ids.employeeA, 'owner');

      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect(
          await setRole(tx, ids.projectA, ids.approverA, 'manager'),
          String(context.userId),
        ).toBe(true);
        // Asking for the role the member has changes nothing.
        expect(await setRole(tx, ids.projectA, ids.approverA, 'manager')).toBe(false);
        expect(await memberRoles(tx, ids.projectA)).toEqual({
          [ids.employeeA]: 'owner',
          [ids.approverA]: 'manager',
          [ids.sharedEmployee]: 'member',
        });
        expect(await setRole(tx, ids.projectA, ids.approverA, 'member')).toBe(true);
        expect(await setRole(tx, ids.projectA, ids.approverA, 'member')).toBe(false);
        expect(await memberRoles(tx, ids.projectA)).toEqual({
          [ids.employeeA]: 'owner',
          [ids.approverA]: 'member',
          [ids.sharedEmployee]: 'member',
        });
      }

      // A manager and a plain member give no role: not to another, not to themselves.
      await giveRole(tx, ids.projectA, ids.approverA, 'manager');
      const refused: [ContextInput, string, string][] = [
        [approverA, ids.sharedEmployee, 'manager'],
        [approverA, ids.approverA, 'member'],
        [approverA, ids.approverA, 'owner'],
        [approverA, ids.employeeA, 'member'],
        [sharedA, ids.sharedEmployee, 'manager'],
        [sharedA, ids.sharedEmployee, 'owner'],
        [sharedA, ids.approverA, 'member'],
        // An external person, an agent run in the owner's and in the founder's name, nobody.
        [externalA, ids.approverA, 'member'],
        [{ ...employeeA, agentCode: 'KOR-1' }, ids.approverA, 'member'],
        [{ ...founderA, agentCode: 'KOR-1', projectId: ids.projectA }, ids.approverA, 'member'],
        [{}, ids.approverA, 'member'],
        [{ companyId: ids.arma }, ids.approverA, 'member'],
      ];
      for (const [context, person, role] of refused) {
        await tx.setContext(context);
        expect(
          (await tx.expectError(SET_ROLE, [ids.projectA, person, role])).code,
          `${JSON.stringify(context)} ${person} ${role}`,
        ).toBe('42501');
      }
      // Somebody who cannot read the project is told that there is no such member: an employee
      // who is no member of it, and the founder from the context of the other company.
      await tx.setContext(approverA);
      expect(
        (await tx.expectError(SET_ROLE, [ids.projectANoAi, ids.employeeA, 'manager'])).code,
      ).toBe('P0002');
      await tx.setContext(founderP);
      expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.approverA, 'member'])).code).toBe(
        'P0002',
      );
      // For the owner and the founder: a person who is no member, a role that does not exist.
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.founder, 'manager'])).code).toBe(
          'P0002',
        );
        expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.approverA, 'admin'])).code).toBe(
          '22023',
        );
        expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.approverA, null])).code).toBe(
          '22023',
        );
      }
      // Nothing of all that changed a role.
      await tx.setContext(founderA);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'member',
      });
    });
    // The worker's role cannot call the function at all, in the founder's or the owner's name.
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, employeeA, { ...founderA, agentCode: 'KOR-1' }]) {
        await tx.setContext(context);
        expect(
          (await tx.expectError(SET_ROLE, [ids.projectA, ids.employeeA, 'manager'])).code,
        ).toBe('42501');
      }
    });
  });

  it("project roles: the ownership is handed over by the owner or the founder to a member; the former owner becomes a plain member; the owner's own role does not change", async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      // The owner's own role is never changed directly, by the owner or by the founder.
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        for (const role of ['member', 'manager']) {
          expect(
            (await tx.expectError(SET_ROLE, [ids.projectA, ids.employeeA, role])).code,
            role,
          ).toBe('55000');
        }
        // The role the owner has: nothing to do.
        expect(await setRole(tx, ids.projectA, ids.employeeA, 'owner')).toBe(false);
      }

      // The owner hands over to a manager: one owner, and the former owner is a plain member.
      await tx.setContext(employeeA);
      expect(await setRole(tx, ids.projectA, ids.approverA, 'owner')).toBe(true);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'member',
        [ids.approverA]: 'owner',
        [ids.sharedEmployee]: 'member',
      });
      // The former owner has no say any more.
      expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.employeeA, 'owner'])).code).toBe(
        '42501',
      );
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.sharedEmployee])).toBe(0);

      // The founder, who is no member, hands over to a plain member.
      await tx.setContext(founderA);
      expect(await setRole(tx, ids.projectA, ids.sharedEmployee, 'owner')).toBe(true);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'member',
        [ids.approverA]: 'member',
        [ids.sharedEmployee]: 'owner',
      });
      // Not to somebody who is no member of the project.
      expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.founder, 'owner'])).code).toBe(
        'P0002',
      );
    });
    // One owner at most, also for a write by hand with the privileged role.
    await inAdminTransaction(async (tx) => {
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]);
      await tx.exec(
        `update office.project_members set role = 'owner' where project_id = $1 and user_id = $2`,
        [ids.projectA, ids.employeeA],
      );
      expect(
        (
          await tx.expectError(
            `update office.project_members set role = 'owner'
             where project_id = $1 and user_id = $2`,
            [ids.projectA, ids.approverA],
          )
        ).code,
      ).toBe('23505');
      // And only the three roles.
      expect(
        (
          await tx.expectError(
            `update office.project_members set role = 'admin'
             where project_id = $1 and user_id = $2`,
            [ids.projectA, ids.approverA],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('project roles: a deactivated account is given no role and can be dismissed', async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      expect(
        await tx.exec('update office.users set active = false where id = $1', [ids.approverA]),
      ).toBe(1);
      const roles = (approver: string) => ({
        [ids.employeeA]: 'owner',
        [ids.approverA]: approver,
        [ids.sharedEmployee]: 'member',
      });
      // A deactivated manager is not made the owner, by the owner or by the founder; the owner
      // until now keeps the role.
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET_ROLE, [ids.projectA, ids.approverA, 'owner'])).code).toBe(
          '23514',
        );
        expect(await memberRoles(tx, ids.projectA)).toEqual(roles('manager'));
      }
      // The deactivated manager is dismissed.
      await tx.setContext(employeeA);
      expect(await setRole(tx, ids.projectA, ids.approverA, 'member')).toBe(true);
      // A deactivated plain member is given no role at all.
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        for (const role of ['manager', 'owner']) {
          expect(
            (await tx.expectError(SET_ROLE, [ids.projectA, ids.approverA, role])).code,
            role,
          ).toBe('23514');
        }
        expect(await memberRoles(tx, ids.projectA)).toEqual(roles('member'));
      }
      // And is removed like any plain member.
      await tx.setContext(employeeA);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.approverA])).toBe(1);
    });
  });

  it('project roles: the opener of a project is its owner; a project whose owner becomes external or leaves the company has none, and the founder names one', async () => {
    const turnExternal = `update office.memberships set role = 'external'
       where company_id = $1 and user_id = $2`;
    const leave = 'delete from office.memberships where company_id = $1 and user_id = $2';
    for (const change of [turnExternal, leave]) {
      await inTransaction(async (tx) => {
        await tx.setContext(sharedA);
        const id = randomUUID();
        await tx.exec(`insert into office.projects (id, company_id, name) values ($1, $2, 'Own')`, [
          id,
          ids.arma,
        ]);
        expect(await memberRoles(tx, id)).toEqual({ [ids.sharedEmployee]: 'owner' });
        // The opener acts as the owner at once: adds a member and makes them a manager.
        expect(await tx.exec(ADD_MEMBER, [ids.arma, id, ids.approverA])).toBe(1);
        expect(await setRole(tx, id, ids.approverA, 'manager')).toBe(true);

        // The company-level act is not held back by the project (docs/SONRA.md P1b-h).
        await stepUp(tx, founderA, 'membership_change', ids.sharedEmployee);
        expect(await tx.exec(change, [ids.arma, ids.sharedEmployee]), change).toBe(1);
        expect(await memberRoles(tx, id)).toEqual({ [ids.approverA]: 'manager' });
        // Nobody of the project can take the ownership.
        await tx.setContext(approverA);
        expect((await tx.expectError(SET_ROLE, [id, ids.approverA, 'owner'])).code).toBe('42501');
        // The founder names the owner.
        await tx.setContext(founderA);
        expect(await setRole(tx, id, ids.approverA, 'owner')).toBe(true);
        expect(await memberRoles(tx, id)).toEqual({ [ids.approverA]: 'owner' });
      });
    }
    // A project written without a person in the context has no member and no owner.
    await inAdminTransaction(async (tx) => {
      await tx.setContext({});
      const id = await adminProject(tx);
      expect(await memberRoles(tx, id)).toEqual({});
    });
  });

  it("project roles: the API's role writes no role by a statement", async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      for (const context of [founderA, employeeA, approverA, sharedA]) {
        await tx.setContext(context);
        const refused: [string, unknown[]][] = [
          [
            `insert into office.project_members (company_id, project_id, user_id, role)
             values ($1, $2, $3, 'manager')`,
            [ids.arma, ids.projectA, ids.founder],
          ],
          [
            `insert into office.project_members (company_id, project_id, user_id, role)
             values ($1, $2, $3, 'member')`,
            [ids.arma, ids.projectA, ids.founder],
          ],
          [
            `update office.project_members set role = 'manager'
             where project_id = $1 and user_id = $2`,
            [ids.projectA, ids.sharedEmployee],
          ],
          [
            `${ADD_MEMBER} on conflict (project_id, user_id) do update set role = 'owner'`,
            [ids.arma, ids.projectA, ids.sharedEmployee],
          ],
        ];
        for (const [sql, values] of refused) {
          expect((await tx.expectError(sql, values)).code, `${String(context.userId)} ${sql}`).toBe(
            '42501',
          );
        }
      }
      expect(
        await tx.rows(
          `select has_column_privilege('office.project_members', 'role', 'insert') as inserts,
                  has_column_privilege('office.project_members', 'role', 'update') as updates,
                  has_column_privilege('office.project_members', 'user_id', 'insert') as adds`,
        ),
      ).toEqual([{ inserts: false, updates: false, adds: true }]);
      await tx.setContext(founderA);
      expect(await memberRoles(tx, ids.projectA)).toEqual({
        [ids.employeeA]: 'owner',
        [ids.approverA]: 'manager',
        [ids.sharedEmployee]: 'member',
      });
    });
  });
});

describe.skipIf(noDatabase)('projects between companies', () => {
  afterAll(closePools);

  it("projects: with a Pillika context nothing of Arma DX's projects, members and customers is read or changed, and no member of an Arma DX project is added, removed or given a role", async () => {
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
        // For this context the project has no members: nobody is given a role in it.
        for (const role of ['manager', 'owner']) {
          expect(
            (await tx.expectError(SET_ROLE, [ids.projectA, ids.employeeA, role])).code,
            role,
          ).toBe('P0002');
        }
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
        const own = randomUUID();
        await tx.exec(`insert into office.projects (id, company_id, name) values ($1, $2, 'Own')`, [
          own,
          ids.pillika,
        ]);
        expect(
          (
            await tx.expectError('update office.projects set customer_id = $2 where id = $1', [
              own,
              ids.customerA,
            ])
          ).code,
        ).toBe('23503');
      }
      // Nothing changed for Arma DX.
      await tx.setContext(founderA);
      expect(await tx.count('projects')).toBe(3);
      expect(await memberRoles(tx, ids.projectA)).toEqual({ [ids.employeeA]: 'member' });
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
          [SET_ROLE, [ids.projectA, ids.employeeA, 'manager']],
        ];
        for (const [sql, values] of refused) {
          expect((await tx.expectError(sql, values)).code, sql).toBe('42501');
        }
      }
    });
  });
});

describe.skipIf(noDatabase)('the AI permission of a project', () => {
  afterAll(closePools);

  it('AI permission: no plain update changes it, for the founder, a member or the worker', async () => {
    const on = 'update office.projects set ai_allowed = true where id = $1';
    const off = 'update office.projects set ai_allowed = false where id = $1';
    await inTransaction(async (tx) => {
      for (const context of [founderA, employeeA]) {
        await tx.setContext(context);
        expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('42501');
        expect((await tx.expectError(off, [ids.projectA])).code).toBe('42501');
      }
      // A passkey does not turn the plain statement into a path.
      await stepUp(tx, founderA, 'project_ai_permission', ids.projectANoAi);
      expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('42501');
    });
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1' }]) {
        await tx.setContext(context);
        expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('42501');
        expect((await tx.expectError(off, [ids.projectA])).code).toBe('42501');
      }
    });
    // The guard fires on every update of a project, not only on one that names the column: a
    // value another trigger changed on the way is held to the same rule.
    expect(
      await adminQuery(
        `select t.tgattr::text as columns, t.tgtype & 2 = 2 as before
         from pg_catalog.pg_trigger t
         where t.tgrelid = 'office.projects'::regclass and t.tgname = 'guard_ai_permission'`,
      ),
    ).toEqual([{ columns: '', before: true }]);
  });

  it('AI permission: an employee cannot change it through the function, member or not, on or off', async () => {
    await inTransaction(async (tx) => {
      for (const context of [employeeA, approverA]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, null])).code).toBe('42501');
        expect((await tx.expectError(SET_AI, [ids.projectA, false, null])).code).toBe('42501');
      }
      // Not with a passkey of their own either.
      await stepUp(tx, employeeA, 'project_ai_permission', ids.projectANoAi);
      expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, null])).code).toBe('42501');
      // And the founder cannot ride on the employee's re-verification.
      await tx.setContext(founderA);
      expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, null])).code).toBe('28000');
      expect(await aiAllowed(tx, ids.projectANoAi)).toBe(false);
    });
  });

  it("AI permission: the worker's role cannot call the function, as a person or as an agent run", async () => {
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1' }]) {
        await tx.setContext(context);
        expect((await tx.expectError(SET_AI, [ids.projectA, false, null])).code).toBe('42501');
        expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, null])).code).toBe('42501');
        expect((await tx.expectError(SET_CUSTOMER, [ids.customerA, false, false])).code).toBe(
          '42501',
        );
      }
    });
    // An agent run on the API's connection is refused by the function itself.
    await inTransaction(async (tx) => {
      await tx.setContext({ ...founderA, agentCode: 'KOR-1' });
      expect((await tx.expectError(SET_AI, [ids.projectA, false, null])).code).toBe('42501');
      expect((await tx.expectError(SET_CUSTOMER, [ids.customerA, false, false])).code).toBe(
        '42501',
      );
    });
  });

  it('AI permission: the founder opens it only with a re-verification for this project', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const open = [ids.projectANoAi, true, null];
      expect((await tx.expectError(SET_AI, open)).code).toBe('28000');
      const wrong = [
        await stepUp(tx, founderA, 'project_ai_permission', ids.projectACustomerNoAi),
        await stepUp(tx, founderA, 'customer_ai_permission', ids.projectANoAi),
        await stepUp(tx, founderA, 'membership_change', ids.projectANoAi),
      ];
      // The same project id, confirmed in the other company.
      const elsewhere = await stepUp(tx, founderP, 'project_ai_permission', ids.projectANoAi);
      expect(await used(tx, elsewhere)).toBe(false);
      await tx.setContext(founderA);
      expect((await tx.expectError(SET_AI, open)).code).toBe('28000');
      expect(await aiAllowed(tx, ids.projectANoAi)).toBe(false);

      const right = await stepUp(tx, founderA, 'project_ai_permission', ids.projectANoAi);
      expect(await setAi(tx, ids.projectANoAi, true)).toBe(true);
      expect(await aiAllowed(tx, ids.projectANoAi)).toBe(true);
      expect(await used(tx, right)).toBe(true);
      for (const id of wrong) {
        expect(await used(tx, id)).toBe(false);
      }
      await tx.setContext(founderP);
      expect(await used(tx, elsewhere)).toBe(false);
      await tx.setContext(founderA);

      // Used once: after a close the next opening needs a new one.
      expect(await setAi(tx, ids.projectANoAi, false)).toBe(true);
      expect((await tx.expectError(SET_AI, open)).code).toBe('28000');
      expect(await aiAllowed(tx, ids.projectANoAi)).toBe(false);
    });
  });

  it('AI permission: the founder closes it without a passkey; the value it already has changes nothing and uses nothing up', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await setAi(tx, ids.projectANoAi, false)).toBe(false);
      const unused = await stepUp(tx, founderA, 'project_ai_permission', ids.projectA);
      // Open already: nothing changes, whatever customer is named, and the passkey stays unused.
      expect(await setAi(tx, ids.projectA, true, ids.customerA)).toBe(false);
      expect(await setAi(tx, ids.projectA, true, null)).toBe(false);
      expect(await used(tx, unused)).toBe(false);
      expect(await setAi(tx, ids.projectA, false)).toBe(true);
      expect(await aiAllowed(tx, ids.projectA)).toBe(false);
      expect(await used(tx, unused)).toBe(false);
      // Malformed calls.
      expect((await tx.expectError(SET_AI, [null, true, null])).code).toBe('22023');
      expect((await tx.expectError(SET_AI, [ids.projectA, null, null])).code).toBe('22023');
      expect((await tx.expectError(SET_AI, [randomUUID(), true, null])).code).toBe('P0002');
    });
  });

  it('AI permission: the opening is for the customer the founder saw; a changed customer refuses it and uses nothing up', async () => {
    await inTransaction(async (tx) => {
      // The founder looks at a project without a customer and confirms with the passkey.
      const confirmed = await stepUp(tx, founderA, 'project_ai_permission', ids.projectANoAi);
      // A member changes the customer before the opening arrives.
      await tx.setContext(employeeA);
      expect(
        await tx.exec('update office.projects set customer_id = $2 where id = $1', [
          ids.projectANoAi,
          ids.customerANoAi,
        ]),
      ).toBe(1);
      await tx.setContext(founderA);
      expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, null])).code).toBe('55000');
      expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, ids.customerA])).code).toBe(
        '55000',
      );
      expect(await aiAllowed(tx, ids.projectANoAi)).toBe(false);
      expect(await used(tx, confirmed)).toBe(false);
      // The unused confirmation opens no other project.
      const other = randomUUID();
      await tx.exec(`insert into office.projects (id, company_id, name) values ($1, $2, 'Other')`, [
        other,
        ids.arma,
      ]);
      expect((await tx.expectError(SET_AI, [other, true, null])).code).toBe('28000');
      // And no customer.
      expect((await tx.expectError(SET_CUSTOMER, [ids.customerANoAi, true, null])).code).toBe(
        '28000',
      );
      expect(await used(tx, confirmed)).toBe(false);
      // Once the project has the customer the founder saw again, the same opening passes.
      await tx.setContext(employeeA);
      await tx.exec('update office.projects set customer_id = null where id = $1', [
        ids.projectANoAi,
      ]);
      await tx.setContext(founderA);
      expect(await setAi(tx, ids.projectANoAi, true, null)).toBe(true);
      expect(await used(tx, confirmed)).toBe(true);
    });
  });

  it('AI permission: the privileged role with a person in the context is held to the same rule', async () => {
    const on = 'update office.projects set ai_allowed = true where id = $1';
    await inAdminTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('42501');
      await tx.setContext({ ...founderA, agentCode: 'KOR-1' });
      expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('42501');
      await tx.setContext(founderP);
      expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('42501');
      await tx.setContext(founderA);
      expect((await tx.expectError(on, [ids.projectANoAi])).code).toBe('28000');
      // Closing needs the founder, not a passkey.
      await tx.setContext(employeeA);
      expect(
        (
          await tx.expectError('update office.projects set ai_allowed = false where id = $1', [
            ids.projectA,
          ])
        ).code,
      ).toBe('42501');
      // An administrator, without a person in the context.
      await tx.setContext({});
      expect(await tx.exec(on, [ids.projectANoAi])).toBe(1);
      expect(await aiAllowed(tx, ids.projectANoAi)).toBe(true);
    });
  });

  // The row policy is the same for the API's and the worker's role (it is written for office_app);
  // the run's context is set on the one connection that can also make the founder's change.
  it('AI permission: what an agent run sees follows the value', async () => {
    await inTransaction(async (tx) => {
      expect(await agentReads(tx, ids.employeeA, ids.projectA)).toBe(1);
      await tx.setContext(founderA);
      expect(await setAi(tx, ids.projectA, false)).toBe(true);
      expect(await agentReads(tx, ids.employeeA, ids.projectA)).toBe(0);
      expect(await agentReads(tx, ids.founder, ids.projectA)).toBe(0);
      await stepUp(tx, founderA, 'project_ai_permission', ids.projectA);
      expect(await setAi(tx, ids.projectA, true, ids.customerA)).toBe(true);
      expect(await agentReads(tx, ids.employeeA, ids.projectA)).toBe(1);
    });
  });

  it('projects: the customer does not change while the AI permission is open, for a member and for the founder; it changes while the permission is closed, and for a write without a person in the context', async () => {
    const change = 'update office.projects set customer_id = $2 where id = $1';
    await inTransaction(async (tx) => {
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect((await tx.expectError(change, [ids.projectA, ids.customerANoAi])).code).toBe(
          '23514',
        );
        expect((await tx.expectError(change, [ids.projectA, null])).code).toBe('23514');
        // The customer it has is no change.
        expect(await tx.exec(change, [ids.projectA, ids.customerA])).toBe(1);
        // The other fields are free.
        expect(
          await tx.exec(`update office.projects set name = 'Renamed' where id = $1`, [
            ids.projectA,
          ]),
        ).toBe(1);
      }
      // A project whose permission is closed.
      await tx.setContext(employeeA);
      expect(await tx.exec(change, [ids.projectANoAi, ids.customerA])).toBe(1);
      // After the founder closed the permission.
      await tx.setContext(founderA);
      expect(await setAi(tx, ids.projectA, false)).toBe(true);
      await tx.setContext(employeeA);
      expect(await tx.exec(change, [ids.projectA, ids.customerANoAi])).toBe(1);
    });
    await inAdminTransaction(async (tx) => {
      expect(await tx.exec(change, [ids.projectA, ids.customerANoAi])).toBe(1);
      // The privileged role with a person in the context is refused like everybody.
      await tx.setContext(founderA);
      expect((await tx.expectError(change, [ids.projectA, ids.customerA])).code).toBe('23514');
    });
  });

  // The run's context is set on the API's connection: the row policy is the same for both roles.
  it("rule 12: nobody makes agents work in a project whose customer's contract forbids AI by changing its customer", async () => {
    const change = 'update office.projects set customer_id = $2 where id = $1';
    await inTransaction(async (tx) => {
      // The fixtures give this project an open permission and a customer without one.
      await tx.setContext(founderA);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectACustomerNoAi, ids.employeeA]);
      expect(await agentReads(tx, ids.employeeA, ids.projectACustomerNoAi)).toBe(0);
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect((await tx.expectError(change, [ids.projectACustomerNoAi, null])).code).toBe('23514');
        expect((await tx.expectError(change, [ids.projectACustomerNoAi, ids.customerA])).code).toBe(
          '23514',
        );
      }
      expect(await agentReads(tx, ids.employeeA, ids.projectACustomerNoAi)).toBe(0);
      expect(await agentReads(tx, ids.founder, ids.projectACustomerNoAi)).toBe(0);

      // The other way round: the founder closes a customer's permission and its projects close
      // to agents at once.
      expect(await agentReads(tx, ids.employeeA, ids.projectA)).toBe(1);
      await tx.setContext(founderA);
      await tx.exec(SET_CUSTOMER, [ids.customerA, false, null]);
      expect(await agentReads(tx, ids.employeeA, ids.projectA)).toBe(0);
    });
  });

  it("AI permission: both functions know nothing of the other company's project and customer, and refuse without a context", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderP);
      expect((await tx.expectError(SET_AI, [ids.projectA, false, null])).code).toBe('P0002');
      expect((await tx.expectError(SET_AI, [ids.projectANoAi, true, null])).code).toBe('P0002');
      expect((await tx.expectError(SET_CUSTOMER, [ids.customerA, false, false])).code).toBe(
        'P0002',
      );
      await tx.setContext(employeeP);
      expect((await tx.expectError(SET_AI, [ids.projectA, false, null])).code).toBe('42501');
      expect((await tx.expectError(SET_CUSTOMER, [ids.customerA, false, false])).code).toBe(
        '42501',
      );
      const nobody: ContextInput[] = [{}, { userId: ids.founder }, { companyId: ids.arma }];
      for (const context of nobody) {
        await tx.setContext(context);
        expect((await tx.expectError(SET_AI, [ids.projectA, false, null])).code).toBe('42501');
        expect((await tx.expectError(SET_CUSTOMER, [ids.customerA, false, false])).code).toBe(
          '42501',
        );
      }
      await tx.setContext(founderA);
      expect(await aiAllowed(tx, ids.projectA)).toBe(true);
    });
  });
});

describe.skipIf(noDatabase)('customers of the Projects section', () => {
  afterAll(closePools);

  const customer = (tx: Tx, id: string) =>
    tx.rows(
      'select name, ai_allowed, automated_processing_allowed from office.customers where id = $1',
      [id],
    );

  it('customers: an employee adds a customer by name with both permissions closed', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(approverA);
      const id = randomUUID();
      expect(
        await tx.exec(
          `insert into office.customers (id, company_id, name) values ($1, $2, 'Gamma')`,
          [id, ids.arma],
        ),
      ).toBe(1);
      expect(await customer(tx, id)).toEqual([
        { name: 'Gamma', ai_allowed: false, automated_processing_allowed: false },
      ]);
      // An external person adds none.
      await tx.setContext(externalA);
      expect(
        (
          await tx.expectError(
            `insert into office.customers (company_id, name) values ($1, 'Delta')`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it('customers: none is added in the founder space', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderSpace);
      expect(
        (
          await tx.expectError(
            `insert into office.customers (company_id, name) values ($1, 'Private')`,
            [ids.founderSpace],
          )
        ).code,
      ).toBe('23514');
    });
  });

  it('customers: the application neither renames nor deletes a customer and sets no permission by a statement', async () => {
    await inTransaction(async (tx) => {
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        const refused: [string, unknown[]][] = [
          [`update office.customers set name = 'Renamed' where id = $1`, [ids.customerA]],
          ['delete from office.customers where id = $1', [ids.customerA]],
          [
            `insert into office.customers (company_id, name, ai_allowed) values ($1, 'New', true)`,
            [ids.arma],
          ],
          [
            `insert into office.customers (company_id, name, automated_processing_allowed)
             values ($1, 'New', false)`,
            [ids.arma],
          ],
          [
            `insert into office.customers (company_id, name, contacts) values ($1, 'New', '[]')`,
            [ids.arma],
          ],
          ['update office.customers set ai_allowed = true where id = $1', [ids.customerANoAi]],
          ['update office.customers set ai_allowed = false where id = $1', [ids.customerA]],
          [
            'update office.customers set automated_processing_allowed = true where id = $1',
            [ids.customerA],
          ],
        ];
        for (const [sql, values] of refused) {
          expect((await tx.expectError(sql, values)).code, sql).toBe('42501');
        }
      }
    });
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1' }]) {
        await tx.setContext(context);
        for (const sql of [
          `insert into office.customers (company_id, name) values ('${ids.arma}', 'By the worker')`,
          `insert into office.customers (id, company_id, name)
           values ('${randomUUID()}', '${ids.arma}', 'By the worker')`,
          `update office.customers set name = 'By the worker' where id = '${ids.customerA}'`,
          `delete from office.customers where id = '${ids.customerA}'`,
        ]) {
          expect((await tx.expectError(sql)).code, sql).toBe('42501');
        }
      }
    });
  });

  it('re-verification: the two new purposes name a company and a subject', async () => {
    await inTransaction(async (tx) => {
      const session = await openTestSession(tx, ids.founder);
      await tx.setContext(founderA);
      const record = async (purpose: string, company: string | null, subject: string | null) => {
        const hash = Buffer.alloc(32, 7);
        const challenge = await createChallenge(tx, session, 'step_up', hash);
        return [session.key, challenge, FOUNDER_PASSKEY, 0, purpose, company, subject, hash];
      };
      const RECORD = 'select office.record_step_up($1, $2, $3, $4, $5, $6, $7, $8) as id';
      for (const purpose of ['project_ai_permission', 'customer_ai_permission']) {
        const subject = randomUUID();
        expect(
          (await tx.expectError(RECORD, await record(purpose, null, subject))).code,
          purpose,
        ).toBe('22023');
        expect(
          (await tx.expectError(RECORD, await record(purpose, ids.arma, null))).code,
          purpose,
        ).toBe('22023');
        // Only in the context of that company.
        expect(
          (await tx.expectError(RECORD, await record(purpose, ids.pillika, subject))).code,
          purpose,
        ).toBe('42501');
        const [row] = await tx.rows<{ id: string }>(
          RECORD,
          await record(purpose, ids.arma, subject),
        );
        expect(
          await tx.rows(
            'select purpose, company_id, subject_id, consumed_at from office.step_ups where id = $1',
            [row?.id],
          ),
        ).toEqual([{ purpose, company_id: ids.arma, subject_id: subject, consumed_at: null }]);
      }
      expect(
        (await tx.expectError(RECORD, await record('project_delete', ids.arma, randomUUID()))).code,
      ).toBe('22023');
    });
  });
});
