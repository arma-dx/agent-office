import type { StoredCard } from '@agent-office/shared';

/**
 * Prompt assembly (rule 7: external content is data, not instructions).
 *
 * Three places, three kinds of content:
 *   system   INSTRUCTIONS only, from the card version: the common rules, the card rendered field
 *            by field with the runner's caveat about what is offered in this version, the text of
 *            its skills. Nothing a person typed and nothing a tool returned is ever put here, so
 *            two runs of one card version send the same bytes (which is also what lets the
 *            provider cache it).
 *   tools    the runner's own definitions (tools.ts).
 *   user     DATA only, in marked blocks: what was asked, the facts of the run, and for the
 *            coordinator the units and agents of the company.
 *
 * The request text is data although a colleague typed it: it can hold pasted outside text, and
 * the requester orders work but does not set the agent's rules.
 *
 * Comments on a request are for people (8 October decision 13). Nothing here takes one: no block,
 * no fact, no tool result. The database holds the same line: the worker's role is shown no
 * comment of a request, with any context.
 */

function list(title: string, items: readonly string[]): string {
  return items.length === 0
    ? ''
    : `\n\n## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/**
 * What the runner really offers, said once after the card. The card is rendered as it is written,
 * and it describes the agent as it will be: tools the runner has no handler for yet, and ways of
 * working that need them (asking a question, opening a sub-task, leaving a task suggestion,
 * sending a message). Without this caveat the prompt would promise abilities the run does not
 * have. Built from the tools that are offered; the sentence about the four ways must be shortened
 * when a handler for one of them arrives.
 */
function offeredCaveat(cardTools: readonly string[], offered: readonly string[]): string {
  const code = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(', ');
  const missing = cardTools.filter((name) => !offered.includes(name));
  const have =
    offered.length === 0
      ? 'Bu çalışmada elinde hiçbir araç yok.'
      : `Bu çalışmada elinde yalnızca şu ${offered.length === 1 ? 'araç' : 'araçlar'} var: ${code(offered)}.`;
  const lack =
    missing.length === 0
      ? ''
      : ` Kartında adı geçen öteki araçlar (${code(missing)}) henüz açık değil.`;
  return `\n\n## Bu sürümde elindekiler\n\n${have}${lack} Soru soramaz, alt görev açamaz, görev önerisi bırakamaz, bildirim ya da mesaj gönderemezsin; kartının bunlardan söz eden satırları henüz yürürlükte değil.`;
}

/**
 * The instruction part: the same text for every run of a card version. `offered` are the names of
 * the tools the model is given with it (the card's tools the runner has a handler for).
 */
export function systemText(stored: StoredCard, offered: readonly string[]): string {
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
      limits +
      offeredCaveat(card.tools, offered),
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
  // The role of the person the run goes as: the requester, or the founder standing in for a
  // requester who can no longer read the request. Never a name or an address.
  requesterRole: 'founder' | 'employee';
  today: string;
  agent: string;
  // The name of the request's project, when it is inside one.
  project?: string;
  // The due day the requester gave (YYYY-MM-DD, the office's day); absent when none. A fact of
  // the request, given as data like the rest of this block: it orders nothing.
  dueDate?: string;
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
