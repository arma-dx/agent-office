import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import { GITHUB, ids, type GithubFixture } from './fixtures.ts';
import {
  asRole,
  closePools,
  inAdminTransaction,
  inTransaction,
  inWorkerTransaction,
  noDatabase,
  type Tx,
} from './helpers.ts';
import { stepUp } from './step-up.ts';

// The GitHub connection of a company (8 October decisions 19 and 22; 12 October decisions 12 to
// 17). A connection is the row of office.integrations with provider 'github': one per company,
// no two companies on one organisation or installation, no secret in it, read permissions only.
// Only the founder connects and disconnects, through the database's two functions, which only
// the API's role may call; connecting uses up a passkey re-verification for exactly that company.
//
// Every rule here is the database's own. The fixtures hold both companies connected (written as
// an administrator would); a case that starts from a company that never connected removes those
// rows first, inside its own transaction, which is rolled back like every other.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };

const READ = ['metadata:read', 'contents:read', 'pull_requests:read', 'issues:read'];
const CONNECT = 'select office.connect_github($1, $2, $3, $4, $5::text[]) as id';
const DISCONNECT = 'select office.disconnect_github() as done';
const SETTINGS =
  '{"installation_id": 1, "account_id": 2, "app_id": 3, "connected_at": "2026-10-12T00:00:00Z"}';
const INSERT_ROW = `insert into office.integrations
    (company_id, provider, account, scopes, settings, status)
  values ($1, 'github', 'some-org', '{metadata:read}', '${SETTINGS}', 'enabled')`;

function facts(of: GithubFixture, scopes: string[] = READ): unknown[] {
  return [of.account, of.accountId, of.installationId, of.appId, scopes];
}

async function connect(tx: Tx, of: GithubFixture, scopes: string[] = READ): Promise<string> {
  const [row] = await tx.rows<{ id: string }>(CONNECT, facts(of, scopes));
  if (!row) {
    throw new Error('connect_github returned no row');
  }
  return row.id;
}

async function asPerson(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'app');
  await tx.setContext(context);
}

async function asWorker(tx: Tx, context: ContextInput): Promise<void> {
  await asRole(tx, 'worker');
  await tx.setContext(context);
}

/** The privileged role without a person in the context, as an administrator writes. */
async function asAdministrator(tx: Tx): Promise<void> {
  await asRole(tx, null);
  await tx.setContext({});
}

/** Takes the fixtures' connections away: both companies are as if GitHub was never connected. */
async function neverConnected(tx: Tx): Promise<void> {
  await asAdministrator(tx);
  await tx.exec('delete from office.project_repositories');
  await tx.exec(`delete from office.integrations where provider = 'github'`);
}

/** Whether the re-verification was used up; read by the privileged role, whatever the context. */
async function used(tx: Tx, stepUpId: string): Promise<boolean | undefined> {
  await asRole(tx, null);
  const [row] = await tx.rows<{ used: boolean }>(
    'select consumed_at is not null as used from office.step_ups where id = $1',
    [stepUpId],
  );
  await asRole(tx, 'app');
  return row?.used;
}

interface GithubRow {
  id: string;
  company_id: string;
  account: string;
  status: string;
  scopes: string[];
  settings: Record<string, unknown>;
  connected_by_user_id: string | null;
  no_token: boolean;
}

/** The GitHub rows the present role and context can read. */
async function githubRows(tx: Tx): Promise<GithubRow[]> {
  return tx.rows<GithubRow>(
    `select id, company_id, account, status, scopes, settings, connected_by_user_id,
            encrypted_token is null as no_token
     from office.integrations where provider = 'github' order by account`,
  );
}

interface AuditRow {
  event: string;
  company_id: string;
  record_type: string | null;
  record_id: string | null;
  external_ref: string | null;
  user_id: string | null;
}

/** The audit rows of this step after the mark that the present role and context can read. */
async function githubAudit(tx: Tx, after = '0'): Promise<AuditRow[]> {
  return tx.rows<AuditRow>(
    `select event, company_id, record_type, record_id, external_ref, user_id
     from office.audit_log where event ~ '^github_' and id > $1::bigint order by id`,
    [after],
  );
}

/** The highest audit id inside the open transaction. */
async function auditMarkIn(tx: Tx): Promise<string> {
  await asRole(tx, null);
  const [row] = await tx.rows<{ mark: string }>(
    'select coalesce(max(id), 0)::text as mark from office.audit_log',
  );
  await asRole(tx, 'app');
  return row?.mark ?? '0';
}

describe.skipIf(noDatabase)('who connects the GitHub organisation of a company', () => {
  afterAll(closePools);

  it('connect: only the founder, only in a company, never an agent run', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      for (const context of [employeeA, externalA, {}, { companyId: ids.arma }]) {
        await asPerson(tx, context);
        expect(
          (await tx.expectError(CONNECT, facts(GITHUB.arma))).code,
          JSON.stringify(context),
        ).toBe('42501');
        expect((await tx.expectError(DISCONNECT)).code, JSON.stringify(context)).toBe('42501');
      }
      // A founder of another company with Arma DX in the context is nobody in Arma DX.
      await asPerson(tx, { companyId: ids.arma, userId: ids.otherFounder });
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('42501');
      // An agent run in the founder's name.
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      await tx.setContext({ ...founderA, agentCode: 'KOR-1' });
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('42501');
      expect((await tx.expectError(DISCONNECT)).code).toBe('42501');
      // The founder space is no company.
      const space: ContextInput = { companyId: ids.founderSpace, userId: ids.founder };
      await stepUp(tx, space, 'github_connection', ids.founderSpace);
      const refused = await tx.expectError(CONNECT, facts(GITHUB.arma));
      expect(refused.code).toBe('23514');
      expect(refused.message).toBe('GitHub is connected to a company, not to the founder space');
      await asAdministrator(tx);
      expect(await githubRows(tx)).toEqual([]);
    });
  });

  it('connect: the facts of the installation are given whole', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      await asPerson(tx, founderA);
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      for (const missing of [0, 1, 2, 3, 4]) {
        const values = facts(GITHUB.arma);
        values[missing] = null;
        expect((await tx.expectError(CONNECT, values)).code, String(missing)).toBe('22023');
      }
    });
  });

  it('connect: asks for a passkey of the founder for exactly this company', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      await asPerson(tx, founderA);
      const missing = await tx.expectError(CONNECT, facts(GITHUB.arma));
      expect(missing.code).toBe('28000');
      expect(missing.message).toBe('Connecting GitHub needs a passkey re-verification');

      // A re-verification made in Pillika does not connect Arma DX.
      const ofPillika = await stepUp(tx, founderP, 'github_connection', ids.pillika);
      await tx.setContext(founderA);
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('28000');
      // Nor does one of another purpose.
      const otherPurpose = await stepUp(tx, founderA, 'project_ai_permission', ids.projectA);
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('28000');
      // Nor one that names another subject than the company.
      const otherSubject = await stepUp(tx, founderA, 'github_connection', ids.projectA);
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('28000');

      const own = await stepUp(tx, founderA, 'github_connection', ids.arma);
      const id = await connect(tx, GITHUB.arma);
      expect(await used(tx, own)).toBe(true);
      for (const other of [ofPillika, otherPurpose, otherSubject]) {
        expect(await used(tx, other)).toBe(false);
      }
      const rows = await githubRows(tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id,
        company_id: ids.arma,
        account: 'arma-org',
        status: 'enabled',
        scopes: READ,
        connected_by_user_id: ids.founder,
        no_token: true,
      });
      expect(rows[0]?.settings).toMatchObject({
        installation_id: GITHUB.arma.installationId,
        account_id: GITHUB.arma.accountId,
        app_id: GITHUB.arma.appId,
      });
      expect(Object.keys(rows[0]?.settings ?? {}).sort()).toEqual([
        'account_id',
        'app_id',
        'connected_at',
        'installation_id',
      ]);
    });
  });

  it('connect: the same installation again needs no passkey, a new one does', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      await asPerson(tx, founderA);
      const id = await connect(tx, GITHUB.arma);

      // The organisation was renamed and lost a permission on GitHub: brought up to date.
      const renamed = { ...GITHUB.arma, account: 'arma-renamed' };
      expect(await connect(tx, renamed, ['metadata:read'])).toBe(id);
      expect(await githubRows(tx)).toMatchObject([
        { id, account: 'arma-renamed', scopes: ['metadata:read'], status: 'enabled' },
      ]);

      // The app was installed again: a new installation of the same organisation.
      const reinstalled = { ...GITHUB.arma, installationId: 5009 };
      expect((await tx.expectError(CONNECT, facts(reinstalled))).code).toBe('28000');
      const second = await stepUp(tx, founderA, 'github_connection', ids.arma);
      expect(await connect(tx, reinstalled)).toBe(id);
      expect(await used(tx, second)).toBe(true);
      expect((await githubRows(tx))[0]?.settings).toMatchObject({ installation_id: 5009 });
      // One re-verification is one connection.
      expect(
        (await tx.expectError(CONNECT, facts({ ...GITHUB.arma, installationId: 5010 }))).code,
      ).toBe('28000');
    });
  });

  it('connect: a company that was connected to one organisation is not moved to another', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      const passkey = await stepUp(tx, founderA, 'github_connection', ids.arma);
      const other = { account: 'other-org', accountId: 1002, installationId: 5002, appId: 9002 };
      const refused = await tx.expectError(CONNECT, facts(other));
      expect(refused.code).toBe('55000');
      expect(refused.message).toBe('The company is connected to another GitHub organisation');
      expect(await used(tx, passkey)).toBe(false);
      // Not after a disconnect either: the repositories of the projects belong to the old one.
      await tx.rows(DISCONNECT);
      expect((await tx.expectError(CONNECT, facts(other))).code).toBe('55000');
      expect(await githubRows(tx)).toMatchObject([{ account: 'arma-org', status: 'disabled' }]);
    });
  });

  it('disconnect: switches the connection of the context company off, and only that one', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      expect(await tx.rows(DISCONNECT)).toEqual([{ done: true }]);
      // A second call changes nothing.
      expect(await tx.rows(DISCONNECT)).toEqual([{ done: false }]);
      expect(await githubRows(tx)).toMatchObject([{ id: ids.githubA, status: 'disabled' }]);
      await tx.setContext(founderP);
      expect(await githubRows(tx)).toMatchObject([{ id: ids.githubP, status: 'enabled' }]);

      // Connecting again asks for the passkey again, and brings the same row back.
      await tx.setContext(founderA);
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('28000');
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      expect(await connect(tx, GITHUB.arma)).toBe(ids.githubA);
      expect(await githubRows(tx)).toMatchObject([{ id: ids.githubA, status: 'enabled' }]);

      // In Pillika the function switches off Pillika only.
      await tx.setContext(founderP);
      expect(await tx.rows(DISCONNECT)).toEqual([{ done: true }]);
      await asAdministrator(tx);
      expect(await githubRows(tx)).toMatchObject([
        { id: ids.githubA, status: 'enabled' },
        { id: ids.githubP, status: 'disabled' },
      ]);
    });
  });

  it('no request writes a GitHub row by a statement of its own', async () => {
    await inAdminTransaction(async (tx) => {
      await asPerson(tx, founderA);
      // The fixtures' row is there and is not touched.
      expect(await tx.exec(`update office.integrations set status = 'disabled'`)).toBe(1);
      expect(
        await tx.exec(
          `update office.integrations set status = 'disabled' where provider = 'github'`,
        ),
      ).toBe(0);
      expect(await tx.exec(`delete from office.integrations where provider = 'github'`)).toBe(0);
      expect(await githubRows(tx)).toMatchObject([{ id: ids.githubA, status: 'enabled' }]);

      await neverConnected(tx);
      await asPerson(tx, founderA);
      // Without a passkey the guard refuses; with one the policy does.
      expect((await tx.expectError(INSERT_ROW, [ids.arma])).code).toBe('28000');
      const passkey = await stepUp(tx, founderA, 'github_connection', ids.arma);
      expect((await tx.expectError(INSERT_ROW, [ids.arma])).code).toBe('42501');
      expect(await used(tx, passkey)).toBe(false);
      expect(await githubRows(tx)).toEqual([]);
      // A row of another provider still goes through the founder's own policy.
      expect(
        await tx.exec(
          `insert into office.integrations (company_id, provider, account)
           values ($1, 'google_drive', 'drive-account')`,
          [ids.arma],
        ),
      ).toBe(1);
      // An employee writes neither.
      await tx.setContext(employeeA);
      expect((await tx.expectError(INSERT_ROW, [ids.arma])).code).toBe('42501');
    });
  });

  it('the worker role calls neither function and writes no GitHub row', async () => {
    await inWorkerTransaction(async (tx) => {
      for (const context of [founderA, { ...founderA, agentCode: 'KOR-1' }]) {
        await tx.setContext(context);
        expect((await tx.expectError(CONNECT, facts(GITHUB.arma))).code).toBe('42501');
        expect((await tx.expectError(DISCONNECT)).code).toBe('42501');
        expect((await tx.expectError(INSERT_ROW, [ids.otherCompany])).code).toMatch(
          /^(42501|28000)$/,
        );
        expect(
          await tx.exec(
            `update office.integrations set status = 'disabled' where provider = 'github'`,
          ),
        ).toBe(0);
        expect(await tx.exec(`delete from office.integrations where provider = 'github'`)).toBe(0);
      }
    });
    await inAdminTransaction(async (tx) => {
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      await asWorker(tx, founderA);
      expect((await tx.expectError(INSERT_ROW, [ids.otherCompany])).code).toBe('42501');
    });
  });
});

describe.skipIf(noDatabase)('what a GitHub connection row may hold', () => {
  afterAll(closePools);

  const insert = (scopes: string, settings: string, token: string, account = 'arma-org'): string =>
    `insert into office.integrations
       (company_id, provider, account, scopes, settings, status, encrypted_token)
     values ('${ids.arma}', 'github', '${account}', '${scopes}', '${settings}', 'enabled', ${token})`;

  it('shape: no token, read permissions only, the four facts and nothing else', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      const refused: [string, string][] = [
        ['a token', insert('{metadata:read}', SETTINGS, `'\\x01'`)],
        ['a write permission', insert('{contents:write}', SETTINGS, 'null')],
        ['a permission outside the four', insert('{actions:read}', SETTINGS, 'null')],
        [
          'a fifth key',
          insert(
            '{metadata:read}',
            '{"installation_id": 1, "account_id": 2, "app_id": 3, "connected_at": "x", "extra": 1}',
            'null',
          ),
        ],
        [
          'a missing key',
          insert('{metadata:read}', '{"installation_id": 1, "account_id": 2, "app_id": 3}', 'null'),
        ],
        [
          'a number written as text',
          insert(
            '{metadata:read}',
            '{"installation_id": "1", "account_id": 2, "app_id": 3, "connected_at": "x"}',
            'null',
          ),
        ],
        ['a name of another shape', insert('{metadata:read}', SETTINGS, 'null', 'arma org; drop')],
      ];
      for (const [what, sql] of refused) {
        const error = await tx.expectError(sql);
        expect(error.code, what).toBe('23514');
        expect(error.constraint, what).toBe('integrations_github_shape');
      }
      expect(
        (
          await tx.expectError(
            `insert into office.integrations (company_id, provider, account, scopes, settings, status)
             values ('${ids.arma}', 'github', 'arma-org', '{metadata:read}', '${SETTINGS}', 'error')`,
          )
        ).code,
      ).toBe('23514');
      expect(await tx.exec(insert('{metadata:read}', SETTINGS, 'null'))).toBe(1);
      // A row of another provider is not looked at.
      expect(
        await tx.exec(
          `insert into office.integrations (company_id, provider, account, encrypted_token)
           values ('${ids.arma}', 'google_drive', 'drive-account', '\\x01')`,
        ),
      ).toBe(1);
    });
  });

  it('shape: the function refuses a write permission and a bad name, and the passkey survives', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      const passkey = await stepUp(tx, founderA, 'github_connection', ids.arma);
      await asPerson(tx, founderA);
      expect((await tx.expectError(CONNECT, facts(GITHUB.arma, ['contents:write']))).code).toBe(
        '23514',
      );
      expect(
        (await tx.expectError(CONNECT, facts({ ...GITHUB.arma, account: 'arma org; drop' }))).code,
      ).toBe('23514');
      expect(await used(tx, passkey)).toBe(false);
      await connect(tx, GITHUB.arma);
      expect(await used(tx, passkey)).toBe(true);
    });
  });
});

describe.skipIf(noDatabase)('the GitHub connections of the two companies', () => {
  afterAll(closePools);

  it('one organisation and one installation belong to one company only', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      await asPerson(tx, founderA);
      const armaRow = await connect(tx, GITHUB.arma);

      // The founder is the founder of Pillika too, and reads nothing of Arma DX there.
      const passkey = await stepUp(tx, founderP, 'github_connection', ids.pillika);
      expect(await githubRows(tx)).toEqual([]);
      const sameOrganisation = await tx.expectError(
        CONNECT,
        facts({ ...GITHUB.arma, installationId: 6001, appId: 9101 }),
      );
      expect(sameOrganisation.code).toBe('23505');
      expect(sameOrganisation.constraint).toBe('integrations_github_account');
      const sameGithubFixture = await tx.expectError(
        CONNECT,
        facts({ ...GITHUB.pillika, installationId: GITHUB.arma.installationId }),
      );
      expect(sameGithubFixture.code).toBe('23505');
      expect(sameGithubFixture.constraint).toBe('integrations_github_installation');
      // A refused attempt does not use the passkey up.
      expect(await used(tx, passkey)).toBe(false);

      const pillikaRow = await connect(tx, GITHUB.pillika);
      expect(pillikaRow).not.toBe(armaRow);
      expect(await used(tx, passkey)).toBe(true);
      expect(await githubRows(tx)).toMatchObject([{ id: pillikaRow, account: 'pillika-org' }]);
      await tx.setContext(founderA);
      expect(await githubRows(tx)).toMatchObject([{ id: armaRow, account: 'arma-org' }]);
    });
  });

  it('a company has one GitHub connection', async () => {
    await inAdminTransaction(async (tx) => {
      await asAdministrator(tx);
      const second = await tx.expectError(
        `insert into office.integrations (company_id, provider, account, scopes, settings, status)
         values ($1, 'github', 'second-org', '{metadata:read}', '${SETTINGS}', 'enabled')`,
        [ids.arma],
      );
      expect(second.code).toBe('23505');
      expect(second.constraint).toBe('integrations_one_github');
    });
  });

  it('reading: the founder and the employees of the company, nobody else, never a secret', async () => {
    await inTransaction(async (tx) => {
      const readers: [ContextInput, string[]][] = [
        [founderA, ['arma-org']],
        [founderP, ['pillika-org']],
        [employeeA, ['arma-org']],
        [employeeP, ['pillika-org']],
        [externalA, []],
        [{ companyId: ids.pillika, userId: ids.externalP }, []],
        // A person of one company with the other company in the context.
        [{ companyId: ids.arma, userId: ids.employeeP }, []],
        [{ companyId: ids.pillika, userId: ids.employeeA }, []],
        [{ companyId: ids.arma, userId: ids.otherFounder }, []],
        [{ companyId: ids.founderSpace, userId: ids.founder }, []],
        [{}, []],
        [{ companyId: ids.arma }, []],
        [{ userId: ids.founder }, []],
      ];
      for (const [context, accounts] of readers) {
        await tx.setContext(context);
        expect(
          (await githubRows(tx)).map((row) => row.account),
          JSON.stringify(context),
        ).toEqual(accounts);
      }
      // An employee reads the GitHub row and no row of another provider (the fixtures' Google
      // row carries a token).
      await tx.setContext(employeeA);
      expect(await tx.rows('select provider, encrypted_token from office.integrations')).toEqual([
        { provider: 'github', encrypted_token: null },
      ]);
      await tx.setContext(externalA);
      expect(await tx.count('integrations')).toBe(0);
      await tx.setContext({ companyId: ids.founderSpace, userId: ids.founder });
      expect(await tx.count('integrations')).toBe(0);
    });
    // An agent run of Pillika reads no GitHub row of Arma DX.
    await inWorkerTransaction(async (tx) => {
      for (const projectId of [null, ids.projectA]) {
        await tx.setContext({
          companyId: ids.pillika,
          userId: ids.founder,
          agentCode: 'KOR-1',
          projectId,
        });
        expect((await githubRows(tx)).every((row) => row.company_id === ids.pillika)).toBe(true);
      }
    });
  });
});

describe.skipIf(noDatabase)('the audit rows of a GitHub connection', () => {
  afterAll(closePools);

  it('connecting and disconnecting are recorded in the company they happened in', async () => {
    await inAdminTransaction(async (tx) => {
      await neverConnected(tx);
      const mark = await auditMarkIn(tx);

      await stepUp(tx, founderA, 'github_connection', ids.arma);
      await asPerson(tx, founderA);
      const armaRow = await connect(tx, GITHUB.arma);
      const connected = {
        event: 'github_connected',
        company_id: ids.arma,
        record_type: 'integration',
        record_id: armaRow,
        external_ref: 'github:installation:5001',
        user_id: ids.founder,
      };
      expect(await githubAudit(tx, mark)).toEqual([connected]);
      // The same installation again writes nothing.
      await connect(tx, { ...GITHUB.arma, account: 'arma-renamed' });
      expect(await githubAudit(tx, mark)).toHaveLength(1);

      await tx.rows(DISCONNECT);
      await tx.rows(DISCONNECT);
      const disconnected = { ...connected, event: 'github_disconnected' };
      expect(await githubAudit(tx, mark)).toEqual([connected, disconnected]);

      // A new installation after a disconnect is one connection.
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      await connect(tx, { ...GITHUB.arma, installationId: 5009 });
      expect(await githubAudit(tx, mark)).toEqual([
        connected,
        disconnected,
        { ...connected, external_ref: 'github:installation:5009' },
      ]);

      // Pillika's connection is in Pillika's audit log, and each company reads its own.
      await stepUp(tx, founderP, 'github_connection', ids.pillika);
      const pillikaRow = await connect(tx, GITHUB.pillika);
      expect(await githubAudit(tx, mark)).toEqual([
        {
          ...connected,
          company_id: ids.pillika,
          record_id: pillikaRow,
          external_ref: 'github:installation:6001',
        },
      ]);
      await tx.setContext(founderA);
      expect((await githubAudit(tx, mark)).every((row) => row.company_id === ids.arma)).toBe(true);
      expect(await githubAudit(tx, mark)).toHaveLength(3);
    });
  });

  it('no request and no agent run writes a row that says GitHub was connected', async () => {
    const forged = `insert into office.audit_log (company_id, event, record_type, record_id)
      values ($1, $2, 'integration', $3)`;
    await inTransaction(async (tx) => {
      for (const context of [founderA, employeeA]) {
        await tx.setContext(context);
        for (const event of ['github_connected', 'github_disconnected', 'github_anything']) {
          expect(
            (await tx.expectError(forged, [ids.arma, event, ids.githubA])).code,
            `${JSON.stringify(context)} ${event}`,
          ).toBe('42501');
        }
      }
    });
    await inWorkerTransaction(async (tx) => {
      await tx.setContext({ ...founderA, agentCode: 'KOR-1' });
      expect((await tx.expectError(forged, [ids.arma, 'github_connected', ids.githubA])).code).toBe(
        '42501',
      );
    });
  });
});
