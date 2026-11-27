import type { BallArea } from '../../arena/playAreas';
import type { AmbienceInfo } from '../ambiences';

/** Depth of the falling dust (z, behind the bricks): it spreads from -2.5 to -0.7 around this. Its paths are drawn here. */
export const DUST_Z = -1.6;

/** What dust is (gameplay/ambience/dust/Dust.ts is what it does): headless, for the simulation, validation and the editor. */
export const DUST: AmbienceInfo = {
  label: 'Dust',
  paths: {
    min: 1,
    max: 4,
    depth: DUST_Z,
    noun: 'dust line',
    hint: 'When a pulse shakes the tomb, dust and grit pour from these lines: draw them along the underside of the scenery (a lintel, an arch).',
  },
  every: [20, 40],
  defaultPaths: (ball) => [defaultDustLine(ball)],
};

/** How far below the top of the ball area a world's first dust line starts (just under a lintel), and its inset from the sides. */
const DEFAULT_BELOW_TOP = 1.15;
const DEFAULT_INSET = 1.5;

/** The line a world starts with when it gets dust: straight, just under the top of its ball area. */
function defaultDustLine(ball: BallArea): { points: { x: number; y: number }[] } {
  const xs = ball.points.map((p) => p.x);
  const y = Math.max(...ball.points.map((p) => p.y)) - DEFAULT_BELOW_TOP;
  return {
    points: [
      { x: Math.min(...xs) + DEFAULT_INSET, y },
      { x: Math.max(...xs) - DEFAULT_INSET, y },
    ],
  };
}
