import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { isAbsolute } from 'node:path';
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

const httpsOrigin = z.string().refine(
  (value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  },
  { message: 'Must be an https origin without a path' },
);

/**
 * The private key of a GitHub App: the downloaded .pem file, base64 encoded on one line. Read into
 * a key object here, so that the text of the key lives nowhere in the process after the start. An
 * issue names the variable (its path) and never anything of the value.
 */
const githubPrivateKey = z.string().transform((value, ctx): KeyObject => {
  const refuse = (): never => {
    ctx.addIssue({
      code: 'custom',
      message: 'Must be the RSA private key of the GitHub App (the .pem file), base64 encoded',
    });
    return z.NEVER;
  };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return refuse();
  }
  try {
    const key = createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'pem' });
    return key.asymmetricKeyType === 'rsa' ? key : refuse();
  } catch {
    return refuse();
  }
});

// The short code of a company (companies.code). The founder space is no company (GitHub is
// connected to a company).
const githubCompanyCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, { message: 'Must be the code of a company' })
  .refine((value) => value !== 'founder_space', {
    message: 'Must be the code of a company, not of the founder space',
  });
// The name of a GitHub organisation as GitHub writes it. Loose on purpose: it keeps free text
// out, it does not define what GitHub allows.
const githubOrganization = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}$/, { message: 'Must be the name of a GitHub organisation' });
const githubClientId = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/, { message: 'Must be the client ID of a GitHub App' });

/** The slots of the GitHub Apps: one per company (12 October decision 12). */
export const GITHUB_APP_SLOTS = [1, 2] as const;
const GITHUB_APP_VALUES = ['COMPANY', 'ORGANIZATION', 'CLIENT_ID', 'PRIVATE_KEY'] as const;

/** The public half of a key, hashed: says whether two slots hold one and the same key. */
function keyFingerprint(key: KeyObject): string {
  return createHash('sha256')
    .update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

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
    // Signs the short-lived login cookie (state, nonce and PKCE verifier of a Google sign-in); the
    // key of the upload tickets of project files is derived from it.
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
    // The file storage of the project files (8 October decision 20). Either a folder of this
    // machine (local development only), or Supabase Storage: the project's address, a secret key
    // and the bucket, set together. With none of them the file storage is "not set up": the
    // Dosyalar tab says so and nothing can be added, opened or deleted.
    FILE_STORAGE_DIR: optional(
      z.string().refine((value) => isAbsolute(value), { message: 'Must be an absolute path' }),
    ),
    SUPABASE_URL: optional(httpsOrigin),
    SUPABASE_SECRET_KEY: optional(z.string().trim().min(20)),
    SUPABASE_STORAGE_BUCKET: optional(
      z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { message: 'Must be a bucket name' }),
    ),
    // One GitHub App per company (8 October decisions 19 and 22; 12 October decisions 12 to 15):
    // the code of the company, the name of its GitHub organisation, the app's client ID and the
    // app's private key. A slot is set whole or left empty; an empty slot means "not configured"
    // for that company.
    GITHUB_APP_1_COMPANY: optional(githubCompanyCode),
    GITHUB_APP_1_ORGANIZATION: optional(githubOrganization),
    GITHUB_APP_1_CLIENT_ID: optional(githubClientId),
    GITHUB_APP_1_PRIVATE_KEY: optional(githubPrivateKey),
    GITHUB_APP_2_COMPANY: optional(githubCompanyCode),
    GITHUB_APP_2_ORGANIZATION: optional(githubOrganization),
    GITHUB_APP_2_CLIENT_ID: optional(githubClientId),
    GITHUB_APP_2_PRIVATE_KEY: optional(githubPrivateKey),
  })
  .superRefine((env, ctx) => {
    for (const slot of GITHUB_APP_SLOTS) {
      const set = GITHUB_APP_VALUES.filter(
        (value) => env[`GITHUB_APP_${slot}_${value}`] !== undefined,
      ).length;
      if (set !== 0 && set !== GITHUB_APP_VALUES.length) {
        ctx.addIssue({
          code: 'custom',
          path: [`GITHUB_APP_${slot}_COMPANY`],
          message: `GITHUB_APP_${slot}_COMPANY, _ORGANIZATION, _CLIENT_ID and _PRIVATE_KEY are set together`,
        });
      }
    }
    // Two apps never share a company, an organisation, a client ID or a key: the credentials of
    // the two companies are two credentials.
    const differ = (value: (typeof GITHUB_APP_VALUES)[number], same: boolean): void => {
      if (same) {
        ctx.addIssue({
          code: 'custom',
          path: [`GITHUB_APP_2_${value}`],
          message: `GITHUB_APP_1_${value} and GITHUB_APP_2_${value} must differ`,
        });
      }
    };
    const first = env.GITHUB_APP_1_COMPANY;
    differ('COMPANY', first !== undefined && first === env.GITHUB_APP_2_COMPANY);
    const organization = env.GITHUB_APP_1_ORGANIZATION?.toLowerCase();
    differ(
      'ORGANIZATION',
      organization !== undefined && organization === env.GITHUB_APP_2_ORGANIZATION?.toLowerCase(),
    );
    const clientId = env.GITHUB_APP_1_CLIENT_ID;
    differ('CLIENT_ID', clientId !== undefined && clientId === env.GITHUB_APP_2_CLIENT_ID);
    const keys = [env.GITHUB_APP_1_PRIVATE_KEY, env.GITHUB_APP_2_PRIVATE_KEY];
    differ(
      'PRIVATE_KEY',
      keys[0] !== undefined &&
        keys[1] !== undefined &&
        keyFingerprint(keys[0]) === keyFingerprint(keys[1]),
    );

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
    const supabase = [env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, env.SUPABASE_STORAGE_BUCKET];
    const supabaseSet = supabase.filter((value) => value !== undefined).length;
    if (supabaseSet !== 0 && supabaseSet !== supabase.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_STORAGE_BUCKET are set together',
      });
    }
    if (env.FILE_STORAGE_DIR !== undefined && supabaseSet !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['FILE_STORAGE_DIR'],
        message: 'Set either FILE_STORAGE_DIR or the Supabase storage values, not both',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.FILE_STORAGE_DIR !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['FILE_STORAGE_DIR'],
          message: 'Must be empty in production; files are kept in Supabase Storage',
        });
      }
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

/** Where the project files lie: a folder of this machine, or a bucket of Supabase Storage. */
export type FileStorageSettings =
  { kind: 'disk'; dir: string } | { kind: 'supabase'; url: string; key: string; bucket: string };

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

/**
 * The GitHub App of one company: the company's short code, the name of the GitHub organisation
 * that must own the app, the app's client ID (the issuer of its signature) and its private key.
 */
export interface GithubAppConfig {
  companyCode: string;
  organization: string;
  clientId: string;
  privateKey: KeyObject;
}

/**
 * The GitHub Apps an environment is set up with: none, one or two, one per company. Kept out of
 * ServerConfig on purpose, like the file storage: the config travels to every route, and an app's
 * private key belongs to the GitHub module alone (rule 6). Only main.ts calls this, to build the
 * GitHub service.
 */
export function githubAppConfigs(env: ApiEnv): GithubAppConfig[] {
  const apps: GithubAppConfig[] = [];
  for (const slot of GITHUB_APP_SLOTS) {
    const companyCode = env[`GITHUB_APP_${slot}_COMPANY`];
    const organization = env[`GITHUB_APP_${slot}_ORGANIZATION`];
    const clientId = env[`GITHUB_APP_${slot}_CLIENT_ID`];
    const privateKey = env[`GITHUB_APP_${slot}_PRIVATE_KEY`];
    if (
      companyCode !== undefined &&
      organization !== undefined &&
      clientId !== undefined &&
      privateKey !== undefined
    ) {
      apps.push({ companyCode, organization, clientId, privateKey });
    }
  }
  return apps;
}

/**
 * The file storage an environment is set up with; null when it has none. Kept out of ServerConfig
 * on purpose: the config travels to every route, and the secret key of the storage belongs to the
 * file module alone (rule 9). Only main.ts and the check script call this, to build the storage.
 */
export function fileStorageSettings(env: ApiEnv): FileStorageSettings | null {
  return env.FILE_STORAGE_DIR !== undefined
    ? { kind: 'disk', dir: env.FILE_STORAGE_DIR }
    : env.SUPABASE_URL !== undefined &&
        env.SUPABASE_SECRET_KEY !== undefined &&
        env.SUPABASE_STORAGE_BUCKET !== undefined
      ? {
          kind: 'supabase',
          url: env.SUPABASE_URL,
          key: env.SUPABASE_SECRET_KEY,
          bucket: env.SUPABASE_STORAGE_BUCKET,
        }
      : null;
}
