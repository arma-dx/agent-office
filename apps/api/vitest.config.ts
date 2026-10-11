import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // Creates the API's test database, applies the migrations, prepares the restricted login role
    // and loads the fixtures.
    globalSetup: ['./test/setup.ts'],
    // The routes commit their transactions, so the files share one database state: one at a time.
    fileParallelism: false,
    // A case walks a request through many calls of the API against the database. In the run of
    // the whole repository these cases share the machine with every other package's tests and
    // take up to four times as long as alone (measured: 6 s for one walk that takes 1.5 s alone),
    // so the default of 5 s failed them for the clock and left their rows to the cases after them.
    testTimeout: 20_000,
  },
});
