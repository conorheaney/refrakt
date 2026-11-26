import { expect, it } from 'vitest';
import forest from '../public/worlds/Verdant-Hollow.json';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { buildCampaign, loadFileWorlds } from '../src/content/fileWorlds';
import { validateWorld } from '../src/content/authoredWorlds';
import { parseLevel } from '../src/content/levels';
import { WORLD_TEMPLATES } from '../src/content/worlds';
import { World } from '../src/gameplay/World';
import { CLASSIC_LEVELS } from './support/classicLevels';

it("loads Verdant Hollow from JSON as the main campaign's Forest world, keeping the original Forest levels", async () => {
  const originalLevels = structuredClone(CLASSIC_LEVELS.slice(10, 20));
  const files = await loadFileWorlds(new URL('https://example.test/worlds/'), async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    return new Response(
      JSON.stringify(
        path.endsWith('index.json')
          ? ['Verdant-Hollow.json', 'Pharoughs-Tomb.json']
          : path.endsWith('Verdant-Hollow.json')
            ? forest
            : tomb,
      ),
    );
  });
  expect(files.warnings).toEqual([]);
  expect(files.worlds).toHaveLength(2);
  expect(files.worlds[0].levels).toEqual(originalLevels);
  expect(files.worlds[0].world).toEqual({ ...WORLD_TEMPLATES[1], name: 'The Verdant Hollow' });
  const campaign = buildCampaign(files.worlds);
  // Only the Forest slot is taken here, so the main campaign is just Verdant Hollow.
  expect(campaign.worlds.map((world) => world.def.name)).toEqual(['The Verdant Hollow', 'Pharoughs Tomb']);
  expect(campaign.mainWorldCount).toBe(1);
  expect(campaign.levels).toHaveLength(20);
  expect(campaign.runEndLevel(0)).toBe(10);
  const sim = new World(campaign);
  for (let i = 0; i < 10; i++) {
    sim.newGame(123, i);
    expect(sim.bricksRemaining).toBeGreaterThan(0);
    // The ball bounces off the world's drawn ball area.
    expect(sim.boundary.bounds.top).toBeCloseTo(Math.max(...forest.playAreas.ball.points.map((p) => p.y)), 1);
    expect(campaign.levelCells(i)).toEqual(parseLevel(originalLevels[i], i));
    expect(sim.boss.active).toBe(i === 4 || i === 9);
  }
});

it('rejects unknown replacement slots', () => {
  expect(() => validateWorld({ ...forest, replaces: 'missing' })).toThrow('Invalid campaign replacement');
});
