import { z } from 'zod';

/**
 * agents/models.yaml: the models a card may name, how each is called and what each costs. Reviewed
 * by PR like the tool catalog. A model id appears in cards and in that one file, and nowhere in
 * code; a card that names a model without a row cannot start a run.
 */

const price = z.number().nonnegative().max(1000);

export const modelProfileSchema = z.strictObject({
  id: z.string().min(1),
  // The largest answer of one model call.
  max_tokens: z.number().int().min(256).max(64_000),
  // none: the thinking parameter is not sent. adaptive: the model decides when to think.
  thinking: z.enum(['none', 'adaptive']),
  // null: the effort parameter is not sent (the model does not take it).
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable(),
  // US dollars per one million tokens, every kind of token stated: no multiplier is computed.
  prices: z.strictObject({
    input: price,
    output: price,
    cache_write_5m: price,
    cache_write_1h: price,
    cache_read: price,
  }),
});
export type ModelProfile = z.output<typeof modelProfileSchema>;

export const modelsFileSchema = z
  .strictObject({ models: z.array(modelProfileSchema).min(1) })
  .refine((file) => new Set(file.models.map((model) => model.id)).size === file.models.length, {
    message: 'A model id appears more than once',
  });
export type ModelsFile = z.output<typeof modelsFileSchema>;

/** The tokens of one model call, as the API reports them. Cache tokens are counted apart. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const MICRO = 1_000_000n;

function micro(usd: number): bigint {
  // Prices have at most six decimals; rounding removes the binary noise of the YAML number.
  return BigInt(Math.round(usd * 1_000_000));
}

/**
 * The cost of one model call in US dollars, as a decimal string with six decimals (the scale of
 * runs.cost_usd). Computed in integers and rounded half up; thinking tokens are already inside
 * the output count.
 */
export function costOf(usage: TokenUsage, prices: ModelProfile['prices']): string {
  const numerator =
    BigInt(usage.input) * micro(prices.input) +
    BigInt(usage.output) * micro(prices.output) +
    BigInt(usage.cacheWrite5m) * micro(prices.cache_write_5m) +
    BigInt(usage.cacheWrite1h) * micro(prices.cache_write_1h) +
    BigInt(usage.cacheRead) * micro(prices.cache_read);
  // numerator is in micro-dollars times one million tokens.
  const microDollars = (numerator + MICRO / 2n) / MICRO;
  const whole = microDollars / MICRO;
  const fraction = (microDollars % MICRO).toString().padStart(6, '0');
  return `${whole.toString()}.${fraction}`;
}
