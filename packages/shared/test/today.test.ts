import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_LIST_LIMIT,
  REQUEST_NOTIFICATION_TEMPLATES,
  markNotificationsReadSchema,
  notificationTemplateSchema,
  sidebarCountsSchema,
  todayNotificationSchema,
  todaySchema,
} from '../src/today.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-08T09:00:00.000Z';

const SUMMARY = {
  id: uuid(1),
  title: 'LinkedIn için gönderi yaz',
  status: 'awaiting_approval',
  stage: 'unit_approval',
  cause: null,
  delayed: false,
  turn: { kind: 'founder' },
  waitingForMe: true,
  unit: { code: 'SOS', name: 'Sosyal Medya' },
  requester: { userId: uuid(2), name: 'Ada Yılmaz' },
  project: null,
  createdAt: AT,
  updatedAt: AT,
  dueDate: null,
  overdue: false,
};
const REQUEST = { id: uuid(1), title: 'LinkedIn için gönderi yaz' };
const base = (n: number) => ({ id: uuid(n), createdAt: AT, read: false });

describe('the answer of the Bugün screen', () => {
  it('the Bugün answer carries request summaries and notifications of the four templates', () => {
    const answer = {
      expected: [SUMMARY],
      expectedTruncated: false,
      notifications: [
        {
          ...base(10),
          template: 'request_returned',
          request: REQUEST,
          unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
        },
        { ...base(11), template: 'request_rejected', request: REQUEST },
        { ...base(12), template: 'request_stopped', request: REQUEST, read: true },
        { ...base(13), template: 'passkeys_reset' },
      ],
      notificationsTruncated: false,
    };
    expect(todaySchema.parse(answer)).toEqual(answer);

    const refused = (notification: unknown): boolean =>
      !todayNotificationSchema.safeParse(notification).success;
    // A template the panel has no sentence for.
    expect(refused({ ...base(14), template: 'task_assigned', request: REQUEST })).toBe(true);
    // A flow notification is about a request.
    expect(refused({ ...base(15), template: 'request_stopped' })).toBe(true);
    expect(refused({ ...base(15), template: 'request_rejected' })).toBe(true);
    // The unit of a return is stated, also when it is gone.
    expect(
      todayNotificationSchema.safeParse({
        ...base(16),
        template: 'request_returned',
        request: REQUEST,
        unit: null,
      }).success,
    ).toBe(true);
    expect(refused({ ...base(17), template: 'request_returned', request: REQUEST })).toBe(true);
    // A passkey reset is about no request.
    expect(todayNotificationSchema.parse({ ...base(18), template: 'passkeys_reset' })).toEqual({
      ...base(18),
      template: 'passkeys_reset',
    });
    // Every notification says whether it was read.
    expect(refused({ id: uuid(19), createdAt: AT, template: 'passkeys_reset' })).toBe(true);
  });

  it("the flow's templates and the reset are every template the panel knows", () => {
    expect(notificationTemplateSchema.options).toEqual([
      ...REQUEST_NOTIFICATION_TEMPLATES,
      'passkeys_reset',
    ]);
    expect(REQUEST_NOTIFICATION_TEMPLATES).toEqual([
      'request_returned',
      'request_rejected',
      'request_stopped',
    ]);
  });
});

describe('the counts of the sidebar', () => {
  it('the counts are whole numbers that are never negative', () => {
    expect(sidebarCountsSchema.parse({ today: 3, approvals: 2 })).toEqual({
      today: 3,
      approvals: 2,
    });
    for (const counts of [
      { today: -1, approvals: 0 },
      { today: 1, approvals: -1 },
      { today: 1.5, approvals: 0 },
      { today: 1 },
      { approvals: 1 },
    ]) {
      expect(sidebarCountsSchema.safeParse(counts).success).toBe(false);
    }
  });
});

describe('the read mark a person sends', () => {
  it('a read mark names one to a hundred notifications and nothing else', () => {
    expect(markNotificationsReadSchema.parse({ ids: [uuid(1)] })).toEqual({ ids: [uuid(1)] });
    const many = (count: number): string[] => Array.from({ length: count }, (_, n) => uuid(n));
    expect(
      markNotificationsReadSchema.safeParse({ ids: many(NOTIFICATION_LIST_LIMIT) }).success,
    ).toBe(true);
    for (const body of [
      {},
      { ids: [] },
      { ids: many(NOTIFICATION_LIST_LIMIT + 1) },
      { ids: ['x'] },
      { ids: [uuid(1)], all: true },
    ]) {
      expect(markNotificationsReadSchema.safeParse(body).success).toBe(false);
    }
  });
});
