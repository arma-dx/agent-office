import { officeResponseSchema, type OfficeResponse } from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '../api.ts';

/**
 * GET /api/office: the units and agents of one company. The company id goes in the header and the
 * API checks it against the person's memberships. No polling: the definitions change with a sync,
 * not while a person is looking.
 */
export function officeQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: ['company', companyId, 'office'] as const,
    queryFn: ({ signal }): Promise<OfficeResponse> =>
      apiRequest('/office', { schema: officeResponseSchema, companyId, signal }),
  });
}
