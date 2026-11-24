import { describe, expect, it } from 'vitest';
import { overlapCircleAabb, sweepCircleAabb, sweepCircleCircle, type SweepHit } from '../src/gameplay/arena/collision';

const hit = (): SweepHit => ({ t: 0, nx: 0, ny: 0 });

describe('sweepCircleAabb', () => {
  it('hits the top face with an upward normal', () => {
    const h = hit();
    // Circle r=0.5 falling from y=3 towards a 2x1 box at the origin.
    expect(sweepCircleAabb(0, 3, 0, -4, 0.5, 0, 0, 1, 0.5, h)).toBe(true);
    expect(h.t).toBeCloseTo(0.5, 6); // contact at y = 1
    expect(h.nx).toBe(0);
    expect(h.ny).toBe(1);
  });

  it('hits a side face with a horizontal normal', () => {
    const h = hit();
    expect(sweepCircleAabb(-5, 0, 10, 0, 0.5, 0, 0, 1, 0.5, h)).toBe(true);
    expect(h.t).toBeCloseTo(0.35, 6);
    expect(h.nx).toBe(-1);
    expect(h.ny).toBe(0);
  });

  it('misses when the motion stops short', () => {
    expect(sweepCircleAabb(0, 3, 0, -1, 0.5, 0, 0, 1, 0.5, hit())).toBe(false);
  });

  it('misses when moving away', () => {
    expect(sweepCircleAabb(0, 3, 0, 5, 0.5, 0, 0, 1, 0.5, hit())).toBe(false);
  });

  it('does not tunnel at extreme speed', () => {
    const h = hit();
    expect(sweepCircleAabb(0, 100, 0, -1000, 0.3, 0, 0, 1, 0.4, h)).toBe(true);
    expect(100 - 1000 * h.t).toBeCloseTo(0.7, 6);
  });

  it('resolves corner contacts against the corner arc', () => {
    const h = hit();
    // Diagonal approach straight at the top-right corner (1, 0.5).
    expect(sweepCircleAabb(3, 2.5, -4, -4, 0.5, 0, 0, 1, 0.5, h)).toBe(true);
    expect(h.nx).toBeCloseTo(Math.SQRT1_2, 5);
    expect(h.ny).toBeCloseTo(Math.SQRT1_2, 5);
    const cx = 3 - 4 * h.t;
    const cy = 2.5 - 4 * h.t;
    expect(Math.hypot(cx - 1, cy - 0.5)).toBeCloseTo(0.5, 5);
  });

  it('lets a circle graze past a rounded corner without a false hit', () => {
    // Passes through the square corner of the expanded box but outside the arc.
    expect(sweepCircleAabb(1.47, 3, 0.0, -6, 0.5, 0, 0, 1, 0.5, hit())).toBe(true);
    expect(sweepCircleAabb(1.52, 3, 0.0, -6, 0.5, 0, 0, 1, 0.5, hit())).toBe(false);
    const h = hit();
    expect(sweepCircleAabb(2.2, 1.6, -1.2, -1.0, 0.5, 0, 0, 1, 0.5, h)).toBe(sweptBruteForce(2.2, 1.6, -1.2, -1.0));
  });

  it('detects a hit that starts inside an empty corner pocket', () => {
    const h = hit();
    // Start in the expanded box's corner square, outside the arc, heading for the corner.
    expect(sweepCircleAabb(1.45, 0.95, -1, -1, 0.5, 0, 0, 1, 0.5, h)).toBe(true);
    expect(h.t).toBeGreaterThan(0);
    expect(h.t).toBeLessThan(1);
  });
});

/** Reference implementation: march the motion in tiny increments. */
function sweptBruteForce(px: number, py: number, dx: number, dy: number): boolean {
  const h = hit();
  for (let i = 0; i <= 5000; i++) {
    const t = i / 5000;
    if (overlapCircleAabb(px + dx * t, py + dy * t, 0.5, 0, 0, 1, 0.5, h)) return true;
  }
  return false;
}

describe('sweepCircleCircle', () => {
  it('finds first contact and an outward normal', () => {
    const h = hit();
    expect(sweepCircleCircle(0, 10, 0, -10, 1, 0, 0, 2, h)).toBe(true);
    expect(h.t).toBeCloseTo(0.7, 6);
    expect(h.nx).toBeCloseTo(0, 6);
    expect(h.ny).toBeCloseTo(1, 6);
  });

  it('ignores circles that are already separating', () => {
    expect(sweepCircleCircle(0, 4, 0, 5, 1, 0, 0, 2, hit())).toBe(false);
  });
});

describe('overlapCircleAabb', () => {
  it('reports separation depth and normal', () => {
    const h = hit();
    expect(overlapCircleAabb(0, 0.8, 0.5, 0, 0, 1, 0.5, h)).toBe(true);
    expect(h.ny).toBe(1);
    expect(h.t).toBeCloseTo(0.2, 6);
  });

  it('pushes a fully embedded centre out through the nearest face', () => {
    const h = hit();
    expect(overlapCircleAabb(0.9, 0, 0.5, 0, 0, 1, 0.5, h)).toBe(true);
    expect(h.nx).toBe(1);
    expect(h.ny).toBe(0);
    expect(h.t).toBeCloseTo(0.6, 6);
  });

  it('returns false when apart', () => {
    expect(overlapCircleAabb(3, 3, 0.5, 0, 0, 1, 0.5, hit())).toBe(false);
  });
});
