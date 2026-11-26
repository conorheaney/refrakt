import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { PADDLE } from '../../src/gameplay/config';
import {
  areaSegments,
  distance,
  findPaddleLane,
  lowestEdge,
  nearestOnSegment,
  snapPoint,
  validateArea,
  type BallArea,
  type Point,
  type PolygonArea,
} from '../../src/gameplay/arena/playAreas';
import { defaultArea } from './defaultAreas';
import { PathTool, svg, type EditPath, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

/**
 * The editor's layers: one thing worked on at a time, with only its panel and overlays showing. 'ball' and
 * 'paddle' are edited here; the rest belong to their own editors (main.ts for level and blocks).
 */
export const LAYERS = ['level', 'blocks', 'ball', 'paddle', 'snakes', 'icicles', 'scarabs', 'weather'] as const;
export type Mode = (typeof LAYERS)[number];
const drawsArea = (mode: Mode): mode is 'ball' | 'paddle' => mode === 'ball' || mode === 'paddle';
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const button = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;

/** A play area as a path: its outline, and (ball area) which edge is the drain. */
interface AreaPath extends EditPath {
  drainEdge?: number;
}

/** Nearby contrast edges attract the cursor; no claim of semantic image segmentation. */
class SceneEdges {
  private source = '';
  private generation = 0;
  private gradient: Float32Array | null = null;
  private width = 800;
  private height = 450;
  load(url: string): void {
    if (this.source === url) return;
    this.source = url;
    this.gradient = null;
    const generation = ++this.generation;
    if (!url) return;
    const image = new Image();
    image.onload = () => {
      if (generation !== this.generation) return;
      this.height = Math.round((this.width * image.height) / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gradient = new Float32Array(canvas.width * canvas.height);
      for (let y = 1; y < canvas.height - 1; y++)
        for (let x = 1; x < canvas.width - 1; x++) {
          const i = y * canvas.width + x;
          let strength = 0;
          for (let c = 0; c < 3; c++)
            strength = Math.max(
              strength,
              Math.hypot(
                pixels[(i + 1) * 4 + c] - pixels[(i - 1) * 4 + c],
                pixels[(i + canvas.width) * 4 + c] - pixels[(i - canvas.width) * 4 + c],
              ),
            );
          gradient[i] = strength;
        }
      this.gradient = gradient;
    };
    image.src = url;
  }
  snap(p: Point, width: number, height: number): Point {
    if (!this.gradient) return p;
    const scale = Math.max(width / this.width, height / this.height);
    const ox = (width - this.width * scale) / 2,
      oy = (height - this.height * scale) / 2;
    const cx = (p.x - ox) / scale,
      cy = (p.y - oy) / scale;
    const radius = Math.ceil(10 / scale);
    let best = 0,
      result = p;
    for (let y = Math.max(1, Math.floor(cy) - radius); y <= Math.min(this.height - 2, Math.ceil(cy) + radius); y++) {
      for (let x = Math.max(1, Math.floor(cx) - radius); x <= Math.min(this.width - 2, Math.ceil(cx) + radius); x++) {
        const strength = this.gradient[y * this.width + x],
          d = Math.hypot(x - cx, y - cy) * scale;
        if (strength < 60 || d > 10) continue;
        const score = strength / (d + 3);
        if (score > best) {
          best = score;
          result = { x: x * scale + ox, y: y * scale + oy };
        }
      }
    }
    return result;
  }
}

/**
 * Switches the editor between its tools, and edits the ball and paddle play areas (AuthoredWorld.playAreas)
 * with the shared path tool (PathTool): each is a closed outline, curvable, the one for the current tool
 * editable and the other shown for reference. Drawing a new one replaces the old. Points are drawn onto
 * nearby scene edges and lines up with other points (hold Alt to place freely). The ball area's drain edge
 * (amber) is picked with Choose drain edge.
 */
export class AreaEditor {
  mode: Mode = 'blocks';
  private drainPicking = false;
  private readonly edges = new SceneEdges();
  private readonly root = document.getElementById('areas') as unknown as SVGSVGElement;
  private readonly layer = document.getElementById('area-lines')!;
  private readonly tool: PathTool;

  constructor(
    private readonly scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (mode: 'ball' | 'paddle', area: PolygonArea) => void,
    private readonly status: (message: string, error?: boolean) => void,
  ) {
    const group = (kind: 'ball' | 'paddle', color: string) => ({
      kind,
      noun: kind === 'ball' ? 'ball area' : 'paddle area',
      closed: true,
      color,
      minPoints: 3,
      maxPoints: 96,
      maxPaths: 1,
      deletable: false,
      editable: () => this.mode === kind,
    });
    this.tool = new PathTool(scene, {
      tool: 'area',
      groups: [group('ball', '#56e0ff'), group('paddle', '#7dffc4')],
      layer: this.layer,
      curve: input('smoothing'),
      read: () => ({ ball: [this.area('ball')], paddle: [this.area('paddle')] }),
      write: (model, final, message) => {
        if (!final || !drawsArea(this.mode)) return;
        const area = this.toArea(this.mode, model[this.mode][0] as AreaPath);
        validateArea(area, this.mode === 'ball');
        if (this.mode === 'paddle') findPaddleLane(area, PADDLE.expandedWidth, PADDLE.halfH);
        this.commit(this.mode, area);
        this.status(
          message ||
            (this.mode === 'ball'
              ? 'Ball boundary applied. Amber edge is the drain; test the level to check bounces.'
              : 'Paddle area applied. The paddle moves horizontally within the marked lane.'),
        );
      },
      revert: () => {},
      status,
      replaces: true,
      create: (kind, points) => ({
        points,
        radius: Number(input('smoothing').value) || 0,
        ...(kind === 'ball' ? { drainEdge: lowestEdge(points) } : {}),
      }),
      adjust: (screen, world, event, anchors) => this.snap(screen, world, event, anchors),
      clamp: (p) => ({ x: Math.max(-40, Math.min(40, p.x)), y: Math.max(-24, Math.min(24, p.y)) }),
      under: (model, _sel, project) => this.drawGuides(model, project),
      changed: () => {
        button('finish-area').disabled = !this.tool.isDrawing;
        button('cancel-area').disabled = !this.tool.isDrawing;
        button('drain-tool').setAttribute('aria-pressed', String(this.drainPicking));
      },
    });
    for (const mode of LAYERS) button(`mode-${mode}`).addEventListener('click', () => this.setMode(mode));
    button('draw-area').addEventListener('click', () => {
      if (drawsArea(this.mode)) {
        this.drainPicking = false;
        this.tool.draw(this.mode);
      }
    });
    button('finish-area').addEventListener('click', () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })),
    );
    button('cancel-area').addEventListener('click', () => this.tool.stopDrawing());
    button('reset-area').addEventListener('click', () => {
      if (drawsArea(this.mode)) {
        this.tool.stopDrawing();
        this.commit(this.mode, this.mode === 'ball' ? defaultArea('ball') : defaultArea('paddle'));
        this.refresh();
      }
    });
    button('drain-tool').addEventListener('click', () => {
      this.drainPicking = !this.drainPicking;
      this.refresh();
      if (this.drainPicking)
        this.status('Click a ball-area edge to make it the drain. Balls leaving through this edge lose a life.');
    });
    // Picking the drain edge takes the click before the path tool sees it.
    this.root.addEventListener('pointerdown', (event) => this.pickDrain(event), { capture: true });
    this.setMode('blocks');
  }

  /** Called after the tool changes, so other overlays (snakes, icicles, scarabs) can redraw. */
  onModeChange: () => void = () => {};

  setMode(mode: Mode): void {
    this.mode = mode;
    this.drainPicking = false;
    this.tool.stopDrawing();
    this.tool.selection = drawsArea(mode) ? { kind: mode, index: 0 } : null;
    // The path tool works under 'area' for both play areas; the others are their own tools.
    document.body.dataset.tool = drawsArea(mode) ? 'area' : mode;
    document.body.dataset.mode = mode;
    for (const entry of LAYERS) button(`mode-${entry}`).setAttribute('aria-pressed', String(mode === entry));
    document.getElementById('area-tools')!.hidden = !drawsArea(mode);
    document.getElementById('area-title')!.textContent = mode === 'ball' ? 'Ball play area' : 'Paddle play area';
    button('drain-tool').hidden = mode !== 'ball';
    this.refresh();
    this.onModeChange();
  }

  refresh(): void {
    const data = this.getData();
    this.edges.load(data.backgroundImage ?? '');
    this.root.setAttribute('viewBox', `0 0 ${this.root.clientWidth || 1} ${this.root.clientHeight || 1}`);
    if (drawsArea(this.mode) && !this.tool.selection) this.tool.selection = { kind: this.mode, index: 0 };
    this.tool.refresh();
  }

  /** A play area as a path (the saved one, or the default). */
  private area(mode: 'ball' | 'paddle'): AreaPath {
    const data = this.getData();
    const area =
      mode === 'ball'
        ? (data.playAreas?.ball ?? defaultArea('ball'))
        : (data.playAreas?.paddle ?? defaultArea('paddle'));
    return structuredClone(area) as AreaPath;
  }

  private toArea(mode: 'ball' | 'paddle', path: AreaPath): PolygonArea {
    const points = path.points.map((p) => ({ x: p.x, y: p.y }));
    if (mode === 'paddle') return { points, radius: path.radius };
    // The drain keeps its edge while it still exists; otherwise the lowest edge is.
    const drain = path.drainEdge !== undefined && path.drainEdge < points.length ? path.drainEdge : lowestEdge(points);
    return { points, radius: path.radius, drainEdge: drain } as BallArea;
  }

  /** Points snap onto nearby scene edges and line up with the area's other points (Alt: place freely). */
  private snap(screen: Point, world: Point, event: MouseEvent, anchors: readonly Point[]): Point {
    if (event.altKey) return world;
    let s = screen;
    if (input('snap-scene').checked) s = this.edges.snap(s, this.root.clientWidth, this.root.clientHeight);
    let p = s === screen ? world : this.scene.unproject(s);
    if (input('snap-lines').checked)
      p = snapPoint(p, anchors, distance(this.scene.unproject(s), this.scene.unproject({ x: s.x + 7, y: s.y })));
    return p;
  }

  private pickDrain(event: PointerEvent): void {
    if (!this.drainPicking || this.mode !== 'ball' || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = this.root.getBoundingClientRect();
    const p = this.scene.unproject({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const area = this.area('ball');
    let best = Infinity;
    let edge = 0;
    area.points.forEach((a, i) => {
      const d = distance(p, nearestOnSegment(p, a, area.points[(i + 1) % area.points.length]));
      if (d < best) {
        best = d;
        edge = i;
      }
    });
    this.drainPicking = false;
    const ball: AreaPath = { ...area, drainEdge: edge };
    this.tool.apply(
      { ball: [ball], paddle: [this.area('paddle')] },
      'Drain edge set: balls leaving through the amber edge lose a life.',
    );
  }

  /** The ball area's drain edge and the paddle's lane. */
  private drawGuides(model: PathModel, project: (p: Point) => Point): void {
    const ball = this.toArea('ball', model.ball[0] as AreaPath) as BallArea;
    const paddle = this.toArea('paddle', model.paddle[0] as AreaPath);
    const line = (a: Point, b: Point, cls: string): void => {
      const p = project(a),
        q = project(b);
      this.layer.append(svg('path', { d: `M${p.x},${p.y} L${q.x},${q.y}`, class: cls, 'data-extra': '' }));
    };
    if (this.mode === 'ball')
      for (const segment of areaSegments(ball, ball.drainEdge))
        if (segment.drain) line(segment.a, segment.b, 'area-line ball drain');
    if (this.mode === 'paddle')
      try {
        const lane = findPaddleLane(paddle, PADDLE.expandedWidth, PADDLE.halfH);
        for (const [left, right] of lane.spans) line({ x: left, y: lane.y }, { x: right, y: lane.y }, 'lane-guide');
      } catch {
        /* A transient drag can be invalid; saving explains it. */
      }
  }
}
