import type { MusicTrackId } from './musicTracks';
import type { BallArea, PolygonArea } from '../gameplay/arena/playAreas';
import type { HazardDef } from '../gameplay/hazards/hazards';
import { weatherProblem, type WeatherSettings } from '../gameplay/weather/settings';
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
  /** The world's scenery: an uploaded image (a data: URL). Without one the backdrop is plain dark. */
  readonly background?: string;
  /** The air of the world (gameplay/weather/settings.ts): snow, rain, tomb dust. Absent means clear. */
  readonly weather?: WeatherSettings;
}

export interface WorldExtras {
  readonly hazards?: readonly HazardDef[];
  readonly background?: string;
  readonly weather?: WeatherSettings;
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
  const weather = extras.weather && weatherProblem(extras.weather);
  if (weather) throw new Error(`${def.name}: ${weather} (draw one before playing).`);
  return {
    def,
    levels,
    cells: levels.map((level, i) => parseLevel(level, firstLevel + i)),
    playAreas: { ball: areas.ball, paddle: areas.paddle },
    ...(extras.hazards ? { hazards: extras.hazards } : {}),
    ...(extras.background ? { background: extras.background } : {}),
    ...(extras.weather ? { weather: extras.weather } : {}),
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

  constructor(readonly worlds: readonly WorldEntry[]) {
    if (worlds.length === 0)
      throw new Error('No playable worlds: add a finished world file with a ball area and a paddle area.');
    this.levels = worlds.flatMap((world) => world.levels);
  }

  get levelCount(): number {
    return this.levels.length;
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

  /** "Atlantis Level 3". */
  stageLabel(levelIndex: number): string {
    return `${this.worldDefAt(levelIndex).name} Level ${levelNumber(levelIndex)}`;
  }

  /** Index one past a run's last level: a run plays the ten levels of the world it starts in. */
  runEndLevel(start: number): number {
    return (Math.floor(start / STAGES_PER_WORLD) + 1) * STAGES_PER_WORLD;
  }

  /** This campaign with `entry` appended as a new world. */
  withWorld(entry: WorldEntry): Campaign {
    return new Campaign([...this.worlds, entry]);
  }

  /** This campaign with world `index` replaced by `entry` (levels keep their position). */
  withWorldAt(index: number, entry: WorldEntry): Campaign {
    if (!Number.isInteger(index) || index < 0 || index >= this.worlds.length)
      throw new Error(`No world slot ${index}.`);
    return new Campaign(this.worlds.map((world, i) => (i === index ? entry : world)));
  }

  /** This campaign with world `index`'s areas and extras (hazards, background, weather) replaced. */
  withWorldPartsAt(index: number, parts: { playAreas?: WorldAreas } & WorldExtras): Campaign {
    const world = this.worlds[index];
    if (!world) throw new Error(`No world slot ${index}.`);
    const hazards = 'hazards' in parts ? parts.hazards : world.hazards;
    const background = 'background' in parts ? parts.background : world.background;
    const weather = 'weather' in parts ? parts.weather : world.weather;
    return this.withWorldAt(index, {
      def: world.def,
      levels: world.levels,
      cells: world.cells,
      playAreas: parts.playAreas ?? world.playAreas,
      ...(hazards ? { hazards } : {}),
      ...(background ? { background } : {}),
      ...(weather ? { weather } : {}),
    });
  }
}
