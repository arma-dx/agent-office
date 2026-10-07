import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // The worker's own test database: the API's fixtures plus the repository's cards, skills and
    // tool catalog, written by the real sync.
    globalSetup: ['./test/setup.ts'],
    // The runs commit their transactions and some cases stop an agent: one file at a time.
    fileParallelism: false,
  },
});
