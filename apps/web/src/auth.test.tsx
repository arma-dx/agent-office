import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  ARMADX,
  FOUNDER_SPACE,
  json,
  mockApi,
  noContent,
  PILLIKA,
  sessionBody,
  sessionHandler,
} from './test/mock-api.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

const unauthorized = () =>
  apiError(401, 'unauthenticated', 'Oturumunuz kapalı. Yeniden giriş yapın.');

describe('authenticated layout', () => {
  it('shows the loading state while the session is checked', async () => {
    mockApi({ 'GET /session': () => new Promise<Response>(() => undefined) });
    renderApp('/c/armadx');
    expect(await screen.findByRole('status')).toHaveTextContent('Yükleniyor');
  });

  it('opens the plain login screen on a first visit without a session', async () => {
    mockApi({ 'GET /session': unauthorized });
    const { router } = renderApp('/c/armadx/tasks');
    expect(await screen.findByRole('link', { name: 'Google ile giriş yap' })).toBeVisible();
    expect(currentLocation(router)).toEqual({ pathname: '/login', search: {} });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the session closed when a request is refused while the panel is open', async () => {
    let signedIn = true;
    mockApi({
      'GET /session': () => (signedIn ? json(sessionBody()) : unauthorized()),
      'GET /members': () => {
        // The server closed the session (30 minutes idle); every request now answers 401.
        signedIn = false;
        return unauthorized();
      },
      'GET /invitations': () => json({ invitations: [] }),
    });
    const { router } = renderApp('/c/armadx/settings/users');
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({
        pathname: '/login',
        search: { status: 'expired' },
      });
    });
    expect(await screen.findByText(/^Oturumunuz kapandı\./)).toBeVisible();
  });

  it('shows a retry when the session cannot be checked', async () => {
    let attempts = 0;
    mockApi({
      'GET /session': () => {
        attempts += 1;
        return attempts === 1
          ? apiError(429, 'rate_limited', 'Çok sık denendi.')
          : json(sessionBody());
      },
    });
    renderApp('/c/armadx');
    expect(await screen.findByRole('alert')).toHaveTextContent('Çok sık denendi.');
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeVisible();
  });
});

describe('access changed while the panel is open', () => {
  it('drops a company the person was removed from when the switch is refused', async () => {
    let memberships = [ARMADX, PILLIKA];
    const api = mockApi({
      'GET /session': () => json(sessionBody({ memberships })),
      'PUT /session/company': () => {
        // The founder removed this person from Pillika after the panel loaded the session.
        memberships = [ARMADX];
        return apiError(
          403,
          'forbidden',
          'Bu şirkete erişim yetkiniz yok. Şirket seçimini denetleyin.',
        );
      },
    });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: PILLIKA.name }));
    // The refused request makes the panel fetch the session again; Pillika is gone from it.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeVisible();
    expect(api.callsTo('GET /session').length).toBeGreaterThan(1);
  });
});

describe('home redirect', () => {
  it('opens the remembered company', async () => {
    mockApi({ 'GET /session': sessionHandler({ lastCompanyId: PILLIKA.companyId }) });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/c/pillika');
    expect(screen.getByRole('button', { name: /Şirket: Pillika/ })).toBeVisible();
  });

  it('opens the only company straight away', async () => {
    mockApi({
      'GET /session': sessionHandler({ memberships: [ARMADX], lastCompanyId: null }),
    });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/c/armadx');
  });

  it('shows the picker for several companies and remembers the choice', async () => {
    const api = mockApi({
      'GET /session': sessionHandler({ lastCompanyId: null }),
      'PUT /session/company': () => noContent(),
    });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Şirket seçin' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/companies');
    const links = screen.getAllByRole('link', { name: /Arma DX|Pillika|Kurucu alanı/ });
    expect(links.map((l) => l.querySelector('span')?.textContent)).toEqual([
      'Arma DX',
      'Pillika',
      'Kurucu alanı',
    ]);
    await userEvent.click(screen.getByRole('link', { name: /Pillika/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/c/pillika');
    await waitFor(() => {
      expect(api.callsTo('PUT /session/company').map((c) => c.body)).toEqual([
        { companyId: PILLIKA.companyId },
      ]);
    });
  });

  it('ignores a remembered company the person is no longer a member of', async () => {
    mockApi({
      'GET /session': sessionHandler({
        memberships: [ARMADX, FOUNDER_SPACE],
        lastCompanyId: PILLIKA.companyId,
      }),
    });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Şirket seçin' })).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/companies');
  });

  it('shows the not found screen for a company the person is not a member of', async () => {
    mockApi({ 'GET /session': sessionHandler({ memberships: [ARMADX] }) });
    renderApp('/c/pillika/tasks');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Şirket:/ })).not.toBeInTheDocument();
  });
});

describe('sign out', () => {
  async function openUserMenu() {
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    return screen.findByRole('menu');
  }

  it('shows the person in the menu, signs out and confirms on the login screen', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'POST /auth/logout': () => noContent(),
    });
    const { router, queryClient } = renderApp('/c/armadx');
    const menu = await openUserMenu();
    expect(within(menu).getByText('Ömer Kadıoğlu')).toBeVisible();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Çıkış yap' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Çıkış yaptınız.');
    expect(currentLocation(router)).toEqual({
      pathname: '/login',
      search: { status: 'signed_out' },
    });
    expect(api.callsTo('POST /auth/logout')).toHaveLength(1);
    // Nothing from the closed session stays in memory.
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('closes every session', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'POST /auth/logout-all': () => noContent(),
    });
    const { router } = renderApp('/c/armadx');
    const menu = await openUserMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Bütün oturumları kapat' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Çıkış yaptınız.');
    expect(currentLocation(router).search).toEqual({ status: 'signed_out' });
    expect(api.callsTo('POST /auth/logout-all')).toHaveLength(1);
    expect(api.callsTo('POST /auth/logout')).toHaveLength(0);
  });

  it('treats an already closed session as signed out', async () => {
    mockApi({ 'GET /session': sessionHandler(), 'POST /auth/logout': unauthorized });
    const { router } = renderApp('/c/armadx');
    const menu = await openUserMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Çıkış yap' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Çıkış yaptınız.');
    expect(currentLocation(router).search).toEqual({ status: 'signed_out' });
  });

  it('stays on the page and says why when signing out fails', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'POST /auth/logout': () =>
        apiError(500, 'internal_error', 'Çıkış yapılamadı. Yeniden deneyin.'),
    });
    const { router } = renderApp('/c/armadx');
    const menu = await openUserMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Çıkış yap' }));
    expect(await screen.findByText('Çıkış yapılamadı. Yeniden deneyin.')).toBeVisible();
    expect(currentLocation(router).pathname).toBe('/c/armadx');
  });
});
