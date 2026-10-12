import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  PROJECT_FILE_MAX_BYTES,
  UPLOAD_TICKET_HEADER,
} from '@agent-office/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddFileDialog } from './components/projects/add-file-dialog.tsx';
import { Toaster } from './components/ui/sonner.tsx';
import { useReturnFocus } from './lib/focus.ts';
import { FILE_DIALOG_TEXT, FILE_PROBLEM, FILE_TYPES_SENTENCE } from './lib/projects/files.ts';
import { CompanyContext } from './lib/session.ts';
import { apiError, ARMADX, mockApi, type Handler } from './test/mock-api.ts';
import { mockUpload, type SentUpload } from './test/mock-upload.ts';
import {
  PROJECT_ID,
  projectFile,
  ticketHandlers,
  ticketRoute,
  UPLOAD_IDS,
  UPLOAD_TICKET,
} from './test/project-fixtures.ts';

// The files of a project (8 October 2026, decisions 11 and 20): the dialog that sends one file.

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

describe('adding a file', () => {
  /** The dialog by itself, opened by a button as the tab opens it. */
  function Opener({ onChanged }: { onChanged: () => void }) {
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
    const onChanged = vi.fn();
    const view = render(<Opener onChanged={onChanged} />);
    const opener = screen.getByRole('button', { name: 'Dosya ekle' });
    await userEvent.click(opener);
    return { api, uploads, onChanged, opener, box: await dialog(), unmount: view.unmount };
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

  it('sends the file, shows the progress, and closes with the list read again', async () => {
    const { box, api, uploads, onChanged, opener } = await open();
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
    expect(await within(box).findByText('Yükleniyor: %25')).toBeVisible();
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
    expect(onChanged).not.toHaveBeenCalled();

    put.respond(201, projectFile({ id: idOf(put.path), name: 'Şartname.pdf', sizeBytes: 3 }));
    await gone();
    expect(await screen.findByText('Şartname.pdf eklendi.')).toBeVisible();
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('keeps the file when the API refuses it, and sends the same id again', async () => {
    const { box, api, uploads, onChanged } = await open();
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
