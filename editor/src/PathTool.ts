import { MAX_PATH_RADIUS, roundedPath } from '../../src/engine/core/paths';
import { distance, nearestOnSegment, simplifyStroke, type Point } from '../../src/gameplay/arena/playAreas';
import type { EditorScene } from './Scene';

const ns = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(ns, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

/** One path being edited: its control points and how much its corners are rounded (engine/core/paths.ts). */
export interface EditPath {
  points: Point[];
  radius: number;
}

/** A kind of path a tool edits (scarab nests, icicle lines, snakes, play areas). */
export interface PathGroup {
  /** Key in the tool's model, and in data-group attributes. */
  readonly kind: string;
  /** What one is called, for labels and messages ("nest", "snake"). */
  readonly noun: string;
  /** Outline (last point joins the first) or line. */
  readonly closed: boolean;
  /** CSS colour of its lines and handles. */
  readonly color: string;
  readonly minPoints: number;
  readonly maxPoints: number;
  /** Most paths of this kind. */
  readonly maxPaths: number;
  /** Where Shift-click adds a point on an open path: after its last point (default) or before its first. */
  readonly extend?: 'end' | 'start';
  /** Points that cannot be removed (a nest's entry, a snake's head), by index; default none. */
  fixed?(path: EditPath): number[];
  /** Extra class for a point's handle: 'anchor' (large) or 'end' (hollow); default none. */
  role?(path: EditPath, index: number): string;
  /** Whether a path can be deleted outright (play areas can only be reset); default true. */
  readonly deletable?: boolean;
  /** Whether its paths show and can be edited right now (only the current play area); default true. */
  editable?(): boolean;
}

export type PathModel = Record<string, EditPath[]>;
export interface Selection { kind: string; index: number }

/** What a tool supplies: its data as paths, how to save them, and anything it draws or handles itself. */
export interface PathHost {
  /** The body[data-tool] value the tool is active under. */
  readonly tool: string;
  readonly groups: readonly PathGroup[];
  /** Depth its paths are drawn at, so they line up with what they shape in the scene (undefined: the play plane). */
  readonly depth?: number;
  /** The <g> it draws into. */
  readonly layer: Element;
  /** The range input for the selected path's corner rounding. */
  readonly curve?: HTMLInputElement;
  /** The world's paths as they are saved. */
  read(): PathModel;
  /**
   * Saves `model` (final: one undo step, with `message` shown) or previews it in the scene (not final). Throws
   * with a message the user can act on if it is invalid.
   */
  write(model: PathModel, final: boolean, message: string): void;
  /** Shows the saved world again in the scene (after an abandoned or invalid preview). */
  revert(): void;
  status(message: string, error?: boolean): void;
  /** A new path of this kind drawn from these points (defaults: those points, no rounding). */
  create?(kind: string, points: Point[], model: PathModel): EditPath;
  /** Whether a new path replaces the only one of its kind (play areas); default false. */
  readonly replaces?: boolean;
  /** Draws the tool's own overlays (under the paths: reach rings, drain edges; over them: icicles). */
  under?(model: PathModel, selection: Selection | null, project: (p: Point) => Point): void;
  over?(model: PathModel, selection: Selection | null, project: (p: Point) => Point): void;
  /** Adjusts a pointer position (snapping to scenery edges, straight lines); default as is. */
  adjust?(screen: Point, world: Point, event: MouseEvent, anchors: readonly Point[]): Point;
  /** Clamps a point to where this kind may go. */
  clamp?(p: Point): Point;
  /** After the selection or model changes: update the tool's own panel. */
  changed?(model: PathModel, selection: Selection | null): void;
}

type Part = 'point' | 'line' | 'body';

/** How every path is edited, shown in each tool's panel. */
const PATH_HELP = 'Drawing: click points (or drag to trace); click the first point (outline) or last point (line), or press Enter, to finish; Backspace undoes a point; Esc cancels. Editing: click a path to select it, empty space to deselect · drag a point to move it, the line or shape to move it all · Shift-click adds a point · double-click the line inserts one · right-click or Delete removes a point · Delete removes the selected path · arrow keys nudge (Shift: further) · Curve rounds the corners.';

/** Pointer movement (px) under which a press counts as a click. */
const CLICK_SLOP = 4;
/** Screen distance (px) within which a click on a drawn path's first point closes it (or last ends it). */
const CLOSE_REACH = 12;

/**
 * Edits paths (see engine/core/paths.ts): open lines and closed outlines, every one curvable, the same way in
 * every tool. Click a path to select it, empty space to deselect. Drag a point to move it, a path's line or
 * body to move the whole path (or Shift-drag an anchor). With a path selected, Shift-click adds a point (to
 * the end of a line, or into the nearest edge of an outline); double-click a line inserts one there. Right-
 * click a point, or focus it and press Delete, to remove it; Delete with no point focused removes the
 * selected path. Arrow keys nudge a focused point (Shift: further). Drawing a new path: click its points (or
 * drag to trace), then click its first point (outline) or last point (line), or press Enter; Backspace
 * removes the last point, Esc cancels. The Curve slider rounds the selected path's corners.
 */
export class PathTool {
  selection: Selection | null = null;
  /** The kind being drawn, and its points so far; null when not drawing. */
  private drawing: { kind: string; points: Point[]; stroke: Point[] } | null = null;
  private hover: Point | null = null;
  /** The change in progress (live preview); null when idle. */
  private working: PathModel | null = null;
  private drag: { sel: Selection; part: Part; point: number; whole: boolean; from: Point; screen: Point; moved: boolean } | null = null;
  private press: { at: Point; screen: Point; moved: boolean; shift: boolean } | null = null;
  private readonly root = document.getElementById('areas') as unknown as SVGSVGElement;

  constructor(private readonly scene: EditorScene, private readonly host: PathHost) {
    document.querySelectorAll('.path-help').forEach((node) => { node.textContent = PATH_HELP; });
    this.root.addEventListener('pointerdown', (event) => this.down(event));
    this.root.addEventListener('pointermove', (event) => this.move(event));
    this.root.addEventListener('pointerup', (event) => this.up(event));
    this.root.addEventListener('pointercancel', () => this.cancelDrag());
    this.root.addEventListener('dblclick', (event) => this.insert(event));
    this.root.addEventListener('contextmenu', (event) => { if (this.active) event.preventDefault(); });
    window.addEventListener('keydown', (event) => this.key(event));
    const curve = host.curve;
    if (curve) {
      curve.min = '0';
      curve.max = String(MAX_PATH_RADIUS);
      curve.step = '0.05';
      curve.addEventListener('input', () => this.setRadius(Number(curve.value), false));
      curve.addEventListener('change', () => this.setRadius(Number(curve.value), true));
    }
  }

  get active(): boolean { return document.body.dataset.tool === this.host.tool; }
  get isDrawing(): boolean { return this.drawing !== null; }

  private group(kind: string): PathGroup {
    return this.host.groups.find((g) => g.kind === kind)!;
  }

  private editable(kind: string): boolean {
    return this.group(kind).editable?.() ?? true;
  }

  /** Editable copies of the paths (or of the change in progress). */
  model(): PathModel {
    return structuredClone(this.working ?? this.host.read());
  }

  /** The selected path in `model`, if any. */
  selected(model: PathModel): EditPath | undefined {
    const sel = this.selection;
    return sel ? model[sel.kind]?.[sel.index] : undefined;
  }

  select(selection: Selection | null): void {
    this.selection = selection;
    this.refresh();
  }

  /** Saves `model` (one undo step) or reports why it cannot be. */
  apply(model: PathModel, message: string): boolean {
    this.working = null;
    try {
      this.host.write(model, true, message);
      return true;
    } catch (error) {
      this.host.status(error instanceof Error ? error.message : String(error), true);
      this.host.revert();
      this.refresh();
      return false;
    }
  }

  /** Shows a change in progress in the scene (the saved world while it is momentarily invalid). */
  private show(model: PathModel): void {
    try { this.host.write(model, false, ''); } catch { this.host.revert(); }
  }

  // ---------------------------------------------------------------- commands

  /** Starts drawing a new path of this kind (or, called again, stops). */
  draw(kind: string): void {
    if (this.drawing?.kind === kind) { this.stopDrawing(); return; }
    const group = this.group(kind);
    const model = this.model();
    if (!this.host.replaces && (model[kind]?.length ?? 0) >= group.maxPaths) { this.host.status(`At most ${group.maxPaths} ${group.noun}s.`, true); return; }
    this.drawing = { kind, points: [], stroke: [] };
    this.selection = null;
    this.host.status(group.closed
      ? `Click round the ${group.noun}'s outline (or drag to trace it), then click its first point or press Enter to close it. Backspace removes the last point; Esc cancels.`
      : `Click the ${group.noun}'s points in order (or drag to trace), then click the last point again or press Enter to finish. Backspace removes the last point; Esc cancels.`);
    this.refresh();
  }

  stopDrawing(): void {
    this.drawing = null;
    this.hover = null;
    this.refresh();
  }

  private finishDrawing(): void {
    const drawing = this.drawing;
    if (!drawing) return;
    const group = this.group(drawing.kind);
    const points = [...drawing.points];
    if (group.closed && points.length > 3 && distance(points[0], points[points.length - 1]) < 0.15) points.pop();
    if (points.length < group.minPoints) { this.host.status(`A ${group.noun} needs at least ${group.minPoints} points.`, true); return; }
    const model = this.model();
    const path = this.host.create?.(drawing.kind, points, model) ?? { points, radius: 0 };
    const list = this.host.replaces ? [path] : [...(model[drawing.kind] ?? []), path];
    model[drawing.kind] = list;
    this.drawing = null;
    this.hover = null;
    if (this.apply(model, `${group.noun[0].toUpperCase()}${group.noun.slice(1)} added. Drag its points to adjust it; the Curve slider rounds its corners.`)) {
      this.selection = { kind: group.kind, index: list.length - 1 };
    }
    this.refresh();
  }

  /** Removes the selected path. */
  removeSelected(): void {
    const sel = this.selection;
    if (!sel || this.group(sel.kind).deletable === false) return;
    const model = this.model();
    model[sel.kind].splice(sel.index, 1);
    this.selection = null;
    this.apply(model, `${this.group(sel.kind).noun[0].toUpperCase()}${this.group(sel.kind).noun.slice(1)} deleted. Undo is available.`);
  }

  private setRadius(radius: number, final: boolean): void {
    const sel = this.selection;
    if (!sel) return;
    const model = this.model();
    const path = model[sel.kind]?.[sel.index];
    if (!path) return;
    path.radius = radius;
    if (final) this.apply(model, radius ? 'Corners rounded.' : 'Corners sharp.');
    else { this.working = model; this.show(model); this.refresh(); }
  }

  /** Adds a point to the selected path: after the end of a line (or before its start), or into an outline's nearest edge. */
  private addPoint(at: Point): void {
    const sel = this.selection;
    if (!sel) return;
    const group = this.group(sel.kind);
    const model = this.model();
    const path = model[sel.kind][sel.index];
    if (path.points.length >= group.maxPoints) { this.host.status(`A ${group.noun} can have at most ${group.maxPoints} points.`, true); return; }
    if (group.closed) path.points.splice(this.nearestEdge(path.points, this.project(at), true).at, 0, at);
    else if (group.extend === 'start') path.points.unshift(at);
    else path.points.push(at);
    this.apply(model, 'Point added.');
  }

  private removePoint(sel: Selection, point: number): void {
    const group = this.group(sel.kind);
    const model = this.model();
    const path = model[sel.kind][sel.index];
    if (group.fixed?.(path).includes(point)) { this.host.status(`That point belongs to the ${group.noun}: move it instead.`, true); return; }
    if (path.points.length <= group.minPoints) { this.host.status(`A ${group.noun} needs at least ${group.minPoints} points.`, true); return; }
    path.points.splice(point, 1);
    this.apply(model, 'Point removed.');
  }

  /** Of a path's segments (on screen), the one nearest screen point `p`: the index to insert at, and how far. */
  private nearestEdge(points: readonly Point[], p: Point, closed: boolean): { at: number; d: number } {
    const screen = points.map((q) => this.project(q));
    let best = { at: screen.length, d: Infinity };
    const last = closed ? screen.length : screen.length - 1;
    for (let i = 0; i < last; i++) {
      const d = distance(p, nearestOnSegment(p, screen[i], screen[(i + 1) % screen.length]));
      if (d < best.d) best = { at: i + 1, d };
    }
    return best;
  }

  // ---------------------------------------------------------------- pointer

  private local(event: MouseEvent): Point {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private raw(screen: Point): Point {
    return this.host.depth === undefined ? this.scene.unproject(screen) : this.scene.unproject(screen, this.host.depth);
  }

  /** The pointer in the world, adjusted (snapping) and clamped as the tool asks. */
  private world(event: MouseEvent, anchors: readonly Point[] = []): Point {
    const screen = this.local(event);
    let p = this.raw(screen);
    if (this.host.adjust) p = this.host.adjust(screen, p, event, anchors);
    return this.host.clamp ? this.host.clamp(p) : p;
  }

  project = (p: Point): Point => (this.host.depth === undefined ? this.scene.project(p) : this.scene.project(p, this.host.depth));

  private down(event: PointerEvent): void {
    if (!this.active || event.button === 1) return;
    const target = event.target as Element;
    // The tool's own handles (e.g. icicles) are not ours.
    if (target.closest('[data-extra]')) return;
    if (this.drawing) {
      if (event.button === 2) { event.preventDefault(); this.drawing.points.pop(); this.refresh(); return; }
      if (event.button !== 0) return;
      event.preventDefault();
      const group = this.group(this.drawing.kind);
      const pts = this.drawing.points;
      const screen = this.local(event);
      if (pts.length >= Math.max(2, group.minPoints) && distance(this.project(group.closed ? pts[0] : pts[pts.length - 1]), screen) <= CLOSE_REACH) { this.finishDrawing(); return; }
      this.root.setPointerCapture(event.pointerId);
      this.drawing.stroke = [this.world(event, pts)];
      return;
    }
    const kind = target.getAttribute('data-group');
    if (kind === null || !this.editable(kind)) {
      if (event.button !== 0) return;
      event.preventDefault();
      this.root.setPointerCapture(event.pointerId);
      this.press = { at: this.world(event), screen: this.local(event), moved: false, shift: event.shiftKey };
      return;
    }
    const sel = { kind, index: Number(target.getAttribute('data-index')) };
    const part = target.getAttribute('data-part') as Part;
    const point = Number(target.getAttribute('data-point') ?? -1);
    event.preventDefault();
    this.selection = sel;
    if (event.button === 2) { if (part === 'point') this.removePoint(sel, point); this.refresh(); return; }
    if (event.button !== 0) return;
    this.root.setPointerCapture(event.pointerId);
    const path = this.selected(this.model());
    const anchor = part === 'point' && (this.group(kind).role?.(path!, point) ?? '').includes('anchor');
    this.drag = { sel, part, point, whole: part !== 'point' || (anchor && event.shiftKey), from: this.world(event), screen: this.local(event), moved: false };
    this.refresh();
  }

  private move(event: PointerEvent): void {
    if (!this.active) return;
    if (this.drawing) {
      const p = this.world(event, this.drawing.points);
      this.hover = p;
      const stroke = this.drawing.stroke;
      if (stroke.length && distance(this.project(stroke[stroke.length - 1]), this.project(p)) > 5) stroke.push(p);
      this.refresh();
      return;
    }
    if (this.press) {
      if (distance(this.local(event), this.press.screen) > CLICK_SLOP) this.press.moved = true;
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && distance(this.local(event), drag.screen) <= CLICK_SLOP) return;
    if (!drag.moved) { drag.moved = true; this.working = this.model(); }
    const path = this.working![drag.sel.kind][drag.sel.index];
    const others = drag.whole ? [] : path.points.filter((_, i) => i !== drag.point);
    const p = this.world(event, others);
    if (drag.whole) {
      const dx = p.x - drag.from.x;
      const dy = p.y - drag.from.y;
      for (const q of path.points) { q.x += dx; q.y += dy; }
      drag.from = p;
    } else path.points[drag.point] = p;
    this.show(this.working!);
    this.refresh();
  }

  private up(event: PointerEvent): void {
    if (!this.active) return;
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    const drawing = this.drawing;
    if (drawing) {
      if (drawing.stroke.length) {
        // A click adds one point; a drag adds the traced line, simplified.
        const traced = drawing.stroke.length > 2 ? simplifyStroke(drawing.stroke, 0.12) : drawing.stroke.slice(0, 1);
        for (const p of traced) if (!drawing.points.length || distance(drawing.points[drawing.points.length - 1], p) > 0.08) drawing.points.push(p);
        const max = this.group(drawing.kind).maxPoints;
        if (drawing.points.length > max) drawing.points = simplifyStroke(drawing.points, 0.3).slice(0, max);
        drawing.stroke = [];
      }
      this.refresh();
      return;
    }
    const press = this.press;
    if (press) {
      this.press = null;
      if (press.moved) return;
      if (press.shift && this.selection) this.addPoint(press.at);
      else { this.selection = null; this.refresh(); }
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (!drag.moved || !this.working) { this.working = null; this.refresh(); return; }
    this.apply(this.working, drag.whole ? `${this.group(drag.sel.kind).noun[0].toUpperCase()}${this.group(drag.sel.kind).noun.slice(1)} moved.` : 'Point moved.');
  }

  private cancelDrag(): void {
    this.drag = null;
    this.press = null;
    if (this.working) { this.working = null; this.host.revert(); }
    this.refresh();
  }

  /** Double-click on a path's line or body: a point inserted in the nearest segment. */
  private insert(event: MouseEvent): void {
    if (!this.active || this.drawing) return;
    const target = event.target as Element;
    const kind = target.getAttribute('data-group');
    const part = target.getAttribute('data-part');
    if (kind === null || part === 'point' || !this.editable(kind)) return;
    const sel = { kind, index: Number(target.getAttribute('data-index')) };
    const group = this.group(kind);
    const model = this.model();
    const path = model[kind][sel.index];
    this.selection = sel;
    if (path.points.length >= group.maxPoints) { this.host.status(`A ${group.noun} can have at most ${group.maxPoints} points.`, true); this.refresh(); return; }
    const edge = this.nearestEdge(path.points, this.local(event), group.closed);
    path.points.splice(edge.at, 0, this.world(event));
    this.apply(model, 'Point inserted.');
  }

  private key(event: KeyboardEvent): void {
    if (!this.active) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      if (this.drawing) this.stopDrawing();
      else if (this.selection) this.select(null);
      return;
    }
    if (this.drawing) {
      if (event.key === 'Enter') { event.preventDefault(); this.finishDrawing(); }
      else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); this.drawing.points.pop(); this.refresh(); }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selection && !(target instanceof SVGElement && target.dataset.part === 'point')) {
      event.preventDefault();
      this.removeSelected();
    }
  }

  /** Keyboard on a focused point: arrows nudge it (Shift: further), Delete removes it. */
  private nudge(sel: Selection, point: number, event: KeyboardEvent): void {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      this.removePoint(sel, point);
      return;
    }
    const step = event.shiftKey ? 0.5 : 0.1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const model = this.model();
    const q = model[sel.kind][sel.index].points[point];
    q.x += d[0];
    q.y += d[1];
    this.selection = sel;
    if (this.apply(model, 'Point moved.')) (this.host.layer.querySelector(`[data-group="${sel.kind}"][data-index="${sel.index}"][data-point="${point}"]`) as SVGElement | null)?.focus();
  }

  // ---------------------------------------------------------------- drawing

  refresh(): void {
    const layer = this.host.layer;
    layer.replaceChildren();
    if (!this.active) { this.host.changed?.(this.host.read(), null); return; }
    const model = this.model();
    if (this.selection && !model[this.selection.kind]?.[this.selection.index]) this.selection = null;
    const sel = this.selection;
    this.host.under?.(model, sel, this.project);

    for (const group of this.host.groups) {
      // One thing at a time: groups not being worked on are not shown.
      if (!this.editable(group.kind)) continue;
      const editable = true;
      (model[group.kind] ?? []).forEach((path, index) => {
        const chosen = sel?.kind === group.kind && sel.index === index;
        const g = svg('g', { class: `path ${group.closed ? 'closed' : 'open'}${chosen ? ' selected' : ''}`, style: `color: ${group.color}` });
        layer.append(g);
        const attrs = (part: Part, point = -1): Record<string, string> => (editable
          ? { 'data-group': group.kind, 'data-index': String(index), 'data-part': part, ...(point >= 0 ? { 'data-point': String(point) } : {}) }
          : {});
        const curve = roundedPath(path.points, group.closed, path.radius).map(this.project);
        const d = curve.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ') + (group.closed ? ' Z' : '');
        if (group.closed) g.append(svg('path', { d, class: 'path-fill', ...attrs('body') }));
        g.append(svg('path', { d, class: 'path-line' }));
        // A wide invisible stroke to grab and double-click along.
        if (editable) g.append(svg('path', { d, class: 'path-hit', ...attrs('line') }));
        if (!chosen) {
          // Unselected: just its anchors, to grab it by.
          path.points.forEach((q, i) => { if ((group.role?.(path, i) ?? '').includes('anchor')) this.handle(g, this.project(q), group, path, { kind: group.kind, index }, i, editable); });
          return;
        }
        if (path.radius > 0) {
          // Curved: the straight lines between its points, which the curve is drawn from.
          const control = path.points.map(this.project);
          g.append(svg('path', { d: control.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ') + (group.closed ? ' Z' : ''), class: 'path-control' }));
        }
        path.points.forEach((q, i) => this.handle(g, this.project(q), group, path, { kind: group.kind, index }, i, editable));
      });
    }

    const drawing = this.drawing;
    if (drawing) {
      const group = this.group(drawing.kind);
      const g = svg('g', { class: 'path drawing', style: `color: ${group.color}` });
      layer.append(g);
      const pts = [...drawing.points, ...drawing.stroke].map(this.project);
      const tail = this.hover ? [this.project(this.hover)] : [];
      if (pts.length) g.append(svg('polyline', { points: [...pts, ...tail].map((q) => `${q.x},${q.y}`).join(' '), class: 'path-draft' }));
      if (group.closed && tail.length && pts.length >= 2) g.append(svg('line', { x1: String(tail[0].x), y1: String(tail[0].y), x2: String(pts[0].x), y2: String(pts[0].y), class: 'path-draft closing' }));
      const finishAt = group.closed ? 0 : drawing.points.length - 1;
      drawing.points.map(this.project).forEach((q, i) => g.append(svg('circle', { cx: String(q.x), cy: String(q.y), r: String(i === finishAt ? 7 : 4), class: `path-draft-point${i === finishAt && drawing.points.length >= Math.max(2, group.minPoints) ? ' finish' : ''}` })));
    }

    this.host.over?.(model, sel, this.project);
    const path = this.selected(model);
    const curve = this.host.curve;
    if (curve) {
      curve.disabled = !path;
      if (path && document.activeElement !== curve) curve.value = String(path.radius);
      const label = document.getElementById(`${curve.id}-value`);
      if (label) label.textContent = path ? path.radius.toFixed(2) : '–';
    }
    document.body.dataset.pathDrawing = String(!!drawing);
    this.host.changed?.(model, sel);
  }

  private handle(g: Element, p: Point, group: PathGroup, path: EditPath, sel: Selection, i: number, editable: boolean): void {
    const role = group.role?.(path, i) ?? '';
    const size = role.includes('anchor') ? 8 : group.closed ? 5 : 6;
    const node = group.closed
      ? svg('rect', { x: String(p.x - size), y: String(p.y - size), width: String(size * 2), height: String(size * 2) })
      : svg('circle', { cx: String(p.x), cy: String(p.y), r: String(size) });
    node.setAttribute('class', `path-handle ${role}`);
    if (editable) {
      const fixed = group.fixed?.(path).includes(i);
      const attrs: Record<string, string> = {
        'data-group': group.kind, 'data-index': String(sel.index), 'data-part': 'point', 'data-point': String(i), tabindex: '0', role: 'button',
        'aria-label': `${group.noun[0].toUpperCase()}${group.noun.slice(1)} ${sel.index + 1} point ${i + 1}. Drag or use arrow keys${fixed ? '' : '; Delete or right-click removes it'}.`,
      };
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
      node.addEventListener('keydown', (event) => this.nudge(sel, i, event as KeyboardEvent));
      node.addEventListener('focus', () => {
        if (this.selection?.kind === sel.kind && this.selection.index === sel.index) return;
        this.select(sel);
        (this.host.layer.querySelector(`[data-group="${sel.kind}"][data-index="${sel.index}"][data-point="${i}"]`) as SVGElement | null)?.focus();
      });
    }
    g.append(node);
  }
}
