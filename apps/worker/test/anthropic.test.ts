import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicModel, createAnthropicTokenCounter } from '../src/model/anthropic.ts';
import { ModelCallError, type FileBlock, type ModelRequest } from '../src/model/client.ts';

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
  method: string;
  // The request's body as it was sent (JSON text); '' without one.
  body: string;
}

type Behaviour = (init: RequestInit) => Promise<Response> | Response;

function stub(behaviour: Behaviour): { sent: Sent[]; fetch: typeof globalThis.fetch } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init = {}) => {
      const url = input instanceof Request ? input.url : input.toString();
      sent.push({
        url,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? init.body : '',
      });
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
    expect(result.sends).toBe(1);
  });

  it('a call that reaches its time limit is sent once, and says how often it was sent', async () => {
    // The provider never answers. The SDK would send a request that timed out two more times.
    const slow = await failureOf(silence, { timeoutMs: 80 });
    expect({ code: slow.error.code, sends: slow.sends, counted: slow.error.sends }).toEqual({
      code: 'anthropic_timeout',
      sends: 1,
      counted: 1,
    });
    // What is sent again is counted with the error: three sends for a rate limit.
    const limited = await failureOf(failure(429, 'rate_limit_error'));
    expect(limited.error.sends).toBe(3);
    // And with the answer: a server error, then the answer.
    let first = true;
    const { fetch } = stub((init) => {
      if (first) {
        first = false;
        return failure(500, 'api_error')(init);
      }
      return answer(init);
    });
    const result = await createAnthropicModel(KEY, { fetch })(PARAMS, {
      signal: new AbortController().signal,
      timeoutMs: 5000,
    });
    expect(result.sends).toBe(2);
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

// The provider's token count for one file (8 October decision 21): asked before a project file is
// given to the model.

const PDF_BLOCK: FileBlock = {
  type: 'document',
  source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' },
};

const counted =
  (tokens: number): Behaviour =>
  () =>
    new Response(JSON.stringify({ input_tokens: tokens }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_count' },
    });

async function countFailureOf(
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
  const thrown: unknown = await createAnthropicTokenCounter(KEY, { fetch })(
    { model: 'claude-test', block: PDF_BLOCK },
    { signal: controller.signal, timeoutMs: options.timeoutMs ?? 5000 },
  ).then(
    () => null,
    (error: unknown) => error,
  );
  if (!(thrown instanceof ModelCallError)) throw new Error('The count did not fail as expected');
  return { error: thrown, sends: sent.length };
}

describe('the token counter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('the token counter sends one user message that holds the block and nothing else, to the count endpoint', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://elsewhere.example');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'env-bearer-token');
    const image: FileBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
    };
    for (const block of [PDF_BLOCK, image]) {
      const { sent, fetch } = stub(counted(12345));
      const tokens = await createAnthropicTokenCounter(KEY, { fetch })(
        { model: 'claude-test', block },
        { signal: new AbortController().signal, timeoutMs: 5000 },
      );
      expect(tokens).toBe(12345);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
      expect(sent[0]?.method).toBe('POST');
      expect(sent[0]?.headers['x-api-key']).toBe(KEY);
      expect(sent[0]?.headers).not.toHaveProperty('authorization');
      // The whole body: the model and one user turn with the one block. No system text, no
      // tools, no cache mark, no title.
      expect(JSON.parse(sent[0]?.body ?? '')).toEqual({
        model: 'claude-test',
        messages: [{ role: 'user', content: [block] }],
      });
    }
  });

  it('a 400 is anthropic_request_invalid, a timeout anthropic_timeout', async () => {
    // The provider cannot take the file: sent once, never again.
    const invalid = await countFailureOf(failure(400, 'invalid_request_error'));
    expect({
      code: invalid.error.code,
      status: invalid.error.status,
      sends: invalid.sends,
    }).toEqual({ code: 'anthropic_request_invalid', status: 400, sends: 1 });
    expect(invalid.error.requestId).toBe('req_stub');
    // The provider's text can quote the file: the message is the code.
    expect(invalid.error.message).toBe('anthropic_request_invalid');
    expect(JSON.stringify(Object.entries(invalid.error))).not.toContain('SECRET');
    const slow = await countFailureOf(silence, { timeoutMs: 80 });
    expect({ code: slow.error.code, sends: slow.sends, counted: slow.error.sends }).toEqual({
      code: 'anthropic_timeout',
      sends: 1,
      counted: 1,
    });
    // Ended by the run's own signal (its deadline, a stop): told apart from a slow provider.
    const aborted = await countFailureOf(silence, { abortAfterMs: 50 });
    expect({ code: aborted.error.code, sends: aborted.sends }).toEqual({
      code: 'aborted',
      sends: 1,
    });
  });

  it('it retries as the model call does and never logs', async () => {
    vi.stubEnv('ANTHROPIC_LOG', 'debug');
    const spies = (['log', 'debug', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      for (const [status, type, code] of [
        [429, 'rate_limit_error', 'anthropic_rate_limited'],
        [500, 'api_error', 'anthropic_error'],
        [529, 'overloaded_error', 'anthropic_overloaded'],
      ] as const) {
        const { error, sends } = await countFailureOf(failure(status, type));
        // Once and the SDK's two retries, counted with the error.
        expect({ code: error.code, sends, counted: error.sends }).toEqual({
          code,
          sends: 3,
          counted: 3,
        });
      }
      // A server error, then the count.
      let first = true;
      const { sent, fetch } = stub((init) => {
        if (first) {
          first = false;
          return failure(500, 'api_error')(init);
        }
        return counted(7)(init);
      });
      expect(
        await createAnthropicTokenCounter(KEY, { fetch })(
          { model: 'claude-test', block: PDF_BLOCK },
          { signal: new AbortController().signal, timeoutMs: 5000 },
        ),
      ).toBe(7);
      expect(sent).toHaveLength(2);
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
