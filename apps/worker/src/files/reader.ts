import { open } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { FileReaderSettings, SupabaseReadSettings } from './read-token.ts';

/**
 * Where the bytes of a file are read from. The worker's side of the file storage: reading only.
 * It is a reading copy of the API's storage (apps/api/src/files/storage.ts), not that module
 * shared: the worker is where a model's choices are executed, so no way to write or to remove an
 * object exists in its code. Nothing outside this folder and worker.ts imports this file; a run
 * reaches bytes only through RunProjectFiles (project-files.ts), which reads the record under the
 * run's row policy first (CLAUDE.md rule 9).
 */
export interface FileReader {
  /**
   * The whole object; null when nothing lies under the key. An object larger than maxBytes is an
   * error, never an answer. The signal is the run's own (its deadline, a stop).
   */
  get(key: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer | null>;
}

export type FileReadFailure = 'get' | 'key' | 'too_large';

/**
 * A storage that could not be read. The message holds the operation and, for the remote storage,
 * the HTTP status: never a key, a name, an address or the service's own text.
 */
export class FileReadError extends Error {
  readonly operation: FileReadFailure;
  readonly status: number | undefined;

  constructor(operation: FileReadFailure, status?: number) {
    super(
      status === undefined
        ? `File read failed: ${operation}`
        : `File read failed: ${operation} (${String(status)})`,
    );
    this.name = 'FileReadError';
    this.operation = operation;
    this.status = status;
  }
}

// A company id, then one or more segments of letters, digits, ".", "_" and "-"; no segment starts
// with a dot, so "." and ".." cannot be one. The API's pattern, held together by a test.
export const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;
const KEY_MAX = 512;

/** Refuses anything that is not a key the database writes, before a storage is touched. */
export function assertStorageKey(key: string): void {
  if (key.length > KEY_MAX || !KEY_PATTERN.test(key)) {
    throw new FileReadError('key');
  }
}

/** Tests: objects in memory; `failing` makes get fail; `calls` records the keys asked for. */
export class MemoryFileReader implements FileReader {
  readonly objects = new Map<string, Buffer>();
  readonly calls: string[] = [];
  failing = false;

  get(key: string, maxBytes: number): Promise<Buffer | null> {
    // Refused as the other readers refuse: through the promise, never thrown at the caller.
    if (key.length > KEY_MAX || !KEY_PATTERN.test(key)) {
      return Promise.reject(new FileReadError('key'));
    }
    this.calls.push(key);
    if (this.failing) return Promise.reject(new FileReadError('get', 503));
    const found = this.objects.get(key);
    if (!found) return Promise.resolve(null);
    if (found.length > maxBytes) return Promise.reject(new FileReadError('too_large'));
    return Promise.resolve(Buffer.from(found));
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Local development: the folder the API's DiskFileStorage writes (FILE_STORAGE_DIR). Opens files
 * for reading and does nothing else. Never used in production (env.ts refuses it there).
 */
export class DiskFileReader implements FileReader {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new Error('The folder of the file storage must be an absolute path');
    }
    this.#root = resolve(root);
  }

  async get(key: string, maxBytes: number): Promise<Buffer | null> {
    assertStorageKey(key);
    const path = resolve(join(this.#root, ...key.split('/')));
    if (!path.startsWith(this.#root + sep)) {
      throw new FileReadError('key');
    }
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      if (isMissing(error)) return null;
      throw new FileReadError('get');
    }
    try {
      const { size } = await handle.stat();
      if (size > maxBytes) throw new FileReadError('too_large');
      return await handle.readFile();
    } catch (error) {
      throw error instanceof FileReadError ? error : new FileReadError('get');
    } finally {
      await handle.close();
    }
  }
}

// A file agents read is at most 20 MB.
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Supabase Storage through its HTTP interface, with a token that can only read the one bucket
 * (the test and the production environment):
 *
 *   get  GET <url>/storage/v1/object/<bucket>/<key>
 *        apikey: <publishable key>   authorization: Bearer <read token>
 *
 * The token is the JWT of the database role office_file_reader (docs/supabase-kurulum.md section
 * 9); the worker is never given the project's secret key. No other request is ever sent.
 */
export class SupabaseFileReader implements FileReader {
  readonly #base: string;
  readonly #publishableKey: string;
  readonly #readToken: string;
  readonly #fetch: typeof fetch;

  constructor(settings: SupabaseReadSettings, fetcher: typeof fetch = fetch) {
    this.#base = `${settings.url}/storage/v1/object/${settings.bucket}`;
    this.#publishableKey = settings.publishableKey;
    this.#readToken = settings.readToken;
    this.#fetch = fetcher;
  }

  async get(key: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer | null> {
    assertStorageKey(key);
    const limit = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}/${key}`, {
        method: 'GET',
        headers: {
          apikey: this.#publishableKey,
          authorization: `Bearer ${this.#readToken}`,
          'user-agent': 'agent-office-worker',
        },
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, limit]) : limit,
      });
    } catch {
      // The cause can name the address; it is not kept.
      throw new FileReadError('get');
    }
    if (!response.ok) {
      // A missing object is answered with 404; older versions of the service answer 400 with a
      // body that says 404.
      let missing = response.status === 404;
      if (response.status === 400) {
        const body: unknown = await response.json().catch(() => null);
        const said = body as { statusCode?: unknown; error?: unknown } | null;
        missing = said?.statusCode === '404' || said?.error === 'not_found';
      } else {
        await response.body?.cancel();
      }
      if (missing) return null;
      throw new FileReadError('get', response.status);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new FileReadError('too_large');
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    const body = response.body as ReadableStream<Uint8Array> | null;
    const reader = body?.getReader();
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          await reader.cancel();
          throw new FileReadError('too_large');
        }
        chunks.push(value);
      }
    } catch (error) {
      throw error instanceof FileReadError ? error : new FileReadError('get');
    }
    return Buffer.concat(chunks);
  }
}

/** The reader an environment is set up with; null when it has none. */
export function createFileReader(settings: FileReaderSettings | null): FileReader | null {
  if (settings === null) return null;
  return settings.kind === 'disk'
    ? new DiskFileReader(settings.dir)
    : new SupabaseFileReader(settings);
}
