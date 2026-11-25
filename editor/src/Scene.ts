import * as THREE from 'three';
import { STAGES_PER_WORLD } from '../../src/content/worlds';
import { Campaign } from '../../src/content/campaign';
import { authoredEntry, type AuthoredWorld } from '../../src/content/authoredWorlds';
import { GameView } from '../../src/app/GameView';
import { Renderer } from '../../src/engine/render/Renderer';
import { loadForestAssets } from '../../src/themes/scenery/forest/assets';
import { World } from '../../src/gameplay/World';
import type { Point } from '../../src/gameplay/arena/playAreas';
import { STAGE_ASPECT, STAGE_MIN_ASPECT } from '../../src/engine/Stage';

/** Paused original game renderer. Editor hit targets project through the same camera. */
export class EditorScene {
  /** The edited world is the scene's whole campaign, rebuilt on every change. */
  private readonly world: World;
  private readonly backgrounds = new Map<number, THREE.Texture>();
  private readonly renderer: Renderer;
  private view!: GameView;
  private readonly index = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly hit = new THREE.Vector3();
  private readonly vector = new THREE.Vector3();
  private image: string | undefined;
  private imageGeneration = 0;
  private pending = false;
  private data: AuthoredWorld;
  private level = 0;
  private loaded = false;
  onLayout: () => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(private readonly stage: HTMLElement, canvas: HTMLCanvasElement, initial: AuthoredWorld) {
    this.data = initial;
    this.world = new World(new Campaign([authoredEntry(initial)]));
    this.renderer = new Renderer(canvas);
    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    this.view = new GameView(this.world, this.renderer.gl, await loadForestAssets(), this.backgrounds);
    this.view.rig.mode = 'play'; this.view.rig.shakeScale = 0;
    this.renderer.attach(this.view.scene, this.view.rig.camera);
    this.loaded = true;
    this.resize();
  }

  sync(data: AuthoredWorld, level: number): void {
    this.data = data; this.level = level;
    if (!this.loaded || this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.refresh(); });
  }

  private refresh(): void {
    this.world.setCampaign(new Campaign([authoredEntry(this.data)]));
    if (this.image !== this.data.backgroundImage) {
      this.image = this.data.backgroundImage;
      const generation = ++this.imageGeneration;
      this.backgrounds.get(this.index)?.dispose(); this.backgrounds.delete(this.index);
      if (this.image) void new THREE.TextureLoader().loadAsync(this.image).then((texture) => {
        if (generation !== this.imageGeneration) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        this.backgrounds.set(this.index, texture); this.refresh();
      }).catch(() => this.onError('The uploaded background could not be displayed.'));
    }
    this.world.time = 0;
    this.world.loadLevel(this.index * STAGES_PER_WORLD + this.level);
    // The editor draws the bricks itself on a flat, axis-aligned grid over the scene (see layoutGrid in
    // main.ts), so the camera's perspective view of the bricks is left out here.
    for (const brick of this.world.bricks) brick.alive = false;
    this.world.time = 10;
    this.view.rig.mode = 'play'; this.view.rig.update(100);
    this.view.update(0, 0, 1);
    this.renderer.setCamera(this.view.rig.camera);
    this.renderer.render(0.1);
    this.view.rig.camera.updateMatrixWorld();
    this.onLayout();
    this.stage.dataset.ready = 'true';
  }

  private resize(): void {
    const aspect = Math.min(STAGE_ASPECT, Math.max(STAGE_MIN_ASPECT, innerWidth / innerHeight));
    const width = Math.min(innerWidth, innerHeight * aspect), height = width / aspect;
    Object.assign(this.stage.style, { width: `${width}px`, height: `${height}px`, left: `${(innerWidth - width) / 2}px`, top: `${(innerHeight - height) / 2}px` });
    this.renderer.resize(width, height);
    if (this.loaded) {
      const size = this.renderer.gl.getDrawingBufferSize(new THREE.Vector2());
      this.view.resize(aspect, size.x, size.y, 0.5);
      this.refresh();
    }
  }

  /** Screen position (stage px) of a playfield point; `z` lifts it off the play plane (e.g. snakes). */
  project(p: Point, z = 0): Point {
    if (!this.loaded) return { x: 0, y: 0 };
    this.view.rig.project(p.x, p.y, this.vector, z);
    return { x: (this.vector.x + 1) * this.stage.clientWidth / 2, y: (1 - this.vector.y) * this.stage.clientHeight / 2 };
  }

  /** Playfield point under a screen position, on the plane at depth `z`. */
  unproject(p: Point, z = 0): Point {
    if (!this.loaded) return { x: 0, y: 0 };
    this.ray.setFromCamera(new THREE.Vector2(p.x / this.stage.clientWidth * 2 - 1, 1 - p.y / this.stage.clientHeight * 2), this.view.rig.camera);
    this.plane.constant = -z;
    this.ray.ray.intersectPlane(this.plane, this.hit);
    this.plane.constant = 0;
    return { x: this.hit.x, y: this.hit.y };
  }
}
