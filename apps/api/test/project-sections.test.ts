import { randomUUID } from 'node:crypto';
import { agentStep, createPool } from '@agent-office/db';
import {
  projectDetailSchema,
  projectRunsSchema,
  requestDetailSchema,
  type ProjectDetail,
  type ProjectRuns,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { accounts, ids } from './fixtures.ts';
import {
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';
import { errorCode, send, type Method } from './passkey-helpers.ts';

// The sections of the project page that only read (8 October decision 17), through the API: the
// agent runs of a project with their cost. Projects and requests are opened through the API; the
// runs are written with the worker's restricted role in the request's own context, as the runner
// writes them. Tests commit, so each uses a project of its own.
//
// The coordinator gets a card version for the length of this file (a request is taken only while
// it has one) and loses it again at the end: other files read the office as the fixtures left it.

const database = inject('database');
const CARD = '00000000-0000-4000-8000-000000000961';
const PILLIKA_PROJECT = '00000000-0000-4000-8000-000000000962';
// What an agent wrote: on the run rows, and in no answer of this file.
const AGENT_TEXT = 'AJANIN-YAZDIĞI-METİN';

describe.skipIf(noDatabase)('the reading sections of a project', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let colleague: string;
  // A third employee of Arma DX (the fixtures' newcomer): a member of no project of this file.
  let third: string;
  let external: string;
  const workerPool = createPool(database?.worker ?? '', 'agent-office-api-test-worker', () => {});

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
    third = await sessionOf(server, accounts.newcomer);
    external = await sessionOf(server, accounts.external);
    await adminExec(`
      insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
        values ('${CARD}', 'KOR-1', 'abc0961', '{"card": {"status": "active"}}', 'Y2',
                 'test-model')
        on conflict do nothing;
      update office.agent_definitions set current_version_id = '${CARD}' where code = 'KOR-1';
      insert into office.projects (id, company_id, name, ai_allowed)
        values ('${PILLIKA_PROJECT}', '${ids.pillika}', 'Pillika projesi', true)
        on conflict do nothing;
    `);
  });

  afterAll(async () => {
    await adminExec(
      `update office.agent_definitions set current_version_id = null where code = 'KOR-1'`,
    );
    await workerPool.end();
    await server.close();
    await closeAdminPool();
  });

  const call = (
    session: string,
    method: Method,
    url: string,
    payload?: object,
    company: string = ids.arma,
  ) => send(server, session, method, url, { company, ...(payload ? { payload } : {}) });

  /**
   * A project of the employee (its owner) with the colleague as a plain member, where agents may
   * work (the permission opened as an administrator would: a person's opening asks for a
   * passkey, which the project tests cover).
   */
  async function project(name: string): Promise<ProjectDetail> {
    const res = await call(employee, 'POST', '/api/projects', {
      id: randomUUID(),
      name,
      memberIds: [ids.holder],
    });
    expect(res.statusCode, res.body).toBe(201);
    const made = projectDetailSchema.parse(res.json());
    await adminQuery('update office.projects set ai_allowed = true where id = $1', [made.id]);
    return made;
  }

  /** The employee opens a request in the project through the API; returns its id. */
  async function requestIn(projectId: string, text: string): Promise<string> {
    const res = await call(employee, 'POST', '/api/requests', {
      id: randomUUID(),
      text,
      projectId,
    });
    expect(res.statusCode, res.body).toBe(201);
    return requestDetailSchema.parse(res.json()).id;
  }

  interface Usage {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    cost: string;
  }

  /**
   * A run of the coordinator on a request of the employee, as the runner writes it: opened in the
   * request's own context with the worker's role. With `end` it is closed with that status, that
   * code and those numbers, and with an agent's words in its summary and its output.
   */
  async function run(
    taskId: string,
    projectId: string,
    end?: { status: string; code?: string | null; usage: Usage; seconds?: number },
  ): Promise<string> {
    return agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode: 'KOR-1', projectId },
      async (client) => {
        const opened = await client.query<{ id: string }>(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model, input)
           values ($1, $2, 'KOR-1', $3, 'request', 'test-model', $4::jsonb) returning id`,
          [ids.arma, taskId, CARD, JSON.stringify({ note: AGENT_TEXT })],
        );
        const runId = opened.rows[0]?.id ?? '';
        if (end) {
          await client.query(
            `update office.runs set status = $2, error_code = $3,
               finished_at = now() + make_interval(secs => $4), summary = $5, output = $6::jsonb,
               input_tokens = $7, output_tokens = $8, cache_write_tokens = $9,
               cache_read_tokens = $10, cost_usd = $11::numeric
             where id = $1`,
            [
              runId,
              end.status,
              end.code ?? null,
              end.seconds ?? 42,
              AGENT_TEXT,
              JSON.stringify({ final_text: AGENT_TEXT }),
              end.usage.input,
              end.usage.output,
              end.usage.cacheWrite,
              end.usage.cacheRead,
              end.usage.cost,
            ],
          );
        }
        return runId;
      },
    );
  }

  const FIRST: Usage = {
    input: 900,
    output: 120,
    cacheWrite: 30,
    cacheRead: 4000,
    cost: '0.012345',
  };
  const SECOND: Usage = { input: 5000, output: 2100, cacheWrite: 0, cacheRead: 100, cost: '0.4' };

  describe('the runs of a project', () => {
    const runsUrl = (projectId: string): string => `/api/projects/${projectId}/runs`;

    async function runsOf(session: string, projectId: string): Promise<ProjectRuns> {
      const res = await call(session, 'GET', runsUrl(projectId));
      expect(res.statusCode, res.body).toBe(200);
      return projectRunsSchema.parse(res.json());
    }

    /** A project with two requests: one run completed, one stopped, one still open. */
    async function withRuns(name: string) {
      const made = await project(name);
      const first = await requestIn(made.id, 'Lansman duyurusunu yaz\nKaynak: basın bülteni.');
      const second = await requestIn(made.id, 'Bülten özetini hazırla');
      const completed = await run(first, made.id, { status: 'completed', usage: FIRST });
      const stopped = await run(second, made.id, {
        status: 'stopped',
        code: 'agent_stopped',
        usage: SECOND,
        seconds: 90,
      });
      const open = await run(second, made.id);
      return { projectId: made.id, first, second, completed, stopped, open };
    }

    it('GET runs: the founder gets usage on every run and in the totals', async () => {
      const { projectId, first, second, completed, stopped, open } =
        await withRuns('Çalışmaları olan proje');
      const before = Date.now();
      const answer = await runsOf(founder, projectId);
      expect(answer.truncated).toBe(false);
      expect(Date.parse(answer.serverTime)).toBeGreaterThanOrEqual(before - 1000);
      const byId = new Map(answer.runs.map((row) => [row.id, row]));
      expect(answer.runs).toHaveLength(3);
      expect(byId.get(completed)).toMatchObject({
        // The title is the first line of what the person wrote.
        request: { id: first, title: 'Lansman duyurusunu yaz' },
        agent: { code: 'KOR-1', name: 'Ofis Koordinatörü' },
        status: 'completed',
        errorCode: null,
        durationMs: 42_000,
        usage: {
          inputTokens: 900,
          outputTokens: 120,
          cacheWriteTokens: 30,
          cacheReadTokens: 4000,
          costUsd: '0.012345',
        },
      });
      expect(byId.get(stopped)).toMatchObject({
        request: { id: second, title: 'Bülten özetini hazırla' },
        status: 'stopped',
        errorCode: 'agent_stopped',
        durationMs: 90_000,
        usage: {
          inputTokens: 5000,
          outputTokens: 2100,
          cacheWriteTokens: 0,
          cacheReadTokens: 100,
          costUsd: '0.400000',
        },
      });
      // A run that is still open: no end, no duration, and what it has cost so far.
      expect(byId.get(open)).toMatchObject({
        request: { id: second },
        status: 'running',
        finishedAt: null,
        durationMs: null,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: '0.000000' },
      });
      expect(Date.parse(byId.get(completed)?.finishedAt ?? '')).toBe(
        Date.parse(byId.get(completed)?.startedAt ?? '') + 42_000,
      );
      expect(answer.totals).toEqual({
        runCount: 3,
        usage: {
          inputTokens: 5900,
          outputTokens: 2220,
          cacheWriteTokens: 30,
          cacheReadTokens: 4100,
          costUsd: '0.412345',
        },
      });
      // Newest first: nothing in the list started after the one before it.
      const starts = answer.runs.map((row) => Date.parse(row.startedAt));
      expect(starts).toEqual([...starts].sort((a, b) => b - a));
    });

    it('GET runs: a member gets the same runs with usage null, and the body holds no cost and no token count', async () => {
      const { projectId } = await withRuns('Maliyeti gizli proje');
      const forFounder = await runsOf(founder, projectId);
      // The owner of the project and a plain member of it: employees, not the founder.
      for (const session of [employee, colleague]) {
        const res = await call(session, 'GET', runsUrl(projectId));
        expect(res.statusCode, res.body).toBe(200);
        const answer = projectRunsSchema.parse(res.json());
        expect(answer.runs.map((row) => row.id)).toEqual(forFounder.runs.map((row) => row.id));
        for (const row of answer.runs) {
          expect(row.usage).toBeNull();
        }
        expect(answer.runs.map((row) => ({ ...row, usage: null }))).toEqual(
          forFounder.runs.map((row) => ({ ...row, usage: null })),
        );
        expect(answer.totals).toEqual({ runCount: 3, usage: null });
        // The raw body, before any schema dropped a field: no number of the founder's.
        const raw = res.json<{ runs: { usage: unknown }[]; totals: { usage: unknown } }>();
        expect(raw.runs.map((row) => row.usage)).toEqual([null, null, null]);
        expect(raw.totals.usage).toBeNull();
        for (const text of [
          'costUsd',
          'Tokens',
          'cost_usd',
          '_tokens',
          '0.012345',
          '0.400000',
          '0.412345',
        ]) {
          expect(res.body, text).not.toContain(text);
        }
      }
    });

    it('GET runs: no agent text is in the body', async () => {
      const { projectId, completed } = await withRuns('Metni gizli proje');
      // The words are on the run rows ...
      expect(
        await adminQuery('select summary, output, input from office.runs where id = $1', [
          completed,
        ]),
      ).toEqual([
        { summary: AGENT_TEXT, output: { final_text: AGENT_TEXT }, input: { note: AGENT_TEXT } },
      ]);
      // ... and in no body, for the founder either; nor is the text of the request, beyond the
      // title a person's first line gives.
      for (const session of [founder, employee, colleague]) {
        const res = await call(session, 'GET', runsUrl(projectId));
        expect(res.statusCode, res.body).toBe(200);
        expect(res.body).not.toContain(AGENT_TEXT);
        expect(res.body).not.toContain('basın bülteni');
        expect(res.body).toContain('Lansman duyurusunu yaz');
        for (const row of res.json<{ runs: object[] }>().runs) {
          expect(Object.keys(row).sort()).toEqual([
            'agent',
            'durationMs',
            'errorCode',
            'finishedAt',
            'id',
            'request',
            'startedAt',
            'status',
            'usage',
          ]);
        }
      }
    });

    it('GET runs: truncated at 200 while the totals count all', async () => {
      const made = await project('Çok çalışması olan proje');
      const taskId = await requestIn(made.id, 'Çok kez çalışılan talep');
      // 201 runs, written as an administrator in the run's own context (one statement, so the
      // context holds for it), each with a cost of one cent.
      await adminExec(`
        select set_config('app.company_id', '${ids.arma}', true),
               set_config('app.user_id', '${ids.employee}', true),
               set_config('app.agent_code', 'KOR-1', true),
               set_config('app.project_id', '${made.id}', true);
        insert into office.runs
            (company_id, task_id, agent_code, card_version_id, trigger_type, model, cost_usd,
             input_tokens)
          select '${ids.arma}', '${taskId}', 'KOR-1', '${CARD}', 'request', 'test-model', 0.01, 10
          from generate_series(1, 201);
      `);
      const forFounder = await runsOf(founder, made.id);
      expect(forFounder.runs).toHaveLength(200);
      expect(forFounder.truncated).toBe(true);
      expect(forFounder.totals).toEqual({
        runCount: 201,
        usage: {
          inputTokens: 2010,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          costUsd: '2.010000',
        },
      });
      const forMember = await runsOf(colleague, made.id);
      expect(forMember.runs).toHaveLength(200);
      expect(forMember.truncated).toBe(true);
      expect(forMember.totals).toEqual({ runCount: 201, usage: null });
      // A project without a run: an empty list and a count of zero.
      const empty = await project('Çalışması olmayan proje');
      expect(await runsOf(founder, empty.id)).toMatchObject({
        runs: [],
        truncated: false,
        totals: {
          runCount: 0,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: '0' },
        },
      });
      expect(await runsOf(employee, empty.id)).toMatchObject({
        runs: [],
        truncated: false,
        totals: { runCount: 0, usage: null },
      });
    });

    it("GET runs: 404 for a non-member, for the other company's project and for a malformed id", async () => {
      const { projectId } = await withRuns('Çalışmaları görünmeyen proje');
      const hidden: [string, string, string?][] = [
        // An employee of the company who is no member of the project.
        [third, projectId],
        // The founder with the other company selected; the other company's project from here.
        [founder, projectId, ids.pillika],
        [founder, PILLIKA_PROJECT],
        [employee, PILLIKA_PROJECT],
        [employee, randomUUID()],
        [employee, 'not-an-id'],
      ];
      for (const [session, id, company] of hidden) {
        const res = await call(session, 'GET', runsUrl(id), undefined, company);
        expect(res.statusCode, id).toBe(404);
        expect(errorCode(res)).toBe('not_found');
        expect(res.body).not.toContain('Çalışmaları görünmeyen proje');
        expect(res.body).not.toContain('KOR-1');
      }
      // The founder of Pillika reads Pillika's project: it has no run.
      const own = await call(founder, 'GET', runsUrl(PILLIKA_PROJECT), undefined, ids.pillika);
      expect(own.statusCode, own.body).toBe(200);
      expect(projectRunsSchema.parse(own.json()).totals.runCount).toBe(0);
    });

    it("GET runs: an external person gets the section's answer and no row", async () => {
      const { projectId } = await withRuns('Dış kişiye kapalı proje');
      for (const id of [projectId, randomUUID(), 'not-an-id']) {
        const res = await call(external, 'GET', runsUrl(id));
        expect(res.statusCode, id).toBe(403);
        expect(errorCode(res)).toBe('insiders_only');
        expect(res.body).not.toContain('KOR-1');
        expect(res.body).not.toContain('runs');
      }
    });
  });
});
