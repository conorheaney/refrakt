import { isMusicTrack } from './musicTracks';
import { GRID, PADDLE } from '../gameplay/config';
import {
  defaultBallArea,
  defaultPaddleArea,
  findPaddleLane,
  validateArea,
  type PlayAreas,
} from '../gameplay/arena/playAreas';
import { validateHazards, type HazardDef } from '../gameplay/hazards/hazards';
import { parseLevel, type LevelDef } from './levels';
import { isWeather, STAGES_PER_WORLD, WORLD_TEMPLATES, type WorldDef, type WorldId } from './worlds';
import { worldEntry, type WorldEntry } from './campaign';
import { validateDustLine, type DustLine } from './dustLine';

/** Editor/library envelope only. WorldDef, LevelDef and their row alphabet are unchanged. */
export interface AuthoredWorld {
  key: string;
  /** Only honored for project files, never browser saves or editor previews. */
  replaces?: WorldId;
  world: WorldDef;
  levels: LevelDef[];
  /** Editor asset metadata; not part of WorldDef or LevelDef. Embedded for portable exports. */
  backgroundImage?: string;
  /** The ball's walls and the paddle's lane; a world needs both to be played (see missingAreas). */
  playAreas?: PlayAreas;
  /** Enemies active in every level of this world (gameplay/hazards/hazards.ts). */
  hazards?: HazardDef[];
  /** Where tomb dust pours from (content/dustLine.ts); a world with dust weather needs one to be played. */
  dustLine?: DustLine;
}

export const LIBRARY_KEY = 'refrakt.authored-worlds';
/** The scenery an authored world can be built on (its arena, grid and paddle come with it). */
export const BACKGROUNDS = WORLD_TEMPLATES;

export function createWorld(key: string): AuthoredWorld {
  return {
    key,
    world: { ...BACKGROUNDS[0], name: 'Untitled world' },
    // A world starts with the template arena's walls and paddle line, ready to be reshaped in the editor.
    playAreas: { ball: defaultBallArea(BACKGROUNDS[0].field), paddle: defaultPaddleArea(BACKGROUNDS[0].field) },
    levels: Array.from({ length: STAGES_PER_WORLD }, (_, i) => ({
      name: `LEVEL ${i + 1}`,
      hue: 0.58,
      rows: Array.from({ length: GRID.rows }, () => '.'.repeat(GRID.cols)),
    })),
  };
}

export function withBackground(world: WorldDef, id: WorldId): WorldDef {
  const background = BACKGROUNDS.find((item) => item.id === id);
  if (!background) throw new Error('Choose Space or Forest.');
  return {
    ...background,
    name: world.name,
    ...(world.blockStyle ? { blockStyle: world.blockStyle } : {}),
    ...(world.music ? { music: world.music } : {}),
    ...(world.weather ? { weather: world.weather } : {}),
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
  if (data.replaces !== undefined && data.replaces !== 'space' && data.replaces !== 'forest')
    throw new Error('Invalid campaign replacement.');
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
  if (world.blockStyle !== undefined && world.blockStyle !== 'classic' && world.blockStyle !== 'forge')
    throw new Error('Unsupported block style.');
  if (world.music !== undefined && !isMusicTrack(world.music)) throw new Error('Unsupported music track.');
  if (world.weather !== undefined && !isWeather(world.weather)) throw new Error('Unsupported weather.');
  name(world.name);
  const background = BACKGROUNDS.find((item) => item.id === world.id);
  if (!background) throw new Error('Unsupported background. Choose Space or Forest.');
  // The editor uses the existing arenas; do not accept arbitrary physics values from an import.
  for (const field of ['field', 'grid'] as const) {
    const values = record(world[field]);
    for (const [key, expected] of Object.entries(background[field])) {
      if (values[key] !== expected) throw new Error(`Unsupported ${field}.${key}. Use the existing arena settings.`);
    }
  }
  for (const key of ['paddleWidth', 'paddleExpandedWidth', 'serveLift'] as const) {
    if (world[key] !== background[key]) throw new Error(`Unsupported ${key}.`);
  }
  if (data.playAreas !== undefined) {
    const areas = record(data.playAreas);
    if (areas.ball !== undefined) validateArea(areas.ball, true);
    if (areas.paddle !== undefined)
      findPaddleLane(validateArea(areas.paddle), background.paddleExpandedWidth, PADDLE.halfH);
  }
  if (data.hazards !== undefined) validateHazards(data.hazards);
  if (data.dustLine !== undefined) validateDustLine(data.dustLine);
  if (!Array.isArray(data.levels) || data.levels.length !== STAGES_PER_WORLD)
    throw new Error('A world must contain exactly 10 levels.');
  data.levels.forEach((value: unknown, i: number) => {
    const level = record(value);
    name(level.name);
    if (typeof level.hue !== 'number' || !Number.isFinite(level.hue) || level.hue < 0 || level.hue > 1)
      throw new Error(`Level ${i + 1}: hue must be between 0 and 1.`);
    if (!Array.isArray(level.rows) || !level.rows.every((row) => typeof row === 'string'))
      throw new Error(`Level ${i + 1}: invalid rows.`);
    parseLevel(level as unknown as LevelDef, i);
  });
  const result = structuredClone(data) as unknown as AuthoredWorld;
  // Older files name a built-in wall shape ('rect' or a traced 'outline'); walls now always come from the drawn
  // ball area, so those settings are dropped.
  const legacy = result.world as WorldDef & { boundary?: unknown; outline?: unknown };
  delete legacy.boundary;
  delete legacy.outline;
  // Bosses were removed from the game; older files may still carry one per level.
  for (const level of result.levels) delete (level as LevelDef & { boss?: unknown }).boss;
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
