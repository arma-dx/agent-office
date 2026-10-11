import type { ProjectApproval, ProjectDetail } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { linkOptions } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { ListRow } from '@/components/list-row';
import { EventMark } from '@/components/requests/request-view';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { StatusIcon } from '@/components/status';
import { userMessage } from '@/lib/api';
import { formatWhen } from '@/lib/dates';
import { approvalLine } from '@/lib/projects/labels';
import {
  fetchProjectApprovals,
  projectApprovalsKey,
  projectApprovalsQueryOptions,
} from '@/lib/projects/query';
import { useBackgroundRefresh } from '@/lib/refresh';
import { useCompany } from '@/lib/session';

/** What a reader without the approval right is told about the list they get. */
const LEFT_OUT = 'Onay bekleyen ve onaylanmayan sonuçları yalnızca onay verebilen kişiler görür.';

function ApprovalRow({ approval, company }: { approval: ProjectApproval; company: string }) {
  const line = approvalLine(approval);
  // When it was decided; a result that waits, or was closed undecided, shows when it was sent.
  const at = approval.decidedAt ?? approval.createdAt;
  return (
    <ListRow
      leading={
        // A closed result is an event, not a decision: it does not get the icon of a status.
        approval.status === 'closed' ? (
          <span className="flex size-4 items-center justify-center">
            <EventMark />
          </span>
        ) : (
          <StatusIcon kind="approval" status={approval.status} />
        )
      }
      title={approval.request.title}
      subtitle={line}
      link={linkOptions({
        to: '/c/$company/requests/$requestId',
        params: { company, requestId: approval.request.id },
        'aria-label': `${approval.request.title}. ${line}`,
      })}
      trailing={
        <time dateTime={at} className="w-24 text-right text-xs text-ink-secondary tabular-nums">
          {formatWhen(at)}
        </time>
      }
    />
  );
}

function Group({
  title,
  approvals,
  company,
}: {
  title: string;
  approvals: ProjectApproval[];
  company: string;
}) {
  const headingId = useId();
  if (approvals.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="px-2 text-sm font-semibold">
        {title}
      </h3>
      <ul className="flex flex-col">
        {approvals.map((approval) => (
          <ApprovalRow key={approval.id} approval={approval} company={company} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The "Onaylar" tab of a project's page (8 October 2026, decision 17): the results of the
 * project's requests that wait for the unit's approver or were decided, in two groups. A row is
 * the request's title and one sentence about its result; it opens the request, where the card is
 * for whoever may decide it. Nothing is decided here: a card stands in one place (docs/SONRA.md
 * W-n), and the Onaylar screen with its count stays the place that says what waits for the
 * reader, so the tab shows no count.
 *
 * The list is what the API answers for the reader (docs/SONRA.md V-c): a result that waits, was
 * sent back or was rejected is a row only for those who hold the approval right; the others get
 * the approved ones, and one sentence says what the list leaves out. Nothing an agent wrote is in
 * a row.
 *
 * The list moves by itself (agents submit results), so it is refreshed every half minute with a
 * background request, which does not extend the session's idle time (rule 3).
 */
export function ProjectApprovals({ project }: { project: ProjectDetail }): ReactNode {
  const company = useCompany();
  const list = useQuery(projectApprovalsQueryOptions(company.companyId, project.id));
  useBackgroundRefresh({
    queryKey: projectApprovalsKey(company.companyId, project.id),
    fetch: (signal) =>
      fetchProjectApprovals(company.companyId, project.id, { signal, background: true }),
  });

  if (list.isPending) return <LoadingRows rows={4} />;
  if (list.isError) {
    return (
      <ErrorMessage
        message={userMessage(list.error)}
        onRetry={() => {
          void list.refetch();
        }}
      />
    );
  }
  const { approvals, truncated, seesUndecided } = list.data;
  if (approvals.length === 0) {
    return (
      <EmptyState
        title="Bu projede henüz onaya sunulan sonuç yok"
        description={
          seesUndecided
            ? 'Ajanların bu projedeki taleplere yazdığı sonuçlar onaya sunulduğunda burada listelenir.'
            : `Bu projede onaylanmış sonuç yok. ${LEFT_OUT}`
        }
      />
    );
  }
  const waiting = approvals.filter((approval) => approval.status === 'pending');
  const decided = approvals.filter((approval) => approval.status !== 'pending');
  return (
    <div className="flex flex-col gap-5">
      <Group title="Karar bekleyenler" approvals={waiting} company={company.code} />
      <Group title="Karar verilenler" approvals={decided} company={company.code} />
      {seesUndecided ? null : <p className="px-2 text-sm text-ink-secondary">{LEFT_OUT}</p>}
      {truncated ? (
        <p className="px-2 text-sm text-ink-secondary">Liste en yeni 200 sonucu gösteriyor.</p>
      ) : null}
    </div>
  );
}
