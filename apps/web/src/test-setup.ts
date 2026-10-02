import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom matchMedia sağlamaz; tema ve sonner çağırır.
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

// jsdom scrollTo uygulamaz; TanStack Router her gezinmede sayfayı başa kaydırır.
vi.stubGlobal('scrollTo', vi.fn());

// globals kapalı olduğu için Testing Library otomatik temizlik yapmaz.
afterEach(() => {
  cleanup();
});
