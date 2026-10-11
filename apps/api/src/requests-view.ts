import type {
  AcceptanceRow,
  RequestCommentRow,
  RequestRow,
  ResultApprovalRow,
  RoutingRow,
  RunRow,
  StepRow,
} from '@agent-office/db';
import {
  COORDINATOR_AGENT_CODE,
  REQUEST_COMMENT_LIMIT,
  deriveStage,
  isClosedTaskStatus,
  officeDay,
  rejectionReasonSchema,
  resultPayloadSchema,
  runStatusSchema,
  taskStatusSchema,
  type ApprovalCard,
  type DerivedStage,
  type JourneyItem,
  type RequestComment,
  type RequestDetail,
  type RequestFacts,
  type RequestResult,
  type RequestSummary,
  type RequestTurn,
  type ResultOption,
  type Role,
  type TaskPerson,
} from '@agent-office/shared';

/**
 * Builds the answers of flow (A) from the rows the person could read. Pure functions: no query is
 * made here, so everything in an answer is something a row policy already let this person see.
 */

export interface Reader {
  userId: string;
  role: Role;
}

export type Names = ReadonlyMap<string, string>;

export function person(names: Names, userId: string): TaskPerson {
  return { userId, name: names.get(userId) ?? null };
}

function optionalPerson(names: Names, userId: string | null): TaskPerson | null {
  return userId === null ? null : person(names, userId);
}

export function factsOf(row: RequestRow): RequestFacts {
  const lastResult = rejectionOrApproval(row.last_result_status);
  return {
    status: taskStatusSchema.parse(row.status),
    createdAt: row.created_at,
    closedBy:
      row.closed_by_user_id === null
        ? null
        : row.closed_by_user_id === row.requester_user_id
          ? 'requester'
          : 'other',
    closedAfterDelivery: row.closed_after_delivery,
    returnedNoAgent: row.returned_no_agent,
    coordinatorEnabled: row.coordinator_enabled,
    agentsMayWork: row.agents_may_work,
    requesterReads: row.requester_reads,
    routed: row.routed,
    step:
      row.step_agent_code !== null
        ? { agentCode: row.step_agent_code, agentEnabled: row.step_agent_enabled === true }
        : null,
    pendingApproval: row.pending_result,
    pendingAcceptance: row.pending_acceptance,
    lastResult:
      lastResult !== null && row.last_result_attempt !== null
        ? { status: lastResult, attempt: row.last_result_attempt }
        : null,
    changesRequested: row.last_change_request_at !== null,
    // A restart after an agent or an AI permission was opened again calls for the work anew
    // (8 October decision 49).
    awaitedSince: latest(latest(row.step_created_at, row.last_change_request_at), row.restarted_at),
    notStartedAt: row.not_started_at,
    lastRun:
      row.run_agent_code !== null && row.run_status !== null && row.run_started_at !== null
        ? {
            agentCode: row.run_agent_code,
            status: runStatusSchema.parse(row.run_status),
            errorCode: row.run_error_code,
            startedAt: row.run_started_at,
            limitMinutes: row.run_limit_minutes,
          }
        : null,
  };
}

function rejectionOrApproval(
  status: string | null,
): 'approved' | 'changes_requested' | 'rejected' | null {
  return status === 'approved' || status === 'changes_requested' || status === 'rejected'
    ? status
    : null;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/** Whose turn it is, as a person or an agent, and whether that is the reader. */
export function turnOf(
  row: RequestRow,
  derived: DerivedStage,
  reader: Reader,
  names: Names,
): { turn: RequestTurn; waitingForMe: boolean } {
  switch (derived.turn) {
    case 'none':
      return { turn: { kind: 'none' }, waitingForMe: false };
    case 'coordinator':
      return {
        turn: {
          kind: 'agent',
          code: COORDINATOR_AGENT_CODE,
          name: row.coordinator_name ?? COORDINATOR_AGENT_CODE,
        },
        waitingForMe: false,
      };
    case 'agent':
      return row.step_agent_code === null
        ? { turn: { kind: 'none' }, waitingForMe: false }
        : {
            turn: {
              kind: 'agent',
              code: row.step_agent_code,
              name: row.step_agent_name ?? row.step_agent_code,
            },
            waitingForMe: false,
          };
    case 'requester':
      return {
        turn: { kind: 'person', ...person(names, row.requester_user_id) },
        waitingForMe: row.requester_user_id === reader.userId,
      };
    case 'founder':
      return { turn: { kind: 'founder' }, waitingForMe: reader.role === 'founder' };
    case 'approver': {
      const approver = row.step_approver_user_id;
      if (approver !== null) {
        return {
          turn: { kind: 'person', ...person(names, approver) },
          // The founder may always decide and correct, but the work waits for the appointed person.
          waitingForMe: approver === reader.userId,
        };
      }
      // Nobody is appointed: the founder decides, and nobody else (7 October decision 5).
      return { turn: { kind: 'founder' }, waitingForMe: reader.role === 'founder' };
    }
  }
}

/** The ids of the people a request row names. */
export function peopleOf(row: RequestRow): string[] {
  return [
    row.requester_user_id,
    row.step_approver_user_id,
    row.closed_by_user_id,
    row.rejected_by_user_id,
  ].filter((id): id is string => id !== null);
}

/**
 * How a cancelled request was closed, in the words of the person who closed it: the requester's
 * cancel, a stop with its reason, or the rejection of the result with the approver's reason class
 * and note. Null while the request is not cancelled, and for a request the routing returned to
 * its requester: no person closed that one, and the cause and the unit say why (the coordinator's
 * own reason is not the requester's to read). Nothing here is an agent's text.
 */
export function closureOf(row: RequestRow, names: Names): RequestDetail['closure'] {
  if (row.status !== 'cancelled') {
    return null;
  }
  if (row.closed_by_user_id !== null) {
    return { by: person(names, row.closed_by_user_id), reason: null, note: row.close_reason };
  }
  if (row.returned_no_agent) {
    return null;
  }
  return {
    by: optionalPerson(names, row.rejected_by_user_id),
    reason: rejectionReasonSchema.nullable().catch(null).parse(row.rejected_reason),
    note: row.rejected_note,
  };
}

export function toSummary(
  row: RequestRow,
  reader: Reader,
  names: Names,
  now: Date,
): RequestSummary {
  const derived = deriveStage(factsOf(row), now);
  const status = taskStatusSchema.parse(row.status);
  return {
    id: row.id,
    title: row.title,
    status,
    stage: derived.stage,
    cause: derived.cause,
    delayed: derived.delayed,
    ...turnOf(row, derived, reader, names),
    unit:
      row.unit_code !== null && row.unit_name !== null
        ? { code: row.unit_code, name: row.unit_name }
        : null,
    requester: person(names, row.requester_user_id),
    project: projectOf(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    dueDate: row.due_date,
    // Read on the same clock as the stage. A closed request is never overdue: nothing is expected
    // of anybody any more.
    overdue: row.due_date !== null && !isClosedTaskStatus(status) && row.due_date < officeDay(now),
  };
}

/** The project a request is inside, as the row names it; null for a request without one. */
function projectOf(row: {
  project_id: string | null;
  project_name: string | null;
}): RequestSummary['project'] {
  return row.project_id !== null && row.project_name !== null
    ? { id: row.project_id, name: row.project_name }
    : null;
}

/**
 * The options of a result, read again from what the agent stored. A payload that does not have the
 * expected shape gives no option: the card then shows the agent's summary and cannot be approved
 * with a choice, which is the truth about such a record.
 */
export function optionsOf(payload: unknown): ResultOption[] {
  const parsed = resultPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.options : [];
}

export function toApprovalCard(row: ResultApprovalRow, names: Names): ApprovalCard {
  const payload = resultPayloadSchema.safeParse(row.payload);
  return {
    id: row.id,
    requestId: row.task_id,
    requestTitle: row.request_title,
    requester: person(names, row.requester_user_id),
    project: projectOf(row),
    agent: { code: row.agent_code, name: row.agent_name },
    attempt: row.attempt,
    createdAt: row.created_at.toISOString(),
    title: row.title,
    summary: row.summary,
    rationale: row.agent_rationale,
    riskNote: row.risk_note,
    options: optionsOf(row.payload),
    involvesMoney: row.involves_money,
    // An approval written before the source was recorded says nothing about it.
    moneyStatedBy:
      row.involves_money && payload.success ? (payload.data.money_stated_by ?? null) : null,
    goesExternal: row.goes_external,
    needsStepUp: row.needs_step_up,
    agentsMayWork: row.agents_may_work,
  };
}

export function toResult(row: ResultApprovalRow, names: Names): RequestResult {
  const options = optionsOf(row.payload);
  return {
    approvalId: row.id,
    agent: { code: row.agent_code, name: row.agent_name },
    title: row.title,
    option: options.find((option) => option.code === row.selected_option) ?? options[0] ?? null,
    approvedBy: optionalPerson(names, row.decided_by_user_id),
    approvedAt: (row.decided_at ?? row.created_at).toISOString(),
  };
}

export interface JourneyRows {
  routings: RoutingRow[];
  runs: RunRow[];
  steps: StepRow[];
  approvals: ResultApprovalRow[];
  acceptances: AcceptanceRow[];
}

/** The ids of the people the journey names. */
export function peopleOfJourney(rows: JourneyRows): string[] {
  return [
    ...rows.routings.flatMap((row) => [row.approver_user_id, row.routed_by_user_id]),
    ...rows.approvals.flatMap((row) => [row.decided_by_user_id, row.requester_user_id]),
    // Who answered in the requester's place (8 October decision 45).
    ...rows.acceptances.map((row) => row.decided_by_user_id),
  ].filter((id): id is string => id !== null);
}

/**
 * The journey in the order things happened. A routing made by the coordinator carries the
 * coordinator's reason and a run that ended without its tool carries the agent's closing words,
 * both only when the statement gave them: to a reader who may decide the work. The coordinator's
 * run is listed too, like every other run, with its steps by name.
 */
export function toJourney(rows: JourneyRows, names: Names): JourneyItem[] {
  const items: JourneyItem[] = [];
  for (const row of rows.runs) {
    items.push({
      kind: 'run',
      id: row.id,
      at: row.started_at.toISOString(),
      agent: { code: row.agent_code, name: row.agent_name },
      status: runStatusSchema.parse(row.status),
      finishedAt: row.finished_at?.toISOString() ?? null,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      errorCode: row.error_code,
      summary: row.summary,
      agentText: row.agent_text,
      steps: rows.steps
        .filter((step) => step.run_id === row.id)
        .map((step) => ({
          tool: step.tool_name,
          status: stepStatus(step.status),
        })),
    });
  }
  for (const row of rows.routings) {
    items.push({
      kind: 'routing',
      id: row.id,
      at: row.created_at.toISOString(),
      round: row.round,
      unit: { code: row.unit_code, name: row.unit_name },
      agent:
        row.agent_code !== null
          ? { code: row.agent_code, name: row.agent_name ?? row.agent_code }
          : null,
      approver: optionalPerson(names, row.approver_user_id),
      by: optionalPerson(names, row.routed_by_user_id),
      reason: row.reason,
    });
  }
  for (const row of rows.approvals) {
    const closed = row.status === 'pending' && row.invalidated_at !== null;
    items.push({
      kind: 'approval',
      id: row.id,
      at: (row.decided_at ?? row.invalidated_at ?? row.created_at).toISOString(),
      status: closed ? 'closed' : approvalStatus(row.status),
      attempt: row.attempt,
      agent: { code: row.agent_code, name: row.agent_name },
      decidedBy: optionalPerson(names, row.decided_by_user_id),
      reason: rejectionReasonSchema.nullable().catch(null).parse(row.rejection_reason),
      note: row.decision_reason,
    });
  }
  for (const row of rows.acceptances) {
    const closed = row.status === 'pending' && row.invalidated_at !== null;
    items.push({
      kind: 'acceptance',
      id: row.id,
      at: (row.decided_at ?? row.invalidated_at ?? row.created_at).toISOString(),
      round: row.round,
      status: closed ? 'closed' : acceptanceStatus(row.status),
      // Named only when it was not the requester: the founder, in the requester's place.
      decidedBy:
        row.decided_by_user_id !== null && row.decided_by_user_id !== row.requester_user_id
          ? person(names, row.decided_by_user_id)
          : null,
      reason: rejectionReasonSchema.nullable().catch(null).parse(row.rejection_reason),
      note: row.decision_reason,
    });
  }
  // Stable: items of the same instant keep the order above (run, routing, approval, acceptance):
  // a routing written in the instant a run started is that run's own decision.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at.localeCompare(b.item.at) || a.index - b.index)
    .map(({ item }) => item);
}

function stepStatus(
  status: string,
): 'started' | 'succeeded' | 'failed' | 'sent_for_approval' | 'blocked' {
  switch (status) {
    case 'succeeded':
    case 'failed':
    case 'sent_for_approval':
    case 'blocked':
      return status;
    default:
      return 'started';
  }
}

function approvalStatus(status: string): 'pending' | 'approved' | 'changes_requested' | 'rejected' {
  switch (status) {
    case 'approved':
    case 'changes_requested':
    case 'rejected':
      return status;
    default:
      return 'pending';
  }
}

function acceptanceStatus(status: string): 'pending' | 'approved' | 'changes_requested' {
  return status === 'approved' || status === 'changes_requested' ? status : 'pending';
}

/**
 * The comments as the page shows them: the statement gave the newest first and one more than the
 * limit; the page gets the newest REQUEST_COMMENT_LIMIT, oldest first.
 */
export function toComments(
  rows: RequestCommentRow[],
  names: Names,
  mayWrite: boolean,
): RequestDetail['comments'] {
  const items: RequestComment[] = rows
    .slice(0, REQUEST_COMMENT_LIMIT)
    .reverse()
    .map((row) => ({
      id: row.id,
      author: person(names, row.author_user_id),
      body: row.body,
      createdAt: row.created_at.toISOString(),
    }));
  return { items, truncated: rows.length > REQUEST_COMMENT_LIMIT, mayWrite };
}
