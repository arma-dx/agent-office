import {
  sessionResponseSchema,
  setCompanyRequestSchema,
  type MembershipSummary,
  type SessionResponse,
} from '@agent-office/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { z } from 'zod';
import { API_ROOT, apiRequest, isUnauthorized } from './api.ts';

/** Full page navigation to the API, which sends the browser on to Google. */
export const GOOGLE_SIGN_IN_HREF = `${API_ROOT}/auth/google`;

export const SESSION_QUERY_KEY = ['session'] as const;

/**
 * The session as the panel sees it. A 401 is a normal answer here, not an error: it means signed out.
 * `expired` is true when this tab had a session before, so the login screen can say the session closed.
 */
export type SessionState =
  { status: 'signed_in'; session: SessionResponse } | { status: 'signed_out'; expired: boolean };

export const sessionQueryOptions = queryOptions({
  queryKey: SESSION_QUERY_KEY,
  queryFn: async ({ signal, client }): Promise<SessionState> => {
    try {
      const session = await apiRequest('/session', { schema: sessionResponseSchema, signal });
      return { status: 'signed_in', session };
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      const previous = client.getQueryData<SessionState>(SESSION_QUERY_KEY);
      const expired =
        previous !== undefined && (previous.status === 'signed_in' || previous.expired);
      return { status: 'signed_out', expired };
    }
  },
});

/** Remembers the company the panel opens next time (PUT /api/session/company). */
export async function rememberCompany(companyId: string): Promise<void> {
  const body = setCompanyRequestSchema.parse({ companyId });
  await apiRequest('/session/company', { method: 'PUT', body, schema: z.undefined() });
}

/**
 * Closes this session, or every session of the person. A 401 on the single sign-out means the
 * session is already closed, which is the goal. A 401 on "close all" is not swallowed: the person
 * has to sign in again before other sessions can be closed.
 */
export async function signOut(scope: 'this' | 'all'): Promise<void> {
  try {
    await apiRequest(scope === 'all' ? '/auth/logout-all' : '/auth/logout', {
      method: 'POST',
      schema: z.undefined(),
    });
  } catch (error) {
    if (scope === 'this' && isUnauthorized(error)) return;
    throw error;
  }
}

/**
 * Remembers the chosen company on the server and in the cached session, so "/" opens it next time.
 * A failure is not shown: it only changes the default for the next visit.
 */
export function useRememberCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rememberCompany,
    onSuccess: (_data, companyId) => {
      queryClient.setQueryData<SessionState>(SESSION_QUERY_KEY, (previous) =>
        previous?.status === 'signed_in'
          ? { ...previous, session: { ...previous.session, lastCompanyId: companyId } }
          : previous,
      );
    },
  });
}

/** The company the panel opens by default: the remembered one, or the only one. Otherwise the picker. */
export function defaultCompany(session: SessionResponse): MembershipSummary | undefined {
  const remembered = session.memberships.find((m) => m.companyId === session.lastCompanyId);
  if (remembered) return remembered;
  if (session.memberships.length === 1) return session.memberships[0];
  return undefined;
}

/** Name shown for a membership. The founder's private space has a fixed name in the panel. */
export function companyLabel(membership: Pick<MembershipSummary, 'kind' | 'name'>): string {
  return membership.kind === 'private_space' ? 'Kurucu alanı' : membership.name;
}

/** Signed-in session, provided by the authenticated layout. */
export const SessionContext = createContext<SessionResponse | null>(null);

export function useSession(): SessionResponse {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside the authenticated layout');
  return session;
}

/** The company in the URL (/c/$company), provided by the company layout. */
export const CompanyContext = createContext<MembershipSummary | null>(null);

export function useCompany(): MembershipSummary {
  const company = useContext(CompanyContext);
  if (!company) throw new Error('useCompany must be used inside the company layout');
  return company;
}

export function useOptionalCompany(): MembershipSummary | null {
  return useContext(CompanyContext);
}
