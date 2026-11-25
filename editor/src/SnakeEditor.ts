import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { SNAKE_DEPTH } from '../../src/gameplay/hazards/snakes/SnakeView';
import { MAX_HAZARDS, validateHazards, type HazardDef, type SnakeDef } from '../../src/gameplay/hazards/hazards';
import type { Point } from '../../src/gameplay/arena/playAreas';
import { PathTool, svg, type EditPath, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

const button = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

/** A snake as a path: from its tail along its body to its head at the den (the last point), and its strike reach. */
interface SnakePath extends EditPath {
  reach: number;
}

const MAX_BODY = 32;
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Places the world's wall snakes (AuthoredWorld.hazards, kind 'snake') with the shared path tool (PathTool):
 * each is a line, curvable, from the tail (hollow) along the points its body lies on to its head at the den
 * (large handle), with its strike reach as a dashed ring. Handles sit at the snake's drawn depth, so they line
 * up with the 3D snake in the scene. Shift-click extends the tail.
 */
export class SnakeEditor {
  private readonly tool: PathTool;
  private readonly layer = document.getElementById('snake-layer')!;
  /** The reach slider's change in progress; null when idle. */
  private pending: PathModel | null = null;

  constructor(
    scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (hazards: HazardDef[] | undefined) => void,
    private readonly preview: (hazards: HazardDef[] | undefined) => void,
    status: (message: string, error?: boolean) => void,
  ) {
    this.tool = new PathTool(scene, {
      tool: 'snakes',
      groups: [
        {
          kind: 'snake',
          noun: 'snake',
          closed: false,
          color: '#9be36d',
          minPoints: 2,
          maxPoints: MAX_BODY + 1,
          maxPaths: MAX_HAZARDS,
          extend: 'start',
          fixed: (path) => [path.points.length - 1],
          role: (path, i) => (i === path.points.length - 1 ? 'anchor' : i === 0 ? 'end' : ''),
        },
      ],
      depth: SNAKE_DEPTH,
      layer: this.layer,
      curve: input('snake-curve'),
      read: () => ({ snake: this.read() }),
      write: (model, final, message) => {
        const hazards = this.hazards(model.snake as SnakePath[]);
        if (final) {
          this.commit(hazards);
          status(message);
        } else this.preview(hazards ?? []);
      },
      revert: () => this.preview(undefined),
      status,
      clamp: (p) => ({ x: Math.max(-39, Math.min(39, p.x)), y: Math.max(-19, Math.min(19, p.y)) }),
      // Drawn head first, then back along the body to the tail; kept tail first.
      create: (_kind, points) => ({ points: [...points].reverse(), radius: 0, reach: 7 }) as SnakePath,
      under: (model, sel, project) =>
        this.drawReach((this.pending ?? model).snake as SnakePath[], sel?.index ?? -1, project),
      changed: (model, sel) => this.panel((this.pending ?? model).snake as SnakePath[], sel?.index ?? -1),
    });
    button('snake-add').addEventListener('click', () => this.tool.draw('snake'));
    button('snake-delete').addEventListener('click', () => this.tool.removeSelected());
    input('snake-reach').addEventListener('input', () => {
      const sel = this.tool.selection;
      if (!sel) return;
      this.pending = this.tool.model();
      (this.pending.snake[sel.index] as SnakePath).reach = Number(input('snake-reach').value);
      this.tool.refresh();
    });
    input('snake-reach').addEventListener('change', () => {
      const pending = this.pending;
      this.pending = null;
      if (pending) this.tool.apply(pending, 'Strike reach changed.');
    });
  }

  refresh(): void {
    this.tool.refresh();
  }

  private read(): SnakePath[] {
    return (this.getData().hazards ?? [])
      .filter((h): h is SnakeDef => h.kind === 'snake')
      .map((h) => ({
        points: [...(h.body ?? this.defaultBody(h.x, h.y)).map((p) => ({ x: p.x, y: p.y })), { x: h.x, y: h.y }],
        radius: h.radius ?? 0,
        reach: h.reach,
      }));
  }

  /** A straight body running out past the wall behind the den (for snakes saved without one). */
  private defaultBody(x: number, y: number): Point[] {
    const out = x < 0 ? -1 : 1;
    return [9, 6.5, 4, 2].map((d) => ({ x: x + out * d, y }));
  }

  /** The world's hazards with these snakes in place of its old ones (everything else untouched). */
  private hazards(snakes: SnakePath[]): HazardDef[] | undefined {
    const defs = snakes.map((s): SnakeDef => {
      const den = s.points[s.points.length - 1];
      return {
        kind: 'snake',
        x: round(den.x),
        y: round(den.y),
        reach: s.reach,
        body: s.points.slice(0, -1).map((p) => ({ x: round(p.x), y: round(p.y) })),
        ...(s.radius ? { radius: round(s.radius) } : {}),
      };
    });
    const all = [...(this.getData().hazards ?? []).filter((h) => h.kind !== 'snake'), ...defs];
    return all.length ? validateHazards(all) : undefined;
  }

  /** Strike reach: a ring around each den. */
  private drawReach(snakes: SnakePath[], selected: number, project: (p: Point) => Point): void {
    snakes.forEach((snake, s) => {
      const den = snake.points[snake.points.length - 1];
      const ring: string[] = [];
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * Math.PI * 2;
        const q = project({ x: den.x + Math.cos(a) * snake.reach, y: den.y + Math.sin(a) * snake.reach });
        ring.push(`${k ? 'L' : 'M'}${q.x},${q.y}`);
      }
      this.layer.append(
        svg('path', { d: ring.join(' '), class: `snake-reach${s === selected ? ' selected' : ''}`, 'data-extra': '' }),
      );
    });
  }

  private panel(snakes: SnakePath[], selected: number): void {
    const active = document.body.dataset.tool === 'snakes';
    document.getElementById('snake-tools')!.hidden = !active;
    if (!active) return;
    const current = snakes[selected];
    button('snake-delete').disabled = !current;
    input('snake-reach').disabled = !current;
    button('snake-add').disabled =
      (this.getData().hazards ?? []).filter((h) => h.kind !== 'snake').length + snakes.length >= MAX_HAZARDS;
    if (current) {
      if (document.activeElement !== input('snake-reach')) input('snake-reach').value = String(current.reach);
      document.getElementById('snake-reach-value')!.textContent = current.reach.toFixed(1);
    }
    const head = current?.points[current.points.length - 1];
    document.getElementById('snake-summary')!.textContent = !snakes.length
      ? 'No snakes in this world yet.'
      : head
        ? `${snakes.length} snake${snakes.length === 1 ? '' : 's'} · selected: snake ${selected + 1}, head at (${head.x.toFixed(1)}, ${head.y.toFixed(1)})`
        : `${snakes.length} snake${snakes.length === 1 ? '' : 's'} · nothing selected.`;
  }
}
