import type { Poolable } from '../engine/core/Pool';

export enum BrickKind {
  Normal = 0,
  Tough = 1,
  Armored = 2,
  Steel = 3,
  Explosive = 4,
  Prism = 5,
  Phase = 6,
}
export const BRICK_KIND_COUNT = 7;

export enum PowerUpKind {
  Expand = 0,
  Multi = 1,
  Laser = 2,
  Slow = 3,
  Fire = 4,
  Magnet = 5,
  Shield = 6,
  Life = 7,
}
export const POWERUP_KIND_COUNT = 8;

export type DamageCause = 'ball' | 'laser' | 'explosion';

/** `serve`: ball waiting on paddle. `respawn`: short delay after losing a life. */
export type WorldPhase = 'serve' | 'live' | 'respawn' | 'cleared' | 'over';

export interface Brick {
  readonly index: number;
  readonly col: number;
  readonly row: number;
  /** Cell centre; changes only when a level of another world (with a different grid) is loaded. */
  x: number;
  y: number;
  kind: BrickKind;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Phase bricks toggle this; non-solid bricks let everything through. */
  solid: boolean;
  /** Seconds until a chained explosive detonates (0 = not armed). */
  fuse: number;
  spawnTime: number;
  hitTime: number;
}

export interface Ball extends Poolable {
  x: number;
  y: number;
  /** Position at the previous step, for render interpolation. */
  px: number;
  py: number;
  /** Unit direction; speed is a world-level scalar. */
  dx: number;
  dy: number;
  stuck: boolean;
  stuckOffset: number;
  stuckTime: number;
}

export interface Drop extends Poolable {
  kind: PowerUpKind;
  x: number;
  y: number;
  py: number;
}

export interface Laser extends Poolable {
  x: number;
  y: number;
  py: number;
}

export interface Shot extends Poolable {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
}

export interface Paddle {
  x: number;
  px: number;
  y: number;
  width: number;
  vx: number;
  stun: number;
  /** Signed distance a snake bite (or a scarab landing) still has to push the paddle (see BITE); input is ignored until it ends. */
  shove: number;
  /**
   * Set by a falling icicle's blow to -1 (struck on the left) or 1 (on the right), running back to 0 over
   * ICICLE.tiltTime: what is left of the paddle's wobble. Visual only.
   */
  tilt: number;
  /** Signed distance an icicle's blow still has to push the paddle; added on top of input. */
  slide: number;
  /**
   * How far clinging scarabs (gameplay/hazards/scarabs/scarabs.ts) weigh the paddle down at one end: -1 (left end fully down) to 1
   * (right end). Turns every bounce towards the low end (see SCARAB.leanKick) and rolls the drawn paddle.
   */
  lean: number;
  hitTime: number;
}

export interface BossDef {
  readonly name: string;
  readonly hp: number;
  readonly radius: number;
  readonly y: number;
  readonly sway: number;
  readonly swaySpeed: number;
  readonly fireInterval: number;
  /** Projectiles per volley in the first stage. */
  readonly volley: number;
  readonly shotSpeed: number;
  /** Seconds between brick summons (0 = never). */
  readonly summonInterval: number;
  readonly points: number;
}

export interface Boss {
  active: boolean;
  def: BossDef | null;
  x: number;
  y: number;
  px: number;
  py: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** 0..2, escalates as health drops. */
  stage: number;
  t: number;
  fireTimer: number;
  summonTimer: number;
  invuln: number;
  hitTime: number;
}
