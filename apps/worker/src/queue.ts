import { PgBoss } from 'pg-boss';
import { z } from 'zod';

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
 */
export function createQueue(connectionString: string, onError: (error: Error) => void): PgBoss {
  const queue = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    migrate: false,
    application_name: 'agent-office-queue',
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
