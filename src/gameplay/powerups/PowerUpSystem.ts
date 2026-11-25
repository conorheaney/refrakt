import { DROP, LASER, PADDLE, POWER_WARN, POWERUP_SCORE } from '../config';
import { Pool } from '../../engine/core/Pool';
import { POWERUP_KIND_COUNT, PowerUpKind, type Drop, type Laser } from '../types';
import type { WorldContext } from '../WorldContext';
import { POWERUPS, type PowerUpFlag } from './powerUps';

/**
 * Power-ups in play: falling drops, pickup, the timers of timed kinds and their effects, the player's loadout,
 * and the Laser power's shots. What each kind does lives in POWERUPS (powerups/powerUps.ts). Owned by World.
 */
export class PowerUpSystem {
  /** Remaining seconds for each timed power-up, indexed by PowerUpKind. */
  readonly effectTime = new Float32Array(POWERUP_KIND_COUNT);
  readonly drops = new Pool<Drop>(DROP.capacity, () => ({ active: false, kind: PowerUpKind.Expand, x: 0, y: 0, py: 0 }));
  readonly lasers = new Pool<Laser>(LASER.capacity, () => ({ active: false, x: 0, y: 0, py: 0 }));
  /** Power-up kinds allowed to drop (1 = allowed), indexed by PowerUpKind; see setLoadout. */
  private readonly allowedKinds = new Uint8Array(POWERUP_KIND_COUNT).fill(1);
  private loadoutKinds: readonly PowerUpKind[] | null = null;
  /** Power-ups released so far in the current level (capped by DROP.maxPerLevel). */
  private dropsThisLevel = 0;
  private laserCooldown = 0;

  constructor(private readonly world: WorldContext) {}

  has(kind: PowerUpKind): boolean {
    return this.effectTime[kind] > 0;
  }

  /** True while any running power-up grants `flag` (see PowerUpModifiers). */
  grants(flag: PowerUpFlag): boolean {
    const effects = this.effectTime;
    for (let kind = 0; kind < effects.length; kind++) {
      if (effects[kind] > 0 && POWERUPS[kind as PowerUpKind].modifiers?.[flag]) return true;
    }
    return false;
  }

  /** The product of every running power-up's ball speed scale (1 when none). */
  get ballSpeedScale(): number {
    const effects = this.effectTime;
    let scale = 1;
    for (let kind = 0; kind < effects.length; kind++) {
      if (effects[kind] > 0) scale *= POWERUPS[kind as PowerUpKind].modifiers?.ballSpeedScale ?? 1;
    }
    return scale;
  }

  /** The power-up kinds allowed to drop, or null when every kind is allowed (the default). */
  get loadout(): readonly PowerUpKind[] | null {
    return this.loadoutKinds;
  }

  /** See World.setLoadout. */
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

  /** A new level: its drop allowance starts over. */
  startLevel(): void {
    this.dropsThisLevel = 0;
  }

  /** Ends every effect and clears drops and lasers (a life lost or a level change). */
  clear(): void {
    this.drops.releaseAll();
    this.lasers.releaseAll();
    this.effectTime.fill(0);
    this.laserCooldown = 0;
  }

  /** Counts timed effects down, warning near the end and running each kind's expiry. */
  updateEffects(dt: number): void {
    const world = this.world;
    const effects = this.effectTime;
    for (let kind = 0; kind < effects.length; kind++) {
      if (effects[kind] <= 0) continue;
      const before = Math.ceil(effects[kind]);
      effects[kind] -= dt;
      const after = Math.ceil(effects[kind]);
      if (effects[kind] > 0 && after < before && after <= POWER_WARN) {
        world.events.emit('powerUpWarning', { kind: kind as PowerUpKind, left: after, x: world.paddle.x });
      }
      if (effects[kind] <= 0) {
        effects[kind] = 0;
        world.events.emit('powerUpExpired', { kind: kind as PowerUpKind, x: world.paddle.x });
        POWERUPS[kind as PowerUpKind].onExpire?.(world);
      }
    }
  }

  collect(kind: PowerUpKind, x: number, y: number): void {
    const def = POWERUPS[kind];
    if (def.duration > 0) this.effectTime[kind] = def.duration;
    def.onCollect?.(this.world, x, y);
    this.world.score += POWERUP_SCORE;
    this.world.events.emit('powerUpCollected', { kind, x, y });
  }

  /** A brick broke at (x, y): maybe release a power-up from the loadout. */
  maybeDrop(x: number, y: number): void {
    const world = this.world;
    if (world.phase === 'cleared' || this.drops.activeCount >= DROP.maxActive) return;
    if (this.dropsThisLevel >= DROP.maxPerLevel) return;
    if (!world.rng.chance(DROP.chance)) return;
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
    let roll = world.rng.next() * total;
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

  updateDrops(dt: number): void {
    const p = this.world.paddle;
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
      } else if (drop.y < this.world.lowerLimit) {
        this.drops.release(drop);
      }
    }
  }

  /** Fires while a power-up grants lasers, and moves the shots already in the air. */
  updateLasers(dt: number): void {
    const world = this.world;
    const paddle = world.paddle;
    if (this.grants('lasers') && world.phase === 'live' && paddle.stun <= 0) {
      this.laserCooldown -= dt;
      if (this.laserCooldown <= 0) {
        this.laserCooldown = LASER.cooldown;
        const inset = paddle.width / 2 - 0.45;
        this.fireLaser(paddle.x - inset);
        this.fireLaser(paddle.x + inset);
        world.events.emit('laserFired', { x: paddle.x, y: paddle.y });
      }
    }

    const boss = world.bossSystem.boss;
    const bricks = world.brickField;
    const halfH = world.grid.halfH;
    const top = world.boundary.bounds.top;
    for (const laser of this.lasers.items) {
      if (!laser.active) continue;
      laser.py = laser.y;
      laser.y += LASER.speed * dt;
      const tipY = laser.y + LASER.halfLength;
      if (tipY > top) {
        this.lasers.release(laser);
        continue;
      }
      const brick = bricks.atPoint(laser.x, tipY) ?? bricks.atPoint(laser.x, laser.y);
      if (brick) {
        this.lasers.release(laser);
        world.events.emit('laserHit', { x: laser.x, y: brick.y - halfH });
        bricks.damage(brick, 1, 'laser', laser.x, brick.y - halfH, 0, -1);
        continue;
      }
      if (boss.active && Math.hypot(laser.x - boss.x, tipY - boss.y) < boss.radius) {
        this.lasers.release(laser);
        world.events.emit('laserHit', { x: laser.x, y: tipY });
        world.bossSystem.damage(LASER.bossDamage, laser.x, tipY);
      }
    }
  }

  private fireLaser(x: number): void {
    const laser = this.lasers.acquire();
    if (!laser) return;
    laser.x = x;
    laser.y = laser.py = this.world.paddle.y + PADDLE.halfH + LASER.halfLength;
  }
}
