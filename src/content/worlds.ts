import type { MusicTrackId } from './musicTracks';
import { FIELD, FOREST_FIELD, GRID, PADDLE, type FieldDef, type GridDef } from '../gameplay/config';

/**
 * A world is a run of ten levels sharing one scenery and arena. Bricks, ball, paddle and HUD are the same
 * in every world; each world can still set its own arena bounds, brick grid and paddle size.
 */
export type WorldId = 'space' | 'forest';

/** Weather a world can choose (WorldDef.weather). */
export type WeatherId = 'rain' | 'snow' | 'dust';
export const WEATHER: readonly { id: WeatherId; label: string }[] = [
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'dust', label: 'Tomb dust' },
];
export function isWeather(value: unknown): value is WeatherId {
  return WEATHER.some((item) => item.id === value);
}

export interface WorldDef {
  /** Visual skin only; brick rules and collision sizes remain shared. */
  readonly blockStyle?: 'classic' | 'forge';
  /** Soundtrack played in this world (app/audio/Music.ts). Absent means 'space'. */
  readonly music?: MusicTrackId;
  /** Weather drawn over the scenery (themes/weather/rain/RainLayer.ts, SnowLayer.ts, TombDustLayer.ts). Absent means clear. */
  readonly weather?: WeatherId;
  readonly id: WorldId;
  /** Shown as the level prefix: "Space Level 3", "Forest Level 7". */
  readonly name: string;
  /** Arena bounds: walls, ceiling, rounded corners, floor and paddle travel. */
  readonly field: FieldDef;
  /** Brick cell size and placement. */
  readonly grid: GridDef;
  /** Paddle width, normal and with EXPAND. */
  readonly paddleWidth: number;
  readonly paddleExpandedWidth: number;
  /** Extra gap between the paddle and a ball waiting to be launched. */
  readonly serveLift: number;
  /**
   * What the ball bounces off (see gameplay/arena/boundary.ts): 'rect' (the default when absent) is the field's rectangle
   * with rounded top corners; 'outline' is the traced outline data set named by `outline` (OUTLINES in
   * gameplay/arena/boundary.ts). Only the ball uses it; lasers, power-ups, shots and debris keep the rectangle.
   * `?boundary=rect` / `?boundary=outline` in the URL overrides it at runtime (see Game).
   */
  readonly boundary?: 'rect' | 'outline';
  readonly outline?: string;
}

/** Levels per world; each world has a boss at its midpoint and at its end. */
export const STAGES_PER_WORLD = 10;

/** The built-in worlds in play order: Space (levels 1-10), then Forest (11-20). See content/campaign.ts. */
export const BUILTIN_WORLDS: readonly WorldDef[] = [
  { id: 'space', name: 'Space', field: FIELD, grid: GRID, paddleWidth: PADDLE.width, paddleExpandedWidth: PADDLE.expandedWidth, serveLift: 0 },
  // The tree arch is wider than the Space arena but just as tall; the Space brick grid sits centred in it.
  // The ball bounces off the traced inside edge of the painted tree arch (content/outlines/forest.ts). To go back
  // to the rectangular arena, change boundary: 'outline' to boundary: 'rect'.
  { id: 'forest', name: 'Forest', field: FOREST_FIELD, grid: GRID, paddleWidth: PADDLE.width, paddleExpandedWidth: PADDLE.expandedWidth, serveLift: 0, boundary: 'outline', outline: 'forest', music: 'forest' },
];

/** Level number within its world (1-10). */
export function levelNumber(levelIndex: number): number {
  return (levelIndex % STAGES_PER_WORLD) + 1;
}

/**
 * How many ball-speed steps (BALL.speedPerLevel each) a level adds to the base speed. The first world
 * climbs one step per level. Later worlds start part-way up and climb more gently, so a new world opens
 * easier than the boss that ended the last one but still finishes faster than it.
 */
export function speedSteps(levelIndex: number): number {
  const world = Math.max(0, Math.floor(levelIndex / STAGES_PER_WORLD));
  const stage = levelIndex - world * STAGES_PER_WORLD;
  if (world === 0) return stage;
  return 4 + (world - 1) + stage * 0.8;
}
