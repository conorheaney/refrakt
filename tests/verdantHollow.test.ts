import { expect, it } from 'vitest';
import forest from '../public/worlds/Verdant-Hollow.json';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { installFileWorlds, loadFileWorlds } from '../src/content/fileWorlds';
import { validateWorld } from '../src/content/authoredWorlds';
import { BUILTIN_CAMPAIGN } from '../src/content/campaign';
import { BUILTIN_LEVELS as LEVELS, parseLevel } from '../src/content/levels';
import { BUILTIN_WORLDS as WORLDS } from '../src/content/worlds';
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
  const campaign = installFileWorlds(BUILTIN_CAMPAIGN, files.worlds);
  expect(campaign.worlds.map((world) => world.def.name)).toEqual(['Space', 'The Verdant Hollow', 'Pharoughs Tomb']);
  expect(campaign.levels).toHaveLength(30);
  expect(campaign.runEndLevel(10)).toBe(20);
  const sim = new World(campaign);
  for (let i = 10; i < 20; i++) {
    sim.newGame(123, i);
    expect(sim.bricksRemaining).toBeGreaterThan(0);
    expect(sim.boundary.kind).toBe('outline');
    expect(campaign.levelCells(i)).toEqual(parseLevel(originalLevels[i - 10], i));
    expect(sim.boss.active).toBe(i === 14 || i === 19);
  }
});

it('rejects unknown replacement slots', () => {
  expect(() => validateWorld({ ...forest, replaces: 'missing' })).toThrow('Invalid campaign replacement');
});
