import { storedCardSchema } from '@agent-office/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCards, readCardFiles, skillBody, syncCards, type CardFiles } from '../src/cards.ts';
import {
  DefinitionsError,
  parseDefinitions,
  readDefinitionFiles,
  syncDefinitions,
} from '../src/definitions.ts';
import { closePools, inAdminTransaction, inTransaction, noDatabase } from './helpers.ts';

// The card sync: the tool catalog and one card version per card, with its skills, from the files
// of the repository. The files used here are the repository's own, so a card, a skill or the
// catalog that the sync would refuse fails this test before anything is deployed.

const AGENTS_DIR = new URL('../../../agents/', import.meta.url);
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);

function refusal(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof DefinitionsError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('Expected the cards to be refused');
}

async function files(): Promise<CardFiles> {
  return readCardFiles(AGENTS_DIR, SKILLS_DIR);
}

function card(raw: CardFiles, code: string): Record<string, unknown> {
  const found = raw.cards.find((entry) => entry.file === `${code}.yaml`);
  if (!found) {
    throw new Error(`No card ${code}`);
  }
  return found.content as Record<string, unknown>;
}

describe('the card files of the repository', () => {
  it('give a version to every card whose skills are written, with the skill text inside', async () => {
    const set = parseCards(await files());
    const codes = set.versions.map((version) => version.card.code);
    // The first two agents that run (7 October decisions 8 and 11).
    expect(codes).toEqual(expect.arrayContaining(['KOR-1', 'SOS-2']));
    const sos = set.versions.find((version) => version.card.code === 'SOS-2');
    expect(sos?.skills.map((skill) => skill.name)).toEqual(['social-content', 'brand-voice']);
    expect(sos?.skills[0]?.body.startsWith('# Sosyal içerik yazımı')).toBe(true);
    expect(sos?.card.output_goes_external).toBe(true);
    // A card whose skills do not exist yet is reported, not refused.
    for (const entry of set.withoutSkills) {
      expect(codes).not.toContain(entry.code);
      expect(entry.missing.length).toBeGreaterThan(0);
    }
    for (const version of set.versions) {
      expect(storedCardSchema.safeParse(version).success).toBe(true);
    }
  });

  it('refuses a key it does not know, a tool outside the catalog, an unpriced model and a bad skill', async () => {
    const unknownKey = await files();
    card(unknownKey, 'SOS-2').prohibition = ['A typo that would drop a rule'];
    expect(refusal(() => parseCards(unknownKey))).toEqual([
      'SOS-2.yaml: Unrecognized key: "prohibition"',
    ]);

    const strangeTool = await files();
    card(strangeTool, 'KOR-1').tools = ['route_task', 'transfer_money'];
    expect(refusal(() => parseCards(strangeTool))).toEqual([
      'KOR-1.yaml: tools: transfer_money is not in the catalog',
    ]);

    const unpriced = await files();
    card(unpriced, 'SOS-2').model = 'some-other-model';
    expect(refusal(() => parseCards(unpriced))).toEqual([
      'SOS-2.yaml: model some-other-model has no row in models.yaml',
    ]);

    const badSkill = await files();
    badSkill.skills.set('routing', '---\nname: something-else\n---\nText');
    expect(refusal(() => parseCards(badSkill))).toEqual([
      'skills/routing/SKILL.md: name must be routing',
    ]);
    expect(skillBody('routing', 'No head')).toEqual({
      problem: 'skills/routing/SKILL.md: no YAML head',
    });
    expect(skillBody('routing', '---\nname: routing\n---\n\n  \n')).toEqual({
      problem: 'skills/routing/SKILL.md: empty body',
    });
  });
});

describe.skipIf(noDatabase)('the card sync', () => {
  afterAll(closePools);

  it('writes the catalog and a version once per content, and moves the agent to the new version', async () => {
    await inAdminTransaction(async (tx) => {
      const raw = await files();
      await syncDefinitions(tx.client, parseDefinitions(await readDefinitionFiles(AGENTS_DIR)), {
        allowOrphanAgents: true,
      });
      const first = await syncCards(tx.client, parseCards(raw), 'aaaaaaa');
      expect(first.written).toEqual(expect.arrayContaining(['KOR-1', 'SOS-2']));
      expect(first.unchanged).toEqual([]);
      expect(await tx.count('tools', `name = 'route_task' and kind = 'internal_write'`)).toBe(1);
      expect(await tx.count('tools')).toBeGreaterThanOrEqual(first.tools);
      const [current] = await tx.rows<{ model: string; level: string; status: string }>(
        `select v.model, v.authority_level as level, v.content -> 'card' ->> 'status' as status
         from office.agent_definitions d join office.card_versions v on v.id = d.current_version_id
         where d.code = 'SOS-2'`,
      );
      expect(current).toEqual({ model: 'claude-sonnet-5-5', level: 'Y1', status: 'active' });

      // The same files again: nothing is written, also under another commit.
      const again = await syncCards(tx.client, parseCards(raw), 'bbbbbbb');
      expect(again.written).toEqual([]);
      expect(again.unchanged).toEqual(first.written);

      // A skill changes: only the cards that name it get a new version, under the new commit.
      raw.skills.set('routing', `${raw.skills.get('routing') ?? ''}\nBir satır daha.\n`);
      const changed = await syncCards(tx.client, parseCards(raw), 'ccccccc');
      expect(changed.written).toEqual(['KOR-1']);
      expect(
        await tx.count('card_versions', `agent_code = 'KOR-1' and git_commit = 'ccccccc'`),
      ).toBe(1);
      // A second content under the same commit cannot be stored: the tree was not committed.
      raw.skills.set('routing', `${raw.skills.get('routing') ?? ''}\nVe bir satır daha.\n`);
      const error = await syncCards(tx.client, parseCards(raw), 'ccccccc').catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(DefinitionsError);
      expect((error as DefinitionsError).problems).toEqual([
        'agent KOR-1: another content is stored under commit ccccccc',
      ]);
    });
  });

  it('cannot be run with the application role', async () => {
    await inTransaction(async (tx) => {
      const error = await syncCards(tx.client, parseCards(await files()), 'aaaaaaa').catch(
        (caught: unknown) => caught as { code?: string },
      );
      expect((error as { code?: string }).code).toBe('42501');
    });
  });
});
