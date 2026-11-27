import type { BallArea } from '../arena/playAreas';
import type { AmbiencePath } from './settings';
import { RAIN } from './rain/rainInfo';
import { SNOW } from './snow/snowInfo';
import { DUST } from './dust/dustInfo';

/**
 * What a kind of ambience is: its name, the paths it comes from and the settings a world starts with. Each ambience
 * declares this in a small file of its own beside its class (snow/snowInfo.ts beside snow/Snow.ts), kept apart so
 * the simulation and world validation can read it without loading three.js.
 */
export interface AmbienceInfo {
  /** Shown in the editor. */
  readonly label: string;
  readonly paths: {
    /** Fewest paths it can be played with, and most it takes. */
    readonly min: number;
    readonly max: number;
    /** Depth (z) of the plane its paths are drawn on: where it comes from in the scene. */
    readonly depth: number;
    /** What one path is called ("snow line"). */
    readonly noun: string;
    /** How to draw them, for the editor. */
    readonly hint: string;
  };
  /** Seconds between pulses a world starts with (AmbienceSettings.every). */
  readonly every: readonly [number, number];
  /** The paths a world starts with when it picks this ambience (`ball` is its ball area). */
  defaultPaths(ball: BallArea): AmbiencePath[];
}

/**
 * Every ambience a world can pick, by the name saved in world files (AmbienceSettings.kind). Its class, which does
 * everything it does, is listed under the same name in ambienceTypes.ts.
 */
export const AMBIENCES = {
  rain: RAIN,
  snow: SNOW,
  dust: DUST,
} as const satisfies Record<string, AmbienceInfo>;

export type AmbienceKind = keyof typeof AMBIENCES;

export const AMBIENCE_KINDS = Object.keys(AMBIENCES) as AmbienceKind[];

export function isAmbienceKind(value: unknown): value is AmbienceKind {
  return typeof value === 'string' && Object.hasOwn(AMBIENCES, value);
}
