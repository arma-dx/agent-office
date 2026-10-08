import type { Queryable } from './queryable.ts';

/**
 * Statements of the Projects section (8 October decisions 14 to 22). Every statement runs with
 * the caller's restricted role inside the caller's transaction and context; what a person sees is
 * decided by the row policies, never by a condition here: the founder reads every project of the
 * context company, an employee the ones they are a member of, nobody else any.
 *
 * Nothing here sets the AI permission of a project or a contract permission of a customer except
 * the two calls of the database's own functions, which ask for the founder and, to open an AI
 * permission, for a passkey re-verification recorded in the same transaction.
 */

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  closed: boolean;
  color: string;
  icon: string;
  // YYYY-MM-DD: read as text, a day has no time zone.
  target_date: string | null;
  ai_allowed: boolean;
  customer_id: string | null;
  customer_name: string | null;
  customer_ai_allowed: boolean | null;
  customer_automated_processing_allowed: boolean | null;
  member_count: number;
  created_at: Date;
  created_by_user_id: string | null;
  reader_is_founder: boolean;
}

const PROJECT_SQL = `
  select p.id, p.name, p.description, p.status, p.closed, p.color, p.icon,
         p.target_date::text as target_date, p.ai_allowed,
         c.id as customer_id, c.name as customer_name, c.ai_allowed as customer_ai_allowed,
         c.automated_processing_allowed as customer_automated_processing_allowed,
         (
           select count(*)::int from office.project_members pm where pm.project_id = p.id
         ) as member_count,
         p.created_at, p.created_by_user_id,
         office.is_founder() as reader_is_founder
  from office.projects p
  left join office.customers c on c.id = p.customer_id
  where p.company_id = office.ctx_company_id()`;

/** The projects of the context company the person may read: open ones first, the newest first. */
export async function listProjects(client: Queryable, limit: number): Promise<ProjectRow[]> {
  const { rows } = await client.query<ProjectRow>(
    `${PROJECT_SQL} order by p.closed, p.created_at desc, p.id limit $1`,
    [limit],
  );
  return rows;
}

/** One project; null when it does not exist or the person may not read it. */
export async function readProject(
  client: Queryable,
  projectId: string,
): Promise<ProjectRow | null> {
  const { rows } = await client.query<ProjectRow>(`${PROJECT_SQL} and p.id = $1`, [projectId]);
  return rows[0] ?? null;
}

/** Did the calling person open this project in the context company (a send that is repeated). */
export async function ownProjectExists(client: Queryable, projectId: string): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 from office.projects p
     where p.id = $1 and p.company_id = office.ctx_company_id()
       and p.created_by_user_id = office.ctx_user_id()`,
    [projectId],
  );
  return rows.length > 0;
}

export interface NewProject {
  id: string;
  customerId: string | null;
  name: string;
  description: string | null;
  status: string;
  color: string;
  icon: string;
  // YYYY-MM-DD.
  targetDate: string | null;
}

/**
 * Opens a project in the context company. The database makes the opener its member in the same
 * statement, writes who and when, and starts it without AI permission. The row is not asked back
 * ("returning"): the read policy looks at the new row before the opener is its member, so an
 * employee's insert would be refused. The caller reads the project afterwards.
 */
export async function insertProject(client: Queryable, project: NewProject): Promise<void> {
  await client.query(
    `insert into office.projects
       (id, company_id, customer_id, name, description, status, color, icon, target_date)
     values ($1, office.ctx_company_id(), $2, $3, $4, $5, $6, $7, $8::date)`,
    [
      project.id,
      project.customerId,
      project.name,
      project.description,
      project.status,
      project.color,
      project.icon,
      project.targetDate,
    ],
  );
}

/** The fields of a project a member may change; a field left out (undefined) is not changed. */
export interface ProjectChanges {
  name?: string | undefined;
  description?: string | null | undefined;
  customerId?: string | null | undefined;
  status?: string | undefined;
  color?: string | undefined;
  icon?: string | undefined;
  targetDate?: string | null | undefined;
}

/**
 * Changes the fields that were sent, in one fixed statement: every field comes with a flag that
 * says whether it was sent, so no SQL text is built from a request. Returns the number of rows (0:
 * the person may not change the project, or it does not exist).
 */
export async function updateProject(
  client: Queryable,
  projectId: string,
  changes: ProjectChanges,
): Promise<number> {
  const result = await client.query(
    `update office.projects p set
       name = case when $2::boolean then $3 else p.name end,
       description = case when $4::boolean then $5 else p.description end,
       customer_id = case when $6::boolean then $7::uuid else p.customer_id end,
       status = case when $8::boolean then $9 else p.status end,
       color = case when $10::boolean then $11 else p.color end,
       icon = case when $12::boolean then $13 else p.icon end,
       target_date = case when $14::boolean then $15::date else p.target_date end
     where p.id = $1 and p.company_id = office.ctx_company_id()`,
    [
      projectId,
      changes.name !== undefined,
      changes.name ?? null,
      changes.description !== undefined,
      changes.description ?? null,
      changes.customerId !== undefined,
      changes.customerId ?? null,
      changes.status !== undefined,
      changes.status ?? null,
      changes.color !== undefined,
      changes.color ?? null,
      changes.icon !== undefined,
      changes.icon ?? null,
      changes.targetDate !== undefined,
      changes.targetDate ?? null,
    ],
  );
  return result.rowCount ?? 0;
}

export interface ProjectMemberRow {
  user_id: string;
  // null: the person is no member of the company any more.
  name: string | null;
  role: string | null;
  active: boolean;
}

/**
 * The members of a project. The people come from the narrow team function, so an employee reads
 * the names and roles of colleagues and nothing else of them.
 */
export async function listProjectMembers(
  client: Queryable,
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const { rows } = await client.query<ProjectMemberRow>(
    `select pm.user_id, cp.name, cp.role, coalesce(cp.active, false) as active
     from office.project_members pm
     left join office.company_people() cp on cp.user_id = pm.user_id
     where pm.project_id = $1 and pm.company_id = office.ctx_company_id()
     order by cp.name nulls last, pm.user_id`,
    [projectId],
  );
  return rows;
}

/** Adds a member; a person who is a member already changes nothing. */
export async function addProjectMember(
  client: Queryable,
  projectId: string,
  userId: string,
): Promise<void> {
  await client.query(
    `insert into office.project_members (company_id, project_id, user_id)
     values (office.ctx_company_id(), $1, $2)
     on conflict (project_id, user_id) do nothing`,
    [projectId, userId],
  );
}

/** Removes a member; returns the number of rows (0: not a member, or not the person's to remove). */
export async function removeProjectMember(
  client: Queryable,
  projectId: string,
  userId: string,
): Promise<number> {
  const result = await client.query(
    `delete from office.project_members
     where project_id = $1 and user_id = $2 and company_id = office.ctx_company_id()`,
    [projectId, userId],
  );
  return result.rowCount ?? 0;
}

/**
 * The founder opens or closes the AI permission of a project. `customerId` is the customer the
 * founder confirmed the opening for (null: none); the database refuses the opening when the
 * project has another one by now. It is not read when the permission is closed.
 */
export async function setProjectAiPermission(
  client: Queryable,
  projectId: string,
  allowed: boolean,
  customerId: string | null,
): Promise<void> {
  await client.query('select office.set_project_ai_permission($1, $2, $3)', [
    projectId,
    allowed,
    customerId,
  ]);
}

export interface MemberCandidateRow {
  user_id: string;
  name: string;
  role: string;
}

/** Who can be made a project member: the active founders and employees of the context company. */
export async function listMemberCandidates(client: Queryable): Promise<MemberCandidateRow[]> {
  const { rows } = await client.query<MemberCandidateRow>(
    `select cp.user_id, cp.name, cp.role
     from office.company_people() cp
     where cp.role in ('founder', 'employee') and cp.active
     order by cp.name, cp.user_id`,
  );
  return rows;
}

export interface CustomerRow {
  id: string;
  name: string;
  ai_allowed: boolean;
  automated_processing_allowed: boolean;
}

const CUSTOMER_SQL = `
  select c.id, c.name, c.ai_allowed, c.automated_processing_allowed
  from office.customers c
  where c.company_id = office.ctx_company_id()`;

/** The customers of the context company, by name. */
export async function listCustomers(client: Queryable): Promise<CustomerRow[]> {
  const { rows } = await client.query<CustomerRow>(`${CUSTOMER_SQL} order by c.name, c.id`);
  return rows;
}

export async function readCustomer(
  client: Queryable,
  customerId: string,
): Promise<CustomerRow | null> {
  const { rows } = await client.query<CustomerRow>(`${CUSTOMER_SQL} and c.id = $1`, [customerId]);
  return rows[0] ?? null;
}

/**
 * Adds a customer by name, with both contract permissions closed. Never with "on conflict": a
 * re-verification names the id of the customer that is being added, so an id that exists must
 * fail (23505) and never be taken over.
 */
export async function insertCustomer(
  client: Queryable,
  customer: { id: string; name: string },
): Promise<void> {
  await client.query(
    'insert into office.customers (id, company_id, name) values ($1, office.ctx_company_id(), $2)',
    [customer.id, customer.name],
  );
}

/** The founder sets contract permissions of a customer; a permission left out stays as it is. */
export async function setCustomerPermissions(
  client: Queryable,
  customerId: string,
  permissions: {
    aiAllowed?: boolean | undefined;
    automatedProcessingAllowed?: boolean | undefined;
  },
): Promise<void> {
  await client.query('select office.set_customer_permissions($1, $2, $3)', [
    customerId,
    permissions.aiAllowed ?? null,
    permissions.automatedProcessingAllowed ?? null,
  ]);
}

/** The kind of the context company ('company' or 'private_space'); null when it is not visible. */
export async function readCompanyKind(client: Queryable): Promise<string | null> {
  const { rows } = await client.query<{ kind: string }>(
    'select c.kind from office.companies c where c.id = office.ctx_company_id()',
  );
  return rows[0]?.kind ?? null;
}
