import * as THREE from 'three';
import { FIELD, FOREST_ART } from './config';
import type { WorldId } from '../content/worlds';
import { STAGE_ASPECT } from '../engine/Stage';

export type CameraMode = 'menu' | 'play';

const FOV = 30;
const DISTANCE = 44;
const PITCH = (14 * Math.PI) / 180;
const LOOK_Y = 1.2;

/**
 * Gameplay camera pose: slightly above the arena looking down. Tuned so the
 * playfield runs from just under the HUD (FIELD.top at ~10% of the frame
 * height) to the floor (~93%), leaving only a thin strip of reflective floor.
 * FOV is vertical, so taller stage aspects keep this vertical framing.
 */
export const CAMERA_HOME = {
  y: LOOK_Y + Math.sin(PITCH) * DISTANCE,
  z: Math.cos(PITCH) * DISTANCE,
  lookY: LOOK_Y,
  /** Vertical field of view, degrees. */
  fov: FOV,
} as const;

/**
 * The forest world is a painting seen straight on: an orthographic view, pitched down like the Space camera
 * (so the bricks and paddle show the same faces as in Space), in which the playfield lands on the painted
 * tree arch (see FOREST_ART in gameplay/config.ts for the px <-> world mapping). The view always shows
 * the painting's full height, so the vertical framing never changes; it is centred on the painting, and
 * the stage's aspect (16:9 down to 4:3) only decides how much of the painting's sides shows: all of it at
 * 16:9 (the painting is 1672 x 941, 16:9 within 0.06%), and the middle 1255 px at 4:3, which still
 * includes both trunks (the arena spans px 268-1404).
 */
export const FOREST_VIEW = {
  /** Half the frame's height, in screen units (world units across the view). */
  halfHeight: FOREST_ART.heightPx / FOREST_ART.pxPerUnit / 2,
  /** The playfield point (z = 0) at the centre of the frame: under the painting's centre pixel. */
  centerX: (FOREST_ART.widthPx / 2 - FOREST_ART.centrePx) / FOREST_ART.pxPerUnit,
  centerY: FIELD.top - (FOREST_ART.heightPx / 2 - FOREST_ART.ceilingPx) / FOREST_ART.pxPerUnitY,
  pitch: FOREST_ART.pitch,
  /** Camera distance from the centre point (only matters for point-sprite sizing). */
  distance: 50,
} as const;

/**
 * Product-shot camera: holds the composed frame, glides between menu and
 * gameplay poses (static during play) and adds a small, slow trauma-based
 * sway. A second camera, fixed at the gameplay pose, is used for pointer
 * picking so aiming is stable whatever the view is doing.
 */
export class CameraRig {
  /** The product-shot camera (Space). */
  private readonly perspective = new THREE.PerspectiveCamera(FOV, STAGE_ASPECT, 0.5, 400);
  /**
   * The flat forest view: a true orthographic camera, so lighting sees one view direction everywhere (as
   * the distant Space camera nearly does) and no specular hotspot lands in the middle of the bricks.
   */
  private readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 400);
  mode: CameraMode = 'menu';
  shakeScale = 1;

  private readonly aimCamera = new THREE.PerspectiveCamera(FOV, STAGE_ASPECT, 0.5, 400);
  private readonly pos = new THREE.Vector3(0, CAMERA_HOME.y + 2, CAMERA_HOME.z + 6);
  private readonly look = new THREE.Vector3(0, CAMERA_HOME.lookY, 0);
  private readonly goalPos = new THREE.Vector3();
  private readonly goalLook = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();
  private trauma = 0;
  private clock = 0;
  /** Forest: the straight-on orthographic view (FOREST_VIEW) instead of the perspective product shot. */
  private flat = false;

  /** The camera the scene is drawn with: the flat forest view or the product shot. */
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.flat ? this.orthographic : this.perspective;
  }

  /** Whether the flat (orthographic, straight-on) forest view is in use. */
  get isFlat(): boolean {
    return this.flat;
  }

  /**
   * Vertical field of view in degrees. In the flat forest view this is the equivalent lens at
   * FOREST_VIEW.distance, so point sprites at the playfield keep the right size.
   */
  get fov(): number {
    return this.flat ? (2 * Math.atan(FOREST_VIEW.halfHeight / FOREST_VIEW.distance) * 180) / Math.PI : FOV;
  }

  /** Switches to a world's framing: the flat painting view for the forest, the product shot otherwise. */
  setWorld(id: WorldId): void {
    this.flat = id === 'forest';
    this.applyFlat();
  }

  /** Half the flat view's width in world units at the current aspect. */
  private get flatHalfWidth(): number {
    return this.perspective.aspect * FOREST_VIEW.halfHeight;
  }

  /** Sizes the orthographic camera: the painting's full height, and as much of its width as the aspect shows. */
  private applyFlat(): void {
    const hw = this.flatHalfWidth;
    const hh = FOREST_VIEW.halfHeight;
    const cam = this.orthographic;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.updateProjectionMatrix();
  }

  constructor() {
    this.placeAimCamera();
    this.applyFlat();
  }

  setAspect(aspect: number): void {
    this.perspective.aspect = aspect;
    this.aimCamera.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.aimCamera.updateProjectionMatrix();
    this.applyFlat();
  }

  /**
   * The aim camera is pinned to the gameplay home pose. Pointer -> field mapping
   * therefore never depends on where the paddle, the ball, the menu glide or
   * the camera sway happen to be (it used to follow all of them, so a still
   * mouse could drift the paddle and the paddle's own motion fed back into its
   * target).
   */
  private placeAimCamera(): void {
    this.aimCamera.position.set(0, CAMERA_HOME.y, CAMERA_HOME.z);
    this.aimCamera.lookAt(0, CAMERA_HOME.lookY, 0);
    this.aimCamera.updateMatrixWorld();
  }

  /** Keeps the shake at least at `level` (0-0.6) for as long as it is called each frame (a rumble). */
  holdTrauma(level: number): void {
    this.trauma = Math.min(0.6, Math.max(this.trauma, level));
  }

  /** Adds screen-shake energy in [0, 1]; shake amplitude is trauma squared. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(0.6, this.trauma + amount);
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.flat) {
      this.updateFlat();
      this.trauma = Math.max(0, this.trauma - dt * 2.4);
      return;
    }
    if (this.mode === 'play') {
      // Static during play (no parallax following the paddle or ball), so the scene never sways under the
      // player and the paddle stays exactly under the pointer.
      this.goalPos.set(0, CAMERA_HOME.y, CAMERA_HOME.z);
      this.goalLook.set(0, CAMERA_HOME.lookY, 0);
    } else {
      const a = this.clock * 0.13;
      this.goalPos.set(Math.sin(a) * 3.2, CAMERA_HOME.y + 0.6 + Math.cos(a * 0.7) * 0.6, CAMERA_HOME.z + 1.5);
      this.goalLook.set(Math.sin(a) * 0.8, CAMERA_HOME.lookY + 0.3, 0);
    }

    const k = 1 - Math.exp(-2.8 * dt);
    this.pos.lerp(this.goalPos, k);
    this.look.lerp(this.goalLook, k);

    const cam = this.perspective;
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    // Low-amplitude, low-frequency sway (a few Hz) rather than a high-frequency rattle; no roll, no zoom.
    const shake = this.trauma * this.trauma * this.shakeScale;
    if (shake > 0.0001) {
      const t = this.clock;
      cam.position.x += shake * 0.18 * (Math.sin(t * 17.3) + Math.sin(t * 23.1) * 0.4);
      cam.position.y += shake * 0.18 * (Math.sin(t * 19.7 + 1.3) + Math.sin(t * 29.9) * 0.4);
    }
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
  }

  /** The flat forest view: fixed (menu included), with the same small impact sway. */
  private updateFlat(): void {
    const cam = this.orthographic;
    const p = FOREST_VIEW.pitch;
    cam.position.set(FOREST_VIEW.centerX, FOREST_VIEW.centerY + Math.sin(p) * FOREST_VIEW.distance, Math.cos(p) * FOREST_VIEW.distance);
    cam.rotation.set(-p, 0, 0);
    const shake = this.trauma * this.trauma * this.shakeScale;
    if (shake > 0.0001) {
      const t = this.clock;
      cam.position.x += shake * 0.18 * (Math.sin(t * 17.3) + Math.sin(t * 23.1) * 0.4);
      cam.position.y += shake * 0.18 * (Math.sin(t * 19.7 + 1.3) + Math.sin(t * 29.9) * 0.4);
    }
    cam.updateMatrixWorld();
    // Keep the glide state at the home pose, so leaving the forest starts from a sensible place.
    this.pos.set(0, CAMERA_HOME.y, CAMERA_HOME.z);
    this.look.set(0, CAMERA_HOME.lookY, 0);
  }

  /** Maps a pointer position (NDC) to a playfield X coordinate on the z = 0 plane. */
  pointerToFieldX(ndcX: number, ndcY: number): number | null {
    if (this.flat) return FOREST_VIEW.centerX + ndcX * this.flatHalfWidth;
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.aimCamera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.hitPoint);
    return hit ? hit.x : null;
  }

  /** Projects a playfield point to NDC (x, y in [-1, 1]). */
  project(x: number, y: number, out: THREE.Vector3, z = 0): THREE.Vector3 {
    return out.set(x, y, z).project(this.camera);
  }
}
