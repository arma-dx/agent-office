import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useId } from 'react';
import { useOpenRequestDialog } from '@/lib/requests/dialog';
import {
  AcceptanceCardView,
  ApprovalCardView,
  ResultBlock,
} from '@/components/requests/request-view';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { useBackgroundRefresh } from '@/lib/refresh';
import { decisionDialogOpen } from '@/lib/requests/hold';
import { personName } from '@/lib/requests/labels';
import { approvalDeskQueryOptions, fetchApprovalDesk } from '@/lib/requests/query';
import { useCompany } from '@/lib/session';

/**
 * "Onaylar": what waits for a decision of the reader, in two groups that are two different
 * records. "Birim onayları" are results an agent submitted and the reader may decide (the gate of
 * rule 4, sometimes with a passkey); "Taleplerinizin sonuçları" are approved results of the
 * reader's own requests that wait for their acceptance. The cards are the ones the request page
 * uses, and each decision goes through the same endpoint whichever screen it is given on
 * (5 October decision 10). Nothing here can be dismissed or postponed.
 */
export const Route = createFileRoute('/_authed/c/$company/approvals')({
  staticData: { location: { label: 'Onaylar' } },
  component: ApprovalsScreen,
});

function ApprovalsScreen() {
  const company = useCompany();
  const openDialog = useOpenRequestDialog();
  const approvalsId = useId();
  const acceptancesId = useId();
  const insider = company.role !== 'external';
  const desk = useQuery({ ...approvalDeskQueryOptions(company.companyId), enabled: insider });
  useBackgroundRefresh({
    queryKey: approvalDeskQueryOptions(company.companyId).queryKey,
    fetch: (signal) => fetchApprovalDesk(company.companyId, { signal, background: true }),
    // A card that left the desk would take its open dialog and the typed reason with it.
    paused: decisionDialogOpen,
  });

  if (!insider) {
    return (
      <EmptyState
        variant="page"
        title="Onay bekleyen iş yok"
        description="Onaylar şirketin kurucusuna ve çalışanlarına gelir."
      />
    );
  }
  if (desk.isPending) return <LoadingRows rows={4} />;
  if (desk.isError) {
    return (
      <ErrorMessage
        message={userMessage(desk.error)}
        onRetry={() => {
          void desk.refetch();
        }}
      />
    );
  }
  const { approvals, acceptances } = desk.data;
  if (approvals.length === 0 && acceptances.length === 0) {
    const decides = company.role === 'founder' || company.canApprove;
    return (
      <EmptyState
        variant="page"
        title={decides ? 'Onay bekleyen iş yok' : 'Onayınızı bekleyen sonuç yok'}
        description={
          decides
            ? 'Ajanların onayınıza sunduğu işler ve taleplerinizin sonuçları burada görünür.'
            : 'Gönderdiğiniz taleplerin sonuçları, birim onayından sonra burada onayınıza gelir.'
        }
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
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      {approvals.length > 0 ? (
        <section aria-labelledby={approvalsId} className="flex flex-col gap-3">
          <h2 id={approvalsId} className="text-sm font-semibold">
            Birim onayları{' '}
            <span className="font-normal text-ink-secondary tabular-nums">{approvals.length}</span>
          </h2>
          {approvals.map((card) => (
            <ApprovalCardView key={card.id} card={card} showRequestLink />
          ))}
        </section>
      ) : null}
      {acceptances.length > 0 ? (
        <section aria-labelledby={acceptancesId} className="flex flex-col gap-3">
          <h2 id={acceptancesId} className="text-sm font-semibold">
            Taleplerinizin sonuçları{' '}
            <span className="font-normal text-ink-secondary tabular-nums">
              {acceptances.length}
            </span>
          </h2>
          {acceptances.map((card) => (
            <div key={card.requestId} className="flex flex-col gap-3">
              <p className="text-sm">
                <Link
                  to="/c/$company/requests/$requestId"
                  params={{ company: company.code, requestId: card.requestId }}
                  className="font-medium text-brand underline underline-offset-4"
                >
                  {card.requestTitle}
                </Link>
              </p>
              <AcceptanceCardView
                requestId={card.requestId}
                returnsToAgent={card.returnsToAgent}
                agentsMayWork={card.agentsMayWork}
                approver={card.result.approvedBy ? personName(card.result.approvedBy) : null}
              />
              <ResultBlock result={card.result} />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
