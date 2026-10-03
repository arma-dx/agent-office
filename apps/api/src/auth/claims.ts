import { z } from 'zod';

/**
 * Which verified Google identities may continue to complete_login (CLAUDE.md rule 3; 3 October
 * decisions 8 and 11). The database then decides whether the address has a valid invitation or a
 * membership.
 */

// Authentication methods that prove a second factor (RFC 8176).
const SECOND_FACTOR_METHODS = new Set(['mfa', 'hwk', 'swk']);
// Google is authoritative for its own consumer addresses.
const GOOGLE_CONSUMER_DOMAIN = 'gmail.com';

const claimsSchema = z.object({
  // Same rule as user_emails.google_sub in the database.
  sub: z.string().regex(/^[!-~]{1,255}$/),
  email: z.string().max(254).optional(),
  email_verified: z.boolean().optional(),
  hd: z.string().max(253).optional(),
  amr: z.array(z.string()).optional(),
  name: z.string().max(1000).optional(),
});

const emailSchema = z.email();

export interface IdentityPolicy {
  companyEmailDomains: readonly string[];
  requireAmr: boolean;
}

export interface AcceptedIdentity {
  sub: string;
  email: string;
  name: string;
}

// Reason codes of office.login_events (20261003110300_login_events.sql).
export type ClaimRejection = 'email_unverified' | 'mfa_missing' | 'not_allowed';

export type ClaimDecision =
  { ok: true; identity: AcceptedIdentity } | { ok: false; reason: ClaimRejection };

export function checkClaims(raw: unknown, policy: IdentityPolicy): ClaimDecision {
  const parsed = claimsSchema.safeParse(raw);
  if (!parsed.success || parsed.data.email === undefined) {
    return { ok: false, reason: 'not_allowed' };
  }
  const claims = parsed.data;
  if (claims.email_verified !== true) {
    return { ok: false, reason: 'email_unverified' };
  }
  const email = claims.email?.trim().toLowerCase() ?? '';
  if (!emailSchema.safeParse(email).success) {
    return { ok: false, reason: 'not_allowed' };
  }
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const hostedDomain = claims.hd?.toLowerCase();

  if (policy.companyEmailDomains.includes(domain)) {
    // A company address only from the company's own Workspace, where two-step verification is
    // enforced by the administrator.
    if (hostedDomain !== domain) {
      return { ok: false, reason: 'not_allowed' };
    }
  } else {
    // Google vouches for the address only for Gmail and for Workspace accounts (hd present).
    if (domain !== GOOGLE_CONSUMER_DOMAIN && (hostedDomain === undefined || hostedDomain === '')) {
      return { ok: false, reason: 'not_allowed' };
    }
    if (
      policy.requireAmr &&
      !(claims.amr ?? []).some((method) => SECOND_FACTOR_METHODS.has(method))
    ) {
      return { ok: false, reason: 'mfa_missing' };
    }
  }

  return { ok: true, identity: { sub: claims.sub, email, name: claims.name ?? '' } };
}
