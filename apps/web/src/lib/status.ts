// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/StatusGlyph.tsx (the in-progress glyph, lines 51-55, and the icon per
// status) at commit dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: our task, approval, run and project statuses with Turkish labels and color roles.
import {
  PROJECT_STATUSES,
  TASK_STATUSES,
  type ProjectStatus,
  type TaskStatus,
} from '@agent-office/shared';
import {
  Ban,
  Circle,
  CircleAlert,
  CircleArrowLeft,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleQuestionMark,
  CircleStop,
  CircleX,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * The status language: every task, approval, run and project status has one icon, one color and
 * one label, the same on every screen (5 October 2026, decision 11). The values are the ones the
 * database holds (supabase/migrations: tasks, approvals, runs, projects).
 */
// One list for the API and the panel: the task and project statuses come from the shared contract.
export { PROJECT_STATUSES, TASK_STATUSES, type ProjectStatus, type TaskStatus };

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

// The run labels are proposals the founder has not answered yet (docs/SONRA.md, U22).
export const RUN_STATUS = {
  running: { label: 'Sürüyor', icon: ProgressCircle, tone: 'in-progress' },
  completed: { label: 'Tamamlandı', icon: CircleCheck, tone: 'done' },
  failed: { label: 'Hata', icon: CircleAlert, tone: 'error' },
  limit_reached: { label: 'Sınıra takıldı', icon: CircleMinus, tone: 'error' },
  stopped: { label: 'Durduruldu', icon: CircleStop, tone: 'cancelled' },
} as const satisfies Record<RunStatus, StatusSpec>;

/**
 * The five project statuses (8 October 2026, decision 17). A word the language already has keeps
 * its sign: "Sürüyor", "Tamamlandı" and "İptal" are drawn as for a task. "Planlandı" (accepted,
 * not started) takes the open circle, under the word the founder chose for projects; "Beklemede"
 * (parked: not started and waiting for nobody) takes a dashed circle in the neutral tone, a sign
 * no other status uses. A project status is always drawn as the badge, icon and word together,
 * never as an icon alone in the leading place of a row: that place is the project's tile. The
 * signs are a proposal awaiting the founder (docs/SONRA.md, P1-l).
 */
export const PROJECT_STATUS = {
  backlog: { label: 'Beklemede', icon: CircleDashed, tone: 'cancelled' },
  planned: { label: 'Planlandı', icon: Circle, tone: 'open' },
  in_progress: { label: 'Sürüyor', icon: ProgressCircle, tone: 'in-progress' },
  completed: { label: 'Tamamlandı', icon: CircleCheck, tone: 'done' },
  cancelled: { label: 'İptal', icon: Ban, tone: 'cancelled' },
} as const satisfies Record<ProjectStatus, StatusSpec>;

/** A status together with the kind of record it belongs to. */
export type StatusRef =
  | { kind: 'task'; status: TaskStatus }
  | { kind: 'approval'; status: ApprovalStatus }
  | { kind: 'run'; status: RunStatus }
  | { kind: 'project'; status: ProjectStatus };

export function statusSpec(ref: StatusRef): StatusSpec {
  switch (ref.kind) {
    case 'task':
      return TASK_STATUS[ref.status];
    case 'approval':
      return APPROVAL_STATUS[ref.status];
    case 'run':
      return RUN_STATUS[ref.status];
    case 'project':
      return PROJECT_STATUS[ref.status];
  }
}
