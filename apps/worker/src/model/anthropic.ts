import Anthropic from '@anthropic-ai/sdk';
import { ModelCallError, type CallModel, type ModelErrorCode } from './client.ts';

/**
 * The Claude API client: the only file that loads the SDK as a value and the only place the key
 * is used.
 *
 * The SDK reads the environment by itself. What it would take from there is switched off here,
 * option by option, so that a variable or a signed-in profile on the machine cannot change where
 * requests go, who pays for them or what is logged (7 October decision 12: model calls are paid
 * with the API key only):
 *   - the address is passed explicitly (ANTHROPIC_BASE_URL is not used);
 *   - the key is passed explicitly and the bearer token is set to "none" (ANTHROPIC_AUTH_TOKEN is
 *     not sent next to the key; with a key the SDK does not look for a profile either);
 *   - the SDK's own logging is off (ANTHROPIC_LOG cannot turn on request logging: the worker's
 *     log holds codes and ids only).
 * One variable cannot be switched off by an option: ANTHROPIC_CUSTOM_HEADERS, whose headers the
 * SDK adds to every request. The worker refuses to start when it is set (env.ts).
 *
 * The SDK retries by itself (408, 409, 429, 5xx and connection errors, with the server's
 * retry-after); the runner bounds everything with its own deadline through the signal.
 */
const API_ADDRESS = 'https://api.anthropic.com';
const MAX_RETRIES = 2;

export interface AnthropicModelOptions {
  // The fetch the client sends with; tests pass a stub, so no request leaves the machine.
  fetch?: typeof globalThis.fetch;
}

/** The provider's own class of the error (billing_error, overloaded_error, ...): a code, never text. */
export function errorType(error: unknown): string | null {
  if (!(error instanceof Anthropic.APIError)) return null;
  const type: unknown = error.type;
  return typeof type === 'string' && /^[a-z_]{1,40}$/.test(type) ? type : null;
}

function codeOf(error: unknown): ModelErrorCode {
  // Most specific first: a connection error is also an APIError in this SDK.
  if (error instanceof Anthropic.APIUserAbortError) return 'aborted';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'anthropic_timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'anthropic_unreachable';
  if (error instanceof Anthropic.RateLimitError) return 'anthropic_rate_limited';
  // 402, type billing_error: a new account without balance or payment method. Told apart because
  // only the founder can remove it, in the provider's console.
  if (
    error instanceof Anthropic.APIError &&
    (error.status === 402 || errorType(error) === 'billing_error')
  ) {
    return 'anthropic_billing';
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return 'anthropic_auth_failed';
  }
  if (error instanceof Anthropic.NotFoundError) return 'anthropic_model_not_found';
  if (error instanceof Anthropic.BadRequestError) return 'anthropic_request_invalid';
  if (error instanceof Anthropic.InternalServerError) {
    return error.type === 'overloaded_error' ? 'anthropic_overloaded' : 'anthropic_error';
  }
  return 'anthropic_error';
}

export function createAnthropicModel(
  apiKey: string,
  options: AnthropicModelOptions = {},
): CallModel {
  const client = new Anthropic({
    apiKey,
    authToken: null,
    baseURL: API_ADDRESS,
    maxRetries: MAX_RETRIES,
    logLevel: 'off',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return async (params, { signal, timeoutMs }) => {
    try {
      const { data, request_id } = await client.messages
        .create(params, { signal, timeout: timeoutMs, maxRetries: MAX_RETRIES })
        .withResponse();
      return { message: data, requestId: request_id ?? null };
    } catch (error) {
      const status: unknown = error instanceof Anthropic.APIError ? error.status : null;
      const requestId: unknown = error instanceof Anthropic.APIError ? error.requestID : null;
      throw new ModelCallError(
        codeOf(error),
        typeof status === 'number' ? status : null,
        typeof requestId === 'string' ? requestId : null,
        errorType(error),
      );
    }
  };
}
