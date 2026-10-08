import {
  createProjectSchema,
  customerListSchema,
  customerPermissionsSchema,
  customerSchema,
  projectAiPermissionSchema,
  projectDetailSchema,
  projectListSchema,
  projectMemberCandidatesSchema,
  setProjectMemberRoleSchema,
  updateProjectSchema,
  type CreateProject,
  type Customer,
  type CustomerOption,
  type CustomerPermissions,
  type ProjectAiPermission,
  type ProjectDetail,
  type ProjectList,
  type ProjectMemberCandidate,
  type ProjectMemberRole,
  type UpdateProject,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '../api.ts';

/**
 * The Projects section (8 October 2026, decisions 11 and 14 to 22): the list, a project, the
 * people and customers to choose from, and the changes. Every body and every answer is validated
 * with the shared contract. Nothing here is refreshed on a timer: a project does not move by
 * itself; a query asks again when the person comes back to the window, like every query.
 *
 * No body carries the AI permission of a project except the one made for it
 * (setProjectAiPermission), and none a contract permission of a customer except the founder's two
 * (a customer added with a new project, and setCustomerPermissions).
 */

export const projectsKey = (companyId: string) => ['company', companyId, 'projects'] as const;
/** Every project page of the company: the prefix of projectKey. */
export const projectPagesKey = (companyId: string) => ['company', companyId, 'project'] as const;
export const projectKey = (companyId: string, projectId: string) =>
  ['company', companyId, 'project', projectId] as const;
export const customersKey = (companyId: string) => ['company', companyId, 'customers'] as const;
export const memberCandidatesKey = (companyId: string) =>
  ['company', companyId, 'project-member-candidates'] as const;

export function projectsQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: projectsKey(companyId),
    queryFn: ({ signal }): Promise<ProjectList> =>
      apiRequest('/projects', { schema: projectListSchema, companyId, signal }),
  });
}

export function projectQueryOptions(companyId: string, projectId: string) {
  return queryOptions({
    queryKey: projectKey(companyId, projectId),
    queryFn: ({ signal }): Promise<ProjectDetail> =>
      apiRequest(`/projects/${projectId}`, { schema: projectDetailSchema, companyId, signal }),
    // A hidden and a missing project are one answer; asking again changes nothing.
    retry: false,
  });
}

/** The customers of the company to choose from; an employee gets the names only. */
export function customersQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: customersKey(companyId),
    queryFn: async ({ signal }): Promise<CustomerOption[]> =>
      (await apiRequest('/customers', { schema: customerListSchema, companyId, signal })).customers,
  });
}

/** Who can be made a member of a project: the active founders and employees of the company. */
export function memberCandidatesQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: memberCandidatesKey(companyId),
    queryFn: async ({ signal }): Promise<ProjectMemberCandidate[]> =>
      (
        await apiRequest('/projects/member-candidates', {
          schema: projectMemberCandidatesSchema,
          companyId,
          signal,
        })
      ).people,
  });
}

/** The id is chosen by the panel, so a send that is repeated answers the first project. */
export function createProject(companyId: string, project: CreateProject): Promise<ProjectDetail> {
  const body = createProjectSchema.parse(project);
  return apiRequest('/projects', {
    method: 'POST',
    body,
    schema: projectDetailSchema,
    companyId,
  });
}

/** Only the fields that are sent change. */
export function updateProject(
  companyId: string,
  projectId: string,
  changes: UpdateProject,
): Promise<ProjectDetail> {
  const id = z.uuid().parse(projectId);
  const body = updateProjectSchema.parse(changes);
  return apiRequest(`/projects/${id}`, {
    method: 'PATCH',
    body,
    schema: projectDetailSchema,
    companyId,
  });
}

export function addProjectMember(
  companyId: string,
  projectId: string,
  userId: string,
): Promise<ProjectDetail> {
  const ids = z.object({ projectId: z.uuid(), userId: z.uuid() }).parse({ projectId, userId });
  return apiRequest(`/projects/${ids.projectId}/members/${ids.userId}`, {
    method: 'PUT',
    schema: projectDetailSchema,
    companyId,
  });
}

export function removeProjectMember(
  companyId: string,
  projectId: string,
  userId: string,
): Promise<ProjectDetail> {
  const ids = z.object({ projectId: z.uuid(), userId: z.uuid() }).parse({ projectId, userId });
  return apiRequest(`/projects/${ids.projectId}/members/${ids.userId}`, {
    method: 'DELETE',
    schema: projectDetailSchema,
    companyId,
  });
}

/**
 * Gives a member a role in the project (8 October 2026, decision 44): the owner of the project and
 * the founder appoint and dismiss a manager, and hand the ownership over by making another member
 * the owner. The API answers the whole project as the reader may now act on it.
 */
export function setProjectMemberRole(
  companyId: string,
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
): Promise<ProjectDetail> {
  const ids = z.object({ projectId: z.uuid(), userId: z.uuid() }).parse({ projectId, userId });
  const body = setProjectMemberRoleSchema.parse({ role });
  return apiRequest(`/projects/${ids.projectId}/members/${ids.userId}/role`, {
    method: 'PUT',
    body,
    schema: projectDetailSchema,
    companyId,
  });
}

/**
 * The founder opens or closes the AI permission of a project. Opening names the customer the page
 * showed and carries a project_ai_permission re-verification for it; closing carries neither.
 */
export function setProjectAiPermission(
  companyId: string,
  projectId: string,
  permission: ProjectAiPermission,
): Promise<ProjectDetail> {
  const id = z.uuid().parse(projectId);
  const body = projectAiPermissionSchema.parse(permission);
  return apiRequest(`/projects/${id}/ai-permission`, {
    method: 'PUT',
    body,
    schema: projectDetailSchema,
    companyId,
  });
}

/** The founder sets the contract permissions of a customer; opening the AI one needs a passkey. */
export function setCustomerPermissions(
  companyId: string,
  customerId: string,
  permissions: CustomerPermissions,
): Promise<Customer> {
  const id = z.uuid().parse(customerId);
  const body = customerPermissionsSchema.parse(permissions);
  return apiRequest(`/customers/${id}/permissions`, {
    method: 'PATCH',
    body,
    schema: customerSchema,
    companyId,
  });
}
