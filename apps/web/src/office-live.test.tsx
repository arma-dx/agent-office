import { type CompanyAgentStatus, type OfficeResponse } from '@agent-office/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { OfficeUnit } from './lib/office/model.ts';
import { WIDE_WINDOW_QUERY } from './lib/office/use-wide-window.ts';
import { stubMatchMedia } from './test/match-media.ts';
import { json, mockApi, sessionHandler } from './test/mock-api.ts';
import { ARMADX_OFFICE } from './test/office-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

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
});
