/**
 * What the office view draws: units with their agents, and the state of each agent. The API's
 * answer (officeResponseSchema in packages/shared) is turned into this shape by from-api.ts.
 */
import type { CompanyAgentStatus } from '@agent-office/shared';

/**
 * What version 1 knows about an agent: the company's switch. The live states (idle, running,
 * awaiting approval, error) join this union when they are connected.
 */
export type AgentState = 'closed' | 'enabled' | 'stopped';

export interface OfficeAgent {
  readonly code: string;
  readonly name: string;
  readonly state: AgentState;
}

export interface OfficeUnit {
  readonly code: string;
  readonly name: string;
  readonly agents: readonly OfficeAgent[];
}

/** Turkish label of each state; the same words go into the accessible name and the legend. */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  closed: 'Kapalı',
  enabled: 'Etkin',
  stopped: 'Durduruldu',
};

/**
 * The state drawn for a company's switch. No row and `disabled` look the same: for this company
 * the agent is closed. Why, the data does not say.
 */
export function stateOf(status: CompanyAgentStatus | null): AgentState {
  if (status === 'stopped') return 'stopped';
  return status === 'enabled' ? 'enabled' : 'closed';
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
