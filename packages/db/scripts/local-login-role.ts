import pg from 'pg';
import { localAdminUrl, localUrl } from './local-admin.ts';

/**
 * Local development only. The migrations create the login roles office_api and office_worker without
 * a password, so nothing can connect with them. This script gives the role named in DATABASE_URL
 * (the API's: office_api) and the role named in WORKER_DATABASE_URL (the worker's: office_worker)
 * the password written in each URL, on the local database. It refuses any host that is not this
 * machine, and it never prints a password.
 *
 * Usage (from the repository root, after `supabase start`): pnpm db:local-role
 */
const ROLE_OF = { DATABASE_URL: 'office_api', WORKER_DATABASE_URL: 'office_worker' } as const;

interface Target {
  role: string;
  password: string;
}

function targetOf(name: keyof typeof ROLE_OF, raw: string): Target {
  const target = localUrl(name, raw);
  const role = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);
  if (role !== ROLE_OF[name]) throw new Error(`${name} must use the role ${ROLE_OF[name]}`);
  if (password.length < 16) throw new Error(`The password in ${name} is too short`);
  return { role, password };
}

async function main(): Promise<void> {
  const api = process.env.DATABASE_URL;
  if (!api) throw new Error('DATABASE_URL is not set; create .env from .env.example first');
  const targets = [targetOf('DATABASE_URL', api)];
  const worker = process.env.WORKER_DATABASE_URL;
  if (worker) {
    targets.push(targetOf('WORKER_DATABASE_URL', worker));
  }

  // The privileged address of the same local database (TEST_DATABASE_URL or the Supabase default).
  const client = new pg.Client({ connectionString: localAdminUrl(process.env) });
  await client.connect();
  try {
    for (const { role, password } of targets) {
      const { rows } = await client.query<{ sql: string }>(
        `select format('alter role %I password %L', $1::text, $2::text) as sql`,
        [role, password],
      );
      await client.query(rows[0]?.sql ?? '');
      console.log(`Local password set for ${role}.`);
    }
  } finally {
    await client.end();
  }
  if (!worker) {
    console.log('WORKER_DATABASE_URL is not set: the worker role got no password.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not set the local password');
  process.exitCode = 1;
});
