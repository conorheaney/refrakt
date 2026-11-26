import { validateWorld, type AuthoredWorld } from '../../src/content/authoredWorlds';
import { Campaign, worldEntry, type WorldAreas, type WorldExtras } from '../../src/content/campaign';
import { buildCampaign } from '../../src/content/fileWorlds';
import type { LevelDef } from '../../src/content/levels';
import { STAGES_PER_WORLD, type WorldDef } from '../../src/content/worlds';
import { FIELD } from '../../src/gameplay/config';
import { defaultBallArea, defaultPaddleArea } from '../../src/gameplay/arena/playAreas';
import index from '../../public/worlds/index.json';
import verdant from '../../public/worlds/Verdant-Hollow.json';
import tomb from '../../public/worlds/Pharoughs-Tomb.json';
import frozen from '../../public/worlds/Frozen-Sanctuary.json';
import outerSpace from '../../public/worlds/Outer-Space-3f405ebf-2176-424e-8ba4-189416448443.json';
import atlantis from '../../public/worlds/Atlantis-3b1c5af2-e102-4dcc-97f3-3104fe58995e.json';
import volcanic from '../../public/worlds/Volcanic-Forge-fa340543-50b4-4485-986f-42b51ec3c7ed.json';
import jungle from '../../public/worlds/Jungle-Ruins-jungle-ruins.json';
import { CLASSIC_LEVELS } from './classicLevels';

const FILES: Record<string, unknown> = {
  'Verdant-Hollow.json': verdant,
  'Pharoughs-Tomb.json': tomb,
  'Frozen-Sanctuary.json': frozen,
  'Outer-Space-3f405ebf-2176-424e-8ba4-189416448443.json': outerSpace,
  'Atlantis-3b1c5af2-e102-4dcc-97f3-3104fe58995e.json': atlantis,
  'Volcanic-Forge-fa340543-50b4-4485-986f-42b51ec3c7ed.json': volcanic,
  'Jungle-Ruins-jungle-ruins.json': jungle,
};

/** The shipped world files, validated, in manifest order. */
export const SHIPPED_WORLDS: readonly AuthoredWorld[] = index.map((file) => {
  const data = FILES[file];
  if (!data) throw new Error(`tests/support/worlds.ts: add ${file} to FILES`);
  return validateWorld(data);
});

/** The campaign the game builds from the shipped world files. */
export const SHIPPED_CAMPAIGN: Campaign = buildCampaign(SHIPPED_WORLDS);

const SPACE: WorldDef = { name: 'Space' };
const FOREST: WorldDef = { name: 'Forest', music: 'forest' };

/** The standard arena (straight walls, rounded top corners) and paddle line, as drawn areas. */
export const SPACE_AREAS: WorldAreas = { ball: defaultBallArea(FIELD), paddle: defaultPaddleArea(FIELD) };
/** Verdant Hollow's areas: the tree arch of its painted background, and the lane under it. */
export const FOREST_AREAS: WorldAreas = (() => {
  const { ball, paddle } = validateWorld(verdant).playAreas ?? {};
  if (!ball || !paddle) throw new Error('Verdant Hollow needs both areas.');
  return { ball, paddle };
})();

/**
 * TEST campaign: the original Space and Forest levels (tests/support/classicLevels.ts) as two worlds. The Space
 * world (levels 0-9) has the plain rounded-rectangle arena; the Forest world (levels 10-19) has Verdant
 * Hollow's tree-arch areas.
 */
export function classicCampaign(
  parts: { space?: Partial<WorldAreas> & WorldExtras; forest?: Partial<WorldAreas> & WorldExtras } = {},
): Campaign {
  const world = (
    def: WorldDef,
    levels: readonly LevelDef[],
    areas: WorldAreas,
    extra: (Partial<WorldAreas> & WorldExtras) | undefined,
    first: number,
  ) =>
    worldEntry(
      def,
      levels,
      { ball: extra?.ball ?? areas.ball, paddle: extra?.paddle ?? areas.paddle },
      { hazards: extra?.hazards, background: extra?.background },
      first,
    );
  return new Campaign([
    world(SPACE, CLASSIC_LEVELS.slice(0, STAGES_PER_WORLD), SPACE_AREAS, parts.space, 0),
    world(
      FOREST,
      CLASSIC_LEVELS.slice(STAGES_PER_WORLD, 2 * STAGES_PER_WORLD),
      FOREST_AREAS,
      parts.forest,
      STAGES_PER_WORLD,
    ),
  ]);
}

/** The classic test campaign with default arenas. */
export const CLASSIC: Campaign = classicCampaign();
/** First level of the classic Forest world. */
export const FOREST_LEVEL = STAGES_PER_WORLD;
