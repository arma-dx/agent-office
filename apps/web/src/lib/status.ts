// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/StatusGlyph.tsx (the in-progress glyph, lines 51-55, and the icon per
// status) at commit dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: our task, approval and run statuses with Turkish labels and color roles.
import {
  Ban,
  Circle,
  CircleAlert,
  CircleArrowLeft,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleQuestionMark,
  CircleStop,
  CircleX,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * The status language: every task, approval and run status has one icon, one color and one label,
 * the same on every screen (5 October 2026, decision 11). The values are the ones the database
 * holds (supabase/migrations: tasks, approvals, runs).
 */
export const TASK_STATUSES = [
  'open',
  'in_progress',
  'awaiting_approval',
  'awaiting_reply',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RUN_STATUSES = ['running', 'completed', 'failed', 'limit_reached', 'stopped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The color roles; each has three tokens in index.css: --status-<tone>, -fill and -text. */
export const STATUS_TONES = [
  'open',
  'in-progress',
  'awaiting-approval',
  'awaiting-reply',
  'done',
  'cancelled',
  'error',
] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusSpec {
  label: string;
  icon: LucideIcon;
  tone: StatusTone;
}

// From Paperclip's StatusGlyph: LoaderCircle draws its arc on a 9-unit radius; this keeps the open
// arc on the 10-unit circle the other status icons share, so the set reads as one family.
const ProgressCircle = createLucideIcon('ProgressCircle', [
  [
    'circle',
    { cx: '12', cy: '12', r: '10', pathLength: '100', strokeDasharray: '80 20', key: 'progress' },
  ],
]);

export const TASK_STATUS = {
  open: { label: 'Açık', icon: Circle, tone: 'open' },
  in_progress: { label: 'Sürüyor', icon: ProgressCircle, tone: 'in-progress' },
  awaiting_approval: { label: 'Onay bekliyor', icon: CircleDot, tone: 'awaiting-approval' },
  awaiting_reply: { label: 'Yanıt bekliyor', icon: CircleQuestionMark, tone: 'awaiting-reply' },
  done: { label: 'Tamamlandı', icon: CircleCheck, tone: 'done' },
  cancelled: { label: 'İptal', icon: Ban, tone: 'cancelled' },
} as const satisfies Record<TaskStatus, StatusSpec>;

export const APPROVAL_STATUS = {
  pending: { label: 'Bekliyor', icon: CircleDot, tone: 'awaiting-approval' },
  approved: { label: 'Onaylandı', icon: CircleCheck, tone: 'done' },
  changes_requested: { label: 'Düzeltme istendi', icon: CircleArrowLeft, tone: 'open' },
  rejected: { label: 'Reddedildi', icon: CircleX, tone: 'error' },
} as const satisfies Record<ApprovalStatus, StatusSpec>;

// The run labels are proposals: no document names them yet and the founder has not answered.
export const RUN_STATUS = {
  running: { label: 'Sürüyor', icon: ProgressCircle, tone: 'in-progress' },
  completed: { label: 'Tamamlandı', icon: CircleCheck, tone: 'done' },
  failed: { label: 'Hata', icon: CircleAlert, tone: 'error' },
  limit_reached: { label: 'Sınıra takıldı', icon: CircleMinus, tone: 'error' },
  stopped: { label: 'Durduruldu', icon: CircleStop, tone: 'cancelled' },
} as const satisfies Record<RunStatus, StatusSpec>;

/** A status together with the kind of record it belongs to. */
export type StatusRef =
  | { kind: 'task'; status: TaskStatus }
  | { kind: 'approval'; status: ApprovalStatus }
  | { kind: 'run'; status: RunStatus };

export function statusSpec(ref: StatusRef): StatusSpec {
  switch (ref.kind) {
    case 'task':
      return TASK_STATUS[ref.status];
    case 'approval':
      return APPROVAL_STATUS[ref.status];
    case 'run':
      return RUN_STATUS[ref.status];
  }
}
