import { BACKGROUND_HEADER, COMPANY_HEADER, stepUpSchema } from '@agent-office/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, json, ARMADX, PILLIKA } from '../../test/mock-api.ts';
import {
  CONNECT,
  connection,
  CONNECTION,
  DISCONNECT,
  projectGithubRoute,
  REFRESH_REPOSITORIES,
  removeRepositoryRoute,
  repositories,
  REPOSITORIES,
  setRepositoryRoute,
  tab,
} from '../../test/github-fixtures.ts';
import { PROJECT_ID, projectDetail } from '../../test/project-fixtures.ts';
import { signed, challengeId } from '../../test/passkeys.ts';
import {
  connectGithub,
  disconnectGithub,
  fetchGithubRepositories,
  fetchProjectGithub,
  githubConnectionKey,
  githubConnectionQueryOptions,
  githubKey,
  githubRepositoriesKey,
  projectGithubKey,
  removeProjectRepository,
  setProjectRepository,
} from './query.ts';
import { projectKey } from '../projects/query.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const queryContext = { signal: new AbortController().signal } as never;

describe('the requests of the GitHub connection', () => {
  it('begins every key with the company, so one company never shows what was read for the other', () => {
    const arma = ARMADX.companyId;
    expect(githubConnectionKey(arma).slice(0, 3)).toEqual(githubKey(arma));
    expect(githubRepositoriesKey(arma).slice(0, 3)).toEqual(githubKey(arma));
    expect(githubKey(arma)).toEqual(['company', arma, 'github']);
    expect(githubConnectionKey(PILLIKA.companyId)).not.toEqual(githubConnectionKey(arma));
    // The tab of a project is under the project: what reads the project again reads it again.
    expect(projectGithubKey(arma, PROJECT_ID).slice(0, 4)).toEqual(projectKey(arma, PROJECT_ID));
  });

  it('asks for the connection of the selected company and of no other', async () => {
    const api = mockApi({ [CONNECTION]: () => json(connection.connected()) });
    const answer = await githubConnectionQueryOptions(PILLIKA.companyId).queryFn?.(queryContext);
    expect(answer).toEqual(connection.connected());
    const [call] = api.callsTo(CONNECTION);
    expect(call?.headers.get(COMPANY_HEADER)).toBe(PILLIKA.companyId);
    expect(api.calls).toHaveLength(1);
  });

  it('refuses an answer that is not the contract, for example an install link outside github.com', async () => {
    mockApi({
      [CONNECTION]: () =>
        json({
          state: 'not_installed',
          organization: 'arma-org',
          installUrl: 'https://example.org/apps/x/installations/new',
        }),
    });
    await expect(
      githubConnectionQueryOptions(ARMADX.companyId).queryFn?.(queryContext),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('connects with the signed re-verification in the body and disconnects with no body', async () => {
    const api = mockApi({
      [CONNECT]: () => json(connection.connected()),
      [DISCONNECT]: () => json(connection.installed({ wasConnected: true })),
    });
    const stepUp = stepUpSchema.parse(signed(challengeId(1)));
    await expect(connectGithub(ARMADX.companyId, stepUp)).resolves.toMatchObject({
      state: 'connected',
    });
    expect(api.callsTo(CONNECT)[0]?.body).toEqual({ stepUp });
    await expect(disconnectGithub(ARMADX.companyId)).resolves.toMatchObject({
      state: 'installed',
    });
    expect(api.callsTo(DISCONNECT)[0]?.body).toBeUndefined();
    for (const call of api.calls) {
      expect(call.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    }
  });

  it('reads the repository list, and again from GitHub only when asked to', async () => {
    const api = mockApi({
      [REPOSITORIES]: () => json(repositories()),
      [REFRESH_REPOSITORIES]: () => json(repositories()),
    });
    await fetchGithubRepositories(ARMADX.companyId);
    await fetchGithubRepositories(ARMADX.companyId, { refresh: false });
    expect(api.callsTo(REPOSITORIES)).toHaveLength(2);
    expect(api.callsTo(REFRESH_REPOSITORIES)).toHaveLength(0);
    await fetchGithubRepositories(ARMADX.companyId, { refresh: true });
    expect(api.callsTo(REFRESH_REPOSITORIES)).toHaveLength(1);
  });

  it('marks only the periodic read of the tab as a background request', async () => {
    const api = mockApi({ [projectGithubRoute()]: () => json(tab.ok()) });
    await fetchProjectGithub(ARMADX.companyId, PROJECT_ID);
    await fetchProjectGithub(ARMADX.companyId, PROJECT_ID, { background: true });
    const [byPerson, onTimer] = api.callsTo(projectGithubRoute());
    expect(byPerson?.headers.has(BACKGROUND_HEADER)).toBe(false);
    expect(onTimer?.headers.get(BACKGROUND_HEADER)).toBe('1');
  });

  it("names a repository by GitHub's number alone, and takes it away with no body", async () => {
    const linked = projectDetail({ repository: { id: 102, fullName: 'arma-org/panel' } });
    const api = mockApi({
      [setRepositoryRoute()]: () => json(linked),
      [removeRepositoryRoute()]: () => json(projectDetail()),
    });
    await expect(setProjectRepository(ARMADX.companyId, PROJECT_ID, 102)).resolves.toEqual(linked);
    expect(api.callsTo(setRepositoryRoute())[0]?.body).toEqual({ repositoryId: 102 });
    await removeProjectRepository(ARMADX.companyId, PROJECT_ID);
    expect(api.callsTo(removeRepositoryRoute())[0]?.body).toBeUndefined();
  });

  it('sends nothing for a project id or a repository number of another shape', async () => {
    const api = mockApi({});
    expect(() => fetchProjectGithub(ARMADX.companyId, '../session')).toThrow();
    expect(() => setProjectRepository(ARMADX.companyId, PROJECT_ID, 0)).toThrow();
    expect(() => setProjectRepository(ARMADX.companyId, PROJECT_ID, 1.5)).toThrow();
    expect(() => removeProjectRepository(ARMADX.companyId, 'x')).toThrow();
    await Promise.resolve();
    expect(api.calls).toEqual([]);
  });
});
