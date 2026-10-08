import { describe, expect, it } from 'vitest';
import {
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
  createProjectSchema,
  customerPermissionsSchema,
  isClosedProjectStatus,
  projectAiPermissionSchema,
  projectDetailSchema,
  updateProjectSchema,
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
      customer: { id: uuid(2), name: 'Beta', aiAllowed: false, automatedProcessingAllowed: null },
      memberCount: 1,
      description: null,
      createdAt: '2026-10-08T09:00:00.000Z',
      createdBy: null,
      members: [{ userId: uuid(3), name: 'Ada Yılmaz', role: 'employee', active: true }],
      actions: {
        edit: true,
        manageMembers: true,
        setAiPermission: false,
        setCustomerPermissions: false,
      },
    };
    expect(projectDetailSchema.parse(detail)).toEqual(detail);
    expect(projectDetailSchema.safeParse({ ...detail, status: 'open' }).success).toBe(false);
    expect(
      projectDetailSchema.safeParse({ ...detail, customer: { id: uuid(2), name: 'Beta' } }).success,
    ).toBe(false);
  });
});
