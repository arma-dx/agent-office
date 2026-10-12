import { afterAll, describe, expect, it } from 'vitest';
import type { ContextInput } from '../src/context.ts';
import {
  connectGithub,
  countLinkedProjects,
  disconnectGithub,
  readCompanyForGithub,
  readGithubConnection,
} from '../src/github.ts';
import { GITHUB, ids } from './fixtures.ts';
import { closePools, inTransaction, inWorkerTransaction, noDatabase } from './helpers.ts';
import { stepUp } from './step-up.ts';

// The statements the API runs for the GitHub connection of a company, with the API's restricted
// role. None of them names a company: each acts on the company of the context, and what a person
// reads is the row policies' decision. The fixtures hold both companies connected.

const founderA: ContextInput = { companyId: ids.arma, userId: ids.founder };
const founderP: ContextInput = { companyId: ids.pillika, userId: ids.founder };
const employeeA: ContextInput = { companyId: ids.arma, userId: ids.employeeA };
const employeeP: ContextInput = { companyId: ids.pillika, userId: ids.employeeP };
const externalA: ContextInput = { companyId: ids.arma, userId: ids.externalA };
const SCOPES = ['metadata:read', 'contents:read', 'pull_requests:read', 'issues:read'];

describe.skipIf(noDatabase)('the statements of the GitHub connection', () => {
  afterAll(closePools);

  it('the company of the context: its code and its kind, and no other company', async () => {
    await inTransaction(async (tx) => {
      const companies: [ContextInput, unknown][] = [
        [founderA, { code: 'armadx', kind: 'company' }],
        [employeeP, { code: 'pillika', kind: 'company' }],
        [
          { companyId: ids.founderSpace, userId: ids.founder },
          {
            code: 'founder_space',
            kind: 'private_space',
          },
        ],
        // Somebody who is no member of the company of the context reads no company.
        [{ companyId: ids.arma, userId: ids.employeeP }, null],
        [{}, null],
      ];
      for (const [context, company] of companies) {
        await tx.setContext(context);
        expect(await readCompanyForGithub(tx.client), JSON.stringify(context)).toEqual(company);
      }
    });
  });

  it("the connection of the context company, and never the other company's", async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await readGithubConnection(tx.client)).toEqual({
        id: ids.githubA,
        account: 'arma-org',
        status: 'enabled',
        scopes: SCOPES,
        installationId: GITHUB.arma.installationId,
        accountId: GITHUB.arma.accountId,
        appId: GITHUB.arma.appId,
        connectedAt: new Date('2026-10-12T09:00:00Z'),
        connectedByUserId: null,
      });
      const readers: [ContextInput, string | null][] = [
        [employeeA, ids.githubA],
        [founderP, ids.githubP],
        [employeeP, ids.githubP],
        [externalA, null],
        [{ companyId: ids.arma, userId: ids.employeeP }, null],
        [{ companyId: ids.pillika, userId: ids.employeeA }, null],
        [{ companyId: ids.founderSpace, userId: ids.founder }, null],
        [{ companyId: ids.otherCompany, userId: ids.otherFounder }, null],
        [{}, null],
        [{ companyId: ids.arma }, null],
      ];
      for (const [context, id] of readers) {
        await tx.setContext(context);
        expect((await readGithubConnection(tx.client))?.id ?? null, JSON.stringify(context)).toBe(
          id,
        );
      }
    });
  });

  it('disconnect and connect act on the company of the context only', async () => {
    await inTransaction(async (tx) => {
      await tx.setContext(founderA);
      expect(await disconnectGithub(tx.client)).toBe(true);
      expect(await disconnectGithub(tx.client)).toBe(false);
      expect(await readGithubConnection(tx.client)).toMatchObject({ status: 'disabled' });
      await tx.setContext(founderP);
      expect(await readGithubConnection(tx.client)).toMatchObject({ status: 'enabled' });

      // Connecting again: the passkey, then the same row, with who connected it.
      const facts = { ...GITHUB.arma, account: 'arma-renamed', scopes: ['metadata:read'] };
      await tx.setContext(founderA);
      await expect(
        (async () => {
          await tx.client.query('savepoint refused');
          try {
            await connectGithub(tx.client, facts);
          } finally {
            await tx.client.query('rollback to savepoint refused');
          }
        })(),
      ).rejects.toMatchObject({ code: '28000' });
      await stepUp(tx, founderA, 'github_connection', ids.arma);
      expect(await connectGithub(tx.client, facts)).toBe(ids.githubA);
      expect(await readGithubConnection(tx.client)).toMatchObject({
        id: ids.githubA,
        account: 'arma-renamed',
        status: 'enabled',
        scopes: ['metadata:read'],
        connectedByUserId: ids.founder,
      });
      // Pillika's row was not touched.
      await tx.setContext(founderP);
      expect(await readGithubConnection(tx.client)).toMatchObject({
        account: 'pillika-org',
        connectedByUserId: null,
      });
    });
  });

  it('the linked projects are counted in the company of the context', async () => {
    await inTransaction(async (tx) => {
      const counts: [ContextInput, number][] = [
        [founderA, 1],
        [founderP, 1],
        // An external person and a person without a company read none.
        [externalA, 0],
        [{}, 0],
      ];
      for (const [context, count] of counts) {
        await tx.setContext(context);
        expect(await countLinkedProjects(tx.client), JSON.stringify(context)).toBe(count);
      }
      await tx.setContext(founderA);
      await tx.exec(
        `insert into office.project_repositories
           (company_id, project_id, integration_id, repository_id, full_name)
         values ($1, $2, $3, 778, 'arma-org/other')`,
        [ids.arma, ids.projectANoAi, ids.githubA],
      );
      expect(await countLinkedProjects(tx.client)).toBe(2);
      await tx.setContext(founderP);
      expect(await countLinkedProjects(tx.client)).toBe(1);
    });
  });

  it('the worker role runs neither write', async () => {
    await inWorkerTransaction(async (tx) => {
      await tx.setContext(founderA);
      for (const run of [
        () => disconnectGithub(tx.client),
        () => connectGithub(tx.client, { ...GITHUB.arma, scopes: SCOPES }),
      ]) {
        await tx.client.query('savepoint refused');
        await expect(run()).rejects.toMatchObject({ code: '42501' });
        await tx.client.query('rollback to savepoint refused');
      }
    });
  });
});
