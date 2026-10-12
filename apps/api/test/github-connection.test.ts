import { githubConnectionSchema, type GithubConnection } from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SoftwareAuthenticator } from './authenticator.ts';
import { fakeInstallation } from './fake-github.ts';
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
  SESSION_COOKIE,
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
} from './helpers.ts';
import { challengeState, errorCode, freshPasskey, send, type Method } from './passkey-helpers.ts';

// The GitHub connection of a company through the API (8 October decisions 19 and 22; 12 October
// decisions 12 to 15): the founder reads the state, connects with a passkey and switches the
// connection off. GitHub is a fake per company. The tests commit; the GitHub rows are removed
// before every test and at the end of the file.

const CONNECTION = '/api/github/connection';
const SETTLE_MS = 31_000;

describe.skipIf(noDatabase)('the GitHub connection of a company', () => {
  let scene: GithubScene;
  let founder: string;
  let employee: string;
  let external: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);

  beforeAll(async () => {
    const first = githubScene();
    founder = await sessionOf(first.server, accounts.founder);
    employee = await sessionOf(first.server, accounts.employee);
    external = await sessionOf(first.server, accounts.external);
    await freshPasskey(first.server, founder, founderKey, ids.founder, 'Kurucu telefonu');
    await first.server.close();
  });

  // A new server with new fakes for every test; the founder signs in anew (a session holds ten
  // open passkey challenges at most).
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
    session: string,
    method: Method,
    payload?: object,
    company: string = ids.arma,
  ): Promise<LightMyRequestResponse> =>
    send(scene.server, session, method, CONNECTION, { company, ...(payload ? { payload } : {}) });

  async function state(company: string = ids.arma): Promise<GithubConnection> {
    const res = await call(founder, 'GET', undefined, company);
    expect(res.statusCode, res.body).toBe(200);
    return githubConnectionSchema.parse(res.json());
  }

  /** The GitHub rows as they are committed. */
  const rows = () =>
    adminQuery<{
      company_id: string;
      account: string;
      status: string;
      scopes: string[];
      settings: { installation_id: number; account_id: number; app_id: number };
      connected_by_user_id: string | null;
      no_token: boolean;
    }>(
      `select company_id, account, status, scopes, settings, connected_by_user_id,
              encrypted_token is null as no_token
       from office.integrations where provider = 'github' order by account`,
    );

  async function auditMark(): Promise<string> {
    const [row] = await adminQuery<{ mark: string }>(
      'select coalesce(max(id), 0)::text as mark from office.audit_log',
    );
    return row?.mark ?? '0';
  }

  const auditSince = (mark: string) =>
    adminQuery<{ event: string; company_id: string; external_ref: string; user_id: string }>(
      `select event, company_id, external_ref, user_id from office.audit_log
       where id > $1::bigint and event ~ '^github_' order by id`,
      [mark],
    );

  it('is the founder’s: an employee, an external person and nobody are refused on all three', async () => {
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const payload = method === 'POST' ? {} : undefined;
      const asEmployee = await call(employee, method, payload);
      expect(asEmployee.statusCode, method).toBe(403);
      expect(errorCode(asEmployee), method).toBe('founder_only');
      const asExternal = await call(external, method, payload);
      expect(asExternal.statusCode, method).toBe(403);
      expect(errorCode(asExternal), method).toBe('insiders_only');
      const anonymous = await scene.server.app.inject({
        method,
        url: CONNECTION,
        headers: {
          origin: PANEL_ORIGIN,
          'sec-fetch-site': 'same-origin',
          'x-company-id': ids.arma,
        },
        ...(payload ? { payload } : {}),
      });
      expect(anonymous.statusCode, method).toBe(401);
      // The founder of another company with Arma DX in the header is no member of it.
      const stranger = await sessionOf(scene.server, accounts.otherFounder);
      const asStranger = await call(stranger, method, payload);
      expect(asStranger.statusCode, method).toBe(403);
      expect(errorCode(asStranger), method).toBe('forbidden');
      // GitHub is connected to a company, not to the founder space.
      const inSpace = await call(founder, method, payload, ids.founderSpace);
      expect(inSpace.statusCode, method).toBe(409);
      expect(errorCode(inSpace), method).toBe('private_space');
    }
    expect(await rows()).toEqual([]);
    // Nobody who was refused made the API ask GitHub.
    expect(scene.armadx.api.calls).toEqual([]);
    expect(scene.pillika.api.calls).toEqual([]);
  });

  it('a cross-site request connects and disconnects nothing', async () => {
    const stepUp = await signConnection(scene, founder, founderKey, scene.armadx);
    for (const method of ['POST', 'DELETE'] as const) {
      const res = await scene.server.app.inject({
        method,
        url: CONNECTION,
        cookies: { [SESSION_COOKIE]: founder },
        headers: {
          origin: 'https://evil.example.test',
          'sec-fetch-site': 'cross-site',
          'x-company-id': ids.arma,
        },
        payload: { stepUp },
      });
      expect(res.statusCode, method).toBe(403);
      expect(errorCode(res), method).toBe('cross_site_request');
    }
    expect(await rows()).toEqual([]);
  });

  it('not configured: a company without an app in the environment', async () => {
    await scene.server.close();
    scene = githubScene({ configured: ['pillika'] });
    founder = await sessionOf(scene.server, accounts.founder);
    expect(await state()).toEqual({ state: 'not_configured' });
    const res = await call(founder, 'POST', {});
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('github_not_configured');
    // Switching off what is not there changes nothing and is no error.
    const off = await call(founder, 'DELETE');
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ state: 'not_configured' });
    // The other company's app was not asked on behalf of this one.
    expect(scene.pillika.api.calls).toEqual([]);
    expect(await state(ids.pillika)).toMatchObject({ state: 'installed' });
    // A company that has no slot at all.
    const stranger = await sessionOf(scene.server, accounts.otherFounder);
    const other = await send(scene.server, stranger, 'GET', CONNECTION, {
      company: ids.otherCompany,
    });
    expect(other.json()).toEqual({ state: 'not_configured' });
  });

  it('not installed: the page gets the install link, and nothing can be connected', async () => {
    scene.armadx.api.uninstall();
    expect(await state()).toEqual({
      state: 'not_installed',
      organization: 'arma-org',
      installUrl: 'https://github.com/apps/armadx-office/installations/new',
    });
    // An installation on another account is not the organisation's.
    scene.armadx.api.otherInstallations = [
      fakeInstallation(9001, { id: 4242, login: 'stranger', type: 'Organization' }, 7777),
    ];
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toMatchObject({ state: 'not_installed' });
    const stepUp = await signConnection(scene, founder, founderKey, scene.armadx, {
      installationId: 7777,
    });
    const res = await call(founder, 'POST', { stepUp });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('github_not_installed');
    expect(await challengeState(stepUp.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(await rows()).toEqual([]);
  });

  it('an app or an installation that is not what a connection needs is refused, and no passkey is used up', async () => {
    const cases: [string, (company: GithubScene['armadx']) => void][] = [
      [
        'owner_mismatch',
        (company) => {
          company.api.appInfo = {
            ...company.api.appInfo,
            owner: { id: 2001, login: 'pillika-org', type: 'Organization' },
          };
        },
      ],
      [
        'owner_not_organization',
        (company) => {
          company.api.appInfo = {
            ...company.api.appInfo,
            owner: { id: 1001, login: 'arma-org', type: 'User' },
          };
        },
      ],
      [
        'suspended',
        (company) => {
          company.api.suspend();
        },
      ],
      [
        'write_permission',
        (company) => {
          company.api.installation = {
            ...company.installation,
            permissions: { metadata: 'read', contents: 'write' },
          };
        },
      ],
      [
        'other_permission',
        (company) => {
          company.api.installation = {
            ...company.installation,
            permissions: { metadata: 'read', actions: 'read' },
          };
        },
      ],
    ];
    for (const [reason, change] of cases) {
      await scene.server.close();
      scene = githubScene();
      founder = await sessionOf(scene.server, accounts.founder);
      change(scene.armadx);
      const page = await state();
      expect(page, reason).toMatchObject({ state: 'invalid', reason, organization: 'arma-org' });
      if (page.state === 'invalid') {
        // Who owns the app is said only when it is somebody else than expected.
        const owners: Record<string, string> = {
          owner_mismatch: 'pillika-org',
          owner_not_organization: 'arma-org',
        };
        expect(page.actualOwner, reason).toBe(owners[reason] ?? null);
      }
      const stepUp = await signConnection(scene, founder, founderKey, scene.armadx);
      const res = await call(founder, 'POST', { stepUp });
      expect(res.statusCode, reason).toBe(409);
      expect(errorCode(res), reason).toBe('github_installation_invalid');
      expect(await challengeState(stepUp.challengeId), reason).toEqual({
        failed_attempts: 0,
        consumed: false,
      });
    }
    expect(await rows()).toEqual([]);
  });

  it('GitHub cannot be asked: the page says so, and a connect is 503 without using the passkey', async () => {
    scene.armadx.api.failWith('unavailable');
    expect(await state()).toEqual({ state: 'unavailable', reason: 'github_down' });
    const stepUp = await signConnection(scene, founder, founderKey, scene.armadx);
    const res = await call(founder, 'POST', { stepUp });
    expect(res.statusCode).toBe(503);
    expect(errorCode(res)).toBe('github_unavailable');
    expect(await challengeState(stepUp.challengeId)).toMatchObject({ consumed: false });

    scene.armadx.api.failWith('unauthorized', null, 401);
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toEqual({ state: 'unavailable', reason: 'key_refused' });
    expect(scene.log.filter((line) => line.level === 'error')).toEqual([
      {
        level: 'error',
        message: 'GitHub refused the key of the app',
        details: { company: 'armadx', status: 401, requestId: null },
      },
    ]);
    // Never a 500 of our own, and the other company is not held back.
    expect(await state(ids.pillika)).toMatchObject({ state: 'installed' });
    expect(await rows()).toEqual([]);
  });

  it('installed: the page shows what the founder will confirm, for all and for chosen repositories', async () => {
    expect(await state()).toEqual({
      state: 'installed',
      organization: 'arma-org',
      installationId: 5001,
      permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
      repositorySelection: 'all',
      wasConnected: false,
    });
    scene.pillika.api.selectRepositories([900]);
    expect(await state(ids.pillika)).toMatchObject({
      state: 'installed',
      organization: 'pillika-org',
      installationId: 6001,
      repositorySelection: 'selected',
    });
    // Reading the state asked nothing as the installation.
    expect(scene.armadx.api.calls.map((c) => c.method)).toEqual(['app', 'installations']);
  });

  it('connect: asks for the passkey, signed for exactly the organisation and installation shown', async () => {
    const without = await call(founder, 'POST', {});
    expect(without.statusCode).toBe(403);
    expect(errorCode(without)).toBe('step_up_required');

    const wrong: Parameters<typeof signConnection>[4][] = [
      // Another organisation, another installation, another company.
      { organization: 'pillika-org' },
      { installationId: 6001 },
      { companyId: ids.pillika },
    ];
    for (const overrides of wrong) {
      founder = await sessionOf(scene.server, accounts.founder);
      const stepUp = await signConnection(scene, founder, founderKey, scene.armadx, overrides);
      const res = await call(founder, 'POST', { stepUp });
      expect(res.statusCode, JSON.stringify(overrides)).toBe(403);
      expect(errorCode(res), JSON.stringify(overrides)).toBe('step_up_failed');
      expect(await challengeState(stepUp.challengeId)).toEqual({
        failed_attempts: 1,
        consumed: false,
      });
    }
    // The organisation changed between the page and the passkey: the signature does not match.
    founder = await sessionOf(scene.server, accounts.founder);
    const stale = await signConnection(scene, founder, founderKey, scene.armadx);
    scene.armadx.api.install(
      fakeInstallation(9001, { id: 1001, login: 'arma-org', type: 'Organization' }, 5055),
    );
    expect(errorCode(await call(founder, 'POST', { stepUp: stale }))).toBe('step_up_failed');
    // A body with anything else than the re-verification is not read.
    const extra = await call(founder, 'POST', { installationId: 5001 });
    expect(extra.statusCode).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('connect: writes the row and the audit row, and the answer says who connected what', async () => {
    const mark = await auditMark();
    const res = await connectCompany(scene, founder, founderKey, scene.armadx);
    expect(res.statusCode, res.body).toBe(200);
    const answer = githubConnectionSchema.parse(res.json());
    expect(answer).toMatchObject({
      state: 'connected',
      organization: 'arma-org',
      connectedBy: { userId: ids.founder, name: 'Kurucu' },
      permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
      repositorySelection: 'all',
      repositoryCount: 3,
      linkedProjectCount: 0,
      problem: null,
      manageUrl: 'https://github.com/organizations/arma-org/settings/installations/5001',
    });
    expect(await rows()).toEqual([
      {
        company_id: ids.arma,
        account: 'arma-org',
        status: 'enabled',
        scopes: ['metadata:read', 'contents:read', 'pull_requests:read', 'issues:read'],
        settings: expect.objectContaining({
          installation_id: 5001,
          account_id: 1001,
          app_id: 9001,
        }) as unknown,
        connected_by_user_id: ids.founder,
        no_token: true,
      },
    ]);
    expect(await auditSince(mark)).toEqual([
      {
        event: 'github_connected',
        company_id: ids.arma,
        external_ref: 'github:installation:5001',
        user_id: ids.founder,
      },
    ]);
    expect(await state()).toEqual(answer);
    // The answer names nothing of the other company, and its app was not asked.
    expect(res.body).not.toContain('pillika');
    expect(scene.pillika.api.calls).toEqual([]);
    expect(await state(ids.pillika)).toMatchObject({ state: 'installed', wasConnected: false });
  });

  it('connect: an installation on chosen repositories connects too, and the answer says which', async () => {
    scene.armadx.api.selectRepositories([700, 701]);
    scene.armadx.api.installation = {
      ...(scene.armadx.api.installation ?? scene.armadx.installation),
      permissions: { metadata: 'read', contents: 'read' },
    };
    const res = await connectCompany(scene, founder, founderKey, scene.armadx);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      state: 'connected',
      repositorySelection: 'selected',
      repositoryCount: 2,
      permissions: ['metadata', 'contents'],
    });
    expect((await rows())[0]?.scopes).toEqual(['metadata:read', 'contents:read']);
  });

  it('connect: the same installation again needs no passkey and writes no second audit row', async () => {
    expect((await connectCompany(scene, founder, founderKey, scene.armadx)).statusCode).toBe(200);
    const mark = await auditMark();
    // The installation lost a permission on GitHub meanwhile: the row is brought up to date.
    scene.armadx.api.installation = {
      ...scene.armadx.installation,
      permissions: { metadata: 'read', contents: 'read', pull_requests: 'read' },
    };
    const again = await call(founder, 'POST', {});
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({
      state: 'connected',
      permissions: ['metadata', 'contents', 'pull_requests'],
    });
    expect((await rows())[0]?.scopes).toEqual([
      'metadata:read',
      'contents:read',
      'pull_requests:read',
    ]);
    expect(await auditSince(mark)).toEqual([]);
    expect(await rows()).toHaveLength(1);
  });

  it('disconnect: switches this company off, drops what was held, and a second call changes nothing', async () => {
    await connectCompany(scene, founder, founderKey, scene.armadx);
    founder = await sessionOf(scene.server, accounts.founder);
    await connectCompany(scene, founder, founderKey, scene.pillika);
    const mark = await auditMark();

    const off = await call(founder, 'DELETE');
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toEqual({
      state: 'installed',
      organization: 'arma-org',
      installationId: 5001,
      permissions: ['metadata', 'contents', 'pull_requests', 'issues'],
      repositorySelection: 'all',
      wasConnected: true,
    });
    expect((await rows()).map((row) => [row.account, row.status])).toEqual([
      ['arma-org', 'disabled'],
      ['pillika-org', 'enabled'],
    ]);
    expect(scene.armadx.api.forgotten).toEqual([5001]);
    expect(scene.pillika.api.forgotten).toEqual([]);
    expect(await auditSince(mark)).toEqual([
      {
        event: 'github_disconnected',
        company_id: ids.arma,
        external_ref: 'github:installation:5001',
        user_id: ids.founder,
      },
    ]);
    const twice = await call(founder, 'DELETE');
    expect(twice.statusCode).toBe(200);
    expect(await auditSince(mark)).toHaveLength(1);
    // Pillika is connected as before.
    expect(await state(ids.pillika)).toMatchObject({ state: 'connected', problem: null });

    // Connecting again asks for the passkey again and brings the same row back.
    const without = await call(founder, 'POST', {});
    expect(errorCode(without)).toBe('step_up_required');
    founder = await sessionOf(scene.server, accounts.founder);
    const back = await connectCompany(scene, founder, founderKey, scene.armadx);
    expect(back.json()).toMatchObject({ state: 'connected', problem: null });
    expect(await rows()).toHaveLength(2);
    expect((await auditSince(mark)).map((row) => row.event)).toEqual([
      'github_disconnected',
      'github_connected',
    ]);
  });

  it('a connection whose app was removed, suspended or installed again says so, and a read changes nothing', async () => {
    await connectCompany(scene, founder, founderKey, scene.armadx);
    const before = await rows();

    scene.armadx.api.suspend();
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toMatchObject({
      state: 'connected',
      problem: 'suspended',
      repositorySelection: null,
      repositoryCount: null,
    });

    scene.armadx.api.uninstall();
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toMatchObject({ state: 'connected', problem: 'installation_gone' });

    // Installed again: a new installation with a new number, which the row does not name.
    scene.armadx.api.install(
      fakeInstallation(9001, { id: 1001, login: 'arma-org', type: 'Organization' }, 5002),
    );
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toMatchObject({ state: 'connected', problem: 'installation_gone' });
    expect(await rows()).toEqual(before);

    // The founder disconnects and connects again, with the passkey, to the new installation.
    await call(founder, 'DELETE');
    expect(await state()).toMatchObject({
      state: 'installed',
      installationId: 5002,
      wasConnected: true,
    });
    expect(errorCode(await call(founder, 'POST', {}))).toBe('step_up_required');
    founder = await sessionOf(scene.server, accounts.founder);
    const back = await connectCompany(scene, founder, founderKey, scene.armadx);
    expect(back.json()).toMatchObject({ state: 'connected', problem: null, repositoryCount: 3 });
    expect((await rows())[0]?.settings).toMatchObject({ installation_id: 5002 });
  });

  it('a connection that still reads names no problem when the app got more permissions or the organisation another name', async () => {
    await connectCompany(scene, founder, founderKey, scene.armadx);
    const working = { state: 'connected', problem: null, repositoryCount: 3 };
    const widened = (permissions: Record<string, string>) => {
      scene.armadx.api.installation = { ...scene.armadx.installation, permissions };
      scene.clock.advance(SETTLE_MS);
    };
    const read = { metadata: 'read', contents: 'read', pull_requests: 'read', issues: 'read' };

    // The app is given write permissions on GitHub, or a fifth one: a first connect would be
    // refused, but the row's installation keeps reading (the tokens are cut to the four reads).
    for (const permissions of [
      { ...read, contents: 'write', pull_requests: 'write' },
      { ...read, actions: 'read' },
    ]) {
      widened(permissions);
      expect(await state(), JSON.stringify(permissions)).toMatchObject(working);
      const list = await send(scene.server, founder, 'GET', '/api/github/repositories', {
        company: ids.arma,
      });
      expect(list.json()).toMatchObject({ state: 'ok' });
    }
    // What GitHub's page of the installation is, is still told.
    expect(await state()).toMatchObject({ manageUrl: scene.armadx.installation.htmlUrl });

    // The organisation is renamed on GitHub: the slot's name no longer matches.
    widened(read);
    scene.armadx.api.appInfo = {
      ...scene.armadx.api.appInfo,
      owner: { id: 1001, login: 'arma-renamed', type: 'Organization' },
    };
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toMatchObject(working);

    // An app that is no longer the row's (wider permissions AND another installation): no token
    // comes back for the row's installation, and the page says the connection does not work.
    scene.armadx.api.install(
      fakeInstallation(9001, { id: 1001, login: 'arma-renamed', type: 'Organization' }, 5002, {
        permissions: { ...read, contents: 'write' },
      }),
    );
    scene.clock.advance(SETTLE_MS);
    expect(await state()).toMatchObject({
      state: 'connected',
      problem: 'installation_gone',
      repositoryCount: null,
    });
    expect((await rows())[0]?.status).toBe('enabled');
  });

  it('a connected company whose GitHub does not answer keeps its row and names the problem', async () => {
    await connectCompany(scene, founder, founderKey, scene.armadx);
    scene.clock.advance(5 * 60_000);
    scene.armadx.api.failWith('rate_limited', scene.clock.ms + 120_000, 403);
    expect(await state()).toMatchObject({ state: 'connected', problem: 'rate_limited' });
    scene.armadx.api.failWith('unavailable');
    scene.clock.advance(120_000);
    expect(await state()).toMatchObject({
      state: 'connected',
      problem: 'github_down',
      organization: 'arma-org',
    });
    expect((await rows())[0]?.status).toBe('enabled');
  });

  it('a company that was connected to one organisation is not moved to another', async () => {
    await connectCompany(scene, founder, founderKey, scene.armadx);
    await call(founder, 'DELETE');
    // The slot of Arma DX now names another organisation and holds that organisation's app.
    const other = { id: 1002, login: 'other-org', type: 'Organization' };
    await scene.server.close();
    scene = githubScene();
    scene.armadx.api.appInfo = { ...scene.armadx.api.appInfo, owner: other };
    scene.armadx.api.install(fakeInstallation(9001, other, 5003));
    const moved = { ...scene.armadx, organization: 'other-org' };
    await scene.server.close();
    scene = {
      ...scene,
      server: createTestServer({
        github: { armadx: { organization: 'other-org', api: scene.armadx.api } },
        githubNow: scene.clock.now,
      }),
    };
    founder = await sessionOf(scene.server, accounts.founder);
    const stepUp = await signConnection(scene, founder, founderKey, moved);
    const res = await call(founder, 'POST', { stepUp });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorCode(res)).toBe('github_other_organization');
    expect((await rows()).map((row) => [row.account, row.status])).toEqual([
      ['arma-org', 'disabled'],
    ]);
  });

  it('a row written by an administrator names nobody, and the page still reads', async () => {
    await adminExec(`
      insert into office.integrations (company_id, provider, account, scopes, settings, status)
      values ('${companyIdOf(scene.pillika)}', 'github', 'pillika-org', '{metadata:read}',
        '{"installation_id": 6001, "account_id": 2001, "app_id": 9101,
          "connected_at": "2026-10-12T09:00:00+00:00"}', 'enabled');
    `);
    expect(await state(ids.pillika)).toMatchObject({
      state: 'connected',
      connectedBy: null,
      connectedAt: '2026-10-12T09:00:00.000Z',
      repositoryCount: 2,
      problem: null,
    });
  });
});
