import './styles.css';
import { Game } from './Game';
import { loadForestAssets } from '../themes/scenery/forest/assets';
import { authoredEntry, readLibrary, validateWorld, type AuthoredWorld } from '../content/authoredWorlds';
import { Campaign } from '../content/campaign';
import * as THREE from 'three';
import { buildCampaign, loadFileWorlds } from '../content/fileWorlds';

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
    if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) throw new Error('Page is missing the game canvas or UI root.');
    let campaign: Campaign;
    if (new URLSearchParams(location.search).has('editorPreview')) {
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
    // Pre-rendered artwork is fetched up front so no world ever pops in half-drawn.
    const assets = await loadForestAssets();
    const backgrounds = new Map<number, THREE.Texture>();
    await Promise.all(campaign.worlds.map(async ({ background: url }, index) => {
      if (!url) return;
      try {
        const texture = await new THREE.TextureLoader().loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        backgrounds.set(index, texture);
      } catch (error) { console.warn('An uploaded background could not load; using built-in scenery.', error); }
    }));
    new Game(canvas, uiRoot, campaign, assets, backgrounds).start();
  } catch (err) {
    console.error(err);
    fatal(uiRoot, err instanceof Error ? err.message : String(err));
  }
}

void boot();
