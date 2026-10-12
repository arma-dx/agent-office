import {
  githubConnectionSchema,
  githubListsSchema,
  githubRepositoriesSchema,
  projectGithubSchema,
  type GithubCommit,
  type GithubConnection,
  type GithubIssue,
  type GithubLists,
  type GithubPullRequest,
  type GithubRepositories,
  type GithubRepositoryOption,
  type LinkedRepository,
  type ProjectGithub,
} from '@agent-office/shared';
import { PROJECT_ID } from './project-fixtures.ts';
import { USER_ID } from './mock-api.ts';

/**
 * Fixtures of the GitHub connection, checked against the shared contract so they cannot drift.
 * Arma DX is connected to `arma-org` and Pillika to `pillika-org`: two organisations, two
 * installations, different repositories, so a test can tell what belongs to which company.
 */

export const ARMA_ORG = 'arma-org';
export const PILLIKA_ORG = 'pillika-org';
export const ARMA_INSTALLATION = 5001;
export const PILLIKA_INSTALLATION = 6001;
const AT = '2026-10-12T09:00:00.000Z';

/** The keys of the routes, as the fake API of the tests takes them. */
export const CONNECTION = 'GET /github/connection';
export const CONNECT = 'POST /github/connection';
export const DISCONNECT = 'DELETE /github/connection';
export const REPOSITORIES = 'GET /github/repositories';
export const REFRESH_REPOSITORIES = 'GET /github/repositories?refresh=1';
export function projectGithubRoute(projectId: string = PROJECT_ID): string {
  return `GET /projects/${projectId}/github`;
}
export function setRepositoryRoute(projectId: string = PROJECT_ID): string {
  return `PUT /projects/${projectId}/repository`;
}
export function removeRepositoryRoute(projectId: string = PROJECT_ID): string {
  return `DELETE /projects/${projectId}/repository`;
}

export const INSTALL_URL = 'https://github.com/apps/arma-dx-agent-office-yerel/installations/new';
export const MANAGE_URL = `https://github.com/organizations/${ARMA_ORG}/settings/installations/${String(ARMA_INSTALLATION)}`;

type ConnectionIn<S extends GithubConnection['state']> = Extract<GithubConnection, { state: S }>;

/** The states of GET /github/connection for Arma DX; a test changes what it is about. */
export const connection = {
  notConfigured: (): GithubConnection => githubConnectionSchema.parse({ state: 'not_configured' }),
  unavailable: (reason: ConnectionIn<'unavailable'>['reason'] = 'github_down'): GithubConnection =>
    githubConnectionSchema.parse({ state: 'unavailable', reason }),
  notInstalled: (overrides: Partial<ConnectionIn<'not_installed'>> = {}): GithubConnection =>
    githubConnectionSchema.parse({
      state: 'not_installed',
      organization: ARMA_ORG,
      installUrl: INSTALL_URL,
      ...overrides,
    }),
  invalid: (overrides: Partial<ConnectionIn<'invalid'>> = {}): GithubConnection =>
    githubConnectionSchema.parse({
      state: 'invalid',
      organization: ARMA_ORG,
      reason: 'write_permission',
      actualOwner: null,
      manageUrl: MANAGE_URL,
      ...overrides,
    }),
  installed: (overrides: Partial<ConnectionIn<'installed'>> = {}): GithubConnection =>
    githubConnectionSchema.parse({
      state: 'installed',
      organization: ARMA_ORG,
      installationId: ARMA_INSTALLATION,
      permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
      repositorySelection: 'all',
      wasConnected: false,
      ...overrides,
    }),
  connected: (overrides: Partial<ConnectionIn<'connected'>> = {}): GithubConnection =>
    githubConnectionSchema.parse({
      state: 'connected',
      organization: ARMA_ORG,
      connectedAt: AT,
      connectedBy: { userId: USER_ID, name: 'Ömer Kadıoğlu' },
      permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
      repositorySelection: 'all',
      repositoryCount: 3,
      linkedProjectCount: 1,
      problem: null,
      manageUrl: MANAGE_URL,
      ...overrides,
    }),
};

/** The same states as Pillika's page reads them: another organisation, another installation. */
export const pillikaConnection = {
  installed: (): GithubConnection =>
    connection.installed({ organization: PILLIKA_ORG, installationId: PILLIKA_INSTALLATION }),
  connected: (): GithubConnection =>
    connection.connected({
      organization: PILLIKA_ORG,
      repositoryCount: 2,
      linkedProjectCount: 0,
      manageUrl: `https://github.com/organizations/${PILLIKA_ORG}/settings/installations/${String(PILLIKA_INSTALLATION)}`,
    }),
};

/** The repositories of Arma DX's organisation, by name: the number and the name, nothing else. */
export const ARMA_REPOSITORIES: GithubRepositoryOption[] = [
  { id: 101, fullName: `${ARMA_ORG}/depo-otomasyonu` },
  { id: 102, fullName: `${ARMA_ORG}/panel` },
  { id: 103, fullName: `${ARMA_ORG}/web-sitesi` },
];
export const PILLIKA_REPOSITORIES: GithubRepositoryOption[] = [
  { id: 201, fullName: `${PILLIKA_ORG}/istasyon` },
  { id: 202, fullName: `${PILLIKA_ORG}/mobil` },
];

/** GET /github/repositories of a connected company. */
export function repositories(
  list: GithubRepositoryOption[] = ARMA_REPOSITORIES,
  overrides: Partial<Extract<GithubRepositories, { state: 'ok' }>> = {},
): GithubRepositories {
  return githubRepositoriesSchema.parse({
    state: 'ok',
    organization: list === PILLIKA_REPOSITORIES ? PILLIKA_ORG : ARMA_ORG,
    repositories: list,
    truncated: false,
    fetchedAt: AT,
    ...overrides,
  });
}
export const NO_REPOSITORIES: GithubRepositories = githubRepositoriesSchema.parse({
  state: 'not_connected',
});
export const REPOSITORIES_UNAVAILABLE: GithubRepositories = githubRepositoriesSchema.parse({
  state: 'unavailable',
});

/** The repository of the fixture's project, as GitHub names it now. */
export const LINKED: LinkedRepository = {
  id: 101,
  fullName: `${ARMA_ORG}/depo-otomasyonu`,
  url: `https://github.com/${ARMA_ORG}/depo-otomasyonu`,
};
/** ... and as the API knows it without asking GitHub: the name it had, and no address. */
export const STORED: LinkedRepository = { ...LINKED, url: null };

const sha = (letter: string) => letter.repeat(40);

export const COMMITS: GithubCommit[] = [
  {
    sha: sha('a'),
    title: 'Raf etiketlerinin okunmasını düzelt',
    author: 'ayse-k',
    date: '2026-10-11T14:30:00.000Z',
    url: `${LINKED.url ?? ''}/commit/${sha('a')}`,
  },
  // A commit that is tied to no GitHub account: nobody is named.
  {
    sha: sha('b'),
    title: 'İlk sürüm',
    author: null,
    date: '2026-10-09T08:00:00.000Z',
    url: null,
  },
];
export const PULL_REQUESTS: GithubPullRequest[] = [
  {
    number: 42,
    title: 'Sayım ekranı',
    author: 'mehmet',
    createdAt: '2026-10-09T10:00:00.000Z',
    draft: true,
    url: `${LINKED.url ?? ''}/pull/42`,
  },
  {
    number: 40,
    title: 'Depo listesinde sıralama',
    author: 'ayse-k',
    createdAt: '2026-10-07T10:00:00.000Z',
    draft: false,
    url: `${LINKED.url ?? ''}/pull/40`,
  },
];
export const ISSUES: GithubIssue[] = [
  {
    number: 17,
    title: 'Barkod okuyucu bağlantısı kopuyor',
    author: 'zeynep-d',
    createdAt: '2026-10-03T10:00:00.000Z',
    url: `${LINKED.url ?? ''}/issues/17`,
  },
];

/** What GitHub shows of the fixture's repository, read at the fixtures' time. */
export function lists(overrides: Partial<GithubLists> = {}): GithubLists {
  return githubListsSchema.parse({
    fetchedAt: AT,
    defaultBranch: 'main',
    private: true,
    archived: false,
    commits: { items: COMMITS, more: false },
    pullRequests: { items: PULL_REQUESTS, more: false },
    issues: { items: ISSUES, more: false },
    ...overrides,
  });
}

type TabIn<S extends ProjectGithub['state']> = Extract<ProjectGithub, { state: S }>;

/** The states of GET /projects/:id/github as a plain member reads them (canLink false). */
export const tab = {
  notConnected: (disconnected = false): ProjectGithub =>
    projectGithubSchema.parse({ state: 'not_connected', disconnected, canLink: false }),
  noRepository: (overrides: Partial<TabIn<'no_repository'>> = {}): ProjectGithub =>
    projectGithubSchema.parse({
      state: 'no_repository',
      canLink: false,
      allowed: true,
      ...overrides,
    }),
  notAllowed: (overrides: Partial<TabIn<'not_allowed'>> = {}): ProjectGithub =>
    projectGithubSchema.parse({
      state: 'not_allowed',
      repository: STORED,
      canLink: false,
      ...overrides,
    }),
  unavailable: (overrides: Partial<TabIn<'unavailable'>> = {}): ProjectGithub =>
    projectGithubSchema.parse({
      state: 'unavailable',
      repository: STORED,
      canLink: false,
      reason: 'github_down',
      retryAt: null,
      last: null,
      ...overrides,
    }),
  ok: (overrides: Partial<TabIn<'ok'>> = {}): ProjectGithub =>
    projectGithubSchema.parse({
      state: 'ok',
      repository: LINKED,
      canLink: false,
      lists: lists(),
      ...overrides,
    }),
};
