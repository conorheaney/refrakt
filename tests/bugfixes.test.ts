import { describe, expect, it } from 'vitest';
import { STAGES_PER_WORLD } from '../src/content/worlds';
import { BALL, ICICLE, PADDLE, SCARAB, SIM } from '../src/gameplay/config';
import { EventBus } from '../src/engine/core/EventBus';
import { Random } from '../src/engine/core/Random';
import type { GameEvents } from '../src/gameplay/events';
import { ScarabSystem } from '../src/gameplay/hazards/scarabs/scarabs';
import { PowerUpKind } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';
import { CLASSIC, classicCampaign } from './support/worlds';

const idle = { targetX: null, axis: 0, action: false };

// Regression tests for the bugs found in code review 001 (reviews/bobs-code-review-001.md).
describe('code review 001 fixes', () => {
  it('Q1: forgets trapped-ball history when balls are cleared (new game, level change, lost life)', () => {
    const world = new World(CLASSIC);
    world.newGame(1, STAGES_PER_WORLD); // the Forest tree arch
    const ball = world.balls.items.find((b) => b.active)!;
    const guard = world.ballPhysics.trapGuard;
    for (let i = 0; i < 3; i++) guard.onContact(ball, 50 + i * 0.01, 0, 0);
    world.newGame(2, STAGES_PER_WORLD);
    // Straight after a new game (time back at 0) a fresh contact must not count the old run's hits.
    const again = world.balls.items.find((b) => b.active)!;
    for (let i = 0; i < 3; i++) expect(guard.onContact(again, i * 0.01, 0, 0)).toBe(false);
  });

  it('Q3: Multiball splits a ball held by Magnet, launching the copies upwards', () => {
    const world = new World(CLASSIC);
    world.newGame(1);
    world.phase = 'live';
    const held = world.balls.items.find((b) => b.active)!;
    expect(held.stuck).toBe(true);
    world.powerUps.collect(PowerUpKind.Multi, 0, 0);
    const active = world.balls.items.filter((b) => b.active);
    expect(active).toHaveLength(3);
    for (const b of active.filter((b) => b !== held)) {
      expect(b.stuck).toBe(false);
      expect(b.dy).toBeGreaterThan(0);
    }
  });

  it('Q4: an icicle shove moves the paddle even while the pointer holds still', () => {
    const world = new World(CLASSIC);
    world.newGame(1);
    world.paddle.x = world.paddle.px = 0;
    world.paddle.tilt = 1;
    world.paddle.slide = -ICICLE.push;
    // The cursor rests at 0; like Game.tick, carry the paddle's movement during a push into a pointer offset.
    let offset = 0;
    for (let t = 0; t < ICICLE.tiltTime + 1.5; t += SIM.step) {
      const x = world.paddle.x;
      const slide = world.paddle.slide;
      world.step(SIM.step, { targetX: 0 + offset, axis: 0, action: false });
      if (world.paddle.slide !== slide) offset += world.paddle.x - x;
    }
    expect(world.paddle.x).toBeCloseTo(-ICICLE.push, 1);
    expect(world.paddle.slide).toBe(0);
  });

  it('Q5: a ball that escapes a drawn ball area is lost instead of flying off forever', () => {
    const campaign = classicCampaign({
      space: {
        ball: {
          radius: 0,
          drainEdge: 3,
          points: [
            { x: -10, y: -5 },
            { x: -10, y: 8 },
            { x: 10, y: 8 },
            { x: 10, y: -5 },
          ],
        },
      },
    });
    const world = new World(campaign);
    world.newGame(1);
    world.phase = 'live';
    world.lives = 3;
    const ball = world.balls.items.find((b) => b.active)!;
    // Outside the area's walls, travelling away from it (as if it had slipped through a joint).
    Object.assign(ball, { stuck: false, x: 13, px: 13, y: 2, py: 2, dx: 0.6, dy: 0.8 });
    let lost = 0;
    world.events.on('ballLost', () => lost++);
    for (let i = 0; i < 10; i++) world.step(SIM.step, idle);
    expect(lost).toBe(1);
    expect(world.lives).toBe(2);
    expect(Math.abs(ball.x)).toBeLessThan(10 + BALL.radius * 8);
  });

  it('P2: the paddle lane is recomputed when the paddle changes width, and only then', () => {
    const world = new World(CLASSIC);
    world.newGame(1);
    const lane = world as unknown as { currentPaddleSpans(): unknown };
    const narrow = lane.currentPaddleSpans();
    expect(lane.currentPaddleSpans()).toBe(narrow); // same width: the cached spans
    const right = { targetX: 100, axis: 0, action: false };
    for (let i = 0; i < 240; i++) world.step(SIM.step, right);
    expect(world.paddle.x + world.paddle.width / 2).toBeCloseTo(14, 3); // reaches the lane's end
    // Expand: the wider paddle still stops at the lane's end, so the spans followed the width.
    world.powerUps.collect(PowerUpKind.Expand, 0, 0);
    for (let i = 0; i < 1200; i++) world.step(SIM.step, right);
    expect(world.paddle.width).toBeCloseTo(PADDLE.expandedWidth, 6);
    expect(lane.currentPaddleSpans()).not.toBe(narrow);
    expect(world.paddle.x + world.paddle.width / 2).toBeCloseTo(14, 3);
  });

  it("P3: a scarab nest's routes are worked out once, not every step", () => {
    const sys = new ScarabSystem(new Random(1), new EventBus<GameEvents>());
    const def = {
      kind: 'scarabs' as const,
      x: -10,
      y: -6,
      path: [
        { x: -8, y: -4 },
        { x: -6, y: -9 },
      ],
    };
    sys.load([def], 0, { left: -14, right: 14, top: 10, bottom: -10 });
    const nest = sys.nests[0];
    expect(nest.route).toEqual(ScarabSystem.route(def));
    expect(ScarabSystem.foot(nest)).toEqual({ x: -10, y: -6, facing: 1 });
  });

  it("S8: flying scarabs stay inside the world's drawn ball area, not the template arena", () => {
    const sys = new ScarabSystem(new Random(1), new EventBus<GameEvents>());
    sys.load([], 0, { left: -9, right: 6, top: 10, bottom: -10 });
    const inField = (x: number): number => (sys as unknown as { inField(x: number): number }).inField(x);
    expect(inField(100)).toBeCloseTo(6 - SCARAB.radius, 9);
    expect(inField(-100)).toBeCloseTo(-9 + SCARAB.radius, 9);
    expect(inField(1)).toBe(1);
  });

  it("S8: brick debris rests on the paddle lane's floor", () => {
    const lane = classicCampaign({
      space: {
        paddle: {
          radius: 0,
          points: [
            { x: -14, y: -7 },
            { x: 14, y: -7 },
            { x: 14, y: -5 },
            { x: -14, y: -5 },
          ],
        },
      },
    });
    const world = new World(lane);
    world.newGame(1);
    // GameView passes this to DebrisSystem.update and uses it for the lost-ball burst.
    expect(world.shieldY).toBeCloseTo(world.paddle.y - PADDLE.halfH, 9);
    expect(world.shieldY).toBeGreaterThan(-7);
  });
});
