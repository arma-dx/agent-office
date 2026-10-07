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
import { freshPasskey, send, signStepUp } from '../../api/test/passkey-helpers.ts';
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
// The cards are on trial, so the request is the founder's; the founder is then both the unit's
// approver and the requester, which is the common case of the pilot.

const database = inject('database');

describe.skipIf(noDatabase)('a request from the first line to "done"', () => {
  let server: TestServer;
  let founder: string;
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
    await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
  });

  afterAll(async () => {
    await apiQueue.stop({ graceful: false });
    await workerQueue.stop({ graceful: false });
    await server.close();
    await closeAdminPool();
    await closeTestPools();
  });

  const get = (url: string) => send(server, founder, 'GET', url, { company: ids.arma });
  const post = (url: string, payload: object = {}) =>
    send(server, founder, 'POST', url, { company: ids.arma, payload });

  async function detail(id: string): Promise<RequestDetail> {
    return requestDetailSchema.parse((await get(`/api/requests/${id}`)).json());
  }

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

  async function approve(approvalId: string, option: string): Promise<RequestDetail> {
    const res = await post(`/api/approvals/${approvalId}/decision`, {
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
    const id = randomUUID();
    const text = 'LinkedIn için gönderi yaz\nKaynak: İzmir ofisimiz 1 Ekim’de açıldı.';
    const created = await post('/api/requests', { id, text });
    expect(created.statusCode).toBe(201);
    expect(requestDetailSchema.parse(created.json())).toMatchObject({
      status: 'open',
      stage: 'routing',
      turn: { kind: 'agent', code: 'KOR-1' },
    });

    // The coordinator routes; the unit agent's job is put on the queue by that very transaction.
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    expect(await detail(id)).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      unit: { code: 'SOS', name: 'Sosyal Medya' },
    });

    // The unit agent writes and submits.
    const first = new ScriptedModel([toolUse('submit_for_approval', RESULT)]);
    expect(await work(first)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    const waiting = await detail(id);
    expect(waiting).toMatchObject({
      status: 'awaiting_approval',
      stage: 'unit_approval',
      turn: { kind: 'founder' },
      waitingForMe: true,
      approval: {
        attempt: 1,
        agent: { code: 'SOS-2' },
        options: [{ code: 'A' }, { code: 'B' }],
        goesExternal: true,
        needsStepUp: true,
      },
      result: null,
      acceptance: null,
    });
    const desk = approvalDeskSchema.parse((await get('/api/approvals')).json());
    expect(desk.approvals.map((card) => card.requestId)).toContain(id);

    // The approver approves option B with the passkey; the result is released to the requester.
    const approved = await approve(waiting.approval?.id ?? '', 'B');
    expect(approved).toMatchObject({
      status: 'awaiting_approval',
      stage: 'requester_approval',
      turn: { kind: 'person', userId: ids.founder },
      waitingForMe: true,
      approval: null,
      acceptance: { round: 1 },
      result: {
        option: { code: 'B', text: 'Artık İzmir’deyiz.' },
        approvedBy: { userId: ids.founder },
      },
    });

    // The requester says it is not what they asked for: back to the same agent with their words.
    const back = await post(`/api/requests/${id}/acceptance`, {
      decision: 'changes_requested',
      note: 'Açılış tarihi de yazsın.',
    });
    expect(requestDetailSchema.parse(back.json())).toMatchObject({
      status: 'in_progress',
      stage: 'revising',
      turn: { kind: 'agent', code: 'SOS-2' },
    });
    const second = new ScriptedModel([
      toolUse('submit_for_approval', {
        ...RESULT,
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

    const again = await detail(id);
    expect(again.stage).toBe('unit_approval');
    // A reworked result after the requester's answer is a new chain, not a second attempt.
    expect(again.approval?.attempt).toBe(1);
    await approve(again.approval?.id ?? '', 'A');
    const accepted = await post(`/api/requests/${id}/acceptance`, { decision: 'approved' });
    const done = requestDetailSchema.parse(accepted.json());
    expect(done).toMatchObject({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      result: { option: { code: 'A', text: 'İzmir ofisimiz 1 Ekim’de açıldı.' } },
      actions: { cancel: false, stop: false, reroute: false },
    });
    expect(
      done.journey.map((item) => `${item.kind}:${'status' in item ? item.status : ''}`),
    ).toEqual([
      'run:completed',
      'routing:',
      'run:completed',
      'approval:approved',
      'acceptance:changes_requested',
      'run:completed',
      'approval:approved',
      'acceptance:approved',
    ]);
    const list = requestListSchema.parse((await get('/api/requests')).json());
    expect(list.requests.find((request) => request.id === id)).toMatchObject({
      stage: 'done',
      unit: { code: 'SOS' },
    });

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
    // Three runs, each with its model, card version and cost (rule 5).
    const runs = await admin<{
      agent_code: string;
      model: string;
      status: string;
      priced: boolean;
    }>(
      `select agent_code, model, status, cost_usd > 0 as priced from office.runs
       where task_id = $1 order by started_at`,
      [id],
    );
    expect(runs).toEqual([
      {
        agent_code: 'KOR-1',
        model: 'claude-haiku-4-5-20251001',
        status: 'completed',
        priced: true,
      },
      { agent_code: 'SOS-2', model: 'claude-sonnet-5-5', status: 'completed', priced: true },
      { agent_code: 'SOS-2', model: 'claude-sonnet-5-5', status: 'completed', priced: true },
    ]);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('a request that falls to a person is not a dead end: the routing is corrected and the work goes on', async () => {
    // The founder's own example: a KVKK text. The coordinator names the right unit, which has no
    // agent yet.
    const id = randomUUID();
    await post('/api/requests', { id, text: 'KVKK aydınlatma metni hazırlansın' });
    const toLegal = { unit_code: 'HUK', agent_code: '', reason: 'Hukuk ve uyum işi.' };
    expect((await work(new ScriptedModel([toolUse('route_task', toLegal)]))).outcome).toBe(
      'routed',
    );
    const fell = await detail(id);
    expect(fell).toMatchObject({
      status: 'open',
      stage: 'fell_to_person',
      cause: 'no_agent',
      unit: { code: 'HUK' },
      waitingForMe: true,
      actions: { cancel: true, stop: false, reroute: true },
    });
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    // "Yönlendirmeyi düzelt": the founder gives it to the one agent that is open. The agent's job
    // is on the real queue when the answer comes back.
    const corrected = await post(`/api/requests/${id}/routing`, {
      unitCode: 'SOS',
      agentCode: 'SOS-2',
      note: 'Şimdilik sosyal içerik ajanı bir taslak yazsın.',
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
    expect(JSON.stringify(model.requests[0]?.messages[0])).toContain('Şimdilik sosyal içerik');
    const waiting = await detail(id);
    expect(waiting).toMatchObject({ stage: 'unit_approval', unit: { code: 'SOS' } });
    expect(
      waiting.journey.filter((item) => item.kind === 'routing').map((item) => item.unit.code),
    ).toEqual(['HUK', 'SOS']);

    // The founder is the requester here, so the close is a cancel; a result that waited is closed.
    const closed = await post(`/api/requests/${id}/close`, { reason: 'Deneme bitti.' });
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
    expect(task).toEqual({ routing_corrected: true, initial_unit_code: 'HUK' });
    expect(errors).toEqual([]);
  });

  it('a job that crashes leaves a code in the queue’s tables, never a part of the work', async () => {
    const id = randomUUID();
    await post('/api/requests', { id, text: 'LinkedIn için gönderi yaz' });
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
    expect(await detail(id)).toMatchObject({ stage: 'fell_to_person', cause: 'run_failed' });
    // Clean up the dead letter copy so that the next test finds an empty queue.
    for (const dead of await workerQueue.fetch(AGENT_RUN_DEAD_QUEUE)) {
      await workerQueue.complete(AGENT_RUN_DEAD_QUEUE, dead.id);
    }
    await post(`/api/requests/${id}/close`);
  });
});
