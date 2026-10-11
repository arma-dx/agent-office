import { describe, expect, it } from 'vitest';
import {
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_TYPES,
  apiErrorCodeSchema,
  fileExtension,
  projectFileKindOf,
  projectFileListSchema,
  projectFileNameSchema,
  projectFileProblem,
  projectFileSchema,
  projectFileTypeOf,
  uploadTicketRequestSchema,
  uploadTicketSchema,
} from '../src/index.ts';

describe('the fixed list of file types', () => {
  it('holds the twelve extensions of the six kinds, each once, and no type a browser runs', () => {
    expect(PROJECT_FILE_TYPES.map((type) => type.extension)).toEqual([
      'pdf',
      'docx',
      'xlsx',
      'csv',
      'pptx',
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'txt',
      'md',
    ]);
    expect(new Set(PROJECT_FILE_TYPES.map((type) => type.kind))).toEqual(
      new Set(['document', 'spreadsheet', 'presentation', 'pdf', 'image', 'text']),
    );
    // Eleven stored types: jpg and jpeg are one.
    expect(new Set(PROJECT_FILE_TYPES.map((type) => type.mimeType)).size).toBe(11);
    for (const type of PROJECT_FILE_TYPES) {
      expect(type.mimeType).not.toMatch(/html|svg|xml$|javascript|zip|msword|ms-excel|macro/i);
      expect(projectFileKindOf(type.mimeType)).toBe(type.kind);
    }
    expect(PROJECT_FILE_ACCEPT).toBe(
      '.pdf,.docx,.xlsx,.csv,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md',
    );
    expect(projectFileKindOf('text/html')).toBeNull();
    expect(PROJECT_FILE_MAX_BYTES).toBe(26_214_400);
  });

  it('reads the type from the last extension of a name, whatever its case', () => {
    expect(fileExtension('Rapor.PDF')).toBe('pdf');
    expect(fileExtension('arşiv.tar.gz')).toBe('gz');
    for (const name of ['rapor', '.pdf', 'rapor.', '.', '..']) {
      expect(fileExtension(name), name).toBeNull();
    }
    expect(projectFileTypeOf('Sunum.PPTX')?.kind).toBe('presentation');
    expect(projectFileTypeOf('foto.JPG')?.mimeType).toBe('image/jpeg');
    for (const name of ['a.html', 'a.svg', 'a.exe', 'a.zip', 'a.doc', 'a.docm', 'a.pdf.exe', 'a']) {
      expect(projectFileTypeOf(name), name).toBeNull();
    }
  });
});

describe('the name of a file', () => {
  it('is composed and trimmed, and keeps what is only odd', () => {
    expect(projectFileNameSchema.parse('  Şartname (son) "v2".pdf ')).toBe(
      'Şartname (son) "v2".pdf',
    );
    expect(projectFileNameSchema.parse('a'.repeat(200))).toHaveLength(200);
    expect(projectFileNameSchema.parse('..pdf')).toBe('..pdf');
  });

  it('holds no slash, backslash, control or hidden character, and at most 200 characters', () => {
    for (const name of [
      '',
      '   ',
      'a/b.pdf',
      '../a.pdf',
      'a\\b.pdf',
      'a\nb.pdf',
      'a\u0000.pdf',
      'a\u007f.pdf',
      'a‮fdp.exe',
      'a .pdf',
      'a'.repeat(201),
    ]) {
      expect(projectFileNameSchema.safeParse(name).success, JSON.stringify(name)).toBe(false);
    }
  });

  it('says why a chosen file is not sent, the name before the type before the size', () => {
    expect(projectFileProblem({ name: 'a.pdf', size: 1 })).toBeNull();
    expect(projectFileProblem({ name: 'a.pdf', size: PROJECT_FILE_MAX_BYTES })).toBeNull();
    expect(projectFileProblem({ name: 'a/b.exe', size: 0 })).toBe('name');
    expect(projectFileProblem({ name: 'a.exe', size: 0 })).toBe('type');
    expect(projectFileProblem({ name: 'a.pdf', size: 0 })).toBe('empty');
    expect(projectFileProblem({ name: 'a.pdf', size: PROJECT_FILE_MAX_BYTES + 1 })).toBe(
      'too_large',
    );
  });
});

describe('the answers', () => {
  const file = {
    id: '00000000-0000-4000-8000-000000000131',
    name: 'Şartname.pdf',
    kind: 'pdf',
    sizeBytes: 1200,
    createdAt: '2026-10-09T09:00:00.000Z',
    createdBy: { userId: '00000000-0000-4000-8000-000000000012', name: null },
    deletable: false,
  };

  it('take a file and a list, and refuse a size or a kind that cannot be', () => {
    expect(projectFileSchema.parse(file)).toEqual(file);
    expect(projectFileSchema.parse({ ...file, createdBy: null }).createdBy).toBeNull();
    expect(
      projectFileListSchema.parse({ files: [file], storageAvailable: false }).files,
    ).toHaveLength(1);
    for (const bad of [
      { sizeBytes: 0 },
      { sizeBytes: PROJECT_FILE_MAX_BYTES + 1 },
      { kind: 'archive' },
    ]) {
      expect(projectFileSchema.safeParse({ ...file, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    expect(projectFileListSchema.safeParse({ files: [] }).success).toBe(false);
  });

  it('take the request for an upload ticket and the ticket, and nothing beside them', () => {
    expect(uploadTicketRequestSchema.parse({ sizeBytes: 1200 })).toEqual({ sizeBytes: 1200 });
    for (const bad of [
      {},
      { sizeBytes: 1.5 },
      { sizeBytes: '1200' },
      { sizeBytes: 1, name: 'a' },
    ]) {
      expect(uploadTicketRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const ticket = { ticket: '1791500000.abc', expiresAt: '2026-10-09T09:01:00.000Z' };
    expect(uploadTicketSchema.parse(ticket)).toEqual(ticket);
    expect(uploadTicketSchema.safeParse({ ...ticket, ticket: '' }).success).toBe(false);
    expect(uploadTicketSchema.safeParse({ ticket: 'x' }).success).toBe(false);
  });

  it('have an error code for every refusal of a file', () => {
    for (const code of [
      'file_too_large',
      'file_empty',
      'file_name_invalid',
      'file_type_not_allowed',
      'file_content_mismatch',
      'file_limit_reached',
      'file_space_full',
      'file_delete_not_allowed',
      'file_content_missing',
      'file_storage_unavailable',
      'file_storage_failed',
      'uploads_busy',
      'downloads_busy',
      'upload_ticket_invalid',
    ]) {
      expect(apiErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });
});
