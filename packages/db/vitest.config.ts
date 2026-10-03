import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // Creates the test database, applies the migrations, prepares the restricted login role and
    // the fixtures.
    globalSetup: ['./test/setup.ts'],
    // Each test runs in its own transaction and is rolled back; the files still run one by one.
    fileParallelism: false,
  },
});
