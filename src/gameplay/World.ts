import {
  BALL,
  BOSS_FIRE,
  BOSS_SUMMON,
  BRICK_HP,
  BRICK_POINTS,
  DROP,
  EXPLOSION,
  REFRAKT,
  FIELD,
  type FieldDef,
  GRID,
  ICICLE,
  type GridDef,
  LASER,
  PADDLE,
  PHASE_BRICK,
  PLAYER,
  POWERUPS,
  POWERUP_SCORE,
  SHIELD_CHARGES,
  SHOT,
  BITE,
  SCARAB,
} from './config';
import { LEVELS, LEVEL_CELLS } from '../content/levels';
import { speedSteps, STAGES_PER_WORLD, worldIndexOf, worldOf, type WorldDef } from '../content/worlds';
import { worldHazards } from './hazards/hazards';
import { SnakeSystem } from './hazards/snakes/snakes';
import { IcicleSystem } from './hazards/icicles/icicles';
import { paddleSlope, ScarabSystem } from './hazards/scarabs/scarabs';
import { areaContour, areaSegments, clampToSpans, distance, findPaddleLane, nearestOnSegment, paddleIntervals, pointInPolygon, polygonSignedArea, sweepArea, worldPlayAreas, type BoundarySegment, type Point, type Interval } from './arena/playAreas';
import { EventBus } from '../engine/core/EventBus';
import { clamp } from '../engine/core/math';
import { Pool } from '../engine/core/Pool';
import { Random } from '../engine/core/Random';
import { createBoundary, RectBoundary, TrapGuard, type ArenaBoundary, type BoundaryKind } from './arena/boundary';
import { overlapCircleAabb, sweepCircleAabb, sweepCircleCircle, type SweepHit } from './arena/collision';
import type { GameEvents } from './events';
import {
  BrickKind,
  POWERUP_KIND_COUNT,
  PowerUpKind,
  type Ball,
  type Boss,
  type Brick,
  type DamageCause,
  type Drop,
  type Laser,
  type Paddle,
  type Shot,
  type WorldPhase,
} from './types';

/** Per-step player intent. Sampled by the game loop, consumed by the simulation. */
export interface StepInput {
  /** Absolute paddle target (pointer / AI), or null when unused. */
  targetX: number | null;
  /** Keyboard axis in [-1, 1]; takes priority over targetX when non-zero. */
  axis: number;
  /** Launch / release, true for a single step. */
  action: boolean;
}

const enum HitKind {
  None,
  Wall,
  Shield,
  Brick,
  Paddle,
  Boss,
  Drain,
}

const CONTACT_EPS = 1e-4;


/**
 * True when (x, y) lies outside an arena's arch boundary shrunk by `margin` (top and corners only). The
 * rounded corners' centres are at (+/-(halfWidth - cornerRadius), top - cornerRadius).
 */
export function beyondArch(x: number, y: number, margin = 0, field: FieldDef = FIELD): boolean {
  if (y > field.top - margin) return true;
  const cornerX = field.halfWidth - field.cornerRadius;
  const cornerY = field.top - field.cornerRadius;
  const ax = Math.abs(x);
  if (ax <= cornerX || y <= cornerY) return false;
  return Math.hypot(ax - cornerX, y - cornerY) > field.cornerRadius - margin;
}

/**
 * The complete, renderer-agnostic game simulation.
 *
 * - Advances only through `step(dt, input)` with a fixed dt, so it is
 *   deterministic for a given seed and input stream.
 * - Owns every entity in preallocated pools; no allocation happens per step
 *   apart from event payloads.
 * - Communicates outward exclusively through `events`.
 */
export class World {
  readonly events = new EventBus<GameEvents>();
  readonly bricks: readonly Brick[];
  readonly balls: Pool<Ball>;
  readonly drops: Pool<Drop>;
  readonly lasers: Pool<Laser>;
  readonly shots: Pool<Shot>;
  readonly paddle: Paddle = { x: 0, px: 0, y: PADDLE.y, width: PADDLE.width, vx: 0, stun: 0, shove: 0, tilt: 0, slide: 0, lean: 0, hitTime: -10 };
  readonly boss: Boss = {
    active: false,
    def: null,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    radius: 1,
    hp: 0,
    maxHp: 1,
    stage: 0,
    t: 0,
    fireTimer: 0,
    summonTimer: 0,
    invuln: 0,
    hitTime: -10,
  };
  /** Remaining seconds for each timed power-up, indexed by PowerUpKind. */
  readonly effectTime = new Float32Array(POWERUP_KIND_COUNT);
  private readonly scratchBalls: Ball[] = [];

  /** Seconds of Refrakt left (started by breaking a Prism brick; not a pickup). */
  refraktTime = 0;
  get refraktActive(): boolean {
    return this.refraktTime > 0;
  }

  shieldCharges = 0;
  /** Custom paddle lanes carry the barrier with the paddle's lower edge. */
  get shieldY(): number {
    return this.paddleContour ? this.paddle.y - PADDLE.halfH : this.field.shieldY;
  }
  /** Lane spans describe paddle centres; add its half-width to recover the area edges. */
  get shieldLeft(): number {
    return this.paddleSpan ? this.paddleSpan[0] - this.worldDef.paddleExpandedWidth / 2 : -this.field.paddleReach;
  }
  get shieldRight(): number {
    return this.paddleSpan ? this.paddleSpan[1] + this.worldDef.paddleExpandedWidth / 2 : this.field.paddleReach;
  }
  score = 0;
  lives: number = PLAYER.lives;
  combo = 0;
  bestCombo = 0;
  multiplier = 1;
  levelIndex = 0;
  time = 0;
  bricksRemaining = 0;
  bricksTotal = 0;
  phase: WorldPhase = 'serve';
  /** Attract mode: infinite lives, auto-launch, no score bonuses. */
  demo = false;

  /** Arena bounds for the current level's world (see WorldDef). */
  field: FieldDef = FIELD;
  /** Brick cell size and placement for the current level's world (see WorldDef). */
  grid: GridDef = GRID;
  private ballBoundary: BoundarySegment[] | null = null;
  private ballContour: Point[] = [];
  private ballOrientation = 1;
  private paddleContour: Point[] | null = null;
  private paddleSpan: Interval | null = null;
  private customBottom: number | null = null;
  /** The current level's world: arena, brick grid, paddle size and serve gap. */
  private worldDef: WorldDef = worldOf(0);
  /** What the ball bounces off in the current world (gameplay/arena/boundary.ts): the field's rectangle or a traced outline. */
  boundary: ArenaBoundary = new RectBoundary(FIELD);
  /** Runtime override of every world's boundary (`?boundary=`, see Game); null uses each world's own. */
  private boundaryOverride: BoundaryKind | null = null;
  /** Frees balls trapped by an outline boundary (never used with the rectangle). */
  private readonly trapGuard = new TrapGuard();
  /** The ball being depenetrated, for the allocation-free reflect callback below. */
  private depBall: Ball | null = null;
  private readonly reflectDepBall = (nx: number, ny: number): void => {
    if (this.depBall) this.reflect(this.depBall, nx, ny);
  };

  private baseBallSpeed: number = BALL.baseSpeed;
  private speedBonus = 0;
  private respawnTimer = 0;
  private laserCooldown = 0;
  /** Power-ups released so far in the current level (capped by DROP.maxPerLevel). */
  private dropsThisLevel = 0;
  /** Power-up kinds allowed to drop (1 = allowed), indexed by PowerUpKind; see setLoadout. */
  private readonly allowedKinds = new Uint8Array(POWERUP_KIND_COUNT).fill(1);
  private loadoutKinds: readonly PowerUpKind[] | null = null;
  private readonly rng = new Random(1);
  /** Hazards draw from their own stream, so adding enemies to a world never changes its power-up rolls. */
  private readonly hazardRng = new Random(2);
  /** The current world's wall snakes (gameplay/hazards/snakes/snakes.ts); empty in worlds without any. */
  readonly hazards = new SnakeSystem(this.hazardRng, this.events);
  /** The current world's falling icicles (gameplay/hazards/icicles/icicles.ts); empty in worlds without any. */
  readonly icicles = new IcicleSystem(this.hazardRng, this.events);
  /** The current world's scarab nests and swarms (gameplay/hazards/scarabs/scarabs.ts); empty in worlds without any. */
  readonly scarabs = new ScarabSystem(this.hazardRng, this.events);
  private readonly hit: SweepHit = { t: 0, nx: 0, ny: 0 };
  private readonly scratchCells: number[] = [];

  constructor() {
    const bricks: Brick[] = [];
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        bricks.push({
          index: row * GRID.cols + col,
          col,
          row,
          x: (col - (GRID.cols - 1) / 2) * this.grid.cellW,
          y: this.grid.topY - row * this.grid.cellH,
          kind: BrickKind.Normal,
          hp: 0,
          maxHp: 1,
          alive: false,
          solid: true,
          fuse: 0,
          spawnTime: 0,
          hitTime: -10,
        });
      }
    }
    this.bricks = bricks;
    this.balls = new Pool<Ball>(BALL.capacity, () => ({
      active: false,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      dx: 0,
      dy: 1,
      stuck: false,
      stuckOffset: 0,
      stuckTime: 0,
    }));
    this.drops = new Pool<Drop>(DROP.capacity, () => ({ active: false, kind: PowerUpKind.Expand, x: 0, y: 0, py: 0 }));
    this.lasers = new Pool<Laser>(LASER.capacity, () => ({ active: false, x: 0, y: 0, py: 0 }));
    this.shots = new Pool<Shot>(SHOT.capacity, () => ({ active: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 }));
  }

  // ---------------------------------------------------------------- lifecycle

  get levelCount(): number {
    return LEVELS.length;
  }

  get ballSpeed(): number {
    const slow = this.effectTime[PowerUpKind.Slow] > 0 ? BALL.slowFactor : 1;
    return (this.baseBallSpeed + this.speedBonus) * slow;
  }

  hasEffect(kind: PowerUpKind): boolean {
    return this.effectTime[kind] > 0;
  }

  /** The power-up kinds allowed to drop, or null when every kind is allowed (the default). */
  get loadout(): readonly PowerUpKind[] | null {
    return this.loadoutKinds;
  }

  /**
   * Restricts which power-up kinds can drop (every drop source goes through maybeDrop). Drop chance and
   * caps are unchanged; only the pool of kinds is filtered. Pass null to allow every kind. The loadout
   * persists across levels until changed; the game sets it before each level starts.
   */
  setLoadout(kinds: readonly PowerUpKind[] | null): void {
    if (kinds === null) {
      this.loadoutKinds = null;
      this.allowedKinds.fill(1);
      return;
    }
    if (kinds.length === 0) throw new Error('Power-up loadout must contain at least one kind');
    const seen = new Set<PowerUpKind>();
    for (const k of kinds) {
      if (!Number.isInteger(k) || k < 0 || k >= POWERUP_KIND_COUNT) throw new Error(`Unknown power-up kind ${k}`);
      if (seen.has(k)) throw new Error(`Duplicate power-up kind ${k} in loadout`);
      seen.add(k);
    }
    this.loadoutKinds = [...kinds];
    this.allowedKinds.fill(0);
    for (const k of kinds) this.allowedKinds[k] = 1;
  }

  newGame(seed: number, startLevel = 0): void {
    this.rng.seed(seed);
    this.hazardRng.seed(seed ^ 0x5a17e);
    this.score = 0;
    this.lives = PLAYER.lives;
    this.time = 0;
    this.bestCombo = 0;
    this.paddle.x = 0;
    this.paddle.px = 0;
    this.loadLevel(startLevel);
  }

  loadLevel(index: number): void {
    const levelIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
    const def = LEVELS[levelIndex];
    this.levelIndex = levelIndex;
    this.setWorldDef(worldOf(levelIndex));
    const areas = worldPlayAreas.get(worldIndexOf(levelIndex));
    this.ballBoundary = areas?.ball ? areaSegments(areas.ball, areas.ball.drainEdge) : null;
    this.ballContour = areas?.ball ? areaContour(areas.ball) : [];
    this.ballOrientation = areas?.ball ? Math.sign(polygonSignedArea(areas.ball.points)) : 1;
    this.customBottom = areas?.ball ? Math.min(...this.ballContour.map((p) => p.y)) - BALL.radius * 3 : null;
    this.paddleContour = areas?.paddle ? areaContour(areas.paddle) : null;
    this.paddleSpan = null;
    this.paddle.y = PADDLE.y;
    if (areas?.paddle) {
      const lane = findPaddleLane(areas.paddle, this.worldDef.paddleExpandedWidth, PADDLE.halfH);
      this.paddle.y = lane.y;
      // Keep movement in one connected lane, never teleport across holes in a concave polygon.
      this.paddleSpan = lane.spans.reduce((best, span) => span[1] - span[0] > best[1] - best[0] ? span : best);
      const spans = this.currentPaddleSpans();
      this.paddle.x = this.paddle.px = clampToSpans(this.paddle.x, spans);
    }
    this.clearTransient();
    const hazardDefs = worldHazards.get(worldIndexOf(levelIndex));
    const difficulty = (levelIndex % STAGES_PER_WORLD) / (STAGES_PER_WORLD - 1);
    this.hazards.load(hazardDefs, difficulty);
    this.icicles.load(hazardDefs, difficulty);
    this.scarabs.load(hazardDefs, difficulty);
    this.dropsThisLevel = 0;

    for (const brick of this.bricks) {
      brick.alive = false;
      brick.fuse = 0;
    }
    this.bricksRemaining = 0;
    for (const cell of LEVEL_CELLS[levelIndex]) {
      const brick = this.bricks[cell.row * GRID.cols + cell.col];
      this.reviveBrick(brick, cell.kind, this.time + 0.15 + cell.row * 0.045 + cell.col * 0.02);
    }
    this.bricksTotal = this.bricksRemaining;

    const boss = this.boss;
    boss.def = def.boss ?? null;
    boss.active = boss.def !== null;
    if (boss.def) {
      boss.radius = boss.def.radius;
      boss.hp = boss.def.hp;
      boss.maxHp = boss.def.hp;
      boss.stage = 0;
      boss.t = 0;
      boss.x = boss.px = 0;
      boss.y = boss.py = boss.def.y;
      boss.fireTimer = boss.def.fireInterval + BOSS_FIRE.openingDelay;
      boss.summonTimer = boss.def.summonInterval;
      boss.invuln = 0;
      boss.hitTime = -10;
    }

    this.baseBallSpeed = BALL.baseSpeed + speedSteps(levelIndex) * BALL.speedPerLevel;
    this.speedBonus = 0;
    this.phase = 'serve';
    this.serveBall();
    this.events.emit('levelLoaded', { index: levelIndex, name: def.name, boss: boss.active });
  }

  /** Adopts a world's arena, brick grid and paddle size (bricks are re-placed; the paddle snaps to its width). */
  private setWorldDef(def: WorldDef): void {
    if (def === this.worldDef && def.grid === this.grid && def.field === this.field) return;
    this.worldDef = def;
    this.field = def.field;
    this.boundary = createBoundary(def, this.boundaryOverride);
    this.grid = def.grid;
    for (const b of this.bricks) {
      b.x = (b.col - (this.grid.cols - 1) / 2) * this.grid.cellW;
      b.y = this.grid.topY - b.row * this.grid.cellH;
    }
    this.paddle.width = def.paddleWidth;
    const limit = def.field.paddleReach - this.paddle.width / 2;
    this.paddle.x = this.paddle.px = clamp(this.paddle.x, -limit, limit);
  }

  /**
   * Forces every world's ball boundary to 'rect' or 'outline' (null: each world's own choice). A world without
   * outline data keeps its rectangle. Takes effect immediately.
   */
  setBoundaryOverride(kind: BoundaryKind | null): void {
    this.boundaryOverride = kind;
    this.boundary = createBoundary(this.worldDef, kind);
    this.trapGuard.reset();
  }

  // --------------------------------------------------------------------- step

  step(dt: number, input: StepInput): void {
    if (this.phase === 'over') return;
    this.time += dt;
    this.updateEffects(dt);
    this.updatePaddle(dt, input);

    if (this.phase === 'respawn') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.phase = 'serve';
        this.serveBall();
      }
    }
    if (input.action) this.launchStuckBalls();

    this.updateBricks(dt);
    this.updateBalls(dt);
    this.updateLasers(dt);
    this.updateDrops(dt);
    this.updateBoss(dt);
    this.hazards.update(dt, this.paddle, this.phase === 'live');
    this.score += this.icicles.update(dt, this.paddle, this.balls.items, this.phase === 'live');
    this.score += this.scarabs.update(dt, this.paddle, this.balls.items, this.phase === 'live');
    this.checkCleared();
  }

  // ------------------------------------------------------------------ effects

  private updateEffects(dt: number): void {
    if (this.refraktTime > 0) {
      this.refraktTime = Math.max(0, this.refraktTime - dt);
      if (this.refraktTime === 0) this.events.emit('refraktEnded', { cut: false });
    }
    const effects = this.effectTime;
    for (let kind = 0; kind < effects.length; kind++) {
      if (effects[kind] <= 0) continue;
      effects[kind] -= dt;
      if (effects[kind] <= 0) {
        effects[kind] = 0;
        this.events.emit('powerUpExpired', { kind: kind as PowerUpKind });
        if (kind === PowerUpKind.Magnet) this.launchStuckBalls();
      }
    }
  }

  private collect(kind: PowerUpKind, x: number, y: number): void {
    const info = POWERUPS[kind];
    if (info.duration > 0) {
      this.effectTime[kind] = info.duration;
    } else if (kind === PowerUpKind.Multi) {
      const sources = this.scratchBalls;
      sources.length = 0;
      for (const ball of this.balls.items) if (ball.active && !ball.stuck) sources.push(ball);
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        this.spawnBallRotated(src.x, src.y, src.dx, src.dy, 0.32);
        this.spawnBallRotated(src.x, src.y, src.dx, src.dy, -0.32);
      }
      if (sources.length > 0) this.events.emit('ballsSplit', { x: sources[0].x, y: sources[0].y });
    } else if (kind === PowerUpKind.Shield) {
      this.shieldCharges = SHIELD_CHARGES;
    } else if (kind === PowerUpKind.Life) {
      this.lives = Math.min(PLAYER.maxLives, this.lives + 1);
    }
    this.score += POWERUP_SCORE;
    this.events.emit('powerUpCollected', { kind, x, y });
  }

  // ------------------------------------------------------------------- paddle

  private updatePaddle(dt: number, input: StepInput): void {
    const p = this.paddle;
    p.px = p.x;
    const targetWidth = this.effectTime[PowerUpKind.Expand] > 0 ? this.worldDef.paddleExpandedWidth : this.worldDef.paddleWidth;
    p.width += (targetWidth - p.width) * Math.min(1, dt * 10);

    const stunned = p.stun > 0;
    if (stunned) p.stun -= dt;
    if (p.tilt !== 0) p.tilt = p.tilt > 0 ? Math.max(0, p.tilt - dt / ICICLE.tiltTime) : Math.min(0, p.tilt + dt / ICICLE.tiltTime);
    // An icicle's shove, once the wobble has had a moment to start: quick at first, easing off.
    if (p.slide !== 0 && Math.abs(p.tilt) <= 1 - ICICLE.pushDelay / ICICLE.tiltTime) {
      const move = Math.abs(p.slide) < 0.02 ? p.slide : p.slide * Math.min(1, dt * ICICLE.pushRate);
      p.x += move;
      p.slide -= move;
    }
    if (p.shove !== 0) {
      // A snake bite's push overrides input until it has played out.
      const move = Math.abs(p.shove) < 0.02 ? p.shove : p.shove * Math.min(1, dt * BITE.rate);
      p.x += move;
      p.shove -= move;
    } else if (stunned) {
      // Locked in place by a boss shot.
    } else if (input.axis !== 0) {
      p.x += clamp(input.axis, -1, 1) * PADDLE.keySpeed * dt;
    } else if (input.targetX !== null) {
      const maxMove = PADDLE.pointerSpeed * dt;
      p.x += clamp(input.targetX - p.x, -maxMove, maxMove);
    }
    if (this.paddleContour) p.x = clampToSpans(p.x, this.currentPaddleSpans());
    else {
      const limit = this.field.paddleReach - p.width / 2;
      p.x = clamp(p.x, -limit, limit);
    }
    p.vx = (p.x - p.px) / dt;
  }

  // -------------------------------------------------------------------- balls

  private currentPaddleSpans(): Interval[] {
    if (!this.paddleContour || !this.paddleSpan) return [];
    const centre = (this.paddleSpan[0] + this.paddleSpan[1]) / 2;
    return paddleIntervals(this.paddleContour, this.paddle.y, this.paddle.width, PADDLE.halfH).filter(([a, b]) => a <= centre && b >= centre);
  }

  private serveBall(): void {
    const ball = this.balls.acquire();
    if (!ball) return;
    ball.stuck = true;
    ball.stuckOffset = 0;
    ball.stuckTime = 0;
    ball.dx = 0;
    ball.dy = 1;
    ball.x = ball.px = this.paddle.x;
    ball.y = ball.py = this.paddle.y + PADDLE.halfH + BALL.radius + this.worldDef.serveLift;
  }

  private launchStuckBalls(): void {
    for (const ball of this.balls.items) {
      if (ball.active && ball.stuck) this.launch(ball);
    }
  }

  private launch(ball: Ball): void {
    const halfW = this.paddle.width / 2;
    let angle = (ball.stuckOffset / halfW) * 0.7;
    if (Math.abs(angle) < 0.08) angle = this.rng.range(0.1, 0.3) * (this.rng.chance(0.5) ? 1 : -1);
    ball.stuck = false;
    ball.dx = Math.sin(angle);
    ball.dy = Math.cos(angle);
    if (this.phase === 'serve') this.phase = 'live';
    this.events.emit('ballLaunched', { x: ball.x, y: ball.y });
  }

  private spawnBallRotated(x: number, y: number, dx: number, dy: number, angle: number): Ball | null {
    const ball = this.balls.acquire();
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

  private updateBalls(dt: number): void {
    const paddle = this.paddle;
    for (const ball of this.balls.items) {
      if (!ball.active) continue;
      ball.px = ball.x;
      ball.py = ball.y;

      if (ball.stuck) {
        const half = paddle.width / 2 - 0.2;
        ball.stuckOffset = clamp(ball.stuckOffset, -half, half);
        const wall = this.field.halfWidth - BALL.radius;
        ball.x = this.ballBoundary || this.paddleContour ? paddle.x + ball.stuckOffset : clamp(paddle.x + ball.stuckOffset, -wall, wall);
        ball.y = paddle.y + PADDLE.halfH + BALL.radius + this.worldDef.serveLift + ball.stuckOffset * Math.tan(paddleSlope(paddle));
        ball.stuckTime += dt;
        const autoLaunch =
          (this.demo && ball.stuckTime > 0.7) || (this.phase !== 'serve' && ball.stuckTime > BALL.magnetHoldTime);
        if (autoLaunch) this.launch(ball);
        continue;
      }

      this.moveBall(ball, dt);
      if (ball.stuck || !ball.active) continue;
      this.depenetrate(ball);

      // Custom drains can sit above the paddle-bottom shield. Keep the fallback below it,
      // including just after the final charge bounces a ball back towards the play area.
      const lossY = this.customBottom !== null
        ? Math.min(this.customBottom, this.shieldY - BALL.radius * 3)
        : this.paddleContour ? Math.min(this.field.bottom, this.paddle.y - 2) : this.field.bottom;
      if (ball.y < lossY) {
        this.balls.release(ball);
        this.events.emit('ballLost', { x: ball.x, remaining: this.balls.activeCount });
      }
    }
    if (this.phase === 'live' && this.balls.activeCount === 0) this.loseLife();
  }

  /** Swept movement with up to N bounces per step; always resolves the earliest contact first. */
  private moveBall(ball: Ball, dt: number): void {
    const r = BALL.radius;
    const hit = this.hit;
    const bricks = this.bricks;
    const paddle = this.paddle;
    const boss = this.boss;
    const fire = this.effectTime[PowerUpKind.Fire] > 0;
    const refrakt = this.refraktTime > 0;
    let remaining = this.ballSpeed * dt;
    const field = this.field;
    const boundary = this.boundary;
    /** Outline contacts this step that made no progress (the ball wedged between surfaces). */
    let wedged = 0;

    for (let iter = 0; iter < BALL.maxBouncesPerStep && remaining > 1e-7; iter++) {
      const dx = ball.dx * remaining;
      const dy = ball.dy * remaining;
      let bestT = 1;
      let bestNx = 0;
      let bestNy = 0;
      let kind: HitKind = HitKind.None;
      let bestBrick: Brick | null = null;
      const shieldT = dy < 0 ? (this.shieldY + r - ball.y) / dy : -1;
      const shieldX = ball.x + dx * shieldT;
      const shieldWillCatch = dy < 0 && this.shieldCharges > 0 && shieldT >= 0
        && shieldX + r >= this.shieldLeft && shieldX - r <= this.shieldRight;

      if (this.ballBoundary) {
        // While protected, let the ball cross the custom drain to reach the visible shield.
        // Solid walls still participate in the sweep.
        const result = sweepArea(ball.x, ball.y, dx, dy, r, this.ballBoundary, this.ballOrientation, hit, shieldWillCatch);
        if (result) {
          bestT = hit.t;
          bestNx = hit.nx;
          bestNy = hit.ny;
          kind = result === 'drain' ? HitKind.Drain : HitKind.Wall;
        }
      } else if (boundary.sweep(ball.x, ball.y, dx, dy, r, hit)) {
        // Walls: the world's arena boundary (the rectangle with rounded top corners, or a traced outline).
        bestT = hit.t;
        bestNx = hit.nx;
        bestNy = hit.ny;
        kind = HitKind.Wall;
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
      const reachX = this.grid.halfW + r + Math.abs(dx);
      const reachY = this.grid.halfH + r + Math.abs(dy);
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        if (!b.alive || !b.solid) continue;
        if (Math.abs(b.y - ball.y) > reachY || Math.abs(b.x - ball.x) > reachX) continue;
        if (sweepCircleAabb(ball.x, ball.y, dx, dy, r, b.x, b.y, this.grid.halfW, this.grid.halfH, hit) && hit.t < bestT) {
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
          sweepCircleAabb(rx * c + ry * s, -rx * s + ry * c, dx * c + dy * s, ldy, r, 0, 0, paddle.width / 2, PADDLE.halfH, hit) &&
          hit.t < bestT
        ) {
          bestT = hit.t;
          bestNx = hit.nx * c - hit.ny * s;
          bestNy = hit.nx * s + hit.ny * c;
          kind = HitKind.Paddle;
        }
      }

      // Boss
      if (
        boss.active &&
        sweepCircleCircle(ball.x, ball.y, dx, dy, r, boss.x, boss.y, boss.radius, hit) &&
        hit.t < bestT
      ) {
        bestT = hit.t;
        bestNx = hit.nx;
        bestNy = hit.ny;
        kind = HitKind.Boss;
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
          this.balls.release(ball);
          this.events.emit('ballLost', { x: ball.x, remaining: this.balls.activeCount });
          return;
        case HitKind.Wall:
          this.reflect(ball, bestNx, bestNy);
          this.events.emit('ballWall', { x: cx, y: cy, nx: bestNx, ny: bestNy });
          if (boundary.kind === 'outline') {
            // The minimum-vertical rule can turn a ball back into a sloping surface (a root flare, a branch
            // wave); then it leaves the other way vertically instead.
            if (ball.dx * bestNx + ball.dy * bestNy < 0) ball.dy = -ball.dy;
            if (bestT < 1e-6) wedged++;
            // Anti-stuck: a ball wedged in a concave spot within one step, or touching the outline again and
            // again without getting anywhere, is turned towards the middle of the arena.
            const centreY = (field.top + field.floorY) / 2;
            if (wedged >= 3) {
              this.trapGuard.free(ball, 0, centreY);
              this.fixDirection(ball);
              wedged = 0;
            } else if (this.trapGuard.onContact(ball, this.time, 0, centreY)) {
              this.fixDirection(ball);
            }
          }
          break;
        case HitKind.Shield:
          this.reflect(ball, bestNx, bestNy);
          this.shieldCharges--;
          this.events.emit('shieldHit', { x: ball.x, charges: this.shieldCharges });
          break;
        case HitKind.Brick: {
          const brick = bestBrick as Brick;
          const pierce = fire && brick.kind !== BrickKind.Steel;
          const dirX = ball.dx;
          const dirY = ball.dy;
          if (!pierce) this.reflect(ball, bestNx, bestNy);
          this.damageBrick(brick, pierce || refrakt ? 99 : 1, 'ball', cx, cy, bestNx, bestNy);
          if (refrakt && !brick.alive) this.refraktBurst(brick, dirX, dirY);
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
        case HitKind.Boss:
          this.reflect(ball, bestNx, bestNy);
          this.damageBoss(refrakt ? REFRAKT.bossDamage : fire ? 2 : 1, cx, cy);
          break;
      }
    }
  }

  /**
   * Classic arcade paddle: outgoing angle depends on where the ball lands, nudged by paddle motion and turned
   * towards the low end when clinging scarabs weigh one end down.
   */
  private paddleBounce(ball: Ball): void {
    const p = this.paddle;
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
    p.hitTime = this.time;
    this.speedBonus = Math.min(BALL.maxSpeedBonus, this.speedBonus + BALL.speedPerPaddleHit);
    this.setCombo(0);

    const caught = this.effectTime[PowerUpKind.Magnet] > 0;
    if (caught) {
      ball.stuck = true;
      ball.stuckOffset = ball.x - p.x;
      ball.stuckTime = 0;
    }
    this.events.emit('ballPaddle', { x: ball.x, y: ball.y - r, offset, caught });
    this.scarabs.crush(ball.x);
  }

  /** Resolves any residual overlap (moving paddle, bricks that appear or re-solidify on top of a ball). */
  private depenetrate(ball: Ball): void {
    const r = BALL.radius;
    const hit = this.hit;
    const bricks = this.bricks;
    const reachX = this.grid.halfW + r;
    const reachY = this.grid.halfH + r;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive || !b.solid) continue;
      if (Math.abs(b.y - ball.y) >= reachY || Math.abs(b.x - ball.x) >= reachX) continue;
      if (overlapCircleAabb(ball.x, ball.y, r, b.x, b.y, this.grid.halfW, this.grid.halfH, hit)) {
        ball.x += hit.nx * (hit.t + CONTACT_EPS);
        ball.y += hit.ny * (hit.t + CONTACT_EPS);
        this.reflect(ball, hit.nx, hit.ny);
      }
    }

    const p = this.paddle;
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

    if (this.ballBoundary) {
      // Residual overlaps after moving bricks/paddle. Never clamp against the old rectangular arena.
      if (pointInPolygon(ball, this.ballContour)) {
        for (let pass = 0; pass < 3; pass++) {
          for (const segment of this.ballBoundary) {
            if (segment.drain) continue;
            const closest = nearestOnSegment(ball, segment.a, segment.b);
            const d = distance(ball, closest);
            if (d > 1e-7 && d < r) {
              const nx = (ball.x - closest.x) / d, ny = (ball.y - closest.y) / d;
              ball.x += nx * (r - d + CONTACT_EPS); ball.y += ny * (r - d + CONTACT_EPS);
              this.reflect(ball, nx, ny);
            }
          }
        }
      }
      return;
    }
    this.depBall = ball;
    this.boundary.depenetrate(ball, r, this.reflectDepBall);
    this.depBall = null;
  }

  private loseLife(): void {
    this.setCombo(0);
    this.clearTransient();
    if (!this.demo) this.lives--;
    this.events.emit('lifeLost', { lives: this.lives });
    if (this.lives <= 0) {
      this.phase = 'over';
      this.events.emit('gameOver', { score: this.score });
    } else {
      this.phase = 'respawn';
      this.respawnTimer = PLAYER.respawnDelay;
    }
  }

  /** Clears everything that does not survive a life loss or a level change. */
  private clearTransient(): void {
    this.balls.releaseAll();
    this.drops.releaseAll();
    this.lasers.releaseAll();
    this.shots.releaseAll();
    this.effectTime.fill(0);
    if (this.refraktTime > 0) {
      this.refraktTime = 0;
      this.events.emit('refraktEnded', { cut: true });
    }
    this.shieldCharges = 0;
    this.speedBonus = 0;
    this.laserCooldown = 0;
    this.paddle.stun = 0;
    this.paddle.shove = 0;
    this.paddle.tilt = 0;
    this.paddle.slide = 0;
    this.paddle.lean = 0;
    this.paddle.hitTime = -10;
    this.hazards.reset();
    this.icicles.reset();
    this.scarabs.reset();
    this.combo = 0;
    this.multiplier = 1;
  }

  private setCombo(combo: number): void {
    if (combo === this.combo) return;
    this.combo = combo;
    if (combo > this.bestCombo) this.bestCombo = combo;
    this.multiplier = Math.min(PLAYER.maxMultiplier, 1 + Math.floor(combo / PLAYER.comboStep));
    this.events.emit('comboChanged', { combo, multiplier: this.multiplier });
  }

  // ------------------------------------------------------------------- bricks

  brickAt(col: number, row: number): Brick | null {
    if (col < 0 || col >= GRID.cols || row < 0 || row >= GRID.rows) return null;
    return this.bricks[row * GRID.cols + col];
  }

  private reviveBrick(brick: Brick, kind: BrickKind, spawnTime: number): void {
    brick.kind = kind;
    brick.hp = brick.maxHp = BRICK_HP[kind];
    brick.alive = true;
    brick.solid = true;
    brick.fuse = 0;
    brick.spawnTime = spawnTime;
    brick.hitTime = -10;
    if (kind !== BrickKind.Steel) this.bricksRemaining++;
  }

  private updateBricks(dt: number): void {
    const bricks = this.bricks;
    const time = this.time;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;
      if (b.kind === BrickKind.Phase) {
        const offset = ((b.col + b.row) & 1) * (PHASE_BRICK.period / 2);
        b.solid = (time + offset) % PHASE_BRICK.period < PHASE_BRICK.solidTime;
      }
      if (b.fuse > 0) {
        b.fuse -= dt;
        if (b.fuse <= 0) this.destroyBrick(b, 'explosion');
      }
    }
  }

  private damageBrick(
    brick: Brick,
    amount: number,
    cause: DamageCause,
    x: number,
    y: number,
    nx: number,
    ny: number,
  ): void {
    brick.hitTime = this.time;
    if (brick.kind === BrickKind.Steel) {
      this.events.emit('brickHit', { brick, x, y, nx, ny });
      return;
    }
    brick.hp -= amount;
    if (brick.hp <= 0) this.destroyBrick(brick, cause);
    else this.events.emit('brickHit', { brick, x, y, nx, ny });
  }

  private destroyBrick(brick: Brick, cause: DamageCause): void {
    if (!brick.alive) return;
    brick.alive = false;
    brick.fuse = 0;
    if (brick.kind !== BrickKind.Steel) this.bricksRemaining--;

    this.setCombo(this.combo + 1);
    const points = BRICK_POINTS[brick.kind] * this.multiplier;
    this.score += points;
    this.events.emit('brickDestroyed', { brick, cause, points, combo: this.combo });

    if (brick.kind === BrickKind.Explosive) {
      this.explode(brick);
    } else if (brick.kind === BrickKind.Prism) {
      // Refraction: the ball becomes spinning light for a while (another prism tops the timer back up).
      this.refraktTime = REFRAKT.duration;
      this.events.emit('refraktStarted', { x: brick.x, y: brick.y });
    } else if (brick.kind !== BrickKind.Steel) {
      this.maybeDrop(brick.x, brick.y);
    }
  }

  /** Refrakt: the shattered brick's light splashes onto the four bricks beside it. */
  private refraktBurst(source: Brick, dirX: number, dirY: number): void {
    this.events.emit('refraktBurst', { x: source.x, y: source.y, dirX, dirY });
    for (let i = 0; i < 4; i++) {
      const dc = i === 0 ? -1 : i === 1 ? 1 : 0;
      const dr = i === 2 ? -1 : i === 3 ? 1 : 0;
      const n = this.brickAt(source.col + dc, source.row + dr);
      if (!n || !n.alive || !n.solid) continue;
      // Rows count downwards, so the source sits at +y from a brick below it (dr = 1).
      this.damageBrick(n, REFRAKT.splashDamage, 'explosion', n.x - dc * this.grid.halfW, n.y + dr * this.grid.halfH, -dc, dr);
    }
  }

    private explode(source: Brick): void {
    this.events.emit('explosion', { x: source.x, y: source.y });
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const n = this.brickAt(source.col + dc, source.row + dr);
        if (!n || !n.alive) continue;
        if (n.kind === BrickKind.Explosive) {
          // Chain reactions ripple outwards instead of resolving in one frame.
          if (n.fuse <= 0) n.fuse = EXPLOSION.fuse;
        } else {
          this.destroyBrick(n, 'explosion');
        }
      }
    }
    const boss = this.boss;
    if (boss.active && Math.hypot(boss.x - source.x, boss.y - source.y) < EXPLOSION.bossRange + boss.radius) {
      this.damageBoss(EXPLOSION.bossDamage, boss.x, boss.y - boss.radius);
    }
  }

  private maybeDrop(x: number, y: number): void {
    if (this.phase === 'cleared' || this.drops.activeCount >= DROP.maxActive) return;
    if (this.dropsThisLevel >= DROP.maxPerLevel) return;
    if (!this.rng.chance(DROP.chance)) return;
    // Weighted pick restricted to the loadout. With every kind allowed this is exactly the original pick
    // (same RNG calls, same weights), so runs without a loadout are unchanged.
    const allowed = this.allowedKinds;
    let total = 0;
    let kind = PowerUpKind.Expand;
    let first = true;
    for (let k = 0; k < POWERUP_KIND_COUNT; k++) {
      if (!allowed[k]) continue;
      total += POWERUPS[k as PowerUpKind].weight;
      if (first) {
        kind = k as PowerUpKind;
        first = false;
      }
    }
    if (total <= 0) return;
    let roll = this.rng.next() * total;
    for (let k = 0; k < POWERUP_KIND_COUNT; k++) {
      if (!allowed[k]) continue;
      roll -= POWERUPS[k as PowerUpKind].weight;
      if (roll <= 0) {
        kind = k as PowerUpKind;
        break;
      }
    }
    const drop = this.drops.acquire();
    if (!drop) return;
    this.dropsThisLevel++;
    drop.kind = kind;
    drop.x = x;
    drop.y = drop.py = y;
  }

  private brickAtPoint(x: number, y: number): Brick | null {
    const col = Math.round(x / this.grid.cellW + (GRID.cols - 1) / 2);
    const row = Math.round((this.grid.topY - y) / this.grid.cellH);
    const b = this.brickAt(col, row);
    if (!b || !b.alive || !b.solid) return null;
    if (Math.abs(x - b.x) > this.grid.halfW || Math.abs(y - b.y) > this.grid.halfH) return null;
    return b;
  }

  // ------------------------------------------------------------------- lasers

  private updateLasers(dt: number): void {
    const paddle = this.paddle;
    if (this.effectTime[PowerUpKind.Laser] > 0 && this.phase === 'live' && paddle.stun <= 0) {
      this.laserCooldown -= dt;
      if (this.laserCooldown <= 0) {
        this.laserCooldown = LASER.cooldown;
        const inset = paddle.width / 2 - 0.45;
        this.fireLaser(paddle.x - inset);
        this.fireLaser(paddle.x + inset);
        this.events.emit('laserFired', { x: paddle.x, y: paddle.y });
      }
    }

    const boss = this.boss;
    for (const laser of this.lasers.items) {
      if (!laser.active) continue;
      laser.py = laser.y;
      laser.y += LASER.speed * dt;
      const tipY = laser.y + LASER.halfLength;
      if (beyondArch(laser.x, tipY, 0, this.field)) {
        this.lasers.release(laser);
        continue;
      }
      const brick = this.brickAtPoint(laser.x, tipY) ?? this.brickAtPoint(laser.x, laser.y);
      if (brick) {
        this.lasers.release(laser);
        this.events.emit('laserHit', { x: laser.x, y: brick.y - this.grid.halfH });
        this.damageBrick(brick, 1, 'laser', laser.x, brick.y - this.grid.halfH, 0, -1);
        continue;
      }
      if (boss.active && Math.hypot(laser.x - boss.x, tipY - boss.y) < boss.radius) {
        this.lasers.release(laser);
        this.events.emit('laserHit', { x: laser.x, y: tipY });
        this.damageBoss(LASER.bossDamage, laser.x, tipY);
      }
    }
  }

  private fireLaser(x: number): void {
    const laser = this.lasers.acquire();
    if (!laser) return;
    laser.x = x;
    laser.y = laser.py = this.paddle.y + PADDLE.halfH + LASER.halfLength;
  }

  // -------------------------------------------------------------------- drops

  private updateDrops(dt: number): void {
    const p = this.paddle;
    for (const drop of this.drops.items) {
      if (!drop.active) continue;
      drop.py = drop.y;
      drop.y -= DROP.speed * dt;
      if (
        Math.abs(drop.x - p.x) < p.width / 2 + DROP.halfW &&
        Math.abs(drop.y - p.y) < PADDLE.halfH + DROP.halfH
      ) {
        this.drops.release(drop);
        this.collect(drop.kind, drop.x, drop.y);
      } else if (drop.y < this.field.bottom) {
        this.drops.release(drop);
      }
    }
  }

  // --------------------------------------------------------------------- boss

  private updateBoss(dt: number): void {
    const boss = this.boss;
    const def = boss.def;
    const p = this.paddle;

    if (boss.active && def) {
      boss.px = boss.x;
      boss.py = boss.y;
      boss.t += dt * (1 + boss.stage * 0.35);
      boss.x = Math.sin(boss.t * def.swaySpeed) * def.sway;
      boss.y = def.y + Math.sin(boss.t * def.swaySpeed * 1.7) * 0.6;
      if (boss.invuln > 0) boss.invuln -= dt;

      if (this.phase === 'live') {
        boss.fireTimer -= dt;
        if (boss.fireTimer <= 0) {
          boss.fireTimer = def.fireInterval / (1 + boss.stage * BOSS_FIRE.stageSpeedup);
          this.bossFire(def.volley + boss.stage, def.shotSpeed + boss.stage * 1.5);
        }
        if (def.summonInterval > 0) {
          boss.summonTimer -= dt;
          if (boss.summonTimer <= 0) {
            boss.summonTimer = def.summonInterval;
            this.bossSummon();
          }
        }
      }
    }

    for (const shot of this.shots.items) {
      if (!shot.active) continue;
      shot.px = shot.x;
      shot.py = shot.y;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      if (shot.y < this.field.bottom || Math.abs(shot.x) > this.field.halfWidth || (this.shieldCharges > 0 && shot.y < this.shieldY && shot.x >= this.shieldLeft && shot.x <= this.shieldRight)) {
        this.shots.release(shot);
      } else if (overlapCircleAabb(shot.x, shot.y, SHOT.radius, p.x, p.y, p.width / 2, PADDLE.halfH, this.hit)) {
        this.shots.release(shot);
        p.stun = PADDLE.stunTime;
        this.events.emit('paddleStunned', { x: shot.x });
      }
    }
  }

  private bossFire(count: number, speed: number): void {
    const boss = this.boss;
    const originY = boss.y - boss.radius;
    const aim = Math.atan2(this.paddle.x - boss.x, -(this.paddle.y - originY));
    for (let i = 0; i < count; i++) {
      const shot = this.shots.acquire();
      if (!shot) break;
      const angle = aim + (i - (count - 1) / 2) * 0.24;
      shot.x = shot.px = boss.x;
      shot.y = shot.py = originY;
      shot.vx = Math.sin(angle) * speed;
      shot.vy = -Math.cos(angle) * speed;
    }
    this.events.emit('bossFired', { x: boss.x, y: originY });
  }

  /** Revives a few bricks in the rows beneath the boss. */
  private bossSummon(): void {
    const cells = this.scratchCells;
    cells.length = 0;
    for (let row = BOSS_SUMMON.firstRow; row <= BOSS_SUMMON.lastRow; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const b = this.bricks[row * GRID.cols + col];
        if (!b.alive) cells.push(b.index);
      }
    }
    const count = Math.min(cells.length, BOSS_SUMMON.perWave);
    for (let i = 0; i < count; i++) {
      const pick = this.rng.int(cells.length);
      const brick = this.bricks[cells[pick]];
      cells[pick] = cells[cells.length - 1];
      cells.length--;
      this.reviveBrick(brick, this.boss.stage > 0 ? BrickKind.Tough : BrickKind.Normal, this.time);
      this.events.emit('brickSpawned', { brick });
    }
  }

  private damageBoss(amount: number, x: number, y: number): void {
    const boss = this.boss;
    if (!boss.active || boss.invuln > 0) return;
    boss.invuln = 0.06;
    boss.hp -= amount;
    boss.hitTime = this.time;
    this.score += 40 * this.multiplier;
    this.events.emit('bossHit', { x, y, hp: Math.max(0, boss.hp), maxHp: boss.maxHp });

    if (boss.hp <= 0) {
      boss.active = false;
      this.shots.releaseAll();
      const points = boss.def?.points ?? 0;
      this.score += points;
      this.events.emit('bossDefeated', { x: boss.x, y: boss.y, points });
      return;
    }
    const frac = boss.hp / boss.maxHp;
    const stage = frac < 0.3 ? 2 : frac < 0.65 ? 1 : 0;
    if (stage !== boss.stage) {
      boss.stage = stage;
      this.events.emit('bossStage', { stage });
    }
  }

  // ------------------------------------------------------------------ outcome

  private checkCleared(): void {
    if (this.phase === 'cleared' || this.phase === 'over') return;
    const cleared = this.boss.def ? !this.boss.active : this.bricksRemaining <= 0;
    if (!cleared) return;
    this.phase = 'cleared';
    const bonus = this.demo ? 0 : 1000 * (this.levelIndex + 1) + this.lives * 250;
    this.score += bonus;
    this.events.emit('levelCleared', { index: this.levelIndex, bonus });
  }
}
