import { expect, it } from 'vitest';
import { CORE_SAMPLES, SAMPLE_URLS, worldSamples, type SampleName } from '../src/app/audio/samples';
import { SHIPPED_CAMPAIGN } from './support/worlds';

const byWorld = Object.fromEntries(SHIPPED_CAMPAIGN.worlds.map((w) => [w.def.name, worldSamples(w).sort()]));

it("loads each world's weather and hazard sounds with it, and only those", () => {
  expect(byWorld['Jungle Ruins']).toEqual(
    [
      'rainHeavy',
      'snakeBite',
      'snakeRattle',
      'snakeStrike',
      'thunderClose',
      'thunderDistant1',
      'thunderDistant2',
    ].sort(),
  );
  expect(byWorld['Frozen Sanctuary']).toEqual(['winterStorm']);
  expect(byWorld['Pharoughs Tomb']).toEqual(['scarabCrunch', 'stoneGate']);
  for (const name of ['Outer Space', 'The Verdant Hollow', 'Atlantis', 'Volcanic Forge'])
    expect(byWorld[name]).toEqual([]);
});

it('gives every recorded sound a reason to load (core, or a weather or hazard that uses it)', () => {
  const covered = new Set<SampleName>(CORE_SAMPLES);
  const kinds = [
    { def: { weather: 'rain' }, hazards: [] },
    { def: { weather: 'snow' }, hazards: [] },
    { def: {}, hazards: [{ kind: 'snake' }, { kind: 'scarabs' }] },
  ] as unknown as Parameters<typeof worldSamples>[0][];
  for (const world of kinds) for (const name of worldSamples(world)) covered.add(name);
  expect([...covered].sort()).toEqual(Object.keys(SAMPLE_URLS).sort());
});
