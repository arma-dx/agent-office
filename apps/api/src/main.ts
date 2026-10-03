import { loadApiEnv } from './env.ts';
import { buildServer } from './server.ts';

const env = loadApiEnv(process.env);
const app = buildServer({ logLevel: env.LOG_LEVEL });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error);
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
