import { randomUUID } from 'node:crypto';
import { AGENT_READ_TOOL } from '@agent-office/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import {
  deleteProjectFile,
  insertProjectFile,
  listProjectFiles,
  listRunProjectFiles,
  readProjectFile,
  readRunProjectFile,
  type NewProjectFile,
} from '../src/files.ts';
import { addProjectMember, setProjectMemberRole } from '../src/projects.ts';
import { ids } from './fixtures.ts';
import {
  asRole,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  openTransaction,
  untilBlocked,
  type Tx,
} from './helpers.ts';

// Project files in the database (8 October decision 20), with the two restricted roles: who
// reads, adds and deletes; the key the database writes; the fixed types and sizes; the limits of
// a project; the trace. Every test is rolled back.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
// A member of projectA and of projectANoAi.
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
// An employee of Arma DX who is a member of no project.
const approverA: ContextInput = { companyId: ids.arma, userId: ids.approverA };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
const NOBODY: ContextInput[] = [{}, { userId: ids.founder }, { companyId: ids.arma }];
const SHA = 'a'.repeat(64);

function file(fields: Partial<NewProjectFile> = {}): NewProjectFile {
  return {
    id: randomUUID(),
    projectId: ids.projectA,
    name: 'Şartname.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    sha256: SHA,
    ...fields,
  };
}

const RAW = `insert into office.files
    (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256)
  values ($1, office.ctx_company_id(), $2, 'project_file', $3, $4, $5, $6)`;
const raw = (tx: Tx, fields: Partial<NewProjectFile> = {}) => {
  const f = file(fields);
  return tx.expectError(RAW, [f.id, f.projectId, f.name, f.mimeType, f.sizeBytes, f.sha256]);
};
const projectFiles = (tx: Tx) => tx.count('files', `kind = 'project_file'`);
// One small project file under a given id, in a given project of the context company.
const RAW_ID = `insert into office.files (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256)
  values ($1, office.ctx_company_id(), $2, 'project_file', 'a.pdf', 'application/pdf', 5, '${SHA}')`;

describe.skipIf(noDatabase)('project files', () => {
  afterAll(closePools);

  it('a member adds a file: the database writes who, when and the key', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const added = file();
      const row = await insertProjectFile(tx.client, added);
      expect(row).toMatchObject({
        id: added.id,
        project_id: ids.projectA,
        name: 'Şartname.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1000,
        sha256: SHA,
        storage_path: `${ids.arma}/projects/${ids.projectA}/${added.id}`,
        created_by_user_id: ids.employeeA,
        deletable: true,
      });
      // Newest first; the file of the fixtures is older.
      expect((await listProjectFiles(tx.client, ids.projectA)).map((entry) => entry.id)).toEqual([
        added.id,
        ids.projectFileA,
      ]);
      expect(await readProjectFile(tx.client, ids.projectA, added.id)).toEqual(row);
      // Not through another project of the same company the person also reads.
      expect(await readProjectFile(tx.client, ids.projectANoAi, added.id)).toBeNull();
      expect(await listProjectFiles(tx.client, ids.projectANoAi)).toEqual([]);
    });
  });

  it('a key, a creator and a time named by the insert are replaced', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const id = randomUUID();
      const [row] = await tx.rows<{ storage_path: string; created_by_user_id: string }>(
        `insert into office.files
           (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256, storage_path,
            created_by_user_id, created_at)
         values ($1, office.ctx_company_id(), $2, 'project_file', 'a.pdf', 'application/pdf', 5,
                 $3, $4, $5, '2000-01-01')
         returning storage_path, created_by_user_id`,
        [id, ids.projectA, SHA, `${ids.arma}/projects/${ids.projectANoAi}/${id}`, ids.founder],
      );
      expect(row).toEqual({
        storage_path: `${ids.arma}/projects/${ids.projectA}/${id}`,
        created_by_user_id: ids.employeeA,
      });
    });
  });

  it('holds the fixed types, the sizes and the shape of a name', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const refused: Partial<NewProjectFile>[] = [
        { sizeBytes: 26_214_401 },
        { sizeBytes: 0 },
        { mimeType: 'text/html' },
        { mimeType: 'image/svg+xml' },
        { mimeType: 'application/zip' },
        { mimeType: 'application/msword' },
        { name: '../a.pdf' },
        { name: '..\\a.pdf' },
        { name: 'a\n.pdf' },
        { name: ' a.pdf' },
        { name: '' },
        { name: `${'ş'.repeat(197)}.pdf` },
      ];
      for (const fields of refused) {
        expect((await raw(tx, fields)).code, JSON.stringify(fields)).toBe('23514');
      }
      await insertProjectFile(tx.client, file({ sizeBytes: 26_214_400 }));
      await insertProjectFile(tx.client, file({ name: `${'ş'.repeat(196)}.pdf` }));
      for (const mimeType of [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv',
        'text/plain',
        'text/markdown',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
      ]) {
        await insertProjectFile(tx.client, file({ mimeType }));
      }
      // A project file belongs to a project and to nothing else.
      expect(
        (
          await tx.expectError(
            `insert into office.files
               (company_id, project_id, task_id, kind, name, mime_type, size_bytes, sha256)
             values (office.ctx_company_id(), $1, $2, 'project_file', 'a.pdf', 'application/pdf',
                     5, $3)`,
            [ids.projectA, ids.taskAProject, SHA],
          )
        ).code,
      ).toBe('23514');
      expect(
        (await tx.expectError(RAW, [randomUUID(), null, 'a.pdf', 'application/pdf', 5, SHA])).code,
      ).toBe('23514');
      // No row is changed after it was added.
      expect((await tx.expectError(`update office.files set name = 'b.pdf'`)).code).toBe('42501');
    });
  });

  it('nobody but the founder and the members of the project reads or adds', async () => {
    await inTransaction(async (tx) => {
      // The file of the fixtures: added to projectA by its member.
      await tx.setContext(employeeA);
      expect(await tx.rows(`select id from office.files where kind = 'project_file'`)).toEqual([
        { id: ids.projectFileA },
      ]);
      for (const context of [approverA, externalA, ...NOBODY]) {
        await tx.setContext(context);
        expect(await projectFiles(tx), JSON.stringify(context)).toBe(0);
        expect(await listProjectFiles(tx.client, ids.projectA)).toEqual([]);
        expect(await readProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
        expect(await deleteProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
        expect((await raw(tx)).code, JSON.stringify(context)).toBe('42501');
      }
      // The founder, no member, reads and adds.
      await tx.setContext(founderA);
      expect((await readProjectFile(tx.client, ids.projectA, ids.projectFileA))?.name).toBe(
        'Şartname.pdf',
      );
      await insertProjectFile(tx.client, file());
    });
  });

  it('a file of one company is not read, added to or deleted from the other', async () => {
    await inTransaction(async (tx) => {
      // Pillika's context: its own file, and nothing of Arma DX, for its employee and its founder.
      for (const context of [employeeP, founderP]) {
        await tx.setContext(context);
        expect(await tx.rows(`select id from office.files where kind = 'project_file'`)).toEqual([
          { id: ids.projectFileP },
        ]);
        expect(await readProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
        expect(await readProjectFile(tx.client, ids.projectP, ids.projectFileA)).toBeNull();
        expect(await deleteProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
        expect(await tx.exec(`delete from office.files where id = $1`, [ids.projectFileA])).toBe(0);
      }
      // Adding to the other company's project: the row policy for the employee; for the founder
      // of both, the link of a project to its company.
      await tx.setContext(employeeP);
      expect((await raw(tx, { projectId: ids.projectA })).code).toBe('42501');
      await tx.setContext(founderP);
      expect((await raw(tx, { projectId: ids.projectA })).code).toBe('23503');
      // A row that names another company than the context.
      await tx.setContext(founderA);
      expect(
        (
          await tx.expectError(
            `insert into office.files (company_id, project_id, kind, name, mime_type, size_bytes, sha256)
             values ($1, $2, 'project_file', 'a.pdf', 'application/pdf', 5, $3)`,
            [ids.pillika, ids.projectP, SHA],
          )
        ).code,
      ).toBe('42501');
      // The key of a file starts with its own company and names its own project.
      await tx.setContext(employeeP);
      const inPillika = await insertProjectFile(tx.client, file({ projectId: ids.projectP }));
      expect(inPillika.storage_path).toBe(
        `${ids.pillika}/projects/${ids.projectP}/${inPillika.id}`,
      );
      // No context reads anything.
      for (const context of NOBODY) {
        await tx.setContext(context);
        expect(await tx.count('files')).toBe(0);
      }
    });
  });

  it('an agent run and the worker see no project file and write none', async () => {
    const agentRun = (userId: string): ContextInput => ({
      companyId: ids.arma,
      userId,
      agentCode: 'KOR-1',
      projectId: ids.projectA,
    });
    await inTransaction(async (tx) => {
      // The API's role inside an agent run of that project, in the member's and the founder's name.
      for (const userId of [ids.employeeA, ids.founder]) {
        await tx.setContext(agentRun(userId));
        expect(await projectFiles(tx)).toBe(0);
        expect((await raw(tx)).code).toBe('42501');
        expect(await deleteProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
      }
    });
    await inWorkerTransaction(async (tx) => {
      // The worker's role: in a person's name, in an agent run with and without the project.
      for (const context of [
        employeeA,
        founderA,
        agentRun(ids.founder),
        agentRun(ids.employeeA),
        { companyId: ids.arma, userId: ids.founder, agentCode: 'KOR-1' },
      ] satisfies ContextInput[]) {
        await tx.setContext(context);
        expect(await projectFiles(tx), JSON.stringify(context)).toBe(0);
        expect(
          await tx.rows('select 1 from office.files where id = $1', [ids.projectFileA]),
        ).toEqual([]);
        expect(await tx.exec('delete from office.files where id = $1', [ids.projectFileA])).toBe(0);
        expect((await raw(tx)).code, JSON.stringify(context)).toBe('42501');
      }
      // What the worker had before, it keeps: an agent output of its own run ...
      await tx.setContext(agentRun(ids.founder));
      await tx.exec(
        `insert into office.files (company_id, run_id, name, mime_type, size_bytes, storage_path)
         values ($1, $2, 'out.pdf', 'application/pdf', 3, $3)`,
        [ids.arma, ids.runAProject, `${ids.arma}/out.pdf`],
      );
      // ... which it cannot call a project file.
      expect(
        (
          await tx.expectError(
            `insert into office.files (company_id, project_id, kind, name, mime_type, size_bytes, sha256, storage_path)
             values ($1, $2, 'project_file', 'a.pdf', 'application/pdf', 3, $3, 'x')`,
            [ids.arma, ids.projectA, SHA],
          )
        ).code,
      ).toBe('42501');
    });
  });

  it("the person who added a file, the owner, a manager and the founder delete it; a plain member does not delete another's", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const byFounder = await insertProjectFile(tx.client, file());
      await addProjectMember(tx.client, ids.projectA, ids.approverA);
      await addProjectMember(tx.client, ids.projectA, ids.sharedEmployee);
      // A manager of ANOTHER project is a plain member here.
      await setProjectMemberRole(tx.client, ids.projectANoAi, ids.employeeA, 'manager');
      const deletable = async (who: ContextInput, fileId: string) => {
        await tx.setContext(who);
        return (await readProjectFile(tx.client, ids.projectA, fileId))?.deletable;
      };

      // A plain member: their own file, and nobody else's.
      await tx.setContext(employeeA);
      const byMember = await insertProjectFile(tx.client, file());
      expect(byMember.deletable).toBe(true);
      expect(await deletable(employeeA, byFounder.id)).toBe(false);
      expect(await deleteProjectFile(tx.client, ids.projectA, byFounder.id)).toBeNull();
      expect(await deletable(approverA, byMember.id)).toBe(false);
      expect(await deleteProjectFile(tx.client, ids.projectA, byMember.id)).toBeNull();
      // Not under another project's name.
      await tx.setContext(employeeA);
      expect(await deleteProjectFile(tx.client, ids.projectANoAi, byMember.id)).toBeNull();
      expect(await deleteProjectFile(tx.client, ids.projectA, byMember.id)).toBe(
        byMember.storage_path,
      );
      const second = await insertProjectFile(tx.client, file());
      const third = await insertProjectFile(tx.client, file());

      // 11 October decision 2: a manager and the owner delete every file of the project.
      await tx.setContext(founderA);
      await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager');
      await setProjectMemberRole(tx.client, ids.projectA, ids.sharedEmployee, 'owner');
      expect(await deletable(approverA, second.id)).toBe(true);
      expect(await deletable(approverA, byFounder.id)).toBe(true);
      expect(await deleteProjectFile(tx.client, ids.projectA, second.id)).toBe(second.storage_path);
      const owner: ContextInput = { companyId: ids.arma, userId: ids.sharedEmployee };
      expect(await deletable(owner, third.id)).toBe(true);
      expect(await deleteProjectFile(tx.client, ids.projectA, third.id)).toBe(third.storage_path);
      // The file of the fixtures was added by the plain member; they still delete nobody else's.
      expect(await deletable(employeeA, byFounder.id)).toBe(false);

      // A manager who is dismissed is a plain member again.
      await tx.setContext(founderA);
      await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'member');
      expect(await deletable(approverA, byFounder.id)).toBe(false);
      expect(await deleteProjectFile(tx.client, ids.projectA, byFounder.id)).toBeNull();

      // The founder, member or not, deletes every file.
      expect(await deletable(founderA, ids.projectFileA)).toBe(true);
      expect(await deleteProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBe(
        `${ids.arma}/projects/${ids.projectA}/${ids.projectFileA}`,
      );
      expect(await deleteProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
    });
  });

  it('a file written without a person names nobody; a plain member does not delete it', async () => {
    await inAdminTransaction(async (tx) => {
      // As an administrator or the seed would write it: no person in the context, the key named.
      const fileId = randomUUID();
      await tx.exec(
        `insert into office.files
           (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256, storage_path)
         values ($1, $2, $3, 'project_file', 'a.pdf', 'application/pdf', 5, $4, $5)`,
        [fileId, ids.arma, ids.projectA, SHA, `${ids.arma}/projects/${ids.projectA}/${fileId}`],
      );
      await asRole(tx, 'app');
      await tx.setContext(employeeA);
      const row = await readProjectFile(tx.client, ids.projectA, fileId);
      // false, not "unknown": the answer of the API holds a boolean.
      expect(row).toMatchObject({ created_by_user_id: null, deletable: false });
      expect(await deleteProjectFile(tx.client, ids.projectA, fileId)).toBeNull();
      await tx.setContext(founderA);
      expect((await readProjectFile(tx.client, ids.projectA, fileId))?.deletable).toBe(true);
    });
  });

  it('a person who is taken off the project loses the files they added', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const added = await insertProjectFile(tx.client, file());
      await tx.setContext(founderA);
      await tx.exec(`delete from office.project_members where project_id = $1 and user_id = $2`, [
        ids.projectA,
        ids.employeeA,
      ]);
      await tx.setContext(employeeA);
      expect(await readProjectFile(tx.client, ids.projectA, added.id)).toBeNull();
      expect(await deleteProjectFile(tx.client, ids.projectA, added.id)).toBeNull();
      await tx.setContext(founderA);
      expect((await readProjectFile(tx.client, ids.projectA, added.id))?.deletable).toBe(true);

      // A manager who is taken off the project deletes nothing of it any more.
      await addProjectMember(tx.client, ids.projectA, ids.approverA);
      await setProjectMemberRole(tx.client, ids.projectA, ids.approverA, 'manager');
      await tx.setContext(approverA);
      expect((await readProjectFile(tx.client, ids.projectA, added.id))?.deletable).toBe(true);
      await tx.setContext(founderA);
      await tx.exec(`delete from office.project_members where project_id = $1 and user_id = $2`, [
        ids.projectA,
        ids.approverA,
      ]);
      await tx.setContext(approverA);
      expect(await readProjectFile(tx.client, ids.projectA, added.id)).toBeNull();
      expect(await deleteProjectFile(tx.client, ids.projectA, added.id)).toBeNull();
    });
  });

  // Every insert counts the project's files under the caller's row policies, so filling a project
  // to its limit takes seconds here; one upload takes some tens of milliseconds.
  it('a project holds at most 200 files and 1 GB of them', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const fill = (count: number, size: number) =>
        tx.exec(
          `insert into office.files (company_id, project_id, kind, name, mime_type, size_bytes, sha256)
           select office.ctx_company_id(), $1, 'project_file', 'f.pdf', 'application/pdf', $2, $3
           from generate_series(1, $4)`,
          [ids.projectANoAi, size, SHA, count],
        );
      await fill(200, 1);
      const over = await tx.client.query('savepoint s').then(() =>
        tx.client
          .query(RAW, [randomUUID(), ids.projectANoAi, 'a.pdf', 'application/pdf', 1, SHA])
          .then(
            () => null,
            (error: unknown) => error as { code?: string; constraint?: string },
          ),
      );
      await tx.client.query('rollback to savepoint s');
      expect(over).toMatchObject({ code: '54000', constraint: 'project_files_count_limit' });
      // Another project is not counted.
      await insertProjectFile(tx.client, file());
    });
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.files (company_id, project_id, kind, name, mime_type, size_bytes, sha256)
         select office.ctx_company_id(), $1, 'project_file', 'f.pdf', 'application/pdf', 26214400, $2
         from generate_series(1, 40)`,
        [ids.projectANoAi, SHA],
      );
      await insertProjectFile(
        tx.client,
        file({ projectId: ids.projectANoAi, sizeBytes: 25_165_824 }),
      );
      const over = await tx.client.query('savepoint s').then(() =>
        tx.client
          .query(RAW, [randomUUID(), ids.projectANoAi, 'a.pdf', 'application/pdf', 1, SHA])
          .then(
            () => null,
            (error: unknown) => error as { code?: string; constraint?: string },
          ),
      );
      await tx.client.query('rollback to savepoint s');
      expect(over).toMatchObject({ code: '54000', constraint: 'project_files_size_limit' });
    });
  }, 30_000);

  it('adding and deleting leave a trace with ids only', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(employeeA);
      const added = await insertProjectFile(tx.client, file());
      await deleteProjectFile(tx.client, ids.projectA, added.id);
      await tx.setContext(founderA);
      const trace = await tx.rows(
        `select event, user_id, agent_code, project_id, record_type, external_ref
         from office.audit_log where record_id = $1 order by id`,
        [added.id],
      );
      const common = {
        user_id: ids.employeeA,
        agent_code: null,
        project_id: ids.projectA,
        record_type: 'file',
        external_ref: null,
      };
      expect(trace).toEqual([
        { event: 'project_file_added', ...common },
        { event: 'project_file_deleted', ...common },
      ]);
    });
  });

  it('an agent output is what it was: its own policy, its own key rule, no trace', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      const rows = await tx.rows<{ kind: string }>(
        `select kind from office.files where run_id is not null`,
      );
      expect(rows).toEqual([{ kind: 'agent_output' }]);
      await tx.exec(
        `insert into office.files (company_id, name, mime_type, size_bytes, storage_path)
         values ($1, 'x.html', 'text/html', 1, $2)`,
        [ids.arma, `${ids.arma}/x.html`],
      );
      expect(
        await tx.count('audit_log', `event like 'project_file%' and record_id <> all($1::uuid[])`, [
          [ids.projectFileA, ids.projectFileP],
        ]),
      ).toBe(0);
    });
  });

  it("the keys under projects/ are the project files' alone: no agent output takes one", async () => {
    const future = `${ids.arma}/projects/${ids.projectA}/${randomUUID()}`;
    const taken = `${ids.arma}/projects/${ids.projectA}/${ids.projectFileA}`;
    const OUTPUT = `insert into office.files (company_id, name, mime_type, size_bytes, storage_path)
      values ($1, 'x.html', 'text/html', 1, $2)`;
    // A person through the API's role: the founder, and an employee who is no member.
    await inTransaction(async (tx) => {
      for (const who of [founderA, approverA]) {
        await tx.setContext(who);
        for (const key of [future, taken, `${ids.arma}/projects/x`]) {
          const error = await tx.expectError(OUTPUT, [ids.arma, key]);
          expect(error.code, key).toBe('23514');
          expect(error.message).toContain('files_agent_output_key');
        }
        // "projects" somewhere else in the key is nobody's business.
        await tx.exec(OUTPUT, [ids.arma, `${ids.arma}/outputs/projects/${randomUUID()}`]);
      }
    });
    // An agent run through the worker's role, with and without the project.
    await inWorkerTransaction(async (tx) => {
      for (const projectId of [ids.projectA, undefined]) {
        await tx.setContext({
          ...founderA,
          agentCode: 'KOR-1',
          ...(projectId ? { projectId } : {}),
        });
        for (const key of [future, taken]) {
          expect((await tx.expectError(OUTPUT, [ids.arma, key])).code, key).toBe('23514');
        }
      }
    });
  });

  it('two uploads to one project go one after the other; another project does not wait', async () => {
    const first = await openTransaction('app', employeeA);
    const second = await openTransaction('app', employeeA);
    const third = await openTransaction('app', employeeA);
    try {
      await first.tx.exec(RAW_ID, [randomUUID(), ids.projectA]);
      // The same project: the second insert waits for the first transaction (the limits are
      // counted one upload at a time).
      let done = false;
      const waiting = second.tx.exec(RAW_ID, [randomUUID(), ids.projectA]).then(() => {
        done = true;
      });
      await untilBlocked(second.pid);
      expect(done).toBe(false);
      // Another project of the same person is not held up.
      await third.tx.exec(RAW_ID, [randomUUID(), ids.projectANoAi]);
      await first.rollback();
      await waiting;
      expect(done).toBe(true);
    } finally {
      await first.rollback();
      await second.rollback();
      await third.rollback();
    }
  });
});

// Agents read (8 October decision 21; step 6) ------------------------------------------------------
//
// An agent run reads the RECORDS of the files of its own project, and only when the agent's
// current card version names the reading tool. The fixtures' card versions name no tool, so every
// case writes its own. One privileged transaction goes on as the worker's role (asRole) and is
// rolled back.

/** The context of an agent run of the worker. */
function runOf(
  agentCode: string,
  userId: string,
  projectId: string | null = ids.projectA,
  companyId: string = ids.arma,
): ContextInput {
  return { companyId, userId, agentCode, projectId };
}

async function asAdministrator(tx: Tx): Promise<void> {
  await asRole(tx, null);
  await tx.setContext({});
}

async function asWorkerRun(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'worker');
  await tx.setContext(context);
}

/**
 * Writes a card version whose card names the given tools and makes it the agent's current one, as
 * the definitions sync would (the privileged role, no person in the context).
 */
async function cardNames(tx: Tx, agentCode: string, tools: string[]): Promise<void> {
  await asAdministrator(tx);
  const id = randomUUID();
  await tx.exec(
    `insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
     values ($1, $2, $3, $4, 'Y1', 'test-model')`,
    // One version per commit and agent: a commit id of this version's own.
    [id, agentCode, id.replaceAll('-', '').slice(0, 12), JSON.stringify({ card: { tools } })],
  );
  await tx.exec('update office.agent_definitions set current_version_id = $1 where code = $2', [
    id,
    agentCode,
  ]);
}

/** One more project file, written as an administrator would (no person, the key named). */
async function adminFile(tx: Tx, companyId: string, projectId: string): Promise<string> {
  await asAdministrator(tx);
  const fileId = randomUUID();
  await tx.exec(
    `insert into office.files
       (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256, storage_path)
     values ($1, $2, $3, 'project_file', 'b.pdf', 'application/pdf', 5, $4, $5)`,
    [fileId, companyId, projectId, SHA, `${companyId}/projects/${projectId}/${fileId}`],
  );
  return fileId;
}

describe.skipIf(noDatabase)('agents read project files', () => {
  afterAll(closePools);

  it('a run of an agent whose card names the tool reads the files of its project', async () => {
    await inAdminTransaction(async (tx) => {
      await cardNames(tx, 'KOR-1', ['route_task', AGENT_READ_TOOL]);
      for (const userId of [ids.founder, ids.employeeA]) {
        await asWorkerRun(tx, runOf('KOR-1', userId));
        const listed = await listRunProjectFiles(tx.client);
        expect(listed, userId).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          id: ids.projectFileA,
          company_id: ids.arma,
          project_id: ids.projectA,
          name: 'Şartname.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1200,
          sha256: SHA,
          storage_path: `${ids.arma}/projects/${ids.projectA}/${ids.projectFileA}`,
        });
        expect(listed[0]?.created_at).toBeInstanceOf(Date);
        expect(await readRunProjectFile(tx.client, ids.projectFileA)).toEqual(listed[0]);
        expect(await readRunProjectFile(tx.client, randomUUID())).toBeNull();
      }
      // Newest first.
      const newer = await adminFile(tx, ids.arma, ids.projectA);
      await asWorkerRun(tx, runOf('KOR-1', ids.founder));
      expect((await listRunProjectFiles(tx.client)).map((row) => row.id)).toEqual([
        newer,
        ids.projectFileA,
      ]);
    });
  });

  it('a run reads no file outside its project', async () => {
    await inAdminTransaction(async (tx) => {
      await cardNames(tx, 'KOR-1', [AGENT_READ_TOOL]);
      // Another project of the same company that has a file and an open AI permission.
      await asAdministrator(tx);
      const [other] = await tx.rows<{ id: string }>(
        `insert into office.projects (company_id, customer_id, name, ai_allowed)
         values ($1, null, 'Another project', true) returning id`,
        [ids.arma],
      );
      const otherProject = other?.id ?? '';
      const otherFile = await adminFile(tx, ids.arma, otherProject);

      // No project in the context: none, also not by id.
      await asWorkerRun(tx, runOf('KOR-1', ids.founder, null));
      expect(await listRunProjectFiles(tx.client)).toEqual([]);
      expect(await readRunProjectFile(tx.client, ids.projectFileA)).toBeNull();
      expect(await projectFiles(tx)).toBe(0);

      // In one project: nothing of the other, in either direction.
      await asWorkerRun(tx, runOf('KOR-1', ids.founder, ids.projectA));
      expect(await readRunProjectFile(tx.client, otherFile)).toBeNull();
      expect(
        await tx.rows('select 1 from office.files where id = $1', [otherFile]),
        'not by a plain statement either',
      ).toEqual([]);
      await asWorkerRun(tx, runOf('KOR-1', ids.founder, otherProject));
      expect((await listRunProjectFiles(tx.client)).map((row) => row.id)).toEqual([otherFile]);
      expect(await readRunProjectFile(tx.client, ids.projectFileA)).toBeNull();

      // Rule 2: each company's run reads its own project's file and nothing of the other's.
      await asWorkerRun(tx, runOf('KOR-1', ids.founder, ids.projectP, ids.pillika));
      expect((await listRunProjectFiles(tx.client)).map((row) => row.id)).toEqual([
        ids.projectFileP,
      ]);
      for (const context of [
        runOf('KOR-1', ids.founder, ids.projectP, ids.arma),
        runOf('KOR-1', ids.founder, ids.projectA, ids.pillika),
      ]) {
        await asWorkerRun(tx, context);
        expect(await listRunProjectFiles(tx.client), JSON.stringify(context)).toEqual([]);
        expect(await projectFiles(tx), JSON.stringify(context)).toBe(0);
        expect(await readRunProjectFile(tx.client, ids.projectFileA)).toBeNull();
        expect(await readRunProjectFile(tx.client, ids.projectFileP)).toBeNull();
      }
    });
  });

  it('rule 12: no AI permission, no file', async () => {
    await inAdminTransaction(async (tx) => {
      await cardNames(tx, 'KOR-1', [AGENT_READ_TOOL]);
      const noAi = await adminFile(tx, ids.arma, ids.projectANoAi);
      const customerNoAi = await adminFile(tx, ids.arma, ids.projectACustomerNoAi);
      // The project's own permission is off; the customer's is.
      for (const [projectId, fileId] of [
        [ids.projectANoAi, noAi],
        [ids.projectACustomerNoAi, customerNoAi],
      ] as const) {
        await asWorkerRun(tx, runOf('KOR-1', ids.founder, projectId));
        expect(await listRunProjectFiles(tx.client), projectId).toEqual([]);
        expect(await readRunProjectFile(tx.client, fileId), projectId).toBeNull();
      }
      // Closed after a first read: the next statement of the same run gives none.
      const run = runOf('KOR-1', ids.employeeA);
      await asWorkerRun(tx, run);
      expect(await listRunProjectFiles(tx.client)).toHaveLength(1);
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_allowed = false where id = $1', [ids.projectA]);
      await asWorkerRun(tx, run);
      expect(await listRunProjectFiles(tx.client)).toEqual([]);
      expect(await readRunProjectFile(tx.client, ids.projectFileA)).toBeNull();
      // Open again, and the customer's closed: the same.
      await asAdministrator(tx);
      await tx.exec('update office.projects set ai_allowed = true where id = $1', [ids.projectA]);
      await asWorkerRun(tx, run);
      expect(await listRunProjectFiles(tx.client)).toHaveLength(1);
      await asAdministrator(tx);
      await tx.exec('update office.customers set ai_allowed = false where id = $1', [
        ids.customerA,
      ]);
      await asWorkerRun(tx, run);
      expect(await listRunProjectFiles(tx.client)).toEqual([]);
    });
  });

  it('a run in the name of somebody who may not read the project reads no file', async () => {
    await inAdminTransaction(async (tx) => {
      await cardNames(tx, 'KOR-1', [AGENT_READ_TOOL]);
      // An employee who is no member of the project, an external person, a person of the other
      // company, and nobody.
      for (const userId of [ids.approverA, ids.externalA, ids.employeeP]) {
        await asWorkerRun(tx, runOf('KOR-1', userId));
        expect(await listRunProjectFiles(tx.client), userId).toEqual([]);
        expect(await readRunProjectFile(tx.client, ids.projectFileA), userId).toBeNull();
      }
      await asWorkerRun(tx, { companyId: ids.arma, agentCode: 'KOR-1', projectId: ids.projectA });
      expect(await listRunProjectFiles(tx.client)).toEqual([]);
      // The member reads (so the answers above are not an empty table's).
      await asWorkerRun(tx, runOf('KOR-1', ids.employeeA));
      expect(await listRunProjectFiles(tx.client)).toHaveLength(1);
    });
  });

  it('an agent whose card does not name the tool reads no file', async () => {
    await inAdminTransaction(async (tx) => {
      // A card with other tools, one whose tool list is missing, and a name that only looks like it.
      await cardNames(tx, 'KOR-1', [AGENT_READ_TOOL]);
      await cardNames(tx, 'HAF-1', ['read_project', 'read_project_files', 'submit_for_approval']);
      for (const agent of ['HAF-1', 'P-IST-1', 'NO-SUCH-1']) {
        await asWorkerRun(tx, runOf(agent, ids.founder));
        expect(await listRunProjectFiles(tx.client), agent).toEqual([]);
        expect(await readRunProjectFile(tx.client, ids.projectFileA), agent).toBeNull();
        expect(await tx.rows('select office.run_reads_project_files() as reads'), agent).toEqual([
          { reads: false },
        ]);
      }
      await asWorkerRun(tx, runOf('KOR-1', ids.founder));
      expect(await tx.rows('select office.run_reads_project_files() as reads')).toEqual([
        { reads: true },
      ]);
      expect(await listRunProjectFiles(tx.client)).toHaveLength(1);
      // The tool is taken off the card: hidden from the agent's next statement.
      await cardNames(tx, 'KOR-1', ['route_task']);
      await asWorkerRun(tx, runOf('KOR-1', ids.founder));
      expect(await listRunProjectFiles(tx.client)).toEqual([]);

      // The name in the database's function is the contract's.
      await asAdministrator(tx);
      const [definition] = await tx.rows<{ source: string }>(
        `select pg_get_functiondef('office.run_reads_project_files'::regproc) as source`,
      );
      expect(definition?.source).toContain(`? '${AGENT_READ_TOOL}'`);
    });
  });

  it('a run changes nothing', async () => {
    await inAdminTransaction(async (tx) => {
      await cardNames(tx, 'KOR-1', [AGENT_READ_TOOL]);
      for (const role of ['worker', 'app'] as const) {
        await asRole(tx, role);
        await tx.setContext(runOf('KOR-1', ids.founder));
        // It sees the file ...
        expect(await readRunProjectFile(tx.client, ids.projectFileA), role).not.toBeNull();
        // ... and deletes, adds and changes none.
        expect(
          await tx.exec('delete from office.files where id = $1', [ids.projectFileA]),
          role,
        ).toBe(0);
        expect(await deleteProjectFile(tx.client, ids.projectA, ids.projectFileA)).toBeNull();
        expect((await raw(tx)).code, role).toBe('42501');
        expect(
          (
            await tx.expectError(`update office.files set name = 'y.pdf' where id = $1`, [
              ids.projectFileA,
            ])
          ).code,
          role,
        ).toBe('42501');
        expect(await readRunProjectFile(tx.client, ids.projectFileA)).toMatchObject({
          name: 'Şartname.pdf',
        });
      }
    });
  });

  it("nothing reads without a context, and a person through the worker's role reads none", async () => {
    await inAdminTransaction(async (tx) => {
      await cardNames(tx, 'KOR-1', [AGENT_READ_TOOL]);
      await asRole(tx, 'worker');
      for (const context of [
        ...NOBODY,
        // A person, with and without a project in the context: the worker's role reads for runs.
        founderA,
        employeeA,
        { ...founderA, projectId: ids.projectA },
        { ...employeeA, projectId: ids.projectA },
        // An agent without a company.
        { agentCode: 'KOR-1', userId: ids.founder, projectId: ids.projectA },
      ] satisfies ContextInput[]) {
        await tx.setContext(context);
        expect(await listRunProjectFiles(tx.client), JSON.stringify(context)).toEqual([]);
        expect(
          await readRunProjectFile(tx.client, ids.projectFileA),
          JSON.stringify(context),
        ).toBeNull();
        expect(await projectFiles(tx), JSON.stringify(context)).toBe(0);
      }
      // A person through the API's role reads as before, by the people's policy, and the run's
      // statements give them nothing without a project in the context.
      await asRole(tx, 'app');
      await tx.setContext(employeeA);
      expect(await projectFiles(tx)).toBe(1);
      expect(await listRunProjectFiles(tx.client)).toEqual([]);
    });
  });
});
