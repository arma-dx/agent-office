import { parseCards, readCardFiles, readModels } from '@agent-office/db/cards';
import { COORDINATOR_AGENT_CODE, costOf } from '@agent-office/shared';
import { loadWorkerEnv } from '../src/env.ts';
import { ModelCallError, type ModelRequest, type ModelTurn } from '../src/model/client.ts';

/**
 * One real call per model, by hand and only when the key is there (KALAN-ISLER 0.6: "tek bir
 * deneme çağrısı"). It is the place where what no test can show is checked: that the key works,
 * that each model the first cards name accepts the request shape the runner sends (strict tool,
 * thinking and effort as agents/models.yaml states them, the cache mark), and what a call costs.
 *
 *   pnpm --filter @agent-office/worker smoke:claude
 *
 * It sends no company data: the prompt is a fixed sentence. It has no company and no request, so
 * it writes no run record; the first recorded call is the first run of a real request. It prints
 * the usage, the computed cost and the provider's request id, and never the key.
 */
const AGENTS_DIR = new URL('../../../agents/', import.meta.url);
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);
const FIRST_AGENTS = [COORDINATOR_AGENT_CODE, 'SOS-2'];

const env = loadWorkerEnv({
  // The database is not touched by this script.
  WORKER_DATABASE_URL: 'postgresql://unused',
  ...process.env,
});
if (env.ANTHROPIC_API_KEY === undefined) {
  console.error('ANTHROPIC_API_KEY is not set in .env; nothing was sent.');
  process.exit(1);
}

const models = await readModels(AGENTS_DIR);
const cards = parseCards(await readCardFiles(AGENTS_DIR, SKILLS_DIR));
const named = new Set(
  cards.versions
    .filter((version) => FIRST_AGENTS.includes(version.card.code))
    .map((version) => version.card.model),
);
const { createAnthropicModel } = await import('../src/model/anthropic.ts');
const callModel = createAnthropicModel(env.ANTHROPIC_API_KEY);

let failed = false;
for (const id of named) {
  const profile = models.get(id);
  if (!profile) {
    console.error(`${id}: no row in agents/models.yaml`);
    failed = true;
    continue;
  }
  const messages: ModelTurn[] = [
    {
      role: 'user',
      content: 'Deneme: "tamam" kelimesini note aracıyla kaydet, sonra tek kelimeyle bitir.',
    },
  ];
  const request = (): ModelRequest => ({
    model: id,
    max_tokens: Math.min(profile.max_tokens, 1024),
    system: [
      {
        type: 'text',
        text: 'Bu bir bağlantı denemesidir. İstenen aracı bir kez çağır, sonra kısa bir yanıtla bitir.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'note',
        description: 'Verilen kelimeyi kaydeder.',
        strict: true,
        input_schema: {
          type: 'object',
          properties: { word: { type: 'string' } },
          required: ['word'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages,
    ...(profile.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(profile.effort === null ? {} : { output_config: { effort: profile.effort } }),
  });
  try {
    const options = { signal: AbortSignal.timeout(90_000), timeoutMs: 60_000 };
    const first = await callModel(request(), options);
    const call = first.message.content.find((block) => block.type === 'tool_use');
    if (first.message.stop_reason !== 'tool_use' || !call) {
      throw new Error(`expected a tool call, got stop reason ${String(first.message.stop_reason)}`);
    }
    messages.push({ role: 'assistant', content: first.message.content });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, content: '{"ok":true}' }],
    });
    const second = await callModel(request(), options);
    for (const [step, answer] of [first, second].entries()) {
      const usage = answer.message.usage;
      const cost = costOf(
        {
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheWrite5m: usage.cache_creation_input_tokens ?? 0,
          cacheWrite1h: 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        },
        profile.prices,
      );
      console.log(
        `${id} call ${String(step + 1)}: stop=${String(answer.message.stop_reason)} input=${String(usage.input_tokens)} output=${String(usage.output_tokens)} cache_write=${String(usage.cache_creation_input_tokens ?? 0)} cache_read=${String(usage.cache_read_input_tokens ?? 0)} cost_usd=${cost} request=${answer.requestId ?? '-'}`,
      );
    }
    if (second.message.stop_reason !== 'end_turn') {
      throw new Error(`expected the turn to end, got ${String(second.message.stop_reason)}`);
    }
    console.log(`${id}: ok`);
  } catch (error) {
    failed = true;
    // The codes and the request id only: a provider's error text can quote the prompt. The
    // provider's own class of the error says what to do (billing_error: add balance or a payment
    // method in the console; not_found_error: the account does not offer this model).
    const reason =
      error instanceof ModelCallError
        ? `${error.code} (status ${String(error.status ?? '-')}, type ${error.providerType ?? '-'}, request ${error.requestId ?? '-'})`
        : error instanceof Error
          ? error.message
          : 'unknown error';
    console.error(`${id}: FAILED: ${reason}`);
  }
}
process.exit(failed ? 1 : 0);
