import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  DefinitionsError,
  parseDefinitions,
  readDefinitionFiles,
  syncDefinitions,
  type SyncCounts,
} from '../src/definitions.ts';
import { LocalAddressError, localAdminUrl } from './local-admin.ts';

/**
 * Writes the units and agents of agents/ (units.yaml and the cards) into office.units and
 * office.agent_definitions of the local database, with the migration role (rule 9 allows it for
 * the card sync). Nothing else is written and nothing is deleted. It connects to a database on
 * this machine only; the test and the production project get these rows from the deployment
 * pipeline (KALAN-ISLER 0.7).
 *
 * Usage (from the repository root, after `supabase start` or `supabase db reset`):
 *   pnpm db:sync-definitions                  validate the files, then write
 *   pnpm db:sync-definitions --check          validate the files only; no connection
 *   pnpm db:sync-definitions --allow-orphans  go on although the database holds an agent whose
 *                                             card left the repository (it is reported and kept)
 *
 * The server is TEST_DATABASE_URL or the local Supabase default, the database the one DATABASE_URL
 * names. The script never prints an address.
 */
const AGENTS_DIR = new URL('../../../agents/', import.meta.url);

class UsageError extends Error {}

function readOptions(): { check: boolean; allowOrphans: boolean } {
  try {
    const { values } = parseArgs({
      options: {
        check: { type: 'boolean', default: false },
        'allow-orphans': { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: true,
    });
    return { check: values.check, allowOrphans: values['allow-orphans'] };
  } catch {
    throw new UsageError('Usage: pnpm db:sync-definitions [--check] [--allow-orphans]');
  }
}

function counts(label: string, c: SyncCounts): string {
  return `${label}: ${String(c.inserted)} inserted, ${String(c.updated)} updated, ${String(c.unchanged)} unchanged.`;
}

async function main(): Promise<void> {
  const options = readOptions();
  const definitions = parseDefinitions(await readDefinitionFiles(AGENTS_DIR));
  const found = `${String(definitions.units.length)} units, ${String(definitions.agents.length)} agents`;
  if (options.check) {
    console.log(`The definition files are valid: ${found}.`);
    return;
  }

  const admin = localAdminUrl(process.env);
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    await client.query('begin');
    try {
      const report = await syncDefinitions(client, definitions, {
        allowOrphanAgents: options.allowOrphans,
      });
      await client.query('commit');
      console.log(`Read ${found}. Database: ${new URL(admin).pathname.slice(1)}, on this machine.`);
      console.log(counts('Units', report.units));
      console.log(counts('Agents', report.agents));
      if (report.orphanUnits.length > 0) {
        console.log(
          `Units the files no longer name (kept, not shown without an agent): ${report.orphanUnits.join(', ')}.`,
        );
      }
      if (report.orphanAgents.length > 0) {
        console.log(
          `Agents the files no longer name (kept, still shown in the office): ${report.orphanAgents.join(', ')}.`,
        );
      }
    } catch (error) {
      // A failed rollback must not hide why the sync stopped; the connection is closed next.
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

/** What may be printed about a failure. A connection error's own text carries the address. */
function describeFailure(error: unknown): string {
  if (error instanceof DefinitionsError) {
    const lines = [`${error.message}:`, ...error.problems.map((problem) => `  - ${problem}`)];
    if (error.code === 'orphan_agent') {
      lines.push('Nothing was written. Pass --allow-orphans to go on and keep these rows.');
    }
    return lines.join('\n');
  }
  if (error instanceof UsageError || error instanceof LocalAddressError) {
    return error.message;
  }
  if (error instanceof pg.DatabaseError) {
    return `The database refused the sync (${error.code ?? 'no code'}): ${error.message}`;
  }
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown error';
  const hint = code === 'ECONNREFUSED' ? ' Is the local database running?' : '';
  return `The definitions could not be synced (${code}).${hint}`;
}

main().catch((error: unknown) => {
  console.error(describeFailure(error));
  process.exitCode = 1;
});
