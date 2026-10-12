import { randomBytes, randomUUID } from 'node:crypto';
import type { FileStorage } from '../src/files/storage.ts';

/**
 * Proves the worker's read token on the real storage (CLAUDE.md rule 9; 8 October decision 21;
 * docs/supabase-kurulum.md section 9). The worker reads project files for agents with a token of
 * a database role that may read the one bucket and nothing else; whether a token really is such
 * a token is not something its shape can say, so it is tried:
 *
 *   reads           the token reads an object the API's own key wrote;
 *   cannot write    it can neither replace that object nor create a new one;
 *   cannot delete   it cannot remove the object;
 *   one bucket      it reads no object of a bucket of another name.
 *
 * "Cannot" is never read from the answer's status alone: the object is read back with the API's
 * own storage. (The storage answers a delete it did not perform with 200, and refuses a second
 * object under one key for every key unless the request asks to replace it: so the write is
 * tried as a replacement, as the API itself writes, and as a new object.)
 *
 * Plain fetch calls: nothing of the worker is imported. It says the operation and the HTTP
 * status; never a key, a token, an address or content.
 */
export interface ReadTokenSettings {
  /** https://<project ref>.supabase.co, without a path. */
  url: string;
  bucket: string;
  /** The project's publishable key; not a secret. */
  publishableKey: string;
  /** The token under test. A secret: never printed. */
  readToken: string;
}

/** A line of the check that did not hold: which one and, where there is one, the HTTP status. */
export class ReadTokenCheckError extends Error {
  readonly check: string;
  readonly status: number | undefined;

  constructor(check: string, status?: number) {
    super(
      status === undefined
        ? `FAIL  ${check}`
        : `FAIL  ${check} (the storage answered ${String(status)})`,
    );
    this.name = 'ReadTokenCheckError';
    this.check = check;
    this.status = status;
  }
}

const NO_COMPANY = '00000000-0000-0000-0000-000000000000';
const REQUEST_TIMEOUT_MS = 30_000;
const SIZE = 1024;

/**
 * Runs the four checks; `say` gets one line per check that held. Throws ReadTokenCheckError at
 * the first that did not. Whatever happens, the objects of the check are removed with the API's
 * own storage before it returns.
 */
export async function checkReadToken(
  storage: FileStorage,
  settings: ReadTokenSettings,
  say: (line: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const base = `${settings.url}/storage/v1/object`;
  const key = `${NO_COMPANY}/check/${randomUUID()}`;
  const fresh = `${NO_COMPANY}/check/${randomUUID()}`;
  const first = randomBytes(SIZE);
  const other = randomBytes(SIZE);
  const send = async (check: string, url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetcher(url, {
        ...init,
        headers: {
          apikey: settings.publishableKey,
          authorization: `Bearer ${settings.readToken}`,
          'user-agent': 'agent-office-check',
          ...(init.headers as Record<string, string> | undefined),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The cause can name the address; it is not kept.
      throw new ReadTokenCheckError(check);
    }
  };
  const write = (check: string, target: string, upsert: boolean): Promise<Response> =>
    send(check, `${base}/${settings.bucket}/${target}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        ...(upsert ? { 'x-upsert': 'true' } : {}),
      },
      body: new Uint8Array(other.buffer, other.byteOffset, other.byteLength),
    });
  /** Is the object the API wrote still what the API wrote. */
  const untouched = async (): Promise<boolean> =>
    (await storage.get(key, SIZE))?.equals(first) === true;

  await storage.put(key, first, 'application/octet-stream');
  try {
    const READS = 'read token reads';
    const got = await send(READS, `${base}/${settings.bucket}/${key}`, { method: 'GET' });
    if (!got.ok) {
      await got.body?.cancel();
      throw new ReadTokenCheckError(READS, got.status);
    }
    if (!Buffer.from(await got.arrayBuffer()).equals(first)) throw new ReadTokenCheckError(READS);
    say(`ok  ${READS}`);

    const WRITES = 'read token cannot write';
    const replaced = await write(WRITES, key, true);
    await replaced.body?.cancel();
    if (replaced.ok || !(await untouched())) throw new ReadTokenCheckError(WRITES, replaced.status);
    const created = await write(WRITES, fresh, false);
    await created.body?.cancel();
    if (created.ok || (await storage.get(fresh, SIZE)) !== null) {
      throw new ReadTokenCheckError(WRITES, created.status);
    }
    say(`ok  ${WRITES}`);

    const DELETES = 'read token cannot delete';
    const removed = await send(DELETES, `${base}/${settings.bucket}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: [key] }),
    });
    await removed.body?.cancel();
    // The status says nothing here: only the object does.
    if (!(await untouched())) throw new ReadTokenCheckError(DELETES, removed.status);
    say(`ok  ${DELETES}`);

    const ONE_BUCKET = 'read token reads one bucket';
    const elsewhere = await send(ONE_BUCKET, `${base}/${settings.bucket}-x/${key}`, {
      method: 'GET',
    });
    await elsewhere.body?.cancel();
    if (elsewhere.ok) throw new ReadTokenCheckError(ONE_BUCKET, elsewhere.status);
    say(`ok  ${ONE_BUCKET}`);
  } finally {
    // Also what a token that could write left behind.
    await storage.remove(key).catch(() => undefined);
    await storage.remove(fresh).catch(() => undefined);
  }
}
