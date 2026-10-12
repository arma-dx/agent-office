import { randomUUID } from 'node:crypto';
import {
  githubRepositoriesSchema,
  projectDetailSchema,
  projectGithubSchema,
  type GithubRepositories,
  type ProjectDetail,
  type ProjectGithub,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SoftwareAuthenticator } from './authenticator.ts';
import { fakeCommit, fakeIssue, fakePullRequest, fakeRepository } from './fake-github.ts';
import { accounts, ids } from './fixtures.ts';
import { clearGithub, connectCompany, githubScene, type GithubScene } from './github-helpers.ts';
import {
  PANEL_ORIGIN,
  adminExec,
  adminQuery,
  closeAdminPool,
  noDatabase,
  sessionOf,
} from './helpers.ts';
import { errorCode, freshPasskey, send, type Method } from './passkey-helpers.ts';

// The repository of a project and its GitHub tab through the API (8 October decisions 17 and 19;
// 12 October decisions 14 to 17). GitHub is a fake per company; Arma DX is connected before every
// test. The tests commit: the GitHub rows are removed before every test and at the end of the
// file; the projects they open stay, as in the other files (a project is never deleted).

// Two customers of Arma DX, written as an administrator would: one that allows AI, and one whose
// two contract permissions are closed.
const OPEN_CUSTOMER = '00000000-0000-4000-8000-000000000971';
const CLOSED_CUSTOMER = '00000000-0000-4000-8000-000000000972';

const PANEL = 700;
const API = 701;
const ARCHIVE = 702;
const MINUTE = 60_000;

describe.skipIf(noDatabase)('the repository of a project and its GitHub tab', () => {
  let scene: GithubScene;
  let founder: string;
  // The owner of the projects the tests open.
  let employee: string;
  // Two more employees of Arma DX: made a manager, a plain member, or left out.
  let colleague: string;
  let third: string;
  let external: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);

  beforeAll(async () => {
    const first = githubScene();
    founder = await sessionOf(first.server, accounts.founder);
    employee = await sessionOf(first.server, accounts.employee);
    colleague = await sessionOf(first.server, accounts.holder);
    third = await sessionOf(first.server, accounts.newcomer);
    external = await sessionOf(first.server, accounts.external);
    await freshPasskey(first.server, founder, founderKey, ids.founder, 'Kurucu telefonu');
    await first.server.close();
    await adminExec(`
      insert into office.customers (id, company_id, name, ai_allowed) values
        ('${OPEN_CUSTOMER}', '${ids.arma}', 'GitHub: izinli müşteri', true),
        ('${CLOSED_CUSTOMER}', '${ids.arma}', 'GitHub: izinsiz müşteri', false)
      on conflict (id) do nothing;
    `);
  });

  beforeEach(async () => {
    await clearGithub();
    await adminExec(`
      update office.customers set ai_allowed = false, automated_processing_allowed = false
        where id = '${CLOSED_CUSTOMER}';
    `);
    scene = githubScene();
    founder = await sessionOf(scene.server, accounts.founder);
    const connected = await connectCompany(scene, founder, founderKey, scene.armadx);
    expect(connected.statusCode, connected.body).toBe(200);
    scene.armadx.api.clearCalls();
  });

  afterEach(async () => {
    await scene.server.close();
  });

  afterAll(async () => {
    await clearGithub();
    await adminExec(`
      update office.customers set ai_allowed = false, automated_processing_allowed = false
        where id = '${CLOSED_CUSTOMER}';
    `);
    await closeAdminPool();
  });

  const call = (
    session: string,
    method: Method,
    url: string,
    payload?: object,
    company: string = ids.arma,
  ): Promise<LightMyRequestResponse> =>
    send(scene.server, session, method, url, { company, ...(payload ? { payload } : {}) });

  const create = (session: string, body: Record<string, unknown> = {}) =>
    call(session, 'POST', '/api/projects', { id: randomUUID(), name: 'GitHub projesi', ...body });

  /** Opens a project and returns the answer. */
  async function open(session: string, body: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const res = await create(session, body);
    expect(res.statusCode, res.body).toBe(201);
    return projectDetailSchema.parse(res.json());
  }

  async function read(session: string, id: string): Promise<ProjectDetail> {
    const res = await call(session, 'GET', `/api/projects/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return projectDetailSchema.parse(res.json());
  }

  const setRepository = (session: string, id: string, repositoryId: number) =>
    call(session, 'PUT', `/api/projects/${id}/repository`, { repositoryId });

  const removeRepository = (session: string, id: string) =>
    call(session, 'DELETE', `/api/projects/${id}/repository`);

  async function tab(session: string, id: string): Promise<ProjectGithub> {
    const res = await call(session, 'GET', `/api/projects/${id}/github`);
    expect(res.statusCode, res.body).toBe(200);
    return projectGithubSchema.parse(res.json());
  }

  async function list(session: string, query = ''): Promise<GithubRepositories> {
    const res = await call(session, 'GET', `/api/github/repositories${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return githubRepositoriesSchema.parse(res.json());
  }

  /** The owner (the employee) opens a project with a manager and a plain member. */
  async function team(body: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const project = await open(employee, { memberIds: [ids.holder, ids.newcomer], ...body });
    const role = await call(
      employee,
      'PUT',
      `/api/projects/${project.id}/members/${ids.holder}/role`,
      {
        role: 'manager',
      },
    );
    expect(role.statusCode, role.body).toBe(200);
    return project;
  }

  const linkRows = (projectId: string) =>
    adminQuery<{ repository_id: string; full_name: string; linked_by_user_id: string }>(
      `select repository_id::text as repository_id, full_name, linked_by_user_id
       from office.project_repositories where project_id = $1`,
      [projectId],
    );

  const audit = (projectId: string) =>
    adminQuery<{ event: string; external_ref: string; user_id: string }>(
      `select event, external_ref, user_id from office.audit_log
       where project_id = $1 and event ~ '^project_repository_' order by id`,
      [projectId],
    );

  const calls = () => scene.armadx.api.calls.map((entry) => entry.method);

  describe('the list of repositories', () => {
    it('every founder and employee reads the name of every repository, and nothing beside it', async () => {
      // The list the connect answer counted is five minutes old by now.
      scene.clock.advance(5 * MINUTE);
      for (const session of [founder, employee, third]) {
        const answer = await call(session, 'GET', '/api/github/repositories');
        expect(answer.statusCode).toBe(200);
        // Private and archived ones too, each with its number and its name and no other field.
        expect(answer.json()).toEqual({
          state: 'ok',
          organization: 'arma-org',
          repositories: [
            { id: API, fullName: 'arma-org/api' },
            { id: ARCHIVE, fullName: 'arma-org/archive' },
            { id: PANEL, fullName: 'arma-org/panel' },
          ],
          truncated: false,
          fetchedAt: new Date(scene.clock.ms).toISOString(),
        });
      }
      // Read once from GitHub for the three of them, and never from the other company's app.
      expect(calls()).toEqual(['repositories']);
      expect(scene.pillika.api.calls).toEqual([]);
    });

    it('is not an external person’s, and not a place to name an installation', async () => {
      const asExternal = await call(external, 'GET', '/api/github/repositories');
      expect(asExternal.statusCode).toBe(403);
      expect(errorCode(asExternal)).toBe('insiders_only');
      for (const query of ['?installation=6001', '?refresh=yes', '?refresh=1&organization=x']) {
        expect((await call(founder, 'GET', `/api/github/repositories${query}`)).statusCode).toBe(
          400,
        );
      }
      const inSpace = await call(
        founder,
        'GET',
        '/api/github/repositories',
        undefined,
        ids.founderSpace,
      );
      expect(errorCode(inSpace)).toBe('private_space');
      expect(calls()).toEqual([]);
    });

    it('a company that is not connected has nothing to pick, and GitHub is not asked', async () => {
      // Pillika has an app and never connected.
      const res = await call(founder, 'GET', '/api/github/repositories', undefined, ids.pillika);
      expect(res.json()).toEqual({ state: 'not_connected' });
      expect(scene.pillika.api.calls).toEqual([]);
      // Arma DX switched off.
      await call(founder, 'DELETE', '/api/github/connection');
      scene.armadx.api.clearCalls();
      expect(await list(employee)).toEqual({ state: 'not_connected' });
      expect(calls()).toEqual([]);
    });

    it('a new repository shows after five minutes or with the founder’s refresh; a removed one goes', async () => {
      await list(employee);
      scene.armadx.api.addRepository(fakeRepository(scene.armadx.owner, 760, 'new-one'));
      const names = async (session: string, query = ''): Promise<string[]> => {
        const answer = await list(session, query);
        return answer.state === 'ok' ? answer.repositories.map((r) => r.fullName) : [];
      };
      expect(await names(employee)).not.toContain('arma-org/new-one');
      // The refresh is the founder's.
      const asEmployee = await call(employee, 'GET', '/api/github/repositories?refresh=1');
      expect(errorCode(asEmployee)).toBe('founder_only');
      scene.clock.advance(10_000);
      expect(await names(founder, '?refresh=1')).toContain('arma-org/new-one');
      expect(await names(employee)).toContain('arma-org/new-one');

      scene.armadx.api.removeRepository(760);
      scene.armadx.api.addRepository(fakeRepository(scene.armadx.owner, 761, 'newer'));
      expect(await names(employee)).toContain('arma-org/new-one');
      scene.clock.advance(5 * MINUTE);
      const later = await names(employee);
      expect(later).toContain('arma-org/newer');
      expect(later).not.toContain('arma-org/new-one');
    });

    it('says "unavailable" when GitHub cannot be asked, never an error of our own', async () => {
      // Within five minutes of the last reading the held list answers.
      scene.armadx.api.failWith('unavailable');
      expect((await list(employee)).state).toBe('ok');
      scene.clock.advance(5 * MINUTE);
      const down = await call(employee, 'GET', '/api/github/repositories');
      expect(down.statusCode).toBe(200);
      expect(down.json()).toEqual({ state: 'unavailable' });
      scene.armadx.api.uninstall();
      scene.armadx.api.failWith(null);
      expect(await list(employee)).toEqual({ state: 'unavailable' });
    });
  });

  describe('a project opened with a repository', () => {
    it('is linked by its opener, and the link is written to the audit log', async () => {
      const project = await open(employee, { repositoryId: PANEL });
      expect(project.repository).toEqual({ id: PANEL, fullName: 'arma-org/panel' });
      expect(project.actions.setRepository).toBe(true);
      expect(await linkRows(project.id)).toEqual([
        { repository_id: '700', full_name: 'arma-org/panel', linked_by_user_id: ids.employee },
      ]);
      expect(await audit(project.id)).toEqual([
        {
          event: 'project_repository_linked',
          external_ref: 'github:repository:700',
          user_id: ids.employee,
        },
      ]);
      // A project without one says so.
      const plain = await open(employee);
      expect(plain.repository).toBeNull();
      expect(await audit(plain.id)).toEqual([]);
    });

    it('a repeated send answers the first project and links nothing twice', async () => {
      const id = randomUUID();
      const first = await create(employee, { id, repositoryId: PANEL });
      const second = await create(employee, { id, repositoryId: API });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(projectDetailSchema.parse(second.json()).repository).toEqual({
        id: PANEL,
        fullName: 'arma-org/panel',
      });
      expect(await audit(id)).toHaveLength(1);
    });

    it('a repository the installation does not reach opens no project', async () => {
      // A number that is nobody's, and a repository of the other company's organisation.
      for (const repositoryId of [123456, 900]) {
        const id = randomUUID();
        const res = await create(employee, { id, repositoryId });
        expect(res.statusCode, String(repositoryId)).toBe(409);
        expect(errorCode(res)).toBe('github_repository_not_available');
        expect(await adminQuery('select 1 from office.projects where id = $1', [id])).toEqual([]);
      }
      // The name is GitHub's, never the request's.
      const named = await create(employee, { repositoryId: PANEL, fullName: 'arma-org/other' });
      expect(named.statusCode).toBe(400);
      expect(scene.pillika.api.calls).toEqual([]);
    });

    it('GitHub is asked before anything is written; when it cannot be asked nothing is opened', async () => {
      scene.clock.advance(5 * MINUTE);
      scene.armadx.api.failWith('unavailable');
      const id = randomUUID();
      const res = await create(employee, { id, repositoryId: PANEL });
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('github_unavailable');
      expect(await adminQuery('select 1 from office.projects where id = $1', [id])).toEqual([]);
      // Without a repository the project opens although GitHub is down.
      expect((await create(employee, { id })).statusCode).toBe(201);
      expect(scene.armadx.api.countOf('repositories')).toBe(1);
    });

    it('a company that is not connected opens no project with a repository', async () => {
      await call(founder, 'DELETE', '/api/github/connection');
      scene.armadx.api.clearCalls();
      const id = randomUUID();
      const res = await create(employee, { id, repositoryId: PANEL });
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('github_not_connected');
      expect(await adminQuery('select 1 from office.projects where id = $1', [id])).toEqual([]);
      expect(calls()).toEqual([]);
    });

    it('rule 12: a customer who allows neither AI nor automated processing gets no repository', async () => {
      const id = randomUUID();
      const refused = await create(employee, {
        id,
        repositoryId: PANEL,
        customer: { kind: 'existing', customerId: CLOSED_CUSTOMER },
      });
      expect(refused.statusCode).toBe(409);
      expect(errorCode(refused)).toBe('github_not_allowed');
      // No project without the repository the person asked for.
      expect(await adminQuery('select 1 from office.projects where id = $1', [id])).toEqual([]);
      // A customer added with the project starts with both permissions closed.
      const customerId = randomUUID();
      const withNew = await create(employee, {
        repositoryId: PANEL,
        customer: {
          kind: 'new',
          id: customerId,
          name: `GitHub yeni müşteri ${customerId.slice(0, 8)}`,
          aiAllowed: false,
          automatedProcessingAllowed: false,
        },
      });
      expect(errorCode(withNew)).toBe('github_not_allowed');
      expect(
        await adminQuery('select 1 from office.customers where id = $1', [customerId]),
      ).toEqual([]);
      // A customer who allows AI, and a project without a customer, are linked.
      const allowed = await open(employee, {
        repositoryId: PANEL,
        customer: { kind: 'existing', customerId: OPEN_CUSTOMER },
      });
      expect(allowed.repository?.id).toBe(PANEL);
      // The founder marks automated processing for the closed customer: linked too.
      await adminExec(`
        update office.customers set automated_processing_allowed = true
          where id = '${CLOSED_CUSTOMER}';
      `);
      const marked = await open(employee, {
        repositoryId: API,
        customer: { kind: 'existing', customerId: CLOSED_CUSTOMER },
      });
      expect(marked.repository).toEqual({ id: API, fullName: 'arma-org/api' });
    });
  });

  describe('changing the repository of a project', () => {
    it('the owner, a manager and the founder give, change and remove it; a change is an unlink and a link', async () => {
      const project = await team();
      expect((await read(employee, project.id)).actions.setRepository).toBe(true);
      expect((await read(colleague, project.id)).actions.setRepository).toBe(true);
      expect((await read(founder, project.id)).actions.setRepository).toBe(true);

      const given = await setRepository(colleague, project.id, PANEL);
      expect(given.statusCode, given.body).toBe(200);
      expect(projectDetailSchema.parse(given.json()).repository).toEqual({
        id: PANEL,
        fullName: 'arma-org/panel',
      });
      // The same repository again: nothing is written.
      expect((await setRepository(employee, project.id, PANEL)).statusCode).toBe(200);
      expect(await audit(project.id)).toHaveLength(1);

      const changed = await setRepository(founder, project.id, API);
      expect(projectDetailSchema.parse(changed.json()).repository?.fullName).toBe('arma-org/api');
      const removed = await removeRepository(employee, project.id);
      expect(removed.statusCode).toBe(200);
      expect(projectDetailSchema.parse(removed.json()).repository).toBeNull();
      // A second removal changes nothing.
      expect((await removeRepository(employee, project.id)).statusCode).toBe(200);
      expect(await audit(project.id)).toEqual([
        {
          event: 'project_repository_linked',
          external_ref: 'github:repository:700',
          user_id: ids.holder,
        },
        {
          event: 'project_repository_unlinked',
          external_ref: 'github:repository:700',
          user_id: ids.founder,
        },
        {
          event: 'project_repository_linked',
          external_ref: 'github:repository:701',
          user_id: ids.founder,
        },
        {
          event: 'project_repository_unlinked',
          external_ref: 'github:repository:701',
          user_id: ids.employee,
        },
      ]);
      expect(await linkRows(project.id)).toEqual([]);
    });

    it('a plain member is refused, and for anybody else the project does not exist', async () => {
      const project = await team({ repositoryId: PANEL });
      expect((await read(third, project.id)).actions.setRepository).toBe(false);
      for (const res of [
        await setRepository(third, project.id, API),
        await removeRepository(third, project.id),
      ]) {
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('project_repository_not_allowed');
      }
      // An employee who is no member, and the founder with another company in the header.
      const outsider = await sessionOf(scene.server, accounts.traveller);
      for (const res of [
        await setRepository(outsider, project.id, API),
        await removeRepository(outsider, project.id),
        await call(outsider, 'GET', `/api/projects/${project.id}/github`),
        await call(
          founder,
          'PUT',
          `/api/projects/${project.id}/repository`,
          { repositoryId: 900 },
          ids.pillika,
        ),
        await call(
          founder,
          'DELETE',
          `/api/projects/${project.id}/repository`,
          undefined,
          ids.pillika,
        ),
        await call(founder, 'GET', `/api/projects/${project.id}/github`, undefined, ids.pillika),
        await setRepository(founder, randomUUID(), API),
      ]) {
        expect(res.statusCode).toBe(404);
      }
      // An external person is refused on every route of the step.
      for (const res of [
        await setRepository(external, project.id, API),
        await removeRepository(external, project.id),
        await call(external, 'GET', `/api/projects/${project.id}/github`),
      ]) {
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('insiders_only');
      }
      expect(await linkRows(project.id)).toHaveLength(1);
      expect(scene.pillika.api.calls).toEqual([]);
    });

    it('needs the open connection, rule 12 and a repository of the installation; removing needs none', async () => {
      const project = await team({ repositoryId: PANEL });
      for (const body of [{}, { repositoryId: '700' }, { repositoryId: 700, fullName: 'x/y' }]) {
        const res = await call(employee, 'PUT', `/api/projects/${project.id}/repository`, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      const missing = await setRepository(employee, project.id, 900);
      expect(missing.statusCode).toBe(409);
      expect(errorCode(missing)).toBe('github_repository_not_available');

      // GitHub cannot be asked and the list is not held: 503, and the old link stays.
      scene.clock.advance(5 * MINUTE);
      scene.armadx.api.failWith('unavailable');
      const down = await setRepository(employee, project.id, API);
      expect(down.statusCode).toBe(503);
      expect(errorCode(down)).toBe('github_unavailable');
      scene.armadx.api.failWith(null);
      expect((await linkRows(project.id))[0]?.repository_id).toBe('700');

      // Rule 12 for a project that exists.
      const closed = await open(employee, {
        customer: { kind: 'existing', customerId: CLOSED_CUSTOMER },
      });
      scene.armadx.api.clearCalls();
      const refused = await setRepository(employee, closed.id, PANEL);
      expect(refused.statusCode).toBe(409);
      expect(errorCode(refused)).toBe('github_not_allowed');
      // Said before GitHub is asked.
      expect(calls()).toEqual([]);

      // Switched off: nothing is linked, and what is linked can still be removed.
      await call(founder, 'DELETE', '/api/github/connection');
      const off = await setRepository(employee, project.id, API);
      expect(off.statusCode).toBe(409);
      expect(errorCode(off)).toBe('github_not_connected');
      expect((await read(employee, project.id)).repository?.id).toBe(PANEL);
      expect((await removeRepository(employee, project.id)).statusCode).toBe(200);
      expect(await linkRows(project.id)).toEqual([]);
    });
  });

  describe('the GitHub tab', () => {
    it('whoever reads the project reads the three lists, with the GitHub user names', async () => {
      const project = await team({ repositoryId: PANEL });
      const [panel] = scene.armadx.repositories;
      if (!panel) {
        throw new Error('The fake has no repository');
      }
      scene.armadx.api.setLists(PANEL, {
        commits: [
          fakeCommit(panel, 1, 'ayse-k'),
          // A commit without a GitHub account names nobody.
          { ...fakeCommit(panel, 2), authorLogin: null },
        ],
        issues: [fakeIssue(panel, 21), { ...fakeIssue(panel, 22), isPullRequest: true }],
        pullRequests: [fakePullRequest(panel, 12)],
      });
      const asOwner = await tab(employee, project.id);
      expect(asOwner).toEqual({
        state: 'ok',
        repository: {
          id: PANEL,
          fullName: 'arma-org/panel',
          url: 'https://github.com/arma-org/panel',
        },
        canLink: true,
        lists: {
          fetchedAt: new Date(scene.clock.ms).toISOString(),
          defaultBranch: 'main',
          private: true,
          archived: false,
          commits: {
            more: false,
            items: [
              {
                sha: '1'.padStart(40, '0'),
                title: 'Change 1 of panel',
                author: 'ayse-k',
                date: '2026-10-12T09:01:00Z',
                url: `https://github.com/arma-org/panel/commit/${'1'.padStart(40, '0')}`,
              },
              {
                sha: '2'.padStart(40, '0'),
                title: 'Change 2 of panel',
                author: null,
                date: '2026-10-12T09:02:00Z',
                url: `https://github.com/arma-org/panel/commit/${'2'.padStart(40, '0')}`,
              },
            ],
          },
          pullRequests: {
            more: false,
            items: [
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
          // The pull request among the issues has its own list.
          issues: {
            more: false,
            items: [
              {
                number: 21,
                title: 'Issue 21 of panel',
                author: 'zeynep',
                createdAt: '2026-10-12T09:21:00Z',
                url: 'https://github.com/arma-org/panel/issues/21',
              },
            ],
          },
        },
      });
      // A plain member and the founder read the same lists; only who may change differs.
      expect(await tab(third, project.id)).toEqual({ ...asOwner, canLink: false });
      expect(await tab(founder, project.id)).toEqual(asOwner);
      // An archived repository still reads, and says so.
      const archived = await open(employee, { repositoryId: ARCHIVE });
      expect(await tab(employee, archived.id)).toMatchObject({
        state: 'ok',
        lists: { archived: true },
      });
    });

    it('is read once a minute however many people open it', async () => {
      const project = await team({ repositoryId: PANEL });
      scene.armadx.api.clearCalls();
      await Promise.all([
        tab(employee, project.id),
        tab(colleague, project.id),
        tab(third, project.id),
        tab(founder, project.id),
      ]);
      scene.clock.advance(MINUTE - 1);
      await tab(employee, project.id);
      expect(calls()).toEqual(['commits', 'pullRequests', 'issues']);
      scene.clock.advance(1);
      const again = await tab(employee, project.id);
      expect(calls()).toHaveLength(6);
      expect(again.state === 'ok' && again.lists.fetchedAt).toBe(
        new Date(scene.clock.ms).toISOString(),
      );
      // The same repository on a second project is the same reading.
      const second = await open(employee, { repositoryId: PANEL });
      await tab(employee, second.id);
      expect(calls()).toHaveLength(6);
    });

    it('a project without a repository, and who may give it one', async () => {
      const project = await team();
      expect(await tab(employee, project.id)).toEqual({
        state: 'no_repository',
        canLink: true,
        allowed: true,
      });
      expect(await tab(third, project.id)).toEqual({
        state: 'no_repository',
        canLink: false,
        allowed: true,
      });
      const closed = await open(employee, {
        customer: { kind: 'existing', customerId: CLOSED_CUSTOMER },
      });
      expect(await tab(employee, closed.id)).toEqual({
        state: 'no_repository',
        canLink: true,
        allowed: false,
      });
      expect(calls()).toEqual([]);
    });

    it('one list that cannot be read does not take the tab down', async () => {
      const project = await open(employee, { repositoryId: PANEL });
      scene.armadx.api.failList('issues');
      const answer = await tab(employee, project.id);
      expect(answer).toMatchObject({ state: 'ok', lists: { issues: null } });
      expect(answer.state === 'ok' && answer.lists.commits?.items).toHaveLength(3);
    });

    it('rule 12: a customer whose permission is closed afterwards stops the reading at once', async () => {
      await adminExec(`
        update office.customers set automated_processing_allowed = true
          where id = '${CLOSED_CUSTOMER}';
      `);
      const project = await open(employee, {
        repositoryId: PANEL,
        customer: { kind: 'existing', customerId: CLOSED_CUSTOMER },
      });
      expect((await tab(employee, project.id)).state).toBe('ok');
      await adminExec(`
        update office.customers set automated_processing_allowed = false
          where id = '${CLOSED_CUSTOMER}';
      `);
      scene.armadx.api.clearCalls();
      // Not even the lists read a moment ago are shown, and GitHub is not asked.
      expect(await tab(employee, project.id)).toEqual({
        state: 'not_allowed',
        repository: { id: PANEL, fullName: 'arma-org/panel', url: null },
        canLink: true,
      });
      scene.clock.advance(5 * MINUTE);
      expect((await tab(founder, project.id)).state).toBe('not_allowed');
      expect(calls()).toEqual([]);
      // The link is kept: opening the permission brings the tab back.
      expect(await linkRows(project.id)).toHaveLength(1);
      await adminExec(`
        update office.customers set ai_allowed = true where id = '${CLOSED_CUSTOMER}';
      `);
      expect((await tab(employee, project.id)).state).toBe('ok');
    });
  });

  describe('when access is taken away', () => {
    it('a repository taken out of the installation shows no row, although it was read a moment ago', async () => {
      const project = await team({ repositoryId: PANEL });
      expect((await tab(employee, project.id)).state).toBe('ok');
      // An owner of the organisation narrows the installation to hide the repository.
      scene.armadx.api.selectRepositories([API]);
      scene.clock.advance(MINUTE);
      const gone = {
        state: 'unavailable',
        repository: { id: PANEL, fullName: 'arma-org/panel', url: null },
        reason: 'repository_gone',
        retryAt: null,
        last: null,
      };
      expect(await tab(employee, project.id)).toEqual({ ...gone, canLink: true });
      expect(await tab(third, project.id)).toEqual({ ...gone, canLink: false });
      // Nothing is unlinked by itself; who may changes or removes it.
      expect(await linkRows(project.id)).toHaveLength(1);
      expect((await setRepository(employee, project.id, API)).statusCode).toBe(200);
      expect((await tab(employee, project.id)).state).toBe('ok');
    });

    it('a removed or suspended app shows no row, and a read changes no record', async () => {
      for (const act of ['uninstall', 'suspend'] as const) {
        await clearGithub();
        await scene.server.close();
        scene = githubScene();
        founder = await sessionOf(scene.server, accounts.founder);
        await connectCompany(scene, founder, founderKey, scene.armadx);
        const project = await open(employee, { repositoryId: PANEL });
        expect((await tab(employee, project.id)).state).toBe('ok');
        scene.armadx.api[act]();
        scene.clock.advance(MINUTE);
        expect(await tab(employee, project.id), act).toEqual({
          state: 'unavailable',
          repository: { id: PANEL, fullName: 'arma-org/panel', url: null },
          canLink: true,
          reason: 'installation_gone',
          retryAt: null,
          last: null,
        });
        expect(scene.armadx.api.forgotten).toEqual([5001]);
        expect(await linkRows(project.id)).toHaveLength(1);
        const [row] = await adminQuery<{ status: string }>(
          `select status from office.integrations where provider = 'github' and company_id = $1`,
          [ids.arma],
        );
        expect(row?.status).toBe('enabled');
      }
    });

    it('switched off: the tab asks nothing and shows nothing; connected again, the links are back', async () => {
      const project = await team({ repositoryId: PANEL });
      expect((await tab(employee, project.id)).state).toBe('ok');
      await call(founder, 'DELETE', '/api/github/connection');
      scene.armadx.api.clearCalls();
      for (const session of [employee, third, founder]) {
        expect(await tab(session, project.id)).toEqual({
          state: 'not_connected',
          disconnected: true,
          canLink: false,
        });
      }
      expect(await list(employee)).toEqual({ state: 'not_connected' });
      // The fake of this company recorded no call for the tab and the list.
      expect(calls()).toEqual([]);
      // The repository stays linked and comes back with the connection, read from nothing.
      expect((await read(employee, project.id)).repository?.id).toBe(PANEL);
      founder = await sessionOf(scene.server, accounts.founder);
      await connectCompany(scene, founder, founderKey, scene.armadx);
      scene.armadx.api.clearCalls();
      expect((await tab(employee, project.id)).state).toBe('ok');
      expect(calls()).toEqual(['commits', 'pullRequests', 'issues']);
      expect(scene.armadx.api.calls.some((entry) => entry.notModified)).toBe(false);
    });

    it('a company that never connected says so on the tab of its projects', async () => {
      await clearGithub();
      const project = await open(employee);
      expect(await tab(employee, project.id)).toEqual({
        state: 'not_connected',
        disconnected: false,
        canLink: false,
      });
    });
  });

  describe('when GitHub cannot be asked', () => {
    it('rate limited: no call until the reset, and the last lists with their time', async () => {
      const project = await open(employee, { repositoryId: PANEL });
      const first = await tab(employee, project.id);
      const retryAt = scene.clock.ms + 5 * MINUTE;
      scene.armadx.api.failWith('rate_limited', retryAt, 403);
      scene.clock.advance(MINUTE);
      const limited = await tab(employee, project.id);
      expect(limited).toEqual({
        state: 'unavailable',
        repository: {
          id: PANEL,
          fullName: 'arma-org/panel',
          url: 'https://github.com/arma-org/panel',
        },
        canLink: true,
        reason: 'rate_limited',
        retryAt: new Date(retryAt).toISOString(),
        last: first.state === 'ok' ? first.lists : null,
      });
      scene.armadx.api.failWith(null);
      scene.armadx.api.clearCalls();
      scene.clock.advance(MINUTE);
      expect((await tab(employee, project.id)).state).toBe('unavailable');
      expect(calls()).toEqual([]);
      scene.clock.ms = retryAt;
      expect((await tab(employee, project.id)).state).toBe('ok');
    });

    it('down: 200 with the last lists for ten minutes at most, never a 500', async () => {
      const project = await open(employee, { repositoryId: PANEL });
      const first = await tab(employee, project.id);
      scene.armadx.api.failWith('unavailable');
      scene.clock.advance(MINUTE);
      const down = await tab(employee, project.id);
      expect(down).toMatchObject({
        state: 'unavailable',
        reason: 'github_down',
        retryAt: null,
        last: first.state === 'ok' ? first.lists : null,
      });
      scene.clock.advance(10 * MINUTE);
      expect(await tab(employee, project.id)).toMatchObject({
        state: 'unavailable',
        reason: 'github_down',
        last: null,
      });
    });

    it('an environment that lost the company’s app says so, and serves nothing', async () => {
      const project = await open(employee, { repositoryId: PANEL });
      await scene.server.close();
      scene = githubScene({ configured: ['pillika'] });
      expect(await tab(employee, project.id)).toEqual({
        state: 'unavailable',
        repository: { id: PANEL, fullName: 'arma-org/panel', url: null },
        canLink: true,
        reason: 'not_configured',
        retryAt: null,
        last: null,
      });
      expect(await list(employee)).toEqual({ state: 'not_connected' });
      const res = await setRepository(employee, project.id, API);
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('github_not_configured');
      // The other company's app was not asked for Arma DX.
      expect(scene.pillika.api.calls).toEqual([]);
    });
  });
});
