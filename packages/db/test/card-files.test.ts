import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { cardSchema, modelsFileSchema, toolsFileSchema } from '@agent-office/shared';

// The files under agents/ against the schemas the sync and the runner parse them with: a card the
// schema refuses, a tool outside the catalog or a model without a price row fails here, before any
// database is touched.

const AGENTS = new URL('../../../agents/', import.meta.url);
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
