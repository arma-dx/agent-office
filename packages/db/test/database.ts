import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Shared setup for database tests (Vitest globalSetup). TEST_DATABASE_URL is the connection string
 * of a privileged role (locally and in CI, the postgres user of a temporary PostgreSQL). The setup:
 *   1. Creates the named test database from scratch and applies all migrations in order.
 *   2. Creates two login roles without BYPASSRLS, with passwords generated randomly on every run:
 *      one like office_api (member of office_app and office_api_private) and one like
 *      office_worker (member of office_app only).
 *   3. Loads the fixtures, if any, with the privileged role.
 * Tests connect with the restricted roles' connection strings. Without a connection string the
 * database tests are skipped locally; in CI the setup fails.
 */
export interface TestDatabase {
  admin: string;
  // Privileges of the API.
  app: string;
  // Privileges of the worker (agent runs): no API-only privileges.
  worker: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    database: TestDatabase | null;
  }
}

const MIGRATIONS_DIR = new URL('../../../supabase/migrations/', import.meta.url);
// Advisory lock that serialises the setups (a fixed, randomly chosen number).
const SETUP_LOCK = 7_402_115_903;

async function applyMigrations(client: pg.Client): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Migration could not be applied: ${file}`, { cause: error });
    }
  }
}

// format() quotes the role name and the password; the role list is a constant of this file.
async function createLoginRole(
  client: pg.Client,
  role: string,
  password: string,
  memberOf: string,
): Promise<void> {
  const { rows } = await client.query<{ sql: string }>(
    `select format(
       'create role %I login nobypassrls password %L in role %s', $1::text, $2::text, $3::text
     ) as sql`,
    [role, password, memberOf],
  );
  await client.query(rows[0]?.sql ?? '');
}

function withUrl(connectionString: string, change: (url: URL) => void): string {
  const url = new URL(connectionString);
  change(url);
  return url.toString();
}

export function createTestDatabaseSetup(
  name: string,
  loadFixtures?: (client: pg.Client) => Promise<void>,
): (project: TestProject) => Promise<() => Promise<void>> {
  if (!/^[a-z_]+$/.test(name)) {
    throw new Error('Test database name may contain only lowercase letters and underscores');
  }
  const loginRole = `${name}_login`;
  const workerRole = `${name}_worker`;

  return async function setup(project) {
    const root = process.env.TEST_DATABASE_URL;
    if (!root) {
      if (process.env.CI) {
        throw new Error('TEST_DATABASE_URL must be set in CI');
      }
      project.provide('database', null);
      return async () => {};
    }

    const server = new pg.Client({ connectionString: root });
    await server.connect();
    const password = randomBytes(24).toString('hex');
    const workerPassword = randomBytes(24).toString('hex');
    const admin = withUrl(root, (url) => {
      url.pathname = `/${name}`;
    });
    try {
      // Roles are server-wide; the setup runs one at a time so that several test projects applying
      // migrations on the same server do not try to create the shared roles at the same time.
      await server.query('select pg_advisory_lock($1)', [SETUP_LOCK]);
      await server.query(`drop database if exists ${name} with (force)`);
      await server.query(`drop role if exists ${loginRole}`);
      await server.query(`drop role if exists ${workerRole}`);
      await server.query(`create database ${name}`);

      const client = new pg.Client({ connectionString: admin });
      await client.connect();
      try {
        await applyMigrations(client);
        await createLoginRole(client, loginRole, password, 'office_app, office_api_private');
        await createLoginRole(client, workerRole, workerPassword, 'office_app');
        if (loadFixtures) {
          await client.query('begin');
          await loadFixtures(client);
          await client.query('commit');
        }
      } finally {
        await client.end();
      }
    } finally {
      await server.end();
    }

    project.provide('database', {
      admin,
      app: withUrl(admin, (url) => {
        url.username = loginRole;
        url.password = password;
      }),
      worker: withUrl(admin, (url) => {
        url.username = workerRole;
        url.password = workerPassword;
      }),
    });

    return async () => {
      const teardown = new pg.Client({ connectionString: root });
      await teardown.connect();
      try {
        await teardown.query(`drop database if exists ${name} with (force)`);
        await teardown.query(`drop role if exists ${loginRole}`);
        await teardown.query(`drop role if exists ${workerRole}`);
      } finally {
        await teardown.end();
      }
    };
  };
}
