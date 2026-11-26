import { describe, expect, it } from 'vitest';
import frozen from '../public/worlds/Frozen-Sanctuary.json';
import { BALL, GRID, ICICLE, PADDLE, SIM } from '../src/gameplay/config';
import { validateWorld } from '../src/content/authoredWorlds';
import { EventBus } from '../src/engine/core/EventBus';
import { Random } from '../src/engine/core/Random';
import type { GameEvents } from '../src/gameplay/events';
import {
  icicleAreaIcicles,
  validateHazards,
  worldIcicles,
  type HazardDef,
  type IcicleAreaDef,
} from '../src/gameplay/hazards/hazards';
import { IcicleSystem } from '../src/gameplay/hazards/icicles/icicles';
import type { Ball, Paddle } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';
import { classicCampaign } from './support/worlds';

const CEILING: HazardDef[] = [
  { kind: 'icicle', x: -6, y: 8.75, length: 1.2 },
  { kind: 'icicle', x: 0, y: 8.75, length: 1.2 },
  { kind: 'icicle', x: 6, y: 8.75, length: 1.2 },
];

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

function ballAt(x: number, y: number): Ball {
  return { active: true, x, y, px: x, py: y, dx: 0, dy: 1, stuck: false, stuckOffset: 0, stuckTime: 0 } as Ball;
}

function setup(): {
  sys: IcicleSystem;
  log: { warn: number[]; struck: number[]; shatter: { x: number; byBall: boolean }[] };
} {
  const events = new EventBus<GameEvents>();
  const log = { warn: [] as number[], struck: [] as number[], shatter: [] as { x: number; byBall: boolean }[] };
  events.on('icicleWarn', ({ x }) => log.warn.push(x));
  events.on('paddleStruck', ({ x }) => log.struck.push(x));
  events.on('icicleShatter', ({ x, byBall }) => log.shatter.push({ x, byBall }));
  const sys = new IcicleSystem(new Random(3), events);
  sys.load(CEILING, 0);
  return { sys, log };
}

/** Runs the system; `move` can steer the paddle each step. Returns points scored. */
function run(
  sys: IcicleSystem,
  paddle: Paddle,
  seconds: number,
  balls: Ball[] = [],
  move?: (p: Paddle) => void,
): number {
  let points = 0;
  for (let t = 0; t < seconds; t += SIM.step) {
    move?.(paddle);
    points += sys.update(SIM.step, paddle, balls, true);
  }
  return points;
}

/** Seconds until the first drop can happen at the latest on a world's first level. */
const FIRST = ICICLE.firstDelay + ICICLE.waitMax[0];
/** Long enough for any warning and fall from the ceiling to the floor. */
const DROP = ICICLE.warn[0] + 1.5;

describe('falling icicles', () => {
  it('drops the icicle nearest the paddle and strikes a paddle that stays under it', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(5.5);
    run(sys, paddle, FIRST);
    expect(log.warn).toEqual([6]);
    run(sys, paddle, DROP);
    expect(log.struck).toEqual([6]);
    expect(paddle.tilt).not.toBe(0);
    // It broke off and grows back from the ceiling.
    const fallen = sys.items.find((c) => c.def.x === 6)!;
    expect(fallen.state).toBe('regrow');
  });

  it('misses a paddle that moves away during the warning, and smashes on the floor', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(0);
    run(sys, paddle, FIRST);
    expect(log.warn).toEqual([0]);
    run(sys, paddle, DROP, [], (p) => {
      p.x = -11;
    });
    expect(log.struck).toHaveLength(0);
    expect(log.shatter).toContainEqual({ x: 0, byBall: false });
    expect(paddle.tilt).toBe(0);
    expect(paddle.slide).toBe(0);
  });

  it('only drops icicles over or near the paddle', () => {
    const { sys, log } = setup();
    // Far to the side, beyond every icicle's aim range.
    run(sys, paddleAt(13), FIRST + 10);
    expect(log.warn).toHaveLength(0);
  });

  it('is knocked loose by the ball while attached, without breaking or scoring', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(-11);
    const tip = 8.75 - 1.2;
    const ball = ballAt(0.1, tip - BALL.radius + 0.05);
    const target = sys.items[1];
    expect(run(sys, paddle, SIM.step, [ball])).toBe(0);
    expect(log.shatter).toHaveLength(0);
    expect(target.state).toBe('falling');
    // The ball that knocked it is still touching it: no instant shatter.
    expect(run(sys, paddle, SIM.step, [ball])).toBe(0);
    expect(target.state).toBe('falling');
    // It falls, misses the paddle (far away), smashes on the floor and grows back.
    run(sys, paddle, DROP);
    expect(log.shatter).toContainEqual({ x: 0, byBall: false });
    run(sys, paddle, ICICLE.regrow[0] + 0.1);
    expect(target.state).toBe('hanging');
    expect(target.growth).toBe(1);
  });

  it('shatters and scores when the ball hits it in mid-air', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(-11);
    const tip = 8.75 - 1.2;
    const target = sys.items[1];
    run(sys, paddle, SIM.step, [ballAt(0.1, tip - BALL.radius + 0.05)]);
    expect(target.state).toBe('falling');
    // The ball moves away, then meets it again lower down.
    run(sys, paddle, 0.2, [ballAt(5, 0)]);
    const mid = (8.75 - target.drop + IcicleSystem.tipY(target)) / 2;
    expect(run(sys, paddle, SIM.step, [ballAt(0, mid)])).toBe(ICICLE.score);
    expect(log.shatter).toEqual([{ x: 0, byBall: true }]);
    expect(target.state).toBe('regrow');
    // A ball just clear of the next icicle does nothing.
    expect(run(sys, paddle, SIM.step, [ballAt(-6, tip - BALL.radius - ICICLE.radius - 0.1)])).toBe(0);
    expect(sys.items[0].state).toBe('hanging');
  });

  it('tips the paddle down on the side it hits and shoves it the other way', () => {
    const { sys } = setup();
    // The icicle at x = 6 lands right of the paddle's centre.
    const paddle = paddleAt(5.2);
    run(sys, paddle, FIRST + DROP);
    expect(paddle.tilt).toBeGreaterThan(0);
    expect(paddle.slide).toBeLessThan(0);
  });

  it('never runs its timers or hits anything while the ball is not in play', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(0);
    for (let t = 0; t < FIRST + 5; t += SIM.step) sys.update(SIM.step, paddle, [ballAt(0, 7.5)], false);
    expect(log.warn).toHaveLength(0);
    expect(log.shatter).toHaveLength(0);
  });
});

describe('icicles in a world', () => {
  it('grows nine icicles along the Frozen Sanctuary lintel, clear of the brick rows', () => {
    const data = validateWorld(frozen);
    const icicles = worldIcicles(data.hazards);
    expect(icicles).toHaveLength(9);
    // Every level keeps its top two rows empty, so a hanging icicle never overlaps a brick.
    const grid = GRID;
    const thirdRowTop = grid.topY - 2 * grid.cellH + grid.halfH;
    for (const h of icicles) expect(h.y - h.length).toBeGreaterThan(thirdRowTop);
    for (const level of data.levels) expect(level.rows[0] + level.rows[1]).toMatch(/^\.+$/);
  });

  it('spreads the icicles of an area along its line, the same way every time', () => {
    const area: IcicleAreaDef = {
      kind: 'icicles',
      points: [
        { x: -10, y: 9 },
        { x: 0, y: 9.4 },
        { x: 10, y: 9 },
      ],
      count: 6,
      minLength: 1,
      maxLength: 1.6,
      seed: 4,
    };
    const icicles = icicleAreaIcicles(area);
    expect(icicles).toHaveLength(6);
    const xs = icicles.map((c) => c.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBeGreaterThan(-10);
    expect(xs[5]).toBeLessThan(10);
    for (const c of icicles) {
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c.length).toBeLessThanOrEqual(1.6);
      // On the line: highest in the middle of the arch.
      expect(c.y).toBeCloseTo(9 + 0.4 * (1 - Math.abs(c.x) / 10), 5);
    }
    expect(icicleAreaIcicles({ ...area })).toEqual(icicles);
    expect(icicleAreaIcicles({ ...area, seed: 5 })).not.toEqual(icicles);
    // Pinned positions move the icicles along the line but keep their lengths.
    const pinned = icicleAreaIcicles({ ...area, positions: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    expect(pinned.map((c) => c.length)).toEqual(icicles.map((c) => c.length));
    expect(pinned[0].x).toBeCloseTo(-10, 5);
    expect(pinned[3].x).toBeCloseTo(0, 5);
    expect(pinned[3].y).toBeCloseTo(9.4, 5);
    expect(pinned[5].x).toBeCloseTo(10, 5);
    // A world loads both placed icicles and areas.
    const sys = new IcicleSystem(new Random(1), new EventBus<GameEvents>());
    sys.load([...CEILING, area], 0);
    expect(sys.items).toHaveLength(9);
  });

  it('rejects malformed icicle areas', () => {
    const area = {
      kind: 'icicles',
      points: [
        { x: -5, y: 9 },
        { x: 5, y: 9 },
      ],
      count: 4,
      minLength: 1,
      maxLength: 1.5,
      seed: 1,
    };
    expect(validateHazards([area])).toHaveLength(1);
    expect(() => validateHazards([{ ...area, points: [{ x: 0, y: 9 }] }])).toThrow('2-8 points');
    expect(() => validateHazards([{ ...area, count: 0 }])).toThrow('1-16 icicles');
    expect(() => validateHazards([{ ...area, maxLength: 9 }])).toThrow('invalid maxLength');
    expect(validateHazards([{ ...area, positions: [0, 0.2, 0.5, 1] }])).toHaveLength(1);
    expect(() => validateHazards([{ ...area, positions: [0.1, 0.2] }])).toThrow('one number from 0 to 1 per icicle');
    expect(() => validateHazards([{ ...area, positions: [0, 0.2, 0.5, 1.2] }])).toThrow(
      'one number from 0 to 1 per icicle',
    );
  });

  it('rejects malformed icicles', () => {
    expect(() => validateHazards([{ kind: 'icicle', x: 0, y: 8, length: 0 }])).toThrow('invalid length');
    expect(() => validateHazards([{ kind: 'icicle', x: 0, y: 'top', length: 1 }])).toThrow('invalid y');
  });

  it('pushes a struck paddle along and levels it out again', () => {
    const world = new World(classicCampaign({ space: { hazards: CEILING } }));
    world.newGame(1);
    world.paddle.x = world.paddle.px = 0;
    world.paddle.tilt = 1;
    world.paddle.slide = -ICICLE.push;
    const idle = { targetX: null, axis: 0, action: false };
    // Wobbles in place for a moment first, at full speed (no slowdown)...
    for (let t = 0; t < ICICLE.pushDelay * 0.5; t += SIM.step) world.step(SIM.step, idle);
    expect(world.paddle.x).toBe(0);
    // ...then is pushed away from the struck side.
    for (let t = 0; t < ICICLE.tiltTime + 1.5; t += SIM.step) world.step(SIM.step, idle);
    expect(world.paddle.x).toBeCloseTo(-ICICLE.push, 1);
    expect(world.paddle.slide).toBe(0);
    expect(world.paddle.tilt).toBe(0);
  });
});
