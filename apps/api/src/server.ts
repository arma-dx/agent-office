import cookie from '@fastify/cookie';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@agent-office/shared';
import { RequestRunner } from './db.ts';
import { errorBody, errorHandler } from './errors.ts';
import { REDACTED, REDACT_PATHS, redact, stripQuery } from './log.ts';
import { registerAgentRoutes } from './routes/agents.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerInvitationRoutes } from './routes/invitations.ts';
import { registerMemberRoutes } from './routes/members.ts';
import { registerOfficeRoutes } from './routes/office.ts';
import { registerPasskeyRoutes } from './routes/passkeys.ts';
import { registerProjectFileRoutes } from './routes/project-files.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerRequestRoutes } from './routes/requests.ts';
import { registerSessionRoutes } from './routes/session.ts';
import { registerTodayRoutes } from './routes/today.ts';
import { DEFAULT_RATE_LIMITS, registerRateLimit, sameOriginGuard } from './security.ts';
import type { RouteDeps, ServerServices } from './services.ts';

export type { ServerServices } from './services.ts';

// Request bodies are small JSON objects. The one exception is the upload of a project file: its
// route has a scope and a parser of its own for raw bytes (routes/project-files.ts).
const BODY_LIMIT_BYTES = 64 * 1024;

export interface BuildServerOptions {
  logger?: false;
  logLevel?: string;
  logStream?: { write: (line: string) => void };
  // Without services only /api/health is served (log tests, smoke check).
  services?: ServerServices;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const services = opts.services;
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
    // X-Forwarded-For is believed only from the listed proxies (TRUST_PROXY), never from anyone.
    trustProxy: services?.config.trustProxy ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
  });

  app.setErrorHandler(errorHandler);
  // The default 404 handler writes the raw URL, query string included, to the log.
  // The message may reach the user, so it stays Turkish like the rest of the interface.
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send(errorBody('not_found', 'Bulunamadı.')),
  );
  // Bodies are JSON only (and raw bytes on the one upload route, which a form cannot send): the
  // text/plain parser would let a cross-site form post a body.
  app.removeContentTypeParser('text/plain');
  // Answers carry personal data and session state; no cache keeps them. No other page may show an
  // answer in a frame (the panel's own pages get the same headers from the web server).
  app.addHook('onRequest', (_request, reply, done) => {
    reply.header('cache-control', 'no-store');
    reply.header('content-security-policy', "frame-ancestors 'none'");
    reply.header('x-frame-options', 'DENY');
    done();
  });

  app.get('/api/health', { config: { rateLimit: false } }, (): HealthResponse => ({
    status: 'ok',
    service: 'api',
  }));

  if (services) {
    app.addHook('onRequest', sameOriginGuard(services.config.panelOrigin));
    void app.register(cookie, { secret: services.config.cookieSecret });
    const limits = services.rateLimits ?? DEFAULT_RATE_LIMITS;
    registerRateLimit(app, limits);
    const deps: RouteDeps = {
      ...services,
      limits,
      runner: new RequestRunner(services.pool, services.config),
    };
    // Registered after the cookie and rate limit plugins so that both apply to every route.
    void app.register((api, _options, done) => {
      registerAuthRoutes(api, deps);
      registerSessionRoutes(api, deps);
      registerInvitationRoutes(api, deps);
      registerMemberRoutes(api, deps);
      registerOfficeRoutes(api, deps);
      registerPasskeyRoutes(api, deps);
      registerRequestRoutes(api, deps);
      registerTodayRoutes(api, deps);
      registerAgentRoutes(api, deps);
      registerProjectRoutes(api, deps);
      registerProjectFileRoutes(api, deps);
      done();
    });
  }

  return app;
}
