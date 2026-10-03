import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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

// globals are off, so Testing Library does not clean up automatically.
afterEach(() => {
  cleanup();
});
