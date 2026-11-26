import type { Weather, WeatherContext } from './Weather';
import type { WeatherKind } from './weathers';
import { Rain } from './rain/Rain';
import { Snow } from './snow/Snow';
import { TombDust } from './dust/TombDust';

/** A kind of weather's class: what it does, and the recordings it plays (loaded only when it is used). */
export interface WeatherType {
  readonly samples: Readonly<Record<string, string>>;
  new (ctx: WeatherContext): Weather;
}

/** The class for each weather in WEATHERS (weathers.ts). */
export const WEATHER_TYPES = {
  rain: Rain,
  snow: Snow,
  dust: TombDust,
} as const satisfies Record<WeatherKind, WeatherType>;
