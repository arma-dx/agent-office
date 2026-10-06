import { describe, expect, it } from 'vitest';
import { initials } from './utils.ts';

// The letter tile of the company menu and the avatar of the account menu are hidden from the
// accessibility tree, so no screen test reads them.
describe('initials', () => {
  it('takes the first letter of the first and of the last word', () => {
    expect(initials('Arma DX')).toBe('AD');
    expect(initials('Ömer Kadıoğlu')).toBe('ÖK');
    expect(initials('Arma Dijital Teknolojileri')).toBe('AT');
    expect(initials('  Kurucu   alanı ')).toBe('KA');
  });

  it('gives one letter for one word and nothing for an empty name', () => {
    expect(initials('Pillika')).toBe('P');
    expect(initials('  ')).toBe('');
  });

  it('uses Turkish casing: i becomes İ and ı becomes I', () => {
    expect(initials('ikinci istasyon')).toBe('İİ');
    expect(initials('ılık su')).toBe('IS');
  });
});
