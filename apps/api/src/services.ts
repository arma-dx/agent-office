import type { AgentRunSender } from '@agent-office/db';
import type { AuthProvider } from './auth/provider.ts';
import type { Pool, RequestRunner } from './db.ts';
import type { ServerConfig } from './env.ts';
import type { RateLimits } from './security.ts';

/** What the signed-in routes need. Without it the server answers only /api/health. */
export interface ServerServices {
  config: ServerConfig;
  // Pool of the restricted login role (rule 9). The caller owns it and ends it.
  pool: Pool;
  // null: Google sign-in is not configured.
  authProvider: AuthProvider | null;
  rateLimits?: RateLimits;
  // Puts agent runs on the queue inside the request's transaction (rule 10: ids only).
  jobs: AgentRunSender;
}

export interface RouteDeps extends ServerServices {
  // rateLimits, or the defaults.
  limits: RateLimits;
  runner: RequestRunner;
}
