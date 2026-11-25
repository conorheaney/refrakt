import { BITE, PADDLE, SNAKE } from '../../config';
import type { EventBus } from '../../../engine/core/EventBus';
import type { Random } from '../../../engine/core/Random';
import { overlapCircleAabb, type SweepHit } from '../../arena/collision';
import type { GameEvents } from '../../events';
import type { HazardDef, HazardSystem, SnakeDef } from '../hazards';
import type { Ball, Paddle } from '../../types';

export type SnakeState = 'idle' | 'warn' | 'strike' | 'hold' | 'retract';

export interface Snake {
  readonly def: SnakeDef;
  /** +1 for a den on the left wall (strikes towards +x), -1 for the right wall. */
  readonly facing: 1 | -1;
  state: SnakeState;
  /** Seconds left in the current state (idle: until the next attempt). */
  timer: number;
  /** Full length of the current state, for animation progress. */
  duration: number;
  /** Strike point, fixed when the warning begins. */
  targetX: number;
  targetY: number;
  /** Head position along den -> target: 0 at rest, 1 fully extended, negative while rearing. */
  ext: number;
  headX: number;
  headY: number;
  /** Head at the previous step, for render interpolation. */
  phx: number;
  phy: number;
  /** This strike has already bitten (one bite per strike). */
  bit: boolean;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Runs a world's wall snakes. Owned by World; deterministic for a given seed. */
export class SnakeSystem implements HazardSystem {
  readonly items: Snake[] = [];
  /** 0 on a world's first level, 1 on its tenth. */
  private difficulty = 0;
  private readonly hit: SweepHit = { t: 0, nx: 0, ny: 0 };

  constructor(
    private readonly rng: Random,
    private readonly events: EventBus<GameEvents>,
  ) {}

  load(defs: readonly HazardDef[] | undefined, difficulty: number): void {
    this.difficulty = Math.min(1, Math.max(0, difficulty));
    this.items.length = 0;
    for (const def of defs ?? []) {
      if (def.kind !== 'snake') continue;
      this.items.push({
        def,
        facing: def.x < 0 ? 1 : -1,
        state: 'idle',
        timer: 0,
        duration: 0,
        targetX: def.x,
        targetY: def.y,
        ext: 0,
        headX: def.x,
        headY: def.y,
        phx: def.x,
        phy: def.y,
        bit: false,
      });
    }
    this.reset(true);
  }

  /** Every snake back in its den with a fresh wait (level start, life lost). */
  reset(firstOfLevel = false): void {
    for (const h of this.items) {
      h.state = 'idle';
      h.ext = 0;
      h.bit = false;
      h.headX = h.phx = h.def.x;
      h.headY = h.phy = h.def.y;
      h.timer = h.duration = (firstOfLevel ? SNAKE.firstDelay : 0) + this.wait();
    }
  }

  private scaled(pair: readonly [number, number]): number {
    return lerp(pair[0], pair[1], this.difficulty);
  }

  private wait(): number {
    return this.rng.range(this.scaled(SNAKE.waitMin), this.scaled(SNAKE.waitMax));
  }

  /**
   * @param _balls Unused: snakes only bite the paddle (the parameter keeps the HazardSystem signature).
   * @param live true while the ball is in play: only then do waits count down and bites land. Strikes
   *             already under way still finish their animation otherwise.
   * @returns 0: snakes never score.
   */
  update(dt: number, paddle: Paddle, _balls: readonly Ball[], live: boolean): number {
    for (const h of this.items) {
      h.phx = h.headX;
      h.phy = h.headY;
      if (h.state === 'idle') {
        if (live) {
          h.timer -= dt;
          if (h.timer <= 0) this.tryStrike(h, paddle);
        }
      } else {
        h.timer -= dt;
        if (h.timer <= 0) this.advance(h);
      }
      this.place(h);
      if (live && !h.bit && (h.state === 'strike' || h.state === 'hold') && h.ext > 0.25) {
        if (
          overlapCircleAabb(
            h.headX,
            h.headY,
            SNAKE.headRadius,
            paddle.x,
            paddle.y,
            paddle.width / 2,
            PADDLE.halfH,
            this.hit,
          )
        ) {
          h.bit = true;
          // Pushed towards the centre, away from the snake's wall, stopping at the centre.
          paddle.shove = -Math.sign(paddle.x) * Math.min(BITE.distance, Math.abs(paddle.x));
          this.events.emit('paddleBitten', { x: h.headX, y: h.headY });
        }
      }
    }
    return 0;
  }

  private tryStrike(h: Snake, paddle: Paddle): void {
    const busy = this.items.some((other) => other !== h && other.state !== 'idle');
    const ty = paddle.y + SNAKE.aimLift;
    const nearestX = Math.max(paddle.x - paddle.width / 2, Math.min(paddle.x + paddle.width / 2, h.def.x));
    const inReach = Math.hypot(nearestX - h.def.x, ty - h.def.y) <= h.def.reach + SNAKE.headRadius;
    if (busy || (!inReach && !this.rng.chance(SNAKE.feintChance))) {
      h.timer = h.duration = this.rng.range(SNAKE.retry[0], SNAKE.retry[1]);
      return;
    }
    // Aim where the paddle is now; the strike never tracks it afterwards, so moving away always dodges.
    let dx = paddle.x - h.def.x;
    let dy = ty - h.def.y;
    // Never strike backwards into the wall.
    if (dx * h.facing < 0.5) dx = 0.5 * h.facing;
    const d = Math.hypot(dx, dy);
    if (d > h.def.reach) {
      dx *= h.def.reach / d;
      dy *= h.def.reach / d;
    }
    h.targetX = h.def.x + dx;
    h.targetY = h.def.y + dy;
    h.bit = false;
    this.enter(h, 'warn', this.scaled(SNAKE.warn));
    this.events.emit('snakeWarn', { x: h.def.x, y: h.def.y });
  }

  private advance(h: Snake): void {
    switch (h.state) {
      case 'warn':
        this.enter(h, 'strike', SNAKE.strike);
        this.events.emit('snakeStrike', { x: h.def.x, y: h.def.y });
        break;
      case 'strike':
        this.enter(h, 'hold', SNAKE.hold);
        break;
      case 'hold':
        this.enter(h, 'retract', SNAKE.retract);
        break;
      default:
        h.state = 'idle';
        h.timer = h.duration = this.wait();
    }
  }

  private enter(h: Snake, state: SnakeState, duration: number): void {
    h.state = state;
    h.timer = h.duration = duration;
  }

  /** Head position for the current state's progress. */
  private place(h: Snake): void {
    const p = h.duration > 0 ? Math.min(1, Math.max(0, 1 - h.timer / h.duration)) : 1;
    switch (h.state) {
      case 'idle':
        h.ext = 0;
        break;
      case 'warn':
        h.ext = -SNAKE.rear * easeOut(p);
        break;
      case 'strike':
        h.ext = lerp(-SNAKE.rear, 1, easeOut(p));
        break;
      case 'hold':
        h.ext = 1;
        break;
      case 'retract':
        h.ext = 1 - smooth(p);
        break;
    }
    h.headX = lerp(h.def.x, h.targetX, h.ext);
    h.headY = lerp(h.def.y, h.targetY, h.ext);
  }
}
