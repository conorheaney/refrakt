import { expect, it } from 'vitest';
import { onLine, settings, weatherHarness } from './support/weather';

const WINDOW = [
  { x: -12, y: 6 },
  { x: -6, y: 7 },
];
const ROOF = [
  { x: 2, y: 11 },
  { x: 18, y: 11 },
];

it('falls from each of its lines and blows about only under that line', () => {
  const { weather } = weatherHarness('snow');
  weather.start(settings('snow', [{ points: WINDOW }, { points: ROOF }]));
  expect(weather.flakes).toBeGreaterThan(200);
  let fromWindow = 0;
  for (let i = 0; i < weather.flakes; i++) {
    const f = weather.flake(i);
    const line = onLine(WINDOW, f.x, f.y) ? WINDOW : ROOF;
    expect(onLine(line, f.x, f.y)).toBe(true);
    if (line === WINDOW) fromWindow++;
    // Its band covers its own line (and a little either side), not the other.
    expect(f.left).toBeLessThan(line[0].x);
    expect(f.left + f.width).toBeGreaterThan(line[1].x);
    expect(f.width).toBeLessThan(line[1].x - line[0].x + 8);
  }
  // Each place along the lines is as likely as any other: the longer roof gives more snow.
  expect(fromWindow).toBeGreaterThan(weather.flakes * 0.15);
  expect(fromWindow).toBeLessThan(weather.flakes * 0.45);
});

it('gusts in pairs on each storm, with a howl, and is calm in between', () => {
  const { weather, audio, run } = weatherHarness('snow');
  weather.start(settings('snow', [{ points: ROOF }]));
  run(5);
  expect(weather.gust).toBe(0);
  weather.storm();
  const gusts: number[] = [];
  run(30, true, () => gusts.push(weather.gust));
  expect(Math.max(...gusts)).toBeGreaterThan(0.5);
  // Two separate gusts: up, calm, up again.
  const rises = gusts.filter((g, i) => i > 0 && g > 0.02 && gusts[i - 1] <= 0.02).length;
  expect(rises).toBe(2);
  expect(gusts[gusts.length - 1]).toBe(0);
  expect(audio.samples.filter((s) => s === 'winterStorm')).toHaveLength(2);
});

it('lifts spindrift off the bricks under it in a gust, and not between gusts', () => {
  const { weather, run } = weatherHarness('snow');
  weather.start(settings('snow', [{ points: ROOF }]));
  const particles = (weather as unknown as { ctx: { particles: unknown } }).ctx.particles;
  const live = (): number => (particles as { count: number }).count;
  run(2);
  expect(live()).toBe(0);
  weather.storm();
  run(3);
  expect(live()).toBeGreaterThan(0);
});

it('is silent while its sound is off', () => {
  const { weather, audio, state, run } = weatherHarness('snow');
  state.soundOn = false;
  weather.start(settings('snow', [{ points: ROOF }]));
  weather.storm();
  run(120);
  expect(audio.played).toHaveLength(0);
});
