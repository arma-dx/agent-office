import type { LoginStatus } from '@agent-office/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { checkClaims, type AcceptedIdentity } from '../auth/claims.ts';
import { recordLoginEvent, rejectionReason, type RejectionReason } from '../auth/events.ts';
import {
  clearLoginCookie,
  newLoginChecks,
  readLoginCookie,
  sameState,
  setLoginCookie,
} from '../auth/login-cookie.ts';
import { AuthProviderError } from '../auth/provider.ts';
import { inTransaction, verifySession, type DbClient } from '../db.ts';
import { databaseErrorCode, loggableError } from '../errors.ts';
import { signInLimiter } from '../security.ts';
import {
  SESSION_MAX_AGE_SECONDS,
  clearCompanyCookie,
  clearSessionCookie,
  hashSessionKey,
  newSessionKey,
  readCompanyCookie,
  readSessionCookie,
  setSessionCookie,
} from '../session.ts';
import type { RouteDeps } from '../services.ts';

const MAX_CALLBACK_QUERY_LENGTH = 4096;

function toLogin(reply: FastifyReply, status: LoginStatus): FastifyReply {
  // The same address for every rejection: the page never learns why (rule 3).
  return reply.redirect(`/login?status=${status}`, 302);
}

function callbackQuery(request: FastifyRequest): URLSearchParams | null {
  const start = request.url.indexOf('?');
  const raw = start === -1 ? '' : request.url.slice(start + 1);
  return raw.length > MAX_CALLBACK_QUERY_LENGTH ? null : new URLSearchParams(raw);
}

// The browser opens these routes as pages: they count their own requests (signInLimiter) and
// answer an exceeded limit with the login page, never with a JSON error.
const PAGE_ROUTE = { config: { rateLimit: false } } as const;

type LoginOutcome =
  { kind: 'signed_in'; key: string; companyRemembered: boolean } | { kind: 'rejected' };

interface CompleteLoginRow {
  result: string;
  user_id: string | null;
}

/**
 * Gives the new session the company this browser picked last. set_last_company accepts only a
 * company the person is still a member of; any other value is dropped (false), and the login
 * goes on. The savepoint keeps the login transaction usable after that refusal.
 */
async function rememberCompany(
  client: DbClient,
  keyHash: Buffer,
  companyId: string,
): Promise<boolean> {
  await client.query('savepoint remember_company');
  try {
    await client.query('select office.set_last_company($1, $2)', [keyHash, companyId]);
  } catch (error) {
    // insufficient_privilege: no longer a member of that company.
    if (databaseErrorCode(error) !== '42501') throw error;
    await client.query('rollback to savepoint remember_company');
    return false;
  }
  await client.query('release savepoint remember_company');
  return true;
}

/**
 * One transaction in the login context (only app.email, the address Google verified):
 * complete_login decides; on ok a session is opened (with the remembered company, if any) and the
 * login recorded, otherwise the rejection is recorded.
 */
async function completeLogin(
  deps: RouteDeps,
  identity: AcceptedIdentity,
  rememberedCompanyId: string | null,
): Promise<LoginOutcome> {
  return inTransaction(deps.pool, { email: identity.email }, async (client) => {
    const { rows } = await client.query<CompleteLoginRow>(
      'select result, user_id from office.complete_login($1, $2)',
      [identity.sub, identity.name],
    );
    const row = rows[0];
    if (row?.result === 'ok' && row.user_id !== null) {
      const { key, keyHash } = newSessionKey();
      // The absolute expiry is computed from the database clock, which checks it.
      const opened = await client.query<{ id: string }>(
        'select office.open_session($1, $2, now() + make_interval(secs => $3)) as id',
        [keyHash, identity.sub, SESSION_MAX_AGE_SECONDS],
      );
      const sessionId = opened.rows[0]?.id;
      if (sessionId === undefined) {
        throw new Error('open_session returned no session');
      }
      const companyRemembered =
        rememberedCompanyId !== null &&
        (await rememberCompany(client, keyHash, rememberedCompanyId));
      await recordLoginEvent(client, 'login', null, row.user_id, sessionId);
      return { kind: 'signed_in', key, companyRemembered };
    }
    await recordLoginEvent(
      client,
      'rejected',
      rejectionReason(row?.result),
      row?.user_id ?? null,
      null,
    );
    return { kind: 'rejected' };
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, pool, authProvider, runner, limits } = deps;
  const startLimit = signInLimiter(app, 'signin', limits.signIn);
  const callbackLimit = signInLimiter(app, 'callback', limits.callback);

  async function recordRejection(request: FastifyRequest, reason: RejectionReason): Promise<void> {
    try {
      await inTransaction(pool, {}, (client) =>
        recordLoginEvent(client, 'rejected', reason, null, null),
      );
    } catch (error) {
      // The rejection stands even if it could not be recorded.
      request.log.error({ failure: loggableError(error) }, 'rejected login was not recorded');
    }
  }

  app.get('/api/auth/google', PAGE_ROUTE, async (request, reply) => {
    if (await startLimit(request)) {
      request.log.warn('sign-in start rate limit reached');
      return toLogin(reply, 'unavailable');
    }
    if (!authProvider) {
      return toLogin(reply, 'unavailable');
    }
    const checks = newLoginChecks();
    let url: URL;
    try {
      url = await authProvider.buildAuthorizationUrl(checks);
    } catch (error) {
      request.log.warn({ failure: loggableError(error) }, 'Google sign-in could not start');
      return toLogin(reply, 'unavailable');
    }
    setLoginCookie(reply, config, checks);
    return reply.redirect(url.href, 302);
  });

  app.get('/api/auth/google/callback', PAGE_ROUTE, async (request, reply) => {
    const checks = readLoginCookie(request, config);
    // The one-time values are used once, whatever happens next.
    clearLoginCookie(reply, config);
    if (await callbackLimit(request)) {
      request.log.warn('sign-in callback rate limit reached');
      return toLogin(reply, 'unavailable');
    }
    if (!authProvider) {
      return toLogin(reply, 'unavailable');
    }
    const query = callbackQuery(request);
    const state = query?.get('state');
    if (!checks || !query || !state || !sameState(state, checks.state)) {
      return toLogin(reply, 'denied');
    }

    let claims: Record<string, unknown>;
    try {
      claims = await authProvider.handleCallback(query, checks);
    } catch (error) {
      const kind = error instanceof AuthProviderError ? error.kind : 'unavailable';
      request.log.warn({ failure: loggableError(error), kind }, 'Google callback failed');
      return toLogin(reply, kind === 'rejected' ? 'denied' : 'unavailable');
    }
    // The provider checked the nonce; checked again so that no provider can skip it.
    if (claims.nonce !== checks.nonce) {
      return toLogin(reply, 'denied');
    }

    const decision = checkClaims(claims, config);
    if (!decision.ok) {
      await recordRejection(request, decision.reason);
      return toLogin(reply, 'denied');
    }

    const remembered = readCompanyCookie(request, config);
    let outcome: LoginOutcome;
    try {
      outcome = await completeLogin(deps, decision.identity, remembered.companyId);
    } catch (error) {
      request.log.error({ failure: loggableError(error) }, 'login could not be completed');
      return toLogin(reply, 'unavailable');
    }
    if (outcome.kind === 'rejected') {
      return toLogin(reply, 'denied');
    }
    setSessionCookie(reply, config, outcome.key);
    if (remembered.present && !outcome.companyRemembered) {
      // Not a company of this person (any more, or another person's choice on this browser).
      clearCompanyCookie(reply, config);
    }
    return reply.redirect('/', 302);
  });

  // Logout answers 204 even for a session that has already ended; the cookie is cleared either way.
  app.post('/api/auth/logout', async (request, reply) => {
    const cookie = readSessionCookie(request, config);
    const keyHash = cookie === undefined ? null : hashSessionKey(cookie);
    if (keyHash) {
      await inTransaction(pool, {}, async (client) => {
        const session = await verifySession(client, keyHash);
        if (!session) return;
        await client.query('select office.close_session($1)', [keyHash]);
        await recordLoginEvent(client, 'logout', null, session.userId, session.id);
      });
    }
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  // "Log out everywhere": every open session of the person, this one included.
  app.post('/api/auth/logout-all', async (request, reply) => {
    await runner.withSession(request, reply, async ({ client, session }) => {
      await client.query('select office.close_all_sessions()');
      await recordLoginEvent(client, 'logout_all', null, session.userId, session.id);
    });
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });
}
