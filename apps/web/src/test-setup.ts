import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, vi } from 'vitest';
import { clearDrafts } from './lib/drafts.ts';

// The first render of a test file loads the whole app (router, route modules, query client). On a
// busy machine that takes longer than the second Testing Library waits by default, and the first
// findBy of a file failed although nothing was wrong. Three seconds stay under the five a test may
// take, so a thing that really is missing is still reported by the query that looked for it.
configure({ asyncUtilTimeout: 3000 });

beforeEach(() => {
  // jsdom does not provide matchMedia; the theme and sonner call it.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  // jsdom does not implement scrollTo; TanStack Router scrolls the page to the top on every navigation.
  vi.stubGlobal('scrollTo', vi.fn());

  // jsdom does not provide ResizeObserver; Radix Switch measures its thumb with it.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        // Sizes never change in jsdom.
      }
      unobserve() {
        // Nothing is observed.
      }
      disconnect() {
        // Nothing is observed.
      }
    },
  );
});

// globals are off, so Testing Library does not clean up automatically. The rendered tree is removed
// first, then every stubbed global (fetch in the app tests) goes back to its original value.
// sonner keeps its toasts in module state and shows them to the next Toaster; they are dismissed so
// that a test never sees the message of the one before.
// Layout and theme choices live in localStorage and unsent texts in sessionStorage; a test never
// starts with the choice or the draft of another.
afterEach(() => {
  cleanup();
  toast.dismiss();
  localStorage.clear();
  // Also the drafts that still wait to be written (lib/drafts.ts keeps them in module state).
  clearDrafts();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
