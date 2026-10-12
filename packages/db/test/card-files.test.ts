import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  AGENT_READ_TOOL,
  cardSchema,
  modelsFileSchema,
  toolsFileSchema,
} from '@agent-office/shared';
import { parseCards, readCardFiles, type CardFiles } from '../src/cards.ts';
import { DefinitionsError } from '../src/definitions.ts';

// The files under agents/ against the schemas the sync and the runner parse them with: a card the
// schema refuses, a tool outside the catalog or a model without a price row fails here, before any
// database is touched.

const AGENTS = new URL('../../../agents/', import.meta.url);
const SKILLS = new URL('../../../skills/', import.meta.url);
const read = (file: string): unknown => parse(readFileSync(new URL(file, AGENTS), 'utf8'));
const cardFiles = readdirSync(AGENTS).filter(
  (name) => /\.yaml$/.test(name) && !['units.yaml', 'tools.yaml', 'models.yaml'].includes(name),
);

describe('the files under agents/', () => {
  const catalog = toolsFileSchema.parse(read('tools.yaml'));
  const models = modelsFileSchema.parse(read('models.yaml'));

  it('every card passes the full card schema and is named after its code', () => {
    expect(cardFiles.length).toBeGreaterThan(0);
    for (const file of cardFiles) {
      const card = cardSchema.safeParse(read(file));
      expect(card.error?.issues ?? [], file).toEqual([]);
      expect(`${card.data?.code ?? ''}.yaml`).toBe(file);
    }
  });

  it('a card names only tools of the catalog and only models with a price row', () => {
    const tools = new Set(catalog.tools.map((tool) => tool.name));
    const priced = new Set(models.models.map((model) => model.id));
    for (const file of cardFiles) {
      const card = cardSchema.parse(read(file));
      expect(
        card.tools.filter((tool) => !tools.has(tool)),
        `${file}: tools`,
      ).toEqual([]);
      for (const model of [card.model, ...(card.model_hard ? [card.model_hard] : [])]) {
        expect(priced.has(model), `${file}: model ${model}`).toBe(true);
      }
    }
  });

  it('the catalog has no tool twice', () => {
    const names = catalog.tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// The tool that reads project files (8 October decision 21): a card may name it only when it can
// ever be given it. The repository's own files, changed in memory.
describe('the reading tool on a card', () => {
  const refusal = (raw: CardFiles): string[] => {
    try {
      parseCards(raw);
    } catch (error) {
      if (error instanceof DefinitionsError) return [...error.problems];
      throw error;
    }
    return [];
  };
  const cardOf = (raw: CardFiles, code: string): Record<string, unknown> => {
    const found = raw.cards.find((entry) => entry.file === `${code}.yaml`);
    if (!found) throw new Error(`No card ${code}`);
    return found.content as Record<string, unknown>;
  };
  const RULES_HEADING = '## Proje dosyaları';

  it('a card that names the reading tool without a project context is refused', async () => {
    // As the repository has them, the files pass: the one card that names the tool runs in a
    // project when the request has one.
    const asIs = await readCardFiles(AGENTS, SKILLS);
    expect(refusal(asIs)).toEqual([]);
    const reading = asIs.cards
      .map((entry) => cardSchema.parse(entry.content))
      .filter((card) => card.tools.includes(AGENT_READ_TOOL));
    expect(reading.map((card) => [card.code, card.project_context])).toEqual([
      ['SOS-2', 'if_available'],
    ]);
    expect(toolsFileSchema.parse(asIs.tools).tools).toContainEqual(
      expect.objectContaining({ name: AGENT_READ_TOOL, kind: 'read' }),
    );

    const PROBLEM = `SOS-2.yaml: tools: ${AGENT_READ_TOOL} needs project_context required or if_available`;
    const without = await readCardFiles(AGENTS, SKILLS);
    delete cardOf(without, 'SOS-2').project_context;
    expect(refusal(without)).toEqual([PROBLEM]);
    const perProject = await readCardFiles(AGENTS, SKILLS);
    cardOf(perProject, 'SOS-2').project_context = 'per_project';
    expect(refusal(perProject)).toEqual([PROBLEM]);
    const required = await readCardFiles(AGENTS, SKILLS);
    cardOf(required, 'SOS-2').project_context = 'required';
    expect(refusal(required)).toEqual([]);
    // A card without the tool needs no project context.
    const noTool = await readCardFiles(AGENTS, SKILLS);
    const card = cardOf(noTool, 'SOS-2');
    card.tools = (card.tools as string[]).filter((tool) => tool !== AGENT_READ_TOOL);
    delete card.project_context;
    expect(refusal(noTool)).toEqual([]);
  });

  it('the reading tool needs the rules’ section', async () => {
    const PROBLEM = `common-rules.md: a card names ${AGENT_READ_TOOL}, but the section "${RULES_HEADING}" is missing`;
    const asIs = await readCardFiles(AGENTS, SKILLS);
    expect(asIs.rules.split('\n')).toContain(RULES_HEADING);
    // The heading is gone, renamed, or only quoted inside a sentence.
    for (const replacement of [
      '## Dosyalar',
      `${RULES_HEADING} ve notlar`,
      `Bkz. "${RULES_HEADING}"`,
    ]) {
      const raw = await readCardFiles(AGENTS, SKILLS);
      raw.rules = raw.rules
        .split('\n')
        .map((line) => (line === RULES_HEADING ? replacement : line))
        .join('\n');
      expect(refusal(raw), replacement).toEqual([PROBLEM]);
    }
    // No card names the tool: the rules need no such section.
    const noTool = await readCardFiles(AGENTS, SKILLS);
    noTool.rules = noTool.rules.replace(RULES_HEADING, '## Dosyalar');
    for (const entry of noTool.cards) {
      const card = entry.content as { tools?: string[] };
      card.tools = (card.tools ?? []).filter((tool) => tool !== AGENT_READ_TOOL);
    }
    expect(refusal(noTool)).toEqual([]);
  });
});
