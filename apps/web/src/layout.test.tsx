import { COMPANY_HEADER } from '@agent-office/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ARMADX,
  json,
  mockApi,
  noContent,
  PILLIKA,
  sessionBody,
  sessionHandler,
  USER_ID,
} from './test/mock-api.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

describe('app layout', () => {
  it('shows the Today screen, the empty state text and the skip to content link', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeInTheDocument();
    expect(screen.getByText('Bugün için bir şey yok')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İçeriğe geç' })).toHaveAttribute('href', '#content');
  });

  it('has five tabs in the bottom menu inside the company; the Ofis tab opens the Agents screen', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    const { router } = renderApp('/c/armadx');
    const bottomMenu = await screen.findByRole('navigation', { name: 'Alt menü' });
    const tabs = within(bottomMenu).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Bugün',
      'Onaylar',
      'Görevler',
      'Notlar',
      'Ofis',
    ]);
    expect(tabs.map((t) => t.getAttribute('href'))).toEqual([
      '/c/armadx',
      '/c/armadx/approvals',
      '/c/armadx/tasks',
      '/c/armadx/notes',
      '/c/armadx/agents',
    ]);
    await userEvent.click(within(bottomMenu).getByRole('link', { name: 'Ofis' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajanlar' })).toBeInTheDocument();
    expect(currentLocation(router).pathname).toBe('/c/armadx/agents');
    // Only the open page is marked; "Bugün" is not active on every page.
    expect(within(bottomMenu).getByRole('link', { name: 'Ofis' })).toHaveAttribute(
      'data-status',
      'active',
    );
    expect(within(bottomMenu).getByRole('link', { name: 'Bugün' })).not.toHaveAttribute(
      'data-status',
    );
  });

  it('moves between pages from the menu', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    const mainMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(mainMenu).getByRole('link', { name: 'Onaylar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Onaylar' })).toBeInTheDocument();
    await userEvent.click(within(mainMenu).getByRole('link', { name: 'Görevler' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Görevler' })).toBeInTheDocument();
  });

  it('shows the page not found screen at an unknown path', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bugün ekranına dön' })).toBeInTheDocument();
  });

  it('shows the page not found screen at an unknown page of a company', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument();
  });
});

describe('company switcher', () => {
  it("lists the person's memberships, the private space under Kurucu", async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: /Şirket: Arma DX/ }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent),
    ).toEqual(['Arma DX', 'Pillika', 'Kurucu alanı']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Arma DX' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('opens the same section in the chosen company and remembers it', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'PUT /session/company': () => noContent(),
    });
    const { router } = renderApp('/c/armadx/tasks');
    await userEvent.click(await screen.findByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Pillika' }));
    expect(await screen.findByRole('button', { name: /Şirket: Pillika/ })).toBeInTheDocument();
    expect(currentLocation(router).pathname).toBe('/c/pillika/tasks');
    expect(screen.getByRole('heading', { level: 1, name: 'Görevler' })).toBeInTheDocument();
    await waitFor(() => {
      expect(api.callsTo('PUT /session/company').map((c) => c.body)).toEqual([
        { companyId: PILLIKA.companyId },
      ]);
    });
  });

  it('sends the selected company in the header of company requests', async () => {
    const member = {
      userId: USER_ID,
      name: 'Ömer Kadıoğlu',
      role: 'founder',
      canApprove: true,
      active: true,
    };
    const api = mockApi({
      'GET /session': () => json(sessionBody()),
      'PUT /session/company': () => noContent(),
      'GET /members': () => json({ members: [member] }),
      'GET /invitations': () => json({ invitations: [] }),
    });
    const { router } = renderApp('/c/armadx/settings/users');
    expect(await screen.findByText('Kurucu, onay yetkisi var, etkin')).toBeInTheDocument();
    expect(api.callsTo('GET /members').map((c) => c.headers.get(COMPANY_HEADER))).toEqual([
      ARMADX.companyId,
    ]);

    await userEvent.click(screen.getByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Pillika' }));
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe('/c/pillika/settings/users');
    });
    await waitFor(() => {
      expect(api.callsTo('GET /members').map((c) => c.headers.get(COMPANY_HEADER))).toEqual([
        ARMADX.companyId,
        PILLIKA.companyId,
      ]);
    });
    expect(api.callsTo('GET /invitations').at(-1)?.headers.get(COMPANY_HEADER)).toBe(
      PILLIKA.companyId,
    );
    // Session requests are not tied to a company.
    expect(api.callsTo('GET /session').every((c) => !c.headers.has(COMPANY_HEADER))).toBe(true);
  });
});
