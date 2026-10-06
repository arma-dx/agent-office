import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from './lib/query.ts';
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
  });

  it('walks from the skip link through the sidebar with the Tab key', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    await screen.findByRole('navigation', { name: 'Ana menü' });
    const stops: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      const element = document.activeElement;
      stops.push(element?.getAttribute('aria-label') ?? element?.textContent ?? '');
    }
    expect(stops).toEqual([
      'İçeriğe geç',
      'Şirket: Arma DX. Değiştir',
      'Bugün',
      'Onaylar',
      'Görevler',
      'Notlar',
      'Ajanlar',
      'Hesap: Ömer Kadıoğlu',
    ]);
  });
});

describe('top bar: location', () => {
  it('names the open page as the only h1', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx/tasks');
    const bar = await screen.findByRole('banner');
    const title = await within(bar).findByRole('heading', { level: 1, name: 'Görevler' });
    expect(title).toBeVisible();
    // A name on its own is a title.
    expect(title).toHaveClass('text-[15px]', 'font-semibold');
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
});
