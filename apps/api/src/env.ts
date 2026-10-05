import { z } from 'zod';
import { APP_NAME } from '@agent-office/shared';
import { baseEnvSchema, parseEnv } from '@agent-office/shared/env';

/** Local development: Vite serves the panel here and forwards /api to this server. */
export const LOCAL_PANEL_ORIGIN = 'http://localhost:5173';
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

// An empty value in .env (NAME=) counts as missing.
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

function commaList<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    )
    .pipe(z.array(item));
}

const panelOrigin = z.string().refine(
  (value) => {
    if (value === LOCAL_PANEL_ORIGIN) return true;
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  },
  { message: `Must be an https origin without a path, or exactly ${LOCAL_PANEL_ORIGIN}` },
);

const domain = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, { message: 'Must be a domain name' }));

// trustProxy gets only addresses; `true` would trust every X-Forwarded-For value.
const proxyAddress = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

export const apiEnvSchema = baseEnvSchema
  .extend({
    // An empty value would listen on every interface, so it is rejected.
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Connection string of the restricted login role (rule 9); never the privileged role.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Where the panel is served; the API answers under PANEL_ORIGIN/api.
    PANEL_ORIGIN: panelOrigin,
    // Signs the short-lived login cookie (state, nonce and PKCE verifier of a Google sign-in).
    COOKIE_SECRET: z.string().min(32),
    // The three Google values come together; without them Google sign-in is "not configured".
    GOOGLE_CLIENT_ID: optional(z.string().trim().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().trim().min(1)),
    GOOGLE_REDIRECT_URI: optional(z.url({ protocol: /^https?$/ })),
    // External accounts must show a second factor in the ID token's amr claim (3 October
    // decision 8). Only a local trial may turn it off.
    AUTH_REQUIRE_AMR: optional(z.stringbool()).transform((value) => value ?? true),
    // Company Workspace domains: their addresses are accepted only from that Workspace (hd claim);
    // Workspace enforces two-step verification for them.
    COMPANY_EMAIL_DOMAINS: optional(commaList(domain)).transform((value) => value ?? []),
    // Addresses or CIDR ranges of the reverse proxies whose X-Forwarded-For is trusted: every proxy
    // between the client and the API (Caddy's network and Cloudflare's ranges). Required in
    // production, where the API always runs behind them; without it every person would share the
    // proxy's address, and its rate limit counters.
    TRUST_PROXY: optional(commaList(proxyAddress)),
  })
  .superRefine((env, ctx) => {
    // The redirect URI is not a secret and may be filled in ahead of the client values; on its
    // own it leaves Google sign-in "not configured". A client id or secret needs all three.
    const hasId = env.GOOGLE_CLIENT_ID !== undefined;
    const hasSecret = env.GOOGLE_CLIENT_SECRET !== undefined;
    const complete = hasId && hasSecret && env.GOOGLE_REDIRECT_URI !== undefined;
    if ((hasId || hasSecret) && !complete) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message:
          'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set together, with GOOGLE_REDIRECT_URI',
      });
    }
    if (
      env.GOOGLE_REDIRECT_URI !== undefined &&
      env.GOOGLE_REDIRECT_URI !== `${env.PANEL_ORIGIN}${GOOGLE_CALLBACK_PATH}`
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_REDIRECT_URI'],
        message: `Must be PANEL_ORIGIN followed by ${GOOGLE_CALLBACK_PATH}`,
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.AUTH_REQUIRE_AMR) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_REQUIRE_AMR'],
          message: 'Must be true in production',
        });
      }
      if (env.PANEL_ORIGIN === LOCAL_PANEL_ORIGIN) {
        ctx.addIssue({
          code: 'custom',
          path: ['PANEL_ORIGIN'],
          message: 'Must be an https origin in production',
        });
      }
      if (env.TRUST_PROXY === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY'],
          message:
            "Must list the reverse proxies in production (Caddy's network, Cloudflare's ranges)",
        });
      }
    }
    if (env.TRUST_PROXY?.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'Must list addresses' });
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined>): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The WebAuthn relying party of the passkeys: the panel's host is the RP ID (one per environment:
 * office.armadx.com, office-test.armadx.com, localhost), and the panel's origin is the only origin
 * a ceremony is accepted from.
 */
export interface RelyingParty {
  id: string;
  name: string;
  origin: string;
}

/** What the server needs from the environment. Never logged as a whole (rule 6). */
export interface ServerConfig {
  panelOrigin: string;
  // http://localhost:5173: cookies without the __Host- prefix and without Secure.
  localCookies: boolean;
  cookieSecret: string;
  requireAmr: boolean;
  companyEmailDomains: readonly string[];
  trustProxy: string[] | null;
  google: GoogleSettings | null;
  relyingParty: RelyingParty;
}

export function serverConfig(env: ApiEnv): ServerConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
  return {
    panelOrigin: env.PANEL_ORIGIN,
    localCookies: env.PANEL_ORIGIN === LOCAL_PANEL_ORIGIN,
    cookieSecret: env.COOKIE_SECRET,
    requireAmr: env.AUTH_REQUIRE_AMR,
    companyEmailDomains: env.COMPANY_EMAIL_DOMAINS,
    trustProxy: env.TRUST_PROXY ?? null,
    google:
      GOOGLE_CLIENT_ID !== undefined &&
      GOOGLE_CLIENT_SECRET !== undefined &&
      GOOGLE_REDIRECT_URI !== undefined
        ? {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            redirectUri: GOOGLE_REDIRECT_URI,
          }
        : null,
    relyingParty: {
      id: new URL(env.PANEL_ORIGIN).hostname,
      name: APP_NAME,
      origin: env.PANEL_ORIGIN,
    },
  };
}
