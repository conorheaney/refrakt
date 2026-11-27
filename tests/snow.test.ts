import { expect, it } from 'vitest';
import { onLine, settings, ambienceHarness } from './support/ambience';

const WINDOW = [
  { x: -12, y: 6 },
  { x: -6, y: 7 },
];
const ROOF = [
  { x: 2, y: 11 },
  { x: 18, y: 11 },
];

it('falls from each of its lines and blows about only under that line', () => {
  const { ambience } = ambienceHarness('snow');
  ambience.start(settings('snow', [{ points: WINDOW }, { points: ROOF }]));
  expect(ambience.flakes).toBeGreaterThan(200);
  let fromWindow = 0;
  for (let i = 0; i < ambience.flakes; i++) {
    const f = ambience.flake(i);
    const line = onLine(WINDOW, f.x, f.y) ? WINDOW : ROOF;
    expect(onLine(line, f.x, f.y)).toBe(true);
    if (line === WINDOW) fromWindow++;
    // Its band covers its own line (and a little either side), not the other.
    expect(f.left).toBeLessThan(line[0].x);
    expect(f.left + f.width).toBeGreaterThan(line[1].x);
    expect(f.width).toBeLessThan(line[1].x - line[0].x + 8);
  }
  // Each place along the lines is as likely as any other: the longer roof gives more snow.
  expect(fromWindow).toBeGreaterThan(ambience.flakes * 0.15);
  expect(fromWindow).toBeLessThan(ambience.flakes * 0.45);
});

it('gusts in pairs on each pulse, with a howl, and is calm in between', () => {
  const { ambience, audio, run } = ambienceHarness('snow');
  ambience.start(settings('snow', [{ points: ROOF }]));
  run(5);
  expect(ambience.gust).toBe(0);
  ambience.pulse();
  const gusts: number[] = [];
  run(30, true, () => gusts.push(ambience.gust));
  expect(Math.max(...gusts)).toBeGreaterThan(0.5);
  // Two separate gusts: up, calm, up again.
  const rises = gusts.filter((g, i) => i > 0 && g > 0.02 && gusts[i - 1] <= 0.02).length;
  expect(rises).toBe(2);
  expect(gusts[gusts.length - 1]).toBe(0);
  expect(audio.samples.filter((s) => s === 'winterStorm')).toHaveLength(2);
});

it('lifts spindrift off the bricks under it in a gust, and not between gusts', () => {
  const { ambience, run } = ambienceHarness('snow');
  ambience.start(settings('snow', [{ points: ROOF }]));
  const particles = (ambience as unknown as { ctx: { particles: unknown } }).ctx.particles;
  const live = (): number => (particles as { count: number }).count;
  run(2);
  expect(live()).toBe(0);
  ambience.pulse();
  run(3);
  expect(live()).toBeGreaterThan(0);
});

it('is silent while its sound is off', () => {
  const { ambience, audio, state, run } = ambienceHarness('snow');
  state.soundOn = false;
  ambience.start(settings('snow', [{ points: ROOF }]));
  ambience.pulse();
  run(120);
  expect(audio.played).toHaveLength(0);
});
