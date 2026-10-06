import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PANEL_STORAGE_KEY } from '@/lib/shell';
import { ShellProvider } from './app-shell.tsx';
import { PanelRegion, PanelToggle, PropertiesPanel } from './properties-panel.tsx';

/** A stand-in for a detail page: its properties exist only while the page is on screen. */
function DetailPage() {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
        }}
      >
        Sayfadan çık
      </button>
      {open ? (
        <PropertiesPanel>
          <p>Durum: Açık</p>
        </PropertiesPanel>
      ) : null}
    </div>
  );
}

function renderShell(withPage: boolean) {
  render(
    <ShellProvider>
      <PanelToggle />
      {withPage ? <DetailPage /> : null}
      <PanelRegion />
    </ShellProvider>,
  );
}

describe('properties panel', () => {
  it('has no toggle and no region while no page uses it', () => {
    renderShell(false);
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
  });

  it('is closed by default; the toggle opens it with the content of the page', async () => {
    renderShell(true);
    const toggle = await screen.findByRole('button', { name: 'Özellikleri göster' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.getByText('Durum: Açık')).not.toBeVisible();

    await userEvent.click(toggle);
    const panel = screen.getByRole('complementary', { name: 'Özellikler' });
    expect(panel).toContainElement(screen.getByText('Durum: Açık'));
    expect(screen.getByText('Durum: Açık')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Özellikler' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Özellikleri gizle' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe('open');

    await userEvent.click(screen.getByRole('button', { name: 'Özellikleri gizle' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();
  });

  it('starts open when the person left it open', async () => {
    localStorage.setItem(PANEL_STORAGE_KEY, 'open');
    renderShell(true);
    expect(await screen.findByRole('complementary', { name: 'Özellikler' })).toBeVisible();
  });

  it('goes away with the page that filled it', async () => {
    localStorage.setItem(PANEL_STORAGE_KEY, 'open');
    renderShell(true);
    expect(await screen.findByRole('complementary', { name: 'Özellikler' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sayfadan çık' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    expect(screen.queryByText('Durum: Açık')).toBeNull();
  });
});
