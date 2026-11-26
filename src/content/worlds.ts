import type { MusicTrackId } from './musicTracks';

/**
 * A world is a run of ten levels sharing one scenery (an uploaded background image) and arena (walls and paddle
 * lane drawn in the editor). Bricks, ball, paddle, camera and HUD are the same in every world.
 */
export interface WorldDef {
  /** Shown as the level prefix: "Atlantis Level 3". */
  readonly name: string;
  /** Soundtrack played in this world (app/audio/Music.ts). Absent means 'space'. */
  readonly music?: MusicTrackId;
}

/** Levels per world. */
export const STAGES_PER_WORLD = 10;

/** Level number within its world (1-10). */
export function levelNumber(levelIndex: number): number {
  return (levelIndex % STAGES_PER_WORLD) + 1;
}

/**
 * How many ball-speed steps (BALL.speedPerLevel each) a level adds to the base speed. The first world
 * climbs one step per level. Later worlds start part-way up and climb more gently, so a new world opens
 * easier than the level that ended the last one but still finishes faster than it.
 */
export function speedSteps(levelIndex: number): number {
  const world = Math.max(0, Math.floor(levelIndex / STAGES_PER_WORLD));
  const stage = levelIndex - world * STAGES_PER_WORLD;
  if (world === 0) return stage;
  return 4 + (world - 1) + stage * 0.8;
}
