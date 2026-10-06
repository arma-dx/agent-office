/**
 * The privileged address of a database on this machine, for the scripts that need the migration
 * role locally (the local login role's password, the definitions sync). The privileged role is
 * never used on the request path (rule 9), and these scripts never reach a shared environment:
 * any host that is not this machine is refused before a connection is made.
 *
 * Errors name the variable and what is wrong with it, never the address.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
// Local Supabase default; the same on every developer machine and not a secret.
const LOCAL_ADMIN_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// node-postgres lets these query parameters replace the host of the address.
const HOST_PARAMETERS = ['host', 'hostaddr'];

export type LocalAdminEnv = Readonly<Record<string, string | undefined>>;

export class LocalAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAddressError';
  }
}

/** Parses the address in the named variable and refuses it unless it points to this machine. */
export function localUrl(variable: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalAddressError(`${variable} is not a valid address`);
  }
  const elsewhere =
    !LOCAL_HOSTS.has(url.hostname) || HOST_PARAMETERS.some((name) => url.searchParams.has(name));
  if (elsewhere) {
    throw new LocalAddressError(
      `${variable} does not point to this machine; this command is for local use only`,
    );
  }
  return url;
}

/**
 * The server is TEST_DATABASE_URL, or the local Supabase default. The database is the one
 * DATABASE_URL names (the database the API uses) when that is set; from DATABASE_URL nothing else
 * is taken. An empty variable counts as not set.
 */
export function localAdminUrl(env: LocalAdminEnv): string {
  const admin = localUrl('TEST_DATABASE_URL', env.TEST_DATABASE_URL || LOCAL_ADMIN_URL);
  if (env.DATABASE_URL) {
    admin.pathname = localUrl('DATABASE_URL', env.DATABASE_URL).pathname;
  }
  return admin.toString();
}
