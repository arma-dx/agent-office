import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useEffectEvent } from 'react';
import { ApiError, isAccessChanged, isUnauthorized } from './api.ts';
import { recheckSessionInBackground } from './session.ts';

/**
 * How often a list or a task on screen is refreshed (5 October 2026, decision 11). Each refresh is
 * one request; the API allows 300 a minute for a whole office address, so a page refreshes at most
 * two queries.
 */
export const REFRESH_MS = 30_000;

/**
 * Refreshes the data of a query on a timer for as long as the calling component is mounted. The
 * refresh is not a fetch of the query: TanStack Query gives a query function no reason for a fetch,
 * so a refetchInterval could not be told apart from a click. `fetch` is the same request sent as a
 * background request (apiRequest's `background`), and its answer is written into the cache. The
 * query's own fetches (mount, window focus, a retry button, invalidation after a change) stay
 * requests of the person.
 *
 * Nothing is sent while the tab is hidden, while the query has no data yet or fetches by itself,
 * while a change is being saved, or while `paused` answers true (a menu is open, a card is being
 * dragged: what the person aims at must not move). An answer that arrives after the person changed
 * or fetched the data is dropped.
 *
 * A failure that says nothing about the person's access (the network, a 5xx, a 429) is not shown
 * and not retried: the next tick tries again. The others are acted on, because the panel has just
 * been told that what is on screen is no longer the person's to see:
 * - 401, the session closed (these requests do not extend the idle limit): the session is read
 *   again and the authenticated layout opens the login screen;
 * - 403 for the company, the role or the screen: the session is read again, so that the company
 *   menu and the page follow the new memberships;
 * - 403 or 404 for what was asked: the cached answer is dropped and the error takes its place, so
 *   the page shows "not found" or the refusal instead of rows the person may no longer read.
 * The session is read again as a background request too: nothing in this file counts as activity.
 */
export function useBackgroundRefresh<T>(options: {
  queryKey: QueryKey;
  fetch: (signal: AbortSignal) => Promise<T>;
  paused?: () => boolean;
  intervalMs?: number;
}): void {
  const queryClient = useQueryClient();
  const { queryKey, intervalMs = REFRESH_MS } = options;
  // The key by value: a new array with the same content must not restart the timer.
  const keyHash = hashKey(queryKey);

  const tick = useEffectEvent((signal: AbortSignal) => {
    if (document.visibilityState !== 'visible') return;
    if (options.paused?.() === true) return;
    const before = queryClient.getQueryState<T>(queryKey);
    if (before?.data === undefined || before.fetchStatus !== 'idle') return;
    if (queryClient.isMutating() > 0) return;
    const startedAt = Date.now();
    options.fetch(signal).then(
      (data) => {
        if (signal.aborted) return;
        const now = queryClient.getQueryState<T>(queryKey);
        if (!now || now.fetchStatus !== 'idle' || now.dataUpdatedAt > startedAt) return;
        if (queryClient.isMutating() > 0 || options.paused?.() === true) return;
        queryClient.setQueryData<T>(queryKey, data);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        if (isUnauthorized(error) || isAccessChanged(error)) {
          void recheckSessionInBackground(queryClient);
        }
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          const query = queryClient.getQueryCache().find<T>({ queryKey, exact: true });
          // As for an answer: not over a fetch or a change that came after this request left.
          if (!query || query.state.fetchStatus !== 'idle') return;
          if (query.state.dataUpdatedAt > startedAt) return;
          query.setState({
            data: undefined,
            dataUpdatedAt: 0,
            error,
            errorUpdatedAt: Date.now(),
            fetchFailureReason: error,
            status: 'error',
          });
        }
      },
    );
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      tick(controller.signal);
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [keyHash, intervalMs]);
}
