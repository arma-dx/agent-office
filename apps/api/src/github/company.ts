import {
  GITHUB_LIST_LIMIT,
  type GithubCommit as CommitRow,
  type GithubInvalidReason,
  type GithubIssue as IssueRow,
  type GithubLists,
  type GithubPermission,
  type GithubPullRequest as PullRequestRow,
  type GithubRepositorySelection,
  type LinkedRepository,
} from '@agent-office/shared';
import {
  GithubError,
  READ_PERMISSIONS,
  SILENT_GITHUB_LOG,
  githubLink,
  type Conditional,
  type GithubApi,
  type GithubLog,
  type GithubRepository,
} from './api.ts';

/**
 * Everything GitHub of ONE company (12 October decision 12: Arma DX and Pillika connect as two
 * separate organisations). An instance is built with the client of its own company's app and
 * holds its own discovery result, repository list, tab lists and rate limit stop in its own
 * private fields. Nothing here is shared between two instances: there is no module-level map and
 * no cache that is keyed by an installation or a repository alone.
 *
 * It never reads the database: a route reads the company's connection row in its transaction and
 * hands the installation and the organisation number to the methods below. A route gets its
 * instance from the code of the request's company only (GithubService).
 */

/** How long the checks of an installation are kept (the Ayarlar page asks on every load). */
export const DISCOVERY_CACHE_MS = 30_000;
/** The list of repositories is read live and kept five minutes; it is never stored. */
export const REPOSITORY_LIST_CACHE_MS = 5 * 60_000;
/** The list is read again on request, or for a repository it does not hold, once in ten seconds. */
export const REPOSITORY_LIST_REFRESH_STOP_MS = 10_000;
/** The whole list (up to ten pages) may take this long. */
export const REPOSITORY_LIST_DEADLINE_MS = 15_000;
/** The lists of a repository are fresh for a minute: at most one reading a minute. */
export const LISTS_CACHE_MS = 60_000;
/** A list the client still holds is dropped ten minutes after it was read. */
export const LISTS_KEEP_MS = 10 * 60_000;
const KEY_REFUSED_LOG_EVERY_MS = 60_000;
// The slug GitHub gave the app, as a path segment of the install link.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The connection of the company as its row holds it: which installation, of which organisation. */
export interface GithubConnectionRef {
  installationId: number;
  accountId: number;
}

/** What an acceptable installation of the company's app is. */
export interface InstalledApp {
  installationId: number;
  accountId: number;
  organization: string;
  appId: number;
  permissions: GithubPermission[];
  repositorySelection: GithubRepositorySelection;
  manageUrl: string | null;
}

/** Why GitHub gave nothing for the whole company. */
export type GithubUnreachable =
  'installation_gone' | 'key_refused' | 'rate_limited' | 'github_down';

/** The result of the checks a connection needs, all read with the app's own signature. */
export type Discovery =
  | { state: 'unavailable'; reason: 'github_down' | 'key_refused' | 'rate_limited' }
  | { state: 'not_installed'; installUrl: string }
  | {
      state: 'invalid';
      reason: GithubInvalidReason;
      actualOwner: string | null;
      manageUrl: string | null;
    }
  | { state: 'installed'; installation: InstalledApp };

export type RepositoryList =
  | { state: 'ok'; repositories: GithubRepository[]; truncated: boolean; fetchedAtMs: number }
  | { state: 'unavailable'; reason: GithubUnreachable; retryAtMs: number | null };

export type RepositoryLookup =
  | { state: 'found'; repository: GithubRepository }
  // Not among the repositories the installation reaches.
  | { state: 'missing' }
  | { state: 'unavailable'; reason: GithubUnreachable; retryAtMs: number | null };

/** What the "GitHub" tab of a project shows of its repository. */
export type RepositoryView =
  | { state: 'ok'; repository: LinkedRepository; lists: GithubLists }
  | {
      state: 'unavailable';
      // null: the client does not know the repository's present name.
      repository: LinkedRepository | null;
      reason: 'installation_gone' | 'repository_gone' | 'rate_limited' | 'github_down';
      retryAtMs: number | null;
      // Only with rate_limited and github_down; null otherwise, and when nothing is held.
      last: GithubLists | null;
    };

interface HeldRepositories {
  installationId: number;
  accountId: number;
  readAtMs: number;
  repositories: GithubRepository[];
  byId: Map<number, GithubRepository>;
  truncated: boolean;
}

interface HeldList<T> {
  items: T[];
  more: boolean;
  etag: string | null;
}

interface HeldLists {
  // The last attempt, whatever came of it: one attempt a minute.
  triedAtMs: number;
  // The last attempt did not reach GitHub.
  failed: boolean;
  // null: nothing was ever read.
  read: {
    atMs: number;
    repository: LinkedRepository;
    defaultBranch: string | null;
    private: boolean;
    archived: boolean;
    commits: HeldList<CommitRow> | null;
    pullRequests: HeldList<PullRequestRow> | null;
    issues: HeldList<IssueRow> | null;
  } | null;
}

function firstLine(text: string): string {
  const end = text.search(/[\r\n]/);
  return (end === -1 ? text : text.slice(0, end)).trim();
}

function cut(text: string | null, max: number): string | null {
  return text === null ? null : text.slice(0, max);
}

function linked(repository: GithubRepository): LinkedRepository {
  return {
    id: repository.id,
    fullName: repository.fullName.slice(0, 200),
    url: githubLink(repository.htmlUrl),
  };
}

function shown<T>(held: HeldList<T> | null): { items: T[]; more: boolean } | null {
  return held === null ? null : { items: held.items, more: held.more };
}

/** Resolves with the promise, or with the fallback when the promise takes too long. */
async function within<T>(promise: Promise<T>, ms: number, late: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(late());
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export class CompanyGithub {
  readonly companyCode: string;
  // The GitHub organisation the environment names for this company: who must own the app.
  readonly organization: string;
  readonly #api: GithubApi;
  readonly #now: () => number;
  readonly #log: GithubLog;
  // GitHub takes no request of this company's app before this moment.
  #blockedUntilMs = 0;
  #discovery: { atMs: number; value: Discovery } | null = null;
  #discovering: Promise<Discovery> | null = null;
  #repositories: HeldRepositories | null = null;
  #repositoriesReadAtMs = 0;
  #readingRepositories: { installationId: number; promise: Promise<RepositoryList> } | null = null;
  readonly #lists = new Map<string, HeldLists>();
  readonly #readingLists = new Map<string, Promise<RepositoryView>>();
  #keyRefusedLoggedAtMs = Number.NEGATIVE_INFINITY;
  // Raised whenever what is held is dropped: a reading that began before does not put its result
  // back afterwards.
  #generation = 0;

  constructor(
    config: { companyCode: string; organization: string },
    api: GithubApi,
    now: () => number = Date.now,
    log: GithubLog = SILENT_GITHUB_LOG,
  ) {
    this.companyCode = config.companyCode;
    this.organization = config.organization;
    this.#api = api;
    this.#now = now;
    this.#log = log;
  }

  /**
   * Is the company's app installed on the organisation the environment names, and is that
   * installation one the connection can use. Everything is read with the app's own signature;
   * nothing the browser sent takes part. `fresh` asks GitHub now (before a connection is
   * written); otherwise an answer of the last thirty seconds is given again.
   */
  async discover(options: { fresh?: boolean } = {}): Promise<Discovery> {
    const held = this.#discovery;
    if (!options.fresh && held && this.#now() - held.atMs < DISCOVERY_CACHE_MS) {
      return held.value;
    }
    if (this.#blocked()) {
      return { state: 'unavailable', reason: 'rate_limited' };
    }
    this.#discovering ??= this.#runDiscovery().finally(() => {
      this.#discovering = null;
    });
    return this.#discovering;
  }

  async #runDiscovery(): Promise<Discovery> {
    const generation = this.#generation;
    const value = await this.#checkInstallation();
    if (generation === this.#generation) {
      this.#discovery = { atMs: this.#now(), value };
    }
    return value;
  }

  async #checkInstallation(): Promise<Discovery> {
    try {
      const app = await this.#api.app();
      const owner = app.owner;
      // The app belongs to an organisation, and to the one the environment names for THIS
      // company: this is what catches the credentials of the two companies being exchanged.
      if (owner === null || owner.type !== 'Organization') {
        return {
          state: 'invalid',
          reason: 'owner_not_organization',
          actualOwner: cut(owner?.login ?? null, 100),
          manageUrl: null,
        };
      }
      if (owner.login !== this.organization) {
        return {
          state: 'invalid',
          reason: 'owner_mismatch',
          actualOwner: cut(owner.login, 100),
          manageUrl: null,
        };
      }
      // The installation on the owner itself; one on any other account is ignored.
      const installation = (await this.#api.installations()).find(
        (candidate) => candidate.account?.id === owner.id,
      );
      if (!installation) {
        // The install link is built here, from a slug of the expected shape, or not at all.
        return SLUG_PATTERN.test(app.slug)
          ? {
              state: 'not_installed',
              installUrl: `https://github.com/apps/${app.slug}/installations/new`,
            }
          : { state: 'unavailable', reason: 'github_down' };
      }
      const manageUrl = githubLink(installation.htmlUrl);
      const invalid = (reason: GithubInvalidReason): Discovery => ({
        state: 'invalid',
        reason,
        actualOwner: null,
        manageUrl,
      });
      if (installation.targetType !== 'Organization') {
        return invalid('owner_not_organization');
      }
      if (installation.suspendedAt !== null) {
        return invalid('suspended');
      }
      const held = Object.entries(installation.permissions);
      if (held.some(([, level]) => level !== 'read')) {
        return invalid('write_permission');
      }
      if (held.some(([name]) => !(READ_PERMISSIONS as readonly string[]).includes(name))) {
        return invalid('other_permission');
      }
      return {
        state: 'installed',
        installation: {
          installationId: installation.id,
          accountId: owner.id,
          organization: owner.login,
          appId: app.id,
          permissions: READ_PERMISSIONS.filter((name) => name in installation.permissions),
          repositorySelection: installation.repositorySelection,
          manageUrl,
        },
      };
    } catch (error) {
      const { reason } = this.#failed(error);
      // With the app's own signature there is no installation that could be gone.
      return {
        state: 'unavailable',
        reason: reason === 'installation_gone' ? 'github_down' : reason,
      };
    }
  }

  /**
   * Every repository the installation reaches that belongs to the organisation, by name. Read
   * live and kept five minutes in memory. `refresh` reads it again now, at most once in ten
   * seconds.
   */
  async repositories(
    connection: GithubConnectionRef,
    options: { refresh?: boolean } = {},
  ): Promise<RepositoryList> {
    const held = this.#heldRepositories(connection);
    const now = this.#now();
    if (held) {
      const fresh = now - held.readAtMs < REPOSITORY_LIST_CACHE_MS;
      const justRead = now - this.#repositoriesReadAtMs < REPOSITORY_LIST_REFRESH_STOP_MS;
      if (fresh && (!options.refresh || justRead)) {
        return this.#listOf(held);
      }
      if (fresh && this.#blocked()) {
        return this.#listOf(held);
      }
    }
    if (this.#blocked()) {
      return { state: 'unavailable', reason: 'rate_limited', retryAtMs: this.#blockedUntilMs };
    }
    const reading = this.#readingRepositories;
    if (reading?.installationId === connection.installationId) {
      return reading.promise;
    }
    const promise = within(
      this.#readRepositories(connection),
      REPOSITORY_LIST_DEADLINE_MS,
      (): RepositoryList => ({ state: 'unavailable', reason: 'github_down', retryAtMs: null }),
    ).finally(() => {
      if (this.#readingRepositories?.promise === promise) {
        this.#readingRepositories = null;
      }
    });
    this.#readingRepositories = { installationId: connection.installationId, promise };
    return promise;
  }

  /** Is the repository one the installation reaches now; read again once when it is not held. */
  async findRepository(
    connection: GithubConnectionRef,
    repositoryId: number,
  ): Promise<RepositoryLookup> {
    for (const refresh of [false, true]) {
      const list = await this.repositories(connection, { refresh });
      if (list.state !== 'ok') {
        return list;
      }
      const repository = this.#heldRepositories(connection)?.byId.get(repositoryId);
      if (repository) {
        return { state: 'found', repository };
      }
    }
    return { state: 'missing' };
  }

  /**
   * The last commits, the open pull requests and the open issues of a repository of the
   * company's installation. Fresh for a minute; one reading at a time per repository however
   * many people ask; read one call after the other. Nothing is given once access was taken away.
   */
  async view(connection: GithubConnectionRef, repositoryId: number): Promise<RepositoryView> {
    this.#sweep();
    const key = `${String(connection.installationId)}:${String(repositoryId)}`;
    if (this.#blocked()) {
      return this.#unavailable(key, 'rate_limited');
    }
    const lookup = await this.findRepository(connection, repositoryId);
    if (lookup.state === 'missing') {
      // Taken out of the installation, deleted or moved: its lists go at once.
      this.#lists.delete(key);
      return {
        state: 'unavailable',
        repository: null,
        reason: 'repository_gone',
        retryAtMs: null,
        last: null,
      };
    }
    if (lookup.state === 'unavailable') {
      return lookup.reason === 'rate_limited' || lookup.reason === 'github_down'
        ? this.#unavailable(key, lookup.reason)
        : // The installation gives no access (everything held was dropped already).
          {
            state: 'unavailable',
            repository: null,
            reason: 'installation_gone',
            retryAtMs: null,
            last: null,
          };
    }
    const held = this.#lists.get(key);
    if (held && this.#now() - held.triedAtMs < LISTS_CACHE_MS) {
      const lists = this.#last(key);
      return !held.failed && held.read && lists
        ? { state: 'ok', repository: linked(lookup.repository), lists }
        : this.#unavailable(key, 'github_down');
    }
    let reading = this.#readingLists.get(key);
    if (!reading) {
      reading = this.#readLists(key, connection, lookup.repository).finally(() => {
        this.#readingLists.delete(key);
      });
      this.#readingLists.set(key, reading);
    }
    return reading;
  }

  /**
   * The connection was switched off: the token, the repository list and every tab list of this
   * company go, and so does the result of the checks. Calls nothing at GitHub.
   */
  forget(installationId: number | null): void {
    this.#generation += 1;
    this.#discovery = null;
    this.#repositories = null;
    this.#readingRepositories = null;
    this.#lists.clear();
    this.#readingLists.clear();
    if (installationId !== null) {
      this.#api.forget(installationId);
    }
  }

  async #readRepositories(connection: GithubConnectionRef): Promise<RepositoryList> {
    const generation = this.#generation;
    try {
      const { repositories, truncated } = await this.#api.repositories(connection.installationId);
      // Only what belongs to the organisation itself.
      const kept = repositories
        .filter((repository) => repository.owner.id === connection.accountId)
        .sort((a, b) => {
          const left = a.fullName.toLowerCase();
          const right = b.fullName.toLowerCase();
          return left < right ? -1 : left > right ? 1 : a.id - b.id;
        });
      const held: HeldRepositories = {
        installationId: connection.installationId,
        accountId: connection.accountId,
        readAtMs: this.#now(),
        repositories: kept,
        byId: new Map(kept.map((repository) => [repository.id, repository])),
        truncated,
      };
      if (generation === this.#generation) {
        this.#repositories = held;
        this.#repositoriesReadAtMs = held.readAtMs;
      }
      return this.#listOf(held);
    } catch (error) {
      const failure = this.#failed(error);
      if (failure.reason === 'installation_gone' || failure.reason === 'key_refused') {
        this.#dropAll(connection.installationId);
      }
      return { state: 'unavailable', ...failure };
    }
  }

  async #readLists(
    key: string,
    connection: GithubConnectionRef,
    repository: GithubRepository,
  ): Promise<RepositoryView> {
    const generation = this.#generation;
    const before = this.#lists.get(key)?.read ?? null;
    const tags =
      before && this.#now() - before.atMs <= LISTS_KEEP_MS
        ? before
        : { commits: null, pullRequests: null, issues: null };
    const id = connection.installationId;
    // Whole failures end the reading; a single list that cannot be read is null.
    let serverErrors = 0;
    let notFound = 0;
    const one = async <Raw, Row>(
      held: HeldList<Row> | null,
      call: (etag: string | null) => Promise<Conditional<Raw>>,
      rows: (items: Raw[], more: boolean) => { items: Row[]; more: boolean },
    ): Promise<HeldList<Row> | null> => {
      try {
        const answer = await call(held?.etag ?? null);
        if (!answer.changed) {
          return held;
        }
        return { ...rows(answer.items, answer.more), etag: answer.etag };
      } catch (error) {
        if (!(error instanceof GithubError)) {
          throw error;
        }
        const whole =
          error.kind === 'installation_gone' ||
          error.kind === 'unauthorized' ||
          error.kind === 'rate_limited' ||
          (error.kind === 'unavailable' && error.status === null);
        if (whole) {
          throw error;
        }
        if (error.status !== null && error.status >= 500) {
          serverErrors += 1;
        }
        if (error.kind === 'not_found') {
          notFound += 1;
        }
        return null;
      }
    };
    try {
      // One call after the other, as GitHub asks.
      const commits = await one(
        tags.commits,
        (etag) => this.#api.commits(id, repository, etag),
        (items, more) => ({
          items: items.slice(0, GITHUB_LIST_LIMIT).map((row) => ({
            sha: row.sha,
            title: firstLine(row.message).slice(0, 200),
            author: cut(row.authorLogin, 100),
            date: row.date,
            url: githubLink(row.htmlUrl),
          })),
          more: more || items.length > GITHUB_LIST_LIMIT,
        }),
      );
      const pullRequests = await one(
        tags.pullRequests,
        (etag) => this.#api.pullRequests(id, repository, etag),
        (items, more) => ({
          items: items.slice(0, GITHUB_LIST_LIMIT).map((row) => ({
            number: row.number,
            title: firstLine(row.title).slice(0, 300),
            author: cut(row.authorLogin, 100),
            createdAt: row.createdAt,
            draft: row.draft,
            url: githubLink(row.htmlUrl),
          })),
          more: more || items.length > GITHUB_LIST_LIMIT,
        }),
      );
      const issues = await one(
        tags.issues,
        (etag) => this.#api.issues(id, repository, etag),
        (items, more) => {
          // GitHub counts every pull request as an issue; they have their own list.
          const own = items.filter((row) => !row.isPullRequest);
          return {
            items: own.slice(0, GITHUB_LIST_LIMIT).map((row) => ({
              number: row.number,
              title: firstLine(row.title).slice(0, 300),
              author: cut(row.authorLogin, 100),
              createdAt: row.createdAt,
              url: githubLink(row.htmlUrl),
            })),
            more: more || own.length > GITHUB_LIST_LIMIT,
          };
        },
      );
      const now = this.#now();
      if (generation !== this.#generation) {
        // What was held was dropped while this reading ran (the connection was switched off, or
        // access was taken away): its result is not kept and not shown.
        return {
          state: 'unavailable',
          repository: null,
          reason: 'installation_gone',
          retryAtMs: null,
          last: null,
        };
      }
      if (notFound === 3) {
        // GitHub knows none of the three: the repository may have left the installation since
        // the list of repositories was read. Asked again (at most once in ten seconds).
        const list = await this.repositories(connection, { refresh: true });
        if (
          generation === this.#generation &&
          list.state === 'ok' &&
          !this.#heldRepositories(connection)?.byId.has(repository.id)
        ) {
          this.#lists.delete(key);
          return {
            state: 'unavailable',
            repository: null,
            reason: 'repository_gone',
            retryAtMs: null,
            last: null,
          };
        }
      }
      if (serverErrors === 3) {
        // GitHub answered none of the three: it is down, not one list that cannot be read.
        this.#lists.set(key, { triedAtMs: now, failed: true, read: before });
        return this.#unavailable(key, 'github_down');
      }
      this.#lists.set(key, {
        triedAtMs: now,
        failed: false,
        read: {
          atMs: now,
          repository: linked(repository),
          defaultBranch: cut(repository.defaultBranch, 255),
          private: repository.private,
          archived: repository.archived,
          commits,
          pullRequests,
          issues,
        },
      });
      const lists = this.#last(key);
      return lists
        ? { state: 'ok', repository: linked(repository), lists }
        : this.#unavailable(key, 'github_down');
    } catch (error) {
      const failure = this.#failed(error);
      if (failure.reason === 'installation_gone' || failure.reason === 'key_refused') {
        this.#dropAll(connection.installationId);
        return {
          state: 'unavailable',
          repository: null,
          reason: 'installation_gone',
          retryAtMs: null,
          last: null,
        };
      }
      if (failure.reason === 'github_down' && generation === this.#generation) {
        this.#lists.set(key, { triedAtMs: this.#now(), failed: true, read: before });
      }
      return this.#unavailable(key, failure.reason);
    }
  }

  // GitHub itself cannot be asked: the last lists the client still holds go with the answer.
  #unavailable(key: string, reason: 'rate_limited' | 'github_down'): RepositoryView {
    const last = this.#last(key);
    return {
      state: 'unavailable',
      repository: this.#lists.get(key)?.read?.repository ?? null,
      reason,
      retryAtMs: reason === 'rate_limited' ? this.#blockedUntilMs : null,
      last,
    };
  }

  /** The lists held for the repository, unless they were read more than ten minutes ago. */
  #last(key: string): GithubLists | null {
    const read = this.#lists.get(key)?.read;
    if (!read) {
      return null;
    }
    if (this.#now() - read.atMs > LISTS_KEEP_MS) {
      this.#lists.delete(key);
      return null;
    }
    return {
      fetchedAt: new Date(read.atMs).toISOString(),
      defaultBranch: read.defaultBranch,
      private: read.private,
      archived: read.archived,
      commits: shown(read.commits),
      pullRequests: shown(read.pullRequests),
      issues: shown(read.issues),
    };
  }

  #sweep(): void {
    const now = this.#now();
    for (const [key, held] of this.#lists) {
      const age = now - (held.read?.atMs ?? held.triedAtMs);
      if (age > LISTS_KEEP_MS) {
        this.#lists.delete(key);
      }
    }
  }

  #heldRepositories(connection: GithubConnectionRef): HeldRepositories | null {
    const held = this.#repositories;
    return held?.installationId === connection.installationId &&
      held.accountId === connection.accountId
      ? held
      : null;
  }

  #listOf(held: HeldRepositories): RepositoryList {
    return {
      state: 'ok',
      repositories: held.repositories,
      truncated: held.truncated,
      fetchedAtMs: held.readAtMs,
    };
  }

  #blocked(): boolean {
    return this.#now() < this.#blockedUntilMs;
  }

  // Access was taken away: nothing that was read through the installation is kept.
  #dropAll(installationId: number): void {
    this.#generation += 1;
    this.#repositories = null;
    this.#lists.clear();
    this.#api.forget(installationId);
  }

  /** What a failed call means for the whole company; a rate limit stops every call until its end. */
  #failed(error: unknown): { reason: GithubUnreachable; retryAtMs: number | null } {
    if (!(error instanceof GithubError)) {
      throw error;
    }
    if (error.kind === 'rate_limited') {
      this.#blockedUntilMs = Math.max(
        this.#blockedUntilMs,
        error.retryAtMs ?? this.#now() + LISTS_CACHE_MS,
      );
      return { reason: 'rate_limited', retryAtMs: this.#blockedUntilMs };
    }
    if (error.kind === 'unauthorized') {
      const now = this.#now();
      if (now - this.#keyRefusedLoggedAtMs >= KEY_REFUSED_LOG_EVERY_MS) {
        this.#keyRefusedLoggedAtMs = now;
        this.#log.error(
          { company: this.companyCode, status: error.status, requestId: error.requestId },
          'GitHub refused the key of the app',
        );
      }
      return { reason: 'key_refused', retryAtMs: null };
    }
    return {
      reason: error.kind === 'installation_gone' ? 'installation_gone' : 'github_down',
      retryAtMs: null,
    };
  }
}
