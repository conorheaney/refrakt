import { describe, expect, it } from 'vitest';
import { Campaign, worldEntry } from '../src/content/campaign';
import { STAGES_PER_WORLD, WORLD_TEMPLATES } from '../src/content/worlds';
import { World } from '../src/gameplay/World';
import { SIM } from '../src/gameplay/config';
import { CLASSIC_LEVELS } from './support/classicLevels';
import { CLASSIC, classicCampaign, SHIPPED_CAMPAIGN, SPACE_AREAS } from './support/worlds';

const levels = Array.from({ length: STAGES_PER_WORLD }, (_, i) => ({ name: `Stage ${i}`, hue: 0.4, rows: ['1............'] }));

describe('Campaign', () => {
  it('is what the game plays: the shipped world files, main campaign first', () => {
    expect(SHIPPED_CAMPAIGN.worlds.map((w) => w.def.name)).toEqual([
      'Outer Space', 'The Verdant Hollow', 'Pharoughs Tomb', 'Frozen Sanctuary', 'Atlantis', 'Volcanic Forge', 'Jungle Ruins',
    ]);
    expect(SHIPPED_CAMPAIGN.mainWorldCount).toBe(2);
    // Every world has both drawn areas.
    for (const world of SHIPPED_CAMPAIGN.worlds) {
      expect(world.playAreas.ball.points.length).toBeGreaterThanOrEqual(3);
      expect(world.playAreas.paddle.points.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds its worlds and their levels in play order', () => {
    expect(CLASSIC.levels).toEqual(CLASSIC_LEVELS);
    expect(CLASSIC.worldDefAt(STAGES_PER_WORLD + 3).id).toBe('forest');
    expect(CLASSIC.stageLabel(12)).toBe('Forest Level 3');
    expect(CLASSIC.musicTrackOf(0)).toBe('space');
  });

  it('returns new campaigns from with... and never changes the original', () => {
    const before = CLASSIC.worlds;
    const extra = CLASSIC.withWorld(worldEntry({ ...WORLD_TEMPLATES[0], name: 'Extra' }, levels, SPACE_AREAS));
    expect(CLASSIC.worlds).toBe(before);
    expect(extra.worlds).toHaveLength(before.length + 1);
    expect(extra.levelCount).toBe(CLASSIC.levelCount + STAGES_PER_WORLD);
    expect(extra.levelCells(CLASSIC.levelCount)).toEqual([{ col: 0, row: 0, kind: 0 }]);
    // Appended worlds are not part of the main campaign; a run started in one ends with that world.
    expect(extra.runEndLevel(0)).toBe(CLASSIC.levelCount);
    expect(extra.runEndLevel(CLASSIC.levelCount + 4)).toBe(extra.levelCount);

    const replaced = CLASSIC.withWorldAt(1, worldEntry({ ...WORLD_TEMPLATES[1], name: 'Other forest' }, levels, SPACE_AREAS, {}, STAGES_PER_WORLD));
    expect(replaced.worlds[1].def.name).toBe('Other forest');
    expect(replaced.levelCount).toBe(CLASSIC.levelCount);
    expect(CLASSIC.worlds[1].def.name).toBe('Forest');
    expect(() => CLASSIC.withWorldAt(5, replaced.worlds[1])).toThrow();
  });

  it('rejects malformed worlds up front', () => {
    expect(() => worldEntry(WORLD_TEMPLATES[0], levels.slice(1), SPACE_AREAS)).toThrow('exactly 10 levels');
    expect(() => worldEntry(WORLD_TEMPLATES[0], [{ name: 'Bad', hue: 0, rows: ['?'] }, ...levels.slice(1)], SPACE_AREAS)).toThrow();
    expect(() => worldEntry(WORLD_TEMPLATES[0], levels, { ball: SPACE_AREAS.ball } as never)).toThrow('paddle area');
    expect(() => new Campaign([])).toThrow('No playable worlds');
  });

  it('lets simulations with different campaigns run side by side without affecting each other', () => {
    const withSnake = new World(classicCampaign({ space: { hazards: [{ kind: 'snake', x: -8, y: -4, reach: 6 }] } }));
    const plain = new World(CLASSIC);
    plain.newGame(3, 0);
    withSnake.newGame(3, 0);
    expect(plain.snakes.items).toHaveLength(0);
    expect(withSnake.snakes.items).toHaveLength(1);
    for (let i = 0; i < 120; i++) {
      plain.step(SIM.step, { targetX: 0, axis: 0, action: i === 0 });
      withSnake.step(SIM.step, { targetX: 0, axis: 0, action: i === 0 });
    }
    expect(plain.campaign).toBe(CLASSIC);
  });
});
