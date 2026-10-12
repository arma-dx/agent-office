import { GITHUB_ADDRESS_PREFIX, type GithubPermission } from '@agent-office/shared';

/**
 * GitHub as the API sees it: what one GitHub App can be asked (8 October decisions 19 and 22;
 * 12 October decisions 12 to 17). Nothing outside apps/api/src/github talks to GitHub; the routes
 * go through GithubService (service.ts), which hands out the one client of the request's company.
 *
 * The interface has no method that writes to GitHub. Until the coding agents are built the
 * connection only reads (docs/SONRA.md P-e): the HTTP client behind it sends GET requests and one
 * POST, the one that asks for an installation token. Tests put a fake behind it and never call
 * the real GitHub.
 *
 * The types below hold only what the panel shows. The address and the name written inside a
 * commit, avatars, profile data, comments, reviews and file contents are in none of them, so they
 * cannot reach an answer, a log line or a cache.
 */

/** The account an app or an installation belongs to. */
export interface GithubAccount {
  id: number;
  // null: GitHub named none (an account of a kind this module does not know).
  login: string | null;
  // 'Organization', 'User', ...
  type: string | null;
}

/** GET /app: the app the client signs as. */
export interface GithubApp {
  id: number;
  slug: string;
  owner: GithubAccount | null;
}

/** One installation of the app (GET /app/installations). */
export interface GithubInstallation {
  id: number;
  appId: number;
  account: GithubAccount | null;
  targetType: string | null;
  suspendedAt: string | null;
  // Every permission the installation holds, as GitHub names it: 'contents' -> 'read'.
  permissions: Record<string, string>;
  repositorySelection: 'all' | 'selected';
  // The installation's page on github.com; null when GitHub gave none or one of another shape.
  htmlUrl: string | null;
}

/** A repository the installation reaches (GET /installation/repositories). */
export interface GithubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string | null;
  htmlUrl: string | null;
  owner: { id: number; login: string };
}

/** A commit of the default branch. `authorLogin` is the GitHub account, never the typed name. */
export interface GithubCommit {
  sha: string;
  message: string;
  authorLogin: string | null;
  date: string | null;
  htmlUrl: string | null;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  authorLogin: string | null;
  createdAt: string;
  draft: boolean;
  htmlUrl: string | null;
}

/** GitHub's REST API counts every pull request as an issue; `isPullRequest` tells them apart. */
export interface GithubIssue {
  number: number;
  title: string;
  authorLogin: string | null;
  createdAt: string;
  htmlUrl: string | null;
  isPullRequest: boolean;
}

/**
 * The answer of a list that was asked with the tag of the last answer: unchanged (GitHub answered
 * 304, which costs nothing of the request limit), or the rows with their new tag. `more`: GitHub
 * has a further page.
 */
export type Conditional<T> =
  { changed: false } | { changed: true; items: T[]; more: boolean; etag: string | null };

export interface GithubApi {
  /** GET /app. */
  app(): Promise<GithubApp>;
  /** GET /app/installations, read to its end. */
  installations(): Promise<GithubInstallation[]>;
  /** GET /installation/repositories; `truncated`: the installation reaches more than was read. */
  repositories(
    installationId: number,
  ): Promise<{ repositories: GithubRepository[]; truncated: boolean }>;
  /** The last commits of the default branch. */
  commits(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubCommit>>;
  /** The open pull requests, newest first. */
  pullRequests(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubPullRequest>>;
  /** The open issues, pull requests among them. */
  issues(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubIssue>>;
  /** Drops what the client holds in memory for the installation (its token). Calls nothing. */
  forget(installationId: number): void;
}

/**
 * unauthorized: GitHub refused the app's own signature (the key is wrong or was deleted).
 * installation_gone: no token can be had for the installation (removed, suspended, or not this
 *   app's installation).
 * not_found, forbidden: the answer to the request itself.
 * rate_limited: GitHub takes no request before `retryAtMs`.
 * unavailable: no answer, a server error, a redirect to another host, or a status this module
 *   does not expect.
 * invalid_answer: an answer of another shape than GitHub documents.
 */
export type GithubErrorKind =
  | 'unauthorized'
  | 'installation_gone'
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_answer';

/**
 * A call to GitHub that did not give what was asked. It carries its kind, the HTTP status, GitHub's
 * request id and, for a rate limit, when to ask again: never a body, a header or a list of what a
 * schema refused (the answer to the token request holds the token, and such a list may quote what
 * it refused).
 */
export class GithubError extends Error {
  readonly kind: GithubErrorKind;
  // null: there was no answer (a timeout, a network failure).
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryAtMs: number | null;

  constructor(
    kind: GithubErrorKind,
    details: { status?: number | null; requestId?: string | null; retryAtMs?: number | null } = {},
  ) {
    super(
      details.status === undefined || details.status === null
        ? `GitHub call failed: ${kind}`
        : `GitHub call failed: ${kind} (${String(details.status)})`,
    );
    this.name = 'GithubError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.requestId = details.requestId ?? null;
    this.retryAtMs = details.retryAtMs ?? null;
  }
}

/** The four repository permissions of the app (12 October decision 14), each read only. */
export const READ_PERMISSIONS: readonly GithubPermission[] = [
  'metadata',
  'contents',
  'pull_requests',
  'issues',
];

/** An address GitHub gave, kept only when it is a page on github.com; anything else is no link. */
export function githubLink(url: unknown): string | null {
  return typeof url === 'string' &&
    url.length <= 2000 &&
    url.startsWith(GITHUB_ADDRESS_PREFIX) &&
    URL.canParse(url)
    ? url
    : null;
}

/** What a failed call writes to the log: never a header, a token, a signature or a body. */
export interface GithubLog {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export const SILENT_GITHUB_LOG: GithubLog = { warn: () => undefined, error: () => undefined };
