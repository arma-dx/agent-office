import { parseCards, readCardFiles } from '@agent-office/db/cards';
import { parseDefinitions, readDefinitionFiles } from '@agent-office/db/definitions';
import { costOf, officeDay } from '@agent-office/shared';
import { loadWorkerEnv } from '../src/env.ts';
import { ModelCallError } from '../src/model/client.ts';
import {
  countByGroup,
  describeRun,
  observe,
  parseFlags,
  probeRequest,
  selectCases,
  unitsForProbe,
  type Observed,
  type ProbeCase,
  type ProbeFlags,
} from './probe-questions-cases.ts';

/**
 * The probe of when agents ask (12 October decisions 3 and 4), by hand and only when the key is
 * there. Asking makes a requester wait, and in the first real requests the coordinator took a
 * conditional sentence for missing information: so the texts that say when to ask and when not
 * (the common rules, the two cards, the two skills, the tool's descriptions) are measured on the
 * real models before a database lets an agent ask.
 *
 *   pnpm --filter @agent-office/worker probe:questions            every case, three runs each
 *   pnpm --filter @agent-office/worker probe:questions --case K3  one case
 *   pnpm --filter @agent-office/worker probe:questions --runs 1   one run of each case
 *   pnpm --filter @agent-office/worker probe:questions --no-ask   the baseline of group K: the
 *                                                                 coordinator as a run that may
 *                                                                 not ask
 *
 * It reads the cards, the common rules, the skills, the units and the model table from the
 * repository's files and touches no database: it is run BEFORE `pnpm db:sync-definitions`, which
 * is what switches asking on for a database. For every case it sends what the runner would send
 * for that run of that agent (probe-questions-cases.ts builds the request from the runner's own
 * functions), once per run; no tool result is sent back, nothing is stored anywhere.
 *
 * It sends no company data: every request text, question and answer was invented for it. It
 * prints, per run, what the model did (the tool, and of its input what the lead reads: the unit
 * and the agent, the question, the title of a result), the usage, the computed cost and the
 * provider's request id; at the end, per group, how many runs asked. Never the key.
 */
const AGENTS_DIR = new URL('../../../agents/', import.meta.url);
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);

let flags: ProbeFlags;
try {
  flags = parseFlags(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid arguments');
  process.exit(2);
}
const cases = selectCases(flags);
if (cases.length === 0) {
  console.error('No such case; nothing was sent.');
  process.exit(2);
}

const env = loadWorkerEnv({
  // The database is not touched by this script.
  WORKER_DATABASE_URL: 'postgresql://unused',
  ...process.env,
});
if (env.ANTHROPIC_API_KEY === undefined) {
  console.error('ANTHROPIC_API_KEY is not set in .env; nothing was sent.');
  process.exit(1);
}

const cards = parseCards(await readCardFiles(AGENTS_DIR, SKILLS_DIR));
const units = unitsForProbe(
  parseDefinitions(await readDefinitionFiles(AGENTS_DIR)),
  cards.versions,
);
const today = officeDay(Date.now());
const { createAnthropicModel } = await import('../src/model/anthropic.ts');
const callModel = createAnthropicModel(env.ANTHROPIC_API_KEY);

const done: { entry: ProbeCase; seen: Observed }[] = [];
let failed = false;
let spent = 0;
for (const entry of cases) {
  const stored = cards.versions.find((version) => version.card.code === entry.agent);
  if (!stored) {
    console.error(`${entry.id}: no card of ${entry.agent}`);
    failed = true;
    continue;
  }
  console.log(`\n${entry.id} (${entry.agent}${flags.noAsk ? ', may not ask' : ''}): ${entry.text}`);
  console.log(`  expected: ${entry.expected}`);
  for (let run = 1; run <= flags.runs; run += 1) {
    try {
      const answer = await callModel(probeRequest(stored, units, entry, today), {
        signal: AbortSignal.timeout(180_000),
        timeoutMs: 150_000,
      });
      const usage = answer.message.usage;
      const cost = costOf(
        {
          input: usage.input_tokens,
          output: usage.output_tokens,
          cacheWrite5m: usage.cache_creation_input_tokens ?? 0,
          cacheWrite1h: 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        },
        stored.model.prices,
      );
      spent += Number(cost);
      const seen = observe(answer.message);
      done.push({ entry, seen });
      console.log(`  ${entry.id} #${String(run)}: ${describeRun(entry, seen)}`);
      console.log(
        `      stop=${String(answer.message.stop_reason)} input=${String(usage.input_tokens)} output=${String(usage.output_tokens)} cache_read=${String(usage.cache_read_input_tokens ?? 0)} cost_usd=${cost} request=${answer.requestId ?? '-'}`,
      );
    } catch (error) {
      failed = true;
      // The codes and the request id only: a provider's error text can quote the prompt.
      const reason =
        error instanceof ModelCallError
          ? `${error.code} (status ${String(error.status ?? '-')}, type ${error.providerType ?? '-'}, request ${error.requestId ?? '-'})`
          : error instanceof Error
            ? error.message
            : 'unknown error';
      console.error(`  ${entry.id} #${String(run)}: FAILED: ${reason}`);
    }
  }
}

console.log(`\nSummary${flags.noAsk ? ' (baseline: runs that may not ask)' : ''}`);
for (const count of countByGroup(done)) {
  const list = (ids: string[]): string => (ids.length === 0 ? '-' : ids.join(' '));
  console.log(
    `  group ${count.group}: runs=${String(count.runs)} asked=${String(count.asked)} without_tool=${String(count.prose)} asked_where_not_expected=${list(count.askedWrongly)} not_routed_to_its_agent=${list(count.notRouted)} routed_otherwise=${list(count.routedOtherwise)}`,
  );
}
console.log(`  cost_usd=${spent.toFixed(6)}`);
process.exit(failed ? 1 : 0);
