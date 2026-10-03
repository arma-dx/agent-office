import * as oidc from 'openid-client';
import type { GoogleSettings } from '../env.ts';
import { AuthProviderError, type AuthProvider, type LoginChecks } from './provider.ts';

const GOOGLE_ISSUER = new URL('https://accounts.google.com');
const SCOPE = 'openid email profile';
// Seconds for discovery and for every request to Google.
const TIMEOUT_SECONDS = 10;
// The two-step signal (amr) and the time of authentication are requested explicitly.
const CLAIMS_REQUEST = JSON.stringify({
  id_token: { amr: { essential: true }, auth_time: { essential: true } },
});
// Answers that mean Google itself failed, not the sign-in.
const SERVER_FAILURE_CODES = new Set([
  'OAUTH_RESPONSE_IS_NOT_CONFORM',
  'OAUTH_RESPONSE_IS_NOT_JSON',
]);
const SERVER_FAILURE_ERRORS = new Set(['server_error', 'temporarily_unavailable']);

function classify(error: unknown): AuthProviderError {
  if (error instanceof AuthProviderError) {
    return error;
  }
  let kind: 'rejected' | 'unavailable' = 'unavailable';
  if (error instanceof oidc.AuthorizationResponseError) {
    kind = SERVER_FAILURE_ERRORS.has(error.error) ? 'unavailable' : 'rejected';
  } else if (error instanceof oidc.ResponseBodyError) {
    kind = error.status >= 500 ? 'unavailable' : 'rejected';
  } else if (error instanceof oidc.ClientError) {
    kind = SERVER_FAILURE_CODES.has(error.code ?? '') ? 'unavailable' : 'rejected';
  }
  // Only the class name travels on; the original error may carry response bodies.
  const name = error instanceof Error ? error.name : typeof error;
  return new AuthProviderError(kind, `Google sign-in failed (${name})`);
}

/**
 * Google through openid-client: authorization code flow with PKCE (S256), state and nonce. The
 * discovery document is fetched at startup and cached; a failed discovery is retried on the next
 * sign-in. The redirect URI comes only from the environment, never from Host or X-Forwarded
 * headers.
 */
export class GoogleAuthProvider implements AuthProvider {
  readonly #settings: GoogleSettings;
  readonly #fetch: oidc.CustomFetch | undefined;
  #configuration: Promise<oidc.Configuration> | undefined;

  /** `fetch` replaces the HTTP client; only tests pass it, to stand in for Google's endpoints. */
  constructor(settings: GoogleSettings, options: { fetch?: oidc.CustomFetch } = {}) {
    this.#settings = settings;
    this.#fetch = options.fetch;
  }

  /** Starts discovery; the returned promise rejects with AuthProviderError when it fails. */
  async discover(): Promise<void> {
    await this.#getConfiguration();
  }

  #getConfiguration(): Promise<oidc.Configuration> {
    this.#configuration ??= oidc
      .discovery(
        GOOGLE_ISSUER,
        this.#settings.clientId,
        undefined,
        oidc.ClientSecretPost(this.#settings.clientSecret),
        {
          timeout: TIMEOUT_SECONDS,
          ...(this.#fetch ? { [oidc.customFetch]: this.#fetch } : {}),
        },
      )
      .catch((error: unknown) => {
        this.#configuration = undefined;
        throw new AuthProviderError('unavailable', 'Google discovery failed', {
          cause: classify(error),
        });
      });
    return this.#configuration;
  }

  async buildAuthorizationUrl(checks: LoginChecks): Promise<URL> {
    const configuration = await this.#getConfiguration();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(checks.codeVerifier);
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.#settings.redirectUri,
      scope: SCOPE,
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      claims: CLAIMS_REQUEST,
    });
  }

  async handleCallback(
    query: URLSearchParams,
    checks: LoginChecks,
  ): Promise<Record<string, unknown>> {
    const configuration = await this.#getConfiguration();
    // The current URL is rebuilt from the configured redirect URI and the incoming query (code,
    // state, iss and the rest); openid-client sends the URI without the query as redirect_uri.
    const currentUrl = new URL(this.#settings.redirectUri);
    for (const [name, value] of query) {
      currentUrl.searchParams.append(name, value);
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.codeVerifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) {
        throw new AuthProviderError('rejected', 'No ID token in the token response');
      }
      return { ...claims };
    } catch (error) {
      throw classify(error);
    }
  }
}
