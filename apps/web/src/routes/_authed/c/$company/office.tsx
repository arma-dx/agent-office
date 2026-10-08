import type { MembershipSummary } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { OfficeDetails } from '@/components/office/office-details';
import { OfficeView, type OfficeViewHandle } from '@/components/office/office-view';
import { PropertiesPanel } from '@/components/shell/properties-panel';
import { EmptyState, ErrorMessage } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';
import { userMessage } from '@/lib/api';
import { toOfficeUnits } from '@/lib/office/from-api';
import { CENTRE_UNIT, selectionOf } from '@/lib/office/model';
import { officeQueryOptions } from '@/lib/office/query';
import { useWideWindow } from '@/lib/office/use-wide-window';
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
  // The selection is a mark on the scene and the content of the properties panel. The shell
  // remounts the page when the company changes, so it never crosses companies, and a reload clears
  // it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // From 1280 px the page asks for the panel itself and the scene keeps its zoom beside it. In a
  // narrower window the panel would leave too little of the scene, so it follows the person's own
  // choice there (the toggle in the top bar).
  const wide = useWideWindow();
  const scene = useRef<OfficeViewHandle>(null);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  // The same answer gives the same list (the query keeps equal data as one object), so a refetch
  // that changes nothing renders nothing again.
  const units = useMemo(() => (query.data ? toOfficeUnits(query.data) : []), [query.data]);
  // A thing that left the data is no selection any more.
  const selection = useMemo(
    () => (selectedId === null ? null : selectionOf(units, selectedId)),
    [units, selectedId],
  );
  const shownId = selection ? selectedId : null;

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

  // A choice made in the panel (an agent of the unit, the unit of the agent) replaces the content
  // that held the pressed button, and the focus would fall back to the page. It goes to the heading
  // instead; the new content is rendered first, so that the heading names the chosen thing when the
  // focus arrives.
  const selectFromDetails = (id: string) => {
    flushSync(() => {
      setSelectedId(id);
    });
    detailsHeading.current?.focus();
    // Beside the panel the scene may show only a part of the office: the chosen thing is brought
    // into it.
    scene.current?.revealItem(id);
  };

  // The panel goes with the selection: the focus returns to the thing's button in the scene.
  const clearFromDetails = () => {
    if (shownId !== null) scene.current?.focusItem(shownId);
    setSelectedId(null);
  };

  return (
    <div className={`flex ${CANVAS_HEIGHT} min-w-0 flex-col`}>
      <OfficeView
        ref={scene}
        companyName={companyLabel(company)}
        units={units}
        centreUnit={CENTRE_UNIT}
        selectedId={shownId}
        onSelect={setSelectedId}
        holdView={wide}
      />
      {selection ? (
        <PropertiesPanel open={wide}>
          <OfficeDetails
            selection={selection}
            workTruncated={query.data.workTruncated}
            headingRef={detailsHeading}
            onSelect={selectFromDetails}
            onClear={clearFromDetails}
          />
        </PropertiesPanel>
      ) : null}
    </div>
  );
}
