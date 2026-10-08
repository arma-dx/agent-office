import { randomUUID } from 'node:crypto';
import {
  customerListSchema,
  customerPermissionDetails,
  projectDetailSchema,
  projectListSchema,
  projectMemberCandidatesSchema,
  type ProjectDetail,
} from '@agent-office/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { errorCode, freshPasskey, send, signStepUp, type Method } from './passkey-helpers.ts';

// The Projects section through the API (8 October decisions 14 to 22): the list, a new project
// with its customer and members, the project page and its edit. Tests commit, so each uses ids
// and names of its own; a project is never deleted, so what a test opens stays in the database.

// Records of the other company, a customer of Arma DX and a deactivated employee of it, written
// as an administrator would (no person in the context).
const PILLIKA_CUSTOMER = '00000000-0000-4000-8000-000000000951';
const PILLIKA_PROJECT = '00000000-0000-4000-8000-000000000952';
const ARMA_CUSTOMER = '00000000-0000-4000-8000-000000000953';
const DEACTIVATED = '00000000-0000-4000-8000-000000000954';

describe.skipIf(noDatabase)('projects', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let colleague: string;
  let external: string;
  const founderKey = new SoftwareAuthenticator(PANEL_ORIGIN);

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
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

  afterAll(async () => {
    await server.close();
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

  // List, create, read ---------------------------------------------------------------------------

  it('opens a project for an employee: 201, planned, the opener is its only member, the AI permission is closed', async () => {
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
      members: [{ userId: ids.employee, name: 'Çalışan', role: 'employee', active: true }],
    });
    expect(
      await adminQuery(
        'select ai_allowed, created_by_user_id, company_id from office.projects where id = $1',
        [id],
      ),
    ).toEqual([{ ai_allowed: false, created_by_user_id: ids.employee, company_id: ids.arma }]);
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
      ['GET', '/api/customers'],
    ];
    for (const [method, url, payload] of routes) {
      const res = await call(external, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorCode(res), `${method} ${url}`).toBe('insiders_only');
    }
    expect(await read(employee, project.id)).toMatchObject({ name: 'Proje', memberCount: 1 });
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
    });
    // A member id that is not an id.
    for (const method of ['PUT', 'DELETE'] as const) {
      const res = await call(employee, method, `/api/projects/${project.id}/members/not-an-id`);
      expect(res.statusCode).toBe(404);
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
        manageMembers: true,
        setAiPermission: false,
        setCustomerPermissions: false,
      },
    });
    expect([...forEmployee.members].sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: ids.employee, name: 'Çalışan', role: 'employee', active: true },
      { userId: ids.holder, name: 'Passkey Sahibi', role: 'employee', active: true },
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
      manageMembers: true,
      setAiPermission: true,
      setCustomerPermissions: true,
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

  // Members ---------------------------------------------------------------------------------------

  it('a member adds and removes a colleague without a passkey; adding twice changes nothing; removing somebody who is not a member is 404', async () => {
    const project = await open(employee, { name: 'Üyeleri değişen proje' });
    const members = `/api/projects/${project.id}/members`;
    const added = await call(employee, 'PUT', `${members}/${ids.holder}`);
    expect(added.statusCode, added.body).toBe(200);
    expect(projectDetailSchema.parse(added.json())).toMatchObject({ memberCount: 2 });
    // The new member reads the project and adds the founder, also with the id in capitals.
    expect((await read(colleague, project.id)).memberCount).toBe(2);
    const byColleague = await call(colleague, 'PUT', `${members}/${ids.founder.toUpperCase()}`);
    expect(projectDetailSchema.parse(byColleague.json()).memberCount).toBe(3);

    const twice = await call(employee, 'PUT', `${members}/${ids.holder}`);
    expect(twice.statusCode).toBe(200);
    expect(projectDetailSchema.parse(twice.json()).memberCount).toBe(3);
    expect(
      await count('audit_log', `event = 'project_member_added' and project_id = $1`, [project.id]),
    ).toBe(3);

    // A member removes another member, the opener too.
    const removed = await call(colleague, 'DELETE', `${members}/${ids.employee}`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      projectDetailSchema
        .parse(removed.json())
        .members.map((member) => member.userId)
        .sort(),
    ).toEqual([ids.founder, ids.holder].sort());
    // The removed person no longer reads it.
    expect((await call(employee, 'GET', `/api/projects/${project.id}`)).statusCode).toBe(404);

    for (const userId of [ids.employee, ids.newcomer, randomUUID()]) {
      const res = await call(colleague, 'DELETE', `${members}/${userId}`);
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('not_found');
    }
    expect((await read(colleague, project.id)).memberCount).toBe(2);
  });

  it('409 own_project_membership when an employee removes themselves; the founder removes themselves and still reads the project', async () => {
    const project = await open(employee, { name: 'Kendini çıkaran', memberIds: [ids.founder] });
    const members = `/api/projects/${project.id}/members`;
    for (const userId of [ids.employee, ids.employee.toUpperCase()]) {
      const own = await call(employee, 'DELETE', `${members}/${userId}`);
      expect(own.statusCode).toBe(409);
      expect(errorCode(own)).toBe('own_project_membership');
    }
    expect((await read(employee, project.id)).memberCount).toBe(2);

    const byFounder = await call(founder, 'DELETE', `${members}/${ids.founder}`);
    expect(byFounder.statusCode, byFounder.body).toBe(200);
    expect(projectDetailSchema.parse(byFounder.json())).toMatchObject({
      memberCount: 1,
      members: [{ userId: ids.employee }],
    });
    // The founder removes the last member too; the project stays, read by the founder alone.
    const last = await call(founder, 'DELETE', `${members}/${ids.employee}`);
    expect(projectDetailSchema.parse(last.json())).toMatchObject({ memberCount: 0, members: [] });
    expect((await call(employee, 'GET', `/api/projects/${project.id}`)).statusCode).toBe(404);
    expect((await read(founder, project.id)).name).toBe('Kendini çıkaran');
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
});
