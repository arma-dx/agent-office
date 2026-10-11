import type {
  AcceptanceRow,
  RequestCommentRow,
  RequestRow,
  ResultApprovalRow,
} from '@agent-office/db';
import {
  REQUEST_COMMENT_LIMIT,
  approvalCardSchema,
  journeyItemSchema,
  requestCommentSchema,
  requestSummarySchema,
} from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import {
  factsOf,
  peopleOfJourney,
  toApprovalCard,
  toComments,
  toJourney,
  toSummary,
  type Reader,
} from '../src/requests-view.ts';

// What the panel reads of a request beyond its stage, without a database: the due day and whether
// it has passed (docs/SONRA.md W-h: information only), and its comments (8 October decision 13).

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const READER: Reader = { userId: id(900), role: 'employee' };
const NAMES = new Map([[id(900), 'Çalışan']]);

/** A request row as the statement gives it: only just opened, unless changed. */
function row(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: id(1),
    title: 'LinkedIn için gönderi yaz',
    description: 'LinkedIn için gönderi yaz',
    status: 'open',
    created_at: new Date('2026-10-08T06:00:00.000Z'),
    updated_at: new Date('2026-10-08T06:00:00.000Z'),
    due_date: null,
    requester_user_id: id(900),
    project_id: null,
    project_name: null,
    agents_may_work: true,
    spending_limit_reached: false,
    requester_reads: true,
    restarted_at: null,
    closed_by_user_id: null,
    close_reason: null,
    closed_after_delivery: false,
    returned_no_agent: false,
    rejected_by_user_id: null,
    rejected_reason: null,
    rejected_note: null,
    reader_may_decide: false,
    unit_code: null,
    unit_name: null,
    coordinator_name: 'Ofis Koordinatörü',
    coordinator_enabled: true,
    reader_can_approve: false,
    routed: false,
    step_agent_code: null,
    step_agent_name: null,
    step_agent_enabled: null,
    step_approver_user_id: null,
    step_created_at: null,
    pending_acceptance: false,
    pending_result: false,
    last_result_status: null,
    last_result_attempt: null,
    last_change_request_at: null,
    not_started_at: null,
    run_agent_code: null,
    run_status: null,
    run_error_code: null,
    run_started_at: null,
    run_limit_minutes: null,
    ...overrides,
  };
}

describe('the due day of a request as the panel reads it', () => {
  // Noon on 8 October in Istanbul.
  const NOON = new Date('2026-10-08T09:00:00.000Z');
  const due = (overrides: Partial<RequestRow>, now: Date = NOON) => {
    const summary = requestSummarySchema.parse(toSummary(row(overrides), READER, NAMES, now));
    return { dueDate: summary.dueDate, overdue: summary.overdue };
  };

  it('a due day has passed from the next office day on, and only for an open request', () => {
    expect(due({ due_date: null })).toEqual({ dueDate: null, overdue: false });
    // The day itself is not late, whatever the hour.
    expect(due({ due_date: '2026-10-08' })).toEqual({ dueDate: '2026-10-08', overdue: false });
    expect(due({ due_date: '2026-10-09' })).toEqual({ dueDate: '2026-10-09', overdue: false });
    expect(due({ due_date: '2026-10-07' })).toEqual({ dueDate: '2026-10-07', overdue: true });
    // Every open status says it; a closed request never does and keeps its day.
    for (const status of ['open', 'in_progress', 'awaiting_approval', 'awaiting_reply']) {
      expect(due({ due_date: '2026-10-07', status }), status).toEqual({
        dueDate: '2026-10-07',
        overdue: true,
      });
    }
    for (const status of ['done', 'cancelled']) {
      expect(due({ due_date: '2026-10-07', status }), status).toEqual({
        dueDate: '2026-10-07',
        overdue: false,
      });
    }
  });

  it('the day ends at midnight in Istanbul, not in UTC', () => {
    // 23:30 on 8 October in Istanbul: the day is not over.
    expect(due({ due_date: '2026-10-08' }, new Date('2026-10-08T20:30:00.000Z')).overdue).toBe(
      false,
    );
    // 00:30 on 9 October in Istanbul, still 8 October in UTC: it is.
    expect(due({ due_date: '2026-10-08' }, new Date('2026-10-08T21:30:00.000Z')).overdue).toBe(
      true,
    );
    // Across a year: a comparison of days, not of their text in another order.
    expect(due({ due_date: '2026-12-31' }, new Date('2026-12-31T21:00:00.000Z')).overdue).toBe(
      true,
    );
    expect(due({ due_date: '2027-01-01' }, new Date('2026-12-31T21:00:00.000Z')).overdue).toBe(
      false,
    );
  });

  it('a passed day is not a late run: the two marks are told apart', () => {
    // A run that is still open long after its limit, on a request whose day has not come.
    const lateRun = requestSummarySchema.parse(
      toSummary(
        row({
          status: 'in_progress',
          due_date: '2026-10-20',
          run_agent_code: 'KOR-1',
          run_status: 'running',
          run_started_at: new Date('2026-10-08T06:00:00.000Z'),
          run_limit_minutes: 2,
        }),
        READER,
        NAMES,
        NOON,
      ),
    );
    expect({ delayed: lateRun.delayed, overdue: lateRun.overdue }).toEqual({
      delayed: true,
      overdue: false,
    });
    // A request whose day has passed while nothing runs late.
    const pastDay = requestSummarySchema.parse(
      toSummary(row({ due_date: '2026-10-01', status: 'done' }), READER, NAMES, NOON),
    );
    expect({ delayed: pastDay.delayed, overdue: pastDay.overdue }).toEqual({
      delayed: false,
      overdue: false,
    });
  });
});

describe('the comments of a request as the page reads them', () => {
  const START = Date.parse('2026-10-08T09:00:00.000Z');
  /** Comment number n (1 is the oldest), as the statement gives a row. */
  const comment = (n: number, author: string = id(900)): RequestCommentRow => ({
    id: id(1000 + n),
    author_user_id: author,
    body: `Yorum ${String(n)}`,
    created_at: new Date(START + n * 1000),
  });
  /** The statement's answer for `count` comments with this limit: the newest first. */
  const newestFirst = (count: number, limit: number): RequestCommentRow[] =>
    Array.from({ length: count }, (_, index) => comment(count - index)).slice(0, limit);

  it('comments reach the page oldest first, cut at the limit', () => {
    expect(REQUEST_COMMENT_LIMIT).toBe(200);
    // The route asks for one more than the page carries.
    const many = toComments(newestFirst(201, REQUEST_COMMENT_LIMIT + 1), NAMES, true);
    expect(many.items).toHaveLength(200);
    expect(many.truncated).toBe(true);
    // The oldest one is the one left out; the newest is the last on the page.
    expect(many.items.at(0)?.body).toBe('Yorum 2');
    expect(many.items.at(-1)?.body).toBe('Yorum 201');
    expect(many.items.map((item) => item.createdAt)).toEqual(
      many.items.map((item) => item.createdAt).sort(),
    );

    const exact = toComments(newestFirst(200, REQUEST_COMMENT_LIMIT + 1), NAMES, true);
    expect([exact.items.length, exact.truncated]).toEqual([200, false]);
    expect(exact.items.at(0)?.body).toBe('Yorum 1');

    expect(toComments(newestFirst(2, REQUEST_COMMENT_LIMIT + 1), NAMES, false)).toEqual({
      items: [
        {
          id: id(1001),
          author: { userId: id(900), name: 'Çalışan' },
          body: 'Yorum 1',
          createdAt: '2026-10-08T09:00:01.000Z',
        },
        {
          id: id(1002),
          author: { userId: id(900), name: 'Çalışan' },
          body: 'Yorum 2',
          createdAt: '2026-10-08T09:00:02.000Z',
        },
      ],
      truncated: false,
      mayWrite: false,
    });
    expect(toComments([], NAMES, true)).toEqual({ items: [], truncated: false, mayWrite: true });
  });

  it('an author who is no longer a member keeps the comment and loses the name', () => {
    const { items } = toComments([comment(1, id(901))], NAMES, false);
    expect(items).toEqual([
      {
        id: id(1001),
        author: { userId: id(901), name: null },
        body: 'Yorum 1',
        createdAt: '2026-10-08T09:00:01.000Z',
      },
    ]);
    expect(requestCommentSchema.safeParse(items[0]).success).toBe(true);
  });

  it('does not change the rows it was given', () => {
    const rows = newestFirst(3, 10);
    const before = rows.map((row) => row.id);
    toComments(rows, NAMES, true);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

// The project of a request, the permission of that project and who stands in for a requester
// (8 October decisions 45 to 49), as the answers carry them.
describe('the project, the permission and the stand-in of a request as the panel reads them', () => {
  const NOON = new Date('2026-10-08T09:00:00.000Z');
  const ago = (ms: number): Date => new Date(NOON.getTime() - ms);
  const FOUNDER: Reader = { userId: id(901), role: 'founder' };
  const PEOPLE = new Map([
    [id(900), 'Çalışan'],
    [id(901), 'Kurucu'],
  ]);
  const summaryOf = (overrides: Partial<RequestRow>, reader: Reader = READER) =>
    requestSummarySchema.parse(toSummary(row(overrides), reader, PEOPLE, NOON));

  it('a summary names the project of the request, and none for a request without one', () => {
    expect(summaryOf({}).project).toBeNull();
    expect(summaryOf({ project_id: id(31), project_name: 'Lansman' }).project).toEqual({
      id: id(31),
      name: 'Lansman',
    });
  });

  it('a request held by a closed permission is the founder’s, whatever its row says was called for', () => {
    const routed: Partial<RequestRow> = {
      status: 'in_progress',
      project_id: id(31),
      project_name: 'Lansman',
      routed: true,
      step_agent_code: 'SOS-2',
      step_agent_name: 'Sosyal İçerik Yazım Ajanı',
      step_agent_enabled: true,
      step_approver_user_id: id(900),
      step_created_at: ago(5_000),
    };
    expect(factsOf(row(routed))).toMatchObject({ agentsMayWork: true, requesterReads: true });
    const held = summaryOf({ ...routed, agents_may_work: false }, FOUNDER);
    expect([held.stage, held.cause, held.turn, held.waitingForMe]).toEqual([
      'fell_to_person',
      'ai_permission_closed',
      { kind: 'founder' },
      true,
    ]);
    // For the appointed approver of the step it is not their turn: only the founder opens it.
    expect(summaryOf({ ...routed, agents_may_work: false }).waitingForMe).toBe(false);
    // With the permission open the same row reads as work.
    expect(summaryOf(routed, FOUNDER).stage).toBe('working');
  });

  // 8 October decision 17.
  it('a request held by a reached spending limit is the founder’s, also when the step has an approver', () => {
    const routed: Partial<RequestRow> = {
      status: 'in_progress',
      project_id: id(31),
      project_name: 'Lansman',
      routed: true,
      step_agent_code: 'SOS-2',
      step_agent_name: 'Sosyal İçerik Yazım Ajanı',
      step_agent_enabled: true,
      step_approver_user_id: id(900),
      step_created_at: ago(5_000),
    };
    expect(factsOf(row(routed))).toMatchObject({ spendingLimitReached: false });
    expect(factsOf(row({ ...routed, spending_limit_reached: true }))).toMatchObject({
      spendingLimitReached: true,
      agentsMayWork: true,
    });
    const held = summaryOf({ ...routed, spending_limit_reached: true }, FOUNDER);
    expect([held.stage, held.cause, held.turn, held.waitingForMe]).toEqual([
      'fell_to_person',
      'spending_limit_reached',
      { kind: 'founder' },
      true,
    ]);
    // For the appointed approver of the step it is not their turn: only the founder raises it.
    expect(summaryOf({ ...routed, spending_limit_reached: true }).waitingForMe).toBe(false);
    // Before any routing too.
    const unrouted = summaryOf(
      { project_id: id(31), project_name: 'Lansman', spending_limit_reached: true },
      FOUNDER,
    );
    expect([unrouted.stage, unrouted.cause, unrouted.waitingForMe]).toEqual([
      'fell_to_person',
      'spending_limit_reached',
      true,
    ]);
    // Under the limit the same row reads as work.
    expect(summaryOf(routed, FOUNDER).stage).toBe('working');
  });

  it('a restart is the latest call for the work', () => {
    const stopped: Partial<RequestRow> = {
      status: 'in_progress',
      routed: true,
      step_agent_code: 'SOS-2',
      step_agent_name: 'Sosyal İçerik Yazım Ajanı',
      step_agent_enabled: true,
      step_created_at: ago(60_000),
      run_agent_code: 'SOS-2',
      run_status: 'stopped',
      run_error_code: 'agent_stopped',
      run_started_at: ago(30_000),
    };
    expect(factsOf(row(stopped)).awaitedSince).toEqual(ago(60_000));
    expect(summaryOf(stopped).cause).toBe('agent_stopped');
    // The restart is later than the routing, the change request and the stopped run.
    const restarted = { ...stopped, restarted_at: ago(1_000) };
    expect(factsOf(row(restarted)).awaitedSince).toEqual(ago(1_000));
    expect(
      factsOf(row({ ...restarted, last_change_request_at: ago(40_000) })).awaitedSince,
    ).toEqual(ago(1_000));
    expect([summaryOf(restarted).stage, summaryOf(restarted).cause]).toEqual(['working', null]);
    // An old restart does not hide a later change request.
    expect(
      factsOf(row({ ...stopped, restarted_at: ago(50_000), last_change_request_at: ago(40_000) }))
        .awaitedSince,
    ).toEqual(ago(40_000));
    // Before any routing the restart is the only call beside the opening.
    expect(factsOf(row({ restarted_at: ago(1_000) })).awaitedSince).toEqual(ago(1_000));
    expect(factsOf(row({})).awaitedSince).toBeNull();
  });

  it('a result that waits for a requester who cannot read the request waits for the founder', () => {
    const waiting: Partial<RequestRow> = {
      status: 'awaiting_approval',
      routed: true,
      pending_acceptance: true,
    };
    const own = summaryOf(waiting);
    expect([own.stage, own.turn, own.waitingForMe]).toEqual([
      'requester_approval',
      { kind: 'person', userId: id(900), name: 'Çalışan' },
      true,
    ]);
    expect(summaryOf(waiting, FOUNDER).waitingForMe).toBe(false);
    const absent = { ...waiting, requester_reads: false };
    const forFounder = summaryOf(absent, FOUNDER);
    expect([forFounder.stage, forFounder.turn, forFounder.waitingForMe]).toEqual([
      'requester_approval',
      { kind: 'founder' },
      true,
    ]);
    // Who asked never changes.
    expect(forFounder.requester).toEqual({ userId: id(900), name: 'Çalışan' });
    // An employee who reads the request is not asked.
    expect(summaryOf(absent, { userId: id(902), role: 'employee' }).waitingForMe).toBe(false);
  });

  const approval = (overrides: Partial<ResultApprovalRow> = {}): ResultApprovalRow => ({
    id: id(2),
    task_id: id(1),
    request_title: 'LinkedIn için gönderi yaz',
    requester_user_id: id(900),
    project_id: null,
    project_name: null,
    agents_may_work: true,
    spending_limit_reached: false,
    agent_code: 'SOS-2',
    agent_name: 'Sosyal İçerik Yazım Ajanı',
    attempt: 1,
    status: 'pending',
    created_at: ago(5_000),
    decided_at: null,
    decided_by_user_id: null,
    rejection_reason: null,
    decision_reason: null,
    invalidated_at: null,
    title: 'Sonuç',
    summary: null,
    agent_rationale: null,
    risk_note: null,
    payload: {},
    selected_option: null,
    involves_money: false,
    goes_external: false,
    needs_step_up: false,
    may_decide: true,
    ...overrides,
  });

  it('an approval card names the project and says whether agents may work', () => {
    const plain = approvalCardSchema.parse(toApprovalCard(approval(), PEOPLE));
    expect([plain.project, plain.agentsMayWork]).toEqual([null, true]);
    const held = approvalCardSchema.parse(
      toApprovalCard(
        approval({ project_id: id(31), project_name: 'Lansman', agents_may_work: false }),
        PEOPLE,
      ),
    );
    expect([held.project, held.agentsMayWork]).toEqual([{ id: id(31), name: 'Lansman' }, false]);
  });

  it('an approval card says whether the spending limit of its project is reached', () => {
    expect(approvalCardSchema.parse(toApprovalCard(approval(), PEOPLE)).spendingLimitReached).toBe(
      false,
    );
    const atLimit = approvalCardSchema.parse(
      toApprovalCard(
        approval({ project_id: id(31), project_name: 'Lansman', spending_limit_reached: true }),
        PEOPLE,
      ),
    );
    // The limit holds no result back: agents may work, and the card can be decided.
    expect([atLimit.spendingLimitReached, atLimit.agentsMayWork]).toEqual([true, true]);
  });

  const acceptance = (overrides: Partial<AcceptanceRow> = {}): AcceptanceRow => ({
    id: id(3),
    task_id: id(1),
    request_title: 'LinkedIn için gönderi yaz',
    requester_user_id: id(900),
    round: 1,
    status: 'approved',
    created_at: ago(5_000),
    decided_at: ago(1_000),
    invalidated_at: null,
    rejection_reason: null,
    decision_reason: null,
    approval_id: id(2),
    decided_by_user_id: id(900),
    reader_stands_in: false,
    agents_may_work: true,
    spending_limit_reached: false,
    returns_to_agent: true,
    ...overrides,
  });
  const journeyOf = (row: AcceptanceRow) => {
    const rows = { routings: [], runs: [], steps: [], approvals: [], acceptances: [row] };
    return {
      items: toJourney(rows, PEOPLE).map((item) => journeyItemSchema.parse(item)),
      people: peopleOfJourney(rows),
    };
  };

  it('the journey names who answered only when it was not the requester', () => {
    // The requester's own answer, and an answer from before the record said who decided.
    for (const decidedBy of [id(900), null]) {
      expect(journeyOf(acceptance({ decided_by_user_id: decidedBy })).items).toEqual([
        expect.objectContaining({ kind: 'acceptance', status: 'approved', decidedBy: null }),
      ]);
    }
    // The founder, in the requester's place: named, and among the people whose names are read.
    const standIn = journeyOf(
      acceptance({ decided_by_user_id: id(901), status: 'changes_requested' }),
    );
    expect(standIn.items).toEqual([
      expect.objectContaining({
        kind: 'acceptance',
        status: 'changes_requested',
        decidedBy: { userId: id(901), name: 'Kurucu' },
      }),
    ]);
    expect(standIn.people).toContain(id(901));
    // While it waits nobody has decided.
    expect(
      journeyOf(acceptance({ status: 'pending', decided_at: null, decided_by_user_id: null }))
        .items,
    ).toEqual([expect.objectContaining({ status: 'pending', decidedBy: null })]);
  });
});
