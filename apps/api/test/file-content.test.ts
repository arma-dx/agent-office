import { PROJECT_FILE_TYPES, projectFileTypeOf, type ProjectFileType } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { contentMatches, zipEntryNames } from '../src/files/content.ts';
import { attachmentDisposition } from '../src/files/disposition.ts';
import { SAMPLES, zipOf } from './file-samples.ts';

const typeOf = (extension: string): ProjectFileType => {
  const type = PROJECT_FILE_TYPES.find((candidate) => candidate.extension === extension);
  if (!type) throw new Error(extension);
  return type;
};

describe('the content of an uploaded file', () => {
  it('takes the bytes of every type of the list under its own extension', () => {
    const good: [string, Buffer][] = [
      ['pdf', SAMPLES.pdf],
      ['png', SAMPLES.png],
      ['jpg', SAMPLES.jpeg],
      ['jpeg', SAMPLES.jpeg],
      ['gif', SAMPLES.gif],
      ['webp', SAMPLES.webp],
      ['docx', SAMPLES.docx],
      ['xlsx', SAMPLES.xlsx],
      ['pptx', SAMPLES.pptx],
      ['txt', SAMPLES.text],
      ['md', SAMPLES.text],
      ['csv', SAMPLES.text],
      ['csv', SAMPLES.csv1254],
    ];
    for (const [extension, bytes] of good) {
      expect(contentMatches(bytes, typeOf(extension)), extension).toBe(true);
    }
    expect(new Set(good.map(([extension]) => extension))).toEqual(
      new Set(PROJECT_FILE_TYPES.map((type) => type.extension)),
    );
  });

  it('refuses bytes that are another type than the extension says', () => {
    const bad: [string, Buffer][] = [
      ['pdf', SAMPLES.png],
      ['pdf', SAMPLES.html],
      ['png', SAMPLES.jpeg],
      ['jpg', SAMPLES.png],
      ['gif', SAMPLES.text],
      ['webp', SAMPLES.png],
      ['docx', SAMPLES.xlsx],
      ['xlsx', SAMPLES.pptx],
      ['pptx', SAMPLES.docx],
      ['docx', SAMPLES.zip],
      ['docx', SAMPLES.docm],
      ['docx', SAMPLES.pdf],
      ['txt', SAMPLES.png],
      ['txt', SAMPLES.exe],
      ['csv', SAMPLES.docx],
      ['md', SAMPLES.png],
      ['txt', Buffer.alloc(0)],
      ['pdf', Buffer.alloc(0)],
      ['pdf', Buffer.concat([Buffer.from(' '), SAMPLES.pdf])],
    ];
    for (const [extension, bytes] of bad) {
      expect(
        contentMatches(bytes, typeOf(extension)),
        `${extension} ${bytes.subarray(0, 6).toString('hex')}`,
      ).toBe(false);
    }
  });

  it('reads the names of a zip from its directory and gives up on anything else', () => {
    expect(zipEntryNames(SAMPLES.docx)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ]);
    expect(zipEntryNames(SAMPLES.pdf)).toBeNull();
    // Cut off before the end record.
    expect(zipEntryNames(SAMPLES.docx.subarray(0, SAMPLES.docx.length - 10))).toBeNull();
    // A directory that points past the file.
    const broken = Buffer.from(SAMPLES.docx);
    broken.writeUInt32LE(0x7fffffff, broken.length - 22 + 16);
    expect(zipEntryNames(broken)).toBeNull();
    // A zip64 marker.
    const zip64 = Buffer.from(SAMPLES.docx);
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
    expect(zipEntryNames(zip64)).toBeNull();
    // A comment after the end record is allowed.
    const commented = Buffer.concat([SAMPLES.docx, Buffer.from('yorum')]);
    commented.writeUInt16LE(5, SAMPLES.docx.length - 2);
    expect(zipEntryNames(commented)).toHaveLength(3);
    expect(zipEntryNames(zipOf([]))).toBeNull();
  });

  it('knows a type by the last extension of a name only', () => {
    expect(projectFileTypeOf('Rapor.PDF')?.extension).toBe('pdf');
    expect(projectFileTypeOf('rapor.pdf.exe')).toBeNull();
    expect(projectFileTypeOf('rapor.exe.pdf')?.extension).toBe('pdf');
    expect(projectFileTypeOf('rapor')).toBeNull();
    expect(projectFileTypeOf('.pdf')).toBeNull();
    expect(projectFileTypeOf('rapor.')).toBeNull();
    expect(projectFileTypeOf('sayfa.html')).toBeNull();
    expect(projectFileTypeOf('çizim.svg')).toBeNull();
    expect(projectFileTypeOf('eski.doc')).toBeNull();
    expect(projectFileTypeOf('makro.docm')).toBeNull();
  });
});

describe('the header of a download', () => {
  it('is always an attachment and cannot be broken by a name', () => {
    expect(attachmentDisposition('rapor.pdf')).toBe(
      `attachment; filename="rapor.pdf"; filename*=UTF-8''rapor.pdf`,
    );
    expect(attachmentDisposition('Şartname (son).pdf')).toBe(
      `attachment; filename="_artname (son).pdf"; filename*=UTF-8''%C5%9Eartname%20%28son%29.pdf`,
    );
    const tricky = attachmentDisposition(`a"; filename="x.html\\ %0d%0a'*.pdf`);
    expect(tricky).toBe(
      `attachment; filename="a__ filename=_x.html_ _0d_0a'*.pdf"; filename*=UTF-8''a%22%3B%20filename%3D%22x.html%5C%20%250d%250a%27%2A.pdf`,
    );
    expect(tricky).not.toMatch(/[\r\n]/);
  });
});
