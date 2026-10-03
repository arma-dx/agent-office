import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from './env.ts';

/**
 * Server-side sessions (3 October decision 6): the cookie holds an opaque random key; the database
 * stores only its SHA-256, computed here. A session closes after 30 minutes without a request and
 * at the latest 10 hours after login; the database enforces both limits.
 */
export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_MAX_AGE_SECONDS = 10 * 60 * 60;

const KEY_BYTES = 32;
// base64url of 32 bytes, without padding.
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sha256(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/** A new session key for the cookie and its hash for the database. */
export function newSessionKey(): { key: string; keyHash: Buffer } {
  const bytes = randomBytes(KEY_BYTES);
  return { key: bytes.toString('base64url'), keyHash: sha256(bytes) };
}

/** SHA-256 of the key's bytes; null for a value that is not a session key. */
export function hashSessionKey(key: string): Buffer | null {
  if (!KEY_PATTERN.test(key)) return null;
  const bytes = Buffer.from(key, 'base64url');
  return bytes.length === KEY_BYTES ? sha256(bytes) : null;
}

/**
 * __Host- cookies are host-only (no Domain), Secure and on Path=/. Locally the panel runs on
 * http://localhost:5173, where a Secure cookie would not be stored, so the plain names are used.
 */
export function sessionCookieName(config: ServerConfig): string {
  return config.localCookies ? 'session' : '__Host-session';
}

// Clearing a __Host- cookie needs the same attributes, or the browser ignores the Set-Cookie.
function sessionCookieAttributes(config: ServerConfig): CookieSerializeOptions {
  return { path: '/', httpOnly: true, secure: !config.localCookies, sameSite: 'strict' };
}

export function sessionCookieOptions(config: ServerConfig): CookieSerializeOptions {
  return { ...sessionCookieAttributes(config), maxAge: SESSION_MAX_AGE_SECONDS };
}

export function setSessionCookie(reply: FastifyReply, config: ServerConfig, key: string): void {
  reply.setCookie(sessionCookieName(config), key, sessionCookieOptions(config));
}

export function clearSessionCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(sessionCookieName(config), sessionCookieAttributes(config));
}

/** The cookie value, or undefined when the request carries none. */
export function readSessionCookie(
  request: FastifyRequest,
  config: ServerConfig,
): string | undefined {
  return request.cookies[sessionCookieName(config)];
}

/**
 * The company picked last (PUT /api/session/company), kept in this browser so that the next
 * sign-in opens it again: a new session starts without a default company, and the closed session
 * that had one cannot be read any more. The value grants nothing; at sign-in the database applies
 * it only to a company the person is still a member of. SameSite=Lax, because the sign-in callback
 * is a cross-site navigation from Google.
 */
export const COMPANY_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const companyIdSchema = z.uuid();

export function companyCookieName(config: ServerConfig): string {
  return config.localCookies ? 'company' : '__Host-company';
}

function companyCookieAttributes(config: ServerConfig): CookieSerializeOptions {
  return { path: '/', httpOnly: true, secure: !config.localCookies, sameSite: 'lax' };
}

export function setCompanyCookie(
  reply: FastifyReply,
  config: ServerConfig,
  companyId: string,
): void {
  reply.setCookie(companyCookieName(config), companyId, {
    ...companyCookieAttributes(config),
    maxAge: COMPANY_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearCompanyCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(companyCookieName(config), companyCookieAttributes(config));
}

/**
 * The remembered company: `present` when the browser sent the cookie at all, `companyId` when its
 * value is a company id.
 */
export function readCompanyCookie(
  request: FastifyRequest,
  config: ServerConfig,
): { present: boolean; companyId: string | null } {
  const raw = request.cookies[companyCookieName(config)];
  const parsed = companyIdSchema.safeParse(raw);
  return { present: raw !== undefined, companyId: parsed.success ? parsed.data : null };
}
