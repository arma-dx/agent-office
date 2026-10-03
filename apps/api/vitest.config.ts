import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // Creates the API's test database, applies the migrations, prepares the restricted login role
    // and loads the fixtures.
    globalSetup: ['./test/setup.ts'],
    // The routes commit their transactions, so the files share one database state: one at a time.
    fileParallelism: false,
  },
});
