import { describe, expect, it } from 'vitest';
import { BUILTIN_CAMPAIGN, Campaign, worldEntry } from '../src/content/campaign';
import { BUILTIN_LEVELS } from '../src/content/levels';
import { BUILTIN_WORLDS, STAGES_PER_WORLD } from '../src/content/worlds';
import { World } from '../src/gameplay/World';
import { SIM } from '../src/gameplay/config';

const levels = Array.from({ length: STAGES_PER_WORLD }, (_, i) => ({ name: `Stage ${i}`, hue: 0.4, rows: ['1............'] }));

describe('Campaign', () => {
  it('holds the built-in worlds and their levels in play order', () => {
    expect(BUILTIN_CAMPAIGN.worlds.map((w) => w.def)).toEqual(BUILTIN_WORLDS);
    expect(BUILTIN_CAMPAIGN.levels).toEqual(BUILTIN_LEVELS);
    expect(BUILTIN_CAMPAIGN.builtinLevelCount).toBe(BUILTIN_LEVELS.length);
    expect(BUILTIN_CAMPAIGN.worldDefAt(STAGES_PER_WORLD + 3).id).toBe('forest');
    expect(BUILTIN_CAMPAIGN.stageLabel(12)).toBe('Forest Level 3');
    expect(BUILTIN_CAMPAIGN.musicTrackOf(0)).toBe('space');
  });

  it('returns new campaigns from with... and never changes the original', () => {
    const before = BUILTIN_CAMPAIGN.worlds;
    const extra = BUILTIN_CAMPAIGN.withWorld(worldEntry({ ...BUILTIN_WORLDS[0], name: 'Extra' }, levels));
    expect(BUILTIN_CAMPAIGN.worlds).toBe(before);
    expect(extra.worlds).toHaveLength(before.length + 1);
    expect(extra.levelCount).toBe(BUILTIN_CAMPAIGN.levelCount + STAGES_PER_WORLD);
    expect(extra.levelCells(BUILTIN_CAMPAIGN.levelCount)).toEqual([{ col: 0, row: 0, kind: 0 }]);
    // Appended worlds are not part of the built-in run; a run started in one ends with that world.
    expect(extra.runEndLevel(0)).toBe(BUILTIN_CAMPAIGN.levelCount);
    expect(extra.runEndLevel(BUILTIN_CAMPAIGN.levelCount + 4)).toBe(extra.levelCount);

    const replaced = BUILTIN_CAMPAIGN.withWorldAt(1, worldEntry({ ...BUILTIN_WORLDS[1], name: 'Other forest' }, levels, {}, STAGES_PER_WORLD));
    expect(replaced.worlds[1].def.name).toBe('Other forest');
    expect(replaced.levelCount).toBe(BUILTIN_CAMPAIGN.levelCount);
    expect(BUILTIN_CAMPAIGN.worlds[1].def.name).toBe('Forest');
    expect(() => BUILTIN_CAMPAIGN.withWorldAt(5, replaced.worlds[1])).toThrow();
  });

  it('rejects malformed worlds up front', () => {
    expect(() => worldEntry(BUILTIN_WORLDS[0], levels.slice(1))).toThrow('exactly 10 levels');
    expect(() => worldEntry(BUILTIN_WORLDS[0], [{ name: 'Bad', hue: 0, rows: ['?'] }, ...levels.slice(1)])).toThrow();
    expect(() => new Campaign([])).toThrow();
  });

  it('lets simulations with different campaigns run side by side without affecting each other', () => {
    const hazards = BUILTIN_CAMPAIGN.withExtrasAt(0, { hazards: [{ kind: 'snake', x: -8, y: -4, reach: 6 }] });
    const plain = new World();
    const withSnake = new World(hazards);
    plain.newGame(3, 0);
    withSnake.newGame(3, 0);
    expect(plain.snakes.items).toHaveLength(0);
    expect(withSnake.snakes.items).toHaveLength(1);
    for (let i = 0; i < 120; i++) {
      plain.step(SIM.step, { targetX: 0, axis: 0, action: i === 0 });
      withSnake.step(SIM.step, { targetX: 0, axis: 0, action: i === 0 });
    }
    expect(new World().campaign).toBe(BUILTIN_CAMPAIGN);
  });
});
