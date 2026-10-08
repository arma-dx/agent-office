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
});
