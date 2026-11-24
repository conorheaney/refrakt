import { describe, expect, it } from 'vitest';
import { cornerTrim, MAX_PATH_RADIUS, pathLength, roundedCorners, roundedPath } from '../src/engine/core/paths';
import { areaContour } from '../src/gameplay/arena/playAreas';
import { icicleAreaIcicles, validateHazards, type IcicleAreaDef } from '../src/gameplay/hazards/hazards';
import { ScarabSystem } from '../src/gameplay/hazards/scarabs/scarabs';

const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
const SQUARE = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];

describe('paths', () => {
  it('leaves a path as it is with no rounding', () => {
    expect(roundedPath(L, false, 0)).toEqual(L);
    expect(roundedPath(SQUARE, true, 0)).toEqual(SQUARE);
  });

  it('rounds an open path\'s corners but keeps its ends', () => {
    const out = roundedPath(L, false, 1, 4);
    expect(out[0]).toEqual(L[0]);
    expect(out[out.length - 1]).toEqual(L[2]);
    // The corner is cut back 1 along each edge and bridged by a curve inside it.
    expect(out[1]).toEqual({ x: 3, y: 0 });
    expect(out[out.length - 2]).toEqual({ x: 4, y: 1 });
    expect(out.length).toBe(2 + 5);
    expect(pathLength(out)).toBeLessThan(pathLength(L));
  });

  it('rounds every corner of a closed path', () => {
    expect(roundedCorners(SQUARE, true, 1)).toBe(4);
    expect(roundedCorners(L, false, 1)).toBe(1);
    expect(roundedPath(SQUARE, true, 1, 4)).toHaveLength(4 * 5);
  });

  it('never cuts back more than 40% of an edge, so neighbouring curves never overlap', () => {
    expect(cornerTrim(L[0], L[1], L[2], MAX_PATH_RADIUS)).toBeCloseTo(1.6);
  });

  it('rounds the same way as play areas', () => {
    const area = { points: SQUARE, radius: 1 };
    const contour = areaContour(area);
    for (const p of roundedPath(SQUARE, true, 1)) {
      expect(contour.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
    }
  });
});

describe('curved paths in the game', () => {
  it('accepts a radius of 0-3 on nests, icicle areas and snakes, and rejects others', () => {
    expect(validateHazards([{ kind: 'scarabs', x: -5, y: -9, path: L, radius: 2 }])[0]).toMatchObject({ radius: 2 });
    expect(() => validateHazards([{ kind: 'scarabs', x: -5, y: -9, radius: -1 }])).toThrow(/rounding/);
    expect(validateHazards([{ kind: 'snake', x: -5, y: 0, reach: 4, radius: 1 }])[0]).toMatchObject({ radius: 1 });
    expect(() => validateHazards([{ kind: 'icicles', points: L, count: 3, minLength: 0.5, maxLength: 1, seed: 1, radius: 'big' }])).toThrow(/rounding/);
  });

  it('walks scarabs in along the rounded path', () => {
    const route = ScarabSystem.route({ kind: 'scarabs', x: 0, y: 0, path: [{ x: 4, y: 0 }, { x: 4, y: 4 }], radius: 1 });
    expect(route).toEqual(roundedPath(L, false, 1));
  });

  it('hangs icicles along the rounded line', () => {
    const area: IcicleAreaDef = { kind: 'icicles', points: [{ x: -4, y: 6 }, { x: 0, y: 8 }, { x: 4, y: 6 }], count: 9, minLength: 1, maxLength: 1, seed: 3 };
    const sharp = icicleAreaIcicles(area);
    const curved = icicleAreaIcicles({ ...area, radius: 3 });
    // The middle icicle hangs lower under the rounded-off peak.
    expect(curved[4].y).toBeLessThan(sharp[4].y);
  });
});
