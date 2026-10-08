import {
  approvalCardSchema,
  requestDetailSchema,
  todayNotificationSchema,
  todaySchema,
  type ApprovalCard,
  type RequestDetail,
  type RequestSummary,
  type Today,
  type TodayNotification,
} from '@agent-office/shared';
import { USER_ID } from './mock-api.ts';

/** Fixtures of flow (A), checked against the shared contract so that they cannot drift from it. */

export const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
export const APPROVAL_ID = '22222222-2222-4222-8222-222222222222';
export const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const RUN_KOR = '44444444-4444-4444-8444-444444444444';
const RUN_SOS = '55555555-5555-4555-8555-555555555555';
const ROUTING = '66666666-6666-4666-8666-666666666666';
const AT = '2026-10-07T09:00:00.000Z';

const SOS_2 = { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' };
const KOR_1 = { code: 'KOR-1', name: 'Ofis Koordinatörü' };
export const EMPLOYEE = { userId: EMPLOYEE_ID, name: 'Ayşe Yılmaz' };
export const FOUNDER = { userId: USER_ID, name: 'Ömer Kadıoğlu' };

export const APPROVAL_CARD: ApprovalCard = approvalCardSchema.parse({
  id: APPROVAL_ID,
  requestId: REQUEST_ID,
  requestTitle: 'LinkedIn için gönderi yaz',
  requester: EMPLOYEE,
  agent: SOS_2,
  attempt: 1,
  createdAt: AT,
  title: 'Yeni ofis için LinkedIn gönderisi',
  summary: 'İki seçenek hazırlandı.',
  rationale: 'Kaynak olarak yalnızca talep metni kullanıldı. Marka dili notu henüz yok.',
  riskNote: null,
  options: [
    { code: 'A', text: 'İzmir ofisimiz açıldı.', hashtags: ['#izmir'] },
    { code: 'B', text: 'Artık İzmir’deyiz.', hashtags: [] },
  ],
  involvesMoney: false,
  moneyStatedBy: null,
  goesExternal: true,
  needsStepUp: true,
});

const JOURNEY: RequestDetail['journey'] = [
  {
    kind: 'run',
    id: RUN_KOR,
    at: AT,
    agent: KOR_1,
    status: 'completed',
    finishedAt: AT,
    durationMs: 4000,
    errorCode: null,
    summary: 'Talep Sosyal Medya birimine yönlendirildi; işi SOS-2 yürütecek.',
    agentText: null,
    steps: [{ tool: 'route_task', status: 'succeeded' }],
  },
  {
    kind: 'routing',
    id: ROUTING,
    at: AT,
    round: 1,
    unit: { code: 'SOS', name: 'Sosyal Medya' },
    agent: SOS_2,
    approver: null,
    by: null,
    reason: 'Sosyal medya gönderisi isteniyor.',
  },
  {
    kind: 'run',
    id: RUN_SOS,
    at: AT,
    agent: SOS_2,
    status: 'completed',
    finishedAt: AT,
    durationMs: 38_000,
    errorCode: null,
    summary: 'Sonuç onaya sunuldu: 2 seçenek.',
    agentText: null,
    steps: [{ tool: 'submit_for_approval', status: 'succeeded' }],
  },
];

/** A request as the API answers it; the default is the moment the unit's approver must decide. */
export function requestDetail(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return requestDetailSchema.parse({
    id: REQUEST_ID,
    title: 'LinkedIn için gönderi yaz',
    status: 'awaiting_approval',
    stage: 'unit_approval',
    cause: null,
    delayed: false,
    turn: { kind: 'founder' },
    waitingForMe: true,
    unit: { code: 'SOS', name: 'Sosyal Medya' },
    requester: EMPLOYEE,
    createdAt: AT,
    updatedAt: AT,
    dueDate: null,
    overdue: false,
    text: 'LinkedIn için gönderi yaz\nKaynak: İzmir ofisimiz 1 Ekim’de açıldı.',
    agent: SOS_2,
    approver: null,
    closure: null,
    journey: JOURNEY,
    approval: APPROVAL_CARD,
    result: null,
    acceptance: null,
    actions: { cancel: false, stop: true, reroute: true },
    comments: { items: [], truncated: false, mayWrite: false },
    serverTime: AT,
    ...overrides,
  });
}

/** The journey of the default request, for a test that changes one item of it. */
export const DEFAULT_JOURNEY = JOURNEY;

export const RESULT: NonNullable<RequestDetail['result']> = {
  approvalId: APPROVAL_ID,
  agent: SOS_2,
  title: 'Yeni ofis için LinkedIn gönderisi',
  option: { code: 'B', text: 'Artık İzmir’deyiz.', hashtags: [] },
  approvedBy: FOUNDER,
  approvedAt: AT,
};

export function summaryOf(detail: RequestDetail): RequestSummary {
  const {
    id,
    title,
    status,
    stage,
    cause,
    delayed,
    turn,
    waitingForMe,
    unit,
    requester,
    createdAt,
    updatedAt,
    dueDate,
    overdue,
  } = detail;
  return {
    id,
    title,
    status,
    stage,
    cause,
    delayed,
    turn,
    waitingForMe,
    unit,
    requester,
    createdAt,
    updatedAt,
    dueDate,
    overdue,
  };
}

/** GET /today as the API answers it; the default is a person nothing waits for. */
export function todayBody(overrides: Partial<Today> = {}): Today {
  return todaySchema.parse({
    expected: [],
    expectedTruncated: false,
    notifications: [],
    notificationsTruncated: false,
    ...overrides,
  });
}

/**
 * The four notifications the panel has a sentence for, unread, in the order the API lists them
 * (the newest first). A template and ids: the sentence is the panel's.
 */
export const RETURNED_NOTE: TodayNotification = todayNotificationSchema.parse({
  id: 'b1111111-1111-4111-8111-111111111111',
  template: 'request_returned',
  createdAt: '2026-10-08T09:00:00.000Z',
  read: false,
  request: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'KVKK metni' },
  unit: { code: 'HUK', name: 'Hukuk ve Uyum' },
});
export const REJECTED_NOTE: TodayNotification = todayNotificationSchema.parse({
  id: 'b2222222-2222-4222-8222-222222222222',
  template: 'request_rejected',
  createdAt: '2026-10-07T15:00:00.000Z',
  read: false,
  request: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Ekim duyurusu' },
});
export const STOPPED_NOTE: TodayNotification = todayNotificationSchema.parse({
  id: 'b3333333-3333-4333-8333-333333333333',
  template: 'request_stopped',
  createdAt: '2026-10-07T11:00:00.000Z',
  read: false,
  request: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Fuar davetiyesi' },
});
export const RESET_NOTE: TodayNotification = todayNotificationSchema.parse({
  id: 'b4444444-4444-4444-8444-444444444444',
  template: 'passkeys_reset',
  createdAt: '2026-10-06T10:00:00.000Z',
  read: false,
});
