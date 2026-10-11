import { randomUUID } from 'node:crypto';
import { agentStep, closeRequest, createPool, withContext } from '@agent-office/db';
import {
  BACKGROUND_HEADER,
  COMPANY_HEADER,
  COORDINATOR_AGENT_CODE,
  NOTIFICATION_LIST_LIMIT,
  OFFICE_REQUEST_LIMIT,
  REQUEST_COMMENT_MAX,
  TODAY_REQUEST_LIMIT,
  agentOpenResponseSchema,
  agentStopIfOpenResponseSchema,
  apiErrorSchema,
  approvalDecisionDetails,
  approvalDeskSchema,
  customerPermissionDetails,
  customerPermissionsAnswerSchema,
  memberChangeDetails,
  officeAgentSchema,
  officeResponseSchema,
  projectAiPermissionAnswerSchema,
  projectAiPermissionDetails,
  projectDetailSchema,
  requestDetailSchema,
  requestIntakeSchema,
  requestListSchema,
  routingOptionsSchema,
  sidebarCountsSchema,
  todaySchema,
  waitingWorkResponseSchema,
  officeDay,
  type OfficeAgentWork,
  type ProjectDetail,
  type RequestDetail,
  type SidebarCounts,
  type Today,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { hashSessionKey } from '../src/session.ts';
import { SoftwareAuthenticator } from './authenticator.ts';
import { accounts, ids } from './fixtures.ts';
import {
  PANEL_ORIGIN,
  SAME_ORIGIN,
  SESSION_COOKIE,
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';
import { errorCode, freshPasskey, send, signStepUp } from './passkey-helpers.ts';

// Flow (A) through the API: a person sends a request, reads where it is, the unit's approver
// decides, the requester accepts. The worker's part (routing, the result) is played here with the
// worker's own restricted role and an agent context, exactly as the runner writes it; the runner
// itself and the whole flow with a real queue are tested in apps/worker.
//
// The unit agent of these tests is HAF-2: the fixtures give it no switch and no card version, so
// the tests give it a version, open it and take both away again at the end (other files read the
// office as the fixtures left it). The coordinator's card is "active" here, so that an employee's
// request runs; the trial rule has a test of its own.

const database = inject('database');
const CARD_KOR = '00000000-0000-4000-8000-000000000901';
const CARD_HAF = '00000000-0000-4000-8000-000000000902';
// What the coordinator writes as the reason of its routing: a model's text nobody approved.
const COORDINATOR_REASON = 'Kurumsal hafıza işi.';
// An employee who holds the general approval right and is appointed nowhere. A person of this
// file's own: other files change the approval right of the fixtures' people.
const RIGHT_HOLDER = '00000000-0000-4000-8000-000000000903';
const rightHolderAccount = {
  email: 'right.holder@armadx.test',
  sub: 'sub-right-holder',
  hd: 'armadx.test',
} as const;

// Two more people of this file's own, employees of Arma DX: one is made an external person and
// one is removed from the company (8 October decision 45).
const LEAVERS = {
  external: {
    id: '00000000-0000-4000-8000-000000000904',
    name: 'Dış Kişi Yapılan',
    account: {
      email: 'made.external@armadx.test',
      sub: 'sub-made-external',
      hd: 'armadx.test',
    },
    // What the person is answered when they ask for their request afterwards.
    refusal: [403, 'insiders_only'],
  },
  removed: {
    id: '00000000-0000-4000-8000-000000000905',
    name: 'Şirketten Çıkarılan',
    account: { email: 'removed@armadx.test', sub: 'sub-removed', hd: 'armadx.test' },
    // Their only membership went, and their sessions with it.
    refusal: [401, 'unauthenticated'],
  },
} as const;

describe.skipIf(noDatabase)('requests', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let colleague: string;
  let rightHolder: string;
  let external: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  const workerPool = createPool(database?.worker ?? '', 'agent-office-api-test-worker', () => {});
  // A connection of the API's role that a test holds open itself, next to the server's own.
  const besidePool = createPool(database?.app ?? '', 'agent-office-api-test-beside', () => {});
  // A connection of the privileged role that a test holds open itself, for a change of somebody
  // else that commits while a request of the server is on its way.
  const adminPool = createPool(database?.admin ?? '', 'agent-office-api-test-other', () => {});

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
    external = await sessionOf(server, accounts.external);
    await adminExec(`
      insert into office.users (id, name) values ('${RIGHT_HOLDER}', 'Onay Hakkı Olan')
        on conflict do nothing;
      insert into office.user_emails (email, user_id)
        values ('${rightHolderAccount.email}', '${RIGHT_HOLDER}') on conflict do nothing;
      insert into office.memberships (company_id, user_id, role, can_approve)
        values ('${ids.arma}', '${RIGHT_HOLDER}', 'employee', true) on conflict do nothing;
    `);
    rightHolder = await sessionOf(server, rightHolderAccount);
    await adminExec(`
      insert into office.tools (name, kind, description) values
        ('route_task', 'internal_write', 'Routes a request'),
        ('submit_for_approval', 'draft', 'Submits a result')
        on conflict do nothing;
      insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
        values ('${CARD_KOR}', 'KOR-1', 'abc0001', '{"card": {"status": "active"}}', 'Y2',
                 'test-model'),
               ('${CARD_HAF}', 'HAF-2', 'abc0001', '{"card": {"status": "active"}}', 'Y1',
                 'test-model')
        on conflict do nothing;
      update office.agent_definitions set current_version_id = '${CARD_KOR}' where code = 'KOR-1';
      update office.agent_definitions set current_version_id = '${CARD_HAF}' where code = 'HAF-2';
    `);
    const enabled = await put(founder, '/api/agents/HAF-2/switch', { status: 'enabled' });
    expect(enabled.statusCode).toBe(200);
  });

  afterAll(async () => {
    // Removing a member needs a passkey re-verification; this clean-up is an administrator's.
    await adminExec(`
      delete from office.company_agents where agent_code = 'HAF-2';
      update office.agent_definitions set current_version_id = null
        where code in ('KOR-1', 'HAF-2');
      alter table office.memberships disable trigger require_step_up;
      delete from office.memberships
        where user_id in ('${RIGHT_HOLDER}', '${LEAVERS.external.id}', '${LEAVERS.removed.id}');
      alter table office.memberships enable trigger require_step_up;
    `);
    await workerPool.end();
    await besidePool.end();
    await adminPool.end();
    await server.close();
    await closeAdminPool();
  });

  function put(session: string, url: string, payload: object): Promise<LightMyRequestResponse> {
    return server.app.inject({
      method: 'PUT',
      url,
      cookies: { [SESSION_COOKIE]: session },
      headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma },
      payload,
    });
  }

  const get = (session: string, url: string, company: string = ids.arma) =>
    send(server, session, 'GET', url, { company });
  const post = (session: string, url: string, payload: object = {}, company: string = ids.arma) =>
    send(server, session, 'POST', url, { company, payload });

  async function open(
    session: string,
    text = 'LinkedIn için gönderi yaz\nKaynak: yeni ofis açıldı.',
  ) {
    const id = randomUUID();
    const res = await post(session, '/api/requests', { id, text });
    expect(res.statusCode).toBe(201);
    return requestDetailSchema.parse(res.json());
  }

  async function read(session: string, id: string): Promise<RequestDetail> {
    const res = await get(session, `/api/requests/${id}`);
    expect(res.statusCode).toBe(200);
    return requestDetailSchema.parse(res.json());
  }

  /**
   * The coordinator's run: routes the request to HAF-2 and ends. Without an agent the routing
   * returns the request to its requester (8 October decision 2).
   */
  async function route(
    taskId: string,
    requester: string,
    agent: string | null = 'HAF-2',
    unit = 'HAF',
    // A request inside a project is carried out in the context of that project.
    projectId: string | null = null,
  ) {
    await agentStep(
      workerPool,
      { companyId: ids.arma, userId: requester, agentCode: 'KOR-1', projectId },
      async (client) => {
        const run = await client.query<{ id: string }>(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model) values ($1, $2, 'KOR-1', $3, 'request', 'test-model') returning id`,
          [ids.arma, taskId, CARD_KOR],
        );
        const runId = run.rows[0]?.id;
        await client.query('select office.route_request($1, $2::jsonb, $3)', [
          taskId,
          JSON.stringify([{ unit, agent, reason: COORDINATOR_REASON }]),
          runId,
        ]);
        await client.query(
          `update office.runs set status = 'completed', finished_at = now(),
             summary = 'Talep birime yönlendirildi.' where id = $1`,
          [runId],
        );
      },
    );
  }

  /** The unit agent's run: submits a result with two options and ends. */
  async function submit(
    taskId: string,
    requester: string,
    options: { goesExternal?: boolean; previous?: string; projectId?: string } = {},
  ): Promise<string> {
    return agentStep(
      workerPool,
      {
        companyId: ids.arma,
        userId: requester,
        agentCode: 'HAF-2',
        projectId: options.projectId ?? null,
      },
      async (client) => {
        const run = await client.query<{ id: string }>(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model) values ($1, $2, 'HAF-2', $3, 'handoff', 'test-model') returning id`,
          [ids.arma, taskId, CARD_HAF],
        );
        const runId = run.rows[0]?.id;
        await client.query(
          `insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
           values ($1, $2, 1, 'submit_for_approval', 'succeeded')`,
          [ids.arma, runId],
        );
        const approval = await client.query<{ id: string }>(
          `insert into office.approvals (company_id, task_id, run_id, agent_code, tool_name, title,
             summary, agent_rationale, payload, options, basis_type, basis_id, basis_version,
             involves_money, goes_external, previous_approval_id)
           values ($1, $2, $3, 'HAF-2', 'submit_for_approval', 'LinkedIn gönderisi', 'İki seçenek.',
             'Kaynak olarak talep metni kullanıldı.', $4, $5, 'task', $2,
             (select version from office.tasks where id = $2), false, $6, $7)
           returning id`,
          [
            ids.arma,
            taskId,
            runId,
            JSON.stringify({
              options: [
                { code: 'A', text: 'Yeni ofisimiz açıldı.', hashtags: ['#ofis'] },
                { code: 'B', text: 'Artık yeni ofisimizdeyiz.', hashtags: [] },
              ],
            }),
            JSON.stringify([{ code: 'A' }, { code: 'B' }]),
            options.goesExternal ?? false,
            options.previous ?? null,
          ],
        );
        await client.query(
          `update office.runs set status = 'completed', finished_at = now(),
             summary = 'Sonuç onaya sunuldu.' where id = $1`,
          [runId],
        );
        return approval.rows[0]?.id ?? '';
      },
    );
  }

  it('opens a request from a text alone and puts the coordinator’s run on the queue', async () => {
    const before = server.jobs.sent.length;
    const id = randomUUID();
    const text = '\n  LinkedIn için gönderi yaz  \nKaynak: yeni ofis açıldı.';
    const res = await post(employee, '/api/requests', { id, text });
    expect(res.statusCode).toBe(201);
    const detail = requestDetailSchema.parse(res.json());
    expect(detail).toMatchObject({
      id,
      title: 'LinkedIn için gönderi yaz',
      text,
      status: 'open',
      stage: 'routing',
      cause: null,
      turn: { kind: 'agent', code: 'KOR-1' },
      waitingForMe: false,
      unit: null,
      agent: null,
      requester: { userId: ids.employee, name: 'Çalışan' },
      journey: [],
      approval: null,
      result: null,
      acceptance: null,
      closure: null,
      actions: { cancel: true, stop: false, reroute: false },
    });
    // Ids and an agent code, nothing of the text (rule 10).
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' },
    ]);
    // A repeated send answers the same record and starts nothing again.
    const again = await post(employee, '/api/requests', { id, text: 'Başka bir metin' });
    expect(again.statusCode).toBe(201);
    expect(requestDetailSchema.parse(again.json()).text).toBe(text);
    expect(server.jobs.sent).toHaveLength(before + 1);
    // The same id from another person is not theirs to reuse.
    expect((await post(colleague, '/api/requests', { id, text: 'x' })).statusCode).toBe(400);
    const [row] = await adminQuery<{ kind: string; requester_user_id: string }>(
      'select kind, requester_user_id from office.tasks where id = $1',
      [id],
    );
    expect(row).toEqual({ kind: 'request', requester_user_id: ids.employee });
  });

  it('the same request sent twice at the same moment is opened once and answered twice', async () => {
    // A double click, or a retry while the first send is still in flight: the second does not see
    // the first one's row yet and meets it at the primary key.
    for (let round = 0; round < 8; round += 1) {
      const before = server.jobs.sent.length;
      const id = randomUUID();
      const text = `Aynı anda iki kez gönderilen talep ${String(round)}`;
      const answers = await Promise.all([
        post(employee, '/api/requests', { id, text }),
        post(employee, '/api/requests', { id, text }),
      ]);
      expect(answers.map((res) => res.statusCode)).toEqual([201, 201]);
      for (const res of answers) {
        expect(requestDetailSchema.parse(res.json())).toMatchObject({ id, text, status: 'open' });
      }
      expect(await adminQuery('select 1 from office.tasks where id = $1', [id])).toHaveLength(1);
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' },
      ]);
    }
    // The id of somebody else's request is still not this person's to reuse, at the same moment
    // or later.
    const id = randomUUID();
    const [mine, theirs] = await Promise.all([
      post(employee, '/api/requests', { id, text: 'Benim talebim' }),
      post(colleague, '/api/requests', { id, text: 'Başkasının talebi' }),
    ]);
    expect([mine.statusCode, theirs.statusCode].sort()).toEqual([201, 400]);
    expect(await adminQuery('select 1 from office.tasks where id = $1', [id])).toHaveLength(1);
  });

  it('takes a text that starts with a separator line: the title is the first line that says something', async () => {
    // Such a text was accepted by the schema and then failed at the table's title check (500).
    const pasted = await open(
      employee,
      `${'-'.repeat(90)}\nToplantı notlarını özetle\n${'-'.repeat(90)}`,
    );
    expect(pasted.title).toBe('Toplantı notlarını özetle');
    const dots = await open(employee, '.'.repeat(120));
    expect(dots.title).toBe('.'.repeat(80));
    expect(dots.text).toBe('.'.repeat(120));
  });

  it('refuses a body that tries to route, an external person, the founder space and no session', async () => {
    const id = randomUUID();
    for (const extra of [{ unit: 'HAF' }, { agent: 'HAF-2' }, { status: 'done' }, { title: 'x' }]) {
      const res = await post(employee, '/api/requests', { id, text: 'x', ...extra });
      expect(res.statusCode).toBe(400);
    }
    expect((await post(employee, '/api/requests', { id, text: '   ' })).statusCode).toBe(400);
    const outsider = await post(external, '/api/requests', { id, text: 'x' });
    expect([outsider.statusCode, errorCode(outsider)]).toEqual([403, 'insiders_only']);
    const space = await post(founder, '/api/requests', { id, text: 'x' }, ids.founderSpace);
    expect([space.statusCode, errorCode(space)]).toEqual([409, 'private_space']);
    const anonymous = await server.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma },
      payload: { id, text: 'x' },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(await adminQuery('select 1 from office.tasks where id = $1', [id])).toEqual([]);
  });

  it('a request stays inside its company; a task between people is not a request', async () => {
    const mine = await open(employee);
    // The founder reads it in Arma DX, and not with Pillika selected.
    expect((await get(founder, `/api/requests/${mine.id}`)).statusCode).toBe(200);
    expect((await get(founder, `/api/requests/${mine.id}`, ids.pillika)).statusCode).toBe(404);
    const pillika = requestListSchema.parse(
      (await get(founder, '/api/requests', ids.pillika)).json(),
    );
    expect(pillika.requests).toEqual([]);
    expect(
      (await post(founder, `/api/requests/${mine.id}/close`, {}, ids.pillika)).statusCode,
    ).toBe(404);
    const outsider = await get(external, `/api/requests/${mine.id}`);
    expect(outsider.statusCode).toBe(403);
    const [task] = await adminQuery<{ id: string }>(
      `insert into office.tasks (company_id, title) values ($1, 'A task between people')
       returning id`,
      [ids.arma],
    );
    expect((await get(founder, `/api/requests/${task?.id ?? ''}`)).statusCode).toBe(404);
    expect((await post(founder, `/api/requests/${task?.id ?? ''}/close`)).statusCode).toBe(404);
    const all = requestListSchema.parse((await get(founder, '/api/requests')).json());
    expect(all.requests.some((request) => request.id === task?.id)).toBe(false);
    expect(all.requests.some((request) => request.id === mine.id)).toBe(true);
    const own = requestListSchema.parse((await get(colleague, '/api/requests?mine=true')).json());
    expect(own.requests.some((request) => request.id === mine.id)).toBe(false);
    expect((await get(founder, '/api/requests?mine=maybe')).statusCode).toBe(400);
  });

  it('walks a request to the end: routed, worked on, approved by the approver, accepted by the requester', async () => {
    const { id } = await open(employee);
    await route(id, ids.employee);
    const routed = await read(employee, id);
    expect(routed).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'HAF-2' },
      unit: { code: 'HAF' },
      agent: { code: 'HAF-2' },
      approver: null,
    });
    expect(routed.journey.map((item) => item.kind)).toEqual(['run', 'routing']);
    // The requester reads where the request went; the coordinator's reason is a model's text
    // nobody approved, so only those who may decide the work read it.
    expect(routed.journey[1]).toMatchObject({
      kind: 'routing',
      unit: { code: 'HAF', name: 'Kurumsal Hafıza' },
      agent: { code: 'HAF-2' },
      by: null,
      reason: null,
    });
    expect((await read(founder, id)).journey[1]).toMatchObject({
      kind: 'routing',
      reason: 'Kurumsal hafıza işi.',
    });
    expect(JSON.stringify(await read(colleague, id))).not.toContain('Kurumsal hafıza işi.');

    const approvalId = await submit(id, ids.employee);
    // The requester: it waits for the unit's approver; the output is not theirs to read yet.
    const waiting = await read(employee, id);
    expect(waiting).toMatchObject({
      status: 'awaiting_approval',
      stage: 'unit_approval',
      turn: { kind: 'founder' },
      waitingForMe: false,
      approval: null,
      result: null,
    });
    expect(waiting.journey.some((item) => item.kind === 'approval')).toBe(false);
    expect(JSON.stringify(waiting)).not.toContain('Yeni ofisimiz açıldı.');
    expect(approvalDeskSchema.parse((await get(employee, '/api/approvals')).json())).toEqual({
      approvals: [],
      acceptances: [],
    });
    // The requester cannot decide it either.
    const notMine = await post(employee, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    expect(notMine.statusCode).toBe(404);

    // The founder: the card, with the options and the marks from the record.
    const forFounder = await read(founder, id);
    expect(forFounder.waitingForMe).toBe(true);
    expect(forFounder.approval).toMatchObject({
      id: approvalId,
      requestId: id,
      attempt: 1,
      agent: { code: 'HAF-2' },
      requester: { userId: ids.employee },
      summary: 'İki seçenek.',
      rationale: 'Kaynak olarak talep metni kullanıldı.',
      options: [
        { code: 'A', text: 'Yeni ofisimiz açıldı.', hashtags: ['#ofis'] },
        { code: 'B', text: 'Artık yeni ofisimizdeyiz.', hashtags: [] },
      ],
      involvesMoney: false,
      moneyStatedBy: null,
      goesExternal: false,
      needsStepUp: false,
    });
    const desk = approvalDeskSchema.parse((await get(founder, '/api/approvals')).json());
    expect(desk.approvals.map((card) => card.id)).toContain(approvalId);
    // Nobody is appointed for the unit: the founder decides, and nobody else (7 October decision
    // 5). An employee who holds the general approval right reads the pending result (3 October
    // decision 1) but is not offered the decision and cannot make it.
    const holderView = await read(rightHolder, id);
    expect(holderView.journey.some((item) => item.kind === 'approval')).toBe(true);
    expect(holderView).toMatchObject({
      stage: 'unit_approval',
      turn: { kind: 'founder' },
      waitingForMe: false,
      approval: null,
      actions: { cancel: false, stop: false, reroute: false },
    });
    expect(
      approvalDeskSchema.parse((await get(rightHolder, '/api/approvals')).json()).approvals,
    ).toEqual([]);
    for (const body of [
      { decision: 'approved', selectedOption: 'A' },
      { decision: 'rejected', reason: 'out_of_scope' },
    ]) {
      const byHolder = await post(rightHolder, `/api/approvals/${approvalId}/decision`, body);
      expect(byHolder.statusCode).toBe(404);
    }
    expect((await read(founder, id)).stage).toBe('unit_approval');

    const noOption = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
    });
    expect([noOption.statusCode, errorCode(noOption)]).toEqual([409, 'option_required']);
    const wrongOption = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'Z',
    });
    expect(errorCode(wrongOption)).toBe('option_required');
    const approved = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'B',
    });
    expect(approved.statusCode).toBe(200);
    expect(requestDetailSchema.parse(approved.json())).toMatchObject({
      status: 'awaiting_approval',
      stage: 'requester_approval',
      turn: { kind: 'person', userId: ids.employee },
      waitingForMe: false,
      acceptance: null,
    });
    const twice = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'rejected',
      reason: 'out_of_scope',
    });
    expect([twice.statusCode, errorCode(twice)]).toEqual([409, 'approval_closed']);

    // The requester: the result, and the acceptance.
    const released = await read(employee, id);
    expect(released).toMatchObject({
      waitingForMe: true,
      acceptance: { round: 1, returnsToAgent: true },
      result: {
        approvalId,
        option: { code: 'B', text: 'Artık yeni ofisimizdeyiz.' },
        approvedBy: { userId: ids.founder, name: 'Kurucu' },
      },
    });
    const mine = approvalDeskSchema.parse((await get(employee, '/api/approvals')).json());
    expect(mine.acceptances).toMatchObject([{ requestId: id, round: 1, returnsToAgent: true }]);
    // Only the requester accepts.
    const byFounder = await post(founder, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    expect([byFounder.statusCode, errorCode(byFounder)]).toEqual([409, 'approval_closed']);
    const accepted = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    expect(accepted.statusCode).toBe(200);
    const done = requestDetailSchema.parse(accepted.json());
    expect(done).toMatchObject({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      acceptance: null,
      actions: { cancel: false, stop: false, reroute: false },
    });
    expect(
      done.journey.map((item) => `${item.kind}:${'status' in item ? item.status : ''}`),
    ).toEqual([
      'run:completed',
      'routing:',
      'run:completed',
      'approval:approved',
      'acceptance:approved',
    ]);
    const again = await post(employee, `/api/requests/${id}/acceptance`, { decision: 'approved' });
    expect([again.statusCode, errorCode(again)]).toEqual([409, 'approval_closed']);
  });

  it('the hand-over to the requester moves the request: the list dates it by that moment', async () => {
    const { id } = await open(employee);
    await route(id, ids.employee);
    const approvalId = await submit(id, ids.employee);
    const state = async () => {
      const [row] = await adminQuery<{ at: string; version: number; events: number }>(
        `select t.updated_at::text as at, t.version,
                (select count(*)::int from office.audit_log a
                 where a.record_type = 'task' and a.record_id = t.id) as events
         from office.tasks t where t.id = $1`,
        [id],
      );
      return row ?? { at: '', version: 0, events: 0 };
    };
    const submitted = await state();
    const approved = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    expect(requestDetailSchema.parse(approved.json()).stage).toBe('requester_approval');
    // The status was "awaiting_approval" before and after; the request still moved.
    const handedOver = await state();
    expect(
      await adminQuery('select $1::timestamptz > $2::timestamptz as moved', [
        handedOver.at,
        submitted.at,
      ]),
    ).toEqual([{ moved: true }]);
    // Nothing of the request itself changed: the same version, no new task event.
    expect(handedOver).toMatchObject({ version: submitted.version, events: submitted.events });
    const mine = requestListSchema.parse((await get(employee, '/api/requests?mine=true')).json());
    expect(mine.requests[0]).toMatchObject({ id, stage: 'requester_approval', waitingForMe: true });
    expect(
      // The answer carries milliseconds; the database keeps microseconds.
      await adminQuery(
        `select $1::timestamptz = date_trunc('milliseconds', $2::timestamptz) as same`,
        [mine.requests[0]?.updatedAt, handedOver.at],
      ),
    ).toEqual([{ same: true }]);
  });

  it('a change request sends the work back to the same agent, in the requester’s name', async () => {
    const { id } = await open(employee);
    await route(id, ids.employee);
    const first = await submit(id, ids.employee);
    const before = server.jobs.sent.length;
    const missing = await post(founder, `/api/approvals/${first}/decision`, {
      decision: 'changes_requested',
      reason: 'other',
    });
    expect(missing.statusCode).toBe(400);
    const sentBack = await post(founder, `/api/approvals/${first}/decision`, {
      decision: 'changes_requested',
      reason: 'language_and_tone',
      note: 'Daha sade olsun.',
    });
    expect(sentBack.statusCode).toBe(200);
    expect(requestDetailSchema.parse(sentBack.json())).toMatchObject({
      status: 'in_progress',
      stage: 'revising',
      turn: { kind: 'agent', code: 'HAF-2' },
    });
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
    ]);
    // The requester sees that it is being revised, not the approver's words or the output.
    const forRequester = await read(employee, id);
    expect(forRequester.stage).toBe('revising');
    expect(JSON.stringify(forRequester)).not.toContain('Daha sade olsun.');
    // The second change request: nothing is started again; the work falls to the approver.
    const second = await submit(id, ids.employee, { previous: first });
    const jobs = server.jobs.sent.length;
    const again = await post(founder, `/api/approvals/${second}/decision`, {
      decision: 'changes_requested',
      reason: 'incomplete',
    });
    expect(requestDetailSchema.parse(again.json())).toMatchObject({
      stage: 'fell_to_person',
      cause: 'second_change_request',
      waitingForMe: true,
    });
    expect(server.jobs.sent).toHaveLength(jobs);
    expect((await read(employee, id)).cause).toBe('second_change_request');
    // It is not a dead end: the founder gives the work to the agent again, with a note.
    expect((await read(founder, id)).actions).toMatchObject({ reroute: true });
    const retried = await post(founder, `/api/requests/${id}/routing`, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
      note: 'Tek paragraf olsun.',
    });
    expect(retried.statusCode).toBe(200);
    expect(requestDetailSchema.parse(retried.json())).toMatchObject({
      status: 'in_progress',
      turn: { kind: 'agent', code: 'HAF-2' },
      cause: null,
    });
    expect(server.jobs.sent.slice(jobs)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
    ]);
  });

  it('the requester’s "not what I asked for" goes back to the agent with their words', async () => {
    const { id } = await open(employee);
    await route(id, ids.employee);
    const approvalId = await submit(id, ids.employee);
    await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    const before = server.jobs.sent.length;
    const withoutNote = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      reason: 'incomplete',
    });
    expect(withoutNote.statusCode).toBe(400);
    // Their own sentence is enough: the requester is not asked to pick a reason class.
    const res = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      note: 'Açılış tarihi de yazsın.',
    });
    expect(res.statusCode).toBe(200);
    expect(requestDetailSchema.parse(res.json())).toMatchObject({
      status: 'in_progress',
      stage: 'revising',
      turn: { kind: 'agent', code: 'HAF-2' },
    });
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
    ]);
    // The agent reworks once at the requester's wish. The second "not what I asked for" starts
    // nothing: the request falls to a person.
    const second = await submit(id, ids.employee);
    await post(founder, `/api/approvals/${second}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    // The requester said so once: the card says that this time the work does not go back.
    expect((await read(employee, id)).acceptance).toEqual({
      round: 2,
      returnsToAgent: false,
      inPlaceOfRequester: false,
    });
    expect(
      approvalDeskSchema
        .parse((await get(employee, '/api/approvals')).json())
        .acceptances.find((card) => card.requestId === id),
    ).toMatchObject({ round: 2, returnsToAgent: false });
    const jobs = server.jobs.sent.length;
    const again = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      note: 'Hâlâ istediğim değil.',
    });
    expect(requestDetailSchema.parse(again.json())).toMatchObject({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'second_change_request',
      turn: { kind: 'founder' },
      waitingForMe: false,
    });
    expect(server.jobs.sent).toHaveLength(jobs);
    expect((await read(founder, id)).actions).toEqual({ cancel: false, stop: true, reroute: true });
    // The founder gives the work to an agent again. That step starts fresh: nobody asked it for
    // changes, so the page says the agent is working, not correcting.
    const routedAgain = await post(founder, `/api/requests/${id}/routing`, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
    });
    expect(requestDetailSchema.parse(routedAgain.json())).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'HAF-2' },
    });
    expect((await read(employee, id)).stage).toBe('working');
  });

  it('whether "not what I asked for" goes back to the agent is counted from the requester’s answers, not from the round', async () => {
    // 8 October decision 3. A routing made while the result waited for the requester closes that
    // acceptance and the next result opens round 2; the requester has still said nothing.
    const { id } = await open(employee);
    await route(id, ids.employee);
    await post(founder, `/api/approvals/${await submit(id, ids.employee)}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    expect((await read(employee, id)).acceptance).toEqual({
      round: 1,
      returnsToAgent: true,
      inPlaceOfRequester: false,
    });
    const rerouted = await post(founder, `/api/requests/${id}/routing`, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
      note: 'Daha kısa olsun.',
    });
    expect(rerouted.statusCode).toBe(200);
    expect((await read(employee, id)).acceptance).toBeNull();
    await post(founder, `/api/approvals/${await submit(id, ids.employee)}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    expect((await read(employee, id)).acceptance).toEqual({
      round: 2,
      returnsToAgent: true,
      inPlaceOfRequester: false,
    });
    expect(
      approvalDeskSchema
        .parse((await get(employee, '/api/approvals')).json())
        .acceptances.find((card) => card.requestId === id),
    ).toMatchObject({ round: 2, returnsToAgent: true });
    // And the server does what the card says: the first answer goes back to the agent.
    const before = server.jobs.sent.length;
    const first = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      note: 'Tarih de yazsın.',
    });
    expect(requestDetailSchema.parse(first.json())).toMatchObject({
      stage: 'revising',
      turn: { kind: 'agent', code: 'HAF-2' },
    });
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
    ]);
    // After that one answer the next result is put before the requester as the last time.
    await post(founder, `/api/approvals/${await submit(id, ids.employee)}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    expect((await read(employee, id)).acceptance).toEqual({
      round: 3,
      returnsToAgent: false,
      inPlaceOfRequester: false,
    });
    const second = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      note: 'Hâlâ olmadı.',
    });
    expect(requestDetailSchema.parse(second.json())).toMatchObject({
      stage: 'fell_to_person',
      cause: 'second_change_request',
      turn: { kind: 'founder' },
    });
    expect(server.jobs.sent).toHaveLength(before + 1);
  });

  it('a rejected result closes the request and tells the requester who, why and in which words', async () => {
    const rejected = await open(employee);
    await route(rejected.id, ids.employee);
    const approvalId = await submit(rejected.id, ids.employee);
    const res = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'rejected',
      reason: 'out_of_scope',
      note: 'Bu konuda gönderi yayınlamıyoruz.',
    });
    expect(requestDetailSchema.parse(res.json())).toMatchObject({
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'rejected',
    });
    // The answer goes back to the requester also when it is no: who rejected, the reason class
    // and the approver's own words. Never the output that was rejected.
    const forRequester = await read(employee, rejected.id);
    expect(forRequester).toMatchObject({
      cause: 'rejected',
      result: null,
      closure: {
        by: { userId: ids.founder, name: 'Kurucu' },
        reason: 'out_of_scope',
        note: 'Bu konuda gönderi yayınlamıyoruz.',
      },
    });
    expect(JSON.stringify(forRequester)).not.toContain('Yeni ofisimiz açıldı.');
  });

  it('a request routed to a unit with no open agent is returned and closed: everybody reads why, nobody can act', async () => {
    // 8 October decision 2, with the founder's own example. OFY has no agent in the fixtures.
    const jobs = server.jobs.sent.length;
    const { id } = await open(employee, 'KVKK aydınlatma metni hazırlansın');
    await route(id, ids.employee, null, 'OFY');
    const returned = {
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'returned_no_agent',
      delayed: false,
      turn: { kind: 'none' },
      waitingForMe: false,
      unit: { code: 'OFY', name: 'Ofis Yönetimi ve Denetim' },
      requester: { userId: ids.employee },
    };
    const closed = {
      ...returned,
      agent: null,
      approver: null,
      // No person closed it and nobody wrote a reason: the cause and the unit say why.
      closure: null,
      approval: null,
      result: null,
      acceptance: null,
      actions: { cancel: false, stop: false, reroute: false },
    };
    // The requester, a colleague who may read it, an employee with the approval right, the founder.
    for (const session of [employee, colleague, rightHolder, founder]) {
      expect(await read(session, id)).toMatchObject(closed);
      const list = requestListSchema.parse((await get(session, '/api/requests')).json());
      expect(list.requests.find((request) => request.id === id)).toMatchObject(returned);
      const waiting = approvalDeskSchema.parse((await get(session, '/api/approvals')).json());
      expect(
        [...waiting.approvals, ...waiting.acceptances].map((card) => card.requestId),
      ).not.toContain(id);
    }
    const mine = requestListSchema.parse((await get(employee, '/api/requests?mine=true')).json());
    expect(mine.requests.find((request) => request.id === id)).toMatchObject(returned);

    // The journey keeps the routing decision. The coordinator's own reason is a model's text
    // nobody approved: the founder reads it, the requester and everybody else do not (the panel
    // tells them why with a fixed sentence built from the cause and the unit's name).
    const routing = async (session: string) =>
      (await read(session, id)).journey.filter((item) => item.kind === 'routing');
    const step = {
      round: 1,
      unit: { code: 'OFY', name: 'Ofis Yönetimi ve Denetim' },
      agent: null,
      by: null,
    };
    expect(await routing(founder)).toMatchObject([{ ...step, reason: COORDINATOR_REASON }]);
    for (const session of [employee, colleague, rightHolder]) {
      expect(await routing(session)).toMatchObject([{ ...step, reason: null }]);
      expect(JSON.stringify(await read(session, id))).not.toContain(COORDINATOR_REASON);
    }

    // Nothing is left to do with it, for anybody: it is closed.
    const url = `/api/requests/${id}`;
    for (const session of [employee, founder]) {
      const rerouted = await post(session, `${url}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect([rerouted.statusCode, errorCode(rerouted)]).toEqual([409, 'request_closed']);
      const closedAgain = await post(session, `${url}/close`, { reason: 'Gerek kalmadı.' });
      expect([closedAgain.statusCode, errorCode(closedAgain)]).toEqual([409, 'request_closed']);
      const accepted = await post(session, `${url}/acceptance`, { decision: 'approved' });
      expect([accepted.statusCode, errorCode(accepted)]).toEqual([409, 'approval_closed']);
    }
    expect(await read(employee, id)).toMatchObject(closed);
    // Only the coordinator's job was ever sent for it.
    expect(server.jobs.sent.slice(jobs)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' },
    ]);
    const [task] = await adminQuery(
      `select status, closed_by_user_id, close_reason, unit_code, initial_unit_code,
         assignee_agent_code from office.tasks where id = $1`,
      [id],
    );
    expect(task).toEqual({
      status: 'cancelled',
      closed_by_user_id: null,
      close_reason: null,
      unit_code: 'OFY',
      initial_unit_code: 'OFY',
      assignee_agent_code: null,
    });

    // The same when the unit has an open agent whose work does not cover the request: the
    // coordinator leaves the agent empty and the request is returned.
    const other = await open(employee, 'Sözleşme taslağı hazırlansın');
    await route(other.id, ids.employee, null);
    expect(await read(employee, other.id)).toMatchObject({
      ...closed,
      unit: { code: 'HAF', name: 'Kurumsal Hafıza' },
    });
  });

  it('the founder corrects the routing; the agent starts in the requester’s name', async () => {
    const { id } = await open(employee, 'Geçen ayın toplantı notlarını özetle');
    await route(id, ids.employee);
    const options = routingOptionsSchema.parse(
      (await get(founder, `/api/requests/${id}/routing-options`)).json(),
    );
    // Every unit of the company except the coordinator's own; only agents that are open here
    // and have a card version (HAF-1 is stopped, A-KES-2 has no switch).
    expect(options.units).toEqual([
      {
        code: 'HAF',
        name: 'Kurumsal Hafıza',
        agents: [{ code: 'HAF-2', name: 'Kurumsal Arama Ajanı' }],
      },
      { code: 'OFY', name: 'Ofis Yönetimi ve Denetim', agents: [] },
      { code: 'A-KES', name: 'Keşif ve Dönüşüm Danışmanlığı', agents: [] },
    ]);
    const url = `/api/requests/${id}/routing`;
    const before = server.jobs.sent.length;
    // Not the requester, not a colleague, not an employee who merely holds the approval right.
    for (const session of [employee, colleague, rightHolder]) {
      const res = await post(session, url, { unitCode: 'HAF', agentCode: 'HAF-2' });
      expect([res.statusCode, errorCode(res)]).toEqual([403, 'action_not_allowed']);
    }
    expect((await post(external, url, { unitCode: 'HAF', agentCode: 'HAF-2' })).statusCode).toBe(
      403,
    );
    // A body that tries to appoint or to set a status, and a body without an agent: a person
    // always names one (a request is not left at a unit that has nobody to do it).
    for (const body of [
      { unitCode: 'HAF', agentCode: 'HAF-2', approver: ids.employee },
      { unitCode: 'HAF', agentCode: 'HAF-2', status: 'done' },
      { unitCode: 'HAF' },
      { unitCode: 'HAF', agentCode: null },
      { unitCode: 'HAF', agentCode: '' },
      { unitCode: 'A-KES', agentCode: null, note: 'Burada beklesin.' },
      { unitCode: 'OFY', agentCode: null },
    ]) {
      const res = await post(founder, url, body);
      expect([res.statusCode, errorCode(res)]).toEqual([400, 'invalid_request']);
    }
    // The coordinator's own unit, a stopped agent, a foreign unit, an agent without a switch, an
    // agent of another unit.
    for (const body of [
      { unitCode: 'KOR', agentCode: 'KOR-1' },
      { unitCode: 'HAF', agentCode: 'HAF-1' },
      { unitCode: 'P-IST', agentCode: 'P-IST-1' },
      { unitCode: 'A-KES', agentCode: 'A-KES-2' },
      { unitCode: 'OFY', agentCode: 'HAF-2' },
    ]) {
      const res = await post(founder, url, body);
      expect([res.statusCode, errorCode(res)]).toEqual([409, 'routing_not_possible']);
    }
    // None of them moved the request or started anything.
    expect(server.jobs.sent).toHaveLength(before);
    expect(await read(founder, id)).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      unit: { code: 'HAF' },
      agent: { code: 'HAF-2' },
      actions: { cancel: false, stop: true, reroute: true },
    });
    expect(
      (await read(founder, id)).journey.filter((item) => item.kind === 'routing'),
    ).toHaveLength(1);

    const corrected = await post(founder, url, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
      note: 'Arama ajanı yapabilir.',
    });
    expect(corrected.statusCode).toBe(200);
    expect(requestDetailSchema.parse(corrected.json())).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'HAF-2' },
      agent: { code: 'HAF-2' },
    });
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
    ]);
    // Everybody who reads the request reads who corrected it and that person's note.
    const journey = (await read(employee, id)).journey.filter((item) => item.kind === 'routing');
    expect(journey).toMatchObject([
      { round: 1, agent: { code: 'HAF-2' }, by: null, reason: null },
      {
        round: 2,
        agent: { code: 'HAF-2' },
        by: { userId: ids.founder, name: 'Kurucu' },
        reason: 'Arama ajanı yapabilir.',
      },
    ]);
    const [task] = await adminQuery<{ routing_corrected: boolean; initial_unit_code: string }>(
      'select routing_corrected, initial_unit_code from office.tasks where id = $1',
      [id],
    );
    expect(task).toEqual({ routing_corrected: true, initial_unit_code: 'HAF' });
    // A closed request is not routed; a hidden one does not exist.
    await post(employee, `/api/requests/${id}/close`);
    const late = await post(founder, url, { unitCode: 'HAF', agentCode: 'HAF-2' });
    expect([late.statusCode, errorCode(late)]).toEqual([409, 'request_closed']);
    expect(
      (await post(founder, url, { unitCode: 'HAF', agentCode: 'HAF-2' }, ids.pillika)).statusCode,
    ).toBe(404);
  });

  it('the appointed approver of the unit corrects the routing and stops the work, with a reason', async () => {
    // 7 October decision 7. The right holder of this file is appointed for HAF: from then on the
    // steps routed there name that person, who may do what the founder may.
    const founderContext = { companyId: ids.arma, userId: ids.founder };
    await withContext(besidePool, founderContext, (client) =>
      client.query(
        `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'HAF', $2)`,
        [ids.arma, RIGHT_HOLDER],
      ),
    );
    try {
      const { id } = await open(employee);
      await route(id, ids.employee);
      const approver = { userId: RIGHT_HOLDER, name: 'Onay Hakkı Olan' };
      // While the agent works: not the approver's turn yet, but the acts are theirs.
      expect(await read(rightHolder, id)).toMatchObject({
        stage: 'working',
        approver,
        waitingForMe: false,
        actions: { cancel: false, stop: true, reroute: true },
      });
      await submit(id, ids.employee);
      const waiting = await read(rightHolder, id);
      expect(waiting).toMatchObject({
        stage: 'unit_approval',
        turn: { kind: 'person', ...approver },
        waitingForMe: true,
      });
      expect(waiting.approval).not.toBeNull();
      // The founder may still decide and correct; the work waits for the appointed person.
      expect(await read(founder, id)).toMatchObject({
        waitingForMe: false,
        actions: { stop: true, reroute: true },
      });

      // The approver corrects the routing: the result that waited is closed, the agent starts
      // again in the requester's name, and everybody reads who corrected it and the note.
      const before = server.jobs.sent.length;
      const corrected = await post(rightHolder, `/api/requests/${id}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
        note: 'Kaynakları da yazsın.',
      });
      expect(corrected.statusCode).toBe(200);
      expect(requestDetailSchema.parse(corrected.json())).toMatchObject({
        status: 'in_progress',
        stage: 'working',
        approver,
        approval: null,
        actions: { cancel: false, stop: true, reroute: true },
      });
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
      ]);
      expect(
        (await read(employee, id)).journey.filter((item) => item.kind === 'routing').at(-1),
      ).toMatchObject({ round: 2, by: approver, reason: 'Kaynakları da yazsın.', approver });

      // The approver stops the work: a reason is asked for, and the requester reads it.
      const silent = await post(rightHolder, `/api/requests/${id}/close`);
      expect([silent.statusCode, errorCode(silent)]).toEqual([409, 'reason_required']);
      const stopped = await post(rightHolder, `/api/requests/${id}/close`, {
        reason: 'Bu konu bu ay yayınlanmayacak.',
      });
      expect(stopped.statusCode).toBe(200);
      expect(await read(employee, id)).toMatchObject({
        status: 'cancelled',
        cause: 'stopped',
        closure: { by: approver, reason: null, note: 'Bu konu bu ay yayınlanmayacak.' },
      });
      const [trace] = await adminQuery(
        `select event, user_id from office.audit_log
         where record_type = 'task' and record_id = $1 and event like 'request_%'
         order by id desc limit 1`,
        [id],
      );
      expect(trace).toEqual({ event: 'request_stopped', user_id: RIGHT_HOLDER });

      // A request of another unit's step is not theirs: the same person, appointed for HAF only,
      // on a request nobody routed yet.
      const unrouted = await open(employee);
      expect((await read(rightHolder, unrouted.id)).actions).toEqual({
        cancel: false,
        stop: false,
        reroute: false,
      });
      const notTheirs = await post(rightHolder, `/api/requests/${unrouted.id}/close`, {
        reason: 'x',
      });
      expect([notTheirs.statusCode, errorCode(notTheirs)]).toEqual([403, 'action_not_allowed']);
    } finally {
      await withContext(besidePool, founderContext, (client) =>
        client.query(
          `delete from office.approvers where company_id = $1 and unit_code = 'HAF' and user_id = $2`,
          [ids.arma, RIGHT_HOLDER],
        ),
      );
    }
  });

  it('a request the coordinator could not route is routed by the founder: the first routing by a person', async () => {
    // Every "fell to a person" sentence before the routing promises this way on.
    const { id } = await open(employee, 'Bu talebi koordinasyon merkezi yönlendiremedi');
    await agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode: 'KOR-1' },
      (client) =>
        client.query(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model, status, finished_at, summary, output)
           values ($1, $2, 'KOR-1', $3, 'request', 'test-model', 'completed', now(),
             'Koordinasyon merkezi talebi bir birime yönlendirmeden çalışmasını bitirdi.', $4)`,
          [ids.arma, id, CARD_KOR, JSON.stringify({ outcome: 'no_routing' })],
        ),
    );
    const fallen = {
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_routing',
      turn: { kind: 'founder' },
      unit: null,
      agent: null,
    };
    expect(await read(employee, id)).toMatchObject({
      ...fallen,
      waitingForMe: false,
      actions: { cancel: true, stop: false, reroute: false },
    });
    expect(await read(founder, id)).toMatchObject({
      ...fallen,
      waitingForMe: true,
      actions: { cancel: false, stop: true, reroute: true },
    });
    const url = `/api/requests/${id}/routing`;
    const before = server.jobs.sent.length;
    // Not the requester's to do, nor an employee's who merely holds the approval right.
    for (const session of [employee, rightHolder]) {
      const res = await post(session, url, { unitCode: 'HAF', agentCode: 'HAF-2' });
      expect([res.statusCode, errorCode(res)]).toEqual([403, 'action_not_allowed']);
    }
    expect(
      routingOptionsSchema
        .parse((await get(founder, `${url}-options`)).json())
        .units.find((unit) => unit.code === 'HAF')?.agents,
    ).toEqual([{ code: 'HAF-2', name: 'Kurumsal Arama Ajanı' }]);
    const routed = await post(founder, url, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
      note: 'Arşivde arasın.',
    });
    expect(routed.statusCode).toBe(200);
    const detail = requestDetailSchema.parse(routed.json());
    expect(detail).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'HAF-2' },
      unit: { code: 'HAF' },
      agent: { code: 'HAF-2' },
    });
    expect(detail.journey.filter((item) => item.kind === 'routing')).toMatchObject([
      {
        round: 1,
        unit: { code: 'HAF' },
        agent: { code: 'HAF-2' },
        by: { userId: ids.founder, name: 'Kurucu' },
        reason: 'Arşivde arasın.',
      },
    ]);
    // The agent's run is called for in the requester's name.
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
    ]);
    // A first routing is not a correction of one: the "first time right" count is untouched.
    expect(
      await adminQuery(
        'select routing_corrected, initial_unit_code from office.tasks where id = $1',
        [id],
      ),
    ).toEqual([{ routing_corrected: false, initial_unit_code: 'HAF' }]);
  });

  it('what an agent wrote without submitting is read by the decider alone', async () => {
    const { id } = await open(employee);
    await route(id, ids.employee);
    const draft = 'ONAYSIZ TASLAK: Yeni ofisimiz açıldı, hepinizi bekleriz.';
    // The unit agent's run ended without its tool: the runner stores a fixed sentence as the
    // summary and the model's text in the run's output.
    await agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode: 'HAF-2' },
      async (client) => {
        await client.query(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model, status, finished_at, summary, output)
           values ($1, $2, 'HAF-2', $3, 'handoff', 'test-model', 'completed', now(),
             'Ajan sonucu onaya sunmadan çalışmasını bitirdi.', $4)`,
          [ids.arma, id, CARD_HAF, JSON.stringify({ outcome: 'no_submission', final_text: draft })],
        );
      },
    );
    for (const session of [employee, colleague, rightHolder]) {
      const seen = await read(session, id);
      expect(seen).toMatchObject({ stage: 'fell_to_person', cause: 'no_submission' });
      expect(JSON.stringify(seen)).not.toContain('ONAYSIZ TASLAK');
      expect(seen.journey.findLast((item) => item.kind === 'run')).toMatchObject({
        summary: 'Ajan sonucu onaya sunmadan çalışmasını bitirdi.',
        agentText: null,
      });
    }
    const forFounder = await read(founder, id);
    expect(forFounder.journey.findLast((item) => item.kind === 'run')).toMatchObject({
      agentText: draft,
    });
    const list = requestListSchema.parse((await get(employee, '/api/requests')).json());
    expect(JSON.stringify(list)).not.toContain('ONAYSIZ TASLAK');
  });

  it('a request is taken only where the coordinator can run it for this person', async () => {
    const intake = async (session: string, company: string = ids.arma) =>
      requestIntakeSchema.parse((await get(session, '/api/requests/intake', company)).json());
    const refused = async (session: string): Promise<string> => {
      const id = randomUUID();
      const res = await post(session, '/api/requests', { id, text: 'Bir gönderi yaz' });
      expect([res.statusCode, errorCode(res)]).toEqual([409, 'requests_not_open']);
      // Nothing was stored and nothing was put on the queue.
      expect(await adminQuery('select 1 from office.tasks where id = $1', [id])).toEqual([]);
      return apiErrorSchema.parse(res.json()).error.message;
    };
    const jobs = server.jobs.sent.length;
    expect(await intake(employee)).toEqual({ open: true, reason: null });
    expect(await intake(founder, ids.founderSpace)).toEqual({
      open: false,
      reason: 'private_space',
    });
    expect((await get(external, '/api/requests/intake')).statusCode).toBe(403);
    // The database and the contract name the same coordinator.
    expect(await adminQuery('select office.coordinator_agent_code() as code')).toEqual([
      { code: COORDINATOR_AGENT_CODE },
    ]);
    try {
      // A card on trial runs for the founder only: nobody else is let in to send a request that
      // would die at once.
      await adminExec(
        `update office.card_versions set content = '{"card": {"status": "trial"}}'
         where id = '${CARD_KOR}'`,
      );
      expect(await intake(employee)).toEqual({ open: false, reason: 'trial_founder_only' });
      expect(await refused(employee)).toMatch(/deneme aşamasında/);
      expect(await intake(founder)).toEqual({ open: true, reason: null });
      await open(founder);
      // The coordinator is stopped in this company.
      await put(founder, `/api/agents/${COORDINATOR_AGENT_CODE}/switch`, { status: 'stopped' });
      expect(await intake(founder)).toEqual({ open: false, reason: 'coordinator_closed' });
      expect(await refused(founder)).toMatch(/açık değil/);
      await put(founder, `/api/agents/${COORDINATOR_AGENT_CODE}/switch`, { status: 'enabled' });
      // Its card has no version to run with (the definitions were never synchronised), or is a
      // draft.
      await adminExec(
        `update office.agent_definitions set current_version_id = null where code = 'KOR-1'`,
      );
      expect(await intake(founder)).toEqual({ open: false, reason: 'coordinator_not_ready' });
      expect(await refused(founder)).toMatch(/hazır değil/);
      await adminExec(`
        update office.agent_definitions set current_version_id = '${CARD_KOR}' where code = 'KOR-1';
        update office.card_versions set content = '{"card": {"status": "draft"}}'
          where id = '${CARD_KOR}';
      `);
      expect(await intake(founder)).toEqual({ open: false, reason: 'coordinator_not_ready' });
    } finally {
      await adminExec(`
        update office.agent_definitions set current_version_id = '${CARD_KOR}' where code = 'KOR-1';
        update office.card_versions set content = '{"card": {"status": "active"}}'
          where id = '${CARD_KOR}';
      `);
      await put(founder, `/api/agents/${COORDINATOR_AGENT_CODE}/switch`, { status: 'enabled' });
    }
    // One request was taken (the founder's, on trial) and one job sent.
    expect(server.jobs.sent).toHaveLength(jobs + 1);
  });

  it('approving work that goes outside asks for the passkey, for exactly this option', async () => {
    await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
    const { id } = await open(employee);
    await route(id, ids.employee);
    const approvalId = await submit(id, ids.employee, { goesExternal: true });
    expect((await read(founder, id)).approval).toMatchObject({
      goesExternal: true,
      needsStepUp: true,
    });
    const url = `/api/approvals/${approvalId}/decision`;
    const bare = await post(founder, url, { decision: 'approved', selectedOption: 'A' });
    expect([bare.statusCode, errorCode(bare)]).toEqual([403, 'step_up_required']);
    const stepUpFor = (option: string) =>
      signStepUp(server, founder, founderKey, {
        purpose: 'approve',
        companyId: ids.arma,
        subjectId: approvalId,
        details: approvalDecisionDetails(option),
      });
    // A re-verification made for option A does not approve option B.
    const other = await post(founder, url, {
      decision: 'approved',
      selectedOption: 'B',
      stepUp: await stepUpFor('A'),
    });
    expect(other.statusCode).toBe(403);
    expect((await read(founder, id)).stage).toBe('unit_approval');
    // Sending the work back needs no passkey; approving with the right one works.
    const approved = await post(founder, url, {
      decision: 'approved',
      selectedOption: 'B',
      stepUp: await stepUpFor('B'),
    });
    expect(approved.statusCode).toBe(200);
    expect(requestDetailSchema.parse(approved.json()).stage).toBe('requester_approval');
  });

  it('the requester cancels, the founder stops, nobody else closes', async () => {
    const mine = await open(employee);
    const other = await post(colleague, `/api/requests/${mine.id}/close`);
    expect([other.statusCode, errorCode(other)]).toEqual([403, 'action_not_allowed']);
    expect((await read(colleague, mine.id)).actions).toEqual({
      cancel: false,
      stop: false,
      reroute: false,
    });
    const cancelled = await post(employee, `/api/requests/${mine.id}/close`);
    expect(requestDetailSchema.parse(cancelled.json())).toMatchObject({
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'cancelled_by_requester',
      closure: { by: { userId: ids.employee }, reason: null, note: null },
    });
    const again = await post(employee, `/api/requests/${mine.id}/close`);
    expect([again.statusCode, errorCode(again)]).toEqual([409, 'request_closed']);

    const theirs = await open(employee);
    await route(theirs.id, ids.employee);
    const approvalId = await submit(theirs.id, ids.employee);
    expect((await read(founder, theirs.id)).actions).toEqual({
      cancel: false,
      stop: true,
      reroute: true,
    });
    // Whoever stops somebody else's request says why; the requester reads it.
    const silent = await post(founder, `/api/requests/${theirs.id}/close`);
    expect([silent.statusCode, errorCode(silent)]).toEqual([409, 'reason_required']);
    expect(
      (await post(founder, `/api/requests/${theirs.id}/close`, { status: 'done' })).statusCode,
    ).toBe(400);
    const stopped = await post(founder, `/api/requests/${theirs.id}/close`, {
      reason: 'Bu iş bu hafta yapılmayacak.',
    });
    expect(requestDetailSchema.parse(stopped.json())).toMatchObject({
      status: 'cancelled',
      cause: 'stopped',
      closure: {
        by: { userId: ids.founder, name: 'Kurucu' },
        reason: null,
        note: 'Bu iş bu hafta yapılmayacak.',
      },
      approval: null,
    });
    expect((await read(employee, theirs.id)).closure).toMatchObject({
      by: { name: 'Kurucu' },
      note: 'Bu iş bu hafta yapılmayacak.',
    });
    // The result that waited was closed with the request.
    const late = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    expect([late.statusCode, errorCode(late)]).toEqual([409, 'approval_closed']);

    // Stopped while the approved result waited for a requester who did not answer: the work was
    // delivered, and the page says so instead of "cancelled".
    const delivered = await open(employee);
    await route(delivered.id, ids.employee);
    const deliveredApproval = await submit(delivered.id, ids.employee);
    await post(founder, `/api/approvals/${deliveredApproval}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    const closed = await post(founder, `/api/requests/${delivered.id}/close`, {
      reason: 'Talep sahibi izinde; metin yayınlandı.',
    });
    expect(requestDetailSchema.parse(closed.json())).toMatchObject({
      status: 'cancelled',
      cause: 'closed_after_delivery',
      result: { approvalId: deliveredApproval, option: { code: 'A' } },
      acceptance: null,
    });
  });

  // The acts around an opening (8 October decision 49), for the cases below and for the cases of
  // a project further down.
  const SWITCH = '/api/agents/HAF-2/switch';
  const stop = () => put(founder, SWITCH, { status: 'stopped' });
  /** Opens HAF-2 and answers how many waiting requests the opening started. */
  async function openAgain(): Promise<number> {
    const res = await put(founder, SWITCH, { status: 'enabled' });
    expect(res.statusCode, res.body).toBe(200);
    return agentOpenResponseSchema.parse(res.json()).restarted;
  }
  /** The number the confirmation of an opening is told. */
  async function waitingFor(query: string): Promise<number> {
    const res = await get(founder, `/api/waiting-work?${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return waitingWorkResponseSchema.parse(res.json()).waiting;
  }
  const traceOf = (id: string) =>
    adminQuery(
      `select event, user_id, agent_code from office.audit_log
       where record_type = 'task' and record_id = $1 and event like 'run_%' order by id`,
      [id],
    );
  /** What the runner leaves when it refuses a job at its gate: one row, in the agent's context. */
  const refusedAtTheGate = (taskId: string, agentCode: string, projectId: string | null = null) =>
    agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode, projectId },
      (client) =>
        client.query(
          `insert into office.audit_log (company_id, project_id, event, record_type, record_id)
           values (office.ctx_company_id(), office.ctx_project_id(), 'run_refused', 'task', $1)`,
          [taskId],
        ),
    );
  /** A run of HAF-2 on the request, left open. */
  const openRun = (taskId: string, projectId: string | null = null): Promise<string> =>
    agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode: 'HAF-2', projectId },
      async (client) => {
        const run = await client.query<{ id: string }>(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id,
             trigger_type, model) values ($1, $2, 'HAF-2', $3, 'handoff', 'test-model')
           returning id`,
          [ids.arma, taskId, CARD_HAF],
        );
        return run.rows[0]?.id ?? '';
      },
    );
  /** The runner ends the run at its next step. */
  const endRun = (runId: string, status: 'stopped' | 'failed', code: string) =>
    agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode: 'HAF-2' },
      (client) =>
        client.query(
          `update office.runs set status = $2, finished_at = now(), error_code = $3
           where id = $1`,
          [runId, status, code],
        ),
    );
  /**
   * Earlier cases of this file left requests that wait for HAF-2. One stop and one opening
   * start them once, so that a case counts only its own.
   */
  async function settle(): Promise<void> {
    await stop();
    await openAgain();
    expect(await waitingFor('agent=HAF-2')).toBe(0);
  }

  // 8 October decision 49: the work that waited for a stopped agent starts again by itself when
  // the founder opens the agent. (Until that decision it stayed with a person, who had to route
  // the request again; the cases below pinned that rule and now pin the new one.)
  describe('waiting work starts again when its agent is opened', () => {
    const expectedOf = async (session: string): Promise<string[]> =>
      todaySchema.parse((await get(session, '/api/today')).json()).expected.map((item) => item.id);

    const stoppedAgent = {
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'agent_stopped',
      turn: { kind: 'founder' },
    };
    const notStarted = {
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'not_started',
      delayed: false,
      turn: { kind: 'founder' },
    };

    it('opening a stopped agent restarts exactly the waiting work once and says how many', async () => {
      await settle();
      // (1) The approver asks for changes while the agent is stopped.
      const first = await open(employee);
      await route(first.id, ids.employee);
      const approvalId = await submit(first.id, ids.employee);
      // (2) The requester says "not what I asked for" while the agent is stopped.
      const second = await open(employee);
      await route(second.id, ids.employee);
      await post(founder, `/api/approvals/${await submit(second.id, ids.employee)}/decision`, {
        decision: 'approved',
        selectedOption: 'A',
      });
      // (3) A job the runner refuses at its gate because the agent is stopped when it arrives.
      const third = await open(employee);
      await route(third.id, ids.employee);
      // (4) A run that is open when the switch is stopped; the runner ends it at its next step.
      const fourth = await open(employee);
      await route(fourth.id, ids.employee);
      const stoppedRun = await openRun(fourth.id);
      // (5) A run that failed: a person decides that one, and an opening does not touch it.
      const failed = await open(employee);
      await route(failed.id, ids.employee);
      await endRun(await openRun(failed.id), 'failed', 'runner_error');
      const waitingIds = [first.id, second.id, third.id, fourth.id];
      // The agent is open: an opening would start nothing.
      expect(await waitingFor('agent=HAF-2')).toBe(0);

      const jobs = server.jobs.sent.length;
      expect((await stop()).json()).not.toHaveProperty('restarted');
      const sentBack = await post(founder, `/api/approvals/${approvalId}/decision`, {
        decision: 'changes_requested',
        reason: 'incomplete',
      });
      expect(requestDetailSchema.parse(sentBack.json())).toMatchObject(stoppedAgent);
      const refusedResult = await post(employee, `/api/requests/${second.id}/acceptance`, {
        decision: 'changes_requested',
        note: 'Açılış tarihi de yazsın.',
      });
      expect(requestDetailSchema.parse(refusedResult.json())).toMatchObject(stoppedAgent);
      await refusedAtTheGate(third.id, 'HAF-2');
      await endRun(stoppedRun, 'stopped', 'agent_stopped');

      // While the agent is stopped: nothing was put on the queue, every one of the four reads
      // "ajan durduruldu" and stands on the list of the one who decides (here the founder).
      expect(server.jobs.sent).toHaveLength(jobs);
      expect(await traceOf(first.id)).toEqual([
        { event: 'run_not_started', user_id: ids.founder, agent_code: null },
      ]);
      expect(await traceOf(second.id)).toEqual([
        { event: 'run_not_started', user_id: ids.employee, agent_code: null },
      ]);
      for (const id of waitingIds) {
        expect(await read(employee, id), id).toMatchObject({
          ...stoppedAgent,
          waitingForMe: false,
        });
        expect(await read(founder, id), id).toMatchObject({
          ...stoppedAgent,
          waitingForMe: true,
          actions: { cancel: false, stop: true, reroute: true },
        });
      }
      expect(await expectedOf(founder)).toEqual(expect.arrayContaining([...waitingIds, failed.id]));
      // The confirmation of the opening is told the number first.
      expect(await waitingFor('agent=HAF-2')).toBe(4);
      expect(await waitingFor('agent=KOR-1')).toBe(0);

      // The opening starts exactly those four, and says so.
      expect(await openAgain()).toBe(4);
      const sent = server.jobs.sent.slice(jobs);
      expect(sent).toHaveLength(4);
      expect(sent).toEqual(
        expect.arrayContaining(
          waitingIds.map((taskId) => ({
            companyId: ids.arma,
            // The job names the requester, whoever opened the agent.
            userId: ids.employee,
            taskId,
            agentCode: 'HAF-2',
          })),
        ),
      );
      // One trace on each request, in the founder's name, after the trace of the missed start.
      const restarted = { event: 'run_restarted', user_id: ids.founder, agent_code: null };
      expect(await traceOf(first.id)).toEqual([
        { event: 'run_not_started', user_id: ids.founder, agent_code: null },
        restarted,
      ]);
      expect(await traceOf(second.id)).toEqual([
        { event: 'run_not_started', user_id: ids.employee, agent_code: null },
        restarted,
      ]);
      expect(await traceOf(third.id)).toEqual([
        { event: 'run_refused', user_id: ids.employee, agent_code: 'HAF-2' },
        restarted,
      ]);
      expect(await traceOf(fourth.id)).toEqual([restarted]);
      expect(await traceOf(failed.id)).toEqual([]);
      expect(
        await adminQuery(
          `select event, user_id from office.audit_log
           where record_type = 'company_agent' order by id desc limit 1`,
        ),
      ).toEqual([{ event: 'agent_enabled', user_id: ids.founder }]);

      // The page and Bugün, afterwards: the agent has the turn again and nobody is waited for.
      for (const [id, stage] of [
        [first.id, 'revising'],
        [second.id, 'revising'],
        [third.id, 'working'],
        [fourth.id, 'working'],
      ] as const) {
        for (const reader of [founder, employee]) {
          expect(await read(reader, id), id).toMatchObject({
            status: 'in_progress',
            stage,
            cause: null,
            delayed: false,
            turn: { kind: 'agent', code: 'HAF-2' },
            waitingForMe: false,
          });
        }
      }
      const list = requestListSchema.parse((await get(employee, '/api/requests')).json());
      expect(list.requests.find((request) => request.id === third.id)).toMatchObject({
        stage: 'working',
        cause: null,
      });
      const after = await expectedOf(founder);
      for (const id of waitingIds) {
        expect(after, id).not.toContain(id);
      }
      // The run that failed is as it was: with a person.
      expect(after).toContain(failed.id);
      expect(await read(founder, failed.id)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'run_failed',
        waitingForMe: true,
      });

      // Exactly once: the same opening again, and a stop and an opening, start nothing more.
      expect(await waitingFor('agent=HAF-2')).toBe(0);
      expect(await openAgain()).toBe(0);
      await stop();
      expect(await waitingFor('agent=HAF-2')).toBe(0);
      expect(await openAgain()).toBe(0);
      expect(server.jobs.sent).toHaveLength(jobs + 4);
      for (const id of waitingIds) {
        expect(
          (await traceOf(id)).filter((row) => row.event === 'run_restarted'),
          id,
        ).toHaveLength(1);
      }

      // A restarted job that the runner refuses again reads "çalışma başlamadı": the agent is
      // open, so the switch does not explain it, and a person routes the request again.
      await refusedAtTheGate(third.id, 'HAF-2');
      expect(await read(employee, third.id)).toMatchObject({ ...notStarted, waitingForMe: false });
      expect(await read(founder, third.id)).toMatchObject({
        ...notStarted,
        waitingForMe: true,
        actions: { cancel: false, stop: true, reroute: true },
      });
      // It is waiting work again (the next opening would take it), and the way on that does not
      // wait for one is the founder's: the work is given to the agent again, and a job is sent.
      expect(await waitingFor('agent=HAF-2')).toBe(1);
      const again = await post(founder, `/api/requests/${third.id}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect(requestDetailSchema.parse(again.json())).toMatchObject({
        stage: 'working',
        cause: null,
        turn: { kind: 'agent', code: 'HAF-2' },
      });
      expect(server.jobs.sent.slice(jobs + 4)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: third.id, agentCode: 'HAF-2' },
      ]);
      expect(await waitingFor('agent=HAF-2')).toBe(0);
    });

    it('opening an agent that was already open, and a first opening, restart nothing; a stop answers without a count', async () => {
      await settle();
      // Work that waits while the agent is open: its job was refused at the gate.
      const { id } = await open(employee);
      await route(id, ids.employee);
      await refusedAtTheGate(id, 'HAF-2');
      expect(await read(founder, id)).toMatchObject(notStarted);
      const jobs = server.jobs.sent.length;
      // The agent is open already: this request opens nothing, so it starts nothing.
      expect(await openAgain()).toBe(0);
      expect(server.jobs.sent).toHaveLength(jobs);
      expect(await read(founder, id)).toMatchObject(notStarted);
      expect((await traceOf(id)).map((row) => row.event)).toEqual(['run_refused']);

      // A stop says nothing about waiting work, plainly or "only if open".
      const stopped = await stop();
      expect(stopped.statusCode).toBe(200);
      expect(stopped.json()).toEqual({
        code: 'HAF-2',
        name: 'Kurumsal Arama Ajanı',
        status: 'stopped',
        ready: true,
      });
      const already = await put(founder, SWITCH, { status: 'stopped', onlyIfOpen: true });
      expect(already.json()).toEqual({
        code: 'HAF-2',
        name: 'Kurumsal Arama Ajanı',
        status: 'stopped',
        ready: true,
        changed: false,
      });
      // Opened from stopped, the one request that waited starts.
      expect(await openAgain()).toBe(1);
      expect(server.jobs.sent.slice(jobs)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
      ]);

      // A first opening: Pillika never had a switch for HAF-2, so nothing can wait for it there.
      expect(
        await adminQuery(
          `select 1 from office.company_agents where company_id = $1 and agent_code = 'HAF-2'`,
          [ids.pillika],
        ),
      ).toEqual([]);
      const first = await send(server, founder, 'PUT', SWITCH, {
        company: ids.pillika,
        payload: { status: 'enabled' },
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(agentOpenResponseSchema.parse(first.json())).toMatchObject({
        status: 'enabled',
        restarted: 0,
      });
      expect(server.jobs.sent).toHaveLength(jobs + 1);
      await adminQuery(
        `delete from office.company_agents where company_id = $1 and agent_code = 'HAF-2'`,
        [ids.pillika],
      );
    });

    it('the opening, the traces and the jobs are stored together', async () => {
      await settle();
      const waiting: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const { id } = await open(employee);
        await route(id, ids.employee);
        waiting.push(id);
      }
      await stop();
      for (const id of waiting) {
        await refusedAtTheGate(id, 'HAF-2');
      }
      const [mark] = await adminQuery<{ id: string }>(
        'select coalesce(max(id), 0)::text as id from office.audit_log',
      );
      // What an opening writes: the opening itself and one restart per request.
      const audit = async () =>
        adminQuery(
          `select event from office.audit_log
           where id > $1 and event in ('agent_enabled', 'run_restarted') order by id`,
          [mark?.id ?? '0'],
        );
      // The queue takes the first job and fails at the second.
      const jobs = server.jobs.sent.length;
      let calls = 0;
      const send = vi.spyOn(server.jobs, 'send').mockImplementation(async (client) => {
        calls += 1;
        await client.query('select 1');
        if (calls === 2) {
          throw new Error('The queue is not reachable');
        }
      });
      try {
        const res = await put(founder, SWITCH, { status: 'enabled' });
        expect([res.statusCode, errorCode(res)]).toEqual([500, 'internal_error']);
      } finally {
        send.mockRestore();
      }
      expect(calls).toBe(2);
      // Nothing of the opening stayed: the switch is still stopped, no request carries the trace
      // of a restart, and the audit log knows no opening. (The job of the real queue is a row
      // written through the same connection, so it goes with the transaction; apps/worker tests
      // that with the queue itself.)
      expect(
        await adminQuery(
          `select status from office.company_agents where company_id = $1 and agent_code = 'HAF-2'`,
          [ids.arma],
        ),
      ).toEqual([{ status: 'stopped' }]);
      expect(await audit()).toEqual([]);
      for (const id of waiting) {
        expect(await read(founder, id), id).toMatchObject(stoppedAgent);
      }
      expect(await waitingFor('agent=HAF-2')).toBe(2);
      // The founder tries again: now both start.
      expect(await openAgain()).toBe(2);
      expect(
        server.jobs.sent
          .slice(jobs)
          .map((job) => job.taskId)
          .sort(),
      ).toEqual([...waiting].sort());
      expect((await audit()).map((row) => row.event).sort()).toEqual([
        'agent_enabled',
        'run_restarted',
        'run_restarted',
      ]);
    });

    it('GET /api/waiting-work: only the founder, with exactly one scope; nothing of another company is counted', async () => {
      for (const session of [employee, rightHolder, external]) {
        const res = await get(session, '/api/waiting-work?agent=HAF-2');
        expect([res.statusCode, errorCode(res)]).toEqual([403, 'founder_only']);
      }
      const id = randomUUID();
      for (const query of [
        '',
        `agent=HAF-2&project=${id}`,
        `project=${id}&customer=${id}`,
        'project=x',
        'customer=',
        'agent=haf%202',
        'agent=HAF-2&mine=true',
        `company=${id}`,
      ]) {
        const res = await get(founder, `/api/waiting-work?${query}`);
        expect([res.statusCode, errorCode(res)], query).toEqual([400, 'invalid_request']);
      }
      // A project, a customer and an agent that are not of this company count nothing.
      expect(await waitingFor(`project=${id}`)).toBe(0);
      expect(await waitingFor(`customer=${id}`)).toBe(0);
      expect(await waitingFor('agent=P-IST-1')).toBe(0);
      // And the founder of Arma DX, asking in Pillika's name, is told nothing of Arma DX.
      await settle();
      const waits = await open(employee);
      await route(waits.id, ids.employee);
      await stop();
      await refusedAtTheGate(waits.id, 'HAF-2');
      try {
        expect(await waitingFor('agent=HAF-2')).toBe(1);
        const elsewhere = await get(founder, '/api/waiting-work?agent=HAF-2', ids.pillika);
        expect(waitingWorkResponseSchema.parse(elsewhere.json())).toEqual({ waiting: 0 });
        // Counting wrote nothing and started nothing.
        expect((await traceOf(waits.id)).map((row) => row.event)).toEqual(['run_refused']);
      } finally {
        await openAgain();
      }
    });

    it('a job the runner refused although the agent is open reads çalışma başlamadı until a person routes the request', async () => {
      // A refusal that is about another agent says nothing about this step: a stale job of the
      // coordinator on a request that is routed.
      const routed = await open(employee);
      await route(routed.id, ids.employee);
      await refusedAtTheGate(routed.id, COORDINATOR_AGENT_CODE);
      expect(await read(employee, routed.id)).toMatchObject({ stage: 'working', cause: null });

      // Before the routing: the coordinator's job was refused before a run existed. The founder
      // makes the first routing.
      const unrouted = await open(employee);
      expect(await read(founder, unrouted.id)).toMatchObject({ stage: 'routing', cause: null });
      await refusedAtTheGate(unrouted.id, COORDINATOR_AGENT_CODE);
      expect(await read(employee, unrouted.id)).toMatchObject({
        ...notStarted,
        status: 'open',
        waitingForMe: false,
      });
      expect(await read(founder, unrouted.id)).toMatchObject({
        ...notStarted,
        status: 'open',
        waitingForMe: true,
        actions: { cancel: false, stop: true, reroute: true },
      });
      const byHand = await post(founder, `/api/requests/${unrouted.id}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect(requestDetailSchema.parse(byHand.json())).toMatchObject({
        status: 'in_progress',
        stage: 'working',
        cause: null,
      });
    });
  });

  /** Resolves when a request the server is handling waits for a lock another transaction holds. */
  async function untilServerWaits(): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const waiting = await adminQuery(
        `select 1 from pg_catalog.pg_stat_activity
         where application_name = 'agent-office-api-test' and wait_event_type = 'Lock'
           and state = 'active'`,
      );
      if (waiting.length > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('No request of the server waited for a lock');
  }

  it('a decision and the requester’s answer take the request’s lock first, as a close does', async () => {
    const founderContext = { companyId: ids.arma, userId: ids.founder };
    // Is this row free to lock (nobody holds it)? Asked with the privileged role, in one statement.
    const free = async (table: string, column: string, value: string): Promise<boolean> => {
      try {
        await adminQuery(`select 1 from office.${table} where ${column} = $1 for update nowait`, [
          value,
        ]);
        return true;
      } catch {
        return false;
      }
    };
    const { id } = await open(employee);
    await route(id, ids.employee);
    const approvalId = await submit(id, ids.employee);

    // Somebody holds the request, as a close or a correction of the routing does from its first
    // statement. The decision waits for the request and has not touched the approval.
    let decision: Promise<LightMyRequestResponse> | undefined;
    await withContext(besidePool, founderContext, async (holder) => {
      await holder.query('select office.lock_request($1)', [id]);
      decision = post(founder, `/api/approvals/${approvalId}/decision`, {
        decision: 'approved',
        selectedOption: 'A',
      });
      await untilServerWaits();
      expect(await free('approvals', 'id', approvalId)).toBe(true);
    });
    const approved = await decision;
    expect(approved?.statusCode).toBe(200);

    // The same for the requester's answer.
    let answer: Promise<LightMyRequestResponse> | undefined;
    await withContext(besidePool, founderContext, async (holder) => {
      await holder.query('select office.lock_request($1)', [id]);
      answer = post(employee, `/api/requests/${id}/acceptance`, { decision: 'approved' });
      await untilServerWaits();
      expect(await free('requester_approvals', 'task_id', id)).toBe(true);
    });
    const accepted = await answer;
    expect(accepted?.statusCode).toBe(200);
    expect(requestDetailSchema.parse(accepted?.json()).status).toBe('done');

    // The lock is for a person who may read the request: it is nothing to an outsider, to another
    // company's context or to the worker's role.
    await withContext(besidePool, { companyId: ids.arma, userId: ids.external }, async (client) => {
      await client.query('select office.lock_request($1)', [id]);
      expect(await free('tasks', 'id', id)).toBe(true);
    });
    await withContext(
      besidePool,
      { companyId: ids.pillika, userId: ids.founder },
      async (client) => {
        await client.query('select office.lock_request($1)', [id]);
        expect(await free('tasks', 'id', id)).toBe(true);
      },
    );
    await expect(
      agentStep(
        workerPool,
        { companyId: ids.arma, userId: ids.employee, agentCode: 'KOR-1' },
        (client) => client.query('select office.lock_request($1)', [id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('the loser of a deadlock is told that the request changed, not that the server failed', async () => {
    const { id } = await open(employee);
    await route(id, ids.employee);
    const approvalId = await submit(id, ids.employee);
    // An order no route takes any more: the approval is held first, then the request is asked
    // for. The requester's cancel holds the request and waits for the approval; the decision then
    // waits for the step the cancel has closed. PostgreSQL ends the one that waited first.
    let cancel: Promise<LightMyRequestResponse> | undefined;
    await withContext(besidePool, { companyId: ids.arma, userId: ids.founder }, async (holder) => {
      await holder.query('select 1 from office.approvals where id = $1 for update', [approvalId]);
      cancel = post(employee, `/api/requests/${id}/close`);
      await untilServerWaits();
      await holder.query(
        `update office.approvals set status = 'rejected', rejection_reason = 'out_of_scope'
           where id = $1`,
        [approvalId],
      );
    });
    const lost = await cancel;
    expect([lost?.statusCode, lost === undefined ? null : errorCode(lost)]).toEqual([
      409,
      'request_changed',
    ]);
    expect(apiErrorSchema.parse(lost?.json()).error.message).toBe(
      'Bu talep az önce değişti. Sayfayı yenileyip yeniden deneyin.',
    );
    // The other act stands: the page the person reads again says what happened.
    expect(await read(employee, id)).toMatchObject({ status: 'cancelled', cause: 'rejected' });
  });

  it('only the founder opens and stops an agent, and only an agent of the company', async () => {
    const byEmployee = await put(employee, '/api/agents/HAF-2/switch', { status: 'stopped' });
    expect([byEmployee.statusCode, errorCode(byEmployee)]).toEqual([403, 'founder_only']);
    expect(
      (await put(founder, '/api/agents/HAF-2/switch', { status: 'disabled' })).statusCode,
    ).toBe(400);
    expect((await put(founder, '/api/agents/XYZ-9/switch', { status: 'enabled' })).statusCode).toBe(
      404,
    );
    // P-IST-1's card names Pillika only.
    const foreign = await put(founder, '/api/agents/P-IST-1/switch', { status: 'enabled' });
    expect([foreign.statusCode, errorCode(foreign)]).toEqual([409, 'agent_not_available']);
    // An agent whose card has no version cannot be opened: it could be given a request and would
    // never start. Nothing is written.
    const notReady = await put(founder, '/api/agents/KOR-2/switch', { status: 'enabled' });
    expect([notReady.statusCode, errorCode(notReady)]).toEqual([409, 'agent_not_ready']);
    expect(
      await adminQuery(`select 1 from office.company_agents where agent_code = 'KOR-2'`),
    ).toEqual([]);

    const stopped = await put(founder, '/api/agents/HAF-2/switch', { status: 'stopped' });
    expect(officeAgentSchema.parse(stopped.json())).toEqual({
      code: 'HAF-2',
      name: 'Kurumsal Arama Ajanı',
      status: 'stopped',
      // Its card has a version to run with: it can be opened again.
      ready: true,
    });
    // A request routed to a stopped agent waits for a person instead of an agent.
    const { id } = await open(employee);
    await put(founder, '/api/agents/HAF-2/switch', { status: 'enabled' });
    await route(id, ids.employee);
    await put(founder, '/api/agents/HAF-2/switch', { status: 'stopped' });
    expect(await read(employee, id)).toMatchObject({
      stage: 'fell_to_person',
      cause: 'agent_stopped',
    });
    await put(founder, '/api/agents/HAF-2/switch', { status: 'enabled' });
    expect((await read(employee, id)).stage).toBe('working');
    const events = await adminQuery<{ event: string; user_id: string }>(
      `select event, user_id from office.audit_log
       where record_type = 'company_agent' order by id desc limit 2`,
    );
    expect(events).toEqual([
      { event: 'agent_enabled', user_id: ids.founder },
      { event: 'agent_stopped', user_id: ids.founder },
    ]);
  });

  describe('Bugün and notifications', () => {
    // 8 October decisions 7 and 8. The routes commit and the requests of the whole file stay in
    // the test database, so every assertion names its own requests by id and never a total.

    async function today(session: string, company: string = ids.arma): Promise<Today> {
      const res = await get(session, '/api/today', company);
      expect(res.statusCode).toBe(200);
      return todaySchema.parse(res.json());
    }

    async function counts(session: string, company: string = ids.arma): Promise<SidebarCounts> {
      const res = await get(session, '/api/today/counts', company);
      expect(res.statusCode).toBe(200);
      return sidebarCountsSchema.parse(res.json());
    }

    const decide = (approvalId: string, payload: object) =>
      post(founder, `/api/approvals/${approvalId}/decision`, payload);
    const APPROVE = { decision: 'approved', selectedOption: 'A' };

    /** The employee's request, routed to HAF-2, its result submitted: it waits for the founder. */
    async function submitted(): Promise<{ id: string; approvalId: string }> {
      const { id } = await open(employee);
      await route(id, ids.employee);
      return { id, approvalId: await submit(id, ids.employee) };
    }

    /** The employee's request, stopped by the founder: one notification for the employee. */
    async function stopped(reason = 'Bu iş bu hafta yapılmayacak.'): Promise<string> {
      const { id } = await open(employee);
      const res = await post(founder, `/api/requests/${id}/close`, { reason });
      expect(res.statusCode).toBe(200);
      return id;
    }

    async function noteOf(requestId: string): Promise<{ id: string; read: boolean }> {
      const rows = await adminQuery<{ id: string; read: boolean }>(
        `select id, read_at is not null as read from office.notifications where record_id = $1`,
        [requestId],
      );
      expect(rows).toHaveLength(1);
      return rows[0] ?? { id: '', read: false };
    }

    const about = (answer: Today, requestId: string) =>
      answer.notifications.filter(
        (item) => item.template !== 'passkeys_reset' && item.request.id === requestId,
      );

    it('lists what waits for the person: a result to decide, a result to accept, a request that fell to them', async () => {
      const r1 = await submitted();
      const r2 = await submitted();
      expect((await decide(r2.approvalId, APPROVE)).statusCode).toBe(200);
      // The unit agent's run ended without a submission: the request fell to a person.
      const r3 = await open(employee);
      await route(r3.id, ids.employee);
      await agentStep(
        workerPool,
        { companyId: ids.arma, userId: ids.employee, agentCode: 'HAF-2' },
        async (client) => {
          await client.query(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model, status, finished_at, summary, output)
             values ($1, $2, 'HAF-2', $3, 'handoff', 'test-model', 'completed', now(),
               'Ajan sonucu onaya sunmadan çalışmasını bitirdi.', $4)`,
            [
              ids.arma,
              r3.id,
              CARD_HAF,
              JSON.stringify({ outcome: 'no_submission', final_text: 'ONAYSIZ TASLAK' }),
            ],
          );
        },
      );

      const res = await get(founder, '/api/today');
      expect(res.statusCode).toBe(200);
      const forFounder = todaySchema.parse(res.json());
      expect(forFounder.expectedTruncated).toBe(false);
      const item = (answer: Today, id: string) => answer.expected.find((row) => row.id === id);
      expect(item(forFounder, r1.id)).toMatchObject({
        stage: 'unit_approval',
        waitingForMe: true,
        requester: { userId: ids.employee, name: 'Çalışan' },
        unit: { code: 'HAF' },
      });
      expect(item(forFounder, r3.id)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'no_submission',
        waitingForMe: true,
      });
      // Approved: it waits for its requester now, not for the founder.
      expect(item(forFounder, r2.id)).toBeUndefined();
      // An item is the summary of its request, as the request's own page gives it.
      for (const id of [r1.id, r3.id]) {
        const detail = await read(founder, id);
        const { stage, cause, turn, waitingForMe, title, updatedAt, status, delayed } = detail;
        expect(item(forFounder, id)).toMatchObject({
          stage,
          cause,
          turn,
          waitingForMe,
          title,
          updatedAt,
          status,
          delayed,
        });
      }
      // The one that has not moved for longest first.
      const moved = forFounder.expected.map((row) => row.updatedAt);
      expect(moved).toEqual([...moved].sort());
      expect(moved.indexOf(item(forFounder, r1.id)?.updatedAt ?? '')).toBeLessThan(
        moved.lastIndexOf(item(forFounder, r3.id)?.updatedAt ?? ''),
      );
      // Everything on the founder's list expects something of the founder.
      for (const row of forFounder.expected) {
        expect(['unit_approval', 'requester_approval', 'fell_to_person']).toContain(row.stage);
      }

      const employeeRes = await get(employee, '/api/today');
      const forEmployee = todaySchema.parse(employeeRes.json());
      expect(item(forEmployee, r2.id)).toMatchObject({
        stage: 'requester_approval',
        waitingForMe: true,
      });
      expect(item(forEmployee, r1.id)).toBeUndefined();
      expect(item(forEmployee, r3.id)).toBeUndefined();
      for (const row of forEmployee.expected) {
        expect(row).toMatchObject({ stage: 'requester_approval', waitingForMe: true });
      }
      // A colleague who requested nothing and decides nothing.
      expect((await today(colleague)).expected).toEqual([]);
      // Nothing an agent wrote: not the result, not the coordinator's reason, not a draft.
      for (const body of [res.body, employeeRes.body]) {
        expect(body).not.toContain('İki seçenek.');
        expect(body).not.toContain('Yeni ofisimiz açıldı.');
        expect(body).not.toContain(COORDINATOR_REASON);
        expect(body).not.toContain('ONAYSIZ TASLAK');
      }
    });

    it('counts the same things in one light answer: Bugün is the list, Onaylar is the desk', async () => {
      const { id, approvalId } = await submitted();
      const state = async (session: string) => {
        const list = await today(session);
        const desk = approvalDeskSchema.parse((await get(session, '/api/approvals')).json());
        const numbers = await counts(session);
        expect(numbers.today).toBe(list.expected.length);
        expect(numbers.approvals).toBe(desk.approvals.length + desk.acceptances.length);
        expect(numbers.today - numbers.approvals).toBe(
          list.expected.filter((row) => row.stage === 'fell_to_person').length,
        );
        return { list, desk, numbers };
      };
      const founderBefore = await state(founder);
      const employeeBefore = await state(employee);
      expect(founderBefore.desk.approvals.map((card) => card.requestId)).toContain(id);
      expect(founderBefore.list.expected.map((row) => row.id)).toContain(id);
      expect(employeeBefore.list.expected.map((row) => row.id)).not.toContain(id);
      // The answer is two numbers and nothing else.
      const raw = await get(founder, '/api/today/counts');
      expect(Object.keys(raw.json<object>()).sort()).toEqual(['approvals', 'today']);

      expect((await decide(approvalId, APPROVE)).statusCode).toBe(200);
      const founderAfter = await state(founder);
      const employeeAfter = await state(employee);
      expect(founderAfter.numbers).toEqual({
        today: founderBefore.numbers.today - 1,
        approvals: founderBefore.numbers.approvals - 1,
      });
      expect(employeeAfter.numbers).toEqual({
        today: employeeBefore.numbers.today + 1,
        approvals: employeeBefore.numbers.approvals + 1,
      });
      expect(employeeAfter.desk.acceptances.map((card) => card.requestId)).toContain(id);
    });

    it('Onaylar counts a decision that waits beyond the window of the Bugün list', async () => {
      // The list looks at the TODAY_REQUEST_LIMIT open requests that have not moved for longest.
      // A company with that many open requests that expect nothing of the founder: a colleague's,
      // opened and never routed. They are closed again at the end, because the tests after this
      // one read the founder's list.
      const asColleague = { companyId: ids.arma, userId: ids.holder };
      const waiting = await withContext(besidePool, asColleague, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into office.tasks (company_id, kind, title, description)
           select office.ctx_company_id(), 'request', 'Bekleyen talep ' || n, 'Kimse ilerletmedi.'
           from generate_series(1, $1::int) n
           returning id`,
          [TODAY_REQUEST_LIMIT],
        );
        return rows.map((row) => row.id);
      });
      try {
        expect(waiting).toHaveLength(TODAY_REQUEST_LIMIT);
        const before = await counts(founder);
        // A result is submitted now: its request is the one that moved last.
        const { id } = await submitted();
        const list = await today(founder);
        expect(list.expectedTruncated).toBe(true);
        expect(list.expected.map((row) => row.id)).not.toContain(id);
        const desk = approvalDeskSchema.parse((await get(founder, '/api/approvals')).json());
        expect(desk.approvals.map((card) => card.requestId)).toContain(id);
        // The number for Onaylar is the desk, whatever the list was cut to; Bugün stays the list.
        const after = await counts(founder);
        expect(after.approvals).toBe(before.approvals + 1);
        expect(after.approvals).toBe(desk.approvals.length + desk.acceptances.length);
        expect(after.today).toBe(list.expected.length);
      } finally {
        await withContext(besidePool, asColleague, async (client) => {
          for (const id of waiting) {
            await closeRequest(client, id, null);
          }
        });
      }
      expect(
        await adminQuery(
          `select 1 from office.tasks
           where id = any ($1::uuid[]) and status not in ('done', 'cancelled')`,
          [waiting],
        ),
      ).toEqual([]);
    });

    it('a result is on the appointed approver’s list and still on the founder’s; a right holder who is appointed nowhere has none', async () => {
      const listed = async (session: string) =>
        (await today(session)).expected.map((row) => row.id);
      // Routed while nobody is appointed for the unit: the founder decides it.
      const earlier = await submitted();
      expect(await listed(founder)).toContain(earlier.id);
      // Holding the approval right alone puts nothing on a person's list.
      expect(await listed(rightHolder)).toEqual([]);
      expect(await counts(rightHolder)).toEqual({ today: 0, approvals: 0 });

      const founderContext = { companyId: ids.arma, userId: ids.founder };
      await withContext(besidePool, founderContext, (client) =>
        client.query(
          `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'HAF', $2)`,
          [ids.arma, RIGHT_HOLDER],
        ),
      );
      try {
        const { id } = await submitted();
        const forApprover = await today(rightHolder);
        // Only the step that names them: the request routed before the appointment is not theirs.
        expect(forApprover.expected).toMatchObject([
          { id, stage: 'unit_approval', waitingForMe: true },
        ]);
        expect(await counts(rightHolder)).toEqual({ today: 1, approvals: 1 });
        // The founder may still decide it: it is on the founder's list too, although the turn is
        // the appointed person's.
        expect((await today(founder)).expected.find((row) => row.id === id)).toMatchObject({
          stage: 'unit_approval',
          waitingForMe: false,
          turn: { kind: 'person', userId: RIGHT_HOLDER },
        });
        // Neither on the requester's nor on a colleague's.
        expect(await listed(employee)).not.toContain(id);
        expect(await listed(colleague)).toEqual([]);
      } finally {
        await withContext(besidePool, founderContext, (client) =>
          client.query(
            `delete from office.approvers where company_id = $1 and unit_code = 'HAF' and user_id = $2`,
            [ids.arma, RIGHT_HOLDER],
          ),
        );
      }
    });

    it('tells the requester when the request is returned, rejected or stopped, with a template and ids only', async () => {
      const returned = await open(employee, 'KVKK aydınlatma metni hazırlansın');
      await route(returned.id, ids.employee, null);
      const rejected = await submitted();
      const rejection = await decide(rejected.approvalId, {
        decision: 'rejected',
        reason: 'other',
        note: 'Gizli not',
      });
      expect(rejection.statusCode).toBe(200);
      const stoppedId = await stopped('Gizli neden');

      const res = await get(employee, '/api/today');
      expect(res.statusCode).toBe(200);
      const answer = todaySchema.parse(res.json());
      expect(answer.notificationsTruncated).toBe(false);
      expect(about(answer, returned.id)).toEqual([
        {
          id: (await noteOf(returned.id)).id,
          template: 'request_returned',
          createdAt: expect.any(String) as unknown,
          read: false,
          request: { id: returned.id, title: 'KVKK aydınlatma metni hazırlansın' },
          unit: { code: 'HAF', name: 'Kurumsal Hafıza' },
        },
      ]);
      expect(about(answer, rejected.id)).toEqual([
        {
          id: (await noteOf(rejected.id)).id,
          template: 'request_rejected',
          createdAt: expect.any(String) as unknown,
          read: false,
          request: { id: rejected.id, title: 'LinkedIn için gönderi yaz' },
        },
      ]);
      expect(about(answer, stoppedId)).toEqual([
        {
          id: (await noteOf(stoppedId)).id,
          template: 'request_stopped',
          createdAt: expect.any(String) as unknown,
          read: false,
          request: { id: stoppedId, title: 'LinkedIn için gönderi yaz' },
        },
      ]);
      // The newest first.
      const order = answer.notifications.flatMap((item) =>
        item.template === 'passkeys_reset' ? [] : [item.request.id],
      );
      const mine = [stoppedId, rejected.id, returned.id];
      expect(order.filter((id) => mine.includes(id))).toEqual(mine);
      const times = answer.notifications.map((item) => item.createdAt);
      expect(times).toEqual([...times].sort().reverse());
      // The reason of a return, a rejection or a stop is on the request, never in the notification;
      // the closed requests expect nothing of anybody.
      expect(res.body).not.toContain(COORDINATOR_REASON);
      expect(res.body).not.toContain('Gizli not');
      expect(res.body).not.toContain('Gizli neden');
      expect(res.body).not.toContain('İki seçenek.');
      for (const id of mine) {
        expect(answer.expected.map((row) => row.id)).not.toContain(id);
      }
      // In the database too: ids and codes, sent by the coordinator or by the person who acted.
      expect(
        await adminQuery(
          `select template, recipient_user_id, record_type, channel, sender_agent_code,
                  sender_user_id
           from office.notifications where record_id = any ($1::uuid[]) order by created_at`,
          [mine],
        ),
      ).toEqual([
        {
          template: 'request_returned',
          recipient_user_id: ids.employee,
          record_type: 'task',
          channel: 'panel',
          sender_agent_code: 'KOR-1',
          sender_user_id: null,
        },
        {
          template: 'request_rejected',
          recipient_user_id: ids.employee,
          record_type: 'task',
          channel: 'panel',
          sender_agent_code: null,
          sender_user_id: ids.founder,
        },
        {
          template: 'request_stopped',
          recipient_user_id: ids.employee,
          record_type: 'task',
          channel: 'panel',
          sender_agent_code: null,
          sender_user_id: ids.founder,
        },
      ]);
    });

    it('tells nobody of their own act', async () => {
      const cancelled = await open(employee);
      expect((await post(employee, `/api/requests/${cancelled.id}/close`)).statusCode).toBe(200);
      // The founder's own request, rejected by the founder as the unit's approver.
      const own = await open(founder);
      await route(own.id, ids.founder);
      const approvalId = await submit(own.id, ids.founder);
      const rejection = await decide(approvalId, { decision: 'rejected', reason: 'incomplete' });
      expect(requestDetailSchema.parse(rejection.json())).toMatchObject({ status: 'cancelled' });
      const closed = await open(founder);
      expect((await post(founder, `/api/requests/${closed.id}/close`)).statusCode).toBe(200);

      const acts = [cancelled.id, own.id, closed.id];
      expect(
        await adminQuery('select id from office.notifications where record_id = any ($1::uuid[])', [
          acts,
        ]),
      ).toEqual([]);
      for (const session of [employee, founder]) {
        const answer = await today(session);
        for (const id of acts) {
          expect(about(answer, id)).toEqual([]);
        }
      }
    });

    it('a notification is the recipient’s alone', async () => {
      const stoppedId = await stopped();
      const waiting = await submitted();
      expect(about(await today(employee), stoppedId)).toHaveLength(1);
      // The founder stopped it and reads the company's notification log in the database; the
      // screen's answer still holds only the founder's own.
      expect((await noteOf(stoppedId)).read).toBe(false);
      const forFounder = await today(founder);
      expect(about(forFounder, stoppedId)).toEqual([]);
      expect(
        forFounder.notifications.every(
          (item) => item.template === 'passkeys_reset' || item.request.id !== stoppedId,
        ),
      ).toBe(true);
      expect(forFounder.expected.map((row) => row.id)).toContain(waiting.id);
      for (const session of [colleague, rightHolder, external]) {
        expect(about(await today(session), stoppedId)).toEqual([]);
      }

      // Another company: nothing of Arma DX, for the same founder.
      const inPillika = await today(founder, ids.pillika);
      expect(inPillika.notifications).toEqual([]);
      expect(inPillika.expected.map((row) => row.id)).not.toContain(waiting.id);
      const companies = await adminQuery<{ company_id: string }>(
        'select distinct company_id from office.tasks where id = any ($1::uuid[])',
        [inPillika.expected.map((row) => row.id)],
      );
      expect(companies.filter((row) => row.company_id !== ids.pillika)).toEqual([]);
      // A company the person is not a member of.
      for (const url of ['/api/today', '/api/today/counts']) {
        const refused = await get(employee, url, ids.pillika);
        expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'forbidden']);
      }
      const marked = await post(
        employee,
        '/api/notifications/read',
        { ids: [(await noteOf(stoppedId)).id] },
        ids.pillika,
      );
      expect([marked.statusCode, errorCode(marked)]).toEqual([403, 'forbidden']);
      expect((await noteOf(stoppedId)).read).toBe(false);
    });

    it('a read mark marks only the reader’s own, and only a list of ids', async () => {
      const stoppedId = await stopped();
      const other = await stopped();
      const note = await noteOf(stoppedId);
      const mark = (session: string, body: object, company: string = ids.arma) =>
        post(session, '/api/notifications/read', body, company);

      // Somebody else's notification: answered the same, and nothing is marked. The founder reads
      // the log and is still not the recipient; in another company the id is nobody's.
      for (const session of [founder, colleague, external]) {
        const res = await mark(session, { ids: [note.id] });
        expect(res.statusCode).toBe(204);
        expect(res.body).toBe('');
      }
      expect((await mark(founder, { ids: [note.id] }, ids.pillika)).statusCode).toBe(204);
      expect((await noteOf(stoppedId)).read).toBe(false);

      // The recipient: marked, and still listed, read.
      expect((await mark(employee, { ids: [note.id] })).statusCode).toBe(204);
      expect((await noteOf(stoppedId)).read).toBe(true);
      const answer = await today(employee);
      expect(about(answer, stoppedId)).toMatchObject([{ id: note.id, read: true }]);
      // Only what was named.
      expect(about(answer, other)).toMatchObject([{ read: false }]);
      expect((await noteOf(other)).read).toBe(false);
      // Again: nothing changes and nothing is said.
      const [before] = await adminQuery<{ read_at: Date }>(
        'select read_at from office.notifications where id = $1',
        [note.id],
      );
      expect((await mark(employee, { ids: [note.id] })).statusCode).toBe(204);
      expect(
        await adminQuery('select read_at from office.notifications where id = $1', [note.id]),
      ).toEqual([before]);

      const uuids = Array.from({ length: NOTIFICATION_LIST_LIMIT + 1 }, () => randomUUID());
      for (const body of [
        {},
        { ids: [] },
        { ids: uuids },
        { ids: ['x'] },
        { ids: note.id },
        { ids: [note.id], all: true },
        { all: true },
      ]) {
        const res = await mark(employee, body);
        expect([res.statusCode, errorCode(res)], JSON.stringify(body).slice(0, 60)).toEqual([
          400,
          'invalid_request',
        ]);
      }
      expect((await mark(employee, { ids: uuids.slice(1) })).statusCode).toBe(204);
      expect((await noteOf(other)).read).toBe(false);

      for (const [method, url] of [
        ['GET', '/api/today'],
        ['GET', '/api/today/counts'],
        ['POST', '/api/notifications/read'],
      ] as const) {
        const res = await server.app.inject({
          method,
          url,
          headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma },
          ...(method === 'POST' ? { payload: { ids: [note.id] } } : {}),
        });
        expect([res.statusCode, errorCode(res)], url).toEqual([401, 'unauthenticated']);
      }
    });

    it('a read notification is kept for 30 days, an unread one until it is read', async () => {
      const stoppedId = await stopped();
      const note = await noteOf(stoppedId);
      await adminExec(
        `update office.notifications set created_at = now() - interval '31 days'
         where id = '${note.id}'`,
      );
      // Not read yet: listed whatever its age, after the newer ones.
      const old = await today(employee);
      expect(about(old, stoppedId)).toMatchObject([{ id: note.id, read: false }]);
      expect(old.notifications.at(-1)?.id).toBe(note.id);
      expect((await post(employee, '/api/notifications/read', { ids: [note.id] })).statusCode).toBe(
        204,
      );
      expect(about(await today(employee), stoppedId)).toEqual([]);
      // Inside the keeping time a read one stays.
      await adminExec(
        `update office.notifications set created_at = now() - interval '29 days'
         where id = '${note.id}'`,
      );
      expect(about(await today(employee), stoppedId)).toMatchObject([{ read: true }]);
    });

    it('an external person has no list, reads their own passkey notice and is refused the counts', async () => {
      await adminExec(
        `insert into office.notifications
           (company_id, recipient_user_id, template, record_type, record_id)
         values ('${ids.arma}', '${ids.external}', 'passkeys_reset', 'user', '${ids.external}')`,
      );
      try {
        const answer = await today(external);
        expect(answer.expected).toEqual([]);
        expect(answer.expectedTruncated).toBe(false);
        expect(answer.notifications).toEqual([
          {
            id: expect.any(String) as unknown,
            template: 'passkeys_reset',
            createdAt: expect.any(String) as unknown,
            read: false,
          },
        ]);
        const refused = await get(external, '/api/today/counts');
        expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'insiders_only']);
        // Nobody else gets the notice, also not the founder.
        for (const session of [founder, employee]) {
          expect(
            (await today(session)).notifications.filter(
              (item) => item.template === 'passkeys_reset',
            ),
          ).toEqual([]);
        }
        const id = answer.notifications[0]?.id ?? '';
        expect((await post(external, '/api/notifications/read', { ids: [id] })).statusCode).toBe(
          204,
        );
        expect((await today(external)).notifications).toMatchObject([{ id, read: true }]);
      } finally {
        await adminExec(
          `delete from office.notifications
           where recipient_user_id = '${ids.external}' and template = 'passkeys_reset'`,
        );
      }
    });

    it('in Kurucu alanı nothing is expected and nothing is counted', async () => {
      expect(await today(founder, ids.founderSpace)).toEqual({
        expected: [],
        expectedTruncated: false,
        notifications: [],
        notificationsTruncated: false,
      });
      expect(await counts(founder, ids.founderSpace)).toEqual({ today: 0, approvals: 0 });
      // Not a member of the founder's private space.
      const refused = await get(employee, '/api/today', ids.founderSpace);
      expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'forbidden']);
    });

    it('the refresh of the list and of the counts does not extend the idle time', async () => {
      const session = await sessionOf(server, accounts.employee);
      const [row] = await adminQuery<{ id: string }>(
        'select id from office.sessions where key_hash = $1',
        [hashSessionKey(session)],
      );
      const sessionId = row?.id ?? '';
      const idle = async (): Promise<boolean> => {
        const [seen] = await adminQuery<{ stale: boolean }>(
          `select last_seen_at < now() - interval '24 minutes' as stale
           from office.sessions where id = $1`,
          [sessionId],
        );
        return seen?.stale ?? false;
      };
      await adminQuery(
        `update office.sessions set last_seen_at = now() - interval '25 minutes' where id = $1`,
        [sessionId],
      );
      for (const url of ['/api/today', '/api/today/counts']) {
        const res = await server.app.inject({
          method: 'GET',
          url,
          cookies: { [SESSION_COOKIE]: session },
          headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma, [BACKGROUND_HEADER]: '1' },
        });
        expect(res.statusCode, url).toBe(200);
        expect(await idle(), url).toBe(true);
      }
      // The same request made by the person counts as activity.
      expect((await get(session, '/api/today')).statusCode).toBe(200);
      expect(await idle()).toBe(false);
    });
  });

  describe('the office: live states and "Her yerde durdur"', () => {
    // 8 October decisions 9 and 10. The requests of the whole file stay in the test database, so
    // the counts of Arma DX are compared before and after, never as totals; Pillika has no other
    // request, so its numbers are exact.

    const NONE = { count: 0, requestId: null };

    async function office(session: string, company: string = ids.arma) {
      const res = await get(session, '/api/office', company);
      expect(res.statusCode).toBe(200);
      return { res, body: officeResponseSchema.parse(res.json()) };
    }

    /** The three numbers of an agent in the office answer; zeros when the agent is not listed. */
    async function numbers(
      session: string,
      agentCode: string,
      company: string = ids.arma,
    ): Promise<[running: number, awaitingApproval: number, failed: number]> {
      const { body } = await office(session, company);
      const work = body.work.find((entry) => entry.agentCode === agentCode);
      return [work?.running.count ?? 0, work?.awaitingApproval.count ?? 0, work?.failed.count ?? 0];
    }

    const plus = (
      before: [number, number, number],
      delta: [number, number, number],
    ): [number, number, number] => [
      before[0] + delta[0],
      before[1] + delta[1],
      before[2] + delta[2],
    ];

    /** A run of an agent on a request that has ended, as the runner writes it. */
    async function endedRun(
      taskId: string,
      agent: 'KOR-1' | 'HAF-2',
      status: 'completed' | 'failed' | 'limit_reached' | 'stopped',
      errorCode: string | null = null,
    ): Promise<void> {
      await agentStep(
        workerPool,
        { companyId: ids.arma, userId: ids.employee, agentCode: agent },
        async (client) => {
          await client.query(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model, status, finished_at, error_code)
             values ($1, $2, $3, $4, $5, 'test-model', $6, now(), $7)`,
            [
              ids.arma,
              taskId,
              agent,
              agent === 'KOR-1' ? CARD_KOR : CARD_HAF,
              agent === 'KOR-1' ? 'request' : 'handoff',
              status,
              errorCode,
            ],
          );
        },
      );
    }

    it('puts each open request on the desk of its agent, as the request page reads it', async () => {
      const kor = await numbers(founder, 'KOR-1');
      const haf = await numbers(founder, 'HAF-2');

      // Routing: the coordinator has the turn, also before its run has started.
      const routing = await open(employee);
      expect(await read(founder, routing.id)).toMatchObject({
        stage: 'routing',
        turn: { kind: 'agent', code: 'KOR-1' },
      });
      expect(await numbers(founder, 'KOR-1')).toEqual(plus(kor, [1, 0, 0]));

      // Routed: the unit's agent has the turn.
      const working = await open(employee);
      await route(working.id, ids.employee);
      expect((await read(founder, working.id)).stage).toBe('working');
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [1, 0, 0]));
      // The coordinator's finished run keeps nothing on its desk.
      expect(await numbers(founder, 'KOR-1')).toEqual(plus(kor, [1, 0, 0]));

      // A result waits for the unit's approver.
      const waiting = await open(employee);
      await route(waiting.id, ids.employee);
      const approvalId = await submit(waiting.id, ids.employee);
      expect((await read(founder, waiting.id)).stage).toBe('unit_approval');
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [1, 1, 0]));

      // Approved: the result waits for its requester and stands on no desk.
      const decided = await post(founder, `/api/approvals/${approvalId}/decision`, {
        decision: 'approved',
        selectedOption: 'A',
      });
      expect(decided.statusCode).toBe(200);
      expect((await read(founder, waiting.id)).stage).toBe('requester_approval');
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [1, 0, 0]));

      // An employee who is nobody's approver reads the same numbers: the stage is no secret.
      expect(await numbers(colleague, 'HAF-2')).toEqual(await numbers(founder, 'HAF-2'));
      expect(await numbers(colleague, 'KOR-1')).toEqual(await numbers(founder, 'KOR-1'));
    });

    it('shows an error for the three causes decision 10 names, until the request is routed again or closed', async () => {
      const kor = await numbers(founder, 'KOR-1');
      const haf = await numbers(founder, 'HAF-2');
      const fallen = async (
        status: 'completed' | 'failed' | 'limit_reached' | 'stopped',
        errorCode: string | null = null,
      ): Promise<string> => {
        const { id } = await open(employee);
        await route(id, ids.employee);
        await endedRun(id, 'HAF-2', status, errorCode);
        return id;
      };

      const failed = await fallen('failed', 'tool_error');
      expect(await read(founder, failed)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'run_failed',
      });
      const limit = await fallen('limit_reached');
      expect((await read(founder, limit)).cause).toBe('limit_reached');
      const silent = await fallen('completed');
      expect((await read(founder, silent)).cause).toBe('no_submission');
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [0, 0, 3]));

      // The coordinator's own run failed before any routing: the error is on its desk.
      const unrouted = await open(employee);
      await endedRun(unrouted.id, 'KOR-1', 'failed', 'tool_error');
      expect((await read(founder, unrouted.id)).cause).toBe('run_failed');
      expect(await numbers(founder, 'KOR-1')).toEqual(plus(kor, [0, 0, 1]));

      // Every other way a request falls to a person leaves the desks as they are.
      const others: [string, string][] = [
        [await fallen('failed', 'model_refusal'), 'model_refused'],
        [await fallen('failed', 'model_unavailable'), 'model_unavailable'],
        [await fallen('failed', 'anthropic_billing'), 'model_billing'],
        [await fallen('failed', 'anthropic_model_not_found'), 'model_not_available'],
        [await fallen('failed', 'card_not_runnable'), 'card_not_runnable'],
        [await fallen('stopped', 'request_changed'), 'run_interrupted'],
        [await fallen('stopped', 'agent_stopped'), 'agent_stopped'],
      ];
      for (const [id, cause] of others) {
        expect(await read(founder, id), cause).toMatchObject({ stage: 'fell_to_person', cause });
      }
      const unroutable = await open(employee);
      await endedRun(unroutable.id, 'KOR-1', 'completed');
      expect((await read(founder, unroutable.id)).cause).toBe('no_routing');
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [0, 0, 3]));
      expect(await numbers(founder, 'KOR-1')).toEqual(plus(kor, [0, 0, 1]));

      // Routed again: the error leaves the desk and the agent has the turn.
      const again = await post(founder, `/api/requests/${failed}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect(again.statusCode).toBe(200);
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [1, 0, 2]));
      // Closed: gone from the desk.
      const closed = await post(founder, `/api/requests/${limit}/close`, {
        reason: 'Gerek kalmadı.',
      });
      expect(closed.statusCode).toBe(200);
      expect(await numbers(founder, 'HAF-2')).toEqual(plus(haf, [1, 0, 1]));
      // The coordinator's failed request, routed by a person: its desk is clear again.
      const byHand = await post(founder, `/api/requests/${unrouted.id}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect(byHand.statusCode).toBe(200);
      expect(await numbers(founder, 'KOR-1')).toEqual(kor);
    });

    it('a project request stands on a desk only for a reader who reads it, and a held one on none', async () => {
      const projectId = randomUUID();
      const created = await post(employee, '/api/projects', { id: projectId, name: 'Ofis sayımı' });
      expect(created.statusCode).toBe(201);
      // Agents may work in the project (rule 12): the founder's passkey path has tests of its own.
      await adminQuery('update office.projects set ai_allowed = true where id = $1', [projectId]);
      const before = {
        founder: await numbers(founder, 'KOR-1'),
        employee: await numbers(employee, 'KOR-1'),
        colleague: await numbers(colleague, 'KOR-1'),
      };
      // A request inside the project, opened by its member through the form's own route.
      const requestId = randomUUID();
      const opened = await post(employee, '/api/requests', {
        id: requestId,
        text: 'Proje içinde talep',
        projectId,
      });
      expect(opened.statusCode, opened.body).toBe(201);
      expect((await read(employee, requestId)).stage).toBe('routing');
      expect(await numbers(founder, 'KOR-1')).toEqual(plus(before.founder, [1, 0, 0]));
      expect(await numbers(employee, 'KOR-1')).toEqual(plus(before.employee, [1, 0, 0]));
      // An insider who is not a member of the project: the request does not exist for them.
      expect((await get(colleague, `/api/requests/${requestId}`)).statusCode).toBe(404);
      expect(await numbers(colleague, 'KOR-1')).toEqual(before.colleague);
      expect((await office(colleague)).res.body).not.toContain(requestId);
      // Made a member, the same person counts it.
      const added = await send(
        server,
        employee,
        'PUT',
        `/api/projects/${projectId}/members/${ids.holder}`,
        { company: ids.arma },
      );
      expect(added.statusCode).toBe(200);
      expect(await numbers(colleague, 'KOR-1')).toEqual(plus(before.colleague, [1, 0, 0]));

      // Held by a closed AI permission (rule 12): no agent has the turn and no agent failed, so
      // the request stands on no desk, for anybody. It is with the founder, on Bugün.
      const closed = await put(founder, `/api/projects/${projectId}/ai-permission`, {
        allowed: false,
      });
      expect(closed.statusCode, closed.body).toBe(200);
      expect(await read(founder, requestId)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'ai_permission_closed',
        turn: { kind: 'founder' },
      });
      expect(await numbers(founder, 'KOR-1')).toEqual(before.founder);
      expect(await numbers(employee, 'KOR-1')).toEqual(before.employee);
      expect(await numbers(colleague, 'KOR-1')).toEqual(before.colleague);
      for (const reader of [founder, employee, colleague]) {
        expect((await office(reader)).res.body).not.toContain(requestId);
      }
      // Open again: the coordinator has the turn again, and the request is back on its desk.
      await adminQuery('update office.projects set ai_allowed = true where id = $1', [projectId]);
      expect((await read(founder, requestId)).stage).toBe('routing');
      expect(await numbers(founder, 'KOR-1')).toEqual(plus(before.founder, [1, 0, 0]));
      await post(founder, `/api/requests/${requestId}/close`, { reason: 'Deneme bitti.' });
      expect(await numbers(founder, 'KOR-1')).toEqual(before.founder);
    });

    describe('in two companies', () => {
      const switchIn = (company: string, payload: object) =>
        send(server, founder, 'PUT', '/api/agents/KOR-1/switch', { company, payload });
      const stored = async (company: string): Promise<string | null> => {
        const rows = await adminQuery<{ status: string }>(
          `select status from office.company_agents where company_id = $1 and agent_code = 'KOR-1'`,
          [company],
        );
        return rows[0]?.status ?? null;
      };
      const stops = async (): Promise<{ company_id: string; user_id: string }[]> =>
        adminQuery(
          `select l.company_id, l.user_id from office.audit_log l
           join office.company_agents ca on ca.id = l.record_id
           where l.event = 'agent_stopped' and l.record_type = 'company_agent'
             and ca.agent_code = 'KOR-1'
           order by l.id`,
        );

      afterAll(async () => {
        // Other files read the office as the fixtures left it: KOR-1 open in Arma DX, no row in
        // Pillika.
        await adminExec(`
          delete from office.company_agents
            where company_id = '${ids.pillika}' and agent_code = 'KOR-1';
          update office.company_agents set status = 'enabled'
            where company_id = '${ids.arma}' and agent_code = 'KOR-1';
        `);
      });

      it('an agent’s work in one company never shows in the other', async () => {
        expect((await switchIn(ids.pillika, { status: 'enabled' })).statusCode).toBe(200);
        const arma = await numbers(founder, 'KOR-1');
        // Pillika has no open request yet: nothing is counted there.
        expect((await office(founder, ids.pillika)).body.work).toEqual([]);

        const first = randomUUID();
        const sent = await post(
          founder,
          '/api/requests',
          { id: first, text: 'Pillika için istasyon raporu' },
          ids.pillika,
        );
        expect(sent.statusCode).toBe(201);
        // One request: the answer carries it, so that the panel can lead to it.
        const one: OfficeAgentWork[] = [
          {
            agentCode: 'KOR-1',
            running: { count: 1, requestId: first },
            awaitingApproval: NONE,
            failed: NONE,
          },
        ];
        expect((await office(founder, ids.pillika)).body.work).toEqual(one);
        // Arma DX: the same numbers as before, and nothing of Pillika's request.
        const armaOffice = await office(founder);
        expect(await numbers(founder, 'KOR-1')).toEqual(arma);
        expect(armaOffice.res.body).not.toContain(first);
        // Arma DX's employee is not a member of Pillika.
        const refused = await get(employee, '/api/office', ids.pillika);
        expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'forbidden']);

        // Two requests: a number, and no request to lead to.
        const second = randomUUID();
        await post(founder, '/api/requests', { id: second, text: 'İkinci talep' }, ids.pillika);
        const two = (await office(founder, ids.pillika)).body;
        expect(two.work).toEqual([
          {
            agentCode: 'KOR-1',
            running: { count: 2, requestId: null },
            awaitingApproval: NONE,
            failed: NONE,
          },
        ]);
        expect(two.workTruncated).toBe(false);
        // Nothing of Arma DX in Pillika's answer: no request of this file's other tests.
        const { res } = await office(founder, ids.pillika);
        for (const entry of armaOffice.body.work) {
          for (const id of [entry.running, entry.awaitingApproval, entry.failed]) {
            if (id.requestId !== null) expect(res.body).not.toContain(id.requestId);
          }
        }
        // Closed again: the desks of Pillika are empty.
        for (const id of [first, second]) {
          const closed = await post(founder, `/api/requests/${id}/close`, {}, ids.pillika);
          expect(closed.statusCode).toBe(200);
        }
        expect((await office(founder, ids.pillika)).body.work).toEqual([]);
      });

      it('says that the numbers are not whole when more requests are open than the office counts', async () => {
        // Through the route: the pick asks for one row more than the limit and the count is cut
        // at the limit. Opened with the API's role in the founder's context, as the Bugün test
        // does; closed again, because the tests after this one read Pillika's desks.
        const asFounder = { companyId: ids.pillika, userId: ids.founder };
        const open = (count: number): Promise<string[]> =>
          withContext(besidePool, asFounder, async (client) => {
            const { rows } = await client.query<{ id: string }>(
              `insert into office.tasks (company_id, kind, title, description)
               select office.ctx_company_id(), 'request', 'Bekleyen talep ' || n, 'Kimse ilerletmedi.'
               from generate_series(1, $1::int) n
               returning id`,
              [count],
            );
            return rows.map((row) => row.id);
          });
        const opened = await open(OFFICE_REQUEST_LIMIT);
        try {
          // Exactly the limit: every request is counted and the numbers are whole.
          const whole = (await office(founder, ids.pillika)).body;
          expect(whole.work).toEqual([
            {
              agentCode: 'KOR-1',
              running: { count: OFFICE_REQUEST_LIMIT, requestId: null },
              awaitingApproval: NONE,
              failed: NONE,
            },
          ]);
          expect(whole.workTruncated).toBe(false);
          // One more: the same numbers, and the answer says that they are not whole.
          opened.push(...(await open(1)));
          const cut = (await office(founder, ids.pillika)).body;
          expect(cut.work).toEqual(whole.work);
          expect(cut.workTruncated).toBe(true);
        } finally {
          await withContext(besidePool, asFounder, async (client) => {
            for (const id of opened) {
              await closeRequest(client, id, null);
            }
          });
        }
        expect((await office(founder, ids.pillika)).body).toMatchObject({
          work: [],
          workTruncated: false,
        });
      });

      it('a stop "only if open" stops the agent where it is open, one company per request, with one audit row each', async () => {
        expect(await stored(ids.arma)).toBe('enabled');
        expect(await stored(ids.pillika)).toBe('enabled');
        const before = (await stops()).length;

        const inArma = await switchIn(ids.arma, { status: 'stopped', onlyIfOpen: true });
        expect(inArma.statusCode).toBe(200);
        // The answer is the agent as the office lists it, and says that this request stopped it.
        expect(officeAgentSchema.parse(inArma.json())).toEqual({
          code: 'KOR-1',
          name: 'Ofis Koordinatörü',
          status: 'stopped',
          ready: true,
        });
        expect(agentStopIfOpenResponseSchema.parse(inArma.json()).changed).toBe(true);
        // One request, one company: Pillika's switch is untouched.
        expect(await stored(ids.arma)).toBe('stopped');
        expect(await stored(ids.pillika)).toBe('enabled');
        const inPillika = await switchIn(ids.pillika, { status: 'stopped', onlyIfOpen: true });
        expect(agentStopIfOpenResponseSchema.parse(inPillika.json())).toMatchObject({
          status: 'stopped',
          changed: true,
        });
        expect(await stored(ids.pillika)).toBe('stopped');
        // One audit row per company, in the founder's name.
        expect((await stops()).slice(before)).toEqual([
          { company_id: ids.arma, user_id: ids.founder },
          { company_id: ids.pillika, user_id: ids.founder },
        ]);

        // A second time nothing is open: nothing is written, the answer says what the switch is.
        const again = await switchIn(ids.arma, { status: 'stopped', onlyIfOpen: true });
        expect(again.statusCode).toBe(200);
        // Already stopped: the switch reads the same, and the answer does not claim the stop.
        expect(agentStopIfOpenResponseSchema.parse(again.json())).toMatchObject({
          status: 'stopped',
          changed: false,
        });
        expect(await stops()).toHaveLength(before + 2);
      });

      it('a stop "only if open" leaves a closed agent closed and makes no row for one that was never opened', async () => {
        const audit = (await stops()).length;
        // KOR-2 was never opened in Arma DX: no row, before and after.
        const never = await send(server, founder, 'PUT', '/api/agents/KOR-2/switch', {
          company: ids.arma,
          payload: { status: 'stopped', onlyIfOpen: true },
        });
        expect(never.statusCode).toBe(200);
        expect(agentStopIfOpenResponseSchema.parse(never.json())).toMatchObject({
          code: 'KOR-2',
          status: null,
          changed: false,
        });
        expect(
          await adminQuery(`select 1 from office.company_agents where agent_code = 'KOR-2'`),
        ).toEqual([]);
        // Closed in Pillika (the administrator's value): it stays closed.
        await adminExec(`
          update office.company_agents set status = 'disabled'
            where company_id = '${ids.pillika}' and agent_code = 'KOR-1';
        `);
        const closed = await switchIn(ids.pillika, { status: 'stopped', onlyIfOpen: true });
        expect(agentStopIfOpenResponseSchema.parse(closed.json())).toMatchObject({
          status: 'disabled',
          changed: false,
        });
        expect(await stored(ids.pillika)).toBe('disabled');
        // An agent the card does not give to the company: nothing to stop, no refusal.
        const foreign = await send(server, founder, 'PUT', '/api/agents/P-IST-1/switch', {
          company: ids.arma,
          payload: { status: 'stopped', onlyIfOpen: true },
        });
        expect(agentStopIfOpenResponseSchema.parse(foreign.json())).toMatchObject({
          status: null,
          changed: false,
        });
        expect(await stops()).toHaveLength(audit);
        // An agent that does not exist, and a body that is not the contract's.
        expect(
          (
            await send(server, founder, 'PUT', '/api/agents/XYZ-9/switch', {
              company: ids.arma,
              payload: { status: 'stopped', onlyIfOpen: true },
            })
          ).statusCode,
        ).toBe(404);
        expect((await switchIn(ids.arma, { status: 'enabled', onlyIfOpen: true })).statusCode).toBe(
          400,
        );
        // Only the founder, as for every switch.
        const byEmployee = await send(server, employee, 'PUT', '/api/agents/KOR-1/switch', {
          company: ids.arma,
          payload: { status: 'stopped', onlyIfOpen: true },
        });
        expect([byEmployee.statusCode, errorCode(byEmployee)]).toEqual([403, 'founder_only']);
        // The plain stop keeps its meaning: it also stops an agent that is not open.
        const plain = await switchIn(ids.pillika, { status: 'stopped' });
        expect(officeAgentSchema.parse(plain.json()).status).toBe('stopped');
        // Its answer is the agent alone, as before: the four fields of the office's agent.
        expect(Object.keys(plain.json<object>()).sort()).toEqual([
          'code',
          'name',
          'ready',
          'status',
        ]);
        expect(await stored(ids.pillika)).toBe('stopped');
      });
    });

    it('the office answer is refreshed in the background without extending the session', async () => {
      const session = await sessionOf(server, accounts.founder);
      const [row] = await adminQuery<{ id: string }>(
        'select id from office.sessions where key_hash = $1',
        [hashSessionKey(session)],
      );
      const sessionId = row?.id ?? '';
      const idle = async (): Promise<boolean> => {
        const [seen] = await adminQuery<{ stale: boolean }>(
          `select last_seen_at < now() - interval '24 minutes' as stale
           from office.sessions where id = $1`,
          [sessionId],
        );
        return seen?.stale ?? false;
      };
      await adminQuery(
        `update office.sessions set last_seen_at = now() - interval '25 minutes' where id = $1`,
        [sessionId],
      );
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/office',
        cookies: { [SESSION_COOKIE]: session },
        headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma, [BACKGROUND_HEADER]: '1' },
      });
      expect(res.statusCode).toBe(200);
      expect(await idle()).toBe(true);
      expect((await get(session, '/api/office')).statusCode).toBe(200);
      expect(await idle()).toBe(false);
    });
  });

  describe('the due date and comments', () => {
    const DAY_MS = 86_400_000;
    const dayFromNow = (days: number): string => officeDay(Date.now() + days * DAY_MS);
    // A day counted from another day (noon in Istanbul, so that no hour of the clock matters).
    const dayFrom = (day: string, days: number): string =>
      officeDay(Date.parse(`${day}T12:00:00+03:00`) + days * DAY_MS);
    const listed = async (session: string, id: string) =>
      requestListSchema
        .parse((await get(session, '/api/requests')).json())
        .requests.find((request) => request.id === id);

    it('opens a request with a due day and shows it on the page and in the list; without one both say null', async () => {
      const dueDate = dayFromNow(3);
      const id = randomUUID();
      const res = await post(employee, '/api/requests', { id, text: 'Fuar davetiyesi', dueDate });
      expect(res.statusCode).toBe(201);
      expect(requestDetailSchema.parse(res.json())).toMatchObject({ id, dueDate, overdue: false });
      // Everybody who reads the request reads the day, on the page and in the list.
      for (const session of [employee, colleague, founder]) {
        expect(await read(session, id)).toMatchObject({ dueDate, overdue: false });
      }
      expect(await listed(colleague, id)).toMatchObject({ dueDate, overdue: false });
      // Stored as the last second of that day in Istanbul.
      expect(
        await adminQuery(
          `select due_at = (($2::date + time '23:59:59') at time zone 'Europe/Istanbul') as last_second
           from office.tasks where id = $1`,
          [id, dueDate],
        ),
      ).toEqual([{ last_second: true }]);

      const plain = await open(employee);
      expect(plain).toMatchObject({ dueDate: null, overdue: false });
      expect(await listed(employee, plain.id)).toMatchObject({ dueDate: null, overdue: false });
      expect(await adminQuery('select due_at from office.tasks where id = $1', [plain.id])).toEqual(
        [{ due_at: null }],
      );

      // Today is a day that has not ended.
      const today = dayFromNow(0);
      const sameDay = await post(employee, '/api/requests', {
        id: randomUUID(),
        text: 'Bugün bitmeli',
        dueDate: today,
      });
      expect(sameDay.statusCode).toBe(201);
      expect(requestDetailSchema.parse(sameDay.json())).toMatchObject({
        dueDate: today,
        overdue: false,
      });

      // A repeated send answers the first record: the day it was opened with stays.
      const again = await post(employee, '/api/requests', {
        id,
        text: 'Fuar davetiyesi',
        dueDate: dayFrom(dueDate, 6),
      });
      expect(again.statusCode).toBe(201);
      expect(requestDetailSchema.parse(again.json()).dueDate).toBe(dueDate);
    });

    it('refuses a due day that has already ended and stores nothing', async () => {
      const jobs = server.jobs.sent.length;
      for (const dueDate of [dayFromNow(-1), '2020-01-01', '0001-01-01']) {
        const id = randomUUID();
        const res = await post(employee, '/api/requests', { id, text: 'Geç kalmış', dueDate });
        expect([res.statusCode, errorCode(res)], dueDate).toEqual([409, 'due_date_past']);
        expect(apiErrorSchema.parse(res.json()).error.message).toBe(
          'Son tarih bugünden önce olamaz. Tarihi düzeltip yeniden gönderin.',
        );
        expect((await get(employee, `/api/requests/${id}`)).statusCode).toBe(404);
        expect(await adminQuery('select 1 from office.tasks where id = $1', [id])).toEqual([]);
      }
      expect(server.jobs.sent).toHaveLength(jobs);
    });

    it('refuses a due date that is not a day', async () => {
      const jobs = server.jobs.sent.length;
      for (const dueDate of [
        '2026-10-20T10:00:00Z',
        '20.10.2026',
        '2026-02-30',
        '',
        null,
        20261020,
      ]) {
        const id = randomUUID();
        const res = await post(employee, '/api/requests', { id, text: 'x', dueDate });
        expect([res.statusCode, errorCode(res)], JSON.stringify(dueDate)).toEqual([
          400,
          'invalid_request',
        ]);
        expect(await adminQuery('select 1 from office.tasks where id = $1', [id])).toEqual([]);
      }
      expect(server.jobs.sent).toHaveLength(jobs);
    });

    it('says that the due day has passed only while the request is open', async () => {
      const id = randomUUID();
      const today = dayFromNow(0);
      expect(
        (await post(employee, '/api/requests', { id, text: 'Günü geçecek', dueDate: today }))
          .statusCode,
      ).toBe(201);
      expect(await read(employee, id)).toMatchObject({ dueDate: today, overdue: false });
      // Nobody moves the day of a request, the privileged role included: only with the triggers
      // off can a test make two days pass.
      await adminExec(`
        begin;
        set local session_replication_role = 'replica';
        update office.tasks set due_at = due_at - interval '2 days' where id = '${id}';
        commit;
      `);
      const passed = dayFrom(today, -2);
      for (const session of [employee, colleague, founder]) {
        expect(await read(session, id)).toMatchObject({ dueDate: passed, overdue: true });
      }
      expect(await listed(colleague, id)).toMatchObject({ dueDate: passed, overdue: true });
      // The day moves nothing: the request is where it was, and nobody was told.
      expect(await read(employee, id)).toMatchObject({ status: 'open', stage: 'routing' });
      expect(
        await adminQuery(
          `select 1 from office.notifications where record_type = 'task' and record_id = $1`,
          [id],
        ),
      ).toEqual([]);
      // A closed request is not late any more; the day stays on it.
      expect((await post(employee, `/api/requests/${id}/close`)).statusCode).toBe(200);
      for (const session of [employee, founder]) {
        expect(await read(session, id)).toMatchObject({
          status: 'cancelled',
          dueDate: passed,
          overdue: false,
        });
      }
      expect(await listed(founder, id)).toMatchObject({ dueDate: passed, overdue: false });
    });

    // Comments (8 October decision 13).
    const comment = (
      session: string,
      id: string,
      body: string,
      commentId: string = randomUUID(),
      company: string = ids.arma,
    ) => post(session, `/api/requests/${id}/comments`, { id: commentId, body }, company);
    const commentRows = (id: string) =>
      adminQuery<{ id: string; author_user_id: string | null; body: string }>(
        `select id, author_user_id, body from office.task_comments
         where task_id = $1 order by created_at, id`,
        [id],
      );
    const founderContext = { companyId: ids.arma, userId: ids.founder };
    /** Runs the work with the right holder of this file appointed as the approver of HAF. */
    async function withApprover(work: () => Promise<void>): Promise<void> {
      await withContext(besidePool, founderContext, (client) =>
        client.query(
          `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'HAF', $2)`,
          [ids.arma, RIGHT_HOLDER],
        ),
      );
      try {
        await work();
      } finally {
        await withContext(besidePool, founderContext, (client) =>
          client.query(
            `delete from office.approvers
             where company_id = $1 and unit_code = 'HAF' and user_id = $2`,
            [ids.arma, RIGHT_HOLDER],
          ),
        );
      }
    }
    const NOT_ALLOWED =
      'Bu talebe yalnızca talep sahibi, birimin onaylayıcısı ve kurucu yorum yazabilir.';

    it('the requester, the founder and the appointed approver comment; everybody who reads the request reads the comments', async () => {
      await withApprover(async () => {
        const { id } = await open(employee);
        expect((await read(employee, id)).comments).toEqual({
          items: [],
          truncated: false,
          mayWrite: true,
        });
        await route(id, ids.employee);
        const written: [string, string, string][] = [
          [employee, ids.employee, 'Cuma gününe yetişir mi?'],
          [founder, ids.founder, 'Yetişir; taslak yarın gelir.'],
          [rightHolder, RIGHT_HOLDER, 'Görseli de ekleyelim.'],
        ];
        for (const [session, userId, body] of written) {
          expect((await read(session, id)).comments.mayWrite).toBe(true);
          const res = await comment(session, id, `  ${body}\n`);
          expect(res.statusCode).toBe(201);
          // The answer is the page again, with the new comment last, as it was stored.
          const page = requestDetailSchema.parse(res.json());
          expect(page.id).toBe(id);
          expect(page.comments.items.at(-1)).toMatchObject({ author: { userId }, body });
          expect(page.comments.mayWrite).toBe(true);
        }
        const expected = [
          { author: { userId: ids.employee, name: 'Çalışan' }, body: 'Cuma gününe yetişir mi?' },
          { author: { userId: ids.founder, name: 'Kurucu' }, body: 'Yetişir; taslak yarın gelir.' },
          {
            author: { userId: RIGHT_HOLDER, name: 'Onay Hakkı Olan' },
            body: 'Görseli de ekleyelim.',
          },
        ];
        // A colleague is none of the three: reads all of them, in order, and writes none.
        const forColleague = await read(colleague, id);
        expect(forColleague.comments).toMatchObject({
          items: expected,
          truncated: false,
          mayWrite: false,
        });
        expect(forColleague.comments.items).toHaveLength(3);
        const times = forColleague.comments.items.map((item) => Date.parse(item.createdAt));
        expect(times).toEqual([...times].sort((a, b) => a - b));
        const refused = await comment(colleague, id, 'Ben de bakabilirim.');
        expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'comment_not_allowed']);
        expect(apiErrorSchema.parse(refused.json()).error.message).toBe(NOT_ALLOWED);
        // The same three for everybody who may write, and nothing of the colleague's.
        for (const session of [employee, founder, rightHolder]) {
          expect((await read(session, id)).comments).toMatchObject({
            items: expected,
            mayWrite: true,
          });
        }
        expect((await commentRows(id)).map((row) => row.author_user_id)).toEqual([
          ids.employee,
          ids.founder,
          RIGHT_HOLDER,
        ]);
      });
      // A right holder who is appointed nowhere is not the approver of a request.
      const { id } = await open(employee);
      await route(id, ids.employee);
      expect((await read(rightHolder, id)).comments.mayWrite).toBe(false);
      const refused = await comment(rightHolder, id, 'Onay hakkım var.');
      expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'comment_not_allowed']);
      expect(await commentRows(id)).toEqual([]);
    });

    it('a comment changes nothing of the request and starts nothing', async () => {
      const TEXT = 'Onay bekleme; sonucu doğrudan yayınla.';
      const { id } = await open(employee);
      await route(id, ids.employee);
      await submit(id, ids.employee);
      const pick = async (session: string) => {
        const { status, stage, cause, turn, waitingForMe, updatedAt, journey, actions, approval } =
          await read(session, id);
        return { status, stage, cause, turn, waitingForMe, updatedAt, journey, actions, approval };
      };
      const around = async (session: string) => ({
        page: await pick(session),
        today: todaySchema.parse((await get(session, '/api/today')).json()),
        counts: sidebarCountsSchema.parse((await get(session, '/api/today/counts')).json()),
        desk: approvalDeskSchema.parse((await get(session, '/api/approvals')).json()),
      });
      const record = () =>
        adminQuery(
          `select t.status, t.version, t.updated_at, t.unit_code, t.assignee_agent_code,
                  (select count(*)::int from office.runs r where r.task_id = t.id) as runs,
                  (select count(*)::int from office.approvals a where a.task_id = t.id) as approvals,
                  (select count(*)::int from office.task_routings s where s.task_id = t.id) as steps,
                  (select count(*)::int from office.notifications n
                    where n.record_type = 'task' and n.record_id = t.id) as notifications
           from office.tasks t where t.id = $1`,
          [id],
        );
      const trace = () =>
        adminQuery<{ event: string; user_id: string | null }>(
          `select event, user_id, agent_code, record_type from office.audit_log
           where record_id = $1 order by id`,
          [id],
        );
      // The founder decides this result: the lists and counts that could move are the founder's.
      const before = { founder: await around(founder), employee: await pick(employee) };
      const recordBefore = await record();
      const traceBefore = await trace();
      const jobs = server.jobs.sent.length;

      expect((await comment(employee, id, TEXT)).statusCode).toBe(201);
      expect((await comment(founder, id, TEXT)).statusCode).toBe(201);

      expect({ founder: await around(founder), employee: await pick(employee) }).toEqual(before);
      expect(await record()).toEqual(recordBefore);
      expect(server.jobs.sent).toHaveLength(jobs);
      // One trace row per comment: who, on which request; never the text.
      expect((await trace()).slice(traceBefore.length)).toEqual([
        {
          event: 'task_comment_added',
          user_id: ids.employee,
          agent_code: null,
          record_type: 'task',
        },
        {
          event: 'task_comment_added',
          user_id: ids.founder,
          agent_code: null,
          record_type: 'task',
        },
      ]);
      expect(
        await adminQuery(
          `select 1 from office.audit_log l where to_jsonb(l)::text like '%' || $1 || '%'`,
          [TEXT],
        ),
      ).toEqual([]);
      // The approval card the founder decides is what it was: no word of a comment is on it.
      expect(JSON.stringify((await read(founder, id)).approval)).not.toContain('Onay bekleme');
    });

    it('the same comment sent twice is stored once: 201, then 200; an id that is somebody else’s is refused', async () => {
      const { id } = await open(employee);
      const commentId = randomUUID();
      const first = await comment(employee, id, 'Bir kez yazıldı.', commentId);
      expect(first.statusCode).toBe(201);
      const again = await comment(employee, id, 'Bir kez yazıldı.', commentId);
      expect(again.statusCode).toBe(200);
      expect(requestDetailSchema.parse(again.json()).comments.items).toMatchObject([
        { id: commentId, body: 'Bir kez yazıldı.' },
      ]);
      // A retry with another text under the same id changes nothing either.
      expect((await comment(employee, id, 'Başka bir metin', commentId)).statusCode).toBe(200);
      // The founder may comment here, but not with the id of the employee's comment.
      const taken = await comment(founder, id, 'Kurucunun yorumu', commentId);
      expect([taken.statusCode, errorCode(taken)]).toEqual([400, 'invalid_request']);
      // Nor does the employee reuse the id on another request of theirs.
      const other = await open(employee);
      const elsewhere = await comment(employee, other.id, 'Öbür talepte', commentId);
      expect([elsewhere.statusCode, errorCode(elsewhere)]).toEqual([400, 'invalid_request']);
      expect(await commentRows(other.id)).toEqual([]);
      expect(await commentRows(id)).toEqual([
        { id: commentId, author_user_id: ids.employee, body: 'Bir kez yazıldı.' },
      ]);

      // A double click, or a retry while the first send is still in flight: stored once, both
      // answered with the page.
      for (let round = 0; round < 5; round += 1) {
        const sameId = randomUUID();
        const body = `Aynı anda iki kez ${String(round)}`;
        const answers = await Promise.all([
          comment(employee, id, body, sameId),
          comment(employee, id, body, sameId),
        ]);
        expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 201]);
        for (const res of answers) {
          const { items } = requestDetailSchema.parse(res.json()).comments;
          expect(items.filter((item) => item.id === sameId)).toHaveLength(1);
        }
      }
      expect(await commentRows(id)).toHaveLength(6);
    });

    it('refuses a blank comment, one that is too long and a body with another field', async () => {
      const { id } = await open(employee);
      const send = (payload: object) => post(employee, `/api/requests/${id}/comments`, payload);
      const commentId = randomUUID();
      for (const payload of [
        { id: commentId, body: '' },
        { id: commentId, body: '   \n\t ' },
        { id: commentId, body: 'x'.repeat(REQUEST_COMMENT_MAX + 1) },
        { id: commentId, body: 'a\u0000b' },
        { id: commentId, body: 'Tamam.', status: 'done' },
        { id: commentId, body: 'Tamam.', agentCode: 'HAF-2' },
        { id: commentId, body: 'Tamam.', authorUserId: ids.founder },
        { body: 'Tamam.' },
        { id: 'not-an-id', body: 'Tamam.' },
        { id: commentId },
        {},
      ]) {
        const res = await send(payload);
        expect([res.statusCode, errorCode(res)], JSON.stringify(payload).slice(0, 60)).toEqual([
          400,
          'invalid_request',
        ]);
      }
      expect(await commentRows(id)).toEqual([]);
      const longest = await send({ id: commentId, body: 'x'.repeat(REQUEST_COMMENT_MAX) });
      expect(longest.statusCode).toBe(201);
      // Plain text is kept as it was written: line breaks, markup and all.
      const plain = 'İlk satır\n\n<b>kalın</b> https://example.com [[Not]]';
      const res = await comment(employee, id, plain);
      expect(requestDetailSchema.parse(res.json()).comments.items.at(-1)?.body).toBe(plain);
    });

    it('a comment can be written on a closed request by the same people', async () => {
      await withApprover(async () => {
        const { id } = await open(employee);
        await route(id, ids.employee);
        const approvalId = await submit(id, ids.employee);
        // The appointed approver rejects the result: the request closes.
        const rejected = await post(rightHolder, `/api/approvals/${approvalId}/decision`, {
          decision: 'rejected',
          reason: 'incomplete',
        });
        expect(requestDetailSchema.parse(rejected.json())).toMatchObject({
          status: 'cancelled',
          cause: 'rejected',
        });
        // "Why was this rejected" is asked here, and the one who rejected can answer.
        for (const [session, body] of [
          [employee, 'Neden reddedildi?'],
          [rightHolder, 'Rakamlar eksikti.'],
          [founder, 'Yeni talep açabilirsin.'],
        ] as const) {
          expect((await read(session, id)).comments.mayWrite).toBe(true);
          expect((await comment(session, id, body)).statusCode).toBe(201);
        }
        const refused = await comment(colleague, id, 'x');
        expect([refused.statusCode, errorCode(refused)]).toEqual([403, 'comment_not_allowed']);
        // Nothing was opened again: no step, no run, no job.
        const after = await read(employee, id);
        expect(after).toMatchObject({
          status: 'cancelled',
          stage: 'cancelled',
          cause: 'rejected',
          actions: { cancel: false, stop: false, reroute: false },
        });
        expect(after.comments.items.map((item) => item.body)).toEqual([
          'Neden reddedildi?',
          'Rakamlar eksikti.',
          'Yeni talep açabilirsin.',
        ]);
      });
      // A request its requester cancelled, and one that is done.
      const cancelled = await open(employee);
      expect((await post(employee, `/api/requests/${cancelled.id}/close`)).statusCode).toBe(200);
      expect((await comment(employee, cancelled.id, 'Yanlışlıkla açmıştım.')).statusCode).toBe(201);
      expect((await comment(founder, cancelled.id, 'Tamam.')).statusCode).toBe(201);
      expect((await read(founder, cancelled.id)).status).toBe('cancelled');
    });

    it('comments stay in their company and are not for an external person', async () => {
      const { id } = await open(employee);
      const commentId = randomUUID();
      expect((await comment(employee, id, 'Arma DX içinde', commentId)).statusCode).toBe(201);
      const stored = await commentRows(id);

      // The founder is a member of both companies and of Kurucu alanı: the request lives in one.
      for (const company of [ids.pillika, ids.founderSpace]) {
        expect((await comment(founder, id, 'x', randomUUID(), company)).statusCode).toBe(404);
        expect((await get(founder, `/api/requests/${id}`, company)).statusCode).toBe(404);
      }
      const outsider = await comment(external, id, 'x');
      expect([outsider.statusCode, errorCode(outsider)]).toEqual([403, 'insiders_only']);
      const anonymous = await server.app.inject({
        method: 'POST',
        url: `/api/requests/${id}/comments`,
        headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma },
        payload: { id: randomUUID(), body: 'x' },
      });
      expect(anonymous.statusCode).toBe(401);
      expect((await comment(founder, 'not-an-id', 'x')).statusCode).toBe(404);
      expect((await comment(founder, randomUUID(), 'x')).statusCode).toBe(404);
      // A task between people is not a request, also for somebody who reads it.
      const [task] = await adminQuery<{ id: string }>(
        `insert into office.tasks (company_id, title) values ($1, 'A task between people')
         returning id`,
        [ids.arma],
      );
      expect((await comment(founder, task?.id ?? '', 'x')).statusCode).toBe(404);
      expect(await commentRows(task?.id ?? '')).toEqual([]);

      // A written comment is neither changed nor deleted: there is no route for either.
      for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
        for (const url of [
          `/api/requests/${id}/comments`,
          `/api/requests/${id}/comments/${commentId}`,
        ]) {
          const res = await send(server, employee, method, url, {
            company: ids.arma,
            payload: { id: commentId, body: 'Değişti' },
          });
          expect(res.statusCode, `${method} ${url}`).toBe(404);
        }
      }
      expect((await get(employee, `/api/requests/${id}/comments`)).statusCode).toBe(404);
      expect(await commentRows(id)).toEqual(stored);
      expect(stored).toEqual([
        { id: commentId, author_user_id: ids.employee, body: 'Arma DX içinde' },
      ]);
    });

    it('carries the newest 200 comments, oldest first, and says that older ones exist', async () => {
      const { id } = await open(employee);
      // 201 comments of the employee, one second apart, all in the last five minutes: written by
      // an administrator with the triggers off (the route writes one comment per call).
      await adminExec(`
        begin;
        set local session_replication_role = 'replica';
        insert into office.task_comments (company_id, task_id, author_user_id, body, created_at)
          select '${ids.arma}', '${id}', '${ids.employee}', 'Yorum ' || g,
                 now() - make_interval(secs => 300 - g)
          from generate_series(1, 201) g;
        commit;
      `);
      for (const session of [employee, colleague]) {
        const { comments } = await read(session, id);
        expect(comments.items).toHaveLength(200);
        expect(comments.truncated).toBe(true);
        expect(comments.items.at(0)?.body).toBe('Yorum 2');
        expect(comments.items.at(-1)?.body).toBe('Yorum 201');
        expect(comments.items.map((item) => item.body)).toEqual(
          Array.from({ length: 200 }, (_, index) => `Yorum ${String(index + 2)}`),
        );
      }
      // A new one is the last; the oldest of the page gives way.
      const res = await comment(employee, id, 'En yeni');
      const page = requestDetailSchema.parse(res.json()).comments;
      expect(page.items).toHaveLength(200);
      expect([page.items.at(0)?.body, page.items.at(-1)?.body, page.truncated]).toEqual([
        'Yorum 3',
        'En yeni',
        true,
      ]);
    });

    it('a refresh of the page carries the comments and does not extend the idle time; sending a comment does', async () => {
      const { id } = await open(employee);
      expect((await comment(employee, id, 'Sayfada duran yorum')).statusCode).toBe(201);
      const session = await sessionOf(server, accounts.employee);
      const [row] = await adminQuery<{ id: string }>(
        'select id from office.sessions where key_hash = $1',
        [hashSessionKey(session)],
      );
      const sessionId = row?.id ?? '';
      const idle = async (): Promise<boolean> => {
        const [seen] = await adminQuery<{ stale: boolean }>(
          `select last_seen_at < now() - interval '24 minutes' as stale
           from office.sessions where id = $1`,
          [sessionId],
        );
        return seen?.stale ?? false;
      };
      const rest = () =>
        adminQuery(
          `update office.sessions set last_seen_at = now() - interval '25 minutes' where id = $1`,
          [sessionId],
        );
      await rest();
      const refreshed = await server.app.inject({
        method: 'GET',
        url: `/api/requests/${id}`,
        cookies: { [SESSION_COOKIE]: session },
        headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma, [BACKGROUND_HEADER]: '1' },
      });
      expect(refreshed.statusCode).toBe(200);
      expect(requestDetailSchema.parse(refreshed.json()).comments).toMatchObject({
        items: [{ body: 'Sayfada duran yorum' }],
        mayWrite: true,
      });
      expect(await idle()).toBe(true);
      // Writing a comment is the person's own act.
      expect((await comment(session, id, 'Kişinin kendi işi')).statusCode).toBe(201);
      expect(await idle()).toBe(false);
    });
  });
  // Requests inside a project (8 October decisions 11, 17, 46 to 48; rule 12). Projects are made
  // through the API, so their opener is their owner; the AI permission is opened as an
  // administrator would where a case is not about the passkey. Every case uses projects and
  // requests of its own: the routes commit and nothing is deleted.
  describe('requests inside a project', () => {
    // A project of a company the people of Arma DX are no members of, written as an
    // administrator would. (Not in Pillika: another file counts the projects there.)
    const FOREIGN_PROJECT = '00000000-0000-4000-8000-000000000961';

    beforeAll(async () => {
      await adminExec(`
        insert into office.projects (id, company_id, name, ai_allowed)
          values ('${FOREIGN_PROJECT}', '${ids.otherCompany}', 'Başka şirketin projesi', true)
          on conflict do nothing;
      `);
    });

    const messageOf = (res: LightMyRequestResponse): string =>
      apiErrorSchema.parse(res.json()).error.message;

    /** Opens a project through the API; the session's person is its owner. */
    async function project(
      session: string,
      body: Record<string, unknown> = {},
    ): Promise<ProjectDetail> {
      const res = await post(session, '/api/projects', {
        id: randomUUID(),
        name: 'Lansman',
        ...body,
      });
      expect(res.statusCode, res.body).toBe(201);
      return projectDetailSchema.parse(res.json());
    }

    const allowAi = (projectId: string, allowed = true) =>
      adminQuery('update office.projects set ai_allowed = $2 where id = $1', [projectId, allowed]);

    /** A project of the employee (its owner) where agents may work. */
    async function workable(body: Record<string, unknown> = {}): Promise<ProjectDetail> {
      const made = await project(employee, body);
      await allowAi(made.id);
      return made;
    }

    const sendIn = (session: string, projectId: string | undefined, id: string = randomUUID()) =>
      post(session, '/api/requests', {
        id,
        text: 'Lansman için gönderi yaz',
        ...(projectId === undefined ? {} : { projectId }),
      });

    async function openIn(session: string, projectId: string): Promise<RequestDetail> {
      const res = await sendIn(session, projectId);
      expect(res.statusCode, res.body).toBe(201);
      return requestDetailSchema.parse(res.json());
    }

    async function listed(session: string, query = ''): Promise<string[]> {
      const res = await get(session, `/api/requests${query}`);
      expect(res.statusCode, res.body).toBe(200);
      return requestListSchema.parse(res.json()).requests.map((request) => request.id);
    }

    const tasksOf = async (requestId: string): Promise<number> =>
      (await adminQuery('select 1 from office.tasks where id = $1', [requestId])).length;

    it('opens a request in a project and puts the same job on the queue', async () => {
      const made = await workable({ name: 'Bahar lansmanı' });
      const before = server.jobs.sent.length;
      const id = randomUUID();
      const res = await sendIn(employee, made.id, id);
      expect(res.statusCode, res.body).toBe(201);
      const detail = requestDetailSchema.parse(res.json());
      expect(detail).toMatchObject({
        id,
        status: 'open',
        stage: 'routing',
        project: { id: made.id, name: 'Bahar lansmanı' },
        agentsMayWork: true,
        requesterReads: true,
        requester: { userId: ids.employee },
      });
      // The job is the one every request gets: four ids, and nothing of the project (rule 10;
      // the runner reads the project from the request).
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' },
      ]);
      expect(
        await adminQuery('select project_id, requester_user_id from office.tasks where id = $1', [
          id,
        ]),
      ).toEqual([{ project_id: made.id, requester_user_id: ids.employee }]);
      // The founder opens one there too, member or not; a request without a project names none.
      expect((await openIn(founder, made.id)).project).toEqual({
        id: made.id,
        name: 'Bahar lansmanı',
      });
      expect((await open(employee)).project).toBeNull();
      // The project is named by its id and by nothing else.
      for (const projectId of ['', 'x', null, 12]) {
        const bad = await post(employee, '/api/requests', {
          id: randomUUID(),
          text: 'x',
          projectId,
        });
        expect([bad.statusCode, errorCode(bad)], JSON.stringify(projectId)).toEqual([
          400,
          'invalid_request',
        ]);
      }
    });

    it('refuses with a sentence that says why, and stores nothing', async () => {
      const notMine = await project(founder, { name: 'Kurucunun projesi' });
      await allowAi(notMine.id);
      const closed = await workable({ name: 'Biten proje', status: 'completed' });
      const cancelled = await workable({ name: 'İptal edilen proje', status: 'cancelled' });
      const noPermission = await project(employee, { name: 'İzni açılmamış proje' });
      const customerRefuses = await workable({
        name: 'Müşterisi izin vermeyen proje',
        customer: { kind: 'new', id: randomUUID(), name: `İzinsiz müşteri ${randomUUID()}` },
      });
      // Closed and without the permission: said to be closed (the person reads the project).
      const closedNoAi = await project(employee, {
        name: 'Kapalı ve izinsiz',
        status: 'completed',
      });

      const NOT_AVAILABLE = 'Bu proje yok ya da size açık değil. Başka bir proje seçin.';
      const cases: [string, string, string, string][] = [
        [employee, randomUUID(), 'project_not_available', NOT_AVAILABLE],
        // A project the employee is no member of answers exactly like one that does not exist.
        [employee, notMine.id, 'project_not_available', NOT_AVAILABLE],
        [colleague, closed.id, 'project_not_available', NOT_AVAILABLE],
        [
          employee,
          closed.id,
          'project_closed',
          'Bu proje kapalı. Kapalı projede yeni talep açılamaz.',
        ],
        [
          founder,
          cancelled.id,
          'project_closed',
          'Bu proje kapalı. Kapalı projede yeni talep açılamaz.',
        ],
        [
          employee,
          closedNoAi.id,
          'project_closed',
          'Bu proje kapalı. Kapalı projede yeni talep açılamaz.',
        ],
        [
          employee,
          noPermission.id,
          'project_ai_not_allowed',
          'Bu projede talep açılamaz: projenin yapay zekâ izni kapalı. İzni kurucu, projenin sayfasından açar.',
        ],
        [
          founder,
          noPermission.id,
          'project_ai_not_allowed',
          'Bu projede talep açılamaz: projenin yapay zekâ izni kapalı. İzni kurucu, projenin sayfasından açar.',
        ],
        [
          employee,
          customerRefuses.id,
          'project_ai_not_allowed',
          'Bu projede talep açılamaz: müşterinin sözleşmesi yapay zekâ kullanımına izin vermiyor.',
        ],
      ];
      for (const [session, projectId, code, message] of cases) {
        const before = server.jobs.sent.length;
        const id = randomUUID();
        const res = await sendIn(session, projectId, id);
        expect([res.statusCode, errorCode(res), messageOf(res)], code).toEqual([
          409,
          code,
          message,
        ]);
        expect(await tasksOf(id), code).toBe(0);
        expect(server.jobs.sent, code).toHaveLength(before);
      }
      // The same text is sent without the project and is opened: nothing of the form is lost.
      expect((await sendIn(employee, undefined)).statusCode).toBe(201);
      // An external person has no request at all, with or without a project.
      expect((await sendIn(external, notMine.id)).statusCode).toBe(403);
    });

    it('a project of the other company is not available', async () => {
      for (const session of [founder, employee]) {
        const before = server.jobs.sent.length;
        const id = randomUUID();
        const res = await sendIn(session, FOREIGN_PROJECT, id);
        expect([res.statusCode, errorCode(res)]).toEqual([409, 'project_not_available']);
        expect(await tasksOf(id)).toBe(0);
        expect(server.jobs.sent).toHaveLength(before);
      }
      // And a project of Arma DX is none of Pillika's, also for the founder of both.
      const made = await workable();
      const there = await post(
        founder,
        '/api/requests',
        { id: randomUUID(), text: 'x', projectId: made.id },
        ids.pillika,
      );
      expect(there.statusCode).toBe(409);
      expect(['project_not_available', 'requests_not_open']).toContain(errorCode(there));
    });

    it('a repeated send answers the first request, whatever project the second body names', async () => {
      const first = await workable({ name: 'İlk proje' });
      const second = await workable({ name: 'İkinci proje' });
      const before = server.jobs.sent.length;
      const id = randomUUID();
      expect((await sendIn(employee, first.id, id)).statusCode).toBe(201);
      for (const projectId of [second.id, undefined, randomUUID(), FOREIGN_PROJECT]) {
        const again = await sendIn(employee, projectId, id);
        expect(again.statusCode, String(projectId)).toBe(201);
        expect(requestDetailSchema.parse(again.json()).project, String(projectId)).toEqual({
          id: first.id,
          name: 'İlk proje',
        });
      }
      expect(server.jobs.sent).toHaveLength(before + 1);
      expect(await adminQuery('select project_id from office.tasks where id = $1', [id])).toEqual([
        { project_id: first.id },
      ]);
      // The id of a project request is not somebody else's to reuse, and tells them nothing.
      const stranger = await sendIn(colleague, undefined, id);
      expect([stranger.statusCode, errorCode(stranger)]).toEqual([400, 'invalid_request']);
    });

    it('the lists: project requests for members and the founder only; ?project= keeps one project', async () => {
      const one = await workable({ name: 'Bir' });
      const other = await workable({ name: 'İki' });
      const inOne = await openIn(employee, one.id);
      const inOther = await openIn(employee, other.id);
      const plain = await open(employee);

      for (const reader of [employee, founder]) {
        const all = await listed(reader);
        expect(all).toEqual(expect.arrayContaining([inOne.id, inOther.id, plain.id]));
        expect(await listed(reader, `?project=${one.id}`)).toEqual([inOne.id]);
        expect(await listed(reader, `?project=${other.id}`)).toEqual([inOther.id]);
        expect(await listed(reader, `?project=${one.id}&mine=true`)).toEqual(
          reader === employee ? [inOne.id] : [],
        );
      }
      const row = requestListSchema
        .parse((await get(founder, `/api/requests?project=${one.id}`)).json())
        .requests.at(0);
      expect(row?.project).toEqual({ id: one.id, name: 'Bir' });
      // A project without requests and a project that does not exist are the same empty list.
      const empty = await workable({ name: 'Boş' });
      for (const projectId of [empty.id, randomUUID(), FOREIGN_PROJECT]) {
        const res = await get(founder, `/api/requests?project=${projectId}`);
        expect(res.statusCode).toBe(200);
        expect(requestListSchema.parse(res.json())).toEqual({ requests: [], truncated: false });
      }
      for (const bad of ['x', '', '123']) {
        const res = await get(founder, `/api/requests?project=${bad}`);
        expect([res.statusCode, errorCode(res)], bad).toEqual([400, 'invalid_request']);
      }

      // An employee who is no member, and one with the approval right who is none.
      for (const stranger of [colleague, rightHolder]) {
        const all = await listed(stranger);
        expect(all).toContain(plain.id);
        expect(all).not.toContain(inOne.id);
        expect(all).not.toContain(inOther.id);
        expect(await listed(stranger, `?project=${one.id}`)).toEqual([]);
        for (const [method, url, payload] of [
          ['GET', `/api/requests/${inOne.id}`, undefined],
          ['GET', `/api/requests/${inOne.id}/routing-options`, undefined],
          ['POST', `/api/requests/${inOne.id}/close`, { reason: 'x' }],
          ['POST', `/api/requests/${inOne.id}/acceptance`, { decision: 'approved' }],
          ['POST', `/api/requests/${inOne.id}/comments`, { id: randomUUID(), body: 'x' }],
          ['POST', `/api/requests/${inOne.id}/routing`, { unitCode: 'HAF', agentCode: 'HAF-2' }],
        ] as const) {
          const res =
            method === 'GET' ? await get(stranger, url) : await post(stranger, url, payload);
          expect([res.statusCode, errorCode(res)], url).toEqual([404, 'not_found']);
        }
      }
      // Made a member, the colleague reads the project's requests, the old ones too.
      expect(
        (await put(employee, `/api/projects/${one.id}/members/${ids.holder}`, {})).statusCode,
      ).toBe(200);
      expect(await listed(colleague, `?project=${one.id}`)).toEqual([inOne.id]);
      expect((await read(colleague, inOne.id)).project).toEqual({ id: one.id, name: 'Bir' });
      expect(await listed(colleague, `?project=${other.id}`)).toEqual([]);
    });

    it('Bugün, the counts and the approval desk hold a project request only for those who read it', async () => {
      const made = await workable({ name: 'Onay bekleyen proje' });
      const counts = async (session: string): Promise<SidebarCounts> =>
        sidebarCountsSchema.parse((await get(session, '/api/today/counts')).json());
      const before = { founder: await counts(founder), holder: await counts(rightHolder) };

      const { id } = await openIn(employee, made.id);
      await route(id, ids.employee, 'HAF-2', 'HAF', made.id);
      const approvalId = await submit(id, ids.employee, { projectId: made.id });

      const today = async (session: string): Promise<Today> =>
        todaySchema.parse((await get(session, '/api/today')).json());
      const desk = async (session: string) =>
        approvalDeskSchema.parse((await get(session, '/api/approvals')).json());

      // The founder decides: the request is on the founder's list, and the card names the project.
      expect((await today(founder)).expected.map((item) => item.id)).toContain(id);
      expect((await today(founder)).expected.find((item) => item.id === id)?.project).toEqual({
        id: made.id,
        name: 'Onay bekleyen proje',
      });
      const card = (await desk(founder)).approvals.find((item) => item.id === approvalId);
      expect(card).toMatchObject({
        requestId: id,
        project: { id: made.id, name: 'Onay bekleyen proje' },
        agentsMayWork: true,
      });
      expect(await counts(founder)).toEqual({
        today: before.founder.today + 1,
        approvals: before.founder.approvals + 1,
      });
      expect((await read(founder, id)).approval).toMatchObject({
        id: approvalId,
        project: { id: made.id, name: 'Onay bekleyen proje' },
      });

      // An employee with the approval right who is no member: nothing of it, and no number moves.
      expect((await today(rightHolder)).expected.map((item) => item.id)).not.toContain(id);
      expect((await desk(rightHolder)).approvals.map((item) => item.id)).not.toContain(approvalId);
      expect(await counts(rightHolder)).toEqual(before.holder);
      const decided = await post(rightHolder, `/api/approvals/${approvalId}/decision`, {
        decision: 'approved',
        selectedOption: 'A',
      });
      expect(decided.statusCode).toBe(404);
      // The requester reads the request and not the result nobody approved.
      const mine = await read(employee, id);
      expect([mine.stage, mine.approval, mine.project?.id]).toEqual([
        'unit_approval',
        null,
        made.id,
      ]);
    });

    it('a notification of a project request reaches its requester and is gone when they leave the project', async () => {
      // The founder's project, the employee a plain member of it: a member can be removed.
      const made = await project(founder, {
        name: 'Üyesi çıkarılan proje',
        memberIds: [ids.employee],
      });
      await allowAi(made.id);
      const { id } = await openIn(employee, made.id);
      await route(id, ids.employee, 'HAF-2', 'HAF', made.id);
      const approvalId = await submit(id, ids.employee, { projectId: made.id });
      const rejected = await post(founder, `/api/approvals/${approvalId}/decision`, {
        decision: 'rejected',
        reason: 'incomplete',
      });
      expect(rejected.statusCode, rejected.body).toBe(200);

      const about = async (session: string): Promise<string[]> =>
        todaySchema
          .parse((await get(session, '/api/today')).json())
          .notifications.flatMap((item) =>
            item.template !== 'passkeys_reset' && item.request.id === id ? [item.template] : [],
          );
      expect(await about(employee)).toEqual(['request_rejected']);
      // Nobody else is told, also not the founder who reads every notification row.
      expect(await about(founder)).toEqual([]);
      expect(await about(colleague)).toEqual([]);

      const removed = await send(
        server,
        founder,
        'DELETE',
        `/api/projects/${made.id}/members/${ids.employee}`,
        { company: ids.arma },
      );
      expect(removed.statusCode, removed.body).toBe(200);
      // The row is still theirs; the request it names is not theirs to read any more (W-r).
      expect(
        await adminQuery(
          `select recipient_user_id from office.notifications
           where record_type = 'task' and record_id = $1`,
          [id],
        ),
      ).toEqual([{ recipient_user_id: ids.employee }]);
      expect(await about(employee)).toEqual([]);
      expect((await get(employee, `/api/requests/${id}`)).statusCode).toBe(404);
    });

    it('a project that stops taking requests between the door and the insert is refused with its own sentence', async () => {
      // The route reads the project, then inserts. Somebody else holds the table of requests
      // against new rows, so the insert waits; the project changes and commits; the database
      // refuses the insert, and the route reads the project again for the sentence.
      const meanwhile = async (
        projectId: string,
        session: string,
        change: string,
        values: unknown[],
      ): Promise<{ res: LightMyRequestResponse; id: string }> => {
        const id = randomUUID();
        const admin = await adminPool.connect();
        let pending: Promise<LightMyRequestResponse>;
        try {
          await admin.query('begin');
          await admin.query('lock table office.tasks in share row exclusive mode');
          pending = sendIn(session, projectId, id);
          await untilServerWaits();
          await admin.query(change, values);
          await admin.query('commit');
        } catch (error) {
          await admin.query('rollback');
          throw error;
        } finally {
          admin.release();
        }
        return { res: await pending, id };
      };

      const closing = await workable({ name: 'O anda kapanan proje' });
      const losing = await workable({ name: 'O anda izni kapanan proje' });
      const leaving = await project(founder, {
        name: 'O anda üyeliği kalkan proje',
        memberIds: [ids.employee],
      });
      await allowAi(leaving.id);
      const cases: [string, string, unknown[], string][] = [
        [
          closing.id,
          `update office.projects set status = 'completed' where id = $1`,
          [closing.id],
          'project_closed',
        ],
        [
          losing.id,
          'update office.projects set ai_allowed = false where id = $1',
          [losing.id],
          'project_ai_not_allowed',
        ],
        [
          leaving.id,
          'delete from office.project_members where project_id = $1 and user_id = $2',
          [leaving.id, ids.employee],
          'project_not_available',
        ],
      ];
      for (const [projectId, change, values, code] of cases) {
        const before = server.jobs.sent.length;
        const { res, id } = await meanwhile(projectId, employee, change, values);
        expect([res.statusCode, errorCode(res)], code).toEqual([409, code]);
        expect(await tasksOf(id), code).toBe(0);
        expect(server.jobs.sent, code).toHaveLength(before);
      }
      // Without a change in between the same wait ends in a request.
      const steady = await workable({ name: 'Değişmeyen proje' });
      const { res } = await meanwhile(steady.id, employee, 'select $1::uuid', [steady.id]);
      expect(res.statusCode, res.body).toBe(201);
    });

    // Rule 12 while a request is under way (8 October decisions 46 to 48) ------------------------

    /** The founder closes the AI permission of a project through the panel's route. */
    async function closeAi(projectId: string): Promise<void> {
      const res = await put(founder, `/api/projects/${projectId}/ai-permission`, {
        allowed: false,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(projectDetailSchema.parse(res.json()).aiAllowed).toBe(false);
    }

    /** The employee's request in the project, routed to HAF-2. */
    async function routedIn(projectId: string): Promise<string> {
      const { id } = await openIn(employee, projectId);
      await route(id, ids.employee, 'HAF-2', 'HAF', projectId);
      return id;
    }

    /** The same with a result HAF-2 submitted. */
    async function submittedIn(
      projectId: string,
      options: { goesExternal?: boolean } = {},
    ): Promise<{ id: string; approvalId: string }> {
      const id = await routedIn(projectId);
      return { id, approvalId: await submit(id, ids.employee, { ...options, projectId }) };
    }

    const HELD =
      'Bu projede ajanlar şu an çalışamaz: projenin ya da müşterisinin yapay zekâ izni kapalı. İzin açılana kadar bu işlem yapılamaz.';
    const held = (res: LightMyRequestResponse): unknown[] => [
      res.statusCode,
      errorCode(res),
      messageOf(res),
    ];

    it('while the permission is closed the request falls to the founder and nothing calls for a run', async () => {
      const made = await workable({ name: 'İzni kapanan proje' });
      const id = await routedIn(made.id);
      // The unit agent's run is open when the permission is closed.
      const runId = await agentStep(
        workerPool,
        { companyId: ids.arma, userId: ids.employee, agentCode: 'HAF-2', projectId: made.id },
        async (client) => {
          const run = await client.query<{ id: string }>(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model) values ($1, $2, 'HAF-2', $3, 'handoff', 'test-model')
             returning id`,
            [ids.arma, id, CARD_HAF],
          );
          return run.rows[0]?.id ?? '';
        },
      );
      expect(await read(founder, id)).toMatchObject({
        stage: 'working',
        agentsMayWork: true,
        actions: { reroute: true },
      });

      await closeAi(made.id);
      // The run was closed with the permission, in the same transaction.
      expect(
        await adminQuery('select status, error_code from office.runs where id = $1', [runId]),
      ).toEqual([{ status: 'stopped', error_code: 'ai_permission_closed' }]);
      for (const reader of [founder, employee]) {
        const detail = await read(reader, id);
        expect(detail).toMatchObject({
          // The request stays open (decision 47).
          status: 'in_progress',
          stage: 'fell_to_person',
          cause: 'ai_permission_closed',
          turn: { kind: 'founder' },
          waitingForMe: reader === founder,
          agentsMayWork: false,
          project: { id: made.id },
        });
        // Nothing that calls for a run is offered; the request can still be closed.
        expect(detail.actions).toEqual({
          cancel: reader === employee,
          stop: reader === founder,
          reroute: false,
        });
      }
      const before = server.jobs.sent.length;
      const rerouted = await post(founder, `/api/requests/${id}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect(held(rerouted)).toEqual([409, 'ai_permission_closed', HELD]);
      expect(server.jobs.sent).toHaveLength(before);
      expect(
        await adminQuery(`select count(*)::int as n from office.task_routings where task_id = $1`, [
          id,
        ]),
      ).toEqual([{ n: 1 }]);

      // Decision 47, word for word: it is on the founder's list with its cause, and nobody is
      // told.
      const today = async (session: string): Promise<Today> =>
        todaySchema.parse((await get(session, '/api/today')).json());
      const mine = (await today(founder)).expected.find((item) => item.id === id);
      expect(mine).toMatchObject({ stage: 'fell_to_person', cause: 'ai_permission_closed' });
      const theirs = await today(employee);
      expect(theirs.expected.map((item) => item.id)).not.toContain(id);
      expect(
        theirs.notifications.filter(
          (item) => item.template !== 'passkeys_reset' && item.request.id === id,
        ),
      ).toEqual([]);
      expect(
        await adminQuery(`select 1 from office.notifications where record_id = $1`, [id]),
      ).toEqual([]);
      // The list says the same as the page.
      const row = requestListSchema
        .parse((await get(founder, `/api/requests?project=${made.id}`)).json())
        .requests.find((request) => request.id === id);
      expect(row).toMatchObject({ stage: 'fell_to_person', cause: 'ai_permission_closed' });

      // Opened again (here by hand, so nothing is restarted): the run the close stopped reads as
      // interrupted, and the routing can be corrected again.
      await allowAi(made.id);
      const after = await read(founder, id);
      expect(after).toMatchObject({
        stage: 'fell_to_person',
        cause: 'ai_permission_interrupted',
        agentsMayWork: true,
        actions: { reroute: true },
      });
      const again = await post(founder, `/api/requests/${id}/routing`, {
        unitCode: 'HAF',
        agentCode: 'HAF-2',
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
      ]);
    });

    it('the customer’s permission holds a request like the project’s own', async () => {
      const customerId = randomUUID();
      const made = await workable({
        name: 'Müşterisinin izni kapanan proje',
        customer: { kind: 'new', id: customerId, name: `Müşteri ${customerId}` },
      });
      // Agents may work only once both are open.
      const early = await sendIn(employee, made.id);
      expect(errorCode(early)).toBe('project_ai_not_allowed');
      await adminQuery('update office.customers set ai_allowed = true where id = $1', [customerId]);
      const id = await routedIn(made.id);
      const closed = await send(
        server,
        founder,
        'PATCH',
        `/api/customers/${customerId}/permissions`,
        {
          company: ids.arma,
          payload: { aiAllowed: false },
        },
      );
      expect(closed.statusCode, closed.body).toBe(200);
      expect(await read(founder, id)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'ai_permission_closed',
        agentsMayWork: false,
        actions: { reroute: false },
      });
    });

    it('while the permission is closed a result is not approved and no changes are asked for; it is rejected or stopped', async () => {
      await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
      const made = await workable({ name: 'Sonucu bekleyen proje' });
      const first = await submittedIn(made.id, { goesExternal: true });
      const stopped = await submittedIn(made.id);
      await closeAi(made.id);

      // The result keeps its stage and its card; the card says that agents may not work.
      const detail = await read(founder, first.id);
      expect(detail).toMatchObject({
        stage: 'unit_approval',
        cause: null,
        agentsMayWork: false,
        approval: { id: first.approvalId, agentsMayWork: false, needsStepUp: true },
        actions: { stop: true, reroute: false },
      });
      // It still waits for the founder's decision: on the list and in the counts.
      const desk = approvalDeskSchema.parse((await get(founder, '/api/approvals')).json());
      expect(desk.approvals.find((item) => item.id === first.approvalId)).toMatchObject({
        agentsMayWork: false,
      });
      // The requester reads why nothing moves, and not the result.
      expect(await read(employee, first.id)).toMatchObject({
        stage: 'unit_approval',
        agentsMayWork: false,
        approval: null,
      });

      const url = `/api/approvals/${first.approvalId}/decision`;
      const before = server.jobs.sent.length;
      // Approving is refused before the passkey is asked for, and with one the challenge stays.
      expect(held(await post(founder, url, { decision: 'approved', selectedOption: 'A' }))).toEqual(
        [409, 'ai_permission_closed', HELD],
      );
      const stepUp = await signStepUp(server, founder, founderKey, {
        purpose: 'approve',
        companyId: ids.arma,
        subjectId: first.approvalId,
        details: approvalDecisionDetails('A'),
      });
      expect(
        held(await post(founder, url, { decision: 'approved', selectedOption: 'A', stepUp })),
      ).toEqual([409, 'ai_permission_closed', HELD]);
      expect(
        await adminQuery(
          'select consumed_at is not null as consumed from office.passkey_challenges where id = $1',
          [stepUp.challengeId],
        ),
      ).toEqual([{ consumed: false }]);
      // A change request would call for a run.
      expect(
        held(await post(founder, url, { decision: 'changes_requested', reason: 'incomplete' })),
      ).toEqual([409, 'ai_permission_closed', HELD]);
      expect(server.jobs.sent).toHaveLength(before);
      expect((await read(founder, first.id)).stage).toBe('unit_approval');

      // Rejecting closes the request, as always; the requester is told.
      const rejected = await post(founder, url, { decision: 'rejected', reason: 'incomplete' });
      expect(rejected.statusCode, rejected.body).toBe(200);
      expect(requestDetailSchema.parse(rejected.json())).toMatchObject({
        status: 'cancelled',
        cause: 'rejected',
      });
      // And the work can be stopped.
      const stop = await post(founder, `/api/requests/${stopped.id}/close`, {
        reason: 'İzin kapalıyken bekletilmeyecek.',
      });
      expect(stop.statusCode, stop.body).toBe(200);
      expect(requestDetailSchema.parse(stop.json()).status).toBe('cancelled');
    });

    it('with the permission open again the same result is approved, with the same passkey confirmation', async () => {
      await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
      const made = await workable({ name: 'İzni yeniden açılan proje' });
      const { id, approvalId } = await submittedIn(made.id, { goesExternal: true });
      await closeAi(made.id);
      const stepUp = await signStepUp(server, founder, founderKey, {
        purpose: 'approve',
        companyId: ids.arma,
        subjectId: approvalId,
        details: approvalDecisionDetails('B'),
      });
      const url = `/api/approvals/${approvalId}/decision`;
      const body = { decision: 'approved', selectedOption: 'B', stepUp };
      expect(errorCode(await post(founder, url, body))).toBe('ai_permission_closed');
      await allowAi(made.id);
      const approved = await post(founder, url, body);
      expect(approved.statusCode, approved.body).toBe(200);
      expect(requestDetailSchema.parse(approved.json())).toMatchObject({
        id,
        stage: 'requester_approval',
        agentsMayWork: true,
      });
    });

    it('the requester accepts an approved result while the permission is closed and cannot ask for changes', async () => {
      const made = await workable({ name: 'Onaylanmış sonucu bekleyen proje' });
      const accepted = await submittedIn(made.id);
      const asked = await submittedIn(made.id);
      for (const { approvalId } of [accepted, asked]) {
        const res = await post(founder, `/api/approvals/${approvalId}/decision`, {
          decision: 'approved',
          selectedOption: 'A',
        });
        expect(res.statusCode, res.body).toBe(200);
      }
      // The approval desk says for an acceptance too whether agents may work.
      const waiting = async (requestId: string) =>
        approvalDeskSchema
          .parse((await get(employee, '/api/approvals')).json())
          .acceptances.find((item) => item.requestId === requestId);
      expect(await waiting(asked.id)).toMatchObject({ agentsMayWork: true, forRequester: null });
      await closeAi(made.id);
      expect(await waiting(asked.id)).toMatchObject({ agentsMayWork: false, forRequester: null });
      expect(await read(employee, asked.id)).toMatchObject({
        stage: 'requester_approval',
        waitingForMe: true,
        agentsMayWork: false,
        acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: false },
      });

      const before = server.jobs.sent.length;
      const changes = await post(employee, `/api/requests/${asked.id}/acceptance`, {
        decision: 'changes_requested',
        note: 'Daha kısa olsun.',
      });
      expect(held(changes)).toEqual([409, 'ai_permission_closed', HELD]);
      expect(server.jobs.sent).toHaveLength(before);
      expect((await read(employee, asked.id)).stage).toBe('requester_approval');
      // Accepting the result that was approved while the permission was open starts no agent.
      const done = await post(employee, `/api/requests/${accepted.id}/acceptance`, {
        decision: 'approved',
      });
      expect(done.statusCode, done.body).toBe(200);
      expect(requestDetailSchema.parse(done.json()).status).toBe('done');
      // With the permission open again the change request goes back to the agent.
      await allowAi(made.id);
      const later = await post(employee, `/api/requests/${asked.id}/acceptance`, {
        decision: 'changes_requested',
        note: 'Daha kısa olsun.',
      });
      expect(later.statusCode, later.body).toBe(200);
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: asked.id, agentCode: 'HAF-2' },
      ]);
    });

    it('an approval that meets a close of the permission is answered as held', async () => {
      const made = await workable({ name: 'Karar sırasında izni kapanan proje' });
      const { id, approvalId } = await submittedIn(made.id);
      // Somebody closes the permission and has not committed: the route still reads it open, and
      // the database's own hold waits for the close and then refuses.
      const admin = await adminPool.connect();
      let pending: Promise<LightMyRequestResponse>;
      try {
        await admin.query('begin');
        await admin.query('update office.projects set ai_allowed = false where id = $1', [made.id]);
        pending = post(founder, `/api/approvals/${approvalId}/decision`, {
          decision: 'approved',
          selectedOption: 'A',
        });
        await untilServerWaits();
        await admin.query('commit');
      } catch (error) {
        await admin.query('rollback');
        throw error;
      } finally {
        admin.release();
      }
      expect(held(await pending)).toEqual([409, 'ai_permission_closed', HELD]);
      expect(await read(founder, id)).toMatchObject({
        stage: 'unit_approval',
        agentsMayWork: false,
      });
      expect(
        await adminQuery('select status from office.approvals where id = $1', [approvalId]),
      ).toEqual([{ status: 'pending' }]);
    });

    it('a project that is closed takes no new request and lets its open requests finish', async () => {
      const made = await workable({ name: 'Kapanırken talepleri süren proje' });
      const first = await submittedIn(made.id);
      const second = await submittedIn(made.id);
      // A member closes the project.
      const closed = await send(server, employee, 'PATCH', `/api/projects/${made.id}`, {
        company: ids.arma,
        payload: { status: 'completed' },
      });
      expect(closed.statusCode, closed.body).toBe(200);
      expect(projectDetailSchema.parse(closed.json()).closed).toBe(true);
      expect(errorCode(await sendIn(employee, made.id))).toBe('project_closed');

      // The open requests go on: nothing about them is held (decision 48).
      expect(await read(founder, first.id)).toMatchObject({
        stage: 'unit_approval',
        agentsMayWork: true,
        actions: { reroute: true },
        approval: { agentsMayWork: true },
      });
      const before = server.jobs.sent.length;
      const changes = await post(founder, `/api/approvals/${first.approvalId}/decision`, {
        decision: 'changes_requested',
        reason: 'incomplete',
      });
      expect(changes.statusCode, changes.body).toBe(200);
      expect(requestDetailSchema.parse(changes.json()).stage).toBe('revising');
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: first.id, agentCode: 'HAF-2' },
      ]);
      // And to their end.
      const approved = await post(founder, `/api/approvals/${second.approvalId}/decision`, {
        decision: 'approved',
        selectedOption: 'A',
      });
      expect(approved.statusCode, approved.body).toBe(200);
      const accepted = await post(employee, `/api/requests/${second.id}/acceptance`, {
        decision: 'approved',
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(requestDetailSchema.parse(accepted.json())).toMatchObject({
        status: 'done',
        project: { id: made.id },
      });
      // The list of the closed project still holds them.
      expect(await listed(founder, `?project=${made.id}`)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );
    });

    // Waiting work starts again when the permission is opened (8 October decision 49) -------------

    /** The founder opens the project's AI permission with the passkey; the answer of the route. */
    async function openAi(projectId: string, customerId: string | null = null) {
      const stepUp = await signStepUp(server, founder, founderKey, {
        purpose: 'project_ai_permission',
        companyId: ids.arma,
        subjectId: projectId,
        details: projectAiPermissionDetails(customerId),
      });
      const res = await put(founder, `/api/projects/${projectId}/ai-permission`, {
        allowed: true,
        customerId,
        stepUp,
      });
      expect(res.statusCode, res.body).toBe(200);
      return projectAiPermissionAnswerSchema.parse(res.json());
    }

    const working = {
      status: 'in_progress',
      stage: 'working',
      cause: null,
      delayed: false,
      turn: { kind: 'agent', code: 'HAF-2' },
      waitingForMe: false,
      agentsMayWork: true,
    };

    it('opening the project’s AI permission again restarts its held requests once', async () => {
      await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
      await settle();
      const made = await workable({ name: 'İzni açılınca süren proje' });
      // One request whose run is open when the permission is closed, one whose job arrives while
      // it is closed, and one outside the project whose job was refused for another reason.
      const heldRun = await routedIn(made.id);
      const runId = await openRun(heldRun, made.id);
      const heldJob = await routedIn(made.id);
      const outside = await open(employee);
      await route(outside.id, ids.employee);
      await refusedAtTheGate(outside.id, 'HAF-2');
      expect(await waitingFor(`project=${made.id}`)).toBe(0);

      await closeAi(made.id);
      expect(
        await adminQuery('select status, error_code from office.runs where id = $1', [runId]),
      ).toEqual([{ status: 'stopped', error_code: 'ai_permission_closed' }]);
      await refusedAtTheGate(heldJob, 'HAF-2', made.id);
      for (const id of [heldRun, heldJob]) {
        expect(await read(founder, id), id).toMatchObject({
          stage: 'fell_to_person',
          cause: 'ai_permission_closed',
          agentsMayWork: false,
        });
      }
      // The confirmation of the opening is told the number: the two of this project. The agent's
      // switch is not what holds them; it would start the one outside.
      expect(await waitingFor(`project=${made.id}`)).toBe(2);
      expect(await waitingFor('agent=HAF-2')).toBe(1);

      const jobs = server.jobs.sent.length;
      const opened = await openAi(made.id);
      expect(opened).toMatchObject({ id: made.id, aiAllowed: true, restarted: 2 });
      const sent = server.jobs.sent.slice(jobs);
      expect(sent).toHaveLength(2);
      expect(sent).toEqual(
        expect.arrayContaining(
          [heldRun, heldJob].map((taskId) => ({
            companyId: ids.arma,
            userId: ids.employee,
            taskId,
            agentCode: 'HAF-2',
          })),
        ),
      );
      for (const id of [heldRun, heldJob]) {
        for (const reader of [founder, employee]) {
          expect(await read(reader, id), id).toMatchObject(working);
        }
        expect((await traceOf(id)).at(-1), id).toEqual({
          event: 'run_restarted',
          user_id: ids.founder,
          agent_code: null,
        });
      }
      // The request outside the project was not this opening's to start.
      expect((await traceOf(outside.id)).map((row) => row.event)).toEqual(['run_refused']);
      expect(await read(founder, outside.id)).toMatchObject({ cause: 'not_started' });

      // Exactly once: asked for the value the project has, and closed and opened with nothing
      // held, the opening starts nothing.
      expect(await waitingFor(`project=${made.id}`)).toBe(0);
      const same = await put(founder, `/api/projects/${made.id}/ai-permission`, {
        allowed: true,
        customerId: null,
      });
      expect(projectAiPermissionAnswerSchema.parse(same.json()).restarted).toBe(0);
      const closed = await put(founder, `/api/projects/${made.id}/ai-permission`, {
        allowed: false,
      });
      expect(projectAiPermissionAnswerSchema.parse(closed.json())).toMatchObject({
        aiAllowed: false,
        restarted: 0,
      });
      expect(await waitingFor(`project=${made.id}`)).toBe(0);
      expect((await openAi(made.id)).restarted).toBe(0);
      expect(server.jobs.sent).toHaveLength(jobs + 2);

      // A restarted job that the runner refuses again reads "çalışma başlamadı": the permission
      // and the agent are open, so neither switch explains it, and a person routes it again.
      await refusedAtTheGate(heldJob, 'HAF-2', made.id);
      expect(await read(founder, heldJob)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'not_started',
        agentsMayWork: true,
        waitingForMe: true,
        actions: { reroute: true },
      });
    });

    it('with the request’s agent stopped the reopened permission starts nothing; the agent’s opening does', async () => {
      await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
      await settle();
      const made = await workable({ name: 'Ajanı da duran proje' });
      const id = await routedIn(made.id);
      await openRun(id, made.id);
      await closeAi(made.id);
      await stop();
      try {
        // Held by both: counted for neither opening while the other is closed.
        expect(await waitingFor(`project=${made.id}`)).toBe(0);
        expect(await waitingFor('agent=HAF-2')).toBe(0);
        const jobs = server.jobs.sent.length;
        expect((await openAi(made.id)).restarted).toBe(0);
        expect(server.jobs.sent).toHaveLength(jobs);
        // The permission is open again and the work was not started again: the page says that
        // the close interrupted it. The agent's opening is what would start it now.
        expect(await read(founder, id)).toMatchObject({
          stage: 'fell_to_person',
          cause: 'ai_permission_interrupted',
          agentsMayWork: true,
          waitingForMe: true,
        });
        // Only the close left its trace on the request: no restart.
        expect((await traceOf(id)).map((row) => row.event)).toEqual(['run_stopped']);
        expect(await waitingFor('agent=HAF-2')).toBe(1);

        expect(await openAgain()).toBe(1);
        expect(server.jobs.sent.slice(jobs)).toEqual([
          { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
        ]);
        expect(await read(founder, id)).toMatchObject(working);
      } finally {
        await openAgain();
      }
    });

    it('opening a customer’s AI permission again restarts the held requests of its projects', async () => {
      await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
      await settle();
      const customerId = randomUUID();
      const otherCustomerId = randomUUID();
      const one = await workable({
        name: 'Müşterinin ilk projesi',
        customer: { kind: 'new', id: customerId, name: `Müşteri ${customerId}` },
      });
      const two = await workable({
        name: 'Müşterinin ikinci projesi',
        customer: { kind: 'existing', customerId },
      });
      const other = await workable({
        name: 'Başka müşterinin projesi',
        customer: { kind: 'new', id: otherCustomerId, name: `Müşteri ${otherCustomerId}` },
      });
      await adminQuery('update office.customers set ai_allowed = true where id = any ($1)', [
        [customerId, otherCustomerId],
      ]);
      const inOne = await routedIn(one.id);
      const runId = await openRun(inOne, one.id);
      const inTwo = await routedIn(two.id);
      // A request of another customer's project that waits for another reason.
      const inOther = await routedIn(other.id);
      await refusedAtTheGate(inOther, 'HAF-2', other.id);

      const permissions = (payload: object) =>
        send(server, founder, 'PATCH', `/api/customers/${customerId}/permissions`, {
          company: ids.arma,
          payload,
        });
      const closed = await permissions({ aiAllowed: false });
      expect(closed.statusCode, closed.body).toBe(200);
      expect(customerPermissionsAnswerSchema.parse(closed.json())).toMatchObject({
        aiAllowed: false,
        restarted: 0,
      });
      expect(
        await adminQuery('select status, error_code from office.runs where id = $1', [runId]),
      ).toEqual([{ status: 'stopped', error_code: 'ai_permission_closed' }]);
      await refusedAtTheGate(inTwo, 'HAF-2', two.id);

      // The number before the opening: the two of this customer's projects. The projects' own
      // permissions are open, so their opening would start nothing.
      expect(await waitingFor(`customer=${customerId}`)).toBe(2);
      expect(await waitingFor(`project=${one.id}`)).toBe(0);

      const jobs = server.jobs.sent.length;
      // The other permission alone opens nothing and starts nothing.
      const automated = await permissions({ automatedProcessingAllowed: true });
      expect(customerPermissionsAnswerSchema.parse(automated.json())).toMatchObject({
        aiAllowed: false,
        restarted: 0,
      });
      expect(server.jobs.sent).toHaveLength(jobs);

      const stepUp = await signStepUp(server, founder, founderKey, {
        purpose: 'customer_ai_permission',
        companyId: ids.arma,
        subjectId: customerId,
        details: customerPermissionDetails({}),
      });
      const opened = await permissions({ aiAllowed: true, stepUp });
      expect(opened.statusCode, opened.body).toBe(200);
      expect(customerPermissionsAnswerSchema.parse(opened.json())).toMatchObject({
        id: customerId,
        aiAllowed: true,
        restarted: 2,
      });
      const sent = server.jobs.sent.slice(jobs);
      expect(sent).toHaveLength(2);
      expect(sent.map((job) => job.taskId).sort()).toEqual([inOne, inTwo].sort());
      for (const id of [inOne, inTwo]) {
        expect(await read(founder, id), id).toMatchObject(working);
      }
      // Nothing of the other customer was started.
      expect((await traceOf(inOther)).map((row) => row.event)).toEqual(['run_refused']);
      // Open already: the same request again starts nothing.
      expect(await waitingFor(`customer=${customerId}`)).toBe(0);
      const again = await permissions({ aiAllowed: true });
      expect(customerPermissionsAnswerSchema.parse(again.json()).restarted).toBe(0);
      expect(server.jobs.sent).toHaveLength(jobs + 2);
    });

    // A request that goes on in the founder's name (8 October decision 45) ------------------------
    describe('a request that goes on in the founder’s name', () => {
      /** The founder's project with the employee as a plain member: a member can be removed. */
      async function shared(name: string, memberIds: string[] = []): Promise<ProjectDetail> {
        const made = await project(founder, { name, memberIds: [ids.employee, ...memberIds] });
        await allowAi(made.id);
        return made;
      }

      /** The owner (here the founder) takes the employee out of the project. */
      async function takeOut(projectId: string): Promise<void> {
        const res = await send(
          server,
          founder,
          'DELETE',
          `/api/projects/${projectId}/members/${ids.employee}`,
          { company: ids.arma },
        );
        expect(res.statusCode, res.body).toBe(200);
      }

      /** The employee's request in the project with a result the founder approved. */
      async function approvedIn(projectId: string): Promise<{ id: string; approvalId: string }> {
        const made = await submittedIn(projectId);
        const res = await post(founder, `/api/approvals/${made.approvalId}/decision`, {
          decision: 'approved',
          selectedOption: 'A',
        });
        expect(res.statusCode, res.body).toBe(200);
        return made;
      }

      const today = async (session: string): Promise<Today> =>
        todaySchema.parse((await get(session, '/api/today')).json());
      const counts = async (session: string): Promise<SidebarCounts> =>
        sidebarCountsSchema.parse((await get(session, '/api/today/counts')).json());
      const desk = async (session: string) =>
        approvalDeskSchema.parse((await get(session, '/api/approvals')).json());
      const answers = (detail: RequestDetail) =>
        detail.journey.flatMap((item) => (item.kind === 'acceptance' ? [item] : []));

      it('a requester taken out of the project gets 404 for their request; the request stays theirs for everybody who reads it', async () => {
        const made = await shared('Talep sahibi çıkarılan proje', [ids.holder]);
        const id = await routedIn(made.id);
        const theirs = {
          id,
          requester: { userId: ids.employee },
          project: { id: made.id },
          stage: 'working',
          turn: { kind: 'agent', code: 'HAF-2' },
        };
        expect(await read(founder, id)).toMatchObject({ ...theirs, requesterReads: true });
        await takeOut(made.id);

        for (const [method, url, payload] of [
          ['GET', `/api/requests/${id}`, undefined],
          ['POST', `/api/requests/${id}/close`, {}],
          ['POST', `/api/requests/${id}/acceptance`, { decision: 'approved' }],
          ['POST', `/api/requests/${id}/comments`, { id: randomUUID(), body: 'x' }],
        ] as const) {
          const res =
            method === 'GET' ? await get(employee, url) : await post(employee, url, payload);
          expect([res.statusCode, errorCode(res)], url).toEqual([404, 'not_found']);
        }
        expect(await listed(employee)).not.toContain(id);
        expect(await listed(employee, '?mine=true')).not.toContain(id);

        // For those who read it nothing changed hands: the requester is still named, the work
        // goes on, and only the detail says that the requester does not read it any more.
        for (const reader of [founder, colleague]) {
          expect(await read(reader, id)).toMatchObject({ ...theirs, requesterReads: false });
          const row = requestListSchema
            .parse((await get(reader, `/api/requests?project=${made.id}`)).json())
            .requests.find((request) => request.id === id);
          expect(row).toMatchObject({ ...theirs });
        }
        expect(
          await adminQuery('select requester_user_id from office.tasks where id = $1', [id]),
        ).toEqual([{ requester_user_id: ids.employee }]);
        // It is nobody's own request now: the founder's "mine" does not hold it.
        expect(await listed(founder, '?mine=true')).not.toContain(id);
      });

      it('the founder is asked for the requester’s approval in their place and gives it; the journey names who answered', async () => {
        const made = await shared('Onayı kurucuya kalan proje');
        const { id } = await approvedIn(made.id);
        const waitsForRequester = {
          stage: 'requester_approval',
          turn: { kind: 'person', userId: ids.employee },
          requesterReads: true,
        };
        expect(await read(founder, id)).toMatchObject({
          ...waitsForRequester,
          waitingForMe: false,
          acceptance: null,
        });
        expect(await read(employee, id)).toMatchObject({
          ...waitsForRequester,
          waitingForMe: true,
          acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: false },
        });
        expect((await desk(founder)).acceptances.map((item) => item.requestId)).not.toContain(id);
        expect((await today(founder)).expected.map((item) => item.id)).not.toContain(id);
        const before = await counts(founder);

        await takeOut(made.id);
        const detail = await read(founder, id);
        expect(detail).toMatchObject({
          status: 'awaiting_approval',
          stage: 'requester_approval',
          turn: { kind: 'founder' },
          waitingForMe: true,
          requester: { userId: ids.employee },
          requesterReads: false,
          acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: true },
        });
        const card = (await desk(founder)).acceptances.find((item) => item.requestId === id);
        expect(card).toMatchObject({
          requestId: id,
          round: 1,
          forRequester: { userId: ids.employee, name: 'Çalışan' },
        });
        expect((await today(founder)).expected.find((item) => item.id === id)).toMatchObject({
          stage: 'requester_approval',
        });
        expect(await counts(founder)).toEqual({
          today: before.today + 1,
          approvals: before.approvals + 1,
        });

        const accepted = await post(founder, `/api/requests/${id}/acceptance`, {
          decision: 'approved',
        });
        expect(accepted.statusCode, accepted.body).toBe(200);
        const done = requestDetailSchema.parse(accepted.json());
        expect(done).toMatchObject({
          status: 'done',
          requester: { userId: ids.employee },
          requesterReads: false,
          acceptance: null,
        });
        expect(answers(done)).toMatchObject([
          { status: 'approved', decidedBy: { userId: ids.founder } },
        ]);
        expect(
          await adminQuery(
            `select requester_user_id, decided_by_user_id, status
             from office.requester_approvals where task_id = $1`,
            [id],
          ),
        ).toEqual([
          { requester_user_id: ids.employee, decided_by_user_id: ids.founder, status: 'approved' },
        ]);
        expect(await counts(founder)).toEqual(before);
        // A requester who answers themselves is not named a second time.
        const own = await approvedIn((await workable({ name: 'Kendi yanıtladığı proje' })).id);
        const mine = await post(employee, `/api/requests/${own.id}/acceptance`, {
          decision: 'approved',
        });
        expect(answers(requestDetailSchema.parse(mine.json()))).toMatchObject([
          { status: 'approved', decidedBy: null },
        ]);
      });

      it('the founder cannot give the requester’s approval while the requester reads the request', async () => {
        const made = await shared('Onayı talep sahibinde kalan proje', [RIGHT_HOLDER]);
        const { id } = await approvedIn(made.id);
        const refused = async (session: string): Promise<unknown[]> => {
          const res = await post(session, `/api/requests/${id}/acceptance`, {
            decision: 'approved',
          });
          return [res.statusCode, errorCode(res)];
        };
        // The requester can answer themselves: nobody answers for them.
        expect(await refused(founder)).toEqual([409, 'approval_closed']);
        expect(await refused(rightHolder)).toEqual([409, 'approval_closed']);
        expect((await read(founder, id)).stage).toBe('requester_approval');

        await takeOut(made.id);
        // Standing in is the founder's alone: the approval right does not give it.
        expect(await refused(rightHolder)).toEqual([409, 'approval_closed']);
        expect(await read(rightHolder, id)).toMatchObject({
          stage: 'requester_approval',
          turn: { kind: 'founder' },
          waitingForMe: false,
          requesterReads: false,
          acceptance: null,
        });
        expect((await desk(rightHolder)).acceptances.map((item) => item.requestId)).not.toContain(
          id,
        );
        expect(
          await adminQuery('select status from office.requester_approvals where task_id = $1', [
            id,
          ]),
        ).toEqual([{ status: 'pending' }]);
        // Added back, the requester answers again and the founder does not.
        const back = await put(founder, `/api/projects/${made.id}/members/${ids.employee}`, {});
        expect(back.statusCode, back.body).toBe(200);
        expect(await refused(founder)).toEqual([409, 'approval_closed']);
        expect(await read(founder, id)).toMatchObject({
          turn: { kind: 'person', userId: ids.employee },
          requesterReads: true,
          acceptance: null,
        });
        const own = await post(employee, `/api/requests/${id}/acceptance`, {
          decision: 'approved',
        });
        expect(own.statusCode, own.body).toBe(200);
      });

      it('the founder asks for changes in the requester’s place: the job names the requester and the step is active again', async () => {
        const made = await shared('Düzeltmeyi kurucunun istediği proje');
        const { id } = await approvedIn(made.id);
        await takeOut(made.id);
        const before = server.jobs.sent.length;
        const res = await post(founder, `/api/requests/${id}/acceptance`, {
          decision: 'changes_requested',
          note: 'Açılış tarihi de yazsın.',
        });
        expect(res.statusCode, res.body).toBe(200);
        const detail = requestDetailSchema.parse(res.json());
        expect(detail).toMatchObject({
          status: 'in_progress',
          stage: 'revising',
          turn: { kind: 'agent', code: 'HAF-2' },
          requester: { userId: ids.employee },
          requesterReads: false,
          acceptance: null,
        });
        expect(answers(detail)).toMatchObject([
          {
            status: 'changes_requested',
            decidedBy: { userId: ids.founder },
            note: 'Açılış tarihi de yazsın.',
          },
        ]);
        // The job is the one a requester's own change request sends: it names the requester. In
        // whose name the run goes is the database's answer when the run opens.
        expect(server.jobs.sent.slice(before)).toEqual([
          { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
        ]);
        expect(
          await adminQuery(
            'select status, agent_code from office.task_routings where task_id = $1',
            [id],
          ),
        ).toEqual([{ status: 'active', agent_code: 'HAF-2' }]);
      });

      it('a requester who is made an external person or removed from the company: the same answers', async () => {
        await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
        await adminExec(
          Object.values(LEAVERS)
            .map(
              (person) => `
          insert into office.users (id, name) values ('${person.id}', '${person.name}')
            on conflict do nothing;
          insert into office.user_emails (email, user_id)
            values ('${person.account.email}', '${person.id}') on conflict do nothing;
          insert into office.memberships (company_id, user_id, role)
            values ('${ids.arma}', '${person.id}', 'employee') on conflict do nothing;`,
            )
            .join('\n'),
        );
        const confirm = (userId: string, change: Parameters<typeof memberChangeDetails>[0]) =>
          signStepUp(server, founder, founderKey, {
            purpose: 'membership_change',
            companyId: ids.arma,
            subjectId: userId,
            details: memberChangeDetails(change),
          });

        for (const [person, leave] of [
          [
            LEAVERS.external,
            async () =>
              send(server, founder, 'PATCH', `/api/members/${LEAVERS.external.id}`, {
                company: ids.arma,
                payload: {
                  role: 'external',
                  stepUp: await confirm(LEAVERS.external.id, { role: 'external' }),
                },
              }),
          ],
          [
            LEAVERS.removed,
            async () =>
              send(server, founder, 'DELETE', `/api/members/${LEAVERS.removed.id}`, {
                company: ids.arma,
                payload: { stepUp: await confirm(LEAVERS.removed.id, 'remove') },
              }),
          ],
        ] as const) {
          const session = await sessionOf(server, person.account);
          // One request still at its agent, one with an approved result; neither in a project.
          const working = await open(session);
          await route(working.id, person.id);
          const waiting = await open(session);
          await route(waiting.id, person.id);
          const approved = await post(
            founder,
            `/api/approvals/${await submit(waiting.id, person.id)}/decision`,
            { decision: 'approved', selectedOption: 'A' },
          );
          expect(approved.statusCode, approved.body).toBe(200);
          expect(await read(session, waiting.id)).toMatchObject({
            waitingForMe: true,
            requesterReads: true,
          });

          const left = await leave();
          expect(left.statusCode, left.body).toBeLessThan(300);
          // The person reads neither request any more.
          for (const id of [working.id, waiting.id]) {
            const res = await get(session, `/api/requests/${id}`);
            expect([res.statusCode, errorCode(res)], person.name).toEqual(person.refusal);
          }
          // The requests go on, still their requester's. A person who is no member of the
          // company any more has no name for anybody in it (the rule of people's names; the
          // page then says so itself).
          const name = person === LEAVERS.removed ? null : person.name;
          expect(await read(founder, working.id), person.name).toMatchObject({
            status: 'in_progress',
            stage: 'working',
            turn: { kind: 'agent', code: 'HAF-2' },
            requester: { userId: person.id, name },
            requesterReads: false,
          });
          expect(await read(founder, waiting.id), person.name).toMatchObject({
            stage: 'requester_approval',
            turn: { kind: 'founder' },
            waitingForMe: true,
            requester: { userId: person.id },
            requesterReads: false,
            acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: true },
          });
          expect(
            (await desk(founder)).acceptances.find((item) => item.requestId === waiting.id),
            person.name,
          ).toMatchObject({ forRequester: { userId: person.id, name } });
          const accepted = await post(founder, `/api/requests/${waiting.id}/acceptance`, {
            decision: 'approved',
          });
          expect(accepted.statusCode, accepted.body).toBe(200);
          const done = requestDetailSchema.parse(accepted.json());
          expect(done.status).toBe('done');
          expect(answers(done)).toMatchObject([
            { status: 'approved', decidedBy: { userId: ids.founder } },
          ]);
        }
      });
    });
  });
});
