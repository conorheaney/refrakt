import { createServer } from 'vite';
import { createWorldStore, worldFileMiddleware } from './world-store.mjs';

export function worldFilesPlugin() {
  let root;
  async function middleware(server) {
    const { validateWorld, isPlayable } = await server.ssrLoadModule('/src/content/authoredWorlds.ts');
    return worldFileMiddleware(createWorldStore(root, validateWorld, isPlayable));
  }
  return {
    name: 'refrakt-world-files',
    // Saves must not trigger a full-page reload while the editor is awaiting its response.
    config() {
      return { server: { watch: { ignored: ['**/public/worlds/**', '**/world-backups/**'] } } };
    },
    configResolved(config) {
      root = config.root;
    },
    async configureServer(server) {
      server.middlewares.use(await middleware(server));
    },
    async configurePreviewServer(server) {
      // Preview serves built assets, but validation uses exactly the same schema as the game/editor.
      const validator = await createServer({
        root,
        configFile: false,
        server: { middlewareMode: true, ws: false },
        appType: 'custom',
      });
      try {
        server.middlewares.use(await middleware(validator));
      } finally {
        await validator.close();
      }
    },
  };
}
