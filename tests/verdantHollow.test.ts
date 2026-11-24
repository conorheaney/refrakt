import { expect, it } from 'vitest';
import forest from '../public/worlds/Verdant-Hollow.json';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { installFileWorlds, loadFileWorlds } from '../src/content/fileWorlds';
import { runEndLevel, validateWorld } from '../src/content/authoredWorlds';
import { LEVELS, LEVEL_CELLS, parseLevel } from '../src/content/levels';
import { WORLDS } from '../src/content/worlds';
import { World } from '../src/gameplay/World';

it('loads Verdant Hollow from JSON and replaces Forest without changing its levels, physics or campaign position', async () => {
  const original = structuredClone(WORLDS[1]);
  const originalLevels = structuredClone(LEVELS.slice(10, 20));
  const files = await loadFileWorlds(new URL('https://example.test/worlds/'), async (input) => {
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify(path.endsWith('index.json') ? ['Verdant-Hollow.json', 'Pharoughs-Tomb.json'] : path.endsWith('Verdant-Hollow.json') ? forest : tomb));
  });
  expect(files.warnings).toEqual([]);
  expect(files.worlds).toHaveLength(2);
  expect(files.worlds[0].levels).toEqual(originalLevels);
  expect(files.worlds[0].world).toEqual({ ...original, name: 'The Verdant Hollow' });
  installFileWorlds(files.worlds);
  expect(WORLDS.map((world) => world.name)).toEqual(['Space', 'The Verdant Hollow', 'Pharoughs Tomb']);
  expect(LEVELS).toHaveLength(30);
  expect(runEndLevel(10)).toBe(20);
  const sim = new World();
  for (let i = 10; i < 20; i++) {
    sim.newGame(123, i);
    expect(sim.bricksRemaining).toBeGreaterThan(0);
    expect(sim.boundary.kind).toBe('outline');
    expect(LEVEL_CELLS[i]).toEqual(parseLevel(originalLevels[i - 10], i));
    expect(sim.boss.active).toBe(i === 14 || i === 19);
  }
});

it('rejects unknown replacement slots', () => {
  expect(() => validateWorld({ ...forest, replaces: 'missing' })).toThrow('Invalid campaign replacement');
});
