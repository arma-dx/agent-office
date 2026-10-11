import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// Every change of a project, of its members and of a customer writes its own audit_log row in the
// same transaction (rule 5; docs/SONRA.md P-l), with an event name and ids only (2 October
// decision 13). The rows are read back as the founder, the only reader of the log.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
// A plain member of projectA and of projectANoAi (neither has an owner in the fixtures).
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
// An employee of Arma DX who is a member of no project.
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const sharedA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };

// The event names of the Projects section (migrations 20261008101900_project_audit,
// 20261008102100_project_owner_and_managers, 20261008102700_project_budget_and_milestones and
// 20261008102900_project_ai_spending_limit).
const EVENTS = [
  'project_created',
  'project_name_changed',
  'project_description_changed',
  'project_customer_changed',
  'project_status_backlog',
  'project_status_planned',
  'project_status_in_progress',
  'project_status_completed',
  'project_status_cancelled',
  'project_color_changed',
  'project_icon_changed',
  'project_target_date_changed',
  'project_changed',
  'project_budget_changed',
  'project_milestones_changed',
  'project_ai_spending_limit_set',
  'project_ai_spending_limit_raised',
  'project_ai_spending_limit_lowered',
  'project_ai_spending_limit_removed',
  'project_ai_permission_opened',
  'project_ai_permission_closed',
  'project_member_added',
  'project_member_removed',
  'project_member_role_owner',
  'project_member_role_manager',
  'project_member_role_member',
  'customer_created',
  'customer_name_changed',
  'customer_changed',
  'customer_ai_permission_opened',
  'customer_ai_permission_closed',
  'customer_automated_processing_opened',
  'customer_automated_processing_closed',
];

const ADD_MEMBER =
  'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)';
const REMOVE_MEMBER = 'delete from office.project_members where project_id = $1 and user_id = $2';
const SET_ROLE = 'select office.set_project_member_role($1, $2, $3)';
const SET_AI = 'select office.set_project_ai_permission($1, $2, $3)';
const SET_CUSTOMER = 'select office.set_customer_permissions($1, $2, $3)';

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

/**
 * The rows of this section written after the mark, in the order they were written, as the founder
 * reads them. A membership change writes rows of its own, which are not this file's.
 */
async function since(tx: Tx, from: string): Promise<AuditRow[]> {
  await tx.setContext(founderA);
  return tx.rows<AuditRow>(
    `select event, user_id, agent_code, record_type, record_id, project_id
     from office.audit_log
     where id > $1 and event ~ '^(project|customer)_'
     order by id`,
    [from],
  );
}

function projectRow(event: string, userId: string | null, projectId: string): AuditRow {
  return {
    event,
    user_id: userId,
    agent_code: null,
    record_type: 'project',
    record_id: projectId,
    project_id: projectId,
  };
}

function memberRow(
  event: string,
  userId: string | null,
  projectId: string,
  memberId: string,
): AuditRow {
  return {
    event,
    user_id: userId,
    agent_code: null,
    record_type: 'user',
    record_id: memberId,
    project_id: projectId,
  };
}

function customerRow(event: string, userId: string | null, customerId: string): AuditRow {
  return {
    event,
    user_id: userId,
    agent_code: null,
    record_type: 'customer',
    record_id: customerId,
    project_id: null,
  };
}

describe.skipIf(noDatabase)('audit rows of projects and customers', () => {
  afterAll(closePools);

  it('audit: opening a project writes project_created, project_member_added and project_member_role_owner, with the opener as actor', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(approverA);
      const planned = randomUUID();
      const parked = randomUUID();
      await tx.exec(`insert into office.projects (id, company_id, name) values ($1, $2, 'Plain')`, [
        planned,
        ids.arma,
      ]);
      await tx.exec(
        `insert into office.projects (id, company_id, name, status)
         values ($1, $2, 'Parked', 'backlog')`,
        [parked, ids.arma],
      );
      expect(await since(tx, from)).toEqual([
        projectRow('project_created', ids.approverA, planned),
        memberRow('project_member_added', ids.approverA, planned, ids.approverA),
        // The opener is the owner (8 October decision 44).
        memberRow('project_member_role_owner', ids.approverA, planned, ids.approverA),
        projectRow('project_created', ids.approverA, parked),
        // A project opened in another status than the first says so.
        projectRow('project_status_backlog', ids.approverA, parked),
        memberRow('project_member_added', ids.approverA, parked, ids.approverA),
        memberRow('project_member_role_owner', ids.approverA, parked, ids.approverA),
      ]);
    });
  });

  it('audit: every changed field of a project has its own event; an update that changes nothing writes none', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(employeeA);
      const id = ids.projectANoAi;
      const changes: [string, unknown, string][] = [
        ['name', 'A new name', 'project_name_changed'],
        ['description', 'What it is for', 'project_description_changed'],
        ['customer_id', ids.customerA, 'project_customer_changed'],
        ['status', 'backlog', 'project_status_backlog'],
        ['status', 'in_progress', 'project_status_in_progress'],
        ['status', 'completed', 'project_status_completed'],
        ['status', 'cancelled', 'project_status_cancelled'],
        ['status', 'planned', 'project_status_planned'],
        ['color', 'blue', 'project_color_changed'],
        ['icon', 'globe', 'project_icon_changed'],
        ['target_date', '2026-12-31', 'project_target_date_changed'],
      ];
      for (const [column, value] of changes) {
        expect(
          await tx.exec(`update office.projects set ${column} = $2 where id = $1`, [id, value]),
        ).toBe(1);
        // The same value again changes nothing and writes nothing.
        expect(
          await tx.exec(`update office.projects set ${column} = $2 where id = $1`, [id, value]),
        ).toBe(1);
      }
      expect(await since(tx, from)).toEqual(
        changes.map(([, , event]) => projectRow(event, ids.employeeA, id)),
      );

      // Several fields in one update: one row each, in a fixed order; a cleared field counts.
      const again = await mark(tx);
      await tx.setContext(employeeA);
      await tx.exec(
        `update office.projects set target_date = null, icon = 'box', name = 'Third name',
           description = null, customer_id = null
         where id = $1`,
        [id],
      );
      expect((await since(tx, again)).map((row) => row.event)).toEqual([
        'project_name_changed',
        'project_description_changed',
        'project_customer_changed',
        'project_icon_changed',
        'project_target_date_changed',
      ]);
    });
    // The budget has an event of its own since step 3 of the Projects section (it was the one
    // column an administrator could change that fell to the catch-all project_changed; no column
    // is left without an event now, and the catch-all stays for a column a later migration
    // adds). An administrator's change is traced without an actor.
    await inAdminTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext({});
      await tx.exec(
        `update office.projects set budget = 10, budget_currency = 'TRY' where id = $1`,
        [ids.projectANoAi],
      );
      expect(await since(tx, from)).toEqual([
        projectRow('project_budget_changed', null, ids.projectANoAi),
      ]);
    });
  });

  it('audit: a budget change and every milestone change write their own event, with ids only', async () => {
    const SET_BUDGET =
      'update office.projects set budget = $2::numeric, budget_currency = $3 where id = $1';
    const SET_MILESTONES = 'update office.projects set milestones = $2::jsonb where id = $1';
    const first = {
      id: randomUUID(),
      name: 'Gizli kilometre taşı',
      date: '2026-11-15',
      done: false,
    };
    await inTransaction(async (tx) => {
      const id = ids.projectANoAi;
      const from = await mark(tx);
      // The founder changes the budget: set, another amount, another currency, cleared.
      const budgets: [string | null, string | null][] = [
        ['7654321.09', 'TRY'],
        ['7654321.10', 'TRY'],
        ['7654321.10', 'EUR'],
        [null, null],
      ];
      for (const [amount, currency] of budgets) {
        await tx.setContext(founderA);
        expect(await tx.exec(SET_BUDGET, [id, amount, currency])).toBe(1);
        // The same value again changes nothing and writes nothing.
        expect(await tx.exec(SET_BUDGET, [id, amount, currency])).toBe(1);
      }
      expect(await since(tx, from)).toEqual(
        budgets.map(() => projectRow('project_budget_changed', ids.founder, id)),
      );

      // A plain member keeps the milestones: added, ticked, renamed, removed.
      const lists = [
        [first],
        [{ ...first, done: true }],
        [{ ...first, done: true, name: 'Başka ad', date: null }],
        [],
      ];
      const again = await mark(tx);
      for (const list of lists) {
        await tx.setContext(employeeA);
        expect(await tx.exec(SET_MILESTONES, [id, JSON.stringify(list)])).toBe(1);
        expect(await tx.exec(SET_MILESTONES, [id, JSON.stringify(list)])).toBe(1);
      }
      expect(await since(tx, again)).toEqual(
        lists.map(() => projectRow('project_milestones_changed', ids.employeeA, id)),
      );

      // Both in one update, with a plain field: one row each, and no catch-all beside them.
      const both = await mark(tx);
      await tx.setContext(founderA);
      await tx.exec(
        `update office.projects set milestones = $2::jsonb, budget = 5, budget_currency = 'USD',
           name = 'With money'
         where id = $1`,
        [id, JSON.stringify([first])],
      );
      expect((await since(tx, both)).map((row) => row.event)).toEqual([
        'project_name_changed',
        'project_budget_changed',
        'project_milestones_changed',
      ]);

      // Ids and an event name: no amount, no currency and no name of a milestone in any column.
      await tx.setContext(founderA);
      const rows = await tx.rows<{ row: string }>(
        `select to_jsonb(a)::text as row from office.audit_log a
         where id > $1 and event ~ '^project_(budget|milestones)_'`,
        [from],
      );
      expect(rows).toHaveLength(10);
      for (const { row } of rows) {
        for (const text of ['7654321', 'TRY', 'EUR', 'USD', 'Gizli', 'Başka', first.id]) {
          expect(row).not.toContain(text);
        }
      }
    });
    // A project an administrator writes with a budget and milestones says so when it is opened.
    await inAdminTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext({});
      const id = randomUUID();
      await tx.exec(
        `insert into office.projects (id, company_id, name, budget, budget_currency, milestones)
         values ($1, $2, 'Seeded', 10, 'TRY', $3::jsonb)`,
        [id, ids.arma, JSON.stringify([first])],
      );
      expect(await since(tx, from)).toEqual([
        projectRow('project_created', null, id),
        projectRow('project_budget_changed', null, id),
        projectRow('project_milestones_changed', null, id),
      ]);
    });
  });

  it('audit: adding and removing a member names the person and the project', async () => {
    await inTransaction(async (tx) => {
      // The adder is the owner of the project: a plain member adds and removes nobody.
      await tx.setContext(founderA);
      await tx.exec(SET_ROLE, [ids.projectA, ids.employeeA, 'owner']);
      const from = await mark(tx);
      await tx.setContext(employeeA);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]);
      await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.approverA]);
      // Adding a person who is refused leaves nothing; so does a removal that removes nobody.
      await tx.expectError(ADD_MEMBER, [ids.arma, ids.projectA, ids.externalA]);
      expect(await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.employeeA])).toBe(0);
      await tx.setContext(founderA);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
      await tx.exec(REMOVE_MEMBER, [ids.projectA, ids.sharedEmployee]);
      expect(await since(tx, from)).toEqual([
        // A plain member's first role is the membership itself: no role event.
        memberRow('project_member_added', ids.employeeA, ids.projectA, ids.approverA),
        memberRow('project_member_removed', ids.employeeA, ids.projectA, ids.approverA),
        memberRow('project_member_added', ids.founder, ids.projectA, ids.sharedEmployee),
        memberRow('project_member_removed', ids.founder, ids.projectA, ids.sharedEmployee),
      ]);
    });
  });

  it('audit: a role that is given leaves project_member_role_<role> for each person whose role changed, with the actor', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]);
      await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
      const from = await mark(tx);
      // The founder names the owner of a project that has none: one row.
      await tx.setContext(founderA);
      await tx.exec(SET_ROLE, [ids.projectA, ids.employeeA, 'owner']);
      // The owner appoints and dismisses a manager.
      await tx.setContext(employeeA);
      await tx.exec(SET_ROLE, [ids.projectA, ids.approverA, 'manager']);
      // The role the member has: nothing changes and nothing is written.
      await tx.exec(SET_ROLE, [ids.projectA, ids.approverA, 'manager']);
      await tx.exec(SET_ROLE, [ids.projectA, ids.approverA, 'member']);
      // A refused change leaves nothing.
      await tx.expectError(SET_ROLE, [ids.projectA, ids.employeeA, 'member']);
      await tx.setContext(sharedA);
      await tx.expectError(SET_ROLE, [ids.projectA, ids.sharedEmployee, 'manager']);
      // The hand-over: the owner until now and the new owner, one row each.
      await tx.setContext(employeeA);
      await tx.exec(SET_ROLE, [ids.projectA, ids.sharedEmployee, 'owner']);
      expect(await since(tx, from)).toEqual([
        memberRow('project_member_role_owner', ids.founder, ids.projectA, ids.employeeA),
        memberRow('project_member_role_manager', ids.employeeA, ids.projectA, ids.approverA),
        memberRow('project_member_role_member', ids.employeeA, ids.projectA, ids.approverA),
        memberRow('project_member_role_member', ids.employeeA, ids.projectA, ids.employeeA),
        memberRow('project_member_role_owner', ids.employeeA, ids.projectA, ids.sharedEmployee),
      ]);
    });
  });

  it('audit: opening and closing the AI permission of a project and the permissions of a customer leave their events with the founder as actor', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await stepUp(tx, founderA, 'project_ai_permission', ids.projectANoAi);
      await tx.exec(SET_AI, [ids.projectANoAi, true, null]);
      await tx.exec(SET_AI, [ids.projectANoAi, false, null]);
      // Asking for the value it has writes nothing.
      await tx.exec(SET_AI, [ids.projectANoAi, false, null]);
      await stepUp(tx, founderA, 'customer_ai_permission', ids.customerANoAi);
      await tx.exec(SET_CUSTOMER, [ids.customerANoAi, true, true]);
      await tx.exec(SET_CUSTOMER, [ids.customerANoAi, false, null]);
      await tx.exec(SET_CUSTOMER, [ids.customerANoAi, null, false]);
      await tx.exec(SET_CUSTOMER, [ids.customerANoAi, false, false]);
      expect(await since(tx, from)).toEqual([
        projectRow('project_ai_permission_opened', ids.founder, ids.projectANoAi),
        projectRow('project_ai_permission_closed', ids.founder, ids.projectANoAi),
        customerRow('customer_ai_permission_opened', ids.founder, ids.customerANoAi),
        customerRow('customer_automated_processing_opened', ids.founder, ids.customerANoAi),
        customerRow('customer_ai_permission_closed', ids.founder, ids.customerANoAi),
        customerRow('customer_automated_processing_closed', ids.founder, ids.customerANoAi),
      ]);
      // A refused opening leaves nothing.
      const refused = await mark(tx);
      await tx.expectError(SET_AI, [ids.projectANoAi, true, null]);
      await tx.expectError(SET_CUSTOMER, [ids.customerANoAi, true, null]);
      expect(await since(tx, refused)).toEqual([]);
    });
  });

  it('audit: a customer added by an employee leaves customer_created', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext(approverA);
      const id = randomUUID();
      await tx.exec(
        `insert into office.customers (id, company_id, name) values ($1, $2, 'Gamma')`,
        [id, ids.arma],
      );
      expect(await since(tx, from)).toEqual([customerRow('customer_created', ids.approverA, id)]);
    });
    // An administrator's customer with permissions, and a renamed one.
    await inAdminTransaction(async (tx) => {
      const from = await mark(tx);
      await tx.setContext({});
      const id = randomUUID();
      await tx.exec(
        `insert into office.customers (id, company_id, name, ai_allowed,
           automated_processing_allowed)
         values ($1, $2, 'Delta', true, true)`,
        [id, ids.arma],
      );
      await tx.exec(`update office.customers set name = 'Delta AS' where id = $1`, [id]);
      await tx.exec(`update office.customers set contacts = '[{"name": "x"}]' where id = $1`, [id]);
      expect(await since(tx, from)).toEqual([
        customerRow('customer_created', null, id),
        customerRow('customer_ai_permission_opened', null, id),
        customerRow('customer_automated_processing_opened', null, id),
        customerRow('customer_name_changed', null, id),
        customerRow('customer_changed', null, id),
      ]);
    });
  });

  it('audit: no request and no agent run can write a permission event', async () => {
    const insert = `insert into office.audit_log (company_id, project_id, event, record_type, record_id)
       values ($1, $2, $3, $4, $5)`;
    const forged: [string, string | null, string, string][] = [
      ['project_ai_permission_opened', ids.projectANoAi, 'project', ids.projectANoAi],
      ['project_ai_permission_closed', ids.projectA, 'project', ids.projectA],
      ['customer_ai_permission_opened', null, 'customer', ids.customerANoAi],
      ['customer_ai_permission_closed', null, 'customer', ids.customerA],
      ['customer_automated_processing_opened', null, 'customer', ids.customerA],
      ['customer_automated_processing_closed', null, 'customer', ids.customerA],
    ];
    await inTransaction(async (tx) => {
      for (const context of [founderA, employeeA]) {
        await tx.setContext(context);
        for (const [event, project, type, record] of forged) {
          expect(
            (await tx.expectError(insert, [ids.arma, project, event, type, record])).code,
            event,
          ).toBe('42501');
        }
      }
    });
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1' }]) {
        await tx.setContext(context);
        for (const [event, project, type, record] of forged) {
          expect(
            (await tx.expectError(insert, [ids.arma, project, event, type, record])).code,
            event,
          ).toBe('42501');
        }
      }
    });
  });

  it('audit: a membership that ends or turns external leaves project_member_removed', async () => {
    const turnExternal = `update office.memberships set role = 'external'
       where company_id = $1 and user_id = $2`;
    const remove = 'delete from office.memberships where company_id = $1 and user_id = $2';
    const removed = (actor: string | null) => [
      memberRow('project_member_removed', actor, ids.projectA, ids.sharedEmployee),
      memberRow('project_member_removed', actor, ids.projectANoAi, ids.sharedEmployee),
    ];
    const byProject = (rows: AuditRow[]) =>
      [...rows].sort((a, b) => (a.project_id ?? '').localeCompare(b.project_id ?? ''));

    // As the panel does it: the founder, through the API's role, with a passkey for that person.
    for (const change of [turnExternal, remove]) {
      await inTransaction(async (tx) => {
        await tx.setContext(founderA);
        await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
        await tx.exec(ADD_MEMBER, [ids.arma, ids.projectANoAi, ids.sharedEmployee]);
        const from = await mark(tx);
        await stepUp(tx, founderA, 'membership_change', ids.sharedEmployee);
        expect(await tx.exec(change, [ids.arma, ids.sharedEmployee])).toBe(1);
        expect(byProject(await since(tx, from)), change).toEqual(removed(ids.founder));
        expect(await tx.count('project_members', 'user_id = $1', [ids.sharedEmployee])).toBe(0);
      });
    }
    // And by an administrator, without a person in the context: no actor.
    for (const change of [turnExternal, remove]) {
      await inAdminTransaction(async (tx) => {
        await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
        await tx.exec(ADD_MEMBER, [ids.arma, ids.projectANoAi, ids.sharedEmployee]);
        const from = await mark(tx);
        await tx.setContext({});
        expect(await tx.exec(change, [ids.arma, ids.sharedEmployee])).toBe(1);
        expect(byProject(await since(tx, from)), change).toEqual(removed(null));
      });
    }
  });

  it('audit: the rows of this section hold an event name and ids, nothing else', async () => {
    await inTransaction(async (tx) => {
      const from = await mark(tx);
      // One of everything a person can do in this section.
      await tx.setContext(employeeA);
      const project = randomUUID();
      const customer = randomUUID();
      await tx.exec(
        `insert into office.customers (id, company_id, name) values ($1, $2, 'Müşteri adı')`,
        [customer, ids.arma],
      );
      await tx.exec(
        `insert into office.projects (id, company_id, customer_id, name, description)
         values ($1, $2, $3, 'Proje adı', 'Proje açıklaması')`,
        [project, ids.arma, customer],
      );
      await tx.exec(
        `update office.projects set name = 'Yeni ad', description = 'Yeni açıklama',
           status = 'completed'
         where id = $1`,
        [project],
      );
      await tx.exec(ADD_MEMBER, [ids.arma, project, ids.approverA]);
      await tx.exec(SET_ROLE, [project, ids.approverA, 'manager']);
      await tx.exec(SET_ROLE, [project, ids.approverA, 'member']);
      await tx.exec(SET_ROLE, [project, ids.approverA, 'owner']);
      await stepUp(tx, founderA, 'project_ai_permission', project);
      await tx.exec(SET_AI, [project, true, customer]);
      await tx.setContext(founderA);
      const rows = await tx.rows(
        `select event, record_type, external_ref, tool_name, run_id, agent_code,
                to_jsonb(a) - 'id' - 'company_id' - 'project_id' - 'occurred_at' - 'user_id'
                  - 'agent_code' - 'run_id' - 'event' - 'tool_name' - 'record_type' - 'record_id'
                  - 'external_ref' as other_columns
         from office.audit_log a
         where id > $1 and event ~ '^(project|customer)_'
         order by id`,
        [from],
      );
      expect(rows.map((row) => row.event)).toEqual([
        'customer_created',
        'project_created',
        'project_member_added',
        'project_member_role_owner',
        'project_name_changed',
        'project_description_changed',
        'project_status_completed',
        'project_member_added',
        'project_member_role_manager',
        'project_member_role_member',
        // The hand-over: the opener becomes a plain member, the other member the owner.
        'project_member_role_member',
        'project_member_role_owner',
        'project_ai_permission_opened',
      ]);
      for (const row of rows) {
        expect(EVENTS).toContain(row.event);
        expect(row).toMatchObject({
          external_ref: null,
          tool_name: null,
          run_id: null,
          agent_code: null,
          // The table has no column a text could hide in.
          other_columns: {},
        });
        expect(['project', 'user', 'customer']).toContain(row.record_type);
      }
    });
    // What the fixtures wrote without a person in the context is logged without an actor, with
    // the same names.
    const written = await adminQuery<{ event: string; n: number }>(
      `select event, count(*)::int as n from office.audit_log
       where event ~ '^(project|customer)_' and user_id is null and agent_code is null
         and run_id is null and tool_name is null and external_ref is null
       group by event order by event`,
    );
    for (const row of written) {
      expect(EVENTS).toContain(row.event);
    }
    expect(written.map((row) => row.event)).toEqual(
      expect.arrayContaining(['customer_created', 'project_created', 'project_member_added']),
    );
  });
});
