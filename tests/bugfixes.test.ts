import { describe, expect, it } from 'vitest';
import { BUILTIN_CAMPAIGN } from '../src/content/campaign';
import { STAGES_PER_WORLD } from '../src/content/worlds';
import { BALL, ICICLE, SIM } from '../src/gameplay/config';
import { PowerUpKind } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';

const idle = { targetX: null, axis: 0, action: false };

// Regression tests for the bugs found in code review 001 (reviews/bobs-code-review-001.md).
describe('code review 001 fixes', () => {
  it('Q1: forgets trapped-ball history when balls are cleared (new game, level change, lost life)', () => {
    const world = new World();
    world.newGame(1, STAGES_PER_WORLD); // Forest: the outline boundary uses the trap guard
    const ball = world.balls.items.find((b) => b.active)!;
    const guard = world.ballPhysics.trapGuard;
    for (let i = 0; i < 3; i++) guard.onContact(ball, 50 + i * 0.01, 0, 0);
    world.newGame(2, STAGES_PER_WORLD);
    // Straight after a new game (time back at 0) a fresh contact must not count the old run's hits.
    const again = world.balls.items.find((b) => b.active)!;
    for (let i = 0; i < 3; i++) expect(guard.onContact(again, i * 0.01, 0, 0)).toBe(false);
  });

  it('Q3: Multiball splits a ball held by Magnet, launching the copies upwards', () => {
    const world = new World();
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
    const world = new World();
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
    const campaign = BUILTIN_CAMPAIGN.withExtrasAt(0, { playAreas: {
      ball: { radius: 0, drainEdge: 3, points: [{ x: -10, y: -5 }, { x: -10, y: 8 }, { x: 10, y: 8 }, { x: 10, y: -5 }] },
    } });
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
});
