import {
  addProjectMember,
  insertCustomer,
  insertProject,
  listCustomers,
  listMemberCandidates,
  listProjectMembers,
  listProjects,
  ownProjectExists,
  peopleNames,
  readCompanyKind,
  readCustomer,
  readProject,
  removeProjectMember,
  setCustomerPermissions,
  setProjectAiPermission,
  updateProject,
  type ProjectChanges,
  type ProjectRow,
} from '@agent-office/db';
import {
  PROJECT_LIST_LIMIT,
  createProjectSchema,
  customerListSchema,
  customerPermissionDetails,
  customerPermissionsSchema,
  customerSchema,
  projectAiPermissionDetails,
  projectAiPermissionSchema,
  projectDetailSchema,
  projectListSchema,
  projectMemberCandidatesSchema,
  projectSummarySchema,
  updateProjectSchema,
  type Customer,
  type CustomerList,
  type ProjectDetail,
  type ProjectList,
  type ProjectSummary,
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
import type { RouteDeps } from '../services.ts';

/**
 * The Projects section (8 October decisions 11 and 14 to 22), step 1.
 *
 *   GET   /api/projects                    the projects the person may read, open ones first
 *   POST  /api/projects                    a founder or an employee opens a project and is its
 *                                          member; a customer can be added by name with it
 *   GET   /api/projects/member-candidates  who can be made a member: active founders, employees
 *   GET   /api/projects/:projectId         one answer for the whole page
 *   PATCH /api/projects/:projectId         a member or the founder changes its fields
 *   PUT    /api/projects/:projectId/members/:userId  a member or the founder adds a member
 *   DELETE /api/projects/:projectId/members/:userId  ... and removes one
 *   PUT   /api/projects/:projectId/ai-permission      the founder opens (with a passkey) or
 *                                                     closes the AI permission of a project
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

const ownMembership = (): ApiError =>
  new ApiError(
    409,
    'own_project_membership',
    'Kendinizi projeden çıkaramazsınız. Sizi başka bir üye ya da kurucu çıkarabilir.',
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
 * The answer of the project page. A reader of a project is its member or the founder, which is
 * who may change its fields and its members; the permissions are the founder's alone. Of the
 * customer an employee gets the name and whether its AI permission is open (the page must say why
 * agents do not work), never the automated processing permission.
 */
async function detailOf(context: CompanyContext, row: ProjectRow): Promise<ProjectDetail> {
  const { client } = context;
  const members = await listProjectMembers(client, row.id);
  const names = await peopleNames(
    client,
    row.created_by_user_id !== null ? [row.created_by_user_id] : [],
  );
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
    members: members.map((member) => ({
      userId: member.user_id,
      name: member.name,
      role: member.role === 'founder' || member.role === 'employee' ? member.role : null,
      active: member.active,
    })),
    actions: {
      edit: true,
      manageMembers: true,
      setAiPermission: row.reader_is_founder,
      setCustomerPermissions: row.reader_is_founder && row.customer_id !== null,
    },
  });
}

/** The project as the person reads it now; 404 when they cannot. */
async function projectOf(context: CompanyContext, projectId: string): Promise<ProjectRow> {
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

export function registerProjectRoutes(app: FastifyInstance, { runner, config }: RouteDeps): void {
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
   * the first project and writes nothing a second time. The opener is its member; the members
   * named with it are added in the same transaction. The project starts without AI permission:
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
   * A member or the founder adds a member: an active founder or employee of the company
   * (docs/SONRA.md P-j); the database refuses anybody else. No passkey (5 October decision 4).
   * Adding a person who is a member already changes nothing.
   */
  app.put(
    '/api/projects/:projectId/members/:userId',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, userId } = memberOf(request);
        const { client } = context;
        await projectOf(context, projectId);
        await client.query('savepoint add_member');
        try {
          await addProjectMember(client, projectId, userId);
        } catch (error) {
          await client.query('rollback to savepoint add_member');
          const code = databaseErrorCode(error);
          // foreign_key_violation: not a member of the company. check_violation: an external
          // person or a deactivated account.
          if (code === '23503' || code === '23514') throw memberNotAllowed();
          throw error;
        }
        return detailOf(context, await projectOf(context, projectId));
      }),
  );

  /**
   * A member or the founder removes a member. An employee does not remove themselves (nobody
   * loses sight of a project by a slip); the founder may, and still reads the project.
   */
  app.delete(
    '/api/projects/:projectId/members/:userId',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const { projectId, userId } = memberOf(request);
        await projectOf(context, projectId);
        if (userId === context.session.userId.toLowerCase() && context.role !== 'founder') {
          throw ownMembership();
        }
        if ((await removeProjectMember(context.client, projectId, userId)) === 0) {
          // Not a member of this project.
          throw notFound();
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
   * agents. Asking for the value the project already has changes nothing and uses nothing.
   */
  app.put(
    '/api/projects/:projectId/ai-permission',
    async (request, reply): Promise<ProjectDetail> =>
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
          return detailOf(context, row);
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
        await client.query('savepoint set_ai_permission');
        try {
          await setProjectAiPermission(client, projectId, body.data.allowed, customerId);
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
          throw error;
        }
        return detailOf(context, await projectOf(context, projectId));
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
   */
  app.patch('/api/customers/:customerId/permissions', async (request, reply): Promise<Customer> =>
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
      await client.query('savepoint set_customer_permissions');
      try {
        await setCustomerPermissions(client, customerId, {
          aiAllowed,
          automatedProcessingAllowed,
        });
      } catch (error) {
        await client.query('rollback to savepoint set_customer_permissions');
        const code = databaseErrorCode(error);
        if (code === '28000') throw stepUpRequired();
        if (code === '42501') throw founderOnly();
        if (code === 'P0002') throw notFound();
        throw error;
      }
      const now = await readCustomer(client, customerId);
      if (!now) {
        throw notFound();
      }
      return customerSchema.parse({
        id: now.id,
        name: now.name,
        aiAllowed: now.ai_allowed,
        automatedProcessingAllowed: now.automated_processing_allowed,
      });
    }),
  );
}
