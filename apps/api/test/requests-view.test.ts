import type { RequestCommentRow, RequestRow } from '@agent-office/db';
import {
  REQUEST_COMMENT_LIMIT,
  requestCommentSchema,
  requestSummarySchema,
} from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { toComments, toSummary, type Reader } from '../src/requests-view.ts';

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
