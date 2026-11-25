import { describe, expect, it } from 'vitest';
import { playableWorld } from '../src/content/authoredWorlds';
import { BALL, FIELD, FOREST_ART, SIM } from '../src/gameplay/config';
import { FOREST_OUTLINE, FOREST_OUTLINE_MAPPING } from '../src/content/outlines/forest';
import { BUILTIN_WORLDS as WORLDS, STAGES_PER_WORLD } from '../src/content/worlds';
import { createBoundary, OutlineBoundary, RectBoundary, TrapGuard } from '../src/gameplay/arena/boundary';
import type { SweepHit } from '../src/gameplay/arena/collision';
import type { Ball } from '../src/gameplay/types';
import { World, type StepInput } from '../src/gameplay/World';

const FOREST = STAGES_PER_WORLD; // first forest level
const r = BALL.radius;
const outline = new OutlineBoundary(FOREST_OUTLINE);
const tmp: SweepHit = { t: 0, nx: 0, ny: 0 };

/** Follows the lowest ball with the paddle and launches; the same autopilot world.test.ts uses. */
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

function fingerprint(world: World): string {
  const balls = world.balls.items
    .filter((b) => b.active)
    .map((b) => `${b.x.toFixed(9)},${b.y.toFixed(9)}`)
    .join('|');
  return `${world.score}:${world.lives}:${world.levelIndex}:${world.bricksRemaining}:${world.paddle.x.toFixed(9)}:${balls}`;
}

describe('forest outline data', () => {
  it('was traced with the mapping the forest view uses', () => {
    expect(FOREST_OUTLINE_MAPPING.widthPx).toBe(FOREST_ART.widthPx);
    expect(FOREST_OUTLINE_MAPPING.heightPx).toBe(FOREST_ART.heightPx);
    expect(FOREST_OUTLINE_MAPPING.centrePx).toBe(FOREST_ART.centrePx);
    expect(FOREST_OUTLINE_MAPPING.ceilingPx).toBe(FOREST_ART.ceilingPx);
    expect(FOREST_OUTLINE_MAPPING.pxPerUnit).toBeCloseTo(FOREST_ART.pxPerUnit, 4);
    expect((FOREST_OUTLINE_MAPPING.pitchDeg * Math.PI) / 180).toBeCloseTo(FOREST_ART.pitch, 9);
  });

  it('is a reasonably small polyline that encloses the play area and reaches below the ball-loss line', () => {
    const n = FOREST_OUTLINE.length / 2;
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(400);
    expect(FOREST_OUTLINE[1]).toBeLessThan(FIELD.bottom - 0.5);
    expect(FOREST_OUTLINE[FOREST_OUTLINE.length - 1]).toBeLessThan(FIELD.bottom - 0.5);
    // The middle of the arena, the serve position and the brick area are inside, well clear of the bark.
    for (const [x, y] of [[0, 0], [0, -8.2], [-11, 8.8], [11, 8.8], [0, 9.9]]) {
      expect(outline.nearest(x, y, tmp)).toBeGreaterThan(r);
    }
    // Outside the arch (in the trunks, above the branch) is on the wrong side.
    for (const [x, y] of [[-17, 0], [17, 0], [0, 14]]) expect(outline.nearest(x, y, tmp)).toBeLessThan(0);
  });
});

describe('outline boundary', () => {
  it('stops a ball at any speed before it crosses the outline (no tunnelling)', () => {
    for (let k = 0; k < 360; k += 7.5) {
      const a = (k * Math.PI) / 180;
      const dx = Math.cos(a) * 200; // far more than a step at top speed
      const dy = Math.sin(a) * 200;
      // Rays that leave through the open bottom (between the root tips, below the ball-loss line) hit nothing.
      const bottomY = FOREST_OUTLINE[1];
      if (dy < 0 && Math.abs((bottomY / dy) * dx) < Math.abs(FOREST_OUTLINE[0]) - 0.5) continue;
      const hit: SweepHit = { t: 0, nx: 0, ny: 0 };
      expect(outline.sweep(0, 0, dx, dy, r, hit)).toBe(true);
      const x = hit.t * dx;
      const y = hit.t * dy;
      // At the contact the ball touches the outline without overlapping it.
      expect(outline.nearest(x, y, tmp)).toBeGreaterThan(r - 1e-6);
      expect(outline.nearest(x, y, tmp)).toBeLessThan(r + 1e-3);
      expect(hit.nx * dx + hit.ny * dy).toBeLessThan(0);
    }
  });

  it('keeps every ball inside the traced arch over a long run at top speed', { timeout: 60000 }, () => {
    for (const level of [FOREST, FOREST + 1, FOREST + 6, FOREST + 8]) {
      const world = new World();
      world.newGame(4242 + level, level);
      expect(world.boundary.kind).toBe('outline');
      const input: StepInput = { targetX: null, axis: 0, action: false };
      let worst = Infinity;
      let still = 0;
      const history = new Map<Ball, number[]>();
      for (let i = 0; i < 120 * 90; i++) {
        (world as unknown as { speedBonus: number }).speedBonus = BALL.maxSpeedBonus; // always at top speed
        autopilot(world, input, i);
        world.step(SIM.step, input);
        if (world.phase === 'cleared') world.loadLevel(level);
        for (const ball of world.balls.items) {
          if (!ball.active || ball.stuck) {
            history.delete(ball);
            continue;
          }
          const d = outline.nearest(ball.x, ball.y, tmp);
          worst = Math.min(worst, d);
          expect(d).toBeGreaterThan(r - 1e-3);
          expect(Math.hypot(ball.dx, ball.dy)).toBeCloseTo(1, 6);
          expect(Math.abs(ball.dy)).toBeGreaterThanOrEqual(BALL.minVertical - 1e-9);
          // Stuck: a free ball whose every position over the last half second (60 steps) lies within a 0.3-unit box.
          const h = history.get(ball) ?? [];
          h.push(ball.x, ball.y);
          if (h.length > 120) h.splice(0, 2);
          history.set(ball, h);
          if (h.length === 120) {
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (let k = 0; k < h.length; k += 2) {
              x0 = Math.min(x0, h[k]); x1 = Math.max(x1, h[k]);
              y0 = Math.min(y0, h[k + 1]); y1 = Math.max(y1, h[k + 1]);
            }
            if (x1 - x0 < 0.3 && y1 - y0 < 0.3) still++;
          }
        }
      }
      expect(worst).toBeGreaterThan(r - 1e-3);
      expect(still).toBe(0); // a free ball never stands still
    }
  });

  it('frees a ball sent into the tightest corners (root flares, trunk/branch bends)', () => {
    const targets = [[-14.5, -8.9], [14.5, -8.9], [-14.9, 9.5], [14.9, 9.5], [-12.5, -9.8], [12.5, -9.8]];
    for (const [tx, ty] of targets) {
      for (const off of [-0.6, 0, 0.6]) {
        const world = new World();
        world.newGame(7, FOREST);
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
          expect(outline.nearest(ball.x, ball.y, tmp)).toBeGreaterThan(r - 1e-3);
        }
        // Either it fell out of the bottom (lost) or it is still travelling about the arena, not pinned.
        if (ball.active) expect(seen.hi - seen.lo).toBeGreaterThan(2);
      }
    }
  });

  it('turns a ball loose when it keeps touching the boundary without getting anywhere', () => {
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

describe('boundary switch', () => {
  it('forest uses the outline and space the rectangle by default', () => {
    expect(WORLDS[0].boundary ?? 'rect').toBe('rect');
    expect(WORLDS[1].boundary).toBe('outline');
    const world = new World();
    world.newGame(1, 0);
    expect(world.boundary).toBeInstanceOf(RectBoundary);
    world.loadLevel(FOREST);
    expect(world.boundary).toBeInstanceOf(OutlineBoundary);
  });

  it('can be overridden at runtime, and the override follows level changes', () => {
    const world = new World();
    world.newGame(1, FOREST);
    world.setBoundaryOverride('rect');
    expect(world.boundary.kind).toBe('rect');
    world.loadLevel(FOREST + 1);
    expect(world.boundary.kind).toBe('rect');
    world.setBoundaryOverride(null);
    expect(world.boundary.kind).toBe('outline');
    world.setBoundaryOverride('outline');
    world.loadLevel(0);
    expect(world.boundary.kind).toBe('rect'); // Space has no outline data
    // The config-level switch: a world asking for 'rect' (or nothing) gets the rectangle.
    expect(createBoundary({ ...WORLDS[1], boundary: 'rect' }).kind).toBe('rect');
    expect(createBoundary({ field: FIELD }).kind).toBe('rect');
  });

  it('gives an authored Forest world with an uploaded image the rectangle (its art no longer shows the tree)', () => {
    const forest = WORLDS[1];
    expect(playableWorld({ world: forest }).boundary).toBe('outline');
    expect(playableWorld({ world: forest, backgroundImage: 'data:image/png;base64,AAAA' }).boundary).toBe('rect');
    expect(playableWorld({ world: WORLDS[0], backgroundImage: 'data:image/png;base64,AAAA' })).toBe(WORLDS[0]);
  });

  it('leaves Space exactly as it was: an outline override changes nothing there', () => {
    for (const level of [0, 4, 7]) {
      const runWith = (override: 'outline' | null): string => {
        const world = new World();
        if (override) world.setBoundaryOverride(override);
        world.newGame(99 + level, level);
        const input: StepInput = { targetX: null, axis: 0, action: false };
        for (let i = 0; i < 120 * 40; i++) {
          autopilot(world, input, i);
          world.step(SIM.step, input);
          if (world.levelIndex >= STAGES_PER_WORLD) break;
        }
        return fingerprint(world);
      };
      expect(runWith('outline')).toBe(runWith(null));
    }
  });
});
