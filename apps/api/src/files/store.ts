import { createHash } from 'node:crypto';
import {
  deleteProjectFile,
  insertProjectFile,
  readProjectFile,
  type NewProjectFile,
  type ProjectFileRow,
  type Queryable,
} from '@agent-office/db';
import { PROJECT_FILE_MAX_BYTES } from '@agent-office/shared';
import { FileStorageError, type FileStorage } from './storage.ts';

export { FileStorageError };

/**
 * The one way from a request to the file storage (CLAUDE.md rule 9: the storage's key is used only
 * inside one narrow file module, and only after the access was checked through the row level
 * security of the record). Every method that reaches the storage reads or writes the record
 * itself, with the caller's own client, role and context, and takes the storage key from the row
 * the database gave it; no caller hands a key in.
 *
 *   add      the record is inserted (the row policy and the triggers decide), then the bytes are
 *            written, both inside the caller's transaction: a storage that fails rolls the record
 *            back, so no record exists without its bytes.
 *   find     the record is read under the caller's row policies; what comes back can be opened
 *            after the transaction has ended.
 *   content  the bytes of a record `find` returned; they are checked against the record's size
 *            and SHA-256 before they are given out.
 *   remove   the record is deleted (the row policy decides), then the bytes are removed, both
 *            inside the caller's transaction: a storage that fails rolls the deletion back, so
 *            no bytes outlive a record that the list no longer shows.
 *
 * add and remove call the storage while the caller's transaction, and so a database connection,
 * is open. A storage that hangs must not take every connection of the pool with it: only
 * STORAGE_CALLS_IN_TRANSACTIONS of them run at once, and one more is refused at once ('busy').
 */
export class ProjectFileStore {
  readonly #storage: FileStorage | null;
  // The rows this object itself read under a caller's row policies.
  readonly #found = new WeakSet<ProjectFileRow>();
  // add and remove that are under way: each holds an open transaction.
  #inTransactions = 0;

  /** null: no file storage is set up in this environment. */
  constructor(storage: FileStorage | null) {
    this.#storage = storage;
  }

  get available(): boolean {
    return this.#storage !== null;
  }

  #require(): FileStorage {
    if (!this.#storage) {
      throw new Error('No file storage is set up; ask `available` first');
    }
    return this.#storage;
  }

  async #whileHolding<T>(work: () => Promise<T>): Promise<T> {
    if (this.#inTransactions >= STORAGE_CALLS_IN_TRANSACTIONS) {
      throw new FileStorageError('busy');
    }
    this.#inTransactions += 1;
    try {
      return await work();
    } finally {
      this.#inTransactions -= 1;
    }
  }

  async add(client: Queryable, file: NewProjectFile, content: Buffer): Promise<ProjectFileRow> {
    const storage = this.#require();
    return this.#whileHolding(async () => {
      const row = await insertProjectFile(client, file);
      await storage.put(row.storage_path, content, row.mime_type);
      return row;
    });
  }

  async find(client: Queryable, projectId: string, fileId: string): Promise<ProjectFileRow | null> {
    const row = await readProjectFile(client, projectId, fileId);
    if (row) this.#found.add(row);
    return row;
  }

  /** null: the storage holds nothing for this record. */
  async content(row: ProjectFileRow): Promise<Buffer | null> {
    const storage = this.#require();
    if (!this.#found.has(row)) {
      throw new Error('The record was not read through find()');
    }
    const content = await storage.get(row.storage_path, PROJECT_FILE_MAX_BYTES);
    if (content === null) return null;
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (content.length !== row.size_bytes || sha256 !== row.sha256) {
      // Not the bytes that were added under this record: never given out.
      throw new FileStorageError('get');
    }
    return content;
  }

  /** false: no record was deleted (not a file of this project, or not the caller's to delete). */
  async remove(client: Queryable, projectId: string, fileId: string): Promise<boolean> {
    const storage = this.#require();
    return this.#whileHolding(async () => {
      const key = await deleteProjectFile(client, projectId, fileId);
      if (key === null) return false;
      await storage.remove(key);
      return true;
    });
  }
}

/**
 * How many adds and removes may be under way at once, each inside an open transaction. The
 * pool of the API has ten connections; a storage that hangs for its whole timeout holds at most
 * this many of them.
 */
export const STORAGE_CALLS_IN_TRANSACTIONS = 3;

/** How many bytes of uploads the process holds in memory at once (four files of the largest size). */
export const UPLOAD_BUFFER_BYTES = 4 * PROJECT_FILE_MAX_BYTES;
/** The same for downloads: a file is read whole, and checked, before a byte of it is sent. */
export const DOWNLOAD_BUFFER_BYTES = 4 * PROJECT_FILE_MAX_BYTES;

/**
 * Bounds the memory that files on their way take. An upload is buffered before its handler runs,
 * so its declared length is reserved before a byte is read; a download is read whole from the
 * storage before it is sent, so the record's size is reserved before the storage is asked.
 */
export class ByteBudget {
  readonly #max: number;
  #reserved = 0;

  constructor(maxBytes: number) {
    this.#max = maxBytes;
  }

  reserve(bytes: number): boolean {
    if (this.#reserved + bytes > this.#max) return false;
    this.#reserved += bytes;
    return true;
  }

  release(bytes: number): void {
    this.#reserved = Math.max(0, this.#reserved - bytes);
  }

  get reserved(): number {
    return this.#reserved;
  }
}

/**
 * How long the body of an upload may take to arrive after its headers: 30 seconds and the time
 * its declared length takes at 64 KB a second (about seven minutes for 25 MB). After that the
 * connection is closed and the reserved bytes are given back, so a connection that went silent
 * (a laptop that fell asleep, a stranger who sends nothing) does not keep a place.
 */
export function uploadDeadlineMs(declaredBytes: number): number {
  return 30_000 + Math.ceil(declaredBytes / (64 * 1024)) * 1000;
}
