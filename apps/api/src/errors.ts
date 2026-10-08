import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode } from '@agent-office/shared';

/**
 * An error the client sees. `code` is a stable English identifier; `message` is Turkish and safe to
 * show to the user. Database error text never reaches the client.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  toBody(): ApiErrorBody {
    return errorBody(this.code, this.message);
  }
}

export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Oturumunuz kapalı. Yeniden giriş yapın.');

export const notFound = (): ApiError =>
  new ApiError(404, 'not_found', 'Aradığınız kayıt bulunamadı.');

export const invalidRequest = (): ApiError =>
  new ApiError(
    400,
    'invalid_request',
    'Gönderilen bilgiler geçersiz. Alanları denetleyip yeniden deneyin.',
  );

const INTERNAL = errorBody(
  'internal_error',
  'Beklenmeyen bir hata oluştu. Biraz sonra yeniden deneyin.',
);

// Fastify's own client errors (body parsing, size, media type) get a Turkish message.
const CLIENT_ERRORS = new Map<number, ApiErrorBody>([
  [404, errorBody('not_found', 'Bulunamadı.')],
  [413, errorBody('payload_too_large', 'Gönderilen veri çok büyük.')],
  [415, errorBody('unsupported_media_type', 'İstek gövdesi JSON biçiminde olmalı.')],
]);

/** PostgreSQL error code of a database error (SQLSTATE), if the error is one. */
export function databaseErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'severity' in error && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * The constraint a database error names (a key, a foreign key, a check of a table), if any. An
 * exception a function raises names none. The name is the database's own, never row content.
 */
export function databaseErrorConstraint(error: unknown): string | undefined {
  if (databaseErrorCode(error) === undefined) {
    return undefined;
  }
  const { constraint } = error as { constraint?: unknown };
  return typeof constraint === 'string' ? constraint : undefined;
}

/**
 * The parts of an error that may be logged. A database error's message and detail can carry row
 * values (an address in a unique key, user input), so only its codes are kept.
 */
export function loggableError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }
  const sqlState = databaseErrorCode(error);
  if (sqlState !== undefined) {
    const { constraint, table } = error as { constraint?: unknown; table?: unknown };
    return {
      type: error.name,
      sqlState,
      ...(typeof constraint === 'string' ? { constraint } : {}),
      ...(typeof table === 'string' ? { table } : {}),
    };
  }
  const { code } = error as { code?: unknown };
  return {
    type: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(error.stack !== undefined ? { stack: error.stack } : {}),
  };
}

export function errorHandler(
  error: FastifyError | ApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send(error.toBody());
  }
  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    const body = CLIENT_ERRORS.get(statusCode);
    return body
      ? reply.code(statusCode).send(body)
      : reply.code(400).send(invalidRequest().toBody());
  }
  request.log.error({ failure: loggableError(error) }, 'request failed');
  return reply.code(500).send(INTERNAL);
}
