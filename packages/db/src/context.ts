import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const agentCode = z.string().regex(/^[A-Z]{1,3}(-[A-Z]{2,4})?-[0-9]+$/);

/**
 * The context the row policies read (CLAUDE.md rule 9). A value left empty is written as empty in
 * the database; the policies treat an empty value as "none" and show no row that depends on it.
 */
export const contextSchema = z.strictObject({
  companyId: z.uuid().nullable().default(null),
  userId: z.uuid().nullable().default(null),
  projectId: z.uuid().nullable().default(null),
  // The email Google verified at login; used only in the login flow.
  email: z.email().nullable().default(null),
  agentCode: agentCode.nullable().default(null),
});

export type ContextInput = z.input<typeof contextSchema>;
export type Context = z.output<typeof contextSchema>;

/**
 * Context of an agent run: company, identity and agent code are required; the project is the run's
 * project, if it has one.
 */
export const agentContextSchema = z.strictObject({
  companyId: z.uuid(),
  userId: z.uuid(),
  projectId: z.uuid().nullable().default(null),
  agentCode: agentCode,
});

export type AgentContext = z.input<typeof agentContextSchema>;

// set_config(..., true) is the same as SET LOCAL: the value is cleared when the transaction ends.
// Values are sent as parameters and never enter the query text.
const CONTEXT_SQL = `select
  pg_catalog.set_config('app.company_id', $1, true),
  pg_catalog.set_config('app.user_id', $2, true),
  pg_catalog.set_config('app.project_id', $3, true),
  pg_catalog.set_config('app.email', $4, true),
  pg_catalog.set_config('app.agent_code', $5, true)`;

/** Sets (or replaces) the context inside an open transaction. */
export async function setContext(client: PoolClient, input: ContextInput): Promise<void> {
  const ctx = contextSchema.parse(input);
  await client.query(CONTEXT_SQL, [
    ctx.companyId ?? '',
    ctx.userId ?? '',
    ctx.projectId ?? '',
    ctx.email ?? '',
    ctx.agentCode ?? '',
  ]);
}

/**
 * Runs the work inside a single transaction with the given context. Called once per API request,
 * and separately for each step of an agent run. On error it rolls back and rethrows the error.
 * The context is local to the transaction, so it does not stay on the connection returned to the
 * pool.
 */
export async function withContext<T>(
  pool: Pool,
  input: ContextInput,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const ctx = contextSchema.parse(input);
  const client = await pool.connect();
  let brokenConnection: Error | undefined;
  try {
    await client.query('begin');
    try {
      await setContext(client, ctx);
      const result = await fn(client);
      // If the work catches a database error itself and returns, the transaction is aborted;
      // PostgreSQL answers COMMIT with ROLLBACK without raising an error. Success is not returned
      // while the writes are lost.
      const end = await client.query('commit');
      if (end.command === 'ROLLBACK') {
        throw new Error(
          'Transaction was rolled back because of an error; the work did not succeed',
        );
      }
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch (rollbackError) {
        // A connection that cannot roll back does not go back to the pool.
        brokenConnection = rollbackError instanceof Error ? rollbackError : new Error('rollback');
      }
      throw error;
    }
  } finally {
    client.release(brokenConnection);
  }
}

/**
 * One step of an agent run (a tool call, a record): runs in its own short transaction and sets the
 * context again. The run's context stays the same for the whole run.
 */
export async function agentStep<T>(
  pool: Pool,
  input: AgentContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const ctx = agentContextSchema.parse(input);
  return withContext(pool, { ...ctx, email: null }, fn);
}
