import { describe, expect, it } from 'vitest';
import {
  QUEUE_GRACE_MS,
  REQUEST_COMMENT_MAX,
  REQUEST_TITLE_MAX,
  acceptanceDecisionSchema,
  approvalDecisionSchema,
  closeRequestSchema,
  correctRoutingSchema,
  createRequestCommentSchema,
  createRequestSchema,
  deriveRequestTitle,
  deriveStage,
  requestCauseSchema,
  requestCommentSchema,
  runGraceMs,
  type RequestFacts,
} from '../src/requests.ts';
import { officeDay } from '../src/tasks.ts';

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

  it('passes over a separator line and is never empty for a text the schema accepts', () => {
    // SV-6: a first line of 81 or more dashes or dots was cut and then stripped to nothing; the
    // table refuses an empty title and the request could never be sent.
    expect(deriveRequestTitle(`${'.'.repeat(81)}\nGerçek talep`)).toBe('Gerçek talep');
    expect(deriveRequestTitle('---\n\n  2026 bütçesi için özet hazırla.')).toBe(
      '2026 bütçesi için özet hazırla.',
    );
    // A text of separators alone keeps its first line, cut to the limit.
    for (const text of ['-'.repeat(90), '- '.repeat(60), `${'.'.repeat(200)}\n;;;`, '...']) {
      expect(
        createRequestSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001', text }).success,
      ).toBe(true);
      const title = deriveRequestTitle(text);
      expect(title.trim().length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(REQUEST_TITLE_MAX);
      expect(text.startsWith(title.slice(0, 10))).toBe(true);
    }
    expect(deriveRequestTitle('-'.repeat(90))).toBe('-'.repeat(80));
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

  it('a comment is an id and a text: trimmed, not blank, at most 10 000 characters, without NUL, and nothing that moves the request', () => {
    const parse = (body: unknown): boolean => createRequestCommentSchema.safeParse(body).success;
    expect(createRequestCommentSchema.parse({ id, body: ' Tamam. \n' })).toEqual({
      id,
      body: 'Tamam.',
    });
    expect(REQUEST_COMMENT_MAX).toBe(10_000);
    expect(parse({ id, body: 'x'.repeat(REQUEST_COMMENT_MAX) })).toBe(true);
    // The limit counts what is stored: the blanks around the text are not part of it.
    expect(parse({ id, body: `  ${'x'.repeat(REQUEST_COMMENT_MAX)}  ` })).toBe(true);
    expect(parse({ id, body: 'x'.repeat(REQUEST_COMMENT_MAX + 1) })).toBe(false);
    for (const body of ['', '   ', ' \n\t ', 'a\u0000b', null, 12, undefined]) {
      expect(parse({ id, body }), JSON.stringify(body)).toBe(false);
    }
    expect(parse({ body: 'Tamam.' })).toBe(false);
    expect(parse({ id: 'not-an-id', body: 'Tamam.' })).toBe(false);
    for (const extra of [
      { status: 'done' },
      { agentCode: 'SOS-2' },
      { to: id },
      { authorUserId: id },
      { createdAt: '2026-10-08T10:00:00+03:00' },
    ]) {
      expect(parse({ id, body: 'Tamam.', ...extra }), JSON.stringify(extra)).toBe(false);
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

  it('a close may carry a reason; a correction names a unit and an agent, nothing else', () => {
    expect(closeRequestSchema.safeParse({}).success).toBe(true);
    expect(closeRequestSchema.safeParse({ reason: 'Yanlışlıkla iki kez gönderildi' }).success).toBe(
      true,
    );
    expect(closeRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(closeRequestSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
    const parse = (body: unknown): boolean => correctRoutingSchema.safeParse(body).success;
    expect(parse({ unitCode: 'SOS', agentCode: 'SOS-2' })).toBe(true);
    expect(parse({ unitCode: 'SOS', agentCode: 'SOS-2', note: 'Bir taslak yazsın' })).toBe(true);
    // A person always names an agent: a request is not left at a unit that has nobody to do it.
    expect(parse({ unitCode: 'HUK', agentCode: null, note: 'Hukuk birimine ait' })).toBe(false);
    expect(parse({ unitCode: 'HUK', agentCode: '' })).toBe(false);
    expect(parse({ unitCode: 'SOS' })).toBe(false);
    expect(parse({ agentCode: 'SOS-2' })).toBe(false);
    for (const extra of [{ approver: id }, { status: 'done' }, { requester: id }]) {
      expect(parse({ unitCode: 'SOS', agentCode: 'SOS-2', ...extra })).toBe(false);
    }
  });
});

describe('the due day and the comments in an answer', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('the office’s day is the day in Istanbul, whatever the UTC day is', () => {
    // 01:30 on 8 October in Istanbul is still 7 October in UTC.
    expect(officeDay(new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-08');
    expect(officeDay(Date.parse('2026-10-07T20:59:00Z'))).toBe('2026-10-07');
    expect(officeDay(Date.parse('2026-10-07T21:00:00Z'))).toBe('2026-10-08');
    expect(officeDay(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
  });

  it('a comment in an answer is always a person’s', () => {
    const comment = {
      id,
      author: { userId: id, name: 'Çalışan A' },
      body: 'Neden B seçildi?',
      createdAt: '2026-10-08T10:00:00+03:00',
    };
    expect(requestCommentSchema.safeParse(comment).success).toBe(true);
    // A former member has no name any more.
    expect(
      requestCommentSchema.safeParse({ ...comment, author: { userId: id, name: null } }).success,
    ).toBe(true);
    // An agent could not be written as an author: the answer has no place for one.
    for (const author of [{ code: 'SOS-2', name: 'Sosyal İçerik' }, { name: 'Ajan' }, null]) {
      expect(requestCommentSchema.safeParse({ ...comment, author }).success).toBe(false);
    }
    expect(requestCommentSchema.safeParse({ ...comment, createdAt: '2026-10-08' }).success).toBe(
      false,
    );
  });
});

describe('where a request is and whose turn it is', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  const MINUTE = 60_000;
  const base: RequestFacts = {
    status: 'open',
    createdAt: ago(10_000),
    closedBy: null,
    closedAfterDelivery: false,
    returnedNoAgent: false,
    coordinatorEnabled: true,
    routed: false,
    step: null,
    pendingApproval: false,
    pendingAcceptance: false,
    lastResult: null,
    changesRequested: false,
    awaitedSince: null,
    notStartedAt: null,
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
    limitMinutes: number | null = null,
  ): RequestFacts['lastRun'] => ({
    agentCode,
    status,
    errorCode,
    startedAt: ago(startedMsAgo),
    limitMinutes,
  });
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
    // A run that carries no limit is measured by the default of a card: ten minutes and the margin.
    expect(runGraceMs(null)).toBe(12 * MINUTE);
    expect(of({ lastRun: run('KOR-1', 'running', null, 12 * MINUTE) })).toBe(
      'routing - coordinator on time',
    );
    expect(of({ lastRun: run('KOR-1', 'running', null, 12 * MINUTE + 1) })).toBe(
      'routing - coordinator delayed',
    );
    // The coordinator's card allows two minutes: a run of it that is still open after four is
    // not being worked on.
    expect(of({ lastRun: run('KOR-1', 'running', null, 4 * MINUTE, 2) })).toBe(
      'routing - coordinator on time',
    );
    expect(of({ lastRun: run('KOR-1', 'running', null, 4 * MINUTE + 1, 2) })).toBe(
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
    // "Gecikti" follows the run's own limit. A card may allow sixty minutes: a healthy run of a
    // thirty minute card is not late at minute twenty, and it is two minutes after its limit.
    expect(of({ lastRun: run('SOS-2', 'running', null, 20 * MINUTE, 30) }, routed)).toBe(
      'working - agent on time',
    );
    expect(of({ lastRun: run('SOS-2', 'running', null, 32 * MINUTE, 30) }, routed)).toBe(
      'working - agent on time',
    );
    expect(of({ lastRun: run('SOS-2', 'running', null, 32 * MINUTE + 1, 30) }, routed)).toBe(
      'working - agent delayed',
    );
    // And a lost run of a five minute card is noticed after seven minutes, not after twelve.
    expect(of({ lastRun: run('SOS-2', 'running', null, 7 * MINUTE + 1, 5) }, routed)).toBe(
      'working - agent delayed',
    );
    expect(of({ lastRun: run('SOS-2', 'running'), changesRequested: true }, routed)).toBe(
      'revising - agent on time',
    );
    expect(of({ step: { agentCode: 'SOS-2', agentEnabled: false } }, routed)).toBe(
      'fell_to_person agent_stopped approver on time',
    );
  });

  it('work that was called for and never started stays with a person, also once the agent is open again', () => {
    // The agent is open and no run started since the work was called for (5 s ago), but a trace
    // says the start was missed: the agent was stopped at the change request, or the job was
    // refused at the runner's gate. Nothing is on the queue, so it is nobody's turn but a person's.
    expect(of({ notStartedAt: ago(4_000) }, routed)).toBe(
      'fell_to_person not_started approver on time',
    );
    // The trace of a change request carries the very moment of that request.
    expect(of({ notStartedAt: ago(5_000), changesRequested: true }, routed)).toBe(
      'fell_to_person not_started approver on time',
    );
    // It does not turn into "the agent is working, delayed" with time.
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    expect(deriveStage({ ...routed, notStartedAt: ago(4_000) }, later)).toEqual({
      stage: 'fell_to_person',
      cause: 'not_started',
      turn: 'approver',
      delayed: false,
    });
    // While the agent is still stopped that is the cause the person reads.
    expect(
      of({ notStartedAt: ago(4_000), step: { agentCode: 'SOS-2', agentEnabled: false } }, routed),
    ).toBe('fell_to_person agent_stopped approver on time');
    // A person routed the request again after the missed start: the agent has the turn.
    expect(of({ notStartedAt: ago(6_000) }, routed)).toBe('working - agent on time');
    // A run that did start since then says more than the trace.
    expect(of({ notStartedAt: ago(4_000), lastRun: run('SOS-2', 'running') }, routed)).toBe(
      'working - agent on time',
    );
    expect(of({ notStartedAt: ago(4_000), lastRun: run('SOS-2', 'completed') }, routed)).toBe(
      'fell_to_person no_submission approver on time',
    );
    expect(of({ notStartedAt: ago(4_000), pendingApproval: true }, routed)).toBe(
      'unit_approval - approver on time',
    );

    // Before the routing: the coordinator's job was refused before a run existed.
    expect(of({ notStartedAt: ago(4_000) })).toBe('fell_to_person not_started founder on time');
    expect(of({ notStartedAt: ago(4_000), createdAt: ago(60 * 60 * 1000) })).toBe(
      'fell_to_person not_started founder on time',
    );
    expect(of({ notStartedAt: ago(4_000), coordinatorEnabled: false })).toBe(
      'fell_to_person coordinator_closed founder on time',
    );
    expect(of({ notStartedAt: ago(4_000), lastRun: run('KOR-1', 'running') })).toBe(
      'routing - coordinator on time',
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
    // A run the request changed under was not stopped by anybody's switch.
    expect(ended('stopped', 'request_changed')).toBe(
      'fell_to_person run_interrupted approver on time',
    );
    expect(ended('stopped', 'routing_changed')).toBe(
      'fell_to_person run_interrupted approver on time',
    );
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

  it('a request returned for want of an open agent is closed, with that cause and nobody’s turn', () => {
    // 8 October decision 2: the coordinator named the unit, no open agent of it could take the
    // work, and the routing closed the request. No step is active and the coordinator's run is
    // the last one.
    const returned: RequestFacts = {
      ...routed,
      status: 'cancelled',
      returnedNoAgent: true,
      step: null,
      awaitedSince: null,
      lastRun: run('KOR-1', 'completed'),
    };
    expect(of({}, returned)).toBe('cancelled returned_no_agent none on time');
    // Old, and never late: nothing is awaited on a closed request.
    expect(
      of({ createdAt: ago(120 * MINUTE), lastRun: run('KOR-1', 'completed', null, 9e6) }, returned),
    ).toBe('cancelled returned_no_agent none on time');
    // A person's own close is said as that person's.
    expect(of({ closedBy: 'requester' }, returned)).toBe(
      'cancelled cancelled_by_requester none on time',
    );
    expect(of({ closedBy: 'other' }, returned)).toBe('cancelled stopped none on time');
    // Without the returned step a request nobody closed by hand was rejected.
    expect(of({ returnedNoAgent: false }, returned)).toBe('cancelled rejected none on time');
  });

  it('no request waits for a person because a unit has no agent', () => {
    // The cause of option a is gone: such a request is returned, never parked.
    const causes: readonly string[] = requestCauseSchema.options;
    expect(causes).not.toContain('no_agent');
    expect(causes).toContain('returned_no_agent');
    // Every way an open, routed request can fall to a person names another cause.
    const fell = [
      of({ step: null }, routed),
      of({ step: { agentCode: 'SOS-2', agentEnabled: false } }, routed),
      of({ lastRun: run('SOS-2', 'completed') }, routed),
      of({ lastResult: { status: 'changes_requested', attempt: 2 } }, routed),
    ];
    expect(fell).toEqual([
      'fell_to_person second_change_request approver on time',
      'fell_to_person agent_stopped approver on time',
      'fell_to_person no_submission approver on time',
      'fell_to_person second_change_request approver on time',
    ]);
  });
});
