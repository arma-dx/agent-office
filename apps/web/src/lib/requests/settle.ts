import type { RequestDetail } from '@agent-office/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCompany } from '../session.ts';
import { approvalDeskKey, requestKey } from './query.ts';

/**
 * Stores the answer of a decision, a routing correction or a close and lets everything that showed
 * the request read again: the lists, and the desk with the count on the "Onaylar" row (a close or
 * a correction also closes what waited there).
 */
export function useSettle(): (detail: RequestDetail) => void {
  const company = useCompany();
  const queryClient = useQueryClient();
  return (detail) => {
    queryClient.setQueryData(requestKey(company.companyId, detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: approvalDeskKey(company.companyId) });
    void queryClient.invalidateQueries({ queryKey: ['company', company.companyId, 'requests'] });
  };
}
