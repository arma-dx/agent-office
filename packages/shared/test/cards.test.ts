import { describe, expect, it } from 'vitest';
import { apiErrorCodeSchema, companyAgentStatusSchema, officeResponseSchema } from '../src/api.ts';
import {
  agentCodeSchema,
  cardDefinitionSchema,
  companyCodeSchema,
  unitCodeSchema,
  unitsFileSchema,
} from '../src/cards.ts';

// This package has no Node types and cannot read the agents/ folder, so the codes are written out
// here. The repository's own files are checked by the definitions test of packages/db.

describe('code patterns', () => {
  it('accepts the agent codes of the cards', () => {
    for (const code of ['KOR-1', 'A-KES-2', 'P-IST-1', 'KOR-10', 'HAF-2', 'TAS-6']) {
      expect(agentCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('refuses an agent code in lower case, without a number or with a four-letter prefix', () => {
    for (const code of ['kor-1', 'KOR', 'KOR-', 'A-KES', 'KORD-1', 'KOR-1a', 'KOR 1', '']) {
      expect(agentCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });

  it('accepts the unit codes of the catalog', () => {
    for (const code of ['KOR', 'IK', 'BT', 'A-KES', 'P-IST', 'A-AI']) {
      expect(unitCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('refuses a unit code in lower case, with a number or with a four-letter prefix', () => {
    for (const code of ['kor', 'KOR-1', 'KORD', 'A-K', 'A-KESIF', 'A_KES', '']) {
      expect(unitCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });

  it('accepts the company codes and refuses upper case, a leading digit and a hyphen', () => {
    for (const code of ['armadx', 'pillika', 'founder_space', 'other2']) {
      expect(companyCodeSchema.safeParse(code).success, code).toBe(true);
    }
    for (const code of ['Armadx', '2armadx', 'arma-dx', 'arma dx', '']) {
      expect(companyCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });
});

describe('unitsFileSchema', () => {
  const unit = { code: 'KOR', name: 'Koordinasyon Katmanı', pilot_enabled: true };

  it('accepts a shared unit and a unit of one company', () => {
    const parsed = unitsFileSchema.parse({
      units: [unit, { code: 'A-KES', name: 'Keşif', company: 'armadx', pilot_enabled: false }],
    });
    expect(parsed.units.map((u) => u.company)).toEqual([undefined, 'armadx']);
  });

  it('refuses an unknown key, on a unit and on the file', () => {
    expect(unitsFileSchema.safeParse({ units: [{ ...unit, owner: 'founder' }] }).success).toBe(
      false,
    );
    expect(unitsFileSchema.safeParse({ units: [unit], version: 1 }).success).toBe(false);
  });

  it('refuses an empty list, an empty name and a missing pilot_enabled', () => {
    expect(unitsFileSchema.safeParse({ units: [] }).success).toBe(false);
    expect(unitsFileSchema.safeParse({ units: [{ ...unit, name: '  ' }] }).success).toBe(false);
    expect(unitsFileSchema.safeParse({ units: [{ code: 'KOR', name: 'K' }] }).success).toBe(false);
  });
});

describe('cardDefinitionSchema', () => {
  const card = { code: 'KOR-1', name: 'Ofis Koordinatörü', unit: 'KOR', companies: ['armadx'] };

  it('lets the other fields of a card through', () => {
    const parsed = cardDefinitionSchema.parse({ ...card, status: 'draft', tools: ['read_task'] });
    expect(parsed).toMatchObject({ ...card, status: 'draft', tools: ['read_task'] });
  });

  it('refuses a card without a company, with a bad code or with a bad unit', () => {
    expect(cardDefinitionSchema.safeParse({ ...card, companies: [] }).success).toBe(false);
    expect(cardDefinitionSchema.safeParse({ ...card, companies: ['Arma DX'] }).success).toBe(false);
    expect(cardDefinitionSchema.safeParse({ ...card, code: 'KOR' }).success).toBe(false);
    expect(cardDefinitionSchema.safeParse({ ...card, unit: 'KOR-1' }).success).toBe(false);
    expect(cardDefinitionSchema.safeParse({ ...card, name: '' }).success).toBe(false);
  });
});

describe('office contract', () => {
  const agent = { code: 'KOR-1', name: 'Ofis Koordinatörü', status: null, ready: true };
  // No open request is counted in these answers; the counts have tests of their own (office.test.ts).
  const NO_WORK = { work: [], workTruncated: false };

  it('accepts units with agents, with and without a switch', () => {
    const parsed = officeResponseSchema.parse({
      ...NO_WORK,
      units: [
        {
          code: 'KOR',
          name: 'Koordinasyon Katmanı',
          agents: [
            agent,
            { code: 'KOR-2', name: 'Görev Takip Ajanı', status: 'stopped', ready: false },
          ],
        },
      ],
    });
    expect(parsed.units[0]?.agents.map((a) => a.status)).toEqual([null, 'stopped']);
    expect(parsed.units[0]?.agents.map((a) => a.ready)).toEqual([true, false]);
    expect(officeResponseSchema.parse({ units: [], ...NO_WORK })).toEqual({
      units: [],
      ...NO_WORK,
    });
  });

  it('refuses a unit without agents', () => {
    expect(
      officeResponseSchema.safeParse({
        units: [{ code: 'KOR', name: 'K', agents: [] }],
        ...NO_WORK,
      }).success,
    ).toBe(false);
  });

  it('refuses an unknown status, a missing status and an agent that does not say whether it can run', () => {
    const unit = (agents: unknown[]) => ({
      units: [{ code: 'KOR', name: 'K', agents }],
      ...NO_WORK,
    });
    expect(officeResponseSchema.safeParse(unit([agent])).success).toBe(true);
    expect(officeResponseSchema.safeParse(unit([{ ...agent, status: 'running' }])).success).toBe(
      false,
    );
    expect(
      officeResponseSchema.safeParse(
        unit([{ code: 'KOR-1', name: 'Ofis Koordinatörü', ready: true }]),
      ).success,
    ).toBe(false);
    expect(
      officeResponseSchema.safeParse(
        unit([{ code: 'KOR-1', name: 'Ofis Koordinatörü', status: null }]),
      ).success,
    ).toBe(false);
  });

  it('knows the three values of the company switch', () => {
    expect(companyAgentStatusSchema.options).toEqual(['disabled', 'enabled', 'stopped']);
  });

  it('has an error code for a screen that is closed to external persons', () => {
    expect(apiErrorCodeSchema.safeParse('insiders_only').success).toBe(true);
  });
});
