import { describe, expect, it } from 'vitest';
import css from './index.css?raw';
import { contrast, readTokens } from './test/contrast.ts';

const TEXT = 4.5;
const GRAPHIC = 3;

const light = readTokens(css, ':root');
const dark = readTokens(css, "[data-theme='dark']");
const firstPaintDark = readTokens(css, ":root:not([data-theme='light'])");
/** The shadcn names of the `:root, [data-theme]` block that point at our tokens. */
const aliases = readTokens(css, '[data-theme]');

const SURFACES = [
  '--surface',
  '--surface-muted',
  '--row-hover',
  '--row-selected',
  '--canvas',
  '--sidebar-hover',
  '--sidebar-selected',
];
/** In the light theme --brand as text is only for these; darker row tones take --brand-active. */
const LIGHT_BRAND_TEXT_SURFACES = ['--surface', '--surface-muted', '--row-hover', '--canvas'];
/**
 * A field (input, select, checkbox, switch track) sits on one of these. Its boundary is below 3:1
 * on --row-selected and on the sidebar row tones, so no field goes there (header of index.css).
 */
const FIELD_SURFACES = ['--surface', '--surface-muted', '--row-hover', '--canvas'];

/** The color roles of the status language: every --status-<tone>-fill names one. */
const STATUS_TONES = Object.keys(light)
  .map((name) => /^--status-(.+)-fill$/.exec(name)?.[1])
  .filter((tone) => tone !== undefined);

const TEXT_TOKENS = [
  '--ink',
  '--ink-secondary',
  '--brand-active',
  '--error',
  ...STATUS_TONES.map((tone) => `--status-${tone}-text`),
];
const GRAPHIC_TOKENS = [
  '--brand',
  '--status-live',
  ...STATUS_TONES.map((tone) => `--status-${tone}`),
];

function color(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`${name} is not defined`);
  return value;
}

/** Every pair below its threshold, as "foreground on background: ratio". */
function failures(
  tokens: Record<string, string>,
  pairs: readonly (readonly [foreground: string, background: string, threshold: number])[],
): string[] {
  return pairs
    .map(([foreground, background, threshold]) => ({
      pair: `${foreground} on ${background}`,
      ratio: contrast(color(tokens, foreground), color(tokens, background)),
      threshold,
    }))
    .filter((result) => result.ratio < result.threshold)
    .map((result) => `${result.pair}: ${result.ratio.toFixed(2)} < ${String(result.threshold)}`);
}

function requiredPairs(theme: 'light' | 'dark') {
  const brandTextSurfaces = theme === 'light' ? LIGHT_BRAND_TEXT_SURFACES : SURFACES;
  return [
    ...TEXT_TOKENS.flatMap((token) => SURFACES.map((surface) => [token, surface, TEXT] as const)),
    ...brandTextSurfaces.map((surface) => ['--brand', surface, TEXT] as const),
    ...GRAPHIC_TOKENS.flatMap((token) =>
      SURFACES.map((surface) => [token, surface, GRAPHIC] as const),
    ),
    ...FIELD_SURFACES.map((surface) => ['--field-border', surface, GRAPHIC] as const),
    ['--on-brand', '--brand', TEXT] as const,
    ['--on-brand', '--brand-active', TEXT] as const,
    // Status badge and inline banner: badge text, icon, body text and a link on the status fill.
    ...STATUS_TONES.flatMap((tone) => [
      [`--status-${tone}-text`, `--status-${tone}-fill`, TEXT] as const,
      [`--status-${tone}`, `--status-${tone}-fill`, GRAPHIC] as const,
      ['--ink', `--status-${tone}-fill`, TEXT] as const,
      ['--ink-secondary', `--status-${tone}-fill`, TEXT] as const,
      ['--brand-active', `--status-${tone}-fill`, TEXT] as const,
    ]),
  ];
}

describe('color tokens (index.css)', () => {
  it('has the seven status tones, each with an icon tone, a fill and a text tone', () => {
    expect(STATUS_TONES).toEqual([
      'open',
      'in-progress',
      'awaiting-approval',
      'awaiting-reply',
      'done',
      'cancelled',
      'error',
    ]);
  });

  it('defines the same tokens in the light and the dark theme', () => {
    const lightNames = Object.keys(light).filter((name) => name !== '--radius');
    expect(Object.keys(dark).sort()).toEqual(lightNames.sort());
  });

  it('repeats the dark values in the first paint block', () => {
    expect(firstPaintDark).toEqual(dark);
  });

  it('gives every color token its Tailwind name, so that no color class is silently missing', () => {
    // Tailwind generates bg-<name>, text-<name> and border-<name> only for names in @theme.
    const names = [
      ...Object.keys(light).filter((name) => name !== '--radius'),
      ...Object.keys(aliases),
    ].map((name) => name.slice(2));
    expect(names.filter((name) => !css.includes(`--color-${name}: var(--${name});`))).toEqual([]);
  });

  it('keeps every text and graphic pair of the light theme at WCAG AA', () => {
    expect(failures(light, requiredPairs('light'))).toEqual([]);
  });

  it('keeps every text and graphic pair of the dark theme at WCAG AA', () => {
    expect(failures(dark, requiredPairs('dark'))).toEqual([]);
  });

  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});
