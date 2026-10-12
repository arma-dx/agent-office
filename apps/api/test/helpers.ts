import {
  agentRunJobSchema,
  createPool,
  type AgentRunJob,
  type AgentRunSender,
} from '@agent-office/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { inject } from 'vitest';
import {
  AuthProviderError,
  type AuthProvider,
  type AuthProviderFailure,
  type LoginChecks,
} from '../src/auth/provider.ts';
import type { Pool } from '../src/db.ts';
import { loadApiEnv, serverConfig, type ServerConfig } from '../src/env.ts';
import { MemoryFileStorage } from '../src/files/storage.ts';
import { ProjectFileStore } from '../src/files/store.ts';
import type { RateLimits } from '../src/security.ts';
import { buildServer } from '../src/server.ts';
import type { Account } from './fixtures.ts';

const database = inject('database');

/** Without a database connection string (locally) the database tests are skipped. */
export const noDatabase = database === null;

export const PANEL_ORIGIN = 'https://office.example.test';
export const SESSION_COOKIE = '__Host-session';
export const LOGIN_COOKIE = '__Host-login';
export const COMPANY_COOKIE = '__Host-company';
const GOOGLE_ISSUER = 'https://accounts.google.com';
// The limits of the shared test server are high; the rate limit test builds its own server.
const RELAXED_LIMITS: RateLimits = { signIn: 100_000, callback: 100_000, other: 100_000 };

function connectionString(kind: 'app' | 'admin'): string {
  if (!database) {
    throw new Error('No test database');
  }
  return database[kind];
}

export function testConfig(overrides: Record<string, string> = {}): ServerConfig {
  return serverConfig(
    loadApiEnv({
      NODE_ENV: 'test',
      DATABASE_URL: database?.app ?? 'postgresql://office_api@127.0.0.1:5432/postgres',
      PANEL_ORIGIN,
      COOKIE_SECRET: 'x'.repeat(48),
      COMPANY_EMAIL_DOMAINS: 'armadx.test,pillika.test',
      ...overrides,
    }),
  );
}

/** Google stand-in: each code handed to the callback maps to the claims of one ID token. */
export class FakeGoogle implements AuthProvider {
  readonly #claims = new Map<string, Record<string, unknown>>();
  #counter = 0;
  failure: AuthProviderFailure | null = null;
  callbacks = 0;

  /** Registers the claims Google would return for the next sign-in; returns the code. */
  issue(claims: Record<string, unknown>): string {
    const code = `code-${String(++this.#counter)}`;
    this.#claims.set(code, claims);
    return code;
  }

  buildAuthorizationUrl(checks: LoginChecks): Promise<URL> {
    const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
    url.searchParams.set('state', checks.state);
    url.searchParams.set('nonce', checks.nonce);
    return Promise.resolve(url);
  }

  handleCallback(query: URLSearchParams, checks: LoginChecks): Promise<Record<string, unknown>> {
    this.callbacks += 1;
    if (this.failure) {
      return Promise.reject(new AuthProviderError(this.failure, 'fake failure'));
    }
    const claims = this.#claims.get(query.get('code') ?? '');
    if (!claims) {
      return Promise.reject(new AuthProviderError('rejected', 'unknown code'));
    }
    return Promise.resolve({ iss: GOOGLE_ISSUER, aud: 'client', nonce: checks.nonce, ...claims });
  }
}

/** Claims of a verified Google account; amr shows a second factor unless overridden. */
export function claimsOf(
  account: Account,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sub: account.sub,
    email: account.email,
    email_verified: true,
    name: 'Test Kişisi',
    amr: ['pwd', 'mfa'],
    ...(account.hd ? { hd: account.hd } : {}),
    ...overrides,
  };
}

/**
 * Stands in for the queue: checks the job as the real sender does, touches the request's own
 * connection and remembers what was sent. The queue itself is tested in packages/db, and the whole
 * flow with a real queue in apps/worker.
 */
export class RecordingJobs implements AgentRunSender {
  readonly sent: AgentRunJob[] = [];

  async send(client: Parameters<AgentRunSender['send']>[0], job: AgentRunJob): Promise<void> {
    const data = agentRunJobSchema.parse(job);
    await client.query('select 1');
    this.sent.push(data);
  }
}

export interface TestServer {
  app: FastifyInstance;
  google: FakeGoogle;
  config: ServerConfig;
  jobs: RecordingJobs;
  // The file storage of the tests: in memory, can be told to fail.
  storage: MemoryFileStorage;
  close(): Promise<void>;
}

export function createTestServer(
  options: {
    config?: ServerConfig;
    rateLimits?: RateLimits;
    provider?: AuthProvider | null;
    logStream?: { write: (line: string) => void };
    // The flow test of the worker passes a sender of the real queue.
    jobs?: AgentRunSender;
    // false: a server whose environment has no file storage.
    fileStorage?: boolean;
    uploadBufferBytes?: number;
    downloadBufferBytes?: number;
    uploadDeadlineMs?: (declaredBytes: number) => number;
    // The storage of this server; the default is a new one in memory.
    storage?: MemoryFileStorage;
  } = {},
): TestServer {
  const pool: Pool = createPool(connectionString('app'), 'agent-office-api-test', () => {});
  const google = new FakeGoogle();
  const jobs = new RecordingJobs();
  const config = options.config ?? testConfig();
  const storage = options.storage ?? new MemoryFileStorage();
  const app = buildServer({
    ...(options.logStream ? { logStream: options.logStream } : { logger: false }),
    services: {
      config,
      pool,
      authProvider: options.provider === undefined ? google : options.provider,
      rateLimits: options.rateLimits ?? RELAXED_LIMITS,
      jobs: options.jobs ?? jobs,
      files: new ProjectFileStore(options.fileStorage === false ? null : storage),
      ...(options.uploadBufferBytes !== undefined
        ? { uploadBufferBytes: options.uploadBufferBytes }
        : {}),
      ...(options.downloadBufferBytes !== undefined
        ? { downloadBufferBytes: options.downloadBufferBytes }
        : {}),
      ...(options.uploadDeadlineMs !== undefined
        ? { uploadDeadlineMs: options.uploadDeadlineMs }
        : {}),
    },
  });
  return {
    app,
    google,
    config,
    jobs,
    storage,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export interface SignInResult {
  start: LightMyRequestResponse;
  callback: LightMyRequestResponse;
  // The session cookie's value, when a session was opened.
  session: string | undefined;
}

export function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
  const found = response.cookies.find((c) => c.name === name && c.value !== '');
  return found?.value;
}

/**
 * The whole Google flow through the fake provider: start (startUrl may ask for a page to return
 * to), then the callback with the login cookie and any other cookies the browser holds (for
 * example the remembered company).
 */
export async function signIn(
  server: TestServer,
  claims: Record<string, unknown>,
  names = { login: LOGIN_COOKIE, session: SESSION_COOKIE },
  browserCookies: Record<string, string> = {},
  startUrl = '/api/auth/google',
): Promise<SignInResult> {
  const start = await server.app.inject({ method: 'GET', url: startUrl });
  const location = new URL(String(start.headers.location));
  const state = location.searchParams.get('state') ?? '';
  const loginCookie = cookieValue(start, names.login) ?? '';
  const code = server.google.issue(claims);
  const query = new URLSearchParams({ code, state, iss: GOOGLE_ISSUER });
  const callback = await server.app.inject({
    method: 'GET',
    url: `/api/auth/google/callback?${query.toString()}`,
    cookies: { ...browserCookies, [names.login]: loginCookie },
  });
  return { start, callback, session: cookieValue(callback, names.session) };
}

/** Signs in and returns the session cookie; fails the test when no session was opened. */
export async function sessionOf(
  server: TestServer,
  account: Account,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { session, callback } = await signIn(server, claimsOf(account, overrides));
  if (!session) {
    throw new Error(`Sign-in failed: ${String(callback.headers.location)}`);
  }
  return session;
}

/** Headers of a request the panel itself sends. */
export const SAME_ORIGIN = { origin: PANEL_ORIGIN, 'sec-fetch-site': 'same-origin' } as const;

let sharedAdminPool: Pool | undefined;

/** One-off query with the privileged role (only to prepare or verify the state). */
export async function adminQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  sharedAdminPool ??= createPool(
    connectionString('admin'),
    'agent-office-api-test-admin',
    () => {},
  );
  const { rows } = await sharedAdminPool.query<T>(sql, values);
  return rows;
}

/** Statements without parameters (several may be separated by semicolons). */
export async function adminExec(sql: string): Promise<void> {
  sharedAdminPool ??= createPool(
    connectionString('admin'),
    'agent-office-api-test-admin',
    () => {},
  );
  await sharedAdminPool.query(sql);
}

export async function closeAdminPool(): Promise<void> {
  await sharedAdminPool?.end();
  sharedAdminPool = undefined;
}

/** Number of login events matching the condition (reason codes only; no addresses are stored). */
export async function countLoginEvents(condition: string, values: unknown[] = []): Promise<number> {
  const [row] = await adminQuery<{ n: number }>(
    `select count(*)::int as n from office.login_events where ${condition}`,
    values,
  );
  return row?.n ?? 0;
}
