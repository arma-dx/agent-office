import { z } from 'zod';
import type { Queryable } from './queryable.ts';

/**
 * Statements of the GitHub connection of a company (8 October decisions 19 and 22; 12 October
 * decisions 12 to 17). Every statement runs with the caller's restricted role inside the caller's
 * transaction and context, and none of them names a company: each acts on the company of the
 * context, and the row policies do the rest (rule 9). The founder and the employees of a company
 * read its connection row; an external person and another company's people read none.
 *
 * The row is written only by the database's two functions: connecting asks for the founder and
 * for a passkey re-verification recorded in the same transaction, disconnecting for the founder.
 * The row holds no secret (the installation's number is useless without the app's key, which
 * lives in the API's environment).
 */

/** The company of the context, as the GitHub routes need it: which app is its, and is it one. */
export interface CompanyForGithub {
  // companies.code: the name the environment configures the company's GitHub App under.
  code: string;
  // 'company' or 'private_space': GitHub is connected to a company only.
  kind: string;
}

export async function readCompanyForGithub(client: Queryable): Promise<CompanyForGithub | null> {
  const { rows } = await client.query<CompanyForGithub>(
    'select c.code, c.kind from office.companies c where c.id = office.ctx_company_id()',
  );
  return rows[0] ?? null;
}

// What office.github_integration_valid lets a GitHub row hold.
const settingsSchema = z.object({
  installation_id: z.number().int().positive(),
  account_id: z.number().int().positive(),
  app_id: z.number().int().positive(),
  connected_at: z.string(),
});

export interface GithubConnectionRow {
  id: string;
  // The organisation's name as it was at the last connect.
  account: string;
  // 'enabled', or 'disabled' once the founder switched the connection off.
  status: string;
  // The permissions the installation had at the last connect: 'contents:read', ...
  scopes: string[];
  installationId: number;
  accountId: number;
  appId: number;
  connectedAt: Date;
  // null: written without a person (an administrator).
  connectedByUserId: string | null;
}

/** The GitHub connection of the context company, open or switched off; null when there is none. */
export async function readGithubConnection(client: Queryable): Promise<GithubConnectionRow | null> {
  const { rows } = await client.query<{
    id: string;
    account: string;
    status: string;
    scopes: string[];
    settings: unknown;
    connected_by_user_id: string | null;
  }>(
    `select i.id, i.account, i.status, i.scopes, i.settings, i.connected_by_user_id
     from office.integrations i
     where i.provider = 'github' and i.company_id = office.ctx_company_id()`,
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const settings = settingsSchema.parse(row.settings);
  return {
    id: row.id,
    account: row.account,
    status: row.status,
    scopes: row.scopes,
    installationId: settings.installation_id,
    accountId: settings.account_id,
    appId: settings.app_id,
    connectedAt: new Date(settings.connected_at),
    connectedByUserId: row.connected_by_user_id,
  };
}

/** What the API read at GitHub about the installation of the company's app. */
export interface GithubInstallationFacts {
  account: string;
  accountId: number;
  installationId: number;
  appId: number;
  // 'metadata:read', 'contents:read', 'pull_requests:read', 'issues:read'.
  scopes: readonly string[];
}

/**
 * The founder connects the GitHub organisation of the context company (office.connect_github).
 * The database uses up the founder's github_connection re-verification of this transaction;
 * connected already through the same installation it only brings the name and the permissions up
 * to date. It raises 28000 without a re-verification, 42501 for anybody but the founder, 55000
 * when the company was connected to another organisation, 23505 when the organisation or the
 * installation is the connection of another company, 23514 for a row of another shape. Returns
 * the row's id.
 */
export async function connectGithub(
  client: Queryable,
  facts: GithubInstallationFacts,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select office.connect_github($1, $2, $3, $4, $5::text[]) as id',
    [facts.account, facts.accountId, facts.installationId, facts.appId, [...facts.scopes]],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('connect_github returned no row');
  }
  return row.id;
}

/**
 * The founder switches the connection of the context company off (office.disconnect_github); no
 * passkey: it only takes access away. Answers whether a connection was switched off.
 */
export async function disconnectGithub(client: Queryable): Promise<boolean> {
  const { rows } = await client.query<{ done: boolean }>(
    'select office.disconnect_github() as done',
  );
  return rows[0]?.done === true;
}

/** How many projects the reader sees with a repository (for the founder: every such project). */
export async function countLinkedProjects(client: Queryable): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    'select count(*)::int as n from office.project_repositories',
  );
  return rows[0]?.n ?? 0;
}
