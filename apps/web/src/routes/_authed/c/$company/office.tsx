import type { MembershipSummary } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { OfficeView } from '@/components/office/office-view';
import { EmptyState, ErrorMessage } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';
import { userMessage } from '@/lib/api';
import { toOfficeUnits } from '@/lib/office/from-api';
import { agentId, CENTRE_UNIT, unitId } from '@/lib/office/model';
import { officeQueryOptions } from '@/lib/office/query';
import { companyLabel, useCompany } from '@/lib/session';

/**
 * Ofis görünümü (module M15): the units and agents of the company as an isometric office. The
 * founder and the employees see it; an external person does not (6 October 2026, decision 6).
 */
export const Route = createFileRoute('/_authed/c/$company/office')({
  staticData: { location: { label: 'Ofis görünümü' }, fullBleed: true },
  component: OfficeScreen,
});

// The page fills the content area: the window less the 60 px top bar, so the window never scrolls.
const CANVAS_HEIGHT = 'h-[calc(100dvh-3.75rem)]';

function OfficeScreen() {
  const company = useCompany();
  // No request is sent for an external person: the API would refuse it (insiders_only).
  if (company.role === 'external') {
    return (
      <div className="p-6">
        <ErrorMessage message="Ofis görünümü dış kişilere açık değil." />
      </div>
    );
  }
  return <OfficeForCompany company={company} />;
}

function OfficeForCompany({ company }: { company: MembershipSummary }) {
  const query = useQuery(officeQueryOptions(company.companyId));
  // A selection is a mark on the scene and nothing more. The shell remounts the page when the
  // company changes, so it never crosses companies, and a reload clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The same answer gives the same list (the query keeps equal data as one object), so a refetch
  // that changes nothing renders nothing again.
  const units = useMemo(() => (query.data ? toOfficeUnits(query.data) : []), [query.data]);
  const known = useMemo(
    () =>
      new Set(
        units.flatMap((unit) => [
          unitId(unit.code),
          ...unit.agents.map((agent) => agentId(agent.code)),
        ]),
      ),
    [units],
  );

  if (query.isPending) {
    // One muted block, not placeholder rooms: how many rooms there are is not known yet.
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex ${CANVAS_HEIGHT} items-center justify-center`}
      >
        <span className="sr-only">Yükleniyor</span>
        <Skeleton className="h-28 w-56" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-6">
        <ErrorMessage
          message={userMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  }

  if (units.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          variant="page"
          title="Burada henüz ajan yok"
          description="Ajanlar tanımlanınca birimleriyle burada görünür."
        />
      </div>
    );
  }

  return (
    <div className={`flex ${CANVAS_HEIGHT} min-w-0 flex-col`}>
      <OfficeView
        companyName={companyLabel(company)}
        units={units}
        centreUnit={CENTRE_UNIT}
        // A thing that left the data is no selection any more.
        selectedId={selectedId !== null && known.has(selectedId) ? selectedId : null}
        onSelect={setSelectedId}
      />
    </div>
  );
}
