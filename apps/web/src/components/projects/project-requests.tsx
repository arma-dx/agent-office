import type { ProjectDetail } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RequestGroups } from '@/components/requests/request-list';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { useBackgroundRefresh } from '@/lib/refresh';
import { useOpenRequestDialogFor } from '@/lib/requests/dialog';
import { fetchRequests, requestsKey, requestsQueryOptions } from '@/lib/requests/query';
import { useCompany } from '@/lib/session';

/**
 * The "Talepler" tab of a project's page (8 October 2026, decision 17): the requests of this one
 * project, in the list form of the Talepler screen, and the button that opens the form with the
 * project chosen. The list is what the API answers for the reader: a project's members and the
 * founder read all of its requests, so there is no "only mine" switch here.
 *
 * A project that takes no request says why instead of offering the button: a closed project
 * (decision 48: its open requests run on to their end and stay listed here), and a project where
 * agents may not work (rule 12), in the founder's words or in an employee's.
 *
 * The list moves by itself (agents work on it), so it is refreshed every half minute with a
 * background request, which does not extend the session's idle time (rule 3).
 */
export function ProjectRequests({ project }: { project: ProjectDetail }): ReactNode {
  const company = useCompany();
  const openFor = useOpenRequestDialogFor();
  const list = useQuery(requestsQueryOptions(company.companyId, false, project.id));
  useBackgroundRefresh({
    queryKey: requestsKey(company.companyId, false, project.id),
    fetch: (signal) =>
      fetchRequests(company.companyId, false, {
        signal,
        background: true,
        projectId: project.id,
      }),
  });

  const blocked = project.closed
    ? 'Kapalı projede yeni talep açılmaz.'
    : !project.agentsMayWork
      ? `Bu projede ajanlar çalışamadığı için talep açılamaz. ${
          company.role === 'founder'
            ? 'Yapay zekâ iznini özellikler panelinden açabilirsiniz.'
            : 'Yapay zekâ iznini kurucu açar.'
        }`
      : null;
  const open =
    openFor !== null && blocked === null ? (
      <Button
        onClick={() => {
          openFor({ id: project.id, name: project.name });
        }}
      >
        Bu projede talep aç
      </Button>
    ) : null;

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
  if (list.data.requests.length === 0) {
    return (
      <EmptyState
        title="Bu projede henüz talep yok"
        description={
          blocked ??
          'Ajanlardan bu proje için bir iş istemek üzere talep açın. Talebi yalnızca proje üyeleri ve kurucu görür.'
        }
        action={open ?? undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-secondary">{blocked}</p>
        {open}
      </div>
      <RequestGroups
        requests={list.data.requests}
        company={company.code}
        showProject={false}
        dense
        headingLevel={3}
      />
      {list.data.truncated ? (
        <p className="px-2 text-sm text-ink-secondary">Liste en yeni 200 talebi gösteriyor.</p>
      ) : null}
    </div>
  );
}
