import {
  agentOpenResponseSchema,
  approvalDeskSchema,
  officeAgentSchema,
  requestDetailSchema,
  requestIntakeSchema,
  requestListSchema,
  routingOptionsSchema,
  type AcceptanceDecision,
  type AgentOpenResponse,
  type AnswerQuestion,
  type ApprovalDecision,
  type ApprovalDesk,
  type CorrectRouting,
  type CreateRequest,
  type CreateRequestComment,
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
 * request text with its optional due day, a decision, a close, for the founder and the approver
 * of the request a correction of the routing, a comment, which changes nothing of the request,
 * and the answer to an agent's question.
 * The comments of a request have no query and no key of their own: they are part of its page.
 *
 * Each query has a twin that sends the same request as a background request, for the periodic
 * refresh (lib/refresh.ts): such a request does not extend the session's idle time (rule 3).
 */

/**
 * `projectId`: the requests of one project (its page); null: every request the person reads. Both
 * lie under ['company', companyId, 'requests'], which a change of any request invalidates.
 */
export const requestsKey = (companyId: string, mine: boolean, projectId: string | null = null) =>
  ['company', companyId, 'requests', { mine, project: projectId }] as const;
export const requestKey = (companyId: string, requestId: string) =>
  ['company', companyId, 'request', requestId] as const;
export const approvalDeskKey = (companyId: string) => ['company', companyId, 'approvals'] as const;

export function fetchRequests(
  companyId: string,
  mine: boolean,
  options: { signal?: AbortSignal; background?: boolean; projectId?: string } = {},
): Promise<RequestList> {
  const { projectId, ...rest } = options;
  // An id only, never a name or a text.
  const query = new URLSearchParams();
  if (mine) query.set('mine', 'true');
  if (projectId !== undefined) query.set('project', projectId);
  const search = query.toString();
  return apiRequest(`/requests${search === '' ? '' : `?${search}`}`, {
    schema: requestListSchema,
    companyId,
    ...rest,
  });
}

export function requestsQueryOptions(companyId: string, mine: boolean, projectId?: string) {
  return queryOptions({
    queryKey: requestsKey(companyId, mine, projectId ?? null),
    queryFn: ({ signal }) =>
      fetchRequests(companyId, mine, {
        signal,
        ...(projectId === undefined ? {} : { projectId }),
      }),
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
export function createRequest(companyId: string, request: CreateRequest): Promise<RequestDetail> {
  return apiRequest('/requests', {
    method: 'POST',
    body: request,
    schema: requestDetailSchema,
    companyId,
  });
}

/**
 * Adds a comment; the answer is the page of the request with the comment on it. The id is chosen
 * by the box, so a try that is repeated adds nothing twice.
 */
export function addRequestComment(
  companyId: string,
  requestId: string,
  comment: CreateRequestComment,
): Promise<RequestDetail> {
  return apiRequest(`/requests/${requestId}/comments`, {
    method: 'POST',
    body: comment,
    schema: requestDetailSchema,
    companyId,
  });
}

/**
 * The answer to an agent's question; the API's answer is the page of the request after it. The
 * question's id is the key of a retry: the same text again by the same person changes nothing.
 */
export function answerQuestion(
  companyId: string,
  requestId: string,
  questionId: string,
  answer: AnswerQuestion,
): Promise<RequestDetail> {
  return apiRequest(`/requests/${requestId}/questions/${questionId}/answer`, {
    method: 'POST',
    body: answer,
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

/**
 * The founder opens an agent for the company or stops it. An opening answers with the number of
 * waiting requests it started again (8 October decision 49); a stop starts nothing, and its
 * answer is given the same shape with 0.
 */
export function setAgentSwitch(
  companyId: string,
  agentCode: string,
  status: 'enabled' | 'stopped',
): Promise<AgentOpenResponse> {
  const request = { method: 'PUT', body: { status }, companyId } as const;
  if (status === 'enabled') {
    return apiRequest(`/agents/${agentCode}/switch`, {
      ...request,
      schema: agentOpenResponseSchema,
    });
  }
  return apiRequest(`/agents/${agentCode}/switch`, {
    ...request,
    schema: officeAgentSchema,
  }).then((agent) => ({ ...agent, restarted: 0 }));
}
