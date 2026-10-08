import { z } from 'zod';
import { hasHiddenCharacter, stepUpSchema } from './api.ts';
import { taskPersonSchema } from './tasks.ts';

/**
 * Projects (8 October decisions 11 and 14 to 22), step 1: the list, a new project, the project
 * page, its members and the AI permission. The API validates every body with these schemas and
 * builds every answer with them; the panel validates every answer.
 *
 * No body here sets the AI permission of a project except the one made for it, and none sets a
 * customer's contract permissions except the founder's two (a customer added with a new project,
 * and the permissions route).
 */

// The fixed sets -----------------------------------------------------------------------------------

/** The values the database holds (projects.status); labels are the panel's. */
export const projectStatusSchema = z.enum([
  'backlog',
  'planned',
  'in_progress',
  'completed',
  'cancelled',
]);
export type ProjectStatus = z.output<typeof projectStatusSchema>;
export const PROJECT_STATUSES = projectStatusSchema.options;
export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'planned';

/** The statuses that close a project (docs/SONRA.md P-c); the database derives the same. */
export const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = ['completed', 'cancelled'];
export function isClosedProjectStatus(status: ProjectStatus): boolean {
  return CLOSED_PROJECT_STATUSES.includes(status);
}

export const projectColorSchema = z.enum([
  'gray',
  'red',
  'orange',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
]);
export type ProjectColor = z.output<typeof projectColorSchema>;
export const PROJECT_COLORS = projectColorSchema.options;
export const DEFAULT_PROJECT_COLOR: ProjectColor = 'gray';

export const projectIconSchema = z.enum([
  'folder',
  'briefcase',
  'code',
  'globe',
  'megaphone',
  'wrench',
  'chart',
  'document',
  'pin',
  'bolt',
  'people',
  'box',
]);
export type ProjectIcon = z.output<typeof projectIconSchema>;
export const PROJECT_ICONS = projectIconSchema.options;
export const DEFAULT_PROJECT_ICON: ProjectIcon = 'folder';

// Fields -------------------------------------------------------------------------------------------

export const PROJECT_NAME_MAX = 120;
export const PROJECT_DESCRIPTION_MAX = 5000;
export const CUSTOMER_NAME_MAX = 120;
/** How many people a new project can name as members besides its opener. */
export const PROJECT_MEMBER_MAX = 50;
export const PROJECT_LIST_LIMIT = 500;

const NO_HIDDEN = { message: 'Must not contain hidden characters' };

export const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_NAME_MAX)
  .refine((name) => !hasHiddenCharacter(name), NO_HIDDEN);

export const customerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CUSTOMER_NAME_MAX)
  .refine((name) => !hasHiddenCharacter(name), NO_HIDDEN);

/** Free text with line breaks; empty means "no description". PostgreSQL text cannot hold NUL. */
export const projectDescriptionSchema = z
  .string()
  .max(PROJECT_DESCRIPTION_MAX)
  .refine((text) => !text.includes('\u0000'), { message: 'Must not contain the NUL character' });

/** A day without a time: YYYY-MM-DD. */
export const projectDaySchema = z.iso.date();

/**
 * The customer of a new project (decision 16): none, one that exists, or a new one by name. The
 * panel chooses a new customer's id. Its two contract permissions may be true only when the
 * founder sends the request (403 founder_only otherwise); aiAllowed true needs a
 * customer_ai_permission re-verification in stepUp naming that id, with customerPermissionDetails
 * of the name and automatedProcessingAllowed.
 */
export const newProjectCustomerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('existing'), customerId: z.uuid() }),
  z.strictObject({
    kind: z.literal('new'),
    id: z.uuid(),
    name: customerNameSchema,
    aiAllowed: z.boolean().default(false),
    automatedProcessingAllowed: z.boolean().default(false),
  }),
]);
export type NewProjectCustomer = z.input<typeof newProjectCustomerSchema>;

/** The customer of a project that is edited: a new one starts with both permissions closed. */
export const changedProjectCustomerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('existing'), customerId: z.uuid() }),
  z.strictObject({ kind: z.literal('new'), id: z.uuid(), name: customerNameSchema }),
]);

/**
 * POST /api/projects. The id is chosen by the panel, so a send that is repeated answers the first
 * record and opens no second project. The opener is always a member; memberIds names the others.
 * There is no field for the AI permission: a project starts without it (docs/SONRA.md W-i).
 */
export const createProjectSchema = z.strictObject({
  id: z.uuid(),
  name: projectNameSchema,
  description: projectDescriptionSchema.default(''),
  customer: newProjectCustomerSchema.default({ kind: 'none' }),
  memberIds: z.array(z.uuid()).max(PROJECT_MEMBER_MAX).default([]),
  status: projectStatusSchema.default(DEFAULT_PROJECT_STATUS),
  color: projectColorSchema.default(DEFAULT_PROJECT_COLOR),
  icon: projectIconSchema.default(DEFAULT_PROJECT_ICON),
  targetDate: projectDaySchema.nullable().default(null),
  stepUp: stepUpSchema.optional(),
});
export type CreateProject = z.input<typeof createProjectSchema>;

/** PATCH /api/projects/:projectId: at least one field; a field left out is not changed. */
export const updateProjectSchema = z
  .strictObject({
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema.optional(),
    customer: changedProjectCustomerSchema.optional(),
    status: projectStatusSchema.optional(),
    color: projectColorSchema.optional(),
    icon: projectIconSchema.optional(),
    targetDate: projectDaySchema.nullable().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.description !== undefined ||
      body.customer !== undefined ||
      body.status !== undefined ||
      body.color !== undefined ||
      body.icon !== undefined ||
      body.targetDate !== undefined,
    { message: 'At least one field is required' },
  );
export type UpdateProject = z.input<typeof updateProjectSchema>;

/**
 * PUT /api/projects/:projectId/ai-permission (founder).
 *
 * Opening (allowed true) names the customer the project had on the founder's page (customerId;
 * null: no customer) and needs a project_ai_permission re-verification in stepUp for this project
 * with projectAiPermissionDetails(customerId) (403 step_up_required without it). When the project
 * has another customer by then the answer is 409 project_changed and the panel reads the project
 * again. Closing (allowed false) needs neither.
 */
export const projectAiPermissionSchema = z.discriminatedUnion('allowed', [
  z.strictObject({
    allowed: z.literal(true),
    customerId: z.uuid().nullable(),
    stepUp: stepUpSchema.optional(),
  }),
  z.strictObject({ allowed: z.literal(false) }),
]);
export type ProjectAiPermission = z.input<typeof projectAiPermissionSchema>;

/**
 * PATCH /api/customers/:customerId/permissions (founder): at least one of the two. aiAllowed true
 * on a customer whose AI permission is closed needs a customer_ai_permission re-verification in
 * stepUp for this customer with customerPermissionDetails of exactly this body.
 */
export const customerPermissionsSchema = z
  .strictObject({
    aiAllowed: z.boolean().optional(),
    automatedProcessingAllowed: z.boolean().optional(),
    stepUp: stepUpSchema.optional(),
  })
  .refine((body) => body.aiAllowed !== undefined || body.automatedProcessingAllowed !== undefined, {
    message: 'At least one permission is required',
  });
export type CustomerPermissions = z.input<typeof customerPermissionsSchema>;

// Answers ------------------------------------------------------------------------------------------

/** A customer with its contract permissions; the answer of the permissions route (founder). */
export const customerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  aiAllowed: z.boolean(),
  automatedProcessingAllowed: z.boolean(),
});
export type Customer = z.output<typeof customerSchema>;

/**
 * GET /api/customers: the customers of the selected company to choose from, by name. The founder
 * gets the two contract permissions; an employee gets the names only (both are null).
 */
export const customerOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  aiAllowed: z.boolean().nullable(),
  automatedProcessingAllowed: z.boolean().nullable(),
});
export type CustomerOption = z.output<typeof customerOptionSchema>;
export const customerListSchema = z.object({ customers: z.array(customerOptionSchema) });
export type CustomerList = z.output<typeof customerListSchema>;

/** GET /api/projects/member-candidates: the active founders and employees of the company. */
export const projectMemberCandidateSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  role: z.enum(['founder', 'employee']),
});
export type ProjectMemberCandidate = z.output<typeof projectMemberCandidateSchema>;
export const projectMemberCandidatesSchema = z.object({
  people: z.array(projectMemberCandidateSchema),
});

export const projectSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: projectStatusSchema,
  // completed or cancelled (derived by the database).
  closed: z.boolean(),
  color: projectColorSchema,
  icon: projectIconSchema,
  targetDate: projectDaySchema.nullable(),
  // The project's own AI permission.
  aiAllowed: z.boolean(),
  // Rule 12 as a whole: the project's permission and, if it has a customer, the customer's.
  agentsMayWork: z.boolean(),
  customer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  memberCount: z.number().int().min(0),
});
export type ProjectSummary = z.output<typeof projectSummarySchema>;

/** GET /api/projects: the projects the person may read; open ones first. */
export const projectListSchema = z.object({
  projects: z.array(projectSummarySchema),
  truncated: z.boolean(),
});
export type ProjectList = z.output<typeof projectListSchema>;

export const projectMemberSchema = z.object({
  userId: z.uuid(),
  // null: the name could not be read (the person is no member of the company any more).
  name: z.string().nullable(),
  role: z.enum(['founder', 'employee']).nullable(),
  // false: the person's account is deactivated.
  active: z.boolean(),
});
export type ProjectMember = z.output<typeof projectMemberSchema>;

/** One answer for the whole project page (GET, and the answer of every change of a project). */
export const projectDetailSchema = projectSummarySchema.extend({
  description: z.string().nullable(),
  customer: z
    .object({
      id: z.uuid(),
      name: z.string(),
      aiAllowed: z.boolean(),
      // null for a reader who is not the founder.
      automatedProcessingAllowed: z.boolean().nullable(),
    })
    .nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  // null: written without a person (an administrator).
  createdBy: taskPersonSchema.nullable(),
  members: z.array(projectMemberSchema),
  actions: z.object({
    // Name, description, customer, status, colour, icon, target date.
    edit: z.boolean(),
    manageMembers: z.boolean(),
    // The founder alone.
    setAiPermission: z.boolean(),
    setCustomerPermissions: z.boolean(),
  }),
});
export type ProjectDetail = z.output<typeof projectDetailSchema>;
