import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appJwt } from '../src/github/jwt.ts';

// The signature a GitHub App shows to GitHub (RS256; issued a minute back, valid nine minutes,
// the client ID as issuer). The key pairs are made here: no line of the repository holds a key.

const NOW = 1_791_000_000;

function parts(jwt: string): {
  header: unknown;
  claims: unknown;
  signed: string;
  signature: Buffer;
} {
  const [header = '', claims = '', signature = ''] = jwt.split('.');
  const decode = (part: string): unknown =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
  return {
    header: decode(header),
    claims: decode(claims),
    signed: `${header}.${claims}`,
    signature: Buffer.from(signature, 'base64url'),
  };
}

describe('the signature of a GitHub App', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

  it('is a token of three base64url parts with the header and the claims GitHub asks for', () => {
    const jwt = appJwt('Iv23client', pair.privateKey, NOW);
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const { header, claims } = parts(jwt);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toEqual({ iat: NOW - 60, exp: NOW + 540, iss: 'Iv23client' });
  });

  it('verifies with the public half of its own key and with no other', () => {
    const { signed, signature } = parts(appJwt('Iv23client', pair.privateKey, NOW));
    expect(createVerify('RSA-SHA256').update(signed).verify(pair.publicKey, signature)).toBe(true);
    expect(createVerify('RSA-SHA256').update(signed).verify(other.publicKey, signature)).toBe(
      false,
    );
    // A changed claim does not carry the signature.
    const forged = signed.replace(
      /\.[^.]+$/,
      `.${Buffer.from('{"iss":"x"}').toString('base64url')}`,
    );
    expect(createVerify('RSA-SHA256').update(forged).verify(pair.publicKey, signature)).toBe(false);
  });

  it('says nothing of the key when it cannot sign', () => {
    // A public key cannot sign.
    let message = '';
    try {
      appJwt('Iv23client', pair.publicKey, NOW);
    } catch (error) {
      message = String(error);
    }
    expect(message).toBe('Error: The GitHub App signature could not be made');
  });
});
