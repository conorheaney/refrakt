import * as THREE from 'three';
import { expect, it } from 'vitest';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { validateWorld } from '../src/content/authoredWorlds';
import { isWeather } from '../src/content/worlds';
import { envelope, TombDustLayer } from '../src/themes/weather/dust/TombDustLayer';

/** Pharoughs Tomb's dust line: the rumble's dust pours from it. */
const LINE = validateWorld(tomb).dustLine!;

/** The start positions of the layer's falling grains, and which are veils (from a crack) rather than specks or grit. */
function grains(layer: TombDustLayer): { x: number; y: number; veil: boolean }[] {
  const { dustPos, dustRand } = layer as unknown as { dustPos: Float32Array; dustRand: Float32Array };
  return Array.from(dustRand, (r, i) => ({ x: dustPos[i * 3], y: dustPos[i * 3 + 1], veil: r < 0.62 }));
}

const DT = 1 / 60;

function run(layer: TombDustLayer, seconds: number, simulating = true) {
  const rumbles: number[] = [];
  const flares: [number, number][] = [];
  let maxFlare = 0;
  let maxRumble = 0;
  let t = 0;
  layer.onRumble = () => rumbles.push(t);
  layer.onFlare = () => flares.push([t, layer.rumble]);
  for (; t < seconds; t += DT) {
    layer.update(DT, simulating ? DT : 0);
    maxFlare = Math.max(maxFlare, layer.flare);
    maxRumble = Math.max(maxRumble, layer.rumble);
  }
  return { rumbles, flares, maxFlare, maxRumble };
}

it('the Pharoughs Tomb uses tomb dust weather', () => {
  expect(isWeather('dust')).toBe(true);
  expect(validateWorld(tomb).world.weather).toBe('dust');
});

it("pours Pharoughs Tomb's dust from its painted lintel (the drawn dust line)", () => {
  // The lintel's underside: the template arena's top (10.4) less 1.15, as before the dust line existed.
  expect(LINE.points.map((p) => p.y)).toEqual([9.25, 9.25]);
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, LINE);
  for (const g of grains(layer)) {
    expect(g.y).toBeCloseTo(9.25, 5);
    expect(Math.abs(g.x)).toBeLessThanOrEqual(12.75 + 1e-5);
  }
});

it('starts every falling grain on the dust line: veils at its cracks, specks and grit anywhere along it', () => {
  // A bent line: up from the left, across, and down to the right.
  const line = {
    points: [
      { x: -10, y: 6 },
      { x: -6, y: 9 },
      { x: 6, y: 9 },
      { x: 10, y: 6 },
    ],
  };
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, line);
  const onSegment = (x: number, y: number): boolean =>
    line.points.slice(1).some((b, i) => {
      const a = line.points[i];
      const ex = b.x - a.x,
        ey = b.y - a.y;
      const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
      return Math.hypot(x - a.x - ex * u, y - a.y - ey * u) < 1e-4;
    });
  const all = grains(layer);
  for (const g of all) expect(onSegment(g.x, g.y)).toBe(true);
  // The veils come from at most 26 places (the cracks); the specks and grit are spread all along.
  expect(new Set(all.filter((g) => g.veil).map((g) => `${g.x},${g.y}`)).size).toBeLessThanOrEqual(26);
  const loose = all.filter((g) => !g.veil);
  expect(Math.min(...loose.map((g) => g.x))).toBeLessThan(-9.5);
  expect(Math.max(...loose.map((g) => g.x))).toBeGreaterThan(9.5);
  expect(loose.some((g) => g.y > 8.9)).toBe(true);
  expect(loose.some((g) => g.y < 7)).toBe(true);
});

it('needs a dust line to show tomb dust', () => {
  const layer = new TombDustLayer(new THREE.Scene());
  expect(() => layer.setActive(true, undefined)).toThrow('dust line');
  expect(() => layer.setActive(false, undefined)).not.toThrow();
});

it('rumbles 8-12 seconds after entering the tomb, then every 20-40 seconds', () => {
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, LINE);
  const { rumbles, maxRumble } = run(layer, 300);
  expect(rumbles[0]).toBeGreaterThanOrEqual(8);
  expect(rumbles[0]).toBeLessThanOrEqual(12.1);
  for (let i = 1; i < rumbles.length; i++) {
    const gap = rumbles[i] - rumbles[i - 1];
    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(40.1);
  }
  expect(maxRumble).toBeGreaterThan(0.5);
  expect(maxRumble).toBeLessThanOrEqual(1);
});

it('flares the torches regularly, never during a rumble', () => {
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, LINE);
  const { flares, maxFlare } = run(layer, 600);
  expect(flares.length).toBeGreaterThan(10);
  for (const [, rumble] of flares) expect(rumble).toBe(0);
  expect(maxFlare).toBeGreaterThan(0.3);
  expect(maxFlare).toBeLessThanOrEqual(1);
});

it('starts no rumble or flare while the game is paused', () => {
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, LINE);
  const { rumbles, flares } = run(layer, 120, false);
  expect(rumbles).toHaveLength(0);
  expect(flares).toHaveLength(0);
});

it('swells, holds and dies away', () => {
  expect(envelope(-1, 0.4, 2, 1.6)).toBe(0);
  expect(envelope(0.2, 0.4, 2, 1.6)).toBeCloseTo(0.5);
  expect(envelope(1, 0.4, 2, 1.6)).toBe(1);
  expect(envelope(4.1, 0.4, 2, 1.6)).toBe(0);
});
