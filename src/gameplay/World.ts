import { BALL, BITE, FIELD, type FieldDef, GRID, ICICLE, type GridDef, PADDLE, PLAYER } from './config';
import { BUILTIN_CAMPAIGN, type Campaign } from '../content/campaign';
import { STAGES_PER_WORLD, type WorldDef } from '../content/worlds';
import type { HazardSystem } from './hazards/hazards';
import { SnakeSystem } from './hazards/snakes/snakes';
import { IcicleSystem } from './hazards/icicles/icicles';
import { ScarabSystem } from './hazards/scarabs/scarabs';
import { areaContour, clampToSpans, findPaddleLane, paddleIntervals, type Interval, type Point } from './arena/playAreas';
import { EventBus } from '../engine/core/EventBus';
import { clamp } from '../engine/core/math';
import { Pool } from '../engine/core/Pool';
import { Random } from '../engine/core/Random';
import { createBoundary, RectBoundary, type ArenaBoundary, type BoundaryKind } from './arena/boundary';
import { BallPhysics } from './balls/BallPhysics';
import { BossSystem } from './boss/BossSystem';
import { BrickField } from './bricks/BrickField';
import { PowerUpSystem } from './powerups/PowerUpSystem';
import type { GameEvents } from './events';
import type { WorldContext } from './WorldContext';
import type { Ball, Boss, Brick, Drop, Laser, Paddle, PowerUpKind, Shot, WorldPhase } from './types';

export { beyondArch } from './arena/boundary';

/** Per-step player intent. Sampled by the game loop, consumed by the simulation. */
export interface StepInput {
  /** Absolute paddle target (pointer / AI), or null when unused. */
  targetX: number | null;
  /** Keyboard axis in [-1, 1]; takes priority over targetX when non-zero. */
  axis: number;
  /** Launch / release, true for a single step. */
  action: boolean;
}

/**
 * The complete, renderer-agnostic game simulation.
 *
 * - Advances only through `step(dt, input)` with a fixed dt, so it is
 *   deterministic for a given seed and input stream.
 * - Owns every entity in preallocated pools; no allocation happens per step
 *   apart from event payloads.
 * - Communicates outward exclusively through `events`.
 *
 * World runs the level (loading, the paddle, scoring, lives and the outcome) and coordinates its systems,
 * each handed the WorldContext it works through: BallPhysics (balls), BrickField (bricks), PowerUpSystem
 * (drops, timed effects, lasers), BossSystem (the boss and its shots) and the hazard systems.
 */
export class World implements WorldContext {
  readonly events = new EventBus<GameEvents>();
  readonly paddle: Paddle = { x: 0, px: 0, y: PADDLE.y, width: PADDLE.width, vx: 0, stun: 0, shove: 0, tilt: 0, slide: 0, lean: 0, hitTime: -10 };
  readonly balls = new Pool<Ball>(BALL.capacity, () => ({
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

  /** The simulation's main random stream (launch angles, drops, boss summons). */
  readonly rng = new Random(1);
  /** Hazards draw from their own stream, so adding enemies to a world never changes its power-up rolls. */
  private readonly hazardRng = new Random(2);

  readonly ballPhysics = new BallPhysics(this);
  readonly brickField = new BrickField(this, GRID);
  readonly powerUps = new PowerUpSystem(this);
  readonly bossSystem = new BossSystem(this);
  /** The current world's wall snakes (gameplay/hazards/snakes/snakes.ts); empty in worlds without any. */
  readonly snakes = new SnakeSystem(this.hazardRng, this.events);
  /** The current world's falling icicles (gameplay/hazards/icicles/icicles.ts); empty in worlds without any. */
  readonly icicles = new IcicleSystem(this.hazardRng, this.events);
  /** The current world's scarab nests and swarms (gameplay/hazards/scarabs/scarabs.ts); empty in worlds without any. */
  readonly scarabs = new ScarabSystem(this.hazardRng, this.events);
  /**
   * Every hazard system, loaded, reset and stepped alike (gameplay/hazards/hazards.ts). The order is part of
   * the simulation: they share hazardRng, so reordering changes every seeded run.
   */
  readonly hazardSystems: readonly HazardSystem[] = [this.snakes, this.icicles, this.scarabs];

  readonly bricks: readonly Brick[] = this.brickField.bricks;
  readonly boss: Boss = this.bossSystem.boss;
  readonly shots: Pool<Shot> = this.bossSystem.shots;
  readonly drops: Pool<Drop> = this.powerUps.drops;
  readonly lasers: Pool<Laser> = this.powerUps.lasers;
  /** Remaining seconds for each timed power-up, indexed by PowerUpKind. */
  readonly effectTime = this.powerUps.effectTime;

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
    return this.paddleSpan ? this.paddleSpan[0] - this.worldDefValue.paddleExpandedWidth / 2 : -this.field.paddleReach;
  }
  get shieldRight(): number {
    return this.paddleSpan ? this.paddleSpan[1] + this.worldDefValue.paddleExpandedWidth / 2 : this.field.paddleReach;
  }
  score = 0;
  lives: number = PLAYER.lives;
  combo = 0;
  bestCombo = 0;
  multiplier = 1;
  levelIndex = 0;
  time = 0;
  phase: WorldPhase = 'serve';
  /** Attract mode: infinite lives, auto-launch, no score bonuses. */
  demo = false;

  /** Arena bounds for the current level's world (see WorldDef). */
  field: FieldDef = FIELD;
  /** Brick cell size and placement for the current level's world (see WorldDef). */
  grid: GridDef = GRID;
  /** What the ball bounces off in the current world (gameplay/arena/boundary.ts): the field's rectangle or a traced outline. */
  boundary: ArenaBoundary = new RectBoundary(FIELD);
  private paddleContour: Point[] | null = null;
  private paddleSpan: Interval | null = null;
  /** The worlds and levels this game plays (see setCampaign). */
  private campaignValue: Campaign;
  /** The current level's world: arena, brick grid, paddle size and serve gap. */
  private worldDefValue: WorldDef;
  /** Runtime override of every world's boundary (`?boundary=`, see Game); null uses each world's own. */
  private boundaryOverride: BoundaryKind | null = null;
  private respawnTimer = 0;

  constructor(campaign: Campaign = BUILTIN_CAMPAIGN) {
    this.campaignValue = campaign;
    this.worldDefValue = campaign.worldDefAt(0);
  }

  // ---------------------------------------------------------------- lifecycle

  /** The worlds and levels this game plays. */
  get campaign(): Campaign {
    return this.campaignValue;
  }

  /**
   * Swaps in another campaign (the editor's live preview rebuilds its world on every change). Takes effect on
   * the next loadLevel/newGame.
   */
  setCampaign(campaign: Campaign): void {
    this.campaignValue = campaign;
  }

  /** The current level's world: arena, brick grid, paddle size and serve gap. */
  get worldDef(): WorldDef {
    return this.worldDefValue;
  }

  get levelCount(): number {
    return this.campaignValue.levelCount;
  }

  get bricksRemaining(): number {
    return this.brickField.remaining;
  }

  get bricksTotal(): number {
    return this.brickField.total;
  }

  get ballSpeed(): number {
    return this.ballPhysics.speed;
  }

  /** True when the world has a drawn paddle lane (the paddle may sit off the default line). */
  get hasPaddleLane(): boolean {
    return this.paddleContour !== null;
  }

  hasEffect(kind: PowerUpKind): boolean {
    return this.powerUps.has(kind);
  }

  /** The power-up kinds allowed to drop, or null when every kind is allowed (the default). */
  get loadout(): readonly PowerUpKind[] | null {
    return this.powerUps.loadout;
  }

  /**
   * Restricts which power-up kinds can drop (every drop source goes through maybeDrop). Drop chance and
   * caps are unchanged; only the pool of kinds is filtered. Pass null to allow every kind. The loadout
   * persists across levels until changed; the game sets it before each level starts.
   */
  setLoadout(kinds: readonly PowerUpKind[] | null): void {
    this.powerUps.setLoadout(kinds);
  }

  brickAt(col: number, row: number): Brick | null {
    return this.brickField.at(col, row);
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
    const campaign = this.campaignValue;
    const count = campaign.levelCount;
    const levelIndex = ((index % count) + count) % count;
    const def = campaign.level(levelIndex);
    const entry = campaign.worldAt(levelIndex);
    this.levelIndex = levelIndex;
    this.setWorldDef(entry.def);
    const areas = entry.playAreas;
    this.ballPhysics.setArea(areas?.ball);
    this.paddleContour = areas?.paddle ? areaContour(areas.paddle) : null;
    this.paddleSpan = null;
    this.paddle.y = PADDLE.y;
    if (areas?.paddle) {
      const lane = findPaddleLane(areas.paddle, this.worldDefValue.paddleExpandedWidth, PADDLE.halfH);
      this.paddle.y = lane.y;
      // Keep movement in one connected lane, never teleport across holes in a concave polygon.
      this.paddleSpan = lane.spans.reduce((best, span) => span[1] - span[0] > best[1] - best[0] ? span : best);
      const spans = this.currentPaddleSpans();
      this.paddle.x = this.paddle.px = clampToSpans(this.paddle.x, spans);
    }
    this.clearTransient();
    const difficulty = (levelIndex % STAGES_PER_WORLD) / (STAGES_PER_WORLD - 1);
    for (const system of this.hazardSystems) system.load(entry.hazards, difficulty);
    this.powerUps.startLevel();
    this.brickField.load(campaign.levelCells(levelIndex), this.time);
    this.bossSystem.load(def.boss ?? null);
    this.ballPhysics.startLevel(levelIndex);
    this.phase = 'serve';
    this.ballPhysics.serve();
    this.events.emit('levelLoaded', { index: levelIndex, name: def.name, boss: this.boss.active });
  }

  /** Adopts a world's arena, brick grid and paddle size (bricks are re-placed; the paddle snaps to its width). */
  private setWorldDef(def: WorldDef): void {
    if (def === this.worldDefValue && def.grid === this.grid && def.field === this.field) return;
    this.worldDefValue = def;
    this.field = def.field;
    this.boundary = createBoundary(def, this.boundaryOverride);
    this.grid = def.grid;
    this.brickField.layout(def.grid);
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
    this.boundary = createBoundary(this.worldDefValue, kind);
    this.ballPhysics.trapGuard.reset();
  }

  // --------------------------------------------------------------------- step

  step(dt: number, input: StepInput): void {
    if (this.phase === 'over') return;
    this.time += dt;
    this.updateRefrakt(dt);
    this.powerUps.updateEffects(dt);
    this.updatePaddle(dt, input);

    if (this.phase === 'respawn') {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.phase = 'serve';
        this.ballPhysics.serve();
      }
    }
    if (input.action) this.ballPhysics.launchStuck();

    this.brickField.update(dt);
    this.ballPhysics.update(dt);
    this.powerUps.updateLasers(dt);
    this.powerUps.updateDrops(dt);
    this.bossSystem.update(dt);
    const live = this.phase === 'live';
    for (const system of this.hazardSystems) this.score += system.update(dt, this.paddle, this.balls.items, live);
    this.checkCleared();
  }

  private updateRefrakt(dt: number): void {
    if (this.refraktTime > 0) {
      this.refraktTime = Math.max(0, this.refraktTime - dt);
      if (this.refraktTime === 0) this.events.emit('refraktEnded', { cut: false });
    }
  }

  // ------------------------------------------------------------------- paddle

  private updatePaddle(dt: number, input: StepInput): void {
    const p = this.paddle;
    p.px = p.x;
    const targetWidth = this.powerUps.grants('widePaddle') ? this.worldDefValue.paddleExpandedWidth : this.worldDefValue.paddleWidth;
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

  private currentPaddleSpans(): Interval[] {
    if (!this.paddleContour || !this.paddleSpan) return [];
    const centre = (this.paddleSpan[0] + this.paddleSpan[1]) / 2;
    return paddleIntervals(this.paddleContour, this.paddle.y, this.paddle.width, PADDLE.halfH).filter(([a, b]) => a <= centre && b >= centre);
  }

  // ------------------------------------------------------------ lives, score

  loseLife(): void {
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
    this.powerUps.clear();
    this.bossSystem.shots.releaseAll();
    if (this.refraktTime > 0) {
      this.refraktTime = 0;
      this.events.emit('refraktEnded', { cut: true });
    }
    this.shieldCharges = 0;
    this.ballPhysics.clearBonus();
    this.paddle.stun = 0;
    this.paddle.shove = 0;
    this.paddle.tilt = 0;
    this.paddle.slide = 0;
    this.paddle.lean = 0;
    this.paddle.hitTime = -10;
    for (const system of this.hazardSystems) system.reset();
    this.combo = 0;
    this.multiplier = 1;
  }

  setCombo(combo: number): void {
    if (combo === this.combo) return;
    this.combo = combo;
    if (combo > this.bestCombo) this.bestCombo = combo;
    this.multiplier = Math.min(PLAYER.maxMultiplier, 1 + Math.floor(combo / PLAYER.comboStep));
    this.events.emit('comboChanged', { combo, multiplier: this.multiplier });
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
