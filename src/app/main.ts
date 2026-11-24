import './styles.css';
import { Game } from './Game';
import { loadForestAssets } from '../themes/scenery/forest/assets';
import { authoredBackgrounds, installWorlds, playableWorld, readLibrary, validateWorld } from '../content/authoredWorlds';
import { appendWorld, WORLDS } from '../content/worlds';
import { appendLevels } from '../content/levels';
import * as THREE from 'three';
import { worldPlayAreas } from '../gameplay/arena/playAreas';
import { worldHazards } from '../gameplay/hazards/hazards';
import { installFileWorlds, loadFileWorlds, mergeWorlds } from '../content/fileWorlds';

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
    if (new URLSearchParams(location.search).has('editorPreview')) {
      const preview = validateWorld(JSON.parse(sessionStorage.getItem('refrakt.editor-preview') ?? 'null'));
      if (preview.backgroundImage) authoredBackgrounds.set(WORLDS.length, preview.backgroundImage);
      if (preview.playAreas) worldPlayAreas.set(WORLDS.length, preview.playAreas);
      if (preview.hazards) worldHazards.set(WORLDS.length, preview.hazards);
      appendLevels(preview.levels);
      appendWorld(playableWorld(preview));
    } else {
      const files = await loadFileWorlds(new URL('./worlds/', document.baseURI));
      let worlds = files.worlds;
      if (files.warnings.length) console.warn('Some world files could not load:', files.warnings);
      try {
        const library = readLibrary(localStorage);
        worlds = mergeWorlds(files.worlds, library.worlds);
        if (library.warnings.length) console.warn('Some saved worlds could not load:', library.warnings);
      } catch (error) {
        console.warn('Browser saves unavailable; project worlds remain playable.', error);
      }
      installFileWorlds(files.worlds);
      const fileKeys = new Set(files.worlds.map((world) => world.key));
      installWorlds(worlds.filter((world) => !fileKeys.has(world.key)));
    }
    // Pre-rendered artwork is fetched up front so no world ever pops in half-drawn.
    const assets = await loadForestAssets();
    const backgrounds = new Map<number, THREE.Texture>();
    await Promise.all([...authoredBackgrounds].map(async ([index, url]) => {
      try {
        const texture = await new THREE.TextureLoader().loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        backgrounds.set(index, texture);
      } catch (error) { console.warn('An uploaded background could not load; using built-in scenery.', error); }
    }));
    new Game(canvas, uiRoot, assets, backgrounds).start();
  } catch (err) {
    console.error(err);
    fatal(uiRoot, err instanceof Error ? err.message : String(err));
  }
}

void boot();
