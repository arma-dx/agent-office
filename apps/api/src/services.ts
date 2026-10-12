import type { AgentRunSender } from '@agent-office/db';
import type { AuthProvider } from './auth/provider.ts';
import type { Pool, RequestRunner } from './db.ts';
import type { ServerConfig } from './env.ts';
import type { ProjectFileStore } from './files/store.ts';
import type { GithubService } from './github/index.ts';
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
  // The one way to the file storage (rule 9); its `available` is false where none is set up.
  files: ProjectFileStore;
  // Hands a route the GitHub client of its company; with no app configured every company is
  // "not configured". The apps' keys live inside it and nowhere else (rule 6).
  github: GithubService;
  // How many bytes of uploads are held in memory at once; the default is UPLOAD_BUFFER_BYTES.
  uploadBufferBytes?: number;
  // The same for downloads; the default is DOWNLOAD_BUFFER_BYTES.
  downloadBufferBytes?: number;
  // How long the body of an upload may take to arrive; the default is uploadDeadlineMs.
  uploadDeadlineMs?: (declaredBytes: number) => number;
  // How long the answer of a download may take to be read; the default is uploadDeadlineMs too.
  downloadDeadlineMs?: (sizeBytes: number) => number;
}

export interface RouteDeps extends ServerServices {
  // rateLimits, or the defaults.
  limits: RateLimits;
  runner: RequestRunner;
}
