import { describe, expect, it } from 'vitest';
import {
  QUEUE_GRACE_MS,
  REQUEST_TITLE_MAX,
  RUN_GRACE_MS,
  acceptanceDecisionSchema,
  approvalDecisionSchema,
  closeRequestSchema,
  correctRoutingSchema,
  createRequestSchema,
  deriveRequestTitle,
  deriveStage,
  type RequestFacts,
} from '../src/requests.ts';

describe('the title of a request', () => {
  it('is the first line that is not empty', () => {
    expect(deriveRequestTitle('\n\n  LinkedIn   gönderisi yaz \nKaynak: ...')).toBe(
      'LinkedIn gönderisi yaz',
    );
  });

  it('is cut at a word and never ends with punctuation', () => {
    const text =
      'Yeni açılan İzmir ofisimiz için LinkedIn ve Instagram gönderisi hazırlanmasını, ayrıca kısa bir video senaryosu yazılmasını istiyorum';
    const title = deriveRequestTitle(text);
    expect(title.length).toBeLessThanOrEqual(REQUEST_TITLE_MAX);
    expect(text.startsWith(title)).toBe(true);
    expect(text.charAt(title.length)).toMatch(/[\s,]/);
    expect(title).not.toMatch(/[\s,;:.-]$/);
  });

  it('cuts a single word that is longer than the limit', () => {
    expect(deriveRequestTitle('x'.repeat(300))).toHaveLength(REQUEST_TITLE_MAX);
  });
});

describe('the bodies a person sends', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('a request is a text and an id, and nothing that routes it', () => {
    expect(createRequestSchema.safeParse({ id, text: 'Bir gönderi yaz' }).success).toBe(true);
    expect(createRequestSchema.safeParse({ id, text: '   \n ' }).success).toBe(false);
    expect(createRequestSchema.safeParse({ id, text: 'a\u0000b' }).success).toBe(false);
    for (const extra of [{ unit: 'SOS' }, { agent: 'SOS-2' }, { status: 'done' }, { title: 'x' }]) {
      expect(createRequestSchema.safeParse({ id, text: 'x', ...extra }).success).toBe(false);
    }
  });

  it('a change request or a rejection names a reason; "other" needs a note', () => {
    const parse = (body: unknown): boolean => approvalDecisionSchema.safeParse(body).success;
    expect(parse({ decision: 'approved', selectedOption: 'A' })).toBe(true);
    expect(parse({ decision: 'approved', reason: 'other' })).toBe(false);
    expect(parse({ decision: 'changes_requested' })).toBe(false);
    expect(parse({ decision: 'changes_requested', reason: 'language_and_tone' })).toBe(true);
    expect(parse({ decision: 'rejected', reason: 'other' })).toBe(false);
    expect(parse({ decision: 'rejected', reason: 'other', note: '  ' })).toBe(false);
    expect(parse({ decision: 'rejected', reason: 'other', note: 'Yanlış kanal' })).toBe(true);
    expect(parse({ decision: 'done' })).toBe(false);
  });

  it('the requester accepts, or says what is wrong in their own words', () => {
    const parse = (body: unknown): boolean => acceptanceDecisionSchema.safeParse(body).success;
    expect(parse({ decision: 'approved' })).toBe(true);
    // The sentence is required; a class from the approver's list is not asked for.
    expect(parse({ decision: 'changes_requested', reason: 'incomplete' })).toBe(false);
    expect(parse({ decision: 'changes_requested', note: '   ' })).toBe(false);
    expect(parse({ decision: 'changes_requested', note: 'Kısa olsun' })).toBe(true);
    expect(parse({ decision: 'changes_requested', reason: 'incomplete', note: 'Kısa olsun' })).toBe(
      true,
    );
    expect(parse({ decision: 'rejected', reason: 'incomplete', note: 'x' })).toBe(false);
  });

  it('a close may carry a reason; a correction names a unit and an agent or none, nothing else', () => {
    expect(closeRequestSchema.safeParse({}).success).toBe(true);
    expect(closeRequestSchema.safeParse({ reason: 'Yanlışlıkla iki kez gönderildi' }).success).toBe(
      true,
    );
    expect(closeRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(closeRequestSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
    const parse = (body: unknown): boolean => correctRoutingSchema.safeParse(body).success;
    expect(parse({ unitCode: 'SOS', agentCode: 'SOS-2' })).toBe(true);
    expect(parse({ unitCode: 'HUK', agentCode: null, note: 'Hukuk birimine ait' })).toBe(true);
    expect(parse({ unitCode: 'SOS' })).toBe(false);
    for (const extra of [{ approver: id }, { status: 'done' }, { requester: id }]) {
      expect(parse({ unitCode: 'SOS', agentCode: 'SOS-2', ...extra })).toBe(false);
    }
  });
});

describe('where a request is and whose turn it is', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  const base: RequestFacts = {
    status: 'open',
    createdAt: ago(10_000),
    closedBy: null,
    closedAfterDelivery: false,
    coordinatorEnabled: true,
    routed: false,
    step: null,
    pendingApproval: false,
    pendingAcceptance: false,
    lastResult: null,
    changesRequested: false,
    awaitedSince: null,
    lastRun: null,
  };
  const routed: RequestFacts = {
    ...base,
    status: 'in_progress',
    routed: true,
    step: { agentCode: 'SOS-2', agentEnabled: true },
    awaitedSince: ago(5_000),
  };
  const run = (
    agentCode: string,
    status: NonNullable<RequestFacts['lastRun']>['status'],
    errorCode: string | null = null,
    startedMsAgo = 3_000,
  ): RequestFacts['lastRun'] => ({ agentCode, status, errorCode, startedAt: ago(startedMsAgo) });
  const of = (facts: Partial<RequestFacts>, from: RequestFacts = base): string => {
    const derived = deriveStage({ ...from, ...facts }, now);
    return [
      derived.stage,
      derived.cause ?? '-',
      derived.turn,
      derived.delayed ? 'delayed' : 'on time',
    ].join(' ');
  };

  it('before the routing', () => {
    expect(of({})).toBe('routing - coordinator on time');
    expect(of({ createdAt: ago(QUEUE_GRACE_MS + 1) })).toBe('routing - coordinator delayed');
    expect(of({ lastRun: run('KOR-1', 'running') })).toBe('routing - coordinator on time');
    expect(of({ lastRun: run('KOR-1', 'running', null, RUN_GRACE_MS + 1) })).toBe(
      'routing - coordinator delayed',
    );
    expect(of({ coordinatorEnabled: false })).toBe(
      'fell_to_person coordinator_closed founder on time',
    );
    expect(of({ lastRun: run('KOR-1', 'completed') })).toBe(
      'fell_to_person no_routing founder on time',
    );
    expect(of({ lastRun: run('KOR-1', 'failed', 'model_unavailable') })).toBe(
      'fell_to_person model_unavailable founder on time',
    );
    expect(of({ lastRun: run('KOR-1', 'failed', 'card_not_runnable') })).toBe(
      'fell_to_person card_not_runnable founder on time',
    );
  });

  it('while the unit’s agent has the work', () => {
    // Routed; the coordinator's run is the last one and the agent's has not started yet.
    expect(of({ lastRun: run('KOR-1', 'completed', null, 6_000) }, routed)).toBe(
      'working - agent on time',
    );
    expect(of({ awaitedSince: ago(QUEUE_GRACE_MS + 1) }, routed)).toBe('working - agent delayed');
    expect(of({ lastRun: run('SOS-2', 'running') }, routed)).toBe('working - agent on time');
    expect(of({ lastRun: run('SOS-2', 'running'), changesRequested: true }, routed)).toBe(
      'revising - agent on time',
    );
    expect(of({ step: { agentCode: null, agentEnabled: false } }, routed)).toBe(
      'fell_to_person no_agent approver on time',
    );
    expect(of({ step: { agentCode: 'SOS-2', agentEnabled: false } }, routed)).toBe(
      'fell_to_person agent_stopped approver on time',
    );
  });

  it('a run that ended without a result falls to a person, with its cause', () => {
    const ended = (
      status: NonNullable<RequestFacts['lastRun']>['status'],
      errorCode: string | null = null,
    ): string => of({ lastRun: run('SOS-2', status, errorCode) }, routed);
    expect(ended('completed')).toBe('fell_to_person no_submission approver on time');
    expect(ended('limit_reached', 'tool_call_limit')).toBe(
      'fell_to_person limit_reached approver on time',
    );
    expect(ended('stopped', 'agent_stopped')).toBe('fell_to_person agent_stopped approver on time');
    expect(ended('failed', 'model_refusal')).toBe('fell_to_person model_refused approver on time');
    expect(ended('failed', 'anthropic_auth_failed')).toBe(
      'fell_to_person model_unavailable approver on time',
    );
    expect(ended('failed', 'anthropic_overloaded')).toBe(
      'fell_to_person run_failed approver on time',
    );
    // The two causes only the founder can remove, each with a sentence of its own.
    expect(ended('failed', 'anthropic_billing')).toBe(
      'fell_to_person model_billing approver on time',
    );
    expect(ended('failed', 'anthropic_model_not_found')).toBe(
      'fell_to_person model_not_available approver on time',
    );
    // A run from before the last change request does not count: a new one is awaited.
    expect(
      of({ lastRun: run('SOS-2', 'completed', null, 60_000), changesRequested: true }, routed),
    ).toBe('revising - agent on time');
  });

  it('approvals, the change request limit and the end', () => {
    expect(of({ status: 'awaiting_approval', pendingApproval: true }, routed)).toBe(
      'unit_approval - approver on time',
    );
    expect(of({ status: 'awaiting_approval', pendingAcceptance: true }, routed)).toBe(
      'requester_approval - requester on time',
    );
    expect(
      of(
        { lastResult: { status: 'changes_requested', attempt: 2 }, changesRequested: true },
        routed,
      ),
    ).toBe('fell_to_person second_change_request approver on time');
    expect(of({ step: null, changesRequested: true }, routed)).toBe(
      'fell_to_person second_change_request approver on time',
    );
    expect(of({ status: 'done' }, routed)).toBe('done - none on time');
    expect(of({ status: 'cancelled', closedBy: 'requester' }, routed)).toBe(
      'cancelled cancelled_by_requester none on time',
    );
    expect(of({ status: 'cancelled', closedBy: 'other' }, routed)).toBe(
      'cancelled stopped none on time',
    );
    // Stopped while the approved result waited for its requester: the work was delivered.
    expect(of({ status: 'cancelled', closedBy: 'other', closedAfterDelivery: true }, routed)).toBe(
      'cancelled closed_after_delivery none on time',
    );
    expect(
      of({ status: 'cancelled', closedBy: 'requester', closedAfterDelivery: true }, routed),
    ).toBe('cancelled cancelled_by_requester none on time');
    expect(of({ status: 'cancelled', closedBy: null }, routed)).toBe(
      'cancelled rejected none on time',
    );
  });
});
