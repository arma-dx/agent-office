import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';
import { KUYRUK_SEMASI } from './kuyruk.ts';

// Ajan çalıştırıcı sonraki görevlerde gelir (iş tüketimi, Claude API).
export function describeWorker(source: Record<string, string | undefined>): string {
  const env = parseEnv(baseEnvSchema, source);
  return `worker:${KUYRUK_SEMASI}:${env.NODE_ENV}`;
}
