import { describe, expect, it } from 'vitest';
import { costOf } from '../src/models.ts';

describe('the cost of a model call', () => {
  const prices = {
    input: 2,
    output: 10,
    cache_write_5m: 2.5,
    cache_write_1h: 4,
    cache_read: 0.2,
  };
  const usage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

  it('prices every kind of token apart, in six decimals, rounded half up', () => {
    expect(costOf(usage, prices)).toBe('0.000000');
    expect(costOf({ ...usage, input: 1_000_000 }, prices)).toBe('2.000000');
    expect(costOf({ ...usage, input: 1200, output: 850 }, prices)).toBe('0.010900');
    expect(costOf({ ...usage, cacheRead: 5000 }, prices)).toBe('0.001000');
    expect(costOf({ ...usage, cacheWrite5m: 4096, cacheWrite1h: 1 }, prices)).toBe('0.010244');
    // 3 tokens of cache read: 0.0000006 dollars rounds up to one millionth.
    expect(costOf({ ...usage, cacheRead: 3 }, prices)).toBe('0.000001');
    expect(costOf({ ...usage, cacheRead: 2 }, prices)).toBe('0.000000');
    expect(costOf({ ...usage, input: 3_000_000_000 }, prices)).toBe('6000.000000');
  });

  it('uses the stated price, not a multiple of another', () => {
    const haiku = { input: 1, output: 5, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1 };
    expect(costOf({ ...usage, input: 900, output: 120, cacheRead: 100 }, haiku)).toBe('0.001510');
  });
});
