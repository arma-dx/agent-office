import {
  mayAddProjectMembers,
  memberRemoval,
  memberRoleChanges,
  projectDetailSchema,
  projectRunSchema,
  projectRunsSchema,
  projectSummarySchema,
  setProjectMemberRoleSchema,
  type CustomerOption,
  type MembershipSummary,
  type ProjectActor,
  type ProjectDetail,
  type ProjectMember,
  type ProjectMemberCandidate,
  type ProjectMemberRole,
  type ProjectRun,
  type ProjectRuns,
  type ProjectSummary,
} from '@agent-office/shared';
import { apiError, ARMADX, json, sessionHandler, USER_ID, type Handler } from './mock-api.ts';

/** Fixtures of the Projects section, checked against the shared contract so they cannot drift. */

export const PROJECT_ID = 'a1111111-1111-4111-8111-111111111111';
export const CUSTOMER_ID = 'c1111111-1111-4111-8111-111111111111';
export const OTHER_CUSTOMER_ID = 'c2222222-2222-4222-8222-222222222222';
const AT = '2026-10-08T09:00:00.000Z';

/**
 * The reader of most tests: the founder of the session fixture, who opened the fixture's project
 * and so is its owner (8 October decision 44). Nobody removes the owner or changes the owner's
 * role directly.
 */
export const FOUNDER_MEMBER: ProjectMember = {
  userId: USER_ID,
  name: 'Ömer Kadıoğlu',
  role: 'founder',
  active: true,
  projectRole: 'owner',
  removable: false,
  roleChanges: [],
};
/** Plain members, with the flags the owner (and the founder) reads: removable, any role. */
export const AYSE: ProjectMember = {
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Ayşe Yılmaz',
  role: 'employee',
  active: true,
  projectRole: 'member',
  removable: true,
  roleChanges: ['manager', 'owner'],
};
export const CAGAN: ProjectMember = {
  userId: '44444444-4444-4444-8444-444444444444',
  name: 'Çağan Ünal',
  role: 'employee',
  active: true,
  projectRole: 'member',
  removable: true,
  roleChanges: ['manager', 'owner'],
};

/** Everybody who can be a member, as GET /projects/member-candidates answers. */
export const CANDIDATES: ProjectMemberCandidate[] = [
  { userId: AYSE.userId, name: 'Ayşe Yılmaz', role: 'employee' },
  { userId: CAGAN.userId, name: 'Çağan Ünal', role: 'employee' },
  { userId: USER_ID, name: 'Ömer Kadıoğlu', role: 'founder' },
];

/** The customers of the company as the founder reads them. */
export const CUSTOMERS: CustomerOption[] = [
  { id: CUSTOMER_ID, name: 'Beta Lojistik', aiAllowed: false, automatedProcessingAllowed: false },
  {
    id: OTHER_CUSTOMER_ID,
    name: 'Gama Enerji',
    aiAllowed: true,
    automatedProcessingAllowed: false,
  },
];
/** ... and as an employee reads them: the names only. */
export const CUSTOMER_NAMES: CustomerOption[] = CUSTOMERS.map((customer) => ({
  ...customer,
  aiAllowed: null,
  automatedProcessingAllowed: null,
}));

/**
 * A project as the API answers it to the founder, who opened it and is its owner: under way,
 * with a customer whose contract does not allow AI, its own AI permission closed, two members.
 */
export function projectDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  const members = overrides.members ?? [FOUNDER_MEMBER, AYSE];
  return projectDetailSchema.parse({
    id: PROJECT_ID,
    name: 'Depo otomasyonu',
    status: 'in_progress',
    closed: false,
    color: 'teal',
    icon: 'box',
    targetDate: '2026-11-20',
    aiAllowed: false,
    agentsMayWork: false,
    // The AI spending limit of step 3: not reached, and no figure, until a test says otherwise.
    spendingLimitReached: false,
    customer: {
      id: CUSTOMER_ID,
      name: 'Beta Lojistik',
      aiAllowed: false,
      automatedProcessingAllowed: false,
    },
    memberCount: members.length,
    description: 'Depo süreçlerinin çıkarılması.\nİkinci satır.',
    createdAt: AT,
    createdBy: { userId: USER_ID, name: 'Ömer Kadıoğlu' },
    members,
    // The budget and the milestones of step 3: nothing of either until a test gives some.
    budget: { visible: false },
    milestones: [],
    aiSpending: null,
    actions: {
      edit: true,
      addMembers: true,
      setBudget: false,
      setAiPermission: true,
      setCustomerPermissions: true,
      setAiSpendingLimit: false,
    },
    ...overrides,
  });
}

/** The same project as an employee who is a member reads it: no permission is theirs to set. */
export function projectForEmployee(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  const base = projectDetail(overrides);
  return projectDetailSchema.parse({
    ...base,
    customer: base.customer ? { ...base.customer, automatedProcessingAllowed: null } : null,
    actions: { ...base.actions, setAiPermission: false, setCustomerPermissions: false },
  });
}

/** A member before the reader is known: who they are and their role in the project. */
export type MemberOfProject = Pick<
  ProjectMember,
  'userId' | 'name' | 'role' | 'active' | 'projectRole'
>;

/**
 * The members and the add right as the API answers them to one reader (8 October decision 44):
 * the flags are computed with the shared rule the API itself uses, so a fixture cannot offer a
 * button the API would not. The reader is the signed-in person; `founder` says whether they are
 * the company's founder.
 */
export function membersFor(
  founder: boolean,
  people: readonly MemberOfProject[],
): Pick<ProjectDetail, 'members' | 'memberCount'> & { addMembers: boolean } {
  const actor: ProjectActor = {
    userId: USER_ID,
    founder,
    projectRole: people.find((person) => person.userId === USER_ID)?.projectRole ?? null,
  };
  return {
    members: people.map((person) => ({
      userId: person.userId,
      name: person.name,
      role: person.role,
      active: person.active,
      projectRole: person.projectRole,
      removable: memberRemoval(actor, person) === 'ok',
      roleChanges: memberRoleChanges(actor, person),
    })),
    memberCount: people.length,
    addMembers: mayAddProjectMembers(actor),
  };
}

/** The fixture's project as one reader gets it, with the given people in the given roles. */
export function projectWithRoles(
  founder: boolean,
  people: readonly MemberOfProject[],
): ProjectDetail {
  const { addMembers, ...members } = membersFor(founder, people);
  const base = founder ? projectDetail(members) : projectForEmployee(members);
  return projectDetailSchema.parse({ ...base, actions: { ...base.actions, addMembers } });
}

/** The key of the role route of a member of the fixture's project. */
export function roleRoute(userId: string): string {
  return `PUT /projects/${PROJECT_ID}/members/${userId}/role`;
}

/**
 * PUT /projects/:id/members/:userId/role for every member of a project, as the API does it: the
 * member gets the role, a hand-over makes the owner until now a plain member, and the answer is
 * the project as the reader may act on it afterwards.
 */
export function roleHandlers(
  founder: boolean,
  people: readonly MemberOfProject[],
): Record<string, Handler> {
  let roles = people.map((person) => ({ ...person }));
  const give =
    (userId: string): Handler =>
    (call) => {
      const body = setProjectMemberRoleSchema.safeParse(call.body);
      if (!body.success) return apiError(400, 'invalid_request', 'İstek okunamadı.');
      const role: ProjectMemberRole = body.data.role;
      roles = roles.map((person) => {
        if (person.userId === userId) return { ...person, projectRole: role };
        // One owner at most: the owner until now becomes a plain member.
        if (role === 'owner' && person.projectRole === 'owner') {
          return { ...person, projectRole: 'member' as const };
        }
        return person;
      });
      return json(projectWithRoles(founder, roles));
    };
  return Object.fromEntries(
    people.map((person) => [roleRoute(person.userId), give(person.userId)]),
  );
}

/** A row of the list; the default is the project of projectDetail(). */
export function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  const detail = projectDetail();
  return projectSummarySchema.parse({
    id: detail.id,
    name: detail.name,
    status: detail.status,
    closed: detail.closed,
    color: detail.color,
    icon: detail.icon,
    targetDate: detail.targetDate,
    aiAllowed: detail.aiAllowed,
    agentsMayWork: detail.agentsMayWork,
    spendingLimitReached: detail.spendingLimitReached,
    customer: detail.customer ? { id: detail.customer.id, name: detail.customer.name } : null,
    memberCount: detail.memberCount,
    ...overrides,
  });
}

export const EMPLOYEE_AT_ARMADX: MembershipSummary = {
  ...ARMADX,
  role: 'employee',
  canApprove: false,
};
export const EXTERNAL_AT_ARMADX: MembershipSummary = {
  ...ARMADX,
  role: 'external',
  canApprove: false,
};

/** GET /session of a person with one membership of Arma DX in the given role. */
export function sessionAs(membership: MembershipSummary): Handler {
  return sessionHandler({ memberships: [membership], lastCompanyId: membership.companyId });
}

/** The key of the request list of a project (the "Talepler" tab of its page). */
export function projectRequestsRoute(projectId: string = PROJECT_ID): string {
  return `GET /requests?project=${projectId}`;
}

/** The key of the count an opening confirmation reads (GET /waiting-work with one scope). */
export function waitingWorkRoute(
  scope: { agent: string } | { project: string } | { customer: string },
): string {
  return `GET /waiting-work?${new URLSearchParams(scope).toString()}`;
}

/** The key of the list of a project's agent runs (the "Çalışmalar" tab of its page). */
export function projectRunsRoute(projectId: string = PROJECT_ID): string {
  return `GET /projects/${projectId}/runs`;
}

export const RUN_ID = 'd1111111-1111-4111-8111-111111111111';

/**
 * One agent run of the fixture's project as a member reads it: finished, on a request, without
 * tokens or cost (those are the founder's; a test gives `usage`).
 */
export function projectRun(overrides: Partial<ProjectRun> = {}): ProjectRun {
  return projectRunSchema.parse({
    id: RUN_ID,
    request: { id: 'e1111111-1111-4111-8111-111111111111', title: 'Ekim bülteni taslağı' },
    agent: { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' },
    status: 'completed',
    errorCode: null,
    startedAt: '2026-10-08T09:00:00.000Z',
    finishedAt: '2026-10-08T09:00:38.000Z',
    durationMs: 38_000,
    usage: null,
    ...overrides,
  });
}

/** GET /projects/:id/runs: the given runs, counted, with the usage added up when they carry it. */
export function projectRuns(
  runs: ProjectRun[] = [],
  overrides: Partial<ProjectRuns> = {},
): ProjectRuns {
  const used = runs.flatMap((run) => (run.usage ? [run.usage] : []));
  return projectRunsSchema.parse({
    runs,
    truncated: false,
    totals: {
      runCount: runs.length,
      usage:
        used.length === 0
          ? null
          : {
              inputTokens: used.reduce((sum, usage) => sum + usage.inputTokens, 0),
              outputTokens: used.reduce((sum, usage) => sum + usage.outputTokens, 0),
              cacheWriteTokens: used.reduce((sum, usage) => sum + usage.cacheWriteTokens, 0),
              cacheReadTokens: used.reduce((sum, usage) => sum + usage.cacheReadTokens, 0),
              costUsd: used.reduce((sum, usage) => sum + Number(usage.costUsd), 0).toFixed(6),
            },
    },
    serverTime: '2026-10-08T10:00:00.000Z',
    ...overrides,
  });
}

/**
 * The read routes of the section, answering the fixtures; a test replaces what it is about. The
 * project has no request and no agent run unless a test gives some, and no request waits for an
 * opening.
 */
export function projectHandlers(
  detail: ProjectDetail = projectDetail(),
  extra: Record<string, Handler> = {},
): Record<string, Handler> {
  return {
    'GET /session': sessionHandler(),
    'GET /projects': () => json({ projects: [project()], truncated: false }),
    [`GET /projects/${detail.id}`]: () => json(detail),
    [projectRequestsRoute(detail.id)]: () => json({ requests: [], truncated: false }),
    [projectRunsRoute(detail.id)]: () => json(projectRuns()),
    // The confirmation of an opening asks how many waiting requests it would start: none.
    [waitingWorkRoute({ project: detail.id })]: () => json({ waiting: 0 }),
    ...(detail.customer
      ? { [waitingWorkRoute({ customer: detail.customer.id })]: () => json({ waiting: 0 }) }
      : {}),
    'GET /projects/member-candidates': () => json({ people: CANDIDATES }),
    'GET /customers': () => json({ customers: CUSTOMERS }),
    ...extra,
  };
}
