import { BALL, PADDLE, SCARAB } from '../config';
import { clamp } from '../../engine/core/math';
import { speedSteps } from '../../content/worlds';
import { Contact, TrapGuard } from '../arena/boundary';
import { overlapCircleAabb, sweepCircleAabb, type SweepHit } from '../arena/collision';
import { paddleSlope } from '../hazards/scarabs/scarabs';
import { BrickKind, type Ball, type Brick } from '../types';
import type { WorldContext } from '../WorldContext';

const enum HitKind {
  None,
  Wall,
  Shield,
  Brick,
  Paddle,
  Drain,
}

const CONTACT_EPS = 1e-4;
/** How far outside a drawn ball area's bounds a ball must be before it counts as escaped. */
const ESCAPE_MARGIN = BALL.radius * 4;

/**
 * The balls: serving, launching, swept movement with bounces off the walls (the world's drawn ball area), the
 * barrier, bricks and paddle, and clearing residual overlaps. Owned by World.
 */
export class BallPhysics {
  /** Frees balls trapped in a pocket of the walls. */
  readonly trapGuard = new TrapGuard();
  private readonly hit: SweepHit = { t: 0, nx: 0, ny: 0 };
  private readonly scratchBalls: Ball[] = [];
  private baseSpeed: number = BALL.baseSpeed;
  private speedBonus = 0;
  /** The ball being depenetrated, for the allocation-free reflect callback below. */
  private depBall: Ball | null = null;
  private readonly reflectDepBall = (nx: number, ny: number): void => {
    if (this.depBall) this.reflect(this.depBall, nx, ny);
  };

  constructor(private readonly world: WorldContext) {}

  /** Current ball speed: the level's base, paddle-hit bonus and any power-up scaling. */
  get speed(): number {
    return (this.baseSpeed + this.speedBonus) * this.world.powerUps.ballSpeedScale;
  }

  /** A new level: its base speed, with the paddle-hit bonus cleared. */
  startLevel(levelIndex: number): void {
    this.baseSpeed = BALL.baseSpeed + speedSteps(levelIndex) * BALL.speedPerLevel;
    this.speedBonus = 0;
  }

  /** Drops the paddle-hit speed bonus (a life lost or a level change). */
  clearBonus(): void {
    this.speedBonus = 0;
  }

  /** A new ball waiting on the paddle. */
  serve(): void {
    const world = this.world;
    const ball = world.balls.acquire();
    if (!ball) return;
    ball.stuck = true;
    ball.stuckOffset = 0;
    ball.stuckTime = 0;
    ball.dx = 0;
    ball.dy = 1;
    ball.x = ball.px = world.paddle.x;
    ball.y = ball.py = world.paddle.y + PADDLE.halfH + BALL.radius;
  }

  launchStuck(): void {
    for (const ball of this.world.balls.items) {
      if (ball.active && ball.stuck) this.launch(ball);
    }
  }

  /**
   * Multiball: every ball in play splits into three. A ball held on the paddle (Magnet, or waiting to serve)
   * stays put and its two copies launch upwards either side of it.
   */
  splitAll(): void {
    const sources = this.scratchBalls;
    sources.length = 0;
    for (const ball of this.world.balls.items) if (ball.active) sources.push(ball);
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const dx = src.stuck ? 0 : src.dx;
      const dy = src.stuck ? 1 : src.dy;
      this.spawnRotated(src.x, src.y, dx, dy, 0.32);
      this.spawnRotated(src.x, src.y, dx, dy, -0.32);
    }
    if (sources.length > 0) this.world.events.emit('ballsSplit', { x: sources[0].x, y: sources[0].y });
  }

  update(dt: number): void {
    const world = this.world;
    const paddle = world.paddle;
    for (const ball of world.balls.items) {
      if (!ball.active) continue;
      ball.px = ball.x;
      ball.py = ball.y;

      if (ball.stuck) {
        const half = paddle.width / 2 - 0.2;
        ball.stuckOffset = clamp(ball.stuckOffset, -half, half);
        // Held clear of the ball area's sides (a paddle lane may reach right up to them).
        const bounds = world.boundary.bounds;
        ball.x = clamp(paddle.x + ball.stuckOffset, bounds.left + BALL.radius, bounds.right - BALL.radius);
        ball.y = paddle.y + PADDLE.halfH + BALL.radius + ball.stuckOffset * Math.tan(paddleSlope(paddle));
        ball.stuckTime += dt;
        const autoLaunch =
          (world.demo && ball.stuckTime > 0.7) || (world.phase !== 'serve' && ball.stuckTime > BALL.magnetHoldTime);
        if (autoLaunch) this.launch(ball);
        continue;
      }

      this.moveBall(ball, dt);
      if (ball.stuck || !ball.active) continue;
      this.depenetrate(ball);

      // A drain can sit above the barrier. Keep the loss line below both, including just after the final charge
      // bounces a ball back towards the play area.
      const bounds = world.boundary.bounds;
      const lossY = Math.min(bounds.bottom, world.shieldY) - BALL.radius * 3;
      // A ball that got out through a wall despite depenetration would otherwise fly off for ever with the
      // level still live; count it as lost.
      const escaped =
        ball.x < bounds.left - ESCAPE_MARGIN ||
        ball.x > bounds.right + ESCAPE_MARGIN ||
        ball.y > bounds.top + ESCAPE_MARGIN;
      if (escaped)
        console.warn(`Ball escaped the ball area at (${ball.x.toFixed(2)}, ${ball.y.toFixed(2)}); counted as lost.`);
      if (ball.y < lossY || escaped) {
        world.balls.release(ball);
        world.events.emit('ballLost', { x: ball.x, remaining: world.balls.activeCount });
      }
    }
    if (world.phase === 'live' && world.balls.activeCount === 0) world.loseLife();
  }

  private launch(ball: Ball): void {
    const world = this.world;
    const halfW = world.paddle.width / 2;
    let angle = (ball.stuckOffset / halfW) * 0.7;
    if (Math.abs(angle) < 0.08) angle = world.rng.range(0.1, 0.3) * (world.rng.chance(0.5) ? 1 : -1);
    ball.stuck = false;
    ball.dx = Math.sin(angle);
    ball.dy = Math.cos(angle);
    if (world.phase === 'serve') world.phase = 'live';
    world.events.emit('ballLaunched', { x: ball.x, y: ball.y });
  }

  private spawnRotated(x: number, y: number, dx: number, dy: number, angle: number): Ball | null {
    const ball = this.world.balls.acquire();
    if (!ball) return null;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    ball.x = ball.px = x;
    ball.y = ball.py = y;
    ball.dx = dx * c - dy * s;
    ball.dy = dx * s + dy * c;
    ball.stuck = false;
    ball.stuckOffset = 0;
    ball.stuckTime = 0;
    this.fixDirection(ball);
    return ball;
  }

  /** Renormalises and enforces a minimum vertical component. */
  private fixDirection(ball: Ball): void {
    const len = Math.hypot(ball.dx, ball.dy);
    if (len < 1e-6) {
      ball.dx = 0;
      ball.dy = 1;
      return;
    }
    ball.dx /= len;
    ball.dy /= len;
    if (Math.abs(ball.dy) < BALL.minVertical) {
      ball.dy = ball.dy > 0 ? BALL.minVertical : -BALL.minVertical;
      const h = Math.sqrt(1 - ball.dy * ball.dy);
      ball.dx = ball.dx >= 0 ? h : -h;
    }
  }

  private reflect(ball: Ball, nx: number, ny: number): void {
    const d = ball.dx * nx + ball.dy * ny;
    if (d < 0) {
      ball.dx -= 2 * d * nx;
      ball.dy -= 2 * d * ny;
    }
    this.fixDirection(ball);
  }

  /** Swept movement with up to N bounces per step; always resolves the earliest contact first. */
  private moveBall(ball: Ball, dt: number): void {
    const world = this.world;
    const r = BALL.radius;
    const hit = this.hit;
    const bricks = world.brickField.bricks;
    const grid = world.grid;
    const paddle = world.paddle;
    const fire = world.powerUps.grants('pierce');
    const refrakt = world.refraktTime > 0;
    let remaining = this.speed * dt;
    const boundary = world.boundary;
    /** Wall contacts this step that made no progress (the ball wedged between surfaces). */
    let wedged = 0;

    for (let iter = 0; iter < BALL.maxBouncesPerStep && remaining > 1e-7; iter++) {
      const dx = ball.dx * remaining;
      const dy = ball.dy * remaining;
      let bestT = 1;
      let bestNx = 0;
      let bestNy = 0;
      let kind: HitKind = HitKind.None;
      let bestBrick: Brick | null = null;
      const shieldT = dy < 0 ? (world.shieldY + r - ball.y) / dy : -1;
      const shieldX = ball.x + dx * shieldT;
      const shieldWillCatch =
        dy < 0 &&
        world.shieldCharges > 0 &&
        shieldT >= 0 &&
        shieldX + r >= world.shieldLeft &&
        shieldX - r <= world.shieldRight;

      // Walls and drain. While the barrier will catch the ball, let it cross the drain to reach the barrier.
      const contact = boundary.sweep(ball.x, ball.y, dx, dy, r, hit, shieldWillCatch);
      if (contact !== Contact.None) {
        bestT = hit.t;
        bestNx = hit.nx;
        bestNy = hit.ny;
        kind = contact === Contact.Drain ? HitKind.Drain : HitKind.Wall;
      }
      if (shieldWillCatch) {
        const t = shieldT;
        if (t < bestT) {
          bestT = Math.max(0, t);
          bestNx = 0;
          bestNy = 1;
          kind = HitKind.Shield;
        }
      }

      // Bricks
      const reachX = grid.halfW + r + Math.abs(dx);
      const reachY = grid.halfH + r + Math.abs(dy);
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        if (!b.alive || !b.solid) continue;
        if (Math.abs(b.y - ball.y) > reachY || Math.abs(b.x - ball.x) > reachX) continue;
        if (sweepCircleAabb(ball.x, ball.y, dx, dy, r, b.x, b.y, grid.halfW, grid.halfH, hit) && hit.t < bestT) {
          bestT = hit.t;
          bestNx = hit.nx;
          bestNy = hit.ny;
          kind = HitKind.Brick;
          bestBrick = b;
        }
      }

      // Paddle, in its own (possibly scarab-tilted) frame; only when travelling into its top, so the ball can
      // never get trapped inside.
      {
        const slope = paddleSlope(paddle);
        const c = Math.cos(slope);
        const s = Math.sin(slope);
        const rx = ball.x - paddle.x;
        const ry = ball.y - paddle.y;
        const ldy = -dx * s + dy * c;
        if (
          ldy < 0 &&
          sweepCircleAabb(
            rx * c + ry * s,
            -rx * s + ry * c,
            dx * c + dy * s,
            ldy,
            r,
            0,
            0,
            paddle.width / 2,
            PADDLE.halfH,
            hit,
          ) &&
          hit.t < bestT
        ) {
          bestT = hit.t;
          bestNx = hit.nx * c - hit.ny * s;
          bestNy = hit.nx * s + hit.ny * c;
          kind = HitKind.Paddle;
        }
      }

      if (kind === HitKind.None) {
        ball.x += dx;
        ball.y += dy;
        return;
      }

      ball.x += dx * bestT + bestNx * CONTACT_EPS;
      ball.y += dy * bestT + bestNy * CONTACT_EPS;
      remaining *= 1 - bestT;
      const cx = ball.x - bestNx * r;
      const cy = ball.y - bestNy * r;

      switch (kind) {
        case HitKind.Drain:
          world.balls.release(ball);
          world.events.emit('ballLost', { x: ball.x, remaining: world.balls.activeCount });
          return;
        case HitKind.Wall:
          this.reflect(ball, bestNx, bestNy);
          world.events.emit('ballWall', { x: cx, y: cy, nx: bestNx, ny: bestNy });
          {
            // The minimum-vertical rule can turn a ball back into a sloping wall; then it leaves the other way
            // vertically instead.
            if (ball.dx * bestNx + ball.dy * bestNy < 0) ball.dy = -ball.dy;
            if (bestT < 1e-6) wedged++;
            // Anti-stuck: a ball wedged in a concave spot within one step, or touching the walls again and again
            // without getting anywhere, is turned towards the middle of the area.
            if (wedged >= 3) {
              this.trapGuard.free(ball, boundary.centreX, boundary.centreY);
              this.fixDirection(ball);
              wedged = 0;
            } else if (this.trapGuard.onContact(ball, world.time, boundary.centreX, boundary.centreY)) {
              this.fixDirection(ball);
            }
          }
          break;
        case HitKind.Shield:
          this.reflect(ball, bestNx, bestNy);
          world.shieldCharges--;
          world.events.emit('shieldHit', { x: ball.x, charges: world.shieldCharges });
          break;
        case HitKind.Brick: {
          const brick = bestBrick as Brick;
          const pierce = fire && brick.kind !== BrickKind.Steel;
          const dirX = ball.dx;
          const dirY = ball.dy;
          if (!pierce) this.reflect(ball, bestNx, bestNy);
          world.brickField.damage(brick, pierce || refrakt ? 99 : 1, 'ball', cx, cy, bestNx, bestNy);
          if (refrakt && !brick.alive) world.brickField.refraktBurst(brick, dirX, dirY);
          break;
        }
        case HitKind.Paddle:
          if (bestNy > 0.3) {
            this.paddleBounce(ball);
            if (ball.stuck) return;
          } else {
            this.reflect(ball, bestNx, bestNy);
          }
          break;
      }
    }
  }

  /**
   * Classic arcade paddle: outgoing angle depends on where the ball lands, nudged by paddle motion and turned
   * towards the low end when clinging scarabs weigh one end down.
   */
  private paddleBounce(ball: Ball): void {
    const world = this.world;
    const p = world.paddle;
    const r = BALL.radius;
    const slope = paddleSlope(p);
    const c = Math.cos(slope);
    const s = Math.sin(slope);
    // Where along the paddle it landed as seen from above (the classic aim, so a tilt never undoes it)...
    const offset = clamp((ball.x - p.x) / ((p.width / 2) * c + r), -1, 1);
    // ...and in the paddle's own (possibly tilted) frame, for sitting it back on the top face.
    const along = (ball.x - p.x) * c + (ball.y - p.y) * s;
    const angle = clamp(
      offset * PADDLE.maxBounceAngle + clamp(p.vx * 0.006, -0.2, 0.2) + p.lean * SCARAB.leanKick,
      -PADDLE.maxBounceAngle,
      PADDLE.maxBounceAngle,
    );
    ball.dx = Math.sin(angle);
    ball.dy = Math.cos(angle);
    // Sat just on the top face.
    const above = PADDLE.halfH + r + CONTACT_EPS;
    ball.x = p.x + along * c - above * s;
    ball.y = p.y + along * s + above * c;
    p.hitTime = world.time;
    this.speedBonus = Math.min(BALL.maxSpeedBonus, this.speedBonus + BALL.speedPerPaddleHit);
    world.setCombo(0);

    const caught = world.powerUps.grants('catchBall');
    if (caught) {
      ball.stuck = true;
      ball.stuckOffset = ball.x - p.x;
      ball.stuckTime = 0;
    }
    world.events.emit('ballPaddle', { x: ball.x, y: ball.y - r, offset, caught });
    world.scarabs.crush(ball.x);
  }

  /** Resolves any residual overlap (moving paddle, bricks that appear or re-solidify on top of a ball). */
  private depenetrate(ball: Ball): void {
    const world = this.world;
    const r = BALL.radius;
    const hit = this.hit;
    const bricks = world.brickField.bricks;
    const grid = world.grid;
    const reachX = grid.halfW + r;
    const reachY = grid.halfH + r;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive || !b.solid) continue;
      if (Math.abs(b.y - ball.y) >= reachY || Math.abs(b.x - ball.x) >= reachX) continue;
      if (overlapCircleAabb(ball.x, ball.y, r, b.x, b.y, grid.halfW, grid.halfH, hit)) {
        ball.x += hit.nx * (hit.t + CONTACT_EPS);
        ball.y += hit.ny * (hit.t + CONTACT_EPS);
        this.reflect(ball, hit.nx, hit.ny);
      }
    }

    const p = world.paddle;
    const slope = paddleSlope(p);
    const c = Math.cos(slope);
    const s = Math.sin(slope);
    const rx = ball.x - p.x;
    const ry = ball.y - p.y;
    const ly = -rx * s + ry * c;
    if (overlapCircleAabb(rx * c + ry * s, ly, r, 0, 0, p.width / 2, PADDLE.halfH, hit)) {
      if (ly > 0 && -ball.dx * s + ball.dy * c < 0) {
        this.paddleBounce(ball);
      } else {
        const nx = hit.nx * c - hit.ny * s;
        const ny = hit.nx * s + hit.ny * c;
        ball.x += nx * (hit.t + CONTACT_EPS);
        ball.y += ny * (hit.t + CONTACT_EPS);
        if (ball.dx * nx < 0) ball.dx = -ball.dx;
      }
    }

    this.depBall = ball;
    world.boundary.depenetrate(ball, r, this.reflectDepBall);
    this.depBall = null;
  }
}
