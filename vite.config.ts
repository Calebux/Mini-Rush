import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022'
  },
  // phone testing via ngrok etc.
  preview: { allowedHosts: true },
  server: { allowedHosts: true }
});
