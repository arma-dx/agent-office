import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { createAppRouter } from './router.tsx';

function openApp(path = '/') {
  const queryClient = createQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('app layout', () => {
  it('shows the Today screen, the empty state text and the skip to content link', async () => {
    openApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeInTheDocument();
    expect(screen.getByText('Bugün için bir şey yok')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İçeriğe geç' })).toHaveAttribute('href', '#content');
  });

  it('has five tabs in the bottom menu; the Ofis tab opens the Agents screen', async () => {
    openApp('/');
    const bottomMenu = await screen.findByRole('navigation', { name: 'Alt menü' });
    const tabs = within(bottomMenu).getAllByRole('link');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Bugün',
      'Onaylar',
      'Görevler',
      'Notlar',
      'Ofis',
    ]);
    await userEvent.click(within(bottomMenu).getByRole('link', { name: 'Ofis' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajanlar' })).toBeInTheDocument();
  });

  it('moves between pages from the menu', async () => {
    openApp('/');
    const mainMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(mainMenu).getByRole('link', { name: 'Onaylar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Onaylar' })).toBeInTheDocument();
    await userEvent.click(within(mainMenu).getByRole('link', { name: 'Görevler' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Görevler' })).toBeInTheDocument();
  });

  it('shows the page not found screen at an unknown path', async () => {
    openApp('/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bugün ekranına dön' })).toBeInTheDocument();
  });

  it('changes the company from the company switcher', async () => {
    openApp('/');
    const switcher = await screen.findByRole('button', { name: /Şirket: Arma DX/ });
    await userEvent.click(switcher);
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Pillika' }));
    expect(await screen.findByRole('button', { name: /Şirket: Pillika/ })).toBeInTheDocument();
  });
});
