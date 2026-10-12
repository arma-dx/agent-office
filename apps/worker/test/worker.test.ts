import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileReaderSettings, loadWorkerEnv } from '../src/env.ts';
import { describeWorker, handleDeadLetterJob } from '../src/worker.ts';

const DATABASE = 'postgresql://office_worker@127.0.0.1:5432/postgres';
const KEY = `sk-ant-${'x'.repeat(40)}`;

describe('the worker’s environment', () => {
  it('starts without a Claude API key outside production and says so', () => {
    const env = loadWorkerEnv({ NODE_ENV: 'test', WORKER_DATABASE_URL: DATABASE });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(describeWorker(env)).toBe('worker:pgboss:test:no-model');
    // An empty value in .env is the same as no value.
    const empty = loadWorkerEnv({
      WORKER_DATABASE_URL: DATABASE,
      ANTHROPIC_API_KEY: '',
      WORKER_CONCURRENCY: '',
    });
    expect(empty.ANTHROPIC_API_KEY).toBeUndefined();
    expect(
      describeWorker(loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ANTHROPIC_API_KEY: KEY })),
    ).toBe('worker:pgboss:development:model');
  });

  it('needs its own database address, and the key in production', () => {
    expect(() => loadWorkerEnv({ NODE_ENV: 'test' })).toThrow(/WORKER_DATABASE_URL/);
    expect(() => loadWorkerEnv({ NODE_ENV: 'production', WORKER_DATABASE_URL: DATABASE })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('refuses to start with headers the SDK would add to every model request', () => {
    // No option of the SDK switches ANTHROPIC_CUSTOM_HEADERS off, so the worker does not start
    // with it; the error names the variable and never its value.
    let message = '';
    try {
      loadWorkerEnv({
        WORKER_DATABASE_URL: DATABASE,
        ANTHROPIC_API_KEY: KEY,
        ANTHROPIC_CUSTOM_HEADERS: 'anthropic-beta: injected-by-env',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('ANTHROPIC_CUSTOM_HEADERS');
    expect(message).not.toContain('injected-by-env');
    // An empty value in .env is the same as no value.
    expect(() =>
      loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ANTHROPIC_CUSTOM_HEADERS: '' }),
    ).not.toThrow();
  });

  it('never shows a value in an error', () => {
    let message = '';
    try {
      loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ANTHROPIC_API_KEY: 'short-secret' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('ANTHROPIC_API_KEY');
    expect(message).not.toContain('short-secret');
  });
});

// What the worker reads project files from (8 October decision 21; CLAUDE.md rule 9).
describe('the worker’s file storage settings', () => {
  /** A token of the given role, shaped as Supabase signs it; built here, never written out. */
  const tokenOf = (role: string): string =>
    [{ alg: 'HS256', typ: 'JWT' }, { role }, 'signature-of-the-test']
      .map((part) =>
        Buffer.from(typeof part === 'string' ? part : JSON.stringify(part)).toString('base64url'),
      )
      .join('.');
  const READ_TOKEN = tokenOf('office_file_reader');
  const PUBLISHABLE = ['sb', 'publishable', 'p'.repeat(24)].join('_');
  const SECRET = ['sb', 'secret', 's'.repeat(32)].join('_');
  const SUPABASE = {
    SUPABASE_URL: 'https://abcdefgh.supabase.co',
    SUPABASE_STORAGE_BUCKET: 'office-files',
    SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    SUPABASE_STORAGE_READ_TOKEN: READ_TOKEN,
  };
  const load = (values: Record<string, string>) =>
    loadWorkerEnv({ WORKER_DATABASE_URL: DATABASE, ...values });
  const messageOf = (values: Record<string, string>): string => {
    try {
      load(values);
    } catch (error) {
      return error instanceof Error ? error.message : '';
    }
    return '';
  };

  it('nothing set is valid and gives no reader', () => {
    expect(fileReaderSettings(load({}))).toBeNull();
    // Empty values in .env are the same as none.
    expect(
      fileReaderSettings(
        load({
          FILE_STORAGE_DIR: '',
          SUPABASE_URL: '',
          SUPABASE_STORAGE_BUCKET: '',
          SUPABASE_PUBLISHABLE_KEY: '',
          SUPABASE_STORAGE_READ_TOKEN: '',
          SUPABASE_SECRET_KEY: '',
        }),
      ),
    ).toBeNull();
    // The API's own Supabase values alone (one .env for both, outside production): no reader,
    // because the worker never reads with the secret key.
    expect(
      fileReaderSettings(
        load({
          SUPABASE_URL: SUPABASE.SUPABASE_URL,
          SUPABASE_STORAGE_BUCKET: SUPABASE.SUPABASE_STORAGE_BUCKET,
          SUPABASE_SECRET_KEY: SECRET,
        }),
      ),
    ).toBeNull();
    // Locally: the folder the API writes to.
    expect(fileReaderSettings(load({ FILE_STORAGE_DIR: '/tmp/agent-office-files' }))).toEqual({
      kind: 'disk',
      dir: '/tmp/agent-office-files',
    });
    expect(messageOf({ FILE_STORAGE_DIR: 'relative/folder' })).toContain('FILE_STORAGE_DIR');
  });

  it('the storage values are set together', () => {
    expect(fileReaderSettings(load(SUPABASE))).toEqual({
      kind: 'supabase',
      url: 'https://abcdefgh.supabase.co',
      bucket: 'office-files',
      publishableKey: PUBLISHABLE,
      readToken: READ_TOKEN,
    });
    // A read token wins over a folder.
    expect(
      fileReaderSettings(load({ ...SUPABASE, FILE_STORAGE_DIR: '/tmp/agent-office-files' })),
    ).toMatchObject({ kind: 'supabase' });
    for (const missing of Object.keys(SUPABASE) as (keyof typeof SUPABASE)[]) {
      const rest = Object.fromEntries(
        Object.entries(SUPABASE).filter(([name]) => name !== missing),
      );
      expect(messageOf(rest), missing).toContain(missing);
    }
    // The publishable key alone, and the token alone, name the other one.
    expect(messageOf({ SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })).toContain(
      'SUPABASE_STORAGE_READ_TOKEN',
    );
    expect(messageOf({ SUPABASE_STORAGE_READ_TOKEN: READ_TOKEN })).toContain(
      'SUPABASE_PUBLISHABLE_KEY',
    );
    for (const url of ['http://abcdefgh.supabase.co', 'https://abcdefgh.supabase.co/storage']) {
      expect(messageOf({ ...SUPABASE, SUPABASE_URL: url }), url).toContain('SUPABASE_URL');
    }
    expect(messageOf({ ...SUPABASE, SUPABASE_STORAGE_BUCKET: 'Office Files' })).toContain(
      'SUPABASE_STORAGE_BUCKET',
    );
  });

  it('a secret key as the read token is refused', () => {
    for (const token of [SECRET, tokenOf('service_role'), tokenOf('anon'), 'x'.repeat(40)]) {
      const message = messageOf({ ...SUPABASE, SUPABASE_STORAGE_READ_TOKEN: token });
      expect(message).toContain('SUPABASE_STORAGE_READ_TOKEN');
      expect(message).toContain('office_file_reader');
    }
    // A secret key in the place of the publishable key is refused too.
    expect(messageOf({ ...SUPABASE, SUPABASE_PUBLISHABLE_KEY: SECRET })).toContain(
      'SUPABASE_PUBLISHABLE_KEY',
    );
    // A token that has ended does not keep the worker down: the time is the start's to look at.
    const ended = [{ alg: 'HS256' }, { role: 'office_file_reader', exp: 1 }, 'sig']
      .map((part) =>
        Buffer.from(typeof part === 'string' ? part : JSON.stringify(part)).toString('base64url'),
      )
      .join('.');
    expect(() => load({ ...SUPABASE, SUPABASE_STORAGE_READ_TOKEN: ended })).not.toThrow();
  });

  it('FILE_STORAGE_DIR and SUPABASE_SECRET_KEY are refused in production', () => {
    const production = { NODE_ENV: 'production', ANTHROPIC_API_KEY: KEY };
    expect(() => load({ ...production, ...SUPABASE })).not.toThrow();
    expect(() => load(production)).not.toThrow();
    expect(messageOf({ ...production, FILE_STORAGE_DIR: '/srv/files' })).toContain(
      'FILE_STORAGE_DIR',
    );
    expect(messageOf({ ...production, ...SUPABASE, SUPABASE_SECRET_KEY: SECRET })).toContain(
      'SUPABASE_SECRET_KEY',
    );
    // Outside production one .env serves the API and the worker: the secret key may be there.
    expect(() => load({ ...SUPABASE, SUPABASE_SECRET_KEY: SECRET })).not.toThrow();
    expect(() => load({ FILE_STORAGE_DIR: '/tmp/agent-office-files' })).not.toThrow();
  });

  it('the error names no value', () => {
    const wrong = tokenOf('service_role');
    const messages = [
      messageOf({ ...SUPABASE, SUPABASE_STORAGE_READ_TOKEN: wrong }),
      messageOf({ ...SUPABASE, SUPABASE_PUBLISHABLE_KEY: SECRET }),
      messageOf({ SUPABASE_STORAGE_READ_TOKEN: READ_TOKEN }),
      messageOf({
        NODE_ENV: 'production',
        ANTHROPIC_API_KEY: KEY,
        ...SUPABASE,
        SUPABASE_SECRET_KEY: SECRET,
        FILE_STORAGE_DIR: '/srv/secret-folder',
      }),
      messageOf({ ...SUPABASE, SUPABASE_URL: 'http://private-host.example' }),
    ];
    for (const message of messages) {
      expect(message).not.toBe('');
      for (const value of [
        wrong,
        READ_TOKEN,
        SECRET,
        PUBLISHABLE,
        '/srv/secret-folder',
        'private-host',
      ]) {
        expect(message).not.toContain(value);
      }
    }
  });
});

describe('the dead letter handler', () => {
  const job = {
    companyId: randomUUID(),
    userId: randomUUID(),
    taskId: randomUUID(),
    agentCode: 'SOS-2',
  };

  it('keeps the error it met out of the queue: a bare code is thrown, the log gets kind and state', async () => {
    // What a database error can look like: it quotes the text it refused.
    const refused = Object.assign(new Error('value too long: "Sayın Ayşe Hanım, teklifimiz..."'), {
      code: '22001',
      detail: 'Failing row contains (Sayın Ayşe Hanım ...)',
    });
    const log: [string, Record<string, unknown>][] = [];
    const deps = {
      pool: { connect: () => Promise.reject(refused) } as never,
      log: (event: string, fields: Record<string, unknown>) => {
        log.push([event, fields]);
      },
    };
    let asked = 0;
    const thrown = await handleDeadLetterJob(
      deps,
      () => {
        asked += 1;
        return Promise.resolve();
      },
      job,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    // The queue stores what is thrown, with every field: nothing of the first error is in it.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(refused);
    expect((thrown as Error).message).toBe('dead_letter_error');
    expect((thrown as Error).cause).toBeUndefined();
    expect(Object.keys(thrown as Error)).toEqual([]);
    expect(log).toEqual([['dead_letter_failed', { type: 'Error', state: '22001' }]]);
    // The queue tries the job again (DEAD_LETTER_RETRY); no reminder was asked for meanwhile.
    expect(asked).toBe(0);
  });

  it('a job that is not an agent run job is dropped without touching the database', async () => {
    const deps = {
      pool: {
        connect: () => Promise.reject(new Error('the database must not be asked')),
      } as never,
      log: () => undefined,
    };
    await expect(
      handleDeadLetterJob(deps, () => Promise.resolve(), { ...job, note: 'text' }),
    ).resolves.toBeUndefined();
  });
});
