import type { RequestSummary } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, linkOptions } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { ListRow } from '@/components/list-row';
import { useOpenRequestDialog } from '@/lib/requests/dialog';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { StatusIcon } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { userMessage } from '@/lib/api';
import { formatWhen } from '@/lib/dates';
import { useBackgroundRefresh } from '@/lib/refresh';
import { rowSentence, stageText, turnText } from '@/lib/requests/labels';
import { fetchRequests, requestsQueryOptions } from '@/lib/requests/query';
import { useCompany } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * "Talepler": the requests agents carry out (flow A). One list in three groups by whose turn it
 * is. Nothing in a row is a control: nobody sets a status, a unit or an agent by hand (7 October
 * decisions 2 and 7). Tasks between people are a different screen ("Görevler").
 */
export const Route = createFileRoute('/_authed/c/$company/requests')({
  staticData: { location: { label: 'Talepler' } },
  component: RequestsScreen,
});

function RequestRow({ request, company }: { request: RequestSummary; company: string }) {
  const turn = turnText(request.turn, request.waitingForMe);
  return (
    <ListRow
      leading={<StatusIcon kind="task" status={request.status} labelled />}
      title={request.title}
      link={linkOptions({
        to: '/c/$company/requests/$requestId',
        params: { company, requestId: request.id },
        'aria-label': rowSentence(request),
      })}
      trailing={
        <>
          {/* Below 1280 px the fixed columns give way to the title, the one thing that tells two
              rows apart: the unit code and the time are dropped (both are on the request's page)
              and the stage gets a narrower column. */}
          <span
            className="hidden w-14 text-xs text-ink-secondary xl:block"
            title={request.unit?.name}
          >
            {request.unit?.code ?? ''}
          </span>
          <span
            className={cn('w-44 truncate xl:w-64', !request.waitingForMe && 'text-ink-secondary')}
            title={stageText(request)}
          >
            {stageText(request)}
          </span>
          <span className={cn('w-24 truncate xl:w-32', request.waitingForMe && 'font-semibold')}>
            {turn ?? ''}
          </span>
          <time
            dateTime={request.updatedAt}
            className="hidden w-20 text-right text-xs text-ink-secondary tabular-nums xl:block"
          >
            {formatWhen(request.updatedAt)}
          </time>
        </>
      }
    />
  );
}

function Group({
  title,
  requests,
  company,
}: {
  title: string;
  requests: RequestSummary[];
  company: string;
}) {
  const headingId = useId();
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="px-2 text-sm font-semibold">
        {title}{' '}
        <span className="font-normal text-ink-secondary tabular-nums">{requests.length}</span>
      </h2>
      <ul className="flex flex-col">
        {requests.map((request) => (
          <RequestRow key={request.id} request={request} company={company} />
        ))}
      </ul>
    </section>
  );
}

function RequestsScreen() {
  const company = useCompany();
  const openDialog = useOpenRequestDialog();
  const [mine, setMine] = useState(company.role !== 'founder');
  const switchId = useId();
  const list = useQuery(requestsQueryOptions(company.companyId, mine));
  useBackgroundRefresh({
    queryKey: requestsQueryOptions(company.companyId, mine).queryKey,
    fetch: (signal) => fetchRequests(company.companyId, mine, { signal, background: true }),
  });

  const newRequest = openDialog ? (
    <Button size="lg" onClick={openDialog}>
      Yeni talep
    </Button>
  ) : null;

  if (company.role === 'external') {
    return (
      <EmptyState
        variant="page"
        title="Talepler dış kişilere açık değil"
        description="Ajanların yürüttüğü talepleri şirketin kurucusu ve çalışanları görür."
      />
    );
  }

  const requests = list.data?.requests ?? [];
  const waiting = requests
    .filter((request) => request.waitingForMe)
    // The one that has waited longest is on top.
    .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const closed = requests.filter(
    (request) => request.stage === 'done' || request.stage === 'cancelled',
  );
  const running = requests.filter(
    (request) => !request.waitingForMe && request.stage !== 'done' && request.stage !== 'cancelled',
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Switch id={switchId} checked={mine} onCheckedChange={setMine} />
          <label htmlFor={switchId}>Yalnızca benim taleplerim</label>
        </div>
        {newRequest}
      </div>
      {list.isPending ? (
        <LoadingRows rows={5} />
      ) : list.isError ? (
        <ErrorMessage
          message={userMessage(list.error)}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          variant="page"
          title={mine ? 'Açık talebiniz yok' : 'Henüz talep yok'}
          description="Ajanlardan bir iş istemek için bir talep gönderin. Talebi koordinasyon merkezi ilgili birime yönlendirir."
          action={newRequest}
        />
      ) : (
        <>
          <p role="status" className="sr-only">
            {waiting.length > 0 ? `${String(waiting.length)} talep sizden bekleniyor.` : ''}
          </p>
          <Group title="Sizden beklenenler" requests={waiting} company={company.code} />
          <Group title="Sürenler" requests={running} company={company.code} />
          <Group title="Bitenler" requests={closed} company={company.code} />
          {list.data.truncated ? (
            <p className="px-2 text-sm text-ink-secondary">Liste en yeni 200 talebi gösteriyor.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
