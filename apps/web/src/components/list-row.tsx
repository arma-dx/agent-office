import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A single row in lists: title, secondary info below it, status or action on the right. Separated by a line. */
export function ListRow({
  title,
  subtitle,
  trailing,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        'flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle ? <span className="truncate text-sm text-ink-secondary">{subtitle}</span> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </li>
  );
}
