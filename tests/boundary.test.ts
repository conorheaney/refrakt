import { describe, expect, it } from 'vitest';
import { BALL, FIELD, SIM } from '../src/gameplay/config';
import { findPaddleLane } from '../src/gameplay/arena/playAreas';
import { STAGES_PER_WORLD } from '../src/content/worlds';
import { Contact, PolygonBoundary, TrapGuard } from '../src/gameplay/arena/boundary';
import type { SweepHit } from '../src/gameplay/arena/collision';
import { areaSegments, type BallArea } from '../src/gameplay/arena/playAreas';
import type { Ball } from '../src/gameplay/types';
import { World, type StepInput } from '../src/gameplay/World';
import { CLASSIC, FOREST_AREAS, FOREST_LEVEL, SHIPPED_CAMPAIGN, SPACE_AREAS } from './support/worlds';

const r = BALL.radius;

/** Distance from (x, y) to the nearest wall (drain excluded) of an area: computed independently of PolygonBoundary. */
function wallDistance(area: BallArea, x: number, y: number): number {
  let best = Infinity;
  for (const { a, b, drain } of areaSegments(area, area.drainEdge)) {
    if (drain) continue;
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(x - a.x - ex * u, y - a.y - ey * u));
  }
  return best;
}

/** Follows the lowest ball with the paddle and launches. */
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

describe("Verdant Hollow's ball area (the tree arch of its painting)", () => {
  it('encloses the play space, with its drain below the paddle', () => {
    const area = FOREST_AREAS.ball;
    const boundary = new PolygonBoundary(area);
    expect(area.points.length).toBeLessThanOrEqual(96);
    const lane = findPaddleLane(FOREST_AREAS.paddle, 6.3, 0.55);
    expect(boundary.bounds.bottom).toBeLessThan(lane.y - 0.55);
    for (const [x, y] of [
      [0, 0],
      [0, -8.2],
      [-11, 8.8],
      [11, 8.8],
      [0, 9.9],
    ]) {
      expect(boundary.contains(x, y)).toBe(true);
      expect(wallDistance(area, x, y)).toBeGreaterThan(r);
    }
    for (const [x, y] of [
      [-17, 0],
      [17, 0],
      [0, 14],
    ])
      expect(boundary.contains(x, y)).toBe(false);
  });
});

describe('polygon boundary', () => {
  for (const [name, area] of [
    ['Space arena', SPACE_AREAS.ball],
    ['Forest arch', FOREST_AREAS.ball],
  ] as const) {
    it(`stops a ball at any speed before it crosses a wall of the ${name} (no tunnelling)`, () => {
      const boundary = new PolygonBoundary(area);
      for (let k = 0; k < 360; k += 3) {
        const a = (k * Math.PI) / 180;
        const dx = Math.cos(a) * 200; // far more than a step at top speed
        const dy = Math.sin(a) * 200;
        const hit: SweepHit = { t: 0, nx: 0, ny: 0 };
        const contact = boundary.sweep(0, 0, dx, dy, r, hit);
        expect(contact).not.toBe(Contact.None);
        const x = hit.t * dx;
        const y = hit.t * dy;
        expect(hit.nx * dx + hit.ny * dy).toBeLessThan(0);
        if (contact === Contact.Wall) {
          // At the contact the ball touches a wall without overlapping it.
          expect(wallDistance(area, x, y)).toBeGreaterThan(r - 1e-6);
          expect(wallDistance(area, x, y)).toBeLessThan(r + 1e-3);
        } else {
          // Through the drain: its centre is on the drain line, going down.
          expect(dy).toBeLessThan(0);
          expect(boundary.belowDrain(x + dx * 1e-3, y + dy * 1e-3)).toBe(true);
        }
      }
    });
  }

  it('lets a ball through the drain only when asked (the barrier below a high drain)', () => {
    const boundary = new PolygonBoundary(SPACE_AREAS.ball);
    const hit: SweepHit = { t: 0, nx: 0, ny: 0 };
    expect(boundary.sweep(0, -8, 0, -10, r, hit)).toBe(Contact.Drain);
    expect(boundary.sweep(0, -8, 0, -10, r, hit, true)).toBe(Contact.None);
  });

  it('pushes a ball that slipped partly through a wall back inside', () => {
    const boundary = new PolygonBoundary(SPACE_AREAS.ball);
    const reflected: number[] = [];
    // Centre just beyond the right-hand wall at x = 14.
    const ball = { x: 14.1, y: 0, dx: 0.8, dy: 0.6 } as Ball;
    boundary.depenetrate(ball, r, (nx, ny) => reflected.push(nx, ny));
    expect(boundary.contains(ball.x, ball.y)).toBe(true);
    expect(wallDistance(SPACE_AREAS.ball, ball.x, ball.y)).toBeGreaterThanOrEqual(r);
    expect(reflected[0]).toBeLessThan(0); // pushed back towards the inside
    // A ball below the drain is on its way out: left alone.
    const leaving = { x: 0, y: FIELD.bottom - 0.2, dx: 0, dy: -1 } as Ball;
    boundary.depenetrate(leaving, r, () => {});
    expect(leaving.y).toBe(FIELD.bottom - 0.2);
  });

  it('frees a ball sent into the tightest corners of the Forest arch', () => {
    const targets = [
      [-14.5, -8.9],
      [14.5, -8.9],
      [-14.9, 9.5],
      [14.9, 9.5],
      [-12.5, -9.8],
      [12.5, -9.8],
    ];
    for (const [tx, ty] of targets) {
      for (const off of [-0.6, 0, 0.6]) {
        const world = new World(CLASSIC);
        world.newGame(7, FOREST_LEVEL);
        for (const brick of world.bricks) brick.alive = false;
        const ball = world.balls.items.find((b) => b.active) as Ball;
        ball.stuck = false;
        world.phase = 'live';
        ball.x = ball.px = 0;
        ball.y = ball.py = 0;
        const l = Math.hypot(tx, ty + off);
        ball.dx = tx / l;
        ball.dy = (ty + off) / l;
        const input: StepInput = { targetX: 30, axis: 0, action: false }; // paddle out of the way
        const seen = { lo: Infinity, hi: -Infinity };
        for (let i = 0; i < 120 * 6 && ball.active; i++) {
          world.step(SIM.step, input);
          if (i > 120 * 3) {
            seen.lo = Math.min(seen.lo, ball.y);
            seen.hi = Math.max(seen.hi, ball.y);
          }
          if (ball.active && !world.boundary.belowDrain(ball.x, ball.y))
            expect(wallDistance(FOREST_AREAS.ball, ball.x, ball.y)).toBeGreaterThan(r - 1e-3);
        }
        // Either it fell out through the drain (lost) or it is still travelling about the arena, not pinned.
        if (ball.active) expect(seen.hi - seen.lo).toBeGreaterThan(2);
      }
    }
  });

  it('turns a ball loose when it keeps touching the walls without getting anywhere', () => {
    const guard = new TrapGuard();
    const ball = { x: 1, y: 1, dx: 1, dy: 0.3 } as Ball;
    let freed = false;
    for (let i = 0; i < TrapGuard.HITS; i++) freed = guard.onContact(ball, i * 0.01, 0, 0) || freed;
    expect(freed).toBe(true);
    expect(guard.freed).toBe(1);
    // Now heading for the given centre.
    expect(ball.dx).toBeLessThan(0);
    expect(ball.dy).toBeLessThan(0);
    // Contacts spread out in time are ordinary bounces.
    const other = { x: 5, y: 5, dx: 1, dy: 0.3 } as Ball;
    let any = false;
    for (let i = 0; i < 20; i++) any = guard.onContact(other, i * 1, 0, 0) || any;
    expect(any).toBe(false);
  });
});

describe('every shipped world', () => {
  // Long runs at top speed in each world's drawn area: no ball ever overlaps a wall, stands still, or escapes.
  for (const [w, entry] of SHIPPED_CAMPAIGN.worlds.entries()) {
    it(`keeps every ball inside ${entry.def.name}'s ball area at top speed`, { timeout: 60000 }, () => {
      const area = entry.playAreas.ball;
      for (const stage of [0, 6]) {
        const level = w * STAGES_PER_WORLD + stage;
        const world = new World(SHIPPED_CAMPAIGN);
        world.newGame(4242 + level, level);
        world.lives = 1000;
        const input: StepInput = { targetX: null, axis: 0, action: false };
        let still = 0;
        let escaped = 0;
        const history = new Map<Ball, number[]>();
        const warn = console.warn;
        console.warn = () => {
          escaped++;
        };
        try {
          for (let i = 0; i < 120 * 45; i++) {
            (world.ballPhysics as unknown as { speedBonus: number }).speedBonus = BALL.maxSpeedBonus; // always at top speed
            autopilot(world, input, i);
            world.step(SIM.step, input);
            if (world.phase === 'cleared') world.loadLevel(level);
            for (const ball of world.balls.items) {
              if (!ball.active || ball.stuck || world.boundary.belowDrain(ball.x, ball.y)) {
                history.delete(ball);
                continue;
              }
              expect(wallDistance(area, ball.x, ball.y)).toBeGreaterThan(r - 1e-3);
              expect(Math.hypot(ball.dx, ball.dy)).toBeCloseTo(1, 6);
              // Stuck: a free ball whose every position over the last half second lies within a 0.3-unit box.
              const h = history.get(ball) ?? [];
              h.push(ball.x, ball.y);
              if (h.length > 120) h.splice(0, 2);
              history.set(ball, h);
              if (h.length === 120) {
                let x0 = Infinity,
                  x1 = -Infinity,
                  y0 = Infinity,
                  y1 = -Infinity;
                for (let k = 0; k < h.length; k += 2) {
                  x0 = Math.min(x0, h[k]);
                  x1 = Math.max(x1, h[k]);
                  y0 = Math.min(y0, h[k + 1]);
                  y1 = Math.max(y1, h[k + 1]);
                }
                if (x1 - x0 < 0.3 && y1 - y0 < 0.3) still++;
              }
            }
          }
        } finally {
          console.warn = warn;
        }
        expect(still).toBe(0);
        expect(escaped).toBe(0);
      }
    });
  }
});
