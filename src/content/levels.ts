import { BrickKind } from '../gameplay/types';
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

export function parseLevel(def: LevelDef, index: number): readonly LevelCell[] {
  if (def.rows.length > GRID.rows) {
    throw new Error(`Level ${index + 1} "${def.name}" has ${def.rows.length} rows (max ${GRID.rows})`);
  }
  const cells: LevelCell[] = [];
  def.rows.forEach((line, row) => {
    if (line.length !== GRID.cols) {
      throw new Error(
        `Level ${index + 1} "${def.name}" row ${row} must be ${GRID.cols} characters, got ${line.length}`,
      );
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
