import { BALL, ICICLE, PADDLE } from '../../config';
import type { EventBus } from '../../../engine/core/EventBus';
import type { Random } from '../../../engine/core/Random';
import type { GameEvents } from '../../events';
import { worldIcicles, type HazardDef, type IcicleDef } from '../hazards';
import type { Ball, Paddle } from '../../types';

/**
 * hanging: grown and waiting; warn: glinting and cracking, about to drop; falling: dropping straight down
 * (cracked loose, or knocked off by the ball); regrow: broken off, growing back from the ceiling.
 */
export type IcicleState = 'hanging' | 'warn' | 'falling' | 'regrow';

export interface Icicle {
  readonly def: IcicleDef;
  state: IcicleState;
  /** Seconds left in a warning. */
  timer: number;
  /** How far it has grown back, 0-1 (1 while hanging, warning and falling). */
  growth: number;
  /** How far below its ceiling point it has fallen, and at the previous step (for render interpolation). */
  drop: number;
  pdrop: number;
  vy: number;
  /**
   * Knocked off by a ball that is still touching it: it cannot shatter until that ball has moved clear, so
   * the knock itself never doubles as a mid-air hit.
   */
  shielded: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Icicles grown at least this far can be broken by the ball. */
const BREAKABLE = 0.5;

/**
 * Runs a world's falling icicles (HazardDef kinds 'icicle' and 'icicles', see worldIcicles). Owned by World; deterministic for a given seed.
 * Only one timer runs for the whole ceiling: when it fires, the grown icicle nearest the paddle drops.
 */
export class IcicleSystem {
  readonly items: Icicle[] = [];
  /** 0 on a world's first level, 1 on its tenth. */
  private difficulty = 0;
  /** Until the next drop is tried. */
  private wait = 0;

  constructor(
    private readonly rng: Random,
    private readonly events: EventBus<GameEvents>,
  ) {}

  load(defs: readonly HazardDef[] | undefined, difficulty: number): void {
    this.difficulty = Math.min(1, Math.max(0, difficulty));
    this.items.length = 0;
    for (const def of worldIcicles(defs)) {
      this.items.push({ def, state: 'hanging', timer: 0, growth: 1, drop: 0, pdrop: 0, vy: 0, shielded: false });
    }
    this.reset(true);
  }

  /** Every icicle back on the ceiling, fully grown, with a fresh wait (level start, life lost). */
  reset(firstOfLevel = false): void {
    for (const c of this.items) {
      c.state = 'hanging';
      c.growth = 1;
      c.drop = c.pdrop = c.vy = 0;
      c.shielded = false;
    }
    this.wait = (firstOfLevel ? ICICLE.firstDelay : 0) + this.nextWait();
  }

  /** Tip of an icicle (its lowest point) in world y. */
  static tipY(c: Icicle, drop = c.drop): number {
    return c.def.y - drop - c.def.length * c.growth;
  }

  private scaled(pair: readonly [number, number]): number {
    return lerp(pair[0], pair[1], this.difficulty);
  }

  private nextWait(): number {
    return this.rng.range(this.scaled(ICICLE.waitMin), this.scaled(ICICLE.waitMax));
  }

  /**
   * @param live true while the ball is in play: only then does the wait count down and do icicles hit the
   *             paddle or react to the ball. Drops already under way still finish falling otherwise.
   * @returns points scored for falling icicles the ball shattered this step. The ball only knocks a hanging
   *          icicle loose (no points); it shatters one that is already falling.
   */
  update(dt: number, paddle: Paddle, balls: readonly Ball[], live: boolean): number {
    if (this.items.length === 0) return 0;
    let points = 0;
    const regrow = this.scaled(ICICLE.regrow);
    for (const c of this.items) {
      c.pdrop = c.drop;
      switch (c.state) {
        case 'regrow':
          c.growth = Math.min(1, c.growth + dt / regrow);
          if (c.growth >= 1) c.state = 'hanging';
          break;
        case 'warn':
          c.timer -= dt;
          if (c.timer <= 0) {
            c.state = 'falling';
            c.vy = 0;
            this.events.emit('icicleFall', { x: c.def.x, y: c.def.y });
          }
          break;
        case 'falling':
          this.fall(c, dt, paddle, live);
          break;
      }
      if (!live) continue;
      const touching = this.touchesBall(c, balls);
      if (c.state === 'falling') {
        if (!touching) c.shielded = false;
        else if (!c.shielded) {
          const mid = (c.def.y - c.drop + IcicleSystem.tipY(c)) / 2;
          this.breakOff(c);
          points += ICICLE.score;
          this.events.emit('icicleShatter', { x: c.def.x, y: mid, byBall: true });
        }
      } else if (touching) {
        // Still attached: the hit snaps it off the ceiling and it drops from where it hung.
        c.state = 'falling';
        c.vy = ICICLE.knockSpeed;
        c.shielded = true;
        this.events.emit('icicleKnocked', { x: c.def.x, y: c.def.y });
      }
    }
    if (live) {
      this.wait -= dt;
      if (this.wait <= 0) this.tryDrop(paddle);
    }
    return points;
  }

  private fall(c: Icicle, dt: number, paddle: Paddle, live: boolean): void {
    const before = IcicleSystem.tipY(c);
    c.vy += ICICLE.gravity * dt;
    c.drop += c.vy * dt;
    const tip = IcicleSystem.tipY(c);
    const top = paddle.y + PADDLE.halfH;
    // Swept along its fall, so a fast icicle can never pass through the paddle between steps.
    if (live && before >= top && tip < top && Math.abs(c.def.x - paddle.x) <= paddle.width / 2 + ICICLE.radius) {
      // The blow sets the paddle wobbling, dipped first on the side it struck, then shoves it towards the
      // other side: harder the nearer the end it lands.
      const side = clamp((c.def.x - paddle.x) / (paddle.width / 2), -1, 1);
      const sign = side < 0 ? -1 : 1;
      paddle.tilt = sign;
      paddle.slide = -sign * ICICLE.push * (0.5 + 0.5 * Math.abs(side));
      this.breakOff(c);
      this.events.emit('paddleStruck', { x: c.def.x, y: top });
      return;
    }
    // Smashes on the floor at the paddle's level.
    if (tip < paddle.y - PADDLE.halfH) {
      this.breakOff(c);
      this.events.emit('icicleShatter', { x: c.def.x, y: paddle.y - PADDLE.halfH, byBall: false });
    }
  }

  private breakOff(c: Icicle): void {
    c.state = 'regrow';
    c.growth = 0;
    c.drop = c.pdrop = c.vy = 0;
    c.shielded = false;
  }

  /** The ball overlaps the icicle, treated as a vertical segment `ICICLE.radius` thick. */
  private touchesBall(c: Icicle, balls: readonly Ball[]): boolean {
    if (c.growth < BREAKABLE) return false;
    const top = c.def.y - c.drop;
    const tip = IcicleSystem.tipY(c);
    const reach = BALL.radius + ICICLE.radius;
    for (const b of balls) {
      if (!b.active || b.stuck) continue;
      const dy = b.y > top ? b.y - top : b.y < tip ? tip - b.y : 0;
      const dx = b.x - c.def.x;
      if (dx * dx + dy * dy <= reach * reach) return true;
    }
    return false;
  }

  private tryDrop(paddle: Paddle): void {
    const busy = this.items.filter((c) => c.state === 'warn' || c.state === 'falling').length;
    let best: Icicle | null = null;
    let bestDistance = paddle.width / 2 + ICICLE.aim;
    if (busy < Math.round(this.scaled(ICICLE.maxFalling))) {
      for (const c of this.items) {
        if (c.state !== 'hanging') continue;
        const d = Math.abs(c.def.x - paddle.x);
        if (d <= bestDistance) {
          best = c;
          bestDistance = d;
        }
      }
    }
    if (!best) {
      this.wait = this.rng.range(ICICLE.retry[0], ICICLE.retry[1]);
      return;
    }
    best.state = 'warn';
    best.timer = this.scaled(ICICLE.warn);
    this.wait = this.nextWait();
    this.events.emit('icicleWarn', { x: best.def.x, y: best.def.y });
  }
}
