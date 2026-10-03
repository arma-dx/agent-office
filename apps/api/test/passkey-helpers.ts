import {
  COMPANY_HEADER,
  apiErrorSchema,
  passkeySchema,
  registrationOptionsResponseSchema,
  stepUpOptionsResponseSchema,
  type Passkey,
  type RegistrationOptionsResponse,
  type StepUp,
  type StepUpOptionsRequest,
  type StepUpOptionsResponse,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import type { SoftwareAuthenticator, Spoil } from './authenticator.ts';
import { SAME_ORIGIN, SESSION_COOKIE, adminQuery, type TestServer } from './helpers.ts';

/** The panel's ceremonies, run against the test server with a software passkey. */

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** A request the panel sends with the session cookie (and, for company routes, the company). */
export function send(
  server: TestServer,
  session: string,
  method: Method,
  url: string,
  options: { payload?: object; company?: string } = {},
): Promise<LightMyRequestResponse> {
  return server.app.inject({
    method,
    url,
    cookies: { [SESSION_COOKIE]: session },
    headers: {
      ...SAME_ORIGIN,
      ...(options.company ? { [COMPANY_HEADER]: options.company } : {}),
    },
    ...(options.payload ? { payload: options.payload } : {}),
  });
}

export function errorCode(res: LightMyRequestResponse): string {
  return apiErrorSchema.parse(res.json()).error.code;
}

function expectStatus(res: LightMyRequestResponse, status: number): void {
  if (res.statusCode !== status) {
    throw new Error(`Expected ${String(status)}, got ${String(res.statusCode)}: ${res.body}`);
  }
}

export async function stepUpOptions(
  server: TestServer,
  session: string,
  request: StepUpOptionsRequest,
): Promise<StepUpOptionsResponse> {
  const res = await send(server, session, 'POST', '/api/step-up/options', { payload: request });
  expectStatus(res, 200);
  return stepUpOptionsResponseSchema.parse(res.json());
}

/** A re-verification signed by the authenticator (default: its newest passkey). */
export async function signStepUp(
  server: TestServer,
  session: string,
  authenticator: SoftwareAuthenticator,
  request: StepUpOptionsRequest,
  options: { credentialId?: string; spoil?: Spoil } = {},
): Promise<StepUp> {
  const { challengeId, options: requestOptions } = await stepUpOptions(server, session, request);
  return {
    challengeId,
    response: authenticator.get(requestOptions, options.credentialId, options.spoil),
  };
}

export async function registrationOptions(
  server: TestServer,
  session: string,
  name: string,
  stepUp?: StepUp,
): Promise<RegistrationOptionsResponse> {
  const res = await send(server, session, 'POST', '/api/passkeys/registration/options', {
    payload: { name, ...(stepUp ? { stepUp } : {}) },
  });
  expectStatus(res, 200);
  return registrationOptionsResponseSchema.parse(res.json());
}

/**
 * Registers a passkey on the authenticator: the first one directly (fresh sign-in), a further one
 * after a passkey_add re-verification with the authenticator's newest passkey.
 */
export async function addPasskey(
  server: TestServer,
  session: string,
  authenticator: SoftwareAuthenticator,
  name = 'Dizüstü bilgisayar',
  options: { further?: boolean } = {},
): Promise<Passkey> {
  const stepUp = options.further
    ? await signStepUp(server, session, authenticator, { purpose: 'passkey_add' })
    : undefined;
  const { challengeId, options: creationOptions } = await registrationOptions(
    server,
    session,
    name,
    stepUp,
  );
  const res = await send(server, session, 'POST', '/api/passkeys/registration', {
    payload: { challengeId, name, response: authenticator.create(creationOptions) },
  });
  expectStatus(res, 201);
  return passkeySchema.parse(res.json());
}

/**
 * A first passkey for the person on this authenticator. The test files share one database, so an
 * earlier file may have left the person a passkey whose private key this file does not hold; it is
 * revoked first with the privileged role.
 */
export async function freshPasskey(
  server: TestServer,
  session: string,
  authenticator: SoftwareAuthenticator,
  userId: string,
  name = 'Dizüstü bilgisayar',
): Promise<Passkey> {
  await adminQuery(
    'update office.passkeys set revoked_at = now() where user_id = $1 and revoked_at is null',
    [userId],
  );
  return addPasskey(server, session, authenticator, name);
}

export interface ChallengeState {
  failed_attempts: number;
  consumed: boolean;
}

export async function challengeState(challengeId: string): Promise<ChallengeState | undefined> {
  const [row] = await adminQuery<{ failed_attempts: number; consumed: boolean }>(
    `select failed_attempts, consumed_at is not null as consumed
     from office.passkey_challenges where id = $1`,
    [challengeId],
  );
  return row;
}
