import { expect, it } from 'vitest';
import { Rain } from '../src/gameplay/ambience/rain/Rain';
import { DT, onLine, settings, ambienceHarness } from './support/ambience';

const LINE = [
  { x: -8, y: 9 },
  { x: 8, y: 11 },
];

function raining() {
  const h = ambienceHarness('rain');
  h.ambience.start(settings('rain', [{ points: LINE }]));
  return h;
}

it('falls from its lines, more of it from longer ones', () => {
  const { ambience } = raining();
  expect(ambience.drops).toBeGreaterThan(100);
  for (let i = 0; i < ambience.drops; i++) {
    const { x, y } = ambience.drop(i);
    expect(onLine(LINE, x, y)).toBe(true);
  }
  const short = ambienceHarness('rain').ambience;
  short.start(
    settings('rain', [
      {
        points: [
          { x: 0, y: 9 },
          { x: 4, y: 9 },
        ],
      },
    ]),
  );
  expect(short.drops).toBeLessThan(ambience.drops / 2);
});

it('starts from the top of the scene by default, and plays its loop while it may be heard', () => {
  const { ambience, audio, state, run } = ambienceHarness('rain');
  ambience.start(settings('rain', Rain.info.defaultPaths(undefined as never)));
  expect(audio.wanted).toEqual(new Set(Object.keys(Rain.samples)));
  run(DT);
  expect(audio.loops.get('rainHeavy')).toBeGreaterThan(0);
  state.soundOn = false;
  run(DT);
  expect(audio.loops.get('rainHeavy')).toBe(0);
  state.soundOn = true;
  run(DT);
  ambience.stop();
  expect(audio.loops.get('rainHeavy')).toBe(0);
});

it('strikes lightning on each pulse: a flash and a weaker one, then thunder', () => {
  const { ambience, audio, run } = raining();
  run(1);
  expect(ambience.flash).toBe(0);
  const before = audio.samples.length;
  ambience.pulse();
  const flashes: number[] = [0];
  run(3, true, () => flashes.push(ambience.flash));
  expect(Math.max(...flashes)).toBeGreaterThan(0.5);
  expect(Math.max(...flashes)).toBeLessThanOrEqual(1.6);
  // Two flashes, at least 0.35 s apart (well under three in any one second).
  const starts = flashes.flatMap((f, i) => (i > 0 && f - flashes[i - 1] > 0.1 ? [i * DT] : []));
  expect(starts).toHaveLength(2);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(0.3);
  // Over within a couple of seconds.
  expect(flashes[flashes.length - 1]).toBe(0);
  expect(audio.samples.slice(before)).toContain('thunderClose');
});

it('lights nothing while clear, and stops a flash at once when the world changes', () => {
  const { ambience, run, scene } = ambienceHarness('rain');
  ambience.pulse();
  run(1);
  expect(ambience.flash).toBe(0);
  ambience.start(settings('rain', [{ points: LINE }]));
  ambience.pulse();
  run(0.1);
  expect(ambience.flash).toBeGreaterThan(0.3);
  expect(scene.backgroundIntensity).toBeGreaterThan(1);
  ambience.stop();
  expect(ambience.flash).toBe(0);
  expect(scene.backgroundIntensity).toBe(1);
});
