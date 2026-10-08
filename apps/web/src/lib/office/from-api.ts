/**
 * From the answer of GET /api/office to what the office view draws. The API decides which units
 * and agents a company has and in which order they come; the panel neither sorts nor filters, so
 * the drawing can never disagree with the answer.
 */
import type { OfficeResponse } from '@agent-office/shared';
import { NO_WORK, stateOf, type AgentWork, type OfficeUnit } from './model.ts';

export function toOfficeUnits(response: OfficeResponse): OfficeUnit[] {
  // An agent the answer lists no work for has none.
  const works = new Map<string, AgentWork>(
    response.work.map(({ running, awaitingApproval, failed, agentCode }) => [
      agentCode,
      { running, awaitingApproval, failed },
    ]),
  );
  return response.units.map((unit) => ({
    code: unit.code,
    name: unit.name,
    agents: unit.agents.map((agent) => {
      const work = works.get(agent.code) ?? NO_WORK;
      return {
        code: agent.code,
        name: agent.name,
        state: stateOf(agent.status, work),
        ready: agent.ready,
        work,
      };
    }),
  }));
}
