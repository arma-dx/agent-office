import { agentRunSender, createQueue, ensureAgentRunQueues } from '@agent-office/db';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { loadWorkerEnv } from '../src/env.ts';
import { assertWorkerRole, startWorker } from '../src/worker.ts';
import { admin, closeTestPools, ids, job, noDatabase, openRequest, testPools } from './helpers.ts';

// The worker as a process: it starts with the worker's restricted role, reads the model table,
// consumes the queue and runs a job. No key is configured here, so no model is called: the job a
// request puts on the queue ends as "model_unavailable", which is what a machine without the key
// does.

const database = inject('database');

describe.skipIf(noDatabase)('the worker process', () => {
  afterAll(closeTestPools);

  it('refuses a role that bypasses row level security, and the API’s role', async () => {
    const { worker, app, admin: privileged } = testPools();
    await expect(assertWorkerRole(worker)).resolves.toBeUndefined();
    await expect(assertWorkerRole(app)).rejects.toThrow(/API role/);
    await expect(assertWorkerRole(privileged)).rejects.toThrow(/bypasses row level security/);
  });

  it('starts without a key, takes a job from the queue and closes its run with the reason', async () => {
    const env = loadWorkerEnv({
      NODE_ENV: 'test',
      WORKER_DATABASE_URL: database?.worker ?? '',
      WORKER_CONCURRENCY: '1',
    });
    const taskId = await openRequest(ids.founder, 'LinkedIn için gönderi yaz');
    const sender = createQueue(database?.app ?? '', () => undefined, 'sender');
    await sender.start();
    const running = await startWorker(env);
    try {
      await ensureAgentRunQueues(sender);
      // As the API does it: the job is written through a transaction of its own.
      const client = await testPools().app.connect();
      try {
        await client.query('begin');
        await agentRunSender(sender).send(client, job(taskId, 'KOR-1', ids.founder));
        await client.query('commit');
      } finally {
        client.release();
      }
      await expect
        .poll(
          () =>
            admin<{ status: string; error_code: string | null }>(
              'select status, error_code from office.runs where task_id = $1',
              [taskId],
            ),
          { timeout: 10_000, interval: 200 },
        )
        .toEqual([{ status: 'failed', error_code: 'model_unavailable' }]);
    } finally {
      await running.stop();
      await sender.stop({ graceful: false });
    }
  });
});
