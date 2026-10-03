import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, onRequestHookHandler } from 'fastify';
import { ApiError } from './errors.ts';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const crossSiteRequest = (): ApiError =>
  new ApiError(
    403,
    'cross_site_request',
    'İstek panelin dışından geldiği için reddedildi. Sayfayı yenileyip yeniden deneyin.',
  );

/**
 * Request forgery protection for state-changing requests. Every such request is authenticated by
 * the session cookie, so each one must come from the panel itself: a browser's Sec-Fetch-Site must
 * say same-origin; without it (older browsers) the Origin must be the panel's origin. A request
 * with neither is refused. SameSite=Strict on the session cookie is the second line.
 */
export function sameOriginGuard(panelOrigin: string): onRequestHookHandler {
  return function checkSameOrigin(request, _reply, done) {
    done(isSameOrigin(request, panelOrigin) ? undefined : crossSiteRequest());
  };
}

function isSameOrigin(request: FastifyRequest, panelOrigin: string): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method)) return true;
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined) return site === 'same-origin';
  return request.headers.origin === panelOrigin;
}

export interface RateLimits {
  // Requests per minute per client address that start a Google sign-in (GET /api/auth/google).
  signIn: number;
  // Requests per minute per client address to the Google callback.
  callback: number;
  // Requests per minute per client address to every other route, logout included.
  other: number;
}

/**
 * A person behind the office's shared address (rule 8: office network and VPN) may need a few
 * sign-ins a minute, so the sign-in limits are counted per route and leave room for a team.
 */
export const DEFAULT_RATE_LIMITS: RateLimits = { signIn: 30, callback: 30, other: 300 };

const TIME_WINDOW_MS = 60_000;

const rateLimited = (): ApiError =>
  new ApiError(
    429,
    'rate_limited',
    'Çok fazla istek gönderildi. Bir dakika bekleyip yeniden deneyin.',
  );

// The client address the counters use: the socket's, or the X-Forwarded-For entry left of the
// proxies listed in TRUST_PROXY. Behind Cloudflare and Caddy, TRUST_PROXY must list both, or every
// person is counted under the address of the last proxy.
function clientAddress(request: FastifyRequest): string {
  return normalizeIP(request.ip);
}

/**
 * One counter per client address for the API routes (logout included), answered with a 429 error
 * body. Routes with `config: { rateLimit: false }` are left out: the health check, and the two
 * Google sign-in routes, which the browser opens as pages and which count themselves (signInLimiter).
 */
export function registerRateLimit(app: FastifyInstance, limits: RateLimits): void {
  void app.register(rateLimit, {
    global: true,
    timeWindow: TIME_WINDOW_MS,
    keyGenerator: (request) => `api:${clientAddress(request)}`,
    max: limits.other,
    errorResponseBuilder: rateLimited,
  });
}

/** Tells whether a request is over its limit; it counts the request as well. */
export type SignInLimiter = (request: FastifyRequest) => Promise<boolean>;

/**
 * A counter for one of the Google sign-in routes. They are full-page navigations, so an exceeded
 * limit is not answered with JSON: the route sends the browser to the login page instead.
 * Registered after registerRateLimit (it uses the plugin's createRateLimit).
 */
export function signInLimiter(app: FastifyInstance, name: string, max: number): SignInLimiter {
  const check = app.createRateLimit({
    timeWindow: TIME_WINDOW_MS,
    max,
    keyGenerator: (request) => `${name}:${clientAddress(request)}`,
  });
  return async (request) => {
    const result = await check(request);
    return !result.isAllowed && result.isExceeded;
  };
}
