import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // A separate test database for the queue tests (same setup as packages/db, different name).
    globalSetup: ['./test/setup.ts'],
  },
});
