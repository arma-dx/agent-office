import { TODAY_REQUEST_LIMIT, type RequestSummary } from '@agent-office/shared';
import { linkOptions } from '@tanstack/react-router';
import { useId } from 'react';
import { ListRow } from '@/components/list-row';
import { EmptyState } from '@/components/states';
import { StatusIcon } from '@/components/status';
import { Button } from '@/components/ui/button';
import { formatWhen } from '@/lib/dates';
import { useOpenRequestDialog } from '@/lib/requests/dialog';
import { useCompany } from '@/lib/session';
import { useRowFocus } from '@/lib/today/focus';
import { expectationText } from '@/lib/today/labels';
import { useStableOrder } from '@/lib/today/order';

/**
 * "Sizden beklenenler": everything in the selected company that waits for the reader's approval,
 * answer or attention. A row is a link to the page of its request and nothing else: no decision
 * is given here, an agent's question is not answered here (docs/SONRA.md W-n), and nothing can be
 * dismissed or postponed. A request that waits for an answer is listed only for the one who
 * answers: the requester, or the founder in the place of a requester who cannot read the request.
 */
function ExpectedRow({ request, company }: { request: RequestSummary; company: string }) {
  const expectation = expectationText(request);
  return (
    <ListRow
      leading={<StatusIcon kind="task" status={request.status} labelled />}
      title={request.title}
      link={linkOptions({
        to: '/c/$company/requests/$requestId',
        params: { company, requestId: request.id },
        'aria-label': `${request.title}, ${expectation}`,
      })}
      trailing={
        <>
          {/* 336 px holds the longest expectation whole ("Sizden bekleniyor: model hesabında ödeme
              sorunu", 321 px); the width test of lib/today/labels.ts keeps a new reason inside
              it ("Yanıtınız bekleniyor" is far inside). No title attribute here or on the time:
              both lie under the cover of the row's link, where a tooltip is never shown. */}
          <span className="w-84 truncate">{expectation}</span>
          <time
            dateTime={request.updatedAt}
            className="w-20 text-right text-xs text-ink-secondary tabular-nums"
          >
            {formatWhen(request.updatedAt)}
          </time>
        </>
      }
    />
  );
}

export function ExpectedSection({
  requests,
  truncated,
}: {
  requests: readonly RequestSummary[];
  truncated: boolean;
}) {
  const company = useCompany();
  const openDialog = useOpenRequestDialog();
  const headingId = useId();
  const order = useStableOrder(requests.map((request) => request.id));
  const { headingRef, onFocusCapture, onBlurCapture } = useRowFocus(order.join(' '));
  if (requests.length === 0) {
    // The same ref as the heading of the list: when a refresh takes the last row away under the
    // keyboard, the focus goes to this heading (useRowFocus), not to the page.
    return company.role === 'external' ? (
      <EmptyState
        headingRef={headingRef}
        title="Sizden beklenen iş yok"
        description="Ajanların yürüttüğü talepler şirketin kurucusuna ve çalışanlarına açıktır."
      />
    ) : (
      <EmptyState
        headingRef={headingRef}
        title="Sizden beklenen iş yok"
        description="Onayınızı, yanıtınızı ya da bakmanızı bekleyen talepler burada görünür. Ajanlardan bir iş istemek için talep gönderin."
        action={
          openDialog ? (
            <Button size="lg" onClick={openDialog}>
              Yeni talep
            </Button>
          ) : undefined
        }
      />
    );
  }
  const byId = new Map(requests.map((request) => [request.id, request]));
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="px-2 text-sm font-semibold">
        Sizden beklenenler{' '}
        <span className="font-normal text-ink-secondary tabular-nums">{requests.length}</span>
      </h2>
      <ul className="flex flex-col" onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture}>
        {order.flatMap((id) => {
          const request = byId.get(id);
          return request ? [<ExpectedRow key={id} request={request} company={company.code} />] : [];
        })}
      </ul>
      {truncated ? (
        <p className="px-2 text-sm text-ink-secondary">
          Liste en uzun süredir bekleyen {TODAY_REQUEST_LIMIT} açık talepten kuruldu; daha yeni bir
          iş burada görünmeyebilir.
        </p>
      ) : null}
    </section>
  );
}
