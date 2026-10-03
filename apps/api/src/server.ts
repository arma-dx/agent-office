import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@agent-office/shared';
import { REDACTED, REDACT_PATHS, redact, stripQuery } from './log.ts';

export interface BuildServerOptions {
  logger?: false;
  logLevel?: string;
  logStream?: { write: (line: string) => void };
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? {
      level: opts.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      serializers: {
        req: (req) => ({ method: req.method, url: stripQuery(req.url), reqId: req.id }),
      },
      formatters: { log: redact },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
    logController: new LogController({
      disableRequestLogging: (req) => stripQuery(req.url) === '/api/health',
    }),
  });

  // The default 404 handler writes the raw URL, query string included, to the log.
  // The message may reach the user, so it stays Turkish like the rest of the interface.
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Bulunamadı' }),
  );

  app.get('/api/health', (): HealthResponse => ({ status: 'ok', service: 'api' }));

  return app;
}
