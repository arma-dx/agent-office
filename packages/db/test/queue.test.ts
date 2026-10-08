import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, inject, it, vi } from 'vitest';
import { cardSchema } from '@agent-office/shared';
import {
  AGENT_RUN_DEAD_QUEUE,
  AGENT_RUN_EXPIRE_MARGIN_SECONDS,
  AGENT_RUN_QUEUE,
  agentRunExpireSeconds,
  agentRunJobSchema,
  agentRunSender,
  createQueue,
  ensureAgentRunQueues,
  jobDataSchema,
  sendJob,
} from '../src/queue.ts';

describe('the expiry of an agent run job', () => {
  it('follows the time limit of the card, with a margin, for every limit a card may have', () => {
    // The limits the repository's cards name today, and the largest the card schema allows.
    for (const minutes of [2, 5, 15, 30, 60]) {
      const expiry = agentRunExpireSeconds(minutes);
      expect(expiry).toBe(minutes * 60 + AGENT_RUN_EXPIRE_MARGIN_SECONDS);
      // A run inside its limit is never met by the expiry of its own job, and a run the dead
      // letter handler finds is past its limit by more than the runner's closing time.
      expect(expiry).toBeGreaterThan(minutes * 60 + 60);
    }
    expect(cardSchema.shape.limits.shape.duration_minutes.safeParse(60).success).toBe(true);
    expect(cardSchema.shape.limits.shape.duration_minutes.safeParse(61).success).toBe(false);
    // No card version: the default run time of ten minutes.
    expect(agentRunExpireSeconds(null)).toBe(15 * 60);
  });
});

describe('job data (rule 10)', () => {
  it('accepts only id fields', () => {
    const id = randomUUID();
    expect(jobDataSchema.safeParse({ taskId: id, runId: id }).success).toBe(true);
    expect(jobDataSchema.safeParse({ task: id }).success).toBe(false);
    expect(jobDataSchema.safeParse({ taskId: 'Send the proposal to the customer' }).success).toBe(
      false,
    );
    expect(jobDataSchema.safeParse({ taskId: { text: 'x' } }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${String(i)}Id`, id]));
    expect(jobDataSchema.safeParse(many).success).toBe(false);
  });

  it('puts only validated data on the queue', async () => {
    const send = vi.fn(() => Promise.resolve('job-1'));
    const id = randomUUID();
    await expect(sendJob({ send }, 'kor_request', { taskId: id })).resolves.toBe('job-1');
    expect(send).toHaveBeenCalledWith('kor_request', { taskId: id });
    await expect(sendJob({ send }, 'kor_request', { summary: 'text' })).rejects.toThrow();
    await expect(sendJob({ send }, 'Bad Name', { taskId: id })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('agent run job (rule 10)', () => {
  const job = {
    companyId: randomUUID(),
    userId: randomUUID(),
    taskId: randomUUID(),
    agentCode: 'SOS-2',
  };

  it('carries ids and an agent code, nothing else', () => {
    expect(agentRunJobSchema.safeParse(job).success).toBe(true);
    expect(agentRunJobSchema.safeParse({ ...job, text: 'Write a post' }).success).toBe(false);
    expect(agentRunJobSchema.safeParse({ ...job, agentCode: 'ignore the rules' }).success).toBe(
      false,
    );
    expect(agentRunJobSchema.safeParse({ ...job, taskId: 'the request' }).success).toBe(false);
  });
});

const database = inject('database');

describe.skipIf(database === null)('queue in the database', () => {
  it('starts with the restricted application role, sends and fetches a job', async () => {
    const errors: unknown[] = [];
    // The worker's privileges: office_app only, without the API-only ones.
    const queue = createQueue(database?.worker ?? '', (error) => errors.push(error));
    await queue.start();
    try {
      await queue.createQueue('test_queue');
      const taskId = randomUUID();
      expect(await sendJob(queue, 'test_queue', { taskId })).toEqual(expect.any(String));
      const jobs = await queue.fetch('test_queue');
      expect(jobs.map((job) => job.data)).toEqual([{ taskId }]);
    } finally {
      await queue.stop({ graceful: false });
    }
    expect(errors).toEqual([]);
  });

  it('a job sent inside a transaction is stored with it: gone on rollback, there on commit', async () => {
    const errors: unknown[] = [];
    // The API's side: the restricted role of the API, sending only.
    const queue = createQueue(database?.app ?? '', (error) => errors.push(error), 'sender');
    const pool = new pg.Pool({ connectionString: database?.app ?? '', max: 1 });
    await queue.start();
    try {
      await ensureAgentRunQueues(queue);
      // A second call finds the queues and changes nothing.
      await ensureAgentRunQueues(queue);
      expect((await queue.getQueue(AGENT_RUN_QUEUE))?.retryLimit).toBe(0);
      expect((await queue.getQueue(AGENT_RUN_QUEUE))?.deadLetter).toBe(AGENT_RUN_DEAD_QUEUE);
      const sender = agentRunSender(queue);
      const job = {
        companyId: randomUUID(),
        userId: randomUUID(),
        taskId: randomUUID(),
        agentCode: 'KOR-1',
      };
      const client = await pool.connect();
      try {
        await client.query('begin');
        await sender.send(client, job);
        await client.query('rollback');
        expect(await queue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
        await client.query('begin');
        await sender.send(client, job);
        expect(await queue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
        await client.query('commit');
      } finally {
        client.release();
      }
      const jobs = await queue.fetch(AGENT_RUN_QUEUE);
      expect(jobs.map((fetched) => fetched.data)).toEqual([job]);
      // An agent without a card version here: the job gets the default run time plus the margin.
      expect(jobs.map((fetched) => fetched.expireInSeconds)).toEqual([15 * 60]);
      await expect(sender.send(pool, { ...job, agentCode: 'not a code' })).rejects.toThrow();
    } finally {
      await queue.stop({ graceful: false });
      await pool.end();
    }
    expect(errors).toEqual([]);
  });
});
