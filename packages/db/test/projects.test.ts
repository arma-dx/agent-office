import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { ids } from './fixtures.ts';
import { closePools, inAdminTransaction, noDatabase, type Tx } from './helpers.ts';

// The Projects section, step 1 (8 October decisions 14 to 22; docs/SONRA.md P-a to P-j, W-i): the
// fields of a project, who opens and changes one, who its members are, and who sets the AI
// permission of a project and the contract permissions of a customer. Every rule here is the
// database's own; the API and the panel only ask.

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);

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
