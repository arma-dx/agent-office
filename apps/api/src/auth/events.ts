import type { DbClient } from '../db.ts';

/**
 * Login events (3 October decision 10): never an email or IP address, only the event, the account
 * and session when known, and a reason code from the fixed list in
 * 20261003110300_login_events.sql.
 */
export type LoginEvent = 'login' | 'logout' | 'logout_all' | 'rejected';

const REJECTION_REASONS = [
  'not_allowed',
  'account_mismatch',
  'inactive',
  'email_unverified',
  'mfa_missing',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** A complete_login result or a claim check as a reason code; anything unknown is not_allowed. */
export function rejectionReason(value: string | undefined): RejectionReason {
  return REJECTION_REASONS.find((reason) => reason === value) ?? 'not_allowed';
}

export async function recordLoginEvent(
  client: DbClient,
  event: LoginEvent,
  reason: RejectionReason | null,
  userId: string | null,
  sessionId: string | null,
): Promise<void> {
  await client.query('select office.record_login_event($1, $2, $3, $4)', [
    event,
    reason,
    userId,
    sessionId,
  ]);
}
