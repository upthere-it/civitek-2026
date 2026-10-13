import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Il client importa shared come sorgente TS (il server lo usa compilato in CJS).
export default defineConfig({
  resolve: {
    alias: {
      '@sp/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true, // raggiungibile dal telefono sulla stessa rete
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    target: 'es2020', // Safari iOS 14+ e browser in-app
    assetsDir: 'static', // public/assets/ resta degli asset di gioco; qui i bundle con hash (cache lunga)
    assetsInlineLimit: 0, // gli asset pixel art restano file separati
  },
});
