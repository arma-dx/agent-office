import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext, type ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  appPool,
  auditMark,
  closePools,
  noDatabase,
  openTransaction,
  removeRequests,
  untilBlocked,
  workerPool,
} from './helpers.ts';

// Flow (A) when two transactions meet. The other request tests run every case inside one
// transaction that is rolled back, which shows the rules in sequence only; here two connections
// hold transactions open at once, with the restricted roles (the API's and the worker's), and the
// order of the two is fixed by waiting until one of them is blocked by the other's lock.
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

describe.skipIf(noDatabase)('a request when two transactions meet', () => {
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
});
