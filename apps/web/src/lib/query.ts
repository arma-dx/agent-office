import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isPermanentError, isUnauthorized, isAccessChanged } from './api.ts';
import { SESSION_QUERY_KEY } from './session.ts';

/**
 * Query client: errors that retrying will not fix (4xx) are not retried; others at most 3 times.
 * The session is fetched again when an answer says it no longer matches the server:
 * - a 401 means the session closed (idle or absolute limit); the authenticated layout then sends
 *   the person to the login screen;
 * - a 403 for the company or the founder role means a membership or role changed while the panel
 *   was open; the fresh memberships update the company switcher, the menu and the page.
 */
export function createQueryClient(): QueryClient {
  const recheckSession = (error: unknown) => {
    if (isUnauthorized(error) || isAccessChanged(error)) {
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] !== SESSION_QUERY_KEY[0]) recheckSession(error);
      },
    }),
    mutationCache: new MutationCache({ onError: recheckSession }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => !isPermanentError(error) && failureCount < 3,
      },
    },
  });
  return queryClient;
}
