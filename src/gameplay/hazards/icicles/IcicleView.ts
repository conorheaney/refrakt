import * as THREE from 'three';
import { ICICLE } from '../../config';
import type { Icicle } from './icicles';
import type { World } from '../../World';

/**
 * Icicles hang in front of the bricks (which are GRID.depth deep around z = 0), so one falling through the
 * brick rows reads as passing in front of them rather than cutting through.
 */
export const ICICLE_Z = 0.62;
const Z = ICICLE_Z;

/** How far each icicle's root starts up inside the lintel, so its faded top overlaps the snow line. */
const ROOT_TUCK = 0.1;

/** Small deterministic generator, so each icicle keeps its own shape from run to run. */
function seeded(seed: number): () => number {
  let s = (Math.floor(seed * 1000) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One icicle in world units, hanging from y = 0 to its tip at y = -length. Modelled on the icicles painted
 * under the Frozen Sanctuary lintel: a thick root that swells smoothly out of the snow, a body that narrows
 * with a concave taper, and a small rounded drop of ice at the end rather than a point. Every proportion
 * varies per icicle (thickness, swell, taper, drips, lean, an off-round cross-section) so no two match.
 */
function spikeGeometry(length: number, rand: () => number): THREE.BufferGeometry {
  const rootR = ICICLE.radius * (1.05 + rand() * 0.4);
  const bodyR = ICICLE.radius * (0.7 + rand() * 0.35);
  const tipR = Math.min(bodyR * (0.2 + rand() * 0.15), 0.07);
  // The swell at the root runs a good way down, so it reads as one mass of ice rather than a hat.
  const flareLen = length * (0.25 + rand() * 0.2);
  const taper = 1.1 + rand() * 0.7;
  const drip = rand() < 0.6 ? 0.03 + rand() * 0.06 : 0;
  const drips = 2 + rand() * 4;
  const phase = rand() * Math.PI * 2;
  const bodyEnd = length - tipR;
  const points: THREE.Vector2[] = [];
  // From the tip up to the root, so the lathe's faces point outwards. First the rounded end...
  const capSteps = 8;
  for (let i = 0; i <= capSteps; i++) {
    const a = (i / capSteps) * (Math.PI / 2);
    points.push(new THREE.Vector2(tipR * Math.sin(a), -bodyEnd - tipR * Math.cos(a)));
  }
  // ...then the body and the swelling root.
  const steps = 48;
  for (let j = 1; j <= steps; j++) {
    const s = bodyEnd * (1 - j / steps);
    const u = s / bodyEnd;
    const body = tipR + (bodyR - tipR) * Math.pow(1 - u, taper);
    const f = Math.max(0, 1 - s / flareLen);
    const flare = (rootR - bodyR) * f * f * (3 - 2 * f);
    const bulge = 1 + drip * Math.sin(u * drips * Math.PI * 2 + phase) * Math.sin(u * Math.PI);
    points.push(new THREE.Vector2((body + flare) * bulge, -s));
  }
  points.push(new THREE.Vector2(0, 0));
  const geometry = new THREE.LatheGeometry(points, 24);
  const bendX = (rand() - 0.5) * 0.3;
  const bendZ = (rand() - 0.5) * 0.1;
  const squash = 0.8 + rand() * 0.3;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const t = -position.getY(i) / length;
    position.setX(i, position.getX(i) + bendX * t * t);
    position.setZ(i, position.getZ(i) * squash + bendZ * t * t);
  }
  geometry.rotateY((rand() - 0.5) * 0.8);
  geometry.computeVertexNormals();
  return geometry;
}

/** Faint vertical meltwater runs (grey levels around mid-grey), wrapped round the spike. */
function createStreakTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgb(128, 128, 128)';
  g.fillRect(0, 0, w, h);
  const rand = seeded(7.31);
  for (let i = 0; i < 16; i++) {
    const x = rand() * w;
    const top = rand() * h * 0.2;
    const len = h * (0.4 + rand() * 0.6);
    const v = rand() < 0.7 ? 200 + rand() * 55 : 60 + rand() * 40;
    g.strokeStyle = `rgba(${v}, ${v}, ${v}, ${0.35 + rand() * 0.4})`;
    g.lineWidth = 0.8 + rand() * 2.2;
    g.beginPath();
    g.moveTo(x, h - top);
    g.bezierCurveTo(
      x + (rand() - 0.5) * 4,
      h - top - len / 3,
      x + (rand() - 0.5) * 4,
      h - top - (2 * len) / 3,
      x + (rand() - 0.5) * 3,
      h - top - len,
    );
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

const VERTEX = /* glsl */ `
uniform float uLength;
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
varying float vRoot;
void main() {
  vUv = uv;
  // 0 at the tip, 1 at the root, from the unscaled shape.
  vRoot = clamp(1.0 + position.y / uLength, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

/**
 * Painted-ice shading, matching the icicles in the Frozen Sanctuary backdrop rather than relying on the
 * scene lights: light from the upper left turns the near side almost white and leaves the far side a deep,
 * saturated blue; the core you look straight through is clearer and bluer; a crisp white highlight runs
 * down the lit side; the rim catches light; and the root frosts over and fades into the lintel. The back
 * faces are drawn first in deep blue (uBack = 1) so the ice has an inside, which gives it thickness.
 */
const FRAGMENT = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uPale;
uniform float uOpacity;
uniform float uGlint;
uniform float uStreak;
uniform float uBack;
uniform sampler2D uRuns;
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
varying float vRoot;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  if (uBack > 0.5) n = -n;
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - facing, 3.0);
  vec3 L = normalize(vec3(-0.6, 0.45, 0.65));
  float lit = clamp(dot(n, L) * 0.55 + 0.45, 0.0, 1.0);
  float runs = texture2D(uRuns, vUv).r - 0.5;
  float frost = smoothstep(0.8, 1.0, vRoot);
  vec3 col;
  float alpha;
  if (uBack > 0.5) {
    // The inside of the far wall: deep blue, lighter where light comes through from the lit side.
    col = mix(uDeep * 0.75, uDeep * 1.25, lit);
    alpha = 0.32;
  } else {
    col = mix(uDeep, uPale, pow(lit, 2.4));
    // Looking straight through the middle: a clearer, more saturated blue.
    col = mix(col, uDeep * 1.2 + vec3(0.03, 0.08, 0.12), facing * facing * 0.5);
    col += vec3(0.85, 0.95, 1.0) * rim * (0.55 + 0.8 * lit);
    float streak = smoothstep(0.12, 0.0, abs(n.x - uStreak)) * smoothstep(0.1, 0.5, facing);
    float streak2 = smoothstep(0.06, 0.0, abs(n.x - uStreak * -0.6)) * facing;
    col += vec3(1.0) * streak * 1.1 + vec3(0.7, 0.88, 1.0) * streak2 * 0.35;
    col *= 1.0 + runs * 0.35;
    alpha = 0.26 + 0.65 * rim + 0.3 * pow(lit, 4.0) + streak * 0.45;
  }
  // Frosted white at the root, melting into the snow on the lintel.
  col = mix(col, vec3(0.9, 0.96, 1.0), frost * 0.55);
  alpha = max(alpha, frost * 0.6);
  // The top fades out so the root has no hard edge against the stone.
  alpha *= 1.0 - smoothstep(0.9, 1.0, vRoot);
  col += uGlint * vec3(0.5, 0.8, 1.0);
  gl_FragColor = vec4(col, clamp(alpha * uOpacity, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function iceMaterial(
  runs: THREE.Texture,
  length: number,
  back: boolean,
  deep: THREE.Color,
  pale: THREE.Color,
  streak: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLength: { value: length },
      uDeep: { value: deep },
      uPale: { value: pale },
      uOpacity: { value: 1 },
      uGlint: { value: 0 },
      uStreak: { value: streak },
      uBack: { value: back ? 1 : 0 },
      uRuns: { value: runs },
    },
    side: back ? THREE.BackSide : THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
}

class IcicleMesh {
  readonly group = new THREE.Group();
  /** Scaled by the icicle's growth, so it grows down from the ceiling. */
  private readonly body = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly materials: THREE.ShaderMaterial[];
  /** This icicle's own clarity, so some read as clearer than others. */
  private readonly clarity: number;

  constructor(runs: THREE.Texture, def: Icicle['def']) {
    const rand = seeded(def.x + 31.7);
    // Each its own blue, from pale glacier ice to a deeper cold blue.
    const deep = new THREE.Color(0x1f63b0).lerp(new THREE.Color(0x2f86cf), rand());
    const pale = new THREE.Color(0xdcf1ff).lerp(new THREE.Color(0xb4dcf8), rand() * 0.7);
    this.clarity = 0.85 + rand() * 0.2;
    const streak = -0.62 + rand() * 0.3;
    // Built ROOT_TUCK longer, so the tip still sits where the simulation puts it.
    const length = def.length + ROOT_TUCK;
    this.geometry = spikeGeometry(length, rand);
    this.materials = [
      iceMaterial(runs, length, true, deep, pale, streak),
      iceMaterial(runs, length, false, deep, pale, streak),
    ];
    const inside = new THREE.Mesh(this.geometry, this.materials[0]);
    const outside = new THREE.Mesh(this.geometry, this.materials[1]);
    inside.renderOrder = 9;
    outside.renderOrder = 10;
    this.body.add(inside, outside);
    this.group.add(this.body);
  }

  update(c: Icicle, alpha: number, time: number): void {
    const def = c.def;
    const drop = c.pdrop + (c.drop - c.pdrop) * alpha;
    let x = def.x;
    let glint = 0;
    if (c.state === 'warn') {
      const warn = 1 - Math.max(0, c.timer) / ICICLE.warn[0];
      // Trembles harder and glints brighter as the drop nears.
      x += Math.sin(time * 70 + def.x) * 0.035 * (0.4 + warn);
      glint = (0.25 + 0.15 * Math.sin(time * 18)) * (0.5 + warn);
    }
    this.group.position.set(x, def.y + ROOT_TUCK - drop, Z);
    const g = Math.max(0.001, c.growth);
    // Regrowing ice lengthens faster than it thickens.
    const thick = 0.4 + 0.6 * Math.sqrt(g);
    this.body.scale.set(thick, g, thick);
    this.body.visible = c.growth > 0.02;
    const opacity = this.clarity * (0.4 + 0.6 * Math.min(1, c.growth * 1.5));
    for (const m of this.materials) {
      m.uniforms.uOpacity.value = opacity;
      m.uniforms.uGlint.value = glint;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/**
 * Draws the current world's icicles (gameplay/hazards/icicles/icicles.ts). Meshes are made on first use and rebuilt when the
 * world's icicles change.
 */
export class IcicleView {
  private readonly meshes: IcicleMesh[] = [];
  private readonly runs = createStreakTexture();
  /** The definitions the meshes were built for; a new world's icicles get new shapes. */
  private built: readonly Icicle['def'][] = [];

  constructor(private readonly scene: THREE.Scene) {}

  update(world: World, alpha: number): void {
    const items = world.icicles.items;
    if (items.length !== this.built.length || items.some((c, i) => c.def !== this.built[i])) this.rebuild(items);
    for (let i = 0; i < items.length; i++) this.meshes[i].update(items[i], alpha, world.time);
  }

  private rebuild(items: readonly Icicle[]): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh.group);
      mesh.dispose();
    }
    this.meshes.length = 0;
    for (const c of items) {
      const mesh = new IcicleMesh(this.runs, c.def);
      this.meshes.push(mesh);
      this.scene.add(mesh.group);
    }
    this.built = items.map((c) => c.def);
  }
}
