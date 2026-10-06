import { COMPANY_HEADER, type MembershipSummary } from '@agent-office/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ARMADX,
  FOUNDER_SPACE,
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

  it('lists the menu in the sidebar in groups and marks only the open page', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    const { router } = renderApp('/c/armadx');
    const mainMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    const links = within(mainMenu).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Bugün',
      'Onaylar',
      'Görevler',
      'Notlar',
      'Ofis görünümü',
      'Ajanlar',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/c/armadx',
      '/c/armadx/approvals',
      '/c/armadx/tasks',
      '/c/armadx/notes',
      '/c/armadx/office',
      '/c/armadx/agents',
    ]);
    const work = within(mainMenu).getByRole('list', { name: 'İş' });
    expect(
      within(work)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Görevler', 'Notlar']);
    const office = within(mainMenu).getByRole('list', { name: 'Ofis' });
    expect(
      within(office)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Ofis görünümü', 'Ajanlar']);

    await userEvent.click(within(mainMenu).getByRole('link', { name: 'Ajanlar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajanlar' })).toBeInTheDocument();
    expect(currentLocation(router).pathname).toBe('/c/armadx/agents');
    // Only the open page is marked; "Bugün" is not active on every page.
    expect(within(mainMenu).getByRole('link', { name: 'Ajanlar' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(mainMenu).getByRole('link', { name: 'Bugün' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('keeps the menu rows in the company of the URL', async () => {
    // Arma DX is the first membership and the remembered company; the address is in Pillika.
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/pillika/tasks');
    const mainMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    expect(
      within(mainMenu)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/c/pillika',
      '/c/pillika/approvals',
      '/c/pillika/tasks',
      '/c/pillika/notes',
      '/c/pillika/office',
      '/c/pillika/agents',
    ]);
    expect(within(mainMenu).getByRole('link', { name: 'Görevler' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not offer the office view to an external person, and keeps the other rows', async () => {
    const external: MembershipSummary = { ...ARMADX, role: 'external', canApprove: false };
    mockApi({ 'GET /session': sessionHandler({ memberships: [external, PILLIKA] }) });
    const { router } = renderApp('/c/armadx');
    const mainMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    const rows = () =>
      within(mainMenu)
        .getAllByRole('link')
        .map((link) => link.textContent);
    expect(rows()).toEqual(['Bugün', 'Onaylar', 'Görevler', 'Notlar', 'Ajanlar']);
    expect(
      within(within(mainMenu).getByRole('list', { name: 'Ofis' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Ajanlar']);

    // The role belongs to the membership: in a company where the person is a founder the row is there.
    await router.navigate({ to: '/c/$company', params: { company: 'pillika' } });
    await waitFor(() => {
      expect(rows()).toContain('Ofis görünümü');
    });
  });

  it('keeps a row selected on an address below its page, and only that row', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx/tasks/123');
    const mainMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    expect(
      within(mainMenu)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent),
    ).toEqual(['Görevler']);
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
    // Outside a company the button opens the start page, which picks the company.
    expect(screen.getByRole('link', { name: 'Bugün ekranına dön' })).toHaveAttribute('href', '/');
  });

  it('shows the page not found screen at an unknown page of a company', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument();
  });

  it('goes back to Today in the company of the URL, not in the remembered one', async () => {
    // Opened by address in Pillika while the remembered company is Arma DX.
    mockApi({ 'GET /session': sessionHandler({ lastCompanyId: ARMADX.companyId }) });
    const { router } = renderApp('/c/pillika/no-such-page');
    const back = await screen.findByRole('link', { name: 'Bugün ekranına dön' });
    expect(back).toHaveAttribute('href', '/c/pillika');
    await userEvent.click(back);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeInTheDocument();
    expect(currentLocation(router).pathname).toBe('/c/pillika');
    expect(screen.getByRole('button', { name: /Şirket: Pillika/ })).toBeInTheDocument();
  });

  it('opens the start page from the not found screen of an unknown company', async () => {
    mockApi({ 'GET /session': sessionHandler({ memberships: [ARMADX] }) });
    renderApp('/c/pillika/tasks');
    expect(await screen.findByRole('link', { name: 'Bugün ekranına dön' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

describe('company switcher', () => {
  it("lists the person's memberships, the private space under Kurucu", async () => {
    // The private space comes first in the session: the menu groups by kind, not by order.
    mockApi({
      'GET /session': sessionHandler({ memberships: [FOUNDER_SPACE, ARMADX, PILLIKA] }),
    });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: /Şirket: Arma DX/ }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent),
    ).toEqual(['Arma DX', 'Pillika', 'Kurucu alanı']);
    // Both group labels, each above its own rows.
    expect(menu.textContent).toBe('ŞirketArma DXPillikaKurucuKurucu alanı');
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
