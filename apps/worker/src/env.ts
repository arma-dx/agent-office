import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';
import { z } from 'zod';

const emptyAsMissing = (value: unknown): unknown => (value === '' ? undefined : value);

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
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ANTHROPIC_API_KEY !== undefined, {
    path: ['ANTHROPIC_API_KEY'],
    message: 'Required in production',
  })
  .refine((env) => env.ANTHROPIC_CUSTOM_HEADERS === undefined, {
    path: ['ANTHROPIC_CUSTOM_HEADERS'],
    message: 'Must not be set: its headers would be added to every model request',
  });

export type WorkerEnv = z.output<typeof workerEnvSchema>;

export function loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}
