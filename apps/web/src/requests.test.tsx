import { COMPANY_HEADER, BACKGROUND_HEADER, officeDay } from '@agent-office/shared';
import { startAuthentication } from '@simplewebauthn/browser';
import { focusManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  ARMADX,
  json,
  mockApi,
  noContent,
  PILLIKA,
  sessionHandler,
  USER_ID,
  type ApiCall,
  type Handler,
} from './test/mock-api.ts';
import {
  APPROVAL_CARD,
  APPROVAL_ID,
  comment,
  DEFAULT_JOURNEY,
  EMPLOYEE,
  FOUNDER,
  REQUEST_ID,
  RESULT,
  requestDetail,
  summaryOf,
  withComments,
} from './test/request-fixtures.ts';
import { ASSERTION, challengeId, signed, STEP_UP_OPTIONS, stepUpIssuer } from './test/passkeys.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';
import { formatDay } from './lib/dates.ts';
import { clearDrafts, draftKey } from './lib/drafts.ts';

// The browser's passkey prompt: the person confirms, unless a test says otherwise.
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(startAuthentication).mockReset().mockResolvedValue(ASSERTION);
});

// Flow (A) in the panel: the form that asks one thing, the list that says where every request is
// and whose turn it is, the page with the journey, and the two decisions. The panel sets no status
// and offers no control that would; everything on screen is what the API answered.

afterEach(() => {
  vi.unstubAllGlobals();
  // Also a draft that still waits to be written: it must not open in the next test's box.
  clearDrafts();
  sessionStorage.clear();
});

/** The line under the title that says where the request is and whose turn it is, as one text. */
function stageLine(): string {
  const line = screen
    .getAllByRole('status')
    .find((element) => element.textContent.startsWith('Aşama'));
  if (!line) throw new Error('No stage line');
  return [...line.children].map((part) => part.textContent).join(' ');
}

function sidebarButton(): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('button', {
    name: 'Yeni talep',
  });
}

const EMPLOYEE_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};

describe('Yeni talep', () => {
  it('asks only what is wanted, sends the text with an id and opens the new request', async () => {
    const created = requestDetail({
      status: 'open',
      stage: 'routing',
      turn: { kind: 'agent', code: 'KOR-1', name: 'Ofis Koordinatörü' },
      waitingForMe: false,
      unit: null,
      agent: null,
      journey: [],
      approval: null,
      requester: FOUNDER,
      actions: { cancel: true, stop: false, reroute: false },
      text: 'LinkedIn için gönderi yaz',
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'POST /requests': () => json(created, 201),
      [`GET /requests/${REQUEST_ID}`]: () => json(created),
    });
    const { router } = renderApp('/c/armadx/requests');
    expect(await screen.findByRole('heading', { name: 'Henüz talep yok' })).toBeVisible();
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('button', {
        name: 'Yeni talep',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    // One text box (the optional due day is a date field, not a text box), and no control that
    // would choose a unit, an agent or an approver.
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    // What the form says before anything is sent: where the text goes and who will be able to
    // read the request. It tells and does not warn: personal and customer data may be written
    // (8 October decision 5), so nothing in the form says what not to write.
    const notice = within(dialog).getByText(/yapay zekâ modeline gönderilir/);
    expect(notice.textContent).toBe(
      'Talep metni yapay zekâ modeline gönderilir. Talebi ve onaylanan sonucunu şirketteki kurucu ve çalışanlar görebilir.',
    );
    expect(dialog).not.toHaveTextContent(/yazmayın|kişisel veri|müşteri/i);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByText(/koordinasyon merkezi yönlendirir/)).toBeVisible();
    expect(api.callsTo('GET /requests/intake')).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Ne istediğinizi yazın.');
    expect(api.callsTo('POST /requests')).toHaveLength(0);

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Ne istiyorsunuz?' }),
      'LinkedIn için gönderi yaz',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(`/c/armadx/requests/${REQUEST_ID}`);
    });
    const [call] = api.callsTo('POST /requests');
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(call?.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      text: 'LinkedIn için gönderi yaz',
    });
    // The page is the confirmation.
    expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible();
    // The record is what was sent: nothing more is said.
    expect(screen.queryByText(/ilk gönderdiğiniz hâliyle kayıtlı/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bildirimi kapat' })).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  it('keeps the text and says so when the API refuses', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'POST /requests': () =>
        apiError(
          500,
          'internal_error',
          'Beklenmeyen bir hata oluştu. Biraz sonra yeniden deneyin.',
        ),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Henüz talep yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    const box = within(dialog).getByRole('textbox');
    await userEvent.type(box, 'Bir gönderi');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
    expect(await within(dialog).findByText(/Beklenmeyen bir hata/)).toBeVisible();
    expect(box).toHaveValue('Bir gönderi');
  });

  it('says so and sends nothing while a request could not run for this person', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      'GET /requests?mine=true': () => json({ requests: [], truncated: false }),
      'GET /requests/intake': () => json({ open: false, reason: 'trial_founder_only' }),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Açık talebiniz yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Ajanlar deneme aşamasında; şimdilik yalnızca kurucunun talepleri çalışır.',
    );
    const send = within(dialog).getByRole('button', { name: 'Talebi gönder' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).toHaveAccessibleDescription(/deneme aşamasında/);
    await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
    await userEvent.click(send);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(api.callsTo('POST /requests')).toHaveLength(0);
    // The text is not lost: it stays in the box.
    expect(within(dialog).getByRole('textbox')).toHaveValue('Bir gönderi yaz');
  });

  it('tells the founder what to do when the coordinator is closed', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'GET /requests/intake': () => json({ open: false, reason: 'coordinator_closed' }),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Henüz talep yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Koordinasyon merkezi bu şirkette açık değil; şu an talep gönderilemez. Ofis görünümünde KOR-1 ajanını açın.',
    );
  });

  it('gives the focus back to the button that opened it', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
    });
    renderApp('/c/armadx/requests');
    await screen.findByRole('heading', { name: 'Henüz talep yok' });
    await userEvent.click(sidebarButton());
    const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox')).toHaveFocus();
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(sidebarButton()).toHaveFocus();
    });
  });

  it('is not offered to an external person, nor in Kurucu alanı', async () => {
    mockApi({
      'GET /session': sessionHandler({
        memberships: [{ ...ARMADX, role: 'external', canApprove: false }],
      }),
    });
    renderApp('/c/armadx');
    const menu = await screen.findByRole('navigation', { name: 'Ana menü' });
    expect(within(menu).queryByRole('button', { name: 'Yeni talep' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Talepler' })).toBeNull();
    // Tasks between people stay a row of their own.
    expect(within(menu).getByRole('link', { name: 'Görevler' })).toBeVisible();
  });

  // The due day (docs/SONRA.md W-h): a day, optional, information only. It cannot be changed
  // after the send, so the form lets none go that the person did not mean.
  describe('the due day', () => {
    const DAY_MS = 86_400_000;
    const DUE_HELP =
      'Yalnızca bilgidir: talebi görenler ve ajanlar görür. Gönderdikten sonra değiştirilemez; günü geçince hatırlatma gönderilmez.';
    const created = requestDetail({
      status: 'open',
      stage: 'routing',
      turn: { kind: 'agent', code: 'KOR-1', name: 'Ofis Koordinatörü' },
      waitingForMe: false,
      unit: null,
      agent: null,
      journey: [],
      approval: null,
      requester: FOUNDER,
      actions: { cancel: true, stop: false, reroute: false },
    });
    // The record the API answers holds what it was sent.
    const storedFrom = (call: ApiCall) => {
      const sent = call.body as { text: string; dueDate?: string };
      return { ...created, text: sent.text, dueDate: sent.dueDate ?? null };
    };
    const handlers = (): Record<string, Handler> => ({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'POST /requests': (call) => json(storedFrom(call), 201),
      [`GET /requests/${REQUEST_ID}`]: () => json(created),
    });

    async function openForm(): Promise<HTMLElement> {
      await userEvent.click(sidebarButton());
      return screen.findByRole('dialog', { name: 'Yeni talep' });
    }

    async function openList(): Promise<void> {
      renderApp('/c/armadx/requests');
      await screen.findByRole('heading', { name: 'Henüz talep yok' });
    }

    function dueField(dialog: HTMLElement): HTMLInputElement {
      return within(dialog).getByLabelText('Son tarih (isteğe bağlı)');
    }

    /** What a browser says of a date field with a part missing: it has no value and cannot be read. */
    function setHalfTyped(field: HTMLElement, halfTyped: boolean): void {
      Object.defineProperty(field, 'validity', {
        configurable: true,
        value: { badInput: halfTyped },
      });
    }

    it('offers an optional due day that cannot lie before today and sends it with the request', async () => {
      const api = mockApi(handlers());
      await openList();
      const dialog = await openForm();
      const due = dueField(dialog);
      expect(due).toHaveAttribute('type', 'date');
      expect(due).toHaveAttribute('min', officeDay(Date.now()));
      expect(due).toHaveValue('');
      expect(due).toHaveAccessibleDescription(DUE_HELP);
      expect(due).toHaveAttribute('aria-invalid', 'false');

      const day = officeDay(Date.now() + 3 * DAY_MS);
      fireEvent.change(due, { target: { value: day } });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      await userEvent.type(
        within(dialog).getByRole('textbox', { name: 'Ne istiyorsunuz?' }),
        'LinkedIn için gönderi yaz',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
      expect(api.callsTo('POST /requests').map((call) => call.body)).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          text: 'LinkedIn için gönderi yaz',
          dueDate: day,
        },
      ]);
      expect(api.unexpected).toEqual([]);
    });

    it('says so and sends nothing for a day that has passed', async () => {
      const api = mockApi(handlers());
      await openList();
      const dialog = await openForm();
      const due = dueField(dialog);
      await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');

      fireEvent.change(due, { target: { value: officeDay(Date.now() - DAY_MS) } });
      // Said when the field is left, not while it is being typed in (see the next test).
      fireEvent.blur(due);
      const alert = within(dialog).getByRole('alert');
      expect(alert).toHaveTextContent('Son tarih bugünden önce olamaz.');
      // The problem is tied to the field, with the help.
      expect(due).toHaveAttribute('aria-invalid', 'true');
      expect(due).toHaveAccessibleDescription(`${DUE_HELP} Son tarih bugünden önce olamaz.`);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      due.focus();
      await userEvent.keyboard('{Control>}{Enter}{/Control}');
      expect(api.callsTo('POST /requests')).toHaveLength(0);

      // A date typed half way: the browser gives no value and says that it cannot read it.
      setHalfTyped(due, true);
      fireEvent.change(due, { target: { value: '' } });
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Geçerli bir tarih seçin.');
      expect(due).toHaveAccessibleDescription(`${DUE_HELP} Geçerli bir tarih seçin.`);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      expect(api.callsTo('POST /requests')).toHaveLength(0);

      // A value that is no calendar day of the contract is not sent either.
      setHalfTyped(due, false);
      fireEvent.change(due, { target: { value: '12026-10-20' } });
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Geçerli bir tarih seçin.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      expect(api.callsTo('POST /requests')).toHaveLength(0);

      // Today is a due day; and a field that was cleared has no problem.
      fireEvent.change(due, { target: { value: officeDay(Date.now()) } });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      fireEvent.change(due, { target: { value: '' } });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      expect(due).toHaveAttribute('aria-invalid', 'false');
      expect(due).toHaveAccessibleDescription(DUE_HELP);
    });

    it('does not call a year that is still being typed a day that has passed', async () => {
      const api = mockApi(handlers());
      await openList();
      const dialog = await openForm();
      const due = dueField(dialog);
      await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
      const [year = '', month = '', day = ''] = officeDay(Date.now() + 5 * DAY_MS).split('-');

      // A browser reports a whole date after every digit of the year: 2026 arrives as the years
      // 0002, 0020 and 0202 first, each a real day long before today.
      due.focus();
      for (const digits of [1, 2, 3]) {
        const soFar = `${year.slice(0, digits).padStart(4, '0')}-${month}-${day}`;
        fireEvent.change(due, { target: { value: soFar } });
        expect(within(dialog).queryByRole('alert')).toBeNull();
        expect(due).toHaveAttribute('aria-invalid', 'false');
        expect(due).toHaveAccessibleDescription(DUE_HELP);
      }
      // Left with the year unfinished: said now.
      fireEvent.blur(due);
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Son tarih bugünden önce olamaz.',
      );
      expect(due).toHaveAttribute('aria-invalid', 'true');
      // The person goes on typing: the sentence does not stay over a date that is right.
      fireEvent.change(due, { target: { value: `${year}-${month}-${day}` } });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      fireEvent.blur(due);
      expect(within(dialog).queryByRole('alert')).toBeNull();

      // A day that has passed and a send from inside the field (Ctrl+Enter, the focus never left
      // it): said, and nothing is sent.
      fireEvent.change(due, { target: { value: officeDay(Date.now() - DAY_MS) } });
      expect(within(dialog).queryByRole('alert')).toBeNull();
      due.focus();
      await userEvent.keyboard('{Control>}{Enter}{/Control}');
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Son tarih bugünden önce olamaz.',
      );
      expect(api.callsTo('POST /requests')).toHaveLength(0);
      expect(screen.getByRole('dialog', { name: 'Yeni talep' })).toBeVisible();
    });

    it('says at once that the day of a draft has passed', async () => {
      mockApi(handlers());
      await openList();
      // A draft from yesterday that carries yesterday's day.
      sessionStorage.setItem(
        draftKey(USER_ID, ARMADX.companyId, 'request'),
        JSON.stringify({
          id: REQUEST_ID,
          text: 'Dünden kalan taslak',
          dueDate: officeDay(Date.now() - DAY_MS),
        }),
      );
      const dialog = await openForm();
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Son tarih bugünden önce olamaz.',
      );
      expect(dueField(dialog)).toHaveAttribute('aria-invalid', 'true');
    });

    it('does not send a request whose date is only half typed', async () => {
      const api = mockApi(handlers());
      await openList();
      const dialog = await openForm();
      const due = dueField(dialog);
      await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');

      // The field says so when it loses the focus. No change event was fired: the value of a
      // half typed date stays empty, as in a browser.
      setHalfTyped(due, true);
      fireEvent.blur(due);
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Geçerli bir tarih seçin.');
      expect(due).toHaveAccessibleDescription(`${DUE_HELP} Geçerli bir tarih seçin.`);
      setHalfTyped(due, false);
      fireEvent.blur(due);
      expect(within(dialog).queryByRole('alert')).toBeNull();

      // And the send asks the field itself, also when the focus never left it.
      setHalfTyped(due, true);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Geçerli bir tarih seçin.');
      expect(due).toHaveAttribute('aria-invalid', 'true');
      expect(api.callsTo('POST /requests')).toHaveLength(0);
      expect(screen.getByRole('dialog', { name: 'Yeni talep' })).toBeVisible();

      // The person empties the field: the request goes without a day.
      setHalfTyped(due, false);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
      expect(api.callsTo('POST /requests').map((call) => call.body)).toEqual([
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string, text: 'Bir gönderi yaz' },
      ]);
    });

    it('Enter in the date field sends nothing; Ctrl+Enter sends', async () => {
      const api = mockApi(handlers());
      await openList();
      const dialog = await openForm();
      const due = dueField(dialog);
      await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
      const day = officeDay(Date.now() + DAY_MS);
      fireEvent.change(due, { target: { value: day } });
      due.focus();
      // A sent request cannot be corrected: a person who types a date and presses Enter means
      // the date, not the send.
      await userEvent.keyboard('{Enter}');
      expect(api.callsTo('POST /requests')).toHaveLength(0);
      expect(screen.getByRole('dialog', { name: 'Yeni talep' })).toBeVisible();
      expect(due).toHaveValue(day);

      await userEvent.keyboard('{Control>}{Enter}{/Control}');
      expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
      expect(api.callsTo('POST /requests').map((call) => call.body)).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          text: 'Bir gönderi yaz',
          dueDate: day,
        },
      ]);
    });

    it('shows the API’s own words when the day ended between the form and the send', async () => {
      const refusal = 'Son tarih bugünden önce olamaz. Tarihi düzeltip yeniden gönderin.';
      const api = mockApi({
        ...handlers(),
        'POST /requests': () => apiError(409, 'due_date_past', refusal),
      });
      await openList();
      const dialog = await openForm();
      const due = dueField(dialog);
      const day = officeDay(Date.now());
      fireEvent.change(due, { target: { value: day } });
      await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(refusal);
      expect(api.callsTo('POST /requests')).toHaveLength(1);
      // Nothing is lost: the form is open with the text and the day.
      expect(screen.getByRole('dialog', { name: 'Yeni talep' })).toBeVisible();
      expect(within(dialog).getByRole('textbox')).toHaveValue('Bir gönderi yaz');
      expect(due).toHaveValue(day);
    });

    it('keeps the day with the text in the draft of the tab and forgets both with "Taslağı at"', async () => {
      mockApi(handlers());
      await openList();
      let dialog = await openForm();
      const day = officeDay(Date.now() + 2 * DAY_MS);
      fireEvent.change(dueField(dialog), { target: { value: day } });
      await userEvent.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      dialog = await openForm();
      expect(within(dialog).getByRole('textbox')).toHaveValue('Bir gönderi yaz');
      expect(dueField(dialog)).toHaveValue(day);
      // A change of the day alone is kept too, with the text.
      const later = officeDay(Date.now() + 5 * DAY_MS);
      fireEvent.change(dueField(dialog), { target: { value: later } });
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      dialog = await openForm();
      expect(within(dialog).getByRole('textbox')).toHaveValue('Bir gönderi yaz');
      expect(dueField(dialog)).toHaveValue(later);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Taslağı at' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      dialog = await openForm();
      expect(within(dialog).getByRole('textbox')).toHaveValue('');
      expect(dueField(dialog)).toHaveValue('');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      // A draft written before the form had a due day opens with its text and no day; and one
      // whose day cannot be read keeps its text.
      const key = draftKey(USER_ID, ARMADX.companyId, 'request');
      sessionStorage.setItem(key, JSON.stringify({ id: REQUEST_ID, text: 'Eski taslak' }));
      dialog = await openForm();
      expect(within(dialog).getByRole('textbox')).toHaveValue('Eski taslak');
      expect(dueField(dialog)).toHaveValue('');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      sessionStorage.setItem(
        key,
        JSON.stringify({ id: REQUEST_ID, text: 'Bozuk günlü taslak', dueDate: '20.10.2026' }),
      );
      dialog = await openForm();
      expect(within(dialog).getByRole('textbox')).toHaveValue('Bozuk günlü taslak');
      expect(dueField(dialog)).toHaveValue('');
    });

    // The answer of a send can be lost on the way (Wi-Fi, VPN, sleep) after the API stored the
    // request. The form stays open and can be changed; the next try carries the same id and the
    // API answers the first record. Neither the text nor the day can be corrected afterwards, so
    // a change that was not taken is said, and the notice stays until the person closes it.
    describe('after a send whose answer was lost', () => {
      const NOT_TAKEN =
        'Talep ilk gönderdiğiniz hâliyle kayıtlı; sonradan yaptığınız değişiklik alınmadı. Değiştirmek için bu talebi iptal edip yenisini gönderin.';
      const soon = () => officeDay(Date.now() + 2 * DAY_MS);
      const later = () => officeDay(Date.now() + 9 * DAY_MS);

      /** The first send is stored and its answer lost; every later one answers that record. */
      function lostAnswer() {
        let stored: ReturnType<typeof storedFrom> | null = null;
        return mockApi({
          ...handlers(),
          'POST /requests': (call) => {
            if (stored === null) {
              stored = storedFrom(call);
              throw new TypeError('Failed to fetch');
            }
            return json(stored, 201);
          },
          [`GET /requests/${REQUEST_ID}`]: () => json(stored),
        });
      }

      async function sendAndLose(dialog: HTMLElement, text: string, day: string): Promise<void> {
        if (day !== '') fireEvent.change(dueField(dialog), { target: { value: day } });
        await userEvent.type(within(dialog).getByRole('textbox'), text);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
          'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.',
        );
        // Nothing is lost and nothing is locked: the form can be changed before the next try.
        expect(within(dialog).getByRole('textbox')).toHaveValue(text);
        expect(dueField(dialog)).toHaveValue(day);
      }

      it.each([
        { name: 'the day was changed', first: soon, second: later, more: '' },
        { name: 'a day was added', first: () => '', second: later, more: '' },
        { name: 'the day was cleared', first: soon, second: () => '', more: '' },
        { name: 'the text was changed', first: soon, second: soon, more: ' ve bir görsel öner' },
      ])('says that the change was not taken: $name', async ({ first, second, more }) => {
        const api = lostAnswer();
        await openList();
        const dialog = await openForm();
        await sendAndLose(dialog, 'Bir gönderi yaz', first());

        fireEvent.change(dueField(dialog), { target: { value: second() } });
        if (more !== '') await userEvent.type(within(dialog).getByRole('textbox'), more);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
        // The page of the first record opens.
        expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
        expect(screen.queryByRole('dialog')).toBeNull();
        const day = (value: string) => (value === '' ? {} : { dueDate: value });
        const bodies = api.callsTo('POST /requests').map((call) => call.body);
        expect(bodies).toEqual([
          {
            id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
            text: 'Bir gönderi yaz',
            ...day(first()),
          },
          {
            id: (bodies[0] as { id: string }).id,
            text: `Bir gönderi yaz${more}`,
            ...day(second()),
          },
        ]);

        const notice = await screen.findByText(NOT_TAKEN);
        expect(notice).toBeVisible();
        expect(
          within(screen.getByRole('region', { name: 'Anlık bildirimler' })).getByText(NOT_TAKEN),
        ).toBe(notice);
        // The draft went with the send: the form does not open with the change again.
        expect(sessionStorage.getItem(draftKey(USER_ID, ARMADX.companyId, 'request'))).toBeNull();
      });

      it('keeps the notice on screen until the person closes it', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
          lostAnswer();
          await openList();
          await user.click(sidebarButton());
          const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
          fireEvent.change(dueField(dialog), { target: { value: soon() } });
          await user.type(within(dialog).getByRole('textbox'), 'Bir gönderi yaz');
          await user.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
          await within(dialog).findByRole('alert');
          fireEvent.change(dueField(dialog), { target: { value: later() } });
          await user.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
          expect(await screen.findByText(NOT_TAKEN)).toBeVisible();

          // Long after another toast would have left.
          await vi.advanceTimersByTimeAsync(60_000);
          expect(screen.getByText(NOT_TAKEN)).toBeVisible();
          // Closed with the keyboard: a button with a Turkish name, in the tab order.
          const close = screen.getByRole('button', { name: 'Bildirimi kapat' });
          expect(close).not.toHaveAttribute('tabindex', '-1');
          close.focus();
          await user.keyboard('{Enter}');
          await waitFor(() => {
            expect(screen.queryByText(NOT_TAKEN)).toBeNull();
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it('says nothing when the same request is sent again', async () => {
        const api = lostAnswer();
        await openList();
        const dialog = await openForm();
        await sendAndLose(dialog, 'Bir gönderi yaz', soon());
        await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
        expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
        expect(api.callsTo('POST /requests')).toHaveLength(2);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(screen.queryByText(NOT_TAKEN)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Bildirimi kapat' })).toBeNull();
      });
    });
  });
});

describe('Talepler', () => {
  it('groups the requests by whose turn it is and says the stage in words', async () => {
    const waiting = requestDetail();
    const working = requestDetail({
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Kasım bülteni',
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
    });
    const fallen = requestDetail({
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Kasım duyurusu',
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      waitingForMe: true,
    });
    // Returned by the routing: the legal unit has no open agent (8 October decision 2).
    const returned = requestDetail({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'KVKK metni',
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'returned_no_agent',
      turn: { kind: 'none' },
      waitingForMe: false,
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
    });
    const done = requestDetail({
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Ekim duyurusu',
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () =>
        json({
          requests: [working, waiting, done, fallen, returned].map(summaryOf),
          truncated: false,
        }),
    });
    renderApp('/c/armadx/requests');
    const mine = await screen.findByRole('region', { name: /Sizden beklenenler/ });
    expect(
      within(mine)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Onayınız bekleniyor'),
      expect.stringContaining('Sizden bekleniyor: ajan sonuç sunmadı'),
    ]);
    const running = screen.getByRole('region', { name: /Sürenler/ });
    expect(within(running).getByRole('listitem')).toHaveTextContent('Ajan çalışıyor');
    expect(within(running).getByRole('listitem')).toHaveTextContent('SOS-2');
    const [finished, sentBack] = within(
      screen.getByRole('region', { name: /Bitenler/ }),
    ).getAllByRole('listitem');
    expect(finished).toHaveTextContent('Tamamlandı');
    // A returned request is closed and waits for nobody. The row names the stage in words; the
    // status stays the existing "İptal" with its icon, and the link reads the same sentence.
    if (!sentBack) throw new Error('No row for the returned request');
    expect(sentBack).toHaveTextContent('Geri çevrildi: birimde açık ajan yok');
    expect(sentBack).not.toHaveTextContent(/İptal edildi|Sizden bekleniyor|İnsana düştü/);
    expect(within(sentBack).getByRole('img', { name: 'İptal' })).toBeVisible();
    expect(
      within(sentBack).getByRole('link', {
        name: 'KVKK metni, Geri çevrildi: birimde açık ajan yok',
      }),
    ).toHaveAttribute('href', '/c/armadx/requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(within(mine).queryByText(/KVKK metni/)).toBeNull();
    // A row is a link and nothing else: no control changes a status, a unit or an agent.
    const list = screen.getByRole('main');
    expect(within(list).queryAllByRole('combobox')).toEqual([]);
    expect(
      within(list)
        .queryAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Yeni talep']);
    expect(
      within(mine).getByRole('link', {
        name: 'LinkedIn için gönderi yaz, Onayınız bekleniyor, sıra sizde',
      }),
    ).toHaveAttribute('href', `/c/armadx/requests/${REQUEST_ID}`);
    // The founder starts with every request; the switch asks for their own.
    expect(api.callsTo('GET /requests')).toHaveLength(1);
    api.handle('GET /requests?mine=true', () => json({ requests: [], truncated: false }));
    await userEvent.click(screen.getByRole('switch', { name: 'Yalnızca benim taleplerim' }));
    expect(await screen.findByRole('heading', { name: 'Açık talebiniz yok' })).toBeVisible();
  });

  it('shows the due day of a row and says "Son tarihi geçti" for an open request whose day has ended', async () => {
    const agentTurn = {
      status: 'in_progress' as const,
      stage: 'working' as const,
      turn: { kind: 'agent' as const, code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
    };
    const due = requestDetail({ ...agentTurn, title: 'Kasım bülteni', dueDate: '2026-10-20' });
    const overdue = requestDetail({
      ...agentTurn,
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Ekim duyurusu',
      dueDate: '2026-10-05',
      overdue: true,
    });
    const none = requestDetail({
      ...agentTurn,
      id: '88888888-8888-4888-8888-888888888888',
      title: 'Fuar davetiyesi',
    });
    // Two different facts: the run takes too long ("gecikti") and the due day has passed.
    const lateAndOverdue = requestDetail({
      ...agentTurn,
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Basın bülteni',
      delayed: true,
      dueDate: '2026-10-06',
      overdue: true,
    });
    // A closed request keeps its day and is never said to be late (the API says `overdue`).
    const closed = requestDetail({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Eylül raporu',
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
      dueDate: '2026-10-01',
    });
    mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () =>
        json({
          requests: [due, overdue, none, lateAndOverdue, closed].map(summaryOf),
          truncated: false,
        }),
    });
    renderApp('/c/armadx/requests');
    const row = async (title: string) => {
      const link = await screen.findByRole('link', { name: new RegExp(`^${title}`) });
      const item = link.closest('li');
      if (!item) throw new Error(`No row for ${title}`);
      return { link, item };
    };

    const dueRow = await row('Kasım bülteni');
    const dueMark = within(dueRow.item).getByText(`Son tarih: ${formatDay('2026-10-20')}`);
    // jsdom lays nothing out; the classes are the contract of the two widths. A day that has not
    // passed gives way to the title below 1280 px.
    expect(dueMark).toHaveClass('hidden', 'xl:inline');
    expect(dueRow.link).toHaveAccessibleName(
      `Kasım bülteni, Ajan çalışıyor, sıra SOS-2, Son tarih: ${formatDay('2026-10-20')}`,
    );

    const overdueRow = await row('Ekim duyurusu');
    const overdueMark = within(overdueRow.item).getByText(
      `Son tarihi geçti: ${formatDay('2026-10-05')}`,
    );
    // A day that has passed is shown at every width, in words and without a colour of its own.
    expect(overdueMark).not.toHaveClass('hidden');
    expect(overdueMark.className).not.toMatch(/status|destructive|error/);
    expect(overdueRow.link).toHaveAccessibleName(
      `Ekim duyurusu, Ajan çalışıyor, sıra SOS-2, Son tarihi geçti: ${formatDay('2026-10-05')}`,
    );

    const noneRow = await row('Fuar davetiyesi');
    expect(noneRow.item).not.toHaveTextContent(/Son tarih/);
    expect(noneRow.link).toHaveAccessibleName('Fuar davetiyesi, Ajan çalışıyor, sıra SOS-2');

    const lateRow = await row('Basın bülteni');
    expect(lateRow.item).toHaveTextContent('Ajan çalışıyor (gecikti)');
    const lateMark = within(lateRow.item).getByText(`Son tarihi geçti: ${formatDay('2026-10-06')}`);
    expect(lateMark).not.toHaveTextContent(/gecikti/);
    // "gecikti" is said once in the row, by the stage.
    expect(lateRow.item.textContent.match(/gecikti/g)).toHaveLength(1);

    const closedRow = await row('Eylül raporu');
    expect(within(closedRow.item).getByText(`Son tarih: ${formatDay('2026-10-01')}`)).toBeVisible();
    expect(closedRow.item).not.toHaveTextContent(/Son tarihi geçti/);
    // The day is words in a row: still no control.
    expect(within(screen.getByRole('main')).queryAllByRole('combobox')).toEqual([]);
  });
});

describe('the page of a request', () => {
  it('shows the due day beside the stage and says in its own words that it has passed', async () => {
    const working = {
      status: 'in_progress' as const,
      stage: 'working' as const,
      turn: { kind: 'agent' as const, code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      approval: null,
    };
    const open = async (detail: ReturnType<typeof requestDetail>) => {
      cleanup();
      mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () => json(detail),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      await screen.findByRole('heading', { level: 2, name: /LinkedIn için gönderi yaz/ });
      return stageLine();
    };

    // A day that has not passed.
    expect(await open(requestDetail({ ...working, dueDate: '2026-10-20' }))).toBe(
      `Aşama: Ajan çalışıyor Sıra: SOS-2 Birim: Sosyal Medya Son tarih: ${formatDay('2026-10-20')}`,
    );
    const day = screen.getByText(formatDay('2026-10-20'));
    expect(day.tagName).toBe('TIME');
    expect(day).toHaveAttribute('datetime', '2026-10-20');

    // A day that has passed, on an open request; a run that takes long is another sentence.
    expect(
      await open(
        requestDetail({ ...working, delayed: true, dueDate: '2026-10-05', overdue: true }),
      ),
    ).toBe(
      `Aşama: Ajan çalışıyor (gecikti) Sıra: SOS-2 Birim: Sosyal Medya Son tarihi geçti: ${formatDay('2026-10-05')}`,
    );
    expect(screen.getByText(formatDay('2026-10-05'))).toHaveAttribute('datetime', '2026-10-05');

    // No day: nothing is said about one.
    expect(await open(requestDetail(working))).toBe(
      'Aşama: Ajan çalışıyor Sıra: SOS-2 Birim: Sosyal Medya',
    );
    expect(screen.getByRole('main')).not.toHaveTextContent(/Son tarih/);

    // A closed request keeps its day and is not said to be late.
    expect(
      await open(
        requestDetail({
          status: 'done',
          stage: 'done',
          turn: { kind: 'none' },
          waitingForMe: false,
          approval: null,
          dueDate: '2026-10-01',
          actions: { cancel: false, stop: false, reroute: false },
        }),
      ),
    ).toBe(`Aşama: Tamamlandı Birim: Sosyal Medya Son tarih: ${formatDay('2026-10-01')}`);
  });

  it('shows the approver the card, sends the decision with the chosen option and shows the answer', async () => {
    const approved = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: false,
      approval: null,
      result: RESULT,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            approval: { ...APPROVAL_CARD, needsStepUp: false, goesExternal: false },
          }),
        ),
      [`POST /approvals/${APPROVAL_ID}/decision`]: () => json(approved),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(stageLine()).toContain('Aşama: Onayınız bekleniyor Sıra: sizde Birim: Sosyal Medya');
    // The agent's words are under labels that say whose they are.
    expect(within(card).getByText('Özet (ajan yazdı)')).toBeVisible();
    expect(within(card).getByText('Ajanın gerekçesi')).toBeVisible();
    // Approving needs an option first, and says so.
    const approve = within(card).getByRole('button', { name: 'Onayla' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).toHaveAccessibleDescription('Onaylamak için önce bir seçenek seçin.');
    await userEvent.click(approve);
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)).toHaveLength(0);
    await userEvent.click(within(card).getByRole('radio', { name: /Seçenek B/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Onayla' }));
    // Nothing is shown before the API answers; then the page is what it answered.
    expect(await screen.findByRole('region', { name: 'Sonuç' })).toHaveTextContent(
      'Artık İzmir’deyiz.',
    );
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)[0]?.body).toEqual({
      decision: 'approved',
      selectedOption: 'B',
    });
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(stageLine()).toContain('Aşama: Talep sahibinin onayında Sıra: Ayşe Yılmaz');
    // The journey: fixed sentences from records; the coordinator's reason under its label.
    const journey = screen.getByRole('region', { name: 'Yolculuk' });
    expect(journey).toHaveTextContent('Ayşe Yılmaz talebi gönderdi.');
    expect(journey).toHaveTextContent(
      'Koordinasyon merkezi talebi yönlendirdi: Sosyal Medya, ajan SOS-2',
    );
    expect(journey).toHaveTextContent('Onaylayıcı: Kurucu.');
    // The coordinator's reason is a model's text: the API gives it to a decider only, and the
    // label says so.
    expect(
      within(journey).getByText('Koordinasyon merkezinin gerekçesi (yalnızca siz görürsünüz)'),
    ).toBeVisible();
    await userEvent.click(within(journey).getByRole('button', { name: '38 sn. çalıştı, 1 adım' }));
    expect(journey).toHaveTextContent('Onaya sundu');
    expect(api.unexpected).toEqual([]);
  });

  it('asks for a reason before it sends a change request, and for the passkey before an important approval', async () => {
    const back = requestDetail({
      status: 'in_progress',
      stage: 'revising',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      approval: null,
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
      [`POST /approvals/${APPROVAL_ID}/decision`]: () => json(back),
      'POST /step-up/options': () =>
        apiError(
          409,
          'no_passkey',
          'Bu işlem için passkey gerekiyor. Ayarlar, Güvenlik bölümünden bir passkey ekleyin.',
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    // The marks come from the record, apart from the agent's text.
    const marks = within(card).getByLabelText('Kayıttan gelen işaretler');
    expect(marks).toHaveTextContent('Dışarı gidecek');
    expect(marks).toHaveTextContent('Passkey ister');
    // An important approval opens the passkey dialog instead of sending the decision.
    await userEvent.click(within(card).getByRole('radio', { name: /Seçenek A/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Onayla' }));
    const passkey = await screen.findByRole('alertdialog', { name: 'Sonucu onayla' });
    expect(passkey).toHaveTextContent('Seçenek A onaylanacak');
    await waitFor(() => {
      expect(api.callsTo('POST /step-up/options')[0]?.body).toEqual({
        purpose: 'approve',
        companyId: ARMADX.companyId,
        subjectId: APPROVAL_ID,
        details: { decision: 'approved', selectedOption: 'A' },
      });
    });
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)).toHaveLength(0);
    // Each dialog gives the focus back to the button that opened it.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Onayla' })).toHaveFocus();
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Reddet' }));
    const reject = await screen.findByRole('dialog', { name: 'Sonucu reddet' });
    expect(reject).toHaveTextContent('Talep sahibi nedeni ve açıklamanızı okur');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Reddet' })).toHaveFocus();
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Düzeltme iste' }));
    await screen.findByRole('dialog', { name: 'Düzeltme iste' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'Düzeltme iste' })).toHaveFocus();
    });

    await userEvent.click(within(card).getByRole('button', { name: 'Düzeltme iste' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzeltme iste' });
    // Before anything is sent the fields say what must be filled: the reason must, and the note
    // may stay empty and says so in its label.
    const reason = within(dialog).getByRole('combobox', { name: 'Neden' });
    expect(reason).toBeRequired();
    expect(reason).not.toHaveAccessibleDescription();
    expect(
      within(dialog).getByRole('textbox', { name: 'Açıklama (isteğe bağlı)' }),
    ).not.toBeRequired();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
    expect(within(dialog).getByText('Bir neden seçin.')).toBeVisible();
    // An error belongs to its field: it is read again when the person returns to the field.
    expect(reason).toHaveAccessibleDescription('Bir neden seçin.');
    await userEvent.selectOptions(reason, 'Diğer');
    expect(reason).not.toHaveAccessibleDescription();
    // "Diğer" makes the note required, and the label no longer calls it optional.
    const note = within(dialog).getByRole('textbox', { name: 'Açıklama' });
    expect(note).toBeRequired();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
    expect(within(dialog).getByText('Açıklama yazın.')).toBeVisible();
    expect(note).toHaveAccessibleDescription(
      'İş, yazdığınız açıklamayla aynı ajana geri döner. Açıklama yazın.',
    );
    await userEvent.type(note, 'Daha sade olsun.');
    expect(note).toHaveAccessibleDescription('İş, yazdığınız açıklamayla aynı ajana geri döner.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Ajan düzeltiyor Sıra: SOS-2');
    });
    expect(api.callsTo(`POST /approvals/${APPROVAL_ID}/decision`)[0]?.body).toEqual({
      decision: 'changes_requested',
      reason: 'other',
      note: 'Daha sade olsun.',
    });
  });

  // A result that goes outside (every SOS-2 result) can only be approved this way: the decision is
  // sent together with a passkey answer made for exactly this approval and this option (rule 3
  // and 4). The API refuses anything else, so a slip here would show as "nothing can be approved".
  describe('an important approval', () => {
    const decisionKey = `POST /approvals/${APPROVAL_ID}/decision`;
    const approved = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: false,
      approval: null,
      result: RESULT,
    });

    /** Opens the page, chooses the option (if the result has any) and presses "Onayla". */
    async function openPasskeyDialog(option: 'A' | 'B' | null): Promise<{
      card: HTMLElement;
      dialog: HTMLElement;
      confirm: HTMLElement;
    }> {
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
      if (option !== null) {
        await userEvent.click(
          within(card).getByRole('radio', { name: new RegExp(`Seçenek ${option}`) }),
        );
      }
      await userEvent.click(within(card).getByRole('button', { name: 'Onayla' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Sonucu onayla' });
      const confirm = within(dialog).getByRole('button', { name: 'Passkey ile onayla' });
      // The button waits for the challenge.
      await waitFor(() => {
        expect(confirm).not.toHaveAttribute('aria-disabled');
      });
      return { card, dialog, confirm };
    }

    it('is sent with the chosen option and the signed challenge, and the page shows the answer', async () => {
      const stepUp = stepUpIssuer();
      const api = mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
        'POST /step-up/options': stepUp.handler,
        [decisionKey]: () => json(approved),
      });
      const { dialog, confirm } = await openPasskeyDialog('B');
      // The dialog names what is approved and that it goes outside.
      expect(dialog).toHaveTextContent(
        'Seçenek B onaylanacak ve talep sahibine iletilecek. Bu içerik şirket dışına gidecek.',
      );
      // The challenge is asked for this approval and this option; nothing is decided yet.
      expect(stepUp.issued.map((challenge) => challenge.body)).toEqual([
        {
          purpose: 'approve',
          companyId: ARMADX.companyId,
          subjectId: APPROVAL_ID,
          details: { decision: 'approved', selectedOption: 'B' },
        },
      ]);
      expect(api.callsTo(decisionKey)).toHaveLength(0);
      expect(startAuthentication).not.toHaveBeenCalled();

      await userEvent.click(confirm);
      // The page is what the API answered.
      expect(await screen.findByRole('region', { name: 'Sonuç' })).toHaveTextContent(
        'Artık İzmir’deyiz.',
      );
      expect(startAuthentication).toHaveBeenCalledTimes(1);
      expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: STEP_UP_OPTIONS });
      const calls = api.callsTo(decisionKey);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.body).toEqual({
        decision: 'approved',
        selectedOption: 'B',
        stepUp: signed(challengeId(1)),
      });
      expect(calls[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
      expect(stageLine()).toContain('Aşama: Talep sahibinin onayında Sıra: Ayşe Yılmaz');
      expect(api.unexpected).toEqual([]);
    });

    it('is sent without an option for a result that has none', async () => {
      const stepUp = stepUpIssuer();
      const api = mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () =>
          json(requestDetail({ approval: { ...APPROVAL_CARD, options: [] } })),
        'POST /step-up/options': stepUp.handler,
        [decisionKey]: () => json(approved),
      });
      const { dialog, confirm } = await openPasskeyDialog(null);
      expect(dialog).toHaveTextContent('Sonuç onaylanacak ve talep sahibine iletilecek.');
      expect(stepUp.issued[0]?.body).toEqual({
        purpose: 'approve',
        companyId: ARMADX.companyId,
        subjectId: APPROVAL_ID,
        // The same shape the API builds from the decision: no option was chosen.
        details: { decision: 'approved', selectedOption: null },
      });
      await userEvent.click(confirm);
      await screen.findByRole('region', { name: 'Sonuç' });
      expect(api.callsTo(decisionKey).map((call) => call.body)).toEqual([
        { decision: 'approved', stepUp: signed(challengeId(1)) },
      ]);
    });

    it('says the refusal of the API in the dialog and shows nothing as decided', async () => {
      const refusal =
        'Bu onay kapanmış: karar verilmiş ya da dayandığı talep değişmiş. Sayfayı yenileyin.';
      const stepUp = stepUpIssuer();
      const api = mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
        'POST /step-up/options': stepUp.handler,
        [decisionKey]: () => apiError(409, 'approval_closed', refusal),
      });
      const { card, dialog, confirm } = await openPasskeyDialog('A');
      await userEvent.click(confirm);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(refusal);
      expect(api.callsTo(decisionKey).map((call) => call.body)).toEqual([
        { decision: 'approved', selectedOption: 'A', stepUp: signed(challengeId(1)) },
      ]);
      // The dialog stays with the message, and the page behind it shows no result.
      expect(screen.getByRole('alertdialog', { name: 'Sonucu onayla' })).toBeVisible();
      expect(screen.queryByRole('region', { name: 'Sonuç', hidden: true })).toBeNull();
      // The challenge the API has seen is used up: the next try gets a new one.
      await waitFor(() => {
        expect(stepUp.issued).toHaveLength(2);
      });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(within(card).getByRole('button', { name: 'Onayla' })).toHaveFocus();
      });
      expect(api.callsTo(decisionKey)).toHaveLength(1);
    });
  });

  it('gives the requester the result and the acceptance, and nobody else a card', async () => {
    const waiting = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: true,
      approval: null,
      result: RESULT,
      acceptance: { round: 1, returnsToAgent: true },
      actions: { cancel: true, stop: false, reroute: false },
    });
    const done = requestDetail({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
      approval: null,
      result: RESULT,
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(waiting),
      [`POST /requests/${REQUEST_ID}/acceptance`]: () => json(done),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    expect(card).toHaveTextContent('Ömer Kadıoğlu onayladı.');
    expect(stageLine()).toContain('Aşama: Sonucu onaylamanız bekleniyor Sıra: sizde');
    // "Not what I asked for" needs the requester's own words, and nothing else: the requester
    // is not asked to pick from the approver's list of reasons.
    await userEvent.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(dialog).toHaveTextContent('aynı ajana bir kez geri döner');
    // The requester's own words are always required here.
    const words = within(dialog).getByRole('textbox', { name: 'Açıklama' });
    expect(words).toBeRequired();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gönder' }));
    expect(within(dialog).getByText('Açıklama yazın.')).toBeVisible();
    expect(words).toHaveAccessibleDescription(/Açıklama yazın\.$/);
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/acceptance`)).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByRole('button', { name: 'İstediğim bu değil' })).toHaveFocus();
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Sonucu onayla' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Tamamlandı');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/acceptance`)[0]?.body).toEqual({
      decision: 'approved',
    });
    expect(screen.queryByRole('region', { name: 'Sonuç hazır' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Talebi iptal et' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Sonuç' })).toBeVisible();
  });

  it('sends the requester’s own words, and says the truth about the second time', async () => {
    const waiting = requestDetail({
      stage: 'requester_approval',
      turn: { kind: 'person', ...EMPLOYEE },
      waitingForMe: true,
      approval: null,
      result: RESULT,
      acceptance: { round: 2, returnsToAgent: false },
      actions: { cancel: true, stop: false, reroute: false },
    });
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'second_change_request',
      turn: { kind: 'founder' },
      waitingForMe: false,
      approval: null,
      result: RESULT,
      actions: { cancel: true, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(waiting),
      [`POST /requests/${REQUEST_ID}/acceptance`]: () => json(fallen),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    await userEvent.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    // After the first time the work does not go back to the agent: it falls to the founder
    // (8 October decision 3), and the dialog says so. No number: the same holds for a third
    // answer, after the founder routed the request again.
    expect(dialog).toHaveTextContent(
      'Daha önce düzeltme istediniz: iş ajana kendiliğinden dönmez, kurucuya düşer.',
    );
    expect(dialog).not.toHaveTextContent(/onaylayıcısına|geri döner|ikinci/);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Açıklama' }), 'Çok uzun.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gönder' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İnsana düştü: ikinci düzeltme isteği Sıra: Kurucu');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/acceptance`)[0]?.body).toEqual({
      decision: 'changes_requested',
      note: 'Çok uzun.',
    });
    // The requester cannot act on it and is not told that they can.
    expect(screen.queryByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeNull();
    expect(screen.getByText('Talep kayıtlı. Sıradaki adımı Kurucu atacak.')).toBeVisible();
    expect(screen.queryByText(/Yönlendirmeyi düzelt/)).toBeNull();
  });

  // Every founder and employee of the company can open the page: no sentence on it addresses the
  // reader as the owner of the request.
  it('does not call a request that fell to a person the reader’s own', async () => {
    // A colleague who is neither the requester nor the approver.
    mockApi({
      'GET /session': sessionHandler({
        user: { id: '99999999-9999-4999-8999-999999999999', name: 'Mehmet Demir' },
        memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
      }),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'in_progress',
            stage: 'fell_to_person',
            cause: 'second_change_request',
            turn: { kind: 'founder' },
            waitingForMe: false,
            approval: null,
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText('Talep kayıtlı. Sıradaki adımı Kurucu atacak.')).toBeVisible();
    expect(screen.getByText('Ayşe Yılmaz yazdı.')).toBeVisible();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Talebiniz/);
  });

  it('does not call a request that takes long the reader’s own', async () => {
    // The founder reads an employee's request.
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'in_progress',
            stage: 'working',
            delayed: true,
            turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
            waitingForMe: false,
            approval: null,
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText(
        'Bu adım beklenenden uzun sürüyor. Talep kayıtlı. Çalıştırıcı çalışmıyor olabilir. Çalışma başlamadıysa "Yönlendirmeyi düzelt" ile işi yeniden verebilirsiniz.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Ayşe Yılmaz yazdı.')).toBeVisible();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Talebiniz/);
  });

  it('counts the requester’s own change requests, not the rounds of the acceptance', async () => {
    // The routing was corrected while the result waited for the requester: the new result opened
    // round 2, and the requester has not said "not what I asked for" yet. The API says the work
    // goes back to the agent, and so does the dialog.
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            stage: 'requester_approval',
            turn: { kind: 'person', ...EMPLOYEE },
            waitingForMe: true,
            approval: null,
            result: RESULT,
            acceptance: { round: 2, returnsToAgent: true },
            actions: { cancel: true, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
    await userEvent.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
    const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(dialog).toHaveTextContent('İş bu açıklamayla aynı ajana bir kez geri döner');
    expect(dialog).not.toHaveTextContent(/Daha önce düzeltme istediniz|kurucuya düşer/);
  });

  // The founder's own example: a KVKK text, routed to the legal unit, which has no agent. The
  // request went back to its requester and was closed (8 October decision 2). The API gives the
  // coordinator's own reason to nobody but the one who may decide.
  const returnedRequest = (reason: string | null) =>
    requestDetail({
      title: 'KVKK aydınlatma metni hazırlansın',
      text: 'KVKK aydınlatma metni hazırlansın',
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'returned_no_agent',
      turn: { kind: 'none' },
      waitingForMe: false,
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
      agent: null,
      approval: null,
      closure: null,
      journey: [
        {
          kind: 'run',
          id: '44444444-4444-4444-8444-444444444444',
          at: '2026-10-07T09:00:00.000Z',
          agent: { code: 'KOR-1', name: 'Ofis Koordinatörü' },
          status: 'completed',
          finishedAt: '2026-10-07T09:00:04.000Z',
          durationMs: 4000,
          errorCode: null,
          summary:
            'Talep Hukuk ve Uyum birimine yönlendirildi; birimde işi alabilecek açık ajan olmadığı için talep sahibine geri çevrildi.',
          agentText: null,
          steps: [{ tool: 'route_task', status: 'succeeded' }],
        },
        {
          kind: 'routing',
          id: '66666666-6666-4666-8666-666666666666',
          at: '2026-10-07T09:00:00.000Z',
          round: 1,
          unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
          agent: null,
          approver: null,
          by: null,
          reason,
        },
      ],
      actions: { cancel: false, stop: false, reroute: false },
    });
  const RETURNED_WHY =
    'Talep geri çevrildi: Hukuk ve Uyum biriminde bu işi alabilecek açık ajan yok.';
  const RETURNED_THEN =
    'Talep kapandı; bu iş için bir ajan açıldığında yeni bir talep gönderebilirsiniz.';

  it('a returned request tells its requester why with the unit’s name, that it is closed, and offers nothing', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () => json(returnedRequest(null)),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    // The two sentences of the notice: why, with the unit's name, and what follows from it.
    expect(await screen.findByText(RETURNED_WHY)).toBeVisible();
    expect(screen.getByText(RETURNED_THEN)).toBeVisible();
    // The header names the stage in words; the status is the existing "İptal".
    expect(stageLine()).toBe('Aşama: Geri çevrildi: birimde açık ajan yok Birim: Hukuk ve Uyum');
    expect(
      within(screen.getByRole('heading', { level: 2, name: /KVKK aydınlatma metni/ })).getByRole(
        'img',
        {
          name: 'İptal',
        },
      ),
    ).toBeVisible();
    // Nothing is offered, and no sentence names a way on for this request.
    for (const name of ['Yönlendirmeyi düzelt', 'İşi durdur', 'Talebi iptal et']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    const page = screen.getByRole('main');
    expect(page).not.toHaveTextContent(/Yönlendirmeyi düzelt|kapatabilirsiniz|iptal etti|durdurdu/);
    expect(page).not.toHaveTextContent(/Sizden bekleniyor|Bir kişi ilgilenecek|İnsana düştü/);
    // The journey says the same in the code's own words (the run's summary and the step), names
    // no approver for a step nobody works on, and shows no reason of the coordinator.
    const journey = screen.getByRole('region', { name: 'Yolculuk' });
    expect(journey).toHaveTextContent(
      'Talep Hukuk ve Uyum birimine yönlendirildi; birimde işi alabilecek açık ajan olmadığı için talep sahibine geri çevrildi.',
    );
    expect(journey).toHaveTextContent(
      'Koordinasyon merkezi talebi yönlendirdi: Hukuk ve Uyum; birimde bu işi alabilecek açık ajan yok.',
    );
    expect(journey).not.toHaveTextContent(/Onaylayıcı|gerekçesi/);
    expect(api.unexpected).toEqual([]);
  });

  it('the founder reads the same notice on a returned request, with the coordinator’s reason, and is offered nothing either', async () => {
    const reason = 'Hukuk ve uyum işi; birimde bunu yazabilecek ajan yok.';
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(returnedRequest(reason)),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText(RETURNED_WHY)).toBeVisible();
    expect(screen.getByText(RETURNED_THEN)).toBeVisible();
    expect(stageLine()).toBe('Aşama: Geri çevrildi: birimde açık ajan yok Birim: Hukuk ve Uyum');
    // The coordinator's own words stay in the journey, under the label that says whose they are.
    const journey = screen.getByRole('region', { name: 'Yolculuk' });
    expect(
      within(journey).getByText('Koordinasyon merkezinin gerekçesi (yalnızca siz görürsünüz)'),
    ).toBeVisible();
    expect(within(journey).getByText(reason)).toBeVisible();
    for (const name of ['Yönlendirmeyi düzelt', 'İşi durdur', 'Talebi iptal et']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // No way on is named for a closed request, also not to the one who could open an agent.
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /Yönlendirmeyi düzelt|Ofis görünümünden|kapatabilirsiniz|Sizden bekleniyor/,
    );
    expect(api.unexpected).toEqual([]);
  });

  it('a request that fell to a person is not a dead end: the founder corrects the routing', async () => {
    // The unit agent ended its run without submitting; the founder gives the work to an agent.
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      turn: { kind: 'founder' },
      waitingForMe: true,
      // The request's own unit has no open agent any more.
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
      agent: null,
      approval: null,
      journey: [],
      actions: { cancel: false, stop: true, reroute: true },
    });
    const rerouted = requestDetail({
      ...fallen,
      status: 'in_progress',
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      waitingForMe: false,
      unit: { code: 'SOS', name: 'Sosyal Medya' },
      agent: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [`GET /requests/${REQUEST_ID}/routing-options`]: () =>
        json({
          units: [
            { code: 'HUK', name: 'Hukuk ve Uyum', agents: [] },
            {
              code: 'SOS',
              name: 'Sosyal Medya',
              agents: [{ code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' }],
            },
          ],
        }),
      [`POST /requests/${REQUEST_ID}/routing`]: () => json(rerouted),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText('Ajan sonucu onaya sunmadan çalışmasını bitirdi.'),
    ).toBeVisible();
    // No sentence promises that opening an agent revives the request; the way on is named.
    expect(screen.queryByText(/Ofis görünümünden açabilirsiniz/)).toBeNull();
    expect(
      screen.getByText(/"Yönlendirmeyi düzelt" ile işi aynı ajana yeniden verebilir/),
    ).toBeVisible();
    const open = screen.getByRole('button', { name: 'Yönlendirmeyi düzelt' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    const unit = await within(dialog).findByRole('combobox', { name: 'Birim' });
    // A unit without an open agent stays in the list, so that the founder sees why it cannot be
    // chosen, and cannot be picked.
    await waitFor(() => {
      expect(
        within(unit).getByRole('option', { name: 'Hukuk ve Uyum (açık ajan yok)' }),
      ).toBeDisabled();
    });
    expect(within(unit).getByRole('option', { name: 'Sosyal Medya' })).toBeEnabled();
    // The request's own unit has no open agent, so nothing is chosen to begin with; no approver
    // can be chosen anywhere.
    expect(unit).toHaveValue('');
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(2);
    const agent = within(dialog).getByRole('combobox', { name: 'Ajan' });
    expect(agent).toBeDisabled();
    // No way to leave the request at a unit without an agent.
    expect(within(dialog).queryByRole('option', { name: /Ajan yok/ })).toBeNull();
    expect(dialog).not.toHaveTextContent(/onaylayıcısına düşer/);
    await userEvent.selectOptions(unit, 'HUK').catch(() => undefined);
    expect(unit).toHaveValue('');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
    });
    await userEvent.click(open);
    const again = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    await waitFor(() => {
      expect(within(again).getByRole('option', { name: 'Sosyal Medya' })).toBeVisible();
    });
    const send = within(again).getByRole('button', { name: 'Yönlendir' });
    // Nothing chosen: the form says which field is missing and sends nothing.
    await userEvent.click(send);
    expect(within(again).getByRole('alert')).toHaveTextContent('Bir birim seçin.');
    const unitBox = within(again).getByRole('combobox', { name: 'Birim' });
    expect(unitBox).toBeRequired();
    expect(unitBox).toHaveAccessibleDescription('Bir birim seçin.');
    await userEvent.selectOptions(unitBox, 'SOS');
    expect(unitBox).not.toHaveAccessibleDescription();
    // A unit alone is not enough: an agent must be chosen.
    const agentBox = within(again).getByRole('combobox', { name: 'Ajan' });
    expect(agentBox).toBeEnabled();
    expect(agentBox).toHaveValue('');
    expect(
      within(agentBox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Seçin', 'SOS-2 Sosyal İçerik Yazım Ajanı']);
    await userEvent.click(send);
    expect(within(again).getByRole('alert')).toHaveTextContent('Bir ajan seçin.');
    expect(agentBox).toBeInvalid();
    expect(agentBox).toBeRequired();
    // The help and, while it is shown, the error.
    expect(agentBox).toHaveAccessibleDescription(
      /^Yalnızca bu şirkette açık olan ajanlar listelenir.* Bir ajan seçin\.$/,
    );
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(0);
    await userEvent.selectOptions(agentBox, 'SOS-2');
    expect(within(again).queryByRole('alert')).toBeNull();
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Açıklama (isteğe bağlı)' }),
      'Taslağı sosyal içerik ajanı yazsın.',
    );
    await userEvent.click(send);
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: Ajan çalışıyor Sıra: SOS-2 Birim: Sosyal Medya');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(1);
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)[0]?.body).toEqual({
      unitCode: 'SOS',
      agentCode: 'SOS-2',
      note: 'Taslağı sosyal içerik ajanı yazsın.',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.unexpected).toEqual([]);
  });

  // The agent was stopped when the approver asked for changes, so no run was called for; the
  // founder opened it again, which starts nothing (the plan's decision for SV-4, SONRA Y-j). The
  // request stays with a person and the page says so and names the way on.
  const neverStarted = (overrides: Parameters<typeof requestDetail>[0] = {}) =>
    requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'not_started',
      turn: { kind: 'founder' },
      approval: null,
      ...overrides,
    });
  const NOT_STARTED =
    'Ajanın çalışması başlatılamadı: iş verildiğinde ajan kapalıydı ya da çalışmaya hazır değildi. Ajan şimdi açık, ama iş kendiliğinden başlamaz.';

  it('a request whose run was never started tells the one who can act how the work is given again', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(neverStarted()),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText(NOT_STARTED)).toBeVisible();
    expect(stageLine()).toContain('Aşama: Sizden bekleniyor: çalışma başlamadı Sıra: sizde');
    // The way on is named and offered; nothing says that the agent will take the work by itself
    // or that opening an agent would start it.
    expect(
      screen.getByText(
        '"Yönlendirmeyi düzelt" ile işi bir ajana yeniden verin; yeni bir çalışma başlar. İş gerekmiyorsa talebi kapatabilirsiniz.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'İşi durdur' })).toBeVisible();
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /Ofis görünümünden|Ajan çalışıyor|Ajan düzeltiyor|gecikti/,
    );
  });

  it('a request whose run was never started tells its requester that a person will take the next step', async () => {
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          neverStarted({
            waitingForMe: false,
            actions: { cancel: true, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText(NOT_STARTED)).toBeVisible();
    expect(stageLine()).toContain('Aşama: İnsana düştü: çalışma başlamadı Sıra: Kurucu');
    expect(screen.getByText('Talep kayıtlı. Sıradaki adımı Kurucu atacak.')).toBeVisible();
    // The requester cannot route and is not told to.
    expect(screen.queryByRole('button', { name: 'Yönlendirmeyi düzelt' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Yönlendirmeyi düzelt/);
    expect(screen.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible();
  });

  it('the correction dialog says so and offers no send when no unit has an open agent', async () => {
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'agent_stopped',
      approval: null,
      journey: [],
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [`GET /requests/${REQUEST_ID}/routing-options`]: () =>
        json({
          units: [
            { code: 'HUK', name: 'Hukuk ve Uyum', agents: [] },
            { code: 'SOS', name: 'Sosyal Medya', agents: [] },
          ],
        }),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const open = await screen.findByRole('button', { name: 'Yönlendirmeyi düzelt' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    // The dialog cannot send, so it names what the founder can do instead.
    expect(
      await within(dialog).findByText(
        'Şu an hiçbir birimde açık ajan yok; talep bir ajana verilemez. Ofis görünümünden bir ajan açabilir ya da talebi kapatabilirsiniz.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Yönlendir' })).toBeNull();
    expect(within(dialog).queryAllByRole('combobox')).toEqual([]);
    // The dialog closes as before and gives the focus back.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(0);
    expect(api.unexpected).toEqual([]);
  });

  it('the correction dialog does not tell an approver who is not the founder to open an agent', async () => {
    mockApi({
      'GET /session': sessionHandler({
        user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
        memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: true }],
      }),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'in_progress',
            stage: 'fell_to_person',
            cause: 'agent_stopped',
            turn: { kind: 'person', ...EMPLOYEE },
            requester: FOUNDER,
            approver: EMPLOYEE,
            approval: null,
            journey: [],
          }),
        ),
      [`GET /requests/${REQUEST_ID}/routing-options`]: () =>
        json({ units: [{ code: 'SOS', name: 'Sosyal Medya', agents: [] }] }),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Yönlendirmeyi düzelt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    expect(
      await within(dialog).findByText(
        'Şu an hiçbir birimde açık ajan yok; talep bir ajana verilemez. Ajanları kurucu açar; talebi kapatabilirsiniz.',
      ),
    ).toBeVisible();
    expect(dialog).not.toHaveTextContent(/Ofis görünümünden/);
  });

  it('the correction dialog reads the list again when the API refuses a choice that closed meanwhile', async () => {
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      approval: null,
      journey: [],
    });
    const optionsKey = `GET /requests/${REQUEST_ID}/routing-options`;
    // SOS-2 is stopped after the dialog read the list.
    let sosOpen = true;
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [optionsKey]: () =>
        json({
          units: [
            {
              code: 'HAF',
              name: 'Kurumsal Hafıza',
              agents: [{ code: 'HAF-2', name: 'Kurumsal Arama Ajanı' }],
            },
            {
              code: 'SOS',
              name: 'Sosyal Medya',
              agents: sosOpen ? [{ code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' }] : [],
            },
          ],
        }),
      [`POST /requests/${REQUEST_ID}/routing`]: () =>
        apiError(
          409,
          'routing_not_possible',
          'Bu birim ya da ajan şu an seçilemiyor. Listeyi yenileyip yeniden deneyin.',
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Yönlendirmeyi düzelt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    const unit = within(dialog).getByRole('combobox', { name: 'Birim' });
    // The request's own unit and agent are chosen to begin with.
    await waitFor(() => {
      expect(unit).toHaveValue('SOS');
    });
    expect(within(dialog).getByRole('combobox', { name: 'Ajan' })).toHaveValue('SOS-2');
    expect(api.callsTo(optionsKey)).toHaveLength(1);
    sosOpen = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yönlendir' }));
    expect(
      await within(dialog).findByText(
        'Bu birim ya da ajan şu an seçilemiyor. Listeyi yenileyip yeniden deneyin.',
      ),
    ).toBeVisible();
    // The list is read again without the person closing the dialog, and what cannot be chosen
    // is no longer offered: the unit says why, and the choice is cleared.
    await waitFor(() => {
      expect(api.callsTo(optionsKey)).toHaveLength(2);
      expect(
        within(unit).getByRole('option', { name: 'Sosyal Medya (açık ajan yok)' }),
      ).toBeDisabled();
    });
    expect(unit).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: 'Ajan' })).toBeDisabled();
    expect(within(unit).getByRole('option', { name: 'Kurumsal Hafıza' })).toBeEnabled();
    // The form asks for a new choice beside the API's sentence.
    expect(unit).toHaveAccessibleDescription('Bir birim seçin.');
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(1);
  });

  it('the correction dialog offers to read the list again when it could not be read', async () => {
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      approval: null,
      journey: [],
    });
    const optionsKey = `GET /requests/${REQUEST_ID}/routing-options`;
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [optionsKey]: () =>
        apiError(429, 'rate_limited', 'Çok fazla istek gönderildi. Biraz sonra yeniden deneyin.'),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Yönlendirmeyi düzelt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yönlendirmeyi düzelt' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Çok fazla istek gönderildi. Biraz sonra yeniden deneyin.',
    );
    // Nothing to choose from and nothing to send: only the way to read the list again.
    expect(within(dialog).queryAllByRole('combobox')).toEqual([]);
    expect(within(dialog).queryByRole('button', { name: 'Yönlendir' })).toBeNull();
    api.handle(optionsKey, () =>
      json({
        units: [
          {
            code: 'SOS',
            name: 'Sosyal Medya',
            agents: [{ code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' }],
          },
        ],
      }),
    );
    const calls = api.callsTo(optionsKey).length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yeniden dene' }));
    expect(await within(dialog).findByRole('combobox', { name: 'Birim' })).toHaveValue('SOS');
    expect(api.callsTo(optionsKey)).toHaveLength(calls + 1);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Yönlendir' })).toBeVisible();
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/routing`)).toHaveLength(0);
  });

  it('shows what an agent wrote without submitting to the decider alone, under its own label', async () => {
    const journey = DEFAULT_JOURNEY.map((item, index) =>
      item.kind === 'run' && index === 2
        ? {
            ...item,
            summary: 'Ajan sonucu onaya sunmadan çalışmasını bitirdi.',
            agentText: 'Kaynak bilgi yetersiz: açılış tarihi yok.',
            steps: [],
          }
        : item,
    );
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      approval: null,
      journey,
    });
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      (await screen.findAllByText('Ajan sonucu onaya sunmadan çalışmasını bitirdi.')).length,
    ).toBeGreaterThan(0);
    // Once, in the notice where the decision is made; not repeated in the journey.
    expect(
      screen.getByText('SOS-2 şunu yazdı (onaylanmadı; yalnızca siz görürsünüz)'),
    ).toBeVisible();
    expect(screen.getByText('Kaynak bilgi yetersiz: açılış tarihi yok.')).toBeVisible();
    expect(screen.getByText(/işi aynı ajana yeniden verebilir/)).toBeVisible();
  });

  it('whoever stops somebody else’s request says why, and the requester reads it', async () => {
    const stopped = requestDetail({
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'stopped',
      turn: { kind: 'none' },
      waitingForMe: false,
      approval: null,
      closure: { by: FOUNDER, reason: null, note: 'Bu iş bu hafta yapılmayacak.' },
      actions: { cancel: false, stop: false, reroute: false },
    });
    // The result of the request waits on the desk until the request is closed.
    let waiting = true;
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /approvals': () => json({ approvals: waiting ? [APPROVAL_CARD] : [], acceptances: [] }),
      // The sidebar counts it from the light endpoint, not from the desk.
      'GET /today/counts': () => json({ today: waiting ? 1 : 0, approvals: waiting ? 1 : 0 }),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
      [`POST /requests/${REQUEST_ID}/close`]: () => {
        waiting = false;
        return json(stopped);
      },
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const menu = await screen.findByRole('navigation', { name: 'Ana menü' });
    expect(await within(menu).findByRole('link', { name: 'Onaylar, 1 bekleyen' })).toBeVisible();
    const stop = await screen.findByRole('button', { name: 'İşi durdur' });
    await userEvent.click(stop);
    const confirm = await screen.findByRole('alertdialog', { name: 'İş durdurulsun mu?' });
    expect(confirm).toHaveTextContent('durdurmak yerine yönlendirmeyi düzeltebilirsiniz');
    // Stopping somebody else's request needs a reason, and the field says so beforehand.
    const why = within(confirm).getByRole('textbox', { name: 'Neden' });
    expect(why).toBeRequired();
    expect(why).toHaveAccessibleDescription('Talep sahibi bu nedeni okur.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'İşi durdur' }));
    expect(within(confirm).getByRole('alert')).toHaveTextContent('Bir neden yazın.');
    expect(why).toHaveAccessibleDescription('Talep sahibi bu nedeni okur. Bir neden yazın.');
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(stop).toHaveFocus();
    });
    await userEvent.click(stop);
    const again = await screen.findByRole('alertdialog', { name: 'İş durdurulsun mu?' });
    await userEvent.type(
      within(again).getByRole('textbox', { name: 'Neden' }),
      'Bu iş bu hafta yapılmayacak.',
    );
    await userEvent.click(within(again).getByRole('button', { name: 'İşi durdur' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İptal edildi: durduruldu');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)[0]?.body).toEqual({
      reason: 'Bu iş bu hafta yapılmayacak.',
    });
    // Who closed it and why, in that person's words.
    expect(screen.getByText('Ömer Kadıoğlu işi durdurdu.')).toBeVisible();
    expect(screen.getByText('Bu iş bu hafta yapılmayacak.')).toBeVisible();
    // The pending approval closed with the request: the count on the menu row follows at once,
    // not at the next background refresh.
    expect(await within(menu).findByRole('link', { name: 'Onaylar' })).toBeVisible();
    expect(within(menu).queryByRole('link', { name: /bekleyen/ })).toBeNull();
  });

  it('tells the requester who rejected the result and why, never the output', async () => {
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'rejected',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            closure: {
              by: FOUNDER,
              reason: 'out_of_scope',
              note: 'Bu konuda gönderi yayınlamıyoruz.',
            },
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByText('Ömer Kadıoğlu sonucu reddetti: Kapsam dışı.')).toBeVisible();
    expect(screen.getByText('Bu konuda gönderi yayınlamıyoruz.')).toBeVisible();
    expect(stageLine()).toContain('Aşama: İptal edildi: sonuç reddedildi');
    expect(screen.queryByRole('region', { name: 'Sonuç' })).toBeNull();
  });

  it('a request stopped after its result was delivered says so, and keeps the result', async () => {
    mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'closed_after_delivery',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            result: RESULT,
            closure: { by: FOUNDER, reason: null, note: 'Talep sahibi izinde.' },
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText(/Ömer Kadıoğlu talebi kapattı\. Onaylanan sonuç aşağıda/),
    ).toBeVisible();
    expect(stageLine()).toContain('Aşama: Kapatıldı: sonuç iletildi, talep sahibi yanıtlamadı');
    expect(screen.getByRole('region', { name: 'Sonuç' })).toHaveTextContent('Artık İzmir’deyiz.');
  });

  it('draws a closed approval as an event in the journey, not with the icon of a rejection', async () => {
    // The routing was corrected while a result waited for the unit and, later, while one waited
    // for the requester: both closed without anybody deciding. A later result was rejected.
    const at = '2026-10-07T09:10:00.000Z';
    const closedApproval = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const closedAcceptance = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const rejected = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'rejected',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            closure: { by: FOUNDER, reason: 'incomplete', note: null },
            actions: { cancel: false, stop: false, reroute: false },
            journey: [
              ...DEFAULT_JOURNEY,
              {
                kind: 'approval',
                id: closedApproval,
                at,
                status: 'closed',
                attempt: 1,
                agent: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
                decidedBy: null,
                reason: null,
                note: null,
              },
              {
                kind: 'acceptance',
                id: closedAcceptance,
                at,
                round: 1,
                status: 'closed',
                reason: null,
                note: null,
              },
              {
                kind: 'approval',
                id: rejected,
                at,
                status: 'rejected',
                attempt: 1,
                agent: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
                decidedBy: FOUNDER,
                reason: 'incomplete',
                note: null,
              },
            ],
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const journey = await screen.findByRole('region', { name: 'Yolculuk' });
    const row = (text: string): HTMLElement => {
      const item = within(journey)
        .getAllByRole('listitem')
        .find((candidate) => candidate.textContent.includes(text));
      if (!item) throw new Error(`No journey row says: ${text}`);
      return item;
    };
    // The same neutral mark as the other events of the journey ("talebi gönderdi"), and no icon.
    for (const text of [
      'Bekleyen onay kapandı: talep değişti.',
      'Talep sahibinin onayı kapandı: talep değişti.',
      'Ayşe Yılmaz talebi gönderdi.',
    ]) {
      expect(row(text).querySelector('[data-journey-mark="event"]')).not.toBeNull();
      expect(row(text).querySelector('svg')).toBeNull();
    }
    // A rejection keeps the icon and the tone of "Reddedildi".
    const rejection = row('Ömer Kadıoğlu sonucu reddetti: Eksik.');
    expect(rejection.querySelector('[data-journey-mark="event"]')).toBeNull();
    expect(rejection.querySelector('svg')).toHaveClass('text-status-error');
  });

  it('says where a money mark comes from', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        json(
          requestDetail({
            approval: { ...APPROVAL_CARD, involvesMoney: true, moneyStatedBy: 'agent' },
          }),
        ),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    expect(within(card).getByLabelText('Kayıttan gelen işaretler')).toHaveTextContent(
      'Para içeriyor (ajan belirtti)',
    );
  });

  it('says why a request fell to a person, tells the founder what to do, and lets the requester cancel', async () => {
    const fallen = requestDetail({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'model_unavailable',
      turn: { kind: 'founder' },
      waitingForMe: true,
      unit: null,
      agent: null,
      approval: null,
      requester: FOUNDER,
      journey: [],
      actions: { cancel: true, stop: false, reroute: false },
    });
    const cancelled = requestDetail({
      ...fallen,
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'cancelled_by_requester',
      turn: { kind: 'none' },
      waitingForMe: false,
      closure: { by: { userId: USER_ID, name: 'Ömer Kadıoğlu' }, reason: null, note: null },
      actions: { cancel: false, stop: false, reroute: false },
    });
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(fallen),
      [`POST /requests/${REQUEST_ID}/close`]: () => json(cancelled),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(
      await screen.findByText('Ajanlar şu an çalışamıyor: model hizmetine bağlanılamadı.'),
    ).toBeVisible();
    expect(screen.getByText(/Anthropic API anahtarı tanımlı değil/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Talebi iptal et' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Talep iptal edilsin mi?' });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)).toHaveLength(0);
    // A cancel needs no reason, and the field says so.
    expect(
      within(confirm).getByRole('textbox', { name: 'Neden (isteğe bağlı)' }),
    ).not.toBeRequired();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Talebi iptal et' }));
    await waitFor(() => {
      expect(stageLine()).toContain('Aşama: İptal edildi: talep sahibi iptal etti');
    });
    expect(api.callsTo(`POST /requests/${REQUEST_ID}/close`)[0]?.body).toEqual({});
    expect(screen.queryByRole('button', { name: 'Talebi iptal et' })).toBeNull();
    expect(screen.getByText('Ömer Kadıoğlu talebi iptal etti.')).toBeVisible();
  });

  it('answers a hidden, a missing and a malformed id with the same screen', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () =>
        apiError(404, 'not_found', 'Aradığınız kayıt bulunamadı.'),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    expect(await screen.findByRole('heading', { name: 'Talep bulunamadı' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Taleplere dön' })).toHaveAttribute(
      'href',
      '/c/armadx/requests',
    );
  });

  it('starts another result with nothing chosen: the option picked for the one before is not carried over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const key = `GET /requests/${REQUEST_ID}`;
      const NEXT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const first = { ...APPROVAL_CARD, needsStepUp: false, goesExternal: false };
      const api = mockApi({
        'GET /session': sessionHandler(),
        [key]: () => json(requestDetail({ approval: first })),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
      await user.click(within(card).getByRole('radio', { name: /Seçenek B/ }));
      expect(within(card).getByRole('button', { name: 'Onayla' })).not.toHaveAttribute(
        'aria-disabled',
      );
      // Changes were asked for from another tab and the agent submitted again: the next refresh
      // brings another approval with other texts into the place of the card.
      api.handle(key, () =>
        json(
          requestDetail({
            approval: {
              ...first,
              id: NEXT_ID,
              attempt: 2,
              options: [
                { code: 'A', text: 'Yeni A metni', hashtags: [] },
                { code: 'B', text: 'Yeni B metni', hashtags: [] },
              ],
            },
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      expect(await screen.findByText('Yeni B metni')).toBeVisible();
      // Nobody chose an option of this result.
      for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
      const approve = screen.getByRole('button', { name: 'Onayla' });
      expect(approve).toHaveAttribute('aria-disabled', 'true');
      await user.click(approve);
      expect(api.callsTo(`POST /approvals/${NEXT_ID}/decision`)).toHaveLength(0);
      expect(api.unexpected).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an open reason dialog and its text when the approval stops waiting meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const key = `GET /requests/${REQUEST_ID}`;
      const refusal =
        'Bu onay kapanmış: karar verilmiş ya da dayandığı talep değişmiş. Sayfayı yenileyin.';
      const api = mockApi({
        'GET /session': sessionHandler(),
        [key]: () => json(requestDetail()),
        [`POST /approvals/${APPROVAL_ID}/decision`]: () =>
          apiError(409, 'approval_closed', refusal),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
      await user.click(within(card).getByRole('button', { name: 'Düzeltme iste' }));
      const dialog = await screen.findByRole('dialog', { name: 'Düzeltme iste' });
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Neden' }), 'Eksik');
      const note = within(dialog).getByRole('textbox', { name: /^Açıklama/ });
      await user.type(note, 'Açılış tarihi eksik.');
      // The requester cancels meanwhile: the approval no longer waits.
      api.handle(key, () =>
        json(
          requestDetail({
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'cancelled_by_requester',
            turn: { kind: 'none' },
            waitingForMe: false,
            approval: null,
            closure: { by: EMPLOYEE, reason: null, note: null },
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
      );
      const before = api.callsTo(key).length;
      // Neither the timer nor coming back to the tab reads the request under the open dialog.
      await vi.advanceTimersByTimeAsync(31_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(api.callsTo(key)).toHaveLength(before);
      expect(screen.getByRole('dialog', { name: 'Düzeltme iste' })).toBeVisible();
      expect(note).toHaveValue('Açılış tarihi eksik.');
      // The person sends and reads the API's own answer in the dialog, with the text still there.
      await user.click(within(dialog).getByRole('button', { name: 'Düzeltme iste' }));
      expect(await within(dialog).findByText(refusal)).toBeVisible();
      expect(note).toHaveValue('Açılış tarihi eksik.');
      // Closing the dialog reads the page again: it now says what happened.
      await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      expect(await screen.findByText('Ayşe Yılmaz talebi iptal etti.')).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        screen.queryByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' }),
      ).toBeNull();
      expect(api.callsTo(key)).toHaveLength(before + 1);
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('keeps the requester’s open "İstediğim bu değil" dialog and its text when the result stops waiting meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const key = `GET /requests/${REQUEST_ID}`;
      const api = mockApi({
        'GET /session': sessionHandler(EMPLOYEE_SESSION),
        [key]: () =>
          json(
            requestDetail({
              stage: 'requester_approval',
              turn: { kind: 'person', ...EMPLOYEE },
              waitingForMe: true,
              approval: null,
              result: RESULT,
              acceptance: { round: 1, returnsToAgent: true },
              actions: { cancel: true, stop: false, reroute: false },
            }),
          ),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
      await user.click(within(card).getByRole('button', { name: 'İstediğim bu değil' }));
      const dialog = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
      // The one dialog whose text is always required: losing it loses the requester's own words.
      const note = within(dialog).getByRole('textbox', { name: 'Açıklama' });
      await user.type(note, 'Çok uzun olmuş');
      // The founder routes the request again meanwhile: the result no longer waits for an answer.
      api.handle(key, () =>
        json(
          requestDetail({
            status: 'in_progress',
            stage: 'working',
            turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
            waitingForMe: false,
            approval: null,
            result: null,
            acceptance: null,
            actions: { cancel: true, stop: false, reroute: false },
          }),
        ),
      );
      const before = api.callsTo(key).length;
      // Neither the timer nor coming back to the tab reads the request under the open dialog.
      await vi.advanceTimersByTimeAsync(31_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(api.callsTo(key)).toHaveLength(before);
      expect(screen.getByRole('dialog', { name: 'İstediğim bu değil' })).toBeVisible();
      expect(note).toHaveValue('Çok uzun olmuş');
      // Closing the dialog reads the page again: the card is gone and the page says where the
      // request is now.
      await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Sonuç hazır' })).toBeNull();
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(stageLine()).toContain('Aşama: Ajan çalışıyor Sıra: SOS-2');
      expect(api.callsTo(key)).toHaveLength(before + 1);
      expect(api.unexpected).toEqual([]);
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('starts another round of the acceptance clean: what the card of the round before showed is not carried over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const key = `GET /requests/${REQUEST_ID}`;
      const refusal = 'Çok fazla istek gönderildi. Biraz sonra yeniden deneyin.';
      const round = (number: number) =>
        requestDetail({
          stage: 'requester_approval',
          turn: { kind: 'person', ...EMPLOYEE },
          waitingForMe: true,
          approval: null,
          result: RESULT,
          acceptance: { round: number, returnsToAgent: true },
          actions: { cancel: true, stop: false, reroute: false },
        });
      const api = mockApi({
        'GET /session': sessionHandler(EMPLOYEE_SESSION),
        [key]: () => json(round(1)),
        [`POST /requests/${REQUEST_ID}/acceptance`]: () => apiError(429, 'rate_limited', refusal),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      const card = await screen.findByRole('region', { name: 'Sonuç hazır' });
      await user.click(within(card).getByRole('button', { name: 'Sonucu onayla' }));
      expect(await within(card).findByRole('alert')).toHaveTextContent(refusal);
      // The founder routed the request again and a new result was approved: the next refresh
      // brings the acceptance of another round into the place of the card.
      api.handle(key, () => json(round(2)));
      const before = api.callsTo(key).length;
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(api.callsTo(key).length).toBeGreaterThan(before);
      });
      // The refusal was the answer to the round before; the new card does not show it.
      await waitFor(() => {
        expect(
          within(screen.getByRole('region', { name: 'Sonuç hazır' })).queryByRole('alert'),
        ).toBeNull();
      });
      expect(api.unexpected).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('links back to the list from the top bar', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
    });
    renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    // The top bar is the header that holds the page's h1 (the page and its cards have headers too),
    // and the h1 names the request, not the list.
    const title = screen.getByRole('heading', { level: 1, name: 'LinkedIn için gönderi yaz' });
    const bar = title.closest('header');
    if (!bar) throw new Error('No top bar');
    expect(within(bar).getByRole('link', { name: 'Talepler' })).toHaveAttribute(
      'href',
      '/c/armadx/requests',
    );
  });

  it('opens the list of the other company when the company is changed: its request is not there', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      [`GET /requests/${REQUEST_ID}`]: () => json(requestDetail()),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'PUT /session/company': () => noContent(),
    });
    const { router } = renderApp(`/c/armadx/requests/${REQUEST_ID}`);
    await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' });
    await userEvent.click(screen.getByRole('button', { name: /Şirket: Arma DX/ }));
    await userEvent.click(
      within(await screen.findByRole('menu')).getByRole('menuitemradio', { name: 'Pillika' }),
    );
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe('/c/pillika/requests');
    });
    expect(await screen.findByRole('heading', { name: 'Henüz talep yok' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Talep bulunamadı' })).toBeNull();
    // Pillika is asked for its list and never for the request of Arma DX.
    expect(api.callsTo('GET /requests').map((call) => call.headers.get(COMPANY_HEADER))).toEqual([
      PILLIKA.companyId,
    ]);
    expect(
      api.callsTo(`GET /requests/${REQUEST_ID}`).map((call) => call.headers.get(COMPANY_HEADER)),
    ).toEqual([ARMADX.companyId]);
    expect(api.unexpected).toEqual([]);
  });

  it('refreshes in the background, faster while a machine has the turn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const working = requestDetail({
        status: 'in_progress',
        stage: 'working',
        turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
        waitingForMe: false,
        approval: null,
      });
      const api = mockApi({
        'GET /session': sessionHandler(),
        [`GET /requests/${REQUEST_ID}`]: () => json(working),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      await screen.findByText('Ajan çalışıyor');
      const key = `GET /requests/${REQUEST_ID}`;
      expect(api.callsTo(key)).toHaveLength(1);
      api.handle(key, () => json(requestDetail()));
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => {
        expect(api.callsTo(key)).toHaveLength(2);
      });
      // The refresh is a background request: it does not extend the idle time (rule 3).
      expect(api.callsTo(key)[1]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      expect(api.callsTo(key)[0]?.headers.get(BACKGROUND_HEADER)).toBeNull();
      expect(
        await screen.findByRole('region', { name: 'Yeni ofis için LinkedIn gönderisi' }),
      ).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
  // Comments (8 October decision 13): the requester, the approver of the request and the founder
  // write, everybody who reads the request reads, no agent does. A comment changes nothing of the
  // request. What is being typed is the person's: no refresh and no other page takes it.
  describe('Yorumlar', () => {
    const GET = `GET /requests/${REQUEST_ID}`;
    const POST = `POST /requests/${REQUEST_ID}/comments`;
    const SENTENCE =
      'Yorumları yalnızca insanlar okur: talebi görebilen herkes. Ajanlar yorumları görmez; yorum talebi ve işin gidişini değiştirmez.';
    const WHO_MAY_WRITE =
      'Bu talebe yalnızca talep sahibi, birimin onaylayıcısı ve kurucu yorum yazabilir.';
    const RIGHT_GONE =
      'Bu talebe artık yorum yazamazsınız. Yazdığınız metin aşağıda duruyor; gerekiyorsa kopyalayın.';
    const QUESTION = comment();
    const ANSWER = comment({
      id: '77777777-7777-4777-8777-777777777772',
      author: FOUNDER,
      body: 'B daha kısa.\nA’yı sonra kullanırız.',
      createdAt: '2026-10-07T10:30:00.000Z',
    });
    const draftOf = (requestId: string, userId: string = USER_ID) =>
      draftKey(userId, ARMADX.companyId, `comment.${requestId}`);

    function region(): HTMLElement {
      return screen.getByRole('region', { name: /^Yorumlar/ });
    }

    function box(): HTMLTextAreaElement {
      return within(region()).getByRole('textbox', { name: 'Yorum yaz' });
    }

    function listed(): string[] {
      return within(region())
        .queryAllByRole('listitem')
        .map((item) => item.textContent);
    }

    /** Opens the page of the default request with these comments; the reader is the founder. */
    async function openPage(
      comments: ReturnType<typeof withComments>,
      overrides: Parameters<typeof requestDetail>[0] = {},
    ) {
      const api = mockApi({
        'GET /session': sessionHandler(),
        [GET]: () => json(requestDetail({ comments, ...overrides })),
      });
      const app = renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      await screen.findByRole('region', { name: /^Yorumlar/ });
      return { api, ...app };
    }

    it('lists the comments under the journey, oldest first, with who and when', async () => {
      const former = comment({
        id: '77777777-7777-4777-8777-777777777773',
        author: { userId: '33333333-3333-4333-8333-333333333334', name: null },
        body: 'Ben de B derim.',
        createdAt: '2026-10-07T11:00:00.000Z',
      });
      await openPage(withComments([QUESTION, ANSWER, former], false));
      // Under the journey, as a section of its own: not rows of the journey.
      const journey = screen.getByRole('region', { name: 'Yolculuk' });
      expect(
        journey.compareDocumentPosition(region()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(journey).not.toHaveTextContent('Neden B seçildi?');
      expect(within(region()).getByRole('heading', { name: 'Yorumlar 3' })).toBeVisible();

      const items = within(region()).getAllByRole('listitem');
      expect(items).toHaveLength(3);
      const [first, second, third] = items;
      if (!first || !second || !third) throw new Error('Three comments expected');
      expect(first).toHaveTextContent('Ayşe Yılmaz');
      expect(within(first).getByText('Neden B seçildi?')).toBeVisible();
      expect(first.querySelector('time')).toHaveAttribute('datetime', QUESTION.createdAt);
      expect(second).toHaveTextContent('Ömer Kadıoğlu');
      expect(second.querySelector('time')).toHaveAttribute('datetime', ANSWER.createdAt);
      // The text as it was written, with its line break.
      const body = second.querySelector('p[dir="auto"]');
      expect(body?.textContent).toBe('B daha kısa.\nA’yı sonra kullanırız.');
      expect(body).toHaveClass('whitespace-pre-wrap');
      // Somebody who is no longer a member of the company.
      expect(third).toHaveTextContent('Eski üye');
      expect(third).toHaveTextContent('Ben de B derim.');

      cleanup();
      await openPage(withComments([], false));
      expect(within(region()).getByText('Henüz yorum yok.')).toBeVisible();
      expect(within(region()).queryByRole('list')).toBeNull();
      expect(within(region()).getByRole('heading', { name: 'Yorumlar' })).toBeVisible();

      cleanup();
      await openPage(withComments([QUESTION, ANSWER], false, true));
      expect(
        within(region()).getByText(
          'En yeni 200 yorum gösteriliyor; daha eski yorumlar bu sayfada görünmez.',
        ),
      ).toBeVisible();
      // No count that would be a wrong one.
      expect(within(region()).getByRole('heading', { name: 'Yorumlar' })).toBeVisible();
    });

    it('a comment’s text is plain text', async () => {
      const written = '<b>kalın</b> https://example.com <img src=x onerror=alert(1)> [bağlantı](x)';
      await openPage(withComments([comment({ body: written })], false));
      expect(within(region()).getByText(written)).toBeVisible();
      expect(region().querySelector('b, img, a')).toBeNull();
      expect(within(region()).queryByRole('link')).toBeNull();
    });

    it('tells a reader who may not write who can, and offers no box', async () => {
      await openPage(withComments([QUESTION], false));
      expect(within(region()).getByText(WHO_MAY_WRITE)).toBeVisible();
      expect(within(region()).queryByRole('textbox')).toBeNull();
      expect(within(region()).queryByRole('button')).toBeNull();
      // The comments are read all the same.
      expect(listed()).toHaveLength(1);
    });

    it('says next to the box that only people read comments', async () => {
      await openPage(withComments([]));
      expect(box()).toHaveAccessibleDescription(`${SENTENCE} Ctrl+Enter ile de gönderilir.`);
      expect(within(region()).getByText(SENTENCE)).toBeVisible();
      // Nothing suggests that an agent reads a comment, answers it or is told of it.
      expect(region()).not.toHaveTextContent(
        /ajan\S* (\S+ )?(okur|görür|yanıtlar|dikkate alır)|ajan\S* (iletilir|bildirilir|gider|ulaşır)/i,
      );
      expect(within(region()).queryByText(WHO_MAY_WRITE)).toBeNull();
    });

    it('sends a comment with an id, shows it only when the API has stored it, and empties the box', async () => {
      const { api } = await openPage(withComments([QUESTION]));
      let answer: (response: Response) => void = () => undefined;
      api.handle(
        POST,
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      await userEvent.type(box(), 'B daha kısa.');
      await userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      // Not stored yet: nothing is shown as sent, and the text is still the person's.
      await waitFor(() => {
        expect(api.callsTo(POST)).toHaveLength(1);
      });
      expect(listed()).toHaveLength(1);
      expect(box()).toHaveValue('B daha kısa.');
      expect(box()).toHaveAttribute('readonly');
      expect(box()).not.toBeDisabled();
      const sending = within(region()).getByRole('button', { name: 'Gönderiliyor' });
      expect(sending).toHaveAttribute('aria-disabled', 'true');
      expect(sending).not.toBeDisabled();
      // A second press while it is being sent sends nothing.
      await userEvent.click(sending);
      expect(api.callsTo(POST)).toHaveLength(1);

      const [call] = api.callsTo(POST);
      expect(call?.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        body: 'B daha kısa.',
      });
      expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
      // A person's act: it counts as activity (rule 3).
      expect(call?.headers.get(BACKGROUND_HEADER)).toBeNull();
      const sent = comment({
        id: (call?.body as { id: string }).id,
        author: FOUNDER,
        body: 'B daha kısa.',
        createdAt: '2026-10-07T10:30:00.000Z',
      });
      const before = api.calls.length;
      answer(json(requestDetail({ comments: withComments([QUESTION, sent]) }), 201));
      await waitFor(() => {
        expect(listed()).toHaveLength(2);
      });
      expect(listed()[1]).toContain('B daha kısa.');
      expect(box()).toHaveValue('');
      expect(box()).not.toHaveAttribute('readonly');
      expect(within(region()).getByRole('status')).toHaveTextContent('Yorumunuz eklendi.');
      expect(within(region()).getByRole('heading', { name: 'Yorumlar 2' })).toBeVisible();
      expect(within(region()).queryByRole('alert')).toBeNull();
      // A comment settles nothing but the page: no list, no desk and no count is read again.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(api.calls.slice(before)).toEqual([]);
      expect(api.unexpected).toEqual([]);
    });

    it('Ctrl+Enter sends and Enter alone writes a new line', async () => {
      const { api } = await openPage(withComments([]));
      api.handle(POST, () => json(requestDetail({ comments: withComments([ANSWER]) }), 201));
      // Nothing written: said at the box, nothing sent.
      await userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      expect(within(region()).getByRole('alert')).toHaveTextContent('Yorum yazın.');
      expect(box()).toHaveAttribute('aria-invalid', 'true');
      expect(box()).toHaveAccessibleDescription(expect.stringContaining('Yorum yazın.') as string);
      await userEvent.type(box(), '   ');
      await userEvent.keyboard('{Control>}{Enter}{/Control}');
      expect(within(region()).getByRole('alert')).toHaveTextContent('Yorum yazın.');
      // Too long: the limit is said, nothing is sent; exactly the limit has no problem.
      fireEvent.change(box(), { target: { value: 'a'.repeat(10_001) } });
      expect(within(region()).getByRole('alert')).toHaveTextContent(
        'Yorum en çok 10.000 karakter olabilir.',
      );
      await userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      fireEvent.change(box(), { target: { value: 'a'.repeat(10_000) } });
      expect(within(region()).queryByRole('alert')).toBeNull();
      expect(api.callsTo(POST)).toHaveLength(0);

      await userEvent.clear(box());
      await userEvent.type(box(), 'Birinci satır{Enter}İkinci satır');
      expect(box()).toHaveValue('Birinci satır\nİkinci satır');
      expect(api.callsTo(POST)).toHaveLength(0);
      await userEvent.keyboard('{Control>}{Enter}{/Control}');
      await waitFor(() => {
        expect(listed()).toHaveLength(1);
      });
      expect(api.callsTo(POST).map((call) => (call.body as { body: string }).body)).toEqual([
        'Birinci satır\nİkinci satır',
      ]);
      // Sent from the box: the focus is still in it.
      expect(box()).toHaveFocus();
    });

    it('keeps the text and says why when the send fails; the next try carries the same id, a changed text a new one', async () => {
      const { api } = await openPage(withComments([]));
      const refusal = 'Beklenmeyen bir hata oluştu. Biraz sonra yeniden deneyin.';
      api.handle(POST, () => apiError(500, 'internal_error', refusal));
      await userEvent.type(box(), 'İlk deneme');
      const send = () =>
        userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      await send();
      expect(await within(region()).findByRole('alert')).toHaveTextContent(
        `Yorum gönderilemedi. ${refusal}`,
      );
      expect(box()).toHaveValue('İlk deneme');
      expect(box()).not.toHaveAttribute('readonly');
      expect(listed()).toEqual([]);

      // The answer of the first try may have been lost on the way: the same text goes with the
      // same id, so the API stores it once.
      await send();
      await waitFor(() => {
        expect(api.callsTo(POST)).toHaveLength(2);
      });
      const ids = () => api.callsTo(POST).map((call) => (call.body as { id: string }).id);
      expect(ids()[1]).toBe(ids()[0]);

      // A changed text is another comment; and the old reason is not said about it.
      await userEvent.type(box(), ', düzeltildi');
      expect(within(region()).queryByRole('alert')).toBeNull();
      await send();
      await waitFor(() => {
        expect(api.callsTo(POST)).toHaveLength(3);
      });
      expect(ids()[2]).not.toBe(ids()[0]);
      expect(api.callsTo(POST)[2]?.body).toMatchObject({ body: 'İlk deneme, düzeltildi' });
      expect(await within(region()).findByRole('alert')).toHaveTextContent('Yorum gönderilemedi.');
      expect(box()).toHaveValue('İlk deneme, düzeltildi');
    });

    it('keeps an unfinished comment in the tab, per request, until it is sent', async () => {
      const OTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const mine = requestDetail({ comments: withComments([]) });
      const other = requestDetail({
        id: OTHER_ID,
        title: 'Kasım bülteni',
        approval: null,
        comments: withComments([]),
      });
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /requests': () => json({ requests: [mine, other].map(summaryOf), truncated: false }),
        [GET]: () => json(mine),
        [`GET /requests/${OTHER_ID}`]: () => json(other),
        [POST]: () => json(requestDetail({ comments: withComments([ANSWER]) }), 201),
      });
      renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      await screen.findByRole('region', { name: /^Yorumlar/ });
      await userEvent.type(box(), 'Yarım kalan yorum');

      const toList = async () => {
        await userEvent.click(
          within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', {
            name: 'Talepler',
          }),
        );
        await screen.findByRole('region', { name: /Sizden beklenenler/ });
      };
      const toRequest = async (title: string) => {
        await userEvent.click(await screen.findByRole('link', { name: new RegExp(`^${title}`) }));
        await screen.findByRole('region', { name: /^Yorumlar/ });
      };
      // Left for the list and opened again: the text is back.
      await toList();
      await toRequest('LinkedIn için gönderi yaz');
      expect(box()).toHaveValue('Yarım kalan yorum');
      // It is a draft of this person, this company and this request, in the tab's storage only.
      await waitFor(
        () => {
          expect(sessionStorage.getItem(draftOf(REQUEST_ID))).toBe(
            JSON.stringify('Yarım kalan yorum'),
          );
        },
        { timeout: 2000 },
      );
      expect(draftOf(REQUEST_ID)).toBe(
        `agent-office.draft.${USER_ID}.${ARMADX.companyId}.comment.${REQUEST_ID}`,
      );
      const kept = Array.from({ length: localStorage.length }, (_, index) => {
        const name = localStorage.key(index) ?? '';
        return `${name}=${localStorage.getItem(name) ?? ''}`;
      });
      expect(kept.filter((entry) => /draft|Yarım kalan yorum/.test(entry))).toEqual([]);

      // Another request has its own box.
      await toList();
      await toRequest('Kasım bülteni');
      expect(box()).toHaveValue('');
      expect(sessionStorage.getItem(draftOf(OTHER_ID))).toBeNull();

      // Stored: the draft is gone with the text.
      await toList();
      await toRequest('LinkedIn için gönderi yaz');
      expect(box()).toHaveValue('Yarım kalan yorum');
      await userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      await waitFor(() => {
        expect(listed()).toHaveLength(1);
      });
      expect(box()).toHaveValue('');
      expect(sessionStorage.getItem(draftOf(REQUEST_ID))).toBeNull();
      expect(api.callsTo(POST)).toHaveLength(1);
      // An emptied box leaves no draft behind either.
      await userEvent.type(box(), 'x{Backspace}');
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(sessionStorage.getItem(draftOf(REQUEST_ID))).toBeNull();
    });

    it('a comment being typed does not follow the person to another request', async () => {
      const NEW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const created = requestDetail({
        id: NEW_ID,
        title: 'Kasım bülteni',
        status: 'open',
        stage: 'routing',
        turn: { kind: 'agent', code: 'KOR-1', name: 'Ofis Koordinatörü' },
        waitingForMe: false,
        unit: null,
        agent: null,
        journey: [],
        approval: null,
        requester: FOUNDER,
        actions: { cancel: true, stop: false, reroute: false },
        text: 'Kasım bülteni',
        comments: withComments([]),
      });
      const api = mockApi({
        'GET /session': sessionHandler(),
        [GET]: () => json(requestDetail({ comments: withComments([]) })),
        'POST /requests': () => json(created, 201),
        [`GET /requests/${NEW_ID}`]: () => json(created),
      });
      const { router } = renderApp(`/c/armadx/requests/${REQUEST_ID}`);
      await screen.findByRole('region', { name: /^Yorumlar/ });
      await userEvent.type(box(), 'A talebi için yarım yorum');

      // "Yeni talep" is opened on the page of request A and leads straight to the new request:
      // the router keeps the screen mounted, only the id in the address changes.
      await userEvent.click(sidebarButton());
      const dialog = await screen.findByRole('dialog', { name: 'Yeni talep' });
      await userEvent.type(within(dialog).getByRole('textbox'), 'Kasım bülteni');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Talebi gönder' }));
      await waitFor(() => {
        expect(currentLocation(router).pathname).toBe(`/c/armadx/requests/${NEW_ID}`);
      });
      expect(await screen.findByText('Yönlendiriliyor')).toBeVisible();
      // The box of the new request is its own: nothing typed for A can be sent here.
      expect(box()).toHaveValue('');
      await userEvent.type(box(), 'Yeni talebin yorumu');
      await waitFor(
        () => {
          expect(sessionStorage.getItem(draftOf(NEW_ID))).toBe(
            JSON.stringify('Yeni talebin yorumu'),
          );
        },
        { timeout: 2000 },
      );
      // Each draft under its own request; A's is still A's.
      expect(sessionStorage.getItem(draftOf(REQUEST_ID))).toBe(
        JSON.stringify('A talebi için yarım yorum'),
      );
      expect(api.callsTo(`POST /requests/${NEW_ID}/comments`)).toEqual([]);
      expect(api.callsTo(POST)).toEqual([]);
    });

    it('a background refresh adds other people’s comments and never touches what is being typed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        // The requester reads; an agent works, so the page asks every five seconds.
        const working = {
          status: 'in_progress' as const,
          stage: 'working' as const,
          turn: { kind: 'agent' as const, code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
          waitingForMe: false,
          approval: null,
          actions: { cancel: true, stop: false, reroute: false },
        };
        const api = mockApi({
          'GET /session': sessionHandler(EMPLOYEE_SESSION),
          [GET]: () => json(requestDetail({ ...working, comments: withComments([QUESTION]) })),
        });
        renderApp(`/c/armadx/requests/${REQUEST_ID}`);
        await screen.findByRole('region', { name: /^Yorumlar/ });
        await user.type(box(), 'Yarım bir cümle');
        // The caret is inside the text, with a selection.
        box().setSelectionRange(3, 8);
        const typed = box();

        // The founder answers meanwhile and the agent submits: the next refresh brings both.
        api.handle(GET, () =>
          json(
            requestDetail({
              stage: 'unit_approval',
              turn: { kind: 'founder' },
              waitingForMe: false,
              approval: null,
              actions: { cancel: true, stop: false, reroute: false },
              comments: withComments([QUESTION, ANSWER]),
            }),
          ),
        );
        await vi.advanceTimersByTimeAsync(5_100);
        await waitFor(() => {
          expect(listed()).toHaveLength(2);
        });
        const intact = () => {
          // The same box (never mounted anew), its text, its selection and the focus.
          expect(box()).toBe(typed);
          expect(typed).toHaveValue('Yarım bir cümle');
          expect(typed).toHaveFocus();
          expect([typed.selectionStart, typed.selectionEnd]).toEqual([3, 8]);
        };
        intact();
        expect(stageLine()).toContain('Aşama: Birim onayında');
        expect(within(region()).getByRole('status')).toHaveTextContent(
          'Ömer Kadıoğlu yeni bir yorum yazdı.',
        );
        expect(within(region()).getByRole('heading', { name: 'Yorumlar 2' })).toBeVisible();

        // The slower refresh of a request that waits for a person, and coming back to the tab.
        const before = api.callsTo(GET).length;
        await vi.advanceTimersByTimeAsync(31_000);
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        await vi.advanceTimersByTimeAsync(100);
        await waitFor(() => {
          expect(api.callsTo(GET).length).toBeGreaterThanOrEqual(before + 2);
        });
        intact();
        expect(listed()).toHaveLength(2);
        // The timer's requests are background requests: they do not extend the idle time.
        expect(api.callsTo(GET)[1]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
        expect(api.callsTo(GET)[before]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
        expect(api.unexpected).toEqual([]);
      } finally {
        focusManager.setFocused(undefined);
        vi.useRealTimers();
      }
    });

    it('does not take the text from a person who loses the right to comment meanwhile', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const { api } = await openPage(withComments([QUESTION]));
        await user.type(box(), 'Yarım kalan yorum');
        const typed = box();
        typed.setSelectionRange(3, 8);
        // The routing is corrected to another unit meanwhile: this approver may not write any more.
        api.handle(GET, () => json(requestDetail({ comments: withComments([QUESTION], false) })));
        await vi.advanceTimersByTimeAsync(30_100);
        expect(await within(region()).findByText(RIGHT_GONE)).toBeVisible();
        // The refresh took nothing from the person who was typing: the same box (never mounted
        // anew), the focus in it and the caret where it was. A keyboard or screen reader user
        // is not thrown to the top of the page.
        expect(box()).toBe(typed);
        expect(typed).toHaveFocus();
        expect([typed.selectionStart, typed.selectionEnd]).toEqual([3, 8]);
        // The text is still there to be copied, and cannot be sent or changed.
        expect(box()).toHaveValue('Yarım kalan yorum');
        expect(box()).toHaveAttribute('readonly');
        expect(box()).toHaveAttribute('aria-invalid', 'false');
        expect(box()).toHaveAccessibleDescription(RIGHT_GONE);
        expect(within(region()).queryByRole('button', { name: 'Yorumu gönder' })).toBeNull();
        expect(within(region()).queryByText(WHO_MAY_WRITE)).toBeNull();
        await user.type(box(), ' daha');
        await user.keyboard('{Control>}{Enter}{/Control}');
        expect(box()).toHaveValue('Yarım kalan yorum');
        expect(within(region()).queryByRole('alert')).toBeNull();
        expect(api.callsTo(POST)).toEqual([]);

        // With the keyboard: the next stop after the box is "Taslağı at". It removes the box and
        // itself; the focus goes to the sentence that takes their place.
        await user.tab();
        expect(within(region()).getByRole('button', { name: 'Taslağı at' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(within(region()).getByText(WHO_MAY_WRITE)).toBeVisible();
        expect(within(region()).getByText(WHO_MAY_WRITE)).toHaveFocus();
        expect(within(region()).queryByRole('textbox')).toBeNull();
        expect(within(region()).queryByRole('button')).toBeNull();
        expect(sessionStorage.getItem(draftOf(REQUEST_ID))).toBeNull();
        // The sentence does not take the focus again on a later refresh.
        const elsewhere = within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole(
          'link',
          { name: 'Talepler' },
        );
        elsewhere.focus();
        await vi.advanceTimersByTimeAsync(30_100);
        expect(elsewhere).toHaveFocus();
        // The right comes back: an empty box, and the Ctrl+Enter pressed while it could not be
        // sent is not held against it.
        api.handle(GET, () => json(requestDetail({ comments: withComments([QUESTION]) })));
        await vi.advanceTimersByTimeAsync(30_100);
        await waitFor(() => {
          expect(box()).toHaveValue('');
        });
        expect(box()).not.toHaveAttribute('readonly');
        expect(within(region()).queryByRole('alert')).toBeNull();
        expect(elsewhere).toHaveFocus();
      } finally {
        vi.useRealTimers();
      }
    });

    it('reads the page again when the API refuses the comment, and keeps the text', async () => {
      const { api } = await openPage(withComments([QUESTION]));
      await userEvent.type(box(), 'Yarım kalan yorum');
      // The page on screen is older than the API's: the right went away meanwhile.
      api.handle(GET, () => json(requestDetail({ comments: withComments([QUESTION], false) })));
      api.handle(POST, () => apiError(403, 'comment_not_allowed', WHO_MAY_WRITE));
      const before = api.callsTo(GET).length;
      const typed = box();
      await userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      expect(await within(region()).findByText(RIGHT_GONE)).toBeVisible();
      expect(api.callsTo(GET)).toHaveLength(before + 1);
      expect(box()).toHaveValue('Yarım kalan yorum');
      expect(box()).toHaveAttribute('readonly');
      // The button that was pressed is gone with the right: the focus is in the box, which holds
      // the text and is described by the sentence, not at the top of the page.
      expect(box()).toBe(typed);
      expect(typed).toHaveFocus();
      expect(within(region()).queryByRole('button', { name: 'Yorumu gönder' })).toBeNull();
      expect(listed()).toHaveLength(1);
    });

    it('a closed request takes comments like an open one', async () => {
      const closed = {
        status: 'cancelled' as const,
        stage: 'cancelled' as const,
        cause: 'rejected' as const,
        turn: { kind: 'none' as const },
        waitingForMe: false,
        approval: null,
        closure: { by: FOUNDER, reason: 'incomplete' as const, note: 'Açılış tarihi eksik.' },
        actions: { cancel: false, stop: false, reroute: false },
      };
      const { api } = await openPage(withComments([QUESTION]), closed);
      const why = comment({
        id: '77777777-7777-4777-8777-777777777774',
        author: FOUNDER,
        body: 'Tarih olmadan yayınlayamayız.',
        createdAt: '2026-10-07T12:00:00.000Z',
      });
      api.handle(POST, () =>
        json(requestDetail({ ...closed, comments: withComments([QUESTION, why]) }), 201),
      );
      await userEvent.type(box(), 'Tarih olmadan yayınlayamayız.');
      await userEvent.click(within(region()).getByRole('button', { name: 'Yorumu gönder' }));
      await waitFor(() => {
        expect(listed()).toHaveLength(2);
      });
      expect(api.callsTo(POST)).toHaveLength(1);
      // The comment reopened nothing.
      expect(stageLine()).toContain('Aşama: İptal edildi: sonuç reddedildi');
    });

    it('the comment section has no control that changes the request', async () => {
      await openPage(withComments([QUESTION, ANSWER]));
      expect(
        within(region())
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Yorumu gönder']);
      expect(within(region()).getAllByRole('textbox')).toHaveLength(1);
      for (const role of ['combobox', 'radio', 'checkbox', 'switch', 'link', 'menuitem']) {
        expect(within(region()).queryAllByRole(role)).toEqual([]);
      }
      // A comment cannot be changed or removed: no row carries a control.
      for (const item of within(region()).getAllByRole('listitem')) {
        expect(item.querySelector('button, a, input')).toBeNull();
      }
    });
  });
});

describe('Onaylar', () => {
  it('lists what waits for the person in two groups and counts them on the sidebar row', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today/counts': () => json({ today: 2, approvals: 2 }),
      'GET /approvals': () =>
        json({
          approvals: [APPROVAL_CARD],
          acceptances: [
            {
              requestId: '77777777-7777-4777-8777-777777777777',
              requestTitle: 'Kasım bülteni',
              round: 1,
              returnsToAgent: false,
              openedAt: '2026-10-07T09:00:00.000Z',
              result: RESULT,
            },
          ],
        }),
    });
    renderApp('/c/armadx/approvals');
    const approvals = await screen.findByRole('region', { name: /Birim onayları/ });
    expect(within(approvals).getByRole('link', { name: 'Talebi aç' })).toHaveAttribute(
      'href',
      `/c/armadx/requests/${REQUEST_ID}`,
    );
    expect(within(approvals).getByRole('button', { name: 'Onayla' })).toBeVisible();
    const results = screen.getByRole('region', { name: /Taleplerinizin sonuçları/ });
    expect(within(results).getByRole('button', { name: 'Sonucu onayla' })).toBeVisible();
    expect(within(results).getByRole('link', { name: 'Kasım bülteni' })).toBeVisible();
    // The card says here too what "not what I asked for" does this time, as the API gave it.
    await userEvent.click(within(results).getByRole('button', { name: 'İstediğim bu değil' }));
    const asking = await screen.findByRole('dialog', { name: 'İstediğim bu değil' });
    expect(asking).toHaveTextContent(
      'Daha önce düzeltme istediniz: iş ajana kendiliğinden dönmez, kurucuya düşer.',
    );
    expect(asking).not.toHaveTextContent(/ikinci/);
    await userEvent.click(within(asking).getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Nothing can be dismissed or postponed.
    expect(screen.queryByRole('button', { name: /Arşiv|Ertele|Kapat/ })).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', {
        name: 'Onaylar, 2 bekleyen',
      }),
    ).toBeVisible();
  });

  it('keeps an open reason dialog and its text when the card leaves the desk meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let waiting = true;
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /approvals': () =>
          json({ approvals: waiting ? [APPROVAL_CARD] : [], acceptances: [] }),
      });
      renderApp('/c/armadx/approvals');
      const approvals = await screen.findByRole('region', { name: /Birim onayları/ });
      await user.click(within(approvals).getByRole('button', { name: 'Düzeltme iste' }));
      const dialog = await screen.findByRole('dialog', { name: 'Düzeltme iste' });
      const note = within(dialog).getByRole('textbox', { name: /^Açıklama/ });
      await user.type(note, 'Daha sade olsun.');
      // Somebody else decided it. The desk is read by the screen alone (the sidebar counts from
      // its own light request), and the screen does not read it under the open dialog.
      waiting = false;
      const before = api.callsTo('GET /approvals').length;
      await vi.advanceTimersByTimeAsync(31_000);
      expect(api.callsTo('GET /approvals')).toHaveLength(before);
      expect(screen.getByRole('dialog', { name: 'Düzeltme iste' })).toBeVisible();
      expect(note).toHaveValue('Daha sade olsun.');
      // Closing the dialog reads the desk again.
      await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      expect(await screen.findByRole('heading', { name: 'Onay bekleyen iş yok' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what will appear here when nothing waits', async () => {
    mockApi({ 'GET /session': sessionHandler(EMPLOYEE_SESSION) });
    renderApp('/c/armadx/approvals');
    expect(
      await screen.findByRole('heading', { name: 'Onayınızı bekleyen sonuç yok' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Ana menü' })).getByRole('link', {
        name: 'Onaylar',
      }),
    ).toBeVisible();
  });
});
