import type { z } from 'zod';

/**
 * Values kept in the browser that are more than a flag (a stored view, an unsent text). The rule
 * is the one of lib/shell.ts and lib/theme.ts: every access is guarded, because a browser may
 * refuse storage, and what comes back is checked before it is used.
 */
export type StorageKind = 'local' | 'session';

function storageOf(kind: StorageKind): Storage {
  return kind === 'local' ? localStorage : sessionStorage;
}

/**
 * Reads a stored value and checks it with its schema; anything else (nothing stored, an older
 * shape, text that is not JSON, blocked storage) gives the fallback. The schema is the contract of
 * what may be stored under the key.
 */
export function readStored<T>(
  kind: StorageKind,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  try {
    const raw = storageOf(kind).getItem(key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Stores a value; null removes it. A blocked storage is not an error: the value holds for the page. */
export function writeStored(kind: StorageKind, key: string, value: unknown): void {
  try {
    if (value === null) storageOf(kind).removeItem(key);
    else storageOf(kind).setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do.
  }
}

/** Removes every key that starts with the prefix. */
export function clearStored(kind: StorageKind, prefix: string): void {
  try {
    const storage = storageOf(kind);
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Nothing to do.
  }
}
