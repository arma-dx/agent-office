import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import {
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// Flow (A): a request that agents carry out (7 October decisions 1 to 7). The database is the one
// place no path can skip, so the rules of the flow are tested here with the restricted roles: who
// opens a request, who routes it, who approves, how the status follows the records, and that a
// company's person or agent never reaches another company's request.
//
// The fixtures have two agents in Arma DX: KOR-1 (enabled, the coordinator) and HAF-1 (stopped).
// The tests enable HAF-1 where they need a unit agent.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const colleagueA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };

function agentRun(user: string, agentCode: string, companyId: string = ids.arma): ContextInput {
  return { companyId, userId: user, agentCode };
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

async function openRequest(tx: Tx, project: string | null = null): Promise<string> {
  const row = await one<{ id: string }>(
    tx,
    `insert into office.tasks (company_id, project_id, kind, title, description)
     values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted') returning id`,
    [project],
  );
  return row.id;
}

async function enableHaf(tx: Tx): Promise<void> {
  await tx.setContext(founderA);
  await tx.exec(
    `update office.company_agents set status = 'enabled'
     where company_id = $1 and agent_code = 'HAF-1'`,
    [ids.arma],
  );
}

async function openRun(tx: Tx, task: string, agent: 'KOR-1' | 'HAF-1'): Promise<string> {
  const row = await one<{ id: string }>(
    tx,
    `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type, model)
     values (office.ctx_company_id(), $1, $2, $3, 'request', 'test-model') returning id`,
    [task, agent, agent === 'KOR-1' ? ids.cardKor : ids.cardHaf],
  );
  return row.id;
}

// The coordinator routes from its run; a person corrects the routing.
const ROUTE = 'select office.route_request($1, $2::jsonb, $3) as round';
const CORRECT = 'select office.correct_routing($1, $2::jsonb) as round';
const HAF_STEP = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Belongs to memory' }]);

const SUBMIT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
    payload, basis_type, basis_id, basis_version, involves_money, goes_external, previous_approval_id)
  values (office.ctx_company_id(), $1, $2, 'HAF-1', 'Result', '{"text": "Output"}', 'task', $1,
    (select version from office.tasks where id = $1), false, false, $3) returning id`;

/**
 * Walks a request to the point where HAF-1 has submitted its result: opened by the employee,
 * routed by KOR-1 from its own run, worked on by HAF-1. Returns the ids.
 */
async function submittedRequest(
  tx: Tx,
  requester: ContextInput = employeeA,
): Promise<{ task: string; run: string; approval: string }> {
  await enableHaf(tx);
  await tx.setContext(requester);
  const task = await openRequest(tx);
  const user = requester.userId ?? '';
  await tx.setContext(agentRun(user, 'KOR-1'));
  const korRun = await openRun(tx, task, 'KOR-1');
  await tx.rows(ROUTE, [task, HAF_STEP, korRun]);
  await tx.exec(`update office.runs set status = 'completed', finished_at = now() where id = $1`, [
    korRun,
  ]);
  await tx.setContext(agentRun(user, 'HAF-1'));
  const run = await openRun(tx, task, 'HAF-1');
  const approval = (await one<{ id: string }>(tx, SUBMIT, [task, run, null])).id;
  return { task, run, approval };
}

async function statusOf(tx: Tx, task: string): Promise<string> {
  return (
    await one<{ status: string }>(tx, 'select status from office.tasks where id = $1', [task])
  ).status;
}

describe.skipIf(noDatabase)('a request and a task between people', () => {
  afterAll(closePools);

  it('a row without a kind is a task between people and is moved by hand as before', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const row = await one<{ id: string; kind: string; status: string; unit_code: string }>(
        tx,
        `insert into office.tasks (company_id, title, unit_code, status)
         values ($1, 'By hand', 'KOR', 'in_progress') returning id, kind, status, unit_code`,
        [ids.arma],
      );
      expect(row).toMatchObject({ kind: 'task', status: 'in_progress', unit_code: 'KOR' });
      expect(await tx.exec(`update office.tasks set status = 'done' where id = $1`, [row.id])).toBe(
        1,
      );
      expect(
        (await tx.expectError(`update office.tasks set kind = 'request' where id = $1`, [row.id]))
          .message,
      ).toMatch(/kind/);
    });
  });

  it('a request takes its requester from the context and nothing else from the caller', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const row = await one<Record<string, unknown>>(
        tx,
        `insert into office.tasks (company_id, kind, title, unit_code, assignee_agent_code, status,
           requester_user_id, routing_corrected)
         values ($1, 'request', 'Mine', 'KOR', 'KOR-1', 'done', $2, true)
         returning status, unit_code, assignee_agent_code, requester_user_id, routing_corrected,
           completed_at`,
        [ids.arma, ids.founder],
      );
      expect(row).toEqual({
        status: 'open',
        unit_code: null,
        assignee_agent_code: null,
        requester_user_id: ids.employeeA,
        routing_corrected: false,
        completed_at: null,
      });
    });
  });

  it('a request is opened by a person of the company through the API, never by an agent run, the worker or an external person', async () => {
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.founder, 'KOR-1'));
      expect(
        (
          await tx.expectError(
            `insert into office.tasks (company_id, kind, title) values ($1, 'request', 'x')`,
            [ids.arma],
          )
        ).message,
      ).toBe('A request is opened by a person');
      // The worker's role with a person alone in its context is still not that person.
      await tx.setContext(employeeA);
      expect(
        (
          await tx.expectError(
            `insert into office.tasks (company_id, kind, title) values ($1, 'request', 'x')`,
            [ids.arma],
          )
        ).message,
      ).toBe('A request is opened through the API');
    });
    await inTransaction(async (tx) => {
      await tx.setContext(externalA);
      expect(
        (
          await tx.expectError(
            `insert into office.tasks (company_id, kind, title) values ($1, 'request', 'x')`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it('a request is refused in a project where agents may not work (rule 12)', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const project of [ids.projectANoAi, ids.projectACustomerNoAi]) {
        expect(
          (
            await tx.expectError(
              `insert into office.tasks (company_id, project_id, kind, title)
               values ($1, $2, 'request', 'x')`,
              [ids.arma, project],
            )
          ).message,
        ).toBe('Agents do not work in this project (AI permission)');
      }
      expect(await openRequest(tx, ids.projectA)).toEqual(expect.any(String));
    });
  });

  it('nobody changes a request by hand: not its requester, the founder, an agent run or an administrator', async () => {
    const refusal = 'A request changes only through its flow';
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      for (const change of [
        `status = 'done'`,
        `unit_code = 'KOR'`,
        `title = 'Other'`,
        `assignee_agent_code = 'KOR-1'`,
      ]) {
        expect(
          (await tx.expectError(`update office.tasks set ${change} where id = $1`, [task])).message,
        ).toBe(refusal);
      }
      await tx.setContext(founderA);
      expect(
        (await tx.expectError(`update office.tasks set status = 'cancelled' where id = $1`, [task]))
          .message,
      ).toBe(refusal);
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect(
        (
          await tx.expectError(`update office.tasks set status = 'done' where id = $1`, [
            ids.requestA,
          ])
        ).message,
      ).toBe(refusal);
    });
    await inAdminTransaction(async (tx) => {
      expect(
        (
          await tx.expectError(`update office.tasks set status = 'done' where id = $1`, [
            ids.requestA,
          ])
        ).message,
      ).toBe(refusal);
    });
  });

  it('the application cannot write the records of the flow or call its inner functions', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const sql of [
        `insert into office.task_routings (company_id, task_id, round, seq, unit_code,
           routed_by_user_id) values ('${ids.arma}', '${ids.requestA}', 9, 1, 'KOR', '${ids.founder}')`,
        `update office.task_routings set status = 'done' where task_id = '${ids.requestA}'`,
        `insert into office.requester_approvals (company_id, task_id, round, approval_id,
           requester_user_id) values ('${ids.arma}', '${ids.requestA}', 9,
           '${ids.requestApprovalA}', '${ids.founder}')`,
        `select office.flow_set_status('${ids.requestA}', 'done')`,
        `select office.flow_close_pending('${ids.requestA}')`,
        `select office.flow_request_result_approved('${ids.requestA}', '${ids.requestApprovalA}')`,
      ]) {
        expect((await tx.expectError(sql)).code).toBe('42501');
      }
    });
  });
});

describe.skipIf(noDatabase)('the approver of a unit and of an agent', () => {
  afterAll(closePools);

  it('only the founder appoints, and only a person who holds the approval right', async () => {
    const appoint = `insert into office.approvers (company_id, unit_code, agent_code, user_id)
      values ($1, $2, $3, $4)`;
    await inTransaction(async (tx) => {
      await tx.setContext(approverA);
      expect((await tx.expectError(appoint, [ids.arma, 'KOR', null, ids.approverA])).code).toBe(
        '42501',
      );
      await tx.setContext(founderA);
      expect(await tx.exec(appoint, [ids.arma, 'KOR', null, ids.approverA])).toBe(1);
      expect(
        (await tx.expectError(appoint, [ids.arma, 'KOR', 'KOR-1', ids.employeeA])).message,
      ).toBe('The approver must be a member who holds the approval right');
      expect((await tx.expectError(appoint, [ids.arma, 'P-IST', null, ids.founder])).message).toBe(
        'Unit P-IST does not belong to this company',
      );
      expect((await tx.expectError(appoint, [ids.arma, 'HAF', 'KOR-1', ids.founder])).message).toBe(
        'Agent KOR-1 is not an agent of this unit in this company',
      );
      expect((await tx.expectError(appoint, [ids.pillika, 'KOR', null, ids.founder])).code).toBe(
        '42501',
      );
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.founder, 'KOR-1'));
      expect((await tx.expectError(appoint, [ids.arma, 'KOR', null, ids.founder])).code).toBe(
        '42501',
      );
    });
  });

  it('the agent’s approver wins over the unit’s; nobody appointed gives no person', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const lookup = `select office.approver_for($1, $2) as person`;
      expect(
        (await one<{ person: string | null }>(tx, lookup, ['KOR', 'KOR-1'])).person,
      ).toBeNull();
      await tx.exec(
        `insert into office.approvers (company_id, unit_code, agent_code, user_id) values
           ($1, 'KOR', null, $2), ($1, 'KOR', 'KOR-1', $3)`,
        [ids.arma, ids.approverA, ids.founder],
      );
      expect((await one<{ person: string }>(tx, lookup, ['KOR', 'KOR-1'])).person).toBe(
        ids.founder,
      );
      expect((await one<{ person: string }>(tx, lookup, ['KOR', null])).person).toBe(ids.approverA);
      // The appointment stops counting when the person loses the approval right.
      await tx.exec(`delete from office.approvers where agent_code = 'KOR-1' and company_id = $1`, [
        ids.arma,
      ]);
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.exec(
        `update office.memberships set can_approve = false where company_id = $1 and user_id = $2`,
        [ids.arma, ids.approverA],
      );
      expect(
        (await one<{ person: string | null }>(tx, lookup, ['KOR', 'KOR-1'])).person,
      ).toBeNull();
    });
  });
});

describe.skipIf(noDatabase)('routing a request', () => {
  afterAll(closePools);

  it('the coordinator routes from its own running run; the request follows the step', async () => {
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      // No run of this agent on the request yet.
      expect((await tx.expectError(ROUTE, [task, HAF_STEP, ids.runA])).message).toBe(
        'Only the coordinator routes a request, from its own running run on it',
      );
      const run = await openRun(tx, task, 'KOR-1');
      expect(await statusOf(tx, task)).toBe('in_progress');
      expect((await one<{ round: number }>(tx, ROUTE, [task, HAF_STEP, run])).round).toBe(1);
      const row = await one<Record<string, unknown>>(
        tx,
        `select status, unit_code, assignee_agent_code, initial_unit_code, routing_corrected
         from office.tasks where id = $1`,
        [task],
      );
      expect(row).toEqual({
        status: 'in_progress',
        unit_code: 'HAF',
        assignee_agent_code: 'HAF-1',
        initial_unit_code: 'HAF',
        routing_corrected: false,
      });
      const steps = await tx.rows(
        `select round, seq, unit_code, agent_code, approver_user_id, status, routed_by_agent_code,
           run_id, reason from office.task_routings where task_id = $1`,
        [task],
      );
      expect(steps).toEqual([
        {
          round: 1,
          seq: 1,
          unit_code: 'HAF',
          agent_code: 'HAF-1',
          // The fixtures appoint the founder for HAF.
          approver_user_id: ids.founder,
          status: 'active',
          routed_by_agent_code: 'KOR-1',
          run_id: run,
          reason: 'Belongs to memory',
        },
      ]);
    });
  });

  it('refuses a step that names a stopped agent, an agent without a card version, an agent of another unit or a unit of another company', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, task, 'KOR-1');
      const route = (steps: unknown): Promise<{ message: string }> =>
        tx.expectError(ROUTE, [task, JSON.stringify(steps), run]);
      // HAF-1 is stopped in Arma DX ("a stopped agent takes no new work").
      expect((await route([{ unit: 'HAF', agent: 'HAF-1' }])).message).toBe(
        'Agent HAF-1 is not an enabled agent of unit HAF in this company',
      );
      expect((await route([{ unit: 'HAF', agent: 'KOR-1' }])).message).toBe(
        'Agent KOR-1 is not an enabled agent of unit HAF in this company',
      );
      expect((await route([{ unit: 'P-IST', agent: 'P-IST-1' }])).message).toBe(
        'Unit P-IST does not belong to this company',
      );
      expect((await route([])).message).toBe('A routing has one to eight steps');
    });
    // An enabled agent whose card was never synchronised has nothing to run with: a request
    // routed to it would wait for ever.
    await inAdminTransaction(async (tx) => {
      await tx.exec(`update office.agent_definitions set current_version_id = null
                     where code = 'HAF-1'`);
      await tx.exec(
        `update office.company_agents set status = 'enabled'
         where company_id = $1 and agent_code = 'HAF-1'`,
        [ids.arma],
      );
      await tx.setContext(founderA);
      expect((await tx.expectError(CORRECT, [ids.requestA, HAF_STEP])).message).toBe(
        'Agent HAF-1 is not an enabled agent of unit HAF in this company',
      );
    });
  });

  it('only the coordinator runs on a request that is not routed, and only the coordinator routes', async () => {
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      // A unit agent a job named for a request nobody routed to it: no run, so no status change.
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect(
        (
          await tx.expectError(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model) values ($1, $2, 'HAF-1', $3, 'handoff', 'test-model')`,
            [ids.arma, task, ids.cardHaf],
          )
        ).message,
      ).toBe('Only the coordinator runs on a request that is not routed yet');
      expect(await statusOf(tx, task)).toBe('open');
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const korRun = await openRun(tx, task, 'KOR-1');
      await tx.rows(ROUTE, [task, HAF_STEP, korRun]);
      // The coordinator's turn is over: it opens no second run on a routed request.
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [korRun],
      );
      expect(
        (
          await tx.expectError(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model) values ($1, $2, 'KOR-1', $3, 'request', 'test-model')`,
            [ids.arma, task, ids.cardKor],
          )
        ).message,
      ).toBe('The request is not routed to this agent');
      // The unit agent works on it now, and cannot hand it on: routing is the coordinator's.
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const hafRun = await openRun(tx, task, 'HAF-1');
      expect(
        (
          await tx.expectError(ROUTE, [
            task,
            JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }]),
            hafRun,
          ])
        ).message,
      ).toBe('Only the coordinator routes a request, from its own running run on it');
      // An agent never corrects a routing in a person's place.
      expect((await tx.expectError(CORRECT, [task, HAF_STEP])).message).toBe(
        'A person corrects the routing',
      );
    });
  });

  it('a step without an agent leaves the request open for the unit’s approver (T8)', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, task, 'KOR-1');
      await tx.rows(ROUTE, [task, JSON.stringify([{ unit: 'HAF', agent: null }]), run]);
      expect(await statusOf(tx, task)).toBe('open');
      expect(
        await tx.rows(
          `select unit_code, agent_code, status from office.task_routings where task_id = $1`,
          [task],
        ),
      ).toEqual([{ unit_code: 'HAF', agent_code: null, status: 'active' }]);
    });
  });

  it('a person routes only as the founder or as the approver of the active step', async () => {
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      const again = JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }]);
      for (const person of [employeeA, approverA, colleagueA]) {
        await tx.setContext(person);
        expect((await tx.expectError(CORRECT, [task, again])).message).toBe(
          'Only the approver of the request or the founder corrects its routing',
        );
        // The coordinator's function is not a way around it.
        expect((await tx.expectError(ROUTE, [task, again, null])).message).toBe(
          'An agent routes a request from its own run',
        );
      }
      await tx.setContext(founderA);
      expect((await one<{ round: number }>(tx, CORRECT, [task, again])).round).toBe(2);
      // The old step gives way, what waited on it is closed, and the correction is counted.
      expect(
        await tx.rows(
          `select round, unit_code, status from office.task_routings where task_id = $1
           order by round`,
          [task],
        ),
      ).toEqual([
        { round: 1, unit_code: 'HAF', status: 'replaced' },
        { round: 2, unit_code: 'KOR', status: 'active' },
      ]);
      expect(
        await one(
          tx,
          `select invalidated_at is not null as closed from office.approvals where id = $1`,
          [approval],
        ),
      ).toEqual({ closed: true });
      expect(
        await one(
          tx,
          `select unit_code, initial_unit_code, routing_corrected, status from office.tasks
           where id = $1`,
          [task],
        ),
      ).toEqual({
        unit_code: 'KOR',
        initial_unit_code: 'HAF',
        routing_corrected: true,
        status: 'in_progress',
      });
    });
  });
});

describe.skipIf(noDatabase)('the approval of a request and the status that follows it', () => {
  afterAll(closePools);

  it('walks a request from the result to done: approver first, then the requester', async () => {
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      expect(await statusOf(tx, task)).toBe('awaiting_approval');
      // The requester sees that it waits and who approves, not the result (decision 4).
      await tx.setContext(employeeA);
      expect(await tx.count('approvals', 'id = $1', [approval])).toBe(0);
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]),
      ).toBe(0);
      expect(
        await tx.rows(`select approver_user_id from office.task_routings where task_id = $1`, [
          task,
        ]),
      ).toEqual([{ approver_user_id: ids.founder }]);

      await tx.setContext(founderA);
      expect(
        await one(
          tx,
          `select approver_user_id, routing_id is not null as result from office.approvals where id = $1`,
          [approval],
        ),
      ).toEqual({ approver_user_id: ids.founder, result: true });
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]);
      expect(await statusOf(tx, task)).toBe('awaiting_approval');
      expect(
        await tx.rows(
          `select round, status, approval_id, requester_user_id from office.requester_approvals
           where task_id = $1`,
          [task],
        ),
      ).toEqual([
        { round: 1, status: 'pending', approval_id: approval, requester_user_id: ids.employeeA },
      ]);
      // The founder cannot give the requester's approval in the requester's place.
      expect(
        await tx.exec(
          `update office.requester_approvals set status = 'approved' where task_id = $1`,
          [task],
        ),
      ).toBe(0);

      await tx.setContext(employeeA);
      expect(await tx.count('approvals', 'id = $1', [approval])).toBe(1);
      expect(
        await tx.exec(
          `update office.requester_approvals set status = 'approved' where task_id = $1`,
          [task],
        ),
      ).toBe(1);
      expect(
        await one(
          tx,
          `select status, completed_at is not null as completed from office.tasks where id = $1`,
          [task],
        ),
      ).toEqual({ status: 'done', completed: true });
    });
  });

  it('once a person is appointed, only that person and the founder decide', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvers set user_id = $2 where company_id = $1 and unit_code = 'HAF'`,
        [ids.arma, ids.approverA],
      );
      await stepUp(tx, founderA, 'membership_change', ids.sharedEmployee);
      await tx.exec(
        `update office.memberships set can_approve = true where company_id = $1 and user_id = $2`,
        [ids.arma, ids.sharedEmployee],
      );
      const { approval } = await submittedRequest(tx);
      await tx.setContext(colleagueA);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            approval,
          ])
        ).message,
      ).toBe('Only the approver of this work or the founder makes the approval decision');
      await tx.setContext(approverA);
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]),
      ).toBe(1);
    });
  });

  it('with nobody appointed only the founder decides the result of a request (decision 5)', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(`delete from office.approvers where company_id = $1 and unit_code = 'HAF'`, [
        ids.arma,
      ]);
      // The requester holds the general approval right: it does not make them the unit's approver.
      const { task, approval } = await submittedRequest(tx, approverA);
      await tx.setContext(founderA);
      expect(
        await one(tx, `select approver_user_id from office.approvals where id = $1`, [approval]),
      ).toEqual({ approver_user_id: null });
      await tx.setContext(approverA);
      for (const decision of [
        `status = 'approved'`,
        `status = 'rejected', rejection_reason = 'out_of_scope'`,
        `status = 'changes_requested', rejection_reason = 'incomplete'`,
      ]) {
        expect(
          (
            await tx.expectError(`update office.approvals set ${decision} where id = $1`, [
              approval,
            ])
          ).message,
        ).toBe('Only the approver of this work or the founder makes the approval decision');
      }
      // Nor may they rewrite what the decider reads.
      expect(
        (
          await tx.expectError(
            `update office.approvals set summary = 'All fine', risk_note = null where id = $1`,
            [approval],
          )
        ).message,
      ).toBe('The approval summary is changed by an agent or by a person who may decide it');
      expect(await statusOf(tx, task)).toBe('awaiting_approval');
      await tx.setContext(founderA);
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]),
      ).toBe(1);
      // An approval that is not the result of a request keeps the rule it had.
      await tx.setContext(approverA);
      expect(
        await tx.exec(
          `update office.approvals set status = 'rejected', rejection_reason = 'other'
                       where id = $1`,
          [ids.approvalA],
        ),
      ).toBe(1);
    });
  });

  it('what the decider reads is changed only by a decider or by the packaging agent', async () => {
    await inTransaction(async (tx) => {
      const { approval } = await submittedRequest(tx);
      const rewrite = `update office.approvals set summary = 'All fine' where id = $1`;
      // The agent that submitted the result cannot take its own risk note back.
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect((await tx.expectError(rewrite, [approval])).message).toBe(
        "The summary of a request's result is changed only by the packaging agent",
      );
      // An employee with the approval right who is not this work's approver.
      await tx.setContext(approverA);
      expect((await tx.expectError(rewrite, [approval])).message).toBe(
        'The approval summary is changed by an agent or by a person who may decide it',
      );
      await tx.setContext(founderA);
      expect(await tx.exec(rewrite, [approval])).toBe(1);
      // The trace holds the opening and the change, by event name only.
      expect(
        await tx.rows(
          `select event, agent_code, user_id from office.audit_log
           where record_type = 'approval' and record_id = $1 order by id`,
          [approval],
        ),
      ).toEqual([
        { event: 'approval_opened', agent_code: 'HAF-1', user_id: ids.employeeA },
        { event: 'approval_summary_changed', agent_code: null, user_id: ids.founder },
      ]);
    });
  });

  it('only the agent of the active step runs on a request and submits its result', async () => {
    await inTransaction(async (tx) => {
      const { task } = await submittedRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect(
        (
          await tx.expectError(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model) values ($1, $2, 'KOR-1', $3, 'request', 'test-model')`,
            [ids.arma, task, ids.cardKor],
          )
        ).message,
      ).toBe('The request is not routed to this agent');
      // With a run it opened on another task it still cannot submit a result here.
      expect(
        (
          await tx.expectError(
            `insert into office.approvals (company_id, task_id, run_id, agent_code, title, payload,
               involves_money, goes_external)
             values ($1, $2, $3, 'KOR-1', 'x', '{}', false, false)`,
            [ids.arma, task, ids.runA],
          )
        ).message,
      ).toBe('The request is not routed to this agent');
    });
  });

  it('changes requested: back to the agent twice, then the work falls to a person', async () => {
    await inTransaction(async (tx) => {
      const { task, run, approval } = await submittedRequest(tx);
      const sendBack = async (id: string): Promise<void> => {
        await tx.setContext(founderA);
        await tx.exec(
          `update office.approvals set status = 'changes_requested',
             rejection_reason = 'language_and_tone' where id = $1`,
          [id],
        );
      };
      await sendBack(approval);
      expect(await statusOf(tx, task)).toBe('in_progress');
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const second = await one<{ id: string; attempt: number }>(tx, `${SUBMIT}, attempt`, [
        task,
        run,
        approval,
      ]);
      expect(second.attempt).toBe(2);
      expect(await statusOf(tx, task)).toBe('awaiting_approval');
      await sendBack(second.id);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect((await tx.expectError(SUBMIT, [task, run, second.id])).message).toBe(
        'After the second change request the work falls to a person',
      );
      expect(await statusOf(tx, task)).toBe('in_progress');
    });
  });

  it('a rejected result closes the request', async () => {
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvals set status = 'rejected', rejection_reason = 'out_of_scope'
         where id = $1`,
        [approval],
      );
      expect(await statusOf(tx, task)).toBe('cancelled');
      expect(
        await tx.rows(`select status from office.task_routings where task_id = $1`, [task]),
      ).toEqual([{ status: 'cancelled' }]);
    });
  });

  it('the requester asks for changes in their own words: the agent reworks once, the second time nothing starts', async () => {
    await inTransaction(async (tx) => {
      const { task, run, approval } = await submittedRequest(tx);
      const approve = async (id: string): Promise<void> => {
        await tx.setContext(founderA);
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [id]);
        await tx.setContext(employeeA);
      };
      const decide = `update office.requester_approvals set status = 'changes_requested',
        rejection_reason = $2, decision_reason = $3 where task_id = $1 and status = 'pending'`;
      await approve(approval);
      // The requester's own words are required; a class from the approver's list is not.
      expect((await tx.expectError(decide, [task, null, null])).code).toBe('23514');
      expect((await tx.expectError(decide, [task, 'incomplete', '  '])).code).toBe('23514');
      expect(await tx.exec(decide, [task, null, 'Shorter'])).toBe(1);
      expect(await statusOf(tx, task)).toBe('in_progress');
      expect(
        await tx.rows(`select status from office.task_routings where task_id = $1`, [task]),
      ).toEqual([{ status: 'active' }]);
      // The reworked output is a new approval chain: the earlier approval was approved.
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const second = await one<{ id: string; attempt: number }>(tx, `${SUBMIT}, attempt`, [
        task,
        run,
        null,
      ]);
      expect(second.attempt).toBe(1);
      await approve(second.id);
      expect(await tx.exec(decide, [task, 'other', 'Still not it'])).toBe(1);
      // After the second change request nothing starts by itself.
      expect(await statusOf(tx, task)).toBe('in_progress');
      expect(await tx.count('task_routings', `task_id = $1 and status = 'active'`, [task])).toBe(0);
      expect(
        await tx.rows(
          `select round, status from office.requester_approvals where task_id = $1 order by round`,
          [task],
        ),
      ).toEqual([
        { round: 1, status: 'changes_requested' },
        { round: 2, status: 'changes_requested' },
      ]);
    });
  });
});

describe.skipIf(noDatabase)('cancelling and stopping a request', () => {
  afterAll(closePools);

  const CLOSE = 'select office.close_request($1)';
  const CLOSE_WITH = 'select office.close_request($1, $2)';

  it('the requester cancels; what waited is closed and nothing more can be written on it', async () => {
    await inTransaction(async (tx) => {
      const { task, run, approval } = await submittedRequest(tx);
      await tx.setContext(colleagueA);
      expect((await tx.expectError(CLOSE, [task])).message).toBe(
        'Only the requester, the approver of the request or the founder closes it',
      );
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect((await tx.expectError(CLOSE, [task])).message).toBe('No such request');
      await tx.setContext(employeeA);
      await tx.rows(CLOSE, [task]);
      expect(
        await one(tx, `select status, closed_by_user_id from office.tasks where id = $1`, [task]),
      ).toEqual({ status: 'cancelled', closed_by_user_id: ids.employeeA });
      // A cancel needs no reason.
      expect(await one(tx, `select close_reason from office.tasks where id = $1`, [task])).toEqual({
        close_reason: null,
      });
      expect((await tx.expectError(CLOSE, [task])).message).toBe('The request is already closed');
      await tx.setContext(founderA);
      expect(
        await one(
          tx,
          `select invalidated_at is not null as closed from office.approvals where id = $1`,
          [approval],
        ),
      ).toEqual({ closed: true });
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            approval,
          ])
        ).message,
      ).toBe('The record the approval is based on changed; the approval is closed');
      expect(
        (await tx.expectError(CORRECT, [task, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]))
          .message,
      ).toBe('A closed request is not routed');
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect((await tx.expectError(SUBMIT, [task, run, null])).message).toBe(
        'The request is closed',
      );
      expect(
        (
          await tx.expectError(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model) values ($1, $2, 'HAF-1', $3, 'handoff', 'test-model')`,
            [ids.arma, task, ids.cardHaf],
          )
        ).message,
      ).toBe('The request is closed');
    });
  });

  it('the founder stops another person’s request; the trace tells a stop from a cancel', async () => {
    await inTransaction(async (tx) => {
      const { task } = await submittedRequest(tx);
      await tx.setContext(founderA);
      // Whoever stops somebody else's request says why, in words the requester reads.
      for (const missing of [null, '   ']) {
        expect((await tx.expectError(CLOSE_WITH, [task, missing])).message).toBe(
          'Stopping a request needs a reason the requester can read',
        );
      }
      expect((await tx.expectError(CLOSE_WITH, [task, 'x'.repeat(501)])).message).toBe(
        'The reason is at most 500 characters',
      );
      await tx.rows(CLOSE_WITH, [task, '  Sent twice by mistake ']);
      expect(
        await one(
          tx,
          `select status, closed_by_user_id, close_reason from office.tasks where id = $1`,
          [task],
        ),
      ).toEqual({
        status: 'cancelled',
        closed_by_user_id: ids.founder,
        close_reason: 'Sent twice by mistake',
      });
      // The requester reads who closed it and why.
      await tx.setContext(employeeA);
      expect(
        await one(tx, `select closed_by_user_id, close_reason from office.tasks where id = $1`, [
          task,
        ]),
      ).toEqual({ closed_by_user_id: ids.founder, close_reason: 'Sent twice by mistake' });
      await tx.setContext(founderA);
      const events = await tx.rows<{ event: string }>(
        `select event from office.audit_log where record_type = 'task' and record_id = $1
         order by id`,
        [task],
      );
      expect(events.map((row) => row.event)).toEqual([
        'request_created',
        'task_status_in_progress',
        'task_assigned_agent',
        'task_unit_changed',
        'task_routing_changed',
        'request_routed',
        'task_status_awaiting_approval',
        'task_status_cancelled',
        'request_stopped',
      ]);
    });
  });

  it('the worker’s role cannot act as a person: no acceptance, close, correction, appointment or request', async () => {
    // The fixture request of Arma DX waits for its requester (employee A). The worker runs in that
    // person's name; none of a person's acts is reachable with its role, whatever the context says.
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(await tx.count('requester_approvals', 'task_id = $1', [ids.requestA])).toBe(1);
      expect(
        (
          await tx.expectError(
            `update office.requester_approvals set status = 'approved' where task_id = $1`,
            [ids.requestA],
          )
        ).code,
      ).toBe('42501');
      expect((await tx.expectError(CLOSE, [ids.requestA])).code).toBe('42501');
      await tx.setContext(founderA);
      expect((await tx.expectError(CLOSE_WITH, [ids.requestA, 'Stop'])).code).toBe('42501');
      expect(
        (
          await tx.expectError(CORRECT, [
            ids.requestA,
            JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }]),
          ])
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(
            `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'KOR', $2)`,
            [ids.arma, ids.founder],
          )
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(
            `delete from office.approvers where company_id = $1 and unit_code = 'HAF'`,
            [ids.arma],
          )
        ).code,
      ).toBe('42501');
      expect(
        (
          await tx.expectError(
            `insert into office.tasks (company_id, kind, title) values ($1, 'request', 'x')`,
            [ids.arma],
          )
        ).message,
      ).toBe('A request is opened through the API');
      expect(await statusOf(tx, ids.requestA)).toBe('awaiting_approval');
    });
  });

  it('writes the decisions into the trace and shows it to the founder only', async () => {
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]);
      await tx.setContext(employeeA);
      await tx.exec(
        `update office.requester_approvals set status = 'approved' where task_id = $1`,
        [task],
      );
      expect(await tx.count('audit_log')).toBe(0);
      await tx.setContext(founderA);
      const events = await tx.rows<{ event: string; user_id: string }>(
        `select event, user_id from office.audit_log where record_type = 'requester_approval'
           and record_id in (select id from office.requester_approvals where task_id = $1)
         order by id`,
        [task],
      );
      expect(events).toEqual([
        { event: 'requester_approval_opened', user_id: ids.founder },
        { event: 'requester_approval_approved', user_id: ids.employeeA },
      ]);
      // The approver's decision is traced like the requester's.
      expect(
        await tx.rows(
          `select event, agent_code, user_id from office.audit_log
           where record_type = 'approval' and record_id = $1 order by id`,
          [approval],
        ),
      ).toEqual([
        { event: 'approval_opened', agent_code: 'HAF-1', user_id: ids.employeeA },
        { event: 'approval_approved', agent_code: null, user_id: ids.founder },
      ]);
    });
  });
});

describe.skipIf(noDatabase)('a request never leaves its company or its project', () => {
  afterAll(closePools);

  const FLOW_TABLES = ['task_routings', 'requester_approvals', 'approvers'] as const;

  it('the records of an Arma DX request are read inside Arma DX only', async () => {
    const counts = async (tx: Tx): Promise<number[]> => {
      const found = [await tx.count('tasks', `kind = 'request' and company_id = $1`, [ids.arma])];
      for (const table of FLOW_TABLES) {
        found.push(await tx.count(table, 'company_id = $1', [ids.arma]));
      }
      return found;
    };
    await inTransaction(async (tx) => {
      for (const inside of [founderA, employeeA, colleagueA]) {
        await tx.setContext(inside);
        expect(await counts(tx)).toEqual([1, 1, 1, 1]);
      }
      for (const outside of [
        founderP,
        employeeP,
        externalA,
        // A Pillika employee who claims the Arma DX context is not a member there.
        { companyId: ids.arma, userId: ids.employeeP },
        {},
      ]) {
        await tx.setContext(outside);
        expect(await counts(tx)).toEqual([0, 0, 0, 0]);
      }
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect(await counts(tx)).toEqual([1, 1, 1, 1]);
      await tx.setContext(agentRun(ids.employeeP, 'KOR-1', ids.pillika));
      expect(await counts(tx)).toEqual([0, 0, 0, 0]);
    });
  });

  it('the flow functions refuse a request of another company', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderP);
      expect(
        (
          await tx.expectError(CORRECT, [
            ids.requestA,
            JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }]),
          ])
        ).message,
      ).toBe('No such request');
      expect(
        (await tx.expectError('select office.close_request($1, $2)', [ids.requestA, 'x'])).message,
      ).toBe('No such request');
      expect(
        await tx.exec(
          `update office.requester_approvals set status = 'approved' where task_id = $1`,
          [ids.requestA],
        ),
      ).toBe(0);
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.employeeP, 'KOR-1', ids.pillika));
      expect(
        (
          await tx.expectError(ROUTE, [
            ids.requestA,
            JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }]),
            ids.runP,
          ])
        ).message,
      ).toBe('No such request');
    });
  });

  it('a project request is read by the project’s members, the founder and a run in that project', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openRequest(tx, ids.projectA);
      await tx.setContext(founderA);
      await tx.rows(CORRECT, [task, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]);
      const seen = async (context: ContextInput): Promise<number[]> => {
        await tx.setContext(context);
        return [
          await tx.count('tasks', 'id = $1', [task]),
          await tx.count('task_routings', 'task_id = $1', [task]),
        ];
      };
      expect(await seen(employeeA)).toEqual([1, 1]);
      expect(await seen(founderA)).toEqual([1, 1]);
      // Not a member of the project.
      expect(await seen(colleagueA)).toEqual([0, 0]);
      // An agent run without the project context sees no project row, even as the founder.
      expect(await seen(agentRun(ids.founder, 'KOR-1'))).toEqual([0, 0]);
      expect(await seen({ ...agentRun(ids.founder, 'KOR-1'), projectId: ids.projectA })).toEqual([
        1, 1,
      ]);
      expect(
        await tx.rows(`select project_id from office.task_routings where task_id = $1`, [task]),
      ).toEqual([{ project_id: ids.projectA }]);
    });
  });
});

describe.skipIf(noDatabase)('what a reader may know about approvals they cannot read', () => {
  afterAll(closePools);

  const FACTS = `select pending_result, last_result_status, last_result_attempt,
      last_change_request_at is not null as changes_requested
    from office.request_flow_facts(array[$1::uuid])`;

  it('the requester learns that a result waits and how it was decided, never its content', async () => {
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      await tx.setContext(employeeA);
      expect(await tx.count('approvals', 'id = $1', [approval])).toBe(0);
      expect(await tx.rows(FACTS, [task])).toEqual([
        {
          pending_result: true,
          last_result_status: null,
          last_result_attempt: null,
          changes_requested: false,
        },
      ]);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvals set status = 'changes_requested', rejection_reason = 'incomplete'
         where id = $1`,
        [approval],
      );
      await tx.setContext(employeeA);
      expect(await tx.count('approvals', 'id = $1', [approval])).toBe(0);
      expect(await tx.rows(FACTS, [task])).toEqual([
        {
          pending_result: false,
          last_result_status: 'changes_requested',
          last_result_attempt: 1,
          changes_requested: true,
        },
      ]);
    });
  });

  it('a rejection tells the requester who, which reason and the approver’s words, never the output', async () => {
    const CLOSING = `select rejected_by_user_id, rejected_reason, rejected_note
      from office.request_flow_facts(array[$1::uuid])`;
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      await tx.setContext(employeeA);
      expect(await tx.rows(CLOSING, [task])).toEqual([
        { rejected_by_user_id: null, rejected_reason: null, rejected_note: null },
      ]);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvals set status = 'rejected', rejection_reason = 'out_of_scope',
           decision_reason = 'Not a text we publish' where id = $1`,
        [approval],
      );
      await tx.setContext(employeeA);
      // The approval itself, with the agent's output, stays closed to the requester.
      expect(await tx.count('approvals', 'id = $1', [approval])).toBe(0);
      expect(await tx.rows(CLOSING, [task])).toEqual([
        {
          rejected_by_user_id: ids.founder,
          rejected_reason: 'out_of_scope',
          rejected_note: 'Not a text we publish',
        },
      ]);
    });
  });

  it('gives nothing outside the company, outside the project, without a context or to an agent run', async () => {
    await inTransaction(async (tx) => {
      for (const outside of [founderP, employeeP, externalA, {}]) {
        await tx.setContext(outside);
        expect(await tx.rows(FACTS, [ids.requestA])).toEqual([]);
      }
      await tx.setContext(employeeA);
      const project = await openRequest(tx, ids.projectA);
      expect(await tx.rows(FACTS, [project])).toHaveLength(1);
      await tx.setContext(colleagueA);
      expect(await tx.rows(FACTS, [project])).toEqual([]);
      expect(await tx.rows(FACTS, [ids.requestA])).toHaveLength(1);
      // A task between people has no flow.
      expect(await tx.rows(FACTS, [ids.taskA])).toEqual([]);
    });
    // The worker's role cannot call it at all.
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect((await tx.expectError(FACTS, [ids.requestA])).code).toBe('42501');
    });
  });
});
