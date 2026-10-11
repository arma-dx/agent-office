import type { Queryable } from './queryable.ts';

/**
 * Statements of the project files (8 October decision 20). Every statement runs with the caller's
 * restricted role inside the caller's transaction and context. Who reads, adds and deletes a file
 * is decided by the row policies of office.files, never by a condition here: the founder and the
 * members of the project read and add; the person who added a file, the owner and the managers of
 * the project and the founder delete it (11 October decision 2).
 *
 * storage_path is the key of the file's bytes in the file store. It is written by the database
 * and leaves this module only towards the file module of the API (apps/api/src/files), which
 * reaches the store with it after the row was read here.
 */

export interface ProjectFileRow {
  id: string;
  project_id: string;
  name: string;
  mime_type: string;
  // bigint: read as text and turned into a number (at most 26214400).
  size_bytes: number;
  sha256: string;
  storage_path: string;
  created_at: Date;
  created_by_user_id: string | null;
  deletable: boolean;
}

const FILE_SQL = `
  select f.id, f.project_id, f.name, f.mime_type, f.size_bytes::int as size_bytes, f.sha256,
         f.storage_path, f.created_at, f.created_by_user_id,
         coalesce(
           office.is_founder()
             or f.created_by_user_id = office.ctx_user_id()
             or office.project_role(f.project_id) in ('owner', 'manager'),
           false
         ) as deletable
  from office.files f
  where f.kind = 'project_file' and f.company_id = office.ctx_company_id()`;

/** The files of a project the person may read, newest first. */
export async function listProjectFiles(
  client: Queryable,
  projectId: string,
): Promise<ProjectFileRow[]> {
  const { rows } = await client.query<ProjectFileRow>(
    `${FILE_SQL} and f.project_id = $1 order by f.created_at desc, f.id`,
    [projectId],
  );
  return rows;
}

/** One file of a project; null when it does not exist there or the person may not read it. */
export async function readProjectFile(
  client: Queryable,
  projectId: string,
  fileId: string,
): Promise<ProjectFileRow | null> {
  const { rows } = await client.query<ProjectFileRow>(
    `${FILE_SQL} and f.project_id = $1 and f.id = $2`,
    [projectId, fileId],
  );
  return rows[0] ?? null;
}

export interface NewProjectFile {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Adds the record of a file to a project of the context company. The database writes who, when
 * and the storage key (no key is sent), and holds the type list, the size and the project's
 * limits. The row is read back through the same read policy that lets the person see the file.
 */
export async function insertProjectFile(
  client: Queryable,
  file: NewProjectFile,
): Promise<ProjectFileRow> {
  await client.query(
    `insert into office.files (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256)
     values ($1, office.ctx_company_id(), $2, 'project_file', $3, $4, $5, $6)`,
    [file.id, file.projectId, file.name, file.mimeType, file.sizeBytes, file.sha256],
  );
  const row = await readProjectFile(client, file.projectId, file.id);
  if (!row) {
    throw new Error('The file that was just added cannot be read');
  }
  return row;
}

/**
 * Deletes the record of a file; returns its storage key, or null when no row was deleted (not a
 * file of this project, or not the person's to delete).
 */
export async function deleteProjectFile(
  client: Queryable,
  projectId: string,
  fileId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ storage_path: string }>(
    `delete from office.files f
     where f.kind = 'project_file' and f.company_id = office.ctx_company_id()
       and f.project_id = $1 and f.id = $2
     returning f.storage_path`,
    [projectId, fileId],
  );
  return rows[0]?.storage_path ?? null;
}
