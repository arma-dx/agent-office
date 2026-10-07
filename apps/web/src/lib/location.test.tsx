import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellProvider } from '@/components/shell/app-shell';
import { PageLabel } from '@/components/shell/page-label';
import { TopBar } from '@/components/shell/top-bar';
import { usePageFullBleed } from './location.ts';

/** The frame of the shell as far as these hooks go: the top bar, and a main that says how it is padded. */
function Frame() {
  const fullBleed = usePageFullBleed();
  return (
    <ShellProvider>
      <TopBar />
      <main data-full-bleed={fullBleed ? 'yes' : 'no'}>
        <Outlet />
      </main>
    </ShellProvider>
  );
}

/**
 * The shell's top bar above one page that declares a location and loads data. No route of the app
 * has a loader yet; detail pages will, and their not found and error screens bring their own h1.
 */
function openPage(loader: () => null, fullBleed = false) {
  const root = createRootRoute({ component: Frame });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/page',
    staticData: { location: { label: 'Görev' }, fullBleed },
    loader,
    component: () => <p>Görevin içeriği</p>,
    notFoundComponent: () => <h1>Sayfa bulunamadı</h1>,
    errorComponent: () => <h1>Bu ekran açılamadı</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/page'] }),
  });
  // The top bar reads the matches of whatever router it is in; this one is not the app's.
  render(<RouterProvider router={router as never} />);
}

function headings(): (string | null)[] {
  return screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePageLocation', () => {
  it('names the page that loaded', async () => {
    openPage(() => null);
    expect(await screen.findByText('Görevin içeriği')).toBeInTheDocument();
    expect(headings()).toEqual(['Görev']);
  });

  it('names nothing when the page answers not found', async () => {
    openPage(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's not found signal is not an Error
      throw notFound();
    });
    expect(await screen.findByText('Sayfa bulunamadı')).toBeInTheDocument();
    expect(headings()).toEqual(['Sayfa bulunamadı']);
  });

  it('names nothing when the page fails to load', async () => {
    // React and the router report the failed load on the console; here that is the expected path.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openPage(() => {
      throw new Error('The record could not be read');
    });
    expect(await screen.findByText('Bu ekran açılamadı')).toBeInTheDocument();
    expect(headings()).toEqual(['Bu ekran açılamadı']);
  });
});

describe('usePageFullBleed', () => {
  it('is true for a page that asked for the whole content area, and only for such a page', async () => {
    openPage(() => null, true);
    expect(await screen.findByText('Görevin içeriği')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-full-bleed', 'yes');
  });

  it('is false for a page that did not ask', async () => {
    openPage(() => null);
    expect(await screen.findByText('Görevin içeriği')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-full-bleed', 'no');
  });

  it('is false while such a page answers not found: that screen is an ordinary padded page', async () => {
    openPage(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's not found signal is not an Error
      throw notFound();
    }, true);
    expect(await screen.findByText('Sayfa bulunamadı')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-full-bleed', 'no');
  });

  it('is false while such a page failed to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openPage(() => {
      throw new Error('The record could not be read');
    }, true);
    expect(await screen.findByText('Bu ekran açılamadı')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-full-bleed', 'no');
  });
});

/** A detail page: it belongs to a list page and names its record once the record is known. */
function TaskPage() {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <div>
      {title === null ? null : <PageLabel>{title}</PageLabel>}
      <button
        type="button"
        onClick={() => {
          setTitle(
            title === null ? 'Teklif taslağı' : title === 'Teklif taslağı' ? 'Başka görev' : null,
          );
        }}
      >
        Sonraki
      </button>
    </div>
  );
}

function openDetailPage() {
  const root = createRootRoute({ component: Frame });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/page',
    staticData: {
      location: { label: 'Görev', parent: { label: 'Görevler', to: '/c/$company/tasks' } },
    },
    component: TaskPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/page'] }),
  });
  render(<RouterProvider router={router as never} />);
}

describe('the name of a record in the top bar', () => {
  it('shows the declared label until the record is known, then the name of the record', async () => {
    const user = userEvent.setup();
    openDetailPage();
    const next = await screen.findByRole('button', { name: 'Sonraki' });
    expect(headings()).toEqual(['Görev']);
    // The page the detail page belongs to stands before the name (a link inside a company).
    expect(screen.getByText('Görevler')).toBeInTheDocument();

    await user.click(next);
    expect(headings()).toEqual(['Teklif taslağı']);
    // The next record on the same page replaces the name; the older one does not clear it.
    await user.click(next);
    expect(headings()).toEqual(['Başka görev']);
    // The record is gone (the page shows an error instead): the declared label is back.
    await user.click(next);
    expect(headings()).toEqual(['Görev']);
  });
});
