import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createQueryClient } from './lib/query.ts';
import { PROPERTIES_PANEL_ID, SIDEBAR_STORAGE_KEY } from './lib/shell.ts';
import { setThemeChoice, THEME_STORAGE_KEY } from './lib/theme.ts';
import { createAppRouter } from './router.tsx';
import { json, mockApi, sessionHandler } from './test/mock-api.ts';
import { renderApp } from './test/render-app.tsx';

describe('app shell: regions and keyboard order', () => {
  it('has the sidebar, the top bar and the content as landmarks', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    expect(await screen.findByRole('complementary', { name: 'Kenar çubuğu' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'content');
    // No page uses the properties panel yet: it takes no space and has no toggle.
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    // The region is in the frame all the same, hidden, for the first page that fills it.
    const panel = document.getElementById(PROPERTIES_PANEL_ID);
    expect(panel).toBeInTheDocument();
    expect(panel).not.toBeVisible();
  });

  it('lets the skip link move the focus into the content', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    await screen.findByRole('navigation', { name: 'Ana menü' });
    // A main without tabindex cannot take the focus: the link would scroll the page and leave the
    // focus where it was.
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('tabindex', '-1');
    main.focus();
    expect(main).toHaveFocus();
  });

  it('walks from the skip link through the sidebar to the top bar with the Tab key', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    await screen.findByRole('navigation', { name: 'Ana menü' });
    const stops: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab();
      const element = document.activeElement;
      stops.push(element?.getAttribute('aria-label') ?? element?.textContent ?? '');
    }
    expect(stops).toEqual([
      'İçeriğe geç',
      'Şirket: Arma DX. Değiştir',
      'Yeni talep',
      'Bugün',
      'Onaylar',
      'Talepler',
      'Görevler',
      'Notlar',
      'Ofis görünümü',
      'Ajanlar',
      'Hesap: Ömer Kadıoğlu',
      'Kenar çubuğunu gizle',
    ]);
  });

  it('pads the content of every page except one that fills the content area itself', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /office': () => json({ units: [] }),
    });
    const { router } = renderApp('/c/armadx/tasks');
    await screen.findByRole('heading', { level: 1, name: 'Görevler' });
    const main = screen.getByRole('main');
    expect(main).toHaveClass('p-6');

    // The office view is its own canvas: it reaches the edges of the content area.
    await router.navigate({ to: '/c/$company/office', params: { company: 'armadx' } });
    await screen.findByRole('heading', { level: 1, name: 'Ofis görünümü' });
    expect(main).not.toHaveClass('p-6');

    // The not found screen is an ordinary page, also at an address below the office.
    await router.navigate({ to: '/c/armadx/office/x' as never });
    await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' });
    expect(screen.getByRole('main')).toHaveClass('p-6');

    await router.navigate({ to: '/c/armadx/no-such-page' as never });
    await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' });
    expect(screen.getByRole('main')).toHaveClass('p-6');
  });

  it('hides and shows the sidebar from the top bar and remembers the choice', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    const hide = await screen.findByRole('button', { name: 'Kenar çubuğunu gizle' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    const bar = screen.getByRole('banner');
    // The company is named by the company menu; the top bar does not repeat it.
    expect(within(bar).queryByText('Arma DX')).toBeNull();

    await userEvent.click(hide);
    expect(screen.queryByRole('navigation', { name: 'Ana menü' })).toBeNull();
    const show = screen.getByRole('button', { name: 'Kenar çubuğunu göster' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveFocus();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('closed');
    // Without the company menu the top bar says which company the person is in.
    expect(within(bar).getByText('Arma DX')).toBeVisible();
    expect(within(bar).getByRole('heading', { level: 1, name: 'Bugün' })).toBeVisible();

    // The next visit starts the way the person left it.
    cleanup();
    renderApp('/c/armadx');
    expect(
      await screen.findByRole('button', { name: 'Kenar çubuğunu göster' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Ana menü' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Kenar çubuğunu göster' }));
    expect(screen.getByRole('navigation', { name: 'Ana menü' })).toBeInTheDocument();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
    expect(within(screen.getByRole('banner')).queryByText('Arma DX')).toBeNull();
  });
});

describe('top bar: location', () => {
  it('names the open page as the only h1', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx/tasks');
    const bar = await screen.findByRole('banner');
    const title = await within(bar).findByRole('heading', { level: 1, name: 'Görevler' });
    expect(title).toBeVisible();
    // A name on its own is a title: 15 px at the default font size, in rem so that it grows with
    // the browser's font size setting like the rest of the page.
    expect(title).toHaveClass('text-[0.9375rem]', 'font-semibold');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it.each([
    ['/c/armadx', 'Bugün'],
    ['/c/armadx/approvals', 'Onaylar'],
    ['/c/armadx/tasks', 'Görevler'],
    ['/c/armadx/notes', 'Notlar'],
    ['/c/armadx/office', 'Ofis görünümü'],
    ['/c/armadx/agents', 'Ajanlar'],
    ['/c/armadx/settings/users', 'Kullanıcılar'],
    ['/c/armadx/settings/security', 'Güvenlik'],
  ])('gives %s one h1, the name in the top bar', async (path, name) => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /passkeys': () => json({ passkeys: [] }),
      'GET /members': () => json({ members: [] }),
      'GET /invitations': () => json({ invitations: [] }),
      'GET /office': () => json({ units: [] }),
    });
    renderApp(path);
    const bar = await screen.findByRole('banner');
    expect(await within(bar).findByRole('heading', { level: 1, name })).toBeVisible();
    // The page's own code loads apart from the route's declaration; count once it is on screen.
    await waitFor(() => {
      expect(screen.getByRole('main')).not.toBeEmptyDOMElement();
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows the group before the page on a settings page', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /passkeys': () => json({ passkeys: [] }),
    });
    renderApp('/c/armadx/settings/security');
    const bar = await screen.findByRole('banner');
    const title = await within(bar).findByRole('heading', { level: 1, name: 'Güvenlik' });
    expect(title).toBeVisible();
    expect(within(bar).getByText('Ayarlar')).toBeVisible();
    // At the end of a trail the name takes the trail's type.
    expect(title).toHaveClass('text-sm', 'font-medium');
  });

  it('is declared by every page under a company', () => {
    // The top bar draws the only h1 of a page from staticData.location; a route that forgets it
    // would compile and render without a heading.
    const router = createAppRouter({ queryClient: createQueryClient() });
    const routes = router.routesById;
    const ids = Object.keys(routes) as (keyof typeof routes)[];
    // A route with children is a layout, not a page.
    const pages = ids
      .filter((id) => id.startsWith('/_authed/c/$company/') && !routes[id].children)
      .map((id) => ({ id, label: routes[id].options.staticData?.location?.label }));
    expect(pages.map((page) => page.id)).toEqual(
      expect.arrayContaining([
        '/_authed/c/$company/',
        '/_authed/c/$company/approvals',
        '/_authed/c/$company/tasks',
        '/_authed/c/$company/notes',
        '/_authed/c/$company/office',
        '/_authed/c/$company/agents',
        '/_authed/c/$company/settings/users',
        '/_authed/c/$company/settings/security',
      ]),
    );
    expect(pages.filter((page) => !page.label).map((page) => page.id)).toEqual([]);
  });

  it('shows an unknown page of a company inside the shell, with the menu', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Ana menü' })).toBeInTheDocument();
  });

  it.each(['/c/armadx/tasks/123', '/c/armadx/settings/security/x'])(
    'leaves the heading to the not found screen at %s, an address below a known page',
    async (path) => {
      mockApi({ 'GET /session': sessionHandler() });
      renderApp(path);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
      ).toBeInTheDocument();
      // The page route still matches by prefix; the bar must not name it above the screen's h1.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('banner').textContent).toBe('');
    },
  );
});

describe('menus: focus ring', () => {
  afterEach(() => {
    delete document.documentElement.dataset['input'];
  });

  it('marks the page with the last kind of input, for the ring of a menu used with the mouse', async () => {
    // index.css leaves the keyboard ring out of menu rows and menu buttons under
    // data-input="pointer" (design-rules.test.ts checks the rule); any key brings it back.
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: /Şirket: Arma DX/ }));
    await screen.findByRole('menu');
    expect(document.documentElement.dataset['input']).toBe('pointer');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.documentElement.dataset['input']).toBe('keyboard');
  });
});

describe('account menu: theme', () => {
  afterEach(() => {
    setThemeChoice('system');
  });

  it('offers system, light and dark, applies the choice at once and stores it', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    const menu = await screen.findByRole('menu');
    // The group carries the name: "Açık" alone is also the word for an open task.
    const group = within(menu).getByRole('group', { name: 'Tema' });
    const choices = within(group).getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual(['Sistem', 'Açık', 'Koyu']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Sistem' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Koyu' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Koyu' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('is offered outside a company too', async () => {
    mockApi({ 'GET /session': sessionHandler({ lastCompanyId: null }) });
    renderApp('/companies');
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap: Ömer Kadıoğlu' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Açık' })).toBeInTheDocument();
  });
});
