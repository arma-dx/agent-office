import { z } from 'zod';
import { agentCodeSchema, unitCodeSchema } from './cards.ts';

/**
 * Request and response shapes shared by the API (apps/api) and the panel (apps/web).
 * The API validates every request body with these schemas; the panel validates every response.
 */

/** Header that carries the company selected in the panel. The API checks it against memberships. */
export const COMPANY_HEADER = 'x-company-id';

/**
 * Header the panel puts on a request it sends on a timer (the periodic refresh of a list), not
 * because the person did something. The API answers such a request as any other but does not count
 * it as activity: the session's 30 minute idle limit is not extended (rule 3). The value is not
 * read; the header can only make a session end sooner, never later, so it needs no trust.
 */
export const BACKGROUND_HEADER = 'x-background-refresh';

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
  // A member who is an external person, on a screen for the founder and employees only.
  'insiders_only',
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
  // Passkeys (3 October decision 7).
  'step_up_required',
  'step_up_failed',
  'no_passkey',
  'passkey_not_allowed',
  'passkey_limit',
  'passkey_exists',
  'passkey_registration_failed',
  'challenge_limit',
  // Passkey reset by a founder (5 October decision 3).
  'passkey_reset_self',
  'passkey_reset_not_allowed',
  // Requests (flow A) and their approvals.
  'request_closed',
  // Another person's act on the same request ended this one; the page is read again.
  'request_changed',
  'approval_closed',
  'option_required',
  'action_not_allowed',
  'agent_not_available',
  'agent_not_ready',
  'requests_not_open',
  'reason_required',
  'routing_not_possible',
  // The due day of a new request has already ended in the office's time zone.
  'due_date_past',
  // A comment on a request by somebody who is not its requester, its approver or the founder.
  'comment_not_allowed',
  // Projects and customers (8 October decisions 14 to 22).
  'customer_exists',
  'customer_not_found',
  'member_not_allowed',
  'own_project_membership',
  'project_customer_locked',
  // The project is not what the founder confirmed with the passkey; the page is read again.
  'project_changed',
  // A change of an AI permission met another transaction and was ended by the database; nothing
  // changed, the person tries again.
  'permission_busy',
  // A request names a project the person cannot read (hidden and missing are one answer).
  'project_not_available',
  // A closed project takes no new request.
  'project_closed',
  // No agent may work in the project the request names (rule 12).
  'project_ai_not_allowed',
  // The request is inside a project where agents may not work now: the act is not possible until
  // the permission is open again.
  'ai_permission_closed',
  // A request names a project whose AI spending limit is reached (8 October decision 17).
  'project_spending_limit_reached',
  // The request is inside such a project: an act that calls for an agent run is not possible
  // until the founder raises the limit.
  'spending_limit_reached',
  // Project members (8 October decision 44): who adds, removes and gives roles.
  'project_members_not_allowed',
  'project_manager_protected',
  'project_owner_fixed',
  'project_roles_not_allowed',
  // The members changed between the read and the act; the page is read again.
  'project_members_changed',
  // The budget of a project is changed by its owner, its managers and the founder.
  'project_budget_not_allowed',
  // A project holds at most 50 milestones.
  'milestone_limit',
  // The milestone was removed meanwhile; the page is read again.
  'milestone_not_found',
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

/**
 * GET /api/auth/google?next=...: the panel page to open after the sign-in, for example
 * /c/armadx/settings/security (the first passkey is added within 10 minutes of a sign-in). Only a
 * company page of the panel: a path of lowercase letters, digits, "_" and "-" segments under /c/,
 * never another site. Anything else opens the panel's start page.
 */
export const loginReturnPathSchema = z
  .string()
  .max(200)
  .regex(/^\/c\/[a-z][a-z0-9_]*(\/[a-z0-9_-]+)*$/);

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

/** The fields of a new invitation (the panel's form): the address, the role, the approval right. */
export const invitationFieldsSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  role: z.enum(['employee', 'external']),
  canApprove: z.boolean().default(false),
});
export type InvitationFields = z.output<typeof invitationFieldsSchema>;

// Passkeys and re-verification (3 October decision 7; 5 October decisions 2, 3, 4) --------------

/*
 * Approvals that involve money, leave the company or change a source of truth note, membership
 * changes, passkey changes, a founder's reset of a person's passkeys, opening a task or a note to
 * an external person, opening the AI permission of a project or of a customer (8 October
 * decision 22), and raising or removing the AI spending limit of a project (8 October decision
 * 17) need a re-verification with a passkey (WebAuthn). The panel asks for a
 * challenge (POST /api/step-up/options), lets the browser sign it (startAuthentication of
 * @simplewebauthn/browser) and sends the result as `stepUp` in the body of the action it confirms.
 * The API recomputes what was confirmed from the action's own request and refuses anything else.
 */

const base64urlSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

// The browser reports the credential id as base64url (of at most 1023 bytes).
const credentialIdSchema = base64urlSchema(1366);

/**
 * What startAuthentication of @simplewebauthn/browser returns. Only its shape is checked here; the
 * API verifies the content (signature, challenge, origin, user handle) with @simplewebauthn/server.
 */
export const authenticationResponseSchema = z.looseObject({
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64urlSchema(4096),
    authenticatorData: base64urlSchema(4096),
    signature: base64urlSchema(4096),
    userHandle: base64urlSchema(128).nullish(),
  }),
});
export type AuthenticationResponse = z.output<typeof authenticationResponseSchema>;

/** What startRegistration of @simplewebauthn/browser returns; the API verifies it. */
export const registrationResponseSchema = z.looseObject({
  id: credentialIdSchema,
  rawId: credentialIdSchema,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64urlSchema(4096),
    attestationObject: base64urlSchema(32768),
    transports: z.array(z.string().max(32)).max(16).optional(),
  }),
});
export type RegistrationResponse = z.output<typeof registrationResponseSchema>;

/** A signed re-verification, sent with the action it confirms. Each one is used once. */
export const stepUpSchema = z.strictObject({
  challengeId: z.uuid(),
  response: authenticationResponseSchema,
});
export type StepUp = z.output<typeof stepUpSchema>;

export const stepUpPurposeSchema = z.enum([
  'approve',
  'membership_change',
  'invitation',
  'passkey_add',
  'passkey_revoke',
  // 5 October decisions 3 and 4.
  'passkey_reset',
  'access_grant',
  // 8 October decision 22.
  'project_ai_permission',
  'customer_ai_permission',
  // 8 October decision 17: raising or removing the AI spending limit of a project.
  'project_ai_spending_limit',
]);
export type StepUpPurpose = z.output<typeof stepUpPurposeSchema>;

/** The purposes that belong to a company: their re-verification names the company. */
const COMPANY_STEP_UP_PURPOSES: readonly StepUpPurpose[] = [
  'approve',
  'membership_change',
  'invitation',
  'passkey_reset',
  'access_grant',
  'project_ai_permission',
  'customer_ai_permission',
  'project_ai_spending_limit',
];

const STEP_UP_DETAIL_LIMIT = 20;

/** What the person confirms beyond the subject: a flat record of short values. */
export const stepUpDetailsSchema = z
  .record(
    z.string().min(1).max(64),
    z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
  )
  .refine((details) => Object.keys(details).length <= STEP_UP_DETAIL_LIMIT, {
    message: `At most ${String(STEP_UP_DETAIL_LIMIT)} details`,
  });
export type StepUpDetails = z.output<typeof stepUpDetailsSchema>;

/**
 * What a membership change re-verification confirms: the change exactly as PATCH (update) or
 * DELETE (remove) /api/members/:userId carries it. Build it with memberChangeDetails.
 */
export const memberChangeDetailsSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('update'),
    role: z.enum(['employee', 'external']).optional(),
    canApprove: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal('remove') }),
]);
export type MemberChangeDetails = z.output<typeof memberChangeDetailsSchema>;

/** The details of a member change, for POST /api/step-up/options; the API builds the same. */
export function memberChangeDetails(
  change:
    { role?: 'employee' | 'external' | undefined; canApprove?: boolean | undefined } | 'remove',
): MemberChangeDetails {
  if (change === 'remove') {
    return { action: 'remove' };
  }
  return {
    action: 'update',
    ...(change.role !== undefined ? { role: change.role } : {}),
    ...(change.canApprove !== undefined ? { canApprove: change.canApprove } : {}),
  };
}

/**
 * What an invitation re-verification confirms: a new invitation exactly as POST /api/invitations
 * carries it (create), or a renewal (renew). Build it with invitationChangeDetails. An invitation
 * becomes a membership, with its role and approval right, at the first sign-in of the address, so
 * creating or renewing one is a membership change (3 October decision 7).
 */
export const invitationChangeDetailsSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    email: z.string().max(254),
    role: z.enum(['employee', 'external']),
    canApprove: z.boolean(),
  }),
  z.strictObject({ action: z.literal('renew') }),
]);
export type InvitationChangeDetails = z.output<typeof invitationChangeDetailsSchema>;

/** The details of an invitation change, for POST /api/step-up/options; the API builds the same. */
export function invitationChangeDetails(
  change: InvitationFields | 'renew',
): InvitationChangeDetails {
  if (change === 'renew') {
    return { action: 'renew' };
  }
  return {
    action: 'create',
    email: change.email,
    role: change.role,
    canApprove: change.canApprove,
  };
}

/**
 * What an access grant re-verification confirms beyond the person (the subject): the task or the
 * note that is opened to them. Build it with accessGrantDetails. Opening a record to an external
 * person opens it outside the company (5 October decision 4), so each grant is confirmed for
 * exactly one record.
 */
export const accessGrantDetailsSchema = z.strictObject({
  recordType: z.enum(['task', 'note']),
  recordId: z.uuid(),
});
export type AccessGrantDetails = z.output<typeof accessGrantDetailsSchema>;

/** The details of an access grant, for POST /api/step-up/options; the API builds the same. */
export function accessGrantDetails(record: {
  recordType: 'task' | 'note';
  recordId: string;
}): AccessGrantDetails {
  return { recordType: record.recordType, recordId: record.recordId };
}

/**
 * What a project_ai_permission re-verification confirms beyond the project (the subject): that its
 * AI permission is opened, and for which customer. Rule 12 reads which customer a project has, so
 * the founder confirms the project WITH the customer it had on the page (null: no customer); the
 * opening is refused when the project has another one by then. Closing needs no re-verification,
 * so there is one action.
 */
export const projectAiPermissionDetailsSchema = z.strictObject({
  action: z.literal('open'),
  customerId: z.uuid().nullable(),
});
export type ProjectAiPermissionDetails = z.output<typeof projectAiPermissionDetailsSchema>;

/** The details of opening a project's AI permission; the API builds the same. */
export function projectAiPermissionDetails(customerId: string | null): ProjectAiPermissionDetails {
  return { action: 'open', customerId };
}

/**
 * What a project_ai_spending_limit re-verification confirms beyond the project (the subject): the
 * limit the founder is setting, in US dollars with two decimals, or null when the limit is taken
 * away. Build it with projectAiSpendingLimitDetails.
 */
export const projectAiSpendingLimitDetailsSchema = z.strictObject({
  action: z.literal('set_limit'),
  limitUsd: z
    .string()
    .regex(/^\d{1,6}\.\d{2}$/)
    .nullable(),
});
export type ProjectAiSpendingLimitDetails = z.output<typeof projectAiSpendingLimitDetailsSchema>;

/** "50" and "50.0" are the limit "50.00": one text for one amount, so one hash. */
export function normalizeUsdLimit(limitUsd: string): string {
  const [whole = '0', decimals = ''] = limitUsd.split('.');
  return `${whole}.${decimals.padEnd(2, '0')}`;
}

/** The details of a limit change, for POST /api/step-up/options; the API builds the same. */
export function projectAiSpendingLimitDetails(
  limitUsd: string | null,
): ProjectAiSpendingLimitDetails {
  return { action: 'set_limit', limitUsd: limitUsd === null ? null : normalizeUsdLimit(limitUsd) };
}

/**
 * What a customer_ai_permission re-verification confirms beyond the customer (the subject): the
 * permissions exactly as the request carries them. "create": a customer added with a new project
 * (POST /api/projects), by its name. "update": PATCH /api/customers/:customerId/permissions.
 */
export const customerPermissionDetailsSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    name: z.string().max(120),
    aiAllowed: z.literal(true),
    automatedProcessingAllowed: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('update'),
    aiAllowed: z.literal(true),
    automatedProcessingAllowed: z.boolean().optional(),
  }),
]);
export type CustomerPermissionDetails = z.output<typeof customerPermissionDetailsSchema>;

/** The details of opening a customer's AI permission; the API builds the same. */
export function customerPermissionDetails(
  change:
    | { name: string; automatedProcessingAllowed: boolean }
    | { automatedProcessingAllowed?: boolean | undefined },
): CustomerPermissionDetails {
  if ('name' in change) {
    return {
      action: 'create',
      name: change.name,
      aiAllowed: true,
      automatedProcessingAllowed: change.automatedProcessingAllowed,
    };
  }
  return {
    action: 'update',
    aiAllowed: true,
    ...(change.automatedProcessingAllowed !== undefined
      ? { automatedProcessingAllowed: change.automatedProcessingAllowed }
      : {}),
  };
}

/**
 * POST /api/step-up/options: a challenge for one re-verification, bound to what it confirms.
 *   approve            companyId, subjectId (the approval), details (the decision)
 *   membership_change  companyId, subjectId (the member), details (memberChangeDetails)
 *   invitation         companyId, subjectId (the invitation; a new one's id is chosen by the
 *                      panel), details (invitationChangeDetails)
 *   passkey_add        nothing else; then POST /api/passkeys/registration/options
 *   passkey_revoke     subjectId (the passkey's id); then DELETE /api/passkeys/:id
 *   passkey_reset      companyId, subjectId (the person whose passkeys are reset); then
 *                      POST /api/members/:userId/passkeys/reset
 *   access_grant       companyId, subjectId (the person the record is opened to), details
 *                      (accessGrantDetails: the task or the note)
 *   project_ai_permission   companyId, subjectId (the project), details
 *                           (projectAiPermissionDetails: the project's customer on the page);
 *                           then PUT /api/projects/:projectId/ai-permission
 *   customer_ai_permission  companyId, subjectId (the customer; a new one's id is chosen by the
 *                           panel), details (customerPermissionDetails)
 *   project_ai_spending_limit  companyId, subjectId (the project), details
 *                           (projectAiSpendingLimitDetails: the new limit, or null to remove it);
 *                           then PUT /api/projects/:projectId/ai-spending-limit
 * 409 no_passkey when the person has no passkey.
 */
export const stepUpOptionsRequestSchema = z
  .strictObject({
    purpose: stepUpPurposeSchema,
    companyId: z.uuid().optional(),
    subjectId: z.uuid().optional(),
    details: stepUpDetailsSchema.optional(),
  })
  .superRefine((body, ctx) => {
    const forCompany = COMPANY_STEP_UP_PURPOSES.includes(body.purpose);
    if (forCompany !== (body.companyId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['companyId'],
        message: forCompany ? 'Required for this purpose' : 'Not allowed for this purpose',
      });
    }
    const hasSubject = body.purpose !== 'passkey_add';
    if (hasSubject !== (body.subjectId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: hasSubject ? 'Required for this purpose' : 'Not allowed for this purpose',
      });
    }
    if (
      body.purpose === 'membership_change' &&
      !memberChangeDetailsSchema.safeParse(body.details).success
    ) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Must be a member change' });
    }
    if (
      body.purpose === 'invitation' &&
      !invitationChangeDetailsSchema.safeParse(body.details).success
    ) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Must be an invitation change' });
    }
    if (
      body.purpose === 'access_grant' &&
      !accessGrantDetailsSchema.safeParse(body.details).success
    ) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Must be an access grant' });
    }
    if (
      body.purpose === 'project_ai_permission' &&
      !projectAiPermissionDetailsSchema.safeParse(body.details).success
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['details'],
        message: 'Must open a project AI permission',
      });
    }
    if (
      body.purpose === 'customer_ai_permission' &&
      !customerPermissionDetailsSchema.safeParse(body.details).success
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['details'],
        message: 'Must open a customer AI permission',
      });
    }
    if (
      body.purpose === 'project_ai_spending_limit' &&
      !projectAiSpendingLimitDetailsSchema.safeParse(body.details).success
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['details'],
        message: 'Must be a spending limit change',
      });
    }
    if (
      (body.purpose === 'passkey_add' ||
        body.purpose === 'passkey_revoke' ||
        body.purpose === 'passkey_reset') &&
      body.details !== undefined
    ) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Not allowed for this purpose' });
    }
  });
export type StepUpOptionsRequest = z.input<typeof stepUpOptionsRequestSchema>;

/** Options for startAuthentication (optionsJSON). The challenge is valid for 5 minutes. */
export const stepUpOptionsResponseSchema = z.object({
  challengeId: z.uuid(),
  options: z.looseObject({
    challenge: z.string(),
    rpId: z.string().optional(),
    allowCredentials: z
      .array(z.looseObject({ id: z.string(), type: z.literal('public-key') }))
      .optional(),
    userVerification: z.enum(['required', 'preferred', 'discouraged']).optional(),
    timeout: z.number().optional(),
  }),
});
export type StepUpOptionsResponse = z.output<typeof stepUpOptionsResponseSchema>;

// Control characters, line and paragraph separators and bidirectional overrides; the database
// refuses them too.
export function hasHiddenCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

/** The person's own label for a passkey, shown in the passkey list. */
export const passkeyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((name) => !hasHiddenCharacter(name), { message: 'Must not contain hidden characters' });

/** A passkey of the signed-in person. `id` is the passkey's reference, not the credential id. */
export const passkeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
  deviceType: z.enum(['singleDevice', 'multiDevice']),
  backedUp: z.boolean(),
});
export type Passkey = z.output<typeof passkeySchema>;

/** GET /api/passkeys: the person's active passkeys. Registering on two devices is recommended. */
export const passkeyListSchema = z.object({ passkeys: z.array(passkeySchema) });

/**
 * POST /api/passkeys/registration/options. The first passkey only within 10 minutes of a Google
 * sign-in (403 passkey_not_allowed after that); every further one with a passkey_add
 * re-verification in stepUp (403 step_up_required without it). 409 passkey_limit at 10 passkeys.
 */
export const registrationOptionsRequestSchema = z.strictObject({
  name: passkeyNameSchema,
  stepUp: stepUpSchema.optional(),
});
export type RegistrationOptionsRequest = z.input<typeof registrationOptionsRequestSchema>;

/** Options for startRegistration (optionsJSON). The challenge is valid for 5 minutes. */
export const registrationOptionsResponseSchema = z.object({
  challengeId: z.uuid(),
  options: z.looseObject({
    challenge: z.string(),
    rp: z.looseObject({ name: z.string(), id: z.string().optional() }),
    user: z.looseObject({ id: z.string(), name: z.string(), displayName: z.string() }),
    pubKeyCredParams: z.array(z.looseObject({ alg: z.number(), type: z.literal('public-key') })),
  }),
});
export type RegistrationOptionsResponse = z.output<typeof registrationOptionsResponseSchema>;

/**
 * POST /api/passkeys/registration: 201 with the passkey. `name` must be the one the options were
 * made for (the challenge is bound to it).
 */
export const registrationRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  name: passkeyNameSchema,
  response: registrationResponseSchema,
});
export type RegistrationRequest = z.input<typeof registrationRequestSchema>;

/**
 * DELETE /api/passkeys/:id: 204. Needs a passkey_revoke re-verification naming that passkey; the
 * last passkey can be removed too (a new first passkey then needs a fresh Google sign-in).
 */
export const revokePasskeyRequestSchema = z.strictObject({ stepUp: stepUpSchema.optional() });

// Invitations -----------------------------------------------------------------------------------

/**
 * POST /api/invitations. 201 with the invitation; 409 invitation_exists when the address already
 * has an invitation that is neither accepted nor cancelled, expired ones included (cancel it first).
 * `id` is the new invitation's id, chosen by the panel (a random version 4 UUID), so that the
 * invitation re-verification in stepUp can name it, with invitationChangeDetails of exactly these
 * fields (403 step_up_required without it).
 */
export const createInvitationRequestSchema = invitationFieldsSchema.extend({
  id: z.uuid(),
  stepUp: stepUpSchema.optional(),
});
export type CreateInvitationRequest = z.input<typeof createInvitationRequestSchema>;

/**
 * POST /api/invitations/:id/renew (JSON body): seven more days, never beyond 30 days after the
 * invitation was created. Needs an invitation re-verification in stepUp for this invitation and
 * invitationChangeDetails('renew') (403 step_up_required without it). Cancelling needs none.
 */
export const renewInvitationRequestSchema = z.strictObject({ stepUp: stepUpSchema.optional() });

// Members ---------------------------------------------------------------------------------------

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
 * PATCH /api/members/:userId. At least one of role and canApprove. The founder role is neither
 * granted nor taken through the panel: a founder's membership cannot be changed or removed
 * (409 founder_membership). Needs a membership_change re-verification in stepUp for this member and
 * memberChangeDetails({ role, canApprove }) (403 step_up_required without it).
 */
export const updateMemberRequestSchema = z
  .strictObject({
    role: z.enum(['employee', 'external']).optional(),
    canApprove: z.boolean().optional(),
    stepUp: stepUpSchema.optional(),
  })
  .refine((body) => body.role !== undefined || body.canApprove !== undefined, {
    message: 'At least one field is required',
  });

/**
 * DELETE /api/members/:userId (JSON body): 204. Needs a membership_change re-verification in stepUp
 * for this member and memberChangeDetails('remove') (403 step_up_required without it).
 */
export const removeMemberRequestSchema = z.strictObject({ stepUp: stepUpSchema.optional() });

/**
 * POST /api/members/:userId/passkeys/reset (founder of the selected company): 204. Removes every
 * passkey of the person and closes their open sessions (5 October decision 3); the reset is
 * written to the company's audit log and the person gets a notification. The person signs in with
 * Google again and adds a first passkey within 10 minutes. Needs a passkey_reset re-verification
 * in stepUp for this member (403 step_up_required without it). 409 passkey_reset_self for the
 * founder's own passkeys, 409 passkey_reset_not_allowed for a person whose passkeys cannot be reset
 * from the panel (another founder, answered before the passkey is asked for; any other such person
 * only after the passkey checked out, with the same message, which gives no reason), 404 for a
 * person who is not a member of the selected company. A founder's passkeys are reset by the
 * database administrator.
 */
export const resetPasskeysRequestSchema = z.strictObject({ stepUp: stepUpSchema.optional() });

// Office view (module M15; 5 October decisions 9 and 14) ------------------------------------------

/** The company's switch for an agent (company_agents.status). */
export const companyAgentStatusSchema = z.enum(['disabled', 'enabled', 'stopped']);
export type CompanyAgentStatus = z.output<typeof companyAgentStatusSchema>;

export const officeAgentSchema = z.object({
  code: agentCodeSchema,
  name: z.string(),
  // null: the company has no company_agents row for this agent.
  status: companyAgentStatusSchema.nullable(),
  // The agent's card has a version to run with. An agent that is not ready cannot be opened (the
  // switch answers 409 agent_not_ready): the panel says so instead of offering the button. Only
  // the missing version decides this, never the status written on the card.
  ready: z.boolean(),
});
export type OfficeAgent = z.output<typeof officeAgentSchema>;

export const officeUnitSchema = z.object({
  code: unitCodeSchema,
  name: z.string(),
  // In the order of the number at the end of the code. Never empty: a unit without an agent for
  // the company is not part of the answer.
  agents: z.array(officeAgentSchema).min(1),
});
export type OfficeUnit = z.output<typeof officeUnitSchema>;

/**
 * At most this many open requests are looked at for the live states of the office, the one that
 * has not moved for longest first (the order of the Bugün list).
 */
export const OFFICE_REQUEST_LIMIT = 200;

/**
 * How many open requests an agent has in one condition. `requestId` is the request itself when
 * exactly one is counted, so that the panel can lead to it; null for none and for several.
 */
export const officeWorkCountSchema = z
  .object({
    count: z.number().int().nonnegative(),
    requestId: z.uuid().nullable(),
  })
  .refine((value) => (value.requestId !== null) === (value.count === 1), {
    message: 'requestId is set exactly when one request is counted',
  });
export type OfficeWorkCount = z.output<typeof officeWorkCountSchema>;

/**
 * The open requests of one agent as the reader may see them (8 October decision 10; docs/SONRA.md
 * W-d and W-e), counted by where each request is (deriveStage):
 *   running           the agent has the turn: the coordinator routes, the unit's agent works or
 *                     revises (also while its run waits on the queue);
 *   awaitingApproval  the agent's result waits for the decision of the unit's approver;
 *   failed            the request fell to a person because of the agent's run: it failed, hit its
 *                     limit, or ended without submitting a result.
 * Ids and numbers only: nothing an agent wrote and no title.
 */
export const officeAgentWorkSchema = z.object({
  agentCode: agentCodeSchema,
  running: officeWorkCountSchema,
  awaitingApproval: officeWorkCountSchema,
  failed: officeWorkCountSchema,
});
export type OfficeAgentWork = z.output<typeof officeAgentWorkSchema>;

/**
 * GET /api/office: the units and agents of the selected company, units shared by every company
 * first, each group by code. Founder or employee; 403 insiders_only for an external person. Never
 * carries another company's units, agents or switches.
 *
 * `work` lists the agents of `units` that have at least one open request to count, in the order of
 * `units`; an agent that is not listed has none. It is computed for the reader: a request the
 * reader may not read (another project's) is not counted. `workTruncated` is true when the company
 * has more open requests than OFFICE_REQUEST_LIMIT, so the numbers may be too small.
 */
export const officeResponseSchema = z.object({
  units: z.array(officeUnitSchema),
  work: z.array(officeAgentWorkSchema),
  workTruncated: z.boolean(),
});
export type OfficeResponse = z.output<typeof officeResponseSchema>;

/**
 * PUT /api/agents/:agentCode/switch: the founder opens an agent for the company or stops it (rule:
 * every agent has a stop switch per company; the switch is the company_agents row). A stopped
 * agent takes no new work and its open run ends before its next step.
 *
 * With `onlyIfOpen` a stop changes the switch only where the agent is open ("Her yerde durdur",
 * 8 October decision 9): an agent that is closed, stopped or was never opened in this company is
 * left exactly as it is, nothing is written to the audit log, and the answer says what the switch
 * is. Without it a stop also stops an agent that was never opened, as before.
 */
export const agentSwitchRequestSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('enabled') }),
  z.strictObject({ status: z.literal('stopped'), onlyIfOpen: z.boolean().optional() }),
]);
export type AgentSwitchRequest = z.input<typeof agentSwitchRequestSchema>;

/**
 * The answer of a stop with `onlyIfOpen`: the agent as the office lists it, with the switch as it
 * is now, and whether this request is what stopped it. `changed` is false for an agent that was
 * already stopped, closed or never opened here, so the panel can tell "durduruldu" from "zaten
 * durdurulmuş" by the server's word and not by what it read a moment ago.
 */
export const agentStopIfOpenResponseSchema = officeAgentSchema.extend({ changed: z.boolean() });
export type AgentStopIfOpenResponse = z.output<typeof agentStopIfOpenResponseSchema>;

/**
 * The answer of an opening ({ status: 'enabled' }): the agent as the office lists it, and how
 * many waiting requests were started again by this opening (8 October decision 49). 0 when the
 * agent was already open or nothing waited for it.
 */
export const agentOpenResponseSchema = officeAgentSchema.extend({
  restarted: z.number().int().nonnegative(),
});
export type AgentOpenResponse = z.output<typeof agentOpenResponseSchema>;

/**
 * GET /api/waiting-work?agent=<code> | ?project=<id> | ?customer=<id> (the founder): how many
 * waiting requests would start if that agent, that project's AI permission or that customer's AI
 * permission were opened now (8 October decision 49). Exactly one of the three.
 */
export const waitingWorkQuerySchema = z.union([
  z.strictObject({ agent: agentCodeSchema }),
  z.strictObject({ project: z.uuid() }),
  z.strictObject({ customer: z.uuid() }),
]);
export type WaitingWorkQuery = z.output<typeof waitingWorkQuerySchema>;

export const waitingWorkResponseSchema = z.strictObject({
  waiting: z.number().int().nonnegative(),
});
export type WaitingWorkResponse = z.output<typeof waitingWorkResponseSchema>;
