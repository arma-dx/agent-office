import { randomUUID } from 'node:crypto';
import {
  AGENT_RUN_DEAD_QUEUE,
  AGENT_RUN_QUEUE,
  agentRunSender,
  createQueue,
  ensureAgentRunQueues,
} from '@agent-office/db';
import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  UPLOAD_TICKET_HEADER,
  agentOpenResponseSchema,
  approvalDecisionDetails,
  approvalDeskSchema,
  projectAiPermissionAnswerSchema,
  projectAiPermissionDetails,
  projectAiSpendingLimitAnswerSchema,
  projectAiSpendingLimitDetails,
  projectFileSchema,
  requestDetailSchema,
  requestListSchema,
  todaySchema,
  uploadTicketSchema,
  type ApprovalDesk,
  type RequestDetail,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SoftwareAuthenticator } from '../../api/test/authenticator.ts';
import { accounts } from '../../api/test/fixtures.ts';
import {
  PANEL_ORIGIN,
  SAME_ORIGIN,
  SESSION_COOKIE,
  closeAdminPool,
  createTestServer,
  sessionOf,
  type TestServer,
} from '../../api/test/helpers.ts';
import { errorCode, freshPasskey, send, signStepUp } from '../../api/test/passkey-helpers.ts';
import { RunProjectFiles } from '../src/files/project-files.ts';
import { MemoryFileReader } from '../src/files/reader.ts';
import { runAgentJob, type RunOutcome, type RunnerDeps } from '../src/runner/run.ts';
import { consumeAgentRuns, handleAgentRunJob } from '../src/worker.ts';
import {
  RESULT,
  ROUTE_TO_SOS,
  admin,
  closeTestPools,
  ids,
  noDatabase,
  testPools,
} from './helpers.ts';
import { ScriptedModel, apiError, text, toolUse } from './scripted-model.ts';

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

  /**
   * The worker's part: takes the next job from the queue and runs it with the scripted model
   * (and, where a case gives them, with a file reader and a token counter).
   */
  async function work(
    model: ScriptedModel,
    reading: Pick<RunnerDeps, 'files' | 'countFileTokens'> = {},
  ): Promise<{ outcome: RunOutcome; agent: string }> {
    const [next] = await workerQueue.fetch(AGENT_RUN_QUEUE);
    if (!next) throw new Error('No job on the queue');
    const result = await runAgentJob(
      {
        pool: testPools().worker,
        callModel: model.call,
        jobs: agentRunSender(workerQueue),
        log: () => undefined,
        ...reading,
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

    // The job's expiry follows the card of its agent: the run's time limit plus five minutes.
    const expiryOf = async (agentCode: string): Promise<number | undefined> => {
      const [row] = await admin<{ expire_seconds: number }>(
        `select expire_seconds from pgboss.job
         where name = $1 and data ->> 'taskId' = $2 and data ->> 'agentCode' = $3`,
        [AGENT_RUN_QUEUE, id, agentCode],
      );
      return row?.expire_seconds;
    };
    // KOR-1's card: two minutes.
    expect(await expiryOf('KOR-1')).toBe(2 * 60 + 5 * 60);

    // The coordinator routes; the unit agent's job is put on the queue by that very transaction.
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    // SOS-2's card: five minutes. Sent by the runner, through the same sender.
    expect(await expiryOf('SOS-2')).toBe(5 * 60 + 5 * 60);
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

  it('the founder’s own request: the same person gives two separate approvals', async () => {
    // 8 October decision 4. In the pilot the founder approves every unit, so the founder's own
    // request is exactly this case: approving the unit's result does not end the request, the
    // result then waits for the same person as its requester.
    const id = randomUUID();
    const created = await post(founder, '/api/requests', { id, text: 'LinkedIn için gönderi yaz' });
    expect(created.statusCode).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    expect(await work(new ScriptedModel([toolUse('submit_for_approval', RESULT)]))).toEqual({
      outcome: 'submitted',
      agent: 'SOS-2',
    });

    // First the approver's approval: on the desk as an approval, not as an acceptance.
    const waiting = await detail(founder, id);
    expect(waiting).toMatchObject({
      status: 'awaiting_approval',
      stage: 'unit_approval',
      turn: { kind: 'founder' },
      waitingForMe: true,
      requester: { userId: ids.founder },
      approval: { attempt: 1, requester: { userId: ids.founder }, needsStepUp: true },
      acceptance: null,
      result: null,
    });
    expect(await waitingFor(founder, id)).toEqual({ approval: true, acceptance: false });
    // The requester's answer cannot be given before the approver's, also by the same person.
    const early = await post(founder, `/api/requests/${id}/acceptance`, { decision: 'approved' });
    expect([early.statusCode, errorCode(early)]).toEqual([409, 'approval_closed']);

    // Approved with the passkey: the request is not done. It waits for its requester, who is
    // the same person, with the acceptance card and on the desk as an acceptance.
    const approved = await approve(waiting.approval?.id ?? '', 'A');
    expect(approved).toMatchObject({
      status: 'awaiting_approval',
      stage: 'requester_approval',
      turn: { kind: 'person', userId: ids.founder },
      waitingForMe: true,
      approval: null,
      acceptance: { round: 1 },
      result: {
        option: { code: 'A', text: 'İzmir ofisimiz açıldı.' },
        approvedBy: { userId: ids.founder },
      },
    });
    expect(await waitingFor(founder, id)).toEqual({ approval: false, acceptance: true });
    expect((await desk(founder)).acceptances.find((card) => card.requestId === id)).toMatchObject({
      round: 1,
      result: { option: { code: 'A' }, agent: { code: 'SOS-2' } },
    });
    const [between] = await admin<{ status: string }>(
      'select status from office.tasks where id = $1',
      [id],
    );
    expect(between).toEqual({ status: 'awaiting_approval' });

    // The second approval, the requester's, ends it.
    const accepted = await post(founder, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    expect(accepted.statusCode).toBe(200);
    const done = requestDetailSchema.parse(accepted.json());
    expect(done).toMatchObject({
      status: 'done',
      stage: 'done',
      turn: { kind: 'none' },
      waitingForMe: false,
      result: { option: { code: 'A' }, approvedBy: { userId: ids.founder } },
    });
    expect(journeyOf(done)).toEqual([
      'run:completed',
      'routing:',
      'run:completed',
      'approval:approved',
      'acceptance:approved',
    ]);
    expect(await waitingFor(founder, id)).toEqual({ approval: false, acceptance: false });
    // Two decisions of one person, each its own record.
    expect(
      await admin(
        `select 'approval' as kind, status, decided_by_user_id as by from office.approvals
         where task_id = $1
         union all
         select 'acceptance', status, requester_user_id from office.requester_approvals
         where task_id = $1
         order by kind desc`,
        [id],
      ),
    ).toEqual([
      { kind: 'approval', status: 'approved', by: ids.founder },
      { kind: 'acceptance', status: 'approved', by: ids.founder },
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

  it('a request that fits no unit falls to the founder, who alone reads why the coordinator routed nothing', async () => {
    // The coordinator answers through its tool also when no unit fits: an empty unit. Nothing
    // changes for the people: the request falls to the founder as "yönlendirilemedi".
    const id = randomUUID();
    await post(employee, '/api/requests', { id, text: 'Bir şey lazım' });
    const noUnit = {
      unit_code: '',
      agent_code: '',
      reason: 'Ne istendiği anlaşılmıyor; Sosyal Medya ile Pazarlama arasında kaldı.',
    };
    expect(await work(new ScriptedModel([toolUse('route_task', noUnit)]))).toEqual({
      outcome: 'no_routing',
      agent: 'KOR-1',
    });
    // Nothing was routed: no job waits for a unit agent.
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    const fell = {
      status: 'in_progress',
      stage: 'fell_to_person',
      cause: 'no_routing',
      delayed: false,
      turn: { kind: 'founder' },
      unit: null,
      agent: null,
      requester: { userId: ids.employee },
    };
    const summary = 'Koordinasyon merkezi talebi yönlendirmeden çalışmasını bitirdi.';
    // The founder decides: the reason the coordinator gave through its tool is theirs to read,
    // where the closing words of a run that ended without its tool are read.
    const forFounder = await detail(founder, id);
    expect(forFounder).toMatchObject({
      ...fell,
      waitingForMe: true,
      actions: { cancel: false, stop: true, reroute: true },
    });
    expect(journeyOf(forFounder)).toEqual(['run:completed']);
    expect(forFounder.journey[0]).toMatchObject({
      agent: { code: 'KOR-1' },
      summary,
      agentText: noUnit.reason,
      steps: [{ tool: 'route_task', status: 'succeeded' }],
    });
    // The requester reads that it waits for a person and the sentence made by code; the
    // coordinator's reason is nobody's to read who may not decide.
    const mine = await detail(employee, id);
    expect(mine).toMatchObject({
      ...fell,
      waitingForMe: false,
      actions: { cancel: true, stop: false, reroute: false },
    });
    expect(mine.journey[0]).toMatchObject({ summary, agentText: null });
    expect(JSON.stringify(mine)).not.toContain(noUnit.reason);

    // Not a dead end: the founder gives it to a unit and an agent, and the work starts.
    const corrected = await post(founder, `/api/requests/${id}/routing`, {
      unitCode: 'SOS',
      agentCode: 'SOS-2',
    });
    expect(requestDetailSchema.parse(corrected.json())).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2' },
    });
    expect(await work(new ScriptedModel([toolUse('submit_for_approval', RESULT)]))).toEqual({
      outcome: 'submitted',
      agent: 'SOS-2',
    });
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
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

  it('a run is called late by its own time limit, as it was stored with the run', async () => {
    const id = randomUUID();
    await post(founder, '/api/requests', { id, text: 'LinkedIn için gönderi yaz' });
    expect((await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).outcome).toBe(
      'routed',
    );
    /** Moves the request's runs and its routing this many minutes into the past, in step. */
    const earlier = async (minutes: number): Promise<void> => {
      const client = await testPools().admin.connect();
      try {
        await client.query('begin');
        await client.query(`set local session_replication_role = 'replica'`);
        await client.query(
          `update office.task_routings set created_at = created_at - make_interval(mins => $2)
           where task_id = $1`,
          [id, minutes],
        );
        await client.query(
          `update office.runs set started_at = started_at - make_interval(mins => $2)
           where task_id = $1`,
          [id, minutes],
        );
        await client.query('commit');
      } finally {
        client.release();
      }
    };
    const seen: { stage: string; delayed: boolean }[] = [];
    const look = async (): Promise<void> => {
      const { stage, delayed } = await detail(founder, id);
      seen.push({ stage, delayed });
    };
    // While the unit agent's model call is open. Its card allows five minutes: after six the run
    // is not late yet; after eight it is, although a fixed twelve minutes have not passed.
    const model = new ScriptedModel([
      async () => {
        await earlier(6);
        await look();
        await earlier(2);
        await look();
        return toolUse('submit_for_approval', RESULT);
      },
    ]);
    expect(await work(model)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    expect(seen).toEqual([
      { stage: 'working', delayed: false },
      { stage: 'working', delayed: true },
    ]);
    await post(founder, `/api/requests/${id}/close`);
  });

  it('a worker that is stopped in the middle of a run does not leave the request busy for ever', async () => {
    const id = randomUUID();
    await post(founder, '/api/requests', { id, text: 'LinkedIn için gönderi yaz' });
    const jobsOf = (queue: string) =>
      admin<{ state: string; later: boolean }>(
        `select state, start_after > now() + interval '4 minutes' as later from pgboss.job
         where name = $2 and data ->> 'taskId' = $1 order by created_on, start_after`,
        [id, queue],
      );
    const unitRun = () =>
      admin<{ id: string; status: string; error_code: string | null }>(
        `select id, status, error_code from office.runs
         where task_id = $1 and agent_code = 'SOS-2'`,
        [id],
      );
    // A worker process as startWorker wires it: the real queue and the worker's two handlers. The
    // coordinator routes; the unit agent's model call is open when the process is stopped.
    let release = (): void => undefined;
    const model = new ScriptedModel([
      toolUse('route_task', ROUTE_TO_SOS),
      () =>
        new Promise((_, reject) => {
          release = () => {
            reject(apiError('aborted'));
          };
        }),
    ]);
    const log: string[] = [];
    const depsOf = (
      queue: ReturnType<typeof createQueue>,
      callModel: RunnerDeps['callModel'],
    ): RunnerDeps => ({
      pool: testPools().worker,
      callModel,
      jobs: agentRunSender(queue),
      log: (event) => log.push(event),
    });
    const first = createQueue(database?.worker ?? '', () => undefined);
    await first.start();
    await consumeAgentRuns(first, depsOf(first, model.call), 1);
    await expect.poll(() => model.requests.length, { timeout: 10_000, interval: 100 }).toBe(2);
    expect(await detail(founder, id)).toMatchObject({
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2' },
    });
    // SIGTERM: the queue waits (here one second instead of thirty), fails the job that is still
    // running and copies it to the dead letter queue. The run stays open; the process is gone.
    await first.stop({ graceful: true, timeout: 1000 });
    expect(await jobsOf(AGENT_RUN_QUEUE)).toEqual([
      { state: 'completed', later: false },
      { state: 'failed', later: false },
    ]);
    expect(await unitRun()).toMatchObject([{ status: 'running' }]);

    // The next worker. Its dead letter handler finds the run inside its own time limit (five
    // minutes on the card): a job that is alive could own it, so it is not closed. The question is
    // not dropped: a reminder waits on the dead letter queue until the limit will have passed.
    const errors2: unknown[] = [];
    const second = createQueue(database?.worker ?? '', (error) => errors2.push(error));
    await second.start();
    try {
      await consumeAgentRuns(second, depsOf(second, null), 1);
      await expect
        .poll(() => jobsOf(AGENT_RUN_DEAD_QUEUE), { timeout: 10_000, interval: 200 })
        .toEqual([
          { state: 'completed', later: false },
          { state: 'created', later: true },
        ]);
      expect(log).toContain('run_watched');
      expect(await unitRun()).toMatchObject([{ status: 'running' }]);
      // The limit passes: the request's runs and its routing are moved seven minutes into the
      // past, in step, and the reminder is due now; nothing else is touched.
      const client = await testPools().admin.connect();
      try {
        await client.query('begin');
        await client.query(`set local session_replication_role = 'replica'`);
        await client.query(
          `update office.task_routings set created_at = created_at - interval '7 minutes'
           where task_id = $1`,
          [id],
        );
        await client.query(
          `update office.runs set started_at = started_at - interval '7 minutes'
           where task_id = $1`,
          [id],
        );
        await client.query(
          `update pgboss.job set start_after = now()
           where name = $2 and data ->> 'taskId' = $1 and state = 'created'`,
          [id, AGENT_RUN_DEAD_QUEUE],
        );
        await client.query('commit');
      } finally {
        client.release();
      }
      await expect
        .poll(unitRun, { timeout: 10_000, interval: 200 })
        .toMatchObject([{ status: 'failed', error_code: 'worker_lost' }]);
      // The request says so and names the way on, instead of "ajan çalışıyor".
      expect(await detail(founder, id)).toMatchObject({
        stage: 'fell_to_person',
        cause: 'run_failed',
        waitingForMe: true,
        actions: { reroute: true },
      });
      // Nothing is left to look at: the reminder is done and leaves no other behind.
      await expect
        .poll(() => jobsOf(AGENT_RUN_DEAD_QUEUE), { timeout: 10_000, interval: 200 })
        .toEqual([
          { state: 'completed', later: false },
          { state: 'completed', later: false },
        ]);
    } finally {
      // The model call of the stopped process is let go, so that its runner ends.
      release();
      await expect.poll(() => log.includes('run_finished'), { timeout: 5000 }).toBe(true);
      await second.stop({ graceful: false });
    }
    expect(errors2).toEqual([]);
    await post(founder, `/api/requests/${id}/close`);
  }, 60_000);

  // Requests inside a project, and work that goes on by itself (8 October decisions 11, 17, 45 to
  // 49): the API, the real queue and the runner together.

  const put = (session: string, url: string, payload: object) =>
    send(server, session, 'PUT', url, { company: ids.arma, payload });

  /** The founder opens a project with the employee as a member and opens its AI permission. */
  async function projectWithAgents(name: string): Promise<string> {
    const id = randomUUID();
    const created = await post(founder, '/api/projects', {
      id,
      name,
      memberIds: [ids.employee],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await openPermission(id)).restarted).toBe(0);
    return id;
  }

  /** The founder opens the project's AI permission with the passkey; the answer of the route. */
  async function openPermission(projectId: string) {
    const res = await put(founder, `/api/projects/${projectId}/ai-permission`, {
      allowed: true,
      customerId: null,
      stepUp: await signStepUp(server, founder, founderKey, {
        purpose: 'project_ai_permission',
        companyId: ids.arma,
        subjectId: projectId,
        details: projectAiPermissionDetails(null),
      }),
    });
    expect(res.statusCode, res.body).toBe(200);
    return projectAiPermissionAnswerSchema.parse(res.json());
  }

  /** The founder's switch of SOS-2; an opening answers how many waiting requests it started. */
  async function switchUnitAgent(status: 'enabled' | 'stopped'): Promise<number> {
    const res = await put(founder, '/api/agents/SOS-2/switch', { status });
    expect(res.statusCode, res.body).toBe(200);
    return status === 'enabled' ? agentOpenResponseSchema.parse(res.json()).restarted : 0;
  }

  /**
   * Earlier cases left requests that wait for SOS-2. One stop and one opening start them once;
   * their jobs are taken off the queue unrun, so that a case meets only its own.
   */
  async function settle(): Promise<void> {
    await switchUnitAgent('stopped');
    await switchUnitAgent('enabled');
    for (;;) {
      const [next] = await workerQueue.fetch(AGENT_RUN_QUEUE);
      if (!next) break;
      await workerQueue.complete(AGENT_RUN_QUEUE, next.id);
    }
  }

  const runsOf = (id: string) =>
    admin<{
      agent_code: string;
      status: string;
      error_code: string | null;
      user_id: string;
      project_id: string | null;
    }>(
      `select agent_code, status, error_code, user_id, project_id from office.runs
       where task_id = $1 order by started_at, id`,
      [id],
    );

  /** The request's project fact, as the model was given it. */
  const dataOf = (model: ScriptedModel): string => JSON.stringify(model.requests[0]?.messages[0]);

  it('a request inside a project, from the form to the requester’s acceptance', async () => {
    const projectId = await projectWithAgents('Lansman projesi');
    const stranger = await sessionOf(server, accounts.holder);
    const id = randomUUID();
    /** An employee who is no member of the project: the request does not exist for them. */
    const hidden = async (): Promise<void> => {
      const res = await get(stranger, `/api/requests/${id}`);
      expect([res.statusCode, errorCode(res)]).toEqual([404, 'not_found']);
      const list = requestListSchema.parse((await get(stranger, '/api/requests')).json());
      expect(list.requests.map((request) => request.id)).not.toContain(id);
      const inProject = requestListSchema.parse(
        (await get(stranger, `/api/requests?project=${projectId}`)).json(),
      );
      expect(inProject.requests).toEqual([]);
      expect(await waitingFor(stranger, id)).toEqual({ approval: false, acceptance: false });
    };

    const created = await post(employee, '/api/requests', {
      id,
      text: 'Lansman için LinkedIn gönderisi yaz',
      projectId,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(requestDetailSchema.parse(created.json())).toMatchObject({
      stage: 'routing',
      project: { id: projectId, name: 'Lansman projesi' },
      agentsMayWork: true,
      requesterReads: true,
    });
    // The job on the queue names four ids and nothing of the project (rule 10).
    expect(
      await admin(`select data from pgboss.job where name = $1 and data ->> 'taskId' = $2`, [
        AGENT_RUN_QUEUE,
        id,
      ]),
    ).toEqual([
      { data: { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' } },
    ]);
    await hidden();

    // Both agents work inside the project; the model is told its name as a fact.
    const kor = new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]);
    expect(await work(kor)).toEqual({ outcome: 'routed', agent: 'KOR-1' });
    expect(dataOf(kor)).toContain('project\\":\\"Lansman projesi');
    await hidden();
    const sos = new ScriptedModel([toolUse('submit_for_approval', RESULT)]);
    expect(await work(sos)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    expect(dataOf(sos)).toContain('project\\":\\"Lansman projesi');
    expect(await runsOf(id)).toEqual([
      {
        agent_code: 'KOR-1',
        status: 'completed',
        error_code: null,
        user_id: ids.employee,
        project_id: projectId,
      },
      {
        agent_code: 'SOS-2',
        status: 'completed',
        error_code: null,
        user_id: ids.employee,
        project_id: projectId,
      },
    ]);
    await hidden();

    // The founder approves with the passkey; the card names the project.
    const waiting = await detail(founder, id);
    expect(waiting).toMatchObject({
      stage: 'unit_approval',
      waitingForMe: true,
      project: { id: projectId },
      approval: { project: { id: projectId, name: 'Lansman projesi' }, agentsMayWork: true },
    });
    const approved = await approve(waiting.approval?.id ?? '', 'A');
    expect(approved).toMatchObject({
      stage: 'requester_approval',
      turn: { kind: 'person', userId: ids.employee },
    });
    await hidden();

    // The employee accepts: done, still inside its project, still hidden from the stranger.
    const accepted = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(requestDetailSchema.parse(accepted.json())).toMatchObject({
      status: 'done',
      stage: 'done',
      project: { id: projectId, name: 'Lansman projesi' },
      result: { option: { code: 'A' } },
    });
    await hidden();
    for (const session of [employee, founder]) {
      const list = requestListSchema.parse(
        (await get(session, `/api/requests?project=${projectId}`)).json(),
      );
      expect(list.requests.map((request) => request.id)).toEqual([id]);
    }
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('an agent reads a file of the project: the journey of the request names it', async () => {
    const projectId = await projectWithAgents('Dosyalı proje');
    // The employee adds a file as the panel does: the ticket, then the bytes.
    const fileId = randomUUID();
    const bytes = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
    const ticket = await post(employee, `/api/projects/${projectId}/files/${fileId}/ticket`, {
      sizeBytes: bytes.length,
    });
    expect(ticket.statusCode, ticket.body).toBe(200);
    const added = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/files/${fileId}`,
      cookies: { [SESSION_COOKIE]: employee },
      headers: {
        ...SAME_ORIGIN,
        [COMPANY_HEADER]: ids.arma,
        'content-type': 'application/octet-stream',
        [FILE_NAME_HEADER]: encodeURIComponent('Etkinlik programı.pdf'),
        [UPLOAD_TICKET_HEADER]: uploadTicketSchema.parse(ticket.json()).ticket,
      },
      payload: bytes,
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(projectFileSchema.parse(added.json())).toMatchObject({ id: fileId, kind: 'pdf' });

    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'Etkinlik için LinkedIn gönderisi yaz; tarih programdaki gibi',
      projectId,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });

    // The worker reads what the API stored: the same bytes under the same key, handed to the
    // worker's own reading module (the two processes share the storage, not a module).
    const reader = new MemoryFileReader();
    for (const [key, object] of server.storage.objects) reader.objects.set(key, object.content);
    const sos = new ScriptedModel([
      toolUse('read_project_file', { file_id: fileId }),
      toolUse('submit_for_approval', RESULT),
    ]);
    expect(
      await work(sos, {
        files: new RunProjectFiles(reader),
        countFileTokens: () => Promise.resolve(640),
      }),
    ).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    // The run was told of the file the employee added, and was given its bytes.
    expect(dataOf(sos)).toContain('Etkinlik programı.pdf');
    expect(JSON.stringify(sos.requests[1])).toContain(bytes.toString('base64'));
    expect(reader.calls).toEqual([`${ids.arma}/projects/${projectId}/${fileId}`]);

    // The journey the API answers: the run's steps, and the file's name on the read. Both readers
    // of this request may read the file.
    for (const session of [employee, founder]) {
      const read = await detail(session, id);
      const run = read.journey.find((item) => item.kind === 'run' && item.agent.code === 'SOS-2');
      if (run?.kind !== 'run') throw new Error('No run of the unit agent in the journey');
      // Nothing of the file but its name: a step has no field for content, a size or tokens.
      expect(run.steps).toEqual([
        {
          tool: 'read_project_file',
          status: 'succeeded',
          code: null,
          fileName: 'Etkinlik programı.pdf',
        },
        { tool: 'submit_for_approval', status: 'succeeded', code: null, fileName: null },
      ]);
      expect(JSON.stringify(read)).not.toContain(bytes.toString('base64'));
    }
    // The request waits for the approver: the next cases meet no job of this one.
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('a requester is taken out of the project after the routing: the unit agent works in the founder’s name, the founder approves and accepts in their place', async () => {
    const projectId = await projectWithAgents('Sahibi ayrılan talep');
    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'Lansman için LinkedIn gönderisi yaz',
      projectId,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    // The owner of the project (the founder) takes the employee out of it.
    const removed = await send(
      server,
      founder,
      'DELETE',
      `/api/projects/${projectId}/members/${ids.employee}`,
      { company: ids.arma },
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await get(employee, `/api/requests/${id}`)).statusCode).toBe(404);
    expect(await detail(founder, id)).toMatchObject({
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2' },
      requester: { userId: ids.employee },
      requesterReads: false,
    });

    // The job that was sent with the routing names the employee; the run goes in the founder's
    // name, and the work is done.
    expect(await work(new ScriptedModel([toolUse('submit_for_approval', RESULT)]))).toEqual({
      outcome: 'submitted',
      agent: 'SOS-2',
    });
    expect((await runsOf(id)).map((run) => [run.agent_code, run.status, run.user_id])).toEqual([
      ['KOR-1', 'completed', ids.employee],
      ['SOS-2', 'completed', ids.founder],
    ]);

    // The founder approves as the unit's approver, and then gives the requester's approval in
    // the employee's place: a second, separate act.
    const waiting = await detail(founder, id);
    expect(waiting).toMatchObject({ stage: 'unit_approval', waitingForMe: true, acceptance: null });
    const approved = await approve(waiting.approval?.id ?? '', 'B');
    expect(approved).toMatchObject({
      status: 'awaiting_approval',
      stage: 'requester_approval',
      turn: { kind: 'founder' },
      waitingForMe: true,
      requesterReads: false,
      acceptance: { round: 1, inPlaceOfRequester: true },
    });
    expect(await waitingFor(founder, id)).toEqual({ approval: false, acceptance: true });
    expect((await desk(founder)).acceptances.find((card) => card.requestId === id)).toMatchObject({
      forRequester: { userId: ids.employee },
    });
    const accepted = await post(founder, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const done = requestDetailSchema.parse(accepted.json());
    expect(done).toMatchObject({
      status: 'done',
      requester: { userId: ids.employee },
      result: { option: { code: 'B' } },
    });
    expect(done.journey.at(-1)).toMatchObject({
      kind: 'acceptance',
      status: 'approved',
      decidedBy: { userId: ids.founder },
    });
    expect((await get(employee, `/api/requests/${id}`)).statusCode).toBe(404);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('a stopped agent is opened again: the request it was working on starts again by itself and reaches the approver', async () => {
    await settle();
    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'LinkedIn için gönderi yaz\nKaynak: İzmir ofisimiz 1 Ekim’de açıldı.',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    try {
      // The founder stops the agent while its model call is open: the run ends before its next
      // step, and nothing of the answer is stored.
      const stoppedMidway = new ScriptedModel([
        async () => {
          await switchUnitAgent('stopped');
          return toolUse('submit_for_approval', RESULT);
        },
      ]);
      expect(await work(stoppedMidway)).toEqual({ outcome: 'stopped', agent: 'SOS-2' });
      for (const session of [founder, employee]) {
        expect(await detail(session, id)).toMatchObject({
          status: 'in_progress',
          stage: 'fell_to_person',
          cause: 'agent_stopped',
          turn: { kind: 'founder' },
          waitingForMe: session === founder,
          approval: null,
        });
      }
      expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

      // The founder opens the agent: the request is started again, by that very act.
      expect(await switchUnitAgent('enabled')).toBe(1);
    } finally {
      await switchUnitAgent('enabled');
    }
    expect(
      await admin(
        `select data from pgboss.job
         where name = $1 and data ->> 'taskId' = $2 and state = 'created'`,
        [AGENT_RUN_QUEUE, id],
      ),
    ).toEqual([
      { data: { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'SOS-2' } },
    ]);
    expect(await detail(founder, id)).toMatchObject({
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'SOS-2' },
      waitingForMe: false,
    });
    // The worker takes the job like any other, and the result reaches the approver.
    expect(await work(new ScriptedModel([toolUse('submit_for_approval', RESULT)]))).toEqual({
      outcome: 'submitted',
      agent: 'SOS-2',
    });
    expect(await detail(founder, id)).toMatchObject({
      status: 'awaiting_approval',
      stage: 'unit_approval',
      waitingForMe: true,
      approval: { agent: { code: 'SOS-2' } },
    });
    // Exactly two runs of the unit agent: the one the switch stopped, and the one that did the
    // work.
    expect(
      (await runsOf(id))
        .filter((run) => run.agent_code === 'SOS-2')
        .map((run) => [run.status, run.error_code]),
    ).toEqual([
      ['stopped', 'agent_stopped'],
      ['completed', null],
    ]);
    expect(journeyOf(await detail(founder, id))).toEqual([
      'run:completed',
      'routing:',
      'run:stopped',
      'run:completed',
      'approval:pending',
    ]);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
    await post(founder, `/api/requests/${id}/close`);
  });

  it('a closed AI permission is opened again: the held request starts again by itself', async () => {
    const projectId = await projectWithAgents('İzni kapanıp açılan proje');
    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'Lansman için LinkedIn gönderisi yaz',
      projectId,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    // The founder closes the permission while the unit agent's job is on the queue. No passkey.
    const closed = await put(founder, `/api/projects/${projectId}/ai-permission`, {
      allowed: false,
    });
    expect(closed.statusCode, closed.body).toBe(200);
    // The worker takes the job: no run, no model call (rule 12), and the trace of the refusal.
    const never = new ScriptedModel([]);
    expect(await work(never)).toEqual({ outcome: 'ai_not_allowed', agent: 'SOS-2' });
    expect(never.requests).toHaveLength(0);
    expect((await runsOf(id)).map((run) => run.agent_code)).toEqual(['KOR-1']);
    for (const session of [founder, employee]) {
      expect(await detail(session, id)).toMatchObject({
        status: 'in_progress',
        stage: 'fell_to_person',
        cause: 'ai_permission_closed',
        turn: { kind: 'founder' },
        waitingForMe: session === founder,
        agentsMayWork: false,
      });
    }
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    // Opened again with the passkey: the request it held is started again by that very act.
    expect((await openPermission(projectId)).restarted).toBe(1);
    expect(await detail(founder, id)).toMatchObject({
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'SOS-2' },
      agentsMayWork: true,
    });
    expect(await work(new ScriptedModel([toolUse('submit_for_approval', RESULT)]))).toEqual({
      outcome: 'submitted',
      agent: 'SOS-2',
    });
    expect(await detail(founder, id)).toMatchObject({
      stage: 'unit_approval',
      waitingForMe: true,
      project: { id: projectId },
    });
    expect((await runsOf(id)).map((run) => [run.agent_code, run.status, run.project_id])).toEqual([
      ['KOR-1', 'completed', projectId],
      ['SOS-2', 'completed', projectId],
    ]);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
    await post(founder, `/api/requests/${id}/close`);
  });

  // 8 October decision 17: the AI spending limit of a project.
  it('the coordinator’s routing that reaches the limit is stored, and the unit agent’s job is then refused', async () => {
    const projectId = await projectWithAgents('Sınırı dolan proje');
    // The founder sets a first limit: no passkey.
    const limited = await put(founder, `/api/projects/${projectId}/ai-spending-limit`, {
      limitUsd: '1',
    });
    expect(limited.statusCode, limited.body).toBe(200);
    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'Lansman için LinkedIn gönderisi yaz',
      projectId,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(requestDetailSchema.parse(created.json())).toMatchObject({
      stage: 'routing',
      spendingLimitReached: false,
    });
    // The coordinator's one call costs more than the whole limit. The answer was paid for, so
    // it is used: the routing is stored and the unit agent's job is put on the queue.
    expect(
      await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS, { input: 50_000_000 })])),
    ).toEqual({ outcome: 'routed', agent: 'KOR-1' });
    // The worker takes that job: no run, no model call, and the trace of the refusal.
    const never = new ScriptedModel([]);
    expect(await work(never)).toEqual({ outcome: 'spending_limit_reached', agent: 'SOS-2' });
    expect(never.requests).toHaveLength(0);
    expect((await runsOf(id)).map((run) => [run.agent_code, run.status])).toEqual([
      ['KOR-1', 'completed'],
    ]);
    // The request falls to the founder, with the reason; the permission is not what holds it.
    for (const session of [founder, employee]) {
      expect(await detail(session, id)).toMatchObject({
        status: 'in_progress',
        stage: 'fell_to_person',
        cause: 'spending_limit_reached',
        turn: { kind: 'founder' },
        waitingForMe: session === founder,
        agentsMayWork: true,
        spendingLimitReached: true,
        agent: { code: 'SOS-2' },
      });
    }
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);

    // The founder raises the limit with the passkey (11 October decision 1): the request the limit
    // held is started again by that very act, and the answer says so.
    const raised = await put(founder, `/api/projects/${projectId}/ai-spending-limit`, {
      limitUsd: '900000',
      stepUp: await signStepUp(server, founder, founderKey, {
        purpose: 'project_ai_spending_limit',
        companyId: ids.arma,
        subjectId: projectId,
        details: projectAiSpendingLimitDetails('900000'),
      }),
    });
    expect(raised.statusCode, raised.body).toBe(200);
    expect(projectAiSpendingLimitAnswerSchema.parse(raised.json())).toMatchObject({
      restarted: 1,
      spendingLimitReached: false,
    });
    expect(await detail(founder, id)).toMatchObject({
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'SOS-2' },
      spendingLimitReached: false,
    });
    expect((await runsOf(id)).map((run) => run.agent_code)).toEqual(['KOR-1']);
    // The job the raise put on the queue: the unit agent runs and submits.
    expect(await work(new ScriptedModel([toolUse('submit_for_approval', RESULT)]))).toEqual({
      outcome: 'submitted',
      agent: 'SOS-2',
    });
    expect(await detail(founder, id)).toMatchObject({ stage: 'unit_approval', waitingForMe: true });
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
    await post(founder, `/api/requests/${id}/close`, { reason: 'Deneme bitti.' });
  });

  // An agent's question (12 October decisions 3 and 4): the runner's own path, the request page
  // and Bugün, the requester's answer through the API, and the same agent's next run.
  const QUESTION = 'Cuma günkü etkinlik için şunlar gerekli:\n1. Etkinliğin adı\n2. Yeri ve saati';
  const ANSWER = 'Ürün lansmanı, 7 Kasım Cuma 14.00, Maslak ofis.';

  /** The requests that expect something of the person on Bugün. */
  async function expectedOf(session: string): Promise<string[]> {
    const today = todaySchema.parse((await get(session, '/api/today')).json());
    return today.expected.map((request) => request.id);
  }

  /** The jobs of a request that wait on the queue, as they were sent. */
  const queuedFor = (id: string) =>
    admin<{ data: unknown }>(
      `select data from pgboss.job
       where name = $1 and data ->> 'taskId' = $2 and state = 'created'`,
      [AGENT_RUN_QUEUE, id],
    );

  /** The names of the tools the model was given in the first call of a run. */
  const toolsOf = (model: ScriptedModel): string[] =>
    (model.requests[0]?.tools ?? []).flatMap((tool) => ('name' in tool ? [tool.name] : []));

  it('a request with a question, end to end', async () => {
    await settle();
    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'Cuma günkü etkinliğimizi duyuran bir gönderi yaz.',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });

    // The unit agent cannot write without the event: it asks, and its run ends.
    const asking = new ScriptedModel([toolUse('ask_requester', { question: QUESTION })]);
    expect(await work(asking)).toEqual({ outcome: 'asked', agent: 'SOS-2' });
    // Nothing was put on the queue, and nothing reached the approval desk.
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    for (const session of [founder, employee]) {
      expect(await waitingFor(session, id)).toEqual({ approval: false, acceptance: false });
    }

    // The requester reads the question on the request's page and has the box to answer it; the
    // request is on their Bugün list and on nobody else's.
    const mine = await detail(employee, id);
    expect(mine).toMatchObject({
      status: 'awaiting_reply',
      stage: 'awaiting_reply',
      waitingForMe: true,
      approval: null,
      question: {
        agent: { code: 'SOS-2' },
        text: QUESTION,
        mayAnswer: true,
        inPlaceOfRequester: false,
      },
    });
    const questionId = mine.question?.id ?? '';
    expect(journeyOf(mine)).toEqual([
      'run:completed',
      'routing:',
      'run:completed',
      'question:open',
    ]);
    expect(await expectedOf(employee)).toContain(id);
    expect(await expectedOf(founder)).not.toContain(id);
    // The approver of the request (the founder: nobody is appointed for the unit) reads the
    // question and cannot answer it while the requester can.
    expect(await detail(founder, id)).toMatchObject({
      stage: 'awaiting_reply',
      waitingForMe: false,
      question: { id: questionId, text: QUESTION, mayAnswer: false },
    });
    const byFounder = await post(founder, `/api/requests/${id}/questions/${questionId}/answer`, {
      answer: 'Kurucunun yanıtı.',
    });
    expect([byFounder.statusCode, errorCode(byFounder)]).toEqual([403, 'answer_not_allowed']);
    expect(await queuedFor(id)).toEqual([]);

    // The requester answers: the request is in progress again, and the job of the agent that
    // asked is on the queue, with ids only (rule 10).
    const answered = await post(employee, `/api/requests/${id}/questions/${questionId}/answer`, {
      answer: ANSWER,
    });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(requestDetailSchema.parse(answered.json())).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'SOS-2' },
      waitingForMe: false,
      question: null,
    });
    expect(await queuedFor(id)).toEqual([
      { data: { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'SOS-2' } },
    ]);
    expect(await expectedOf(employee)).not.toContain(id);

    // The same agent runs again and is given the question and the answer as marked data; it
    // has asked once on this request and is not given the asking tool again.
    const writing = new ScriptedModel([toolUse('submit_for_approval', RESULT)]);
    expect(await work(writing)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    const data = dataOf(writing);
    expect(data).toContain('<questions_and_answers>');
    expect(data).toContain('Maslak ofis.');
    expect(data).toContain('answeredBy\\":\\"requester');
    expect(toolsOf(writing)).toEqual(['submit_for_approval']);
    expect(toolsOf(asking)).toEqual(['submit_for_approval', 'ask_requester']);

    // From here the request goes the way of every request: the approver, then the requester.
    const waiting = await detail(founder, id);
    expect(waiting).toMatchObject({ stage: 'unit_approval', waitingForMe: true, question: null });
    await approve(waiting.approval?.id ?? '', 'A');
    const accepted = await post(employee, `/api/requests/${id}/acceptance`, {
      decision: 'approved',
    });
    const done = requestDetailSchema.parse(accepted.json());
    expect(done).toMatchObject({ status: 'done', stage: 'done', question: null });
    expect(journeyOf(done)).toEqual([
      'run:completed',
      'routing:',
      'run:completed',
      'question:answered',
      'run:completed',
      'approval:approved',
      'acceptance:approved',
    ]);
    // Every status was written by the flow; "Yanıt bekliyor" once, between two "in progress".
    const statuses = await admin<{ event: string }>(
      `select event from office.audit_log
       where record_type = 'task' and record_id = $1 and event like 'task_status_%' order by id`,
      [id],
    );
    expect(statuses.map((row) => row.event)).toEqual([
      'task_status_in_progress',
      'task_status_awaiting_reply',
      'task_status_in_progress',
      'task_status_awaiting_approval',
      'task_status_done',
    ]);
    expect((await runsOf(id)).map((run) => [run.agent_code, run.status, run.user_id])).toEqual([
      ['KOR-1', 'completed', ids.employee],
      ['SOS-2', 'completed', ids.employee],
      ['SOS-2', 'completed', ids.employee],
    ]);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('the answer while the agent is stopped: the opening’s restart runs the agent with the answer', async () => {
    await settle();
    const id = randomUUID();
    const created = await post(employee, '/api/requests', {
      id,
      text: 'Cuma günkü etkinliğimizi duyuran bir gönderi yaz.',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await work(new ScriptedModel([toolUse('route_task', ROUTE_TO_SOS)]))).toEqual({
      outcome: 'routed',
      agent: 'KOR-1',
    });
    expect(
      await work(new ScriptedModel([toolUse('ask_requester', { question: QUESTION })])),
    ).toEqual({ outcome: 'asked', agent: 'SOS-2' });
    const questionId = (await detail(employee, id)).question?.id ?? '';
    try {
      // The founder stops the agent while the request waits for the answer. A request that
      // waits for an answer is not waiting work: it still reads "Yanıt bekliyor".
      await switchUnitAgent('stopped');
      expect(await detail(employee, id)).toMatchObject({
        stage: 'awaiting_reply',
        waitingForMe: true,
      });
      // The answer is stored whatever holds the work; no job is sent for a stopped agent.
      const answered = await post(employee, `/api/requests/${id}/questions/${questionId}/answer`, {
        answer: ANSWER,
      });
      expect(answered.statusCode, answered.body).toBe(200);
      for (const session of [founder, employee]) {
        expect(await detail(session, id)).toMatchObject({
          status: 'in_progress',
          stage: 'fell_to_person',
          cause: 'agent_stopped',
          turn: { kind: 'founder' },
          waitingForMe: session === founder,
          question: null,
        });
      }
      expect(await queuedFor(id)).toEqual([]);
      // The founder opens the agent: the answered request is started by that very act.
      expect(await switchUnitAgent('enabled')).toBe(1);
    } finally {
      await switchUnitAgent('enabled');
    }
    expect(await queuedFor(id)).toEqual([
      { data: { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'SOS-2' } },
    ]);
    expect(await detail(founder, id)).toMatchObject({
      stage: 'working',
      cause: null,
      turn: { kind: 'agent', code: 'SOS-2' },
    });
    // The worker takes the job like any other; the run is given the answer.
    const writing = new ScriptedModel([toolUse('submit_for_approval', RESULT)]);
    expect(await work(writing)).toEqual({ outcome: 'submitted', agent: 'SOS-2' });
    expect(dataOf(writing)).toContain('Maslak ofis.');
    expect(await detail(founder, id)).toMatchObject({ stage: 'unit_approval', waitingForMe: true });
    expect(journeyOf(await detail(founder, id))).toEqual([
      'run:completed',
      'routing:',
      'run:completed',
      'question:answered',
      'run:completed',
      'approval:pending',
    ]);
    expect(await workerQueue.fetch(AGENT_RUN_QUEUE)).toEqual([]);
    expect(errors).toEqual([]);
    await post(founder, `/api/requests/${id}/close`, { reason: 'Deneme bitti.' });
  });
});
