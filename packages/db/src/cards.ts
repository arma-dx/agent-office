import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import {
  cardSchema,
  modelsFileSchema,
  storedCardSchema,
  toolsFileSchema,
  type Card,
  type ModelProfile,
  type StoredCard,
  type ToolsFile,
} from '@agent-office/shared';
import { parse } from 'yaml';
import type { z } from 'zod';
import { DefinitionsError } from './definitions.ts';
import type { Queryable } from './queryable.ts';

/**
 * Card sync: writes the tool catalog (office.tools) and one card version per card
 * (office.card_versions, with the common rules and the text of the card's skills) from the files
 * under agents/ and skills/, and points each agent at its current version. It follows the definitions sync, which
 * writes the units and the agents themselves; without a card version no agent can run.
 *
 * A version is written only when the card or one of its skills changed, under the git commit that
 * carries the change; every run names the version it ran with (CLAUDE.md: "Her yayında kartlar
 * card_versions tablosuna git commit kimliğiyle senkronize edilir"). A card whose skills are not
 * written yet gets no version and is reported: its agent cannot run until they exist.
 *
 * Like the definitions sync this runs with the migration role (rule 9) and is not exported from
 * index.ts. It opens no agent for any company: that is the founder's switch.
 */

const SKIP = new Set(['units.yaml', 'tools.yaml', 'models.yaml']);
const RULES_FILE = 'common-rules.md';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface CardFiles {
  tools: unknown;
  models: unknown;
  cards: { file: string; content: unknown }[];
  // agents/common-rules.md: the rules every agent gets before its card.
  rules: string;
  // The text of skills/<name>/SKILL.md, by skill name.
  skills: Map<string, string>;
}

export interface CardSet {
  tools: ToolsFile['tools'];
  versions: StoredCard[];
  // Cards that name a skill that is not written yet.
  withoutSkills: { code: string; missing: string[] }[];
}

async function yaml(dir: URL, file: string): Promise<unknown> {
  try {
    return parse(await readFile(new URL(file, dir), 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable';
    throw new DefinitionsError('invalid_files', 'A card file could not be read', [
      `${file}: ${reason}`,
    ]);
  }
}

/** Reads agents/ and skills/ without validating. Both URLs end with a slash. */
export async function readCardFiles(agentsDir: URL, skillsDir: URL): Promise<CardFiles> {
  const names = (await readdir(agentsDir))
    .filter((name) => /\.ya?ml$/.test(name) && !SKIP.has(name))
    .sort();
  const cards: CardFiles['cards'] = [];
  for (const file of names) {
    cards.push({ file, content: await yaml(agentsDir, file) });
  }
  const skills = new Map<string, string>();
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      skills.set(entry.name, await readFile(new URL(`${entry.name}/SKILL.md`, skillsDir), 'utf8'));
    } catch {
      // A folder without a SKILL.md is not a skill yet.
    }
  }
  let rules: string;
  try {
    rules = await readFile(new URL(RULES_FILE, agentsDir), 'utf8');
  } catch {
    throw new DefinitionsError('invalid_files', 'A card file could not be read', [RULES_FILE]);
  }
  return {
    tools: await yaml(agentsDir, 'tools.yaml'),
    models: await yaml(agentsDir, 'models.yaml'),
    cards,
    rules,
    skills,
  };
}

function problemsOf(file: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const field = issue.path.map(String).join('.');
    return `${file}: ${field === '' ? '' : `${field}: `}${issue.message}`;
  });
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * The body of a SKILL.md: the text after its YAML head. The head must name the skill as its folder
 * does. Returns the problem instead of the body when the file is not usable.
 */
export function skillBody(name: string, text: string): { body: string } | { problem: string } {
  const head = FRONT_MATTER.exec(text);
  if (!head) {
    return { problem: `skills/${name}/SKILL.md: no YAML head` };
  }
  let meta: unknown;
  try {
    meta = parse(head[1] ?? '');
  } catch {
    return { problem: `skills/${name}/SKILL.md: the head is not valid YAML` };
  }
  if (typeof meta !== 'object' || meta === null || (meta as { name?: unknown }).name !== name) {
    return { problem: `skills/${name}/SKILL.md: name must be ${name}` };
  }
  const body = text.slice(head[0].length).trim();
  return body === '' ? { problem: `skills/${name}/SKILL.md: empty body` } : { body };
}

/**
 * Validates the catalog, the model table and every card, and joins each card with its skills.
 * Pure. Every failure is collected before throwing, each with its file and field.
 */
export function parseCards(raw: CardFiles): CardSet {
  const problems: string[] = [];
  const catalog = toolsFileSchema.safeParse(raw.tools);
  if (!catalog.success) problems.push(...problemsOf('tools.yaml', catalog.error));
  const models = modelsFileSchema.safeParse(raw.models);
  if (!models.success) problems.push(...problemsOf('models.yaml', models.error));
  const tools = catalog.success ? catalog.data.tools : [];
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (toolNames.has(tool.name)) problems.push(`tools.yaml: ${tool.name} is listed twice`);
    toolNames.add(tool.name);
  }
  const catalogRows = new Map(tools.map((tool) => [tool.name, tool]));
  const profiles = new Map(
    models.success ? models.data.models.map((model) => [model.id, model]) : [],
  );
  const priced = new Set(profiles.keys());

  const rulesBody = raw.rules.trim();
  if (rulesBody === '') problems.push(`${RULES_FILE}: empty`);
  const rules = { sha256: sha256(rulesBody), body: rulesBody };

  const versions: StoredCard[] = [];
  const withoutSkills: CardSet['withoutSkills'] = [];
  for (const { file, content } of raw.cards) {
    const parsed = cardSchema.safeParse(content);
    if (!parsed.success) {
      problems.push(...problemsOf(file, parsed.error));
      continue;
    }
    const card: Card = parsed.data;
    if (`${card.code}.yaml` !== file) {
      problems.push(`${file}: code: the file must be named ${card.code}.yaml`);
    }
    for (const tool of card.tools) {
      if (!toolNames.has(tool)) problems.push(`${file}: tools: ${tool} is not in the catalog`);
    }
    for (const model of [card.model, ...(card.model_hard === undefined ? [] : [card.model_hard])]) {
      if (!priced.has(model)) problems.push(`${file}: model ${model} has no row in models.yaml`);
    }
    const missing = card.skills.filter((skill) => !raw.skills.has(skill));
    if (missing.length > 0) {
      withoutSkills.push({ code: card.code, missing });
      continue;
    }
    const skills: StoredCard['skills'] = [];
    for (const name of card.skills) {
      const result = skillBody(name, raw.skills.get(name) ?? '');
      if ('problem' in result) {
        problems.push(result.problem);
      } else {
        skills.push({ name, sha256: sha256(result.body), body: result.body });
      }
    }
    // The catalog rows of the card's own tools and the profile of its model are part of the
    // version: a change of tools.yaml or models.yaml writes a new version for the cards it touches.
    const profile = profiles.get(card.model);
    if (profile === undefined) continue;
    versions.push({
      card,
      tools: card.tools.flatMap((name) => {
        const row = catalogRows.get(name);
        return row ? [row] : [];
      }),
      model: profile,
      rules,
      skills,
    });
  }
  if (problems.length > 0) {
    throw new DefinitionsError('invalid_files', 'The card files are not valid', problems);
  }
  return { tools, versions, withoutSkills };
}

export interface CardSyncReport {
  tools: number;
  written: string[];
  unchanged: string[];
  withoutSkills: CardSet['withoutSkills'];
}

/**
 * Writes the catalog and the card versions inside the caller's transaction. `gitCommit` is the
 * commit that carries the files as they are (the caller refuses a dirty tree): two contents can
 * never be stored for one agent under one commit.
 */
export async function syncCards(
  client: Queryable,
  set: CardSet,
  gitCommit: string,
): Promise<CardSyncReport> {
  await client.query(
    `insert into office.tools (name, kind, description, approval_rule)
     select t.name, t.kind, t.description, t.approval_rule
     from jsonb_to_recordset($1::jsonb)
       as t (name text, kind text, description text, approval_rule text)
     on conflict (name) do update
       set kind = excluded.kind, description = excluded.description,
           approval_rule = excluded.approval_rule`,
    [JSON.stringify(set.tools.map((tool) => ({ approval_rule: null, ...tool })))],
  );
  const written: string[] = [];
  const unchanged: string[] = [];
  const problems: string[] = [];
  for (const version of set.versions) {
    const content = JSON.stringify(storedCardSchema.parse(version));
    const { code } = version.card;
    const current = await client.query<{ known: boolean; same: boolean | null }>(
      `select true as known, v.content = $2::jsonb as same
       from office.agent_definitions d
       left join office.card_versions v on v.id = d.current_version_id
       where d.code = $1`,
      [code, content],
    );
    const row = current.rows[0];
    if (!row) {
      problems.push(`agent ${code}: not in agent_definitions; sync the definitions first`);
      continue;
    }
    if (row.same === true) {
      unchanged.push(code);
      continue;
    }
    const inserted = await client.query<{ id: string }>(
      `insert into office.card_versions (agent_code, git_commit, content, authority_level, model)
       values ($1, $2, $3::jsonb, $4, $5)
       on conflict (agent_code, git_commit) do nothing
       returning id`,
      [code, gitCommit, content, version.card.authority.level, version.card.model],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) {
      problems.push(`agent ${code}: another content is stored under commit ${gitCommit}`);
      continue;
    }
    await client.query(
      'update office.agent_definitions set current_version_id = $2 where code = $1',
      [code, id],
    );
    written.push(code);
  }
  if (problems.length > 0) {
    throw new DefinitionsError('invalid_files', 'The card versions could not be written', problems);
  }
  return { tools: set.tools.length, written, unchanged, withoutSkills: set.withoutSkills };
}

/**
 * agents/models.yaml by model id: how each model is called and what it costs. A run takes the
 * profile from its card version; this reads the file itself, for the scripts that work without a
 * database (the smoke call). The directory URL ends with a slash.
 */
export async function readModels(agentsDir: URL): Promise<Map<string, ModelProfile>> {
  const file = modelsFileSchema.safeParse(await yaml(agentsDir, 'models.yaml'));
  if (!file.success) {
    throw new DefinitionsError(
      'invalid_files',
      'The model table is not valid',
      problemsOf('models.yaml', file.error),
    );
  }
  return new Map(file.data.models.map((model) => [model.id, model]));
}
