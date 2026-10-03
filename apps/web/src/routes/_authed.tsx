import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router';
import { BarePage, PageLoading } from '@/components/layout';
import { ErrorMessage } from '@/components/states';
import { userMessage } from '@/lib/api';
import { SessionContext, sessionQueryOptions } from '@/lib/session';

/**
 * Every page except the login screen is behind this layout. The session cookie is HttpOnly and the
 * browser never sees it; the panel only asks the API who is signed in (GET /api/session).
 */
export const Route = createFileRoute('/_authed')({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const query = useQuery(sessionQueryOptions);
  const state = query.data;

  if (state === undefined) {
    if (query.isError) {
      return (
        <BarePage>
          <ErrorMessage
            message={userMessage(query.error)}
            onRetry={() => {
              void query.refetch();
            }}
          />
        </BarePage>
      );
    }
    return <PageLoading />;
  }

  if (state.status === 'signed_out') {
    // A session that closed while the panel was open is told apart from a first visit.
    return <Navigate to="/login" search={state.expired ? { status: 'expired' } : {}} replace />;
  }

  return (
    <SessionContext value={state.session}>
      <Outlet />
    </SessionContext>
  );
}
