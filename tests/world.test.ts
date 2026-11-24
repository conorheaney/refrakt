import { describe, expect, it } from 'vitest';
import { BALL, BOSS_SUMMON, DROP, FIELD, FOREST_ART, FOREST_FIELD, GRID, PADDLE, PLAYER, POWER_WARN, SHIELD_CHARGES, SHIELD_PICKUP, SIM } from '../src/gameplay/config';
import { LEVELS, LEVEL_CELLS } from '../src/content/levels';
import { STAGES_PER_WORLD, WORLDS, speedSteps, worldOf } from '../src/content/worlds';
import { Pool } from '../src/engine/core/Pool';
import { Random } from '../src/engine/core/Random';
import { FixedStepper } from '../src/engine/core/Time';
import { BrickKind, POWERUP_KIND_COUNT, PowerUpKind } from '../src/gameplay/types';
import type { BoundaryKind } from '../src/gameplay/arena/boundary';
import { beyondArch, World, type StepInput } from '../src/gameplay/World';
import { worldPlayAreas, type PlayAreas } from '../src/gameplay/arena/playAreas';
import frozenShieldWorld from '../public/worlds/Frozen-Sanctuary.json';
import tombShieldWorld from '../public/worlds/Pharoughs-Tomb.json';
import spaceShieldWorld from '../public/worlds/Outer-Space-3f405ebf-2176-424e-8ba4-189416448443.json';

describe('paddle level initialization', () => {
  it('clears the previous hit animation when starting a new run or loading a level', () => {
    const world = new World();
    world.newGame(1);
    const hitPaddle = (): void => {
      world.time = 60;
      world.phase = 'live';
      const ball = world.balls.items.find((item) => item.active)!;
      Object.assign(ball, {
        stuck: false, x: world.paddle.x, px: world.paddle.x,
        y: world.paddle.y + PADDLE.halfH + BALL.radius + 0.01, dx: 0, dy: -1,
      });
      world.step(SIM.step, { targetX: 0, axis: 0, action: false });
      expect(world.paddle.hitTime).toBeGreaterThanOrEqual(60);
    };
    hitPaddle();
    world.newGame(2);
    expect(world.time).toBe(0);
    expect(world.time - world.paddle.hitTime).toBeGreaterThan(0.3);
    hitPaddle();
    world.loadLevel(1);
    expect(world.time - world.paddle.hitTime).toBeGreaterThan(0.3);
  });
});

describe('barrier pickups', () => {
  it('give SHIELD_PICKUP charges each and stack up to SHIELD_CHARGES', () => {
    const world = new World();
    world.newGame(1);
    const collect = (): void => (world as unknown as { collect(kind: PowerUpKind, x: number, y: number): void }).collect(PowerUpKind.Shield, 0, 0);
    collect();
    expect(world.shieldCharges).toBe(SHIELD_PICKUP);
    collect();
    expect(world.shieldCharges).toBe(SHIELD_CHARGES);
    collect();
    expect(world.shieldCharges).toBe(SHIELD_CHARGES);
  });
});

describe('timed power warnings', () => {
  it('warns once per second for the last POWER_WARN seconds, then expires once', () => {
    const world = new World();
    world.newGame(1);
    world.phase = 'live';
    const warnings: number[] = [];
    let expired = 0;
    world.events.on('powerUpWarning', ({ kind, left }) => {
      if (kind === PowerUpKind.Laser) warnings.push(left);
    });
    world.events.on('powerUpExpired', ({ kind }) => {
      if (kind === PowerUpKind.Laser) expired++;
    });
    world.effectTime[PowerUpKind.Laser] = POWER_WARN + 0.5;
    for (let i = 0; i < (POWER_WARN + 1) / SIM.step; i++) world.step(SIM.step, { targetX: 0, axis: 0, action: false });
    expect(warnings).toEqual(Array.from({ length: POWER_WARN }, (_, i) => POWER_WARN - i));
    expect(expired).toBe(1);
  });
});

describe('custom-lane barrier', () => {
  it('spans an offset paddle area and only saves balls within that span', () => {
    const previous = worldPlayAreas.get(0);
    worldPlayAreas.set(0, {
      paddle: { radius: 0, points: [{ x: -3, y: -7 }, { x: 9, y: -7 }, { x: 9, y: -5 }, { x: -3, y: -5 }] },
      ball: { radius: 0, drainEdge: 3, points: [{ x: -14, y: -5 }, { x: -14, y: 10 }, { x: 14, y: 10 }, { x: 14, y: -5 }] },
    });
    try {
      for (const x of [7, -8]) {
        const world = new World();
        world.newGame(1);
        expect(world.shieldLeft).toBeCloseTo(-3);
        expect(world.shieldRight).toBeCloseTo(9);
        world.shieldCharges = 2;
        world.phase = 'live';
        const ball = world.balls.items.find(item => item.active)!;
        Object.assign(ball, { stuck: false, x, px: x, y: -4.8, dx: 0, dy: -1 });
        for (let step = 0; step < 60 && ball.active && ball.dy < 0; step++) {
          world.step(SIM.step, { targetX: 0, axis: 0, action: false });
        }
        expect(ball.active).toBe(x === 7);
        if (x === 7) {
          expect(ball.dy).toBeGreaterThan(0);
          expect(world.shieldCharges).toBe(1);
        }
        world.loadLevel(1);
        world.paddle.width = PADDLE.expandedWidth;
        expect(world.shieldLeft).toBeCloseTo(-3);
        expect(world.shieldRight).toBeCloseTo(9);
      }
      worldPlayAreas.delete(0);
      const world = new World();
      world.newGame(1);
      expect(world.shieldLeft).toBe(-FIELD.paddleReach);
      expect(world.shieldRight).toBe(FIELD.paddleReach);
    } finally {
      if (previous) worldPlayAreas.set(0, previous);
      else worldPlayAreas.delete(0);
    }
  });
  for (const data of [frozenShieldWorld, tombShieldWorld, spaceShieldWorld]) {
    it(`saves at the visible shield below ${data.world.name}'s drain, including the last charge`, () => {
      const previous = worldPlayAreas.get(0);
      worldPlayAreas.set(0, data.playAreas as PlayAreas);
      try {
        for (const charges of [0, 1, 2]) {
          const world = new World();
          world.newGame(1);
          world.shieldCharges = charges;
          world.phase = 'live';
          const ball = world.balls.items.find((item) => item.active)!;
          const drainY = data.playAreas.ball.points[data.playAreas.ball.drainEdge].y;
          Object.assign(ball, { stuck: false, x: 8, px: 8, y: Math.max(drainY, world.shieldY + BALL.radius) + 0.2, dx: 0, dy: -1 });
          let hitY: number | undefined;
          world.events.on('shieldHit', () => { hitY = ball.y; });
          for (let step = 0; step < 60 && ball.active && ball.dy < 0; step++) {
            world.step(SIM.step, { targetX: 0, axis: 0, action: false });
          }
          if (charges === 0) {
            expect(ball.active).toBe(false);
            expect(hitY).toBeUndefined();
          } else {
            expect(ball.active).toBe(true);
            expect(ball.dy).toBeGreaterThan(0);
            expect(hitY).toBeCloseTo(world.shieldY + BALL.radius, 3);
            expect(world.shieldCharges).toBe(charges - 1);
            // Continue through the drain from below after spending the final charge.
            for (let step = 0; step < 20; step++) world.step(SIM.step, { targetX: 0, axis: 0, action: false });
            expect(ball.active).toBe(true);
            expect(world.shieldCharges).toBe(charges - 1);
          }
        }
      } finally {
        if (previous) worldPlayAreas.set(0, previous);
        else worldPlayAreas.delete(0);
      }
    });
  }
  it('saves a ball at the paddle bottom and restores the default height on leaving the lane', () => {
    const previous = worldPlayAreas.get(0);
    worldPlayAreas.set(0, {
      paddle: { radius: 0, points: [{ x: -14, y: -7 }, { x: 14, y: -7 }, { x: 14, y: -5 }, { x: -14, y: -5 }] },
    });
    try {
      const world = new World();
      world.newGame(1);
      expect(world.shieldY).toBeCloseTo(world.paddle.y - PADDLE.halfH);
      expect(world.shieldY).toBeGreaterThan(FIELD.shieldY + 1);
      world.shieldCharges = 2;
      world.phase = 'live';
      const ball = world.balls.items.find((item) => item.active)!;
      Object.assign(ball, { stuck: false, x: 8, px: 8, y: world.shieldY + BALL.radius + 0.01, dx: 0, dy: -1 });
      world.step(SIM.step, { targetX: 0, axis: 0, action: false });
      expect(ball.active).toBe(true);
      expect(ball.dy).toBeGreaterThan(0);
      expect(world.shieldCharges).toBe(1);

      worldPlayAreas.delete(0);
      world.loadLevel(1);
      expect(world.shieldY).toBe(FIELD.shieldY);
      expect(world.shieldCharges).toBe(0);
    } finally {
      if (previous) worldPlayAreas.set(0, previous);
      else worldPlayAreas.delete(0);
    }
  });
});

/** Simple deterministic autopilot: follow the lowest ball, press launch periodically. */
function autopilot(world: World, input: StepInput, step: number): void {
  let target = 0;
  let lowest = Infinity;
  for (const ball of world.balls.items) {
    if (ball.active && ball.y < lowest) {
      lowest = ball.y;
      target = ball.x;
    }
  }
  input.targetX = target + Math.sin(step * 0.01) * 1.2;
  input.action = step % 60 === 0;
}

function run(seed: number, steps: number, level = 0, onStep?: (world: World) => void, boundary: BoundaryKind | null = null): World {
  const world = new World();
  if (boundary) world.setBoundaryOverride(boundary);
  world.newGame(seed, level);
  const input: StepInput = { targetX: null, axis: 0, action: false };
  for (let i = 0; i < steps; i++) {
    autopilot(world, input, i);
    world.step(SIM.step, input);
    onStep?.(world);
    if (world.phase === 'cleared') world.loadLevel(world.levelIndex + 1);
  }
  return world;
}

function fingerprint(world: World): string {
  const balls = world.balls.items
    .filter((b) => b.active)
    .map((b) => `${b.x.toFixed(9)},${b.y.toFixed(9)}`)
    .join('|');
  return `${world.score}:${world.lives}:${world.levelIndex}:${world.bricksRemaining}:${world.paddle.x.toFixed(9)}:${balls}`;
}

describe('levels', () => {
  it('are all well-formed and winnable', () => {
    expect(LEVELS.length).toBe(WORLDS.length * STAGES_PER_WORLD);
    LEVELS.forEach((level, i) => {
      for (const row of level.rows) expect(row.length).toBe(GRID.cols);
      const breakable = LEVEL_CELLS[i].filter((c) => c.kind !== BrickKind.Steel).length;
      expect(breakable > 0 || level.boss !== undefined).toBe(true);
    });
  });

  it('fit the arena with room to play above the paddle', () => {
    const r = BALL.radius;
    LEVEL_CELLS.forEach((cells, i) => {
      // Each world lays its bricks out on its own grid, inside its own arena.
      const { grid, field } = worldOf(i);
      expect(grid.cols).toBe(GRID.cols);
      expect(grid.rows).toBe(GRID.rows);
      const cornerX = field.halfWidth - field.cornerRadius;
      const cornerY = field.top - field.cornerRadius;
      for (const cell of cells) {
        const x = (cell.col - (grid.cols - 1) / 2) * grid.cellW;
        const y = grid.topY - cell.row * grid.cellH;
        expect(y + grid.halfH + 2 * r).toBeLessThanOrEqual(field.top);
        expect(y - grid.halfH - (PADDLE.y + PADDLE.halfH)).toBeGreaterThan(4);
        expect(Math.abs(x) + grid.halfW).toBeLessThan(field.halfWidth);
        // Clear of the rounded corners too: the brick's outer top corner is inside the corner arc.
        const ox = Math.max(0, Math.abs(x) + grid.halfW - cornerX);
        const oy = Math.max(0, y + grid.halfH - cornerY);
        expect(Math.hypot(ox, oy)).toBeLessThan(field.cornerRadius);
      }
    });
    for (const world of WORLDS) expect(world.field.floorY).toBeCloseTo(PADDLE.y - PADDLE.halfH, 6);
  });

  it('keep the boss clear of its own summoning band', () => {
    LEVELS.forEach((level) => {
      if (!level.boss) return;
      const bandTop = GRID.topY - BOSS_SUMMON.firstRow * GRID.cellH + GRID.halfH;
      // The boss bobs 0.6 units vertically around def.y.
      expect(level.boss.y - level.boss.radius - 0.6).toBeGreaterThan(bandTop + 2 * BALL.radius);
      expect(level.boss.sway + level.boss.radius).toBeLessThan(FIELD.halfWidth);
      expect(level.boss.sway + level.boss.radius).toBeLessThan(FOREST_FIELD.halfWidth);
      expect(BOSS_SUMMON.lastRow).toBeLessThan(GRID.rows);
    });
  });

  it('place boss encounters on the fifth and tenth level of every world, and nowhere else', () => {
    LEVELS.forEach((level, i) => {
      const stage = i % STAGES_PER_WORLD;
      expect(level.boss !== undefined).toBe(stage === 4 || stage === 9);
    });
  });

  it('open each later world slower than the boss that ended the previous one', () => {
    for (let w = 1; w < WORLDS.length; w++) {
      const first = w * STAGES_PER_WORLD;
      expect(speedSteps(first)).toBeLessThan(speedSteps(first - 1));
      expect(speedSteps(first + STAGES_PER_WORLD - 1)).toBeGreaterThan(speedSteps(first - 1));
    }
    for (let i = 1; i < STAGES_PER_WORLD; i++) expect(speedSteps(i)).toBeGreaterThan(speedSteps(i - 1));
  });
});

describe('World', () => {
  it('starts with a ball waiting on the paddle', () => {
    const world = new World();
    world.newGame(1);
    expect(world.phase).toBe('serve');
    expect(world.balls.activeCount).toBe(1);
    expect(world.lives).toBe(PLAYER.lives);
    expect(world.bricksRemaining).toBe(world.bricksTotal);
    expect(world.bricksTotal).toBeGreaterThan(0);
  });

  it('uses the forest arena on forest levels with the space grid and paddle, and the space arena again after', () => {
    const world = new World();
    world.newGame(1, STAGES_PER_WORLD + 1);
    expect(world.field).toBe(FOREST_FIELD);
    expect(world.grid).toBe(GRID);
    expect(world.paddle.width).toBe(PADDLE.width);
    const brick = world.bricks[GRID.cols + 1];
    expect(brick.x).toBeCloseTo((1 - (GRID.cols - 1) / 2) * GRID.cellW, 9);
    expect(brick.y).toBeCloseTo(GRID.topY - GRID.cellH, 9);
    const ball = world.balls.items.find((b) => b.active);
    expect(ball?.y).toBeCloseTo(PADDLE.y + PADDLE.halfH + BALL.radius, 9);
    // The paddle reaches the walls, passing in front of the painted roots.
    const input: StepInput = { targetX: 100, axis: 0, action: false };
    for (let i = 0; i < 120; i++) world.step(SIM.step, input);
    expect(world.paddle.x + world.paddle.width / 2).toBeCloseTo(FOREST_FIELD.paddleReach, 6);
    expect(FOREST_FIELD.paddleReach).toBe(FOREST_FIELD.halfWidth);
    world.loadLevel(0);
    expect(world.field).toBe(FIELD);
    for (let i = 0; i < 120; i++) world.step(SIM.step, input);
    expect(world.paddle.x + world.paddle.width / 2).toBeCloseTo(FIELD.halfWidth, 6);
  });

  it('maps the forest arena onto the painted tree arch', () => {
    const px = (x: number): number => FOREST_ART.centrePx + x * FOREST_ART.pxPerUnit;
    const py = (y: number): number => FOREST_ART.ceilingPx + (FOREST_FIELD.top - y) * FOREST_ART.pxPerUnitY;
    // Walls on the trunks' inner edges (259-268 px on the left, 1406-1411 px on the right).
    expect(px(-FOREST_FIELD.halfWidth)).toBeCloseTo(268, 6);
    expect(px(FOREST_FIELD.halfWidth)).toBeCloseTo(1404, 6);
    // Ceiling just under the branch's lowest dips (103-106 px).
    expect(py(FOREST_FIELD.top)).toBeCloseTo(110, 6);
    // The paddle's drawn bottom edge sits 100 px above the bottom of the 941 px painting.
    expect(py(PADDLE.y) + FOREST_ART.paddleDrawnDrop * FOREST_ART.pxPerUnit).toBeCloseTo(941 - 100, 6);
    // Barrier at 831 px and the ball-loss line at 864 px, just below the paddle; the paddle's ends reach the walls.
    expect(py(FOREST_FIELD.floorY)).toBeCloseTo(831, 0);
    expect(py(FOREST_FIELD.bottom)).toBeCloseTo(864, 0);
    expect(px(-FOREST_FIELD.paddleReach)).toBeCloseTo(268, 6);
    // Same heights as the Space arena, so Space bricks and serve positions carry over unchanged.
    expect(FOREST_FIELD.top).toBe(FIELD.top);
    expect(FOREST_FIELD.floorY).toBe(FIELD.floorY);
  });

  it('launches on action and breaks bricks', () => {
    const world = run(7, 120 * 30);
    expect(world.score).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed and input stream', () => {
    const a = run(1234, 120 * 40);
    const b = run(1234, 120 * 40);
    expect(fingerprint(a)).toBe(fingerprint(b));
    const c = run(4321, 120 * 40);
    expect(fingerprint(c)).not.toBe(fingerprint(a));
  });

  it('keeps every ball inside the arena and at unit direction', () => {
    const r = BALL.radius;
    for (const level of [0, 3, 5, 8, 10, 11, 13, 16]) {
      run(99 + level, 120 * 45, level, (world) => {
        const field = world.field;
        for (const ball of world.balls.items) {
          if (!ball.active) continue;
          expect(Math.abs(ball.x)).toBeLessThanOrEqual(field.halfWidth - r + 1e-6);
          expect(ball.y).toBeLessThanOrEqual(field.top - r + 1e-6);
          expect(beyondArch(ball.x, ball.y, r - 1e-6, field)).toBe(false);
          expect(Math.hypot(ball.dx, ball.dy)).toBeCloseTo(1, 6);
          if (!ball.stuck) expect(Math.abs(ball.dy)).toBeGreaterThanOrEqual(BALL.minVertical - 1e-9);
        }
      }, 'rect'); // the rectangular arena in every world (the forest outline has its own tests in outline.test.ts)
    }
  });

  it('bounces off the arch frame\'s rounded top corners', () => {
    const r = BALL.radius;
    const cases = [FIELD, FOREST_FIELD].flatMap((field, w) => [-1, 1].flatMap((side) => [0.3, 0.6, 0.9, 1.2].map((angle) => ({ start: w * STAGES_PER_WORLD, field, side, angle }))));
    for (const { start, field, side, angle } of cases) {
      const world = new World();
      world.setBoundaryOverride('rect');
      world.newGame(5, start);
      for (const brick of world.bricks) brick.alive = false;
      const ball = world.balls.items.find((b) => b.active);
      if (!ball) throw new Error('no ball');
      ball.stuck = false;
      world.phase = 'live';
      // Start well inside, heading up and outward straight into the corner zone.
      ball.x = ball.px = side * (field.halfWidth - field.cornerRadius - 1);
      ball.y = ball.py = field.top - field.cornerRadius - 1;
      ball.dx = side * Math.sin(angle);
      ball.dy = Math.cos(angle);
      let bounced = false;
      const input: StepInput = { targetX: ball.x, axis: 0, action: false };
      for (let i = 0; i < 120 && ball.active; i++) {
        world.step(SIM.step, input);
        expect(beyondArch(ball.x, ball.y, r - 1e-6, field)).toBe(false);
        // A concave corner turns the ball back inward and/or downward depending on where it lands.
        if (ball.dy < 0 || side * ball.dx < 0) bounced = true;
      }
      expect(bounced).toBe(true);
    }
  });

  it('never leaves a free ball embedded in a solid brick', { timeout: 30000 }, () => {
    for (const level of [2, 11]) {
      run(5, 120 * 40, level, (world) => {
        for (const ball of world.balls.items) {
          if (!ball.active || ball.stuck) continue;
          for (const brick of world.bricks) {
            if (!brick.alive || !brick.solid) continue;
            const inside = Math.abs(ball.x - brick.x) < world.grid.halfW && Math.abs(ball.y - brick.y) < world.grid.halfH;
            expect(inside).toBe(false);
          }
        }
      });
    }
  });

  it('loses a life when the last ball drops and ends at zero lives', () => {
    const world = new World();
    world.newGame(3);
    const events: string[] = [];
    world.events.on('lifeLost', () => events.push('life'));
    world.events.on('gameOver', () => events.push('over'));
    // Hide in the corner so every serve is lost.
    const input: StepInput = { targetX: -FIELD.halfWidth, axis: 0, action: false };
    for (let i = 0; i < 120 * 120 && world.phase !== 'over'; i++) {
      input.action = i % 30 === 0;
      // Keep the paddle away from wherever the ball is heading.
      const ball = world.balls.items.find((b) => b.active);
      input.targetX = ball && !ball.stuck ? (ball.x > 0 ? -FIELD.halfWidth : FIELD.halfWidth) : 0;
      world.step(SIM.step, input);
    }
    expect(world.phase).toBe('over');
    expect(world.lives).toBe(0);
    expect(events.filter((e) => e === 'life').length).toBe(PLAYER.lives);
    expect(events[events.length - 1]).toBe('over');
  });

  it('demo mode never runs out of lives', () => {
    const world = new World();
    world.demo = true;
    world.newGame(11);
    const input: StepInput = { targetX: FIELD.halfWidth, axis: 0, action: false };
    for (let i = 0; i < 120 * 60; i++) world.step(SIM.step, input);
    expect(world.phase).not.toBe('over');
    expect(world.lives).toBe(PLAYER.lives);
  });

  it('releases at most DROP.maxPerLevel power-ups per level', () => {
    for (const level of [1, 5, 8]) {
      const world = new World();
      world.newGame(77 + level, level);
      const input: StepInput = { targetX: null, axis: 0, action: false };
      const was = world.drops.items.map(() => false);
      let released = 0;
      for (let i = 0; i < 120 * 90 && world.phase !== 'cleared'; i++) {
        autopilot(world, input, i);
        world.step(SIM.step, input);
        world.drops.items.forEach((d, k) => {
          if (d.active && !was[k]) released++;
          was[k] = d.active;
        });
        expect(world.drops.activeCount).toBeLessThanOrEqual(DROP.maxActive);
        if (world.lives < 3) world.lives = 3;
      }
      expect(released).toBeLessThanOrEqual(DROP.maxPerLevel);
    }
  });

  describe('power-up loadout', () => {
    /** Plays `level` with the autopilot and returns the kind of every power-up released, in order. */
    function dropsFor(seed: number, level: number, loadout: readonly PowerUpKind[] | null, seconds = 90): { kinds: PowerUpKind[]; perLevel: number[] } {
      const world = new World();
      world.setLoadout(loadout);
      world.newGame(seed, level);
      const input: StepInput = { targetX: null, axis: 0, action: false };
      const was = world.drops.items.map(() => false);
      const kinds: PowerUpKind[] = [];
      const perLevel: number[] = [0];
      for (let i = 0; i < 120 * seconds; i++) {
        autopilot(world, input, i);
        world.step(SIM.step, input);
        if (world.lives < 3) world.lives = 3;
        world.drops.items.forEach((d, k) => {
          if (d.active && !was[k]) {
            kinds.push(d.kind);
            perLevel[perLevel.length - 1]++;
          }
          was[k] = d.active;
        });
        if (world.phase === 'cleared') {
          world.loadLevel(world.levelIndex + 1);
          perLevel.push(0);
        }
      }
      return { kinds, perLevel };
    }

    it('only drops the chosen kinds, within the per-level cap, on every level', () => {
      const loadouts: PowerUpKind[][] = [
        [PowerUpKind.Laser, PowerUpKind.Fire, PowerUpKind.Life],
        [PowerUpKind.Expand, PowerUpKind.Multi, PowerUpKind.Shield],
        [PowerUpKind.Slow, PowerUpKind.Magnet, PowerUpKind.Life],
      ];
      let total = 0;
      loadouts.forEach((loadout, n) => {
        for (let level = 0; level < LEVELS.length; level++) {
          const { kinds, perLevel } = dropsFor(500 + n * 37 + level, level, loadout, 60);
          for (const k of kinds) expect(loadout).toContain(k);
          for (const count of perLevel) expect(count).toBeLessThanOrEqual(DROP.maxPerLevel);
          total += kinds.length;
        }
      });
      // Make sure the test actually exercised plenty of drops.
      expect(total).toBeGreaterThan(60);
    }, 120000);

    it('without a loadout behaves exactly as with every kind allowed (the original behaviour)', () => {
      const all = Array.from({ length: POWERUP_KIND_COUNT }, (_, k) => k as PowerUpKind);
      for (const level of [0, 3, 6]) {
        const free = dropsFor(900 + level, level, null);
        const full = dropsFor(900 + level, level, all);
        expect(free.kinds).toEqual(full.kinds);
        expect(free.kinds.length).toBeGreaterThan(0);
      }
      const a = run(1234, 120 * 40);
      const b = new World();
      expect(b.loadout).toBeNull();
      expect(fingerprint(a)).toBe(fingerprint(run(1234, 120 * 40)));
    }, 120000);

    it('keeps the loadout across levels and new games until changed, and validates it', () => {
      const world = new World();
      world.setLoadout([PowerUpKind.Fire, PowerUpKind.Laser, PowerUpKind.Shield]);
      world.newGame(1, 2);
      world.loadLevel(3);
      expect(world.loadout).toEqual([PowerUpKind.Fire, PowerUpKind.Laser, PowerUpKind.Shield]);
      world.setLoadout(null);
      expect(world.loadout).toBeNull();
      expect(() => world.setLoadout([PowerUpKind.Fire, PowerUpKind.Fire, PowerUpKind.Life])).toThrow();
      expect(() => world.setLoadout([])).toThrow();
      expect(() => world.setLoadout([99 as PowerUpKind])).toThrow();
    });
  });

  describe('refrakt', () => {
    /** Clears the board but for an armored target with tough bricks either side, and the ball fired straight up at it. */
    function setup(refrakt: boolean, targetKind = BrickKind.Armored) {
      const world = new World();
      world.newGame(5);
      world.step(SIM.step, { targetX: null, axis: 0, action: true }); // launch
      for (const b of world.bricks) b.alive = false;
      const row = 3;
      const col = Math.floor(GRID.cols / 2);
      const at = (c: number) => world.bricks[row * GRID.cols + c];
      const target = at(col);
      const hp = targetKind === BrickKind.Armored ? 3 : 1;
      Object.assign(target, { alive: true, solid: true, kind: targetKind, hp, maxHp: hp, fuse: 0 });
      for (const c of [col - 1, col + 1]) Object.assign(at(c), { alive: true, solid: true, kind: BrickKind.Tough, hp: 2, maxHp: 2, fuse: 0 });
      // A far-off brick keeps the level from clearing.
      Object.assign(world.bricks[0], { alive: true, solid: true, kind: BrickKind.Normal, hp: 1, maxHp: 1, fuse: 0 });
      const ball = world.balls.items.find((b) => b.active)!;
      Object.assign(ball, { x: target.x, y: target.y - world.grid.halfH - BALL.radius - 0.3, dx: 0, dy: 1, stuck: false });
      ball.px = ball.x;
      ball.py = ball.y;
      if (refrakt) world.refraktTime = 9;
      let bursts = 0;
      let started = 0;
      world.events.on('refraktBurst', () => bursts++);
      world.events.on('refraktStarted', () => started++);
      const input: StepInput = { targetX: null, axis: 0, action: false };
      for (let i = 0; i < 30; i++) world.step(SIM.step, input);
      return { world, target, left: at(col - 1), right: at(col + 1), bursts, started, ball };
    }

    it('shatters any brick in one hit and cracks the bricks beside it, still bouncing', () => {
      const { target, left, right, bursts, ball } = setup(true);
      expect(target.alive).toBe(false);
      expect(bursts).toBe(1);
      expect(left.hp).toBe(1);
      expect(right.hp).toBe(1);
      expect(ball.dy).toBeLessThan(0); // bounced back, unlike the fireball
    });

    it('starts when a prism brick breaks, without splitting the ball, and runs out', () => {
      const { world, target, started } = setup(false, BrickKind.Prism);
      expect(target.alive).toBe(false);
      expect(started).toBe(1);
      expect(world.refraktActive).toBe(true);
      expect(world.balls.activeCount).toBe(1);
      world.refraktTime = SIM.step / 2;
      world.step(SIM.step, { targetX: null, axis: 0, action: false });
      expect(world.refraktActive).toBe(false);
    });

    it('a plain ball only chips the same brick', () => {
      const { target, left, bursts } = setup(false);
      expect(target.alive).toBe(true);
      expect(target.hp).toBe(2);
      expect(left.hp).toBe(2);
      expect(bursts).toBe(0);
    });
  });

  it('boss levels clear only when the boss is defeated', () => {
    const world = new World();
    world.newGame(21, 4);
    expect(world.boss.active).toBe(true);
    let cleared = false;
    let defeated = false;
    world.events.on('bossDefeated', () => (defeated = true));
    world.events.on('levelCleared', () => (cleared = true));
    const input: StepInput = { targetX: null, axis: 0, action: false };
    for (let i = 0; i < 120 * 600 && !cleared && world.phase !== 'over'; i++) {
      autopilot(world, input, i);
      world.step(SIM.step, input);
      if (world.lives < 3) world.lives = 3; // the test is about the win condition, not survival
    }
    expect(defeated).toBe(true);
    expect(cleared).toBe(true);
  });
});

describe('core utilities', () => {
  it('Pool recycles objects without growing', () => {
    const pool = new Pool(2, () => ({ active: false, id: 0 }));
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a && b).toBeTruthy();
    expect(pool.acquire()).toBeNull();
    if (a) pool.release(a);
    expect(pool.activeCount).toBe(1);
    expect(pool.acquire()).toBe(a);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
  });

  it('Random is reproducible and uniform in range', () => {
    const a = new Random(42);
    const b = new Random(42);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('FixedStepper runs whole steps and reports the remainder', () => {
    const stepper = new FixedStepper(0.01, 100);
    let steps = 0;
    const alpha = stepper.advance(0.035, () => steps++);
    expect(steps).toBe(3);
    expect(alpha).toBeCloseTo(0.5, 6);
  });

  it('FixedStepper drops the backlog instead of spiralling', () => {
    const stepper = new FixedStepper(0.01, 5);
    let steps = 0;
    stepper.advance(10, () => steps++);
    expect(steps).toBe(5);
    steps = 0;
    stepper.advance(0.01, () => steps++);
    expect(steps).toBe(1);
  });
});
