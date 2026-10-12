import { createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { GithubAppConfig } from '../src/env.ts';
import { GithubError, type GithubLog, type GithubRepository } from '../src/github/api.ts';
import {
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  GITHUB_CALL_TIMEOUT_MS,
  GITHUB_USER_AGENT,
  HttpGithubApi,
} from '../src/github/http.ts';

// The HTTP client of ONE GitHub App, against a recording fetch: no request leaves the process.
// The key pairs are made here, and so are the tokens the recorded GitHub hands out: no line of
// the repository holds the shape of a key or of a token.

interface Sent {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
  redirect: string | undefined;
  hasSignal: boolean;
}

// Every request any client of this file ever sent (the last test reads it).
const EVERYTHING: Sent[] = [];

type Handler = (sent: Sent) => Response | undefined;

const NOW = Date.parse('2026-10-12T09:00:00Z');
const OWNER = { id: 1001, login: 'arma-org', type: 'Organization' };
const INSTALLATION_ID = 5001;
const REPOSITORY: GithubRepository = {
  id: 700,
  name: 'panel',
  fullName: 'arma-org/panel',
  private: true,
  archived: false,
  defaultBranch: 'main',
  htmlUrl: 'https://github.com/arma-org/panel',
  owner: { id: 1001, login: 'arma-org' },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-github-request-id': 'AB12:CD34', ...headers },
  });

const installationJson = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: INSTALLATION_ID,
  app_id: 9001,
  account: { ...OWNER, avatar_url: 'https://avatars.example.test/1' },
  target_type: 'Organization',
  suspended_at: null,
  permissions: { metadata: 'read', contents: 'read', pull_requests: 'read', issues: 'read' },
  repository_selection: 'all',
  html_url: 'https://github.com/organizations/arma-org/settings/installations/5001',
  ...overrides,
});

class RecordedGithub {
  readonly sent: Sent[] = [];
  readonly log: { level: string; details: Record<string, unknown>; message: string }[] = [];
  ms = NOW;
  tokens = 0;
  installation: Record<string, unknown> | null = installationJson();
  // Tried first; what it leaves unanswered falls to the standard answers below.
  handler: Handler = () => undefined;
  readonly key: KeyObject;
  readonly publicKey: KeyObject;
  readonly client: HttpGithubApi;

  constructor(app: Partial<GithubAppConfig> = {}) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.key = pair.privateKey;
    this.publicKey = pair.publicKey;
    const logger: GithubLog = {
      warn: (details, message) => this.log.push({ level: 'warn', details, message }),
      error: (details, message) => this.log.push({ level: 'error', details, message }),
    };
    this.client = new HttpGithubApi(
      {
        companyCode: 'armadx',
        organization: 'arma-org',
        clientId: 'Iv23client-arma',
        privateKey: pair.privateKey,
        ...app,
      },
      { fetch: this.fetch, now: () => this.ms, log: logger },
    );
  }

  /** The token the recorded GitHub hands out for its n-th token request. */
  token(n = this.tokens): string {
    return ['installation', 'token', String(n)].join('-');
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const sent: Sent = {
      method: init?.method ?? 'GET',
      url,
      headers,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      redirect: init?.redirect,
      hasSignal: init?.signal instanceof AbortSignal,
    };
    this.sent.push(sent);
    EVERYTHING.push(sent);
    try {
      return Promise.resolve(this.handler(sent) ?? this.#standard(sent));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('fetch failed'));
    }
  };

  #standard(sent: Sent): Response {
    const path = sent.url.pathname;
    if (path === '/app') {
      return json({ id: 9001, slug: 'arma-office', client_id: 'Iv23client-arma', owner: OWNER });
    }
    if (path === `/app/installations/${String(INSTALLATION_ID)}`) {
      return this.installation ? json(this.installation) : json({ message: 'Not Found' }, 404);
    }
    if (path === `/app/installations/${String(INSTALLATION_ID)}/access_tokens`) {
      this.tokens += 1;
      return json(
        { token: this.token(), expires_at: new Date(this.ms + 3_600_000).toISOString() },
        201,
      );
    }
    return json({ message: 'Not Found' }, 404);
  }

  paths(): string[] {
    return this.sent.map((sent) => `${sent.method} ${sent.url.pathname}`);
  }

  bearer(sent: Sent): string {
    return (sent.headers.authorization ?? '').replace(/^Bearer /, '');
  }
}

function verifies(jwt: string, publicKey: KeyObject): boolean {
  const [header = '', claims = '', signature = ''] = jwt.split('.');
  return createVerify('RSA-SHA256')
    .update(`${header}.${claims}`)
    .verify(publicKey, Buffer.from(signature, 'base64url'));
}

async function failure(promise: Promise<unknown>): Promise<GithubError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GithubError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the call to fail');
}

const COMMITS = [
  {
    sha: 'a'.repeat(40),
    commit: {
      message: 'Fix the sign-in page\n\nDetails below.',
      author: { name: 'Ayşe Kaya', email: 'ayse@example.test', date: '2026-10-11T08:00:00Z' },
      committer: { name: 'Ayşe Kaya', email: 'ayse@example.test', date: '2026-10-11T08:00:00Z' },
    },
    author: { login: 'ayse-k', id: 1, avatar_url: 'https://avatars.example.test/2' },
    html_url: `https://github.com/arma-org/panel/commit/${'a'.repeat(40)}`,
  },
  {
    // A commit tied to no GitHub account, with a link that is not on github.com.
    sha: 'b'.repeat(40),
    commit: {
      message: 'Typed on a laptop',
      author: { name: 'Mehmet Demir', email: 'mehmet@example.test', date: 'yesterday' },
    },
    author: null,
    html_url: 'https://evil.example.test/commit',
  },
];

describe('what the client sends', () => {
  it('every request names the API version, a user agent and the JSON type, and follows no redirect by itself', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname === '/installation/repositories'
        ? json({ total_count: 0, repositories: [] })
        : undefined;
    await github.client.app();
    await github.client.repositories(INSTALLATION_ID);
    expect(github.sent.length).toBeGreaterThan(2);
    for (const sent of github.sent) {
      expect(sent.url.origin).toBe(GITHUB_API_ORIGIN);
      expect(sent.headers.accept).toBe('application/vnd.github+json');
      expect(sent.headers['x-github-api-version']).toBe(GITHUB_API_VERSION);
      expect(sent.headers['user-agent']).toBe(GITHUB_USER_AGENT);
      expect(sent.headers.authorization).toMatch(/^Bearer \S+$/);
      expect(sent.redirect).toBe('manual');
      expect(sent.hasSignal).toBe(true);
    }
    expect(GITHUB_CALL_TIMEOUT_MS).toBe(5000);
  });

  it('signs as the app with its own key, and uses one signature for five minutes', async () => {
    const github = new RecordedGithub();
    await github.client.app();
    github.ms += 299_000;
    await github.client.app();
    const [first, second] = github.sent.map((sent) => github.bearer(sent));
    expect(first).toBe(second);
    expect(verifies(first ?? '', github.publicKey)).toBe(true);
    github.ms += 2_000;
    await github.client.app();
    const third = github.bearer(github.sent[2] as Sent);
    expect(third).not.toBe(first);
    expect(verifies(third, github.publicKey)).toBe(true);
  });

  it('two clients sign with their own keys', async () => {
    const arma = new RecordedGithub();
    const pillika = new RecordedGithub({ companyCode: 'pillika', clientId: 'Iv23client-pillika' });
    await arma.client.app();
    await pillika.client.app();
    const armaJwt = arma.bearer(arma.sent[0] as Sent);
    const pillikaJwt = pillika.bearer(pillika.sent[0] as Sent);
    expect(verifies(armaJwt, arma.publicKey)).toBe(true);
    expect(verifies(pillikaJwt, pillika.publicKey)).toBe(true);
    expect(verifies(armaJwt, pillika.publicKey)).toBe(false);
    expect(verifies(pillikaJwt, arma.publicKey)).toBe(false);
    const issuer = (jwt: string): unknown =>
      (JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as { iss: unknown })
        .iss;
    expect(issuer(armaJwt)).toBe('Iv23client-arma');
    expect(issuer(pillikaJwt)).toBe('Iv23client-pillika');
    // Each client sent its own requests only.
    expect(arma.sent).toHaveLength(1);
    expect(pillika.sent).toHaveLength(1);
  });

  it('asks for a token with the four read permissions and without naming repositories', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname === '/installation/repositories'
        ? json({ total_count: 0, repositories: [] })
        : undefined;
    await github.client.repositories(INSTALLATION_ID);
    expect(github.paths()).toEqual([
      'GET /app/installations/5001',
      'POST /app/installations/5001/access_tokens',
      'GET /installation/repositories',
    ]);
    const [read, request, list] = github.sent as [Sent, Sent, Sent];
    // The installation is read and the token is asked for as the app.
    expect(verifies(github.bearer(read), github.publicKey)).toBe(true);
    expect(verifies(github.bearer(request), github.publicKey)).toBe(true);
    expect(request.body).toEqual({
      permissions: { metadata: 'read', contents: 'read', pull_requests: 'read', issues: 'read' },
    });
    // The list is asked with the token, never with the app's signature.
    expect(github.bearer(list)).toBe(github.token(1));
    expect(list.url.searchParams.get('per_page')).toBe('100');
  });

  it('cuts the token to what the installation has, and never asks for more than read', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname === '/installation/repositories'
        ? json({ total_count: 0, repositories: [] })
        : undefined;
    // No issues permission; contents was widened to write on GitHub; one permission outside.
    github.installation = installationJson({
      permissions: { metadata: 'read', contents: 'write', pull_requests: 'read', actions: 'write' },
    });
    await github.client.repositories(INSTALLATION_ID);
    expect(github.sent[1]?.body).toEqual({
      permissions: { metadata: 'read', contents: 'read', pull_requests: 'read' },
    });
  });

  it('keeps a token until five minutes before its end, then asks again', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname === '/installation/repositories'
        ? json({ total_count: 0, repositories: [] })
        : undefined;
    const tokenRequests = (): number =>
      github.sent.filter((sent) => sent.url.pathname.endsWith('/access_tokens')).length;
    await github.client.repositories(INSTALLATION_ID);
    github.ms += 54 * 60_000;
    await github.client.repositories(INSTALLATION_ID);
    expect(tokenRequests()).toBe(1);
    github.ms += 2 * 60_000;
    await github.client.repositories(INSTALLATION_ID);
    expect(tokenRequests()).toBe(2);
    expect(github.bearer(github.sent.at(-1) as Sent)).toBe(github.token(2));
    // Told to forget: the next call asks for a new one.
    github.client.forget(INSTALLATION_ID);
    await github.client.repositories(INSTALLATION_ID);
    expect(tokenRequests()).toBe(3);
  });

  it('asks for one token when several calls begin together', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname === '/installation/repositories'
        ? json({ total_count: 0, repositories: [] })
        : undefined;
    await Promise.all([
      github.client.repositories(INSTALLATION_ID),
      github.client.repositories(INSTALLATION_ID),
      github.client.repositories(INSTALLATION_ID),
    ]);
    expect(github.sent.filter((sent) => sent.method === 'POST')).toHaveLength(1);
  });

  it('builds the address of a list from the owner and the name GitHub gave, encoded', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) => (sent.url.pathname.startsWith('/repos/') ? json([]) : undefined);
    const odd = { ...REPOSITORY, name: 'a b/../c?x=1', owner: { id: 1001, login: 'arma org' } };
    await github.client.commits(INSTALLATION_ID, odd, null);
    await github.client.pullRequests(INSTALLATION_ID, REPOSITORY, null);
    await github.client.issues(INSTALLATION_ID, REPOSITORY, null);
    const lists = github.sent.filter((sent) => sent.url.pathname.startsWith('/repos/'));
    expect(lists.map((sent) => sent.url.pathname)).toEqual([
      '/repos/arma%20org/a%20b%2F..%2Fc%3Fx%3D1/commits',
      '/repos/arma-org/panel/pulls',
      '/repos/arma-org/panel/issues',
    ]);
    expect(lists.map((sent) => sent.url.search)).toEqual([
      '?per_page=20',
      '?state=open&per_page=20',
      '?state=open&per_page=50',
    ]);
  });
});

describe('what the client takes from an answer', () => {
  it('the app and its owner', async () => {
    const github = new RecordedGithub();
    expect(await github.client.app()).toEqual({ id: 9001, slug: 'arma-office', owner: OWNER });
  });

  it('the installations, read to the end of the list', async () => {
    const github = new RecordedGithub();
    const strangers = Array.from({ length: 100 }, (_, index) =>
      installationJson({
        id: 8000 + index,
        account: { id: 3000 + index, login: `stranger-${String(index)}`, type: 'User' },
      }),
    );
    github.handler = (sent) => {
      if (sent.url.pathname !== '/app/installations') {
        return undefined;
      }
      return sent.url.searchParams.get('page') === '1'
        ? json(strangers)
        : json([installationJson({ html_url: 'https://evil.example.test/x' })]);
    };
    const installations = await github.client.installations();
    expect(installations).toHaveLength(101);
    expect(github.sent.map((sent) => sent.url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(installations.at(-1)).toEqual({
      id: INSTALLATION_ID,
      appId: 9001,
      account: OWNER,
      targetType: 'Organization',
      suspendedAt: null,
      permissions: { metadata: 'read', contents: 'read', pull_requests: 'read', issues: 'read' },
      repositorySelection: 'all',
      // An address that is not on github.com is no link.
      htmlUrl: null,
    });
  });

  it('the repositories of the installation, and whether there are more than it read', async () => {
    const github = new RecordedGithub();
    const repository = (id: number): Record<string, unknown> => ({
      id,
      name: `repo-${String(id)}`,
      full_name: `arma-org/repo-${String(id)}`,
      private: id % 2 === 0,
      archived: false,
      default_branch: 'main',
      html_url: `https://github.com/arma-org/repo-${String(id)}`,
      owner: { id: 1001, login: 'arma-org', type: 'Organization' },
      description: 'Not taken',
    });
    github.handler = (sent) => {
      if (sent.url.pathname !== '/installation/repositories') {
        return undefined;
      }
      const page = Number(sent.url.searchParams.get('page'));
      return json({
        total_count: 1500,
        repositories: Array.from({ length: 100 }, (_, index) => repository(page * 1000 + index)),
      });
    };
    const { repositories, truncated } = await github.client.repositories(INSTALLATION_ID);
    // Ten pages at most.
    expect(repositories).toHaveLength(1000);
    expect(truncated).toBe(true);
    expect(repositories[0]).toEqual({
      id: 1000,
      name: 'repo-1000',
      fullName: 'arma-org/repo-1000',
      private: true,
      archived: false,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/arma-org/repo-1000',
      owner: { id: 1001, login: 'arma-org' },
    });
  });

  it('a commit without the address and the name written inside it', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname.endsWith('/commits')
        ? json(COMMITS, 200, {
            etag: '"commits-1"',
            link: '<https://api.github.com/x?page=2>; rel="next"',
          })
        : undefined;
    const answer = await github.client.commits(INSTALLATION_ID, REPOSITORY, null);
    expect(answer).toEqual({
      changed: true,
      etag: '"commits-1"',
      more: true,
      items: [
        {
          sha: 'a'.repeat(40),
          message: 'Fix the sign-in page\n\nDetails below.',
          authorLogin: 'ayse-k',
          date: '2026-10-11T08:00:00Z',
          htmlUrl: `https://github.com/arma-org/panel/commit/${'a'.repeat(40)}`,
        },
        // No GitHub account: nobody is named. A date of another shape and a link that is not
        // on github.com are dropped.
        {
          sha: 'b'.repeat(40),
          message: 'Typed on a laptop',
          authorLogin: null,
          date: null,
          htmlUrl: null,
        },
      ],
    });
    const text = JSON.stringify(answer);
    for (const never of ['example.test', 'Ayşe Kaya', 'Mehmet Demir', 'avatars']) {
      expect(text).not.toContain(never);
    }
  });

  it('pull requests, and issues with the pull requests among them marked', async () => {
    const github = new RecordedGithub();
    const row = (number: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      number,
      title: `Title ${String(number)}`,
      user: { login: 'mehmet', email: 'mehmet@example.test' },
      created_at: '2026-10-10T10:00:00Z',
      updated_at: '2026-10-11T10:00:00Z',
      html_url: `https://github.com/arma-org/panel/x/${String(number)}`,
      body: 'Not taken',
      ...extra,
    });
    github.handler = (sent) => {
      if (sent.url.pathname.endsWith('/pulls')) {
        return json([row(42, { draft: true }), row(43, { user: null })]);
      }
      if (sent.url.pathname.endsWith('/issues')) {
        return json([row(7), row(42, { pull_request: { url: 'https://api.github.com/x' } })]);
      }
      return undefined;
    };
    const pulls = await github.client.pullRequests(INSTALLATION_ID, REPOSITORY, null);
    expect(pulls).toMatchObject({
      changed: true,
      more: false,
      items: [
        { number: 42, title: 'Title 42', authorLogin: 'mehmet', draft: true },
        { number: 43, authorLogin: null, draft: false },
      ],
    });
    const issues = await github.client.issues(INSTALLATION_ID, REPOSITORY, null);
    expect(issues).toMatchObject({
      changed: true,
      items: [
        { number: 7, isPullRequest: false },
        { number: 42, isPullRequest: true },
      ],
    });
    expect(JSON.stringify([pulls, issues])).not.toContain('example.test');
    expect(JSON.stringify([pulls, issues])).not.toContain('Not taken');
  });

  it('sends the tag of the last answer, and a list that did not change costs nothing', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) => {
      if (!sent.url.pathname.endsWith('/commits')) {
        return undefined;
      }
      return sent.headers['if-none-match'] === '"commits-1"'
        ? new Response(null, { status: 304 })
        : json(COMMITS, 200, { etag: '"commits-1"' });
    };
    const first = await github.client.commits(INSTALLATION_ID, REPOSITORY, null);
    expect(first.changed && first.etag).toBe('"commits-1"');
    expect(github.sent.at(-1)?.headers['if-none-match']).toBeUndefined();
    expect(await github.client.commits(INSTALLATION_ID, REPOSITORY, '"commits-1"')).toEqual({
      changed: false,
    });
  });

  it('an answer of another shape is refused, and the error quotes nothing of it', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) => {
      if (sent.url.pathname.endsWith('/commits')) {
        return json([{ sha: 'SECRET-not-a-sha', commit: { message: 'SECRET-text' } }]);
      }
      if (sent.url.pathname.endsWith('/pulls')) {
        return new Response('SECRET <html>', { status: 200 });
      }
      return undefined;
    };
    for (const call of [
      github.client.commits(INSTALLATION_ID, REPOSITORY, null),
      github.client.pullRequests(INSTALLATION_ID, REPOSITORY, null),
    ]) {
      const error = await failure(call);
      expect(error.kind).toBe('invalid_answer');
      expect(
        JSON.stringify([
          error.message,
          error.stack,
          error.status,
          error.requestId,
          Object.entries(error),
        ]),
      ).not.toContain('SECRET');
    }
  });
});

describe('what the client makes of a failure', () => {
  const listFails = async (response: () => Response | never): Promise<GithubError> => {
    const github = new RecordedGithub();
    github.handler = (sent) => (sent.url.pathname.endsWith('/commits') ? response() : undefined);
    return failure(github.client.commits(INSTALLATION_ID, REPOSITORY, null));
  };

  it('no answer, a server error and an unexpected status are "unavailable"', async () => {
    const none = await listFails(() => {
      throw new Error('SECRET connect ETIMEDOUT 140.82.112.5:443');
    });
    expect(none).toMatchObject({ kind: 'unavailable', status: null, requestId: null });
    expect(none.message).toBe('GitHub call failed: unavailable');
    expect(await listFails(() => json({ message: 'SECRET' }, 502))).toMatchObject({
      kind: 'unavailable',
      status: 502,
      requestId: 'AB12:CD34',
    });
    expect(await listFails(() => json({ message: 'Git Repository is empty.' }, 409))).toMatchObject(
      { kind: 'unavailable', status: 409 },
    );
  });

  it('403 and 404 on a list are the answer to that list', async () => {
    expect(await listFails(() => json({ message: 'Resource not accessible' }, 403))).toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
    expect(await listFails(() => json({ message: 'Not Found' }, 404))).toMatchObject({
      kind: 'not_found',
      status: 404,
    });
  });

  it('a rate limit says when GitHub takes requests again', async () => {
    const reset = Math.floor(NOW / 1000) + 900;
    const primary = await listFails(() =>
      json({ message: 'API rate limit exceeded' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      }),
    );
    expect(primary).toMatchObject({ kind: 'rate_limited', status: 403, retryAtMs: reset * 1000 });
    const secondary = await listFails(() =>
      json({ message: 'Slow down' }, 429, { 'retry-after': '30' }),
    );
    expect(secondary).toMatchObject({ kind: 'rate_limited', status: 429, retryAtMs: NOW + 30_000 });
    // Without a time: a minute. Never longer than an hour, whatever GitHub says.
    expect(await listFails(() => json({}, 429))).toMatchObject({ retryAtMs: NOW + 60_000 });
    expect(await listFails(() => json({}, 403, { 'retry-after': '999999' }))).toMatchObject({
      kind: 'rate_limited',
      retryAtMs: NOW + 3_600_000,
    });
  });

  it('a refused signature of the app is "unauthorized"', async () => {
    const github = new RecordedGithub();
    github.handler = () => json({ message: 'A JSON web token could not be decoded' }, 401);
    expect(await failure(github.client.app())).toMatchObject({ kind: 'unauthorized', status: 401 });
    // Also when it is refused while a token is asked for: it is the key, not the installation.
    expect(await failure(github.client.repositories(INSTALLATION_ID))).toMatchObject({
      kind: 'unauthorized',
    });
  });

  it("an installation that is gone, suspended or not this app's gives no token", async () => {
    const gone = new RecordedGithub();
    gone.installation = null;
    expect(await failure(gone.client.repositories(INSTALLATION_ID))).toMatchObject({
      kind: 'installation_gone',
      status: 404,
    });
    expect(gone.paths()).toEqual(['GET /app/installations/5001']);

    // Suspended: no token is even asked for.
    const suspended = new RecordedGithub();
    suspended.installation = installationJson({ suspended_at: '2026-10-12T08:00:00Z' });
    expect(await failure(suspended.client.repositories(INSTALLATION_ID))).toMatchObject({
      kind: 'installation_gone',
    });
    expect(suspended.sent.some((sent) => sent.method === 'POST')).toBe(false);

    // None of the four permissions: a request without permissions would be given them all.
    const bare = new RecordedGithub();
    bare.installation = installationJson({ permissions: { actions: 'read' } });
    expect(await failure(bare.client.repositories(INSTALLATION_ID))).toMatchObject({
      kind: 'installation_gone',
    });
    expect(bare.sent.some((sent) => sent.method === 'POST')).toBe(false);

    // GitHub refuses the token request itself.
    const refused = new RecordedGithub();
    refused.handler = (sent) =>
      sent.method === 'POST' ? json({ message: 'Not Found' }, 404) : undefined;
    expect(await failure(refused.client.repositories(INSTALLATION_ID))).toMatchObject({
      kind: 'installation_gone',
    });
  });

  it('a refused token is replaced once; refused again, the installation gives no access', async () => {
    const github = new RecordedGithub();
    let refusals = 1;
    github.handler = (sent) => {
      if (sent.url.pathname !== '/installation/repositories') {
        return undefined;
      }
      if (refusals > 0) {
        refusals -= 1;
        return json({ message: 'Bad credentials' }, 401);
      }
      return json({ total_count: 0, repositories: [] });
    };
    expect(await github.client.repositories(INSTALLATION_ID)).toEqual({
      repositories: [],
      truncated: false,
    });
    expect(github.tokens).toBe(2);
    expect(github.bearer(github.sent.at(-1) as Sent)).toBe(github.token(2));

    refusals = 5;
    expect(await failure(github.client.repositories(INSTALLATION_ID))).toMatchObject({
      kind: 'installation_gone',
      status: 401,
    });
    // One replacement, not a loop.
    expect(github.tokens).toBe(3);
  });

  it('follows one redirect inside api.github.com, and sends the token to no other host', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) => {
      if (sent.url.pathname === '/repos/arma-org/panel/commits') {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://api.github.com/repositories/700/commits?per_page=20' },
        });
      }
      if (sent.url.pathname === '/repositories/700/commits') {
        return json(COMMITS);
      }
      if (sent.url.pathname === '/repos/arma-org/panel/pulls') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example.test/steal' },
        });
      }
      if (sent.url.pathname === '/repos/arma-org/panel/issues') {
        // A redirect that leads to another redirect is not followed further.
        return new Response(null, {
          status: 307,
          headers: { location: 'https://api.github.com/repos/arma-org/panel/issues' },
        });
      }
      return undefined;
    };
    const commits = await github.client.commits(INSTALLATION_ID, REPOSITORY, null);
    expect(commits.changed && commits.items).toHaveLength(2);
    const followed = github.sent.at(-1) as Sent;
    expect(followed.url.pathname).toBe('/repositories/700/commits');
    expect(github.bearer(followed)).toBe(github.token(1));

    expect(
      await failure(github.client.pullRequests(INSTALLATION_ID, REPOSITORY, null)),
    ).toMatchObject({ kind: 'unavailable', status: 302 });
    expect(await failure(github.client.issues(INSTALLATION_ID, REPOSITORY, null))).toMatchObject({
      kind: 'unavailable',
      status: 307,
    });
    expect(github.sent.every((sent) => sent.url.origin === GITHUB_API_ORIGIN)).toBe(true);
  });

  it('a failed call is one log line without a token, a signature or a body', async () => {
    const github = new RecordedGithub();
    github.handler = (sent) =>
      sent.url.pathname.endsWith('/commits') ? json({ message: 'SECRET-body' }, 500) : undefined;
    await failure(github.client.commits(INSTALLATION_ID, REPOSITORY, null));
    expect(github.log).toEqual([
      {
        level: 'warn',
        message: 'GitHub call failed',
        details: {
          company: 'armadx',
          method: 'GET',
          path: '/repos/arma-org/panel/commits',
          status: 500,
          requestId: 'AB12:CD34',
          kind: 'unavailable',
        },
      },
    ]);
    const text = JSON.stringify(github.log);
    expect(text).not.toContain(github.token(1));
    expect(text).not.toContain('SECRET');
    for (const sent of github.sent) {
      expect(text).not.toContain(github.bearer(sent));
    }
    expect(text).not.toContain('per_page');
  });
});

describe('the client only reads', () => {
  afterAll(() => {
    EVERYTHING.length = 0;
  });

  it('every request this file sent is a GET, or the one POST that asks for a token', () => {
    expect(EVERYTHING.length).toBeGreaterThan(50);
    for (const sent of EVERYTHING) {
      if (sent.method === 'POST') {
        expect(sent.url.pathname).toMatch(/^\/app\/installations\/\d+\/access_tokens$/);
        expect(Object.keys(sent.body as Record<string, unknown>)).toEqual(['permissions']);
      } else {
        expect(sent.method, sent.url.pathname).toBe('GET');
        expect(sent.body).toBeUndefined();
      }
    }
  });
});
