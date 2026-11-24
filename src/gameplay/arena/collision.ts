/** Result of a sweep (t = fraction of the motion) or an overlap test (t = penetration depth). */
export interface SweepHit {
  t: number;
  nx: number;
  ny: number;
}

const EPS = 1e-9;

/**
 * Continuous collision of a moving circle against a static AABB.
 * The box is Minkowski-expanded by the radius; corner regions are resolved
 * exactly against the corner arc, so fast balls never tunnel and corner
 * bounces reflect around the true contact normal.
 *
 * @returns true and fills `out` when the circle touches the box within the motion (t in [0, 1]).
 */
export function sweepCircleAabb(
  px: number,
  py: number,
  dx: number,
  dy: number,
  r: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  out: SweepHit,
): boolean {
  const ex = hw + r;
  const ey = hh + r;
  const relX = px - cx;
  const relY = py - cy;
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;

  if (Math.abs(dx) < EPS) {
    if (Math.abs(relX) >= ex) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (-ex - relX) * inv;
    let t2 = (ex - relX) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
  }

  if (Math.abs(dy) < EPS) {
    if (Math.abs(relY) >= ey) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (-ey - relY) * inv;
    let t2 = (ey - relY) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tmax) tmax = t2;
  }

  if (tmin > tmax || tmax <= 0 || tmin > 1) return false;

  let qx: number;
  let qy: number;
  if (tmin >= 0) {
    qx = relX + dx * tmin;
    qy = relY + dy * tmin;
    if (Math.abs(qx) <= hw || Math.abs(qy) <= hh) {
      out.t = tmin;
      out.nx = nx;
      out.ny = ny;
      return true;
    }
  } else {
    // Started inside the expanded box. Only the empty corner pockets are
    // legitimately outside the rounded shape; anything else is an overlap.
    qx = relX;
    qy = relY;
    if (Math.abs(qx) <= hw || Math.abs(qy) <= hh) return false;
  }

  // Corner region: intersect the ray with the corner arc.
  const kx = qx > 0 ? hw : -hw;
  const ky = qy > 0 ? hh : -hh;
  const mx = relX - kx;
  const my = relY - ky;
  const a = dx * dx + dy * dy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - r * r;
  if (c <= 0 || b >= 0) return false;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > 1) return false;
  out.t = t;
  out.nx = (mx + dx * t) / r;
  out.ny = (my + dy * t) / r;
  return true;
}

/** Continuous collision of a moving circle against a static circle. */
export function sweepCircleCircle(
  px: number,
  py: number,
  dx: number,
  dy: number,
  r: number,
  cx: number,
  cy: number,
  cr: number,
  out: SweepHit,
): boolean {
  const R = r + cr;
  const mx = px - cx;
  const my = py - cy;
  const a = dx * dx + dy * dy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - R * R;
  if (c <= 0 || b >= 0 || a < EPS) return false;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > 1) return false;
  out.t = t;
  out.nx = (mx + dx * t) / R;
  out.ny = (my + dy * t) / R;
  return true;
}

/**
 * Static overlap of a circle and an AABB. On overlap `out` holds the
 * minimum-translation normal and `out.t` the penetration depth.
 */
export function overlapCircleAabb(
  x: number,
  y: number,
  r: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  out: SweepHit,
): boolean {
  const relX = x - cx;
  const relY = y - cy;
  const qx = relX < -hw ? -hw : relX > hw ? hw : relX;
  const qy = relY < -hh ? -hh : relY > hh ? hh : relY;
  const ddx = relX - qx;
  const ddy = relY - qy;
  const d2 = ddx * ddx + ddy * ddy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    out.nx = ddx / d;
    out.ny = ddy / d;
    out.t = r - d;
    return true;
  }
  // Centre is inside the box: leave through the nearest face.
  const penX = hw - Math.abs(relX);
  const penY = hh - Math.abs(relY);
  if (penX < penY) {
    out.nx = relX >= 0 ? 1 : -1;
    out.ny = 0;
    out.t = penX + r;
  } else {
    out.nx = 0;
    out.ny = relY >= 0 ? 1 : -1;
    out.t = penY + r;
  }
  return true;
}
