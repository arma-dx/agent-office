import {
  connectGithubSchema,
  githubConnectionSchema,
  githubRepositoriesSchema,
  projectDetailSchema,
  projectGithubSchema,
  setProjectRepositorySchema,
  type GithubConnection,
  type GithubRepositories,
  type ProjectDetail,
  type ProjectGithub,
  type StepUp,
} from '@agent-office/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '../api.ts';

/**
 * The GitHub connection of a company and the GitHub tab of a project (8 October 2026, decisions
 * 17, 19 and 22; 12 October decisions 12 to 17).
 *
 * The panel never calls GitHub: everything it shows of GitHub is an answer of the API, checked
 * with the shared contract, and the only thing that goes to github.com is a link a person
 * presses. Every request carries the selected company and every key begins with it, so a change
 * of company never shows what was read for the other one.
 */

interface FetchOptions {
  signal?: AbortSignal;
  background?: boolean;
}

/** Everything the panel read of the company's GitHub connection: the prefix of the two keys below. */
export const githubKey = (companyId: string) => ['company', companyId, 'github'] as const;
export const githubConnectionKey = (companyId: string) =>
  ['company', companyId, 'github', 'connection'] as const;
export const githubRepositoriesKey = (companyId: string) =>
  ['company', companyId, 'github', 'repositories'] as const;
/**
 * What GitHub shows of a project's repository. Under the key of the project
 * (lib/projects/query.ts), so everything that makes a project page read again reads the tab again.
 */
export const projectGithubKey = (companyId: string, projectId: string) =>
  ['company', companyId, 'project', projectId, 'github'] as const;

/** GET /api/github/connection: the founder reads the connection of the selected company. */
export function githubConnectionQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: githubConnectionKey(companyId),
    queryFn: ({ signal }): Promise<GithubConnection> =>
      apiRequest('/github/connection', { schema: githubConnectionSchema, companyId, signal }),
  });
}

/**
 * POST /api/github/connection: connects the organisation the page showed, with the founder's
 * github_connection re-verification for it. Answers the connection as it is afterwards.
 */
export function connectGithub(companyId: string, stepUp: StepUp): Promise<GithubConnection> {
  const body = connectGithubSchema.parse({ stepUp });
  return apiRequest('/github/connection', {
    method: 'POST',
    body,
    schema: githubConnectionSchema,
    companyId,
  });
}

/** DELETE /api/github/connection: switches the connection of the selected company off. */
export function disconnectGithub(companyId: string): Promise<GithubConnection> {
  return apiRequest('/github/connection', {
    method: 'DELETE',
    schema: githubConnectionSchema,
    companyId,
  });
}

/**
 * GET /api/github/repositories: the repositories of the connected organisation by name, for a
 * founder or an employee who picks one for a project. `refresh` (the founder's "Listeyi yenile")
 * makes the API read the list from GitHub again now.
 */
export function fetchGithubRepositories(
  companyId: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<GithubRepositories> {
  return apiRequest(`/github/repositories${options.refresh === true ? '?refresh=1' : ''}`, {
    schema: githubRepositoriesSchema,
    companyId,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export function githubRepositoriesQueryOptions(companyId: string) {
  return queryOptions({
    queryKey: githubRepositoriesKey(companyId),
    queryFn: ({ signal }) => fetchGithubRepositories(companyId, { signal }),
  });
}

/**
 * GET /api/projects/:projectId/github: the "GitHub" tab. Always an answer for a project the
 * person can read: what cannot be shown is a state of it. `background`: the periodic refresh of
 * the tab, which does not extend the session's idle time (rule 3).
 */
export function fetchProjectGithub(
  companyId: string,
  projectId: string,
  options: FetchOptions = {},
): Promise<ProjectGithub> {
  const id = z.uuid().parse(projectId);
  return apiRequest(`/projects/${id}/github`, {
    schema: projectGithubSchema,
    companyId,
    ...options,
  });
}

export function projectGithubQueryOptions(companyId: string, projectId: string) {
  return queryOptions({
    queryKey: projectGithubKey(companyId, projectId),
    queryFn: ({ signal }) => fetchProjectGithub(companyId, projectId, { signal }),
  });
}

/**
 * PUT /api/projects/:projectId/repository: the owner, a manager or the founder gives the project
 * a repository of the company's organisation, or another one. The repository is named by GitHub's
 * number alone. Answers the project.
 */
export function setProjectRepository(
  companyId: string,
  projectId: string,
  repositoryId: number,
): Promise<ProjectDetail> {
  const id = z.uuid().parse(projectId);
  const body = setProjectRepositorySchema.parse({ repositoryId });
  return apiRequest(`/projects/${id}/repository`, {
    method: 'PUT',
    body,
    schema: projectDetailSchema,
    companyId,
  });
}

/** DELETE /api/projects/:projectId/repository: takes the repository of the project away. */
export function removeProjectRepository(
  companyId: string,
  projectId: string,
): Promise<ProjectDetail> {
  const id = z.uuid().parse(projectId);
  return apiRequest(`/projects/${id}/repository`, {
    method: 'DELETE',
    schema: projectDetailSchema,
    companyId,
  });
}
