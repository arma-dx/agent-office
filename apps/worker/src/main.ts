import { loadWorkerEnv } from './env.ts';
import { startWorker } from './worker.ts';

const env = loadWorkerEnv(process.env);

try {
  const worker = await startWorker(env);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      worker.stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
} catch (error) {
  // The reason only: a connection error's own text can carry the address.
  const reason =
    error instanceof Error && !('severity' in error) && !('address' in error)
      ? error.message
      : 'the database or the queue could not be reached';
  console.error(`The worker did not start: ${reason}`);
  process.exit(1);
}
