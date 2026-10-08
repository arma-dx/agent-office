import { describe, expect, it } from 'vitest';
import { stableOrder } from './order.ts';

// Rows of "Sizden beklenenler" do not jump while the person reads: a refresh may add and remove
// rows, it does not reorder what is on screen.
describe('stableOrder', () => {
  it('keeps what is on screen in its place, takes away what is gone and adds what is new at the end', () => {
    expect(stableOrder(['a', 'b', 'c'], ['c', 'd', 'a'])).toEqual(['a', 'c', 'd']);
  });

  it("takes the API's order when nothing is on screen yet", () => {
    expect(stableOrder([], ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('gives back the same list when nothing changed', () => {
    const previous = ['a', 'b'];
    expect(stableOrder(previous, ['b', 'a'])).toBe(previous);
  });
});
