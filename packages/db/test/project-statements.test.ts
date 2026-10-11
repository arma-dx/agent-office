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
  listProjectApprovals,
  listProjectMembers,
  listProjectRuns,
  listProjects,
  ownProjectExists,
  projectRunTotals,
  readCompanyKind,
  readCustomer,
  readProject,
  readProjectAiSpending,
  readerSeesUndecided,
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
  asRole,
  auditMark,
  closePools,
  inAdminTransaction,
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

// Step 3 of the Projects section (8 October decision 17): the agent runs of a project and their
// cost. A request is opened by a person through the API's role and a run by the worker's role, so
// each case runs in one privileged transaction that goes on as the role whose act it is (asRole)
// and is rolled back.
describe.skipIf(noDatabase)('statements of the runs of a project', () => {
  afterAll(closePools);

  const MARKER = 'WHAT-THE-AGENT-WROTE';
  const OPEN = `insert into office.tasks (company_id, project_id, kind, title, description)
    values (office.ctx_company_id(), $1, 'request', $2, 'What is wanted') returning id`;
  const RUN = `insert into office.runs
      (company_id, task_id, agent_code, card_version_id, trigger_type, model, input)
    values (office.ctx_company_id(), $1, 'KOR-1', $2, 'request', 'test-model', $3::jsonb)
    returning id`;

  async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
    await asRole(tx, 'app');
    await tx.setContext(context);
  }

  interface Usage {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    cost: string;
  }

  /**
   * A request of the employee in that project (or in none) with one run of KOR-1 on it, opened by
   * the worker's role in the request's own context. With `usage` the run is closed after `seconds`
   * with those numbers, and with an agent's words in its summary and its output; without it the
   * run stays open.
   */
  async function requestWithRun(
    tx: Tx,
    project: string | null,
    title: string,
    usage?: Usage,
    seconds = 42,
  ): Promise<{ task: string; run: string }> {
    await asPerson(tx, employeeA);
    const [task] = await tx.rows<{ id: string }>(OPEN, [project, title]);
    await asRole(tx, 'worker');
    await tx.setContext({ ...employeeA, agentCode: 'KOR-1', projectId: project });
    const [run] = await tx.rows<{ id: string }>(RUN, [
      task?.id,
      ids.cardKor,
      JSON.stringify({ note: MARKER }),
    ]);
    if (!task || !run) {
      throw new Error('The request or its run was not written');
    }
    if (usage) {
      await tx.exec(
        `update office.runs set status = 'completed',
           finished_at = now() + make_interval(secs => $2), summary = $3, output = $4::jsonb,
           input_tokens = $5, output_tokens = $6, cache_write_tokens = $7, cache_read_tokens = $8,
           cost_usd = $9::numeric
         where id = $1`,
        [
          run.id,
          seconds,
          MARKER,
          JSON.stringify({ final_text: MARKER }),
          usage.input,
          usage.output,
          usage.cacheWrite,
          usage.cacheRead,
          usage.cost,
        ],
      );
    }
    return { task: task.id, run: run.id };
  }

  /**
   * Moves the start of a run into the past, as an administrator with the triggers off (the start
   * of a run is never rewritten otherwise): every run of one transaction starts at the same
   * moment, and the list is ordered by that moment.
   */
  async function startedAgo(tx: Tx, run: string, minutes: number): Promise<void> {
    await asRole(tx, null);
    await tx.exec(`set local session_replication_role = 'replica'`);
    await tx.exec(
      `update office.runs set started_at = now() - make_interval(mins => $2) where id = $1`,
      [run, minutes],
    );
    await tx.exec(`set local session_replication_role = 'origin'`);
  }

  const FIRST: Usage = {
    input: 900,
    output: 120,
    cacheWrite: 30,
    cacheRead: 4000,
    cost: '0.012345',
  };
  const SECOND: Usage = { input: 5000, output: 2100, cacheWrite: 0, cacheRead: 100, cost: '0.4' };

  const COLUMNS = [
    'agent_code',
    'agent_name',
    'cache_read_tokens',
    'cache_write_tokens',
    'cost_usd',
    'duration_ms',
    'error_code',
    'finished_at',
    'id',
    'input_tokens',
    'output_tokens',
    'started_at',
    'status',
    'task_id',
    'task_title',
  ];

  it('listProjectRuns: the founder reads tokens and cost; a member reads the same rows without them', async () => {
    await inAdminTransaction(async (tx) => {
      const first = await requestWithRun(tx, ids.projectA, 'First request', FIRST);
      const second = await requestWithRun(tx, ids.projectA, 'Second request', SECOND, 90);
      const open = await requestWithRun(tx, ids.projectA, 'Open request');

      await asPerson(tx, founderA);
      const forFounder = await listProjectRuns(tx.client, ids.projectA, 100);
      const byId = new Map(forFounder.map((row) => [row.id, row]));
      expect(byId.get(first.run)).toMatchObject({
        task_id: first.task,
        task_title: 'First request',
        agent_code: 'KOR-1',
        agent_name: 'Ofis Koordinatörü',
        status: 'completed',
        error_code: null,
        duration_ms: '42000',
        input_tokens: 900,
        output_tokens: 120,
        cache_write_tokens: 30,
        cache_read_tokens: 4000,
        cost_usd: '0.012345',
      });
      expect(byId.get(second.run)).toMatchObject({
        task_title: 'Second request',
        duration_ms: '90000',
        input_tokens: 5000,
        cost_usd: '0.400000',
      });
      // A run that is still open: no end, no duration, and the numbers it has so far.
      expect(byId.get(open.run)).toMatchObject({
        task_title: 'Open request',
        status: 'running',
        finished_at: null,
        duration_ms: null,
        input_tokens: 0,
        cost_usd: '0.000000',
      });
      // The fixtures' own run of the project is on a task between people, not on a request: the
      // row is listed and names no request.
      expect(byId.get(ids.runAProject)).toMatchObject({
        task_id: ids.taskAProject,
        task_title: null,
        status: 'running',
      });
      expect(forFounder).toHaveLength(4);
      expect(byId.get(first.run)?.started_at).toBeInstanceOf(Date);
      expect(byId.get(first.run)?.finished_at).toBeInstanceOf(Date);

      // employeeA is a plain member of the project: the same rows, and no number of the five.
      await tx.setContext(employeeA);
      const forMember = await listProjectRuns(tx.client, ids.projectA, 100);
      expect(forMember.map((row) => row.id)).toEqual(forFounder.map((row) => row.id));
      for (const row of forMember) {
        expect(row).toMatchObject({
          input_tokens: null,
          output_tokens: null,
          cache_write_tokens: null,
          cache_read_tokens: null,
          cost_usd: null,
        });
      }
      const without = (rows: object[]) =>
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([name]) => !/_tokens$|^cost_usd$/.test(name)),
          ),
        );
      expect(without(forMember)).toEqual(without(forFounder));
      // (The token counts are checked field by field above: a short number can stand in an id.)
      for (const cost of ['0.012345', '0.400000']) {
        expect(JSON.stringify(forMember)).not.toContain(cost);
      }
    });
  });

  it('listProjectRuns: newest first, cut at the limit, only runs of that project', async () => {
    await inAdminTransaction(async (tx) => {
      const oldest = await requestWithRun(tx, ids.projectA, 'Oldest', FIRST);
      const middle = await requestWithRun(tx, ids.projectA, 'Middle', FIRST);
      const newest = await requestWithRun(tx, ids.projectA, 'Newest');
      // A run of a request without a project, and the runs of the other company.
      const outside = await requestWithRun(tx, null, 'Without a project', SECOND);
      await startedAgo(tx, oldest.run, 30);
      await startedAgo(tx, ids.runAProject, 20);
      await startedAgo(tx, middle.run, 10);

      await asPerson(tx, founderA);
      const all = await listProjectRuns(tx.client, ids.projectA, 100);
      expect(all.map((row) => row.id)).toEqual([
        newest.run,
        middle.run,
        ids.runAProject,
        oldest.run,
      ]);
      expect(all.map((row) => row.id)).not.toContain(outside.run);
      expect(all.map((row) => row.id)).not.toContain(ids.runA);
      expect((await listProjectRuns(tx.client, ids.projectA, 2)).map((row) => row.id)).toEqual([
        newest.run,
        middle.run,
      ]);
      expect(await listProjectRuns(tx.client, ids.projectA, 0)).toEqual([]);
      // A project without a run, a project of the other company, an id nobody has.
      expect(await listProjectRuns(tx.client, ids.projectANoAi, 100)).toEqual([]);
      expect(await listProjectRuns(tx.client, ids.projectP, 100)).toEqual([]);
      expect(await listProjectRuns(tx.client, randomUUID(), 100)).toEqual([]);
      // Two runs that started at the same moment keep one order (the id decides).
      const again = await listProjectRuns(tx.client, ids.projectA, 100);
      expect(again.map((row) => row.id)).toEqual(all.map((row) => row.id));
    });
  });

  it("listProjectRuns: nothing for an employee who is no member, an appointed approver who is no member, an external person and the other company's founder", async () => {
    await inAdminTransaction(async (tx) => {
      await requestWithRun(tx, ids.projectA, 'A request', FIRST);
      // approverA holds the approval right in Arma DX and is a member of no project.
      const strangers: ContextInput[] = [
        approverA,
        { companyId: ids.arma, userId: ids.sharedEmployee },
        externalA,
        founderP,
        employeeP,
        ...NOBODY,
      ];
      for (const context of strangers) {
        await asPerson(tx, context);
        expect(
          await listProjectRuns(tx.client, ids.projectA, 100),
          JSON.stringify(context),
        ).toEqual([]);
        expect(
          (await projectRunTotals(tx.client, ids.projectA)).run_count,
          JSON.stringify(context),
        ).toBe(0);
      }
      // The founder of Pillika reads the runs of Pillika's project and none of Arma DX's.
      await asPerson(tx, founderP);
      expect(await listProjectRuns(tx.client, ids.projectP, 100)).toEqual([]);
      expect(await projectRunTotals(tx.client, ids.projectA)).toMatchObject({
        run_count: 0,
        cost_usd: '0',
      });
    });
  });

  it('projectRunTotals: the count for a member, the count and the sums for the founder, over all runs and not only the listed ones', async () => {
    await inAdminTransaction(async (tx) => {
      await requestWithRun(tx, ids.projectA, 'First request', FIRST);
      await requestWithRun(tx, ids.projectA, 'Second request', SECOND);
      await requestWithRun(tx, ids.projectA, 'Open request');
      // Not of this project: counted nowhere.
      await requestWithRun(tx, null, 'Without a project', SECOND);

      await asPerson(tx, founderA);
      // Four runs with the fixtures' own; the list was cut at one, the totals were not.
      expect(await listProjectRuns(tx.client, ids.projectA, 1)).toHaveLength(1);
      expect(await projectRunTotals(tx.client, ids.projectA)).toEqual({
        run_count: 4,
        cost_usd: '0.412345',
        input_tokens: '5900',
        output_tokens: '2220',
        cache_write_tokens: '30',
        cache_read_tokens: '4100',
      });
      await tx.setContext(employeeA);
      expect(await projectRunTotals(tx.client, ids.projectA)).toEqual({
        run_count: 4,
        cost_usd: null,
        input_tokens: null,
        output_tokens: null,
        cache_write_tokens: null,
        cache_read_tokens: null,
      });
      // A project without a run: zero, not nothing.
      await tx.setContext(founderA);
      expect(await projectRunTotals(tx.client, ids.projectANoAi)).toEqual({
        run_count: 0,
        cost_usd: '0',
        input_tokens: '0',
        output_tokens: '0',
        cache_write_tokens: '0',
        cache_read_tokens: '0',
      });
    });
  });

  it("listProjectRuns: no column of the row is a run's summary, input or output", async () => {
    await inAdminTransaction(async (tx) => {
      const { run } = await requestWithRun(tx, ids.projectA, 'A request', FIRST);
      // The words are on the run row ...
      await asRole(tx, null);
      expect(
        await tx.rows('select summary, output, input from office.runs where id = $1', [run]),
      ).toEqual([{ summary: MARKER, output: { final_text: MARKER }, input: { note: MARKER } }]);
      // ... and in no row of the list, for the founder either.
      for (const context of [founderA, employeeA]) {
        await asPerson(tx, context);
        const rows = await listProjectRuns(tx.client, ids.projectA, 100);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(Object.keys(row).sort()).toEqual(COLUMNS);
        }
        expect(JSON.stringify(rows)).not.toContain(MARKER);
        expect(Object.keys(await projectRunTotals(tx.client, ids.projectA)).sort()).toEqual([
          'cache_read_tokens',
          'cache_write_tokens',
          'cost_usd',
          'input_tokens',
          'output_tokens',
          'run_count',
        ]);
      }
    });
  });
});

// Step 3 of the Projects section (8 October decision 17): the results of a project's requests, as
// the unit's approver decided them or as they wait. Who reads which result is the row policy of
// approvals (docs/SONRA.md V-c); these tests show that the statement keeps to it and carries
// nothing an agent wrote. One privileged transaction per case, as for the runs above.
describe.skipIf(noDatabase)('statements of the approvals of a project', () => {
  afterAll(closePools);

  const MARKER = 'WHAT-THE-AGENT-WROTE';
  const OPEN = `insert into office.tasks (company_id, project_id, kind, title, description)
    values (office.ctx_company_id(), $1, 'request', $2, 'What is wanted') returning id`;
  const TO_KOR = JSON.stringify([{ unit: 'KOR', agent: 'KOR-1', reason: 'By a person' }]);
  const ADD_MEMBER =
    'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)';
  // An employee of Arma DX who is a member of no project and holds no approval right.
  // (approverA, of the file's head, holds the right and is a member of no project either.)
  const sharedA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };

  async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
    await asRole(tx, 'app');
    await tx.setContext(context);
  }

  /**
   * A request of the employee in that project (or in none), given to KOR-1 by the founder, with a
   * result KOR-1 submitted from a run in the request's own context. The result carries an
   * agent's words in every field that can hold them.
   */
  async function submitted(
    tx: Tx,
    title: string,
    project: string | null = ids.projectA,
  ): Promise<{ task: string; approval: string }> {
    await asPerson(tx, employeeA);
    const [task] = await tx.rows<{ id: string }>(OPEN, [project, title]);
    if (!task) {
      throw new Error('The request was not written');
    }
    await tx.setContext(founderA);
    await tx.exec('select office.correct_routing($1, $2::jsonb)', [task.id, TO_KOR]);
    await asRole(tx, 'worker');
    await tx.setContext({ ...employeeA, agentCode: 'KOR-1', projectId: project });
    const [run] = await tx.rows<{ id: string }>(
      `insert into office.runs
         (company_id, task_id, agent_code, card_version_id, trigger_type, model)
       values (office.ctx_company_id(), $1, 'KOR-1', $2, 'handoff', 'test-model') returning id`,
      [task.id, ids.cardKor],
    );
    const [approval] = await tx.rows<{ id: string }>(
      `insert into office.approvals (company_id, task_id, run_id, agent_code, title, summary,
         agent_rationale, risk_note, payload, basis_type, basis_id, basis_version, involves_money,
         goes_external)
       values (office.ctx_company_id(), $1, $2, 'KOR-1', $3, $3, $3, $3, $4::jsonb, 'task', $1,
         (select version from office.tasks where id = $1), false, false) returning id`,
      [task.id, run?.id, MARKER, JSON.stringify({ text: MARKER })],
    );
    await tx.exec(
      `update office.runs set status = 'completed', finished_at = now() where id = $1`,
      [run?.id],
    );
    if (!approval) {
      throw new Error('The result was not written');
    }
    return { task: task.id, approval: approval.id };
  }

  /** The founder decides a result. */
  async function decide(tx: Tx, approval: string, status: string): Promise<void> {
    await asPerson(tx, founderA);
    expect(
      await tx.exec(
        status === 'approved'
          ? `update office.approvals set status = 'approved' where id = $1`
          : `update office.approvals set status = '${status}', rejection_reason = 'other',
               decision_reason = 'Not this' where id = $1`,
        [approval],
      ),
    ).toBe(1);
  }

  /** The approval right holder approverA becomes a member of projectA. */
  async function approverJoins(tx: Tx): Promise<void> {
    await asPerson(tx, founderA);
    await tx.exec(ADD_MEMBER, [ids.arma, ids.projectA, ids.approverA]);
  }

  /** Moves the moment of a decision (or of a submission) into the past: see startedAgo above. */
  async function momentAgo(
    tx: Tx,
    approval: string,
    column: 'decided_at' | 'created_at' | 'invalidated_at',
    minutes: number,
  ): Promise<void> {
    await asRole(tx, null);
    await tx.exec(`set local session_replication_role = 'replica'`);
    await tx.exec(
      `update office.approvals set ${column} = now() - make_interval(mins => $2) where id = $1`,
      [approval, minutes],
    );
    await tx.exec(`set local session_replication_role = 'origin'`);
  }

  async function listedBy(tx: Tx, context: ContextInput): Promise<string[]> {
    await asPerson(tx, context);
    return (await listProjectApprovals(tx.client, ids.projectA, 100)).map((row) => row.id);
  }

  const STRANGERS: ContextInput[] = [
    // An employee who is no member; the same with the approval right.
    sharedA,
    approverA,
    externalA,
    founderP,
    employeeP,
  ];

  it('listProjectApprovals: a waiting result is a row for the founder and for a member who holds the approval right, and for no other member', async () => {
    await inAdminTransaction(async (tx) => {
      const { task, approval } = await submitted(tx, 'A waiting result');
      await asPerson(tx, founderA);
      expect(await listProjectApprovals(tx.client, ids.projectA, 100)).toEqual([
        {
          id: approval,
          task_id: task,
          task_title: 'A waiting result',
          agent_code: 'KOR-1',
          agent_name: 'Ofis Koordinatörü',
          status: 'pending',
          invalidated_at: null,
          attempt: 1,
          created_at: expect.any(Date) as Date,
          decided_at: null,
          decided_by_user_id: null,
        },
      ]);
      // employeeA is the requester and a plain member, without the approval right: no row.
      expect(await listedBy(tx, employeeA)).toEqual([]);
      // approverA holds the right and is no member of the project: no row either.
      for (const context of STRANGERS) {
        expect(await listedBy(tx, context), JSON.stringify(context)).toEqual([]);
      }
      // As a member of the project the same person reads the waiting result.
      await approverJoins(tx);
      expect(await listedBy(tx, approverA)).toEqual([approval]);
      expect(await listedBy(tx, employeeA)).toEqual([]);
    });
  });

  it('listProjectApprovals: an approved result is a row for every reader of the project', async () => {
    await inAdminTransaction(async (tx) => {
      const { task, approval } = await submitted(tx, 'An approved result');
      await decide(tx, approval, 'approved');
      await approverJoins(tx);
      for (const context of [founderA, employeeA, approverA]) {
        await asPerson(tx, context);
        expect(
          await listProjectApprovals(tx.client, ids.projectA, 100),
          context.userId ?? '',
        ).toMatchObject([
          {
            id: approval,
            task_id: task,
            task_title: 'An approved result',
            status: 'approved',
            invalidated_at: null,
            decided_by_user_id: ids.founder,
          },
        ]);
      }
      // Approved or not: nobody who cannot read the project reads its results.
      for (const context of [sharedA, externalA, founderP, employeeP, ...NOBODY]) {
        expect(await listedBy(tx, context), JSON.stringify(context)).toEqual([]);
      }
    });
  });

  it('listProjectApprovals: a rejected and a sent back result stay hidden from a member without the right', async () => {
    await inAdminTransaction(async (tx) => {
      const rejected = await submitted(tx, 'A rejected result');
      const sentBack = await submitted(tx, 'A result that was sent back');
      // A result that waited when a person routed the request again: closed without a decision.
      const closed = await submitted(tx, 'A result that was closed');
      await decide(tx, rejected.approval, 'rejected');
      await decide(tx, sentBack.approval, 'changes_requested');
      await asPerson(tx, founderA);
      await tx.exec('select office.correct_routing($1, $2::jsonb)', [closed.task, TO_KOR]);
      await approverJoins(tx);

      for (const context of [founderA, approverA]) {
        await asPerson(tx, context);
        const rows = await listProjectApprovals(tx.client, ids.projectA, 100);
        const byId = new Map(rows.map((row) => [row.id, row]));
        expect(rows, context.userId ?? '').toHaveLength(3);
        expect(byId.get(rejected.approval)).toMatchObject({
          status: 'rejected',
          decided_by_user_id: ids.founder,
        });
        expect(byId.get(sentBack.approval)).toMatchObject({
          status: 'changes_requested',
          decided_by_user_id: ids.founder,
        });
        // Still "pending" in the record, with the moment it was closed.
        expect(byId.get(closed.approval)).toMatchObject({
          status: 'pending',
          decided_at: null,
          decided_by_user_id: null,
        });
        expect(byId.get(closed.approval)?.invalidated_at).toBeInstanceOf(Date);
      }
      // The requester, a plain member without the right, reads none of the three.
      expect(await listedBy(tx, employeeA)).toEqual([]);
      for (const context of STRANGERS.filter((stranger) => stranger !== approverA)) {
        expect(await listedBy(tx, context), JSON.stringify(context)).toEqual([]);
      }
    });
  });

  it('listProjectApprovals: waiting ones first, then the newest decision; only results of requests of that project', async () => {
    await inAdminTransaction(async (tx) => {
      const older = await submitted(tx, 'Decided long ago');
      const newer = await submitted(tx, 'Decided just now');
      const closed = await submitted(tx, 'Closed in between');
      const waitsLong = await submitted(tx, 'Waits since long');
      const waits = await submitted(tx, 'Waits since now');
      // Not of this project: a result of a request without a project.
      const outside = await submitted(tx, 'Without a project', null);
      await decide(tx, older.approval, 'approved');
      await decide(tx, newer.approval, 'approved');
      await asPerson(tx, founderA);
      await tx.exec('select office.correct_routing($1, $2::jsonb)', [closed.task, TO_KOR]);
      await momentAgo(tx, older.approval, 'decided_at', 60);
      await momentAgo(tx, closed.approval, 'invalidated_at', 30);
      await momentAgo(tx, newer.approval, 'decided_at', 5);
      await momentAgo(tx, waitsLong.approval, 'created_at', 600);
      await momentAgo(tx, waits.approval, 'created_at', 1);

      const all = await listedBy(tx, founderA);
      // The two that wait come first (the one submitted last on top), then what was decided or
      // closed, the latest first: a result that waits for days still stands above them.
      expect(all).toEqual([
        waits.approval,
        waitsLong.approval,
        newer.approval,
        closed.approval,
        older.approval,
      ]);
      expect(all).not.toContain(outside.approval);
      // The fixtures' own approvals: one on a task between people in this project (no result of
      // a request), one result of a request without a project.
      expect(all).not.toContain(ids.approvalAProject);
      expect(all).not.toContain(ids.requestApprovalA);
      // Cut at the limit, from the top.
      expect((await listProjectApprovals(tx.client, ids.projectA, 3)).map((row) => row.id)).toEqual(
        [waits.approval, waitsLong.approval, newer.approval],
      );
      expect(await listProjectApprovals(tx.client, ids.projectANoAi, 100)).toEqual([]);
      expect(await listProjectApprovals(tx.client, ids.projectP, 100)).toEqual([]);
      expect(await listProjectApprovals(tx.client, randomUUID(), 100)).toEqual([]);
    });
  });

  it("listProjectApprovals: no column of the row is the approval's title, summary, reasoning, risk note or payload", async () => {
    await inAdminTransaction(async (tx) => {
      const { approval } = await submitted(tx, 'A request');
      // The words are on the approval row ...
      await asRole(tx, null);
      expect(
        await tx.rows(
          `select title, summary, agent_rationale, risk_note, payload from office.approvals
           where id = $1`,
          [approval],
        ),
      ).toEqual([
        {
          title: MARKER,
          summary: MARKER,
          agent_rationale: MARKER,
          risk_note: MARKER,
          payload: { text: MARKER },
        },
      ]);
      // ... and in no row of the list, waiting or approved, for the founder either.
      for (const step of ['waiting', 'approved']) {
        if (step === 'approved') {
          await decide(tx, approval, 'approved');
        }
        for (const context of step === 'approved' ? [founderA, employeeA] : [founderA]) {
          await asPerson(tx, context);
          const rows = await listProjectApprovals(tx.client, ids.projectA, 100);
          expect(rows).toHaveLength(1);
          for (const row of rows) {
            expect(Object.keys(row).sort()).toEqual([
              'agent_code',
              'agent_name',
              'attempt',
              'created_at',
              'decided_at',
              'decided_by_user_id',
              'id',
              'invalidated_at',
              'status',
              'task_id',
              'task_title',
            ]);
          }
          expect(JSON.stringify(rows)).not.toContain(MARKER);
          // Nor a person's words about the result.
          expect(JSON.stringify(rows)).not.toContain('Not this');
        }
      }
    });
  });

  it('readerSeesUndecided: true for the founder and for an employee with the approval right', async () => {
    await inTransaction(async (tx) => {
      for (const context of [founderA, approverA, founderP]) {
        await tx.setContext(context);
        expect(await readerSeesUndecided(tx.client), context.userId ?? '').toBe(true);
      }
      // An employee without the right, an external person, an employee of the other company
      // here, and nobody at all.
      for (const context of [
        employeeA,
        sharedA,
        externalA,
        employeeP,
        { companyId: ids.arma, userId: ids.employeeP },
        ...NOBODY,
      ]) {
        await tx.setContext(context);
        expect(await readerSeesUndecided(tx.client), JSON.stringify(context)).toBe(false);
      }
    });
  });

  it('listProjectApprovals: nothing in the context of Pillika, nothing for an external person and nothing without a context', async () => {
    await inAdminTransaction(async (tx) => {
      const waiting = await submitted(tx, 'A waiting result');
      const approved = await submitted(tx, 'An approved result');
      await decide(tx, approved.approval, 'approved');
      expect(await listedBy(tx, founderA)).toEqual([waiting.approval, approved.approval]);
      const others: ContextInput[] = [
        founderP,
        employeeP,
        { ...founderP, projectId: ids.projectA },
        externalA,
        ...NOBODY,
        { projectId: ids.projectA },
      ];
      for (const context of others) {
        expect(await listedBy(tx, context), JSON.stringify(context)).toEqual([]);
      }
      // The worker's role in the context of Pillika reads none of them either.
      await asRole(tx, 'worker');
      for (const context of [
        { companyId: ids.pillika, userId: ids.founder, agentCode: 'KOR-1' },
        {
          companyId: ids.pillika,
          userId: ids.founder,
          agentCode: 'KOR-1',
          projectId: ids.projectA,
        },
      ]) {
        await tx.setContext(context);
        expect(await listProjectApprovals(tx.client, ids.projectA, 100)).toEqual([]);
      }
      // And the other way round: nothing of Pillika's project in the context of Arma DX.
      await asPerson(tx, founderA);
      expect(await listProjectApprovals(tx.client, ids.projectP, 100)).toEqual([]);
    });
  });
});

// Step 3 of the Projects section (8 October decision 17): the AI spending limit. Every reader of
// a project is told whether it is reached; the limit and the sum are the founder's.
describe.skipIf(noDatabase)('statements of the AI spending limit', () => {
  afterAll(closePools);

  const sharedA: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };

  async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
    await asRole(tx, 'app');
    await tx.setContext(context);
  }

  /** An administrator writes the limit and what the fixtures' own run of project A has cost. */
  async function projectAt(tx: Tx, limit: string | null, spent: string): Promise<void> {
    await asRole(tx, null);
    await tx.setContext({});
    await tx.exec('update office.runs set cost_usd = $2::numeric where id = $1', [
      ids.runAProject,
      spent,
    ]);
    await tx.exec('update office.projects set ai_spend_limit_usd = $2::numeric where id = $1', [
      ids.projectA,
      limit,
    ]);
  }

  it('readProject: spending_limit_reached for every reader', async () => {
    await inAdminTransaction(async (tx) => {
      const cases: [string | null, boolean][] = [
        [null, false],
        ['1.26', false],
        ['1.25', true],
        ['0.50', true],
      ];
      for (const [limit, reached] of cases) {
        await projectAt(tx, limit, '1.25');
        // The founder, who is no member, and a plain member: the same yes or no.
        for (const context of [founderA, employeeA]) {
          await asPerson(tx, context);
          const row = await readProject(tx.client, ids.projectA);
          expect(row?.spending_limit_reached, `${String(limit)} ${context.userId ?? ''}`).toBe(
            reached,
          );
          const listed = (await listProjects(tx.client, 100)).find(
            (candidate) => candidate.id === ids.projectA,
          );
          expect(listed?.spending_limit_reached).toBe(reached);
          // A yes or a no: neither the limit nor the sum is a column of the row.
          const columns = Object.keys(row ?? {});
          expect(columns).toContain('spending_limit_reached');
          expect(columns.filter((name) => /limit_usd|spent|cost/.test(name))).toEqual([]);
        }
        // Another project of the reader is not touched by this one's limit.
        await asPerson(tx, employeeA);
        expect((await readProject(tx.client, ids.projectANoAi))?.spending_limit_reached).toBe(
          false,
        );
        // Who cannot read the project gets no row at all, as before.
        for (const context of [approverA, sharedA, externalA, founderP, ...NOBODY]) {
          await asPerson(tx, context);
          expect(await readProject(tx.client, ids.projectA), JSON.stringify(context)).toBeNull();
        }
      }
    });
  });

  it('readProjectAiSpending: the limit and the sum for the founder, nothing for a member', async () => {
    await inAdminTransaction(async (tx) => {
      // No limit and nothing spent.
      await asPerson(tx, founderA);
      expect(await readProjectAiSpending(tx.client, ids.projectA)).toEqual({
        limit_usd: null,
        spent_usd: '0.000000',
      });
      // A project without a run.
      expect(await readProjectAiSpending(tx.client, ids.projectANoAi)).toEqual({
        limit_usd: null,
        spent_usd: '0',
      });
      await projectAt(tx, '50', '1.674690');
      await asPerson(tx, founderA);
      expect(await readProjectAiSpending(tx.client, ids.projectA)).toEqual({
        limit_usd: '50.00',
        spent_usd: '1.674690',
      });
      // Nobody else: the owner of the project, a manager, a plain member, an employee who is no
      // member, an external person, the other company's founder, nobody.
      await tx.exec(
        'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)',
        [ids.arma, ids.projectA, ids.approverA],
      );
      await setProjectMemberRole(tx.client, ids.projectA, ids.employeeA, 'owner');
      await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager');
      for (const context of [
        employeeA,
        approverA,
        sharedA,
        externalA,
        founderP,
        employeeP,
        ...NOBODY,
      ]) {
        await asPerson(tx, context);
        expect(
          await readProjectAiSpending(tx.client, ids.projectA),
          JSON.stringify(context),
        ).toBeNull();
      }
      // Not an agent run in the founder's name either, with either role.
      for (const role of ['app', 'worker'] as const) {
        await asRole(tx, role);
        await tx.setContext({ ...founderA, agentCode: 'KOR-1', projectId: ids.projectA });
        expect(await readProjectAiSpending(tx.client, ids.projectA), role).toBeNull();
      }
      // The founder of Arma DX reads nothing of the other company's project, and nothing for an
      // id nobody has.
      await asPerson(tx, founderA);
      expect(await readProjectAiSpending(tx.client, ids.projectP)).toBeNull();
      expect(await readProjectAiSpending(tx.client, randomUUID())).toBeNull();
    });
  });
});
