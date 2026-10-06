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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellProvider } from '@/components/shell/app-shell';
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
