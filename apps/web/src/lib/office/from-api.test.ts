import type { OfficeResponse } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { toOfficeUnits } from './from-api.ts';
import { NO_WORK } from './model.ts';

const REQUEST = '00000000-0000-4000-8000-000000000001';

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
  work: [],
  workTruncated: false,
};

describe('toOfficeUnits', () => {
  it('maps the switch of every agent to its state', () => {
    const states = toOfficeUnits(RESPONSE).flatMap((unit) =>
      unit.agents.map((agent) => [agent.code, agent.state]),
    );
    expect(states).toEqual([
      ['KOR-10', 'idle'],
      ['KOR-2', 'closed'],
      ['A-KES-2', 'closed'],
      ['HAF-1', 'stopped'],
    ]);
  });

  it('keeps the order the API gives: no sorting of units or agents, and no unit is dropped', () => {
    const office = toOfficeUnits(RESPONSE);
    expect(office.map((unit) => unit.code)).toEqual(['KOR', 'A-KES', 'HAF']);
    expect(office[0]?.agents.map((agent) => agent.code)).toEqual(['KOR-10', 'KOR-2']);
    expect(toOfficeUnits({ units: [], work: [], workTruncated: false })).toEqual([]);
  });

  it('keeps the agents of a unit together, with the names as the cards write them', () => {
    expect(toOfficeUnits(RESPONSE)[1]).toEqual({
      code: 'A-KES',
      name: 'Keşif ve Dönüşüm Danışmanlığı',
      agents: [
        {
          code: 'A-KES-2',
          name: 'Süreç Analizi Ajanı',
          state: 'closed',
          ready: true,
          work: NO_WORK,
        },
      ],
    });
    // Nothing but code, name, state, whether the card can run and the counts reaches the drawing.
    expect(Object.keys(toOfficeUnits(RESPONSE)[0]?.agents[0] ?? {})).toEqual([
      'code',
      'name',
      'state',
      'ready',
      'work',
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

  it('gives each agent its counts and the state they say; an agent the answer does not list has none', () => {
    const one = { count: 1, requestId: REQUEST };
    const none = { count: 0, requestId: null };
    const office = toOfficeUnits({
      ...RESPONSE,
      work: [
        { agentCode: 'KOR-10', running: one, awaitingApproval: none, failed: none },
        // The switch comes first: a stopped agent stays "Durduruldu" and keeps its numbers.
        { agentCode: 'HAF-1', running: none, awaitingApproval: one, failed: none },
        // Work of an agent that has no desk here is not shown anywhere.
        { agentCode: 'XYZ-1', running: one, awaitingApproval: none, failed: none },
      ],
    });
    const agents = office.flatMap((unit) => unit.agents);
    expect(agents.map((agent) => [agent.code, agent.state])).toEqual([
      ['KOR-10', 'running'],
      ['KOR-2', 'closed'],
      ['A-KES-2', 'closed'],
      ['HAF-1', 'stopped'],
    ]);
    expect(agents[0]?.work).toEqual({ running: one, awaitingApproval: none, failed: none });
    expect(agents[3]?.work.awaitingApproval).toEqual(one);
    // One object for every agent without work, so that equal data stays equal across refreshes.
    expect(agents[1]?.work).toBe(NO_WORK);
    expect(agents[2]?.work).toBe(NO_WORK);
  });
});
