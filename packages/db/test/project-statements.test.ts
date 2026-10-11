import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import {
  addProjectMember,
  addProjectMilestone,
  changeProjectMilestone,
  insertCustomer,
  insertProject,
  listCustomers,
  listMemberCandidates,
  listProjectMembers,
  listProjects,
  ownProjectExists,
  readCompanyKind,
  readCustomer,
  readProject,
  removeProjectMember,
  removeProjectMilestone,
  setCustomerPermissions,
  setProjectAiPermission,
  setProjectBudget,
  setProjectMemberRole,
  updateProject,
  type NewProject,
} from '../src/projects.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  auditMark,
  closePools,
  inTransaction,
  noDatabase,
  openTransaction,
  removeRequests,
  untilBlocked,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// The statements the API runs for the Projects section, with the API's restricted role. What a
// person reads is the row policies' decision; these tests show that no statement widens it.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
// A plain member of projectA and of projectANoAi (neither has an owner in the fixtures).
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
// An employee of Arma DX who is a member of no project.
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
const founderSpace: ContextInput = { companyId: ids.founderSpace, userId: ids.founder };
const NOBODY: ContextInput[] = [{}, { userId: ids.founder }, { companyId: ids.arma }];

function project(fields: Partial<NewProject> = {}): NewProject {
  return {
    id: randomUUID(),
    customerId: null,
    name: 'A project',
    description: null,
    status: 'planned',
    color: 'gray',
    icon: 'folder',
    targetDate: null,
    ...fields,
  };
}

// People are listed by name in the order of the database's collation, which is not the same on
// every server: the tests compare who is listed, sorted by id.
function byId<T extends { user_id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.user_id.localeCompare(b.user_id));
}

async function names(tx: Tx): Promise<string[]> {
  return (await listProjects(tx.client, 100)).map((row) => row.name);
}

describe.skipIf(noDatabase)('statements of the Projects section', () => {
  afterAll(closePools);

  it('listProjects: the founder gets every project of the company, an employee the ones they are a member of, open ones first, with customer, member count and target date as a day', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const newest = project({
        name: 'Newest',
        customerId: ids.customerANoAi,
        targetDate: '2026-12-31',
        status: 'in_progress',
        color: 'teal',
        icon: 'code',
        description: 'Two\nlines',
      });
      await insertProject(tx.client, newest);
      await addProjectMember(tx.client, newest.id, ids.approverA);
      // Closing a project moves it behind the open ones.
      await updateProject(tx.client, ids.projectA, { status: 'completed' });

      const mine = await listProjects(tx.client, 100);
      expect(mine.map((row) => row.name)).toEqual([
        'Newest',
        'Project without AI permission',
        'Project A',
      ]);
      expect(mine[0]).toMatchObject({
        id: newest.id,
        name: 'Newest',
        description: 'Two\nlines',
        status: 'in_progress',
        closed: false,
        color: 'teal',
        icon: 'code',
        target_date: '2026-12-31',
        ai_allowed: false,
        customer_id: ids.customerANoAi,
        customer_name: 'Customer without AI permission',
        customer_ai_allowed: false,
        customer_automated_processing_allowed: false,
        member_count: 2,
        created_by_user_id: ids.employeeA,
        reader_is_founder: false,
        // Who opens a project is its owner (8 October decision 44).
        reader_project_role: 'owner',
      });
      expect(mine[0]?.created_at).toBeInstanceOf(Date);
      expect(mine[2]).toMatchObject({
        id: ids.projectA,
        closed: true,
        status: 'completed',
        ai_allowed: true,
        customer_id: ids.customerA,
        customer_ai_allowed: true,
        member_count: 1,
        target_date: null,
        created_by_user_id: null,
        reader_project_role: 'member',
      });
      // The limit is the caller's.
      expect((await listProjects(tx.client, 2)).map((row) => row.name)).toEqual([
        'Newest',
        'Project without AI permission',
      ]);

      // The founder: every project of the company, member of none.
      await tx.setContext(founderA);
      const all = await listProjects(tx.client, 100);
      expect(all.map((row) => row.name)).toEqual([
        'Newest',
        // The fixtures wrote their projects at one moment: the id decides between them.
        'Project without AI permission',
        'Project whose customer has no AI permission',
        'Project A',
      ]);
      expect(all.every((row) => row.reader_is_founder)).toBe(true);
      // Member of none: no project role in any of them.
      expect(all.map((row) => row.reader_project_role)).toEqual([null, null, null, null]);

      // A colleague who is a member of one; an external person; the other company; nobody.
      await tx.setContext(approverA);
      expect(await names(tx)).toEqual(['Newest']);
      expect((await listProjects(tx.client, 100))[0]?.reader_project_role).toBe('member');
      await tx.setContext(externalA);
      expect(await names(tx)).toEqual([]);
      await tx.setContext(founderP);
      expect(await names(tx)).toEqual(['Project P']);
      await tx.setContext(founderSpace);
      expect(await names(tx)).toEqual([]);
      for (const context of NOBODY) {
        await tx.setContext(context);
        expect(await names(tx)).toEqual([]);
      }
    });
  });

  it('readProject: null for a project of another company, for a non-member and without a context', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      expect(await readProject(tx.client, ids.projectA)).toMatchObject({
        id: ids.projectA,
        name: 'Project A',
        customer_name: 'Customer with AI permission',
        member_count: 1,
      });
      // A project of the company the reader is no member of (the founder reads it).
      expect(await readProject(tx.client, ids.projectACustomerNoAi)).toBeNull();
      await tx.setContext(founderA);
      expect((await readProject(tx.client, ids.projectACustomerNoAi))?.member_count).toBe(0);
      expect(await readProject(tx.client, ids.projectP)).toBeNull();
      expect(await readProject(tx.client, randomUUID())).toBeNull();
      for (const context of [approverA, externalA, founderP, employeeP, ...NOBODY]) {
        await tx.setContext(context);
        expect(await readProject(tx.client, ids.projectA)).toBeNull();
      }
      // An agent run reads a project only as its own run's project (rule 12 decides further).
      await tx.setContext({ ...founderA, agentCode: 'KOR-1' });
      expect(await readProject(tx.client, ids.projectA)).toBeNull();
    });
  });

  it('updateProject: changes only the fields that were sent and can clear the description, the customer and the target date', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const id = ids.projectANoAi;
      expect(
        await updateProject(tx.client, id, {
          description: 'First',
          customerId: ids.customerA,
          targetDate: '2027-01-15',
        }),
      ).toBe(1);
      expect(await readProject(tx.client, id)).toMatchObject({
        name: 'Project without AI permission',
        description: 'First',
        customer_id: ids.customerA,
        target_date: '2027-01-15',
        status: 'planned',
        color: 'gray',
        icon: 'folder',
      });
      // One field: the others stay.
      expect(await updateProject(tx.client, id, { name: 'Renamed' })).toBe(1);
      expect(await updateProject(tx.client, id, { status: 'cancelled' })).toBe(1);
      expect(await updateProject(tx.client, id, { color: 'purple', icon: 'bolt' })).toBe(1);
      expect(await readProject(tx.client, id)).toMatchObject({
        name: 'Renamed',
        description: 'First',
        customer_id: ids.customerA,
        target_date: '2027-01-15',
        status: 'cancelled',
        closed: true,
        color: 'purple',
        icon: 'bolt',
      });
      // null clears; undefined leaves.
      expect(
        await updateProject(tx.client, id, {
          description: null,
          customerId: null,
          targetDate: null,
          name: undefined,
        }),
      ).toBe(1);
      expect(await readProject(tx.client, id)).toMatchObject({
        name: 'Renamed',
        description: null,
        customer_id: null,
        customer_name: null,
        target_date: null,
        status: 'cancelled',
      });
      // Nothing sent changes nothing.
      expect(await updateProject(tx.client, id, {})).toBe(1);
      expect((await readProject(tx.client, id))?.name).toBe('Renamed');

      // Somebody who may not change it: 0 rows, whoever they are.
      for (const context of [approverA, externalA, founderP, ...NOBODY]) {
        await tx.setContext(context);
        expect(await updateProject(tx.client, id, { name: 'Taken' })).toBe(0);
      }
      await tx.setContext(founderA);
      expect((await readProject(tx.client, id))?.name).toBe('Renamed');
    });
  });

  it('listProjectMembers: names, roles, the active flag and the project role of the members, for a member; nothing for a colleague who is not one', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await setProjectMemberRole(tx.client, ids.projectA, ids.employeeA, 'owner');
      // The owner adds the members; who is added is a plain member.
      await tx.setContext(employeeA);
      await addProjectMember(tx.client, ids.projectA, ids.founder);
      await addProjectMember(tx.client, ids.projectA, ids.approverA);
      await addProjectMember(tx.client, ids.projectA, ids.sharedEmployee);
      // Adding twice changes nothing.
      await addProjectMember(tx.client, ids.projectA, ids.approverA);
      await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager');
      // A member whose account is deactivated afterwards stays listed, marked.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.exec('update office.users set active = false where id = $1', [ids.approverA]);

      const listed = [
        {
          user_id: ids.founder,
          name: 'Kurucu',
          role: 'founder',
          active: true,
          project_role: 'member',
        },
        {
          user_id: ids.employeeA,
          name: 'Çalışan A',
          role: 'employee',
          active: true,
          project_role: 'owner',
        },
        {
          user_id: ids.approverA,
          name: 'Yetkili Çalışan A',
          role: 'employee',
          active: false,
          project_role: 'manager',
        },
        {
          user_id: ids.sharedEmployee,
          name: 'Ortak Çalışan',
          role: 'employee',
          active: true,
          project_role: 'member',
        },
      ];
      // Every member reads the same list, a plain one too.
      for (const context of [employeeA, { companyId: ids.arma, userId: ids.sharedEmployee }]) {
        await tx.setContext(context);
        expect(byId(await listProjectMembers(tx.client, ids.projectA))).toEqual(listed);
      }
      // A plain member removes nobody (8 October decision 44).
      expect(await removeProjectMember(tx.client, ids.projectA, ids.founder)).toBe(0);
      await tx.setContext(employeeA);
      expect(await removeProjectMember(tx.client, ids.projectA, ids.founder)).toBe(1);
      expect(await removeProjectMember(tx.client, ids.projectA, ids.founder)).toBe(0);
      // An employee does not remove themselves, and the owner is never removed.
      expect(await removeProjectMember(tx.client, ids.projectA, ids.employeeA)).toBe(0);
      expect(await removeProjectMember(tx.client, ids.projectA, ids.sharedEmployee)).toBe(1);
      expect(
        byId(await listProjectMembers(tx.client, ids.projectA)).map((row) => row.user_id),
      ).toEqual([ids.employeeA, ids.approverA]);

      for (const context of [
        { companyId: ids.arma, userId: ids.sharedEmployee },
        externalA,
        founderP,
        ...NOBODY,
      ]) {
        await tx.setContext(context);
        expect(await listProjectMembers(tx.client, ids.projectA)).toEqual([]);
        expect(await removeProjectMember(tx.client, ids.projectA, ids.approverA)).toBe(0);
      }
    });
  });

  it("readProject: the reader's own project role, null for the founder who is no member", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await addProjectMember(tx.client, ids.projectA, ids.approverA);
      for (const [role, own] of [
        [null, 'member'],
        ['manager', 'manager'],
        ['owner', 'owner'],
      ] as const) {
        if (role !== null) {
          await tx.setContext(founderA);
          await setProjectMemberRole(tx.client, ids.projectA, ids.employeeA, role);
        }
        await tx.setContext(employeeA);
        expect(await readProject(tx.client, ids.projectA), own).toMatchObject({
          reader_is_founder: false,
          reader_project_role: own,
        });
        // Another member reads their own role, not the first one's.
        await tx.setContext(approverA);
        expect((await readProject(tx.client, ids.projectA))?.reader_project_role).toBe('member');
      }
      // The founder reads the project without a role in it; as a member, with that role.
      await tx.setContext(founderA);
      expect(await readProject(tx.client, ids.projectA)).toMatchObject({
        reader_is_founder: true,
        reader_project_role: null,
      });
      await addProjectMember(tx.client, ids.projectA, ids.founder);
      expect(await readProject(tx.client, ids.projectA)).toMatchObject({
        reader_is_founder: true,
        reader_project_role: 'member',
      });
    });
  });

  it('setProjectMemberRole: true when the role changed, false when the member had it', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await addProjectMember(tx.client, ids.projectA, ids.approverA);
      const roleOf = async (userId: string): Promise<string | undefined> =>
        (await listProjectMembers(tx.client, ids.projectA)).find((row) => row.user_id === userId)
          ?.project_role;
      expect(await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'member')).toBe(
        false,
      );
      expect(await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager')).toBe(
        true,
      );
      expect(await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager')).toBe(
        false,
      );
      expect(await roleOf(ids.approverA)).toBe('manager');
      expect(await setProjectMemberRole(tx.client, ids.projectA, ids.employeeA, 'owner')).toBe(
        true,
      );
      // The hand-over is one call: the owner until now is a plain member afterwards.
      expect(await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'owner')).toBe(
        true,
      );
      expect(await roleOf(ids.approverA)).toBe('owner');
      expect(await roleOf(ids.employeeA)).toBe('member');
      // The database's refusal reaches the caller as its error: a plain member gives no role.
      await tx.setContext(employeeA);
      expect(
        (
          await tx.expectError('select office.set_project_member_role($1, $2, $3)', [
            ids.projectA,
            ids.employeeA,
            'owner',
          ])
        ).code,
      ).toBe('42501');
      await expect(
        tx.client
          .query('savepoint refused')
          .then(() => setProjectMemberRole(tx.client, ids.projectA, ids.employeeA, 'owner')),
      ).rejects.toMatchObject({ code: '42501' });
      await tx.client.query('rollback to savepoint refused');
    });
  });

  it('listMemberCandidates: the active founders and employees of the context company, no external person, nobody of another company', async () => {
    await inTransaction(async (tx) => {
      const everybody = [
        { user_id: ids.founder, name: 'Kurucu', role: 'founder' },
        { user_id: ids.employeeA, name: 'Çalışan A', role: 'employee' },
        { user_id: ids.approverA, name: 'Yetkili Çalışan A', role: 'employee' },
        { user_id: ids.sharedEmployee, name: 'Ortak Çalışan', role: 'employee' },
      ];
      for (const context of [founderA, employeeA]) {
        await tx.setContext(context);
        expect(byId(await listMemberCandidates(tx.client))).toEqual(everybody);
      }
      await tx.setContext(founderP);
      expect(byId(await listMemberCandidates(tx.client)).map((row) => row.user_id)).toEqual([
        ids.founder,
        ids.employeeP,
      ]);
      // A deactivated account is not offered.
      await stepUp(tx, founderA, 'membership_change', ids.approverA);
      await tx.exec('update office.users set active = false where id = $1', [ids.approverA]);
      await tx.setContext(employeeA);
      expect(byId(await listMemberCandidates(tx.client)).map((row) => row.user_id)).toEqual([
        ids.founder,
        ids.employeeA,
        ids.sharedEmployee,
      ]);
      // Nothing for an external person, an agent run, or without a context.
      for (const context of [externalA, { ...founderA, agentCode: 'KOR-1' }, ...NOBODY]) {
        await tx.setContext(context);
        expect(await listMemberCandidates(tx.client)).toEqual([]);
      }
    });
  });

  it('listCustomers: the customers of the context company by name; none of the other company', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const added = randomUUID();
      await insertCustomer(tx.client, { id: added, name: 'Beta' });
      for (const context of [employeeA, founderA]) {
        await tx.setContext(context);
        expect(await listCustomers(tx.client)).toEqual([
          { id: added, name: 'Beta', ai_allowed: false, automated_processing_allowed: false },
          {
            id: ids.customerA,
            name: 'Customer with AI permission',
            ai_allowed: true,
            automated_processing_allowed: false,
          },
          {
            id: ids.customerANoAi,
            name: 'Customer without AI permission',
            ai_allowed: false,
            automated_processing_allowed: false,
          },
        ]);
      }
      expect(await readCustomer(tx.client, added)).toMatchObject({ id: added, name: 'Beta' });
      expect(await readCustomer(tx.client, ids.customerP)).toBeNull();

      // The founder marks the permissions through the function; a permission left out stays.
      await setCustomerPermissions(tx.client, added, { automatedProcessingAllowed: true });
      await stepUp(tx, founderA, 'customer_ai_permission', added);
      await setCustomerPermissions(tx.client, added, { aiAllowed: true });
      expect(await readCustomer(tx.client, added)).toEqual({
        id: added,
        name: 'Beta',
        ai_allowed: true,
        automated_processing_allowed: true,
      });

      await tx.setContext(founderP);
      expect((await listCustomers(tx.client)).map((row) => row.name)).toEqual(['Pillika customer']);
      expect(await readCustomer(tx.client, added)).toBeNull();
      for (const context of [externalA, ...NOBODY]) {
        await tx.setContext(context);
        expect(await listCustomers(tx.client)).toEqual([]);
        expect(await readCustomer(tx.client, ids.customerA)).toBeNull();
      }
    });
  });

  it('ownProjectExists: true only for the person who opened it', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const opened = project();
      expect(await ownProjectExists(tx.client, opened.id)).toBe(false);
      await insertProject(tx.client, opened);
      expect(await ownProjectExists(tx.client, opened.id)).toBe(true);
      // A fixture project has no opener; the person is a member of it all the same.
      expect(await ownProjectExists(tx.client, ids.projectA)).toBe(false);
      // The founder reads the project but did not open it.
      await tx.setContext(founderA);
      expect(await readProject(tx.client, opened.id)).not.toBeNull();
      expect(await ownProjectExists(tx.client, opened.id)).toBe(false);
      for (const context of [approverA, { ...employeeA, companyId: ids.pillika }, ...NOBODY]) {
        await tx.setContext(context);
        expect(await ownProjectExists(tx.client, opened.id)).toBe(false);
      }
    });
  });

  it('setProjectAiPermission and readCompanyKind: the function call with the customer the founder saw, answering whether the value changed; the kind of the context company', async () => {
    await inTransaction(async (tx) => {
      await stepUp(tx, founderA, 'project_ai_permission', ids.projectANoAi);
      // The answer says whether this call changed the value: the route starts the waiting work
      // again only for the call that opened the permission (8 October decision 49).
      expect(await setProjectAiPermission(tx.client, ids.projectANoAi, false, null)).toBe(false);
      expect(await setProjectAiPermission(tx.client, ids.projectANoAi, true, null)).toBe(true);
      expect((await readProject(tx.client, ids.projectANoAi))?.ai_allowed).toBe(true);
      expect(await setProjectAiPermission(tx.client, ids.projectANoAi, true, null)).toBe(false);
      expect(await setProjectAiPermission(tx.client, ids.projectANoAi, false, null)).toBe(true);
      expect((await readProject(tx.client, ids.projectANoAi))?.ai_allowed).toBe(false);
      expect(await setProjectAiPermission(tx.client, ids.projectANoAi, false, null)).toBe(false);

      expect(await readCompanyKind(tx.client)).toBe('company');
      await tx.setContext(founderSpace);
      expect(await readCompanyKind(tx.client)).toBe('private_space');
      for (const context of NOBODY) {
        await tx.setContext(context);
        expect(await readCompanyKind(tx.client)).toBeNull();
      }
    });
  });
});

// Step 3 of the Projects section (8 October decision 17): the budget and the milestones.
describe.skipIf(noDatabase)('statements of the budget and the milestones', () => {
  afterAll(closePools);

  const ADD_MEMBER =
    'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)';

  /** projectA with employeeA its owner, approverA a manager and sharedEmployee a plain member. */
  async function projectWithRoles(tx: Tx): Promise<void> {
    await tx.setContext(founderA);
    await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]);
    await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.sharedEmployee]);
    await setProjectMemberRole(tx.client, ids.projectA, ids.employeeA, 'owner');
    await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager');
  }

  const sharedA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };

  async function milestones(tx: Tx): Promise<unknown> {
    return (await readProject(tx.client, ids.projectA))?.milestones;
  }

  it('readProject: the budget is in the row for the owner, a manager and the founder, and null for a plain member', async () => {
    await inTransaction(async (tx) => {
      await projectWithRoles(tx);
      expect(
        await setProjectBudget(tx.client, ids.projectA, { amount: '150000.5', currency: 'TRY' }),
      ).toBe(1);
      for (const context of [founderA, employeeA, approverA]) {
        await tx.setContext(context);
        expect(await readProject(tx.client, ids.projectA), context.userId ?? '').toMatchObject({
          budget: '150000.50',
          budget_currency: 'TRY',
          milestones: [],
        });
        const listed = (await listProjects(tx.client, 100)).find((row) => row.id === ids.projectA);
        expect(listed).toMatchObject({ budget: '150000.50', budget_currency: 'TRY' });
      }
      // A plain member reads the project, and neither the amount nor its currency.
      await tx.setContext(sharedA);
      const row = await readProject(tx.client, ids.projectA);
      expect(row).toMatchObject({ budget: null, budget_currency: null, milestones: [] });
      expect(JSON.stringify(row)).not.toContain('150000');
      const listed = (await listProjects(tx.client, 100)).find(
        (candidate) => candidate.id === ids.projectA,
      );
      expect(listed).toMatchObject({ budget: null, budget_currency: null });
      // A project without a budget: null for the founder too.
      await tx.setContext(founderA);
      expect(await readProject(tx.client, ids.projectANoAi)).toMatchObject({
        budget: null,
        budget_currency: null,
      });
    });
  });

  it('setProjectBudget: sets, changes and clears; 0 rows for a project the person cannot read', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const steps: [{ amount: string; currency: string } | null, string | null, string | null][] = [
        [{ amount: '1', currency: 'USD' }, '1.00', 'USD'],
        [{ amount: '999999999999.99', currency: 'EUR' }, '999999999999.99', 'EUR'],
        [{ amount: '0.01', currency: 'EUR' }, '0.01', 'EUR'],
        [null, null, null],
        // Clearing a budget that is not there is not an error.
        [null, null, null],
      ];
      for (const [budget, amount, currency] of steps) {
        expect(await setProjectBudget(tx.client, ids.projectA, budget)).toBe(1);
        expect(await readProject(tx.client, ids.projectA)).toMatchObject({
          budget: amount,
          budget_currency: currency,
        });
      }
      // The other company's founder, an employee who is no member, an external person, nobody.
      for (const context of [founderP, employeeP, approverA, externalA, ...NOBODY]) {
        await tx.setContext(context);
        expect(
          await setProjectBudget(tx.client, ids.projectA, { amount: '5', currency: 'TRY' }),
          JSON.stringify(context),
        ).toBe(0);
      }
      await tx.setContext(founderA);
      expect(await setProjectBudget(tx.client, randomUUID(), null)).toBe(0);
      expect(await readProject(tx.client, ids.projectA)).toMatchObject({ budget: null });
      // A plain member is refused by the database, not by a missing row.
      await tx.setContext(employeeA);
      await tx.exec('savepoint refused');
      await expect(
        setProjectBudget(tx.client, ids.projectA, { amount: '5', currency: 'TRY' }),
      ).rejects.toMatchObject({ code: '42501' });
      await tx.exec('rollback to savepoint refused');
    });
  });

  it('addProjectMilestone: adds at the end, stores the id in lower case, adds nothing for an id that is there and nothing to a full list', async () => {
    await inTransaction(async (tx) => {
      // A plain member keeps the milestones.
      await tx.setContext(employeeA);
      const first = randomUUID();
      const second = randomUUID();
      expect(
        await addProjectMilestone(tx.client, ids.projectA, {
          id: first,
          name: 'Tasarım onayı',
          date: '2026-11-15',
        }),
      ).toBe(1);
      // The same id again (a repeated send) adds nothing, whatever else it says.
      expect(
        await addProjectMilestone(tx.client, ids.projectA, {
          id: first,
          name: 'Başka',
          date: null,
        }),
      ).toBe(0);
      expect(
        await addProjectMilestone(tx.client, ids.projectA, {
          id: first.toUpperCase(),
          name: 'Başka',
          date: null,
        }),
      ).toBe(0);
      expect(
        await addProjectMilestone(tx.client, ids.projectA, {
          id: second.toUpperCase(),
          name: 'Yayın',
          date: null,
        }),
      ).toBe(1);
      expect(await milestones(tx)).toEqual([
        { id: first, name: 'Tasarım onayı', date: '2026-11-15', done: false },
        { id: second, name: 'Yayın', date: null, done: false },
      ]);
      // A name the database does not take is its check's refusal.
      await tx.exec('savepoint refused');
      await expect(
        addProjectMilestone(tx.client, ids.projectA, { id: randomUUID(), name: ' ', date: null }),
      ).rejects.toMatchObject({ code: '23514' });
      await tx.exec('rollback to savepoint refused');
      // Nobody who cannot change the project adds one.
      for (const context of [
        approverA,
        externalA,
        founderP,
        { ...founderA, agentCode: 'KOR-1', projectId: ids.projectA },
        ...NOBODY,
      ]) {
        await tx.setContext(context);
        expect(
          await addProjectMilestone(tx.client, ids.projectA, {
            id: randomUUID(),
            name: 'x',
            date: null,
          }),
          JSON.stringify(context),
        ).toBe(0);
      }
      // Up to 50; the 51st adds nothing.
      await tx.setContext(founderA);
      for (let n = 3; n <= 50; n += 1) {
        expect(
          await addProjectMilestone(tx.client, ids.projectA, {
            id: randomUUID(),
            name: `Adım ${String(n)}`,
            date: null,
          }),
        ).toBe(1);
      }
      expect(
        await addProjectMilestone(tx.client, ids.projectA, {
          id: randomUUID(),
          name: 'Bir fazla',
          date: null,
        }),
      ).toBe(0);
      expect(await milestones(tx)).toHaveLength(50);
    });
  });

  it('changeProjectMilestone: changes only the fields that were sent, of the one entry, and keeps the order; 0 rows for an unknown id', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
      await addProjectMilestone(tx.client, ids.projectA, { id: a, name: 'Bir', date: null });
      await addProjectMilestone(tx.client, ids.projectA, {
        id: b,
        name: 'İki',
        date: '2026-11-15',
      });
      await addProjectMilestone(tx.client, ids.projectA, { id: c, name: 'Üç', date: null });
      const others = [
        { id: a, name: 'Bir', date: null, done: false },
        { id: c, name: 'Üç', date: null, done: false },
      ];
      const steps: [Parameters<typeof changeProjectMilestone>[3], Record<string, unknown>][] = [
        [{ done: true }, { name: 'İki', date: '2026-11-15', done: true }],
        [{ name: 'İki (müşteri)' }, { name: 'İki (müşteri)', date: '2026-11-15', done: true }],
        // null clears the day; undefined leaves it.
        [{ date: null }, { name: 'İki (müşteri)', date: null, done: true }],
        [
          { date: undefined, done: false },
          { name: 'İki (müşteri)', date: null, done: false },
        ],
        [
          { name: 'Son', date: '2027-01-31', done: true },
          { name: 'Son', date: '2027-01-31', done: true },
        ],
      ];
      for (const [changes, expected] of steps) {
        // The id as the panel may send it: any letter case.
        expect(
          await changeProjectMilestone(tx.client, ids.projectA, b.toUpperCase(), changes),
          JSON.stringify(changes),
        ).toBe(1);
        expect(await milestones(tx)).toEqual([others[0], { id: b, ...expected }, others[1]]);
      }
      expect(
        await changeProjectMilestone(tx.client, ids.projectA, randomUUID(), { done: true }),
      ).toBe(0);
      for (const changes of [{ name: '  ' }, { date: '2026-02-30' }]) {
        await tx.exec('savepoint refused');
        await expect(
          changeProjectMilestone(tx.client, ids.projectA, b, changes),
        ).rejects.toMatchObject({ code: '23514' });
        await tx.exec('rollback to savepoint refused');
      }
      for (const context of [approverA, externalA, founderP, ...NOBODY]) {
        await tx.setContext(context);
        expect(
          await changeProjectMilestone(tx.client, ids.projectA, b, { done: false }),
          JSON.stringify(context),
        ).toBe(0);
      }
      await tx.setContext(employeeA);
      expect(await milestones(tx)).toEqual([
        others[0],
        { id: b, name: 'Son', date: '2027-01-31', done: true },
        others[1],
      ]);
    });
  });

  it('removeProjectMilestone: removes the one entry; 0 rows the second time', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const [a, b] = [randomUUID(), randomUUID()];
      await addProjectMilestone(tx.client, ids.projectA, { id: a, name: 'Bir', date: null });
      await addProjectMilestone(tx.client, ids.projectA, { id: b, name: 'İki', date: null });
      for (const context of [approverA, externalA, founderP, ...NOBODY]) {
        await tx.setContext(context);
        expect(
          await removeProjectMilestone(tx.client, ids.projectA, a),
          JSON.stringify(context),
        ).toBe(0);
      }
      await tx.setContext(employeeA);
      expect(await removeProjectMilestone(tx.client, ids.projectA, a.toUpperCase())).toBe(1);
      expect(await milestones(tx)).toEqual([{ id: b, name: 'İki', date: null, done: false }]);
      expect(await removeProjectMilestone(tx.client, ids.projectA, a)).toBe(0);
      // The last one leaves an empty list, not a null.
      expect(await removeProjectMilestone(tx.client, ids.projectA, b)).toBe(1);
      expect(await milestones(tx)).toEqual([]);
      expect(await removeProjectMilestone(tx.client, ids.projectA, b)).toBe(0);
    });
  });

  it('two people who add a milestone at the same moment both find their entry', async () => {
    // Two connections that commit: the list is put back and the audit rows removed at the end.
    const mark = await auditMark();
    const first = await openTransaction('app', employeeA);
    const second = await openTransaction('app', founderA);
    const [one, two] = [randomUUID(), randomUUID()];
    try {
      expect(
        await addProjectMilestone(first.tx.client, ids.projectA, {
          id: one,
          name: 'Birinci',
          date: null,
        }),
      ).toBe(1);
      // The second add waits for the first transaction and then adds to the list as the first
      // left it: the statement builds the list itself, it does not write back a list it read.
      const waiting = addProjectMilestone(second.tx.client, ids.projectA, {
        id: two,
        name: 'İkinci',
        date: '2026-12-01',
      });
      await untilBlocked(second.pid);
      await first.commit();
      expect(await waiting).toBe(1);
      await second.commit();
      expect(
        await adminQuery('select milestones from office.projects where id = $1', [ids.projectA]),
      ).toEqual([
        {
          milestones: [
            { id: one, name: 'Birinci', date: null, done: false },
            { id: two, name: 'İkinci', date: '2026-12-01', done: false },
          ],
        },
      ]);
    } finally {
      await first.rollback();
      await second.rollback();
      await adminQuery(`update office.projects set milestones = '[]' where id = $1`, [
        ids.projectA,
      ]);
      await removeRequests([], mark);
    }
  });
});
