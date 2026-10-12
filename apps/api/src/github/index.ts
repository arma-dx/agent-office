import type { GithubAppConfig } from '../env.ts';
import type { GithubLog } from './api.ts';
import { CompanyGithub } from './company.ts';
import { HttpGithubApi } from './http.ts';
import { GithubService } from './service.ts';

export { GithubError } from './api.ts';
export type { GithubApi, GithubLog } from './api.ts';
export { CompanyGithub } from './company.ts';
export type {
  Discovery,
  GithubConnectionRef,
  InstalledApp,
  RepositoryList,
  RepositoryLookup,
  RepositoryView,
} from './company.ts';
export { GithubService } from './service.ts';

/**
 * The GitHub service of an environment: one HTTP client and one company client per configured
 * app, each built with its own app's key and with nothing of the other. With no app configured
 * the service answers "not configured" for every company. Builds objects only: nothing is asked
 * of GitHub here.
 */
export function createGithubService(
  apps: readonly GithubAppConfig[],
  log?: GithubLog,
): GithubService {
  return new GithubService(
    apps.map(
      (app) =>
        new CompanyGithub(
          { companyCode: app.companyCode, organization: app.organization },
          new HttpGithubApi(app, log ? { log } : {}),
          Date.now,
          log,
        ),
    ),
  );
}
