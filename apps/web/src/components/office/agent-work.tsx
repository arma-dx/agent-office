import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { StatusIcon } from '@/components/status';
import { OFFICE_REQUEST_LIMIT } from '@agent-office/shared';
import { WORK_ROWS, type AgentWork } from '@/lib/office/model';
import { useCompany } from '@/lib/session';
import type { StatusRef } from '@/lib/status';
import { useRowFocus } from '@/lib/today/focus';

// The icon of each count: the one the desk and the legend show for the same condition.
const ROW_STATUS = {
  running: { kind: 'run', status: 'running' },
  awaitingApproval: { kind: 'task', status: 'awaiting_approval' },
  failed: { kind: 'run', status: 'failed' },
} as const satisfies Record<keyof AgentWork, StatusRef>;

const ROW = 'flex items-center gap-2 rounded-lg px-2 py-1.5';

/**
 * The open requests of the selected agent in this company, as the reader may see them: how many
 * it is working on, how many of its results wait for approval, how many fell to a person because
 * of its run. A count of one is a link to that request; the Talepler list cannot be filtered by
 * agent, so a larger count is a number alone.
 *
 * The numbers change by themselves every half minute. A row is keyed by where it leads, so a link
 * that would lead somewhere else is a new element; if it held the keyboard focus, the focus goes
 * to the heading of the list instead of falling to the page (useRowFocus).
 */
export function AgentWorkList({ work, truncated }: { work: AgentWork; truncated: boolean }) {
  const company = useCompany();
  const headingId = useId();
  const signature = WORK_ROWS.map(({ key }) => `${key}:${work[key].requestId ?? ''}`).join('|');
  const { headingRef, onFocusCapture, onBlurCapture } = useRowFocus(signature);
  return (
    <div className="flex flex-col gap-1">
      <h4 id={headingId} ref={headingRef} tabIndex={-1} className="font-medium">
        Açık talepleri
      </h4>
      {/* Pulled out by the padding of a row: the text of the rows lines up with the heading. */}
      <ul
        role="list"
        aria-labelledby={headingId}
        className="-mx-2 flex flex-col"
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
        {WORK_ROWS.map(({ key, label }) => {
          const { count, requestId } = work[key];
          const icon = <StatusIcon {...ROW_STATUS[key]} size="sm" />;
          return (
            <li key={`${key}:${requestId ?? ''}`}>
              {requestId === null ? (
                <div className={ROW}>
                  {icon}
                  <span>{label}</span>
                  <span className="ml-auto tabular-nums">
                    {count}
                    <span className="sr-only"> talep</span>
                  </span>
                </div>
              ) : (
                <Link
                  to="/c/$company/requests/$requestId"
                  params={{ company: company.code, requestId }}
                  className={`${ROW} hover:bg-row-hover`}
                  aria-label={`${label}: 1 talep, talebi aç`}
                >
                  {icon}
                  <span>{label}</span>
                  <span className="ml-auto font-medium text-brand tabular-nums underline underline-offset-4">
                    {count}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {truncated ? (
        <p className="text-xs text-ink-secondary">
          Şirkette {OFFICE_REQUEST_LIMIT} talepten fazlası açık; durumlar ve sayılar en uzun süredir
          bekleyen {OFFICE_REQUEST_LIMIT} talepten hesaplandı.
        </p>
      ) : null}
      {company.role === 'founder' ? null : (
        <p className="text-xs text-ink-secondary">
          Durum ve sayılar, görebildiğiniz taleplerden hesaplanır.
        </p>
      )}
    </div>
  );
}
