import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { FOREST_OUTLINE } from '../../src/content/outlines/forest';
import { defaultBallArea, defaultPaddleArea, simplifyStroke, type BallArea, type Point, type PolygonArea } from '../../src/gameplay/arena/playAreas';

let forestCache: BallArea | null = null;

/**
 * The traced inside edge of the Forest painting's tree arch, as a ball area: simplified to the editor's point
 * limit so its handles can be dragged. The polyline is open at the bottom; closing it adds the drain.
 */
function forestBallArea(): BallArea {
  if (!forestCache) {
    const points: Point[] = [];
    for (let i = 0; i < FOREST_OUTLINE.length; i += 2) points.push({ x: FOREST_OUTLINE[i], y: FOREST_OUTLINE[i + 1] });
    let simple = points;
    for (let tolerance = 0.03; simple.length > 90; tolerance *= 1.5) simple = simplifyStroke(points, tolerance);
    forestCache = { points: simple, radius: 0, drainEdge: simple.length - 1 };
  }
  return structuredClone(forestCache);
}

/**
 * The shape an area starts from (a new world, or Reset): for the ball, the Forest tree arch on the built-in
 * Forest scenery, otherwise the template arena's walls; for the paddle, the classic paddle line.
 */
export function defaultArea(data: Pick<AuthoredWorld, 'world' | 'backgroundImage'>, mode: 'ball'): BallArea;
export function defaultArea(data: Pick<AuthoredWorld, 'world' | 'backgroundImage'>, mode: 'paddle'): PolygonArea;
export function defaultArea(data: Pick<AuthoredWorld, 'world' | 'backgroundImage'>, mode: 'ball' | 'paddle'): PolygonArea {
  if (mode === 'paddle') return defaultPaddleArea(data.world.field);
  return data.world.id === 'forest' && !data.backgroundImage ? forestBallArea() : defaultBallArea(data.world.field);
}

/**
 * `data` with any missing area filled in from its default, and whether anything was added. Every world in the
 * editor has both areas, as the game needs them to play it (older drafts may lack them).
 */
export function withAreas(data: AuthoredWorld): { world: AuthoredWorld; added: boolean } {
  const ball = data.playAreas?.ball;
  const paddle = data.playAreas?.paddle;
  if (ball && paddle) return { world: data, added: false };
  return {
    world: { ...data, playAreas: { ball: ball ?? defaultArea(data, 'ball'), paddle: paddle ?? defaultArea(data, 'paddle') } },
    added: true,
  };
}
