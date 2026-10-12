import { COORDINATOR_AGENT_CODE } from '@agent-office/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import { asRole, closePools, inAdminTransaction, noDatabase, type Tx } from './helpers.ts';
import { stepUp } from './step-up.ts';

// An agent asks the requester a question (7 October decision 7; 12 October decisions 3 and 4).
// The database is the one place no path can skip, so the rules are tested here: who asks and how
// often, who answers, who reads, what a run is given, what closes a question, and that a
// company's person or agent never reaches another company's question.
//
// A request is opened and a question answered by a person through the API's role; a run is opened
// and a question asked by the worker's role, and a row one role did not commit is not there for
// the other. So each case runs in one privileged transaction that goes on as the role whose act it
// is (asRole) and is rolled back at the end. The cases where two transactions meet are in
// requests-concurrent.test.ts; the ones about work that waits in restart.test.ts.
//
// The fixtures have two agents in Arma DX: KOR-1 (enabled, the coordinator) and HAF-1 (stopped).
// The cases enable HAF-1 where they need a unit agent.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const colleagueA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };

type Agent = 'KOR-1' | 'HAF-1';

/** The context of a run of the employee's request (the requester is the person). */
function agentRun(
  agentCode: string,
  projectId: string | null = null,
  userId: string | null = ids.employeeA,
  companyId: string = ids.arma,
): ContextInput {
  return { companyId, agentCode, userId, projectId };
}

const RUN = `insert into office.runs
    (company_id, task_id, agent_code, card_version_id, trigger_type, model)
  values (office.ctx_company_id(), $1, $2, $3, 'request', 'test-model') returning id`;
const END_RUN = `update office.runs set status = 'completed', finished_at = now() where id = $1`;
const ASK = 'select office.ask_question($1, $2, $3) as id';
const ANSWER = `select task_id, agent_code, requester_user_id, agent_enabled
  from office.answer_question($1, $2)`;
const LEFT = 'select office.questions_left($1) as n';
const GIVEN = `select id, agent_code, question, answer, answered_in_place
  from office.run_questions($1)`;
const ROUTE = 'select office.route_request($1, $2::jsonb, $3)';
const CORRECT = 'select office.correct_routing($1, $2::jsonb)';
const CLOSE = 'select office.close_request($1, $2)';
const HAF_STEP = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Belongs to memory' }]);
const KOR_STEP = JSON.stringify([{ unit: 'KOR', agent: 'KOR-1', reason: 'By a person' }]);
const SUBMIT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
    payload, basis_type, basis_id, basis_version, involves_money, goes_external)
  values (office.ctx_company_id(), $1, $2, 'HAF-1', 'Result', '{"text": "Output"}', 'task', $1,
    (select version from office.tasks where id = $1), false, false) returning id`;

const NOT_OWN_RUN = {
  code: '42501',
  message: "A question is asked from the agent's own running run on the request",
};

async function one<T extends Record<string, unknown>>(
  tx: Tx,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const [row] = await tx.rows<T>(sql, values);
  if (!row) {
    throw new Error(`No row: ${sql}`);
  }
  return row;
}

/** Goes on as the worker's role with this context. */
async function asWorker(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'worker');
  await tx.setContext(context);
}

/** Goes on as a person, through the API's role. */
async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'app');
  await tx.setContext(context);
}

/** Goes on as the administrator, without a context (to read what the test expects). */
async function asAdmin(tx: Tx): Promise<void> {
  await asRole(tx, null);
  await tx.setContext({});
}

/** A person opens a request, through the API's role. */
async function requestOf(
  tx: Tx,
  person: ContextInput = employeeA,
  project: string | null = null,
): Promise<string> {
  await asPerson(tx, person);
  const row = await one<{ id: string }>(
    tx,
    `insert into office.tasks (company_id, project_id, kind, title, description)
     values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted') returning id`,
    [project],
  );
  return row.id;
}

/** A run of the agent on the request, opened by the worker's role in the requester's name. */
async function openRun(
  tx: Tx,
  task: string,
  agent: Agent,
  project: string | null = null,
  userId: string = ids.employeeA,
): Promise<string> {
  await asWorker(tx, agentRun(agent, project, userId));
  const row = await one<{ id: string }>(tx, RUN, [
    task,
    agent,
    agent === 'KOR-1' ? ids.cardKor : ids.cardHaf,
  ]);
  return row.id;
}

/** The agent opens a run, asks and ends the run, as the runner does in one transaction. */
async function askFrom(
  tx: Tx,
  task: string,
  agent: Agent,
  text = 'Hangi kanal için yazayım?',
  project: string | null = null,
  userId: string = ids.employeeA,
): Promise<{ question: string; run: string }> {
  const run = await openRun(tx, task, agent, project, userId);
  const { id } = await one<{ id: string }>(tx, ASK, [task, run, text]);
  await tx.exec(END_RUN, [run]);
  return { question: id, run };
}

type Answered = {
  task_id: string;
  agent_code: string;
  requester_user_id: string;
  agent_enabled: boolean;
};

async function answerAs(
  tx: Tx,
  person: ContextInput,
  question: string,
  text = 'LinkedIn için.',
): Promise<Answered> {
  await asPerson(tx, person);
  return one<Answered>(tx, ANSWER, [question, text]);
}

async function enableHaf(tx: Tx): Promise<void> {
  await asPerson(tx, founderA);
  await tx.exec(
    `update office.company_agents set status = 'enabled'
     where company_id = $1 and agent_code = 'HAF-1'`,
    [ids.arma],
  );
}

/** The coordinator routes the request to HAF-1 from a run of its own and ends that run. */
async function routeToHaf(tx: Tx, task: string, project: string | null = null): Promise<void> {
  const run = await openRun(tx, task, 'KOR-1', project);
  await tx.rows(ROUTE, [task, HAF_STEP, run]);
  await tx.exec(END_RUN, [run]);
}

/** A request of the employee that the coordinator routed to HAF-1 (opened here). */
async function routedToHaf(tx: Tx, project: string | null = null): Promise<string> {
  await enableHaf(tx);
  const task = await requestOf(tx, employeeA, project);
  await routeToHaf(tx, task, project);
  return task;
}

/** The founder appoints the approver for HAF-1 (the agent's approver wins over the unit's). */
async function appointForHaf(tx: Tx): Promise<void> {
  await asPerson(tx, founderA);
  await tx.exec(
    `insert into office.approvers (company_id, unit_code, agent_code, user_id)
     values ($1, 'HAF', 'HAF-1', $2)`,
    [ids.arma, ids.approverA],
  );
}

type QuestionRow = {
  company_id: string;
  project_id: string | null;
  routing_id: string | null;
  agent_code: string;
  run_id: string;
  requester_user_id: string;
  question: string;
  status: string;
  answer: string | null;
  answered_by_user_id: string | null;
  answered: boolean;
  closed: boolean;
};

/** The question as the administrator reads it. */
async function questionRow(tx: Tx, question: string): Promise<QuestionRow> {
  await asAdmin(tx);
  return one<QuestionRow>(
    tx,
    `select company_id, project_id, routing_id, agent_code, run_id, requester_user_id, question,
            status, answer, answered_by_user_id, answered_at is not null as answered,
            closed_at is not null as closed
     from office.task_questions where id = $1`,
    [question],
  );
}

async function statusOf(tx: Tx, task: string): Promise<string> {
  await asAdmin(tx);
  return (
    await one<{ status: string }>(tx, 'select status from office.tasks where id = $1', [task])
  ).status;
}

async function activeStep(tx: Tx, task: string): Promise<string> {
  await asAdmin(tx);
  return (
    await one<{ id: string }>(
      tx,
      `select id from office.task_routings where task_id = $1 and status = 'active'`,
      [task],
    )
  ).id;
}

/** The audit rows of a question: the event, who, which agent, which run. */
async function questionTrace(tx: Tx, question: string): Promise<Record<string, unknown>[]> {
  await asAdmin(tx);
  return tx.rows(
    `select event, user_id, agent_code, run_id, project_id from office.audit_log
     where record_type = 'task_question' and record_id = $1 order by id`,
    [question],
  );
}

/** How many questions of the request this person reads. */
async function reads(tx: Tx, person: ContextInput, task: string): Promise<number> {
  await asPerson(tx, person);
  return tx.count('task_questions', 'task_id = $1', [task]);
}

async function questionsLeft(tx: Tx, task: string): Promise<number> {
  return (await one<{ n: number }>(tx, LEFT, [task])).n;
}

/** How many questions the request has (as the administrator counts them). */
async function stored(tx: Tx, task: string): Promise<number> {
  await asAdmin(tx);
  return tx.count('task_questions', 'task_id = $1', [task]);
}

type Loss = 'left_project' | 'external' | 'left_company' | 'deactivated';
const LOSSES: readonly Loss[] = ['left_project', 'external', 'left_company', 'deactivated'];

/** The founder takes the request away from the employee, as the panel's four acts do. */
async function lose(tx: Tx, way: Loss): Promise<void> {
  await asRole(tx, 'app');
  if (way === 'left_project') {
    await tx.setContext(founderA);
    expect(
      await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
        ids.projectA,
        ids.employeeA,
      ]),
    ).toBe(1);
    return;
  }
  // A change of a membership or of an account asks for the founder's passkey.
  await stepUp(tx, founderA, 'membership_change', ids.employeeA);
  const changed =
    way === 'external'
      ? await tx.exec(
          `update office.memberships set role = 'external'
           where company_id = $1 and user_id = $2`,
          [ids.arma, ids.employeeA],
        )
      : way === 'left_company'
        ? await tx.exec('delete from office.memberships where company_id = $1 and user_id = $2', [
            ids.arma,
            ids.employeeA,
          ])
        : await tx.exec('update office.users set active = false where id = $1', [ids.employeeA]);
  expect(changed, way).toBe(1);
}

/**
 * The administrator changes a row past the triggers (a state the flow never leaves behind, to
 * show that the function holds the line by itself).
 */
async function pastTriggers(tx: Tx, sql: string, values: unknown[] = []): Promise<void> {
  await asAdmin(tx);
  await tx.exec(`set local session_replication_role = 'replica'`);
  await tx.exec(sql, values);
  await tx.exec(`set local session_replication_role = 'origin'`);
}

describe.skipIf(noDatabase)('an agent asks the requester a question', () => {
  afterAll(closePools);

  it('the coordinator asks from its own running run', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const run = await openRun(tx, task, 'KOR-1');
      const { id: question } = await one<{ id: string }>(tx, ASK, [
        task,
        run,
        '  Hangi kanal için yazayım?  ',
      ]);
      // Nothing of the row is the caller's but the text: the rest is read from the records.
      expect(await questionRow(tx, question)).toEqual({
        company_id: ids.arma,
        project_id: null,
        routing_id: null,
        agent_code: 'KOR-1',
        run_id: run,
        requester_user_id: ids.employeeA,
        question: 'Hangi kanal için yazayım?',
        status: 'open',
        answer: null,
        answered_by_user_id: null,
        answered: false,
        closed: false,
      });
      expect(await statusOf(tx, task)).toBe('awaiting_reply');
      expect(await questionTrace(tx, question)).toEqual([
        {
          event: 'request_question_asked',
          user_id: ids.employeeA,
          agent_code: 'KOR-1',
          run_id: run,
          project_id: null,
        },
      ]);
      // The status change leaves its own trace, written by the task audit trigger.
      expect(
        await tx.count(
          'audit_log',
          `record_type = 'task' and record_id = $1 and event = 'task_status_awaiting_reply'`,
          [task],
        ),
      ).toBe(1);
    });
  });

  it('a unit agent asks from the run of the active step', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await routedToHaf(tx);
      const { question, run } = await askFrom(tx, task, 'HAF-1');
      const step = await activeStep(tx, task);
      expect(await questionRow(tx, question)).toMatchObject({
        routing_id: step,
        agent_code: 'HAF-1',
        run_id: run,
        requester_user_id: ids.employeeA,
        status: 'open',
      });
      expect(await statusOf(tx, task)).toBe('awaiting_reply');
    });
  });

  it('who may not ask', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const other = await requestOf(tx, founderA);
      const run = await openRun(tx, task, 'KOR-1');
      const otherRun = await openRun(tx, other, 'KOR-1', null, ids.founder);

      // A person, through the API's role and through the worker's role with a person alone.
      await asPerson(tx, employeeA);
      expect((await tx.expectError(ASK, [task, run, 'x'])).code).toBe('42501');
      await asPerson(tx, founderA);
      expect((await tx.expectError(ASK, [task, run, 'x'])).code).toBe('42501');
      await asWorker(tx, employeeA);
      expect((await tx.expectError(ASK, [task, run, 'x'])).code).toBe('42501');
      // An agent without a run.
      await asWorker(tx, agentRun('KOR-1'));
      expect((await tx.expectError(ASK, [task, null, 'x'])).code).toBe('42501');
      // Another agent naming the coordinator's run.
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.expectError(ASK, [task, run, 'x'])).toEqual(NOT_OWN_RUN);
      // A run on another request.
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.expectError(ASK, [task, otherRun, 'x'])).toEqual(NOT_OWN_RUN);
      // A context person who is not the one the database resolves for the request: the founder
      // may read every request, and the run still is not theirs.
      await asWorker(tx, agentRun('KOR-1', null, ids.founder));
      expect(await tx.expectError(ASK, [task, run, 'x'])).toEqual(NOT_OWN_RUN);
      // A context of the other company knows no such request.
      await asWorker(tx, agentRun('KOR-1', null, ids.employeeP, ids.pillika));
      expect((await tx.expectError(ASK, [task, run, 'x'])).code).toBe('P0002');
      // A run that is not running any more.
      await asWorker(tx, agentRun('KOR-1'));
      await tx.exec(END_RUN, [run]);
      expect(await tx.expectError(ASK, [task, run, 'x'])).toEqual(NOT_OWN_RUN);

      // The text: empty and too long are refused, 2000 characters are stored.
      const second = await openRun(tx, task, 'KOR-1');
      for (const text of ['', '   ', null, 'x'.repeat(2001)]) {
        expect((await tx.expectError(ASK, [task, second, text])).code, String(text)).toBe('22023');
      }
      const { id: longest } = await one<{ id: string }>(tx, ASK, [task, second, 'x'.repeat(2000)]);
      // A second question in one run: the request waits for an answer already.
      expect(await tx.expectError(ASK, [task, second, 'Bir şey daha?'])).toMatchObject({
        code: '23514',
        message: 'The request takes no question now',
      });
      expect((await questionRow(tx, longest)).question).toHaveLength(2000);
      expect(await stored(tx, task)).toBe(1);
      expect(await stored(tx, other)).toBe(0);
    });
  });

  it('only the agent whose turn it is asks, and only while the request can take a question', async () => {
    await inAdminTransaction(async (tx) => {
      // A unit agent before a routing cannot even open a run; a run row an administrator wrote
      // past the triggers is refused by the function itself.
      const unrouted = await requestOf(tx);
      await pastTriggers(
        tx,
        `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
           model, user_id)
         values ($1, $2, 'HAF-1', $3, 'request', 'test-model', $4)`,
        [ids.arma, unrouted, ids.cardHaf, ids.employeeA],
      );
      const [forged] = await tx.rows<{ id: string }>(
        `select id from office.runs where task_id = $1`,
        [unrouted],
      );
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.expectError(ASK, [unrouted, forged?.id, 'x'])).toMatchObject({
        code: '23514',
        message: 'Only the coordinator asks before a request is routed',
      });

      // An agent whose step was replaced: by a step of the same agent, and by another agent's.
      const task = await routedToHaf(tx);
      const run = await openRun(tx, task, 'HAF-1');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [task, HAF_STEP]);
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.expectError(ASK, [task, run, 'x'])).toMatchObject({
        code: '23514',
        message: 'The request is not routed to this run',
      });
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [task, KOR_STEP]);
      await asWorker(tx, agentRun('HAF-1'));
      expect((await tx.expectError(ASK, [task, run, 'x'])).code).toBe('23514');
      // The coordinator no longer asks as coordinator once the request was routed: its old run
      // was not opened for the step.
      const waiting = await routedToHaf(tx);
      await pastTriggers(
        tx,
        `update office.runs set status = 'running', finished_at = null
         where task_id = $1 and agent_code = 'KOR-1'`,
        [waiting],
      );
      const [coordinatorRun] = await tx.rows<{ id: string }>(
        `select id from office.runs where task_id = $1 and agent_code = 'KOR-1'`,
        [waiting],
      );
      await asWorker(tx, agentRun('KOR-1'));
      expect((await tx.expectError(ASK, [waiting, coordinatorRun?.id, 'x'])).code).toBe('23514');

      // A request that waits for a decision takes no question.
      const hafRun = await openRun(tx, waiting, 'HAF-1');
      await tx.rows(SUBMIT, [waiting, hafRun]);
      expect(await statusOf(tx, waiting)).toBe('awaiting_approval');
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.expectError(ASK, [waiting, hafRun, 'x'])).toMatchObject({
        code: '23514',
        message: 'The request takes no question now',
      });

      // A closed request takes none either.
      const closed = await routedToHaf(tx);
      const lateRun = await openRun(tx, closed, 'HAF-1');
      await asPerson(tx, employeeA);
      await tx.rows(CLOSE, [closed, null]);
      await asWorker(tx, agentRun('HAF-1'));
      expect((await tx.expectError(ASK, [closed, lateRun, 'x'])).code).toBe('23514');

      for (const request of [unrouted, task, waiting, closed]) {
        expect(await stored(tx, request), request).toBe(0);
      }
    });
  });

  it('one question per request and agent, two for the coordinator', async () => {
    await inAdminTransaction(async (tx) => {
      await enableHaf(tx);
      const task = await requestOf(tx);
      await asWorker(tx, agentRun('KOR-1'));
      expect(await questionsLeft(tx, task)).toBe(2);
      const first = await askFrom(tx, task, 'KOR-1');
      expect(await questionsLeft(tx, task)).toBe(1);
      await answerAs(tx, employeeA, first.question);
      const second = await askFrom(tx, task, 'KOR-1', 'Hangi ürün için?');
      expect(await questionsLeft(tx, task)).toBe(0);
      await answerAs(tx, employeeA, second.question);
      // The third is refused by the database, whatever the runner offered.
      const third = await openRun(tx, task, 'KOR-1');
      expect(await questionsLeft(tx, task)).toBe(0);
      expect(await tx.expectError(ASK, [task, third, 'Bir şey daha?'])).toMatchObject({
        code: '54000',
        message: 'This agent has asked as often as it may on this request',
      });
      expect(await statusOf(tx, task)).toBe('in_progress');

      // The unit agent has one question of its own, whatever the coordinator asked.
      await asWorker(tx, agentRun('KOR-1'));
      await tx.rows(ROUTE, [task, HAF_STEP, third]);
      await tx.exec(END_RUN, [third]);
      await asWorker(tx, agentRun('HAF-1'));
      expect(await questionsLeft(tx, task)).toBe(1);
      const own = await askFrom(tx, task, 'HAF-1');
      expect(await questionsLeft(tx, task)).toBe(0);
      await answerAs(tx, employeeA, own.question);
      const again = await openRun(tx, task, 'HAF-1');
      expect((await tx.expectError(ASK, [task, again, 'Bir şey daha?'])).code).toBe('54000');
      expect(await stored(tx, task)).toBe(3);

      // A question that was closed without an answer counts, and so does one of an earlier step:
      // the one question is spent for the whole life of the request.
      const rerouted = await routedToHaf(tx);
      const spent = await askFrom(tx, rerouted, 'HAF-1');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [rerouted, HAF_STEP]);
      expect((await questionRow(tx, spent.question)).status).toBe('closed');
      const newStep = await openRun(tx, rerouted, 'HAF-1');
      expect(await questionsLeft(tx, rerouted)).toBe(0);
      expect((await tx.expectError(ASK, [rerouted, newStep, 'Yeniden sorayım.'])).code).toBe(
        '54000',
      );
    });
  });

  it('questions_left answers only the run of the request, in the name the database resolves', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      await asWorker(tx, agentRun('KOR-1'));
      expect(await questionsLeft(tx, task)).toBe(2);
      // A person, through either role.
      await asPerson(tx, employeeA);
      expect(await questionsLeft(tx, task)).toBe(0);
      await asPerson(tx, founderA);
      expect(await questionsLeft(tx, task)).toBe(0);
      await asWorker(tx, employeeA);
      expect(await questionsLeft(tx, task)).toBe(0);
      // A caller whose person is not the resolved one, and a context without a person.
      await asWorker(tx, agentRun('KOR-1', null, ids.founder));
      expect(await questionsLeft(tx, task)).toBe(0);
      await asWorker(tx, agentRun('KOR-1', null, null));
      expect(await questionsLeft(tx, task)).toBe(0);
      // A request of another company, and no context at all.
      await asWorker(tx, agentRun('KOR-1', null, ids.employeeP, ids.pillika));
      expect(await questionsLeft(tx, task)).toBe(0);
      await asWorker(tx, agentRun('KOR-1', null, ids.founder, ids.pillika));
      expect(await questionsLeft(tx, task)).toBe(0);
      await asWorker(tx, {});
      expect(await questionsLeft(tx, task)).toBe(0);
      // A task between people is no request.
      await asWorker(tx, agentRun('KOR-1', null, ids.founder));
      expect(await questionsLeft(tx, ids.taskA)).toBe(0);
    });
  });

  it('the limit is one number in one function', async () => {
    // docs/SONRA.md S-a: the coordinator's number awaits the founder (12 October decision 4).
    // When the founder decides, the function and this assertion change together.
    await inAdminTransaction(async (tx) => {
      expect(
        await tx.rows(
          `select office.question_limit($1) as coordinator, office.question_limit('HAF-1') as unit,
                  office.question_limit('SOS-2') as other`,
          [COORDINATOR_AGENT_CODE],
        ),
      ).toEqual([{ coordinator: 2, unit: 1, other: 1 }]);
      // Not the application's to call: the runner asks how many are left, never the limit.
      for (const role of ['app', 'worker'] as const) {
        await asRole(tx, role);
        expect((await tx.expectError(`select office.question_limit('KOR-1')`)).code, role).toBe(
          '42501',
        );
      }
    });
  });

  it('the requester answers', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const { question } = await askFrom(tx, task, 'KOR-1');
      expect(await answerAs(tx, employeeA, question, '  LinkedIn için.  ')).toEqual({
        task_id: task,
        agent_code: 'KOR-1',
        requester_user_id: ids.employeeA,
        agent_enabled: true,
      });
      expect(await questionRow(tx, question)).toMatchObject({
        status: 'answered',
        answer: 'LinkedIn için.',
        answered_by_user_id: ids.employeeA,
        answered: true,
        closed: false,
      });
      expect(await statusOf(tx, task)).toBe('in_progress');
      expect((await questionTrace(tx, question)).slice(1)).toEqual([
        {
          event: 'request_question_answered',
          user_id: ids.employeeA,
          agent_code: null,
          run_id: null,
          project_id: null,
        },
      ]);

      // The answer names the agent that asked and says whether it is open in the company now.
      const routed = await routedToHaf(tx);
      const asked = await askFrom(tx, routed, 'HAF-1');
      await asPerson(tx, founderA);
      await tx.exec(
        `update office.company_agents set status = 'stopped'
         where company_id = $1 and agent_code = 'HAF-1'`,
        [ids.arma],
      );
      expect(await answerAs(tx, employeeA, asked.question)).toEqual({
        task_id: routed,
        agent_code: 'HAF-1',
        requester_user_id: ids.employeeA,
        agent_enabled: false,
      });
      // The answer is stored whatever holds the work.
      expect(await statusOf(tx, routed)).toBe('in_progress');
      expect((await questionRow(tx, asked.question)).status).toBe('answered');
    });
  });

  it('who may not answer', async () => {
    await inAdminTransaction(async (tx) => {
      await appointForHaf(tx);
      const task = await routedToHaf(tx);
      const { question } = await askFrom(tx, task, 'HAF-1');

      // Readers of the question who are not the one who answers: the founder while the requester
      // reads the request, and the appointed approver of the step.
      for (const person of [founderA, approverA]) {
        await asPerson(tx, person);
        expect(await tx.expectError(ANSWER, [question, 'x']), person.userId ?? '').toMatchObject({
          code: '42501',
        });
      }
      // Another employee reads the request and not the question.
      await asPerson(tx, colleagueA);
      expect((await tx.expectError(ANSWER, [question, 'x'])).code).toBe('42501');
      // An agent run, in whose name ever and through either role.
      await asPerson(tx, agentRun('HAF-1'));
      expect((await tx.expectError(ANSWER, [question, 'x'])).code).toBe('42501');
      // The worker's role has no privilege on the function, whatever person its context names.
      for (const context of [employeeA, agentRun('HAF-1'), {}]) {
        await asWorker(tx, context);
        expect((await tx.expectError(ANSWER, [question, 'x'])).code).toBe('42501');
      }
      // An external person, a context of the other company and no context: no such question.
      for (const context of [
        externalA,
        founderP,
        { companyId: ids.pillika, userId: ids.employeeA },
      ]) {
        await asPerson(tx, context);
        expect((await tx.expectError(ANSWER, [question, 'x'])).code).toBe('P0002');
      }
      await asPerson(tx, {});
      expect((await tx.expectError(ANSWER, [question, 'x'])).code).toBe('42501');
      // No such question at all.
      await asPerson(tx, employeeA);
      expect((await tx.expectError(ANSWER, [ids.requestA, 'x'])).code).toBe('P0002');

      // The text.
      for (const text of ['', '    ', null, 'x'.repeat(10_001)]) {
        expect((await tx.expectError(ANSWER, [question, text])).code, String(text)).toBe('22023');
      }
      expect((await questionRow(tx, question)).status).toBe('open');
      await answerAs(tx, employeeA, question, 'x'.repeat(10_000));

      // An answer is given once.
      await asPerson(tx, employeeA);
      expect(await tx.expectError(ANSWER, [question, 'Başka bir yanıt'])).toMatchObject({
        code: '23514',
        message: 'The question is not open',
      });
      expect((await questionRow(tx, question)).answer).toHaveLength(10_000);

      // A question a new routing closed, and one a cancel closed with its request.
      const rerouted = await requestOf(tx);
      const closedByRouting = await askFrom(tx, rerouted, 'KOR-1');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [rerouted, KOR_STEP]);
      const cancelled = await requestOf(tx);
      const closedByCancel = await askFrom(tx, cancelled, 'KOR-1');
      await asPerson(tx, employeeA);
      await tx.rows(CLOSE, [cancelled, null]);
      for (const closed of [closedByRouting.question, closedByCancel.question]) {
        expect((await tx.expectError(ANSWER, [closed, 'Geç kaldım'])).code).toBe('23514');
      }
    });
  });

  it('the founder answers in the place of a requester who cannot read the request', async () => {
    for (const way of LOSSES) {
      await inAdminTransaction(async (tx) => {
        const task = await requestOf(tx, employeeA, ids.projectA);
        const { question } = await askFrom(tx, task, 'KOR-1', 'Hangi kanal?', ids.projectA);
        // While the requester reads the request the founder does not answer.
        await asPerson(tx, founderA);
        expect((await tx.expectError(ANSWER, [question, 'x'])).code, way).toBe('42501');

        await lose(tx, way);
        // The requester's own try: the question does not exist for them any more.
        await asPerson(tx, employeeA);
        expect((await tx.expectError(ANSWER, [question, 'x'])).code, way).toBe('P0002');
        expect(await reads(tx, employeeA, task), way).toBe(0);
        // Nobody else stands in: an insider outside the project does not read the request.
        await asPerson(tx, approverA);
        expect((await tx.expectError(ANSWER, [question, 'x'])).code, way).toBe('P0002');

        // The job still names the requester: in whose name the run goes is the database's
        // answer when the run opens (8 October decision 45).
        expect(await answerAs(tx, founderA, question, 'Kurucunun yanıtı'), way).toEqual({
          task_id: task,
          agent_code: 'KOR-1',
          requester_user_id: ids.employeeA,
          agent_enabled: true,
        });
        expect(await questionRow(tx, question), way).toMatchObject({
          status: 'answered',
          answer: 'Kurucunun yanıtı',
          answered_by_user_id: ids.founder,
          requester_user_id: ids.employeeA,
        });
        expect((await questionTrace(tx, question)).at(-1), way).toMatchObject({
          event: 'request_question_answered',
          user_id: ids.founder,
        });
        // The next run goes in the founder's name and is told that somebody answered in the
        // requester's place.
        const next = await openRun(tx, task, 'KOR-1', ids.projectA, ids.founder);
        expect(await tx.rows(GIVEN, [next]), way).toEqual([
          {
            id: question,
            agent_code: 'KOR-1',
            question: 'Hangi kanal?',
            answer: 'Kurucunun yanıtı',
            answered_in_place: true,
          },
        ]);
      });
    }
  });

  it('who reads a question: the requester, the founder, the approver of the request', async () => {
    await inAdminTransaction(async (tx) => {
      await appointForHaf(tx);
      await enableHaf(tx);
      const task = await requestOf(tx);
      // Before a routing (the coordinator asked): the requester and the founder.
      const first = await askFrom(tx, task, 'KOR-1');
      expect(await reads(tx, employeeA, task)).toBe(1);
      expect(await reads(tx, founderA, task)).toBe(1);
      for (const other of [approverA, colleagueA, externalA]) {
        expect(await reads(tx, other, task), other.userId ?? '').toBe(0);
      }
      // Another company's context, a member of no company here, and no context.
      expect(await reads(tx, founderP, task)).toBe(0);
      expect(await reads(tx, { companyId: ids.arma, userId: ids.employeeP }, task)).toBe(0);
      expect(await reads(tx, { userId: ids.founder }, task)).toBe(0);
      expect(await reads(tx, {}, task)).toBe(0);
      // An agent context through the API's role reads none either.
      expect(await reads(tx, agentRun('KOR-1'), task)).toBe(0);

      // Once the request is routed, the approver of the active step reads the coordinator's
      // question too, and the unit agent's own.
      await answerAs(tx, employeeA, first.question);
      await routeToHaf(tx, task);
      expect(await reads(tx, approverA, task)).toBe(1);
      const second = await askFrom(tx, task, 'HAF-1');
      expect(await reads(tx, approverA, task)).toBe(2);
      expect(await reads(tx, employeeA, task)).toBe(2);
      expect(await reads(tx, founderA, task)).toBe(2);
      expect(await reads(tx, colleagueA, task)).toBe(0);
      expect(await reads(tx, externalA, task)).toBe(0);

      // The approver still reads after the step was done ...
      await answerAs(tx, employeeA, second.question);
      const run = await openRun(tx, task, 'HAF-1');
      const { id: approval } = await one<{ id: string }>(tx, SUBMIT, [task, run]);
      await tx.exec(END_RUN, [run]);
      await asPerson(tx, approverA);
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]),
      ).toBe(1);
      expect(await reads(tx, approverA, task)).toBe(2);

      // ... and after it was cancelled with its request.
      const cancelled = await routedToHaf(tx);
      await askFrom(tx, cancelled, 'HAF-1');
      await asPerson(tx, employeeA);
      await tx.rows(CLOSE, [cancelled, null]);
      expect(await reads(tx, approverA, cancelled)).toBe(1);
      expect(await reads(tx, employeeA, cancelled)).toBe(1);

      // The appointment counts only while the person holds the approval right.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.memberships set can_approve = false where company_id = $1 and user_id = $2`,
        [ids.arma, ids.approverA],
      );
      expect(await reads(tx, approverA, task)).toBe(0);
      expect(await reads(tx, approverA, cancelled)).toBe(0);
    });
  });

  it('project visibility', async () => {
    await inAdminTransaction(async (tx) => {
      // A second member of the project, who is neither the requester nor the approver.
      await asPerson(tx, founderA);
      await tx.exec(
        `insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)`,
        [ids.arma, ids.projectA, ids.sharedEmployee],
      );
      const task = await requestOf(tx, employeeA, ids.projectA);
      const { question } = await askFrom(tx, task, 'KOR-1', 'Hangi kanal?', ids.projectA);
      expect(await questionRow(tx, question)).toMatchObject({ project_id: ids.projectA });
      expect((await questionTrace(tx, question))[0]).toMatchObject({ project_id: ids.projectA });

      const readsRequest = async (person: ContextInput): Promise<number> => {
        await asPerson(tx, person);
        return tx.count('tasks', 'id = $1', [task]);
      };
      const facts = async (person: ContextInput): Promise<number> => {
        await asPerson(tx, person);
        return (
          await tx.rows('select task_id from office.request_flow_facts(array[$1::uuid])', [task])
        ).length;
      };
      // The requester and the founder read the question.
      expect(await reads(tx, employeeA, task)).toBe(1);
      expect(await reads(tx, founderA, task)).toBe(1);
      // The other member reads the request and its facts, and no text of the question.
      expect(await readsRequest(colleagueA)).toBe(1);
      expect(await facts(colleagueA)).toBe(1);
      expect(await reads(tx, colleagueA, task)).toBe(0);
      // An insider outside the project reads neither the request, a fact nor the question, and
      // cannot answer.
      expect(await readsRequest(approverA)).toBe(0);
      expect(await facts(approverA)).toBe(0);
      expect(await reads(tx, approverA, task)).toBe(0);
      await asPerson(tx, approverA);
      expect((await tx.expectError(ANSWER, [question, 'x'])).code).toBe('P0002');
      // A person context that names another project, or none, changes nothing for the requester:
      // the row rule of a person reads the membership, not the context's project.
      expect(await reads(tx, { ...employeeA, projectId: ids.projectA }, task)).toBe(1);
    });
  });

  it('the worker’s role reads and writes nothing of the table', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const { question } = await askFrom(tx, task, 'KOR-1');
      const statements = [
        'select 1 from office.task_questions',
        `insert into office.task_questions
           (company_id, task_id, agent_code, run_id, requester_user_id, question)
         values ('${ids.arma}', '${ids.requestA}', 'KOR-1', '${ids.runA}', '${ids.employeeA}', 'x')`,
        `update office.task_questions set status = 'answered', answer = 'x',
           answered_by_user_id = '${ids.employeeA}', answered_at = now()`,
        `update office.task_questions set status = 'closed', closed_at = now()`,
        'delete from office.task_questions',
      ];
      for (const context of [agentRun('KOR-1'), employeeA, founderA, {}]) {
        await asWorker(tx, context);
        for (const sql of statements) {
          expect((await tx.expectError(sql)).code, sql).toBe('42501');
        }
      }
      // A person reads through the API's role and writes nothing by hand, either.
      for (const person of [employeeA, founderA]) {
        await asPerson(tx, person);
        for (const sql of statements.slice(1)) {
          expect((await tx.expectError(sql)).code, sql).toBe('42501');
        }
      }
      expect((await questionRow(tx, question)).status).toBe('open');
    });
  });

  it('a run is given the answered questions of its own request and of no other', async () => {
    await inAdminTransaction(async (tx) => {
      await enableHaf(tx);
      const task = await requestOf(tx);
      const first = await askFrom(tx, task, 'KOR-1', 'Hangi kanal?');
      await answerAs(tx, employeeA, first.question, 'LinkedIn');
      await routeToHaf(tx, task);
      const second = await askFrom(tx, task, 'HAF-1', 'Hangi ürün?');
      // Every row of one transaction carries the same moment: the coordinator's question is
      // made the older one, as it is when the two are asked in transactions of their own.
      await pastTriggers(
        tx,
        `update office.task_questions set created_at = created_at - interval '1 minute'
         where id = $1`,
        [first.question],
      );
      await answerAs(tx, employeeA, second.question, 'Şarj istasyonu');

      const run = await openRun(tx, task, 'HAF-1');
      // Its own and the coordinator's, oldest first, with who asked.
      expect(await tx.rows(GIVEN, [run])).toEqual([
        {
          id: first.question,
          agent_code: 'KOR-1',
          question: 'Hangi kanal?',
          answer: 'LinkedIn',
          answered_in_place: false,
        },
        {
          id: second.question,
          agent_code: 'HAF-1',
          question: 'Hangi ürün?',
          answer: 'Şarj istasyonu',
          answered_in_place: false,
        },
      ]);

      // Another requester's request with an answered question and a running run of its own.
      const other = await requestOf(tx, founderA);
      const foreign = await askFrom(tx, other, 'KOR-1', 'Başka soru', null, ids.founder);
      await answerAs(tx, founderA, foreign.question, 'Başka yanıt');
      const otherRun = await openRun(tx, other, 'KOR-1', null, ids.founder);
      expect(await tx.rows(GIVEN, [otherRun])).toHaveLength(1);

      // Nothing for: a run of another request (another person's), a run of another agent, a
      // context person who is not the run's, a person, another company, no context.
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.rows(GIVEN, [otherRun])).toEqual([]);
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asWorker(tx, agentRun('HAF-1', null, ids.founder));
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asWorker(tx, agentRun('HAF-1', null, null));
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asWorker(tx, employeeA);
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asPerson(tx, employeeA);
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asPerson(tx, founderA);
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asWorker(tx, agentRun('HAF-1', null, ids.employeeA, ids.pillika));
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      await asWorker(tx, {});
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
      // Nothing for a run that is not running any more.
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.rows(GIVEN, [run])).toHaveLength(2);
      await tx.exec(END_RUN, [run]);
      expect(await tx.rows(GIVEN, [run])).toEqual([]);
    });
  });

  it('an open and a closed question are not given to a run', async () => {
    await inAdminTransaction(async (tx) => {
      await enableHaf(tx);
      const task = await requestOf(tx);
      const first = await askFrom(tx, task, 'KOR-1', 'Hangi kanal?');
      await answerAs(tx, employeeA, first.question, 'LinkedIn');
      await routeToHaf(tx, task);
      // The run that asks is not given its own open question.
      const asking = await openRun(tx, task, 'HAF-1');
      await tx.rows(ASK, [task, asking, 'Hangi ürün?']);
      expect((await tx.rows<{ id: string }>(GIVEN, [asking])).map((row) => row.id)).toEqual([
        first.question,
      ]);
      await tx.exec(END_RUN, [asking]);
      // A new routing closes that question: the run of the new step is given the answered one.
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [task, HAF_STEP]);
      const next = await openRun(tx, task, 'HAF-1');
      expect((await tx.rows<{ id: string }>(GIVEN, [next])).map((row) => row.id)).toEqual([
        first.question,
      ]);
    });
  });

  it('an agent run without the project context of the request reaches nothing of its questions', async () => {
    await inAdminTransaction(async (tx) => {
      // A request inside a project, with an answered question and a running run.
      const inside = await requestOf(tx, employeeA, ids.projectA);
      const first = await askFrom(tx, inside, 'KOR-1', 'Hangi kanal?', ids.projectA);
      await answerAs(tx, employeeA, first.question);
      const run = await openRun(tx, inside, 'KOR-1', ids.projectA);
      // The right company, agent and person, without the project and with another project.
      for (const project of [null, ids.projectANoAi]) {
        await asWorker(tx, agentRun('KOR-1', project));
        expect(await tx.rows(GIVEN, [run]), String(project)).toEqual([]);
        expect(await questionsLeft(tx, inside), String(project)).toBe(0);
        expect(await tx.expectError(ASK, [inside, run, 'x']), String(project)).toEqual({
          code: '42501',
          message: 'A question is asked in the project context of the request',
        });
      }
      expect(await stored(tx, inside)).toBe(1);
      // With the project all three answer.
      await asWorker(tx, agentRun('KOR-1', ids.projectA));
      expect(await tx.rows(GIVEN, [run])).toHaveLength(1);
      expect(await questionsLeft(tx, inside)).toBe(1);
      expect(await tx.rows(ASK, [inside, run, 'Hangi ürün?'])).toHaveLength(1);
      expect(await stored(tx, inside)).toBe(2);

      // A request without a project: a context that names some project is not its run's.
      const outside = await requestOf(tx);
      const asked = await askFrom(tx, outside, 'KOR-1');
      await answerAs(tx, employeeA, asked.question);
      const outsideRun = await openRun(tx, outside, 'KOR-1');
      await asWorker(tx, agentRun('KOR-1', ids.projectA));
      expect(await tx.rows(GIVEN, [outsideRun])).toEqual([]);
      expect(await questionsLeft(tx, outside)).toBe(0);
      expect((await tx.expectError(ASK, [outside, outsideRun, 'x'])).code).toBe('42501');
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.rows(GIVEN, [outsideRun])).toHaveLength(1);
      expect(await questionsLeft(tx, outside)).toBe(1);
      expect(await stored(tx, outside)).toBe(1);
    });
  });

  it('no question is stored while agents may not work in the project', async () => {
    // Rule 12. A closed permission stops every open run of the project, so the runner cannot
    // have a running run there; the run is left running by the administrator, past the trigger,
    // to show that the function refuses by itself.
    for (const [name, close, open] of [
      [
        'project',
        'update office.projects set ai_allowed = false where id = $1',
        'update office.projects set ai_allowed = true where id = $1',
      ],
      [
        'customer',
        'update office.customers set ai_allowed = false where id = $2',
        'update office.customers set ai_allowed = true where id = $2',
      ],
    ] as const) {
      await inAdminTransaction(async (tx) => {
        const task = await requestOf(tx, employeeA, ids.projectA);
        const run = await openRun(tx, task, 'KOR-1', ids.projectA);
        // The statements name one of the two ids each; the other is cast so that both bind.
        const both = (sql: string): string =>
          `${sql} and $1::uuid is not null and $2::uuid is not null`;
        await pastTriggers(tx, both(close), [ids.projectA, ids.customerA]);
        await asWorker(tx, agentRun('KOR-1', ids.projectA));
        expect(await tx.expectError(ASK, [task, run, 'Hangi kanal?']), name).toEqual({
          code: '23514',
          message: 'Agents do not work in this project now',
        });
        expect(await stored(tx, task), name).toBe(0);
        // The run put the request in progress; the refused question changed nothing.
        expect(await statusOf(tx, task), name).toBe('in_progress');
        // With the permission back the same run asks.
        await pastTriggers(tx, both(open), [ids.projectA, ids.customerA]);
        await asWorker(tx, agentRun('KOR-1', ids.projectA));
        expect(await tx.rows(ASK, [task, run, 'Hangi kanal?']), name).toHaveLength(1);
      });
    }
  });

  it('no run opens while a question is open', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const { question } = await askFrom(tx, task, 'KOR-1');
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual({
        code: '23514',
        message: 'The request waits for an answer',
      });
      await answerAs(tx, employeeA, question);
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.rows(RUN, [task, 'KOR-1', ids.cardKor])).toHaveLength(1);
      // A run without a task, and one on a task between people, are not held.
      await asWorker(tx, agentRun('KOR-1', null, ids.founder));
      expect(await tx.rows(RUN, [null, 'KOR-1', ids.cardKor])).toHaveLength(1);
      expect(await tx.rows(RUN, [ids.taskA, 'KOR-1', ids.cardKor])).toHaveLength(1);
    });
  });

  it('a new routing, a cancel and a stop close an open question', async () => {
    await inAdminTransaction(async (tx) => {
      const closedTrace = (userId: string): Record<string, unknown> => ({
        event: 'request_question_closed',
        user_id: userId,
        agent_code: null,
        run_id: null,
        project_id: null,
      });
      // A new routing by a person: the request goes on without the answer.
      const rerouted = await requestOf(tx);
      const byRouting = await askFrom(tx, rerouted, 'KOR-1');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [rerouted, KOR_STEP]);
      expect(await questionRow(tx, byRouting.question)).toMatchObject({
        status: 'closed',
        closed: true,
        answer: null,
        answered: false,
      });
      expect((await questionTrace(tx, byRouting.question)).slice(1)).toEqual([
        closedTrace(ids.founder),
      ]);
      expect(await statusOf(tx, rerouted)).toBe('in_progress');

      // A cancel by the requester.
      const cancelled = await requestOf(tx);
      const byCancel = await askFrom(tx, cancelled, 'KOR-1');
      await asPerson(tx, employeeA);
      await tx.rows(CLOSE, [cancelled, null]);
      expect(await questionRow(tx, byCancel.question)).toMatchObject({
        status: 'closed',
        closed: true,
      });
      expect((await questionTrace(tx, byCancel.question)).slice(1)).toEqual([
        closedTrace(ids.employeeA),
      ]);
      expect(await statusOf(tx, cancelled)).toBe('cancelled');

      // A stop by the founder.
      const stopped = await requestOf(tx);
      const byStop = await askFrom(tx, stopped, 'KOR-1');
      await asPerson(tx, founderA);
      await tx.rows(CLOSE, [stopped, 'Artık gerekmiyor']);
      expect(await questionRow(tx, byStop.question)).toMatchObject({
        status: 'closed',
        closed: true,
      });
      expect((await questionTrace(tx, byStop.question)).slice(1)).toEqual([
        closedTrace(ids.founder),
      ]);
      expect(await statusOf(tx, stopped)).toBe('cancelled');

      // An answered question is touched by neither: it stays as it was answered.
      const answered = await requestOf(tx);
      const kept = await askFrom(tx, answered, 'KOR-1');
      await answerAs(tx, employeeA, kept.question, 'Yanıt');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [answered, KOR_STEP]);
      await asPerson(tx, employeeA);
      await tx.rows(CLOSE, [answered, null]);
      expect(await questionRow(tx, kept.question)).toMatchObject({
        status: 'answered',
        answer: 'Yanıt',
        closed: false,
      });
      expect((await questionTrace(tx, kept.question)).map((row) => row.event)).toEqual([
        'request_question_asked',
        'request_question_answered',
      ]);
    });
  });

  it('a question is no approval and no notification', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await routedToHaf(tx);
      const counts = async (): Promise<Record<string, number>> => {
        await asAdmin(tx);
        return {
          approvals: await tx.count('approvals', 'task_id = $1', [task]),
          requesterApprovals: await tx.count('requester_approvals', 'task_id = $1', [task]),
          notifications: await tx.count('notifications', `record_id = $1`, [task]),
          toolCalls: await tx.count(
            'tool_calls',
            'run_id in (select id from office.runs where task_id = $1)',
            [task],
          ),
        };
      };
      const before = await counts();
      expect(before).toEqual({
        approvals: 0,
        requesterApprovals: 0,
        notifications: 0,
        toolCalls: 0,
      });
      const { question } = await askFrom(tx, task, 'HAF-1');
      expect(await counts()).toEqual(before);
      await answerAs(tx, employeeA, question);
      expect(await counts()).toEqual(before);
      // And never "awaiting approval": an answer releases nothing.
      expect(await statusOf(tx, task)).toBe('in_progress');
      // Nor does a question that is closed tell anybody anything.
      const closed = await requestOf(tx);
      await askFrom(tx, closed, 'KOR-1');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [closed, KOR_STEP]);
      await asAdmin(tx);
      expect(await tx.count('notifications', 'record_id = $1', [closed])).toBe(0);
    });
  });

  it('an answered or closed question never changes', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const open = await askFrom(tx, task, 'KOR-1');
      await asAdmin(tx);
      // The text of an open question, and whom it is for, are fixed for every role.
      for (const change of [
        `question = 'Başka bir soru'`,
        `requester_user_id = '${ids.founder}'`,
        `agent_code = 'HAF-1'`,
        `task_id = '${ids.requestA}'`,
      ]) {
        expect(
          (
            await tx.expectError(`update office.task_questions set ${change} where id = $1`, [
              open.question,
            ])
          ).code,
          change,
        ).toBe('23514');
      }
      // The row says one thing: an answer without who and when is no answer.
      expect(
        (
          await tx.expectError(
            `update office.task_questions set status = 'answered', answer = 'x' where id = $1`,
            [open.question],
          )
        ).code,
      ).toBe('23514');
      await answerAs(tx, employeeA, open.question, 'Yanıt');
      await asAdmin(tx);
      for (const change of [
        `answer = 'Değişti'`,
        `answered_by_user_id = '${ids.founder}'`,
        `status = 'closed', closed_at = now(), answer = null, answered_by_user_id = null,
           answered_at = null`,
        `status = 'open', answer = null, answered_by_user_id = null, answered_at = null`,
      ]) {
        expect(
          await tx.expectError(`update office.task_questions set ${change} where id = $1`, [
            open.question,
          ]),
          change,
        ).toEqual({
          code: '23514',
          message: 'A question that was answered or closed cannot be changed',
        });
      }
      // A closed one is as settled as an answered one.
      const second = await askFrom(tx, task, 'KOR-1');
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [task, KOR_STEP]);
      await asAdmin(tx);
      expect(
        (
          await tx.expectError(
            `update office.task_questions set status = 'open', closed_at = null where id = $1`,
            [second.question],
          )
        ).code,
      ).toBe('23514');
      // One question of a request is open at a time, whoever writes the row.
      const third = await requestOf(tx);
      const asked = await askFrom(tx, third, 'KOR-1');
      await asAdmin(tx);
      expect(
        (
          await tx.expectError(
            `insert into office.task_questions
               (company_id, task_id, agent_code, run_id, requester_user_id, question)
             select company_id, task_id, agent_code, $2, requester_user_id, 'İkinci açık soru'
             from office.task_questions where id = $1`,
            [asked.question, ids.runA],
          )
        ).code,
      ).toBe('23505');
    });
  });

  it('the three audit events are the flow’s alone', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx);
      const { question } = await askFrom(tx, task, 'KOR-1');
      const write = `insert into office.audit_log (company_id, event, record_type, record_id)
        values ($1, $2, 'task_question', $3)`;
      for (const event of [
        'request_question_asked',
        'request_question_answered',
        'request_question_closed',
      ]) {
        for (const person of [employeeA, founderA]) {
          await asPerson(tx, person);
          expect((await tx.expectError(write, [ids.arma, event, question])).code, event).toBe(
            '42501',
          );
        }
        for (const context of [agentRun('KOR-1'), agentRun('KOR-1', null, ids.founder)]) {
          await asWorker(tx, context);
          expect((await tx.expectError(write, [ids.arma, event, question])).code, event).toBe(
            '42501',
          );
        }
      }
      expect((await questionTrace(tx, question)).map((row) => row.event)).toEqual([
        'request_question_asked',
      ]);
    });
  });

  it('the flow facts say that a question waits and when it was answered, never what', async () => {
    await inAdminTransaction(async (tx) => {
      await enableHaf(tx);
      const task = await requestOf(tx);
      const facts = async (person: ContextInput): Promise<Record<string, unknown>[]> => {
        await asPerson(tx, person);
        return tx.rows('select * from office.request_flow_facts(array[$1::uuid])', [task]);
      };
      const said = async (person: ContextInput): Promise<unknown> => {
        const [row] = await facts(person);
        return row ? [row.open_question, row.answered_at] : null;
      };
      const answeredAt = async (question: string): Promise<unknown> => {
        await asAdmin(tx);
        const [row] = await tx.rows('select answered_at from office.task_questions where id = $1', [
          question,
        ]);
        return row?.answered_at;
      };
      expect(await said(employeeA)).toEqual([false, null]);

      // The coordinator asks: every reader of the request learns that a question waits, also
      // the employee who may not read it.
      const first = await askFrom(tx, task, 'KOR-1', 'Hangi kanal için yazayım?');
      for (const reader of [employeeA, founderA, colleagueA, approverA]) {
        expect(await said(reader), reader.userId ?? '').toEqual([true, null]);
      }
      expect(await reads(tx, colleagueA, task)).toBe(0);
      // Nobody who cannot read the request, and no agent run.
      for (const other of [externalA, founderP, agentRun('KOR-1'), {}]) {
        expect(await facts(other)).toEqual([]);
      }
      await asWorker(tx, agentRun('KOR-1'));
      expect(
        (await tx.expectError('select 1 from office.request_flow_facts(array[$1::uuid])', [task]))
          .code,
      ).toBe('42501');

      // The answer to the coordinator calls for the coordinator's work.
      await answerAs(tx, employeeA, first.question, 'LinkedIn için, kısa bir duyuru.');
      const firstAnswer = await answeredAt(first.question);
      expect(firstAnswer).toBeInstanceOf(Date);
      expect(await said(colleagueA)).toEqual([false, firstAnswer]);

      // Once a step is active the coordinator's answer is no call for that step's work.
      await routeToHaf(tx, task);
      expect(await said(employeeA)).toEqual([false, null]);
      const second = await askFrom(tx, task, 'HAF-1', 'Hangi ürün için?');
      expect(await said(colleagueA)).toEqual([true, null]);
      await answerAs(tx, employeeA, second.question, 'Yeni şarj istasyonu.');
      expect(await said(colleagueA)).toEqual([false, await answeredAt(second.question)]);

      // A new step: the answer to the earlier step's agent is not a call for it.
      await asPerson(tx, founderA);
      await tx.rows(CORRECT, [task, HAF_STEP]);
      expect(await said(employeeA)).toEqual([false, null]);

      // A yes or no and a time: the result has no column for the text, and carries none of it.
      const [row] = await facts(colleagueA);
      expect(Object.keys(row ?? {})).toEqual([
        'task_id',
        'pending_result',
        'last_result_status',
        'last_result_attempt',
        'last_change_request_at',
        'rejected_by_user_id',
        'rejected_reason',
        'rejected_note',
        'not_started_at',
        'restarted_at',
        'open_question',
        'answered_at',
      ]);
      const everything = JSON.stringify(row);
      for (const text of ['Hangi kanal', 'LinkedIn', 'Hangi ürün', 'şarj istasyonu']) {
        expect(everything).not.toContain(text);
      }
    });
  });

  it('the name of the runner’s tool cannot be a catalog row', async () => {
    await inAdminTransaction(async (tx) => {
      await asAdmin(tx);
      expect(
        await tx.expectError(
          `insert into office.tools (name, kind, description)
           values ('ask_requester', 'read', 'Asks the requester')`,
        ),
      ).toMatchObject({ code: '23514' });
      expect(
        (
          await tx.expectError(
            `update office.tools set name = 'ask_requester' where name = 'read_task'`,
          )
        ).code,
      ).toBe('23514');
      // Any other name is a row as before.
      expect(
        await tx.exec(
          `insert into office.tools (name, kind, description)
           values ('ask_somebody_else', 'read', 'Another tool')`,
        ),
      ).toBe(1);
    });
  });
});
