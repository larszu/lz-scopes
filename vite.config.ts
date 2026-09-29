import { defineConfig } from 'vite';

// Dev: UI on 4191, bridge (server/index.mjs --dev) on 4190.
export default defineConfig({
  server: {
    port: 4191,
    strictPort: true,
    proxy: {
      '/stream': { target: 'ws://127.0.0.1:4190', ws: true },
      '/api': 'http://127.0.0.1:4190',
      '/out': { target: 'http://127.0.0.1:4190', ws: true },
      '/control': { target: 'ws://127.0.0.1:4190', ws: true },
    },
  },
  build: { target: 'es2022' },
});
