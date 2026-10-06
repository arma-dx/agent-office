import { vi } from 'vitest';

/**
 * Replaces matchMedia with one the test answers for: `matching` lists the media queries that
 * match, every other query does not. `set` changes an answer and tells the listeners, as a browser
 * does when the window is resized across a breakpoint. The stub of test-setup.ts (nothing matches)
 * is back after the test.
 */
export function stubMatchMedia(matching: readonly string[] = []) {
  const matches = new Set(matching);
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches.has(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      const known = listeners.get(query) ?? new Set();
      listeners.set(query, known.add(listener));
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.get(query)?.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return {
    set(query: string, match: boolean) {
      if (match) matches.add(query);
      else matches.delete(query);
      for (const listener of listeners.get(query) ?? []) listener();
    },
    /** How many listeners wait for a change of the query. */
    listenerCount(query: string): number {
      return listeners.get(query)?.size ?? 0;
    },
  };
}
