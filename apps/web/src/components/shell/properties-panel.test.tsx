import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_STORAGE_KEY } from '@/lib/shell';
import { renderInRouter } from '@/test/render-in-router';
import { blockStorage } from '@/test/storage';
import { ShellProvider } from './app-shell.tsx';
import { PanelRegion, PanelToggle, PropertiesPanel } from './properties-panel.tsx';
import { TopBar } from './top-bar.tsx';

/** A stand-in for a detail page: its properties exist only while the page is on screen. */
function DetailPage({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Sayfadan çık' : 'Sayfayı aç'}
      </button>
      {open ? (
        <PropertiesPanel>
          <p>Durum: Açık</p>
        </PropertiesPanel>
      ) : null}
    </div>
  );
}

/**
 * A stand-in for a page with a selection (the office view): the properties describe the selected
 * thing, and while the window is wide the page asks for the panel itself.
 */
function SelectionPage({ startWide = true }: { startWide?: boolean }) {
  const [selected, setSelected] = useState(false);
  const [wide, setWide] = useState(startWide);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setSelected(!selected);
        }}
      >
        {selected ? 'Seçimi kaldır' : 'Masayı seç'}
      </button>
      <button
        type="button"
        onClick={() => {
          setWide(!wide);
        }}
      >
        {wide ? 'Pencereyi daralt' : 'Pencereyi genişlet'}
      </button>
      {selected ? (
        <PropertiesPanel open={wide}>
          <p>Kod: KOR-1</p>
        </PropertiesPanel>
      ) : null}
    </div>
  );
}

function renderShell(page: boolean | 'not yet open') {
  render(
    <ShellProvider>
      <PanelToggle />
      {page ? <DetailPage startOpen={page === true} /> : null}
      <PanelRegion />
    </ShellProvider>,
  );
}

function renderSelectionPage(startWide = true) {
  render(
    <ShellProvider>
      <PanelToggle />
      <SelectionPage startWide={startWide} />
      <PanelRegion />
    </ShellProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('is on screen in the same paint as the page that fills it', () => {
    localStorage.setItem(PANEL_STORAGE_KEY, 'open');
    renderShell('not yet open');
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    // No act() and no user-event on purpose: both also run the work a browser does after it has
    // painted. What the document holds when this synchronous render returns is what the first
    // paint with the page shows; a page painted without its panel jumps 320 px narrower one frame
    // later.
    flushSync(() => {
      screen.getByRole('button', { name: 'Sayfayı aç' }).click();
    });
    expect(screen.getByRole('button', { name: 'Özellikleri gizle' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toContainElement(
      screen.getByText('Durum: Açık'),
    );
  });

  it('has its toggle in the top bar of the shell', async () => {
    renderInRouter(
      <ShellProvider>
        <TopBar />
        <DetailPage startOpen />
        <PanelRegion />
      </ShellProvider>,
    );
    const bar = await screen.findByRole('banner');
    await userEvent.click(await within(bar).findByRole('button', { name: 'Özellikleri göster' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
  });

  it('opens and closes in a browser that refuses storage', async () => {
    // The choice then lasts until the page is closed.
    blockStorage();
    renderShell(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Özellikleri göster' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Özellikleri gizle' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
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

describe('properties panel: a page that asks for it', () => {
  it('shows while the content exists although the person keeps the panel closed, without a toggle', async () => {
    renderSelectionPage();
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Masayı seç' }));
    const panel = screen.getByRole('complementary', { name: 'Özellikler' });
    expect(panel).toContainElement(screen.getByText('Kod: KOR-1'));
    expect(screen.getByText('Kod: KOR-1')).toBeVisible();
    // The page closes this panel itself; a toggle could hide the detail of a live selection.
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    // The person's choice is neither read nor written.
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Seçimi kaldır' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.queryByText('Kod: KOR-1')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();
  });

  it('is on screen in the same paint as the selection', () => {
    renderSelectionPage();
    // As above: what the document holds when this synchronous render returns is the first paint.
    flushSync(() => {
      screen.getByRole('button', { name: 'Masayı seç' }).click();
    });
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toContainElement(
      screen.getByText('Kod: KOR-1'),
    );
  });

  it('leaves a stored choice as it was', async () => {
    localStorage.setItem(PANEL_STORAGE_KEY, 'open');
    renderSelectionPage();
    await userEvent.click(screen.getByRole('button', { name: 'Masayı seç' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Seçimi kaldır' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe('open');
  });

  it('follows the person again as soon as the page stops asking', async () => {
    renderSelectionPage();
    await userEvent.click(screen.getByRole('button', { name: 'Masayı seç' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();

    // The window became too narrow for the panel beside the page: the content stays registered,
    // the request ends, and the panel is the person's to open, as on every other page.
    await userEvent.click(screen.getByRole('button', { name: 'Pencereyi daralt' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Özellikleri göster' });
    await userEvent.click(toggle);
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe('open');
    await userEvent.click(screen.getByRole('button', { name: 'Özellikleri gizle' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Pencereyi genişlet' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
  });

  it('behaves as on every other page when the content does not ask', async () => {
    renderSelectionPage(false);
    await userEvent.click(screen.getByRole('button', { name: 'Masayı seç' }));
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Özellikleri göster' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('shows in a browser that refuses storage', async () => {
    blockStorage();
    renderSelectionPage();
    await userEvent.click(screen.getByRole('button', { name: 'Masayı seç' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
  });

  it('counts each content on its own: a request ends with the content that made it', async () => {
    // Two pages are never on screen together; this keeps the two counts of the shell honest.
    render(
      <ShellProvider>
        <PanelToggle />
        <DetailPage startOpen />
        <SelectionPage />
        <PanelRegion />
      </ShellProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Özellikleri göster' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Masayı seç' }));
    expect(screen.getByRole('complementary', { name: 'Özellikler' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Özellikleri/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Seçimi kaldır' }));
    // The other content is still registered: the toggle is back, the panel closed as the person left it.
    expect(screen.queryByRole('complementary', { name: 'Özellikler' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Özellikleri göster' })).toBeInTheDocument();
  });
});
