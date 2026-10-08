import { useQuery } from '@tanstack/react-query';
import { ExpectedSection } from '@/components/today/expected-section';
import { ErrorMessage, LoadingRows } from '@/components/states';
import { userMessage } from '@/lib/api';
import { useBackgroundRefresh } from '@/lib/refresh';
import { useCompany } from '@/lib/session';
import { statusLine } from '@/lib/today/labels';
import { fetchToday, todayKey, todayQueryOptions } from '@/lib/today/query';

/**
 * The Bugün screen, from one answer of the API, refreshed every half minute in the background.
 * Nothing here can be paused by a dialog: the screen has none.
 */
export function TodayLists() {
  const company = useCompany();
  const today = useQuery(todayQueryOptions(company.companyId));
  useBackgroundRefresh({
    queryKey: todayKey(company.companyId),
    fetch: (signal) => fetchToday(company.companyId, { signal, background: true }),
  });
  if (today.isPending) return <LoadingRows rows={4} />;
  if (today.isError) {
    return (
      <ErrorMessage
        message={userMessage(today.error)}
        onRetry={() => {
          void today.refetch();
        }}
      />
    );
  }
  const { expected, expectedTruncated } = today.data;
  return (
    <>
      <p role="status" className="sr-only">
        {statusLine(expected.length, 0)}
      </p>
      <ExpectedSection requests={expected} truncated={expectedTruncated} />
    </>
  );
}
