import { Random } from '../../engine/core/Random';
import { MAX_PATH_RADIUS, roundedPath } from '../../engine/core/paths';
import type { Ball, Paddle } from '../types';
import type { ArenaBounds } from '../arena/boundary';

/**
 * Hazards are enemies that belong to a world rather than to a level: they live in the world's JSON file
 * (`hazards`, next to `playAreas`) and are active in all ten of its levels. This file holds their definitions and
 * validation. Wall snakes are run by SnakeSystem (gameplay/hazards/snakes/snakes.ts), falling icicles by IcicleSystem
 * (gameplay/hazards/icicles/icicles.ts) and scarab nests by ScarabSystem (gameplay/hazards/scarabs/scarabs.ts).
 */
export type HazardKind = 'snake' | 'icicle' | 'icicles' | 'scarabs';

/**
 * The hazards a world can be given (AuthoredWorld.hazard), one per world: everything in its `hazards` list is of
 * that kind (see hazardOf).
 */
export const WORLD_HAZARDS = ['snakes', 'icicles', 'scarabs'] as const;
export type WorldHazard = (typeof WORLD_HAZARDS)[number];
export const isWorldHazard = (value: unknown): value is WorldHazard =>
  (WORLD_HAZARDS as readonly unknown[]).includes(value);

/** The world hazard a definition belongs to. */
export function hazardOf(def: HazardDef): WorldHazard {
  return def.kind === 'snake' ? 'snakes' : def.kind === 'scarabs' ? 'scarabs' : 'icicles';
}

/**
 * Hazards that can be set off by something else happening in the game (a cue) instead of their own timer
 * (see HazardSystem.trigger and HazardTriggers).
 */
export const CUEABLE_HAZARDS = ['scarabs'] as const;
export type CueableHazard = (typeof CUEABLE_HAZARDS)[number];
/**
 * What can set a hazard off. 'pulse': each time the world's ambience pulses (the `ambiencePulse` event), whatever
 * the ambience is. The ambience itself never knows: it only announces its pulses.
 */
export const HAZARD_CUES = ['pulse'] as const;
/** Cues as older files saved them. */
const OLD_CUES: Record<string, HazardCue> = { storm: 'pulse' };
export type HazardCue = (typeof HAZARD_CUES)[number];
/** Saved on the world (`hazardCues`): the hazards set off by a cue. Any not listed keep their own timer. */
export type HazardCues = Partial<Record<CueableHazard, HazardCue>>;

/** Checks a world's `hazardCues`. */
export function validateHazardCues(value: unknown): HazardCues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid hazard cues.');
  const cues: HazardCues = {};
  for (const [hazard, cue] of Object.entries(value)) {
    if (!(CUEABLE_HAZARDS as readonly string[]).includes(hazard))
      throw new Error(`Unsupported hazard to cue: ${hazard}.`);
    const known = typeof cue === 'string' ? (OLD_CUES[cue] ?? cue) : cue;
    if (!(HAZARD_CUES as readonly unknown[]).includes(known))
      throw new Error(`Unsupported hazard cue: ${String(cue)}.`);
    cues[hazard as CueableHazard] = known as HazardCue;
  }
  return cues;
}

/**
 * What World needs from each kind of hazard: it loads, resets and steps every system in its `hazardSystems` list
 * the same way, so a new kind of enemy is one more system there (plus its definition and validation here).
 */
export interface HazardSystem {
  /** The kind a cue can set off, for a system that supports it (see `cued` and `trigger`). */
  readonly cueable?: CueableHazard;
  /** Set before each load (HazardTriggers): true when a cue sets this hazard off, so it keeps no timer of its own. */
  cued?: boolean;
  /** Its cue came: come out now (ignored while already out). */
  trigger?(): void;
  /**
   * Takes the world's hazards (every kind; each system keeps its own) for a level; `difficulty` is 0 on a world's
   * first level, 1 on its tenth; `arena` is the extent of the world's drawn ball area.
   */
  load(defs: readonly HazardDef[] | undefined, difficulty: number, arena: ArenaBounds): void;
  /** Back to the level's starting state after a life is lost. */
  reset(): void;
  /**
   * Advances one fixed step. `live` is true while the ball is in play. Returns the points scored this step
   * (0 for hazards that never score).
   */
  update(dt: number, paddle: Paddle, balls: readonly Ball[], live: boolean): number;
}

export type HazardDef = SnakeDef | IcicleDef | IcicleAreaDef | ScarabNestDef;

/**
 * A scarab nest (gameplay/hazards/scarabs/scarabs.ts): a spawn point at (x, y), off centre (its side of centre
 * sets which way the swarm sets off), with an optional path its scarabs walk in along; where that reaches the
 * floor is the edge of the open floor its swarm lands within.
 */
export interface ScarabNestDef {
  readonly kind: 'scarabs';
  /** The entry point: where each scarab appears. */
  readonly x: number;
  readonly y: number;
  /**
   * Optional walk in: the points after the entry point that each scarab follows in order as it comes out
   * (over the scenery, round a pillar). The last is where it reaches the floor (its height is taken as the
   * floor's), and from there it hunts the paddle as usual. Without one it scrambles straight down to the floor.
   */
  readonly path?: readonly ScarabPoint[];
  /** How much the walk in's corners are rounded off (engine/core/paths.ts); 0 or absent: straight lines. */
  readonly radius?: number;
}

export interface ScarabPoint {
  readonly x: number;
  readonly y: number;
}

/** Most points in a scarab nest's path. */
export const SCARAB_PATH_POINTS = 16;
const RADIUS_RULE = `corner rounding must be 0-${MAX_PATH_RADIUS}.`;
const okRadius = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PATH_RADIUS;

/** An icicle hanging from the ceiling at (x, y), `length` world units long (gameplay/hazards/icicles/icicles.ts). */
export interface IcicleDef {
  readonly kind: 'icicle';
  readonly x: number;
  readonly y: number;
  readonly length: number;
}

/**
 * A stretch of ceiling where icicles form: a line along the underside of the scenery (2-8 points, so it
 * can follow an arch). `count` icicles hang from it, spread along its length with a little jitter, each
 * between `minLength` and `maxLength` long. `seed` picks the jitter and lengths, so the same area always
 * grows the same icicles; change it to reshuffle them. `positions`, when set (one per icicle, 0 at the
 * line's first point to 1 at its last), pins each icicle to a hand-picked spot instead of the spacing.
 */
export interface IcicleAreaDef {
  readonly kind: 'icicles';
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly count: number;
  readonly minLength: number;
  readonly maxLength: number;
  readonly seed: number;
  readonly positions?: readonly number[];
  /** How much the line's corners are rounded off (engine/core/paths.ts); 0 or absent: straight lines. */
  readonly radius?: number;
}

export const ICICLE_AREA_LIMITS = { points: [2, 8], count: [1, 16], length: [0.4, 3] } as const;

/** Expanded icicles per area, so an area keeps the same icicle objects (and so the same meshes). */
const expanded = new WeakMap<IcicleAreaDef, IcicleDef[]>();

/**
 * Where each of an area's icicles hangs along its line (0 at the first point, 1 at the last) and how long
 * it is. The lengths depend only on the seed, so pinning or sliding icicles never changes them.
 */
export function icicleAreaSlots(area: IcicleAreaDef): { at: number; length: number }[] {
  const rng = new Random(area.seed * 7919 + 17);
  const lo = Math.min(area.minLength, area.maxLength);
  const hi = Math.max(area.minLength, area.maxLength);
  const slots: { at: number; length: number }[] = [];
  for (let i = 0; i < area.count; i++) {
    // Evenly spaced slots, each nudged up to 30% of a slot either way, so the row never looks ruled.
    const spaced = (i + 0.5 + (rng.next() - 0.5) * 0.6) / area.count;
    const length = rng.range(lo, hi);
    slots.push({ at: area.positions?.[i] ?? spaced, length });
  }
  return slots;
}

/** The point `at` (0-1) of the way along a line of points, by distance. */
export function pointAlong(
  points: readonly { readonly x: number; readonly y: number }[],
  at: number,
): { x: number; y: number } {
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const d = Math.min(1, Math.max(0, at)) * lengths[lengths.length - 1];
  let i = 1;
  while (i < points.length - 1 && lengths[i] < d) i++;
  const span = lengths[i] - lengths[i - 1];
  const t = span > 0 ? (d - lengths[i - 1]) / span : 0;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
  };
}

/** The icicles an area grows (see IcicleAreaDef). */
export function icicleAreaIcicles(area: IcicleAreaDef): IcicleDef[] {
  const cached = expanded.get(area);
  if (cached) return cached;
  // Along the line as drawn: its corners rounded off.
  const line = roundedPath(area.points, false, area.radius ?? 0);
  const icicles: IcicleDef[] = icicleAreaSlots(area).map(({ at, length }) => {
    const p = pointAlong(line, at);
    return { kind: 'icicle', x: p.x, y: p.y, length };
  });
  expanded.set(area, icicles);
  return icicles;
}

/** Every icicle in a world: those placed one by one and those grown by icicle areas. */
export function worldIcicles(defs: readonly HazardDef[] | undefined): IcicleDef[] {
  const out: IcicleDef[] = [];
  for (const def of defs ?? []) {
    if (def.kind === 'icicle') out.push(def);
    else if (def.kind === 'icicles') out.push(...icicleAreaIcicles(def));
  }
  return out;
}

export interface SnakeDef {
  readonly kind: 'snake';
  /** The den: where the head rests. A den left of centre strikes rightwards, and vice versa. */
  readonly x: number;
  readonly y: number;
  /** Furthest the head can travel from the den, in world units. */
  readonly reach: number;
  /**
   * Optional resting pose, for looks only: points from the tail to just before the den that the body lies
   * along (e.g. draped over the scenery's rocks). On a strike the body slides forward along it. Without one
   * the snake rests coiled at the den.
   */
  readonly body?: readonly { readonly x: number; readonly y: number }[];
  /** How much the body's bends are rounded off (engine/core/paths.ts); 0 or absent: as given. */
  readonly radius?: number;
}

export const MAX_HAZARDS = 12;

/** Rejects malformed hazard lists from world files and editor saves. */
export function validateHazards(value: unknown): HazardDef[] {
  if (!Array.isArray(value) || value.length > MAX_HAZARDS)
    throw new Error(`Hazards must be a list of at most ${MAX_HAZARDS}.`);
  return value.map((item: unknown, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`Hazard ${i + 1}: expected an object.`);
    const h = item as Record<string, unknown>;
    if (h.kind === 'icicle') return validateIcicle(h, i);
    if (h.kind === 'icicles') return validateIcicleArea(h, i);
    if (h.kind === 'scarabs') return validateScarabNest(h, i);
    if (h.kind !== 'snake') throw new Error(`Hazard ${i + 1}: unknown kind.`);
    const limits: Record<string, [number, number]> = { x: [-25, 25], y: [-12, 12], reach: [1, 16] };
    for (const [key, [min, max]] of Object.entries(limits)) {
      const n = h[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
        throw new Error(`Hazard ${i + 1}: invalid ${key}.`);
    }
    if (h.x === 0) throw new Error(`Hazard ${i + 1}: a snake's den must be left or right of centre.`);
    if (h.radius !== undefined && !okRadius(h.radius)) throw new Error(`Hazard ${i + 1}: ${RADIUS_RULE}`);
    const def: SnakeDef = {
      kind: 'snake',
      x: h.x as number,
      y: h.y as number,
      reach: h.reach as number,
      ...(h.radius ? { radius: h.radius as number } : {}),
    };
    if (h.body === undefined) return def;
    const ok = (p: unknown): p is { x: number; y: number } => {
      if (!p || typeof p !== 'object') return false;
      const { x, y } = p as Record<string, unknown>;
      return typeof x === 'number' && typeof y === 'number' && Math.abs(x) <= 40 && Math.abs(y) <= 20;
    };
    if (!Array.isArray(h.body) || h.body.length < 1 || h.body.length > 32 || !h.body.every(ok)) {
      throw new Error(`Hazard ${i + 1}: body must be 1-32 points with x and y.`);
    }
    return { ...def, body: h.body.map(({ x, y }) => ({ x, y })) };
  });
}

function validateScarabNest(h: Record<string, unknown>, i: number): ScarabNestDef {
  const num = (v: unknown, min: number, max: number, what: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      throw new Error(`Hazard ${i + 1}: invalid ${what}.`);
    return v;
  };
  const x = num(h.x, -25, 25, 'x');
  const y = num(h.y, -12, 12, 'y');
  if (x === 0) throw new Error(`Hazard ${i + 1}: a scarab nest must be left or right of centre.`);
  const def: { kind: 'scarabs'; x: number; y: number; path?: ScarabPoint[]; radius?: number } = {
    kind: 'scarabs',
    x,
    y,
  };
  if (h.path !== undefined) {
    if (!Array.isArray(h.path) || h.path.length < 1 || h.path.length > SCARAB_PATH_POINTS)
      throw new Error(`Hazard ${i + 1}: a scarab path must be 1-${SCARAB_PATH_POINTS} points.`);
    def.path = h.path.map((p: unknown, k) => {
      if (!p || typeof p !== 'object' || Array.isArray(p))
        throw new Error(`Hazard ${i + 1}: path point ${k + 1} needs x and y.`);
      const q = p as Record<string, unknown>;
      return { x: num(q.x, -25, 25, `path point ${k + 1} x`), y: num(q.y, -12, 14, `path point ${k + 1} y`) };
    });
  }
  if (h.radius !== undefined) {
    if (!okRadius(h.radius)) throw new Error(`Hazard ${i + 1}: ${RADIUS_RULE}`);
    if (h.radius) def.radius = h.radius as number;
  }
  return def;
}

function validateIcicle(h: Record<string, unknown>, i: number): IcicleDef {
  const limits: Record<string, [number, number]> = { x: [-25, 25], y: [-12, 14], length: [0.4, 3] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = h[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`Hazard ${i + 1}: invalid ${key}.`);
  }
  return { kind: 'icicle', x: h.x as number, y: h.y as number, length: h.length as number };
}

function validateIcicleArea(h: Record<string, unknown>, i: number): IcicleAreaDef {
  const [minPoints, maxPoints] = ICICLE_AREA_LIMITS.points;
  const ok = (p: unknown): p is { x: number; y: number } => {
    if (!p || typeof p !== 'object') return false;
    const { x, y } = p as Record<string, unknown>;
    return (
      typeof x === 'number' &&
      typeof y === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Math.abs(x) <= 25 &&
      y >= -12 &&
      y <= 14
    );
  };
  if (!Array.isArray(h.points) || h.points.length < minPoints || h.points.length > maxPoints || !h.points.every(ok)) {
    throw new Error(`Hazard ${i + 1}: an icicle area needs ${minPoints}-${maxPoints} points within the arena.`);
  }
  const count = h.count;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < ICICLE_AREA_LIMITS.count[0] ||
    count > ICICLE_AREA_LIMITS.count[1]
  ) {
    throw new Error(
      `Hazard ${i + 1}: an icicle area holds ${ICICLE_AREA_LIMITS.count[0]}-${ICICLE_AREA_LIMITS.count[1]} icicles.`,
    );
  }
  for (const key of ['minLength', 'maxLength']) {
    const n = h[key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < ICICLE_AREA_LIMITS.length[0] ||
      n > ICICLE_AREA_LIMITS.length[1]
    )
      throw new Error(`Hazard ${i + 1}: invalid ${key}.`);
  }
  if (typeof h.seed !== 'number' || !Number.isInteger(h.seed) || h.seed < 0 || h.seed > 1e9)
    throw new Error(`Hazard ${i + 1}: invalid seed.`);
  if (h.radius !== undefined && !okRadius(h.radius)) throw new Error(`Hazard ${i + 1}: ${RADIUS_RULE}`);
  const positions = h.positions;
  if (
    positions !== undefined &&
    (!Array.isArray(positions) ||
      positions.length !== count ||
      !positions.every((p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1))
  ) {
    throw new Error(`Hazard ${i + 1}: icicle positions must be one number from 0 to 1 per icicle.`);
  }
  return {
    kind: 'icicles',
    points: h.points.map(({ x, y }) => ({ x, y })),
    count,
    minLength: h.minLength as number,
    maxLength: h.maxLength as number,
    seed: h.seed,
    ...(positions ? { positions: [...positions] as number[] } : {}),
    ...(h.radius ? { radius: h.radius as number } : {}),
  };
}
