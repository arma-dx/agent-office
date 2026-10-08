import {
  BACKGROUND_HEADER,
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
import { apiError, ARMADX, json, mockApi, sessionHandler } from './test/mock-api.ts';
import { ARMADX_OFFICE, FOUNDER_OFFICE } from './test/office-fixtures.ts';
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
