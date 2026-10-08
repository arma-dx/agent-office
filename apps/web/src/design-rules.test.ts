import { describe, expect, it } from 'vitest';
import css from './index.css?raw';

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule for ${selector} in the stylesheet`);
  return css.slice(start, css.indexOf('}', start));
}

// jsdom applies no stylesheet, so these rules cannot be seen at work in a test. They were measured
// in a browser; the checks below keep them from being dropped or loosened unnoticed.
describe('stylesheet rules for the keyboard focus (index.css)', () => {
  it('draws the focus ring on every control', () => {
    expect(rule('\n:focus-visible')).toContain('outline: 2px solid var(--ring);');
    expect(rule('.row-link:focus-visible::after')).toContain('outline: 2px solid var(--ring);');
  });

  it('keeps a focused control of the content out from under the sticky top bar', () => {
    // The bar is 60 px (h-15); 80 px leaves room for the ring of a list row as well.
    expect(rule('#content *')).toContain('scroll-margin-top: 5rem;');
  });

  it('leaves the ring out of menu rows and menu buttons only after a press of the pointer', () => {
    const selector =
      "[data-input='pointer'] [role^='menuitem']:focus-visible,\n" +
      "[data-input='pointer'] [data-slot='dropdown-menu-trigger']:focus-visible";
    expect(rule(selector)).toContain('outline: none;');
    // Nothing else switches the ring off except the two places that draw it elsewhere.
    expect(css.match(/outline: none;/g)).toHaveLength(3);
  });
});

// The source of every component and route, read the way the stylesheet is read above (node:fs is
// not allowed in panel code).
const sources = import.meta.glob<string>(['./**/*.tsx', '!./**/*.test.tsx', '!./test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The code of a file without its comments, which may name a class in order to explain it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Every match of `pattern` in the code of the given files, as "file: match". */
function hits(pattern: RegExp, skip: readonly string[] = []): string[] {
  return Object.entries(sources)
    .filter(([file]) => !skip.includes(file))
    .flatMap(([file, text]) =>
      [...code(text).matchAll(pattern)].map((match) => `${file}: ${match[0]}`),
    );
}

/**
 * Motion only shows the result of what the person did (CLAUDE.md). A file that needs an entry or
 * exit animation for that (an approved item leaving the queue) is listed here, with the reason.
 */
const MOTION_ALLOWED: readonly string[] = [];

// The design rules of CLAUDE.md that live in class names. Tailwind and the shadcn defaults make
// each of these one word away; nothing else notices when one comes back.
describe('design rules in class names (components and routes)', () => {
  it('reads the components and the routes', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining([
        './components/shell/sidebar.tsx',
        './components/ui/dropdown-menu.tsx',
        './routes/_authed/c/$company/tasks.tsx',
      ]),
    );
  });

  it('separates with lines and space: no shadow, no blur, no gradient', () => {
    // shadow-none is the one shadow class in use: it removes the shadow of the toast library.
    expect(hits(/(?<![\w-])(?:drop-)?shadow(?:-(?!none)[\w[\]./-]+)?(?![\w-])/g)).toEqual([]);
    expect(hits(/(?<![\w-])(?:backdrop-)?blur(?:-[\w[\]./-]+)?(?![\w-])/g)).toEqual([]);
    expect(
      hits(/(?<![\w-])bg-(?:gradient|linear|radial|conic)(?:-[\w[\]./-]+)?(?![\w-])/g),
    ).toEqual([]);
  });

  it('writes labels in sentence case: no uppercase, no widened letter spacing', () => {
    expect(hits(/(?<![\w-])(?:uppercase|tracking-(?:wide|wider|widest))(?![\w-])/g)).toEqual([]);
  });

  it('has no decorative motion: no pulse, bounce or ping, and no entry animation', () => {
    expect(hits(/(?<![\w-])animate-(?:pulse|bounce|ping)(?![\w-])/g)).toEqual([]);
    expect(
      hits(
        /(?<![\w-])(?:animate-(?:in|out)|(?:fade|zoom|slide)-(?:in|out)(?:-[\w[\]./-]+)?)(?![\w-])/g,
        MOTION_ALLOWED,
      ),
    ).toEqual([]);
  });

  it('has no phone layout: nothing is hidden or shown by a phone breakpoint', () => {
    expect(hits(/(?<![\w-])(?:max-)?(?:sm|md):(?:hidden|block|flex|grid)(?![\w-])/g)).toEqual([]);
  });

  it('sizes text in rem, so that it follows the font size set in the browser', () => {
    expect(hits(/(?<![\w-])text-\[[\d.]+px\]/g)).toEqual([]);
  });

  it('names only colors that the theme defines, so that no color class is silently empty', () => {
    // Tailwind generates nothing for bg-sidebar-active, text-status-canceled or bg-project-grey,
    // and says nothing.
    const defined = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]));
    const families =
      'status|project|sidebar|row|surface|ink|brand|on-brand|canvas|field|line|error|skeleton|google|' +
      'background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring';
    const colorClass = new RegExp(
      `(?<![\\w-])(?:bg|text|border|outline|ring|fill|stroke)-((?:${families})(?:-[a-z0-9]+)*)(?![\\w-])`,
      'g',
    );
    const unknown = Object.entries(sources).flatMap(([file, text]) =>
      [...code(text).matchAll(colorClass)]
        .filter((match) => !defined.has(match[1]))
        .map((match) => `${file}: ${match[0]}`),
    );
    expect(unknown).toEqual([]);
  });
});
