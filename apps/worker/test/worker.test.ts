import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/env.ts';
import { describeWorker, handleDeadLetterJob } from '../src/worker.ts';

const DATABASE = 'postgresql://office_worker@127.0.0.1:5432/postgres';
const KEY = `sk-ant-${'x'.repeat(40)}`;

describe('the worker’s environment', () => {
  it('starts without a Claude API key outside production and says so', () => {
    const env = loadWorkerEnv({ NODE_ENV: 'test', WORKER_DATABASE_URL: DATABASE });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(describeWorker(env)).toBe('worker:pgboss:test:no-model');
    // An empty value in .env is the same as no value.
    const empty = loadWorkerEnv({
      WORKER_DATABASE_URL: DATABASE,
      ANTHROPIC_API_KEY: '',
      WORKER_CONCURRENCY: '',
    });
    expect(empty.ANTHROPIC_API_KEY).toBeUndefined();
    expect(
      describeWorker(loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ANTHROPIC_API_KEY: KEY })),
    ).toBe('worker:pgboss:development:model');
  });

  it('needs its own database address, and the key in production', () => {
    expect(() => loadWorkerEnv({ NODE_ENV: 'test' })).toThrow(/WORKER_DATABASE_URL/);
    expect(() => loadWorkerEnv({ NODE_ENV: 'production', WORKER_DATABASE_URL: DATABASE })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('refuses to start with headers the SDK would add to every model request', () => {
    // No option of the SDK switches ANTHROPIC_CUSTOM_HEADERS off, so the worker does not start
    // with it; the error names the variable and never its value.
    let message = '';
    try {
      loadWorkerEnv({
        WORKER_DATABASE_URL: DATABASE,
        ANTHROPIC_API_KEY: KEY,
        ANTHROPIC_CUSTOM_HEADERS: 'anthropic-beta: injected-by-env',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('ANTHROPIC_CUSTOM_HEADERS');
    expect(message).not.toContain('injected-by-env');
    // An empty value in .env is the same as no value.
    expect(() =>
      loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ANTHROPIC_CUSTOM_HEADERS: '' }),
    ).not.toThrow();
  });

  it('never shows a value in an error', () => {
    let message = '';
    try {
      loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ANTHROPIC_API_KEY: 'short-secret' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('ANTHROPIC_API_KEY');
    expect(message).not.toContain('short-secret');
  });
});

describe('the dead letter handler', () => {
  const job = {
    companyId: randomUUID(),
    userId: randomUUID(),
    taskId: randomUUID(),
    agentCode: 'SOS-2',
  };

  it('keeps the error it met out of the queue: a bare code is thrown, the log gets kind and state', async () => {
    // What a database error can look like: it quotes the text it refused.
    const refused = Object.assign(new Error('value too long: "Sayın Ayşe Hanım, teklifimiz..."'), {
      code: '22001',
      detail: 'Failing row contains (Sayın Ayşe Hanım ...)',
    });
    const log: [string, Record<string, unknown>][] = [];
    const deps = {
      pool: { connect: () => Promise.reject(refused) } as never,
      log: (event: string, fields: Record<string, unknown>) => {
        log.push([event, fields]);
      },
    };
    let asked = 0;
    const thrown = await handleDeadLetterJob(
      deps,
      () => {
        asked += 1;
        return Promise.resolve();
      },
      job,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    // The queue stores what is thrown, with every field: nothing of the first error is in it.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(refused);
    expect((thrown as Error).message).toBe('dead_letter_error');
    expect((thrown as Error).cause).toBeUndefined();
    expect(Object.keys(thrown as Error)).toEqual([]);
    expect(log).toEqual([['dead_letter_failed', { type: 'Error', state: '22001' }]]);
    // The queue tries the job again (DEAD_LETTER_RETRY); no reminder was asked for meanwhile.
    expect(asked).toBe(0);
  });

  it('a job that is not an agent run job is dropped without touching the database', async () => {
    const deps = {
      pool: {
        connect: () => Promise.reject(new Error('the database must not be asked')),
      } as never,
      log: () => undefined,
    };
    await expect(
      handleDeadLetterJob(deps, () => Promise.resolve(), { ...job, note: 'text' }),
    ).resolves.toBeUndefined();
  });
});
