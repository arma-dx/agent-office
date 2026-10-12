import { z } from 'zod';
import type { GithubAppConfig } from '../env.ts';
import {
  GithubError,
  READ_PERMISSIONS,
  SILENT_GITHUB_LOG,
  githubLink,
  type Conditional,
  type GithubAccount,
  type GithubApi,
  type GithubApp,
  type GithubCommit,
  type GithubInstallation,
  type GithubIssue,
  type GithubLog,
  type GithubPullRequest,
  type GithubRepository,
} from './api.ts';
import { appJwt } from './jwt.ts';

/**
 * GitHub over HTTPS, as ONE GitHub App: one instance per configured app, built with that app's
 * client ID and private key and with nothing of any other app. It holds the app's signature and
 * the installation tokens it was given in its own private fields.
 *
 * Read only: every request is a GET, except the one POST that asks for an installation token, and
 * every token is asked for with the four read permissions only (cut to what the installation
 * has), so a token of this client cannot write even if the app is given more later.
 *
 * The address is a constant, never read from the environment. A redirect is followed once and
 * only to the same host: a token is never sent anywhere else.
 */
export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
export const GITHUB_USER_AGENT = 'agent-office';
export const GITHUB_CALL_TIMEOUT_MS = 5000;

// The app's signature is made for nine minutes and used for five.
const JWT_REUSE_SECONDS = 300;
// A token lives an hour; it is asked for again five minutes before its end.
const TOKEN_MARGIN_MS = 5 * 60_000;
const PAGE_SIZE = 100;
// 1,000 installations or repositories at most.
const MAX_PAGES = 10;
export const COMMITS_PER_PAGE = 20;
export const PULL_REQUESTS_PER_PAGE = 20;
// Pull requests are among the issues and are dropped; more are read so that twenty stay.
export const ISSUES_PER_PAGE = 50;
// Without a time from GitHub a rate limit holds for a minute; never longer than an hour.
const RATE_LIMIT_DEFAULT_MS = 60_000;
const RATE_LIMIT_MAX_MS = 60 * 60_000;

// What is taken from GitHub's answers: these fields and no others. A plain object schema drops
// every other key, so the address and the name written inside a commit are not even kept.
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const accountSchema = z.object({
  id,
  login: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
});
const appSchema = z.object({ id, slug: z.string().max(200), owner: accountSchema.nullish() });
const installationSchema = z.object({
  id,
  app_id: id,
  account: accountSchema.nullish(),
  target_type: z.string().max(50).nullish(),
  suspended_at: z.string().max(100).nullish(),
  permissions: z.record(z.string().max(100), z.string().max(20)).default({}),
  repository_selection: z.enum(['all', 'selected']),
  html_url: z.string().nullish(),
});
const repositorySchema = z.object({
  id,
  name: z.string().min(1).max(200),
  full_name: z.string().min(1).max(300),
  private: z.boolean(),
  archived: z.boolean().default(false),
  default_branch: z.string().max(255).nullish(),
  html_url: z.string().nullish(),
  owner: z.object({ id, login: z.string().min(1).max(100) }),
});
const repositoriesPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema),
});
const userSchema = z.object({ login: z.string().optional() }).nullish();
const commitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  commit: z.object({
    message: z.string(),
    // The date only: the name and the address beside it are not taken.
    author: z.object({ date: z.string().nullish() }).nullish(),
  }),
  author: userSchema,
  html_url: z.string().nullish(),
});
const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  user: userSchema,
  created_at: z.iso.datetime({ offset: true }),
  draft: z.boolean().optional(),
  html_url: z.string().nullish(),
});
const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  user: userSchema,
  created_at: z.iso.datetime({ offset: true }),
  html_url: z.string().nullish(),
  pull_request: z.unknown().optional(),
});
const tokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
});
const isoDate = z.iso.datetime({ offset: true });

function account(raw: z.output<typeof accountSchema> | null | undefined): GithubAccount | null {
  return raw ? { id: raw.id, login: raw.login ?? null, type: raw.type ?? null } : null;
}

function installation(raw: z.output<typeof installationSchema>): GithubInstallation {
  return {
    id: raw.id,
    appId: raw.app_id,
    account: account(raw.account),
    targetType: raw.target_type ?? null,
    suspendedAt: raw.suspended_at ?? null,
    permissions: raw.permissions,
    repositorySelection: raw.repository_selection,
    htmlUrl: githubLink(raw.html_url),
  };
}

type Auth = { kind: 'app' } | { kind: 'installation'; installationId: number };

interface Call {
  method: 'GET' | 'POST';
  // Built from validated parts only; never from anything a person typed.
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  etag?: string | null;
}

interface Answer {
  status: number;
  json: unknown;
  etag: string | null;
  // GitHub names a further page.
  more: boolean;
  requestId: string | null;
}

export interface HttpGithubOptions {
  fetch?: typeof fetch;
  now?: () => number;
  log?: GithubLog;
}

export class HttpGithubApi implements GithubApi {
  readonly #companyCode: string;
  readonly #clientId: string;
  readonly #key: GithubAppConfig['privateKey'];
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: GithubLog;
  #jwt: { value: string; madeAtSeconds: number } | null = null;
  readonly #tokens = new Map<number, { token: string; expiresAtMs: number }>();
  // One token request at a time per installation.
  readonly #tokenRequests = new Map<number, Promise<string>>();

  constructor(app: GithubAppConfig, options: HttpGithubOptions = {}) {
    this.#companyCode = app.companyCode;
    this.#clientId = app.clientId;
    this.#key = app.privateKey;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? SILENT_GITHUB_LOG;
  }

  async app(): Promise<GithubApp> {
    const answer = await this.#call({ kind: 'app' }, { method: 'GET', path: '/app' });
    const raw = this.#parse(appSchema, answer);
    return { id: raw.id, slug: raw.slug, owner: account(raw.owner) };
  }

  async installations(): Promise<GithubInstallation[]> {
    const all: GithubInstallation[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const answer = await this.#call(
        { kind: 'app' },
        {
          method: 'GET',
          path: '/app/installations',
          query: { per_page: String(PAGE_SIZE), page: String(page) },
        },
      );
      const rows = this.#parse(z.array(installationSchema), answer);
      all.push(...rows.map(installation));
      if (rows.length < PAGE_SIZE) {
        break;
      }
    }
    return all;
  }

  async repositories(
    installationId: number,
  ): Promise<{ repositories: GithubRepository[]; truncated: boolean }> {
    const all: GithubRepository[] = [];
    let total = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const answer = await this.#call(
        { kind: 'installation', installationId },
        {
          method: 'GET',
          path: '/installation/repositories',
          query: { per_page: String(PAGE_SIZE), page: String(page) },
        },
      );
      const raw = this.#parse(repositoriesPageSchema, answer);
      total = raw.total_count;
      for (const row of raw.repositories) {
        all.push({
          id: row.id,
          name: row.name,
          fullName: row.full_name,
          private: row.private,
          archived: row.archived,
          defaultBranch: row.default_branch ?? null,
          htmlUrl: githubLink(row.html_url),
          owner: row.owner,
        });
      }
      if (raw.repositories.length < PAGE_SIZE) {
        break;
      }
    }
    return { repositories: all, truncated: total > all.length };
  }

  async commits(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubCommit>> {
    const answer = await this.#list(installationId, repository, 'commits', etag, {
      per_page: String(COMMITS_PER_PAGE),
    });
    if (answer === null) {
      return { changed: false };
    }
    const items = this.#parse(z.array(commitSchema), answer).map((row) => {
      const date = row.commit.author?.date;
      return {
        sha: row.sha,
        message: row.commit.message,
        authorLogin: row.author?.login ?? null,
        date: isoDate.safeParse(date).success ? (date ?? null) : null,
        htmlUrl: githubLink(row.html_url),
      };
    });
    return { changed: true, items, more: answer.more, etag: answer.etag };
  }

  async pullRequests(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubPullRequest>> {
    const answer = await this.#list(installationId, repository, 'pulls', etag, {
      state: 'open',
      per_page: String(PULL_REQUESTS_PER_PAGE),
    });
    if (answer === null) {
      return { changed: false };
    }
    const items = this.#parse(z.array(pullRequestSchema), answer).map((row) => ({
      number: row.number,
      title: row.title,
      authorLogin: row.user?.login ?? null,
      createdAt: row.created_at,
      draft: row.draft ?? false,
      htmlUrl: githubLink(row.html_url),
    }));
    return { changed: true, items, more: answer.more, etag: answer.etag };
  }

  async issues(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubIssue>> {
    const answer = await this.#list(installationId, repository, 'issues', etag, {
      state: 'open',
      per_page: String(ISSUES_PER_PAGE),
    });
    if (answer === null) {
      return { changed: false };
    }
    const items = this.#parse(z.array(issueSchema), answer).map((row) => ({
      number: row.number,
      title: row.title,
      authorLogin: row.user?.login ?? null,
      createdAt: row.created_at,
      htmlUrl: githubLink(row.html_url),
      isPullRequest: row.pull_request !== undefined && row.pull_request !== null,
    }));
    return { changed: true, items, more: answer.more, etag: answer.etag };
  }

  forget(installationId: number): void {
    this.#tokens.delete(installationId);
  }

  // One of the three lists of a repository; null when GitHub says it did not change.
  async #list(
    installationId: number,
    repository: GithubRepository,
    list: 'commits' | 'pulls' | 'issues',
    etag: string | null,
    query: Record<string, string>,
  ): Promise<Answer | null> {
    // The owner and the name are GitHub's own, from its list of the installation's repositories.
    const owner = encodeURIComponent(repository.owner.login);
    const name = encodeURIComponent(repository.name);
    const answer = await this.#call(
      { kind: 'installation', installationId },
      { method: 'GET', path: `/repos/${owner}/${name}/${list}`, query, etag },
    );
    return answer.status === 304 ? null : answer;
  }

  #parse<T extends z.ZodType>(schema: T, answer: Answer): z.output<T> {
    const parsed = schema.safeParse(answer.json);
    if (!parsed.success) {
      // No list of what was refused: it may quote the answer.
      throw new GithubError('invalid_answer', {
        status: answer.status,
        requestId: answer.requestId,
      });
    }
    return parsed.data;
  }

  #appSignature(): string {
    const nowSeconds = Math.floor(this.#now() / 1000);
    if (this.#jwt === null || nowSeconds - this.#jwt.madeAtSeconds >= JWT_REUSE_SECONDS) {
      this.#jwt = {
        value: appJwt(this.#clientId, this.#key, nowSeconds),
        madeAtSeconds: nowSeconds,
      };
    }
    return this.#jwt.value;
  }

  async #token(installationId: number): Promise<string> {
    const held = this.#tokens.get(installationId);
    if (held && this.#now() < held.expiresAtMs - TOKEN_MARGIN_MS) {
      return held.token;
    }
    this.#tokens.delete(installationId);
    const waiting = this.#tokenRequests.get(installationId);
    if (waiting) {
      return waiting;
    }
    const request = this.#requestToken(installationId).finally(() => {
      this.#tokenRequests.delete(installationId);
    });
    this.#tokenRequests.set(installationId, request);
    return request;
  }

  /**
   * Asks for a token of the installation with the four read permissions, cut to the ones the
   * installation has. An installation that is gone, suspended or not this app's gives none.
   */
  async #requestToken(installationId: number): Promise<string> {
    const path = `/app/installations/${String(installationId)}`;
    const gone = (error: unknown): never => {
      if (
        error instanceof GithubError &&
        (error.kind === 'not_found' || error.kind === 'forbidden')
      ) {
        throw new GithubError('installation_gone', {
          status: error.status,
          requestId: error.requestId,
        });
      }
      throw error;
    };
    const found = await this.#send(this.#appSignature(), { method: 'GET', path }).catch(gone);
    const state = installation(this.#parse(installationSchema, found));
    const permissions = Object.fromEntries(
      READ_PERMISSIONS.filter((name) => state.permissions[name] !== undefined).map((name) => [
        name,
        'read',
      ]),
    );
    // A request without permissions would be given every permission of the app.
    if (state.suspendedAt !== null || Object.keys(permissions).length === 0) {
      throw new GithubError('installation_gone', { status: found.status });
    }
    const answer = await this.#send(this.#appSignature(), {
      method: 'POST',
      path: `${path}/access_tokens`,
      body: { permissions },
    }).catch(gone);
    const token = this.#parse(tokenSchema, answer);
    this.#tokens.set(installationId, {
      token: token.token,
      expiresAtMs: Date.parse(token.expires_at),
    });
    return token.token;
  }

  async #call(auth: Auth, call: Call): Promise<Answer> {
    if (auth.kind === 'app') {
      return this.#send(this.#appSignature(), call);
    }
    // What goes wrong while a token is asked for is told as it is: a refused signature of the app
    // is "unauthorized", an installation without a token is "installation_gone".
    const token = await this.#token(auth.installationId);
    try {
      return await this.#send(token, call);
    } catch (error) {
      if (!(error instanceof GithubError) || error.kind !== 'unauthorized') {
        throw error;
      }
    }
    // The token itself was refused (it ended early, or the installation was removed): one new
    // token, and if that one is refused too the installation gives no access.
    this.#tokens.delete(auth.installationId);
    const fresh = await this.#token(auth.installationId);
    try {
      return await this.#send(fresh, call);
    } catch (error) {
      if (error instanceof GithubError && error.kind === 'unauthorized') {
        throw new GithubError('installation_gone', {
          status: error.status,
          requestId: error.requestId,
        });
      }
      throw error;
    }
  }

  /** One request; a redirect inside api.github.com is followed once, by hand. */
  async #send(bearer: string, call: Call): Promise<Answer> {
    const url = new URL(`${GITHUB_API_ORIGIN}${call.path}`);
    for (const [name, value] of Object.entries(call.query ?? {})) {
      url.searchParams.set(name, value);
    }
    let response = await this.#fetchOnce(url, bearer, call);
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (
        call.method !== 'GET' ||
        location === null ||
        !location.startsWith(`${GITHUB_API_ORIGIN}/`) ||
        !URL.canParse(location)
      ) {
        throw this.#failure(call, 'unavailable', response);
      }
      response = await this.#fetchOnce(new URL(location), bearer, call);
    }
    const requestId = requestIdOf(response);
    if (response.status === 304) {
      await response.body?.cancel();
      return { status: 304, json: null, etag: call.etag ?? null, more: false, requestId };
    }
    if (response.status !== 200 && response.status !== 201) {
      await response.body?.cancel();
      throw this.#failure(call, this.#kindOf(response), response);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw this.#failure(call, 'invalid_answer', response);
    }
    return {
      status: response.status,
      json,
      etag: response.headers.get('etag'),
      more: /rel="next"/.test(response.headers.get('link') ?? ''),
      requestId,
    };
  }

  async #fetchOnce(url: URL, bearer: string, call: Call): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': GITHUB_USER_AGENT,
      authorization: `Bearer ${bearer}`,
    };
    if (call.etag) {
      headers['if-none-match'] = call.etag;
    }
    if (call.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    try {
      return await this.#fetch(url, {
        method: call.method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(GITHUB_CALL_TIMEOUT_MS),
        ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      });
    } catch {
      // A timeout or a network failure: the error may name the address, never more.
      throw this.#failure(call, 'unavailable', null);
    }
  }

  #kindOf(response: Response): GithubError['kind'] {
    const { status } = response;
    const limited =
      response.headers.get('x-ratelimit-remaining') === '0' ||
      response.headers.get('retry-after') !== null;
    if (status === 429 || (status === 403 && limited)) {
      return 'rate_limited';
    }
    if (status === 401) {
      return 'unauthorized';
    }
    if (status === 403) {
      return 'forbidden';
    }
    return status === 404 ? 'not_found' : 'unavailable';
  }

  /** When GitHub takes requests again, from its headers; a minute when it says nothing. */
  #retryAt(response: Response): number {
    const now = this.#now();
    const retryAfter = Number(response.headers.get('retry-after') ?? Number.NaN);
    const reset = Number(response.headers.get('x-ratelimit-reset') ?? Number.NaN);
    const at =
      Number.isFinite(retryAfter) && retryAfter >= 0
        ? now + retryAfter * 1000
        : Number.isFinite(reset) && reset * 1000 > now
          ? reset * 1000
          : now + RATE_LIMIT_DEFAULT_MS;
    return Math.min(at, now + RATE_LIMIT_MAX_MS);
  }

  // Builds the error and writes the one log line of a failed call: the company's code, the
  // method, the path without its query, the status and GitHub's request id.
  #failure(call: Call, kind: GithubError['kind'], response: Response | null): GithubError {
    const status = response?.status ?? null;
    const requestId = response ? requestIdOf(response) : null;
    this.#log.warn(
      { company: this.#companyCode, method: call.method, path: call.path, status, requestId, kind },
      'GitHub call failed',
    );
    return new GithubError(kind, {
      status,
      requestId,
      retryAtMs: kind === 'rate_limited' && response ? this.#retryAt(response) : null,
    });
  }
}

function requestIdOf(response: Response): string | null {
  const value = response.headers.get('x-github-request-id');
  return value !== null && /^[A-Za-z0-9:._-]{1,100}$/.test(value) ? value : null;
}
