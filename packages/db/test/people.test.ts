import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { ids } from './fixtures.ts';
import {
  adminQuery,
  closePools,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// The two functions that name people (module M2; rule 9): company_people() for the founder and the
// employees of the context company, people_names(ids) for any member of it. Fixtures: Arma DX has
// the founder, three employees (Çalışan A, Yetkili Çalışan A, Ortak Çalışan) and an external person
// (Mali Müşavir); Pillika has the founder, Çalışan P and an external person (Avukat); Ortak Çalışan
// also works at the other company; Eski Çalışan is a member of no company.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };

const PEOPLE = 'select user_id, name, role, active from office.company_people() order by name';
const NAMES = 'select user_id, name from office.people_names($1) order by name';

const ARMA_PEOPLE = [
  { user_id: ids.founder, name: 'Kurucu', role: 'founder', active: true },
  { user_id: ids.externalA, name: 'Mali Müşavir', role: 'external', active: true },
  { user_id: ids.sharedEmployee, name: 'Ortak Çalışan', role: 'employee', active: true },
  { user_id: ids.approverA, name: 'Yetkili Çalışan A', role: 'employee', active: true },
  { user_id: ids.employeeA, name: 'Çalışan A', role: 'employee', active: true },
];

const EVERYONE = [
  ids.founder,
  ids.employeeA,
  ids.approverA,
  ids.sharedEmployee,
  ids.externalA,
  ids.employeeP,
  ids.externalP,
  ids.otherFounder,
  ids.formerEmployee,
];

function sorted<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

async function people(tx: Tx): Promise<Record<string, unknown>[]> {
  return tx.rows(PEOPLE);
}

describe.skipIf(noDatabase)('names of people', () => {
  afterAll(closePools);

  it('only the API runs the two functions; the worker and the application role cannot', async () => {
    const rows = await adminQuery<{ fn: string; api: boolean; worker: boolean; app: boolean }>(
      `select f as fn,
              has_function_privilege('office_api', f, 'execute') as api,
              has_function_privilege('office_worker', f, 'execute') as worker,
              has_function_privilege('office_app', f, 'execute') as app
       from unnest($1::text[]) f`,
      [['office.company_people()', 'office.people_names(uuid[])']],
    );
    expect(rows).toEqual([
      { fn: 'office.company_people()', api: true, worker: false, app: false },
      { fn: 'office.people_names(uuid[])', api: true, worker: false, app: false },
    ]);
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect((await tx.expectError(PEOPLE)).code).toBe('42501');
      expect((await tx.expectError(NAMES, [[ids.founder]])).code).toBe('42501');
    });
  });

  it('gives the founder and an employee the people of their company, and nobody else', async () => {
    await inTransaction(async (tx) => {
      for (const context of [founderA, employeeA]) {
        await tx.setContext(context);
        expect(sorted(await tx.rows<{ name: string }>(PEOPLE))).toEqual(sorted(ARMA_PEOPLE));
      }
      // Pillika's people for Pillika's employee: nobody of Arma DX but the founder of both.
      await tx.setContext(employeeP);
      expect((await tx.rows<{ name: string }>(PEOPLE)).map((row) => row.name).sort()).toEqual(
        ['Avukat', 'Kurucu', 'Çalışan P'].sort(),
      );
      // An employee still reads no other user row and no other membership directly (rule 9).
      await tx.setContext(employeeA);
      expect(await tx.count('users')).toBe(1);
      expect(await tx.count('memberships')).toBe(1);
    });
  });

  it('gives the team list to nobody else', async () => {
    await inTransaction(async (tx) => {
      const nobody: [string, ContextInput][] = [
        ['an external person', externalA],
        ['a member of another company', { companyId: ids.arma, userId: ids.employeeP }],
        ['a person without a membership', { companyId: ids.arma, userId: ids.formerEmployee }],
        ['no company', { userId: ids.founder }],
        ['no person', { companyId: ids.arma }],
        ['no context', {}],
        ['an agent run', { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' }],
      ];
      for (const [who, context] of nobody) {
        await tx.setContext(context);
        expect(await people(tx), who).toEqual([]);
      }
    });
  });

  it('does not name people for a deactivated account', async () => {
    await inTransaction(async (tx) => {
      // The founder deactivates the account (a membership change: needs the passkey step).
      await stepUp(tx, founderA, 'membership_change', ids.employeeA);
      await tx.exec('update office.users set active = false where id = $1', [ids.employeeA]);
      await tx.setContext(employeeA);
      expect(await people(tx)).toEqual([]);
      expect(await tx.rows(NAMES, [EVERYONE])).toEqual([]);
      // The others see the deactivated colleague marked as such, so that nobody assigns to them.
      await tx.setContext(founderA);
      expect(
        await tx.rows('select active from office.company_people() where user_id = $1', [
          ids.employeeA,
        ]),
      ).toEqual([{ active: false }]);
    });
  });

  it('names only members of the context company among the given ids', async () => {
    await inTransaction(async (tx) => {
      const armaNames = sorted([
        { user_id: ids.founder, name: 'Kurucu' },
        { user_id: ids.externalA, name: 'Mali Müşavir' },
        { user_id: ids.sharedEmployee, name: 'Ortak Çalışan' },
        { user_id: ids.approverA, name: 'Yetkili Çalışan A' },
        { user_id: ids.employeeA, name: 'Çalışan A' },
      ]);
      // The same answer for an employee and for an external person of the company: Pillika's
      // people, the other company's founder and the person who left are not named.
      for (const context of [employeeA, externalA, founderA]) {
        await tx.setContext(context);
        expect(sorted(await tx.rows<{ name: string }>(NAMES, [EVERYONE]))).toEqual(armaNames);
        expect(await tx.rows(NAMES, [[ids.employeeP, ids.formerEmployee]])).toEqual([]);
        expect(await tx.rows(NAMES, [[]])).toEqual([]);
        expect(await tx.rows(NAMES, [null])).toEqual([]);
      }
      await tx.setContext(employeeP);
      expect(await tx.rows(NAMES, [[ids.employeeA, ids.employeeP]])).toEqual([
        { user_id: ids.employeeP, name: 'Çalışan P' },
      ]);
    });
  });

  it('names nobody without a membership, without a company or in an agent run', async () => {
    await inTransaction(async (tx) => {
      const nobody: [string, ContextInput][] = [
        ['a member of another company', { companyId: ids.arma, userId: ids.employeeP }],
        ['a person without a membership', { companyId: ids.arma, userId: ids.formerEmployee }],
        ['no company', { userId: ids.founder }],
        ['no person', { companyId: ids.arma }],
        ['no context', {}],
        ['an agent run', { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' }],
      ];
      for (const [who, context] of nobody) {
        await tx.setContext(context);
        expect(await tx.rows(NAMES, [EVERYONE]), who).toEqual([]);
      }
    });
  });

  it('returns names and roles only: no address, no approval right', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const [row] = await tx.rows('select * from office.company_people() limit 1');
      expect(Object.keys(row ?? {}).sort()).toEqual(['active', 'name', 'role', 'user_id']);
      const [name] = await tx.rows('select * from office.people_names($1)', [[ids.founder]]);
      expect(Object.keys(name ?? {}).sort()).toEqual(['name', 'user_id']);
    });
  });
});
