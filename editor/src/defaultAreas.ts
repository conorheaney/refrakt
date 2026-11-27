import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { AMBIENCES } from '../../src/gameplay/ambience/ambiences';
import { FIELD } from '../../src/gameplay/config';
import {
  defaultBallArea,
  defaultPaddleArea,
  type BallArea,
  type PolygonArea,
} from '../../src/gameplay/arena/playAreas';

/** The shape an area starts from (a new world, or Reset): the standard arena's walls, or its paddle line. */
export function defaultArea(mode: 'ball'): BallArea;
export function defaultArea(mode: 'paddle'): PolygonArea;
export function defaultArea(mode: 'ball' | 'paddle'): PolygonArea {
  return mode === 'paddle' ? defaultPaddleArea(FIELD) : defaultBallArea(FIELD);
}

/**
 * `data` with anything it needs to be played filled in from its defaults (missing ball or paddle area; the lines
 * its ambience comes from), and whether anything was added. Every world in the editor has these, as the
 * game needs them to play it (older drafts may lack them).
 */
export function withAreas(data: AuthoredWorld): { world: AuthoredWorld; added: boolean } {
  let world = data;
  let added = false;
  const ball = data.playAreas?.ball;
  const paddle = data.playAreas?.paddle;
  if (!ball || !paddle) {
    world = {
      ...world,
      playAreas: { ball: ball ?? defaultArea('ball'), paddle: paddle ?? defaultArea('paddle') },
    };
    added = true;
  }
  const ambience = world.ambience;
  if (ambience && ambience.paths.length < AMBIENCES[ambience.kind].paths.min) {
    world = {
      ...world,
      ambience: { ...ambience, paths: AMBIENCES[ambience.kind].defaultPaths(world.playAreas!.ball!) },
    };
    added = true;
  }
  return { world, added };
}
