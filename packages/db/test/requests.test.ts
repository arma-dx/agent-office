import { REQUEST_NOTIFICATION_TEMPLATES } from '@agent-office/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import {
  listNotifications,
  markNotificationsRead,
  type NotificationRow,
} from '../src/notifications.ts';
import {
  countPendingDecisions,
  dueDaySql,
  insertRequest,
  insertRequestComment,
  listExpectedRequests,
  listOpenRequests,
  listPendingAcceptances,
  listPendingApprovals,
  listRequestComments,
  listRequests,
  mayCommentOnRequest,
  ownRequestCommentExists,
  readAgentSwitch,
  readRequest,
  readResultApprovals,
  stopAgentIfOpen,
  type PendingDecisionCounts,
  type RequestRow,
} from '../src/requests.ts';
import { ids } from './fixtures.ts';
import {
  asRole,
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

  it('answers who approves only to an insider of the context company', async () => {
    // The fixtures appoint the founder for HAF in Arma DX.
    const ask = `select office.approver_for('HAF', null) as approver,
        office.member_can_approve($1) as founder_can, office.member_can_approve($2) as employee_can`;
    const answer = (tx: Tx): Promise<Record<string, unknown>> =>
      one(tx, ask, [ids.founder, ids.employeeA]);
    const told = { approver: ids.founder, founder_can: true, employee_can: false };
    const nothing = { approver: null, founder_can: false, employee_can: false };
    for (const inRole of [inTransaction, inWorkerTransaction]) {
      await inRole(async (tx) => {
        for (const insider of [founderA, employeeA, agentRun(ids.employeeA, 'KOR-1')]) {
          await tx.setContext(insider);
          expect(await answer(tx)).toEqual(told);
        }
        for (const outsider of [
          // A Pillika employee who names the Arma DX context, an external member, a person who
          // has left, and nobody at all.
          { companyId: ids.arma, userId: ids.employeeP },
          externalA,
          { companyId: ids.arma, userId: ids.formerEmployee },
          { companyId: ids.arma },
          agentRun(ids.externalA, 'KOR-1'),
        ]) {
          await tx.setContext(outsider);
          expect(await answer(tx)).toEqual(nothing);
          // What the same context reads of the table itself, for comparison.
          expect(await tx.count('approvers')).toBe(0);
        }
      });
    }
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

  it('the coordinator does not route a request a person routed while its run was open', async () => {
    // 7 October decision 7. The founder is offered the correction from the moment the request is
    // opened; the coordinator's answer can arrive after it.
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, task, 'KOR-1');
      await tx.setContext(founderA);
      const byPerson = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'To memory' }]);
      expect((await one<{ round: number }>(tx, CORRECT, [task, byPerson])).round).toBe(1);
      const steps = (): Promise<unknown[]> =>
        tx.rows(
          `select round, unit_code, agent_code, status, routed_by_user_id, reason
           from office.task_routings where task_id = $1 order by round, seq`,
          [task],
        );
      const before = await steps();
      expect(before).toEqual([
        {
          round: 1,
          unit_code: 'HAF',
          agent_code: 'HAF-1',
          status: 'active',
          routed_by_user_id: ids.founder,
          reason: 'To memory',
        },
      ]);
      // The coordinator's late answer, with an agent and without one (which would return and close
      // the request the person has just given to an agent). 42501: the runner stops the run.
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      for (const late of [HAF_STEP, JSON.stringify([{ unit: 'A-KES', agent: null }])]) {
        expect(await tx.expectError(ROUTE, [task, late, run])).toEqual({
          code: '42501',
          message: 'The request was routed by somebody else while this run was open',
        });
      }
      expect(await steps()).toEqual(before);
      expect(await statusOf(tx, task)).toBe('in_progress');
      expect(
        await one(tx, 'select routing_corrected, unit_code from office.tasks where id = $1', [
          task,
        ]),
      ).toEqual({ routing_corrected: false, unit_code: 'HAF' });
    });
  });

  it('a routing to a unit with no open agent returns the request to its requester and closes it', async () => {
    // 8 October decision 2. HAF-1 is stopped in Arma DX: no open agent of HAF can take the work.
    const reason = 'Belongs to memory; no agent there can write it';
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, task, 'KOR-1');
      const returned = JSON.stringify([{ unit: 'HAF', agent: null, reason }]);
      expect((await one<{ round: number }>(tx, ROUTE, [task, returned, run])).round).toBe(1);
      // Closed by the flow: nobody is the closer and there is no close reason. The unit stays on
      // the request (also as the first unit ever chosen); no agent is assigned.
      expect(
        await one(
          tx,
          `select status, closed_by_user_id, close_reason, unit_code, initial_unit_code,
             assignee_agent_code, routing_corrected
           from office.tasks where id = $1`,
          [task],
        ),
      ).toEqual({
        status: 'cancelled',
        closed_by_user_id: null,
        close_reason: null,
        unit_code: 'HAF',
        initial_unit_code: 'HAF',
        assignee_agent_code: null,
        routing_corrected: false,
      });
      // The routing decision stays a record: the unit, the coordinator's reason, the run.
      const steps = `select round, seq, unit_code, agent_code, approver_user_id, status,
           routed_by_agent_code, routed_by_user_id, run_id, reason
         from office.task_routings where task_id = $1`;
      const step = {
        round: 1,
        seq: 1,
        unit_code: 'HAF',
        agent_code: null,
        approver_user_id: ids.founder,
        status: 'returned',
        routed_by_agent_code: 'KOR-1',
        routed_by_user_id: null,
        run_id: run,
        reason,
      };
      expect(await tx.rows(steps, [task])).toEqual([step]);
      // Nothing waits for anybody.
      expect(await tx.count('approvals', 'task_id = $1', [task])).toBe(0);
      expect(await tx.count('requester_approvals', 'task_id = $1', [task])).toBe(0);
      expect(await tx.count('task_routings', `task_id = $1 and status = 'active'`, [task])).toBe(0);

      // A closed request stays closed: no second routing, no correction, no new run.
      for (const again of [returned, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]) {
        expect(await tx.expectError(ROUTE, [task, again, run])).toEqual({
          code: '23514',
          message: 'A closed request is not routed',
        });
      }
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [run],
      );
      expect(
        (
          await tx.expectError(
            `insert into office.runs (company_id, task_id, agent_code, card_version_id,
               trigger_type, model) values ($1, $2, 'KOR-1', $3, 'request', 'test-model')`,
            [ids.arma, task, ids.cardKor],
          )
        ).message,
      ).toBe('The request is closed');
      await tx.setContext(founderA);
      expect(
        await tx.expectError(CORRECT, [task, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]),
      ).toEqual({ code: '23514', message: 'A closed request is not routed' });
      expect((await tx.expectError('select office.close_request($1, $2)', [task, 'x'])).code).toBe(
        '23514',
      );

      // The trace: routed, then returned, in the name of the run; names and ids only.
      const trace = await tx.rows<{ event: string; row: string }>(
        `select a.event, to_jsonb(a)::text as row from office.audit_log a
         where a.record_type = 'task' and a.record_id = $1
           and (a.event like 'request_%' or a.event like 'task_status_%')
         order by a.id`,
        [task],
      );
      expect(trace.map((row) => row.event)).toEqual([
        'request_created',
        'task_status_in_progress',
        'request_routed',
        'task_status_cancelled',
        'request_returned',
      ]);
      expect(
        await tx.rows(
          `select a.event, a.company_id, a.user_id, a.agent_code, a.tool_name, a.external_ref
           from office.audit_log a
           where a.record_type = 'task' and a.record_id = $1
             and a.event in ('request_routed', 'request_returned')
           order by a.id`,
          [task],
        ),
      ).toEqual(
        ['request_routed', 'request_returned'].map((event) => ({
          event,
          company_id: ids.arma,
          user_id: ids.employeeA,
          agent_code: 'KOR-1',
          tool_name: null,
          external_ref: null,
        })),
      );
      expect(trace.map((row) => row.row).join(' ')).not.toContain('Belongs to memory');

      // The requester reads the returned step (the unit; the reason is cut by the API's statement).
      await tx.setContext(employeeA);
      expect(await tx.rows(steps, [task])).toEqual([step]);
    });
  });

  it('one step without an agent returns the whole round, also after an earlier routing', async () => {
    await inTransaction(async (tx) => {
      // The coordinator's run is still open when the unit agent has submitted: its second routing
      // names an agent for the first step and none for the second.
      await enableHaf(tx);
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const korRun = await openRun(tx, task, 'KOR-1');
      await tx.rows(ROUTE, [task, HAF_STEP, korRun]);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const hafRun = await openRun(tx, task, 'HAF-1');
      const approval = (await one<{ id: string }>(tx, SUBMIT, [task, hafRun, null])).id;
      expect(await statusOf(tx, task)).toBe('awaiting_approval');

      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const steps = JSON.stringify([
        { unit: 'HAF', agent: 'HAF-1' },
        { unit: 'A-KES', agent: null },
      ]);
      expect((await one<{ round: number }>(tx, ROUTE, [task, steps, korRun])).round).toBe(2);
      expect(
        await tx.rows(
          `select round, seq, unit_code, agent_code, status from office.task_routings
           where task_id = $1 order by round, seq`,
          [task],
        ),
      ).toEqual([
        { round: 1, seq: 1, unit_code: 'HAF', agent_code: 'HAF-1', status: 'replaced' },
        { round: 2, seq: 1, unit_code: 'HAF', agent_code: 'HAF-1', status: 'returned' },
        { round: 2, seq: 2, unit_code: 'A-KES', agent_code: null, status: 'returned' },
      ]);
      // The request names the unit that had no agent for it; the first unit ever chosen stays.
      expect(
        await one(
          tx,
          `select status, closed_by_user_id, unit_code, initial_unit_code, assignee_agent_code,
             routing_corrected
           from office.tasks where id = $1`,
          [task],
        ),
      ).toEqual({
        status: 'cancelled',
        closed_by_user_id: null,
        unit_code: 'A-KES',
        initial_unit_code: 'HAF',
        assignee_agent_code: null,
        routing_corrected: false,
      });
      // What waited is closed with it, and the unit agent cannot submit any more.
      await tx.setContext(founderA);
      expect(
        await one(
          tx,
          `select status, invalidated_at is not null as closed from office.approvals where id = $1`,
          [approval],
        ),
      ).toEqual({ status: 'pending', closed: true });
      expect(
        (
          await tx.rows<{ event: string }>(
            `select event from office.audit_log
             where record_type = 'task' and record_id = $1 and event like 'request_%'
             order by id`,
            [task],
          )
        ).map((row) => row.event),
      ).toEqual(['request_created', 'request_routed', 'request_rerouted', 'request_returned']);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect((await tx.expectError(SUBMIT, [task, hafRun, null])).message).toBe(
        'The request is closed',
      );
    });
  });

  it('a person names an agent in every step: a correction without one is refused and changes nothing', async () => {
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      const state = async (): Promise<unknown> => {
        await tx.setContext(founderA);
        return {
          task: await one(
            tx,
            `select status, unit_code, assignee_agent_code, routing_corrected, version
             from office.tasks where id = $1`,
            [task],
          ),
          steps: await tx.rows(
            `select round, seq, unit_code, agent_code, status from office.task_routings
             where task_id = $1 order by round, seq`,
            [task],
          ),
          approval: await one(
            tx,
            `select status, invalidated_at from office.approvals where id = $1`,
            [approval],
          ),
          trace: await tx.count('audit_log', `record_type = 'task' and record_id = $1`, [task]),
        };
      };
      const before = await state();
      expect(before).toMatchObject({
        task: { status: 'awaiting_approval', unit_code: 'HAF', assignee_agent_code: 'HAF-1' },
        steps: [{ round: 1, seq: 1, unit_code: 'HAF', agent_code: 'HAF-1', status: 'active' }],
        approval: { status: 'pending', invalidated_at: null },
      });
      for (const steps of [
        [{ unit: 'A-KES', agent: null }],
        [{ unit: 'A-KES' }],
        [{ unit: 'HAF', agent: null, reason: 'Wait here' }],
        [
          { unit: 'HAF', agent: 'HAF-1' },
          { unit: 'A-KES', agent: null },
        ],
      ]) {
        // The founder and the appointed approver of the active step alike.
        await tx.setContext(founderA);
        expect(await tx.expectError(CORRECT, [task, JSON.stringify(steps)])).toEqual({
          code: '23514',
          message: 'A person routes a request to an agent',
        });
      }
      expect(await state()).toEqual(before);
      // Who may not correct at all is told so first, whatever the steps say.
      await tx.setContext(employeeA);
      expect(
        (await tx.expectError(CORRECT, [task, JSON.stringify([{ unit: 'A-KES', agent: null }])]))
          .code,
      ).toBe('42501');
      // With an agent the same correction goes through.
      await tx.setContext(founderA);
      expect(
        (
          await one<{ round: number }>(tx, CORRECT, [
            task,
            JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }]),
          ])
        ).round,
      ).toBe(2);
    });
  });

  it('a step without an agent exists only as a returned step', async () => {
    // The table itself refuses it, whoever writes: here the privileged role.
    await inAdminTransaction(async (tx) => {
      const insert = (status: string, agent: string | null): string =>
        `insert into office.task_routings (company_id, task_id, round, seq, unit_code, agent_code,
           status, routed_by_user_id)
         values ('${ids.arma}', '${ids.requestA}', 9, 1, 'HAF', ${agent === null ? 'null' : `'${agent}'`},
           '${status}', '${ids.founder}')`;
      // The fixture request has a step of its own that is active.
      for (const status of ['planned', 'done', 'replaced', 'cancelled']) {
        const refused = await tx.expectError(insert(status, null));
        expect(refused.code).toBe('23514');
        expect(refused.message).toContain('agent_unless_returned');
      }
      await tx.exec(
        `update office.task_routings set status = 'replaced' where task_id = '${ids.requestA}'`,
      );
      const active = await tx.expectError(insert('active', null));
      expect([active.code, active.message.includes('agent_unless_returned')]).toEqual([
        '23514',
        true,
      ]);
      expect(await tx.exec(insert('returned', null))).toBe(1);
      for (const status of ['planned', 'active', 'done', 'replaced', 'cancelled']) {
        const moved = await tx.expectError(
          `update office.task_routings set status = '${status}'
           where task_id = '${ids.requestA}' and round = 9`,
        );
        expect([status, moved.code]).toEqual([status, '23514']);
      }
      expect((await tx.expectError(insert('parked', 'HAF-1'))).code).toBe('23514');
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

  it('the approver who is also the requester gives two separate approvals', async () => {
    // 8 October decision 4. In the pilot the founder approves every unit, so the founder's own
    // request is this case: approving the work does not accept it.
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx, founderA);
      await tx.setContext(founderA);
      expect(
        await one(
          tx,
          `select t.requester_user_id, r.approver_user_id from office.tasks t
           join office.task_routings r on r.task_id = t.id and r.status = 'active'
           where t.id = $1`,
          [task],
        ),
      ).toEqual({ requester_user_id: ids.founder, approver_user_id: ids.founder });
      // Nothing waits for the requester before the approver has decided.
      expect(await tx.count('requester_approvals', 'task_id = $1', [task])).toBe(0);
      expect(
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]),
      ).toBe(1);
      // The first approval: the request still waits, now for the same person as its requester.
      expect(await statusOf(tx, task)).toBe('awaiting_approval');
      expect(
        await tx.rows(
          `select round, status, approval_id, requester_user_id from office.requester_approvals
           where task_id = $1`,
          [task],
        ),
      ).toEqual([
        { round: 1, status: 'pending', approval_id: approval, requester_user_id: ids.founder },
      ]);
      // The second, as the requester: only this one ends the request.
      expect(
        await tx.exec(
          `update office.requester_approvals set status = 'approved' where task_id = $1`,
          [task],
        ),
      ).toBe(1);
      expect(await statusOf(tx, task)).toBe('done');
      // Two decisions in the trace, each its own record, both by the same person.
      expect(
        await tx.rows(
          `select event, record_type, user_id from office.audit_log
           where event in ('approval_approved', 'requester_approval_approved')
             and record_id in (
               select $1::uuid union all
               select id from office.requester_approvals where task_id = $2
             )
           order by id`,
          [approval, task],
        ),
      ).toEqual([
        { event: 'approval_approved', record_type: 'approval', user_id: ids.founder },
        {
          event: 'requester_approval_approved',
          record_type: 'requester_approval',
          user_id: ids.founder,
        },
      ]);
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

  it('a run belongs to the step it was opened for: after a routing to the same agent the older run submits nothing', async () => {
    const stepOf = async (tx: Tx, run: string): Promise<string | null> =>
      (
        await one<{ step: string | null }>(
          tx,
          'select routing_id as step from office.runs where id = $1',
          [run],
        )
      ).step;
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      // The coordinator's run on a request that is not routed belongs to no step, whatever the
      // caller writes: the step is the database's to name.
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const korRun = (
        await one<{ id: string }>(
          tx,
          `insert into office.runs (company_id, task_id, agent_code, card_version_id, trigger_type,
             model, routing_id)
           values (office.ctx_company_id(), $1, 'KOR-1', $2, 'request', 'test-model',
             (select id from office.task_routings where task_id = $3 limit 1))
           returning id`,
          [task, ids.cardKor, ids.requestA],
        )
      ).id;
      expect(await stepOf(tx, korRun)).toBeNull();
      await tx.rows(ROUTE, [task, HAF_STEP, korRun]);

      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const olderRun = await openRun(tx, task, 'HAF-1');
      const active = `select id from office.task_routings where task_id = $1 and status = 'active'`;
      const first = (await one<{ id: string }>(tx, active, [task])).id;
      expect(await stepOf(tx, olderRun)).toBe(first);
      expect(
        (await tx.expectError('update office.runs set routing_id = null where id = $1', [olderRun]))
          .message,
      ).toBe('runs.routing_id cannot be changed');

      // The founder gives the work to the same agent again, with a note the open run never read.
      await tx.setContext(founderA);
      await tx.rows(CORRECT, [
        task,
        JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Formal language' }]),
      ]);
      const second = (await one<{ id: string }>(tx, active, [task])).id;
      expect(second).not.toBe(first);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      expect(await tx.expectError(SUBMIT, [task, olderRun, null])).toEqual({
        code: '23514',
        message: 'The run was opened for a step that is no longer active',
      });
      expect(await tx.count('approvals', 'task_id = $1', [task])).toBe(0);
      expect(await statusOf(tx, task)).toBe('in_progress');
      // The run opened after the correction is the new step's, and its result is filed there.
      const newRun = await openRun(tx, task, 'HAF-1');
      expect(await stepOf(tx, newRun)).toBe(second);
      const approval = (await one<{ id: string }>(tx, SUBMIT, [task, newRun, null])).id;
      expect(
        await one(tx, 'select routing_id, run_id from office.approvals where id = $1', [approval]),
      ).toEqual({ routing_id: second, run_id: newRun });
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

describe.skipIf(noDatabase)('the money and outside marks across the attempts of a step', () => {
  afterAll(closePools);

  // A result with the marks as arguments ($3 money, $4 outside); $5 names the attempt before it.
  const RESULT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
      payload, basis_type, basis_id, basis_version, involves_money, goes_external,
      previous_approval_id)
    values (office.ctx_company_id(), $1, $2, 'HAF-1', 'Result', '{"text": "Output"}', 'task', $1,
      (select version from office.tasks where id = $1), $3, $4, $5) returning id`;
  const TAKEN_BACK = {
    code: '23514',
    message: 'A new attempt cannot take back that the work involves money or goes outside',
  };

  /** HAF-1 has a run open on a request the coordinator routed to it. */
  async function routedRequest(tx: Tx): Promise<{ task: string; run: string }> {
    await enableHaf(tx);
    await tx.setContext(employeeA);
    const task = await openRequest(tx);
    await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
    const korRun = await openRun(tx, task, 'KOR-1');
    await tx.rows(ROUTE, [task, HAF_STEP, korRun]);
    await tx.exec(
      `update office.runs set status = 'completed', finished_at = now() where id = $1`,
      [korRun],
    );
    await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
    return { task, run: await openRun(tx, task, 'HAF-1') };
  }

  it('after the requester’s "not what I asked for" the new result cannot state less than the approved one', async () => {
    await inTransaction(async (tx) => {
      const { task, run } = await routedRequest(tx);
      const first = (await one<{ id: string }>(tx, RESULT, [task, run, true, true, null])).id;
      // Important work: approved with the passkey.
      await stepUp(tx, founderA, 'approve', first);
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [first]);
      await tx.setContext(employeeA);
      await tx.exec(
        `update office.requester_approvals set status = 'changes_requested',
           decision_reason = 'Shorter' where task_id = $1 and status = 'pending'`,
        [task],
      );
      expect(await statusOf(tx, task)).toBe('in_progress');
      // The rework is a new chain (the earlier result was approved), on the same step.
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      for (const [money, outside] of [
        [false, false],
        [true, false],
        [false, true],
      ]) {
        expect(await tx.expectError(RESULT, [task, run, money, outside, null])).toEqual(TAKEN_BACK);
      }
      const second = await one<{ id: string; attempt: number }>(tx, `${RESULT}, attempt`, [
        task,
        run,
        true,
        true,
        null,
      ]);
      expect(second.attempt).toBe(1);
      // And it still asks for the passkey.
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(`update office.approvals set status = 'approved' where id = $1`, [
            second.id,
          ])
        ).code,
      ).toBe('28000');
    });
  });

  it('a result may state more than the one before it, and a step routed again starts fresh', async () => {
    await inTransaction(async (tx) => {
      const { task, run } = await routedRequest(tx);
      const first = (await one<{ id: string }>(tx, RESULT, [task, run, false, false, null])).id;
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvals set status = 'changes_requested', rejection_reason = 'incomplete'
         where id = $1`,
        [first],
      );
      // The approver's change request: the second attempt raises a mark, which is allowed.
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const second = (await one<{ id: string }>(tx, RESULT, [task, run, true, false, first])).id;
      // A person routes the request to the same agent again: a new step, with no earlier result.
      await tx.setContext(founderA);
      await tx.rows(CORRECT, [task, HAF_STEP]);
      expect(
        await one(
          tx,
          'select invalidated_at is not null as closed from office.approvals where id = $1',
          [second],
        ),
      ).toEqual({ closed: true });
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const fresh = await openRun(tx, task, 'HAF-1');
      expect(await tx.rows(RESULT, [task, fresh, false, false, null])).toHaveLength(1);
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

  it('the worker’s role cannot act as a person: no acceptance, close, correction, appointment, request, approval decision or agent switch', async () => {
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

      // The approver's decision and what the decider reads, on a pending approval the founder may
      // decide; the sent mark on an approved one; the agent's switch.
      const decision = 'Only the approver of this work or the founder makes the approval decision';
      for (const [change, message] of [
        [`status = 'changes_requested', rejection_reason = 'incomplete'`, decision],
        [`status = 'rejected', rejection_reason = 'out_of_scope'`, decision],
        [
          `summary = 'All fine', risk_note = null`,
          'The approval summary is changed by an agent or by a person who may decide it',
        ],
      ] as const) {
        expect(
          await tx.expectError(`update office.approvals set ${change} where id = $1`, [
            ids.approvalA,
          ]),
        ).toEqual({ code: '42501', message });
      }
      expect(
        await tx.expectError(`update office.approvals set sent_at = now() where id = $1`, [
          ids.approvalAApproved,
        ]),
      ).toEqual({ code: '42501', message: 'The sent mark is set by a person' });
      expect(
        await tx.rows(
          `select status, summary is null as untouched, sent_at from office.approvals
           where id in ($1, $2) order by id`,
          [ids.approvalA, ids.approvalAApproved],
        ),
      ).toEqual([
        { status: 'pending', untouched: true, sent_at: null },
        { status: 'approved', untouched: true, sent_at: null },
      ]);
      for (const sql of [
        `update office.company_agents set status = 'stopped' where agent_code = 'KOR-1'`,
        `update office.company_agents set status = 'enabled' where agent_code = 'HAF-1'`,
        `insert into office.company_agents (company_id, agent_code) values ('${ids.arma}', 'HAF-1')`,
        `delete from office.company_agents where agent_code = 'KOR-1'`,
      ]) {
        expect((await tx.expectError(sql)).code).toBe('42501');
      }
    });
    // The same acts with the API's role, in the same person's name: the role is what was refused.
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(
        await tx.exec(`update office.approvals set summary = 'All fine' where id = $1`, [
          ids.approvalA,
        ]),
      ).toBe(1);
      expect(
        await tx.exec(
          `update office.approvals set status = 'changes_requested', rejection_reason = 'incomplete'
           where id = $1`,
          [ids.approvalA],
        ),
      ).toBe(1);
      expect(
        await tx.exec(`update office.approvals set sent_at = now() where id = $1`, [
          ids.approvalAApproved,
        ]),
      ).toBe(1);
      expect(
        await tx.exec(
          `update office.company_agents set status = 'stopped' where agent_code = 'KOR-1'`,
        ),
      ).toBe(1);
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
      // Nor can it return the other company's request to its requester: the same refusal for a
      // routing without an agent, and nothing of the request moves.
      expect(
        await tx.expectError(ROUTE, [
          ids.requestA,
          JSON.stringify([{ unit: 'KOR', agent: null }]),
          ids.runP,
        ]),
      ).toEqual({ code: 'P0002', message: 'No such request' });
    });
    await inAdminTransaction(async (tx) => {
      expect(
        await one(tx, 'select status, closed_by_user_id from office.tasks where id = $1', [
          ids.requestA,
        ]),
      ).toEqual({ status: 'awaiting_approval', closed_by_user_id: null });
      expect(
        await tx.count('task_routings', `task_id = $1 and status = 'returned'`, [ids.requestA]),
      ).toBe(0);
    });
    // Inside the company the return is the coordinator's alone, from its own running run: a run
    // of the coordinator on another request of the same company cannot return this one.
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect(
        (
          await tx.expectError(ROUTE, [
            ids.requestA,
            JSON.stringify([{ unit: 'HAF', agent: null }]),
            ids.runA,
          ])
        ).message,
      ).toBe('Only the coordinator routes a request, from its own running run on it');
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

  it('counts a change request of the requester for the step it was about: a step routed later starts fresh', async () => {
    await inTransaction(async (tx) => {
      const { task, run, approval } = await submittedRequest(tx);
      const changesRequested = async (): Promise<boolean> => {
        await tx.setContext(employeeA);
        return (await one<{ changes_requested: boolean }>(tx, FACTS, [task])).changes_requested;
      };
      const approveThenAskAgain = async (id: string, words: string): Promise<void> => {
        await tx.setContext(founderA);
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [id]);
        await tx.setContext(employeeA);
        await tx.exec(
          `update office.requester_approvals set status = 'changes_requested',
             decision_reason = $2 where task_id = $1 and status = 'pending'`,
          [task, words],
        );
      };
      expect(await changesRequested()).toBe(false);
      // The first time the same step is active again: its agent is correcting.
      await approveThenAskAgain(approval, 'Shorter');
      expect(await changesRequested()).toBe(true);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const second = (await one<{ id: string }>(tx, SUBMIT, [task, run, null])).id;
      // The second time no step is active; then a person routes the request to another agent.
      await approveThenAskAgain(second, 'Still not it');
      expect(await changesRequested()).toBe(false);
      await tx.setContext(founderA);
      await tx.rows(CORRECT, [task, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]);
      // Nobody asked the new step for changes.
      expect(await changesRequested()).toBe(false);
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

  it('tells a reader that the run that was called for did not start, from two trace events only', async () => {
    const MISSED = `select not_started_at is not null as missed
      from office.request_flow_facts(array[$1::uuid])`;
    const TRACE = `insert into office.audit_log (company_id, event, record_type, record_id)
      values (office.ctx_company_id(), $1, 'task', $2)`;
    await inTransaction(async (tx) => {
      const missed = async (task: string): Promise<boolean> => {
        await tx.setContext(employeeA);
        // The trace itself stays the founder's to read.
        expect(await tx.count('audit_log')).toBe(0);
        return (await one<{ missed: boolean }>(tx, MISSED, [task])).missed;
      };
      // Not routed yet: the coordinator's refused job counts, another agent's does not.
      await tx.setContext(employeeA);
      const unrouted = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      await tx.exec(TRACE, ['run_refused', unrouted]);
      expect(await missed(unrouted)).toBe(false);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      await tx.exec(TRACE, ['run_refused', unrouted]);
      expect(await missed(unrouted)).toBe(true);

      // Routed to HAF-1: only that agent's refused job counts, and no other event of a run.
      const { task } = await submittedRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      await tx.exec(TRACE, ['run_refused', task]);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      await tx.exec(TRACE, ['run_started', task]);
      await tx.exec(TRACE, ['run_failed', task]);
      expect(await missed(task)).toBe(false);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      await tx.exec(TRACE, ['run_refused', task]);
      expect(await missed(task)).toBe(true);
      // A row about another record of the same id space, or of another company, is not read.
      await tx.setContext(founderP);
      expect(await tx.rows(MISSED, [task])).toEqual([]);
    });
    await inTransaction(async (tx) => {
      // The API's trace of a change request that found the agent stopped, in a person's name.
      const { task } = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.exec(TRACE, ['run_not_started', task]);
      await tx.setContext(employeeA);
      expect(await tx.rows(MISSED, [task])).toEqual([{ missed: true }]);
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

describe.skipIf(noDatabase)('the list of requests', () => {
  afterAll(closePools);

  it('takes its page from the requests themselves: newest movement first, cut at the limit, each with its facts', async () => {
    await inTransaction(async (tx) => {
      // Two requests of this transaction (one instant, so the id decides between them) and the
      // fixture's request, which moved earlier.
      const { task: submitted } = await submittedRequest(tx);
      await tx.setContext(employeeA);
      const fresh = await openRequest(tx);
      const [first = '', second = ''] = [submitted, fresh].sort();
      const page = async (limit: number, mine = false): Promise<string[]> =>
        (await listRequests(tx.client, { coordinator: 'KOR-1', mine, limit })).map((row) => row.id);
      for (const reader of [founderA, employeeA, colleagueA]) {
        await tx.setContext(reader);
        expect(await page(10)).toEqual([first, second, ids.requestA]);
        expect(await page(2)).toEqual([first, second]);
        expect(await page(1)).toEqual([first]);
      }
      // "Mine" is asked before the limit: the requests are employee A's.
      expect(await page(10, true)).toEqual([]);
      await tx.setContext(employeeA);
      expect(await page(2, true)).toEqual([first, second]);
      // Another company's reader gets its own requests.
      await tx.setContext(founderP);
      expect(await page(10)).toEqual([ids.requestP]);

      // The facts of each request are read for the rows of the page.
      await tx.setContext(employeeA);
      const rows = await listRequests(tx.client, { coordinator: 'KOR-1', mine: false, limit: 2 });
      expect(rows.find((row) => row.id === submitted)).toMatchObject({
        status: 'awaiting_approval',
        unit_code: 'HAF',
        routed: true,
        step_agent_code: 'HAF-1',
        step_agent_enabled: true,
        step_approver_user_id: ids.founder,
        pending_result: true,
        pending_acceptance: false,
        // Both runs of this request were opened in this one instant; which is the latest is not
        // the point here.
        run_agent_code: expect.stringMatching(/^(KOR|HAF)-1$/) as unknown,
        reader_may_decide: false,
        coordinator_enabled: true,
      });
      expect(rows.find((row) => row.id === fresh)).toMatchObject({
        status: 'open',
        unit_code: null,
        routed: false,
        step_agent_code: null,
        pending_result: false,
        run_agent_code: null,
      });
      // One request is read with the same statement and gives the same row.
      expect(await readRequest(tx.client, 'KOR-1', submitted)).toEqual(
        rows.find((row) => row.id === submitted),
      );
      // A task between people and another company's request are not requests to this reader.
      expect(await readRequest(tx.client, 'KOR-1', ids.taskA)).toBeNull();
      expect(await readRequest(tx.client, 'KOR-1', ids.requestP)).toBeNull();
    });
  });
});

describe.skipIf(noDatabase)('the requester is told when a request closes behind their back', () => {
  afterAll(closePools);

  // 8 October decision 8: a notification appears only when the person's request was closed without
  // their doing anything: returned, rejected, stopped. The flow writes it in the transaction of the
  // close; a row carries ids and codes and never a text.
  const NOTES = `select template, recipient_user_id, record_type, record_id, project_id, channel,
      sender_agent_code, sender_user_id, read_at
    from office.notifications where record_id = $1 order by created_at, id`;
  const AS_TEXT = `select to_jsonb(n)::text as row from office.notifications n where n.record_id = $1`;
  const CLOSE_WITH = 'select office.close_request($1, $2)';

  // Read by the founder: the log policy shows the founder every notification of the company.
  async function notes(tx: Tx, task: string): Promise<Record<string, unknown>[]> {
    await tx.setContext(founderA);
    return tx.rows(NOTES, [task]);
  }

  async function noteText(tx: Tx, task: string): Promise<string> {
    await tx.setContext(founderA);
    return (await one<{ row: string }>(tx, AS_TEXT, [task])).row;
  }

  function note(template: string, task: string, sender: Record<string, unknown>): unknown {
    return {
      template,
      recipient_user_id: ids.employeeA,
      record_type: 'task',
      record_id: task,
      project_id: null,
      channel: 'panel',
      sender_agent_code: null,
      sender_user_id: null,
      read_at: null,
      ...sender,
    };
  }

  it('a returned request tells its requester: one row of ids and codes, sent by the coordinator', async () => {
    const reason = 'Belongs to memory; no agent there can write it';
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, task, 'KOR-1');
      await tx.rows(ROUTE, [task, JSON.stringify([{ unit: 'HAF', agent: null, reason }]), run]);
      expect(await statusOf(tx, task)).toBe('cancelled');
      // The run goes in the requester's name, and the act is the coordinator's: the requester is
      // told.
      expect(await notes(tx, task)).toEqual([
        note('request_returned', task, { sender_agent_code: 'KOR-1' }),
      ]);
      // Nothing the coordinator wrote is in the row.
      const text = await noteText(tx, task);
      expect(text).toContain('request_returned');
      expect(text).not.toContain(reason);
      expect(text).not.toContain('Belongs');
    });
  });

  it('a rejected result tells the requester, unless the requester is the one who rejected', async () => {
    const REJECT = `update office.approvals set status = 'rejected', rejection_reason = 'other',
        decision_reason = 'Not a text we publish' where id = $1`;
    await inTransaction(async (tx) => {
      const { task, approval } = await submittedRequest(tx);
      // Nothing is told while the request goes on.
      expect(await notes(tx, task)).toEqual([]);
      await tx.setContext(founderA);
      expect(await tx.exec(REJECT, [approval])).toBe(1);
      expect(await statusOf(tx, task)).toBe('cancelled');
      expect(await notes(tx, task)).toEqual([
        note('request_rejected', task, { sender_user_id: ids.founder }),
      ]);
      // The approver's words stay on the approval.
      expect(await noteText(tx, task)).not.toContain('Not a text we publish');

      // The founder's own request, rejected by the founder: nobody is told of their own act.
      const own = await submittedRequest(tx, founderA);
      await tx.setContext(founderA);
      expect(await tx.exec(REJECT, [own.approval])).toBe(1);
      expect(await statusOf(tx, own.task)).toBe('cancelled');
      expect(await notes(tx, own.task)).toEqual([]);
    });
  });

  it('a stop tells the requester; a cancel and a founder closing their own request tell nobody', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const stopped = await openRequest(tx);
      await tx.setContext(founderA);
      await tx.rows(CLOSE_WITH, [stopped, 'Sent twice by mistake']);
      expect(await statusOf(tx, stopped)).toBe('cancelled');
      expect(await notes(tx, stopped)).toEqual([
        note('request_stopped', stopped, { sender_user_id: ids.founder }),
      ]);
      // The reason is on the request, for whoever may read the request.
      expect(await noteText(tx, stopped)).not.toContain('Sent twice');

      await tx.setContext(employeeA);
      const cancelled = await openRequest(tx);
      await tx.rows(CLOSE_WITH, [cancelled, 'No longer needed']);
      expect(await statusOf(tx, cancelled)).toBe('cancelled');
      expect(await notes(tx, cancelled)).toEqual([]);

      await tx.setContext(founderA);
      const own = await openRequest(tx);
      await tx.rows(CLOSE_WITH, [own, 'No longer needed']);
      expect(await statusOf(tx, own)).toBe('cancelled');
      expect(await notes(tx, own)).toEqual([]);
    });
  });

  it('a request that goes on tells nobody', async () => {
    await inTransaction(async (tx) => {
      const { task, run, approval } = await submittedRequest(tx);
      const decide = async (id: string, status: string): Promise<void> => {
        await tx.setContext(founderA);
        expect(
          await tx.exec(
            `update office.approvals set status = $2,
               rejection_reason = case when $2 = 'approved' then null else 'incomplete' end
             where id = $1`,
            [id, status],
          ),
        ).toBe(1);
      };
      const ACCEPT = `update office.requester_approvals set status = $2, decision_reason = $3
        where task_id = $1 and status = 'pending'`;
      // The approver asks for changes; the agent submits again; the approver approves.
      await decide(approval, 'changes_requested');
      expect(await notes(tx, task)).toEqual([]);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const second = (await one<{ id: string }>(tx, SUBMIT, [task, run, approval])).id;
      await decide(second, 'approved');
      expect(await notes(tx, task)).toEqual([]);
      // The requester asks for changes; the reworked result is approved and accepted.
      await tx.setContext(employeeA);
      expect(await tx.exec(ACCEPT, [task, 'changes_requested', 'Shorter'])).toBe(1);
      expect(await notes(tx, task)).toEqual([]);
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const third = (await one<{ id: string }>(tx, SUBMIT, [task, run, null])).id;
      await decide(third, 'approved');
      await tx.setContext(employeeA);
      expect(await tx.exec(ACCEPT, [task, 'approved', null])).toBe(1);
      expect(await statusOf(tx, task)).toBe('done');
      expect(await notes(tx, task)).toEqual([]);
    });
  });

  it('a requester who left the company gets no notification and the request closes all the same', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(colleagueA);
      const task = await openRequest(tx);
      await stepUp(tx, founderA, 'membership_change', ids.sharedEmployee);
      await tx.setContext(founderA);
      expect(
        await tx.exec(`delete from office.memberships where company_id = $1 and user_id = $2`, [
          ids.arma,
          ids.sharedEmployee,
        ]),
      ).toBe(1);
      // The notification's recipient must be a member (foreign key); the refusal ends inside the
      // flow and the close goes on.
      await tx.rows(CLOSE_WITH, [task, 'The requester has left']);
      expect(
        await one(tx, `select status, closed_by_user_id from office.tasks where id = $1`, [task]),
      ).toEqual({ status: 'cancelled', closed_by_user_id: ids.founder });
      expect(await tx.rows(NOTES, [task])).toEqual([]);
      // The transaction is not aborted: the next statement works.
      expect(await tx.rows('select 1 as ok')).toEqual([{ ok: 1 }]);
    });
  });

  it('the flow’s templates are written by the flow alone', async () => {
    const WRITE = `insert into office.notifications
        (company_id, recipient_user_id, template, record_type, record_id)
      values ($1, $2, $3, 'task', $4)`;
    const NOTIFY = `select office.flow_notify_requester($1, 'request_stopped')`;
    const values = (template: string): unknown[] => [
      ids.arma,
      ids.employeeA,
      template,
      ids.requestA,
    ];
    await inTransaction(async (tx) => {
      for (const context of [founderA, approverA, employeeA]) {
        await tx.setContext(context);
        for (const template of REQUEST_NOTIFICATION_TEMPLATES) {
          expect(
            (await tx.expectError(WRITE, values(template))).code,
            `${template} ${JSON.stringify(context)}`,
          ).toBe('42501');
        }
        // The inner function of the flow is not the application's to call.
        expect((await tx.expectError(NOTIFY, [ids.requestA])).code).toBe('42501');
      }
      expect(await tx.count('notifications', 'record_id = $1', [ids.requestA])).toBe(0);
    });
    await inWorkerTransaction(async (tx) => {
      for (const context of [agentRun(ids.employeeA, 'KOR-1'), founderA]) {
        await tx.setContext(context);
        for (const template of REQUEST_NOTIFICATION_TEMPLATES) {
          expect(
            (await tx.expectError(WRITE, values(template))).code,
            `${template} ${JSON.stringify(context)}`,
          ).toBe('42501');
        }
        expect((await tx.expectError(NOTIFY, [ids.requestA])).code).toBe('42501');
      }
      // Every other template is written by an agent run as before.
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect(await tx.exec(WRITE, values('approval_pending'))).toBe(1);
    });
  });

  it('the read mark is written through the API’s role alone, by the recipient', async () => {
    // The fixtures hold one notification of employee A in Arma DX.
    const MARK = `update office.notifications set read_at = now() where recipient_user_id = $1`;
    // The worker carries no session of the person: whatever its context says, it marks nothing.
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(await tx.count('notifications', 'recipient_user_id = $1', [ids.employeeA])).toBe(1);
      expect((await tx.expectError(MARK, [ids.employeeA])).code).toBe('42501');
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect((await tx.expectError(MARK, [ids.employeeA])).code).toBe('42501');
    });
    await inTransaction(async (tx) => {
      // Somebody else's notification: not the approver's, and not the founder's although the
      // founder reads the company's log.
      for (const context of [approverA, founderA, agentRun(ids.employeeA, 'KOR-1')]) {
        await tx.setContext(context);
        expect(await tx.exec(MARK, [ids.employeeA]), JSON.stringify(context)).toBe(0);
      }
      await tx.setContext(employeeA);
      expect(await tx.exec(MARK, [ids.employeeA])).toBe(1);
      expect(
        await tx.rows(
          `select read_at = now() as read from office.notifications where recipient_user_id = $1`,
          [ids.employeeA],
        ),
      ).toEqual([{ read: true }]);
    });
  });

  // The statements of the Bugün screen ---------------------------------------------------------

  const LISTED = { keepDays: 30, limit: 50 };

  /** The listed notifications of the context person that are about this request. */
  async function listedFor(
    tx: Tx,
    context: ContextInput,
    task: string,
  ): Promise<NotificationRow[]> {
    await tx.setContext(context);
    return (await listNotifications(tx.client, LISTED)).filter((row) => row.request_id === task);
  }

  /** Employee A's request, stopped by the founder: one notification for employee A. */
  async function stoppedRequest(tx: Tx, project: string | null = null): Promise<string> {
    await tx.setContext(employeeA);
    const task = await openRequest(tx, project);
    await tx.setContext(founderA);
    await tx.rows(CLOSE_WITH, [task, 'Sent twice by mistake']);
    return task;
  }

  async function noteId(tx: Tx, task: string): Promise<string> {
    await tx.setContext(founderA);
    return (
      await one<{ id: string }>(tx, 'select id from office.notifications where record_id = $1', [
        task,
      ])
    ).id;
  }

  it('a notification is listed for its recipient alone: not for the founder, another company, no context or an agent run', async () => {
    await inTransaction(async (tx) => {
      const task = await stoppedRequest(tx);
      expect(await listedFor(tx, employeeA, task)).toMatchObject([
        { template: 'request_stopped', read: false, request_id: task },
      ]);
      // The founder reads the company's log (the row policy shows the row), and the statement
      // still gives the founder only their own.
      await tx.setContext(founderA);
      expect(await tx.count('notifications', 'record_id = $1', [task])).toBe(1);
      expect(await listNotifications(tx.client, LISTED)).toEqual([]);
      for (const context of [
        approverA,
        colleagueA,
        externalA,
        founderP,
        employeeP,
        // Not a member there: the same person in another company's context.
        { companyId: ids.pillika, userId: ids.employeeA },
        // A person without a company, a company without a person, and nothing at all.
        { userId: ids.employeeA },
        { companyId: ids.arma },
        {},
        // A run in the recipient's name is not the recipient reading.
        agentRun(ids.employeeA, 'KOR-1'),
        agentRun(ids.founder, 'KOR-1'),
      ]) {
        await tx.setContext(context);
        expect(await listNotifications(tx.client, LISTED), JSON.stringify(context)).toEqual([]);
      }
    });
    // With the worker's role too: nothing of the person's notifications reaches an agent run.
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      expect(await tx.count('notifications', 'recipient_user_id = $1', [ids.employeeA])).toBe(1);
      expect(await listNotifications(tx.client, LISTED)).toEqual([]);
    });
  });

  it('lists the request’s title and the unit of a return, the newest first, and no template without a sentence', async () => {
    await inTransaction(async (tx) => {
      // A stop of a request that had reached its unit, and a return.
      const { task: stopped } = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.rows(CLOSE_WITH, [stopped, 'Sent twice by mistake']);
      await tx.setContext(employeeA);
      const returned = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, returned, 'KOR-1');
      await tx.rows(ROUTE, [
        returned,
        JSON.stringify([{ unit: 'HAF', agent: null, reason: 'Nobody there can write it' }]),
        run,
      ]);
      await tx.setContext(employeeA);
      const rows = await listNotifications(tx.client, LISTED);
      // The fixtures' notification of employee A (task_assigned) has no sentence in the panel.
      expect(await tx.count('notifications', `template = 'task_assigned'`)).toBe(1);
      expect(rows.map((row) => row.template).sort()).toEqual([
        'request_returned',
        'request_stopped',
      ]);
      expect(rows.find((row) => row.request_id === returned)).toEqual({
        id: expect.any(String) as unknown,
        template: 'request_returned',
        created_at: expect.any(Date) as unknown,
        read: false,
        request_id: returned,
        request_title: 'A request',
        unit_code: 'HAF',
        unit_name: 'Kurumsal Hafıza',
      });
      // A stop names no unit, also though the request stood at one.
      expect(await one(tx, 'select unit_code from office.tasks where id = $1', [stopped])).toEqual({
        unit_code: 'HAF',
      });
      expect(rows.find((row) => row.request_id === stopped)).toMatchObject({
        template: 'request_stopped',
        request_title: 'A request',
        unit_code: null,
        unit_name: null,
      });
      // Nothing of the coordinator's or the founder's words.
      expect(JSON.stringify(rows)).not.toMatch(/Nobody there|Sent twice/);

      // Rows of one transaction carry one instant: the list never goes back in time.
      const times = rows.map((row) => row.created_at.getTime());
      expect(times).toEqual([...times].sort((x, y) => y - x));
    });
    // The newest first, cut at the limit: shown with rows of different ages, which only the
    // privileged role can make (the statement names its reader itself, so it reads the same).
    await inAdminTransaction(async (tx) => {
      const older = await stoppedRequest(tx);
      const newer = await stoppedRequest(tx);
      const middle = await stoppedRequest(tx);
      await tx.exec(
        `update office.notifications set created_at = now() - interval '2 hours'
         where record_id = $1`,
        [older],
      );
      await tx.exec(
        `update office.notifications set created_at = now() - interval '1 hour'
         where record_id = $1`,
        [middle],
      );
      await tx.setContext(employeeA);
      expect((await listNotifications(tx.client, LISTED)).map((row) => row.request_id)).toEqual([
        newer,
        middle,
        older,
      ]);
      expect(
        (await listNotifications(tx.client, { keepDays: 30, limit: 2 })).map(
          (row) => row.request_id,
        ),
      ).toEqual([newer, middle]);
    });
  });

  it('an unread notification is listed whatever its age; a read one only inside the keeping time', async () => {
    await inTransaction(async (tx) => {
      const task = await stoppedRequest(tx);
      const id = await noteId(tx, task);
      const listed = async (keepDays: number): Promise<NotificationRow[]> => {
        await tx.setContext(employeeA);
        return (await listNotifications(tx.client, { keepDays, limit: 50 })).filter(
          (row) => row.request_id === task,
        );
      };
      // Not read yet: listed also when nothing read is kept.
      expect(await listed(0)).toMatchObject([{ id, read: false }]);
      expect(await markNotificationsRead(tx.client, [id])).toBe(1);
      expect(await listed(0)).toEqual([]);
      expect(await listed(30)).toMatchObject([{ id, read: true }]);
    });
  });

  it('marks only the reader’s own unread notifications and says how many', async () => {
    await inTransaction(async (tx) => {
      const task = await stoppedRequest(tx);
      const id = await noteId(tx, task);
      const other = await noteId(tx, await stoppedRequest(tx));
      await tx.setContext(founderP);
      const pillika = (
        await one<{ id: string }>(
          tx,
          'select id from office.notifications where recipient_user_id = $1',
          [ids.employeeP],
        )
      ).id;
      // Somebody else's, also for the founder who reads the log; and nothing in an agent run.
      for (const context of [approverA, founderA, agentRun(ids.employeeA, 'KOR-1')]) {
        await tx.setContext(context);
        expect(await markNotificationsRead(tx.client, [id]), JSON.stringify(context)).toBe(0);
      }
      // Another company's notification is nobody's here, and its own recipient marks it only in
      // its own company's context.
      for (const context of [founderA, employeeA, { companyId: ids.arma, userId: ids.employeeP }]) {
        await tx.setContext(context);
        expect(await markNotificationsRead(tx.client, [pillika]), JSON.stringify(context)).toBe(0);
      }
      const readAt = async (note: string): Promise<boolean> => {
        await tx.setContext(founderA);
        return (
          await one<{ read: boolean }>(
            tx,
            'select read_at is not null as read from office.notifications where id = $1',
            [note],
          )
        ).read;
      };
      expect(await readAt(id)).toBe(false);
      await tx.setContext(employeeA);
      // Ids that are not the reader's change nothing and stop nothing.
      expect(await markNotificationsRead(tx.client, [id, pillika])).toBe(1);
      expect(await markNotificationsRead(tx.client, [id])).toBe(0);
      expect(await readAt(id)).toBe(true);
      // Only what was named.
      expect(await readAt(other)).toBe(false);
      await tx.setContext(employeeP);
      expect(await markNotificationsRead(tx.client, [pillika])).toBe(1);
    });
    // The worker's role cannot write the mark at all.
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const [mine] = await tx.rows<{ id: string }>(
        'select id from office.notifications where recipient_user_id = $1',
        [ids.employeeA],
      );
      await expect(markNotificationsRead(tx.client, [mine?.id ?? ''])).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('a project request’s notification carries the project and is not listed for a requester who left the project', async () => {
    await inTransaction(async (tx) => {
      const task = await stoppedRequest(tx, ids.projectA);
      expect(await notes(tx, task)).toMatchObject([
        { template: 'request_stopped', recipient_user_id: ids.employeeA, project_id: ids.projectA },
      ]);
      expect(await listedFor(tx, employeeA, task)).toMatchObject([
        { template: 'request_stopped', request_title: 'A request' },
      ]);
      await tx.setContext(founderA);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
          ids.projectA,
          ids.employeeA,
        ]),
      ).toBe(1);
      // The request is no longer the person's to read, so neither is its title.
      await tx.setContext(employeeA);
      expect(await tx.count('tasks', 'id = $1', [task])).toBe(0);
      expect(await listNotifications(tx.client, LISTED)).toEqual([]);
    });
  });

  // The pick of the list "Sizden beklenenler" ----------------------------------------------------

  const PICK = { coordinator: 'KOR-1', limit: 50 };

  async function pick(tx: Tx, context: ContextInput): Promise<string[]> {
    await tx.setContext(context);
    return (await listExpectedRequests(tx.client, PICK)).map((row) => row.id);
  }

  it('picks the open requests that may expect something of the reader, the longest wait first', async () => {
    await inTransaction(async (tx) => {
      // w1 waits for the founder's decision; w2 was approved and waits for employee A; one request
      // is closed, one is done and one was only opened.
      const { task: w1 } = await submittedRequest(tx);
      const second = await submittedRequest(tx);
      const w2 = second.task;
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
        second.approval,
      ]);
      const closed = await stoppedRequest(tx);
      const third = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
        third.approval,
      ]);
      await tx.setContext(employeeA);
      await tx.exec(
        `update office.requester_approvals set status = 'approved' where task_id = $1`,
        [third.task],
      );
      expect(await statusOf(tx, third.task)).toBe('done');
      await tx.setContext(colleagueA);
      const colleagues = await openRequest(tx);

      // The founder: every open request of the company, and no closed one.
      await tx.setContext(founderA);
      const founders = await listExpectedRequests(tx.client, PICK);
      expect(founders.map((row) => row.id).sort()).toEqual(
        [w1, w2, colleagues, ids.requestA].sort(),
      );
      for (const row of founders) {
        expect(['done', 'cancelled']).not.toContain(row.status);
      }
      expect(founders.map((row) => row.id)).not.toContain(closed);
      // The one that has not moved for longest first: the fixture's request moved before this
      // transaction began, the others in one instant (then the id decides).
      expect(founders[0]?.id).toBe(ids.requestA);
      expect(founders.slice(1).map((row) => row.id)).toEqual([w1, w2, colleagues].sort());
      const moved = founders.map((row) => row.updated_at.getTime());
      expect(moved).toEqual([...moved].sort((a, b) => a - b));
      // Each row carries the facts the stage is derived from.
      expect(founders.find((row) => row.id === w1)).toMatchObject({
        pending_result: true,
        pending_acceptance: false,
        reader_may_decide: true,
      });
      // The limit cuts after the order.
      expect(
        (await listExpectedRequests(tx.client, { coordinator: 'KOR-1', limit: 1 })).map(
          (row) => row.id,
        ),
      ).toEqual([ids.requestA]);

      // A requester: their own open requests, whatever they wait for.
      await tx.setContext(employeeA);
      const own = await listExpectedRequests(tx.client, PICK);
      expect(own.map((row) => row.id).sort()).toEqual([w1, w2, ids.requestA].sort());
      for (const row of own) {
        expect(row.requester_user_id).toBe(ids.employeeA);
      }
      expect(own.find((row) => row.id === w2)).toMatchObject({
        pending_acceptance: true,
        reader_may_decide: false,
      });
      expect(await pick(tx, colleagueA)).toEqual([colleagues]);

      // A person who holds the approval right and is appointed nowhere: nothing.
      expect(await pick(tx, approverA)).toEqual([]);
      // Appointed for the unit: the requests routed there from now on, and nothing else (the
      // steps routed before keep the approver they were given).
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvers set user_id = $2 where company_id = $1 and unit_code = 'HAF'`,
        [ids.arma, ids.approverA],
      );
      const { task: appointed } = await submittedRequest(tx);
      await tx.setContext(approverA);
      const approvers = await listExpectedRequests(tx.client, PICK);
      expect(approvers.map((row) => row.id)).toEqual([appointed]);
      expect(approvers[0]).toMatchObject({
        step_approver_user_id: ids.approverA,
        pending_result: true,
        reader_may_decide: true,
      });
      // The right is asked every time: without it the appointment gives nothing.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.memberships set can_approve = false where company_id = $1 and user_id = $2`,
        [ids.arma, ids.approverA],
      );
      expect(await pick(tx, approverA)).toEqual([]);
    });
  });

  it('the pick gives nothing of another company, without a context, to an agent run, to an external person or outside the project', async () => {
    await inTransaction(async (tx) => {
      const { task } = await submittedRequest(tx);
      expect(await pick(tx, founderA)).toContain(task);
      // Another company's founder and employee get their own company's requests.
      expect(await pick(tx, founderP)).toEqual([ids.requestP]);
      expect(await pick(tx, employeeP)).toEqual([ids.requestP]);
      // The same people in a company they are not a member of, and no context at all.
      expect(await pick(tx, { companyId: ids.pillika, userId: ids.employeeA })).toEqual([]);
      expect(await pick(tx, { companyId: ids.arma, userId: ids.employeeP })).toEqual([]);
      expect(await pick(tx, { userId: ids.founder })).toEqual([]);
      expect(await pick(tx, { companyId: ids.arma })).toEqual([]);
      expect(await pick(tx, {})).toEqual([]);
      // Nothing is expected of an agent run, also when it goes in the founder's or the requester's
      // name.
      expect(await pick(tx, agentRun(ids.founder, 'KOR-1'))).toEqual([]);
      expect(await pick(tx, agentRun(ids.employeeA, 'HAF-1'))).toEqual([]);
      // An external person has no request and decides none.
      expect(await pick(tx, externalA)).toEqual([]);

      // A request inside a project: its requester (a member) and the founder.
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'KOR', $2)`,
        [ids.arma, ids.approverA],
      );
      await tx.exec(
        `insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)`,
        [ids.arma, ids.projectA, ids.approverA],
      );
      await tx.setContext(employeeA);
      const inProject = await openRequest(tx, ids.projectA);
      await tx.setContext(founderA);
      await tx.rows(CORRECT, [inProject, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]);
      expect(await pick(tx, employeeA)).toContain(inProject);
      expect(await pick(tx, founderA)).toContain(inProject);
      // An insider who is not a member of the project.
      expect(await pick(tx, colleagueA)).toEqual([]);
      // The appointed approver of its active step is a member of the project and gets it; taken
      // out of the project, the same person no longer does: the row policy of the request decides
      // before the pick asks whose turn it is.
      await tx.setContext(founderA);
      expect(
        await one(
          tx,
          `select approver_user_id from office.task_routings where task_id = $1 and status = 'active'`,
          [inProject],
        ),
      ).toEqual({ approver_user_id: ids.approverA });
      expect(await pick(tx, approverA)).toEqual([inProject]);
      await tx.setContext(founderA);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
          ids.projectA,
          ids.approverA,
        ]),
      ).toBe(1);
      // The step still names the person; the request itself is what they no longer read.
      expect(
        await tx.count(
          'task_routings',
          `task_id = $1 and status = 'active' and approver_user_id = $2`,
          [inProject, ids.approverA],
        ),
      ).toBe(1);
      expect(await pick(tx, approverA)).toEqual([]);
    });
    // The worker's role cannot ask at all: the facts of a request's flow are the API's alone.
    await inWorkerTransaction(async (tx) => {
      for (const context of [agentRun(ids.founder, 'KOR-1'), founderA]) {
        await tx.setContext(context);
        await tx.client.query('savepoint pick');
        await expect(listExpectedRequests(tx.client, PICK)).rejects.toMatchObject({
          code: '42501',
        });
        await tx.client.query('rollback to savepoint pick');
      }
    });
  });

  // The count of the approval desk (the Onaylar number of the sidebar) ---------------------------

  /** The cards of the approval desk for the person, by the statements of GET /api/approvals. */
  async function desk(
    tx: Tx,
    context: ContextInput,
  ): Promise<{ approvals: string[]; acceptances: string[] }> {
    await tx.setContext(context);
    const approvals = await listPendingApprovals(tx.client);
    const acceptances = await listPendingAcceptances(tx.client);
    const results = await readResultApprovals(
      tx.client,
      acceptances.map((acceptance) => acceptance.approval_id),
    );
    return {
      approvals: approvals.map((approval) => approval.task_id),
      acceptances: acceptances
        .filter((acceptance) => results.some((result) => result.id === acceptance.approval_id))
        .map((acceptance) => acceptance.task_id),
    };
  }

  /** The count for the person; it is always the number of cards on that person's desk. */
  async function counted(tx: Tx, context: ContextInput): Promise<PendingDecisionCounts> {
    const cards = await desk(tx, context);
    const numbers = await countPendingDecisions(tx.client);
    expect(numbers).toEqual({
      approvals: cards.approvals.length,
      acceptances: cards.acceptances.length,
    });
    return numbers;
  }

  /** The count alone, for a context the desk is never asked in. */
  async function asked(tx: Tx, context: ContextInput): Promise<PendingDecisionCounts> {
    await tx.setContext(context);
    return countPendingDecisions(tx.client);
  }

  const NOTHING = { approvals: 0, acceptances: 0 };
  const APPROVE = `update office.approvals set status = 'approved' where id = $1`;

  it('counts the cards of the approval desk: the founder’s and the appointed approver’s decisions, the requester’s acceptances, nothing for anybody else', async () => {
    await inTransaction(async (tx) => {
      // The fixtures: the approved result of one request waits for employee A. The approvals of
      // tool calls that wait for the founder are not results of a request and are not counted.
      await tx.setContext(founderA);
      expect(
        await tx.count('approvals', `routing_id is null and status = 'pending'`),
      ).toBeGreaterThan(0);
      expect(await counted(tx, founderA)).toEqual(NOTHING);
      expect(await counted(tx, employeeA)).toEqual({ approvals: 0, acceptances: 1 });

      // A result is submitted while nobody else is appointed for the unit: the founder decides.
      const w1 = await submittedRequest(tx);
      expect(await counted(tx, founderA)).toEqual({ approvals: 1, acceptances: 0 });
      // Not the requester, not a person who holds the approval right and is appointed nowhere,
      // not another employee.
      expect(await counted(tx, employeeA)).toEqual({ approvals: 0, acceptances: 1 });
      expect(await counted(tx, approverA)).toEqual(NOTHING);
      expect(await counted(tx, colleagueA)).toEqual(NOTHING);
      // The count does not look through the window of the Bugün list: a pick of one request
      // leaves the new one out, the count has it.
      await tx.setContext(founderA);
      expect(
        (await listExpectedRequests(tx.client, { coordinator: 'KOR-1', limit: 1 })).map(
          (row) => row.id,
        ),
      ).toEqual([ids.requestA]);
      expect(await countPendingDecisions(tx.client)).toEqual({ approvals: 1, acceptances: 0 });

      // Approved: the result leaves the founder's desk and waits for its requester.
      const second = await submittedRequest(tx);
      expect(await counted(tx, founderA)).toEqual({ approvals: 2, acceptances: 0 });
      await tx.setContext(founderA);
      await tx.exec(APPROVE, [second.approval]);
      expect(await counted(tx, founderA)).toEqual({ approvals: 1, acceptances: 0 });
      expect(await counted(tx, employeeA)).toEqual({ approvals: 0, acceptances: 2 });
      // Another employee's own request: its acceptance is theirs alone.
      const others = await submittedRequest(tx, colleagueA);
      expect(await counted(tx, colleagueA)).toEqual(NOTHING);
      await tx.setContext(founderA);
      await tx.exec(APPROVE, [others.approval]);
      expect(await counted(tx, colleagueA)).toEqual({ approvals: 0, acceptances: 1 });
      expect(await counted(tx, employeeA)).toEqual({ approvals: 0, acceptances: 2 });
      expect(await counted(tx, founderA)).toEqual({ approvals: 1, acceptances: 0 });
      // Accepted: nothing waits for it any more.
      await tx.setContext(employeeA);
      await tx.exec(
        `update office.requester_approvals set status = 'approved' where task_id = $1`,
        [second.task],
      );
      expect(await counted(tx, employeeA)).toEqual({ approvals: 0, acceptances: 1 });

      // Appointed for the unit: the results of the steps routed from now on, and not the earlier
      // one (its step keeps the approver it was given). The founder may decide both.
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvers set user_id = $2 where company_id = $1 and unit_code = 'HAF'`,
        [ids.arma, ids.approverA],
      );
      const appointed = await submittedRequest(tx);
      expect((await desk(tx, approverA)).approvals).toEqual([appointed.task]);
      expect(await counted(tx, approverA)).toEqual({ approvals: 1, acceptances: 0 });
      expect((await desk(tx, founderA)).approvals.sort()).toEqual([w1.task, appointed.task].sort());
      expect(await counted(tx, founderA)).toEqual({ approvals: 2, acceptances: 0 });
      expect(await counted(tx, colleagueA)).toEqual({ approvals: 0, acceptances: 1 });

      // A result closed by a stop waits for nobody.
      await tx.setContext(founderA);
      await tx.rows(CLOSE_WITH, [w1.task, 'Sent twice by mistake']);
      expect(await counted(tx, founderA)).toEqual({ approvals: 1, acceptances: 0 });
      // The right is asked every time: without it the appointment counts nothing.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.memberships set can_approve = false where company_id = $1 and user_id = $2`,
        [ids.arma, ids.approverA],
      );
      expect(await counted(tx, approverA)).toEqual(NOTHING);
      expect(await counted(tx, founderA)).toEqual({ approvals: 1, acceptances: 0 });
    });
  });

  it('the count gives nothing of another company, without a context, to an agent run, to an external person or outside the project', async () => {
    await inTransaction(async (tx) => {
      // In Arma DX one result waits for the founder and two approved ones for employee A.
      await submittedRequest(tx);
      const second = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.exec(APPROVE, [second.approval]);
      expect(await counted(tx, founderA)).toEqual({ approvals: 1, acceptances: 0 });
      expect(await counted(tx, employeeA)).toEqual({ approvals: 0, acceptances: 2 });
      // Pillika has its own: the fixture's approved result waits for its requester there, and
      // nothing of Arma DX is counted for the same founder.
      expect(await counted(tx, founderP)).toEqual(NOTHING);
      expect(await counted(tx, employeeP)).toEqual({ approvals: 0, acceptances: 1 });
      // The same people in a company they are not a member of, and no context at all.
      expect(await counted(tx, { companyId: ids.pillika, userId: ids.employeeA })).toEqual(NOTHING);
      expect(await counted(tx, { companyId: ids.arma, userId: ids.employeeP })).toEqual(NOTHING);
      expect(await counted(tx, { userId: ids.founder })).toEqual(NOTHING);
      expect(await counted(tx, { companyId: ids.arma })).toEqual(NOTHING);
      expect(await counted(tx, {})).toEqual(NOTHING);
      // An external person has no request and decides none.
      expect(await counted(tx, externalA)).toEqual(NOTHING);
      // Nothing waits for an agent run, also when it goes in the founder's or the requester's
      // name.
      expect(await asked(tx, agentRun(ids.founder, 'KOR-1'))).toEqual(NOTHING);
      expect(await asked(tx, agentRun(ids.employeeA, 'HAF-1'))).toEqual(NOTHING);

      // A result inside a project: its step names an approver who is a member of the project.
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.approvers (company_id, unit_code, user_id) values ($1, 'KOR', $2)`,
        [ids.arma, ids.approverA],
      );
      await tx.exec(
        `insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)`,
        [ids.arma, ids.projectA, ids.approverA],
      );
      await tx.setContext(employeeA);
      const inProject = await openRequest(tx, ids.projectA);
      await tx.setContext(founderA);
      await tx.rows(CORRECT, [inProject, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]);
      const projectRun = { ...agentRun(ids.employeeA, 'KOR-1'), projectId: ids.projectA };
      await tx.setContext(projectRun);
      const run = await openRun(tx, inProject, 'KOR-1');
      await one(tx, SUBMIT.replace("'HAF-1'", "'KOR-1'"), [inProject, run, null]);
      expect((await desk(tx, approverA)).approvals).toEqual([inProject]);
      expect(await counted(tx, approverA)).toEqual({ approvals: 1, acceptances: 0 });
      expect(await counted(tx, founderA)).toEqual({ approvals: 2, acceptances: 0 });
      // An insider who is not a member of the project, and a run in the project.
      expect(await counted(tx, colleagueA)).toEqual(NOTHING);
      expect(await asked(tx, projectRun)).toEqual(NOTHING);
      expect(
        await asked(tx, { ...agentRun(ids.founder, 'KOR-1'), projectId: ids.projectA }),
      ).toEqual(NOTHING);
      // Taken out of the project, the approver no longer reads the request or its result: the
      // step still names the person and nothing is counted.
      await tx.setContext(founderA);
      expect(
        await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
          ids.projectA,
          ids.approverA,
        ]),
      ).toBe(1);
      expect(
        await tx.count(
          'task_routings',
          `task_id = $1 and status = 'active' and approver_user_id = $2`,
          [inProject, ids.approverA],
        ),
      ).toBe(1);
      expect(await counted(tx, approverA)).toEqual(NOTHING);
      expect(await counted(tx, founderA)).toEqual({ approvals: 2, acceptances: 0 });
    });
    // The worker's role: a run is answered with nothing, in the name of the founder or of a
    // requester whose acceptance waits (the fixture's), in either company.
    await inWorkerTransaction(async (tx) => {
      for (const context of [
        agentRun(ids.founder, 'KOR-1'),
        agentRun(ids.employeeA, 'KOR-1'),
        agentRun(ids.employeeP, 'KOR-1', ids.pillika),
      ]) {
        expect(await asked(tx, context)).toEqual(NOTHING);
      }
    });
  });
});

describe.skipIf(noDatabase)('the open requests the office view counts', () => {
  afterAll(closePools);

  const ALL = { coordinator: 'KOR-1', limit: 50 };

  async function openFor(tx: Tx, context: ContextInput): Promise<string[]> {
    await tx.setContext(context);
    return (await listOpenRequests(tx.client, ALL)).map((row) => row.id);
  }

  it('gives every open request the reader may read, the longest wait first, with the facts of its stage', async () => {
    await inTransaction(async (tx) => {
      // The fixture's request waits for its requester. Added here: one that was only opened, one
      // whose result waits for the founder, one that is done and one that was stopped.
      await tx.setContext(colleagueA);
      const opened = await openRequest(tx);
      const waiting = await submittedRequest(tx);
      const finished = await submittedRequest(tx);
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
        finished.approval,
      ]);
      await tx.setContext(employeeA);
      await tx.exec(
        `update office.requester_approvals set status = 'approved' where task_id = $1`,
        [finished.task],
      );
      expect(await statusOf(tx, finished.task)).toBe('done');
      await tx.setContext(employeeA);
      const closed = await openRequest(tx);
      await tx.setContext(founderA);
      await tx.rows('select office.close_request($1, $2)', [closed, 'Sent twice by mistake']);

      await tx.setContext(founderA);
      const rows = await listOpenRequests(tx.client, ALL);
      expect(rows.map((row) => row.id).sort()).toEqual([ids.requestA, opened, waiting.task].sort());
      // The one that has not moved for longest first; rows of one instant by id.
      expect(rows[0]?.id).toBe(ids.requestA);
      expect(rows.slice(1).map((row) => row.id)).toEqual([opened, waiting.task].sort());
      // The same row as the request page reads: the facts the stage is derived from.
      expect(rows.find((row) => row.id === waiting.task)).toMatchObject({
        status: 'awaiting_approval',
        step_agent_code: 'HAF-1',
        pending_result: true,
        pending_acceptance: false,
      });
      expect(rows.find((row) => row.id === opened)).toMatchObject({
        status: 'open',
        routed: false,
        step_agent_code: null,
        run_agent_code: null,
      });
      expect(await readRequest(tx.client, 'KOR-1', waiting.task)).toEqual(
        rows.find((row) => row.id === waiting.task),
      );
      // The limit cuts after the order.
      expect(
        (await listOpenRequests(tx.client, { coordinator: 'KOR-1', limit: 2 })).map(
          (row) => row.id,
        ),
      ).toEqual([ids.requestA, [opened, waiting.task].sort()[0]]);

      // An employee who is not the requester of any of them reads the same requests (they are
      // not inside a project), unlike the pick of the Bugün list.
      expect((await openFor(tx, colleagueA)).sort()).toEqual(
        [ids.requestA, opened, waiting.task].sort(),
      );
      expect(await listExpectedRequests(tx.client, ALL)).toHaveLength(1);
    });
  });

  it('gives nothing of another company, without a context, to an agent run or to an external person', async () => {
    await inTransaction(async (tx) => {
      const { task } = await submittedRequest(tx);
      expect(await openFor(tx, founderA)).toContain(task);
      // Pillika's founder and employee get Pillika's request alone.
      expect(await openFor(tx, founderP)).toEqual([ids.requestP]);
      expect(await openFor(tx, employeeP)).toEqual([ids.requestP]);
      // A person in a company they are not a member of, and a context that lacks a part.
      expect(await openFor(tx, { companyId: ids.pillika, userId: ids.employeeA })).toEqual([]);
      expect(await openFor(tx, { companyId: ids.arma, userId: ids.employeeP })).toEqual([]);
      expect(await openFor(tx, { userId: ids.founder })).toEqual([]);
      expect(await openFor(tx, { companyId: ids.arma })).toEqual([]);
      expect(await openFor(tx, {})).toEqual([]);
      // The founder space has no request.
      expect(await openFor(tx, { companyId: ids.founderSpace, userId: ids.founder })).toEqual([]);
      // An agent run is answered with nothing, whoever its identity is.
      expect(await openFor(tx, agentRun(ids.founder, 'KOR-1'))).toEqual([]);
      expect(await openFor(tx, agentRun(ids.employeeA, 'HAF-1'))).toEqual([]);
      expect(await openFor(tx, externalA)).toEqual([]);
    });
    // The worker's role cannot ask at all: the facts of a request's flow are the API's alone.
    await inWorkerTransaction(async (tx) => {
      for (const context of [agentRun(ids.founder, 'KOR-1'), founderA]) {
        await tx.setContext(context);
        await tx.client.query('savepoint office_pick');
        await expect(listOpenRequests(tx.client, ALL)).rejects.toMatchObject({ code: '42501' });
        await tx.client.query('rollback to savepoint office_pick');
      }
    });
  });

  it('leaves a request inside a project out for a reader who is not its member', async () => {
    await inTransaction(async (tx) => {
      // Employee A is a member of project A; the colleague and the approver are not.
      await tx.setContext(employeeA);
      const inProject = await openRequest(tx, ids.projectA);
      expect(await openFor(tx, employeeA)).toContain(inProject);
      expect(await openFor(tx, founderA)).toContain(inProject);
      expect(await openFor(tx, colleagueA)).not.toContain(inProject);
      expect(await openFor(tx, approverA)).not.toContain(inProject);
      // Made a member, the same person reads it; taken out again, no longer.
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)`,
        [ids.arma, ids.projectA, ids.sharedEmployee],
      );
      expect(await openFor(tx, colleagueA)).toContain(inProject);
      await tx.setContext(founderA);
      await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
        ids.projectA,
        ids.sharedEmployee,
      ]);
      expect(await openFor(tx, colleagueA)).not.toContain(inProject);
    });
  });
});

describe.skipIf(noDatabase)('stopping an agent only where it is open', () => {
  afterAll(closePools);

  const switchOf = async (tx: Tx, company: string, agent: string): Promise<string | null> => {
    const rows = await tx.rows<{ status: string }>(
      'select status from office.company_agents where company_id = $1 and agent_code = $2',
      [company, agent],
    );
    return rows[0]?.status ?? null;
  };

  it('stops an open agent and touches nothing else: not a stopped one, not one without a row', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      // The fixtures: in Arma DX KOR-1 is open and HAF-1 is stopped; Pillika has no row for HAF-1.
      expect(await readAgentSwitch(tx.client, 'KOR-1')).toEqual({
        name: 'Ofis Koordinatörü',
        ready: true,
        status: 'enabled',
      });
      const stopped = await stopAgentIfOpen(tx.client, 'KOR-1');
      expect(stopped).not.toBeNull();
      expect(await switchOf(tx, ids.arma, 'KOR-1')).toBe('stopped');
      expect((await readAgentSwitch(tx.client, 'KOR-1'))?.status).toBe('stopped');
      // A second time there is nothing to stop.
      expect(await stopAgentIfOpen(tx.client, 'KOR-1')).toBeNull();
      expect(await stopAgentIfOpen(tx.client, 'HAF-1')).toBeNull();
      expect(await switchOf(tx, ids.arma, 'HAF-1')).toBe('stopped');
      // An agent the company never opened gets no row.
      await tx.setContext(founderP);
      expect(await stopAgentIfOpen(tx.client, 'HAF-1')).toBeNull();
      expect(await switchOf(tx, ids.pillika, 'HAF-1')).toBeNull();
      expect(await readAgentSwitch(tx.client, 'HAF-1')).toMatchObject({ status: null });
      await tx.setContext(founderA);
      // A closed one stays closed.
      await tx.exec(
        `update office.company_agents set status = 'disabled'
         where company_id = $1 and agent_code = 'HAF-1'`,
        [ids.arma],
      );
      expect(await stopAgentIfOpen(tx.client, 'HAF-1')).toBeNull();
      expect(await switchOf(tx, ids.arma, 'HAF-1')).toBe('disabled');
      // An agent that does not exist.
      expect(await stopAgentIfOpen(tx.client, 'XYZ-9')).toBeNull();
      expect(await readAgentSwitch(tx.client, 'XYZ-9')).toBeNull();
    });
  });

  it('stops in the context company alone, and only for its founder', async () => {
    await inTransaction(async (tx) => {
      // The fixtures open KOR-1 in both companies.
      await tx.setContext(founderP);
      expect(await switchOf(tx, ids.pillika, 'KOR-1')).toBe('enabled');
      // Nobody but the founder: an employee, an external person, a founder of another company,
      // an agent run in the founder's name, no context.
      for (const context of [
        employeeA,
        externalA,
        { companyId: ids.arma, userId: ids.otherFounder },
        agentRun(ids.founder, 'KOR-1'),
        { companyId: ids.arma },
        {},
      ]) {
        await tx.setContext(context);
        expect(await stopAgentIfOpen(tx.client, 'KOR-1')).toBeNull();
      }
      await tx.setContext(founderA);
      expect(await switchOf(tx, ids.arma, 'KOR-1')).toBe('enabled');

      // The founder stops it in Arma DX: Pillika's switch is another row and stays open.
      expect(await stopAgentIfOpen(tx.client, 'KOR-1')).not.toBeNull();
      expect(await switchOf(tx, ids.arma, 'KOR-1')).toBe('stopped');
      await tx.setContext(founderP);
      expect(await switchOf(tx, ids.pillika, 'KOR-1')).toBe('enabled');
      expect((await readAgentSwitch(tx.client, 'KOR-1'))?.status).toBe('enabled');
      // Each company is stopped from its own context.
      expect(await stopAgentIfOpen(tx.client, 'KOR-1')).not.toBeNull();
      expect(await switchOf(tx, ids.pillika, 'KOR-1')).toBe('stopped');
      // The switch of one company is never read from the other's context.
      await tx.setContext(employeeP);
      expect((await readAgentSwitch(tx.client, 'KOR-1'))?.status).toBe('stopped');
      await tx.setContext({ companyId: ids.pillika, userId: ids.employeeA });
      expect((await readAgentSwitch(tx.client, 'KOR-1'))?.status).toBeNull();
    });
  });

  it("is an act of a person: the worker's role cannot stop an agent, whatever context it sets", async () => {
    await inWorkerTransaction(async (tx) => {
      // The founder's context without an agent code is the one the row policy would let through.
      for (const context of [founderA, agentRun(ids.founder, 'KOR-1')]) {
        await tx.setContext(context);
        await tx.client.query('savepoint office_stop');
        await expect(stopAgentIfOpen(tx.client, 'KOR-1')).rejects.toMatchObject({ code: '42501' });
        await tx.client.query('rollback to savepoint office_stop');
      }
      // The runner still reads the switch, as it must before every step.
      await tx.setContext(agentRun(ids.founder, 'KOR-1'));
      expect((await readAgentSwitch(tx.client, 'KOR-1'))?.status).toBe('enabled');
    });
  });
});

// Comments on a request (8 October decision 13): the requester, the approver of the request and
// the founder write, through the API's role; whoever reads the request reads them; no agent run
// and no connection of the worker does. A comment moves nothing of the request.
const COMMENT = `insert into office.task_comments (company_id, task_id, body)
  values (office.ctx_company_id(), $1, $2)`;
const MAY_COMMENT = 'select office.may_comment_on_request($1) as may';
const NOT_ONE_OF_THREE =
  'Only the requester, the approver of the request or the founder comments on it';
const TASK_NOT_FOUND = 'task_comments.task_id linked record not found';

describe.skipIf(noDatabase)(
  'comments on a request are written by three people and read by people only',
  () => {
    afterAll(closePools);

    const commentsOf = (tx: Tx, task: string): Promise<number> =>
      tx.count('task_comments', 'task_id = $1', [task]);

    async function mayComment(tx: Tx, context: ContextInput, task: string): Promise<boolean> {
      await tx.setContext(context);
      return (await one<{ may: boolean }>(tx, MAY_COMMENT, [task])).may;
    }

    /** Who may comment, asked for the four people of Arma DX these tests use. */
    async function mayAll(tx: Tx, task: string): Promise<Record<string, boolean>> {
      return {
        requester: await mayComment(tx, employeeA, task),
        founder: await mayComment(tx, founderA, task),
        approver: await mayComment(tx, approverA, task),
        colleague: await mayComment(tx, colleagueA, task),
      };
    }
    const THE_THREE = { requester: true, founder: true, approver: true, colleague: false };
    const WITHOUT_APPROVER = { requester: true, founder: true, approver: false, colleague: false };

    /** As the founder, appoints the person as the approver of HAF in Arma DX. */
    async function appoint(tx: Tx, user: string): Promise<void> {
      await tx.setContext(founderA);
      expect(
        await tx.exec(
          `update office.approvers set user_id = $2 where company_id = $1 and unit_code = 'HAF'`,
          [ids.arma, user],
        ),
      ).toBe(1);
    }

    /**
     * A request of the employee that the coordinator routed to HAF-1 from its own run, with the
     * right holder appointed for HAF: the unit agent is about to work.
     */
    async function routedToHaf(tx: Tx): Promise<string> {
      await appoint(tx, ids.approverA);
      await enableHaf(tx);
      await tx.setContext(employeeA);
      const task = await openRequest(tx);
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const run = await openRun(tx, task, 'KOR-1');
      await tx.rows(ROUTE, [task, HAF_STEP, run]);
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [run],
      );
      return task;
    }

    /** HAF-1 submits its result on the request; returns the approval. */
    async function submit(tx: Tx, task: string): Promise<string> {
      await tx.setContext(agentRun(ids.employeeA, 'HAF-1'));
      const run = await openRun(tx, task, 'HAF-1');
      return (await one<{ id: string }>(tx, SUBMIT, [task, run, null])).id;
    }

    const stepsOf = (tx: Tx, task: string): Promise<Record<string, unknown>[]> =>
      tx.rows(
        `select round, seq, unit_code, status from office.task_routings
         where task_id = $1 order by round, seq`,
        [task],
      );

    it('the requester and the founder write; an insider who is neither, and a right holder who is not appointed, are refused and still read', async () => {
      await inTransaction(async (tx) => {
        // The fixture request: opened by the employee, routed to KOR (nobody is appointed there),
        // its result approved, the requester's approval pending.
        await tx.setContext(employeeA);
        expect(await tx.exec(COMMENT, [ids.requestA, 'Why was B chosen?'])).toBe(1);
        await tx.setContext(founderA);
        expect(await tx.exec(COMMENT, [ids.requestA, 'B is shorter.'])).toBe(1);
        for (const other of [colleagueA, approverA]) {
          await tx.setContext(other);
          expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual({
            code: '42501',
            message: NOT_ONE_OF_THREE,
          });
          expect(await commentsOf(tx, ids.requestA)).toBe(2);
        }
        expect(
          await tx.rows(
            `select body, author_user_id, author_agent_code, project_id
             from office.task_comments where task_id = $1 order by body`,
            [ids.requestA],
          ),
        ).toEqual([
          {
            body: 'B is shorter.',
            author_user_id: ids.founder,
            author_agent_code: null,
            project_id: null,
          },
          {
            body: 'Why was B chosen?',
            author_user_id: ids.employeeA,
            author_agent_code: null,
            project_id: null,
          },
        ]);
      });
    });

    it('a row that names another author, another time or another project is written with the context’s', async () => {
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        const row = await one<Record<string, unknown>>(
          tx,
          `insert into office.task_comments
             (company_id, task_id, body, author_user_id, created_at, project_id)
           values ($1, $2, 'Mine', $3, now() - interval '1 year', $4)
           returning author_user_id, author_agent_code, project_id, created_at = now() as stamped`,
          [ids.arma, ids.requestA, ids.founder, ids.projectA],
        );
        expect(row).toEqual({
          author_user_id: ids.employeeA,
          author_agent_code: null,
          project_id: null,
          stamped: true,
        });
        // A row that names another company than the context's is refused by the table's own rule.
        expect(
          (
            await tx.expectError(
              `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'x')`,
              [ids.pillika, ids.requestA],
            )
          ).code,
        ).toBe('42501');
        expect((await tx.expectError(COMMENT, [ids.requestA, '   '])).code, 'a blank comment').toBe(
          '23514',
        );
      });
    });

    it('the appointed approver of the active step writes, from the routing to the decision', async () => {
      await inTransaction(async (tx) => {
        const task = await routedToHaf(tx);
        expect(await mayAll(tx, task)).toEqual(THE_THREE);
        await tx.setContext(approverA);
        expect(await tx.exec(COMMENT, [task, 'While the agent works'])).toBe(1);
        await submit(tx, task);
        expect(await statusOf(tx, task)).toBe('awaiting_approval');
        expect(await mayAll(tx, task)).toEqual(THE_THREE);
        await tx.setContext(approverA);
        expect(await tx.exec(COMMENT, [task, 'While the result waits'])).toBe(1);
        // The requester's "not what I asked for" makes the step active again, the second one
        // leaves it done with the request in the founder's hands: the approver writes in both.
        expect(
          await tx.exec(`update office.approvals set status = 'approved' where task_id = $1`, [
            task,
          ]),
        ).toBe(1);
        const back = `update office.requester_approvals set status = 'changes_requested',
          decision_reason = 'Not this' where task_id = $1 and status = 'pending'`;
        await tx.setContext(employeeA);
        expect(await tx.exec(back, [task])).toBe(1);
        expect(await stepsOf(tx, task)).toEqual([
          { round: 1, seq: 1, unit_code: 'HAF', status: 'active' },
        ]);
        expect(await mayAll(tx, task)).toEqual(THE_THREE);
      });
    });

    it('once no step is active the approver is the one of the step that was active last: while the requester decides, when the request is done, and after a rejection', async () => {
      await inTransaction(async (tx) => {
        const task = await routedToHaf(tx);
        const approval = await submit(tx, task);
        await tx.setContext(approverA);
        await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval]);
        // The approved result waits for the requester: no step is active.
        expect(await stepsOf(tx, task)).toEqual([
          { round: 1, seq: 1, unit_code: 'HAF', status: 'done' },
        ]);
        expect(await statusOf(tx, task)).toBe('awaiting_approval');
        expect(await mayAll(tx, task)).toEqual(THE_THREE);
        await tx.setContext(approverA);
        expect(await tx.exec(COMMENT, [task, 'Approved: B fits the brief'])).toBe(1);
        await tx.setContext(employeeA);
        await tx.exec(
          `update office.requester_approvals set status = 'approved' where task_id = $1`,
          [task],
        );
        expect(await statusOf(tx, task)).toBe('done');
        expect(await mayAll(tx, task)).toEqual(THE_THREE);

        // A rejection closes the request and cancels the step: the approver who rejected is the
        // one who can say why.
        const rejected = await routedToHaf(tx);
        const result = await submit(tx, rejected);
        await tx.setContext(approverA);
        await tx.exec(
          `update office.approvals set status = 'rejected', rejection_reason = 'incomplete'
           where id = $1`,
          [result],
        );
        expect(await statusOf(tx, rejected)).toBe('cancelled');
        expect(await stepsOf(tx, rejected)).toEqual([
          { round: 1, seq: 1, unit_code: 'HAF', status: 'cancelled' },
        ]);
        expect(await mayAll(tx, rejected)).toEqual(THE_THREE);
        await tx.setContext(approverA);
        expect(await tx.exec(COMMENT, [rejected, 'Rejected: the figures are missing'])).toBe(1);
      });
    });

    it('a routing to another unit takes the comment from the approver it replaced; a returned request has no approver', async () => {
      await inTransaction(async (tx) => {
        const task = await routedToHaf(tx);
        await tx.setContext(founderA);
        await tx.rows(CORRECT, [task, JSON.stringify([{ unit: 'KOR', agent: 'KOR-1' }])]);
        // Nobody is appointed for KOR: the requester and the founder are left.
        expect(await mayAll(tx, task)).toEqual(WITHOUT_APPROVER);
        await tx.setContext(approverA);
        expect(await tx.expectError(COMMENT, [task, 'x'])).toEqual({
          code: '42501',
          message: NOT_ONE_OF_THREE,
        });
        await tx.setContext(employeeA);
        await tx.rows('select office.close_request($1)', [task]);
        expect(await statusOf(tx, task)).toBe('cancelled');
        expect(await mayAll(tx, task)).toEqual(WITHOUT_APPROVER);
      });
      await inTransaction(async (tx) => {
        // HAF-1 is stopped in the fixtures: the coordinator names the unit and no open agent can
        // take the work. The returned step still records who would have approved.
        await appoint(tx, ids.approverA);
        await tx.setContext(employeeA);
        const task = await openRequest(tx);
        await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
        const run = await openRun(tx, task, 'KOR-1');
        await tx.rows(ROUTE, [task, JSON.stringify([{ unit: 'HAF', agent: null }]), run]);
        expect(
          await tx.rows(
            `select status, approver_user_id from office.task_routings where task_id = $1`,
            [task],
          ),
        ).toEqual([{ status: 'returned', approver_user_id: ids.approverA }]);
        expect(await statusOf(tx, task)).toBe('cancelled');
        expect(await mayAll(tx, task)).toEqual(WITHOUT_APPROVER);
      });
      // A request cancelled before any routing: the requester and the founder, nobody else.
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        const task = await openRequest(tx);
        await tx.rows('select office.close_request($1)', [task]);
        expect(await mayAll(tx, task)).toEqual(WITHOUT_APPROVER);
      });
    });

    it('with several steps, the approver of the step that was active at the close writes; the one of a step that was only planned does not', async () => {
      const HAF = { unit: 'HAF', agent: 'HAF-1' };
      const KOR = { unit: 'KOR', agent: 'KOR-1' };
      await inTransaction(async (tx) => {
        const task = await routedToHaf(tx);
        await tx.setContext(founderA);
        await tx.rows(CORRECT, [task, JSON.stringify([HAF, KOR])]);
        await tx.rows('select office.close_request($1, $2)', [task, 'Stopped']);
        expect(await stepsOf(tx, task)).toEqual([
          { round: 1, seq: 1, unit_code: 'HAF', status: 'replaced' },
          { round: 2, seq: 1, unit_code: 'HAF', status: 'cancelled' },
          { round: 2, seq: 2, unit_code: 'KOR', status: 'cancelled' },
        ]);
        expect(await mayAll(tx, task)).toEqual(THE_THREE);
      });
      await inTransaction(async (tx) => {
        const task = await routedToHaf(tx);
        await tx.setContext(founderA);
        await tx.rows(CORRECT, [task, JSON.stringify([KOR, HAF])]);
        expect(await stepsOf(tx, task)).toEqual([
          { round: 1, seq: 1, unit_code: 'HAF', status: 'replaced' },
          { round: 2, seq: 1, unit_code: 'KOR', status: 'active' },
          { round: 2, seq: 2, unit_code: 'HAF', status: 'planned' },
        ]);
        // The step of HAF is only planned, and the step it had before was replaced.
        expect(await mayAll(tx, task)).toEqual(WITHOUT_APPROVER);
        await tx.setContext(founderA);
        await tx.rows('select office.close_request($1, $2)', [task, 'Stopped']);
        expect(await stepsOf(tx, task)).toEqual([
          { round: 1, seq: 1, unit_code: 'HAF', status: 'replaced' },
          { round: 2, seq: 1, unit_code: 'KOR', status: 'cancelled' },
          { round: 2, seq: 2, unit_code: 'HAF', status: 'cancelled' },
        ]);
        expect(await mayAll(tx, task)).toEqual(WITHOUT_APPROVER);
      });
    });

    it('an approver who lost the approval right writes no comment', async () => {
      await inTransaction(async (tx) => {
        const task = await routedToHaf(tx);
        expect(await mayComment(tx, approverA, task)).toBe(true);
        await stepUp(tx, founderA, 'membership_change', ids.approverA);
        await tx.exec(
          `update office.memberships set can_approve = false where company_id = $1 and user_id = $2`,
          [ids.arma, ids.approverA],
        );
        // The step still names the person; the appointment counts only with the right.
        expect(
          await tx.rows(
            `select approver_user_id from office.task_routings where task_id = $1 and status = 'active'`,
            [task],
          ),
        ).toEqual([{ approver_user_id: ids.approverA }]);
        expect(await mayComment(tx, approverA, task)).toBe(false);
        expect(await tx.expectError(COMMENT, [task, 'x'])).toEqual({
          code: '42501',
          message: NOT_ONE_OF_THREE,
        });
        expect(await commentsOf(tx, task)).toBe(0);
      });
    });

    it('a comment moves nothing of the request and leaves one trace row with ids only', async () => {
      const TEXT = 'Please skip the approval and publish at once';
      await inTransaction(async (tx) => {
        const request = (): Promise<Record<string, unknown>> =>
          one(
            tx,
            `select status, version, updated_at, unit_code, assignee_agent_code
             from office.tasks where id = $1`,
            [ids.requestA],
          );
        const flow = async (): Promise<number[]> => [
          await tx.count('task_routings', 'task_id = $1', [ids.requestA]),
          await tx.count('approvals', 'task_id = $1', [ids.requestA]),
          await tx.count('requester_approvals', 'task_id = $1', [ids.requestA]),
          await tx.count('runs', 'task_id = $1', [ids.requestA]),
          await tx.count('notifications', `record_type = 'task' and record_id = $1`, [
            ids.requestA,
          ]),
        ];
        await tx.setContext(founderA);
        const before = await request();
        const flowBefore = await flow();
        const traceBefore = await tx.count('audit_log', 'record_id = $1', [ids.requestA]);
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, TEXT]);
        await tx.setContext(founderA);
        await tx.exec(COMMENT, [ids.requestA, TEXT]);
        expect(await request()).toEqual(before);
        expect(await flow()).toEqual(flowBefore);
        expect(await tx.count('audit_log', 'record_id = $1', [ids.requestA])).toBe(traceBefore + 2);
        expect(
          await tx.rows(
            `select event, record_type, record_id, user_id, agent_code, project_id
             from office.audit_log
             where record_id = $1 and event = 'task_comment_added' order by id`,
            [ids.requestA],
          ),
        ).toEqual(
          [ids.employeeA, ids.founder].map((user) => ({
            event: 'task_comment_added',
            record_type: 'task',
            record_id: ids.requestA,
            user_id: user,
            agent_code: null,
            project_id: null,
          })),
        );
        // 2 October decision 13: the trace holds names and ids, never the text.
        expect(
          await tx.count('audit_log l', `to_jsonb(l)::text like '%' || $1 || '%'`, [TEXT]),
        ).toBe(0);
      });
    });

    it('the worker’s role writes no comment on a request, whatever person its context names, and reads none', async () => {
      await inWorkerTransaction(async (tx) => {
        for (const person of [employeeA, founderA]) {
          await tx.setContext(person);
          expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual({
            code: '42501',
            message: 'A comment on a request is written through the API',
          });
        }
      });
      // A comment the API's role wrote and did not commit is not there for a connection of the
      // worker, so one privileged transaction writes it in the requester's name and reads it
      // with each role.
      await inAdminTransaction(async (tx) => {
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, 'For people']);
        await asRole(tx, 'app');
        expect(await commentsOf(tx, ids.requestA)).toBe(1);
        await asRole(tx, 'worker');
        for (const person of [employeeA, founderA]) {
          await tx.setContext(person);
          expect(await tx.count('tasks', 'id = $1', [ids.requestA])).toBe(1);
          expect(await commentsOf(tx, ids.requestA)).toBe(0);
          // The comment of a task between people is still there for the worker's role.
          expect(await commentsOf(tx, ids.taskA)).toBe(1);
        }
      });
    });

    it('an agent run neither writes nor reads a comment of a request, with either role, inside or outside the project', async () => {
      const NO_AGENT = { code: '42501', message: 'An agent writes no comment on a request' };
      await inAdminTransaction(async (tx) => {
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, 'For people']);
        // A request inside a project, with a comment of its requester (a member of the project).
        const inProject = await openRequest(tx, ids.projectA);
        await tx.exec(COMMENT, [inProject, 'For the people of the project']);

        for (const role of ['app', 'worker'] as const) {
          await asRole(tx, role);
          for (const agent of ['KOR-1', 'HAF-1']) {
            for (const user of [ids.employeeA, ids.founder]) {
              await tx.setContext(agentRun(user, agent));
              expect(await tx.count('tasks', 'id = $1', [ids.requestA])).toBe(1);
              expect(await commentsOf(tx, ids.requestA)).toBe(0);
              expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual(NO_AGENT);
              expect((await one<{ may: boolean }>(tx, MAY_COMMENT, [ids.requestA])).may).toBe(
                false,
              );
              // No comment of any request is in what the run reads of the table.
              expect(
                await tx.count(
                  'task_comments k',
                  `exists (
                     select 1 from office.tasks t where t.id = k.task_id and t.kind = 'request'
                   )`,
                ),
              ).toBe(0);
            }
          }
          // A run in the project reads the request and none of its comments.
          await tx.setContext({ ...agentRun(ids.employeeA, 'KOR-1'), projectId: ids.projectA });
          expect(await tx.count('tasks', 'id = $1', [inProject])).toBe(1);
          expect(await commentsOf(tx, inProject)).toBe(0);
          expect(await tx.expectError(COMMENT, [inProject, 'x'])).toEqual(NO_AGENT);
        }
        // Not an empty answer for everybody: the people of the request read them.
        await asRole(tx, 'app');
        await tx.setContext(employeeA);
        expect(await commentsOf(tx, ids.requestA)).toBe(1);
        expect(await commentsOf(tx, inProject)).toBe(1);
      });
    });

    it('a comment of a request stays closed to an agent run and to the worker’s role when the request itself is hidden from them', async () => {
      await inAdminTransaction(async (tx) => {
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, 'For people']);
        // What a later rule could look like (rule 12 in code: records closed to agent runs). It
        // goes with the transaction.
        await tx.exec(
          `create policy later_rule on office.tasks as restrictive for select to office_app
           using (office.ctx_agent_code() is null)`,
        );
        for (const role of ['worker', 'app'] as const) {
          await asRole(tx, role);
          await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
          expect(await tx.count('tasks', 'id = $1', [ids.requestA])).toBe(0);
          expect(await commentsOf(tx, ids.requestA)).toBe(0);
          expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual({
            code: '23503',
            message: TASK_NOT_FOUND,
          });
        }
        await asRole(tx, 'worker');
        await tx.setContext(employeeA);
        expect(await commentsOf(tx, ids.requestA)).toBe(0);
        // People still read it through the API's role.
        await asRole(tx, 'app');
        await tx.setContext(colleagueA);
        expect(await commentsOf(tx, ids.requestA)).toBe(1);
      });
    });

    it('nobody changes or deletes a comment', async () => {
      const CHANGE = `update office.task_comments set body = 'Other' where task_id = $1`;
      const REMOVE = 'delete from office.task_comments where task_id = $1';
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, 'Written once']);
        for (const person of [employeeA, founderA]) {
          await tx.setContext(person);
          expect((await tx.expectError(CHANGE, [ids.requestA])).code).toBe('42501');
          expect((await tx.expectError(REMOVE, [ids.requestA])).code).toBe('42501');
        }
        expect(
          await tx.rows('select body from office.task_comments where task_id = $1', [ids.requestA]),
        ).toEqual([{ body: 'Written once' }]);
      });
      await inWorkerTransaction(async (tx) => {
        for (const context of [employeeA, founderA, agentRun(ids.founder, 'KOR-1')]) {
          await tx.setContext(context);
          expect((await tx.expectError(CHANGE, [ids.taskA])).code).toBe('42501');
          expect((await tx.expectError(REMOVE, [ids.taskA])).code).toBe('42501');
        }
      });
    });

    it('comments stay inside the company and need a context', async () => {
      const NAMED = `insert into office.task_comments (company_id, task_id, body)
        values ($1, $2, 'x')`;
      const REFUSED = { code: '23503', message: TASK_NOT_FOUND };
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, 'Inside Arma DX']);
        for (const outside of [
          founderP,
          employeeP,
          // A Pillika employee who claims the Arma DX context is not a member there.
          { companyId: ids.arma, userId: ids.employeeP },
        ]) {
          await tx.setContext(outside);
          expect(await commentsOf(tx, ids.requestA)).toBe(0);
          expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual(REFUSED);
          for (const company of [ids.arma, ids.pillika]) {
            expect(await tx.expectError(NAMED, [company, ids.requestA])).toEqual(REFUSED);
          }
          expect((await one<{ may: boolean }>(tx, MAY_COMMENT, [ids.requestA])).may).toBe(false);
        }
        await tx.setContext({});
        expect(await tx.count('task_comments')).toBe(0);
        expect(await tx.expectError(NAMED, [ids.arma, ids.requestA])).toEqual(REFUSED);
        expect((await one<{ may: boolean }>(tx, MAY_COMMENT, [ids.requestA])).may).toBe(false);
      });
      // The privileged role reads every row, and is still nobody of the request.
      await inAdminTransaction(async (tx) => {
        await tx.setContext({});
        expect(await tx.expectError(NAMED, [ids.arma, ids.requestA])).toEqual({
          code: '42501',
          message: NOT_ONE_OF_THREE,
        });
      });
    });

    it('the comments of a project request are read and written by the project’s members and the founder', async () => {
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        const task = await openRequest(tx, ids.projectA);
        expect(await tx.exec(COMMENT, [task, 'Inside the project'])).toBe(1);
        expect(
          await tx.rows('select project_id from office.task_comments where task_id = $1', [task]),
        ).toEqual([{ project_id: ids.projectA }]);
        // Not members of the project, with or without the approval right.
        for (const other of [colleagueA, approverA]) {
          await tx.setContext(other);
          expect(await commentsOf(tx, task)).toBe(0);
          expect(await tx.expectError(COMMENT, [task, 'x'])).toEqual({
            code: '23503',
            message: TASK_NOT_FOUND,
          });
        }
        await tx.setContext(founderA);
        expect(await commentsOf(tx, task)).toBe(1);
        expect(await tx.exec(COMMENT, [task, 'The founder reads every project'])).toBe(1);
        await tx.setContext(employeeA);
        expect(await commentsOf(tx, task)).toBe(2);
      });
    });

    it('an external person reads and writes no comment of a request, also one opened to them by hand', async () => {
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        await tx.exec(COMMENT, [ids.requestA, 'Among insiders']);
        await tx.setContext(externalA);
        expect(await tx.count('tasks', 'id = $1', [ids.requestA])).toBe(0);
        expect(await commentsOf(tx, ids.requestA)).toBe(0);
        expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual({
          code: '23503',
          message: TASK_NOT_FOUND,
        });
        // No route of the API opens a request to an external person; a row made by hand could
        // (docs/SONRA.md D-i). The comments stay closed all the same.
        await stepUp(tx, founderA, 'access_grant', ids.externalA);
        await tx.exec(
          `insert into office.access_grants (company_id, user_id, record_type, record_id)
           values ($1, $2, 'task', $3)`,
          [ids.arma, ids.externalA, ids.requestA],
        );
        await tx.setContext(externalA);
        expect(await tx.count('tasks', 'id = $1', [ids.requestA])).toBe(1);
        expect(await commentsOf(tx, ids.requestA)).toBe(0);
        expect(await tx.expectError(COMMENT, [ids.requestA, 'x'])).toEqual({
          code: '42501',
          message: NOT_ONE_OF_THREE,
        });
        expect((await one<{ may: boolean }>(tx, MAY_COMMENT, [ids.requestA])).may).toBe(false);
      });
    });

    it('comments of a task between people keep their rules', async () => {
      await inWorkerTransaction(async (tx) => {
        // An agent run with the worker's role comments on a task between people and reads it.
        await tx.setContext(agentRun(ids.founder, 'KOR-1'));
        expect(await commentsOf(tx, ids.taskA)).toBe(1);
        expect(await tx.exec(COMMENT, [ids.taskA, 'From the run'])).toBe(1);
        expect(
          await tx.rows(
            `select author_user_id, author_agent_code from office.task_comments
             where task_id = $1 and body = 'From the run'`,
            [ids.taskA],
          ),
        ).toEqual([{ author_user_id: null, author_agent_code: 'KOR-1' }]);
        expect((await one<{ may: boolean }>(tx, MAY_COMMENT, [ids.taskA])).may).toBe(false);
        // A person in the worker's context too, as before.
        await tx.setContext(employeeA);
        expect(await tx.exec(COMMENT, [ids.taskA, 'In a person’s name'])).toBe(1);
        expect(await commentsOf(tx, ids.taskA)).toBe(3);
      });
      await inTransaction(async (tx) => {
        // Every insider who reads the task comments on it, not three people.
        await tx.setContext(colleagueA);
        expect(await tx.exec(COMMENT, [ids.taskA, 'From a colleague'])).toBe(1);
        // An external person on a task opened to them reads its comments and adds one.
        await tx.setContext(externalA);
        expect(await commentsOf(tx, ids.taskAShared)).toBe(1);
        expect(
          await tx.exec(
            `insert into office.task_comments (company_id, task_id, body, author_user_id)
             values ($1, $2, 'From the accountant', $3)`,
            [ids.arma, ids.taskAShared, ids.externalA],
          ),
        ).toBe(1);
        expect(await commentsOf(tx, ids.taskAShared)).toBe(2);
        // And none of a task that was not opened to them.
        expect(await commentsOf(tx, ids.taskA)).toBe(0);
        expect((await tx.expectError(COMMENT, [ids.taskA, 'x'])).code).toBe('23503');
        // The question about requests is not about tasks between people.
        await tx.setContext(founderA);
        expect((await one<{ may: boolean }>(tx, MAY_COMMENT, [ids.taskA])).may).toBe(false);
      });
    });

    it('lists the newest comments of a request and adds one once', async () => {
      const add = (tx: Tx, id: string, body: string, requestId: string = ids.requestA) =>
        insertRequestComment(tx.client, { id, requestId, body });
      /** How the statement ends for this context: stored or not, or the code it was refused with. */
      const outcome = async (tx: Tx, context: ContextInput): Promise<boolean | string> => {
        await tx.setContext(context);
        await tx.client.query('savepoint add_comment');
        try {
          return await add(tx, randomUUID(), 'x');
        } catch (error) {
          await tx.client.query('rollback to savepoint add_comment');
          return (error as { code?: string }).code ?? 'error';
        }
      };
      await inTransaction(async (tx) => {
        await tx.setContext(employeeA);
        const first = randomUUID();
        expect(await add(tx, first, 'One')).toBe(true);
        // The same id again adds nothing and changes nothing.
        expect(await add(tx, first, 'One, sent again')).toBe(false);
        expect(await ownRequestCommentExists(tx.client, first, ids.requestA)).toBe(true);
        // It is this person's comment on this request, and on no other.
        expect(await ownRequestCommentExists(tx.client, first, ids.taskA)).toBe(false);
        expect(await ownRequestCommentExists(tx.client, randomUUID(), ids.requestA)).toBe(false);
        await tx.setContext(founderA);
        expect(await ownRequestCommentExists(tx.client, first, ids.requestA)).toBe(false);
        // An id that is somebody else's stores nothing either.
        expect(await add(tx, first, 'With the id of another person')).toBe(false);
        const [second, third] = [randomUUID(), randomUUID()];
        expect(await add(tx, second, 'Two')).toBe(true);
        expect(await add(tx, third, 'Three')).toBe(true);

        const all = await listRequestComments(tx.client, ids.requestA, 10);
        expect(all.map((row) => ({ ...row, created_at: row.created_at instanceof Date }))).toEqual(
          // Written in one transaction they carry one time: the id then decides, descending.
          [
            { id: first, author_user_id: ids.employeeA, body: 'One', created_at: true },
            { id: second, author_user_id: ids.founder, body: 'Two', created_at: true },
            { id: third, author_user_id: ids.founder, body: 'Three', created_at: true },
          ].sort((a, b) => (a.id < b.id ? 1 : -1)),
        );
        expect(await listRequestComments(tx.client, ids.requestA, 2)).toEqual(all.slice(0, 2));
        // A task between people has comments in the fixtures; they are not a request's.
        expect(await tx.count('task_comments', 'task_id = $1', [ids.taskA])).toBe(1);
        expect(await listRequestComments(tx.client, ids.taskA, 10)).toEqual([]);

        expect(await mayCommentOnRequest(tx.client, ids.requestA)).toBe(true);
        expect(await mayCommentOnRequest(tx.client, ids.taskA)).toBe(false);
        expect(await mayCommentOnRequest(tx.client, randomUUID())).toBe(false);
        await tx.setContext(employeeA);
        expect(await mayCommentOnRequest(tx.client, ids.requestA)).toBe(true);
        await tx.setContext(colleagueA);
        expect(await mayCommentOnRequest(tx.client, ids.requestA)).toBe(false);
        // Not one of the three, and still a reader.
        expect(await listRequestComments(tx.client, ids.requestA, 10)).toEqual(all);
        expect(await outcome(tx, colleagueA)).toBe('42501');

        // Another company, no context and an agent run: nothing is read and nothing is written.
        for (const [context, refusal] of [
          [founderP, '23503'],
          [employeeP, '23503'],
          [{}, '23503'],
          [agentRun(ids.employeeA, 'KOR-1'), '42501'],
          [agentRun(ids.founder, 'HAF-1'), '42501'],
        ] as const) {
          await tx.setContext(context);
          expect(await listRequestComments(tx.client, ids.requestA, 10)).toEqual([]);
          expect(await ownRequestCommentExists(tx.client, first, ids.requestA)).toBe(false);
          expect(await mayCommentOnRequest(tx.client, ids.requestA)).toBe(false);
          expect(await outcome(tx, context)).toBe(refusal);
        }
        await tx.setContext(founderA);
        expect(await listRequestComments(tx.client, ids.requestA, 10)).toEqual(all);
      });
      // The worker's role, with the person alone in its context: the statements read nothing and
      // write nothing.
      await inWorkerTransaction(async (tx) => {
        for (const person of [employeeA, founderA]) {
          expect(await outcome(tx, person)).toBe('42501');
          expect(await listRequestComments(tx.client, ids.requestA, 10)).toEqual([]);
        }
      });
    });
  },
);

// The due day of a request (docs/SONRA.md W-h): information only. tasks.due_at takes it when the
// request is opened; afterwards nobody changes it, as nobody changes anything of a request by hand.
describe.skipIf(noDatabase)('the due day of a request', () => {
  afterAll(closePools);

  /** Opens a request of the context person with the statement the API uses. */
  async function openWithDay(tx: Tx, dueDate: string | null): Promise<string> {
    const id = randomUUID();
    await insertRequest(tx.client, { id, title: 'A request', text: 'What is wanted', dueDate });
    return id;
  }

  it('a request takes its due day when it is opened and nobody changes it afterwards', async () => {
    const refusal = { code: '42501', message: 'A request changes only through its flow' };
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openWithDay(tx, '2026-10-20');
      const dueOf = (): Promise<{ day: string | null }> =>
        one(tx, `select ${dueDaySql('due_at')} as day from office.tasks where id = $1`, [task]);
      expect(await dueOf()).toEqual({ day: '2026-10-20' });
      for (const person of [employeeA, founderA]) {
        await tx.setContext(person);
        for (const change of [
          `due_at = now()`,
          `due_at = null`,
          `due_at = due_at + interval '1 day'`,
        ]) {
          expect(
            await tx.expectError(`update office.tasks set ${change} where id = $1`, [task]),
          ).toEqual(refusal);
        }
      }
      expect(await dueOf()).toEqual({ day: '2026-10-20' });
      // Opening it left the one trace row of a new request.
      expect(
        await tx.rows('select event from office.audit_log where record_id = $1 order by id', [
          task,
        ]),
      ).toEqual([{ event: 'request_created' }]);
    });
    await inAdminTransaction(async (tx) => {
      // The privileged role is refused like everybody, and the flow's own role has no privilege
      // on the column: no function of the flow can move the day.
      expect(
        await tx.expectError(`update office.tasks set due_at = now() where id = $1`, [
          ids.requestA,
        ]),
      ).toEqual(refusal);
      expect(
        await one(
          tx,
          `select has_column_privilege('office_trigger', 'office.tasks', 'due_at', 'update') as flow,
                  has_column_privilege('office_trigger', 'office.tasks', 'status', 'update') as status`,
        ),
      ).toEqual({ flow: false, status: true });
    });
  });

  it('the due day is the office’s day: stored as its last second in Istanbul and read back as the same day', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const withDay = await openWithDay(tx, '2026-10-20');
      const without = await openWithDay(tx, null);
      // The statements name the zone themselves: what the session's zone is changes neither what
      // is stored nor what is read. (The instant prints differently per session, +03 on a server
      // in Istanbul and +00 in CI, so instants are compared, never their text.)
      await tx.exec(`set local time zone 'America/New_York'`);
      const fromAfar = await openWithDay(tx, '2026-10-20');
      for (const zone of ['Europe/Istanbul', 'UTC', 'America/New_York']) {
        await tx.exec(`set local time zone '${zone}'`);
        for (const task of [withDay, fromAfar]) {
          expect(
            await one(
              tx,
              `select due_at = '2026-10-20 23:59:59+03'::timestamptz as last_second
               from office.tasks where id = $1`,
              [task],
            ),
            zone,
          ).toEqual({ last_second: true });
          expect((await readRequest(tx.client, 'KOR-1', task))?.due_date, zone).toBe('2026-10-20');
        }
        const none = await readRequest(tx.client, 'KOR-1', without);
        expect(none).toMatchObject({ id: without, due_date: null });
        expect(await tx.rows('select due_at from office.tasks where id = $1', [without])).toEqual([
          { due_at: null },
        ]);
        const listed = await listRequests(tx.client, {
          coordinator: 'KOR-1',
          mine: true,
          limit: 50,
        });
        expect(
          Object.fromEntries(
            listed
              .filter((row) => [withDay, without, fromAfar].includes(row.id))
              .map((row) => [row.id, row.due_date]),
          ),
          zone,
        ).toEqual({ [withDay]: '2026-10-20', [without]: null, [fromAfar]: '2026-10-20' });
      }
      // The last and the first day of a year stay the days they are.
      for (const day of ['2026-12-31', '2027-01-01', '2028-02-29']) {
        const task = await openWithDay(tx, day);
        expect((await readRequest(tx.client, 'KOR-1', task))?.due_date).toBe(day);
      }
    });
  });

  it('an agent run reads the due day of the request it works on', async () => {
    // The worker cannot open a request, and a row the API's role did not commit is not there for
    // it: one privileged transaction opens the request in the requester's name and reads it as
    // the runner does, with the worker's role and an agent context.
    await inAdminTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const task = await openWithDay(tx, '2026-10-20');
      const plain = await openWithDay(tx, null);
      await asRole(tx, 'worker');
      await tx.setContext(agentRun(ids.employeeA, 'KOR-1'));
      const read = `select ${dueDaySql('t.due_at')} as due_date from office.tasks t where t.id = $1`;
      expect(await tx.rows(read, [task])).toEqual([{ due_date: '2026-10-20' }]);
      expect(await tx.rows(read, [plain])).toEqual([{ due_date: null }]);
      // And cannot move it.
      expect(
        (await tx.expectError('update office.tasks set due_at = now() where id = $1', [task])).code,
      ).toBe('42501');
    });
  });
});

// A request inside a project (8 October decisions 11, 17 and 48; docs/SONRA.md P-h, P-m). Who may
// open it there is the row policy and office.check_task; the one rule this step adds is the
// closed project. Nothing of a request's project changes afterwards.
describe.skipIf(noDatabase)('a request inside a project', () => {
  afterAll(closePools);

  const OPEN = `insert into office.tasks (company_id, project_id, kind, title)
    values ($1, $2, 'request', 'x')`;
  const NO_AI = { code: '23514', message: 'Agents do not work in this project (AI permission)' };
  const CLOSED = { code: '23514', message: 'A closed project takes no new request' };

  it('the founder and a member open a request in a project; nobody else does, and no project of the other company is named', async () => {
    await inTransaction(async (tx) => {
      for (const person of [employeeA, founderA]) {
        await tx.setContext(person);
        const task = await openRequest(tx, ids.projectA);
        expect(
          await one(tx, 'select project_id, requester_user_id from office.tasks where id = $1', [
            task,
          ]),
        ).toEqual({ project_id: ids.projectA, requester_user_id: person.userId });
      }
      // An employee who is no member, and one with the approval right who is no member: the
      // project gives them no row, so it reads like a project without the permission.
      for (const person of [colleagueA, approverA]) {
        await tx.setContext(person);
        expect(await tx.expectError(OPEN, [ids.arma, ids.projectA])).toEqual(NO_AI);
      }
      // An external person reads no project either, and opens no request at all.
      await tx.setContext(externalA);
      expect(await tx.expectError(OPEN, [ids.arma, ids.projectA])).toEqual(NO_AI);
      expect((await tx.expectError(OPEN, [ids.arma, null])).code).toBe('42501');
      // A project of the other company is no project of this one, also for its founder.
      await tx.setContext(founderA);
      expect(await tx.expectError(OPEN, [ids.arma, ids.projectP])).toEqual(NO_AI);
      await tx.setContext(founderP);
      expect(await tx.expectError(OPEN, [ids.pillika, ids.projectA])).toEqual(NO_AI);
    });
    await inWorkerTransaction(async (tx) => {
      // The worker's role with a member's name alone is not that member.
      await tx.setContext(employeeA);
      expect(await tx.expectError(OPEN, [ids.arma, ids.projectA])).toEqual({
        code: '42501',
        message: 'A request is opened through the API',
      });
      await tx.setContext({ ...agentRun(ids.employeeA, 'KOR-1'), projectId: ids.projectA });
      expect(await tx.expectError(OPEN, [ids.arma, ids.projectA])).toEqual({
        code: '42501',
        message: 'A request is opened by a person',
      });
    });
  });

  it('a closed project takes no new request and takes one again when it is open again', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const before = await openRequest(tx, ids.projectA);
      for (const status of ['completed', 'cancelled']) {
        // A member closes the project (docs/SONRA.md P1b-i).
        await tx.setContext(employeeA);
        expect(
          await tx.exec('update office.projects set status = $2 where id = $1', [
            ids.projectA,
            status,
          ]),
        ).toBe(1);
        for (const person of [employeeA, founderA]) {
          await tx.setContext(person);
          expect(await tx.expectError(OPEN, [ids.arma, ids.projectA]), status).toEqual(CLOSED);
        }
        // Somebody who does not read the project does not learn that it is closed.
        await tx.setContext(colleagueA);
        expect(await tx.expectError(OPEN, [ids.arma, ids.projectA]), status).toEqual(NO_AI);
        // The request that was opened before the close is read as before and keeps its status.
        await tx.setContext(employeeA);
        expect(
          await tx.rows('select status, project_id from office.tasks where id = $1', [before]),
        ).toEqual([{ status: 'open', project_id: ids.projectA }]);
      }
      for (const status of ['planned', 'in_progress', 'backlog']) {
        await tx.setContext(employeeA);
        await tx.exec('update office.projects set status = $2 where id = $1', [
          ids.projectA,
          status,
        ]);
        expect(await openRequest(tx, ids.projectA), status).toEqual(expect.any(String));
      }
    });
  });

  it('a project where agents may not work takes no request: its own permission, or its customer’s', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const project of [ids.projectANoAi, ids.projectACustomerNoAi]) {
        expect(await tx.expectError(OPEN, [ids.arma, project])).toEqual(NO_AI);
      }
      // A member of such a project is refused like the founder.
      await tx.setContext(employeeA);
      expect(await tx.expectError(OPEN, [ids.arma, ids.projectANoAi])).toEqual(NO_AI);
      expect(await tx.count('tasks', `kind = 'request' and project_id is not null`)).toBe(0);
    });
  });

  it('a project request and every record of its flow are read by the project’s members and the founder only', async () => {
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      const inProject = (agent: string): ContextInput => ({
        ...agentRun(ids.employeeA, agent),
        projectId: ids.projectA,
      });
      /** A project request of the employee, walked to a result HAF-1 submitted. */
      const walked = async (): Promise<{ task: string; runs: string[]; approval: string }> => {
        await tx.setContext(employeeA);
        const task = await openRequest(tx, ids.projectA);
        await tx.setContext(inProject('KOR-1'));
        const kor = await openRun(tx, task, 'KOR-1');
        await tx.rows(ROUTE, [task, HAF_STEP, kor]);
        await tx.exec(
          `insert into office.tool_calls (company_id, run_id, seq, tool_name, status)
           values (office.ctx_company_id(), $1, 1, 'read_task', 'succeeded')`,
          [kor],
        );
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = now() where id = $1`,
          [kor],
        );
        await tx.setContext(inProject('HAF-1'));
        const haf = await openRun(tx, task, 'HAF-1');
        const approval = (await one<{ id: string }>(tx, SUBMIT, [task, haf, null])).id;
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = now() where id = $1`,
          [haf],
        );
        return { task, runs: [kor, haf], approval };
      };
      // One result approved (the requester's approval opens), one rejected (the requester is
      // told), one still waiting.
      const approved = await walked();
      const rejected = await walked();
      const waiting = await walked();
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
        approved.approval,
      ]);
      await tx.exec(
        `update office.approvals set status = 'rejected', rejection_reason = 'incomplete'
         where id = $1`,
        [rejected.approval],
      );
      const tasks = [approved.task, rejected.task, waiting.task];
      const runs = [...approved.runs, ...rejected.runs, ...waiting.runs];

      const read = async (context: ContextInput): Promise<Record<string, number>> => {
        await tx.setContext(context);
        return {
          tasks: await tx.count('tasks', 'id = any ($1::uuid[])', [tasks]),
          runs: await tx.count('runs', 'id = any ($1::uuid[])', [runs]),
          tool_calls: await tx.count('tool_calls', 'run_id = any ($1::uuid[])', [runs]),
          task_routings: await tx.count('task_routings', 'task_id = any ($1::uuid[])', [tasks]),
          approvals: await tx.count('approvals', 'task_id = any ($1::uuid[])', [tasks]),
          requester_approvals: await tx.count('requester_approvals', 'task_id = any ($1::uuid[])', [
            tasks,
          ]),
          notifications: await tx.count('notifications', 'record_id = any ($1::uuid[])', [tasks]),
          flow_facts: (
            await tx.rows('select 1 from office.request_flow_facts($1::uuid[])', [tasks])
          ).length,
        };
      };
      const everything = {
        tasks: 3,
        runs: 6,
        tool_calls: 3,
        task_routings: 3,
        approvals: 3,
        requester_approvals: 1,
        notifications: 1,
        flow_facts: 3,
      };
      const nothing = Object.fromEntries(Object.keys(everything).map((key) => [key, 0]));
      expect(await read(founderA)).toEqual(everything);
      // The member reads all of it but the results nobody approved: the waiting one and the
      // rejected one (docs/SONRA.md V-c).
      expect(await read(employeeA)).toEqual({ ...everything, approvals: 1 });
      for (const stranger of [colleagueA, approverA, externalA, founderP, employeeP, {}]) {
        expect(await read(stranger), JSON.stringify(stranger)).toEqual(nothing);
      }
      // An agent run reads them in the project's context and in no other.
      expect(await read(inProject('KOR-1'))).toMatchObject({ tasks: 3, runs: 6, task_routings: 3 });
      expect(await read(agentRun(ids.employeeA, 'KOR-1'))).toMatchObject({
        tasks: 0,
        runs: 0,
        task_routings: 0,
        approvals: 0,
      });
      expect(
        await read({ ...agentRun(ids.employeeA, 'KOR-1'), projectId: ids.projectANoAi }),
      ).toMatchObject({ tasks: 0, runs: 0, task_routings: 0, approvals: 0 });
    });
  });

  it('the statements give the project, its name and whether agents may work, and the list of one project', async () => {
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      const inProject = (agent: string): ContextInput => ({
        ...agentRun(ids.employeeA, agent),
        projectId: ids.projectA,
      });
      await tx.setContext(employeeA);
      const plain = await openRequest(tx);
      // A project request whose result waits for the approver, and one whose approved result
      // waits for its requester.
      const walked = async (): Promise<{ task: string; approval: string }> => {
        await tx.setContext(employeeA);
        const task = await openRequest(tx, ids.projectA);
        await tx.setContext(inProject('KOR-1'));
        const kor = await openRun(tx, task, 'KOR-1');
        await tx.rows(ROUTE, [task, HAF_STEP, kor]);
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = now() where id = $1`,
          [kor],
        );
        await tx.setContext(inProject('HAF-1'));
        const haf = await openRun(tx, task, 'HAF-1');
        return { task, approval: (await one<{ id: string }>(tx, SUBMIT, [task, haf, null])).id };
      };
      const waiting = await walked();
      const accepted = await walked();
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
        accepted.approval,
      ]);

      const projectOf = (row: RequestRow | null | undefined) =>
        row && {
          project_id: row.project_id,
          project_name: row.project_name,
          agents_may_work: row.agents_may_work,
        };
      const inside = { project_id: ids.projectA, project_name: 'Project A', agents_may_work: true };
      const list = (projectId: string | null): Promise<RequestRow[]> =>
        listRequests(tx.client, { coordinator: 'KOR-1', mine: false, limit: 50, projectId });
      const state = async (): Promise<unknown> => ({
        request: projectOf(await readRequest(tx.client, 'KOR-1', waiting.task)),
        listed: (await list(ids.projectA)).map((row) => row.agents_may_work),
        approvals: await (async () => {
          await tx.setContext(founderA);
          return (await listPendingApprovals(tx.client))
            .filter((row) => row.task_id === waiting.task)
            .map((row) => [row.project_id, row.project_name, row.agents_may_work]);
        })(),
        acceptances: await (async () => {
          await tx.setContext(employeeA);
          return (await listPendingAcceptances(tx.client))
            .filter((row) => row.task_id === accepted.task)
            .map((row) => row.agents_may_work);
        })(),
      });
      const held = (allowed: boolean) => ({
        request: { ...inside, agents_may_work: allowed },
        listed: [allowed, allowed],
        approvals: [[ids.projectA, 'Project A', allowed]],
        acceptances: [allowed],
      });

      for (const reader of [employeeA, founderA]) {
        await tx.setContext(reader);
        expect(projectOf(await readRequest(tx.client, 'KOR-1', waiting.task))).toEqual(inside);
        expect(projectOf(await readRequest(tx.client, 'KOR-1', plain))).toEqual({
          project_id: null,
          project_name: null,
          agents_may_work: true,
        });
        // The list of one project holds that project's requests and no other.
        expect((await list(ids.projectA)).map((row) => row.id).sort()).toEqual(
          [waiting.task, accepted.task].sort(),
        );
        expect((await list(ids.projectANoAi)).map((row) => row.id)).toEqual([]);
        const all = await list(null);
        expect(all.map((row) => row.id)).toEqual(
          expect.arrayContaining([plain, waiting.task, accepted.task]),
        );
        expect(projectOf(all.find((row) => row.id === waiting.task))).toEqual(inside);
        // Without the option the list is the whole one, as before this step.
        expect(
          (await listRequests(tx.client, { coordinator: 'KOR-1', mine: false, limit: 50 })).length,
        ).toBe(all.length);
      }
      // Somebody who does not read the project gets none of its requests, with or without the
      // filter, and no project of the other company is listed.
      for (const stranger of [colleagueA, approverA, externalA, founderP]) {
        await tx.setContext(stranger);
        expect(await list(ids.projectA), JSON.stringify(stranger)).toEqual([]);
        expect(await readRequest(tx.client, 'KOR-1', waiting.task)).toBeNull();
        expect((await list(null)).some((row) => row.project_id !== null)).toBe(false);
      }

      await tx.setContext(employeeA);
      expect(await state()).toEqual(held(true));
      // The project's own permission is closed; then it is opened and the customer's is closed.
      await tx.setContext(founderA);
      await tx.rows('select office.set_project_ai_permission($1, false, null)', [ids.projectA]);
      await tx.setContext(employeeA);
      expect(await state()).toEqual(held(false));
      await stepUp(tx, founderA, 'project_ai_permission', ids.projectA);
      await tx.rows('select office.set_project_ai_permission($1, true, $2)', [
        ids.projectA,
        ids.customerA,
      ]);
      await tx.setContext(employeeA);
      expect(await state()).toEqual(held(true));
      await tx.setContext(founderA);
      await tx.rows('select office.set_customer_permissions($1, false, null)', [ids.customerA]);
      await tx.setContext(employeeA);
      expect(await state()).toEqual(held(false));
      // A request without a project is never held.
      expect(projectOf(await readRequest(tx.client, 'KOR-1', plain))).toMatchObject({
        agents_may_work: true,
      });
    });
  });

  // 8 October decision 17: the AI spending limit of the request's project.
  it("a request row says whether its project's limit is reached; false without a project", async () => {
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      const inProject = (agent: string): ContextInput => ({
        ...agentRun(ids.employeeA, agent),
        projectId: ids.projectA,
      });
      await tx.setContext(employeeA);
      const plain = await openRequest(tx);
      // A project request whose result waits for the approver, and one whose approved result
      // waits for its requester. The coordinator's run of each has cost 0.25.
      const walked = async (): Promise<{ task: string; approval: string }> => {
        await tx.setContext(employeeA);
        const task = await openRequest(tx, ids.projectA);
        await tx.setContext(inProject('KOR-1'));
        const kor = await openRun(tx, task, 'KOR-1');
        await tx.rows(ROUTE, [task, HAF_STEP, kor]);
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = now(), cost_usd = 0.25
           where id = $1`,
          [kor],
        );
        await tx.setContext(inProject('HAF-1'));
        const haf = await openRun(tx, task, 'HAF-1');
        return { task, approval: (await one<{ id: string }>(tx, SUBMIT, [task, haf, null])).id };
      };
      const waiting = await walked();
      const accepted = await walked();
      await tx.setContext(founderA);
      await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [
        accepted.approval,
      ]);

      const list = (projectId: string | null): Promise<RequestRow[]> =>
        listRequests(tx.client, { coordinator: 'KOR-1', mine: false, limit: 50, projectId });
      /** Every statement that carries the flag, as its own reader gets it. */
      const state = async (): Promise<unknown> => {
        const flags: Record<string, unknown> = {};
        for (const [name, reader] of [
          ['member', employeeA],
          ['founder', founderA],
        ] as const) {
          await tx.setContext(reader);
          const row = await readRequest(tx.client, 'KOR-1', waiting.task);
          flags[name] = {
            request: [row?.spending_limit_reached, row?.agents_may_work],
            listed: (await list(ids.projectA)).map((item) => item.spending_limit_reached),
            plain: (await readRequest(tx.client, 'KOR-1', plain))?.spending_limit_reached,
            plainListed: (await list(null)).find((item) => item.id === plain)
              ?.spending_limit_reached,
          };
        }
        await tx.setContext(founderA);
        flags.approvals = (await listPendingApprovals(tx.client))
          .filter((row) => row.task_id === waiting.task)
          .map((row) => [row.spending_limit_reached, row.agents_may_work]);
        await tx.setContext(employeeA);
        flags.acceptances = (await listPendingAcceptances(tx.client))
          .filter((row) => row.task_id === accepted.task)
          .map((row) => [row.spending_limit_reached, row.agents_may_work]);
        return flags;
      };
      // The permission is not touched by the limit: agents may work throughout.
      const expected = (reached: boolean) => {
        const reader = {
          request: [reached, true],
          listed: [reached, reached],
          plain: false,
          plainListed: false,
        };
        return {
          member: reader,
          founder: reader,
          approvals: [[reached, true]],
          acceptances: [[reached, true]],
        };
      };
      const setLimit = async (limit: string | null): Promise<void> => {
        await tx.setContext(founderA);
        await tx.rows('select office.set_project_ai_spending_limit($1, $2::numeric)', [
          ids.projectA,
          limit,
        ]);
      };

      // No limit; a limit above what was spent (0.50); at it; below it.
      expect(await state()).toEqual(expected(false));
      await setLimit('0.51');
      expect(await state()).toEqual(expected(false));
      await setLimit('0.50');
      expect(await state()).toEqual(expected(true));
      await setLimit('0.10');
      expect(await state()).toEqual(expected(true));
      // Raised (with the founder's passkey), and taken away: not reached any more.
      await stepUp(tx, founderA, 'project_ai_spending_limit', ids.projectA);
      await setLimit('5');
      expect(await state()).toEqual(expected(false));
      await stepUp(tx, founderA, 'project_ai_spending_limit', ids.projectA);
      await setLimit(null);
      expect(await state()).toEqual(expected(false));
    });
  });

  it('the lists of the Bugün screen hold a project request only for its readers', async () => {
    await inTransaction(async (tx) => {
      await enableHaf(tx);
      // The right holder is appointed for the unit, and is no member of the project.
      await tx.setContext(founderA);
      await tx.exec(
        `update office.approvers set user_id = $2 where company_id = $1 and unit_code = 'HAF'`,
        [ids.arma, ids.approverA],
      );
      const inProject = (agent: string): ContextInput => ({
        ...agentRun(ids.employeeA, agent),
        projectId: ids.projectA,
      });
      const submittedInProject = async (): Promise<string> => {
        await tx.setContext(employeeA);
        const task = await openRequest(tx, ids.projectA);
        await tx.setContext(inProject('KOR-1'));
        const kor = await openRun(tx, task, 'KOR-1');
        await tx.rows(ROUTE, [task, HAF_STEP, kor]);
        await tx.exec(
          `update office.runs set status = 'completed', finished_at = now() where id = $1`,
          [kor],
        );
        await tx.setContext(inProject('HAF-1'));
        await one(tx, SUBMIT, [task, await openRun(tx, task, 'HAF-1'), null]);
        return task;
      };
      const seen = async (reader: ContextInput, task: string): Promise<[boolean, number]> => {
        await tx.setContext(reader);
        const expected = await listExpectedRequests(tx.client, {
          coordinator: 'KOR-1',
          limit: 200,
        });
        return [
          expected.some((row) => row.id === task),
          (await countPendingDecisions(tx.client)).approvals,
        ];
      };
      const approverOf = async (task: string): Promise<unknown> => {
        await tx.setContext(founderA);
        return (
          await one(
            tx,
            `select approver_user_id from office.task_routings
             where task_id = $1 and status = 'active'`,
            [task],
          )
        ).approver_user_id;
      };
      const before = {
        founder: (await seen(founderA, ids.requestA))[1],
        approver: (await seen(approverA, ids.requestA))[1],
      };

      const first = await submittedInProject();
      // An appointed approver who is no member of the project is not appointed for it: the
      // founder decides, and only the founder's lists hold the request.
      expect(await approverOf(first)).toBeNull();
      expect(await seen(founderA, first)).toEqual([true, before.founder + 1]);
      expect(await seen(approverA, first)).toEqual([false, before.approver]);
      expect(await seen(colleagueA, first)).toEqual([false, 0]);
      // The requester's own list holds their request; nothing of it waits for their decision.
      expect(await seen(employeeA, first)).toEqual([true, 0]);

      // Made a member, the approver is appointed for the project's NEXT request.
      await tx.setContext(founderA);
      await tx.exec(
        'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)',
        [ids.arma, ids.projectA, ids.approverA],
      );
      const second = await submittedInProject();
      expect(await approverOf(second)).toBe(ids.approverA);
      expect(await seen(approverA, second)).toEqual([true, before.approver + 1]);
      expect(await seen(founderA, second)).toEqual([true, before.founder + 2]);
      // The step that was opened before keeps the founder as the one who decides.
      expect(await approverOf(first)).toBeNull();
    });
  });

  it('the statement that opens a request stores its project, and none when none is given', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const open = async (projectId?: string | null): Promise<string> => {
        const id = randomUUID();
        await insertRequest(tx.client, {
          id,
          title: 'A request',
          text: 'What is wanted',
          dueDate: null,
          ...(projectId === undefined ? {} : { projectId }),
        });
        return id;
      };
      const projectOf = async (task: string): Promise<unknown> =>
        (await one(tx, 'select project_id from office.tasks where id = $1', [task])).project_id;
      expect(await projectOf(await open(ids.projectA))).toBe(ids.projectA);
      expect(await projectOf(await open(null))).toBeNull();
      expect(await projectOf(await open())).toBeNull();
      // The database refuses a project that takes no request; the statement adds no rule.
      const refused = async (projectId: string): Promise<unknown> => {
        await tx.exec('savepoint refused');
        try {
          await open(projectId);
        } catch (error) {
          await tx.exec('rollback to savepoint refused');
          return (error as { code?: string }).code;
        }
        return 'opened';
      };
      expect(await refused(ids.projectANoAi)).toBe('23514');
      expect(await refused(ids.projectP)).toBe('23514');
      await tx.exec(`update office.projects set status = 'completed' where id = $1`, [
        ids.projectA,
      ]);
      expect(await refused(ids.projectA)).toBe('23514');
      await tx.setContext(colleagueA);
      expect(await refused(ids.projectA)).toBe('23514');
    });
  });

  it('the project of a request never changes', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const inside = await openRequest(tx, ids.projectA);
      const outside = await openRequest(tx);
      for (const person of [employeeA, founderA]) {
        await tx.setContext(person);
        for (const [task, project] of [
          [inside, null],
          [inside, ids.projectANoAi],
          [outside, ids.projectA],
        ] as const) {
          expect(
            (
              await tx.expectError('update office.tasks set project_id = $2 where id = $1', [
                task,
                project,
              ])
            ).code,
          ).toBe('42501');
        }
      }
      await tx.setContext(founderA);
      expect(
        await tx.rows('select id, project_id from office.tasks where id = any ($1::uuid[])', [
          [inside, outside],
        ]),
      ).toEqual(
        expect.arrayContaining([
          { id: inside, project_id: ids.projectA },
          { id: outside, project_id: null },
        ]),
      );
    });
    await inAdminTransaction(async (tx) => {
      // The privileged role without a context is refused too, and the flow's own role has no
      // privilege on the column: no function of the flow can move a request to another project.
      await tx.setContext({});
      expect(
        (
          await tx.expectError('update office.tasks set project_id = $2 where id = $1', [
            ids.requestA,
            ids.projectA,
          ])
        ).code,
      ).toBe('42501');
      expect(
        await one(
          tx,
          `select has_column_privilege('office_trigger', 'office.tasks', 'project_id', 'update')
             as flow`,
        ),
      ).toEqual({ flow: false });
    });
  });
});
