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
  // The longest this one call may take. A call that reaches it fails as a timeout and is not sent
  // again: an answer that was too slow once will be too slow again.
  timeoutMs: number;
}

export interface ModelAnswer {
  message: ModelMessage;
  // The provider's id of the request, kept with the run for support questions.
  requestId: string | null;
  // How often the request was sent for this one answer: 1, or more after the client's retries
  // (rate limit, a server error, a dead connection). Kept with the run (rule 5).
  sends: number;
}

export type CallModel = (params: ModelRequest, options: ModelCallOptions) => Promise<ModelAnswer>;

/** A project file as the model is given it. */
export type FileBlock = Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam;

/**
 * Asks the provider how many input tokens a file's block is, before the file is given to the
 * model. Free; a request of its own with its own rate limit. Fails like a model call
 * (ModelCallError): 'anthropic_request_invalid' means the provider cannot take the file (a PDF
 * over its page limit, with a password, or damaged; a picture over its size).
 */
export type CountFileTokens = (
  request: { model: string; block: FileBlock },
  options: ModelCallOptions,
) => Promise<number>;

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
  // How often the request was sent before the call failed.
  readonly sends: number;

  constructor(
    code: ModelErrorCode,
    status: number | null = null,
    requestId: string | null = null,
    providerType: string | null = null,
    sends = 0,
  ) {
    // The message is the code: a provider's error text can quote the prompt and is never logged.
    super(code);
    this.name = 'ModelCallError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.providerType = providerType;
    this.sends = sends;
  }
}
