import { defineConfig } from 'vite';

// Dev: UI on 4191, bridge (server/index.mjs --dev) on 4192.
export default defineConfig({
  // Relative asset paths: works at / (bridge, Electron) and under /lz-scopes/ (GitHub Pages).
  base: './',
  server: {
    port: 4191,
    strictPort: true,
    proxy: {
      '/stream': { target: 'ws://127.0.0.1:4192', ws: true },
      '/api': 'http://127.0.0.1:4192',
      '/out': { target: 'http://127.0.0.1:4192', ws: true },
      '/control': { target: 'ws://127.0.0.1:4192', ws: true },
      '/meter': { target: 'ws://127.0.0.1:4192', ws: true },
      '/clock': { target: 'ws://127.0.0.1:4192', ws: true },
    },
  },
  build: { target: 'es2022' },
});
