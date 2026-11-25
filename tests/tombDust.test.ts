import * as THREE from 'three';
import { expect, it } from 'vitest';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { validateWorld } from '../src/content/authoredWorlds';
import { PolygonBoundary } from '../src/gameplay/arena/boundary';
import { isWeather } from '../src/content/worlds';
import { envelope, TombDustLayer } from '../src/themes/weather/dust/TombDustLayer';

/** Pharoughs Tomb's ball area: the dust fills its extent. */
const ARENA = new PolygonBoundary(validateWorld(tomb).playAreas!.ball!).bounds;

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

it('rumbles 8-12 seconds after entering the tomb, then every 20-40 seconds', () => {
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, ARENA);
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
  layer.setActive(true, ARENA);
  const { flares, maxFlare } = run(layer, 600);
  expect(flares.length).toBeGreaterThan(10);
  for (const [, rumble] of flares) expect(rumble).toBe(0);
  expect(maxFlare).toBeGreaterThan(0.3);
  expect(maxFlare).toBeLessThanOrEqual(1);
});

it('starts no rumble or flare while the game is paused', () => {
  const layer = new TombDustLayer(new THREE.Scene());
  layer.setActive(true, ARENA);
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
