/**
 * The identity provider behind "Sign in with Google". The routes generate the one-time values and
 * keep them in the login cookie; the provider builds the authorization URL and turns the callback
 * into verified ID token claims. Tests inject a fake provider.
 */
export interface LoginChecks {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface AuthProvider {
  buildAuthorizationUrl(checks: LoginChecks): Promise<URL>;
  /**
   * Validates the authorization response (state, iss), exchanges the code with the PKCE verifier
   * and returns the claims of the verified ID token (nonce checked). Throws AuthProviderError.
   */
  handleCallback(query: URLSearchParams, checks: LoginChecks): Promise<Record<string, unknown>>;
}

/**
 * rejected: the response or the token failed a check, or the person cancelled at Google.
 * unavailable: Google could not be reached or answered with a server error.
 */
export type AuthProviderFailure = 'rejected' | 'unavailable';

export class AuthProviderError extends Error {
  readonly kind: AuthProviderFailure;

  constructor(kind: AuthProviderFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthProviderError';
    this.kind = kind;
  }
}
