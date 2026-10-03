import { describe, expect, it } from 'vitest';
import { checkClaims, type IdentityPolicy } from '../src/auth/claims.ts';

// Which verified Google identities may go on to complete_login (no database needed).

const policy: IdentityPolicy = {
  companyEmailDomains: ['armadx.test', 'pillika.test'],
  requireAmr: true,
};

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: '1234567890',
    email: 'person@gmail.com',
    email_verified: true,
    name: 'Kişi',
    amr: ['pwd', 'mfa'],
    ...overrides,
  };
}

describe('checkClaims', () => {
  it('accepts a verified Gmail account with a second factor and lowercases the address', () => {
    expect(checkClaims(claims({ email: 'Person@Gmail.com ' }), policy)).toEqual({
      ok: true,
      identity: { sub: '1234567890', email: 'person@gmail.com', name: 'Kişi' },
    });
  });

  it('accepts hwk and swk as a second factor too', () => {
    for (const method of ['hwk', 'swk']) {
      expect(checkClaims(claims({ amr: [method] }), policy).ok).toBe(true);
    }
  });

  it('rejects an unverified address before anything else', () => {
    for (const verified of [false, undefined, 'true']) {
      const decision = checkClaims(
        claims({ email_verified: verified, email: 'a@armadx.test' }),
        policy,
      );
      expect(decision).toEqual(
        verified === 'true'
          ? { ok: false, reason: 'not_allowed' }
          : { ok: false, reason: 'email_unverified' },
      );
    }
  });

  it('accepts a company address only with the matching hd, without amr', () => {
    const company = { email: 'omer@armadx.test', amr: undefined };
    expect(checkClaims(claims({ ...company, hd: 'armadx.test' }), policy).ok).toBe(true);
    expect(checkClaims(claims({ ...company, hd: 'ArmaDX.test' }), policy).ok).toBe(true);
    for (const hd of [undefined, 'pillika.test', 'gmail.com']) {
      expect(checkClaims(claims({ ...company, hd }), policy)).toEqual({
        ok: false,
        reason: 'not_allowed',
      });
    }
  });

  it('needs Google to be authoritative for other addresses: Gmail or a Workspace (hd)', () => {
    expect(checkClaims(claims({ email: 'a@lawfirm.test', hd: 'lawfirm.test' }), policy).ok).toBe(
      true,
    );
    for (const hd of [undefined, '']) {
      expect(checkClaims(claims({ email: 'a@yahoo.test', hd }), policy)).toEqual({
        ok: false,
        reason: 'not_allowed',
      });
    }
  });

  it('rejects an external account without a second factor unless the check is off', () => {
    for (const amr of [undefined, [], ['pwd'], 'mfa']) {
      const decision = checkClaims(claims({ amr }), policy);
      expect(decision).toEqual(
        amr === 'mfa' ? { ok: false, reason: 'not_allowed' } : { ok: false, reason: 'mfa_missing' },
      );
    }
    expect(checkClaims(claims({ amr: ['pwd'] }), { ...policy, requireAmr: false }).ok).toBe(true);
  });

  it('rejects malformed claims', () => {
    for (const overrides of [
      { sub: '' },
      { sub: 'has space' },
      { email: undefined },
      { email: 'not-an-address' },
      { name: 42 },
    ]) {
      expect(checkClaims(claims(overrides), policy)).toEqual({ ok: false, reason: 'not_allowed' });
    }
    expect(checkClaims(null, policy)).toEqual({ ok: false, reason: 'not_allowed' });
  });
});
