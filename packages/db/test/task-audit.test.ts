import { randomUUID } from 'node:crypto';
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

// Every change of a task and every new comment writes its own audit_log row in the same
// transaction (rule 5; KALAN-ISLER 0.4), with event names and ids only (2 October decision 13).
// The rows are read back as the founder, the only reader of the log.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const korA: ContextInput = { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' };

interface AuditRow {
  event: string;
  user_id: string | null;
  agent_code: string | null;
  record_type: string | null;
  record_id: string | null;
  project_id: string | null;
}

/** The newest audit id the founder of Arma DX can see; rows written later have a greater id. */
async function mark(tx: Tx): Promise<string> {
  await tx.setContext(founderA);
  const [row] = await tx.rows<{ id: string }>(
    'select coalesce(max(id), 0)::text as id from office.audit_log',
  );
  return row?.id ?? '0';
}

/** The rows written after the mark, in the order they were written, as the founder reads them. */
async function since(tx: Tx, from: string): Promise<AuditRow[]> {
  await tx.setContext(founderA);
  return tx.rows<AuditRow>(
    `select event, user_id, agent_code, record_type, record_id, project_id
     from office.audit_log where id > $1 order by id`,
    [from],
  );
}

function row(event: string, actor: Partial<AuditRow>, taskId: string, projectId: string | null) {
  return {
    event,
    user_id: null,
    agent_code: null,
    record_type: 'task',
    record_id: taskId,
    project_id: projectId,
    ...actor,
  };
}

describe.skipIf(noDatabase)('audit rows of tasks', () => {
  afterAll(closePools);

  it('opening a task writes task_created with the person and the project of the task', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(employeeA);
      const plain = randomUUID();
      const inProject = randomUUID();
      await tx.exec(
        `insert into office.tasks (id, company_id, project_id, title) values
           ($1, $3, null, 'Plain'), ($2, $3, $4, 'In the project')`,
        [plain, inProject, ids.arma, ids.projectA],
      );
      expect(await since(tx, from)).toEqual([
        row('task_created', { user_id: ids.employeeA }, plain, null),
        row('task_created', { user_id: ids.employeeA }, inProject, ids.projectA),
      ]);
    });
  });

  it('a task opened already assigned, past open or from outside content says so at creation', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      const toPerson = randomUUID();
      const toAgent = randomUUID();
      const started = randomUUID();
      const outside = randomUUID();
      await tx.setContext(employeeA);
      await tx.exec(
        `insert into office.tasks (id, company_id, title, assignee_user_id) values ($1, $2, 'p', $3)`,
        [toPerson, ids.arma, ids.approverA],
      );
      await tx.exec(
        `insert into office.tasks (id, company_id, title, assignee_agent_code)
         values ($1, $2, 'a', 'KOR-1')`,
        [toAgent, ids.arma],
      );
      await tx.exec(
        `insert into office.tasks (id, company_id, title, status) values ($1, $2, 's', 'done')`,
        [started, ids.arma],
      );
      await tx.exec(
        `insert into office.tasks (id, company_id, title, source_kind)
         values ($1, $2, 'o', 'external')`,
        [outside, ids.arma],
      );
      const actor = { user_id: ids.employeeA };
      expect(await since(tx, from)).toEqual([
        row('task_created', actor, toPerson, null),
        row('task_assigned_user', actor, toPerson, null),
        row('task_created', actor, toAgent, null),
        row('task_assigned_agent', actor, toAgent, null),
        row('task_created', actor, started, null),
        row('task_status_done', actor, started, null),
        row('task_created', actor, outside, null),
        row('task_source_external', actor, outside, null),
      ]);
    });
  });

  it('a person giving an outside-sourced task to an agent leaves the trace of both', async () => {
    await inTransaction(async (tx) => {
      const taskId = randomUUID();
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.tasks (id, company_id, title, source_kind)
         values ($1, $2, 'From an email', 'external')`,
        [taskId, ids.arma],
      );
      const from = await mark(tx);
      // 2 October decision 8: the task counts as internal from here on, and the log says who did it.
      await tx.exec(`update office.tasks set assignee_agent_code = 'KOR-1' where id = $1`, [
        taskId,
      ]);
      await tx.exec(`update office.tasks set assignee_agent_code = null where id = $1`, [taskId]);
      const actor = { user_id: ids.founder };
      expect(await since(tx, from)).toEqual([
        row('task_assigned_agent', actor, taskId, null),
        row('task_source_internal', actor, taskId, null),
        row('task_unassigned', actor, taskId, null),
      ]);
    });
  });

  it('names a change of the requester, the parent, the work type and the routing fields', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(employeeA);
      const [workType] = await tx.rows<{ id: string }>(
        'select id from office.work_types where company_id = $1 order by code limit 1',
        [ids.arma],
      );
      expect(workType).toBeDefined();
      const update = async (set: string, values: unknown[] = []) => {
        expect(
          await tx.exec(`update office.tasks set ${set} where id = $1`, [ids.taskA, ...values]),
        ).toBe(1);
      };
      await update('requester_user_id = $2', [ids.approverA]);
      await update('parent_task_id = $2', [ids.taskAShared]);
      await update('work_type_id = $2', [workType?.id]);
      // The two routing fields are one fact (KOR-1's first unit and whether it was corrected).
      await update(`initial_unit_code = 'KOR', routing_corrected = true`);
      expect((await since(tx, from)).map((r) => r.event)).toEqual([
        'task_requester_changed',
        'task_parent_changed',
        'task_work_type_changed',
        'task_routing_changed',
      ]);
    });
  });

  it('a change in a column without an event of its own is still logged', async () => {
    await inTransaction(async (tx) => {
      // No column of today's table is without a name, except the id itself; a column a later
      // migration adds takes the same path.
      const first = randomUUID();
      const second = randomUUID();
      await tx.setContext(employeeA);
      await tx.exec(`insert into office.tasks (id, company_id, title) values ($1, $2, 'x')`, [
        first,
        ids.arma,
      ]);
      const from = await mark(tx);
      await tx.setContext(employeeA);
      expect(await tx.exec(`update office.tasks set id = $2 where id = $1`, [first, second])).toBe(
        1,
      );
      expect(await since(tx, from)).toEqual([
        row('task_changed', { user_id: ids.employeeA }, second, null),
      ]);
    });
  });

  it('one row for each kind of change in an update, and none for a change that changes nothing', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(employeeA);
      const actor = { user_id: ids.employeeA };
      const events = async () => (await since(tx, from)).map((r) => r.event);
      const update = async (set: string, values: unknown[] = []) => {
        await tx.setContext(employeeA);
        expect(
          await tx.exec(`update office.tasks set ${set} where id = $1`, [ids.taskA, ...values]),
        ).toBe(1);
      };

      // Several fields at once: one row each, all for the same task.
      await update(
        `status = 'in_progress', assignee_user_id = $2, title = 'New title', priority = 1`,
        [ids.approverA],
      );
      expect(await since(tx, from)).toEqual([
        row('task_status_in_progress', actor, ids.taskA, null),
        row('task_assigned_user', actor, ids.taskA, null),
        row('task_title_changed', actor, ids.taskA, null),
        row('task_priority_changed', actor, ids.taskA, null),
      ]);

      // The same values again: the row is written, nothing changed, nothing is logged.
      await update(
        `status = 'in_progress', assignee_user_id = $2, title = 'New title', priority = 1`,
        [ids.approverA],
      );
      expect(await events()).toHaveLength(4);

      await update(`assignee_user_id = null, assignee_agent_code = 'KOR-1'`);
      await update(`assignee_agent_code = null`);
      await update(`description = 'More detail'`);
      await update(`due_at = now() + interval '3 days'`);
      await update(`unit_code = 'HAF'`);
      await update(`unit_code = null`);
      await update(`status = 'done'`);
      await update(`status = 'open'`);
      await update(`status = 'cancelled'`);
      expect((await events()).slice(4)).toEqual([
        'task_assigned_agent',
        'task_unassigned',
        'task_description_changed',
        'task_due_changed',
        'task_unit_changed',
        'task_unit_changed',
        'task_status_done',
        'task_status_open',
        'task_status_cancelled',
      ]);
      // Names and ids only: every event is a fixed code, every row names the task.
      for (const written of await since(tx, from)) {
        expect(written.event).toMatch(/^task_[a-z_]+$/);
        expect(written).toMatchObject({ record_type: 'task', record_id: ids.taskA });
      }
    });
  });

  it('a comment writes task_comment_added for its task, whoever writes it', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(employeeA);
      await tx.exec(
        `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'a')`,
        [ids.arma, ids.taskAProject],
      );
      // An external person comments on the task that is open to them.
      await tx.setContext(externalA);
      await tx.exec(
        `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'b')`,
        [ids.arma, ids.taskAShared],
      );
      expect(await since(tx, from)).toEqual([
        row('task_comment_added', { user_id: ids.employeeA }, ids.taskAProject, ids.projectA),
        row('task_comment_added', { user_id: ids.externalA }, ids.taskAShared, null),
      ]);
      // A comment the database refuses (a task the person cannot see) leaves no row.
      await tx.setContext(approverA);
      expect(
        (
          await tx.expectError(
            `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'c')`,
            [ids.arma, ids.taskAProject],
          )
        ).code,
      ).toBe('23503');
      expect(await since(tx, from)).toHaveLength(2);
    });
  });

  it("an agent run's changes are logged with the agent, not as the person's", async () => {
    const taskId = randomUUID();
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(korA);
      await tx.exec(
        `insert into office.tasks (id, company_id, title) values ($1, $2, 'By the agent')`,
        [taskId, ids.arma],
      );
      await tx.exec(`update office.tasks set status = 'in_progress' where id = $1`, [taskId]);
      await tx.exec(
        `insert into office.task_comments (company_id, task_id, body) values ($1, $2, 'n')`,
        [ids.arma, taskId],
      );
      // An agent run does not read the log (the founder does, on a request of their own).
      expect(await tx.count('audit_log')).toBe(0);
      // The worker cannot be the founder's request, so the rows are read by the same connection
      // after the agent code is taken out of the context.
      await tx.setContext(founderA);
      expect(
        await tx.rows(
          `select event, user_id, agent_code from office.audit_log
           where record_id = $1 order by id`,
          [taskId],
        ),
      ).toEqual([
        { event: 'task_created', user_id: ids.founder, agent_code: 'KOR-1' },
        { event: 'task_status_in_progress', user_id: ids.founder, agent_code: 'KOR-1' },
        { event: 'task_comment_added', user_id: ids.founder, agent_code: 'KOR-1' },
      ]);
    });
  });

  it('only the founder reads the rows; the person who made the change does not', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      await tx.exec(`update office.tasks set priority = 2 where id = $1`, [ids.taskA]);
      expect(await tx.count('audit_log')).toBe(0);
      await tx.setContext(externalA);
      expect(await tx.count('audit_log')).toBe(0);
      // Pillika's founder context reads nothing of Arma DX.
      await tx.setContext({ companyId: ids.pillika, userId: ids.founder });
      expect(await tx.count('audit_log', `record_id = $1`, [ids.taskA])).toBe(0);
      await tx.setContext(founderA);
      expect(
        await tx.count('audit_log', `record_id = $1 and event = 'task_priority_changed'`, [
          ids.taskA,
        ]),
      ).toBe(1);
    });
  });

  it('removing a member clears their assignments and logs each as unassigned by the founder', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(`update office.tasks set assignee_user_id = $2 where id = any ($1)`, [
        [ids.taskA, ids.taskAProject],
        ids.employeeA,
      ]);
      const from = await mark(tx);
      // The assignment is cleared by the foreign key of tasks, inside the founder's request.
      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      expect(
        await tx.exec('delete from office.memberships where company_id = $1 and user_id = $2', [
          ids.arma,
          ids.employeeA,
        ]),
      ).toBe(1);
      expect(
        await tx.rows(`select assignee_user_id from office.tasks where id = any ($1)`, [
          [ids.taskA, ids.taskAProject],
        ]),
      ).toEqual([{ assignee_user_id: null }, { assignee_user_id: null }]);
      const written = (await since(tx, from)).filter((r) => r.event === 'task_unassigned');
      expect(written).toHaveLength(2);
      expect(written.map((r) => r.record_id).sort()).toEqual([ids.taskA, ids.taskAProject].sort());
      for (const r of written) expect(r.user_id).toBe(ids.founder);
      expect(written.find((r) => r.record_id === ids.taskAProject)?.project_id).toBe(ids.projectA);
    });
  });

  it('a write without a person in the context is logged without an actor', async () => {
    await inAdminTransaction(async (tx) => {
      await tx.setContext({});
      const taskId = randomUUID();
      await tx.exec(`insert into office.tasks (id, company_id, title) values ($1, $2, 'Seeded')`, [
        taskId,
        ids.arma,
      ]);
      expect(
        await tx.rows(
          'select event, user_id, agent_code from office.audit_log where record_id = $1',
          [taskId],
        ),
      ).toEqual([{ event: 'task_created', user_id: null, agent_code: null }]);
    });
  });
});
