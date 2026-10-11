import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
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

// In whose name a run on a request goes (8 October decision 45). The database resolves it: the
// requester while they may read the request, otherwise the founder of the company; the insert of
// a run refuses every other name, and the founder gives the requester's approval in their place.
//
// A request is opened by a person through the API's role and a run by the worker's role, and a row
// one role did not commit is not there for the other: each case runs in one privileged
// transaction that goes on as the role whose act it is (asRole) and is rolled back at the end.
// People lose a request the way they do in the panel: the founder takes them out of the project,
// makes them an external person, removes them from the company or deactivates their account.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const colleagueA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };

/** The context of an agent run; without a person it is what the runner asks the gate with. */
function agentRun(
  agentCode: string,
  userId: string | null = null,
  projectId: string | null = null,
  companyId: string = ids.arma,
): ContextInput {
  return { companyId, agentCode, userId, projectId };
}

const WHO = 'select office.request_run_identity($1) as who';
// The runner's question at the start of every run; its first column is the same answer.
const GATE = 'select run_as, project_id, ai_allowed from office.request_run_gate($1)';
const RUN = `insert into office.runs
    (company_id, task_id, agent_code, card_version_id, trigger_type, model)
  values (office.ctx_company_id(), $1, $2, $3, 'request', 'test-model')
  returning id, user_id, project_id`;
const NOT_RESOLVED = {
  code: '42501',
  message: 'A run on a request goes in the name the database resolves for it',
};
const HAF_STEP = JSON.stringify([{ unit: 'HAF', agent: 'HAF-1', reason: 'Belongs to memory' }]);
const SUBMIT = `insert into office.approvals (company_id, task_id, run_id, agent_code, title,
    payload, basis_type, basis_id, basis_version, involves_money, goes_external)
  values (office.ctx_company_id(), $1, $2, 'HAF-1', 'Result', '{"text": "Output"}', 'task', $1,
    (select version from office.tasks where id = $1), false, false) returning id`;
const ACCEPT = `update office.requester_approvals set status = 'approved'
  where task_id = $1 and status = 'pending' and invalidated_at is null`;

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

/** A person opens a request, through the API's role. */
async function requestOf(
  tx: Tx,
  person: ContextInput,
  project: string | null = null,
): Promise<string> {
  await asRole(tx, 'app');
  await tx.setContext(person);
  const row = await one<{ id: string }>(
    tx,
    `insert into office.tasks (company_id, project_id, kind, title, description)
     values (office.ctx_company_id(), $1, 'request', 'A request', 'What is wanted') returning id`,
    [project],
  );
  return row.id;
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

async function openRun(tx: Tx, task: string, agent: 'KOR-1' | 'HAF-1') {
  return one<{ id: string; user_id: string; project_id: string | null }>(tx, RUN, [
    task,
    agent,
    agent === 'KOR-1' ? ids.cardKor : ids.cardHaf,
  ]);
}

type Loss = 'left_project' | 'external' | 'left_company' | 'deactivated';
const LOSSES: readonly Loss[] = ['left_project', 'external', 'left_company', 'deactivated'];

/** The founder takes the request away from a person, as the panel's four acts do. */
async function lose(tx: Tx, way: Loss, userId: string = ids.employeeA): Promise<void> {
  await asRole(tx, 'app');
  if (way === 'left_project') {
    await tx.setContext(founderA);
    expect(
      await tx.exec('delete from office.project_members where project_id = $1 and user_id = $2', [
        ids.projectA,
        userId,
      ]),
    ).toBe(1);
    return;
  }
  // A change of a membership or of an account asks for the founder's passkey.
  await stepUp(tx, founderA, 'membership_change', userId);
  const changed =
    way === 'external'
      ? await tx.exec(
          `update office.memberships set role = 'external'
           where company_id = $1 and user_id = $2`,
          [ids.arma, userId],
        )
      : way === 'left_company'
        ? await tx.exec('delete from office.memberships where company_id = $1 and user_id = $2', [
            ids.arma,
            userId,
          ])
        : await tx.exec('update office.users set active = false where id = $1', [userId]);
  expect(changed, way).toBe(1);
}

/** The founder makes the employee a member of the project again. */
async function addBack(tx: Tx): Promise<void> {
  await asPerson(tx, founderA);
  await tx.exec(
    `insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)`,
    [ids.arma, ids.projectA, ids.employeeA],
  );
}

async function enableHaf(tx: Tx): Promise<void> {
  await asPerson(tx, founderA);
  await tx.exec(
    `update office.company_agents set status = 'enabled'
     where company_id = $1 and agent_code = 'HAF-1'`,
    [ids.arma],
  );
}

/**
 * Walks a project request of the employee to an approved result that waits for the requester's
 * approval: routed by KOR-1, worked on by HAF-1, approved by the founder.
 */
async function approvedResult(tx: Tx, project: string | null = ids.projectA): Promise<string> {
  await enableHaf(tx);
  const task = await requestOf(tx, employeeA, project);
  await asWorker(tx, agentRun('KOR-1', ids.employeeA, project));
  const kor = await openRun(tx, task, 'KOR-1');
  await tx.rows('select office.route_request($1, $2::jsonb, $3)', [task, HAF_STEP, kor.id]);
  await tx.exec(`update office.runs set status = 'completed', finished_at = now() where id = $1`, [
    kor.id,
  ]);
  await tx.setContext(agentRun('HAF-1', ids.employeeA, project));
  const haf = await openRun(tx, task, 'HAF-1');
  const approval = await one<{ id: string }>(tx, SUBMIT, [task, haf.id]);
  await tx.exec(`update office.runs set status = 'completed', finished_at = now() where id = $1`, [
    haf.id,
  ]);
  await asPerson(tx, founderA);
  expect(
    await tx.exec(`update office.approvals set status = 'approved' where id = $1`, [approval.id]),
  ).toBe(1);
  return task;
}

describe.skipIf(noDatabase)('in whose name a run on a request goes', () => {
  afterAll(closePools);

  it('the gate names the requester while they read the request and the founder afterwards, for every way of losing it', async () => {
    for (const way of LOSSES) {
      await inAdminTransaction(async (tx) => {
        const inside = await requestOf(tx, employeeA, ids.projectA);
        const outside = await requestOf(tx, employeeA);
        const named = async (task: string, project: string | null, who: string): Promise<void> => {
          // The runner asks with the company and the agent and no person.
          await asWorker(tx, agentRun('KOR-1'));
          expect(await tx.rows(GATE, [task]), way).toEqual([
            { run_as: who, project_id: project, ai_allowed: true },
          ]);
          expect(await tx.rows(WHO, [task]), way).toEqual([{ who }]);
        };
        await named(inside, ids.projectA, ids.employeeA);
        await named(outside, null, ids.employeeA);
        await lose(tx, way);
        await named(inside, ids.projectA, ids.founder);
        // A person who only left the project still reads their request outside it.
        await named(outside, null, way === 'left_project' ? ids.employeeA : ids.founder);
      });
    }
  });

  it('the worker role cannot open a run as a person the database did not resolve', async () => {
    await inAdminTransaction(async (tx) => {
      const inside = await requestOf(tx, employeeA, ids.projectA);
      const outside = await requestOf(tx, employeeA);
      for (const [task, project] of [
        [inside, ids.projectA],
        [outside, null],
      ] as const) {
        // The founder may read every request; the run still does not go in the founder's name.
        await asWorker(tx, agentRun('KOR-1', ids.founder, project));
        expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
        await tx.setContext(agentRun('KOR-1', ids.sharedEmployee, project));
        expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
        await tx.setContext(agentRun('KOR-1', ids.externalA, project));
        expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
        await tx.setContext(agentRun('KOR-1', ids.employeeA, project));
        expect(await openRun(tx, task, 'KOR-1')).toMatchObject({
          user_id: ids.employeeA,
          project_id: project,
        });
        // That run is closed again: the next one below is the request's only open run.
        await tx.exec(
          `update office.runs set status = 'failed', finished_at = now() where task_id = $1`,
          [task],
        );
      }
      // After the requester left the project the names change places.
      await lose(tx, 'left_project');
      await asWorker(tx, agentRun('KOR-1', ids.employeeA, ids.projectA));
      expect(await tx.expectError(RUN, [inside, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
      await tx.setContext(agentRun('KOR-1', ids.founder, ids.projectA));
      expect(await openRun(tx, inside, 'KOR-1')).toMatchObject({
        user_id: ids.founder,
        project_id: ids.projectA,
      });
      // Outside the project nothing changed for them.
      await tx.setContext(agentRun('KOR-1', ids.founder));
      expect(await tx.expectError(RUN, [outside, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
    });
  });

  it('a run on a request is refused when the database resolves no name', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx, employeeA);
      // No person in the context: null is not "the same name".
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
      // A context of the other company resolves nothing for this request, with or without a
      // person in it.
      await tx.setContext(agentRun('KOR-1', null, null, ids.pillika));
      expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
      await tx.setContext(agentRun('KOR-1', ids.founder, null, ids.pillika));
      expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
      await asRole(tx, null);
      expect(await tx.count('runs', 'task_id = $1', [task])).toBe(0);
    });
  });

  it('a request of a removed requester runs in the founder name and still reads as the requester request', async () => {
    await inAdminTransaction(async (tx) => {
      await enableHaf(tx);
      const task = await requestOf(tx, employeeA, ids.projectA);
      await lose(tx, 'left_project');

      await asWorker(tx, agentRun('KOR-1'));
      const { who } = await one<{ who: string }>(tx, WHO, [task]);
      expect(who).toBe(ids.founder);
      await tx.setContext(agentRun('KOR-1', who, ids.projectA));
      const kor = await openRun(tx, task, 'KOR-1');
      expect(kor).toMatchObject({ user_id: ids.founder, project_id: ids.projectA });
      // The founder's run reads the request and its project, and routes it.
      expect(await tx.count('tasks', 'id = $1', [task])).toBe(1);
      expect(await tx.count('projects', 'id = $1', [ids.projectA])).toBe(1);
      await tx.rows('select office.route_request($1, $2::jsonb, $3)', [task, HAF_STEP, kor.id]);
      await tx.exec(
        `update office.runs set status = 'completed', finished_at = now() where id = $1`,
        [kor.id],
      );
      await tx.setContext(agentRun('HAF-1', ids.founder, ids.projectA));
      const haf = await openRun(tx, task, 'HAF-1');
      expect(haf).toMatchObject({ user_id: ids.founder, project_id: ids.projectA });
      const approval = await one<{ id: string }>(tx, SUBMIT, [task, haf.id]);

      // Who asked never changes, and every record of the flow carries the project.
      await asPerson(tx, founderA);
      expect(
        await one(tx, 'select requester_user_id, project_id from office.tasks where id = $1', [
          task,
        ]),
      ).toEqual({ requester_user_id: ids.employeeA, project_id: ids.projectA });
      expect(
        await tx.rows('select project_id from office.task_routings where task_id = $1', [task]),
      ).toEqual([{ project_id: ids.projectA }]);
      expect(
        await tx.rows('select project_id from office.approvals where id = $1', [approval.id]),
      ).toEqual([{ project_id: ids.projectA }]);
      expect(await tx.rows(WHO, [task])).toEqual([{ who: ids.founder }]);
      // The employee reads none of it any more.
      await tx.setContext(employeeA);
      expect(await tx.count('tasks', 'id = $1', [task])).toBe(0);
      expect(await tx.count('runs', 'task_id = $1', [task])).toBe(0);
      expect(await tx.count('task_routings', 'task_id = $1', [task])).toBe(0);
      expect(await tx.count('approvals', 'task_id = $1', [task])).toBe(0);
      expect(await tx.rows(WHO, [task])).toEqual([{ who: null }]);

      // Added back, the employee is the person of the next run again.
      await addBack(tx);
      expect(await tx.rows(WHO, [task])).toEqual([{ who: ids.employeeA }]);
      await asWorker(tx, agentRun('HAF-1'));
      expect(await tx.rows(WHO, [task])).toEqual([{ who: ids.employeeA }]);
      await tx.exec(`update office.runs set status = 'failed', finished_at = now() where id = $1`, [
        haf.id,
      ]);
      await tx.setContext(agentRun('HAF-1', ids.founder, ids.projectA));
      expect(await tx.expectError(RUN, [task, 'HAF-1', ids.cardHaf])).toEqual(NOT_RESOLVED);
    });
  });

  it('the identity is told to an agent run and to a reader of the request, and to nobody else', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx, employeeA, ids.projectA);
      const who = async (): Promise<string | null> =>
        (await one<{ who: string | null }>(tx, WHO, [task])).who;
      for (const reader of [employeeA, founderA]) {
        await asPerson(tx, reader);
        expect(await who()).toBe(ids.employeeA);
      }
      // An employee who is no member of the project, one with the approval right who is none, an
      // external person, the same person in the other company and nobody at all.
      for (const stranger of [colleagueA, approverA, externalA, founderP, {}]) {
        await asPerson(tx, stranger);
        expect(await who(), JSON.stringify(stranger)).toBeNull();
      }
      await asWorker(tx, agentRun('KOR-1'));
      expect(await who()).toBe(ids.employeeA);
      await tx.setContext(agentRun('KOR-1', null, null, ids.pillika));
      expect(await who()).toBeNull();
      // The worker's role with a person alone is that person, as everywhere (rule 9).
      await tx.setContext(colleagueA);
      expect(await who()).toBeNull();
      // The two functions that read memberships are nobody's to call.
      for (const role of ['app', 'worker'] as const) {
        await asRole(tx, role);
        await tx.setContext(founderA);
        for (const sql of [
          `select office.person_reads_request('${ids.arma}', null, '${ids.founder}')`,
          `select office.acting_founder('${ids.arma}')`,
        ]) {
          expect((await tx.expectError(sql)).code, `${role}: ${sql}`).toBe('42501');
        }
      }
    });
  });

  it('with several founders the run goes in the name of the one whose membership is the oldest, and never of a deactivated one', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await requestOf(tx, employeeA);
      // A second founder whose membership is older than that of the fixtures' founder.
      await asRole(tx, null);
      await tx.setContext({});
      await tx.exec(
        `insert into office.memberships (company_id, user_id, role, can_approve, created_at)
         values ($1, $2, 'founder', true, now() - interval '1 year')`,
        [ids.arma, ids.formerEmployee],
      );
      await lose(tx, 'external');
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.rows(WHO, [task])).toEqual([{ who: ids.formerEmployee }]);
      await tx.setContext(agentRun('KOR-1', ids.founder));
      expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
      // The older founder is deactivated: the other one stands in.
      await lose(tx, 'deactivated', ids.formerEmployee);
      await asWorker(tx, agentRun('KOR-1'));
      expect(await tx.rows(WHO, [task])).toEqual([{ who: ids.founder }]);
      await tx.setContext(agentRun('KOR-1', ids.formerEmployee));
      expect(await tx.expectError(RUN, [task, 'KOR-1', ids.cardKor])).toEqual(NOT_RESOLVED);
      await tx.setContext(agentRun('KOR-1', ids.founder));
      expect(await openRun(tx, task, 'KOR-1')).toMatchObject({ user_id: ids.founder });
    });
  });

  it('the founder gives the requester’s approval only while the requester cannot read the request, and the record says who decided', async () => {
    const record = (tx: Tx, task: string) =>
      one(
        tx,
        `select q.status, q.requester_user_id, q.decided_by_user_id, t.status as request,
                t.requester_user_id as asked_by
         from office.requester_approvals q join office.tasks t on t.id = q.task_id
         where q.task_id = $1`,
        [task],
      );
    await inAdminTransaction(async (tx) => {
      const task = await approvedResult(tx);
      // While the requester reads the request the founder's answer changes nothing.
      await asPerson(tx, founderA);
      expect(await tx.exec(ACCEPT, [task])).toBe(0);
      await lose(tx, 'left_project');
      // The requester who lost the request, an employee with the approval right, the founder in
      // an agent run and the founder in the other company: none of them answers.
      for (const other of [
        employeeA,
        approverA,
        colleagueA,
        agentRun('KOR-1', ids.founder, ids.projectA),
        founderP,
      ]) {
        await asPerson(tx, other);
        expect(await tx.exec(ACCEPT, [task]), JSON.stringify(other)).toBe(0);
      }
      // The worker's role carries no person's session: in the founder's name it has no privilege.
      await asWorker(tx, founderA);
      expect((await tx.expectError(ACCEPT, [task])).code).toBe('42501');
      // Who decided is the database's to write.
      await asPerson(tx, founderA);
      expect(
        (
          await tx.expectError(
            'update office.requester_approvals set decided_by_user_id = $2 where task_id = $1',
            [task, ids.employeeA],
          )
        ).code,
      ).toBe('42501');
      expect(await record(tx, task)).toMatchObject({ status: 'pending', decided_by_user_id: null });
      expect(await tx.exec(ACCEPT, [task])).toBe(1);
      expect(await record(tx, task)).toEqual({
        status: 'approved',
        requester_user_id: ids.employeeA,
        decided_by_user_id: ids.founder,
        request: 'done',
        asked_by: ids.employeeA,
      });
    });
  });

  it('the founder asks for changes in the requester’s place, and a requester who answers themselves is written as the one who decided', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await approvedResult(tx);
      await lose(tx, 'left_project');
      await asPerson(tx, founderA);
      expect(
        await tx.exec(
          `update office.requester_approvals
           set status = 'changes_requested', decision_reason = 'Shorter, please'
           where task_id = $1 and status = 'pending' and invalidated_at is null`,
          [task],
        ),
      ).toBe(1);
      expect(
        await one(
          tx,
          `select q.status, q.decided_by_user_id, q.decision_reason, t.status as request,
                  (select s.status from office.task_routings s where s.task_id = t.id) as step
           from office.requester_approvals q join office.tasks t on t.id = q.task_id
           where q.task_id = $1`,
          [task],
        ),
      ).toEqual({
        status: 'changes_requested',
        decided_by_user_id: ids.founder,
        decision_reason: 'Shorter, please',
        request: 'in_progress',
        step: 'active',
      });
    });
    await inAdminTransaction(async (tx) => {
      const task = await approvedResult(tx);
      await asPerson(tx, employeeA);
      expect(await tx.exec(ACCEPT, [task])).toBe(1);
      expect(
        await tx.rows(
          'select requester_user_id, decided_by_user_id from office.requester_approvals where task_id = $1',
          [task],
        ),
      ).toEqual([{ requester_user_id: ids.employeeA, decided_by_user_id: ids.employeeA }]);
    });
  });

  it('when the requester reads the request again the founder no longer answers for them', async () => {
    await inAdminTransaction(async (tx) => {
      const task = await approvedResult(tx);
      await lose(tx, 'left_project');
      await addBack(tx);
      await asPerson(tx, founderA);
      expect(await tx.exec(ACCEPT, [task])).toBe(0);
      await tx.setContext(employeeA);
      expect(await tx.exec(ACCEPT, [task])).toBe(1);
    });
  });

  it('a requester who is made an external person, leaves the company or is deactivated is stood in for by the founder too', async () => {
    for (const way of ['external', 'left_company', 'deactivated'] as const) {
      await inAdminTransaction(async (tx) => {
        const task = await approvedResult(tx, null);
        await asPerson(tx, founderA);
        expect(await tx.exec(ACCEPT, [task]), way).toBe(0);
        await lose(tx, way);
        await asPerson(tx, employeeA);
        expect(await tx.exec(ACCEPT, [task]), way).toBe(0);
        await tx.setContext(founderA);
        expect(await tx.exec(ACCEPT, [task]), way).toBe(1);
        expect(
          await tx.rows(
            `select q.decided_by_user_id, t.status from office.requester_approvals q
             join office.tasks t on t.id = q.task_id where q.task_id = $1`,
            [task],
          ),
          way,
        ).toEqual([{ decided_by_user_id: ids.founder, status: 'done' }]);
      });
    }
  });

  it('company separation: with a Pillika context nothing of an Arma DX request is resolved or answered', async () => {
    // The fixture request of Arma DX waits for its requester's approval.
    await inWorkerTransaction(async (tx) => {
      for (const context of [
        agentRun('KOR-1', null, null, ids.pillika),
        agentRun('KOR-1', ids.founder, null, ids.pillika),
        agentRun('KOR-1', ids.employeeP, null, ids.pillika),
        {},
      ]) {
        await tx.setContext(context);
        expect(await tx.rows(WHO, [ids.requestA])).toEqual([{ who: null }]);
        expect(await tx.rows(GATE, [ids.requestA])).toEqual([]);
      }
      // A task between people is no request.
      await tx.setContext(agentRun('KOR-1'));
      expect(await tx.rows(WHO, [ids.requestA])).toEqual([{ who: ids.employeeA }]);
      expect(await tx.rows(WHO, [ids.taskA])).toEqual([{ who: null }]);
    });
    await inTransaction(async (tx) => {
      await tx.setContext(founderP);
      expect(await tx.rows(WHO, [ids.requestA])).toEqual([{ who: null }]);
      expect(await tx.exec(ACCEPT, [ids.requestA])).toBe(0);
      await tx.setContext({ companyId: ids.pillika, userId: ids.employeeP });
      expect(await tx.exec(ACCEPT, [ids.requestA])).toBe(0);
    });
  });
});
