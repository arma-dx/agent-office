import type { CompanyAgentStatus } from './api.ts';
import {
  COORDINATOR_AGENT_CODE,
  type DerivedStage,
  type RequestCause,
  type RequestFacts,
} from './requests.ts';

/**
 * The live states of the office view (8 October decisions 9 and 10; docs/SONRA.md W-d and W-e).
 * Nothing here is a second rule about a request: where a request is comes from deriveStage alone,
 * and these functions only say which desk that stage belongs to and which state a desk shows.
 */

/** What an open request means for the agent that has it. */
export const AGENT_WORK_KINDS = ['running', 'awaiting_approval', 'failed'] as const;
export type AgentWorkKind = (typeof AGENT_WORK_KINDS)[number];

/**
 * The causes that put "Hata" on a desk: the three decision 10 names (the run failed, it hit its
 * limit, it ended without submitting a result). Every other way a request falls to a person leaves
 * the desk as it is: a stopped agent, a run that never started, a run the request changed under, a
 * model that refused or could not be reached, a card that may not run, a coordinator that chose no
 * unit, a second change request (docs/SONRA.md lists them as a question for the founder).
 */
export const AGENT_FAILURE_CAUSES: readonly RequestCause[] = [
  'run_failed',
  'limit_reached',
  'no_submission',
];

/**
 * The agent an open request belongs to on the office view, and in which condition; null when the
 * request stands on no desk (it waits for its requester or for a person for another reason, or it
 * is closed).
 *   routing                        the coordinator, running;
 *   working, revising              the agent of the active step, running;
 *   unit_approval                  the agent of the active step: its result waits for a decision;
 *   fell_to_person with a cause    the agent of the last run: that run is the one the cause is
 *   of AGENT_FAILURE_CAUSES        read from (deriveStage reads it from no other run).
 */
export function agentWorkOf(
  facts: RequestFacts,
  derived: DerivedStage,
  coordinator: string = COORDINATOR_AGENT_CODE,
): { agentCode: string; kind: AgentWorkKind } | null {
  switch (derived.stage) {
    case 'routing':
      return { agentCode: coordinator, kind: 'running' };
    case 'working':
    case 'revising':
      return facts.step === null ? null : { agentCode: facts.step.agentCode, kind: 'running' };
    case 'unit_approval':
      return facts.step === null
        ? null
        : { agentCode: facts.step.agentCode, kind: 'awaiting_approval' };
    case 'fell_to_person':
      return facts.lastRun !== null &&
        derived.cause !== null &&
        AGENT_FAILURE_CAUSES.includes(derived.cause)
        ? { agentCode: facts.lastRun.agentCode, kind: 'failed' }
        : null;
    case 'requester_approval':
    case 'done':
    case 'cancelled':
      return null;
  }
}

/** What a desk shows. The first two and the last are the company's switch; the rest are live. */
export const OFFICE_AGENT_STATES = [
  'closed',
  'idle',
  'running',
  'awaiting_approval',
  'error',
  'stopped',
] as const;
export type OfficeAgentState = (typeof OFFICE_AGENT_STATES)[number];

/**
 * The state of a desk. The switch comes first: a stopped agent is "Durduruldu" and an agent that
 * is not open is "Kapalı", whatever work of theirs is still counted. An open agent shows the
 * condition that needs a person most: an error, then a result that waits for approval, then
 * running; with nothing to count it is idle (docs/SONRA.md W-d).
 */
export function officeAgentState(
  status: CompanyAgentStatus | null,
  counts: { running: number; awaitingApproval: number; failed: number },
): OfficeAgentState {
  if (status === 'stopped') return 'stopped';
  if (status !== 'enabled') return 'closed';
  if (counts.failed > 0) return 'error';
  if (counts.awaitingApproval > 0) return 'awaiting_approval';
  return counts.running > 0 ? 'running' : 'idle';
}
