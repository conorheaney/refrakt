import { MAX_PATH_RADIUS } from '../../engine/core/paths';
import type { BallArea } from '../arena/playAreas';
import { AMBIENCES, isAmbienceKind, type AmbienceKind } from './ambiences';

/**
 * A world's ambience as it is saved (AuthoredWorld.ambience): which ambience it is, where it comes from and how
 * often its pulses come. An ambience can be given to any world: these settings are all it needs (each ambience's
 * AmbienceInfo says how many paths it takes and what it starts with). It knows nothing of hazards: a world can
 * have its hazards set off by the pulses instead (`hazardCues`, gameplay/hazards/HazardTriggers.ts).
 */
export interface AmbienceSettings {
  readonly kind: AmbienceKind;
  /** Where it comes from (snow falls from them, dust pours from them), drawn in the editor. */
  readonly paths: readonly AmbiencePath[];
  /**
   * Seconds between pulses (a gust, a lightning strike, the tomb shaking) on a world's first level, shortest
   * and longest; they come up to a third sooner by its last level. They only count down while the ball is in
   * play (gameplay/ambience/AmbienceClock.ts).
   */
  readonly every: readonly [number, number];
  /** Its own settings (AmbienceInfo.options), by key; any left out are at their defaults. */
  readonly options?: Readonly<Record<string, string | number>>;
}

/** The value of option `key` of this ambience: as saved, or its default. */
export function ambienceOption(settings: AmbienceSettings, key: string): string | number {
  const saved = settings.options?.[key];
  if (saved !== undefined) return saved;
  const option = AMBIENCES[settings.kind].options?.find((o) => o.key === key);
  if (!option) throw new Error(`${AMBIENCES[settings.kind].label} has no setting "${key}".`);
  return option.default;
}

/**
 * A line of 2-8 points drawn along the scenery (a lintel, the top of the frame, a window), its corners rounded
 * by `radius` (engine/core/paths.ts). Points are on the plane at the ambience's path depth (AmbienceInfo.paths).
 */
export interface AmbiencePath {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radius?: number;
}

export const PATH_POINTS: readonly [number, number] = [2, 8];
/** The range a pulse interval may be set to, seconds. */
export const PULSE_SECONDS: readonly [number, number] = [3, 300];

/** The settings a world starts with when it picks `kind`, keeping any paths already drawn (`keep`). */
export function defaultAmbience(kind: AmbienceKind, ball: BallArea, keep?: AmbienceSettings): AmbienceSettings {
  const info = AMBIENCES[kind];
  const paths = keep?.paths.length ? keep.paths.slice(0, info.paths.max) : info.defaultPaths(ball);
  return { kind, paths, every: [...info.every] };
}

/** Why a world can't be played with this ambience yet (empty when it can), as a status-line phrase. */
export function ambienceProblem(settings: AmbienceSettings): string {
  const info = AMBIENCES[settings.kind];
  return settings.paths.length < info.paths.min ? `no ${info.paths.noun} drawn` : '';
}

/** Rejects malformed ambience from a world file or an editor save. Paths may be missing (see ambienceProblem). */
export function validateAmbience(value: unknown): AmbienceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ambience.');
  const data = value as Record<string, unknown>;
  if (!isAmbienceKind(data.kind)) throw new Error('Unsupported ambience.');
  const info = AMBIENCES[data.kind];
  if (!Array.isArray(data.paths) || data.paths.length > info.paths.max)
    throw new Error(`${info.label} takes at most ${info.paths.max} path${info.paths.max === 1 ? '' : 's'}.`);
  const paths = data.paths.map(validatePath);
  const every = data.every;
  const [shortest, longest] = PULSE_SECONDS;
  if (
    !Array.isArray(every) ||
    every.length !== 2 ||
    !every.every((s) => typeof s === 'number' && Number.isFinite(s) && s >= shortest && s <= longest) ||
    every[0] > every[1]
  )
    throw new Error(`Pulses must come every ${shortest}-${longest} seconds, the shortest wait first.`);
  const options = validateOptions(data.kind, data.options);
  return { kind: data.kind, paths, every: [every[0] as number, every[1] as number], ...(options ? { options } : {}) };
}

function validateOptions(kind: AmbienceKind, value: unknown): Record<string, string | number> | undefined {
  if (value === undefined) return undefined;
  const info = AMBIENCES[kind];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ambience settings.');
  const out: Record<string, string | number> = {};
  for (const [key, v] of Object.entries(value)) {
    const option = info.options?.find((o) => o.key === key);
    if (!option) throw new Error(`${info.label} has no setting "${key}".`);
    if (option.type === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))
        throw new Error(`${info.label}'s ${option.label.toLowerCase()} must be a colour like #c4cfd4.`);
      out[key] = v.toLowerCase();
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < option.min || v > option.max)
        throw new Error(
          `${info.label}'s ${option.label.toLowerCase()} must be between ${option.min} and ${option.max}.`,
        );
      out[key] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function validatePath(value: unknown): AmbiencePath {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ambience path.');
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
    throw new Error(`An ambience path needs ${min}-${max} points within the scene.`);
  const radius = path.radius;
  if (
    radius !== undefined &&
    (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > MAX_PATH_RADIUS)
  )
    throw new Error(`An ambience path's curve must be between 0 and ${MAX_PATH_RADIUS}.`);
  return { points: path.points.map(({ x, y }) => ({ x, y })), ...(radius ? { radius } : {}) };
}

/**
 * Ambience as older world files saved it: just a name on the world ('rain', 'snow', 'dust'), with dust's
 * one line (`dustLine`) alongside. Dust keeps its line; anything else starts from its ambience's defaults.
 */
export function upgradeAmbience(name: unknown, dustLine: unknown, ball: BallArea): AmbienceSettings {
  if (!isAmbienceKind(name)) throw new Error('Unsupported ambience.');
  const settings = defaultAmbience(name, ball);
  if (name !== 'dust') return settings;
  const paths = dustLine === undefined ? settings.paths : [validatePath(dustLine)];
  return { ...settings, paths };
}
