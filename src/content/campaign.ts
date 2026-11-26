import type { MusicTrackId } from './musicTracks';
import type { BallArea, PolygonArea } from '../gameplay/arena/playAreas';
import type { HazardDef } from '../gameplay/hazards/hazards';
import type { DustLine } from './dustLine';
import { parseLevel, type LevelCell, type LevelDef } from './levels';
import { levelNumber, STAGES_PER_WORLD, type WorldDef } from './worlds';

/** A playable world's drawn areas: the walls the ball bounces off and the lane the paddle runs in. */
export interface WorldAreas {
  readonly ball: BallArea;
  readonly paddle: PolygonArea;
}

/** One world of a campaign: its definition, its ten levels and everything authored alongside them. */
export interface WorldEntry {
  readonly def: WorldDef;
  /** Exactly STAGES_PER_WORLD levels. */
  readonly levels: readonly LevelDef[];
  /** `levels` parsed into brick cells (parseLevel), once, when the entry is made. */
  readonly cells: readonly (readonly LevelCell[])[];
  /** Drawn ball and paddle areas (gameplay/arena/playAreas.ts). Every playable world has both. */
  readonly playAreas: WorldAreas;
  /** Enemies active in every level of this world (gameplay/hazards/hazards.ts). */
  readonly hazards?: readonly HazardDef[];
  /** Uploaded scenery image (a data: URL) replacing the built-in backdrop. */
  readonly background?: string;
  /** Where tomb dust pours from (content/dustLine.ts); every world with dust weather has one. */
  readonly dustLine?: DustLine;
}

export interface WorldExtras {
  readonly hazards?: readonly HazardDef[];
  readonly background?: string;
  readonly dustLine?: DustLine;
}

/**
 * Builds a WorldEntry, parsing (and so validating) its levels. `firstLevel` only numbers the levels in
 * parse errors.
 */
export function worldEntry(
  def: WorldDef,
  levels: readonly LevelDef[],
  areas: WorldAreas,
  extras: WorldExtras = {},
  firstLevel = 0,
): WorldEntry {
  if (levels.length !== STAGES_PER_WORLD) throw new Error(`A world must contain exactly ${STAGES_PER_WORLD} levels.`);
  if (!areas.ball || !areas.paddle) throw new Error(`${def.name}: draw a ball area and a paddle area before playing.`);
  if (def.weather === 'dust' && !extras.dustLine) throw new Error(`${def.name}: draw a dust line before playing.`);
  return {
    def,
    levels,
    cells: levels.map((level, i) => parseLevel(level, firstLevel + i)),
    playAreas: { ball: areas.ball, paddle: areas.paddle },
    ...(extras.hazards ? { hazards: extras.hazards } : {}),
    ...(extras.background ? { background: extras.background } : {}),
    ...(extras.dustLine ? { dustLine: extras.dustLine } : {}),
  };
}

/**
 * The worlds a game plays, in order: built once at boot from the project's world files and browser saves (see
 * content/fileWorlds.ts) and handed to the simulation, view and UI. Immutable; the `with...` methods return a
 * new campaign.
 *
 * Level index n belongs to worlds[floor(n / STAGES_PER_WORLD)].
 */
export class Campaign {
  /** Every level in play order (worlds[w].levels flattened). */
  readonly levels: readonly LevelDef[];

  /**
   * @param mainWorldCount How many leading worlds form the main campaign (the world files that take the Space
   *   and Forest slots, `replaces`); a run started there plays through all of them (see runEndLevel).
   */
  constructor(
    readonly worlds: readonly WorldEntry[],
    readonly mainWorldCount = 0,
  ) {
    if (worlds.length === 0)
      throw new Error('No playable worlds: add a finished world file with a ball area and a paddle area.');
    this.levels = worlds.flatMap((world) => world.levels);
  }

  get levelCount(): number {
    return this.levels.length;
  }

  get mainLevelCount(): number {
    return this.mainWorldCount * STAGES_PER_WORLD;
  }

  /** The world a level belongs to (clamped to the campaign). */
  worldIndexOf(levelIndex: number): number {
    return Math.min(this.worlds.length - 1, Math.max(0, Math.floor(levelIndex / STAGES_PER_WORLD)));
  }

  worldAt(levelIndex: number): WorldEntry {
    return this.worlds[this.worldIndexOf(levelIndex)];
  }

  worldDefAt(levelIndex: number): WorldDef {
    return this.worldAt(levelIndex).def;
  }

  level(levelIndex: number): LevelDef {
    const level = this.levels[levelIndex];
    if (!level) throw new Error(`No level ${levelIndex} in this campaign.`);
    return level;
  }

  levelCells(levelIndex: number): readonly LevelCell[] {
    return this.worldAt(levelIndex).cells[levelIndex % STAGES_PER_WORLD];
  }

  /** The soundtrack for the world a level belongs to. */
  musicTrackOf(levelIndex: number): MusicTrackId {
    return this.worldDefAt(levelIndex).music ?? 'space';
  }

  /** "Space Level 3", "Forest Level 7". */
  stageLabel(levelIndex: number): string {
    return `${this.worldDefAt(levelIndex).name} Level ${levelNumber(levelIndex)}`;
  }

  /** Index one past a run's last level: the main campaign runs to its end, any other world for its ten levels. */
  runEndLevel(start: number): number {
    return start < this.mainLevelCount
      ? this.mainLevelCount
      : (Math.floor(start / STAGES_PER_WORLD) + 1) * STAGES_PER_WORLD;
  }

  /** This campaign with `entry` appended as a new world. */
  withWorld(entry: WorldEntry): Campaign {
    return new Campaign([...this.worlds, entry], this.mainWorldCount);
  }

  /** This campaign with world `index` replaced by `entry` (levels keep their position). */
  withWorldAt(index: number, entry: WorldEntry): Campaign {
    if (!Number.isInteger(index) || index < 0 || index >= this.worlds.length)
      throw new Error(`No world slot ${index}.`);
    return new Campaign(
      this.worlds.map((world, i) => (i === index ? entry : world)),
      this.mainWorldCount,
    );
  }

  /** This campaign with world `index`'s areas and extras (hazards, background) replaced. */
  withWorldPartsAt(index: number, parts: { playAreas?: WorldAreas } & WorldExtras): Campaign {
    const world = this.worlds[index];
    if (!world) throw new Error(`No world slot ${index}.`);
    const hazards = 'hazards' in parts ? parts.hazards : world.hazards;
    const background = 'background' in parts ? parts.background : world.background;
    const dustLine = 'dustLine' in parts ? parts.dustLine : world.dustLine;
    return this.withWorldAt(index, {
      def: world.def,
      levels: world.levels,
      cells: world.cells,
      playAreas: parts.playAreas ?? world.playAreas,
      ...(hazards ? { hazards } : {}),
      ...(background ? { background } : {}),
      ...(dustLine ? { dustLine } : {}),
    });
  }
}
