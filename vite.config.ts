import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // the game, plus the public player-stats page served at /stats
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        stats: resolve(root, 'stats/index.html')
      }
    }
  },
  // phone testing via ngrok etc.
  preview: { allowedHosts: true },
  server: { allowedHosts: true }
});
