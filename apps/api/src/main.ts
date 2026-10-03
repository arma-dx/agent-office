import { createPool } from '@agent-office/db';
import { GoogleAuthProvider } from './auth/google.ts';
import { assertRestrictedRole } from './db.ts';
import { loadApiEnv, serverConfig } from './env.ts';
import { loggableError } from './errors.ts';
import { buildServer } from './server.ts';

const env = loadApiEnv(process.env);
const config = serverConfig(env);

// The pool's error listener needs the server's logger; it is only called after the server exists.
const pool = createPool(env.DATABASE_URL, 'agent-office-api', (error) => {
  app.log.error({ failure: loggableError(error) }, 'idle database connection failed');
});
const google = config.google ? new GoogleAuthProvider(config.google) : null;

const app = buildServer({
  logLevel: env.LOG_LEVEL,
  services: { config, pool, authProvider: google },
});

if (google) {
  // Discovery is cached; if Google cannot be reached now, the next sign-in tries again.
  google.discover().catch((error: unknown) => {
    app.log.warn({ failure: loggableError(error) }, 'Google discovery failed at startup');
  });
} else {
  app.log.warn('Google sign-in is not configured');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => pool.end())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ failure: loggableError(error) }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}

// Rule 9: never serve with a role that switches the row policies off. An unreachable database
// stops the start too; the container is restarted.
try {
  await assertRestrictedRole(pool);
} catch (error) {
  app.log.fatal({ failure: loggableError(error) }, 'database role check failed; not starting');
  await pool.end();
  process.exit(1);
}

await app.listen({ host: env.HOST, port: env.PORT });
