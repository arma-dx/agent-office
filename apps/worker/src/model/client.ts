import type Anthropic from '@anthropic-ai/sdk';

/**
 * The seam between the runner and the model provider. The runner knows only this file: the request
 * and the answer are the SDK's own types (imported as types, erased at run time), and the SDK is
 * loaded as a value in exactly one file, anthropic.ts. Tests pass a scripted fake of the same type.
 */
export type ModelRequest = Anthropic.MessageCreateParamsNonStreaming;
export type ModelMessage = Anthropic.Message;
export type ModelTool = Anthropic.Tool;
export type ModelTurn = Anthropic.MessageParam;
export type ToolUse = Anthropic.ToolUseBlock;
export type ToolResult = Anthropic.ToolResultBlockParam;

export interface ModelCallOptions {
  // Fires at the run's deadline and when the run is stopped.
  signal: AbortSignal;
  timeoutMs: number;
}

export interface ModelAnswer {
  message: ModelMessage;
  // The provider's id of the request, kept with the run for support questions.
  requestId: string | null;
}

export type CallModel = (params: ModelRequest, options: ModelCallOptions) => Promise<ModelAnswer>;

/** Why a model call failed after the client's own retries. A code; never the provider's text. */
export type ModelErrorCode =
  | 'aborted'
  | 'anthropic_timeout'
  | 'anthropic_unreachable'
  | 'anthropic_rate_limited'
  | 'anthropic_auth_failed'
  // The account cannot pay for the call: no balance or no payment method.
  | 'anthropic_billing'
  | 'anthropic_model_not_found'
  | 'anthropic_request_invalid'
  | 'anthropic_overloaded'
  | 'anthropic_error';

export class ModelCallError extends Error {
  readonly code: ModelErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  // The provider's own class of the error (a short code such as billing_error), for the smoke run.
  readonly providerType: string | null;

  constructor(
    code: ModelErrorCode,
    status: number | null = null,
    requestId: string | null = null,
    providerType: string | null = null,
  ) {
    // The message is the code: a provider's error text can quote the prompt and is never logged.
    super(code);
    this.name = 'ModelCallError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.providerType = providerType;
  }
}
