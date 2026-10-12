import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  githubConnectionDetails,
  githubConnectionSchema,
  githubRepositoriesSchema,
  projectDetailSchema,
  projectGithubSchema,
  type GithubConnection,
  type ProjectDetail,
  type ProjectGithub,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpGithubApi } from '../src/github/http.ts';
import { SoftwareAuthenticator } from './authenticator.ts';
import { fakeCommit, fakeRepository } from './fake-github.ts';
import { accounts, ids } from './fixtures.ts';
import {
  clearGithub,
  companyIdOf,
  connectCompany,
  githubScene,
  signConnection,
  type GithubScene,
} from './github-helpers.ts';
import {
  PANEL_ORIGIN,
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
} from './helpers.ts';
import {
  challengeState,
  errorCode,
  freshPasskey,
  send,
  signStepUp,
  type Method,
} from './passkey-helpers.ts';

// The GitHub connections of the two companies, held apart on every path (12 October decision 12:
// Arma DX and Pillika connect as two separate organisations; rule 2). The founder is the founder
// of both and walks every path in both; each company has its own fake, so every case can assert
// on the fake that must stay silent. The tests commit: the GitHub rows are removed before every
// test and at the end of the file.

const MINUTE = 60_000;
const PANEL = 700;
const SHOP = 900;

describe.skipIf(noDatabase)('the GitHub connections of the two companies', () => {
  let scene: GithubScene;
  let founder: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);

  beforeAll(async () => {
    const first = githubScene();
    founder = await sessionOf(first.server, accounts.founder);
    await freshPasskey(first.server, founder, founderKey, ids.founder, 'Kurucu telefonu');
    await first.server.close();
  });

  beforeEach(async () => {
    await clearGithub();
    scene = githubScene();
    founder = await sessionOf(scene.server, accounts.founder);
  });

  afterEach(async () => {
    await scene.server.close();
  });

  afterAll(async () => {
    await clearGithub();
    await closeAdminPool();
  });

  const call = (
    method: Method,
    url: string,
    company: string,
    payload?: object,
  ): Promise<LightMyRequestResponse> =>
    send(scene.server, founder, method, url, { company, ...(payload ? { payload } : {}) });

  async function connection(company: string): Promise<GithubConnection> {
    const res = await call('GET', '/api/github/connection', company);
    expect(res.statusCode, res.body).toBe(200);
    return githubConnectionSchema.parse(res.json());
  }

  /** Connects a company; the founder signs in anew first (ten open challenges a session). */
  async function connect(company: GithubScene['armadx']): Promise<LightMyRequestResponse> {
    founder = await sessionOf(scene.server, accounts.founder);
    return connectCompany(scene, founder, founderKey, company);
  }

  async function connectBoth(): Promise<void> {
    expect((await connect(scene.armadx)).statusCode).toBe(200);
    expect((await connect(scene.pillika)).statusCode).toBe(200);
    scene.armadx.api.clearCalls();
    scene.pillika.api.clearCalls();
  }

  async function open(company: string, body: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const res = await call('POST', '/api/projects', company, {
      id: randomUUID(),
      name: 'İki şirket projesi',
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return projectDetailSchema.parse(res.json());
  }

  async function tab(company: string, projectId: string): Promise<ProjectGithub> {
    const res = await call('GET', `/api/projects/${projectId}/github`, company);
    expect(res.statusCode, res.body).toBe(200);
    return projectGithubSchema.parse(res.json());
  }

  async function names(company: string): Promise<string[] | string> {
    const res = await call('GET', '/api/github/repositories', company);
    const answer = githubRepositoriesSchema.parse(res.json());
    return answer.state === 'ok' ? answer.repositories.map((r) => r.fullName) : answer.state;
  }

  const rows = () =>
    adminQuery<{ company_id: string; account: string; status: string }>(
      `select company_id, account, status from office.integrations
       where provider = 'github' order by account`,
    );

  it('each company is connected by itself, with a passkey of its own', async () => {
    const arma = await connect(scene.armadx);
    expect(arma.statusCode, arma.body).toBe(200);
    // Pillika is as it was: installed, not connected, and nothing of Arma DX is in its answer.
    const before = await call('GET', '/api/github/connection', ids.pillika);
    expect(before.json()).toEqual({
      state: 'installed',
      organization: 'pillika-org',
      installationId: 6001,
      permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
      repositorySelection: 'all',
      wasConnected: false,
    });
    expect(before.body).not.toContain('arma');
    expect(await names(ids.pillika)).toBe('not_connected');

    // A re-verification made for Arma DX does not connect Pillika, whatever it was signed for.
    for (const overrides of [
      { companyId: ids.arma },
      { companyId: ids.arma, organization: 'pillika-org', installationId: 6001 },
    ]) {
      founder = await sessionOf(scene.server, accounts.founder);
      const stepUp = await signConnection(scene, founder, founderKey, scene.armadx, overrides);
      const refused = await call('POST', '/api/github/connection', ids.pillika, { stepUp });
      expect(refused.statusCode).toBe(403);
      expect(errorCode(refused)).toBe('step_up_failed');
    }
    expect(errorCode(await call('POST', '/api/github/connection', ids.pillika, {}))).toBe(
      'step_up_required',
    );
    expect(await rows()).toEqual([
      { company_id: ids.arma, account: 'arma-org', status: 'enabled' },
    ]);

    const pillika = await connect(scene.pillika);
    expect(pillika.statusCode, pillika.body).toBe(200);
    expect(pillika.json()).toMatchObject({
      state: 'connected',
      organization: 'pillika-org',
      repositoryCount: 2,
    });
    expect(pillika.body).not.toContain('arma');
    expect(await rows()).toEqual([
      { company_id: ids.arma, account: 'arma-org', status: 'enabled' },
      { company_id: ids.pillika, account: 'pillika-org', status: 'enabled' },
    ]);
    // Each connection is in its own company's audit log.
    const audit = await adminQuery<{ company_id: string; external_ref: string }>(
      `select company_id, external_ref from office.audit_log
       where event = 'github_connected' order by id desc limit 2`,
    );
    expect(audit).toEqual([
      { company_id: ids.pillika, external_ref: 'github:installation:6001' },
      { company_id: ids.arma, external_ref: 'github:installation:5001' },
    ]);
  });

  it('a request of one company never asks the other company’s app', async () => {
    await connectBoth();
    scene.clock.advance(5 * MINUTE);
    expect(await names(ids.arma)).toEqual(['arma-org/api', 'arma-org/archive', 'arma-org/panel']);
    expect(scene.pillika.api.calls).toEqual([]);
    scene.armadx.api.clearCalls();
    expect(await names(ids.pillika)).toEqual(['pillika-org/shop', 'pillika-org/stations']);
    expect(scene.armadx.api.calls).toEqual([]);

    const arma = await open(ids.arma, { repositoryId: PANEL });
    const pillika = await open(ids.pillika, { repositoryId: SHOP });
    scene.armadx.api.clearCalls();
    scene.pillika.api.clearCalls();
    await connection(ids.arma);
    await tab(ids.arma, arma.id);
    expect(scene.pillika.api.calls).toEqual([]);
    scene.armadx.api.clearCalls();
    await connection(ids.pillika);
    await tab(ids.pillika, pillika.id);
    expect(scene.armadx.api.calls).toEqual([]);
  });

  it('a project of one company is not given a repository of the other organisation', async () => {
    await connectBoth();
    // At opening.
    const id = randomUUID();
    const refused = await call('POST', '/api/projects', ids.pillika, {
      id,
      name: 'Yanlış depo',
      repositoryId: PANEL,
    });
    expect(refused.statusCode).toBe(409);
    expect(errorCode(refused)).toBe('github_repository_not_available');
    expect(await adminQuery('select 1 from office.projects where id = $1', [id])).toEqual([]);
    // Afterwards, in both directions.
    const pillika = await open(ids.pillika);
    const arma = await open(ids.arma);
    for (const [company, project, repositoryId] of [
      [ids.pillika, pillika.id, PANEL],
      [ids.arma, arma.id, SHOP],
    ] as const) {
      const res = await call('PUT', `/api/projects/${project}/repository`, company, {
        repositoryId,
      });
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('github_repository_not_available');
    }
    expect(await adminQuery('select 1 from office.project_repositories')).toEqual([]);
    // The project of one company does not exist for a request of the other.
    for (const [company, project] of [
      [ids.pillika, arma.id],
      [ids.arma, pillika.id],
    ] as const) {
      expect(
        (await call('PUT', `/api/projects/${project}/repository`, company, { repositoryId: SHOP }))
          .statusCode,
      ).toBe(404);
      expect((await call('GET', `/api/projects/${project}/github`, company)).statusCode).toBe(404);
    }
    // Asked of its own app only: the number of the other organisation was looked for in the
    // list of this company's installation, and nowhere else.
    expect(scene.armadx.api.calls.every((entry) => entry.installationId === 5001)).toBe(true);
    expect(scene.pillika.api.calls.every((entry) => entry.installationId === 6001)).toBe(true);
  });

  it('the lists one company read are never served to the other, also for one and the same number', async () => {
    await connectBoth();
    // Pillika's organisation has a repository with the very number of Arma DX's "panel".
    const twin = fakeRepository(scene.pillika.owner, PANEL, 'twin');
    scene.pillika.api.addRepository(twin, { commits: [fakeCommit(twin, 9, 'pillika-person')] });
    scene.clock.advance(5 * MINUTE);
    const arma = await open(ids.arma, { repositoryId: PANEL });
    const pillika = await open(ids.pillika, { repositoryId: PANEL });

    const armaTab = await tab(ids.arma, arma.id);
    scene.armadx.api.clearCalls();
    const pillikaTab = await tab(ids.pillika, pillika.id);
    expect(armaTab).toMatchObject({ state: 'ok', repository: { fullName: 'arma-org/panel' } });
    expect(pillikaTab).toMatchObject({ state: 'ok', repository: { fullName: 'pillika-org/twin' } });
    expect(
      pillikaTab.state === 'ok' && pillikaTab.lists.commits?.items.map((row) => row.author),
    ).toEqual(['pillika-person']);
    expect(JSON.stringify(pillikaTab)).not.toContain('arma-org');
    expect(JSON.stringify(armaTab)).not.toContain('pillika');
    // Read again within the minute: each company gets its own cached lists.
    expect(await tab(ids.arma, arma.id)).toEqual(armaTab);
    expect(await tab(ids.pillika, pillika.id)).toEqual(pillikaTab);
    expect(scene.armadx.api.calls).toEqual([]);
  });

  it('a rate limit, a switched-off connection and a removed app of one company leave the other reading', async () => {
    await connectBoth();
    const arma = await open(ids.arma, { repositoryId: PANEL });
    const pillika = await open(ids.pillika, { repositoryId: SHOP });
    expect((await tab(ids.arma, arma.id)).state).toBe('ok');
    expect((await tab(ids.pillika, pillika.id)).state).toBe('ok');

    // Rate limited in Arma DX: no call there until the reset, and Pillika still reads.
    const retryAt = scene.clock.ms + 10 * MINUTE;
    scene.armadx.api.failWith('rate_limited', retryAt, 403);
    scene.clock.advance(MINUTE);
    expect(await tab(ids.arma, arma.id)).toMatchObject({
      state: 'unavailable',
      reason: 'rate_limited',
    });
    scene.armadx.api.failWith(null);
    scene.armadx.api.clearCalls();
    scene.pillika.api.clearCalls();
    scene.clock.advance(MINUTE);
    expect((await tab(ids.arma, arma.id)).state).toBe('unavailable');
    expect((await tab(ids.pillika, pillika.id)).state).toBe('ok');
    expect(scene.armadx.api.calls).toEqual([]);
    expect(scene.pillika.api.countOf('commits')).toBe(1);
    expect(await connection(ids.pillika)).toMatchObject({ state: 'connected', problem: null });

    // Arma DX is switched off: Pillika's tab works and holds what it held.
    scene.clock.ms = retryAt;
    const off = await call('DELETE', '/api/github/connection', ids.arma);
    expect(off.statusCode).toBe(200);
    expect(scene.pillika.api.forgotten).toEqual([]);
    scene.pillika.api.clearCalls();
    expect((await tab(ids.pillika, pillika.id)).state).toBe('ok');
    expect((await tab(ids.arma, arma.id)).state).toBe('not_connected');
    expect(await rows()).toEqual([
      { company_id: ids.arma, account: 'arma-org', status: 'disabled' },
      { company_id: ids.pillika, account: 'pillika-org', status: 'enabled' },
    ]);

    // The app of Pillika is removed on GitHub: Arma DX, connected again, reads.
    expect((await connect(scene.armadx)).statusCode).toBe(200);
    scene.pillika.api.uninstall();
    scene.clock.advance(5 * MINUTE);
    expect(await tab(ids.pillika, pillika.id)).toMatchObject({
      state: 'unavailable',
      reason: 'installation_gone',
      last: null,
    });
    expect((await tab(ids.arma, arma.id)).state).toBe('ok');
    expect(await names(ids.arma)).toHaveLength(3);
  });

  it('one company configured and the other not: the other is "not configured" everywhere', async () => {
    await scene.server.close();
    scene = githubScene({ configured: ['armadx'] });
    founder = await sessionOf(scene.server, accounts.founder);
    expect((await connectCompany(scene, founder, founderKey, scene.armadx)).statusCode).toBe(200);
    scene.armadx.api.clearCalls();

    expect(await connection(ids.pillika)).toEqual({ state: 'not_configured' });
    expect(errorCode(await call('POST', '/api/github/connection', ids.pillika, {}))).toBe(
      'github_not_configured',
    );
    // Its project form gets no repository to pick.
    expect(await names(ids.pillika)).toBe('not_connected');
    const refused = await call('POST', '/api/projects', ids.pillika, {
      id: randomUUID(),
      name: 'Depolu proje',
      repositoryId: PANEL,
    });
    expect(refused.statusCode).toBe(409);
    expect(errorCode(refused)).toBe('github_not_connected');
    const project = await open(ids.pillika);
    expect(await tab(ids.pillika, project.id)).toEqual({
      state: 'not_connected',
      disconnected: false,
      canLink: false,
    });
    // Nothing of this was asked of the app that IS configured: it is the other company's.
    expect(scene.armadx.api.calls).toEqual([]);
    expect(scene.pillika.api.calls).toEqual([]);
  });

  it('a row that names an installation of the other company’s app gives nothing', async () => {
    // An administrator wrote Pillika a row with the installation and the organisation of Arma
    // DX's app (or the two slots were exchanged after connecting).
    await adminExec(`
      insert into office.integrations (company_id, provider, account, scopes, settings, status)
      values ('${companyIdOf(scene.pillika)}', 'github', 'arma-org', '{metadata:read,contents:read}',
        '{"installation_id": 5001, "account_id": 1001, "app_id": 9001,
          "connected_at": "2026-10-12T09:00:00+00:00"}', 'enabled');
    `);
    const project = await open(ids.pillika);
    await adminExec(`
      insert into office.project_repositories
        (company_id, project_id, integration_id, repository_id, full_name)
      select company_id, '${project.id}', id, ${String(PANEL)}, 'arma-org/panel'
      from office.integrations where provider = 'github';
    `);
    // The app of Pillika is given no token for an installation that is not its own: no list.
    expect(await tab(ids.pillika, project.id)).toEqual({
      state: 'unavailable',
      repository: { id: PANEL, fullName: 'arma-org/panel', url: null },
      canLink: true,
      reason: 'installation_gone',
      retryAt: null,
      last: null,
    });
    expect(await names(ids.pillika)).toBe('unavailable');
    expect(await connection(ids.pillika)).toMatchObject({
      state: 'connected',
      problem: 'installation_gone',
      repositoryCount: null,
    });
    // The app of Arma DX, which could read that installation, was never asked.
    expect(scene.armadx.api.calls).toEqual([]);
    expect(scene.pillika.api.calls.some((entry) => entry.method === 'commits')).toBe(false);
  });

  it('one organisation is the connection of one company only', async () => {
    // A set-up the environment refuses (two slots that name one organisation), built directly:
    // both companies hold the app of Arma DX's organisation.
    await scene.server.close();
    const slot = { organization: 'arma-org', api: scene.armadx.api };
    scene = {
      ...scene,
      server: createTestServer({
        github: { armadx: slot, pillika: slot },
        githubNow: scene.clock.now,
      }),
    };
    expect((await connect(scene.armadx)).statusCode).toBe(200);
    founder = await sessionOf(scene.server, accounts.founder);
    const stepUp = await signConnection(scene, founder, founderKey, scene.armadx, {
      companyId: ids.pillika,
    });
    const second = await call('POST', '/api/github/connection', ids.pillika, { stepUp });
    expect(second.statusCode, second.body).toBe(409);
    expect(errorCode(second)).toBe('github_organization_taken');
    // Nothing was written, and the refused attempt did not use the passkey up.
    expect(await rows()).toEqual([
      { company_id: ids.arma, account: 'arma-org', status: 'enabled' },
    ]);
    expect(await challengeState(stepUp.challengeId)).toMatchObject({ consumed: false });
  });
});

// The same routes over the real HTTP client of one app and a recorded GitHub, to see what leaves
// the API: no answer of any route of this step and no log line holds the installation token, the
// app's signature or a piece of its private key.
describe.skipIf(noDatabase)('nothing secret of GitHub leaves the API', () => {
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);

  afterAll(async () => {
    await clearGithub();
    await closeAdminPool();
  });

  it('answers and log lines hold no token, no signature and no key', async () => {
    await clearGithub();
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    // Made here: no line of the repository holds the shape of a token.
    const token = ['installation', 'token', randomUUID()].join('-');
    const bearers = new Set<string>();
    const paths: string[] = [];
    let failing = false;
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-github-request-id': 'AB12:CD34' },
      });
    const owner = { id: 1001, login: 'arma-org', type: 'Organization' };
    const installation = {
      id: 5001,
      app_id: 9001,
      account: owner,
      target_type: 'Organization',
      suspended_at: null,
      permissions: { metadata: 'read', contents: 'read', pull_requests: 'read', issues: 'read' },
      repository_selection: 'all',
      html_url: 'https://github.com/organizations/arma-org/settings/installations/5001',
    };
    const recorded: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      bearers.add(new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '');
      paths.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      const path = url.pathname;
      if (failing && path.startsWith('/repos/')) {
        return Promise.resolve(json({ message: `Bad credentials for ${token}` }, 500));
      }
      if (path === '/app') {
        return Promise.resolve(json({ id: 9001, slug: 'arma-office', owner }));
      }
      if (path === '/app/installations') {
        return Promise.resolve(json([installation]));
      }
      if (path === '/app/installations/5001') {
        return Promise.resolve(json(installation));
      }
      if (path === '/app/installations/5001/access_tokens') {
        return Promise.resolve(
          json({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201),
        );
      }
      if (path === '/installation/repositories') {
        return Promise.resolve(
          json({
            total_count: 1,
            repositories: [
              {
                id: PANEL,
                name: 'panel',
                full_name: 'arma-org/panel',
                private: true,
                archived: false,
                default_branch: 'main',
                html_url: 'https://github.com/arma-org/panel',
                owner,
              },
            ],
          }),
        );
      }
      if (path === '/repos/arma-org/panel/commits') {
        return Promise.resolve(
          json([
            {
              sha: 'c'.repeat(40),
              commit: {
                message: 'A change',
                author: {
                  name: 'Ayşe Kaya',
                  email: 'ayse@example.test',
                  date: '2026-10-11T08:00:00Z',
                },
              },
              author: { login: 'ayse-k' },
              html_url: `https://github.com/arma-org/panel/commit/${'c'.repeat(40)}`,
            },
          ]),
        );
      }
      return Promise.resolve(json([]));
    };
    const lines: string[] = [];
    const server = createTestServer({
      logStream: { write: (line) => lines.push(line) },
      github: {
        armadx: {
          organization: 'arma-org',
          api: new HttpGithubApi(
            {
              companyCode: 'armadx',
              organization: 'arma-org',
              clientId: 'Iv23client-arma',
              privateKey: pair.privateKey,
            },
            {
              fetch: recorded,
              log: {
                warn: (details, message) => lines.push(JSON.stringify({ details, message })),
                error: (details, message) => lines.push(JSON.stringify({ details, message })),
              },
            },
          ),
        },
      },
      githubLog: {
        warn: (details, message) => lines.push(JSON.stringify({ details, message })),
        error: (details, message) => lines.push(JSON.stringify({ details, message })),
      },
    });
    try {
      const founder = await sessionOf(server, accounts.founder);
      await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
      const bodies: string[] = [];
      const ask = async (method: Method, url: string, payload?: object): Promise<string> => {
        const res = await send(server, founder, method, url, {
          company: ids.arma,
          ...(payload ? { payload } : {}),
        });
        bodies.push(res.body, JSON.stringify(res.headers));
        return res.body;
      };
      await ask('GET', '/api/github/connection');
      const stepUp = await signStepUp(server, founder, founderKey, {
        purpose: 'github_connection',
        companyId: ids.arma,
        subjectId: ids.arma,
        details: githubConnectionDetails('arma-org', 5001),
      });
      const connected = await send(server, founder, 'POST', '/api/github/connection', {
        company: ids.arma,
        payload: { stepUp },
      });
      expect(connected.statusCode, connected.body).toBe(200);
      bodies.push(connected.body);
      await ask('GET', '/api/github/connection');
      await ask('GET', '/api/github/repositories');
      const id = randomUUID();
      await ask('POST', '/api/projects', { id, name: 'Sır aranan proje', repositoryId: PANEL });
      const tabBody = await ask('GET', `/api/projects/${id}/github`);
      expect(projectGithubSchema.parse(JSON.parse(tabBody))).toMatchObject({ state: 'ok' });
      await ask('PUT', `/api/projects/${id}/repository`, { repositoryId: PANEL });
      await ask('DELETE', `/api/projects/${id}/repository`);
      await ask('PUT', `/api/projects/${id}/repository`, { repositoryId: PANEL });
      // A failing GitHub whose error text quotes the token.
      failing = true;
      const other = randomUUID();
      await ask('POST', '/api/projects', { id: other, name: 'İkinci', repositoryId: PANEL });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await ask('DELETE', '/api/github/connection');

      // The requests went out as the app and as the installation.
      expect(paths).toContain('POST /app/installations/5001/access_tokens');
      expect(bearers.has(token)).toBe(true);
      expect(bearers.size).toBeGreaterThan(1);
      const text = [...bodies, ...lines].join('\n');
      for (const secret of bearers) {
        expect(secret.length).toBeGreaterThan(10);
        expect(text.includes(secret)).toBe(false);
      }
      // No piece of the key, in either form it can be written.
      const pem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
      const pieces = pem
        .split('\n')
        .filter((line) => line.length === 64)
        .slice(0, 5);
      expect(pieces).toHaveLength(5);
      for (const piece of pieces) {
        expect(text.includes(piece)).toBe(false);
      }
      expect(text).not.toContain('PRIVATE KEY');
      // Nor what the client never takes from a commit.
      expect(text).not.toContain('example.test');
      expect(text).not.toContain('Ayşe Kaya');
      // The author's GitHub user name is there (12 October decision 16).
      expect(tabBody).toContain('ayse-k');
      // The server did write log lines for these requests.
      expect(lines.length).toBeGreaterThan(5);
    } finally {
      await server.close();
    }
  });
});
