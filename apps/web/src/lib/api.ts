import { apiErrorSchema, COMPANY_HEADER, type ApiErrorCode } from '@agent-office/shared';
import type { z } from 'zod';

/** The panel reaches the API only through the relative /api path (CLAUDE.md rule 1; panel and API share one domain). */
export const API_ROOT = '/api';

export class ApiError extends Error {
  readonly status: number;
  /**
   * Set only when the response body matched apiErrorSchema. The message is then the Turkish,
   * user-safe text from the API; otherwise the message is an English developer note.
   */
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** An error that retrying will not fix: a client error (4xx) or an unexpected response format. */
export function isPermanentError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

// 403 codes that mean the cached session's memberships or roles are out of date. insiders_only:
// the office page sends no request for a person whose cached role is external, so that answer
// can only arrive when the role changed while the panel was open.
const ACCESS_CHANGED: readonly ApiErrorCode[] = ['forbidden', 'founder_only', 'insiders_only'];

/**
 * The API refused the company, the founder-only action or the screen closed to external people:
 * the person's access has changed.
 */
export function isAccessChanged(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    ACCESS_CHANGED.some((code) => code === error.code)
  );
}

export const FORBIDDEN_MESSAGE = 'Bu işlem için yetkiniz yok.';

/**
 * Message shown to the user: says what happened and what to do. The API's own Turkish message
 * comes first; internal details (developer notes, database text) are never shown.
 */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code !== undefined) return error.message;
    if (error.status === 0)
      return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.';
    if (error.status === 401) return 'Oturumunuz kapanmış. Yeniden giriş yapın.';
    if (error.status === 403) return FORBIDDEN_MESSAGE;
    if (error.status === 404) return 'Aradığınız kayıt bulunamadı.';
    if (error.status === 429) return 'Çok sık istek gönderildi. Biraz bekleyip yeniden deneyin.';
    if (error.status >= 500) return 'Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.';
    return 'İstek tamamlanamadı. Bilgileri kontrol edip yeniden deneyin.';
  }
  return 'Beklenmeyen bir sorun oluştu. Sayfayı yenileyip yeniden deneyin.';
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Endpoints that return no body (204) pass z.undefined(). */
  schema: z.ZodType<T>;
  /** Company-scoped endpoints: the selected company goes in the x-company-id header. */
  companyId?: string;
  signal?: AbortSignal;
}

/** Reads the error body; returns an ApiError with the API's message when the body has the agreed shape. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = undefined;
  try {
    body = await response.json();
  } catch {
    // Not JSON (for example a proxy error page); fall back to the status code.
  }
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success && parsed.data.error.message.trim() !== '') {
    return new ApiError(response.status, parsed.data.error.message, parsed.data.error.code);
  }
  return new ApiError(response.status, `Request failed (${String(response.status)})`);
}

/**
 * Sends a request to the API and validates the response with a zod schema (all input is validated with zod).
 * The session cookie goes from the same origin; the browser holds no keys.
 * An aborted request is not turned into an ApiError; the caller gets the AbortError as is.
 */
export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  if (!path.startsWith('/')) throw new Error('API path must start with /');
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.companyId !== undefined) headers[COMPANY_HEADER] = options.companyId;
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'Could not reach the server');
  }
  if (!response.ok) throw await errorFromResponse(response);
  let data: unknown = undefined;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(502, 'Server response is not in the expected format');
    }
  }
  const result = options.schema.safeParse(data);
  if (!result.success) throw new ApiError(502, 'Server response is not in the expected format');
  return result.data;
}
