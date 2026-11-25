import { roundedPath } from '../../../engine/core/paths';
import * as THREE from 'three';
import { SNAKE } from '../../config';
import { lerp } from '../../../engine/core/math';
import type { Snake } from './snakes';
import type { World } from '../../World';

// ------------------------------------------------------------------ skin texture

const SKIN_W = 256;
const SKIN_H = 512;
/** Scales around the body (u) and along one texture tile (v). Both even, so the staggered grid tiles. */
const SCALE_COLS = 10;
const SCALE_ROWS = 20;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Tileable jungle-viper skin: u runs around the body (u = 0.25 is the back, which faces the camera; 0.75 is
 * the belly), v along it. Staggered domed scales with dark creases, olive flanks fading to a cream belly,
 * dark yellow-rimmed diamonds down the spine and blotches along the sides. Returns a colour map and a
 * matching height map for bump shading.
 */
function createSnakeSkin(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const make = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } => {
    const canvas = document.createElement('canvas');
    canvas.width = SKIN_W;
    canvas.height = SKIN_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    return { canvas, ctx, img: ctx.createImageData(SKIN_W, SKIN_H) };
  };
  const color = make();
  const height = make();
  const back = [44, 70, 24];
  const flank = [96, 128, 40];
  const belly = [218, 204, 142];
  const core = [26, 32, 12];
  const rim = [204, 184, 62];
  const c = [0, 0, 0];
  const mix = (a: readonly number[], b: readonly number[], t: number): void => {
    c[0] = a[0] + (b[0] - a[0]) * t;
    c[1] = a[1] + (b[1] - a[1]) * t;
    c[2] = a[2] + (b[2] - a[2]) * t;
  };
  for (let py = 0; py < SKIN_H; py++) {
    const v = (py + 0.5) / SKIN_H;
    const gy = v * SCALE_ROWS;
    const row = Math.floor(gy);
    for (let px = 0; px < SKIN_W; px++) {
      const u = (px + 0.5) / SKIN_W;
      const gx = u * SCALE_COLS;
      const col = Math.floor(gx);
      // Distances to the nearest and second-nearest scale centres of a staggered grid.
      let f1 = 9;
      let f2 = 9;
      for (let j = row - 1; j <= row + 1; j++) {
        const offset = (j & 1) * 0.5;
        for (let i = col - 1; i <= col + 1; i++) {
          const dx = gx - (i + 0.5 + offset);
          const dy = (gy - (j + 0.5)) * 1.2;
          const d = Math.hypot(dx, dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const crease = smoothstep(0, 0.2, f2 - f1);
      const dome = crease * (1 - 0.55 * f1);

      const dorsal = Math.cos(2 * Math.PI * (u - 0.25));
      mix(flank, back, smoothstep(0.15, 0.95, dorsal));
      const base = [c[0], c[1], c[2]];
      mix(base, belly, smoothstep(-0.3, -0.75, dorsal));

      // Diamonds down the spine.
      let du = Math.abs(u - 0.25);
      du = Math.min(du, 1 - du);
      const pv = (v * 3) % 1;
      const diamond = Math.abs(pv - 0.5) * 0.42 + du;
      if (diamond < 0.15) mix([c[0], c[1], c[2]], core, 0.85);
      else if (diamond < 0.185) mix([c[0], c[1], c[2]], rim, 0.75);
      // Blotches between the diamonds, low on each flank.
      const pv2 = (v * 3 + 0.5) % 1;
      const ds = Math.min(Math.abs(u - 0.04), Math.abs(u - 0.46), Math.abs(u - 1.04));
      if (Math.hypot((pv2 - 0.5) * 0.3, ds) < 0.055) mix([c[0], c[1], c[2]], core, 0.7);

      const shade = 0.55 + 0.5 * dome;
      const o = (py * SKIN_W + px) * 4;
      color.img.data[o] = Math.min(255, c[0] * shade);
      color.img.data[o + 1] = Math.min(255, c[1] * shade);
      color.img.data[o + 2] = Math.min(255, c[2] * shade);
      color.img.data[o + 3] = 255;
      const h = Math.round(dome * 255);
      height.img.data[o] = height.img.data[o + 1] = height.img.data[o + 2] = h;
      height.img.data[o + 3] = 255;
    }
  }
  const finish = (layer: ReturnType<typeof make>, srgb: boolean): THREE.CanvasTexture => {
    layer.ctx.putImageData(layer.img, 0, 0);
    const tex = new THREE.CanvasTexture(layer.canvas);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  };
  return { map: finish(color, true), bump: finish(height, false) };
}

// ------------------------------------------------------------------- one snake

/** Rings along the body and vertices around each ring. */
const SEG = 64;
const RAD = 14;
const BODY_RADIUS = 0.42;
/** The head model is built at unit scale; this sizes it to the thicker body. */
const HEAD_SCALE = 1.3;
/** Times the skin repeats from tail to neck. */
const SKIN_TILES = 2.4;
/** Playfield depth of the snake (in front of the bricks' plane, level with the paddle's face). */
export const SNAKE_DEPTH = 0.35;
const Z = SNAKE_DEPTH;
/** The tail emerges from the scenery this far behind (and above) the den. */
const TAIL_BACK = 3.6;
const TAIL_UP = 1.5;

/** A head sculpted from a sphere: long, wedge-shaped, flat underneath, narrowing to the snout (+x). */
function headGeometry(radius: number, length: number, flatten: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const tx = x / radius;
    const taper = 1 - 0.4 * Math.max(0, tx);
    pos.setXYZ(i, x * length, y * flatten * taper * (y < 0 ? 0.7 : 1), z * 0.88 * taper);
  }
  geo.computeVertexNormals();
  return geo;
}

class SnakeMesh {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly positions: THREE.BufferAttribute;
  private readonly normals: THREE.BufferAttribute;
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly tongue = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  // Scratch spine, reused every frame.
  private readonly sx = new Float32Array(SEG + 1);
  private readonly sy = new Float32Array(SEG + 1);
  private readonly sz = new Float32Array(SEG + 1);
  private readonly t = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 0, 1);
  private readonly seed = Math.random() * 100;

  constructor(skin: THREE.MeshStandardMaterial, mouth: THREE.Material, fang: THREE.Material, tongue: THREE.Material) {
    const verts = (SEG + 1) * (RAD + 1);
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.normals = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.normals.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(verts * 2);
    const index: number[] = [];
    for (let s = 0; s <= SEG; s++) {
      for (let k = 0; k <= RAD; k++) {
        const v = s * (RAD + 1) + k;
        uv[v * 2] = k / RAD;
        uv[v * 2 + 1] = (s / SEG) * SKIN_TILES;
        if (s < SEG && k < RAD) {
          const a = v;
          const b2 = v + RAD + 1;
          index.push(a, b2, a + 1, b2, b2 + 1, a + 1);
        }
      }
    }
    geo.setIndex(index);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('normal', this.normals);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.body = new THREE.Mesh(geo, skin);
    this.body.castShadow = true;
    this.body.frustumCulled = false;

    // Head: upper skull, a hinged lower jaw with a pink mouth lining, fangs, eyes and a forked tongue.
    const skull = new THREE.Mesh(headGeometry(0.5, 1.4, 0.6), skin);
    skull.position.x = 0.3;
    skull.castShadow = true;
    const lining = new THREE.Mesh(headGeometry(0.4, 1.35, 0.12), mouth);
    lining.position.set(0.5, 0.04, 0);
    const jawBone = new THREE.Mesh(headGeometry(0.42, 1.4, 0.3), skin);
    jawBone.position.x = 0.5;
    this.jaw.add(jawBone, lining);
    this.jaw.position.set(-0.15, -0.12, 0);

    const fangGeo = new THREE.ConeGeometry(0.035, 0.24, 8);
    fangGeo.rotateZ(Math.PI);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(fangGeo, fang);
      f.position.set(0.72, -0.16, s * 0.13);
      this.head.add(f);
    }

    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c22a, emissive: 0xffc81e, emissiveIntensity: 0.4, roughness: 0.15 });
    const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const eyeGeo = new THREE.SphereGeometry(0.085, 16, 12);
    const pupilGeo = new THREE.SphereGeometry(0.06, 12, 8);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, this.eyeMaterial);
      eye.position.set(0.5, 0.12, s * 0.27);
      const pupil = new THREE.Mesh(pupilGeo, pupilMaterial);
      pupil.scale.set(0.35, 1.05, 0.35);
      pupil.position.set(0.02, 0, s * 0.05);
      eye.add(pupil);
      this.head.add(eye);
    }

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 6), tongue);
    stem.rotation.z = Math.PI / 2;
    stem.position.x = 0.16;
    this.tongue.add(stem);
    for (const s of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.14, 5), tongue);
      fork.rotation.set(0, s * 0.5, Math.PI / 2);
      fork.position.set(0.37, 0, s * 0.03);
      this.tongue.add(fork);
    }
    this.tongue.position.set(0.95, -0.08, 0);

    this.head.add(skull, this.jaw, this.tongue);
    this.group.add(this.body, this.head);
  }

  update(h: Snake, alpha: number, time: number): void {
    const def = h.def;
    const p = h.duration > 0 ? Math.min(1, Math.max(0, 1 - h.timer / h.duration)) : 1;
    const warn = h.state === 'warn' ? p : 0;

    // Head position (interpolated), with a gentle idle bob and a quick shiver while it warns.
    let hx = lerp(h.phx, h.headX, alpha);
    let hy = lerp(h.phy, h.headY, alpha);
    const idle = h.state === 'idle' ? 1 : 0;
    hy += idle * Math.sin(time * 1.8 + this.seed) * 0.08;
    hx += warn * Math.sin(time * 70) * 0.035;
    hy += warn * Math.cos(time * 63) * 0.03;

    if (def.body) this.drapedSpine(h, hx, hy, time);
    else this.coiledSpine(h, hx, hy, time);
    this.buildTube();
    this.poseHead(h, p, warn, time);
  }

  /** Resting coiled at the den, the tail rising into the scenery behind it (hazards without a `body`). */
  private coiledSpine(h: Snake, hx: number, hy: number, time: number): void {
    const def = h.def;
    const f = h.facing;
    // Direction the head points: along the strike, or inwards and a little down at rest.
    let dx = h.targetX - def.x;
    let dy = h.targetY - def.y;
    if (h.state === 'idle') {
      dx = f;
      dy = -0.2 + Math.sin(time * 0.9 + this.seed) * 0.1;
    }
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;

    // Spine: a cubic from the tail (up in the scenery behind the den) to the head, entering the head along
    // its direction, plus a sideways S-wave that straightens as the snake extends.
    const ax = def.x - f * TAIL_BACK;
    const ay = def.y + TAIL_UP;
    const c1x = ax + f * 1.4;
    const c1y = ay - 1.6;
    const c2x = hx - dx * 1.6;
    const c2y = hy - dy * 1.6;
    const ext = Math.max(0, h.ext);
    const amp = 0.18 + 0.75 * (1 - ext);
    const phase = time * 1.3 + this.seed;
    let prevX = ax;
    let prevY = ay;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const it = 1 - t;
      const bx = it * it * it * ax + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * hx;
      const by = it * it * it * ay + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * hy;
      // Perpendicular of the base curve (from the previous sample) for the S-wave.
      let tx = bx - prevX;
      let ty = by - prevY;
      if (s === 0) {
        tx = c1x - ax;
        ty = c1y - ay;
      }
      const tl = Math.hypot(tx, ty) || 1;
      const env = Math.sin(Math.PI * t) * (1 - 0.35 * t);
      const wave = Math.sin(2 * Math.PI * 1.5 * t - phase);
      this.sx[s] = bx - (ty / tl) * amp * env * wave;
      this.sy[s] = by + (tx / tl) * amp * env * wave;
      this.sz[s] = Z + 0.35 * env * Math.cos(2 * Math.PI * 1.5 * t - phase) * (0.4 + 0.6 * (1 - ext));
      prevX = bx;
      prevY = by;
    }
  }

  // Draped pose: the rest path (body points + den) and its cumulative arc lengths, cached per definition.
  private restDef: Snake['def'] | null = null;
  private restX: number[] = [];
  private restY: number[] = [];
  private restS: number[] = [];
  private readonly chainX: number[] = [];
  private readonly chainY: number[] = [];

  private setRest(def: Snake['def']): void {
    if (def === this.restDef) return;
    this.restDef = def;
    // Its body then the den, bends rounded off as the snake asks (engine/core/paths.ts).
    const rest = roundedPath([...(def.body ?? []), { x: def.x, y: def.y }], false, def.radius ?? 0);
    this.restX = rest.map((p) => p.x);
    this.restY = rest.map((p) => p.y);
    this.restS = [0];
    for (let i = 1; i < this.restX.length; i++) {
      this.restS.push(this.restS[i - 1] + Math.hypot(this.restX[i] - this.restX[i - 1], this.restY[i] - this.restY[i - 1]));
    }
  }

  /** Appends the rest path's point at arc length s to the chain. */
  private pushRestAt(s: number): void {
    const rs = this.restS;
    let i = 1;
    while (i < rs.length - 1 && rs[i] < s) i++;
    const seg = rs[i] - rs[i - 1];
    const k = seg > 1e-6 ? Math.min(1, Math.max(0, (s - rs[i - 1]) / seg)) : 1;
    this.chainX.push(lerp(this.restX[i - 1], this.restX[i], k));
    this.chainY.push(lerp(this.restY[i - 1], this.restY[i], k));
  }

  /**
   * Lying along its `body` path over the scenery. A strike pulls the body forward along the path (the tail
   * slides after it) while the front lunges straight out; a warning rears the head up off the rocks.
   */
  private drapedSpine(h: Snake, hx: number, hy: number, time: number): void {
    this.setRest(h.def);
    const total = this.restS[this.restS.length - 1];
    const cx = this.chainX;
    const cy = this.chainY;
    cx.length = cy.length = 0;
    const dist = Math.hypot(hx - h.def.x, hy - h.def.y);
    if (h.ext < 0) {
      // Rearing: draw the head back along the body and up off the rocks.
      const rise = Math.min(1, -h.ext / SNAKE.rear);
      const end = Math.max(0, total - dist * 1.6);
      for (let i = 0; i < this.restS.length && this.restS[i] < end; i++) {
        cx.push(this.restX[i]);
        cy.push(this.restY[i]);
      }
      this.pushRestAt(end);
      cx[cx.length - 1] += (hx - h.def.x) * 0.2;
      cy[cy.length - 1] += rise * 0.9 + (hy - h.def.y) * 0.2;
    } else {
      // Extending: the body slides forward by the lunge distance, then runs straight from the den to the head.
      const start = Math.min(dist, total);
      this.pushRestAt(start);
      for (let i = 0; i < this.restS.length; i++) {
        if (this.restS[i] > start) {
          cx.push(this.restX[i]);
          cy.push(this.restY[i]);
        }
      }
      if (dist > 1e-3) {
        cx.push(hx);
        cy.push(hy);
      } else {
        cx[cx.length - 1] = hx;
        cy[cy.length - 1] = hy;
      }
    }
    if (cx.length < 2) {
      cx.unshift(cx[0] - 0.01);
      cy.unshift(cy[0]);
    }

    // Resample evenly by arc length.
    let len = 0;
    for (let i = 1; i < cx.length; i++) len += Math.hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1]);
    let j = 1;
    let acc = 0;
    let segLen = Math.hypot(cx[1] - cx[0], cy[1] - cy[0]);
    for (let s = 0; s <= SEG; s++) {
      const want = (len * s) / SEG;
      while (j < cx.length - 1 && acc + segLen < want) {
        acc += segLen;
        j++;
        segLen = Math.hypot(cx[j] - cx[j - 1], cy[j] - cy[j - 1]);
      }
      const k = segLen > 1e-6 ? Math.min(1, (want - acc) / segLen) : 1;
      this.sx[s] = lerp(cx[j - 1], cx[j], k);
      this.sy[s] = lerp(cy[j - 1], cy[j], k);
    }
    // Round off the path's corners (ends stay put), then add a slow breath of a sway.
    for (let pass = 0; pass < 6; pass++) {
      let px = this.sx[0];
      let py = this.sy[0];
      for (let s = 1; s < SEG; s++) {
        const nx = (px + 2 * this.sx[s] + this.sx[s + 1]) / 4;
        const ny = (py + 2 * this.sy[s] + this.sy[s + 1]) / 4;
        px = this.sx[s];
        py = this.sy[s];
        this.sx[s] = nx;
        this.sy[s] = ny;
      }
    }
    const phase = time * 1.1 + this.seed;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const env = Math.sin(Math.PI * t);
      this.sy[s] += env * 0.05 * Math.sin(2 * Math.PI * 2 * t - phase);
      this.sz[s] = Z + env * 0.08 * Math.cos(2 * Math.PI * 2 * t - phase);
    }
  }

  /** Builds the tube around the spine in sx/sy/sz. */
  private buildTube(): void {
    // Tube around the spine. The ring's "up" leans towards the camera, so u = 0.25 (the patterned back)
    // faces the player and the belly faces the scenery.
    const pos = this.positions.array as Float32Array;
    const nor = this.normals.array as Float32Array;
    for (let s = 0; s <= SEG; s++) {
      const a = Math.max(0, s - 1);
      const c = Math.min(SEG, s + 1);
      this.t.set(this.sx[c] - this.sx[a], this.sy[c] - this.sy[a], this.sz[c] - this.sz[a]).normalize();
      this.b.copy(this.up).addScaledVector(this.t, -this.up.dot(this.t)).normalize();
      this.n.crossVectors(this.b, this.t);
      const t = s / SEG;
      const r = BODY_RADIUS * (0.18 + 0.82 * smoothstep(0, 0.4, t)) * (1 - 0.2 * smoothstep(0.82, 0.98, t));
      for (let k = 0; k <= RAD; k++) {
        const th = (k / RAD) * Math.PI * 2;
        const cx = Math.cos(th);
        const sn = Math.sin(th);
        const nx = this.n.x * cx + this.b.x * sn;
        const ny = this.n.y * cx + this.b.y * sn;
        const nz = this.n.z * cx + this.b.z * sn;
        const o = (s * (RAD + 1) + k) * 3;
        pos[o] = this.sx[s] + nx * r;
        pos[o + 1] = this.sy[s] + ny * r;
        pos[o + 2] = this.sz[s] + nz * r;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
      }
    }
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
  }

  private poseHead(h: Snake, p: number, warn: number, time: number): void {
    // Head pose: along the end of the body, turning to face the strike while it warns. Mirrored vertically
    // when facing left so the eyes stay on top.
    const hx = this.sx[SEG];
    const hy = this.sy[SEG];
    let ex = this.sx[SEG] - this.sx[SEG - 3];
    let ey = this.sy[SEG] - this.sy[SEG - 3];
    const tl = Math.hypot(ex, ey) || 1;
    ex /= tl;
    ey /= tl;
    if (h.def.body && (h.state === 'idle' || h.state === 'warn')) {
      // Draped snakes hold their heads up a little at rest, and swing round to aim during the warning.
      let ax = h.targetX - h.def.x;
      let ay = h.targetY - h.def.y;
      const al = Math.hypot(ax, ay) || 1;
      ax /= al;
      ay /= al;
      const k = h.state === 'warn' ? smoothstep(0, 0.5, warn) : 0;
      ex = lerp(ex, ax, k);
      ey = lerp(ey + 0.3 * (1 - k), ay, k);
    }
    const angle = Math.atan2(ey, ex);
    // The snout tip (local x ~ 1.0) should sit at the edge of the bite circle around (hx, hy), so what the
    // player sees touching the paddle is what bites; the neck then ends inside the skull.
    const back = 1.0 * HEAD_SCALE - SNAKE.headRadius;
    const el = Math.hypot(ex, ey) || 1;
    this.head.position.set(hx - (ex / el) * back, hy - (ey / el) * back, Z);
    this.head.rotation.set(0, 0, angle);
    this.head.scale.set(HEAD_SCALE, (ex < 0 ? -1 : 1) * HEAD_SCALE, HEAD_SCALE);

    // Jaw: parts while warning, gapes on the strike, snaps shut as it pulls back.
    let open = 0;
    if (h.state === 'warn') open = 0.35 * p;
    else if (h.state === 'strike') open = 0.35 + 0.5 * p;
    else if (h.state === 'hold') open = 0.85 * (1 - p * 0.3);
    else if (h.state === 'retract') open = 0.6 * (1 - Math.min(1, p * 2.5));
    this.jaw.rotation.z = -open;

    // Eyes flare during the warning.
    this.eyeMaterial.emissiveIntensity = 0.4 + 5 * warn * warn + (h.state === 'strike' || h.state === 'hold' ? 3 : 0);

    // Tongue: short flicks every couple of seconds at rest, rapid flicking while it warns.
    let flick = 0;
    if (h.state === 'warn') flick = Math.abs(Math.sin(time * 22));
    else if (h.state === 'idle') {
      const cycle = (time + this.seed) % 2.6;
      if (cycle < 0.45) flick = Math.abs(Math.sin(cycle * 21));
    }
    this.tongue.visible = flick > 0.05;
    this.tongue.scale.set(Math.max(0.05, flick), 1, 1);
  }
}

// ------------------------------------------------------------------------ view

/**
 * Draws the current world's snakes (gameplay/hazards/snakes/snakes.ts). Meshes are made on first use and reused after.
 * Snakes draw over everything else, rain and particles included: they sit in one layer that renders
 * after the rest of the scene (as transparent objects with the highest group order), and the layer
 * clears the depth buffer before its first snake, so nothing nearer the camera can hide them. They
 * keep depth testing among themselves, so a snake's own parts still overlap correctly.
 */
export class SnakesView {
  private readonly meshes: SnakeMesh[] = [];
  private readonly layer = new THREE.Group();
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly mouth = new THREE.MeshStandardMaterial({ color: 0xb8475e, roughness: 0.55 });
  private readonly fang = new THREE.MeshStandardMaterial({ color: 0xf4efe0, roughness: 0.3 });
  private readonly tongue = new THREE.MeshStandardMaterial({ color: 0xc0182c, roughness: 0.4, emissive: 0x400008 });

  constructor(scene: THREE.Scene) {
    this.layer.renderOrder = 1000;
    // An invisible triangle drawn first in the layer, only to clear depth before the snakes.
    const clearGeo = new THREE.BufferGeometry();
    clearGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const depthClear = new THREE.Mesh(
      clearGeo,
      new THREE.MeshBasicMaterial({ transparent: true, colorWrite: false, depthWrite: false, depthTest: false }),
    );
    depthClear.renderOrder = -1;
    depthClear.frustumCulled = false;
    depthClear.onBeforeRender = (renderer) => renderer.clearDepth();
    this.layer.add(depthClear);
    scene.add(this.layer);
    const { map, bump } = createSnakeSkin();
    this.skin = new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 3,
      roughness: 0.48,
      metalness: 0.05,
      envMapIntensity: 0.8,
    });
  }

  update(world: World, alpha: number): void {
    const items = world.snakes.items;
    while (this.meshes.length < items.length) {
      const mesh = new SnakeMesh(this.skin, this.mouth, this.fang, this.tongue);
      this.meshes.push(mesh);
      // Transparent (at full opacity) so the snakes sort after the scene's other transparent objects.
      mesh.group.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).transparent = true;
      });
      this.layer.add(mesh.group);
    }
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const hazard = items[i];
      mesh.group.visible = hazard !== undefined;
      if (hazard) mesh.update(hazard, alpha, world.time);
    }
  }
}
