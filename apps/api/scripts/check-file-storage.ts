import { randomBytes, randomUUID } from 'node:crypto';
import { fileStorageSettings, loadApiEnv } from '../src/env.ts';
import { FileStorageError, createFileStorage } from '../src/files/storage.ts';

/**
 * Checks the file storage an environment is set up with (FILE_STORAGE_DIR, or SUPABASE_URL,
 * SUPABASE_SECRET_KEY and SUPABASE_STORAGE_BUCKET): writes one small object, reads it back,
 * replaces it, removes it and reads that it is gone. Run once after the bucket was created and
 * whenever the key changes. It prints what it did and never a key, an address or the content.
 *
 * Usage (from the repository root): pnpm files:check
 */
const NO_COMPANY = '00000000-0000-0000-0000-000000000000';

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
}

main().catch((error: unknown) => {
  // A storage error says the operation and the HTTP status, nothing else.
  console.error(
    error instanceof FileStorageError || error instanceof Error ? error.message : 'failed',
  );
  process.exitCode = 1;
});
