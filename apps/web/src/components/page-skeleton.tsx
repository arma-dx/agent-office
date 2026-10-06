// Adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/PageSkeleton.tsx (the "list" variant) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: announced to screen readers; only the list shape, with rows in the rhythm of our list
// row (36 px, touching) instead of 44 px blocks; no phone breakpoints.
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Width of the title bar in each row; uneven so the block reads as a list, not as a table. */
const ROW_TITLE_WIDTHS = ['w-2/5', 'w-3/5', 'w-1/2', 'w-1/3', 'w-3/5', 'w-2/5', 'w-1/2'] as const;

/**
 * Loading state in the shape of a list screen: a toolbar line, then rows that take exactly the
 * space of ListRow rows, so the page does not move when the data arrives. Static blocks, no
 * animation. Other shapes (a detail page) are added with the first page that needs them.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Yükleniyor</span>
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-44" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="flex flex-col">
        {ROW_TITLE_WIDTHS.map((width, row) => (
          // The rows never change, so their position is a stable key.
          <div key={row} className="flex h-9 items-center gap-2 px-2">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className={cn('h-4', width)} />
          </div>
        ))}
      </div>
    </div>
  );
}
