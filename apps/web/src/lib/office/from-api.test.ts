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
        { code: 'KOR-10', name: 'Onuncu Ajan', status: 'enabled', ready: true },
        { code: 'KOR-2', name: 'Görev Takip Ajanı', status: null, ready: false },
      ],
    },
    {
      code: 'A-KES',
      name: 'Keşif ve Dönüşüm Danışmanlığı',
      agents: [{ code: 'A-KES-2', name: 'Süreç Analizi Ajanı', status: 'disabled', ready: true }],
    },
    {
      code: 'HAF',
      name: 'Kurumsal Hafıza',
      agents: [{ code: 'HAF-1', name: 'Bilgi Tabanı Ajanı', status: 'stopped', ready: true }],
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
      agents: [{ code: 'A-KES-2', name: 'Süreç Analizi Ajanı', state: 'closed', ready: true }],
    });
    // Nothing but code, name, state and whether the card can run reaches the drawing.
    expect(Object.keys(toOfficeUnits(RESPONSE)[0]?.agents[0] ?? {})).toEqual([
      'code',
      'name',
      'state',
      'ready',
    ]);
  });

  it('carries whether the card of each agent has a version to run with', () => {
    const ready = toOfficeUnits(RESPONSE).flatMap((unit) =>
      unit.agents.map((agent) => [agent.code, agent.ready]),
    );
    expect(ready).toEqual([
      ['KOR-10', true],
      ['KOR-2', false],
      ['A-KES-2', true],
      ['HAF-1', true],
    ]);
  });
});
