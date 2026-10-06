// Ported from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/InlineBanner.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: colors from the --status-* tokens with the text in the normal ink color (the tinted,
// 90% opaque body text of the source fails AA); a role prop so an error can be announced; no
// phone breakpoints.
import { CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BannerTone = 'info' | 'warning' | 'danger';

const TONE: Record<BannerTone, { icon: LucideIcon; box: string; iconColor: string }> = {
  info: {
    icon: Info,
    box: 'border-status-in-progress bg-status-in-progress-fill',
    iconColor: 'text-status-in-progress',
  },
  warning: {
    icon: TriangleAlert,
    box: 'border-status-open bg-status-open-fill',
    iconColor: 'text-status-open',
  },
  danger: {
    icon: CircleAlert,
    box: 'border-status-error bg-status-error-fill',
    iconColor: 'text-status-error',
  },
};

/**
 * A notice inside the page: `info` for context, `warning` for attention, `danger` for failures.
 * It is a note by default; pass role="alert" for an error that has just happened and
 * role="status" for a result that should be announced politely.
 * Text on the fill is the normal ink. A link inside the banner uses text-brand-active, and a
 * button in `actions` is the outline button: text-brand and the destructive button are below
 * 4.5:1 on some fills (index.css, tokens.test.ts).
 */
export function InlineBanner({
  tone = 'info',
  title,
  children,
  icon,
  actions,
  compact = false,
  role = 'note',
  className,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Replaces the icon of the tone; `false` leaves it out. */
  icon?: LucideIcon | false;
  /** Buttons or links on the right. */
  actions?: ReactNode;
  /** Denser padding, for use inside dialogs. */
  compact?: boolean;
  role?: 'note' | 'status' | 'alert';
  className?: string;
}) {
  const spec = TONE[tone];
  const Icon = icon === false ? null : (icon ?? spec.icon);
  // A message without a title next to a button: its first line and the icon are centred on the
  // 32 px button instead of sitting at its top edge. Longer text still starts at the top.
  const besideActions = Boolean(actions) && !title;
  return (
    <div
      role={role}
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border text-ink',
        compact ? 'p-3' : 'p-4',
        spec.box,
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <Icon
            aria-hidden="true"
            className={cn('size-4 shrink-0', besideActions ? 'mt-2' : 'mt-0.5', spec.iconColor)}
          />
        ) : null}
        <div className={cn('flex min-w-0 flex-col gap-1 text-sm', besideActions && 'py-1.5')}>
          {title ? <p className="leading-tight font-medium">{title}</p> : null}
          {children ? <div className="leading-snug">{children}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
