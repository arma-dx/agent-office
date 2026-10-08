import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/env.ts';
import { describeWorker } from '../src/worker.ts';

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
