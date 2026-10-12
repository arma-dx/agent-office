import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withContext, type ContextInput } from '../src/context.ts';
import type { Queryable } from '../src/queryable.ts';
import { insertRequestComment } from '../src/requests.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  appPool,
  auditMark,
  closePools,
  noDatabase,
  openTransaction,
  removeRequests,
  restoreProjectA,
  untilBlocked,
  workerPool,
} from './helpers.ts';

// Flow (A) when two transactions meet. The other request tests run every case inside one
// transaction that is rolled back, which shows the rules in sequence only; here two connections
// hold transactions open at once, with the restricted roles (the API's and the worker's), and the
// order of the two is fixed by waiting until one of them is blocked by the other's lock. The last
// case is here for another reason: it needs a request the API's role committed, to try the
// worker's role on it.
//
// These tests commit, so each request is written for the test and removed again at the end. The
// unit agent is KOR-1, as in the fixtures: the only agent that is open in Arma DX there.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const coordinatorRun: ContextInput = {
  companyId: ids.arma,
  userId: ids.employeeA,
  agentCode: 'KOR-1',
};

const ROUTE = 'select office.route_request($1, $2::jsonb, $3) as round';
const CORRECT = 'select office.correct_routing($1, $2::jsonb) as round';
const TO_KOR = JSON.stringify([{ unit: 'KOR', agent: 'KOR-1', reason: 'By a person' }]);

/** How a statement that was started without being awaited ended: 'ok' or the error's code. */
function outcomeOf(statement: Promise<unknown>): Promise<string> {
  return statement.then(
    () => 'ok',
    (error: unknown) => (error as { code?: string }).code ?? 'error',
  );
}

describe.skipIf(noDatabase)('a request across transactions', () => {
  const tasks: string[] = [];
  let mark = '0';

  beforeAll(async () => {
    mark = await auditMark();
  });

  afterAll(async () => {
    await removeRequests(tasks, mark);
    await closePools();
  });

  /** A request of employee A, committed. */
  async function openRequest(): Promise<string> {
    const id = await withContext(appPool(), employeeA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into office.tasks (company_id, kind, title, description)
         values (office.ctx_company_id(), 'request', 'A request', 'What is wanted') returning id`,
      );
      return rows[0]?.id ?? '';
    });
    tasks.push(id);
    return id;
  }

  /** A run of KOR-1 on the request, committed and left running. */
  async function openRun(task: string): Promise<string> {
    return withContext(workerPool(), coordinatorRun, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
           model)
         values (office.ctx_company_id(), $1, 'KOR-1', $2, 'request', 'test-model') returning id`,
        [task, ids.cardKor],
      );
      return rows[0]?.id ?? '';
    });
  }

  /**
   * A request a person routed to KOR-1 as the unit agent, with a run of KOR-1 open on that step:
   * the point where the agent is about to submit its result.
   */
  async function requestWithOpenRun(): Promise<{ task: string; run: string }> {
    const task = await openRequest();
    await withContext(appPool(), founderA, (client) => client.query(CORRECT, [task, TO_KOR]));
    return { task, run: await openRun(task) };
  }

  const SUBMIT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
      payload, basis_type, basis_id, basis_version, involves_money, goes_external)
    values (office.ctx_company_id(), $1, $2, 'KOR-1', 'Result', '{"text": "Output"}', 'task', $1,
      (select version from office.tasks where id = $1), false, false)`;

  const approvalsOf = (task: string): Promise<Record<string, unknown>[]> =>
    adminQuery(
      `select a.status, a.invalidated_at is not null as closed,
              (select r.status from office.task_routings r where r.id = a.routing_id) as step
       from office.approvals a where a.task_id = $1`,
      [task],
    );

  const stepsOf = (task: string): Promise<Record<string, unknown>[]> =>
    adminQuery(
      `select round, unit_code, agent_code, status, routed_by_user_id is not null as by_person
       from office.task_routings where task_id = $1 order by round, seq`,
      [task],
    );

  const statusOf = async (task: string): Promise<unknown> =>
    (await adminQuery('select status from office.tasks where id = $1', [task]))[0]?.status;

  it('a person’s correction that commits first stands: the coordinator’s routing is refused', async () => {
    const task = await openRequest();
    const run = await openRun(task);
    // The founder's correction holds the request; the coordinator's answer arrives and waits.
    const person = await openTransaction('app', founderA);
    const coordinator = await openTransaction('worker', coordinatorRun);
    try {
      await person.tx.rows(CORRECT, [task, TO_KOR]);
      const routed = outcomeOf(
        coordinator.tx.rows(ROUTE, [task, JSON.stringify([{ unit: 'HAF', agent: null }]), run]),
      );
      await untilBlocked(coordinator.pid);
      await person.commit();
      expect(await routed).toBe('42501');
    } finally {
      await person.rollback();
      await coordinator.rollback();
    }
    expect(await stepsOf(task)).toEqual([
      { round: 1, unit_code: 'KOR', agent_code: 'KOR-1', status: 'active', by_person: true },
    ]);
    expect(await statusOf(task)).toBe('in_progress');
  });

  it('a result that meets a cancel is refused: nothing waits on the cancelled request', async () => {
    const { task, run } = await requestWithOpenRun();
    const requester = await openTransaction('app', employeeA);
    const agent = await openTransaction('worker', coordinatorRun);
    try {
      await requester.tx.rows('select office.close_request($1)', [task]);
      // The agent's check reads the request as it was before the cancel; the insert then waits
      // for the request's lock.
      const submitted = agent.tx.rows(SUBMIT, [task, run]).then(
        () => 'ok',
        (error: unknown) => (error as { message?: string }).message ?? 'error',
      );
      await untilBlocked(agent.pid);
      await requester.commit();
      expect(await submitted).toBe('The request is closed');
    } finally {
      await requester.rollback();
      await agent.rollback();
    }
    expect(await statusOf(task)).toBe('cancelled');
    expect(await approvalsOf(task)).toEqual([]);
  });

  it('a result that meets a new routing is refused: nothing waits on the replaced step', async () => {
    const { task, run } = await requestWithOpenRun();
    const person = await openTransaction('app', founderA);
    const agent = await openTransaction('worker', coordinatorRun);
    try {
      // To the same agent again: a new step, which the open run was not opened for.
      await person.tx.rows(CORRECT, [task, TO_KOR]);
      const submitted = outcomeOf(agent.tx.rows(SUBMIT, [task, run]));
      await untilBlocked(agent.pid);
      await person.commit();
      expect(await submitted).toBe('23514');
    } finally {
      await person.rollback();
      await agent.rollback();
    }
    expect(await statusOf(task)).toBe('in_progress');
    expect(await approvalsOf(task)).toEqual([]);
    expect(await stepsOf(task)).toEqual([
      { round: 1, unit_code: 'KOR', agent_code: 'KOR-1', status: 'replaced', by_person: true },
      { round: 2, unit_code: 'KOR', agent_code: 'KOR-1', status: 'active', by_person: true },
    ]);
    // The run opened for the new step submits as before.
    const next = await openRun(task);
    await withContext(workerPool(), coordinatorRun, (client) => client.query(SUBMIT, [task, next]));
    expect(await statusOf(task)).toBe('awaiting_approval');
    expect(await approvalsOf(task)).toEqual([{ status: 'pending', closed: false, step: 'active' }]);
  });

  it('a comment and a close of the same request wait for each other and both are stored', async () => {
    // A comment takes no lock of its own, but its foreign key holds the request row against a
    // change, and every act of a person locks that row first: the two wait for each other. The
    // comment holds nothing else an act needs, so neither order can end in a deadlock.
    const comment = (tx: { client: Queryable }, task: string, body: string): Promise<boolean> =>
      insertRequestComment(tx.client, { id: randomUUID(), requestId: task, body });
    const CLOSE = 'select office.close_request($1)';
    const commentsOf = (task: string): Promise<Record<string, unknown>[]> =>
      adminQuery(
        'select author_user_id, body from office.task_comments where task_id = $1 order by created_at',
        [task],
      );

    // The close is in flight: the founder's comment waits and is stored on the closed request.
    const closedFirst = await openRequest();
    const requester = await openTransaction('app', employeeA);
    const founder = await openTransaction('app', founderA);
    try {
      await requester.tx.rows(CLOSE, [closedFirst]);
      const commented = comment(founder.tx, closedFirst, 'After the close');
      await untilBlocked(founder.pid);
      await requester.commit();
      // Stored, not refused and not skipped as a row that is there already.
      expect(await commented).toBe(true);
      await founder.commit();
    } finally {
      await requester.rollback();
      await founder.rollback();
    }
    expect(await statusOf(closedFirst)).toBe('cancelled');
    expect(await commentsOf(closedFirst)).toEqual([
      { author_user_id: ids.founder, body: 'After the close' },
    ]);

    // The comment is in flight: the requester's close waits and goes through.
    const commentedFirst = await openRequest();
    const writer = await openTransaction('app', founderA);
    const closer = await openTransaction('app', employeeA);
    try {
      expect(await comment(writer.tx, commentedFirst, 'Before the close')).toBe(true);
      const closed = outcomeOf(closer.tx.rows(CLOSE, [commentedFirst]));
      await untilBlocked(closer.pid);
      await writer.commit();
      expect(await closed).toBe('ok');
      await closer.commit();
    } finally {
      await writer.rollback();
      await closer.rollback();
    }
    expect(await statusOf(commentedFirst)).toBe('cancelled');
    expect(await commentsOf(commentedFirst)).toEqual([
      { author_user_id: ids.founder, body: 'Before the close' },
    ]);
  });

  // An agent's question (12 October decisions 3 and 4) -------------------------------------------

  const ASK = 'select office.ask_question($1, $2, $3) as id';
  const ANSWER = 'select agent_code from office.answer_question($1, $2)';
  const CLOSE_REQUEST = 'select office.close_request($1)';

  const questionsOf = (task: string): Promise<Record<string, unknown>[]> =>
    adminQuery(
      `select status, answer, answered_by_user_id from office.task_questions
       where task_id = $1 order by created_at, id`,
      [task],
    );

  /** A request on which the coordinator asked and ended its run, committed: it waits for an answer. */
  async function requestWithOpenQuestion(): Promise<{ task: string; question: string }> {
    const task = await openRequest();
    const question = await withContext(workerPool(), coordinatorRun, async (client) => {
      const run = await client.query<{ id: string }>(
        `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
           model)
         values (office.ctx_company_id(), $1, 'KOR-1', $2, 'request', 'test-model') returning id`,
        [task, ids.cardKor],
      );
      const asked = await client.query<{ id: string }>(ASK, [
        task,
        run.rows[0]?.id,
        'Hangi kanal için yazayım?',
      ]);
      await client.query(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [run.rows[0]?.id],
      );
      return asked.rows[0]?.id ?? '';
    });
    return { task, question };
  }

  it('two answers at once: one is stored', async () => {
    const { task, question } = await requestWithOpenQuestion();
    // A double click, or two tabs: both take the request's row first.
    const first = await openTransaction('app', employeeA);
    const second = await openTransaction('app', employeeA);
    try {
      await first.tx.rows(ANSWER, [question, 'The first answer']);
      const late = outcomeOf(second.tx.rows(ANSWER, [question, 'The second answer']));
      await untilBlocked(second.pid);
      await first.commit();
      expect(await late).toBe('23514');
    } finally {
      await first.rollback();
      await second.rollback();
    }
    expect(await questionsOf(task)).toEqual([
      { status: 'answered', answer: 'The first answer', answered_by_user_id: ids.employeeA },
    ]);
    expect(await statusOf(task)).toBe('in_progress');
  });

  it('an answer against a cancel and against a correction of the routing', async () => {
    // The cancel holds the request: the answer waits and finds the question closed.
    const cancelled = await requestWithOpenQuestion();
    const closer = await openTransaction('app', employeeA);
    const answerer = await openTransaction('app', employeeA);
    try {
      await closer.tx.rows(CLOSE_REQUEST, [cancelled.task]);
      const answered = outcomeOf(answerer.tx.rows(ANSWER, [cancelled.question, 'Too late']));
      await untilBlocked(answerer.pid);
      await closer.commit();
      expect(await answered).toBe('23514');
    } finally {
      await closer.rollback();
      await answerer.rollback();
    }
    expect(await statusOf(cancelled.task)).toBe('cancelled');
    expect(await questionsOf(cancelled.task)).toEqual([
      { status: 'closed', answer: null, answered_by_user_id: null },
    ]);

    // A person's routing holds the request: the same.
    const rerouted = await requestWithOpenQuestion();
    const router = await openTransaction('app', founderA);
    const requester = await openTransaction('app', employeeA);
    try {
      await router.tx.rows(CORRECT, [rerouted.task, TO_KOR]);
      const answered = outcomeOf(requester.tx.rows(ANSWER, [rerouted.question, 'Too late']));
      await untilBlocked(requester.pid);
      await router.commit();
      expect(await answered).toBe('23514');
    } finally {
      await router.rollback();
      await requester.rollback();
    }
    expect(await statusOf(rerouted.task)).toBe('in_progress');
    expect(await questionsOf(rerouted.task)).toEqual([
      { status: 'closed', answer: null, answered_by_user_id: null },
    ]);

    // The answer holds the request: the routing waits, goes through and leaves the answer as it
    // was given.
    const answeredFirst = await requestWithOpenQuestion();
    const writer = await openTransaction('app', employeeA);
    const corrector = await openTransaction('app', founderA);
    try {
      await writer.tx.rows(ANSWER, [answeredFirst.question, 'In time']);
      const corrected = outcomeOf(corrector.tx.rows(CORRECT, [answeredFirst.task, TO_KOR]));
      await untilBlocked(corrector.pid);
      await writer.commit();
      expect(await corrected).toBe('ok');
      await corrector.commit();
    } finally {
      await writer.rollback();
      await corrector.rollback();
    }
    expect(await questionsOf(answeredFirst.task)).toEqual([
      { status: 'answered', answer: 'In time', answered_by_user_id: ids.employeeA },
    ]);
    expect(await stepsOf(answeredFirst.task)).toEqual([
      { round: 1, unit_code: 'KOR', agent_code: 'KOR-1', status: 'active', by_person: true },
    ]);
  });

  it('a question against a cancel', async () => {
    // The question is in flight: the cancel waits, goes through and closes it.
    const askedFirst = await openRequest();
    const askingRun = await openRun(askedFirst);
    const agent = await openTransaction('worker', coordinatorRun);
    const requester = await openTransaction('app', employeeA);
    try {
      await agent.tx.rows(ASK, [askedFirst, askingRun, 'Hangi kanal için?']);
      const closed = outcomeOf(requester.tx.rows(CLOSE_REQUEST, [askedFirst]));
      await untilBlocked(requester.pid);
      await agent.commit();
      expect(await closed).toBe('ok');
      await requester.commit();
    } finally {
      await agent.rollback();
      await requester.rollback();
    }
    expect(await statusOf(askedFirst)).toBe('cancelled');
    expect(await questionsOf(askedFirst)).toEqual([
      { status: 'closed', answer: null, answered_by_user_id: null },
    ]);

    // The cancel is in flight: the question waits, is refused and writes nothing.
    const cancelledFirst = await openRequest();
    const lateRun = await openRun(cancelledFirst);
    const closer = await openTransaction('app', employeeA);
    const asker = await openTransaction('worker', coordinatorRun);
    try {
      await closer.tx.rows(CLOSE_REQUEST, [cancelledFirst]);
      const asked = outcomeOf(asker.tx.rows(ASK, [cancelledFirst, lateRun, 'Hangi kanal için?']));
      await untilBlocked(asker.pid);
      await closer.commit();
      expect(await asked).toBe('23514');
    } finally {
      await closer.rollback();
      await asker.rollback();
    }
    expect(await statusOf(cancelledFirst)).toBe('cancelled');
    expect(await questionsOf(cancelledFirst)).toEqual([]);
  });

  it('a question while the AI permission is being closed', async () => {
    // Rule 12: a request inside project A, with a run of the coordinator open in the project's
    // context. The founder closes the project's AI permission and has not committed yet.
    const inProject: ContextInput = { ...coordinatorRun, projectId: ids.projectA };
    const task = await withContext(appPool(), employeeA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into office.tasks (company_id, project_id, kind, title, description)
         values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted')
         returning id`,
        [ids.projectA],
      );
      return rows[0]?.id ?? '';
    });
    tasks.push(task);
    const run = await withContext(workerPool(), inProject, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
           model)
         values (office.ctx_company_id(), $1, 'KOR-1', $2, 'request', 'test-model') returning id`,
        [task, ids.cardKor],
      );
      return rows[0]?.id ?? '';
    });
    const founder = await openTransaction('app', founderA);
    const agent = await openTransaction('worker', inProject);
    try {
      await founder.tx.rows('select office.set_project_ai_permission($1, false, null)', [
        ids.projectA,
      ]);
      // The question reads the permission under a share lock: it waits for the closing.
      const asked = agent.tx.rows(ASK, [task, run, 'Hangi kanal için?']).then(
        () => 'ok',
        (error: unknown) => (error as { message?: string }).message ?? 'error',
      );
      await untilBlocked(agent.pid);
      await founder.commit();
      expect(await asked).toBe('Agents do not work in this project now');
    } finally {
      await founder.rollback();
      await agent.rollback();
      // The committed close stopped the fixtures' own open run in the project too.
      await restoreProjectA(ids.projectA, ids.customerA, ids.runAProject);
    }
    expect(await questionsOf(task)).toEqual([]);
    expect(await statusOf(task)).not.toBe('awaiting_reply');
    // The closing stopped the run that was about to ask.
    expect(
      await adminQuery('select status, error_code from office.runs where id = $1', [run]),
    ).toEqual([{ status: 'stopped', error_code: 'ai_permission_closed' }]);
  });

  it('the worker’s role decides nothing on the pending result of a request, in whose name ever', async () => {
    // The worker cannot open a request in its own transaction, so this case needs committed rows:
    // a result that waits for the founder (nobody is appointed for KOR in the fixtures).
    const { task, run } = await requestWithOpenRun();
    await withContext(workerPool(), coordinatorRun, (client) => client.query(SUBMIT, [task, run]));
    const worker = await openTransaction('worker', founderA);
    try {
      for (const change of [
        `status = 'rejected', rejection_reason = 'out_of_scope'`,
        `status = 'changes_requested', rejection_reason = 'incomplete'`,
        `status = 'approved'`,
        `summary = 'All fine'`,
      ]) {
        expect(
          (
            await worker.tx.expectError(
              `update office.approvals set ${change} where task_id = $1`,
              [task],
            )
          ).code,
        ).toBe('42501');
      }
    } finally {
      await worker.rollback();
    }
    // A rejection would have closed the request.
    expect(await statusOf(task)).toBe('awaiting_approval');
    // The founder, through the API's role, decides it.
    await withContext(appPool(), founderA, (client) =>
      client.query(
        `update office.approvals set status = 'rejected', rejection_reason = 'out_of_scope'
         where task_id = $1`,
        [task],
      ),
    );
    expect(await statusOf(task)).toBe('cancelled');
  });
});
