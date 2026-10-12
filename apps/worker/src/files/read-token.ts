/**
 * The settings of the worker's file reader and the check of its read token. This file holds no
 * reader: env.ts may import it, while files/reader.ts is imported only by this folder and
 * worker.ts (CLAUDE.md rule 9; eslint.config.js, agent-office/worker-file-reader).
 */

export interface SupabaseReadSettings {
  /** https://<project ref>.supabase.co, without a path. */
  url: string;
  bucket: string;
  /** The project's publishable key; not a secret. */
  publishableKey: string;
  /** The JWT of the role office_file_reader. A secret: read from the environment, never logged. */
  readToken: string;
}

export type FileReaderSettings =
  { kind: 'disk'; dir: string } | ({ kind: 'supabase' } & SupabaseReadSettings);

/** The role a read token must name, and nothing else (docs/supabase-kurulum.md section 9). */
export const FILE_READER_ROLE = 'office_file_reader';

const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** The claims of a token that has the shape of a JWT; null for anything else. Nothing is verified. */
function claimsOf(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((part) => SEGMENT.test(part))) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * What is wrong with a read token, as a code; null when nothing is. Reads the token's payload
 * without verifying its signature (the storage verifies it): three dot separated parts, a JSON
 * payload, role === FILE_READER_ROLE. With `now` (milliseconds), also 'expired' when exp is a
 * number that has passed. Never returns or logs a part of the token.
 */
export function readTokenProblem(
  token: string,
  now?: number,
): 'not_a_jwt' | 'wrong_role' | 'expired' | null {
  const claims = claimsOf(token);
  if (claims === null) return 'not_a_jwt';
  if (claims.role !== FILE_READER_ROLE) return 'wrong_role';
  if (now !== undefined && typeof claims.exp === 'number' && claims.exp * 1000 <= now) {
    return 'expired';
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until the token's exp (negative once it has passed); null when it has none. */
export function readTokenDaysLeft(token: string, now: number): number | null {
  const exp = claimsOf(token)?.exp;
  return typeof exp === 'number' ? Math.floor((exp * 1000 - now) / DAY_MS) : null;
}
