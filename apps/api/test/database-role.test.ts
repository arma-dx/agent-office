import { randomBytes } from 'node:crypto';
import { createPool } from '@agent-office/db';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { assertRestrictedRole } from '../src/db.ts';
import { adminExec, closeAdminPool } from './helpers.ts';

// Rule 9: the API refuses to start with a role that would switch the row policies off.

const database = inject('database');
// Roles are server-wide; this one exists only during the test.
const BYPASS_ROLE = 'agent_office_test_api_bypass';

async function check(connectionString: string): Promise<void> {
  const pool = createPool(connectionString, 'agent-office-api-role-test', () => {});
  try {
    await assertRestrictedRole(pool);
  } finally {
    await pool.end();
  }
}

describe.skipIf(database === null)('database role check at startup', () => {
  afterAll(async () => {
    await adminExec(`drop role if exists ${BYPASS_ROLE}`);
    await closeAdminPool();
  });

  it("accepts the API's restricted login role", async () => {
    await expect(check(database?.app ?? '')).resolves.toBeUndefined();
  });

  // The admin role is a superuser on plain PostgreSQL and a BYPASSRLS role on Supabase, where the
  // migration role is not a superuser; either way it must be refused.
  it('refuses the privileged admin role, naming the reason but not the role', async () => {
    const error = await check(database?.admin ?? '').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : '';
    expect(message).toMatch(/superuser|bypasses row level security/);
    expect(message).not.toMatch(/postgres/);
  });

  it('refuses a role with BYPASSRLS, even with the API memberships', async () => {
    const password = randomBytes(24).toString('hex');
    await adminExec(`
      drop role if exists ${BYPASS_ROLE};
      create role ${BYPASS_ROLE} login bypassrls password '${password}'
        in role office_app, office_api_private;
    `);
    const url = new URL(database?.admin ?? '');
    url.username = BYPASS_ROLE;
    url.password = password;
    await expect(check(url.toString())).rejects.toThrow(/bypasses row level security/);
  });

  it("refuses a restricted role that is not the API's (the worker role)", async () => {
    await expect(check(database?.worker ?? '')).rejects.toThrow(/office_api_private/);
  });
});
