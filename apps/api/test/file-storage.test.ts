import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DiskFileStorage,
  FileStorageError,
  MemoryFileStorage,
  SupabaseFileStorage,
  assertStorageKey,
  createFileStorage,
  type FileStorage,
} from '../src/files/storage.ts';
import { ByteBudget, ProjectFileStore, uploadDeadlineMs } from '../src/files/store.ts';
import { UploadTickets } from '../src/files/ticket.ts';

const COMPANY = '00000000-0000-4000-8000-000000000001';
const KEY = `${COMPANY}/projects/00000000-0000-4000-8000-000000000031/00000000-0000-4000-8000-000000000999`;
// Shaped like a secret key of Supabase, and put together here so that no line of the repository
// holds one (the secret scan reads every line).
const SECRET = `sb_secret_${'placeholder'.repeat(2)}`;

async function failure(work: Promise<unknown>): Promise<FileStorageError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof FileStorageError) return error;
    throw error;
  }
  throw new Error('Expected a storage error');
}

describe('a storage key', () => {
  it('is a company id and plain segments; nothing else reaches a storage', () => {
    for (const good of [KEY, `${COMPANY}/report.pdf`, `${COMPANY}/a_b/c-d.e`]) {
      expect(() => {
        assertStorageKey(good);
      }, good).not.toThrow();
    }
    for (const bad of [
      '',
      COMPANY,
      `${COMPANY}/`,
      `/${KEY}`,
      `${COMPANY}/../x`,
      `${COMPANY}/./x`,
      `${COMPANY}/.x`,
      `${COMPANY}//x`,
      `${COMPANY}/a\\b`,
      `${COMPANY}/a b`,
      `${COMPANY}/a%2Fb`,
      `${COMPANY}/a?x=1`,
      `${COMPANY}/a#b`,
      `x/${KEY}`,
      `ABCDEF01-0000-4000-8000-000000000001/x`,
      `${COMPANY}/${'a'.repeat(600)}`,
      `${COMPANY}/a\n`,
    ]) {
      expect(() => {
        assertStorageKey(bad);
      }, JSON.stringify(bad)).toThrow(FileStorageError);
    }
  });
});

function contract(name: string, make: () => FileStorage): void {
  describe(`${name}: what every storage does`, () => {
    it('gives back what was put, replaces it, removes it, and removes nothing twice', async () => {
      const storage = make();
      expect(await storage.get(KEY, 100)).toBeNull();
      await storage.put(KEY, Buffer.from('bir'), 'text/plain');
      expect((await storage.get(KEY, 100))?.toString()).toBe('bir');
      await storage.put(KEY, Buffer.from('iki'), 'text/plain');
      expect((await storage.get(KEY, 100))?.toString()).toBe('iki');
      expect((await failure(storage.get(KEY, 2))).operation).toBe('too_large');
      await storage.remove(KEY);
      expect(await storage.get(KEY, 100)).toBeNull();
      await storage.remove(KEY);
    });

    it('refuses a key that is not one', async () => {
      const storage = make();
      const bad = `${COMPANY}/../../etc/passwd`;
      expect(
        (
          await failure(
            Promise.resolve().then(() => storage.put(bad, Buffer.from('x'), 'text/plain')),
          )
        ).operation,
      ).toBe('key');
      expect((await failure(Promise.resolve().then(() => storage.get(bad, 10)))).operation).toBe(
        'key',
      );
      expect((await failure(Promise.resolve().then(() => storage.remove(bad)))).operation).toBe(
        'key',
      );
    });
  });
}

contract('memory', () => new MemoryFileStorage());

describe('the folder storage of local development', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-office-files-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  contract('disk', () => new DiskFileStorage(dir));

  it('writes under its folder only and leaves no partial file', async () => {
    const storage: FileStorage = new DiskFileStorage(dir);
    await storage.put(KEY, Buffer.from('x'), 'text/plain');
    const folder = join(dir, ...KEY.split('/').slice(0, -1));
    expect(await readdir(folder)).toEqual([KEY.split('/').at(-1)]);
    await storage.remove(KEY);
    expect(() => new DiskFileStorage('relative/folder')).toThrow();
  });
});

/** A stand-in for Supabase Storage: three calls, objects in a map. */
function fakeSupabase() {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; url: string; headers: Headers; body: unknown }[] = [];
  let mode: 'ok' | 'down' | 'unreachable' | 'old_missing' = 'ok';
  const fetcher: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    requests.push({ method, url, headers: new Headers(init?.headers), body: init?.body });
    if (mode === 'unreachable') return Promise.reject(new TypeError(`fetch failed: ${url}`));
    if (mode === 'down')
      return Promise.resolve(new Response(`{"message":"${url}"}`, { status: 503 }));
    const prefix = 'https://ref.supabase.co/storage/v1/object/office-files';
    if (method === 'POST') {
      objects.set(url.slice(prefix.length + 1), Buffer.from(init?.body as Uint8Array));
      return Promise.resolve(Response.json({ Key: 'x' }));
    }
    if (method === 'GET') {
      const found = objects.get(url.slice(prefix.length + 1));
      if (found)
        return Promise.resolve(
          new Response(new Uint8Array(found), {
            headers: { 'content-length': String(found.length) },
          }),
        );
      return Promise.resolve(
        mode === 'old_missing'
          ? Response.json(
              { statusCode: '404', error: 'not_found', message: 'Object not found' },
              { status: 400 },
            )
          : Response.json(
              { statusCode: '404', error: 'not_found', message: 'Object not found' },
              { status: 404 },
            ),
      );
    }
    const { prefixes } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      prefixes: string[];
    };
    for (const key of prefixes) objects.delete(key);
    return Promise.resolve(Response.json([]));
  };
  return {
    fetcher,
    objects,
    requests,
    set: (next: typeof mode) => {
      mode = next;
    },
  };
}

describe('the Supabase storage', () => {
  const settings = { url: 'https://ref.supabase.co', key: SECRET, bucket: 'office-files' };
  const fake = fakeSupabase();
  contract('supabase', () => new SupabaseFileStorage(settings, fake.fetcher));

  it('sends the three calls as the service expects them, with the key in two headers', async () => {
    const calls = fakeSupabase();
    const storage = new SupabaseFileStorage(settings, calls.fetcher);
    await storage.put(KEY, Buffer.from('abc'), 'application/pdf');
    await storage.get(KEY, 10);
    await storage.remove(KEY);
    expect(calls.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST https://ref.supabase.co/storage/v1/object/office-files/${KEY}`,
      `GET https://ref.supabase.co/storage/v1/object/office-files/${KEY}`,
      'DELETE https://ref.supabase.co/storage/v1/object/office-files',
    ]);
    const [put, , remove] = calls.requests;
    expect(put?.headers.get('apikey')).toBe(SECRET);
    expect(put?.headers.get('authorization')).toBe(`Bearer ${SECRET}`);
    expect(put?.headers.get('x-upsert')).toBe('true');
    expect(put?.headers.get('content-type')).toBe('application/pdf');
    expect(remove?.body).toBe(JSON.stringify({ prefixes: [KEY] }));
  });

  it('reads a missing object from either answer of the service', async () => {
    const calls = fakeSupabase();
    const storage = new SupabaseFileStorage(settings, calls.fetcher);
    expect(await storage.get(KEY, 10)).toBeNull();
    calls.set('old_missing');
    expect(await storage.get(KEY, 10)).toBeNull();
  });

  it('fails without telling the key, the address or the secret', async () => {
    const calls = fakeSupabase();
    const storage = new SupabaseFileStorage(settings, calls.fetcher);
    for (const mode of ['down', 'unreachable'] as const) {
      calls.set(mode);
      const errors = [
        await failure(storage.put(KEY, Buffer.from('x'), 'text/plain')),
        await failure(storage.get(KEY, 10)),
        await failure(storage.remove(KEY)),
      ];
      expect(errors.map((error) => error.operation)).toEqual(['put', 'get', 'remove']);
      for (const error of errors) {
        const text = `${error.message} ${String(error.stack)} ${JSON.stringify(error)} ${String(error.cause)}`;
        expect(text).not.toContain(SECRET);
        expect(text).not.toContain('supabase.co');
        expect(text).not.toContain(COMPANY);
        expect(error.status).toBe(mode === 'down' ? 503 : undefined);
      }
    }
  });
});

describe('the settings of an environment', () => {
  it('give a storage, or none', () => {
    expect(createFileStorage(null)).toBeNull();
    expect(createFileStorage({ kind: 'disk', dir: tmpdir() })).toBeInstanceOf(DiskFileStorage);
    expect(
      createFileStorage({
        kind: 'supabase',
        url: 'https://ref.supabase.co',
        key: SECRET,
        bucket: 'office-files',
      }),
    ).toBeInstanceOf(SupabaseFileStorage);
  });
});

describe('the store and the budget', () => {
  it('gives no bytes for a record it did not read itself', async () => {
    const store = new ProjectFileStore(new MemoryFileStorage());
    const row = {
      id: 'x',
      project_id: 'p',
      name: 'a.txt',
      mime_type: 'text/plain',
      size_bytes: 1,
      sha256: 'a',
      storage_path: KEY,
      created_at: new Date(),
      created_by_user_id: null,
      deletable: false,
    };
    await expect(store.content(row)).rejects.toThrow('not read through find');
    expect(new ProjectFileStore(null).available).toBe(false);
  });

  it('counts the bytes that are on their way', () => {
    const budget = new ByteBudget(10);
    expect(budget.reserve(6)).toBe(true);
    expect(budget.reserve(5)).toBe(false);
    expect(budget.reserve(4)).toBe(true);
    budget.release(6);
    expect(budget.reserved).toBe(4);
    budget.release(100);
    expect(budget.reserved).toBe(0);
  });

  it('gives the body of an upload half a minute and the time of 64 KB a second', () => {
    expect(uploadDeadlineMs(1)).toBe(31_000);
    expect(uploadDeadlineMs(64 * 1024)).toBe(31_000);
    expect(uploadDeadlineMs(1024 * 1024)).toBe(46_000);
    expect(uploadDeadlineMs(25 * 1024 * 1024)).toBe(430_000);
  });
});

describe('the upload ticket', () => {
  const SECRET = 's'.repeat(48);
  const claim = {
    sessionKeyHash: Buffer.alloc(32, 7),
    companyId: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000031',
    fileId: '00000000-0000-4000-8000-000000000131',
    sizeBytes: 1200,
  };
  const at = (ms: number) => () => ms;
  const T0 = 1_791_500_000_000;

  it('is good for exactly the upload it was given for, for a minute', () => {
    const tickets = new UploadTickets(SECRET, at(T0));
    const { ticket, expiresAt } = tickets.issue(claim);
    expect(ticket).toMatch(/^\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(T0 + 60_000);
    expect(tickets.verify(ticket, claim)).toBe(true);
    // The ids are compared whatever their case.
    expect(tickets.verify(ticket, { ...claim, fileId: claim.fileId.toUpperCase() })).toBe(true);
    const others = {
      session: { ...claim, sessionKeyHash: Buffer.alloc(32, 8) },
      company: { ...claim, companyId: '00000000-0000-4000-8000-000000000002' },
      project: { ...claim, projectId: '00000000-0000-4000-8000-000000000032' },
      file: { ...claim, fileId: '00000000-0000-4000-8000-000000000132' },
      size: { ...claim, sizeBytes: 1201 },
    };
    for (const [what, other] of Object.entries(others)) {
      expect(tickets.verify(ticket, other), what).toBe(false);
    }
    expect(new UploadTickets(SECRET, at(T0 + 59_000)).verify(ticket, claim)).toBe(true);
    expect(new UploadTickets(SECRET, at(T0 + 60_000)).verify(ticket, claim)).toBe(false);
    // A ticket that ends later than a ticket of this moment could: not one of ours.
    expect(new UploadTickets(SECRET, at(T0 - 2_000)).verify(ticket, claim)).toBe(false);
    expect(new UploadTickets('t'.repeat(48), at(T0)).verify(ticket, claim)).toBe(false);
  });

  it('takes nothing that is not a ticket, and signs nothing that is not an upload', () => {
    const tickets = new UploadTickets(SECRET, at(T0));
    const { ticket } = tickets.issue(claim);
    const [expires = '', mac = ''] = ticket.split('.');
    for (const bad of [
      undefined,
      '',
      ['a', 'b'],
      mac,
      `${expires}.`,
      `${expires}.${mac}x`,
      `${expires}.${mac.slice(0, -1)}`,
      `${String(Number(expires) + 1)}.${mac}`,
      `${expires}.${'A'.repeat(43)}`,
      ` ${ticket}`,
    ]) {
      expect(tickets.verify(bad, claim), JSON.stringify(bad)).toBe(false);
    }
    expect(() => tickets.issue({ ...claim, projectId: '../x' })).toThrow('three ids');
    expect(() => tickets.issue({ ...claim, sizeBytes: 1.5 })).toThrow('three ids');
    expect(tickets.verify(ticket, { ...claim, companyId: 'x\ny' })).toBe(false);
  });
});
