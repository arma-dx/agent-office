import {
  approvalDeskSchema,
  officeAgentSchema,
  requestDetailSchema,
  requestIntakeSchema,
  requestListSchema,
  routingOptionsSchema,
  type AcceptanceDecision,
  type ApprovalDecision,
  type ApprovalDesk,
  type CorrectRouting,
  type OfficeAgent,
  type RequestDetail,
  type RequestIntake,
  type RequestList,
  type RoutingOptions,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '../api.ts';
import { decisionDialogOpen } from './hold.ts';

/**
 * Flow (A), "Talepler": the requests agents carry out. Every answer is validated with the shared
 * contract. Nothing here sets a status or an approver; the only things the panel sends are a
 * request text, a decision, a close and, for the founder and the approver of the request, a
 * correction of the routing.
 *
 * Each query has a twin that sends the same request as a background request, for the periodic
 * refresh (lib/refresh.ts): such a request does not extend the session's idle time (rule 3).
 */

export const requestsKey = (companyId: string, mine: boolean) =>
  ['company', companyId, 'requests', { mine }] as const;
export const requestKey = (companyId: string, requestId: string) =>
  ['company', companyId, 'request', requestId] as const;
export const approvalDeskKey = (companyId: string) => ['company', companyId, 'approvals'] as const;

export function fetchRequests(
  companyId: string,
  mine: boolean,
  options: { signal?: AbortSignal; background?: boolean } = {},
): Promise<RequestList> {
  return apiRequest(`/requests${mine ? '?mine=true' : ''}`, {
    schema: requestListSchema,
    companyId,
    ...options,
  });
}

export function requestsQueryOptions(companyId: string, mine: boolean) {
  return queryOptions({
    queryKey: requestsKey(companyId, mine),
    queryFn: ({ signal }) => fetchRequests(companyId, mine, { signal }),
  });
}

export function fetchRequest(
  companyId: string,
  requestId: string,
  options: { signal?: AbortSignal; background?: boolean } = {},
): Promise<RequestDetail> {
  return apiRequest(`/requests/${requestId}`, {
    schema: requestDetailSchema,
    companyId,
    ...options,
  });
}

export function requestQueryOptions(companyId: string, requestId: string) {
  return queryOptions({
    queryKey: requestKey(companyId, requestId),
    queryFn: ({ signal }) => fetchRequest(companyId, requestId, { signal }),
    // A hidden and a missing request are one answer; asking again changes nothing.
    retry: false,
    // Not under an open decision dialog (lib/requests/hold.ts).
    refetchOnWindowFocus: () => !decisionDialogOpen(),
  });
}

export function fetchApprovalDesk(
  companyId: string,
  options: { signal?: AbortSignal; background?: boolean } = {},
): Promise<ApprovalDesk> {
  return apiRequest('/approvals', { schema: approvalDeskSchema, companyId, ...options });
}

export function approvalDeskQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: approvalDeskKey(companyId),
    queryFn: ({ signal }) => fetchApprovalDesk(companyId, { signal }),
    // Not under an open decision dialog (lib/requests/hold.ts).
    refetchOnWindowFocus: () => !decisionDialogOpen(),
  });
}

export const requestIntakeKey = (companyId: string) =>
  ['company', companyId, 'request-intake'] as const;

/** Can this person send a request here now; asked when the form opens. */
export function requestIntakeQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: requestIntakeKey(companyId),
    queryFn: ({ signal }): Promise<RequestIntake> =>
      apiRequest('/requests/intake', { schema: requestIntakeSchema, companyId, signal }),
    // The answer changes when the founder opens or stops the coordinator: never kept.
    staleTime: 0,
    gcTime: 0,
  });
}

/** Where a request can be routed to now; asked when the correction dialog opens. */
export function routingOptionsQueryOptions(companyId: string, requestId: string) {
  return queryOptions({
    queryKey: ['company', companyId, 'request', requestId, 'routing-options'] as const,
    queryFn: ({ signal }): Promise<RoutingOptions> =>
      apiRequest(`/requests/${requestId}/routing-options`, {
        schema: routingOptionsSchema,
        companyId,
        signal,
      }),
    staleTime: 0,
    gcTime: 0,
  });
}

/** The id is chosen here, so a send that is repeated answers the first record. */
export function createRequest(
  companyId: string,
  request: { id: string; text: string },
): Promise<RequestDetail> {
  return apiRequest('/requests', {
    method: 'POST',
    body: request,
    schema: requestDetailSchema,
    companyId,
  });
}

/**
 * The requester cancels; the approver of the request or the founder stops and says why (the
 * requester reads the reason). The API decides which it is.
 */
export function closeRequest(
  companyId: string,
  requestId: string,
  reason: string,
): Promise<RequestDetail> {
  return apiRequest(`/requests/${requestId}/close`, {
    method: 'POST',
    body: reason === '' ? {} : { reason },
    schema: requestDetailSchema,
    companyId,
  });
}

/** The founder or the approver of the request gives it to another unit or agent, or again. */
export function correctRouting(
  companyId: string,
  requestId: string,
  routing: CorrectRouting,
): Promise<RequestDetail> {
  return apiRequest(`/requests/${requestId}/routing`, {
    method: 'POST',
    body: routing,
    schema: requestDetailSchema,
    companyId,
  });
}

export function decideApproval(
  companyId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<RequestDetail> {
  return apiRequest(`/approvals/${approvalId}/decision`, {
    method: 'POST',
    body: decision,
    schema: requestDetailSchema,
    companyId,
  });
}

export function decideAcceptance(
  companyId: string,
  requestId: string,
  decision: AcceptanceDecision,
): Promise<RequestDetail> {
  return apiRequest(`/requests/${requestId}/acceptance`, {
    method: 'POST',
    body: decision,
    schema: requestDetailSchema,
    companyId,
  });
}

/** The founder opens an agent for the company or stops it. */
export function setAgentSwitch(
  companyId: string,
  agentCode: string,
  status: 'enabled' | 'stopped',
): Promise<OfficeAgent> {
  return apiRequest(`/agents/${agentCode}/switch`, {
    method: 'PUT',
    body: { status },
    schema: officeAgentSchema,
    companyId,
  });
}
