import { describe, expect, it } from 'vitest';
import { gateToolCall, type CatalogTool } from '../src/runner/gate.ts';
import { ASK_REQUESTER } from '../src/runner/tools.ts';

// The gate is pure and every tool call passes it: this table is the Y1 rule, the external effect
// rule and the "only the card's tools" rule as code (rule 4; CLAUDE.md, "Y1 kapısı").

const tool = (
  name: string,
  kind: CatalogTool['kind'],
  approvalRule: string | null = null,
): CatalogTool => ({ name, kind, approvalRule });

const catalog = {
  read: tool('read_task', 'read'),
  draft: tool('submit_for_approval', 'draft'),
  draftWithRule: tool('write_station_candidates', 'draft', 'Mevcut bir istasyon kapatılıyorsa'),
  write: tool('send_notification', 'internal_write'),
  route: tool('route_task', 'internal_write'),
  writeWithRule: tool('update_task', 'internal_write', 'Görevin atananı değişiyorsa'),
  external: tool('send_email', 'external_effect'),
};
const all = Object.values(catalog).map((entry) => entry.name);

describe('the gate of a tool call', () => {
  const decide = (level: 'Y0' | 'Y1' | 'Y2' | 'Y3', entry: CatalogTool, tools = all): string => {
    const decision = gateToolCall({ level, tools }, entry, entry.name);
    return decision.kind === 'refuse' ? decision.code : decision.kind;
  };

  it('a Y1 agent reads and writes its own draft space; every shared write goes to approval', () => {
    expect(decide('Y1', catalog.read)).toBe('execute');
    expect(decide('Y1', catalog.draft)).toBe('execute');
    expect(decide('Y1', catalog.write)).toBe('to_approval');
    expect(decide('Y1', catalog.route)).toBe('to_approval');
    expect(decide('Y0', catalog.write)).toBe('to_approval');
  });

  it('a Y2 agent writes shared records by itself unless a written rule exists', () => {
    expect(decide('Y2', catalog.route)).toBe('execute');
    expect(decide('Y2', catalog.write)).toBe('execute');
    expect(decide('Y2', catalog.writeWithRule)).toBe('to_approval');
    expect(decide('Y3', catalog.writeWithRule)).toBe('to_approval');
  });

  it('an external effect and a written approval rule go to approval at every level', () => {
    for (const level of ['Y0', 'Y1', 'Y2', 'Y3'] as const) {
      expect(decide(level, catalog.external)).toBe('to_approval');
      expect(decide(level, catalog.draftWithRule)).toBe('to_approval');
    }
  });

  it('refuses a tool that is not on the card or not in the catalog', () => {
    expect(decide('Y3', catalog.external, ['read_task'])).toBe('tool_not_on_card');
    expect(gateToolCall({ level: 'Y3', tools: ['made_up'] }, undefined, 'made_up')).toEqual({
      kind: 'refuse',
      code: 'tool_not_in_catalog',
    });
    // The catalog row must be the row of the tool that was called.
    expect(gateToolCall({ level: 'Y3', tools: all }, catalog.read, 'send_email')).toEqual({
      kind: 'refuse',
      code: 'tool_not_in_catalog',
    });
  });

  it('the gate knows nothing of the asking tool', () => {
    // A question to the requester is the runner's own path (CLAUDE.md "İnsana sor"): it does not
    // lead through this gate, and nothing a card or a catalog holds can open it here. The name
    // has no catalog row (the card schema and the database refuse one), so the gate, asked
    // about it, answers as for any name it does not know, at every level and whatever the
    // card lists.
    for (const level of ['Y0', 'Y1', 'Y2', 'Y3'] as const) {
      expect(gateToolCall({ level, tools: all }, undefined, ASK_REQUESTER)).toEqual({
        kind: 'refuse',
        code: 'tool_not_in_catalog',
      });
      expect(
        gateToolCall({ level, tools: [...all, ASK_REQUESTER] }, undefined, ASK_REQUESTER),
      ).toEqual({ kind: 'refuse', code: 'tool_not_in_catalog' });
    }
  });
});
