import { COMPANY_HEADER } from '@agent-office/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiRequest, isAccessChanged, isPermanentError, userMessage } from './api.ts';

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

  it('sends the selected company in the x-company-id header only when asked', async () => {
    const fetchMock = fetchResponse({ status: 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    const companyId = '6f1c2a3b-4d5e-4f60-8a71-0b2c3d4e5f60';
    await apiRequest('/members', { schema, companyId });
    await apiRequest('/session', { schema });
    const headers = fetchMock.mock.calls.map(
      (call) => new Headers((call as unknown as [string, RequestInit])[1].headers),
    );
    expect(headers[0]?.get(COMPANY_HEADER)).toBe(companyId);
    expect(headers[1]?.has(COMPANY_HEADER)).toBe(false);
  });

  it('carries the Turkish message and code of an error body in the agreed shape', async () => {
    vi.stubGlobal(
      'fetch',
      fetchResponse(
        { error: { code: 'invitation_exists', message: 'Bu adrese bekleyen bir davet var.' } },
        409,
      ),
    );
    const error = await apiRequest('/invitations', { method: 'POST', body: {}, schema }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'invitation_exists',
      message: 'Bu adrese bekleyen bir davet var.',
    });
    expect(userMessage(error)).toBe('Bu adrese bekleyen bir davet var.');
  });

  it('falls back to the status message when the error body has another shape', async () => {
    vi.stubGlobal('fetch', fetchResponse({ message: 'relation "users" does not exist' }, 500));
    const error = await apiRequest('/members', { schema }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: undefined });
    expect(userMessage(error)).toBe('Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.');
    expect(userMessage(error)).not.toMatch(/relation/);
  });

  it('falls back when the error message is empty or the body is not JSON', async () => {
    vi.stubGlobal('fetch', fetchResponse({ error: { code: 'forbidden', message: ' ' } }, 403));
    expect(userMessage(await apiRequest('/members', { schema }).catch((e: unknown) => e))).toBe(
      'Bu işlem için yetkiniz yok.',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }))),
    );
    const error = await apiRequest('/members', { schema }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: undefined });
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

  it('recognises a 403 that means the access changed, and only that', () => {
    expect(isAccessChanged(new ApiError(403, 'x', 'forbidden'))).toBe(true);
    expect(isAccessChanged(new ApiError(403, 'x', 'founder_only'))).toBe(true);
    // Request forgery protection and a 403 without the agreed body are not about the session.
    expect(isAccessChanged(new ApiError(403, 'x', 'cross_site_request'))).toBe(false);
    expect(isAccessChanged(new ApiError(403, 'x'))).toBe(false);
    expect(isAccessChanged(new ApiError(401, 'x', 'forbidden'))).toBe(false);
  });

  it('treats 4xx errors as permanent, but not network and server errors', () => {
    expect(isPermanentError(new ApiError(401, ''))).toBe(true);
    expect(isPermanentError(new ApiError(0, ''))).toBe(false);
    expect(isPermanentError(new ApiError(503, ''))).toBe(false);
  });
});
