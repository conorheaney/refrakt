import * as THREE from 'three';
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
 * Product-shot camera: holds the composed frame, glides between menu and
 * gameplay poses (static during play) and adds a small, slow trauma-based
 * sway. A second camera, fixed at the gameplay pose, is used for pointer
 * picking so aiming is stable whatever the view is doing.
 */
export class CameraRig {
  /** The camera the scene is drawn with. */
  readonly camera = new THREE.PerspectiveCamera(FOV, STAGE_ASPECT, 0.5, 400);
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

  /** Vertical field of view in degrees. */
  readonly fov = FOV;

  constructor() {
    this.placeAimCamera();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.aimCamera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.aimCamera.updateProjectionMatrix();
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

    const cam = this.camera;
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

  /** Maps a pointer position (NDC) to a playfield X coordinate on the z = 0 plane. */
  pointerToFieldX(ndcX: number, ndcY: number): number | null {
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
