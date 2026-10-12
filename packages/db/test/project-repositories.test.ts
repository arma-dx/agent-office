import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { REPOSITORY, ids } from './fixtures.ts';
import {
  asRole,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';

// The repository of a project (8 October decision 19; 12 October decision 17). One row per
// project that has one: GitHub's number of the repository, the name it had, the connection of
// the same company it came through. Read like the project; linked and unlinked by the founder,
// the owner and the managers, through the API's role only; never rewritten. Linking needs the
// company's open connection and rule 12 (docs/SONRA.md P-s).
//
// The fixtures: both companies are connected; project A (Arma DX) and project P (Pillika) have a
// repository; employeeA is a plain member of project A and of the project without AI permission
// (which has no customer); nobody is a member of the project whose customer has no AI permission.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
// An employee of Arma DX who is a member of no project.
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };

const FREE = ids.projectANoAi;
const LINK = `insert into office.project_repositories
    (company_id, project_id, integration_id, repository_id, full_name)
  values ($1, $2, $3, $4, $5)`;
const UNLINK = 'delete from office.project_repositories where project_id = $1';
const ALLOWED = 'select office.project_code_processing_allowed($1) as allowed';

function link(
  project: string,
  repositoryId = 778,
  fullName = 'arma-org/other',
  company: string = ids.arma,
  integration: string = ids.githubA,
): unknown[] {
  return [company, project, integration, repositoryId, fullName];
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

async function makeManager(tx: Tx, project: string, user: string): Promise<void> {
  await asAdministrator(tx);
  expect(
    await tx.exec(
      `update office.project_members set role = 'manager' where project_id = $1 and user_id = $2`,
      [project, user],
    ),
  ).toBe(1);
}

interface RepositoryRow {
  project_id: string;
  repository_id: string;
  full_name: string;
  integration_id: string;
  linked_by_user_id: string | null;
}

async function repositories(tx: Tx): Promise<RepositoryRow[]> {
  return tx.rows<RepositoryRow>(
    `select project_id, repository_id, full_name, integration_id, linked_by_user_id
     from office.project_repositories order by full_name`,
  );
}

async function allowed(tx: Tx, project: string): Promise<boolean | undefined> {
  const [row] = await tx.rows<{ allowed: boolean }>(ALLOWED, [project]);
  return row?.allowed;
}

/** The highest audit id inside the open transaction. */
async function auditMarkIn(tx: Tx): Promise<string> {
  const [row] = await tx.rows<{ mark: string }>(
    'select coalesce(max(id), 0)::text as mark from office.audit_log',
  );
  return row?.mark ?? '0';
}

describe.skipIf(noDatabase)('who links a repository to a project', () => {
  afterAll(closePools);

  it('link: the founder, the owner and the managers; the row says who and when', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      expect(await tx.exec(LINK, link(FREE))).toBe(1);
      const [row] = await tx.rows<{ by: string; just_now: boolean }>(
        `select linked_by_user_id as by, linked_at = now() as just_now
         from office.project_repositories where project_id = $1`,
        [FREE],
      );
      expect(row).toEqual({ by: ids.founder, just_now: true });
      expect(await tx.exec(UNLINK, [FREE])).toBe(1);

      // A plain member neither links nor unlinks.
      await tx.setContext(employeeA);
      expect((await tx.expectError(LINK, link(FREE))).code).toBe('42501');
      expect(await tx.exec(UNLINK, [ids.projectA])).toBe(0);
      // An employee who is no member does not even see the project's row.
      // (The trigger answers before the policy: for somebody who is no member the rule 12
      // function says no.)
      await tx.setContext(approverA);
      expect((await tx.expectError(LINK, link(FREE))).code).toMatch(/^(42501|55000)$/);
      expect(await tx.exec(UNLINK, [ids.projectA])).toBe(0);
      expect(await repositories(tx)).toEqual([]);

      for (const role of ['manager', 'owner']) {
        await asAdministrator(tx);
        await tx.exec(
          `update office.project_members set role = $3 where project_id = $1 and user_id = $2`,
          [FREE, ids.employeeA, role],
        );
        await asPerson(tx, employeeA);
        expect(await tx.exec(LINK, link(FREE)), role).toBe(1);
        expect((await repositories(tx)).find((r) => r.project_id === FREE)).toMatchObject({
          repository_id: '778',
          full_name: 'arma-org/other',
          integration_id: ids.githubA,
          linked_by_user_id: ids.employeeA,
        });
        expect(await tx.exec(UNLINK, [FREE]), role).toBe(1);
        // A manager of one project is nobody in another.
        expect(await tx.exec(UNLINK, [ids.projectA]), role).toBe(0);
      }
      await asAdministrator(tx);
      expect(await tx.count('project_repositories', 'project_id = $1', [ids.projectA])).toBe(1);
    });
  });

  it('link: whoever opens a project is its owner and links in the same transaction', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      // The id comes from the API: the opener reads the project only once the trigger has made
      // them its owner.
      const project = { id: randomUUID() };
      await tx.exec(
        `insert into office.projects (id, company_id, name)
         values ($1, $2, 'Opened with a repository')`,
        [project.id, ids.arma],
      );
      expect(await tx.exec(LINK, link(project.id))).toBe(1);
      expect((await repositories(tx)).find((row) => row.project_id === project.id)).toMatchObject({
        linked_by_user_id: ids.employeeA,
        repository_id: '778',
      });
    });
  });

  it('link: an external person is no manager and links nothing', async () => {
    await inAdminTransaction(async (tx) => {
      await asAdministrator(tx);
      // The database keeps an external person out of the project's members.
      expect(
        (
          await tx.expectError(
            `insert into office.project_members (company_id, project_id, user_id, role)
             values ($1, $2, $3, 'manager')`,
            [ids.arma, FREE, ids.externalA],
          )
        ).code,
      ).toBe('23514');
      await asPerson(tx, externalA);
      expect((await tx.expectError(LINK, link(FREE))).code).toMatch(/^(42501|23514)$/);
      expect(await tx.exec(UNLINK, [ids.projectA])).toBe(0);
      expect(await repositories(tx)).toEqual([]);
    });
  });

  it('link: one repository per project, and the same repository on several projects', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const second = await tx.expectError(LINK, link(ids.projectA));
      expect(second.code).toBe('23505');
      // The repository of project A on a second project.
      expect(await tx.exec(LINK, link(FREE, REPOSITORY.arma.id, REPOSITORY.arma.fullName))).toBe(1);
      expect((await repositories(tx)).map((row) => row.repository_id)).toEqual(['777', '777']);
    });
  });

  it('link: nobody rewrites a row, and nobody names who linked', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const sql of [
        'update office.project_repositories set repository_id = 1 where project_id = $1',
        `update office.project_repositories set full_name = 'arma-org/x' where project_id = $1`,
        'update office.project_repositories set linked_at = now() where project_id = $1',
      ]) {
        expect((await tx.expectError(sql, [ids.projectA])).code, sql).toBe('42501');
      }
      expect(
        (
          await tx.expectError(
            `insert into office.project_repositories
               (company_id, project_id, integration_id, repository_id, full_name, linked_by_user_id)
             values ($1, $2, $3, 5, 'arma-org/x', $4)`,
            [ids.arma, FREE, ids.githubA, ids.employeeA],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it('link: the name and the number have the shape of a repository', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const name of ['panel', 'arma-org/', 'arma-org/a b', 'arma-org/a/b', '/panel', '']) {
        expect((await tx.expectError(LINK, link(FREE, 5, name))).code, name).toBe('23514');
      }
      for (const number of [0, -1]) {
        expect((await tx.expectError(LINK, link(FREE, number))).code).toBe('23514');
      }
      expect(await tx.exec(LINK, link(FREE, 5, 'Arma-Org/panel.web_2'))).toBe(1);
    });
  });

  it('link: an agent run links nothing and unlinks nothing', async () => {
    await inAdminTransaction(async (tx) => {
      // With the API's role: the policy and the trigger refuse the agent code.
      for (const projectId of [null, FREE]) {
        await asPerson(tx, { ...founderA, agentCode: 'KOR-1', projectId });
        expect((await tx.expectError(LINK, link(FREE))).code).toBe('42501');
      }
      await tx.setContext({ ...founderA, agentCode: 'KOR-1', projectId: ids.projectA });
      expect(await tx.exec(UNLINK, [ids.projectA])).toBe(0);
      // With the worker's role there is no privilege at all.
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1', projectId: FREE }]) {
        await asWorker(tx, context);
        expect((await tx.expectError(LINK, link(FREE))).code).toBe('42501');
        expect((await tx.expectError(UNLINK, [ids.projectA])).code).toBe('42501');
      }
      await asAdministrator(tx);
      expect(await tx.count('project_repositories')).toBe(2);
    });
  });
});

describe.skipIf(noDatabase)('what a repository needs to be linked', () => {
  afterAll(closePools);

  it('connection: the open GitHub connection of the same company', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      // The Google row of the fixtures is no GitHub connection.
      const [google] = await tx.rows<{ id: string }>(
        `select id from office.integrations where provider = 'google'`,
      );
      const other = await tx.expectError(
        LINK,
        link(FREE, 778, 'arma-org/other', ids.arma, google?.id),
      );
      expect(other.code).toBe('23514');
      expect(other.message).toBe(
        "The repository comes through the company's open GitHub connection",
      );

      // Switched off: nothing is linked through it; what is linked stays and can be unlinked.
      await tx.rows('select office.disconnect_github()');
      expect((await tx.expectError(LINK, link(FREE))).code).toBe('23514');
      expect(await repositories(tx)).toMatchObject([{ project_id: ids.projectA }]);
      expect(await tx.exec(UNLINK, [ids.projectA])).toBe(1);
      expect((await tx.expectError(LINK, link(ids.projectA))).code).toBe('23514');
    });
  });

  it('rule 12: a customer who allows neither AI nor automated processing', async () => {
    await inAdminTransaction(async (tx) => {
      const closed = ids.projectACustomerNoAi;
      await asPerson(tx, founderA);
      expect(await allowed(tx, closed)).toBe(false);
      const refused = await tx.expectError(LINK, link(closed));
      expect(refused.code).toBe('55000');
      expect(refused.message).toBe(
        'The customer of this project allows neither AI nor automated processing',
      );
      // A project without a customer, and one whose customer allows AI.
      expect(await allowed(tx, FREE)).toBe(true);
      expect(await allowed(tx, ids.projectA)).toBe(true);

      // The founder marks automated processing for the customer: the project may be linked.
      await asAdministrator(tx);
      await tx.exec(
        'update office.customers set automated_processing_allowed = true where id = $1',
        [ids.customerANoAi],
      );
      await asPerson(tx, founderA);
      expect(await allowed(tx, closed)).toBe(true);
      expect(await tx.exec(LINK, link(closed))).toBe(1);

      // Closed again: the row stays (the API stops reading), and nothing new is linked.
      await asAdministrator(tx);
      await tx.exec(
        'update office.customers set automated_processing_allowed = false where id = $1',
        [ids.customerANoAi],
      );
      await asPerson(tx, founderA);
      expect(await allowed(tx, closed)).toBe(false);
      expect(await tx.count('project_repositories', 'project_id = $1', [closed])).toBe(1);

      // The AI permission of the project itself is not looked at: no model is called.
      await asAdministrator(tx);
      await tx.exec('update office.customers set ai_allowed = false where id = $1', [
        ids.customerA,
      ]);
      await asPerson(tx, founderA);
      expect(await allowed(tx, ids.projectA)).toBe(false);
    });
  });

  it('rule 12: the answer is for the founder and the members of the project only', async () => {
    await inTransaction(async (tx) => {
      const answers: [ContextInput, string, boolean][] = [
        [founderA, ids.projectA, true],
        [employeeA, ids.projectA, true],
        // No member of the project, another company, an external person, nobody.
        [approverA, ids.projectA, false],
        [founderP, ids.projectA, false],
        [employeeP, ids.projectA, false],
        [externalA, ids.projectA, false],
        [{}, ids.projectA, false],
        [founderA, ids.projectP, false],
        [founderP, ids.projectP, true],
      ];
      for (const [context, project, answer] of answers) {
        await tx.setContext(context);
        expect(await allowed(tx, project), JSON.stringify(context)).toBe(answer);
      }
    });
  });
});

describe.skipIf(noDatabase)('the repositories of the two companies', () => {
  afterAll(closePools);

  it('reading: like the project, and never a row of the other company', async () => {
    await inTransaction(async (tx) => {
      const readers: [ContextInput, string[]][] = [
        [founderA, [REPOSITORY.arma.fullName]],
        [employeeA, [REPOSITORY.arma.fullName]],
        [founderP, [REPOSITORY.pillika.fullName]],
        [employeeP, [REPOSITORY.pillika.fullName]],
        [approverA, []],
        [externalA, []],
        [{ companyId: ids.pillika, userId: ids.externalP }, []],
        [{ companyId: ids.arma, userId: ids.employeeP }, []],
        [{ companyId: ids.pillika, userId: ids.employeeA }, []],
        [{ companyId: ids.founderSpace, userId: ids.founder }, []],
        [{ ...founderP, projectId: ids.projectA }, [REPOSITORY.pillika.fullName]],
        [{}, []],
        [{ companyId: ids.arma }, []],
        [{ userId: ids.founder }, []],
      ];
      for (const [context, names] of readers) {
        await tx.setContext(context);
        expect(
          (await repositories(tx)).map((row) => row.full_name),
          JSON.stringify(context),
        ).toEqual(names);
      }
    });
    await inWorkerTransaction(async (tx) => {
      const runs: [ContextInput, string[]][] = [
        // An agent run without a project context reads no project's row.
        [{ ...founderA, agentCode: 'KOR-1' }, []],
        [{ ...founderA, agentCode: 'KOR-1', projectId: ids.projectA }, [REPOSITORY.arma.fullName]],
        [{ ...founderA, agentCode: 'KOR-1', projectId: FREE }, []],
        // Not in the name of somebody who is no member, and never across the companies.
        [{ ...approverA, agentCode: 'KOR-1', projectId: ids.projectA }, []],
        [{ ...founderP, agentCode: 'KOR-1' }, []],
        [{ ...founderP, agentCode: 'KOR-1', projectId: ids.projectA }, []],
      ];
      for (const [context, names] of runs) {
        await tx.setContext(context);
        expect(
          (await repositories(tx)).map((row) => row.full_name),
          JSON.stringify(context),
        ).toEqual(names);
      }
    });
  });

  it('writing: a project of one company never hangs on the connection of the other', async () => {
    await inAdminTransaction(async (tx) => {
      // A person: the connection of the other company cannot even be read.
      await asPerson(tx, founderA);
      expect(
        (await tx.expectError(LINK, link(FREE, 901, 'pillika-org/x', ids.arma, ids.githubP))).code,
      ).toBe('23514');
      await tx.setContext(founderP);
      expect(
        (
          await tx.expectError(
            LINK,
            link(ids.projectP, 902, 'arma-org/x', ids.pillika, ids.githubA),
          )
        ).code,
      ).toMatch(/^(23514|23505)$/);
      // In the context of Pillika nothing of Arma DX is written or removed.
      expect((await tx.expectError(LINK, link(FREE))).code).toMatch(/^(23514|42501)$/);
      expect(await tx.exec(UNLINK, [ids.projectA])).toBe(0);

      // The privileged role too: the foreign key holds the pair.
      await asAdministrator(tx);
      expect(
        (await tx.expectError(LINK, link(FREE, 901, 'pillika-org/x', ids.arma, ids.githubP))).code,
      ).toBe('23503');
      await tx.exec(UNLINK, [ids.projectP]);
      expect(
        (
          await tx.expectError(
            LINK,
            link(ids.projectP, 902, 'arma-org/x', ids.pillika, ids.githubA),
          )
        ).code,
      ).toBe('23503');
      expect(
        (await tx.expectError(LINK, link(ids.projectP, 902, 'arma-org/x', ids.arma, ids.githubA)))
          .code,
      ).toBe('23503');
    });
  });
});

describe.skipIf(noDatabase)('the audit rows of a project repository', () => {
  afterAll(closePools);

  it('linking and unlinking are recorded with the repository number, in the project', async () => {
    await inAdminTransaction(async (tx) => {
      await makeManager(tx, FREE, ids.employeeA);
      const mark = await auditMarkIn(tx);
      await asPerson(tx, employeeA);
      await tx.exec(LINK, link(FREE));
      await tx.exec(UNLINK, [FREE]);
      await tx.setContext(founderA);
      const rows = await tx.rows(
        `select event, company_id, project_id, record_type, record_id, external_ref, user_id
         from office.audit_log where id > $1::bigint order by id`,
        [mark],
      );
      const linked = {
        event: 'project_repository_linked',
        company_id: ids.arma,
        project_id: FREE,
        record_type: 'project',
        record_id: FREE,
        external_ref: 'github:repository:778',
        user_id: ids.employeeA,
      };
      expect(rows).toEqual([linked, { ...linked, event: 'project_repository_unlinked' }]);
      // No name of a repository or of an organisation is in the row.
      expect(JSON.stringify(rows)).not.toContain('arma-org');
      // The other company reads none of them.
      await tx.setContext(founderP);
      expect(
        await tx.count('audit_log', `id > $1::bigint and event ~ '^project_repository_'`, [mark]),
      ).toBe(0);
    });
  });
});
