import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { blockStorage } from '../test/storage.ts';
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
  vi.restoreAllMocks();
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

  it('follows the device in a browser that refuses storage, and still applies a choice', () => {
    mockSystemPreference(false);
    blockStorage();
    const root = document.createElement('html');
    // Without the guards this throws at the top of main.tsx and the panel stays a blank page.
    expect(() => startTheme(root)).not.toThrow();
    expect(root.dataset['theme']).toBe('light');
    expect(() => {
      setThemeChoice('dark', root);
    }).not.toThrow();
    expect(root.dataset['theme']).toBe('dark');
  });
});

// The inline script of index.html puts a stored choice on <html> before the first paint. It cannot
// import anything, so it is run here as the browser runs it.
describe('first paint script (index.html)', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';
  function runScript() {
    // An indirect eval runs the text in the global scope, like a classic script.
    (0, eval)(script);
  }

  afterEach(() => {
    delete document.documentElement.dataset['theme'];
  });

  it('reads the key the theme module writes', () => {
    expect(script).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['sepia', undefined],
    [null, undefined],
  ])('with %s stored, sets data-theme to %s', (stored, expected) => {
    if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
    runScript();
    expect(document.documentElement.dataset['theme']).toBe(expected);
  });

  it('leaves the page to the device when the browser refuses storage', () => {
    blockStorage();
    expect(runScript).not.toThrow();
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });

  it('runs in the head, before the app bundle', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    expect(head).toContain(script);
    expect(script).not.toBe('');
    expect(indexHtml.indexOf('<script>')).toBeLessThan(indexHtml.indexOf('<script type="module"'));
  });
});
