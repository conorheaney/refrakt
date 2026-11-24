import * as THREE from 'three';
import backgroundUrl from './background.webp';
import { loadForgeTextures } from '../../blocks/forge/forgeAssets';

/** Artwork for the forest world. The bricks, ball, paddle and HUD are the Space ones, so it is only the scenery. */
export interface ForestAssets {
  readonly forge: readonly THREE.Texture[];
  /** The tree-arch woodland painting (1672 x 941, opaque); see FOREST_ART in gameplay/config.ts. */
  readonly background: THREE.Texture;
}

export async function loadForestAssets(): Promise<ForestAssets> {
  try {
    const [background, forge] = await Promise.all([new THREE.TextureLoader().loadAsync(backgroundUrl), loadForgeTextures()]);
    background.colorSpace = THREE.SRGBColorSpace;
    // Drawn straight on at close to 1:1, so it needs no mipmaps.
    background.generateMipmaps = false;
    background.minFilter = THREE.LinearFilter;
    background.magFilter = THREE.LinearFilter;
    return { background, forge };
  } catch (err) {
    throw new Error('The game artwork could not be loaded.', { cause: err });
  }
}
