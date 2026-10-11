import pg from 'pg';

export {
  agentContextSchema,
  agentStep,
  contextSchema,
  setContext,
  withContext,
  type AgentContext,
  type Context,
  type ContextInput,
} from './context.ts';
export { readOffice, type OfficeRow } from './office.ts';
export type { Queryable } from './queryable.ts';
export * from './requests.ts';
export * from './notifications.ts';
export * from './projects.ts';
export * from './files.ts';
export {
  AGENT_RUN_DEAD_QUEUE,
  AGENT_RUN_QUEUE,
  DEAD_LETTER_RETRY,
  QUEUE_SCHEMA,
  agentRunJobSchema,
  agentRunSender,
  createQueue,
  ensureAgentRunQueues,
  jobDataSchema,
  sendAgentRunLookAgain,
  sendJob,
  type AgentRunJob,
  type AgentRunSender,
  type JobData,
} from './queue.ts';

/**
 * Connection pool. The connection string belongs to the restricted application role (member of
 * office_app, no BYPASSRLS); the privileged role's connection string is never given to the
 * application (rule 9). The connection string is not written to logs.
 * If an idle connection drops, the pool emits an error; without a listener the process crashes, so
 * the listener is required.
 */
export function createPool(
  connectionString: string,
  applicationName: string,
  onError: (error: Error) => void,
): pg.Pool {
  const pool = new pg.Pool({ connectionString, application_name: applicationName });
  pool.on('error', onError);
  return pool;
}
