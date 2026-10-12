import { projectGithubSchema } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import type { GithubLog } from '../src/github/api.ts';
import {
  CompanyGithub,
  DISCOVERY_CACHE_MS,
  LISTS_CACHE_MS,
  LISTS_KEEP_MS,
  REPOSITORY_LIST_CACHE_MS,
  REPOSITORY_LIST_REFRESH_STOP_MS,
  type GithubConnectionRef,
  type RepositoryView,
} from '../src/github/company.ts';
import { GithubService } from '../src/github/service.ts';
import {
  TestClock,
  fakeCommit,
  fakeInstallation,
  fakeIssue,
  fakePullRequest,
  fakeRepository,
  standardGithub,
  type FakeCompany,
} from './fake-github.ts';

// Everything GitHub of ONE company, over the fake that stands for that company's app: the checks
// before a connection, the list of repositories, the lists of the tab, their caches, and what
// goes the moment access is taken away. No database and no real GitHub.

interface Scene {
  company: FakeCompany;
  github: CompanyGithub;
  clock: TestClock;
  connection: GithubConnectionRef;
  errors: Record<string, unknown>[];
}

function scene(company: FakeCompany = standardGithub().armadx, clock = new TestClock()): Scene {
  const errors: Record<string, unknown>[] = [];
  const log: GithubLog = { warn: () => undefined, error: (details) => errors.push(details) };
  return {
    company,
    clock,
    errors,
    github: new CompanyGithub(
      { companyCode: company.code, organization: company.organization },
      company.api,
      clock.now,
      log,
    ),
    connection: { installationId: company.installation.id, accountId: company.owner.id },
  };
}

const PANEL = 700;

function lists(view: RepositoryView) {
  if (view.state !== 'ok') {
    throw new Error(`Expected the lists, got ${view.state}`);
  }
  return view.lists;
}

function unavailable(view: RepositoryView) {
  if (view.state !== 'unavailable') {
    throw new Error(`Expected "unavailable", got ${view.state}`);
  }
  return view;
}

describe('the checks before a connection', () => {
  it('an installation on the organisation the environment names is accepted', async () => {
    const { github, company } = scene();
    expect(await github.discover()).toEqual({
      state: 'installed',
      installation: {
        installationId: 5001,
        accountId: 1001,
        organization: 'arma-org',
        appId: 9001,
        permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
        repositorySelection: 'all',
        manageUrl: 'https://github.com/organizations/arma-org/settings/installations/5001',
      },
    });
    // Asked with the app's own signature only: nothing is read as the installation.
    expect(company.api.calls.map((call) => call.method)).toEqual(['app', 'installations']);
  });

  it('an installation on chosen repositories and one with fewer permissions are accepted too', async () => {
    const { github, company } = scene();
    company.api.selectRepositories([PANEL]);
    company.api.installation = {
      ...(company.api.installation ?? company.installation),
      permissions: { metadata: 'read', contents: 'read' },
    };
    expect(await github.discover()).toMatchObject({
      state: 'installed',
      installation: { repositorySelection: 'selected', permissions: ['metadata', 'contents'] },
    });
  });

  it('not installed: the install link is built from the slug GitHub gave', async () => {
    const { github, company } = scene();
    company.api.uninstall();
    expect(await github.discover()).toEqual({
      state: 'not_installed',
      installUrl: 'https://github.com/apps/armadx-office/installations/new',
    });
    // An installation on any other account is not the organisation's installation.
    company.api.otherInstallations = [
      fakeInstallation(9001, { id: 4242, login: 'stranger', type: 'Organization' }, 7777),
    ];
    expect(await github.discover({ fresh: true })).toMatchObject({ state: 'not_installed' });
  });

  it('a slug of another shape gives no link', async () => {
    for (const slug of ['Arma Office', '../../evil', 'x/installations/new?y=', '']) {
      const { github, company } = scene();
      company.api.uninstall();
      company.api.appInfo = { ...company.api.appInfo, slug };
      expect(await github.discover(), slug).toEqual({
        state: 'unavailable',
        reason: 'github_down',
      });
    }
  });

  it('an app owned by somebody else than the organisation of the slot is refused', async () => {
    // The credentials of the two companies were put the wrong way round: the client of Arma DX
    // holds the app of Pillika's organisation.
    const pillika = standardGithub().pillika;
    const github = new CompanyGithub(
      { companyCode: 'armadx', organization: 'arma-org' },
      pillika.api,
    );
    expect(await github.discover()).toEqual({
      state: 'invalid',
      reason: 'owner_mismatch',
      actualOwner: 'pillika-org',
      manageUrl: null,
    });
    // Nothing of the installation was even read.
    expect(pillika.api.calls.map((call) => call.method)).toEqual(['app']);

    // The name is compared exactly as written.
    const caseOnly = scene();
    caseOnly.company.api.appInfo = {
      ...caseOnly.company.api.appInfo,
      owner: { id: 1001, login: 'Arma-Org', type: 'Organization' },
    };
    expect(await caseOnly.github.discover()).toMatchObject({ reason: 'owner_mismatch' });
  });

  it('an app of a person, a suspended installation and wider permissions are refused', async () => {
    const person = scene();
    person.company.api.appInfo = {
      ...person.company.api.appInfo,
      owner: { id: 1001, login: 'arma-org', type: 'User' },
    };
    expect(await person.github.discover()).toMatchObject({
      state: 'invalid',
      reason: 'owner_not_organization',
      actualOwner: 'arma-org',
    });
    const nobody = scene();
    nobody.company.api.appInfo = { ...nobody.company.api.appInfo, owner: null };
    expect(await nobody.github.discover()).toMatchObject({ reason: 'owner_not_organization' });

    const suspended = scene();
    suspended.company.api.suspend();
    expect(await suspended.github.discover()).toEqual({
      state: 'invalid',
      reason: 'suspended',
      actualOwner: null,
      manageUrl: 'https://github.com/organizations/arma-org/settings/installations/5001',
    });

    const cases: [Record<string, string>, string][] = [
      [{ metadata: 'read', contents: 'write' }, 'write_permission'],
      [{ metadata: 'read', administration: 'write' }, 'write_permission'],
      [{ metadata: 'read', actions: 'read' }, 'other_permission'],
    ];
    for (const [permissions, reason] of cases) {
      const wide = scene();
      wide.company.api.installation = { ...wide.company.installation, permissions };
      expect(await wide.github.discover(), JSON.stringify(permissions)).toMatchObject({
        state: 'invalid',
        reason,
      });
    }
    // A manage link that is not on github.com is no link.
    const elsewhere = scene();
    elsewhere.company.api.installation = {
      ...elsewhere.company.installation,
      suspendedAt: '2026-10-12T08:00:00Z',
      htmlUrl: 'https://evil.example.test/settings',
    };
    expect(await elsewhere.github.discover()).toMatchObject({ manageUrl: null });
  });

  it('the answer is kept thirty seconds, and asked again before a connection is written', async () => {
    const { github, company, clock } = scene();
    await github.discover();
    await github.discover();
    expect(company.api.countOf('app')).toBe(1);
    await github.discover({ fresh: true });
    expect(company.api.countOf('app')).toBe(2);
    clock.advance(DISCOVERY_CACHE_MS - 1);
    await github.discover();
    expect(company.api.countOf('app')).toBe(2);
    clock.advance(1);
    await github.discover();
    expect(company.api.countOf('app')).toBe(3);
    // Several pages that open together ask once.
    clock.advance(DISCOVERY_CACHE_MS);
    await Promise.all([github.discover(), github.discover(), github.discover()]);
    expect(company.api.countOf('app')).toBe(4);
  });

  it('a refused key, a rate limit and a GitHub that does not answer', async () => {
    const refused = scene();
    refused.company.api.failWith('unauthorized', null, 401);
    expect(await refused.github.discover()).toEqual({
      state: 'unavailable',
      reason: 'key_refused',
    });
    // Written to the log once a minute, with the company's code and never the key.
    await refused.github.discover({ fresh: true });
    expect(refused.errors).toEqual([{ company: 'armadx', status: 401, requestId: null }]);
    refused.clock.advance(60_000);
    await refused.github.discover({ fresh: true });
    expect(refused.errors).toHaveLength(2);

    const down = scene();
    down.company.api.failWith('unavailable');
    expect(await down.github.discover()).toEqual({ state: 'unavailable', reason: 'github_down' });

    const limited = scene();
    const retryAt = limited.clock.ms + 120_000;
    limited.company.api.failWith('rate_limited', retryAt, 403);
    expect(await limited.github.discover()).toEqual({
      state: 'unavailable',
      reason: 'rate_limited',
    });
    // No call until GitHub takes requests again, whatever is asked.
    limited.company.api.failWith(null);
    limited.company.api.clearCalls();
    limited.clock.advance(DISCOVERY_CACHE_MS);
    expect(await limited.github.discover({ fresh: true })).toMatchObject({
      reason: 'rate_limited',
    });
    expect(await limited.github.repositories(limited.connection)).toEqual({
      state: 'unavailable',
      reason: 'rate_limited',
      retryAtMs: retryAt,
    });
    expect(unavailable(await limited.github.view(limited.connection, PANEL))).toMatchObject({
      reason: 'rate_limited',
      retryAtMs: retryAt,
      last: null,
    });
    expect(limited.company.api.calls).toEqual([]);
    limited.clock.ms = retryAt;
    expect(await limited.github.discover({ fresh: true })).toMatchObject({ state: 'installed' });
  });
});

describe('the list of repositories', () => {
  it('every repository of the organisation the installation reaches, by name', async () => {
    const { github, company, connection, clock } = scene();
    // A repository of somebody else that the token happens to see is not the organisation's.
    company.api.addRepository(fakeRepository({ id: 4242, login: 'stranger' }, 999, 'aaa'));
    company.api.addRepository(fakeRepository(company.owner, 750, 'Zebra'));
    const list = await github.repositories(connection);
    expect(list).toMatchObject({ state: 'ok', truncated: false, fetchedAtMs: clock.ms });
    expect(list.state === 'ok' && list.repositories.map((r) => r.fullName)).toEqual([
      'arma-org/api',
      'arma-org/archive',
      'arma-org/panel',
      'arma-org/Zebra',
    ]);
    company.api.truncated = true;
    clock.advance(REPOSITORY_LIST_CACHE_MS);
    expect(await github.repositories(connection)).toMatchObject({ truncated: true });
  });

  it('is read live, kept five minutes, and read again on request once in ten seconds', async () => {
    const { github, company, connection, clock } = scene();
    await github.repositories(connection);
    await github.repositories(connection);
    expect(company.api.countOf('repositories')).toBe(1);

    // A repository is created in the organisation: there after five minutes by itself...
    company.api.addRepository(fakeRepository(company.owner, 760, 'new-one'));
    clock.advance(REPOSITORY_LIST_CACHE_MS - 1);
    const before = await github.repositories(connection);
    expect(before.state === 'ok' && before.repositories).toHaveLength(3);
    clock.advance(1);
    const after = await github.repositories(connection);
    expect(after.state === 'ok' && after.repositories.map((r) => r.id)).toContain(760);
    expect(company.api.countOf('repositories')).toBe(2);

    // ...or at once with "refresh", which reads at most once in ten seconds.
    company.api.addRepository(fakeRepository(company.owner, 761, 'newer'));
    await github.repositories(connection, { refresh: true });
    expect(company.api.countOf('repositories')).toBe(2);
    clock.advance(REPOSITORY_LIST_REFRESH_STOP_MS);
    const refreshed = await github.repositories(connection, { refresh: true });
    expect(refreshed.state === 'ok' && refreshed.repositories.map((r) => r.id)).toContain(761);
    expect(company.api.countOf('repositories')).toBe(3);

    // One reading at a time however many people ask.
    clock.advance(REPOSITORY_LIST_CACHE_MS);
    await Promise.all([github.repositories(connection), github.repositories(connection)]);
    expect(company.api.countOf('repositories')).toBe(4);
  });

  it('a repository that is not held is looked for once more, not on every question', async () => {
    const { github, company, connection, clock } = scene();
    expect(await github.findRepository(connection, PANEL)).toMatchObject({
      state: 'found',
      repository: { fullName: 'arma-org/panel' },
    });
    // A number that is nobody's, and a repository of the other company's organisation.
    for (const id of [123456, 900]) {
      expect(await github.findRepository(connection, id)).toEqual({ state: 'missing' });
    }
    expect(company.api.countOf('repositories')).toBe(1);
    // Created after the list was read: found by the second look.
    clock.advance(REPOSITORY_LIST_REFRESH_STOP_MS);
    company.api.addRepository(fakeRepository(company.owner, 770, 'fresh'));
    expect(await github.findRepository(connection, 770)).toMatchObject({ state: 'found' });
    expect(company.api.countOf('repositories')).toBe(2);
  });

  it('gives nothing when the app was removed, and drops what it held', async () => {
    const { github, company, connection, clock } = scene();
    await github.repositories(connection);
    lists(await github.view(connection, PANEL));
    company.api.uninstall();
    clock.advance(REPOSITORY_LIST_CACHE_MS);
    expect(await github.repositories(connection)).toEqual({
      state: 'unavailable',
      reason: 'installation_gone',
      retryAtMs: null,
    });
    expect(company.api.forgotten).toEqual([5001]);
    expect(await github.findRepository(connection, PANEL)).toMatchObject({
      state: 'unavailable',
      reason: 'installation_gone',
    });
    expect(unavailable(await github.view(connection, PANEL))).toMatchObject({
      reason: 'installation_gone',
      last: null,
    });
  });

  it("the row of another installation is not served from this installation's list", async () => {
    const { github, company, connection } = scene();
    await github.repositories(connection);
    // The row names an installation that is not this app's (the slots were changed after
    // connecting): no token, so nothing, and never the list read through the other one.
    const foreign = { installationId: 6001, accountId: 2001 };
    expect(await github.repositories(foreign)).toMatchObject({
      state: 'unavailable',
      reason: 'installation_gone',
    });
    expect(company.api.calls.at(-1)).toEqual({ method: 'repositories', installationId: 6001 });
  });
});

describe('the lists of a repository', () => {
  it('the last commits, the open pull requests and the open issues, with user names', async () => {
    const { github, connection, clock } = scene();
    const view = await github.view(connection, PANEL);
    expect(view).toEqual({
      state: 'ok',
      repository: { id: 700, fullName: 'arma-org/panel', url: 'https://github.com/arma-org/panel' },
      lists: {
        fetchedAt: new Date(clock.ms).toISOString(),
        defaultBranch: 'main',
        private: true,
        archived: false,
        commits: {
          more: false,
          items: [1, 2, 3].map((n) => ({
            sha: n.toString(16).padStart(40, '0'),
            // The first line of the message only.
            title: `Change ${String(n)} of panel`,
            author: 'ayse-k',
            date: `2026-10-12T09:0${String(n)}:00Z`,
            url: `https://github.com/arma-org/panel/commit/${n.toString(16).padStart(40, '0')}`,
          })),
        },
        pullRequests: {
          more: false,
          items: [
            {
              number: 11,
              title: 'Pull request 11 of panel',
              author: 'mehmet',
              createdAt: '2026-10-12T09:11:00Z',
              draft: false,
              url: 'https://github.com/arma-org/panel/pull/11',
            },
            {
              number: 12,
              title: 'Pull request 12 of panel',
              author: 'mehmet',
              createdAt: '2026-10-12T09:12:00Z',
              draft: true,
              url: 'https://github.com/arma-org/panel/pull/12',
            },
          ],
        },
        issues: {
          more: false,
          items: [21, 22].map((n) => ({
            number: n,
            title: `Issue ${String(n)} of panel`,
            author: 'zeynep',
            createdAt: `2026-10-12T09:${String(n)}:00Z`,
            url: `https://github.com/arma-org/panel/issues/${String(n)}`,
          })),
        },
      },
    });
    // What the panel is sent is an answer of the contract.
    expect(projectGithubSchema.safeParse({ ...view, canLink: false }).success).toBe(true);
  });

  it('twenty rows at most, pull requests out of the issues, long texts cut, foreign links dropped', async () => {
    const { github, company, connection } = scene();
    const [panel] = company.repositories;
    if (!panel) {
      throw new Error('The fake has no repository');
    }
    company.api.setLists(PANEL, {
      commits: [
        { ...fakeCommit(panel, 1), message: `${'x'.repeat(300)}\nsecond line` },
        // No GitHub account: nobody is named.
        { ...fakeCommit(panel, 2), authorLogin: null, htmlUrl: 'https://evil.example.test/c' },
        ...Array.from({ length: 30 }, (_, index) => fakeCommit(panel, index + 3)),
      ],
      pullRequests: [{ ...fakePullRequest(panel, 5), title: 'y'.repeat(400), authorLogin: null }],
      issues: [
        ...Array.from({ length: 25 }, (_, index) => ({
          ...fakeIssue(panel, 100 + index),
          isPullRequest: true,
        })),
        ...Array.from({ length: 21 }, (_, index) => fakeIssue(panel, 200 + index)),
      ],
    });
    const shown = lists(await github.view(connection, PANEL));
    expect(shown.commits?.items).toHaveLength(20);
    expect(shown.commits?.more).toBe(true);
    expect(shown.commits?.items[0]?.title).toBe('x'.repeat(200));
    expect(shown.commits?.items[1]).toMatchObject({ author: null, url: null });
    expect(shown.pullRequests).toMatchObject({
      more: false,
      items: [{ title: 'y'.repeat(300), author: null }],
    });
    expect(shown.issues?.items.map((issue) => issue.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => 200 + index),
    );
    expect(shown.issues?.more).toBe(true);
  });

  it('is fresh for a minute; after it GitHub is asked with the tags of the last answer', async () => {
    const { github, company, connection, clock } = scene();
    const first = lists(await github.view(connection, PANEL));
    clock.advance(LISTS_CACHE_MS - 1);
    expect(lists(await github.view(connection, PANEL))).toEqual(first);
    expect(company.api.calls.map((call) => call.method)).toEqual([
      'repositories',
      'commits',
      'pullRequests',
      'issues',
    ]);

    clock.advance(1);
    company.api.clearCalls();
    const second = lists(await github.view(connection, PANEL));
    // Nothing changed at GitHub: the three calls cost nothing of the limit, the rows stay.
    expect(company.api.calls).toEqual(
      ['commits', 'pullRequests', 'issues'].map((method) => ({
        method,
        installationId: 5001,
        repositoryId: PANEL,
        notModified: true,
      })),
    );
    expect(second).toEqual({ ...first, fetchedAt: new Date(clock.ms).toISOString() });

    // One list changed: only that one comes anew.
    const [panel] = company.repositories;
    company.api.setLists(PANEL, { issues: panel ? [fakeIssue(panel, 30)] : [] });
    clock.advance(LISTS_CACHE_MS);
    company.api.clearCalls();
    const third = lists(await github.view(connection, PANEL));
    expect(company.api.calls.map((call) => call.notModified ?? false)).toEqual([true, true, false]);
    expect(third.issues?.items.map((issue) => issue.number)).toEqual([30]);
    expect(third.commits).toEqual(first.commits);
  });

  it('one reading at a time per repository, one call after the other', async () => {
    const { github, company, connection } = scene();
    await github.repositories(connection);
    company.api.clearCalls();
    const release = company.api.hold();
    const readers = [1, 2, 3, 4].map(() => github.view(connection, PANEL));
    await new Promise((resolve) => setImmediate(resolve));
    // Held at the first call: the second has not begun.
    expect(company.api.calls.map((call) => call.method)).toEqual(['commits']);
    release();
    const views = await Promise.all(readers);
    expect(company.api.calls.map((call) => call.method)).toEqual([
      'commits',
      'pullRequests',
      'issues',
    ]);
    expect(new Set(views.map((view) => JSON.stringify(view))).size).toBe(1);
  });

  it('a list that cannot be read does not take the others down', async () => {
    const { github, company, connection } = scene();
    // The installation has no issues permission.
    company.api.failList('issues');
    const shown = lists(await github.view(connection, PANEL));
    expect(shown.issues).toBeNull();
    expect(shown.commits?.items).toHaveLength(3);
    expect(shown.pullRequests?.items).toHaveLength(2);

    // A server error on one list, a status GitHub gives for an empty repository on another.
    const other = scene();
    other.company.api.failList('commits', 'unavailable', 409);
    other.company.api.failList('pullRequests', 'unavailable', 502);
    const partial = lists(await other.github.view(other.connection, PANEL));
    expect(partial.commits).toBeNull();
    expect(partial.pullRequests).toBeNull();
    expect(partial.issues?.items).toHaveLength(2);
  });

  it('the repository carries its present name and what GitHub says of it', async () => {
    const { github, company, connection, clock } = scene();
    const archive = lists(await github.view(connection, 702));
    expect(archive).toMatchObject({ archived: true, private: true });
    company.api.renameRepository(PANEL, 'panel-new');
    clock.advance(REPOSITORY_LIST_CACHE_MS);
    expect(await github.view(connection, PANEL)).toMatchObject({
      state: 'ok',
      repository: {
        id: 700,
        fullName: 'arma-org/panel-new',
        url: 'https://github.com/arma-org/panel-new',
      },
    });
  });
});

describe('when access is taken away', () => {
  it('a repository that left the installation shows nothing, at once', async () => {
    for (const leave of ['removed', 'unselected'] as const) {
      const { github, company, connection, clock } = scene();
      lists(await github.view(connection, PANEL));
      if (leave === 'removed') {
        company.api.removeRepository(PANEL);
      } else {
        company.api.selectRepositories([701]);
      }
      // The lists read a moment ago are not served again once GitHub is asked.
      clock.advance(LISTS_CACHE_MS);
      const gone = unavailable(await github.view(connection, PANEL));
      expect(gone, leave).toEqual({
        state: 'unavailable',
        repository: null,
        reason: 'repository_gone',
        retryAtMs: null,
        last: null,
      });
      // The other repositories still read.
      lists(await github.view(connection, 701));
      // Put back: read from nothing.
      if (leave === 'unselected') {
        company.api.selectRepositories([PANEL, 701]);
        clock.advance(REPOSITORY_LIST_CACHE_MS);
        company.api.clearCalls();
        lists(await github.view(connection, PANEL));
        expect(company.api.calls.some((call) => call.notModified)).toBe(false);
      }
    }
  });

  it('a removed or suspended app shows nothing, and the token is dropped', async () => {
    for (const act of ['uninstall', 'suspend'] as const) {
      const { github, company, connection, clock } = scene();
      lists(await github.view(connection, PANEL));
      lists(await github.view(connection, 701));
      company.api[act]();
      clock.advance(LISTS_CACHE_MS);
      expect(unavailable(await github.view(connection, PANEL)), act).toEqual({
        state: 'unavailable',
        repository: null,
        reason: 'installation_gone',
        retryAtMs: null,
        last: null,
      });
      expect(company.api.forgotten).toEqual([5001]);
      // The lists of the other repository went with it, although they were read a minute ago.
      expect(unavailable(await github.view(connection, 701)).last).toBeNull();
      // Access comes back: everything is read from nothing, not from what was held before.
      company.api.install(company.installation);
      company.api.clearCalls();
      lists(await github.view(connection, 701));
      expect(company.api.countOf('commits')).toBe(1);
      expect(company.api.calls.some((call) => call.notModified)).toBe(false);
    }
  });

  it('a refused key shows nothing either', async () => {
    const { github, company, connection, clock, errors } = scene();
    lists(await github.view(connection, PANEL));
    company.api.failWith('unauthorized', null, 401);
    clock.advance(LISTS_CACHE_MS);
    expect(unavailable(await github.view(connection, PANEL))).toMatchObject({
      reason: 'installation_gone',
      last: null,
    });
    expect(errors).toHaveLength(1);
  });

  it('a refusal on the list of repositories is access taken away, not GitHub being down', async () => {
    // An owner cuts the app off in a way GitHub answers to a token the client still holds (an
    // IP allow list, for example): GitHub did answer, and it said no.
    for (const [kind, status] of [
      ['forbidden', 403],
      ['not_found', 404],
    ] as const) {
      const { github, company, connection, clock } = scene();
      await github.repositories(connection);
      // The lists are read while the list of repositories is still held.
      clock.advance(REPOSITORY_LIST_CACHE_MS - LISTS_CACHE_MS);
      lists(await github.view(connection, PANEL));
      company.api.failWith(kind, null, status);
      // The list of repositories has run out; the lists of the tab are a minute old.
      clock.advance(LISTS_CACHE_MS);
      company.api.clearCalls();
      expect(unavailable(await github.view(connection, PANEL)), kind).toEqual({
        state: 'unavailable',
        repository: null,
        reason: 'installation_gone',
        retryAtMs: null,
        last: null,
      });
      expect(company.api.calls.map((call) => call.method)).toEqual(['repositories']);
      expect(company.api.forgotten).toEqual([5001]);
      expect(await github.repositories(connection)).toEqual({
        state: 'unavailable',
        reason: 'installation_gone',
        retryAtMs: null,
      });
      // GitHub answers again within the ten minutes: read from nothing, no row of before.
      company.api.failWith(null);
      company.api.clearCalls();
      lists(await github.view(connection, PANEL));
      expect(company.api.countOf('commits')).toBe(1);
      expect(company.api.calls.some((call) => call.notModified)).toBe(false);
    }
  });

  it('switched off: everything this company held goes, and a reading under way is not kept', async () => {
    const { github, company, connection } = scene();
    lists(await github.view(connection, PANEL));
    await github.discover();
    github.forget(connection.installationId);
    expect(company.api.forgotten).toEqual([5001]);
    company.api.clearCalls();
    // Connected again: everything is read from nothing.
    await github.discover();
    lists(await github.view(connection, PANEL));
    expect(company.api.calls.map((call) => call.method)).toEqual([
      'app',
      'installations',
      'repositories',
      'commits',
      'pullRequests',
      'issues',
    ]);
    expect(company.api.calls.some((call) => call.notModified)).toBe(false);

    // Switched off while the lists are being read: the result is neither shown nor kept.
    const other = scene();
    await other.github.repositories(other.connection);
    const release = other.company.api.hold();
    const reading = other.github.view(other.connection, PANEL);
    await new Promise((resolve) => setImmediate(resolve));
    other.github.forget(other.connection.installationId);
    release();
    expect(unavailable(await reading).last).toBeNull();
    other.company.api.clearCalls();
    lists(await other.github.view(other.connection, PANEL));
    expect(other.company.api.countOf('commits')).toBe(1);
  });
});

describe('when GitHub cannot be asked', () => {
  it('rate limited: no call until the reset, and the last lists with their time', async () => {
    const { github, company, connection, clock } = scene();
    const first = lists(await github.view(connection, PANEL));
    const retryAt = clock.ms + 5 * 60_000;
    company.api.failWith('rate_limited', retryAt, 403);
    clock.advance(LISTS_CACHE_MS);
    const limited = unavailable(await github.view(connection, PANEL));
    expect(limited).toEqual({
      state: 'unavailable',
      repository: { id: 700, fullName: 'arma-org/panel', url: 'https://github.com/arma-org/panel' },
      reason: 'rate_limited',
      retryAtMs: retryAt,
      last: first,
    });
    company.api.failWith(null);
    company.api.clearCalls();
    clock.advance(60_000);
    expect(unavailable(await github.view(connection, PANEL)).last).toEqual(first);
    expect(unavailable(await github.view(connection, 701)).last).toBeNull();
    expect(company.api.calls).toEqual([]);
    // After the reset GitHub is asked again.
    clock.ms = retryAt;
    lists(await github.view(connection, PANEL));
    expect(company.api.calls.length).toBeGreaterThan(0);
  });

  it('down: the last lists for ten minutes at most, and one attempt a minute', async () => {
    const { github, company, connection, clock } = scene();
    const first = lists(await github.view(connection, PANEL));
    company.api.failWith('unavailable');
    clock.advance(LISTS_CACHE_MS);
    company.api.clearCalls();
    expect(unavailable(await github.view(connection, PANEL))).toMatchObject({
      reason: 'github_down',
      retryAtMs: null,
      last: first,
    });
    // The first call got no answer: the other two were not tried, and nothing is tried again
    // within the minute.
    expect(company.api.calls.map((call) => call.method)).toEqual(['commits']);
    clock.advance(LISTS_CACHE_MS - 1);
    expect(unavailable(await github.view(connection, PANEL)).last).toEqual(first);
    expect(company.api.countOf('commits')).toBe(1);

    // Ten minutes after they were read the lists are dropped.
    clock.ms = Date.parse(first.fetchedAt) + LISTS_KEEP_MS + 1;
    const late = unavailable(await github.view(connection, PANEL));
    expect(late.reason).toBe('github_down');
    expect(late.last).toBeNull();

    // GitHub answers again: read from nothing.
    company.api.failWith(null);
    clock.advance(LISTS_CACHE_MS);
    company.api.clearCalls();
    lists(await github.view(connection, PANEL));
    expect(company.api.calls.some((call) => call.notModified)).toBe(false);
  });

  it('three server errors are GitHub being down, not three lists that cannot be read', async () => {
    const { github, company, connection, clock } = scene();
    const first = lists(await github.view(connection, PANEL));
    for (const list of ['commits', 'pullRequests', 'issues'] as const) {
      company.api.failList(list, 'unavailable', 503);
    }
    clock.advance(LISTS_CACHE_MS);
    expect(unavailable(await github.view(connection, PANEL))).toMatchObject({
      reason: 'github_down',
      last: first,
    });
  });
});

describe('the two companies', () => {
  it('each company has its own client, and no other is handed out', () => {
    const { armadx, pillika } = standardGithub();
    const arma = scene(armadx).github;
    const service = new GithubService([arma, scene(pillika).github]);
    expect(service.forCompany('armadx')).toBe(arma);
    expect(service.forCompany('pillika')?.organization).toBe('pillika-org');
    for (const code of ['founder_space', 'other', '', 'ARMADX', 'armadx ']) {
      expect(service.forCompany(code), code).toBeNull();
    }
    expect(service.companyCodes).toEqual(['armadx', 'pillika']);
    expect(new GithubService([]).forCompany('armadx')).toBeNull();
    // Two apps for one company are a mistake of the set-up, not something to choose between.
    expect(() => new GithubService([arma, scene(standardGithub().armadx).github])).toThrow();
  });

  it('nothing one company read is served to the other, also for one and the same number', async () => {
    const { armadx, pillika } = standardGithub();
    const clock = new TestClock();
    const arma = scene(armadx, clock);
    const pil = scene(pillika, clock);
    // Pillika's organisation has a repository with the number Arma DX's "panel" has.
    const twin = fakeRepository(pillika.owner, PANEL, 'twin');
    pillika.api.addRepository(twin, { commits: [fakeCommit(twin, 9, 'pillika-person')] });

    const armaView = lists(await arma.github.view(arma.connection, PANEL));
    pillika.api.clearCalls();
    armadx.api.clearCalls();
    const pillikaView = await pil.github.view(pil.connection, PANEL);
    expect(pillikaView).toMatchObject({
      state: 'ok',
      repository: { fullName: 'pillika-org/twin' },
    });
    expect(lists(pillikaView).commits?.items.map((commit) => commit.author)).toEqual([
      'pillika-person',
    ]);
    expect(JSON.stringify(pillikaView)).not.toContain('arma-org');
    expect(JSON.stringify(armaView)).not.toContain('pillika');
    // While Pillika read, the fake of Arma DX recorded no call.
    expect(armadx.api.calls).toEqual([]);

    // A limit of one company does not hold the other back.
    armadx.api.failWith('rate_limited', clock.ms + 600_000, 403);
    clock.advance(LISTS_CACHE_MS);
    expect(unavailable(await arma.github.view(arma.connection, PANEL)).reason).toBe('rate_limited');
    lists(await pil.github.view(pil.connection, PANEL));
    // Switching one off leaves the other's lists.
    arma.github.forget(arma.connection.installationId);
    pillika.api.clearCalls();
    lists(await pil.github.view(pil.connection, PANEL));
    expect(pillika.api.calls).toEqual([]);
    expect(pillika.api.forgotten).toEqual([]);
  });
});
