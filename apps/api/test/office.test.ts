import { COMPANY_HEADER, apiErrorSchema, officeResponseSchema } from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupOffice } from '../src/routes/office.ts';
import { accounts, ids } from './fixtures.ts';
import {
  SAME_ORIGIN,
  SESSION_COOKIE,
  adminExec,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';

// GET /api/office: the units and agents of the selected company (module M15). The founder and
// employees see it, external persons do not (6 October decision 6). The units and agents live in
// global tables without row level security, so every case here is also an isolation case: nothing
// of another company, and nothing of the founder space, may appear.
//
// Fixtures: units KOR, HAF and OFY shared (OFY has no agent), A-KES of Arma DX, P-IST of Pillika;
// agents KOR-1, KOR-2, KOR-10, HAF-1 and HAF-2 for both companies, KOR-4 for the founder space,
// A-KES-2 for Arma DX, P-IST-1 for Pillika, and P-IST-9 whose card names both companies although
// its unit is Pillika's; switches in Arma DX KOR-1 enabled and HAF-1 stopped (with settings and a
// budget), in Pillika P-IST-1 enabled.

describe('groupOffice', () => {
  const row = (unit: string, agent: string, status: string | null = null, ready = false) => ({
    unit_code: unit,
    unit_name: `Unit ${unit}`,
    agent_code: agent,
    agent_name: `Agent ${agent}`,
    status,
    ready,
  });

  it('groups consecutive rows of a unit and keeps the order of units and agents', () => {
    const units = groupOffice([
      row('HAF', 'HAF-1', 'stopped', true),
      row('KOR', 'KOR-1', 'enabled', true),
      row('KOR', 'KOR-2'),
      row('A-KES', 'A-KES-2'),
    ]);
    expect(units).toEqual([
      {
        code: 'HAF',
        name: 'Unit HAF',
        agents: [{ code: 'HAF-1', name: 'Agent HAF-1', status: 'stopped', ready: true }],
      },
      {
        code: 'KOR',
        name: 'Unit KOR',
        agents: [
          { code: 'KOR-1', name: 'Agent KOR-1', status: 'enabled', ready: true },
          { code: 'KOR-2', name: 'Agent KOR-2', status: null, ready: false },
        ],
      },
      {
        code: 'A-KES',
        name: 'Unit A-KES',
        agents: [{ code: 'A-KES-2', name: 'Agent A-KES-2', status: null, ready: false }],
      },
    ]);
  });

  it('gives no unit for no row', () => {
    expect(groupOffice([])).toEqual([]);
  });
});

describe.skipIf(noDatabase)('office', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let external: string;
  let otherFounder: string;

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee, { amr: undefined });
    external = await sessionOf(server, accounts.external);
    otherFounder = await sessionOf(server, accounts.otherFounder);
  });
  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  function request(options: { session?: string | null; company?: string | null } = {}) {
    const session = options.session === undefined ? founder : options.session;
    const company = options.company === undefined ? ids.arma : options.company;
    return server.app.inject({
      method: 'GET',
      url: '/api/office',
      ...(session === null ? {} : { cookies: { [SESSION_COOKIE]: session } }),
      headers: { ...SAME_ORIGIN, ...(company === null ? {} : { [COMPANY_HEADER]: company }) },
    });
  }

  function errorCode(res: { json: () => unknown }): string {
    return apiErrorSchema.parse(res.json()).error.code;
  }

  /** "UNIT[AGENT:status ...]" per unit, in the order of the answer. */
  function shape(res: { json: () => unknown }): string[] {
    return officeResponseSchema
      .parse(res.json())
      .units.map(
        (unit) =>
          `${unit.code}[${unit.agents.map((a) => `${a.code}:${a.status ?? 'none'}`).join(' ')}]`,
      );
  }

  const ARMA = [
    'HAF[HAF-1:stopped HAF-2:none]',
    'KOR[KOR-1:enabled KOR-2:none KOR-10:none]',
    'A-KES[A-KES-2:none]',
  ];

  it("gives the founder Arma DX's units, agents and switches in order, and nothing else", async () => {
    const res = await request();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    // Shared units first, each group by code; agents by number, so KOR-10 follows KOR-2. HAF and
    // KOR have several agents each: ordered by the agent number alone their rows would mix, and
    // a unit would come back in pieces.
    expect(shape(res)).toEqual(ARMA);
    const { units } = officeResponseSchema.parse(res.json());
    expect(new Set(units.map((unit) => unit.code)).size).toBe(units.length);
    expect(units[0]).toEqual({
      code: 'HAF',
      name: 'Kurumsal Hafıza',
      agents: [
        // No card of these fixtures has a version to run with.
        { code: 'HAF-1', name: 'Bilgi Tabanı Ajanı', status: 'stopped', ready: false },
        { code: 'HAF-2', name: 'Kurumsal Arama Ajanı', status: null, ready: false },
      ],
    });
    // No unit without an agent, nothing of Pillika, nothing of the founder space, and no agent
    // whose unit belongs to another company although its card names this one.
    for (const absent of ['OFY', 'P-IST', 'P-IST-1', 'P-IST-9', 'KOR-4']) {
      expect(res.body, absent).not.toContain(`"${absent}"`);
    }
  });

  it("gives the founder Pillika's office without Arma DX's units, agents or switches", async () => {
    const res = await request({ company: ids.pillika });
    expect(res.statusCode).toBe(200);
    // HAF-1 and KOR-1 have a switch in Arma DX only.
    expect(shape(res)).toEqual([
      'HAF[HAF-1:none HAF-2:none]',
      'KOR[KOR-1:none KOR-2:none KOR-10:none]',
      'P-IST[P-IST-1:enabled P-IST-9:none]',
    ]);
    for (const absent of ['A-KES', 'A-KES-2', 'KOR-4', 'OFY']) {
      expect(res.body, absent).not.toContain(`"${absent}"`);
    }
  });

  it('gives the founder one unit with one agent in the founder space', async () => {
    const res = await request({ company: ids.founderSpace });
    expect(res.statusCode).toBe(200);
    expect(officeResponseSchema.parse(res.json())).toEqual({
      units: [
        {
          code: 'KOR',
          name: 'Koordinasyon Katmanı',
          agents: [{ code: 'KOR-4', name: 'Yönetici Asistanı', status: null, ready: false }],
        },
      ],
      // No request can be opened in the founder space: nothing is counted there.
      work: [],
      workTruncated: false,
    });
  });

  it('says which agents have a card version to run with, whatever their switch says', async () => {
    const readyOf = async (company: string): Promise<Record<string, boolean>> => {
      const { units } = officeResponseSchema.parse((await request({ company })).json());
      return Object.fromEntries(
        units.flatMap((unit) => unit.agents.map((agent) => [agent.code, agent.ready])),
      );
    };
    expect(Object.values(await readyOf(ids.arma))).not.toContain(true);
    const version = '00000000-0000-4000-8000-000000000911';
    try {
      // KOR-2 gets a version: a card that can run, with no switch in either company. HAF-1 stays
      // without one, although the company has a switch for it.
      await adminExec(`
        insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
          values ('${version}', 'KOR-2', 'abc0911', '{"card": {"status": "draft"}}', 'Y1',
                  'test-model')
          on conflict do nothing;
        update office.agent_definitions set current_version_id = '${version}' where code = 'KOR-2';
      `);
      for (const company of [ids.arma, ids.pillika]) {
        const ready = await readyOf(company);
        // The card is global: the same answer in both companies, and only for that agent. The
        // status written on the card (a draft here) does not decide it.
        expect(ready).toMatchObject({ 'KOR-2': true, 'KOR-1': false, 'HAF-1': false });
        expect(Object.values(ready).filter(Boolean)).toHaveLength(1);
      }
      // Nothing of the version itself leaves the database.
      const body = (await request()).body;
      expect(body).not.toContain(version);
      expect(body).not.toContain('abc0911');
    } finally {
      await adminExec(
        `update office.agent_definitions set current_version_id = null where code = 'KOR-2'`,
      );
    }
    expect((await readyOf(ids.arma))['KOR-2']).toBe(false);
  });

  it('gives an employee the same answer as the founder', async () => {
    const asFounder = await request();
    const asEmployee = await request({ session: employee });
    expect(asEmployee.statusCode).toBe(200);
    expect(shape(asEmployee)).toEqual(ARMA);
    expect(asEmployee.json()).toEqual(asFounder.json());
  });

  it('refuses an external person of the company', async () => {
    const res = await request({ session: external });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('insiders_only');
    expect(res.body).not.toContain('KOR-1');
    expect(res.body).not.toContain('units');
  });

  it('refuses a person who names a company they are not a member of', async () => {
    const cases: [string, string, string][] = [
      ['other founder, Arma DX', otherFounder, ids.arma],
      ['other founder, founder space', otherFounder, ids.founderSpace],
      ['employee, Pillika', employee, ids.pillika],
      ['external person, Pillika', external, ids.pillika],
      // The founder space is the most closed place of the panel: only the founder is a member.
      ['employee, founder space', employee, ids.founderSpace],
      ['external person, founder space', external, ids.founderSpace],
    ];
    for (const [who, session, company] of cases) {
      const res = await request({ session, company });
      expect(res.statusCode, who).toBe(403);
      expect(errorCode(res), who).toBe('forbidden');
      expect(res.body, who).not.toContain('KOR-4');
      expect(res.body, who).not.toContain('units');
    }
  });

  it('gives a company without agents an empty office', async () => {
    const res = await request({ session: otherFounder, company: ids.otherCompany });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ units: [], work: [], workTruncated: false });
  });

  it('needs a session and a company', async () => {
    const signedOut = await request({ session: null });
    expect(signedOut.statusCode).toBe(401);
    expect(errorCode(signedOut)).toBe('unauthenticated');

    const noCompany = await request({ company: null });
    expect(noCompany.statusCode).toBe(403);
    expect(errorCode(noCompany)).toBe('forbidden');

    const malformed = await request({ company: 'armadx' });
    expect(malformed.statusCode).toBe(403);
    expect(errorCode(malformed)).toBe('forbidden');
  });

  it('carries only the fields of the contract: no settings, no budget', async () => {
    const res = await request();
    const body = res.json<{ units: Record<string, unknown>[]; work: Record<string, unknown>[] }>();
    expect(Object.keys(body)).toEqual(['units', 'work', 'workTruncated']);
    for (const entry of body.work) {
      expect(Object.keys(entry).sort()).toEqual([
        'agentCode',
        'awaitingApproval',
        'failed',
        'running',
      ]);
    }
    for (const unit of body.units) {
      expect(Object.keys(unit).sort()).toEqual(['agents', 'code', 'name']);
      for (const agent of unit.agents as Record<string, unknown>[]) {
        expect(Object.keys(agent).sort()).toEqual(['code', 'name', 'ready', 'status']);
      }
    }
    // HAF-1's row has settings and a monthly budget in the fixtures.
    for (const word of ['settings', 'budget', 'folder-secret', 'drive_folders', '1234']) {
      expect(res.body, word).not.toContain(word);
    }
  });

  it('ignores a query string: the company comes from the header only', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/office?company=${ids.pillika}&companyId=${ids.pillika}`,
      cookies: { [SESSION_COOKIE]: employee },
      headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma },
    });
    expect(res.statusCode).toBe(200);
    expect(shape(res)).toEqual(ARMA);
  });
});
