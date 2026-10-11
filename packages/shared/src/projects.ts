import { z } from 'zod';
import { hasHiddenCharacter, stepUpSchema } from './api.ts';
import { taskPersonSchema } from './tasks.ts';

/**
 * Projects (8 October decisions 11 and 14 to 22), step 1: the list, a new project, the project
 * page, its members and the AI permission; and part 1b (decision 44): the owner, the managers and
 * the plain members of a project. The API validates every body with these schemas and builds
 * every answer with them; the panel validates every answer.
 *
 * No body here sets the AI permission of a project except the one made for it, and none sets a
 * customer's contract permissions except the founder's two (a customer added with a new project,
 * and the permissions route).
 *
 * Step 3 (decision 17): the budget and the milestones of a project. Neither is a field of the
 * bodies that open or change a project: each has its own route and its own body.
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

/**
 * A day without a time: YYYY-MM-DD. ISO 8601 has a year 0000, PostgreSQL's date does not (its
 * first year is 0001), so that year is refused here and never reaches a statement.
 */
export const projectDaySchema = z.iso
  .date()
  .refine((day) => !day.startsWith('0000-'), { message: 'Must not be in the year 0000' });

/** The currencies a project's budget can be in (the database holds the same three). */
export const budgetCurrencySchema = z.enum(['TRY', 'USD', 'EUR']);
export type BudgetCurrency = z.output<typeof budgetCurrencySchema>;
export const BUDGET_CURRENCIES = budgetCurrencySchema.options;

/**
 * An amount of money as text: digits, a dot and at most two decimals, above zero. Text and not a
 * number, so that no amount is ever rounded on its way. At most twelve digits before the dot
 * (projects.budget is numeric(14, 2)).
 */
export const budgetAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/)
  .refine((amount) => Number(amount) > 0, { message: 'Must be above zero' });

/** The money of a project (docs/SONRA.md P-t): never the cost of AI. */
export const projectBudgetSchema = z.strictObject({
  amount: budgetAmountSchema,
  currency: budgetCurrencySchema,
});
export type ProjectBudget = z.output<typeof projectBudgetSchema>;

/** PUT /api/projects/:projectId/budget (the owner, a manager, the founder). null takes it away. */
export const setProjectBudgetSchema = z.strictObject({ budget: projectBudgetSchema.nullable() });
export type SetProjectBudget = z.input<typeof setProjectBudgetSchema>;

export const MILESTONE_NAME_MAX = 120;
export const MILESTONE_MAX = 50;

export const milestoneNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MILESTONE_NAME_MAX)
  .refine((name) => !hasHiddenCharacter(name), NO_HIDDEN);

/** A milestone of a project: a name, an optional day and whether it is reached. */
export const milestoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  date: projectDaySchema.nullable(),
  done: z.boolean(),
});
export type Milestone = z.output<typeof milestoneSchema>;

/** POST /api/projects/:projectId/milestones. The panel chooses the id: a repeated send adds nothing. */
export const createMilestoneSchema = z.strictObject({
  id: z.uuid(),
  name: milestoneNameSchema,
  date: projectDaySchema.nullable().default(null),
});
export type CreateMilestone = z.input<typeof createMilestoneSchema>;

/** PATCH /api/projects/:projectId/milestones/:milestoneId: at least one field. */
export const updateMilestoneSchema = z
  .strictObject({
    name: milestoneNameSchema.optional(),
    date: projectDaySchema.nullable().optional(),
    done: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.date !== undefined || body.done !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateMilestone = z.input<typeof updateMilestoneSchema>;

/**
 * The milestones in the order the page shows them: by day, the ones without a day last; entries
 * of one day, and the ones without a day, in the order they were added.
 */
export function sortedMilestones(milestones: readonly Milestone[]): Milestone[] {
  return milestones
    .map((milestone, index) => ({ milestone, index }))
    .toSorted(
      (a, b) =>
        (a.milestone.date ?? '9999-12-31').localeCompare(b.milestone.date ?? '9999-12-31') ||
        a.index - b.index,
    )
    .map((entry) => entry.milestone);
}

/** US dollars as text, as the database holds them: up to six decimals (runs.cost_usd). */
export const usdSchema = z.string().regex(/^\d+(\.\d{1,6})?$/);

/** The share of the limit from which the founder is warned (Paperclip warns at the same share). */
export const SPENDING_WARN_SHARE = 0.8;

/** A dollar amount of usdSchema in millionths of a dollar: exact, whatever its size. */
function microUsd(amount: string): bigint {
  const [whole = '0', decimals = ''] = amount.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(decimals.padEnd(6, '0').slice(0, 6));
}

/**
 * Where the spending of a project stands against its AI spending limit (8 October decision 17),
 * for the founder's page. `reached` is the server's own word (the database compares the sum with
 * the limit); the warning from 80 percent on is the panel's. The amounts are compared as whole
 * millionths of a dollar, not as floating point numbers: exactly 80 percent is "near".
 */
export function spendingState(
  limitUsd: string | null,
  spentUsd: string,
  reached: boolean,
): 'no_limit' | 'ok' | 'near' | 'reached' {
  if (limitUsd === null) return 'no_limit';
  if (reached) return 'reached';
  const share = BigInt(Math.round(SPENDING_WARN_SHARE * 100));
  return microUsd(spentUsd) * 100n >= microUsd(limitUsd) * share ? 'near' : 'ok';
}

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
 * record and opens no second project. The opener is always a member and the owner of the project;
 * memberIds names the others, who are added as plain members.
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
 * The answer of PATCH /api/customers/:customerId/permissions: the customer, and how many waiting
 * requests of its projects were started again because this request opened its AI permission
 * (8 October decision 49). 0 when nothing was opened or nothing waited.
 */
export const customerPermissionsAnswerSchema = customerSchema.extend({
  restarted: z.number().int().nonnegative(),
});
export type CustomerPermissionsAnswer = z.output<typeof customerPermissionsAnswerSchema>;

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
  // The AI spending limit of the project is reached (8 October decision 17): no agent run starts
  // there until the founder raises it. A yes or a no for every reader; never an amount.
  spendingLimitReached: z.boolean(),
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

/** The role of a member in a project (8 October decision 44); the database holds the same three. */
export const projectMemberRoleSchema = z.enum(['owner', 'manager', 'member']);
export type ProjectMemberRole = z.output<typeof projectMemberRoleSchema>;

/** Who acts on the members of a project: the company's founder, or a person with a project role. */
export interface ProjectActor {
  userId: string;
  founder: boolean;
  // null: not a member of the project (only the founder reads it then).
  projectRole: ProjectMemberRole | null;
}

/** The founder, the owner and the managers add a member. */
export function mayAddProjectMembers(actor: ProjectActor): boolean {
  return actor.founder || actor.projectRole === 'owner' || actor.projectRole === 'manager';
}

export type MemberRemoval = 'ok' | 'self' | 'not_allowed' | 'owner' | 'manager_protected';

/**
 * May the actor take this member off the project, and if not, why. The database's row policy is
 * the rule (members_remove); this is the same rule asked as a question, for the answer's flags
 * and for the sentence of a refusal.
 */
export function memberRemoval(
  actor: ProjectActor,
  target: { userId: string; projectRole: ProjectMemberRole },
): MemberRemoval {
  if (!actor.founder && target.userId === actor.userId) return 'self';
  if (!mayAddProjectMembers(actor)) return 'not_allowed';
  if (target.projectRole === 'owner') return 'owner';
  if (actor.founder || actor.projectRole === 'owner') return 'ok';
  return target.projectRole === 'member' ? 'ok' : 'manager_protected';
}

/** The roles the actor may give this member now; empty for everybody but the owner and the founder. */
export function memberRoleChanges(
  actor: ProjectActor,
  target: { projectRole: ProjectMemberRole; active: boolean },
): ProjectMemberRole[] {
  if (!actor.founder && actor.projectRole !== 'owner') return [];
  if (target.projectRole === 'owner') return [];
  if (target.projectRole === 'manager') return target.active ? ['member', 'owner'] : ['member'];
  return target.active ? ['manager', 'owner'] : [];
}

/** PUT /api/projects/:projectId/members/:userId/role (the owner of the project, the founder). */
export const setProjectMemberRoleSchema = z.strictObject({ role: projectMemberRoleSchema });
export type SetProjectMemberRole = z.input<typeof setProjectMemberRoleSchema>;

export const projectMemberSchema = z.object({
  userId: z.uuid(),
  // null: the name could not be read (the person is no member of the company any more).
  name: z.string().nullable(),
  role: z.enum(['founder', 'employee']).nullable(),
  // false: the person's account is deactivated.
  active: z.boolean(),
  projectRole: projectMemberRoleSchema,
  // The reader may take this member off the project now.
  removable: z.boolean(),
  // The roles the reader may give this member now (empty: none).
  roleChanges: z.array(projectMemberRoleSchema),
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
  // The money of the project. `visible: false` for a reader who is neither its owner, nor a
  // manager of it, nor the founder: the amount is not in the answer at all.
  budget: z.discriminatedUnion('visible', [
    z.object({ visible: z.literal(false) }),
    z.object({ visible: z.literal(true), value: projectBudgetSchema.nullable() }),
  ]),
  // In the order they were added; the page sorts them (sortedMilestones).
  milestones: z.array(milestoneSchema),
  // What the project's agents have spent and its limit, in US dollars. Null for a reader who is
  // not the founder (docs/SONRA.md P-t).
  aiSpending: z.object({ limitUsd: usdSchema.nullable(), spentUsd: usdSchema }).nullable(),
  actions: z.object({
    // Name, description, customer, status, colour, icon, target date; and the milestones.
    edit: z.boolean(),
    // The reader may add members: the owner, a manager, the founder.
    addMembers: z.boolean(),
    // The owner, a manager, the founder.
    setBudget: z.boolean(),
    // The founder alone.
    setAiPermission: z.boolean(),
    setCustomerPermissions: z.boolean(),
    setAiSpendingLimit: z.boolean(),
  }),
});
export type ProjectDetail = z.output<typeof projectDetailSchema>;

/**
 * The answer of PUT /api/projects/:projectId/ai-permission: the project, and how many waiting
 * requests of it were started again because this request opened the permission (8 October
 * decision 49). 0 when the permission was closed, was open already, or nothing waited.
 */
export const projectAiPermissionAnswerSchema = projectDetailSchema.extend({
  restarted: z.number().int().nonnegative(),
});
export type ProjectAiPermissionAnswer = z.output<typeof projectAiPermissionAnswerSchema>;
