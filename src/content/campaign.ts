import type { MusicTrackId } from './musicTracks';
import type { PlayAreas } from '../gameplay/arena/playAreas';
import type { HazardDef } from '../gameplay/hazards/hazards';
import { BUILTIN_LEVELS, parseLevel, type LevelCell, type LevelDef } from './levels';
import { BUILTIN_WORLDS, levelNumber, STAGES_PER_WORLD, type WorldDef } from './worlds';

/** One world of a campaign: its definition, its ten levels and everything authored alongside them. */
export interface WorldEntry {
  readonly def: WorldDef;
  /** Exactly STAGES_PER_WORLD levels. */
  readonly levels: readonly LevelDef[];
  /** `levels` parsed into brick cells (parseLevel), once, when the entry is made. */
  readonly cells: readonly (readonly LevelCell[])[];
  /** Drawn ball and paddle areas (gameplay/arena/playAreas.ts); absent: the world's own arena. */
  readonly playAreas?: PlayAreas;
  /** Enemies active in every level of this world (gameplay/hazards/hazards.ts). */
  readonly hazards?: readonly HazardDef[];
  /** Uploaded scenery image (a data: URL) replacing the built-in backdrop. */
  readonly background?: string;
}

export interface WorldExtras {
  readonly playAreas?: PlayAreas;
  readonly hazards?: readonly HazardDef[];
  readonly background?: string;
}

/**
 * Builds a WorldEntry, parsing (and so validating) its levels. `firstLevel` only numbers the levels in
 * parse errors.
 */
export function worldEntry(def: WorldDef, levels: readonly LevelDef[], extras: WorldExtras = {}, firstLevel = 0): WorldEntry {
  if (levels.length !== STAGES_PER_WORLD) throw new Error(`A world must contain exactly ${STAGES_PER_WORLD} levels.`);
  return {
    def,
    levels,
    cells: levels.map((level, i) => parseLevel(level, firstLevel + i)),
    ...(extras.playAreas ? { playAreas: extras.playAreas } : {}),
    ...(extras.hazards ? { hazards: extras.hazards } : {}),
    ...(extras.background ? { background: extras.background } : {}),
  };
}

/**
 * The worlds a game plays, in order: built once at boot (built-ins, then project files and browser saves)
 * and handed to the simulation, view and UI. Immutable; the `with...` methods return a new campaign.
 *
 * Level index n belongs to worlds[floor(n / STAGES_PER_WORLD)].
 */
export class Campaign {
  /** Every level in play order (worlds[w].levels flattened). */
  readonly levels: readonly LevelDef[];

  /**
   * @param builtinWorldCount How many leading worlds are the built-in campaign (Space, Forest or their
   *   project-file replacements); a run started there plays through all of them (see runEndLevel).
   */
  constructor(readonly worlds: readonly WorldEntry[], readonly builtinWorldCount: number = worlds.length) {
    if (worlds.length === 0) throw new Error('A campaign needs at least one world.');
    this.levels = worlds.flatMap((world) => world.levels);
  }

  /** The built-in Space and Forest worlds. */
  static builtin(): Campaign {
    return new Campaign(BUILTIN_WORLDS.map((def, w) =>
      worldEntry(def, BUILTIN_LEVELS.slice(w * STAGES_PER_WORLD, (w + 1) * STAGES_PER_WORLD), {}, w * STAGES_PER_WORLD)));
  }

  get levelCount(): number {
    return this.levels.length;
  }

  get builtinLevelCount(): number {
    return this.builtinWorldCount * STAGES_PER_WORLD;
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

  /** Index one past a run's last level: the built-in campaign runs to its end, any other world for its ten levels. */
  runEndLevel(start: number): number {
    return start < this.builtinLevelCount ? this.builtinLevelCount : (Math.floor(start / STAGES_PER_WORLD) + 1) * STAGES_PER_WORLD;
  }

  /** This campaign with `entry` appended as a new world. */
  withWorld(entry: WorldEntry): Campaign {
    return new Campaign([...this.worlds, entry], this.builtinWorldCount);
  }

  /** This campaign with world `index` replaced by `entry` (levels keep their position). */
  withWorldAt(index: number, entry: WorldEntry): Campaign {
    if (!Number.isInteger(index) || index < 0 || index >= this.worlds.length) throw new Error(`No world slot ${index}.`);
    return new Campaign(this.worlds.map((world, i) => (i === index ? entry : world)), this.builtinWorldCount);
  }

  /** This campaign with world `index`'s extras (areas, hazards, background) replaced. */
  withExtrasAt(index: number, extras: WorldExtras): Campaign {
    const world = this.worlds[index];
    if (!world) throw new Error(`No world slot ${index}.`);
    return this.withWorldAt(index, {
      def: world.def,
      levels: world.levels,
      cells: world.cells,
      ...(extras.playAreas ? { playAreas: extras.playAreas } : {}),
      ...(extras.hazards ? { hazards: extras.hazards } : {}),
      ...(extras.background ? { background: extras.background } : {}),
    });
  }
}

/** The built-in campaign, for tools and tests that don't load any world files. */
export const BUILTIN_CAMPAIGN = Campaign.builtin();
