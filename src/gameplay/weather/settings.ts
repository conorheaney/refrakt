import { MAX_PATH_RADIUS } from '../../engine/core/paths';
import type { BallArea } from '../arena/playAreas';
import { RELEASABLE_HAZARDS, type HazardDef, type ReleasableHazard } from '../hazards/hazards';
import { WEATHERS, isWeatherKind, type WeatherKind } from './weathers';

/**
 * A world's weather as it is saved (AuthoredWorld.weather): which weather it is, where it comes from, how often
 * its storms come and what they bring. A weather can be given to any world: these settings are all it needs
 * (each weather's WeatherInfo says how many paths it takes and what it starts with).
 */
export interface WeatherSettings {
  readonly kind: WeatherKind;
  /** Where it comes from (snow falls from them, tomb dust pours from them), drawn in the editor. */
  readonly paths: readonly WeatherPath[];
  /**
   * Seconds between storms (a gust, a lightning strike, the tomb shaking) on a world's first level, shortest
   * and longest; they come up to a third sooner by its last level. They only count down while the ball is in
   * play (gameplay/weather/WeatherClock.ts).
   */
  readonly every: readonly [number, number];
  /** Hazards that come out each time a storm hits, rather than on their own timer. */
  readonly releases?: readonly ReleasableHazard[];
}

/**
 * A line of 2-8 points drawn along the scenery (a lintel, the top of the frame, a window), its corners rounded
 * by `radius` (engine/core/paths.ts). Points are on the plane at the weather's path depth (WeatherInfo.paths).
 */
export interface WeatherPath {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radius?: number;
}

export const PATH_POINTS: readonly [number, number] = [2, 8];
/** The range a storm interval may be set to, seconds. */
export const STORM_SECONDS: readonly [number, number] = [3, 300];

/** The settings a world starts with when it picks `kind`, keeping any paths already drawn (`keep`). */
export function defaultWeather(kind: WeatherKind, ball: BallArea, keep?: WeatherSettings): WeatherSettings {
  const info = WEATHERS[kind];
  const paths = keep?.paths.length ? keep.paths.slice(0, info.paths.max) : info.defaultPaths(ball);
  return { kind, paths, every: [...info.every], ...(keep?.releases?.length ? { releases: keep.releases } : {}) };
}

/** Why a world can't be played with this weather yet (empty when it can), as a status-line phrase. */
export function weatherProblem(settings: WeatherSettings): string {
  const info = WEATHERS[settings.kind];
  return settings.paths.length < info.paths.min ? `no ${info.paths.noun} drawn` : '';
}

/** Rejects malformed weather from a world file or an editor save. Paths may be missing (see weatherProblem). */
export function validateWeather(value: unknown): WeatherSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid weather.');
  const data = value as Record<string, unknown>;
  if (!isWeatherKind(data.kind)) throw new Error('Unsupported weather.');
  const info = WEATHERS[data.kind];
  if (!Array.isArray(data.paths) || data.paths.length > info.paths.max)
    throw new Error(`${info.label} takes at most ${info.paths.max} path${info.paths.max === 1 ? '' : 's'}.`);
  const paths = data.paths.map(validatePath);
  const every = data.every;
  const [shortest, longest] = STORM_SECONDS;
  if (
    !Array.isArray(every) ||
    every.length !== 2 ||
    !every.every((s) => typeof s === 'number' && Number.isFinite(s) && s >= shortest && s <= longest) ||
    every[0] > every[1]
  )
    throw new Error(`Storms must come every ${shortest}-${longest} seconds, the shortest wait first.`);
  const releases = data.releases;
  if (
    releases !== undefined &&
    (!Array.isArray(releases) || !releases.every((r) => (RELEASABLE_HAZARDS as readonly unknown[]).includes(r)))
  )
    throw new Error('Unsupported hazard for a storm to release.');
  return {
    kind: data.kind,
    paths,
    every: [every[0] as number, every[1] as number],
    ...(releases?.length ? { releases: [...new Set(releases as ReleasableHazard[])] } : {}),
  };
}

function validatePath(value: unknown): WeatherPath {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid weather path.');
  const path = value as Record<string, unknown>;
  const [min, max] = PATH_POINTS;
  const ok = (p: unknown): p is { x: number; y: number } => {
    if (!p || typeof p !== 'object') return false;
    const { x, y } = p as Record<string, unknown>;
    return (
      typeof x === 'number' &&
      typeof y === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Math.abs(x) <= 25 &&
      y >= -12 &&
      y <= 14
    );
  };
  if (!Array.isArray(path.points) || path.points.length < min || path.points.length > max || !path.points.every(ok))
    throw new Error(`A weather path needs ${min}-${max} points within the scene.`);
  const radius = path.radius;
  if (
    radius !== undefined &&
    (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > MAX_PATH_RADIUS)
  )
    throw new Error(`A weather path's curve must be between 0 and ${MAX_PATH_RADIUS}.`);
  return { points: path.points.map(({ x, y }) => ({ x, y })), ...(radius ? { radius } : {}) };
}

/**
 * Weather as older world files saved it: just a name on the world ('rain', 'snow', 'dust'), with tomb dust's
 * one line (`dustLine`) alongside. Tomb dust keeps its line, and in a tomb with scarab nests the storms bring
 * the scarabs on the wait the nests used to keep themselves. Anything else starts from its weather's defaults.
 */
export function upgradeWeather(
  name: unknown,
  dustLine: unknown,
  hazards: readonly HazardDef[] | undefined,
  ball: BallArea,
): WeatherSettings {
  if (!isWeatherKind(name)) throw new Error('Unsupported weather.');
  const settings = defaultWeather(name, ball);
  if (name !== 'dust') return settings;
  const paths = dustLine === undefined ? settings.paths : [validatePath(dustLine)];
  const scarabs = hazards?.some((h) => h.kind === 'scarabs');
  return { ...settings, paths, ...(scarabs ? { every: [14, 22] as const, releases: ['scarabs' as const] } : {}) };
}
