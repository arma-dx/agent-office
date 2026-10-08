import { randomUUID } from 'node:crypto';
import { agentStep, createPool, withContext } from '@agent-office/db';
import {
  BACKGROUND_HEADER,
  COMPANY_HEADER,
  COORDINATOR_AGENT_CODE,
  NOTIFICATION_LIST_LIMIT,
  apiErrorSchema,
  approvalDecisionDetails,
  approvalDeskSchema,
  officeAgentSchema,
  requestDetailSchema,
  requestIntakeSchema,
  requestListSchema,
  routingOptionsSchema,
  sidebarCountsSchema,
  todaySchema,
  type RequestDetail,
  type SidebarCounts,
  type Today,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
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
      delete from office.memberships where user_id = '${RIGHT_HOLDER}';
      alter table office.memberships enable trigger require_step_up;
    `);
    await workerPool.end();
    await besidePool.end();
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
  ) {
    await agentStep(
      workerPool,
      { companyId: ids.arma, userId: requester, agentCode: 'KOR-1' },
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
    options: { goesExternal?: boolean; previous?: string } = {},
  ): Promise<string> {
    return agentStep(
      workerPool,
      { companyId: ids.arma, userId: requester, agentCode: 'HAF-2' },
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
    expect((await read(employee, id)).acceptance).toEqual({ round: 2, returnsToAgent: false });
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
    expect((await read(employee, id)).acceptance).toEqual({ round: 1, returnsToAgent: true });
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
    expect((await read(employee, id)).acceptance).toEqual({ round: 2, returnsToAgent: true });
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
    expect((await read(employee, id)).acceptance).toEqual({ round: 3, returnsToAgent: false });
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

  it('work that could not be started stays with a person, also after the agent is opened again', async () => {
    const stop = () => put(founder, '/api/agents/HAF-2/switch', { status: 'stopped' });
    const openAgain = () => put(founder, '/api/agents/HAF-2/switch', { status: 'enabled' });
    const notStarted = {
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'not_started',
      delayed: false,
      turn: { kind: 'founder' },
    };
    const traceOf = (id: string) =>
      adminQuery(
        `select event, user_id, agent_code from office.audit_log
         where record_type = 'task' and record_id = $1 and event like 'run_%' order by id`,
        [id],
      );
    /** What the runner leaves when it refuses a job at its gate: one row, in the agent's context. */
    const refusedAtTheGate = (taskId: string, agentCode: string) =>
      agentStep(workerPool, { companyId: ids.arma, userId: ids.employee, agentCode }, (client) =>
        client.query(
          `insert into office.audit_log (company_id, event, record_type, record_id)
           values (office.ctx_company_id(), 'run_refused', 'task', $1)`,
          [taskId],
        ),
      );

    // The approver asks for changes while the agent is stopped: no job, and the page says why.
    const first = await open(employee);
    await route(first.id, ids.employee);
    const approvalId = await submit(first.id, ids.employee);
    // The requester says "not what I asked for" while the agent is stopped.
    const second = await open(employee);
    await route(second.id, ids.employee);
    await post(founder, `/api/approvals/${await submit(second.id, ids.employee)}/decision`, {
      decision: 'approved',
      selectedOption: 'A',
    });
    // A job the runner refuses at its gate because the agent is stopped when it arrives.
    const third = await open(employee);
    await route(third.id, ids.employee);
    const jobs = server.jobs.sent.length;
    await stop();
    try {
      const sentBack = await post(founder, `/api/approvals/${approvalId}/decision`, {
        decision: 'changes_requested',
        reason: 'incomplete',
      });
      expect(requestDetailSchema.parse(sentBack.json())).toMatchObject({
        stage: 'fell_to_person',
        cause: 'agent_stopped',
      });
      const refusedResult = await post(employee, `/api/requests/${second.id}/acceptance`, {
        decision: 'changes_requested',
        note: 'Açılış tarihi de yazsın.',
      });
      expect(requestDetailSchema.parse(refusedResult.json())).toMatchObject({
        stage: 'fell_to_person',
        cause: 'agent_stopped',
      });
      await refusedAtTheGate(third.id, 'HAF-2');
      expect(await read(employee, third.id)).toMatchObject({ cause: 'agent_stopped' });
    } finally {
      await openAgain();
    }
    // Nothing was put on the queue, neither by the change requests nor by opening the agent.
    expect(server.jobs.sent).toHaveLength(jobs);
    expect(await traceOf(first.id)).toEqual([
      { event: 'run_not_started', user_id: ids.founder, agent_code: null },
    ]);
    expect(await traceOf(second.id)).toEqual([
      { event: 'run_not_started', user_id: ids.employee, agent_code: null },
    ]);
    // The agent is open again, and still nobody is told that it has the turn: the page says the
    // work did not start, to the requester and to the founder, who is the one to act.
    for (const id of [first.id, second.id, third.id]) {
      expect(await read(employee, id)).toMatchObject({ ...notStarted, waitingForMe: false });
      expect(await read(founder, id)).toMatchObject({
        ...notStarted,
        waitingForMe: true,
        actions: { cancel: false, stop: true, reroute: true },
      });
    }
    const list = requestListSchema.parse((await get(employee, '/api/requests')).json());
    expect(list.requests.find((request) => request.id === first.id)).toMatchObject(notStarted);
    // The way on: the founder gives the work to the agent again, and a job is sent.
    const again = await post(founder, `/api/requests/${first.id}/routing`, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
    });
    expect(requestDetailSchema.parse(again.json())).toMatchObject({
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'HAF-2' },
    });
    expect(server.jobs.sent.slice(jobs)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: first.id, agentCode: 'HAF-2' },
    ]);

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
});
