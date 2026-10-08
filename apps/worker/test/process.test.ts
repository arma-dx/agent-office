import { agentRunSender, createQueue, ensureAgentRunQueues } from '@agent-office/db';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { loadWorkerEnv } from '../src/env.ts';
import { assertWorkerRole, startWorker, unreadableCardVersions } from '../src/worker.ts';
import { admin, closeTestPools, ids, job, noDatabase, openRequest, testPools } from './helpers.ts';

// The worker as a process: it starts with the worker's restricted role, looks whether it can read
// the current card versions, consumes the queue and runs a job. (It reads no model table: the
// model profile is part of the card version.) No key is configured here, so no model is called:
// the job a request puts on the queue ends as "model_unavailable", which is what a machine
// without the key does.

const database = inject('database');

describe.skipIf(noDatabase)('the worker process', () => {
  afterAll(closeTestPools);

  const workerEnv = () =>
    loadWorkerEnv({
      NODE_ENV: 'test',
      WORKER_DATABASE_URL: database?.worker ?? '',
      WORKER_CONCURRENCY: '1',
    });

  it('refuses a role that bypasses row level security, and the API’s role', async () => {
    const { worker, app, admin: privileged } = testPools();
    await expect(assertWorkerRole(worker)).resolves.toBeUndefined();
    await expect(assertWorkerRole(app)).rejects.toThrow(/API role/);
    await expect(assertWorkerRole(privileged)).rejects.toThrow(/bypasses row level security/);
  });

  it('names the agents whose card version was written before the runner needed more of it', async () => {
    const { worker } = testPools();
    // The versions the sync of this build wrote are all readable.
    expect(await unreadableCardVersions(worker)).toEqual([]);
    const [version] = await admin<{ id: string; content: Record<string, unknown> }>(
      `select v.id, v.content from office.agent_definitions d
       join office.card_versions v on v.id = d.current_version_id where d.code = 'SOS-2'`,
    );
    try {
      // A version as the sync wrote it before 8 October: no tool rows, no model profile. The
      // runner refuses every job of this agent as "card_invalid" until the sync is run again.
      await admin(
        `update office.card_versions set content = content - 'tools' - 'model' where id = $1`,
        [version?.id],
      );
      expect(await unreadableCardVersions(worker)).toEqual(['SOS-2']);
      // The worker starts all the same (the other agents run) and says it in its log.
      const lines: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        lines.push(typeof line === 'string' ? line : '');
      });
      try {
        const running = await startWorker(workerEnv());
        await running.stop();
      } finally {
        spy.mockRestore();
      }
      expect(lines.map((line) => JSON.parse(line) as unknown)).toContainEqual(
        expect.objectContaining({ event: 'card_version_invalid', agent: 'SOS-2' }),
      );
    } finally {
      await admin('update office.card_versions set content = $2 where id = $1', [
        version?.id,
        JSON.stringify(version?.content),
      ]);
    }
    expect(await unreadableCardVersions(worker)).toEqual([]);
  });

  it('starts without a key, takes a job from the queue and closes its run with the reason', async () => {
    const taskId = await openRequest(ids.founder, 'LinkedIn için gönderi yaz');
    const sender = createQueue(database?.app ?? '', () => undefined, 'sender');
    await sender.start();
    const running = await startWorker(workerEnv());
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
