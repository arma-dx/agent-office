import { z } from 'zod';
import { hasHiddenCharacter } from './api.ts';
import { taskPersonSchema } from './tasks.ts';

/**
 * Project files (8 October decisions 11, 20 and 21), step 4: the files people add to a project.
 * The API decides every value here again from the bytes it receives; the panel uses the same
 * constants to say "no" before it sends anything.
 *
 * A file is sent as the raw body of PUT /api/projects/:projectId/files/:fileId
 * (content-type application/octet-stream), its name in the FILE_NAME_HEADER header,
 * percent-encoded as encodeURIComponent writes it, and the ticket of this upload in the
 * UPLOAD_TICKET_HEADER header. There is no JSON body and no form.
 */

/** Decision 20: 25 MB per file, read as 25 x 1024 x 1024 bytes. */
export const PROJECT_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const PROJECT_FILE_NAME_MAX = 200;
/** docs/SONRA.md P4-d: how many files a project holds, and how many bytes together. */
export const PROJECT_FILE_LIMIT = 200;
export const PROJECT_FILES_MAX_BYTES = 1024 * 1024 * 1024;

/** The header that carries the name of an uploaded file, percent-encoded UTF-8. */
export const FILE_NAME_HEADER = 'x-file-name';
export const FILE_UPLOAD_CONTENT_TYPE = 'application/octet-stream';
/**
 * The header that carries the upload ticket. A file is sent in two requests: the panel first asks
 * for a ticket (POST .../files/:fileId/ticket, a small JSON request that is checked like every
 * other: session, company, project, storage, size), then sends the bytes with the ticket. The API
 * reads no byte of a body that comes without a valid ticket, so nobody without a session makes it
 * hold a file.
 */
export const UPLOAD_TICKET_HEADER = 'x-upload-ticket';
/** How long a ticket is good for starting the upload it was given for. */
export const UPLOAD_TICKET_SECONDS = 60;

/** The six words of decision 20; labels are the panel's. */
export const projectFileKindSchema = z.enum([
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
  'image',
  'text',
]);
export type ProjectFileKind = z.output<typeof projectFileKindSchema>;

export interface ProjectFileType {
  /** Lower case, without the dot. */
  extension: string;
  /** What the record holds (files.mime_type); the database has the same list. */
  mimeType: string;
  kind: ProjectFileKind;
}

/**
 * The fixed list (docs/SONRA.md P4-a). A file is taken when its name ends in one of these
 * extensions AND its bytes are what that extension says (the API checks the bytes).
 */
export const PROJECT_FILE_TYPES: readonly ProjectFileType[] = [
  { extension: 'pdf', mimeType: 'application/pdf', kind: 'pdf' },
  {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
  },
  {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'spreadsheet',
  },
  { extension: 'csv', mimeType: 'text/csv', kind: 'spreadsheet' },
  {
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'presentation',
  },
  { extension: 'png', mimeType: 'image/png', kind: 'image' },
  { extension: 'jpg', mimeType: 'image/jpeg', kind: 'image' },
  { extension: 'jpeg', mimeType: 'image/jpeg', kind: 'image' },
  { extension: 'gif', mimeType: 'image/gif', kind: 'image' },
  { extension: 'webp', mimeType: 'image/webp', kind: 'image' },
  { extension: 'txt', mimeType: 'text/plain', kind: 'text' },
  { extension: 'md', mimeType: 'text/markdown', kind: 'text' },
];

/** The value of a file input's `accept` attribute: ".pdf,.docx,...". */
export const PROJECT_FILE_ACCEPT = PROJECT_FILE_TYPES.map((type) => `.${type.extension}`).join(',');

/** The extension of a name: what follows its last dot, lower case; null without one. */
export function fileExtension(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** The type a name stands for, by its extension; null when the list does not have it. */
export function projectFileTypeOf(name: string): ProjectFileType | null {
  const extension = fileExtension(name);
  return PROJECT_FILE_TYPES.find((type) => type.extension === extension) ?? null;
}

/** The kind of a stored type; null for a type the list does not have. */
export function projectFileKindOf(mimeType: string): ProjectFileKind | null {
  return PROJECT_FILE_TYPES.find((type) => type.mimeType === mimeType)?.kind ?? null;
}

/**
 * The name of a file as it is stored and shown: composed characters (a name typed on macOS can
 * arrive decomposed), no space at either end, 1 to 200 characters, no control or hidden
 * character, no slash and no backslash. The name is only ever a label: it is no part of where
 * the file lies, so nothing a name holds can reach another file.
 */
export const projectFileNameSchema = z
  .string()
  .transform((name) => name.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(PROJECT_FILE_NAME_MAX)
      .refine((name) => !hasHiddenCharacter(name) && !/[/\\]/.test(name), {
        message: 'Must not contain a slash, a backslash or a hidden character',
      }),
  );

/** Why a file the person chose cannot be sent; null when nothing speaks against it. */
export type ProjectFileProblem = 'name' | 'type' | 'empty' | 'too_large';

/** The checks the panel can do before sending; the API does them again, and reads the bytes. */
export function projectFileProblem(file: {
  name: string;
  size: number;
}): ProjectFileProblem | null {
  const name = projectFileNameSchema.safeParse(file.name);
  if (!name.success) return 'name';
  if (projectFileTypeOf(name.data) === null) return 'type';
  if (file.size === 0) return 'empty';
  if (file.size > PROJECT_FILE_MAX_BYTES) return 'too_large';
  return null;
}

// The ticket ---------------------------------------------------------------------------------------

/** POST /api/projects/:projectId/files/:fileId/ticket: the size the upload will declare. */
export const uploadTicketRequestSchema = z.strictObject({
  sizeBytes: z.number().int(),
});
export type UploadTicketRequest = z.output<typeof uploadTicketRequestSchema>;

/**
 * The ticket: good for one file id, one size, this session and this company, until expiresAt.
 * It grants nothing by itself: the upload is checked again, in its own transaction.
 */
export const uploadTicketSchema = z.object({
  ticket: z.string().min(1).max(200),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type UploadTicket = z.output<typeof uploadTicketSchema>;

// Answers ------------------------------------------------------------------------------------------

export const projectFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: projectFileKindSchema,
  sizeBytes: z.number().int().min(1).max(PROJECT_FILE_MAX_BYTES),
  createdAt: z.iso.datetime({ offset: true }),
  // null: written without a person (an administrator).
  createdBy: taskPersonSchema.nullable(),
  // The reader may delete it: they added it, they are the owner or a manager of the project, or
  // they are the founder (11 October decision 2).
  deletable: z.boolean(),
});
export type ProjectFile = z.output<typeof projectFileSchema>;

/**
 * GET /api/projects/:projectId/files: the files of a project the reader may read, newest first
 * (at most PROJECT_FILE_LIMIT, so never cut). storageAvailable false: the file store is not set
 * up in this environment; the list is still answered, nothing can be added, opened or deleted.
 */
export const projectFileListSchema = z.object({
  files: z.array(projectFileSchema),
  storageAvailable: z.boolean(),
});
export type ProjectFileList = z.output<typeof projectFileListSchema>;
