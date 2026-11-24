import * as THREE from 'three';
import { expect, it } from 'vitest';
import { RainLayer } from '../src/themes/weather/rain/RainLayer';

const DT = 1 / 60;

/** Runs the layer for `seconds` and records each frame's flash level and every thunder call. */
function run(rain: RainLayer, seconds: number, simulating = true): { flashes: number[]; thunder: [number, number][] } {
  const flashes: number[] = [];
  const thunder: [number, number][] = [];
  rain.onThunder = (delay, strength) => thunder.push([delay, strength]);
  for (let t = 0; t < seconds; t += DT) {
    rain.update(DT, simulating ? DT : 0);
    flashes.push(rain.flash);
  }
  return { flashes, thunder };
}

it('strikes soon after entering a rainy world, then every 18-38 seconds, with thunder after each flash', () => {
  const rain = new RainLayer(new THREE.Scene());
  rain.setActive(true);
  // Record the time of each strike (its thunder call) over several minutes.
  const strikes: number[] = [];
  const calls: [number, number][] = [];
  const flashes: number[] = [];
  let now = 0;
  rain.onThunder = (delay, strength) => { strikes.push(now); calls.push([delay, strength]); };
  for (let i = 0; i < 300 / DT; i++) {
    now = (i + 1) * DT;
    rain.update(DT, DT);
    flashes.push(rain.flash);
  }
  expect(strikes[0]).toBeGreaterThanOrEqual(5 - DT);
  expect(strikes[0]).toBeLessThanOrEqual(10 + DT);
  for (let i = 1; i < strikes.length; i++) {
    expect(strikes[i] - strikes[i - 1]).toBeGreaterThanOrEqual(18 - DT);
    expect(strikes[i] - strikes[i - 1]).toBeLessThanOrEqual(38 + DT);
  }
  expect(Math.max(...flashes)).toBeGreaterThan(0.5);
  expect(Math.max(...flashes)).toBeLessThanOrEqual(1.6);
  for (const [delay, strength] of calls) {
    expect(delay).toBeGreaterThan(0.25);
    expect(strength).toBeGreaterThan(0.5);
  }
  // Each flash is over well before the next strike.
  const firstFrame = Math.round(strikes[0] / DT);
  expect(flashes[firstFrame + Math.round(3 / DT)]).toBe(0);
});

it('never flashes more than three times in any one second', () => {
  const rain = new RainLayer(new THREE.Scene());
  rain.setActive(true);
  const { flashes } = run(rain, 600);
  // A flash starts on a frame where brightness jumps up sharply.
  const starts: number[] = [];
  flashes.forEach((f, i) => { if (i > 0 && f - flashes[i - 1] > 0.1) starts.push(i * DT); });
  expect(starts.length).toBeGreaterThan(15);
  for (let i = 3; i < starts.length; i++) expect(starts[i] - starts[i - 3]).toBeGreaterThan(1);
});

it('starts no lightning while the game is paused, and none at all without rain', () => {
  const paused = new RainLayer(new THREE.Scene());
  paused.setActive(true);
  expect(run(paused, 60, false).thunder).toHaveLength(0);
  const clear = new RainLayer(new THREE.Scene());
  const { flashes, thunder } = run(clear, 60);
  expect(thunder).toHaveLength(0);
  expect(flashes.every((f) => f === 0)).toBe(true);
});

it('stops a flash immediately when leaving the rainy world', () => {
  const rain = new RainLayer(new THREE.Scene());
  rain.setActive(true);
  for (let i = 0; i < 700 && rain.flash < 0.3; i++) rain.update(DT, DT);
  expect(rain.flash).toBeGreaterThanOrEqual(0.3);
  rain.setActive(false);
  expect(rain.flash).toBe(0);
  run(rain, 1);
  expect(rain.flash).toBe(0);
});
