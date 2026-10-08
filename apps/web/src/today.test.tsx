import { BACKGROUND_HEADER, COMPANY_HEADER } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARMADX, json, mockApi, sessionHandler } from './test/mock-api.ts';
import {
  EMPLOYEE,
  FOUNDER,
  REQUEST_ID,
  requestDetail,
  summaryOf,
  todayBody,
} from './test/request-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

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
          'Onayınızı ya da bakmanızı bekleyen talepler burada görünür. Ajanlardan bir iş istemek için talep gönderin.',
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
