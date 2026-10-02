import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sorguIstemcisiOlustur } from '@/lib/sorgu';
import { createAppRouter } from './router.tsx';

function uygulamayiAc(adres = '/') {
  const queryClient = sorguIstemcisiOlustur();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [adres] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('ana yerleşim', () => {
  it('Bugün ekranını, boş ekran metnini ve içeriğe geç bağlantısını gösterir', async () => {
    uygulamayiAc('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bugün' })).toBeInTheDocument();
    expect(screen.getByText('Bugün için bir şey yok')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İçeriğe geç' })).toHaveAttribute('href', '#icerik');
  });

  it('alt menüde beş sekme var; Ofis sekmesi Ajanlar ekranını açar', async () => {
    uygulamayiAc('/');
    const altMenu = await screen.findByRole('navigation', { name: 'Alt menü' });
    const sekmeler = within(altMenu).getAllByRole('link');
    expect(sekmeler.map((s) => s.textContent)).toEqual([
      'Bugün',
      'Onaylar',
      'Görevler',
      'Notlar',
      'Ofis',
    ]);
    await userEvent.click(within(altMenu).getByRole('link', { name: 'Ofis' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ajanlar' })).toBeInTheDocument();
  });

  it('menüden sayfalar arasında geçer', async () => {
    uygulamayiAc('/');
    const anaMenu = await screen.findByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(anaMenu).getByRole('link', { name: 'Onaylar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Onaylar' })).toBeInTheDocument();
    await userEvent.click(within(anaMenu).getByRole('link', { name: 'Görevler' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Görevler' })).toBeInTheDocument();
  });

  it('olmayan adreste sayfa bulunamadı ekranını gösterir', async () => {
    uygulamayiAc('/boyle-bir-sayfa-yok');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bugün ekranına dön' })).toBeInTheDocument();
  });

  it('şirket seçiciden şirket değiştirilir', async () => {
    uygulamayiAc('/');
    const secici = await screen.findByRole('button', { name: /Şirket: Arma DX/ });
    await userEvent.click(secici);
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Pillika' }));
    expect(await screen.findByRole('button', { name: /Şirket: Pillika/ })).toBeInTheDocument();
  });
});
