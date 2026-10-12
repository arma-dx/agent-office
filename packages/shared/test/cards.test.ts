import { describe, expect, it } from 'vitest';
import { apiErrorCodeSchema, companyAgentStatusSchema, officeResponseSchema } from '../src/api.ts';
import {
  RUNNER_PATH_TOOLS,
  agentCodeSchema,
  cardDefinitionSchema,
  cardSchema,
  catalogToolSchema,
  companyCodeSchema,
  storedCardSchema,
  toolNameSchema,
  toolsFileSchema,
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

describe('the names the runner keeps for its own paths', () => {
  // CLAUDE.md "İnsana sor": the asking tool is the runner's own. It is never a row of the catalog
  // and never on a card, so no card can send it through the gate of catalog tools (where a Y1
  // card's question would fall to the approval desk) and no card can open the path by naming it.
  const RESERVED = 'This name is reserved for the runner and cannot be a catalog tool';
  const card = {
    code: 'SOS-2',
    name: 'Sosyal İçerik Yazım Ajanı',
    unit: 'SOS',
    companies: ['armadx'],
    version: '1',
    status: 'active',
    owner: 'Kurucu',
    purpose: 'Sosyal medya gönderisi yazar',
    triggers: [{ type: 'handoff', description: 'Koordinasyon merkezinden gelen iş' }],
    inputs: [],
    outputs: ['Gönderi taslağı'],
    skills: [],
    tools: ['submit_for_approval'],
    knowledge_sources: [],
    authority: { level: 'Y1', target: 'Y1' },
    approval_points: [],
    escalation: [],
    prohibitions: [],
    model: 'some-model',
    limits: { tool_calls: 20, duration_minutes: 10 },
    metrics: [],
  };
  const row = { name: 'submit_for_approval', kind: 'draft', description: 'Sonucu onaya sunar' };
  const stored = {
    card,
    tools: [row],
    model: {
      id: 'some-model',
      max_tokens: 4096,
      thinking: 'none',
      effort: null,
      prices: { input: 1, output: 5, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1 },
    },
    rules: { sha256: 'a'.repeat(64), body: 'Ortak kurallar' },
    skills: [],
  };
  const messages = (result: { error?: { issues: { message: string }[] } }): string[] =>
    (result.error?.issues ?? []).map((issue) => issue.message);

  it('the runner’s own tool name is refused on a card, in the catalog and in a stored version', () => {
    expect(RUNNER_PATH_TOOLS).toEqual(['ask_requester']);
    expect(messages(toolNameSchema.safeParse('ask_requester'))).toEqual([RESERVED]);

    // The samples are valid as they stand: only the name makes the difference below.
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(toolsFileSchema.safeParse({ tools: [row] }).success).toBe(true);
    expect(storedCardSchema.safeParse(stored).success).toBe(true);

    // On a card.
    const named = cardSchema.safeParse({
      ...card,
      tools: ['submit_for_approval', 'ask_requester'],
    });
    expect(messages(named)).toEqual([RESERVED]);
    expect(named.error?.issues[0]?.path).toEqual(['tools', 1]);
    // In the catalog.
    const asked = { ...row, name: 'ask_requester' };
    expect(messages(catalogToolSchema.safeParse(asked))).toEqual([RESERVED]);
    expect(messages(toolsFileSchema.safeParse({ tools: [row, asked] }))).toEqual([RESERVED]);
    // In a stored version, by its card or by its catalog rows: the runner parses with this schema.
    expect(
      messages(
        storedCardSchema.safeParse({ ...stored, card: { ...card, tools: ['ask_requester'] } }),
      ),
    ).toEqual([RESERVED]);
    expect(messages(storedCardSchema.safeParse({ ...stored, tools: [row, asked] }))).toEqual([
      RESERVED,
    ]);
  });

  it('every other tool name is read as before', () => {
    for (const name of ['route_task', 'submit_for_approval', 'ask_owner', 'ask_requester_again']) {
      expect(toolNameSchema.safeParse(name).success, name).toBe(true);
    }
    for (const name of ['Ask_requester', 'ask-requester', 'ask requester', '1tool', '']) {
      expect(toolNameSchema.safeParse(name).success, name).toBe(false);
    }
  });
});
