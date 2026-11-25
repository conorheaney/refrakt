import type { SweepHit } from './collision';
import { areaSegments, polygonSignedArea, type BallArea } from './playAreas';
import type { Ball } from '../types';

/** What a sweep hit: nothing, a solid wall, or the drain (the open edge balls are lost through). */
export enum Contact {
  None = 0,
  Wall = 1,
  Drain = 2,
}

/** Axis-aligned extents of a world's ball area. */
export interface ArenaBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const CONTACT_EPS = 1e-4;

/**
 * The walls the ball bounces off: a world's drawn ball area (gameplay/arena/playAreas.ts), with its rounded
 * corners sampled into segments once, when the level loads. Segment data sits in flat typed arrays and every
 * query starts with a bounding-box reject, so stepping allocates nothing and touches few segments.
 *
 * The drain edge is open: the ball's centre crossing it means the ball is lost (unless the caller asks to let
 * it through, e.g. to reach the barrier below a high drain).
 */
export class PolygonBoundary {
  readonly bounds: ArenaBounds;
  /** Centroid of the area: where TrapGuard turns a trapped ball. */
  readonly centreX: number;
  readonly centreY: number;
  /** Segment i runs from (ax[i], ay[i]) to (bx[i], by[i]). */
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  /** Unit normal pointing into the area, and length. */
  private readonly nx: Float64Array;
  private readonly ny: Float64Array;
  private readonly len: Float64Array;
  private readonly minX: Float64Array;
  private readonly maxX: Float64Array;
  private readonly minY: Float64Array;
  private readonly maxY: Float64Array;
  private readonly drain: Uint8Array;
  private readonly count: number;
  /** The drain edge's line (a point on it and its inward normal), or none. */
  private readonly drainX: number = 0;
  private readonly drainY: number = 0;
  private readonly drainNx: number = 0;
  private readonly drainNy: number = 0;
  private readonly hasDrain: boolean = false;
  private readonly tmp: SweepHit = { t: 0, nx: 0, ny: 0 };

  constructor(area: BallArea) {
    const segments = areaSegments(area, area.drainEdge);
    const n = segments.length;
    if (n < 3) throw new Error('A ball area needs at least three edges.');
    const orientation = Math.sign(polygonSignedArea(area.points)) || 1;
    this.count = n;
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.ny = new Float64Array(n);
    this.len = new Float64Array(n);
    this.minX = new Float64Array(n);
    this.maxX = new Float64Array(n);
    this.minY = new Float64Array(n);
    this.maxY = new Float64Array(n);
    this.drain = new Uint8Array(n);
    let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
    let area2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const { a, b, drain } = segments[i];
      this.ax[i] = a.x; this.ay[i] = a.y; this.bx[i] = b.x; this.by[i] = b.y;
      const ex = b.x - a.x, ey = b.y - a.y;
      const l = Math.hypot(ex, ey) || 1e-9;
      this.len[i] = l;
      this.nx[i] = (-ey / l) * orientation;
      this.ny[i] = (ex / l) * orientation;
      this.minX[i] = Math.min(a.x, b.x); this.maxX[i] = Math.max(a.x, b.x);
      this.minY[i] = Math.min(a.y, b.y); this.maxY[i] = Math.max(a.y, b.y);
      this.drain[i] = drain ? 1 : 0;
      if (drain) {
        this.hasDrain = true;
        this.drainX = a.x; this.drainY = a.y; this.drainNx = this.nx[i]; this.drainNy = this.ny[i];
      }
      left = Math.min(left, a.x); right = Math.max(right, a.x);
      top = Math.max(top, a.y); bottom = Math.min(bottom, a.y);
      const cross = a.x * b.y - b.x * a.y;
      area2 += cross; cx += (a.x + b.x) * cross; cy += (a.y + b.y) * cross;
    }
    this.bounds = { left, right, top, bottom };
    this.centreX = area2 ? cx / (3 * area2) : (left + right) / 2;
    this.centreY = area2 ? cy / (3 * area2) : (top + bottom) / 2;
  }

  /**
   * Earliest contact of a ball of radius r whose centre moves from (x, y) by (dx, dy). Fills `out` (t: fraction of
   * the motion in [0, 1]; n: unit normal pointing back into the area) and returns what was hit. Walls stop the
   * ball's edge; the drain is crossed by its centre. With `passDrain` the drain is ignored.
   */
  sweep(x: number, y: number, dx: number, dy: number, r: number, out: SweepHit, passDrain = false): Contact {
    let bestT = 1;
    let found = Contact.None;
    const reach = r + Math.abs(dx) + Math.abs(dy) + 1e-6;
    for (let i = 0; i < this.count; i++) {
      if (x + reach < this.minX[i] || x - reach > this.maxX[i] || y + reach < this.minY[i] || y - reach > this.maxY[i]) continue;
      const drain = this.drain[i] === 1;
      if (drain && passDrain) continue;
      const nx = this.nx[i];
      const ny = this.ny[i];
      const ax = this.ax[i];
      const ay = this.ay[i];
      // Face: the segment's line, offset inwards by r for a wall (the ball's edge touches) or 0 for the drain.
      const v = dx * nx + dy * ny;
      if (v < -1e-12) {
        const offset = drain ? 0 : r;
        const d0 = (x - ax) * nx + (y - ay) * ny;
        // Only from inside (a centre already behind the face is left to depenetrate).
        if (d0 >= offset - 1e-3) {
          const t = Math.max(0, (d0 - offset) / -v);
          if (t < bestT) {
            // Where along the segment (0 at a, 1 at b) the contact falls.
            const l = this.len[i];
            const u = ((x + dx * t - ax) * (this.bx[i] - ax) + (y + dy * t - ay) * (this.by[i] - ay)) / (l * l);
            if (u >= 0 && u <= 1) {
              bestT = t;
              out.nx = nx;
              out.ny = ny;
              found = drain ? Contact.Drain : Contact.Wall;
            }
          }
        }
      }
      if (drain) continue;
      // Corners: both ends of a wall segment (a corner shared with the drain is still solid).
      for (let k = 0; k < 2; k++) {
        const vx = k === 0 ? ax : this.bx[i];
        const vy = k === 0 ? ay : this.by[i];
        const fx = x - vx;
        const fy = y - vy;
        const b = fx * dx + fy * dy;
        if (b >= 0) continue; // moving away from the corner
        const a = dx * dx + dy * dy;
        const c = fx * fx + fy * fy - r * r;
        let t: number;
        if (c <= 0) {
          t = 0; // already touching and moving in
        } else {
          const disc = b * b - a * c;
          if (disc < 0) continue;
          t = (-b - Math.sqrt(disc)) / a;
        }
        if (t < 0 || t >= bestT) continue;
        const hx = x + dx * t - vx;
        const hy = y + dy * t - vy;
        const l = Math.hypot(hx, hy) || 1;
        bestT = t;
        out.nx = hx / l;
        out.ny = hy / l;
        found = Contact.Wall;
      }
    }
    out.t = bestT;
    return found;
  }

  /** True when (x, y) is below the drain line, i.e. on its way out (or back up from the barrier). */
  belowDrain(x: number, y: number): boolean {
    return this.hasDrain && (x - this.drainX) * this.drainNx + (y - this.drainY) * this.drainNy < 0;
  }

  /** Even-odd test against the sampled outline (the drain counts as an edge). */
  contains(x: number, y: number): boolean {
    let inside = false;
    for (let i = 0; i < this.count; i++) {
      const ay = this.ay[i], by = this.by[i];
      if ((ay > y) !== (by > y)) {
        const ax = this.ax[i], bx = this.bx[i];
        if (x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Nearest wall point to (x, y) within `range`: returns the distance (Infinity when no wall is that close) and
   * fills `out.nx/ny` with the unit direction from that point towards (x, y) (or the wall's inward normal when
   * (x, y) is on it). Segments whose bounding box is further than `range` are skipped.
   */
  private nearestWall(x: number, y: number, range: number, out: SweepHit): number {
    let best = Infinity;
    let bx = 0, by = 0, bi = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.drain[i]) continue;
      if (x + range < this.minX[i] || x - range > this.maxX[i] || y + range < this.minY[i] || y - range > this.maxY[i]) continue;
      const ax = this.ax[i], ay = this.ay[i];
      const ex = this.bx[i] - ax, ey = this.by[i] - ay;
      const l2 = ex * ex + ey * ey || 1e-18;
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
      const px = ax + ex * u, py = ay + ey * u;
      const d = Math.hypot(x - px, y - py);
      if (d < best) { best = d; bx = px; by = py; bi = i; }
    }
    if (bi < 0) return Infinity;
    if (best > 1e-9) {
      out.nx = (x - bx) / best;
      out.ny = (y - by) / best;
    } else {
      out.nx = this.nx[bi];
      out.ny = this.ny[bi];
    }
    return best;
  }

  /**
   * Pushes a ball that overlaps a wall back inside, including one whose centre has slipped through (between two
   * segments, say). Balls below the drain line are left alone: they are leaving, or coming back from the barrier.
   * `reflect` turns the ball away from the inward normal it was pushed along.
   */
  depenetrate(ball: Ball, r: number, reflect: (nx: number, ny: number) => void): void {
    if (this.belowDrain(ball.x, ball.y)) return;
    // A few passes settle a ball wedged into a concave spot between two segments.
    for (let pass = 0; pass < 3; pass++) {
      const d = this.nearestWall(ball.x, ball.y, r, this.tmp);
      if (d >= r) return;
      // Inside: push out along (centre - wall). Outside: the wall is between, so push the other way, past it.
      const inside = this.contains(ball.x, ball.y);
      const s = inside ? 1 : -1;
      const nx = this.tmp.nx * s;
      const ny = this.tmp.ny * s;
      const push = (inside ? r - d : r + d) + CONTACT_EPS;
      ball.x += nx * push;
      ball.y += ny * push;
      reflect(nx, ny);
    }
  }
}

/**
 * Frees a ball that is trapped by the walls: one that touches them many times in a short window without
 * getting anywhere (a concave pocket, or bouncing in place). The ball is turned towards the middle of the
 * arena; the caller renormalises the direction (keeping the minimum vertical speed rule).
 */
export class TrapGuard {
  /** Boundary contacts within WINDOW seconds that count as trapped, unless the ball travelled TRAVEL units. */
  static readonly HITS = 6;
  static readonly WINDOW = 0.4;
  static readonly TRAVEL = 2.5;
  private readonly state = new Map<Ball, { since: number; hits: number; x: number; y: number }>();
  /** Times a ball has been freed (for tests and diagnostics). */
  freed = 0;

  reset(): void {
    this.state.clear();
  }

  /** Call on each boundary contact; returns true (and redirects the ball) when it is trapped. */
  onContact(ball: Ball, time: number, centreX: number, centreY: number): boolean {
    let s = this.state.get(ball);
    if (!s || time - s.since > TrapGuard.WINDOW) {
      s = { since: time, hits: 0, x: ball.x, y: ball.y };
      this.state.set(ball, s);
    }
    s.hits++;
    if (s.hits < TrapGuard.HITS || Math.hypot(ball.x - s.x, ball.y - s.y) > TrapGuard.TRAVEL) return false;
    this.free(ball, centreX, centreY);
    return true;
  }

  /** Turns a ball towards (centreX, centreY) and forgets its contact history. */
  free(ball: Ball, centreX: number, centreY: number): void {
    const tx = centreX - ball.x;
    const ty = centreY - ball.y;
    const l = Math.hypot(tx, ty) || 1;
    ball.dx = tx / l;
    ball.dy = ty / l;
    this.state.delete(ball);
    this.freed++;
  }
}
