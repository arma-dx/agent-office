import { BACKGROUND_HEADER, COMPANY_HEADER } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARMADX, json, mockApi, noContent, sessionHandler } from './test/mock-api.ts';
import {
  EMPLOYEE,
  FOUNDER,
  REJECTED_NOTE,
  REQUEST_ID,
  RESET_NOTE,
  RETURNED_NOTE,
  STOPPED_NOTE,
  requestDetail,
  summaryOf,
  todayBody,
} from './test/request-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The Bugün screen (8 October decisions 7 and 8) and the two counts of the sidebar. Everything on
// screen is what the API answered: the list is a list of links, a notification is a fixed sentence
// built from a template code, and nothing here decides anything.

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function menu(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Ana menü' });
}

const EMPLOYEE_SESSION = {
  user: { id: EMPLOYEE.userId, name: EMPLOYEE.name },
  memberships: [{ ...ARMADX, role: 'employee' as const, canApprove: false }],
};
const EXTERNAL_SESSION = {
  memberships: [{ ...ARMADX, role: 'external' as const, canApprove: false }],
};

const ACCEPT_ID = '77777777-7777-4777-8777-777777777777';
const FALLEN_ID = '88888888-8888-4888-8888-888888888888';

// A result the reader may decide, a result of the reader's own request to accept, and a request
// that fell to the reader: the three things the list holds in this step.
const DECIDE = summaryOf(requestDetail({ updatedAt: '2026-10-05T08:00:00.000Z' }));
const ACCEPT = summaryOf(
  requestDetail({
    id: ACCEPT_ID,
    title: 'Kasım bülteni',
    stage: 'requester_approval',
    turn: { kind: 'person', ...FOUNDER },
    requester: FOUNDER,
    updatedAt: '2026-10-06T08:00:00.000Z',
  }),
);
const FALLEN = summaryOf(
  requestDetail({
    id: FALLEN_ID,
    title: 'Kasım duyurusu',
    status: 'in_progress',
    stage: 'fell_to_person',
    cause: 'no_submission',
    updatedAt: '2026-10-07T08:00:00.000Z',
  }),
);

function expectedRegion(): HTMLElement {
  return screen.getByRole('region', { name: /^Sizden beklenenler/ });
}

function rowTexts(): string[] {
  return within(expectedRegion())
    .getAllByRole('listitem')
    .map((row) => row.textContent);
}

describe('the counts of the sidebar', () => {
  it('counts what is expected on the Bugün row and the decisions on the Onaylar row, from one light request', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'GET /today/counts': () => json({ today: 3, approvals: 2 }),
    });
    renderApp('/c/armadx/requests');
    expect(await screen.findByRole('link', { name: 'Bugün, 3 bekleyen iş' })).toBeVisible();
    expect(within(menu()).getByRole('link', { name: 'Onaylar, 2 bekleyen' })).toBeVisible();
    // One request for both numbers, for the selected company; the desk with its cards is not read.
    const counts = api.callsTo('GET /today/counts');
    expect(counts).toHaveLength(1);
    expect(counts[0]?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(api.callsTo('GET /approvals')).toEqual([]);
    expect(api.unexpected).toEqual([]);

    // Nothing waits: the rows keep their plain names.
    cleanup();
    const quiet = mockApi({
      'GET /session': sessionHandler(),
      'GET /requests': () => json({ requests: [], truncated: false }),
      'GET /today/counts': () => json({ today: 0, approvals: 0 }),
    });
    renderApp('/c/armadx/requests');
    expect(await screen.findByRole('heading', { name: 'Henüz talep yok' })).toBeVisible();
    await vi.waitFor(() => {
      expect(quiet.callsTo('GET /today/counts')).toHaveLength(1);
    });
    expect(within(menu()).getByRole('link', { name: 'Bugün' })).toBeVisible();
    expect(within(menu()).getByRole('link', { name: 'Onaylar' })).toBeVisible();
    expect(within(menu()).queryByRole('link', { name: /bekleyen/ })).toBeNull();
  });
});

describe('Bugün: Sizden beklenenler', () => {
  it("lists what is expected of the person in the API's order, each row a link to its request and nothing else", async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () => json(todayBody({ expected: [DECIDE, ACCEPT, FALLEN] })),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Sizden beklenenler 3' });
    expect(rowTexts()).toEqual([
      expect.stringContaining('Onayınız bekleniyor'),
      expect.stringContaining('Sonucu onaylamanız bekleniyor'),
      expect.stringContaining('Sizden bekleniyor: ajan sonuç sunmadı'),
    ]);
    expect(
      within(region).getByRole('link', { name: 'LinkedIn için gönderi yaz, Onayınız bekleniyor' }),
    ).toHaveAttribute('href', `/c/armadx/requests/${REQUEST_ID}`);
    expect(
      within(region).getByRole('link', {
        name: 'Kasım duyurusu, Sizden bekleniyor: ajan sonuç sunmadı',
      }),
    ).toHaveAttribute('href', `/c/armadx/requests/${FALLEN_ID}`);
    // No decision is given here and nothing is dismissed or postponed: a row is a link.
    expect(within(region).queryAllByRole('button')).toEqual([]);
    expect(within(region).queryAllByRole('combobox')).toEqual([]);
    expect(within(region).getAllByRole('link')).toHaveLength(3);
    // Since when: the request's last movement, on every row.
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('time')?.getAttribute('datetime')),
    ).toEqual([DECIDE.updatedAt, ACCEPT.updatedAt, FALLEN.updatedAt]);
    // Nothing of a row hides behind a tooltip: under the row's link only the title's own could
    // ever be shown, so the expectation and the time carry none.
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((row) => Array.from(row.querySelectorAll('[title]'), (part) => part.textContent)),
    ).toEqual([[DECIDE.title], [ACCEPT.title], [FALLEN.title]]);
    // The person opened the screen: a request of theirs, for the selected company.
    const [first] = api.callsTo('GET /today');
    expect(first?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    expect(first?.headers.get(BACKGROUND_HEADER)).toBeNull();
  });

  it("calls a result the founder may decide the founder's, also while another person is appointed", async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () =>
        json(
          todayBody({
            expected: [{ ...DECIDE, waitingForMe: false, turn: { kind: 'person', ...EMPLOYEE } }],
          }),
        ),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
    expect(within(region).getByRole('listitem')).toHaveTextContent('Onayınız bekleniyor');
    expect(within(region).getByRole('listitem')).not.toHaveTextContent('Birim onayında');
    expect(
      within(region).getByRole('link', { name: 'LinkedIn için gönderi yaz, Onayınız bekleniyor' }),
    ).toBeVisible();
  });

  it('lists a request that waits for the reader’s answer to an agent’s question, as a link to its page', async () => {
    const REPLY_ID = '99999999-9999-4999-8999-999999999991';
    // The requester's own request: an agent asked, and nothing runs until they answer.
    const reply = summaryOf(
      requestDetail({
        id: REPLY_ID,
        title: 'Ekim duyurusu',
        status: 'awaiting_reply',
        stage: 'awaiting_reply',
        turn: { kind: 'person', ...EMPLOYEE },
        waitingForMe: true,
        // The request's last movement: the moment the question was asked.
        updatedAt: '2026-10-07T09:05:00.000Z',
      }),
    );
    const api = mockApi({
      'GET /session': sessionHandler(EMPLOYEE_SESSION),
      'GET /today': () => json(todayBody({ expected: [reply] })),
      'GET /today/counts': () => json({ today: 1, approvals: 0 }),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
    const row = within(region).getByRole('listitem');
    expect(row).toHaveTextContent('Yanıtınız bekleniyor');
    expect(row).not.toHaveTextContent('Yanıt bekliyor');
    // The sign of the status, in words too; never a colour alone.
    expect(within(row).getByRole('img', { name: 'Yanıt bekliyor' })).toBeVisible();
    expect(
      within(row).getByRole('link', { name: 'Ekim duyurusu, Yanıtınız bekleniyor' }),
    ).toHaveAttribute('href', `/c/armadx/requests/${REPLY_ID}`);
    expect(row.querySelector('time')).toHaveAttribute('datetime', '2026-10-07T09:05:00.000Z');
    // The answer is given on the request's page: the row has no box and no button.
    expect(within(region).queryAllByRole('textbox')).toEqual([]);
    expect(within(region).queryAllByRole('button')).toEqual([]);
    // The number on the "Bugün" row of the sidebar counts it; the "Onaylar" row does not (a
    // question is not a decision of the desk).
    expect(await within(menu()).findByRole('link', { name: 'Bugün, 1 bekleyen iş' })).toBeVisible();
    expect(within(menu()).getByRole('link', { name: 'Onaylar' })).toBeVisible();
    cleanup();

    // The founder who answers in the place of a requester who cannot read the request reads the
    // same row and the same words; the request's page says in whose place.
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () =>
        json(
          todayBody({ expected: [{ ...reply, turn: { kind: 'founder' }, waitingForMe: true }] }),
        ),
    });
    renderApp('/c/armadx');
    const again = await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
    expect(
      within(again).getByRole('link', { name: 'Ekim duyurusu, Yanıtınız bekleniyor' }),
    ).toBeVisible();
    expect(api.unexpected).toEqual([]);
  });

  it('gives the longest reason of a fallen request a column that holds it whole', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () => json(todayBody({ expected: [{ ...FALLEN, cause: 'model_billing' }] })),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
    // jsdom lays nothing out: the width is pinned by its class, 336 px, and the texts are held
    // inside it by the width test of lib/today/labels.ts. The two change together.
    const expectation = within(region).getByText('Sizden bekleniyor: model hesabında ödeme sorunu');
    expect(expectation).toHaveClass('w-84');
    expect(expectation).not.toHaveAttribute('title');
  });

  it('refreshes every half minute in the background and keeps the rows where they are', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /today': () => json(todayBody({ expected: [DECIDE, ACCEPT] })),
      });
      renderApp('/c/armadx');
      await screen.findByRole('region', { name: 'Sizden beklenenler 2' });
      expect(rowTexts()).toEqual([
        expect.stringContaining('LinkedIn için gönderi yaz'),
        expect.stringContaining('Kasım bülteni'),
      ]);
      await waitFor(() => {
        expect(api.callsTo('GET /today/counts')).toHaveLength(1);
      });
      // The API now gives another order, a new request, and a new stage for the first row: its
      // result was approved and waits for its requester, who is the reader.
      api.handle('GET /today', () =>
        json(
          todayBody({
            expected: [FALLEN, ACCEPT, { ...DECIDE, stage: 'requester_approval' as const }],
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      await screen.findByRole('region', { name: 'Sizden beklenenler 3' });
      // What was on screen stays where it was, with its new words; what is new comes last.
      expect(rowTexts()).toEqual([
        expect.stringContaining('LinkedIn için gönderi yaz'),
        expect.stringContaining('Kasım bülteni'),
        expect.stringContaining('Kasım duyurusu'),
      ]);
      expect(rowTexts()[0]).toContain('Sonucu onaylamanız bekleniyor');
      expect(rowTexts()[0]).not.toContain('Onayınız bekleniyor');
      // Both refreshes are background requests: they do not extend the idle time (rule 3).
      for (const key of ['GET /today', 'GET /today/counts']) {
        expect(api.callsTo(key)).toHaveLength(2);
        expect(api.callsTo(key)[0]?.headers.get(BACKGROUND_HEADER)).toBeNull();
        expect(api.callsTo(key)[1]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      }
      // What is gone leaves.
      api.handle('GET /today', () => json(todayBody({ expected: [FALLEN] })));
      await vi.advanceTimersByTimeAsync(30_100);
      await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
      expect(rowTexts()).toEqual([expect.stringContaining('Kasım duyurusu')]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the first step when nothing is expected', async () => {
    for (const session of [{}, EMPLOYEE_SESSION]) {
      mockApi({ 'GET /session': sessionHandler(session) });
      renderApp('/c/armadx');
      expect(await screen.findByRole('heading', { name: 'Sizden beklenen iş yok' })).toBeVisible();
      const main = screen.getByRole('main');
      expect(
        within(main).getByText(
          'Onayınızı, yanıtınızı ya da bakmanızı bekleyen talepler burada görünür. Ajanlardan bir iş istemek için talep gönderin.',
        ),
      ).toBeVisible();
      expect(within(main).queryByRole('region', { name: /^Sizden beklenenler/ })).toBeNull();
      await userEvent.click(within(main).getByRole('button', { name: 'Yeni talep' }));
      expect(await screen.findByRole('dialog', { name: 'Yeni talep' })).toBeVisible();
      cleanup();
    }
  });

  it('tells an external person that requests are not theirs, offers no request and asks for no count', async () => {
    const api = mockApi({ 'GET /session': sessionHandler(EXTERNAL_SESSION) });
    renderApp('/c/armadx');
    expect(await screen.findByRole('heading', { name: 'Sizden beklenen iş yok' })).toBeVisible();
    const main = screen.getByRole('main');
    expect(
      within(main).getByText(
        'Ajanların yürüttüğü talepler şirketin kurucusuna ve çalışanlarına açıktır.',
      ),
    ).toBeVisible();
    expect(within(main).queryByRole('button', { name: 'Yeni talep' })).toBeNull();
    expect(main).not.toHaveTextContent('talep gönderin');
    // Their own notifications are read with the list; the counts are not theirs to ask for.
    expect(api.callsTo('GET /today')).toHaveLength(1);
    expect(api.callsTo('GET /today/counts')).toEqual([]);
    expect(within(menu()).getByRole('link', { name: 'Bugün' })).toBeVisible();
  });

  it('in Kurucu alanı says where requests live and asks the API for nothing', async () => {
    const api = mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/founder_space');
    expect(await screen.findByRole('heading', { name: 'Kurucu alanında talep yok' })).toBeVisible();
    const main = screen.getByRole('main');
    expect(
      within(main).getByText(
        'Talepler şirketlerde açılır. Sizden beklenenleri görmek için şirket menüsünden bir şirket seçin.',
      ),
    ).toBeVisible();
    expect(within(main).queryByRole('button', { name: 'Yeni talep' })).toBeNull();
    expect(within(main).queryByRole('heading', { name: 'Bildirimler' })).toBeNull();
    expect(api.callsTo('GET /today')).toEqual([]);
    expect(api.callsTo('GET /today/counts')).toEqual([]);
  });

  it('a refresh that takes the focused row away moves the focus to the heading of its list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /today': () => json(todayBody({ expected: [DECIDE, ACCEPT] })),
      });
      renderApp('/c/armadx');
      const region = await screen.findByRole('region', { name: 'Sizden beklenenler 2' });
      // The focus is on a row that stays: a refresh leaves it there.
      const staying = within(region).getByRole('link', { name: /^Kasım bülteni/ });
      staying.focus();
      api.handle('GET /today', () => json(todayBody({ expected: [DECIDE, ACCEPT, FALLEN] })));
      await vi.advanceTimersByTimeAsync(30_100);
      await screen.findByRole('region', { name: 'Sizden beklenenler 3' });
      expect(staying).toHaveFocus();
      // The focus is on a row that leaves: it goes to the heading of the list, not to the page.
      api.handle('GET /today', () => json(todayBody({ expected: [DECIDE, FALLEN] })));
      await vi.advanceTimersByTimeAsync(30_100);
      await screen.findByRole('region', { name: 'Sizden beklenenler 2' });
      expect(screen.getByRole('heading', { name: /^Sizden beklenenler/ })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refresh that takes the last row away moves the focus to the heading of the empty list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /today': () => json(todayBody({ expected: [DECIDE], notifications: [RETURNED_NOTE] })),
      });
      renderApp('/c/armadx');
      const region = await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
      // The focus is on the only row and the row leaves: the list and its heading go with it, so
      // the focus goes to the heading that says nothing is expected, not to the page.
      within(region).getByRole('link').focus();
      api.handle('GET /today', () => json(todayBody({ notifications: [RETURNED_NOTE] })));
      await vi.advanceTimersByTimeAsync(30_100);
      expect(await screen.findByRole('heading', { name: 'Sizden beklenen iş yok' })).toHaveFocus();

      // The focus is somewhere else when the list empties: it stays where the person put it.
      api.handle('GET /today', () =>
        json(todayBody({ expected: [DECIDE], notifications: [RETURNED_NOTE] })),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      const again = await screen.findByRole('region', { name: 'Sizden beklenenler 1' });
      within(again).getByRole('link').focus();
      const elsewhere = within(screen.getByRole('region', { name: 'Bildirimler' })).getByRole(
        'link',
      );
      elsewhere.focus();
      api.handle('GET /today', () => json(todayBody({ notifications: [RETURNED_NOTE] })));
      await vi.advanceTimersByTimeAsync(30_100);
      await screen.findByRole('heading', { name: 'Sizden beklenen iş yok' });
      expect(elsewhere).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says that the list could not be read and offers to try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /today': () => new Response(null, { status: 500 }),
      });
      renderApp('/c/armadx');
      await screen.findByRole('heading', { level: 1, name: 'Bugün' });
      // The query client tries a server error again by itself before it gives up.
      await vi.advanceTimersByTimeAsync(8_000);
      const alert = await within(screen.getByRole('main')).findByRole('alert');
      expect(alert).toHaveTextContent('Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.');
      api.handle('GET /today', () => json(todayBody({ expected: [DECIDE] })));
      await user.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
      expect(await screen.findByRole('region', { name: 'Sizden beklenenler 1' })).toBeVisible();
      expect(within(screen.getByRole('main')).queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

const RETURNED_SENTENCE =
  'Talebiniz geri çevrildi: Hukuk ve Uyum biriminde bu işi alabilecek açık ajan yok.';
const RETURNED_REQUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Bugün: Bildirimler', () => {
  it('lists the notifications newest first with their fixed sentences, the request as a link and the time', async () => {
    const read = { ...STOPPED_NOTE, read: true };
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () =>
        json(todayBody({ notifications: [RETURNED_NOTE, REJECTED_NOTE, read, RESET_NOTE] })),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    const rows = within(region).getAllByRole('listitem');
    // The API's order, the title of the request (or of the reset) and the fixed sentence.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(`KVKK metni${RETURNED_SENTENCE}`),
      expect.stringContaining('Ekim duyurusuTalebinizin sonucu reddedildi.'),
      expect.stringContaining('Fuar davetiyesiTalebiniz durduruldu.'),
      expect.stringContaining(
        "Passkey'leriniz sıfırlandıGüvenlik sayfasından yeni bir passkey ekleyin.",
      ),
    ]);
    expect(
      within(region).getByRole('link', { name: `Okunmadı. KVKK metni, ${RETURNED_SENTENCE}` }),
    ).toHaveAttribute('href', `/c/armadx/requests/${RETURNED_REQUEST}`);
    expect(rows.map((row) => row.querySelector('time')?.getAttribute('datetime'))).toEqual([
      RETURNED_NOTE.createdAt,
      REJECTED_NOTE.createdAt,
      STOPPED_NOTE.createdAt,
      RESET_NOTE.createdAt,
    ]);
    // The time carries no tooltip: under the row's link it could never be shown.
    expect(
      rows.map((row) => Array.from(row.querySelectorAll('[title]'), (part) => part.textContent)),
    ).toEqual([
      ['KVKK metni'],
      ['Ekim duyurusu'],
      ['Fuar davetiyesi'],
      ["Passkey'leriniz sıfırlandı"],
    ]);
    // A read notification stays listed, without the mark and without the button.
    const quiet = rows[2];
    if (!quiet) throw new Error('No row for the read notification');
    expect(within(quiet).queryByRole('button')).toBeNull();
    expect(
      within(quiet).getByRole('link', { name: 'Fuar davetiyesi, Talebiniz durduruldu.' }),
    ).toBeVisible();
    expect(within(region).getAllByRole('button', { name: /^Okundu: / })).toHaveLength(3);
    // Nothing of a notification is a decision.
    expect(within(region).queryAllByRole('combobox')).toEqual([]);
  });

  it('"Okundu" marks one notification read, keeps it listed and leaves the keyboard on its row', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () => json(todayBody({ notifications: [RETURNED_NOTE, REJECTED_NOTE] })),
      'POST /notifications/read': () => noContent(),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    await userEvent.click(within(region).getByRole('button', { name: 'Okundu: KVKK metni' }));
    const link = await within(region).findByRole('link', {
      name: `KVKK metni, ${RETURNED_SENTENCE}`,
    });
    const [call, ...others] = api.callsTo('POST /notifications/read');
    expect(others).toEqual([]);
    expect(call?.body).toEqual({ ids: [RETURNED_NOTE.id] });
    expect(call?.headers.get(COMPANY_HEADER)).toBe(ARMADX.companyId);
    // A person's act: it counts as activity.
    expect(call?.headers.get(BACKGROUND_HEADER)).toBeNull();
    // Still listed, quieter, and the keyboard is where the button was.
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region).queryByRole('button', { name: 'Okundu: KVKK metni' })).toBeNull();
    expect(within(region).queryByRole('link', { name: /^Okunmadı\. KVKK metni/ })).toBeNull();
    expect(link).toHaveFocus();
    expect(within(region).getByRole('button', { name: 'Okundu: Ekim duyurusu' })).toBeVisible();
  });

  it('"Tümünü okundu say" marks every unread notification on screen and moves the focus to the heading', async () => {
    const read = { ...REJECTED_NOTE, read: true };
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () => json(todayBody({ notifications: [RETURNED_NOTE, read, RESET_NOTE] })),
      'POST /notifications/read': () => noContent(),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    await userEvent.click(within(region).getByRole('button', { name: 'Tümünü okundu say' }));
    await waitFor(() => {
      expect(within(region).queryByRole('button', { name: 'Tümünü okundu say' })).toBeNull();
    });
    // The ids of the unread ones that are on screen, never an "everything" flag.
    expect(api.callsTo('POST /notifications/read').map((call) => call.body)).toEqual([
      { ids: [RETURNED_NOTE.id, RESET_NOTE.id] },
    ]);
    expect(within(region).queryAllByRole('button')).toEqual([]);
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
    expect(within(region).queryByRole('link', { name: /^Okunmadı/ })).toBeNull();
    expect(within(region).getByRole('heading', { name: 'Bildirimler' })).toHaveFocus();
  });

  it('opening the request from a notification marks it read', async () => {
    const read = { ...STOPPED_NOTE, read: true };
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () => json(todayBody({ notifications: [RETURNED_NOTE, read] })),
      'POST /notifications/read': () => noContent(),
      [`GET /requests/${RETURNED_REQUEST}`]: () =>
        json(
          requestDetail({
            id: RETURNED_REQUEST,
            title: 'KVKK metni',
            status: 'cancelled',
            stage: 'cancelled',
            cause: 'returned_no_agent',
            turn: { kind: 'none' },
            waitingForMe: false,
            unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
            requester: FOUNDER,
            approval: null,
            actions: { cancel: false, stop: false, reroute: false },
          }),
        ),
    });
    const { router, queryClient } = renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    // A read one: opening it sends nothing. (Its page is not what this test is about.)
    await userEvent.click(
      within(region).getByRole('link', { name: 'Fuar davetiyesi, Talebiniz durduruldu.' }),
    );
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(
        '/c/armadx/requests/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      );
    });
    expect(api.callsTo('POST /notifications/read')).toEqual([]);

    await router.navigate({ to: '/c/$company', params: { company: 'armadx' } });
    const again = await screen.findByRole('region', { name: 'Bildirimler' });
    await userEvent.click(
      within(again).getByRole('link', { name: `Okunmadı. KVKK metni, ${RETURNED_SENTENCE}` }),
    );
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(`/c/armadx/requests/${RETURNED_REQUEST}`);
    });
    await waitFor(() => {
      expect(api.callsTo('POST /notifications/read').map((call) => call.body)).toEqual([
        { ids: [RETURNED_NOTE.id] },
      ]);
    });
    // The mark is kept although the person has left the screen that sent it.
    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ReturnType<typeof todayBody>>(['company', ARMADX.companyId, 'today'])
          ?.notifications.map((notification) => notification.read),
      ).toEqual([true, true]);
    });
  });

  it('says so when a mark could not be saved and shows nothing as read', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () => json(todayBody({ notifications: [RETURNED_NOTE] })),
      'POST /notifications/read': () => new Response(null, { status: 500 }),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    await userEvent.click(within(region).getByRole('button', { name: 'Okundu: KVKK metni' }));
    expect(
      await screen.findByText('Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.'),
    ).toBeVisible();
    expect(api.callsTo('POST /notifications/read')).toHaveLength(1);
    expect(within(region).getByRole('button', { name: 'Okundu: KVKK metni' })).toBeVisible();
    expect(
      within(region).getByRole('link', { name: `Okunmadı. KVKK metni, ${RETURNED_SENTENCE}` }),
    ).toBeVisible();
  });

  it('says that there is no notification and what would bring one', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    expect(
      within(region).getByText(
        'Bildiriminiz yok. Talebiniz siz bir şey yapmadan kapanırsa burada haber verilir.',
      ),
    ).toBeVisible();
    expect(within(region).queryByRole('button', { name: 'Tümünü okundu say' })).toBeNull();
    expect(within(region).queryAllByRole('listitem')).toEqual([]);
  });

  it('tells a screen reader how many things wait and how many notifications are unread', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () =>
        json(
          todayBody({
            expected: [DECIDE, ACCEPT, FALLEN],
            notifications: [RETURNED_NOTE, { ...REJECTED_NOTE, read: true }, RESET_NOTE],
          }),
        ),
    });
    renderApp('/c/armadx');
    await screen.findByRole('region', { name: 'Bildirimler' });
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('status')
        .map((status) => status.textContent),
    ).toEqual(['3 iş sizden bekleniyor. 2 okunmamış bildirim var.']);
  });

  it('an external person reads their own notification and can open Güvenlik from it', async () => {
    const api = mockApi({
      'GET /session': sessionHandler(EXTERNAL_SESSION),
      'GET /today': () => json(todayBody({ notifications: [RESET_NOTE] })),
      'POST /notifications/read': () => noContent(),
      'GET /passkeys': () => json({ passkeys: [] }),
    });
    const { router } = renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    const link = within(region).getByRole('link', {
      name: "Okunmadı. Passkey'leriniz sıfırlandı. Güvenlik sayfasından yeni bir passkey ekleyin.",
    });
    expect(link).toHaveAttribute('href', '/c/armadx/settings/security');
    expect(within(region).queryByText(/Bildiriminiz yok/)).toBeNull();
    // Opening Güvenlik from it is reading it, as opening the request is for the others.
    await userEvent.click(link);
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe('/c/armadx/settings/security');
    });
    await waitFor(() => {
      expect(api.callsTo('POST /notifications/read').map((call) => call.body)).toEqual([
        { ids: [RESET_NOTE.id] },
      ]);
    });

    // Without a notification the section says so, and nothing about requests that are not theirs.
    cleanup();
    mockApi({ 'GET /session': sessionHandler(EXTERNAL_SESSION) });
    renderApp('/c/armadx');
    const empty = await screen.findByRole('region', { name: 'Bildirimler' });
    expect(within(empty).getByText('Bildiriminiz yok.')).toBeVisible();
    expect(empty).not.toHaveTextContent(/talep/i);
  });

  it('says so when a list was cut at its limit', async () => {
    mockApi({
      'GET /session': sessionHandler(),
      'GET /today': () =>
        json(
          todayBody({
            expected: [DECIDE],
            expectedTruncated: true,
            notifications: [RETURNED_NOTE],
            notificationsTruncated: true,
          }),
        ),
    });
    renderApp('/c/armadx');
    const region = await screen.findByRole('region', { name: 'Bildirimler' });
    expect(within(region).getByText('Liste en yeni 100 bildirimi gösteriyor.')).toBeVisible();
    expect(
      within(expectedRegion()).getByText(
        'Liste en uzun süredir bekleyen 200 açık talepten kuruldu; daha yeni bir iş burada görünmeyebilir.',
      ),
    ).toBeVisible();
  });
});
