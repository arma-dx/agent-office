import type { CompanyGithub } from './company.ts';

/**
 * Hands a route the GitHub client of its company, and nothing else: no method here reads a cache
 * or calls GitHub. A route asks with the short code of the company of its request (read from the
 * database in the request's transaction); a company without a configured app gets null ("not
 * configured"). There is no way to ask for "the" GitHub connection without a company, and no way
 * to reach the client that holds another company's key.
 */
export class GithubService {
  readonly #companies: ReadonlyMap<string, CompanyGithub>;

  constructor(companies: Iterable<CompanyGithub>) {
    const map = new Map<string, CompanyGithub>();
    for (const company of companies) {
      if (map.has(company.companyCode)) {
        throw new Error('Two GitHub apps are configured for one company');
      }
      map.set(company.companyCode, company);
    }
    this.#companies = map;
  }

  forCompany(companyCode: string): CompanyGithub | null {
    return this.#companies.get(companyCode) ?? null;
  }

  /** The company codes that have an app configured (for the start-up log line). */
  get companyCodes(): string[] {
    return [...this.#companies.keys()];
  }
}
