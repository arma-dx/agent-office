import { createHash } from 'node:crypto';
import {
  listRunProjectFiles,
  readRunProjectFile,
  type Queryable,
  type RunProjectFileRow,
} from '@agent-office/db';
import { FileReadError, type FileReader } from './reader.ts';

/**
 * The one way from an agent run to the bytes of a project file (CLAUDE.md rule 9). The record is
 * read with the run's own client and context, under the row policy project_file_run_reads; the
 * storage key is the one on that row; no caller hands a key in.
 */
export class RunProjectFiles {
  readonly #reader: FileReader;
  // The row objects find() returned: content() gives bytes for these and for nothing else.
  readonly #found = new WeakSet<RunProjectFileRow>();

  constructor(reader: FileReader) {
    this.#reader = reader;
  }

  /** The files of the run's project as the run is shown them. */
  list(client: Queryable): Promise<RunProjectFileRow[]> {
    return listRunProjectFiles(client);
  }

  /** The record of one file, read now; null when the run is not shown it. */
  async find(client: Queryable, fileId: string): Promise<RunProjectFileRow | null> {
    const row = await readRunProjectFile(client, fileId);
    if (row !== null) this.#found.add(row);
    return row;
  }

  /**
   * The bytes of a record find() of THIS object returned (anything else throws); null when the
   * storage holds nothing for it. The bytes are checked against the record's size and SHA-256
   * before they are returned: what does not match is never given out (FileReadError('get')).
   * Before the storage is asked, the key must be exactly the key of the row's own project file
   * (FileReadError('key') otherwise). The database holds the same for every project file
   * (files_project_file_shape); it is held once more here, where the key is used, so that no
   * later kind of row can lend its key.
   */
  async content(row: RunProjectFileRow, signal?: AbortSignal): Promise<Buffer | null> {
    if (!this.#found.has(row)) {
      throw new Error('The bytes of a file are read only for a record that was read in the run');
    }
    if (row.storage_path !== `${row.company_id}/projects/${row.project_id}/${row.id}`) {
      throw new FileReadError('key');
    }
    const bytes = await this.#reader.get(row.storage_path, row.size_bytes, signal);
    if (bytes === null) return null;
    if (
      bytes.length !== row.size_bytes ||
      createHash('sha256').update(bytes).digest('hex') !== row.sha256
    ) {
      throw new FileReadError('get');
    }
    return bytes;
  }
}
