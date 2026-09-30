import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@agent-office/shared';

// Kural 6: gizli değerler loglara girmez. Joker yalnızca bir düzeyi kapsar; ortam nesnesi hiç loglanmaz.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  'headers["set-cookie"]',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.headers["x-api-key"]',
  '*.password',
  '*.token',
  '*.*.token',
  '*.secret',
  '*.apiKey',
];

export interface BuildServerOptions {
  logger?: false;
  logLevel?: string;
  logStream?: { write: (line: string) => void };
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? {
      level: opts.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
    logController: new LogController({
      disableRequestLogging: (req) => req.url === '/api/health',
    }),
  });

  app.get('/api/health', (): HealthResponse => ({ status: 'ok', service: 'api' }));

  return app;
}
