import { describe, expect, it } from 'vitest';
import jungle from '../public/worlds/Jungle-Ruins-jungle-ruins.json';
import { BITE, PADDLE, SIM, SNAKE } from '../src/gameplay/config';
import { validateWorld } from '../src/content/authoredWorlds';
import { EventBus } from '../src/engine/core/EventBus';
import { Random } from '../src/engine/core/Random';
import type { GameEvents } from '../src/gameplay/events';
import { validateHazards, type HazardDef } from '../src/gameplay/hazards/hazards';
import { SnakeSystem } from '../src/gameplay/hazards/snakes/snakes';
import type { Paddle } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';
import { CLASSIC, classicCampaign } from './support/worlds';

const LEFT: HazardDef = { kind: 'snake', x: -14, y: -7.4, reach: 7 };

function paddleAt(x: number): Paddle {
  return {
    x,
    px: x,
    y: PADDLE.y,
    width: PADDLE.width,
    vx: 0,
    shove: 0,
    tilt: 0,
    slide: 0,
    lean: 0,
    hitTime: -10,
  };
}

/** A system with one snake that has just begun its warning, aimed at a paddle at `aimX`. */
function warned(aimX: number): { sys: SnakeSystem; paddle: Paddle; bites: number[] } {
  const events = new EventBus<GameEvents>();
  const bites: number[] = [];
  events.on('paddleBitten', ({ x }) => bites.push(x));
  const sys = new SnakeSystem(new Random(7), events);
  sys.load([LEFT], 0);
  const paddle = paddleAt(aimX);
  sys.items[0].timer = 0;
  sys.update(SIM.step, paddle, [], true);
  expect(sys.items[0].state).toBe('warn');
  return { sys, paddle, bites };
}

function run(sys: SnakeSystem, paddle: Paddle, seconds: number, live = true): void {
  for (let t = 0; t < seconds; t += SIM.step) sys.update(SIM.step, paddle, [], live);
}

describe('wall snakes', () => {
  it('bites a paddle that stays where it was aimed, once per strike, and shoves it towards the centre', () => {
    const { sys, paddle, bites } = warned(-9);
    run(sys, paddle, SNAKE.warn[0] + SNAKE.strike + SNAKE.hold + 0.05);
    expect(bites).toHaveLength(1);
    expect(paddle.shove).toBe(BITE.distance);
  });

  it('misses a paddle that moves away during the warning', () => {
    const { sys, paddle, bites } = warned(-9);
    paddle.x = 0;
    run(sys, paddle, SNAKE.warn[0] + SNAKE.strike + SNAKE.hold + SNAKE.retract + 0.1);
    expect(bites).toHaveLength(0);
    expect(paddle.shove).toBe(0);
    expect(sys.items[0].state).toBe('idle');
  });

  it('never reaches further than its reach', () => {
    const { sys, paddle } = warned(10);
    const h = sys.items[0];
    expect(Math.hypot(h.targetX - LEFT.x, h.targetY - LEFT.y)).toBeLessThanOrEqual(LEFT.reach + 1e-9);
    let furthest = 0;
    for (let t = 0; t < 2; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      furthest = Math.max(furthest, Math.hypot(h.headX - LEFT.x, h.headY - LEFT.y));
    }
    expect(furthest).toBeLessThanOrEqual(LEFT.reach + 1e-9);
  });

  it('only counts down while the ball is in play', () => {
    const sys = new SnakeSystem(new Random(1), new EventBus<GameEvents>());
    sys.load([LEFT], 0);
    const before = sys.items[0].timer;
    run(sys, paddleAt(-9), 5, false);
    expect(sys.items[0].timer).toBe(before);
    expect(sys.items[0].state).toBe('idle');
  });

  it('lets only one snake strike at a time', () => {
    const sys = new SnakeSystem(new Random(3), new EventBus<GameEvents>());
    sys.load([LEFT, { ...LEFT, x: 14 }], 1);
    const paddle = paddleAt(0);
    for (let t = 0; t < 60; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      expect(sys.items.filter((h) => h.state !== 'idle').length).toBeLessThanOrEqual(1);
    }
  });

  it('a bite pushes the paddle towards the centre, ignoring input, then returns control', () => {
    const world = new World(CLASSIC);
    world.newGame(1);
    world.paddle.x = world.paddle.px = -8;
    world.paddle.shove = BITE.distance;
    // Input pulling the other way is ignored while the shove plays out.
    let steps = 0;
    while (world.paddle.shove !== 0 && steps++ < 1000) world.step(SIM.step, { targetX: -12, axis: 0, action: false });
    expect(steps * SIM.step).toBeLessThan(0.45);
    expect(world.paddle.x).toBeCloseTo(-8 + BITE.distance, 9);
    world.step(SIM.step, { targetX: -12, axis: 0, action: false });
    expect(world.paddle.x).toBeLessThan(-8 + BITE.distance);
  });
});

describe('Jungle Ruins snakes', () => {
  it('ships with a snake on each side', () => {
    const data = validateWorld(jungle);
    expect(data.hazards).toHaveLength(2);
    expect(data.hazards!.map((h) => (h.kind === 'snake' ? Math.sign(h.x) : 0)).sort((a, b) => a - b)).toEqual([-1, 1]);
  });

  it('loads the world hazards into the simulation and clears them for worlds without any', () => {
    const world = new World(classicCampaign({ space: { hazards: validateHazards(jungle.hazards) } }));
    world.newGame(5, 0);
    expect(world.snakes.items).toHaveLength(2);
    world.loadLevel(10);
    expect(world.snakes.items).toHaveLength(0);
  });

  it('rejects malformed hazards', () => {
    expect(() => validateHazards([{ kind: 'dragon', x: 1, y: 1, reach: 3 }])).toThrow('unknown kind');
    expect(() => validateHazards([{ kind: 'snake', x: 1, y: 1, reach: 100 }])).toThrow('invalid reach');
    expect(() => validateWorld({ ...jungle, hazards: 'snakes' })).toThrow('Hazards must be a list');
    expect(() => validateHazards([{ ...LEFT, body: [] }])).toThrow('body must be');
    expect(() => validateHazards([{ ...LEFT, body: [{ x: 'a', y: 1 }] }])).toThrow('body must be');
  });

  it('keeps each Jungle snake draped over its own side of the arena', () => {
    for (const h of validateHazards(jungle.hazards)) {
      if (h.kind !== 'snake') continue;
      expect(h.body!.length).toBeGreaterThan(2);
      // The body runs from off to the side towards the den, so a lunge pulls it along the rocks.
      for (const p of h.body!) expect(Math.sign(p.x)).toBe(Math.sign(h.x));
      expect(Math.abs(h.body![0].x)).toBeGreaterThan(Math.abs(h.x) + h.reach);
    }
  });
});
