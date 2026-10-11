import { z } from 'zod';
import { agentCodeSchema, unitCodeSchema } from './cards.ts';
import { stepUpSchema } from './api.ts';
import { taskPersonSchema, taskStatusSchema, type TaskStatus } from './tasks.ts';

/**
 * Flow (A), "talep": a request that agents carry out (7 October decisions 1 to 8). A person writes
 * what they want and chooses neither a unit nor an agent; the coordinator routes it, the unit's
 * agent works, the unit's approver decides, the requester accepts. Nobody sets a status by hand.
 *
 * The API validates every body with these schemas and builds every answer with them; the panel
 * validates every answer. There is no field here that sets a status or an approver: the only
 * things a person sends are the request text, a decision, a close and, for the founder and the
 * approver of the request, a correction of the routing (7 October decision 7). A comment (8 October
 * decision 13) is the one more thing a person sends; it changes nothing of the request.
 */

/** The agent every new request goes to first (its card: "Panelden gelen her talebi karşılar"). */
export const COORDINATOR_AGENT_CODE = 'KOR-1';

// The request text ---------------------------------------------------------------------------------

export const REQUEST_TEXT_MAX = 20_000;
export const REQUEST_TITLE_MAX = 80;

// PostgreSQL text cannot hold the NUL character; a text with one is refused here (400), not there.
const withoutNul = (text: string): boolean => !text.includes('\u0000');
const NO_NUL = { message: 'Must not contain the NUL character' };

export const requestTextSchema = z
  .string()
  .max(REQUEST_TEXT_MAX)
  .refine((text) => text.trim().length > 0, { message: 'Must not be empty' })
  .refine(withoutNul, NO_NUL);

/**
 * The title of a request is not asked for: it is the first line of the text that says something
 * (has a letter or a digit), cut at a word to REQUEST_TITLE_MAX characters. A separator line, as
 * mail programs and documents put on top of a text (dashes, dots), is passed over; a text made of
 * such lines alone keeps its first line. Never empty for a text the request schema accepts: the
 * table refuses an empty title. Made by code, never by a model: a title is shown in lists and in
 * the top bar, and agent text reaches people only as a run summary, an approval's reasoning or a
 * question.
 */
export function deriveRequestTitle(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
  const line = lines.find((part) => /[\p{L}\p{N}]/u.test(part)) ?? lines[0] ?? '';
  if (line.length <= REQUEST_TITLE_MAX) {
    return line;
  }
  const cut = line.slice(0, REQUEST_TITLE_MAX + 1);
  const space = cut.lastIndexOf(' ');
  // A first word longer than the limit is cut inside the word; nothing else can be done with it.
  const kept = (
    space > REQUEST_TITLE_MAX / 2 ? cut.slice(0, space) : cut.slice(0, REQUEST_TITLE_MAX)
  ).trim();
  const title = kept.replace(/[\s,;:.-]+$/u, '').trim();
  // Nothing but punctuation was cut: it stays as it is, a title is never empty.
  return title.length > 0 ? title : kept;
}

/** A due day: a real calendar day without a time, YYYY-MM-DD, read in the office's time zone. */
export const requestDueDateSchema = z.iso.date();

/**
 * POST /api/requests. The id is chosen by the panel, so a send that is repeated (a double click, a
 * retry after a lost answer) answers the first record and opens no second request.
 * `dueDate` is optional and is information only (docs/SONRA.md W-h): it moves no status, starts
 * no reminder and cannot be changed after the request is sent. A day that has already ended is
 * refused by the API (409 due_date_past); today is accepted.
 * `projectId` is optional: the request is opened inside that project and is then read by the
 * project's members and the founder only (CLAUDE.md "Şirketler, projeler ve görünürlük"). It never
 * changes afterwards (docs/SONRA.md P-m). The API answers 409 project_not_available,
 * project_closed or project_ai_not_allowed when the project takes no request.
 */
export const createRequestSchema = z.strictObject({
  id: z.uuid(),
  text: requestTextSchema,
  dueDate: requestDueDateSchema.optional(),
  projectId: z.uuid().optional(),
});
export type CreateRequest = z.input<typeof createRequestSchema>;

// Stage and turn -----------------------------------------------------------------------------------

/**
 * Where a request is. Derived on the server from the records of the flow (routing, runs,
 * approvals, the requester's approval); never stored and never set by anybody. The six statuses of
 * a task stay the status language; the stage says what the status cannot: "Onay bekliyor" is true
 * both while the unit's approver decides and while the requester accepts.
 */
export const requestStageSchema = z.enum([
  // The coordinator is choosing the unit and the agent (or is about to).
  'routing',
  // The unit's agent is working (or is about to).
  'working',
  // The same, after a change request of the approver or the requester.
  'revising',
  'unit_approval',
  'requester_approval',
  // Nothing runs and nothing waits for a decision: a person must look at it.
  'fell_to_person',
  'done',
  'cancelled',
]);
export type RequestStage = z.output<typeof requestStageSchema>;

/** Why a request fell to a person, or how it was closed. A code; the sentence is the panel's. */
export const requestCauseSchema = z.enum([
  // fell_to_person
  'coordinator_closed',
  'no_routing',
  'agent_stopped',
  // A run was called for and never started although the agent is open: the runner refused the
  // job before a run existed, and no restart made that missed start good since (work that only
  // waited for a stopped agent or a closed AI permission starts again when that is opened,
  // 8 October decision 49). A person routes the request again.
  'not_started',
  'no_submission',
  'run_failed',
  // The run was stopped because the request changed under it (a result the database refused, a
  // routing that moved), and nothing else took the work over.
  'run_interrupted',
  'limit_reached',
  'model_refused',
  'model_unavailable',
  // The provider's account cannot pay for the call, or does not offer the card's model.
  'model_billing',
  'model_not_available',
  'card_not_runnable',
  'second_change_request',
  // The request is inside a project where agents may not work now (rule 12): the project's AI
  // permission, or its customer's, is closed. Nothing runs until the founder opens it; then the
  // waiting work starts again by itself (8 October decision 49).
  'ai_permission_closed',
  // The permission is open again, and the run the close stopped was not started again: its agent
  // was stopped at that moment (opening the agent starts it), or the permission was opened
  // outside the panel.
  'ai_permission_interrupted',
  // cancelled
  // Returned to its requester by the routing: the coordinator named the unit, and no open agent
  // of it could take the work (8 October decision 2).
  'returned_no_agent',
  'cancelled_by_requester',
  'stopped',
  // Stopped while the approved result waited for its requester: the result was delivered.
  'closed_after_delivery',
  'rejected',
]);
export type RequestCause = z.output<typeof requestCauseSchema>;

export const runStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'limit_reached',
  'stopped',
]);
export type RunStatus = z.output<typeof runStatusSchema>;

/** Whose turn it is, before it is resolved to a person or an agent. */
export type TurnRole = 'coordinator' | 'agent' | 'approver' | 'requester' | 'founder' | 'none';

/** What the server reads about a request to say where it is. */
export interface RequestFacts {
  status: TaskStatus;
  createdAt: Date;
  // Who closed a cancelled request by hand: its requester, somebody else, or nobody (a rejection,
  // or a return by the routing).
  closedBy: 'requester' | 'other' | null;
  // It was closed while its approved result waited for the requester's answer.
  closedAfterDelivery: boolean;
  // The coordinator named a unit where no open agent could take the work: the request was returned
  // to its requester and closed (read from the returned step of its last routing).
  returnedNoAgent: boolean;
  // The coordinator can take a request in this company: its switch is on and its card has a
  // version to run with.
  coordinatorEnabled: boolean;
  // May agents work on this request now (rule 12): false only for a request inside a project
  // whose AI permission, or whose customer's, is closed.
  agentsMayWork: boolean;
  // May the requester still read the request (8 October decision 45). False: runs go in the
  // founder's name and the founder gives the requester's approval in their place.
  requesterReads: boolean;
  // Was the request ever routed.
  routed: boolean;
  // The step that is active now; it always has an agent (a step without one is a returned step).
  step: { agentCode: string; agentEnabled: boolean } | null;
  // A result waits for the unit's approver.
  pendingApproval: boolean;
  // The approved result waits for the requester.
  pendingAcceptance: boolean;
  // The last decision on a result of the active step.
  lastResult: { status: 'approved' | 'changes_requested' | 'rejected'; attempt: number } | null;
  // Did the approver or the requester ask for changes on the active step.
  changesRequested: boolean;
  // The latest moment a run was called for: the routing of the active step, the last change
  // request, or a restart after an agent or an AI permission was opened again (8 October
  // decision 49). Null when the only call is the opening of the request itself.
  awaitedSince: Date | null;
  // The latest time a run was called for and not started, for the agent whose turn it is: the
  // trace of a change request that found the agent stopped, or of a job refused at the runner's
  // gate. Null when there is none.
  notStartedAt: Date | null;
  // The latest run on the request, whoever ran it.
  lastRun: {
    agentCode: string;
    status: RunStatus;
    errorCode: string | null;
    startedAt: Date;
    // The run's own time limit, as it was stored with the run when it opened (the limit of the
    // card version it runs with). Null when the run carries none.
    limitMinutes: number | null;
  } | null;
}

export interface DerivedStage {
  stage: RequestStage;
  cause: RequestCause | null;
  turn: TurnRole;
  // The step in hand takes longer than it should: nothing picked the job up, or a run is still
  // open long after its time limit. The stage is not changed by a guess; the panel says "gecikti".
  delayed: boolean;
}

// A queued run should start within this time.
export const QUEUE_GRACE_MS = 2 * 60 * 1000;
// CLAUDE.md: without a limit on the card a run may take 10 minutes. Used for a run that carries
// no limit of its own.
const DEFAULT_RUN_MINUTES = 10;

/**
 * How long a run may stay open before the panel says "gecikti": the run's own time limit plus the
 * same margin. No fixed number fits every card (a card may allow from one to sixty minutes): a
 * constant above the default would call a healthy run of a thirty minute card late and leave a
 * lost run of a two minute card unnoticed for ten. The runner ends a run at its limit, so a run
 * that is still open after this time is not being worked on.
 */
export function runGraceMs(limitMinutes: number | null): number {
  return (limitMinutes ?? DEFAULT_RUN_MINUTES) * 60 * 1000 + QUEUE_GRACE_MS;
}

function causeOfRun(run: NonNullable<RequestFacts['lastRun']>, coordinator: boolean): RequestCause {
  if (run.status === 'limit_reached') return 'limit_reached';
  if (run.status === 'stopped') {
    // The stop switch stops an agent; a closed AI permission stops every run of its projects;
    // every other stop is the request changing under the run.
    if (run.errorCode === 'agent_stopped') return 'agent_stopped';
    if (run.errorCode === 'ai_permission_closed') return 'ai_permission_interrupted';
    return 'run_interrupted';
  }
  if (run.status === 'completed') return coordinator ? 'no_routing' : 'no_submission';
  switch (run.errorCode) {
    case 'model_refusal':
      return 'model_refused';
    case 'model_unavailable':
    case 'anthropic_auth_failed':
      return 'model_unavailable';
    case 'anthropic_billing':
      return 'model_billing';
    case 'anthropic_model_not_found':
      return 'model_not_available';
    case 'card_not_runnable':
      return 'card_not_runnable';
    default:
      return 'run_failed';
  }
}

/** The one place that says where a request is and whose turn it is. Pure: tested without a database. */
export function deriveStage(facts: RequestFacts, now: Date): DerivedStage {
  const at = (
    stage: RequestStage,
    turn: TurnRole,
    extra: Partial<DerivedStage> = {},
  ): DerivedStage => ({
    stage,
    cause: null,
    turn,
    delayed: false,
    ...extra,
  });
  const since = (moment: Date): number => now.getTime() - moment.getTime();

  if (facts.status === 'done') {
    return at('done', 'none');
  }
  if (facts.status === 'cancelled') {
    const cause: RequestCause =
      facts.closedBy === 'requester'
        ? 'cancelled_by_requester'
        : facts.closedBy === 'other'
          ? facts.closedAfterDelivery
            ? 'closed_after_delivery'
            : 'stopped'
          : facts.returnedNoAgent
            ? 'returned_no_agent'
            : 'rejected';
    return at('cancelled', 'none', { cause });
  }
  if (facts.pendingAcceptance) {
    // Decision 45: a requester who cannot read the request cannot answer; the founder does.
    return at('requester_approval', facts.requesterReads ? 'requester' : 'founder');
  }
  if (facts.pendingApproval) {
    return at('unit_approval', 'approver');
  }
  if (!facts.agentsMayWork) {
    // Rule 12: nothing runs in this project now, whatever the records say was called for. A
    // result that waits for a decision keeps its stage (above): it can still be rejected. Only
    // the founder can open the permission, so the turn is the founder's.
    return at('fell_to_person', 'founder', { cause: 'ai_permission_closed' });
  }

  const run = facts.lastRun;
  if (!facts.routed) {
    // The moment the coordinator's work was last called for: the opening of the request, or a
    // restart after the coordinator or an AI permission was opened again (decision 49).
    const called = facts.awaitedSince ?? facts.createdAt;
    if (run?.status === 'running') {
      return at('routing', 'coordinator', {
        delayed: since(run.startedAt) > runGraceMs(run.limitMinutes),
      });
    }
    if (run && run.startedAt >= called) {
      // The run that was called for has ended without a routing.
      return at('fell_to_person', 'founder', { cause: causeOfRun(run, true) });
    }
    if (!facts.coordinatorEnabled) {
      return at('fell_to_person', 'founder', { cause: 'coordinator_closed' });
    }
    if (facts.notStartedAt !== null && facts.notStartedAt >= called) {
      // The coordinator's job was refused before a run existed, and nothing has called for the
      // work again since: a person makes the first routing.
      return at('fell_to_person', 'founder', { cause: 'not_started' });
    }
    return at('routing', 'coordinator', { delayed: since(called) > QUEUE_GRACE_MS });
  }

  const step = facts.step;
  if (!step) {
    // The requester asked for changes twice: no step is active and nothing starts by itself.
    return at('fell_to_person', 'approver', { cause: 'second_change_request' });
  }
  const working: RequestStage = facts.changesRequested ? 'revising' : 'working';
  if (run?.status === 'running' && run.agentCode === step.agentCode) {
    return at(working, 'agent', { delayed: since(run.startedAt) > runGraceMs(run.limitMinutes) });
  }
  if (facts.lastResult?.status === 'changes_requested' && facts.lastResult.attempt >= 2) {
    // 2 October decision 10: after the second change request the work falls to a person.
    return at('fell_to_person', 'approver', { cause: 'second_change_request' });
  }
  const awaitedSince = facts.awaitedSince ?? facts.createdAt;
  if (run && run.agentCode === step.agentCode && run.startedAt >= awaitedSince) {
    // The run that was called for has ended and left neither a result nor a question.
    return at('fell_to_person', 'approver', { cause: causeOfRun(run, false) });
  }
  if (!step.agentEnabled) {
    return at('fell_to_person', 'approver', { cause: 'agent_stopped' });
  }
  if (facts.notStartedAt !== null && facts.notStartedAt >= awaitedSince) {
    // The run that was called for was never started and nothing is on the queue for it. The
    // agent is open, and the start that was missed was not made good by a restart: the job was
    // refused for another reason, or after the restart.
    return at('fell_to_person', 'approver', { cause: 'not_started' });
  }
  return at(working, 'agent', { delayed: since(awaitedSince) > QUEUE_GRACE_MS });
}

// Answers ------------------------------------------------------------------------------------------

const instantSchema = z.iso.datetime({ offset: true });
const unitRefSchema = z.object({ code: unitCodeSchema, name: z.string() });
const agentRefSchema = z.object({ code: agentCodeSchema, name: z.string() });

/**
 * Who must act now. `founder` is used when nobody is appointed for the unit: the founder decides
 * (7 October decision 5), and the panel says "Kurucu" without naming a person.
 */
export const requestTurnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), userId: z.uuid(), name: z.string().nullable() }),
  z.object({ kind: z.literal('founder') }),
  z.object({ kind: z.literal('agent'), code: agentCodeSchema, name: z.string() }),
  z.object({ kind: z.literal('none') }),
]);
export type RequestTurn = z.output<typeof requestTurnSchema>;

/** The project a request is inside; its members and the founder are the only readers of both. */
const projectRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const requestSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: taskStatusSchema,
  stage: requestStageSchema,
  cause: requestCauseSchema.nullable(),
  delayed: z.boolean(),
  turn: requestTurnSchema,
  // The reader is the one who must act.
  waitingForMe: z.boolean(),
  unit: unitRefSchema.nullable(),
  requester: taskPersonSchema,
  // Null: the request is inside no project and every founder and employee of the company reads it.
  project: projectRefSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  // The day the requester gave when the request was opened; null when none. Never changes.
  dueDate: requestDueDateSchema.nullable(),
  // The due day has ended (office time) and the request is still open. Never true for a closed
  // request. Not `delayed`: that is a run that takes too long ("gecikti"); this is "son tarihi
  // geçti".
  overdue: z.boolean(),
});
export type RequestSummary = z.output<typeof requestSummarySchema>;

export const REQUEST_LIST_LIMIT = 200;
export const requestListSchema = z.object({
  requests: z.array(requestSummarySchema),
  // More requests exist than the list holds (no paging in the first slice).
  truncated: z.boolean(),
});
export type RequestList = z.output<typeof requestListSchema>;

/** The fixed reasons of a rejection or a change request (2 October decision 10). */
export const rejectionReasonSchema = z.enum([
  'incorrect_information',
  'incomplete',
  'language_and_tone',
  'pricing',
  'out_of_scope',
  'other',
]);
export type RejectionReason = z.output<typeof rejectionReasonSchema>;

/** One option of an agent's output (SOS-2 writes two or three per request). */
export const resultOptionSchema = z.object({
  code: z.string().min(1).max(8),
  text: z.string(),
  hashtags: z.array(z.string()),
});
export type ResultOption = z.output<typeof resultOptionSchema>;

/**
 * A result that waits for a decision of the unit's approver, with everything the decision needs.
 * Given only to a person who may decide it. The marks (money, outside, passkey) come from the
 * record and from code, never from the agent's text; `summary`, `rationale` and `riskNote` are the
 * agent's words and are shown as such.
 */
export const approvalCardSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  requestTitle: z.string(),
  requester: taskPersonSchema,
  project: projectRefSchema.nullable(),
  agent: agentRefSchema,
  attempt: z.number().int().min(1).max(2),
  createdAt: instantSchema,
  title: z.string(),
  summary: z.string().nullable(),
  rationale: z.string().nullable(),
  riskNote: z.string().nullable(),
  options: z.array(resultOptionSchema),
  involvesMoney: z.boolean(),
  // Where the money mark comes from: the card says the work involves money; the agent stated it;
  // or neither said anything and the safe default was taken. The panel says which, because a
  // statement of the model is not a fact of the record. Null when the mark is not set.
  moneyStatedBy: z.enum(['card', 'agent', 'default']).nullable(),
  goesExternal: z.boolean(),
  // Approving asks for a passkey re-verification (3 October decision 7, 5 October decision 2).
  needsStepUp: z.boolean(),
  // See requestDetailSchema.
  agentsMayWork: z.boolean(),
});
export type ApprovalCard = z.output<typeof approvalCardSchema>;

/** The approved result: what the requester is asked to accept, and what stays on the page. */
export const requestResultSchema = z.object({
  approvalId: z.uuid(),
  agent: agentRefSchema,
  title: z.string(),
  option: resultOptionSchema.nullable(),
  approvedBy: taskPersonSchema.nullable(),
  approvedAt: instantSchema,
});
export type RequestResult = z.output<typeof requestResultSchema>;

/**
 * What "not what I asked for" does now (8 October decision 3): true, the work goes back to the
 * same agent with the requester's words; false, the requester has said so once before on this
 * request, and this time nothing starts by itself: the work falls to the founder. Counted by the
 * server from the requester's earlier answers, as the database counts them; the round of the
 * acceptance does not say it (a routing made while a result waited opens a new round too).
 */
const returnsToAgentSchema = z.boolean();

/**
 * A result that waits for the acceptance of the reader: of their own request, or of the request
 * of somebody who can no longer read it, when the reader is the founder (8 October decision 45).
 */
export const acceptanceCardSchema = z.object({
  requestId: z.uuid(),
  requestTitle: z.string(),
  round: z.number().int().min(1),
  returnsToAgent: returnsToAgentSchema,
  // See requestDetailSchema: while false, "not what I asked for" cannot be said (it calls for a
  // run); accepting the approved result stays possible.
  agentsMayWork: z.boolean(),
  // Set when the reader gives this approval in the requester's place: the requester.
  forRequester: taskPersonSchema.nullable(),
  openedAt: instantSchema,
  result: requestResultSchema,
});
export type AcceptanceCard = z.output<typeof acceptanceCardSchema>;

/** GET /api/approvals: what waits for a decision of the reader. */
export const approvalDeskSchema = z.object({
  approvals: z.array(approvalCardSchema),
  acceptances: z.array(acceptanceCardSchema),
});
export type ApprovalDesk = z.output<typeof approvalDeskSchema>;

// Comments -----------------------------------------------------------------------------------------

export const REQUEST_COMMENT_MAX = 10_000;
/** The most comments the page of a request carries (the newest ones). */
export const REQUEST_COMMENT_LIMIT = 200;

export const requestCommentBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(REQUEST_COMMENT_MAX)
  .refine(withoutNul, NO_NUL);

/**
 * A comment on a request (8 October decision 13). Written by a person, read by people: the
 * author is always a person, and no agent run is ever given a comment. Plain text.
 */
export const requestCommentSchema = z.object({
  id: z.uuid(),
  author: taskPersonSchema,
  body: z.string(),
  createdAt: instantSchema,
});
export type RequestComment = z.output<typeof requestCommentSchema>;

/**
 * POST /api/requests/:requestId/comments. The requester, the approver of the request or the
 * founder (the database decides; 403 comment_not_allowed for anybody else), on an open and on a
 * closed request alike. A comment is never changed or deleted, so the id (chosen by the panel)
 * makes a retry safe: the same id again adds nothing and answers the page as it is. There is no
 * field that sets a status, names an agent or addresses anybody: a comment moves nothing.
 */
export const createRequestCommentSchema = z.strictObject({
  id: z.uuid(),
  body: requestCommentBodySchema,
});
export type CreateRequestComment = z.input<typeof createRequestCommentSchema>;

const stepSchema = z.object({
  // The catalog name of the tool; the panel has a fixed verb for each.
  tool: z.string(),
  status: z.enum(['started', 'succeeded', 'failed', 'sent_for_approval', 'blocked']),
});

/**
 * The journey of a request: what happened, in order, already cut to what the reader may read.
 * A run's summary is a fixed sentence made by code. Text an agent wrote appears in three places
 * only, and only for a person who may decide the work (the founder, the approver of the step):
 * the coordinator's reason for its routing, the closing words of a run that ended without its
 * tool or the coordinator's reason for routing nothing (`agentText`) and, inside the approval
 * card, the agent's summary, reasoning and risk note.
 * Nobody else reads a model's text before the approver has approved it (7 October decision 4).
 */
export const journeyItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('routing'),
    id: z.uuid(),
    at: instantSchema,
    round: z.number().int().min(1),
    unit: unitRefSchema,
    // Null: no open agent of the unit could take the work, and the request was returned.
    agent: agentRefSchema.nullable(),
    // Null: nobody is appointed for the unit, the founder decides.
    approver: taskPersonSchema.nullable(),
    // Null: the coordinator routed; set: a person corrected the routing.
    by: taskPersonSchema.nullable(),
    // A person's note for everybody; the coordinator's reason only for those who may decide.
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('run'),
    id: z.uuid(),
    at: instantSchema,
    agent: agentRefSchema,
    status: runStatusSchema,
    finishedAt: instantSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    errorCode: z.string().nullable(),
    summary: z.string().nullable(),
    // What the agent wrote when it ended without its tool, or the coordinator's reason when it
    // said through its tool that no unit fits; null for a reader who may not decide.
    agentText: z.string().nullable(),
    steps: z.array(stepSchema),
  }),
  z.object({
    kind: z.literal('approval'),
    id: z.uuid(),
    at: instantSchema,
    status: z.enum(['pending', 'approved', 'changes_requested', 'rejected', 'closed']),
    attempt: z.number().int().min(1).max(2),
    agent: agentRefSchema,
    decidedBy: taskPersonSchema.nullable(),
    reason: rejectionReasonSchema.nullable(),
    note: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('acceptance'),
    id: z.uuid(),
    at: instantSchema,
    round: z.number().int().min(1),
    status: z.enum(['pending', 'approved', 'changes_requested', 'closed']),
    // Who answered when it was not the requester: the founder, in the requester's place.
    decidedBy: taskPersonSchema.nullable(),
    reason: rejectionReasonSchema.nullable(),
    note: z.string().nullable(),
  }),
]);
export type JourneyItem = z.output<typeof journeyItemSchema>;

/**
 * GET /api/requests/:requestId: one answer for the whole page, so that the panel never puts a
 * journey together from several answers with several permissions.
 */
export const requestDetailSchema = requestSummarySchema.extend({
  text: z.string(),
  agent: agentRefSchema.nullable(),
  // The approver of the active step; null when nobody is appointed (the founder decides) or when
  // no step is active.
  approver: taskPersonSchema.nullable(),
  // False only for a request inside a project where agents may not work now (rule 12): a result
  // cannot be approved, changes cannot be asked for and the routing cannot be corrected until the
  // founder opens the permission.
  agentsMayWork: z.boolean(),
  // False: the requester can no longer read this request (taken out of the project, made an
  // external person, left the company, deactivated). The request goes on in the founder's name
  // (8 October decision 45).
  requesterReads: z.boolean(),
  // How a cancelled request was closed, for everybody who may read it: who closed it (the
  // requester, the one who stopped it, the approver who rejected the result), the reason class of
  // a rejection and that person's own words. Never anything an agent wrote. Null for a request the
  // routing returned (cause returned_no_agent): no person closed it, and `unit` names the unit.
  closure: z
    .object({
      by: taskPersonSchema.nullable(),
      reason: rejectionReasonSchema.nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  journey: z.array(journeyItemSchema),
  // Only for a person who may decide it.
  approval: approvalCardSchema.nullable(),
  // The approved result; shown to everybody who may read the request once it is approved.
  result: requestResultSchema.nullable(),
  // The requester's approval waits and the reader is the one who gives it: the requester, or the
  // founder in the place of a requester who cannot read the request (`inPlaceOfRequester`).
  acceptance: z
    .object({
      round: z.number().int().min(1),
      returnsToAgent: returnsToAgentSchema,
      inPlaceOfRequester: z.boolean(),
    })
    .nullable(),
  // The acts the reader may use (7 October decision 7). The server refuses the rest anyway.
  actions: z.object({ cancel: z.boolean(), stop: z.boolean(), reroute: z.boolean() }),
  // The comments of the request, for everybody who may read it: the newest REQUEST_COMMENT_LIMIT,
  // oldest first. `truncated`: older ones exist and are not carried. `mayWrite`: the reader is
  // the requester, the approver of the request or the founder (the server refuses the rest
  // anyway). People's text only; nothing of it is ever given to an agent.
  comments: z.object({
    items: z.array(requestCommentSchema),
    truncated: z.boolean(),
    mayWrite: z.boolean(),
  }),
  // The clock the stage and the durations were read on.
  serverTime: instantSchema,
});
export type RequestDetail = z.output<typeof requestDetailSchema>;

// Decisions ----------------------------------------------------------------------------------------

export const DECISION_NOTE_MAX = 2000;
const noteSchema = z.string().trim().max(DECISION_NOTE_MAX).refine(withoutNul, NO_NUL);

/**
 * POST /api/approvals/:approvalId/decision: the decision of the unit's approver.
 * - approved: the option chosen (required when the result has options) and, for an important
 *   approval, the passkey re-verification for exactly this decision.
 * - changes_requested, rejected: a reason from the fixed list; a note is required with "other".
 */
export const approvalDecisionSchema = z
  .discriminatedUnion('decision', [
    z.strictObject({
      decision: z.literal('approved'),
      selectedOption: z.string().min(1).max(8).optional(),
      stepUp: stepUpSchema.optional(),
    }),
    z.strictObject({
      decision: z.enum(['changes_requested', 'rejected']),
      reason: rejectionReasonSchema,
      note: noteSchema.optional(),
    }),
  ])
  .refine(
    (body) =>
      body.decision === 'approved' ||
      body.reason !== 'other' ||
      (body.note !== undefined && body.note.length > 0),
    { path: ['note'], message: 'Required with the reason "other"' },
  );
export type ApprovalDecision = z.input<typeof approvalDecisionSchema>;

/**
 * What the passkey confirms when an important result is approved: the approval (the subject of
 * the re-verification) and the option chosen. The panel sends it to POST /api/step-up/options and
 * the API builds the same from the decision, so a re-verification made for one option cannot
 * approve another.
 */
export function approvalDecisionDetails(selectedOption: string | undefined): {
  decision: 'approved';
  selectedOption: string | null;
} {
  return { decision: 'approved', selectedOption: selectedOption ?? null };
}

/**
 * POST /api/requests/:requestId/acceptance: the requester's answer to the approved result
 * (7 October decision 6). No passkey: the approver gave it when releasing important work.
 */
export const acceptanceDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approved') }),
  z.strictObject({
    decision: z.literal('changes_requested'),
    // The requester's words are the only thing the next attempt has to go on. The fixed list of
    // reasons belongs to the approver's record (2 October decision 10); the requester is not
    // asked to classify.
    note: noteSchema.refine((note) => note.length > 0, { message: 'Required' }),
    reason: rejectionReasonSchema.optional(),
  }),
]);
export type AcceptanceDecision = z.input<typeof acceptanceDecisionSchema>;

// Closing and correcting -----------------------------------------------------------------------------

export const CLOSE_REASON_MAX = 500;
const closeReasonSchema = z.string().trim().max(CLOSE_REASON_MAX).refine(withoutNul, NO_NUL);

/**
 * POST /api/requests/:requestId/close. The requester cancels and may say why; the approver of the
 * request or the founder stops and must say why, in a sentence the requester reads (the API
 * answers 409 reason_required without it).
 */
export const closeRequestSchema = z.strictObject({ reason: closeReasonSchema.optional() });
export type CloseRequest = z.input<typeof closeRequestSchema>;

export const ROUTING_NOTE_MAX = 600;

/**
 * POST /api/requests/:requestId/routing: the founder or the approver of the active step corrects
 * the routing (7 October decision 7): the unit, and an agent of it that is open in this company.
 * A person always names an agent: a request is not left at a unit that has nobody to do it (the
 * person closes it with a reason instead). Routing again to the agent that already had the request
 * starts its work again; that is also how a failed run is retried. The approver of the new step is
 * looked up by the database, never sent.
 */
export const correctRoutingSchema = z.strictObject({
  unitCode: unitCodeSchema,
  agentCode: agentCodeSchema,
  // A person's note: shown on the journey and given to the agent as data.
  note: z.string().trim().max(ROUTING_NOTE_MAX).refine(withoutNul, NO_NUL).optional(),
});
export type CorrectRouting = z.input<typeof correctRoutingSchema>;

/** GET /api/requests/:requestId/routing-options: where the request can be routed to now. */
export const routingOptionsSchema = z.object({
  units: z.array(
    z.object({
      code: unitCodeSchema,
      name: z.string(),
      // The agents of the unit that are open in this company and have a card version to run with.
      // A unit without one is listed too, so that the panel can say why it cannot be chosen.
      agents: z.array(agentRefSchema),
    }),
  ),
});
export type RoutingOptions = z.output<typeof routingOptionsSchema>;

/**
 * GET /api/requests/intake: can this person send a request in this company now. Asked by the form
 * before it lets the person write, and enforced again by POST /api/requests (409
 * requests_not_open), so that nobody sends a request that could never run.
 */
export const requestIntakeReasonSchema = z.enum([
  // Kurucu alanı: no coordinator works there.
  'private_space',
  // The coordinator's switch is off in this company.
  'coordinator_closed',
  // The coordinator's card has no version to run with (the definitions were not synchronised),
  // or its card is a draft.
  'coordinator_not_ready',
  // The coordinator's card is on trial: only the founder's requests run.
  'trial_founder_only',
]);
export type RequestIntakeReason = z.output<typeof requestIntakeReasonSchema>;

export const requestIntakeSchema = z.object({
  open: z.boolean(),
  reason: requestIntakeReasonSchema.nullable(),
});
export type RequestIntake = z.output<typeof requestIntakeSchema>;

// The agent's output -------------------------------------------------------------------------------

/**
 * What submit_for_approval stores in approvals.payload for a result with options. Parsed again
 * when it is read: the payload is what a model wrote.
 */
export const resultPayloadSchema = z.object({
  options: z
    .array(
      z.object({
        code: z.string().min(1).max(8),
        text: z.string().min(1),
        hashtags: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(3),
  // Where the money mark of the approval comes from: the card says so, the agent stated it, or
  // neither said anything and the safe default was taken. Written by the runner, not by the model.
  money_stated_by: z.enum(['card', 'agent', 'default']).optional(),
});
export type ResultPayload = z.output<typeof resultPayloadSchema>;
