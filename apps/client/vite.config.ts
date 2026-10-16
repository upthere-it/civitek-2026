import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Il client riceve di game_items.json solo i campi da mostrare. Restano fuori `reference_ids` (modelli reali di
 * catalog_reference.json, CLAUDE.md "cosa NON fare"), i valori base e i pesi dei drop: li conosce solo il server.
 */
const CLIENT_ITEM_FIELDS = ['id', 'brand', 'name', 'display_name', 'colorway', 'silhouette', 'palette', 'tier', 'rarity', 'flavor'];

function clientItems(): Plugin {
  return {
    name: 'sp-client-items',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]data[\\/]game_items\.json$/.test(id)) return null;
      const { items } = JSON.parse(code) as { items: Record<string, unknown>[] };
      const slim = items.map((it) => Object.fromEntries(CLIENT_ITEM_FIELDS.map((k) => [k, it[k]])));
      return { code: JSON.stringify({ items: slim }), map: null };
    },
  };
}

// Il client importa shared come sorgente TS (il server lo usa compilato in CJS).
export default defineConfig({
  plugins: [clientItems()],
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
    rollupOptions: {
      // il gioco e la pagina /privacy (privacy/index.html: /privacy/ sia con Vite sia con nginx)
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy/index.html', import.meta.url)),
      },
    },
  },
});
