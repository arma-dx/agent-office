import { createSign, type KeyObject } from 'node:crypto';

/**
 * The signature a GitHub App shows to GitHub: a JSON Web Token signed with the app's private key
 * (RS256). GitHub accepts it for at most ten minutes; the issue time is set a minute back for
 * clocks that differ, and the token ends nine minutes from now. The issuer is the app's client ID.
 * Made with node:crypto alone; nothing of the key is in an error this function throws.
 */
export const APP_JWT_BACKDATE_SECONDS = 60;
export const APP_JWT_LIFETIME_SECONDS = 540;

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

export function appJwt(clientId: string, key: KeyObject, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iat: nowSeconds - APP_JWT_BACKDATE_SECONDS,
      exp: nowSeconds + APP_JWT_LIFETIME_SECONDS,
      iss: clientId,
    }),
  );
  const signed = `${header}.${claims}`;
  let signature: Buffer;
  try {
    signature = createSign('RSA-SHA256').update(signed).sign(key);
  } catch {
    // The original error may describe the key; this one does not.
    throw new Error('The GitHub App signature could not be made');
  }
  return `${signed}.${base64url(signature)}`;
}
