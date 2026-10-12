import { randomUUID } from 'node:crypto';
import { agentStep, createPool, withContext } from '@agent-office/db';
import {
  REQUEST_ANSWER_MAX,
  agentOpenResponseSchema,
  projectDetailSchema,
  requestDetailSchema,
  requestListSchema,
  sidebarCountsSchema,
  todaySchema,
  type JourneyItem,
  type RequestDetail,
  type SidebarCounts,
  type Today,
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

// An agent's question to the requester, through the API (7 October decision 7; 12 October
// decisions 3 and 4): what each reader of the request is given of it, where it stands on Bugün,
// and the answer, which calls for the run of the agent that asked. Requests are opened and acted on through the API; the agent's part (the routing, the
// question) is played with the worker's own restricted role and an agent context, exactly as the
// runner writes it. The runner itself is tested in apps/worker, the rules of the database in
// packages/db.
//
// The unit agent of these tests is HAF-2, as in the request tests: the fixtures give it no switch
// and no card version, so this file gives it both and takes them away again at the end, with
// everything else it wrote (its requests would stand in the founder's lists and counts in every
// file that runs after it).

const database = inject('database');
const CARD_KOR = '00000000-0000-4000-8000-000000000971';
const CARD_HAF = '00000000-0000-4000-8000-000000000972';
// An employee who holds the approval right and is appointed for HAF by this file. A person of
// this file's own: other files change the approval right of the fixtures' people.
const APPROVER = '00000000-0000-4000-8000-000000000973';
const approverAccount = {
  email: 'approver.questions@armadx.test',
  sub: 'sub-approver-questions',
  hd: 'armadx.test',
} as const;
// What the agent asks: a model's text nobody approved.
const QUESTION = 'Gönderi hangi kanal için yazılsın: LinkedIn mi, Instagram mı?';
// The fixed sentence of a run that asked (the runner's; never the question itself).
const ASKED_SUMMARY = 'Ajan talep sahibine bir soru sordu ve çalışmasını bitirdi.';
// What the requester answers: a person's text, read by the same three as the question.
const ANSWER = 'LinkedIn için; kısa ve sade olsun.';

describe.skipIf(noDatabase)('an agent’s question on the request page and on Bugün', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let colleague: string;
  let approver: string;
  let external: string;
  const workerPool = createPool(database?.worker ?? '', 'agent-office-api-test-worker', () => {});
  // A connection of the API's role beside the server's own, for an act the API has no route for.
  const besidePool = createPool(database?.app ?? '', 'agent-office-api-test-beside', () => {});
  const founderContext = { companyId: ids.arma, userId: ids.founder };
  // What this file opened, and the newest audit row before its first write.
  const requests: string[] = [];
  const projects: string[] = [];
  let auditMark = '0';

  beforeAll(async () => {
    const [newest] = await adminQuery<{ id: string }>(
      'select coalesce(max(id), 0)::text as id from office.audit_log',
    );
    auditMark = newest?.id ?? '0';
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
    external = await sessionOf(server, accounts.external);
    await adminExec(`
      insert into office.users (id, name) values ('${APPROVER}', 'Birim Onaylayıcısı')
        on conflict do nothing;
      insert into office.user_emails (email, user_id)
        values ('${approverAccount.email}', '${APPROVER}') on conflict do nothing;
      insert into office.memberships (company_id, user_id, role, can_approve)
        values ('${ids.arma}', '${APPROVER}', 'employee', true) on conflict do nothing;
    `);
    approver = await sessionOf(server, approverAccount);
    await adminExec(`
      insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
        values ('${CARD_KOR}', 'KOR-1', 'abc0971', '{"card": {"status": "active"}}', 'Y2',
                 'test-model'),
               ('${CARD_HAF}', 'HAF-2', 'abc0971', '{"card": {"status": "active"}}', 'Y1',
                 'test-model')
        on conflict do nothing;
      update office.agent_definitions set current_version_id = '${CARD_KOR}' where code = 'KOR-1';
      update office.agent_definitions set current_version_id = '${CARD_HAF}' where code = 'HAF-2';
    `);
    const enabled = await call(founder, 'PUT', '/api/agents/HAF-2/switch', { status: 'enabled' });
    expect(enabled.statusCode, enabled.body).toBe(200);
    // The approver of the unit: every step routed to HAF from here on names this person.
    await withContext(besidePool, founderContext, (client) =>
      client.query(
        `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'HAF', $2)`,
        [ids.arma, APPROVER],
      ),
    );
  });

  afterAll(async () => {
    // This clean-up is an administrator's. The flow lets nobody delete a request, a question or
    // a run, so the triggers are off for this one transaction (the statements of one call are
    // one transaction); with them off no foreign key cascades, so every table is named.
    const uuid = /^[0-9a-f-]{36}$/;
    if (![...requests, ...projects].every((id) => uuid.test(id)) || !/^\d+$/.test(auditMark)) {
      throw new Error('Unexpected id in the clean-up');
    }
    const list = (values: string[]): string =>
      `(${['00000000-0000-4000-8000-000000000000', ...values].map((id) => `'${id}'`).join(', ')})`;
    const tasks = list(requests);
    const mine = list(projects);
    await adminExec(`
      set local session_replication_role = 'replica';
      delete from office.task_questions where task_id in ${tasks};
      delete from office.task_comments where task_id in ${tasks};
      delete from office.requester_approvals where task_id in ${tasks};
      delete from office.approvals where task_id in ${tasks};
      delete from office.task_routings where task_id in ${tasks};
      delete from office.tool_calls where run_id in (
        select id from office.runs where task_id in ${tasks});
      delete from office.runs where task_id in ${tasks};
      delete from office.notifications where record_type = 'task' and record_id in ${tasks};
      delete from office.tasks where id in ${tasks};
      delete from office.project_members where project_id in ${mine};
      delete from office.projects where id in ${mine};
      delete from office.approvers where user_id = '${APPROVER}';
      delete from office.memberships where user_id = '${APPROVER}';
      delete from office.company_agents where agent_code = 'HAF-2';
      update office.agent_definitions set current_version_id = null
        where code in ('KOR-1', 'HAF-2');
      delete from office.card_versions where id in ('${CARD_KOR}', '${CARD_HAF}');
      delete from office.audit_log where id > ${auditMark};
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

  /** The employee (or another person) opens a request through the API. */
  async function open(session: string = employee, projectId?: string): Promise<string> {
    const res = await call(session, 'POST', '/api/requests', {
      id: randomUUID(),
      text: 'Yeni ofis için gönderi yaz\nKaynak: İzmir ofisi açıldı.',
      ...(projectId === undefined ? {} : { projectId }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = requestDetailSchema.parse(res.json());
    requests.push(id);
    return id;
  }

  async function read(session: string, id: string): Promise<RequestDetail> {
    const res = await call(session, 'GET', `/api/requests/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return requestDetailSchema.parse(res.json());
  }

  /** The coordinator's run: routes the request to HAF-2 and ends. */
  async function route(taskId: string, projectId: string | null = null): Promise<void> {
    await agentStep(
      workerPool,
      { companyId: ids.arma, userId: ids.employee, agentCode: 'KOR-1', projectId },
      async (client) => {
        const run = await client.query<{ id: string }>(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model) values ($1, $2, 'KOR-1', $3, 'request', 'test-model') returning id`,
          [ids.arma, taskId, CARD_KOR],
        );
        const runId = run.rows[0]?.id;
        await client.query('select office.route_request($1, $2::jsonb, $3)', [
          taskId,
          JSON.stringify([{ unit: 'HAF', agent: 'HAF-2', reason: 'Kurumsal hafıza işi.' }]),
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

  /**
   * The agent whose turn it is asks, as the runner does it: one transaction that opens nothing
   * new but the question, puts the request to "Yanıt bekliyor" and ends the run with its fixed
   * sentence. Returns the question's id.
   */
  async function ask(
    taskId: string,
    agent: 'KOR-1' | 'HAF-2',
    options: { projectId?: string; as?: string; text?: string } = {},
  ): Promise<string> {
    return agentStep(
      workerPool,
      {
        companyId: ids.arma,
        userId: options.as ?? ids.employee,
        agentCode: agent,
        projectId: options.projectId ?? null,
      },
      async (client) => {
        const run = await client.query<{ id: string }>(
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model) values ($1, $2, $3, $4, $5, 'test-model') returning id`,
          [
            ids.arma,
            taskId,
            agent,
            agent === 'KOR-1' ? CARD_KOR : CARD_HAF,
            agent === 'KOR-1' ? 'request' : 'handoff',
          ],
        );
        const runId = run.rows[0]?.id;
        const asked = await client.query<{ id: string }>(
          'select office.ask_question($1, $2, $3) as id',
          [taskId, runId, options.text ?? QUESTION],
        );
        const questionId = asked.rows[0]?.id ?? '';
        await client.query(
          `update office.runs set status = 'completed', finished_at = now(), summary = $2,
             output = $3::jsonb where id = $1`,
          [runId, ASKED_SUMMARY, JSON.stringify({ outcome: 'asked', question_id: questionId })],
        );
        return questionId;
      },
    );
  }

  /** A request of the employee that HAF-2 asked a question on: it waits for the employee. */
  async function asked(): Promise<{ id: string; questionId: string }> {
    const id = await open();
    await route(id);
    return { id, questionId: await ask(id, 'HAF-2') };
  }

  const questionsOf = (detail: RequestDetail) =>
    detail.journey.flatMap((item) => (item.kind === 'question' ? [item] : []));

  const close = (session: string, id: string, reason?: string) =>
    call(session, 'POST', `/api/requests/${id}/close`, reason === undefined ? {} : { reason });

  /** A project of the founder with the employee as a member, where agents may work. */
  async function project(name: string): Promise<string> {
    const res = await call(founder, 'POST', '/api/projects', {
      id: randomUUID(),
      name,
      memberIds: [ids.employee],
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = projectDetailSchema.parse(res.json());
    projects.push(id);
    // Opened as an administrator would: a person's opening asks for a passkey (the project tests).
    await adminQuery('update office.projects set ai_allowed = true where id = $1', [id]);
    return id;
  }

  /**
   * A request of the employee inside a project, with a question of the coordinator, after the
   * founder took the employee out of the project: the requester cannot read it any more.
   */
  async function askedAndLost(name: string): Promise<{ id: string; questionId: string }> {
    const projectId = await project(name);
    const id = await open(employee, projectId);
    const questionId = await ask(id, 'KOR-1', { projectId });
    const removed = await call(
      founder,
      'DELETE',
      `/api/projects/${projectId}/members/${ids.employee}`,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    return { id, questionId };
  }

  it('the page of a request that waits for an answer', async () => {
    const { id, questionId } = await asked();
    const item: Partial<JourneyItem> = {
      kind: 'question',
      id: questionId,
      agent: { code: 'HAF-2', name: 'Kurumsal Arama Ajanı' },
      status: 'open',
      text: QUESTION,
      answer: null,
      answeredAt: null,
      answeredBy: null,
      answeredInPlace: false,
      closedAt: null,
    };
    const waiting = {
      id,
      status: 'awaiting_reply',
      stage: 'awaiting_reply',
      cause: null,
      delayed: false,
      turn: { kind: 'person', userId: ids.employee, name: 'Çalışan' },
      approval: null,
      result: null,
      acceptance: null,
    };

    // The requester: the question, and the box to answer it.
    const mine = await read(employee, id);
    expect(mine).toMatchObject({
      ...waiting,
      waitingForMe: true,
      question: {
        id: questionId,
        agent: { code: 'HAF-2', name: 'Kurumsal Arama Ajanı' },
        text: QUESTION,
        mayAnswer: true,
        inPlaceOfRequester: false,
      },
      // The acts are what they were: the requester cancels.
      actions: { cancel: true, stop: false, reroute: false },
    });
    expect(questionsOf(mine)).toEqual([expect.objectContaining(item)]);
    // The question stands after the run that asked it, whose sentence is the runner's own.
    expect(mine.journey.slice(-2)).toMatchObject([
      { kind: 'run', agent: { code: 'HAF-2' }, status: 'completed', summary: ASKED_SUMMARY },
      { kind: 'question', id: questionId },
    ]);

    // The founder and the appointed approver of the step read it and do not answer; they stop
    // and correct the routing as before.
    for (const reader of [founder, approver]) {
      const theirs = await read(reader, id);
      expect(theirs).toMatchObject({
        ...waiting,
        waitingForMe: false,
        question: { id: questionId, text: QUESTION, mayAnswer: false, inPlaceOfRequester: false },
        actions: { cancel: false, stop: true, reroute: true },
      });
      expect(questionsOf(theirs)).toEqual([expect.objectContaining(item)]);
    }

    // Another employee reads the request: that it waits for an answer, and no word of the
    // question (a model's text nobody approved).
    const others = await read(colleague, id);
    expect(others).toMatchObject({
      ...waiting,
      waitingForMe: false,
      question: null,
      actions: { cancel: false, stop: false, reroute: false },
    });
    expect(questionsOf(others)).toEqual([]);
    expect(JSON.stringify(others)).not.toContain('hangi kanal');
    // The run's own sentence tells them what happened.
    expect(others.journey.at(-1)).toMatchObject({ kind: 'run', summary: ASKED_SUMMARY });

    // The lists say the same stage to everybody, and nothing of the text.
    for (const reader of [employee, founder, colleague]) {
      const res = await call(reader, 'GET', '/api/requests');
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('hangi kanal');
      const row = requestListSchema.parse(res.json()).requests.find((entry) => entry.id === id);
      expect(row).toMatchObject({
        status: 'awaiting_reply',
        stage: 'awaiting_reply',
        waitingForMe: reader === employee,
      });
    }

    // Nobody outside: an external person, and a session in another company.
    const outside = await call(external, 'GET', `/api/requests/${id}`);
    expect([outside.statusCode, errorCode(outside)]).toEqual([403, 'insiders_only']);
    const elsewhere = await call(founder, 'GET', `/api/requests/${id}`, undefined, ids.pillika);
    expect([elsewhere.statusCode, errorCode(elsewhere)]).toEqual([404, 'not_found']);

    expect((await close(employee, id)).statusCode).toBe(200);
  });

  it('the coordinator’s question, before any routing, is read by the requester and the founder', async () => {
    const id = await open();
    const questionId = await ask(id, 'KOR-1');
    const mine = await read(employee, id);
    expect(mine).toMatchObject({
      status: 'awaiting_reply',
      stage: 'awaiting_reply',
      unit: null,
      agent: null,
      waitingForMe: true,
      question: { id: questionId, agent: { code: 'KOR-1' }, mayAnswer: true },
      actions: { cancel: true, stop: false, reroute: false },
    });
    // Before a routing only the founder decides the work.
    expect(await read(founder, id)).toMatchObject({
      waitingForMe: false,
      question: { id: questionId, mayAnswer: false },
      actions: { cancel: false, stop: true, reroute: true },
    });
    // The person appointed for a unit is not the approver of a request no unit has yet.
    for (const reader of [approver, colleague]) {
      const theirs = await read(reader, id);
      expect(theirs).toMatchObject({ stage: 'awaiting_reply', question: null });
      expect(questionsOf(theirs)).toEqual([]);
      expect(JSON.stringify(theirs)).not.toContain('hangi kanal');
    }
    expect((await close(employee, id)).statusCode).toBe(200);
  });

  it('a cancel, a stop and a corrected routing close the question', async () => {
    const closedItem = { kind: 'question', status: 'closed', text: QUESTION, answer: null };

    // The requester cancels.
    const cancelled = await asked();
    const afterCancel = requestDetailSchema.parse((await close(employee, cancelled.id)).json());
    expect(afterCancel).toMatchObject({ status: 'cancelled', stage: 'cancelled', question: null });
    expect(questionsOf(afterCancel)).toMatchObject([closedItem]);
    expect(questionsOf(afterCancel)[0]?.closedAt).not.toBeNull();
    // The readers of the question still read it, closed; nobody else reads it now either.
    expect(questionsOf(await read(approver, cancelled.id))).toMatchObject([closedItem]);
    expect(questionsOf(await read(colleague, cancelled.id))).toEqual([]);

    // The founder stops.
    const stopped = await asked();
    const afterStop = requestDetailSchema.parse(
      (await close(founder, stopped.id, 'Bu iş bu hafta yapılmayacak.')).json(),
    );
    expect(afterStop).toMatchObject({ status: 'cancelled', question: null });
    expect(questionsOf(afterStop)).toMatchObject([closedItem]);
    expect(await read(employee, stopped.id)).toMatchObject({
      stage: 'cancelled',
      cause: 'stopped',
      question: null,
    });

    // The approver corrects the routing: the request goes on without the answer, and the job of
    // the new step's agent is sent.
    const rerouted = await asked();
    const before = server.jobs.sent.length;
    const corrected = await call(approver, 'POST', `/api/requests/${rerouted.id}/routing`, {
      unitCode: 'HAF',
      agentCode: 'HAF-2',
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    const afterRouting = requestDetailSchema.parse(corrected.json());
    expect(afterRouting).toMatchObject({
      status: 'in_progress',
      stage: 'working',
      turn: { kind: 'agent', code: 'HAF-2' },
      question: null,
    });
    expect(questionsOf(afterRouting)).toMatchObject([closedItem]);
    expect(server.jobs.sent.slice(before)).toEqual([
      { companyId: ids.arma, userId: ids.employee, taskId: rerouted.id, agentCode: 'HAF-2' },
    ]);
    expect(await read(employee, rerouted.id)).toMatchObject({
      stage: 'working',
      waitingForMe: false,
      question: null,
    });
    expect((await close(employee, rerouted.id)).statusCode).toBe(200);
  });

  describe('the answer', () => {
    const answerUrl = (id: string, questionId: string): string =>
      `/api/requests/${id}/questions/${questionId}/answer`;
    const answer = (
      session: string,
      id: string,
      questionId: string,
      text: string = ANSWER,
      company: string = ids.arma,
    ) => call(session, 'POST', answerUrl(id, questionId), { answer: text }, company);

    const questionRows = (id: string) =>
      adminQuery(
        `select status, answer, answered_by_user_id from office.task_questions
         where task_id = $1 order by created_at, id`,
        [id],
      );
    const traces = (id: string, event: string) =>
      adminQuery(
        `select user_id, agent_code from office.audit_log
         where record_type = 'task' and record_id = $1 and event = $2 order by id`,
        [id, event],
      );
    const setSwitch = async (status: 'enabled' | 'stopped') => {
      const res = await call(founder, 'PUT', '/api/agents/HAF-2/switch', { status });
      expect(res.statusCode, res.body).toBe(200);
      return res;
    };

    /** A request of the employee inside a project of the founder, with a question of HAF-2. */
    async function askedIn(name: string): Promise<{
      id: string;
      questionId: string;
      projectId: string;
    }> {
      const projectId = await project(name);
      const id = await open(employee, projectId);
      await route(id, projectId);
      return { id, questionId: await ask(id, 'HAF-2', { projectId }), projectId };
    }

    it('the requester answers an agent’s question: the answer is stored and the agent’s job is sent once, with ids only', async () => {
      const { id, questionId } = await asked();
      const before = server.jobs.sent.length;
      const res = await answer(employee, id, questionId, `  ${ANSWER}\n`);
      expect(res.statusCode, res.body).toBe(200);
      const after = requestDetailSchema.parse(res.json());
      // The request is the agent's again: nothing is asked of anybody.
      expect(after).toMatchObject({
        id,
        status: 'in_progress',
        stage: 'working',
        cause: null,
        turn: { kind: 'agent', code: 'HAF-2' },
        waitingForMe: false,
        question: null,
        approval: null,
        acceptance: null,
      });
      expect(questionsOf(after)).toEqual([
        expect.objectContaining({
          id: questionId,
          status: 'answered',
          text: QUESTION,
          answer: ANSWER,
          answeredBy: { userId: ids.employee, name: 'Çalışan' },
          answeredInPlace: false,
          closedAt: null,
        }),
      ]);
      expect(questionsOf(after)[0]?.answeredAt).not.toBeNull();
      expect(await questionRows(id)).toEqual([
        { status: 'answered', answer: ANSWER, answered_by_user_id: ids.employee },
      ]);
      // One job, for the agent that asked: four ids and nothing of the question or the answer
      // (rule 10).
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
      ]);
      expect(await traces(id, 'run_not_started')).toEqual([]);

      // The founder and the approver read both texts; another employee reads neither.
      for (const reader of [founder, approver]) {
        expect(questionsOf(await read(reader, id))).toMatchObject([
          { status: 'answered', text: QUESTION, answer: ANSWER },
        ]);
      }
      const others = await read(colleague, id);
      expect(others).toMatchObject({ stage: 'working', question: null });
      expect(questionsOf(others)).toEqual([]);
      expect(JSON.stringify(others)).not.toContain('kısa ve sade');
      expect((await close(employee, id)).statusCode).toBe(200);
    });

    it('the coordinator’s question is answered the same way: the coordinator runs again', async () => {
      const id = await open();
      const questionId = await ask(id, 'KOR-1');
      const before = server.jobs.sent.length;
      const res = await answer(employee, id, questionId);
      expect(res.statusCode, res.body).toBe(200);
      expect(requestDetailSchema.parse(res.json())).toMatchObject({
        status: 'in_progress',
        stage: 'routing',
        turn: { kind: 'agent', code: 'KOR-1' },
        question: null,
      });
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' },
      ]);
      expect((await close(employee, id)).statusCode).toBe(200);
    });

    it('a repeated send with the same text changes nothing and sends no second job; another text is refused', async () => {
      const { id, questionId } = await asked();
      const before = server.jobs.sent.length;
      expect((await answer(employee, id, questionId)).statusCode).toBe(200);
      // The same text again by the same person (a retry of a send whose answer was lost): the
      // page as it is, also with blanks around the text.
      for (const text of [ANSWER, ` ${ANSWER} `]) {
        const again = await answer(employee, id, questionId, text);
        expect(again.statusCode, again.body).toBe(200);
        expect(requestDetailSchema.parse(again.json())).toMatchObject({
          stage: 'working',
          question: null,
        });
      }
      expect(server.jobs.sent).toHaveLength(before + 1);
      // Another text after the answer: an answer is stored once and never changed.
      const changed = await answer(employee, id, questionId, 'Instagram olsun.');
      expect([changed.statusCode, errorCode(changed)]).toEqual([409, 'question_closed']);
      expect(await questionRows(id)).toEqual([
        { status: 'answered', answer: ANSWER, answered_by_user_id: ids.employee },
      ]);
      expect(server.jobs.sent).toHaveLength(before + 1);
      expect(
        await adminQuery(
          `select count(*)::int as n from office.audit_log
           where record_type = 'task_question' and event = 'request_question_answered'
             and record_id = $1`,
          [questionId],
        ),
      ).toEqual([{ n: 1 }]);

      // A question a cancel closed is as closed as an answered one.
      const cancelled = await asked();
      expect((await close(employee, cancelled.id)).statusCode).toBe(200);
      const sentSoFar = server.jobs.sent.length;
      const late = await answer(employee, cancelled.id, cancelled.questionId);
      expect([late.statusCode, errorCode(late)]).toEqual([409, 'question_closed']);
      expect(server.jobs.sent).toHaveLength(sentSoFar);
      expect((await close(employee, id)).statusCode).toBe(200);
    });

    it('who may not answer', async () => {
      const { id, questionId } = await asked();
      const before = server.jobs.sent.length;
      // The founder and the appointed approver read the question; while the requester reads the
      // request neither answers it.
      for (const reader of [founder, approver]) {
        const res = await answer(reader, id, questionId);
        expect([res.statusCode, errorCode(res)]).toEqual([403, 'answer_not_allowed']);
      }
      // Another employee reads the request and not the question: it does not exist for them.
      const other = await answer(colleague, id, questionId);
      expect([other.statusCode, errorCode(other)]).toEqual([404, 'not_found']);
      // A session in another company, and an external person.
      const elsewhere = await answer(founder, id, questionId, ANSWER, ids.pillika);
      expect([elsewhere.statusCode, errorCode(elsewhere)]).toEqual([404, 'not_found']);
      const outside = await answer(external, id, questionId);
      expect([outside.statusCode, errorCode(outside)]).toEqual([403, 'insiders_only']);

      // Nothing was stored and nothing was called for.
      expect(await questionRows(id)).toEqual([
        { status: 'open', answer: null, answered_by_user_id: null },
      ]);
      expect(await read(employee, id)).toMatchObject({
        status: 'awaiting_reply',
        question: { id: questionId, mayAnswer: true },
      });
      expect(server.jobs.sent).toHaveLength(before);
      expect((await close(employee, id)).statusCode).toBe(200);
    });

    it('the body', async () => {
      const { id, questionId } = await asked();
      const elsewhere = await asked();
      const before = server.jobs.sent.length;
      const sendBody = (payload: object) =>
        call(employee, 'POST', answerUrl(id, questionId), payload);
      for (const payload of [
        { answer: '' },
        { answer: '   \n\t ' },
        { answer: 'x'.repeat(REQUEST_ANSWER_MAX + 1) },
        { answer: 'a\u0000b' },
        { answer: 12 },
        { text: ANSWER },
        // No field sets a status, names an agent or approves anything.
        { answer: ANSWER, status: 'done' },
        { answer: ANSWER, agentCode: 'KOR-1' },
        { answer: ANSWER, approved: true },
      ]) {
        const res = await sendBody(payload);
        expect([res.statusCode, errorCode(res)], JSON.stringify(payload).slice(0, 60)).toEqual([
          400,
          'invalid_request',
        ]);
      }
      // An id that is none, and a question of another request under this request's path.
      for (const url of [
        answerUrl('not-an-id', questionId),
        answerUrl(id, 'not-an-id'),
        answerUrl(id, randomUUID()),
        answerUrl(randomUUID(), questionId),
        answerUrl(id, elsewhere.questionId),
        answerUrl(elsewhere.id, questionId),
      ]) {
        const res = await call(employee, 'POST', url, { answer: ANSWER });
        expect([res.statusCode, errorCode(res)], url).toEqual([404, 'not_found']);
      }
      for (const request of [id, elsewhere.id]) {
        expect(await questionRows(request)).toEqual([
          { status: 'open', answer: null, answered_by_user_id: null },
        ]);
      }
      expect(server.jobs.sent).toHaveLength(before);
      // The longest answer the contract takes is stored.
      const longest = await sendBody({ answer: 'x'.repeat(REQUEST_ANSWER_MAX) });
      expect(longest.statusCode, longest.body.slice(0, 200)).toBe(200);
      expect((await close(employee, id)).statusCode).toBe(200);
      expect((await close(employee, elsewhere.id)).statusCode).toBe(200);
    });

    it('the founder answers in the requester’s place, and the job still names the requester', async () => {
      const { id, questionId } = await askedAndLost('Yerine yanıtlanan soru projesi');
      const before = server.jobs.sent.length;
      // The requester's own try: the request does not exist for them any more.
      const lost = await answer(employee, id, questionId);
      expect([lost.statusCode, errorCode(lost)]).toEqual([404, 'not_found']);
      // An employee who is no member of the project cannot stand in either.
      const other = await answer(colleague, id, questionId);
      expect([other.statusCode, errorCode(other)]).toEqual([404, 'not_found']);

      const res = await answer(founder, id, questionId, 'Kurucunun yanıtı.');
      expect(res.statusCode, res.body).toBe(200);
      const after = requestDetailSchema.parse(res.json());
      expect(after).toMatchObject({
        status: 'in_progress',
        stage: 'routing',
        question: null,
        requesterReads: false,
        requester: { userId: ids.employee },
      });
      // The journey says who answered, and that it was in the requester's place.
      expect(questionsOf(after)).toMatchObject([
        {
          status: 'answered',
          answer: 'Kurucunun yanıtı.',
          answeredBy: { userId: ids.founder, name: 'Kurucu' },
          answeredInPlace: true,
        },
      ]);
      // In whose name the run goes is the database's answer when the run opens (decision 45).
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'KOR-1' },
      ]);
      expect((await close(founder, id, 'Deneme bitti.')).statusCode).toBe(200);
    });

    it('the answer while the agent is stopped is stored: no job, the trace run_not_started, the stage says ajan durduruldu', async () => {
      const { id, questionId } = await asked();
      await setSwitch('stopped');
      try {
        // Stopped while the question waits: the request still waits for its answer.
        expect(await read(employee, id)).toMatchObject({ stage: 'awaiting_reply' });
        const before = server.jobs.sent.length;
        const res = await answer(employee, id, questionId);
        expect(res.statusCode, res.body).toBe(200);
        expect(requestDetailSchema.parse(res.json())).toMatchObject({
          status: 'in_progress',
          stage: 'fell_to_person',
          cause: 'agent_stopped',
          turn: { kind: 'person', userId: APPROVER },
          question: null,
        });
        expect(await questionRows(id)).toEqual([
          { status: 'answered', answer: ANSWER, answered_by_user_id: ids.employee },
        ]);
        // No job for a stopped agent; the trace is left in the name of the person who answered.
        expect(server.jobs.sent).toHaveLength(before);
        expect(await traces(id, 'run_not_started')).toEqual([
          { user_id: ids.employee, agent_code: null },
        ]);
        // A repeated send writes no second trace.
        expect((await answer(employee, id, questionId)).statusCode).toBe(200);
        expect(await traces(id, 'run_not_started')).toHaveLength(1);

        // The opening starts the work by itself, with the answer (8 October decision 49).
        const opened = await setSwitch('enabled');
        expect(agentOpenResponseSchema.parse(opened.json()).restarted).toBe(1);
        expect(server.jobs.sent.slice(before)).toEqual([
          { companyId: ids.arma, userId: ids.employee, taskId: id, agentCode: 'HAF-2' },
        ]);
        expect(await read(employee, id)).toMatchObject({ stage: 'working', cause: null });
      } finally {
        await setSwitch('enabled');
      }
      expect((await close(employee, id)).statusCode).toBe(200);
    });

    it('the answer while the AI permission is closed, and while the spending limit is reached, is stored and its job is sent; the stage says what holds the work', async () => {
      // The AI permission of the project is closed while the question waits (as an
      // administrator would close it; the routes are tested with the project).
      const closed = await askedIn('İzni kapanan soru projesi');
      await adminQuery('update office.projects set ai_allowed = false where id = $1', [
        closed.projectId,
      ]);
      // The request still waits for its answer, and the requester can give it.
      expect(await read(employee, closed.id)).toMatchObject({
        stage: 'awaiting_reply',
        agentsMayWork: false,
        waitingForMe: true,
        question: { mayAnswer: true },
      });
      let before = server.jobs.sent.length;
      const held = await answer(employee, closed.id, closed.questionId);
      expect(held.statusCode, held.body).toBe(200);
      expect(requestDetailSchema.parse(held.json())).toMatchObject({
        status: 'in_progress',
        stage: 'fell_to_person',
        cause: 'ai_permission_closed',
        turn: { kind: 'founder' },
        agentsMayWork: false,
        question: null,
      });
      // The agent is open, so the job is sent: the runner refuses it and leaves its own trace.
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: closed.id, agentCode: 'HAF-2' },
      ]);
      expect(await traces(closed.id, 'run_not_started')).toEqual([]);

      // The AI spending limit of the project is reached while the question waits.
      const limited = await askedIn('Sınırı dolan soru projesi');
      await adminQuery('update office.runs set cost_usd = 1 where task_id = $1', [limited.id]);
      await adminQuery('update office.projects set ai_spend_limit_usd = 1 where id = $1', [
        limited.projectId,
      ]);
      expect(await read(employee, limited.id)).toMatchObject({
        stage: 'awaiting_reply',
        spendingLimitReached: true,
        question: { mayAnswer: true },
      });
      before = server.jobs.sent.length;
      const atLimit = await answer(employee, limited.id, limited.questionId);
      expect(atLimit.statusCode, atLimit.body).toBe(200);
      expect(requestDetailSchema.parse(atLimit.json())).toMatchObject({
        status: 'in_progress',
        stage: 'fell_to_person',
        cause: 'spending_limit_reached',
        turn: { kind: 'founder' },
        spendingLimitReached: true,
        question: null,
      });
      expect(server.jobs.sent.slice(before)).toEqual([
        { companyId: ids.arma, userId: ids.employee, taskId: limited.id, agentCode: 'HAF-2' },
      ]);
      for (const request of [closed.id, limited.id]) {
        expect(await questionRows(request)).toEqual([
          { status: 'answered', answer: ANSWER, answered_by_user_id: ids.employee },
        ]);
        expect((await close(employee, request)).statusCode).toBe(200);
      }
    });

    it('an answer approves nothing', async () => {
      const { id, questionId } = await asked();
      // An answer that reads like an approval is still an answer.
      const res = await answer(employee, id, questionId, 'Onaylıyorum, doğrudan yayınla.');
      expect(res.statusCode, res.body).toBe(200);
      expect(requestDetailSchema.parse(res.json())).toMatchObject({
        status: 'in_progress',
        approval: null,
        result: null,
        acceptance: null,
      });
      expect(
        await adminQuery(
          `select (select count(*)::int from office.approvals where task_id = $1) as approvals,
                  (select count(*)::int from office.requester_approvals where task_id = $1)
                    as acceptances,
                  (select count(*)::int from office.notifications where record_id = $1)
                    as notifications,
                  (select status from office.tasks where id = $1) as status`,
          [id],
        ),
      ).toEqual([{ approvals: 0, acceptances: 0, notifications: 0, status: 'in_progress' }]);
      // Nothing waits at the approval desk for anybody.
      for (const reader of [founder, approver]) {
        const desk = await call(reader, 'GET', '/api/approvals');
        expect(desk.statusCode).toBe(200);
        expect(desk.body).not.toContain(id);
      }
      expect((await close(employee, id)).statusCode).toBe(200);
    });
  });

  describe('Bugün', () => {
    // The routes commit and other requests may be open, so every assertion names its own
    // request by id, and a number is compared with what it was just before.
    async function today(session: string): Promise<Today> {
      const res = await call(session, 'GET', '/api/today');
      expect(res.statusCode, res.body).toBe(200);
      return todaySchema.parse(res.json());
    }

    async function counts(session: string): Promise<SidebarCounts> {
      const res = await call(session, 'GET', '/api/today/counts');
      expect(res.statusCode, res.body).toBe(200);
      return sidebarCountsSchema.parse(res.json());
    }

    const row = (answer: Today, id: string) => answer.expected.find((entry) => entry.id === id);

    it('the requester’s list carries the request that waits for their answer, and the number counts it', async () => {
      const before = {
        employee: await counts(employee),
        founder: await counts(founder),
        approver: await counts(approver),
      };
      const { id } = await asked();

      // The requester: one more item, and no approval among the numbers.
      expect(row(await today(employee), id)).toMatchObject({
        id,
        status: 'awaiting_reply',
        stage: 'awaiting_reply',
        turn: { kind: 'person', userId: ids.employee },
        waitingForMe: true,
      });
      expect(await counts(employee)).toEqual({
        today: before.employee.today + 1,
        approvals: before.employee.approvals,
      });
      // Nothing of the question's text is on Bugün.
      expect((await call(employee, 'GET', '/api/today')).body).not.toContain('hangi kanal');

      // The founder and the approver of the step read the question and are expected to do
      // nothing: the request is not on their list while the requester reads it.
      for (const [reader, was] of [
        [founder, before.founder],
        [approver, before.approver],
      ] as const) {
        expect(row(await today(reader), id)).toBeUndefined();
        expect(await counts(reader)).toEqual(was);
      }
      expect(row(await today(colleague), id)).toBeUndefined();

      // Closed: nothing is expected of anybody.
      expect((await close(employee, id)).statusCode).toBe(200);
      expect(row(await today(employee), id)).toBeUndefined();
      expect(await counts(employee)).toEqual(before.employee);
    });

    it('the founder’s list carries it while the requester cannot read the request', async () => {
      const before = await counts(founder);
      const { id, questionId } = await askedAndLost('Talep sahibi çıkarılan soru projesi');

      // The requester lost the request with the project: 404, and nothing on their list.
      const lost = await call(employee, 'GET', `/api/requests/${id}`);
      expect([lost.statusCode, errorCode(lost)]).toEqual([404, 'not_found']);
      expect(row(await today(employee), id)).toBeUndefined();

      // The founder answers in the requester's place: the page offers the box, and Bugün
      // carries the request.
      expect(await read(founder, id)).toMatchObject({
        status: 'awaiting_reply',
        stage: 'awaiting_reply',
        turn: { kind: 'founder' },
        waitingForMe: true,
        requesterReads: false,
        requester: { userId: ids.employee },
        question: { id: questionId, mayAnswer: true, inPlaceOfRequester: true },
      });
      expect(row(await today(founder), id)).toMatchObject({
        stage: 'awaiting_reply',
        turn: { kind: 'founder' },
        waitingForMe: true,
      });
      expect(await counts(founder)).toEqual({
        today: before.today + 1,
        approvals: before.approvals,
      });

      expect((await close(founder, id, 'Deneme bitti.')).statusCode).toBe(200);
      expect(await counts(founder)).toEqual(before);
    });
  });
});
