import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'node',
    // Test veritabanını açar, göçleri uygular, kısıtlı giriş rolünü ve test verisini hazırlar.
    globalSetup: ['./test/kurulum.ts'],
    // Her test kendi transaction'ında koşar ve geri alınır; dosyalar yine de sırayla koşar.
    fileParallelism: false,
  },
});
