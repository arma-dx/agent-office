/** Smallest bytes that are a file of each allowed type, built here so no binary lies in the repository. */

/** A zip with the given entry names, every entry stored and empty: enough for a directory to read. */
export function zipOf(names: readonly string[]): Buffer {
  const locals: Buffer[] = [];
  const entries: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const entry = Buffer.alloc(46 + nameBytes.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBytes.copy(entry, 46);
    locals.push(local);
    entries.push(entry);
    offset += local.length;
  }
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const SAMPLES = {
  pdf: Buffer.from('%PDF-1.7\n%âã\n1 0 obj\n<<>>\nendobj\n', 'latin1'),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]),
  gif: Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'),
  webp: Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]),
  docx: zipOf(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']),
  xlsx: zipOf(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml']),
  pptx: zipOf(['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']),
  docm: zipOf(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']),
  zip: zipOf(['readme.txt', 'setup.exe']),
  text: Buffer.from('Toplantı notları\nİkinci satır: ğüşiöç\n', 'utf8'),
  // "Müşteri;Tutar" as Excel saves a CSV on a Turkish Windows (Windows-1254).
  csv1254: Buffer.from([
    0x4d, 0xfc, 0xfe, 0x74, 0x65, 0x72, 0x69, 0x3b, 0x54, 0x75, 0x74, 0x61, 0x72, 0x0d, 0x0a,
  ]),
  html: Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'utf8'),
  exe: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
} as const;
