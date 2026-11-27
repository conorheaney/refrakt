import { expect, it } from 'vitest';
import tomb from '../public/worlds/Pharoughs-Tomb.json';
import { validateWorld } from '../src/content/authoredWorlds';
import { envelope } from '../src/gameplay/ambience/Ambience';
import { Dust } from '../src/gameplay/ambience/dust/Dust';
import { DT, onLine, settings, ambienceHarness } from './support/ambience';

/** Pharoughs Tomb's ambience: its dust pours from the line drawn for it in the editor. */
const TOMB = validateWorld(tomb).ambience!;
const LINE = TOMB.paths[0].points;

function dusty() {
  const h = ambienceHarness('dust');
  h.ambience.start(TOMB);
  return h;
}

it('the Pharoughs Tomb has dust, and its scarabs come with each pulse', () => {
  expect(TOMB.kind).toBe('dust');
  expect(validateWorld(tomb).hazardCues).toEqual({ scarabs: 'pulse' });
  expect(LINE.length).toBeGreaterThanOrEqual(2);
});

it("pours Pharoughs Tomb's dust from the line drawn for it", () => {
  const { ambience } = ambienceHarness('dust');
  ambience.start({ ...TOMB, paths: [{ points: LINE }] }); // as drawn, without its curve
  for (const g of ambience.grains()) expect(onLine(LINE, g.x, g.y)).toBe(true);
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
  const { ambience } = ambienceHarness('dust');
  ambience.start(settings('dust', [{ points: bent }, { points: short }]));
  const all = ambience.grains();
  for (const g of all) expect(onLine(bent, g.x, g.y) || onLine(short, g.x, g.y)).toBe(true);
  // The veils come from at most 26 places (the cracks); the specks and grit are spread all along both lines.
  expect(new Set(all.filter((g) => g.veil).map((g) => `${g.x},${g.y}`)).size).toBeLessThanOrEqual(26);
  const loose = all.filter((g) => !g.veil);
  expect(Math.min(...loose.map((g) => g.x))).toBeLessThan(-9.5);
  expect(loose.some((g) => g.y > 8.9)).toBe(true);
  expect(loose.some((g) => g.x > 17.5)).toBe(true);
});

it('starts a new dust line just under the top of the ball area', () => {
  const ball = {
    points: [
      { x: -14, y: -9 },
      { x: 14, y: -9 },
      { x: 14, y: 10.4 },
      { x: -14, y: 10.4 },
    ],
  };
  expect(Dust.info.defaultPaths(ball as never)).toEqual([
    {
      points: [
        { x: -12.5, y: 10.4 - 1.15 },
        { x: 12.5, y: 10.4 - 1.15 },
      ],
    },
  ]);
});

it('on a pulse grinds the stone gate, then a moment later shakes and pours its dust', () => {
  const { ambience, audio, shakes, run } = dusty();
  run(2);
  expect(ambience.rumble).toBe(0);
  ambience.pulse();
  expect(audio.samples).toContain('stoneGate');
  const rumble: number[] = [];
  run(9, true, () => rumble.push(ambience.rumble));
  const first = rumble.findIndex((r) => r > 0);
  expect(first * DT).toBeGreaterThan(0.9);
  expect(first * DT).toBeLessThan(1.2);
  expect(Math.max(...rumble)).toBeGreaterThan(0.8);
  expect(Math.max(...rumble)).toBeLessThanOrEqual(1);
  expect(rumble[rumble.length - 1]).toBe(0);
  expect(shakes.length).toBeGreaterThan(0);
});

it('flares the torches now and then, never while a pulse is under way', () => {
  const { ambience, run } = dusty();
  const flares: [number, number][] = [];
  let pulsey = 0;
  let last = 0;
  let t = 0;
  run(600, true, () => {
    t += DT;
    // A pulse every 30 seconds.
    if (Math.floor(t / 30) !== Math.floor((t - DT) / 30)) ambience.pulse();
    if (ambience.flare > 0 && last === 0) flares.push([t, pulsey]);
    pulsey = ambience.rumble;
    last = ambience.flare;
  });
  expect(flares.length).toBeGreaterThan(10);
  for (const [, rumble] of flares) expect(rumble).toBe(0);
  expect(ambience.torches.x).toBeGreaterThan(0.3);
});

it('starts no flare while the game is paused', () => {
  const { ambience, run } = dusty();
  let flared = false;
  run(120, false, () => (flared ||= ambience.flare > 0));
  expect(flared).toBe(false);
});

it('swells, holds and dies away', () => {
  expect(envelope(-1, 0.4, 2, 1.6)).toBe(0);
  expect(envelope(0.2, 0.4, 2, 1.6)).toBeCloseTo(0.5);
  expect(envelope(1, 0.4, 2, 1.6)).toBe(1);
  expect(envelope(4.1, 0.4, 2, 1.6)).toBe(0);
});
