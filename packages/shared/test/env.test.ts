import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { baseEnvSchema, parseEnv } from '../src/env.ts';

function hataIletisi(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return String(error);
  }
  throw new Error('hata bekleniyordu');
}

describe('parseEnv', () => {
  it('varsayılanları uygular', () => {
    expect(parseEnv(baseEnvSchema, {})).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('hatalı değişkenin adını yazar, değerini yazmaz', () => {
    const schema = z.object({ ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-') });
    const ileti = hataIletisi(() => parseEnv(schema, { ANTHROPIC_API_KEY: 'SECRET-value' }));
    expect(ileti).toContain('ANTHROPIC_API_KEY');
    expect(ileti).not.toContain('SECRET');
  });
});
