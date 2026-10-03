import { randomUUID } from 'node:crypto';
import { describe, expect, inject, it, vi } from 'vitest';
import { createQueue, jobDataSchema, sendJob } from '../src/queue.ts';

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

const database = inject('database');

describe.skipIf(database === null)('queue in the database', () => {
  it('starts with the restricted application role, sends and fetches a job', async () => {
    const errors: unknown[] = [];
    const queue = createQueue(database?.app ?? '', (error) => errors.push(error));
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
});
