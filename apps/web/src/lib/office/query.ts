import {
  agentStopIfOpenResponseSchema,
  officeResponseSchema,
  waitingWorkQuerySchema,
  waitingWorkResponseSchema,
  type AgentStopIfOpenResponse,
  type CompanyAgentStatus,
  type OfficeResponse,
  type WaitingWorkQuery,
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
 * How many waiting requests an opening would start (8 October decision 49): of an agent, of a
 * project's AI permission or of a customer's. The database counts by the rule of the restart
 * itself; the panel never counts. Read anew for every confirmation and never kept: the number is
 * shown to the person who is about to start that many paid runs. The address carries an agent
 * code or an id only, never a name or a text.
 */
export function waitingWorkQueryOptions(companyId: string, scope: WaitingWorkQuery) {
  return queryOptions({
    queryKey: ['company', companyId, 'waiting-work', scope] as const,
    queryFn: ({ signal }): Promise<number> =>
      apiRequest(
        `/waiting-work?${new URLSearchParams(waitingWorkQuerySchema.parse(scope)).toString()}`,
        { schema: waitingWorkResponseSchema, companyId, signal },
      ).then((answer) => answer.waiting),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * What the confirmation of an opening says about the count: on its way, the number, or that it
 * could not be read (which does not block the opening; the sentence then says what may start).
 * "On its way" is every read, also the second one of a page that stayed open: the number of the
 * confirmation before is never shown as the number of this one. A confirm button waits on
 * `isFetching` for the same reason.
 */
export function waitingState(count: {
  isFetching: boolean;
  isError: boolean;
  data: number | undefined;
}): number | 'counting' | 'unknown' {
  if (count.isFetching) return 'counting';
  return count.isError || count.data === undefined ? 'unknown' : count.data;
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
