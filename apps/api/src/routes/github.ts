import {
  connectGithub,
  countLinkedProjects,
  disconnectGithub,
  peopleNames,
  readCompanyForGithub,
  readGithubConnection,
  type CompanyForGithub,
  type GithubConnectionRow,
} from '@agent-office/db';
import {
  connectGithubSchema,
  githubConnectionDetails,
  githubConnectionSchema,
  githubPermissionSchema,
  githubRepositoriesQuerySchema,
  githubRepositoriesSchema,
  type GithubConnection,
  type GithubPermission,
  type GithubRepositories,
  type TaskPerson,
} from '@agent-office/shared';
import type { FastifyInstance } from 'fastify';
import { founderOnly, type CompanyContext } from '../db.ts';
import { ApiError, databaseErrorCode, databaseErrorConstraint, invalidRequest } from '../errors.ts';
import type { CompanyGithub, Discovery, GithubConnectionRef } from '../github/index.ts';
import { stepUpRequired, verifyStepUp } from '../passkeys.ts';
import type { RouteDeps } from '../services.ts';

/**
 * The GitHub connection of a company (8 October decisions 19 and 22; 12 October decisions 12 to
 * 15): each company connects its own GitHub organisation once, from its settings.
 *
 *   GET    /api/github/connection   the founder reads the connection of the company
 *   POST   /api/github/connection   the founder connects, with a passkey
 *   DELETE /api/github/connection   the founder switches the connection off
 *   GET    /api/github/repositories the founder and the employees read the repositories of the
 *                                   connected organisation, to pick one for a project
 *
 * Every route answers for the company of the request and for no other. The company's short code
 * is read from the database in the request's transaction and is the only thing the GitHub client
 * is chosen by: nothing the browser sends names an app, an installation or an organisation.
 *
 * A request is one transaction (rule 9). What the reads tell of GitHub is asked after it has
 * ended. Connecting asks GitHub first, inside the transaction and before the passkey is checked,
 * so that a passkey is never spent on a GitHub failure: the founder signs for the organisation
 * and the installation the page showed, and the route builds the same from what GitHub answers at
 * that moment.
 *
 * The connection routes are for the founder: an external person is refused as on every screen
 * of the section, an employee is told that the act is the founder's.
 *
 * The list of repositories is every founder's and employee's of the company (12 October decision
 * 15: every employee sees the name of every repository of the organisation, whether or not that
 * person can see the repository on GitHub): the names and nothing beside them. Never an external
 * person's, and never the other company's: the list is asked with the app of the request's
 * company and kept in that company's client.
 */

const INSIDERS = { founderOnly: false, insidersOnly: true } as const;

const INSTALLATION_KEY = 'integrations_github_installation';
const ACCOUNT_KEY = 'integrations_github_account';
const ONE_CONNECTION_KEY = 'integrations_one_github';

const privateSpace = (): ApiError =>
  new ApiError(
    409,
    'private_space',
    'GitHub bir şirkete bağlanır. Şirket seçiciden bir şirket seçin.',
  );

export const githubNotConfigured = (): ApiError =>
  new ApiError(
    409,
    'github_not_configured',
    'Bu ortamda bu şirket için GitHub uygulaması ayarlı değil.',
  );

const notInstalled = (): ApiError =>
  new ApiError(
    409,
    'github_not_installed',
    "GitHub uygulaması kuruluşa henüz kurulmamış. Önce GitHub'da kurun, sonra yeniden deneyin.",
  );

const installationInvalid = (): ApiError =>
  new ApiError(
    409,
    'github_installation_invalid',
    'GitHub uygulaması bu haliyle bağlanamaz. Sayfayı yenileyin; neyin düzeltilmesi gerektiği orada yazar.',
  );

const otherOrganization = (): ApiError =>
  new ApiError(
    409,
    'github_other_organization',
    'Bu şirket daha önce başka bir GitHub kuruluşuna bağlanmış. Kuruluş panelden değiştirilemez.',
  );

const organizationTaken = (): ApiError =>
  new ApiError(
    409,
    'github_organization_taken',
    'Bu GitHub kuruluşu başka bir şirkete bağlı. Her şirket kendi kuruluşuna bağlanır; sunucudaki ayar denetlenmeli.',
  );

const connectionChanged = (): ApiError =>
  new ApiError(
    409,
    'github_connection_changed',
    'Bağlantı bu sırada değişti. Sayfayı yenileyip yeniden deneyin.',
  );

export const githubUnavailable = (): ApiError =>
  new ApiError(503, 'github_unavailable', "GitHub'a ulaşılamadı. Biraz sonra yeniden deneyin.");

function requireFounder(context: CompanyContext): void {
  if (context.role !== 'founder') {
    throw founderOnly();
  }
}

/** The company of the request, as GitHub is connected to one: never the founder space. */
export async function githubCompanyOf(context: CompanyContext): Promise<CompanyForGithub> {
  const company = await readCompanyForGithub(context.client);
  if (company?.kind !== 'company') {
    throw privateSpace();
  }
  return company;
}

/** The open connection of a company, as the GitHub client takes it. */
export function connectionRef(row: GithubConnectionRow): GithubConnectionRef {
  return { installationId: row.installationId, accountId: row.accountId };
}

// 'contents:read' -> 'contents'; anything the contract does not know is left out.
function permissionsOf(scopes: readonly string[]): GithubPermission[] {
  return scopes.flatMap((scope) => {
    const parsed = githubPermissionSchema.safeParse(scope.replace(/:read$/, ''));
    return parsed.success ? [parsed.data] : [];
  });
}

/** What the request's transaction read of the company's connection. */
interface ConnectionRead {
  company: CompanyForGithub;
  row: GithubConnectionRow | null;
  linkedProjectCount: number;
  connectedBy: TaskPerson | null;
}

async function readConnection(context: CompanyContext): Promise<ConnectionRead> {
  const { client } = context;
  const company = await githubCompanyOf(context);
  const row = await readGithubConnection(client);
  const by = row?.connectedByUserId ?? null;
  const names = by !== null ? await peopleNames(client, [by]) : new Map<string, string>();
  return {
    company,
    row,
    linkedProjectCount: await countLinkedProjects(client),
    connectedBy: by !== null ? { userId: by, name: names.get(by) ?? null } : null,
  };
}

/**
 * The state of the Bağlantılar page, from the row the transaction read and from what GitHub says
 * now. Called after the transaction has ended. A read never changes the row: a connection whose
 * installation is gone stays "connected" with its problem named, until the founder disconnects.
 */
async function connectionAnswer(
  github: CompanyGithub | null,
  read: ConnectionRead,
  discovered?: Discovery,
): Promise<GithubConnection> {
  if (!github) {
    return { state: 'not_configured' };
  }
  const { row } = read;
  const discovery = discovered ?? (await github.discover());
  if (row?.status !== 'enabled') {
    if (discovery.state === 'unavailable') {
      return discovery;
    }
    if (discovery.state === 'not_installed') {
      return { ...discovery, organization: github.organization };
    }
    if (discovery.state === 'invalid') {
      return { ...discovery, organization: github.organization };
    }
    const { installation } = discovery;
    return {
      state: 'installed',
      organization: installation.organization,
      installationId: installation.installationId,
      permissions: installation.permissions,
      repositorySelection: installation.repositorySelection,
      wasConnected: row !== null,
    };
  }
  const connected: Extract<GithubConnection, { state: 'connected' }> = {
    state: 'connected',
    organization: row.account,
    connectedAt: row.connectedAt.toISOString(),
    connectedBy: read.connectedBy,
    permissions: permissionsOf(row.scopes),
    repositorySelection: null,
    repositoryCount: null,
    linkedProjectCount: read.linkedProjectCount,
    problem: null,
    manageUrl: null,
  };
  if (discovery.state === 'unavailable') {
    return { ...connected, problem: discovery.reason };
  }
  if (discovery.state === 'not_installed') {
    return { ...connected, problem: 'installation_gone' };
  }
  if (discovery.state === 'invalid') {
    // An app that is no longer the organisation's own gives no access to the row's installation.
    return {
      ...connected,
      problem: discovery.reason === 'suspended' ? 'suspended' : 'installation_gone',
      manageUrl: discovery.manageUrl,
    };
  }
  const { installation } = discovery;
  if (installation.installationId !== row.installationId) {
    // Installed again on GitHub: a new installation with a new number, which the row does not
    // name. The founder disconnects and connects again, with the passkey.
    return { ...connected, problem: 'installation_gone', manageUrl: installation.manageUrl };
  }
  const list = await github.repositories(connectionRef(row));
  return {
    ...connected,
    organization: installation.organization,
    permissions: installation.permissions,
    repositorySelection: installation.repositorySelection,
    manageUrl: installation.manageUrl,
    ...(list.state === 'ok'
      ? { repositoryCount: list.repositories.length }
      : { problem: list.reason }),
  };
}

export function registerGithubRoutes(
  app: FastifyInstance,
  { runner, config, github }: RouteDeps,
): void {
  const relyingParty = config.relyingParty;

  app.get('/api/github/connection', async (request, reply): Promise<GithubConnection> => {
    const read = await runner.withCompany(request, reply, INSIDERS, async (context) => {
      requireFounder(context);
      return readConnection(context);
    });
    // After the transaction: GitHub is asked through the client of this company only.
    return githubConnectionSchema.parse(
      await connectionAnswer(github.forCompany(read.company.code), read),
    );
  });

  /**
   * Connects the organisation the company's app is installed on (decision 19), with a passkey
   * (decision 22). In order: what GitHub says of the installation, asked now and with the app's
   * own signature; the founder's re-verification for exactly that organisation and installation
   * in exactly this company; the database's own function, which uses the re-verification up. A
   * company that is connected through the same installation already is only brought up to date
   * and asks for no passkey.
   */
  app.post('/api/github/connection', async (request, reply): Promise<GithubConnection> => {
    const done = await runner.withCompany(request, reply, INSIDERS, async (context) => {
      requireFounder(context);
      const body = connectGithubSchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw invalidRequest();
      }
      const { client, session, companyId } = context;
      const company = await githubCompanyOf(context);
      const companyGithub = github.forCompany(company.code);
      if (!companyGithub) {
        throw githubNotConfigured();
      }
      const discovery = await companyGithub.discover({ fresh: true });
      if (discovery.state === 'unavailable') {
        throw githubUnavailable();
      }
      if (discovery.state === 'not_installed') {
        throw notInstalled();
      }
      if (discovery.state === 'invalid') {
        throw installationInvalid();
      }
      const { installation } = discovery;
      const before = await readGithubConnection(client);
      const sameInstallation =
        before?.status === 'enabled' && before.installationId === installation.installationId;
      if (!sameInstallation) {
        await verifyStepUp({ client, session }, relyingParty, body.data.stepUp, {
          purpose: 'github_connection',
          companyId,
          subjectId: companyId,
          details: githubConnectionDetails(installation.organization, installation.installationId),
        });
      }
      await client.query('savepoint connect_github');
      try {
        await connectGithub(client, {
          account: installation.organization,
          accountId: installation.accountId,
          installationId: installation.installationId,
          appId: installation.appId,
          scopes: installation.permissions.map((permission) => `${permission}:read`),
        });
      } catch (error) {
        await client.query('rollback to savepoint connect_github');
        const code = databaseErrorCode(error);
        const constraint = databaseErrorConstraint(error);
        // invalid_authorization_specification: no re-verification for this company.
        if (code === '28000') throw stepUpRequired();
        // insufficient_privilege: the person is no longer the founder.
        if (code === '42501') throw founderOnly();
        // object_not_in_prerequisite_state: connected before to another organisation.
        if (code === '55000') throw otherOrganization();
        if (code === '23505') {
          if (constraint === INSTALLATION_KEY || constraint === ACCOUNT_KEY) {
            throw organizationTaken();
          }
          // Another request of the founder connected the company at the same moment.
          if (constraint === ONE_CONNECTION_KEY) throw connectionChanged();
        }
        // check_violation: a name or a permission the row does not take.
        if (code === '23514') throw installationInvalid();
        throw error;
      }
      return { read: await readConnection(context), discovery };
    });
    return githubConnectionSchema.parse(
      await connectionAnswer(github.forCompany(done.read.company.code), done.read, done.discovery),
    );
  });

  /**
   * Switches the connection of the company off (no passkey: it only takes access away). From
   * then on no call is made to GitHub for this company's repositories; what the client held of
   * them is dropped. The repositories of the projects stay linked, and the app stays installed on
   * GitHub. A second call changes nothing.
   */
  app.delete('/api/github/connection', async (request, reply): Promise<GithubConnection> => {
    const done = await runner.withCompany(request, reply, INSIDERS, async (context) => {
      requireFounder(context);
      const company = await githubCompanyOf(context);
      const before = await readGithubConnection(context.client);
      await context.client.query('savepoint disconnect_github');
      try {
        await disconnectGithub(context.client);
      } catch (error) {
        await context.client.query('rollback to savepoint disconnect_github');
        if (databaseErrorCode(error) === '42501') throw founderOnly();
        throw error;
      }
      return { company, before, read: await readConnection(context) };
    });
    const client = github.forCompany(done.company.code);
    client?.forget(done.before?.installationId ?? null);
    return githubConnectionSchema.parse(await connectionAnswer(client, done.read));
  });
  /**
   * The repositories of the connected organisation, by name (decision 15). Read live from GitHub
   * and kept five minutes in the memory of the company's client; nothing of it is stored.
   * `?refresh=1` reads it again now (the founder's "Listeyi yenile"; at most once in ten seconds).
   * A company that is not connected is answered so, and no call is made to GitHub.
   */
  app.get('/api/github/repositories', async (request, reply): Promise<GithubRepositories> => {
    const read = await runner.withCompany(request, reply, INSIDERS, async (context) => {
      const query = githubRepositoriesQuerySchema.safeParse(request.query);
      if (!query.success) {
        throw invalidRequest();
      }
      const refresh = query.data.refresh === '1';
      if (refresh) {
        requireFounder(context);
      }
      return {
        company: await githubCompanyOf(context),
        row: await readGithubConnection(context.client),
        refresh,
      };
    });
    const client = github.forCompany(read.company.code);
    if (!client || read.row?.status !== 'enabled') {
      return githubRepositoriesSchema.parse({ state: 'not_connected' });
    }
    const list = await client.repositories(connectionRef(read.row), { refresh: read.refresh });
    if (list.state !== 'ok') {
      return githubRepositoriesSchema.parse({ state: 'unavailable' });
    }
    return githubRepositoriesSchema.parse({
      state: 'ok',
      organization: read.row.account,
      // The number and the name, and nothing beside the name.
      repositories: list.repositories.map((repository) => ({
        id: repository.id,
        fullName: repository.fullName,
      })),
      truncated: list.truncated,
      fetchedAt: new Date(list.fetchedAtMs).toISOString(),
    });
  });
}
