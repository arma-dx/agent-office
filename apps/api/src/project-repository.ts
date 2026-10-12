import {
  linkProjectRepository,
  readGithubConnection,
  type GithubConnectionRow,
} from '@agent-office/db';
import type { CompanyContext } from './db.ts';
import { ApiError, databaseErrorCode, databaseErrorConstraint } from './errors.ts';
import type { CompanyGithub, GithubService } from './github/index.ts';
import {
  connectionRef,
  githubCompanyOf,
  githubNotConfigured,
  githubUnavailable,
} from './routes/github.ts';

/**
 * Giving a project a repository of the company's connected GitHub organisation (8 October
 * decision 19; 12 October decision 17): what the two writes share, the new project that names a
 * repository and the change of a project's repository.
 *
 * A request is one transaction (rule 9), and both writes must know before they write that the
 * repository is one the company's installation reaches. Only GitHub knows that, so the company's
 * client is asked inside the transaction: usually its list of the last five minutes answers; on a
 * miss the list is read once more. It is asked before the first write of the request, so no row
 * lock waits on GitHub.
 *
 * The repository is named by GitHub's number only. Its name comes from GitHub's own list, never
 * from the request; a number of the other company's organisation is simply not in the list of
 * this company's installation, and is answered like a number that is nobody's.
 */

export const githubNotConnected = (): ApiError =>
  new ApiError(
    409,
    'github_not_connected',
    "Şirketin GitHub'ı bağlı değil. Kurucu, Ayarlar > Bağlantılar'dan bağlar.",
  );

const repositoryNotAvailable = (): ApiError =>
  new ApiError(
    409,
    'github_repository_not_available',
    'Bu depo, bağlantının gördüğü depolar arasında değil. Listeden başka bir depo seçin.',
  );

/** Rule 12, for a project that is being opened with a repository: nothing is opened. */
export const repositoryNotAllowedForNewProject = (): ApiError =>
  new ApiError(
    409,
    'github_not_allowed',
    'Bu müşterinin sözleşme izinleri kapalı olduğu için depo bağlanamaz. Projeyi depo seçmeden açın; kurucu izinlerden birini açınca depo bağlanabilir.',
  );

/** Rule 12, for a project that exists. */
export const repositoryNotAllowedForProject = (): ApiError =>
  new ApiError(
    409,
    'github_not_allowed',
    'Bu projenin müşterisinin sözleşme izinleri kapalı olduğu için depo bağlanamaz. Kurucu izinlerden birini açınca depo bağlanabilir.',
  );

export const repositoryNotYours = (): ApiError =>
  new ApiError(
    403,
    'project_repository_not_allowed',
    'Projenin deposunu yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.',
  );

const repositoryChanged = (): ApiError =>
  new ApiError(409, 'project_changed', 'Projenin deposu bu sırada değişti. Projeye yeniden bakın.');

/** The open connection of the request's company and the client that asks GitHub for it. */
export interface OpenConnection {
  row: GithubConnectionRow;
  github: CompanyGithub;
}

/**
 * The open GitHub connection of the company of the request: 409 github_not_connected when the
 * company never connected or the connection is switched off, 409 github_not_configured when this
 * environment has no app for the company.
 */
export async function openConnectionOf(
  context: CompanyContext,
  service: GithubService,
): Promise<OpenConnection> {
  const company = await githubCompanyOf(context);
  const row = await readGithubConnection(context.client);
  if (row?.status !== 'enabled') {
    throw githubNotConnected();
  }
  const github = service.forCompany(company.code);
  if (!github) {
    throw githubNotConfigured();
  }
  return { row, github };
}

/** What is written for a project: GitHub's number, GitHub's present name, the company's row. */
export interface RepositoryToLink {
  integrationId: string;
  repositoryId: number;
  fullName: string;
}

/**
 * The repository with this number among the ones the company's installation reaches now: 409
 * github_repository_not_available when it is not, 503 github_unavailable when GitHub cannot be
 * asked.
 */
export async function repositoryToLink(
  { row, github }: OpenConnection,
  repositoryId: number,
): Promise<RepositoryToLink> {
  const lookup = await github.findRepository(connectionRef(row), repositoryId);
  if (lookup.state === 'missing') {
    throw repositoryNotAvailable();
  }
  if (lookup.state === 'unavailable') {
    throw githubUnavailable();
  }
  return { integrationId: row.id, repositoryId, fullName: lookup.repository.fullName };
}

/**
 * Writes the link. The database decides once more who may (the founder, the owner, a manager),
 * that the connection is open and rule 12; a refusal leaves the transaction usable and is told as
 * the API's own error. `notAllowed` is the sentence of rule 12 for the caller's case.
 */
export async function linkRepository(
  context: CompanyContext,
  projectId: string,
  repository: RepositoryToLink,
  notAllowed: () => ApiError,
): Promise<void> {
  const { client } = context;
  await client.query('savepoint link_repository');
  try {
    await linkProjectRepository(client, { projectId, ...repository });
  } catch (error) {
    await client.query('rollback to savepoint link_repository');
    const code = databaseErrorCode(error);
    // object_not_in_prerequisite_state: the customer allows neither AI nor automated processing.
    if (code === '55000') throw notAllowed();
    // insufficient_privilege: the person is not, or no longer, one who may.
    if (code === '42501') throw repositoryNotYours();
    if (code === '23514') {
      // A check of the table (a name of another shape than GitHub's) names its constraint; the
      // trigger, a function, names none: the connection was switched off meanwhile.
      throw databaseErrorConstraint(error) !== undefined
        ? repositoryNotAvailable()
        : githubNotConnected();
    }
    // unique_violation: another request gave the project a repository at the same moment.
    if (code === '23505') throw repositoryChanged();
    throw error;
  }
}
