// How wide a text is drawn in the panel's font, for tests of fixed columns: jsdom lays nothing
// out, so a test cannot ask the page. The numbers are the advance widths of IBM Plex Sans at
// weight 400 in thousandths of the font size, read from the font files the panel is built with
// (@fontsource-variable/ibm-plex-sans 5.3.0, the latin and latin-ext subsets). Kerning is left
// out: it only pulls letters together in this font's Turkish texts (by a pixel at most over a
// whole sentence), so the sum is never narrower than what the browser draws.
const ADVANCE: Readonly<Record<string, number>> = {
  a: 534,
  b: 580,
  c: 503,
  ç: 503,
  d: 580,
  e: 549,
  f: 324,
  g: 528,
  ğ: 531,
  h: 568,
  ı: 250,
  i: 250,
  j: 250,
  k: 527,
  l: 272,
  m: 873,
  n: 568,
  o: 560,
  ö: 560,
  p: 580,
  q: 580,
  r: 367,
  s: 487,
  ş: 487,
  t: 351,
  u: 568,
  ü: 568,
  v: 492,
  w: 768,
  x: 507,
  y: 499,
  z: 464,
  A: 641,
  B: 653,
  C: 621,
  Ç: 621,
  D: 671,
  E: 583,
  F: 559,
  G: 695,
  Ğ: 695,
  H: 707,
  I: 400,
  İ: 400,
  J: 510,
  K: 634,
  L: 501,
  M: 812,
  N: 707,
  O: 708,
  Ö: 708,
  P: 606,
  Q: 708,
  R: 640,
  S: 581,
  Ş: 581,
  T: 572,
  U: 678,
  Ü: 678,
  V: 609,
  W: 891,
  X: 613,
  Y: 593,
  Z: 580,
  '0': 600,
  '1': 600,
  '2': 600,
  '3': 600,
  '4': 600,
  '5': 600,
  '6': 600,
  '7': 600,
  '8': 600,
  '9': 600,
  ' ': 236,
  ':': 292,
  ',': 272,
  '.': 272,
  '(': 335,
  ')': 335,
  "'": 242,
  '-': 399,
};

/** The width of `text` in pixels at `fontSize` (14: the text of a list row), weight 400. */
export function textWidth(text: string, fontSize = 14): number {
  let units = 0;
  for (const character of text) {
    const advance = ADVANCE[character];
    if (advance === undefined) {
      throw new Error(
        `No advance width for "${character}" in "${text}": add it to test/text-width.ts`,
      );
    }
    units += advance;
  }
  return (units * fontSize) / 1000;
}
