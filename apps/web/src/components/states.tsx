import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

/** An empty screen shows the first step (CLAUDE.md, interface texts). */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-ink-secondary">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}

/** An error message says what happened and how to fix it. */
export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-error/40 bg-surface p-4"
    >
      <p className="text-sm text-error">{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Yeniden dene
        </Button>
      ) : null}
    </div>
  );
}

/** Loading state; also announced to screen readers. */
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
