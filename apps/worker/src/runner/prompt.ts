import type { StoredCard } from '@agent-office/shared';

/**
 * Prompt assembly (rule 7: external content is data, not instructions).
 *
 * Three places, three kinds of content:
 *   system   INSTRUCTIONS only, from the card version: the common rules, the card rendered field
 *            by field, the text of its skills. Nothing a person typed and nothing a tool returned
 *            is ever put here, so two runs of one card version send the same bytes (which is also
 *            what lets the provider cache it).
 *   tools    the runner's own definitions (tools.ts).
 *   user     DATA only, in marked blocks: what was asked, the facts of the run, and for the
 *            coordinator the units and agents of the company.
 *
 * The request text is data although a colleague typed it: it can hold pasted outside text, and
 * the requester orders work but does not set the agent's rules.
 */

function list(title: string, items: readonly string[]): string {
  return items.length === 0
    ? ''
    : `\n\n## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** The instruction part: the same text for every run of a card version. */
export function systemText(stored: StoredCard): string {
  const { card } = stored;
  const head = `# Görev kartın: ${card.code} ${card.name}\n\n${card.purpose}`;
  const limits = `\n\n## Sınırlar\n\nBu çalışmada en çok ${String(card.limits.tool_calls)} araç çağrısı yapabilirsin ve çalışma en çok ${String(card.limits.duration_minutes)} dakika sürebilir.`;
  const sources =
    card.knowledge_sources.length === 0
      ? ''
      : `${list('Kartındaki bilgi kaynakları', card.knowledge_sources)}\n\nBu kaynaklar sana yalnızca veri bloklarında ya da bir aracın sonucunda verilirse elindedir; verilmediyse yok say ve varmış gibi yazma.`;
  const skills = stored.skills.map((skill) => skill.body).join('\n\n');
  return [
    stored.rules.body,
    head +
      list('Çıktıların', card.outputs) +
      list('Onay noktaları', card.approval_points) +
      list('Takıldığında', card.escalation) +
      list('Yapmayacakların', card.prohibitions) +
      sources +
      limits,
    skills,
  ]
    .filter((part) => part !== '')
    .join('\n\n---\n\n');
}

/**
 * One marked block of data. The content is JSON with every "<" written as an escape, so nothing
 * inside it can close the block or open another one.
 */
export function dataBlock(name: string, content: unknown): string {
  const json = JSON.stringify(content).replaceAll('<', '\\u003c');
  return `<${name}>\n${json}\n</${name}>`;
}

export interface RunFacts {
  company: string;
  // The requester's role, never their name or address.
  requesterRole: 'founder' | 'employee';
  today: string;
  agent: string;
}

export interface UnitForRouting {
  unit: string;
  name: string;
  agents: { code: string; name: string; purpose: string }[];
}

export interface Revision {
  askedBy: 'approver' | 'requester';
  reason: string;
  note: string | null;
  previousOutput: unknown;
}

export interface PromptData {
  facts: RunFacts;
  request: { title: string; text: string };
  // The coordinator only.
  units?: UnitForRouting[];
  // A unit agent only, when a person corrected the routing to it: that person's note, as data.
  routing?: { correctedByPerson: true; note: string | null };
  // A second attempt only: what was written before and what the person asked to change.
  revision?: Revision;
}

/** The data part: the first user message. */
export function dataText(data: PromptData): string {
  const blocks = [dataBlock('run_facts', data.facts), dataBlock('request', data.request)];
  if (data.units) {
    blocks.push(dataBlock('units_and_agents', data.units));
  }
  if (data.routing) {
    blocks.push(dataBlock('routing_note', data.routing));
  }
  if (data.revision) {
    blocks.push(dataBlock('revision', data.revision));
  }
  return blocks.join('\n\n');
}
