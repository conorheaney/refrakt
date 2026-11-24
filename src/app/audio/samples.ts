import rainHeavy from '../../themes/weather/rain/sfx/rain-heavy.mp3';
import refraktEnd from '../../gameplay/refrakt/sfx/refrakt-end.wav';
import refraktHum from '../../gameplay/refrakt/sfx/refrakt-hum.wav';
import refraktShatter from '../../gameplay/refrakt/sfx/refrakt-shatter.wav';
import refraktStart from '../../gameplay/refrakt/sfx/refrakt-start.wav';
import scarabCrunch from '../../gameplay/hazards/scarabs/sfx/scarab-crunch.wav';
import snakeBite from '../../gameplay/hazards/snakes/sfx/snake-bite.wav';
import snakeRattle from '../../gameplay/hazards/snakes/sfx/snake-rattle.wav';
import snakeStrike from '../../gameplay/hazards/snakes/sfx/snake-strike.wav';
import stoneGate from '../../themes/weather/dust/sfx/stone-gate.wav';
import thunderClose from '../../themes/weather/rain/sfx/thunder-close.mp3';
import thunderDistant1 from '../../themes/weather/rain/sfx/thunder-distant-1.mp3';
import thunderDistant2 from '../../themes/weather/rain/sfx/thunder-distant-2.mp3';
import winterStorm from '../../themes/weather/snow/sfx/winter-storm.mp3';

/** Recorded effects (sources and licences: src/app/audio/SOUND_CREDITS.md), keyed by the name AudioDirector plays. */
export const SAMPLE_URLS = {
  rainHeavy,
  refraktEnd,
  refraktHum,
  refraktShatter,
  refraktStart,
  scarabCrunch,
  snakeBite,
  snakeRattle,
  snakeStrike,
  stoneGate,
  thunderClose,
  thunderDistant1,
  thunderDistant2,
  winterStorm,
} as const;

export type SampleName = keyof typeof SAMPLE_URLS;
