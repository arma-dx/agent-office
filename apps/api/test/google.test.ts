import { createHash } from 'node:crypto';
import type { CustomFetch } from 'openid-client';
import { describe, expect, it } from 'vitest';
import { GoogleAuthProvider } from '../src/auth/google.ts';
import { newLoginChecks } from '../src/auth/login-cookie.ts';
import { AuthProviderError, type LoginChecks } from '../src/auth/provider.ts';

// The openid-client implementation against stand-in Google endpoints (no network, no database).

const ISSUER = 'https://accounts.google.com';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const settings = {
  clientId: 'client-id.apps.example.test',
  clientSecret: 'client-secret-placeholder',
  redirectUri: 'https://office.example.test/api/auth/google/callback',
};
const METADATA = {
  issuer: ISSUER,
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true,
};

function base64url(value: unknown): string {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
    'base64url',
  );
}

// The ID token comes straight from the token endpoint over TLS, so its signature is not checked
// (OpenID Connect Core 3.1.3.7); its claims are.
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER, aud: settings.clientId, iat: now, exp: now + 3600, ...claims };
  return `${base64url({ alg: 'RS256', kid: 'test' })}.${base64url(payload)}.${base64url('sig')}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class GoogleEndpoints {
  discoveries = 0;
  discoveryDown = false;
  tokenRequests: URLSearchParams[] = [];
  token: (checks: LoginChecks) => Response = () => json({ error: 'not set' }, 500);
  checks: LoginChecks = newLoginChecks();

  readonly fetch: CustomFetch = (url, options) => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      this.discoveries += 1;
      return this.discoveryDown
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(json(METADATA));
    }
    if (url === TOKEN_ENDPOINT) {
      this.tokenRequests.push(
        options.body instanceof URLSearchParams ? options.body : new URLSearchParams(),
      );
      return Promise.resolve(this.token(this.checks));
    }
    return Promise.reject(new Error(`Unexpected request to ${url}`));
  };
}

function setup() {
  const google = new GoogleEndpoints();
  const provider = new GoogleAuthProvider(settings, { fetch: google.fetch });
  google.token = (checks) =>
    json({
      access_token: 'access',
      token_type: 'Bearer',
      expires_in: 3599,
      id_token: idToken({
        sub: '1234567890',
        email: 'person@gmail.com',
        email_verified: true,
        amr: ['pwd', 'mfa'],
        nonce: checks.nonce,
      }),
    });
  return { google, provider, checks: google.checks };
}

function callbackQuery(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

async function failure(promise: Promise<unknown>): Promise<AuthProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AuthProviderError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('GoogleAuthProvider', () => {
  it('builds the authorization URL with PKCE, state, nonce, the amr request and the configured redirect', async () => {
    const { provider, checks } = setup();
    const url = await provider.buildAuthorizationUrl(checks);
    expect(url.origin + url.pathname).toBe(METADATA.authorization_endpoint);
    const params = Object.fromEntries(url.searchParams);
    expect(params).toEqual({
      client_id: settings.clientId,
      response_type: 'code',
      redirect_uri: settings.redirectUri,
      scope: 'openid email profile',
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: createHash('sha256').update(checks.codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      claims: JSON.stringify({
        id_token: { amr: { essential: true }, auth_time: { essential: true } },
      }),
    });
  });

  it('exchanges the code with the verifier and the configured redirect URI', async () => {
    const { google, provider, checks } = setup();
    const claims = await provider.handleCallback(
      callbackQuery({ code: 'auth-code', state: checks.state, iss: ISSUER }),
      checks,
    );
    expect(claims).toMatchObject({
      sub: '1234567890',
      email: 'person@gmail.com',
      email_verified: true,
      amr: ['pwd', 'mfa'],
      nonce: checks.nonce,
    });
    const [request] = google.tokenRequests;
    expect(Object.fromEntries(request ?? [])).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: checks.codeVerifier,
      redirect_uri: settings.redirectUri,
      client_id: settings.clientId,
    });
    // Discovery happened once and is reused.
    await provider.buildAuthorizationUrl(checks);
    expect(google.discoveries).toBe(1);
  });

  it('rejects a response with another state, without iss, or with an error', async () => {
    const { google, provider, checks } = setup();
    const responses: Record<string, string>[] = [
      { code: 'auth-code', state: 'another-state', iss: ISSUER },
      { code: 'auth-code', state: checks.state },
      { code: 'auth-code', state: checks.state, iss: 'https://issuer.example.test' },
      { error: 'access_denied', state: checks.state, iss: ISSUER },
    ];
    for (const query of responses) {
      const error = await failure(provider.handleCallback(callbackQuery(query), checks));
      expect(error.kind).toBe('rejected');
    }
    expect(google.tokenRequests).toEqual([]);
  });

  it('rejects an ID token with another nonce or audience', async () => {
    const { google, provider, checks } = setup();
    for (const claims of [
      { sub: '1', nonce: 'another-nonce' },
      { sub: '1', nonce: checks.nonce, aud: 'another-client' },
    ]) {
      google.token = () =>
        json({ access_token: 'a', token_type: 'Bearer', id_token: idToken(claims) });
      const error = await failure(
        provider.handleCallback(
          callbackQuery({ code: 'c', state: checks.state, iss: ISSUER }),
          checks,
        ),
      );
      expect(error.kind).toBe('rejected');
    }
  });

  it('tells a refused code (denied) from a Google failure (unavailable)', async () => {
    const { google, provider, checks } = setup();
    const query = callbackQuery({ code: 'c', state: checks.state, iss: ISSUER });
    google.token = () => json({ error: 'invalid_grant' }, 400);
    expect((await failure(provider.handleCallback(query, checks))).kind).toBe('rejected');
    google.token = () => json({ error: 'backend_error' }, 503);
    expect((await failure(provider.handleCallback(query, checks))).kind).toBe('unavailable');
    google.token = () => new Response('<html>Bad gateway</html>', { status: 502 });
    expect((await failure(provider.handleCallback(query, checks))).kind).toBe('unavailable');
  });

  it('reports a failed discovery as unavailable and tries again next time', async () => {
    const { google, provider, checks } = setup();
    google.discoveryDown = true;
    expect((await failure(provider.discover())).kind).toBe('unavailable');
    expect((await failure(provider.buildAuthorizationUrl(checks))).kind).toBe('unavailable');
    google.discoveryDown = false;
    await provider.buildAuthorizationUrl(checks);
    expect(google.discoveries).toBe(3);
  });
});
