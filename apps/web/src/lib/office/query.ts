import {
  agentStopIfOpenResponseSchema,
  officeResponseSchema,
  type AgentStopIfOpenResponse,
  type CompanyAgentStatus,
  type OfficeResponse,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '../api.ts';
import { officeDialogOpen } from './hold.ts';

/**
 * GET /api/office: the units and agents of one company with their switches and the open requests
 * counted for the reader. The company id goes in the header and the API checks it against the
 * person's memberships. The page refreshes it every half minute with `fetchOffice` as a background
 * request (lib/refresh.ts), which does not extend the session's idle time (rule 3).
 */
export const officeKey = (companyId: string) => ['company', companyId, 'office'] as const;

export function fetchOffice(
  companyId: string,
  options: { signal?: AbortSignal; background?: boolean } = {},
): Promise<OfficeResponse> {
  return apiRequest('/office', { schema: officeResponseSchema, companyId, ...options });
}

export function officeQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: officeKey(companyId),
    queryFn: ({ signal }) => fetchOffice(companyId, { signal }),
    // Not under an open confirmation (lib/office/hold.ts).
    refetchOnWindowFocus: () => !officeDialogOpen(),
  });
}

/**
 * The switch of one agent in one company, read for the confirmation of "Her yerde durdur": the
 * person is told where the agent is open before anything is stopped. `absent`: the office of that
 * company has no such agent (its card does not name the company). Read from the office answer of
 * that company, which the person may read as its founder; never kept (a confirmation always reads
 * anew) and under a key of its own, so that reading the office again does not touch it.
 */
export function agentSwitchQueryOptions(companyId: string, agentCode: string) {
  return queryOptions({
    queryKey: ['company', companyId, 'agent-switch', agentCode] as const,
    queryFn: async ({ signal }): Promise<CompanyAgentStatus | 'absent'> => {
      const office = await fetchOffice(companyId, { signal });
      const agent = office.units
        .flatMap((unit) => unit.agents)
        .find((candidate) => candidate.code === agentCode);
      return agent === undefined ? 'absent' : (agent.status ?? 'disabled');
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Stops an agent in one company only if it is open there ("Her yerde durdur"; 8 October
 * decision 9). The answer is the agent as the company has it afterwards and whether this request
 * is what stopped it: `changed` is false for an agent that was already stopped or was not open.
 */
export function stopAgentIfOpen(
  companyId: string,
  agentCode: string,
): Promise<AgentStopIfOpenResponse> {
  return apiRequest(`/agents/${agentCode}/switch`, {
    method: 'PUT',
    body: { status: 'stopped', onlyIfOpen: true },
    schema: agentStopIfOpenResponseSchema,
    companyId,
  });
}
