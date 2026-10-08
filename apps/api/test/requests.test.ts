import { randomUUID } from 'node:crypto';
import { agentStep, createPool } from '@agent-office/db';
import {
  COMPANY_HEADER,
  COORDINATOR_AGENT_CODE,
  apiErrorSchema,
  approvalDecisionDetails,
  approvalDeskSchema,
  officeAgentSchema,
  requestDetailSchema,
  requestIntakeSchema,
  requestListSchema,
  routingOptionsSchema,
  type RequestDetail,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
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
      acceptance: { round: 1 },
      result: {
        approvalId,
        option: { code: 'B', text: 'Artık yeni ofisimizdeyiz.' },
        approvedBy: { userId: ids.founder, name: 'Kurucu' },
      },
    });
    const mine = approvalDeskSchema.parse((await get(employee, '/api/approvals')).json());
    expect(mine.acceptances).toMatchObject([{ requestId: id, round: 1 }]);
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
    expect((await read(employee, id)).acceptance).toEqual({ round: 2 });
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
});
