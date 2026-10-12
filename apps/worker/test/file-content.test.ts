import { PROJECT_FILE_TYPES } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { decodeText, fileBlock } from '../src/files/content.ts';

// How a project file is given to the model (8 October decision 21): the provider's own block and
// nothing beside it. The worker opens no file: bytes are handed on, text is decoded.

const BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);

describe('the block of a file', () => {
  it('a PDF is a base64 document', () => {
    expect(fileBlock('application/pdf', BYTES)).toEqual({
      block: {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: BYTES.toString('base64'),
        },
      },
      encoding: null,
    });
  });

  it('each of the four image types is an image block whose media type is the stored type', () => {
    for (const mimeType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(fileBlock(mimeType, BYTES), mimeType).toEqual({
        block: {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: BYTES.toString('base64') },
        },
        encoding: null,
      });
    }
  });

  it('a text is a plain text document, whatever its stored type', () => {
    const text = 'tarih;yer\n15 Kasım;İzmir\n';
    for (const mimeType of ['text/plain', 'text/markdown', 'text/csv']) {
      expect(fileBlock(mimeType, Buffer.from(text, 'utf8')), mimeType).toEqual({
        block: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text } },
        encoding: 'utf-8',
      });
    }
  });

  it('an Office type gives no block', () => {
    const unread = PROJECT_FILE_TYPES.filter((type) =>
      ['docx', 'xlsx', 'pptx'].includes(type.extension),
    );
    expect(unread).toHaveLength(3);
    for (const type of unread) {
      expect(fileBlock(type.mimeType, BYTES), type.extension).toBeNull();
    }
    for (const mimeType of ['application/zip', 'text/html', 'image/svg+xml', 'image/tiff', '']) {
      expect(fileBlock(mimeType, BYTES), mimeType).toBeNull();
    }
    // Every other extension of the list gives one.
    for (const type of PROJECT_FILE_TYPES.filter((entry) => !unread.includes(entry))) {
      expect(fileBlock(type.mimeType, Buffer.from('a')), type.extension).not.toBeNull();
    }
  });

  it('UTF-8 with and without a byte order mark', () => {
    const text = 'Şartname: çağrı, ölçüt, ğ';
    expect(decodeText(Buffer.from(text, 'utf8'))).toEqual({ text, encoding: 'utf-8' });
    expect(
      decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])),
    ).toEqual({ text, encoding: 'utf-8' });
    expect(decodeText(Buffer.from('plain ascii'))).toEqual({
      text: 'plain ascii',
      encoding: 'utf-8',
    });
  });

  it('bytes that are not UTF-8 are read as Windows-1254 and say so', () => {
    expect(decodeText(Buffer.from([0xfe, 0xf0, 0xfd]))).toEqual({
      text: 'şğı',
      encoding: 'windows-1254',
    });
    // "İş;Ölçü" as Excel on a Turkish Windows saves it.
    const made = fileBlock('text/csv', Buffer.from([0xdd, 0xfe, 0x3b, 0xd6, 0x6c, 0xe7, 0xfc]));
    expect(made).toEqual({
      block: {
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: 'İş;Ölçü' },
      },
      encoding: 'windows-1254',
    });
  });

  it('no block carries a title, a context or a citation', () => {
    for (const type of PROJECT_FILE_TYPES) {
      const made = fileBlock(type.mimeType, Buffer.from('içerik'));
      if (made === null) continue;
      expect(Object.keys(made.block).sort(), type.extension).toEqual(['source', 'type']);
      expect(JSON.stringify(made.block)).not.toMatch(/title|context|citations|cache_control/);
    }
  });
});
