import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';
import { QUEUE_SCHEMA } from './queue.ts';

// The agent runner comes in later tasks (job consumption, Claude API).
export function describeWorker(source: Record<string, string | undefined>): string {
  const env = parseEnv(baseEnvSchema, source);
  return `worker:${QUEUE_SCHEMA}:${env.NODE_ENV}`;
}
