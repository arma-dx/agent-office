import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  PROJECT_FILE_MAX_BYTES,
  UPLOAD_TICKET_HEADER,
} from '@agent-office/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddFileDialog } from './components/projects/add-file-dialog.tsx';
import { Toaster } from './components/ui/sonner.tsx';
import { useReturnFocus } from './lib/focus.ts';
import {
  FILE_DIALOG_TEXT,
  FILE_PROBLEM,
  FILE_TYPES_SENTENCE,
  fileAddedLine,
  fileFactsLine,
} from './lib/projects/files.ts';
import { CompanyContext } from './lib/session.ts';
import { apiError, ARMADX, json, mockApi, noContent, type Handler } from './test/mock-api.ts';
import { mockUpload, type SentUpload } from './test/mock-upload.ts';
import {
  EMPLOYEE_AT_ARMADX,
  FILES,
  filesHandler,
  PROJECT_ID,
  projectDetail,
  projectFile,
  projectFilesRoute,
  projectForEmployee,
  projectHandlers,
  sessionAs,
  ticketHandlers,
  ticketRoute,
  UPLOAD_IDS,
  UPLOAD_TICKET,
} from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The files of a project (8 October 2026, decisions 11 and 20): the "Dosyalar" tab of its page
// (list, download, delete) and the dialog that sends one file.

beforeEach(() => {
  // The dialog gives every chosen file a random id; here the ids come in a known order, so the
  // fake API can answer the ticket request of each.
  let next = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    const id = UPLOAD_IDS[next % UPLOAD_IDS.length];
    next += 1;
    return id as ReturnType<typeof crypto.randomUUID>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pdf = (name = 'Şartname.pdf', content = 'abc') =>
  new File([content], name, { type: 'application/pdf' });

/** A file that says it has `size` bytes, without holding them. */
function sized(name: string, size: number): File {
  const file = pdf(name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const dialog = () => screen.findByRole('dialog', { name: 'Dosya ekle' });
const field = (box: HTMLElement) => within(box).getByLabelText('Dosya');
const button = (box: HTMLElement, name: string) => within(box).getByRole('button', { name });
const gone = async () => {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
};
/** The upload that waits for its answer, once its ticket request was answered. */
async function sent(uploads: SentUpload[], count = 1): Promise<SentUpload> {
  await waitFor(() => {
    expect(uploads).toHaveLength(count);
  });
  const upload = uploads[count - 1];
  if (!upload) throw new Error('nothing was sent');
  return upload;
}
/** The file id in the address of an upload or of a ticket request. */
const idOf = (path: string) => path.split('/')[4];

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const TAB = `${PATH}?tab=files`;
const LIST = projectFilesRoute();
const content = (id: string) => `GET /projects/${PROJECT_ID}/files/${id}/content`;
const remove = (id: string) => `DELETE /projects/${PROJECT_ID}/files/${id}`;
const [NOTES, TABLE, SPEC] = FILES as [(typeof FILES)[0], (typeof FILES)[0], (typeof FILES)[0]];

const tabPanel = () => screen.findByRole('tabpanel', { name: 'Dosyalar' });
const section = (count: number) =>
  screen.findByRole('region', { name: `Dosyalar ${String(count)}` });
const row = (name: string) => screen.getByRole('group', { name });
const heading = () => screen.getByRole('heading', { level: 3, name: /^Dosyalar/ });

/** An answer the test gives when it chooses to. */
function held(): { handler: Handler; answer: (response: Response) => void } {
  let release: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { handler: () => pending, answer: release };
}

/** What a browser does with a download is the browser's: here it is only counted. */
function stubSaving() {
  const created = vi.fn(() => 'blob:panel/1');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
  const saved: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
  return { saved };
}

describe('the Dosyalar tab', () => {
  it('lists the files with their kind, size, who added them and when', async () => {
    const api = mockApi(projectHandlers(projectDetail(), { [LIST]: filesHandler() }));
    renderApp(TAB);
    const region = await section(3);
    // The count stands beside the heading.
    expect(heading()).toHaveTextContent('Dosyalar 3');
    const items = within(region).getAllByRole('listitem');
    // In the order the API answers: newest first.
    expect(items).toHaveLength(3);
    for (const [index, file] of FILES.entries()) {
      const group = row(file.name);
      expect(items[index]).toContainElement(group);
      // Two short sentences: what the file is, who added it and when.
      expect(group).toHaveTextContent(`${fileFactsLine(file)}. ${fileAddedLine(file)}.`);
      const time = group.querySelector('time');
      expect(time).toHaveAttribute('datetime', file.createdAt);
      expect(time).toHaveAttribute('title');
      // The whole name is in the title: the row cuts a long one.
      expect(within(group).getByText(file.name)).toHaveAttribute('title', file.name);
      expect(within(group).getByRole('button', { name: 'İndir' })).toBeVisible();
    }
    expect(row('Şartname.pdf')).toHaveTextContent('PDF, 1,2 MB. Ömer Kadıoğlu ekledi, ');
    expect(row('Maliyet tablosu.xlsx')).toHaveTextContent('Tablo, 12,4 KB. Ayşe Yılmaz ekledi, ');
    // A file written without a person.
    expect(row('notlar.txt')).toHaveTextContent('Metin, 850 B. Eklendi, ');
    // Who sees, who adds and who deletes (11 October decision 2), under the list.
    expect(
      within(region).getByText(
        'Dosyaları proje üyeleri ve kurucu görür ve ekler. Bir dosyayı ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu siler.',
      ),
    ).toBeVisible();
    expect(within(region).getAllByRole('button', { name: 'Dosya ekle' })).toHaveLength(1);
    // The list is not asked for on a timer, and not as a background request.
    expect(api.callsTo(LIST)).toHaveLength(1);
    expect(api.callsTo(LIST)[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(api.unexpected).toEqual([]);
  });

  it('opens from the address and keeps the tab on a reload', async () => {
    const first = mockApi(projectHandlers(projectDetail(), { [LIST]: filesHandler() }));
    const { router } = renderApp(PATH);
    const tab = await screen.findByRole('tab', { name: 'Dosyalar' });
    // "Talepler" is shown; nothing asks for the files of a tab nobody opened.
    expect(tab).toHaveAttribute('aria-selected', 'false');
    await screen.findByRole('heading', { name: 'Bu projede henüz talep yok' });
    expect(first.callsTo(LIST)).toHaveLength(0);
    // The base tabs in the order decision 17 names them: "Dosyalar" directly after "Talepler".
    const names = screen.getAllByRole('tab').map((item) => item.textContent);
    expect(names.slice(0, 2)).toEqual(['Talepler', 'Dosyalar']);
    expect(names.at(-1)).toBe('Ayarlar');
    await userEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'files' } });
    });
    expect(within(await tabPanel()).getByRole('group', { name: 'Şartname.pdf' })).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(first.callsTo(LIST)).toHaveLength(1);
    cleanup();

    // The address keeps the tab: a reload or a shared link opens it again.
    mockApi(projectHandlers(projectDetail(), { [LIST]: filesHandler() }));
    renderApp(TAB);
    expect(await screen.findByRole('tab', { name: 'Dosyalar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await section(3)).toBeVisible();
  });

  it('shows the first step when the project has no file', async () => {
    mockApi(projectHandlers());
    renderApp(TAB);
    const region = await section(0);
    expect(within(region).getByRole('heading', { name: 'Bu projede dosya yok' })).toBeVisible();
    expect(
      within(region).getByText(
        'Belge, tablo, sunum, PDF, resim ve metin dosyaları ekleyebilirsiniz. Dosyaları proje üyeleri ve kurucu görür.',
      ),
    ).toBeVisible();
    // One "Dosya ekle": the empty state's.
    expect(within(region).getAllByRole('button', { name: 'Dosya ekle' })).toHaveLength(1);
    expect(within(region).queryByRole('list')).toBeNull();
    expect(within(region).queryByText(/siler\.$/)).toBeNull();
  });

  it('says so when the list cannot be read, and reads it again', async () => {
    const first = held();
    const api = mockApi(projectHandlers(projectDetail(), { [LIST]: first.handler }));
    renderApp(TAB);
    const panel = await tabPanel();
    expect(within(panel).getByText('Yükleniyor')).toBeInTheDocument();
    // Nothing is counted and nothing is offered before the list is read.
    expect(heading()).toHaveTextContent(/^Dosyalar\s*$/);
    expect(within(panel).queryByRole('button', { name: 'Dosya ekle' })).toBeNull();
    first.answer(apiError(409, 'invalid_request', 'Dosyalar şu anda okunamadı. Yeniden deneyin.'));
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent('Dosyalar şu anda okunamadı. Yeniden deneyin.');
    expect(within(panel).queryByRole('button', { name: 'Dosya ekle' })).toBeNull();
    api.handle(LIST, filesHandler());
    await userEvent.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
    expect(await section(3)).toBeVisible();
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('offers nothing where the storage is not set up', async () => {
    mockApi(projectHandlers(projectDetail(), { [LIST]: filesHandler(FILES, false) }));
    renderApp(TAB);
    const region = await section(3);
    expect(within(region).getByRole('note')).toHaveTextContent(
      'Dosya deposu bu ortamda kurulu değil. Dosya eklenemez, indirilemez ve silinemez.',
    );
    // The files are still listed; nothing that needs the storage is offered.
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
    expect(row('Şartname.pdf')).toHaveTextContent('PDF, 1,2 MB.');
    expect(within(region).queryByRole('button')).toBeNull();
    cleanup();

    // Without a file there is the sentence alone: no first step that could not be taken.
    mockApi(projectHandlers(projectDetail(), { [LIST]: filesHandler([], false) }));
    renderApp(TAB);
    const empty = await section(0);
    expect(within(empty).getByRole('note')).toHaveTextContent(
      'Dosya deposu bu ortamda kurulu değil.',
    );
    expect(within(empty).queryByRole('button')).toBeNull();
    expect(within(empty).queryByRole('heading', { name: 'Bu projede dosya yok' })).toBeNull();
  });

  it('offers "Sil" only where the API says the reader may delete', async () => {
    // A plain member: their own file, not a colleague's.
    const files = [
      projectFile({ ...TABLE, deletable: false }),
      projectFile({ ...SPEC, deletable: true }),
    ];
    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [LIST]: filesHandler(files),
      }),
    );
    renderApp(TAB);
    await section(2);
    expect(within(row('Şartname.pdf')).getByRole('button', { name: 'Sil' })).toBeVisible();
    expect(within(row('Maliyet tablosu.xlsx')).queryByRole('button', { name: 'Sil' })).toBeNull();
    // Both can be downloaded, and a member adds a file.
    expect(
      within(row('Maliyet tablosu.xlsx')).getByRole('button', { name: 'İndir' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dosya ekle' })).toBeVisible();
  });

  it('downloads a file as a download, and says why when it cannot', async () => {
    const { saved } = stubSaving();
    const bytes = held();
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [LIST]: filesHandler(),
        [content(SPEC.id)]: bytes.handler,
      }),
    );
    renderApp(TAB);
    await section(3);
    const download = within(row('Şartname.pdf')).getByRole('button', { name: 'İndir' });
    await userEvent.click(download);
    // While the bytes come the button says so and ignores a second press; the other rows go on.
    expect(download).toHaveTextContent('İndiriliyor');
    expect(download).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(download);
    expect(api.callsTo(content(SPEC.id))).toHaveLength(1);
    expect(api.callsTo(content(SPEC.id))[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(within(row('notlar.txt')).getByRole('button', { name: 'İndir' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(within(row('Şartname.pdf')).getByRole('button', { name: 'Sil' })).not.toHaveAttribute(
      'aria-disabled',
    );
    bytes.answer(new Response('abc', { status: 200 }));
    await waitFor(() => {
      expect(saved).toEqual(['Şartname.pdf']);
    });
    await waitFor(() => {
      expect(download).toHaveTextContent('İndir');
      expect(download).not.toHaveAttribute('aria-disabled');
    });
    // The panel shows nothing of the file and says nothing: the browser shows its download.
    expect(within(await tabPanel()).queryByRole('status')).toBeNull();

    // The record is there, the content is not: the API's sentence, and the list is read again.
    api.handle(content(NOTES.id), () =>
      apiError(
        404,
        'file_content_missing',
        'Bu dosyanın içeriği depoda bulunamadı. Dosyayı ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu silip yeniden ekleyebilir.',
      ),
    );
    await userEvent.click(within(row('notlar.txt')).getByRole('button', { name: 'İndir' }));
    expect(
      await screen.findByText(/^Bu dosyanın içeriği depoda bulunamadı\. Dosyayı ekleyen kişi/),
    ).toBeVisible();
    await waitFor(() => {
      expect(api.callsTo(LIST)).toHaveLength(2);
    });
    expect(saved).toEqual(['Şartname.pdf']);
    // A refusal that is no 404 does not read the list again.
    api.handle(content(TABLE.id), () =>
      apiError(
        503,
        'downloads_busy',
        'Şu anda başka dosyalar indiriliyor. Biraz sonra yeniden deneyin.',
      ),
    );
    await userEvent.click(
      within(row('Maliyet tablosu.xlsx')).getByRole('button', { name: 'İndir' }),
    );
    expect(await screen.findByText(/^Şu anda başka dosyalar indiriliyor\./)).toBeVisible();
    expect(api.callsTo(LIST)).toHaveLength(2);
  });

  it('deletes a file after a confirmation and moves the focus to the heading', async () => {
    const deleted = held();
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [LIST]: filesHandler(),
        [remove(TABLE.id)]: deleted.handler,
      }),
    );
    renderApp(TAB);
    await section(3);
    const button = within(row('Maliyet tablosu.xlsx')).getByRole('button', { name: 'Sil' });
    await userEvent.click(button);
    let confirm = await screen.findByRole('alertdialog', {
      name: 'Maliyet tablosu.xlsx silinsin mi?',
    });
    expect(confirm).toHaveAccessibleDescription(
      'Dosya projeden ve dosya deposundan silinir. Bu işlem geri alınamaz.',
    );
    // Deleting cannot be taken back: giving up has the focus, and returns it to "Sil".
    const cancel = within(confirm).getByRole('button', { name: 'Vazgeç' });
    await waitFor(() => {
      expect(cancel).toHaveFocus();
    });
    await userEvent.click(cancel);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(button).toHaveFocus();
    });
    expect(api.callsTo(remove(TABLE.id))).toHaveLength(0);

    await userEvent.click(button);
    confirm = await screen.findByRole('alertdialog');
    const sure = within(confirm).getByRole('button', { name: 'Dosyayı sil' });
    await userEvent.click(sure);
    // While the API is asked: both buttons are busy, a second press sends nothing, Escape does
    // not close, and the row is still there.
    expect(sure).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(sure);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(api.callsTo(remove(TABLE.id))).toHaveLength(1);
    expect(api.callsTo(remove(TABLE.id))[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(screen.getByText('Maliyet tablosu.xlsx', { selector: 'li span' })).toBeInTheDocument();

    // The list is read again after the delete; its answer is kept back here.
    const again = held();
    api.handle(LIST, again.handler);
    deleted.answer(noContent());
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(await screen.findByText('Maliyet tablosu.xlsx silindi.')).toBeVisible();
    // The API has deleted the file: its row is gone at once, before the list is read again, and
    // the heading has the focus (the button that asked went with the row).
    expect(await section(2)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Maliyet tablosu.xlsx' })).toBeNull();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
    expect(api.callsTo(LIST)).toHaveLength(2);
    again.answer(
      json({ files: FILES.filter((file) => file.id !== TABLE.id), storageAvailable: true }),
    );
    expect(await section(2)).toBeVisible();
  });

  it('keeps the file and says why when it cannot be deleted', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [LIST]: filesHandler(),
        [remove(TABLE.id)]: () =>
          apiError(
            403,
            'file_delete_not_allowed',
            'Bu dosyayı yalnızca ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu silebilir.',
          ),
      }),
    );
    renderApp(TAB);
    await section(3);
    const button = within(row('Maliyet tablosu.xlsx')).getByRole('button', { name: 'Sil' });
    await userEvent.click(button);
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Dosyayı sil' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Bu dosyayı yalnızca ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu silebilir.',
    );
    // The dialog stays, nothing is said to be deleted, and the list is read again: it then says
    // what the reader may do.
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.queryByText('Maliyet tablosu.xlsx silindi.')).toBeNull();
    await waitFor(() => {
      expect(api.callsTo(LIST)).toHaveLength(2);
    });
    expect(screen.getByText('Maliyet tablosu.xlsx', { selector: 'li span' })).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(button).toHaveFocus();
    });
  });

  it('moves the focus to the heading when somebody else deleted the file meanwhile', async () => {
    let files = FILES;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [LIST]: (call) => filesHandler(files)(call),
        [remove(TABLE.id)]: () => apiError(404, 'not_found', 'Kayıt bulunamadı.'),
      }),
    );
    renderApp(TAB);
    await section(3);
    await userEvent.click(within(row('Maliyet tablosu.xlsx')).getByRole('button', { name: 'Sil' }));
    const confirm = await screen.findByRole('alertdialog');
    files = FILES.filter((file) => file.id !== TABLE.id);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Dosyayı sil' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Kayıt bulunamadı.');
    // The list behind the dialog already says so.
    await waitFor(() => {
      expect(api.callsTo(LIST)).toHaveLength(2);
    });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(heading()).toHaveFocus();
    });
    expect(heading()).toHaveTextContent('Dosyalar 2');
  });
});

describe('adding a file from the tab', () => {
  it('sends the file and shows it in the list when the API has stored it', async () => {
    let files = FILES;
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [LIST]: (call) => filesHandler(files)(call),
        ...ticketHandlers(),
      }),
    );
    const { uploads } = mockUpload();
    renderApp(TAB);
    const region = await section(3);
    const opener = within(region).getByRole('button', { name: 'Dosya ekle' });
    await userEvent.click(opener);
    const box = await dialog();
    expect(box).toHaveAccessibleDescription(
      expect.stringContaining('Depo otomasyonu projesine bir dosya ekleyin.'),
    );
    await userEvent.upload(field(box), pdf('Teklif.pdf'));
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    expect(put.path).toMatch(new RegExp(`^/projects/${PROJECT_ID}/files/`));
    put.progress(4, 4);
    await waitFor(() => {
      expect(within(box).getByRole('status')).toHaveTextContent('Dosya gönderildi, kaydediliyor.');
    });
    // Nothing is shown as added before the API has answered.
    expect(screen.queryByText('Teklif.pdf', { selector: 'li span' })).toBeNull();
    expect(
      screen.getAllByRole('listitem', { hidden: true }).filter((item) => region.contains(item)),
    ).toHaveLength(3);
    const stored = projectFile({ id: idOf(put.path), name: 'Teklif.pdf', sizeBytes: 3 });
    files = [stored, ...FILES];
    put.respond(201, stored);
    await gone();
    expect(await screen.findByText('Teklif.pdf eklendi.')).toBeVisible();
    // Newest first, and counted.
    const region4 = await section(4);
    expect(
      within(within(region4).getAllByRole('listitem')[0] as HTMLElement).getByRole('group'),
    ).toHaveAccessibleName('Teklif.pdf');
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
    // The list was read again.
    await waitFor(() => {
      expect(api.callsTo(LIST)).toHaveLength(2);
    });
    expect(api.unexpected).toEqual([]);
  });

  it('reads the list again after an upload was stopped, and stays open', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), { [LIST]: filesHandler(), ...ticketHandlers() }),
    );
    const { uploads } = mockUpload();
    renderApp(TAB);
    const region = await section(3);
    await userEvent.click(within(region).getByRole('button', { name: 'Dosya ekle' }));
    const box = await dialog();
    await userEvent.upload(field(box), pdf('Teklif.pdf'));
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    await userEvent.click(button(box, 'Yüklemeyi durdur'));
    expect(put.aborted).toBe(true);
    expect(await within(box).findByRole('button', { name: 'Yükle' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Dosya ekle' })).toBeVisible();
    // Bytes that had all left may have been stored.
    await waitFor(() => {
      expect(api.callsTo(LIST)).toHaveLength(2);
    });
  });

  it('moves the focus to the heading when the first file was added', async () => {
    const api = mockApi(projectHandlers(projectDetail(), ticketHandlers()));
    const { uploads } = mockUpload();
    renderApp(TAB);
    const region = await section(0);
    // Given up: the focus returns to the empty state's button.
    const first = within(region).getByRole('button', { name: 'Dosya ekle' });
    await userEvent.click(first);
    await userEvent.click(button(await dialog(), 'Vazgeç'));
    await waitFor(() => {
      expect(first).toHaveFocus();
    });
    await userEvent.click(first);
    const box = await dialog();
    await userEvent.upload(field(box), pdf('Teklif.pdf'));
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    const stored = projectFile({ id: idOf(put.path), name: 'Teklif.pdf', sizeBytes: 3 });
    // The list is read again after the upload; its answer is kept back here.
    const again = held();
    api.handle(LIST, again.handler);
    put.respond(201, stored);
    await gone();
    // The API has stored the file: its row is there at once, before the list is read again. The
    // empty state and its button are gone, so the heading takes the focus.
    expect(await section(1)).toBeVisible();
    expect(row('Teklif.pdf')).toHaveTextContent('PDF, 3 B. Ömer Kadıoğlu ekledi, ');
    expect(screen.queryByRole('heading', { name: 'Bu projede dosya yok' })).toBeNull();
    await waitFor(() => {
      expect(heading()).toHaveFocus();
    });
    expect(screen.getAllByRole('button', { name: 'Dosya ekle' })).toHaveLength(1);
    expect(api.callsTo(LIST)).toHaveLength(2);
    again.answer(json({ files: [stored], storageAvailable: true }));
    expect(await section(1)).toBeVisible();
  });

  it('stops the upload when the page is left', async () => {
    mockApi(projectHandlers(projectDetail(), { [LIST]: filesHandler(), ...ticketHandlers() }));
    const { uploads } = mockUpload();
    const { router } = renderApp(TAB);
    const region = await section(3);
    await userEvent.click(within(region).getByRole('button', { name: 'Dosya ekle' }));
    const box = await dialog();
    await userEvent.upload(field(box), pdf('Teklif.pdf'));
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    await router.navigate({ to: '/c/$company/projects', params: { company: 'armadx' } });
    await waitFor(() => {
      expect(put.aborted).toBe(true);
    });
  });
});

describe('adding a file', () => {
  /** The dialog by itself, opened by a button as the tab opens it. */
  function Opener({
    onStored,
    onChanged,
  }: {
    onStored: (file: unknown) => void;
    onChanged: () => void;
  }) {
    const [open, setOpen] = useState(false);
    const focus = useReturnFocus();
    return (
      <CompanyContext value={ARMADX}>
        <button
          type="button"
          onClick={() => {
            focus.remember();
            setOpen(true);
          }}
        >
          Dosya ekle
        </button>
        {open ? (
          <AddFileDialog
            project={{ id: PROJECT_ID, name: 'Depo otomasyonu' }}
            onClose={() => {
              setOpen(false);
            }}
            onStored={onStored}
            onChanged={onChanged}
            onCloseAutoFocus={focus.onCloseAutoFocus}
          />
        ) : null}
        <Toaster />
      </CompanyContext>
    );
  }

  async function open(handlers: Record<string, Handler> = ticketHandlers()) {
    const api = mockApi(handlers);
    const { uploads } = mockUpload();
    const onStored = vi.fn();
    const onChanged = vi.fn();
    const view = render(<Opener onStored={onStored} onChanged={onChanged} />);
    const opener = screen.getByRole('button', { name: 'Dosya ekle' });
    await userEvent.click(opener);
    const box = await dialog();
    return { api, uploads, onStored, onChanged, opener, box, unmount: view.unmount };
  }

  it('says the personal data sentence, who reads the file, the types and the size before anything is chosen', async () => {
    const { box, api, uploads } = await open();
    // 8 October decision 21: no file with personal data until the lawyer has answered.
    expect(within(box).getByRole('note')).toHaveTextContent(
      'Avukatın görüşü gelene kadar projeye kişisel veri içeren dosya eklenmez.',
    );
    // The dialog opens with the focus on the file field, and the sentence is part of the field's
    // description: a screen reader reads it with the field.
    await waitFor(() => {
      expect(field(box)).toHaveFocus();
    });
    expect(field(box)).toHaveAccessibleDescription(
      `${FILE_DIALOG_TEXT.personalData} ${FILE_TYPES_SENTENCE} Dosya başına en çok 25 MB.`,
    );
    expect(field(box)).not.toBeInvalid();
    // Who sees the file, and (11 October decision 3) that agents will read it.
    expect(box).toHaveAccessibleDescription(
      'Depo otomasyonu projesine bir dosya ekleyin. Dosyayı proje üyeleri ve kurucu görür. ' +
        'Yapay zekâ izni açık projede ajanlar da projedeki bütün dosyaları okuyacak.',
    );
    expect(field(box)).toHaveAttribute(
      'accept',
      '.pdf,.docx,.xlsx,.csv,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md',
    );
    expect(field(box)).not.toHaveAttribute('multiple');
    expect(button(box, 'Vazgeç')).toBeVisible();
    expect(button(box, 'Yükle')).toBeVisible();
    expect(within(box).queryByRole('progressbar')).toBeNull();
    // Nothing is asked of the API by opening the dialog.
    expect(api.calls).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('refuses a file by its name, its type and its size before anything is sent', async () => {
    const { box, api, uploads } = await open();
    // The browser's own filter by extension is not what refuses a file here.
    const user = userEvent.setup({ applyAccept: false });
    const cases: [File, string][] = [
      [pdf(`${'a'.repeat(201)}.pdf`), FILE_PROBLEM.name],
      [pdf('rapor.pdf.exe'), FILE_PROBLEM.type],
      [pdf('boş.pdf', ''), FILE_PROBLEM.empty],
      [sized('büyük.pdf', PROJECT_FILE_MAX_BYTES + 1), FILE_PROBLEM.too_large],
    ];
    for (const [file, sentence] of cases) {
      await user.upload(field(box), file);
      expect(within(box).getByRole('alert')).toHaveTextContent(sentence);
      expect(field(box)).toBeInvalid();
      expect(field(box)).toHaveAccessibleDescription(expect.stringContaining(sentence));
      // "Yükle" sends nothing and leads back to the field.
      await user.click(button(box, 'Yükle'));
      expect(field(box)).toHaveFocus();
    }
    // A file of exactly 25 MB is no problem: its facts are shown instead.
    await user.upload(field(box), sized('tam.pdf', PROJECT_FILE_MAX_BYTES));
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(within(box).getByText('PDF, 25 MB')).toBeVisible();
    expect(field(box)).not.toBeInvalid();
    expect(api.calls).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('asks for a file when none is chosen', async () => {
    const { box, api, uploads } = await open();
    await userEvent.click(button(box, 'Yükle'));
    expect(within(box).getByRole('alert')).toHaveTextContent('Önce bir dosya seçin.');
    expect(field(box)).toBeInvalid();
    expect(field(box)).toHaveAccessibleDescription(
      expect.stringContaining('Önce bir dosya seçin.'),
    );
    expect(field(box)).toHaveFocus();
    // Choosing a file takes the sentence away.
    await userEvent.upload(field(box), pdf());
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(api.calls).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('sends the file, shows the progress, and closes with the stored file handed on', async () => {
    const { box, api, uploads, onStored, onChanged, opener } = await open();
    const file = pdf();
    await userEvent.upload(field(box), file);
    expect(within(box).getByText('PDF, 3 B')).toBeVisible();
    await userEvent.click(button(box, 'Yükle'));
    // While the ticket is asked for the dialog already says that it is sending.
    expect(within(box).getByText('Yükleniyor: %0')).toBeVisible();
    const put = await sent(uploads);
    // First the ticket, for the size of this file; then the bytes with it, under the same id.
    expect(api.calls).toHaveLength(1);
    const [asked] = api.calls;
    expect(asked?.method).toBe('POST');
    expect(asked?.path).toBe(`/projects/${PROJECT_ID}/files/${String(idOf(put.path))}/ticket`);
    expect(asked?.body).toEqual({ sizeBytes: 3 });
    expect(asked?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(put.method).toBe('PUT');
    expect(put.path).toMatch(new RegExp(`^/projects/${PROJECT_ID}/files/[0-9a-f-]{36}$`));
    expect(put.headers[COMPANY_HEADER]).toBe(ARMADX.companyId);
    expect(put.headers[FILE_NAME_HEADER]).toBe('%C5%9Eartname.pdf');
    expect(put.headers[UPLOAD_TICKET_HEADER]).toBe(UPLOAD_TICKET.ticket);
    expect(put.body).toBe(file);

    const bar = within(box).getByRole('progressbar', { name: 'Yükleme' });
    expect(bar).toHaveAttribute('value', '0');
    // Said once to a screen reader; the numbers are not in the live region.
    expect(within(box).getByRole('status')).toHaveTextContent('Dosya yükleniyor.');
    expect(field(box)).toBeDisabled();
    expect(button(box, 'Yükleniyor')).toHaveAttribute('aria-disabled', 'true');
    expect(button(box, 'Yüklemeyi durdur')).toBeVisible();

    put.progress(1, 4);
    const visible = await within(box).findByText('Yükleniyor: %25');
    expect(visible).toBeVisible();
    // The bar and the live sentence say it to a screen reader; the visible line is not read twice.
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toHaveAttribute('value', '25');
    expect(within(box).getByRole('status')).toHaveTextContent('Dosya yükleniyor.');
    put.progress(4, 4);
    // Every byte has left; the API has not answered yet.
    await waitFor(() => {
      expect(within(box).getByRole('status')).toHaveTextContent('Dosya gönderildi, kaydediliyor.');
    });
    expect(bar).toHaveAttribute('value', '100');
    expect(button(box, 'Kaydediliyor')).toHaveAttribute('aria-disabled', 'true');
    // Pressing the busy button sends nothing more.
    await userEvent.click(button(box, 'Kaydediliyor'));
    expect(uploads).toHaveLength(1);
    // Nothing is said to be added before the API has answered.
    expect(onStored).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    const stored = projectFile({ id: idOf(put.path), name: 'Şartname.pdf', sizeBytes: 3 });
    put.respond(201, stored);
    await gone();
    expect(await screen.findByText('Şartname.pdf eklendi.')).toBeVisible();
    expect(onStored).toHaveBeenCalledTimes(1);
    expect(onStored).toHaveBeenCalledWith(stored);
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('keeps the file when the API refuses it, and sends the same id again', async () => {
    const { box, api, uploads, onStored, onChanged } = await open();
    await userEvent.upload(field(box), pdf());
    await userEvent.click(button(box, 'Yükle'));
    const first = await sent(uploads);
    first.respond(415, {
      error: {
        code: 'file_content_mismatch',
        message: 'Dosyanın içeriği uzantısının söylediği türde değil.',
      },
    });
    expect(await within(box).findByRole('alert')).toHaveTextContent(
      'Dosyanın içeriği uzantısının söylediği türde değil.',
    );
    // The dialog stays, the file stays chosen, and the list is read again.
    expect(within(box).queryByRole('progressbar')).toBeNull();
    expect(within(box).getByText('PDF, 3 B')).toBeVisible();
    expect(field(box)).toBeEnabled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onStored).not.toHaveBeenCalled();
    // The same file again: a new ticket, the same id.
    await userEvent.click(button(box, 'Yükle'));
    expect(within(box).queryByRole('alert')).toBeNull();
    const second = await sent(uploads, 2);
    expect(second.path).toBe(first.path);
    expect(api.callsTo(ticketRoute(String(idOf(first.path))))).toHaveLength(2);
    // The connection breaks: the sentence every request gives.
    second.fail();
    expect(await within(box).findByRole('alert')).toHaveTextContent(
      'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.',
    );
    expect(button(box, 'Yükle')).not.toHaveAttribute('aria-disabled');
  });

  it('says why when the ticket is refused, and sends nothing', async () => {
    const closed = await open(
      ticketHandlers(() => apiError(401, 'unauthenticated', 'Oturumunuz kapanmış.')),
    );
    await userEvent.upload(field(closed.box), pdf());
    await userEvent.click(button(closed.box, 'Yükle'));
    expect(await within(closed.box).findByRole('alert')).toHaveTextContent('Oturumunuz kapanmış.');
    expect(closed.uploads).toHaveLength(0);
    expect(within(closed.box).getByText('PDF, 3 B')).toBeVisible();
    expect(button(closed.box, 'Yükle')).not.toHaveAttribute('aria-disabled');
    // The list is read again: a closed session shows itself there.
    expect(closed.onChanged).toHaveBeenCalledTimes(1);
    closed.unmount();

    const none = await open(
      ticketHandlers(() =>
        apiError(
          503,
          'file_storage_unavailable',
          'Dosya deposu bu ortamda kurulu değil. Dosya eklenemez, indirilemez ve silinemez.',
        ),
      ),
    );
    await userEvent.upload(field(none.box), pdf());
    await userEvent.click(button(none.box, 'Yükle'));
    expect(await within(none.box).findByRole('alert')).toHaveTextContent(
      'Dosya deposu bu ortamda kurulu değil. Dosya eklenemez, indirilemez ve silinemez.',
    );
    expect(none.uploads).toHaveLength(0);
    expect(none.onChanged).toHaveBeenCalledTimes(1);
  });

  it('sends another id when another file is chosen', async () => {
    const { box, uploads } = await open();
    await userEvent.upload(field(box), pdf('bir.pdf'));
    await userEvent.click(button(box, 'Yükle'));
    const first = await sent(uploads);
    first.respond(502, {
      error: { code: 'file_storage_failed', message: 'Dosya deposuna ulaşılamadı.' },
    });
    expect(await within(box).findByRole('alert')).toHaveTextContent('Dosya deposuna ulaşılamadı.');
    // Another choice takes the refusal of the first file away with it.
    await userEvent.upload(field(box), pdf('iki.pdf'));
    expect(within(box).queryByRole('alert')).toBeNull();
    await userEvent.click(button(box, 'Yükle'));
    const second = await sent(uploads, 2);
    expect(second.path).not.toBe(first.path);
    expect(second.headers[FILE_NAME_HEADER]).toBe('iki.pdf');
  });

  it('stops an upload and stays open', async () => {
    const { box, uploads, onChanged } = await open();
    await userEvent.upload(field(box), pdf());
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    put.progress(2, 4);
    expect(await within(box).findByText('Yükleniyor: %50')).toBeVisible();
    const stop = button(box, 'Yüklemeyi durdur');
    await userEvent.click(stop);
    expect(put.aborted).toBe(true);
    // No sentence: the person stopped it. The file is still chosen and can be sent again.
    expect(await within(box).findByRole('button', { name: 'Yükle' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(within(box).queryByRole('progressbar')).toBeNull();
    expect(within(box).getByText('PDF, 3 B')).toBeVisible();
    expect(field(box)).toBeEnabled();
    // The button that stopped it is the one that now gives the dialog up: the focus stayed on it.
    expect(button(box, 'Vazgeç')).toBe(stop);
    expect(stop).toHaveFocus();
    // Bytes that had all left may have been stored: the list is read again.
    expect(onChanged).toHaveBeenCalledTimes(1);
    // Sending again starts from nothing, under the same id.
    await userEvent.click(button(box, 'Yükle'));
    const again = await sent(uploads, 2);
    expect(again.path).toBe(put.path);
    expect(within(box).getByText('Yükleniyor: %0')).toBeVisible();
  });

  it('offers no stop once the whole file has left: the server is already storing it', async () => {
    const { box, uploads, onStored, onChanged } = await open();
    await userEvent.upload(field(box), pdf());
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    put.progress(4, 4);
    await waitFor(() => {
      expect(within(box).getByRole('status')).toHaveTextContent('Dosya gönderildi, kaydediliyor.');
    });
    // The button keeps its place and the focus can stay on it, but it stops nothing: a send that
    // is cut here would leave the file in the project without the dialog saying so.
    const stop = button(box, 'Yüklemeyi durdur');
    expect(stop).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(stop);
    expect(put.aborted).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
    expect(button(box, 'Kaydediliyor')).toBeVisible();
    expect(within(box).getByRole('status')).toHaveTextContent('Dosya gönderildi, kaydediliyor.');
    // The answer arrives: the file is shown as added, and the person deletes it from the list.
    const stored = projectFile({ id: idOf(put.path), name: 'Şartname.pdf', sizeBytes: 3 });
    put.respond(201, stored);
    await gone();
    expect(onStored).toHaveBeenCalledWith(stored);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('stops while the ticket is asked for, and sends nothing', async () => {
    // The ticket request never answers.
    const { box, uploads, api } = await open(
      ticketHandlers(() => new Promise<Response>(() => undefined)),
    );
    // The stand-in never answers; a real fetch rejects when its signal aborts.
    api.fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The request was aborted', 'AbortError'));
          });
        }),
    );
    await userEvent.upload(field(box), pdf());
    await userEvent.click(button(box, 'Yükle'));
    await userEvent.click(button(box, 'Yüklemeyi durdur'));
    expect(await within(box).findByRole('button', { name: 'Yükle' })).toBeVisible();
    expect(within(box).queryByRole('alert')).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it('does not close while a file is being sent', async () => {
    const { box, uploads } = await open();
    await userEvent.upload(field(box), pdf());
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Dosya ekle' })).toBeVisible();
    expect(put.aborted).toBe(false);
    // Once nothing is being sent, Escape closes it.
    put.respond(413, {
      error: { code: 'file_too_large', message: 'Dosya 25 MB sınırını aşıyor.' },
    });
    await within(box).findByRole('alert');
    await userEvent.keyboard('{Escape}');
    await gone();
  });

  it('stops the upload when the page is left', async () => {
    const { box, uploads, unmount } = await open();
    await userEvent.upload(field(box), pdf());
    await userEvent.click(button(box, 'Yükle'));
    const put = await sent(uploads);
    expect(put.aborted).toBe(false);
    unmount();
    expect(put.aborted).toBe(true);
  });
});
