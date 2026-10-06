import { COMPANY_HEADER, roleSchema, type Role } from '@agent-office/shared';
import { setContext, withContext, type ContextInput, type createPool } from '@agent-office/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from './env.ts';
import { ApiError, unauthenticated } from './errors.ts';
import {
  SESSION_IDLE_SECONDS,
  clearSessionCookie,
  hashSessionKey,
  readSessionCookie,
} from './session.ts';

export type Pool = ReturnType<typeof createPool>;
export type DbClient = Parameters<typeof setContext>[0];

export interface Session {
  id: string;
  userId: string;
  lastCompanyId: string | null;
  keyHash: Buffer;
}

export interface SessionContext {
  client: DbClient;
  session: Session;
}

export interface CompanyContext extends SessionContext {
  companyId: string;
  role: Role;
}

const companyIdSchema = z.uuid();

export const noCompanyAccess = (): ApiError =>
  new ApiError(403, 'forbidden', 'Bu şirkete erişim yetkiniz yok. Şirket seçimini denetleyin.');

export const founderOnly = (): ApiError =>
  new ApiError(403, 'founder_only', 'Bu işlemi yalnızca şirketin kurucusu yapabilir.');

// Not `forbidden`: that message is about the company selection, and this person is a member.
export const insidersOnly = (): ApiError =>
  new ApiError(403, 'insiders_only', 'Bu ekran dış kişilere açık değil.');

interface VerifiedSessionRow {
  session_id: string;
  user_id: string;
  last_company_id: string | null;
}

/**
 * Checks the session key inside the open transaction. verify_session closes a session that is past
 * its limits, so the transaction must be committed even when the answer is "no session".
 */
export async function verifySession(client: DbClient, keyHash: Buffer): Promise<Session | null> {
  const { rows } = await client.query<VerifiedSessionRow>(
    'select session_id, user_id, last_company_id from office.verify_session($1, $2)',
    [keyHash, SESSION_IDLE_SECONDS],
  );
  const row = rows[0];
  return row
    ? { id: row.session_id, userId: row.user_id, lastCompanyId: row.last_company_id, keyHash }
    : null;
}

/**
 * Thrown by a handler whose writes must stay although the request fails: a failed passkey attempt
 * is counted against its challenge, and rolling the count back would allow unlimited attempts. The
 * runner commits the transaction and then answers with the error. The transaction must be usable
 * when it is thrown (a failed statement rolled back to a savepoint first).
 */
export class CommitThenFail extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'CommitThenFail';
    this.error = error;
  }
}

type Outcome<T> =
  { kind: 'ok'; value: T } | { kind: 'no_session' } | { kind: 'failed'; error: ApiError };

/**
 * Runs every signed-in request as ONE transaction (rule 9): BEGIN, verify the session, set the
 * context (person, and for company routes the company), run the handler, COMMIT. The context is set
 * with set_config(..., true), so it ends with the transaction and never stays on a pooled
 * connection. A thrown error rolls the transaction back, except CommitThenFail, which is answered
 * after the commit; a dead session is answered with 401 after the commit that records its closing.
 */
export class RequestRunner {
  readonly #pool: Pool;
  readonly #config: ServerConfig;

  constructor(pool: Pool, config: ServerConfig) {
    this.#pool = pool;
    this.#config = config;
  }

  /** Any signed-in person; the context holds only the person. */
  async withSession<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    handler: (ctx: SessionContext) => Promise<T>,
  ): Promise<T> {
    return this.#run(request, reply, async (client, session) => {
      await setContext(client, { userId: session.userId });
      return handler({ client, session });
    });
  }

  /**
   * A member of the company named in the x-company-id header (403 otherwise); with founderOnly, its
   * founder; with insidersOnly, its founder or an employee, not an external person. The context
   * holds the person and the company.
   */
  async withCompany<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    access: { founderOnly: boolean; insidersOnly?: boolean },
    handler: (ctx: CompanyContext) => Promise<T>,
  ): Promise<T> {
    return this.#run(request, reply, async (client, session) => {
      const header = request.headers[COMPANY_HEADER];
      const parsed = companyIdSchema.safeParse(header);
      if (!parsed.success) {
        throw noCompanyAccess();
      }
      const companyId = parsed.data;
      await setContext(client, { userId: session.userId, companyId });
      const { rows } = await client.query<{ role: string | null }>(
        'select office.my_role() as role',
      );
      const role = roleSchema.safeParse(rows[0]?.role);
      if (!role.success) {
        throw noCompanyAccess();
      }
      if (access.founderOnly && role.data !== 'founder') {
        throw founderOnly();
      }
      if (access.insidersOnly === true && role.data === 'external') {
        throw insidersOnly();
      }
      return handler({ client, session, companyId, role: role.data });
    });
  }

  async #run<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    handler: (client: DbClient, session: Session) => Promise<T>,
  ): Promise<T> {
    const cookie = readSessionCookie(request, this.#config);
    if (cookie === undefined) {
      throw unauthenticated();
    }
    const keyHash = hashSessionKey(cookie);
    if (keyHash === null) {
      clearSessionCookie(reply, this.#config);
      throw unauthenticated();
    }
    const outcome = await withContext(this.#pool, {}, async (client): Promise<Outcome<T>> => {
      const session = await verifySession(client, keyHash);
      if (!session) {
        return { kind: 'no_session' };
      }
      try {
        return { kind: 'ok', value: await handler(client, session) };
      } catch (error) {
        if (error instanceof CommitThenFail) {
          return { kind: 'failed', error: error.error };
        }
        throw error;
      }
    });
    if (outcome.kind === 'no_session') {
      clearSessionCookie(reply, this.#config);
      throw unauthenticated();
    }
    if (outcome.kind === 'failed') {
      throw outcome.error;
    }
    return outcome.value;
  }
}

/**
 * A request without a verified session (the sign-in callback, logout): one transaction with the
 * given context, which ends with it.
 */
export async function inTransaction<T>(
  pool: Pool,
  context: ContextInput,
  handler: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withContext(pool, context, handler);
}

interface RoleRow {
  superuser: boolean;
  bypass_rls: boolean;
  privileged_member: boolean;
  api_member: boolean;
}

/**
 * Refuses to serve with a database role that would switch the row policies off (rule 9): a
 * superuser, a BYPASSRLS role, or a member of one; or a role that is not the API's (member of
 * office_api_private). Called once at startup. The error names the reason only, never the role or
 * the connection string.
 */
export async function assertRestrictedRole(pool: Pool): Promise<void> {
  const { rows } = await pool.query<RoleRow>(
    `select r.rolsuper as superuser,
            r.rolbypassrls as bypass_rls,
            exists (
              select 1 from pg_catalog.pg_roles p
              where (p.rolsuper or p.rolbypassrls)
                and pg_catalog.pg_has_role(current_user, p.oid, 'member')
            ) as privileged_member,
            exists (
              select 1 from pg_catalog.pg_roles p
              where p.rolname = 'office_api_private'
                and pg_catalog.pg_has_role(current_user, p.oid, 'member')
            ) as api_member
     from pg_catalog.pg_roles r
     where r.rolname = current_user`,
  );
  const role = rows[0];
  if (!role) {
    throw new Error('The database role could not be checked');
  }
  if (role.superuser) {
    throw new Error('The database role is a superuser; DATABASE_URL must use the restricted role');
  }
  if (role.bypass_rls) {
    throw new Error('The database role bypasses row level security; use the restricted role');
  }
  if (role.privileged_member) {
    throw new Error(
      'The database role is a member of a superuser or BYPASSRLS role; use the restricted role',
    );
  }
  if (!role.api_member) {
    throw new Error('The database role is not a member of office_api_private; use the API role');
  }
}
