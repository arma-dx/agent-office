// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/components/EmptyState.tsx (the page layout: centered, py-16, text capped at
// max-w-md) at commit dd868ed125cd709506dd9b29fca640a44d580501.
// License text: THIRD_PARTY_NOTICES.md.
// Changes: only that layout was taken, as the "page" variant of our EmptyState; no large icon; the
// action is any node (a typed link or a button) instead of a label with a callback.
import type { ReactNode } from 'react';
import { InlineBanner } from '@/components/inline-banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * An empty screen shows the first step (CLAUDE.md, interface texts). `section` is a bordered box
 * inside a page section; `page` fills an otherwise empty page, centered and without a box.
 */
export function EmptyState({
  title,
  description,
  action,
  variant = 'section',
}: {
  title: string;
  description: string;
  action?: ReactNode;
  variant?: 'section' | 'page';
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-2',
        variant === 'page'
          ? 'items-center py-16 text-center'
          : 'items-start rounded-lg border border-line bg-surface p-6',
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-ink-secondary">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}

/** An error message says what happened and how to fix it. */
export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <InlineBanner
      tone="danger"
      role="alert"
      actions={
        onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            Yeniden dene
          </Button>
        ) : undefined
      }
    >
      {message}
    </InlineBanner>
  );
}

/** Loading state of a section; also announced to screen readers. */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
