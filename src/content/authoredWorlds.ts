import { isMusicTrack } from './musicTracks';
import { FIELD, GRID, PADDLE } from '../gameplay/config';
import {
  defaultBallArea,
  defaultPaddleArea,
  findPaddleLane,
  validateArea,
  type PlayAreas,
} from '../gameplay/arena/playAreas';
import { validateHazards, type HazardDef } from '../gameplay/hazards/hazards';
import { parseLevel, type LevelDef } from './levels';
import { isWeather, STAGES_PER_WORLD, type WorldDef } from './worlds';
import { worldEntry, type WorldEntry } from './campaign';
import { validateDustLine, type DustLine } from './dustLine';

/** Editor/library envelope only. WorldDef, LevelDef and their row alphabet are unchanged. */
export interface AuthoredWorld {
  key: string;
  world: WorldDef;
  levels: LevelDef[];
  /** The world's scenery, embedded for portable exports. Without one the arena shows a plain dark backdrop. */
  backgroundImage?: string;
  /** The ball's walls and the paddle's lane; a world needs both to be played (see missingAreas). */
  playAreas?: PlayAreas;
  /** Enemies active in every level of this world (gameplay/hazards/hazards.ts). */
  hazards?: HazardDef[];
  /** Where tomb dust pours from (content/dustLine.ts); a world with dust weather needs one to be played. */
  dustLine?: DustLine;
}

export const LIBRARY_KEY = 'refrakt.authored-worlds';

export function createWorld(key: string): AuthoredWorld {
  return {
    key,
    world: { name: 'Untitled world' },
    // A world starts with the standard arena's walls and paddle line, ready to be reshaped in the editor.
    playAreas: { ball: defaultBallArea(FIELD), paddle: defaultPaddleArea(FIELD) },
    levels: Array.from({ length: STAGES_PER_WORLD }, (_, i) => ({
      name: `LEVEL ${i + 1}`,
      rows: Array.from({ length: GRID.rows }, () => '.'.repeat(GRID.cols)),
    })),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a world object.');
  return value as Record<string, unknown>;
}

function name(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80)
    throw new Error('Names must contain 1–80 characters.');
}

/** Reject malformed imports before they reach the simulation or overwrite a saved world. */
export function validateWorld(value: unknown): AuthoredWorld {
  const data = record(value);
  if (typeof data.key !== 'string' || !/^[\w-]{1,100}$/.test(data.key)) throw new Error('Invalid world key.');
  if (
    data.backgroundImage !== undefined &&
    (typeof data.backgroundImage !== 'string' ||
      data.backgroundImage.length > 1200000 ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.backgroundImage))
  ) {
    throw new Error('Invalid background image. Upload a PNG, JPEG or WebP in the editor.');
  }
  const world = record(data.world);
  if (world.music !== undefined && !isMusicTrack(world.music)) throw new Error('Unsupported music track.');
  if (world.weather !== undefined && !isWeather(world.weather)) throw new Error('Unsupported weather.');
  name(world.name);
  if (data.playAreas !== undefined) {
    const areas = record(data.playAreas);
    if (areas.ball !== undefined) validateArea(areas.ball, true);
    if (areas.paddle !== undefined) findPaddleLane(validateArea(areas.paddle), PADDLE.expandedWidth, PADDLE.halfH);
  }
  if (data.hazards !== undefined) validateHazards(data.hazards);
  if (data.dustLine !== undefined) validateDustLine(data.dustLine);
  if (!Array.isArray(data.levels) || data.levels.length !== STAGES_PER_WORLD)
    throw new Error('A world must contain exactly 10 levels.');
  data.levels.forEach((value: unknown, i: number) => {
    const level = record(value);
    name(level.name);
    if (!Array.isArray(level.rows) || !level.rows.every((row) => typeof row === 'string'))
      throw new Error(`Level ${i + 1}: invalid rows.`);
    parseLevel(level as unknown as LevelDef, i);
  });
  const result = structuredClone(data) as unknown as AuthoredWorld;
  // Settings older files may still carry, for things the game no longer has: built-in scenery templates (and
  // the arena, grid and paddle sizes that came with them), built-in wall shapes, brick styles, campaign slots that replaced
  // a built-in world, per-level scenery hues and bosses. Every world now shares one arena and camera.
  const legacyWorld = result.world as WorldDef & Record<string, unknown>;
  for (const key of [
    'id',
    'field',
    'grid',
    'paddleWidth',
    'paddleExpandedWidth',
    'serveLift',
    'boundary',
    'outline',
    'blockStyle',
  ])
    delete legacyWorld[key];
  delete (result as AuthoredWorld & { replaces?: unknown }).replaces;
  for (const level of result.levels) {
    const legacyLevel = level as LevelDef & { hue?: unknown; boss?: unknown };
    delete legacyLevel.hue;
    delete legacyLevel.boss;
  }
  return result;
}

/** The drawn areas a world still needs before it can be played. */
export function missingAreas(data: Pick<AuthoredWorld, 'playAreas'>): ('ball' | 'paddle')[] {
  return (['ball', 'paddle'] as const).filter((area) => !data.playAreas?.[area]);
}

/** Ready to play: every level has something to break and both areas are drawn. */
/** True when the world has tomb dust weather but no line for the dust to pour from. */
export function missingDustLine(data: Pick<AuthoredWorld, 'world' | 'dustLine'>): boolean {
  return data.world.weather === 'dust' && !data.dustLine;
}

/** Ready to play: every level has something to break, both areas are drawn, and a dust world has its dust line. */
export function isPlayable(data: AuthoredWorld): boolean {
  return unfinishedLevels(data).length === 0 && missingAreas(data).length === 0 && !missingDustLine(data);
}

/** Why a world can't be played yet, as one line for status messages (empty when it can). */
export function playProblems(data: AuthoredWorld): string {
  const problems: string[] = [];
  const levels = unfinishedLevels(data);
  if (levels.length) problems.push(`unfinished levels: ${levels.join(', ')}`);
  for (const area of missingAreas(data)) problems.push(`no ${area} area drawn`);
  if (missingDustLine(data)) problems.push('no dust line drawn');
  return problems.join('; ');
}

export function unfinishedLevels(data: AuthoredWorld): number[] {
  return data.levels.flatMap((level, i) => (level.rows.some((row) => /[123XPG]/.test(row)) ? [] : [i + 1]));
}

export interface LibraryResult {
  worlds: AuthoredWorld[];
  warnings: string[];
}

export function readLibrary(storage: Pick<Storage, 'getItem'>): LibraryResult {
  const worlds: AuthoredWorld[] = [];
  const warnings: string[] = [];
  const raw = storage.getItem(LIBRARY_KEY);
  if (!raw) return { worlds, warnings };
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values))
    throw new Error('The saved world library is invalid. Export a backup before replacing it.');
  for (const value of values) {
    try {
      const world = validateWorld(value);
      if (worlds.some((item) => item.key === world.key)) throw new Error('Duplicate world key.');
      worlds.push(world);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { worlds, warnings };
}

export function saveWorld(storage: Pick<Storage, 'getItem' | 'setItem'>, value: AuthoredWorld): void {
  const data = validateWorld(value);
  const { worlds, warnings } = readLibrary(storage);
  if (warnings.length)
    throw new Error(
      'The library contains damaged entries; saving is disabled to protect them. Export your work first.',
    );
  const index = worlds.findIndex((item) => item.key === data.key);
  if (index < 0) worlds.push(data);
  else worlds[index] = data;
  storage.setItem(LIBRARY_KEY, JSON.stringify(worlds));
}

/** The campaign entry for a playable authored world (its levels are numbered from `firstLevel` in errors). */
export function authoredEntry(data: AuthoredWorld, firstLevel = 0): WorldEntry {
  const { ball, paddle } = data.playAreas ?? {};
  if (!ball || !paddle) throw new Error(`${data.world.name}: draw a ball area and a paddle area before playing.`);
  return worldEntry(
    data.world,
    data.levels,
    { ball, paddle },
    { hazards: data.hazards, background: data.backgroundImage, dustLine: data.dustLine },
    firstLevel,
  );
}
