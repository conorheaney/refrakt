import { expect, it } from 'vitest';
import { CORE_SAMPLES, SAMPLE_URLS, worldSamples, type SampleName } from '../src/app/audio/samples';
import { AMBIENCE_TYPES } from '../src/gameplay/ambience/ambienceTypes';
import { SHIPPED_CAMPAIGN } from './support/worlds';

const byWorld = Object.fromEntries(SHIPPED_CAMPAIGN.worlds.map((w) => [w.def.name, worldSamples(w).sort()]));

it("loads each world's hazard sounds with it, and only those", () => {
  expect(byWorld['Jungle Ruins']).toEqual(['snakeBite', 'snakeRattle', 'snakeStrike']);
  expect(byWorld['Pharoughs Tomb']).toEqual(['scarabCrunch']);
  for (const name of ['Frozen Sanctuary', 'Outer Space', 'The Verdant Hollow', 'Atlantis', 'Volcanic Forge'])
    expect(byWorld[name]).toEqual([]);
});

it('gives every recorded sound a reason to load (core, or a hazard that uses it)', () => {
  const covered = new Set<SampleName>(CORE_SAMPLES);
  const world = { hazards: [{ kind: 'snake' }, { kind: 'scarabs' }] } as unknown as Parameters<typeof worldSamples>[0];
  for (const name of worldSamples(world)) covered.add(name);
  expect([...covered].sort()).toEqual(Object.keys(SAMPLE_URLS).sort());
});

it("keeps each ambience's recordings with the ambience, under names no other sound uses", () => {
  const names = Object.values(AMBIENCE_TYPES).flatMap((w) => Object.keys(w.samples));
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name in SAMPLE_URLS).toBe(false);
  expect(Object.keys(AMBIENCE_TYPES.rain.samples).sort()).toEqual(
    ['rainHeavy', 'thunderClose', 'thunderDistant1', 'thunderDistant2'].sort(),
  );
  expect(Object.keys(AMBIENCE_TYPES.snow.samples)).toEqual(['winterStorm']);
  expect(Object.keys(AMBIENCE_TYPES.dust.samples)).toEqual(['stoneGate']);
});
