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
