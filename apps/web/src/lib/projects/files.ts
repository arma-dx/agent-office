import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  FILE_UPLOAD_CONTENT_TYPE,
  UPLOAD_TICKET_HEADER,
  agentReads,
  projectFileListSchema,
  projectFileNameSchema,
  projectFileSchema,
  projectFileTypeOf,
  uploadTicketSchema,
  type AgentReads,
  type ProjectFile,
  type ProjectFileKind,
  type ProjectFileList,
  type ProjectFileProblem,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { API_ROOT, ApiError, apiRequest, errorFromBody, errorFromResponse } from '../api.ts';
import { formatWhen } from '../dates.ts';
import { personName } from '../requests/labels.ts';

/**
 * The files of a project (8 October 2026, decision 20): the list, adding, downloading and
 * deleting. The panel never talks to a file storage: every byte goes to the API and comes from it
 * (CLAUDE.md rule 1). The list is not refreshed on a timer; it is read again after every change
 * the person makes and when they come back to the window.
 */

export const projectFilesKey = (companyId: string, projectId: string) =>
  ['company', companyId, 'project-files', projectId] as const;

export function projectFilesQueryOptions(companyId: string, projectId: string) {
  return queryOptions({
    queryKey: projectFilesKey(companyId, projectId),
    queryFn: ({ signal }): Promise<ProjectFileList> =>
      apiRequest(`/projects/${projectId}/files`, {
        schema: projectFileListSchema,
        companyId,
        signal,
      }),
  });
}

const ids = z.object({ projectId: z.uuid(), fileId: z.uuid() });

export function deleteProjectFile(
  companyId: string,
  projectId: string,
  fileId: string,
): Promise<undefined> {
  const path = ids.parse({ projectId, fileId });
  return apiRequest(`/projects/${path.projectId}/files/${path.fileId}`, {
    method: 'DELETE',
    schema: z.undefined(),
    companyId,
  });
}

/** How long the browser gets to start saving before the bytes are let go. */
const SAVE_GRACE_MS = 60_000;

/**
 * Fetches a file and hands it to the browser to save under its name. A plain link cannot be used:
 * the API needs the company header. The bytes are never shown by the panel: they go into a
 * download, whatever their type.
 */
export async function downloadProjectFile(
  companyId: string,
  projectId: string,
  file: Pick<ProjectFile, 'id' | 'name'>,
): Promise<void> {
  const path = ids.parse({ projectId, fileId: file.id });
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}/projects/${path.projectId}/files/${path.fileId}/content`, {
      credentials: 'same-origin',
      headers: { [COMPANY_HEADER]: companyId },
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server');
  }
  if (!response.ok) throw await errorFromResponse(response);
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new ApiError(0, 'Could not reach the server');
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, SAVE_GRACE_MS);
}

export interface FileUpload {
  /** Settles when the API has stored the file, or with an ApiError; an abort rejects with an AbortError. */
  done: Promise<ProjectFile>;
  abort: () => void;
}

/**
 * Sends a file in two requests. First the ticket: a small request like every other, so whatever
 * refuses the upload for a reason the API can say (a closed session, a project that is gone, no
 * storage) is said in its words before a byte of the file leaves. Then the file itself as the raw
 * body of one request that carries the ticket, reporting how much of it has left the browser
 * (0 to 1). fetch cannot report that, so this one request uses XMLHttpRequest; its errors are the
 * same ApiError every other request gives. `fileId` is chosen by the caller and kept for a retry:
 * the API answers a repeated send of the same file with the first record. A new ticket is asked
 * for on every send.
 */
export function uploadProjectFile(input: {
  companyId: string;
  projectId: string;
  fileId: string;
  file: File;
  onProgress: (fraction: number) => void;
}): FileUpload {
  const path = ids.parse({ projectId: input.projectId, fileId: input.fileId });
  const name = projectFileNameSchema.parse(input.file.name);
  const url = `/projects/${path.projectId}/files/${path.fileId}`;
  const asking = new AbortController();
  let request: XMLHttpRequest | null = null;
  const stopped = (): DOMException => new DOMException('The upload was stopped', 'AbortError');

  const send = (ticket: string): Promise<ProjectFile> =>
    new Promise<ProjectFile>((resolve, reject) => {
      const sending = new XMLHttpRequest();
      request = sending;
      sending.open('PUT', `${API_ROOT}${url}`);
      sending.setRequestHeader('Content-Type', FILE_UPLOAD_CONTENT_TYPE);
      sending.setRequestHeader(COMPANY_HEADER, input.companyId);
      sending.setRequestHeader(FILE_NAME_HEADER, encodeURIComponent(name));
      sending.setRequestHeader(UPLOAD_TICKET_HEADER, ticket);
      sending.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) input.onProgress(event.loaded / event.total);
      };
      sending.onload = () => {
        let body: unknown = undefined;
        try {
          body = JSON.parse(sending.responseText) as unknown;
        } catch {
          // Not JSON (for example a proxy error page).
        }
        if (sending.status < 200 || sending.status >= 300) {
          reject(errorFromBody(sending.status, body));
          return;
        }
        const file = projectFileSchema.safeParse(body);
        if (file.success) resolve(file.data);
        else reject(new ApiError(502, 'Server response is not in the expected format'));
      };
      sending.onerror = () => {
        reject(new ApiError(0, 'Could not reach the server'));
      };
      sending.ontimeout = sending.onerror;
      sending.onabort = () => {
        reject(stopped());
      };
      sending.send(input.file);
    });

  const done = apiRequest(`${url}/ticket`, {
    method: 'POST',
    body: { sizeBytes: input.file.size },
    schema: uploadTicketSchema,
    companyId: input.companyId,
    signal: asking.signal,
  }).then(
    ({ ticket }) => {
      if (asking.signal.aborted) throw stopped();
      return send(ticket);
    },
    (error: unknown) => {
      // Stopped while the ticket was asked for: the same AbortError as a stopped send.
      throw asking.signal.aborted ? stopped() : error;
    },
  );
  return {
    done,
    abort: () => {
      asking.abort();
      request?.abort();
    },
  };
}

// Words -----------------------------------------------------------------------------------------

export const FILE_KIND: Record<ProjectFileKind, string> = {
  document: 'Belge',
  spreadsheet: 'Tablo',
  presentation: 'Sunum',
  pdf: 'PDF',
  image: 'Resim',
  text: 'Metin',
};

/** The types a file can have, as the dialog and the API's own refusal list them. */
export const FILE_TYPES_SENTENCE =
  'Eklenebilen türler: PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, PNG, JPG, GIF ve WEBP.';

/**
 * Why a chosen file is not sent, in the words the API uses for the same refusal (the panel says
 * it before anything is sent; the API decides again).
 */
export const FILE_PROBLEM: Record<ProjectFileProblem, string> = {
  name: 'Dosya adı kullanılamıyor. Ad en çok 200 karakter olabilir; eğik çizgi ve ters eğik çizgi içeremez. Dosyayı yeniden adlandırıp tekrar deneyin.',
  type: `Bu dosya türü eklenemez. ${FILE_TYPES_SENTENCE}`,
  empty: 'Dosya boş. İçeriği olan bir dosya seçin.',
  too_large: 'Dosya 25 MB sınırını aşıyor. Daha küçük bir dosya seçin.',
};

/**
 * The sentences of the upload dialog that are rules, not labels.
 * - personalData: 8 October decision 21 (docs/SONRA.md P-g). The code cannot tell personal data;
 *   the rule is kept by this sentence and by the person who adds the file.
 * - agentsRead: 11 October decision 3; since step 6 agents read (8 October decision 21). It is a
 *   sentence about every project, not about the state of this one: the permission can be opened
 *   after the file was added. It names the three formats agents do not read and the way round
 *   (docs/SONRA.md P6-b).
 * - agentsCannotReadKind, agentsCannotReadSize: hints under a chosen file that agents will not
 *   read. They stop nothing: every one of the twelve types can still be added.
 */
export const FILE_DIALOG_TEXT = {
  personalData: 'Avukatın görüşü gelene kadar projeye kişisel veri içeren dosya eklenmez.',
  agentsRead:
    'Yapay zekâ izni açık projede ajanlar PDF, resim ve metin dosyalarını (TXT, MD, CSV) okur; okunan dosya modele gönderilir. Word, Excel ve PowerPoint dosyalarını okuyamaz: ajanın okumasını istiyorsanız PDF olarak kaydedip ekleyin.',
  agentsCannotReadKind: 'Bu dosya eklenir, ama ajanlar bu türü okuyamaz.',
  agentsCannotReadSize: 'Bu dosya eklenir, ama ajanların okuyabileceğinden büyük.',
  sizeLimit: 'Dosya başına en çok 25 MB.',
  chooseFirst: 'Önce bir dosya seçin.',
  stored: 'Dosya gönderildi, kaydediliyor.',
  sendingForScreenReader: 'Dosya yükleniyor.',
} as const;

/**
 * The sentences of the "Dosyalar" tab. Who sees and adds is docs/SONRA.md P-k; who deletes is 11
 * October decision 2 (the person who added the file, the owner and the managers of the project,
 * the founder). noStorage is the API's own sentence for the same state.
 * - agentsRead, agentsDoNotRead: what agents do with the files of THIS project (8 October decision
 *   21; step 6). The first is shown while agents may work in the project, the second otherwise
 *   (no AI permission, a customer that does not allow AI, a reached spending limit). Whether a
 *   long file is too long for an agent is known only when the model's provider counts it, so no
 *   row can say it beforehand: the sentence names the page where the person will read it
 *   (docs/SONRA.md P6-d, P6-g).
 */
export const FILES_TEXT = {
  emptyTitle: 'Bu projede dosya yok',
  emptyDescription:
    'Belge, tablo, sunum, PDF, resim ve metin dosyaları ekleyebilirsiniz. Dosyaları proje üyeleri ve kurucu görür.',
  whoDoesWhat:
    'Dosyaları proje üyeleri ve kurucu görür ve ekler. Bir dosyayı ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu siler.',
  agentsRead:
    'Bu projede çalışan ajanlar, işi için gerekirse PDF, resim ve metin dosyalarını (TXT, MD, CSV) okur; okunan dosya modele gönderilir. Word, Excel ve PowerPoint dosyalarını okuyamaz. Çok uzun bir dosyayı da okuyamayabilir; okuyamadığı dosyayı talep sayfası söyler.',
  agentsDoNotRead: 'Bu projede ajanlar şu an çalışamaz; dosyaları da okumaz.',
  noStorage: 'Dosya deposu bu ortamda kurulu değil. Dosya eklenemez, indirilemez ve silinemez.',
  deleteDescription: 'Dosya projeden ve dosya deposundan silinir. Bu işlem geri alınamaz.',
} as const;

const oneDecimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** A size as a person reads it: "850 B", "12,4 KB", "3,2 MB" (1 KB is 1024 B, as the limit counts). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${oneDecimal.format(bytes / 1024)} KB`;
  return `${oneDecimal.format(bytes / (1024 * 1024))} MB`;
}

/** The first fact of a row: what the file is and how large. "PDF, 1,2 MB". */
export function fileFactsLine(file: { kind: ProjectFileKind; sizeBytes: number }): string {
  return `${FILE_KIND[file.kind]}, ${formatBytes(file.sizeBytes)}`;
}

/**
 * Who added a file, the words before the time: "Ayşe Yılmaz ekledi"; a person who left the
 * company is "Eski üye"; a file written without a person (an administrator) is "Eklendi".
 */
export function fileAddedBy(file: Pick<ProjectFile, 'createdBy'>): string {
  return file.createdBy ? `${personName(file.createdBy)} ekledi` : 'Eklendi';
}

/** The second fact of a row: who added the file and when. "Ayşe Yılmaz ekledi, 3 gün önce". */
export function fileAddedLine(
  file: Pick<ProjectFile, 'createdBy' | 'createdAt'>,
  now: number = Date.now(),
): string {
  return `${fileAddedBy(file)}, ${formatWhen(file.createdAt, now)}`;
}

/**
 * Can agents read a file, as far as its name and its size say (the contract's own answer:
 * agentReads). A name whose extension is not in the list is a type agents do not read. 'yes' is
 * not a promise: the model's provider counts the file when an agent asks for it.
 */
export function agentsReadFile(file: { name: string; sizeBytes: number }): AgentReads {
  const type = projectFileTypeOf(file.name);
  return type === null ? 'kind' : agentReads(type.mimeType, file.sizeBytes);
}

/**
 * What agents cannot do with a file, in a few words; null when they can read it. A fact about the
 * file, whatever the project's AI permission.
 */
export function fileAgentLine(file: { name: string; sizeBytes: number }): string | null {
  const reads = agentsReadFile(file);
  return reads === 'kind'
    ? 'Ajanlar bu türü okuyamaz'
    : reads === 'size'
      ? 'Ajanların okuyabileceğinden büyük'
      : null;
}
