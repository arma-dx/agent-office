import { officeResponseSchema, type OfficeResponse } from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '../api.ts';
import { officeDialogOpen } from './hold.ts';

/**
 * GET /api/office: the units and agents of one company with their switches and the open requests
 * counted for the reader. The company id goes in the header and the API checks it against the
 * person's memberships. The page refreshes it every half minute with `fetchOffice` as a background
 * request (lib/refresh.ts), which does not extend the session's idle time (rule 3).
 */
export const officeKey = (companyId: string) => ['company', companyId, 'office'] as const;

export function fetchOffice(
  companyId: string,
  options: { signal?: AbortSignal; background?: boolean } = {},
): Promise<OfficeResponse> {
  return apiRequest('/office', { schema: officeResponseSchema, companyId, ...options });
}

export function officeQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: officeKey(companyId),
    queryFn: ({ signal }) => fetchOffice(companyId, { signal }),
    // Not under an open confirmation (lib/office/hold.ts).
    refetchOnWindowFocus: () => !officeDialogOpen(),
  });
}
