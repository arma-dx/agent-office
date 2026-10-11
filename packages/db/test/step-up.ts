import { randomBytes } from 'node:crypto';
import type { ContextInput } from '../src/context.ts';
import type { Tx } from './helpers.ts';

/**
 * Passkey helpers for the database tests (3 October decision 7; 5 October decisions 3 and 4). They
 * call the same functions the API calls. The database never checks a WebAuthn signature (the API
 * does), so a test passes the values the API would pass after verifying one.
 */

export type StepUpPurpose =
  | 'approve'
  | 'membership_change'
  | 'invitation'
  | 'passkey_add'
  | 'passkey_revoke'
  | 'passkey_reset'
  | 'access_grant'
  | 'project_ai_permission'
  | 'customer_ai_permission'
  | 'project_ai_spending_limit';

export interface TestSession {
  id: string;
  // The SHA-256 of the cookie key; tests use any 32 bytes.
  key: Buffer;
}

// Purposes whose re-verification names a company (rule 2); the others belong to the person alone.
const COMPANY_PURPOSES: StepUpPurpose[] = [
  'approve',
  'membership_change',
  'invitation',
  'passkey_reset',
  'access_grant',
  'project_ai_permission',
  'customer_ai_permission',
  'project_ai_spending_limit',
];

function first<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`${what}: no row`);
  }
  return row;
}

/**
 * Opens a session for the person through the login functions, as the API does after a Google
 * sign-in: completes the login when the address is not bound to a Google account yet. Leaves the
 * context set to the login context; the caller sets its own context again.
 */
export async function openTestSession(tx: Tx, userId: string): Promise<TestSession> {
  await tx.setContext({ userId });
  const address = first(
    await tx.rows<{ email: string; google_sub: string | null }>(
      'select email, google_sub from office.user_emails where user_id = $1 order by email limit 1',
      [userId],
    ),
    'address',
  );
  const sub = address.google_sub ?? `google-sub-${userId}`;
  await tx.setContext({ email: address.email });
  if (address.google_sub === null) {
    const login = first(
      await tx.rows<{ result: string }>('select result from office.complete_login($1, $2)', [
        sub,
        'Test Person',
      ]),
      'complete_login',
    );
    if (login.result !== 'ok') {
      throw new Error(`complete_login returned ${login.result}`);
    }
  }
  const key = randomBytes(32);
  const row = first(
    await tx.rows<{ id: string }>(
      `select office.open_session($1, $2, now() + interval '8 hours') as id`,
      [key, sub],
    ),
    'open_session',
  );
  return { id: row.id, key };
}

/** Opens a challenge of the session and returns its id. */
export async function createChallenge(
  tx: Tx,
  session: TestSession,
  purpose: 'register' | 'step_up',
  contextHash: Buffer | null = purpose === 'step_up' ? randomBytes(32) : null,
): Promise<string> {
  const row = first(
    await tx.rows<{ id: string }>('select office.create_passkey_challenge($1, $2, $3, $4) as id', [
      session.key,
      purpose,
      randomBytes(48),
      contextHash,
    ]),
    'create_passkey_challenge',
  );
  return row.id;
}

export interface NewPasskey {
  credentialId: string;
  ref: string;
}

/**
 * Registers a passkey with an open register challenge (or a new one) of the session. The context
 * must be the session's person.
 */
export async function registerPasskey(
  tx: Tx,
  session: TestSession,
  challengeId?: string,
  name = 'Test passkey',
): Promise<NewPasskey> {
  const challenge = challengeId ?? (await createChallenge(tx, session, 'register'));
  const credentialId = randomBytes(32).toString('base64url');
  const row = first(
    await tx.rows<{ ref: string }>(
      `select office.register_passkey($1, $2, $3, $4, 0, '{internal,hybrid}', 'multiDevice', true,
         $5) as ref`,
      [session.key, challenge, credentialId, randomBytes(77), name],
    ),
    'register_passkey',
  );
  return { credentialId, ref: row.ref };
}

export interface StepUpInput {
  purpose: StepUpPurpose;
  subjectId: string | null;
  credentialId: string;
  counter?: number;
}

/**
 * Records a re-verification with a new step_up challenge of the session, as the API does after it
 * verified the assertion. The context must be the session's person (and, for a purpose that names a
 * company, the company). Returns the re-verification's id.
 */
export async function recordStepUp(
  tx: Tx,
  session: TestSession,
  companyId: string | null,
  input: StepUpInput,
): Promise<string> {
  const contextHash = randomBytes(32);
  const challenge = await createChallenge(tx, session, 'step_up', contextHash);
  const row = first(
    await tx.rows<{ id: string }>(
      'select office.record_step_up($1, $2, $3, $4, $5, $6, $7, $8) as id',
      [
        session.key,
        challenge,
        input.credentialId,
        input.counter ?? 0,
        input.purpose,
        COMPANY_PURPOSES.includes(input.purpose) ? companyId : null,
        input.subjectId,
        contextHash,
      ],
    ),
    'record_step_up',
  );
  return row.id;
}

/**
 * A passkey re-verification of the context person in the open transaction, for an approval, a
 * membership or account change, an invitation, a passkey change, a passkey reset or an access
 * grant: opens a session (or uses the given one, for a function that checks the session of the
 * re-verification), registers a passkey on it if the person has none, and records the
 * re-verification. Sets the given context again at the end.
 */
export async function stepUp(
  tx: Tx,
  context: ContextInput,
  purpose: StepUpPurpose,
  subjectId: string | null,
  session?: TestSession,
): Promise<string> {
  const userId = context.userId;
  if (!userId) {
    throw new Error('A re-verification needs a person in the context');
  }
  const used = session ?? (await openTestSession(tx, userId));
  await tx.setContext(context);
  const existing = await tx.rows<{ id: string }>(
    `select id from office.passkeys where user_id = $1 and revoked_at is null
     order by created_at, id limit 1`,
    [userId],
  );
  const credentialId = existing[0]?.id ?? (await registerPasskey(tx, used)).credentialId;
  return recordStepUp(tx, used, context.companyId ?? null, {
    purpose,
    subjectId,
    credentialId,
  });
}
