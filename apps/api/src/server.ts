import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@agent-office/shared';
import { MASKE, REDACT_PATHS, gizle, sorgusuzYol } from './log.ts';

export interface BuildServerOptions {
  logger?: false;
  logLevel?: string;
  logStream?: { write: (line: string) => void };
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? {
      level: opts.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: MASKE },
      serializers: {
        req: (req) => ({ method: req.method, url: sorgusuzYol(req.url), reqId: req.id }),
      },
      formatters: { log: gizle },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
    logController: new LogController({
      disableRequestLogging: (req) => sorgusuzYol(req.url) === '/api/health',
    }),
  });

  // Varsayılan 404 işleyicisi ham adresi, sorgu dizesiyle birlikte loga yazar.
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Bulunamadı' }),
  );

  app.get('/api/health', (): HealthResponse => ({ status: 'ok', service: 'api' }));

  return app;
}
