import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { mintFileReadToken } from './file-read-token.ts';

/**
 * Makes the worker's read token for one environment (docs/supabase-kurulum.md section 9). It
 * asks on the terminal for the JWT secret of the Supabase project, without showing what is
 * typed, and prints the token and the day it ends: nothing else. It reads no .env, writes no
 * file and keeps nothing; the secret is not put on the command line, where the shell would
 * remember it.
 *
 * Usage (from the repository root): pnpm files:mint-read-token
 * Then: the token goes into the worker's secrets as SUPABASE_STORAGE_READ_TOKEN, and
 * `pnpm files:check` tries it.
 */
const secretSchema = z.string().trim().min(20);

function askSecret(): Promise<string> {
  // Readline echoes what is typed to its output; this output shows nothing.
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const terminal = createInterface({ input: process.stdin, output: silent, terminal: true });
  process.stdout.write('JWT secret of the Supabase project (not shown while you type): ');
  return new Promise((resolve) => {
    terminal.question('', (answer) => {
      terminal.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const secret = secretSchema.safeParse(await askSecret());
if (!secret.success) {
  console.error('That is not a JWT secret (too short); nothing was made.');
  process.exit(1);
}
const { token, endsOn } = mintFileReadToken(secret.data, Date.now());
console.log(token);
console.log(`Ends on ${endsOn}.`);
