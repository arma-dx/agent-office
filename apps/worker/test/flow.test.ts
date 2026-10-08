import { randomUUID } from 'node:crypto';
import {
  AGENT_RUN_DEAD_QUEUE,
  AGENT_RUN_QUEUE,
  agentRunSender,
  createQueue,
  ensureAgentRunQueues,
} from '@agent-office/db';
import {
  approvalDecisionDetails,
  approvalDeskSchema,
  requestDetailSchema,
  requestListSchema,
  type ApprovalDesk,
  type RequestDetail,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SoftwareAuthenticator } from '../../api/test/authenticator.ts';
import { accounts } from '../../api/test/fixtures.ts';
import {
  PANEL_ORIGIN,
  closeAdminPool,
  createTestServer,
  sessionOf,
  type TestServer,
} from '../../api/test/helpers.ts';
import { errorCode, freshPasskey, send, signStepUp } from '../../api/test/passkey-helpers.ts';
import { runAgentJob, type RunOutcome } from '../src/runner/run.ts';
import { handleAgentRunJob } from '../src/worker.ts';
import {
  RESULT,
  ROUTE_TO_SOS,
  admin,
  closeTestPools,
  ids,
  models,
  noDatabase,
  testPools,
} from './helpers.ts';
import { ScriptedModel, text, toolUse } from './scripted-model.ts';

// Flow (A) end to end, as 7 October decision 8 asks for it: a person sends a request through the
// API, the job travels through the real queue, the runner runs the repository's own cards with a
// scripted model, the approver decides with a passkey, the requester answers, and the request is
// done. Nothing here sets a status: every status in the assertions was written by the database.
//
// The cards are active (8 October decision 1): the agents work for everybody's requests. The
// request of the first test is an employee's, so the unit's approver (the founder: nobody is
// appointed for the unit) and the requester are two people, and the result goes back to somebody
// who did not approve it.

const database = inject('database');

describe.skipIf(noDatabase)('a request from the first line to "done"', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  const errors: unknown[] = [];
  const apiQueue = createQueue(database?.app ?? '', (error) => errors.push(error), 'sender');
  const workerQueue = createQueue(database?.worker ?? '', (error) => errors.push(error));

  beforeAll(async () => {
    await apiQueue.start();
    await workerQueue.start();
    await ensureAgentRunQueues(workerQueue);
    server = createTestServer({ jobs: agentRunSender(apiQueue) });
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
  });

  afterAll(async () => {
    await apiQueue.stop({ graceful: false });
    await workerQueue.stop({ graceful: false });
    await server.close();
    await closeAdminPool();
    await closeTestPools();
  });

  const get = (session: string, url: string) =>
    send(server, session, 'GET', url, { company: ids.arma });
  const post = (session: string, url: string, payload: object = {}) =>
    send(server, session, 'POST', url, { company: ids.arma, payload });

  async function detail(session: string, id: string): Promise<RequestDetail> {
    return requestDetailSchema.parse((await get(session, `/api/requests/${id}`)).json());
  }

  async function desk(session: string): Promise<ApprovalDesk> {
    return approvalDeskSchema.parse((await get(session, '/api/approvals')).json());
  }

  /** Does this request wait on the person's approval desk, and as which of the two approvals. */
  async function waitingFor(
    session: string,
    id: string,
  ): Promise<{ approval: boolean; acceptance: boolean }> {
    const { approvals, acceptances } = await desk(session);
    return {
      approval: approvals.some((card) => card.requestId === id),
      acceptance: acceptances.some((card) => card.requestId === id),
    };
  }

  /** The journey as "kind:status", in the order the page shows it. */
  const journeyOf = (read: RequestDetail): string[] =>
    read.journey.map((item) => `${item.kind}:${'status' in item ? item.status : ''}`);

  /** The worker's part: takes the next job from the queue and runs it with the scripted model. */
  async function work(model: ScriptedModel): Promise<{ outcome: RunOutcome; agent: string }> {
    const [next] = await workerQueue.fetch(AGENT_RUN_QUEUE);
    if (!next) throw new Error('No job on the queue');
    const result = await runAgentJob(
      {
        pool: testPools().worker,
        callModel: model.call,
        models: await models(),
        jobs: agentRunSender(workerQueue),
        log: () => undefined,
      },
      next.data,
    );
    await workerQueue.complete(AGENT_RUN_QUEUE, next.id);
    const data = next.data as { agentCode?: string };
    return { outcome: result.outcome, agent: data.agentCode ?? '' };
  }

  /** The founder approves with the passkey, for exactly this option. */
  async function approve(approvalId: string, option: string): Promise<RequestDetail> {
    const res = await post(founder, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: option,
      stepUp: await signStepUp(server, founder, founderKey, {
        purpose: 'approve',
        companyId: ids.arma,
        subjectId: approvalId,
        details: approvalDecisionDetails(option),
      }),
    });
    expect(res.statusCode).toBe(200);
    return requestDetailSchema.parse(res.json());
  }

  it('request, routing, one unit agent, the approver’s approval, the requester’s approval, the result', async () => {
    // An employee asks; the founder approves; the result goes back to the employee.
    const id = randomUUID();
    const text = 'LinkedIn için gönderi yaz\nKaynak: İzmir ofisimiz 1 Ekim’de açıldı.';
    const created = await post(employee, '/api/requests', { id, text });
    expect(created.statusCode).toBe(201);
    expect(requestDetailSchema.parse(created.json())).toMatchObject({
      status: 'open',
      stage: 'routing',
      turn: { kind: 'agent', code: 'KOR-1' },
      requester: { userId: ids.employee },
      waitingForMe: false,
    });

    // The coordinator routes; the unit agent's job is put on the queue by that very transaction.
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    expect(await detail(employee, id)).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      unit: { code: 'SOS', name: 'Sosyal Medya' },
    });

    // The unit agent writes and submits, and states that its text mentions money. The result
    // waits for the founder (nobody is appointed for the unit), and only the founder reads it.
    const first = new ScriptedModel([
      toolUse('submit_for_approval', { ...RESULT, involves_money: true }),
    ]);
    expect(await work(first)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    const waiting = await detail(founder, id);
    expect(waiting).toMatchObject({
      status: 'awaiting_approval',
      stage: 'unit_approval',
      turn: { kind: 'founder' },
      waitingForMe: true,
      approval: {
        attempt: 1,
        requester: { userId: ids.employee },
        agent: { code: 'SOS-2' },
        options: [{ code: 'A' }, { code: 'B' }],
        goesExternal: true,
        involvesMoney: true,
        moneyStatedBy: 'agent',
        needsStepUp: true,
      },
      result: null,
      acceptance: null,
      actions: { cancel: false, stop: true, reroute: true },
    });
    expect(await waitingFor(founder, id)).toEqual({ approval: true, acceptance: false });
    const approvalId = waiting.approval?.id ?? '';

    // The requester sees where the request is and nothing of the work: no approval card, no
    // result, not their turn, and not a word the agent wrote.
    const unread = await detail(employee, id);
    expect(unread).toMatchObject({
      status: 'awaiting_approval',
      stage: 'unit_approval',
      turn: { kind: 'founder' },
      waitingForMe: false,
      approval: null,
      result: null,
      acceptance: null,
      actions: { cancel: true, stop: false, reroute: false },
    });
    expect(unread.journey.map((item) => item.kind)).toEqual(['run', 'routing', 'run']);
    const unreadText = JSON.stringify(unread);
    for (const written of [
      RESULT.title,
      RESULT.summary,
      RESULT.rationale,
      ...RESULT.options.map((option) => option.text),
      ROUTE_TO_SOS.reason,
    ]) {
      expect(unreadText).not.toContain(written);
    }
    expect(await waitingFor(employee, id)).toEqual({ approval: false, acceptance: false });
    // The requester cannot decide the result, with or without its id.
    const byRequester = await post(employee, `/api/approvals/${approvalId}/decision`, {
      decision: 'approved',
      selectedOption: 'B',
    });
    expect([byRequester.statusCode, errorCode(byRequester)]).toEqual([404, 'not_found']);
    // And nothing waits for the requester's answer yet.
    const early = await post(employee, `/api/requests/${id}/acceptance`, { decision: 'approved' });
    expect([early.statusCode, errorCode(early)]).toEqual([409, 'approval_closed']);

    // The approver approves option B with the passkey; the result is released to the requester.
    const approved = await approve(approvalId, 'B');
    expect(approved).toMatchObject({
      status: 'awaiting_approval',
      stage: 'requester_approval',
      turn: { kind: 'person', userId: ids.employee },
      // The founder approved; the answer to the result is not the founder's to give.
      waitingForMe: false,
      approval: null,
      acceptance: null,
      result: {
        option: { code: 'B', text: 'Artık İzmir’deyiz.' },
        approvedBy: { userId: ids.founder },
      },
    });
    expect(await waitingFor(founder, id)).toEqual({ approval: false, acceptance: false });
    const released = await detail(employee, id);
    expect(released).toMatchObject({
      status: 'awaiting_approval',
      stage: 'requester_approval',
      turn: { kind: 'person', userId: ids.employee },
      waitingForMe: true,
      approval: null,
      acceptance: { round: 1 },
      result: {
        option: { code: 'B', text: 'Artık İzmir’deyiz.' },
        approvedBy: { userId: ids.founder },
      },
    });
    expect(await waitingFor(employee, id)).toEqual({ approval: false, acceptance: true });
    expect((await desk(employee)).acceptances.find((card) => card.requestId === id)).toMatchObject({
      round: 1,
      result: { option: { code: 'B' }, agent: { code: 'SOS-2' } },
    });

    // The founder cannot give the requester's approval in the employee's place, either way.
    for (const answer of [
      { decision: 'approved' },
      { decision: 'changes_requested', note: 'Kurucunun notu.' },
    ]) {
      const inPlace = await post(founder, `/api/requests/${id}/acceptance`, answer);
      expect([inPlace.statusCode, errorCode(inPlace)]).toEqual([409, 'approval_closed']);
    }
    expect(await detail(employee, id)).toMatchObject({
      stage: 'requester_approval',
      acceptance: { round: 1 },
    });

    // The requester says it is not what they asked for: back to the same agent with their words.
    const back = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      note: 'Açılış tarihi de yazsın.',
    });
    expect(requestDetailSchema.parse(back.json())).toMatchObject({
      status: 'in_progress',
      stage: 'revising',
      turn: { kind: 'agent', code: 'SOS-2' },
    });
    // The reworked result states no money. The step's earlier result did: the mark cannot be
    // taken back on this path either, so the runner carries it and the result is stored.
    const second = new ScriptedModel([
      toolUse('submit_for_approval', {
        ...RESULT,
        involves_money: false,
        options: [
          { code: 'A', text: 'İzmir ofisimiz 1 Ekim’de açıldı.', hashtags: ['#izmir'] },
          { code: 'B', text: '1 Ekim’den beri İzmir’deyiz.', hashtags: [] },
        ],
      }),
    ]);
    expect(await work(second)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    const revisionData = JSON.stringify(second.requests[0]?.messages[0]);
    expect(revisionData).toContain('askedBy\\":\\"requester');
    expect(revisionData).toContain('Açılış tarihi de yazsın.');

    const again = await detail(founder, id);
    expect(again).toMatchObject({
      stage: 'unit_approval',
      waitingForMe: true,
      approval: { involvesMoney: true, moneyStatedBy: 'agent', needsStepUp: true },
    });
    // A reworked result after the requester's answer is a new chain, not a second attempt.
    expect(again.approval?.attempt).toBe(1);
    // The new result is hidden again until it is approved: the requester still reads the first.
    const between = await detail(employee, id);
    expect(between).toMatchObject({
      stage: 'unit_approval',
      waitingForMe: false,
      approval: null,
      acceptance: null,
      result: { option: { code: 'B', text: 'Artık İzmir’deyiz.' } },
    });
    expect(JSON.stringify(between)).not.toContain('1 Ekim’den beri');
    await approve(again.approval?.id ?? '', 'A');
    const accepted = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    const done = requestDetailSchema.parse(accepted.json());
    expect(done).toMatchObject({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      requester: { userId: ids.employee },
      result: {
        option: { code: 'A', text: 'İzmir ofisimiz 1 Ekim’de açıldı.' },
        approvedBy: { userId: ids.founder },
      },
      actions: { cancel: false, stop: false, reroute: false },
    });
    const journey = [
      'run:completed',
      'routing:',
      'run:completed',
      'approval:approved',
      'acceptance:changes_requested',
      'run:completed',
      'approval:approved',
      'acceptance:approved',
    ];
    expect(journeyOf(done)).toEqual(journey);
    // The founder reads the same journey, and nothing is left for either of them to do.
    const closed = await detail(founder, id);
    expect(journeyOf(closed)).toEqual(journey);
    expect(closed).toMatchObject({
      status: 'done',
      waitingForMe: false,
      actions: { cancel: false, stop: false, reroute: false },
    });
    for (const session of [employee, founder]) {
      expect(await waitingFor(session, id)).toEqual({ approval: false, acceptance: false });
    }
    for (const session of [employee, founder]) {
      const list = requestListSchema.parse((await get(session, '/api/requests')).json());
      expect(list.requests.find((request) => request.id === id)).toMatchObject({
        stage: 'done',
        unit: { code: 'SOS' },
        requester: { userId: ids.employee },
      });
    }

    // Every status the request went through was written by the flow, in this order.
    const statuses = await admin<{ event: string }>(
      `select event from office.audit_log
       where record_type = 'task' and record_id = $1 and event like 'task_status_%' order by id`,
      [id],
    );
    expect(statuses.map((row) => row.event)).toEqual([
      'task_status_in_progress',
      'task_status_awaiting_approval',
      'task_status_in_progress',
      'task_status_awaiting_approval',
      'task_status_done',
    ]);
    // Three runs in the requester's name, each with its model, card version and cost (rule 5).
    const runs = await admin<{
      agent_code: string;
      model: string;
      status: string;
      priced: boolean;
      user_id: string;
    }>(
      `select agent_code, model, status, cost_usd > 0 as priced, user_id from office.runs
       where task_id = $1 order by started_at`,
      [id],
    );
    const run = { status: 'completed', priced: true, user_id: ids.employee };
    expect(runs).toEqual([
      { agent_code: 'KOR-1', model: 'claude-haiku-4-5-20251001', ...run },
      { agent_code: 'SOS-2', model: 'claude-sonnet-5-5', ...run },
      { agent_code: 'SOS-2', model: 'claude-sonnet-5-5', ...run },
    ]);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('a request for a unit with no open agent is returned to its requester and closed', async () => {
    // 8 October decision 2, with the founder's own example: an employee asks for the KVKK texts.
    // The coordinator names the right unit, which has no agent yet.
    const id = randomUUID();
    await post(employee, '/api/requests', { id, text: 'KVKK aydınlatma metni hazırlansın' });
    const toLegal = { unit_code: 'HUK', agent_code: '', reason: 'Hukuk ve uyum işi.' };
    expect(await work(new ScriptedModel([toolUse('route_task', toLegal)]))).toEqual({
      outcome: 'returned',
      agent: 'KOR-1',
    });
    // No unit agent's job: the queue is empty when the coordinator has finished.
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    // The requester reads that it was returned, why (the cause) and for which unit; nothing is
    // left to do with it, and the coordinator's own reason is not theirs to read.
    const returned = {
      status: 'cancelled',
      stage: 'cancelled',
      cause: 'returned_no_agent',
      delayed: false,
      turn: { kind: 'none' },
      waitingForMe: false,
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
      requester: { userId: ids.employee },
    };
    const mine = await detail(employee, id);
    expect(mine).toMatchObject({
      ...returned,
      agent: null,
      closure: null,
      approval: null,
      result: null,
      acceptance: null,
      actions: { cancel: false, stop: false, reroute: false },
    });
    expect(journeyOf(mine)).toEqual(['run:completed', 'routing:']);
    expect(mine.journey.find((item) => item.kind === 'run')).toMatchObject({
      agent: { code: 'KOR-1' },
      summary:
        'Talep Hukuk ve Uyum birimine yönlendirildi; birimde işi alabilecek açık ajan olmadığı için talep sahibine geri çevrildi.',
      agentText: null,
    });
    expect(mine.journey.find((item) => item.kind === 'routing')).toMatchObject({
      unit: { code: 'HUK' },
      agent: null,
      by: null,
      reason: null,
    });
    expect(JSON.stringify(mine)).not.toContain(toLegal.reason);

    // Nothing waits for the founder: not their turn, nothing on the approval desk, no act offered.
    // The founder alone reads the coordinator's reason.
    const forFounder = await detail(founder, id);
    expect(forFounder).toMatchObject({
      ...returned,
      approval: null,
      actions: { cancel: false, stop: false, reroute: false },
    });
    expect(forFounder.journey.find((item) => item.kind === 'routing')).toMatchObject({
      unit: { code: 'HUK' },
      agent: null,
      reason: toLegal.reason,
    });
    for (const session of [employee, founder]) {
      expect(await waitingFor(session, id)).toEqual({ approval: false, acceptance: false });
      const list = requestListSchema.parse((await get(session, '/api/requests')).json());
      expect(list.requests.find((request) => request.id === id)).toMatchObject(returned);
    }
    // Closed is closed: the founder cannot give it to an agent afterwards, the requester cannot
    // cancel it again. A new request is the way on.
    const late = await post(founder, `/api/requests/${id}/routing`, {
      unitCode: 'SOS',
      agentCode: 'SOS-2',
    });
    expect([late.statusCode, errorCode(late)]).toEqual([409, 'request_closed']);
    const cancel = await post(employee, `/api/requests/${id}/close`);
    expect([cancel.statusCode, errorCode(cancel)]).toEqual([409, 'request_closed']);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    // The records: one run of the coordinator, the status written by the flow, and the trace.
    expect(
      await admin(
        `select agent_code, status, user_id, output ->> 'outcome' as outcome from office.runs
         where task_id = $1`,
        [id],
      ),
    ).toEqual([
      { agent_code: 'KOR-1', status: 'completed', user_id: ids.employee, outcome: 'returned' },
    ]);
    const trace = await admin<{ event: string }>(
      `select event from office.audit_log
       where record_type = 'task' and record_id = $1
         and (event like 'task_status_%' or event like 'request_%') order by id`,
      [id],
    );
    expect(trace.map((row) => row.event)).toEqual([
      'request_created',
      'task_status_in_progress',
      'request_routed',
      'task_status_cancelled',
      'request_returned',
    ]);
    expect(
      await admin(
        `select status, closed_by_user_id, close_reason, unit_code, initial_unit_code,
           assignee_agent_code, routing_corrected from office.tasks where id = $1`,
        [id],
      ),
    ).toEqual([
      {
        status: 'cancelled',
        closed_by_user_id: null,
        close_reason: null,
        unit_code: 'HUK',
        initial_unit_code: 'HUK',
        assignee_agent_code: null,
        routing_corrected: false,
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('a request that falls to a person is not a dead end: the routing is corrected and the work goes on', async () => {
    // The unit agent's first run ends without submitting: it answers in text, is reminded once
    // and answers in text again. The request falls to the founder (nobody is appointed).
    const id = randomUUID();
    await post(founder, '/api/requests', { id, text: 'LinkedIn için gönderi yaz' });
    expect((await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).outcome).toBe(
      'routed',
    );
    const silent = new ScriptedModel([
      text('Kaynak bilgi yok.'),
      text('Kaynak bilgi olmadan gönderi yazamam.'),
    ]);
    expect(await work(silent)).toEqual({ outcome: 'no_submission', agent: 'SOS-2' });
    const fell = await detail(founder, id);
    expect(fell).toMatchObject({
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_submission',
      unit: { code: 'SOS' },
      waitingForMe: true,
      actions: { cancel: true, stop: false, reroute: true },
    });
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    // "Yönlendirmeyi düzelt": the founder gives it to the agent again, with a note. The agent's
    // job is on the real queue when the answer comes back.
    const corrected = await post(founder, `/api/requests/${id}/routing`, {
      unitCode: 'SOS',
      agentCode: 'SOS-2',
      note: 'Kaynak: İzmir ofisimiz 1 Ekim’de açıldı.',
    });
    expect(requestDetailSchema.parse(corrected.json())).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2' },
    });
    // The model first answers in text; the runner reminds it once and it submits.
    const model = new ScriptedModel([
      text('Metni hazırladım: ...'),
      toolUse('submit_for_approval', RESULT),
    ]);
    expect(await work(model)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    expect(JSON.stringify(model.requests[0]?.messages[0])).toContain('Kaynak: İzmir ofisimiz');
    const waiting = await detail(founder, id);
    expect(waiting).toMatchObject({ stage: 'unit_approval', unit: { code: 'SOS' } });
    expect(
      waiting.journey
        .filter((item) => item.kind === 'routing')
        .map((item) => [item.round, item.unit.code, item.agent?.code, item.by?.userId ?? null]),
    ).toEqual([
      [1, 'SOS', 'SOS-2', null],
      [2, 'SOS', 'SOS-2', ids.founder],
    ]);

    // The founder is the requester here, so the close is a cancel; a result that waited is closed.
    const closed = await post(founder, `/api/requests/${id}/close`, { reason: 'Deneme bitti.' });
    expect(requestDetailSchema.parse(closed.json())).toMatchObject({
      status: 'cancelled',
      cause: 'cancelled_by_requester',
      closure: { by: { userId: ids.founder }, note: 'Deneme bitti.' },
      approval: null,
    });
    const [task] = await admin<{ routing_corrected: boolean; initial_unit_code: string }>(
      'select routing_corrected, initial_unit_code from office.tasks where id = $1',
      [id],
    );
    expect(task).toEqual({ routing_corrected: true, initial_unit_code: 'SOS' });
    expect(errors).toEqual([]);
  });

  it('a job that crashes leaves a code in the queue’s tables, never a part of the work', async () => {
    const id = randomUUID();
    await post(founder, '/api/requests', { id, text: 'LinkedIn için gönderi yaz' });
    const [next] = await workerQueue.fetch(AGENT_RUN_QUEUE);
    if (!next) throw new Error('No job on the queue');
    const secret = 'ONAYSIZ-SONUC müşteri ACME fiyat 12.500 TL';
    const log: unknown[] = [];
    // An error nobody foresaw, carrying text of the work the way a database error quotes the
    // value it refused.
    const crashed = await handleAgentRunJob(
      {
        pool: testPools().worker,
        callModel: () => Promise.reject(Object.assign(new Error(secret), { where: secret })),
        models: await models(),
        jobs: agentRunSender(workerQueue),
        log: (event, fields) => log.push({ event, fields }),
      },
      next.data,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(crashed).toBeInstanceOf(Error);
    expect(crashed).toMatchObject({ message: 'runner_error' });
    expect(JSON.stringify(Object.entries(crashed as object))).not.toContain('ACME');
    expect((crashed as Error).cause).toBeUndefined();
    expect(JSON.stringify(log)).not.toContain('ACME');
    // What the queue stores of it, here and in the dead letter queue (its tables have no row
    // policies and are shared by both companies: rule 10).
    await workerQueue.fail(AGENT_RUN_QUEUE, next.id, crashed as Error);
    const stored = await admin<{ kept: string }>(
      `select coalesce(output::text, '') || ' ' || coalesce(data::text, '') as kept
       from pgboss.job where data ->> 'taskId' = $1`,
      [id],
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.map((row) => row.kept).join(' ')).toContain('runner_error');
    expect(stored.map((row) => row.kept).join(' ')).not.toMatch(/ACME|ONAYSIZ|12\.500/);
    // The run it left open is closed, and the request says so instead of looking busy.
    const [run] = await admin<{ status: string; error_code: string }>(
      'select status, error_code from office.runs where task_id = $1',
      [id],
    );
    expect(run).toEqual({ status: 'failed', error_code: 'runner_error' });
    expect(await detail(founder, id)).toMatchObject({
      stage: 'fell_to_person',
      cause: 'run_failed',
    });
    // Clean up the dead letter copy so that the next test finds an empty queue.
    for (const dead of await workerQueue.fetch(AGENT_RUN_DEAD_QUEUE)) {
      await workerQueue.complete(AGENT_RUN_DEAD_QUEUE, dead.id);
    }
    await post(founder, `/api/requests/${id}/close`);
  });
});
