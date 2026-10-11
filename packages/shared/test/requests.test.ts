import { describe, expect, it } from 'vitest';
import {
  QUEUE_GRACE_MS,
  REQUEST_COMMENT_MAX,
  REQUEST_TITLE_MAX,
  acceptanceCardSchema,
  acceptanceDecisionSchema,
  approvalCardSchema,
  approvalDecisionSchema,
  closeRequestSchema,
  correctRoutingSchema,
  createRequestCommentSchema,
  createRequestSchema,
  deriveRequestTitle,
  deriveStage,
  journeyItemSchema,
  requestCauseSchema,
  requestCommentSchema,
  requestDetailSchema,
  requestSummarySchema,
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

  it('a request may carry a due day: a real calendar day and nothing else', () => {
    const parse = (body: unknown): boolean => createRequestSchema.safeParse(body).success;
    expect(parse({ id, text: 'Bir gönderi yaz' })).toBe(true);
    expect(
      createRequestSchema.parse({ id, text: 'Bir gönderi yaz', dueDate: '2026-10-20' }),
    ).toEqual({ id, text: 'Bir gönderi yaz', dueDate: '2026-10-20' });
    expect(parse({ id, text: 'x', dueDate: '2028-02-29' })).toBe(true);
    for (const dueDate of [
      '2026-10-20T10:00:00Z',
      '2026-10-20 10:00',
      '20.10.2026',
      '20/10/2026',
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-1-5',
      '',
      null,
      20261020,
    ]) {
      expect(parse({ id, text: 'x', dueDate }), JSON.stringify(dueDate)).toBe(false);
    }
    // The day is the one more thing; a body still cannot route, and has no time or zone to send.
    for (const extra of [{ unitCode: 'SOS' }, { dueAt: '2026-10-20' }, { overdue: false }]) {
      expect(parse({ id, text: 'x', dueDate: '2026-10-20', ...extra })).toBe(false);
    }
  });

  it('a request body may name a project by its id and nothing else', () => {
    const parse = (body: unknown): boolean => createRequestSchema.safeParse(body).success;
    const projectId = '00000000-0000-4000-8000-000000000031';
    expect(createRequestSchema.parse({ id, text: 'Bir gönderi yaz', projectId })).toEqual({
      id,
      text: 'Bir gönderi yaz',
      projectId,
    });
    expect(parse({ id, text: 'x', projectId, dueDate: '2026-10-20' })).toBe(true);
    // Without a project the body has no such key: it is not "no project" written as a value.
    expect(createRequestSchema.parse({ id, text: 'x' })).toEqual({ id, text: 'x' });
    for (const bad of ['', null, 'x', 31, 'Lansman', [projectId]]) {
      expect(parse({ id, text: 'x', projectId: bad }), JSON.stringify(bad)).toBe(false);
    }
    // The project is named by its id; a body cannot send its name or anything else of it.
    for (const extra of [
      { project: projectId },
      { project: { id: projectId, name: 'Lansman' } },
      { projectName: 'Lansman' },
      { project_id: projectId },
    ]) {
      expect(parse({ id, text: 'x', ...extra }), JSON.stringify(extra)).toBe(false);
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

  const summary = {
    id,
    title: 'LinkedIn için gönderi yaz',
    status: 'in_progress',
    stage: 'working',
    cause: null,
    delayed: false,
    turn: { kind: 'agent', code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
    waitingForMe: false,
    unit: { code: 'SOS', name: 'Sosyal Medya' },
    requester: { userId: id, name: 'Çalışan A' },
    project: null,
    createdAt: '2026-10-08T10:00:00+03:00',
    updatedAt: '2026-10-08T10:00:00+03:00',
    dueDate: '2026-10-20',
    overdue: false,
  };
  const comment = {
    id,
    author: { userId: id, name: 'Çalışan A' },
    body: 'Neden B seçildi?',
    createdAt: '2026-10-08T10:00:00+03:00',
  };

  it('a summary says the due day and whether it has passed', () => {
    const parse = (value: unknown): boolean => requestSummarySchema.safeParse(value).success;
    expect(requestSummarySchema.parse(summary)).toEqual(summary);
    expect(parse({ ...summary, dueDate: null })).toBe(true);
    expect(parse({ ...summary, overdue: true })).toBe(true);
    // Both are always said: a panel never guesses that a day has passed.
    for (const field of ['dueDate', 'overdue']) {
      const rest = Object.fromEntries(Object.entries(summary).filter(([key]) => key !== field));
      expect(parse(rest), field).toBe(false);
    }
    // A day, never an instant.
    expect(parse({ ...summary, dueDate: '2026-10-20T20:59:59.000Z' })).toBe(false);
    expect(parse({ ...summary, overdue: null })).toBe(false);
  });

  it('a detail carries its comments, and whether the reader may write one', () => {
    const detail = {
      ...summary,
      text: 'LinkedIn için gönderi yaz',
      agent: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
      approver: null,
      agentsMayWork: true,
      spendingLimitReached: false,
      requesterReads: true,
      closure: null,
      journey: [],
      approval: null,
      result: null,
      acceptance: null,
      actions: { cancel: true, stop: false, reroute: false },
      comments: { items: [comment], truncated: false, mayWrite: true },
      serverTime: '2026-10-08T10:00:00+03:00',
    };
    const parse = (value: unknown): boolean => requestDetailSchema.safeParse(value).success;
    expect(requestDetailSchema.parse(detail)).toEqual(detail);
    expect(parse({ ...detail, comments: { items: [], truncated: true, mayWrite: false } })).toBe(
      true,
    );
    // The page is never left to guess: no comments is an empty list, not a missing field.
    const { comments, ...withoutComments } = detail;
    expect(parse(withoutComments)).toBe(false);
    expect(parse({ ...detail, comments: [comment] })).toBe(false);
    for (const field of ['items', 'truncated', 'mayWrite']) {
      const rest = Object.fromEntries(Object.entries(comments).filter(([key]) => key !== field));
      expect(parse({ ...detail, comments: rest }), field).toBe(false);
    }
    // An agent could not be written as an author.
    const byAgent = { ...comment, author: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' } };
    expect(parse({ ...detail, comments: { ...comments, items: [byAgent] } })).toBe(false);
  });

  it('a comment in an answer is always a person’s', () => {
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
    agentsMayWork: true,
    spendingLimitReached: false,
    requesterReads: true,
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

  it('work that was called for and never started stays with a person while nothing calls for it again', () => {
    // The agent is open and no run started since the work was called for (5 s ago), but a trace
    // says the start was missed: the job was refused at the runner's gate, or the agent was
    // stopped at the change request and was opened outside the panel. Nothing is on the queue, so
    // it is nobody's turn but a person's. (An opening through the panel calls for the work again:
    // the cases of the restart are below.)
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

  // Rule 12 while a request is under way (8 October decisions 46 and 47).
  it('a request inside a project where agents may not work falls to the founder, whatever was called for', () => {
    const held = 'fell_to_person ai_permission_closed founder on time';
    const closed = { agentsMayWork: false };
    // Not routed: nothing yet, a start that was queued long ago, a coordinator that is stopped.
    expect(of(closed)).toBe(held);
    expect(of({ ...closed, createdAt: ago(60 * MINUTE) })).toBe(held);
    expect(of({ ...closed, coordinatorEnabled: false })).toBe(held);
    expect(of({ ...closed, notStartedAt: ago(4_000) })).toBe(held);
    // Routed, with an active step: no run, a queue that would be late, a stopped agent.
    expect(of(closed, routed)).toBe(held);
    expect(of({ ...closed, awaitedSince: ago(60 * MINUTE) }, routed)).toBe(held);
    expect(of({ ...closed, step: { agentCode: 'SOS-2', agentEnabled: false } }, routed)).toBe(held);
    expect(of({ ...closed, notStartedAt: ago(4_000) }, routed)).toBe(held);
    // The run the close stopped, a run that failed, a run the database has not closed yet.
    for (const last of [
      run('SOS-2', 'stopped', 'ai_permission_closed'),
      run('SOS-2', 'failed', 'runner_error'),
      run('SOS-2', 'completed'),
      run('SOS-2', 'running', null, 60 * MINUTE),
    ]) {
      expect(of({ ...closed, lastRun: last }, routed)).toBe(held);
    }
    expect(of({ ...closed, lastRun: run('KOR-1', 'stopped', 'ai_permission_closed') })).toBe(held);
    // After the second change request too: the founder is the one who can open the permission.
    expect(of({ ...closed, step: null, changesRequested: true }, routed)).toBe(held);
  });

  it('a result that waits keeps its stage while the permission is closed, and a closed request stays closed', () => {
    const closed = { agentsMayWork: false };
    // It can still be rejected, and an approved result can still be accepted.
    expect(of({ ...closed, status: 'awaiting_approval', pendingApproval: true }, routed)).toBe(
      'unit_approval - approver on time',
    );
    expect(of({ ...closed, status: 'awaiting_approval', pendingAcceptance: true }, routed)).toBe(
      'requester_approval - requester on time',
    );
    expect(of({ ...closed, status: 'done' }, routed)).toBe('done - none on time');
    expect(of({ ...closed, status: 'cancelled', closedBy: 'other' }, routed)).toBe(
      'cancelled stopped none on time',
    );
    expect(of({ ...closed, status: 'cancelled', closedBy: null }, routed)).toBe(
      'cancelled rejected none on time',
    );
  });

  // 8 October decision 45.
  it('a result that waits for a requester who cannot read the request is the founder’s turn', () => {
    const waits = { status: 'awaiting_approval', pendingAcceptance: true } as const;
    expect(of({ ...waits, requesterReads: true }, routed)).toBe(
      'requester_approval - requester on time',
    );
    expect(of({ ...waits, requesterReads: false }, routed)).toBe(
      'requester_approval - founder on time',
    );
    // Nothing else of the stage follows the requester: the work goes on as before.
    expect(of({ requesterReads: false }, routed)).toBe('working - agent on time');
    expect(
      of({ requesterReads: false, status: 'awaiting_approval', pendingApproval: true }, routed),
    ).toBe('unit_approval - approver on time');
    expect(of({ requesterReads: false })).toBe('routing - coordinator on time');
  });

  // 8 October decision 49.
  it('a restart moves the moment the work was called for', () => {
    // The switch stopped the run of the step's agent 3 s ago; the agent is open again.
    const stopped = { lastRun: run('SOS-2', 'stopped', 'agent_stopped') };
    expect(of(stopped, routed)).toBe('fell_to_person agent_stopped approver on time');
    // The opening called for the work again 1 s ago: that run is from before the call.
    expect(of({ ...stopped, awaitedSince: ago(1_000) }, routed)).toBe('working - agent on time');
    // The clock of "gecikti" starts at the restart, not at the routing or at the stopped run.
    const longAgo = run('SOS-2', 'stopped', 'agent_stopped', 10 * MINUTE);
    expect(of({ lastRun: longAgo, awaitedSince: ago(QUEUE_GRACE_MS) }, routed)).toBe(
      'working - agent on time',
    );
    expect(
      of(
        {
          lastRun: run('SOS-2', 'stopped', 'agent_stopped', 10 * MINUTE),
          awaitedSince: ago(3 * MINUTE),
        },
        routed,
      ),
    ).toBe('working - agent delayed');
    // A missed start from before the restart was answered by it; one after it was not.
    expect(of({ ...stopped, awaitedSince: ago(1_000), notStartedAt: ago(2_000) }, routed)).toBe(
      'working - agent on time',
    );
    expect(of({ ...stopped, awaitedSince: ago(1_000), notStartedAt: ago(500) }, routed)).toBe(
      'fell_to_person not_started approver on time',
    );
    // After a change request the restarted work is a revision, as before.
    expect(of({ ...stopped, awaitedSince: ago(1_000), changesRequested: true }, routed)).toBe(
      'revising - agent on time',
    );
    // The new run of the restarted job says more than everything before it.
    expect(of({ awaitedSince: ago(4_000), lastRun: run('SOS-2', 'running') }, routed)).toBe(
      'working - agent on time',
    );
    expect(
      of({ awaitedSince: ago(4_000), lastRun: run('SOS-2', 'failed', 'runner_error') }, routed),
    ).toBe('fell_to_person run_failed approver on time');
  });

  it('the same for a request nobody has routed', () => {
    // The coordinator's run was stopped by its switch 3 s ago; the coordinator is open again.
    const stopped = { lastRun: run('KOR-1', 'stopped', 'agent_stopped') };
    expect(of(stopped)).toBe('fell_to_person agent_stopped founder on time');
    expect(of({ ...stopped, awaitedSince: ago(1_000) })).toBe('routing - coordinator on time');
    expect(
      of({
        lastRun: run('KOR-1', 'stopped', 'agent_stopped', 10 * MINUTE),
        createdAt: ago(60 * MINUTE),
        awaitedSince: ago(3 * MINUTE),
      }),
    ).toBe('routing - coordinator delayed');
    // An old request is not late because it is old: the clock starts at the restart.
    expect(
      of({ createdAt: ago(60 * MINUTE), awaitedSince: ago(1_000), notStartedAt: ago(2_000) }),
    ).toBe('routing - coordinator on time');
    expect(of({ awaitedSince: ago(1_000), notStartedAt: ago(500) })).toBe(
      'fell_to_person not_started founder on time',
    );
    // While the coordinator is still closed that is what the person reads, restart or not.
    expect(of({ ...stopped, awaitedSince: ago(1_000), coordinatorEnabled: false })).toBe(
      'fell_to_person coordinator_closed founder on time',
    );
    // The run of the restarted job.
    expect(of({ awaitedSince: ago(4_000), lastRun: run('KOR-1', 'running') })).toBe(
      'routing - coordinator on time',
    );
    expect(of({ awaitedSince: ago(4_000), lastRun: run('KOR-1', 'completed') })).toBe(
      'fell_to_person no_routing founder on time',
    );
    // Without a restart the branch answers as before: every run and every trace is later than
    // the opening of the request.
    expect(of({ lastRun: run('KOR-1', 'completed', null, 9_000) })).toBe(
      'fell_to_person no_routing founder on time',
    );
    expect(of({ notStartedAt: ago(9_000) })).toBe('fell_to_person not_started founder on time');
  });

  it('after the permission is open again: restarted work reads as work; a run the close stopped that was not restarted reads as interrupted', () => {
    const stopped = run('SOS-2', 'stopped', 'ai_permission_closed');
    // Opened outside the panel, or while the step's agent was stopped: nothing called for the
    // work again. The turn is the approver's, as for every run that ended without a result.
    expect(of({ lastRun: stopped }, routed)).toBe(
      'fell_to_person ai_permission_interrupted approver on time',
    );
    // Before any routing the turn is the founder's.
    expect(of({ lastRun: run('KOR-1', 'stopped', 'ai_permission_closed') })).toBe(
      'fell_to_person ai_permission_interrupted founder on time',
    );
    // While the agent of the step is stopped, its last run still says why the work stopped.
    expect(
      of({ lastRun: stopped, step: { agentCode: 'SOS-2', agentEnabled: false } }, routed),
    ).toBe('fell_to_person ai_permission_interrupted approver on time');
    // The opening restarted it, or a person routed it again: it reads as work.
    expect(of({ lastRun: stopped, awaitedSince: ago(1_000) }, routed)).toBe(
      'working - agent on time',
    );
    expect(
      of({ lastRun: run('KOR-1', 'stopped', 'ai_permission_closed'), awaitedSince: ago(1_000) }),
    ).toBe('routing - coordinator on time');
    // The restarted job was refused: a missed start after the call.
    expect(of({ lastRun: stopped, awaitedSince: ago(1_000), notStartedAt: ago(500) }, routed)).toBe(
      'fell_to_person not_started approver on time',
    );
  });

  // 8 October decision 17: the AI spending limit of the request's project.
  it('a request in a project at its limit falls to the founder, routed or not', () => {
    const held = 'fell_to_person spending_limit_reached founder on time';
    const reached = { spendingLimitReached: true };
    // Not routed: nothing yet, a start that was queued long ago, a coordinator that is stopped,
    // a job that was refused, a run that ended without a routing.
    expect(of(reached)).toBe(held);
    expect(of({ ...reached, createdAt: ago(60 * MINUTE) })).toBe(held);
    expect(of({ ...reached, coordinatorEnabled: false })).toBe(held);
    expect(of({ ...reached, notStartedAt: ago(4_000) })).toBe(held);
    expect(of({ ...reached, lastRun: run('KOR-1', 'completed') })).toBe(held);
    expect(of({ ...reached, lastRun: run('KOR-1', 'failed', 'runner_error') })).toBe(held);
    expect(of({ ...reached, lastRun: run('KOR-1', 'stopped', 'spending_limit_reached') })).toBe(
      held,
    );
    // Routed, with an active step: no run, a queue that would be late, a stopped agent, a job
    // that was refused. The turn is the founder's, also when the step has an approver: only the
    // founder raises the limit.
    expect(of(reached, routed)).toBe(held);
    expect(of({ ...reached, awaitedSince: ago(60 * MINUTE) }, routed)).toBe(held);
    expect(of({ ...reached, step: { agentCode: 'SOS-2', agentEnabled: false } }, routed)).toBe(
      held,
    );
    expect(of({ ...reached, notStartedAt: ago(4_000) }, routed)).toBe(held);
    expect(of({ ...reached, changesRequested: true }, routed)).toBe(held);
    // The run the limit stopped, a run that failed, a run that ended without a result.
    for (const last of [
      run('SOS-2', 'stopped', 'spending_limit_reached'),
      run('SOS-2', 'failed', 'runner_error'),
      run('SOS-2', 'completed'),
      run('SOS-2', 'limit_reached', 'time_limit'),
    ]) {
      expect(of({ ...reached, lastRun: last }, routed)).toBe(held);
    }
    // Without the flag every one of these reads as before.
    expect(of({})).toBe('routing - coordinator on time');
    expect(of({}, routed)).toBe('working - agent on time');
  });

  it('a run that is still open keeps its stage while the limit is reached', () => {
    const reached = { spendingLimitReached: true };
    // It uses the answer it has paid for and ends before its next model call.
    expect(of({ ...reached, lastRun: run('KOR-1', 'running') })).toBe(
      'routing - coordinator on time',
    );
    expect(of({ ...reached, lastRun: run('SOS-2', 'running') }, routed)).toBe(
      'working - agent on time',
    );
    expect(
      of({ ...reached, changesRequested: true, lastRun: run('SOS-2', 'running') }, routed),
    ).toBe('revising - agent on time');
    // Also when it takes long: it is late, not held.
    expect(of({ ...reached, lastRun: run('SOS-2', 'running', null, 60 * MINUTE) }, routed)).toBe(
      'working - agent delayed',
    );
    // An open run of another agent is not the step's work: the request is held.
    expect(of({ ...reached, lastRun: run('KOR-1', 'running') }, routed)).toBe(
      'fell_to_person spending_limit_reached founder on time',
    );
  });

  it('a result that waits keeps its stage while the limit is reached', () => {
    const reached = { spendingLimitReached: true };
    // The limit is about money, not about permission: the result can be approved, rejected and
    // accepted as always.
    expect(of({ ...reached, status: 'awaiting_approval', pendingApproval: true }, routed)).toBe(
      'unit_approval - approver on time',
    );
    expect(of({ ...reached, status: 'awaiting_approval', pendingAcceptance: true }, routed)).toBe(
      'requester_approval - requester on time',
    );
    expect(
      of(
        { ...reached, status: 'awaiting_approval', pendingAcceptance: true, requesterReads: false },
        routed,
      ),
    ).toBe('requester_approval - founder on time');
    // A closed request stays closed; the second change request stays the approver's.
    expect(of({ ...reached, status: 'done' }, routed)).toBe('done - none on time');
    expect(of({ ...reached, status: 'cancelled', closedBy: 'other' }, routed)).toBe(
      'cancelled stopped none on time',
    );
    expect(
      of({ ...reached, lastResult: { status: 'changes_requested', attempt: 2 } }, routed),
    ).toBe('fell_to_person second_change_request approver on time');
    expect(of({ ...reached, step: null, changesRequested: true }, routed)).toBe(
      'fell_to_person second_change_request approver on time',
    );
  });

  it('a closed AI permission is said before a reached limit', () => {
    const both = { agentsMayWork: false, spendingLimitReached: true };
    const held = 'fell_to_person ai_permission_closed founder on time';
    expect(of(both)).toBe(held);
    expect(of(both, routed)).toBe(held);
    expect(
      of({ ...both, lastRun: run('SOS-2', 'stopped', 'spending_limit_reached') }, routed),
    ).toBe(held);
    // Also where a reached limit alone leaves the stage as it is.
    expect(of({ ...both, lastRun: run('SOS-2', 'running') }, routed)).toBe(held);
    expect(of({ ...both, step: null, changesRequested: true }, routed)).toBe(held);
  });

  it("after the limit is raised a run it stopped reads spending_limit_interrupted, with the approver's turn", () => {
    const stopped = run('SOS-2', 'stopped', 'spending_limit_reached');
    // A raise through the panel starts this work again (11 October decision 1). Raised outside
    // the panel, or while the step's agent was stopped: nothing called for the work again.
    expect(of({ lastRun: stopped }, routed)).toBe(
      'fell_to_person spending_limit_interrupted approver on time',
    );
    // Before any routing the turn is the founder's.
    expect(of({ lastRun: run('KOR-1', 'stopped', 'spending_limit_reached') })).toBe(
      'fell_to_person spending_limit_interrupted founder on time',
    );
    // While the agent of the step is stopped, its last run still says why the work stopped.
    expect(
      of({ lastRun: stopped, step: { agentCode: 'SOS-2', agentEnabled: false } }, routed),
    ).toBe('fell_to_person spending_limit_interrupted approver on time');
    // A person routed it again (or an opening called for it): it reads as work.
    expect(of({ lastRun: stopped, awaitedSince: ago(1_000) }, routed)).toBe(
      'working - agent on time',
    );
    // A stop for another reason keeps its own cause.
    expect(of({ lastRun: run('SOS-2', 'stopped', 'routing_changed') }, routed)).toBe(
      'fell_to_person run_interrupted approver on time',
    );
  });

  it('after the limit is raised a refused job reads not_started', () => {
    // The job was refused at the start of the run while the limit was reached; nothing has
    // called for the work again since.
    expect(of({ notStartedAt: ago(4_000) }, routed)).toBe(
      'fell_to_person not_started approver on time',
    );
    expect(of({ notStartedAt: ago(4_000) })).toBe('fell_to_person not_started founder on time');
    // While the limit held, the same records read as the limit.
    expect(of({ notStartedAt: ago(4_000), spendingLimitReached: true }, routed)).toBe(
      'fell_to_person spending_limit_reached founder on time',
    );
  });
});

describe('the project of a request and who stands in, in an answer', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const person = { userId: id, name: 'Çalışan A' };
  const agent = { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' };
  const at = '2026-10-08T10:00:00+03:00';
  const project = { id, name: 'Lansman' };
  const summary = {
    id,
    title: 'LinkedIn için gönderi yaz',
    status: 'awaiting_approval',
    stage: 'unit_approval',
    cause: null,
    delayed: false,
    turn: { kind: 'founder' },
    waitingForMe: true,
    unit: { code: 'SOS', name: 'Sosyal Medya' },
    requester: person,
    project,
    createdAt: at,
    updatedAt: at,
    dueDate: null,
    overdue: false,
  };
  const card = {
    id,
    requestId: id,
    requestTitle: summary.title,
    requester: person,
    project,
    agent,
    attempt: 1,
    createdAt: at,
    title: 'Sonuç',
    summary: null,
    rationale: null,
    riskNote: null,
    options: [],
    involvesMoney: false,
    moneyStatedBy: null,
    goesExternal: false,
    needsStepUp: false,
    agentsMayWork: false,
    spendingLimitReached: false,
  };
  const result = {
    approvalId: id,
    agent,
    title: 'Sonuç',
    option: null,
    approvedBy: person,
    approvedAt: at,
  };
  const acceptance = {
    requestId: id,
    requestTitle: summary.title,
    round: 1,
    returnsToAgent: true,
    agentsMayWork: true,
    spendingLimitReached: false,
    forRequester: person,
    openedAt: at,
    result,
  };
  const detail = {
    ...summary,
    text: summary.title,
    agent,
    approver: null,
    agentsMayWork: false,
    spendingLimitReached: false,
    requesterReads: false,
    closure: null,
    journey: [],
    approval: card,
    result: null,
    acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: true },
    actions: { cancel: false, stop: true, reroute: false },
    comments: { items: [], truncated: false, mayWrite: true },
    serverTime: at,
  };
  const without = (value: Record<string, unknown>, field: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));

  it('every answer that carries a request says its project and whether agents may work', () => {
    expect(requestSummarySchema.parse(summary)).toEqual(summary);
    expect(requestSummarySchema.safeParse({ ...summary, project: null }).success).toBe(true);
    expect(requestSummarySchema.safeParse(without(summary, 'project')).success).toBe(false);
    // An id and a name, nothing else of the project.
    for (const bad of [{ id }, { name: 'Lansman' }, { id: 'x', name: 'Lansman' }, 'Lansman']) {
      expect(requestSummarySchema.safeParse({ ...summary, project: bad }).success).toBe(false);
    }

    expect(requestDetailSchema.parse(detail)).toEqual(detail);
    expect(requestDetailSchema.safeParse(without(detail, 'agentsMayWork')).success).toBe(false);
    expect(requestDetailSchema.safeParse({ ...detail, agentsMayWork: null }).success).toBe(false);

    expect(approvalCardSchema.parse(card)).toEqual(card);
    expect(approvalCardSchema.safeParse({ ...card, project: null }).success).toBe(true);
    for (const field of ['project', 'agentsMayWork']) {
      expect(approvalCardSchema.safeParse(without(card, field)).success, field).toBe(false);
    }

    expect(acceptanceCardSchema.parse(acceptance)).toEqual(acceptance);
    expect(acceptanceCardSchema.safeParse(without(acceptance, 'agentsMayWork')).success).toBe(
      false,
    );
  });

  // 8 October decision 17.
  it("every answer that carries a request says whether its project's spending limit is reached", () => {
    const schemas = [
      [requestDetailSchema, detail],
      [approvalCardSchema, card],
      [acceptanceCardSchema, acceptance],
    ] as const;
    for (const [schema, value] of schemas) {
      for (const spendingLimitReached of [true, false]) {
        expect(schema.safeParse({ ...value, spendingLimitReached }).success).toBe(true);
      }
      // The server's word: never left out, never a guess.
      expect(schema.safeParse(without(value, 'spendingLimitReached')).success).toBe(false);
      for (const guess of [null, 'yes', 1]) {
        expect(
          schema.safeParse({ ...value, spendingLimitReached: guess }).success,
          String(guess),
        ).toBe(false);
      }
    }
    expect(requestDetailSchema.parse({ ...detail, spendingLimitReached: true })).toMatchObject({
      spendingLimitReached: true,
    });
  });

  it('every answer says whether the requester reads the request and who stands in', () => {
    const parse = (value: unknown): boolean => requestDetailSchema.safeParse(value).success;
    expect(parse(without(detail, 'requesterReads'))).toBe(false);
    expect(parse({ ...detail, requesterReads: true, acceptance: null })).toBe(true);
    expect(
      parse({
        ...detail,
        acceptance: { round: 1, returnsToAgent: true, inPlaceOfRequester: false },
      }),
    ).toBe(true);
    expect(parse({ ...detail, acceptance: { round: 1, returnsToAgent: true } })).toBe(false);

    // A desk card names the requester the reader stands in for, or says that it is the reader's
    // own.
    expect(acceptanceCardSchema.safeParse({ ...acceptance, forRequester: null }).success).toBe(
      true,
    );
    expect(acceptanceCardSchema.safeParse(without(acceptance, 'forRequester')).success).toBe(false);
    expect(
      acceptanceCardSchema.safeParse({ ...acceptance, forRequester: 'Çalışan A' }).success,
    ).toBe(false);

    // The journey says who answered when it was not the requester.
    const item = {
      kind: 'acceptance',
      id,
      at,
      round: 1,
      status: 'approved',
      decidedBy: person,
      reason: null,
      note: null,
    };
    expect(journeyItemSchema.parse(item)).toEqual(item);
    expect(journeyItemSchema.safeParse({ ...item, decidedBy: null }).success).toBe(true);
    expect(journeyItemSchema.safeParse(without(item, 'decidedBy')).success).toBe(false);
  });

  it('the two causes of a closed permission are causes of a request', () => {
    const causes: readonly string[] = requestCauseSchema.options;
    expect(causes).toContain('ai_permission_closed');
    expect(causes).toContain('ai_permission_interrupted');
  });

  it('the two causes of a reached spending limit are causes of a request', () => {
    const causes: readonly string[] = requestCauseSchema.options;
    expect(causes).toContain('spending_limit_reached');
    expect(causes).toContain('spending_limit_interrupted');
  });
});
