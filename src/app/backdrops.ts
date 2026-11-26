import * as THREE from 'three';

/**
 * Where GameView gets each world's uploaded background, by world index: the texture when it is ready, null when the
 * world has none (it shows a plain dark backdrop), or a promise of either while it loads.
 */
export interface BackdropSource {
  get(worldIndex: number): THREE.Texture | null | Promise<THREE.Texture | null>;
}

/** Ready-made textures in a map, read live (the editor's, which it replaces as backgrounds are uploaded). */
export function mapBackdrops(map: ReadonlyMap<number, THREE.Texture>): BackdropSource {
  return { get: (worldIndex) => map.get(worldIndex) ?? null };
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The game's backgrounds, decoded the first time a world is shown. Only the world on screen keeps its texture: a
 * 1600x900 background takes about 7.5 MB of GPU memory with its mipmaps, so keeping every world's would add up.
 * Coming back to a world decodes its image again (a moment, behind the loadout picker in a run).
 */
export class BackdropCache implements BackdropSource {
  private worldIndex = -1;
  private texture: THREE.Texture | null = null;
  private loading: Promise<THREE.Texture | null> | null = null;

  constructor(
    /** World `worldIndex`'s background image (a URL or data URL), if it has one. */
    private readonly urlOf: (worldIndex: number) => string | undefined,
    private readonly load: (url: string) => Promise<THREE.Texture> = loadTexture,
  ) {}

  get(worldIndex: number): THREE.Texture | null | Promise<THREE.Texture | null> {
    if (worldIndex === this.worldIndex) return this.loading ?? this.texture;
    // Another world: the one shown until now is let go (its GPU copy freed).
    this.texture?.dispose();
    this.texture = null;
    this.loading = null;
    this.worldIndex = worldIndex;
    const url = this.urlOf(worldIndex);
    if (!url) return null;
    const loading: Promise<THREE.Texture | null> = this.load(url).then(
      (texture) => {
        // Moved on to another world (or back to this one, loading afresh) while it decoded.
        if (this.loading !== loading) {
          texture.dispose();
          return null;
        }
        this.texture = texture;
        this.loading = null;
        return texture;
      },
      (error: unknown) => {
        console.warn('An uploaded background could not load; showing a plain backdrop.', error);
        if (this.loading === loading) this.loading = null;
        return null;
      },
    );
    this.loading = loading;
    return loading;
  }
}
