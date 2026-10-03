import { randomBytes, timingSafeEqual } from 'node:crypto';
import { loginReturnPathSchema } from '@agent-office/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from '../env.ts';
import type { LoginChecks } from './provider.ts';

/**
 * The one-time values of a Google sign-in (state, nonce, PKCE verifier) live in a signed, HttpOnly
 * cookie for 10 minutes. SameSite=Lax, because Google's redirect back to the callback is a
 * cross-site top-level navigation. The cookie is cleared by the callback whatever the outcome. It
 * also carries the panel page to open after the sign-in, if the panel asked for one.
 */
export const LOGIN_COOKIE_MAX_AGE_SECONDS = 10 * 60;
// A cookie issued a little in the future (clock steps) is still accepted.
const CLOCK_SKEW_SECONDS = 60;

const randomValue = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);

const loginCookieSchema = z.strictObject({
  state: randomValue,
  nonce: randomValue,
  codeVerifier: randomValue,
  issuedAt: z.number().int(),
  returnTo: loginReturnPathSchema.optional(),
});

/** The one-time values of a sign-in and the panel page to open after it. */
export interface LoginCookie {
  checks: LoginChecks;
  returnTo: string | undefined;
}

export function newLoginChecks(): LoginChecks {
  const value = () => randomBytes(32).toString('base64url');
  return { state: value(), nonce: value(), codeVerifier: value() };
}

export function loginCookieName(config: ServerConfig): string {
  return config.localCookies ? 'login' : '__Host-login';
}

function loginCookieAttributes(config: ServerConfig): CookieSerializeOptions {
  return { path: '/', httpOnly: true, secure: !config.localCookies, sameSite: 'lax' };
}

export function setLoginCookie(
  reply: FastifyReply,
  config: ServerConfig,
  checks: LoginChecks,
  returnTo?: string,
): void {
  const payload = {
    ...checks,
    issuedAt: Math.floor(Date.now() / 1000),
    ...(returnTo === undefined ? {} : { returnTo: loginReturnPathSchema.parse(returnTo) }),
  };
  reply.setCookie(
    loginCookieName(config),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    { ...loginCookieAttributes(config), maxAge: LOGIN_COOKIE_MAX_AGE_SECONDS, signed: true },
  );
}

export function clearLoginCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(loginCookieName(config), loginCookieAttributes(config));
}

/** The checks (and the page to return to) of a valid, unexpired login cookie, or null. */
export function readLoginCookie(request: FastifyRequest, config: ServerConfig): LoginCookie | null {
  const raw = request.cookies[loginCookieName(config)];
  if (raw === undefined) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = loginCookieSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const age = Math.floor(Date.now() / 1000) - parsed.data.issuedAt;
  if (age > LOGIN_COOKIE_MAX_AGE_SECONDS || age < -CLOCK_SKEW_SECONDS) return null;
  const { state, nonce, codeVerifier, returnTo } = parsed.data;
  return { checks: { state, nonce, codeVerifier }, returnTo };
}

/** Constant-time comparison of the state returned by Google with the cookie's. */
export function sameState(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
