import { useState } from 'react';

/**
 * Rows do not jump while the person reads. `next` is the order the API gave (the longest wait
 * first); `previous` is what is on screen. What is on screen keeps its place, what is gone leaves,
 * what is new is added at the end in the API's order. Returns `previous` itself when nothing
 * changed, so that a caller can tell by identity.
 */
export function stableOrder(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  const present = new Set(next);
  const kept = previous.filter((id) => present.has(id));
  const known = new Set(kept);
  const merged = [...kept, ...next.filter((id) => !known.has(id))];
  return merged.length === previous.length && merged.every((id, index) => id === previous[index])
    ? previous
    : merged;
}

/**
 * The order of a list for as long as its component is mounted: the API's order when the screen
 * opens, kept still afterwards (stableOrder). Opening the screen again, or another company,
 * starts from the API's order.
 */
export function useStableOrder(ids: readonly string[]): readonly string[] {
  const [order, setOrder] = useState(ids);
  const merged = stableOrder(order, ids);
  // State derived from the previous render (React: "storing information from previous renders").
  if (merged !== order) setOrder(merged);
  return merged;
}
