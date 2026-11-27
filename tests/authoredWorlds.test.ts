import { describe, expect, it } from 'vitest';
import {
  createWorld,
  isPlayable,
  LIBRARY_KEY,
  missingAreas,
  playProblems,
  readLibrary,
  saveWorld,
  unfinishedLevels,
  validateWorld,
} from '../src/content/authoredWorlds';
import { buildCampaign } from '../src/content/fileWorlds';
import { validateAmbience, type AmbienceSettings } from '../src/gameplay/ambience/settings';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { worldEntry } from '../src/content/campaign';
import { FIELD, GRID } from '../src/gameplay/config';
import { World } from '../src/gameplay/World';
import { CLASSIC_LEVELS as LEVELS } from './support/classicLevels';
import { SHIPPED_WORLDS } from './support/worlds';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('authored world files and persistence', () => {
  it('creates ten independent blank levels in the existing row format', () => {
    const data = createWorld('test');
    expect(data.levels).toHaveLength(10);
    expect(unfinishedLevels(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(data.levels[0].rows).not.toBe(data.levels[1].rows);
    expect(
      data.levels.every(
        (level) => level.rows.length === GRID.rows && level.rows.every((row) => row === '.'.repeat(GRID.cols)),
      ),
    ).toBe(true);
    expect(validateWorld(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('round-trips backgrounds and all brick kinds without changing game definitions', () => {
    const storage = memoryStorage();
    const data = createWorld('roundtrip');
    data.world = { ...data.world, name: 'My forest', music: 'forest' };
    data.levels = structuredClone(LEVELS.slice(10, 20));
    data.levels[0] = { name: 'All kinds', rows: ['123SXPG......'] };
    data.backgroundImage = 'data:image/jpeg;base64,YQ==';
    const builtin = JSON.stringify(LEVELS);
    saveWorld(storage, data);
    expect(readLibrary(storage).worlds).toEqual([data]);
    data.world = { ...data.world, name: 'Renamed' };
    saveWorld(storage, data);
    expect(readLibrary(storage).worlds).toHaveLength(1);
    expect(readLibrary(storage).worlds[0].world.name).toBe('Renamed');
    expect(JSON.stringify(LEVELS)).toBe(builtin);
  });

  it('rejects invalid layout, area and image values before writing', () => {
    const storage = memoryStorage();
    const data = createWorld('validation');
    saveWorld(storage, data);
    const saved = storage.getItem(LIBRARY_KEY);
    const badRows = ['?', '1'.repeat(GRID.cols + 1)];
    for (const row of badRows) {
      const bad = structuredClone(data);
      bad.levels[0] = { ...bad.levels[0], rows: [row] };
      expect(() => saveWorld(storage, bad)).toThrow();
    }
    expect(() => validateWorld({ ...data, levels: data.levels.slice(1) })).toThrow();
    expect(() =>
      validateWorld({ ...data, playAreas: { ...data.playAreas, paddle: { radius: 0, points: [] } } }),
    ).toThrow();
    expect(() => validateWorld({ ...data, backgroundImage: 'https://example.com/image.png' })).toThrow();
    expect(storage.getItem(LIBRARY_KEY)).toBe(saved);
  });

  it('drops settings older world files carry for things the game no longer has', () => {
    const data = createWorld('legacy');
    const legacy = JSON.parse(JSON.stringify(data));
    // A built-in scene (and the arena sizes that came with it), a campaign slot, level hues and a boss.
    Object.assign(legacy.world, { id: 'forest', field: FIELD, grid: GRID, paddleWidth: 4.2, serveLift: 0 });
    legacy.replaces = 'forest';
    for (const level of legacy.levels) level.hue = 0.4;
    legacy.levels[4].boss = { name: 'THE WARDEN', hp: 22 };
    expect(validateWorld(legacy)).toEqual(data);
  });

  it('keeps good worlds readable and prevents silent loss of damaged entries', () => {
    const storage = memoryStorage();
    const data = createWorld('good');
    const raw = JSON.stringify([data, { broken: true }]);
    storage.setItem(LIBRARY_KEY, raw);
    expect(readLibrary(storage).worlds).toEqual([data]);
    expect(readLibrary(storage).warnings).toHaveLength(1);
    expect(() => saveWorld(storage, data)).toThrow();
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
  });

  it('surfaces storage failures instead of claiming a save succeeded', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    };
    expect(() => saveWorld(storage, createWorld('quota'))).toThrow('Quota exceeded');
  });

  it('does not publish empty or steel-only drafts', () => {
    const data = createWorld('draft');
    data.levels[0] = { ...data.levels[0], rows: ['SSSSSSSSSSSSS'] };
    const campaign = buildCampaign(SHIPPED_WORLDS, [data]);
    expect(campaign.worlds.length).toBe(SHIPPED_WORLDS.length);
    // Nothing playable at all is an error, not an empty game.
    expect(() => buildCampaign([data])).toThrow('No playable worlds');
  });

  it('starts new worlds with both areas, and only plays worlds that have both', () => {
    const data = createWorld('areas');
    expect(missingAreas(data)).toEqual([]);
    data.levels = data.levels.map((level) => ({ ...level, rows: ['1............'] }));
    expect(isPlayable(data)).toBe(true);
    // An older draft without areas still loads (so it can be finished in the editor) but is not playable.
    const old = structuredClone(data);
    delete old.playAreas;
    expect(validateWorld(old).playAreas).toBeUndefined();
    expect(missingAreas(old)).toEqual(['ball', 'paddle']);
    expect(isPlayable(old)).toBe(false);
    expect(playProblems(old)).toBe('no ball area drawn; no paddle area drawn');
    expect(buildCampaign(SHIPPED_WORLDS, [old]).worlds).toHaveLength(SHIPPED_WORLDS.length);
    // Older files' built-in wall settings are dropped.
    const legacy = validateWorld({ ...data, world: { ...data.world, boundary: 'outline', outline: 'forest' } });
    expect(legacy.world).not.toHaveProperty('boundary');
    expect(legacy.world).not.toHaveProperty('outline');
  });

  it('loads saved worlds in the real simulation and keeps their ten-level run boundaries', () => {
    const data = createWorld('playable');
    data.world = { ...data.world, name: 'Authored' };
    data.levels = Array.from({ length: 10 }, (_, i) => ({ name: `Stage ${i}`, rows: ['123.XPG......'] }));
    data.backgroundImage = 'data:image/jpeg;base64,YQ==';
    const campaign = buildCampaign(SHIPPED_WORLDS, [data]);
    const index = campaign.worlds.length - 1;
    const first = index * 10;
    // A browser save comes after every project file.
    expect(campaign.worlds[index].def).toEqual(data.world);
    expect(campaign.worlds[index].background).toBe(data.backgroundImage);
    expect(campaign.worlds[index].playAreas).toEqual(data.playAreas);
    expect(campaign.levelCells(first)).toHaveLength(6);
    const world = new World(campaign);
    world.newGame(123, first);
    expect(world.levelIndex).toBe(first);
    expect(world.bricksRemaining).toBe(6);
    world.loadLevel(first + 9);
    expect(world.levelIndex).toBe(first + 9);
    expect(campaign.runEndLevel(first)).toBe(first + 10);
    expect(campaign.runEndLevel(first + 9)).toBe(first + 10);
    // Every world is its own run, the first one included.
    expect(campaign.runEndLevel(0)).toBe(10);
    expect(campaign.runEndLevel(10)).toBe(20);
  });

  it("needs its ambience's lines to be played, and validates them", () => {
    const data = createWorld('snowy');
    data.levels = data.levels.map((level) => ({ ...level, rows: ['1............'] }));
    expect(isPlayable(data)).toBe(true);
    const snow: AmbienceSettings = { kind: 'snow', paths: [], every: [24, 40] };
    data.ambience = snow;
    expect(isPlayable(data)).toBe(false);
    expect(playProblems(data)).toBe('no snow line drawn');
    expect(() => worldEntry(data.world, data.levels, data.playAreas as never, { ambience: data.ambience })).toThrow(
      'no snow line drawn',
    );
    const line = {
      points: [
        { x: -6, y: 11 },
        { x: 6, y: 11 },
      ],
    };
    data.ambience = { ...snow, paths: [line] };
    expect(isPlayable(data)).toBe(true);
    expect(validateWorld(data).ambience).toEqual(data.ambience);
    expect(buildCampaign([data]).worlds[0].ambience).toEqual(data.ambience);
    // A line is 2-8 points within the scene, curved by 0 to 3; pulses come every 3-300 seconds.
    const bad = (change: Record<string, unknown>) => () => validateAmbience({ ...data.ambience, ...change });
    expect(bad({ kind: 'hail' })).toThrow('Unsupported ambience');
    expect(bad({ paths: [{ points: [{ x: 0, y: 9 }] }] })).toThrow('2-8 points');
    expect(
      bad({
        paths: [
          {
            points: [
              { x: 0, y: 9 },
              { x: 40, y: 9 },
            ],
          },
        ],
      }),
    ).toThrow('within the scene');
    expect(bad({ paths: [{ ...line, radius: 5 }] })).toThrow('curve');
    expect(bad({ paths: Array.from({ length: 7 }, () => line) })).toThrow('at most 6');
    expect(bad({ every: [30, 20] })).toThrow('every');
    expect(bad({ every: [1, 20] })).toThrow('every');
    expect(() => validateWorld({ ...data, ambience: 'snow' })).toThrow('Invalid ambience');
  });

  it('reads ambience as older files saved it: as weather, a name on the world, and the dust line beside it', () => {
    const data = createWorld('old');
    const old = (world: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      validateWorld({ ...data, world: { ...data.world, ...world }, ...extra });
    const rain = old({ weather: 'rain' });
    expect(rain.ambience?.kind).toBe('rain');
    expect(rain.ambience?.paths.length).toBe(1);
    expect((rain.world as unknown as Record<string, unknown>).weather).toBeUndefined();
    expect(() => old({ weather: 'hail' })).toThrow('Unsupported ambience');
    const lintel = {
      points: [
        { x: -10, y: 11 },
        { x: 10, y: 11 },
      ],
    };
    const nest = { kind: 'scarabs', x: -16, y: -9.2 };
    const dust = old({ weather: 'dust' }, { dustLine: lintel, hazards: [nest] });
    expect(dust.ambience).toEqual({ kind: 'dust', paths: [lintel], every: [14, 22] });
    expect(dust.hazardCues).toEqual({ scarabs: 'pulse' });
    expect((dust as unknown as Record<string, unknown>).dustLine).toBeUndefined();
    // Without nests the tomb pulses on its own; without a line it gets the usual one.
    expect(old({ weather: 'dust' }).ambience).toMatchObject({ kind: 'dust', every: [20, 40] });
    expect(old({ weather: 'dust' }).hazardCues).toBeUndefined();
    // Files that saved it as `weather`, listing the scarabs on it (`releases`), have them cued by its pulses.
    const listed = old(
      {},
      { hazards: [nest], weather: { kind: 'dust', paths: [lintel], every: [14, 22], releases: ['scarabs'] } },
    );
    expect(listed.ambience).toEqual({ kind: 'dust', paths: [lintel], every: [14, 22] });
    expect((listed as unknown as Record<string, unknown>).weather).toBeUndefined();
    expect(listed.hazardCues).toEqual({ scarabs: 'pulse' });
    // Cued by a "storm", as files saved it before it was called a pulse.
    expect(old({}, { hazards: [nest], hazardCues: { scarabs: 'storm' } }).hazardCues).toEqual({ scarabs: 'pulse' });
    // The shipped tomb, as it is saved now, keeps its line and its scarab pulses.
    expect(validateWorld(tomb)).toMatchObject({ ambience: { kind: 'dust' }, hazardCues: { scarabs: 'pulse' } });
  });

  it('gives each world one hazard of its own, read from what older files placed', () => {
    const data = createWorld('hazard');
    const nest = { kind: 'scarabs', x: -16, y: -9.2 };
    const snake = { kind: 'snake', x: 20, y: 0, reach: 6 };
    expect(validateWorld(data).hazard).toBeUndefined();
    expect(validateWorld({ ...data, hazards: [nest] }).hazard).toBe('scarabs');
    expect(validateWorld({ ...data, hazard: 'icicles' }).hazard).toBe('icicles');
    expect(() => validateWorld({ ...data, hazard: 'bats' })).toThrow('Unsupported hazard');
    expect(() => validateWorld({ ...data, hazards: [nest, snake] })).toThrow('one kind of hazard');
    expect(() => validateWorld({ ...data, hazard: 'snakes', hazards: [nest] })).toThrow('one kind of hazard');
    // Only its own hazard can wait for the pulses.
    expect(validateWorld({ ...data, hazard: 'snakes', hazardCues: { scarabs: 'pulse' } }).hazardCues).toBeUndefined();
    expect(validateWorld(tomb).hazard).toBe('scarabs');
  });

  it('checks which hazards a world sets off by a cue', () => {
    const data = { ...createWorld('cues'), hazard: 'scarabs' };
    expect(validateWorld({ ...data, hazardCues: { scarabs: 'pulse' } }).hazardCues).toEqual({ scarabs: 'pulse' });
    expect(() => validateWorld({ ...data, hazardCues: { snake: 'pulse' } })).toThrow('Unsupported hazard to cue');
    expect(() => validateWorld({ ...data, hazardCues: { scarabs: 'thunder' } })).toThrow('Unsupported hazard cue');
    expect(validateWorld({ ...data, hazardCues: {} }).hazardCues).toBeUndefined();
  });
});
