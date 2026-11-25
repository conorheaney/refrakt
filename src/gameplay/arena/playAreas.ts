import { PADDLE, type FieldDef } from '../config';

export interface Point {
  x: number;
  y: number;
}
export interface PolygonArea {
  points: Point[];
  /** Distance trimmed from each corner, in game units. Zero preserves sharp corners. */
  radius: number;
}
export interface BallArea extends PolygonArea {
  drainEdge: number;
}
export interface PlayAreas {
  ball?: BallArea;
  paddle?: PolygonArea;
}
export interface BoundarySegment {
  a: Point;
  b: Point;
  edge: number;
  drain: boolean;
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cross = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function polygonSignedArea(points: readonly Point[]): number {
  return (
    points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2
  );
}

export function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length2)) : 0;
  return mix(a, b, t);
}

export function pointInPolygon(p: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (distance(p, nearestOnSegment(p, a, b)) < 1e-7) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Same rounded contour for editing, rendering and continuous collision. Drain endpoints stay sharp. */
export function areaSegments(area: PolygonArea, drainEdge = -1): BoundarySegment[] {
  const points = area.points;
  const corners = points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length],
      next = points[(i + 1) % points.length];
    const trim =
      i === drainEdge || (i + points.length - 1) % points.length === drainEdge
        ? 0
        : Math.min(area.radius, distance(prev, p) * 0.4, distance(p, next) * 0.4);
    return {
      entry: mix(p, prev, trim / (distance(p, prev) || 1)),
      exit: mix(p, next, trim / (distance(p, next) || 1)),
    };
  });
  const result: BoundarySegment[] = [];
  const push = (a: Point, b: Point, edge: number): void => {
    if (distance(a, b) > 1e-8) result.push({ a, b, edge, drain: edge === drainEdge });
  };
  for (let i = 0; i < points.length; i++) {
    const corner = corners[i];
    let previous = corner.entry;
    if (distance(corner.entry, corner.exit) > 1e-8) {
      // Twelve quadratic samples per corner: bounded, deterministic and small relative to ball radius.
      for (let step = 1; step <= 12; step++) {
        const t = step / 12;
        const next = mix(mix(corner.entry, points[i], t), mix(points[i], corner.exit, t), t);
        push(previous, next, i);
        previous = next;
      }
    }
    push(corner.exit, corners[(i + 1) % points.length].entry, i);
  }
  return result;
}

export function areaContour(area: PolygonArea): Point[] {
  return areaSegments(area, 'drainEdge' in area ? Number(area.drainEdge) : -1).map((segment) => segment.a);
}

export function defaultBallArea(field: FieldDef): BallArea {
  const points: Point[] = [{ x: -field.halfWidth, y: field.bottom }];
  const cx = field.halfWidth - field.cornerRadius,
    cy = field.top - field.cornerRadius;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i * Math.PI) / 16;
    points.push({ x: -cx + Math.cos(a) * field.cornerRadius, y: cy + Math.sin(a) * field.cornerRadius });
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 - (i * Math.PI) / 16;
    points.push({ x: cx + Math.cos(a) * field.cornerRadius, y: cy + Math.sin(a) * field.cornerRadius });
  }
  points.push({ x: field.halfWidth, y: field.bottom });
  return { points, radius: 0, drainEdge: points.length - 1 };
}

/** The paddle lane a new world starts with: the classic paddle line across the arena's paddle reach. */
export function defaultPaddleArea(field: FieldDef): PolygonArea {
  const reach = field.paddleReach;
  return {
    radius: 0,
    points: [
      { x: -reach, y: PADDLE.y - 0.8 },
      { x: reach, y: PADDLE.y - 0.8 },
      { x: reach, y: PADDLE.y + 0.8 },
      { x: -reach, y: PADDLE.y + 0.8 },
    ],
  };
}

export function lowestEdge(points: readonly Point[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y + points[(i + 1) % points.length].y < points[best].y + points[(best + 1) % points.length].y)
      best = i;
  }
  return best;
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) - 1e-7 ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) - 1e-7 ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) - 1e-7 ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y) - 1e-7
  )
    return false;
  return cross(a, b, c) * cross(a, b, d) <= 1e-10 && cross(c, d, a) * cross(c, d, b) <= 1e-10;
}

function assertSimple(points: readonly Point[]): void {
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i], points[(i + 1) % points.length]) < 1e-5) throw new Error('Remove overlapping points.');
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsTouch(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length]))
        throw new Error('Area edges cannot cross or touch each other.');
    }
  }
}

export function validateArea(value: unknown, ball = false): PolygonArea {
  if (!value || typeof value !== 'object') throw new Error('Invalid play area.');
  const area = value as BallArea;
  if (!Array.isArray(area.points) || area.points.length < 3 || area.points.length > 96)
    throw new Error('Draw 3–96 points to form an area.');
  for (const p of area.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 40 || Math.abs(p.y) > 24)
      throw new Error('Area points must stay within the scene.');
  }
  if (!Number.isFinite(area.radius) || area.radius < 0 || area.radius > 3)
    throw new Error('Corner smoothing must be between 0 and 3.');
  if (ball && (!Number.isInteger(area.drainEdge) || area.drainEdge < 0 || area.drainEdge >= area.points.length))
    throw new Error('Choose a drain edge for the ball area.');
  assertSimple(area.points);
  if (Math.abs(polygonSignedArea(area.points)) < 1) throw new Error('The play area is too small.');
  const contour = areaContour(area);
  assertSimple(contour);
  return area;
}

/** Ramer–Douglas–Peucker simplification for freehand tracing, preserving intentional corners. */
export function simplifyStroke(points: readonly Point[], tolerance = 0.15): Point[] {
  if (points.length < 3) return [...points];
  let max = tolerance,
    at = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distance(points[i], nearestOnSegment(points[i], points[0], points[points.length - 1]));
    if (d > max) {
      max = d;
      at = i;
    }
  }
  if (at < 0) return [points[0], points[points.length - 1]];
  return [
    ...simplifyStroke(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...simplifyStroke(points.slice(at), tolerance),
  ];
}

/** Align to nearby existing coordinates and a quarter-unit grid; used after optional scene-edge attraction. */
export function snapPoint(p: Point, anchors: readonly Point[], tolerance: number): Point {
  let x = Math.round(p.x * 4) / 4,
    y = Math.round(p.y * 4) / 4;
  if (Math.abs(x - p.x) > tolerance) x = p.x;
  if (Math.abs(y - p.y) > tolerance) y = p.y;
  let dx = tolerance,
    dy = tolerance;
  for (const a of anchors) {
    if (Math.abs(a.x - p.x) < dx) {
      dx = Math.abs(a.x - p.x);
      x = a.x;
    }
    if (Math.abs(a.y - p.y) < dy) {
      dy = Math.abs(a.y - p.y);
      y = a.y;
    }
  }
  return { x, y };
}

export type Interval = [number, number];
function horizontalIntervals(points: readonly Point[], y: number): Interval[] {
  const hits: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a.y > y !== b.y > y) hits.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  hits.sort((a, b) => a - b);
  const spans: Interval[] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) spans.push([hits[i], hits[i + 1]]);
  return spans;
}

/** Exact rectangle containment for a sampled polygon: intersect every horizontal section it spans. */
export function paddleIntervals(contour: readonly Point[], y: number, width: number, halfHeight: number): Interval[] {
  const bottom = y - halfHeight,
    top = y + halfHeight;
  const heights = [
    bottom + 1e-6,
    top - 1e-6,
    ...contour.filter((p) => p.y > bottom && p.y < top).flatMap((p) => [p.y - 1e-6, p.y + 1e-6]),
  ];
  let result: Interval[] = [[-Infinity, Infinity]];
  for (const height of heights) {
    const intervals = horizontalIntervals(contour, height);
    result = result.flatMap(([a, b]) =>
      intervals.flatMap(([c, d]): Interval[] =>
        Math.max(a, c) < Math.min(b, d) ? [[Math.max(a, c), Math.min(b, d)]] : [],
      ),
    );
  }
  return result.map(([a, b]): Interval => [a + width / 2, b - width / 2]).filter(([a, b]) => b >= a);
}

/** Pick a stable horizontal lane with room for the expanded paddle, nearest the polygon's centre. */
export function findPaddleLane(area: PolygonArea, width: number, halfHeight: number): { y: number; spans: Interval[] } {
  const contour = areaContour(area);
  const min = Math.min(...contour.map((p) => p.y)) + halfHeight + 1e-4;
  const max = Math.max(...contour.map((p) => p.y)) - halfHeight - 1e-4;
  if (max < min) throw new Error('Paddle area must be at least 1.1 game units tall.');
  const mid = (min + max) / 2;
  const candidates = Array.from({ length: 65 }, (_, i) => min + ((max - min) * i) / 64).sort(
    (a, b) => Math.abs(a - mid) - Math.abs(b - mid),
  );
  for (const y of candidates) {
    const spans = paddleIntervals(contour, y, width, halfHeight);
    if (spans.some(([a, b]) => b - a > 0.1)) return { y, spans };
  }
  throw new Error('Widen the paddle area to fit the expanded paddle and leave room to move.');
}

export function clampToSpans(x: number, spans: readonly Interval[]): number {
  let result = x,
    best = Infinity;
  for (const [a, b] of spans) {
    const value = Math.max(a, Math.min(b, x));
    if (Math.abs(value - x) < best) {
      best = Math.abs(value - x);
      result = value;
    }
  }
  return result;
}
