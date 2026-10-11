import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import {
  countWaitingWork,
  restartWaitingWork,
  setAgentSwitch,
  type OpeningScope,
} from '../src/requests.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  asRole,
  auditMark,
  closePools,
  inAdminTransaction,
  noDatabase,
  openAdminTransaction,
  openTransaction,
  removeRequests,
  restoreProjectA,
  untilBlocked,
  type Tx,
} from './helpers.ts';

// Waiting work starts again by itself (8 October decision 49), and a run whose person changed is
// handed over (decision 45). The database picks the work that waited for an agent or for an AI
// permission (office.restart_waiting_work), writes the trace run_restarted on each request and
// gives the ids back; the confirmation of an opening is told the number beforehand
// (office.count_waiting_work).
//
// The rule compares moments: when the work was last called for, when a run started, when a trace
// was written. now() does not move inside a transaction, so every step of these cases is
// committed in a transaction of its own, with the restricted role whose act it is. Each case
// removes its requests again and puts the switches and the permissions of the fixtures back.
// The fixtures: KOR-1 is open in Arma DX, HAF-1 is stopped; the cases open HAF-1 first.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const colleagueA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };

type Agent = 'KOR-1' | 'HAF-1';

/** The context of a run of the employee's request (the requester is the person). */
function agentRun(agentCode: string, projectId: string | null = null): ContextInput {
  return { companyId: ids.arma, userId: ids.employeeA, agentCode, projectId };
}

const OPEN = `insert into office.tasks (company_id, project_id, kind, title, description)
  values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted') returning id`;
const RUN = `insert into office.runs
    (company_id, task_id, agent_code, card_version_id, trigger_type, model)
  values (office.ctx_company_id(), $1, $2, $3, 'request', 'test-model') returning id`;
const HAF_STEP = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Belongs to memory' }]);
const SUBMIT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
    payload, basis_type, basis_id, basis_version, involves_money, goes_external,
    previous_approval_id)
  values (office.ctx_company_id(), $1, $2, 'HAF-1', 'Result', '{"text": "Output"}', 'task', $1,
    (select version from office.tasks where id = $1), false, false, $3) returning id`;
// The trace the runner leaves for a job it refused, and the one the API leaves for a change
// request that found the agent stopped.
const TRACE = `insert into office.audit_log (company_id, project_id, event, record_type, record_id)
  values (office.ctx_company_id(), office.ctx_project_id(), $2, 'task', $1)`;
const RESTART = `select task_id, agent_code, requester_user_id
  from office.restart_waiting_work($1, $2, $3) order by task_id`;
const COUNT = 'select office.count_waiting_work($1, $2, $3) as waiting';
const SWITCH = `update office.company_agents set status = $2
  where company_id = office.ctx_company_id() and agent_code = $1`;
const FACTS = `select restarted_at is not null as restarted, not_started_at is not null as missed
  from office.request_flow_facts(array[$1::uuid])`;

interface Scope {
  agent?: Agent;
  project?: string;
  customer?: string;
}
const scopeValues = (scope: Scope): (string | null)[] => [
  scope.agent ?? null,
  scope.project ?? null,
  scope.customer ?? null,
];

interface Picked {
  task_id: string;
  agent_code: string;
  requester_user_id: string;
}

/** One committed transaction of a restricted role. */
async function committed<T>(
  role: 'app' | 'worker',
  context: ContextInput,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const open = await openTransaction(role, context);
  try {
    const result = await work(open.tx);
    await open.commit();
    return result;
  } finally {
    await open.rollback();
  }
}

/** How a statement that was started without being awaited ended: its rows, or the error's code. */
function settled<T>(statement: Promise<T>): Promise<T | string> {
  return statement.catch((error: unknown) => (error as { code?: string }).code ?? 'error');
}

describe.skipIf(noDatabase)('waiting work starts again', () => {
  const tasks: string[] = [];
  let mark = '0';

  beforeAll(async () => {
    mark = await auditMark();
  });

  /** The switches and the permissions as the fixtures have them. */
  async function fixturesBack(): Promise<void> {
    await committed('app', founderA, async (tx) => {
      await tx.exec(SWITCH, ['HAF-1', 'stopped']);
      await tx.exec(SWITCH, ['KOR-1', 'enabled']);
    });
    // A committed close of a permission also stops the fixtures' own open run in project A.
    await restoreProjectA(ids.projectA, ids.customerA, ids.runAProject);
  }

  afterEach(async () => {
    await fixturesBack();
    await removeRequests(tasks, mark);
    tasks.length = 0;
  });

  afterAll(closePools);

  // The acts of the flow, each committed --------------------------------------------------------

  const asFounder = <T>(work: (tx: Tx) => Promise<T>): Promise<T> =>
    committed('app', founderA, work);

  const setSwitch = (agent: Agent, status: 'enabled' | 'stopped'): Promise<number> =>
    asFounder((tx) => tx.exec(SWITCH, [agent, status]));

  /** A request of the employee, in a project or without one. */
  async function open(project: string | null = null): Promise<string> {
    const id = await committed('app', employeeA, async (tx) => {
      const [row] = await tx.rows<{ id: string }>(OPEN, [project]);
      return row?.id ?? '';
    });
    tasks.push(id);
    return id;
  }

  /** A run of the agent on the request, left running. */
  const startRun = (task: string, agent: Agent, project: string | null = null): Promise<string> =>
    committed('worker', agentRun(agent, project), async (tx) => {
      const [row] = await tx.rows<{ id: string }>(RUN, [
        task,
        agent,
        agent === 'KOR-1' ? ids.cardKor : ids.cardHaf,
      ]);
      return row?.id ?? '';
    });

  /** The run ends as the runner ends it. */
  const endRun = (
    run: string,
    agent: Agent,
    status: 'completed' | 'failed' | 'stopped' | 'limit_reached',
    code: string | null = null,
    project: string | null = null,
  ): Promise<number> =>
    committed('worker', agentRun(agent, project), (tx) =>
      tx.exec(
        `update office.runs set status = $2, finished_at = now(), error_code = $3 where id = $1`,
        [run, status, code],
      ),
    );

  /** The coordinator routes the request to HAF-1 from its own run. */
  async function route(task: string, project: string | null = null): Promise<void> {
    const kor = await startRun(task, 'KOR-1', project);
    await committed('worker', agentRun('KOR-1', project), async (tx) => {
      await tx.rows('select office.route_request($1, $2::jsonb, $3)', [task, HAF_STEP, kor]);
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [kor],
      );
    });
  }

  /** A request routed to HAF-1. */
  async function routed(project: string | null = null): Promise<string> {
    const task = await open(project);
    await route(task, project);
    return task;
  }

  /** The runner refused the job of this agent and left its trace. */
  const refused = (task: string, agent: Agent, project: string | null = null): Promise<number> =>
    committed('worker', agentRun(agent, project), (tx) => tx.exec(TRACE, [task, 'run_refused']));

  /** HAF-1 submits a result from a run of its own and ends that run. */
  async function submit(task: string, previous: string | null = null): Promise<string> {
    const run = await startRun(task, 'HAF-1');
    return committed('worker', agentRun('HAF-1'), async (tx) => {
      const [row] = await tx.rows<{ id: string }>(SUBMIT, [task, run, previous]);
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [run],
      );
      return row?.id ?? '';
    });
  }

  const decide = (approval: string, status: 'approved' | 'changes_requested'): Promise<number> =>
    asFounder((tx) =>
      tx.exec(
        status === 'approved'
          ? `update office.approvals set status = 'approved' where id = $1`
          : `update office.approvals set status = 'changes_requested',
               rejection_reason = 'incomplete' where id = $1`,
        [approval],
      ),
    );

  const restart = (scope: Scope, as: ContextInput = founderA): Promise<Picked[]> =>
    committed('app', as, (tx) => tx.rows<Picked>(RESTART, scopeValues(scope)));

  const waiting = async (scope: Scope, as: ContextInput = founderA): Promise<number> =>
    committed('app', as, async (tx) => {
      const [row] = await tx.rows<{ waiting: number }>(COUNT, scopeValues(scope));
      return row?.waiting ?? -1;
    });

  const idsOf = (rows: Picked[]): string[] => rows.map((row) => row.task_id).sort();

  const restartTraces = (task: string): Promise<Record<string, unknown>[]> =>
    adminQuery(
      `select user_id, agent_code, run_id, project_id from office.audit_log
       where record_type = 'task' and record_id = $1 and event = 'run_restarted' order by id`,
      [task],
    );

  const closeProjectPermission = (): Promise<unknown> =>
    asFounder((tx) =>
      tx.rows('select office.set_project_ai_permission($1, false, null)', [ids.projectA]),
    );

  // Opening a permission asks a person for a passkey; these cases open it as an administrator
  // does, without a person in the context (the routes are tested with the passkey in apps/api).
  const openProjectPermission = (): Promise<unknown> =>
    adminQuery('update office.projects set ai_allowed = true where id = $1', [ids.projectA]);

  // The cases ------------------------------------------------------------------------------------

  it('an opened agent restarts exactly the waiting work once', async () => {
    await setSwitch('HAF-1', 'enabled');
    // Three requests that wait: the switch stops the run of the first, the job of the second is
    // refused while the agent is stopped, the third is the same inside a project.
    const stoppedBySwitch = await routed();
    const runOfFirst = await startRun(stoppedBySwitch, 'HAF-1');
    const jobRefused = await routed();
    const inProject = await routed(ids.projectA);
    const runInProject = await startRun(inProject, 'HAF-1', ids.projectA);
    // And one that does not: its job is still on the queue (no run, no trace).
    const queued = await routed();

    await setSwitch('HAF-1', 'stopped');
    await endRun(runOfFirst, 'HAF-1', 'stopped', 'agent_stopped');
    await endRun(runInProject, 'HAF-1', 'stopped', 'agent_stopped', ids.projectA);
    await refused(jobRefused, 'HAF-1');

    // While the agent is stopped nothing starts; the number an opening would start is told.
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await waiting({ agent: 'HAF-1' })).toBe(3);

    await setSwitch('HAF-1', 'enabled');
    const picked = await restart({ agent: 'HAF-1' });
    const expected = [stoppedBySwitch, jobRefused, inProject].sort();
    expect(idsOf(picked)).toEqual(expected);
    expect(picked.every((row) => row.agent_code === 'HAF-1')).toBe(true);
    expect(picked.every((row) => row.requester_user_id === ids.employeeA)).toBe(true);
    // One trace on each request, in the founder's name, with the request's project.
    for (const task of expected) {
      expect(await restartTraces(task), task).toEqual([
        {
          user_id: ids.founder,
          agent_code: null,
          run_id: null,
          project_id: task === inProject ? ids.projectA : null,
        },
      ]);
    }
    expect(await restartTraces(queued)).toEqual([]);

    // A second call finds nothing and writes nothing; the count is back at zero.
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await waiting({ agent: 'HAF-1' })).toBe(0);
    for (const task of expected) {
      expect(await restartTraces(task), task).toHaveLength(1);
    }
  });

  it('what does not wait is not restarted', async () => {
    await setSwitch('HAF-1', 'enabled');
    const cases: Record<string, string> = {};
    // Its job is still on the queue: neither a run nor a trace.
    cases.queued = await routed();
    // Its run failed, hit its limit or ended without a result: a person decides those.
    for (const [name, status, code] of [
      ['failed', 'failed', 'runner_error'],
      ['limit', 'limit_reached', 'time_limit'],
      ['noResult', 'completed', null],
      ['interrupted', 'stopped', 'routing_changed'],
    ] as const) {
      const task = await routed();
      await endRun(await startRun(task, 'HAF-1'), 'HAF-1', status, code);
      cases[name] = task;
    }
    // A result waits for the approver.
    cases.resultWaits = await routed();
    await submit(cases.resultWaits);
    // An approved result waits for the requester.
    cases.acceptanceWaits = await routed();
    await decide(await submit(cases.acceptanceWaits), 'approved');
    // After the second change request the work is a person's.
    cases.secondChange = await routed();
    const first = await submit(cases.secondChange);
    await decide(first, 'changes_requested');
    await decide(await submit(cases.secondChange, first), 'changes_requested');
    // A request a person closed.
    cases.closed = await routed();
    const runOfClosed = await startRun(cases.closed, 'HAF-1');
    // A request whose step is another agent's: KOR-1 as the unit agent.
    cases.otherAgent = await open();
    await asFounder((tx) =>
      tx.rows('select office.correct_routing($1, $2::jsonb)', [
        cases.otherAgent,
        JSON.stringify([{ unit: 'KOR', agent: 'KOR-1', reason: 'By a person' }]),
      ]),
    );
    // And one that waits, so that the opening has something to start.
    const control = await routed();

    await setSwitch('HAF-1', 'stopped');
    await endRun(runOfClosed, 'HAF-1', 'stopped', 'agent_stopped');
    await asFounder((tx) =>
      tx.rows('select office.close_request($1, $2)', [cases.closed, 'Not needed any more']),
    );
    // Every one of them gets the trace of a refused job on top: none becomes waiting work by it.
    for (const [name, task] of Object.entries(cases)) {
      if (name !== 'queued' && name !== 'closed') {
        await refused(task, name === 'otherAgent' ? 'KOR-1' : 'HAF-1');
      }
    }
    await refused(control, 'HAF-1');

    // "failed", "limit", "noResult" and "interrupted" have a run since the call that ended by
    // itself; the trace beside it does not count while that run is the agent's latest.
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    await setSwitch('HAF-1', 'enabled');
    const picked = idsOf(await restart({ agent: 'HAF-1' }));
    for (const [name, task] of Object.entries(cases)) {
      expect(picked, name).not.toContain(task);
      expect(await restartTraces(task), name).toEqual([]);
    }
    expect(picked).toEqual([control]);
  });

  it('the coordinator’s own waiting requests start when the coordinator is opened, not when a unit agent is', async () => {
    await setSwitch('HAF-1', 'enabled');
    // Not routed yet: the coordinator's run is stopped by its switch, and the coordinator's job
    // of a second request is refused.
    const runStopped = await open();
    const korRun = await startRun(runStopped, 'KOR-1');
    const jobRefused = await open();
    const ofUnit = await routed();
    await setSwitch('KOR-1', 'stopped');
    await setSwitch('HAF-1', 'stopped');
    await endRun(korRun, 'KOR-1', 'stopped', 'agent_stopped');
    await refused(jobRefused, 'KOR-1');
    await refused(ofUnit, 'HAF-1');

    expect(await waiting({ agent: 'KOR-1' })).toBe(2);
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([ofUnit]);
    expect(await restart({ agent: 'KOR-1' })).toEqual([]);
    await setSwitch('KOR-1', 'enabled');
    const picked = await restart({ agent: 'KOR-1' });
    expect(idsOf(picked)).toEqual([runStopped, jobRefused].sort());
    expect(picked.every((row) => row.agent_code === 'KOR-1')).toBe(true);
    expect(await waiting({ agent: 'KOR-1' })).toBe(0);
  });

  it('a reopened permission restarts exactly the held requests once', async () => {
    await setSwitch('HAF-1', 'enabled');
    const heldRun = await routed(ids.projectA);
    const runInProject = await startRun(heldRun, 'HAF-1', ids.projectA);
    const heldJob = await routed(ids.projectA);
    const outside = await routed();
    const runOutside = await startRun(outside, 'HAF-1');

    // The close stops the open run of the project and not the one outside it.
    await closeProjectPermission();
    expect(
      await adminQuery('select id, status, error_code from office.runs where id = any ($1)', [
        [runInProject, runOutside],
      ]),
    ).toEqual(
      expect.arrayContaining([
        { id: runInProject, status: 'stopped', error_code: 'ai_permission_closed' },
        { id: runOutside, status: 'running', error_code: null },
      ]),
    );
    await refused(heldJob, 'HAF-1', ids.projectA);

    // While the permission is closed nothing is picked, by the project or by the agent.
    expect(await restart({ project: ids.projectA })).toEqual([]);
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await waiting({ project: ids.projectA })).toBe(2);
    // The agent's switch is not what holds them, and neither is the customer's permission.
    expect(await waiting({ agent: 'HAF-1' })).toBe(0);
    expect(await waiting({ customer: ids.customerA })).toBe(0);

    // The permission open and the agent stopped: nothing starts; the agent's opening would.
    await openProjectPermission();
    await setSwitch('HAF-1', 'stopped');
    expect(await restart({ project: ids.projectA })).toEqual([]);
    expect(await waiting({ project: ids.projectA })).toBe(0);
    expect(await waiting({ agent: 'HAF-1' })).toBe(2);

    // Both open: the two held requests, once.
    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ project: ids.projectA }))).toEqual([heldRun, heldJob].sort());
    expect(await restart({ project: ids.projectA })).toEqual([]);
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await restartTraces(outside)).toEqual([]);
  });

  it('a reopened permission of a customer restarts the held requests of its projects, and of no other customer', async () => {
    await setSwitch('HAF-1', 'enabled');
    const held = await routed(ids.projectA);
    const run = await startRun(held, 'HAF-1', ids.projectA);
    const outside = await routed();
    await endRun(await startRun(outside, 'HAF-1'), 'HAF-1', 'failed', 'runner_error');
    await asFounder((tx) =>
      tx.rows('select office.set_customer_permissions($1, false, null)', [ids.customerA]),
    );
    expect(
      await adminQuery('select status, error_code from office.runs where id = $1', [run]),
    ).toEqual([{ status: 'stopped', error_code: 'ai_permission_closed' }]);

    expect(await restart({ customer: ids.customerA })).toEqual([]);
    expect(await waiting({ customer: ids.customerA })).toBe(1);
    // The project's own permission is open: its opening would start nothing.
    expect(await waiting({ project: ids.projectA })).toBe(0);
    // A customer of the other company, and a customer without the permission of this one.
    expect(await waiting({ customer: ids.customerP })).toBe(0);
    expect(await waiting({ customer: ids.customerANoAi })).toBe(0);

    await adminQuery('update office.customers set ai_allowed = true where id = $1', [
      ids.customerA,
    ]);
    expect(await restart({ customer: ids.customerP })).toEqual([]);
    expect(await restart({ customer: ids.customerANoAi })).toEqual([]);
    expect(idsOf(await restart({ customer: ids.customerA }))).toEqual([held]);
    expect(await restart({ customer: ids.customerA })).toEqual([]);
    expect(await waiting({ customer: ids.customerA })).toBe(0);
  });

  it('a request held by a closed permission and a stopped agent is counted for neither opening while the other is closed', async () => {
    await setSwitch('HAF-1', 'enabled');
    const held = await routed(ids.projectA);
    await setSwitch('HAF-1', 'stopped');
    await closeProjectPermission();
    await refused(held, 'HAF-1', ids.projectA);

    expect(await waiting({ agent: 'HAF-1' })).toBe(0);
    expect(await waiting({ project: ids.projectA })).toBe(0);
    // It starts at the second opening, whichever comes last, and is counted there.
    await setSwitch('HAF-1', 'enabled');
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await waiting({ project: ids.projectA })).toBe(1);
    await openProjectPermission();
    expect(idsOf(await restart({ project: ids.projectA }))).toEqual([held]);
  });

  it('a job refused again after a restart reads as a missed start and is picked at the next opening', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    await setSwitch('HAF-1', 'stopped');
    await refused(task, 'HAF-1');
    const facts = (): Promise<Record<string, unknown>[]> =>
      committed('app', founderA, (tx) => tx.rows(FACTS, [task]));
    expect(await facts()).toEqual([{ restarted: false, missed: true }]);

    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
    // The restart answered the missed start: the request reads as called for again.
    expect(await facts()).toEqual([{ restarted: true, missed: false }]);
    // The new job is refused too (for whatever reason): a missed start again.
    await refused(task, 'HAF-1');
    expect(await facts()).toEqual([{ restarted: true, missed: true }]);
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
    expect(await restartTraces(task)).toHaveLength(2);
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
  });

  it('a restarted request whose new run opened is not picked again, and one whose new run the switch stopped is', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    await setSwitch('HAF-1', 'stopped');
    await refused(task, 'HAF-1');
    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
    // The restarted job opens its run: the work is under way.
    const run = await startRun(task, 'HAF-1');
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await waiting({ agent: 'HAF-1' })).toBe(0);
    // The switch stops that run too: it waits again.
    await setSwitch('HAF-1', 'stopped');
    await endRun(run, 'HAF-1', 'stopped', 'agent_stopped');
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
  });

  it('a change request that found the agent stopped is picked when the agent is opened', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    const approval = await submit(task);
    await setSwitch('HAF-1', 'stopped');
    // The approver asks for changes; the API sends no job to a stopped agent and leaves its
    // trace instead, in the person's name.
    await asFounder(async (tx) => {
      await tx.exec(
        `update office.approvals set status = 'changes_requested',
           rejection_reason = 'incomplete' where id = $1`,
        [approval],
      );
      await tx.exec(TRACE, [task, 'run_not_started']);
    });
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
  });

  it('two openings at the same moment: the second waits and restarts nothing', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    await refused(task, 'HAF-1');
    const first = await openTransaction('app', founderA);
    const second = await openTransaction('app', founderA);
    try {
      expect(idsOf(await first.tx.rows<Picked>(RESTART, scopeValues({ agent: 'HAF-1' })))).toEqual([
        task,
      ]);
      const later = settled(second.tx.rows<Picked>(RESTART, scopeValues({ agent: 'HAF-1' })));
      await untilBlocked(second.pid);
      await first.commit();
      expect(await later).toEqual([]);
      await second.commit();
      expect(await restartTraces(task)).toHaveLength(1);
    } finally {
      await first.rollback();
      await second.rollback();
    }
  });

  it('an opening that began before a refusal was written restarts the request once', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    await setSwitch('HAF-1', 'stopped');
    // The opening's transaction begins: its clock is fixed from here on.
    const opening = await openTransaction('app', founderA);
    try {
      await opening.tx.rows('select now()');
      // Meanwhile the runner refuses the job (the agent is stopped) and commits its trace, whose
      // clock is later than the opening's.
      await refused(task, 'HAF-1');
      await opening.tx.exec(SWITCH, ['HAF-1', 'enabled']);
      expect(
        idsOf(await opening.tx.rows<Picked>(RESTART, scopeValues({ agent: 'HAF-1' }))),
      ).toEqual([task]);
      await opening.commit();
    } finally {
      await opening.rollback();
    }
    // The restart's trace carries the earlier clock and the later row: the row decides. The
    // refusal is answered, and a second restart before the job runs picks nothing.
    expect(await committed('app', founderA, (tx) => tx.rows(FACTS, [task]))).toEqual([
      { restarted: true, missed: false },
    ]);
    expect(await waiting({ agent: 'HAF-1' })).toBe(0);
    expect(await restart({ agent: 'HAF-1' })).toEqual([]);
    expect(await restartTraces(task)).toHaveLength(1);
  });

  it('a refusal written behind the restart lock is never missed', async () => {
    const LOCK_SHARED = `select pg_advisory_xact_lock_shared(
      hashtextextended('office.restart:' || ($1::uuid)::text, 0))`;
    const GATE = 'select run_as, project_id, ai_allowed from office.request_run_gate($1)';
    const AGENT = 'select status from office.company_agents where agent_code = $1';
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    await setSwitch('HAF-1', 'stopped');

    // (a) The refusal first: the opening waits behind it and then finds its trace.
    {
      const refusing = await openTransaction('worker', {
        companyId: ids.arma,
        agentCode: 'HAF-1',
      });
      const opening = await openTransaction('app', founderA);
      try {
        const [gate] = await refusing.tx.rows<{ run_as: string }>(GATE, [task]);
        await refusing.tx.setContext(agentRun('HAF-1'));
        expect(gate?.run_as).toBe(ids.employeeA);
        await refusing.tx.rows(LOCK_SHARED, [ids.arma]);
        expect(await refusing.tx.rows(AGENT, ['HAF-1'])).toEqual([{ status: 'stopped' }]);
        await refusing.tx.exec(TRACE, [task, 'run_refused']);

        await opening.tx.exec(SWITCH, ['HAF-1', 'enabled']);
        const picked = settled(opening.tx.rows<Picked>(RESTART, scopeValues({ agent: 'HAF-1' })));
        await untilBlocked(opening.pid);
        await refusing.commit();
        const rows = await picked;
        expect(typeof rows === 'string' ? rows : idsOf(rows)).toEqual([task]);
        await opening.commit();
      } finally {
        await refusing.rollback();
        await opening.rollback();
      }
    }

    // (b) The opening first: the refusal waits behind it and then reads the agent open, so it
    // writes no trace (the runner opens the job again instead).
    const second = await routed();
    await setSwitch('HAF-1', 'stopped');
    {
      const opening = await openTransaction('app', founderA);
      const refusing = await openTransaction('worker', {
        companyId: ids.arma,
        agentCode: 'HAF-1',
      });
      try {
        await opening.tx.exec(SWITCH, ['HAF-1', 'enabled']);
        expect(await opening.tx.rows(RESTART, scopeValues({ agent: 'HAF-1' }))).toEqual([]);
        await refusing.tx.rows(GATE, [second]);
        await refusing.tx.setContext(agentRun('HAF-1'));
        const locked = settled(refusing.tx.rows(LOCK_SHARED, [ids.arma]));
        await untilBlocked(refusing.pid);
        await opening.commit();
        expect(await locked).toHaveLength(1);
        expect(await refusing.tx.rows(AGENT, ['HAF-1'])).toEqual([{ status: 'enabled' }]);
      } finally {
        await opening.rollback();
        await refusing.rollback();
      }
    }
  });

  it('the agent and the permission of one held request are opened at the same moment: the request is picked once', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed(ids.projectA);
    for (const order of ['agent first', 'permission first'] as const) {
      // Held by both: the agent stopped, the permission closed, and a start that was missed.
      await setSwitch('HAF-1', 'stopped');
      await adminQuery('update office.projects set ai_allowed = false where id = $1', [
        ids.projectA,
      ]);
      await asFounder((tx) => tx.exec(TRACE, [task, 'run_not_started']));

      const agent = await openTransaction('app', founderA);
      const permission = await openAdminTransaction();
      try {
        await agent.tx.exec(SWITCH, ['HAF-1', 'enabled']);
        await permission.tx.setContext({});
        await permission.tx.exec('update office.projects set ai_allowed = true where id = $1', [
          ids.projectA,
        ]);
        await asRole(permission.tx, 'app');
        await permission.tx.setContext(founderA);
        const byAgent = (): Promise<Picked[]> =>
          agent.tx.rows<Picked>(RESTART, scopeValues({ agent: 'HAF-1' }));
        const byProject = (): Promise<Picked[]> =>
          permission.tx.rows<Picked>(RESTART, scopeValues({ project: ids.projectA }));
        const [early, late] =
          order === 'agent first'
            ? ([
                { open: agent, ask: byAgent },
                { open: permission, ask: byProject },
              ] as const)
            : ([
                { open: permission, ask: byProject },
                { open: agent, ask: byAgent },
              ] as const);
        // The first sees the other switch still closed and picks nothing; the second waits for
        // the first and then sees both open.
        expect(await early.ask(), order).toEqual([]);
        const second = settled(late.ask());
        await untilBlocked(late.open.pid);
        await early.open.commit();
        const rows = await second;
        expect(typeof rows === 'string' ? rows : idsOf(rows), order).toEqual([task]);
        await late.open.commit();
      } finally {
        await agent.rollback();
        await permission.rollback();
      }
    }
    expect(await restartTraces(task)).toHaveLength(2);
  });

  it('counting writes nothing', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed();
    await setSwitch('HAF-1', 'stopped');
    await refused(task, 'HAF-1');
    const before = await auditMark();
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    expect(await waiting({ agent: 'HAF-1' })).toBe(1);
    expect(await auditMark()).toBe(before);
    expect(await restartTraces(task)).toEqual([]);
    // The work is still there for the opening.
    await setSwitch('HAF-1', 'enabled');
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
  });

  it('the founder of Pillika restarts and counts nothing of Arma DX', async () => {
    await setSwitch('HAF-1', 'enabled');
    const task = await routed(ids.projectA);
    await setSwitch('HAF-1', 'stopped');
    await refused(task, 'HAF-1', ids.projectA);
    await setSwitch('HAF-1', 'enabled');
    for (const scope of [
      { agent: 'HAF-1' },
      { project: ids.projectA },
      { customer: ids.customerA },
    ] as const) {
      expect(await waiting(scope, founderP), JSON.stringify(scope)).toBe(0);
      expect(await restart(scope, founderP), JSON.stringify(scope)).toEqual([]);
    }
    expect(await restartTraces(task)).toEqual([]);
    expect(idsOf(await restart({ agent: 'HAF-1' }))).toEqual([task]);
  });
});

// The cases that compare no moments run in one privileged transaction that goes on as the role
// whose act it is, and are rolled back.
describe.skipIf(noDatabase)('who starts waiting work again, and the hand-over of a run', () => {
  afterAll(closePools);

  async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
    await asRole(tx, 'app');
    await tx.setContext(context);
  }

  async function asWorker(tx: Tx, context: ContextInput): Promise<void> {
    await asRole(tx, 'worker');
    await tx.setContext(context);
  }

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

  /** A project request of the employee, routed to HAF-1, with the trace of a refused job. */
  async function waitingRequest(tx: Tx, project: string | null = ids.projectA): Promise<string> {
    await asPerson(tx, founderA);
    await tx.exec(SWITCH, ['HAF-1', 'enabled']);
    await tx.setContext(employeeA);
    const { id: task } = await one<{ id: string }>(tx, OPEN, [project]);
    await asWorker(tx, agentRun('KOR-1', project));
    const { id: kor } = await one<{ id: string }>(tx, RUN, [task, 'KOR-1', ids.cardKor]);
    await tx.rows('select office.route_request($1, $2::jsonb, $3)', [task, HAF_STEP, kor]);
    await tx.exec(
      `update office.runs set status = 'completed', finished_at = now() where id = $1`,
      [kor],
    );
    await tx.setContext(agentRun('HAF-1', project));
    await tx.exec(TRACE, [task, 'run_refused']);
    return task;
  }

  it('only the founder restarts and counts, only through the API, with exactly one scope', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await waitingRequest(tx);
      const agentScope = ['HAF-1', null, null];
      for (const [sql, refusal] of [
        [RESTART, 'Only the founder starts waiting work again'],
        [COUNT, 'Only the founder is told how much work waits'],
      ] as const) {
        // An employee, an employee with the approval right, a member of the project.
        for (const person of [employeeA, approverA, colleagueA]) {
          await asPerson(tx, person);
          expect(await tx.expectError(sql, agentScope), JSON.stringify(person)).toEqual({
            code: '42501',
            message: refusal,
          });
        }
        // The founder in an agent run is not the founder acting.
        await asPerson(tx, { ...founderA, agentCode: 'KOR-1' });
        expect(await tx.expectError(sql, agentScope)).toEqual({ code: '42501', message: refusal });
        // The worker's role has no privilege, whatever its context.
        await asWorker(tx, founderA);
        expect((await tx.expectError(sql, agentScope)).code).toBe('42501');
        // Exactly one scope.
        await asPerson(tx, founderA);
        for (const scope of [
          [null, null, null],
          ['HAF-1', ids.projectA, null],
          ['HAF-1', null, ids.customerA],
          [null, ids.projectA, ids.customerA],
          ['HAF-1', ids.projectA, ids.customerA],
        ]) {
          expect(await tx.expectError(sql, scope), JSON.stringify(scope)).toEqual({
            code: '22023',
            message: 'Exactly one of the agent, the project and the customer must be given',
          });
        }
      }
      // The rule behind both is the flow's own.
      for (const role of ['app', 'worker'] as const) {
        await asRole(tx, role);
        await tx.setContext(founderA);
        expect(
          (
            await tx.expectError('select * from office.flow_waiting_work($1, null, null, null)', [
              ids.arma,
            ])
          ).code,
          role,
        ).toBe('42501');
      }
      // Nothing was started by any of it.
      await asRole(tx, null);
      expect(
        await tx.count('audit_log', `record_id = $1 and event = 'run_restarted'`, [task]),
      ).toBe(0);
      await asPerson(tx, founderA);
      expect(await tx.rows(COUNT, agentScope)).toEqual([{ waiting: 1 }]);
      expect(await tx.rows(RESTART, agentScope)).toEqual([
        { task_id: task, agent_code: 'HAF-1', requester_user_id: ids.employeeA },
      ]);
    });
  });

  // The statements the API runs for an opening (packages/db/src/requests.ts) ---------------------

  it('setAgentSwitch says whether this call opened the agent', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      const switchOf = (agent: string): Promise<Record<string, unknown>[]> =>
        tx.rows(
          `select status from office.company_agents
           where company_id = office.ctx_company_id() and agent_code = $1`,
          [agent],
        );
      // The fixtures: HAF-1 is stopped in Arma DX.
      expect(await switchOf('HAF-1')).toEqual([{ status: 'stopped' }]);
      const opened = await setAgentSwitch(tx.client, 'HAF-1', 'enabled');
      expect(opened).toMatchObject({ opened: true });
      // Already open: the same call again opened nothing.
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'enabled')).toEqual({
        ...(opened as object),
        opened: false,
      });
      // A stop never opens, whatever the switch was.
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'stopped')).toMatchObject({ opened: false });
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'stopped')).toMatchObject({ opened: false });
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'enabled')).toMatchObject({ opened: true });
      // A closed switch ("disabled") is opened like a stopped one.
      await asRole(tx, null);
      await tx.exec(
        `update office.company_agents set status = 'disabled'
         where company_id = $1 and agent_code = 'HAF-1'`,
        [ids.arma],
      );
      await asPerson(tx, founderA);
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'enabled')).toMatchObject({ opened: true });

      // No row yet: Pillika never opened HAF-1. The first opening is an opening.
      await tx.setContext(founderP);
      expect(await switchOf('HAF-1')).toEqual([]);
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'enabled')).toMatchObject({ opened: true });
      expect(await switchOf('HAF-1')).toEqual([{ status: 'enabled' }]);
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'enabled')).toMatchObject({ opened: false });
      // A first row that is a stop opens nothing either.
      await tx.exec(
        `delete from office.company_agents
         where company_id = office.ctx_company_id() and agent_code = 'HAF-1'`,
      );
      expect(await setAgentSwitch(tx.client, 'HAF-1', 'stopped')).toMatchObject({ opened: false });
      // The other answers are as before.
      expect(await setAgentSwitch(tx.client, 'YOK-9', 'enabled')).toBe('unknown');
    });
  });

  it('restartWaitingWork and countWaitingWork pass exactly one scope', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await waitingRequest(tx);
      const picked = { task_id: task, agent_code: 'HAF-1', requester_user_id: ids.employeeA };
      await asPerson(tx, founderA);
      const scopes: OpeningScope[] = [
        { agentCode: 'HAF-1' },
        { projectId: ids.projectA },
        { customerId: ids.customerA },
      ];
      // Each scope finds the request by itself, and a scope that is not the request's finds none.
      for (const scope of scopes) {
        expect(await countWaitingWork(tx.client, scope), JSON.stringify(scope)).toBe(1);
      }
      for (const scope of [
        { agentCode: 'KOR-1' },
        { projectId: ids.projectANoAi },
        { customerId: ids.customerANoAi },
      ]) {
        expect(await countWaitingWork(tx.client, scope), JSON.stringify(scope)).toBe(0);
        expect(await restartWaitingWork(tx.client, scope), JSON.stringify(scope)).toEqual([]);
      }
      // Counting started nothing; every scope restarts the request, and only once.
      for (const [index, scope] of scopes.entries()) {
        const savepoint = `scope_${String(index)}`;
        await tx.exec(`savepoint ${savepoint}`);
        expect(await restartWaitingWork(tx.client, scope), JSON.stringify(scope)).toEqual([picked]);
        expect(await restartWaitingWork(tx.client, scope), JSON.stringify(scope)).toEqual([]);
        expect(await countWaitingWork(tx.client, scope), JSON.stringify(scope)).toBe(0);
        await tx.exec(`rollback to savepoint ${savepoint}`);
      }
      // Nobody but the founder gets a row or a number through the statements.
      await tx.setContext(employeeA);
      await expect(restartWaitingWork(tx.client, { agentCode: 'HAF-1' })).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('the trace run_restarted belongs to the restart: no request of the API and no agent run writes it; readers of the request get its time', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await waitingRequest(tx);
      const reserved = 'new row violates row-level security policy "reserved_restart_event"';
      await asPerson(tx, founderA);
      expect((await tx.expectError(TRACE, [task, 'run_restarted'])).message).toContain(reserved);
      await asWorker(tx, agentRun('HAF-1', ids.projectA));
      expect((await tx.expectError(TRACE, [task, 'run_restarted'])).message).toContain(reserved);
      await asWorker(tx, founderA);
      expect((await tx.expectError(TRACE, [task, 'run_restarted'])).message).toContain(reserved);
      // The other traces are written as before.
      await asPerson(tx, founderA);
      expect(await tx.exec(TRACE, [task, 'run_not_started'])).toBe(1);

      const facts = async (reader: ContextInput): Promise<unknown[]> => {
        await asPerson(tx, reader);
        return tx.rows(FACTS, [task]);
      };
      expect(await facts(founderA)).toEqual([{ restarted: false, missed: true }]);
      await asPerson(tx, founderA);
      expect(await tx.rows(RESTART, ['HAF-1', null, null])).toHaveLength(1);
      // The founder, the requester and another member of the project read when it was restarted.
      await asRole(tx, null);
      await tx.setContext({});
      await tx.exec(
        'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)',
        [ids.arma, ids.projectA, ids.approverA],
      );
      for (const reader of [founderA, employeeA, approverA]) {
        expect(await facts(reader), JSON.stringify(reader)).toEqual([
          { restarted: true, missed: false },
        ]);
      }
      // Nobody else is told anything of the request.
      for (const stranger of [colleagueA, founderP, {}]) {
        expect(await facts(stranger), JSON.stringify(stranger)).toEqual([]);
      }
      await asWorker(tx, agentRun('HAF-1', ids.projectA));
      expect((await tx.expectError(FACTS, [task])).code).toBe('42501');
    });
  });

  it('a run whose person stopped being the resolved one is handed over once, by itself, with its usage', async () => {
    const OVER = 'select office.hand_run_over($1, 10, 20, 3, 4, 0.5) as ok';
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, employeeA);
      const { id: task } = await one<{ id: string }>(tx, OPEN, [ids.projectA]);
      const { id: other } = await one<{ id: string }>(tx, OPEN, [ids.projectA]);
      const own = agentRun('KOR-1', ids.projectA);
      await asWorker(tx, own);
      const { id: run } = await one<{ id: string }>(tx, RUN, [task, 'KOR-1', ids.cardKor]);
      const { id: otherRun } = await one<{ id: string }>(tx, RUN, [other, 'KOR-1', ids.cardKor]);
      // While the requester reads the request nothing is handed over.
      expect(await tx.rows(OVER, [run])).toEqual([{ ok: false }]);

      // The founder takes the requester out of the project.
      await asPerson(tx, founderA);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
          ids.projectA,
          ids.employeeA,
        ]),
      ).toBe(1);

      // The run is hidden from its own context from that moment.
      await asWorker(tx, own);
      expect(
        await tx.exec('update office.runs set input_tokens = input_tokens + 1 where id = $1', [
          run,
        ]),
      ).toBe(0);
      expect(await tx.count('tasks', 'id = $1', [task])).toBe(0);
      // It is not a permission stop.
      expect(
        await tx.rows('select office.add_usage_to_stopped_run($1, 1, 1, 1, 1, 0.1) as ok', [run]),
      ).toEqual([{ ok: false }]);
      // Nobody else hands it over: another person, another agent, the other company.
      for (const context of [
        { ...own, userId: ids.founder },
        agentRun('HAF-1', ids.projectA),
        { ...own, companyId: ids.pillika, projectId: null },
        { companyId: ids.arma, agentCode: 'KOR-1', projectId: ids.projectA },
      ]) {
        await tx.setContext(context);
        expect(await tx.rows(OVER, [run]), JSON.stringify(context)).toEqual([{ ok: false }]);
      }
      await tx.setContext(employeeA);
      expect(await tx.expectError(OVER, [run])).toEqual({
        code: '42501',
        message: 'A run is handed over by that run',
      });
      await asPerson(tx, founderA);
      expect((await tx.expectError(OVER, [run])).code).toBe('42501');
      await asWorker(tx, own);
      for (const bad of [
        'select office.hand_run_over($1, -1, 0, 0, 0, 0)',
        'select office.hand_run_over($1, 0, 0, 0, 0, -1)',
        'select office.hand_run_over($1, 0, null, 0, 0, 0)',
      ]) {
        expect(await tx.expectError(bad, [run]), bad).toEqual({
          code: '22023',
          message: 'The usage must be given and cannot be negative',
        });
      }

      // The run itself: once.
      expect(await tx.rows(OVER, [run])).toEqual([{ ok: true }]);
      expect(await tx.rows(OVER, [run])).toEqual([{ ok: false }]);
      await asRole(tx, null);
      expect(
        await one(
          tx,
          `select status, error_code, finished_at is not null as finished, user_id, input_tokens,
                  output_tokens, cache_write_tokens, cache_read_tokens, cost_usd::text as cost_usd
           from office.runs where id = $1`,
          [run],
        ),
      ).toEqual({
        status: 'stopped',
        error_code: 'identity_changed',
        finished: true,
        // The record still says in whose name that run went.
        user_id: ids.employeeA,
        input_tokens: 10,
        output_tokens: 20,
        cache_write_tokens: 3,
        cache_read_tokens: 4,
        cost_usd: '0.500000',
      });
      // The other open run of the same person is not touched.
      expect(await tx.rows('select status from office.runs where id = $1', [otherRun])).toEqual([
        { status: 'running' },
      ]);
      expect(
        await tx.rows(
          `select event, run_id, project_id, user_id, agent_code from office.audit_log
           where record_id = $1 and event in ('run_stopped', 'run_restarted') order by id`,
          [task],
        ),
      ).toEqual([
        {
          event: 'run_stopped',
          run_id: run,
          project_id: ids.projectA,
          user_id: ids.employeeA,
          agent_code: 'KOR-1',
        },
        {
          event: 'run_restarted',
          run_id: null,
          project_id: ids.projectA,
          user_id: ids.employeeA,
          agent_code: 'KOR-1',
        },
      ]);

      // The same job then opens a run in the name the database resolves now, and that context
      // closes the other run its person lost.
      await asWorker(tx, { companyId: ids.arma, agentCode: 'KOR-1' });
      const gate = await one<{ run_as: string; project_id: string }>(
        tx,
        'select run_as, project_id from office.request_run_gate($1)',
        [task],
      );
      expect(gate).toEqual({ run_as: ids.founder, project_id: ids.projectA });
      await tx.setContext({ ...own, userId: gate.run_as });
      expect(await one(tx, `${RUN}, user_id`, [task, 'KOR-1', ids.cardKor])).toMatchObject({
        user_id: ids.founder,
      });
      expect(
        await tx.exec(
          `update office.runs set status = 'failed', finished_at = now(), error_code = 'worker_lost'
           where id = $1 and status = 'running'`,
          [otherRun],
        ),
      ).toBe(1);
    });
  });

  it('a run that is not on a request, and a run whose person is still the resolved one, are never handed over', async () => {
    await inAdminTransaction(async (tx) => {
      // The fixtures' run on a task between people, in the founder's name.
      await asWorker(tx, { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' });
      expect(
        await tx.rows('select office.hand_run_over($1, 0, 0, 0, 0, 0) as ok', [ids.runA]),
      ).toEqual([{ ok: false }]);
      await asRole(tx, null);
      expect(await tx.rows('select status from office.runs where id = $1', [ids.runA])).toEqual([
        { status: 'running' },
      ]);
    });
  });
});
