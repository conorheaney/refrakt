import * as THREE from 'three';
import type { AudioEngine } from '../../engine/audio/AudioEngine';
import { roundedPath } from '../../engine/core/paths';
import type { ParticleSystem } from '../../engine/render/ParticleSystem';
import type { World } from '../World';
import type { AmbiencePath, AmbienceSettings } from './settings';
import type { AmbienceInfo } from './ambiences';

/**
 * Ambience is what fills the air of a world: snow, rain, dust. Each kind is one class in this folder
 * (snow/Snow.ts, rain/Rain.ts, dust/Dust.ts), built on Ambience below, and does everything to do with it:
 * what is drawn and lit, what is heard, how it reacts to the paddle and bricks, and what one of its pulses
 * looks and sounds like. It comes from the paths drawn for it in the editor (AmbienceSettings.paths). Beside each
 * class, a few lines say what it is (its AmbienceInfo: snow/snowInfo.ts and so on) without loading three.js.
 *
 * When pulses come is decided by the simulation, not the ambience (gameplay/ambience/AmbienceClock.ts): the
 * clock announces `ambiencePulse`, GameView passes the pulse on here (Ambience.pulse), and anything else that
 * should happen with it listens too (hazards a world cues on its pulses: gameplay/hazards/HazardTriggers.ts). An ambience can be given to any world: it knows nothing about the
 * world it is in beyond its settings, and the world knows nothing about it beyond its name.
 *
 * Adding an ambience is its class and its info file, and one line each in ambiences.ts and ambienceTypes.ts.
 */

/** What the game view hands every ambience. */
export interface AmbienceContext {
  readonly scene: THREE.Scene;
  /** The camera the scene is drawn with (particles are placed so they show on the paths from it). */
  readonly camera: THREE.Camera;
  /** The view's shared sparks, for splashes and spindrift. */
  readonly particles: ParticleSystem;
  /** Absent where there is no sound (the editor, tests). */
  readonly audio?: AudioEngine;
  /** Whether ambience may be heard right now (not on the menu's attract demo). */
  soundOn(): boolean;
  /** Keeps the camera shaking at least this much (0-0.6) while called every frame; ignored with reduced motion. */
  shake(level: number): void;
}

/** One frame, as GameView.update hands it on. */
export interface AmbienceFrame {
  /** Wall-clock time: falling and drifting carry on through menus and pauses. */
  realDt: number;
  /** Simulation time (0 while paused or in hit-stop): anything that touches the play follows it. */
  simDt: number;
  readonly world: World;
  /** The ball the eye follows (null when none is in play) and the paddle's drawn x, for stirring the air. */
  ball: { x: number; y: number } | null;
  paddleX: number;
}

/**
 * GLSL shared by the shaders that start particles on the paths. A path is drawn on one plane (uPathZ), but
 * particles fill a range of depths; `fromPath` moves a path point to depth z along the camera's line of sight,
 * so whatever its depth a particle starts where the path shows on screen. `depthScale(z)` is how much bigger
 * the scene is at z than on the path's plane, for any other distance measured on that plane.
 */
export const PATH_GLSL = /* glsl */ `
uniform vec3 uCam;
uniform float uPathZ;
float depthScale(float z) { return (uCam.z - z) / (uCam.z - uPathZ); }
vec3 fromPath(vec2 p, float z) { return vec3(uCam.xy + (p - uCam.xy) * depthScale(z), z); }
`;

/**
 * Where ambience particles sit in depth, the same for every ambience: about half drift in front of the bricks, so
 * the ambience reads as the air in the room between the player and the play area, and the rest pass behind them
 * for depth (hidden where a brick is in the way). Nothing is placed right in the brick layer (z = 0, half-depth
 * 0.44), where it would clip through bricks.
 */
export const IN_FRONT = 0.5;
/** Particles in front of the bricks are this bright, so the ball always reads clearly through them. */
export const FRONT_FADE = 0.75;
/** Nearest a particle comes to the brick layer, either side. */
const CLEAR = 0.8;

/** A random depth between `min` (behind, negative) and `max` (in front, positive), clear of the bricks. */
export function particleDepth(min: number, max: number): number {
  return Math.random() < IN_FRONT ? CLEAR + Math.random() * (max - CLEAR) : min + Math.random() * (-CLEAR - min);
}

/** Swell up over `rise`, hold for `hold`, die away over `fall` (0-1). */
export function envelope(age: number, rise: number, hold: number, fall: number): number {
  if (age < 0) return 0;
  if (age < rise) return smooth(age / rise);
  if (age < rise + hold) return 1;
  const t = (age - rise - hold) / fall;
  return t >= 1 ? 0 : 1 - smooth(t);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A path as it is drawn (corners rounded), with the running length at each point. */
interface Traced {
  readonly points: readonly { x: number; y: number }[];
  readonly lengths: readonly number[];
  readonly left: number;
  readonly right: number;
}

export abstract class Ambience {
  /** Everything it draws; shown only while it is the level's ambience. */
  protected readonly group = new THREE.Group();
  /** For PATH_GLSL: spread into the uniforms of every shader that uses it. */
  protected readonly pathUniforms = { uCam: { value: new THREE.Vector3() }, uPathZ: { value: 0 } };
  /** The current settings (valid while active). */
  protected settings!: AmbienceSettings;
  private traced: Traced[] = [];
  private total = 0;
  private soundIsOn = false;

  constructor(
    protected readonly ctx: AmbienceContext,
    readonly info: AmbienceInfo,
    /** The recordings it plays (sources and licences: src/app/audio/SOUND_CREDITS.md), by name. */
    private readonly samples: Readonly<Record<string, string>> = {},
  ) {
    this.group.visible = false;
    ctx.scene.add(this.group);
    ctx.audio?.addSamples(samples);
    this.pathUniforms.uPathZ.value = info.paths.depth;
  }

  get active(): boolean {
    return this.group.visible;
  }

  /**
   * Becomes the level's ambience (it changes only behind a level transition), or takes new settings while it
   * already is (the editor redrawing its paths), without starting over.
   */
  start(settings: AmbienceSettings): void {
    const fresh = !this.active;
    this.settings = settings;
    this.traced = settings.paths.map((path) => trace(path));
    this.total = this.traced.reduce((sum, t) => sum + t.lengths[t.lengths.length - 1], 0);
    this.group.visible = true;
    this.ctx.audio?.want(Object.keys(this.samples));
    this.onStart(fresh);
  }

  /** No longer the level's ambience: hidden, silent and calm. */
  stop(): void {
    if (!this.active) return;
    this.group.visible = false;
    if (this.soundIsOn) {
      this.soundIsOn = false;
      this.onSound(false);
    }
    this.onStop();
  }

  /** A pulse hits (the ambiencePulse event). */
  pulse(): void {
    if (this.active) this.onPulse();
  }

  update(frame: AmbienceFrame): void {
    if (!this.active) return;
    this.ctx.camera.getWorldPosition(this.pathUniforms.uCam.value);
    const sound = !!this.ctx.audio && this.ctx.soundOn();
    if (sound !== this.soundIsOn) {
      this.soundIsOn = sound;
      this.onSound(sound);
    }
    this.onFrame(frame);
  }

  /** The drawing buffer's height and the camera's vertical field of view, and the stage's aspect. */
  setViewport(heightPx: number, fovDeg: number, aspect: number): void {
    this.onViewport(heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)), aspect);
  }

  // ------------------------------------------------------------------ for each ambience to fill in

  /** Started (`fresh`) or given new settings while running (the paths are ready: see pointOnPaths). */
  protected abstract onStart(fresh: boolean): void;
  /** Stopped: back to calm, with any lights it added dark. */
  protected abstract onStop(): void;
  /** A pulse hits. */
  protected abstract onPulse(): void;
  /** Every frame while active. */
  protected abstract onFrame(frame: AmbienceFrame): void;
  /** Its sound may now be heard, or must stop (`on`): start or fade out anything that plays on its own. */
  protected onSound(_on: boolean): void {}
  /** `pointScale` turns a size in world units into point-sprite pixels (as ParticleSystem.setViewport). */
  protected onViewport(_pointScale: number, _aspect: number): void {}

  // ------------------------------------------------------------------ shared helpers

  /** The audio engine and the time to play at, while its sound may be heard; null otherwise. */
  protected get sound(): { readonly audio: AudioEngine; readonly now: number } | null {
    const audio = this.ctx.audio;
    const ctx = audio?.context;
    if (!audio || !this.soundIsOn || !ctx || ctx.state !== 'running') return null;
    return { audio, now: ctx.currentTime };
  }

  /** Lights it adds stay in the scene for good (adding or removing lights recompiles every material). */
  protected addLight(light: THREE.Light): void {
    this.ctx.scene.add(light);
  }

  /** Brightens the world's backdrop by `amount` (0: as painted). */
  protected brightenBackdrop(amount: number): void {
    this.ctx.scene.backgroundIntensity = 1 + amount;
  }

  protected get pathCount(): number {
    return this.traced.length;
  }

  /** The leftmost and rightmost x of path `index`. */
  protected pathSpan(index: number): readonly [number, number] {
    const t = this.traced[index];
    return [t.left, t.right];
  }

  /** A random point along the paths (each place equally likely, whichever path it is on), and its path. */
  protected pointOnPaths(): { x: number; y: number; path: number } {
    let d = Math.random() * this.total;
    for (let i = 0; i < this.traced.length; i++) {
      const t = this.traced[i];
      const length = t.lengths[t.lengths.length - 1];
      if (d <= length || i === this.traced.length - 1) return { ...pointAt(t, Math.min(d, length)), path: i };
      d -= length;
    }
    return { x: 0, y: 0, path: 0 };
  }

  /** The total length of the paths. */
  protected get pathLength(): number {
    return this.total;
  }

  /** Whether `x` is under a path (within `margin` of one's ends): where the ambience reaches the play. */
  protected underPaths(x: number, margin = 0): boolean {
    for (const t of this.traced) if (x >= t.left - margin && x <= t.right + margin) return true;
    return false;
  }
}

function trace(path: AmbiencePath): Traced {
  const points = roundedPath(path.points, false, path.radius ?? 0);
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const xs = points.map((p) => p.x);
  return { points, lengths, left: Math.min(...xs), right: Math.max(...xs) };
}

function pointAt(t: Traced, d: number): { x: number; y: number } {
  const { points, lengths } = t;
  let i = 1;
  while (i < points.length - 1 && lengths[i] < d) i++;
  const span = lengths[i] - lengths[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (d - lengths[i - 1]) / span));
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * f,
  };
}
