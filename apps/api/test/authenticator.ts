import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { AuthenticationResponse, RegistrationResponse } from '@agent-office/shared';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software passkey for the tests. It answers the API's options the way a browser and a platform
 * authenticator do: an ES256 key pair from node:crypto, attestation "none", clientDataJSON with the
 * challenge and the origin, authenticator data with the RP ID hash and the user presence, user
 * verification and backup flags, and a DER signature. The API's real verification
 * (@simplewebauthn/server) runs on it. Each ceremony can be spoiled to test a refusal.
 */

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_DATA = 0x40;
// COSE: key type EC2, algorithm ES256, curve P-256.
const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;

export interface Spoil {
  // The origin the browser reports (default: the panel's).
  origin?: string;
  // The RP ID whose hash the authenticator signs (default: the one in the options).
  rpId?: string;
  // false: the authenticator did not verify the user (no PIN or biometrics).
  userVerified?: boolean;
  // A different challenge than the options' one.
  challenge?: string;
  // Signs other data than it reports.
  badSignature?: boolean;
  // The user handle reported with an assertion; null leaves it out.
  userHandle?: string | null;
  // The signature counter reported with an assertion.
  counter?: number;
  // The ceremony ran in a frame of another page: crossOrigin true, and the top page's origin when
  // the browser reports it (Safari does not).
  crossOrigin?: boolean;
  topOrigin?: string;
}

interface Credential {
  id: string;
  privateKey: KeyObject;
  userHandle: string;
  counter: number;
}

function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function clientData(type: string, challenge: string, origin: string, spoil: Spoil): Buffer {
  return Buffer.from(
    JSON.stringify({
      type,
      challenge,
      origin,
      crossOrigin: spoil.crossOrigin ?? false,
      ...(spoil.topOrigin === undefined ? {} : { topOrigin: spoil.topOrigin }),
    }),
    'utf8',
  );
}

export interface RegistrationOptions {
  challenge: string;
  rp: { id?: string | undefined };
  user: { id: string };
}

export interface AuthenticationOptions {
  challenge: string;
  rpId?: string | undefined;
}

export class SoftwareAuthenticator {
  readonly #origin: string;
  // Synced passkeys report 0 for ever; a security key counts every use.
  readonly #counting: boolean;
  readonly #credentials: Credential[] = [];

  constructor(origin: string, options: { counting?: boolean } = {}) {
    this.#origin = origin;
    this.#counting = options.counting ?? false;
  }

  /** The id of the newest credential this authenticator created. */
  get newest(): string {
    const credential = this.#credentials.at(-1);
    if (!credential) {
      throw new Error('The authenticator has no credential');
    }
    return credential.id;
  }

  /** navigator.credentials.create(): a new discoverable ES256 credential for the options' user. */
  create(options: RegistrationOptions, spoil: Spoil = {}): RegistrationResponse {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    if (jwk.x === undefined || jwk.y === undefined) {
      throw new Error('The public key has no coordinates');
    }
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [COSE_KTY, 2],
        [COSE_ALG, -7],
        [COSE_CRV, 1],
        [COSE_X, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
        [COSE_Y, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
      ]),
    );
    const credentialId = randomBytes(32);
    const credential: Credential = {
      id: credentialId.toString('base64url'),
      privateKey,
      userHandle: options.user.id,
      counter: 0,
    };
    this.#credentials.push(credential);

    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    const flags =
      FLAG_USER_PRESENT |
      (spoil.userVerified === false ? 0 : FLAG_USER_VERIFIED) |
      FLAG_BACKUP_ELIGIBLE |
      FLAG_BACKED_UP |
      FLAG_ATTESTED_DATA;
    const authenticatorData = Buffer.concat([
      sha256(spoil.rpId ?? options.rp.id ?? ''),
      Buffer.from([flags]),
      uint32(0),
      // AAGUID: none.
      Buffer.alloc(16),
      length,
      credentialId,
      coseKey,
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, string>()],
        ['authData', new Uint8Array(authenticatorData)],
      ]),
    );
    const clientDataJSON = clientData(
      'webauthn.create',
      spoil.challenge ?? options.challenge,
      spoil.origin ?? this.#origin,
      spoil,
    );
    return {
      id: credential.id,
      rawId: credential.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        attestationObject: Buffer.from(attestationObject).toString('base64url'),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** navigator.credentials.get() with one of its credentials (default: the newest). */
  get(
    options: AuthenticationOptions,
    credentialId: string = this.newest,
    spoil: Spoil = {},
  ): AuthenticationResponse {
    const credential = this.#credentials.find((item) => item.id === credentialId);
    if (!credential) {
      throw new Error('Unknown credential');
    }
    if (this.#counting) {
      credential.counter += 1;
    }
    const flags =
      FLAG_USER_PRESENT |
      (spoil.userVerified === false ? 0 : FLAG_USER_VERIFIED) |
      FLAG_BACKUP_ELIGIBLE |
      FLAG_BACKED_UP;
    const authenticatorData = Buffer.concat([
      sha256(spoil.rpId ?? options.rpId ?? ''),
      Buffer.from([flags]),
      uint32(spoil.counter ?? credential.counter),
    ]);
    const clientDataJSON = clientData(
      'webauthn.get',
      spoil.challenge ?? options.challenge,
      spoil.origin ?? this.#origin,
      spoil,
    );
    const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
    const signature = sign(
      'sha256',
      spoil.badSignature ? Buffer.concat([signed, Buffer.from([0])]) : signed,
      credential.privateKey,
    );
    const userHandle = spoil.userHandle === undefined ? credential.userHandle : spoil.userHandle;
    return {
      id: credential.id,
      rawId: credential.id,
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
        ...(userHandle === null ? {} : { userHandle }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
