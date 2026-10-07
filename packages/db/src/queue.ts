import { agentCodeSchema } from '@agent-office/shared';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { Queryable } from './queryable.ts';

/** The pg-boss schema; created by the queue migration in supabase/migrations. */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * Rule 10: the queue tables sit outside row level security, so a job carries only ids. Job data is
 * a plain object; every key ends in `...Id` and every value is a uuid.
 */
export const jobDataSchema = z
  .record(z.string().regex(/^[a-z][a-zA-Z0-9]*Id$/), z.uuid())
  .refine((data) => Object.keys(data).length <= 8, 'Job data holds at most 8 ids');

export type JobData = z.output<typeof jobDataSchema>;

const queueNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/**
 * Queue client. Connects with the restricted application role; it neither creates nor changes the
 * schema (migrate: false) and fails on start if the schema version does not match the migration.
 * pg-boss emits errors; without a listener the process crashes, so the listener is required.
 * Queues are not partitioned: the partition table would be owned by the login role and later
 * pg-boss migrations could not touch it.
 *
 * `sender` is the API's side: it only puts jobs on the queue, inside its own request transaction,
 * and runs none of pg-boss's maintenance (the worker does).
 */
export function createQueue(
  connectionString: string,
  onError: (error: Error) => void,
  mode: 'worker' | 'sender' = 'worker',
): PgBoss {
  const queue = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    migrate: false,
    application_name: 'agent-office-queue',
    ...(mode === 'sender' ? { supervise: false, schedule: false, max: 2 } : {}),
  });
  queue.on('error', onError);
  return queue;
}

/** Puts a job on the queue; the data may consist of ids only. */
export async function sendJob(
  queue: Pick<PgBoss, 'send'>,
  name: string,
  data: Record<string, string>,
): Promise<string | null> {
  return queue.send(queueNameSchema.parse(name), jobDataSchema.parse(data));
}

// Agent runs ---------------------------------------------------------------------------------------

export const AGENT_RUN_QUEUE = 'agent_run';
/** Jobs that failed or expired; the worker's second handler cleans up after a lost run. */
export const AGENT_RUN_DEAD_QUEUE = 'agent_run_dead';
// Longer than the longest time limit of a card (CLAUDE.md default: 10 minutes) plus the margin the
// runner needs to close the run.
const AGENT_RUN_EXPIRE_SECONDS = 15 * 60;

/**
 * One agent run to start: who asked (the run's identity), on which request, and which agent. Ids
 * only (rule 10). The agent code is the key of the global table agent_definitions, an identifier
 * and not company data; its pattern leaves no room for text. The job is a hint: the runner reads
 * the request again with the restricted role and this context, and does nothing the database would
 * not let that person and that agent do.
 */
export const agentRunJobSchema = z.strictObject({
  companyId: z.uuid(),
  userId: z.uuid(),
  taskId: z.uuid(),
  agentCode: agentCodeSchema,
});
export type AgentRunJob = z.output<typeof agentRunJobSchema>;

/**
 * Creates the two queues if they are not there. A run is never retried by the queue: every model
 * call costs money and a retry would open a second run; a failed job lands in the dead letter
 * queue.
 */
export async function ensureAgentRunQueues(
  queue: Pick<PgBoss, 'createQueue' | 'getQueue'>,
): Promise<void> {
  if (!(await queue.getQueue(AGENT_RUN_DEAD_QUEUE))) {
    await queue.createQueue(AGENT_RUN_DEAD_QUEUE);
  }
  if (!(await queue.getQueue(AGENT_RUN_QUEUE))) {
    await queue.createQueue(AGENT_RUN_QUEUE, {
      policy: 'standard',
      retryLimit: 0,
      expireInSeconds: AGENT_RUN_EXPIRE_SECONDS,
      deadLetter: AGENT_RUN_DEAD_QUEUE,
    });
  }
}

/** Puts jobs on the agent run queue. */
export interface AgentRunSender {
  /**
   * Inside the caller's open transaction: the job becomes visible when that transaction commits and
   * is gone when it rolls back, so a record and the run it calls for are stored together.
   */
  send(client: Queryable, job: AgentRunJob): Promise<void>;
}

export function agentRunSender(queue: Pick<PgBoss, 'send'>): AgentRunSender {
  return {
    async send(client, job) {
      const data = agentRunJobSchema.parse(job);
      const id = await queue.send(AGENT_RUN_QUEUE, data, {
        db: { executeSql: (text: string, values?: unknown[]) => client.query(text, values) },
      });
      if (id === null) {
        throw new Error('The agent run job was not accepted by the queue');
      }
    },
  };
}
