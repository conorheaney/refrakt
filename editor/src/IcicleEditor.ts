import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { ICICLE_Z } from '../../src/gameplay/hazards/icicles/IcicleView';
import {
  ICICLE_AREA_LIMITS,
  icicleAreaIcicles,
  icicleAreaSlots,
  MAX_HAZARDS,
  validateHazards,
  type HazardDef,
  type IcicleAreaDef,
  type IcicleDef,
} from '../../src/gameplay/hazards/hazards';
import { roundedPath } from '../../src/engine/core/paths';
import { distance, nearestOnSegment, type Point } from '../../src/gameplay/arena/playAreas';
import { PathTool, svg, type EditPath, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

const button = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

/** An icicle area as a path: the line along the underside of the scenery, and what grows from it. */
interface AreaPath extends EditPath {
  count: number;
  minLength: number;
  maxLength: number;
  seed: number;
  positions?: number[];
}

const [MIN_POINTS, MAX_POINTS] = ICICLE_AREA_LIMITS.points;
const round = (n: number): number => Math.round(n * 100) / 100;
const def = (a: AreaPath): IcicleAreaDef => ({
  kind: 'icicles',
  points: a.points.map((p) => ({ x: round(p.x), y: round(p.y) })),
  count: a.count,
  minLength: a.minLength,
  maxLength: a.maxLength,
  seed: a.seed,
  ...(a.positions
    ? { positions: a.positions.map((p) => Math.round(Math.min(1, Math.max(0, p)) * 10000) / 10000) }
    : {}),
  ...(a.radius ? { radius: round(a.radius) } : {}),
});

/**
 * Edits where a world's icicles form (AuthoredWorld.hazards, kind 'icicles') with the shared path tool
 * (PathTool): each area is a line, curvable, along the underside of the scenery; the icicles it grows are
 * drawn hanging from it (at the icicles' drawn depth, so it lines up with the ice in the scene). Each icicle
 * has a small handle where it meets the line: dragging one slides it along, which pins every icicle in the
 * area to its own position (until Even spacing). Icicles placed one by one (kind 'icicle', older files) are
 * shown dashed and can be turned into an area.
 */
export class IcicleEditor {
  private readonly tool: PathTool;
  /** Sliding an icicle (areas being changed, live); null when idle. */
  private slide: { areas: AreaPath[]; area: number; icicle: number } | null = null;
  private readonly root = document.getElementById('areas') as unknown as SVGSVGElement;
  private readonly layer = document.getElementById('icicle-layer')!;

  constructor(
    scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (hazards: HazardDef[] | undefined) => void,
    private readonly preview: (hazards: HazardDef[] | undefined) => void,
    private readonly status: (message: string, error?: boolean) => void,
  ) {
    this.tool = new PathTool(scene, {
      tool: 'icicles',
      groups: [
        {
          kind: 'area',
          noun: 'icicle area',
          closed: false,
          color: '#9fd8ff',
          minPoints: MIN_POINTS,
          maxPoints: MAX_POINTS,
          maxPaths: MAX_HAZARDS,
        },
      ],
      depth: ICICLE_Z,
      layer: this.layer,
      curve: input('icicle-curve'),
      read: () => ({ area: this.read() }),
      write: (model, final, message) => {
        const hazards = this.hazards(model.area as AreaPath[]);
        if (final) {
          this.commit(hazards);
          status(message);
        } else this.preview(hazards ?? []);
      },
      revert: () => this.preview(undefined),
      status,
      clamp: (p) => ({ x: Math.max(-25, Math.min(25, p.x)), y: Math.max(-12, Math.min(14, p.y)) }),
      create: (_kind, points) =>
        ({
          points,
          radius: 0,
          count: 6,
          minLength: 0.9,
          maxLength: 1.6,
          seed: 1 + Math.floor(Math.random() * 999),
        }) as AreaPath,
      under: (_model, _sel, project) => this.drawGuide(project),
      over: (model, sel, project) => this.drawIcicles(model.area as AreaPath[], sel?.index ?? -1, project),
      changed: (model, sel) => this.panel(model.area as AreaPath[], sel?.index ?? -1),
    });
    button('icicle-add').addEventListener('click', () => this.tool.draw('area'));
    button('icicle-delete').addEventListener('click', () => this.tool.removeSelected());
    button('icicle-reshuffle').addEventListener('click', () =>
      this.change((a) => {
        a.seed = (a.seed + 1 + Math.floor(Math.random() * 997)) % 1_000_000;
      }, 'New spacing and lengths. Reshuffle again or undo to go back.'),
    );
    button('icicle-even').addEventListener('click', () =>
      this.change((a) => {
        delete a.positions;
      }, 'Icicles spaced out automatically again.'),
    );
    button('icicle-convert').addEventListener('click', () => this.convert());
    this.slider('icicle-count', (a, v) => this.setCount(a, v));
    this.slider('icicle-min', (a, v) => {
      a.minLength = v;
      if (a.maxLength < v) a.maxLength = v;
    });
    this.slider('icicle-max', (a, v) => {
      a.maxLength = v;
      if (a.minLength > v) a.minLength = v;
    });
    // Sliding icicles along their line (their handles are this tool's own, not the path tool's).
    this.root.addEventListener('pointerdown', (event) => this.slideStart(event));
    this.root.addEventListener('pointermove', (event) => this.slideMove(event));
    this.root.addEventListener('pointerup', (event) => this.slideEnd(event));
  }

  refresh(): void {
    this.tool.refresh();
  }

  private read(): AreaPath[] {
    return (this.getData().hazards ?? [])
      .filter((h): h is IcicleAreaDef => h.kind === 'icicles')
      .map((h) => ({
        points: h.points.map((p) => ({ x: p.x, y: p.y })),
        radius: h.radius ?? 0,
        count: h.count,
        minLength: h.minLength,
        maxLength: h.maxLength,
        seed: h.seed,
        ...(h.positions ? { positions: [...h.positions] } : {}),
      }));
  }

  /** Icicles placed one at a time (older world files). */
  private placed(): IcicleDef[] {
    return (this.getData().hazards ?? []).filter((h): h is IcicleDef => h.kind === 'icicle');
  }

  /** The world's hazards with these areas in place of its old ones (snakes, nests, placed icicles kept unless dropped). */
  private hazards(areas: AreaPath[], keepPlaced = true): HazardDef[] | undefined {
    const others = (this.getData().hazards ?? []).filter(
      (h) => h.kind !== 'icicles' && (keepPlaced || h.kind !== 'icicle'),
    );
    const all = [...others, ...areas.map(def)];
    return all.length ? validateHazards(all) : undefined;
  }

  /** Changes the selected area and saves it. */
  private change(edit: (area: AreaPath) => void, message: string): void {
    const sel = this.tool.selection;
    if (!sel) return;
    const model = this.tool.model();
    edit(model.area[sel.index] as AreaPath);
    this.tool.apply(model, message);
  }

  /** A range input that previews while dragged and saves (with undo) when released. */
  private slider(id: string, set: (area: AreaPath, value: number) => void): void {
    let pending: PathModel | null = null;
    input(id).addEventListener('input', () => {
      const sel = this.tool.selection;
      if (!sel) return;
      pending = this.tool.model();
      set(pending.area[sel.index] as AreaPath, Number(input(id).value));
      try {
        this.preview(this.hazards(pending.area as AreaPath[]) ?? []);
      } catch {
        this.preview(undefined);
      }
      this.drawPending(pending);
    });
    input(id).addEventListener('change', () => {
      if (pending) this.tool.apply(pending, 'Icicles changed.');
      pending = null;
    });
  }

  /** Redraws with a slider's change in progress (the path tool shows the saved paths underneath). */
  private drawPending(model: PathModel): void {
    this.tool.refresh();
    this.layer.querySelectorAll('[data-extra]').forEach((n) => n.remove());
    this.drawIcicles(model.area as AreaPath[], this.tool.selection?.index ?? -1, this.tool.project);
    this.panel(model.area as AreaPath[], this.tool.selection?.index ?? -1);
  }

  /** Each icicle's position along the line (0-1), pinned or from the automatic spacing. */
  private positionsOf(area: AreaPath): number[] {
    return area.positions ? [...area.positions] : icicleAreaSlots(def(area)).map((slot) => slot.at);
  }

  /** Changes how many icicles an area holds. Pinned icicles stay put: a new one goes in the widest gap, removing one takes it from the most crowded spot. */
  private setCount(area: AreaPath, count: number): void {
    if (area.positions) {
      const at = [...area.positions];
      while (at.length < count) {
        const sorted = [0, ...[...at].sort((a, b) => a - b), 1];
        let best = 0;
        for (let i = 1; i < sorted.length; i++)
          if (sorted[i] - sorted[i - 1] > sorted[best + 1] - sorted[best]) best = i - 1;
        at.push((sorted[best] + sorted[best + 1]) / 2);
      }
      while (at.length > count) {
        let crowded = 0;
        let tightest = Infinity;
        at.forEach((p, i) => {
          const nearest = Math.min(...at.map((q, j) => (j === i ? Infinity : Math.abs(q - p))));
          if (nearest < tightest) {
            tightest = nearest;
            crowded = i;
          }
        });
        at.splice(crowded, 1);
      }
      area.positions = at;
    }
    area.count = count;
  }

  /** How far along an area's line as drawn (0-1) a screen point lies, at its nearest point on the line. */
  private along(area: AreaPath, screen: Point): number {
    const pts = roundedPath(area.points, false, area.radius);
    const lengths: number[] = [0];
    for (let i = 1; i < pts.length; i++)
      lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = lengths[lengths.length - 1] || 1;
    let best = { d: Infinity, at: 0 };
    for (let i = 1; i < pts.length; i++) {
      const a = this.tool.project(pts[i - 1]);
      const b = this.tool.project(pts[i]);
      const q = nearestOnSegment(screen, a, b);
      const span = distance(a, b);
      const t = span > 0 ? distance(a, q) / span : 0;
      const d = distance(screen, q);
      if (d < best.d) best = { d, at: (lengths[i - 1] + t * (lengths[i] - lengths[i - 1])) / total };
    }
    return Math.min(1, Math.max(0, best.at));
  }

  private local(event: MouseEvent): Point {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private slideStart(event: PointerEvent): void {
    if (document.body.dataset.tool !== 'icicles' || event.button !== 0) return;
    const target = (event.target as Element).closest('[data-icicle]');
    if (!target) return;
    event.preventDefault();
    const a = Number(target.getAttribute('data-area'));
    const areas = this.tool.model().area as AreaPath[];
    // Sliding one icicle pins them all, so the others stay exactly where they are.
    areas[a].positions = this.positionsOf(areas[a]);
    this.slide = { areas, area: a, icicle: Number(target.getAttribute('data-icicle')) };
    this.root.setPointerCapture(event.pointerId);
    this.tool.select({ kind: 'area', index: a });
  }

  private slideMove(event: PointerEvent): void {
    const slide = this.slide;
    if (!slide) return;
    const area = slide.areas[slide.area];
    area.positions![slide.icicle] = this.along(area, this.local(event));
    try {
      this.preview(this.hazards(slide.areas) ?? []);
    } catch {
      this.preview(undefined);
    }
    this.drawPending({ area: slide.areas });
  }

  private slideEnd(event: PointerEvent): void {
    const slide = this.slide;
    if (!slide) return;
    this.slide = null;
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    this.tool.apply(
      { area: slide.areas },
      'Icicle moved. The icicles in this area now keep their positions; Even spacing lets them spread out again.',
    );
  }

  /** Arrow keys slide a focused icicle along its line. */
  private nudgeIcicle(a: number, i: number, event: KeyboardEvent): void {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const model = this.tool.model();
    const area = model.area[a] as AreaPath;
    area.positions = this.positionsOf(area);
    // Left on screen is towards the line's first point only if the line runs left to right.
    const dir = area.points[area.points.length - 1].x >= area.points[0].x ? 1 : -1;
    area.positions[i] = Math.min(1, Math.max(0, area.positions[i] + d * dir * (event.shiftKey ? 0.05 : 0.01)));
    this.tool.selection = { kind: 'area', index: a };
    if (this.tool.apply(model, 'Icicle moved.'))
      (this.layer.querySelector(`[data-area="${a}"][data-icicle="${i}"]`) as SVGElement | null)?.focus();
  }

  /** Replaces the icicles placed one by one with a single area running through them. */
  private convert(): void {
    const placed = [...this.placed()].sort((a, b) => a.x - b.x);
    if (!placed.length) return;
    const areas = this.tool.model().area as AreaPath[];
    const lengths = placed.map((c) => c.length);
    const pad = placed.length > 1 ? (placed[placed.length - 1].x - placed[0].x) / (placed.length - 1) / 2 : 1;
    const first = placed[0];
    const last = placed[placed.length - 1];
    // Through the ends and (for an arch) the highest one in between.
    const top = placed.reduce((best, c) => (c.y > best.y ? c : best), first);
    const points: Point[] = [{ x: first.x - pad, y: first.y }];
    if (top !== first && top !== last) points.push({ x: top.x, y: top.y });
    points.push({ x: last.x + pad, y: last.y });
    areas.push({
      points,
      radius: 0,
      count: Math.min(ICICLE_AREA_LIMITS.count[1], placed.length),
      minLength: Math.min(...lengths),
      maxLength: Math.max(...lengths),
      seed: 1,
    });
    try {
      this.commit(this.hazards(areas, false));
      this.status(
        `Turned ${placed.length} placed icicle${placed.length === 1 ? '' : 's'} into an area. Undo is available.`,
      );
      this.tool.select({ kind: 'area', index: areas.length - 1 });
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error), true);
    }
  }

  /** Where the highest bricks in any level start: icicle tips should stay above this. */
  private brickTop(): number | null {
    const data = this.getData();
    const grid = data.world.grid;
    let row = Infinity;
    for (const level of data.levels)
      level.rows.forEach((r, i) => {
        if (/[^.]/.test(r)) row = Math.min(row, i);
      });
    return Number.isFinite(row) ? grid.topY - row * grid.cellH + grid.halfH : null;
  }

  private drawGuide(project: (p: Point) => Point): void {
    const floor = this.brickTop();
    if (floor === null) return;
    const grid = this.getData().world.grid;
    const half = (grid.cols * grid.cellW) / 2 + 2;
    const a = project({ x: -half, y: floor });
    const b = project({ x: half, y: floor });
    this.layer.append(
      svg('line', {
        x1: String(a.x),
        y1: String(a.y),
        x2: String(b.x),
        y2: String(b.y),
        class: 'icicle-guide',
        'data-extra': '',
      }),
    );
  }

  private tooLow = 0;

  /** The icicles hanging from each area (and the placed ones), with a slide handle where each meets its line. */
  private drawIcicles(areas: AreaPath[], selected: number, project: (p: Point) => Point): void {
    const floor = this.brickTop();
    this.tooLow = 0;
    const hang = (c: IcicleDef, cls: string): void => {
      const low = floor !== null && c.y - c.length < floor;
      if (low) this.tooLow++;
      const a = project({ x: c.x, y: c.y });
      const b = project({ x: c.x, y: c.y - c.length });
      this.layer.append(
        svg('line', {
          x1: String(a.x),
          y1: String(a.y),
          x2: String(b.x),
          y2: String(b.y),
          class: `icicle-hang ${cls}${low ? ' too-low' : ''}`,
          'data-extra': '',
        }),
      );
    };
    for (const c of this.placed()) hang(c, 'placed');
    areas.forEach((area, a) => {
      const chosen = a === selected;
      const grown = icicleAreaIcicles(def(area));
      for (const c of grown) hang(c, chosen ? 'selected' : '');
      grown.forEach((c, i) => {
        const q = project({ x: c.x, y: c.y });
        const node = svg('rect', {
          x: String(q.x - 4),
          y: String(q.y - 4),
          width: '8',
          height: '8',
          transform: `rotate(45 ${q.x} ${q.y})`,
          class: `icicle-root${chosen ? ' selected' : ''}${area.positions ? ' pinned' : ''}`,
          'data-extra': '',
          'data-area': String(a),
          'data-icicle': String(i),
          tabindex: '0',
          role: 'button',
          'aria-label': `Icicle ${i + 1} of area ${a + 1}. Drag along the line or use arrow keys to slide it.`,
        });
        node.addEventListener('keydown', (event) => this.nudgeIcicle(a, i, event));
        this.layer.append(node);
      });
    });
  }

  private panel(areas: AreaPath[], selected: number): void {
    const active = document.body.dataset.tool === 'icicles';
    document.getElementById('icicle-tools')!.hidden = !active;
    if (!active) return;
    const current = areas[selected];
    for (const id of ['icicle-delete', 'icicle-reshuffle']) button(id).disabled = !current;
    button('icicle-even').disabled = !current?.positions;
    for (const id of ['icicle-count', 'icicle-min', 'icicle-max']) input(id).disabled = !current;
    button('icicle-add').disabled =
      (this.getData().hazards ?? []).filter((h) => h.kind !== 'icicles').length + areas.length >= MAX_HAZARDS;
    const placed = this.placed().length;
    button('icicle-convert').hidden = placed === 0;
    if (current) {
      const values: [string, number, string][] = [
        ['icicle-count', current.count, String(current.count)],
        ['icicle-min', current.minLength, current.minLength.toFixed(2)],
        ['icicle-max', current.maxLength, current.maxLength.toFixed(2)],
      ];
      for (const [id, value, text] of values) {
        if (document.activeElement !== input(id)) input(id).value = String(value);
        document.getElementById(`${id}-value`)!.textContent = text;
      }
    }
    const parts = [
      areas.length
        ? `${areas.length} area${areas.length === 1 ? '' : 's'}${current ? ` · selected: area ${selected + 1}, ${current.count} icicles${current.positions ? ' (positioned by hand)' : ''}` : ' · nothing selected'}`
        : 'No icicle areas in this world yet.',
    ];
    if (placed) parts.push(`${placed} placed icicle${placed === 1 ? '' : 's'} (dashed)`);
    if (this.tooLow) parts.push(`${this.tooLow} reach the bricks`);
    document.getElementById('icicle-summary')!.textContent = parts.join(' · ');
  }
}
