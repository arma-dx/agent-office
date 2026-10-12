import { createHash, randomUUID } from 'node:crypto';
import { setContext, type ContextInput } from '@agent-office/db';
import type pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { RunProjectFiles } from '../src/files/project-files.ts';
import { FileReadError, MemoryFileReader } from '../src/files/reader.ts';
import { closeTestPools, ids, noDatabase, testPools } from './helpers.ts';

// The one way from an agent run to the bytes of a project file (CLAUDE.md rule 9): the record is
// read under the run's row policy, the key is the row's own, and the bytes are checked against
// the record before they are given out. One privileged transaction per case writes a project, a
// file and a card version, goes on as the worker's role, and is rolled back.

const BYTES = Buffer.from('%PDF-1.4 a small file');
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

interface Scene {
  client: pg.PoolClient;
  projectId: string;
  fileId: string;
  key: string;
  /** Goes on as the worker's role with the given context. */
  as: (context: ContextInput) => Promise<void>;
}

async function scene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const workerRole = new URL(inject('database')?.worker ?? '').username;
  if (!/^[a-z_]+$/.test(workerRole)) throw new Error('Unexpected name of a test role');
  const client = await testPools().admin.connect();
  try {
    await client.query('begin');
    const projectId = randomUUID();
    const fileId = randomUUID();
    const key = `${ids.arma}/projects/${projectId}/${fileId}`;
    await client.query(
      `insert into office.projects (id, company_id, customer_id, name, ai_allowed)
       values ($1, $2, null, 'A project with a file', true)`,
      [projectId, ids.arma],
    );
    await client.query(
      `insert into office.files
         (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256, storage_path)
       values ($1, $2, $3, 'project_file', 'Şartname.pdf', 'application/pdf', $4, $5, $6)`,
      [fileId, ids.arma, projectId, BYTES.length, sha(BYTES), key],
    );
    // A card version that names the reading tool, whatever the repository's card says today.
    const versionId = randomUUID();
    await client.query(
      `insert into office.card_versions (id, agent_code, git_commit, content, authority_level, model)
       values ($1, 'SOS-2', $2, $3, 'Y1', 'test-model')`,
      [
        versionId,
        versionId.replaceAll('-', '').slice(0, 12),
        JSON.stringify({ card: { tools: ['read_project_file'] } }),
      ],
    );
    await client.query(
      `update office.agent_definitions set current_version_id = $1 where code = 'SOS-2'`,
      [versionId],
    );
    await work({
      client,
      projectId,
      fileId,
      key,
      as: async (context) => {
        await client.query(`set local role ${workerRole}`);
        await setContext(client, context);
      },
    });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const run = (projectId: string | null): ContextInput => ({
  companyId: ids.arma,
  userId: ids.founder,
  agentCode: 'SOS-2',
  projectId,
});

describe.skipIf(noDatabase)('the files of a run’s project', () => {
  afterAll(closeTestPools);

  it('content is given only for a row find returned', async () => {
    await scene(async ({ client, projectId, fileId, key, as }) => {
      const reader = new MemoryFileReader();
      reader.objects.set(key, BYTES);
      const files = new RunProjectFiles(reader);
      await as(run(projectId));
      expect((await files.list(client)).map((row) => row.id)).toEqual([fileId]);
      const row = await files.find(client, fileId);
      expect(row).toMatchObject({ id: fileId, storage_path: key, size_bytes: BYTES.length });
      if (row === null) throw new Error('The file was not found');
      expect(await files.content(row)).toEqual(BYTES);
      expect(reader.calls).toEqual([key]);

      // A copy of the row, a row of the list, and a row another object found: all refused, and
      // the storage is not asked.
      const [listed] = await files.list(client);
      const other = new RunProjectFiles(reader);
      for (const stranger of [{ ...row }, listed, await other.find(client, fileId)]) {
        if (!stranger) throw new Error('No row to try');
        await expect(files.content(stranger)).rejects.toThrow(/read in the run/);
      }
      expect(reader.calls).toEqual([key]);
    });
  });

  it('a row whose key is not its own project file’s key is refused before the storage is asked', async () => {
    await scene(async ({ client, projectId, fileId, key, as }) => {
      const reader = new MemoryFileReader();
      const elsewhere = `${ids.arma}/projects/${projectId}/${randomUUID()}`;
      reader.objects.set(key, BYTES);
      reader.objects.set(elsewhere, BYTES);
      const files = new RunProjectFiles(reader);
      await as(run(projectId));
      for (const path of [
        elsewhere,
        `${ids.pillika}/projects/${projectId}/${fileId}`,
        `${ids.arma}/projects/${randomUUID()}/${fileId}`,
        `${ids.arma}/${fileId}`,
        `${key}/x`,
        '../x',
      ]) {
        const row = await files.find(client, fileId);
        if (row === null) throw new Error('The file was not found');
        row.storage_path = path;
        const thrown: unknown = await files.content(row).catch((error: unknown) => error);
        expect(thrown, path).toBeInstanceOf(FileReadError);
        expect((thrown as FileReadError).operation, path).toBe('key');
      }
      expect(reader.calls).toEqual([]);
    });
  });

  it('bytes that are not the record’s are never given out', async () => {
    await scene(async ({ client, projectId, fileId, key, as }) => {
      const reader = new MemoryFileReader();
      const files = new RunProjectFiles(reader);
      await as(run(projectId));
      const swapped = Buffer.from(BYTES);
      swapped[swapped.length - 1] = (swapped[swapped.length - 1] ?? 0) ^ 1;
      for (const [name, stored, operation] of [
        // Shorter than the record says; the same length and other bytes; longer.
        ['shorter', BYTES.subarray(0, BYTES.length - 1), 'get'],
        ['swapped', swapped, 'get'],
        ['longer', Buffer.concat([BYTES, Buffer.from('x')]), 'too_large'],
      ] as const) {
        reader.objects.set(key, Buffer.from(stored));
        const row = await files.find(client, fileId);
        if (row === null) throw new Error('The file was not found');
        const thrown: unknown = await files.content(row).catch((error: unknown) => error);
        expect(thrown, name).toBeInstanceOf(FileReadError);
        expect((thrown as FileReadError).operation, name).toBe(operation);
      }
      // A storage that fails is an error too, not "missing".
      reader.failing = true;
      const row = await files.find(client, fileId);
      if (row === null) throw new Error('The file was not found');
      await expect(files.content(row)).rejects.toBeInstanceOf(FileReadError);
    });
  });

  it('a missing object is null', async () => {
    await scene(async ({ client, projectId, fileId, key, as }) => {
      const reader = new MemoryFileReader();
      const files = new RunProjectFiles(reader);
      await as(run(projectId));
      const row = await files.find(client, fileId);
      if (row === null) throw new Error('The file was not found');
      expect(await files.content(row)).toBeNull();
      expect(reader.calls).toEqual([key]);
    });
  });

  it('find reads under the run’s context', async () => {
    await scene(async ({ client, projectId, fileId, as }) => {
      const reader = new MemoryFileReader();
      const files = new RunProjectFiles(reader);
      const hidden: ContextInput[] = [
        // No project in the context; another company; a person and not a run; another agent,
        // whose card does not name the tool; somebody who may not read the project.
        run(null),
        { ...run(projectId), companyId: ids.pillika },
        { companyId: ids.arma, userId: ids.founder, projectId },
        { ...run(projectId), agentCode: 'KOR-1' },
        { ...run(projectId), userId: ids.employee },
        {},
      ];
      for (const context of hidden) {
        await as(context);
        expect(await files.find(client, fileId), JSON.stringify(context)).toBeNull();
        expect(await files.list(client), JSON.stringify(context)).toEqual([]);
      }
      await as(run(projectId));
      expect(await files.find(client, fileId)).not.toBeNull();
      expect(await files.find(client, randomUUID())).toBeNull();
      // Reading a record never asks the storage.
      expect(reader.calls).toEqual([]);
    });
  });
});
