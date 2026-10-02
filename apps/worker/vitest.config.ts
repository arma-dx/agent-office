import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // Kuyruk testleri için ayrı test veritabanı (packages/db ile aynı kurulum, ayrı ad).
    globalSetup: ['./test/kurulum.ts'],
  },
});
