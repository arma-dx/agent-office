import {
  AGENT_RUN_DEAD_QUEUE,
  AGENT_RUN_QUEUE,
  QUEUE_SCHEMA,
  agentRunJobSchema,
  agentRunSender,
  createPool,
  createQueue,
  ensureAgentRunQueues,
  sendAgentRunLookAgain,
} from '@agent-office/db';
import { storedCardSchema } from '@agent-office/shared';
import type { WorkerEnv } from './env.ts';
import type { CallModel } from './model/client.ts';
import { closeLostRun, runAgentJob, type RunnerDeps } from './runner/run.ts';

/**
 * The worker process: consumes the agent run queue and runs each job with the runner. It connects
 * with the restricted role office_worker only (rule 9) and refuses any role that would switch the
 * row policies off or that carries the API's own privileges.
 */

export function describeWorker(env: Pick<WorkerEnv, 'NODE_ENV' | 'ANTHROPIC_API_KEY'>): string {
  return `worker:${QUEUE_SCHEMA}:${env.NODE_ENV}:${env.ANTHROPIC_API_KEY === undefined ? 'no-model' : 'model'}`;
}

type Pool = ReturnType<typeof createPool>;

/**
 * Refuses to work with a role that bypasses row level security, or with the API's role: an agent
 * run must not reach what only the API may (the identity functions). The error names the reason
 * only.
 */
export async function assertWorkerRole(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ privileged: boolean; app: boolean; api: boolean }>(
    `select (r.rolsuper or r.rolbypassrls or exists (
              select 1 from pg_catalog.pg_roles p
              where (p.rolsuper or p.rolbypassrls)
                and pg_catalog.pg_has_role(current_user, p.oid, 'member')
            )) as privileged,
            pg_catalog.pg_has_role(current_user, 'office_app', 'member') as app,
            pg_catalog.pg_has_role(current_user, 'office_api_private', 'member') as api
     from pg_catalog.pg_roles r where r.rolname = current_user`,
  );
  const role = rows[0];
  if (!role) throw new Error('The database role could not be checked');
  if (role.privileged) {
    throw new Error('The database role bypasses row level security; use the worker role');
  }
  if (!role.app) throw new Error('The database role is not a member of office_app');
  if (role.api) {
    throw new Error(
      'The database role is the API role; WORKER_DATABASE_URL must use the worker role',
    );
  }
}

/**
 * The agents whose current card version the runner cannot read. A version is read with the schema
 * of this build; one that was written before the stored card got a field the runner needs (the
 * tool rows and the model profile, 8 October) is refused, and every job of that agent ends as
 * "card_invalid" until the card sync has written a new version. The coordinator and the API still
 * offer such an agent, so the worker says it once at its start, where the operator reads.
 */
export async function unreadableCardVersions(pool: Pool): Promise<string[]> {
  // Global tables: readable without a context, and they hold no company data.
  const { rows } = await pool.query<{ code: string; content: unknown }>(
    `select d.code, v.content
     from office.agent_definitions d
     join office.card_versions v on v.id = d.current_version_id
     order by d.code collate "C"`,
  );
  return rows.filter((row) => !storedCardSchema.safeParse(row.content).success).map((r) => r.code);
}

/**
 * Runs one job of the queue. The queue stores whatever a job throws, with every field of the
 * error, in its own tables, which no row policy guards and both companies share. A database error
 * can quote the text it refused (a part of an agent's output), so the error itself never leaves
 * this function (rule 10: ids only): the log gets its kind and the SQL state, the run it left open
 * is closed, and the queue gets a bare code and moves the job to the dead letter queue (no retry:
 * a run is never repeated by the queue).
 */
export async function handleAgentRunJob(deps: RunnerDeps, data: unknown): Promise<void> {
  let failed = false;
  // The run this job opened, if it got that far: only that run is this job's to close.
  let runId: string | null = null;
  try {
    await runAgentJob(deps, data, (opened) => {
      runId = opened;
    });
  } catch (error) {
    failed = true;
    deps.log('job_failed', { type: errorKind(error), state: sqlStateOf(error) });
    await closeLostRun(deps, data, { runId }).catch(() => undefined);
  }
  if (failed) {
    // Thrown outside the catch on purpose: the new error carries no cause, no message and no
    // field of the one that was caught.
    throw new Error('runner_error');
  }
}

/**
 * Runs one job of the dead letter queue: a job that failed or expired, or this handler's own
 * reminder. The runs it left open are closed once their own time limit has passed. A job can get
 * here long before that: a worker that is stopped fails the jobs it was running at once (and so
 * does a runner that crashed and could not close its run). The run is then still inside its limit
 * and is not touched, because a job that is alive may own it; but the question is not dropped
 * either: the handler puts a reminder on this same queue for the moment the limit will have
 * passed. Without it nothing would look again and the request would say "ajan çalışıyor" for ever.
 *
 * A failure here is retried by the queue (DEAD_LETTER_RETRY in packages/db). As in
 * handleAgentRunJob, the error that was caught never reaches the queue's tables: the log gets its
 * kind and the SQL state, the queue a bare code.
 */
export async function handleDeadLetterJob(
  deps: Pick<RunnerDeps, 'pool' | 'log'>,
  lookAgain: (job: unknown, afterSeconds: number) => Promise<void>,
  data: unknown,
): Promise<void> {
  let failed = false;
  let seconds: number | null = null;
  try {
    seconds = await closeLostRun(deps, data, 'overdue');
    if (seconds !== null) await lookAgain(data, seconds);
  } catch (error) {
    failed = true;
    deps.log('dead_letter_failed', { type: errorKind(error), state: sqlStateOf(error) });
  }
  if (failed) {
    // Thrown outside the catch on purpose, as in handleAgentRunJob.
    throw new Error('dead_letter_error');
  }
  if (seconds === null) return;
  const job = agentRunJobSchema.safeParse(data);
  deps.log('run_watched', {
    task: job.success ? job.data.taskId : null,
    agent: job.success ? job.data.agentCode : null,
    seconds,
  });
}

type Queue = ReturnType<typeof createQueue>;

/** Registers the worker's two handlers on a started queue. */
export async function consumeAgentRuns(
  queue: Queue,
  deps: RunnerDeps,
  concurrency: number,
): Promise<void> {
  await queue.work(
    AGENT_RUN_QUEUE,
    { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await handleAgentRunJob(deps, job.data);
      }
    },
  );
  await queue.work(AGENT_RUN_DEAD_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await handleDeadLetterJob(
        deps,
        (again, afterSeconds) => sendAgentRunLookAgain(queue, again, afterSeconds),
        job.data,
      );
    }
  });
}

export interface RunningWorker {
  stop(): Promise<void>;
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/** The five character SQL state of a database error, and nothing else of it. */
function sqlStateOf(error: unknown): string | null {
  const code = error instanceof Error && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/** Writes a log line of codes and ids; nothing a person or a model wrote ever reaches it. */
function logLine(event: string, fields: Record<string, string | number | null>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

export async function startWorker(env: WorkerEnv): Promise<RunningWorker> {
  const pool = createPool(env.WORKER_DATABASE_URL, 'agent-office-worker', (error) => {
    logLine('pool_error', { type: error.name });
  });
  await assertWorkerRole(pool);
  for (const agent of await unreadableCardVersions(pool)) {
    // Not a reason to stay down: the other agents run. The card sync writes a readable version.
    logLine('card_version_invalid', { agent });
  }
  let callModel: CallModel | null = null;
  if (env.ANTHROPIC_API_KEY !== undefined) {
    // The SDK is loaded only when a key is configured, and only here.
    const { createAnthropicModel } = await import('./model/anthropic.ts');
    callModel = createAnthropicModel(env.ANTHROPIC_API_KEY);
  } else {
    logLine('model_not_configured', {});
  }
  const queue = createQueue(env.WORKER_DATABASE_URL, (error) => {
    logLine('queue_error', { type: error.name });
  });
  await queue.start();
  await ensureAgentRunQueues(queue);
  const deps: RunnerDeps = { pool, callModel, jobs: agentRunSender(queue), log: logLine };

  await consumeAgentRuns(queue, deps, env.WORKER_CONCURRENCY);
  logLine('worker_started', { mode: describeWorker(env) });
  return {
    async stop() {
      // The queue waits for the jobs in hand and then fails the ones that are still running; the
      // runs they leave open are closed by the dead letter handler of the next worker, once their
      // time limit has passed.
      await queue.stop({ graceful: true });
      await pool.end();
    },
  };
}
