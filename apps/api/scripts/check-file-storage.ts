import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fileStorageSettings, loadApiEnv } from '../src/env.ts';
import { FileStorageError, createFileStorage } from '../src/files/storage.ts';
import { ReadTokenCheckError, checkReadToken } from './read-token-check.ts';

/**
 * Checks the file storage an environment is set up with (FILE_STORAGE_DIR, or SUPABASE_URL,
 * SUPABASE_SECRET_KEY and SUPABASE_STORAGE_BUCKET): writes one small object, reads it back,
 * replaces it, removes it and reads that it is gone. Run once after the bucket was created and
 * whenever the key changes. It prints what it did and never a key, an address or the content.
 *
 * When the worker's two values are in the environment too (SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_STORAGE_READ_TOKEN: the token agents' file reads go through), it then proves that
 * token on the same storage: it reads what the API's key wrote and can neither write nor delete
 * (read-token-check.ts). A token that fails a line must not be given to the worker.
 *
 * Usage (from the repository root): pnpm files:check
 */
const NO_COMPANY = '00000000-0000-0000-0000-000000000000';

const emptyAsMissing = (value: unknown): unknown => (value === '' ? undefined : value);
// The worker's own two variables (apps/worker/src/env.ts); the API's environment has neither.
const readTokenEnvSchema = z.object({
  SUPABASE_PUBLISHABLE_KEY: z.preprocess(emptyAsMissing, z.string().trim().min(20).optional()),
  SUPABASE_STORAGE_READ_TOKEN: z.preprocess(emptyAsMissing, z.string().trim().min(20).optional()),
});

async function main(): Promise<void> {
  const settings = fileStorageSettings(loadApiEnv(process.env));
  const storage = createFileStorage(settings);
  if (!storage || !settings) {
    throw new Error('No file storage is set up: see the file storage lines of .env.example');
  }
  console.log(`File storage: ${settings.kind}`);
  const key = `${NO_COMPANY}/check/${randomUUID()}`;
  const first = randomBytes(1024);
  const second = randomBytes(2048);
  await storage.put(key, first, 'application/octet-stream');
  console.log('ok  write');
  if (!(await storage.get(key, 4096))?.equals(first)) throw new Error('read: not what was written');
  console.log('ok  read');
  await storage.put(key, second, 'application/octet-stream');
  if (!(await storage.get(key, 4096))?.equals(second)) throw new Error('replace: the old bytes');
  console.log('ok  replace');
  await storage.remove(key);
  if ((await storage.get(key, 4096)) !== null) throw new Error('remove: the object is still there');
  await storage.remove(key);
  console.log('ok  remove (also of an object that is gone)');

  const reading = readTokenEnvSchema.safeParse(process.env);
  if (!reading.success) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY or SUPABASE_STORAGE_READ_TOKEN is not a key');
  }
  const publishableKey = reading.data.SUPABASE_PUBLISHABLE_KEY;
  const readToken = reading.data.SUPABASE_STORAGE_READ_TOKEN;
  if (settings.kind !== 'supabase' || publishableKey === undefined || readToken === undefined) {
    console.log('skip  read token (not set)');
    return;
  }
  await checkReadToken(
    storage,
    { url: settings.url, bucket: settings.bucket, publishableKey, readToken },
    (line) => {
      console.log(line);
    },
  );
}

main().catch((error: unknown) => {
  // A storage error says the operation and the HTTP status, nothing else.
  console.error(
    error instanceof FileStorageError || error instanceof Error ? error.message : 'failed',
  );
  if (error instanceof ReadTokenCheckError) {
    console.error('The worker must not be started with this token.');
  }
  process.exitCode = 1;
});
