import { expect, it } from 'vitest';
import { GRID } from '../src/gameplay/config';
import { createBrickGeometry } from '../src/engine/render/geometry';
import { createWorld, validateWorld, withBackground } from '../src/content/authoredWorlds';
import { createForgeArmorGeometry, createForgeExplosiveGeometry } from '../src/themes/blocks/forge/forgeBlocks';

it('keeps the sculpted Forge prototypes inside their collision footprint with separate surface materials', () => {
  for (const create of [createForgeArmorGeometry, createForgeExplosiveGeometry]) {
    const geometry = create();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    expect(bounds.max.x).toBeLessThanOrEqual(GRID.halfW + 0.00001);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-GRID.halfW - 0.00001);
    expect(bounds.max.y).toBeLessThanOrEqual(GRID.halfH + 0.00001);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-GRID.halfH - 0.00001);
    expect(geometry.groups.map(group => group.materialIndex)).toEqual([0, 1]);
    expect(geometry.groups.every(group => group.count > 0)).toBe(true);
    expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
    for (const name of ['position', 'normal', 'uv']) {
      expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true);
    }
    geometry.dispose();
  }
});

it('keeps Forge collision dimensions while providing finite UVs on every face', () => {
  const { geometry } = createBrickGeometry(GRID.halfW, GRID.halfH, GRID.depth, true);
  const uv = geometry.getAttribute('uv');
  expect(uv.count).toBe(geometry.getAttribute('position').count);
  for (const coordinate of uv.array) {
    expect(Number.isFinite(coordinate)).toBe(true);
    expect(coordinate).toBeGreaterThanOrEqual(-0.00001);
    expect(coordinate).toBeLessThanOrEqual(1.00001);
  }
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.max.x).toBeCloseTo(GRID.halfW);
  expect(geometry.boundingBox!.max.y).toBeCloseTo(GRID.halfH);
  expect(geometry.groups.map(group => group.materialIndex)).toEqual([0, 1]);
  geometry.dispose();
});

it('opts into Forge explicitly and preserves the style through editor validation and arena changes', () => {
  const data = createWorld('forge-render-test');
  expect(data.world.blockStyle).toBeUndefined();
  data.world = { ...data.world, blockStyle: 'forge' };
  expect(validateWorld(data).world.blockStyle).toBe('forge');
  expect(withBackground(data.world, 'forest').blockStyle).toBe('forge');
  expect(() => validateWorld({ ...data, world: { ...data.world, blockStyle: 'unknown' } })).toThrow('Unsupported block style');
});
