import { createHash, randomBytes } from 'node:crypto';
import type {
  AuthenticationResponse,
  RegistrationResponse,
  StepUp,
  StepUpPurpose,
} from '@agent-office/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { CommitThenFail, type DbClient, type Session } from './db.ts';
import type { RelyingParty } from './env.ts';
import { ApiError, databaseErrorCode } from './errors.ts';

/**
 * Passkeys and re-verification (3 October decision 7; 5 October decisions 2, 3, 4; CLAUDE.md rules
 * 3, 4). The API runs the WebAuthn ceremonies with @simplewebauthn/server and verifies every
 * signature. The database keeps the passkeys and the single-use challenges, decides when a
 * challenge may be opened, and requires a re-verification recorded in the same transaction for an
 * important approval, a membership change, removing a passkey, a founder's reset of a person's
 * passkeys and opening a task or a note to a person (migrations 20261003120000_passkeys,
 * 20261003120100_step_up and 20261005100000_outgoing_reset_grants).
 *
 * A challenge is 16 random bytes followed by a SHA-256 of what the ceremony is for (the context
 * hash): for a re-verification its purpose, company, subject and details; for a registration the
 * passkey's name. The action recomputes the hash from its own request and refuses a mismatch, so a
 * re-verification confirms exactly the change it was signed for, once.
 *
 * A ceremony that does not check out counts a failed attempt on its challenge (the fifth closes
 * it). The count is committed before the error is answered (CommitThenFail), or a rollback would
 * allow unlimited attempts.
 *
 * A ceremony that ran inside a frame of another page (clientDataJSON crossOrigin or topOrigin) is
 * refused: the panel never runs in a frame, and a page on a sibling subdomain could otherwise put
 * the panel's confirm button under its own. @simplewebauthn/server refuses it only when the browser
 * reports topOrigin, which Safari does not.
 */

// EdDSA, ES256, RS256. Without the list the library also offers ML-DSA on Node 24.7 and later.
export const SUPPORTED_ALGORITHM_IDS = [-8, -7, -257];
// The database closes a challenge after 5 minutes; the browser gives up at the same time.
export const CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;
// The database refuses an 11th active passkey; the API says so before the ceremony.
export const MAX_PASSKEYS = 10;

const RANDOM_BYTES = 16;
// The transports the database accepts; a browser may report others, which are left out.
const KNOWN_TRANSPORTS = new Set([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);
const MAX_TRANSPORTS = 7;

// Errors ----------------------------------------------------------------------------------------

export const stepUpRequired = (): ApiError =>
  new ApiError(
    403,
    'step_up_required',
    "Bu işlem için passkey ile yeniden doğrulama gerekiyor. İşlemi passkey'inizle onaylayın.",
  );

export const stepUpFailed = (): ApiError =>
  new ApiError(
    403,
    'step_up_failed',
    "Passkey doğrulaması geçmedi ya da süresi doldu. İşlemi yeniden başlatıp passkey'inizle onaylayın.",
  );

export const noPasskey = (): ApiError =>
  new ApiError(
    409,
    'no_passkey',
    "Kayıtlı passkey'iniz yok. Bu işlem için önce Güvenlik sayfasından passkey ekleyin; ilk passkey Google ile girişten sonraki 10 dakika içinde eklenebilir.",
  );

export const passkeyNotAllowed = (): ApiError =>
  new ApiError(
    403,
    'passkey_not_allowed',
    "Şu anda passkey eklenemez. İlk passkey, Google ile girişten sonraki 10 dakika içinde eklenir: çıkış yapıp yeniden girin ve hemen ekleyin. Sonraki passkey'ler için önce kayıtlı bir passkey ile doğrulama gerekir.",
  );

export const passkeyLimit = (): ApiError =>
  new ApiError(
    409,
    'passkey_limit',
    'En fazla 10 passkey kaydedilebilir. Yeni passkey eklemek için önce kullanmadığınız birini kaldırın.',
  );

export const passkeyExists = (): ApiError =>
  new ApiError(409, 'passkey_exists', 'Bu passkey zaten kayıtlı. Passkey listenizi denetleyin.');

export const passkeyRegistrationFailed = (): ApiError =>
  new ApiError(
    403,
    'passkey_registration_failed',
    'Passkey kaydı doğrulanamadı ya da süresi doldu. Passkey eklemeyi yeniden başlatın.',
  );

export const challengeLimit = (): ApiError =>
  new ApiError(
    429,
    'challenge_limit',
    'Açık doğrulama isteği çok fazla. Birkaç dakika bekleyip yeniden deneyin.',
  );

// Context hash ----------------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/** JSON with the object keys sorted and members without a value left out, so equal data hash equally. */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const members = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const member = value[key];
      return member === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(member)}`];
    });
  return `{${members.join(',')}}`;
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** What a re-verification confirms. The action builds it from its own request. */
export interface StepUpContext {
  purpose: StepUpPurpose;
  // approve, membership_change, invitation, passkey_reset, access_grant: the company of the
  // request; otherwise null.
  companyId: string | null;
  // The approval, the member, the invitation, the passkey's id, the person whose passkeys are
  // reset or the person a record is opened to; null for passkey_add.
  subjectId: string | null;
  details: JsonObject | null;
}

export function stepUpContextHash(context: StepUpContext): Buffer {
  return sha256(
    canonicalJson({
      purpose: context.purpose,
      companyId: context.companyId?.toLowerCase() ?? null,
      subjectId: context.subjectId?.toLowerCase() ?? null,
      details: context.details,
    }),
  );
}

/** A registration is bound to the name the person gave the passkey. */
export function registrationContextHash(name: string): Buffer {
  return sha256(canonicalJson({ purpose: 'register', name }));
}

// Frames ----------------------------------------------------------------------------------------

// What the browser reports about the page that ran the ceremony. Any other member is ignored.
const clientFrameSchema = z.looseObject({
  crossOrigin: z.boolean().optional(),
  topOrigin: z.string().optional(),
});

/**
 * Did the ceremony run inside a frame of another page? true also when clientDataJSON cannot be
 * read (the library would refuse it anyway).
 */
export function ranInForeignFrame(clientDataJSON: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
  } catch {
    return true;
  }
  const parsed = clientFrameSchema.safeParse(data);
  return !parsed.success || parsed.data.crossOrigin === true || parsed.data.topOrigin !== undefined;
}

// Database --------------------------------------------------------------------------------------

/** The signed-in request's transaction and session. */
export interface PasskeyScope {
  client: DbClient;
  session: Session;
}

export interface CredentialRow {
  id: string;
  transports: string[];
}

/** The person's active passkeys (the row policy shows only their own), oldest first. */
export async function activeCredentials({
  client,
  session,
}: PasskeyScope): Promise<CredentialRow[]> {
  const { rows } = await client.query<CredentialRow>(
    `select id, transports from office.passkeys
     where user_id = $1 and revoked_at is null
     order by created_at, id`,
    [session.userId],
  );
  return rows;
}

/** Opens a challenge of the session; the database decides whether it may be opened. */
async function openChallenge(
  { client, session }: PasskeyScope,
  purpose: 'register' | 'step_up',
  contextHash: Buffer,
): Promise<{ id: string; challenge: Buffer }> {
  const challenge = Buffer.concat([randomBytes(RANDOM_BYTES), contextHash]);
  try {
    const { rows } = await client.query<{ id: string }>(
      'select office.create_passkey_challenge($1, $2, $3, $4) as id',
      [session.keyHash, purpose, challenge, contextHash],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('create_passkey_challenge returned no id');
    }
    return { id, challenge };
  } catch (error) {
    // invalid_authorization_specification: no passkey for a re-verification; for a registration,
    // past the first passkey's window or without the passkey_add re-verification.
    const code = databaseErrorCode(error);
    if (code === '28000') {
      throw purpose === 'register' ? passkeyNotAllowed() : noPasskey();
    }
    // program_limit_exceeded: 10 open challenges in the session.
    if (code === '54000') {
      throw challengeLimit();
    }
    throw error;
  }
}

interface ChallengeRow {
  purpose: string;
  challenge: Buffer;
  context_hash: Buffer | null;
}

/** An open challenge of the session (unused, unexpired, fewer than 5 failed attempts). */
async function readChallenge(
  { client, session }: PasskeyScope,
  challengeId: string,
): Promise<ChallengeRow | undefined> {
  const { rows } = await client.query<ChallengeRow>(
    'select purpose, challenge, context_hash from office.get_passkey_challenge($1, $2)',
    [session.keyHash, challengeId],
  );
  return rows[0];
}

/**
 * Counts a failed attempt on the challenge and returns the error to throw: the runner commits the
 * count, then answers. The transaction must be usable here.
 */
async function failedAttempt(
  { client, session }: PasskeyScope,
  challengeId: string,
  error: ApiError,
): Promise<CommitThenFail> {
  await client.query('select office.consume_passkey_challenge($1, $2, false)', [
    session.keyHash,
    challengeId,
  ]);
  return new CommitThenFail(error);
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs a statement the database may refuse; a refusal leaves the transaction usable. */
async function attempt<T>(client: DbClient, run: () => Promise<T>): Promise<Attempt<T>> {
  await client.query('savepoint passkey_step');
  try {
    const value = await run();
    await client.query('release savepoint passkey_step');
    return { ok: true, value };
  } catch (error) {
    await client.query('rollback to savepoint passkey_step');
    return { ok: false, error };
  }
}

/** The person's WebAuthn user handle (16 random bytes, never personal data). */
async function webauthnHandle({ client, session }: PasskeyScope): Promise<Buffer> {
  const { rows } = await client.query<{ handle: Buffer }>(
    'select office.ensure_webauthn_handle($1) as handle',
    [session.keyHash],
  );
  const handle = rows[0]?.handle;
  if (!handle) {
    throw new Error('ensure_webauthn_handle returned no handle');
  }
  return handle;
}

interface AssertionKeyRow {
  public_key: Buffer;
  // bigint arrives as text.
  counter: string | number;
  transports: string[];
}

// Registration ----------------------------------------------------------------------------------

/**
 * Opens a registration and returns the options for startRegistration; `existing` (the person's
 * active passkeys) are excluded. The database refuses it unless it is the first passkey within 10
 * minutes of a Google sign-in, or a passkey_add re-verification of this session was recorded in
 * the last 5 minutes (which it uses up).
 */
export async function registrationOptions(
  scope: PasskeyScope,
  relyingParty: RelyingParty,
  name: string,
  existing: CredentialRow[],
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const { id, challenge } = await openChallenge(scope, 'register', registrationContextHash(name));
  const handle = await webauthnHandle(scope);
  const { rows } = await scope.client.query<{ name: string }>(
    'select name from office.users where id = $1',
    [scope.session.userId],
  );
  const person = rows[0]?.name;
  if (person === undefined) {
    throw new Error('The signed-in person was not found');
  }
  const options = await generateRegistrationOptions({
    rpName: relyingParty.name,
    rpID: relyingParty.id,
    // The person's name, never the address.
    userName: person,
    userDisplayName: person,
    userID: new Uint8Array(handle),
    challenge: new Uint8Array(challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
  });
  return { challengeId: id, options };
}

function toRegistrationJson(response: RegistrationResponse): RegistrationResponseJSON {
  return {
    id: response.id,
    rawId: response.rawId,
    type: 'public-key',
    response: {
      clientDataJSON: response.response.clientDataJSON,
      attestationObject: response.response.attestationObject,
      ...(response.response.transports ? { transports: response.response.transports } : {}),
    },
    clientExtensionResults: {},
  };
}

function knownTransports(reported: string[] | undefined): string[] {
  return [...new Set(reported ?? [])]
    .filter((transport) => KNOWN_TRANSPORTS.has(transport))
    .slice(0, MAX_TRANSPORTS);
}

/**
 * Verifies a registration against its challenge (origin, RP ID, user presence and verification,
 * algorithm) and stores the passkey. Returns the passkey's reference (its id in the API). A
 * registration that does not check out counts a failed attempt and is answered with 403
 * passkey_registration_failed after the commit.
 */
export async function registerPasskey(
  scope: PasskeyScope,
  relyingParty: RelyingParty,
  request: { challengeId: string; name: string; response: RegistrationResponse },
): Promise<string> {
  const { challengeId, name, response } = request;
  const challenge = await readChallenge(scope, challengeId);
  if (
    challenge?.purpose !== 'register' ||
    !challenge.context_hash?.equals(registrationContextHash(name)) ||
    ranInForeignFrame(response.response.clientDataJSON)
  ) {
    throw await failedAttempt(scope, challengeId, passkeyRegistrationFailed());
  }
  let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verified = await verifyRegistrationResponse({
      response: toRegistrationJson(response),
      expectedChallenge: challenge.challenge.toString('base64url'),
      expectedOrigin: relyingParty.origin,
      expectedRPID: relyingParty.id,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
  } catch {
    throw await failedAttempt(scope, challengeId, passkeyRegistrationFailed());
  }
  const info = verified.registrationInfo;
  // The library takes the credential id from the authenticator data; the reported one must match.
  if (!info?.userVerified || info.credential.id !== response.id) {
    throw await failedAttempt(scope, challengeId, passkeyRegistrationFailed());
  }
  const stored = await attempt(scope.client, () =>
    scope.client.query<{ ref: string }>(
      'select office.register_passkey($1, $2, $3, $4, $5, $6, $7, $8, $9) as ref',
      [
        scope.session.keyHash,
        challengeId,
        info.credential.id,
        Buffer.from(info.credential.publicKey),
        info.credential.counter,
        knownTransports(response.response.transports),
        info.credentialDeviceType,
        info.credentialBackedUp,
        name,
      ],
    ),
  );
  if (!stored.ok) {
    switch (databaseErrorCode(stored.error)) {
      // A passkey was added meanwhile to a registration opened as the first one, or the challenge
      // closed.
      case '28000':
        throw await failedAttempt(scope, challengeId, passkeyNotAllowed());
      case '22023':
        throw await failedAttempt(scope, challengeId, passkeyRegistrationFailed());
      case '54000':
        throw passkeyLimit();
      case '23505':
        throw passkeyExists();
      default:
        throw stored.error;
    }
  }
  const ref = stored.value.rows[0]?.ref;
  if (ref === undefined) {
    throw new Error('register_passkey returned no reference');
  }
  return ref;
}

// Re-verification -------------------------------------------------------------------------------

/**
 * Opens a re-verification and returns the options for startAuthentication: user verification
 * required, only the person's own passkeys allowed. 409 no_passkey when they have none.
 */
export async function stepUpOptions(
  scope: PasskeyScope,
  relyingParty: RelyingParty,
  context: StepUpContext,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const credentials = await activeCredentials(scope);
  if (credentials.length === 0) {
    throw noPasskey();
  }
  const { id, challenge } = await openChallenge(scope, 'step_up', stepUpContextHash(context));
  const options = await generateAuthenticationOptions({
    rpID: relyingParty.id,
    allowCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    challenge: new Uint8Array(challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'required',
  });
  return { challengeId: id, options };
}

function toAuthenticationJson(response: AuthenticationResponse): AuthenticationResponseJSON {
  const { clientDataJSON, authenticatorData, signature, userHandle } = response.response;
  return {
    id: response.id,
    rawId: response.rawId,
    type: 'public-key',
    response: {
      clientDataJSON,
      authenticatorData,
      signature,
      ...(userHandle ? { userHandle } : {}),
    },
    clientExtensionResults: {},
  };
}

/** The new signature counter of a verified assertion, or null when it does not verify. */
async function verifyAssertion(
  relyingParty: RelyingParty,
  response: AuthenticationResponse,
  challenge: Buffer,
  credential: WebAuthnCredential,
): Promise<number | null> {
  try {
    const result = await verifyAuthenticationResponse({
      response: toAuthenticationJson(response),
      expectedChallenge: challenge.toString('base64url'),
      expectedOrigin: relyingParty.origin,
      expectedRPID: relyingParty.id,
      credential,
      requireUserVerification: true,
    });
    return result.verified && result.authenticationInfo.userVerified
      ? result.authenticationInfo.newCounter
      : null;
  } catch {
    return null;
  }
}

/**
 * Checks a re-verification and records it (record_step_up) in the request's transaction, before
 * the action it confirms; the database then lets that action use it up, in this transaction only.
 * Without stepUp: 403 step_up_required. One that does not check out (unknown, used or expired
 * challenge; signed for another purpose, company, subject or change; another person's or a revoked
 * passkey; a ceremony inside another page's frame; a user handle, origin, RP ID, user
 * verification, signature or counter that does not verify) counts a failed attempt and is answered
 * with 403 step_up_failed after the commit.
 */
export async function verifyStepUp(
  scope: PasskeyScope,
  relyingParty: RelyingParty,
  stepUp: StepUp | undefined,
  context: StepUpContext,
): Promise<void> {
  if (!stepUp) {
    throw stepUpRequired();
  }
  const { challengeId, response } = stepUp;
  const contextHash = stepUpContextHash(context);
  const challenge = await readChallenge(scope, challengeId);
  if (challenge?.purpose !== 'step_up' || !challenge.context_hash?.equals(contextHash)) {
    throw await failedAttempt(scope, challengeId, stepUpFailed());
  }

  // Looked up by the credential id AND the session's person; the library checks neither.
  const { rows } = await scope.client.query<AssertionKeyRow>(
    'select public_key, counter, transports from office.get_passkey_for_assertion($1, $2)',
    [scope.session.keyHash, response.id],
  );
  const key = rows[0];
  const handle = await webauthnHandle(scope);
  if (
    !key ||
    response.response.userHandle !== handle.toString('base64url') ||
    ranInForeignFrame(response.response.clientDataJSON)
  ) {
    throw await failedAttempt(scope, challengeId, stepUpFailed());
  }
  const newCounter = await verifyAssertion(relyingParty, response, challenge.challenge, {
    id: response.id,
    publicKey: new Uint8Array(key.public_key),
    counter: Number(key.counter),
    transports: key.transports,
  });
  if (newCounter === null) {
    throw await failedAttempt(scope, challengeId, stepUpFailed());
  }

  const recorded = await attempt(scope.client, () =>
    scope.client.query('select office.record_step_up($1, $2, $3, $4, $5, $6, $7, $8)', [
      scope.session.keyHash,
      challengeId,
      response.id,
      newCounter,
      context.purpose,
      context.companyId,
      context.subjectId,
      contextHash,
    ]),
  );
  if (!recorded.ok) {
    // invalid_authorization_specification: the challenge closed meanwhile, or the counter did not
    // increase (a cloned authenticator); invalid_parameter_value: a subject that is not the
    // person's active passkey.
    const code = databaseErrorCode(recorded.error);
    if (code === '28000' || code === '22023') {
      throw await failedAttempt(scope, challengeId, stepUpFailed());
    }
    throw recorded.error;
  }
}
