/**
 * From the answer of GET /api/office to what the office view draws. The API decides which units
 * and agents a company has and in which order they come; the panel neither sorts nor filters, so
 * the drawing can never disagree with the answer.
 */
import type { OfficeResponse } from '@agent-office/shared';
import { stateOf, type OfficeUnit } from './model.ts';

export function toOfficeUnits(response: OfficeResponse): OfficeUnit[] {
  return response.units.map((unit) => ({
    code: unit.code,
    name: unit.name,
    agents: unit.agents.map((agent) => ({
      code: agent.code,
      name: agent.name,
      state: stateOf(agent.status),
    })),
  }));
}
