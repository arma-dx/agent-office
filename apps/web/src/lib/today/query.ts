import {
  sidebarCountsSchema,
  todaySchema,
  type SidebarCounts,
  type Today,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '../api.ts';

/**
 * The Bugün screen and the counts of the sidebar. Each query has a twin that sends the same
 * request as a background request, for the periodic refresh (lib/refresh.ts): such a request does
 * not extend the session's idle time (rule 3). The read mark is a person's act and is never sent
 * as one.
 */

export const todayKey = (companyId: string) => ['company', companyId, 'today'] as const;
export const sidebarCountsKey = (companyId: string) =>
  ['company', companyId, 'sidebar-counts'] as const;

interface FetchOptions {
  signal?: AbortSignal;
  background?: boolean;
}

export function fetchToday(companyId: string, options: FetchOptions = {}): Promise<Today> {
  return apiRequest('/today', { schema: todaySchema, companyId, ...options });
}

export function todayQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: todayKey(companyId),
    queryFn: ({ signal }) => fetchToday(companyId, { signal }),
  });
}

export function fetchSidebarCounts(
  companyId: string,
  options: FetchOptions = {},
): Promise<SidebarCounts> {
  return apiRequest('/today/counts', { schema: sidebarCountsSchema, companyId, ...options });
}

export function sidebarCountsQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: sidebarCountsKey(companyId),
    queryFn: ({ signal }) => fetchSidebarCounts(companyId, { signal }),
  });
}

/** Marks the notifications the person saw as read. */
export async function markNotificationsRead(
  companyId: string,
  ids: readonly string[],
): Promise<void> {
  await apiRequest('/notifications/read', {
    method: 'POST',
    body: { ids },
    schema: z.undefined(),
    companyId,
  });
}
