import { defineConfig } from 'vite';
import { worldFilesPlugin } from './tools/world-files-plugin.mjs';

export default defineConfig(({ mode }) => ({
  base: './',
  // Disk middleware is exercised separately against real local HTTP servers.
  plugins: mode === 'test' ? [] : [worldFilesPlugin()],
  build: {
    rollupOptions: { input: { game: 'index.html', editor: 'editor/index.html' } },
    target: 'es2022',
    // Three.js is a single large dependency; one chunk is intentional.
    chunkSizeWarningLimit: 900,
  },
}));
