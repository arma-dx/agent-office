// Rule 6: secret values never reach the logs.
// Every value whose key looks like a secret is redacted at any depth in plain objects (formatters.log).
// The Fastify request object is not a plain object; its headers are redacted through pino redact paths.
// Secret values are never attached to error objects, and env or config objects are never logged whole.

export const REDACTED = '[REDACTED]';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers.apikey',
  'res.headers["set-cookie"]',
];

// An exact name match, or a name ending in "_token", "-key", "_secret", "_password".
// Counters such as "input_tokens" do not match; they are needed for cost records.
const SECRET_KEY_PATTERN =
  /^(pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|set-cookie|credentials?|database_url|dsn|connection_?string)$|[-_](secret|token|key|password)$/i;
// camelCase: apiKey, accessToken, clientSecret.
const SECRET_KEY_CAMEL_PATTERN = /[a-z0-9](Secret|Token|Key|Password)$/;
const MAX_DEPTH = 8;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || SECRET_KEY_CAMEL_PATTERN.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => redactValue(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSecretKey(key) ? REDACTED : redactValue(child, depth + 1);
  }
  return result;
}

export function redact(object: Record<string, unknown>): Record<string, unknown> {
  return redactValue(object, 0) as Record<string, unknown>;
}

// The query string (e.g. the code in an OAuth callback) is never written to the log.
export function stripQuery(url: string): string {
  const question = url.indexOf('?');
  return question === -1 ? url : url.slice(0, question);
}
