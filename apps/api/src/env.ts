import { z } from 'zod';
import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';

export const apiEnvSchema = baseEnvSchema.extend({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type ApiEnv = z.output<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined>): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}
