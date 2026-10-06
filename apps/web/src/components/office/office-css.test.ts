import { describe, expect, it } from 'vitest';
import indexCss from '@/index.css?raw';
import { OVERLAY } from '@/lib/office/overlay';
import { readTokens } from '@/test/contrast';
import viewSource from './office-view.tsx?raw';
import css from './office.css?raw';

// jsdom applies no stylesheet, so the look of the scene cannot be seen at work in a test. It was
// looked at in a browser; these checks keep the rules that carry a design rule from being dropped
// or loosened unnoticed. They read the text of office.css without its comments.
const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  /** The selectors of the rule, one per item of its selector list. */
  selectors: string[];
  /** The at-rule the rule stands in, or null. */
  media: string | null;
  declarations: Map<string, string>;
}

/** Splits at a separator character that is not inside parentheses. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part !== '');
}

/** The rules of a stylesheet in source order; the rules inside an at-rule carry its prelude. */
function parse(text: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let index = 0;
  for (;;) {
    const open = text.indexOf('{', index);
    if (open === -1) return rules;
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth > 0) {
      if (text[close] === '{') depth++;
      else if (text[close] === '}') depth--;
      close++;
    }
    const prelude = text.slice(index, open).replace(/\s+/g, ' ').trim();
    const body = text.slice(open + 1, close - 1);
    if (prelude.startsWith('@')) {
      rules.push(...parse(body, prelude));
    } else {
      const declarations = new Map<string, string>();
      for (const declaration of splitTop(body, ';')) {
        const colon = declaration.indexOf(':');
        declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
      rules.push({ selectors: splitTop(prelude, ','), media, declarations });
    }
    index = close;
  }
}

const rules = parse(source);

/** The last compound of a selector: the element the rule styles. */
function subject(selector: string): string {
  let depth = 0;
  for (let index = selector.length - 1; index >= 0; index--) {
    const char = selector[index];
    if (char === ')') depth++;
    else if (char === '(') depth--;
    else if (depth === 0 && (char === ' ' || char === '>')) return selector.slice(index + 1);
  }
  return selector;
}

/** The rule whose selector list is exactly these selectors, outside any at-rule. */
function rule(...selectors: string[]): Rule {
  const found = rules.find(
    (candidate) =>
      candidate.media === null &&
      candidate.selectors.length === selectors.length &&
      selectors.every((selector) => candidate.selectors.includes(selector)),
  );
  if (!found) throw new Error(`No rule for ${selectors.join(', ')}`);
  return found;
}

/** Every declaration of a property, as "selector list { value }". */
function declared(property: string): { where: string; value: string; rule: Rule }[] {
  return rules.flatMap((candidate) => {
    const value = candidate.declarations.get(property);
    return value === undefined
      ? []
      : [{ where: candidate.selectors.join(', '), value, rule: candidate }];
  });
}

/** The elements that hold text over the scene. */
const TEXT_BOXES = ['.office-anchor', '.office-caption', '.office-legend', '.office-hint'];
/** Every class a text box can be addressed by: a card and a label are anchors. */
const TEXT_BOX_CLASSES = [...TEXT_BOXES, '.office-card', '.office-label'];
/** The surfaces every text token is measured on (tokens.test.ts). */
const SHELL_SURFACES = [
  'var(--surface)',
  'var(--surface-muted)',
  'var(--row-hover)',
  'var(--row-selected)',
  'var(--canvas)',
  'var(--sidebar-hover)',
  'var(--sidebar-selected)',
];

describe('office.css', () => {
  it('is read as rules', () => {
    expect(rules.length).toBeGreaterThan(40);
    expect(rule('.office-view').declarations.get('--office-floor')).toBe('var(--canvas)');
    expect(rule('.office-anchor').declarations.get('transform')).toContain(
      'scale(var(--office-s))',
    );
  });

  it('keeps every rule under an office- class', () => {
    const stray = rules.flatMap((candidate) =>
      candidate.selectors.filter((selector) => !selector.includes('.office-')),
    );
    expect(stray).toEqual([]);
  });

  it('writes out two colors only: the shaded side of a slab, light and dark', () => {
    const hex = [...source.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
    expect([...new Set(hex)]).toEqual(['#c4c4c4', '#1b1b1b']);
    const shades = declared('--office-side-shade').map((entry) => entry.value);
    expect(shades).toEqual(['#c4c4c4', '#1b1b1b', '#1b1b1b']);
    expect(hex).toHaveLength(shades.length);
    // No other way to write a color either.
    expect(source).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color|color-mix)\(/);
    const named = rules.flatMap((candidate) =>
      [...candidate.declarations]
        .filter(([property]) =>
          /^(?:color|background|fill|stroke|border|outline|--state|--state-fill)$/.test(property),
        )
        .map(([property, value]) => `${property}: ${value}`)
        .filter(
          (declaration) =>
            !/: (?:(?:1px|2px) solid )?(?:var\(--[a-z-]+\)|transparent|none)$/.test(declaration),
        ),
    );
    expect(named).toEqual([]);
  });

  it('reads only tokens of index.css and its own properties', () => {
    const shell = new Set([
      ...Object.keys(readTokens(indexCss, ':root')),
      ...Object.keys(readTokens(indexCss, '[data-theme]')),
    ]);
    const own = new Set(
      rules.flatMap((candidate) =>
        [...candidate.declarations.keys()].filter((property) => property.startsWith('--')),
      ),
    );
    // Set by the component as inline style: the scene point of a label and the zoom.
    const fromComponent = ['--sx', '--sy', '--office-k', '--office-s'];
    for (const name of fromComponent) expect(viewSource).toContain(`'${name}'`);
    const read = new Set([...source.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
    const unknown = [...read].filter(
      (name) =>
        name === undefined || !(shell.has(name) || own.has(name) || fromComponent.includes(name)),
    );
    expect(unknown).toEqual([]);
    // The scene tones are aliases of shell tokens, so a theme switch repaints without a render.
    expect(Object.fromEntries(rule('.office-view').declarations)).toEqual({
      '--office-ground': 'var(--surface)',
      '--office-floor': 'var(--canvas)',
      '--office-edge': 'var(--field-border)',
      '--office-side': 'var(--sidebar-selected)',
      '--office-side-shade': '#c4c4c4',
      '--office-walkway': 'var(--row-hover)',
    });
  });

  it('repeats the dark tones for the first paint, before the theme script has run', () => {
    const dark = rule("[data-theme='dark'] .office-view");
    const firstPaint = rules.find(
      (candidate) =>
        candidate.media === '@media (prefers-color-scheme: dark)' &&
        candidate.selectors.join() === ":root:not([data-theme='light']) .office-view",
    );
    expect(firstPaint).toBeDefined();
    expect([...(firstPaint?.declarations ?? [])]).toEqual([...dark.declarations]);
    expect(dark.declarations.size).toBe(2);
    // Nothing else depends on the theme or on a media query.
    expect(rules.filter((candidate) => candidate.media !== null)).toHaveLength(1);
    expect(source.match(/data-theme/g)).toHaveLength(2);
  });

  it('has no motion and no depth effect: no transition, animation, shadow, filter or gradient', () => {
    expect(source).not.toMatch(/transition|animation|keyframes|box-shadow|filter|gradient/);
  });

  it('puts every text over the scene on an opaque shell surface', () => {
    for (const box of TEXT_BOXES) {
      const base = rules.find(
        (candidate) => candidate.media === null && candidate.selectors.includes(box),
      );
      expect(base?.declarations.get('background'), box).toBe('var(--surface)');
      expect(base?.declarations.get('border'), box).toBe('1px solid var(--line)');
      expect(base?.declarations.get('border-radius'), box).toBe('var(--radius)');
    }
    const grounds = [...declared('background'), ...declared('background-color')].filter((entry) =>
      entry.rule.selectors.some((selector) =>
        TEXT_BOX_CLASSES.some((name) => subject(selector).includes(name)),
      ),
    );
    expect(grounds.map((entry) => entry.value).sort()).toEqual([
      'var(--surface)',
      'var(--surface)',
      'var(--surface-muted)',
    ]);
    for (const entry of grounds) expect(SHELL_SURFACES, entry.where).toContain(entry.value);
    // Nothing makes one of them see-through, except the label that is not painted at all.
    expect(declared('opacity').map((entry) => entry.where)).toEqual([
      ".office-viewport[data-level='units'] .office-label:not(:focus-visible, [aria-pressed='true'])",
    ]);
  });

  it('keeps the keyboard hint in the top right corner, clear of the fitted scene and of the caption', () => {
    // At the bottom it lay over the lowest room and over the focus ring it tells about.
    expect(Object.fromEntries(rule('.office-hint').declarations)).toEqual({
      top: '12px',
      right: '16px',
      'max-width': 'min(20rem, calc(100% - 11rem))',
      'font-size': '0.75rem',
      'line-height': '1.4',
    });
    expect(rule('.office-caption').declarations.get('top')).toBe('12px');
    expect(rule('.office-caption').declarations.get('left')).toBe('16px');
  });

  it('sizes text in rem, and keeps a label readable at its smallest scale', () => {
    const sizes = declared('font-size');
    expect(sizes.map((entry) => entry.where)).toEqual([
      '.office-anchor',
      '.office-caption',
      '.office-legend',
      '.office-hint',
    ]);
    for (const { where, value } of sizes) expect(value, where).toMatch(/^[\d.]+rem$/);
    // Cards and labels shrink with the scene down to OVERLAY.fullFrom: 13 px becomes 11 px.
    const inAnchor = sizes
      .filter((entry) =>
        entry.rule.selectors.some((selector) =>
          /\.office-(?:anchor|card|label|tag|code|name|count)/.test(selector),
        ),
      )
      .map((entry) => parseFloat(entry.value));
    expect(inAnchor).toEqual([0.8125]);
    expect(Math.min(...inAnchor) * OVERLAY.fullFrom).toBeGreaterThanOrEqual(0.6875);
    // The font shorthand would reset the size: it only inherits the family of the panel.
    expect(declared('font').map((entry) => entry.value)).toEqual(['inherit']);
    // The line of a label is taller than its text: the name clips what leaves its box, and a
    // line as tall as the text cut the dot of İ, the cedilla of ç and the tails of y, g and p.
    expect(rule('.office-label').declarations.get('line-height')).toBe('1.4');
    expect(rule('.office-name').declarations.get('overflow')).toBe('hidden');
    // What holds a line of text grows with the text.
    for (const property of ['line-height', 'height', 'width', 'max-width']) {
      for (const { where, value } of declared(property)) {
        if (value === 'auto' || value === 'fit-content') continue;
        expect(value, `${property} of ${where}`).not.toMatch(/\dpx/);
      }
    }
  });

  it('takes every corner radius from the shell', () => {
    const radii = declared('border-radius');
    expect(radii.length).toBeGreaterThanOrEqual(3);
    for (const { where, value } of radii) {
      expect(value, where).toMatch(/^(?:var\(--radius\)|calc\(var\(--radius\) \* [\d.]+\))$/);
    }
  });

  it('draws keyboard focus and selection as two different rings, and lets the selection win', () => {
    const hover = rule(
      '.office-unit[data-hover] > .office-ring',
      '.office-agent[data-hover] > .office-ring',
      '.office-agent:hover > .office-ring',
    );
    const active = rule(
      '.office-unit[data-active] > .office-ring',
      '.office-agent[data-active] > .office-ring',
    );
    const selected = rule(
      '.office-unit[data-selected] > .office-ring',
      '.office-agent[data-selected] > .office-ring',
    );
    // Under the pointer the outline of a room is as wide as the ring of a desk: the tone alone,
    // on a line of 1 pixel, does not show which room a card belongs to.
    expect(Object.fromEntries(hover.declarations)).toEqual({
      stroke: 'var(--ink-secondary)',
      'stroke-width': '2',
    });
    expect(rule('.office-unit > .office-ring').declarations.get('stroke-width')).toBe('1');
    expect(rule('.office-agent > .office-ring').declarations.get('stroke-width')).toBe('2');
    expect(Object.fromEntries(active.declarations)).toEqual({
      stroke: 'var(--brand)',
      'stroke-width': '2',
      'stroke-dasharray': '4 3',
    });
    expect(Object.fromEntries(selected.declarations)).toEqual({
      stroke: 'var(--brand)',
      'stroke-width': '2',
      'stroke-dasharray': 'none',
    });
    // The three have the same weight, so the order in the file decides on the same thing.
    expect([hover, active, selected].map((entry) => rules.indexOf(entry))).toEqual(
      [hover, active, selected].map((entry) => rules.indexOf(entry)).sort((a, b) => a - b),
    );
  });

  it('tells closed from enabled by shape and stopped by its own tone, never by color alone', () => {
    expect(Object.fromEntries(rule('.office-agent').declarations)).toEqual({
      '--state': 'var(--ink-secondary)',
      '--state-fill': 'transparent',
    });
    expect(Object.fromEntries(rule(".office-agent[data-state='stopped']").declarations)).toEqual({
      '--state': 'var(--status-cancelled)',
      '--state-fill': 'var(--status-cancelled-fill)',
    });
    // The outline figure: closed and stopped. The filled one is the base rule.
    expect(Object.fromEntries(rule('.office-figure').declarations)).toEqual({
      fill: 'var(--state)',
      stroke: 'var(--state)',
    });
    expect(
      rule(
        ".office-agent:is([data-state='closed'], [data-state='stopped']) .office-figure",
      ).declarations.get('fill'),
    ).toBe('var(--surface)');
    // Only these states exist in version 1.
    const states = [...source.matchAll(/data-state='([a-z_]+)'/g)].map((match) => match[1]);
    expect([...new Set(states)].sort()).toEqual(['closed', 'stopped']);
  });
});
