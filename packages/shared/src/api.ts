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

/**
 * Every error code the API sends. The API may only use these; the panel's test doubles use them
 * too, so a test cannot invent a code the API never sends. The body schema below still accepts any
 * string, so a newer API code does not break an older panel.
 */
export const apiErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'founder_only',
  'cross_site_request',
  'invalid_request',
  'not_found',
  'unsupported_media_type',
  'payload_too_large',
  'rate_limited',
  'internal_error',
  'invitation_exists',
  'invitation_closed',
  'invitation_limit',
  'approval_only_employee',
  'private_space',
  'last_founder',
  'founder_membership',
  'member_in_use',
]);
export type ApiErrorCode = z.output<typeof apiErrorCodeSchema>;

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

/**
 * PUT /api/session/company: remembers the default company for this session and, in this browser,
 * for the next sign-in (only while the person is still a member). 204.
 */
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

/**
 * POST /api/invitations. 201 with the invitation; 409 invitation_exists when the address already
 * has an invitation that is neither accepted nor cancelled, expired ones included (cancel it first).
 */
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

/**
 * PATCH /api/members/:userId. At least one field. The founder role is neither granted nor taken
 * through the panel: a founder's membership cannot be changed or removed (409 founder_membership).
 */
export const updateMemberRequestSchema = z
  .strictObject({
    role: z.enum(['employee', 'external']).optional(),
    canApprove: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.canApprove !== undefined, {
    message: 'At least one field is required',
  });
