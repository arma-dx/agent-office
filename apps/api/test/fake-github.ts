import {
  GithubError,
  type Conditional,
  type GithubAccount,
  type GithubApi,
  type GithubApp,
  type GithubCommit,
  type GithubErrorKind,
  type GithubInstallation,
  type GithubIssue,
  type GithubPullRequest,
  type GithubRepository,
} from '../src/github/api.ts';

/**
 * GitHub for the tests: stands for ONE GitHub App, as the real client does (one fake per
 * company). Set up per test, with switches for what an owner of the organisation can do on GitHub
 * (remove or suspend the app, narrow the installation, add and remove repositories) and for what
 * GitHub itself can do (fail, limit). It records every call, so a test can assert that a fake
 * stayed silent. The tests never call the real GitHub.
 */

export type FakeList = 'commits' | 'pullRequests' | 'issues';

export interface FakeCall {
  method: 'app' | 'installations' | 'repositories' | FakeList;
  installationId?: number;
  repositoryId?: number;
  // The call carried the tag of the last answer and GitHub said "not changed".
  notModified?: boolean;
}

export interface FakeRepositoryLists {
  commits: GithubCommit[];
  pullRequests: GithubPullRequest[];
  issues: GithubIssue[];
}

export interface FakeSetup {
  app: { id: number; slug: string; owner: GithubAccount | null };
  // null: the app is not installed.
  installation: GithubInstallation | null;
  repositories: GithubRepository[];
  lists?: Record<number, Partial<FakeRepositoryLists>>;
}

const sha = (n: number): string => n.toString(16).padStart(40, '0');
const at = (minute: number): string => `2026-10-12T09:${String(minute % 60).padStart(2, '0')}:00Z`;

/** A commit of a person with a GitHub account. */
export function fakeCommit(
  repository: GithubRepository,
  n: number,
  login = 'ayse-k',
): GithubCommit {
  return {
    sha: sha(n),
    message: `Change ${String(n)} of ${repository.name}\n\nA longer text below the first line.`,
    authorLogin: login,
    date: at(n),
    htmlUrl: `https://github.com/${repository.fullName}/commit/${sha(n)}`,
  };
}

export function fakePullRequest(
  repository: GithubRepository,
  n: number,
  login = 'mehmet',
): GithubPullRequest {
  return {
    number: n,
    title: `Pull request ${String(n)} of ${repository.name}`,
    authorLogin: login,
    createdAt: at(n),
    draft: n % 2 === 0,
    htmlUrl: `https://github.com/${repository.fullName}/pull/${String(n)}`,
  };
}

export function fakeIssue(repository: GithubRepository, n: number, login = 'zeynep'): GithubIssue {
  return {
    number: n,
    title: `Issue ${String(n)} of ${repository.name}`,
    authorLogin: login,
    createdAt: at(n),
    htmlUrl: `https://github.com/${repository.fullName}/issues/${String(n)}`,
    isPullRequest: false,
  };
}

export function fakeRepository(
  owner: { id: number; login: string },
  id: number,
  name: string,
  overrides: Partial<GithubRepository> = {},
): GithubRepository {
  return {
    id,
    name,
    fullName: `${owner.login}/${name}`,
    private: true,
    archived: false,
    defaultBranch: 'main',
    htmlUrl: `https://github.com/${owner.login}/${name}`,
    owner,
    ...overrides,
  };
}

export function fakeInstallation(
  appId: number,
  account: GithubAccount,
  id: number,
  overrides: Partial<GithubInstallation> = {},
): GithubInstallation {
  return {
    id,
    appId,
    account,
    targetType: 'Organization',
    suspendedAt: null,
    permissions: { metadata: 'read', contents: 'read', pull_requests: 'read', issues: 'read' },
    repositorySelection: 'all',
    htmlUrl: `https://github.com/organizations/${account.login ?? 'x'}/settings/installations/${String(id)}`,
    ...overrides,
  };
}

export class FakeGithubApi implements GithubApi {
  readonly calls: FakeCall[] = [];
  // The installations whose token the client was told to drop.
  readonly forgotten: number[] = [];
  appInfo: FakeSetup['app'];
  installation: GithubInstallation | null;
  // Installations on other accounts (a public app that strangers installed).
  otherInstallations: GithubInstallation[] = [];
  truncated = false;
  // Awaited at the start of every call, before GitHub "answers": what a test looks at while
  // GitHub is being asked (for example what the database sessions of the API are doing).
  onCall: ((call: FakeCall) => Promise<void>) | null = null;
  #repositories: GithubRepository[];
  #selected: Set<number> | null = null;
  readonly #lists = new Map<number, FakeRepositoryLists>();
  readonly #versions = new Map<string, number>();
  #failure: { kind: GithubErrorKind; retryAtMs: number | null; status: number | null } | null =
    null;
  readonly #failingLists = new Map<FakeList, { kind: GithubErrorKind; status: number | null }>();
  #gate: Promise<void> | null = null;

  constructor(setup: FakeSetup) {
    this.appInfo = setup.app;
    this.installation = setup.installation;
    this.#repositories = [...setup.repositories];
    for (const repository of setup.repositories) {
      this.setLists(repository.id, setup.lists?.[repository.id] ?? {});
    }
  }

  // Switches ----------------------------------------------------------------------------------------

  /** The app is removed from the organisation on GitHub. */
  uninstall(): void {
    this.installation = null;
  }

  /** An owner of the organisation suspends the installation. */
  suspend(): void {
    if (this.installation) {
      this.installation = { ...this.installation, suspendedAt: '2026-10-12T10:00:00Z' };
    }
  }

  /** The app is installed (again): a new installation with a new number. */
  install(installation: GithubInstallation): void {
    this.installation = installation;
  }

  addRepository(repository: GithubRepository, lists: Partial<FakeRepositoryLists> = {}): void {
    this.#repositories.push(repository);
    this.setLists(repository.id, lists);
  }

  /** Deleted, or moved to another owner. */
  removeRepository(id: number): void {
    this.#repositories = this.#repositories.filter((repository) => repository.id !== id);
  }

  /** An owner narrows the installation to "Only select repositories". */
  selectRepositories(ids: number[]): void {
    this.#selected = new Set(ids);
    if (this.installation) {
      this.installation = { ...this.installation, repositorySelection: 'selected' };
    }
  }

  renameRepository(id: number, name: string): void {
    this.#repositories = this.#repositories.map((repository) =>
      repository.id === id
        ? {
            ...repository,
            name,
            fullName: `${repository.owner.login}/${name}`,
            htmlUrl: `https://github.com/${repository.owner.login}/${name}`,
          }
        : repository,
    );
  }

  /** What the three lists of a repository hold from now on (each a new version). */
  setLists(repositoryId: number, lists: Partial<FakeRepositoryLists>): void {
    const before = this.#lists.get(repositoryId) ?? { commits: [], pullRequests: [], issues: [] };
    this.#lists.set(repositoryId, { ...before, ...lists });
    for (const list of Object.keys(lists) as FakeList[]) {
      const key = `${String(repositoryId)}:${list}`;
      this.#versions.set(key, (this.#versions.get(key) ?? 0) + 1);
    }
  }

  /** Every call fails this way from now on; null: GitHub answers again. */
  failWith(
    kind: GithubErrorKind | null,
    retryAtMs: number | null = null,
    status: number | null = null,
  ): void {
    this.#failure = kind === null ? null : { kind, retryAtMs, status };
  }

  /** One of the three lists fails for every repository; null: it answers again. */
  failList(
    list: FakeList,
    kind: GithubErrorKind | null = 'forbidden',
    status: number | null = 403,
  ): void {
    if (kind === null) {
      this.#failingLists.delete(list);
    } else {
      this.#failingLists.set(list, { kind, status });
    }
  }

  /** Holds every call until the returned function is called (for readings that overlap). */
  hold(): () => void {
    let release: () => void = () => undefined;
    this.#gate = new Promise<void>((resolve) => {
      release = () => {
        this.#gate = null;
        resolve();
      };
    });
    return release;
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  countOf(method: FakeCall['method']): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  // GithubApi ---------------------------------------------------------------------------------------

  async app(): Promise<GithubApp> {
    await this.#begin({ method: 'app' });
    return { ...this.appInfo };
  }

  async installations(): Promise<GithubInstallation[]> {
    await this.#begin({ method: 'installations' });
    return [...this.otherInstallations, ...(this.installation ? [this.installation] : [])];
  }

  async repositories(
    installationId: number,
  ): Promise<{ repositories: GithubRepository[]; truncated: boolean }> {
    await this.#begin({ method: 'repositories', installationId });
    this.#reach(installationId);
    return { repositories: this.#visible(), truncated: this.truncated };
  }

  commits(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubCommit>> {
    return this.#list('commits', installationId, repository, etag);
  }

  pullRequests(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubPullRequest>> {
    return this.#list('pullRequests', installationId, repository, etag);
  }

  issues(
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<GithubIssue>> {
    return this.#list('issues', installationId, repository, etag);
  }

  forget(installationId: number): void {
    this.forgotten.push(installationId);
  }

  // -------------------------------------------------------------------------------------------------

  #visible(): GithubRepository[] {
    const selected = this.#selected;
    return this.#repositories.filter((repository) => selected?.has(repository.id) ?? true);
  }

  // A token is given only for this app's own installation, while it is there and not suspended.
  #reach(installationId: number): void {
    const installation = this.installation;
    if (installation?.id !== installationId || installation.suspendedAt !== null) {
      throw new GithubError('installation_gone', { status: 404 });
    }
  }

  async #begin(call: FakeCall): Promise<void> {
    this.calls.push(call);
    if (this.onCall) {
      await this.onCall(call);
    }
    if (this.#gate) {
      await this.#gate;
    }
    const failure = this.#failure;
    if (failure) {
      throw new GithubError(failure.kind, {
        status: failure.status,
        retryAtMs: failure.retryAtMs,
      });
    }
  }

  async #list<K extends FakeList>(
    list: K,
    installationId: number,
    repository: GithubRepository,
    etag: string | null,
  ): Promise<Conditional<FakeRepositoryLists[K][number]>> {
    const call: FakeCall = { method: list, installationId, repositoryId: repository.id };
    await this.#begin(call);
    this.#reach(installationId);
    const failing = this.#failingLists.get(list);
    if (failing) {
      throw new GithubError(failing.kind, { status: failing.status });
    }
    const held = this.#visible().some((visible) => visible.id === repository.id)
      ? this.#lists.get(repository.id)
      : undefined;
    if (!held) {
      throw new GithubError('not_found', { status: 404 });
    }
    const tag = `"${list}-${String(this.#versions.get(`${String(repository.id)}:${list}`) ?? 0)}"`;
    if (etag === tag) {
      call.notModified = true;
      return { changed: false };
    }
    const items: FakeRepositoryLists[K] = held[list];
    return { changed: true, items: [...items], more: false, etag: tag };
  }
}

/** The clock of a test: the company clients read the time from it. */
export class TestClock {
  ms: number;

  constructor(start = Date.parse('2026-10-12T09:00:00Z')) {
    this.ms = start;
  }

  readonly now = (): number => this.ms;

  advance(ms: number): void {
    this.ms += ms;
  }
}

/** The organisation, the app and the installation of one company, as the standard set-up has it. */
export interface FakeCompany {
  code: string;
  organization: string;
  owner: { id: number; login: string };
  api: FakeGithubApi;
  installation: GithubInstallation;
  repositories: GithubRepository[];
}

function fakeCompany(
  code: string,
  login: string,
  numbers: { owner: number; app: number; installation: number; repository: number },
  names: string[],
): FakeCompany {
  const owner = { id: numbers.owner, login };
  const account: GithubAccount = { ...owner, type: 'Organization' };
  const installation = fakeInstallation(numbers.app, account, numbers.installation);
  const repositories = names.map((name, index) =>
    fakeRepository(owner, numbers.repository + index, name, {
      private: index % 2 === 0,
      archived: index === names.length - 1,
    }),
  );
  const lists: Record<number, FakeRepositoryLists> = {};
  for (const repository of repositories) {
    lists[repository.id] = {
      commits: [1, 2, 3].map((n) => fakeCommit(repository, n)),
      pullRequests: [11, 12].map((n) => fakePullRequest(repository, n)),
      issues: [21, 22].map((n) => fakeIssue(repository, n)),
    };
  }
  return {
    code,
    organization: login,
    owner,
    installation,
    repositories,
    api: new FakeGithubApi({
      app: { id: numbers.app, slug: `${code}-office`, owner: account },
      installation,
      repositories,
      lists,
    }),
  };
}

/**
 * The standard set-up of the GitHub tests: two fakes, for two companies that are two GitHub
 * organisations (12 October decision 12), with different apps, installations and repositories.
 */
export function standardGithub(): { armadx: FakeCompany; pillika: FakeCompany } {
  return {
    armadx: fakeCompany(
      'armadx',
      'arma-org',
      { owner: 1001, app: 9001, installation: 5001, repository: 700 },
      ['panel', 'api', 'archive'],
    ),
    pillika: fakeCompany(
      'pillika',
      'pillika-org',
      { owner: 2001, app: 9101, installation: 6001, repository: 900 },
      ['shop', 'stations'],
    ),
  };
}
