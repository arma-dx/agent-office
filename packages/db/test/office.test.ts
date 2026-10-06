import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { readOffice, type OfficeRow } from '../src/office.ts';
import { ids } from './fixtures.ts';
import {
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
} from './helpers.ts';

// The office query (module M15) reads the global tables, which have no row level security and
// which the tenant isolation test leaves out of every loop. Its company filter is the join on the
// context company's row, so the isolation is checked here, with the restricted roles.
//
// Fixtures: units KOR and HAF shared, A-KES of Arma DX without an agent, P-IST of Pillika; agents
// KOR-1 and HAF-1 for both companies, P-IST-1 for Pillika, KOR-4 for the founder space; switches
// KOR-1 enabled in both, HAF-1 stopped in Arma DX, P-IST-1 enabled in Pillika.

function office(context: ContextInput): Promise<OfficeRow[]> {
  return inTransaction(async (tx) => {
    await tx.setContext(context);
    return readOffice(tx.client);
  });
}

/** "UNIT/AGENT:status" per row, in the order of the answer. */
function shape(rows: readonly OfficeRow[]): string[] {
  return rows.map((row) => `${row.unit_code}/${row.agent_code}:${row.status ?? 'none'}`);
}

const ARMA = ['HAF/HAF-1:stopped', 'KOR/KOR-1:enabled'];
const PILLIKA = ['HAF/HAF-1:none', 'KOR/KOR-1:enabled', 'P-IST/P-IST-1:enabled'];

describe.skipIf(noDatabase)('office query', () => {
  afterAll(closePools);

  it('gives no row without a context, and none for a company without a person', async () => {
    expect(await office({})).toEqual([]);
    expect(await office({ companyId: ids.arma })).toEqual([]);
    expect(await office({ userId: ids.founder })).toEqual([]);
  });

  it('gives the founder of Arma DX its units, agents and switches, and nothing of Pillika', async () => {
    const rows = await office({ companyId: ids.arma, userId: ids.founder });
    expect(rows).toEqual([
      {
        unit_code: 'HAF',
        unit_name: 'Kurumsal Hafıza',
        agent_code: 'HAF-1',
        agent_name: 'Bilgi Düzenleme',
        status: 'stopped',
      },
      {
        unit_code: 'KOR',
        unit_name: 'Koordinasyon Katmanı',
        agent_code: 'KOR-1',
        agent_name: 'Ofis Koordinatörü',
        status: 'enabled',
      },
    ]);
    // Pillika's unit and agent, and the founder space's agent, are not there; A-KES has no agent
    // and so no room.
    expect(rows.some((row) => row.unit_code === 'P-IST' || row.agent_code === 'P-IST-1')).toBe(
      false,
    );
    expect(rows.some((row) => row.agent_code === 'KOR-4')).toBe(false);
    expect(rows.some((row) => row.unit_code === 'A-KES')).toBe(false);
  });

  it('gives an employee of Arma DX the same rows as the founder', async () => {
    expect(shape(await office({ companyId: ids.arma, userId: ids.employeeA }))).toEqual(ARMA);
  });

  it('gives the founder of Pillika its own rows, and the Arma DX switch does not leak', async () => {
    const rows = await office({ companyId: ids.pillika, userId: ids.founder });
    // HAF-1 is stopped in Arma DX and has no row in Pillika.
    expect(shape(rows)).toEqual(PILLIKA);
    expect(rows.some((row) => row.unit_code.startsWith('A-'))).toBe(false);
    expect(rows.some((row) => row.agent_code === 'KOR-4')).toBe(false);
  });

  it('gives the founder exactly one unit and one agent in the founder space', async () => {
    expect(await office({ companyId: ids.founderSpace, userId: ids.founder })).toEqual([
      {
        unit_code: 'KOR',
        unit_name: 'Koordinasyon Katmanı',
        agent_code: 'KOR-4',
        agent_name: 'Yönetici Asistanı',
        status: null,
      },
    ]);
  });

  it('gives no row to a person who names a company they are not a member of', async () => {
    const strangers: [string, ContextInput][] = [
      ['Pillika employee, Arma DX', { companyId: ids.arma, userId: ids.employeeP }],
      ['Pillika external person, Arma DX', { companyId: ids.arma, userId: ids.externalP }],
      ['Arma DX employee, Pillika', { companyId: ids.pillika, userId: ids.employeeA }],
      ['Arma DX employee, founder space', { companyId: ids.founderSpace, userId: ids.employeeA }],
      [
        'Arma DX external person, founder space',
        { companyId: ids.founderSpace, userId: ids.externalA },
      ],
      ['other founder, Arma DX', { companyId: ids.arma, userId: ids.otherFounder }],
      ['other founder, founder space', { companyId: ids.founderSpace, userId: ids.otherFounder }],
      ['person without a membership, Arma DX', { companyId: ids.arma, userId: ids.formerEmployee }],
    ];
    for (const [who, context] of strangers) {
      expect(await office(context), who).toEqual([]);
    }
  });

  it('gives a company without agents no row, also to its own founder', async () => {
    expect(await office({ companyId: ids.otherCompany, userId: ids.otherFounder })).toEqual([]);
    // A person of two companies sees each office under its own context only.
    expect(shape(await office({ companyId: ids.arma, userId: ids.sharedEmployee }))).toEqual(ARMA);
    expect(await office({ companyId: ids.otherCompany, userId: ids.sharedEmployee })).toEqual([]);
  });

  // This is why the API refuses an external person by role (6 October decision 6): the person is a
  // member, so the company's row and with it the units and agents are visible to them; only the
  // switches are hidden by the row policy of company_agents.
  it('shows an external person the rows without any switch, so the caller must refuse them', async () => {
    const rows = await office({ companyId: ids.arma, userId: ids.externalA });
    expect(shape(rows)).toEqual(['HAF/HAF-1:none', 'KOR/KOR-1:none']);
  });

  it('gives an agent run in Pillika the rows of Pillika only', async () => {
    const rows = await inWorkerTransaction(async (tx) => {
      await tx.setContext({ companyId: ids.pillika, userId: ids.founder, agentCode: 'KOR-1' });
      return readOffice(tx.client);
    });
    expect(shape(rows)).toEqual(PILLIKA);
  });

  it('gives an agent run in Arma DX nothing of the founder space, whoever the identity is', async () => {
    const rows = await inWorkerTransaction(async (tx) => {
      await tx.setContext({ companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' });
      return readOffice(tx.client);
    });
    expect(shape(rows)).toEqual(ARMA);
  });

  it('orders agents by the number of their code, also one too large for an integer', async () => {
    // The code pattern does not limit the digits, and the sync never deletes a row: a number
    // beyond the integer range must not fail the office of every company the card names.
    const rows = await inAdminTransaction(async (tx) => {
      await tx.exec(
        `insert into office.agent_definitions (code, name, unit_code, company_codes) values
           ('KOR-2147483648', 'Too large for an integer', 'KOR', '{armadx}'),
           ('KOR-10', 'Tenth', 'KOR', '{armadx}'),
           ('KOR-9', 'Ninth', 'KOR', '{armadx}')`,
      );
      await tx.setContext({ companyId: ids.arma, userId: ids.founder });
      return readOffice(tx.client);
    });
    expect(shape(rows)).toEqual([
      'HAF/HAF-1:stopped',
      'KOR/KOR-1:enabled',
      'KOR/KOR-9:none',
      'KOR/KOR-10:none',
      'KOR/KOR-2147483648:none',
    ]);
  });

  it('reads only the five columns of the contract', async () => {
    const [row] = await office({ companyId: ids.arma, userId: ids.founder });
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'agent_code',
      'agent_name',
      'status',
      'unit_code',
      'unit_name',
    ]);
  });
});
