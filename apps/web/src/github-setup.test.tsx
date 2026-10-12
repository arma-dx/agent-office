import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { startInstall } from './lib/github/install.ts';
import { connection, CONNECTION } from './test/github-fixtures.ts';
import { ARMADX, FOUNDER_SPACE, json, mockApi, PILLIKA, sessionHandler } from './test/mock-api.ts';
import { EMPLOYEE_AT_ARMADX, EXTERNAL_AT_ARMADX, sessionAs } from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// /github/setup: where GitHub sends the browser after an installation. The page changes nothing
// and asks the API nothing; it only opens Ayarlar > Bağlantılar of the right company.

const founder = (lastCompanyId: string = ARMADX.companyId) =>
  mockApi({
    'GET /session': sessionHandler({ lastCompanyId }),
    [CONNECTION]: () => json(connection.installed()),
  });

/** The requests the return page itself sent, before the page it opened asked for anything. */
async function arrived(router: ReturnType<typeof renderApp>['router'], pathname: string) {
  await waitFor(() => {
    expect(currentLocation(router)).toEqual({ pathname, search: {} });
  });
}

describe('the return from GitHub', () => {
  it('opens the Bağlantılar page of the company the founder left from, whatever company the session has', async () => {
    const api = founder(ARMADX.companyId);
    startInstall('pillika', 'state-one');
    const { router } = renderApp('/github/setup?installation_id=987654&state=state-one');
    await arrived(router, '/c/pillika/settings/connections');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bağlantılar' })).toBeVisible();
    // The return itself sent nothing about GitHub: the only request is the page's own read, for
    // the company whose page opened.
    await waitFor(() => {
      expect(api.callsTo(CONNECTION)).toHaveLength(1);
    });
    const github = api.calls.filter((call) => call.path.includes('github'));
    expect(github.map((call) => `${call.method} ${call.path}`)).toEqual([CONNECTION]);
    expect(github[0]?.headers.get('x-company-id')).toBe(PILLIKA.companyId);
    // No request of the panel carries the installation number of the address.
    for (const call of api.calls) {
      expect(`${call.path} ${JSON.stringify(call.body ?? null)}`).not.toContain('987654');
    }
    // The stored state is good for one return.
    expect(sessionStorage.getItem('github-install')).toBeNull();
  });

  it('replaces the address, so the query of the return does not stay in the history', async () => {
    founder();
    startInstall('armadx', 'state-one');
    const { router } = renderApp('/github/setup?installation_id=1&state=state-one');
    await arrived(router, '/c/armadx/settings/connections');
    expect(router.history.length).toBe(1);
    expect(router.history.canGoBack()).toBe(false);
  });

  it.each([
    ['another state', '/github/setup?installation_id=1&state=state-two'],
    ['no state at all', '/github/setup?installation_id=1'],
    ['nothing in the address', '/github/setup'],
  ])('with %s it opens the page of the company the session has', async (_what, address) => {
    founder(ARMADX.companyId);
    startInstall('pillika', 'state-one');
    const { router } = renderApp(address);
    await arrived(router, '/c/armadx/settings/connections');
    // A state that did not match is not kept for a second try.
    expect(sessionStorage.getItem('github-install')).toBeNull();
  });

  it('with no stored entry it opens the page of the company the session has', async () => {
    founder(PILLIKA.companyId);
    const { router } = renderApp('/github/setup?installation_id=1&state=state-one');
    await arrived(router, '/c/pillika/settings/connections');
  });

  it('does not follow a stored company the person is no member of', async () => {
    mockApi({
      'GET /session': sessionHandler({ memberships: [ARMADX], lastCompanyId: ARMADX.companyId }),
      [CONNECTION]: () => json(connection.installed()),
    });
    startInstall('pillika', 'state-one');
    const { router } = renderApp('/github/setup?state=state-one');
    await arrived(router, '/c/armadx/settings/connections');
  });

  it('opens Bugün where the Bağlantılar page has nothing for the person', async () => {
    // The founder's private space.
    const space = founder(FOUNDER_SPACE.companyId);
    const first = renderApp('/github/setup?state=x');
    await arrived(first.router, '/c/founder_space');
    expect(space.callsTo(CONNECTION)).toEqual([]);
  });

  it('opens Bugün for an external person and asks nothing of GitHub', async () => {
    const api = mockApi({ 'GET /session': sessionAs(EXTERNAL_AT_ARMADX) });
    const { router } = renderApp('/github/setup?state=x');
    await arrived(router, '/c/armadx');
    expect(api.calls.filter((call) => call.path.includes('github'))).toEqual([]);
  });

  it('shows an employee the page, which says that the founder manages the connection', async () => {
    const api = mockApi({ 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) });
    const { router } = renderApp('/github/setup?state=x');
    await arrived(router, '/c/armadx/settings/connections');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bu işlem için yetkiniz yok. GitHub bağlantısını kurucu yönetir.',
    );
    expect(api.calls.filter((call) => call.path.includes('github'))).toEqual([]);
  });

  it('sends a person who is not signed in to the login screen', async () => {
    mockApi({ 'GET /session': () => new Response(null, { status: 401 }) });
    const { router } = renderApp('/github/setup?state=x');
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe('/login');
    });
  });
});
