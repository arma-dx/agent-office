import type { z } from 'zod';

/** The panel reaches the API only through the relative /api path (CLAUDE.md rule 1; panel and API share one domain). */
export const API_ROOT = '/api';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** An error that retrying will not fix: a client error (4xx) or an unexpected response format. */
export function isPermanentError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/** Message shown to the user: says what happened and what to do. Internal details are not shown. */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0)
      return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.';
    if (error.status === 401) return 'Oturumunuz kapanmış. Yeniden giriş yapın.';
    if (error.status === 403) return 'Bu işlem için yetkiniz yok.';
    if (error.status === 404) return 'Aradığınız kayıt bulunamadı.';
    if (error.status === 429) return 'Çok sık istek gönderildi. Biraz bekleyip yeniden deneyin.';
    if (error.status >= 500) return 'Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.';
    return 'İstek tamamlanamadı. Bilgileri kontrol edip yeniden deneyin.';
  }
  return 'Beklenmeyen bir sorun oluştu. Sayfayı yenileyip yeniden deneyin.';
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Endpoints that return no body (204) pass z.undefined(). */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

/**
 * Sends a request to the API and validates the response with a zod schema (all input is validated with zod).
 * The session cookie goes from the same origin; the browser holds no keys.
 * An aborted request is not turned into an ApiError; the caller gets the AbortError as is.
 */
export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  if (!path.startsWith('/')) throw new Error('API path must start with /');
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'Could not reach the server');
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed (${String(response.status)})`);
  }
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
