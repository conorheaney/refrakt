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
  withBackground,
} from '../src/content/authoredWorlds';
import { buildCampaign } from '../src/content/fileWorlds';
import { GRID } from '../src/gameplay/config';
import { WORLD_TEMPLATES as WORLDS } from '../src/content/worlds';
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

  it('round-trips backgrounds, bosses and all brick kinds without changing game definitions', () => {
    const storage = memoryStorage();
    const data = createWorld('roundtrip');
    data.world = withBackground({ ...data.world, name: 'My forest' }, 'forest');
    data.levels = structuredClone(LEVELS.slice(10, 20));
    data.levels[0] = { name: 'All kinds', hue: 0.25, rows: ['123SXPG......'] };
    data.backgroundImage = 'data:image/jpeg;base64,YQ==';
    const builtin = JSON.stringify({ worlds: WORLDS, levels: LEVELS });
    saveWorld(storage, data);
    expect(readLibrary(storage).worlds).toEqual([data]);
    data.world = { ...data.world, name: 'Renamed' };
    saveWorld(storage, data);
    expect(readLibrary(storage).worlds).toHaveLength(1);
    expect(readLibrary(storage).worlds[0].world.name).toBe('Renamed');
    expect(JSON.stringify({ worlds: WORLDS, levels: LEVELS })).toBe(builtin);
  });

  it('rejects invalid layout, arena, hue, boss and image values before writing', () => {
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
    expect(() => validateWorld({ ...data, world: { ...data.world, paddleWidth: -1 } })).toThrow();
    const badHue = structuredClone(data);
    badHue.levels[0] = { ...badHue.levels[0], hue: NaN };
    expect(() => validateWorld(badHue)).toThrow();
    const badBoss = structuredClone(data);
    badBoss.levels[0] = { ...LEVELS[4], boss: { ...LEVELS[4].boss!, fireInterval: 0 } };
    expect(() => validateWorld(badBoss)).toThrow();
    expect(() => validateWorld({ ...data, backgroundImage: 'https://example.com/image.png' })).toThrow();
    expect(storage.getItem(LIBRARY_KEY)).toBe(saved);
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
    data.world = withBackground({ ...data.world, name: 'Authored' }, 'forest');
    data.levels = Array.from({ length: 10 }, (_, i) => ({ name: `Stage ${i}`, hue: 0.4, rows: ['123.XPG......'] }));
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
    expect(world.field).toEqual(data.world.field);
    world.loadLevel(first + 9);
    expect(world.levelIndex).toBe(first + 9);
    expect(campaign.runEndLevel(first)).toBe(first + 10);
    expect(campaign.runEndLevel(first + 9)).toBe(first + 10);
    // The main campaign (the worlds taking the Space and Forest slots) runs through both.
    expect(campaign.mainWorldCount).toBe(2);
    expect(campaign.runEndLevel(0)).toBe(20);
    expect(campaign.runEndLevel(10)).toBe(20);
  });
});
