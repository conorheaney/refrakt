import type { WorldEntry } from '../../content/campaign';
import refraktEnd from '../../gameplay/refrakt/sfx/refrakt-end.mp3';
import refraktHum from '../../gameplay/refrakt/sfx/refrakt-hum.mp3';
import refraktShatter from '../../gameplay/refrakt/sfx/refrakt-shatter.mp3';
import refraktStart from '../../gameplay/refrakt/sfx/refrakt-start.mp3';
import scarabCrunch from '../../gameplay/hazards/scarabs/sfx/scarab-crunch.wav';
import snakeBite from '../../gameplay/hazards/snakes/sfx/snake-bite.wav';
import snakeRattle from '../../gameplay/hazards/snakes/sfx/snake-rattle.wav';
import snakeStrike from '../../gameplay/hazards/snakes/sfx/snake-strike.wav';

/** Recorded effects (sources and licences: src/app/audio/SOUND_CREDITS.md), keyed by the name AudioDirector plays. */
export const SAMPLE_URLS = {
  refraktEnd,
  refraktHum,
  refraktShatter,
  refraktStart,
  scarabCrunch,
  snakeBite,
  snakeRattle,
  snakeStrike,
} as const;

export type SampleName = keyof typeof SAMPLE_URLS;

/** Sounds any world can play (Refrakt's): loaded as soon as audio starts. */
export const CORE_SAMPLES: readonly SampleName[] = ['refraktStart', 'refraktEnd', 'refraktHum', 'refraktShatter'];

/**
 * The recorded sounds a world's hazards need beyond the core ones: loaded when one of its levels loads, so a
 * player who never meets a snake never downloads (or decodes) its hiss. Ambience loads its own the same way
 * (each ambience class's samples, in gameplay/ambience/).
 */
export function worldSamples(world: Pick<WorldEntry, 'hazards'>): SampleName[] {
  const names = new Set<SampleName>();
  for (const hazard of world.hazards ?? []) {
    if (hazard.kind === 'snake')
      for (const name of ['snakeBite', 'snakeRattle', 'snakeStrike'] as const) names.add(name);
    if (hazard.kind === 'scarabs') names.add('scarabCrunch');
  }
  return [...names];
}
