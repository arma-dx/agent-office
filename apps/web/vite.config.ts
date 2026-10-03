/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));

const FRAME_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
};

export default defineConfig(({ mode }) => {
  // Only PORT is read from the root .env; it is for the dev server's API address and does not enter the bundle.
  const apiPort = loadEnv(mode, rootDir, 'PORT').PORT ?? '3000';

  return {
    plugins: [
      // The router plugin comes before react(); it generates routeTree.gen.ts from src/routes.
      tanstackRouter({ target: 'react', autoCodeSplitting: true, quoteStyle: 'single' }),
      react(),
      tailwindcss(),
    ],
    resolve: { tsconfigPaths: true },
    // The panel reads no environment variables: .env is not loaded, and VITE_ prefixed process variables do not enter the bundle.
    envDir: false,
    envPrefix: 'PANEL_PUBLIC_',
    server: {
      port: 5173,
      strictPort: true,
      // Like the web server in production: no other page may show the panel in a frame.
      headers: FRAME_HEADERS,
      proxy: {
        // The browser only calls the relative /api/; in development it is forwarded to the local Fastify.
        '/api/': { target: `http://127.0.0.1:${apiPort}` },
      },
    },
    preview: { headers: FRAME_HEADERS },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
