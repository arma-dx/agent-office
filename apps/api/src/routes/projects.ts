import {
  addProjectMember,
  addProjectMilestone,
  changeProjectMilestone,
  insertCustomer,
  insertProject,
  listCustomers,
  listMemberCandidates,
  listProjectApprovals,
  listProjectMembers,
  listProjectRuns,
  listProjects,
  ownProjectExists,
  peopleNames,
  projectRunTotals,
  readCompanyKind,
  readCustomer,
  readProject,
  readProjectAiSpending,
  readerSeesUndecided,
  removeProjectMember,
  removeProjectMilestone,
  setCustomerPermissions,
  setProjectAiPermission,
  setProjectAiSpendingLimit,
  setProjectBudget,
  setProjectMemberRole,
  updateProject,
  type ProjectChanges,
  type ProjectRow,
  type ProjectRunRow,
  type ProjectRunTotalsRow,
} from '@agent-office/db';
import {
  PROJECT_APPROVAL_LIST_LIMIT,
  PROJECT_LIST_LIMIT,
  PROJECT_RUN_LIST_LIMIT,
  createMilestoneSchema,
  createProjectSchema,
  customerListSchema,
  customerPermissionDetails,
  customerPermissionsAnswerSchema,
  customerPermissionsSchema,
  mayAddProjectMembers,
  memberRemoval,
  memberRoleChanges,
  loosensSpendingLimit,
  milestoneSchema,
  normalizeUsdLimit,
  projectAiPermissionAnswerSchema,
  projectAiPermissionDetails,
  projectAiPermissionSchema,
  projectAiSpendingLimitAnswerSchema,
  projectAiSpendingLimitDetails,
  projectAiSpendingLimitSchema,
  projectApprovalsSchema,
  projectDetailSchema,
  projectListSchema,
  projectMemberCandidatesSchema,
  projectMemberRoleSchema,
  projectRunsSchema,
  projectSummarySchema,
  setProjectBudgetSchema,
  setProjectMemberRoleSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  type CustomerList,
  type CustomerPermissionsAnswer,
  type ProjectActor,
  type ProjectAiPermissionAnswer,
  type ProjectAiSpendingLimitAnswer,
  type ProjectApprovals,
  type ProjectDetail,
  type ProjectList,
  type Milestone,
  type ProjectMemberRole,
  type ProjectRuns,
  type ProjectSummary,
  type RunUsage,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { founderOnly, type CompanyContext } from '../db.ts';
import {
  ApiError,
  databaseErrorCode,
  databaseErrorConstraint,
  invalidRequest,
  notFound,
} from '../errors.ts';
import { stepUpRequired, verifyStepUp } from '../passkeys.ts';
import {
  linkRepository,
  openConnectionOf,
  repositoryNotAllowedForNewProject,
  repositoryToLink,
} from '../project-repository.ts';
import { startWaitingWork } from '../restart.ts';
import type { RouteDeps } from '../services.ts';

/**
 * The Projects section (8 October decisions 11 and 14 to 22), step 1, the owner and the
 * managers of a project (decision 44), and of step 3 (decision 17) the budget, the milestones,
 * the agent runs of a project with their cost, the results of its requests and the AI spending
 * limit of a project.
 *
 *   GET   /api/projects                    the projects the person may read, open ones first
 *   POST  /api/projects                    a founder or an employee opens a project and is its
 *                                          owner; a customer can be added by name with it
 *   GET   /api/projects/member-candidates  who can be made a member: active founders, employees
 *   GET   /api/projects/:projectId         one answer for the whole page
 *   PATCH /api/projects/:projectId         a member or the founder changes its fields
 *   PUT    /api/projects/:projectId/members/:userId  the owner, a manager or the founder adds
 *                                                    a member
 *   DELETE /api/projects/:projectId/members/:userId  ... and removes one (a manager only plain
 *                                                    members; never the owner)
 *   PUT    /api/projects/:projectId/members/:userId/role  the owner or the founder gives a role
 *   PUT   /api/projects/:projectId/ai-permission      the founder opens (with a passkey) or
 *                                                     closes the AI permission of a project
 *   PUT   /api/projects/:projectId/ai-spending-limit  the founder sets, changes or removes the
 *                                                     AI spending limit of a project (raising
 *                                                     and removing with a passkey)
 *   PUT    /api/projects/:projectId/budget            the owner, a manager or the founder sets
 *                                                     or takes away the budget
 *   POST   /api/projects/:projectId/milestones        a member or the founder adds a milestone
 *   PATCH  /api/projects/:projectId/milestones/:milestoneId   ... changes one
 *   DELETE /api/projects/:projectId/milestones/:milestoneId   ... removes one
 *   GET    /api/projects/:projectId/runs              the newest agent runs of the project and
 *                                                     totals over all of them; tokens and cost
 *                                                     for the founder only
 *   GET    /api/projects/:projectId/approvals         the results of the project's requests, as
 *                                                     they wait or were decided; no decision is
 *                                                     made here
 *   (the GitHub repository of a project and its GitHub tab: routes/project-github.ts)
 *   GET   /api/customers                   the customers of the company to choose from, by name
 *   PATCH /api/customers/:customerId/permissions      the founder sets the contract permissions
 *                                                     of a customer (the AI one with a passkey)
 *
 * No route here has a field for the AI permission of a project except the one made for it, and
 * none sets a contract permission of a customer except the founder's two (a customer added with a
 * new project, and the permissions route); the database holds the same line (the permissions are
 * in no column grant). What a person reads is decided by the row policies: the founder reads every
 * project of the company, an employee the ones they are a member of. A project the person cannot
 * read answers 404 exactly like one that does not exist.
 *
 * A project is never deleted (docs/SONRA.md P-h): it is closed by its status and opened again the
 * same way; there is no route that deletes a project or a customer.
 *
 * An external person is no project member and opens none: every route is for the founder and
 * employees. The two permission routes are the founder's; they pass the same door first, so an
 * external person gets the same answer on every route of the section, and an employee is told
 * that the act is the founder's.
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

const projectParams = z.object({ projectId: z.uuid() });
const memberParams = z.object({ projectId: z.uuid(), userId: z.uuid() });
const milestoneParams = z.object({ projectId: z.uuid(), milestoneId: z.uuid() });
const customerParams = z.object({ customerId: z.uuid() });

const privateSpace = (): ApiError =>
  new ApiError(409, 'private_space', 'Kurucu alanında proje açılamaz. Bir şirket seçin.');

const customerExists = (): ApiError =>
  new ApiError(409, 'customer_exists', 'Bu adla bir müşteri zaten var. Müşteriyi listeden seçin.');

const customerNotFound = (): ApiError =>
  new ApiError(
    409,
    'customer_not_found',
    'Seçilen müşteri bulunamadı. Müşteriyi listeden yeniden seçin.',
  );

const memberNotAllowed = (): ApiError =>
  new ApiError(
    409,
    'member_not_allowed',
    'Seçilen kişi projeye üye olamaz: projeye yalnızca şirketin kurucusu ve çalışanları üye olur. Kişiyi listeden yeniden seçin.',
  );

const membersNotAllowed = (act: 'add' | 'remove'): ApiError =>
  new ApiError(
    403,
    'project_members_not_allowed',
    act === 'add'
      ? 'Projeye üye eklemeyi yalnızca projenin sahibi, yöneticileri ve kurucu yapabilir.'
      : 'Projeden üye çıkarmayı yalnızca projenin sahibi, yöneticileri ve kurucu yapabilir.',
  );

const managerProtected = (): ApiError =>
  new ApiError(
    403,
    'project_manager_protected',
    'Bir yöneticiyi projeden yalnızca projenin sahibi ya da kurucu çıkarabilir.',
  );

const ownerFixed = (act: 'remove' | 'role'): ApiError =>
  new ApiError(
    409,
    'project_owner_fixed',
    act === 'remove'
      ? 'Projenin sahibi projeden çıkarılamaz. Önce sahiplik başka bir üyeye devredilir.'
      : 'Sahibin rolü doğrudan değiştirilemez. Sahipliği devretmek için başka bir üyeyi sahip yapın.',
  );

const rolesNotAllowed = (): ApiError =>
  new ApiError(
    403,
    'project_roles_not_allowed',
    'Projede rolleri yalnızca projenin sahibi ya da kurucu değiştirebilir.',
  );

// Three sentences, one per role: an owner is told to hand the ownership over, never that "the
// owner" can remove them.
const OWN_MEMBERSHIP: Record<ProjectMemberRole, string> = {
  owner:
    'Kendinizi projeden çıkaramazsınız. Projenin sahibisiniz; önce sahipliği başka bir üyeye devredin.',
  manager: 'Kendinizi projeden çıkaramazsınız. Sizi projenin sahibi ya da kurucu çıkarabilir.',
  member:
    'Kendinizi projeden çıkaramazsınız. Sizi projenin sahibi, bir yöneticisi ya da kurucu çıkarabilir.',
};

const ownMembership = (role: ProjectMemberRole | null): ApiError =>
  new ApiError(409, 'own_project_membership', OWN_MEMBERSHIP[role ?? 'member']);

const membersChanged = (): ApiError =>
  new ApiError(
    409,
    'project_members_changed',
    'Projenin üyeleri az önce değişti. Sayfayı yenileyip yeniden deneyin.',
  );

const roleNotForPerson = (): ApiError =>
  new ApiError(409, 'member_not_allowed', 'Devre dışı bir hesaba projede rol verilemez.');

const budgetNotAllowed = (): ApiError =>
  new ApiError(
    403,
    'project_budget_not_allowed',
    'Projenin bütçesini yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.',
  );

const milestoneLimit = (): ApiError =>
  new ApiError(
    409,
    'milestone_limit',
    'Bir projede en çok 50 kilometre taşı olabilir. Yenisini eklemek için birini silin.',
  );

const milestoneNotFound = (): ApiError =>
  new ApiError(
    409,
    'milestone_not_found',
    'Bu kilometre taşı az önce silindi. Sayfayı yenileyip yeniden deneyin.',
  );

const customerLocked = (): ApiError =>
  new ApiError(
    409,
    'project_customer_locked',
    'Yapay zekâ izni açıkken projenin müşterisi değiştirilemez. Kurucu önce izni kapatır; müşteri değişince izni yeniden açar.',
  );

// The project is not what the founder confirmed with the passkey: a member changed its customer
// meanwhile. The panel reads the project again; the founder looks and confirms anew.
const projectChanged = (): ApiError =>
  new ApiError(
    409,
    'project_changed',
    'Bu projenin müşterisi az önce değişti. Projeye yeniden bakın; izni açmak için yeniden onaylayın.',
  );

// The key that keeps a customer's name unique in its company, and the link of a project to its
// customer (supabase/migrations: project_fields, agents_customers_projects).
// deadlock_detected: the change met another transaction (a run that was writing its records) and
// PostgreSQL ended this one. Nothing was changed; said plainly, because a permission that the
// founder believes closed and is not would be worse than a second click.
const permissionBusy = (): ApiError =>
  new ApiError(
    409,
    'permission_busy',
    'İzin değiştirilemedi: aynı anda başka bir işlem sürüyordu. Hiçbir şey değişmedi; yeniden deneyin.',
  );

// The same for a change of the AI spending limit: it waits for a run that is being opened in the
// project, and PostgreSQL may end it when the two meet the other way round.
const limitBusy = (): ApiError =>
  new ApiError(
    409,
    'permission_busy',
    'Sınır değiştirilemedi: aynı anda başka bir işlem sürüyordu. Hiçbir şey değişmedi; yeniden deneyin.',
  );

const CUSTOMER_NAME_KEY = 'customers_company_name';
const PROJECT_CUSTOMER_LINK = 'projects_customer_id_company_id_fkey';

function projectIdOf(request: FastifyRequest): string {
  const params = projectParams.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data.projectId;
}

function memberOf(request: FastifyRequest): { projectId: string; userId: string } {
  const params = memberParams.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return { projectId: params.data.projectId, userId: params.data.userId.toLowerCase() };
}

function milestoneOf(request: FastifyRequest): { projectId: string; milestoneId: string } {
  const params = milestoneParams.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return {
    projectId: params.data.projectId,
    milestoneId: params.data.milestoneId.toLowerCase(),
  };
}

/** The milestones of a project as the database stores them, checked against the contract. */
function milestonesOf(row: ProjectRow): Milestone[] {
  return z.array(milestoneSchema).parse(row.milestones);
}

/** Who sees and changes the money of a project: the founder, its owner, its managers. */
function managesBudget(actor: ProjectActor): boolean {
  return actor.founder || actor.projectRole === 'owner' || actor.projectRole === 'manager';
}

/**
 * Who gives, changes and removes the GitHub repository of a project: the same three (12 October
 * decision 17).
 */
export function managesRepository(actor: ProjectActor): boolean {
  return actor.founder || actor.projectRole === 'owner' || actor.projectRole === 'manager';
}

/** Rule 12 as a whole: the project's permission and, if it has a customer, the customer's. */
function agentsMayWork(row: ProjectRow): boolean {
  return row.ai_allowed && (row.customer_id === null || row.customer_ai_allowed === true);
}

function summaryFields(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    closed: row.closed,
    color: row.color,
    icon: row.icon,
    targetDate: row.target_date,
    aiAllowed: row.ai_allowed,
    agentsMayWork: agentsMayWork(row),
    spendingLimitReached: row.spending_limit_reached,
    memberCount: row.member_count,
  };
}

function toSummary(row: ProjectRow): ProjectSummary {
  return projectSummarySchema.parse({
    ...summaryFields(row),
    customer:
      row.customer_id !== null ? { id: row.customer_id, name: row.customer_name ?? '' } : null,
  });
}

/**
 * Tokens and cost as the statement gave them: all five, or nothing. The role is not asked here:
 * what the statement left out for a reader who is not the founder is what the answer leaves out.
 */
function usageOf(
  row: Pick<
    ProjectRunRow | ProjectRunTotalsRow,
    'input_tokens' | 'output_tokens' | 'cache_write_tokens' | 'cache_read_tokens' | 'cost_usd'
  >,
): RunUsage | null {
  if (
    row.cost_usd === null ||
    row.input_tokens === null ||
    row.output_tokens === null ||
    row.cache_write_tokens === null ||
    row.cache_read_tokens === null
  ) {
    return null;
  }
  return {
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheWriteTokens: Number(row.cache_write_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    costUsd: row.cost_usd,
  };
}

/** Who the reader is to this project (decision 44). */
export function actorOf(context: CompanyContext, row: ProjectRow): ProjectActor {
  return {
    userId: context.session.userId.toLowerCase(),
    founder: row.reader_is_founder,
    projectRole: projectMemberRoleSchema.nullable().catch(null).parse(row.reader_project_role),
  };
}

/**
 * The answer of the project page. A reader of a project is its member or the founder, which is
 * who may change its fields; its members are added and removed by the owner, the managers and
 * the founder, and roles are given by the owner and the founder (decision 44): every member of
 * the answer says what the reader may do with it. The permissions are the founder's alone. Of the
 * customer an employee gets the name and whether its AI permission is open (the page must say why
 * agents do not work), never the automated processing permission. The budget is in the answer
 * only for who may change it (the founder, the owner, a manager); the statement already left the
 * amount out of the row for anybody else. The milestones are every reader's. Whether the AI
 * spending limit is reached is every reader's too (a yes or a no); the limit and what was spent
 * are the founder's (docs/SONRA.md P-t).
 */
export async function detailOf(context: CompanyContext, row: ProjectRow): Promise<ProjectDetail> {
  const { client } = context;
  const actor = actorOf(context, row);
  const members = await listProjectMembers(client, row.id);
  const names = await peopleNames(
    client,
    row.created_by_user_id !== null ? [row.created_by_user_id] : [],
  );
  // What the project's agents spent and its limit: the founder's alone (the statement answers
  // nobody else).
  const spending = row.reader_is_founder ? await readProjectAiSpending(client, row.id) : null;
  return projectDetailSchema.parse({
    ...summaryFields(row),
    description: row.description,
    customer:
      row.customer_id !== null
        ? {
            id: row.customer_id,
            name: row.customer_name ?? '',
            aiAllowed: row.customer_ai_allowed === true,
            automatedProcessingAllowed:
              context.role === 'founder' ? row.customer_automated_processing_allowed : null,
          }
        : null,
    createdAt: row.created_at.toISOString(),
    createdBy:
      row.created_by_user_id !== null
        ? { userId: row.created_by_user_id, name: names.get(row.created_by_user_id) ?? null }
        : null,
    members: members.map((member) => {
      const projectRole = projectMemberRoleSchema.parse(member.project_role);
      const target = { userId: member.user_id.toLowerCase(), projectRole, active: member.active };
      return {
        userId: member.user_id,
        name: member.name,
        role: member.role === 'founder' || member.role === 'employee' ? member.role : null,
        active: member.active,
        projectRole,
        removable: memberRemoval(actor, target) === 'ok',
        roleChanges: memberRoleChanges(actor, target),
      };
    }),
    budget: managesBudget(actor)
      ? {
          visible: true,
          value:
            row.budget !== null && row.budget_currency !== null
              ? { amount: row.budget, currency: row.budget_currency }
              : null,
        }
      : { visible: false },
    milestones: milestonesOf(row),
    aiSpending: spending ? { limitUsd: spending.limit_usd, spentUsd: spending.spent_usd } : null,
    repository:
      row.repository_id !== null && row.repository_full_name !== null
        ? { id: Number(row.repository_id), fullName: row.repository_full_name }
        : null,
    actions: {
      edit: true,
      addMembers: mayAddProjectMembers(actor),
      setBudget: managesBudget(actor),
      setAiPermission: row.reader_is_founder,
      setCustomerPermissions: row.reader_is_founder && row.customer_id !== null,
      setAiSpendingLimit: row.reader_is_founder,
      setRepository: managesRepository(actor),
    },
  });
}

/** The project as the person reads it now; 404 when they cannot. */
export async function projectOf(context: CompanyContext, projectId: string): Promise<ProjectRow> {
  const row = await readProject(context.client, projectId);
  if (!row) {
    throw notFound();
  }
  return row;
}

function requireFounder(context: CompanyContext): void {
  if (context.role !== 'founder') {
    throw founderOnly();
  }
}

/** Empty text means "no description". */
function descriptionOf(text: string): string | null {
  return text.trim() === '' ? null : text;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  { runner, config, jobs, github }: RouteDeps,
): void {
  const relyingParty = config.relyingParty;

  // In the founder space the answer is an empty list: no project can exist there.
  app.get('/api/projects', async (request, reply): Promise<ProjectList> =>
    runner.withCompany(request, reply, INSIDERS, async ({ client }) => {
      const rows = await listProjects(client, PROJECT_LIST_LIMIT + 1);
      return projectListSchema.parse({
        projects: rows.slice(0, PROJECT_LIST_LIMIT).map(toSummary),
        truncated: rows.length > PROJECT_LIST_LIMIT,
      });
    }),
  );

  /**
   * Opens a project (decision 15). The panel chooses the id, so a send that is repeated answers
   * the first project and writes nothing a second time. The opener is its member and its owner
   * (decision 44); the members named with it are added by that owner in the same transaction,
   * as plain members. The project starts without AI permission:
   * there is no field for it.
   *
   * A customer added here (decision 16) starts with both contract permissions closed. Only the
   * founder may mark them, and the AI permission only with a passkey re-verification for exactly
   * this new customer: its id, its name and the permissions as sent.
   */
  app.post('/api/projects', async (request, reply): Promise<ProjectDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const body = createProjectSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client, session, companyId, role } = context;
      const { id, customer } = body.data;
      if ((await readCompanyKind(client)) !== 'company') {
        throw privateSpace();
      }
      if (!(await ownProjectExists(client, id))) {
        // A repository named with the project (decision 19): the company must be connected and
        // the repository one its installation reaches. Asked now, before anything is written
        // and before a passkey is checked: a project that cannot be given the repository the
        // person asked for is not opened at all.
        const repository =
          body.data.repositoryId !== undefined
            ? await repositoryToLink(
                await openConnectionOf(context, github),
                body.data.repositoryId,
              )
            : null;
        let opened = false;
        const marks =
          customer.kind === 'new' && (customer.aiAllowed || customer.automatedProcessingAllowed);
        if (marks && role !== 'founder') {
          throw founderOnly();
        }
        if (customer.kind === 'new' && customer.aiAllowed) {
          await verifyStepUp({ client, session }, relyingParty, body.data.stepUp, {
            purpose: 'customer_ai_permission',
            companyId,
            subjectId: customer.id,
            details: customerPermissionDetails({
              name: customer.name,
              automatedProcessingAllowed: customer.automatedProcessingAllowed,
            }),
          });
        }
        await client.query('savepoint create_project');
        try {
          if (customer.kind === 'new') {
            await insertCustomer(client, { id: customer.id, name: customer.name });
            if (marks) {
              await setCustomerPermissions(client, customer.id, {
                aiAllowed: customer.aiAllowed,
                automatedProcessingAllowed: customer.automatedProcessingAllowed,
              });
            }
          }
          await insertProject(client, {
            id,
            customerId:
              customer.kind === 'none'
                ? null
                : customer.kind === 'existing'
                  ? customer.customerId
                  : customer.id,
            name: body.data.name,
            description: descriptionOf(body.data.description),
            status: body.data.status,
            color: body.data.color,
            icon: body.data.icon,
            targetDate: body.data.targetDate,
          });
          const others = new Set(body.data.memberIds);
          others.delete(session.userId);
          for (const userId of others) {
            await addProjectMember(client, id, userId);
          }
          opened = true;
        } catch (error) {
          await client.query('rollback to savepoint create_project');
          const code = databaseErrorCode(error);
          const constraint = databaseErrorConstraint(error);
          if (code === '23505') {
            if (constraint === CUSTOMER_NAME_KEY) throw customerExists();
            // The id is taken. Either by this person's own send that was still in flight when
            // this one looked (a double click, a retry that overtook the first answer): it is
            // answered below like every repeated send. Or by a record this person did not open,
            // or the new customer's id by another customer: refused, and nothing is said of it.
            if (!(await ownProjectExists(client, id))) throw invalidRequest();
          } else if (code === '23503') {
            // A customer that is not one of this company; any other link is a member who is not
            // in the company.
            throw constraint === PROJECT_CUSTOMER_LINK ? customerNotFound() : memberNotAllowed();
          } else if (code === '23514') {
            // A check of a table (a name or a description the database does not take) names its
            // constraint; the member check, a function, names none: an external person or a
            // deactivated account.
            throw constraint !== undefined ? invalidRequest() : memberNotAllowed();
          } else if (code === '28000') {
            // invalid_authorization_specification: the permission found no re-verification.
            throw stepUpRequired();
          } else if (code === '42501' && marks) {
            // insufficient_privilege: the person's role changed meanwhile.
            throw founderOnly();
          } else {
            throw error;
          }
        }
        // The opener is the owner by now. A refusal (rule 12: the customer allows neither AI nor
        // automated processing) ends the request, and the project is not opened either.
        if (opened && repository) {
          await linkRepository(context, id, repository, repositoryNotAllowedForNewProject);
        }
      }
      reply.code(201);
      return detailOf(context, await projectOf(context, id));
    }),
  );

  app.get('/api/projects/member-candidates', async (request, reply) =>
    runner.withCompany(request, reply, INSIDERS, async ({ client }) => {
      const rows = await listMemberCandidates(client);
      return projectMemberCandidatesSchema.parse({
        people: rows.map((row) => ({ userId: row.user_id, name: row.name, role: row.role })),
      });
    }),
  );

  app.get('/api/projects/:projectId', async (request, reply): Promise<ProjectDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) =>
      detailOf(context, await projectOf(context, projectIdOf(request))),
    ),
  );

  /**
   * A member or the founder changes name, description, customer, status, colour, icon and target
   * date; a field left out stays. A customer added here starts with both permissions closed, for
   * the founder too: the permissions have their own route.
   *
   * While the project's AI permission is open its customer does not change, for anybody (rule 12
   * reads which customer a project has): the founder closes the permission first. The database
   * refuses the change either way; the route says so before anything is written, so that a new
   * customer is not added for nothing and the other fields of the same body stay as they were.
   */
  app.patch('/api/projects/:projectId', async (request, reply): Promise<ProjectDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const body = updateProjectSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client } = context;
      const row = await projectOf(context, projectId);
      const { customer } = body.data;
      // Naming the customer the project already has is no change.
      const changesCustomer =
        customer !== undefined &&
        !(customer.kind === 'none' && row.customer_id === null) &&
        !(customer.kind === 'existing' && customer.customerId === row.customer_id);
      if (changesCustomer && row.ai_allowed) {
        throw customerLocked();
      }
      const changes: ProjectChanges = {
        name: body.data.name,
        description:
          body.data.description !== undefined ? descriptionOf(body.data.description) : undefined,
        status: body.data.status,
        color: body.data.color,
        icon: body.data.icon,
        targetDate: body.data.targetDate,
      };
      if (changesCustomer) {
        changes.customerId =
          customer.kind === 'none'
            ? null
            : customer.kind === 'existing'
              ? customer.customerId
              : customer.id;
      }
      let changed: number;
      await client.query('savepoint update_project');
      try {
        if (changesCustomer && customer.kind === 'new') {
          await insertCustomer(client, { id: customer.id, name: customer.name });
        }
        changed = await updateProject(client, projectId, changes);
      } catch (error) {
        await client.query('rollback to savepoint update_project');
        const code = databaseErrorCode(error);
        if (code === '23505') {
          // Any other key: the new customer's id is taken.
          throw databaseErrorConstraint(error) === CUSTOMER_NAME_KEY
            ? customerExists()
            : invalidRequest();
        }
        if (code === '23503') throw customerNotFound();
        if (code === '23514') {
          // The AI permission was opened between the read above and the update.
          const now = await readProject(client, projectId);
          throw changesCustomer && now?.ai_allowed === true ? customerLocked() : invalidRequest();
        }
        throw error;
      }
      if (changed === 0) {
        // The person lost the project meanwhile.
        throw notFound();
      }
      return detailOf(context, await projectOf(context, projectId));
    }),
  );

  /**
   * The owner, a manager or the founder adds a member (decision 44): an active founder or
   * employee of the company (docs/SONRA.md P-j); the database refuses anybody else. The person is
   * added as a plain member. No passkey (5 October decision 4). Adding a person who is a member
   * already changes nothing.
   */
  app.put(
    '/api/projects/:projectId/members/:userId',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, userId } = memberOf(request);
        const { client } = context;
        const row = await projectOf(context, projectId);
        if (!mayAddProjectMembers(actorOf(context, row))) {
          throw membersNotAllowed('add');
        }
        await client.query('savepoint add_member');
        try {
          await addProjectMember(client, projectId, userId);
        } catch (error) {
          await client.query('rollback to savepoint add_member');
          const code = databaseErrorCode(error);
          // foreign_key_violation: not a member of the company. check_violation: an external
          // person or a deactivated account.
          if (code === '23503' || code === '23514') throw memberNotAllowed();
          if (code === '42501') {
            // insufficient_privilege: the row policy refused the insert. The person lost the
            // project between the read above and the insert (404), or lost the role that lets
            // them add.
            await projectOf(context, projectId);
            throw membersNotAllowed('add');
          }
          throw error;
        }
        return detailOf(context, await projectOf(context, projectId));
      }),
  );

  /**
   * The owner, a manager or the founder removes a member (decision 44): the owner and the founder
   * remove managers and plain members, a manager plain members only; the owner is never removed
   * (the ownership is handed over first). An employee does not remove themselves, whatever their
   * role (nobody loses sight of a project by a slip); the founder may, and still reads the
   * project. The database's row policy is the rule: it removes the row or does not, and the
   * route only says why.
   */
  app.delete(
    '/api/projects/:projectId/members/:userId',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, userId } = memberOf(request);
        const { client } = context;
        // Why the database removes no row, as the answer to give; null when it would remove one.
        const refusal = async (): Promise<ApiError | null> => {
          const row = await projectOf(context, projectId);
          const actor = actorOf(context, row);
          const member = (await listProjectMembers(client, projectId)).find(
            (candidate) => candidate.user_id.toLowerCase() === userId,
          );
          // Not a member of this project.
          if (!member) return notFound();
          switch (
            memberRemoval(actor, {
              userId,
              projectRole: projectMemberRoleSchema.parse(member.project_role),
            })
          ) {
            case 'self':
              return ownMembership(actor.projectRole);
            case 'not_allowed':
              return membersNotAllowed('remove');
            case 'owner':
              return ownerFixed('remove');
            case 'manager_protected':
              return managerProtected();
            case 'ok':
              return null;
          }
        };
        const before = await refusal();
        if (before) throw before;
        if ((await removeProjectMember(client, projectId, userId)) === 0) {
          // The members or the roles changed between the read and the delete.
          throw (await refusal()) ?? membersChanged();
        }
        return detailOf(context, await projectOf(context, projectId));
      }),
  );

  /**
   * The owner of a project or the founder gives a member a role (decision 44): appoints a manager
   * from among the members, dismisses one, or hands the ownership over to another member; the
   * owner until now then becomes a plain member, in the same transaction. The owner's own role is
   * never changed directly. The database's function is the rule; the route says why it refused.
   * No passkey (5 October decision 4). Asking for the role a member already has changes nothing.
   */
  app.put(
    '/api/projects/:projectId/members/:userId/role',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, userId } = memberOf(request);
        const body = setProjectMemberRoleSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        const { client } = context;
        const row = await projectOf(context, projectId);
        const actor = actorOf(context, row);
        if (!actor.founder && actor.projectRole !== 'owner') {
          throw rolesNotAllowed();
        }
        await client.query('savepoint member_role');
        try {
          await setProjectMemberRole(client, projectId, userId, body.data.role);
        } catch (error) {
          await client.query('rollback to savepoint member_role');
          const code = databaseErrorCode(error);
          if (code === '42501') {
            // The caller lost the project (404) or the ownership meanwhile.
            await projectOf(context, projectId);
            throw rolesNotAllowed();
          }
          if (code === 'P0002') throw notFound();
          if (code === '55000') throw ownerFixed('role');
          if (code === '23514') throw roleNotForPerson();
          throw error;
        }
        return detailOf(context, await projectOf(context, projectId));
      }),
  );

  /**
   * The AI permission of a project: the contract's word (rule 12), set by the founder alone
   * (decision 15). Opening it asks for a passkey (decision 22): the re-verification is signed for
   * this project, this act and the customer the project had on the founder's page, the route
   * recomputes that from its own request, and the database uses it up once, in this transaction.
   * If the project has another customer by now (a member changed it), nothing is opened and the
   * answer tells the panel to read the project again. Closing needs no passkey: it only stops
   * agents. The database closes the open runs of the project in the same transaction; its open
   * requests stay open and fall to the founder, and a result that waits is not approved until
   * the permission is open again (8 October decisions 46 and 47). Opening it starts the requests
   * it held again, in the same transaction: each is a new, paid run, and the answer says how many
   * (decision 49). Asking for the value the project already has changes nothing, uses nothing and
   * starts nothing.
   */
  app.put(
    '/api/projects/:projectId/ai-permission',
    async (request, reply): Promise<ProjectAiPermissionAnswer> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        requireFounder(context);
        const projectId = projectIdOf(request);
        const body = projectAiPermissionSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        const { client, session, companyId } = context;
        const row = await projectOf(context, projectId);
        if (row.ai_allowed === body.data.allowed) {
          return projectAiPermissionAnswerSchema.parse({
            ...(await detailOf(context, row)),
            restarted: 0,
          });
        }
        // The customer the founder confirmed the opening for; not read when closing.
        let customerId: string | null = null;
        if (body.data.allowed) {
          customerId = body.data.customerId;
          // Said before the passkey is checked: the page the founder confirmed on is out of date.
          if (customerId !== row.customer_id) {
            throw projectChanged();
          }
          await verifyStepUp({ client, session }, relyingParty, body.data.stepUp, {
            purpose: 'project_ai_permission',
            companyId,
            subjectId: projectId,
            details: projectAiPermissionDetails(customerId),
          });
        }
        let restarted = 0;
        await client.query('savepoint set_ai_permission');
        try {
          const changed = await setProjectAiPermission(
            client,
            projectId,
            body.data.allowed,
            customerId,
          );
          // Decision 49: opening the permission starts the requests it held again.
          if (body.data.allowed && changed) {
            restarted = await startWaitingWork(client, jobs, companyId, { projectId });
          }
        } catch (error) {
          await client.query('rollback to savepoint set_ai_permission');
          const code = databaseErrorCode(error);
          // invalid_authorization_specification: no re-verification for this project.
          if (code === '28000') throw stepUpRequired();
          // insufficient_privilege: the person is no longer the founder.
          if (code === '42501') throw founderOnly();
          if (code === 'P0002') throw notFound();
          // object_not_in_prerequisite_state: the customer changed between the read above and
          // the opening.
          if (code === '55000') throw projectChanged();
          // Closing a permission also closes the open runs of the project.
          if (code === '40P01') throw permissionBusy();
          throw error;
        }
        return projectAiPermissionAnswerSchema.parse({
          ...(await detailOf(context, await projectOf(context, projectId))),
          restarted,
        });
      }),
  );

  /**
   * The AI spending limit of a project (decision 17): in US dollars, over the whole life of the
   * project; null takes it away. Set by the founder alone. A first limit and a lower one only
   * stop agents earlier and need no passkey; a raise and a removal let agents spend more, so the
   * re-verification is signed for this project and this very value, the route recomputes that
   * from its own request, and the database uses it up once, in this transaction. Asking for the
   * value the project already has changes nothing and uses nothing up.
   *
   * A raise and a removal start the work the limit held again, in the same transaction
   * (11 October decision 1; as an opened AI permission does, 8 October decision 49): the requests
   * whose run the limit stopped and the ones whose job it refused. Each is a new, paid run, and
   * the answer says how many. The database decides which: nothing starts while the new limit is
   * still reached by what the project has spent. A first limit and a lower one start nothing.
   */
  app.put(
    '/api/projects/:projectId/ai-spending-limit',
    async (request, reply): Promise<ProjectAiSpendingLimitAnswer> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        requireFounder(context);
        const projectId = projectIdOf(request);
        const body = projectAiSpendingLimitSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        const { client, session, companyId } = context;
        const row = await projectOf(context, projectId);
        const current = await readProjectAiSpending(client, projectId);
        if (!current) {
          throw founderOnly();
        }
        // "50" and "50.0" are the limit "50.00", the form the database gives back.
        const next = body.data.limitUsd === null ? null : normalizeUsdLimit(body.data.limitUsd);
        if (current.limit_usd === next) {
          return projectAiSpendingLimitAnswerSchema.parse({
            ...(await detailOf(context, row)),
            restarted: 0,
          });
        }
        // Raising and removing let agents spend more: the passkey, for this project and this
        // value. Setting a first limit and lowering one only stop agents earlier.
        const loosens = loosensSpendingLimit(current.limit_usd, next);
        if (loosens) {
          await verifyStepUp({ client, session }, relyingParty, body.data.stepUp, {
            purpose: 'project_ai_spending_limit',
            companyId,
            subjectId: projectId,
            details: projectAiSpendingLimitDetails(next),
          });
        }
        let restarted = 0;
        await client.query('savepoint set_spending_limit');
        try {
          const changed = await setProjectAiSpendingLimit(client, projectId, next);
          // 11 October decision 1: a raise and a removal start the work the limit held again.
          if (loosens && changed) {
            restarted = await startWaitingWork(client, jobs, companyId, { projectId });
          }
        } catch (error) {
          await client.query('rollback to savepoint set_spending_limit');
          const code = databaseErrorCode(error);
          // invalid_authorization_specification: the limit was lowered between the read above
          // and this call, so what was a lowering is a raise now; the panel asks for the passkey.
          if (code === '28000') throw stepUpRequired();
          // insufficient_privilege: the person is no longer the founder.
          if (code === '42501') throw founderOnly();
          if (code === 'P0002') throw notFound();
          if (code === '22023') throw invalidRequest();
          // deadlock_detected: as for the permission routes.
          if (code === '40P01') throw limitBusy();
          throw error;
        }
        return projectAiSpendingLimitAnswerSchema.parse({
          ...(await detailOf(context, await projectOf(context, projectId))),
          restarted,
        });
      }),
  );

  /**
   * The budget of a project: its money, never the cost of AI (docs/SONRA.md P-t). Set, changed
   * and (null) taken away by the owner of the project, its managers and the founder; a plain
   * member neither sees nor changes it. The database's guard is the rule; the route says so
   * before anything is written. No passkey: the budget is a record, not an approval.
   */
  app.put('/api/projects/:projectId/budget', async (request, reply): Promise<ProjectDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const body = setProjectBudgetSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client } = context;
      const row = await projectOf(context, projectId);
      if (!managesBudget(actorOf(context, row))) {
        throw budgetNotAllowed();
      }
      let changed: number;
      await client.query('savepoint set_budget');
      try {
        changed = await setProjectBudget(client, projectId, body.data.budget);
      } catch (error) {
        await client.query('rollback to savepoint set_budget');
        const code = databaseErrorCode(error);
        if (code === '42501') {
          // insufficient_privilege: between the read above and the write the person lost the
          // project (404) or the role that lets them change its money.
          await projectOf(context, projectId);
          throw budgetNotAllowed();
        }
        // check_violation, numeric_value_out_of_range: the contract refuses these first.
        if (code === '23514' || code === '22003') throw invalidRequest();
        throw error;
      }
      if (changed === 0) {
        // The person lost the project meanwhile.
        throw notFound();
      }
      return detailOf(context, await projectOf(context, projectId));
    }),
  );

  /**
   * A member or the founder adds a milestone: a name and an optional day (decision 17). The panel
   * chooses the id, so a send that is repeated adds nothing and answers the page as it is. A
   * project holds at most 50.
   */
  app.post('/api/projects/:projectId/milestones', async (request, reply): Promise<ProjectDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const body = createMilestoneSchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const { client } = context;
      await projectOf(context, projectId);
      const id = body.data.id.toLowerCase();
      let added: number;
      await client.query('savepoint add_milestone');
      try {
        added = await addProjectMilestone(client, projectId, {
          id,
          name: body.data.name,
          date: body.data.date,
        });
      } catch (error) {
        await client.query('rollback to savepoint add_milestone');
        if (databaseErrorCode(error) === '23514') throw invalidRequest();
        throw error;
      }
      const row = await projectOf(context, projectId);
      if (added === 0 && !milestonesOf(row).some((milestone) => milestone.id === id)) {
        // Not a repeated send: the list is full.
        throw milestoneLimit();
      }
      return detailOf(context, row);
    }),
  );

  /** A member or the founder changes a milestone: its name, its day (null clears it), done. */
  app.patch(
    '/api/projects/:projectId/milestones/:milestoneId',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, milestoneId } = milestoneOf(request);
        const body = updateMilestoneSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        const { client } = context;
        await projectOf(context, projectId);
        let changed: number;
        await client.query('savepoint change_milestone');
        try {
          changed = await changeProjectMilestone(client, projectId, milestoneId, body.data);
        } catch (error) {
          await client.query('rollback to savepoint change_milestone');
          if (databaseErrorCode(error) === '23514') throw invalidRequest();
          throw error;
        }
        const row = await projectOf(context, projectId);
        if (changed === 0) {
          // Somebody removed it meanwhile.
          throw milestoneNotFound();
        }
        return detailOf(context, row);
      }),
  );

  /** A member or the founder removes a milestone. One that is gone already answers the page. */
  app.delete(
    '/api/projects/:projectId/milestones/:milestoneId',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, milestoneId } = milestoneOf(request);
        await projectOf(context, projectId);
        await removeProjectMilestone(context.client, projectId, milestoneId);
        return detailOf(context, await projectOf(context, projectId));
      }),
  );

  /**
   * The agent runs of a project (decision 17): the newest ones, and totals over all of them. For
   * everybody who reads the project: the request's title, the agent, times, the status and the
   * error code. No summary, no closing words and nothing else an agent wrote (docs/SONRA.md
   * V-c): whoever wants the story of a run opens its request. Tokens and cost are in the answer
   * only for the founder (P-t); for anybody else the statements select none of them.
   */
  app.get('/api/projects/:projectId/runs', async (request, reply): Promise<ProjectRuns> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const { client } = context;
      await projectOf(context, projectId);
      const rows = await listProjectRuns(client, projectId, PROJECT_RUN_LIST_LIMIT + 1);
      const totals = await projectRunTotals(client, projectId);
      return projectRunsSchema.parse({
        runs: rows.slice(0, PROJECT_RUN_LIST_LIMIT).map((row) => ({
          id: row.id,
          request:
            row.task_id !== null && row.task_title !== null
              ? { id: row.task_id, title: row.task_title }
              : null,
          agent: { code: row.agent_code, name: row.agent_name },
          status: row.status,
          errorCode: row.error_code,
          startedAt: row.started_at.toISOString(),
          finishedAt: row.finished_at?.toISOString() ?? null,
          durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
          usage: usageOf(row),
        })),
        truncated: rows.length > PROJECT_RUN_LIST_LIMIT,
        totals: { runCount: totals.run_count, usage: usageOf(totals) },
        serverTime: new Date().toISOString(),
      });
    }),
  );

  /**
   * The results of the requests of a project (decision 17): the ones that wait for the unit's
   * approver first, then what was decided, the newest first. Read through the row policy of
   * approvals, which is the rule of docs/SONRA.md V-c: a result that waits, was sent back or was
   * rejected is a row only for those who hold the approval right; an approved one for every
   * reader of the project. `seesUndecided` tells the page which of the two lists it got. A row
   * is the request's title and what became of the result; nothing the agent wrote and nothing a
   * person wrote when deciding is in it, and no decision is made through this list.
   */
  app.get('/api/projects/:projectId/approvals', async (request, reply): Promise<ProjectApprovals> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const { client } = context;
      await projectOf(context, projectId);
      const rows = await listProjectApprovals(client, projectId, PROJECT_APPROVAL_LIST_LIMIT + 1);
      const shown = rows.slice(0, PROJECT_APPROVAL_LIST_LIMIT);
      const names = await peopleNames(
        client,
        shown.flatMap((row) => (row.decided_by_user_id !== null ? [row.decided_by_user_id] : [])),
      );
      return projectApprovalsSchema.parse({
        approvals: shown.map((row) => ({
          id: row.id,
          request: { id: row.task_id, title: row.task_title },
          agent: { code: row.agent_code, name: row.agent_name },
          // It waited when the request changed (a stop, a new routing): closed, never decided.
          status: row.status === 'pending' && row.invalidated_at !== null ? 'closed' : row.status,
          attempt: row.attempt,
          createdAt: row.created_at.toISOString(),
          decidedAt: row.decided_at?.toISOString() ?? null,
          decidedBy:
            row.decided_by_user_id !== null
              ? {
                  userId: row.decided_by_user_id,
                  name: names.get(row.decided_by_user_id) ?? null,
                }
              : null,
        })),
        truncated: rows.length > PROJECT_APPROVAL_LIST_LIMIT,
        seesUndecided: await readerSeesUndecided(client),
      });
    }),
  );

  /**
   * The customers of the company to choose from. An employee gets the names only; the founder
   * also the two contract permissions. Nothing else of a customer leaves through this section.
   */
  app.get('/api/customers', async (request, reply): Promise<CustomerList> =>
    runner.withCompany(request, reply, INSIDERS, async ({ client, role }) => {
      const founder = role === 'founder';
      const rows = await listCustomers(client);
      return customerListSchema.parse({
        customers: rows.map((row) => ({
          id: row.id,
          name: row.name,
          aiAllowed: founder ? row.ai_allowed : null,
          automatedProcessingAllowed: founder ? row.automated_processing_allowed : null,
        })),
      });
    }),
  );

  /**
   * The contract permissions of a customer (decision 16), set by the founder alone. Opening the AI
   * permission asks for a passkey for exactly this customer and this body; closing it, and the
   * automated processing permission either way, ask for none. A permission left out stays.
   * Closing the AI permission closes the open runs of every project of the customer, as closing
   * a project's own does; opening it starts the requests it held in those projects again, and the
   * answer says how many (8 October decision 49).
   */
  app.patch(
    '/api/customers/:customerId/permissions',
    async (request, reply): Promise<CustomerPermissionsAnswer> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        requireFounder(context);
        const params = customerParams.safeParse(request.params);
        if (!params.success) {
          throw notFound();
        }
        const { customerId } = params.data;
        const body = customerPermissionsSchema.safeParse(request.body);
        if (!body.success) {
          throw invalidRequest();
        }
        const { client, session, companyId } = context;
        const row = await readCustomer(client, customerId);
        if (!row) {
          throw notFound();
        }
        const { aiAllowed, automatedProcessingAllowed } = body.data;
        if (aiAllowed === true && !row.ai_allowed) {
          await verifyStepUp({ client, session }, relyingParty, body.data.stepUp, {
            purpose: 'customer_ai_permission',
            companyId,
            subjectId: customerId,
            details: customerPermissionDetails({ automatedProcessingAllowed }),
          });
        }
        let restarted = 0;
        await client.query('savepoint set_customer_permissions');
        try {
          await setCustomerPermissions(client, customerId, {
            aiAllowed,
            automatedProcessingAllowed,
          });
          // Decision 49: opening the permission starts the requests it held again.
          if (aiAllowed === true && !row.ai_allowed) {
            restarted = await startWaitingWork(client, jobs, companyId, { customerId });
          }
        } catch (error) {
          await client.query('rollback to savepoint set_customer_permissions');
          const code = databaseErrorCode(error);
          if (code === '28000') throw stepUpRequired();
          if (code === '42501') throw founderOnly();
          if (code === 'P0002') throw notFound();
          // Closing a permission also closes the open runs of the customer's projects.
          if (code === '40P01') throw permissionBusy();
          throw error;
        }
        const now = await readCustomer(client, customerId);
        if (!now) {
          throw notFound();
        }
        return customerPermissionsAnswerSchema.parse({
          id: now.id,
          name: now.name,
          aiAllowed: now.ai_allowed,
          automatedProcessingAllowed: now.automated_processing_allowed,
          restarted,
        });
      }),
  );
}
