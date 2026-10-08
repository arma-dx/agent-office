import {
  agentRunJobSchema,
  createPool,
  withContext,
  type AgentRunJob,
  type AgentRunSender,
} from '@agent-office/db';
import type pg from 'pg';
import { inject } from 'vitest';
import { ids } from '../../api/test/fixtures.ts';
import type { RunnerDeps } from '../src/runner/run.ts';
import type { ScriptedModel } from './scripted-model.ts';

const database = inject('database');
export const noDatabase = database === null;
export { ids };

function url(kind: 'app' | 'worker' | 'admin'): string {
  if (!database) throw new Error('No test database');
  return database[kind];
}

let pools: { app: pg.Pool; worker: pg.Pool; admin: pg.Pool } | undefined;

export function testPools(): { app: pg.Pool; worker: pg.Pool; admin: pg.Pool } {
  pools ??= {
    app: createPool(url('app'), 'worker-test-app', () => undefined),
    worker: createPool(url('worker'), 'worker-test-worker', () => undefined),
    admin: createPool(url('admin'), 'worker-test-admin', () => undefined),
  };
  return pools;
}

export async function closeTestPools(): Promise<void> {
  if (pools) {
    await Promise.all([pools.app.end(), pools.worker.end(), pools.admin.end()]);
    pools = undefined;
  }
}

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * A pool whose statements can be met by something else at a chosen point: `before` runs once, just
 * ahead of the first statement of a transaction whose text contains `marker` (another connection
 * commits something, or the statement is made to fail: what `before` throws is thrown instead of
 * sending it). Everything else goes to the pool unchanged.
 */
export function meeting(pool: pg.Pool, marker: string, before: () => Promise<void>): pg.Pool {
  let met = false;
  const through = (target: object, property: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === 'function' ? (value as AnyFunction).bind(target) : value;
  };
  const wrap = (client: pg.PoolClient): pg.PoolClient =>
    new Proxy(client, {
      get(target, property) {
        if (property !== 'query') return through(target, property);
        return async (...args: unknown[]): Promise<unknown> => {
          if (!met && typeof args[0] === 'string' && args[0].includes(marker)) {
            met = true;
            await before();
          }
          return (target.query as AnyFunction).apply(target, args);
        };
      },
    });
  return new Proxy(pool, {
    get(target, property) {
      if (property !== 'connect') return through(target, property);
      // With a callback (the pool's own query does that) the client is not wrapped.
      return async (...args: unknown[]): Promise<unknown> =>
        args.length > 0
          ? (target.connect as AnyFunction).apply(target, args)
          : wrap(await target.connect());
    },
  });
}

/** One-off query with the privileged role, to prepare or to verify the state. */
export async function admin<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await testPools().admin.query<T>(sql, values)).rows;
}

/** A person opens a request, as the API does it: with their own context and the API's role. */
export async function openRequest(
  userId: string,
  text: string,
  companyId: string = ids.arma,
): Promise<string> {
  return withContext(testPools().app, { companyId, userId }, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into office.tasks (company_id, kind, title, description)
       values ($1, 'request', $2, $3) returning id`,
      [companyId, text.split('\n')[0]?.slice(0, 80) ?? 'Talep', text],
    );
    return rows[0]?.id ?? '';
  });
}

/** A person's statement with the API's role (a decision, a cancel). */
export async function asPerson(
  userId: string,
  sql: string,
  values: unknown[] = [],
  companyId: string = ids.arma,
): Promise<void> {
  await withContext(testPools().app, { companyId, userId }, (client) => client.query(sql, values));
}

/** Stands in for the queue: checks the job as the real sender does and remembers it. */
export class RecordingJobs implements AgentRunSender {
  readonly sent: AgentRunJob[] = [];

  async send(client: Parameters<AgentRunSender['send']>[0], job: AgentRunJob): Promise<void> {
    const data = agentRunJobSchema.parse(job);
    await client.query('select 1');
    this.sent.push(data);
  }
}

export interface TestRunner {
  deps: RunnerDeps;
  jobs: RecordingJobs;
  log: { event: string; fields: Record<string, string | number | null> }[];
}

export function runner(
  model: ScriptedModel | null,
  overrides: Partial<RunnerDeps> = {},
): Promise<TestRunner> {
  const jobs = new RecordingJobs();
  const log: TestRunner['log'] = [];
  return Promise.resolve({
    jobs,
    log,
    deps: {
      pool: testPools().worker,
      callModel: model?.call ?? null,
      jobs,
      log: (event, fields) => log.push({ event, fields }),
      ...overrides,
    },
  });
}

export function job(
  taskId: string,
  agentCode: string,
  userId: string,
  companyId: string = ids.arma,
) {
  return { companyId, userId, taskId, agentCode };
}

export const ROUTE_TO_SOS = {
  unit_code: 'SOS',
  agent_code: 'SOS-2',
  reason: 'Sosyal medya gönderisi isteniyor.',
};

export const RESULT = {
  title: 'Yeni ofis için LinkedIn gönderisi',
  summary: 'İki seçenek hazırlandı.',
  rationale: 'Kaynak olarak yalnızca talep metni kullanıldı. Marka dili notu henüz yok.',
  risk_note: '',
  options: [
    { code: 'A', text: 'İzmir ofisimiz açıldı.', hashtags: ['#izmir'] },
    { code: 'B', text: 'Artık İzmir’deyiz.', hashtags: [] },
  ],
  involves_money: false,
  goes_external: false,
};
