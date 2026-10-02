import { afterEach, describe, expect, it, vi } from 'vitest';
import { temayiIzle } from './tema.ts';

function sistemTercihi(karanlik: boolean) {
  const dinleyiciler: (() => void)[] = [];
  const sorgu = {
    matches: karanlik,
    addEventListener: (_: string, f: () => void) => dinleyiciler.push(f),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => sorgu),
  );
  return {
    degistir(yeni: boolean) {
      sorgu.matches = yeni;
      for (const f of dinleyiciler) f();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('temayiIzle', () => {
  it('sistem tercihine göre açık ya da karanlık temayı seçer ve değişikliği izler', () => {
    const tercih = sistemTercihi(false);
    const kok = document.createElement('html');
    temayiIzle(kok);
    expect(kok.dataset['theme']).toBe('light');
    tercih.degistir(true);
    expect(kok.dataset['theme']).toBe('dark');
  });
});
