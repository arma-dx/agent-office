import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchTheme } from './theme.ts';

function mockSystemPreference(dark: boolean) {
  const listeners: (() => void)[] = [];
  const query = {
    matches: dark,
    addEventListener: (_: string, f: () => void) => listeners.push(f),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    change(next: boolean) {
      query.matches = next;
      for (const f of listeners) f();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watchTheme', () => {
  it('picks the light or dark theme from the system preference and follows changes', () => {
    const preference = mockSystemPreference(false);
    const root = document.createElement('html');
    watchTheme(root);
    expect(root.dataset['theme']).toBe('light');
    preference.change(true);
    expect(root.dataset['theme']).toBe('dark');
  });
});
