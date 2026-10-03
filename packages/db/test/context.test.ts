import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { agentStep, contextSchema, withContext } from '../src/context.ts';
import { ids } from './fixtures.ts';
import { noDatabase } from './helpers.ts';
import { inject } from 'vitest';

describe('context schema', () => {
  it('rejects an invalid value and an unknown field', () => {
    expect(contextSchema.safeParse({ companyId: 'pillika' }).success).toBe(false);
    expect(contextSchema.safeParse({ agentCode: 'kor-1' }).success).toBe(false);
    expect(contextSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(contextSchema.safeParse({ companyCode: 'pillika' }).success).toBe(false);
    expect(contextSchema.parse({})).toEqual({
      companyId: null,
      userId: null,
      projectId: null,
      email: null,
      agentCode: null,
    });
  });
});

describe.skipIf(noDatabase)('withContext', () => {
  // Single-connection pool: to see on the same connection that the context does not stay on it.
  const pool = new pg.Pool({ connectionString: inject('database')?.app, max: 1 });
  afterAll(() => pool.end());

  async function taskCount(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from office.tasks');
    return rows[0]?.n ?? -1;
  }

  it('sets the context only for the duration of the transaction', async () => {
    const inside = await withContext(
      pool,
      { companyId: ids.pillika, userId: ids.founder },
      async (client) => {
        const { rows } = await client.query<{ n: number }>(
          'select count(*)::int as n from office.tasks',
        );
        return rows[0]?.n;
      },
    );
    expect(inside).toBe(2);
    expect(await taskCount()).toBe(0);
    const { rows } = await pool.query<{ s: string | null }>(
      "select current_setting('app.company_id', true) as s",
    );
    expect(rows[0]?.s ?? '').toBe('');
  });

  it('rolls back the writes on error and passes the error on', async () => {
    await expect(
      withContext(pool, { companyId: ids.arma, userId: ids.founder }, async (client) => {
        await client.query(
          `insert into office.tasks (company_id, title) values ($1, 'To be rolled back')`,
          [ids.arma],
        );
        throw new Error('work error');
      }),
    ).rejects.toThrow('work error');
    const count = await withContext(
      pool,
      { companyId: ids.arma, userId: ids.founder },
      async (client) => {
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from office.tasks where title = 'To be rolled back'`,
        );
        return rows[0]?.n;
      },
    );
    expect(count).toBe(0);
  });

  it('does not count a rolled back transaction as success even if the work swallows a database error', async () => {
    await expect(
      withContext(pool, { companyId: ids.arma, userId: ids.founder }, async (client) => {
        await client.query(`insert into office.tasks (company_id, title) values ($1, 'Lost')`, [
          ids.arma,
        ]);
        await client.query('select 1 / 0').catch(() => undefined);
        return 'done';
      }),
    ).rejects.toThrow('rolled back');
  });

  it('an agent step requires the agent code, the company and the identity', async () => {
    await expect(
      agentStep(pool, { companyId: ids.arma, userId: ids.founder } as never, () =>
        Promise.resolve(0),
      ),
    ).rejects.toThrow();
    const projects = await agentStep(
      pool,
      { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' },
      async (client) => {
        const { rows } = await client.query<{ n: number }>(
          'select count(*)::int as n from office.projects',
        );
        return rows[0]?.n;
      },
    );
    expect(projects).toBe(0);
  });
});
