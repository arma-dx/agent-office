import pg from 'pg';
import { localAdminUrl, localUrl } from './local-admin.ts';

/**
 * Local development only. The migrations create the login roles office_api and office_worker without
 * a password, so nothing can connect with them. This script gives the role named in DATABASE_URL the
 * password written in that URL, on the local database. It refuses any host that is not this machine,
 * and it never prints the password.
 *
 * Usage (from the repository root, after `supabase start`): pnpm db:local-role
 */
const LOGIN_ROLES = new Set(['office_api', 'office_worker']);

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set; create .env from .env.example first');
  const target = localUrl('DATABASE_URL', raw);
  const role = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);
  if (!LOGIN_ROLES.has(role)) throw new Error('DATABASE_URL must use office_api or office_worker');
  if (password.length < 16) throw new Error('The password in DATABASE_URL is too short');

  // The privileged address of the same local database (TEST_DATABASE_URL or the Supabase default).
  const client = new pg.Client({ connectionString: localAdminUrl(process.env) });
  await client.connect();
  try {
    const { rows } = await client.query<{ sql: string }>(
      `select format('alter role %I password %L', $1::text, $2::text) as sql`,
      [role, password],
    );
    await client.query(rows[0]?.sql ?? '');
  } finally {
    await client.end();
  }
  console.log(`Local password set for ${role}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not set the local password');
  process.exitCode = 1;
});
