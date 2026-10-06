import { linkOptions } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import { InlineBanner } from './inline-banner.tsx';
import { ListRow } from './list-row.tsx';
import { PageSkeleton } from './page-skeleton.tsx';
import { EmptyState, ErrorMessage } from './states.tsx';
import { TabBar } from './tab-bar.tsx';
import { Tabs, TabsContent } from './ui/tabs.tsx';

describe('ListRow', () => {
  it('is a list item with the title, the subtitle and the trailing part', () => {
    render(
      <ul>
        <ListRow title="Teklif taslağı" subtitle="Arma DX" trailing={<span>12:40</span>} />
      </ul>,
    );
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Teklif taslağı')).toHaveAttribute('title', 'Teklif taslağı');
    expect(within(row).getByText('Arma DX')).toBeVisible();
    expect(within(row).getByText('12:40')).toBeVisible();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('links the title over the whole row and keeps a button in the row apart from it', async () => {
    const link = linkOptions({ to: '/c/$company/tasks', params: { company: 'armadx' } });
    const onApprove = vi.fn();
    renderInRouter(
      <ul>
        <ListRow
          title="Teklif taslağı"
          link={link}
          meta={<span>Arma DX</span>}
          trailing={
            <button type="button" onClick={onApprove}>
              Onayla
            </button>
          }
        />
      </ul>,
    );
    // The link is named by the title alone and covers the row through its ::after.
    const rowLink = await screen.findByRole('link', { name: 'Teklif taslağı' });
    expect(rowLink).toHaveAttribute('href', '/c/armadx/tasks');
    expect(rowLink).toHaveClass('row-link', 'after:absolute', 'after:inset-0');
    const row = screen.getByRole('listitem');
    expect(row).toHaveClass('relative', '[&_button]:relative', '[&_button]:z-10');
    expect(within(row).getAllByRole('link')).toHaveLength(1);
    // A control in the row is not inside the link and gets its own click.
    const approve = within(row).getByRole('button', { name: 'Onayla' });
    expect(rowLink).not.toContainElement(approve);
    await userEvent.click(approve);
    expect(onApprove).toHaveBeenCalledOnce();
  });
});

describe('EmptyState', () => {
  it('shows the title as a heading, the first step and the action', () => {
    render(
      <EmptyState
        variant="page"
        title="Henüz görev yok"
        description="İlk talebi açın."
        action={<button type="button">Yeni talep</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Henüz görev yok' })).toBeVisible();
    expect(screen.getByText('İlk talebi açın.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yeni talep' })).toBeVisible();
  });
});

describe('PageSkeleton', () => {
  it('announces loading once and draws rows as high as a list row', () => {
    const { container } = render(<PageSkeleton />);
    expect(screen.getByRole('status')).toHaveTextContent('Yükleniyor');
    const rows = container.querySelectorAll('.h-9.px-2');
    expect(rows).toHaveLength(7);
  });
});

describe('InlineBanner', () => {
  it('is a note with a title, a body and actions; the icon is decorative', () => {
    const { container } = render(
      <InlineBanner
        tone="warning"
        title="Passkey ekleyin"
        actions={<button type="button">Güvenlik sayfasını aç</button>}
      >
        Önemli onaylar için gerekir.
      </InlineBanner>,
    );
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent('Passkey ekleyin');
    expect(banner).toHaveTextContent('Önemli onaylar için gerekir.');
    expect(within(banner).getByRole('button', { name: 'Güvenlik sayfasını aç' })).toBeVisible();
    expect(banner).toHaveClass('bg-status-open-fill', 'border-status-open');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // With a title the text starts at the top edge of the button beside it.
    expect(screen.getByText('Passkey ekleyin').parentElement).not.toHaveClass('py-1.5');
    expect(container.querySelector('svg')).toHaveClass('mt-0.5');
  });

  it('centres a single line and its icon on the button beside it', () => {
    const { container } = render(
      <InlineBanner tone="danger" actions={<button type="button">Yeniden dene</button>}>
        Liste alınamadı.
      </InlineBanner>,
    );
    // 6 px above the 19 px line and 8 px above the 16 px icon: both on the centre of a 32 px button.
    expect(screen.getByText('Liste alınamadı.').parentElement).toHaveClass('py-1.5');
    expect(container.querySelector('svg')).toHaveClass('mt-2');
  });

  it('keeps a message without a button at the top of its box', () => {
    const { container } = render(<InlineBanner>Önemli onaylar için gerekir.</InlineBanner>);
    expect(screen.getByText('Önemli onaylar için gerekir.').parentElement).not.toHaveClass(
      'py-1.5',
    );
    expect(container.querySelector('svg')).toHaveClass('mt-0.5');
  });

  it('can be an alert, and can leave the icon out', () => {
    const { container } = render(
      <InlineBanner tone="danger" role="alert" icon={false}>
        Kaydedilemedi.
      </InlineBanner>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Kaydedilemedi.');
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('ErrorMessage', () => {
  it('is an alert with the message and a retry button', async () => {
    const onRetry = vi.fn();
    render(<ErrorMessage message="Liste alınamadı." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Liste alınamadı.');
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('TabBar', () => {
  it('switches the section with the mouse and with the arrow keys', async () => {
    render(
      <Tabs defaultValue="pending">
        <TabBar
          label="Onay durumu"
          items={[
            { value: 'pending', label: 'Bekleyen' },
            { value: 'decided', label: 'Karar verilen' },
          ]}
        />
        <TabsContent value="pending">Bekleyen onaylar</TabsContent>
        <TabsContent value="decided">Karar verilen onaylar</TabsContent>
      </Tabs>,
    );
    const tabList = screen.getByRole('tablist', { name: 'Onay durumu' });
    // An inline group without a line of its own, so it can sit in a toolbar row.
    expect(tabList).toHaveClass('inline-flex', 'w-fit');
    expect(tabList).not.toHaveClass('border-b');
    expect(screen.getByRole('tab', { name: 'Bekleyen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Bekleyen onaylar');

    await userEvent.click(screen.getByRole('tab', { name: 'Karar verilen' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Karar verilen onaylar');

    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Bekleyen' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Bekleyen onaylar');
  });
});
