import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { READ_TOKEN_ROLE, mintFileReadToken } from '../../api/scripts/file-read-token.ts';
import { FILE_READER_ROLE, readTokenDaysLeft, readTokenProblem } from '../src/files/read-token.ts';
import {
  DiskFileReader,
  FileReadError,
  KEY_PATTERN,
  MemoryFileReader,
  SupabaseFileReader,
  assertStorageKey,
  createFileReader,
} from '../src/files/reader.ts';

// The worker's side of the file storage (CLAUDE.md rule 9; 8 October decision 21): it reads and
// does nothing else. No request leaves the machine: the remote reader gets a stub fetch.

const COMPANY = '00000000-0000-4000-8000-000000000001';
const KEY = `${COMPANY}/projects/${randomUUID()}/${randomUUID()}`;
const BYTES = Buffer.from('%PDF-1.4 the bytes of a file');
const NOT_KEYS = [
  '../x',
  '/etc/passwd',
  'projects/a/b',
  COMPANY,
  `${COMPANY}/`,
  `${COMPANY}/../x`,
  `${COMPANY}/projects/./x`,
  `${COMPANY}/projects//x`,
  `${COMPANY}/.hidden`,
  `${COMPANY}/a b`,
  `${COMPANY}/a\\b`,
  `${COMPANY}/${'a'.repeat(600)}`,
  '',
];

async function failureOf(work: Promise<unknown>): Promise<FileReadError> {
  const thrown: unknown = await work.then(
    () => null,
    (error: unknown) => error,
  );
  if (!(thrown instanceof FileReadError)) throw new Error('The read did not fail as expected');
  return thrown;
}

/** A token as Supabase would sign it: three base64url parts. Built here, never written out. */
function token(claims: unknown, secret = 'a-test-secret-of-this-file'): string {
  const part = (value: unknown): string =>
    Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const SETTINGS = {
  url: 'https://storage.example.test',
  bucket: 'office-files',
  publishableKey: ['sb', 'publishable', 'p'.repeat(24)].join('_'),
  readToken: token({ role: FILE_READER_ROLE }),
};

interface Sent {
  url: string;
  init: RequestInit;
}

function stub(answer: (init: RequestInit) => Response | Promise<Response>): {
  sent: Sent[];
  fetch: typeof fetch;
} {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init = {}) => {
      sent.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return Promise.resolve(answer(init));
    },
  };
}

describe('the worker’s file reader', () => {
  let folder = '';
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'agent-office-reader-'));
    const path = join(folder, 'store', ...KEY.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, BYTES);
    // A file beside the storage folder: nothing may reach it.
    await writeFile(join(folder, 'outside'), 'not a stored object');
  });
  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('the memory and the disk reader give the bytes, null for a missing key, and refuse a key that is no key', async () => {
    const memory = new MemoryFileReader();
    memory.objects.set(KEY, BYTES);
    const disk = new DiskFileReader(join(folder, 'store'));
    for (const reader of [memory, disk]) {
      expect(await reader.get(KEY, BYTES.length)).toEqual(BYTES);
      expect(
        await reader.get(`${COMPANY}/projects/${randomUUID()}/${randomUUID()}`, 100),
      ).toBeNull();
      for (const bad of NOT_KEYS) {
        expect((await failureOf(reader.get(bad, 100))).operation, bad).toBe('key');
      }
    }
    // The memory reader hands out a copy and remembers what it was asked for (never a refused key).
    const copy = await memory.get(KEY, BYTES.length);
    copy?.fill(0);
    expect(memory.objects.get(KEY)).toEqual(BYTES);
    expect(new Set(memory.calls).has(KEY)).toBe(true);
    expect(memory.calls.some((key) => NOT_KEYS.includes(key))).toBe(false);
    for (const bad of NOT_KEYS) {
      expect(() => {
        assertStorageKey(bad);
      }, bad).toThrow(FileReadError);
    }
    expect(() => {
      assertStorageKey(KEY);
    }).not.toThrow();
  });

  it('the disk reader reads only under its folder', async () => {
    expect(() => new DiskFileReader('relative/folder')).toThrow(/absolute/);
    // A reader of an inner folder does not reach the object of the outer one, by any key.
    const inner = new DiskFileReader(join(folder, 'store', COMPANY));
    expect(await inner.get(KEY, 100)).toBeNull();
    const disk = new DiskFileReader(join(folder, 'store'));
    for (const escape of [`${COMPANY}/../../outside`, `${COMPANY}/..`, '../outside']) {
      expect((await failureOf(disk.get(escape, 100))).operation, escape).toBe('key');
    }
    // A folder is not an object.
    expect((await failureOf(disk.get(`${COMPANY}/projects`, 100))).operation).toBe('get');
    // Nothing was written, moved or removed by reading.
    expect(await readFile(join(folder, 'outside'), 'utf8')).toBe('not a stored object');
  });

  it('an object larger than asked for is an error', async () => {
    const memory = new MemoryFileReader();
    memory.objects.set(KEY, BYTES);
    const disk = new DiskFileReader(join(folder, 'store'));
    // Declared by the service, and not declared (the body is given up while it is read).
    const declared = new SupabaseFileReader(
      SETTINGS,
      stub(() => new Response(BYTES, { headers: { 'content-length': String(BYTES.length) } }))
        .fetch,
    );
    const streamed = new SupabaseFileReader(
      SETTINGS,
      stub(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(BYTES.subarray(0, 10)));
                controller.enqueue(new Uint8Array(BYTES.subarray(10)));
                controller.close();
              },
            }),
          ),
      ).fetch,
    );
    for (const reader of [memory, disk, declared, streamed]) {
      expect((await failureOf(reader.get(KEY, BYTES.length - 1))).operation).toBe('too_large');
      expect(await reader.get(KEY, BYTES.length)).toEqual(BYTES);
    }
  });

  it('the Supabase reader sends the publishable key and the read token, follows no redirect and reads 404 as missing', async () => {
    const { sent, fetch } = stub(() => new Response(BYTES));
    const reader = new SupabaseFileReader(SETTINGS, fetch);
    expect(await reader.get(KEY, 1000)).toEqual(BYTES);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`https://storage.example.test/storage/v1/object/office-files/${KEY}`);
    expect(sent[0]?.init.method).toBe('GET');
    expect(sent[0]?.init.redirect).toBe('error');
    expect(sent[0]?.init.body).toBeUndefined();
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new Headers(sent[0]?.init.headers).entries())).toEqual({
      apikey: SETTINGS.publishableKey,
      authorization: `Bearer ${SETTINGS.readToken}`,
      'user-agent': 'agent-office-worker',
    });
    // A missing object: 404, and the older answer (400 with a body that says 404).
    const missing = [
      () => new Response('{"error":"not_found"}', { status: 404 }),
      () => new Response('{"statusCode":"404","error":"not_found"}', { status: 400 }),
      () => new Response('{"statusCode":"404"}', { status: 400 }),
    ];
    for (const answer of missing) {
      expect(await new SupabaseFileReader(SETTINGS, stub(answer).fetch).get(KEY, 1000)).toBeNull();
    }
    // The run's own signal ends the request.
    const controller = new AbortController();
    const waiting = new SupabaseFileReader(SETTINGS, (_input, init) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });
    const pending = failureOf(waiting.get(KEY, 1000, controller.signal));
    controller.abort();
    expect((await pending).operation).toBe('get');
    // A key that is no key is refused before anything is sent.
    const refused = stub(() => new Response(BYTES));
    await failureOf(new SupabaseFileReader(SETTINGS, refused.fetch).get('../x', 10));
    expect(refused.sent).toEqual([]);
    // createFileReader builds the one the settings name, and none without settings.
    expect(createFileReader(null)).toBeNull();
    expect(createFileReader({ kind: 'supabase', ...SETTINGS })).toBeInstanceOf(SupabaseFileReader);
    expect(createFileReader({ kind: 'disk', dir: folder })).toBeInstanceOf(DiskFileReader);
  });

  it('a failing storage says the operation and the status and nothing else', async () => {
    const SERVICE_TEXT = 'row-level security policy violated for office-files';
    for (const status of [400, 401, 403, 500, 503]) {
      const error = await failureOf(
        new SupabaseFileReader(
          SETTINGS,
          stub(() => new Response(JSON.stringify({ message: SERVICE_TEXT }), { status })).fetch,
        ).get(KEY, 1000),
      );
      expect({ operation: error.operation, status: error.status }).toEqual({
        operation: 'get',
        status,
      });
      expect(error.message).toBe(`File read failed: get (${String(status)})`);
    }
    // A connection that fails: the cause can name the address, and is not kept.
    const down = await failureOf(
      new SupabaseFileReader(SETTINGS, () =>
        Promise.reject(new TypeError(`fetch failed: ${SETTINGS.url}/${KEY}`)),
      ).get(KEY, 1000),
    );
    expect(down.message).toBe('File read failed: get');
    expect(down.status).toBeUndefined();
    expect(down.cause).toBeUndefined();
    const memory = new MemoryFileReader();
    memory.failing = true;
    const failed = await failureOf(memory.get(KEY, 1000));
    for (const error of [down, failed]) {
      const text = JSON.stringify([error.message, Object.entries(error)]);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('storage.example');
      expect(text).not.toContain(SETTINGS.readToken);
    }
  });

  it('the key pattern is the API’s', async () => {
    // Read as text: no import across the apps.
    const source = await readFile(
      new URL('../../api/src/files/storage.ts', import.meta.url),
      'utf8',
    );
    const found = /const KEY_PATTERN =\s*\/(.+)\/;/.exec(source);
    expect(found?.[1]).toBe(KEY_PATTERN.source);
    expect(source).toContain('const KEY_MAX = 512;');
    expect(() => {
      assertStorageKey(`${COMPANY}/${'a'.repeat(512 - COMPANY.length - 1)}`);
    }).not.toThrow();
    expect(() => {
      assertStorageKey(`${COMPANY}/${'a'.repeat(512 - COMPANY.length)}`);
    }).toThrow(FileReadError);
  });

  it('a read token must be a JWT of the reader role', () => {
    const now = Date.parse('2026-10-12T09:00:00Z');
    const seconds = Math.floor(now / 1000);
    const part = (text: string): string => Buffer.from(text).toString('base64url');
    const notJwts = [
      // A secret key of the project, and other things that are no token.
      ['sb', 'secret', 'x'.repeat(32)].join('_'),
      'a'.repeat(40),
      // Two parts; four parts; an empty part.
      `${part('{}')}.${part(JSON.stringify({ role: FILE_READER_ROLE }))}`,
      `${token({ role: FILE_READER_ROLE })}.x`,
      `${part('{}')}..${part('x')}`,
      // A payload that is no JSON, and one that is no object.
      `${part('{}')}.${part('role=office_file_reader')}.${part('x')}`,
      `${part('{}')}.${part('"office_file_reader"')}.${part('x')}`,
      `${part('{}')}.${part('["office_file_reader"]')}.${part('x')}`,
      '',
    ];
    for (const value of notJwts) {
      expect(readTokenProblem(value), value.slice(0, 12)).toBe('not_a_jwt');
      expect(readTokenDaysLeft(value, now)).toBeNull();
    }
    for (const role of ['service_role', 'anon', 'authenticated', 'postgres', '', null, 7]) {
      expect(readTokenProblem(token({ role })), String(role)).toBe('wrong_role');
    }
    expect(readTokenProblem(token({}))).toBe('wrong_role');
    expect(readTokenProblem(token({ role: [FILE_READER_ROLE] }))).toBe('wrong_role');

    expect(readTokenProblem(token({ role: FILE_READER_ROLE }))).toBeNull();
    // Without a time the end is not looked at; with one it is.
    const ended = token({ role: FILE_READER_ROLE, exp: seconds - 1 });
    expect(readTokenProblem(ended)).toBeNull();
    expect(readTokenProblem(ended, now)).toBe('expired');
    expect(readTokenDaysLeft(ended, now)).toBe(-1);
    const good = token({ role: FILE_READER_ROLE, exp: seconds + 10 * 86_400 + 60 });
    expect(readTokenProblem(good, now)).toBeNull();
    expect(readTokenDaysLeft(good, now)).toBe(10);
    // A token without an end never ends here (the storage decides).
    expect(readTokenProblem(token({ role: FILE_READER_ROLE }), now)).toBeNull();
    expect(readTokenDaysLeft(token({ role: FILE_READER_ROLE }), now)).toBeNull();
    // The wrong role is said before the end.
    expect(readTokenProblem(token({ role: 'service_role', exp: seconds - 1 }), now)).toBe(
      'wrong_role',
    );
  });

  it('a token made as the mint script makes it is accepted', () => {
    // The script's own function (apps/api/scripts/file-read-token.ts): HS256, the reader role,
    // 400 days. The role is written there and here; this holds the two together.
    const now = Date.parse('2026-10-12T09:00:00Z');
    const secret = ['the', 'jwt', 'secret', 'of', 'a', 'test', 'project'].join('-');
    const { token: minted } = mintFileReadToken(secret, now);
    expect(minted.split('.')).toHaveLength(3);
    expect(READ_TOKEN_ROLE).toBe(FILE_READER_ROLE);
    expect(readTokenProblem(minted)).toBeNull();
    expect(readTokenProblem(minted, now)).toBeNull();
    expect(readTokenDaysLeft(minted, now)).toBe(400);
    expect(readTokenProblem(minted, now + 401 * 86_400_000)).toBe('expired');
  });

  it('the reader has no way to write', () => {
    for (const reader of [MemoryFileReader, DiskFileReader, SupabaseFileReader]) {
      expect(Object.getOwnPropertyNames(reader.prototype).sort(), reader.name).toEqual([
        'constructor',
        'get',
      ]);
    }
  });
});
