import { agentRunSender, createPool, createQueue, ensureAgentRunQueues } from '@agent-office/db';
import { GoogleAuthProvider } from './auth/google.ts';
import { assertRestrictedRole } from './db.ts';
import { fileStorageSettings, loadApiEnv, serverConfig } from './env.ts';
import { loggableError } from './errors.ts';
import { createFileStorage } from './files/storage.ts';
import { ProjectFileStore } from './files/store.ts';
import { buildServer } from './server.ts';

const env = loadApiEnv(process.env);
const config = serverConfig(env);

// The pool's error listener needs the server's logger; it is only called after the server exists.
const pool = createPool(env.DATABASE_URL, 'agent-office-api', (error) => {
  app.log.error({ failure: loggableError(error) }, 'idle database connection failed');
});
const google = config.google ? new GoogleAuthProvider(config.google) : null;
// The API only puts agent runs on the queue, inside the transaction of the request that calls for
// them; the worker consumes them. Same restricted role as the pool.
const queue = createQueue(
  env.DATABASE_URL,
  (error) => {
    app.log.error({ failure: loggableError(error) }, 'queue connection failed');
  },
  'sender',
);

// Built here, once, from the environment: the storage's key goes to the file module and nowhere
// else (not into the config the routes get).
const fileStorage = createFileStorage(fileStorageSettings(env));

const app = buildServer({
  logLevel: env.LOG_LEVEL,
  services: {
    config,
    pool,
    authProvider: google,
    jobs: agentRunSender(queue),
    files: new ProjectFileStore(fileStorage),
  },
});

if (google) {
  // Discovery is cached; if Google cannot be reached now, the next sign-in tries again.
  google.discover().catch((error: unknown) => {
    app.log.warn({ failure: loggableError(error) }, 'Google discovery failed at startup');
  });
} else {
  app.log.warn('Google sign-in is not configured');
}
if (fileStorage === null) {
  app.log.warn('File storage is not set up; project files cannot be added or opened');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => queue.stop({ graceful: false }))
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

// The queue schema comes from the migrations; the two agent run queues are created by whichever of
// the API and the worker starts first.
try {
  await queue.start();
  await ensureAgentRunQueues(queue);
} catch (error) {
  app.log.fatal({ failure: loggableError(error) }, 'queue could not be started; not starting');
  await pool.end();
  process.exit(1);
}

await app.listen({ host: env.HOST, port: env.PORT });
