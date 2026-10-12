import { describe, expect, it } from 'vitest';
import {
  GITHUB_LIST_LIMIT,
  apiErrorCodeSchema,
  connectGithubSchema,
  githubCommitSchema,
  githubConnectionDetails,
  githubConnectionDetailsSchema,
  githubConnectionSchema,
  githubIdSchema,
  githubIssueSchema,
  githubListsSchema,
  githubPullRequestSchema,
  githubRepositoriesQuerySchema,
  githubRepositoriesSchema,
  githubRepositoryOptionSchema,
  projectGithubSchema,
  setProjectRepositorySchema,
  stepUpOptionsRequestSchema,
  stepUpPurposeSchema,
} from '../src/index.ts';

// The GitHub connection of a company and the GitHub tab of a project (8 October decisions 17, 19
// and 22; 12 October decisions 12 to 17). What the contract keeps out is the point: an address
// that is not on github.com, anything beside the name of a repository in the list, and the lists
// of a repository once access to it is gone.

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-12T09:00:00.000Z';

const COMMIT = {
  sha: 'a'.repeat(40),
  title: 'Fix the sign-in page',
  author: 'ayse-k',
  date: NOW,
  url: 'https://github.com/arma-org/panel/commit/' + 'a'.repeat(40),
};
const PULL_REQUEST = {
  number: 42,
  title: 'Add the report',
  author: 'mehmet',
  createdAt: NOW,
  draft: true,
  url: 'https://github.com/arma-org/panel/pull/42',
};
const ISSUE = {
  number: 7,
  title: 'The list is slow',
  author: null,
  createdAt: NOW,
  url: 'https://github.com/arma-org/panel/issues/7',
};
const LISTS = {
  fetchedAt: NOW,
  defaultBranch: 'main',
  private: true,
  archived: false,
  commits: { items: [COMMIT], more: false },
  pullRequests: { items: [PULL_REQUEST], more: true },
  issues: null,
};
const REPOSITORY = {
  id: 777,
  fullName: 'arma-org/panel',
  url: 'https://github.com/arma-org/panel',
};

describe('the re-verification of a GitHub connection', () => {
  it('purpose: github_connection is a purpose of a company', () => {
    expect(stepUpPurposeSchema.safeParse('github_connection').success).toBe(true);
    const body = {
      purpose: 'github_connection',
      companyId: uuid(1),
      subjectId: uuid(1),
      details: githubConnectionDetails('arma-org', 5001),
    };
    expect(stepUpOptionsRequestSchema.safeParse(body).success).toBe(true);
    for (const missing of ['companyId', 'subjectId', 'details']) {
      const incomplete = Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== missing),
      );
      expect(stepUpOptionsRequestSchema.safeParse(incomplete).success, missing).toBe(false);
    }
    // The subject is the company itself, never another record.
    expect(stepUpOptionsRequestSchema.safeParse({ ...body, subjectId: uuid(2) }).success).toBe(
      false,
    );
    // The details of another purpose.
    expect(
      stepUpOptionsRequestSchema.safeParse({ ...body, details: { action: 'remove' } }).success,
    ).toBe(false);
    // The details of a connection do not open another purpose.
    expect(
      stepUpOptionsRequestSchema.safeParse({ ...body, purpose: 'project_ai_permission' }).success,
    ).toBe(false);
  });

  it('details: the organisation and the installation the page showed, and nothing else', () => {
    expect(githubConnectionDetails('arma-org', 5001)).toEqual({
      action: 'connect',
      organization: 'arma-org',
      installationId: 5001,
    });
    const details = githubConnectionDetails('arma-org', 5001);
    expect(githubConnectionDetailsSchema.safeParse(details).success).toBe(true);
    for (const wrong of [
      { ...details, action: 'disconnect' },
      { ...details, organization: '' },
      { ...details, organization: 'a'.repeat(40) },
      { ...details, installationId: 0 },
      { ...details, installationId: '5001' },
      { ...details, repositoryId: 1 },
      { action: 'connect', organization: 'arma-org' },
    ]) {
      expect(githubConnectionDetailsSchema.safeParse(wrong).success, JSON.stringify(wrong)).toBe(
        false,
      );
    }
  });

  it('a GitHub number is a positive whole number that a script can hold', () => {
    for (const good of [1, 5001, Number.MAX_SAFE_INTEGER]) {
      expect(githubIdSchema.safeParse(good).success, String(good)).toBe(true);
    }
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null, Number.NaN]) {
      expect(githubIdSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('the connect request carries the re-verification and nothing else', () => {
    expect(connectGithubSchema.safeParse({}).success).toBe(true);
    for (const extra of [{ installationId: 5001 }, { organization: 'arma-org' }, { state: 'x' }]) {
      expect(connectGithubSchema.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('every error code of the GitHub step is a code of the API', () => {
    for (const code of [
      'github_not_configured',
      'github_not_installed',
      'github_installation_invalid',
      'github_other_organization',
      'github_organization_taken',
      'github_connection_changed',
      'github_not_connected',
      'github_repository_not_available',
      'github_not_allowed',
      'project_repository_not_allowed',
      'github_unavailable',
    ]) {
      expect(apiErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });
});

describe('the connection of a company', () => {
  const installed = {
    state: 'installed',
    organization: 'arma-org',
    installationId: 5001,
    permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
    repositorySelection: 'all',
    wasConnected: false,
  };
  const connected = {
    state: 'connected',
    organization: 'arma-org',
    connectedAt: NOW,
    connectedBy: { userId: uuid(11), name: 'Kurucu' },
    permissions: ['metadata', 'contents'],
    repositorySelection: 'selected',
    repositoryCount: 3,
    linkedProjectCount: 1,
    problem: null,
    manageUrl: 'https://github.com/organizations/arma-org/settings/installations/5001',
  };

  it('every state of the page is an answer', () => {
    const answers = [
      { state: 'not_configured' },
      { state: 'unavailable', reason: 'key_refused' },
      {
        state: 'not_installed',
        organization: 'arma-org',
        installUrl: 'https://github.com/apps/arma-office/installations/new',
      },
      {
        state: 'invalid',
        organization: 'arma-org',
        reason: 'owner_mismatch',
        actualOwner: 'pillika-org',
        manageUrl: null,
      },
      installed,
      connected,
      // GitHub could not be asked just now.
      { ...connected, repositorySelection: null, repositoryCount: null, problem: 'github_down' },
      { ...connected, connectedBy: null },
    ];
    for (const answer of answers) {
      expect(githubConnectionSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(true);
    }
  });

  it('a link that is not on github.com is no answer', () => {
    for (const url of [
      'https://github.com.evil.test/apps/x/installations/new',
      'http://github.com/apps/x/installations/new',
      'https://api.github.com/app',
      'javascript:alert(1)',
      '/apps/x/installations/new',
      '',
    ]) {
      expect(
        githubConnectionSchema.safeParse({
          state: 'not_installed',
          organization: 'arma-org',
          installUrl: url,
        }).success,
        url,
      ).toBe(false);
      expect(githubConnectionSchema.safeParse({ ...connected, manageUrl: url }).success, url).toBe(
        false,
      );
    }
    // The install link is never left out: without one the answer is another state.
    expect(
      githubConnectionSchema.safeParse({
        state: 'not_installed',
        organization: 'arma-org',
        installUrl: null,
      }).success,
    ).toBe(false);
  });

  it('a permission outside the four and an unknown reason are no answer', () => {
    expect(
      githubConnectionSchema.safeParse({ ...installed, permissions: ['administration'] }).success,
    ).toBe(false);
    expect(
      githubConnectionSchema.safeParse({ ...installed, repositorySelection: 'none' }).success,
    ).toBe(false);
    expect(
      githubConnectionSchema.safeParse({
        state: 'invalid',
        organization: 'arma-org',
        reason: 'all_repositories',
        actualOwner: null,
        manageUrl: null,
      }).success,
    ).toBe(false);
    expect(githubConnectionSchema.safeParse({ state: 'anything' }).success).toBe(false);
  });
});

describe('the repositories of the connected organisation', () => {
  it('an entry is the number and the name, and nothing beside the name', () => {
    const parsed = githubRepositoryOptionSchema.parse({
      id: 777,
      fullName: 'arma-org/panel',
      private: true,
      archived: true,
      description: 'Something',
    });
    expect(parsed).toEqual({ id: 777, fullName: 'arma-org/panel' });
  });

  it('the three answers', () => {
    const ok = {
      state: 'ok',
      organization: 'arma-org',
      repositories: [{ id: 777, fullName: 'arma-org/panel' }],
      truncated: false,
      fetchedAt: NOW,
    };
    for (const answer of [{ state: 'not_connected' }, { state: 'unavailable' }, ok]) {
      expect(githubRepositoriesSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(true);
    }
    expect(githubRepositoriesSchema.safeParse({ ...ok, repositories: [{ id: 0 }] }).success).toBe(
      false,
    );
  });

  it('the query knows refresh and nothing else', () => {
    expect(githubRepositoriesQuerySchema.safeParse({}).success).toBe(true);
    expect(githubRepositoriesQuerySchema.safeParse({ refresh: '1' }).success).toBe(true);
    expect(githubRepositoriesQuerySchema.safeParse({ refresh: 'yes' }).success).toBe(false);
    expect(githubRepositoriesQuerySchema.safeParse({ installation: '5001' }).success).toBe(false);
  });

  it('a project is given a repository by its number only', () => {
    expect(setProjectRepositorySchema.safeParse({ repositoryId: 777 }).success).toBe(true);
    for (const body of [
      {},
      { repositoryId: '777' },
      { repositoryId: 0 },
      { repositoryId: 777, fullName: 'arma-org/panel' },
      { fullName: 'arma-org/panel' },
    ]) {
      expect(setProjectRepositorySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('the GitHub tab of a project', () => {
  it('a commit carries a user name and never the name or the address written inside it', () => {
    const parsed = githubCommitSchema.parse({
      ...COMMIT,
      authorName: 'Ayşe Kaya',
      email: 'ayse@example.test',
      commit: { author: { name: 'Ayşe Kaya', email: 'ayse@example.test' } },
    });
    expect(Object.keys(parsed).sort()).toEqual(['author', 'date', 'sha', 'title', 'url']);
    expect(JSON.stringify(parsed)).not.toContain('example.test');
    // A commit that is tied to no GitHub account names nobody.
    expect(githubCommitSchema.safeParse({ ...COMMIT, author: null, date: null }).success).toBe(
      true,
    );
    expect(githubCommitSchema.safeParse({ ...COMMIT, sha: 'abc' }).success).toBe(false);
    expect(githubCommitSchema.safeParse({ ...COMMIT, title: 'x'.repeat(201) }).success).toBe(false);
  });

  it('a row has a link on github.com or none', () => {
    for (const [schema, row] of [
      [githubCommitSchema, COMMIT],
      [githubPullRequestSchema, PULL_REQUEST],
      [githubIssueSchema, ISSUE],
    ] as const) {
      expect(schema.safeParse({ ...row, url: null }).success).toBe(true);
      expect(schema.safeParse({ ...row, url: 'https://evil.test/x' }).success).toBe(false);
      expect(schema.safeParse({ ...row, url: 'https://github.com.evil.test/x' }).success).toBe(
        false,
      );
    }
  });

  it('a list holds at most twenty rows, or says that it could not be read', () => {
    const many = Array.from({ length: GITHUB_LIST_LIMIT + 1 }, () => COMMIT);
    expect(githubListsSchema.safeParse(LISTS).success).toBe(true);
    expect(
      githubListsSchema.safeParse({ ...LISTS, commits: { items: many, more: true } }).success,
    ).toBe(false);
    expect(
      githubListsSchema.safeParse({ ...LISTS, commits: null, pullRequests: null, issues: null })
        .success,
    ).toBe(true);
    expect(
      githubListsSchema.safeParse({ ...LISTS, issues: { items: [ISSUE], more: false } }).success,
    ).toBe(true);
  });

  it('every state of the tab is an answer', () => {
    const answers = [
      { state: 'not_connected', disconnected: false, canLink: false },
      { state: 'not_connected', disconnected: true, canLink: false },
      { state: 'no_repository', canLink: true, allowed: true },
      { state: 'no_repository', canLink: false, allowed: false },
      { state: 'not_allowed', repository: REPOSITORY, canLink: true },
      { state: 'ok', repository: REPOSITORY, canLink: false, lists: LISTS },
      { state: 'ok', repository: { ...REPOSITORY, url: null }, canLink: false, lists: LISTS },
      {
        state: 'unavailable',
        repository: REPOSITORY,
        canLink: true,
        reason: 'rate_limited',
        retryAt: NOW,
        last: LISTS,
      },
      {
        state: 'unavailable',
        repository: REPOSITORY,
        canLink: true,
        reason: 'github_down',
        retryAt: null,
        last: null,
      },
    ];
    for (const answer of answers) {
      expect(projectGithubSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(true);
    }
    // Nobody links while the company is not connected.
    expect(
      projectGithubSchema.safeParse({ state: 'not_connected', disconnected: false, canLink: true })
        .success,
    ).toBe(false);
  });

  it('no list is served once access to the repository is gone', () => {
    const gone = {
      state: 'unavailable',
      repository: REPOSITORY,
      canLink: true,
      retryAt: null,
    };
    for (const reason of ['installation_gone', 'repository_gone', 'not_configured']) {
      expect(projectGithubSchema.safeParse({ ...gone, reason, last: null }).success, reason).toBe(
        true,
      );
      expect(projectGithubSchema.safeParse({ ...gone, reason, last: LISTS }).success, reason).toBe(
        false,
      );
    }
    for (const reason of ['rate_limited', 'github_down']) {
      expect(projectGithubSchema.safeParse({ ...gone, reason, last: LISTS }).success, reason).toBe(
        true,
      );
    }
  });
});
