import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * Where the bytes of a file lie (6 October decision 9: Supabase is used for the database and for
 * file storage; the storage stays behind this one narrow interface, docs/SONRA.md). A key is
 * written by the database on the file's record (office.files.storage_path) and starts with the
 * company's id. Nothing else of the API calls a storage: the routes go through ProjectFileStore
 * (store.ts), which reads the record under the caller's row policies first (CLAUDE.md rule 9).
 * The worker has a reading module of its own, apps/worker/src/files.
 */
export interface FileStorage {
  /** Writes the object; an object that lies under the key already is replaced. */
  put(key: string, content: Buffer, contentType: string): Promise<void>;
  /**
   * The whole object; null when nothing lies under the key. An object larger than maxBytes is an
   * error, never an answer.
   */
  get(key: string, maxBytes: number): Promise<Buffer | null>;
  /** Removes the object; a key that holds nothing is no error. */
  remove(key: string): Promise<void>;
}

export type FileStorageFailure = 'put' | 'get' | 'remove' | 'key' | 'too_large' | 'busy';

/**
 * A storage that could not do what it was asked. The message holds the operation and, for the
 * remote storage, the HTTP status: never a key, a name, an address or the service's own text.
 */
export class FileStorageError extends Error {
  readonly operation: FileStorageFailure;
  readonly status: number | undefined;

  constructor(operation: FileStorageFailure, status?: number) {
    super(
      status === undefined
        ? `File storage failed: ${operation}`
        : `File storage failed: ${operation} (${String(status)})`,
    );
    this.name = 'FileStorageError';
    this.operation = operation;
    this.status = status;
  }
}

// A company id, then one or more segments of letters, digits, ".", "_" and "-"; no segment starts
// with a dot, so "." and ".." cannot be one.
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;
const KEY_MAX = 512;

/** Refuses anything that is not a key the database writes, before a storage is touched. */
export function assertStorageKey(key: string): void {
  if (key.length > KEY_MAX || !KEY_PATTERN.test(key)) {
    throw new FileStorageError('key');
  }
}

/** Keeps the objects in memory: the tests' storage. Can be told to fail, and counts its calls. */
export class MemoryFileStorage implements FileStorage {
  readonly objects = new Map<string, { content: Buffer; contentType: string }>();
  readonly calls: { operation: 'put' | 'get' | 'remove'; key: string }[] = [];
  /** The operations that fail from now on. */
  failing = new Set<'put' | 'get' | 'remove'>();

  put(key: string, content: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    this.calls.push({ operation: 'put', key });
    if (this.failing.has('put')) return Promise.reject(new FileStorageError('put', 503));
    this.objects.set(key, { content: Buffer.from(content), contentType });
    return Promise.resolve();
  }

  get(key: string, maxBytes: number): Promise<Buffer | null> {
    assertStorageKey(key);
    this.calls.push({ operation: 'get', key });
    if (this.failing.has('get')) return Promise.reject(new FileStorageError('get', 503));
    const found = this.objects.get(key);
    if (!found) return Promise.resolve(null);
    if (found.content.length > maxBytes) return Promise.reject(new FileStorageError('too_large'));
    return Promise.resolve(Buffer.from(found.content));
  }

  remove(key: string): Promise<void> {
    assertStorageKey(key);
    this.calls.push({ operation: 'remove', key });
    if (this.failing.has('remove')) return Promise.reject(new FileStorageError('remove', 503));
    this.objects.delete(key);
    return Promise.resolve();
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Keeps the objects as files under one folder of this machine: local development, where no
 * storage service runs (the local Supabase stack runs the database only). Never used in
 * production (apps/api/src/env.ts refuses it there).
 */
export class DiskFileStorage implements FileStorage {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new Error('The folder of the file storage must be an absolute path');
    }
    this.#root = resolve(root);
  }

  #path(key: string): string {
    assertStorageKey(key);
    const path = resolve(join(this.#root, ...key.split('/')));
    if (!path.startsWith(this.#root + sep)) {
      throw new FileStorageError('key');
    }
    return path;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.#path(key);
    // Written beside the target and moved over it, so a reader never sees half a file.
    const partial = `${path}.${randomUUID()}.part`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(partial, content, { flag: 'wx' });
      await rename(partial, path);
    } catch {
      await rm(partial, { force: true }).catch(() => undefined);
      throw new FileStorageError('put');
    }
  }

  async get(key: string, maxBytes: number): Promise<Buffer | null> {
    const path = this.#path(key);
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      if (isMissing(error)) return null;
      throw new FileStorageError('get');
    }
    try {
      const { size } = await handle.stat();
      if (size > maxBytes) throw new FileStorageError('too_large');
      return await handle.readFile();
    } catch (error) {
      throw error instanceof FileStorageError ? error : new FileStorageError('get');
    } finally {
      await handle.close();
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.#path(key);
    try {
      await unlink(path);
    } catch (error) {
      if (!isMissing(error)) throw new FileStorageError('remove');
    }
  }
}

export interface SupabaseStorageSettings {
  /** https://<project ref>.supabase.co, without a path. */
  url: string;
  /** A secret key of the Supabase project. Read from the environment, never logged. */
  key: string;
  bucket: string;
}

// put and get carry up to 25 MB; remove carries a key and runs inside an open transaction.
const REQUEST_TIMEOUT_MS = { put: 30_000, get: 30_000, remove: 10_000 } as const;

/**
 * Supabase Storage through its HTTP interface, with a secret key of the project (the test and the
 * production environment). The bucket is private; nothing but this class holds the key, and the
 * browser never talks to Supabase (rule 1): every byte goes through the API.
 *
 *   put     POST   <url>/storage/v1/object/<bucket>/<key>      x-upsert: true, the bytes
 *   get     GET    <url>/storage/v1/object/<bucket>/<key>
 *   remove  DELETE <url>/storage/v1/object/<bucket>            {"prefixes": ["<key>"]}
 */
export class SupabaseFileStorage implements FileStorage {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;

  constructor(settings: SupabaseStorageSettings, fetcher: typeof fetch = fetch) {
    this.#base = `${settings.url}/storage/v1/object/${settings.bucket}`;
    this.#key = settings.key;
    this.#fetch = fetcher;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.#key,
      authorization: `Bearer ${this.#key}`,
      'user-agent': 'agent-office-api',
      ...extra,
    };
  }

  async #send(
    operation: 'put' | 'get' | 'remove',
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await this.#fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS[operation]),
      });
    } catch {
      // The cause can name the address; it is not kept.
      throw new FileStorageError(operation);
    }
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    const response = await this.#send('put', `${this.#base}/${key}`, {
      method: 'POST',
      headers: this.#headers({
        'content-type': contentType,
        'cache-control': 'no-store',
        'x-upsert': 'true',
      }),
      // A view of the same bytes: a file of 25 MB is not copied to be sent.
      body: new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
    });
    await response.body?.cancel();
    if (!response.ok) throw new FileStorageError('put', response.status);
  }

  async get(key: string, maxBytes: number): Promise<Buffer | null> {
    assertStorageKey(key);
    const response = await this.#send('get', `${this.#base}/${key}`, {
      method: 'GET',
      headers: this.#headers(),
    });
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
      throw new FileStorageError('get', response.status);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new FileStorageError('too_large');
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
          throw new FileStorageError('too_large');
        }
        chunks.push(value);
      }
    } catch (error) {
      throw error instanceof FileStorageError ? error : new FileStorageError('get');
    }
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    assertStorageKey(key);
    const response = await this.#send('remove', this.#base, {
      method: 'DELETE',
      headers: this.#headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: [key] }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new FileStorageError('remove', response.status);
  }
}

/** The storage an environment is set up with; null when it has none. */
export function createFileStorage(
  settings:
    | { kind: 'disk'; dir: string }
    | { kind: 'supabase'; url: string; key: string; bucket: string }
    | null,
): FileStorage | null {
  if (settings === null) return null;
  return settings.kind === 'disk'
    ? new DiskFileStorage(settings.dir)
    : new SupabaseFileStorage(settings);
}
