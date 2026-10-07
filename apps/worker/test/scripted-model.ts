import {
  ModelCallError,
  type CallModel,
  type ModelErrorCode,
  type ModelMessage,
  type ModelRequest,
} from '../src/model/client.ts';

/**
 * The fake model of every test: it answers with the steps it was given, in order, records every
 * request it received and fails when it is called more often than scripted. The builders produce
 * objects of the SDK's own Message type, so an SDK upgrade that changes the shape breaks the type
 * check here, not a run in production.
 */

export interface Tokens {
  input?: number;
  output?: number;
  cacheWrite?: number;
  cacheRead?: number;
}

type Step = ModelMessage | ModelCallError | ((request: ModelRequest) => Promise<ModelMessage>);

let counter = 0;

function message(
  content: ModelMessage['content'],
  stopReason: ModelMessage['stop_reason'],
  tokens: Tokens = {},
  stopDetails: ModelMessage['stop_details'] = null,
): ModelMessage {
  counter += 1;
  return {
    id: `msg_test_${String(counter)}`,
    type: 'message',
    role: 'assistant',
    model: 'scripted',
    container: null,
    diagnostics: null,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopDetails,
    usage: {
      input_tokens: tokens.input ?? 100,
      output_tokens: tokens.output ?? 20,
      cache_creation_input_tokens: tokens.cacheWrite ?? 0,
      cache_read_input_tokens: tokens.cacheRead ?? 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}

/** The model asks for one tool. */
export function toolUse(name: string, input: unknown, tokens?: Tokens): ModelMessage {
  counter += 1;
  return message(
    [
      {
        type: 'tool_use',
        id: `toolu_test_${String(counter)}`,
        name,
        input,
        caller: { type: 'direct' },
      },
    ],
    'tool_use',
    tokens,
  );
}

/** One answer with several tool calls, although one call per turn was asked for. */
export function toolUses(calls: { name: string; input: unknown }[]): ModelMessage {
  return message(
    calls.map(({ name, input }) => {
      counter += 1;
      return {
        type: 'tool_use' as const,
        id: `toolu_test_${String(counter)}`,
        name,
        input,
        caller: { type: 'direct' as const },
      };
    }),
    'tool_use',
  );
}

/** The model ends its turn with text and no tool. */
export function text(value: string, tokens?: Tokens): ModelMessage {
  return message([{ type: 'text', text: value, citations: null }], 'end_turn', tokens);
}

export function refusal(): ModelMessage {
  return message(
    [],
    'refusal',
    {},
    { type: 'refusal', category: 'general_harms', explanation: null },
  );
}

export function truncated(name: string): ModelMessage {
  counter += 1;
  return message(
    [
      {
        type: 'tool_use',
        id: `toolu_test_${String(counter)}`,
        name,
        input: {},
        caller: { type: 'direct' },
      },
    ],
    'max_tokens',
  );
}

export function apiError(code: ModelErrorCode, status: number | null = null): ModelCallError {
  return new ModelCallError(code, status, 'req_test');
}

export class ScriptedModel {
  readonly requests: ModelRequest[] = [];
  readonly #steps: Step[];

  constructor(steps: Step[]) {
    this.#steps = [...steps];
  }

  get remaining(): number {
    return this.#steps.length;
  }

  readonly call: CallModel = async (params, { signal }) => {
    // A copy: the runner appends to its message list after the call.
    this.requests.push(structuredClone(params));
    const step = this.#steps.shift();
    if (step === undefined) {
      throw new Error('The model was called more often than the test scripted');
    }
    if (step instanceof ModelCallError) {
      throw step;
    }
    if (typeof step === 'function') {
      // A slow answer: gives way to the run's deadline like a real call would.
      return {
        message: await Promise.race([
          step(params),
          new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => {
              reject(new ModelCallError('aborted'));
            });
          }),
        ]),
        requestId: null,
      };
    }
    return { message: step, requestId: `req_${step.id}` };
  };
}

/** A model call that never answers by itself. */
export function never(): Promise<ModelMessage> {
  return new Promise<ModelMessage>(() => undefined);
}
