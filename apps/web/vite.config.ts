/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const kokDizin = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Kökteki .env'den yalnızca PORT okunur; geliştirme sunucusunun API adresi içindir, pakete girmez.
  const apiPort = loadEnv(mode, kokDizin, 'PORT').PORT ?? '3000';

  return {
    plugins: [
      // Yönlendirici eklentisi react()'ten önce gelir; src/routes altından routeTree.gen.ts üretir.
      tanstackRouter({ target: 'react', autoCodeSplitting: true, quoteStyle: 'single' }),
      react(),
      tailwindcss(),
    ],
    resolve: { tsconfigPaths: true },
    // Panel ortam değişkeni okumaz: .env yüklenmez, VITE_ önekli süreç değişkenleri de pakete girmez.
    envDir: false,
    envPrefix: 'PANEL_PUBLIC_',
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // Tarayıcı yalnızca göreli /api/ çağırır; geliştirmede yerel Fastify'a aktarılır.
        '/api/': { target: `http://127.0.0.1:${apiPort}` },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
