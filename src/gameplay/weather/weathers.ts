import type { BallArea } from '../arena/playAreas';
import type { WeatherPath } from './settings';
import { RAIN } from './rain/rainInfo';
import { SNOW } from './snow/snowInfo';
import { TOMB_DUST } from './dust/tombDustInfo';

/**
 * What a kind of weather is: its name, the paths it comes from and the settings a world starts with. Each weather
 * declares this in a small file of its own beside its class (snow/snowInfo.ts beside snow/Snow.ts), kept apart so
 * the simulation and world validation can read it without loading three.js.
 */
export interface WeatherInfo {
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
  /** Seconds between storms a world starts with (WeatherSettings.every). */
  readonly every: readonly [number, number];
  /** The paths a world starts with when it picks this weather (`ball` is its ball area). */
  defaultPaths(ball: BallArea): WeatherPath[];
}

/**
 * Every weather a world can pick, by the name saved in world files (WeatherSettings.kind). Its class, which does
 * everything it does, is listed under the same name in weatherTypes.ts.
 */
export const WEATHERS = {
  rain: RAIN,
  snow: SNOW,
  dust: TOMB_DUST,
} as const satisfies Record<string, WeatherInfo>;

export type WeatherKind = keyof typeof WEATHERS;

export const WEATHER_KINDS = Object.keys(WEATHERS) as WeatherKind[];

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === 'string' && Object.hasOwn(WEATHERS, value);
}
