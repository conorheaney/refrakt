import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { expect, it } from 'vitest';
import { validateWorld, unfinishedLevels } from '../src/content/authoredWorlds';
import { BALL, BRICK_HP, GRID, SIM } from '../src/gameplay/config';
import { parseLevel } from '../src/content/levels';
import { SHIPPED_CAMPAIGN as campaign } from './support/worlds';
import { areaContour, pointInPolygon } from '../src/gameplay/arena/playAreas';
import { World } from '../src/gameplay/World';

const data = validateWorld(tomb);

it('contains ten complete Tomb formations inside the saved arena with increasing durability', () => {
  expect(unfinishedLevels(data)).toEqual([]);
  const contour = areaContour(data.playAreas!.ball!);
  let previous = 0;
  for (const [index, level] of data.levels.entries()) {
    const cells = parseLevel(level, index);
    const durability = cells.reduce((sum, cell) => sum + BRICK_HP[cell.kind], 0);
    expect(durability).toBeGreaterThan(previous);
    previous = durability;
    for (const cell of cells) {
      const x = (cell.col - (GRID.cols - 1) / 2) * GRID.cellW;
      const y = GRID.topY - cell.row * GRID.cellH;
      // Include a ball-radius margin around every brick so boundary clearance is usable.
      for (const dx of [-GRID.halfW - BALL.radius, GRID.halfW + BALL.radius]) {
        for (const dy of [-GRID.halfH - BALL.radius, GRID.halfH + BALL.radius]) {
          expect(pointInPolygon({ x: x + dx, y: y + dy }, contour), `${level.name}: ${cell.col},${cell.row}`).toBe(true);
        }
      }
    }
  }
});

it('can clear every exported formation in the real simulation', () => {
  const first = campaign.worlds.findIndex((world) => world.def.name === 'Pharoughs Tomb') * 10;
  expect(first).toBe(20);
  for (let level = 0; level < 10; level++) {
    let cleared = false;
    for (let seed = 1; seed <= 3 && !cleared; seed++) {
      const world = new World(campaign);
      world.newGame(seed, first + level);
      // Extra lives isolate layout accessibility from the simple bot's catching ability.
      world.lives = 100;
      for (let step = 0; step < 120 * 600 && world.phase !== 'cleared'; step++) {
        const ball = world.balls.items.filter((b) => b.active).sort((a, b) => a.y - b.y)[0];
        world.step(SIM.step, {
          targetX: (ball?.x ?? 0) + Math.sin(step * 0.01) * 1.2,
          axis: 0, action: step % 60 === 0,
        });
      }
      cleared = world.phase === 'cleared';
    }
    expect(cleared, data.levels[level].name).toBe(true);
  }
}, 120000);
