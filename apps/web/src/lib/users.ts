import {
  createInvitationRequestSchema,
  invitationListSchema,
  invitationSchema,
  memberListSchema,
  memberSchema,
  removeMemberRequestSchema,
  renewInvitationRequestSchema,
  resetPasskeysRequestSchema,
  updateMemberRequestSchema,
  type Invitation,
  type Member,
  type Role,
  type StepUp,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from './api.ts';

// Members and invitations of one company. Every request carries the company id in the header.

export function membersQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: ['company', companyId, 'members'] as const,
    queryFn: async ({ signal }): Promise<Member[]> =>
      (await apiRequest('/members', { schema: memberListSchema, companyId, signal })).members,
  });
}

export function invitationsQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: ['company', companyId, 'invitations'] as const,
    queryFn: async ({ signal }): Promise<Invitation[]> =>
      (await apiRequest('/invitations', { schema: invitationListSchema, companyId, signal }))
        .invitations,
  });
}

/**
 * POST /api/invitations. `id` is the new invitation's id, chosen by the panel; the invitation goes
 * with an invitation re-verification naming that id and invitationChangeDetails of these fields.
 */
export function createInvitation(
  companyId: string,
  request: z.input<typeof createInvitationRequestSchema>,
): Promise<Invitation> {
  const body = createInvitationRequestSchema.parse(request);
  return apiRequest('/invitations', { method: 'POST', body, schema: invitationSchema, companyId });
}

/** POST /api/invitations/:id/renew with an invitation re-verification of invitationChangeDetails('renew'). */
export function renewInvitation(
  companyId: string,
  invitationId: string,
  stepUp: StepUp,
): Promise<Invitation> {
  const id = z.uuid().parse(invitationId);
  const body = renewInvitationRequestSchema.parse({ stepUp });
  return apiRequest(`/invitations/${id}/renew`, {
    method: 'POST',
    body,
    schema: invitationSchema,
    companyId,
  });
}

export function cancelInvitation(companyId: string, invitationId: string): Promise<undefined> {
  const id = z.uuid().parse(invitationId);
  return apiRequest(`/invitations/${id}/cancel`, {
    method: 'POST',
    schema: z.undefined(),
    companyId,
  });
}

/**
 * PATCH /api/members/:userId. The change goes with a membership_change re-verification for this
 * member and memberChangeDetails of exactly this change.
 */
export function updateMember(
  companyId: string,
  userId: string,
  changes: z.input<typeof updateMemberRequestSchema>,
): Promise<Member> {
  const id = z.uuid().parse(userId);
  const body = updateMemberRequestSchema.parse(changes);
  return apiRequest(`/members/${id}`, { method: 'PATCH', body, schema: memberSchema, companyId });
}

/** DELETE /api/members/:userId with a membership_change re-verification of memberChangeDetails('remove'). */
export function removeMember(
  companyId: string,
  userId: string,
  stepUp: StepUp,
): Promise<undefined> {
  const id = z.uuid().parse(userId);
  const body = removeMemberRequestSchema.parse({ stepUp });
  return apiRequest(`/members/${id}`, {
    method: 'DELETE',
    body,
    schema: z.undefined(),
    companyId,
  });
}

/**
 * POST /api/members/:userId/passkeys/reset with a passkey_reset re-verification naming the member
 * (5 October decision 3): every passkey of the person is removed and their sessions close.
 */
export function resetMemberPasskeys(
  companyId: string,
  userId: string,
  stepUp: StepUp,
): Promise<undefined> {
  const id = z.uuid().parse(userId);
  const body = resetPasskeysRequestSchema.parse({ stepUp });
  return apiRequest(`/members/${id}/passkeys/reset`, {
    method: 'POST',
    body,
    schema: z.undefined(),
    companyId,
  });
}

export const ROLE_LABELS: Record<Role, string> = {
  founder: 'Kurucu',
  employee: 'Çalışan',
  external: 'Dış kişi',
};

export const INVITATION_STATUS_LABELS: Record<Invitation['status'], string> = {
  pending: 'Bekliyor',
  expired: 'Süresi doldu',
  accepted: 'Kabul edildi',
  cancelled: 'İptal edildi',
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "10 Ekim 2026" */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/**
 * "10 Ekim 2026 12:00", in the viewer's time zone. An invitation ends at the hour it was created,
 * not at the end of the day, so its end is always shown with the time.
 */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** An invitation is valid for 7 days and renewable up to 30 days after it was created. */
export const INVITATION_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the founder can do with an invitation. One that is neither accepted nor cancelled stays
 * open after it expires and keeps its address from being invited again, so it can always be
 * cancelled. Its time can be extended only while that changes something: before the 30-day limit,
 * and while it ends before that limit.
 */
export function invitationActions(
  invitation: Invitation,
  now: number = Date.now(),
): { canExtend: boolean; canCancel: boolean } {
  const open = invitation.status === 'pending' || invitation.status === 'expired';
  const limit = Date.parse(invitation.createdAt) + INVITATION_MAX_DAYS * DAY_MS;
  return {
    canExtend: open && now < limit && Date.parse(invitation.expiresAt) < limit,
    canCancel: open,
  };
}
