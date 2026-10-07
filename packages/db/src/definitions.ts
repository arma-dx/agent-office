import { readdir, readFile } from 'node:fs/promises';
import { cardDefinitionSchema, unitsFileSchema } from '@agent-office/shared';
import { parse } from 'yaml';
import type { z } from 'zod';
import type { Queryable } from './queryable.ts';

/**
 * Definitions sync: writes which units and agents exist (office.units, office.agent_definitions)
 * from the files under agents/. It is the first slice of the card sync (KALAN-ISLER 1.2; 6 October
 * decision 8) and writes nothing else: no company_agents row, and it never deletes. The tool
 * catalog and the card versions are written after it by the card sync (cards.ts); without a card
 * version no agent can run (runs.card_version_id is required).
 *
 * The global tables can be written by the migration role only (rule 9). This module is not
 * exported from index.ts, so the API and the worker do not load the YAML parser.
 */

const UNITS_FILE = 'units.yaml';
// The tool catalog and the model table are not cards; the card sync (cards.ts) reads them.
const TOOLS_FILE = 'tools.yaml';
const MODELS_FILE = 'models.yaml';

export interface DefinitionFiles {
  units: unknown;
  cards: { file: string; content: unknown }[];
}

export interface Definitions {
  units: { code: string; name: string; companyCode: string | null; pilotEnabled: boolean }[];
  agents: { code: string; name: string; unitCode: string; companyCodes: string[] }[];
}

export interface SyncCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface SyncReport {
  units: SyncCounts;
  agents: SyncCounts;
  /** Rows the files no longer name. Never deleted. Units are only reported. */
  orphanUnits: string[];
  /** Empty unless the run was started with allowOrphanAgents: an orphan agent stops the run. */
  orphanAgents: string[];
}

export interface SyncOptions {
  /** Go on although the database holds an agent the files no longer name. */
  allowOrphanAgents?: boolean;
}

export type DefinitionsErrorCode =
  'invalid_files' | 'no_company' | 'unknown_company' | 'closed_company' | 'orphan_agent';

/** A refusal of the files or of the sync. Each problem names what is wrong and where. */
export class DefinitionsError extends Error {
  readonly code: DefinitionsErrorCode;
  readonly problems: readonly string[];

  constructor(code: DefinitionsErrorCode, message: string, problems: readonly string[]) {
    super(message);
    this.name = 'DefinitionsError';
    this.code = code;
    this.problems = problems;
  }
}

async function readYaml(dir: URL, file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(new URL(file, dir), 'utf8');
  } catch {
    throw new DefinitionsError('invalid_files', 'A definition file could not be read', [file]);
  }
  try {
    return parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'not valid YAML';
    throw new DefinitionsError('invalid_files', 'A definition file is not valid YAML', [
      `${file}: ${reason}`,
    ]);
  }
}

/**
 * agents/units.yaml and every other YAML file of the folder except tools.yaml and models.yaml,
 * parsed but not validated. `dir` ends with a slash. Cards come back in the order of their file names.
 */
export async function readDefinitionFiles(dir: URL): Promise<DefinitionFiles> {
  const names = (await readdir(dir))
    .filter(
      (name) =>
        /\.ya?ml$/.test(name) && name !== UNITS_FILE && name !== TOOLS_FILE && name !== MODELS_FILE,
    )
    .sort();
  const units = await readYaml(dir, UNITS_FILE);
  const cards: DefinitionFiles['cards'] = [];
  for (const file of names) {
    cards.push({ file, content: await readYaml(dir, file) });
  }
  return { units, cards };
}

function schemaProblems(file: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const field = issue.path.map(String).join('.');
    return `${file}: ${field === '' ? '' : `${field}: `}${issue.message}`;
  });
}

/**
 * Validates with unitsFileSchema and cardDefinitionSchema and runs the cross checks. Pure. Every
 * failure is collected before throwing, each with its file and field.
 */
export function parseDefinitions(raw: DefinitionFiles): Definitions {
  const problems: string[] = [];

  const unitsFile = unitsFileSchema.safeParse(raw.units);
  if (!unitsFile.success) {
    problems.push(...schemaProblems(UNITS_FILE, unitsFile.error));
  }
  const units = unitsFile.success ? unitsFile.data.units : [];
  const unitByCode = new Map<string, (typeof units)[number]>();
  for (const unit of units) {
    if (unitByCode.has(unit.code)) {
      problems.push(`${UNITS_FILE}: code: ${unit.code} is the code of more than one unit`);
    } else {
      unitByCode.set(unit.code, unit);
    }
  }

  const agents: Definitions['agents'] = [];
  const fileOfAgent = new Map<string, string>();
  for (const { file, content } of raw.cards) {
    const card = cardDefinitionSchema.safeParse(content);
    if (!card.success) {
      problems.push(...schemaProblems(file, card.error));
      continue;
    }
    const { code, name, unit, companies } = card.data;
    if (file !== `${code}.yaml`) {
      problems.push(`${file}: code: the card of ${code} must be the file ${code}.yaml`);
    }
    const firstFile = fileOfAgent.get(code);
    if (firstFile === undefined) {
      fileOfAgent.set(code, file);
    } else {
      problems.push(`${file}: code: ${code} is already the code of ${firstFile}`);
    }
    if (new Set(companies).size !== companies.length) {
      problems.push(`${file}: companies: a company is named more than once`);
    }
    // The agent code pattern ends in a hyphen and digits, so what stands before them is the prefix.
    if (code.slice(0, code.lastIndexOf('-')) !== unit) {
      problems.push(`${file}: code: must be the unit code ${unit}, a hyphen and a number`);
    }
    // Without a valid unit list the unit of a card cannot be judged.
    if (unitsFile.success) {
      const owner = unitByCode.get(unit);
      if (owner === undefined) {
        problems.push(`${file}: unit: ${unit} is not a unit of ${UNITS_FILE}`);
      } else if (
        owner.company !== undefined &&
        (companies.length !== 1 || companies[0] !== owner.company)
      ) {
        problems.push(
          `${file}: companies: unit ${unit} belongs to ${owner.company}; the card must name exactly that company`,
        );
      }
    }
    agents.push({ code, name, unitCode: unit, companyCodes: companies });
  }

  if (problems.length > 0) {
    throw new DefinitionsError('invalid_files', 'The definition files are not valid', problems);
  }
  return {
    units: units.map((unit) => ({
      code: unit.code,
      name: unit.name,
      companyCode: unit.company ?? null,
      pilotEnabled: unit.pilot_enabled,
    })),
    agents,
  };
}

// One sync at a time; the lock ends with the transaction.
const LOCK_SQL = `select pg_advisory_xact_lock(hashtext('office.definitions_sync'))`;

// The database checks the company of a company_agents row on insert only. A card that drops a
// company would leave a switch that nobody can see.
const CLOSED_COMPANY_SQL = `
  select ca.agent_code, c.code as company_code
  from office.company_agents ca
  join office.companies c on c.id = ca.company_id
  join jsonb_array_elements($1::jsonb) as x on x ->> 'code' = ca.agent_code
  where not (x -> 'company_codes') ? c.code
  order by ca.agent_code collate "C", c.code collate "C"`;

const ORPHAN_AGENTS_SQL = `
  select code from office.agent_definitions
  where code <> all ($1::text[])
  order by code collate "C"`;

const ORPHAN_UNITS_SQL = `
  select code from office.units
  where code <> all ($1::text[])
  order by code collate "C"`;

// A row is written only when it differs, so a repeated run writes nothing; xmax tells an inserted
// row from an updated one.
const UPSERT_UNITS_SQL = `
  with input as (
    select code, name, company_code, pilot_enabled
    from jsonb_to_recordset($1::jsonb)
      as x(code text, name text, company_code text, pilot_enabled boolean)
  ), written as (
    insert into office.units as u (code, name, company_code, pilot_enabled)
    select code, name, company_code, pilot_enabled from input
    on conflict (code) do update
      set name = excluded.name,
          company_code = excluded.company_code,
          pilot_enabled = excluded.pilot_enabled
      where (u.name, u.company_code, u.pilot_enabled)
            is distinct from (excluded.name, excluded.company_code, excluded.pilot_enabled)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted)::int as inserted,
         count(*) filter (where not inserted)::int as updated
  from written`;

const UPSERT_AGENTS_SQL = `
  with input as (
    select x ->> 'code' as code,
           x ->> 'name' as name,
           x ->> 'unit_code' as unit_code,
           array(select jsonb_array_elements_text(x -> 'company_codes')) as company_codes
    from jsonb_array_elements($1::jsonb) as x
  ), written as (
    insert into office.agent_definitions as a (code, name, unit_code, company_codes)
    select code, name, unit_code, company_codes from input
    on conflict (code) do update
      set name = excluded.name,
          unit_code = excluded.unit_code,
          company_codes = excluded.company_codes
      where (a.name, a.unit_code, a.company_codes)
            is distinct from (excluded.name, excluded.unit_code, excluded.company_codes)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted)::int as inserted,
         count(*) filter (where not inserted)::int as updated
  from written`;

interface WrittenRow {
  inserted: number;
  updated: number;
}

async function codes(client: Queryable, sql: string, values: unknown[] = []): Promise<string[]> {
  const { rows } = await client.query<{ code: string }>(sql, values);
  return rows.map((row) => row.code);
}

async function upsert(client: Queryable, sql: string, rows: unknown[]): Promise<SyncCounts> {
  const result = await client.query<WrittenRow>(sql, [JSON.stringify(rows)]);
  const written = result.rows[0] ?? { inserted: 0, updated: 0 };
  return {
    inserted: written.inserted,
    updated: written.updated,
    unchanged: rows.length - written.inserted - written.updated,
  };
}

/**
 * Writes units and agent_definitions inside the caller's transaction. Throws a DefinitionsError
 * before the first write when a check fails; the caller rolls back on any error.
 */
export async function syncDefinitions(
  client: Queryable,
  definitions: Definitions,
  options: SyncOptions = {},
): Promise<SyncReport> {
  await client.query(LOCK_SQL);

  // The restricted role sees no company without a context, and it cannot write the global tables.
  const known = new Set(await codes(client, 'select code from office.companies'));
  if (known.size === 0) {
    throw new DefinitionsError('no_company', 'No company is visible in the database', [
      'connect with the migration role, and load the companies first (supabase/seed.sql locally)',
    ]);
  }

  // No foreign key ties a company code of a unit or of a card to office.companies.
  const unknown = new Set<string>();
  for (const unit of definitions.units) {
    if (unit.companyCode !== null && !known.has(unit.companyCode)) {
      unknown.add(`unit ${unit.code}: company ${unit.companyCode}`);
    }
  }
  for (const agent of definitions.agents) {
    for (const company of agent.companyCodes) {
      if (!known.has(company)) {
        unknown.add(`agent ${agent.code}: company ${company}`);
      }
    }
  }
  if (unknown.size > 0) {
    throw new DefinitionsError(
      'unknown_company',
      'The files name a company the database does not have',
      [...unknown],
    );
  }

  const agentRows = definitions.agents.map((agent) => ({
    code: agent.code,
    name: agent.name,
    unit_code: agent.unitCode,
    company_codes: agent.companyCodes,
  }));
  const closed = await client.query<{ agent_code: string; company_code: string }>(
    CLOSED_COMPANY_SQL,
    [JSON.stringify(agentRows)],
  );
  if (closed.rows.length > 0) {
    throw new DefinitionsError(
      'closed_company',
      'A card no longer names a company that has a company_agents row for it',
      closed.rows.map((row) => `agent ${row.agent_code}: company ${row.company_code}`),
    );
  }

  // A card that left the repository keeps its row (rows cannot be deleted once used), and the
  // office reads every row. What should happen to such a card is not decided yet, so the run
  // stops unless the caller passes on purpose.
  const agentCodes = definitions.agents.map((agent) => agent.code);
  const orphanAgents = await codes(client, ORPHAN_AGENTS_SQL, [agentCodes]);
  if (orphanAgents.length > 0 && options.allowOrphanAgents !== true) {
    throw new DefinitionsError(
      'orphan_agent',
      'The database holds an agent the files no longer name',
      orphanAgents.map((code) => `agent ${code}`),
    );
  }

  const units = await upsert(
    client,
    UPSERT_UNITS_SQL,
    definitions.units.map((unit) => ({
      code: unit.code,
      name: unit.name,
      company_code: unit.companyCode,
      pilot_enabled: unit.pilotEnabled,
    })),
  );
  const agents = await upsert(client, UPSERT_AGENTS_SQL, agentRows);

  const unitCodes = definitions.units.map((unit) => unit.code);
  const orphanUnits = await codes(client, ORPHAN_UNITS_SQL, [unitCodes]);
  return { units, agents, orphanUnits, orphanAgents };
}
