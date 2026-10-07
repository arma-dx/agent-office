import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isPermanentError, isUnauthorized, isAccessChanged } from './api.ts';
import { SESSION_QUERY_KEY } from './session.ts';

/**
 * Query client: errors that retrying will not fix (4xx) are not retried; others at most 3 times.
 * The session is fetched again when an answer says it no longer matches the server:
 * - a 401 means the session closed (idle or absolute limit); the authenticated layout then sends
 *   the person to the login screen;
 * - a 403 for the company, the founder role or a screen closed to external people means a
 *   membership or role changed while the panel was open; the fresh memberships update the company
 *   switcher, the menu and the page.
 *
 * No query asks again by itself when the network returns. That fetch has no person behind it: the
 * panel would send it from an unattended tab on every reconnect of the Wi-Fi or the VPN, and each
 * one would count as activity and push the session's 30 minute idle limit out (rule 3). Whatever
 * the panel sends without an action of the person is either sent as a background request
 * (lib/refresh.ts) or not sent. What is on screen is brought up to date by the refresh timer of
 * the page or by the person's next step; coming back to the tab is such a step and still fetches.
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
        refetchOnReconnect: false,
      },
    },
  });
  return queryClient;
}
