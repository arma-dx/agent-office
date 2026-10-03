import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiRequest, isPermanentError, userMessage } from './api.ts';

const schema = z.object({ status: z.literal('ok') });

function fetchResponse(body: unknown, status = 200) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('sends a same-origin request only to the relative /api path and validates the response', async () => {
    const fetchMock = fetchResponse({ status: 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('/health', { schema })).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('turns a failed response into an ApiError with the status code', async () => {
    vi.stubGlobal('fetch', fetchResponse({}, 503));
    await expect(apiRequest('/health', { schema })).rejects.toMatchObject({ status: 503 });
  });

  it('reports a network error with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('no network'))),
    );
    await expect(apiRequest('/health', { schema })).rejects.toMatchObject({ status: 0 });
  });

  it('rejects a response that does not match the schema', async () => {
    vi.stubGlobal('fetch', fetchResponse({ status: 'broken' }));
    await expect(apiRequest('/health', { schema })).rejects.toBeInstanceOf(ApiError);
  });

  it('accepts a response without a body (204)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await expect(
      apiRequest('/x', { method: 'DELETE', schema: z.undefined() }),
    ).resolves.toBeUndefined();
  });

  it('turns a non-JSON response into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200 }))),
    );
    await expect(apiRequest('/health', { schema })).rejects.toBeInstanceOf(ApiError);
  });

  it('does not turn an aborted request into an ApiError', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        controller.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      }),
    );
    await expect(
      apiRequest('/health', { schema, signal: controller.signal }),
    ).rejects.not.toBeInstanceOf(ApiError);
  });

  it('does not send a request to an absolute URL', async () => {
    await expect(apiRequest('https://example.com/x', { schema })).rejects.toThrow(
      /must start with/,
    );
  });
});

describe('userMessage', () => {
  it('says what happened and what to do', () => {
    expect(userMessage(new ApiError(0, ''))).toMatch(/Bağlantınızı kontrol/);
    expect(userMessage(new ApiError(401, ''))).toMatch(/Yeniden giriş/);
    expect(userMessage(new ApiError(500, ''))).toMatch(/yeniden deneyin/);
    expect(userMessage(new ApiError(429, ''))).toMatch(/Biraz bekleyip/);
    expect(userMessage(new ApiError(409, 'internal detail'))).toMatch(/kontrol edip/);
    expect(userMessage(new Error('internal detail'))).not.toMatch(/internal detail/);
  });

  it('treats 4xx errors as permanent, but not network and server errors', () => {
    expect(isPermanentError(new ApiError(401, ''))).toBe(true);
    expect(isPermanentError(new ApiError(0, ''))).toBe(false);
    expect(isPermanentError(new ApiError(503, ''))).toBe(false);
  });
});
