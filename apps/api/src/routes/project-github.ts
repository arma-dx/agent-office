import {
  projectCodeProcessingAllowed,
  readCompanyForGithub,
  readGithubConnection,
  unlinkProjectRepository,
} from '@agent-office/db';
import {
  projectGithubSchema,
  setProjectRepositorySchema,
  type LinkedRepository,
  type ProjectDetail,
  type ProjectGithub,
} from '@agent-office/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { invalidRequest, notFound } from '../errors.ts';
import {
  linkRepository,
  openConnectionOf,
  repositoryNotAllowedForProject,
  repositoryNotYours,
  repositoryToLink,
} from '../project-repository.ts';
import type { RouteDeps } from '../services.ts';
import { connectionRef } from './github.ts';
import { actorOf, detailOf, managesRepository, projectOf } from './projects.ts';

/**
 * The GitHub repository of a project and its "GitHub" tab (8 October decisions 17 and 19;
 * 12 October decisions 14, 16 and 17).
 *
 *   PUT    /api/projects/:projectId/repository   the owner, a manager or the founder gives the
 *                                                project a repository, or another one
 *   DELETE /api/projects/:projectId/repository   ... takes it away
 *   GET    /api/projects/:projectId/github       whoever reads the project reads the last
 *                                                commits, the open pull requests and the open
 *                                                issues of its repository
 *
 * A project the person cannot read answers 404 exactly like one that does not exist. An external
 * person is no project member: every route is for the founder and employees.
 *
 * The tab only reads, and only through the GitHub client of the request's company. Rule 12: when
 * the customer of the project allows neither AI nor automated processing by code, no repository
 * is linked and nothing is read from GitHub for the project; the link itself is kept. The lists
 * are asked after the request's transaction has ended, so a slow GitHub holds no connection of
 * the database; the two writes ask GitHub inside it, before they write.
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

const projectParams = z.object({ projectId: z.uuid() });

function projectIdOf(request: FastifyRequest): string {
  const params = projectParams.safeParse(request.params);
  if (!params.success) {
    throw notFound();
  }
  return params.data.projectId;
}

export function registerProjectGithubRoutes(
  app: FastifyInstance,
  { runner, github }: RouteDeps,
): void {
  /**
   * Gives the project a repository of the company's organisation, or another one (decision 17;
   * no passkey: connecting the company was the passkey's act). In order: the project, who the
   * person is to it, the company's open connection, rule 12, and whether the repository is one
   * the installation reaches; only then the old link goes and the new one is written. The same
   * repository again writes nothing.
   */
  app.put('/api/projects/:projectId/repository', async (request, reply): Promise<ProjectDetail> =>
    runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const body = setProjectRepositorySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      const row = await projectOf(context, projectId);
      if (!managesRepository(actorOf(context, row))) {
        throw repositoryNotYours();
      }
      const connection = await openConnectionOf(context, github);
      if (!(await projectCodeProcessingAllowed(context.client, projectId))) {
        throw repositoryNotAllowedForProject();
      }
      const repository = await repositoryToLink(connection, body.data.repositoryId);
      if (row.repository_id !== null && Number(row.repository_id) === repository.repositoryId) {
        return detailOf(context, row);
      }
      // A change is an unlink and a link: both are written to the audit log.
      await unlinkProjectRepository(context.client, projectId);
      await linkRepository(context, projectId, repository, repositoryNotAllowedForProject);
      return detailOf(context, await projectOf(context, projectId));
    }),
  );

  /**
   * Takes the repository of the project away. Needs no GitHub and works while the company's
   * connection is switched off. Nothing on GitHub is touched. A project without a repository is
   * answered as it is.
   */
  app.delete(
    '/api/projects/:projectId/repository',
    async (request, reply): Promise<ProjectDetail> =>
      runner.withCompany(request, reply, INSIDERS, async (context) => {
        const projectId = projectIdOf(request);
        const row = await projectOf(context, projectId);
        if (!managesRepository(actorOf(context, row))) {
          throw repositoryNotYours();
        }
        if (row.repository_id === null) {
          return detailOf(context, row);
        }
        await unlinkProjectRepository(context.client, projectId);
        return detailOf(context, await projectOf(context, projectId));
      }),
  );

  /**
   * The GitHub tab. Always 200 for a project the person can read: what cannot be shown is a
   * state of the answer, never an error of our own.
   */
  app.get('/api/projects/:projectId/github', async (request, reply): Promise<ProjectGithub> => {
    const read = await runner.withCompany(request, reply, INSIDERS, async (context) => {
      const projectId = projectIdOf(request);
      const row = await projectOf(context, projectId);
      const company = await readCompanyForGithub(context.client);
      return {
        code: company?.kind === 'company' ? company.code : null,
        connection: await readGithubConnection(context.client),
        canLink: managesRepository(actorOf(context, row)),
        // Rule 12, asked on every read: closing a customer's permission stops the reading at once.
        allowed: await projectCodeProcessingAllowed(context.client, projectId),
        linked:
          row.repository_id !== null && row.repository_full_name !== null
            ? { id: Number(row.repository_id), fullName: row.repository_full_name }
            : null,
      };
    });
    // After the transaction: the client of this project's company, and no other.
    const client = read.code !== null ? github.forCompany(read.code) : null;
    const { connection, canLink, allowed, linked } = read;
    const answer = async (): Promise<ProjectGithub> => {
      if (connection?.status !== 'enabled') {
        // Never connected, or switched off: no call is made to GitHub for this company.
        return {
          state: 'not_connected',
          disconnected: connection?.status === 'disabled',
          canLink: false,
        };
      }
      if (linked === null) {
        return client
          ? { state: 'no_repository', canLink, allowed }
          : { state: 'not_connected', disconnected: false, canLink: false };
      }
      // What is known of the repository without asking GitHub: its number and the name it had.
      const stored: LinkedRepository = { ...linked, url: null };
      if (!client) {
        return {
          state: 'unavailable',
          repository: stored,
          canLink,
          reason: 'not_configured',
          retryAt: null,
          last: null,
        };
      }
      if (!allowed) {
        return { state: 'not_allowed', repository: stored, canLink };
      }
      const view = await client.view(connectionRef(connection), linked.id);
      if (view.state === 'ok') {
        return { state: 'ok', repository: view.repository, canLink, lists: view.lists };
      }
      return {
        state: 'unavailable',
        repository: view.repository ?? stored,
        canLink,
        reason: view.reason,
        retryAt: view.retryAtMs !== null ? new Date(view.retryAtMs).toISOString() : null,
        last: view.last,
      };
    };
    return projectGithubSchema.parse(await answer());
  });
}
