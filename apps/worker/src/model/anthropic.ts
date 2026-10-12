import Anthropic from '@anthropic-ai/sdk';
import {
  ModelCallError,
  type CallModel,
  type CountFileTokens,
  type ModelErrorCode,
} from './client.ts';

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
 * retry-after); the runner bounds everything with its own deadline through the signal. One thing
 * it would retry is kept from it: a call that reached its time limit. The limit is held here with
 * a signal of its own, which ends the call without a retry (the SDK would send the same request
 * two more times, each as slow as the first, and none of it would be recorded). Every send is
 * counted and returned with the answer or the error.
 */
const API_ADDRESS = 'https://api.anthropic.com';
const MAX_RETRIES = 2;
const SDK_TIMEOUT_SLACK_MS = 30_000;

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

/** The one client both calls are made with: the options the header above explains. */
function newClient(apiKey: string, options: AnthropicModelOptions): Anthropic {
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: API_ADDRESS,
    maxRetries: MAX_RETRIES,
    logLevel: 'off',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/** What a failed call throws: a code, the status and the request id; never the provider's text. */
function failureOf(error: unknown, signal: AbortSignal, sends: number): ModelCallError {
  const status: unknown = error instanceof Anthropic.APIError ? error.status : null;
  const requestId: unknown = error instanceof Anthropic.APIError ? error.requestID : null;
  // Ended by a signal: the runner's (its deadline, a stop) or the call's own time limit.
  const timedOut = error instanceof Anthropic.APIUserAbortError && !signal.aborted;
  return new ModelCallError(
    timedOut ? 'anthropic_timeout' : codeOf(error),
    typeof status === 'number' ? status : null,
    typeof requestId === 'string' ? requestId : null,
    errorType(error),
    sends,
  );
}

export function createAnthropicModel(
  apiKey: string,
  options: AnthropicModelOptions = {},
): CallModel {
  const client = newClient(apiKey, options);
  return async (params, { signal, timeoutMs }) => {
    let sends = 0;
    // A client of this one call: the same options, and a fetch that counts.
    const counting = client.withOptions({
      fetch: (input, init) => {
        sends += 1;
        return (options.fetch ?? globalThis.fetch)(input, init);
      },
    });
    const limit = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
    try {
      const { data, request_id } = await counting.messages
        .create(params, {
          signal: AbortSignal.any([signal, limit]),
          // The SDK's own timeout is only a backstop behind the signal above.
          timeout: timeoutMs + SDK_TIMEOUT_SLACK_MS,
          maxRetries: MAX_RETRIES,
        })
        .withResponse();
      return { message: data, requestId: request_id ?? null, sends };
    } catch (error) {
      throw failureOf(error, signal, sends);
    }
  };
}

/**
 * The provider's token count for one file (client.ts, CountFileTokens): one user message that
 * holds the file's block and nothing else, sent to the counting endpoint. The same client, the
 * same retries and the same time limit as a model call; nothing is logged.
 */
export function createAnthropicTokenCounter(
  apiKey: string,
  options: AnthropicModelOptions = {},
): CountFileTokens {
  const client = newClient(apiKey, options);
  return async ({ model, block }, { signal, timeoutMs }) => {
    let sends = 0;
    const counting = client.withOptions({
      fetch: (input, init) => {
        sends += 1;
        return (options.fetch ?? globalThis.fetch)(input, init);
      },
    });
    const limit = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
    try {
      const counted = await counting.messages.countTokens(
        { model, messages: [{ role: 'user', content: [block] }] },
        {
          signal: AbortSignal.any([signal, limit]),
          timeout: timeoutMs + SDK_TIMEOUT_SLACK_MS,
          maxRetries: MAX_RETRIES,
        },
      );
      return counted.input_tokens;
    } catch (error) {
      throw failureOf(error, signal, sends);
    }
  };
}
