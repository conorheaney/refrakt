import * as THREE from 'three';
import normal from './textures/normal.jpg';
import tough from './textures/tough.jpg';
import armored from './textures/armored.jpg';
import steel from './textures/steel.jpg';
import explosive from './textures/explosive.jpg';
import prism from './textures/prism.jpg';
import phase from './textures/phase.jpg';

/** Indexed by BrickKind; exported URLs also skin the editor's flat grid tiles. */
export const FORGE_TEXTURE_URLS = [normal, tough, armored, steel, explosive, prism, phase] as const;

export async function loadForgeTextures(): Promise<readonly THREE.Texture[]> {
  return Promise.all(FORGE_TEXTURE_URLS.map(async url => {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }));
}
