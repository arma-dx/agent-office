import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import {
  addProjectMember,
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
  setCustomerPermissions,
  setProjectAiPermission,
  setProjectMemberRole,
  updateProject,
  type NewProject,
} from '../src/projects.ts';
import { ids } from './fixtures.ts';
import { closePools, inTransaction, noDatabase, type Tx } from './helpers.ts';
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

  it('setProjectAiPermission and readCompanyKind: the function call with the customer the founder saw; the kind of the context company', async () => {
    await inTransaction(async (tx) => {
      await stepUp(tx, founderA, 'project_ai_permission', ids.projectANoAi);
      await setProjectAiPermission(tx.client, ids.projectANoAi, true, null);
      expect((await readProject(tx.client, ids.projectANoAi))?.ai_allowed).toBe(true);
      await setProjectAiPermission(tx.client, ids.projectANoAi, false, null);
      expect((await readProject(tx.client, ids.projectANoAi))?.ai_allowed).toBe(false);

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
