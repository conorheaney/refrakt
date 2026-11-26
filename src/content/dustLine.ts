import { MAX_PATH_RADIUS } from '../engine/core/paths';
import type { BallArea } from '../gameplay/arena/playAreas';

/**
 * Where a world's tomb dust pours from when the tomb rumbles (WorldDef.weather 'dust'): a line of 2-8 points
 * drawn in the editor along the underside of the scenery (a lintel, an arch), its corners rounded by `radius`
 * (engine/core/paths.ts). The sifting veils and falling grit all start somewhere along it
 * (themes/weather/dust/TombDustLayer.ts). A dust world needs one to be played.
 */
export interface DustLine {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radius?: number;
}

export const DUST_LINE_POINTS: readonly [number, number] = [2, 8];

/** How far below the top of the ball area a new dust line starts (just under a lintel), and its inset from the sides. */
const DEFAULT_BELOW_TOP = 1.15;
const DEFAULT_INSET = 1.5;

/** Rejects a malformed dust line from a world file or an editor save. */
export function validateDustLine(value: unknown): DustLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dust line.');
  const line = value as Record<string, unknown>;
  const [min, max] = DUST_LINE_POINTS;
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
  if (!Array.isArray(line.points) || line.points.length < min || line.points.length > max || !line.points.every(ok)) {
    throw new Error(`The dust line needs ${min}-${max} points within the scene.`);
  }
  const radius = line.radius;
  if (
    radius !== undefined &&
    (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > MAX_PATH_RADIUS)
  ) {
    throw new Error(`The dust line's curve must be between 0 and ${MAX_PATH_RADIUS}.`);
  }
  return {
    points: line.points.map(({ x, y }) => ({ x, y })),
    ...(radius ? { radius } : {}),
  };
}

/** The line a world starts with when it gets tomb dust: straight, just under the top of its ball area. */
export function defaultDustLine(ball: BallArea): DustLine {
  const xs = ball.points.map((p) => p.x);
  const y = Math.max(...ball.points.map((p) => p.y)) - DEFAULT_BELOW_TOP;
  return {
    points: [
      { x: Math.min(...xs) + DEFAULT_INSET, y },
      { x: Math.max(...xs) - DEFAULT_INSET, y },
    ],
  };
}
