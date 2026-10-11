import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext, type ContextInput } from '../src/context.ts';
import { ids, TOOL } from './fixtures.ts';
import {
  adminQuery,
  appPool,
  asRole,
  auditMark,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  openTransaction,
  removeRequests,
  untilBlocked,
  workerPool,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// Rule 12 while a request is under way (CLAUDE.md rules 9 and 12; 8 October decisions 46 to 48).
// A request inside a project is carried out in the context of that project; the runner asks the
// database at the start of every run in whose name and in which project the run goes and whether
// agents may work there (office.request_run_gate). When an AI permission is closed the open runs
// of its projects are closed in the same transaction, and nothing of such a project is approved
// until the permission is open again.
//
// A request is opened by a person through the API's role and a run by the worker's role; a row
// one role did not commit is not there for the other. Most cases run in one privileged transaction
// that goes on as the role whose act it is (asRole) and is rolled back. The cases where two
// transactions meet commit, remove their requests again and put the permission back.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const colleagueA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };

function agentRun(
  agentCode: string,
  userId: string | null = null,
  projectId: string | null = null,
  companyId: string = ids.arma,
): ContextInput {
  return { companyId, agentCode, userId, projectId };
}

const GATE = 'select run_as, project_id, ai_allowed from office.request_run_gate($1)';
const RUN = `insert into office.runs
    (company_id, task_id, agent_code, card_version_id, trigger_type, model)
  values (office.ctx_company_id(), $1, $2, $3, 'request', 'test-model')
  returning id, user_id, project_id`;
const HAF_STEP = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Belongs to memory' }]);
const SUBMIT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
    payload, basis_type, basis_id, basis_version, involves_money, goes_external)
  values (office.ctx_company_id(), $1, $2, 'HAF-1', 'Result', '{"text": "Output"}', 'task', $1,
    (select version from office.tasks where id = $1), false, $3) returning id`;
const SET_PROJECT = 'select office.set_project_ai_permission($1, $2, $3) as changed';
const SET_CUSTOMER = 'select office.set_customer_permissions($1, $2, null)';
const ADD_USAGE = 'select office.add_usage_to_stopped_run($1, 10, 20, 3, 4, 0.5) as ok';
const HELD = {
  code: '55000',
  message: 'Nothing of a project is approved while agents may not work in it',
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

async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'app');
  await tx.setContext(context);
}

async function asWorker(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'worker');
  await tx.setContext(context);
}

/** The privileged role without a person in the context, as an administrator writes. */
async function asAdministrator(tx: Tx): Promise<void> {
  await asRole(tx, null);
  await tx.setContext({});
}

const OPEN = `insert into office.tasks (company_id, project_id, kind, title, description)
  values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted') returning id`;

/** A person opens a request, through the API's role. */
async function requestOf(
  tx: Tx,
  person: ContextInput,
  project: string | null = null,
): Promise<string> {
  await asPerson(tx, person);
  return (await one<{ id: string }>(tx, OPEN, [project])).id;
}

async function openRun(tx: Tx, task: string, agent: 'KOR-1' | 'HAF-1') {
  return one<{ id: string; user_id: string; project_id: string | null }>(tx, RUN, [
    task,
    agent,
    agent === 'KOR-1' ? ids.cardKor : ids.cardHaf,
  ]);
}

async function enableHaf(tx: Tx): Promise<void> {
  await asPerson(tx, founderA);
  await tx.exec(
    `update office.company_agents set status = 'enabled'
     where company_id = $1 and agent_code = 'HAF-1'`,
    [ids.arma],
  );
}

const closeRun = (tx: Tx, run: string): Promise<number> =>
  tx.exec(`update office.runs set status = 'completed', finished_at = now() where id = $1`, [run]);

/**
 * Walks a request of the employee to a result HAF-1 submitted: routed by KOR-1 from its own run,
 * worked on by HAF-1, every run in the context of the request's project.
 */
async function submitted(
  tx: Tx,
  project: string | null = ids.projectA,
  goesExternal = false,
): Promise<{ task: string; kor: string; haf: string; approval: string }> {
  await enableHaf(tx);
  const task = await requestOf(tx, employeeA, project);
  await asWorker(tx, agentRun('KOR-1', ids.employeeA, project));
  const kor = await openRun(tx, task, 'KOR-1');
  await tx.rows('select office.route_request($1, $2::jsonb, $3)', [task, HAF_STEP, kor.id]);
  await closeRun(tx, kor.id);
  await tx.setContext(agentRun('HAF-1', ids.employeeA, project));
  const haf = await openRun(tx, task, 'HAF-1');
  const approval = await one<{ id: string }>(tx, SUBMIT, [task, haf.id, goesExternal]);
  await closeRun(tx, haf.id);
  return { task, kor: kor.id, haf: haf.id, approval: approval.id };
}

const runOf = (tx: Tx, run: string) =>
  one<{ status: string; error_code: string | null; finished: boolean }>(
    tx,
    'select status, error_code, finished_at is not null as finished from office.runs where id = $1',
    [run],
  );

describe.skipIf(noDatabase)('rule 12 while a request is under way', () => {
  afterAll(closePools);

  it('the run gate answers an agent run of the request’s company and nobody else', async () => {
    await inAdminTransaction(async (tx) => {
      const inside = await requestOf(tx, employeeA, ids.projectA);
      const outside = await requestOf(tx, employeeA);
      const answers = async (): Promise<unknown[]> => [
        await tx.rows(GATE, [inside]),
        await tx.rows(GATE, [outside]),
      ];
      const named = [
        [{ run_as: ids.employeeA, project_id: ids.projectA, ai_allowed: true }],
        [{ run_as: ids.employeeA, project_id: null, ai_allowed: true }],
      ];
      // The runner asks with the company and the agent and no person; a person in the context is
      // not read.
      for (const person of [null, ids.employeeA, ids.founder, ids.sharedEmployee, ids.externalA]) {
        await asWorker(tx, agentRun('KOR-1', person));
        expect(await answers(), String(person)).toEqual(named);
        await tx.setContext(agentRun('HAF-1', person, ids.projectANoAi));
        expect(await answers(), String(person)).toEqual(named);
      }
      // Nobody else is answered: a person (no agent), the other company, no context at all.
      for (const context of [
        employeeA,
        founderA,
        agentRun('KOR-1', null, null, ids.pillika),
        agentRun('KOR-1', ids.founder, null, ids.pillika),
        {},
      ]) {
        await tx.setContext(context);
        expect(await answers(), JSON.stringify(context)).toEqual([[], []]);
      }
      // A task between people is no request, and a request of the other company is none of this
      // company's.
      await tx.setContext(agentRun('KOR-1'));
      expect(await tx.rows(GATE, [ids.taskA])).toEqual([]);
      expect(await tx.rows(GATE, [ids.requestP])).toEqual([]);
      // The API's role is answered in an agent context like the worker's.
      await asRole(tx, 'app');
      await tx.setContext(agentRun('KOR-1'));
      expect(await answers()).toEqual(named);
      // The question behind the gate is the flow's own.
      for (const role of ['app', 'worker'] as const) {
        await asRole(tx, role);
        await tx.setContext(founderA);
        expect(
          (await tx.expectError('select office.project_allows_ai($1)', [ids.projectA])).code,
          role,
        ).toBe('42501');
      }
    });
  });

  it('the gate says no for a project without the permission, its own or its customer’s, and names the project', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx, employeeA, ids.projectA);
      const gate = async (): Promise<unknown[]> => {
        await asWorker(tx, agentRun('KOR-1'));
        return tx.rows(GATE, [task]);
      };
      const answer = (allowed: boolean) => [
        { run_as: ids.employeeA, project_id: ids.projectA, ai_allowed: allowed },
      ];
      expect(await gate()).toEqual(answer(true));
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_allowed = false where id = $1', [ids.projectA]);
      expect(await gate()).toEqual(answer(false));
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_allowed = true where id = $1', [ids.projectA]);
      await tx.exec('update office.customers set ai_allowed = false where id = $1', [
        ids.customerA,
      ]);
      expect(await gate()).toEqual(answer(false));
      await asAdministrator(tx);
      await tx.exec('update office.customers set ai_allowed = true where id = $1', [ids.customerA]);
      expect(await gate()).toEqual(answer(true));
      // A closed project lets its open requests run on (8 October decision 48).
      await asPerson(tx, employeeA);
      await tx.exec(`update office.projects set status = 'cancelled' where id = $1`, [
        ids.projectA,
      ]);
      expect(await gate()).toEqual(answer(true));
    });
  });

  it('a run of a project request needs the project’s context, carries the project and sees that project only', async () => {
    await inAdminTransaction(async (tx) => {
      await enableHaf(tx);
      const inside = await requestOf(tx, employeeA, ids.projectA);
      const outside = await requestOf(tx, employeeA);
      // Without the project in its context the run does not see the request.
      await asWorker(tx, agentRun('KOR-1', ids.employeeA));
      expect(await tx.count('tasks', 'id = $1', [inside])).toBe(0);
      expect((await tx.expectError(RUN, [inside, 'KOR-1', ids.cardKor])).code).toBe('23503');
      // With a project in its context it cannot run on a request that has none.
      await tx.setContext(agentRun('KOR-1', ids.employeeA, ids.projectA));
      expect((await tx.expectError(RUN, [outside, 'KOR-1', ids.cardKor])).code).toBe('23514');
      // With the request's own project every record of the flow carries it.
      const kor = await openRun(tx, inside, 'KOR-1');
      expect(kor.project_id).toBe(ids.projectA);
      await tx.rows('select office.route_request($1, $2::jsonb, $3)', [inside, HAF_STEP, kor.id]);
      await tx.exec(
        `insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
         values (office.ctx_company_id(), $1, 1, $2, 'succeeded')`,
        [kor.id, TOOL.read],
      );
      await closeRun(tx, kor.id);
      await tx.setContext(agentRun('HAF-1', ids.employeeA, ids.projectA));
      const haf = await openRun(tx, inside, 'HAF-1');
      const approval = await one<{ id: string }>(tx, SUBMIT, [inside, haf.id, false]);
      await asRole(tx, null);
      for (const [table, condition, value] of [
        ['runs', 'task_id = $1', inside],
        ['tool_calls', 'run_id = $1', kor.id],
        ['task_routings', 'task_id = $1', inside],
        ['approvals', 'id = $1', approval.id],
      ] as const) {
        expect(
          await tx.rows(`select distinct project_id from office.${table} where ${condition}`, [
            value,
          ]),
          table,
        ).toEqual([{ project_id: ids.projectA }]);
      }
      // What that run reads: its project and what belongs to no project; nothing of another
      // project and nothing of the other company.
      await asWorker(tx, agentRun('HAF-1', ids.employeeA, ids.projectA));
      expect(await tx.count('tasks', 'id = any ($1::uuid[])', [[inside, outside]])).toBe(2);
      expect(await tx.count('tasks', 'id = $1', [ids.taskAProject])).toBe(1);
      expect(await tx.count('tasks', 'project_id = $1', [ids.projectANoAi])).toBe(0);
      expect(await tx.count('projects', 'id <> $1', [ids.projectA])).toBe(0);
      expect(await tx.count('tasks', 'company_id = $1', [ids.pillika])).toBe(0);
      expect(await tx.count('runs', 'company_id = $1', [ids.pillika])).toBe(0);
    });
  });

  it('closing a project’s AI permission closes its open runs in the same transaction and no other run', async () => {
    await inAdminTransaction(async (tx) => {
      const inside = await requestOf(tx, employeeA, ids.projectA);
      const outside = await requestOf(tx, employeeA);
      await asWorker(tx, agentRun('KOR-1', ids.employeeA, ids.projectA));
      const held = await openRun(tx, inside, 'KOR-1');
      await tx.setContext(agentRun('KOR-1', ids.employeeA));
      const free = await openRun(tx, outside, 'KOR-1');
      await asRole(tx, null);
      const before = await one<{ id: string }>(
        tx,
        'select coalesce(max(id), 0)::text as id from office.audit_log',
      );

      await asPerson(tx, founderA);
      expect(await tx.rows(SET_PROJECT, [ids.projectA, false, null])).toEqual([{ changed: true }]);

      await asRole(tx, null);
      expect(await runOf(tx, held.id)).toEqual({
        status: 'stopped',
        error_code: 'ai_permission_closed',
        finished: true,
      });
      expect(await runOf(tx, free.id)).toEqual({
        status: 'running',
        error_code: null,
        finished: false,
      });
      // One trace per stopped run, in the name of the person who closed the permission. The
      // fixtures hold one more open run in this project, on a task between people: every open
      // run of the project is closed, whatever it works on.
      expect(await runOf(tx, ids.runAProject)).toMatchObject({
        status: 'stopped',
        error_code: 'ai_permission_closed',
      });
      expect(
        await tx.rows(
          `select event, run_id, record_type, record_id, project_id, user_id, agent_code
           from office.audit_log where id > $1 and event = 'run_stopped' order by id`,
          [before.id],
        ),
      ).toEqual(
        expect.arrayContaining(
          [
            [held.id, inside],
            [ids.runAProject, ids.taskAProject],
          ].map(([run, task]) => ({
            event: 'run_stopped',
            run_id: run,
            record_type: 'task',
            record_id: task,
            project_id: ids.projectA,
            user_id: ids.founder,
            agent_code: null,
          })),
        ),
      );
      expect(await tx.count('audit_log', `id > $1 and event = 'run_stopped'`, [before.id])).toBe(2);
      // A run of the same company outside the project, and the fixtures' own, stay open.
      expect(await runOf(tx, ids.runA)).toMatchObject({ status: 'running' });
      // The request itself is not touched: it stays open.
      expect(await tx.rows('select status from office.tasks where id = $1', [inside])).toEqual([
        { status: 'in_progress' },
      ]);
    });
  });

  it('closing a customer’s AI permission closes the open runs of every project of that customer', async () => {
    await inAdminTransaction(async (tx) => {
      // A second project of the same customer and one without a customer, the employee a member
      // of both.
      await asAdministrator(tx);
      const second = await one<{ id: string }>(
        tx,
        `insert into office.projects (company_id, customer_id, name, ai_allowed)
         values ($1, $2, 'Second project of the customer', true) returning id`,
        [ids.arma, ids.customerA],
      );
      const other = await one<{ id: string }>(
        tx,
        `insert into office.projects (company_id, customer_id, name, ai_allowed)
         values ($1, null, 'A project without a customer', true) returning id`,
        [ids.arma],
      );
      await tx.exec(
        `insert into office.project_members (company_id, project_id, user_id)
         values ($1, $2, $4), ($1, $3, $4)`,
        [ids.arma, second.id, other.id, ids.employeeA],
      );
      const runs: Record<string, string> = {};
      for (const project of [ids.projectA, second.id, other.id]) {
        const task = await requestOf(tx, employeeA, project);
        await asWorker(tx, agentRun('KOR-1', ids.employeeA, project));
        runs[project] = (await openRun(tx, task, 'KOR-1')).id;
      }
      await asPerson(tx, founderA);
      await tx.rows(SET_CUSTOMER, [ids.customerA, false]);
      await asRole(tx, null);
      for (const project of [ids.projectA, second.id]) {
        expect(await runOf(tx, runs[project] ?? '')).toEqual({
          status: 'stopped',
          error_code: 'ai_permission_closed',
          finished: true,
        });
      }
      expect(await runOf(tx, runs[other.id] ?? '')).toMatchObject({ status: 'running' });
      // The other permission of the customer moves no run.
      await asPerson(tx, founderA);
      await tx.rows('select office.set_customer_permissions($1, null, true)', [ids.customerA]);
      await asRole(tx, null);
      expect(await runOf(tx, runs[other.id] ?? '')).toMatchObject({ status: 'running' });
    });
  });

  it('a close made without a person in the context closes the runs too', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx, employeeA, ids.projectA);
      await asWorker(tx, agentRun('KOR-1', ids.employeeA, ids.projectA));
      const run = await openRun(tx, task, 'KOR-1');
      await asAdministrator(tx);
      // An update that names other columns too, as an administrator's statement may.
      await tx.exec(
        `update office.projects set ai_allowed = false, description = 'Closed by hand'
         where id = $1`,
        [ids.projectA],
      );
      expect(await runOf(tx, run.id)).toEqual({
        status: 'stopped',
        error_code: 'ai_permission_closed',
        finished: true,
      });
      expect(
        await tx.rows(
          `select user_id, agent_code from office.audit_log
           where event = 'run_stopped' and run_id = $1`,
          [run.id],
        ),
      ).toEqual([{ user_id: null, agent_code: null }]);
    });
  });

  it('from that moment the worker neither sees nor closes such a run', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx, employeeA, ids.projectA);
      const own = agentRun('KOR-1', ids.employeeA, ids.projectA);
      await asWorker(tx, own);
      const run = await openRun(tx, task, 'KOR-1');
      await asPerson(tx, founderA);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      await asWorker(tx, own);
      expect(await tx.count('runs', 'id = $1', [run.id])).toBe(0);
      expect(await tx.count('tasks', 'id = $1', [task])).toBe(0);
      expect(
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = now() where id = $1`,
          [run.id],
        ),
      ).toBe(0);
      expect(
        await tx.exec('update office.runs set input_tokens = input_tokens + 10 where id = $1', [
          run.id,
        ]),
      ).toBe(0);
      // A new run is not opened either: the gate says why, and the insert is refused.
      await tx.setContext(agentRun('KOR-1'));
      expect(await tx.rows(GATE, [task])).toEqual([
        { run_as: ids.employeeA, project_id: ids.projectA, ai_allowed: false },
      ]);
      await tx.setContext(own);
      expect((await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).code).toBe('23503');
      await asRole(tx, null);
      expect(await runOf(tx, run.id)).toMatchObject({
        status: 'stopped',
        error_code: 'ai_permission_closed',
      });
    });
  });

  it('nothing of a project is approved while agents may not work in it; it is rejected, stopped or approved later', async () => {
    const approve = `update office.approvals set status = 'approved' where id = $1`;
    await inAdminTransaction(async (tx) => {
      // Rejected while the permission is closed: the request closes and its requester is told.
      const first = await submitted(tx);
      await asPerson(tx, founderA);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      expect(await tx.expectError(approve, [first.approval])).toEqual(HELD);
      // The result stays readable and its summary can still be corrected.
      expect(await tx.count('approvals', `id = $1 and status = 'pending'`, [first.approval])).toBe(
        1,
      );
      expect(
        await tx.exec(
          `update office.approvals
           set status = 'rejected', rejection_reason = 'incomplete', decision_reason = 'No'
           where id = $1`,
          [first.approval],
        ),
      ).toBe(1);
      await asRole(tx, null);
      expect(await tx.rows('select status from office.tasks where id = $1', [first.task])).toEqual([
        { status: 'cancelled' },
      ]);
      expect(
        await tx.rows(
          `select recipient_user_id, template from office.notifications
           where record_type = 'task' and record_id = $1`,
          [first.task],
        ),
      ).toEqual([{ recipient_user_id: ids.employeeA, template: 'request_rejected' }]);
    });
    await inAdminTransaction(async (tx) => {
      // The customer's permission holds a result like the project's own; the request is stopped.
      const second = await submitted(tx);
      await asPerson(tx, founderA);
      await tx.rows(SET_CUSTOMER, [ids.customerA, false]);
      expect(await tx.expectError(approve, [second.approval])).toEqual(HELD);
      await tx.rows('select office.close_request($1, $2)', [second.task, 'Not needed any more']);
      await asRole(tx, null);
      expect(await tx.rows('select status from office.tasks where id = $1', [second.task])).toEqual(
        [{ status: 'cancelled' }],
      );
    });
    await inAdminTransaction(async (tx) => {
      // Approved once the permission is open again.
      const third = await submitted(tx);
      await asPerson(tx, founderA);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      expect(await tx.expectError(approve, [third.approval])).toEqual(HELD);
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_allowed = true where id = $1', [ids.projectA]);
      await asPerson(tx, founderA);
      expect(await tx.exec(approve, [third.approval])).toBe(1);
      expect(
        await tx.count('requester_approvals', `task_id = $1 and status = 'pending'`, [third.task]),
      ).toBe(1);
      // A result outside a project is never held.
      const plain = await submitted(tx, null);
      await asPerson(tx, founderA);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      expect(await tx.exec(approve, [plain.approval])).toBe(1);
    });
  });

  it('the hold answers before the passkey: a refused approval uses no re-verification up', async () => {
    const approve = `update office.approvals set status = 'approved' where id = $1`;
    await inAdminTransaction(async (tx) => {
      // A result that goes outside the company: approving it asks for the founder's passkey.
      const { approval } = await submitted(tx, ids.projectA, true);
      await asPerson(tx, founderA);
      expect(
        await tx.rows('select office.approval_needs_step_up($1) as needed', [approval]),
      ).toEqual([{ needed: true }]);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      // Without a re-verification the answer is the hold, not the missing passkey.
      expect(await tx.expectError(approve, [approval])).toEqual(HELD);
      const verified = await stepUp(tx, founderA, 'approve', approval);
      expect(await tx.expectError(approve, [approval])).toEqual(HELD);
      await asRole(tx, null);
      expect(
        await tx.rows('select consumed_at is null as unused from office.step_ups where id = $1', [
          verified,
        ]),
      ).toEqual([{ unused: true }]);
      // With the permission open again the same re-verification approves.
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_allowed = true where id = $1', [ids.projectA]);
      await asPerson(tx, founderA);
      expect(await tx.exec(approve, [approval])).toBe(1);
      await asRole(tx, null);
      expect(
        await tx.rows('select consumed_at is null as unused from office.step_ups where id = $1', [
          verified,
        ]),
      ).toEqual([{ unused: false }]);
    });
    await inAdminTransaction(async (tx) => {
      // With the permission open and no re-verification the answer is the passkey's.
      const { approval } = await submitted(tx, ids.projectA, true);
      await asPerson(tx, founderA);
      expect((await tx.expectError(approve, [approval])).code).toBe('28000');
    });
  });

  it('an approved result is accepted by its requester while the permission is closed', async () => {
    await inAdminTransaction(async (tx) => {
      const { task, approval } = await submitted(tx);
      await asPerson(tx, founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      await tx.setContext(employeeA);
      expect(
        await tx.exec(
          `update office.requester_approvals set status = 'approved'
           where task_id = $1 and status = 'pending'`,
          [task],
        ),
      ).toBe(1);
      expect(await tx.rows('select status from office.tasks where id = $1', [task])).toEqual([
        { status: 'done' },
      ]);
    });
  });

  it('the usage of a call answered after the close is added to the stopped run by its own run and by nobody else', async () => {
    const usage = (tx: Tx, run: string) =>
      one(
        tx,
        `select input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
                cost_usd::text as cost_usd
         from office.runs where id = $1`,
        [run],
      );
    const none = {
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: '0.000000',
    };
    await inAdminTransaction(async (tx) => {
      const inside = await requestOf(tx, employeeA, ids.projectA);
      const outside = await requestOf(tx, employeeA);
      const own = agentRun('KOR-1', ids.employeeA, ids.projectA);
      await asWorker(tx, own);
      const run = await openRun(tx, inside, 'KOR-1');
      await tx.setContext(agentRun('KOR-1', ids.employeeA));
      const plain = await openRun(tx, outside, 'KOR-1');
      // While the run is open the function takes nothing: the run writes its own numbers.
      await tx.setContext(own);
      expect(await tx.rows(ADD_USAGE, [run.id])).toEqual([{ ok: false }]);

      await asPerson(tx, founderA);
      await tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      // A person is not a run, through either role.
      expect((await tx.expectError(ADD_USAGE, [run.id])).code).toBe('42501');
      await asWorker(tx, founderA);
      expect((await tx.expectError(ADD_USAGE, [run.id])).code).toBe('42501');
      // Another name, another agent, the other company: nothing is taken.
      for (const context of [
        agentRun('KOR-1', ids.founder, ids.projectA),
        agentRun('HAF-1', ids.employeeA, ids.projectA),
        agentRun('KOR-1', ids.employeeA, null, ids.pillika),
        agentRun('KOR-1', null, ids.projectA),
      ]) {
        await tx.setContext(context);
        expect(await tx.rows(ADD_USAGE, [run.id]), JSON.stringify(context)).toEqual([
          { ok: false },
        ]);
      }
      // A run that is still open, or that was stopped for another reason, takes nothing.
      await tx.setContext(agentRun('KOR-1', ids.employeeA));
      expect(await tx.rows(ADD_USAGE, [plain.id])).toEqual([{ ok: false }]);
      await tx.exec(
        `update office.runs set status = 'stopped', finished_at = now(),
           error_code = 'agent_stopped' where id = $1`,
        [plain.id],
      );
      expect(await tx.rows(ADD_USAGE, [plain.id])).toEqual([{ ok: false }]);
      await asRole(tx, null);
      expect(await usage(tx, run.id)).toEqual(none);
      expect(await usage(tx, plain.id)).toEqual(none);

      // The run itself: its own update finds no row, the function adds exactly the numbers.
      await asWorker(tx, own);
      expect(
        await tx.exec('update office.runs set input_tokens = input_tokens + 10 where id = $1', [
          run.id,
        ]),
      ).toBe(0);
      for (const bad of [
        'select office.add_usage_to_stopped_run($1, -1, 0, 0, 0, 0)',
        'select office.add_usage_to_stopped_run($1, 0, 0, 0, 0, -0.1)',
        'select office.add_usage_to_stopped_run($1, null, 0, 0, 0, 0)',
        'select office.add_usage_to_stopped_run($1, 0, 0, 0, 0, null)',
      ]) {
        expect((await tx.expectError(bad, [run.id])).code, bad).toBe('22023');
      }
      expect((await tx.expectError(ADD_USAGE.replace('$1', 'null'))).code).toBe('22023');
      expect(await tx.rows(ADD_USAGE, [run.id])).toEqual([{ ok: true }]);
      expect(await tx.rows(ADD_USAGE, [run.id])).toEqual([{ ok: true }]);
      await asRole(tx, null);
      expect(await usage(tx, run.id)).toEqual({
        input_tokens: 20,
        output_tokens: 40,
        cache_write_tokens: 6,
        cache_read_tokens: 8,
        cost_usd: '1.000000',
      });
      expect(await runOf(tx, run.id)).toMatchObject({
        status: 'stopped',
        error_code: 'ai_permission_closed',
      });
    });
  });

  it('a request that was open when its project was closed runs on to its end', async () => {
    for (const status of ['completed', 'cancelled']) {
      await inAdminTransaction(async (tx) => {
        await enableHaf(tx);
        const task = await requestOf(tx, employeeA, ids.projectA);
        const again = await requestOf(tx, employeeA, ids.projectA);
        // A member closes the project (docs/SONRA.md P1b-i).
        await asPerson(tx, employeeA);
        await tx.exec('update office.projects set status = $2 where id = $1', [
          ids.projectA,
          status,
        ]);
        expect((await tx.expectError(OPEN, [ids.projectA])).message, status).toBe(
          'A closed project takes no new request',
        );
        await asWorker(tx, agentRun('KOR-1'));
        expect(await tx.rows(GATE, [task]), status).toEqual([
          { run_as: ids.employeeA, project_id: ids.projectA, ai_allowed: true },
        ]);

        // The whole flow: routed, worked on, approved, accepted.
        const walk = async (request: string): Promise<string> => {
          await asWorker(tx, agentRun('KOR-1', ids.employeeA, ids.projectA));
          const kor = await openRun(tx, request, 'KOR-1');
          expect(kor.project_id).toBe(ids.projectA);
          await tx.rows('select office.route_request($1, $2::jsonb, $3)', [
            request,
            HAF_STEP,
            kor.id,
          ]);
          await closeRun(tx, kor.id);
          await tx.setContext(agentRun('HAF-1', ids.employeeA, ids.projectA));
          const haf = await openRun(tx, request, 'HAF-1');
          const approval = await one<{ id: string }>(tx, SUBMIT, [request, haf.id, false]);
          await closeRun(tx, haf.id);
          return approval.id;
        };
        const approval = await walk(task);
        await asPerson(tx, founderA);
        expect(
          await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
            approval,
          ]),
        ).toBe(1);
        await tx.setContext(employeeA);
        expect(
          await tx.exec(
            `update office.requester_approvals set status = 'approved'
             where task_id = $1 and status = 'pending'`,
            [task],
          ),
        ).toBe(1);
        await asRole(tx, null);
        expect(await tx.rows('select status from office.tasks where id = $1', [task])).toEqual([
          { status: 'done' },
        ]);
        expect(
          await tx.rows('select status, closed from office.projects where id = $1', [ids.projectA]),
        ).toEqual([{ status, closed: true }]);

        // A change request of the approver calls for the work again: the step is active again.
        const second = await walk(again);
        await asPerson(tx, founderA);
        expect(
          await tx.exec(
            `update office.approvals
             set status = 'changes_requested', rejection_reason = 'incomplete'
             where id = $1`,
            [second],
          ),
        ).toBe(1);
        expect(
          await tx.rows(
            `select t.status, s.status as step from office.tasks t
             join office.task_routings s on s.task_id = t.id where t.id = $1`,
            [again],
          ),
        ).toEqual([{ status: 'in_progress', step: 'active' }]);
        await asWorker(tx, agentRun('HAF-1', ids.employeeA, ids.projectA));
        expect((await openRun(tx, again, 'HAF-1')).project_id).toBe(ids.projectA);
      });
    }
  });
});

// Two transactions at once: the gate against a close, and a run's last records against a close.
// These commit; every request is removed again and the permission is put back.
describe.skipIf(noDatabase)('rule 12 across transactions', () => {
  const tasks: string[] = [];
  let mark = '0';

  beforeAll(async () => {
    mark = await auditMark();
  });

  const restore = (): Promise<unknown> =>
    adminQuery('update office.projects set ai_allowed = true where id = $1', [ids.projectA]);

  afterAll(async () => {
    await restore();
    await removeRequests(tasks, mark);
    await closePools();
  });

  const inProject: ContextInput = agentRun('KOR-1', ids.employeeA, ids.projectA);

  /** A project request of employee A, committed. */
  async function openRequest(): Promise<string> {
    const id = await withContext(appPool(), employeeA, async (client) => {
      const { rows } = await client.query<{ id: string }>(OPEN, [ids.projectA]);
      return rows[0]?.id ?? '';
    });
    tasks.push(id);
    return id;
  }

  /** A run of KOR-1 on the request, committed and left running. */
  async function committedRun(task: string): Promise<string> {
    return withContext(workerPool(), inProject, async (client) => {
      const { rows } = await client.query<{ id: string }>(RUN, [task, 'KOR-1', ids.cardKor]);
      return rows[0]?.id ?? '';
    });
  }

  /** How a statement that was started without being awaited ended: 'ok' or the error's code. */
  function outcomeOf(statement: Promise<unknown>): Promise<string> {
    return statement.then(
      () => 'ok',
      (error: unknown) => (error as { code?: string }).code ?? 'error',
    );
  }

  const stateOf = async (run: string): Promise<unknown> =>
    (await adminQuery('select status, error_code from office.runs where id = $1', [run]))[0];

  const allowed = async (): Promise<unknown> =>
    (await adminQuery('select ai_allowed from office.projects where id = $1', [ids.projectA]))[0];

  it('a permission close waits for the opening of a run, and the run it committed is closed', async () => {
    const task = await openRequest();
    const opening = await openTransaction('worker', agentRun('KOR-1'));
    const closing = await openTransaction('app', founderA);
    try {
      // The runner asks the gate inside the transaction that opens the run.
      expect(await opening.tx.rows(GATE, [task])).toEqual([
        { run_as: ids.employeeA, project_id: ids.projectA, ai_allowed: true },
      ]);
      const close = outcomeOf(closing.tx.rows(SET_PROJECT, [ids.projectA, false, null]));
      await untilBlocked(closing.pid);
      await opening.tx.setContext(inProject);
      const run = await one<{ id: string }>(opening.tx, RUN, [task, 'KOR-1', ids.cardKor]);
      await opening.commit();
      expect(await close).toBe('ok');
      await closing.commit();
      expect(await stateOf(run.id)).toEqual({
        status: 'stopped',
        error_code: 'ai_permission_closed',
      });
      expect(await allowed()).toEqual({ ai_allowed: false });
    } finally {
      await opening.rollback();
      await closing.rollback();
      await restore();
    }
  });

  it('the gate waits for a close that is not committed and then says no', async () => {
    const task = await openRequest();
    const closing = await openTransaction('app', founderA);
    const opening = await openTransaction('worker', agentRun('KOR-1'));
    try {
      await closing.tx.rows(SET_PROJECT, [ids.projectA, false, null]);
      const asked = opening.tx.rows(GATE, [task]);
      await untilBlocked(opening.pid);
      await closing.commit();
      expect(await asked).toEqual([
        { run_as: ids.employeeA, project_id: ids.projectA, ai_allowed: false },
      ]);
    } finally {
      await opening.rollback();
      await closing.rollback();
      await restore();
    }
  });

  it('two gates do not wait for each other', async () => {
    const task = await openRequest();
    const first = await openTransaction('worker', agentRun('KOR-1'));
    const second = await openTransaction('worker', agentRun('HAF-1'));
    try {
      expect(await first.tx.rows(GATE, [task])).toHaveLength(1);
      expect(await second.tx.rows(GATE, [task])).toHaveLength(1);
    } finally {
      await first.rollback();
      await second.rollback();
    }
  });

  it('the lock of a request is taken for a reader of the project request and for nobody else', async () => {
    const task = await openRequest();
    const taken = async (): Promise<string> => {
      const looking = await openTransaction('app', founderA);
      try {
        return await outcomeOf(
          looking.tx.rows('select 1 from office.tasks where id = $1 for update nowait', [task]),
        );
      } finally {
        await looking.rollback();
      }
    };
    for (const [person, locked] of [
      [colleagueA, 'ok'],
      [founderP, 'ok'],
      [employeeA, '55P03'],
      [founderA, '55P03'],
    ] as const) {
      const acting = await openTransaction('app', person);
      try {
        await acting.tx.rows('select office.lock_request($1)', [task]);
        expect(await taken(), JSON.stringify(person)).toBe(locked);
      } finally {
        await acting.rollback();
      }
    }
  });

  it('a run that writes its last records while the permission is being closed: neither waits for ever and neither fails', async () => {
    const lastRecords = {
      audit: `insert into office.audit_log (company_id, project_id, event, record_type, record_id,
                run_id)
              values (office.ctx_company_id(), office.ctx_project_id(), 'run_completed', 'task',
                $1, $2)`,
      toolCall: `insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
                 select office.ctx_company_id(), $2, 1, '${TOOL.read}', 'succeeded'
                 where $1::uuid is not null`,
    };
    for (const record of ['audit', 'toolCall'] as const) {
      const task = await openRequest();
      const run = await committedRun(task);
      const finishing = await openTransaction('worker', inProject);
      const closing = await openTransaction('app', founderA);
      try {
        // The run closes itself first and keeps its transaction open.
        expect(
          await finishing.tx.exec(
            `update office.runs set status = 'completed', finished_at = now()
             where id = $1 and status = 'running'`,
            [run],
          ),
        ).toBe(1);
        const close = outcomeOf(closing.tx.rows(SET_PROJECT, [ids.projectA, false, null]));
        await untilBlocked(closing.pid);
        // A row that names the project (its foreign key locks the project row): written at
        // once. With a stronger lock in the close the two would end in a deadlock.
        await finishing.tx.exec(lastRecords[record], [task, run]);
        await finishing.commit();
        expect(await close, record).toBe('ok');
        await closing.commit();
        expect(await allowed(), record).toEqual({ ai_allowed: false });
        // The run closed itself before the close reached it.
        expect(await stateOf(run), record).toEqual({ status: 'completed', error_code: null });
      } finally {
        await finishing.rollback();
        await closing.rollback();
        await restore();
      }
    }
  });
});

// Kept apart from the cases above: what a person and the worker's role cannot do to a project
// through the new objects, with the two restricted roles as they are.
describe.skipIf(noDatabase)('rule 12: the new objects belong to the flow', () => {
  afterAll(closePools);

  it('nobody stops a run, writes its trace or adds usage by hand', async () => {
    await inTransaction(async (tx) => {
      for (const context of [founderA, colleagueA, founderP]) {
        await tx.setContext(context);
        for (const sql of [
          'select office.stop_runs_without_ai_permission()',
          'select office.hold_result_without_ai_permission()',
        ]) {
          expect((await tx.expectError(sql)).code).toBe('42501');
        }
      }
    });
    await inWorkerTransaction(async (tx) => {
      // The worker's role with the founder's name closes no permission.
      await tx.setContext(founderA);
      expect((await tx.expectError(SET_PROJECT, [ids.projectA, false, null])).code).toBe('42501');
      expect((await tx.expectError(SET_CUSTOMER, [ids.customerA, false])).code).toBe('42501');
      expect(
        (
          await tx.expectError('update office.projects set ai_allowed = false where id = $1', [
            ids.projectA,
          ])
        ).code,
      ).toBe('42501');
    });
  });
});
