import { BrickKind, type BossDef } from '../gameplay/types';
import { GRID } from '../gameplay/config';

export interface LevelDef {
  readonly name: string;
  /**
   * One string per brick row, top first, exactly GRID.cols characters:
   * `.` empty, `1` normal, `2` tough, `3` armored, `S` steel,
   * `X` explosive, `P` prism, `G` phase.
   */
  readonly rows: readonly string[];
  /** Sky hue (0..1) used by the environment theme. */
  readonly hue: number;
  readonly boss?: BossDef;
}

export interface LevelCell {
  readonly col: number;
  readonly row: number;
  readonly kind: BrickKind;
}

const SYMBOLS: Readonly<Record<string, BrickKind>> = {
  '1': BrickKind.Normal,
  '2': BrickKind.Tough,
  '3': BrickKind.Armored,
  S: BrickKind.Steel,
  X: BrickKind.Explosive,
  P: BrickKind.Prism,
  G: BrickKind.Phase,
};

/**
 * Ready-made bosses the editor offers (the four from the original Space and Forest campaigns). A level's boss
 * is part of its world file; these are only starting points.
 */
export const BOSS_PRESETS: readonly BossDef[] = [
{
    name: 'THE WARDEN',
    hp: 22,
    radius: 1.8,
    y: 7.6,
    sway: 9,
    swaySpeed: 0.6,
    fireInterval: 2.8,
    volley: 1,
    shotSpeed: 7,
    summonInterval: 0,
    points: 5000,
  },
{
    name: 'THE SINGULARITY',
    hp: 38,
    radius: 1.9,
    y: 7.7,
    sway: 9.5,
    swaySpeed: 0.75,
    fireInterval: 2.4,
    volley: 2,
    shotSpeed: 8,
    summonInterval: 9,
    points: 15000,
  },
{
    name: 'THE ELDER OAK',
    hp: 28,
    radius: 1.8,
    y: 7.6,
    sway: 9,
    swaySpeed: 0.65,
    fireInterval: 2.7,
    volley: 1,
    shotSpeed: 7.5,
    summonInterval: 12,
    points: 8000,
  },
{
    name: 'HEART OF THE FOREST',
    hp: 44,
    radius: 1.9,
    y: 7.7,
    sway: 9.5,
    swaySpeed: 0.8,
    fireInterval: 2.3,
    volley: 2,
    shotSpeed: 8.5,
    summonInterval: 8,
    points: 20000,
  },
];

export function parseLevel(def: LevelDef, index: number): readonly LevelCell[] {
  if (def.rows.length > GRID.rows) {
    throw new Error(`Level ${index + 1} "${def.name}" has ${def.rows.length} rows (max ${GRID.rows})`);
  }
  const cells: LevelCell[] = [];
  def.rows.forEach((line, row) => {
    if (line.length !== GRID.cols) {
      throw new Error(`Level ${index + 1} "${def.name}" row ${row} must be ${GRID.cols} characters, got ${line.length}`);
    }
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      const kind = SYMBOLS[ch];
      if (kind === undefined) {
        throw new Error(`Level ${index + 1} "${def.name}" has unknown symbol "${ch}" at row ${row}, col ${col}`);
      }
      cells.push({ col, row, kind });
    }
  });
  return cells;
}
