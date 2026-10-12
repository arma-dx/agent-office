import { z } from 'zod';
import { githubIdSchema, stepUpSchema } from './api.ts';
import { taskPersonSchema } from './tasks.ts';

/**
 * The GitHub connection of a company and the GitHub tab of a project (8 October decisions 17, 19
 * and 22; 12 October decisions 12 to 17).
 *
 * Each company connects its own GitHub organisation once, through its own GitHub App; a project
 * is given one repository of that organisation; the project's "GitHub" tab lists the last
 * commits, the open pull requests and the open issues of it. The connection only reads.
 *
 * Every answer here is for the company of the request and for no other: none of them names a
 * company or carries anything of another company. The panel never calls GitHub: what it shows of
 * GitHub comes from the API, and the only thing that goes to github.com is a link a person clicks.
 */

/** Every address that leaves the API towards GitHub starts with this. */
export const GITHUB_ADDRESS_PREFIX = 'https://github.com/';

// One rule for every address of an answer: the install link, the manage link, a row's link.
const githubAddress = z
  .url()
  .max(2000)
  .refine((url) => url.startsWith(GITHUB_ADDRESS_PREFIX), {
    message: 'Not an address on github.com',
  });
// null: GitHub gave no address, or one that is not on github.com.
const githubUrl = githubAddress.nullable();

/** The four repository permissions the app holds, each read only. */
export const githubPermissionSchema = z.enum(['metadata', 'contents', 'pull_requests', 'issues']);
export type GithubPermission = z.output<typeof githubPermissionSchema>;
export const GITHUB_PERMISSIONS: readonly GithubPermission[] = githubPermissionSchema.options;

/** How the installation was made on GitHub: every repository of the organisation, or chosen ones. */
export const githubRepositorySelectionSchema = z.enum(['all', 'selected']);
export type GithubRepositorySelection = z.output<typeof githubRepositorySelectionSchema>;

/** Why the app, or its installation, is not what the connection needs. */
export const githubInvalidReasonSchema = z.enum([
  // The app is owned by somebody else than the organisation the environment names.
  'owner_mismatch',
  // The app is owned by a person's account, not by an organisation.
  'owner_not_organization',
  'suspended',
  // The installation holds a permission that is not read only, or one outside the four.
  'write_permission',
  'other_permission',
]);
export type GithubInvalidReason = z.output<typeof githubInvalidReasonSchema>;

/** Why the connection of a connected company does not work just now. */
export const githubConnectionProblemSchema = z.enum([
  'installation_gone',
  'suspended',
  'github_down',
  'key_refused',
  'rate_limited',
]);
export type GithubConnectionProblem = z.output<typeof githubConnectionProblemSchema>;

/** GET /api/github/connection (founder): the connection of the company of the request. */
export const githubConnectionSchema = z.discriminatedUnion('state', [
  // This environment has no app for this company.
  z.object({ state: z.literal('not_configured') }),
  // GitHub could not be asked, or refused the app's key.
  z.object({
    state: z.literal('unavailable'),
    reason: z.enum(['github_down', 'key_refused', 'rate_limited']),
  }),
  // The app is not installed on its organisation.
  z.object({
    state: z.literal('not_installed'),
    organization: z.string(),
    installUrl: githubAddress,
  }),
  // The app, or its installation, is not what the connection needs.
  z.object({
    state: z.literal('invalid'),
    // The organisation the environment names for this company.
    organization: z.string(),
    reason: githubInvalidReasonSchema,
    // owner_mismatch: who owns the app on GitHub.
    actualOwner: z.string().nullable(),
    manageUrl: githubUrl,
  }),
  // Installed and acceptable; not connected (never, or switched off).
  z.object({
    state: z.literal('installed'),
    organization: z.string(),
    installationId: githubIdSchema,
    permissions: z.array(githubPermissionSchema),
    repositorySelection: githubRepositorySelectionSchema,
    wasConnected: z.boolean(),
  }),
  z.object({
    state: z.literal('connected'),
    organization: z.string(),
    connectedAt: z.iso.datetime({ offset: true }),
    // null: written without a person (an administrator).
    connectedBy: taskPersonSchema.nullable(),
    permissions: z.array(githubPermissionSchema),
    // null: GitHub could not be asked just now; `problem` says why the connection does not work.
    repositorySelection: githubRepositorySelectionSchema.nullable(),
    repositoryCount: z.number().int().nonnegative().nullable(),
    linkedProjectCount: z.number().int().nonnegative(),
    problem: githubConnectionProblemSchema.nullable(),
    manageUrl: githubUrl,
  }),
]);
export type GithubConnection = z.output<typeof githubConnectionSchema>;

/**
 * POST /api/github/connection (founder): connects the organisation the company's app is installed
 * on. Needs a github_connection re-verification in stepUp for this company and for the
 * organisation and installation the page showed (githubConnectionDetails); 403 step_up_required
 * without it. Answers githubConnectionSchema.
 */
export const connectGithubSchema = z.strictObject({ stepUp: stepUpSchema.optional() });
export type ConnectGithub = z.input<typeof connectGithubSchema>;

/**
 * A repository the company's installation reaches, as the two dialogs offer it: GitHub's number
 * and the name, and nothing beside the name (12 October decision 15: every employee sees the
 * name of every repository; docs/SONRA.md P5-w).
 */
export const githubRepositoryOptionSchema = z.object({
  id: githubIdSchema,
  fullName: z.string().max(200),
});
export type GithubRepositoryOption = z.output<typeof githubRepositoryOptionSchema>;

/** The list reads at most this many repositories of an organisation. */
export const GITHUB_REPOSITORY_LIMIT = 1000;

/** GET /api/github/repositories (founder, employees). `?refresh=1` (founder) reads it again now. */
export const githubRepositoriesSchema = z.discriminatedUnion('state', [
  // Not configured, never connected or switched off: there is nothing to pick.
  z.object({ state: z.literal('not_connected') }),
  z.object({ state: z.literal('unavailable') }),
  z.object({
    state: z.literal('ok'),
    organization: z.string(),
    // By name.
    repositories: z.array(githubRepositoryOptionSchema).max(GITHUB_REPOSITORY_LIMIT),
    // The organisation has more repositories than the list reads.
    truncated: z.boolean(),
    fetchedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type GithubRepositories = z.output<typeof githubRepositoriesSchema>;

export const githubRepositoriesQuerySchema = z.strictObject({
  refresh: z.literal('1').optional(),
});

/** PUT /api/projects/:projectId/repository (the owner, a manager, the founder). */
export const setProjectRepositorySchema = z.strictObject({ repositoryId: githubIdSchema });
export type SetProjectRepository = z.input<typeof setProjectRepositorySchema>;

// The "GitHub" tab ----------------------------------------------------------------------------------

/** Each of the three lists shows at most this many rows. */
export const GITHUB_LIST_LIMIT = 20;

// A GitHub user name (12 October decision 16), never the name or the address written inside a
// commit. null: GitHub names no account.
const githubAuthor = z.string().max(100).nullable();

export const githubCommitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  // The first line of the message, as plain text.
  title: z.string().max(200),
  author: githubAuthor,
  date: z.iso.datetime({ offset: true }).nullable(),
  url: githubUrl,
});
export type GithubCommit = z.output<typeof githubCommitSchema>;

export const githubPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(300),
  author: githubAuthor,
  createdAt: z.iso.datetime({ offset: true }),
  draft: z.boolean(),
  url: githubUrl,
});
export type GithubPullRequest = z.output<typeof githubPullRequestSchema>;

export const githubIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(300),
  author: githubAuthor,
  createdAt: z.iso.datetime({ offset: true }),
  url: githubUrl,
});
export type GithubIssue = z.output<typeof githubIssueSchema>;

/** null: this list could not be read. `more`: GitHub has more than the page shows. */
const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item).max(GITHUB_LIST_LIMIT), more: z.boolean() }).nullable();

/** What GitHub shows of one repository: when it was read, and the three lists. */
export const githubListsSchema = z.object({
  fetchedAt: z.iso.datetime({ offset: true }),
  defaultBranch: z.string().max(255).nullable(),
  private: z.boolean(),
  archived: z.boolean(),
  commits: listOf(githubCommitSchema),
  pullRequests: listOf(githubPullRequestSchema),
  issues: listOf(githubIssueSchema),
});
export type GithubLists = z.output<typeof githubListsSchema>;

/** The repository of a project: GitHub's number, its name, and its page on github.com. */
export const linkedRepositorySchema = z.object({
  id: githubIdSchema,
  fullName: z.string().max(200),
  url: githubUrl,
});
export type LinkedRepository = z.output<typeof linkedRepositorySchema>;

/** Why the lists of a linked repository cannot be read just now. */
export const projectGithubUnavailableReasonSchema = z.enum([
  // The app was removed or suspended on GitHub.
  'installation_gone',
  // The repository is no longer among the ones the installation reaches.
  'repository_gone',
  'rate_limited',
  'github_down',
  // This environment has no app for the company.
  'not_configured',
]);
export type ProjectGithubUnavailableReason = z.output<typeof projectGithubUnavailableReasonSchema>;

/**
 * GET /api/projects/:projectId/github (whoever reads the project). Always 200 for a project the
 * person can read. `canLink`: the reader may give, change or remove the repository.
 */
export const projectGithubSchema = z
  .discriminatedUnion('state', [
    // The company is not connected: never, or (`disconnected`) the connection was switched off.
    // A repository the project was given stays linked and comes back with the connection.
    z.object({
      state: z.literal('not_connected'),
      disconnected: z.boolean(),
      canLink: z.literal(false),
    }),
    // Connected; the project has no repository. `allowed` false: rule 12 lets none be linked.
    z.object({ state: z.literal('no_repository'), canLink: z.boolean(), allowed: z.boolean() }),
    // Rule 12: the customer of the project allows neither AI nor automated processing.
    z.object({
      state: z.literal('not_allowed'),
      repository: linkedRepositorySchema,
      canLink: z.boolean(),
    }),
    z.object({
      state: z.literal('unavailable'),
      repository: linkedRepositorySchema,
      canLink: z.boolean(),
      reason: projectGithubUnavailableReasonSchema,
      // rate_limited: when GitHub takes requests again.
      retryAt: z.iso.datetime({ offset: true }).nullable(),
      // The last lists the API still holds, with their time; null when it has none.
      last: githubListsSchema.nullable(),
    }),
    z.object({
      state: z.literal('ok'),
      repository: linkedRepositorySchema,
      canLink: z.boolean(),
      lists: githubListsSchema,
    }),
  ])
  // Nothing is shown once access is gone: the last lists go only with a reason that says GitHub
  // itself cannot be asked.
  .refine(
    (answer) =>
      answer.state !== 'unavailable' ||
      answer.last === null ||
      answer.reason === 'rate_limited' ||
      answer.reason === 'github_down',
    { message: 'The last lists are served only while GitHub cannot be asked', path: ['last'] },
  );
export type ProjectGithub = z.output<typeof projectGithubSchema>;
