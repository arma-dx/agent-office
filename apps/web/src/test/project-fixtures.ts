import {
  projectDetailSchema,
  projectSummarySchema,
  type CustomerOption,
  type MembershipSummary,
  type ProjectDetail,
  type ProjectMember,
  type ProjectMemberCandidate,
  type ProjectSummary,
} from '@agent-office/shared';
import { ARMADX, json, sessionHandler, USER_ID, type Handler } from './mock-api.ts';

/** Fixtures of the Projects section, checked against the shared contract so they cannot drift. */

export const PROJECT_ID = 'a1111111-1111-4111-8111-111111111111';
export const CUSTOMER_ID = 'c1111111-1111-4111-8111-111111111111';
export const OTHER_CUSTOMER_ID = 'c2222222-2222-4222-8222-222222222222';
const AT = '2026-10-08T09:00:00.000Z';

/** The reader of most tests: the founder of the session fixture. */
export const FOUNDER_MEMBER: ProjectMember = {
  userId: USER_ID,
  name: 'Ömer Kadıoğlu',
  role: 'founder',
  active: true,
};
export const AYSE: ProjectMember = {
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Ayşe Yılmaz',
  role: 'employee',
  active: true,
};
export const CAGAN: ProjectMember = {
  userId: '44444444-4444-4444-8444-444444444444',
  name: 'Çağan Ünal',
  role: 'employee',
  active: true,
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
 * A project as the API answers it to the founder: under way, with a customer whose contract does
 * not allow AI, its own AI permission closed, two members.
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
    actions: {
      edit: true,
      manageMembers: true,
      setAiPermission: true,
      setCustomerPermissions: true,
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

/** The read routes of the section, answering the fixtures; a test replaces what it is about. */
export function projectHandlers(
  detail: ProjectDetail = projectDetail(),
  extra: Record<string, Handler> = {},
): Record<string, Handler> {
  return {
    'GET /session': sessionHandler(),
    'GET /projects': () => json({ projects: [project()], truncated: false }),
    [`GET /projects/${detail.id}`]: () => json(detail),
    'GET /projects/member-candidates': () => json({ people: CANDIDATES }),
    'GET /customers': () => json({ customers: CUSTOMERS }),
    ...extra,
  };
}
