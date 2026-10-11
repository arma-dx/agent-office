import { describe, expect, it } from 'vitest';
import {
  apiErrorCodeSchema,
  customerPermissionDetails,
  customerPermissionDetailsSchema,
  projectAiPermissionDetails,
  projectAiPermissionDetailsSchema,
  stepUpOptionsRequestSchema,
} from '../src/api.ts';
import {
  CLOSED_PROJECT_STATUSES,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_ICON,
  DEFAULT_PROJECT_STATUS,
  PROJECT_COLORS,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_ICONS,
  PROJECT_MEMBER_MAX,
  PROJECT_NAME_MAX,
  PROJECT_STATUSES,
  BUDGET_CURRENCIES,
  MILESTONE_MAX,
  MILESTONE_NAME_MAX,
  budgetAmountSchema,
  createMilestoneSchema,
  createProjectSchema,
  customerPermissionsAnswerSchema,
  customerPermissionsSchema,
  isClosedProjectStatus,
  mayAddProjectMembers,
  memberRemoval,
  memberRoleChanges,
  milestoneSchema,
  projectAiPermissionAnswerSchema,
  projectAiPermissionSchema,
  projectBudgetSchema,
  projectDetailSchema,
  projectMemberRoleSchema,
  projectMemberSchema,
  projectSummarySchema,
  setProjectBudgetSchema,
  setProjectMemberRoleSchema,
  sortedMilestones,
  spendingState,
  SPENDING_WARN_SHARE,
  updateMilestoneSchema,
  updateProjectSchema,
  type MemberRemoval,
  type Milestone,
  type ProjectActor,
  type ProjectMemberRole,
} from '../src/projects.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STEP_UP = {
  challengeId: uuid(90),
  response: {
    id: 'abc',
    rawId: 'abc',
    type: 'public-key',
    response: { clientDataJSON: 'abc', authenticatorData: 'abc', signature: 'abc' },
  },
};

describe('the contracts of the Projects section', () => {
  it('project contracts: the fixed sets', () => {
    expect(PROJECT_STATUSES).toEqual([
      'backlog',
      'planned',
      'in_progress',
      'completed',
      'cancelled',
    ]);
    expect(PROJECT_COLORS).toEqual([
      'gray',
      'red',
      'orange',
      'green',
      'teal',
      'blue',
      'purple',
      'pink',
    ]);
    expect(PROJECT_ICONS).toEqual([
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
    expect(DEFAULT_PROJECT_STATUS).toBe('planned');
    expect(DEFAULT_PROJECT_COLOR).toBe('gray');
    expect(DEFAULT_PROJECT_ICON).toBe('folder');
  });

  it('isClosedProjectStatus: completed and cancelled', () => {
    expect(CLOSED_PROJECT_STATUSES).toEqual(['completed', 'cancelled']);
    expect(PROJECT_STATUSES.filter(isClosedProjectStatus)).toEqual(['completed', 'cancelled']);
  });

  it('createProjectSchema: defaults, a trimmed name; refuses an empty or too long name, hidden characters, a description over the limit or with NUL, more than 50 members, a date that is not a day, an unknown key', () => {
    expect(createProjectSchema.parse({ id: uuid(1), name: '  Yeni site  ' })).toEqual({
      id: uuid(1),
      name: 'Yeni site',
      description: '',
      customer: { kind: 'none' },
      memberIds: [],
      status: 'planned',
      color: 'gray',
      icon: 'folder',
      targetDate: null,
    });
    const full = {
      id: uuid(1),
      name: 'x'.repeat(PROJECT_NAME_MAX),
      description: `İlk satır\n${'x'.repeat(PROJECT_DESCRIPTION_MAX - 10)}`,
      customer: { kind: 'existing', customerId: uuid(2) },
      memberIds: Array.from({ length: PROJECT_MEMBER_MAX }, (_, n) => uuid(100 + n)),
      status: 'backlog',
      color: 'pink',
      icon: 'box',
      targetDate: '2026-12-31',
    };
    expect(createProjectSchema.safeParse(full).success).toBe(true);
    // A new customer starts with both permissions closed unless they are marked.
    expect(
      createProjectSchema.parse({
        ...full,
        customer: { kind: 'new', id: uuid(3), name: ' Beta ' },
      }).customer,
    ).toEqual({
      kind: 'new',
      id: uuid(3),
      name: 'Beta',
      aiAllowed: false,
      automatedProcessingAllowed: false,
    });
    const refused: Record<string, unknown>[] = [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(PROJECT_NAME_MAX + 1) },
      { name: 'Gizli‮harf' },
      { name: 'İki\nsatır' },
      { description: 'x'.repeat(PROJECT_DESCRIPTION_MAX + 1) },
      { description: 'NUL\u0000' },
      { memberIds: Array.from({ length: PROJECT_MEMBER_MAX + 1 }, (_, n) => uuid(100 + n)) },
      { memberIds: ['not-a-uuid'] },
      { targetDate: '2026-12-31T10:00:00Z' },
      { targetDate: '31.12.2026' },
      { targetDate: '2026-02-30' },
      // A day PostgreSQL's date cannot hold: its first year is 0001.
      { targetDate: '0000-01-01' },
      { targetDate: '0000-12-31' },
      { status: 'open' },
      { color: 'grey' },
      { icon: 'rocket' },
      { id: 'not-a-uuid' },
      { customer: { kind: 'existing' } },
      { customer: { kind: 'new', id: uuid(3), name: '' } },
      { customer: { kind: 'new', id: uuid(3), name: 'x'.repeat(121) } },
      { customer: { kind: 'new', name: 'Beta' } },
      { customer: { kind: 'none', customerId: uuid(2) } },
      { budget: 10 },
      { closed: true },
      { createdBy: uuid(5) },
    ];
    for (const change of refused) {
      expect(
        createProjectSchema.safeParse({ ...full, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });

  it('createProjectSchema: there is no field for the AI permission of the project', () => {
    const body = { id: uuid(1), name: 'Yeni site' };
    expect(createProjectSchema.safeParse(body).success).toBe(true);
    for (const field of ['aiAllowed', 'ai_allowed', 'agentsMayWork']) {
      expect(createProjectSchema.safeParse({ ...body, [field]: true }).success, field).toBe(false);
      expect(createProjectSchema.safeParse({ ...body, [field]: false }).success, field).toBe(false);
    }
  });

  it('updateProjectSchema: needs one field; null clears the target date; a new customer carries no permission', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    expect(updateProjectSchema.parse({ targetDate: null })).toEqual({ targetDate: null });
    // The first and the last day the contract takes; year 0000 is no day of the database.
    for (const targetDate of ['0001-01-01', '9999-12-31']) {
      expect(updateProjectSchema.parse({ targetDate })).toEqual({ targetDate });
    }
    for (const targetDate of ['0000-01-01', '0000-12-31', '2026-02-30']) {
      expect(updateProjectSchema.safeParse({ targetDate }).success, targetDate).toBe(false);
    }
    expect(updateProjectSchema.parse({ description: '' })).toEqual({ description: '' });
    expect(updateProjectSchema.parse({ name: ' Ad ' })).toEqual({ name: 'Ad' });
    expect(
      updateProjectSchema.safeParse({ customer: { kind: 'new', id: uuid(3), name: 'Beta' } })
        .success,
    ).toBe(true);
    for (const permission of ['aiAllowed', 'automatedProcessingAllowed']) {
      expect(
        updateProjectSchema.safeParse({
          customer: { kind: 'new', id: uuid(3), name: 'Beta', [permission]: true },
        }).success,
        permission,
      ).toBe(false);
    }
    // No AI permission, no member list and no passkey on an edit.
    for (const field of ['aiAllowed', 'memberIds', 'stepUp', 'id']) {
      expect(updateProjectSchema.safeParse({ name: 'Ad', [field]: null }).success, field).toBe(
        false,
      );
    }
  });

  it('projectAiPermissionSchema: opening names the customer the founder saw; closing carries nothing', () => {
    expect(projectAiPermissionSchema.safeParse({ allowed: true, customerId: null }).success).toBe(
      true,
    );
    expect(
      projectAiPermissionSchema.safeParse({ allowed: true, customerId: uuid(2), stepUp: STEP_UP })
        .success,
    ).toBe(true);
    // Without the customer the opening is not complete: "no customer" is said with null.
    expect(projectAiPermissionSchema.safeParse({ allowed: true }).success).toBe(false);
    expect(projectAiPermissionSchema.safeParse({ allowed: true, customerId: 'x' }).success).toBe(
      false,
    );
    expect(projectAiPermissionSchema.safeParse({ allowed: false }).success).toBe(true);
    expect(projectAiPermissionSchema.safeParse({ allowed: false, customerId: null }).success).toBe(
      false,
    );
    expect(projectAiPermissionSchema.safeParse({}).success).toBe(false);
  });

  it('customerPermissionsSchema: needs one of the two permissions', () => {
    expect(customerPermissionsSchema.safeParse({}).success).toBe(false);
    expect(customerPermissionsSchema.safeParse({ stepUp: STEP_UP }).success).toBe(false);
    expect(customerPermissionsSchema.safeParse({ aiAllowed: false }).success).toBe(true);
    expect(customerPermissionsSchema.safeParse({ automatedProcessingAllowed: true }).success).toBe(
      true,
    );
    expect(customerPermissionsSchema.safeParse({ aiAllowed: true, stepUp: STEP_UP }).success).toBe(
      true,
    );
    expect(customerPermissionsSchema.safeParse({ aiAllowed: true, name: 'Yeni ad' }).success).toBe(
      false,
    );
  });

  it('details: projectAiPermissionDetails and customerPermissionDetails build what their schemas accept, and nothing optional when it was not given', () => {
    expect(projectAiPermissionDetails(null)).toEqual({ action: 'open', customerId: null });
    expect(projectAiPermissionDetails(uuid(2))).toEqual({ action: 'open', customerId: uuid(2) });
    expect(
      projectAiPermissionDetailsSchema.safeParse(projectAiPermissionDetails(null)).success,
    ).toBe(true);
    // The customer is part of what is confirmed: it cannot be left out.
    expect(projectAiPermissionDetailsSchema.safeParse({ action: 'open' }).success).toBe(false);
    expect(
      projectAiPermissionDetailsSchema.safeParse({ action: 'close', customerId: null }).success,
    ).toBe(false);

    const created = customerPermissionDetails({ name: 'Beta', automatedProcessingAllowed: false });
    expect(created).toEqual({
      action: 'create',
      name: 'Beta',
      aiAllowed: true,
      automatedProcessingAllowed: false,
    });
    expect(customerPermissionDetailsSchema.safeParse(created).success).toBe(true);
    const updated = customerPermissionDetails({});
    expect(updated).toEqual({ action: 'update', aiAllowed: true });
    expect(Object.keys(updated)).toEqual(['action', 'aiAllowed']);
    expect(customerPermissionDetails({ automatedProcessingAllowed: true })).toEqual({
      action: 'update',
      aiAllowed: true,
      automatedProcessingAllowed: true,
    });
    expect(customerPermissionDetailsSchema.safeParse(updated).success).toBe(true);
    // A re-verification is never for closing the permission.
    expect(
      customerPermissionDetailsSchema.safeParse({ action: 'update', aiAllowed: false }).success,
    ).toBe(false);
  });

  it('step-up options: the two new purposes need a company, a subject and their own details', () => {
    const project = {
      purpose: 'project_ai_permission',
      companyId: uuid(1),
      subjectId: uuid(2),
      details: projectAiPermissionDetails(uuid(3)),
    };
    const customer = {
      purpose: 'customer_ai_permission',
      companyId: uuid(1),
      subjectId: uuid(2),
      details: customerPermissionDetails({ name: 'Beta', automatedProcessingAllowed: true }),
    };
    expect(stepUpOptionsRequestSchema.safeParse(project).success).toBe(true);
    expect(stepUpOptionsRequestSchema.safeParse(customer).success).toBe(true);
    expect(
      stepUpOptionsRequestSchema.safeParse({ ...customer, details: customerPermissionDetails({}) })
        .success,
    ).toBe(true);
    for (const body of [project, customer]) {
      for (const missing of ['companyId', 'subjectId', 'details']) {
        const incomplete = Object.fromEntries(
          Object.entries(body).filter(([key]) => key !== missing),
        );
        expect(stepUpOptionsRequestSchema.safeParse(incomplete).success, missing).toBe(false);
      }
      // The details of another purpose.
      expect(
        stepUpOptionsRequestSchema.safeParse({ ...body, details: { action: 'remove' } }).success,
      ).toBe(false);
    }
    expect(
      stepUpOptionsRequestSchema.safeParse({ ...project, details: customer.details }).success,
    ).toBe(false);
    expect(
      stepUpOptionsRequestSchema.safeParse({ ...customer, details: project.details }).success,
    ).toBe(false);
    // The project's customer is part of the details.
    expect(
      stepUpOptionsRequestSchema.safeParse({ ...project, details: { action: 'open' } }).success,
    ).toBe(false);
  });

  it('projectDetailSchema: one answer for the page, with the customer permissions a reader may see', () => {
    const detail = {
      id: uuid(1),
      name: 'Yeni site',
      status: 'in_progress',
      closed: false,
      color: 'teal',
      icon: 'code',
      targetDate: '2026-12-31',
      aiAllowed: true,
      agentsMayWork: false,
      spendingLimitReached: false,
      customer: { id: uuid(2), name: 'Beta', aiAllowed: false, automatedProcessingAllowed: null },
      memberCount: 1,
      description: null,
      createdAt: '2026-10-08T09:00:00.000Z',
      createdBy: null,
      members: [
        {
          userId: uuid(3),
          name: 'Ada Yılmaz',
          role: 'employee',
          active: true,
          projectRole: 'owner',
          removable: false,
          roleChanges: [],
        },
      ],
      budget: { visible: false },
      milestones: [],
      aiSpending: null,
      actions: {
        edit: true,
        addMembers: true,
        setBudget: false,
        setAiPermission: false,
        setCustomerPermissions: false,
        setAiSpendingLimit: false,
      },
    };
    expect(projectDetailSchema.parse(detail)).toEqual(detail);
    expect(projectDetailSchema.safeParse({ ...detail, status: 'open' }).success).toBe(false);
    expect(
      projectDetailSchema.safeParse({ ...detail, customer: { id: uuid(2), name: 'Beta' } }).success,
    ).toBe(false);

    // 8 October decision 49: the answer of a permission route also says how many waiting
    // requests this very request started again.
    expect(projectAiPermissionAnswerSchema.parse({ ...detail, restarted: 2 })).toEqual({
      ...detail,
      restarted: 2,
    });
    const customer = {
      id: uuid(2),
      name: 'Beta',
      aiAllowed: true,
      automatedProcessingAllowed: false,
    };
    expect(customerPermissionsAnswerSchema.parse({ ...customer, restarted: 0 })).toEqual({
      ...customer,
      restarted: 0,
    });
    for (const [schema, answer] of [
      [projectAiPermissionAnswerSchema, detail],
      [customerPermissionsAnswerSchema, customer],
    ] as const) {
      // The count is the server's word: never left out, never a guess.
      expect(schema.safeParse(answer).success).toBe(false);
      for (const restarted of [-1, 1.5, '2', null]) {
        expect(schema.safeParse({ ...answer, restarted }).success, String(restarted)).toBe(false);
      }
    }
  });
});

// 8 October decision 44: a member does not remove a member; the owner and the managers do. The
// database's row policies are the rule; these functions ask the same rule for the answer's flags.
describe('the owner, the managers and the members of a project', () => {
  const ME = uuid(10);
  const OTHER = uuid(11);
  const founder: ProjectActor = { userId: ME, founder: true, projectRole: null };
  const owner: ProjectActor = { userId: ME, founder: false, projectRole: 'owner' };
  const manager: ProjectActor = { userId: ME, founder: false, projectRole: 'manager' };
  const member: ProjectActor = { userId: ME, founder: false, projectRole: 'member' };
  const outsider: ProjectActor = { userId: ME, founder: false, projectRole: null };
  const ROLES: ProjectMemberRole[] = ['owner', 'manager', 'member'];

  it('who adds: the founder, the owner and a manager; a plain member and a person who is no member do not', () => {
    expect(mayAddProjectMembers(founder)).toBe(true);
    expect(mayAddProjectMembers(owner)).toBe(true);
    expect(mayAddProjectMembers(manager)).toBe(true);
    expect(mayAddProjectMembers(member)).toBe(false);
    expect(mayAddProjectMembers(outsider)).toBe(false);
    // The founder adds whatever their own role in the project is.
    for (const projectRole of ROLES) {
      expect(mayAddProjectMembers({ ...founder, projectRole })).toBe(true);
    }
  });

  it('who removes whom: every pair of actor and target', () => {
    // Rows: the actor. Columns: another person who is the owner, a manager, a plain member.
    const others: [string, ProjectActor, [MemberRemoval, MemberRemoval, MemberRemoval]][] = [
      ['founder, no member', founder, ['owner', 'ok', 'ok']],
      ['founder, a member', { ...founder, projectRole: 'member' }, ['owner', 'ok', 'ok']],
      ['founder, a manager', { ...founder, projectRole: 'manager' }, ['owner', 'ok', 'ok']],
      ['owner', owner, ['owner', 'ok', 'ok']],
      ['manager', manager, ['owner', 'manager_protected', 'ok']],
      ['member', member, ['not_allowed', 'not_allowed', 'not_allowed']],
      ['no member', outsider, ['not_allowed', 'not_allowed', 'not_allowed']],
    ];
    for (const [name, actor, answers] of others) {
      ROLES.forEach((projectRole, index) => {
        expect(
          memberRemoval(actor, { userId: OTHER, projectRole }),
          `${name}: ${projectRole}`,
        ).toBe(answers[index]);
      });
    }
    // Themselves: an employee never, whatever their role; the founder unless the founder owns it.
    for (const actor of [owner, manager, member]) {
      expect(
        memberRemoval(actor, { userId: ME, projectRole: actor.projectRole ?? 'member' }),
        actor.projectRole ?? '',
      ).toBe('self');
    }
    expect(
      memberRemoval({ ...founder, projectRole: 'member' }, { userId: ME, projectRole: 'member' }),
    ).toBe('ok');
    expect(
      memberRemoval({ ...founder, projectRole: 'manager' }, { userId: ME, projectRole: 'manager' }),
    ).toBe('ok');
    expect(
      memberRemoval({ ...founder, projectRole: 'owner' }, { userId: ME, projectRole: 'owner' }),
    ).toBe('owner');
  });

  it('who gives which role: only the owner and the founder; never to the owner; a deactivated member is only dismissed', () => {
    for (const actor of [founder, { ...founder, projectRole: 'member' as const }, owner]) {
      expect(memberRoleChanges(actor, { projectRole: 'member', active: true })).toEqual([
        'manager',
        'owner',
      ]);
      expect(memberRoleChanges(actor, { projectRole: 'manager', active: true })).toEqual([
        'member',
        'owner',
      ]);
      // The owner's own role is not changed directly: the ownership is handed over.
      expect(memberRoleChanges(actor, { projectRole: 'owner', active: true })).toEqual([]);
      expect(memberRoleChanges(actor, { projectRole: 'owner', active: false })).toEqual([]);
      // A deactivated account is given no role; a deactivated manager can be dismissed.
      expect(memberRoleChanges(actor, { projectRole: 'member', active: false })).toEqual([]);
      expect(memberRoleChanges(actor, { projectRole: 'manager', active: false })).toEqual([
        'member',
      ]);
    }
    for (const actor of [manager, member, outsider]) {
      for (const projectRole of ROLES) {
        for (const active of [true, false]) {
          expect(
            memberRoleChanges(actor, { projectRole, active }),
            `${actor.projectRole ?? 'none'}: ${projectRole}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('a member of the answer carries its project role, whether it is removable and the roles it may be given; actions carry addMembers', () => {
    const person = {
      userId: uuid(3),
      name: 'Ada Yılmaz',
      role: 'employee',
      active: true,
      projectRole: 'manager',
      removable: true,
      roleChanges: ['member', 'owner'],
    };
    expect(projectMemberSchema.parse(person)).toEqual(person);
    for (const field of ['projectRole', 'removable', 'roleChanges'] as const) {
      const without = Object.fromEntries(Object.entries(person).filter(([name]) => name !== field));
      expect(projectMemberSchema.safeParse(without).success, field).toBe(false);
    }
    expect(projectMemberSchema.safeParse({ ...person, projectRole: 'admin' }).success).toBe(false);
    expect(projectMemberSchema.safeParse({ ...person, roleChanges: ['admin'] }).success).toBe(
      false,
    );
    expect(projectMemberRoleSchema.options).toEqual(['owner', 'manager', 'member']);

    const detail = {
      id: uuid(1),
      name: 'Yeni site',
      status: 'planned',
      closed: false,
      color: 'gray',
      icon: 'folder',
      targetDate: null,
      aiAllowed: false,
      agentsMayWork: false,
      spendingLimitReached: false,
      customer: null,
      memberCount: 1,
      description: null,
      createdAt: '2026-10-08T09:00:00.000Z',
      createdBy: null,
      members: [person],
      budget: { visible: false },
      milestones: [],
      aiSpending: null,
    };
    const actions = {
      edit: true,
      setBudget: false,
      setAiPermission: false,
      setCustomerPermissions: false,
      setAiSpendingLimit: false,
    };
    expect(
      projectDetailSchema.safeParse({ ...detail, actions: { ...actions, addMembers: false } })
        .success,
    ).toBe(true);
    // The flag of the old rule ("every member manages members") is not the answer any more.
    expect(
      projectDetailSchema.safeParse({ ...detail, actions: { ...actions, manageMembers: true } })
        .success,
    ).toBe(false);
    // The codes of the refusals are part of the contract.
    for (const code of [
      'project_members_not_allowed',
      'project_manager_protected',
      'project_owner_fixed',
      'project_roles_not_allowed',
      'project_members_changed',
    ]) {
      expect(apiErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('the role body takes one of the three roles and nothing else', () => {
    for (const role of ROLES) {
      expect(setProjectMemberRoleSchema.parse({ role })).toEqual({ role });
    }
    for (const body of [
      {},
      { role: 'admin' },
      { role: 'Owner' },
      { role: null },
      { role: ['owner'] },
      { role: 'manager', userId: uuid(3) },
      { role: 'manager', projectRole: 'owner' },
    ]) {
      expect(setProjectMemberRoleSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

// Step 3 of the Projects section (8 October decision 17): the budget and the milestones of a
// project. The database holds the same shapes (projects_budget_shape, office.milestones_valid).
describe('the budget and the milestones of a project', () => {
  const DETAIL = {
    id: uuid(1),
    name: 'Yeni site',
    status: 'planned',
    closed: false,
    color: 'gray',
    icon: 'folder',
    targetDate: null,
    aiAllowed: false,
    agentsMayWork: false,
    spendingLimitReached: false,
    customer: null,
    memberCount: 0,
    description: null,
    createdAt: '2026-10-08T09:00:00.000Z',
    createdBy: null,
    members: [],
    budget: { visible: false },
    milestones: [],
    aiSpending: null,
    actions: {
      edit: true,
      addMembers: false,
      setBudget: false,
      setAiPermission: false,
      setCustomerPermissions: false,
      setAiSpendingLimit: false,
    },
  };

  it('a budget is an amount above zero with at most two decimals and one of three currencies', () => {
    expect(BUDGET_CURRENCIES).toEqual(['TRY', 'USD', 'EUR']);
    for (const amount of [
      '1',
      '0.5',
      '0.01',
      '125000.50',
      '10',
      '999999999999',
      '999999999999.99',
    ]) {
      expect(budgetAmountSchema.parse(amount), amount).toBe(amount);
      for (const currency of BUDGET_CURRENCIES) {
        expect(projectBudgetSchema.parse({ amount, currency })).toEqual({ amount, currency });
      }
    }
    for (const amount of [
      '0',
      '0.0',
      '0.00',
      '-1',
      '+1',
      '1.234',
      '1,5',
      '1.',
      '.5',
      '01',
      '1e3',
      ' 1',
      '1 ',
      '',
      'NaN',
      'Infinity',
      // Thirteen digits before the dot.
      '1000000000000',
      1,
      1.5,
      null,
    ]) {
      expect(budgetAmountSchema.safeParse(amount).success, String(amount)).toBe(false);
    }
    for (const budget of [
      { amount: '10' },
      { currency: 'TRY' },
      { amount: '10', currency: 'GBP' },
      { amount: '10', currency: 'try' },
      { amount: '10', currency: null },
      { amount: 10, currency: 'TRY' },
      { amount: '10', currency: 'TRY', rate: '1' },
    ]) {
      expect(projectBudgetSchema.safeParse(budget).success, JSON.stringify(budget)).toBe(false);
    }
  });

  it('the budget body takes a budget or null and nothing else', () => {
    const budget = { amount: '150000.00', currency: 'TRY' };
    expect(setProjectBudgetSchema.parse({ budget })).toEqual({ budget });
    expect(setProjectBudgetSchema.parse({ budget: null })).toEqual({ budget: null });
    for (const body of [
      {},
      budget,
      { budget: '150000.00' },
      { budget: { amount: '0', currency: 'TRY' } },
      { budget, stepUp: STEP_UP },
      { budget, currency: 'TRY' },
      { budget: null, milestones: [] },
    ]) {
      expect(setProjectBudgetSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    // Neither the body that opens a project nor the one that changes it takes a budget or
    // milestones: each has its own route.
    for (const extra of [{ budget }, { budget: 100 }, { milestones: [] }]) {
      expect(
        createProjectSchema.safeParse({ id: uuid(1), name: 'Yeni site', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
      expect(
        updateProjectSchema.safeParse({ name: 'Yeni site', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('a milestone has a trimmed name of 1 to 120 characters, an optional real day and no other field', () => {
    expect(MILESTONE_NAME_MAX).toBe(120);
    expect(MILESTONE_MAX).toBe(50);
    expect(createMilestoneSchema.parse({ id: uuid(5), name: '  Tasarım onayı ' })).toEqual({
      id: uuid(5),
      name: 'Tasarım onayı',
      date: null,
    });
    expect(
      createMilestoneSchema.parse({ id: uuid(5), name: 'a'.repeat(120), date: '2028-02-29' }),
    ).toEqual({ id: uuid(5), name: 'a'.repeat(120), date: '2028-02-29' });
    for (const body of [
      { name: 'Yayın' },
      { id: 'first', name: 'Yayın' },
      { id: uuid(5) },
      { id: uuid(5), name: '' },
      { id: uuid(5), name: '   ' },
      { id: uuid(5), name: 'a'.repeat(121) },
      { id: uuid(5), name: 'Ya\u202eyın' },
      { id: uuid(5), name: 'Ya\u0000yın' },
      { id: uuid(5), name: 'Yayın', date: '2026-02-30' },
      { id: uuid(5), name: 'Yayın', date: '0000-01-01' },
      { id: uuid(5), name: 'Yayın', date: '2026-01-01T00:00:00Z' },
      { id: uuid(5), name: 'Yayın', date: '' },
      // A new milestone is not reached; "done" is set by a change.
      { id: uuid(5), name: 'Yayın', done: true },
      { id: uuid(5), name: 'Yayın', owner: uuid(3) },
    ]) {
      expect(createMilestoneSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    // The answer's entry: the four fields the database stores.
    const stored = { id: uuid(5), name: 'Yayın', date: null, done: true };
    expect(milestoneSchema.parse(stored)).toEqual(stored);
    for (const field of ['id', 'name', 'date', 'done'] as const) {
      const without = Object.fromEntries(Object.entries(stored).filter(([name]) => name !== field));
      expect(milestoneSchema.safeParse(without).success, field).toBe(false);
    }
    expect(milestoneSchema.safeParse({ ...stored, date: '2026-13-01' }).success).toBe(false);
  });

  it('a milestone change needs at least one field', () => {
    expect(updateMilestoneSchema.parse({ done: true })).toEqual({ done: true });
    expect(updateMilestoneSchema.parse({ name: ' Yeni ad ' })).toEqual({ name: 'Yeni ad' });
    // null clears the day; a field left out is not changed.
    expect(updateMilestoneSchema.parse({ date: null })).toEqual({ date: null });
    expect(updateMilestoneSchema.parse({ name: 'Ad', date: '2026-11-15', done: false })).toEqual({
      name: 'Ad',
      date: '2026-11-15',
      done: false,
    });
    for (const body of [
      {},
      { name: '' },
      { name: 'a'.repeat(121) },
      { date: '2026-02-30' },
      { done: 'yes' },
      { done: null },
      { id: uuid(6), done: true },
      { done: true, note: 'x' },
    ]) {
      expect(updateMilestoneSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('milestones are shown by day, the ones without a day last, ties in the order they were added', () => {
    const entry = (n: number, date: string | null): Milestone => ({
      id: uuid(n),
      name: `Adım ${String(n)}`,
      date,
      done: false,
    });
    const added = [
      entry(1, null),
      entry(2, '2026-12-01'),
      entry(3, '2026-11-15'),
      entry(4, null),
      entry(5, '2026-11-15'),
      entry(6, '2025-01-01'),
    ];
    const before = added.map((milestone) => ({ ...milestone }));
    expect(sortedMilestones(added).map((milestone) => milestone.id)).toEqual(
      [6, 3, 5, 2, 1, 4].map(uuid),
    );
    // The list it was given is not reordered.
    expect(added).toEqual(before);
    expect(sortedMilestones([])).toEqual([]);
  });

  it('the project detail says whether the budget is visible, and carries no amount when it is not', () => {
    const milestones = [{ id: uuid(5), name: 'Yayın', date: '2026-12-01', done: false }];
    for (const budget of [
      { visible: false },
      { visible: true, value: null },
      { visible: true, value: { amount: '150000.00', currency: 'TRY' } },
    ]) {
      const detail = { ...DETAIL, budget, milestones };
      expect(projectDetailSchema.parse(detail), JSON.stringify(budget)).toEqual(detail);
    }
    // An amount sent beside "not visible" does not survive the parse.
    const hidden = projectDetailSchema.parse({
      ...DETAIL,
      budget: { visible: false, value: { amount: '150000.00', currency: 'TRY' } },
    });
    expect(hidden.budget).toEqual({ visible: false });
    expect(JSON.stringify(hidden)).not.toContain('150000');
    for (const budget of [
      undefined,
      null,
      {},
      { visible: true },
      { visible: true, value: { amount: '150000.00' } },
      { visible: true, value: { amount: 150000, currency: 'TRY' } },
      { visible: 'yes', value: null },
      { amount: '150000.00', currency: 'TRY' },
    ]) {
      expect(
        projectDetailSchema.safeParse({ ...DETAIL, budget }).success,
        JSON.stringify(budget),
      ).toBe(false);
    }
    // The milestones and the budget action are part of every answer.
    const without = (object: Record<string, unknown>, field: string) =>
      Object.fromEntries(Object.entries(object).filter(([name]) => name !== field));
    expect(projectDetailSchema.safeParse(without(DETAIL, 'milestones')).success).toBe(false);
    expect(
      projectDetailSchema.safeParse({ ...DETAIL, actions: without(DETAIL.actions, 'setBudget') })
        .success,
    ).toBe(false);
    for (const code of ['project_budget_not_allowed', 'milestone_limit', 'milestone_not_found']) {
      expect(apiErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });
});

// Step 3 of the Projects section (8 October decision 17): the AI spending limit of a project.
describe('the AI spending limit of a project', () => {
  const SUMMARY = {
    id: uuid(1),
    name: 'Yeni site',
    status: 'planned',
    closed: false,
    color: 'gray',
    icon: 'folder',
    targetDate: null,
    aiAllowed: true,
    agentsMayWork: true,
    spendingLimitReached: false,
    customer: null,
    memberCount: 1,
  };
  const DETAIL = {
    ...SUMMARY,
    description: null,
    createdAt: '2026-10-08T09:00:00.000Z',
    createdBy: null,
    members: [],
    budget: { visible: false },
    milestones: [],
    aiSpending: null,
    actions: {
      edit: true,
      addMembers: false,
      setBudget: false,
      setAiPermission: false,
      setCustomerPermissions: false,
      setAiSpendingLimit: false,
    },
  };
  const without = (object: Record<string, unknown>, field: string) =>
    Object.fromEntries(Object.entries(object).filter(([name]) => name !== field));

  it("the state of a project's spending: no limit, under, from 80 percent on, reached", () => {
    expect(SPENDING_WARN_SHARE).toBe(0.8);
    expect(spendingState(null, '0', false)).toBe('no_limit');
    expect(spendingState(null, '1234.5', false)).toBe('no_limit');
    expect(spendingState('100.00', '0', false)).toBe('ok');
    expect(spendingState('100.00', '79.99', false)).toBe('ok');
    expect(spendingState('100.00', '79.999999', false)).toBe('ok');
    // The warning begins AT 80 percent.
    expect(spendingState('100.00', '80', false)).toBe('near');
    expect(spendingState('100.00', '80.000000', false)).toBe('near');
    expect(spendingState('100.00', '99.999999', false)).toBe('near');
    expect(spendingState('0.05', '0.040000', false)).toBe('near');
    // "Reached" is the server's word alone: the database compared the sum with the limit. The
    // panel does not decide it from the two amounts it was given, in either direction.
    expect(spendingState('100.00', '100.000000', true)).toBe('reached');
    expect(spendingState('100.00', '250', true)).toBe('reached');
    expect(spendingState('100.00', '10', true)).toBe('reached');
    expect(spendingState('100.00', '100.000000', false)).toBe('near');
    // Without a limit nothing is reached, whatever the flag says.
    expect(spendingState(null, '10', true)).toBe('no_limit');
  });

  it('every reader is told whether the limit is reached; the amounts are in the answer only for the founder', () => {
    for (const spendingLimitReached of [true, false]) {
      expect(projectSummarySchema.parse({ ...SUMMARY, spendingLimitReached })).toEqual({
        ...SUMMARY,
        spendingLimitReached,
      });
    }
    // The flag is the server's word: never left out, never a guess.
    expect(projectSummarySchema.safeParse(without(SUMMARY, 'spendingLimitReached')).success).toBe(
      false,
    );
    for (const value of [null, 'yes', 1]) {
      expect(
        projectSummarySchema.safeParse({ ...SUMMARY, spendingLimitReached: value }).success,
        String(value),
      ).toBe(false);
    }
    // A member: the flag, and no amount anywhere.
    const forMember = projectDetailSchema.parse({ ...DETAIL, spendingLimitReached: true });
    expect(forMember.aiSpending).toBeNull();
    expect(forMember.actions.setAiSpendingLimit).toBe(false);
    // The founder: the limit (or none) and what was spent, as text.
    for (const aiSpending of [
      { limitUsd: null, spentUsd: '0' },
      { limitUsd: '50.00', spentUsd: '1.674690' },
      { limitUsd: '999999.99', spentUsd: '1000000.5' },
    ]) {
      const detail = {
        ...DETAIL,
        aiSpending,
        actions: { ...DETAIL.actions, setAiSpendingLimit: true },
      };
      expect(projectDetailSchema.parse(detail), JSON.stringify(aiSpending)).toEqual(detail);
    }
    for (const aiSpending of [
      undefined,
      {},
      { limitUsd: '50.00' },
      { spentUsd: '1.5' },
      { limitUsd: 50, spentUsd: '1.5' },
      { limitUsd: '50.00', spentUsd: 1.5 },
      { limitUsd: '50,00', spentUsd: '1.5' },
      { limitUsd: '50.00', spentUsd: null },
      { limitUsd: '-1', spentUsd: '0' },
    ]) {
      expect(
        projectDetailSchema.safeParse({ ...DETAIL, aiSpending }).success,
        JSON.stringify(aiSpending),
      ).toBe(false);
    }
    expect(
      projectDetailSchema.safeParse({
        ...DETAIL,
        actions: without(DETAIL.actions, 'setAiSpendingLimit'),
      }).success,
    ).toBe(false);
    for (const code of ['project_spending_limit_reached', 'spending_limit_reached']) {
      expect(apiErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });
});
