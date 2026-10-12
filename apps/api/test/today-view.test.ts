import type { NotificationRow, RequestRow } from '@agent-office/db';
import {
  requestStageSchema,
  todayNotificationSchema,
  type RequestStage,
  type RequestSummary,
} from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { expectedKind, toNotification } from '../src/today-view.ts';

// What the Bugün screen is made of (8 October decisions 7 and 8), without a database: which
// requests expect something of the reader, and what of a notification row reaches the panel.

const AT = new Date('2026-10-08T09:00:00.000Z');
const REQUEST = '00000000-0000-4000-8000-000000000001';
const NOTE = '00000000-0000-4000-8000-000000000002';

function summary(stage: RequestStage, waitingForMe: boolean): RequestSummary {
  return {
    id: REQUEST,
    title: 'LinkedIn için gönderi yaz',
    status: 'in_progress',
    stage,
    cause: null,
    delayed: false,
    turn: { kind: 'founder' },
    waitingForMe,
    unit: null,
    requester: { userId: REQUEST, name: null },
    project: null,
    createdAt: AT.toISOString(),
    updatedAt: AT.toISOString(),
    dueDate: null,
    overdue: false,
  };
}

// Only this fact of the row is read; everything else comes from the summary.
const row = (readerMayDecide: boolean): RequestRow =>
  ({ reader_may_decide: readerMayDecide }) as RequestRow;

function note(overrides: Partial<NotificationRow>): NotificationRow {
  return {
    id: NOTE,
    template: 'request_stopped',
    created_at: AT,
    read: false,
    request_id: REQUEST,
    request_title: 'LinkedIn için gönderi yaz',
    unit_code: null,
    unit_name: null,
    ...overrides,
  };
}

describe('what a request expects of the reader', () => {
  it('a request expects a decision, an acceptance, an answer or a look, or nothing', () => {
    const cases: [RequestStage, boolean, boolean, ReturnType<typeof expectedKind>][] = [
      // A result the reader may decide: the appointed approver, whose turn it is, and the founder,
      // who may decide while somebody else is appointed.
      ['unit_approval', true, true, 'approval'],
      ['unit_approval', false, true, 'approval'],
      // The requester and every other reader of a result that waits for its approver.
      ['unit_approval', false, false, null],
      ['unit_approval', true, false, null],
      // The approved result waits for its requester alone, also for a reader who may decide.
      ['requester_approval', true, false, 'acceptance'],
      ['requester_approval', true, true, 'acceptance'],
      ['requester_approval', false, true, null],
      ['requester_approval', false, false, null],
      // An agent's question: the one who answers (the requester, or the founder while the
      // requester cannot read the request), and nobody else, whatever they may decide.
      ['awaiting_reply', true, false, 'answer'],
      ['awaiting_reply', true, true, 'answer'],
      ['awaiting_reply', false, true, null],
      ['awaiting_reply', false, false, null],
      // A request that fell to a person: the one whose turn it is.
      ['fell_to_person', true, true, 'fallen'],
      ['fell_to_person', true, false, 'fallen'],
      ['fell_to_person', false, true, null],
      ['fell_to_person', false, false, null],
    ];
    for (const [stage, waitingForMe, mayDecide, kind] of cases) {
      expect(
        expectedKind(row(mayDecide), summary(stage, waitingForMe)),
        `${stage} ${String(waitingForMe)} ${String(mayDecide)}`,
      ).toBe(kind);
    }
    // Every other stage expects nothing of anybody, whatever the reader may do.
    const others = requestStageSchema.options.filter(
      (stage) =>
        !['unit_approval', 'requester_approval', 'awaiting_reply', 'fell_to_person'].includes(
          stage,
        ),
    );
    expect(others).toEqual(expect.arrayContaining(['routing', 'working', 'revising', 'done']));
    expect(others).toContain('cancelled');
    for (const stage of others) {
      for (const waitingForMe of [true, false]) {
        expect(expectedKind(row(true), summary(stage, waitingForMe)), stage).toBeNull();
      }
    }
  });
});

describe('a notification as the panel reads it', () => {
  const base = { id: NOTE, createdAt: AT.toISOString(), read: false };
  const request = { id: REQUEST, title: 'LinkedIn için gönderi yaz' };

  it('a notification row becomes a template and ids, or nothing', () => {
    expect(toNotification(note({ template: 'request_stopped' }))).toEqual({
      ...base,
      template: 'request_stopped',
      request,
    });
    expect(toNotification(note({ template: 'request_rejected', read: true }))).toEqual({
      ...base,
      read: true,
      template: 'request_rejected',
      request,
    });
    expect(
      toNotification(
        note({ template: 'request_returned', unit_code: 'HUK', unit_name: 'Hukuk ve Uyum' }),
      ),
    ).toEqual({
      ...base,
      template: 'request_returned',
      request,
      unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
    });
    // The unit is gone: the return is still told.
    expect(toNotification(note({ template: 'request_returned' }))).toEqual({
      ...base,
      template: 'request_returned',
      request,
      unit: null,
    });
    // A passkey reset is about no request, also when the row names one.
    expect(toNotification(note({ template: 'passkeys_reset' }))).toEqual({
      ...base,
      template: 'passkeys_reset',
    });
    expect(
      toNotification(note({ template: 'passkeys_reset', request_id: null, request_title: null })),
    ).toEqual({ ...base, template: 'passkeys_reset' });
    // Only a return names a unit.
    expect(
      toNotification(
        note({ template: 'request_stopped', unit_code: 'HUK', unit_name: 'Hukuk ve Uyum' }),
      ),
    ).toEqual({ ...base, template: 'request_stopped', request });

    // A flow notification without its request, and a template the panel has no sentence for.
    for (const template of ['request_returned', 'request_rejected', 'request_stopped']) {
      expect(
        toNotification(note({ template, request_id: null, request_title: null })),
        template,
      ).toBeNull();
    }
    for (const template of ['task_assigned', 'approval_pending', 'daily_summary', '']) {
      expect(toNotification(note({ template })), template).toBeNull();
    }
  });

  it('every notification it builds is one the contract accepts, with no text but the title and the unit', () => {
    for (const template of ['request_returned', 'request_rejected', 'request_stopped']) {
      const built = toNotification(
        note({ template, unit_code: 'HUK', unit_name: 'Hukuk ve Uyum' }),
      );
      expect(todayNotificationSchema.parse(built)).toEqual(built);
      const texts = JSON.stringify(built, (key, value: unknown) =>
        ['id', 'createdAt', 'template', 'code'].includes(key) ? undefined : value,
      );
      expect(JSON.parse(texts)).toEqual({
        read: false,
        request: { title: 'LinkedIn için gönderi yaz' },
        ...(template === 'request_returned' ? { unit: { name: 'Hukuk ve Uyum' } } : {}),
      });
    }
    const reset = toNotification(note({ template: 'passkeys_reset' }));
    expect(todayNotificationSchema.parse(reset)).toEqual(reset);
  });
});
