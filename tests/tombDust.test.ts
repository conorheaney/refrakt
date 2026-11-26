import { expect, it } from 'vitest';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { validateWorld } from '../src/content/authoredWorlds';
import { envelope } from '../src/gameplay/weather/Weather';
import { TombDust } from '../src/gameplay/weather/dust/TombDust';
import { DT, onLine, settings, weatherHarness } from './support/weather';

/** Pharoughs Tomb's weather: its dust pours from the line drawn for it in the editor. */
const TOMB = validateWorld(tomb).weather!;
const LINE = TOMB.paths[0].points;

function dusty() {
  const h = weatherHarness('dust');
  h.weather.start(TOMB);
  return h;
}

it('the Pharoughs Tomb has tomb dust, and each storm brings its scarabs', () => {
  expect(TOMB.kind).toBe('dust');
  expect(TOMB.releases).toEqual(['scarabs']);
  expect(LINE.length).toBeGreaterThanOrEqual(2);
});

it("pours Pharoughs Tomb's dust from the line drawn for it", () => {
  const { weather } = weatherHarness('dust');
  weather.start({ ...TOMB, paths: [{ points: LINE }] }); // as drawn, without its curve
  for (const g of weather.grains()) expect(onLine(LINE, g.x, g.y)).toBe(true);
});

it('starts every falling grain on its lines: veils at the cracks, specks and grit anywhere along them', () => {
  // A bent line: up from the left, across, and down to the right; and a short second one.
  const bent = [
    { x: -10, y: 6 },
    { x: -6, y: 9 },
    { x: 6, y: 9 },
    { x: 10, y: 6 },
  ];
  const short = [
    { x: 14, y: 4 },
    { x: 18, y: 4 },
  ];
  const { weather } = weatherHarness('dust');
  weather.start(settings('dust', [{ points: bent }, { points: short }]));
  const all = weather.grains();
  for (const g of all) expect(onLine(bent, g.x, g.y) || onLine(short, g.x, g.y)).toBe(true);
  // The veils come from at most 26 places (the cracks); the specks and grit are spread all along both lines.
  expect(new Set(all.filter((g) => g.veil).map((g) => `${g.x},${g.y}`)).size).toBeLessThanOrEqual(26);
  const loose = all.filter((g) => !g.veil);
  expect(Math.min(...loose.map((g) => g.x))).toBeLessThan(-9.5);
  expect(loose.some((g) => g.y > 8.9)).toBe(true);
  expect(loose.some((g) => g.x > 17.5)).toBe(true);
});

it('starts a new tomb dust line just under the top of the ball area', () => {
  const ball = {
    points: [
      { x: -14, y: -9 },
      { x: 14, y: -9 },
      { x: 14, y: 10.4 },
      { x: -14, y: 10.4 },
    ],
  };
  expect(TombDust.info.defaultPaths(ball as never)).toEqual([
    {
      points: [
        { x: -12.5, y: 10.4 - 1.15 },
        { x: 12.5, y: 10.4 - 1.15 },
      ],
    },
  ]);
});

it('on a storm grinds the stone gate, then a moment later shakes and pours its dust', () => {
  const { weather, audio, shakes, run } = dusty();
  run(2);
  expect(weather.rumble).toBe(0);
  weather.storm();
  expect(audio.samples).toContain('stoneGate');
  const rumble: number[] = [];
  run(9, true, () => rumble.push(weather.rumble));
  const first = rumble.findIndex((r) => r > 0);
  expect(first * DT).toBeGreaterThan(0.9);
  expect(first * DT).toBeLessThan(1.2);
  expect(Math.max(...rumble)).toBeGreaterThan(0.8);
  expect(Math.max(...rumble)).toBeLessThanOrEqual(1);
  expect(rumble[rumble.length - 1]).toBe(0);
  expect(shakes.length).toBeGreaterThan(0);
});

it('flares the torches now and then, never while a storm is under way', () => {
  const { weather, run } = dusty();
  const flares: [number, number][] = [];
  let stormy = 0;
  let last = 0;
  let t = 0;
  run(600, true, () => {
    t += DT;
    // A storm every 30 seconds.
    if (Math.floor(t / 30) !== Math.floor((t - DT) / 30)) weather.storm();
    if (weather.flare > 0 && last === 0) flares.push([t, stormy]);
    stormy = weather.rumble;
    last = weather.flare;
  });
  expect(flares.length).toBeGreaterThan(10);
  for (const [, rumble] of flares) expect(rumble).toBe(0);
  expect(weather.torches.x).toBeGreaterThan(0.3);
});

it('starts no flare while the game is paused', () => {
  const { weather, run } = dusty();
  let flared = false;
  run(120, false, () => (flared ||= weather.flare > 0));
  expect(flared).toBe(false);
});

it('swells, holds and dies away', () => {
  expect(envelope(-1, 0.4, 2, 1.6)).toBe(0);
  expect(envelope(0.2, 0.4, 2, 1.6)).toBeCloseTo(0.5);
  expect(envelope(1, 0.4, 2, 1.6)).toBe(1);
  expect(envelope(4.1, 0.4, 2, 1.6)).toBe(0);
});
