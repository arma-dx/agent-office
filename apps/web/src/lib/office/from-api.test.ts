import type { OfficeResponse } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { toOfficeUnits } from './from-api.ts';

// Deliberately not in code order: the API's order is what counts.
const RESPONSE: OfficeResponse = {
  units: [
    {
      code: 'KOR',
      name: 'Koordinasyon Katmanı',
      agents: [
        { code: 'KOR-10', name: 'Onuncu Ajan', status: 'enabled' },
        { code: 'KOR-2', name: 'Görev Takip Ajanı', status: null },
      ],
    },
    {
      code: 'A-KES',
      name: 'Keşif ve Dönüşüm Danışmanlığı',
      agents: [{ code: 'A-KES-2', name: 'Süreç Analizi Ajanı', status: 'disabled' }],
    },
    {
      code: 'HAF',
      name: 'Kurumsal Hafıza',
      agents: [{ code: 'HAF-1', name: 'Bilgi Tabanı Ajanı', status: 'stopped' }],
    },
  ],
};

describe('toOfficeUnits', () => {
  it('maps the switch of every agent to its state', () => {
    const states = toOfficeUnits(RESPONSE).flatMap((unit) =>
      unit.agents.map((agent) => [agent.code, agent.state]),
    );
    expect(states).toEqual([
      ['KOR-10', 'enabled'],
      ['KOR-2', 'closed'],
      ['A-KES-2', 'closed'],
      ['HAF-1', 'stopped'],
    ]);
  });

  it('keeps the order the API gives: no sorting of units or agents, and no unit is dropped', () => {
    const office = toOfficeUnits(RESPONSE);
    expect(office.map((unit) => unit.code)).toEqual(['KOR', 'A-KES', 'HAF']);
    expect(office[0]?.agents.map((agent) => agent.code)).toEqual(['KOR-10', 'KOR-2']);
    expect(toOfficeUnits({ units: [] })).toEqual([]);
  });

  it('keeps the agents of a unit together, with the names as the cards write them', () => {
    expect(toOfficeUnits(RESPONSE)[1]).toEqual({
      code: 'A-KES',
      name: 'Keşif ve Dönüşüm Danışmanlığı',
      agents: [{ code: 'A-KES-2', name: 'Süreç Analizi Ajanı', state: 'closed' }],
    });
    // Nothing but code, name and state reaches the drawing.
    expect(Object.keys(toOfficeUnits(RESPONSE)[0]?.agents[0] ?? {})).toEqual([
      'code',
      'name',
      'state',
    ]);
  });
});
