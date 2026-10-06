// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/StatusGlyph.tsx and the task chip of ui/src/components/StatusBadge.tsx
// (lines 86-101) at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: one icon and one badge for task, approval and run statuses; typed statuses with Turkish
// labels from lib/status.ts instead of string keys with a fallback; colors from the --status-*
// tokens through classes instead of an inline style; no spinning (decision U1 is open).
import { statusSpec, type StatusRef, type StatusTone } from '@/lib/status';
import { cn } from '@/lib/utils';

const ICON_SIZE = { sm: 14, md: 16, lg: 20 } as const;

const ICON_TONE: Record<StatusTone, string> = {
  open: 'text-status-open',
  'in-progress': 'text-status-in-progress',
  'awaiting-approval': 'text-status-awaiting-approval',
  'awaiting-reply': 'text-status-awaiting-reply',
  done: 'text-status-done',
  cancelled: 'text-status-cancelled',
  error: 'text-status-error',
};

const BADGE_TONE: Record<StatusTone, string> = {
  open: 'border-status-open bg-status-open-fill text-status-open-text',
  'in-progress':
    'border-status-in-progress bg-status-in-progress-fill text-status-in-progress-text',
  'awaiting-approval':
    'border-status-awaiting-approval bg-status-awaiting-approval-fill text-status-awaiting-approval-text',
  'awaiting-reply':
    'border-status-awaiting-reply bg-status-awaiting-reply-fill text-status-awaiting-reply-text',
  done: 'border-status-done bg-status-done-fill text-status-done-text',
  cancelled: 'border-status-cancelled bg-status-cancelled-fill text-status-cancelled-text',
  error: 'border-status-error bg-status-error-fill text-status-error-text',
};

/**
 * The icon of a status. Next to its label it is decorative; alone (`labelled`) it is announced
 * with the status label. The shape carries the status, the color only repeats it.
 */
export function StatusIcon({
  size = 'md',
  labelled = false,
  className,
  ...ref
}: StatusRef & { size?: keyof typeof ICON_SIZE; labelled?: boolean; className?: string }) {
  const spec = statusSpec(ref);
  const Icon = spec.icon;
  return (
    <Icon
      size={ICON_SIZE[size]}
      className={cn('inline-block shrink-0 align-middle', ICON_TONE[spec.tone], className)}
      {...(labelled ? { role: 'img', 'aria-label': spec.label } : { 'aria-hidden': true })}
    />
  );
}

/** The status as a badge: icon and label on the status fill. */
export function StatusBadge({ className, ...ref }: StatusRef & { className?: string }) {
  const spec = statusSpec(ref);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none whitespace-nowrap',
        BADGE_TONE[spec.tone],
        className,
      )}
    >
      <StatusIcon {...ref} size="sm" />
      {spec.label}
    </span>
  );
}
