import { DB_PAKETI } from '@agent-office/db';
import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';

// Ajan çalıştırıcı sonraki görevlerde gelir (pg-boss, Claude API).
export function describeWorker(source: Record<string, string | undefined>): string {
  const env = parseEnv(baseEnvSchema, source);
  return `worker:${DB_PAKETI}:${env.NODE_ENV}`;
}
