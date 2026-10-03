import type { Passkey } from '@agent-office/shared';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import { json, type ApiCall, type Handler } from './mock-api.ts';

/*
 * Fixtures for the passkey ceremonies. The test files mock @simplewebauthn/browser; these are the
 * answers the mocked startAuthentication and startRegistration give, in the shape the API checks.
 */

export const CREDENTIAL_ID = 'Y3JlZGVudGlhbC1vbmU';

/** What startAuthentication returns after the person confirmed with a passkey. */
export const ASSERTION: AuthenticationResponseJSON = {
  id: CREDENTIAL_ID,
  rawId: CREDENTIAL_ID,
  type: 'public-key',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
    // Public test value: SHA-256 of "localhost", flags UP and UV, counter 1. Not a secret.
    authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAQ', // gitleaks:allow
    signature: 'MEUCIQDx',
    userHandle: 'aGFuZGxlLW9mLW9tZXI',
  },
  clientExtensionResults: {},
};

/** What startRegistration returns after the browser created a passkey. */
export const ATTESTATION: RegistrationResponseJSON = {
  id: 'Y3JlZGVudGlhbC10d28',
  rawId: 'Y3JlZGVudGlhbC10d28',
  type: 'public-key',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
    attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjF',
    transports: ['internal', 'hybrid'],
  },
  clientExtensionResults: {},
};

export const STEP_UP_OPTIONS = {
  challenge: 'c3RlcC11cC1jaGFsbGVuZ2U',
  rpId: 'localhost',
  allowCredentials: [{ id: CREDENTIAL_ID, type: 'public-key', transports: ['internal'] }],
  userVerification: 'required',
  timeout: 300000,
} as const;

export const REGISTRATION_OPTIONS = {
  challenge: 'cmVnaXN0cmF0aW9uLWNoYWxsZW5nZQ',
  rp: { name: 'Agent Office', id: 'localhost' },
  user: { id: 'aGFuZGxlLW9mLW9tZXI', name: 'Ömer Kadıoğlu', displayName: 'Ömer Kadıoğlu' },
  pubKeyCredParams: [
    { alg: -8, type: 'public-key' },
    { alg: -7, type: 'public-key' },
    { alg: -257, type: 'public-key' },
  ],
  timeout: 300000,
  attestation: 'none',
  excludeCredentials: [],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
} as const;

/** Challenge ids are version 4 UUIDs, numbered so that a test can tell them apart. */
export function challengeId(n: number): string {
  return `0c4a11e0-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * POST /step-up/options: every call opens a new challenge, as the API does. `issued` lists them
 * in order, with the request that asked for each.
 */
export function stepUpIssuer() {
  const issued: { challengeId: string; body: unknown }[] = [];
  const handler: Handler = (call: ApiCall) => {
    const id = challengeId(issued.length + 1);
    issued.push({ challengeId: id, body: call.body });
    return json({ challengeId: id, options: STEP_UP_OPTIONS });
  };
  return { issued, handler };
}

/** The stepUp a protected request carries for a challenge, with ASSERTION as the answer. */
export function signed(id: string) {
  return { challengeId: id, response: ASSERTION };
}

export function passkey(overrides: Partial<Passkey> = {}): Passkey {
  return {
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    name: 'MacBook',
    createdAt: '2026-10-01T09:30:00.000Z',
    lastUsedAt: '2026-10-02T14:05:00.000Z',
    deviceType: 'multiDevice',
    backedUp: true,
    ...overrides,
  };
}

/** The error the browser reports when the person closes the passkey prompt (or it times out). */
export function cancelledByPerson(): Error {
  return Object.assign(new Error('The operation either timed out or was not allowed.'), {
    name: 'NotAllowedError',
  });
}
