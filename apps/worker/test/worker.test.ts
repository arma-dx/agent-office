import { describe, expect, it } from 'vitest';
import { describeWorker } from '../src/worker.ts';

describe('describeWorker', () => {
  it('ortamı okur', () => {
    expect(describeWorker({ NODE_ENV: 'test' })).toBe('worker:pgboss:test');
  });
});
