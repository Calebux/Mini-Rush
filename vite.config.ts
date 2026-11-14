import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // the game, plus the public pages served at /stats (players) and /economy (live ledger)
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        stats: resolve(root, 'stats/index.html'),
        economy: resolve(root, 'economy/index.html')
      }
    }
  },
  // Vite's default permits localhost and IPs. For a named phone-testing tunnel,
  // set __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS to that exact host.
  preview: { host: 'localhost' },
  server: { host: 'localhost' }
});
