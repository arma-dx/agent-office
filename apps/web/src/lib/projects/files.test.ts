import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  PROJECT_FILE_MAX_BYTES,
  UPLOAD_TICKET_HEADER,
  projectFileProblem,
} from '@agent-office/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpload } from '../../test/mock-upload.ts';
import { ApiError } from '../api.ts';
import {
  FILE_PROBLEM,
  downloadProjectFile,
  fileAddedLine,
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
