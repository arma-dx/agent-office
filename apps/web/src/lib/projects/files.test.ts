import {
  AGENT_IMAGE_MAX_BYTES,
  AGENT_PDF_MAX_BYTES,
  AGENT_TEXT_MAX_BYTES,
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_TYPES,
  UPLOAD_TICKET_HEADER,
  projectFileProblem,
} from '@agent-office/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpload } from '../../test/mock-upload.ts';
import { ApiError } from '../api.ts';
import {
  FILE_DIALOG_TEXT,
  FILE_PROBLEM,
  FILES_TEXT,
  agentsReadFile,
  downloadProjectFile,
  fileAddedLine,
  fileAgentLine,
  fileFactsLine,
  formatBytes,
  uploadProjectFile,
} from './files.ts';

const COMPANY = '6f1c2a3b-4d5e-4f60-8a71-0b2c3d4e5f60';
const PROJECT = 'a1111111-1111-4111-8111-111111111111';
const FILE = 'f1111111-1111-4111-8111-111111111111';
const ANSWER = {
  id: FILE,
  name: 'Şartname.pdf',
  kind: 'pdf',
  sizeBytes: 3,
  createdAt: '2026-10-09T09:00:00.000Z',
  createdBy: { userId: '9c4f5d6e-7a8b-4c93-bd04-3e5f6a7b8c93', name: 'Ömer Kadıoğlu' },
  deletable: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('uploadProjectFile', () => {
  const TICKET = { ticket: `1791500000.${'A'.repeat(43)}`, expiresAt: '2026-10-09T09:01:00.000Z' };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  /** Starts an upload; the ticket request is answered with `ticket`, the send waits in `uploads`. */
  const start = (
    name = 'Şartname.pdf',
    ticket: () => Promise<Response> = () => Promise.resolve(json(200, TICKET)),
  ) => {
    const { uploads } = mockUpload();
    const asked = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => ticket());
    vi.stubGlobal('fetch', asked);
    const seen: number[] = [];
    const file = new File(['abc'], name, { type: 'text/html' });
    const upload = uploadProjectFile({
      companyId: COMPANY,
      projectId: PROJECT,
      fileId: FILE,
      file,
      onProgress: (fraction) => seen.push(fraction),
    });
    const sent = async () => {
      await vi.waitFor(() => {
        expect(uploads).toHaveLength(1);
      });
      const [first] = uploads;
      if (!first) throw new Error('nothing was sent');
      return first;
    };
    return { upload, sent, uploads, seen, file, asked };
  };

  it('asks for a ticket, then sends the file itself as raw bytes with it, and reports the progress', async () => {
    const { upload, sent, seen, file, asked } = start();
    const put = await sent();
    expect(asked).toHaveBeenCalledTimes(1);
    const [url, init] = asked.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${PROJECT}/files/${FILE}/ticket`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ sizeBytes: 3 }));
    expect(init?.headers).toMatchObject({ [COMPANY_HEADER]: COMPANY });
    expect(put.method).toBe('PUT');
    expect(put.path).toBe(`/projects/${PROJECT}/files/${FILE}`);
    expect(put.headers).toEqual({
      'content-type': 'application/octet-stream',
      [COMPANY_HEADER]: COMPANY,
      [FILE_NAME_HEADER]: '%C5%9Eartname.pdf',
      [UPLOAD_TICKET_HEADER]: TICKET.ticket,
    });
    expect(put.body).toBe(file);
    put.progress(1, 4);
    put.progress(4, 4);
    expect(seen).toEqual([0.25, 1]);
    put.respond(201, ANSWER);
    await expect(upload.done).resolves.toEqual(ANSWER);
  });

  it('sends a decomposed name composed', async () => {
    const { sent } = start('S\u0327artname.pdf');
    expect((await sent()).headers[FILE_NAME_HEADER]).toBe('%C5%9Eartname.pdf');
  });

  it('sends nothing when the ticket is refused, and gives the API error', async () => {
    const closed = start('a.pdf', () =>
      Promise.resolve(
        json(401, { error: { code: 'unauthenticated', message: 'Oturumunuz kapalı.' } }),
      ),
    );
    await expect(closed.upload.done).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthenticated',
    });
    expect(closed.uploads).toHaveLength(0);
    const offline = start('a.pdf', () => Promise.reject(new TypeError('offline')));
    await expect(offline.upload.done).rejects.toMatchObject({ name: 'ApiError', status: 0 });
    expect(offline.uploads).toHaveLength(0);
    const odd = start('a.pdf', () => Promise.resolve(json(200, { ticket: '' })));
    await expect(odd.upload.done).rejects.toMatchObject({ status: 502 });
    expect(odd.uploads).toHaveLength(0);
  });

  it('turns a refusal into the same ApiError every request gives', async () => {
    const { upload, sent } = start();
    (await sent()).respond(415, {
      error: {
        code: 'file_content_mismatch',
        message: 'Dosyanın içeriği uzantısının söylediği türde değil.',
      },
    });
    await expect(upload.done).rejects.toMatchObject({
      name: 'ApiError',
      status: 415,
      code: 'file_content_mismatch',
      message: 'Dosyanın içeriği uzantısının söylediği türde değil.',
    });
    const page = start();
    (await page.sent()).respond(502, '<html>Bad gateway</html>');
    await expect(page.upload.done).rejects.toMatchObject({ status: 502, code: undefined });
    const odd = start();
    (await odd.sent()).respond(201, { id: 'x' });
    await expect(odd.upload.done).rejects.toMatchObject({ status: 502 });
  });

  it('says so when the connection breaks, and rejects with an AbortError when it is stopped', async () => {
    const broken = start();
    (await broken.sent()).fail();
    await expect(broken.upload.done).rejects.toMatchObject({ name: 'ApiError', status: 0 });
    const stopped = start();
    const put = await stopped.sent();
    stopped.upload.abort();
    expect(put.aborted).toBe(true);
    await expect(stopped.upload.done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stopped while the ticket is asked for: an AbortError, and nothing is sent', async () => {
    const early = start('a.pdf', () => new Promise<Response>(() => undefined));
    const [, init] = early.asked.mock.calls[0] ?? [];
    early.upload.abort();
    expect(init?.signal?.aborted).toBe(true);
    // The stand-in never answers; a real fetch rejects when its signal aborts.
    const late = start('a.pdf', () => Promise.resolve(json(200, TICKET)));
    late.upload.abort();
    await expect(late.upload.done).rejects.toMatchObject({ name: 'AbortError' });
    expect(late.uploads).toHaveLength(0);
  });
});

describe('downloadProjectFile', () => {
  it('fetches the bytes with the company header and hands them to the browser under the name', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('abc', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const created = vi.fn(() => 'blob:panel/1');
    const revoked = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }),
    );
    const clicked: { href: string; download: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    await downloadProjectFile(COMPANY, PROJECT, { id: FILE, name: 'Şartname.pdf' });
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT}/files/${FILE}/content`, {
      credentials: 'same-origin',
      headers: { [COMPANY_HEADER]: COMPANY },
    });
    expect(clicked).toEqual([{ href: 'blob:panel/1', download: 'Şartname.pdf' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoked).toHaveBeenCalledWith('blob:panel/1');
    click.mockRestore();
  });

  it('gives the API error of a refused download and saves nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'file_content_missing',
                message: 'Bu dosyanın içeriği depoda bulunamadı.',
              },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await expect(
      downloadProjectFile(COMPANY, PROJECT, { id: FILE, name: 'a.pdf' }),
    ).rejects.toMatchObject({ status: 404, code: 'file_content_missing' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('failed'))),
    );
    await expect(
      downloadProjectFile(COMPANY, PROJECT, { id: FILE, name: 'a.pdf' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe('the words of a file', () => {
  it('writes a size with a Turkish decimal comma', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(12_700)).toBe('12,4 KB');
    expect(formatBytes(3_355_443)).toBe('3,2 MB');
    expect(formatBytes(PROJECT_FILE_MAX_BYTES)).toBe('25 MB');
  });

  it('has a sentence for every reason a chosen file is not sent', () => {
    expect(projectFileProblem({ name: 'a.pdf', size: 10 })).toBeNull();
    expect(projectFileProblem({ name: 'a/b.pdf', size: 10 })).toBe('name');
    expect(projectFileProblem({ name: 'a.exe', size: 10 })).toBe('type');
    expect(projectFileProblem({ name: 'a.pdf', size: 0 })).toBe('empty');
    expect(projectFileProblem({ name: 'a.pdf', size: PROJECT_FILE_MAX_BYTES + 1 })).toBe(
      'too_large',
    );
    expect(projectFileProblem({ name: 'a.pdf', size: PROJECT_FILE_MAX_BYTES })).toBeNull();
    for (const sentence of Object.values(FILE_PROBLEM)) expect(sentence.endsWith('.')).toBe(true);
  });

  it('writes the facts of a file', () => {
    expect(fileFactsLine({ kind: 'pdf', sizeBytes: 1_258_291 })).toBe('PDF, 1,2 MB');
    expect(fileFactsLine({ kind: 'spreadsheet', sizeBytes: 850 })).toBe('Tablo, 850 B');
    expect(fileFactsLine({ kind: 'document', sizeBytes: 12_700 })).toBe('Belge, 12,4 KB');
  });

  it('says who added a file and when, also when nobody is named', () => {
    const now = Date.parse('2026-10-12T09:00:00.000Z');
    const person = { userId: '9c4f5d6e-7a8b-4c93-bd04-3e5f6a7b8c93', name: 'Ayşe Yılmaz' };
    const threeDays = '2026-10-09T09:00:00.000Z';
    expect(fileAddedLine({ createdBy: person, createdAt: threeDays }, now)).toBe(
      'Ayşe Yılmaz ekledi, 3 gün önce',
    );
    // A person who left the company has no name any more.
    expect(fileAddedLine({ createdBy: { ...person, name: null }, createdAt: threeDays }, now)).toBe(
      'Eski üye ekledi, 3 gün önce',
    );
    // Written without a person: the sentence still reads after a week, when the time is a date.
    expect(fileAddedLine({ createdBy: null, createdAt: threeDays }, now)).toBe(
      'Eklendi, 3 gün önce',
    );
    expect(fileAddedLine({ createdBy: null, createdAt: '2026-09-28T09:00:00.000Z' }, now)).toBe(
      'Eklendi, 28 Eyl',
    );
  });
});

// 8 October decision 21, step 6: agents read PDF, image and text files; Word, Excel and PowerPoint
// files are not read (docs/SONRA.md P6-b).
describe('what agents read of a file, in words', () => {
  it('marks the three Office formats and no other of the twelve extensions', () => {
    expect(PROJECT_FILE_TYPES).toHaveLength(12);
    const unread = PROJECT_FILE_TYPES.filter(
      (type) => fileAgentLine({ name: `dosya.${type.extension}`, sizeBytes: 1000 }) !== null,
    ).map((type) => type.extension);
    expect(unread).toEqual(['docx', 'xlsx', 'pptx']);
    for (const extension of unread) {
      expect(fileAgentLine({ name: `Teklif.${extension}`, sizeBytes: 1000 })).toBe(
        'Ajanlar bu türü okuyamaz',
      );
      // The extension is read as the list reads it: whatever its case.
      expect(agentsReadFile({ name: `Teklif.${extension.toUpperCase()}`, sizeBytes: 1000 })).toBe(
        'kind',
      );
    }
    // A name the list does not know is a type agents do not read.
    expect(fileAgentLine({ name: 'arşiv.zip', sizeBytes: 1000 })).toBe('Ajanlar bu türü okuyamaz');
    expect(fileAgentLine({ name: 'adsız', sizeBytes: 1000 })).toBe('Ajanlar bu türü okuyamaz');
  });

  it('marks a file over the bytes an agent is given of its form, and not one at the limit', () => {
    const cases: [string, number][] = [
      ['Şartname.pdf', AGENT_PDF_MAX_BYTES],
      ['afiş.png', AGENT_IMAGE_MAX_BYTES],
      ['afiş.jpeg', AGENT_IMAGE_MAX_BYTES],
      ['liste.csv', AGENT_TEXT_MAX_BYTES],
      ['notlar.md', AGENT_TEXT_MAX_BYTES],
    ];
    for (const [name, limit] of cases) {
      expect(fileAgentLine({ name, sizeBytes: limit })).toBeNull();
      expect(agentsReadFile({ name, sizeBytes: limit })).toBe('yes');
      expect(fileAgentLine({ name, sizeBytes: limit + 1 })).toBe(
        'Ajanların okuyabileceğinden büyük',
      );
    }
    // A PDF of 25 MB can be added and is over the 20 MB an agent is given.
    expect(AGENT_PDF_MAX_BYTES).toBeLessThan(PROJECT_FILE_MAX_BYTES);
    expect(fileAgentLine({ name: 'Şartname.pdf', sizeBytes: PROJECT_FILE_MAX_BYTES })).toBe(
      'Ajanların okuyabileceğinden büyük',
    );
    // The type is said before the size: an Office file is not read at any size.
    expect(fileAgentLine({ name: 'Sunum.pptx', sizeBytes: PROJECT_FILE_MAX_BYTES })).toBe(
      'Ajanlar bu türü okuyamaz',
    );
  });

  it('says in the dialog what agents read, names the three formats they do not, and the way round', () => {
    const sentence = FILE_DIALOG_TEXT.agentsRead;
    expect(sentence).toBe(
      'Yapay zekâ izni açık projede ajanlar PDF, resim ve metin dosyalarını (TXT, MD, CSV) okur; okunan dosya modele gönderilir. Word, Excel ve PowerPoint dosyalarını okuyamaz: ajanın okumasını istiyorsanız PDF olarak kaydedip ekleyin.',
    );
    for (const word of ['Word', 'Excel', 'PowerPoint', 'PDF olarak', 'modele gönderilir']) {
      expect(sentence).toContain(word);
    }
    // The two hints say that the file is added all the same.
    expect(FILE_DIALOG_TEXT.agentsCannotReadKind).toBe(
      'Bu dosya eklenir, ama ajanlar bu türü okuyamaz.',
    );
    expect(FILE_DIALOG_TEXT.agentsCannotReadSize).toBe(
      'Bu dosya eklenir, ama ajanların okuyabileceğinden büyük.',
    );
  });

  it('has two different sentences for the tab, and the first names the page that says what was not read', () => {
    expect(FILES_TEXT.agentsRead).not.toBe(FILES_TEXT.agentsDoNotRead);
    expect(FILES_TEXT.agentsDoNotRead).toBe(
      'Bu projede ajanlar şu an çalışamaz; dosyaları da okumaz.',
    );
    // Whether a long file is too long is known only when an agent asks for it.
    expect(FILES_TEXT.agentsRead).toContain('okuyamadığı dosyayı talep sayfası söyler');
    for (const word of ['PDF', 'TXT, MD, CSV', 'Word, Excel ve PowerPoint', 'modele gönderilir']) {
      expect(FILES_TEXT.agentsRead).toContain(word);
    }
    // No number of pages is promised: none is measured.
    expect(FILES_TEXT.agentsRead).not.toMatch(/\d/);
  });

  it('speaks of what agents do now, in whole sentences without a long dash', () => {
    const sentences = [
      FILE_DIALOG_TEXT.agentsRead,
      FILE_DIALOG_TEXT.agentsCannotReadKind,
      FILE_DIALOG_TEXT.agentsCannotReadSize,
      FILES_TEXT.agentsRead,
      FILES_TEXT.agentsDoNotRead,
    ];
    for (const sentence of sentences) {
      // "okuyacak" was the promise of the step before (11 October decision 3): agents read now.
      expect(sentence).not.toMatch(/okuyacak/);
      expect(sentence).not.toMatch(/[\u2014\u00b7]/u);
      expect(sentence.endsWith('.')).toBe(true);
    }
    // No sentence says "all the files" any more: three formats are not read.
    expect(Object.values(FILE_DIALOG_TEXT).join(' ')).not.toMatch(/bütün dosyalar/);
  });
});
