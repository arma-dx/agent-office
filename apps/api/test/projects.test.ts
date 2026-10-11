import { randomUUID } from 'node:crypto';
import { createPool, withContext } from '@agent-office/db';
import {
  apiErrorSchema,
  customerListSchema,
  customerPermissionDetails,
  customerSchema,
  memberChangeDetails,
  projectAiPermissionDetails,
  projectAiSpendingLimitDetails,
  projectDetailSchema,
  projectListSchema,
  projectMemberCandidatesSchema,
  type ProjectDetail,
  type StepUp,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { SoftwareAuthenticator } from './authenticator.ts';
import { accounts, ids } from './fixtures.ts';
import {
  PANEL_ORIGIN,
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';
import {
  challengeState,
  errorCode,
  freshPasskey,
  send,
  signStepUp,
  type Method,
} from './passkey-helpers.ts';

// The Projects section through the API (8 October decisions 14 to 22): the list, a new project
// with its customer and members, the project page and its edit, the members with their roles
// (decision 44: the owner, the managers, the plain members), and the two permissions only the
// founder sets. Projects are opened through the API, so the opener is the owner. Tests commit, so
// each uses ids
// and names of its own; a project is never deleted, so what a test opens stays in the database.

// Records of the other company, a customer of Arma DX and a deactivated employee of it, written
// as an administrator would (no person in the context).
const PILLIKA_CUSTOMER = '00000000-0000-4000-8000-000000000951';
const PILLIKA_PROJECT = '00000000-0000-4000-8000-000000000952';
const ARMA_CUSTOMER = '00000000-0000-4000-8000-000000000953';
const DEACTIVATED = '00000000-0000-4000-8000-000000000954';
// A card version of the coordinator, for the runs the spending limit tests write (a run names the
// card version it ran with). It is never made the current one.
const SPENDING_CARD = '00000000-0000-4000-8000-000000000964';

const database = inject('database');

describe.skipIf(noDatabase)('projects', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let colleague: string;
  // A third employee of Arma DX (the fixtures' newcomer).
  let third: string;
  let external: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);
  // A connection of the API's role that a test holds open itself, next to the server's own.
  const besidePool = createPool(database?.app ?? '', 'agent-office-api-test-beside', () => {});
  // A connection of the privileged role that a test holds open itself, for a change of somebody
  // else that commits while a request of the server is on its way.
  const adminPool = createPool(database?.admin ?? '', 'agent-office-api-test-other', () => {});

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
    third = await sessionOf(server, accounts.newcomer);
    external = await sessionOf(server, accounts.external);
    await freshPasskey(server, founder, founderKey, ids.founder, 'Kurucu telefonu');
    await adminExec(`
      insert into office.customers (id, company_id, name) values
        ('${PILLIKA_CUSTOMER}', '${ids.pillika}', 'Pillika Müşterisi'),
        ('${ARMA_CUSTOMER}', '${ids.arma}', 'Arma Müşterisi');
      insert into office.projects (id, company_id, customer_id, name) values
        ('${PILLIKA_PROJECT}', '${ids.pillika}', '${PILLIKA_CUSTOMER}', 'Pillika Projesi');
      insert into office.users (id, name, active) values ('${DEACTIVATED}', 'Kapalı Hesap', false);
      insert into office.memberships (company_id, user_id, role, can_approve)
        values ('${ids.arma}', '${DEACTIVATED}', 'employee', false);
    `);
  });

  // A session holds ten open passkey challenges at most, and a test leaves the ones it signed for
  // something else open: the founder signs in anew for every test (the passkey is the person's).
  beforeEach(async () => {
    founder = await sessionOf(server, accounts.founder);
  });

  afterAll(async () => {
    await server.close();
    await besidePool.end();
    await adminPool.end();
    await closeAdminPool();
  });

  const call = (
    session: string,
    method: Method,
    url: string,
    payload?: object,
    company: string = ids.arma,
  ) => send(server, session, method, url, { company, ...(payload ? { payload } : {}) });

  /** Opens a project and returns the answer. */
  async function open(session: string, body: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const res = await call(session, 'POST', '/api/projects', {
      id: randomUUID(),
      name: 'Proje',
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return projectDetailSchema.parse(res.json());
  }

  async function read(session: string, id: string): Promise<ProjectDetail> {
    const res = await call(session, 'GET', `/api/projects/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return projectDetailSchema.parse(res.json());
  }

  /** Gives a member of a project a role (the owner's and the founder's act). */
  const setRole = (
    session: string,
    projectId: string,
    userId: string,
    role: string,
    company: string = ids.arma,
  ) => call(session, 'PUT', `/api/projects/${projectId}/members/${userId}/role`, { role }, company);

  /** The same, expected to be stored; returns the answer. */
  async function giveRole(
    session: string,
    projectId: string,
    userId: string,
    role: string,
  ): Promise<ProjectDetail> {
    const res = await setRole(session, projectId, userId, role);
    expect(res.statusCode, res.body).toBe(200);
    return projectDetailSchema.parse(res.json());
  }

  /** The project role of every member of an answer, by the person's id. */
  const rolesOf = (project: ProjectDetail): Record<string, string> =>
    Object.fromEntries(project.members.map((member) => [member.userId, member.projectRole]));

  /** What the reader may do with every member of an answer, by the person's id. */
  const flagsOf = (project: ProjectDetail) =>
    Object.fromEntries(
      project.members.map((member) => [
        member.userId,
        { role: member.projectRole, removable: member.removable, gives: member.roleChanges },
      ]),
    );

  /** The Turkish sentence of an error answer. */
  const messageOf = (res: LightMyRequestResponse): string =>
    apiErrorSchema.parse(res.json()).error.message;

  async function customers(session: string, company: string = ids.arma) {
    const res = await call(session, 'GET', '/api/customers', undefined, company);
    expect(res.statusCode, res.body).toBe(200);
    return customerListSchema.parse(res.json()).customers;
  }

  async function count(table: string, condition: string, values: unknown[]): Promise<number> {
    const [row] = await adminQuery<{ n: number }>(
      `select count(*)::int as n from office.${table} where ${condition}`,
      values,
    );
    return row?.n ?? 0;
  }

  /** The AI permission of a project, opened as an administrator would. */
  async function openAiByHand(projectId: string): Promise<void> {
    await adminQuery('update office.projects set ai_allowed = true where id = $1', [projectId]);
  }

  const setAi = (session: string, projectId: string, body: object, company: string = ids.arma) =>
    call(session, 'PUT', `/api/projects/${projectId}/ai-permission`, body, company);

  /** The founder's passkey confirms opening the project's AI permission for that customer. */
  const confirmProject = (projectId: string, customerId: string | null): Promise<StepUp> =>
    signStepUp(server, founder, founderKey, {
      purpose: 'project_ai_permission',
      companyId: ids.arma,
      subjectId: projectId,
      details: projectAiPermissionDetails(customerId),
    });

  /** The founder opens the AI permission of a project, with the passkey. */
  async function openAi(projectId: string, customerId: string | null = null) {
    const stepUp = await confirmProject(projectId, customerId);
    const res = await setAi(founder, projectId, { allowed: true, customerId, stepUp });
    expect(res.statusCode, res.body).toBe(200);
    return projectDetailSchema.parse(res.json());
  }

  const setCustomer = (
    session: string,
    customerId: string,
    body: object,
    company: string = ids.arma,
  ) => call(session, 'PATCH', `/api/customers/${customerId}/permissions`, body, company);

  /** The founder's passkey confirms opening the customer's AI permission with that body. */
  const confirmCustomer = (
    customerId: string,
    automatedProcessingAllowed?: boolean,
  ): Promise<StepUp> =>
    signStepUp(server, founder, founderKey, {
      purpose: 'customer_ai_permission',
      companyId: ids.arma,
      subjectId: customerId,
      details: customerPermissionDetails({ automatedProcessingAllowed }),
    });

  /** A customer of Arma DX with both permissions closed, added with a project of the founder. */
  async function newCustomer(name: string): Promise<{ customerId: string; projectId: string }> {
    const customerId = randomUUID();
    const project = await open(founder, {
      name: `${name} projesi`,
      customer: { kind: 'new', id: customerId, name },
    });
    return { customerId, projectId: project.id };
  }

  async function events(recordId: string): Promise<{ event: string; user_id: string | null }[]> {
    return adminQuery(
      `select event, user_id from office.audit_log
       where record_id = $1 and event ~ '_(ai_permission|automated_processing)_'
       order by id`,
      [recordId],
    );
  }

  /** Resolves when a request the server is handling waits for a lock another transaction holds. */
  async function untilServerWaits(): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const waiting = await adminQuery(
        `select 1 from pg_catalog.pg_stat_activity
         where application_name = 'agent-office-api-test' and wait_event_type = 'Lock'
           and state = 'active'`,
      );
      if (waiting.length > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('No request of the server waited for a lock');
  }

  // List, create, read ---------------------------------------------------------------------------

  it('opens a project for an employee: 201, planned, the opener is its owner and its only member, the AI permission is closed', async () => {
    const id = randomUUID();
    const res = await call(employee, 'POST', '/api/projects', { id, name: '  Yeni web sitesi  ' });
    expect(res.statusCode).toBe(201);
    const project = projectDetailSchema.parse(res.json());
    expect(project).toMatchObject({
      id,
      name: 'Yeni web sitesi',
      status: 'planned',
      closed: false,
      color: 'gray',
      icon: 'folder',
      targetDate: null,
      description: null,
      customer: null,
      aiAllowed: false,
      agentsMayWork: false,
      memberCount: 1,
      createdBy: { userId: ids.employee, name: 'Çalışan' },
      members: [
        {
          userId: ids.employee,
          name: 'Çalışan',
          role: 'employee',
          active: true,
          projectRole: 'owner',
        },
      ],
    });
    expect(
      await adminQuery(
        'select ai_allowed, created_by_user_id, company_id from office.projects where id = $1',
        [id],
      ),
    ).toEqual([{ ai_allowed: false, created_by_user_id: ids.employee, company_id: ids.arma }]);
    expect(
      await adminQuery('select user_id, role from office.project_members where project_id = $1', [
        id,
      ]),
    ).toEqual([{ user_id: ids.employee, role: 'owner' }]);
  });

  it('a repeated send with the same id answers the first project and writes nothing a second time', async () => {
    const body = { id: randomUUID(), name: 'İki kez gönderilen', memberIds: [ids.holder] };
    const first = await call(employee, 'POST', '/api/projects', body);
    const second = await call(employee, 'POST', '/api/projects', { ...body, name: 'Başka ad' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(projectDetailSchema.parse(second.json())).toMatchObject({
      id: body.id,
      name: 'İki kez gönderilen',
      memberCount: 2,
    });
    expect(
      await count('audit_log', `event = 'project_created' and record_id = $1`, [body.id]),
    ).toBe(1);
    expect(await count('project_members', 'project_id = $1', [body.id])).toBe(2);
  });

  it("an id taken by somebody else's project is refused with 400 and says nothing about it", async () => {
    const taken = await open(employee, { name: 'Çalışanın projesi' });
    // A colleague who cannot read it, and the founder, who can but did not open it.
    for (const session of [colleague, founder]) {
      const res = await call(session, 'POST', '/api/projects', { id: taken.id, name: 'Aynı id' });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
      expect(res.body).not.toContain('Çalışanın projesi');
    }
    expect((await read(employee, taken.id)).name).toBe('Çalışanın projesi');
    expect(await count('project_members', 'project_id = $1', [taken.id])).toBe(1);
    // The same for the id of another company's project.
    const other = await call(employee, 'POST', '/api/projects', {
      id: PILLIKA_PROJECT,
      name: 'Aynı id',
    });
    expect(other.statusCode).toBe(400);
  });

  it('validates the body', async () => {
    const good = { id: randomUUID(), name: 'Geçerli' };
    const refused: Record<string, unknown>[] = [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(121) },
      { status: 'open' },
      { color: 'grey' },
      { icon: 'rocket' },
      { targetDate: '31.12.2026' },
      { targetDate: '2026-12-31T00:00:00Z' },
      { targetDate: '2026-02-30' },
      // Year 0000 is no day of the database: refused by the contract, not by a failed statement.
      { targetDate: '0000-01-01' },
      { budget: 100 },
      { aiAllowed: true },
      { aiAllowed: false },
      { customer: { kind: 'existing' } },
      { customer: { kind: 'new', id: randomUUID(), name: '' } },
      { memberIds: ['x'] },
      { id: 'not-a-uuid' },
    ];
    for (const change of refused) {
      const res = await call(employee, 'POST', '/api/projects', { ...good, ...change });
      expect(res.statusCode, JSON.stringify(change)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    const empty = await call(employee, 'POST', '/api/projects');
    expect(empty.statusCode).toBe(400);
    expect(await count('projects', 'id = $1', [good.id])).toBe(0);
  });

  it('403 insiders_only for an external person on every route of the section', async () => {
    const project = await open(employee);
    const routes: [Method, string, object?][] = [
      ['GET', '/api/projects'],
      ['POST', '/api/projects', { id: randomUUID(), name: 'Dış kişinin projesi' }],
      ['GET', '/api/projects/member-candidates'],
      ['GET', `/api/projects/${project.id}`],
      ['PATCH', `/api/projects/${project.id}`, { name: 'Dış kişi' }],
      ['PUT', `/api/projects/${project.id}/members/${ids.external}`],
      ['DELETE', `/api/projects/${project.id}/members/${ids.employee}`],
      ['PUT', `/api/projects/${project.id}/members/${ids.employee}/role`, { role: 'member' }],
      ['PUT', `/api/projects/${project.id}/members/${ids.external}/role`, { role: 'owner' }],
      ['PUT', `/api/projects/${project.id}/ai-permission`, { allowed: false }],
      ['GET', '/api/customers'],
      ['PATCH', `/api/customers/${ARMA_CUSTOMER}/permissions`, { aiAllowed: false }],
    ];
    for (const [method, url, payload] of routes) {
      const res = await call(external, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorCode(res), `${method} ${url}`).toBe('insiders_only');
    }
    expect(await read(employee, project.id)).toMatchObject({
      name: 'Proje',
      memberCount: 1,
      members: [{ userId: ids.employee, projectRole: 'owner' }],
    });
  });

  it('409 private_space in the founder space; its list is empty', async () => {
    const id = randomUUID();
    const res = await call(
      founder,
      'POST',
      '/api/projects',
      { id, name: 'Özel alan projesi' },
      ids.founderSpace,
    );
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('private_space');
    expect(await count('projects', 'id = $1', [id])).toBe(0);
    const list = await call(founder, 'GET', '/api/projects', undefined, ids.founderSpace);
    expect(list.statusCode).toBe(200);
    expect(projectListSchema.parse(list.json())).toEqual({ projects: [], truncated: false });
    expect(await customers(founder, ids.founderSpace)).toEqual([]);
  });

  it("lists the founder every project and an employee only the ones they are a member of, open ones first, never another company's", async () => {
    const mine = await open(employee, {
      name: 'Çalışanın açık projesi',
      customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
      targetDate: '2026-12-31',
      color: 'blue',
      icon: 'globe',
    });
    const closed = await open(employee, { name: 'Çalışanın biten projesi', status: 'completed' });
    const theirs = await open(colleague, { name: 'Meslektaşın projesi' });
    const list = async (session: string, company: string = ids.arma) => {
      const res = await call(session, 'GET', '/api/projects', undefined, company);
      expect(res.statusCode).toBe(200);
      return projectListSchema.parse(res.json());
    };

    const forEmployee = await list(employee);
    const employeeIds = forEmployee.projects.map((project) => project.id);
    expect(employeeIds).toContain(mine.id);
    expect(employeeIds).toContain(closed.id);
    expect(employeeIds).not.toContain(theirs.id);
    expect(employeeIds).not.toContain(PILLIKA_PROJECT);
    expect(forEmployee.truncated).toBe(false);
    expect(forEmployee.projects.find((project) => project.id === mine.id)).toEqual({
      id: mine.id,
      name: 'Çalışanın açık projesi',
      status: 'planned',
      closed: false,
      color: 'blue',
      icon: 'globe',
      targetDate: '2026-12-31',
      aiAllowed: false,
      agentsMayWork: false,
      spendingLimitReached: false,
      customer: { id: ARMA_CUSTOMER, name: 'Arma Müşterisi' },
      memberCount: 1,
    });
    // Every open project stands before every closed one.
    const flags = forEmployee.projects.map((project) => project.closed);
    expect(flags).toEqual([...flags].sort((a, b) => Number(a) - Number(b)));
    expect(flags).toContain(true);
    // Among the open ones the newest first.
    expect(employeeIds.indexOf(mine.id)).toBeLessThan(employeeIds.indexOf(closed.id));

    const forFounder = (await list(founder)).projects.map((project) => project.id);
    expect(forFounder).toEqual(expect.arrayContaining([mine.id, closed.id, theirs.id]));
    expect(forFounder).not.toContain(PILLIKA_PROJECT);
    const inPillika = (await list(founder, ids.pillika)).projects.map((project) => project.id);
    expect(inPillika).toEqual([PILLIKA_PROJECT]);
    // An employee of Arma DX is no member of Pillika at all.
    const refused = await call(employee, 'GET', '/api/projects', undefined, ids.pillika);
    expect(refused.statusCode).toBe(403);
  });

  it('404 for a project the reader may not see, on every route that names one', async () => {
    const project = await open(employee, { name: 'Görünmeyen proje' });
    const routes = (id: string): [Method, string, object?][] => [
      ['GET', `/api/projects/${id}`],
      ['PATCH', `/api/projects/${id}`, { name: 'Ele geçirildi' }],
      // Adding themselves, and removing the member who opened it.
      ['PUT', `/api/projects/${id}/members/${ids.holder}`],
      ['DELETE', `/api/projects/${id}/members/${ids.employee}`],
      // Taking the ownership, and dismissing the owner.
      ['PUT', `/api/projects/${id}/members/${ids.holder}/role`, { role: 'owner' }],
      ['PUT', `/api/projects/${id}/members/${ids.employee}/role`, { role: 'member' }],
    ];
    const expect404 = async (session: string, id: string, company: string = ids.arma) => {
      for (const [method, url, payload] of routes(id)) {
        const res = await call(session, method, url, payload, company);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(errorCode(res)).toBe('not_found');
        expect(res.body).not.toContain('Görünmeyen proje');
      }
    };
    // A colleague who is not a member; the founder with the other company selected; the other
    // company's project from here; an id nobody has; an id that is not an id.
    await expect404(colleague, project.id);
    await expect404(founder, project.id, ids.pillika);
    await expect404(founder, PILLIKA_PROJECT);
    await expect404(employee, randomUUID());
    await expect404(employee, 'not-an-id');
    expect(await read(founder, project.id)).toMatchObject({
      name: 'Görünmeyen proje',
      memberCount: 1,
      members: [{ userId: ids.employee, projectRole: 'owner' }],
    });
    // A member id that is not an id.
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await call(employee, method, `/api/projects/${project.id}/members/not-an-id`);
      expect(res.statusCode).toBe(404);
    }
    const role = await setRole(employee, project.id, 'not-an-id', 'manager');
    expect(role.statusCode).toBe(404);
    expect(errorCode(role)).toBe('not_found');
    // The permission route is the founder's: the other company's project, with either company
    // selected, an id nobody has and an id that is not one.
    for (const [id, company] of [
      [project.id, ids.pillika],
      [PILLIKA_PROJECT, ids.arma],
      [randomUUID(), ids.arma],
      ['not-an-id', ids.arma],
    ] as const) {
      for (const body of [{ allowed: false }, { allowed: true, customerId: null }]) {
        const res = await setAi(founder, id, body, company);
        expect(res.statusCode, id).toBe(404);
        expect(errorCode(res)).toBe('not_found');
      }
    }
  });

  it('a new customer by name: closed permissions for an employee; 409 customer_exists for a name that exists, whatever the case; 409 customer_not_found for an unknown id and for a customer of the other company', async () => {
    const customer = { kind: 'new', id: randomUUID(), name: '  Yeni Musteri Ltd  ' };
    const project = await open(employee, { name: 'Müşterili proje', customer });
    expect(project.customer).toEqual({
      id: customer.id,
      name: 'Yeni Musteri Ltd',
      aiAllowed: false,
      automatedProcessingAllowed: null,
    });
    expect(
      await adminQuery(
        `select name, ai_allowed, automated_processing_allowed, company_id
         from office.customers where id = $1`,
        [customer.id],
      ),
    ).toEqual([
      {
        name: 'Yeni Musteri Ltd',
        ai_allowed: false,
        automated_processing_allowed: false,
        company_id: ids.arma,
      },
    ]);

    // The case differs in ASCII letters only: whether the database folds Ş or İ depends on the
    // server's locale (recorded in docs/SONRA.md as an open point).
    for (const name of ['Yeni Musteri Ltd', 'YENI MUSTERI LTD', 'yeni musteri ltd']) {
      const id = randomUUID();
      const res = await call(employee, 'POST', '/api/projects', {
        id,
        name: 'İkinci proje',
        customer: { kind: 'new', id: randomUUID(), name },
      });
      expect(res.statusCode, name).toBe(409);
      expect(errorCode(res), name).toBe('customer_exists');
      expect(await count('projects', 'id = $1', [id])).toBe(0);
    }
    // The other company may have a customer of that name.
    expect(await count('customers', 'lower(name) = lower($1)', ['Yeni Musteri Ltd'])).toBe(1);

    for (const customerId of [randomUUID(), PILLIKA_CUSTOMER]) {
      const id = randomUUID();
      const res = await call(employee, 'POST', '/api/projects', {
        id,
        name: 'Müşterisi olmayan proje',
        customer: { kind: 'existing', customerId },
      });
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('customer_not_found');
      expect(await count('projects', 'id = $1', [id])).toBe(0);
    }
    // A new customer whose id is taken by another customer is refused and takes nothing over.
    const stolen = await call(employee, 'POST', '/api/projects', {
      id: randomUUID(),
      name: 'Çalınan id',
      customer: { kind: 'new', id: customer.id, name: 'Bambaşka Müşteri' },
    });
    expect(stolen.statusCode).toBe(400);
    expect(await count('customers', 'name = $1', ['Bambaşka Müşteri'])).toBe(0);
  });

  it("opens a project with an existing customer of the company, for the founder and for an employee; the customer's permissions are not touched", async () => {
    const before = await adminQuery(
      'select ai_allowed, automated_processing_allowed from office.customers where id = $1',
      [ARMA_CUSTOMER],
    );
    for (const session of [founder, employee]) {
      const project = await open(session, {
        name: 'Var olan müşterinin projesi',
        customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
      });
      expect(project.customer).toMatchObject({ id: ARMA_CUSTOMER, name: 'Arma Müşterisi' });
      expect(project.aiAllowed).toBe(false);
    }
    expect(
      await adminQuery(
        'select ai_allowed, automated_processing_allowed from office.customers where id = $1',
        [ARMA_CUSTOMER],
      ),
    ).toEqual(before);
    // A permission field next to an existing customer is not part of the contract.
    const res = await call(founder, 'POST', '/api/projects', {
      id: randomUUID(),
      name: 'İzinli',
      customer: { kind: 'existing', customerId: ARMA_CUSTOMER, aiAllowed: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('403 founder_only when an employee marks a contract permission of a new customer; nothing is written', async () => {
    for (const permission of ['aiAllowed', 'automatedProcessingAllowed']) {
      const id = randomUUID();
      const customer = { kind: 'new', id: randomUUID(), name: `Çalışanın ${permission} müşterisi` };
      const res = await call(employee, 'POST', '/api/projects', {
        id,
        name: 'İzin işaretli',
        customer: { ...customer, [permission]: true },
      });
      expect(res.statusCode, permission).toBe(403);
      expect(errorCode(res), permission).toBe('founder_only');
      expect(await count('customers', 'id = $1', [customer.id])).toBe(0);
      expect(await count('projects', 'id = $1', [id])).toBe(0);
    }
  });

  it('the founder marks the AI permission of a new customer only with a passkey for that customer and those details', async () => {
    const id = randomUUID();
    const customer = {
      kind: 'new',
      id: randomUUID(),
      name: 'Passkey ile açılan müşteri',
      aiAllowed: true,
      automatedProcessingAllowed: true,
    };
    const body = { id, name: 'Yapay zekâ izinli müşterinin projesi', customer };
    const nothingWritten = async () => {
      expect(await count('customers', 'id = $1', [customer.id])).toBe(0);
      expect(await count('projects', 'id = $1', [id])).toBe(0);
    };
    const sign = (name: string, automatedProcessingAllowed: boolean, subjectId = customer.id) =>
      signStepUp(server, founder, founderKey, {
        purpose: 'customer_ai_permission',
        companyId: ids.arma,
        subjectId,
        details: customerPermissionDetails({ name, automatedProcessingAllowed }),
      });

    const without = await call(founder, 'POST', '/api/projects', body);
    expect(without.statusCode).toBe(403);
    expect(errorCode(without)).toBe('step_up_required');
    await nothingWritten();

    // Signed for another name, for other permissions, for another customer id.
    for (const stepUp of [
      await sign('Başka bir müşteri', true),
      await sign(customer.name, false),
      await sign(customer.name, true, randomUUID()),
    ]) {
      const res = await call(founder, 'POST', '/api/projects', { ...body, stepUp });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
      await nothingWritten();
    }

    const stepUp = await sign(customer.name, true);
    const res = await call(founder, 'POST', '/api/projects', { ...body, stepUp });
    expect(res.statusCode, res.body).toBe(201);
    expect(projectDetailSchema.parse(res.json())).toMatchObject({
      // The project's own permission stays closed: it is opened on its page.
      aiAllowed: false,
      agentsMayWork: false,
      customer: {
        id: customer.id,
        name: customer.name,
        aiAllowed: true,
        automatedProcessingAllowed: true,
      },
    });
    expect(
      await adminQuery(
        'select ai_allowed, automated_processing_allowed from office.customers where id = $1',
        [customer.id],
      ),
    ).toEqual([{ ai_allowed: true, automated_processing_allowed: true }]);
    // The signed answer opens nothing a second time.
    const again = await call(founder, 'POST', '/api/projects', {
      id: randomUUID(),
      name: 'Aynı imza',
      customer: { ...customer, id: randomUUID(), name: 'Aynı imzayla ikinci müşteri' },
      stepUp,
    });
    expect(again.statusCode).toBe(403);
    expect(errorCode(again)).toBe('step_up_failed');
  });

  it('the founder marks only the automated processing permission of a new customer without a passkey; the AI permission stays closed', async () => {
    const customer = {
      kind: 'new',
      id: randomUUID(),
      name: 'Yalnızca otomatik işleme',
      automatedProcessingAllowed: true,
    };
    const project = await open(founder, { name: 'Otomatik işleme izinli', customer });
    expect(project.customer).toEqual({
      id: customer.id,
      name: customer.name,
      aiAllowed: false,
      automatedProcessingAllowed: true,
    });
    expect(
      await adminQuery(
        'select ai_allowed, automated_processing_allowed from office.customers where id = $1',
        [customer.id],
      ),
    ).toEqual([{ ai_allowed: false, automated_processing_allowed: true }]);
  });

  it('members named with a new project are added; 409 member_not_allowed for an external person, for a person outside the company and for a deactivated account, and nothing is written', async () => {
    const project = await open(employee, {
      name: 'Üyeli proje',
      // The opener named again, and a colleague twice: each is a member once.
      memberIds: [ids.holder, ids.employee, ids.founder, ids.holder],
    });
    expect(project.memberCount).toBe(3);
    expect(project.members.map((member) => member.userId).sort()).toEqual(
      [ids.founder, ids.employee, ids.holder].sort(),
    );
    // The opener is the owner; the people named with the project are plain members, the founder
    // too.
    expect(rolesOf(project)).toEqual({
      [ids.employee]: 'owner',
      [ids.holder]: 'member',
      [ids.founder]: 'member',
    });
    expect(await read(colleague, project.id)).toMatchObject({ id: project.id, memberCount: 3 });

    for (const [who, userId] of [
      ['an external person', ids.external],
      ['a person of another company', ids.otherFounder],
      ['nobody', randomUUID()],
      ['a deactivated account', DEACTIVATED],
    ] as const) {
      const id = randomUUID();
      const customer = { kind: 'new', id: randomUUID(), name: `Üye reddi: ${who}` };
      const res = await call(employee, 'POST', '/api/projects', {
        id,
        name: 'Üyesi reddedilen proje',
        customer,
        memberIds: [ids.holder, userId],
      });
      expect(res.statusCode, who).toBe(409);
      expect(errorCode(res), who).toBe('member_not_allowed');
      expect(await count('projects', 'id = $1', [id]), who).toBe(0);
      expect(await count('project_members', 'project_id = $1', [id]), who).toBe(0);
      expect(await count('customers', 'id = $1', [customer.id]), who).toBe(0);
    }
  });

  it("the customers list gives an employee names only and the founder the permissions; never the other company's", async () => {
    const forEmployee = await customers(employee);
    expect(forEmployee.find((customer) => customer.id === ARMA_CUSTOMER)).toEqual({
      id: ARMA_CUSTOMER,
      name: 'Arma Müşterisi',
      aiAllowed: null,
      automatedProcessingAllowed: null,
    });
    expect(
      forEmployee.every(
        (customer) => customer.aiAllowed === null && customer.automatedProcessingAllowed === null,
      ),
    ).toBe(true);
    const forFounder = await customers(founder);
    expect(forFounder.find((customer) => customer.id === ARMA_CUSTOMER)).toEqual({
      id: ARMA_CUSTOMER,
      name: 'Arma Müşterisi',
      aiAllowed: false,
      automatedProcessingAllowed: false,
    });
    expect(forFounder.map((customer) => customer.id)).toEqual(
      forEmployee.map((customer) => customer.id),
    );
    for (const list of [forEmployee, forFounder]) {
      expect(list.map((customer) => customer.id)).not.toContain(PILLIKA_CUSTOMER);
    }
    expect((await customers(founder, ids.pillika)).map((customer) => customer.id)).toEqual([
      PILLIKA_CUSTOMER,
    ]);
    // Nothing else of a customer leaves: the answer has four fields.
    const raw = await call(employee, 'GET', '/api/customers');
    const [first] = raw.json<{ customers: Record<string, unknown>[] }>().customers;
    expect(Object.keys(first ?? {}).sort()).toEqual([
      'aiAllowed',
      'automatedProcessingAllowed',
      'id',
      'name',
    ]);
  });

  it('member candidates are the active founders and employees of the company', async () => {
    for (const session of [employee, founder]) {
      const res = await call(session, 'GET', '/api/projects/member-candidates');
      expect(res.statusCode).toBe(200);
      const { people } = projectMemberCandidatesSchema.parse(res.json());
      expect(people).toEqual(
        expect.arrayContaining([
          { userId: ids.founder, name: 'Kurucu', role: 'founder' },
          { userId: ids.employee, name: 'Çalışan', role: 'employee' },
          { userId: ids.holder, name: 'Passkey Sahibi', role: 'employee' },
        ]),
      );
      const offered = people.map((person) => person.userId);
      for (const userId of [ids.external, ids.lawyer, ids.otherFounder, DEACTIVATED]) {
        expect(offered).not.toContain(userId);
      }
    }
    const inPillika = await call(
      founder,
      'GET',
      '/api/projects/member-candidates',
      undefined,
      ids.pillika,
    );
    expect(projectMemberCandidatesSchema.parse(inPillika.json()).people).toEqual([
      { userId: ids.founder, name: 'Kurucu', role: 'founder' },
    ]);
  });

  // Page and edit ----------------------------------------------------------------------------------

  it("the detail carries the members with names and roles, the opener, the customer and the reader's actions", async () => {
    const opened = await open(employee, {
      name: 'Sayfası okunan proje',
      description: 'İlk satır\nİkinci satır',
      customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
      memberIds: [ids.holder],
      status: 'in_progress',
      color: 'teal',
      icon: 'code',
      targetDate: '2027-03-01',
    });
    const forEmployee = await read(employee, opened.id);
    expect(forEmployee).toEqual(opened);
    expect(forEmployee).toMatchObject({
      name: 'Sayfası okunan proje',
      description: 'İlk satır\nİkinci satır',
      status: 'in_progress',
      closed: false,
      color: 'teal',
      icon: 'code',
      targetDate: '2027-03-01',
      aiAllowed: false,
      agentsMayWork: false,
      memberCount: 2,
      customer: {
        id: ARMA_CUSTOMER,
        name: 'Arma Müşterisi',
        aiAllowed: false,
        automatedProcessingAllowed: null,
      },
      createdBy: { userId: ids.employee, name: 'Çalışan' },
      actions: {
        edit: true,
        addMembers: true,
        setAiPermission: false,
        setCustomerPermissions: false,
      },
    });
    expect([...forEmployee.members].sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      {
        userId: ids.employee,
        name: 'Çalışan',
        role: 'employee',
        active: true,
        // The reader opened the project: its owner, whom nobody removes.
        projectRole: 'owner',
        removable: false,
        roleChanges: [],
      },
      {
        userId: ids.holder,
        name: 'Passkey Sahibi',
        role: 'employee',
        active: true,
        projectRole: 'member',
        removable: true,
        roleChanges: ['manager', 'owner'],
      },
    ]);
    expect(Date.parse(forEmployee.createdAt)).toBeGreaterThan(Date.now() - 60_000);

    // The founder reads the same project without being a member, with the permissions.
    const forFounder = await read(founder, opened.id);
    expect(forFounder.customer).toEqual({
      id: ARMA_CUSTOMER,
      name: 'Arma Müşterisi',
      aiAllowed: false,
      automatedProcessingAllowed: false,
    });
    expect(forFounder.actions).toEqual({
      edit: true,
      addMembers: true,
      setBudget: true,
      setAiPermission: true,
      setCustomerPermissions: true,
      setAiSpendingLimit: true,
    });
    // Without a customer there is no customer permission to set.
    const plain = await open(founder, { name: 'Müşterisiz proje' });
    expect(plain.actions.setCustomerPermissions).toBe(false);
    expect(plain.actions.setAiPermission).toBe(true);
  });

  it('a member changes the fields; a field left out stays; an empty description and a null target date clear', async () => {
    const project = await open(employee, {
      name: 'Düzenlenen proje',
      description: 'İlk açıklama',
      targetDate: '2026-12-31',
      memberIds: [ids.holder],
    });
    const patch = async (session: string, body: object) => {
      const res = await call(session, 'PATCH', `/api/projects/${project.id}`, body);
      expect(res.statusCode, res.body).toBe(200);
      return projectDetailSchema.parse(res.json());
    };
    // Another member than the opener.
    expect(
      await patch(colleague, {
        name: '  Yeni ad  ',
        status: 'in_progress',
        color: 'purple',
        icon: 'bolt',
        customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
      }),
    ).toMatchObject({
      name: 'Yeni ad',
      status: 'in_progress',
      color: 'purple',
      icon: 'bolt',
      description: 'İlk açıklama',
      targetDate: '2026-12-31',
      customer: { id: ARMA_CUSTOMER },
      memberCount: 2,
      createdBy: { userId: ids.employee },
    });
    expect(await patch(employee, { description: '', targetDate: null })).toMatchObject({
      name: 'Yeni ad',
      description: null,
      targetDate: null,
      status: 'in_progress',
      customer: { id: ARMA_CUSTOMER },
    });
    expect(await patch(employee, { description: '   \n ' })).toMatchObject({ description: null });
    expect(
      await patch(founder, { customer: { kind: 'none' }, targetDate: '2027-01-01' }),
    ).toMatchObject({
      customer: null,
      targetDate: '2027-01-01',
      name: 'Yeni ad',
    });
    // An unknown customer, and a customer of the other company.
    for (const customerId of [randomUUID(), PILLIKA_CUSTOMER]) {
      const res = await call(employee, 'PATCH', `/api/projects/${project.id}`, {
        name: 'Değişmemeli',
        customer: { kind: 'existing', customerId },
      });
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('customer_not_found');
    }
    expect((await read(employee, project.id)).name).toBe('Yeni ad');
  });

  it('400 invalid_request for a target date that is no day of the database; nothing is changed', async () => {
    const project = await open(employee, { name: 'Tarihi bozulmayan', targetDate: '2026-12-31' });
    for (const session of [employee, founder]) {
      for (const targetDate of ['0000-01-01', '0000-12-31', '2026-02-30', '31.12.2026']) {
        const res = await call(session, 'PATCH', `/api/projects/${project.id}`, {
          name: 'Değişmemeli',
          targetDate,
        });
        expect(res.statusCode, targetDate).toBe(400);
        expect(errorCode(res)).toBe('invalid_request');
      }
    }
    expect(await read(employee, project.id)).toMatchObject({
      name: 'Tarihi bozulmayan',
      targetDate: '2026-12-31',
    });
    // The first year the database knows is taken.
    const first = await call(employee, 'PATCH', `/api/projects/${project.id}`, {
      targetDate: '0001-01-01',
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(projectDetailSchema.parse(first.json()).targetDate).toBe('0001-01-01');
  });

  it('completed and cancelled close a project and planned opens it again; nothing is deleted', async () => {
    const project = await open(employee, { name: 'Kapanıp açılan proje', memberIds: [ids.holder] });
    const setStatus = async (status: string) => {
      const res = await call(employee, 'PATCH', `/api/projects/${project.id}`, { status });
      expect(res.statusCode).toBe(200);
      return projectDetailSchema.parse(res.json());
    };
    for (const [status, closed] of [
      ['completed', true],
      ['backlog', false],
      ['cancelled', true],
      ['in_progress', false],
      ['cancelled', true],
      ['planned', false],
    ] as const) {
      expect(await setStatus(status)).toMatchObject({ status, closed, memberCount: 2 });
    }
    // A closed project stays readable and editable.
    await setStatus('completed');
    const renamed = await call(colleague, 'PATCH', `/api/projects/${project.id}`, {
      name: 'Kapalıyken',
    });
    expect(renamed.statusCode).toBe(200);
    expect(await read(employee, project.id)).toMatchObject({ name: 'Kapalıyken', closed: true });
  });

  it('there is no route that deletes a project or a customer', async () => {
    const project = await open(employee, { name: 'Silinemeyen proje' });
    for (const session of [employee, founder]) {
      for (const url of [`/api/projects/${project.id}`, `/api/customers/${ARMA_CUSTOMER}`]) {
        const res = await call(session, 'DELETE', url);
        expect(res.statusCode, url).toBe(404);
      }
    }
    expect((await read(employee, project.id)).name).toBe('Silinemeyen proje');
    expect(await count('customers', 'id = $1', [ARMA_CUSTOMER])).toBe(1);
  });

  it('PATCH carries no AI permission and no customer permission', async () => {
    const project = await open(founder, { name: 'İzni düzenlemeyle değişmeyen' });
    const refused: object[] = [
      { aiAllowed: true },
      { name: 'Ad', aiAllowed: true },
      { name: 'Ad', ai_allowed: true },
      { customer: { kind: 'new', id: randomUUID(), name: 'İzinli', aiAllowed: true } },
      {
        customer: {
          kind: 'new',
          id: randomUUID(),
          name: 'İzinli',
          automatedProcessingAllowed: true,
        },
      },
      { customer: { kind: 'existing', customerId: ARMA_CUSTOMER, aiAllowed: true } },
      { memberIds: [ids.holder] },
      { budget: 5 },
      {},
    ];
    for (const body of refused) {
      const res = await call(founder, 'PATCH', `/api/projects/${project.id}`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    expect(await read(founder, project.id)).toMatchObject({
      name: 'İzni düzenlemeyle değişmeyen',
      aiAllowed: false,
      customer: null,
    });
    expect(await count('customers', 'name = $1', ['İzinli'])).toBe(0);
  });

  it('a customer added while editing starts with closed permissions, for the founder too', async () => {
    const project = await open(founder, { name: 'Düzenlerken müşteri eklenen' });
    const customer = { kind: 'new', id: randomUUID(), name: 'Duzenlerken eklenen musteri' };
    const res = await call(founder, 'PATCH', `/api/projects/${project.id}`, { customer });
    expect(res.statusCode, res.body).toBe(200);
    expect(projectDetailSchema.parse(res.json()).customer).toEqual({
      id: customer.id,
      name: customer.name,
      aiAllowed: false,
      automatedProcessingAllowed: false,
    });
    // A name that exists, whatever the case: the project keeps its customer and nothing is added.
    const again = await call(founder, 'PATCH', `/api/projects/${project.id}`, {
      name: 'Değişmemeli',
      customer: { kind: 'new', id: randomUUID(), name: 'DUZENLERKEN EKLENEN MUSTERI' },
    });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe('customer_exists');
    // A new customer whose id is another customer's takes nothing over.
    const stolen = await call(founder, 'PATCH', `/api/projects/${project.id}`, {
      customer: { kind: 'new', id: ARMA_CUSTOMER, name: 'Devralınan müşteri' },
    });
    expect(stolen.statusCode).toBe(400);
    expect(await read(founder, project.id)).toMatchObject({
      name: 'Düzenlerken müşteri eklenen',
      customer: { id: customer.id },
    });
    expect(
      await count('customers', 'id = $1 and name = $2', [ARMA_CUSTOMER, 'Arma Müşterisi']),
    ).toBe(1);
  });

  // Members (8 October decision 44) -----------------------------------------------------------------

  const ADD_REFUSED =
    'Projeye üye eklemeyi yalnızca projenin sahibi, yöneticileri ve kurucu yapabilir.';
  const REMOVE_REFUSED =
    'Projeden üye çıkarmayı yalnızca projenin sahibi, yöneticileri ve kurucu yapabilir.';
  const MANAGER_PROTECTED =
    'Bir yöneticiyi projeden yalnızca projenin sahibi ya da kurucu çıkarabilir.';
  const OWNER_NOT_REMOVED =
    'Projenin sahibi projeden çıkarılamaz. Önce sahiplik başka bir üyeye devredilir.';
  const OWNER_ROLE_FIXED =
    'Sahibin rolü doğrudan değiştirilemez. Sahipliği devretmek için başka bir üyeyi sahip yapın.';
  const ROLES_REFUSED = 'Projede rolleri yalnızca projenin sahibi ya da kurucu değiştirebilir.';

  /** The audit rows of a project's members, in the order they were written. */
  async function memberEvents(projectId: string): Promise<string[]> {
    const rows = await adminQuery<{ event: string }>(
      `select event from office.audit_log
       where project_id = $1 and event ~ '^project_member_' order by id`,
      [projectId],
    );
    return rows.map((row) => row.event);
  }

  /** The rows of a project's members as the database holds them. */
  async function storedRoles(projectId: string): Promise<Record<string, string>> {
    const rows = await adminQuery<{ user_id: string; role: string }>(
      'select user_id, role from office.project_members where project_id = $1',
      [projectId],
    );
    return Object.fromEntries(rows.map((row) => [row.user_id, row.role]));
  }

  it('the owner adds and removes a colleague without a passkey; adding twice changes nothing; removing somebody who is not a member is 404', async () => {
    const project = await open(employee, { name: 'Üyeleri değişen proje' });
    const members = `/api/projects/${project.id}/members`;
    const added = await call(employee, 'PUT', `${members}/${ids.holder}`);
    expect(added.statusCode, added.body).toBe(200);
    const withColleague = projectDetailSchema.parse(added.json());
    expect(withColleague.memberCount).toBe(2);
    // Who is added is a plain member.
    expect(rolesOf(withColleague)).toEqual({ [ids.employee]: 'owner', [ids.holder]: 'member' });
    // The new member reads the project, and neither adds nor removes anybody.
    expect((await read(colleague, project.id)).memberCount).toBe(2);
    const byColleague = await call(colleague, 'PUT', `${members}/${ids.founder}`);
    expect(byColleague.statusCode).toBe(403);
    expect(errorCode(byColleague)).toBe('project_members_not_allowed');
    const ownerOut = await call(colleague, 'DELETE', `${members}/${ids.employee}`);
    expect(ownerOut.statusCode).toBe(403);
    expect(errorCode(ownerOut)).toBe('project_members_not_allowed');
    // The owner adds the founder, also with the id in capitals.
    const withFounder = await call(employee, 'PUT', `${members}/${ids.founder.toUpperCase()}`);
    expect(projectDetailSchema.parse(withFounder.json()).memberCount).toBe(3);

    const twice = await call(employee, 'PUT', `${members}/${ids.holder}`);
    expect(twice.statusCode).toBe(200);
    expect(projectDetailSchema.parse(twice.json()).memberCount).toBe(3);
    expect(
      await count('audit_log', `event = 'project_member_added' and project_id = $1`, [project.id]),
    ).toBe(3);

    // The owner removes a member.
    const removed = await call(employee, 'DELETE', `${members}/${ids.holder.toUpperCase()}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      projectDetailSchema
        .parse(removed.json())
        .members.map((member) => member.userId)
        .sort(),
    ).toEqual([ids.founder, ids.employee].sort());
    // The removed person no longer reads it.
    expect((await call(colleague, 'GET', `/api/projects/${project.id}`)).statusCode).toBe(404);

    for (const userId of [ids.holder, ids.newcomer, randomUUID()]) {
      const res = await call(employee, 'DELETE', `${members}/${userId}`);
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('not_found');
    }
    expect((await read(employee, project.id)).memberCount).toBe(2);
  });

  it('403 project_members_not_allowed when a plain member adds or removes; nothing is written', async () => {
    const project = await open(employee, {
      name: 'Üyenin yönetemediği proje',
      memberIds: [ids.holder, ids.newcomer],
    });
    const members = `/api/projects/${project.id}/members`;
    const before = await memberEvents(project.id);
    // Whoever is named: a colleague, somebody who is a member already, an external person, a
    // deactivated account. The answer never says why that person could not be added.
    for (const userId of [ids.founder, ids.newcomer, ids.external, DEACTIVATED, randomUUID()]) {
      const res = await call(colleague, 'PUT', `${members}/${userId}`);
      expect(res.statusCode, userId).toBe(403);
      expect(errorCode(res), userId).toBe('project_members_not_allowed');
      expect(messageOf(res), userId).toBe(ADD_REFUSED);
    }
    // Another plain member, and the owner.
    for (const userId of [ids.newcomer, ids.employee]) {
      const res = await call(colleague, 'DELETE', `${members}/${userId}`);
      expect(res.statusCode, userId).toBe(403);
      expect(errorCode(res), userId).toBe('project_members_not_allowed');
      expect(messageOf(res), userId).toBe(REMOVE_REFUSED);
    }
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'owner',
      [ids.holder]: 'member',
      [ids.newcomer]: 'member',
    });
    expect(await memberEvents(project.id)).toEqual(before);
  });

  it('403 project_manager_protected when a manager removes a manager; 409 project_owner_fixed when anybody removes the owner, the founder too', async () => {
    const project = await open(employee, {
      name: 'Yöneticili proje',
      memberIds: [ids.holder, ids.newcomer],
    });
    const members = `/api/projects/${project.id}/members`;
    await giveRole(employee, project.id, ids.holder, 'manager');
    await giveRole(employee, project.id, ids.newcomer, 'manager');

    const manager = await call(colleague, 'DELETE', `${members}/${ids.newcomer}`);
    expect(manager.statusCode).toBe(403);
    expect(errorCode(manager)).toBe('project_manager_protected');
    expect(messageOf(manager)).toBe(MANAGER_PROTECTED);

    for (const session of [colleague, founder]) {
      const owner = await call(session, 'DELETE', `${members}/${ids.employee}`);
      expect(owner.statusCode).toBe(409);
      expect(errorCode(owner)).toBe('project_owner_fixed');
      expect(messageOf(owner)).toBe(OWNER_NOT_REMOVED);
    }
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'owner',
      [ids.holder]: 'manager',
      [ids.newcomer]: 'manager',
    });

    // A manager adds a member and removes a plain member.
    const added = await call(colleague, 'PUT', `${members}/${ids.founder}`);
    expect(added.statusCode, added.body).toBe(200);
    const out = await call(colleague, 'DELETE', `${members}/${ids.founder}`);
    expect(out.statusCode, out.body).toBe(200);
    // Once dismissed, the other manager is a plain member like any other.
    await giveRole(employee, project.id, ids.newcomer, 'member');
    const dismissed = await call(colleague, 'DELETE', `${members}/${ids.newcomer}`);
    expect(dismissed.statusCode, dismissed.body).toBe(200);
    // The founder removes a manager.
    const byFounder = await call(founder, 'DELETE', `${members}/${ids.holder}`);
    expect(byFounder.statusCode, byFounder.body).toBe(200);
    expect(await storedRoles(project.id)).toEqual({ [ids.employee]: 'owner' });
  });

  it('409 own_project_membership for an employee whatever their role, with the sentence of their role; the founder removes themselves and still reads the project; the founder who is the owner gets project_owner_fixed', async () => {
    const project = await open(employee, {
      name: 'Kendini çıkaran',
      memberIds: [ids.holder, ids.newcomer, ids.founder],
    });
    const members = `/api/projects/${project.id}/members`;
    await giveRole(employee, project.id, ids.holder, 'manager');
    const sentences: [string, string, string][] = [
      [
        employee,
        ids.employee,
        'Kendinizi projeden çıkaramazsınız. Projenin sahibisiniz; önce sahipliği başka bir üyeye devredin.',
      ],
      [
        colleague,
        ids.holder,
        'Kendinizi projeden çıkaramazsınız. Sizi projenin sahibi ya da kurucu çıkarabilir.',
      ],
      [
        third,
        ids.newcomer,
        'Kendinizi projeden çıkaramazsınız. Sizi projenin sahibi, bir yöneticisi ya da kurucu çıkarabilir.',
      ],
    ];
    for (const [session, own, sentence] of sentences) {
      for (const userId of [own, own.toUpperCase()]) {
        const res = await call(session, 'DELETE', `${members}/${userId}`);
        expect(res.statusCode, own).toBe(409);
        expect(errorCode(res), own).toBe('own_project_membership');
        expect(messageOf(res), own).toBe(sentence);
      }
    }
    expect((await read(employee, project.id)).memberCount).toBe(4);

    const byFounder = await call(founder, 'DELETE', `${members}/${ids.founder}`);
    expect(byFounder.statusCode, byFounder.body).toBe(200);
    expect(projectDetailSchema.parse(byFounder.json()).memberCount).toBe(3);
    expect((await read(founder, project.id)).name).toBe('Kendini çıkaran');

    // The founder who owns the project is its owner like anybody else.
    await call(founder, 'PUT', `${members}/${ids.founder}`);
    await giveRole(founder, project.id, ids.founder, 'owner');
    const asOwner = await call(founder, 'DELETE', `${members}/${ids.founder}`);
    expect(asOwner.statusCode).toBe(409);
    expect(errorCode(asOwner)).toBe('project_owner_fixed');
    expect(messageOf(asOwner)).toBe(OWNER_NOT_REMOVED);
    expect(await storedRoles(project.id)).toEqual({
      [ids.founder]: 'owner',
      [ids.employee]: 'member',
      [ids.holder]: 'manager',
      [ids.newcomer]: 'member',
    });
  });

  it('the founder removes the last member of a project without an owner; the project stays, read by the founder alone', async () => {
    const project = await open(employee, { name: 'Sahipsiz proje', memberIds: [ids.founder] });
    const members = `/api/projects/${project.id}/members`;
    // A project loses its owner only by an act on the company's members (docs/SONRA.md P1b-h);
    // here the row is written as that act would leave it.
    await adminQuery(`update office.project_members set role = 'member' where project_id = $1`, [
      project.id,
    ]);
    // Nobody of the project can take the ownership or remove anybody.
    const taken = await setRole(employee, project.id, ids.employee, 'owner');
    expect(taken.statusCode).toBe(403);
    expect(errorCode(taken)).toBe('project_roles_not_allowed');
    const refused = await call(employee, 'DELETE', `${members}/${ids.founder}`);
    expect(refused.statusCode).toBe(403);

    const own = await call(founder, 'DELETE', `${members}/${ids.founder}`);
    expect(own.statusCode, own.body).toBe(200);
    const last = await call(founder, 'DELETE', `${members}/${ids.employee}`);
    expect(projectDetailSchema.parse(last.json())).toMatchObject({ memberCount: 0, members: [] });
    expect((await call(employee, 'GET', `/api/projects/${project.id}`)).statusCode).toBe(404);
    expect((await read(founder, project.id)).name).toBe('Sahipsiz proje');
    // The founder names an owner again: adds a member and gives the role.
    await call(founder, 'PUT', `${members}/${ids.employee}`);
    expect(rolesOf(await giveRole(founder, project.id, ids.employee, 'owner'))).toEqual({
      [ids.employee]: 'owner',
    });
  });

  it('409 member_not_allowed for an external person, a person outside the company and a deactivated account', async () => {
    const project = await open(employee, { name: 'Üye olamayanlar' });
    for (const session of [employee, founder]) {
      for (const userId of [
        ids.external,
        ids.lawyer,
        ids.otherFounder,
        randomUUID(),
        DEACTIVATED,
      ]) {
        const res = await call(session, 'PUT', `/api/projects/${project.id}/members/${userId}`);
        expect(res.statusCode, userId).toBe(409);
        expect(errorCode(res), userId).toBe('member_not_allowed');
      }
    }
    expect(await read(employee, project.id)).toMatchObject({
      memberCount: 1,
      members: [{ userId: ids.employee }],
    });
    expect(await count('project_members', 'project_id = $1', [project.id])).toBe(1);
  });

  it('PUT .../role: the owner appoints and dismisses a manager; the founder too; 403 project_roles_not_allowed for a manager and a plain member; 404 for a non-member, for an unknown member and for a malformed id; 400 for an unknown role', async () => {
    const project = await open(employee, {
      name: 'Rol verilen proje',
      memberIds: [ids.holder, ids.newcomer],
    });
    const plain = { [ids.employee]: 'owner', [ids.holder]: 'member', [ids.newcomer]: 'member' };
    const managed = { ...plain, [ids.holder]: 'manager' };
    for (const session of [employee, founder]) {
      // No passkey is asked for (5 October decision 4).
      expect(rolesOf(await giveRole(session, project.id, ids.holder, 'manager'))).toEqual(managed);
      // The role the member has: 200, and nothing is written.
      expect(
        rolesOf(await giveRole(session, project.id, ids.holder.toUpperCase(), 'manager')),
      ).toEqual(managed);
      expect(await storedRoles(project.id)).toEqual(managed);
      expect(rolesOf(await giveRole(session, project.id, ids.holder, 'member'))).toEqual(plain);
      expect(rolesOf(await giveRole(session, project.id, ids.holder, 'member'))).toEqual(plain);
    }
    expect(await memberEvents(project.id)).toEqual([
      'project_member_added',
      'project_member_role_owner',
      'project_member_added',
      'project_member_added',
      'project_member_role_manager',
      'project_member_role_member',
      'project_member_role_manager',
      'project_member_role_member',
    ]);
    const [last] = await adminQuery<{ user_id: string; record_id: string }>(
      `select user_id, record_id from office.audit_log
       where project_id = $1 and event = 'project_member_role_member' order by id desc limit 1`,
      [project.id],
    );
    expect(last).toEqual({ user_id: ids.founder, record_id: ids.holder });

    // A manager and a plain member give no role, to anybody.
    await giveRole(employee, project.id, ids.holder, 'manager');
    const before = await memberEvents(project.id);
    const refused: [string, string, string][] = [
      [colleague, ids.newcomer, 'manager'],
      [colleague, ids.holder, 'owner'],
      [colleague, ids.holder, 'member'],
      [colleague, ids.employee, 'member'],
      [third, ids.newcomer, 'manager'],
      [third, ids.newcomer, 'owner'],
      [third, ids.holder, 'member'],
      // Also for somebody who is no member of the project: the answer does not say so.
      [third, ids.founder, 'manager'],
    ];
    for (const [session, userId, role] of refused) {
      const res = await setRole(session, project.id, userId, role);
      expect(res.statusCode, `${userId} ${role}`).toBe(403);
      expect(errorCode(res), `${userId} ${role}`).toBe('project_roles_not_allowed');
      expect(messageOf(res)).toBe(ROLES_REFUSED);
    }

    // A person the owner or the founder names who is no member of the project; an id nobody has;
    // an id that is not one.
    for (const session of [employee, founder]) {
      for (const userId of [ids.founder, ids.external, randomUUID(), 'not-an-id']) {
        const res = await setRole(session, project.id, userId, 'manager');
        expect(res.statusCode, userId).toBe(404);
        expect(errorCode(res), userId).toBe('not_found');
      }
    }
    // A reader who cannot read the project: a colleague who is no member, the founder with the
    // other company selected.
    const alone = await open(employee, { name: 'Tek üyeli proje' });
    for (const [session, company] of [
      [colleague, ids.arma],
      [founder, ids.pillika],
    ] as const) {
      const res = await setRole(session, alone.id, ids.employee, 'member', company);
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('not_found');
    }

    // The body: one of the three roles and nothing else.
    const url = `/api/projects/${project.id}/members/${ids.newcomer}/role`;
    for (const payload of [
      { role: 'admin' },
      { role: 'Yönetici' },
      { role: null },
      {},
      { role: 'manager', userId: ids.holder },
      { role: 'manager', stepUp: {} },
    ]) {
      const res = await call(employee, 'PUT', url, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    expect((await call(employee, 'PUT', url)).statusCode).toBe(400);
    expect(await storedRoles(project.id)).toEqual(managed);
    expect(await memberEvents(project.id)).toEqual(before);
  });

  it("PUT .../role: handing the ownership over makes the former owner a plain member, in one answer; 409 project_owner_fixed for the owner's own role", async () => {
    const project = await open(employee, {
      name: 'Sahipliği devredilen proje',
      memberIds: [ids.holder, ids.newcomer],
    });
    await giveRole(employee, project.id, ids.holder, 'manager');
    // The owner's own role is not changed directly, by the owner or by the founder.
    for (const session of [employee, founder]) {
      for (const role of ['member', 'manager']) {
        const res = await setRole(session, project.id, ids.employee, role);
        expect(res.statusCode, role).toBe(409);
        expect(errorCode(res), role).toBe('project_owner_fixed');
        expect(messageOf(res)).toBe(OWNER_ROLE_FIXED);
      }
      // The role the owner has: nothing to do.
      expect(rolesOf(await giveRole(session, project.id, ids.employee, 'owner'))).toMatchObject({
        [ids.employee]: 'owner',
      });
    }

    const before = await memberEvents(project.id);
    const handed = await giveRole(employee, project.id, ids.holder, 'owner');
    expect(rolesOf(handed)).toEqual({
      [ids.employee]: 'member',
      [ids.holder]: 'owner',
      [ids.newcomer]: 'member',
    });
    // The answer is the page of a plain member: the former owner manages nothing any more.
    expect(handed.actions.addMembers).toBe(false);
    expect(handed.members.every((member) => !member.removable)).toBe(true);
    expect(handed.members.every((member) => member.roleChanges.length === 0)).toBe(true);
    expect((await memberEvents(project.id)).slice(before.length)).toEqual([
      'project_member_role_member',
      'project_member_role_owner',
    ]);
    const back = await setRole(employee, project.id, ids.employee, 'owner');
    expect(back.statusCode).toBe(403);
    expect(errorCode(back)).toBe('project_roles_not_allowed');
    const add = await call(employee, 'PUT', `/api/projects/${project.id}/members/${ids.founder}`);
    expect(add.statusCode).toBe(403);

    // The new owner acts as the owner; the founder, no member, hands over to a plain member.
    expect(rolesOf(await giveRole(colleague, project.id, ids.employee, 'manager'))).toMatchObject({
      [ids.employee]: 'manager',
    });
    expect(rolesOf(await giveRole(founder, project.id, ids.newcomer, 'owner'))).toEqual({
      [ids.employee]: 'manager',
      [ids.holder]: 'member',
      [ids.newcomer]: 'owner',
    });
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'manager',
      [ids.holder]: 'member',
      [ids.newcomer]: 'owner',
    });
  });

  it('PUT .../role: 409 member_not_allowed with its own sentence for a deactivated account', async () => {
    const person = randomUUID();
    await adminQuery(`insert into office.users (id, name) values ($1, 'Kapanacak Hesap')`, [
      person,
    ]);
    await adminQuery(
      `insert into office.memberships (company_id, user_id, role, can_approve)
       values ($1, $2, 'employee', false)`,
      [ids.arma, person],
    );
    const project = await open(employee, {
      name: 'Hesabı kapanan yönetici',
      memberIds: [person, ids.holder],
    });
    await giveRole(employee, project.id, person, 'manager');
    // The account is deactivated afterwards. The panel has no act for it yet and the database
    // asks for the founder and a passkey, so the row is written with the triggers off, for this
    // one transaction.
    const admin = await adminPool.connect();
    try {
      await admin.query('begin');
      await admin.query(`set local session_replication_role = 'replica'`);
      await admin.query('update office.users set active = false where id = $1', [person]);
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    } finally {
      admin.release();
    }

    const flags = async () => flagsOf(await read(employee, project.id))[person];
    // A deactivated manager can only be dismissed.
    expect(await flags()).toEqual({ role: 'manager', removable: true, gives: ['member'] });
    for (const session of [employee, founder]) {
      const res = await setRole(session, project.id, person, 'owner');
      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('member_not_allowed');
      expect(messageOf(res)).toBe('Devre dışı bir hesaba projede rol verilemez.');
    }
    // The owner until now keeps the role: the refused hand-over changed nothing.
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'owner',
      [person]: 'manager',
      [ids.holder]: 'member',
    });
    expect(rolesOf(await giveRole(employee, project.id, person, 'member'))).toMatchObject({
      [person]: 'member',
    });
    // A deactivated plain member is given no role.
    expect(await flags()).toEqual({ role: 'member', removable: true, gives: [] });
    for (const role of ['manager', 'owner']) {
      const res = await setRole(employee, project.id, person, role);
      expect(res.statusCode, role).toBe(409);
      expect(errorCode(res), role).toBe('member_not_allowed');
      expect(messageOf(res), role).toBe('Devre dışı bir hesaba projede rol verilemez.');
    }
    expect((await storedRoles(project.id))[person]).toBe('member');
  });

  it("the detail carries every member's project role, removable and roleChanges as the reader may act, and addMembers", async () => {
    const project = await open(employee, {
      name: 'Dört okurun gördüğü proje',
      memberIds: [ids.holder, ids.newcomer],
    });
    await giveRole(employee, project.id, ids.holder, 'manager');
    const none = { removable: false, gives: [] };

    // The owner: everybody but themselves.
    const forOwner = await read(employee, project.id);
    expect(forOwner.actions.addMembers).toBe(true);
    expect(flagsOf(forOwner)).toEqual({
      [ids.employee]: { role: 'owner', ...none },
      [ids.holder]: { role: 'manager', removable: true, gives: ['member', 'owner'] },
      [ids.newcomer]: { role: 'member', removable: true, gives: ['manager', 'owner'] },
    });
    // A manager: adds, removes plain members, gives no role.
    const forManager = await read(colleague, project.id);
    expect(forManager.actions.addMembers).toBe(true);
    expect(flagsOf(forManager)).toEqual({
      [ids.employee]: { role: 'owner', ...none },
      [ids.holder]: { role: 'manager', ...none },
      [ids.newcomer]: { role: 'member', removable: true, gives: [] },
    });
    // A plain member: nothing.
    const forMember = await read(third, project.id);
    expect(forMember.actions.addMembers).toBe(false);
    expect(flagsOf(forMember)).toEqual({
      [ids.employee]: { role: 'owner', ...none },
      [ids.holder]: { role: 'manager', ...none },
      [ids.newcomer]: { role: 'member', ...none },
    });
    // The founder, who is no member: what the owner may do, for every row but the owner's.
    const forFounder = await read(founder, project.id);
    expect(forFounder.actions.addMembers).toBe(true);
    expect(flagsOf(forFounder)).toEqual(flagsOf(forOwner));
    // The founder as a plain member of the project still manages it, and may leave.
    await call(founder, 'PUT', `/api/projects/${project.id}/members/${ids.founder}`);
    expect(flagsOf(await read(founder, project.id))[ids.founder]).toEqual({
      role: 'member',
      removable: true,
      gives: ['manager', 'owner'],
    });
    // The flags are what the routes then do: the manager's one removable row leaves.
    const out = await call(
      colleague,
      'DELETE',
      `/api/projects/${project.id}/members/${ids.newcomer}`,
    );
    expect(out.statusCode, out.body).toBe(200);
  });

  /**
   * Runs `change` as somebody else who has not committed yet, with the members table locked, lets
   * the request start and wait for the table, then commits: the request met the project as it was
   * and writes into the project as it is.
   */
  async function whileOnItsWay(
    change: (admin: {
      query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
    }) => Promise<void>,
    request: () => Promise<LightMyRequestResponse>,
  ): Promise<LightMyRequestResponse> {
    const admin = await adminPool.connect();
    let pending: Promise<LightMyRequestResponse>;
    try {
      await admin.query('begin');
      await admin.query('lock table office.project_members in exclusive mode');
      await change(admin);
      pending = request();
      await untilServerWaits();
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    } finally {
      admin.release();
    }
    return pending;
  }

  it('404 when the person is removed from the project while their add is on its way; 403 when only their role was taken; nobody is added', async () => {
    const project = await open(employee, { name: 'Eklerken çıkarılan', memberIds: [ids.holder] });
    const members = `/api/projects/${project.id}/members`;
    await giveRole(employee, project.id, ids.holder, 'manager');

    // Only the role was taken: the manager still reads the project and is told who adds.
    const demoted = await whileOnItsWay(
      async (admin) => {
        const changed = await admin.query(
          `update office.project_members set role = 'member'
           where project_id = $1 and user_id = $2`,
          [project.id, ids.holder],
        );
        expect(changed.rowCount).toBe(1);
      },
      () => call(colleague, 'PUT', `${members}/${ids.founder}`),
    );
    expect(demoted.statusCode, demoted.body).toBe(403);
    expect(errorCode(demoted)).toBe('project_members_not_allowed');
    expect(messageOf(demoted)).toBe(ADD_REFUSED);
    expect(await count('project_members', 'project_id = $1', [project.id])).toBe(2);

    // Another person's removal that has not committed yet: the route still reads the project for
    // the person, its insert then waits for the table and meets the committed removal. (The
    // owner's row goes as it does when the owner leaves the company.)
    const res = await whileOnItsWay(
      async (admin) => {
        const removed = await admin.query(
          'delete from office.project_members where project_id = $1 and user_id = $2',
          [project.id, ids.employee],
        );
        expect(removed.rowCount).toBe(1);
      },
      () => call(employee, 'PUT', `${members}/${ids.founder}`),
    );
    expect(res.statusCode, res.body).toBe(404);
    expect(errorCode(res)).toBe('not_found');
    // Exactly what a project the person cannot read answers.
    const unknown = await call(
      employee,
      'PUT',
      `/api/projects/${randomUUID()}/members/${ids.founder}`,
    );
    expect(res.json()).toEqual(unknown.json());
    expect((await call(employee, 'GET', `/api/projects/${project.id}`)).statusCode).toBe(404);
    expect((await read(founder, project.id)).members.map((member) => member.userId)).toEqual([
      ids.holder,
    ]);
    expect(await count('project_members', 'project_id = $1', [project.id])).toBe(1);
  });

  it('a removal and a role that meet a change on their way answer with the rule as it is afterwards; nothing is removed and no role is given', async () => {
    const project = await open(employee, {
      name: 'Çıkarırken değişen',
      memberIds: [ids.holder, ids.newcomer],
    });
    const members = `/api/projects/${project.id}/members`;
    await giveRole(employee, project.id, ids.holder, 'manager');
    const makeManager =
      (userId: string) =>
      async (admin: {
        query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
      }) => {
        const changed = await admin.query(
          `update office.project_members set role = 'manager' where project_id = $1 and user_id = $2`,
          [project.id, userId],
        );
        expect(changed.rowCount).toBe(1);
      };

    // The plain member a manager removes is made a manager meanwhile: the database removes no
    // row, and the answer says why.
    const protectedNow = await whileOnItsWay(makeManager(ids.newcomer), () =>
      call(colleague, 'DELETE', `${members}/${ids.newcomer}`),
    );
    expect(protectedNow.statusCode, protectedNow.body).toBe(403);
    expect(errorCode(protectedNow)).toBe('project_manager_protected');
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'owner',
      [ids.holder]: 'manager',
      [ids.newcomer]: 'manager',
    });

    // The ownership goes to somebody else while the owner gives a role: the database refuses,
    // and the former owner is told who gives roles.
    const admin = await adminPool.connect();
    let pending: Promise<LightMyRequestResponse>;
    try {
      await admin.query('begin');
      // The role function locks the member rows of the project; the request waits for them.
      await admin.query(
        `update office.project_members set role = 'member' where project_id = $1 and user_id = $2`,
        [project.id, ids.employee],
      );
      await admin.query(
        `update office.project_members set role = 'owner' where project_id = $1 and user_id = $2`,
        [project.id, ids.holder],
      );
      pending = setRole(employee, project.id, ids.newcomer, 'member');
      await untilServerWaits();
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    } finally {
      admin.release();
    }
    const lost = await pending;
    expect(lost.statusCode, lost.body).toBe(403);
    expect(errorCode(lost)).toBe('project_roles_not_allowed');
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'member',
      [ids.holder]: 'owner',
      [ids.newcomer]: 'manager',
    });
  });

  it('409 project_members_changed when the member is removed and added again while their removal is on its way; nobody is removed', async () => {
    const project = await open(employee, {
      name: 'Çıkarırken yeniden eklenen',
      memberIds: [ids.newcomer],
    });
    // Somebody else removes the member and adds them again, not committed yet. No table lock
    // here: the route's delete must meet the ROW it read, wait for it and find it gone, while
    // the row that replaces it is none it saw. It removes nothing, and the rule read again says
    // the owner may remove this plain member: neither a refusal nor a missing person explains
    // the empty delete.
    const admin = await adminPool.connect();
    let pending: Promise<LightMyRequestResponse>;
    try {
      await admin.query('begin');
      const gone = await admin.query(
        'delete from office.project_members where project_id = $1 and user_id = $2',
        [project.id, ids.newcomer],
      );
      expect(gone.rowCount).toBe(1);
      await admin.query(
        'insert into office.project_members (company_id, project_id, user_id) values ($1, $2, $3)',
        [ids.arma, project.id, ids.newcomer],
      );
      pending = call(employee, 'DELETE', `/api/projects/${project.id}/members/${ids.newcomer}`);
      await untilServerWaits();
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    } finally {
      admin.release();
    }
    const res = await pending;
    expect(res.statusCode, res.body).toBe(409);
    expect(errorCode(res)).toBe('project_members_changed');
    expect(messageOf(res)).toBe(
      'Projenin üyeleri az önce değişti. Sayfayı yenileyip yeniden deneyin.',
    );
    expect(await storedRoles(project.id)).toEqual({
      [ids.employee]: 'owner',
      [ids.newcomer]: 'member',
    });
    // The same request, sent again as the sentence asks, removes the person.
    const again = await call(
      employee,
      'DELETE',
      `/api/projects/${project.id}/members/${ids.newcomer}`,
    );
    expect(again.statusCode, again.body).toBe(200);
    expect(await storedRoles(project.id)).toEqual({ [ids.employee]: 'owner' });
  });

  it('409 project_customer_locked when the customer of a project with an open AI permission is changed, removed or replaced by a new one, for a member and for the founder; nothing is written, no customer is added; the other fields of the same body are not changed either', async () => {
    const first = { kind: 'new', id: randomUUID(), name: 'Kilitli projenin müşterisi' };
    const project = await open(employee, { name: 'Kilitli proje', customer: first });
    await openAiByHand(project.id);
    expect((await read(employee, project.id)).aiAllowed).toBe(true);

    for (const session of [employee, founder]) {
      const added = {
        kind: 'new',
        id: randomUUID(),
        name: `Kilitliyken eklenen ${session.slice(0, 6)}`,
      };
      for (const customer of [
        { kind: 'none' },
        { kind: 'existing', customerId: ARMA_CUSTOMER },
        added,
      ]) {
        const res = await call(session, 'PATCH', `/api/projects/${project.id}`, {
          name: 'Değişmemeli',
          customer,
        });
        expect(res.statusCode, customer.kind).toBe(409);
        expect(errorCode(res), customer.kind).toBe('project_customer_locked');
      }
      expect(await count('customers', 'id = $1', [added.id])).toBe(0);
      expect(await read(session, project.id)).toMatchObject({
        name: 'Kilitli proje',
        customer: { id: first.id },
        aiAllowed: true,
      });
    }
    // Naming the customer it has is no change: the other fields go through.
    const same = await call(employee, 'PATCH', `/api/projects/${project.id}`, {
      name: 'Kilitliyken adı değişen',
      customer: { kind: 'existing', customerId: first.id },
    });
    expect(same.statusCode, same.body).toBe(200);
    expect(projectDetailSchema.parse(same.json())).toMatchObject({
      name: 'Kilitliyken adı değişen',
      customer: { id: first.id },
    });
    // The same for a project without a customer.
    const bare = await open(employee, { name: 'Müşterisiz kilitli proje' });
    await openAiByHand(bare.id);
    const none = await call(employee, 'PATCH', `/api/projects/${bare.id}`, {
      icon: 'pin',
      customer: { kind: 'none' },
    });
    expect(none.statusCode).toBe(200);
    const taken = await call(employee, 'PATCH', `/api/projects/${bare.id}`, {
      customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
    });
    expect(taken.statusCode).toBe(409);
    expect(errorCode(taken)).toBe('project_customer_locked');
  });

  // AI permission ---------------------------------------------------------------------------------

  it('403 founder_only for an employee, member or not', async () => {
    const project = await open(employee, { name: 'Çalışanın açamadığı izin' });
    const open_ = await open(employee, { name: 'Çalışanın kapatamadığı izin' });
    await openAiByHand(open_.id);
    for (const session of [employee, colleague]) {
      for (const [id, body] of [
        [project.id, { allowed: true, customerId: null }],
        [open_.id, { allowed: false }],
        // A project that does not exist says the same: the act is not theirs anywhere.
        [randomUUID(), { allowed: false }],
      ] as const) {
        const res = await setAi(session, id, body);
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('founder_only');
      }
    }
    expect((await read(employee, project.id)).aiAllowed).toBe(false);
    expect((await read(employee, open_.id)).aiAllowed).toBe(true);
    // The body is checked for the founder.
    for (const body of [{}, { allowed: 'yes' }, { allowed: true }, { allowed: false, x: 1 }]) {
      const res = await setAi(founder, project.id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('403 step_up_required without a passkey; the permission stays closed', async () => {
    const project = await open(employee, { name: 'Passkey bekleyen izin' });
    const res = await setAi(founder, project.id, { allowed: true, customerId: null });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('step_up_required');
    expect((await read(founder, project.id)).aiAllowed).toBe(false);
    expect(await events(project.id)).toEqual([]);
  });

  it('opens with a passkey bound to this project; the same signed answer opens no other project and nothing a second time', async () => {
    const project = await open(employee, { name: 'Passkey ile açılan izin' });
    const other = await open(employee, { name: 'Aynı imzayla açılmayan' });
    const stepUp = await confirmProject(project.id, null);
    const opened = await setAi(founder, project.id, { allowed: true, customerId: null, stepUp });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(projectDetailSchema.parse(opened.json())).toMatchObject({
      id: project.id,
      aiAllowed: true,
      // No customer: the project's own permission decides.
      agentsMayWork: true,
    });
    expect(await challengeState(stepUp.challengeId)).toMatchObject({ consumed: true });
    // The member reads the new state.
    expect(await read(employee, project.id)).toMatchObject({
      aiAllowed: true,
      agentsMayWork: true,
    });

    const elsewhere = await setAi(founder, other.id, { allowed: true, customerId: null, stepUp });
    expect(elsewhere.statusCode).toBe(403);
    expect(errorCode(elsewhere)).toBe('step_up_failed');
    expect((await read(founder, other.id)).aiAllowed).toBe(false);

    const closed = await setAi(founder, project.id, { allowed: false });
    expect(closed.statusCode).toBe(200);
    const again = await setAi(founder, project.id, { allowed: true, customerId: null, stepUp });
    expect(again.statusCode).toBe(403);
    expect(errorCode(again)).toBe('step_up_failed');
    expect((await read(founder, project.id)).aiAllowed).toBe(false);
  });

  it('a passkey signed for a customer or for a membership change does not open a project', async () => {
    const project = await open(employee, { name: 'Başka iş için imzalanan' });
    const wrong: StepUp[] = [
      await signStepUp(server, founder, founderKey, {
        purpose: 'customer_ai_permission',
        companyId: ids.arma,
        subjectId: project.id,
        details: customerPermissionDetails({}),
      }),
      await signStepUp(server, founder, founderKey, {
        purpose: 'membership_change',
        companyId: ids.arma,
        subjectId: project.id,
        details: memberChangeDetails('remove'),
      }),
      // The same project id confirmed in the other company.
      await signStepUp(server, founder, founderKey, {
        purpose: 'project_ai_permission',
        companyId: ids.pillika,
        subjectId: project.id,
        details: projectAiPermissionDetails(null),
      }),
      // Another project.
      await confirmProject(randomUUID(), null),
    ];
    for (const stepUp of wrong) {
      const res = await setAi(founder, project.id, { allowed: true, customerId: null, stepUp });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
    }
    expect((await read(founder, project.id)).aiAllowed).toBe(false);
    expect(await events(project.id)).toEqual([]);
  });

  it('closes without a passkey; asking for the value the project has answers 200 and uses nothing', async () => {
    const project = await open(employee, { name: 'Passkey olmadan kapanan izin' });
    // Closed already.
    const still = await setAi(founder, project.id, { allowed: false });
    expect(still.statusCode).toBe(200);
    expect(projectDetailSchema.parse(still.json()).aiAllowed).toBe(false);

    await openAi(project.id);
    // Open already: the signed answer is not looked at and stays unused.
    const unused = await confirmProject(project.id, null);
    const already = await setAi(founder, project.id, {
      allowed: true,
      customerId: null,
      stepUp: unused,
    });
    expect(already.statusCode).toBe(200);
    expect(projectDetailSchema.parse(already.json()).aiAllowed).toBe(true);
    expect(await challengeState(unused.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    // Open already, without any passkey.
    expect((await setAi(founder, project.id, { allowed: true, customerId: null })).statusCode).toBe(
      200,
    );

    const closed = await setAi(founder, project.id, { allowed: false });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(projectDetailSchema.parse(closed.json())).toMatchObject({
      aiAllowed: false,
      agentsMayWork: false,
    });
    expect((await read(employee, project.id)).aiAllowed).toBe(false);
  });

  it('the audit log holds project_ai_permission_opened and project_ai_permission_closed with the founder as actor', async () => {
    const project = await open(employee, { name: 'İzi tutulan izin' });
    await openAi(project.id);
    await setAi(founder, project.id, { allowed: false });
    // Nothing for a request that changed nothing or was refused.
    await setAi(founder, project.id, { allowed: false });
    await setAi(founder, project.id, { allowed: true, customerId: null });
    await openAi(project.id);
    expect(await events(project.id)).toEqual([
      { event: 'project_ai_permission_opened', user_id: ids.founder },
      { event: 'project_ai_permission_closed', user_id: ids.founder },
      { event: 'project_ai_permission_opened', user_id: ids.founder },
    ]);
  });

  it('409 project_changed when the project has another customer than the one the founder confirmed; nothing is opened and the passkey is not used up', async () => {
    const project = await open(employee, { name: 'Onaydan sonra müşterisi değişen' });
    // The founder looks at a project without a customer and confirms with the passkey.
    const confirmed = await confirmProject(project.id, null);
    // A member changes the customer before the opening arrives.
    const changed = await call(employee, 'PATCH', `/api/projects/${project.id}`, {
      customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
    });
    expect(changed.statusCode).toBe(200);

    const stale = await setAi(founder, project.id, {
      allowed: true,
      customerId: null,
      stepUp: confirmed,
    });
    expect(stale.statusCode).toBe(409);
    expect(errorCode(stale)).toBe('project_changed');
    expect(await challengeState(confirmed.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    // Naming the new customer with the old signature is another act than the one signed.
    const forged = await setAi(founder, project.id, {
      allowed: true,
      customerId: ARMA_CUSTOMER,
      stepUp: confirmed,
    });
    expect(forged.statusCode).toBe(403);
    expect(errorCode(forged)).toBe('step_up_failed');
    // Without a passkey the stale page is told first, too.
    const bare = await setAi(founder, project.id, { allowed: true, customerId: null });
    expect(bare.statusCode).toBe(409);
    expect(errorCode(bare)).toBe('project_changed');
    expect(await read(founder, project.id)).toMatchObject({
      aiAllowed: false,
      customer: { id: ARMA_CUSTOMER },
    });
    expect(await events(project.id)).toEqual([]);

    // The founder reads the project again and confirms for the customer it has now.
    expect(await openAi(project.id, ARMA_CUSTOMER)).toMatchObject({
      aiAllowed: true,
      customer: { id: ARMA_CUSTOMER },
    });
  });

  it('409 project_changed when the customer changes while the opening is on its way: the database refuses it', async () => {
    const project = await open(employee, { name: 'Açılırken müşterisi değişen' });
    const confirmed = await confirmProject(project.id, null);
    // A member's change that has not committed yet: the route still reads the old customer, the
    // opening then waits for the row and meets the new one.
    let opening: Promise<LightMyRequestResponse> | undefined;
    await withContext(besidePool, { companyId: ids.arma, userId: ids.employee }, async (member) => {
      const result = await member.query(
        'update office.projects set customer_id = $2 where id = $1',
        [project.id, ARMA_CUSTOMER],
      );
      expect(result.rowCount).toBe(1);
      opening = setAi(founder, project.id, { allowed: true, customerId: null, stepUp: confirmed });
      await untilServerWaits();
    });
    const res = await opening;
    expect(res?.statusCode).toBe(409);
    expect(res ? errorCode(res) : '').toBe('project_changed');
    expect(await read(founder, project.id)).toMatchObject({
      aiAllowed: false,
      customer: { id: ARMA_CUSTOMER },
    });
    // The refused request left nothing: the confirmation is neither used nor counted as failed.
    expect(await challengeState(confirmed.challengeId)).toEqual({
      failed_attempts: 0,
      consumed: false,
    });
    expect(await events(project.id)).toEqual([]);
  });

  it('the customer changes once the founder closed the AI permission, and opening the permission again needs a new passkey', async () => {
    const project = await open(employee, {
      name: 'İzni kapatılıp müşterisi değişen',
      customer: { kind: 'existing', customerId: ARMA_CUSTOMER },
    });
    const first = await confirmProject(project.id, ARMA_CUSTOMER);
    const opened = await setAi(founder, project.id, {
      allowed: true,
      customerId: ARMA_CUSTOMER,
      stepUp: first,
    });
    expect(opened.statusCode, opened.body).toBe(200);
    const remove = { customer: { kind: 'none' } };
    const locked = await call(employee, 'PATCH', `/api/projects/${project.id}`, remove);
    expect(locked.statusCode).toBe(409);
    expect(errorCode(locked)).toBe('project_customer_locked');

    expect((await setAi(founder, project.id, { allowed: false })).statusCode).toBe(200);
    const freed = await call(employee, 'PATCH', `/api/projects/${project.id}`, remove);
    expect(freed.statusCode, freed.body).toBe(200);
    expect(projectDetailSchema.parse(freed.json())).toMatchObject({
      customer: null,
      aiAllowed: false,
    });

    const without = await setAi(founder, project.id, { allowed: true, customerId: null });
    expect(without.statusCode).toBe(403);
    expect(errorCode(without)).toBe('step_up_required');
    const used = await setAi(founder, project.id, {
      allowed: true,
      customerId: null,
      stepUp: first,
    });
    expect(used.statusCode).toBe(403);
    expect(errorCode(used)).toBe('step_up_failed');
    expect((await read(founder, project.id)).aiAllowed).toBe(false);
    expect((await openAi(project.id, null)).aiAllowed).toBe(true);
  });

  // Customer permissions -------------------------------------------------------------------------

  it('PATCH /api/customers/:customerId/permissions is for the founder; 404 for a customer of the other company', async () => {
    for (const session of [employee, colleague]) {
      for (const body of [
        { aiAllowed: true },
        { aiAllowed: false },
        { automatedProcessingAllowed: true },
      ]) {
        const res = await setCustomer(session, ARMA_CUSTOMER, body);
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('founder_only');
      }
    }
    for (const [id, company] of [
      [PILLIKA_CUSTOMER, ids.arma],
      [ARMA_CUSTOMER, ids.pillika],
      [randomUUID(), ids.arma],
      ['not-an-id', ids.arma],
    ] as const) {
      const res = await setCustomer(founder, id, { automatedProcessingAllowed: true }, company);
      expect(res.statusCode, id).toBe(404);
      expect(errorCode(res)).toBe('not_found');
    }
    for (const body of [
      {},
      { aiAllowed: 'yes' },
      { name: 'Yeni ad' },
      { aiAllowed: true, name: 'x' },
    ]) {
      const res = await setCustomer(founder, ARMA_CUSTOMER, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(
      await adminQuery(
        `select name, ai_allowed, automated_processing_allowed from office.customers
         where id = any ($1::uuid[]) order by name`,
        [[ARMA_CUSTOMER, PILLIKA_CUSTOMER]],
      ),
    ).toEqual([
      { name: 'Arma Müşterisi', ai_allowed: false, automated_processing_allowed: false },
      { name: 'Pillika Müşterisi', ai_allowed: false, automated_processing_allowed: false },
    ]);
  });

  it('the AI permission needs a passkey when it is turned on and none when it is turned off; automated processing needs none', async () => {
    const { customerId } = await newCustomer('İzinleri değişen müşteri');
    const { customerId: otherId } = await newCustomer('Başka izinli müşteri');
    const state = (res: LightMyRequestResponse) => {
      expect(res.statusCode, res.body).toBe(200);
      const { aiAllowed, automatedProcessingAllowed } = customerSchema.parse(res.json());
      return { aiAllowed, automatedProcessingAllowed };
    };

    // Automated processing: on and off, no passkey.
    expect(
      state(await setCustomer(founder, customerId, { automatedProcessingAllowed: true })),
    ).toEqual({ aiAllowed: false, automatedProcessingAllowed: true });
    expect(
      state(await setCustomer(founder, customerId, { automatedProcessingAllowed: false })),
    ).toEqual({ aiAllowed: false, automatedProcessingAllowed: false });

    // The AI permission: not without a passkey, and not with one for something else.
    const without = await setCustomer(founder, customerId, { aiAllowed: true });
    expect(without.statusCode).toBe(403);
    expect(errorCode(without)).toBe('step_up_required');
    const wrong: [object, StepUp][] = [
      // Another customer.
      [{ aiAllowed: true }, await confirmCustomer(otherId)],
      // Another body than the one signed.
      [{ aiAllowed: true }, await confirmCustomer(customerId, true)],
      [{ aiAllowed: true, automatedProcessingAllowed: true }, await confirmCustomer(customerId)],
      // A project's permission, naming the customer's id.
      [{ aiAllowed: true }, await confirmProject(customerId, null)],
    ];
    for (const [body, stepUp] of wrong) {
      const res = await setCustomer(founder, customerId, { ...body, stepUp });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('step_up_failed');
    }
    expect(await events(customerId)).toEqual([
      { event: 'customer_automated_processing_opened', user_id: ids.founder },
      { event: 'customer_automated_processing_closed', user_id: ids.founder },
    ]);

    const stepUp = await confirmCustomer(customerId, true);
    expect(
      state(
        await setCustomer(founder, customerId, {
          aiAllowed: true,
          automatedProcessingAllowed: true,
          stepUp,
        }),
      ),
    ).toEqual({ aiAllowed: true, automatedProcessingAllowed: true });
    // The signed answer opens no other customer.
    const reused = await setCustomer(founder, otherId, {
      aiAllowed: true,
      automatedProcessingAllowed: true,
      stepUp,
    });
    expect(reused.statusCode).toBe(403);
    expect(errorCode(reused)).toBe('step_up_failed');

    // Open already: no passkey is asked for. Off: none either. A permission left out stays.
    expect(state(await setCustomer(founder, customerId, { aiAllowed: true }))).toEqual({
      aiAllowed: true,
      automatedProcessingAllowed: true,
    });
    expect(state(await setCustomer(founder, customerId, { aiAllowed: false }))).toEqual({
      aiAllowed: false,
      automatedProcessingAllowed: true,
    });
    // On again: a new passkey.
    const again = await setCustomer(founder, customerId, { aiAllowed: true, stepUp });
    expect(again.statusCode).toBe(403);
    expect((await customers(founder)).find((customer) => customer.id === customerId)).toMatchObject(
      {
        aiAllowed: false,
        automatedProcessingAllowed: true,
      },
    );
    expect((await customers(founder)).find((customer) => customer.id === otherId)).toMatchObject({
      aiAllowed: false,
      automatedProcessingAllowed: false,
    });
    expect((await events(customerId)).slice(2)).toEqual([
      { event: 'customer_ai_permission_opened', user_id: ids.founder },
      { event: 'customer_automated_processing_opened', user_id: ids.founder },
      { event: 'customer_ai_permission_closed', user_id: ids.founder },
    ]);
  });

  it("a project's answer says agents may not work while its customer's AI permission is closed, and may once both are open", async () => {
    const { customerId, projectId } = await newCustomer('Sözleşmesi izin vermeyen müşteri');
    await call(founder, 'PUT', `/api/projects/${projectId}/members/${ids.employee}`);
    // The founder may open the project's permission; the customer's contract still decides.
    expect(await openAi(projectId, customerId)).toMatchObject({
      aiAllowed: true,
      agentsMayWork: false,
      customer: { id: customerId, aiAllowed: false },
    });
    const list = async () => {
      const res = await call(employee, 'GET', '/api/projects');
      return projectListSchema.parse(res.json()).projects.find((row) => row.id === projectId);
    };
    expect(await list()).toMatchObject({ aiAllowed: true, agentsMayWork: false });

    const stepUp = await confirmCustomer(customerId);
    const opened = await setCustomer(founder, customerId, { aiAllowed: true, stepUp });
    expect(opened.statusCode, opened.body).toBe(200);
    // A member reads it too: the customer's permission as a word, never the other permission.
    expect(await read(employee, projectId)).toMatchObject({
      aiAllowed: true,
      agentsMayWork: true,
      customer: { id: customerId, aiAllowed: true, automatedProcessingAllowed: null },
    });
    expect(await list()).toMatchObject({ aiAllowed: true, agentsMayWork: true });

    // Either permission closed again closes the project to agents.
    await setCustomer(founder, customerId, { aiAllowed: false });
    expect(await read(employee, projectId)).toMatchObject({
      aiAllowed: true,
      agentsMayWork: false,
    });
    await setCustomer(founder, customerId, {
      aiAllowed: true,
      stepUp: await confirmCustomer(customerId),
    });
    await setAi(founder, projectId, { allowed: false });
    expect(await read(employee, projectId)).toMatchObject({
      aiAllowed: false,
      agentsMayWork: false,
    });
  });

  // Step 3 of the Projects section (8 October decision 17): the budget and the milestones.
  describe('budget and milestones', () => {
    const BUDGET_REFUSED =
      'Projenin bütçesini yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.';

    const setBudget = (session: string, projectId: string, budget: unknown, company?: string) =>
      call(session, 'PUT', `/api/projects/${projectId}/budget`, { budget }, company);

    /** A project of the employee (its owner) with a manager (holder) and a plain member (newcomer). */
    async function staffed(name: string): Promise<ProjectDetail> {
      const project = await open(employee, { name, memberIds: [ids.holder, ids.newcomer] });
      return giveRole(employee, project.id, ids.holder, 'manager');
    }

    async function stored(projectId: string) {
      const [row] = await adminQuery<{
        budget: string | null;
        budget_currency: string | null;
        milestones: unknown[];
      }>(
        'select budget::text as budget, budget_currency, milestones from office.projects where id = $1',
        [projectId],
      );
      if (!row) {
        throw new Error('No such project');
      }
      return row;
    }

    async function trace(projectId: string): Promise<{ event: string; user_id: string | null }[]> {
      return adminQuery(
        `select event, user_id from office.audit_log
         where project_id = $1 and event ~ '^project_(budget|milestones)_' order by id`,
        [projectId],
      );
    }

    const milestonesUrl = (projectId: string, milestoneId?: string): string =>
      `/api/projects/${projectId}/milestones${milestoneId === undefined ? '' : `/${milestoneId}`}`;

    /** Sends a milestone request and expects the whole project back. */
    async function milestone(
      session: string,
      method: Method,
      url: string,
      payload?: object,
    ): Promise<ProjectDetail> {
      const res = await call(session, method, url, payload);
      expect(res.statusCode, res.body).toBe(200);
      return projectDetailSchema.parse(res.json());
    }

    /**
     * Runs a request of the server while a change of somebody else, made behind a lock on the
     * project row, has not committed yet: the route reads the project as it was, its update waits
     * for the row and then meets the change.
     */
    async function whileProjectIsHeld(
      projectId: string,
      change: (admin: {
        query(sql: string, values?: unknown[]): Promise<unknown>;
      }) => Promise<void>,
      request: () => Promise<LightMyRequestResponse>,
    ): Promise<LightMyRequestResponse> {
      const admin = await adminPool.connect();
      let pending: Promise<LightMyRequestResponse>;
      try {
        await admin.query('begin');
        await admin.query('select 1 from office.projects where id = $1 for update', [projectId]);
        await change(admin);
        pending = request();
        await untilServerWaits();
        await admin.query('commit');
      } catch (error) {
        await admin.query('rollback');
        throw error;
      } finally {
        admin.release();
      }
      return pending;
    }

    it('PUT budget: the owner, a manager and the founder set and clear it; the answer carries it for them', async () => {
      const project = await staffed('Bütçesi olan proje');
      expect(project.budget).toEqual({ visible: true, value: null });
      expect(project.actions.setBudget).toBe(true);
      const setters: [string, { amount: string; currency: string }, string][] = [
        [employee, { amount: '150000.5', currency: 'TRY' }, '150000.50'],
        [colleague, { amount: '99', currency: 'USD' }, '99.00'],
        [founder, { amount: '2500000.00', currency: 'EUR' }, '2500000.00'],
      ];
      for (const [session, budget, amount] of setters) {
        const res = await setBudget(session, project.id, budget);
        expect(res.statusCode, res.body).toBe(200);
        const answer = projectDetailSchema.parse(res.json());
        // The whole project, as every change answers.
        expect(answer).toMatchObject({
          id: project.id,
          name: 'Bütçesi olan proje',
          memberCount: 3,
        });
        expect(answer.budget).toEqual({
          visible: true,
          value: { amount, currency: budget.currency },
        });
        expect(answer.actions.setBudget).toBe(true);
        expect(await stored(project.id)).toMatchObject({
          budget: amount,
          budget_currency: budget.currency,
        });
      }
      // Each of the three reads what the last one set; the founder is no member of the project.
      for (const session of [employee, colleague, founder]) {
        expect((await read(session, project.id)).budget).toEqual({
          visible: true,
          value: { amount: '2500000.00', currency: 'EUR' },
        });
      }
      // null takes the budget away; taking away what is not there is no error.
      for (const session of [colleague, founder]) {
        const res = await setBudget(session, project.id, null);
        expect(res.statusCode, res.body).toBe(200);
        expect(projectDetailSchema.parse(res.json()).budget).toEqual({
          visible: true,
          value: null,
        });
        expect(await stored(project.id)).toMatchObject({ budget: null, budget_currency: null });
      }
    });

    it("PUT budget: a plain member is told 403 project_budget_not_allowed and nothing changes; a non-member and an unknown project are 404; an external person gets the section's answer", async () => {
      const project = await staffed('Bütçesine dokunulmayan proje');
      await setBudget(employee, project.id, { amount: '500', currency: 'TRY' });
      for (const budget of [{ amount: '1', currency: 'USD' }, null]) {
        const res = await setBudget(third, project.id, budget);
        expect(res.statusCode, res.body).toBe(403);
        expect(errorCode(res)).toBe('project_budget_not_allowed');
        expect(messageOf(res)).toBe(BUDGET_REFUSED);
      }
      // A project of the employee alone: the colleague is no member of it.
      const own = await open(employee, { name: 'Tek kişilik proje' });
      const hidden: [string, string, string?][] = [
        [colleague, own.id],
        [founder, project.id, ids.pillika],
        [founder, PILLIKA_PROJECT],
        [employee, randomUUID()],
        [employee, 'not-an-id'],
      ];
      for (const [session, id, company] of hidden) {
        const res = await setBudget(session, id, { amount: '1', currency: 'USD' }, company);
        expect(res.statusCode, id).toBe(404);
        expect(errorCode(res)).toBe('not_found');
      }
      const routes: [Method, string, object?][] = [
        ['PUT', `/api/projects/${project.id}/budget`, { budget: null }],
        ['POST', milestonesUrl(project.id), { id: randomUUID(), name: 'Dış kişi' }],
        ['PATCH', milestonesUrl(project.id, randomUUID()), { done: true }],
        ['DELETE', milestonesUrl(project.id, randomUUID())],
      ];
      for (const [method, url, payload] of routes) {
        const res = await call(external, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(errorCode(res), `${method} ${url}`).toBe('insiders_only');
      }
      expect(await stored(project.id)).toEqual({
        budget: '500.00',
        budget_currency: 'TRY',
        milestones: [],
      });
      expect(await stored(own.id)).toMatchObject({ budget: null });
      expect(await stored(PILLIKA_PROJECT)).toMatchObject({ budget: null });
    });

    it("GET project: a plain member's answer has budget.visible false and no amount anywhere in its body", async () => {
      const project = await staffed('Bütçesi gizli proje');
      await setBudget(founder, project.id, { amount: '7654321.09', currency: 'EUR' });
      const res = await call(third, 'GET', `/api/projects/${project.id}`);
      expect(res.statusCode, res.body).toBe(200);
      const detail = projectDetailSchema.parse(res.json());
      expect(detail.budget).toEqual({ visible: false });
      expect(detail.actions.setBudget).toBe(false);
      // The raw body, before any schema dropped a field.
      expect(res.json()).toMatchObject({ budget: { visible: false } });
      expect(Object.keys(res.json<{ budget: object }>().budget)).toEqual(['visible']);
      for (const text of ['7654321', 'EUR', 'amount', 'currency']) {
        expect(res.body, text).not.toContain(text);
      }
      // Neither does the answer of a change the member makes, nor the list.
      const changed = await call(third, 'PATCH', `/api/projects/${project.id}`, { color: 'teal' });
      expect(changed.statusCode, changed.body).toBe(200);
      const added = await call(third, 'POST', milestonesUrl(project.id), {
        id: randomUUID(),
        name: 'Üyenin adımı',
      });
      expect(added.statusCode, added.body).toBe(200);
      const list = await call(third, 'GET', '/api/projects');
      for (const body of [changed.body, added.body, list.body]) {
        expect(body).not.toContain('7654321');
      }
      // Made a manager, the same person reads it.
      await giveRole(founder, project.id, ids.newcomer, 'manager');
      expect((await read(third, project.id)).budget).toEqual({
        visible: true,
        value: { amount: '7654321.09', currency: 'EUR' },
      });
    });

    it('PUT budget: 400 for an amount of 0, three decimals, a comma, a number, an unknown currency, a missing currency and an extra field', async () => {
      const project = await staffed('Bütçesi doğrulanan proje');
      await setBudget(employee, project.id, { amount: '500', currency: 'TRY' });
      const refused: unknown[] = [
        { budget: { amount: '0', currency: 'TRY' } },
        { budget: { amount: '0.00', currency: 'TRY' } },
        { budget: { amount: '-5', currency: 'TRY' } },
        { budget: { amount: '1.234', currency: 'TRY' } },
        { budget: { amount: '1,5', currency: 'TRY' } },
        { budget: { amount: 100, currency: 'TRY' } },
        { budget: { amount: 'NaN', currency: 'TRY' } },
        { budget: { amount: '1000000000000', currency: 'TRY' } },
        { budget: { amount: '100', currency: 'GBP' } },
        { budget: { amount: '100' } },
        { budget: { currency: 'TRY' } },
        { budget: { amount: '100', currency: 'TRY', note: 'x' } },
        { budget: { amount: '100', currency: 'TRY' }, stepUp: {} },
        { budget: '100' },
        { amount: '100', currency: 'TRY' },
        {},
      ];
      for (const payload of refused) {
        const res = await call(
          employee,
          'PUT',
          `/api/projects/${project.id}/budget`,
          payload as object,
        );
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorCode(res)).toBe('invalid_request');
      }
      const empty = await call(employee, 'PUT', `/api/projects/${project.id}/budget`);
      expect(empty.statusCode).toBe(400);
      expect(await stored(project.id)).toMatchObject({ budget: '500.00', budget_currency: 'TRY' });
    });

    it('PUT budget: 403 when the role is taken while the change is on its way, 404 when the person is removed; nothing is stored', async () => {
      const project = await staffed('Bütçesi değişirken rolü alınan');
      const demoted = await whileProjectIsHeld(
        project.id,
        async (admin) => {
          await admin.query(
            `update office.project_members set role = 'member' where project_id = $1 and user_id = $2`,
            [project.id, ids.holder],
          );
        },
        () => setBudget(colleague, project.id, { amount: '10', currency: 'TRY' }),
      );
      expect(demoted.statusCode, demoted.body).toBe(403);
      expect(errorCode(demoted)).toBe('project_budget_not_allowed');
      expect(messageOf(demoted)).toBe(BUDGET_REFUSED);

      await giveRole(employee, project.id, ids.holder, 'manager');
      const removed = await whileProjectIsHeld(
        project.id,
        async (admin) => {
          await admin.query(
            'delete from office.project_members where project_id = $1 and user_id = $2',
            [project.id, ids.holder],
          );
        },
        () => setBudget(colleague, project.id, { amount: '10', currency: 'TRY' }),
      );
      expect(removed.statusCode, removed.body).toBe(404);
      expect(errorCode(removed)).toBe('not_found');
      expect(await stored(project.id)).toMatchObject({ budget: null, budget_currency: null });
    });

    it('milestones: a member adds, renames, sets and clears the day, ticks and removes; every answer is the whole project', async () => {
      const project = await staffed('Adımları olan proje');
      expect(project.milestones).toEqual([]);
      const [first, second] = [randomUUID(), randomUUID()];
      // The plain member keeps the milestones, like the other fields of the project.
      let answer = await milestone(third, 'POST', milestonesUrl(project.id), {
        id: first,
        name: '  Tasarım onayı ',
        date: '2026-11-15',
      });
      expect(answer.milestones).toEqual([
        { id: first, name: 'Tasarım onayı', date: '2026-11-15', done: false },
      ]);
      // The whole project, with what the reader may see of it.
      expect(answer).toMatchObject({
        id: project.id,
        name: 'Adımları olan proje',
        memberCount: 3,
        budget: { visible: false },
        actions: { edit: true, setBudget: false },
      });
      expect(answer.members).toHaveLength(3);
      // The founder adds one without a day; an id sent in upper case is stored in lower case.
      answer = await milestone(founder, 'POST', milestonesUrl(project.id), {
        id: second.toUpperCase(),
        name: 'Yayın',
      });
      expect(answer.milestones).toEqual([
        { id: first, name: 'Tasarım onayı', date: '2026-11-15', done: false },
        { id: second, name: 'Yayın', date: null, done: false },
      ]);
      const steps: [string, object, object][] = [
        [third, { name: 'Tasarım onayı (müşteri)' }, { name: 'Tasarım onayı (müşteri)' }],
        [colleague, { date: '2026-12-01' }, { date: '2026-12-01' }],
        [employee, { date: null }, { date: null }],
        [third, { done: true }, { done: true }],
        [
          third,
          { done: false, name: 'Son ad', date: '2027-01-31' },
          { done: false, name: 'Son ad', date: '2027-01-31' },
        ],
      ];
      let expected = {
        id: first,
        name: 'Tasarım onayı',
        date: '2026-11-15' as string | null,
        done: false,
      };
      for (const [session, change, result] of steps) {
        // The id as a link may carry it: any letter case.
        answer = await milestone(
          session,
          'PATCH',
          milestonesUrl(project.id, first.toUpperCase()),
          change,
        );
        expected = { ...expected, ...result };
        expect(answer.milestones, JSON.stringify(change)).toEqual([
          expected,
          { id: second, name: 'Yayın', date: null, done: false },
        ]);
        expect(answer.id).toBe(project.id);
      }
      answer = await milestone(third, 'DELETE', milestonesUrl(project.id, first));
      expect(answer.milestones).toEqual([{ id: second, name: 'Yayın', date: null, done: false }]);
      expect(answer).toMatchObject({ id: project.id, memberCount: 3 });
      expect((await stored(project.id)).milestones).toEqual(answer.milestones);
      // Every reader of the project reads them.
      for (const session of [employee, colleague, third, founder]) {
        expect((await read(session, project.id)).milestones).toEqual(answer.milestones);
      }
    });

    it('milestones: the same add sent twice adds one entry; the 51st is 409 milestone_limit; changing one that was removed is 409 milestone_not_found; removing one that is gone answers the page', async () => {
      const project = await staffed('Adımları dolan proje');
      const first = { id: randomUUID(), name: 'İlk adım', date: null };
      const once = await milestone(third, 'POST', milestonesUrl(project.id), first);
      // A repeated send, also with other words: nothing is added, the page is answered as it is.
      for (const body of [first, { ...first, name: 'Başka ad', date: '2026-12-01' }]) {
        const again = await milestone(third, 'POST', milestonesUrl(project.id), body);
        expect(again.milestones).toEqual(once.milestones);
      }
      expect(once.milestones).toEqual([{ ...first, done: false }]);

      // Changing and removing one that is gone.
      const gone = randomUUID();
      const change = await call(third, 'PATCH', milestonesUrl(project.id, gone), { done: true });
      expect(change.statusCode, change.body).toBe(409);
      expect(errorCode(change)).toBe('milestone_not_found');
      expect(messageOf(change)).toBe(
        'Bu kilometre taşı az önce silindi. Sayfayı yenileyip yeniden deneyin.',
      );
      const removed = await milestone(third, 'DELETE', milestonesUrl(project.id, gone));
      expect(removed.milestones).toEqual(once.milestones);

      // Filled up to 50 as an administrator would; the 51st is refused, a repeated send of one
      // that is there is still answered.
      const full = [
        { ...first, done: false },
        ...Array.from({ length: 49 }, (_, n) => ({
          id: randomUUID(),
          name: `Adım ${String(n + 2)}`,
          date: null,
          done: false,
        })),
      ];
      await adminQuery('update office.projects set milestones = $2::jsonb where id = $1', [
        project.id,
        JSON.stringify(full),
      ]);
      const over = await call(third, 'POST', milestonesUrl(project.id), {
        id: randomUUID(),
        name: 'Bir fazla',
      });
      expect(over.statusCode, over.body).toBe(409);
      expect(errorCode(over)).toBe('milestone_limit');
      expect(messageOf(over)).toBe(
        'Bir projede en çok 50 kilometre taşı olabilir. Yenisini eklemek için birini silin.',
      );
      expect((await milestone(third, 'POST', milestonesUrl(project.id), first)).milestones).toEqual(
        full,
      );
      expect((await stored(project.id)).milestones).toHaveLength(50);
      // One removed makes room for one.
      await milestone(third, 'DELETE', milestonesUrl(project.id, first.id));
      const fits = await milestone(third, 'POST', milestonesUrl(project.id), {
        id: randomUUID(),
        name: 'Yer açıldı',
      });
      expect(fits.milestones).toHaveLength(50);
    });

    it('milestones: 400 for an empty name, 121 characters, a day that does not exist and an empty change; 404 for a project of the other company and for a malformed id', async () => {
      const project = await staffed('Adımları doğrulanan proje');
      const first = randomUUID();
      await milestone(employee, 'POST', milestonesUrl(project.id), { id: first, name: 'İlk adım' });
      const badAdds: object[] = [
        { name: 'Kimliksiz' },
        { id: 'not-an-id', name: 'Adım' },
        { id: randomUUID() },
        { id: randomUUID(), name: '' },
        { id: randomUUID(), name: '   ' },
        { id: randomUUID(), name: 'x'.repeat(121) },
        { id: randomUUID(), name: 'Ad\u202eım' },
        { id: randomUUID(), name: 'Adım', date: '2026-02-30' },
        { id: randomUUID(), name: 'Adım', date: '0000-01-01' },
        { id: randomUUID(), name: 'Adım', date: '15.11.2026' },
        { id: randomUUID(), name: 'Adım', done: true },
        { id: randomUUID(), name: 'Adım', owner: ids.employee },
      ];
      for (const payload of badAdds) {
        const res = await call(employee, 'POST', milestonesUrl(project.id), payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorCode(res)).toBe('invalid_request');
      }
      const badChanges: object[] = [
        {},
        { name: '' },
        { name: 'x'.repeat(121) },
        { date: '2026-02-30' },
        { done: 'yes' },
        { done: null },
        { done: true, id: randomUUID() },
      ];
      for (const payload of badChanges) {
        const res = await call(employee, 'PATCH', milestonesUrl(project.id, first), payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorCode(res)).toBe('invalid_request');
      }
      expect((await call(employee, 'POST', milestonesUrl(project.id))).statusCode).toBe(400);
      expect((await call(employee, 'PATCH', milestonesUrl(project.id, first))).statusCode).toBe(
        400,
      );

      // A project the person cannot read answers 404 on every route, like one that is not there.
      const own = await open(employee, { name: 'Adımları gizli proje' });
      await milestone(employee, 'POST', milestonesUrl(own.id), { id: first, name: 'Gizli adım' });
      const hidden: [string, string, string?][] = [
        [colleague, own.id],
        [founder, project.id, ids.pillika],
        [founder, PILLIKA_PROJECT],
        [employee, randomUUID()],
        [employee, 'not-an-id'],
      ];
      for (const [session, id, company] of hidden) {
        const routes: [Method, string, object?][] = [
          ['POST', milestonesUrl(id), { id: randomUUID(), name: 'Ele geçirildi' }],
          ['PATCH', milestonesUrl(id, first), { done: true }],
          ['DELETE', milestonesUrl(id, first)],
        ];
        for (const [method, url, payload] of routes) {
          const res = await call(session, method, url, payload, company);
          expect(res.statusCode, `${method} ${url}`).toBe(404);
          expect(errorCode(res)).toBe('not_found');
          expect(res.body).not.toContain('Gizli adım');
        }
      }
      // A milestone id that is not an id.
      for (const method of ['PATCH', 'DELETE'] as const) {
        const res = await call(employee, method, milestonesUrl(project.id, 'not-an-id'), {
          done: true,
        });
        expect(res.statusCode, method).toBe(404);
        expect(errorCode(res)).toBe('not_found');
      }
      expect((await stored(project.id)).milestones).toEqual([
        { id: first, name: 'İlk adım', date: null, done: false },
      ]);
      expect((await stored(own.id)).milestones).toEqual([
        { id: first, name: 'Gizli adım', date: null, done: false },
      ]);
      expect((await stored(PILLIKA_PROJECT)).milestones).toEqual([]);
    });

    it('budget and milestones: every change leaves its audit row with the person as the actor', async () => {
      const project = await staffed('İzi tutulan bütçe');
      const first = randomUUID();
      await setBudget(colleague, project.id, { amount: '10', currency: 'TRY' });
      // The same value again, a refused change and a refused body write nothing.
      await setBudget(colleague, project.id, { amount: '10.00', currency: 'TRY' });
      await setBudget(third, project.id, { amount: '20', currency: 'TRY' });
      await setBudget(employee, project.id, { amount: '0', currency: 'TRY' });
      await setBudget(founder, project.id, null);
      await milestone(third, 'POST', milestonesUrl(project.id), { id: first, name: 'İlk adım' });
      // A repeated send, a change of one that is not there and a removal of one that is gone.
      await milestone(third, 'POST', milestonesUrl(project.id), { id: first, name: 'İlk adım' });
      await call(third, 'PATCH', milestonesUrl(project.id, randomUUID()), { done: true });
      await milestone(third, 'DELETE', milestonesUrl(project.id, randomUUID()));
      await milestone(employee, 'PATCH', milestonesUrl(project.id, first), { done: true });
      await milestone(founder, 'DELETE', milestonesUrl(project.id, first));
      expect(await trace(project.id)).toEqual([
        { event: 'project_budget_changed', user_id: ids.holder },
        { event: 'project_budget_changed', user_id: ids.founder },
        { event: 'project_milestones_changed', user_id: ids.newcomer },
        { event: 'project_milestones_changed', user_id: ids.employee },
        { event: 'project_milestones_changed', user_id: ids.founder },
      ]);
    });

    it('POST and PATCH /api/projects still take no budget and no milestones: each has its own route', async () => {
      const project = await staffed('Alanları ayrı proje');
      for (const extra of [
        { budget: 100 },
        { budget: { amount: '100', currency: 'TRY' } },
        { milestones: [] },
      ]) {
        const created = await call(employee, 'POST', '/api/projects', {
          id: randomUUID(),
          name: 'Bütçeyle açılan',
          ...extra,
        });
        expect(created.statusCode, JSON.stringify(extra)).toBe(400);
        const changed = await call(employee, 'PATCH', `/api/projects/${project.id}`, {
          name: 'Bütçeyle değişen',
          ...extra,
        });
        expect(changed.statusCode, JSON.stringify(extra)).toBe(400);
      }
      expect(await stored(project.id)).toEqual({
        budget: null,
        budget_currency: null,
        milestones: [],
      });
      expect((await read(employee, project.id)).name).toBe('Alanları ayrı proje');
    });
  });

  // Step 3 of the Projects section (8 October decision 17): the AI spending limit of a project.
  describe('the AI spending limit', () => {
    beforeAll(async () => {
      await adminExec(`
        insert into office.card_versions
            (id, agent_code, git_commit, content, authority_level, model)
          values ('${SPENDING_CARD}', 'KOR-1', 'abc0964', '{"card": {"status": "active"}}', 'Y2',
                   'test-model')
          on conflict do nothing;
      `);
    });

    /** A project of the employee (its owner) with a manager (holder) and a plain member (newcomer). */
    async function staffed(name: string): Promise<ProjectDetail> {
      const project = await open(employee, { name, memberIds: [ids.holder, ids.newcomer] });
      return giveRole(employee, project.id, ids.holder, 'manager');
    }

    /**
     * What the project's agents have spent: one finished run with that recorded cost, written as
     * an administrator in the run's own context (the statements of one call are one transaction,
     * so the context holds for the insert).
     */
    async function spend(projectId: string, cost: string): Promise<void> {
      if (!/^[0-9a-f-]{36}$/.test(projectId) || !/^\d+(\.\d+)?$/.test(cost)) {
        throw new Error('Unexpected value for a run of the test');
      }
      await adminExec(`
        select set_config('app.company_id', '${ids.arma}', true),
               set_config('app.user_id', '${ids.founder}', true),
               set_config('app.agent_code', 'KOR-1', true),
               set_config('app.project_id', '${projectId}', true);
        insert into office.runs
            (company_id, agent_code, card_version_id, trigger_type, model, cost_usd, status,
             finished_at)
          values ('${ids.arma}', 'KOR-1', '${SPENDING_CARD}', 'scheduled', 'test-model', ${cost},
                  'completed', now());
      `);
    }

    /** The limit, written as an administrator would (the route has its own tests). */
    const limitByHand = (projectId: string, limit: string | null) =>
      adminQuery('update office.projects set ai_spend_limit_usd = $2::numeric where id = $1', [
        projectId,
        limit,
      ]);

    const setLimit = (session: string, projectId: string, body: object, company?: string) =>
      call(session, 'PUT', `/api/projects/${projectId}/ai-spending-limit`, body, company);

    /** The founder's passkey confirms that limit (null: its removal) for that project. */
    const confirmLimit = (projectId: string, limitUsd: string | null): Promise<StepUp> =>
      signStepUp(server, founder, founderKey, {
        purpose: 'project_ai_spending_limit',
        companyId: ids.arma,
        subjectId: projectId,
        details: projectAiSpendingLimitDetails(limitUsd),
      });

    async function storedLimit(projectId: string): Promise<string | null> {
      const [row] = await adminQuery<{ limit_usd: string | null }>(
        'select ai_spend_limit_usd::text as limit_usd from office.projects where id = $1',
        [projectId],
      );
      return row?.limit_usd ?? null;
    }

    const limitTrace = (projectId: string) =>
      adminQuery<{ event: string; user_id: string | null }>(
        `select event, user_id from office.audit_log
         where record_id = $1 and event ~ '^project_ai_spending_limit_' order by id`,
        [projectId],
      );

    it('PUT ai-spending-limit: the founder sets a first limit and lowers it without a passkey', async () => {
      const project = await staffed('Sınırı konan proje');
      const jobs = server.jobs.sent.length;
      const first = await setLimit(founder, project.id, { limitUsd: '25' });
      expect(first.statusCode, first.body).toBe(200);
      // The whole project, with the limit as the database holds it.
      expect(projectDetailSchema.parse(first.json())).toMatchObject({
        id: project.id,
        name: 'Sınırı konan proje',
        memberCount: 3,
        spendingLimitReached: false,
        aiSpending: { limitUsd: '25.00', spentUsd: '0' },
        actions: { setAiSpendingLimit: true },
      });
      expect(await storedLimit(project.id)).toBe('25.00');
      // Lower, and lower again to the smallest limit there is.
      for (const [sent, kept] of [
        ['10.5', '10.50'],
        ['0.01', '0.01'],
      ] as const) {
        const lowered = await setLimit(founder, project.id, { limitUsd: sent });
        expect(lowered.statusCode, lowered.body).toBe(200);
        expect(projectDetailSchema.parse(lowered.json()).aiSpending?.limitUsd).toBe(kept);
        expect(await storedLimit(project.id)).toBe(kept);
      }
      expect(await limitTrace(project.id)).toEqual([
        { event: 'project_ai_spending_limit_set', user_id: ids.founder },
        { event: 'project_ai_spending_limit_lowered', user_id: ids.founder },
        { event: 'project_ai_spending_limit_lowered', user_id: ids.founder },
      ]);
      // A limit at or under what was spent stops the agents at once: the answer says so.
      const spent = await staffed('Sınırı harcamanın altına konan proje');
      await spend(spent.id, '4');
      const under = await setLimit(founder, spent.id, { limitUsd: '4' });
      expect(under.statusCode, under.body).toBe(200);
      expect(projectDetailSchema.parse(under.json())).toMatchObject({
        spendingLimitReached: true,
        aiSpending: { limitUsd: '4.00', spentUsd: '4.000000' },
      });
      // Every member of the project is told so too.
      expect((await read(third, spent.id)).spendingLimitReached).toBe(true);
      expect((await read(employee, spent.id)).spendingLimitReached).toBe(true);
      // Nothing was put on the queue by any of it.
      expect(server.jobs.sent).toHaveLength(jobs);
    });

    it('PUT ai-spending-limit: a raise and a removal answer 403 step_up_required without a passkey and are stored with one made for exactly that value', async () => {
      const project = await staffed('Sınırı yükseltilen proje');
      const other = await staffed('Başka projenin sınırı');
      for (const id of [project.id, other.id]) {
        expect((await setLimit(founder, id, { limitUsd: '10' })).statusCode).toBe(200);
      }
      // Without a passkey: a raise by a cent, a raise by much, a removal.
      for (const limitUsd of ['10.01', '500', null]) {
        const res = await setLimit(founder, project.id, { limitUsd });
        expect(res.statusCode, String(limitUsd)).toBe(403);
        expect(errorCode(res)).toBe('step_up_required');
      }
      // A passkey made for something else is refused: another value, the removal, another
      // project, the AI permission of this project.
      const wrong: StepUp[] = [
        await confirmLimit(project.id, '49.99'),
        await confirmLimit(project.id, null),
        await confirmLimit(other.id, '50'),
        await signStepUp(server, founder, founderKey, {
          purpose: 'project_ai_permission',
          companyId: ids.arma,
          subjectId: project.id,
          details: projectAiPermissionDetails(null),
        }),
      ];
      for (const stepUp of wrong) {
        const res = await setLimit(founder, project.id, { limitUsd: '50', stepUp });
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('step_up_failed');
      }
      expect(await storedLimit(project.id)).toBe('10.00');

      // Made for exactly this value ("50" and "50.00" are one limit): stored, and used up.
      const stepUp = await confirmLimit(project.id, '50.00');
      const raised = await setLimit(founder, project.id, { limitUsd: '50', stepUp });
      expect(raised.statusCode, raised.body).toBe(200);
      expect(projectDetailSchema.parse(raised.json()).aiSpending).toEqual({
        limitUsd: '50.00',
        spentUsd: '0',
      });
      expect(await challengeState(stepUp.challengeId)).toMatchObject({ consumed: true });
      // The same signed answer raises nothing a second time, here or in the other project.
      for (const id of [project.id, other.id]) {
        const again = await setLimit(founder, id, { limitUsd: '60', stepUp });
        expect(again.statusCode).toBe(403);
        expect(errorCode(again)).toBe('step_up_failed');
      }
      expect(await storedLimit(project.id)).toBe('50.00');
      expect(await storedLimit(other.id)).toBe('10.00');

      // The removal, with a passkey made for the removal.
      const removal = await confirmLimit(project.id, null);
      const removed = await setLimit(founder, project.id, { limitUsd: null, stepUp: removal });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(projectDetailSchema.parse(removed.json()).aiSpending?.limitUsd).toBeNull();
      expect(await storedLimit(project.id)).toBeNull();
      expect(await limitTrace(project.id)).toEqual([
        { event: 'project_ai_spending_limit_set', user_id: ids.founder },
        { event: 'project_ai_spending_limit_raised', user_id: ids.founder },
        { event: 'project_ai_spending_limit_removed', user_id: ids.founder },
      ]);
      // A first limit again needs no passkey.
      expect((await setLimit(founder, project.id, { limitUsd: '1' })).statusCode).toBe(200);
    });

    it("PUT ai-spending-limit: 403 founder_only for a member, 404 for the other company's project, 400 for 0, three decimals, a comma and an extra field; the same value again changes nothing and asks for nothing", async () => {
      const project = await staffed('Sınırı korunan proje');
      expect((await setLimit(founder, project.id, { limitUsd: '10' })).statusCode).toBe(200);
      // An employee, whatever their role in the project: its owner, a manager, a plain member,
      // and one who is no member. A lower limit, a raise and a removal alike.
      for (const session of [employee, colleague, third]) {
        for (const limitUsd of ['5', '20', null]) {
          const res = await setLimit(session, project.id, { limitUsd });
          expect(res.statusCode, String(limitUsd)).toBe(403);
          expect(errorCode(res)).toBe('founder_only');
        }
      }
      const own = await open(employee, { name: 'Tek kişilik sınır' });
      const stranger = await setLimit(colleague, own.id, { limitUsd: '5' });
      expect([stranger.statusCode, errorCode(stranger)]).toEqual([403, 'founder_only']);
      // An external person gets the section's answer.
      const outside = await setLimit(external, project.id, { limitUsd: '5' });
      expect([outside.statusCode, errorCode(outside)]).toEqual([403, 'insiders_only']);

      // The founder: the other company's project, with either company selected; an id nobody
      // has; an id that is not one.
      const hidden: [string, string?][] = [
        [project.id, ids.pillika],
        [PILLIKA_PROJECT],
        [randomUUID()],
        ['not-an-id'],
      ];
      for (const [id, company] of hidden) {
        for (const limitUsd of ['5', null]) {
          const res = await setLimit(founder, id, { limitUsd }, company);
          expect(res.statusCode, id).toBe(404);
          expect(errorCode(res)).toBe('not_found');
        }
      }
      expect(await storedLimit(PILLIKA_PROJECT)).toBeNull();

      const refused: unknown[] = [
        { limitUsd: '0' },
        { limitUsd: '0.00' },
        { limitUsd: '-5' },
        { limitUsd: '1.234' },
        { limitUsd: '25,00' },
        { limitUsd: 25 },
        { limitUsd: 'NaN' },
        { limitUsd: 'Infinity' },
        { limitUsd: '1000000' },
        { limitUsd: '25', currency: 'USD' },
        { limitUsd: '25', period: 'month' },
        { limit: '25' },
        {},
      ];
      for (const payload of refused) {
        const res = await setLimit(founder, project.id, payload as object);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorCode(res)).toBe('invalid_request');
      }
      expect(
        (await call(founder, 'PUT', `/api/projects/${project.id}/ai-spending-limit`)).statusCode,
      ).toBe(400);

      // The value the project has, however it is written: 200, nothing changes, no passkey is
      // asked for and one that was sent is not used up.
      const unused = await confirmLimit(project.id, '10');
      for (const body of [
        { limitUsd: '10' },
        { limitUsd: '10.0' },
        { limitUsd: '10.00', stepUp: unused },
      ]) {
        const same = await setLimit(founder, project.id, body);
        expect(same.statusCode, same.body).toBe(200);
        expect(projectDetailSchema.parse(same.json()).aiSpending?.limitUsd).toBe('10.00');
      }
      expect(await challengeState(unused.challengeId)).toMatchObject({ consumed: false });
      // No limit to remove: the same.
      const none = await open(founder, { name: 'Sınırsız proje' });
      const still = await setLimit(founder, none.id, { limitUsd: null });
      expect(still.statusCode, still.body).toBe(200);
      expect(await limitTrace(none.id)).toEqual([]);
      // Nothing but the first limit was ever written for the project.
      expect(await storedLimit(project.id)).toBe('10.00');
      expect(await limitTrace(project.id)).toEqual([
        { event: 'project_ai_spending_limit_set', user_id: ids.founder },
      ]);
    });

    it('PUT ai-spending-limit: 403 step_up_required when the limit was lowered while a lowering was on its way', async () => {
      const project = await staffed('Sınırı aynı anda düşürülen proje');
      expect((await setLimit(founder, project.id, { limitUsd: '10' })).statusCode).toBe(200);
      // Somebody else lowers the limit to 2 behind a lock on the project row; the founder's
      // lowering to 5 read the limit as 10, waits for the row and is then a raise from 2.
      const admin = await adminPool.connect();
      let pending: Promise<LightMyRequestResponse>;
      try {
        await admin.query('begin');
        await admin.query('update office.projects set ai_spend_limit_usd = 2 where id = $1', [
          project.id,
        ]);
        pending = setLimit(founder, project.id, { limitUsd: '5' });
        await untilServerWaits();
        await admin.query('commit');
      } catch (error) {
        await admin.query('rollback');
        throw error;
      } finally {
        admin.release();
      }
      const res = await pending;
      expect(res.statusCode, res.body).toBe(403);
      expect(errorCode(res)).toBe('step_up_required');
      expect(await storedLimit(project.id)).toBe('2.00');
    });

    it('GET project: the founder reads the limit and what was spent; a member reads only whether the limit is reached, and no amount is in the body', async () => {
      const project = await staffed('Harcaması olan proje');
      // No limit and no run: the founder reads that, a member no figure at all.
      expect(await read(founder, project.id)).toMatchObject({
        spendingLimitReached: false,
        aiSpending: { limitUsd: null, spentUsd: '0' },
        actions: { setAiSpendingLimit: true },
      });
      await spend(project.id, '1.674690');
      await spend(project.id, '0.325310');
      await limitByHand(project.id, '50');
      expect(await read(founder, project.id)).toMatchObject({
        spendingLimitReached: false,
        aiSpending: { limitUsd: '50.00', spentUsd: '2.000000' },
      });
      // Reached at the limit, and above it.
      for (const limit of ['2.00', '1.50']) {
        await limitByHand(project.id, limit);
        expect(await read(founder, project.id)).toMatchObject({
          spendingLimitReached: true,
          aiSpending: { limitUsd: limit, spentUsd: '2.000000' },
        });
        // The owner, a manager and a plain member: the flag, and nothing else of it.
        for (const session of [employee, colleague, third]) {
          const res = await call(session, 'GET', `/api/projects/${project.id}`);
          expect(res.statusCode, res.body).toBe(200);
          const detail = projectDetailSchema.parse(res.json());
          expect(detail.spendingLimitReached).toBe(true);
          expect(detail.aiSpending).toBeNull();
          expect(detail.actions.setAiSpendingLimit).toBe(false);
          // The raw body, before any schema dropped a field.
          expect(res.json<{ aiSpending: unknown }>().aiSpending).toBeNull();
          for (const text of ['2.000000', '1.674690', 'limitUsd', 'spentUsd', `"${limit}"`]) {
            expect(res.body, text).not.toContain(text);
          }
        }
      }
      // The answer of a change a member makes carries no figure either.
      const changed = await call(third, 'PATCH', `/api/projects/${project.id}`, { color: 'teal' });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.body).not.toContain('2.000000');
      expect(changed.body).not.toContain('limitUsd');
      // Under the limit again: every reader is told so.
      await limitByHand(project.id, '2.01');
      for (const session of [founder, employee, third]) {
        expect((await read(session, project.id)).spendingLimitReached).toBe(false);
      }
      await limitByHand(project.id, null);
      expect(await read(founder, project.id)).toMatchObject({
        spendingLimitReached: false,
        aiSpending: { limitUsd: null, spentUsd: '2.000000' },
      });
    });

    it('GET projects: spendingLimitReached on every row', async () => {
      const atLimit = await staffed('Sınırı dolan proje');
      const under = await staffed('Sınırı dolmayan proje');
      const none = await staffed('Sınırı olmayan proje');
      for (const project of [atLimit, under, none]) {
        await spend(project.id, '3');
      }
      await limitByHand(atLimit.id, '3');
      await limitByHand(under.id, '3.01');
      for (const session of [founder, employee, third]) {
        const res = await call(session, 'GET', '/api/projects');
        expect(res.statusCode, res.body).toBe(200);
        const { projects } = projectListSchema.parse(res.json());
        const flags = new Map(projects.map((row) => [row.id, row.spendingLimitReached]));
        expect([flags.get(atLimit.id), flags.get(under.id), flags.get(none.id)]).toEqual([
          true,
          false,
          false,
        ]);
        // Every row carries the flag, and no row an amount.
        for (const row of res.json<{ projects: Record<string, unknown>[] }>().projects) {
          expect(typeof row.spendingLimitReached).toBe('boolean');
          expect(Object.keys(row)).not.toContain('aiSpending');
        }
        expect(res.body).not.toContain('3.000000');
        expect(res.body).not.toContain('limitUsd');
      }
      // The limit is not the AI permission: the two words are told apart.
      const row = projectListSchema
        .parse((await call(founder, 'GET', '/api/projects')).json())
        .projects.find((candidate) => candidate.id === atLimit.id);
      expect(row).toMatchObject({
        aiAllowed: false,
        agentsMayWork: false,
        spendingLimitReached: true,
      });
    });
  });
});
