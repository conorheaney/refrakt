import { expect, it } from 'vitest';
import { Fog } from '../src/gameplay/ambience/fog/Fog';
import { FOG_COLOR } from '../src/gameplay/ambience/fog/fogInfo';
import { validateAmbience } from '../src/gameplay/ambience/settings';
import { DT, settings, ambienceHarness } from './support/ambience';

const FLOOR = [
  { x: -18, y: -10 },
  { x: 18, y: -10 },
];
const LEDGE = [
  { x: 4, y: 3 },
  { x: 10, y: 3 },
];

function foggy() {
  const h = ambienceHarness('fog');
  h.ambience.start(settings('fog', [{ points: FLOOR }]));
  return h;
}

it('fills the space above each of its lines, and draws its slices clear of the play', () => {
  const { ambience } = ambienceHarness('fog');
  ambience.start(settings('fog', [{ points: FLOOR }, { points: LEDGE }]));
  expect(ambience.regions).toEqual([
    { left: -18, right: 18, y: -10 },
    { left: 4, right: 10, y: 3 },
  ]);
  // Two slices, the fewest that put fog both behind the bricks and in front of them, neither cutting through the
  // bricks (0.44 deep) or the paddle (1.15).
  const slices = ambience.slices;
  expect(slices).toHaveLength(2);
  expect(slices[0]).toBeLessThanOrEqual(-1.5);
  expect(slices[1]).toBeGreaterThanOrEqual(1.5);
});

it('veils the bricks and paddle about a third in the calm and two thirds in a fog bank', () => {
  const { ambience, run } = foggy();
  run(1);
  expect(ambience.cover).toBeCloseTo(0.35);
  ambience.pulse();
  let most = 0;
  run(25, true, () => (most = Math.max(most, ambience.cover)));
  expect(most).toBeGreaterThan(0.6);
  expect(most).toBeLessThanOrEqual(0.65);
  expect(ambience.cover).toBeCloseTo(0.35);
});

it('drifts in patches that grow thicker and faster in a fog bank, the way the bank blows', () => {
  const { ambience, run } = foggy();
  run(1);
  // A thick patch veils the bricks by up to two thirds in the calm, nine tenths in a full bank.
  expect(ambience.patchMax).toBeCloseTo(0.65);
  ambience.pulse();
  let most = 0;
  run(10, true, () => (most = Math.max(most, ambience.patchMax)));
  expect(most).toBeGreaterThan(0.85);
  expect(most).toBeLessThanOrEqual(0.9);
  // The wind blows from the side the bank came in from, and keeps blowing that way after it.
  const wind = ambience.wind;
  run(20);
  expect(ambience.surge).toBe(0);
  expect(ambience.wind).toBe(wind);
  const winds = new Set<number>();
  for (let i = 0; i < 20; i++) {
    ambience.pulse();
    winds.add(ambience.wind);
    run(20);
  }
  expect(winds.size).toBe(2);
});

it("takes the world's colour and thickness", () => {
  const { ambience, run } = foggy();
  run(1);
  expect(ambience.color).toBe(FOG_COLOR);
  ambience.start({ ...settings('fog', [{ points: FLOOR }]), options: { color: '#88aa66', thickness: 1.5 } });
  expect(ambience.color).toBe('#88aa66');
  // Half as thick again is half as dense again: what shows through is 0.65 to the power 1.5.
  expect(ambience.cover).toBeCloseTo(1 - 0.65 ** 1.5);
  expect(ambience.regions).toEqual([{ left: -18, right: 18, y: -10 }]);
  // However thick, a patch never covers more than the game can be played through.
  ambience.start({ ...settings('fog', [{ points: FLOOR }]), options: { thickness: 1.8 } });
  ambience.pulse();
  let most = 0;
  run(25, true, () => (most = Math.max(most, ambience.cover)));
  expect(most).toBeLessThanOrEqual(0.9);
});

it('saves only the settings fog has, within their ranges', () => {
  const fog = settings('fog', [{ points: FLOOR }]);
  expect(validateAmbience({ ...fog, options: { color: '#AABBCC', thickness: 0.5 } }).options).toEqual({
    color: '#aabbcc',
    thickness: 0.5,
  });
  expect(validateAmbience(fog)).not.toHaveProperty('options');
  expect(() => validateAmbience({ ...fog, options: { color: 'grey' } })).toThrow('colour');
  expect(() => validateAmbience({ ...fog, options: { thickness: 5 } })).toThrow('between');
  expect(() => validateAmbience({ ...fog, options: { glow: 1 } })).toThrow('no setting');
  expect(() => validateAmbience({ ...settings('rain', [{ points: FLOOR }]), options: { thickness: 1 } })).toThrow(
    'no setting',
  );
});

it('starts along the floor by default, and plays its drone while it may be heard', () => {
  const { ambience, audio, state, run } = ambienceHarness('fog');
  ambience.start(settings('fog', Fog.info.defaultPaths(undefined as never)));
  expect(audio.wanted).toEqual(new Set(Object.keys(Fog.samples)));
  expect(ambience.regions[0].y).toBeLessThan(-9);
  run(DT);
  expect(audio.loops.get('fogDrone')).toBeGreaterThan(0);
  state.soundOn = false;
  run(DT);
  expect(audio.loops.get('fogDrone')).toBe(0);
  state.soundOn = true;
  run(DT);
  ambience.stop();
  expect(audio.loops.get('fogDrone')).toBe(0);
});

it('rolls a fog bank in on each pulse, with a foghorn, whispers and ghost lights, then clears', () => {
  const { ambience, audio, scene, run } = foggy();
  run(2);
  expect(ambience.surge).toBe(0);
  ambience.pulse();
  const surges: number[] = [];
  let ghosts = 0;
  let darkest = 1;
  run(30, true, () => {
    surges.push(ambience.surge);
    ghosts = Math.max(ghosts, ambience.ghostLights);
    darkest = Math.min(darkest, scene.backgroundIntensity);
  });
  expect(Math.max(...surges)).toBeGreaterThan(0.8);
  expect(surges[surges.length - 1]).toBe(0);
  expect(ghosts).toBeGreaterThanOrEqual(3);
  expect(darkest).toBeLessThan(0.8);
  expect(scene.backgroundIntensity).toBe(1);
  expect(audio.samples.filter((s) => s.startsWith('foghorn'))).toHaveLength(1);
  expect(audio.samples).toContain('whispers');
  // The drone swells with the bank and settles after it.
  expect(audio.loops.get('fogDrone')).toBeLessThan(1);
});

it('lets one fog bank play out before another can come', () => {
  const { ambience, audio, run } = foggy();
  run(1);
  ambience.pulse();
  run(3);
  ambience.pulse();
  run(25);
  expect(audio.samples.filter((s) => s.startsWith('foghorn'))).toHaveLength(1);
});

it('tolls a far-off bell in the calm, only while the game runs', () => {
  const { ambience, audio, run } = foggy();
  run(60, false);
  expect(audio.samples).not.toContain('bellToll');
  run(60);
  expect(audio.samples).toContain('bellToll');
  expect(ambience.surge).toBe(0);
});

it('is silent while its sound is off, and calm again once stopped', () => {
  const { ambience, audio, state, scene, run } = foggy();
  state.soundOn = false;
  ambience.pulse();
  run(5);
  expect(ambience.surge).toBeGreaterThan(0);
  run(115);
  expect(audio.played).toHaveLength(0);
  ambience.pulse();
  run(5);
  ambience.stop();
  expect(ambience.surge).toBe(0);
  expect(ambience.ghostLights).toBe(0);
  expect(scene.backgroundIntensity).toBe(1);
});
