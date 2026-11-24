/**
 * Paths: a list of points, open (a line) or closed (an outline), whose corners can be rounded off. The one
 * curve model behind every path a world defines (play areas, scarab walk-ins, icicle
 * lines, snake bodies) and behind the editor that draws them, so what is drawn is what the game uses.
 *
 * Rounding: each corner is cut back by up to `radius` along both its edges (never more than 40% of either,
 * so neighbouring curves never overlap) and the cut is bridged by a quadratic curve with the corner as its
 * control point. The ends of an open path stay where they are. gameplay/arena/playAreas.ts areaSegments
 * rounds play areas the same way.
 */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

/** Largest corner rounding a path may ask for, world units. */
export const MAX_PATH_RADIUS = 3;
/** Curve samples per rounded corner, by default. */
export const CORNER_STEPS = 12;

const mix = (a: PathPoint, b: PathPoint, t: number): PathPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const gap = (a: PathPoint, b: PathPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** How far a corner at `p` (between `prev` and `next`) is cut back for a rounding of `radius`. */
export function cornerTrim(prev: PathPoint, p: PathPoint, next: PathPoint, radius: number): number {
  return Math.max(0, Math.min(radius, gap(prev, p) * 0.4, gap(p, next) * 0.4));
}

/** How many of a path's corners `radius` rounds (the ends of an open path are not corners). */
export function roundedCorners(points: readonly PathPoint[], closed: boolean, radius: number): number {
  if (radius <= 0) return 0;
  const n = points.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    if (cornerTrim(points[(i + n - 1) % n], points[i], points[(i + 1) % n], radius) > 1e-6) count++;
  }
  return count;
}

/**
 * The path as drawn and used: its points with each corner rounded off by `radius` (`steps` samples a corner).
 * A closed path's last point joins back to its first (not repeated).
 */
export function roundedPath(points: readonly PathPoint[], closed: boolean, radius: number, steps = CORNER_STEPS): PathPoint[] {
  const n = points.length;
  if (radius <= 0 || n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const out: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!closed && (i === 0 || i === n - 1)) { out.push({ x: p.x, y: p.y }); continue; }
    const prev = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    const trim = cornerTrim(prev, p, next, radius);
    if (trim <= 1e-6) { out.push({ x: p.x, y: p.y }); continue; }
    const entry = mix(p, prev, trim / (gap(p, prev) || 1));
    const exit = mix(p, next, trim / (gap(p, next) || 1));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push(mix(mix(entry, p, t), mix(p, exit, t), t));
    }
  }
  return out;
}

/** Length of an open path (as given: round it first for the curve's). */
export function pathLength(points: readonly PathPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += gap(points[i - 1], points[i]);
  return length;
}
