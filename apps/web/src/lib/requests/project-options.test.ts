import { describe, expect, it } from 'vitest';
import { project } from '../../test/project-fixtures.ts';
import { projectOptions } from './project-options.ts';

const ID = (n: number) => `a${String(n)}111111-1111-4111-8111-111111111111`;
/** An open project where agents may work, without a customer. */
const open = (n: number, name: string, overrides: Parameters<typeof project>[0] = {}) =>
  project({
    id: ID(n),
    name,
    aiAllowed: true,
    agentsMayWork: true,
    customer: null,
    ...overrides,
  });

describe('what the request form offers under Proje', () => {
  it('offers open projects by name in Turkish order and leaves closed ones out', () => {
    const options = projectOptions([
      open(1, 'Şube açılışı'),
      open(2, 'Zam duyurusu'),
      open(3, 'İhale dosyası'),
      open(4, 'Çağrı merkezi'),
      open(5, 'Cari mutabakat'),
      // Closed projects take no request (completed or cancelled).
      open(6, 'Arşiv taşıma', { status: 'completed', closed: true }),
      open(7, 'Ilgaz deposu'),
    ]);
    // Turkish order: C before Ç, I before İ, S before Ş; a plain code point order would put the
    // dotted and cedilla letters after Z.
    expect(options.map((option) => option.label)).toEqual([
      'Cari mutabakat',
      'Çağrı merkezi',
      'Ilgaz deposu',
      'İhale dosyası',
      'Şube açılışı',
      'Zam duyurusu',
    ]);
    expect(options.every((option) => !option.disabled)).toBe(true);
    expect(options.map((option) => option.id)).not.toContain(ID(6));
    // The name kept with a draft is the project's own.
    expect(options[0]).toEqual({
      id: ID(5),
      name: 'Cari mutabakat',
      label: 'Cari mutabakat',
      disabled: false,
    });
  });

  it('a project where agents may not work is offered disabled, with the reason in its label', () => {
    const options = projectOptions([
      open(1, 'Lansman'),
      // Its own permission is closed.
      open(2, 'Depo otomasyonu', { aiAllowed: false, agentsMayWork: false }),
      // Its own permission is open and its customer's contract is not: rule 12 as a whole.
      open(3, 'Rota planı', {
        aiAllowed: true,
        agentsMayWork: false,
        customer: { id: 'c1111111-1111-4111-8111-111111111111', name: 'Beta Lojistik' },
      }),
    ]);
    expect(options).toEqual([
      {
        id: ID(2),
        name: 'Depo otomasyonu',
        label: 'Depo otomasyonu (ajanlar çalışamaz)',
        disabled: true,
      },
      { id: ID(1), name: 'Lansman', label: 'Lansman', disabled: false },
      { id: ID(3), name: 'Rota planı', label: 'Rota planı (ajanlar çalışamaz)', disabled: true },
    ]);
  });

  it('two projects of one name are told apart by their customer', () => {
    const beta = { id: 'c1111111-1111-4111-8111-111111111111', name: 'Beta Lojistik' };
    const options = projectOptions([
      open(2, 'Lansman', { customer: beta, aiAllowed: false, agentsMayWork: false }),
      open(1, 'Lansman'),
      open(3, 'Rota planı', { customer: beta }),
      // A closed namesake is not offered and does not make the open one ambiguous.
      open(4, 'Rota planı', { status: 'cancelled', closed: true }),
    ]);
    expect(options.map((option) => [option.label, option.name, option.disabled])).toEqual([
      // The same name: by id, so the order never changes between two readings.
      ['Lansman (müşteri yok)', 'Lansman', false],
      ['Lansman (Beta Lojistik) (ajanlar çalışamaz)', 'Lansman', true],
      ['Rota planı', 'Rota planı', false],
    ]);
  });

  it('offers nothing when no project is open', () => {
    expect(projectOptions([])).toEqual([]);
    expect(projectOptions([open(1, 'Eski iş', { status: 'completed', closed: true })])).toEqual([]);
  });
});
