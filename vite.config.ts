import { defineConfig } from 'vite';
import { worldFilesPlugin } from './tools/world-files-plugin.mjs';

export default defineConfig(({ mode }) => ({
  base: './',
  // Disk middleware is exercised separately against real local HTTP servers.
  plugins: mode === 'test' ? [] : [worldFilesPlugin()],
  // .tmp/ is scratch space for local check scripts (screenshots, browser profiles with thousands of files); none of
  // it is part of the game, and watching it made the dev server crawl at startup.
  server: { watch: { ignored: ['**/.tmp/**'] } },
  build: {
    rollupOptions: { input: { game: 'index.html', editor: 'editor/index.html' } },
    target: 'es2022',
    // Three.js is a single large dependency; one chunk is intentional.
    chunkSizeWarningLimit: 900,
  },
}));
