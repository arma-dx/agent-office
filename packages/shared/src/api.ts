import { z } from 'zod';

/**
 * Request and response shapes shared by the API (apps/api) and the panel (apps/web).
 * The API validates every request body with these schemas; the panel validates every response.
 */

/** Header that carries the company selected in the panel. The API checks it against memberships. */
export const COMPANY_HEADER = 'x-company-id';

export const roleSchema = z.enum(['founder', 'employee', 'external']);
export type Role = z.output<typeof roleSchema>;

export const companyKindSchema = z.enum(['company', 'private_space']);

/** Error body for every 4xx and 5xx response. `message` is Turkish and safe to show to the user. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.output<typeof apiErrorSchema>;

export const membershipSummarySchema = z.object({
  companyId: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: companyKindSchema,
  role: roleSchema,
  canApprove: z.boolean(),
});
export type MembershipSummary = z.output<typeof membershipSummarySchema>;

/** GET /api/session: the signed-in person and the companies they can open. 401 when signed out. */
export const sessionResponseSchema = z.object({
  user: z.object({ id: z.uuid(), name: z.string() }),
  memberships: z.array(membershipSummarySchema),
  lastCompanyId: z.uuid().nullable(),
});
export type SessionResponse = z.output<typeof sessionResponseSchema>;

/** PUT /api/session/company: remembers the default company for the next sign-in. 204. */
export const setCompanyRequestSchema = z.strictObject({ companyId: z.uuid() });

/** Query value of /login?status=... after the Google callback. */
export const loginStatusSchema = z.enum(['denied', 'unavailable', 'expired', 'signed_out']);
export type LoginStatus = z.output<typeof loginStatusSchema>;

export const invitationStatusSchema = z.enum(['pending', 'expired', 'accepted', 'cancelled']);

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(['employee', 'external']),
  canApprove: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  status: invitationStatusSchema,
});
export type Invitation = z.output<typeof invitationSchema>;

/** GET /api/invitations (founder of the selected company). */
export const invitationListSchema = z.object({ invitations: z.array(invitationSchema) });

/** POST /api/invitations. 201 with the invitation; 409 when a pending one exists for the address. */
export const createInvitationRequestSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  role: z.enum(['employee', 'external']),
  canApprove: z.boolean().default(false),
});
export type CreateInvitationRequest = z.input<typeof createInvitationRequestSchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  role: roleSchema,
  canApprove: z.boolean(),
  active: z.boolean(),
});
export type Member = z.output<typeof memberSchema>;

/** GET /api/members (founder of the selected company). */
export const memberListSchema = z.object({ members: z.array(memberSchema) });

/** PATCH /api/members/:userId. At least one field. Founder role is not granted through the panel. */
export const updateMemberRequestSchema = z
  .strictObject({
    role: z.enum(['employee', 'external']).optional(),
    canApprove: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.canApprove !== undefined, {
    message: 'At least one field is required',
  });
