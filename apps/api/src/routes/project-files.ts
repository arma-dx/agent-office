import { createHash } from 'node:crypto';
import { listProjectFiles, peopleNames, readProject, type ProjectFileRow } from '@agent-office/db';
import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  FILE_UPLOAD_CONTENT_TYPE,
  PROJECT_FILE_MAX_BYTES,
  UPLOAD_TICKET_HEADER,
  projectFileKindOf,
  projectFileListSchema,
  projectFileNameSchema,
  projectFileSchema,
  projectFileTypeOf,
  uploadTicketRequestSchema,
  uploadTicketSchema,
  type ProjectFile,
  type ProjectFileList,
  type UploadTicket,
} from '@agent-office/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CompanyContext } from '../db.ts';
import {
  ApiError,
  databaseErrorCode,
  databaseErrorConstraint,
  errorHandler,
  invalidRequest,
  notFound,
  unauthenticated,
} from '../errors.ts';
import { contentMatches } from '../files/content.ts';
import { attachmentDisposition } from '../files/disposition.ts';
import {
  ByteBudget,
  DOWNLOAD_BUFFER_BYTES,
  FileStorageError,
  UPLOAD_BUFFER_BYTES,
  uploadDeadlineMs,
} from '../files/store.ts';
import { UploadTickets } from '../files/ticket.ts';
import type { RouteDeps } from '../services.ts';
import { hashSessionKey, readSessionCookie } from '../session.ts';

/**
 * The files of a project (8 October decisions 11 and 20; 11 October decision 2; docs/SONRA.md P-g,
 * P-k, P-l).
 *
 *   GET    /api/projects/:projectId/files                  the files the reader may read
 *   POST   /api/projects/:projectId/files/:fileId/ticket   the ticket an upload must carry
 *   PUT    /api/projects/:projectId/files/:fileId          adds a file: the body is its bytes
 *   GET    /api/projects/:projectId/files/:fileId/content  the bytes, always as a download
 *   DELETE /api/projects/:projectId/files/:fileId          who added it, the owner, a manager, the
 *                                                          founder
 *
 * Who reads, adds and deletes is decided by the row policies of office.files: the founder and the
 * members of the project read and add; the person who added a file, the owner and the managers of
 * the project and the founder delete it; an external person nothing. A project the person cannot
 * read answers 404 on every route, exactly like one that does not exist, before anything is said
 * about a file.
 *
 * The browser never talks to the file storage (rule 1): the bytes come to this server and leave
 * from it. The storage is reached only through `files` (ProjectFileStore), which reads the record
 * under the caller's row policies first (rule 9).
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

const projectParams = z.object({ projectId: z.uuid() });
const fileParams = z.object({ projectId: z.uuid(), fileId: z.uuid() });
// A name of 200 characters, each at most nine characters when percent-encoded.
const NAME_HEADER_MAX = 1800;

const fileTooLarge = (): ApiError =>
  new ApiError(413, 'file_too_large', 'Dosya 25 MB sınırını aşıyor. Daha küçük bir dosya seçin.');
const fileEmpty = (): ApiError =>
  new ApiError(400, 'file_empty', 'Dosya boş. İçeriği olan bir dosya seçin.');
const fileNameInvalid = (): ApiError =>
  new ApiError(
    400,
    'file_name_invalid',
    'Dosya adı kullanılamıyor. Ad en çok 200 karakter olabilir; eğik çizgi ve ters eğik çizgi içeremez. Dosyayı yeniden adlandırıp tekrar deneyin.',
  );
const typeNotAllowed = (): ApiError =>
  new ApiError(
    415,
    'file_type_not_allowed',
    'Bu dosya türü eklenemez. Eklenebilen türler: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, PNG, JPG, GIF ve WEBP.',
  );
const contentMismatch = (): ApiError =>
  new ApiError(
    415,
    'file_content_mismatch',
    'Dosyanın içeriği uzantısının söylediği türde değil. Dosyayı kendi programında açıp yeniden kaydedin. Makro içeren Office dosyaları eklenemez.',
  );
const limitReached = (): ApiError =>
  new ApiError(
    409,
    'file_limit_reached',
    'Bu projede en çok 200 dosya durabilir. Yeni dosya eklemek için önce bir dosyayı silin.',
  );
const spaceFull = (): ApiError =>
  new ApiError(
    409,
    'file_space_full',
    'Bu projenin dosyaları toplam 1 GB sınırına ulaştı. Yeni dosya eklemek için önce bir dosyayı silin.',
  );
const deleteNotAllowed = (): ApiError =>
  new ApiError(
    403,
    'file_delete_not_allowed',
    'Bu dosyayı yalnızca ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu silebilir.',
  );
const contentMissing = (): ApiError =>
  new ApiError(
    404,
    'file_content_missing',
    'Bu dosyanın içeriği depoda bulunamadı. Dosyayı ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu silip yeniden ekleyebilir.',
  );
const storageUnavailable = (): ApiError =>
  new ApiError(
    503,
    'file_storage_unavailable',
    'Dosya deposu bu ortamda kurulu değil. Dosya eklenemez, indirilemez ve silinemez.',
  );
const storageFailed = (): ApiError =>
  new ApiError(
    502,
    'file_storage_failed',
    'Dosya deposuna ulaşılamadı. Biraz sonra yeniden deneyin.',
  );
const uploadsBusy = (): ApiError =>
  new ApiError(
    503,
    'uploads_busy',
    'Şu anda başka dosyalar yükleniyor. Biraz sonra yeniden deneyin.',
  );
const downloadsBusy = (): ApiError =>
  new ApiError(
    503,
    'downloads_busy',
    'Şu anda başka dosyalar indiriliyor. Biraz sonra yeniden deneyin.',
  );
const ticketInvalid = (): ApiError =>
  new ApiError(
    403,
    'upload_ticket_invalid',
    'Yükleme izni geçersiz ya da süresi dolmuş. Dosyayı yeniden yükleyin.',
  );

function paramsOf<T>(schema: z.ZodType<T>, request: FastifyRequest): T {
  const params = schema.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data;
}

/** 404 unless the person reads the project: said before anything about a file. */
async function requireProject(context: CompanyContext, projectId: string): Promise<void> {
  if (!(await readProject(context.client, projectId))) {
    throw notFound();
  }
}

function toFile(row: ProjectFileRow, names: Map<string, string>): ProjectFile {
  return projectFileSchema.parse({
    id: row.id,
    name: row.name,
    kind: projectFileKindOf(row.mime_type),
    sizeBytes: row.size_bytes,
    createdAt: row.created_at.toISOString(),
    createdBy:
      row.created_by_user_id !== null
        ? { userId: row.created_by_user_id, name: names.get(row.created_by_user_id) ?? null }
        : null,
    deletable: row.deletable,
  });
}

async function fileOf(context: CompanyContext, row: ProjectFileRow): Promise<ProjectFile> {
  const names = await peopleNames(
    context.client,
    row.created_by_user_id !== null ? [row.created_by_user_id] : [],
  );
  return toFile(row, names);
}

/** The name the panel sent in the header: percent-encoded UTF-8, checked like every input. */
function fileNameOf(request: FastifyRequest): string {
  const raw = request.headers[FILE_NAME_HEADER];
  if (typeof raw !== 'string' || raw.length > NAME_HEADER_MAX) {
    throw fileNameInvalid();
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw fileNameInvalid();
  }
  const name = projectFileNameSchema.safeParse(decoded);
  if (!name.success) {
    throw fileNameInvalid();
  }
  return name.data;
}

export function registerProjectFileRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { runner, config, files } = deps;
  const uploads = new ByteBudget(deps.uploadBufferBytes ?? UPLOAD_BUFFER_BYTES);
  const downloads = new ByteBudget(deps.downloadBufferBytes ?? DOWNLOAD_BUFFER_BYTES);
  const deadlineMs = deps.uploadDeadlineMs ?? uploadDeadlineMs;
  const tickets = new UploadTickets(config.cookieSecret);
  // An upload whose bytes are counted in the budget, and the timer that ends it if they stop.
  const pending = new WeakMap<FastifyRequest, { bytes: number; timer: NodeJS.Timeout }>();
  // A download whose bytes are counted in the budget.
  const leaving = new WeakMap<FastifyRequest, number>();

  /**
   * Runs before a byte of the body is read (the body is buffered before the handler, and so
   * before the session is checked in the request's transaction). Refuses, without reading:
   * a request without a session key of the right shape; a body that is not sent as raw bytes; a
   * body without a declared length, an empty one and one over 25 MB; a request without a ticket
   * that was given to this session, company, project, file id and length within the last minute
   * (so nobody without a session makes the server hold a body); and an upload that would take
   * the process over its buffer budget. A refusal closes the connection, so the rest of the
   * body is not received either. From here the body has a deadline: if it has not arrived by
   * then, the connection is closed and the bytes are given back.
   */
  function uploadGuard(
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ) {
    const refuse = (error: ApiError): void => {
      reply.header('connection', 'close');
      done(error);
    };
    const cookie = readSessionCookie(request, config);
    const sessionKeyHash = cookie === undefined ? null : hashSessionKey(cookie);
    if (sessionKeyHash === null) {
      refuse(unauthenticated());
      return;
    }
    if (request.headers['content-type'] !== FILE_UPLOAD_CONTENT_TYPE) {
      refuse(invalidRequest());
      return;
    }
    const declared = request.headers['content-length'];
    const length = declared !== undefined && /^\d{1,12}$/.test(declared) ? Number(declared) : NaN;
    if (Number.isNaN(length)) {
      refuse(invalidRequest());
      return;
    }
    if (length === 0) {
      refuse(fileEmpty());
      return;
    }
    if (length > PROJECT_FILE_MAX_BYTES) {
      refuse(fileTooLarge());
      return;
    }
    const params = fileParams.safeParse(request.params);
    const company = request.headers[COMPANY_HEADER];
    if (
      !params.success ||
      typeof company !== 'string' ||
      !tickets.verify(request.headers[UPLOAD_TICKET_HEADER], {
        sessionKeyHash,
        companyId: company,
        projectId: params.data.projectId,
        fileId: params.data.fileId,
        sizeBytes: length,
      })
    ) {
      refuse(ticketInvalid());
      return;
    }
    if (!uploads.reserve(length)) {
      refuse(uploadsBusy());
      return;
    }
    const timer = setTimeout(() => {
      // The body did not arrive in its time: the place is given back and the connection closed.
      releaseUpload(request);
      request.raw.destroy();
    }, deadlineMs(length));
    timer.unref();
    pending.set(request, { bytes: length, timer });
    // Whatever ends the exchange (an answer, an abort, a connection that dies after the body was
    // read) gives the bytes back; the hooks below cover the test client, which emits no close.
    reply.raw.once('close', () => {
      releaseUpload(request);
    });
    done();
  }

  function bodyArrived(request: FastifyRequest): void {
    const upload = pending.get(request);
    if (upload) clearTimeout(upload.timer);
  }

  function releaseUpload(request: FastifyRequest): void {
    const upload = pending.get(request);
    if (upload !== undefined) {
      pending.delete(request);
      clearTimeout(upload.timer);
      uploads.release(upload.bytes);
    }
  }

  function releaseDownload(request: FastifyRequest): void {
    const bytes = leaving.get(request);
    if (bytes !== undefined) {
      leaving.delete(request);
      downloads.release(bytes);
    }
  }

  app.get('/api/projects/:projectId/files', async (request, reply): Promise<ProjectFileList> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const { projectId } = paramsOf(projectParams, request);
      await requireProject(context, projectId);
      const rows = await listProjectFiles(context.client, projectId);
      const names = await peopleNames(
        context.client,
        rows.flatMap((row) => (row.created_by_user_id !== null ? [row.created_by_user_id] : [])),
      );
      return projectFileListSchema.parse({
        files: rows.map((row) => toFile(row, names)),
        storageAvailable: files.available,
      });
    }),
  );

  /**
   * The ticket of one upload. An ordinary small request: the session, the company and the
   * project are checked in its transaction, and what would refuse the upload anyway (no storage,
   * an empty or too large file) is said here, before a byte of the file is sent. The answer is a
   * signature over this session, company, project, file id and size, good for a minute; the
   * upload guard reads no body without it.
   */
  app.post(
    '/api/projects/:projectId/files/:fileId/ticket',
    async (request, reply): Promise<UploadTicket> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, fileId } = paramsOf(fileParams, request);
        const body = uploadTicketRequestSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        await requireProject(context, projectId);
        if (!files.available) {
          throw storageUnavailable();
        }
        if (body.data.sizeBytes <= 0) {
          throw fileEmpty();
        }
        if (body.data.sizeBytes > PROJECT_FILE_MAX_BYTES) {
          throw fileTooLarge();
        }
        const { ticket, expiresAt } = tickets.issue({
          sessionKeyHash: context.session.keyHash,
          companyId: context.companyId,
          projectId,
          fileId,
          sizeBytes: body.data.sizeBytes,
        });
        return uploadTicketSchema.parse({ ticket, expiresAt: expiresAt.toISOString() });
      }),
  );

  /**
   * The bytes of a file, always as a download: the answer says "attachment", names no type a
   * browser would show (application/octet-stream, nosniff) and carries a policy under which a
   * page could do nothing. The record is read in the request's transaction, under the row
   * policies; the storage is asked afterwards, and what it gives is checked against the record.
   */
  app.get(
    '/api/projects/:projectId/files/:fileId/content',
    {
      exposeHeadRoute: false,
      onResponse: (request, _reply, hookDone) => {
        releaseDownload(request);
        hookDone();
      },
    },
    async (request, reply) => {
      const row = await runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, fileId } = paramsOf(fileParams, request);
        await requireProject(context, projectId);
        const found = await files.find(context.client, projectId, fileId);
        if (!found) {
          throw notFound();
        }
        if (!files.available) {
          throw storageUnavailable();
        }
        return found;
      });
      // The connection may have ended while the transaction ran (a closed tab). Its 'close' has
      // then already been emitted and no answer will ever finish, so nothing would give the bytes
      // back: none are counted. Nothing is awaited between this line and the listener below.
      if (reply.raw.destroyed) {
        return reply;
      }
      // The file is read whole and checked before it is sent: its size is counted first, so the
      // downloads under way never hold more than their budget.
      if (!downloads.reserve(row.size_bytes)) {
        throw downloadsBusy();
      }
      leaving.set(request, row.size_bytes);
      reply.raw.once('close', () => {
        releaseDownload(request);
      });
      let content: Buffer | null;
      try {
        content = await files.content(row);
      } catch (error) {
        if (error instanceof FileStorageError) {
          request.log.error(
            { failure: { type: error.name, message: error.message } },
            'file storage failed',
          );
          throw storageFailed();
        }
        throw error;
      }
      if (content === null) {
        throw contentMissing();
      }
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', attachmentDisposition(row.name))
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox; frame-ancestors 'none'")
        .header('cross-origin-resource-policy', 'same-origin')
        .header('content-length', content.length)
        .send(content);
    },
  );

  /**
   * Deletes a file: the person who added it, the owner and the managers of the project, or the
   * founder (11 October decision 2). The record goes first and
   * the bytes after it, in this one transaction: if the storage fails, the deletion is rolled
   * back and the file is still there, so nothing the list no longer shows stays in the storage.
   */
  app.delete('/api/projects/:projectId/files/:fileId', async (request, reply): Promise<void> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const { projectId, fileId } = paramsOf(fileParams, request);
      await requireProject(context, projectId);
      const row = await files.find(context.client, projectId, fileId);
      if (!row) {
        throw notFound();
      }
      if (!row.deletable) {
        throw deleteNotAllowed();
      }
      if (!files.available) {
        throw storageUnavailable();
      }
      let removed: boolean;
      try {
        removed = await files.remove(context.client, projectId, fileId);
      } catch (error) {
        if (error instanceof FileStorageError) {
          request.log.error(
            { failure: { type: error.name, message: error.message } },
            'file storage failed',
          );
          throw storageFailed();
        }
        throw error;
      }
      if (!removed) {
        // Deleted by somebody else between the read and the delete.
        throw notFound();
      }
      reply.code(204);
    }),
  );

  // The upload has a scope of its own: only this ONE route takes a body of raw bytes. Every other
  // route of the files (and of the API) keeps the server's parsers, so a request with raw bytes
  // to any of them is refused before its body is read. Fastify counts the bytes while they
  // arrive and stops at the limit (also when the declared length lied); nothing over 25 MB is
  // ever held.
  void app.register((scope, _options, done) => {
    scope.addContentTypeParser(
      FILE_UPLOAD_CONTENT_TYPE,
      { parseAs: 'buffer', bodyLimit: PROJECT_FILE_MAX_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scope.setErrorHandler<FastifyError | ApiError | Error>((error, request, reply) => {
      const code = 'code' in error ? error.code : undefined;
      if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return errorHandler(fileTooLarge(), request, reply);
      }
      if (typeof code === 'string' && code.startsWith('FST_ERR_CTP_')) {
        return errorHandler(invalidRequest(), request, reply);
      }
      return errorHandler(error, request, reply);
    });

    /**
     * Adds a file. The panel chooses the id, so a send that is repeated (a lost answer, a double
     * click) answers the first record and stores nothing twice. The type is decided here, from
     * the name's extension and the bytes; the record and the bytes are written in this one
     * transaction, the record first: if the storage fails, the record is rolled back.
     */
    scope.put(
      '/api/projects/:projectId/files/:fileId',
      {
        onRequest: uploadGuard,
        // The body is here: its deadline ends.
        preValidation: (request, _reply, hookDone) => {
          bodyArrived(request);
          hookDone();
        },
        onResponse: (request, _reply, hookDone) => {
          releaseUpload(request);
          hookDone();
        },
        onRequestAbort: (request, hookDone) => {
          releaseUpload(request);
          hookDone();
        },
      },
      async (request, reply): Promise<ProjectFile> =>
        runner.withCompany(request, reply, INSIDERS, async (context) => {
          const { projectId, fileId } = paramsOf(fileParams, request);
          const { client, session } = context;
          const content = request.body;
          if (!Buffer.isBuffer(content)) {
            throw invalidRequest();
          }
          await requireProject(context, projectId);
          if (!files.available) {
            throw storageUnavailable();
          }
          const name = fileNameOf(request);
          const type = projectFileTypeOf(name);
          if (!type) {
            throw typeNotAllowed();
          }
          if (content.length === 0) {
            throw fileEmpty();
          }
          if (!contentMatches(content, type)) {
            throw contentMismatch();
          }
          const sha256 = createHash('sha256').update(content).digest('hex');
          // A send that is repeated: the same person, the same file under the same id.
          const repeated = async (): Promise<ProjectFile | null> => {
            const existing = await files.find(client, projectId, fileId);
            if (!existing) return null;
            if (
              existing.created_by_user_id !== session.userId ||
              existing.sha256 !== sha256 ||
              existing.name !== name
            ) {
              throw invalidRequest();
            }
            return fileOf(context, existing);
          };
          const first = await repeated();
          if (first) {
            return first;
          }
          await client.query('savepoint add_file');
          try {
            const row = await files.add(
              client,
              {
                id: fileId,
                projectId,
                name,
                mimeType: type.mimeType,
                sizeBytes: content.length,
                sha256,
              },
              content,
            );
            reply.code(201);
            return await fileOf(context, row);
          } catch (error) {
            if (error instanceof FileStorageError) {
              // Thrown past the savepoint: the whole transaction, and with it the record, goes.
              request.log.error(
                { failure: { type: error.name, message: error.message } },
                'file storage failed',
              );
              throw storageFailed();
            }
            const code = databaseErrorCode(error);
            if (code === undefined) {
              throw error;
            }
            await client.query('rollback to savepoint add_file');
            if (code === '54000') {
              throw databaseErrorConstraint(error) === 'project_files_size_limit'
                ? spaceFull()
                : limitReached();
            }
            if (code === '23505') {
              // The id is taken: by this person's own send that was still on its way (answered
              // like every repeated send), or by a record that is not theirs (nothing is said).
              const again = await repeated();
              if (again) return again;
              throw invalidRequest();
            }
            if (code === '42501' || code === '23503') {
              // The row policy refused: the person lost the project between the read above and
              // the insert. Answered like a project they cannot read.
              await requireProject(context, projectId);
              throw error;
            }
            // check_violation: a rule of the record this route should have caught.
            if (code === '23514') throw invalidRequest();
            throw error;
          }
        }),
    );

    done();
  });
}
