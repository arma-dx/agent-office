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

/**
 * Inside a privileged transaction, goes on as one of the two restricted roles (`set local role`),
 * or as the privileged role again (null). For the cases where one transaction must write with one
 * role and read with the other: a row the API's role wrote and did not commit is not there for a
 * connection of the worker.
 */
export async function asRole(tx: Tx, role: 'app' | 'worker' | null): Promise<void> {
  if (role === null) {
    await tx.exec('reset role');
    return;
  }
  // The login roles are named by the setup from a constant of lowercase letters and underscores.
  const name = new URL(connectionString(role)).username;
  if (!/^[a-z_]+$/.test(name)) {
    throw new Error('Unexpected name of a test role');
  }
  await tx.exec(`set local role ${name}`);
}

// Two transactions at once ----------------------------------------------------------------------------

/**
 * A transaction the test holds open on a connection of its own and ends itself, for the cases
 * where two transactions meet (a result against a cancel, a decision against a close). What it
 * commits stays in the test database: the test removes its requests again (removeRequests).
 */
export interface OpenTransaction {
  tx: Tx;
  // The server process of the connection (for untilBlocked).
  pid: number;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export async function openTransaction(
  role: 'app' | 'worker',
  context: ContextInput,
): Promise<OpenTransaction> {
  const client = await (role === 'app' ? appPool() : workerPool()).connect();
  let ended = false;
  // Ending twice does nothing, so a test can roll back in `finally` whatever happened before.
  const end = async (statement: 'commit' | 'rollback'): Promise<void> => {
    if (ended) {
      return;
    }
    ended = true;
    try {
      await client.query(statement);
      client.release();
    } catch (error) {
      client.release(error instanceof Error ? error : new Error(statement));
      throw error;
    }
  };
  try {
    await client.query('begin');
    const tx = new Tx(client);
    await tx.setContext(context);
    const [backend] = await tx.rows<{ pid: number }>('select pg_backend_pid() as pid');
    return {
      tx,
      pid: backend?.pid ?? 0,
      commit: () => end('commit'),
      rollback: () => end('rollback'),
    };
  } catch (error) {
    await rollbackAndRelease(client);
    throw error;
  }
}

/**
 * The same on a connection of the privileged role, without a context: for a step only an
 * administrator makes (an AI permission opened without a passkey) inside a transaction the test
 * holds open. The test goes on as a restricted role with asRole.
 */
export async function openAdminTransaction(): Promise<OpenTransaction> {
  const pool = new pg.Pool({ connectionString: connectionString('admin'), max: 1 });
  const client = await pool.connect();
  let ended = false;
  const end = async (statement: 'commit' | 'rollback'): Promise<void> => {
    if (ended) {
      return;
    }
    ended = true;
    try {
      await client.query(statement);
      client.release();
    } catch (error) {
      client.release(error instanceof Error ? error : new Error(statement));
      throw error;
    } finally {
      await pool.end();
    }
  };
  try {
    await client.query('begin');
    const tx = new Tx(client);
    const [backend] = await tx.rows<{ pid: number }>('select pg_backend_pid() as pid');
    return {
      tx,
      pid: backend?.pid ?? 0,
      commit: () => end('commit'),
      rollback: () => end('rollback'),
    };
  } catch (error) {
    await rollbackAndRelease(client);
    await pool.end();
    throw error;
  }
}

/**
 * Resolves when the statement that connection runs waits for a lock another transaction holds.
 * The test starts a statement without awaiting it, waits here, and then lets the other
 * transaction go on: the order of the two is then fixed, not left to timing.
 */
export async function untilBlocked(pid: number): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString('admin') });
  await client.connect();
  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const { rows } = await client.query(
        `select 1 from pg_catalog.pg_stat_activity
         where pid = $1 and wait_event_type = 'Lock' and state = 'active'`,
        [pid],
      );
      if (rows.length > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The statement did not wait for a lock');
  } finally {
    await client.end();
  }
}

/**
 * Removes requests a test committed, with everything the flow wrote for them, and the audit rows
 * written since `auditAfter` (the highest audit id before the test's first write). The flow lets
 * nobody delete these, so the privileged role switches the triggers off for this one transaction;
 * the other files read the tables as the fixtures left them.
 */
export async function removeRequests(
  taskIds: readonly string[],
  auditAfter: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: connectionString('admin') });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`set local session_replication_role = 'replica'`);
    // The comments first: with the triggers off the foreign key's cascade is off too, and a
    // comment of a removed request would stay behind as a row without a task.
    for (const table of [
      'task_comments',
      'task_questions',
      'requester_approvals',
      'approvals',
      'task_routings',
    ]) {
      await client.query(`delete from office.${table} where task_id = any ($1::uuid[])`, [taskIds]);
    }
    await client.query(
      `delete from office.tool_calls where run_id in (
         select id from office.runs where task_id = any ($1::uuid[])
       )`,
      [taskIds],
    );
    await client.query('delete from office.runs where task_id = any ($1::uuid[])', [taskIds]);
    // What the flow told the requesters of these requests (request_returned, _rejected, _stopped).
    await client.query(
      `delete from office.notifications where record_type = 'task' and record_id = any ($1::uuid[])`,
      [taskIds],
    );
    await client.query('delete from office.tasks where id = any ($1::uuid[])', [taskIds]);
    await client.query('delete from office.audit_log where id > $1', [auditAfter]);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

/**
 * Puts back what a committed close of an AI permission changes in the fixtures: the permission of
 * project A and of its customer, and the fixtures' own open run in that project, which every such
 * close stops (its trace goes with removeRequests). The flow lets nobody reopen a run, so the
 * privileged role switches the triggers off for this one transaction.
 */
export async function restoreProjectA(projectId: string, customerId: string, runId: string) {
  const client = new pg.Client({ connectionString: connectionString('admin') });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`set local session_replication_role = 'replica'`);
    await client.query('update office.projects set ai_allowed = true where id = $1', [projectId]);
    await client.query('update office.customers set ai_allowed = true where id = $1', [customerId]);
    await client.query(
      `update office.runs set status = 'running', finished_at = null, error_code = null
       where id = $1`,
      [runId],
    );
    await client.query('commit');
  } finally {
    await client.end();
  }
}

/** The highest audit id now (see removeRequests). */
export async function auditMark(): Promise<string> {
  const [row] = await adminQuery<{ id: string }>(
    'select coalesce(max(id), 0)::text as id from office.audit_log',
  );
  return row?.id ?? '0';
}
