import { describe, expect, it } from 'vitest';
import {
  AGENT_FILE_MAX_TOKENS,
  AGENT_IMAGE_MAX_BYTES,
  AGENT_PDF_MAX_BYTES,
  AGENT_READ_TOOL,
  AGENT_RUN_MAX_BYTES,
  AGENT_RUN_MAX_IMAGES,
  AGENT_RUN_MAX_TOKENS,
  AGENT_TEXT_MAX_BYTES,
  FILE_READ_PROBLEMS,
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_TYPES,
  agentFileForm,
  agentReads,
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

describe('what agents read of a file (8 October decision 21)', () => {
  it('agents read nine of the twelve extensions', () => {
    const forms = Object.fromEntries(
      PROJECT_FILE_TYPES.map((type) => [type.extension, agentFileForm(type.mimeType)]),
    );
    expect(forms).toEqual({
      pdf: 'pdf',
      docx: null,
      xlsx: null,
      csv: 'text',
      pptx: null,
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      webp: 'image',
      txt: 'text',
      md: 'text',
    });
    // A type the list does not have is not read either.
    expect(agentFileForm('application/zip')).toBeNull();
    expect(agentFileForm('')).toBeNull();
    for (const type of PROJECT_FILE_TYPES) {
      expect(agentReads(type.mimeType, 1), type.extension).toBe(
        forms[type.extension] === null ? 'kind' : 'yes',
      );
    }
  });

  it('a file over the bytes of its form is not read', () => {
    for (const [mimeType, limit] of [
      ['application/pdf', AGENT_PDF_MAX_BYTES],
      ['image/png', AGENT_IMAGE_MAX_BYTES],
      ['image/jpeg', AGENT_IMAGE_MAX_BYTES],
      ['text/csv', AGENT_TEXT_MAX_BYTES],
      ['text/markdown', AGENT_TEXT_MAX_BYTES],
    ] as const) {
      expect(agentReads(mimeType, limit), mimeType).toBe('yes');
      expect(agentReads(mimeType, limit + 1), mimeType).toBe('size');
    }
    // The kind is said before the size: a large Office file is not "too large", it is not read.
    expect(
      agentReads(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        PROJECT_FILE_MAX_BYTES,
      ),
    ).toBe('kind');
  });

  it('the limits fit one request', () => {
    // The provider takes 32 MB a request; base64 is four thirds, and the rest needs room.
    expect((AGENT_RUN_MAX_BYTES * 4) / 3).toBeLessThan(32_000_000 - 2_000_000);
    expect(AGENT_PDF_MAX_BYTES).toBeLessThanOrEqual(AGENT_RUN_MAX_BYTES);
    // The provider takes 10 MB of base64 an image.
    expect(Math.ceil(AGENT_IMAGE_MAX_BYTES / 3) * 4).toBeLessThan(10_000_000);
    // Every limit of a form is under what a project file may be at all.
    for (const limit of [AGENT_PDF_MAX_BYTES, AGENT_IMAGE_MAX_BYTES, AGENT_TEXT_MAX_BYTES]) {
      expect(limit).toBeLessThan(PROJECT_FILE_MAX_BYTES);
    }
    expect(AGENT_FILE_MAX_TOKENS).toBeLessThan(AGENT_RUN_MAX_TOKENS);
    expect(AGENT_RUN_MAX_IMAGES).toBe(20);
  });

  it('every refusal the journey words is a code', () => {
    expect(FILE_READ_PROBLEMS).toHaveLength(11);
    expect(new Set(FILE_READ_PROBLEMS).size).toBe(FILE_READ_PROBLEMS.length);
    for (const code of FILE_READ_PROBLEMS) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(AGENT_READ_TOOL).toBe('read_project_file');
  });
});
