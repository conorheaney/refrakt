import './styles.css';
import { Game } from './Game';
import { loadForgeTextures } from '../themes/blocks/forge/forgeAssets';
import { authoredEntry, readLibrary, validateWorld, type AuthoredWorld } from '../content/authoredWorlds';
import { Campaign } from '../content/campaign';
import { buildCampaign, loadFileWorlds } from '../content/fileWorlds';
import { parseLaunchOptions } from './launchOptions';

function fatal(root: HTMLElement | null, message: string): void {
  if (!root) return;
  const box = document.createElement('div');
  box.className = 'fatal visible';
  const title = document.createElement('h2');
  title.textContent = 'Refrakt could not start';
  const body = document.createElement('p');
  body.textContent = message;
  box.append(title, body);
  root.replaceChildren(box);
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui');
  try {
    if (!(canvas instanceof HTMLCanvasElement) || !uiRoot)
      throw new Error('Page is missing the game canvas or UI root.');
    const options = parseLaunchOptions(location.search);
    let campaign: Campaign;
    if (options.editorPreview) {
      // The editor's test play: just the world being edited.
      const preview = validateWorld(JSON.parse(sessionStorage.getItem('refrakt.editor-preview') ?? 'null'));
      campaign = new Campaign([authoredEntry(preview)]);
    } else {
      const files = await loadFileWorlds(new URL('./worlds/', document.baseURI));
      if (files.warnings.length) console.warn('Some world files could not load:', files.warnings);
      let saved: AuthoredWorld[] = [];
      try {
        const library = readLibrary(localStorage);
        saved = library.worlds;
        if (library.warnings.length) console.warn('Some saved worlds could not load:', library.warnings);
      } catch (error) {
        console.warn('Browser saves unavailable; project worlds remain playable.', error);
      }
      campaign = buildCampaign(files.worlds, saved);
    }
    // The brick textures are fetched up front so bricks never pop in half-drawn; each world's uploaded
    // background loads when the world is first shown (BackdropCache).
    const forgeTextures = await loadForgeTextures().catch((err: unknown) => {
      throw new Error('The game artwork could not be loaded.', { cause: err });
    });
    new Game(canvas, uiRoot, campaign, options, forgeTextures).start();
  } catch (err) {
    console.error(err);
    fatal(uiRoot, err instanceof Error ? err.message : String(err));
  }
}

void boot();
