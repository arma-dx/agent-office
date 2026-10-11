import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { RequestGroups } from '@/components/requests/request-list';
import { useOpenRequestDialog } from '@/lib/requests/dialog';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { userMessage } from '@/lib/api';
import { useBackgroundRefresh } from '@/lib/refresh';
import { fetchRequests, requestsQueryOptions } from '@/lib/requests/query';
import { useCompany } from '@/lib/session';

/**
 * "Talepler": the requests agents carry out (flow A). One list in three groups by whose turn it
 * is (components/requests/request-list.tsx, which a project's page uses too); a row names the
 * project of its request. Nothing in a row is a control: nobody sets a status, a unit or an agent
 * by hand (7 October decisions 2 and 7). Tasks between people are a different screen ("Görevler").
 */
export const Route = createFileRoute('/_authed/c/$company/requests')({
  staticData: { location: { label: 'Talepler' } },
  component: RequestsScreen,
});

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
          <RequestGroups requests={requests} company={company.code} showProject />
          {list.data.truncated ? (
            <p className="px-2 text-sm text-ink-secondary">Liste en yeni 200 talebi gösteriyor.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
