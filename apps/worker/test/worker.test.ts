import { describe, expect, it } from 'vitest';
import { describeWorker } from '../src/worker.ts';

describe('describeWorker', () => {
  it('reads the environment', () => {
    expect(describeWorker({ NODE_ENV: 'test' })).toBe('worker:pgboss:test');
  });
});
