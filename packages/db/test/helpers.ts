import pg from 'pg';
import { inject } from 'vitest';
import { setContext, type ContextInput } from '../src/context.ts';

const database = inject('database');

/** Without a database connection string (locally) the database tests are skipped. */
export const noDatabase = database === null;

function connectionString(kind: 'app' | 'worker' | 'admin'): string {
  if (!database) {
    throw new Error('No test database');
  }
  return database[kind];
}

let sharedAppPool: pg.Pool | undefined;
let sharedWorkerPool: pg.Pool | undefined;

/**
 * Pool of the restricted role with the API's privileges (member of office_app and
 * office_api_private, no BYPASSRLS).
 */
export function appPool(): pg.Pool {
  sharedAppPool ??= new pg.Pool({ connectionString: connectionString('app'), max: 4 });
  return sharedAppPool;
}

/** Pool of the restricted role with the worker's privileges (member of office_app only). */
export function workerPool(): pg.Pool {
  sharedWorkerPool ??= new pg.Pool({ connectionString: connectionString('worker'), max: 2 });
  return sharedWorkerPool;
}

export async function closePools(): Promise<void> {
  await sharedAppPool?.end();
  await sharedWorkerPool?.end();
  sharedAppPool = undefined;
  sharedWorkerPool = undefined;
}

export interface QueryError {
  code: string | undefined;
  message: string;
}

/** A transaction opened with the restricted role and rolled back at the end. */
export class Tx {
  readonly client: pg.PoolClient;
  #counter = 0;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async setContext(input: ContextInput): Promise<void> {
    await setContext(this.client, input);
  }

  async rows<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.client.query<T>(sql, values)).rows;
  }

  async exec(sql: string, values: unknown[] = []): Promise<number> {
    return (await this.client.query(sql, values)).rowCount ?? 0;
  }

  async count(table: string, condition = 'true', values: unknown[] = []): Promise<number> {
    const row = await this.rows<{ n: number }>(
      `select count(*)::int as n from office.${table} where ${condition}`,
      values,
    );
    return row[0]?.n ?? 0;
  }

  /** Expects the query to fail; returns the error code without aborting the transaction. */
  async expectError(sql: string, values: unknown[] = []): Promise<QueryError> {
    const savepoint = `s${String(++this.#counter)}`;
    await this.client.query(`savepoint ${savepoint}`);
    try {
      await this.client.query(sql, values);
    } catch (error) {
      await this.client.query(`rollback to savepoint ${savepoint}`);
      const pgError = error as { code?: string; message?: string };
      return { code: pgError.code, message: pgError.message ?? '' };
    }
    await this.client.query(`release savepoint ${savepoint}`);
    throw new Error(`Expected an error but the query succeeded: ${sql}`);
  }
}

async function inPoolTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await fn(new Tx(client));
  } finally {
    await rollbackAndRelease(client);
  }
}

/**
 * Runs the work with the restricted role that has the API's privileges inside a single transaction
 * that is rolled back.
 */
export async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inPoolTransaction(appPool(), fn);
}

/** Same with the worker's privileges (agent runs). */
export async function inWorkerTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inPoolTransaction(workerPool(), fn);
}

// If the rollback fails the connection does not go back to the pool and the original error is not
// hidden.
async function rollbackAndRelease(client: pg.PoolClient): Promise<void> {
  try {
    await client.query('rollback');
    client.release();
  } catch (error) {
    client.release(error instanceof Error ? error : new Error('rollback'));
  }
}

/** One-off query with the privileged role (only to verify the expected state). */
export async function adminQuery<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: connectionString('admin') });
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Privileged transaction that is rolled back (to see that triggers apply to the privileged role
 * too).
 */
export async function inAdminTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: connectionString('admin'), max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await fn(new Tx(client));
  } finally {
    await rollbackAndRelease(client);
    await pool.end();
  }
}
