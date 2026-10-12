import { deflateSync } from 'node:zlib';

/**
 * The files of the file reading probe, made in memory by code: no file of a person, no company
 * data, nothing read from a disk. A PDF with text set in a standard font (no font is embedded),
 * a PNG drawn from a small bitmap font, a CSV and a Markdown text.
 */

// PDF -------------------------------------------------------------------------------------------

// The six Turkish letters the standard encoding lacks, at the code points of Windows-1254; the
// standard fonts hold their glyphs under these names.
const TURKISH: Readonly<Record<string, number>> = {
  Ğ: 0xd0,
  İ: 0xdd,
  Ş: 0xde,
  ğ: 0xf0,
  ı: 0xfd,
  ş: 0xfe,
};
const DIFFERENCES =
  '[208 /Gbreve 221 /Idotaccent 222 /Scedilla 240 /gbreve 253 /dotlessi 254 /scedilla]';

/** A line as the bytes of a PDF string: one byte a letter, the three marks of a string escaped. */
function pdfString(line: string): string {
  let out = '';
  for (const letter of line) {
    const code = TURKISH[letter] ?? letter.codePointAt(0) ?? 63;
    // Outside the encoding: a question mark, never a broken string.
    const byte = code > 255 ? 63 : code;
    out +=
      byte === 0x28 || byte === 0x29 || byte === 0x5c
        ? `\\${String.fromCharCode(byte)}`
        : String.fromCharCode(byte);
  }
  return out;
}

const LINE_HEIGHT = 14;
const LEFT = 56;
const TOP = 780;

/** A PDF of A4 pages; each page is the lines it is given, top down, in 11 point Helvetica. */
export function textPdf(pages: readonly (readonly string[])[]): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${String(4 + index * 2)} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${DIFFERENCES} >> >>`,
  );
  for (const [index, lines] of pages.entries()) {
    const content = [
      'BT',
      '/F1 11 Tf',
      `${String(LINE_HEIGHT)} TL`,
      `${String(LEFT)} ${String(TOP)} Td`,
      ...lines.map((line) => `(${pdfString(line)}) Tj T*`),
      'ET',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(5 + index * 2)} 0 R >>`,
    );
    objects.push(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`);
  }
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  // One byte a character: every character above is below 256.
  return Buffer.from(body, 'latin1');
}

/** Breaks a text into lines of at most `width` characters, at spaces. */
export function wrap(text: string, width = 88): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

// PNG -------------------------------------------------------------------------------------------

// Capital letters and digits, five columns by seven rows, a row a number (the left column is the
// high bit). Only what the probe's pictures write.
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ':': [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
};

/** Can the font above write this text: every character of it has a glyph. */
export function canDraw(text: string): boolean {
  return Array.from(text).every((letter) => GLYPHS[letter] !== undefined);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export interface PictureOptions {
  width: number;
  height: number;
  // How many pixels a dot of a letter is wide and high.
  scale: number;
  // How often the picture is smeared with its neighbours: 0 is sharp.
  blur?: number;
}

/**
 * A grey picture with one line of dark text in its middle, as a PNG. The text is written in
 * capital letters and digits of the font above; a character it does not have is left blank.
 */
export function textPng(text: string, options: PictureOptions): Buffer {
  const { width, height, scale } = options;
  let pixels = new Uint8Array(width * height).fill(235);
  const textWidth = text.length * 6 * scale;
  const left = Math.max(0, Math.floor((width - textWidth) / 2));
  const top = Math.max(0, Math.floor((height - 7 * scale) / 2));
  for (const [index, letter] of Array.from(text).entries()) {
    const rows = GLYPHS[letter] ?? GLYPHS[' '] ?? [];
    for (const [row, bits] of rows.entries()) {
      for (let column = 0; column < 5; column += 1) {
        if ((bits & (1 << (4 - column))) === 0) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = left + (index * 6 + column) * scale + dx;
            const y = top + row * scale + dy;
            if (x < width && y < height) pixels[y * width + x] = 25;
          }
        }
      }
    }
  }
  for (let pass = 0; pass < (options.blur ?? 0); pass += 1) {
    const smeared = new Uint8Array(pixels.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            sum += pixels[ny * width + nx] ?? 0;
            count += 1;
          }
        }
        smeared[y * width + x] = Math.round(sum / count);
      }
    }
    pixels = smeared;
  }
  // Eight bit grey, one filter byte (none) before every row.
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
