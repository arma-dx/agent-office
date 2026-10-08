import {
  BACKGROUND_HEADER,
  COMPANY_HEADER,
  type CompanyAgentStatus,
  type MembershipSummary,
  type OfficeResponse,
} from '@agent-office/shared';
import { focusManager } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeUnit } from './lib/office/model.ts';
import { WIDE_WINDOW_QUERY } from './lib/office/use-wide-window.ts';
import { stubMatchMedia } from './test/match-media.ts';
import {
  apiError,
  ARMADX,
  FOUNDER_SPACE,
  json,
  mockApi,
  PILLIKA,
  sessionHandler,
  type ApiCall,
} from './test/mock-api.ts';
import { ARMADX_OFFICE, FOUNDER_OFFICE, PILLIKA_OFFICE } from './test/office-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The live states of the office view, the counts of the selected agent and "Her yerde durdur"
// (8 October decisions 9 and 10; docs/SONRA.md W-d, W-e and W-f).

const R1 = '00000000-0000-4000-8000-000000000101';
const R2 = '00000000-0000-4000-8000-000000000102';
const NONE = { count: 0, requestId: null };
const one = (requestId: string) => ({ count: 1, requestId });
const many = (count: number) => ({ count, requestId: null });

type Work = OfficeResponse['work'][number];
const work = (agentCode: string, counts: Partial<Omit<Work, 'agentCode'>>): Work => ({
  agentCode,
  running: NONE,
  awaitingApproval: NONE,
  failed: NONE,
  ...counts,
});

function officeBody(
  units: readonly OfficeUnit[],
  switches: Record<string, CompanyAgentStatus> = {},
  works: Work[] = [],
  workTruncated = false,
): OfficeResponse {
  return {
    units: units.map((unit) => ({
      code: unit.code,
      name: unit.name,
      agents: unit.agents.map((agent) => ({
        code: agent.code,
        name: agent.name,
        status: switches[agent.code] ?? null,
        ready: true,
      })),
    })),
    work: works,
    workTruncated,
  };
}

const EMPLOYEE: MembershipSummary = { ...ARMADX, role: 'employee', canApprove: false };
const OPEN = {
  'KOR-1': 'enabled',
  'SOS-2': 'enabled',
  'TAS-3': 'enabled',
  'HAF-1': 'enabled',
} as const;

function desk(code: string): Element {
  const element = document.querySelector(`svg [data-office-id="agent:${code}"]`);
  if (!element) throw new Error(`no desk for ${code}`);
  return element;
}

const label = (code: string) => screen.findByRole('button', { name: new RegExp(`^${code} `) });
const panel = () => screen.getByRole('complementary', { name: 'Özellikler' });
const wide = () => stubMatchMedia([WIDE_WINDOW_QUERY]);

/** The rows of the list "Açık talepleri" as text. */
function workRows(): (string | null)[] {
  return within(within(panel()).getByRole('list', { name: 'Açık talepleri' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

describe('office page: live states', () => {
  it('shows on each desk what the open requests of its agent say, with a word and a mark for every state', async () => {
    wide();
    mockApi({
      'GET /session': sessionHandler(),
      'GET /office': () =>
        json(
          officeBody(ARMADX_OFFICE, { ...OPEN, 'KOR-2': 'stopped' }, [
            work('KOR-1', { running: many(2) }),
            work('SOS-2', { running: one(R1), awaitingApproval: one(R2) }),
            work('TAS-3', { running: many(3), awaitingApproval: one(R1), failed: one(R2) }),
            // Stopped: the switch comes first, whatever is still counted.
            work('KOR-2', { awaitingApproval: one(R1) }),
          ]),
        ),
    });
    renderApp('/c/armadx/office');
    const states: Record<string, [string, string]> = {
      'KOR-1': ['running', 'Çalışıyor'],
      'SOS-2': ['awaiting_approval', 'Onay bekliyor'],
      'TAS-3': ['error', 'Hata'],
      'HAF-1': ['idle', 'Boşta'],
      'KOR-2': ['stopped', 'Durduruldu'],
      'KOR-3': ['closed', 'Kapalı'],
    };
    for (const [code, [state, word]] of Object.entries(states)) {
      const button = await label(code);
      expect(desk(code), code).toHaveAttribute('data-state', state);
      expect(button, code).toHaveAttribute('data-state', state);
      // The word is part of the accessible name, and every label carries one mark.
      expect(button.getAttribute('aria-label'), code).toMatch(new RegExp(`, ${word}$`));
      expect(button.querySelectorAll('svg.office-glyph'), code).toHaveLength(1);
      expect(button.querySelector('svg.office-glyph'), code).toHaveAttribute('aria-hidden', 'true');
    }
    expect(
      within(screen.getByRole('list', { name: 'Durumlar' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Kapalı', 'Boşta', 'Çalışıyor', 'Onay bekliyor', 'Hata', 'Durduruldu']);
    // The panel says the same word and a sentence for it.
    await userEvent.click(await label('TAS-3'));
    expect(
      within(panel()).getByText('Durum', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('Hata');
    expect(within(panel()).getByText('Bu ajanın yürüttüğü bir talep insana düştü.')).toBeVisible();
  });

  it('lists the three counts of the selected agent; a count of one leads to that request', async () => {
    wide();
    mockApi({
      'GET /session': sessionHandler(),
      'GET /office': () =>
        json(
          officeBody(ARMADX_OFFICE, OPEN, [
            work('SOS-2', { running: many(2), awaitingApproval: NONE, failed: one(R1) }),
          ]),
        ),
      [`GET /requests/${R1}`]: () => apiError(404, 'not_found', 'Kayıt bulunamadı.'),
    });
    const { router } = renderApp('/c/armadx/office');
    await userEvent.click(await label('SOS-2'));
    expect(workRows()).toEqual(['Çalışıyor2 talep', 'Onay bekliyor0 talep', 'Hata1']);
    const list = within(panel()).getByRole('list', { name: 'Açık talepleri' });
    // One link: the request that fell to a person. Several requests are a number alone.
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Hata: 1 talep, talebi aç');
    // The founder sees every request of the company: no note about what the numbers leave out.
    expect(within(panel()).queryByText(/görebildiğiniz/)).toBeNull();
    expect(within(panel()).queryByText(/fazlası açık/)).toBeNull();
    await userEvent.click(links[0] as HTMLElement);
    await waitFor(() => {
      expect(currentLocation(router).pathname).toBe(`/c/armadx/requests/${R1}`);
    });
  });

  it('shows zeros for an agent without work, tells an employee what the numbers are counted from, and says when they were cut', async () => {
    wide();
    mockApi({
      'GET /session': sessionHandler({ memberships: [EMPLOYEE] }),
      'GET /office': () => json(officeBody(ARMADX_OFFICE, OPEN, [], true)),
    });
    renderApp('/c/armadx/office');
    await userEvent.click(await label('KOR-1'));
    expect(workRows()).toEqual(['Çalışıyor0 talep', 'Onay bekliyor0 talep', 'Hata0 talep']);
    expect(within(panel()).queryByRole('link')).toBeNull();
    expect(
      within(panel()).getByText('Durum ve sayılar, görebildiğiniz taleplerden hesaplanır.'),
    ).toBeVisible();
    expect(
      within(panel()).getByText(
        'Şirkette 200 talepten fazlası açık; durumlar ve sayılar en uzun süredir bekleyen 200 talepten hesaplandı.',
      ),
    ).toBeVisible();
  });

  it('shows no counts in Kurucu alanı, where no request can be opened', async () => {
    wide();
    mockApi({
      'GET /session': sessionHandler(),
      'GET /office': () => json(officeBody(FOUNDER_OFFICE, { 'KOR-4': 'enabled' })),
    });
    renderApp('/c/founder_space/office');
    await userEvent.click(await label('KOR-4'));
    expect(within(panel()).getByText('Bu ajan açık ve boşta.')).toBeVisible();
    expect(within(panel()).queryByRole('list', { name: 'Açık talepleri' })).toBeNull();
  });

  it('refreshes every half minute in the background, changes only what the answer says, and stops under an open confirmation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wide();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /office': () =>
          json(officeBody(ARMADX_OFFICE, OPEN, [work('SOS-2', { failed: one(R1) })])),
      });
      renderApp('/c/armadx/office');
      await user.click(await label('SOS-2'));
      const world = screen.getByTestId('office-world');
      const view = world.getAttribute('transform');
      const link = within(panel()).getByRole('link', { name: 'Hata: 1 talep, talebi aç' });
      link.focus();

      // The request was routed again: the error is gone and the agent runs two requests.
      api.handle('GET /office', () =>
        json(officeBody(ARMADX_OFFICE, OPEN, [work('SOS-2', { running: many(2) })])),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(desk('SOS-2')).toHaveAttribute('data-state', 'running');
      });
      expect(api.callsTo('GET /office')).toHaveLength(2);
      expect(api.callsTo('GET /office')[0]?.headers.get(BACKGROUND_HEADER)).toBeNull();
      expect(api.callsTo('GET /office')[1]?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      // The selection, the panel and the view stayed; the numbers follow.
      expect(
        screen.getByRole('button', { name: /^SOS-2 .*, Çalışıyor$/, pressed: true }),
      ).toBeVisible();
      expect(world.getAttribute('transform')).toBe(view);
      expect(workRows()).toEqual(['Çalışıyor2 talep', 'Onay bekliyor0 talep', 'Hata0 talep']);
      // The link that held the focus is gone: the focus is on the heading of the list, not lost.
      expect(link).not.toBeInTheDocument();
      expect(within(panel()).getByRole('heading', { name: 'Açık talepleri' })).toHaveFocus();

      // Under an open confirmation nothing is read: what is confirmed must not change.
      await user.click(within(panel()).getByRole('button', { name: 'Ajanı durdur' }));
      await screen.findByRole('alertdialog', { name: 'SOS-2 bu şirkette durdurulsun mu?' });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(api.callsTo('GET /office')).toHaveLength(2);
      // Nor on coming back to the tab.
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(api.callsTo('GET /office')).toHaveLength(2);
      await user.click(screen.getByRole('button', { name: 'Vazgeç' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(api.callsTo('GET /office')).toHaveLength(3);
      });
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('keeps the scene when reading it again fails on the way, and takes it away when the API refuses the reader', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wide();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /office': () => json(officeBody(ARMADX_OFFICE, OPEN)),
      });
      renderApp('/c/armadx/office');
      await user.click(await label('SOS-2'));
      expect(desk('SOS-2')).toHaveAttribute('data-state', 'idle');

      // The server is gone when the person comes back to the tab: the read fails after its
      // retries. What was read last stays, with the selection and its panel; no error page.
      api.handle('GET /office', () => new Response('bad gateway', { status: 502 }));
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(api.callsTo('GET /office')).toHaveLength(5);
      expect(screen.getByRole('figure')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^SOS-2 .*, Boşta$/, pressed: true }),
      ).toBeVisible();
      expect(within(panel()).getByRole('heading', { name: 'Açık talepleri' })).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();

      // The server is back: the next refresh in the background brings the scene up to date.
      api.handle('GET /office', () =>
        json(officeBody(ARMADX_OFFICE, { ...OPEN, 'SOS-2': 'stopped' })),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(desk('SOS-2')).toHaveAttribute('data-state', 'stopped');
      });

      // A refusal is not a failure on the way: what the API no longer shows does not stay.
      api.handle('GET /office', () => apiError(403, 'forbidden', 'Bu işlem için yetkiniz yok.'));
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      expect(await screen.findByRole('alert')).toHaveTextContent('Bu işlem için yetkiniz yok.');
      expect(screen.queryByRole('figure')).toBeNull();
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('keeps the keyboard focus on a desk whose state changes by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wide();
      const api = mockApi({
        'GET /session': sessionHandler(),
        'GET /office': () =>
          json(officeBody(ARMADX_OFFICE, OPEN, [work('SOS-2', { failed: one(R1) })])),
      });
      renderApp('/c/armadx/office');
      const button = await label('SOS-2');
      button.focus();
      expect(button).toHaveAccessibleName(/, Hata$/);
      api.handle('GET /office', () =>
        json(officeBody(ARMADX_OFFICE, OPEN, [work('SOS-2', { running: many(2) })])),
      );
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(button).toHaveAccessibleName(/, Çalışıyor$/);
      });
      // The same element, still in the page, still with the focus.
      expect(button).toBeInTheDocument();
      expect(button).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('office page: "Her yerde durdur"', () => {
  const switchKey = 'PUT /agents/SOS-2/switch';
  const STOP = { status: 'stopped', onlyIfOpen: true };

  /** An office per company whose SOS-2 switch the test sets, read by the company header. */
  function twoCompanies(
    switches: { arma: CompanyAgentStatus | null; pillika: CompanyAgentStatus | null },
    put: (call: ApiCall) => Response | Promise<Response>,
  ) {
    const state = { ...switches };
    const bodyOf = (call: ApiCall): Response => {
      switch (call.headers.get(COMPANY_HEADER)) {
        case ARMADX.companyId:
          return json(officeBody(ARMADX_OFFICE, state.arma ? { 'SOS-2': state.arma } : {}));
        case PILLIKA.companyId:
          return json(officeBody(PILLIKA_OFFICE, state.pillika ? { 'SOS-2': state.pillika } : {}));
        default:
          // Kurucu alanı has no such agent.
          return json(officeBody(FOUNDER_OFFICE));
      }
    };
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /office': bodyOf,
      [switchKey]: put,
    });
    return { api, state, office: bodyOf };
  }

  /** The answer of a conditional stop: the switch as it is now, and whether this request set it. */
  const stopped = (
    status: CompanyAgentStatus | null = 'stopped',
    changed: boolean = status === 'stopped',
  ) => json({ code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı', status, ready: true, changed });
  const sentTo = (calls: ApiCall[]) => calls.map((call) => call.headers.get(COMPANY_HEADER));
  const items = (list: HTMLElement) =>
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
  /** The buttons of the dialog as text; one that is busy says so. */
  const buttons = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('button')
      .map(
        (button) =>
          `${button.textContent}${button.getAttribute('aria-disabled') === 'true' ? ' (busy)' : ''}`,
      );
  const badGateway = () => new Response('bad gateway', { status: 502 });
  const FAILED = 'durdurulamadı. Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.';
  /** Opens the dialog for SOS-2 from the office of Arma DX and confirms the stop. */
  async function confirmStop(user: Pick<typeof userEvent, 'click'> = userEvent) {
    renderApp('/c/armadx/office');
    await user.click(await label('SOS-2'));
    await user.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
    const dialog = await screen.findByRole('alertdialog');
    await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
    await user.click(within(dialog).getByRole('button', { name: 'Her yerde durdur' }));
    const results = await within(dialog).findByRole('list', { name: 'Sonuç' });
    return { dialog, results };
  }

  it('names the companies where the agent is open, stops it in each with a request of its own, and says what happened', async () => {
    wide();
    const { api, state } = twoCompanies({ arma: 'enabled', pillika: 'enabled' }, (call) => {
      if (call.headers.get(COMPANY_HEADER) === ARMADX.companyId) state.arma = 'stopped';
      else state.pillika = 'stopped';
      return stopped();
    });
    renderApp('/c/armadx/office');
    await userEvent.click(await label('SOS-2'));
    const button = within(panel()).getByRole('button', { name: 'Her yerde durdur' });
    await userEvent.click(button);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'SOS-2 her yerde durdurulsun mu?',
    });
    // The switch is read in every company the person is the founder of, by a request of the
    // person; nothing is stopped by opening the dialog.
    const places = await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
    await waitFor(() => {
      expect(items(places)).toEqual(['Arma DX', 'Pillika']);
    });
    expect(dialog).toHaveTextContent(
      'Yeni iş almaz; süren çalışması bir sonraki adımdan önce durur. Kapalı ya da durdurulmuş olduğu yerde bir şey değişmez. Yeniden açma her yerde ayrı yapılır.',
    );
    expect(api.callsTo(switchKey)).toEqual([]);
    const reads = api.callsTo('GET /office').slice(1);
    expect(sentTo(reads).sort()).toEqual(
      [ARMADX.companyId, PILLIKA.companyId, FOUNDER_SPACE.companyId].sort(),
    );
    for (const read of reads) expect(read.headers.get(BACKGROUND_HEADER)).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Her yerde durdur' }));
    const results = await within(dialog).findByRole('list', { name: 'Sonuç' });
    await waitFor(() => {
      expect(items(results)).toEqual(['Arma DX: durduruldu.', 'Pillika: durduruldu.']);
    });
    expect(dialog).toHaveTextContent(
      'Her yer için sonuç aşağıda. Yeniden açma her yerde ayrı yapılır.',
    );
    // One request per company, each in that company's context, each a stop "only if open".
    expect(api.callsTo(switchKey).map((call) => call.body)).toEqual([STOP, STOP]);
    expect(sentTo(api.callsTo(switchKey))).toEqual([ARMADX.companyId, PILLIKA.companyId]);
    expect(screen.getByRole('alertdialog', { name: 'SOS-2 için sonuç' })).toBeVisible();
    // The focus is on the button that closes; the desk behind the dialog shows the stop.
    const close = within(dialog).getByRole('button', { name: 'Kapat' });
    await waitFor(() => {
      expect(close).toHaveFocus();
    });
    expect(within(dialog).queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
    await userEvent.click(close);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(button).toHaveFocus();
    });
    expect(desk('SOS-2')).toHaveAttribute('data-state', 'stopped');
    expect(within(panel()).getByRole('button', { name: 'Ajanı yeniden aç' })).toBeVisible();
    expect(api.unexpected).toEqual([]);
  });

  it('sends nothing to a company where the agent is closed or stopped, and says so when it is open nowhere', async () => {
    wide();
    const { api, state } = twoCompanies({ arma: 'enabled', pillika: 'disabled' }, () => {
      state.arma = 'stopped';
      return stopped();
    });
    renderApp('/c/armadx/office');
    await userEvent.click(await label('SOS-2'));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
    let dialog = await screen.findByRole('alertdialog');
    const places = await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
    expect(items(places)).toEqual(['Arma DX']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Her yerde durdur' }));
    await within(dialog).findByText('durduruldu.', { exact: false });
    expect(sentTo(api.callsTo(switchKey))).toEqual([ARMADX.companyId]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kapat' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    // Open nowhere now: the dialog says so and offers nothing to confirm.
    await userEvent.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
    dialog = await screen.findByRole('alertdialog');
    expect(
      await within(dialog).findByText(
        'Bu ajan, kurucusu olduğunuz hiçbir yerde açık değil. Durdurulacak bir şey yok.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Her yerde durdur' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kapat' }));
    expect(api.callsTo(switchKey)).toHaveLength(1);
  });

  it('says which company could not be stopped, and tries that one again', async () => {
    wide();
    let pillikaFails = true;
    const { api, state } = twoCompanies({ arma: 'enabled', pillika: 'enabled' }, (call) => {
      if (call.headers.get(COMPANY_HEADER) === ARMADX.companyId) {
        state.arma = 'stopped';
        return stopped();
      }
      if (pillikaFails) return new Response('bad gateway', { status: 502 });
      state.pillika = 'stopped';
      return stopped();
    });
    renderApp('/c/armadx/office');
    await userEvent.click(await label('SOS-2'));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
    const dialog = await screen.findByRole('alertdialog');
    await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Her yerde durdur' }));
    const results = await within(dialog).findByRole('list', { name: 'Sonuç' });
    await waitFor(() => {
      expect(items(results)).toEqual([
        'Arma DX: durduruldu.',
        'Pillika: durdurulamadı. Sunucuda bir sorun oluştu. Biraz sonra yeniden deneyin.',
      ]);
    });
    // The company that was stopped stays stopped; the dialog stays, with a way to try again.
    expect(desk('SOS-2')).toHaveAttribute('data-state', 'stopped');
    pillikaFails = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => {
      expect(items(results)).toEqual(['Arma DX: durduruldu.', 'Pillika: durduruldu.']);
    });
    // Only the company that failed was asked again.
    expect(sentTo(api.callsTo(switchKey))).toEqual([
      ARMADX.companyId,
      PILLIKA.companyId,
      PILLIKA.companyId,
    ]);
    expect(within(dialog).queryByRole('button', { name: 'Yeniden dene' })).toBeNull();
  });

  // Pillika's switch cannot be read, so the stop is sent there too and the server decides. Only an
  // agent this request stopped is told as stopped by it.
  it.each([
    ['was not open', null, 'Pillika: açık değildi, bir şey değişmedi.'],
    ['was closed', 'disabled', 'Pillika: açık değildi, bir şey değişmedi.'],
    ['was already stopped', 'stopped', 'Pillika: zaten durdurulmuş, bir şey değişmedi.'],
  ] as const)(
    'tells a company whose switch could not be read, and says what the stop found there: the agent %s',
    async (_what, status, row) => {
      wide();
      const api = mockApi({
        'GET /session': sessionHandler({ memberships: [ARMADX, PILLIKA] }),
        'GET /office': (call) =>
          call.headers.get(COMPANY_HEADER) === PILLIKA.companyId
            ? new Response('bad gateway', { status: 502 })
            : json(officeBody(ARMADX_OFFICE, { 'SOS-2': 'enabled' })),
        [switchKey]: (call) =>
          call.headers.get(COMPANY_HEADER) === PILLIKA.companyId
            ? stopped(status, false)
            : stopped(),
      });
      renderApp('/c/armadx/office');
      await userEvent.click(await label('SOS-2'));
      await userEvent.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
      const dialog = await screen.findByRole('alertdialog');
      const places = await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
      expect(items(places)).toEqual([
        'Arma DX',
        'Pillika: durumu okunamadı; ajan orada açıksa durdurulur.',
      ]);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Her yerde durdur' }));
      const results = await within(dialog).findByRole('list', { name: 'Sonuç' });
      await waitFor(() => {
        expect(items(results)).toEqual(['Arma DX: durduruldu.', row]);
      });
      expect(api.callsTo(switchKey)).toHaveLength(2);
    },
  );

  it('names Kurucu alanı as it is and calls no place a company, while it reads, asks and answers', async () => {
    wide();
    const key = 'PUT /agents/KOR-4/switch';
    let space: CompanyAgentStatus = 'enabled';
    // Pillika's read for the dialog is held, so that the dialog is seen while it reads.
    let release: (() => void) | undefined;
    const api = mockApi({
      'GET /session': sessionHandler(),
      'GET /office': (call) => {
        switch (call.headers.get(COMPANY_HEADER)) {
          case FOUNDER_SPACE.companyId:
            return json(officeBody(FOUNDER_OFFICE, { 'KOR-4': space }));
          case PILLIKA.companyId:
            return new Promise<Response>((resolve) => {
              release = () => {
                resolve(json(officeBody(PILLIKA_OFFICE)));
              };
            });
          default:
            return json(officeBody(ARMADX_OFFICE));
        }
      },
      [key]: () => {
        space = 'stopped';
        return json({
          code: 'KOR-4',
          name: 'Yönetici Asistanı',
          status: 'stopped',
          ready: true,
          changed: true,
        });
      },
    });
    renderApp('/c/founder_space/office');
    await userEvent.click(await label('KOR-4'));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'KOR-4 her yerde durdurulsun mu?',
    });
    // While the switches are read: one sentence, nothing to confirm yet.
    expect(within(dialog).getByText('Ajanın nerede açık olduğu denetleniyor.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Vazgeç' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Her yerde durdur' })).toBeNull();
    expect(dialog.textContent).not.toMatch(/şirket/iu);
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    release?.();

    // The one place where the agent is open is not a company and is named as the menu names it.
    const places = await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
    expect(items(places)).toEqual(['Kurucu alanı']);
    expect(dialog.textContent).not.toMatch(/şirket/iu);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Her yerde durdur' }));
    const results = await within(dialog).findByRole('list', { name: 'Sonuç' });
    await waitFor(() => {
      expect(items(results)).toEqual(['Kurucu alanı: durduruldu.']);
    });
    expect(dialog.textContent).not.toMatch(/şirket/iu);
    expect(sentTo(api.callsTo(key))).toEqual([FOUNDER_SPACE.companyId]);
    expect(api.unexpected).toEqual([]);
  });

  it('reads nothing by itself under its open dialog: not on the timer, not on coming back to the tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wide();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { api } = twoCompanies({ arma: 'enabled', pillika: 'enabled' }, () => stopped());
      renderApp('/c/armadx/office');
      await user.click(await label('SOS-2'));
      await user.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'SOS-2 her yerde durdurulsun mu?',
      });
      await within(dialog).findByRole('list', { name: 'Durdurulacağı yerler' });
      // The page's own read and one read per company for the dialog.
      const before = api.callsTo('GET /office').length;
      expect(before).toBe(4);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(api.callsTo('GET /office')).toHaveLength(before);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(api.callsTo('GET /office')).toHaveLength(before);
      await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
      await vi.advanceTimersByTimeAsync(30_100);
      await waitFor(() => {
        expect(api.callsTo('GET /office')).toHaveLength(before + 1);
      });
      expect(api.callsTo('GET /office').at(-1)?.headers.get(BACKGROUND_HEADER)).not.toBeNull();
      expect(api.callsTo(switchKey)).toEqual([]);
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('keeps the title, the pressed button and the focus while a retry is on its way, and after it failed again', async () => {
    wide();
    let attempts = 0;
    // The answers of the retries that are on their way, held until the test gives them.
    const waiting: ((response: Response) => void)[] = [];
    const { api } = twoCompanies({ arma: 'enabled', pillika: 'enabled' }, (call) => {
      if (call.headers.get(COMPANY_HEADER) !== PILLIKA.companyId) return stopped();
      attempts += 1;
      if (attempts === 1) return new Response('bad gateway', { status: 502 });
      return new Promise<Response>((resolve) => {
        waiting.push(resolve);
      });
    });
    renderApp('/c/armadx/office');
    await userEvent.click(await label('SOS-2'));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Her yerde durdur' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Her yerde durdur' }));
    const retry = await within(dialog).findByRole('button', { name: 'Yeniden dene' });
    // Once something was sent the dialog is the result; the first confirmation is over.
    expect(screen.getByRole('alertdialog', { name: 'SOS-2 için sonuç' })).toBe(dialog);
    expect(within(dialog).queryByRole('button', { name: 'Her yerde durdur' })).toBeNull();

    await userEvent.click(retry);
    await waitFor(() => {
      expect(waiting).toHaveLength(1);
    });
    // On its way: the same button, busy, with the focus; the title is still the result and the
    // button of the first confirmation does not come back.
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toHaveFocus();
    expect(screen.getByRole('alertdialog', { name: 'SOS-2 için sonuç' })).toBe(dialog);
    expect(within(dialog).queryByRole('button', { name: 'Her yerde durdur' })).toBeNull();
    expect(items(within(dialog).getByRole('list', { name: 'Sonuç' }))).toEqual([
      'Arma DX: durduruldu.',
      'Pillika: durduruluyor.',
    ]);
    // Nothing closes the dialog while a company is being asked.
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(retry).toHaveFocus();

    // It failed again: the button is still there and keeps the focus, so Enter tries once more.
    waiting.shift()?.(new Response('bad gateway', { status: 502 }));
    await waitFor(() => {
      expect(retry).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(retry).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(waiting).toHaveLength(1);
    });
    // It worked: nothing is left to try and the focus goes to the button that closes.
    waiting.shift()?.(stopped());
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Kapat' })).toHaveFocus();
    });
    expect(retry).not.toBeInTheDocument();
    expect(sentTo(api.callsTo(switchKey))).toEqual([
      ARMADX.companyId,
      PILLIKA.companyId,
      PILLIKA.companyId,
      PILLIKA.companyId,
    ]);
    expect(api.unexpected).toEqual([]);
  });

  it('keeps the result of every place on screen when the office cannot be read again after the stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wide();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let serverGone = false;
      const { api, state, office } = twoCompanies(
        { arma: 'enabled', pillika: 'enabled' },
        (call) => {
          if (call.headers.get(COMPANY_HEADER) === ARMADX.companyId) {
            state.arma = 'stopped';
            // Arma DX was the last thing the server answered.
            serverGone = true;
            return stopped();
          }
          if (serverGone) return badGateway();
          state.pillika = 'stopped';
          return stopped();
        },
      );
      api.handle('GET /office', (call) => (serverGone ? badGateway() : office(call)));
      const { dialog } = await confirmStop(user);
      await waitFor(() => {
        expect(api.callsTo(switchKey)).toHaveLength(2);
      });
      // Long enough for the read of the office to give up (it is tried again three times).
      const readsBefore = api.callsTo('GET /office').length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(api.callsTo('GET /office').length).toBeGreaterThan(readsBefore);
      expect(state.pillika).toBe('enabled');
      // The dialog is the same one and says where the agent still runs, with a way to try again.
      expect(screen.getByRole('alertdialog', { name: 'SOS-2 için sonuç' })).toBe(dialog);
      expect(items(within(dialog).getByRole('list', { name: 'Sonuç' }))).toEqual([
        'Arma DX: durduruldu.',
        `Pillika: ${FAILED}`,
      ]);
      expect(buttons(dialog)).toEqual(['Kapat', 'Yeniden dene']);
      // The scene behind is the one last read, not an error page in its place.
      expect(desk('SOS-2')).toHaveAttribute('data-state', 'idle');

      // The server is back: only Pillika is asked again, and the office is read again.
      serverGone = false;
      await user.click(within(dialog).getByRole('button', { name: 'Yeniden dene' }));
      await waitFor(() => {
        expect(items(within(dialog).getByRole('list', { name: 'Sonuç' }))).toEqual([
          'Arma DX: durduruldu.',
          'Pillika: durduruldu.',
        ]);
      });
      expect(sentTo(api.callsTo(switchKey))).toEqual([
        ARMADX.companyId,
        PILLIKA.companyId,
        PILLIKA.companyId,
      ]);
      await user.click(within(dialog).getByRole('button', { name: 'Kapat' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
      // The office of Arma DX, whose first read after the stop failed, was read again as well.
      await waitFor(() => {
        expect(desk('SOS-2')).toHaveAttribute('data-state', 'stopped');
      });
      expect(api.unexpected).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the result as soon as every place answered, before the office is read again', async () => {
    wide();
    let hold = false;
    let release: (() => void) | undefined;
    const { api, state, office } = twoCompanies({ arma: 'enabled', pillika: 'enabled' }, (call) => {
      if (call.headers.get(COMPANY_HEADER) === ARMADX.companyId) {
        state.arma = 'stopped';
        return stopped();
      }
      // From the last answer on, the office does not answer until the test lets it.
      hold = true;
      return badGateway();
    });
    api.handle('GET /office', (call) =>
      hold
        ? new Promise<Response>((resolve) => {
            release = () => {
              resolve(office(call));
            };
          })
        : office(call),
    );
    const { dialog, results } = await confirmStop();
    await waitFor(() => {
      expect(items(results)).toEqual(['Arma DX: durduruldu.', `Pillika: ${FAILED}`]);
    });
    expect(buttons(dialog)).toEqual(['Kapat', 'Yeniden dene']);
    expect(within(dialog).getByRole('button', { name: 'Kapat' })).toHaveFocus();
    // The read of the office is still on its way: the desk behind shows what was last read.
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    expect(desk('SOS-2')).toHaveAttribute('data-state', 'idle');
    release?.();
    await waitFor(() => {
      expect(desk('SOS-2')).toHaveAttribute('data-state', 'stopped');
    });
    expect(buttons(dialog)).toEqual(['Kapat', 'Yeniden dene']);
  });

  it('says that a place could not be stopped as soon as it answered, while the next one is still asked', async () => {
    wide();
    let release: ((response: Response) => void) | undefined;
    twoCompanies({ arma: 'enabled', pillika: 'enabled' }, (call) => {
      if (call.headers.get(COMPANY_HEADER) === ARMADX.companyId) return badGateway();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const { dialog, results } = await confirmStop();
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    expect(items(results)).toEqual([`Arma DX: ${FAILED}`, 'Pillika: durduruluyor.']);
    // Still sending: nothing can be pressed yet.
    expect(buttons(dialog)).toEqual(['Kapat (busy)', 'Her yerde durdur (busy)']);
    release?.(stopped());
    await waitFor(() => {
      expect(items(results)).toEqual([`Arma DX: ${FAILED}`, 'Pillika: durduruldu.']);
    });
    expect(buttons(dialog)).toEqual(['Kapat', 'Yeniden dene']);
  });

  it('shows in a retry of several places each one as it answers', async () => {
    wide();
    let hold = false;
    let release: ((response: Response) => void) | undefined;
    const { api } = twoCompanies({ arma: 'enabled', pillika: 'enabled' }, (call) => {
      if (call.headers.get(COMPANY_HEADER) === ARMADX.companyId || !hold) return badGateway();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const { dialog, results } = await confirmStop();
    await waitFor(() => {
      expect(items(results)).toEqual([`Arma DX: ${FAILED}`, `Pillika: ${FAILED}`]);
    });
    hold = true;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    // Arma DX failed again and says so; Pillika, asked again, has not answered yet.
    expect(items(results)).toEqual([`Arma DX: ${FAILED}`, 'Pillika: durduruluyor.']);
    expect(buttons(dialog)).toEqual(['Kapat (busy)', 'Yeniden dene (busy)']);
    release?.(stopped());
    await waitFor(() => {
      expect(items(results)).toEqual([`Arma DX: ${FAILED}`, 'Pillika: durduruldu.']);
    });
    expect(buttons(dialog)).toEqual(['Kapat', 'Yeniden dene']);
    expect(sentTo(api.callsTo(switchKey))).toEqual([
      ARMADX.companyId,
      PILLIKA.companyId,
      ARMADX.companyId,
      PILLIKA.companyId,
    ]);
  });

  it.each([
    ['an employee of the company who is the founder of another', [EMPLOYEE, PILLIKA]],
    ['the founder of one company alone', [ARMADX]],
  ])('is not offered to %s', async (_who, memberships) => {
    wide();
    const api = mockApi({
      'GET /session': sessionHandler({ memberships }),
      'GET /office': () => json(officeBody(ARMADX_OFFICE, { 'SOS-2': 'enabled' })),
    });
    renderApp('/c/armadx/office');
    await userEvent.click(await label('SOS-2'));
    expect(within(panel()).getByText('Bu ajan açık ve boşta.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Her yerde durdur' })).toBeNull();
    expect(api.calls.filter((call) => call.method === 'PUT')).toEqual([]);
  });
});
