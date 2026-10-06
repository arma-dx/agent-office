import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { agentCodeSchema, companyCodeSchema, unitCodeSchema } from '@agent-office/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalAddressError, localAdminUrl } from '../scripts/local-admin.ts';
import {
  DefinitionsError,
  parseDefinitions,
  readDefinitionFiles,
  syncDefinitions,
  type DefinitionFiles,
  type Definitions,
} from '../src/definitions.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  closePools,
  inAdminTransaction,
  inTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';

// The definitions sync writes which units and agents exist from the files under agents/
// (6 October decision 8). The part without a database is what fails the checks when a card or the
// unit list is broken.

const AGENTS_DIR = new URL('../../../agents/', import.meta.url);

function failure(fn: () => unknown): DefinitionsError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DefinitionsError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the definitions to be refused');
}

describe("the repository's own definitions", () => {
  it('parse, and every card file becomes one agent of a listed unit', async () => {
    const files = await readDefinitionFiles(AGENTS_DIR);
    const definitions = parseDefinitions(files);

    // No fixed count: a card or a unit added by pull request must not break this test.
    const cardFiles = (await readdir(AGENTS_DIR)).filter(
      (name) => name.endsWith('.yaml') && name !== 'units.yaml' && name !== 'tools.yaml',
    );
    expect(cardFiles.length).toBeGreaterThan(0);
    expect(definitions.agents.map((agent) => `${agent.code}.yaml`).sort()).toEqual(
      cardFiles.sort(),
    );

    const unitCodes = new Set(definitions.units.map((unit) => unit.code));
    expect(unitCodes.size).toBe(definitions.units.length);
    for (const unit of definitions.units) {
      expect(unitCodeSchema.safeParse(unit.code).success, unit.code).toBe(true);
      if (unit.companyCode !== null) {
        expect(companyCodeSchema.safeParse(unit.companyCode).success, unit.code).toBe(true);
      }
    }
    for (const agent of definitions.agents) {
      expect(agentCodeSchema.safeParse(agent.code).success, agent.code).toBe(true);
      expect(unitCodes.has(agent.unitCode), agent.code).toBe(true);
      expect(agent.companyCodes.length, agent.code).toBeGreaterThan(0);
    }
  });

  it('does not read the tool catalog as a card', async () => {
    const files = await readDefinitionFiles(AGENTS_DIR);
    expect(files.cards.map((card) => card.file)).not.toContain('tools.yaml');
    expect(files.cards.map((card) => card.file)).not.toContain('units.yaml');
  });
});

describe('readDefinitionFiles', () => {
  it('reads a card saved as .yml, so that the file name check can refuse it', async () => {
    // A reader that took .yaml only would skip the file, and the card would never be checked.
    const dir = await mkdtemp(join(tmpdir(), 'definitions-'));
    try {
      await writeFile(join(dir, 'units.yaml'), 'units: []\n');
      await writeFile(join(dir, 'tools.yaml'), 'tools: []\n');
      await writeFile(join(dir, 'KOR-1.yml'), 'code: KOR-1\n');
      await writeFile(join(dir, 'KOR-2.yaml'), 'code: KOR-2\n');
      await writeFile(join(dir, 'README.md'), 'not a card\n');
      const files = await readDefinitionFiles(pathToFileURL(`${dir}/`));
      expect(files.cards).toEqual([
        { file: 'KOR-1.yml', content: { code: 'KOR-1' } },
        { file: 'KOR-2.yaml', content: { code: 'KOR-2' } },
      ]);
      expect(files.units).toEqual({ units: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseDefinitions', () => {
  const units = {
    units: [
      { code: 'KOR', name: 'Koordinasyon Katmanı', pilot_enabled: true },
      { code: 'A-KES', name: 'Keşif', company: 'armadx', pilot_enabled: true },
    ],
  };
  const kor1 = { code: 'KOR-1', name: 'Ofis Koordinatörü', unit: 'KOR', companies: ['armadx'] };
  const kes2 = { code: 'A-KES-2', name: 'Süreç Analizi', unit: 'A-KES', companies: ['armadx'] };

  function files(cards: Record<string, unknown>, unitList: unknown = units): DefinitionFiles {
    return {
      units: unitList,
      cards: Object.entries(cards).map(([file, content]) => ({ file, content })),
    };
  }

  it('turns the files into units and agents and keeps the other fields of a card out', () => {
    const parsed = parseDefinitions(
      files({
        'KOR-1.yaml': { ...kor1, status: 'draft', tools: ['read_task'] },
        'A-KES-2.yaml': kes2,
      }),
    );
    expect(parsed).toEqual({
      units: [
        { code: 'KOR', name: 'Koordinasyon Katmanı', companyCode: null, pilotEnabled: true },
        { code: 'A-KES', name: 'Keşif', companyCode: 'armadx', pilotEnabled: true },
      ],
      agents: [
        { code: 'KOR-1', name: 'Ofis Koordinatörü', unitCode: 'KOR', companyCodes: ['armadx'] },
        { code: 'A-KES-2', name: 'Süreç Analizi', unitCode: 'A-KES', companyCodes: ['armadx'] },
      ],
    });
  });

  it('refuses a file that does not have the shape, naming the file and the field', () => {
    const error = failure(() =>
      parseDefinitions(
        files(
          { 'KOR-1.yaml': { ...kor1, companies: [] }, 'KOR-2.yaml': null },
          { units: [{ code: 'kor', name: 'K', pilot_enabled: true, owner: 'founder' }] },
        ),
      ),
    );
    expect(error.code).toBe('invalid_files');
    expect(error.problems.some((p) => p.startsWith('units.yaml: units.0.code: '))).toBe(true);
    expect(error.problems.some((p) => p.startsWith('units.yaml: units.0: '))).toBe(true);
    expect(error.problems.some((p) => p.startsWith('KOR-1.yaml: companies: '))).toBe(true);
    expect(error.problems.some((p) => p.startsWith('KOR-2.yaml: '))).toBe(true);
  });

  it('check 1: refuses a repeated unit code, a repeated agent code and a repeated company', () => {
    const error = failure(() =>
      parseDefinitions(
        files(
          {
            'KOR-1.yaml': { ...kor1, companies: ['armadx', 'pillika', 'armadx'] },
            'KOR-1-copy.yaml': kor1,
          },
          { units: [...units.units, units.units[0]] },
        ),
      ),
    );
    expect(error.problems).toContain('units.yaml: code: KOR is the code of more than one unit');
    expect(error.problems).toContain('KOR-1.yaml: companies: a company is named more than once');
    expect(error.problems).toContain(
      'KOR-1-copy.yaml: code: KOR-1 is already the code of KOR-1.yaml',
    );
  });

  it('check 2: refuses a card whose file is not named after its code', () => {
    const error = failure(() => parseDefinitions(files({ 'koordinator.yaml': kor1 })));
    expect(error.problems).toEqual([
      'koordinator.yaml: code: the card of KOR-1 must be the file KOR-1.yaml',
    ]);
    // A card saved with the other YAML extension is read, so that it is refused and not skipped.
    expect(failure(() => parseDefinitions(files({ 'KOR-1.yml': kor1 }))).problems).toEqual([
      'KOR-1.yml: code: the card of KOR-1 must be the file KOR-1.yaml',
    ]);
  });

  it('check 3: refuses a unit that is not listed and a code that does not start with its unit', () => {
    const error = failure(() =>
      parseDefinitions(
        files({
          'OFY-1.yaml': { ...kor1, code: 'OFY-1', unit: 'OFY' },
          'KOR-2.yaml': { ...kes2, code: 'KOR-2' },
        }),
      ),
    );
    expect(error.problems).toEqual([
      'OFY-1.yaml: unit: OFY is not a unit of units.yaml',
      'KOR-2.yaml: code: must be the unit code A-KES, a hyphen and a number',
    ]);
  });

  it('check 4: a card of a unit that belongs to one company names exactly that company', () => {
    const message =
      'A-KES-2.yaml: companies: unit A-KES belongs to armadx; the card must name exactly that company';
    for (const companies of [['pillika'], ['armadx', 'pillika']]) {
      const error = failure(() =>
        parseDefinitions(files({ 'A-KES-2.yaml': { ...kes2, companies } })),
      );
      expect(error.problems).toEqual([message]);
    }
  });

  it('collects every failure before it throws', () => {
    const error = failure(() =>
      parseDefinitions(
        files({
          'x.yaml': { ...kor1, companies: ['armadx', 'armadx'] },
          'A-KES-2.yaml': { ...kes2, companies: ['pillika'] },
        }),
      ),
    );
    expect(error.problems).toHaveLength(3);
  });
});

describe('localAdminUrl', () => {
  const LOCAL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const REMOTE = 'postgresql://postgres:password@db.project.example.test:5432/postgres';

  function refusal(env: Record<string, string>): string {
    try {
      localAdminUrl(env);
    } catch (error) {
      expect(error).toBeInstanceOf(LocalAddressError);
      return error instanceof Error ? error.message : '';
    }
    throw new Error('Expected the address to be refused');
  }

  it('is the local Supabase default without any variable', () => {
    expect(localAdminUrl({})).toBe(LOCAL_DEFAULT);
    expect(localAdminUrl({ TEST_DATABASE_URL: '', DATABASE_URL: '' })).toBe(LOCAL_DEFAULT);
  });

  it('takes the server from TEST_DATABASE_URL', () => {
    expect(
      localAdminUrl({ TEST_DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres' }),
    ).toBe('postgresql://postgres@localhost:5432/postgres');
    expect(localAdminUrl({ TEST_DATABASE_URL: 'postgresql://postgres@[::1]:5432/postgres' })).toBe(
      'postgresql://postgres@[::1]:5432/postgres',
    );
  });

  it('takes the database name, and nothing else, from DATABASE_URL', () => {
    expect(
      localAdminUrl({ DATABASE_URL: 'postgresql://office_api:password@localhost:6543/office_dev' }),
    ).toBe('postgresql://postgres:postgres@127.0.0.1:54322/office_dev');
  });

  it('refuses a remote host in TEST_DATABASE_URL, naming the variable and never the address', () => {
    const message = refusal({ TEST_DATABASE_URL: REMOTE });
    expect(message).toContain('TEST_DATABASE_URL');
    expect(message).not.toContain('example');
    expect(message).not.toContain('password');
    expect(message).not.toContain('postgres');
  });

  it('refuses a remote host in DATABASE_URL, naming the variable and never the address', () => {
    const message = refusal({
      DATABASE_URL: 'postgresql://office_api:password@db.project.example.test:5432/postgres',
    });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('TEST_DATABASE_URL');
    expect(message).not.toContain('example');
    expect(message).not.toContain('password');
  });

  it('refuses a local address that names another host in its query', () => {
    // node-postgres lets a host parameter replace the host of the address.
    for (const parameter of ['host', 'hostaddr']) {
      const message = refusal({
        TEST_DATABASE_URL: `postgresql://postgres@127.0.0.1:5432/postgres?${parameter}=db.project.example.test`,
      });
      expect(message).toContain('TEST_DATABASE_URL');
      expect(message).not.toContain('example');
    }
  });

  it('refuses a socket path, a look-alike host and an address that cannot be parsed', () => {
    for (const value of [
      '/var/run/postgresql postgres',
      'postgresql://postgres@127.0.0.1.example.test:5432/postgres',
      'postgresql://127.0.0.1:5432@db.project.example.test/postgres',
      'postgresql://postgres@LOCALHOST.example.test/postgres',
      'not an address',
    ]) {
      const message = refusal({ TEST_DATABASE_URL: value });
      expect(message, value).toContain('TEST_DATABASE_URL');
      expect(message, value).not.toContain('example');
    }
  });
});

interface UnitRow {
  code: string;
  name: string;
  company_code: string | null;
  pilot_enabled: boolean;
}

interface AgentRow {
  code: string;
  name: string;
  unit_code: string;
  company_codes: string[];
}

/** The definitions the database holds: synced as they are, nothing changes. */
async function fromDatabase(tx: Tx): Promise<Definitions> {
  const units = await tx.rows<UnitRow>(
    'select code, name, company_code, pilot_enabled from office.units order by code',
  );
  const agents = await tx.rows<AgentRow>(
    'select code, name, unit_code, company_codes from office.agent_definitions order by code',
  );
  return {
    units: units.map((unit) => ({
      code: unit.code,
      name: unit.name,
      companyCode: unit.company_code,
      pilotEnabled: unit.pilot_enabled,
    })),
    agents: agents.map((agent) => ({
      code: agent.code,
      name: agent.name,
      unitCode: agent.unit_code,
      companyCodes: agent.company_codes,
    })),
  };
}

interface Snapshot {
  units: UnitRow[];
  agents: AgentRow[];
  versions: number;
  tools: number;
  companyAgents: number;
  agentsWithVersion: number;
}

async function snapshot(tx: Tx): Promise<Snapshot> {
  return {
    units: await tx.rows<UnitRow>(
      'select code, name, company_code, pilot_enabled from office.units order by code',
    ),
    agents: await tx.rows<AgentRow>(
      'select code, name, unit_code, company_codes from office.agent_definitions order by code',
    ),
    versions: await tx.count('card_versions'),
    tools: await tx.count('tools'),
    companyAgents: await tx.count('company_agents'),
    agentsWithVersion: await tx.count('agent_definitions', 'current_version_id is not null'),
  };
}

async function refusedSync(
  tx: Tx,
  definitions: Definitions,
  options?: Parameters<typeof syncDefinitions>[2],
): Promise<DefinitionsError> {
  try {
    await syncDefinitions(tx.client, definitions, options);
  } catch (error) {
    if (error instanceof DefinitionsError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the sync to be refused');
}

const NEW_UNIT = {
  code: 'OFY',
  name: 'Ofis Yönetimi ve Denetim',
  companyCode: null,
  pilotEnabled: false,
};
const NEW_AGENT = {
  code: 'KOR-2',
  name: 'Görev Takip Ajanı',
  unitCode: 'KOR',
  companyCodes: ['armadx', 'pillika'],
};

function rename(definitions: Definitions, code: string, name: string): void {
  const agent = definitions.agents.find((a) => a.code === code);
  if (!agent) {
    throw new Error(`The fixtures have no agent ${code}`);
  }
  agent.name = name;
}

describe.skipIf(noDatabase)('syncDefinitions with the migration role', () => {
  afterAll(closePools);

  it('writes nothing when the input is what the database holds', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      const report = await syncDefinitions(tx.client, input);
      expect(report).toEqual({
        units: { inserted: 0, updated: 0, unchanged: input.units.length },
        agents: { inserted: 0, updated: 0, unchanged: input.agents.length },
        orphanUnits: [],
        orphanAgents: [],
      });
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('inserts new rows, updates changed ones, and a second run writes nothing', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      input.units.push(NEW_UNIT);
      input.agents.push(NEW_AGENT);
      rename(input, 'HAF-1', 'Bilgi Tabanı Ajanı');
      const kes = input.units.find((unit) => unit.code === 'A-KES');
      if (kes) {
        kes.pilotEnabled = !kes.pilotEnabled;
      }

      const first = await syncDefinitions(tx.client, input);
      expect(first.units).toEqual({ inserted: 1, updated: 1, unchanged: input.units.length - 2 });
      expect(first.agents).toEqual({ inserted: 1, updated: 1, unchanged: input.agents.length - 2 });
      expect(first.orphanUnits).toEqual([]);
      expect(first.orphanAgents).toEqual([]);

      const after = await snapshot(tx);
      expect(after.units).toHaveLength(before.units.length + 1);
      expect(after.agents).toHaveLength(before.agents.length + 1);
      expect(after.agents.find((agent) => agent.code === 'HAF-1')?.name).toBe('Bilgi Tabanı Ajanı');
      expect(after.agents.find((agent) => agent.code === 'KOR-2')).toEqual({
        code: 'KOR-2',
        name: 'Görev Takip Ajanı',
        unit_code: 'KOR',
        company_codes: ['armadx', 'pillika'],
      });
      expect(after.units.find((unit) => unit.code === 'OFY')).toEqual({
        code: 'OFY',
        name: 'Ofis Yönetimi ve Denetim',
        company_code: null,
        pilot_enabled: false,
      });
      // It writes the two tables and nothing else: no card version, no tool, no switch.
      expect(after.versions).toBe(before.versions);
      expect(after.tools).toBe(before.tools);
      expect(after.companyAgents).toBe(before.companyAgents);
      expect(after.agentsWithVersion).toBe(before.agentsWithVersion);

      const second = await syncDefinitions(tx.client, input);
      expect(second.units).toEqual({ inserted: 0, updated: 0, unchanged: input.units.length });
      expect(second.agents).toEqual({ inserted: 0, updated: 0, unchanged: input.agents.length });
      expect(await snapshot(tx)).toEqual(after);
    });
  });

  it('writes every field of a changed row: companies and unit of an agent, name and company of a unit', async () => {
    await inAdminTransaction(async (tx) => {
      const input = await fromDatabase(tx);
      const kor4 = input.agents.find((agent) => agent.code === 'KOR-4');
      const pist = input.agents.find((agent) => agent.code === 'P-IST-1');
      const haf = input.units.find((unit) => unit.code === 'HAF');
      const kes = input.units.find((unit) => unit.code === 'A-KES');
      if (!kor4 || !pist || !haf || !kes) {
        throw new Error('The fixtures have no KOR-4, P-IST-1, HAF or A-KES');
      }
      // Each field on a row of its own, so that no other change carries it. The company list
      // decides in whose office an agent shows and which company may open it.
      kor4.companyCodes = ['founder_space', 'armadx'];
      pist.unitCode = 'HAF';
      haf.name = 'Hafıza';
      kes.companyCode = 'pillika';

      const first = await syncDefinitions(tx.client, input);
      expect(first.agents).toEqual({ inserted: 0, updated: 2, unchanged: input.agents.length - 2 });
      expect(first.units).toEqual({ inserted: 0, updated: 2, unchanged: input.units.length - 2 });
      expect(
        await tx.rows(
          `select code, unit_code, company_codes from office.agent_definitions
           where code in ('KOR-4', 'P-IST-1') order by code`,
        ),
      ).toEqual([
        { code: 'KOR-4', unit_code: 'KOR', company_codes: ['founder_space', 'armadx'] },
        { code: 'P-IST-1', unit_code: 'HAF', company_codes: ['pillika'] },
      ]);
      expect(
        await tx.rows(
          `select code, name, company_code from office.units
           where code in ('A-KES', 'HAF') order by code`,
        ),
      ).toEqual([
        { code: 'A-KES', name: kes.name, company_code: 'pillika' },
        { code: 'HAF', name: 'Hafıza', company_code: null },
      ]);

      const second = await syncDefinitions(tx.client, input);
      expect(second.agents.updated + second.units.updated).toBe(0);
    });
  });

  it('refuses a company code the database does not have and writes nothing', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      input.units.push({ ...NEW_UNIT, code: 'X-YZ', companyCode: 'nowhere' });
      input.agents.push({ ...NEW_AGENT, companyCodes: ['armadx', 'elsewhere'] });
      const error = await refusedSync(tx, input);
      expect(error.code).toBe('unknown_company');
      expect(error.problems).toEqual([
        'unit X-YZ: company nowhere',
        'agent KOR-2: company elsewhere',
      ]);
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('refuses a card that drops a company which has a switch for the agent', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      input.units.push(NEW_UNIT);
      const kor1 = input.agents.find((agent) => agent.code === 'KOR-1');
      if (kor1) {
        kor1.companyCodes = ['pillika'];
      }
      const error = await refusedSync(tx, input);
      expect(error.code).toBe('closed_company');
      expect(error.problems).toEqual(['agent KOR-1: company armadx']);
      const after = await snapshot(tx);
      expect(after).toEqual(before);
      expect(after.agents.find((agent) => agent.code === 'KOR-1')?.company_codes).toEqual([
        'armadx',
        'pillika',
      ]);
    });
  });

  it('stops on an agent the input does not name; with allowOrphanAgents it goes on and keeps the row', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      input.agents = input.agents.filter((agent) => agent.code !== 'P-IST-1');
      input.units.push(NEW_UNIT);
      rename(input, 'HAF-1', 'Bilgi Tabanı Ajanı');

      const error = await refusedSync(tx, input);
      expect(error.code).toBe('orphan_agent');
      expect(error.problems).toEqual(['agent P-IST-1']);
      expect(await snapshot(tx)).toEqual(before);

      const report = await syncDefinitions(tx.client, input, { allowOrphanAgents: true });
      expect(report.orphanAgents).toEqual(['P-IST-1']);
      expect(report.units.inserted).toBe(1);
      expect(report.agents).toEqual({
        inserted: 0,
        updated: 1,
        unchanged: input.agents.length - 1,
      });
      const after = await snapshot(tx);
      expect(after.agents.map((agent) => agent.code)).toContain('P-IST-1');
      expect(after.agents).toHaveLength(before.agents.length);
      expect(after.companyAgents).toBe(before.companyAgents);
    });
  });

  it('keeps an orphan agent that nothing refers to', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      // KOR-4 has no switch and no card version in the fixtures: no foreign key would stop a
      // delete, so the row stays only because the sync never deletes.
      expect(await tx.count('company_agents', `agent_code = 'KOR-4'`)).toBe(0);
      expect(await tx.count('card_versions', `agent_code = 'KOR-4'`)).toBe(0);
      input.agents = input.agents.filter((agent) => agent.code !== 'KOR-4');
      const report = await syncDefinitions(tx.client, input, { allowOrphanAgents: true });
      expect(report.orphanAgents).toEqual(['KOR-4']);
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('reports a unit the input does not name and keeps it', async () => {
    await inAdminTransaction(async (tx) => {
      const before = await snapshot(tx);
      const input = await fromDatabase(tx);
      // The fixtures have no agent in A-KES.
      input.units = input.units.filter((unit) => unit.code !== 'A-KES');
      const report = await syncDefinitions(tx.client, input);
      expect(report.orphanUnits).toEqual(['A-KES']);
      expect(report.units).toEqual({ inserted: 0, updated: 0, unchanged: input.units.length });
      expect(await snapshot(tx)).toEqual(before);
    });
  });
});

describe.skipIf(noDatabase)('syncDefinitions with the restricted role', () => {
  afterAll(closePools);

  async function committedInput(): Promise<Definitions> {
    const input = await inAdminTransaction(fromDatabase);
    input.units.push(NEW_UNIT);
    input.agents.push(NEW_AGENT);
    return input;
  }

  async function newRows(): Promise<number> {
    const [row] = await adminQuery<{ n: number }>(
      `select (select count(*) from office.units where code = 'OFY')::int
            + (select count(*) from office.agent_definitions where code = 'KOR-2')::int as n`,
    );
    return row?.n ?? -1;
  }

  it('sees no company without a context and stops before any write', async () => {
    const input = await committedInput();
    await inTransaction(async (tx) => {
      const error = await refusedSync(tx, input);
      expect(error.code).toBe('no_company');
    });
    expect(await newRows()).toBe(0);
  });

  it('cannot write the global tables even in the founder context', async () => {
    const input = await committedInput();
    await inTransaction(async (tx) => {
      await tx.setContext({ companyId: ids.arma, userId: ids.founder });
      // insufficient_privilege: the application role only reads units and agent_definitions.
      await expect(syncDefinitions(tx.client, input)).rejects.toMatchObject({ code: '42501' });
    });
    expect(await newRows()).toBe(0);
  });
});
