import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { SCARAB_Z } from '../../src/gameplay/hazards/scarabs/ScarabView';
import {
  MAX_HAZARDS,
  SCARAB_PATH_POINTS,
  validateHazards,
  type HazardDef,
  type ScarabNestDef,
} from '../../src/gameplay/hazards/hazards';
import type { Point } from '../../src/gameplay/arena/playAreas';
import { PathTool, type EditPath, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

const button = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Edits a world's scarab nests (AuthoredWorld.hazards, kind 'scarabs') with the shared path tool (PathTool):
 * each is a curvable line from its entry point (large handle, where scarabs appear) along the path they walk
 * in (the hollow last point is where they reach the floor). Drawn at the scarabs' depth, so it lines up with
 * them in the scene.
 */
export class ScarabEditor {
  private readonly tool: PathTool;

  constructor(
    scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (hazards: HazardDef[] | undefined) => void,
    private readonly preview: (hazards: HazardDef[] | undefined) => void,
    status: (message: string, error?: boolean) => void,
  ) {
    this.tool = new PathTool(scene, {
      tool: 'scarabs',
      groups: [
        {
          kind: 'nest',
          noun: 'nest',
          closed: false,
          color: '#ffd84a',
          minPoints: 1,
          maxPoints: SCARAB_PATH_POINTS + 1,
          maxPaths: MAX_HAZARDS,
          fixed: () => [0],
          role: (path, i) => (i === 0 ? 'anchor' : i === path.points.length - 1 ? 'end' : ''),
        },
      ],
      depth: SCARAB_Z,
      layer: document.getElementById('scarab-layer')!,
      curve: document.getElementById('scarab-curve') as HTMLInputElement,
      read: () => ({ nest: this.read() }),
      write: (model, final, message) => {
        const hazards = this.hazards(model.nest);
        if (final) {
          this.commit(hazards);
          status(message);
        } else this.preview(hazards ?? []);
      },
      revert: () => this.preview(undefined),
      status,
      clamp: (p) => ({ x: Math.max(-24.9, Math.min(24.9, p.x)), y: Math.max(-11.9, Math.min(13.9, p.y)) }),
      changed: (model, sel) => this.panel(model, sel?.index ?? -1),
    });
    button('scarab-add-nest').addEventListener('click', () => this.tool.draw('nest'));
    button('scarab-delete').addEventListener('click', () => this.tool.removeSelected());
    button('scarab-clear-path').addEventListener('click', () => this.clearPath());
  }

  refresh(): void {
    this.tool.refresh();
  }

  private read(): EditPath[] {
    return (this.getData().hazards ?? [])
      .filter((h): h is ScarabNestDef => h.kind === 'scarabs')
      .map((h) => ({
        points: [{ x: h.x, y: h.y }, ...(h.path ?? []).map((p) => ({ x: p.x, y: p.y }))],
        radius: h.radius ?? 0,
      }));
  }

  /** The world's hazards with these nests in place of its old ones (snakes and icicles untouched). */
  private hazards(nests: EditPath[]): HazardDef[] | undefined {
    const pt = (p: Point): Point => ({ x: round(p.x), y: round(p.y) });
    const defs = nests.map((n): ScarabNestDef => {
      const [entry, ...path] = n.points;
      // Never exactly on the centre line (its side sets which way the swarm sets off).
      const x = Math.abs(entry.x) < 0.05 ? (entry.x < 0 ? -0.05 : 0.05) : round(entry.x);
      return {
        kind: 'scarabs',
        x,
        y: round(entry.y),
        ...(path.length ? { path: path.map(pt) } : {}),
        ...(path.length && n.radius ? { radius: round(n.radius) } : {}),
      };
    });
    const all = [...(this.getData().hazards ?? []).filter((h) => h.kind !== 'scarabs'), ...defs];
    return all.length ? validateHazards(all) : undefined;
  }

  private clearPath(): void {
    const sel = this.tool.selection;
    if (!sel) return;
    const model = this.tool.model();
    model.nest[sel.index].points.splice(1);
    this.tool.apply(model, 'Path cleared: scarabs scramble straight down from the entry point to the floor.');
  }

  private panel(model: PathModel, selected: number): void {
    const active = document.body.dataset.tool === 'scarabs';
    document.getElementById('scarab-tools')!.hidden = !active;
    if (!active) return;
    const nests = model.nest;
    const nest = nests[selected];
    const others = (this.getData().hazards ?? []).filter((h) => h.kind !== 'scarabs').length;
    button('scarab-add-nest').disabled = others + nests.length >= MAX_HAZARDS;
    button('scarab-delete').disabled = !nest;
    button('scarab-clear-path').disabled = !nest || nest.points.length < 2;
    const count = `${nests.length} nest${nests.length === 1 ? '' : 's'}`;
    document.getElementById('scarab-summary')!.textContent = nest
      ? `${count} · selected: nest ${selected + 1}, entry (${nest.points[0].x.toFixed(1)}, ${nest.points[0].y.toFixed(1)}), ${nest.points.length - 1} path point${nest.points.length === 2 ? '' : 's'}.`
      : `${count} · nothing selected.`;
  }
}
