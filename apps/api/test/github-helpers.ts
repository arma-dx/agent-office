import { githubConnectionDetails, type StepUp } from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import type { GithubLog } from '../src/github/api.ts';
import type { SoftwareAuthenticator } from './authenticator.ts';
import { TestClock, standardGithub, type FakeCompany } from './fake-github.ts';
import { ids } from './fixtures.ts';
import { adminExec, createTestServer, type TestServer } from './helpers.ts';
import { send, signStepUp } from './passkey-helpers.ts';

/**
 * The set-up of the GitHub tests of the API: a test server whose environment holds one GitHub App
 * per company, each a fake (the real service and the real company clients run over them), and a
 * clock the test moves. The tests commit: every file that uses this removes the GitHub rows it
 * wrote at its end (clearGithub), so the other files find no company connected.
 */
export interface GithubScene {
  server: TestServer;
  clock: TestClock;
  armadx: FakeCompany;
  pillika: FakeCompany;
  // What the GitHub clients wrote to the log.
  log: { level: 'warn' | 'error'; details: Record<string, unknown>; message: string }[];
}

/** The company id of the fixtures a fake company stands for. */
export function companyIdOf(company: FakeCompany): string {
  return company.code === 'pillika' ? ids.pillika : ids.arma;
}

export function githubScene(
  options: {
    // The companies whose slot is set; the default is both.
    configured?: ('armadx' | 'pillika')[];
    logStream?: { write: (line: string) => void };
  } = {},
): GithubScene {
  const { armadx, pillika } = standardGithub();
  const clock = new TestClock();
  const log: GithubScene['log'] = [];
  const githubLog: GithubLog = {
    warn: (details, message) => log.push({ level: 'warn', details, message }),
    error: (details, message) => log.push({ level: 'error', details, message }),
  };
  const configured = options.configured ?? ['armadx', 'pillika'];
  const slots = Object.fromEntries(
    [armadx, pillika]
      .filter((company) => (configured as string[]).includes(company.code))
      .map((company) => [company.code, { organization: company.organization, api: company.api }]),
  );
  const server = createTestServer({
    github: slots,
    githubNow: clock.now,
    githubLog,
    ...(options.logStream ? { logStream: options.logStream } : {}),
  });
  return { server, clock, armadx, pillika, log };
}

/** Removes every GitHub connection and every project repository, as an administrator. */
export async function clearGithub(): Promise<void> {
  await adminExec(`
    delete from office.project_repositories;
    delete from office.integrations where provider = 'github';
  `);
}

/** The founder's re-verification for connecting the company to what its fake holds now. */
export async function signConnection(
  scene: GithubScene,
  session: string,
  key: SoftwareAuthenticator,
  company: FakeCompany,
  overrides: { organization?: string; installationId?: number; companyId?: string } = {},
): Promise<StepUp> {
  const companyId = overrides.companyId ?? companyIdOf(company);
  return signStepUp(scene.server, session, key, {
    purpose: 'github_connection',
    companyId,
    subjectId: companyId,
    details: githubConnectionDetails(
      overrides.organization ?? company.organization,
      overrides.installationId ?? company.api.installation?.id ?? company.installation.id,
    ),
  });
}

/** POST /api/github/connection of the company, with a re-verification signed for it. */
export async function connectCompany(
  scene: GithubScene,
  session: string,
  key: SoftwareAuthenticator,
  company: FakeCompany,
): Promise<LightMyRequestResponse> {
  const stepUp = await signConnection(scene, session, key, company);
  return send(scene.server, session, 'POST', '/api/github/connection', {
    company: companyIdOf(company),
    payload: { stepUp },
  });
}
