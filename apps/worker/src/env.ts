import { isAbsolute } from 'node:path';
import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';
import { z } from 'zod';
import { readTokenProblem, type FileReaderSettings } from './files/read-token.ts';

const emptyAsMissing = (value: unknown): unknown => (value === '' ? undefined : value);

// As the API reads the same two variables (apps/api/src/env.ts): one .env, one bucket.
const httpsOrigin = z.string().refine(
  (value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  },
  { message: 'Must be an https origin without a path' },
);
const bucketName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { message: 'Must be a bucket name' });

/**
 * The worker's environment. The Claude API key is read here and nowhere else (rule 6; KALAN-ISLER
 * 0.6: "anahtar yalnızca worker'da"). Without a key the worker still starts: every agent run then
 * ends at once with the cause "model_unavailable" and the request falls to a person, instead of
 * requests waiting for a process that refused to start.
 */
export const workerEnvSchema = baseEnvSchema
  .extend({
    // The restricted login role office_worker (member of office_app only, no BYPASSRLS; rule 9).
    // Not the API's role: an agent run must not reach the identity tables.
    WORKER_DATABASE_URL: z.string().min(1),
    ANTHROPIC_API_KEY: z.preprocess(emptyAsMissing, z.string().min(20).optional()),
    // Not a setting of the worker: the SDK reads this variable by itself and adds its headers to
    // every model request, and no option switches that off. Read here only to refuse it.
    ANTHROPIC_CUSTOM_HEADERS: z.preprocess(emptyAsMissing, z.string().optional()),
    WORKER_CONCURRENCY: z.preprocess(
      emptyAsMissing,
      z.coerce.number().int().min(1).max(8).default(2),
    ),
    // The file storage, for reading project files (rule 9; 8 October decision 21). The first
    // three are the API's own variables (one .env, one bucket); the last two are the worker's.
    // With nothing set the worker reads no file and no run is given the reading tool.
    FILE_STORAGE_DIR: z.preprocess(
      emptyAsMissing,
      z
        .string()
        .refine((value) => isAbsolute(value), { message: 'Must be an absolute path' })
        .optional(),
    ),
    SUPABASE_URL: z.preprocess(emptyAsMissing, httpsOrigin.optional()),
    SUPABASE_STORAGE_BUCKET: z.preprocess(emptyAsMissing, bucketName.optional()),
    // The project's publishable key; not a secret.
    SUPABASE_PUBLISHABLE_KEY: z.preprocess(emptyAsMissing, z.string().trim().min(20).optional()),
    // A secret: the JWT of the database role office_file_reader, which reads the one bucket.
    SUPABASE_STORAGE_READ_TOKEN: z.preprocess(emptyAsMissing, z.string().trim().min(20).optional()),
    // Not a setting of the worker: read here only to refuse it in production.
    SUPABASE_SECRET_KEY: z.preprocess(emptyAsMissing, z.string().optional()),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ANTHROPIC_API_KEY !== undefined, {
    path: ['ANTHROPIC_API_KEY'],
    message: 'Required in production',
  })
  .refine((env) => env.ANTHROPIC_CUSTOM_HEADERS === undefined, {
    path: ['ANTHROPIC_CUSTOM_HEADERS'],
    message: 'Must not be set: its headers would be added to every model request',
  })
  // The messages below name the variable and what it must be, never a value.
  .superRefine((env, context) => {
    const token = env.SUPABASE_STORAGE_READ_TOKEN;
    const publishable = env.SUPABASE_PUBLISHABLE_KEY;
    // The shape and the role, not the time: a token that has ended does not keep the worker
    // down (worker.ts says so in the log and gives no run the reading tool).
    if (token !== undefined && readTokenProblem(token) !== null) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_STORAGE_READ_TOKEN'],
        message:
          'Must be the JWT of the role office_file_reader (docs/supabase-kurulum.md section 9); a secret key is refused',
      });
    }
    if (publishable?.startsWith('sb_secret_') === true) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_PUBLISHABLE_KEY'],
        message: 'Must be the publishable key of the project, not a secret key',
      });
    }
    if ((token === undefined) !== (publishable === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [token === undefined ? 'SUPABASE_STORAGE_READ_TOKEN' : 'SUPABASE_PUBLISHABLE_KEY'],
        message: 'SUPABASE_PUBLISHABLE_KEY and SUPABASE_STORAGE_READ_TOKEN are set together',
      });
    }
    if (token !== undefined && publishable !== undefined) {
      for (const name of ['SUPABASE_URL', 'SUPABASE_STORAGE_BUCKET'] as const) {
        if (env[name] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Required with SUPABASE_STORAGE_READ_TOKEN',
          });
        }
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.FILE_STORAGE_DIR !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['FILE_STORAGE_DIR'],
          message: 'Must not be set in production: files are read from Supabase Storage',
        });
      }
      if (env.SUPABASE_SECRET_KEY !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['SUPABASE_SECRET_KEY'],
          message: 'Must not be set for the worker: it reads files with the read token',
        });
      }
    }
  });

export type WorkerEnv = z.output<typeof workerEnvSchema>;

export function loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}

/**
 * What the worker reads files from; null: it reads none, and no run is given the reading tool.
 * A read token wins over a folder: one .env can hold the API's folder of another day.
 */
export function fileReaderSettings(
  env: Pick<
    WorkerEnv,
    | 'FILE_STORAGE_DIR'
    | 'SUPABASE_URL'
    | 'SUPABASE_STORAGE_BUCKET'
    | 'SUPABASE_PUBLISHABLE_KEY'
    | 'SUPABASE_STORAGE_READ_TOKEN'
  >,
): FileReaderSettings | null {
  if (
    env.SUPABASE_STORAGE_READ_TOKEN !== undefined &&
    env.SUPABASE_PUBLISHABLE_KEY !== undefined &&
    env.SUPABASE_URL !== undefined &&
    env.SUPABASE_STORAGE_BUCKET !== undefined
  ) {
    return {
      kind: 'supabase',
      url: env.SUPABASE_URL,
      bucket: env.SUPABASE_STORAGE_BUCKET,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      readToken: env.SUPABASE_STORAGE_READ_TOKEN,
    };
  }
  return env.FILE_STORAGE_DIR !== undefined ? { kind: 'disk', dir: env.FILE_STORAGE_DIR } : null;
}
