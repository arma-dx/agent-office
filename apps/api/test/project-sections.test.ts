import { randomUUID } from 'node:crypto';
import { agentStep, createPool, withContext } from '@agent-office/db';
import {
  projectApprovalsSchema,
  projectDetailSchema,
  projectRunsSchema,
  requestDetailSchema,
  type ProjectApprovals,
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
// agent runs of a project with their cost, and the results of its requests. Projects and requests
// are opened through the API and results are decided through it; the runs and the results are
// written with the worker's restricted role in the request's own context, as the runner writes
// them. Tests commit, so each uses a project of its own.
//
// The coordinator gets a card version for the length of this file (a request is taken only while
// it has one) and loses it again at the end: other files read the office as the fixtures left it.

const database = inject('database');
const CARD = '00000000-0000-4000-8000-000000000961';
const PILLIKA_PROJECT = '00000000-0000-4000-8000-000000000962';
// An employee who holds the approval right. A person of this file's own: other files change the
// approval right of the fixtures' people.
const RIGHT_HOLDER = '00000000-0000-4000-8000-000000000963';
const rightHolderAccount = {
  email: 'right.holder.sections@armadx.test',
  sub: 'sub-right-holder-sections',
  hd: 'armadx.test',
} as const;
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
  let rightHolder: string;
  const workerPool = createPool(database?.worker ?? '', 'agent-office-api-test-worker', () => {});
  // A connection of the API's role beside the server's own, for an act the API has no route for.
  const besidePool = createPool(database?.app ?? '', 'agent-office-api-test-beside', () => {});

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
    third = await sessionOf(server, accounts.newcomer);
    external = await sessionOf(server, accounts.external);
    await adminExec(`
      insert into office.users (id, name) values ('${RIGHT_HOLDER}', 'Onay Hakkı Olan Üye')
        on conflict do nothing;
      insert into office.user_emails (email, user_id)
        values ('${rightHolderAccount.email}', '${RIGHT_HOLDER}') on conflict do nothing;
      insert into office.memberships (company_id, user_id, role, can_approve)
        values ('${ids.arma}', '${RIGHT_HOLDER}', 'employee', true) on conflict do nothing;
    `);
    rightHolder = await sessionOf(server, rightHolderAccount);
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
    // Removing a member needs a passkey re-verification; this clean-up is an administrator's.
    await adminExec(`
      update office.agent_definitions set current_version_id = null where code = 'KOR-1';
      alter table office.memberships disable trigger require_step_up;
      delete from office.memberships where user_id = '${RIGHT_HOLDER}';
      alter table office.memberships enable trigger require_step_up;
    `);
    await workerPool.end();
    await besidePool.end();
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

  describe('the approvals of a project', () => {
    const approvalsUrl = (projectId: string): string => `/api/projects/${projectId}/approvals`;

    async function approvalsOf(session: string, projectId: string): Promise<ProjectApprovals> {
      const res = await call(session, 'GET', approvalsUrl(projectId));
      expect(res.statusCode, res.body).toBe(200);
      return projectApprovalsSchema.parse(res.json());
    }

    /**
     * The founder gives the request to KOR-1, through the database's own function with the API's
     * role: the route does not offer the coordinator's own unit, and the fixtures open no other
     * agent in Arma DX. (Routing again while a result waits closes that result.)
     */
    const giveToAgent = (taskId: string) =>
      withContext(besidePool, { companyId: ids.arma, userId: ids.founder }, (client) =>
        client.query('select office.correct_routing($1, $2::jsonb)', [
          taskId,
          JSON.stringify([{ unit: 'KOR', agent: 'KOR-1', reason: 'Kurucu verdi.' }]),
        ]),
      );

    /**
     * A request of the employee in the project with a result KOR-1 submitted, as the runner
     * writes it. The result carries an agent's words in every field that can hold them.
     */
    async function submitted(projectId: string, text: string) {
      const taskId = await requestIn(projectId, text);
      await giveToAgent(taskId);
      const approvalId = await agentStep(
        workerPool,
        { companyId: ids.arma, userId: ids.employee, agentCode: 'KOR-1', projectId },
        async (client) => {
          const opened = await client.query<{ id: string }>(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model)
             values ($1, $2, 'KOR-1', $3, 'handoff', 'test-model') returning id`,
            [ids.arma, taskId, CARD],
          );
          const runId = opened.rows[0]?.id;
          const result = await client.query<{ id: string }>(
            `insert into office.approvals (company_id, task_id, run_id, agent_code, title, summary,
               agent_rationale, risk_note, payload, basis_type, basis_id, basis_version,
               involves_money, goes_external)
             values ($1, $2, $3, 'KOR-1', $4, $4, $4, $4, $5::jsonb, 'task', $2,
               (select version from office.tasks where id = $2), false, false)
             returning id`,
            [ids.arma, taskId, runId, AGENT_TEXT, JSON.stringify({ text: AGENT_TEXT })],
          );
          await client.query(
            `update office.runs set status = 'completed', finished_at = now() where id = $1`,
            [runId],
          );
          return result.rows[0]?.id ?? '';
        },
      );
      return { taskId, approvalId };
    }

    /** The founder decides a result through the API. */
    async function decide(approvalId: string, decision: string): Promise<void> {
      const res = await call(
        founder,
        'POST',
        `/api/approvals/${approvalId}/decision`,
        decision === 'approved'
          ? { decision }
          : { decision, reason: 'other', note: 'ONAYLAYICININ-NOTU' },
      );
      expect(res.statusCode, res.body).toBe(200);
    }

    /** A project with the approval right holder as one more plain member. */
    async function projectWithApprover(name: string): Promise<ProjectDetail> {
      const made = await project(name);
      const added = await call(employee, 'PUT', `/api/projects/${made.id}/members/${RIGHT_HOLDER}`);
      expect(added.statusCode, added.body).toBe(200);
      return made;
    }

    it('GET approvals: the founder gets waiting and decided results with who decided', async () => {
      const made = await projectWithApprover('Sonuçları olan proje');
      const approved = await submitted(made.id, 'Onaylanan iş');
      const rejected = await submitted(made.id, 'Reddedilen iş');
      const sentBack = await submitted(made.id, 'Düzeltme istenen iş');
      const waiting = await submitted(made.id, 'Bekleyen iş');
      await decide(approved.approvalId, 'approved');
      await decide(rejected.approvalId, 'rejected');
      await decide(sentBack.approvalId, 'changes_requested');

      // The founder, and a member who holds the approval right: the same list.
      for (const session of [founder, rightHolder]) {
        const answer = await approvalsOf(session, made.id);
        expect(answer.seesUndecided).toBe(true);
        expect(answer.truncated).toBe(false);
        expect(answer.approvals).toHaveLength(4);
        // What waits stands first.
        expect(answer.approvals[0]).toEqual({
          id: waiting.approvalId,
          request: { id: waiting.taskId, title: 'Bekleyen iş' },
          agent: { code: 'KOR-1', name: 'Ofis Koordinatörü' },
          status: 'pending',
          attempt: 1,
          createdAt: expect.any(String) as string,
          decidedAt: null,
          decidedBy: null,
        });
        const byId = new Map(answer.approvals.map((row) => [row.id, row]));
        const decided: [string, string, string][] = [
          [approved.approvalId, 'approved', 'Onaylanan iş'],
          [rejected.approvalId, 'rejected', 'Reddedilen iş'],
          [sentBack.approvalId, 'changes_requested', 'Düzeltme istenen iş'],
        ];
        for (const [id, status, title] of decided) {
          const row = byId.get(id);
          expect(row, title).toMatchObject({
            request: { title },
            status,
            attempt: 1,
            decidedBy: { userId: ids.founder, name: 'Kurucu' },
          });
          expect(Date.parse(row?.decidedAt ?? '')).toBeGreaterThan(Date.now() - 60_000);
        }
        // Then the decisions, the newest first.
        const times = answer.approvals.slice(1).map((row) => Date.parse(row.decidedAt ?? ''));
        expect(times).toEqual([...times].sort((a, b) => b - a));
      }
    });

    it('GET approvals: a member without the approval right gets only approved ones and seesUndecided false', async () => {
      const made = await projectWithApprover('Onaysız sonuçları gizli proje');
      const approved = await submitted(made.id, 'Onaylanan iş');
      const rejected = await submitted(made.id, 'Reddedilen iş');
      const sentBack = await submitted(made.id, 'Düzeltme istenen iş');
      await submitted(made.id, 'Bekleyen iş');
      await decide(approved.approvalId, 'approved');
      await decide(rejected.approvalId, 'rejected');
      await decide(sentBack.approvalId, 'changes_requested');
      // The owner of the project (who is also the requester) and a plain member: employees
      // without the approval right.
      for (const session of [employee, colleague]) {
        const res = await call(session, 'GET', approvalsUrl(made.id));
        expect(res.statusCode, res.body).toBe(200);
        const answer = projectApprovalsSchema.parse(res.json());
        expect(answer.seesUndecided).toBe(false);
        expect(answer.truncated).toBe(false);
        expect(answer.approvals).toMatchObject([
          {
            id: approved.approvalId,
            request: { id: approved.taskId, title: 'Onaylanan iş' },
            status: 'approved',
            decidedBy: { userId: ids.founder, name: 'Kurucu' },
          },
        ]);
        // Not even the titles of the requests whose results wait or were refused (the member
        // reads those requests on the Talepler tab; this list says nothing of their results).
        for (const text of ['Reddedilen iş', 'Düzeltme istenen iş', 'Bekleyen iş', 'pending']) {
          expect(res.body, text).not.toContain(text);
        }
      }
      // Before anything is approved the member's list is empty.
      const fresh = await projectWithApprover('Yalnızca bekleyeni olan proje');
      await submitted(fresh.id, 'Bekleyen iş');
      expect(await approvalsOf(employee, fresh.id)).toEqual({
        approvals: [],
        truncated: false,
        seesUndecided: false,
      });
      expect((await approvalsOf(founder, fresh.id)).approvals).toHaveLength(1);
      // A project without a result: empty for everybody, and the flag still says who is asking.
      const empty = await project('Sonucu olmayan proje');
      expect(await approvalsOf(founder, empty.id)).toEqual({
        approvals: [],
        truncated: false,
        seesUndecided: true,
      });
    });

    it('GET approvals: a result that waited when the request changed reads closed', async () => {
      const made = await projectWithApprover('Sonucu kapanan proje');
      const closed = await submitted(made.id, 'Yeniden yönlendirilen iş');
      const waiting = await submitted(made.id, 'Bekleyen iş');
      // The founder gives the first request to an agent again while its result waits.
      await giveToAgent(closed.taskId);
      expect(
        await adminQuery(
          'select status, invalidated_at is not null as closed from office.approvals where id = $1',
          [closed.approvalId],
        ),
      ).toEqual([{ status: 'pending', closed: true }]);
      const answer = await approvalsOf(founder, made.id);
      expect(answer.approvals.map((row) => [row.id, row.status])).toEqual([
        // What still waits stands first; the closed one is no waiting result any more.
        [waiting.approvalId, 'pending'],
        [closed.approvalId, 'closed'],
      ]);
      expect(answer.approvals[1]).toMatchObject({
        request: { id: closed.taskId, title: 'Yeniden yönlendirilen iş' },
        decidedAt: null,
        decidedBy: null,
      });
      // Never decided, so not approved: hidden from a member without the approval right.
      expect((await approvalsOf(colleague, made.id)).approvals).toEqual([]);
    });

    it("GET approvals: the agent's title and summary are in no body", async () => {
      const made = await projectWithApprover('Sonuç metni gizli proje');
      const approved = await submitted(made.id, 'Onaylanan iş\nTalebin ikinci satırı');
      const rejected = await submitted(made.id, 'Reddedilen iş');
      await submitted(made.id, 'Bekleyen iş');
      await decide(approved.approvalId, 'approved');
      await decide(rejected.approvalId, 'rejected');
      // The words are on the approval rows ...
      expect(
        await adminQuery(
          `select title, summary, agent_rationale, risk_note, payload, decision_reason
           from office.approvals where id = $1`,
          [rejected.approvalId],
        ),
      ).toEqual([
        {
          title: AGENT_TEXT,
          summary: AGENT_TEXT,
          agent_rationale: AGENT_TEXT,
          risk_note: AGENT_TEXT,
          payload: { text: AGENT_TEXT },
          decision_reason: 'ONAYLAYICININ-NOTU',
        },
      ]);
      // ... and in no body: for the founder, who may read them on the request's page, either.
      for (const session of [founder, rightHolder, employee, colleague]) {
        const res = await call(session, 'GET', approvalsUrl(made.id));
        expect(res.statusCode, res.body).toBe(200);
        expect(res.body).not.toContain(AGENT_TEXT);
        expect(res.body).not.toContain('ONAYLAYICININ-NOTU');
        expect(res.body).not.toContain('Talebin ikinci satırı');
        expect(res.body).toContain('Onaylanan iş');
        for (const row of res.json<{ approvals: object[] }>().approvals) {
          expect(Object.keys(row).sort()).toEqual([
            'agent',
            'attempt',
            'createdAt',
            'decidedAt',
            'decidedBy',
            'id',
            'request',
            'status',
          ]);
        }
      }
    });

    it("GET approvals: 404 for a non-member and for the other company's project", async () => {
      const made = await projectWithApprover('Sonuçları görünmeyen proje');
      const approved = await submitted(made.id, 'Onaylanan iş');
      await decide(approved.approvalId, 'approved');
      const hidden: [string, string, string?][] = [
        // An employee of the company who is no member of the project.
        [third, made.id],
        [founder, made.id, ids.pillika],
        [founder, PILLIKA_PROJECT],
        [rightHolder, PILLIKA_PROJECT],
        [employee, randomUUID()],
        [employee, 'not-an-id'],
      ];
      for (const [session, id, company] of hidden) {
        const res = await call(session, 'GET', approvalsUrl(id), undefined, company);
        expect(res.statusCode, id).toBe(404);
        expect(errorCode(res)).toBe('not_found');
        expect(res.body).not.toContain('Onaylanan iş');
      }
      const own = await call(founder, 'GET', approvalsUrl(PILLIKA_PROJECT), undefined, ids.pillika);
      expect(own.statusCode, own.body).toBe(200);
      expect(projectApprovalsSchema.parse(own.json())).toEqual({
        approvals: [],
        truncated: false,
        seesUndecided: true,
      });
    });

    it("GET approvals: an external person gets the section's answer and no row", async () => {
      const made = await projectWithApprover('Dış kişiye kapalı sonuçlar');
      const approved = await submitted(made.id, 'Onaylanan iş');
      await decide(approved.approvalId, 'approved');
      for (const id of [made.id, randomUUID(), 'not-an-id']) {
        const res = await call(external, 'GET', approvalsUrl(id));
        expect(res.statusCode, id).toBe(403);
        expect(errorCode(res)).toBe('insiders_only');
        expect(res.body).not.toContain('Onaylanan iş');
        expect(res.body).not.toContain('approvals');
      }
    });
  });
});
