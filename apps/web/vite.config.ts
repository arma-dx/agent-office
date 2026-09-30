/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Panel ortam değişkeni okumaz: .env yüklenmez, VITE_ önekli süreç değişkenleri de pakete girmez.
  envDir: false,
  envPrefix: 'PANEL_PUBLIC_',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Tarayıcı yalnızca göreli /api/ çağırır; geliştirmede yerel Fastify'a aktarılır.
      '/api/': { target: 'http://127.0.0.1:3000' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
