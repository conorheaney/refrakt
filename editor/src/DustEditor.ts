import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { defaultDustLine, DUST_LINE_POINTS, validateDustLine, type DustLine } from '../../src/content/dustLine';
import { DUST_Z } from '../../src/themes/weather/dust/TombDustLayer';
import { defaultArea } from './defaultAreas';
import { PathTool, type EditPath, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

const button = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const round = (n: number): number => Math.round(n * 100) / 100;
const [MIN_POINTS, MAX_POINTS] = DUST_LINE_POINTS;

/** The world's dust line, or the line a world starts with when it gets tomb dust. */
export function dustLineOrDefault(data: AuthoredWorld): DustLine {
  return data.dustLine ?? defaultDustLine(data.playAreas?.ball ?? defaultArea(data, 'ball'));
}

/**
 * Edits where a world's tomb dust pours from when the tomb rumbles (AuthoredWorld.dustLine) with the shared path
 * tool (PathTool): one curvable line of 2-8 points along the underside of the scenery. Drawn at the dust's
 * depth, so it lines up with where the dust appears in the scene.
 */
export class DustEditor {
  private readonly tool: PathTool;

  constructor(
    scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (line: DustLine) => void,
    private readonly preview: (line: DustLine | undefined) => void,
    status: (message: string, error?: boolean) => void,
  ) {
    this.tool = new PathTool(scene, {
      tool: 'dust',
      groups: [
        {
          kind: 'line',
          noun: 'dust line',
          closed: false,
          // Pink: stands out against sandstone, and no other tool uses it.
          color: '#ff6fd8',
          minPoints: MIN_POINTS,
          maxPoints: MAX_POINTS,
          maxPaths: 1,
          deletable: false,
        },
      ],
      depth: DUST_Z,
      layer: document.getElementById('dust-layer')!,
      curve: document.getElementById('dust-curve') as HTMLInputElement,
      replaces: true,
      read: () => ({ line: this.read() }),
      write: (model, final, message) => {
        const line = this.line(model.line[0]);
        if (final) {
          this.commit(line);
          status(message);
        } else this.preview(line);
      },
      revert: () => this.preview(undefined),
      status,
      clamp: (p) => ({ x: Math.max(-24.9, Math.min(24.9, p.x)), y: Math.max(-11.9, Math.min(13.9, p.y)) }),
      changed: (model) => this.panel(model),
    });
    button('dust-draw').addEventListener('click', () => this.tool.draw('line'));
    button('dust-reset').addEventListener('click', () => {
      this.tool.stopDrawing();
      const data = this.getData();
      this.commit(defaultDustLine(data.playAreas?.ball ?? defaultArea(data, 'ball')));
      status('Dust line reset: straight, just under the top of the ball area.');
      this.tool.refresh();
    });
  }

  refresh(): void {
    // The one line is selected whenever the tool is open, so its handles show straight away.
    if (document.body.dataset.tool === 'dust' && !this.tool.selection && this.read().length) {
      this.tool.select({ kind: 'line', index: 0 });
      return;
    }
    this.tool.refresh();
  }

  private read(): EditPath[] {
    const data = this.getData();
    // A world without tomb dust shows where its line would start, so it can be set up before switching on dust.
    const line = data.dustLine ?? (data.world.weather === 'dust' ? undefined : dustLineOrDefault(data));
    return line ? [{ points: line.points.map((p) => ({ x: p.x, y: p.y })), radius: line.radius ?? 0 }] : [];
  }

  private line(path: EditPath | undefined): DustLine {
    if (!path) throw new Error('Draw a dust line: where the dust pours from when the tomb rumbles.');
    return validateDustLine({
      points: path.points.map((p) => ({ x: round(p.x), y: round(p.y) })),
      ...(path.radius ? { radius: round(path.radius) } : {}),
    });
  }

  private panel(model: PathModel): void {
    const active = document.body.dataset.tool === 'dust';
    document.getElementById('dust-tools')!.hidden = !active;
    if (!active) return;
    const line = model.line[0];
    const dusty = this.getData().world.weather === 'dust';
    document.getElementById('dust-summary')!.textContent = !dusty
      ? 'This world has no tomb dust. Choose Tomb dust under Weather (World settings) to use the line.'
      : line
        ? `${line.points.length} points, from (${line.points[0].x.toFixed(1)}, ${line.points[0].y.toFixed(1)}) to (${line.points[line.points.length - 1].x.toFixed(1)}, ${line.points[line.points.length - 1].y.toFixed(1)}).`
        : 'No dust line: draw one before this world can be played.';
  }
}
