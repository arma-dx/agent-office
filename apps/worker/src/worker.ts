import { readModels } from '@agent-office/db/cards';
import {
  AGENT_RUN_DEAD_QUEUE,
  AGENT_RUN_QUEUE,
  QUEUE_SCHEMA,
  agentRunSender,
  createPool,
  createQueue,
  ensureAgentRunQueues,
} from '@agent-office/db';
import type { WorkerEnv } from './env.ts';
import type { CallModel } from './model/client.ts';
import { closeLostRun, runAgentJob, type RunnerDeps } from './runner/run.ts';

/**
 * The worker process: consumes the agent run queue and runs each job with the runner. It connects
 * with the restricted role office_worker only (rule 9) and refuses any role that would switch the
 * row policies off or that carries the API's own privileges.
 */

const AGENTS_DIR = new URL('../../../agents/', import.meta.url);

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
  const models = await readModels(AGENTS_DIR);
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
  const deps: RunnerDeps = { pool, callModel, models, jobs: agentRunSender(queue), log: logLine };

  await queue.work(
    AGENT_RUN_QUEUE,
    { batchSize: 1, localConcurrency: env.WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await handleAgentRunJob(deps, job.data);
      }
    },
  );
  await queue.work(AGENT_RUN_DEAD_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await closeLostRun(deps, job.data, 'overdue');
    }
  });
  logLine('worker_started', { mode: describeWorker(env) });
  return {
    async stop() {
      await queue.stop({ graceful: true });
      await pool.end();
    },
  };
}
