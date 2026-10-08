/**
 * What the office view draws: units with their agents, and the state of each agent. The API's
 * answer (officeResponseSchema in packages/shared) is turned into this shape by from-api.ts.
 */
import {
  officeAgentState,
  type CompanyAgentStatus,
  type OfficeAgentState,
  type OfficeAgentWork,
  type OfficeWorkCount,
} from '@agent-office/shared';

/**
 * What a desk shows: the company's switch (closed, stopped) and, for an open agent, what its
 * open requests say (idle, running, awaiting approval, error). The rule is the shared one
 * (officeAgentState); the panel only gives it words.
 */
export type AgentState = OfficeAgentState;

/**
 * The open requests of an agent in this company, as the reader may see them: how many it is
 * working on, how many of its results wait for approval, how many fell to a person because of
 * its run. A count of one carries the request, so that the panel can lead to it.
 */
export type AgentWork = Pick<OfficeAgentWork, 'running' | 'awaitingApproval' | 'failed'>;

const NO_COUNT: OfficeWorkCount = { count: 0, requestId: null };

/** An agent the office answer lists no work for. One object, so equal data stays equal. */
export const NO_WORK: AgentWork = {
  running: NO_COUNT,
  awaitingApproval: NO_COUNT,
  failed: NO_COUNT,
};

export interface OfficeAgent {
  readonly code: string;
  readonly name: string;
  readonly state: AgentState;
  /**
   * The card has a version to run with. An agent without one cannot be opened (the API refuses
   * it), so the panel does not offer to. It says nothing about the card's own status field.
   */
  readonly ready: boolean;
  readonly work: AgentWork;
}

export interface OfficeUnit {
  readonly code: string;
  readonly name: string;
  readonly agents: readonly OfficeAgent[];
}

/** Turkish label of each state; the same words go into the accessible name and the legend. */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  closed: 'Kapalı',
  idle: 'Boşta',
  running: 'Çalışıyor',
  awaiting_approval: 'Onay bekliyor',
  error: 'Hata',
  stopped: 'Durduruldu',
};

/**
 * One sentence per state, for the detail of a selected agent. It claims no history and names no
 * company: "closed" covers an agent that was never opened and one that was closed again, and
 * Kurucu alanı is not a company.
 */
export const AGENT_STATE_SENTENCE: Record<AgentState, string> = {
  closed: 'Bu ajan kapalı.',
  idle: 'Bu ajan açık ve boşta.',
  running: 'Bu ajan çalışıyor.',
  awaiting_approval: 'Bu ajanın sonucu onay bekliyor.',
  error: 'Bu ajanın yürüttüğü bir talep insana düştü.',
  stopped: 'Bu ajan durduruldu, yeni iş almaz.',
};

/** The three counts of the selected agent's panel, in the order they are listed. */
export const WORK_ROWS = [
  { key: 'running', label: AGENT_STATE_LABEL.running },
  { key: 'awaitingApproval', label: AGENT_STATE_LABEL.awaiting_approval },
  { key: 'failed', label: AGENT_STATE_LABEL.error },
] as const satisfies readonly { key: keyof AgentWork; label: string }[];

/**
 * What the founder reads in place of the button that would open an agent whose card has no version
 * to run with. The same words as the first sentence of the API's refusal (agent_not_ready).
 */
export const AGENT_NOT_READY_SENTENCE = 'Bu ajan henüz açılamaz: kartının çalışacak sürümü yok.';

/**
 * The state drawn for a company's switch and the agent's open requests. No row and `disabled`
 * look the same: for this company the agent is closed. Why, the data does not say.
 */
export function stateOf(status: CompanyAgentStatus | null, work: AgentWork = NO_WORK): AgentState {
  return officeAgentState(status, {
    running: work.running.count,
    awaitingApproval: work.awaitingApproval.count,
    failed: work.failed.count,
  });
}

/** The company's switch is on for the agent: every state but closed and stopped. */
export function isOpen(state: AgentState): boolean {
  return state !== 'closed' && state !== 'stopped';
}

/** The unit that stands in the middle of the office when the company has it: Kurumsal Hafıza. */
export const CENTRE_UNIT = 'HAF';

/** Identity of a selectable thing in the scene; also the value of data-office-id. */
export function unitId(code: string): string {
  return `unit:${code}`;
}

export function agentId(code: string): string {
  return `agent:${code}`;
}

/** The selected thing: a unit, or an agent together with the unit it sits in. */
export type OfficeSelection =
  | { readonly kind: 'unit'; readonly unit: OfficeUnit }
  | { readonly kind: 'agent'; readonly unit: OfficeUnit; readonly agent: OfficeAgent };

/** What a selected id stands for in the drawn list. Null for an id the list does not hold. */
export function selectionOf(units: readonly OfficeUnit[], id: string): OfficeSelection | null {
  for (const unit of units) {
    if (unitId(unit.code) === id) return { kind: 'unit', unit };
    const agent = unit.agents.find((candidate) => agentId(candidate.code) === id);
    if (agent) return { kind: 'agent', unit, agent };
  }
  return null;
}

/** Names the panel already uses for a place; a card name that would shorten to one of them stays whole. */
const PLACE_NAMES: ReadonlySet<string> = new Set(['Onay Masası']);

/**
 * The name written on an agent label: the card name without the closing word "Ajanı", unless what
 * is left is the name of a place in the panel ("Onay Masası Ajanı" stays whole).
 */
export function shortName(name: string): string {
  const short = name.replace(/ Ajanı$/u, '');
  return PLACE_NAMES.has(short) ? name : short;
}
