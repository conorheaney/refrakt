import { BRICK_HP, BRICK_POINTS, EXPLOSION, GRID, PHASE_BRICK, REFRAKT, type GridDef } from '../config';
import type { LevelCell } from '../../content/levels';
import { BrickKind, type Brick, type DamageCause } from '../types';
import type { WorldContext } from '../WorldContext';

/** The level's bricks: layout, damage, explosions and Refrakt's splash. Owned by World. */
export class BrickField {
  readonly bricks: readonly Brick[];
  /** Breakable bricks still standing (steel never counts). */
  remaining = 0;
  /** Breakable bricks the level started with. */
  total = 0;

  constructor(private readonly world: WorldContext, grid: GridDef) {
    const bricks: Brick[] = [];
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        bricks.push({
          index: row * GRID.cols + col,
          col,
          row,
          x: (col - (GRID.cols - 1) / 2) * grid.cellW,
          y: grid.topY - row * grid.cellH,
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
  }

  /** Re-places every cell for a world's grid. */
  layout(grid: GridDef): void {
    for (const b of this.bricks) {
      b.x = (b.col - (grid.cols - 1) / 2) * grid.cellW;
      b.y = grid.topY - b.row * grid.cellH;
    }
  }

  /** Clears the field and builds a level's formation (bricks pop in row by row from `time`). */
  load(cells: readonly LevelCell[], time: number): void {
    for (const brick of this.bricks) {
      brick.alive = false;
      brick.fuse = 0;
    }
    this.remaining = 0;
    for (const cell of cells) {
      const brick = this.bricks[cell.row * GRID.cols + cell.col];
      this.revive(brick, cell.kind, time + 0.15 + cell.row * 0.045 + cell.col * 0.02);
    }
    this.total = this.remaining;
  }

  at(col: number, row: number): Brick | null {
    if (col < 0 || col >= GRID.cols || row < 0 || row >= GRID.rows) return null;
    return this.bricks[row * GRID.cols + col];
  }

  /** The solid brick covering (x, y), if any. */
  atPoint(x: number, y: number): Brick | null {
    const grid = this.world.grid;
    const col = Math.round(x / grid.cellW + (GRID.cols - 1) / 2);
    const row = Math.round((grid.topY - y) / grid.cellH);
    const b = this.at(col, row);
    if (!b || !b.alive || !b.solid) return null;
    if (Math.abs(x - b.x) > grid.halfW || Math.abs(y - b.y) > grid.halfH) return null;
    return b;
  }

  revive(brick: Brick, kind: BrickKind, spawnTime: number): void {
    brick.kind = kind;
    brick.hp = brick.maxHp = BRICK_HP[kind];
    brick.alive = true;
    brick.solid = true;
    brick.fuse = 0;
    brick.spawnTime = spawnTime;
    brick.hitTime = -10;
    if (kind !== BrickKind.Steel) this.remaining++;
  }

  update(dt: number): void {
    const bricks = this.bricks;
    const time = this.world.time;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;
      if (b.kind === BrickKind.Phase) {
        const offset = ((b.col + b.row) & 1) * (PHASE_BRICK.period / 2);
        b.solid = (time + offset) % PHASE_BRICK.period < PHASE_BRICK.solidTime;
      }
      if (b.fuse > 0) {
        b.fuse -= dt;
        if (b.fuse <= 0) this.destroy(b, 'explosion');
      }
    }
  }

  damage(brick: Brick, amount: number, cause: DamageCause, x: number, y: number, nx: number, ny: number): void {
    const world = this.world;
    brick.hitTime = world.time;
    if (brick.kind === BrickKind.Steel) {
      world.events.emit('brickHit', { brick, x, y, nx, ny });
      return;
    }
    brick.hp -= amount;
    if (brick.hp <= 0) this.destroy(brick, cause);
    else world.events.emit('brickHit', { brick, x, y, nx, ny });
  }

  destroy(brick: Brick, cause: DamageCause): void {
    if (!brick.alive) return;
    const world = this.world;
    brick.alive = false;
    brick.fuse = 0;
    if (brick.kind !== BrickKind.Steel) this.remaining--;

    world.setCombo(world.combo + 1);
    const points = BRICK_POINTS[brick.kind] * world.multiplier;
    world.score += points;
    world.events.emit('brickDestroyed', { brick, cause, points, combo: world.combo });

    if (brick.kind === BrickKind.Explosive) {
      this.explode(brick);
    } else if (brick.kind === BrickKind.Prism) {
      // Refraction: the ball becomes spinning light for a while (another prism tops the timer back up).
      world.refraktTime = REFRAKT.duration;
      world.events.emit('refraktStarted', { x: brick.x, y: brick.y });
    } else if (brick.kind !== BrickKind.Steel) {
      world.powerUps.maybeDrop(brick.x, brick.y);
    }
  }

  /** Refrakt: the shattered brick's light splashes onto the four bricks beside it. */
  refraktBurst(source: Brick, dirX: number, dirY: number): void {
    const grid = this.world.grid;
    this.world.events.emit('refraktBurst', { x: source.x, y: source.y, dirX, dirY });
    for (let i = 0; i < 4; i++) {
      const dc = i === 0 ? -1 : i === 1 ? 1 : 0;
      const dr = i === 2 ? -1 : i === 3 ? 1 : 0;
      const n = this.at(source.col + dc, source.row + dr);
      if (!n || !n.alive || !n.solid) continue;
      // Rows count downwards, so the source sits at +y from a brick below it (dr = 1).
      this.damage(n, REFRAKT.splashDamage, 'explosion', n.x - dc * grid.halfW, n.y + dr * grid.halfH, -dc, dr);
    }
  }

  private explode(source: Brick): void {
    this.world.events.emit('explosion', { x: source.x, y: source.y });
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const n = this.at(source.col + dc, source.row + dr);
        if (!n || !n.alive) continue;
        if (n.kind === BrickKind.Explosive) {
          // Chain reactions ripple outwards instead of resolving in one frame.
          if (n.fuse <= 0) n.fuse = EXPLOSION.fuse;
        } else {
          this.destroy(n, 'explosion');
        }
      }
    }
    this.world.bossSystem.explosionAt(source.x, source.y);
  }
}
