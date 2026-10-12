import type { StoredCard } from '@agent-office/shared';
import { ASK_REQUESTER, ASK_RULES_HEADING } from './tools.ts';

/**
 * Prompt assembly (rule 7: external content is data, not instructions).
 *
 * Three places, three kinds of content:
 *   system   INSTRUCTIONS only, from the card version: the common rules, the card rendered field
 *            by field with the runner's caveat about what is offered in this version, the text of
 *            its skills. Nothing a person typed and nothing a tool returned is ever put here, so
 *            two runs of one card version that are given the same tools send the same bytes (a
 *            run that may ask and a run that may not differ in one sentence and one tool), which
 *            is also what lets the provider cache it.
 *   tools    the runner's own definitions (tools.ts).
 *   user     DATA only, in marked blocks: what was asked, the facts of the run, what the
 *            requester answered to an agent's question on this request, and for the coordinator
 *            the units and agents of the company.
 *
 * The request text is data although a colleague typed it: it can hold pasted outside text, and
 * the requester orders work but does not set the agent's rules.
 *
 * The answer to an agent's question is data although the requester typed it for the agent, like
 * the request text: it can hold pasted outside text, and it orders nothing.
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
 * working that need them (opening a sub-task, leaving a task suggestion, sending a message).
 * Without this caveat the prompt would promise abilities the run does not have. Built from the
 * tools that are offered; the sentence about the three ways must be shortened when a handler for
 * one of them arrives.
 *
 * A question to the requester is the runner's own tool and is named here when the run is given
 * it; a run that is not given it is told that it cannot ask, because the card still speaks of
 * asking. The sentence names no reason: a run may not ask because its agent has used its
 * questions on the request, or because its card version is from before the question texts.
 */
function offeredCaveat(
  cardTools: readonly string[],
  offered: readonly string[],
  mayAsk: boolean,
): string {
  const code = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(', ');
  const missing = cardTools.filter((name) => !offered.includes(name));
  const given = mayAsk ? [...offered, ASK_REQUESTER] : offered;
  const have =
    given.length === 0
      ? 'Bu çalışmada elinde hiçbir araç yok.'
      : `Bu çalışmada elinde yalnızca şu ${given.length === 1 ? 'araç' : 'araçlar'} var: ${code(given)}.`;
  const lack =
    missing.length === 0
      ? ''
      : ` Kartında adı geçen öteki araçlar (${code(missing)}) henüz açık değil.`;
  // The heading as the common rules print it, without its marks.
  const heading = ASK_RULES_HEADING.replace(/^#+\s*/, '');
  const asking = mayAsk
    ? `Talep sahibine \`${ASK_REQUESTER}\` aracıyla soru sorabilirsin; ne zaman soracağın ve ne zaman sormayacağın ortak kurallarda, "${heading}" başlığında yazıyor; yöntemin daha dar bir kural koyuyorsa o geçerlidir.`
    : 'Bu çalışmada talep sahibine soru soramazsın.';
  return `\n\n## Bu sürümde elindekiler\n\n${have}${lack} ${asking} Alt görev açamaz, görev önerisi bırakamaz, bildirim ya da mesaj gönderemezsin; kartının bunlardan söz eden satırları henüz yürürlükte değil.`;
}

/**
 * The instruction part: the same text for every run of a card version that is given the same
 * tools. `offered` are the names of the card's tools the model is given with it (the ones the
 * runner has a handler for); `mayAsk` says whether the runner's asking tool is given beside them.
 */
export function systemText(
  stored: StoredCard,
  offered: readonly string[],
  mayAsk: boolean,
): string {
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
      offeredCaveat(card.tools, offered, mayAsk),
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

/** One answered question of the request, as a run is given it. */
export interface AskedAndAnswered {
  // The code of the agent that asked.
  askedBy: string;
  // This run's own agent asked it.
  own: boolean;
  question: string;
  answer: string;
  // Who wrote the answer: the requester, or the founder in the place of a requester who cannot
  // read the request any more. Never a name.
  answeredBy: 'requester' | 'founder_for_requester';
}

export interface PromptData {
  facts: RunFacts;
  request: { title: string; text: string };
  // The answered questions of the request, oldest first: the run's own and those another agent
  // asked on the same request (today: the coordinator's). Data like the request text: an answer
  // sets no rule and approves nothing.
  questions?: AskedAndAnswered[];
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
  if (data.questions && data.questions.length > 0) {
    blocks.push(dataBlock('questions_and_answers', data.questions));
  }
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
