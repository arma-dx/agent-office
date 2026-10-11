import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CLOSE_REASON_MAX } from '@agent-office/shared';
import { useId, useState } from 'react';
import { z } from 'zod';
import { RequestComments } from '@/components/requests/request-comments';
import {
  AcceptanceCardView,
  ApprovalCardView,
  ClosedNotice,
  FellNotice,
  Journey,
  RerouteDialog,
  ResultBlock,
} from '@/components/requests/request-view';
import { PageLabel } from '@/components/shell/page-label';
import { InlineBanner } from '@/components/inline-banner';
import { ErrorMessage, LoadingRows } from '@/components/states';
import { StatusIcon } from '@/components/status';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, userMessage } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import { REFRESH_MS, useBackgroundRefresh } from '@/lib/refresh';
import { decisionDialogOpen } from '@/lib/requests/hold';
import {
  REQUESTER_ABSENT,
  REQUESTER_ABSENT_CLOSED,
  RESULT_HELD_FOR_OTHERS,
  machineHasTurn,
  personName,
  stageText,
  turnText,
} from '@/lib/requests/labels';
import { closeRequest, fetchRequest, requestKey, requestQueryOptions } from '@/lib/requests/query';
import { useSettle } from '@/lib/requests/settle';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * One request (flow A): where it is, whose turn it is, what waits for the reader, the result, the
 * journey and, under it, what people wrote to each other about the request. Everything on it
 * comes from one answer of the API, already cut to what the reader may read. The page offers only the acts 7 October decision 7 gives: the requester cancels; the
 * approver of the request and the founder correct the routing and stop; the approver decides and
 * the requester accepts in their cards. Whoever stops somebody else's request says why.
 */
export const Route = createFileRoute('/_authed/c/$company/requests_/$requestId')({
  // The list the request belongs to: the top bar links back to it, and a change of company opens
  // it there (a request of one company does not exist in the other).
  staticData: {
    location: { label: 'Talep', parent: { label: 'Talepler', to: '/c/$company/requests' } },
  },
  component: RequestScreen,
});

// While a machine has the turn the page asks every five seconds; otherwise like every list.
const FAST_REFRESH_MS = 5_000;

function NotFound({ company }: { company: string }) {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Talep bulunamadı</h1>
      <p className="text-sm text-ink-secondary">Bu talep yok ya da size açık değil.</p>
      <Button asChild variant="outline">
        <Link to="/c/$company/requests" params={{ company }}>
          Taleplere dön
        </Link>
      </Button>
    </section>
  );
}

function RequestScreen() {
  const company = useCompany();
  const { requestId } = Route.useParams();
  const valid = z.uuid().safeParse(requestId).success;
  const settle = useSettle();
  const query = useQuery({ ...requestQueryOptions(company.companyId, requestId), enabled: valid });
  const request = query.data;
  useBackgroundRefresh({
    queryKey: requestKey(company.companyId, requestId),
    fetch: (signal) => fetchRequest(company.companyId, requestId, { signal, background: true }),
    intervalMs: request && machineHasTurn(request) ? FAST_REFRESH_MS : REFRESH_MS,
    // An approval that stopped waiting would take its card, the open dialog and the typed reason
    // with it; the person sends and reads the API's answer in the dialog instead.
    paused: decisionDialogOpen,
  });
  const [confirming, setConfirming] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const reasonId = useId();
  const closeFocus = useReturnFocus();
  const rerouteFocus = useReturnFocus();
  const close = useMutation({
    mutationFn: () => closeRequest(company.companyId, requestId, reason.trim()),
    onSuccess: (detail) => {
      setConfirming(false);
      setReason('');
      // Also the desk: a pending approval or acceptance of the request closed with it.
      settle(detail);
    },
  });

  if (!valid || (query.error instanceof ApiError && query.error.status === 404)) {
    return <NotFound company={company.code} />;
  }
  if (query.isPending) return <LoadingRows rows={6} />;
  if (!request) {
    return (
      <ErrorMessage
        message={userMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const turn = turnText(request.turn, request.waitingForMe);
  const closing = request.actions.cancel ? 'cancel' : request.actions.stop ? 'stop' : null;
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageLabel>{request.title}</PageLabel>
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <StatusIcon kind="task" status={request.status} labelled />
            <span className="min-w-0 break-words">{request.title}</span>
          </h2>
          {/* Said once when it changes; the same words are on screen, never a color alone. */}
          <p role="status" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-secondary">
            <span>
              Aşama: <span className="text-ink">{stageText(request)}</span>
            </span>
            {turn ? (
              <span>
                Sıra: <span className="text-ink">{turn === 'Sizde' ? 'sizde' : turn}</span>
              </span>
            ) : null}
            {request.unit ? <span>Birim: {request.unit.name}</span> : null}
            {/* A request inside a project is read by the project's members and the founder only;
                every reader of this page can open the project. */}
            {request.project ? (
              <span>
                Proje:{' '}
                <Link
                  to="/c/$company/projects/$projectId"
                  params={{ company: company.code, projectId: request.project.id }}
                  className="font-medium text-brand underline underline-offset-4"
                >
                  {request.project.name}
                </Link>
              </span>
            ) : null}
            {/* Information only (docs/SONRA.md W-h). "Son tarihi geçti" is the API's word for an
                open request whose day has ended; "gecikti" is a run that takes too long. */}
            {request.dueDate !== null ? (
              <span>
                {request.overdue ? 'Son tarihi geçti: ' : 'Son tarih: '}
                <time dateTime={request.dueDate} className="text-ink">
                  {formatDay(request.dueDate)}
                </time>
              </span>
            ) : null}
          </p>
          {request.delayed ? (
            <p className="text-sm text-ink-secondary">
              Bu adım beklenenden uzun sürüyor. Talep kayıtlı.
              {company.role === 'founder' ? ' Çalıştırıcı çalışmıyor olabilir.' : ''}
              {request.actions.reroute
                ? ' Çalışma başlamadıysa "Yönlendirmeyi düzelt" ile işi yeniden verebilirsiniz.'
                : ''}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {request.actions.reroute ? (
            <Button
              variant="outline"
              onClick={() => {
                rerouteFocus.remember();
                setRerouting(true);
              }}
            >
              Yönlendirmeyi düzelt
            </Button>
          ) : null}
          {closing ? (
            <Button
              variant="outline"
              onClick={() => {
                closeFocus.remember();
                close.reset();
                setReasonMissing(false);
                setConfirming(true);
              }}
            >
              {closing === 'cancel' ? 'Talebi iptal et' : 'İşi durdur'}
            </Button>
          ) : null}
        </div>
      </header>

      {/* The requester can no longer read this request (8 October decision 45). Said to every
          reader of the page; the header keeps naming who asked, which never changes. */}
      {request.requesterReads ? null : (
        <InlineBanner tone="info" compact>
          {request.stage === 'done' || request.stage === 'cancelled'
            ? REQUESTER_ABSENT_CLOSED
            : REQUESTER_ABSENT}
        </InlineBanner>
      )}
      <FellNotice request={request} isFounder={company.role === 'founder'} />
      <ClosedNotice request={request} />
      {/* A card belongs to one approval (one round of the acceptance): what was chosen or opened
          on it is not carried to the next one that takes its place. */}
      {request.approval ? (
        <ApprovalCardView key={request.approval.id} card={request.approval} />
      ) : null}
      {/* A held result, for a reader who cannot decide it (the requester, the other members): the
          stage reads "Birim onayında" and nothing else on their page says why no decision comes
          (rule 12; 8 October decision 46). Who may decide reads the same in the card above. */}
      {!request.agentsMayWork && request.stage === 'unit_approval' && request.approval === null ? (
        <InlineBanner tone="info" compact>
          {RESULT_HELD_FOR_OTHERS}
        </InlineBanner>
      ) : null}
      {request.acceptance ? (
        <AcceptanceCardView
          key={request.acceptance.round}
          requestId={request.id}
          returnsToAgent={request.acceptance.returnsToAgent}
          agentsMayWork={request.agentsMayWork}
          spendingLimitReached={request.spendingLimitReached}
          inPlaceOf={request.acceptance.inPlaceOfRequester ? request.requester : null}
          approver={request.result?.approvedBy ? personName(request.result.approvedBy) : null}
        />
      ) : null}
      {request.result ? <ResultBlock result={request.result} /> : null}

      <section className="flex flex-col gap-1">
        <h3 className="text-[0.9375rem] font-semibold">Talep</h3>
        <p className="text-sm text-ink-secondary">{personName(request.requester)} yazdı.</p>
        <p dir="auto" className="rounded-lg bg-row-hover p-3 text-sm whitespace-pre-wrap">
          {request.text}
        </p>
      </section>

      <Journey request={request} />
      {/* The key is the request: the router keeps this screen mounted when only the id in the
          address changes (the form of a new request leads from one request's page to another's),
          and a comment typed for one request must not open in the box of the next one. */}
      <RequestComments key={request.id} request={request} />

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!close.isPending) setConfirming(open);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={closeFocus.onCloseAutoFocus}>
          <AlertDialogTitle>
            {closing === 'stop' ? 'İş durdurulsun mu?' : 'Talep iptal edilsin mi?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {closing === 'stop'
              ? 'Ajan bir sonraki adımdan önce durur ve talep kapanır; bekleyen onay da kapanır. Durdurma geri alınmaz. Yanlış birime gittiyse durdurmak yerine yönlendirmeyi düzeltebilirsiniz.'
              : 'Süren çalışma bir sonraki adımdan önce durur ve talep kapanır. Bekleyen onay da kapanır.'}
          </AlertDialogDescription>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={reasonId} className="text-sm font-medium">
              {closing === 'stop' ? 'Neden' : 'Neden (isteğe bağlı)'}
            </label>
            <Textarea
              id={reasonId}
              rows={2}
              maxLength={CLOSE_REASON_MAX}
              value={reason}
              aria-required={closing === 'stop'}
              aria-invalid={reasonMissing}
              aria-describedby={
                reasonMissing ? `${reasonId}-help ${reasonId}-error` : `${reasonId}-help`
              }
              onChange={(event) => {
                setReason(event.target.value);
                setReasonMissing(false);
              }}
            />
            {reasonMissing ? (
              <p id={`${reasonId}-error`} role="alert" className="text-sm text-destructive">
                Bir neden yazın.
              </p>
            ) : null}
            <p id={`${reasonId}-help`} className="text-sm text-ink-secondary">
              {closing === 'stop'
                ? 'Talep sahibi bu nedeni okur.'
                : 'Talebi görebilen herkes okur.'}
            </p>
          </div>
          {close.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(close.error)}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              autoFocus
              {...busyProps(close.isPending)}
              onClick={(event) => {
                if (close.isPending) event.preventDefault();
              }}
            >
              Vazgeç
            </AlertDialogCancel>
            <Button
              variant="destructive"
              size="lg"
              {...busyProps(close.isPending)}
              onClick={() => {
                if (close.isPending) return;
                if (closing === 'stop' && reason.trim() === '') {
                  setReasonMissing(true);
                  return;
                }
                close.mutate();
              }}
            >
              {closing === 'stop' ? 'İşi durdur' : 'Talebi iptal et'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {rerouting ? (
        <RerouteDialog
          request={request}
          onClose={() => {
            setRerouting(false);
          }}
          onCloseAutoFocus={rerouteFocus.onCloseAutoFocus}
        />
      ) : null}
    </article>
  );
}
