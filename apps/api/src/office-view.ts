import type { RequestRow } from '@agent-office/db';
import {
  agentWorkOf,
  deriveStage,
  OFFICE_REQUEST_LIMIT,
  type AgentWorkKind,
  type OfficeAgentWork,
  type OfficeWorkCount,
} from '@agent-office/shared';
import { factsOf } from './requests-view.ts';

/**
 * The live part of the office answer, from rows the person could read. Pure functions: no query is
 * made here, so a request that was not given to the reader cannot be counted.
 */

/** One open request on a desk. */
export interface AgentWorkItem {
  agentCode: string;
  kind: AgentWorkKind;
  requestId: string;
}

/**
 * The desk a request stands on, or null. The stage is derived exactly as for the request page and
 * the Bugün list (factsOf, deriveStage); only its meaning for a desk is added (agentWorkOf).
 */
export function workOfRequest(row: RequestRow, now: Date): AgentWorkItem | null {
  const facts = factsOf(row);
  const work = agentWorkOf(facts, deriveStage(facts, now));
  return work === null ? null : { ...work, requestId: row.id };
}

function countOf(requestIds: readonly string[]): OfficeWorkCount {
  return {
    count: requestIds.length,
    requestId: requestIds.length === 1 ? (requestIds[0] ?? null) : null,
  };
}

/**
 * The counts of the office answer: one entry for each agent of `agentCodes` that has something to
 * count, in the order of `agentCodes` (the order of the office). Work of an agent that has no desk
 * in this office is left out: there is nowhere to show it.
 */
export function officeWork(
  rows: readonly RequestRow[],
  agentCodes: readonly string[],
  now: Date,
): OfficeAgentWork[] {
  const byAgent = new Map<string, Record<AgentWorkKind, string[]>>();
  for (const row of rows) {
    const item = workOfRequest(row, now);
    if (item === null) continue;
    let lists = byAgent.get(item.agentCode);
    if (lists === undefined) {
      lists = { running: [], awaiting_approval: [], failed: [] };
      byAgent.set(item.agentCode, lists);
    }
    lists[item.kind].push(item.requestId);
  }
  return agentCodes.flatMap((agentCode) => {
    const lists = byAgent.get(agentCode);
    return lists === undefined
      ? []
      : [
          {
            agentCode,
            running: countOf(lists.running),
            awaitingApproval: countOf(lists.awaiting_approval),
            failed: countOf(lists.failed),
          },
        ];
  });
}

/**
 * The live part of the office answer from the rows of the pick, which asks for one row more than
 * the limit: at most `limit` rows are counted, the ones that have not moved for longest (the order
 * of the pick), and a row beyond the limit only says that the numbers are not whole.
 */
export function officeLive(
  rows: readonly RequestRow[],
  agentCodes: readonly string[],
  now: Date,
  limit: number = OFFICE_REQUEST_LIMIT,
): { work: OfficeAgentWork[]; workTruncated: boolean } {
  return {
    work: officeWork(rows.slice(0, limit), agentCodes, now),
    workTruncated: rows.length > limit,
  };
}
