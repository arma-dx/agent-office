import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicModel } from '../src/model/anthropic.ts';
import { ModelCallError, type ModelRequest } from '../src/model/client.ts';

// The one file that talks to the Claude API, against a fetch stub: no request leaves the machine.
// What is pinned here is what the runner relies on and what an SDK upgrade could change without a
// type error: which error becomes which code, how often a request is sent, that the provider's
// text never reaches the thrown error, and that nothing in the environment changes where the
// request goes or which credential it carries.

const KEY = `sk-ant-test-${'0'.repeat(30)}`;
const PROVIDER_TEXT = 'SECRET PROMPT TEXT quoted by the provider';
const PARAMS: ModelRequest = {
  model: 'claude-test',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'x' }],
};

interface Sent {
  url: string;
  headers: Record<string, string>;
}

type Behaviour = (init: RequestInit) => Promise<Response> | Response;

function stub(behaviour: Behaviour): { sent: Sent[]; fetch: typeof globalThis.fetch } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init = {}) => {
      const url = input instanceof Request ? input.url : input.toString();
      sent.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()) });
      return Promise.resolve(behaviour(init));
    },
  };
}

/** An error answer of the provider; "retry-after-ms" keeps the SDK's back-off out of the test. */
const failure =
  (status: number, type: string): Behaviour =>
  () =>
    new Response(JSON.stringify({ type: 'error', error: { type, message: PROVIDER_TEXT } }), {
      status,
      headers: {
        'content-type': 'application/json',
        'request-id': 'req_stub',
        'retry-after-ms': '1',
      },
    });

const answer: Behaviour = () =>
  new Response(
    JSON.stringify({
      id: 'msg_stub',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_ok' } },
  );

/** A request the provider never answers; it ends when the request's signal fires. */
const silence: Behaviour = (init) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });

async function failureOf(
  behaviour: Behaviour,
  options: { timeoutMs?: number; abortAfterMs?: number } = {},
): Promise<{ error: ModelCallError; sends: number }> {
  const { sent, fetch } = stub(behaviour);
  const controller = new AbortController();
  if (options.abortAfterMs !== undefined) {
    setTimeout(() => {
      controller.abort();
    }, options.abortAfterMs);
  }
  const thrown: unknown = await createAnthropicModel(KEY, { fetch })(PARAMS, {
    signal: controller.signal,
    timeoutMs: options.timeoutMs ?? 5000,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  if (!(thrown instanceof ModelCallError)) throw new Error('The call did not fail as expected');
  return { error: thrown, sends: sent.length };
}

describe('the Claude API client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the message with the provider’s request id', async () => {
    const { sent, fetch } = stub(answer);
    const result = await createAnthropicModel(KEY, { fetch })(PARAMS, {
      signal: new AbortController().signal,
      timeoutMs: 5000,
    });
    expect(result.requestId).toBe('req_ok');
    expect(result.message).toMatchObject({ id: 'msg_stub', stop_reason: 'end_turn' });
    expect(sent).toHaveLength(1);
  });

  it('turns each failure into its code, and sends again only what may succeed', async () => {
    const cases: [string, Behaviour, { code: string; status: number | null; sends: number }][] = [
      [
        '401',
        failure(401, 'authentication_error'),
        { code: 'anthropic_auth_failed', status: 401, sends: 1 },
      ],
      [
        '403',
        failure(403, 'permission_error'),
        { code: 'anthropic_auth_failed', status: 403, sends: 1 },
      ],
      ['402', failure(402, 'billing_error'), { code: 'anthropic_billing', status: 402, sends: 1 }],
      // The provider's own class decides, whatever the status.
      [
        'billing type',
        failure(400, 'billing_error'),
        { code: 'anthropic_billing', status: 400, sends: 1 },
      ],
      [
        '400',
        failure(400, 'invalid_request_error'),
        { code: 'anthropic_request_invalid', status: 400, sends: 1 },
      ],
      [
        '404',
        failure(404, 'not_found_error'),
        { code: 'anthropic_model_not_found', status: 404, sends: 1 },
      ],
      // Sent three times: once and the SDK's two retries.
      [
        '429',
        failure(429, 'rate_limit_error'),
        { code: 'anthropic_rate_limited', status: 429, sends: 3 },
      ],
      ['500', failure(500, 'api_error'), { code: 'anthropic_error', status: 500, sends: 3 }],
      [
        '529',
        failure(529, 'overloaded_error'),
        { code: 'anthropic_overloaded', status: 529, sends: 3 },
      ],
    ];
    for (const [name, behaviour, expected] of cases) {
      const { error, sends } = await failureOf(behaviour);
      expect({ name, code: error.code, status: error.status, sends }).toEqual({
        name,
        ...expected,
      });
      expect(error.requestId).toBe('req_stub');
      // The message is the code: the provider's text can quote the prompt.
      expect(error.message).toBe(expected.code);
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(Object.entries(error))).not.toContain('SECRET');
    }
  });

  it('a connection that fails is tried three times; a call the runner aborts is sent once', async () => {
    const down = await failureOf(() => {
      throw new TypeError('fetch failed');
    });
    expect({ code: down.error.code, sends: down.sends }).toEqual({
      code: 'anthropic_unreachable',
      sends: 3,
    });
    const aborted = await failureOf(silence, { abortAfterMs: 50 });
    expect({ code: aborted.error.code, sends: aborted.sends }).toEqual({
      code: 'aborted',
      sends: 1,
    });
  });

  it('sends to the fixed address with the key alone, whatever the environment holds', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://elsewhere.example');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'env-bearer-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-from-the-environment');
    vi.stubEnv('ANTHROPIC_LOG', 'debug');
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const debugged = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
      const { sent, fetch } = stub(answer);
      await createAnthropicModel(KEY, { fetch })(PARAMS, {
        signal: new AbortController().signal,
        timeoutMs: 5000,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
      expect(sent[0]?.headers['x-api-key']).toBe(KEY);
      // The bearer token of a signed-in machine is not sent next to the key.
      expect(sent[0]?.headers).not.toHaveProperty('authorization');
      // And the SDK logs nothing by itself.
      expect(logged).not.toHaveBeenCalled();
      expect(debugged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      debugged.mockRestore();
    }
  });
});
