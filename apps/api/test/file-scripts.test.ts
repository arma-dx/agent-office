import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { READ_TOKEN_DAYS, READ_TOKEN_ROLE, mintFileReadToken } from '../scripts/file-read-token.ts';
import {
  ReadTokenCheckError,
  checkReadToken,
  type ReadTokenSettings,
} from '../scripts/read-token-check.ts';
import { MemoryFileStorage } from '../src/files/storage.ts';

// The two scripts around the worker's read token (docs/supabase-kurulum.md section 9), as far as
// they can be held without the real service and without a terminal: what the check reads as
// "cannot write" and "cannot delete", and what a minted token is. The storage service is a stub
// over the API's own storage in memory; no request leaves the machine.

const SETTINGS: ReadTokenSettings = {
  url: 'https://abcdefgh.supabase.co',
  bucket: 'office-files',
  // Shaped like the real values and built here: neither is a key of anything.
  publishableKey: ['sb', 'publishable', 'p'.repeat(24)].join('_'),
  readToken: ['header', 'claims', 'signature'].map((part) => `${part}-of-the-test`).join('.'),
};
const BASE = `${SETTINGS.url}/storage/v1/object`;

interface Rights {
  // 'other': the storage answers 200 with bytes that are not the object's.
  read: boolean | 'other';
  // 'new': the token may create an object; 'replace': it may replace one that exists; 'all': both.
  write: 'none' | 'new' | 'replace' | 'all';
  remove: boolean;
  otherBucket: boolean;
}
const READ_ONLY: Rights = { read: true, write: 'none', remove: false, otherBucket: false };

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  redirect: RequestInit['redirect'];
}

/**
 * The storage service as the check talks to it, with the rights a token has: what it answers,
 * and what it does to the objects the API's storage holds.
 */
function service(
  storage: MemoryFileStorage,
  rights: Rights,
): { fetcher: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const missing = (): Response =>
    Response.json({ statusCode: '404', error: 'not_found' }, { status: 400 });
  const fetcher: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ method, url, headers, redirect: init?.redirect });
    if (!url.startsWith(`${BASE}/`)) return Promise.resolve(new Response(null, { status: 500 }));
    const [bucket = '', ...rest] = url.slice(BASE.length + 1).split('/');
    const key = rest.join('/');
    if (bucket !== SETTINGS.bucket) {
      return Promise.resolve(rights.otherBucket ? new Response(Buffer.from('other')) : missing());
    }
    if (method === 'GET') {
      const found = storage.objects.get(key);
      return Promise.resolve(
        rights.read === 'other'
          ? new Response(Buffer.from('a page of a gateway'))
          : rights.read && found
            ? new Response(new Uint8Array(found.content))
            : missing(),
      );
    }
    if (method === 'POST') {
      const exists = storage.objects.has(key);
      // A second object under one key is refused for every token unless the request asks to
      // replace it.
      if (exists && headers['x-upsert'] !== 'true') {
        return Promise.resolve(new Response(null, { status: 409 }));
      }
      const allowed = exists ? ['replace', 'all'] : ['new', 'all'];
      if (!allowed.includes(rights.write)) {
        return Promise.resolve(new Response(null, { status: 403 }));
      }
      storage.objects.set(key, {
        content: Buffer.from(init?.body as Uint8Array),
        contentType: headers['content-type'] ?? '',
      });
      return Promise.resolve(Response.json({ Key: key }));
    }
    if (method === 'DELETE') {
      const sent = typeof init?.body === 'string' ? init.body : '{}';
      const { prefixes = [] } = JSON.parse(sent) as { prefixes?: string[] };
      if (rights.remove) for (const prefix of prefixes) storage.objects.delete(prefix);
      // Answered with 200 whether or not anything was removed.
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response(null, { status: 405 }));
  };
  return { fetcher, seen };
}

async function check(rights: Rights): Promise<{
  lines: string[];
  error: unknown;
  storage: MemoryFileStorage;
  seen: Seen[];
}> {
  const storage = new MemoryFileStorage();
  const { fetcher, seen } = service(storage, rights);
  const lines: string[] = [];
  let error: unknown = null;
  try {
    await checkReadToken(storage, SETTINGS, (line) => lines.push(line), fetcher);
  } catch (caught) {
    error = caught;
  }
  return { lines, error, storage, seen };
}

describe('the check of the worker’s read token', () => {
  it('a token that only reads passes the four lines, and the check leaves nothing behind', async () => {
    const { lines, error, storage, seen } = await check(READ_ONLY);
    expect(error).toBeNull();
    expect(lines).toEqual([
      'ok  read token reads',
      'ok  read token cannot write',
      'ok  read token cannot delete',
      'ok  read token reads one bucket',
    ]);
    expect(storage.objects.size).toBe(0);
    // Every request went to the storage's object address with the publishable key and the token
    // under test, and followed no redirect.
    expect(seen.map((request) => request.method)).toEqual(['GET', 'POST', 'POST', 'DELETE', 'GET']);
    for (const request of seen) {
      expect(request.url.startsWith(`${BASE}/`)).toBe(true);
      expect(request.headers).toMatchObject({
        apikey: SETTINGS.publishableKey,
        authorization: `Bearer ${SETTINGS.readToken}`,
      });
      expect(request.redirect).toBe('error');
    }
    // The write is tried as the API writes (a replacement) and as a new object.
    expect(seen[1]?.headers['x-upsert']).toBe('true');
    expect(seen[2]?.headers['x-upsert']).toBeUndefined();
    expect(seen[2]?.url).not.toBe(seen[1]?.url);
    // The last read names another bucket.
    expect(seen[4]?.url.startsWith(`${BASE}/${SETTINGS.bucket}-x/`)).toBe(true);
  });

  it('a token that can write fails, whether it replaces an object, only creates one, or both', async () => {
    for (const write of ['all', 'new', 'replace'] as const) {
      const { lines, error, storage } = await check({ ...READ_ONLY, write });
      expect(lines, write).toEqual(['ok  read token reads']);
      expect(error, write).toBeInstanceOf(ReadTokenCheckError);
      expect((error as ReadTokenCheckError).check, write).toBe('read token cannot write');
      // What the token wrote is removed again with the API's own storage.
      expect(storage.objects.size, write).toBe(0);
    }
  });

  it('a token that can delete fails, although the storage answers a delete with 200 either way', async () => {
    const { lines, error, storage } = await check({ ...READ_ONLY, remove: true });
    expect(lines).toEqual(['ok  read token reads', 'ok  read token cannot write']);
    expect(error).toBeInstanceOf(ReadTokenCheckError);
    expect((error as ReadTokenCheckError).check).toBe('read token cannot delete');
    expect(storage.objects.size).toBe(0);
  });

  it('a token that reads another bucket fails', async () => {
    const { lines, error } = await check({ ...READ_ONLY, otherBucket: true });
    expect(lines).toHaveLength(3);
    expect((error as ReadTokenCheckError).check).toBe('read token reads one bucket');
  });

  it('a token that cannot read fails at the first line; the error names the line and the status and nothing else', async () => {
    const { lines, error, storage } = await check({ ...READ_ONLY, read: false });
    expect(lines).toEqual([]);
    expect(error).toBeInstanceOf(ReadTokenCheckError);
    const message = (error as ReadTokenCheckError).message;
    expect(message).toBe('FAIL  read token reads (the storage answered 400)');
    expect(storage.objects.size).toBe(0);

    // An answer of 200 that is not the object's bytes is no read.
    const other = await check({ ...READ_ONLY, read: 'other' });
    expect(other.lines).toEqual([]);
    expect((other.error as ReadTokenCheckError).message).toBe('FAIL  read token reads');

    // A storage that does not answer at all: the line, and no address.
    const down = new MemoryFileStorage();
    const failed = await checkReadToken(
      down,
      SETTINGS,
      () => undefined,
      () => Promise.reject(new Error(`connect ECONNREFUSED ${SETTINGS.url}`)),
    ).catch((caught: unknown) => caught);
    expect(failed).toBeInstanceOf(ReadTokenCheckError);
    for (const said of [message, (failed as ReadTokenCheckError).message]) {
      for (const secret of [SETTINGS.readToken, SETTINGS.publishableKey, 'supabase.co']) {
        expect(said).not.toContain(secret);
      }
    }
    expect(down.objects.size).toBe(0);
  });
});

describe('the worker’s read token as it is minted', () => {
  // Built here; the secret of no project.
  const SECRET = ['the', 'jwt', 'secret', 'of', 'a', 'test', 'project'].join('-');
  const NOW = Date.parse('2026-10-12T09:00:00Z');
  const decode = (part: string | undefined): unknown =>
    JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8'));

  it('is an HS256 token of the reader role that ends after 400 days', () => {
    const { token, endsOn } = mintFileReadToken(SECRET, NOW);
    const [header, claims, signature] = token.split('.');
    expect(token.split('.')).toHaveLength(3);
    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const iat = Math.floor(NOW / 1000);
    expect(decode(claims)).toEqual({
      role: READ_TOKEN_ROLE,
      iss: 'agent-office',
      iat,
      exp: iat + READ_TOKEN_DAYS * 86_400,
    });
    expect([READ_TOKEN_ROLE, READ_TOKEN_DAYS]).toEqual(['office_file_reader', 400]);
    expect(endsOn).toBe('2027-11-16');
    // Signed with the secret it was given, over the first two parts.
    expect(signature).toBe(
      createHmac('sha256', SECRET)
        .update(`${header ?? ''}.${claims ?? ''}`)
        .digest('base64url'),
    );
    expect(mintFileReadToken(`${SECRET}-other`, NOW).token.split('.')[2]).not.toBe(signature);
    // The secret itself is in no part of the token.
    expect(token).not.toContain(SECRET);
    expect(Buffer.from(claims ?? '', 'base64url').toString('utf8')).not.toContain(SECRET);
  });
});
