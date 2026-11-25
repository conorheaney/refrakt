import { describe, expect, it } from 'vitest';
import { BUILTIN_LEVEL_COUNT, BUILTIN_WORLD_COUNT, createWorld, installWorlds, LIBRARY_KEY, readLibrary, saveWorld, unfinishedLevels, validateWorld, withBackground } from '../src/content/authoredWorlds';
import { GRID } from '../src/gameplay/config';
import { BUILTIN_CAMPAIGN } from '../src/content/campaign';
import { BUILTIN_LEVELS as LEVELS } from '../src/content/levels';
import { BUILTIN_WORLDS as WORLDS } from '../src/content/worlds';
import { World } from '../src/gameplay/World';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('authored world files and persistence', () => {
  it('creates ten independent blank levels in the existing row format', () => {
    const data = createWorld('test');
    expect(data.levels).toHaveLength(10);
    expect(unfinishedLevels(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(data.levels[0].rows).not.toBe(data.levels[1].rows);
    expect(data.levels.every((level) => level.rows.length === GRID.rows && level.rows.every((row) => row === '.'.repeat(GRID.cols)))).toBe(true);
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
      const bad = structuredClone(data); bad.levels[0] = { ...bad.levels[0], rows: [row] };
      expect(() => saveWorld(storage, bad)).toThrow();
    }
    expect(() => validateWorld({ ...data, levels: data.levels.slice(1) })).toThrow();
    expect(() => validateWorld({ ...data, world: { ...data.world, paddleWidth: -1 } })).toThrow();
    const badHue = structuredClone(data); badHue.levels[0] = { ...badHue.levels[0], hue: NaN };
    expect(() => validateWorld(badHue)).toThrow();
    const badBoss = structuredClone(data); badBoss.levels[0] = { ...LEVELS[4], boss: { ...LEVELS[4].boss!, fireInterval: 0 } };
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
    const storage = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
    expect(() => saveWorld(storage, createWorld('quota'))).toThrow('Quota exceeded');
  });

  it('does not publish empty or steel-only drafts', () => {
    const data = createWorld('draft');
    data.levels[0] = { ...data.levels[0], rows: ['SSSSSSSSSSSSS'] };
    const campaign = installWorlds(BUILTIN_CAMPAIGN, [data]);
    expect(campaign.worlds.length).toBe(BUILTIN_WORLD_COUNT);
    expect(campaign.levelCount).toBe(BUILTIN_LEVEL_COUNT);
  });

  it('loads saved worlds in the real simulation and keeps their ten-level run boundaries', () => {
    const data = createWorld('playable');
    data.world = withBackground({ ...data.world, name: 'Authored' }, 'forest');
    data.levels = Array.from({ length: 10 }, (_, i) => ({ name: `Stage ${i}`, hue: 0.4, rows: ['123.XPG......'] }));
    data.backgroundImage = 'data:image/jpeg;base64,YQ==';
    const first = BUILTIN_CAMPAIGN.levelCount;
    const campaign = installWorlds(BUILTIN_CAMPAIGN, [data]);
    // Installing returns a new campaign; the built-in one is untouched.
    expect(BUILTIN_CAMPAIGN.worlds).toHaveLength(BUILTIN_WORLD_COUNT);
    // An uploaded image replaces the Forest scenery, so the ball uses the arena rectangle, not the tree outline.
    expect(campaign.worlds[BUILTIN_WORLD_COUNT].def).toEqual({ ...data.world, boundary: 'rect' });
    expect(campaign.worlds[BUILTIN_WORLD_COUNT].background).toBe(data.backgroundImage);
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
    expect(campaign.runEndLevel(0)).toBe(BUILTIN_LEVEL_COUNT);
    expect(campaign.runEndLevel(10)).toBe(BUILTIN_LEVEL_COUNT);
  });
});
