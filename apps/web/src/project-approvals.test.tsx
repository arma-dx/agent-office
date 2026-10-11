import { BACKGROUND_HEADER } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWhen } from './lib/dates.ts';
import { apiError, json, mockApi } from './test/mock-api.ts';
import {
  AYSE,
  EMPLOYEE_AT_ARMADX,
  PROJECT_ID,
  projectApproval,
  projectApprovals,
  projectApprovalsRoute,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  sessionAs,
} from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The "Onaylar" tab of a project's page (8 October 2026, decision 17): the results of the
// project's requests as the unit's approver decided them. A row opens the request; nothing is
// decided in the tab (docs/SONRA.md W-n), and no agent text is in it (V-c).

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const TAB = `${PATH}?tab=approvals`;
const APPROVALS = projectApprovalsRoute();

const id = (n: number) => `f${String(n).padStart(7, '0')}-1111-4111-8111-111111111111`;
const request = (n: number, title: string) => ({
  id: `e${String(n).padStart(7, '0')}-1111-4111-8111-111111111111`,
  title,
});
const BY = { userId: AYSE.userId, name: 'Ayşe Yılmaz' };
const DECIDED_AT = '2026-10-08T11:00:00.000Z';

const waiting = projectApproval({ id: id(1), request: request(1, 'Ekim bülteni taslağı') });
const again = projectApproval({ id: id(2), request: request(2, 'Kasım bülteni'), attempt: 2 });
const approved = projectApproval({
  id: id(3),
  request: request(3, 'Depo raporu'),
  status: 'approved',
  decidedAt: DECIDED_AT,
  decidedBy: BY,
});
const sentBack = projectApproval({
  id: id(4),
  request: request(4, 'Fiyat listesi'),
  status: 'changes_requested',
  decidedAt: DECIDED_AT,
  decidedBy: BY,
});
const rejected = projectApproval({
  id: id(5),
  request: request(5, 'Duyuru metni'),
  status: 'rejected',
  decidedAt: DECIDED_AT,
  decidedBy: { userId: BY.userId, name: null },
});
const closed = projectApproval({
  id: id(6),
  request: request(6, 'Eski görev'),
  status: 'closed',
  createdAt: '2026-10-07T08:00:00.000Z',
});
const ALL = [waiting, again, approved, sentBack, rejected, closed];

const tabPanel = () => screen.findByRole('tabpanel', { name: 'Onaylar' });
const group = (name: string) => screen.findByRole('region', { name });

describe('projects: the approvals of a project', () => {
  it('the project page has the Onaylar tab, and ?tab=approvals opens it', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), { [APPROVALS]: () => json(projectApprovals(ALL)) }),
    );
    const { router } = renderApp(PATH);
    const tab = await screen.findByRole('tab', { name: 'Onaylar' });
    // The tab carries no count and no badge: the Onaylar screen says what waits for the reader.
    expect(tab).toHaveTextContent(/^Onaylar$/);
    // The results are read only when their tab is opened.
    expect(api.callsTo(APPROVALS)).toEqual([]);
    await userEvent.click(tab);
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'approvals' } });
    });
    expect(await group('Karar bekleyenler')).toBeVisible();
    cleanup();

    mockApi(projectHandlers(projectDetail(), { [APPROVALS]: () => json(projectApprovals(ALL)) }));
    renderApp(TAB);
    expect(await screen.findByRole('tab', { name: 'Onaylar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await group('Karar verilenler ve kapananlar')).toBeVisible();
  });

  it('approvals: two groups, each row a link to its request with one sentence', async () => {
    mockApi(projectHandlers(projectDetail(), { [APPROVALS]: () => json(projectApprovals(ALL)) }));
    renderApp(TAB);
    const sentences = (region: HTMLElement) =>
      within(region)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('p')?.textContent);
    const first = await group('Karar bekleyenler');
    expect(within(first).getByRole('heading', { level: 3 })).toHaveTextContent('Karar bekleyenler');
    expect(sentences(first)).toEqual([
      'SOS-2 sonucu onay bekliyor.',
      'SOS-2 düzeltilmiş sonucu onay bekliyor.',
    ]);
    const second = await group('Karar verilenler ve kapananlar');
    expect(sentences(second)).toEqual([
      'SOS-2 sonucunu Ayşe Yılmaz onayladı.',
      'SOS-2 sonucu için Ayşe Yılmaz düzeltme istedi.',
      // A name that cannot be read any more.
      'SOS-2 sonucunu Eski üye reddetti.',
      'SOS-2 sonucu karar verilmeden kapandı: talep değişti.',
    ]);
    // The row is the request's title, a link to the request named by the title and the sentence.
    const link = within(first).getByRole('link', {
      name: 'Ekim bülteni taslağı. SOS-2 sonucu onay bekliyor.',
    });
    expect(link).toHaveTextContent(/^Ekim bülteni taslağı$/);
    expect(link).toHaveAttribute('href', `/c/armadx/requests/${waiting.request.id}`);
    expect(
      within(second).getByRole('link', {
        name: 'Depo raporu. SOS-2 sonucunu Ayşe Yılmaz onayladı.',
      }),
    ).toHaveAttribute('href', `/c/armadx/requests/${approved.request.id}`);
    // The time: when it was decided, or when it was sent for one that waits or was closed.
    const timeOf = (region: HTMLElement, index: number) =>
      within(region).getAllByRole('listitem')[index]?.querySelector('time');
    expect(timeOf(second, 0)).toHaveAttribute('datetime', DECIDED_AT);
    expect(timeOf(second, 0)).toHaveTextContent(formatWhen(DECIDED_AT));
    expect(timeOf(first, 0)).toHaveAttribute('datetime', waiting.createdAt);
    expect(timeOf(second, 3)).toHaveAttribute('datetime', closed.createdAt);
    // A closed result is an event, not a decision: the mark of the journey, not a status icon.
    const rows = within(second).getAllByRole('listitem');
    expect(rows[3]?.querySelector('[data-journey-mark="event"]')).not.toBeNull();
    expect(rows[2]?.querySelector('[data-journey-mark="event"]')).toBeNull();
    expect(rows[2]?.querySelector('svg')).not.toBeNull();
    // A reader with the approval right is not told that something is left out.
    expect(await tabPanel()).not.toHaveTextContent('yalnızca onay verebilen kişiler görür');
    cleanup();

    // A group without a row is not drawn.
    mockApi(
      projectHandlers(projectDetail(), { [APPROVALS]: () => json(projectApprovals([approved])) }),
    );
    renderApp(TAB);
    expect(await group('Karar verilenler ve kapananlar')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Karar bekleyenler' })).toBeNull();
    expect(screen.queryByText('Karar bekleyenler')).toBeNull();
  });

  it('approvals: a reader without the approval right is told what the list leaves out', async () => {
    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [APPROVALS]: () => json(projectApprovals([approved], { seesUndecided: false })),
      }),
    );
    renderApp(TAB);
    expect(await group('Karar verilenler ve kapananlar')).toBeVisible();
    expect(await tabPanel()).toHaveTextContent(
      'Onay bekleyen ve onaylanmayan sonuçları yalnızca onay verebilen kişiler görür.',
    );
  });

  it('approvals: empty in both wordings', async () => {
    mockApi(projectHandlers(projectDetail()));
    renderApp(TAB);
    const panel = await tabPanel();
    expect(
      await within(panel).findByRole('heading', {
        name: 'Bu projede henüz onaya sunulan sonuç yok',
      }),
    ).toBeVisible();
    expect(panel).toHaveTextContent(
      'Ajanların bu projedeki taleplere yazdığı sonuçlar onaya sunulduğunda burada listelenir.',
    );
    expect(panel).not.toHaveTextContent('yalnızca onay verebilen kişiler görür');
    cleanup();

    mockApi(
      projectHandlers(projectForEmployee(), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
        [APPROVALS]: () => json(projectApprovals([], { seesUndecided: false })),
      }),
    );
    renderApp(TAB);
    // A reader without the approval right gets only approved results: results they may not see
    // can be waiting, so the tab does not say that nothing was submitted.
    const other = await tabPanel();
    expect(
      await within(other).findByRole('heading', { name: 'Bu projede henüz onaylanmış sonuç yok' }),
    ).toBeVisible();
    expect(
      within(other).queryByRole('heading', { name: 'Bu projede henüz onaya sunulan sonuç yok' }),
    ).toBeNull();
    expect(other).toHaveTextContent(
      'Onay bekleyen ve onaylanmayan sonuçları yalnızca onay verebilen kişiler görür.',
    );
    expect(other).not.toHaveTextContent('onaya sunulan sonuç yok');
    expect(other).not.toHaveTextContent('Bu projede onaylanmış sonuç yok.');
  });

  it('approvals: the tab holds no button that decides', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), { [APPROVALS]: () => json(projectApprovals(ALL)) }),
    );
    renderApp(TAB);
    await group('Karar bekleyenler');
    const panel = await tabPanel();
    // Nothing but links: the card is on the request's page, for whoever may decide it.
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).getAllByRole('link')).toHaveLength(ALL.length);
    expect(panel).not.toHaveTextContent(/Onayla|Reddet|Düzeltme iste\b/);
    // Only reads were sent.
    expect(api.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('approvals: loading, the error with a retry, the cut list, and a refresh in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let release: (response: Response) => void = () => undefined;
      const api = mockApi(
        projectHandlers(projectDetail(), {
          [APPROVALS]: () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        }),
      );
      renderApp(TAB);
      const panel = await tabPanel();
      expect(within(panel).getByText('Yükleniyor')).toBeInTheDocument();
      release(apiError(409, 'invalid_request', 'Liste şu anda okunamadı. Yeniden deneyin.'));
      const alert = await within(panel).findByRole('alert');
      expect(alert).toHaveTextContent('Liste şu anda okunamadı. Yeniden deneyin.');
      api.handle(APPROVALS, () => json(projectApprovals([approved], { truncated: true })));
      await user.click(within(alert).getByRole('button', { name: 'Yeniden dene' }));
      expect(await group('Karar verilenler ve kapananlar')).toBeVisible();
      expect(within(panel).getByText('Liste en yeni 200 sonucu gösteriyor.')).toBeVisible();

      // Agents submit results by themselves: every half minute, as a background request.
      const before = api.callsTo(APPROVALS).length;
      api.handle(APPROVALS, () => json(projectApprovals([waiting, approved])));
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(api.callsTo(APPROVALS)).toHaveLength(before + 1);
      });
      expect(api.callsTo(APPROVALS).at(-1)?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      expect(await group('Karar bekleyenler')).toBeVisible();
      expect(within(panel).queryByText('Liste en yeni 200 sonucu gösteriyor.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
