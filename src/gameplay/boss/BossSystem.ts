import { BOSS_FIRE, BOSS_SUMMON, EXPLOSION, GRID, PADDLE, SHOT } from '../config';
import { Pool } from '../../engine/core/Pool';
import { overlapCircleAabb, type SweepHit } from '../arena/collision';
import { BrickKind, type Boss, type BossDef, type Shot } from '../types';
import type { WorldContext } from '../WorldContext';

/** A level's boss: movement, volleys at the paddle, brick summons and damage. Owned by World. */
export class BossSystem {
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
  readonly shots = new Pool<Shot>(SHOT.capacity, () => ({ active: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 }));
  private readonly hit: SweepHit = { t: 0, nx: 0, ny: 0 };
  private readonly scratchCells: number[] = [];

  constructor(private readonly world: WorldContext) {}

  /** Sets up the level's boss, or none. */
  load(def: BossDef | null): void {
    const boss = this.boss;
    boss.def = def;
    boss.active = def !== null;
    if (!def) return;
    boss.radius = def.radius;
    boss.hp = def.hp;
    boss.maxHp = def.hp;
    boss.stage = 0;
    boss.t = 0;
    boss.x = boss.px = 0;
    boss.y = boss.py = def.y;
    boss.fireTimer = def.fireInterval + BOSS_FIRE.openingDelay;
    boss.summonTimer = def.summonInterval;
    boss.invuln = 0;
    boss.hitTime = -10;
  }

  update(dt: number): void {
    const world = this.world;
    const boss = this.boss;
    const def = boss.def;
    const p = world.paddle;

    if (boss.active && def) {
      boss.px = boss.x;
      boss.py = boss.y;
      boss.t += dt * (1 + boss.stage * 0.35);
      boss.x = Math.sin(boss.t * def.swaySpeed) * def.sway;
      boss.y = def.y + Math.sin(boss.t * def.swaySpeed * 1.7) * 0.6;
      if (boss.invuln > 0) boss.invuln -= dt;

      if (world.phase === 'live') {
        boss.fireTimer -= dt;
        if (boss.fireTimer <= 0) {
          boss.fireTimer = def.fireInterval / (1 + boss.stage * BOSS_FIRE.stageSpeedup);
          this.fire(def.volley + boss.stage, def.shotSpeed + boss.stage * 1.5);
        }
        if (def.summonInterval > 0) {
          boss.summonTimer -= dt;
          if (boss.summonTimer <= 0) {
            boss.summonTimer = def.summonInterval;
            this.summon();
          }
        }
      }
    }

    const bounds = world.boundary.bounds;
    const lower = world.lowerLimit;
    for (const shot of this.shots.items) {
      if (!shot.active) continue;
      shot.px = shot.x;
      shot.py = shot.y;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      if (shot.y < lower || shot.x < bounds.left || shot.x > bounds.right || (world.shieldCharges > 0 && shot.y < world.shieldY && shot.x >= world.shieldLeft && shot.x <= world.shieldRight)) {
        this.shots.release(shot);
      } else if (overlapCircleAabb(shot.x, shot.y, SHOT.radius, p.x, p.y, p.width / 2, PADDLE.halfH, this.hit)) {
        this.shots.release(shot);
        p.stun = PADDLE.stunTime;
        world.events.emit('paddleStunned', { x: shot.x });
      }
    }
  }

  damage(amount: number, x: number, y: number): void {
    const world = this.world;
    const boss = this.boss;
    if (!boss.active || boss.invuln > 0) return;
    boss.invuln = 0.06;
    boss.hp -= amount;
    boss.hitTime = world.time;
    world.score += 40 * world.multiplier;
    world.events.emit('bossHit', { x, y, hp: Math.max(0, boss.hp), maxHp: boss.maxHp });

    if (boss.hp <= 0) {
      boss.active = false;
      this.shots.releaseAll();
      const points = boss.def?.points ?? 0;
      world.score += points;
      world.events.emit('bossDefeated', { x: boss.x, y: boss.y, points });
      return;
    }
    const frac = boss.hp / boss.maxHp;
    const stage = frac < 0.3 ? 2 : frac < 0.65 ? 1 : 0;
    if (stage !== boss.stage) {
      boss.stage = stage;
      world.events.emit('bossStage', { stage });
    }
  }

  /** An explosive brick went off at (x, y): the boss takes damage when within range. */
  explosionAt(x: number, y: number): void {
    const boss = this.boss;
    if (boss.active && Math.hypot(boss.x - x, boss.y - y) < EXPLOSION.bossRange + boss.radius) {
      this.damage(EXPLOSION.bossDamage, boss.x, boss.y - boss.radius);
    }
  }

  private fire(count: number, speed: number): void {
    const boss = this.boss;
    const paddle = this.world.paddle;
    const originY = boss.y - boss.radius;
    const aim = Math.atan2(paddle.x - boss.x, -(paddle.y - originY));
    for (let i = 0; i < count; i++) {
      const shot = this.shots.acquire();
      if (!shot) break;
      const angle = aim + (i - (count - 1) / 2) * 0.24;
      shot.x = shot.px = boss.x;
      shot.y = shot.py = originY;
      shot.vx = Math.sin(angle) * speed;
      shot.vy = -Math.cos(angle) * speed;
    }
    this.world.events.emit('bossFired', { x: boss.x, y: originY });
  }

  /** Revives a few bricks in the rows beneath the boss. */
  private summon(): void {
    const world = this.world;
    const field = world.brickField;
    const cells = this.scratchCells;
    cells.length = 0;
    for (let row = BOSS_SUMMON.firstRow; row <= BOSS_SUMMON.lastRow; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const b = field.bricks[row * GRID.cols + col];
        if (!b.alive) cells.push(b.index);
      }
    }
    const count = Math.min(cells.length, BOSS_SUMMON.perWave);
    for (let i = 0; i < count; i++) {
      const pick = world.rng.int(cells.length);
      const brick = field.bricks[cells[pick]];
      cells[pick] = cells[cells.length - 1];
      cells.length--;
      field.revive(brick, this.boss.stage > 0 ? BrickKind.Tough : BrickKind.Normal, world.time);
      world.events.emit('brickSpawned', { brick });
    }
  }
}
