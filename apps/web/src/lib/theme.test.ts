import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { setThemeChoice, startTheme, THEME_STORAGE_KEY } from './theme.ts';

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
  setThemeChoice('system', document.createElement('html'));
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('follows the system preference until the person chooses', () => {
    const preference = mockSystemPreference(false);
    const root = document.createElement('html');
    startTheme(root);
    expect(root.dataset['theme']).toBe('light');
    preference.change(true);
    expect(root.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('keeps an explicit choice whatever the system says, and stores it', () => {
    const preference = mockSystemPreference(true);
    const root = document.createElement('html');
    startTheme(root);
    setThemeChoice('light', root);
    expect(root.dataset['theme']).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    preference.change(false);
    preference.change(true);
    expect(root.dataset['theme']).toBe('light');
  });

  it('starts from the stored choice', () => {
    mockSystemPreference(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const root = document.createElement('html');
    startTheme(root);
    expect(root.dataset['theme']).toBe('dark');
  });

  it('goes back to the system preference and stores nothing for it', () => {
    mockSystemPreference(true);
    const root = document.createElement('html');
    startTheme(root);
    setThemeChoice('light', root);
    setThemeChoice('system', root);
    expect(root.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores a stored value it does not know', () => {
    mockSystemPreference(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    const root = document.createElement('html');
    startTheme(root);
    expect(root.dataset['theme']).toBe('light');
  });

  it('is applied before the first paint by the script in index.html, from the same key', () => {
    // The script cannot import the constant; this keeps the two from drifting apart.
    expect(indexHtml).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(indexHtml).toContain('document.documentElement.dataset.theme = stored');
  });
});
