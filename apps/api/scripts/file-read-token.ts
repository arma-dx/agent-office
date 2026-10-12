import { createHmac } from 'node:crypto';

/**
 * The worker's read token (CLAUDE.md rule 9; docs/supabase-kurulum.md section 9): a JWT that
 * names the database role office_file_reader, which a policy of the Supabase project lets read
 * the objects of the one bucket and nothing else. Signed with the project's JWT secret (HS256),
 * which is given to this function and kept nowhere.
 *
 * The role's name is written here and in the worker (apps/worker/src/files/read-token.ts,
 * FILE_READER_ROLE); a test of the worker holds the two together by checking a token this
 * function made.
 */
export const READ_TOKEN_ROLE = 'office_file_reader';
export const READ_TOKEN_DAYS = 400;

const DAY_SECONDS = 86_400;

const segment = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The token, and the day (UTC, YYYY-MM-DD) it ends. `now` is in milliseconds. */
export function mintFileReadToken(secret: string, now: number): { token: string; endsOn: string } {
  const iat = Math.floor(now / 1000);
  const exp = iat + READ_TOKEN_DAYS * DAY_SECONDS;
  const signed = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment({
    role: READ_TOKEN_ROLE,
    iss: 'agent-office',
    iat,
    exp,
  })}`;
  const signature = createHmac('sha256', secret).update(signed).digest('base64url');
  return {
    token: `${signed}.${signature}`,
    endsOn: new Date(exp * 1000).toISOString().slice(0, 10),
  };
}
