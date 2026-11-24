import { describe, expect, it } from 'vitest';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { PADDLE, SCARAB, SIM } from '../src/gameplay/config';
import { validateWorld } from '../src/content/authoredWorlds';
import { EventBus } from '../src/engine/core/EventBus';
import { Random } from '../src/engine/core/Random';
import type { GameEvents } from '../src/gameplay/events';
import { SCARAB_PATH_POINTS, validateHazards, type ScarabNestDef } from '../src/gameplay/hazards/hazards';
import { rideLimit, ScarabSystem, type Scarab } from '../src/gameplay/hazards/scarabs/scarabs';
import type { Ball, Paddle } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';

const LEFT: ScarabNestDef = { kind: 'scarabs', x: -16, y: -9.2 };
const RIGHT: ScarabNestDef = { kind: 'scarabs', x: 16, y: -9.2 };

function paddleAt(x: number): Paddle {
  return { x, px: x, y: PADDLE.y, width: PADDLE.width, vx: 0, stun: 0, shove: 0, tilt: 0, slide: 0, lean: 0, hitTime: -10 };
}

function ball(x: number, y: number): Ball {
  return { active: true, x, y, px: x, py: y, dx: 0, dy: 1, stuck: false, stuckOffset: 0, stuckTime: 0 } as Ball;
}

function setup(defs: ScarabNestDef[] = [LEFT], difficulty = 0) {
  const events = new EventBus<GameEvents>();
  const log: string[] = [];
  for (const name of ['scarabWarn', 'scarabEmerge', 'scarabCling', 'scarabCrushed', 'scarabScared', 'scarabLeap', 'scarabLand', 'scarabBump', 'scarabSwatted'] as const) events.on(name, () => log.push(name));
  const sys = new ScarabSystem(new Random(5), events);
  sys.load(defs, difficulty);
  return { sys, log };
}

function run(sys: ScarabSystem, paddle: Paddle, seconds: number, balls: Ball[] = [], live = true): number {
  let points = 0;
  for (let t = 0; t < seconds; t += SIM.step) points += sys.update(SIM.step, paddle, balls, live);
  return points;
}

/** Starts a storm straight away (its gate grinding: the first nest stirs). */
function stir(sys: ScarabSystem, paddle: Paddle): void {
  (sys as unknown as { untilStorm: number }).untilStorm = 0;
  sys.update(SIM.step, paddle, [], true);
  expect(sys.nests[0].state).toBe('warn');
}

describe('scarab nests', () => {
  it('loads the tomb world with its scarab nests', () => {
    expect(() => validateWorld(tomb)).not.toThrow();
    const nests = (tomb as { hazards: unknown[] }).hazards;
    expect(validateHazards(nests).filter((h) => h.kind === 'scarabs').length).toBeGreaterThan(0);
  });

  it('takes a nest as a spawn point off centre, and rejects one in the centre', () => {
    expect(validateHazards([LEFT])).toEqual([LEFT]);
    expect(() => validateHazards([{ ...LEFT, x: 0 }])).toThrow(/left or right/);
    // An older file's cover rectangle is ignored.
    expect(validateHazards([{ ...LEFT, cover: { x0: -22, y0: -10.6, x1: -13.6, y1: 7 } }])).toEqual([LEFT]);
  });

  it('only counts down while the ball is in play', () => {
    const { sys } = setup();
    const before = sys.nests[0].timer;
    run(sys, paddleAt(0), 20, [], false);
    expect(sys.nests[0].timer).toBe(before);
    expect(sys.activeCount).toBe(0);
  });

  it('lets out a swarm after the warning, from its entry point', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(8);
    stir(sys, paddle);
    run(sys, paddle, SCARAB.grind + 0.05);
    const first = sys.items.find((s) => s.active)!;
    expect(first.x).toBeCloseTo(LEFT.x, 0);
    run(sys, paddle, SCARAB.stagger * (SCARAB.swarm[0] - 1));
    expect(log.filter((e) => e === 'scarabEmerge')).toHaveLength(SCARAB.swarm[0]);
    // ...then crawls out towards the paddle.
    run(sys, paddle, 1.5);
    expect(first.x).toBeGreaterThan(LEFT.x + 2);
  });

  it('gets onto a paddle that waits for it, and their weight tips it', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(-8);
    stir(sys, paddle);
    run(sys, paddle, 8);
    expect(log).toContain('scarabCling');
    expect(sys.clinging).toBe(SCARAB.swarm[0]);
    expect(Math.abs(paddle.lean)).toBeGreaterThan(0.05);
    // Clinging ones ride along with the paddle.
    paddle.x = -5;
    run(sys, paddle, SIM.step);
    for (const s of sys.items) if (s.active && s.state === 'cling') expect(Math.abs(s.x - paddle.x)).toBeLessThanOrEqual(paddle.width / 2);
  });

  it('never has more clinging than the cap', () => {
    const { sys } = setup([LEFT, RIGHT], 1);
    const paddle = paddleAt(0);
    for (let t = 0; t < 120; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      expect(sys.clinging).toBeLessThanOrEqual(SCARAB.maxClinging);
      expect(sys.activeCount).toBeLessThanOrEqual(SCARAB.maxActive);
    }
  });

  it('never gives up: a scarab kept out of reach is still hunting long after', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(0);
    stir(sys, paddle);
    // Keep the paddle well out of leaping range, moving away as they come.
    for (let t = 0; t < 30; t += SIM.step) {
      const nearest = Math.max(...sys.items.filter((s) => s.active).map((s) => s.x), -99);
      paddle.x = Math.max(paddle.x, nearest + PADDLE.width / 2 + SCARAB.flyReach[1] + 4);
      sys.update(SIM.step, paddle, [], true);
    }
    // Every scarab that came out is still about (more swarms keep coming, up to the cap).
    expect(sys.activeCount).toBe(log.filter((e) => e === 'scarabEmerge').length);
    expect(sys.activeCount).toBeGreaterThanOrEqual(SCARAB.swarm[0]);
    expect(sys.clinging).toBe(0);
  });

  it('brought too close on the floor, springs up onto the paddle rather than being run into', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(6);
    const s = Object.assign(sys.items[0], { active: true, state: 'crawl', x: 0, y: paddle.y - PADDLE.halfH, rest: 99, leapAt: 0, speed: SCARAB.speed[0] });
    // The paddle sweeps in at it.
    let sprang = false;
    for (let t = 0; t < 2 && s.state !== 'cling'; t += SIM.step) {
      paddle.vx = -6;
      paddle.x += paddle.vx * SIM.step;
      sys.update(SIM.step, paddle, [], true);
      if (s.state === 'hop') sprang = true;
      if (s.state === 'crawl' || s.state === 'wait') expect(Math.abs(s.x - paddle.x)).toBeGreaterThanOrEqual(paddle.width / 2 + SCARAB.radius * 1.2 - 1e-6);
    }
    expect(sprang).toBe(true);
    expect(log).toContain('scarabLeap');
    expect(s.state).toBe('cling');
  });

  it('with no room on the paddle (and still gathering itself), waits nearby, and gets out of the way (running or leaping) when it comes', () => {
    const { sys } = setup();
    const paddle = paddleAt(6);
    // A full paddle.
    for (let i = 0; i < SCARAB.maxClinging; i++) Object.assign(sys.items[i], { active: true, state: 'cling', offset: -0.5 + i * 0.5, x: paddle.x, y: paddle.y });
    const s = Object.assign(sys.items[SCARAB.maxClinging], { active: true, state: 'crawl', x: -4, y: paddle.y - PADDLE.halfH, rest: 100, leapAt: 2, speed: SCARAB.speed[0] });
    run(sys, paddle, 3);
    expect(s.state).toBe('wait');
    const states = new Set<string>();
    for (let t = 0; t < 3; t += SIM.step) {
      paddle.vx = -8;
      paddle.x = Math.max(-12, paddle.x + paddle.vx * SIM.step);
      sys.update(SIM.step, paddle, [], true);
      states.add(s.state);
    }
    expect(states.has('flee') || states.has('hop')).toBe(true);
    expect(s.active).toBe(true);
    expect(s.state).not.toBe('cling');
  });

  it('whatever the paddle does: never run into on the floor, only ever gets on from the air, only dies crushed', () => {
    const { sys } = setup([LEFT, RIGHT], 1);
    const paddle = paddleAt(0);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let target = 0;
    const last = new Map<Scarab, string>();
    for (let t = 0; t < 90; t += SIM.step) {
      // Wild paddle: darting to random spots at up to full pointer speed, sometimes sitting still.
      if (rand() < 0.02) target = (rand() * 2 - 1) * 12;
      const speed = rand() < 0.5 ? PADDLE.pointerSpeed : 10;
      const move = Math.max(-speed * SIM.step, Math.min(speed * SIM.step, target - paddle.x));
      paddle.vx = move / SIM.step;
      paddle.x += move;
      // Crush one now and then, so places come free.
      if (rand() < 0.01) {
        const rider = sys.items.find((s) => s.active && s.state === 'cling');
        if (rider) sys.crush(rider.x);
      }
      const before = sys.items.map((s) => ({ s, active: s.active, state: s.state }));
      sys.update(SIM.step, paddle, [], true);
      for (const { s, active, state } of before) {
        if (active && !s.active) expect(state).toBe('crushed');
        if (s.active && s.state === 'cling' && state !== 'cling' && active) expect(['hop', 'fly']).toContain(state);
        if (s.active && (s.state === 'crawl' || s.state === 'wait' || s.state === 'flee' || s.state === 'crouch' || s.state === 'land')) {
          expect(Math.abs(s.x - paddle.x) - paddle.width / 2 - SCARAB.radius * 1.2).toBeGreaterThanOrEqual(-1e-6);
        }
        last.set(s, s.state);
      }
    }
  });

  it('hops or flies up onto the paddle from a distance, rather than walking all the way', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(-6);
    const leaps: { x: number; fly: boolean }[] = [];
    const events = (sys as unknown as { events: EventBus<GameEvents> }).events;
    events.on('scarabLeap', ({ x, fly }) => leaps.push({ x, fly }));
    stir(sys, paddle);
    run(sys, paddle, 8);
    expect(leaps.length).toBeGreaterThan(0);
    // Each took off short of the paddle's end, from up to its leaping range away.
    for (const l of leaps) {
      const reach = Math.abs(l.x - paddle.x) - paddle.width / 2;
      expect(reach).toBeGreaterThan(SCARAB.radius - 0.01);
      expect(reach).toBeLessThanOrEqual(SCARAB.flyReach[1] + 0.01);
    }
    expect(log).toContain('scarabCling');
  });

  it('one that misses lands on the floor, turns round and tries again', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(-6);
    stir(sys, paddle);
    let jumper: Scarab | undefined;
    for (let t = 0; t < 8 && !jumper; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      jumper = sys.items.find((s) => s.active && (s.state === 'hop' || s.state === 'fly'));
    }
    expect(jumper).toBeDefined();
    const s = jumper!;
    // The paddle darts off behind it while it is in the air: it comes down on the empty floor.
    const heading = Math.sign(paddle.x - s.x);
    paddle.x = s.x - heading * 12;
    for (let t = 0; t < 4 && s.state !== 'land'; t += SIM.step) sys.update(SIM.step, paddle, [], true);
    expect(s.state).toBe('land');
    expect(log).toContain('scarabLand');
    // With the paddle now behind it, it turns round...
    for (let t = 0; t < 2 && s.state !== 'crawl'; t += SIM.step) sys.update(SIM.step, paddle, [], true);
    sys.update(SIM.step, paddle, [], true);
    expect(s.facing).toBe(paddle.x > s.x ? 1 : -1);
    // ...and going for it again.
    let again = false;
    for (let t = 0; t < 6 && !again; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      again = s.state === 'crouch' || s.state === 'hop' || s.state === 'fly' || s.state === 'cling';
    }
    expect(again).toBe(true);
  });

  it('a flyer steers after a slowly moving paddle, but a quick one dodges it', () => {
    const chase = (speed: number) => {
      const { sys } = setup();
      const paddle = paddleAt(-6);
      stir(sys, paddle);
      let flyer: Scarab | undefined;
      for (let t = 0; t < 30 && !flyer; t += SIM.step) {
        sys.update(SIM.step, paddle, [], true);
        flyer = sys.items.find((s) => s.active && s.state === 'fly');
        // Hop attempts are not wanted here: shoo hoppers away by moving the paddle off and back.
        for (const s of sys.items) if (s.active && s.state === 'crouch' && s.mode === 'hop') s.mode = 'fly';
      }
      expect(flyer).toBeDefined();
      flyer!.aim = 0;
      const dir = Math.sign(paddle.x - flyer!.x);
      for (let t = 0; t < 3 && flyer!.state === 'fly'; t += SIM.step) {
        paddle.vx = dir * speed;
        paddle.x += paddle.vx * SIM.step;
        sys.update(SIM.step, paddle, [], true);
      }
      return flyer!.state;
    };
    expect(chase(1)).toBe('cling');
    expect(chase(14)).not.toBe('cling');
  });

  it('swinging the paddle about does not shake them off', () => {
    const { sys } = setup();
    const paddle = paddleAt(-8);
    stir(sys, paddle);
    run(sys, paddle, 8);
    const before = sys.clinging;
    expect(before).toBeGreaterThan(1);
    for (const vx of [30, -30, 30, -30, 30, -30]) {
      paddle.vx = vx;
      sys.update(SIM.step, paddle, [], true);
    }
    expect(sys.clinging).toBe(before);
  });

  it('a return crushes a scarab only if the ball comes down on it, and the paddle levels once they are gone', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(0);
    const half = paddle.width / 2;
    // Two riders, one well out on each end.
    const [left, right] = [-0.8, 0.8].map((offset, i) =>
      Object.assign(sys.items[i], { active: true, state: 'cling', offset, x: offset * half, y: paddle.y + PADDLE.halfH }),
    );
    // A return off the bare middle touches neither.
    sys.crush(0);
    expect(sys.clinging).toBe(2);
    expect(log).not.toContain('scarabCrushed');
    // Just out of reach of the left one: still nothing.
    sys.crush(left.x + SCARAB.crushReach + 0.05);
    expect(sys.clinging).toBe(2);
    // Coming down on it: crushed (only that one).
    sys.crush(left.x + 0.4);
    expect(left.state).toBe('crushed');
    expect(right.state).toBe('cling');
    expect(log.filter((e) => e === 'scarabCrushed')).toHaveLength(1);
    // It lies squashed for a moment, then is gone.
    run(sys, paddle, SCARAB.crushed + SIM.step);
    expect(left.active).toBe(false);
    sys.crush(right.x - 0.3);
    expect(sys.clinging).toBe(0);
    run(sys, paddle, 1.5);
    expect(paddle.lean).toBeCloseTo(0, 2);
  });

  it('a return between two close scarabs crushes the nearer one', () => {
    const { sys } = setup();
    const paddle = paddleAt(0);
    const [a, b] = [0.2, 0.6].map((offset, i) => Object.assign(sys.items[i], { active: true, state: 'cling', offset, x: offset * 2.1, y: paddle.y }));
    sys.crush(1.1);
    expect(b.state).toBe('crushed');
    expect(a.state).toBe('cling');
  });

  it('rocks the paddle end to end with even one rider, quicker and wider on later levels', () => {
    const sys_hz = (difficulty: number) => SCARAB.teeterHz[0] + (SCARAB.teeterHz[1] - SCARAB.teeterHz[0]) * difficulty;
    const ride = (offsets: number[], difficulty = 0) => {
      const { sys } = setup([LEFT], difficulty);
      const paddle = paddleAt(0);
      offsets.forEach((offset, i) => Object.assign(sys.items[i], { active: true, state: 'cling', offset, x: offset * 2.1, y: paddle.y }));
      const leans: number[] = [];
      let flips = 0;
      for (let t = 0; t < 6; t += SIM.step) {
        const last = paddle.lean;
        sys.update(SIM.step, paddle, [], true);
        if (Math.sign(paddle.lean) !== Math.sign(last) && last !== 0) flips++;
        leans.push(paddle.lean);
      }
      // Lean a quarter of the way into the first rock.
      const first = leans[Math.round(0.25 / sys_hz(difficulty) / SIM.step)];
      return { min: Math.min(...leans), max: Math.max(...leans), flips, first };
    };
    // One rider: lurches towards its end first, then rocks right over the other way too.
    const one = ride([-0.4]);
    expect(one.first).toBeLessThan(-0.3);
    expect(one.min).toBeLessThan(-0.95);
    expect(one.max).toBeGreaterThan(0.5);
    expect(one.flips).toBeGreaterThanOrEqual(8);
    // Two riders: rocks quicker than one.
    const two = ride([-0.4, 0.4]);
    expect(two.min).toBeLessThan(-0.9);
    expect(two.max).toBeGreaterThan(0.9);
    expect(two.flips).toBeGreaterThan(one.flips);
    // A world's last level rocks quicker, still right over to both ends.
    const late = ride([-0.4], 1);
    expect(late.flips).toBeGreaterThan(one.flips * 1.5);
    expect(late.min).toBeLessThan(-0.95);
    expect(late.max).toBeGreaterThan(0.9);
  });

  it('with the paddle full, only the nearest on each side waits by it; the rest run off', () => {
    const { sys } = setup();
    const paddle = paddleAt(0);
    const floor = paddle.y - PADDLE.halfH;
    for (let i = 0; i < SCARAB.maxClinging; i++) Object.assign(sys.items[i], { active: true, state: 'cling', offset: 0, lane: i, x: paddle.x, y: paddle.y });
    // Three coming from the left, one from the right; resting, so none takes to the air yet.
    const crawler = (i: number, x: number) => Object.assign(sys.items[i], { active: true, state: 'crawl', nest: 0, x, y: floor, facing: x < 0 ? 1 : -1, speed: 4, rest: 100, mode: 'hop', leapAt: 0 });
    const [nearLeft, midLeft, farLeft, right] = [crawler(2, -6), crawler(3, -9), crawler(4, -12), crawler(5, 8)];
    run(sys, paddle, 4);
    const gap = (s: Scarab) => Math.abs(s.x - paddle.x) - paddle.width / 2 - SCARAB.radius * 1.2;
    // The nearest each side hang about right by the paddle...
    for (const s of [nearLeft, right]) {
      expect(ScarabSystem.grounded(s)).toBe(true);
      expect(gap(s)).toBeLessThan(SCARAB.holdOff + 0.1);
    }
    // ...the others have run off, out to the edge of the open floor.
    for (const s of [midLeft, farLeft]) expect(gap(s)).toBeGreaterThan(SCARAB.holdOff + 3);
    expect(midLeft.x).toBeLessThan(-9);
  });

  it('riders keep scuttling up and down the paddle, never hanging off an end', () => {
    const { sys } = setup();
    const paddle = paddleAt(0);
    const rider = Object.assign(sys.items[0], { active: true, state: 'cling', offset: 0, x: 0, y: paddle.y });
    const onTop = (r: Scarab) => Math.abs(r.x - paddle.x) + SCARAB.radius * 1.2 <= paddle.width / 2 + 1e-6;
    let lo = Infinity;
    let hi = -Infinity;
    let moving = 0;
    let steps = 0;
    for (let t = 0; t < 8; t += SIM.step) {
      paddle.x = 3 * Math.sin(t);
      sys.update(SIM.step, paddle, [], true);
      expect(onTop(rider)).toBe(true);
      lo = Math.min(lo, rider.offset);
      hi = Math.max(hi, rider.offset);
      if (Math.abs(rider.vx) > 0.5) moving++;
      steps++;
    }
    // It covers most of the paddle, and is on the move most of the time.
    expect(hi - lo).toBeGreaterThan(rideLimit(paddle) * 1.5);
    expect(moving / steps).toBeGreaterThan(0.5);
  });

  it('one that lands near an end scrambles on, and none is left hanging off when the paddle shrinks', () => {
    const { sys } = setup();
    const paddle = paddleAt(0);
    paddle.width = PADDLE.expandedWidth;
    const rider = Object.assign(sys.items[0], { active: true, state: 'cling', offset: 0.95, x: 0, y: paddle.y, pause: 5 });
    run(sys, paddle, 0.3);
    expect(Math.abs(rider.offset)).toBeLessThanOrEqual(rideLimit(paddle) + 1e-6);
    Object.assign(rider, { offset: rideLimit(paddle), goal: rideLimit(paddle), pause: 5 });
    paddle.width = PADDLE.width;
    run(sys, paddle, 0.3);
    expect(Math.abs(rider.x - paddle.x) + SCARAB.radius * 1.2).toBeLessThanOrEqual(paddle.width / 2 + 1e-6);
  });

  it('two riders take the front and back halves of the paddle, so they can pass without merging', () => {
    const { sys } = setup();
    const paddle = paddleAt(0);
    const top = paddle.y + PADDLE.halfH;
    const drop = (i: number, x: number) => Object.assign(sys.items[i], { active: true, state: 'hop', mode: 'hop', x, px: x, y: top + 0.5, py: top + 0.5, vx: 0, vy: -1 });
    const a = drop(0, -0.5);
    run(sys, paddle, 0.3);
    const b = drop(1, 0.5);
    run(sys, paddle, 0.3);
    expect(a.state).toBe('cling');
    expect(b.state).toBe('cling');
    expect(new Set([a.lane, b.lane])).toEqual(new Set([0, 1]));
  });

  it('leans no further than fully over, and levels out once they are all gone', () => {
    const { sys } = setup([LEFT, RIGHT], 1);
    const paddle = paddleAt(0);
    for (let t = 0; t < 60; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      expect(Math.abs(paddle.lean)).toBeLessThanOrEqual(1);
    }
    sys.reset();
    run(sys, paddle, 2, [], false);
    expect(paddle.lean).toBeCloseTo(0, 3);
  });

  it('the ball near where a nest stirs scares the swarm back and scores', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(0);
    stir(sys, paddle);
    const points = run(sys, paddle, SIM.step * 2, [ball(LEFT.x + 1, LEFT.y + 1)]);
    expect(points).toBe(SCARAB.scareScore);
    expect(sys.nests[0].state).toBe('scared');
    run(sys, paddle, SCARAB.grind + 1);
    expect(log).not.toContain('scarabEmerge');
  });

  it('a ball dropped straight down comes off a leaning paddle towards its low end, off the sloped top', () => {
    const drop = (lean: number, at: number) => {
      const world = new World();
      world.newGame(1);
      world.step(SIM.step, { targetX: null, axis: 0, action: true });
      const p = world.paddle;
      const b = world.balls.items.find((item) => item.active)!;
      b.stuck = false;
      b.x = b.px = p.x + at;
      b.y = b.py = p.y + 4;
      b.dx = 0;
      b.dy = -1;
      for (let i = 0; i < 200 && b.dy < 0; i++) {
        p.lean = lean;
        world.step(SIM.step, { targetX: null, axis: 0, action: false });
      }
      return { dx: b.dx, y: b.y - p.y };
    };
    expect(drop(0, 0).dx).toBeCloseTo(0, 5);
    expect(drop(1, 0).dx).toBeCloseTo(Math.sin(SCARAB.leanKick), 2);
    expect(drop(-1, 0).dx).toBeCloseTo(-Math.sin(SCARAB.leanKick), 2);
    // Leaning right (right end down), the raised left end meets the ball higher up than the lowered right end.
    expect(drop(1, -1.5).y).toBeGreaterThan(drop(1, 1.5).y + 0.5);
  });

  it('with the paddle full, those not next in line fly off and swirl about in the scene; the next in line gets the place', () => {
    const { sys } = setup();
    const paddle = paddleAt(2);
    const floor = paddle.y - PADDLE.halfH;
    for (let i = 0; i < SCARAB.maxClinging; i++) Object.assign(sys.items[i], { active: true, state: 'cling', offset: 0, lane: i, x: paddle.x, y: paddle.y });
    const [next, ...others] = [2, 3, 4].map((i) => Object.assign(sys.items[i], { active: true, state: 'crawl', nest: 0, x: -6 - (i - 2) * 3, y: floor, facing: 1, speed: 4, rest: 0, mode: 'hop', leapAt: 0 }));
    run(sys, paddle, 4);
    expect(ScarabSystem.grounded(next)).toBe(true);
    expect(others.every((s) => s.state === 'away')).toBe(true);
    // Swirling: always on the move, side to side and in and out of the distance, apart, above the paddle.
    const xs: number[] = [];
    const depths: number[] = [];
    for (let t = 0; t < 10; t += SIM.step) {
      const before = others.map((s) => ({ x: s.x, y: s.y, depth: s.depth }));
      sys.update(SIM.step, paddle, [], true);
      others.forEach((s, i) => {
        expect(s.state).toBe('away');
        expect(s.y).toBeGreaterThan(paddle.y + PADDLE.halfH);
        const moved = Math.hypot(s.x - before[i].x, s.y - before[i].y) + Math.abs(s.depth - before[i].depth) * 5;
        expect(moved / SIM.step).toBeGreaterThan(0.5);
        xs.push(s.x);
        depths.push(s.depth);
      });
      expect(Math.hypot(others[0].x - others[1].x, others[0].y - others[1].y) + Math.abs(others[0].depth - others[1].depth) * 10).toBeGreaterThan(SCARAB.radius);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(SCARAB.swirlRadius * 1.5);
    expect(Math.min(...depths)).toBeLessThan(SCARAB.swirlDepth[0] + 0.1);
    expect(Math.max(...depths)).toBeGreaterThan(SCARAB.swirlDepth[1] - 0.1);
    // A rider crushed: the one next in line on the floor takes the place; those swirling stay out there.
    sys.crush(sys.items[0].x);
    run(sys, paddle, 3);
    expect(sys.clinging).toBe(SCARAB.maxClinging);
    expect(next.state).toBe('cling');
    expect(others.every((s) => s.state === 'away' && !s.back)).toBe(true);
    // With nobody left on the floor, a place coming free calls one back out of the distance.
    sys.crush(sys.items[1].x);
    run(sys, paddle, 4);
    expect(sys.clinging).toBe(SCARAB.maxClinging);
    expect(others.filter((s) => s.state === 'cling')).toHaveLength(1);
  });

  it('a ball swats one still near the play out of the air, but cannot reach one far off', () => {
    const { sys, log } = setup();
    const paddle = paddleAt(0);
    const floor = paddle.y - PADDLE.halfH;
    for (let i = 0; i < SCARAB.maxClinging; i++) Object.assign(sys.items[i], { active: true, state: 'cling', offset: 0, lane: i, x: paddle.x, y: paddle.y });
    // One next in line by the paddle, so this one (further off) makes off into the air.
    Object.assign(sys.items[3], { active: true, state: 'wait', nest: 0, x: -4, y: floor, facing: 1, speed: 4, rest: 100, mode: 'hop', leapAt: 0 });
    const s = Object.assign(sys.items[2], { active: true, state: 'crawl', nest: 0, x: -9, y: floor, facing: 1, speed: 4, rest: 0, mode: 'hop', leapAt: 0 });
    let t = 0;
    for (; s.state !== 'away' && t < 3; t += SIM.step) sys.update(SIM.step, paddle, [], true);
    expect(s.state).toBe('away');
    // Taking off, still close: swatted down, and it soon flies off again.
    sys.update(SIM.step, paddle, [ball(s.x, s.y)], true);
    expect(log).toContain('scarabSwatted');
    expect(s.state).toBe('hop');
    run(sys, paddle, 1.5);
    expect(log).toContain('scarabLand');
    run(sys, paddle, 6);
    expect(s.state).toBe('away');
    expect(s.depth).toBeGreaterThan(0.3);
    // Out in the distance: the ball goes past it.
    sys.update(SIM.step, paddle, [ball(s.x, s.y)], true);
    expect(s.state).toBe('away');
  });

  it('scarabs only come with a storm: the gate grinds, then 2 come out (4 on the last level), shared between the nests', () => {
    const storm = (difficulty: number) => {
      const events = new EventBus<GameEvents>();
      const gates: number[] = [];
      events.on('tombGate', ({ duration }) => gates.push(duration));
      const sys = new ScarabSystem(new Random(9), events);
      sys.load([LEFT, RIGHT], difficulty);
      const paddle = paddleAt(0);
      // Nothing until the storm's wait (and the first level's extra delay) is up.
      run(sys, paddle, SCARAB.firstDelay + SCARAB.waitMin[0] * 0.5);
      if (difficulty === 0) expect(gates).toHaveLength(0);
      (sys as unknown as { untilStorm: number }).untilStorm = 0;
      sys.update(SIM.step, paddle, [], true);
      expect(gates).toEqual([SCARAB.grind]);
      expect(sys.activeCount).toBe(0);
      // While the gate grinds, nothing comes out; then they all do.
      run(sys, paddle, SCARAB.grind - 0.1);
      expect(sys.activeCount).toBe(0);
      run(sys, paddle, 0.2 + SCARAB.stagger * 3);
      const out = sys.items.filter((s) => s.active);
      expect(new Set(out.map((s) => s.nest)).size).toBe(2);
      return out.length;
    };
    expect(storm(0)).toBe(2);
    expect(storm(1)).toBe(4);
  });

  it('the next storm waits until the last one is over', () => {
    const { sys } = setup();
    const paddle = paddleAt(0);
    stir(sys, paddle);
    run(sys, paddle, SCARAB.grind + SCARAB.stagger * 2 + 0.1);
    expect(sys.nests[0].state).toBe('idle');
    const wait = (sys as unknown as { untilStorm: number }).untilStorm;
    expect(wait).toBeGreaterThanOrEqual(SCARAB.waitMin[0] - 1);
    expect(wait).toBeLessThanOrEqual(SCARAB.waitMax[0]);
  });

  it('landing on the paddle shoves it on the way the scarab was going, harder on later levels', () => {
    const land = (vx: number, difficulty: number) => {
      const { sys } = setup([LEFT], difficulty);
      const paddle = paddleAt(0);
      const top = paddle.y + PADDLE.halfH;
      Object.assign(sys.items[0], { active: true, state: 'hop', mode: 'hop', x: -vx * 0.05, px: -vx * 0.05, y: top + 0.3, py: top + 0.3, vx, vy: -2 });
      run(sys, paddle, 0.2);
      expect(sys.items[0].state).toBe('cling');
      return paddle.shove;
    };
    // Came from the left, heading right: pushed right; and the other way.
    expect(land(4, 0)).toBeCloseTo(SCARAB.landShove[0]);
    expect(land(-4, 0)).toBeCloseTo(-SCARAB.landShove[0]);
    expect(land(4, 1)).toBeCloseTo(SCARAB.landShove[1]);
  });

  it('a landing shove shows even with the paddle held under a finger', () => {
    const world = new World();
    world.newGame(1);
    world.paddle.x = world.paddle.px = 0;
    world.paddle.shove = SCARAB.landShove[0];
    const held = { targetX: 0, axis: 0, action: false };
    let furthest = 0;
    for (let t = 0; t < 0.15; t += SIM.step) {
      world.step(SIM.step, held);
      furthest = Math.max(furthest, world.paddle.x);
    }
    expect(furthest).toBeGreaterThan(SCARAB.landShove[0] * 0.8);
  });

  it('clears every scarab on reset', () => {
    const { sys } = setup();
    const paddle = paddleAt(-8);
    stir(sys, paddle);
    run(sys, paddle, 6);
    sys.reset();
    expect(sys.activeCount).toBe(0);
    expect(sys.nests.every((n) => n.state === 'idle')).toBe(true);
  });
});

describe('scarab entry paths', () => {
  const PATHED: ScarabNestDef = {
    kind: 'scarabs',
    x: LEFT.x,
    y: -8.95,
    path: [{ x: -13.9, y: -8.95 }, { x: -13.2, y: -8.95 }, { x: -12.4, y: -9.8 }],
  };
  const setupPathed = () => setup([PATHED]);

  it('accepts a path, and rejects malformed ones', () => {
    expect(validateHazards([PATHED])[0]).toEqual(PATHED);
    expect(() => validateHazards([{ ...PATHED, path: [] }])).toThrow(/path must be/);
    expect(() => validateHazards([{ ...PATHED, path: Array.from({ length: SCARAB_PATH_POINTS + 1 }, () => ({ x: -12, y: -9 })) }])).toThrow(/path must be/);
    expect(() => validateHazards([{ ...PATHED, path: [{ x: -12 }] }])).toThrow(/path point 1 y/);
  });

  it('a scarab walks in along the path in order, down to the floor at its end, then hunts', () => {
    const { sys } = setupPathed();
    const paddle = paddleAt(8);
    const floor = paddle.y - PADDLE.halfH;
    stir(sys, paddle);
    let s: Scarab | undefined;
    for (let t = 0; t < 4 && !s; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      s = sys.items.find((item) => item.active);
    }
    expect(s).toBeDefined();
    const scarab = s!;
    expect(scarab.state).toBe('emerge');
    expect(scarab.x).toBeCloseTo(PATHED.x, 0);
    // Passes close by each point in turn (the last one on the floor), facing the way it walks.
    const targets = PATHED.path!.map((p, i, all) => ({ x: p.x, y: i === all.length - 1 ? floor : p.y }));
    let next = 0;
    for (let t = 0; t < 4 && scarab.state === 'emerge'; t += SIM.step) {
      sys.update(SIM.step, paddle, [], true);
      if (next < targets.length && Math.hypot(scarab.x - targets[next].x, scarab.y - targets[next].y) < 0.15) next++;
      if (scarab.state === 'emerge') expect(scarab.facing).toBe(1);
    }
    expect(next).toBe(targets.length);
    expect(scarab.state).toBe('crawl');
    expect(scarab.y).toBe(floor);
    expect(scarab.x).toBeCloseTo(-12.4, 0);
    // From there it hunts the paddle as usual.
    run(sys, paddle, 3);
    expect(['crawl', 'crouch', 'hop', 'fly', 'cling', 'land']).toContain(scarab.state);
    expect(scarab.x).toBeGreaterThan(-12);
  });

  it('a stirring nest peeks out at its entry point, facing the way its path sets off', () => {
    expect(ScarabSystem.foot(setupPathed().sys.nests[0])).toEqual({ x: PATHED.x, y: PATHED.y, facing: 1 });
    const back = setup([{ ...PATHED, path: [{ x: -18, y: -8.95 }] }]).sys;
    expect(ScarabSystem.foot(back.nests[0]).facing).toBe(-1);
    // Without a path: the way its side of centre sends the swarm.
    expect(ScarabSystem.foot(setup([LEFT]).sys.nests[0])).toEqual({ x: LEFT.x, y: LEFT.y, facing: 1 });
  });

  it('runs the same as before for a nest without a path', () => {
    const { sys } = setup([LEFT]);
    const paddle = paddleAt(8);
    stir(sys, paddle);
    run(sys, paddle, SCARAB.grind + 0.05);
    const s = sys.items.find((item) => item.active)!;
    expect(s.state).toBe('emerge');
    run(sys, paddle, SCARAB.emerge + 0.05);
    expect(s.state).toBe('crawl');
  });
});
