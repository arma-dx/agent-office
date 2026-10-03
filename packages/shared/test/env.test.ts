import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { baseEnvSchema, parseEnv } from '../src/env.ts';

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return String(error);
  }
  throw new Error('expected an error');
}

describe('parseEnv', () => {
  it('applies the defaults', () => {
    expect(parseEnv(baseEnvSchema, {})).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('shows the name of the invalid variable, not its value', () => {
    const schema = z.object({ ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-') });
    const message = errorMessage(() => parseEnv(schema, { ANTHROPIC_API_KEY: 'SECRET-value' }));
    expect(message).toContain('ANTHROPIC_API_KEY');
    expect(message).not.toContain('SECRET');
  });
});
