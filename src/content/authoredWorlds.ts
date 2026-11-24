import { isMusicTrack } from './musicTracks';
import { GRID, PADDLE } from '../gameplay/config';
import { findPaddleLane, validateArea, worldPlayAreas, type PlayAreas } from '../gameplay/arena/playAreas';
import { validateHazards, worldHazards, type HazardDef } from '../gameplay/hazards/hazards';
import { appendLevels, LEVELS, parseLevel, type LevelDef } from './levels';
import { appendWorld, isWeather, STAGES_PER_WORLD, WORLDS, type WorldDef, type WorldId } from './worlds';

/** Editor/library envelope only. WorldDef, LevelDef and their row alphabet are unchanged. */
export interface AuthoredWorld {
  key: string;
  /** Only honored for project files, never browser saves or editor previews. */
  replaces?: WorldId;
  world: WorldDef;
  levels: LevelDef[];
  /** Editor asset metadata; not part of WorldDef or LevelDef. Embedded for portable exports. */
  backgroundImage?: string;
  playAreas?: PlayAreas;
  /** Enemies active in every level of this world (gameplay/hazards/hazards.ts). */
  hazards?: HazardDef[];
}

export const LIBRARY_KEY = 'refrakt.authored-worlds';
export const BACKGROUNDS = WORLDS.slice(0, 2);
export const BUILTIN_LEVEL_COUNT = LEVELS.length;
export const BUILTIN_WORLD_COUNT = WORLDS.length;
export const authoredBackgrounds = new Map<number, string>();

export function createWorld(key: string): AuthoredWorld {
  return {
    key,
    world: { ...BACKGROUNDS[0], name: 'Untitled world' },
    levels: Array.from({ length: STAGES_PER_WORLD }, (_, i) => ({
      name: `LEVEL ${i + 1}`, hue: 0.58,
      rows: Array.from({ length: GRID.rows }, () => '.'.repeat(GRID.cols)),
    })),
  };
}

export function withBackground(world: WorldDef, id: WorldId): WorldDef {
  const background = BACKGROUNDS.find((item) => item.id === id);
  if (!background) throw new Error('Choose Space or Forest.');
  return { ...background, name: world.name, ...(world.blockStyle ? { blockStyle: world.blockStyle } : {}), ...(world.music ? { music: world.music } : {}), ...(world.weather ? { weather: world.weather } : {}) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a world object.');
  return value as Record<string, unknown>;
}

function name(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new Error('Names must contain 1–80 characters.');
}

/** Reject malformed imports before they reach the simulation or overwrite a saved world. */
export function validateWorld(value: unknown): AuthoredWorld {
  const data = record(value);
  if (data.replaces !== undefined && data.replaces !== 'space' && data.replaces !== 'forest') throw new Error('Invalid campaign replacement.');
  if (typeof data.key !== 'string' || !/^[\w-]{1,100}$/.test(data.key)) throw new Error('Invalid world key.');
  if (data.backgroundImage !== undefined && (typeof data.backgroundImage !== 'string' || data.backgroundImage.length > 1200000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.backgroundImage))) {
    throw new Error('Invalid background image. Upload a PNG, JPEG or WebP in the editor.');
  }
  const world = record(data.world);
  if (world.blockStyle !== undefined && world.blockStyle !== 'classic' && world.blockStyle !== 'forge') throw new Error('Unsupported block style.');
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
    if (areas.paddle !== undefined) findPaddleLane(validateArea(areas.paddle), background.paddleExpandedWidth, PADDLE.halfH);
  }
  if (data.hazards !== undefined) validateHazards(data.hazards);
  if (!Array.isArray(data.levels) || data.levels.length !== STAGES_PER_WORLD) throw new Error('A world must contain exactly 10 levels.');
  data.levels.forEach((value: unknown, i: number) => {
    const level = record(value);
    name(level.name);
    if (typeof level.hue !== 'number' || !Number.isFinite(level.hue) || level.hue < 0 || level.hue > 1) throw new Error(`Level ${i + 1}: hue must be between 0 and 1.`);
    if (!Array.isArray(level.rows) || !level.rows.every((row) => typeof row === 'string')) throw new Error(`Level ${i + 1}: invalid rows.`);
    parseLevel(level as unknown as LevelDef, i);
    if (level.boss !== undefined) {
      const boss = record(level.boss);
      name(boss.name);
      const limits: Record<string, [number, number]> = {
        hp: [1, 1000], radius: [0.1, 3], y: [0, 9], sway: [0, 10], swaySpeed: [0, 5],
        fireInterval: [0.1, 60], volley: [1, 10], shotSpeed: [0.1, 30], summonInterval: [0, 60], points: [0, 100000],
      };
      for (const [key, [min, max]] of Object.entries(limits)) {
        const n = boss[key];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`Level ${i + 1}: invalid boss ${key}.`);
      }
      if (!Number.isInteger(boss.volley) || !Number.isInteger(boss.hp)) throw new Error('Boss HP and volley must be integers.');
    }
  });
  return structuredClone(data) as unknown as AuthoredWorld;
}

export function unfinishedLevels(data: AuthoredWorld): number[] {
  return data.levels.flatMap((level, i) => level.boss || level.rows.some((row) => /[123XPG]/.test(row)) ? [] : [i + 1]);
}

export interface LibraryResult { worlds: AuthoredWorld[]; warnings: string[] }

export function readLibrary(storage: Pick<Storage, 'getItem'>): LibraryResult {
  const worlds: AuthoredWorld[] = [];
  const warnings: string[] = [];
  const raw = storage.getItem(LIBRARY_KEY);
  if (!raw) return { worlds, warnings };
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error('The saved world library is invalid. Export a backup before replacing it.');
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
  if (warnings.length) throw new Error('The library contains damaged entries; saving is disabled to protect them. Export your work first.');
  const index = worlds.findIndex((item) => item.key === data.key);
  if (index < 0) worlds.push(data);
  else worlds[index] = data;
  storage.setItem(LIBRARY_KEY, JSON.stringify(worlds));
}

/**
 * The WorldDef the game runs for an authored world. An uploaded image replaces the built-in scenery, so a
 * traced outline of that scenery (the Forest tree arch, WorldDef.boundary) no longer matches what is shown:
 * the ball then uses the arena rectangle instead (a drawn ball area, if any, still takes priority).
 */
export function playableWorld(data: Pick<AuthoredWorld, 'world' | 'backgroundImage'>): WorldDef {
  if (!data.backgroundImage || data.world.boundary !== 'outline') return data.world;
  return { ...data.world, boundary: 'rect' };
}

/** Called once before Game construction. All simulation/rendering code consumes the existing arrays. */
export function installWorlds(worlds: readonly AuthoredWorld[]): void {
  for (const value of worlds) {
    const data = validateWorld(value);
    if (unfinishedLevels(data).length) continue;
    if (data.backgroundImage) authoredBackgrounds.set(WORLDS.length, data.backgroundImage);
    if (data.playAreas) worldPlayAreas.set(WORLDS.length, data.playAreas);
    if (data.hazards) worldHazards.set(WORLDS.length, data.hazards);
    appendLevels(data.levels);
    appendWorld(playableWorld(data));
  }
}

/** Built-in campaign still ends at its original endpoint; authored runs end after ten levels. */
export function runEndLevel(start: number): number {
  return start < BUILTIN_LEVEL_COUNT ? BUILTIN_LEVEL_COUNT : (Math.floor(start / STAGES_PER_WORLD) + 1) * STAGES_PER_WORLD;
}
