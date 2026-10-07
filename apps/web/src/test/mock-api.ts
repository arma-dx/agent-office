import type { ApiErrorCode, MembershipSummary, SessionResponse } from '@agent-office/shared';
import { vi } from 'vitest';

/** One request the panel sent, as the fake API saw it. */
export interface ApiCall {
  method: string;
  /** Path after /api, for example /session. */
  path: string;
  headers: Headers;
  body: unknown;
}

export type Handler = (call: ApiCall) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** An error answer of the API; only codes the API really sends (shared apiErrorCodeSchema). */
export function apiError(status: number, code: ApiErrorCode, message: string): Response {
  return json({ error: { code, message } }, status);
}

/**
 * What the shell itself asks for: on every page of a company the decisions that wait for the
 * person (the count on the "Onaylar" row), and when the "Yeni talep" form opens whether a request
 * can be sent now. A test that is not about them gets an empty desk and an open door.
 */
const SHELL_HANDLERS: Record<string, Handler> = {
  'GET /approvals': () => json({ approvals: [], acceptances: [] }),
  'GET /requests/intake': () => json({ open: true, reason: null }),
};

/**
 * Replaces fetch with a fake API. Handlers are keyed by "METHOD /path". A request without a
 * handler answers 404 and is listed in `unexpected`, so a test can tell a missing handler apart.
 */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const unexpected: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (!url.startsWith('/api/')) throw new Error(`The panel called a URL outside /api: ${url}`);
    const call: ApiCall = {
      method: init?.method ?? 'GET',
      path: url.slice('/api'.length),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const handler = handlers[key] ?? SHELL_HANDLERS[key];
    if (!handler) {
      unexpected.push(key);
      return apiError(404, 'not_found', 'Kayıt bulunamadı.');
    }
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    unexpected,
    fetchMock,
    /** Calls to one endpoint, for example "POST /invitations". */
    callsTo(key: string): ApiCall[] {
      return calls.filter((c) => `${c.method} ${c.path}` === key);
    },
    handle(key: string, handler: Handler) {
      handlers[key] = handler;
    },
  };
}

// Fixtures. UUIDs are version 4, as the API sends them.

export const ARMADX: MembershipSummary = {
  companyId: '6f1c2a3b-4d5e-4f60-8a71-0b2c3d4e5f60',
  code: 'armadx',
  name: 'Arma DX',
  kind: 'company',
  role: 'founder',
  canApprove: true,
};

export const PILLIKA: MembershipSummary = {
  companyId: '7a2d3b4c-5e6f-4a71-9b82-1c3d4e5f6a71',
  code: 'pillika',
  name: 'Pillika',
  kind: 'company',
  role: 'founder',
  canApprove: true,
};

export const FOUNDER_SPACE: MembershipSummary = {
  companyId: '8b3e4c5d-6f7a-4b82-ac93-2d4e5f6a7b82',
  code: 'founder_space',
  name: 'Kurucu',
  kind: 'private_space',
  role: 'founder',
  canApprove: true,
};

export const USER_ID = '9c4f5d6e-7a8b-4c93-bd04-3e5f6a7b8c93';

export function sessionBody(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    user: { id: USER_ID, name: 'Ömer Kadıoğlu' },
    memberships: [ARMADX, PILLIKA, FOUNDER_SPACE],
    lastCompanyId: ARMADX.companyId,
    ...overrides,
  };
}

/** GET /session answering with the given session. */
export function sessionHandler(overrides: Partial<SessionResponse> = {}): Handler {
  return () => json(sessionBody(overrides));
}
