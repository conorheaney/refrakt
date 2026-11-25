import frozen from '../public/worlds/Frozen-Sanctuary.json';
import { expect, it } from 'vitest';
import { validateWorld, unfinishedLevels } from '../src/content/authoredWorlds';
import { BALL, BRICK_HP, GRID, SIM } from '../src/gameplay/config';
import { parseLevel } from '../src/content/levels';
import { SHIPPED_CAMPAIGN as campaign } from './support/worlds';
import { areaContour, pointInPolygon } from '../src/gameplay/arena/playAreas';
import { BrickKind } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';

const data = validateWorld(frozen);

it('has ten complete formations with increasing durability, all seven block types, and usable boundary clearance', () => {
  expect(data.world.name).toBe('Frozen Sanctuary');
  expect(data.replaces).toBeUndefined();
  expect(unfinishedLevels(data)).toEqual([]);
  const contour = areaContour(data.playAreas!.ball!);
  const kinds = new Set<BrickKind>();
  let previous = 0;
  for (const [index, level] of data.levels.entries()) {
    const cells = parseLevel(level, index);
    const durability = cells.reduce((sum, cell) => sum + (cell.kind === BrickKind.Steel ? 0 : BRICK_HP[cell.kind]), 0);
    expect(durability).toBeGreaterThan(previous);
    previous = durability;
    for (const cell of cells) {
      kinds.add(cell.kind);
      const x = (cell.col - (GRID.cols - 1) / 2) * GRID.cellW;
      const y = GRID.topY - cell.row * GRID.cellH;
      for (const dx of [-GRID.halfW - BALL.radius, GRID.halfW + BALL.radius]) {
        for (const dy of [-GRID.halfH - BALL.radius, GRID.halfH + BALL.radius]) {
          expect(pointInPolygon({ x: x + dx, y: y + dy }, contour), `${level.name}: ${cell.col},${cell.row}`).toBe(
            true,
          );
        }
      }
    }
  }
  expect(kinds.size).toBe(7);
});

it('can clear every Frozen Sanctuary formation at its actual campaign speed', () => {
  // In the shipped campaign: Outer Space and Verdant Hollow (the main campaign), then Tomb, then Frozen Sanctuary.
  const first = campaign.worlds.findIndex((world) => world.def.name === 'Frozen Sanctuary') * 10;
  expect(first).toBe(30);
  for (let level = 0; level < 10; level++) {
    let cleared = false;
    for (let seed = 1; seed <= 3 && !cleared; seed++) {
      const world = new World(campaign);
      world.newGame(seed, first + level);
      // Extra lives test formation accessibility independently of the simple bot's skill.
      world.lives = 100;
      for (let step = 0; step < 120 * 600 && world.phase !== 'cleared'; step++) {
        const ball = world.balls.items.filter((b) => b.active).sort((a, b) => a.y - b.y)[0];
        world.step(SIM.step, {
          targetX: (ball?.x ?? 0) + Math.sin(step * 0.01) * 1.2,
          axis: 0,
          action: step % 60 === 0,
        });
      }
      cleared = world.phase === 'cleared';
    }
    expect(cleared, data.levels[level].name).toBe(true);
  }
}, 120000);
