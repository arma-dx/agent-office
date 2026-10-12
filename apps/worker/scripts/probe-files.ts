import { parseCards, readCardFiles } from '@agent-office/db/cards';
import { AGENT_FILE_MAX_TOKENS, type StoredCard } from '@agent-office/shared';
import { loadWorkerEnv } from '../src/env.ts';
import { fileBlock } from '../src/files/content.ts';
import { ModelCallError, type CallModel, type CountFileTokens } from '../src/model/client.ts';
import {
  BASE_FILES,
  LONG_PDF_PAGES,
  LOOP_CASES,
  PROBE_AGENT,
  SEE_CASES,
  checkLines,
  costOfCalls,
  countRuns,
  longPdf,
  parseFileProbeFlags,
  runLoop,
  seeRequest,
  writtenBy,
  type FileProbeFlags,
  type LoopReport,
  type ProbeCall,
  type ProbeContext,
} from './probe-files-cases.ts';

/**
 * The probe of the file reading (8 October decision 21), by hand and only when the key is there.
 * What agents do with a project's files rests on texts nobody has measured (the common rules'
 * section, the card, the method, the tool's description) and on things the provider documents
 * and this repository never tried: so they are tried on the real model before a database lets an
 * agent read (the definitions sync is what does that).
 *
 *   pnpm --filter @agent-office/worker probe:files               every case
 *   pnpm --filter @agent-office/worker probe:files --case 9.3    one case
 *   pnpm --filter @agent-office/worker probe:files --runs 1      one run of each loop case
 *   pnpm --filter @agent-office/worker probe:files --max-usd 2   start no run after two dollars
 *
 *   9.1   the provider counts each of the four files (free);
 *   9.1b  and three PDFs of 10, 30 and 120 pages: how many pages a file's token limit is;
 *   9.2   does the model see a file that sits inside a tool result (a PDF, a picture, a CSV),
 *         and, with it, 9.8: is the count of 9.1 what the file costs in a call;
 *   9.3 to 9.6 and 9.10 to 9.13   whole runs of the unit agent on invented requests: does it read
 *         the file it needs and no other, does it follow an instruction a file holds, does it
 *         invent what no file says, what does it do with a file it cannot read;
 *   9.7 and 9.9 are printed with every run: what was read from the cache, and how long it took.
 *
 * It reads the card, the common rules and the skills from the repository's files and touches no
 * database and no storage; every file is made in memory by probe-files-made.ts. It sends no
 * company data: every request, file and name was invented for it, and the company a run is told
 * of is a made-up name. It prints what the model did, every text a run submitted (the lead reads
 * them: the ok and FOUND lines only point), the usage, the cost and the provider's request ids.
 * Never the key.
 */
const AGENTS_DIR = new URL('../../../agents/', import.meta.url);
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);
// Made up for the probe: the name of no company.
const PROBE_COMPANY = 'Deneme Şirketi';

let flags: FileProbeFlags;
try {
  flags = parseFileProbeFlags(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid arguments');
  process.exit(2);
}
const wanted = (id: string): boolean => flags.caseId === undefined || flags.caseId === id;

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
const found = cards.versions.find((version) => version.card.code === PROBE_AGENT);
if (!found) {
  console.error(`No card of ${PROBE_AGENT}; nothing was sent.`);
  process.exit(1);
}
const stored: StoredCard = found;
const { createAnthropicModel, createAnthropicTokenCounter } =
  await import('../src/model/anthropic.ts');
const callModel: CallModel = createAnthropicModel(env.ANTHROPIC_API_KEY);
const countFileTokens: CountFileTokens = createAnthropicTokenCounter(env.ANTHROPIC_API_KEY);
const context: ProbeContext = { company: PROBE_COMPANY, now: Date.now() };

let spent = 0;
let failed = false;
const usd = (value: number): string => value.toFixed(6);

/** The codes and the request id of a failed call: a provider's error text can quote the prompt. */
function reasonOf(error: unknown): string {
  return error instanceof ModelCallError
    ? `${error.code} (status ${String(error.status ?? '-')}, type ${error.providerType ?? '-'}, request ${error.requestId ?? '-'})`
    : error instanceof Error
      ? error.message
      : 'unknown error';
}

/** The provider's count of one file; null when it failed (the reason is printed). */
async function counted(label: string, mimeType: string, bytes: Buffer): Promise<number | null> {
  const made = fileBlock(mimeType, bytes);
  if (made === null) return null;
  try {
    const tokens = await countFileTokens(
      { model: stored.card.model, block: made.block },
      { signal: AbortSignal.timeout(90_000), timeoutMs: 60_000 },
    );
    console.log(`  ${label}: ${String(tokens)} tokens (${String(bytes.length)} bytes)`);
    return tokens;
  } catch (error) {
    console.log(`  ${label}: NOT COUNTED: ${reasonOf(error)}`);
    return null;
  }
}

const tokensOf = new Map<string, number>();
if (wanted('9.1') || wanted('9.2')) {
  console.log('\n9.1 the provider counts each file (expected: four numbers, none an error)');
  for (const file of BASE_FILES) {
    if (file.bytes === null) continue;
    const tokens = await counted(file.name, file.mimeType, file.bytes);
    if (tokens === null) failed = true;
    else tokensOf.set(file.id, tokens);
  }
}

if (wanted('9.1b')) {
  console.log(
    `\n9.1b PDFs of plain text, about 350 words a page (a file's limit is ${String(AGENT_FILE_MAX_TOKENS)} tokens)`,
  );
  for (const pages of LONG_PDF_PAGES) {
    const tokens = await counted(`${String(pages)} pages`, 'application/pdf', longPdf(pages));
    if (tokens !== null) {
      const aPage = tokens / pages;
      console.log(
        `      ${aPage.toFixed(0)} tokens a page: the limit is about ${Math.floor(AGENT_FILE_MAX_TOKENS / aPage).toString()} such pages`,
      );
    }
  }
}

if (wanted('9.2')) {
  console.log(
    '\n9.2 a file inside a tool result, then a question only the file answers (expected: SEEN three times)',
  );
  const total = (call: ProbeCall): number => call.input + call.cacheWrite + call.cacheRead;
  const ask = async (label: string, request: ReturnType<typeof seeRequest>) => {
    const answer = await callModel(request, {
      signal: AbortSignal.timeout(180_000),
      timeoutMs: 150_000,
    });
    const usage = answer.message.usage;
    const call: ProbeCall = {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      requestId: answer.requestId,
    };
    spent += costOfCalls(stored, [call]);
    const said = answer.message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim();
    console.log(
      `  ${label}: input=${String(total(call))} (cache_read=${String(call.cacheRead)}) output=${String(call.output)} request=${call.requestId ?? '-'}`,
    );
    return { call, said };
  };
  for (const see of SEE_CASES) {
    const tokens = tokensOf.get(see.file.id);
    if (tokens === undefined) {
      console.log(`  ${see.file.name}: skipped, the file was not counted`);
      continue;
    }
    try {
      const withFile = await ask(see.file.name, seeRequest(stored, see, tokens, context));
      console.log(`      answer: ${withFile.said}`);
      console.log(
        `      ${see.answer.test(withFile.said) ? 'SEEN    ' : 'NOT SEEN'} (${see.answer.source})`,
      );
      if (!see.answer.test(withFile.said)) failed = true;
      // 9.8: the same call without the file's block; the difference is what the file cost.
      const control = await ask(
        `${see.file.name}, without the file`,
        seeRequest(stored, see, null, context),
      );
      const cost = total(withFile.call) - total(control.call);
      const off = Math.abs(cost - tokens) / Math.max(tokens, 1);
      console.log(
        `      9.8 counted=${String(tokens)} in the call=${String(cost)}: ${off <= 0.1 ? 'ok, within ten per cent' : `OFF by ${(off * 100).toFixed(0)} per cent`}`,
      );
    } catch (error) {
      failed = true;
      console.error(`  ${see.file.name}: FAILED: ${reasonOf(error)}`);
    }
  }
}

const summary: string[] = [];
for (const entry of LOOP_CASES) {
  if (!wanted(entry.id)) continue;
  console.log(`\n${entry.id}: ${entry.text}`);
  console.log(
    `  files: ${entry.files.length > 8 ? `${String(entry.files.length)} files` : entry.files.map((file) => file.name).join(', ')}`,
  );
  console.log(`  expected: ${entry.expected}`);
  const reports: LoopReport[] = [];
  const runs = flags.runs ?? entry.runs;
  for (let run = 1; run <= runs; run += 1) {
    if (spent >= flags.maxUsd) {
      console.error(`  stopped: ${usd(spent)} dollars spent, the limit is ${usd(flags.maxUsd)}`);
      failed = true;
      break;
    }
    const report = await runLoop({ callModel, countFileTokens }, stored, entry, context);
    reports.push(report);
    const cost = costOfCalls(stored, report.calls);
    spent += cost;
    console.log(
      `  ${entry.id} #${String(run)}: ${report.outcome} in ${String(report.ms)} ms${report.ms > 120_000 ? ' (OVER TWO MINUTES)' : ''}, cost_usd=${usd(cost)}`,
    );
    if (report.failure !== null) {
      failed = true;
      console.log(`      FAILED: ${report.failure}`);
    }
    for (const step of report.steps) console.log(`      step: ${step}`);
    // 9.7: what each call read from the cache; after a read it should hold the file's tokens.
    for (const [index, call] of report.calls.entries()) {
      console.log(
        `      call ${String(index + 1)}: input=${String(call.input)} cache_write=${String(call.cacheWrite)} cache_read=${String(call.cacheRead)} output=${String(call.output)} request=${call.requestId ?? '-'}`,
      );
    }
    if (report.question !== null) console.log(`      question: ${report.question}`);
    const written = writtenBy(report);
    if (report.submitted !== null) {
      console.log(`      title: ${report.submitted.title}`);
      console.log(`      options:\n${written.options.replace(/^/gm, '        ')}`);
    }
    if (written.reasoning !== '') {
      console.log(`      reasoning:\n${written.reasoning.replace(/^/gm, '        ')}`);
    }
    for (const line of checkLines(entry, report)) console.log(`      ${line}`);
  }
  const count = countRuns(reports);
  summary.push(
    `  ${entry.id}: runs=${String(count.runs)} submitted=${String(count.submitted)} asked=${String(count.asked)} prose=${String(count.prose)} other=${String(count.other)} read_a_file=${String(count.readAFile)} most_files_read=${String(count.mostFilesRead)} slowest_ms=${String(count.slowestMs)}`,
  );
}

console.log('\nSummary');
for (const line of summary) console.log(line);
console.log(`  cost_usd=${usd(spent)}`);
process.exit(failed ? 1 : 0);
